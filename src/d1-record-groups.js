import { analyzeRecordGroupWithOpenAi, exactLifecycleEvidence, lifecycleTitleStem } from "./record-linking.js";
import { cleanText } from "./security-policy.js";

export const D1_RECORD_GROUP_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS dbi_workspace_record_groups (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, title TEXT NOT NULL,
    member_ids_json TEXT NOT NULL DEFAULT '[]', relationship TEXT NOT NULL DEFAULT 'related-workstream', confidence TEXT NOT NULL DEFAULT 'high',
    rationale TEXT NOT NULL DEFAULT '', evidence_json TEXT NOT NULL DEFAULT '[]', caveats_json TEXT NOT NULL DEFAULT '[]', provenance_json TEXT NOT NULL DEFAULT '{}',
    created_by TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
  "CREATE INDEX IF NOT EXISTS idx_dbi_record_groups_workspace ON dbi_workspace_record_groups (workspace_id, updated_at DESC)",
];

function parsed(value, fallback) {
  try { return JSON.parse(value || ""); }
  catch { return fallback; }
}

function publicRow(row) {
  return {
    id: row.id,
    title: row.title,
    memberIds: parsed(row.member_ids_json, []),
    relationship: row.relationship,
    confidence: row.confidence,
    rationale: row.rationale || "",
    evidence: parsed(row.evidence_json, []),
    caveats: parsed(row.caveats_json, []),
    provenance: parsed(row.provenance_json, {}),
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mockAssessment(records) {
  const exact = records.length === 2 ? exactLifecycleEvidence(records[0], records[1]) : null;
  return exact ? {
    decision: "group",
    title: exact.title,
    relationship: exact.relationship,
    confidence: "high",
    rationale: "The records are successive phases of one published requirement and retain distinct award identities.",
    evidence: exact.basis,
    caveats: [],
    memberIds: records.map((record) => record.opportunityId),
    provenance: { kind: "openai-review", reviewState: "accepted", model: "mock-record-linker", responseId: "mock-record-linker", createdAt: new Date().toISOString() },
  } : {
    decision: "review",
    title: lifecycleTitleStem(records.at(-1)?.title) || "Related records",
    relationship: "related-workstream",
    confidence: "low",
    rationale: "The mock verifier did not find exact lifecycle evidence.",
    evidence: [],
    caveats: ["Manual review required"],
    memberIds: records.map((record) => record.opportunityId),
    provenance: { kind: "openai-review", reviewState: "needs_review", model: "mock-record-linker", responseId: "mock-record-linker", createdAt: new Date().toISOString() },
  };
}

export async function recordGroupsResponse(request, env, db, principal, segments, {
  allRecords,
  decryptSecret,
  error,
  hasScope,
  json,
  recordActivity,
  safeJson,
}) {
  const scope = request.method === "GET" ? "tracking:read" : "tracking:write";
  if (!hasScope(principal, scope)) return error("insufficient_scope", `Scope ${scope} is required`, 403);
  const groupId = cleanText(decodeURIComponent(segments[0] || ""), 180);
  if (request.method === "GET" && !groupId) {
    const result = await db.prepare("SELECT * FROM dbi_workspace_record_groups WHERE workspace_id = ? ORDER BY updated_at DESC").bind(principal.workspaceId).all();
    return json((result.results || []).map(publicRow), 200, { total: result.results?.length || 0 });
  }
  if (request.method === "DELETE" && groupId) {
    const changed = await db.prepare("DELETE FROM dbi_workspace_record_groups WHERE workspace_id = ? AND id = ?").bind(principal.workspaceId, groupId).run();
    if (!Number(changed?.meta?.changes || 0)) return error("record_group_not_found", "Lifecycle group not found", 404);
    await recordActivity(db, principal, "record_group_removed", "record_group", groupId);
    return new Response(null, { status: 204 });
  }
  if (request.method !== "POST" || groupId) return error("method_not_allowed", "Method not allowed", 405);
  const body = await safeJson(request);
  const memberIds = [...new Set((Array.isArray(body?.memberIds) ? body.memberIds : []).map((value) => cleanText(value, 180)).filter(Boolean))].slice(0, 8);
  if (memberIds.length < 2) return error("member_ids_required", "Select at least two records", 400);
  const universe = await allRecords(request, env, db, principal.workspaceId);
  const byId = new Map(universe.records.map((record) => [record.opportunityId, record]));
  const records = memberIds.map((id) => byId.get(id)).filter(Boolean);
  if (records.length !== memberIds.length) return error("record_not_found", "Every selected record must exist in the active workspace corpus", 404);
  const credential = await db.prepare("SELECT * FROM dbi_openai_keys WHERE workspace_id = ? AND scope_type = 'workspace' AND revoked_at = '' ORDER BY is_default DESC, created_at DESC LIMIT 1").bind(principal.workspaceId).first();
  const apiKey = credential ? await decryptSecret(credential, env) : "";
  if (!apiKey) return error("credential_unavailable", "Configure an active workspace OpenAI credential before AI grouping", 409);
  const mockMode = String(env.DBI_RECORD_LINKING_MOCK_MODE || env.DBI_EVENT_AI_MOCK_MODE || "").toLowerCase() === "true";
  let assessment;
  try {
    assessment = mockMode ? mockAssessment(records) : await analyzeRecordGroupWithOpenAi({ apiKey, records });
  } catch (providerError) {
    return error(cleanText(providerError.code, 100) || "openai_failed", cleanText(providerError.message, 500) || "OpenAI could not review the selected records", Number(providerError.httpStatus || 502));
  }
  if (assessment.decision !== "group" || assessment.confidence !== "high") {
    return json(null, 200, { decision: assessment.decision, confidence: assessment.confidence, message: assessment.rationale || "OpenAI did not find high-confidence evidence that these records form one lifecycle.", assessment });
  }
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  const existing = await db.prepare("SELECT id, member_ids_json FROM dbi_workspace_record_groups WHERE workspace_id = ?").bind(principal.workspaceId).all();
  const conflicts = (existing.results || []).filter((row) => parsed(row.member_ids_json, []).some((memberId) => memberIds.includes(memberId))).map((row) => row.id);
  const statements = conflicts.map((conflictId) => db.prepare("DELETE FROM dbi_workspace_record_groups WHERE workspace_id = ? AND id = ?").bind(principal.workspaceId, conflictId));
  statements.push(db.prepare(`INSERT INTO dbi_workspace_record_groups
    (id, workspace_id, title, member_ids_json, relationship, confidence, rationale, evidence_json, caveats_json, provenance_json, created_by, created_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(
      id, principal.workspaceId, cleanText(assessment.title, 240), JSON.stringify(memberIds), cleanText(assessment.relationship, 80), assessment.confidence,
      cleanText(assessment.rationale, 1200), JSON.stringify(assessment.evidence || []), JSON.stringify(assessment.caveats || []), JSON.stringify(assessment.provenance || {}),
      principal.id, now, now,
    ));
  await db.batch(statements);
  if (credential?.id) await db.prepare("UPDATE dbi_openai_keys SET last_used_at = ?, updated_at = ? WHERE id = ?").bind(now, now, credential.id).run();
  const row = await db.prepare("SELECT * FROM dbi_workspace_record_groups WHERE workspace_id = ? AND id = ?").bind(principal.workspaceId, id).first();
  await recordActivity(db, principal, "record_group_created", "record_group", id, { memberIds, relationship: assessment.relationship, confidence: assessment.confidence });
  return json(publicRow(row), 201, { decision: assessment.decision, confidence: assessment.confidence });
}
