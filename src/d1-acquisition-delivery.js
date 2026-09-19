import {
  ACQUISITION_DELIVERY_MAX_ATTEMPTS,
  deliveryBackoffAt,
  deliveryProviderConfig,
  renderAcquisitionEmail,
  sendAcquisitionEmail,
} from "./acquisition-delivery-core.js";

export const ACQUISITION_DELIVERY_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS dbi_acquisition_delivery_preferences (workspace_id TEXT NOT NULL, user_id TEXT NOT NULL,
    email_enabled INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY (workspace_id, user_id))`,
  `CREATE TABLE IF NOT EXISTS dbi_acquisition_delivery_attempts (id TEXT PRIMARY KEY, job_id TEXT NOT NULL, workspace_id TEXT NOT NULL,
    provider TEXT NOT NULL, status TEXT NOT NULL, provider_message_id TEXT NOT NULL DEFAULT '', error_code TEXT NOT NULL DEFAULT '', attempted_at TEXT NOT NULL)`,
  "CREATE INDEX IF NOT EXISTS idx_dbi_acquisition_delivery_attempts_job ON dbi_acquisition_delivery_attempts (job_id, attempted_at DESC)",
  "CREATE INDEX IF NOT EXISTS idx_dbi_acquisition_delivery_attempts_workspace ON dbi_acquisition_delivery_attempts (workspace_id, attempted_at DESC)",
  "CREATE INDEX IF NOT EXISTS idx_dbi_acquisition_delivery_jobs_workspace_status ON dbi_acquisition_delivery_jobs (workspace_id, status, updated_at DESC)",
];

function parsed(value, fallback = {}) { try { return JSON.parse(value || ""); } catch { return fallback; } }

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

export async function processD1AcquisitionDeliveryQueue(db, env, { limit = 100 } = {}) {
  const provider = deliveryProviderConfig(env); const now = new Date().toISOString();
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
    const result = await sendAcquisitionEmail(env, { to: first.email, idempotencyKey: `dbi-acquisition-${first.delivery_mode}-${group.map((row) => row.id).sort().join("-")}`, message });
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
  const [workspaces, credentials, configs, runs, deliveryCounts, jobs, attempts] = await Promise.all([
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
  const provider = deliveryProviderConfig(env);
  const pendingDeliveries = (deliveryCounts.results || []).filter((row) => ["pending_provider", "pending", "sending"].includes(row.status)).reduce((total, row) => total + Number(row.total || 0), 0);
  const failedDeliveries = (deliveryCounts.results || []).filter((row) => row.status === "failed").reduce((total, row) => total + Number(row.total || 0), 0);
  return {
    provider: { name: provider.provider, configured: provider.configured },
    summary: { workspaces: workspaceRows.length, keyed: workspaceRows.filter((row) => row.keyed).length, automated: workspaceRows.filter((row) => row.keyed && row.automationEnabled).length, failedRefreshes: workspaceRows.filter((row) => row.latestRun?.status === "failed").length, pendingDeliveries, failedDeliveries },
    workspaces: workspaceRows,
    jobs: (jobs.results || []).map(publicJob),
    attempts: (attempts.results || []).map((row) => ({ id: row.id, jobId: row.job_id, workspaceId: row.workspace_id, provider: row.provider, status: row.status, providerMessageId: row.provider_message_id || null, errorCode: row.error_code || null, attemptedAt: row.attempted_at })),
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
