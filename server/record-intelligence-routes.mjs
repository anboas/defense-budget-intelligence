import { randomUUID } from "node:crypto";
import { accessCapabilities } from "../src/access-model.js";
import { analyzeRecordGroupWithOpenAi, exactFollowOnEvidence, exactLifecycleEvidence, exactRecordGroupAssessment } from "../src/record-linking.js";
import { rankResearchCandidates, researchRecordWithOpenAi } from "../src/record-research.js";
import { cleanText } from "../src/security-policy.js";
import { recordUniverse } from "./record-universe.mjs";

function jsonValue(value, fallback) { if (value && typeof value === "object") return value; try { return JSON.parse(value || ""); } catch { return fallback; } }
function publicResearch(row) { return { id: row.id, opportunityId: row.opportunity_id, ...jsonValue(row.report_json, {}), createdBy: row.created_by, createdAt: row.created_at }; }
function publicRelationship(row) { return { id: row.id, sourceId: row.source_id, targetId: row.target_id, relationship: row.relationship, confidence: row.confidence, rationale: row.rationale || "", evidence: jsonValue(row.evidence_json, []), sourceUrls: jsonValue(row.source_urls_json, []), caveats: jsonValue(row.caveats_json, []), provenance: jsonValue(row.provenance_json, {}), createdBy: row.created_by, createdAt: row.created_at, updatedAt: row.updated_at }; }

function mockRelationshipAssessment(records) {
  const exact = exactFollowOnEvidence(records[0], records[1]) || exactLifecycleEvidence(records[0], records[1]);
  return exact ? {
    decision: "group", relationship: exact.relationship, confidence: "high", rationale: exact.basis.join("; "), evidence: exact.basis, caveats: [],
    provenance: { kind: "openai-review", reviewState: "accepted", model: "mock-record-linker", responseId: "mock-record-linker", createdAt: new Date().toISOString() },
  } : {
    decision: "review", relationship: "related-workstream", confidence: "low", rationale: "The mock verifier did not find exact relationship evidence.", evidence: [], caveats: ["Manual review required"],
    provenance: { kind: "openai-review", reviewState: "needs_review", model: "mock-record-linker", responseId: "mock-record-linker", createdAt: new Date().toISOString() },
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
    decisionBrief: { recommendedAction: exact ? "pursue" : "research", priority: exact ? "high" : "medium", rationale: exact ? "Published lifecycle evidence supports near-term qualification." : "Additional official evidence is needed before qualification.", sourceUrls: sourceUrls.slice(0, 2) },
    keyDates: record.solicitationEnd && sourceUrls.length ? [{ label: "Response deadline", date: record.solicitationEnd, basis: "Published acquisition response deadline.", sourceUrls: sourceUrls.slice(0, 1) }] : [],
    nextActions: sourceUrls.length ? [{ action: "Review the latest official notice and attachments.", rationale: "Confirm scope, timing, and qualification evidence before a bid decision.", sourceUrls: sourceUrls.slice(0, 2) }] : [],
    findings: sourceUrls.length ? [{ text: "The retained public record and relationship evidence were reviewed.", sourceUrls: sourceUrls.slice(0, 2) }] : [],
    risks: [], openQuestions: ["Confirm any unpublished amendments or acquisition strategy changes."], caveats: ["Human review required."],
    sources: sourceUrls.map((url) => ({ url, title: "Official source" })),
    relationshipProposals: exact ? [{ targetId: exact.sourceId === record.opportunityId ? exact.targetId : exact.sourceId, relationship: exact.relationship, confidence: "high", rationale: exact.basis.join("; "), sourceUrls, caveats: [] }] : [],
    provenance: { kind: "openai-web-research", reviewState: "needs_review", model: "mock-record-research", responseId: "mock-record-research", createdAt: new Date().toISOString() },
  };
}

function relationshipFromAssessment(records, assessment) {
  const exact = exactFollowOnEvidence(records[0], records[1]) || exactLifecycleEvidence(records[0], records[1]);
  const ordered = [...records].sort((left, right) => String(left.start || left.solicitationStart || "9999").localeCompare(String(right.start || right.solicitationStart || "9999")));
  return { sourceId: exact?.sourceId || ordered[0].opportunityId, targetId: exact?.targetId || ordered[1].opportunityId, relationship: exact?.relationship || assessment.relationship || "related-workstream", confidence: exact?.confidence || assessment.confidence, rationale: assessment.rationale || (exact ? exact.basis.join("; ") : "OpenAI found a high-confidence public-record relationship."), evidence: exact?.basis || assessment.evidence || [], sourceUrls: [...new Set(records.flatMap((record) => record.sourceUrls || []))].slice(0, 8), caveats: assessment.caveats || [], provenance: exact ? { kind: "exact-rule", reviewState: "accepted", model: null, createdAt: null } : assessment.provenance };
}

async function saveRelationship(pool, user, relationship) {
  const result = await pool.query(`INSERT INTO app_workspace_record_relationships
    (id,workspace_id,source_id,target_id,relationship,confidence,rationale,evidence_json,source_urls_json,caveats_json,provenance_json,created_by)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10::jsonb,$11::jsonb,$12)
    ON CONFLICT (workspace_id,source_id,target_id,relationship) DO UPDATE SET confidence=EXCLUDED.confidence,rationale=EXCLUDED.rationale,
      evidence_json=EXCLUDED.evidence_json,source_urls_json=EXCLUDED.source_urls_json,caveats_json=EXCLUDED.caveats_json,provenance_json=EXCLUDED.provenance_json,updated_at=NOW()
    RETURNING *`, [randomUUID(), user.active_workspace_id, relationship.sourceId, relationship.targetId, relationship.relationship, relationship.confidence, cleanText(relationship.rationale, 1200), JSON.stringify(relationship.evidence || []), JSON.stringify(relationship.sourceUrls || []), JSON.stringify(relationship.caveats || []), JSON.stringify(relationship.provenance || {}), user.actor_user_id || user.user_id]);
  return publicRelationship(result.rows[0]);
}

export function registerRecordIntelligenceRoutes(app, pool, { assertSameOrigin, authenticated, decryptSecret }) {
  app.get("/api/v1/agent/record-intelligence/:recordId", async (request, reply) => {
    const user = await authenticated(pool, request);
    if (!user) return reply.code(401).send({ error: "sign in required" });
    if (!user.active_workspace_id) return { data: { reports: [], relationships: [] } };
    const recordId = cleanText(request.params.recordId, 180);
    const [research, relationships] = await Promise.all([
      pool.query("SELECT * FROM app_workspace_record_research WHERE workspace_id=$1 AND opportunity_id=$2 ORDER BY created_at DESC LIMIT 8", [user.active_workspace_id, recordId]),
      pool.query("SELECT * FROM app_workspace_record_relationships WHERE workspace_id=$1 AND (source_id=$2 OR target_id=$2) ORDER BY updated_at DESC", [user.active_workspace_id, recordId]),
    ]);
    return { data: { reports: research.rows.map(publicResearch), relationships: relationships.rows.map(publicRelationship) } };
  });

  app.post("/api/v1/agent/record-intelligence/relationships", async (request, reply) => {
    if (!assertSameOrigin(request, reply)) return;
    const user = await authenticated(pool, request);
    if (!user) return reply.code(401).send({ error: "sign in required" });
    if (!user.active_workspace_id) return reply.code(409).send({ error: "select a workspace first" });
    if (!accessCapabilities(user.role, user.membership_role, { isEmulating: Boolean(user.is_emulating) }).canWriteWorkspace) return reply.code(403).send({ error: "workspace write access is required" });
    const memberIds = [...new Set((Array.isArray(request.body?.memberIds) ? request.body.memberIds : []).map((value) => cleanText(value, 180)).filter(Boolean))].slice(0, 2);
    if (memberIds.length !== 2) return reply.code(400).send({ error: "select exactly two records to link" });
    const universe = await recordUniverse(pool, user.active_workspace_id);
    const byId = new Map(universe.map((record) => [record.opportunityId, record]));
    const records = memberIds.map((id) => byId.get(id)).filter(Boolean);
    if (records.length !== 2) return reply.code(404).send({ error: "both records must exist in the active workspace corpus" });
    const exact = exactRecordGroupAssessment(records);
    const stored = exact ? { rowCount: 0, rows: [] } : await pool.query("SELECT * FROM app_openai_keys WHERE scope_type='workspace' AND workspace_id=$1 AND revoked_at IS NULL ORDER BY is_default DESC,created_at DESC LIMIT 1", [user.active_workspace_id]);
    const apiKey = stored.rowCount ? decryptSecret(stored.rows[0]) : "";
    if (!exact && !apiKey) return reply.code(409).send({ error: "configure an active workspace OpenAI credential first", code: "credential_unavailable" });
    const mockMode = String(process.env.DBI_RECORD_RESEARCH_MOCK_MODE || process.env.DBI_RECORD_LINKING_MOCK_MODE || process.env.DBI_EVENT_AI_MOCK_MODE || "").toLowerCase() === "true";
    let assessment;
    try {
      assessment = exact || (mockMode ? mockRelationshipAssessment(records) : await analyzeRecordGroupWithOpenAi({ apiKey, records }));
    } catch (error) { return reply.code(Number(error.httpStatus || 502)).send({ error: cleanText(error.message, 500), code: cleanText(error.code, 100) || "openai_failed" }); }
    if (assessment.decision !== "group" || !["high", "exact"].includes(assessment.confidence)) return { data: null, meta: { decision: assessment.decision, confidence: assessment.confidence, message: assessment.rationale, assessment } };
    const relationship = await saveRelationship(pool, user, relationshipFromAssessment(records, assessment));
    return reply.code(201).send({ data: relationship });
  });

  app.delete("/api/v1/agent/record-intelligence/relationships/:relationshipId", async (request, reply) => {
    if (!assertSameOrigin(request, reply)) return;
    const user = await authenticated(pool, request);
    if (!user) return reply.code(401).send({ error: "sign in required" });
    const result = await pool.query("DELETE FROM app_workspace_record_relationships WHERE workspace_id=$1 AND id=$2 RETURNING id", [user.active_workspace_id, cleanText(request.params.relationshipId, 180)]);
    if (!result.rowCount) return reply.code(404).send({ error: "record relationship not found" });
    return reply.code(204).send();
  });

  app.post("/api/v1/agent/record-intelligence/:recordId/research", async (request, reply) => {
    if (!assertSameOrigin(request, reply)) return;
    const user = await authenticated(pool, request);
    if (!user) return reply.code(401).send({ error: "sign in required" });
    if (!user.active_workspace_id) return reply.code(409).send({ error: "select a workspace first" });
    if (!accessCapabilities(user.role, user.membership_role, { isEmulating: Boolean(user.is_emulating) }).canWriteWorkspace) return reply.code(403).send({ error: "workspace write access is required" });
    const universe = await recordUniverse(pool, user.active_workspace_id);
    const byId = new Map(universe.map((record) => [record.opportunityId, record]));
    const record = byId.get(cleanText(request.params.recordId, 180));
    if (!record) return reply.code(404).send({ error: "record not found in the active workspace corpus" });
    const stored = await pool.query("SELECT * FROM app_openai_keys WHERE scope_type='workspace' AND workspace_id=$1 AND revoked_at IS NULL ORDER BY is_default DESC,created_at DESC LIMIT 1", [user.active_workspace_id]);
    const apiKey = stored.rowCount ? decryptSecret(stored.rows[0]) : "";
    if (!apiKey) return reply.code(409).send({ error: "configure an active workspace OpenAI credential first", code: "credential_unavailable" });
    const mockMode = String(process.env.DBI_RECORD_RESEARCH_MOCK_MODE || process.env.DBI_RECORD_LINKING_MOCK_MODE || process.env.DBI_EVENT_AI_MOCK_MODE || "").toLowerCase() === "true";
    const candidates = rankResearchCandidates(record, universe);
    let report;
    try { report = mockMode ? mockResearch(record, candidates) : await researchRecordWithOpenAi({ apiKey, record, candidates }); }
    catch (error) { return reply.code(Number(error.httpStatus || 502)).send({ error: cleanText(error.message, 500), code: cleanText(error.code, 100) || "openai_failed" }); }
    const id = randomUUID();
    const inserted = await pool.query("INSERT INTO app_workspace_record_research (id,workspace_id,opportunity_id,report_json,created_by) VALUES ($1,$2,$3,$4::jsonb,$5) RETURNING *", [id, user.active_workspace_id, record.opportunityId, JSON.stringify(report), user.actor_user_id || user.user_id]);
    const savedRelationships = [];
    for (const proposal of report.relationshipProposals || []) {
      if (proposal.confidence !== "high" || !byId.has(proposal.targetId)) continue;
      savedRelationships.push(await saveRelationship(pool, user, relationshipFromAssessment([record, byId.get(proposal.targetId)], { ...proposal, evidence: proposal.sourceUrls, provenance: report.provenance })));
    }
    if (stored.rowCount) await pool.query("UPDATE app_openai_keys SET last_used_at=NOW(),updated_at=NOW() WHERE id=$1", [stored.rows[0].id]);
    return reply.code(201).send({ data: { report: publicResearch(inserted.rows[0]), relationships: savedRelationships } });
  });
}
