import { randomUUID } from "node:crypto";
import {
  ACQUISITION_DELIVERY_MAX_ATTEMPTS,
  deliveryBackoffAt,
  deliveryProviderConfig,
  renderAcquisitionEmail,
  sendAcquisitionEmail,
} from "../src/acquisition-delivery-core.js";

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

export async function processPostgresAcquisitionDeliveryQueue(pool, env = process.env, { limit = 100 } = {}) {
  const provider = deliveryProviderConfig(env); const now = new Date().toISOString();
  if (!provider.configured) return { provider: provider.provider, configured: false, considered: 0, delivered: 0, failed: 0, deferred: 0 };
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
    const outcome = await sendAcquisitionEmail(env, { to: first.email, idempotencyKey: `dbi-acquisition-${first.delivery_mode}-${group.map((row) => row.id).sort().join("-")}`, message });
    await complete(pool, group, outcome, now);
    if (outcome.ok) delivered += group.length; else failed += group.length;
  }
  return { provider: provider.provider, configured: true, considered: result.rowCount, delivered, failed, deferred: cancelled.length };
}

async function operations(pool, env) {
  const [workspaces, jobs, attempts, deliveryCounts] = await Promise.all([
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
  ]);
  const provider = deliveryProviderConfig(env);
  const workspaceRows = workspaces.rows.map((row) => ({ id: row.workspace_id, name: row.name, status: row.status, keyed: row.keyed, automationEnabled: row.automation_enabled, cadenceHours: Number(row.cadence_hours), latestRun: row.started_at ? { status: row.run_status, startedAt: row.started_at, completedAt: row.completed_at, errorCode: row.error_code, recordsSeen: Number(row.records_seen || 0), recordsAdded: Number(row.records_added || 0), recordsUpdated: Number(row.records_updated || 0) } : null }));
  const counts = new Map(deliveryCounts.rows.map((row) => [row.status, Number(row.total || 0)]));
  return { provider: { name: provider.provider, configured: provider.configured }, summary: { workspaces: workspaceRows.length, keyed: workspaceRows.filter((row) => row.keyed).length, automated: workspaceRows.filter((row) => row.keyed && row.automationEnabled).length, failedRefreshes: workspaceRows.filter((row) => row.latestRun?.status === "failed").length, pendingDeliveries: (counts.get("pending_provider") || 0) + (counts.get("pending") || 0) + (counts.get("sending") || 0), failedDeliveries: counts.get("failed") || 0 }, workspaces: workspaceRows, jobs: jobs.rows.map(publicJob), attempts: attempts.rows.map((row) => ({ id: row.id, jobId: row.job_id, workspaceId: row.workspace_id, provider: row.provider, status: row.status, providerMessageId: row.provider_message_id, errorCode: row.error_code, attemptedAt: row.attempted_at })) };
}

export function registerAcquisitionDeliveryRoutes(app, pool, { assertSameOrigin, context }) {
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
}
