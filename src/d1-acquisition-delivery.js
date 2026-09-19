import {
  ACQUISITION_DELIVERY_MAX_ATTEMPTS,
  deliveryBackoffAt,
  deliveryProviderConfig,
  renderOperationalIncidentEmail,
  renderAcquisitionEmail,
  sendAcquisitionEmail,
  verifyResendSender,
} from "./acquisition-delivery-core.js";

export const ACQUISITION_DELIVERY_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS dbi_acquisition_delivery_preferences (workspace_id TEXT NOT NULL, user_id TEXT NOT NULL,
    email_enabled INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY (workspace_id, user_id))`,
  `CREATE TABLE IF NOT EXISTS dbi_acquisition_delivery_attempts (id TEXT PRIMARY KEY, job_id TEXT NOT NULL, workspace_id TEXT NOT NULL,
    provider TEXT NOT NULL, status TEXT NOT NULL, provider_message_id TEXT NOT NULL DEFAULT '', error_code TEXT NOT NULL DEFAULT '', attempted_at TEXT NOT NULL)`,
  "CREATE INDEX IF NOT EXISTS idx_dbi_acquisition_delivery_attempts_job ON dbi_acquisition_delivery_attempts (job_id, attempted_at DESC)",
  "CREATE INDEX IF NOT EXISTS idx_dbi_acquisition_delivery_attempts_workspace ON dbi_acquisition_delivery_attempts (workspace_id, attempted_at DESC)",
  "CREATE INDEX IF NOT EXISTS idx_dbi_acquisition_delivery_jobs_workspace_status ON dbi_acquisition_delivery_jobs (workspace_id, status, updated_at DESC)",
  `CREATE TABLE IF NOT EXISTS dbi_platform_email_provider_config (id TEXT PRIMARY KEY, provider TEXT NOT NULL UNIQUE,
    label TEXT NOT NULL, encrypted_key TEXT NOT NULL, key_iv TEXT NOT NULL, key_version INTEGER NOT NULL,
    key_last_four TEXT NOT NULL, from_name TEXT NOT NULL, from_email TEXT NOT NULL, reply_to_email TEXT NOT NULL DEFAULT '',
    verification_status TEXT NOT NULL DEFAULT 'unverified', provider_domain_id TEXT NOT NULL DEFAULT '', last_verified_at TEXT NOT NULL DEFAULT '',
    last_error_code TEXT NOT NULL DEFAULT '', created_by TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    last_used_at TEXT NOT NULL DEFAULT '', revoked_at TEXT NOT NULL DEFAULT '')`,
  `CREATE TABLE IF NOT EXISTS dbi_operational_incidents (id TEXT PRIMARY KEY, incident_key TEXT NOT NULL UNIQUE, category TEXT NOT NULL,
    severity TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open', title TEXT NOT NULL, summary TEXT NOT NULL, source TEXT NOT NULL,
    metadata_json TEXT NOT NULL DEFAULT '{}', occurrence_count INTEGER NOT NULL DEFAULT 1, first_seen_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL, acknowledged_at TEXT NOT NULL DEFAULT '', resolved_at TEXT NOT NULL DEFAULT '', last_notified_at TEXT NOT NULL DEFAULT '')`,
  "CREATE INDEX IF NOT EXISTS idx_dbi_operational_incidents_status ON dbi_operational_incidents (status, last_seen_at DESC)",
];

function parsed(value, fallback = {}) { try { return JSON.parse(value || ""); } catch { return fallback; } }

function validEmail(value) { return /^[^\s@]+@[^\s@]+$/.test(String(value || "").trim()); }

function publicProvider(row, fallback) {
  if (!row) return { name: "resend", configured: Boolean(fallback?.configured), source: fallback?.source || "unconfigured", status: fallback?.configured ? "configured" : "unconfigured" };
  return { name: "resend", configured: !row.revoked_at, source: "platform_vault", status: row.revoked_at ? "revoked" : row.verification_status || "unverified",
    id: row.id, label: row.label, lastFour: row.key_last_four, fromName: row.from_name, fromEmail: row.from_email,
    replyToEmail: row.reply_to_email || "", lastVerifiedAt: row.last_verified_at || null, lastErrorCode: row.last_error_code || null,
    createdAt: row.created_at, updatedAt: row.updated_at, lastUsedAt: row.last_used_at || null };
}

async function storedProvider(db, env, decryptSecret) {
  const row = await db.prepare("SELECT * FROM dbi_platform_email_provider_config WHERE provider = 'resend' AND revoked_at = '' LIMIT 1").first();
  if (!row) return { row: null, config: deliveryProviderConfig(env) };
  const apiKey = await decryptSecret({ encrypted_key: row.encrypted_key, key_iv: row.key_iv, key_version: row.key_version }, env);
  return { row, config: deliveryProviderConfig(env, { apiKey, fromName: row.from_name, fromEmail: row.from_email, replyToEmail: row.reply_to_email }) };
}

export async function d1EmailProviderMetadata(db, env) {
  const fallback = deliveryProviderConfig(env); const row = await db.prepare("SELECT * FROM dbi_platform_email_provider_config WHERE provider = 'resend' ORDER BY updated_at DESC LIMIT 1").first();
  return publicProvider(row, fallback);
}

export async function saveD1EmailProvider(db, env, actorId, values, encryptSecret) {
  const apiKey = String(values?.apiKey || "").trim(); const fromName = String(values?.fromName || "DBI Acquisition Alerts").trim().slice(0, 120);
  const fromEmail = String(values?.fromEmail || "").trim().toLowerCase().slice(0, 254); const replyToEmail = String(values?.replyToEmail || "").trim().toLowerCase().slice(0, 254);
  if (apiKey.length < 20 || !validEmail(fromEmail) || (replyToEmail && !validEmail(replyToEmail))) return { error: "A valid Resend key and sender email are required", status: 400 };
  const encrypted = await encryptSecret(apiKey, env); if (!encrypted) return { error: "Credential encryption is unavailable", status: 503 };
  const now = new Date().toISOString(); const existing = await db.prepare("SELECT id, created_at FROM dbi_platform_email_provider_config WHERE provider = 'resend' LIMIT 1").first(); const id = existing?.id || crypto.randomUUID();
  await db.prepare(`INSERT INTO dbi_platform_email_provider_config
    (id, provider, label, encrypted_key, key_iv, key_version, key_last_four, from_name, from_email, reply_to_email, verification_status, created_by, created_at, updated_at, revoked_at)
    VALUES (?,'resend',?,?,?,?,?,?,?,?, 'unverified',?,?,?, '') ON CONFLICT(provider) DO UPDATE SET label = excluded.label,
    encrypted_key = excluded.encrypted_key, key_iv = excluded.key_iv, key_version = excluded.key_version, key_last_four = excluded.key_last_four,
    from_name = excluded.from_name, from_email = excluded.from_email, reply_to_email = excluded.reply_to_email,
    verification_status = 'unverified', provider_domain_id = '', last_verified_at = '', last_error_code = '', updated_at = excluded.updated_at, revoked_at = ''`)
    .bind(id, String(values?.label || "Resend").trim().slice(0, 100) || "Resend", encrypted.encryptedKey, encrypted.keyIv, encrypted.keyVersion, apiKey.slice(-4), fromName || "DBI Acquisition Alerts", fromEmail, replyToEmail, actorId, existing?.created_at || now, now).run();
  return { provider: await d1EmailProviderMetadata(db, env) };
}

export async function revokeD1EmailProvider(db, env) {
  const now = new Date().toISOString(); await db.prepare("UPDATE dbi_platform_email_provider_config SET revoked_at = ?, updated_at = ?, verification_status = 'revoked' WHERE provider = 'resend' AND revoked_at = ''").bind(now, now).run();
  return { provider: await d1EmailProviderMetadata(db, env) };
}

export async function verifyD1EmailProvider(db, env, decryptSecret) {
  const stored = await storedProvider(db, env, decryptSecret); const result = await verifyResendSender(stored.config); const now = new Date().toISOString();
  if (stored.row) await db.prepare("UPDATE dbi_platform_email_provider_config SET verification_status = ?, provider_domain_id = ?, last_verified_at = ?, last_error_code = ?, updated_at = ? WHERE id = ?")
    .bind(result.status, result.providerDomainId || "", now, result.code || "", now, stored.row.id).run();
  return { verification: result, provider: await d1EmailProviderMetadata(db, env) };
}

export async function sendD1EmailProviderTest(db, env, decryptSecret, recipient) {
  const stored = await storedProvider(db, env, decryptSecret); const message = { subject: "DBI email delivery test", html: "<!doctype html><html><body><h1>DBI email delivery is ready</h1><p>This protected Resend configuration can deliver acquisition and operations alerts.</p></body></html>", text: "DBI email delivery is ready. This protected Resend configuration can deliver acquisition and operations alerts." };
  const result = await sendAcquisitionEmail(stored.config, { to: recipient, idempotencyKey: `dbi-provider-test-${crypto.randomUUID()}`, message }); const now = new Date().toISOString();
  if (stored.row) await db.prepare("UPDATE dbi_platform_email_provider_config SET last_used_at = ?, last_error_code = ?, updated_at = ? WHERE id = ?").bind(result.ok ? now : stored.row.last_used_at || "", result.code || "", now, stored.row.id).run();
  return result;
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

async function deliveryRows(db, now, limit) {
  const result = await db.prepare(`SELECT job.*, saved.name AS saved_view_name, saved.alert_mode, alert.source_record_id,
    alert.change_type, record.record_json, user.email, user.display_name, user.status AS user_status,
    workspace.name AS workspace_name, COALESCE(preference.email_enabled, 1) AS email_enabled
    FROM dbi_acquisition_delivery_jobs job
    JOIN dbi_acquisition_saved_views saved ON saved.id = job.saved_view_id AND saved.workspace_id = job.workspace_id
    JOIN dbi_acquisition_alerts alert ON alert.id = job.alert_id AND alert.workspace_id = job.workspace_id
    LEFT JOIN dbi_acquisition_records record ON record.workspace_id = job.workspace_id AND record.source = alert.source AND record.source_record_id = alert.source_record_id
    JOIN dbi_users user ON user.user_id = job.user_id
    JOIN dbi_workspaces workspace ON workspace.workspace_id = job.workspace_id
    LEFT JOIN dbi_acquisition_delivery_preferences preference ON preference.workspace_id = job.workspace_id AND preference.user_id = job.user_id
    WHERE job.status IN ('pending_provider','pending') AND job.next_attempt_at <= ?
    ORDER BY CASE job.delivery_mode WHEN 'immediate' THEN 0 ELSE 1 END, job.next_attempt_at, job.created_at LIMIT ?`).bind(now, limit).all();
  return result.results || [];
}

async function recordAttempt(db, rows, result, now) {
  const statements = [];
  for (const row of rows) statements.push(db.prepare(`INSERT INTO dbi_acquisition_delivery_attempts
    (id, job_id, workspace_id, provider, status, provider_message_id, error_code, attempted_at) VALUES (?,?,?,?,?,?,?,?)`)
    .bind(crypto.randomUUID(), row.id, row.workspace_id, "resend", result.ok ? "delivered" : "failed", result.providerMessageId || "", result.code || "", now));
  await db.batch(statements);
}

async function completeGroup(db, rows, result, now) {
  await recordAttempt(db, rows, result, now);
  const statements = [];
  for (const row of rows) {
    const attempts = Number(row.attempt_count || 0) + 1;
    if (result.ok) statements.push(db.prepare("UPDATE dbi_acquisition_delivery_jobs SET status = 'delivered', attempt_count = ?, last_error = '', updated_at = ?, delivered_at = ? WHERE id = ?").bind(attempts, now, now, row.id));
    else {
      const retryable = result.retryable && attempts < ACQUISITION_DELIVERY_MAX_ATTEMPTS;
      const retryAt = result.retryAfterSeconds ? new Date(Date.now() + result.retryAfterSeconds * 1_000).toISOString() : deliveryBackoffAt(attempts, new Date(now));
      statements.push(db.prepare("UPDATE dbi_acquisition_delivery_jobs SET status = ?, attempt_count = ?, next_attempt_at = ?, last_error = ?, updated_at = ? WHERE id = ?")
        .bind(retryable ? "pending" : "failed", attempts, retryAt, result.code || "provider_unavailable", now, row.id));
    }
  }
  await db.batch(statements);
}

export async function processD1AcquisitionDeliveryQueue(db, env, { limit = 100, decryptSecret } = {}) {
  const provider = decryptSecret ? (await storedProvider(db, env, decryptSecret)).config : deliveryProviderConfig(env); const now = new Date().toISOString();
  if (!provider.configured) return { provider: provider.provider, configured: false, considered: 0, delivered: 0, failed: 0, deferred: 0 };
  const rows = await deliveryRows(db, now, Math.max(1, Math.min(200, Number(limit) || 100)));
  const cancelled = rows.filter((row) => !Number(row.email_enabled) || row.user_status !== "active" || row.alert_mode === "none");
  if (cancelled.length) await db.batch(cancelled.map((row) => db.prepare("UPDATE dbi_acquisition_delivery_jobs SET status = 'cancelled', last_error = ?, updated_at = ? WHERE id = ?").bind(!Number(row.email_enabled) ? "email_disabled" : row.user_status !== "active" ? "account_inactive" : "alert_disabled", now, row.id)));
  const deliverable = rows.filter((row) => !cancelled.includes(row));
  const groups = new Map();
  for (const row of deliverable) {
    const key = row.delivery_mode === "daily" ? `daily:${row.workspace_id}:${row.user_id}:${row.saved_view_id}` : `immediate:${row.id}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  let delivered = 0; let failed = 0;
  for (const group of groups.values()) {
    await db.batch(group.map((row) => db.prepare("UPDATE dbi_acquisition_delivery_jobs SET status = 'sending', updated_at = ? WHERE id = ? AND status IN ('pending_provider','pending')").bind(now, row.id)));
    const first = group[0];
    const message = renderAcquisitionEmail({ displayName: first.display_name, workspaceName: first.workspace_name, savedViewName: first.saved_view_name, mode: first.delivery_mode, items: group.map((row) => ({ sourceRecordId: row.source_record_id, changeType: row.change_type, record: parsed(row.record_json) })), appUrl: provider.appUrl });
    const result = await sendAcquisitionEmail(provider, { to: first.email, idempotencyKey: `dbi-acquisition-${first.delivery_mode}-${group.map((row) => row.id).sort().join("-")}`, message });
    await completeGroup(db, group, result, now);
    if (result.ok) delivered += group.length; else failed += group.length;
  }
  return { provider: provider.provider, configured: true, considered: rows.length, delivered, failed, deferred: cancelled.length };
}

export async function d1DeliveryPreferences(db, workspaceId, userId) {
  const row = await db.prepare("SELECT email_enabled, updated_at FROM dbi_acquisition_delivery_preferences WHERE workspace_id = ? AND user_id = ?").bind(workspaceId, userId).first();
  return { emailEnabled: row ? Boolean(row.email_enabled) : true, updatedAt: row?.updated_at || null };
}

export async function updateD1DeliveryPreferences(db, workspaceId, userId, emailEnabled) {
  const now = new Date().toISOString();
  await db.prepare(`INSERT INTO dbi_acquisition_delivery_preferences (workspace_id, user_id, email_enabled, created_at, updated_at)
    VALUES (?,?,?,?,?) ON CONFLICT(workspace_id, user_id) DO UPDATE SET email_enabled = excluded.email_enabled, updated_at = excluded.updated_at`)
    .bind(workspaceId, userId, emailEnabled ? 1 : 0, now, now).run();
  if (!emailEnabled) await db.prepare("UPDATE dbi_acquisition_delivery_jobs SET status = 'cancelled', last_error = 'email_disabled', updated_at = ? WHERE workspace_id = ? AND user_id = ? AND status IN ('pending_provider','pending')").bind(now, workspaceId, userId).run();
  return { emailEnabled: Boolean(emailEnabled), updatedAt: now };
}

export async function d1AcquisitionOperations(db, env) {
  const [workspaces, credentials, configs, runs, deliveryCounts, jobs, attempts, providerRow, incidents] = await Promise.all([
    db.prepare("SELECT workspace_id, name, status FROM dbi_workspaces ORDER BY name LIMIT 100").all(),
    db.prepare("SELECT workspace_id, last_used_at FROM dbi_workspace_provider_credentials WHERE provider = 'sam_gov' AND revoked_at = ''").all(),
    db.prepare("SELECT workspace_id, enabled, cadence_hours, updated_at FROM dbi_acquisition_source_configs").all(),
    db.prepare(`SELECT run.* FROM dbi_acquisition_refresh_runs run JOIN
      (SELECT workspace_id, MAX(started_at) AS latest FROM dbi_acquisition_refresh_runs GROUP BY workspace_id) chosen
      ON chosen.workspace_id = run.workspace_id AND chosen.latest = run.started_at ORDER BY run.started_at DESC LIMIT 100`).all(),
    db.prepare("SELECT workspace_id, status, COUNT(*) AS total FROM dbi_acquisition_delivery_jobs GROUP BY workspace_id, status").all(),
    db.prepare(`SELECT job.*, workspace.name AS workspace_name, user.display_name, user.email, saved.name AS saved_view_name
      FROM dbi_acquisition_delivery_jobs job JOIN dbi_workspaces workspace ON workspace.workspace_id = job.workspace_id
      JOIN dbi_users user ON user.user_id = job.user_id JOIN dbi_acquisition_saved_views saved ON saved.id = job.saved_view_id
      ORDER BY job.updated_at DESC LIMIT 100`).all(),
    db.prepare("SELECT * FROM dbi_acquisition_delivery_attempts ORDER BY attempted_at DESC LIMIT 100").all(),
    db.prepare("SELECT * FROM dbi_platform_email_provider_config WHERE provider = 'resend' ORDER BY updated_at DESC LIMIT 1").first(),
    db.prepare("SELECT * FROM dbi_operational_incidents ORDER BY CASE status WHEN 'open' THEN 0 WHEN 'acknowledged' THEN 1 ELSE 2 END, last_seen_at DESC LIMIT 200").all(),
  ]);
  const credentialByWorkspace = new Map((credentials.results || []).map((row) => [row.workspace_id, row]));
  const configByWorkspace = new Map((configs.results || []).map((row) => [row.workspace_id, row]));
  const runByWorkspace = new Map((runs.results || []).map((row) => [row.workspace_id, row]));
  const countsByWorkspace = new Map();
  for (const row of deliveryCounts.results || []) countsByWorkspace.set(row.workspace_id, { ...(countsByWorkspace.get(row.workspace_id) || {}), [row.status]: Number(row.total || 0) });
  const workspaceRows = (workspaces.results || []).map((workspace) => {
    const credential = credentialByWorkspace.get(workspace.workspace_id); const config = configByWorkspace.get(workspace.workspace_id); const latest = runByWorkspace.get(workspace.workspace_id); const counts = countsByWorkspace.get(workspace.workspace_id) || {};
    return { id: workspace.workspace_id, name: workspace.name, status: workspace.status, keyed: Boolean(credential), automationEnabled: config ? Boolean(config.enabled) : true, cadenceHours: Number(config?.cadence_hours || 24), lastCredentialUseAt: credential?.last_used_at || null, latestRun: latest ? { status: latest.status, startedAt: latest.started_at, completedAt: latest.completed_at || null, errorCode: latest.error_code || null, recordsSeen: Number(latest.records_seen || 0), recordsAdded: Number(latest.records_added || 0), recordsUpdated: Number(latest.records_updated || 0) } : null, delivery: counts };
  });
  const provider = publicProvider(providerRow, deliveryProviderConfig(env));
  const pendingDeliveries = (deliveryCounts.results || []).filter((row) => ["pending_provider", "pending", "sending"].includes(row.status)).reduce((total, row) => total + Number(row.total || 0), 0);
  const failedDeliveries = (deliveryCounts.results || []).filter((row) => row.status === "failed").reduce((total, row) => total + Number(row.total || 0), 0);
  return {
    provider,
    summary: { workspaces: workspaceRows.length, keyed: workspaceRows.filter((row) => row.keyed).length, automated: workspaceRows.filter((row) => row.keyed && row.automationEnabled).length, failedRefreshes: workspaceRows.filter((row) => row.latestRun?.status === "failed").length, pendingDeliveries, failedDeliveries },
    workspaces: workspaceRows,
    jobs: (jobs.results || []).map(publicJob),
    attempts: (attempts.results || []).map((row) => ({ id: row.id, jobId: row.job_id, workspaceId: row.workspace_id, provider: row.provider, status: row.status, providerMessageId: row.provider_message_id || null, errorCode: row.error_code || null, attemptedAt: row.attempted_at })),
    incidents: (incidents.results || []).map((row) => ({ id: row.id, key: row.incident_key, category: row.category, severity: row.severity, status: row.status, title: row.title, summary: row.summary, source: row.source, occurrenceCount: Number(row.occurrence_count || 1), firstSeenAt: row.first_seen_at, lastSeenAt: row.last_seen_at, acknowledgedAt: row.acknowledged_at || null, resolvedAt: row.resolved_at || null, metadata: parsed(row.metadata_json) })),
  };
}

export async function mutateD1DeliveryJob(db, id, action) {
  const row = await db.prepare("SELECT id, status FROM dbi_acquisition_delivery_jobs WHERE id = ?").bind(id).first();
  if (!row) return null;
  const now = new Date().toISOString();
  if (action === "retry" && ["failed", "cancelled"].includes(row.status)) await db.prepare("UPDATE dbi_acquisition_delivery_jobs SET status = 'pending', next_attempt_at = ?, last_error = '', updated_at = ? WHERE id = ?").bind(now, now, id).run();
  else if (action === "cancel" && ["pending_provider", "pending", "failed"].includes(row.status)) await db.prepare("UPDATE dbi_acquisition_delivery_jobs SET status = 'cancelled', last_error = 'cancelled_by_operator', updated_at = ? WHERE id = ?").bind(now, id).run();
  else return { id, status: row.status, changed: false };
  const updated = await db.prepare("SELECT id, status FROM dbi_acquisition_delivery_jobs WHERE id = ?").bind(id).first();
  return { id, status: updated.status, changed: true };
}

export async function reconcileD1OperationalIncidents(db, env, { decryptSecret, notify = true } = {}) {
  const now = new Date().toISOString(); const hourAgo = new Date(Date.now() - 3_600_000).toISOString();
  const [failedDelivery, pendingDelivery, failedRuns, clientErrors] = await Promise.all([
    db.prepare("SELECT COUNT(*) AS total FROM dbi_acquisition_delivery_jobs WHERE status = 'failed'").first(),
    db.prepare("SELECT COUNT(*) AS total FROM dbi_acquisition_delivery_jobs WHERE status = 'pending_provider'").first(),
    db.prepare(`SELECT run.workspace_id, workspace.name, run.error_code FROM dbi_acquisition_refresh_runs run JOIN dbi_workspaces workspace ON workspace.workspace_id = run.workspace_id
      JOIN (SELECT workspace_id, MAX(started_at) latest FROM dbi_acquisition_refresh_runs GROUP BY workspace_id) chosen ON chosen.workspace_id = run.workspace_id AND chosen.latest = run.started_at WHERE run.status = 'failed'`).all(),
    db.prepare("SELECT COUNT(*) AS total FROM dbi_api_request_log WHERE request_kind = 'client_error' AND completed_at >= ?").bind(hourAgo).first(),
  ]);
  const stored = decryptSecret ? await storedProvider(db, env, decryptSecret) : { config: deliveryProviderConfig(env), row: null }; const active = [];
  if (Number(failedDelivery?.total || 0)) active.push({ key: "delivery:dead-letter", category: "delivery", severity: "critical", title: "Outbound deliveries require recovery", summary: `${Number(failedDelivery.total)} delivery job${Number(failedDelivery.total) === 1 ? "" : "s"} reached the retry ceiling.`, source: "delivery", metadata: { count: Number(failedDelivery.total) } });
  if (!stored.config.configured && Number(pendingDelivery?.total || 0)) active.push({ key: "delivery:provider-unconfigured", category: "delivery", severity: "warning", title: "Outbound email provider is not configured", summary: `${Number(pendingDelivery.total)} retained delivery job${Number(pendingDelivery.total) === 1 ? " is" : "s are"} waiting for a protected provider.`, source: "delivery", metadata: { count: Number(pendingDelivery.total) } });
  for (const row of failedRuns.results || []) active.push({ key: `refresh:${row.workspace_id}`, category: "source", severity: "critical", title: `${row.name} refresh failed`, summary: `The latest acquisition refresh failed with ${row.error_code || "source_unavailable"}.`, source: "scheduler", metadata: { workspaceId: row.workspace_id, errorCode: row.error_code || "source_unavailable" } });
  if (Number(clientErrors?.total || 0) >= 3) active.push({ key: "client-errors:repeated", category: "client", severity: "warning", title: "Repeated client errors detected", summary: `${Number(clientErrors.total)} authenticated client errors were retained in the last hour.`, source: "browser", metadata: { count: Number(clientErrors.total), windowHours: 1 } });
  const existingResult = await db.prepare("SELECT * FROM dbi_operational_incidents WHERE status <> 'resolved'").all(); const existing = new Map((existingResult.results || []).map((row) => [row.incident_key, row]));
  for (const incident of active) {
    const prior = existing.get(incident.key); const id = prior?.id || crypto.randomUUID();
    await db.prepare(`INSERT INTO dbi_operational_incidents (id, incident_key, category, severity, status, title, summary, source, metadata_json, occurrence_count, first_seen_at, last_seen_at)
      VALUES (?,?,?,?,? ,?,?,?,?,?,?,?) ON CONFLICT(incident_key) DO UPDATE SET category = excluded.category, severity = excluded.severity,
      status = CASE WHEN dbi_operational_incidents.status = 'resolved' THEN 'open' ELSE dbi_operational_incidents.status END, title = excluded.title,
      summary = excluded.summary, source = excluded.source, metadata_json = excluded.metadata_json,
      occurrence_count = dbi_operational_incidents.occurrence_count + 1, last_seen_at = excluded.last_seen_at, resolved_at = ''`)
      .bind(id, incident.key, incident.category, incident.severity, prior?.status === "acknowledged" ? "acknowledged" : "open", incident.title, incident.summary, incident.source, JSON.stringify(incident.metadata), 1, prior?.first_seen_at || now, now).run();
  }
  const keys = new Set(active.map((incident) => incident.key));
  for (const row of existing.values()) if (!keys.has(row.incident_key)) await db.prepare("UPDATE dbi_operational_incidents SET status = 'resolved', resolved_at = ?, last_seen_at = ? WHERE id = ?").bind(now, now, row.id).run();
  if (notify && stored.config.configured) {
    const unnotified = await db.prepare("SELECT * FROM dbi_operational_incidents WHERE status = 'open' AND last_notified_at = '' ORDER BY first_seen_at LIMIT 10").all();
    const supers = await db.prepare("SELECT email FROM dbi_users WHERE role = 'super_user' AND status = 'active' ORDER BY created_at LIMIT 10").all();
    for (const row of unnotified.results || []) for (const account of supers.results || []) {
      const outcome = await sendAcquisitionEmail(stored.config, { to: account.email, idempotencyKey: `dbi-incident-${row.id}-${account.email}`, message: renderOperationalIncidentEmail({ incident: row, appUrl: stored.config.appUrl }) });
      if (outcome.ok) await db.prepare("UPDATE dbi_operational_incidents SET last_notified_at = ? WHERE id = ?").bind(now, row.id).run();
    }
  }
  return { active: active.length };
}

export async function mutateD1OperationalIncident(db, id, action) {
  const status = action === "acknowledge" ? "acknowledged" : action === "resolve" ? "resolved" : action === "reopen" ? "open" : ""; if (!status) return null;
  const now = new Date().toISOString(); const result = await db.prepare(`UPDATE dbi_operational_incidents SET status = ?, acknowledged_at = CASE WHEN ? = 'acknowledged' THEN ? ELSE acknowledged_at END,
    resolved_at = CASE WHEN ? = 'resolved' THEN ? WHEN ? = 'open' THEN '' ELSE resolved_at END WHERE id = ?`).bind(status, status, now, status, now, status, id).run();
  return result.meta.changes ? { id, status } : null;
}
