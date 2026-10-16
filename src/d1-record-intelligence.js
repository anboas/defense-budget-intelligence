import { analyzeRecordGroupWithOpenAi, exactFollowOnEvidence, exactLifecycleEvidence, exactRecordGroupAssessment } from "./record-linking.js";
import { deleteRecordResearchResponse, pollRecordResearchWithOpenAi, rankResearchCandidates, recordResearchRetryable, shouldRetainPriorResearch, startRecordResearchWithOpenAi } from "./record-research.js";
import { cleanText } from "./security-policy.js";
import { AI_OPERATION_LIMIT, AI_OPERATION_WINDOW_MINUTES, consumeD1AiOperationLimit } from "./d1-sensitive-rate-limit.js";

export const D1_RECORD_INTELLIGENCE_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS dbi_workspace_record_research (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, opportunity_id TEXT NOT NULL,
    report_json TEXT NOT NULL DEFAULT '{}', created_by TEXT NOT NULL, created_at TEXT NOT NULL)`,
  "CREATE INDEX IF NOT EXISTS idx_dbi_record_research_workspace_record ON dbi_workspace_record_research (workspace_id, opportunity_id, created_at DESC)",
  `CREATE TABLE IF NOT EXISTS dbi_workspace_record_research_jobs (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, opportunity_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'queued', response_id TEXT NOT NULL DEFAULT '', attempt INTEGER NOT NULL DEFAULT 1,
    report_id TEXT NOT NULL DEFAULT '', error_code TEXT NOT NULL DEFAULT '', error_message TEXT NOT NULL DEFAULT '',
    created_by TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, completed_at TEXT NOT NULL DEFAULT '')`,
  "CREATE INDEX IF NOT EXISTS idx_dbi_record_research_jobs_workspace_record ON dbi_workspace_record_research_jobs (workspace_id, opportunity_id, created_at DESC)",
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
function publicResearchJob(row) { return row ? { id: row.id, opportunityId: row.opportunity_id, status: row.status, attempt: Number(row.attempt || 1), reportId: row.report_id || "", retainedPriorReport: Boolean(row.report_id && row.report_id !== row.id), error: row.error_code ? { code: row.error_code, message: row.error_message } : null, createdAt: row.created_at, updatedAt: row.updated_at, completedAt: row.completed_at || "" } : null; }
function publicRelationship(row) {
  return {
    id: row.id, sourceId: row.source_id, targetId: row.target_id, relationship: row.relationship, confidence: row.confidence,
    rationale: row.rationale || "", evidence: parsed(row.evidence_json, []), sourceUrls: parsed(row.source_urls_json, []),
    caveats: parsed(row.caveats_json, []), provenance: parsed(row.provenance_json, {}), createdBy: row.created_by,
    createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

function relationshipFromAssessment(records, assessment) {
  const exact = exactFollowOnEvidence(records[0], records[1]) || exactLifecycleEvidence(records[0], records[1]);
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
    researchDisposition: sourceUrls.length ? "partial" : "no-public-evidence",
    summary: `Official-source research for ${record.title}`,
    stage: record.noticeType || record.lifecycleStatus || "Published record",
    scope: record.context || record.sourceDescription || record.title,
    incumbentPosture: exact ? "A published active-work record is linked to this acquisition as a follow-on candidate." : "No incumbent relationship was established by the mock verifier.",
    decisionBrief: { recommendedAction: exact ? "pursue" : "research", priority: exact ? "high" : "medium", rationale: exact ? "Published lifecycle evidence supports near-term qualification." : "Additional official evidence is needed before qualification.", sourceUrls: sourceUrls.slice(0, 2) },
    keyDates: record.solicitationEnd && sourceUrls.length ? [{ eventType: "proposal-deadline", label: "Response deadline", date: record.solicitationEnd, basis: "Published acquisition response deadline.", confidence: "high", sourceUrls: sourceUrls.slice(0, 1) }] : [],
    timelineAssessment: { status: record.solicitationEnd && sourceUrls.length ? "corroborated" : "unverified", rationale: record.solicitationEnd && sourceUrls.length ? "The published source provides the retained response deadline." : "No official source date was retained by the mock verifier.", sourceUrls: sourceUrls.slice(0, 1) },
    nextActions: sourceUrls.length ? [{ action: "Review the latest official notice and attachments.", rationale: "Confirm scope, timing, and qualification evidence before a bid decision.", sourceUrls: sourceUrls.slice(0, 2) }] : [],
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

async function aiQuotaResponse(db, principal, error) {
  const quota = await consumeD1AiOperationLimit(db, principal);
  return quota.limited
    ? error("ai_rate_limited", `AI research is limited to ${AI_OPERATION_LIMIT} provider operations per ${AI_OPERATION_WINDOW_MINUTES} minutes`, 429, undefined, { retryAfterSeconds: quota.retryAfter }, { "retry-after": String(quota.retryAfter) })
    : null;
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
  const [first = "", second = "", third = ""] = segments.map((value) => cleanText(decodeURIComponent(value || ""), 180));
  if (request.method === "GET" && first && !second && first !== "relationships") {
    const [research, relationships, jobs] = await Promise.all([
      db.prepare("SELECT * FROM dbi_workspace_record_research WHERE workspace_id=? AND opportunity_id=? ORDER BY created_at DESC LIMIT 8").bind(principal.workspaceId, first).all(),
      db.prepare("SELECT * FROM dbi_workspace_record_relationships WHERE workspace_id=? AND (source_id=? OR target_id=?) ORDER BY updated_at DESC").bind(principal.workspaceId, first, first).all(),
      db.prepare("SELECT * FROM dbi_workspace_record_research_jobs WHERE workspace_id=? AND opportunity_id=? ORDER BY created_at DESC LIMIT 8").bind(principal.workspaceId, first).all(),
    ]);
    return json({ reports: (research.results || []).map(publicResearch), relationships: (relationships.results || []).map(publicRelationship), jobs: (jobs.results || []).map(publicResearchJob) });
  }
  if (request.method === "DELETE" && first === "relationships" && second) {
    const changed = await db.prepare("DELETE FROM dbi_workspace_record_relationships WHERE workspace_id=? AND id=?").bind(principal.workspaceId, second).run();
    if (!Number(changed?.meta?.changes || 0)) return error("record_relationship_not_found", "Record relationship not found", 404);
    await recordActivity(db, principal, "record_relationship_removed", "record_relationship", second);
    return new Response(null, { status: 204 });
  }
  const universe = await allRecords(request, env, db, principal.workspaceId);
  const byId = new Map(universe.records.map((record) => [record.opportunityId, record]));
  const mockMode = String(env.DBI_RECORD_RESEARCH_MOCK_MODE || env.DBI_RECORD_LINKING_MOCK_MODE || env.DBI_EVENT_AI_MOCK_MODE || "").toLowerCase() === "true";
  if (request.method === "GET" && first && second === "jobs" && third) {
    let job = await db.prepare("SELECT * FROM dbi_workspace_record_research_jobs WHERE id=? AND workspace_id=? AND opportunity_id=?").bind(third, principal.workspaceId, first).first();
    if (!job) return error("research_job_not_found", "Research job not found", 404);
    if (["completed", "failed"].includes(job.status)) {
      const report = job.status === "completed" && job.report_id
        ? await db.prepare("SELECT * FROM dbi_workspace_record_research WHERE id=? AND workspace_id=? AND opportunity_id=?").bind(job.report_id, principal.workspaceId, first).first()
        : null;
      return json({ job: publicResearchJob(job), ...(report ? { report: publicResearch(report) } : {}) });
    }
    const record = byId.get(first);
    if (!record) return error("record_not_found", "Record not found in the active workspace corpus", 404);
    const credential = await db.prepare("SELECT * FROM dbi_openai_keys WHERE workspace_id=? AND scope_type='workspace' AND revoked_at='' ORDER BY is_default DESC, created_at DESC LIMIT 1").bind(principal.workspaceId).first();
    const apiKey = credential ? await decryptSecret(credential, env) : "";
    if (!apiKey) return error("credential_unavailable", "Configure an active workspace OpenAI credential first", 409);
    const candidates = rankResearchCandidates(record, universe.records);
    try {
      const result = await pollRecordResearchWithOpenAi({ apiKey, responseId: job.response_id, record, candidates });
      if (["queued", "in_progress"].includes(result.status)) {
        const now = new Date().toISOString();
        await db.prepare("UPDATE dbi_workspace_record_research_jobs SET status=?, updated_at=? WHERE id=?").bind(result.status, now, job.id).run();
        job = await db.prepare("SELECT * FROM dbi_workspace_record_research_jobs WHERE id=?").bind(job.id).first();
        return json({ job: publicResearchJob(job) }, 202);
      }
      const now = new Date().toISOString();
      const reportId = job.id;
      await db.prepare("INSERT OR IGNORE INTO dbi_workspace_record_research (id,workspace_id,opportunity_id,report_json,created_by,created_at) VALUES (?,?,?,?,?,?)")
        .bind(reportId, principal.workspaceId, first, JSON.stringify({ ...result.report, provenance: { ...result.report.provenance, attempts: Number(job.attempt || 1), degradedRetry: Number(job.attempt || 1) > 1 } }), principal.id, now).run();
      const savedRelationships = [];
      for (const proposal of result.report.relationshipProposals || []) {
        if (proposal.confidence !== "high" || !byId.has(proposal.targetId)) continue;
        savedRelationships.push(await saveRelationship(db, principal, relationshipFromAssessment([record, byId.get(proposal.targetId)], { ...proposal, evidence: proposal.sourceUrls, provenance: result.report.provenance }), recordActivity));
      }
      await db.prepare("UPDATE dbi_workspace_record_research_jobs SET status='completed', report_id=?, updated_at=?, completed_at=? WHERE id=?").bind(reportId, now, now, job.id).run();
      if (credential?.id) await db.prepare("UPDATE dbi_openai_keys SET last_used_at=?, updated_at=? WHERE id=?").bind(now, now, credential.id).run();
      await recordActivity(db, principal, "record_research_completed", "record", first, { jobId: job.id, reportId, relationshipCount: savedRelationships.length });
      await deleteRecordResearchResponse({ apiKey, responseId: job.response_id });
      job = await db.prepare("SELECT * FROM dbi_workspace_record_research_jobs WHERE id=?").bind(job.id).first();
      return json({ job: publicResearchJob(job), report: { id: reportId, ...result.report, provenance: { ...result.report.provenance, attempts: Number(job.attempt || 1), degradedRetry: Number(job.attempt || 1) > 1 }, createdBy: principal.id, createdAt: now }, relationships: savedRelationships });
    } catch (providerError) {
      const completed = await db.prepare("SELECT * FROM dbi_workspace_record_research_jobs WHERE id=?").bind(job.id).first();
      if (completed?.status === "completed" && completed.report_id) {
        const report = await db.prepare("SELECT * FROM dbi_workspace_record_research WHERE id=? AND workspace_id=?").bind(completed.report_id, principal.workspaceId).first();
        return json({ job: publicResearchJob(completed), ...(report ? { report: publicResearch(report) } : {}) });
      }
      if (["provider_timeout", "provider_unavailable"].includes(providerError?.code)) {
        const now = new Date().toISOString();
        await db.prepare("UPDATE dbi_workspace_record_research_jobs SET updated_at=? WHERE id=?").bind(now, job.id).run();
        job = await db.prepare("SELECT * FROM dbi_workspace_record_research_jobs WHERE id=?").bind(job.id).first();
        return json({ job: publicResearchJob(job) }, 202);
      }
      if (Number(job.attempt || 1) < 2 && recordResearchRetryable(providerError)) {
        const restarted = await startRecordResearchWithOpenAi({ apiKey, record, candidates, degraded: true });
        const now = new Date().toISOString();
        await deleteRecordResearchResponse({ apiKey, responseId: job.response_id });
        await db.prepare("UPDATE dbi_workspace_record_research_jobs SET status=?, response_id=?, attempt=2, error_code='', error_message='', updated_at=? WHERE id=?").bind(restarted.status, restarted.responseId, now, job.id).run();
        job = await db.prepare("SELECT * FROM dbi_workspace_record_research_jobs WHERE id=?").bind(job.id).first();
        return json({ job: publicResearchJob(job) }, 202);
      }
      if (shouldRetainPriorResearch(providerError, job.attempt)) {
        const prior = await db.prepare("SELECT * FROM dbi_workspace_record_research WHERE workspace_id=? AND opportunity_id=? ORDER BY created_at DESC LIMIT 1").bind(principal.workspaceId, first).first();
        if (prior) {
          const now = new Date().toISOString();
          await db.prepare("UPDATE dbi_workspace_record_research_jobs SET status='completed', report_id=?, error_code='', error_message='', updated_at=?, completed_at=? WHERE id=?").bind(prior.id, now, now, job.id).run();
          await deleteRecordResearchResponse({ apiKey, responseId: job.response_id });
          job = await db.prepare("SELECT * FROM dbi_workspace_record_research_jobs WHERE id=?").bind(job.id).first();
          await recordActivity(db, principal, "record_research_prior_retained", "record", first, { jobId: job.id, reportId: prior.id, reason: providerError.code });
          return json({ job: publicResearchJob(job), report: publicResearch(prior), retainedPriorReport: true });
        }
      }
      const now = new Date().toISOString();
      await db.prepare("UPDATE dbi_workspace_record_research_jobs SET status='failed', error_code=?, error_message=?, updated_at=?, completed_at=? WHERE id=?")
        .bind(cleanText(providerError.code, 100) || "openai_failed", cleanText(providerError.message, 500), now, now, job.id).run();
      await deleteRecordResearchResponse({ apiKey, responseId: job.response_id });
      job = await db.prepare("SELECT * FROM dbi_workspace_record_research_jobs WHERE id=?").bind(job.id).first();
      return json({ job: publicResearchJob(job) });
    }
  }
  if (request.method === "POST" && first === "relationships" && !second) {
    const body = await safeJson(request);
    const memberIds = [...new Set((Array.isArray(body?.memberIds) ? body.memberIds : []).map((value) => cleanText(value, 180)).filter(Boolean))].slice(0, 2);
    if (memberIds.length !== 2) return error("member_ids_required", "Select exactly two records to link", 400);
    const records = memberIds.map((id) => byId.get(id)).filter(Boolean);
    if (records.length !== 2) return error("record_not_found", "Both records must exist in the active workspace corpus", 404);
    const exact = exactRecordGroupAssessment(records);
    const credential = exact ? null : await db.prepare("SELECT * FROM dbi_openai_keys WHERE workspace_id=? AND scope_type='workspace' AND revoked_at='' ORDER BY is_default DESC, created_at DESC LIMIT 1").bind(principal.workspaceId).first();
    const apiKey = credential ? await decryptSecret(credential, env) : "";
    if (!exact && !apiKey) return error("credential_unavailable", "Configure an active workspace OpenAI credential first", 409);
    if (!exact) {
      const limited = await aiQuotaResponse(db, principal, error);
      if (limited) return limited;
    }
    let assessment;
    try { assessment = exact || (mockMode ? mockRelationshipAssessment(records) : await analyzeRecordGroupWithOpenAi({ apiKey, records })); }
    catch (providerError) { return error(cleanText(providerError.code, 100) || "openai_failed", cleanText(providerError.message, 500), Number(providerError.httpStatus || 502)); }
    if (assessment.decision !== "group" || !["high", "exact"].includes(assessment.confidence)) return json(null, 200, { decision: assessment.decision, confidence: assessment.confidence, message: assessment.rationale, assessment });
    const saved = await saveRelationship(db, principal, relationshipFromAssessment(records, assessment), recordActivity);
    return json(saved, 201);
  }
  if (request.method === "POST" && first && second === "research") {
    const record = byId.get(first);
    if (!record) return error("record_not_found", "Record not found in the active workspace corpus", 404);
    const credential = await db.prepare("SELECT * FROM dbi_openai_keys WHERE workspace_id=? AND scope_type='workspace' AND revoked_at='' ORDER BY is_default DESC, created_at DESC LIMIT 1").bind(principal.workspaceId).first();
    const apiKey = credential ? await decryptSecret(credential, env) : "";
    if (!apiKey) return error("credential_unavailable", "Configure an active workspace OpenAI credential first", 409);
    const staleBefore = new Date(Date.now() - 30 * 60_000).toISOString();
    const now = new Date().toISOString();
    await db.prepare("UPDATE dbi_workspace_record_research_jobs SET status='failed', error_code='stale_run', error_message='The prior research job stopped reporting progress.', updated_at=?, completed_at=? WHERE workspace_id=? AND opportunity_id=? AND status IN ('queued','in_progress') AND updated_at<?")
      .bind(now, now, principal.workspaceId, first, staleBefore).run();
    const active = await db.prepare("SELECT * FROM dbi_workspace_record_research_jobs WHERE workspace_id=? AND opportunity_id=? AND status IN ('queued','in_progress') ORDER BY created_at DESC LIMIT 1").bind(principal.workspaceId, first).first();
    if (active) return json({ job: publicResearchJob(active) }, 202);
    const limited = await aiQuotaResponse(db, principal, error);
    if (limited) return limited;
    const candidates = rankResearchCandidates(record, universe.records);
    if (!mockMode) {
      const id = crypto.randomUUID();
      await db.prepare("INSERT INTO dbi_workspace_record_research_jobs (id,workspace_id,opportunity_id,status,response_id,attempt,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)")
        .bind(id, principal.workspaceId, first, "queued", "", 1, principal.id, now, now).run();
      try {
        const started = await startRecordResearchWithOpenAi({ apiKey, record, candidates });
        await db.prepare("UPDATE dbi_workspace_record_research_jobs SET status=?, response_id=?, updated_at=? WHERE id=?").bind(started.status, started.responseId, new Date().toISOString(), id).run();
        const job = await db.prepare("SELECT * FROM dbi_workspace_record_research_jobs WHERE id=?").bind(id).first();
        await recordActivity(db, principal, "record_research_started", "record", first, { jobId: id });
        return json({ job: publicResearchJob(job) }, 202);
      } catch (providerError) {
        const failedAt = new Date().toISOString();
        await db.prepare("UPDATE dbi_workspace_record_research_jobs SET status='failed', error_code=?, error_message=?, updated_at=?, completed_at=? WHERE id=?")
          .bind(cleanText(providerError.code, 100) || "openai_failed", cleanText(providerError.message, 500), failedAt, failedAt, id).run();
        return error(cleanText(providerError.code, 100) || "openai_failed", cleanText(providerError.message, 500), Number(providerError.httpStatus || 502));
      }
    }
    let report;
    try { report = mockResearch(record, candidates); }
    catch (providerError) { return error(cleanText(providerError.code, 100) || "openai_failed", cleanText(providerError.message, 500), Number(providerError.httpStatus || 502)); }
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
