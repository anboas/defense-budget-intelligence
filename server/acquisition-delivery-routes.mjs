import { randomUUID } from "node:crypto";
import {
  ACQUISITION_DELIVERY_MAX_ATTEMPTS,
  deliveryBackoffAt,
  deliveryProviderConfig,
  renderOperationalIncidentEmail,
  renderAcquisitionEmail,
  sendAcquisitionEmail,
  verifyResendSender,
} from "../src/acquisition-delivery-core.js";

function validEmail(value) { return /^[^\s@]+@[^\s@]+$/.test(String(value || "").trim()); }

function publicProvider(row, fallback) {
  if (!row) return { name: "resend", configured: Boolean(fallback?.configured), source: fallback?.source || "unconfigured", status: fallback?.configured ? "configured" : "unconfigured" };
  return { name: "resend", configured: !row.revoked_at, source: "platform_vault", status: row.revoked_at ? "revoked" : row.verification_status || "unverified", id: row.id,
    label: row.label, lastFour: row.key_last_four, fromName: row.from_name, fromEmail: row.from_email, replyToEmail: row.reply_to_email || "",
    lastVerifiedAt: row.last_verified_at || null, lastErrorCode: row.last_error_code || null, createdAt: row.created_at, updatedAt: row.updated_at, lastUsedAt: row.last_used_at || null };
}

async function storedProvider(pool, env, decryptSecret) {
  const result = await pool.query("SELECT * FROM app_platform_email_provider_config WHERE provider = 'resend' AND revoked_at IS NULL LIMIT 1");
  if (!result.rowCount) return { row: null, config: deliveryProviderConfig(env) };
  const row = result.rows[0]; const apiKey = decryptSecret(row);
  return { row, config: deliveryProviderConfig(env, { apiKey, fromName: row.from_name, fromEmail: row.from_email, replyToEmail: row.reply_to_email }) };
}

function publicJob(row) {
  return {
    id: row.id, workspaceId: row.workspace_id, workspaceName: row.workspace_name || "Workspace",
    userId: row.user_id, userName: row.display_name || row.email || "User", savedViewId: row.saved_view_id,
    savedViewName: row.saved_view_name || "Saved view", mode: row.delivery_mode, status: row.status,
    attemptCount: Number(row.attempt_count || 0), nextAttemptAt: row.next_attempt_at, lastError: row.last_error || null,
    createdAt: row.created_at, updatedAt: row.updated_at, deliveredAt: row.delivered_at || null,
  };
}

async function complete(pool, rows, result, now) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const row of rows) {
      const attempts = Number(row.attempt_count || 0) + 1;
      await client.query(`INSERT INTO app_acquisition_delivery_attempts
        (id, job_id, workspace_id, provider, status, provider_message_id, error_code, attempted_at) VALUES ($1,$2,$3,'resend',$4,$5,$6,$7)`,
      [randomUUID(), row.id, row.workspace_id, result.ok ? "delivered" : "failed", result.providerMessageId || null, result.code || null, now]);
      if (result.ok) await client.query("UPDATE app_acquisition_delivery_jobs SET status = 'delivered', attempt_count = $1, last_error = NULL, updated_at = $2, delivered_at = $2 WHERE id = $3", [attempts, now, row.id]);
      else {
        const retryable = result.retryable && attempts < ACQUISITION_DELIVERY_MAX_ATTEMPTS;
        const retryAt = result.retryAfterSeconds ? new Date(Date.now() + result.retryAfterSeconds * 1_000).toISOString() : deliveryBackoffAt(attempts, new Date(now));
        await client.query("UPDATE app_acquisition_delivery_jobs SET status = $1, attempt_count = $2, next_attempt_at = $3, last_error = $4, updated_at = $5 WHERE id = $6", [retryable ? "pending" : "failed", attempts, retryAt, result.code || "provider_unavailable", now, row.id]);
      }
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}

async function reconcileOperationalIncidents(pool, provider, { notify = true } = {}) {
  const [delivery, refreshes, clientErrors] = await Promise.all([
    pool.query("SELECT status, COUNT(*)::int AS total FROM app_acquisition_delivery_jobs WHERE status IN ('failed','pending_provider') GROUP BY status"),
    pool.query(`SELECT run.workspace_id, workspace.name, run.error_code FROM app_acquisition_refresh_runs run JOIN app_workspaces workspace ON workspace.workspace_id = run.workspace_id
      JOIN LATERAL (SELECT id FROM app_acquisition_refresh_runs candidate WHERE candidate.workspace_id = run.workspace_id ORDER BY started_at DESC LIMIT 1) latest ON latest.id = run.id WHERE run.status = 'failed'`),
    pool.query("SELECT COUNT(*)::int AS total FROM app_api_request_log WHERE request_kind = 'client_error' AND completed_at >= NOW() - INTERVAL '1 hour'"),
  ]);
  const counts = new Map(delivery.rows.map((row) => [row.status, Number(row.total || 0)])); const active = [];
  if (counts.get("failed")) active.push({ key: "delivery:dead-letter", category: "delivery", severity: "critical", title: "Outbound deliveries require recovery", summary: `${counts.get("failed")} delivery jobs reached the retry ceiling.`, source: "delivery", metadata: { count: counts.get("failed") } });
  if (!provider.configured && counts.get("pending_provider")) active.push({ key: "delivery:provider-unconfigured", category: "delivery", severity: "warning", title: "Outbound email provider is not configured", summary: `${counts.get("pending_provider")} retained delivery jobs are waiting for a protected provider.`, source: "delivery", metadata: { count: counts.get("pending_provider") } });
  for (const row of refreshes.rows) active.push({ key: `refresh:${row.workspace_id}`, category: "source", severity: "critical", title: `${row.name} refresh failed`, summary: `The latest acquisition refresh failed with ${row.error_code || "source_unavailable"}.`, source: "scheduler", metadata: { workspaceId: row.workspace_id, errorCode: row.error_code || "source_unavailable" } });
  if (Number(clientErrors.rows[0]?.total || 0) >= 3) active.push({ key: "client-errors:repeated", category: "client", severity: "warning", title: "Repeated client errors detected", summary: `${Number(clientErrors.rows[0].total)} authenticated client errors were retained in the last hour.`, source: "browser", metadata: { count: Number(clientErrors.rows[0].total), windowHours: 1 } });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const existing = await client.query("SELECT * FROM app_operational_incidents WHERE status <> 'resolved'"); const existingKeys = new Set(existing.rows.map((row) => row.incident_key));
    for (const incident of active) await client.query(`INSERT INTO app_operational_incidents (id, incident_key, category, severity, status, title, summary, source, metadata_json)
      VALUES ($1,$2,$3,$4,'open',$5,$6,$7,$8::jsonb) ON CONFLICT (incident_key) DO UPDATE SET category = EXCLUDED.category,
      severity = EXCLUDED.severity, status = CASE WHEN app_operational_incidents.status = 'resolved' THEN 'open' ELSE app_operational_incidents.status END,
      title = EXCLUDED.title, summary = EXCLUDED.summary, source = EXCLUDED.source, metadata_json = EXCLUDED.metadata_json,
      occurrence_count = app_operational_incidents.occurrence_count + 1, last_seen_at = NOW(), resolved_at = NULL`, [randomUUID(), incident.key, incident.category, incident.severity, incident.title, incident.summary, incident.source, JSON.stringify(incident.metadata)]);
    const activeKeys = active.map((incident) => incident.key);
    if (activeKeys.length) await client.query("UPDATE app_operational_incidents SET status = 'resolved', resolved_at = NOW(), last_seen_at = NOW() WHERE status <> 'resolved' AND NOT (incident_key = ANY($1::text[]))", [activeKeys]);
    else if (existingKeys.size) await client.query("UPDATE app_operational_incidents SET status = 'resolved', resolved_at = NOW(), last_seen_at = NOW() WHERE status <> 'resolved'");
    await client.query("COMMIT");
  } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  if (notify && provider.configured) {
    const [unnotified, supers] = await Promise.all([pool.query("SELECT * FROM app_operational_incidents WHERE status = 'open' AND last_notified_at IS NULL ORDER BY first_seen_at LIMIT 10"), pool.query("SELECT email FROM app_users WHERE role = 'super_user' AND status = 'active' ORDER BY created_at LIMIT 10")]);
    for (const incident of unnotified.rows) for (const account of supers.rows) {
      const outcome = await sendAcquisitionEmail(provider, { to: account.email, idempotencyKey: `dbi-incident-${incident.id}-${account.email}`, message: renderOperationalIncidentEmail({ incident, appUrl: provider.appUrl }) });
      if (outcome.ok) await pool.query("UPDATE app_operational_incidents SET last_notified_at = NOW() WHERE id = $1", [incident.id]);
    }
  }
  return { active: active.length };
}

export async function processPostgresAcquisitionDeliveryQueue(pool, env = process.env, { limit = 100, decryptSecret } = {}) {
  const provider = decryptSecret ? (await storedProvider(pool, env, decryptSecret)).config : deliveryProviderConfig(env); const now = new Date().toISOString();
  if (!provider.configured) { await reconcileOperationalIncidents(pool, provider, { notify: false }); return { provider: provider.provider, configured: false, considered: 0, delivered: 0, failed: 0, deferred: 0 }; }
  const result = await pool.query(`SELECT job.*, saved.name AS saved_view_name, saved.alert_mode, alert.source_record_id,
    alert.change_type, record.record_json, account.email, account.display_name, account.status AS user_status,
    workspace.name AS workspace_name, COALESCE(preference.email_enabled, TRUE) AS email_enabled
    FROM app_acquisition_delivery_jobs job
    JOIN app_acquisition_saved_views saved ON saved.id = job.saved_view_id AND saved.workspace_id = job.workspace_id
    JOIN app_acquisition_alerts alert ON alert.id = job.alert_id AND alert.workspace_id = job.workspace_id
    LEFT JOIN app_acquisition_records record ON record.workspace_id = job.workspace_id AND record.source = alert.source AND record.source_record_id = alert.source_record_id
    JOIN app_users account ON account.user_id = job.user_id JOIN app_workspaces workspace ON workspace.workspace_id = job.workspace_id
    LEFT JOIN app_acquisition_delivery_preferences preference ON preference.workspace_id = job.workspace_id AND preference.user_id = job.user_id
    WHERE job.status IN ('pending_provider','pending') AND job.next_attempt_at <= NOW()
    ORDER BY CASE job.delivery_mode WHEN 'immediate' THEN 0 ELSE 1 END, job.next_attempt_at, job.created_at LIMIT $1`, [Math.max(1, Math.min(200, Number(limit) || 100))]);
  const cancelled = result.rows.filter((row) => !row.email_enabled || row.user_status !== "active" || row.alert_mode === "none");
  for (const row of cancelled) await pool.query("UPDATE app_acquisition_delivery_jobs SET status = 'cancelled', last_error = $1, updated_at = NOW() WHERE id = $2", [!row.email_enabled ? "email_disabled" : row.user_status !== "active" ? "account_inactive" : "alert_disabled", row.id]);
  const deliverable = result.rows.filter((row) => !cancelled.includes(row)); const groups = new Map();
  for (const row of deliverable) {
    const key = row.delivery_mode === "daily" ? `daily:${row.workspace_id}:${row.user_id}:${row.saved_view_id}` : `immediate:${row.id}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  let delivered = 0; let failed = 0;
  for (const group of groups.values()) {
    const first = group[0];
    await pool.query("UPDATE app_acquisition_delivery_jobs SET status = 'sending', updated_at = NOW() WHERE id = ANY($1::uuid[])", [group.map((row) => row.id)]);
    const message = renderAcquisitionEmail({ displayName: first.display_name, workspaceName: first.workspace_name, savedViewName: first.saved_view_name, mode: first.delivery_mode, items: group.map((row) => ({ sourceRecordId: row.source_record_id, changeType: row.change_type, record: row.record_json || {} })), appUrl: provider.appUrl });
    const outcome = await sendAcquisitionEmail(provider, { to: first.email, idempotencyKey: `dbi-acquisition-${first.delivery_mode}-${group.map((row) => row.id).sort().join("-")}`, message });
    await complete(pool, group, outcome, now);
    if (outcome.ok) delivered += group.length; else failed += group.length;
  }
  await reconcileOperationalIncidents(pool, provider);
  return { provider: provider.provider, configured: true, considered: result.rowCount, delivered, failed, deferred: cancelled.length };
}

async function operations(pool, env) {
  const [workspaces, jobs, attempts, deliveryCounts, providerResult, incidents] = await Promise.all([
    pool.query(`SELECT workspace.workspace_id, workspace.name, workspace.status,
      EXISTS (SELECT 1 FROM app_workspace_provider_credentials credential WHERE credential.workspace_id = workspace.workspace_id AND credential.provider = 'sam_gov' AND credential.revoked_at IS NULL) AS keyed,
      COALESCE(config.enabled, TRUE) AS automation_enabled, COALESCE(config.cadence_hours, 24) AS cadence_hours,
      latest.status AS run_status, latest.started_at, latest.completed_at, latest.error_code, latest.records_seen, latest.records_added, latest.records_updated
      FROM app_workspaces workspace LEFT JOIN app_acquisition_source_configs config ON config.workspace_id = workspace.workspace_id
      LEFT JOIN LATERAL (SELECT * FROM app_acquisition_refresh_runs run WHERE run.workspace_id = workspace.workspace_id ORDER BY run.started_at DESC LIMIT 1) latest ON TRUE
      ORDER BY workspace.name LIMIT 100`),
    pool.query(`SELECT job.*, workspace.name AS workspace_name, account.display_name, account.email, saved.name AS saved_view_name
      FROM app_acquisition_delivery_jobs job JOIN app_workspaces workspace ON workspace.workspace_id = job.workspace_id
      JOIN app_users account ON account.user_id = job.user_id JOIN app_acquisition_saved_views saved ON saved.id = job.saved_view_id
      ORDER BY job.updated_at DESC LIMIT 100`),
    pool.query("SELECT * FROM app_acquisition_delivery_attempts ORDER BY attempted_at DESC LIMIT 100"),
    pool.query("SELECT status, COUNT(*)::int AS total FROM app_acquisition_delivery_jobs GROUP BY status"),
    pool.query("SELECT * FROM app_platform_email_provider_config WHERE provider = 'resend' ORDER BY updated_at DESC LIMIT 1"),
    pool.query("SELECT * FROM app_operational_incidents ORDER BY CASE status WHEN 'open' THEN 0 WHEN 'acknowledged' THEN 1 ELSE 2 END, last_seen_at DESC LIMIT 200"),
  ]);
  const provider = publicProvider(providerResult.rows[0], deliveryProviderConfig(env));
  const workspaceRows = workspaces.rows.map((row) => ({ id: row.workspace_id, name: row.name, status: row.status, keyed: row.keyed, automationEnabled: row.automation_enabled, cadenceHours: Number(row.cadence_hours), latestRun: row.started_at ? { status: row.run_status, startedAt: row.started_at, completedAt: row.completed_at, errorCode: row.error_code, recordsSeen: Number(row.records_seen || 0), recordsAdded: Number(row.records_added || 0), recordsUpdated: Number(row.records_updated || 0) } : null }));
  const counts = new Map(deliveryCounts.rows.map((row) => [row.status, Number(row.total || 0)]));
  return { provider, summary: { workspaces: workspaceRows.length, keyed: workspaceRows.filter((row) => row.keyed).length, automated: workspaceRows.filter((row) => row.keyed && row.automationEnabled).length, failedRefreshes: workspaceRows.filter((row) => row.latestRun?.status === "failed").length, pendingDeliveries: (counts.get("pending_provider") || 0) + (counts.get("pending") || 0) + (counts.get("sending") || 0), failedDeliveries: counts.get("failed") || 0 }, workspaces: workspaceRows, jobs: jobs.rows.map(publicJob), attempts: attempts.rows.map((row) => ({ id: row.id, jobId: row.job_id, workspaceId: row.workspace_id, provider: row.provider, status: row.status, providerMessageId: row.provider_message_id, errorCode: row.error_code, attemptedAt: row.attempted_at })), incidents: incidents.rows.map((row) => ({ id: row.id, key: row.incident_key, category: row.category, severity: row.severity, status: row.status, title: row.title, summary: row.summary, source: row.source, occurrenceCount: Number(row.occurrence_count || 1), firstSeenAt: row.first_seen_at, lastSeenAt: row.last_seen_at, acknowledgedAt: row.acknowledged_at, resolvedAt: row.resolved_at, metadata: row.metadata_json || {} })) };
}

export function registerAcquisitionDeliveryRoutes(app, pool, { assertSameOrigin, context, decryptSecret, encryptSecret }) {
  app.get("/api/v1/auth/acquisition/email-provider", async (request, reply) => {
    const current = await context(request, reply); if (!current) return;
    if (current.user.role !== "super_user" || current.user.is_emulating) return reply.code(403).send({ error: "Super user access is required" });
    const result = await pool.query("SELECT * FROM app_platform_email_provider_config WHERE provider = 'resend' ORDER BY updated_at DESC LIMIT 1");
    return { provider: publicProvider(result.rows[0], deliveryProviderConfig(process.env)) };
  });
  app.post("/api/v1/auth/acquisition/email-provider", async (request, reply) => {
    if (!assertSameOrigin(request, reply)) return; const current = await context(request, reply); if (!current) return;
    if (current.user.role !== "super_user" || current.user.is_emulating) return reply.code(403).send({ error: "Super user access is required" });
    const apiKey = String(request.body?.apiKey || "").trim(); const fromName = String(request.body?.fromName || "DBI Acquisition Alerts").trim().slice(0, 120);
    const fromEmail = String(request.body?.fromEmail || "").trim().toLowerCase().slice(0, 254); const replyToEmail = String(request.body?.replyToEmail || "").trim().toLowerCase().slice(0, 254);
    if (apiKey.length < 20 || !validEmail(fromEmail) || (replyToEmail && !validEmail(replyToEmail))) return reply.code(400).send({ error: "A valid Resend key and sender email are required" });
    const encrypted = encryptSecret(apiKey); if (!encrypted) return reply.code(503).send({ error: "Credential encryption is unavailable" });
    const result = await pool.query(`INSERT INTO app_platform_email_provider_config
      (id, provider, label, encrypted_key, key_iv, key_version, key_last_four, from_name, from_email, reply_to_email, verification_status, created_by)
      VALUES ($1,'resend',$2,$3,$4,$5,$6,$7,$8,$9,'unverified',$10)
      ON CONFLICT (provider) DO UPDATE SET label = EXCLUDED.label, encrypted_key = EXCLUDED.encrypted_key, key_iv = EXCLUDED.key_iv,
      key_version = EXCLUDED.key_version, key_last_four = EXCLUDED.key_last_four, from_name = EXCLUDED.from_name, from_email = EXCLUDED.from_email,
      reply_to_email = EXCLUDED.reply_to_email, verification_status = 'unverified', provider_domain_id = NULL, last_verified_at = NULL,
      last_error_code = NULL, updated_at = NOW(), revoked_at = NULL RETURNING *`,
    [randomUUID(), String(request.body?.label || "Resend").trim().slice(0, 100) || "Resend", encrypted.encryptedKey, encrypted.keyIv, encrypted.keyVersion, apiKey.slice(-4), fromName || "DBI Acquisition Alerts", fromEmail, replyToEmail || null, current.user.user_id]);
    return reply.code(201).send({ provider: publicProvider(result.rows[0], deliveryProviderConfig(process.env)) });
  });
  app.delete("/api/v1/auth/acquisition/email-provider", async (request, reply) => {
    if (!assertSameOrigin(request, reply)) return; const current = await context(request, reply); if (!current) return;
    if (current.user.role !== "super_user" || current.user.is_emulating) return reply.code(403).send({ error: "Super user access is required" });
    const result = await pool.query("UPDATE app_platform_email_provider_config SET revoked_at = NOW(), updated_at = NOW(), verification_status = 'revoked' WHERE provider = 'resend' AND revoked_at IS NULL RETURNING *");
    return { provider: publicProvider(result.rows[0], deliveryProviderConfig(process.env)) };
  });
  app.post("/api/v1/auth/acquisition/email-provider/verify", async (request, reply) => {
    if (!assertSameOrigin(request, reply)) return; const current = await context(request, reply); if (!current) return;
    if (current.user.role !== "super_user" || current.user.is_emulating) return reply.code(403).send({ error: "Super user access is required" });
    const stored = await storedProvider(pool, process.env, decryptSecret); const verification = await verifyResendSender(stored.config);
    if (stored.row) await pool.query("UPDATE app_platform_email_provider_config SET verification_status = $1, provider_domain_id = $2, last_verified_at = NOW(), last_error_code = $3, updated_at = NOW() WHERE id = $4", [verification.status, verification.providerDomainId || null, verification.code || null, stored.row.id]);
    const updated = await pool.query("SELECT * FROM app_platform_email_provider_config WHERE provider = 'resend' ORDER BY updated_at DESC LIMIT 1");
    return { verification, provider: publicProvider(updated.rows[0], deliveryProviderConfig(process.env)) };
  });
  app.post("/api/v1/auth/acquisition/email-provider/test", async (request, reply) => {
    if (!assertSameOrigin(request, reply)) return; const current = await context(request, reply); if (!current) return;
    if (current.user.role !== "super_user" || current.user.is_emulating) return reply.code(403).send({ error: "Super user access is required" });
    const stored = await storedProvider(pool, process.env, decryptSecret); const message = { subject: "DBI email delivery test", html: "<!doctype html><html><body><h1>DBI email delivery is ready</h1><p>This protected Resend configuration can deliver acquisition and operations alerts.</p></body></html>", text: "DBI email delivery is ready. This protected Resend configuration can deliver acquisition and operations alerts." };
    const outcome = await sendAcquisitionEmail(stored.config, { to: current.user.email, idempotencyKey: `dbi-provider-test-${randomUUID()}`, message });
    if (stored.row) await pool.query("UPDATE app_platform_email_provider_config SET last_used_at = CASE WHEN $1 THEN NOW() ELSE last_used_at END, last_error_code = $2, updated_at = NOW() WHERE id = $3", [outcome.ok, outcome.code || null, stored.row.id]);
    return outcome.ok ? { sent: true, providerMessageId: outcome.providerMessageId || null } : reply.code(outcome.retryable ? 503 : 422).send({ error: "The provider test could not be delivered", code: outcome.code });
  });
  app.get("/api/v1/auth/acquisition/delivery-preferences", async (request, reply) => {
    const current = await context(request, reply); if (!current) return;
    const result = await pool.query("SELECT email_enabled, updated_at FROM app_acquisition_delivery_preferences WHERE workspace_id = $1 AND user_id = $2", [current.workspaceId, current.user.user_id]);
    return { preferences: { emailEnabled: result.rowCount ? result.rows[0].email_enabled : true, updatedAt: result.rows[0]?.updated_at || null } };
  });
  app.patch("/api/v1/auth/acquisition/delivery-preferences", async (request, reply) => {
    if (!assertSameOrigin(request, reply)) return;
    const current = await context(request, reply); if (!current) return;
    const enabled = request.body?.emailEnabled !== false;
    const result = await pool.query(`INSERT INTO app_acquisition_delivery_preferences (workspace_id, user_id, email_enabled)
      VALUES ($1,$2,$3) ON CONFLICT (workspace_id, user_id) DO UPDATE SET email_enabled = EXCLUDED.email_enabled, updated_at = NOW() RETURNING updated_at`, [current.workspaceId, current.user.user_id, enabled]);
    if (!enabled) await pool.query("UPDATE app_acquisition_delivery_jobs SET status = 'cancelled', last_error = 'email_disabled', updated_at = NOW() WHERE workspace_id = $1 AND user_id = $2 AND status IN ('pending_provider','pending')", [current.workspaceId, current.user.user_id]);
    return { preferences: { emailEnabled: enabled, updatedAt: result.rows[0].updated_at } };
  });
  app.get("/api/v1/auth/acquisition/operations", async (request, reply) => {
    const current = await context(request, reply); if (!current) return;
    if (current.user.role !== "super_user" || current.user.is_emulating) return reply.code(403).send({ error: "Super user access is required" });
    return operations(pool, process.env);
  });
  app.patch("/api/v1/auth/acquisition/delivery-jobs/:id", async (request, reply) => {
    if (!assertSameOrigin(request, reply)) return;
    const current = await context(request, reply); if (!current) return;
    if (current.user.role !== "super_user" || current.user.is_emulating) return reply.code(403).send({ error: "Super user access is required" });
    const action = request.body?.action === "retry" ? "retry" : request.body?.action === "cancel" ? "cancel" : "";
    if (!action) return reply.code(400).send({ error: "A retry or cancel action is required" });
    const status = action === "retry" ? "pending" : "cancelled";
    const result = await pool.query(`UPDATE app_acquisition_delivery_jobs SET status = $1, next_attempt_at = CASE WHEN $1 = 'pending' THEN NOW() ELSE next_attempt_at END,
      last_error = CASE WHEN $1 = 'pending' THEN NULL ELSE 'cancelled_by_operator' END, updated_at = NOW()
      WHERE id = $2 AND status ${action === "retry" ? "IN ('failed','cancelled')" : "IN ('pending_provider','pending','failed')"} RETURNING id, status`, [status, request.params.id]);
    return result.rowCount ? { job: { id: result.rows[0].id, status: result.rows[0].status, changed: true } } : reply.code(404).send({ error: "Delivery job not found or action is not available" });
  });
  app.patch("/api/v1/auth/acquisition/incidents/:id", async (request, reply) => {
    if (!assertSameOrigin(request, reply)) return; const current = await context(request, reply); if (!current) return;
    if (current.user.role !== "super_user" || current.user.is_emulating) return reply.code(403).send({ error: "Super user access is required" });
    const action = ["acknowledge", "resolve", "reopen"].includes(request.body?.action) ? request.body.action : "";
    if (!action) return reply.code(400).send({ error: "An acknowledge, resolve, or reopen action is required" });
    const status = action === "acknowledge" ? "acknowledged" : action === "resolve" ? "resolved" : "open";
    const result = await pool.query(`UPDATE app_operational_incidents SET status = $1,
      acknowledged_at = CASE WHEN $1 = 'acknowledged' THEN NOW() ELSE acknowledged_at END,
      resolved_at = CASE WHEN $1 = 'resolved' THEN NOW() WHEN $1 = 'open' THEN NULL ELSE resolved_at END WHERE id = $2 RETURNING id, status`, [status, request.params.id]);
    return result.rowCount ? { incident: result.rows[0] } : reply.code(404).send({ error: "Operational incident not found" });
  });
}
