import { randomUUID } from "node:crypto";
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
} from "../src/acquisition-runtime-core.js";
import { deliveryJobSchedule } from "../src/acquisition-delivery-core.js";
import { processPostgresAcquisitionDeliveryQueue, registerAcquisitionDeliveryRoutes } from "./acquisition-delivery-routes.mjs";

function publicRun(row) {
  return row ? {
    id: row.id, source: row.source, status: row.status, trigger: row.trigger_type,
    recordsSeen: Number(row.records_seen || 0), recordsAdded: Number(row.records_added || 0),
    recordsUpdated: Number(row.records_updated || 0), linksAdded: Number(row.links_added || 0),
    errorCode: row.error_code || null, errorMessage: row.error_message || null,
    startedAt: row.started_at, completedAt: row.completed_at || null,
  } : null;
}

function publicView(row) {
  const specification = row.query_json || {};
  return {
    id: row.id, name: row.name, query: specification.query || "", filters: specification.filters || {},
    alertMode: row.alert_mode, unreadCount: Number(row.unread_count || 0), latestMatchAt: row.latest_match_at || null,
    lastOpenedAt: row.last_opened_at, savedAt: row.created_at, updatedAt: row.updated_at,
  };
}

function publicRecord(row) {
  return {
    ...(row.record_json || {}),
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
    lastChangedAt: row.last_changed_at,
    removedAt: row.removed_at || null,
  };
}

async function sourceConfig(pool, workspaceId) {
  const result = await pool.query("SELECT * FROM app_acquisition_source_configs WHERE workspace_id = $1", [workspaceId]);
  const row = result.rows[0];
  return normalizeAcquisitionConfig(row ? { ...(row.config_json || {}), enabled: row.enabled, cadenceHours: row.cadence_hours } : {});
}

async function acquisitionStatus(pool, workspaceId) {
  const [credential, run, counts, quality, linkCount, config, delivery] = await Promise.all([
    pool.query("SELECT id, label, secret_last_four, last_used_at FROM app_workspace_provider_credentials WHERE workspace_id = $1 AND provider = 'sam_gov' AND revoked_at IS NULL LIMIT 1", [workspaceId]),
    pool.query("SELECT * FROM app_acquisition_refresh_runs WHERE workspace_id = $1 AND source = $2 ORDER BY started_at DESC LIMIT 1", [workspaceId, ACQUISITION_SOURCE]),
    pool.query(`SELECT COUNT(*)::int AS records, COUNT(*) FILTER (WHERE removed_at IS NULL)::int AS active,
      COUNT(*) FILTER (WHERE last_changed_at >= NOW() - INTERVAL '24 hours')::int AS changed_today
      FROM app_acquisition_records WHERE workspace_id = $1`, [workspaceId]),
    pool.query(`SELECT
      COUNT(*) FILTER (WHERE solicitation_number IS NULL OR solicitation_number = '')::int AS missing_identifier,
      COUNT(*) FILTER (WHERE COALESCE(record_json->>'office','') = '')::int AS missing_office,
      COUNT(*) FILTER (WHERE COALESCE(record_json->>'naicsCode','') = '')::int AS missing_naics,
      COUNT(*) FILTER (WHERE last_seen_at < NOW() - INTERVAL '7 days' AND removed_at IS NULL)::int AS stale,
      COUNT(*)::int AS total FROM app_acquisition_records WHERE workspace_id = $1`, [workspaceId]),
    pool.query("SELECT COUNT(*)::int AS total FROM app_acquisition_lifecycle_links WHERE workspace_id = $1", [workspaceId]),
    sourceConfig(pool, workspaceId),
    pool.query(`SELECT COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE status = 'pending_provider')::int AS pending_provider,
      COUNT(*) FILTER (WHERE status = 'failed')::int AS failed
      FROM app_acquisition_delivery_jobs WHERE workspace_id = $1`, [workspaceId]),
  ]);
  const latest = run.rows[0] || null;
  const completed = Date.parse(latest?.completed_at || latest?.started_at || "");
  const nextDueAt = acquisitionNextDueAt(latest?.completed_at, config);
  return {
    source: "SAM.gov", credential: credential.rowCount ? { configured: true, label: credential.rows[0].label, lastFour: credential.rows[0].secret_last_four, lastUsedAt: credential.rows[0].last_used_at || null } : { configured: false },
    config,
    refresh: { latest: publicRun(latest), due: config.enabled && (!Number.isFinite(completed) || !nextDueAt || Date.now() >= Date.parse(nextDueAt)), nextDueAt, schedule: `Every ${config.cadenceHours} hours`, execution: "cloudflare-cron-with-first-access-fallback", eligible: Boolean(credential.rowCount && config.enabled) },
    durableHistory: {
      records: Number(counts.rows[0]?.records || 0), active: Number(counts.rows[0]?.active || 0),
      changedToday: Number(counts.rows[0]?.changed_today || 0), lifecycleLinks: Number(linkCount.rows[0]?.total || 0),
    },
    quality: quality.rows[0] || { total: 0, missing_identifier: 0, missing_office: 0, missing_naics: 0, stale: 0 },
    delivery: { total: Number(delivery.rows[0]?.total || 0), pendingProvider: Number(delivery.rows[0]?.pending_provider || 0), failed: Number(delivery.rows[0]?.failed || 0) },
  };
}

async function persistRefresh(pool, workspaceId, runId, records, metadata) {
  const client = await pool.connect();
  const now = new Date().toISOString();
  const changedRecords = [];
  let added = 0; let updated = 0; let linksAdded = 0;
  try {
    await client.query("BEGIN");
    for (const record of records) {
      const hash = await sha256(stableJson(record));
      const previous = await client.query("SELECT record_json, content_hash FROM app_acquisition_records WHERE workspace_id = $1 AND source = $2 AND source_record_id = $3", [workspaceId, ACQUISITION_SOURCE, record.sourceRecordId]);
      const old = previous.rows[0]?.record_json || null;
      const changed = !previous.rowCount || previous.rows[0].content_hash !== hash;
      if (changed) {
        const changeType = old ? "updated" : "added";
        if (old) updated += 1; else added += 1;
        changedRecords.push({ record, changeType });
        await client.query(`INSERT INTO app_acquisition_observations
          (id, workspace_id, source, source_record_id, refresh_run_id, content_hash, record_json, observed_at)
          VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8) ON CONFLICT DO NOTHING`, [randomUUID(), workspaceId, ACQUISITION_SOURCE, record.sourceRecordId, runId, hash, JSON.stringify(record), now]);
        await client.query(`INSERT INTO app_acquisition_changes
          (id, workspace_id, source, source_record_id, refresh_run_id, change_type, changed_fields_json, changed_at)
          VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8)`, [randomUUID(), workspaceId, ACQUISITION_SOURCE, record.sourceRecordId, runId, changeType, JSON.stringify(old ? changedFields(old, record) : []), now]);
      }
      await client.query(`INSERT INTO app_acquisition_records
        (workspace_id, source, source_record_id, solicitation_number, lifecycle_stage, content_hash, record_json, first_seen_at, last_seen_at, last_changed_at, removed_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$8,$8,NULL)
        ON CONFLICT (workspace_id, source, source_record_id) DO UPDATE SET solicitation_number = EXCLUDED.solicitation_number,
          lifecycle_stage = EXCLUDED.lifecycle_stage, content_hash = EXCLUDED.content_hash, record_json = EXCLUDED.record_json,
          last_seen_at = EXCLUDED.last_seen_at, last_changed_at = CASE WHEN app_acquisition_records.content_hash <> EXCLUDED.content_hash THEN EXCLUDED.last_changed_at ELSE app_acquisition_records.last_changed_at END, removed_at = NULL`,
      [workspaceId, ACQUISITION_SOURCE, record.sourceRecordId, record.solicitationNumber, record.lifecycleStage, hash, JSON.stringify(record), now]);
    }
    const persisted = await client.query("SELECT record_json FROM app_acquisition_records WHERE workspace_id = $1 AND removed_at IS NULL", [workspaceId]);
    for (const link of exactLifecycleLinks(persisted.rows.map((row) => row.record_json))) {
      const result = await client.query(`INSERT INTO app_acquisition_lifecycle_links
        (workspace_id, from_source, from_record_id, to_source, to_record_id, relationship, basis, identifier)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING`, [workspaceId, link.fromSource, link.fromId, link.toSource, link.toId, link.relationship, link.basis, link.identifier]);
      linksAdded += result.rowCount;
    }
    const savedViews = await client.query("SELECT * FROM app_acquisition_saved_views WHERE workspace_id = $1 AND alert_mode <> 'none'", [workspaceId]);
    for (const saved of savedViews.rows) {
      for (const changed of changedRecords) {
        if (!matchesSavedAcquisitionView(changed.record, saved.query_json || {})) continue;
        const alertId = randomUUID();
        const insertedAlert = await client.query(`INSERT INTO app_acquisition_alerts
          (id, workspace_id, user_id, saved_view_id, source, source_record_id, refresh_run_id, change_type, matched_at)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT DO NOTHING RETURNING id`,
        [alertId, workspaceId, saved.user_id, saved.id, ACQUISITION_SOURCE, changed.record.sourceRecordId, runId, changed.changeType, now]);
        if (insertedAlert.rowCount) await client.query(`INSERT INTO app_acquisition_delivery_jobs
          (id, workspace_id, user_id, saved_view_id, alert_id, delivery_mode, status, next_attempt_at)
          VALUES ($1,$2,$3,$4,$5,$6,'pending_provider',$7) ON CONFLICT DO NOTHING`,
        [randomUUID(), workspaceId, saved.user_id, saved.id, alertId, saved.alert_mode, deliveryJobSchedule(saved.alert_mode, process.env, new Date(now))]);
      }
    }
    await client.query(`UPDATE app_acquisition_refresh_runs SET status = 'succeeded', records_seen = $1, records_added = $2,
      records_updated = $3, links_added = $4, metadata_json = $5::jsonb, completed_at = NOW() WHERE id = $6`, [records.length, added, updated, linksAdded, JSON.stringify(metadata), runId]);
    await client.query("COMMIT");
    return { added, updated, linksAdded };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}

export function registerAcquisitionRuntimeRoutes(app, pool, deps) {
  const { assertSameOrigin, authenticated, canAdministerWorkspace, cleanText, decryptSecret, encryptSecret } = deps;
  async function context(request, reply, manage = false) {
    const user = await authenticated(pool, request);
    if (!user) { reply.code(401).send({ error: "sign in required" }); return null; }
    const workspaceId = user.active_workspace_id;
    if (!workspaceId) { reply.code(409).send({ error: "select a workspace first" }); return null; }
    if (manage && !await canAdministerWorkspace(pool, user, workspaceId)) { reply.code(403).send({ error: "workspace manager access is required" }); return null; }
    return { user, workspaceId };
  }

  app.get("/api/v1/auth/acquisition/status", async (request, reply) => {
    const current = await context(request, reply); if (!current) return;
    return acquisitionStatus(pool, current.workspaceId);
  });

  app.get("/api/v1/auth/acquisition/config", async (request, reply) => {
    const current = await context(request, reply); if (!current) return;
    return { config: await sourceConfig(pool, current.workspaceId) };
  });
  app.patch("/api/v1/auth/acquisition/config", async (request, reply) => {
    if (!assertSameOrigin(request, reply)) return;
    const current = await context(request, reply, true); if (!current) return;
    const config = normalizeAcquisitionConfig(request.body || {});
    await pool.query(`INSERT INTO app_acquisition_source_configs (workspace_id, enabled, cadence_hours, config_json, updated_by)
      VALUES ($1,$2,$3,$4::jsonb,$5) ON CONFLICT (workspace_id) DO UPDATE SET enabled = EXCLUDED.enabled,
      cadence_hours = EXCLUDED.cadence_hours, config_json = EXCLUDED.config_json, updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
    [current.workspaceId, config.enabled, config.cadenceHours, JSON.stringify(config), current.user.user_id]);
    return { config };
  });

  app.post("/api/v1/auth/acquisition/refresh", async (request, reply) => {
    if (!assertSameOrigin(request, reply)) return;
    const current = await context(request, reply, true); if (!current) return;
    const credential = await pool.query("SELECT * FROM app_workspace_provider_credentials WHERE workspace_id = $1 AND provider = 'sam_gov' AND revoked_at IS NULL LIMIT 1", [current.workspaceId]);
    if (!credential.rowCount) return reply.code(409).send({ error: "Configure the workspace SAM.gov credential before refreshing", code: "credential_unavailable" });
    const apiKey = decryptSecret({ encrypted_key: credential.rows[0].encrypted_secret, key_iv: credential.rows[0].secret_iv, key_version: credential.rows[0].secret_version });
    if (!apiKey) return reply.code(503).send({ error: "The workspace SAM.gov credential could not be decrypted", code: "credential_unavailable" });
    const running = await pool.query("SELECT id, started_at FROM app_acquisition_refresh_runs WHERE workspace_id = $1 AND source = $2 AND status = 'running' ORDER BY started_at DESC LIMIT 1", [current.workspaceId, ACQUISITION_SOURCE]);
    if (running.rowCount && Date.now() - Date.parse(running.rows[0].started_at) < 30 * 60_000) {
      return reply.code(409).send({ error: "A SAM.gov refresh is already running", code: "refresh_running", runId: running.rows[0].id });
    }
    if (running.rowCount) {
      await pool.query("UPDATE app_acquisition_refresh_runs SET status = 'failed', error_code = 'stale_run', error_message = 'The prior refresh exceeded the 30-minute execution window', completed_at = NOW() WHERE id = $1", [running.rows[0].id]);
    }
    const latest = await pool.query("SELECT completed_at FROM app_acquisition_refresh_runs WHERE workspace_id = $1 AND source = $2 AND status = 'succeeded' ORDER BY completed_at DESC LIMIT 1", [current.workspaceId, ACQUISITION_SOURCE]);
    const runId = randomUUID();
    const trigger = cleanText(request.body?.trigger, 30) === "first_access" ? "first_access" : "manual";
    await pool.query("INSERT INTO app_acquisition_refresh_runs (id, workspace_id, source, status, trigger_type) VALUES ($1,$2,$3,'running',$4)", [runId, current.workspaceId, ACQUISITION_SOURCE, trigger]);
    try {
      const config = await sourceConfig(pool, current.workspaceId);
      const result = await fetchSamOpportunities({ apiKey, lastCompletedAt: latest.rows[0]?.completed_at, config });
      const counts = await persistRefresh(pool, current.workspaceId, runId, result.records, result.metadata);
      await pool.query("UPDATE app_workspace_provider_credentials SET last_used_at = NOW(), updated_at = NOW() WHERE id = $1", [credential.rows[0].id]);
      await processPostgresAcquisitionDeliveryQueue(pool, process.env, { limit: 100, decryptSecret });
      return reply.code(202).send({ run: { id: runId, status: "succeeded", recordsSeen: result.records.length, recordsAdded: counts.added, recordsUpdated: counts.updated, linksAdded: counts.linksAdded } });
    } catch (error) {
      await pool.query("UPDATE app_acquisition_refresh_runs SET status = 'failed', error_code = $1, error_message = $2, completed_at = NOW() WHERE id = $3", [cleanText(error.code || "source_unavailable", 80), cleanText(error.message, 500), runId]);
      return reply.code(error.code === "rate_limited" ? 429 : 502).send({ error: "SAM.gov refresh could not be completed; the prior verified corpus was preserved", code: error.code || "source_unavailable", runId });
    }
  });

  app.get("/api/v1/auth/acquisition/saved-views", async (request, reply) => {
    const current = await context(request, reply); if (!current) return;
    const result = await pool.query(`SELECT saved.*,
      (SELECT COUNT(*)::int FROM app_acquisition_alerts alert WHERE alert.saved_view_id = saved.id AND alert.read_at IS NULL) AS unread_count,
      (SELECT MAX(matched_at) FROM app_acquisition_alerts alert WHERE alert.saved_view_id = saved.id) AS latest_match_at
      FROM app_acquisition_saved_views saved WHERE saved.workspace_id = $1 AND saved.user_id = $2 ORDER BY saved.updated_at DESC`, [current.workspaceId, current.user.user_id]);
    return { views: result.rows.map(publicView) };
  });
  app.post("/api/v1/auth/acquisition/saved-views", async (request, reply) => {
    if (!assertSameOrigin(request, reply)) return;
    const current = await context(request, reply); if (!current) return;
    const name = cleanText(request.body?.name, 100); if (!name) return reply.code(400).send({ error: "a saved view name is required" });
    const id = randomUUID(); const specification = normalizeSavedAcquisitionView(request.body);
    const alertMode = ["none", "daily", "immediate"].includes(request.body?.alertMode) ? request.body.alertMode : "none";
    const result = await pool.query(`INSERT INTO app_acquisition_saved_views (id, workspace_id, user_id, name, query_json, alert_mode)
      VALUES ($1,$2,$3,$4,$5::jsonb,$6) RETURNING *`, [id, current.workspaceId, current.user.user_id, name, JSON.stringify(specification), alertMode]);
    return reply.code(201).send({ view: publicView(result.rows[0]) });
  });
  app.patch("/api/v1/auth/acquisition/saved-views/:id", async (request, reply) => {
    if (!assertSameOrigin(request, reply)) return;
    const current = await context(request, reply); if (!current) return;
    const alertMode = ["none", "daily", "immediate"].includes(request.body?.alertMode) ? request.body.alertMode : null;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query(`UPDATE app_acquisition_saved_views SET name = COALESCE($1,name), alert_mode = COALESCE($2,alert_mode),
        last_opened_at = CASE WHEN $3::boolean THEN NOW() ELSE last_opened_at END, updated_at = NOW()
        WHERE id = $4 AND workspace_id = $5 AND user_id = $6 RETURNING *`, [cleanText(request.body?.name, 100) || null, alertMode, Boolean(request.body?.opened), request.params.id, current.workspaceId, current.user.user_id]);
      if (!result.rowCount) { await client.query("ROLLBACK"); return reply.code(404).send({ error: "saved view not found" }); }
      if (request.body?.opened) await client.query("UPDATE app_acquisition_alerts SET read_at = NOW() WHERE saved_view_id = $1 AND user_id = $2 AND read_at IS NULL", [request.params.id, current.user.user_id]);
      if (alertMode === "none") await client.query("UPDATE app_acquisition_delivery_jobs SET status = 'cancelled', last_error = 'alert_disabled', updated_at = NOW() WHERE saved_view_id = $1 AND user_id = $2 AND status IN ('pending_provider','pending')", [request.params.id, current.user.user_id]);
      await client.query("COMMIT");
      return { view: publicView({ ...result.rows[0], unread_count: request.body?.opened ? 0 : result.rows[0].unread_count }) };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
  });
  app.delete("/api/v1/auth/acquisition/saved-views/:id", async (request, reply) => {
    if (!assertSameOrigin(request, reply)) return;
    const current = await context(request, reply); if (!current) return;
    const result = await pool.query("DELETE FROM app_acquisition_saved_views WHERE id = $1 AND workspace_id = $2 AND user_id = $3", [request.params.id, current.workspaceId, current.user.user_id]);
    return result.rowCount ? reply.code(204).send() : reply.code(404).send({ error: "saved view not found" });
  });
  app.get("/api/v1/auth/acquisition/records", async (request, reply) => {
    const current = await context(request, reply); if (!current) return;
    const requestedLimit = Number(request.query?.limit || 500); const requestedOffset = Number(request.query?.offset || 0);
    const limit = Number.isFinite(requestedLimit) ? Math.min(1_000, Math.max(1, Math.trunc(requestedLimit))) : 500;
    const offset = Number.isFinite(requestedOffset) ? Math.max(0, Math.trunc(requestedOffset)) : 0;
    const includeRemoved = String(request.query?.removed || "") === "1";
    const removedClause = includeRemoved ? "" : "AND removed_at IS NULL";
    const [result, count] = await Promise.all([
      pool.query(`SELECT * FROM app_acquisition_records WHERE workspace_id = $1 ${removedClause} ORDER BY last_changed_at DESC LIMIT $2 OFFSET $3`, [current.workspaceId, limit, offset]),
      pool.query(`SELECT COUNT(*)::int AS total FROM app_acquisition_records WHERE workspace_id = $1 ${removedClause}`, [current.workspaceId]),
    ]);
    const total = Number(count.rows[0]?.total || 0);
    return { records: result.rows.map(publicRecord), pagination: { offset, limit, total, hasMore: offset + result.rowCount < total } };
  });
  app.get("/api/v1/auth/acquisition/records/:source/:recordId/history", async (request, reply) => {
    const current = await context(request, reply); if (!current) return;
    const result = await pool.query(`SELECT content_hash, record_json, observed_at FROM app_acquisition_observations
      WHERE workspace_id = $1 AND source = $2 AND source_record_id = $3 ORDER BY observed_at DESC LIMIT 100`, [current.workspaceId, cleanText(request.params.source, 60), cleanText(request.params.recordId, 180)]);
    return { observations: result.rows.map((row) => ({ contentHash: row.content_hash, record: row.record_json, observedAt: row.observed_at })) };
  });
  app.get("/api/v1/auth/acquisition/links", async (request, reply) => {
    const current = await context(request, reply); if (!current) return;
    const recordId = cleanText(request.query?.recordId, 180);
    const result = await pool.query(`SELECT * FROM app_acquisition_lifecycle_links WHERE workspace_id = $1
      AND ($2 = '' OR from_record_id = $2 OR to_record_id = $2) ORDER BY created_at DESC LIMIT 250`, [current.workspaceId, recordId]);
    return { links: result.rows.map((row) => ({ fromSource: row.from_source, fromId: row.from_record_id, toSource: row.to_source, toId: row.to_record_id, relationship: row.relationship, basis: row.basis, identifier: row.identifier })) };
  });
  registerAcquisitionDeliveryRoutes(app, pool, { assertSameOrigin, context, decryptSecret, encryptSecret });
}
