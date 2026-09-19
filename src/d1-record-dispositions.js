import { cleanText } from "./security-policy.js";

function fromRow(row) {
  return {
    recordId: row.record_id,
    disposition: row.disposition,
    reason: row.reason || "",
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function recordDispositionsResponse(request, env, db, principal, segments, {
  allRecords,
  error,
  hasScope,
  json,
  recordActivity,
  safeJson,
}) {
  const scope = request.method === "GET" ? "tracking:read" : "tracking:write";
  if (!hasScope(principal, scope)) return error("insufficient_scope", `Scope ${scope} is required`, 403);
  const recordId = cleanText(decodeURIComponent(segments[0] || ""), 180);
  if (request.method === "GET" && !recordId) {
    const result = await db.prepare("SELECT * FROM dbi_workspace_record_dispositions WHERE workspace_id = ? ORDER BY updated_at DESC").bind(principal.workspaceId).all();
    return json((result.results || []).map(fromRow), 200, { total: result.results?.length || 0 });
  }
  if (!recordId) return error("record_id_required", "A stable record ID is required", 400);
  if (request.method === "PUT") {
    const body = await safeJson(request);
    if (cleanText(body?.disposition, 40) !== "tombstoned") return error("invalid_disposition", "Only the tombstoned disposition is supported", 400);
    const universe = await allRecords(request, env, db, principal.workspaceId);
    if (!universe.records.some((record) => record.opportunityId === recordId)) return error("record_not_found", "Only an existing stable record ID can be tombstoned", 404);
    const now = new Date().toISOString();
    await db.prepare(`INSERT INTO dbi_workspace_record_dispositions
      (workspace_id, record_id, disposition, reason, created_by, created_at, updated_at)
      VALUES (?, ?, 'tombstoned', ?, ?, ?, ?)
      ON CONFLICT(workspace_id, record_id) DO UPDATE SET disposition = 'tombstoned', reason = excluded.reason, updated_at = excluded.updated_at`)
      .bind(principal.workspaceId, recordId, cleanText(body?.reason, 500), principal.id, now, now).run();
    const row = await db.prepare("SELECT * FROM dbi_workspace_record_dispositions WHERE workspace_id = ? AND record_id = ?").bind(principal.workspaceId, recordId).first();
    await recordActivity(db, principal, "record_tombstoned", "record_disposition", recordId, { reason: row.reason || "" });
    return json(fromRow(row), 200);
  }
  if (request.method === "DELETE") {
    const changed = await db.prepare("DELETE FROM dbi_workspace_record_dispositions WHERE workspace_id = ? AND record_id = ?").bind(principal.workspaceId, recordId).run();
    if (!Number(changed?.meta?.changes || 0)) return error("disposition_not_found", "Tombstoned record not found", 404);
    await recordActivity(db, principal, "record_restored", "record_disposition", recordId);
    return new Response(null, { status: 204 });
  }
  return error("method_not_allowed", "Method not allowed", 405);
}
