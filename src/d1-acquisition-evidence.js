import { sha256, stableJson } from "./acquisition-runtime-core.js";
import { cleanText } from "./security-policy.js";
import { rankResearchCandidates, researchRecordWithOpenAi } from "./record-research.js";

export const ACQUISITION_EVIDENCE_SCHEMA = Object.freeze([
  `CREATE TABLE IF NOT EXISTS dbi_acquisition_evidence_campaigns (
    id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, source TEXT NOT NULL, status TEXT NOT NULL,
    model TEXT NOT NULL, total_targets INTEGER NOT NULL DEFAULT 0, completed_targets INTEGER NOT NULL DEFAULT 0,
    evidenced_targets INTEGER NOT NULL DEFAULT 0, gap_targets INTEGER NOT NULL DEFAULT 0, failed_targets INTEGER NOT NULL DEFAULT 0,
    events_added INTEGER NOT NULL DEFAULT 0, created_by TEXT NOT NULL, created_at TEXT NOT NULL,
    started_at TEXT NOT NULL DEFAULT '', completed_at TEXT NOT NULL DEFAULT '')`,
  "CREATE INDEX IF NOT EXISTS idx_dbi_acquisition_evidence_campaigns_workspace ON dbi_acquisition_evidence_campaigns (workspace_id, created_at DESC)",
  `CREATE TABLE IF NOT EXISTS dbi_acquisition_evidence_targets (
    id TEXT PRIMARY KEY, campaign_id TEXT NOT NULL, workspace_id TEXT NOT NULL, source TEXT NOT NULL,
    source_record_id TEXT NOT NULL, opportunity_id TEXT NOT NULL, title TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'queued',
    attempt_count INTEGER NOT NULL DEFAULT 0, disposition TEXT NOT NULL DEFAULT '', report_id TEXT NOT NULL DEFAULT '',
    sources_retained INTEGER NOT NULL DEFAULT 0, events_added INTEGER NOT NULL DEFAULT 0,
    error_code TEXT NOT NULL DEFAULT '', error_message TEXT NOT NULL DEFAULT '', started_at TEXT NOT NULL DEFAULT '', completed_at TEXT NOT NULL DEFAULT '',
    UNIQUE (campaign_id, source_record_id))`,
  "CREATE INDEX IF NOT EXISTS idx_dbi_acquisition_evidence_targets_queue ON dbi_acquisition_evidence_targets (campaign_id, status, source_record_id)",
]);

function parsed(value, fallback) { try { return JSON.parse(value || ""); } catch { return fallback; } }
function nowIso() { return new Date().toISOString(); }
function unique(values) { return [...new Set(values.filter(Boolean))]; }

function campaignView(row) {
  return row ? {
    id: row.id, source: row.source, status: row.status, model: row.model,
    totalTargets: Number(row.total_targets || 0), completedTargets: Number(row.completed_targets || 0),
    evidencedTargets: Number(row.evidenced_targets || 0), gapTargets: Number(row.gap_targets || 0),
    failedTargets: Number(row.failed_targets || 0), eventsAdded: Number(row.events_added || 0),
    createdBy: row.created_by, createdAt: row.created_at, startedAt: row.started_at || null, completedAt: row.completed_at || null,
  } : null;
}

function researchEventKind(value) {
  const kind = cleanText(value, 80).toLowerCase();
  return ({
    "sources-sought": "sources-sought-response", "rfi-response": "rfi-response", "draft-rfp": "draft-rfp",
    "solicitation-posted": "solicitation-posted", "proposal-deadline": "proposal-deadline", "industry-day": "industry-day",
    award: "award", "contract-start": "contract-start", "contract-end": "contract-end", "forecast-release": "forecast-release",
  })[kind] || "published-milestone";
}

async function acceptedEvents(report, record, campaignId) {
  const existing = new Set((record.events || []).map((event) => `${event.kind}|${event.start}|${String(event.label || "").toLowerCase()}`));
  const events = [];
  for (const date of report.keyDates || []) {
    if (date.confidence !== "high" || !/^\d{4}-\d{2}-\d{2}$/.test(date.date) || !date.sourceUrls?.length) continue;
    const kind = researchEventKind(date.eventType);
    const key = `${kind}|${date.date}|${String(date.label || "").toLowerCase()}`;
    if (existing.has(key)) continue;
    existing.add(key);
    events.push({
      eventId: `evidence_${(await sha256(`${campaignId}|${record.sourceRecordId}|${key}`)).slice(0, 24)}`,
      kind, start: date.date, end: date.date, precision: "day", label: date.label,
      sourceUrl: date.sourceUrls[0], sourceUrls: date.sourceUrls, sourceReference: date.basis,
      isForecast: date.eventType === "forecast-release", isVerified: true, status: "Official source checked",
      evidenceConfidence: date.confidence, reviewState: "accepted", checkedAt: report.provenance?.createdAt || nowIso(),
    });
  }
  return events;
}

async function credentialForWorkspace(db, workspaceId, env, decryptSecret) {
  const mock = String(env.DBI_RECORD_RESEARCH_MOCK_MODE || env.DBI_EVENT_AI_MOCK_MODE || "").toLowerCase() === "true";
  if (mock) return { id: "mock-credential", apiKey: "mock" };
  const row = await db.prepare(`SELECT * FROM dbi_openai_keys WHERE workspace_id=? AND scope_type='workspace'
    AND revoked_at='' ORDER BY is_default DESC, created_at DESC LIMIT 1`).bind(workspaceId).first();
  if (!row) return null;
  const apiKey = await decryptSecret(row, env);
  return apiKey ? { id: row.id, apiKey } : null;
}

async function updateCampaignCounts(db, campaignId) {
  const counts = await db.prepare(`SELECT COUNT(*) AS total,
    SUM(CASE WHEN status IN ('succeeded','failed') THEN 1 ELSE 0 END) AS completed,
    SUM(CASE WHEN status='succeeded' AND disposition IN ('verified','partial') THEN 1 ELSE 0 END) AS evidenced,
    SUM(CASE WHEN status='succeeded' AND disposition IN ('ambiguous','no-public-evidence','test-or-placeholder') THEN 1 ELSE 0 END) AS gaps,
    SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) AS failed,
    SUM(events_added) AS events FROM dbi_acquisition_evidence_targets WHERE campaign_id=?`).bind(campaignId).first();
  const total = Number(counts?.total || 0); const completed = Number(counts?.completed || 0); const failed = Number(counts?.failed || 0);
  const terminal = total > 0 && completed === total; const status = terminal ? (failed ? "partial" : "succeeded") : "running"; const completedAt = terminal ? nowIso() : "";
  await db.prepare(`UPDATE dbi_acquisition_evidence_campaigns SET status=?, completed_targets=?, evidenced_targets=?, gap_targets=?, failed_targets=?,
    events_added=?, completed_at=? WHERE id=?`).bind(status, completed, Number(counts?.evidenced || 0), Number(counts?.gaps || 0), failed,
    Number(counts?.events || 0), completedAt, campaignId).run();
  return campaignView(await db.prepare("SELECT * FROM dbi_acquisition_evidence_campaigns WHERE id=?").bind(campaignId).first());
}

async function processTarget({ db, env, campaign, target, records, credential, decryptSecret: _decryptSecret }) {
  const startedAt = nowIso();
  const claim = await db.prepare("UPDATE dbi_acquisition_evidence_targets SET status='researching', attempt_count=attempt_count+1, started_at=?, error_code='', error_message='' WHERE id=? AND status IN ('queued','retry')")
    .bind(startedAt, target.id).run();
  if (!Number(claim.meta?.changes || 0)) return { ok: false, id: target.source_record_id, skipped: true, error: "target_already_claimed" };
  try {
    const stored = await db.prepare("SELECT * FROM dbi_acquisition_records WHERE workspace_id=? AND source=? AND source_record_id=? AND removed_at=''")
      .bind(campaign.workspace_id, campaign.source, target.source_record_id).first();
    if (!stored) throw Object.assign(new Error("The acquisition record is no longer active"), { code: "record_not_found" });
    const record = parsed(stored.record_json, {});
    const candidates = rankResearchCandidates(record, records, 10);
    const report = String(env.DBI_RECORD_RESEARCH_MOCK_MODE || env.DBI_EVENT_AI_MOCK_MODE || "").toLowerCase() === "true"
      ? {
        opportunityId: record.opportunityId, researchDisposition: record.title.toLowerCase().includes("test") ? "test-or-placeholder" : "verified",
        summary: `Official-source research for ${record.title}`, stage: record.lifecycleStage || "Published record", scope: record.context || record.title,
        incumbentPosture: "No incumbent posture established by the mock campaign.", decisionBrief: null,
        keyDates: record.solicitationStart ? [{ eventType: "forecast-release", label: "Verified campaign date", date: record.solicitationStart, basis: "Mock official evidence", confidence: "high", sourceUrls: ["https://sam.gov/"] }] : [],
        timelineAssessment: { status: record.solicitationStart ? "corroborated" : "unverified", rationale: "Mock timeline assessment.", sourceUrls: record.solicitationStart ? ["https://sam.gov/"] : [] },
        nextActions: [], findings: [{ text: "Mock official evidence retained.", sourceUrls: ["https://sam.gov/"] }], risks: [], openQuestions: [], relationshipProposals: [], caveats: [],
        sources: [{ url: "https://sam.gov/", title: "SAM.gov" }], provenance: { kind: "openai-web-research", reviewState: "needs_review", model: campaign.model, responseId: "mock", createdAt: nowIso() },
      }
      : await researchRecordWithOpenAi({ apiKey: credential.apiKey, record, candidates, model: campaign.model });
    const reportId = crypto.randomUUID(); const completedAt = nowIso(); const events = await acceptedEvents(report, record, campaign.id);
    const sourceUrls = unique([...(record.sourceUrls || []), ...(report.sources || []).map((source) => source.url)]);
    const enriched = {
      ...record,
      sourceUrls,
      sourceUrl: record.sourceUrl || sourceUrls[0] || null,
      events: [...(record.events || []), ...events],
      evidenceTier: report.sources?.length ? "source-reviewed" : record.evidenceTier || "public-evidence-gap",
      validationStatus: report.sources?.length ? "official-source-researched" : "public-evidence-gap",
      validationCheckedAt: completedAt,
      corroborationStatus: report.timelineAssessment?.status || "unverified",
      corroborationFinding: report.timelineAssessment?.rationale || report.summary || record.corroborationFinding,
      evidenceCampaign: {
        campaignId: campaign.id, reportId, disposition: report.researchDisposition, sourceCount: report.sources?.length || 0,
        acceptedEventCount: events.length, timelineAssessment: report.timelineAssessment, checkedAt: completedAt,
      },
    };
    const contentHash = await sha256(stableJson(enriched));
    await db.batch([
      db.prepare("INSERT INTO dbi_workspace_record_research (id,workspace_id,opportunity_id,report_json,created_by,created_at) VALUES (?,?,?,?,?,?)")
        .bind(reportId, campaign.workspace_id, record.opportunityId, JSON.stringify(report), "server:acquisition-evidence", completedAt),
      db.prepare(`INSERT OR IGNORE INTO dbi_acquisition_observations
        (id,workspace_id,source,source_record_id,refresh_run_id,content_hash,record_json,observed_at) VALUES (?,?,?,?,?,?,?,?)`)
        .bind(crypto.randomUUID(), campaign.workspace_id, campaign.source, target.source_record_id, campaign.id, contentHash, JSON.stringify(enriched), completedAt),
      db.prepare(`INSERT INTO dbi_acquisition_changes
        (id,workspace_id,source,source_record_id,refresh_run_id,change_type,changed_fields_json,changed_at) VALUES (?,?,?,?,?,'evidence_enriched',?,?)`)
        .bind(crypto.randomUUID(), campaign.workspace_id, campaign.source, target.source_record_id, campaign.id,
          JSON.stringify(["sourceUrls", "events", "evidenceTier", "validationStatus", "validationCheckedAt", "corroborationStatus", "corroborationFinding", "evidenceCampaign"]), completedAt),
      db.prepare(`UPDATE dbi_acquisition_records SET content_hash=?, record_json=?, last_seen_at=?, last_changed_at=?
        WHERE workspace_id=? AND source=? AND source_record_id=?`).bind(contentHash, JSON.stringify(enriched), completedAt, completedAt,
        campaign.workspace_id, campaign.source, target.source_record_id),
      db.prepare(`UPDATE dbi_acquisition_evidence_targets SET status='succeeded', disposition=?, report_id=?, sources_retained=?, events_added=?, completed_at=? WHERE id=?`)
        .bind(report.researchDisposition, reportId, report.sources?.length || 0, events.length, completedAt, target.id),
    ]);
    return { ok: true, id: target.source_record_id, disposition: report.researchDisposition, sources: report.sources?.length || 0, events: events.length };
  } catch (error) {
    const attempt = Number(target.attempt_count || 0) + 1; const retryable = attempt < 3 && (Number(error?.httpStatus || 0) >= 500 || Number(error?.httpStatus || 0) === 429 || ["provider_timeout", "provider_unavailable", "missing_citations"].includes(error?.code));
    await db.prepare("UPDATE dbi_acquisition_evidence_targets SET status=?, error_code=?, error_message=?, completed_at=? WHERE id=?")
      .bind(retryable ? "retry" : "failed", cleanText(error?.code || "research_failed", 100), cleanText(error?.message || "Research failed", 500), nowIso(), target.id).run();
    return { ok: false, id: target.source_record_id, retryable, error: cleanText(error?.code || "research_failed", 100) };
  }
}

export async function createAcquisitionEvidenceCampaign(db, workspaceId, source, model, createdBy) {
  const active = await db.prepare("SELECT * FROM dbi_acquisition_evidence_campaigns WHERE workspace_id=? AND source=? AND status IN ('queued','running') ORDER BY created_at DESC LIMIT 1")
    .bind(workspaceId, source).first();
  if (active) return { active: true, campaign: campaignView(active) };
  const rows = await db.prepare("SELECT source_record_id, record_json FROM dbi_acquisition_records WHERE workspace_id=? AND source=? AND removed_at='' ORDER BY source_record_id")
    .bind(workspaceId, source).all();
  if (!(rows.results || []).length) return { error: "No active records exist for that source", status: 404 };
  const id = crypto.randomUUID(); const createdAt = nowIso();
  await db.prepare(`INSERT INTO dbi_acquisition_evidence_campaigns
    (id,workspace_id,source,status,model,total_targets,created_by,created_at,started_at) VALUES (?,?,?,'queued',?,?,?,?,?)`)
    .bind(id, workspaceId, source, model, rows.results.length, createdBy, createdAt, createdAt).run();
  const statements = rows.results.map((row) => {
    const record = parsed(row.record_json, {});
    return db.prepare(`INSERT INTO dbi_acquisition_evidence_targets
      (id,campaign_id,workspace_id,source,source_record_id,opportunity_id,title,status) VALUES (?,?,?,?,?,?,?,'queued')`)
      .bind(crypto.randomUUID(), id, workspaceId, source, row.source_record_id, record.opportunityId || `${source}_${row.source_record_id}`, cleanText(record.title, 500));
  });
  for (let index = 0; index < statements.length; index += 50) await db.batch(statements.slice(index, index + 50));
  await db.prepare("UPDATE dbi_acquisition_evidence_campaigns SET status='running' WHERE id=?").bind(id).run();
  return { active: false, campaign: campaignView(await db.prepare("SELECT * FROM dbi_acquisition_evidence_campaigns WHERE id=?").bind(id).first()) };
}

export async function advanceAcquisitionEvidenceCampaign(db, env, campaignId, workspaceId, batchSize, decryptSecret) {
  const campaign = await db.prepare("SELECT * FROM dbi_acquisition_evidence_campaigns WHERE id=? AND workspace_id=?").bind(campaignId, workspaceId).first();
  if (!campaign) return { error: "Evidence campaign not found", status: 404 };
  if (!["queued", "running", "partial"].includes(campaign.status)) return { campaign: campaignView(campaign), results: [] };
  const credential = await credentialForWorkspace(db, workspaceId, env, decryptSecret);
  if (!credential) return { error: "Configure an active workspace OpenAI credential before evidence research", status: 409 };
  const selected = await db.prepare(`SELECT * FROM dbi_acquisition_evidence_targets WHERE campaign_id=? AND status IN ('queued','retry')
    ORDER BY attempt_count, source_record_id LIMIT ?`).bind(campaignId, Math.max(1, Math.min(8, Number(batchSize || 4)))).all();
  if (!(selected.results || []).length) return { campaign: await updateCampaignCounts(db, campaignId), results: [] };
  const portfolio = await db.prepare("SELECT record_json FROM dbi_acquisition_records WHERE workspace_id=? AND source=? AND removed_at='' ORDER BY source_record_id")
    .bind(workspaceId, campaign.source).all();
  const records = (portfolio.results || []).map((row) => parsed(row.record_json, {}));
  const queue = [...selected.results]; const results = [];
  async function worker() {
    while (queue.length) results.push(await processTarget({ db, env, campaign, target: queue.shift(), records, credential, decryptSecret }));
  }
  await Promise.all(Array.from({ length: Math.min(2, queue.length) }, () => worker()));
  return { campaign: await updateCampaignCounts(db, campaignId), results };
}

export async function runScheduledAcquisitionEvidence(db, env, decryptSecret, batchSize = 8) {
  const campaign = await db.prepare(`SELECT campaign.* FROM dbi_acquisition_evidence_campaigns campaign
    WHERE campaign.status IN ('queued','running','partial') AND EXISTS (
      SELECT 1 FROM dbi_acquisition_evidence_targets target
      WHERE target.campaign_id=campaign.id AND target.status IN ('queued','retry')
    ) ORDER BY campaign.created_at LIMIT 1`).first();
  if (!campaign) return { scheduled: 0, campaign: null, results: [] };
  const outcome = await advanceAcquisitionEvidenceCampaign(db, env, campaign.id, campaign.workspace_id, batchSize, decryptSecret);
  return outcome.error
    ? { scheduled: 1, campaign: campaignView(campaign), results: [], error: outcome.error, status: outcome.status }
    : { scheduled: 1, ...outcome };
}

export async function acquisitionEvidenceCampaignResponse(request, db, env, session, segments, deps) {
  const workspaceId = session.active_workspace_id || "";
  if (!workspaceId) return deps.json({ error: "Select a workspace first" }, 409);
  if (!deps.canAdministerWorkspaces(session)) return deps.json({ error: "Workspace manager access is required" }, 403);
  if (request.method !== "GET" && !deps.sameOriginRequest(request)) return deps.json({ error: "Cross-origin evidence campaign changes are not allowed" }, 403);
  const campaignId = cleanText(segments[1], 80);
  if (request.method === "GET" && !campaignId) {
    const rows = await db.prepare("SELECT * FROM dbi_acquisition_evidence_campaigns WHERE workspace_id=? ORDER BY created_at DESC LIMIT 20").bind(workspaceId).all();
    return deps.json({ campaigns: (rows.results || []).map(campaignView) });
  }
  if (request.method === "GET" && campaignId) {
    const row = await db.prepare("SELECT * FROM dbi_acquisition_evidence_campaigns WHERE id=? AND workspace_id=?").bind(campaignId, workspaceId).first();
    if (!row) return deps.json({ error: "Evidence campaign not found" }, 404);
    const targets = await db.prepare("SELECT source_record_id,title,status,attempt_count,disposition,sources_retained,events_added,error_code,error_message,completed_at FROM dbi_acquisition_evidence_targets WHERE campaign_id=? ORDER BY source_record_id").bind(campaignId).all();
    return deps.json({ campaign: campaignView(row), targets: targets.results || [] });
  }
  if (request.method === "POST" && !campaignId) {
    const body = await deps.safeJson(request); const source = cleanText(body?.source || "emerging-markets", 80).toLowerCase();
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(source)) return deps.json({ error: "A valid acquisition source is required" }, 400);
    const model = ["gpt-5.4-mini", "gpt-5.4-nano", "gpt-5-nano"].includes(body?.model) ? body.model : "gpt-5.4-mini";
    const result = await createAcquisitionEvidenceCampaign(db, workspaceId, source, model, session.user_id);
    return result.error ? deps.json({ error: result.error }, result.status) : deps.json(result, result.active ? 200 : 201);
  }
  if (request.method === "POST" && campaignId && segments[2] === "advance") {
    const body = await deps.safeJson(request); const result = await advanceAcquisitionEvidenceCampaign(db, env, campaignId, workspaceId, body?.batchSize, deps.decryptSecret);
    return result.error ? deps.json({ error: result.error }, result.status) : deps.json(result);
  }
  return deps.json({ error: "Method not allowed" }, 405);
}
