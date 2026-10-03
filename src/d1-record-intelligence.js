import { analyzeRecordGroupWithOpenAi, exactFollowOnEvidence, exactLifecycleEvidence } from "./record-linking.js";
import { rankResearchCandidates, researchRecordWithOpenAi } from "./record-research.js";
import { cleanText } from "./security-policy.js";

export const D1_RECORD_INTELLIGENCE_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS dbi_workspace_record_research (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, opportunity_id TEXT NOT NULL,
    report_json TEXT NOT NULL DEFAULT '{}', created_by TEXT NOT NULL, created_at TEXT NOT NULL)`,
  "CREATE INDEX IF NOT EXISTS idx_dbi_record_research_workspace_record ON dbi_workspace_record_research (workspace_id, opportunity_id, created_at DESC)",
  `CREATE TABLE IF NOT EXISTS dbi_workspace_record_relationships (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, source_id TEXT NOT NULL,
    target_id TEXT NOT NULL, relationship TEXT NOT NULL, confidence TEXT NOT NULL DEFAULT 'high', rationale TEXT NOT NULL DEFAULT '',
    evidence_json TEXT NOT NULL DEFAULT '[]', source_urls_json TEXT NOT NULL DEFAULT '[]', caveats_json TEXT NOT NULL DEFAULT '[]',
    provenance_json TEXT NOT NULL DEFAULT '{}', created_by TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
  "CREATE UNIQUE INDEX IF NOT EXISTS idx_dbi_record_relationship_unique ON dbi_workspace_record_relationships (workspace_id, source_id, target_id, relationship)",
  "CREATE INDEX IF NOT EXISTS idx_dbi_record_relationship_source ON dbi_workspace_record_relationships (workspace_id, source_id, updated_at DESC)",
  "CREATE INDEX IF NOT EXISTS idx_dbi_record_relationship_target ON dbi_workspace_record_relationships (workspace_id, target_id, updated_at DESC)",
];

function parsed(value, fallback) { try { return JSON.parse(value || ""); } catch { return fallback; } }
function publicResearch(row) { return { id: row.id, opportunityId: row.opportunity_id, ...parsed(row.report_json, {}), createdBy: row.created_by, createdAt: row.created_at }; }
function publicRelationship(row) {
  return {
    id: row.id, sourceId: row.source_id, targetId: row.target_id, relationship: row.relationship, confidence: row.confidence,
    rationale: row.rationale || "", evidence: parsed(row.evidence_json, []), sourceUrls: parsed(row.source_urls_json, []),
    caveats: parsed(row.caveats_json, []), provenance: parsed(row.provenance_json, {}), createdBy: row.created_by,
    createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

function relationshipFromAssessment(records, assessment) {
  const exact = exactFollowOnEvidence(records[0], records[1]);
  const ordered = [...records].sort((left, right) => String(left.start || left.solicitationStart || "9999").localeCompare(String(right.start || right.solicitationStart || "9999")));
  return {
    sourceId: exact?.sourceId || ordered[0].opportunityId,
    targetId: exact?.targetId || ordered[1].opportunityId,
    relationship: exact?.relationship || assessment.relationship || "related-workstream",
    confidence: exact?.confidence || assessment.confidence,
    rationale: assessment.rationale || (exact ? "Published program identity, acquisition codes, buyer context, and timing identify a follow-on." : "OpenAI found a high-confidence public-record relationship."),
    evidence: exact?.basis || assessment.evidence || [],
    sourceUrls: [...new Set(records.flatMap((record) => record.sourceUrls || []))].slice(0, 8),
    caveats: assessment.caveats || [],
    provenance: exact ? { kind: "exact-rule", reviewState: "accepted", model: null, createdAt: null } : assessment.provenance,
  };
}

function mockResearch(record, candidates) {
  const exact = candidates.map((candidate) => exactFollowOnEvidence(record, candidate)).find(Boolean);
  const sourceUrls = [...new Set([...(record.sourceUrls || []), ...candidates.flatMap((candidate) => candidate.sourceUrls || [])])].filter((url) => /^https:\/\//i.test(url)).slice(0, 8);
  return {
    opportunityId: record.opportunityId,
    summary: `Official-source research for ${record.title}`,
    stage: record.noticeType || record.lifecycleStatus || "Published record",
    scope: record.context || record.sourceDescription || record.title,
    incumbentPosture: exact ? "A published active-work record is linked to this acquisition as a follow-on candidate." : "No incumbent relationship was established by the mock verifier.",
    findings: sourceUrls.length ? [{ text: "The retained public record and relationship evidence were reviewed.", sourceUrls: sourceUrls.slice(0, 2) }] : [],
    risks: [], openQuestions: ["Confirm any unpublished amendments or acquisition strategy changes."], caveats: ["Human review required."], sources: sourceUrls.map((url) => ({ url, title: "Official source" })),
    relationshipProposals: exact ? [{ targetId: exact.sourceId === record.opportunityId ? exact.targetId : exact.sourceId, relationship: exact.relationship, confidence: "high", rationale: exact.basis.join("; "), sourceUrls, caveats: [] }] : [],
    provenance: { kind: "openai-web-research", reviewState: "needs_review", model: "mock-record-research", responseId: "mock-record-research", createdAt: new Date().toISOString() },
  };
}

function mockRelationshipAssessment(records) {
  const exactFollowOn = exactFollowOnEvidence(records[0], records[1]);
  const exactLifecycle = exactLifecycleEvidence(records[0], records[1]);
  const exact = exactFollowOn || exactLifecycle;
  return exact ? {
    decision: "group",
    relationship: exact.relationship,
    confidence: "high",
    rationale: exact.basis.join("; "),
    evidence: exact.basis,
    caveats: [],
    provenance: { kind: "openai-review", reviewState: "accepted", model: "mock-record-linker", responseId: "mock-record-linker", createdAt: new Date().toISOString() },
  } : {
    decision: "review",
    relationship: "related-workstream",
    confidence: "low",
    rationale: "The mock verifier did not find exact relationship evidence.",
    evidence: [],
    caveats: ["Manual review required"],
    provenance: { kind: "openai-review", reviewState: "needs_review", model: "mock-record-linker", responseId: "mock-record-linker", createdAt: new Date().toISOString() },
  };
}

async function saveRelationship(db, principal, relationship, recordActivity) {
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  await db.prepare(`INSERT INTO dbi_workspace_record_relationships
    (id, workspace_id, source_id, target_id, relationship, confidence, rationale, evidence_json, source_urls_json, caveats_json, provenance_json, created_by, created_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(workspace_id, source_id, target_id, relationship) DO UPDATE SET confidence=excluded.confidence, rationale=excluded.rationale,
      evidence_json=excluded.evidence_json, source_urls_json=excluded.source_urls_json, caveats_json=excluded.caveats_json,
      provenance_json=excluded.provenance_json, updated_at=excluded.updated_at`).bind(
    id, principal.workspaceId, relationship.sourceId, relationship.targetId, relationship.relationship, relationship.confidence,
    cleanText(relationship.rationale, 1200), JSON.stringify(relationship.evidence || []), JSON.stringify(relationship.sourceUrls || []),
    JSON.stringify(relationship.caveats || []), JSON.stringify(relationship.provenance || {}), principal.id, now, now,
  ).run();
  const row = await db.prepare(`SELECT * FROM dbi_workspace_record_relationships WHERE workspace_id=? AND source_id=? AND target_id=? AND relationship=?`)
    .bind(principal.workspaceId, relationship.sourceId, relationship.targetId, relationship.relationship).first();
  await recordActivity(db, principal, "record_relationship_saved", "record_relationship", row.id, { sourceId: relationship.sourceId, targetId: relationship.targetId, relationship: relationship.relationship });
  return publicRelationship(row);
}

export async function recordIntelligenceResponse(request, env, db, principal, segments, deps) {
  const { allRecords, decryptSecret, error, hasScope, json, recordActivity, safeJson } = deps;
  const scope = request.method === "GET" ? "tracking:read" : "tracking:write";
  if (!hasScope(principal, scope)) return error("insufficient_scope", `Scope ${scope} is required`, 403);
  const [first = "", second = ""] = segments.map((value) => cleanText(decodeURIComponent(value || ""), 180));
  if (request.method === "GET" && first && !second && first !== "relationships") {
    const [research, relationships] = await Promise.all([
      db.prepare("SELECT * FROM dbi_workspace_record_research WHERE workspace_id=? AND opportunity_id=? ORDER BY created_at DESC LIMIT 8").bind(principal.workspaceId, first).all(),
      db.prepare("SELECT * FROM dbi_workspace_record_relationships WHERE workspace_id=? AND (source_id=? OR target_id=?) ORDER BY updated_at DESC").bind(principal.workspaceId, first, first).all(),
    ]);
    return json({ reports: (research.results || []).map(publicResearch), relationships: (relationships.results || []).map(publicRelationship) });
  }
  if (request.method === "DELETE" && first === "relationships" && second) {
    const changed = await db.prepare("DELETE FROM dbi_workspace_record_relationships WHERE workspace_id=? AND id=?").bind(principal.workspaceId, second).run();
    if (!Number(changed?.meta?.changes || 0)) return error("record_relationship_not_found", "Record relationship not found", 404);
    await recordActivity(db, principal, "record_relationship_removed", "record_relationship", second);
    return new Response(null, { status: 204 });
  }
  const universe = await allRecords(request, env, db, principal.workspaceId);
  const byId = new Map(universe.records.map((record) => [record.opportunityId, record]));
  const credential = await db.prepare("SELECT * FROM dbi_openai_keys WHERE workspace_id=? AND scope_type='workspace' AND revoked_at='' ORDER BY is_default DESC, created_at DESC LIMIT 1").bind(principal.workspaceId).first();
  const apiKey = credential ? await decryptSecret(credential, env) : "";
  if (!apiKey) return error("credential_unavailable", "Configure an active workspace OpenAI credential first", 409);
  const mockMode = String(env.DBI_RECORD_RESEARCH_MOCK_MODE || env.DBI_RECORD_LINKING_MOCK_MODE || env.DBI_EVENT_AI_MOCK_MODE || "").toLowerCase() === "true";
  if (request.method === "POST" && first === "relationships" && !second) {
    const body = await safeJson(request);
    const memberIds = [...new Set((Array.isArray(body?.memberIds) ? body.memberIds : []).map((value) => cleanText(value, 180)).filter(Boolean))].slice(0, 2);
    if (memberIds.length !== 2) return error("member_ids_required", "Select exactly two records to link", 400);
    const records = memberIds.map((id) => byId.get(id)).filter(Boolean);
    if (records.length !== 2) return error("record_not_found", "Both records must exist in the active workspace corpus", 404);
    let assessment;
    try {
      const exact = exactFollowOnEvidence(records[0], records[1]);
      assessment = exact ? { decision: "group", relationship: exact.relationship, confidence: "exact", rationale: exact.basis.join("; "), evidence: exact.basis, caveats: [], provenance: { kind: "exact-rule", reviewState: "accepted" } }
        : mockMode ? mockRelationshipAssessment(records) : await analyzeRecordGroupWithOpenAi({ apiKey, records });
    } catch (providerError) { return error(cleanText(providerError.code, 100) || "openai_failed", cleanText(providerError.message, 500), Number(providerError.httpStatus || 502)); }
    if (assessment.decision !== "group" || !["high", "exact"].includes(assessment.confidence)) return json(null, 200, { decision: assessment.decision, confidence: assessment.confidence, message: assessment.rationale, assessment });
    const saved = await saveRelationship(db, principal, relationshipFromAssessment(records, assessment), recordActivity);
    return json(saved, 201);
  }
  if (request.method === "POST" && first && second === "research") {
    const record = byId.get(first);
    if (!record) return error("record_not_found", "Record not found in the active workspace corpus", 404);
    const candidates = rankResearchCandidates(record, universe.records);
    let report;
    try { report = mockMode ? mockResearch(record, candidates) : await researchRecordWithOpenAi({ apiKey, record, candidates }); }
    catch (providerError) { return error(cleanText(providerError.code, 100) || "openai_failed", cleanText(providerError.message, 500), Number(providerError.httpStatus || 502)); }
    const now = new Date().toISOString();
    const id = crypto.randomUUID();
    await db.prepare("INSERT INTO dbi_workspace_record_research (id,workspace_id,opportunity_id,report_json,created_by,created_at) VALUES (?,?,?,?,?,?)")
      .bind(id, principal.workspaceId, first, JSON.stringify(report), principal.id, now).run();
    const savedRelationships = [];
    for (const proposal of report.relationshipProposals || []) {
      if (proposal.confidence !== "high" || !byId.has(proposal.targetId)) continue;
      const records = [record, byId.get(proposal.targetId)];
      savedRelationships.push(await saveRelationship(db, principal, relationshipFromAssessment(records, { ...proposal, evidence: proposal.sourceUrls, provenance: report.provenance }), recordActivity));
    }
    if (credential?.id) await db.prepare("UPDATE dbi_openai_keys SET last_used_at=?, updated_at=? WHERE id=?").bind(now, now, credential.id).run();
    await recordActivity(db, principal, "record_research_completed", "record", first, { reportId: id, relationshipCount: savedRelationships.length });
    return json({ report: { id, ...report, createdBy: principal.id, createdAt: now }, relationships: savedRelationships }, 201);
  }
  return error("method_not_allowed", "Method not allowed", 405);
}
