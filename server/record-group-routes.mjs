import { randomUUID } from "node:crypto";
import { accessCapabilities } from "../src/access-model.js";
import { analyzeRecordGroupWithOpenAi, exactLifecycleEvidence, exactRecordGroupAssessment, lifecycleTitleStem } from "../src/record-linking.js";
import { cleanText } from "../src/security-policy.js";
import { recordUniverse } from "./record-universe.mjs";
import { consumeAiOperationLimit, sendAiRateLimit } from "./ai-operation-rate-limit.mjs";

function publicRow(row) {
  return {
    id: row.id,
    title: row.title,
    memberIds: row.member_ids_json || [],
    relationship: row.relationship,
    confidence: row.confidence,
    rationale: row.rationale || "",
    evidence: row.evidence_json || [],
    caveats: row.caveats_json || [],
    provenance: row.provenance_json || {},
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mockAssessment(records) {
  const exact = records.length === 2 ? exactLifecycleEvidence(records[0], records[1]) : null;
  return exact ? {
    decision: "group", title: exact.title, relationship: exact.relationship, confidence: "high",
    rationale: "The records are successive phases of one published requirement and retain distinct award identities.",
    evidence: exact.basis, caveats: [], memberIds: records.map((record) => record.opportunityId),
    provenance: { kind: "openai-review", reviewState: "accepted", model: "mock-record-linker", responseId: "mock-record-linker", createdAt: new Date().toISOString() },
  } : {
    decision: "review", title: lifecycleTitleStem(records.at(-1)?.title) || "Related records", relationship: "related-workstream", confidence: "low",
    rationale: "The mock verifier did not find exact lifecycle evidence.", evidence: [], caveats: ["Manual review required"], memberIds: records.map((record) => record.opportunityId),
    provenance: { kind: "openai-review", reviewState: "needs_review", model: "mock-record-linker", responseId: "mock-record-linker", createdAt: new Date().toISOString() },
  };
}

export function registerRecordGroupRoutes(app, pool, { assertSameOrigin, authenticated, decryptSecret }) {
  app.get("/api/v1/agent/record-groups", async (request, reply) => {
    const user = await authenticated(pool, request);
    if (!user) return reply.code(401).send({ error: "sign in required" });
    if (!user.active_workspace_id) return { data: [], meta: { total: 0 } };
    const result = await pool.query("SELECT * FROM app_workspace_record_groups WHERE workspace_id = $1 ORDER BY updated_at DESC", [user.active_workspace_id]);
    return { data: result.rows.map(publicRow), meta: { total: result.rowCount } };
  });

  app.post("/api/v1/agent/record-groups", async (request, reply) => {
    if (!assertSameOrigin(request, reply)) return;
    const user = await authenticated(pool, request);
    if (!user) return reply.code(401).send({ error: "sign in required" });
    if (!user.active_workspace_id) return reply.code(409).send({ error: "select a workspace first" });
    if (!accessCapabilities(user.role, user.membership_role, { isEmulating: Boolean(user.is_emulating) }).canWriteWorkspace) return reply.code(403).send({ error: "workspace write access is required" });
    const memberIds = [...new Set((Array.isArray(request.body?.memberIds) ? request.body.memberIds : []).map((value) => cleanText(value, 180)).filter(Boolean))].slice(0, 8);
    if (memberIds.length < 2) return reply.code(400).send({ error: "select at least two records" });
    const universe = await recordUniverse(pool, user.active_workspace_id);
    const byId = new Map(universe.map((record) => [record.opportunityId, record]));
    const records = memberIds.map((id) => byId.get(id)).filter(Boolean);
    if (records.length !== memberIds.length) return reply.code(404).send({ error: "every selected record must exist in the active workspace corpus" });
    const exact = exactRecordGroupAssessment(records, { allowFollowOn: false });
    const stored = exact ? { rowCount: 0, rows: [] } : await pool.query("SELECT * FROM app_openai_keys WHERE scope_type = 'workspace' AND workspace_id = $1 AND revoked_at IS NULL ORDER BY is_default DESC, created_at DESC LIMIT 1", [user.active_workspace_id]);
    const apiKey = stored.rowCount ? decryptSecret(stored.rows[0]) : "";
    if (!exact && !apiKey) return reply.code(409).send({ error: "configure an active workspace OpenAI credential before AI grouping", code: "credential_unavailable" });
    if (!exact) {
      const quota = await consumeAiOperationLimit(pool, user);
      if (quota.limited) return sendAiRateLimit(reply, quota);
    }
    const mockMode = String(process.env.DBI_RECORD_LINKING_MOCK_MODE || process.env.DBI_EVENT_AI_MOCK_MODE || "").toLowerCase() === "true";
    let assessment;
    try { assessment = exact || (mockMode ? mockAssessment(records) : await analyzeRecordGroupWithOpenAi({ apiKey, records })); }
    catch (error) { return reply.code(Number(error.httpStatus || 502)).send({ error: cleanText(error.message, 500), code: cleanText(error.code, 100) || "openai_failed" }); }
    if (assessment.decision !== "group" || !["high", "exact"].includes(assessment.confidence)) return { data: null, meta: { decision: assessment.decision, confidence: assessment.confidence, message: assessment.rationale, assessment } };
    const conflicts = await pool.query("SELECT id FROM app_workspace_record_groups WHERE workspace_id = $1 AND member_ids_json ?| $2::text[]", [user.active_workspace_id, memberIds]);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      if (conflicts.rowCount) await client.query("DELETE FROM app_workspace_record_groups WHERE workspace_id = $1 AND id = ANY($2::uuid[])", [user.active_workspace_id, conflicts.rows.map((row) => row.id)]);
      const inserted = await client.query(`INSERT INTO app_workspace_record_groups
        (id, workspace_id, title, member_ids_json, relationship, confidence, rationale, evidence_json, caveats_json, provenance_json, created_by)
        VALUES ($1,$2,$3,$4::jsonb,$5,$6,$7,$8::jsonb,$9::jsonb,$10::jsonb,$11) RETURNING *`, [
        randomUUID(), user.active_workspace_id, cleanText(assessment.title, 240), JSON.stringify(memberIds), cleanText(assessment.relationship, 80), assessment.confidence,
        cleanText(assessment.rationale, 1200), JSON.stringify(assessment.evidence || []), JSON.stringify(assessment.caveats || []), JSON.stringify(assessment.provenance || {}), user.actor_user_id || user.user_id,
      ]);
      if (stored.rowCount) await client.query("UPDATE app_openai_keys SET last_used_at = NOW(), updated_at = NOW() WHERE id = $1", [stored.rows[0].id]);
      await client.query("COMMIT");
      return reply.code(201).send({ data: publicRow(inserted.rows[0]), meta: { decision: assessment.decision, confidence: assessment.confidence } });
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
  });

  app.delete("/api/v1/agent/record-groups/:groupId", async (request, reply) => {
    if (!assertSameOrigin(request, reply)) return;
    const user = await authenticated(pool, request);
    if (!user) return reply.code(401).send({ error: "sign in required" });
    if (!user.active_workspace_id) return reply.code(409).send({ error: "select a workspace first" });
    if (!accessCapabilities(user.role, user.membership_role, { isEmulating: Boolean(user.is_emulating) }).canWriteWorkspace) return reply.code(403).send({ error: "workspace write access is required" });
    const result = await pool.query("DELETE FROM app_workspace_record_groups WHERE workspace_id = $1 AND id = $2 RETURNING id", [user.active_workspace_id, cleanText(request.params.groupId, 180)]);
    if (!result.rowCount) return reply.code(404).send({ error: "lifecycle group not found" });
    return reply.code(204).send();
  });
}
