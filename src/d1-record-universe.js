import { automatedSamRecord } from "./procurement-taxonomy.js";

function runtimeRecords(sourceRecords, rows, asOf) {
  const knownNotices = new Set(sourceRecords.flatMap((record) => [record.reference, record.noticeId, record.solicitationNumber]).map((value) => String(value || "").toUpperCase()).filter(Boolean));
  return rows.flatMap((row) => {
    try {
      const notice = JSON.parse(row.record_json || "{}");
      const keys = [notice.noticeId, notice.solicitationNumber].map((value) => String(value || "").toUpperCase()).filter(Boolean);
      if (!keys.length || keys.some((key) => knownNotices.has(key))) return [];
      return [{ ...automatedSamRecord(notice, asOf), firstSeenAt: row.first_seen_at, lastSeenAt: row.last_seen_at, lastChangedAt: row.last_changed_at }];
    } catch { return []; }
  });
}

export function mergeD1RecordUniverse(source = {}, storedRows = [], acquisitionRows = []) {
  const sourceRecords = source.records || [];
  const manual = storedRows.flatMap((row) => {
    try { return [{ ...JSON.parse(row.payload_json), version: row.version, createdAt: row.created_at, updatedAt: row.updated_at, manual: true }]; }
    catch { return []; }
  });
  const asOf = source.metadata?.asOf || new Date().toISOString().slice(0, 10);
  return { metadata: source.metadata || {}, records: [...sourceRecords, ...runtimeRecords(sourceRecords, acquisitionRows, asOf), ...manual] };
}

export async function loadD1RecordUniverse(db, workspaceId, sourcePromise) {
  const [source, stored, acquisition] = await Promise.all([
    sourcePromise,
    db.prepare("SELECT * FROM dbi_workspace_manual_records WHERE workspace_id = ? AND deleted_at = '' ORDER BY created_at").bind(workspaceId).all(),
    db.prepare("SELECT record_json, first_seen_at, last_seen_at, last_changed_at FROM dbi_acquisition_records WHERE workspace_id = ? AND removed_at = ''").bind(workspaceId).all(),
  ]);
  return mergeD1RecordUniverse(source, stored.results || [], acquisition.results || []);
}
