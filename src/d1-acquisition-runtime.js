import { cleanText } from "./security-policy.js";
import {
  ACQUISITION_SOURCE,
  acquisitionNextDueAt,
  changedFields,
  exactLifecycleLinks,
  fetchSamOpportunities,
  matchesSavedAcquisitionView,
  normalizeAcquisitionConfig,
  normalizeSavedAcquisitionView,
  sha256,
  stableJson,
} from "./acquisition-runtime-core.js";
import { deliveryJobSchedule } from "./acquisition-delivery-core.js";
import {
  ACQUISITION_DELIVERY_SCHEMA,
  d1AcquisitionOperations,
  d1DeliveryPreferences,
  mutateD1DeliveryJob,
  processD1AcquisitionDeliveryQueue,
  updateD1DeliveryPreferences,
} from "./d1-acquisition-delivery.js";

export const ACQUISITION_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS dbi_acquisition_refresh_runs (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, source TEXT NOT NULL, status TEXT NOT NULL, trigger_type TEXT NOT NULL,
    window_start TEXT NOT NULL DEFAULT '', window_end TEXT NOT NULL DEFAULT '', records_seen INTEGER NOT NULL DEFAULT 0, records_added INTEGER NOT NULL DEFAULT 0,
    records_updated INTEGER NOT NULL DEFAULT 0, links_added INTEGER NOT NULL DEFAULT 0, error_code TEXT NOT NULL DEFAULT '', error_message TEXT NOT NULL DEFAULT '',
    metadata_json TEXT NOT NULL DEFAULT '{}', started_at TEXT NOT NULL, completed_at TEXT NOT NULL DEFAULT '')`,
  "CREATE INDEX IF NOT EXISTS idx_dbi_acquisition_refresh_runs_workspace ON dbi_acquisition_refresh_runs (workspace_id, source, started_at DESC)",
  `CREATE TABLE IF NOT EXISTS dbi_acquisition_records (workspace_id TEXT NOT NULL, source TEXT NOT NULL, source_record_id TEXT NOT NULL,
    solicitation_number TEXT NOT NULL DEFAULT '', lifecycle_stage TEXT NOT NULL, content_hash TEXT NOT NULL, record_json TEXT NOT NULL,
    first_seen_at TEXT NOT NULL, last_seen_at TEXT NOT NULL, last_changed_at TEXT NOT NULL, removed_at TEXT NOT NULL DEFAULT '',
    PRIMARY KEY (workspace_id, source, source_record_id))`,
  "CREATE INDEX IF NOT EXISTS idx_dbi_acquisition_records_workspace ON dbi_acquisition_records (workspace_id, last_changed_at DESC)",
  "CREATE INDEX IF NOT EXISTS idx_dbi_acquisition_records_solicitation ON dbi_acquisition_records (workspace_id, solicitation_number)",
  `CREATE TABLE IF NOT EXISTS dbi_acquisition_observations (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, source TEXT NOT NULL, source_record_id TEXT NOT NULL,
    refresh_run_id TEXT NOT NULL, content_hash TEXT NOT NULL, record_json TEXT NOT NULL, observed_at TEXT NOT NULL,
    UNIQUE (workspace_id, source, source_record_id, content_hash))`,
  "CREATE INDEX IF NOT EXISTS idx_dbi_acquisition_observations_record ON dbi_acquisition_observations (workspace_id, source, source_record_id, observed_at DESC)",
  `CREATE TABLE IF NOT EXISTS dbi_acquisition_changes (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, source TEXT NOT NULL, source_record_id TEXT NOT NULL,
    refresh_run_id TEXT NOT NULL, change_type TEXT NOT NULL, changed_fields_json TEXT NOT NULL DEFAULT '[]', changed_at TEXT NOT NULL)`,
  "CREATE INDEX IF NOT EXISTS idx_dbi_acquisition_changes_workspace ON dbi_acquisition_changes (workspace_id, changed_at DESC)",
  `CREATE TABLE IF NOT EXISTS dbi_acquisition_lifecycle_links (workspace_id TEXT NOT NULL, from_source TEXT NOT NULL, from_record_id TEXT NOT NULL,
    to_source TEXT NOT NULL, to_record_id TEXT NOT NULL, relationship TEXT NOT NULL, basis TEXT NOT NULL, identifier TEXT NOT NULL, created_at TEXT NOT NULL,
    PRIMARY KEY (workspace_id, from_source, from_record_id, to_source, to_record_id, relationship))`,
  "CREATE INDEX IF NOT EXISTS idx_dbi_acquisition_lifecycle_links_workspace ON dbi_acquisition_lifecycle_links (workspace_id, identifier)",
  `CREATE TABLE IF NOT EXISTS dbi_acquisition_saved_views (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, user_id TEXT NOT NULL, name TEXT NOT NULL,
    query_json TEXT NOT NULL DEFAULT '{}', alert_mode TEXT NOT NULL DEFAULT 'none', last_opened_at TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
  "CREATE INDEX IF NOT EXISTS idx_dbi_acquisition_saved_views_owner ON dbi_acquisition_saved_views (workspace_id, user_id, updated_at DESC)",
  `CREATE TABLE IF NOT EXISTS dbi_acquisition_alerts (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, user_id TEXT NOT NULL, saved_view_id TEXT NOT NULL,
    source TEXT NOT NULL, source_record_id TEXT NOT NULL, refresh_run_id TEXT NOT NULL, change_type TEXT NOT NULL, matched_at TEXT NOT NULL, read_at TEXT NOT NULL DEFAULT '',
    UNIQUE (saved_view_id, source, source_record_id, refresh_run_id))`,
  "CREATE INDEX IF NOT EXISTS idx_dbi_acquisition_alerts_owner ON dbi_acquisition_alerts (workspace_id, user_id, read_at, matched_at DESC)",
  `CREATE TABLE IF NOT EXISTS dbi_acquisition_source_configs (workspace_id TEXT PRIMARY KEY, enabled INTEGER NOT NULL DEFAULT 1,
    cadence_hours INTEGER NOT NULL DEFAULT 24, config_json TEXT NOT NULL DEFAULT '{}', updated_by TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
  "CREATE INDEX IF NOT EXISTS idx_dbi_acquisition_source_configs_due ON dbi_acquisition_source_configs (enabled, cadence_hours, updated_at)",
  `CREATE TABLE IF NOT EXISTS dbi_acquisition_delivery_jobs (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, user_id TEXT NOT NULL,
    saved_view_id TEXT NOT NULL, alert_id TEXT NOT NULL, delivery_mode TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending_provider',
    attempt_count INTEGER NOT NULL DEFAULT 0, next_attempt_at TEXT NOT NULL, last_error TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL, delivered_at TEXT NOT NULL DEFAULT '', UNIQUE(alert_id, delivery_mode))`,
  "CREATE INDEX IF NOT EXISTS idx_dbi_acquisition_delivery_jobs_queue ON dbi_acquisition_delivery_jobs (status, next_attempt_at)",
  ...ACQUISITION_DELIVERY_SCHEMA,
];

function parsed(value, fallback) { try { return JSON.parse(value || ""); } catch { return fallback; } }
function view(row) { const spec = parsed(row.query_json, {}); return { id: row.id, name: row.name, query: spec.query || "", filters: spec.filters || {}, alertMode: row.alert_mode, unreadCount: Number(row.unread_count || 0), latestMatchAt: row.latest_match_at || null, lastOpenedAt: row.last_opened_at, savedAt: row.created_at, updatedAt: row.updated_at }; }
function run(row) { return row ? { id: row.id, source: row.source, status: row.status, trigger: row.trigger_type, recordsSeen: Number(row.records_seen || 0), recordsAdded: Number(row.records_added || 0), recordsUpdated: Number(row.records_updated || 0), linksAdded: Number(row.links_added || 0), errorCode: row.error_code || null, errorMessage: row.error_message || null, startedAt: row.started_at, completedAt: row.completed_at || null } : null; }
function record(row) { return { ...parsed(row.record_json, {}), firstSeenAt: row.first_seen_at, lastSeenAt: row.last_seen_at, lastChangedAt: row.last_changed_at, removedAt: row.removed_at || null }; }

async function sourceConfig(db, workspaceId) {
  const row = await db.prepare("SELECT * FROM dbi_acquisition_source_configs WHERE workspace_id = ?").bind(workspaceId).first();
  return normalizeAcquisitionConfig(row ? { ...parsed(row.config_json, {}), enabled: Boolean(row.enabled), cadenceHours: row.cadence_hours } : {});
}

async function status(db, workspaceId) {
  const [credential, latest, counts, quality, linkCount, config, delivery] = await Promise.all([
    db.prepare("SELECT label, secret_last_four, last_used_at FROM dbi_workspace_provider_credentials WHERE workspace_id = ? AND provider = 'sam_gov' AND revoked_at = '' LIMIT 1").bind(workspaceId).first(),
    db.prepare("SELECT * FROM dbi_acquisition_refresh_runs WHERE workspace_id = ? AND source = ? ORDER BY started_at DESC LIMIT 1").bind(workspaceId, ACQUISITION_SOURCE).first(),
    db.prepare(`SELECT COUNT(*) AS records, SUM(CASE WHEN removed_at = '' THEN 1 ELSE 0 END) AS active,
      SUM(CASE WHEN last_changed_at >= ? THEN 1 ELSE 0 END) AS changed_today FROM dbi_acquisition_records WHERE workspace_id = ?`).bind(new Date(Date.now() - 86_400_000).toISOString(), workspaceId).first(),
    db.prepare(`SELECT COUNT(*) AS total,
      SUM(CASE WHEN solicitation_number = '' THEN 1 ELSE 0 END) AS missing_identifier,
      SUM(CASE WHEN json_extract(record_json, '$.office') IS NULL OR json_extract(record_json, '$.office') = '' THEN 1 ELSE 0 END) AS missing_office,
      SUM(CASE WHEN json_extract(record_json, '$.naicsCode') IS NULL OR json_extract(record_json, '$.naicsCode') = '' THEN 1 ELSE 0 END) AS missing_naics,
      SUM(CASE WHEN last_seen_at < ? AND removed_at = '' THEN 1 ELSE 0 END) AS stale
      FROM dbi_acquisition_records WHERE workspace_id = ?`).bind(new Date(Date.now() - 7 * 86_400_000).toISOString(), workspaceId).first(),
    db.prepare("SELECT COUNT(*) AS total FROM dbi_acquisition_lifecycle_links WHERE workspace_id = ?").bind(workspaceId).first(),
    sourceConfig(db, workspaceId),
    db.prepare(`SELECT COUNT(*) AS total,
      SUM(CASE WHEN status = 'pending_provider' THEN 1 ELSE 0 END) AS pending_provider,
      SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed
      FROM dbi_acquisition_delivery_jobs WHERE workspace_id = ?`).bind(workspaceId).first(),
  ]);
  const completed = Date.parse(latest?.completed_at || latest?.started_at || "");
  const nextDueAt = acquisitionNextDueAt(latest?.completed_at, config);
  return {
    source: "SAM.gov", credential: credential ? { configured: true, label: credential.label, lastFour: credential.secret_last_four, lastUsedAt: credential.last_used_at || null } : { configured: false },
    config,
    refresh: { latest: run(latest), due: config.enabled && (!Number.isFinite(completed) || !nextDueAt || Date.now() >= Date.parse(nextDueAt)), nextDueAt, schedule: `Every ${config.cadenceHours} hours`, execution: "cloudflare-cron-with-first-access-fallback", eligible: Boolean(credential && config.enabled) },
    durableHistory: { records: Number(counts?.records || 0), active: Number(counts?.active || 0), changedToday: Number(counts?.changed_today || 0), lifecycleLinks: Number(linkCount?.total || 0) },
    quality: Object.fromEntries(Object.entries(quality || {}).map(([key, value]) => [key, Number(value || 0)])),
    delivery: { total: Number(delivery?.total || 0), pendingProvider: Number(delivery?.pending_provider || 0), failed: Number(delivery?.failed || 0) },
  };
}

async function persist(db, env, workspaceId, runId, records, metadata) {
  const now = new Date().toISOString(); const statements = []; const changedRecords = []; let added = 0; let updated = 0;
  const existingResult = await db.prepare("SELECT source_record_id, content_hash, record_json FROM dbi_acquisition_records WHERE workspace_id = ? AND source = ?").bind(workspaceId, ACQUISITION_SOURCE).all();
  const existing = new Map((existingResult.results || []).map((row) => [row.source_record_id, row]));
  for (const record of records) {
    const previous = existing.get(record.sourceRecordId); const hash = await sha256(stableJson(record)); const changed = !previous || previous.content_hash !== hash;
    if (changed) {
      if (previous) updated += 1; else added += 1;
      changedRecords.push({ record, changeType: previous ? "updated" : "added" });
      statements.push(db.prepare(`INSERT OR IGNORE INTO dbi_acquisition_observations
        (id, workspace_id, source, source_record_id, refresh_run_id, content_hash, record_json, observed_at) VALUES (?,?,?,?,?,?,?,?)`)
        .bind(crypto.randomUUID(), workspaceId, ACQUISITION_SOURCE, record.sourceRecordId, runId, hash, JSON.stringify(record), now));
      statements.push(db.prepare(`INSERT INTO dbi_acquisition_changes
        (id, workspace_id, source, source_record_id, refresh_run_id, change_type, changed_fields_json, changed_at) VALUES (?,?,?,?,?,?,?,?)`)
        .bind(crypto.randomUUID(), workspaceId, ACQUISITION_SOURCE, record.sourceRecordId, runId, previous ? "updated" : "added", JSON.stringify(previous ? changedFields(parsed(previous.record_json, {}), record) : []), now));
    }
    statements.push(db.prepare(`INSERT INTO dbi_acquisition_records
      (workspace_id, source, source_record_id, solicitation_number, lifecycle_stage, content_hash, record_json, first_seen_at, last_seen_at, last_changed_at, removed_at)
      VALUES (?,?,?,?,?,?,?,?,?,?, '') ON CONFLICT(workspace_id, source, source_record_id) DO UPDATE SET
      solicitation_number = excluded.solicitation_number, lifecycle_stage = excluded.lifecycle_stage, content_hash = excluded.content_hash,
      record_json = excluded.record_json, last_seen_at = excluded.last_seen_at,
      last_changed_at = CASE WHEN dbi_acquisition_records.content_hash <> excluded.content_hash THEN excluded.last_changed_at ELSE dbi_acquisition_records.last_changed_at END, removed_at = ''`)
      .bind(workspaceId, ACQUISITION_SOURCE, record.sourceRecordId, record.solicitationNumber || "", record.lifecycleStage, hash, JSON.stringify(record), now, now, now));
    existing.set(record.sourceRecordId, { source_record_id: record.sourceRecordId, content_hash: hash, record_json: JSON.stringify(record) });
  }
  const existingLinks = await db.prepare("SELECT from_source, from_record_id, to_source, to_record_id, relationship FROM dbi_acquisition_lifecycle_links WHERE workspace_id = ?").bind(workspaceId).all();
  const linkKeys = new Set((existingLinks.results || []).map((row) => [row.from_source, row.from_record_id, row.to_source, row.to_record_id, row.relationship].join("\u0000")));
  let linksAdded = 0;
  for (const link of exactLifecycleLinks([...existing.values()].map((row) => parsed(row.record_json, {})))) {
    const linkKey = [link.fromSource, link.fromId, link.toSource, link.toId, link.relationship].join("\u0000");
    if (!linkKeys.has(linkKey)) linksAdded += 1;
    statements.push(db.prepare(`INSERT OR IGNORE INTO dbi_acquisition_lifecycle_links
      (workspace_id, from_source, from_record_id, to_source, to_record_id, relationship, basis, identifier, created_at)
      VALUES (?,?,?,?,?,?,?,?,?)`).bind(workspaceId, link.fromSource, link.fromId, link.toSource, link.toId, link.relationship, link.basis, link.identifier, now));
  }
  const savedViews = await db.prepare("SELECT * FROM dbi_acquisition_saved_views WHERE workspace_id = ? AND alert_mode <> 'none'").bind(workspaceId).all();
  for (const saved of savedViews.results || []) {
    const spec = parsed(saved.query_json, {});
    for (const changed of changedRecords) {
      if (!matchesSavedAcquisitionView(changed.record, spec)) continue;
      const alertId = crypto.randomUUID();
      statements.push(db.prepare(`INSERT OR IGNORE INTO dbi_acquisition_alerts
        (id, workspace_id, user_id, saved_view_id, source, source_record_id, refresh_run_id, change_type, matched_at, read_at)
        VALUES (?,?,?,?,?,?,?,?,?,'')`).bind(alertId, workspaceId, saved.user_id, saved.id, ACQUISITION_SOURCE, changed.record.sourceRecordId, runId, changed.changeType, now));
      statements.push(db.prepare(`INSERT OR IGNORE INTO dbi_acquisition_delivery_jobs
        (id, workspace_id, user_id, saved_view_id, alert_id, delivery_mode, status, next_attempt_at, created_at, updated_at)
        VALUES (?,?,?,?,?,?,'pending_provider',?,?,?)`).bind(crypto.randomUUID(), workspaceId, saved.user_id, saved.id, alertId, saved.alert_mode, deliveryJobSchedule(saved.alert_mode, env, new Date(now)), now, now));
    }
  }
  statements.push(db.prepare(`UPDATE dbi_acquisition_refresh_runs SET status = 'succeeded', records_seen = ?, records_added = ?,
    records_updated = ?, links_added = ?, metadata_json = ?, completed_at = ? WHERE id = ?`).bind(records.length, added, updated, linksAdded, JSON.stringify(metadata), now, runId));
  await db.batch(statements);
  return { added, updated, linksAdded };
}

export async function runD1AcquisitionRefresh({ db, env, workspaceId, trigger = "scheduled", decryptSecret }) {
  const config = await sourceConfig(db, workspaceId);
  if (trigger === "scheduled" && !config.enabled) return { skipped: true, reason: "automation_disabled" };
  const credential = await db.prepare("SELECT * FROM dbi_workspace_provider_credentials WHERE workspace_id = ? AND provider = 'sam_gov' AND revoked_at = '' LIMIT 1").bind(workspaceId).first();
  if (!credential) return { skipped: true, reason: "credential_unavailable" };
  const apiKey = await decryptSecret({ encrypted_key: credential.encrypted_secret, key_iv: credential.secret_iv, key_version: credential.secret_version }, env);
  if (!apiKey) return { skipped: true, reason: "credential_unreadable" };
  const running = await db.prepare("SELECT id, started_at FROM dbi_acquisition_refresh_runs WHERE workspace_id = ? AND source = ? AND status = 'running' ORDER BY started_at DESC LIMIT 1").bind(workspaceId, ACQUISITION_SOURCE).first();
  if (running && Date.now() - Date.parse(running.started_at) < 30 * 60_000) return { skipped: true, reason: "refresh_running", runId: running.id };
  if (running) await db.prepare("UPDATE dbi_acquisition_refresh_runs SET status = 'failed', error_code = 'stale_run', error_message = 'The prior refresh exceeded the 30-minute execution window', completed_at = ? WHERE id = ?").bind(new Date().toISOString(), running.id).run();
  const latest = await db.prepare("SELECT completed_at FROM dbi_acquisition_refresh_runs WHERE workspace_id = ? AND source = ? AND status = 'succeeded' ORDER BY completed_at DESC LIMIT 1").bind(workspaceId, ACQUISITION_SOURCE).first();
  const id = crypto.randomUUID(); const started = new Date().toISOString();
  await db.prepare("INSERT INTO dbi_acquisition_refresh_runs (id, workspace_id, source, status, trigger_type, started_at) VALUES (?,?,?,'running',?,?)").bind(id, workspaceId, ACQUISITION_SOURCE, trigger, started).run();
  try {
    const result = await fetchSamOpportunities({ apiKey, lastCompletedAt: latest?.completed_at, config });
    const counts = await persist(db, env, workspaceId, id, result.records, result.metadata); const completed = new Date().toISOString();
    await db.prepare("UPDATE dbi_workspace_provider_credentials SET last_used_at = ?, updated_at = ? WHERE id = ?").bind(completed, completed, credential.id).run();
    return { skipped: false, run: { id, status: "succeeded", recordsSeen: result.records.length, recordsAdded: counts.added, recordsUpdated: counts.updated, linksAdded: counts.linksAdded }, metadata: result.metadata };
  } catch (error) {
    const completed = new Date().toISOString();
    await db.prepare("UPDATE dbi_acquisition_refresh_runs SET status = 'failed', error_code = ?, error_message = ?, completed_at = ? WHERE id = ?").bind(cleanText(error.code || "source_unavailable", 80), cleanText(error.message, 500), completed, id).run();
    return { skipped: false, failed: true, code: error.code || "source_unavailable", runId: id };
  }
}

export async function runScheduledAcquisitionSweep(db, env, { decryptSecret, maxWorkspaces = 1 } = {}) {
  const credentials = await db.prepare(`SELECT credential.workspace_id, config.enabled, config.cadence_hours, config.config_json,
    (SELECT completed_at FROM dbi_acquisition_refresh_runs run WHERE run.workspace_id = credential.workspace_id
      AND run.source = ? AND run.status = 'succeeded' ORDER BY completed_at DESC LIMIT 1) AS last_completed_at
    FROM dbi_workspace_provider_credentials credential
    LEFT JOIN dbi_acquisition_source_configs config ON config.workspace_id = credential.workspace_id
    WHERE credential.provider = 'sam_gov' AND credential.revoked_at = ''
    ORDER BY COALESCE(last_completed_at, '') ASC LIMIT 50`).bind(ACQUISITION_SOURCE).all();
  const due = (credentials.results || []).filter((row) => {
    const config = normalizeAcquisitionConfig(row.config_json ? { ...parsed(row.config_json, {}), enabled: row.enabled === null ? undefined : Boolean(row.enabled), cadenceHours: row.cadence_hours } : {});
    const nextDueAt = acquisitionNextDueAt(row.last_completed_at, config);
    return config.enabled && (!nextDueAt || Date.now() >= Date.parse(nextDueAt));
  }).slice(0, Math.max(1, Math.min(5, Number(maxWorkspaces) || 1)));
  const results = [];
  for (const row of due) results.push({ workspaceId: row.workspace_id, ...(await runD1AcquisitionRefresh({ db, env, workspaceId: row.workspace_id, trigger: "scheduled", decryptSecret })) });
  return { keyedWorkspaces: (credentials.results || []).length, dueWorkspaces: due.length, executed: results.filter((result) => !result.skipped).length, results };
}

async function schedulerAuthorized(request, env) {
  const expected = String(env.DBI_SCHEDULER_TOKEN || "");
  const supplied = String(request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (expected.length < 32 || supplied.length !== expected.length) return false;
  const [left, right] = await Promise.all([expected, supplied].map((value) => crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))));
  return [...new Uint8Array(left)].every((value, index) => value === new Uint8Array(right)[index]);
}

export async function acquisitionSchedulerResponse(request, db, env, deps) {
  if (request.method !== "POST") return deps.json({ error: "Method not allowed" }, 405);
  if (!await schedulerAuthorized(request, env)) return deps.json({ error: "Unauthorized" }, 401);
  const acquisition = await runScheduledAcquisitionSweep(db, env, { decryptSecret: deps.decryptSecret, maxWorkspaces: 1 });
  const delivery = await processD1AcquisitionDeliveryQueue(db, env, { limit: 100 });
  return deps.json({ ...acquisition, delivery });
}

export async function acquisitionRuntimeResponse(request, db, env, deps) {
  const { canAdministerWorkspaces, decryptSecret, json, safeJson, sameOriginRequest, sessionUser } = deps;
  const session = await sessionUser(db, request); if (!session) return json({ error: "Sign in required" }, 401);
  const workspaceId = session.active_workspace_id || ""; if (!workspaceId) return json({ error: "Select a workspace first" }, 409);
  const url = new URL(request.url); const prefix = "/api/v1/auth/acquisition"; const segments = url.pathname.slice(prefix.length).split("/").filter(Boolean).map(decodeURIComponent);
  if (request.method !== "GET" && !sameOriginRequest(request)) return json({ error: "Cross-origin acquisition changes are not allowed" }, 403);
  if (request.method === "GET" && segments[0] === "status") return json(await status(db, workspaceId));
  if (segments[0] === "delivery-preferences") {
    if (request.method === "GET") return json({ preferences: await d1DeliveryPreferences(db, workspaceId, session.user_id) });
    if (request.method !== "PATCH") return json({ error: "Method not allowed" }, 405);
    const body = await safeJson(request);
    return json({ preferences: await updateD1DeliveryPreferences(db, workspaceId, session.user_id, body?.emailEnabled !== false) });
  }
  if (segments[0] === "operations") {
    if (session.role !== "super_user" || session.is_emulating) return json({ error: "Super user access is required" }, 403);
    if (request.method !== "GET") return json({ error: "Method not allowed" }, 405);
    return json(await d1AcquisitionOperations(db, env));
  }
  if (segments[0] === "delivery-jobs" && segments[1]) {
    if (session.role !== "super_user" || session.is_emulating) return json({ error: "Super user access is required" }, 403);
    if (request.method !== "PATCH") return json({ error: "Method not allowed" }, 405);
    const body = await safeJson(request); const action = body?.action === "retry" ? "retry" : body?.action === "cancel" ? "cancel" : "";
    if (!action) return json({ error: "A retry or cancel action is required" }, 400);
    const job = await mutateD1DeliveryJob(db, cleanText(segments[1], 80), action);
    return job ? json({ job }) : json({ error: "Delivery job not found" }, 404);
  }
  if (segments[0] === "config") {
    if (request.method === "GET") return json({ config: await sourceConfig(db, workspaceId) });
    if (request.method !== "PATCH") return json({ error: "Method not allowed" }, 405);
    if (!canAdministerWorkspaces(session)) return json({ error: "Workspace manager access is required" }, 403);
    const body = await safeJson(request); const config = normalizeAcquisitionConfig(body); const now = new Date().toISOString();
    await db.prepare(`INSERT INTO dbi_acquisition_source_configs (workspace_id, enabled, cadence_hours, config_json, updated_by, created_at, updated_at)
      VALUES (?,?,?,?,?,?,?) ON CONFLICT(workspace_id) DO UPDATE SET enabled = excluded.enabled, cadence_hours = excluded.cadence_hours,
      config_json = excluded.config_json, updated_by = excluded.updated_by, updated_at = excluded.updated_at`)
      .bind(workspaceId, config.enabled ? 1 : 0, config.cadenceHours, JSON.stringify(config), session.user_id, now, now).run();
    return json({ config });
  }
  if (request.method === "POST" && segments[0] === "refresh") {
    if (!canAdministerWorkspaces(session)) return json({ error: "Workspace manager access is required" }, 403);
    const body = await safeJson(request); const trigger = body?.trigger === "first_access" ? "first_access" : "manual";
    const result = await runD1AcquisitionRefresh({ db, env, workspaceId, trigger, decryptSecret });
    if (result.skipped) return json({ error: result.reason === "refresh_running" ? "A SAM.gov refresh is already running" : "Configure the workspace SAM.gov credential before refreshing", code: result.reason, runId: result.runId }, result.reason === "refresh_running" ? 409 : 409);
    if (result.failed) return json({ error: "SAM.gov refresh could not be completed; the prior verified corpus was preserved", code: result.code, runId: result.runId }, result.code === "rate_limited" ? 429 : 502);
    const delivery = await processD1AcquisitionDeliveryQueue(db, env, { limit: 100 });
    return json({ run: result.run, delivery }, 202);
  }
  if (segments[0] === "saved-views") {
    const id = cleanText(segments[1], 80);
    if (request.method === "GET" && !id) {
      const result = await db.prepare(`SELECT saved.*,
        (SELECT COUNT(*) FROM dbi_acquisition_alerts alert WHERE alert.saved_view_id = saved.id AND alert.read_at = '') AS unread_count,
        (SELECT MAX(matched_at) FROM dbi_acquisition_alerts alert WHERE alert.saved_view_id = saved.id) AS latest_match_at
        FROM dbi_acquisition_saved_views saved WHERE saved.workspace_id = ? AND saved.user_id = ? ORDER BY saved.updated_at DESC`).bind(workspaceId, session.user_id).all();
      return json({ views: (result.results || []).map(view) });
    }
    if (request.method === "POST" && !id) {
      const body = await safeJson(request); const name = cleanText(body?.name, 100); if (!name) return json({ error: "A saved view name is required" }, 400);
      const now = new Date().toISOString(); const nextId = crypto.randomUUID(); const alertMode = ["none", "daily", "immediate"].includes(body?.alertMode) ? body.alertMode : "none";
      const spec = normalizeSavedAcquisitionView(body);
      await db.prepare("INSERT INTO dbi_acquisition_saved_views (id, workspace_id, user_id, name, query_json, alert_mode, last_opened_at, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)").bind(nextId, workspaceId, session.user_id, name, JSON.stringify(spec), alertMode, now, now, now).run();
      return json({ view: view({ id: nextId, name, query_json: JSON.stringify(spec), alert_mode: alertMode, last_opened_at: now, created_at: now, updated_at: now }) }, 201);
    }
    const stored = id ? await db.prepare("SELECT * FROM dbi_acquisition_saved_views WHERE id = ? AND workspace_id = ? AND user_id = ?").bind(id, workspaceId, session.user_id).first() : null;
    if (!stored) return json({ error: "Saved view not found" }, 404);
    if (request.method === "PATCH") {
      const body = await safeJson(request); const now = new Date().toISOString(); const name = cleanText(body?.name, 100) || stored.name; const alertMode = ["none", "daily", "immediate"].includes(body?.alertMode) ? body.alertMode : stored.alert_mode; const opened = body?.opened ? now : stored.last_opened_at;
      const statements = [db.prepare("UPDATE dbi_acquisition_saved_views SET name = ?, alert_mode = ?, last_opened_at = ?, updated_at = ? WHERE id = ?").bind(name, alertMode, opened, now, id)];
      if (body?.opened) statements.push(db.prepare("UPDATE dbi_acquisition_alerts SET read_at = ? WHERE saved_view_id = ? AND user_id = ? AND read_at = ''").bind(now, id, session.user_id));
      if (alertMode === "none") statements.push(db.prepare("UPDATE dbi_acquisition_delivery_jobs SET status = 'cancelled', last_error = 'alert_disabled', updated_at = ? WHERE saved_view_id = ? AND user_id = ? AND status IN ('pending_provider','pending')").bind(now, id, session.user_id));
      await db.batch(statements);
      return json({ view: view({ ...stored, name, alert_mode: alertMode, unread_count: body?.opened ? 0 : stored.unread_count, last_opened_at: opened, updated_at: now }) });
    }
    if (request.method === "DELETE") {
      await db.batch([
        db.prepare("DELETE FROM dbi_acquisition_delivery_attempts WHERE job_id IN (SELECT id FROM dbi_acquisition_delivery_jobs WHERE saved_view_id = ? AND user_id = ?)").bind(id, session.user_id),
        db.prepare("DELETE FROM dbi_acquisition_delivery_jobs WHERE saved_view_id = ? AND user_id = ?").bind(id, session.user_id),
        db.prepare("DELETE FROM dbi_acquisition_alerts WHERE saved_view_id = ? AND user_id = ?").bind(id, session.user_id),
        db.prepare("DELETE FROM dbi_acquisition_saved_views WHERE id = ? AND user_id = ?").bind(id, session.user_id),
      ]);
      return new Response(null, { status: 204 });
    }
  }
  if (request.method === "GET" && segments[0] === "records" && !segments[1]) {
    const requestedLimit = Number(url.searchParams.get("limit") || 500); const requestedOffset = Number(url.searchParams.get("offset") || 0);
    const limit = Number.isFinite(requestedLimit) ? Math.min(1_000, Math.max(1, Math.trunc(requestedLimit))) : 500;
    const offset = Number.isFinite(requestedOffset) ? Math.max(0, Math.trunc(requestedOffset)) : 0;
    const includeRemoved = url.searchParams.get("removed") === "1";
    const where = includeRemoved ? "workspace_id = ?" : "workspace_id = ? AND removed_at = ''";
    const [result, total] = await Promise.all([
      db.prepare(`SELECT * FROM dbi_acquisition_records WHERE ${where} ORDER BY last_changed_at DESC LIMIT ? OFFSET ?`).bind(workspaceId, limit, offset).all(),
      db.prepare(`SELECT COUNT(*) AS total FROM dbi_acquisition_records WHERE ${where}`).bind(workspaceId).first(),
    ]);
    const count = Number(total?.total || 0);
    return json({ records: (result.results || []).map(record), pagination: { offset, limit, total: count, hasMore: offset + (result.results || []).length < count } });
  }
  if (request.method === "GET" && segments[0] === "records" && segments[3] === "history") {
    const result = await db.prepare("SELECT content_hash, record_json, observed_at FROM dbi_acquisition_observations WHERE workspace_id = ? AND source = ? AND source_record_id = ? ORDER BY observed_at DESC LIMIT 100").bind(workspaceId, cleanText(segments[1], 60), cleanText(segments[2], 180)).all();
    return json({ observations: (result.results || []).map((row) => ({ contentHash: row.content_hash, record: parsed(row.record_json, {}), observedAt: row.observed_at })) });
  }
  if (request.method === "GET" && segments[0] === "links") {
    const recordId = cleanText(url.searchParams.get("recordId"), 180); const result = await db.prepare(`SELECT * FROM dbi_acquisition_lifecycle_links WHERE workspace_id = ?
      AND (? = '' OR from_record_id = ? OR to_record_id = ?) ORDER BY created_at DESC LIMIT 250`).bind(workspaceId, recordId, recordId, recordId).all();
    return json({ links: (result.results || []).map((row) => ({ fromSource: row.from_source, fromId: row.from_record_id, toSource: row.to_source, toId: row.to_record_id, relationship: row.relationship, basis: row.basis, identifier: row.identifier })) });
  }
  return json({ error: "Method not allowed" }, 405);
}
