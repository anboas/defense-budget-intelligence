import { automatedSamRecord } from "../src/procurement-taxonomy.js";

function jsonValue(value, fallback) {
  if (value && typeof value === "object") return value;
  try { return JSON.parse(value || ""); }
  catch { return fallback; }
}

export async function recordUniverse(pool, workspaceId) {
  const [capture, runtime] = await Promise.all([
    pool.query(`SELECT payload FROM capture_opportunities WHERE snapshot_id=(SELECT id FROM intelligence_snapshots WHERE kind='capture_calendar' ORDER BY captured_at DESC, imported_at DESC LIMIT 1)`),
    pool.query("SELECT record_json, first_seen_at, last_seen_at, last_changed_at FROM app_acquisition_records WHERE workspace_id=$1 AND removed_at IS NULL", [workspaceId]),
  ]);
  const merged = new Map(capture.rows.map((row) => [row.payload.opportunityId, row.payload]));
  const asOf = new Date().toISOString().slice(0, 10);
  for (const row of runtime.rows) {
    const record = automatedSamRecord(jsonValue(row.record_json, {}), asOf);
    if (!record?.opportunityId || merged.has(record.opportunityId)) continue;
    merged.set(record.opportunityId, { ...record, firstSeenAt: row.first_seen_at, lastSeenAt: row.last_seen_at, lastChangedAt: row.last_changed_at });
  }
  return [...merged.values()];
}
