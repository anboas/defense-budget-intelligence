const DEFAULT_CONFIG = Object.freeze({
  enabled: true,
  cadenceMinutes: 15,
  batchSize: 8,
  concurrency: 2,
  maxSourcesPerTarget: 4,
  maxClaimsPerTarget: 3,
  revisitAfterHours: 168,
  model: "gpt-5-nano",
  reasoningEffort: "low",
  autoPublish: true,
});

const MODELS = new Set(["gpt-5-nano", "gpt-5.4-nano", "gpt-5.4-mini"]);
const REASONING = new Set(["low", "medium"]);
const CLAIM_TYPES = new Set(["leadership", "mission", "finance", "hierarchy", "program", "location", "identifier"]);
const FIELD_PATHS = Object.freeze({
  leadership: "autonomousResearch.leadership",
  mission: "autonomousResearch.missionClaims",
  finance: "autonomousResearch.financialEvidence",
  hierarchy: "autonomousResearch.hierarchy",
  program: "autonomousResearch.programs",
  location: "autonomousResearch.locations",
  identifier: "autonomousResearch.identifiers",
});

export const D1_RESEARCH_OPERATIONS_SCHEMA = Object.freeze([
  `CREATE TABLE IF NOT EXISTS dbi_research_configs (
    workspace_id TEXT PRIMARY KEY,
    enabled INTEGER NOT NULL DEFAULT 1,
    cadence_minutes INTEGER NOT NULL DEFAULT 15,
    batch_size INTEGER NOT NULL DEFAULT 8,
    concurrency INTEGER NOT NULL DEFAULT 2,
    max_sources_per_target INTEGER NOT NULL DEFAULT 4,
    max_claims_per_target INTEGER NOT NULL DEFAULT 3,
    revisit_after_hours INTEGER NOT NULL DEFAULT 168,
    model TEXT NOT NULL DEFAULT 'gpt-5-nano',
    reasoning_effort TEXT NOT NULL DEFAULT 'low',
    auto_publish INTEGER NOT NULL DEFAULT 1,
    updated_by TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  "CREATE INDEX IF NOT EXISTS idx_dbi_research_configs_due ON dbi_research_configs (enabled, cadence_minutes, updated_at)",
  `CREATE TABLE IF NOT EXISTS dbi_research_runs (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    trigger_type TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('queued','running','succeeded','partial','failed','cancelled')),
    stage TEXT NOT NULL DEFAULT 'queued',
    model TEXT NOT NULL,
    reasoning_effort TEXT NOT NULL,
    config_json TEXT NOT NULL DEFAULT '{}',
    targets_planned INTEGER NOT NULL DEFAULT 0,
    targets_completed INTEGER NOT NULL DEFAULT 0,
    sources_explored INTEGER NOT NULL DEFAULT 0,
    claims_discovered INTEGER NOT NULL DEFAULT 0,
    claims_published INTEGER NOT NULL DEFAULT 0,
    entities_published INTEGER NOT NULL DEFAULT 0,
    relations_published INTEGER NOT NULL DEFAULT 0,
    claims_held INTEGER NOT NULL DEFAULT 0,
    duplicates_suppressed INTEGER NOT NULL DEFAULT 0,
    conflicts_held INTEGER NOT NULL DEFAULT 0,
    gaps_resolved INTEGER NOT NULL DEFAULT 0,
    input_tokens INTEGER NOT NULL DEFAULT 0,
    output_tokens INTEGER NOT NULL DEFAULT 0,
    error_code TEXT NOT NULL DEFAULT '',
    error_message TEXT NOT NULL DEFAULT '',
    started_at TEXT NOT NULL,
    completed_at TEXT NOT NULL DEFAULT ''
  )`,
  "CREATE INDEX IF NOT EXISTS idx_dbi_research_runs_workspace ON dbi_research_runs (workspace_id, started_at DESC)",
  "CREATE INDEX IF NOT EXISTS idx_dbi_research_runs_status ON dbi_research_runs (workspace_id, status, started_at DESC)",
  `CREATE TABLE IF NOT EXISTS dbi_research_run_targets (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL,
    workspace_id TEXT NOT NULL,
    dossier_id TEXT NOT NULL,
    dossier_label TEXT NOT NULL,
    gap_id TEXT NOT NULL,
    gap_type TEXT NOT NULL,
    status TEXT NOT NULL,
    sources_explored INTEGER NOT NULL DEFAULT 0,
    claims_discovered INTEGER NOT NULL DEFAULT 0,
    claims_published INTEGER NOT NULL DEFAULT 0,
    entities_published INTEGER NOT NULL DEFAULT 0,
    relations_published INTEGER NOT NULL DEFAULT 0,
    claims_held INTEGER NOT NULL DEFAULT 0,
    duration_ms INTEGER NOT NULL DEFAULT 0,
    error_code TEXT NOT NULL DEFAULT '',
    error_message TEXT NOT NULL DEFAULT '',
    started_at TEXT NOT NULL,
    completed_at TEXT NOT NULL DEFAULT ''
  )`,
  "CREATE INDEX IF NOT EXISTS idx_dbi_research_targets_run ON dbi_research_run_targets (run_id, started_at)",
  "CREATE INDEX IF NOT EXISTS idx_dbi_research_targets_gap ON dbi_research_run_targets (workspace_id, gap_id, completed_at DESC)",
  `CREATE TABLE IF NOT EXISTS dbi_research_claims (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL,
    workspace_id TEXT NOT NULL,
    dossier_id TEXT NOT NULL,
    gap_id TEXT NOT NULL,
    claim_type TEXT NOT NULL,
    field_path TEXT NOT NULL,
    label TEXT NOT NULL,
    value_json TEXT NOT NULL,
    confidence TEXT NOT NULL,
    exact INTEGER NOT NULL DEFAULT 0,
    citations_json TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('published','held','duplicate','rejected')),
    decision_reason TEXT NOT NULL DEFAULT '',
    fingerprint TEXT NOT NULL,
    proposal_id TEXT NOT NULL DEFAULT '',
    model TEXT NOT NULL,
    created_at TEXT NOT NULL,
    published_at TEXT NOT NULL DEFAULT ''
  )`,
  "CREATE UNIQUE INDEX IF NOT EXISTS idx_dbi_research_claims_fingerprint ON dbi_research_claims (workspace_id, fingerprint, status) WHERE status = 'published'",
  "CREATE INDEX IF NOT EXISTS idx_dbi_research_claims_run ON dbi_research_claims (run_id, status, created_at)",
  "CREATE INDEX IF NOT EXISTS idx_dbi_research_claims_workspace ON dbi_research_claims (workspace_id, status, created_at DESC)",
]);

const text = (value, limit = 500) => Array.from(String(value ?? ""), (character) => {
  const code = character.charCodeAt(0);
  return code < 32 || code === 127 ? " " : character;
}).join("").trim().slice(0, limit);
const integer = (value, fallback, min, max) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, Math.trunc(parsed))) : fallback;
};
const parsed = (value, fallback) => { try { return JSON.parse(value || ""); } catch { return fallback; } };
const iso = () => new Date().toISOString();

function normalizeConfig(value = {}) {
  return {
    enabled: value.enabled !== false,
    cadenceMinutes: integer(value.cadenceMinutes, DEFAULT_CONFIG.cadenceMinutes, 15, 1440),
    batchSize: integer(value.batchSize, DEFAULT_CONFIG.batchSize, 1, 20),
    concurrency: integer(value.concurrency, DEFAULT_CONFIG.concurrency, 1, 5),
    maxSourcesPerTarget: integer(value.maxSourcesPerTarget, DEFAULT_CONFIG.maxSourcesPerTarget, 1, 8),
    maxClaimsPerTarget: integer(value.maxClaimsPerTarget, DEFAULT_CONFIG.maxClaimsPerTarget, 1, 6),
    revisitAfterHours: integer(value.revisitAfterHours, DEFAULT_CONFIG.revisitAfterHours, 12, 720),
    model: MODELS.has(value.model) ? value.model : DEFAULT_CONFIG.model,
    reasoningEffort: REASONING.has(value.reasoningEffort) ? value.reasoningEffort : DEFAULT_CONFIG.reasoningEffort,
    autoPublish: value.autoPublish !== false,
  };
}

function configFromRow(row) {
  return normalizeConfig(row ? {
    enabled: Boolean(row.enabled), cadenceMinutes: row.cadence_minutes, batchSize: row.batch_size,
    concurrency: row.concurrency, maxSourcesPerTarget: row.max_sources_per_target,
    maxClaimsPerTarget: row.max_claims_per_target, revisitAfterHours: row.revisit_after_hours,
    model: row.model, reasoningEffort: row.reasoning_effort, autoPublish: Boolean(row.auto_publish),
  } : DEFAULT_CONFIG);
}

async function sha256(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(value)));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function officialUrl(value) {
  try {
    const url = new URL(text(value, 1800));
    const host = url.hostname.toLowerCase();
    if (url.protocol !== "https:" || url.username || url.password) return "";
    if (!(host.endsWith(".gov") || host.endsWith(".mil") || host === "govinfo.gov" || host === "www.govinfo.gov")) return "";
    if ([...url.searchParams.keys()].some((key) => /token|secret|password|credential|authorization/i.test(key))) return "";
    url.hash = "";
    return url.toString();
  } catch { return ""; }
}

function normalizedUrl(value) {
  try { const url = new URL(value); url.hash = ""; return `${url.origin}${url.pathname}`.replace(/\/$/, "").toLowerCase(); } catch { return ""; }
}

const sourceSchema = {
  type: "object", additionalProperties: false, required: ["url", "title", "publisher", "quote"],
  properties: {
    url: { type: "string", maxLength: 1800 }, title: { type: "string", maxLength: 240 },
    publisher: { type: "string", maxLength: 180 }, quote: { type: "string", maxLength: 1200 },
  },
};

const researchSchema = {
  type: "object", additionalProperties: false, required: ["claims", "caveats"],
  properties: {
    claims: { type: "array", maxItems: 6, items: {
      type: "object", additionalProperties: false,
      required: ["claimType", "label", "value", "numericValue", "unit", "measureType", "personName", "roleTitle", "effectiveFrom", "effectiveTo", "confidence", "exact", "sources"],
      properties: {
        claimType: { type: "string", enum: [...CLAIM_TYPES] }, label: { type: "string", maxLength: 240 },
        value: { type: "string", maxLength: 2000 }, numericValue: { type: "number" }, unit: { type: "string", maxLength: 80 },
        measureType: { type: "string", maxLength: 100 }, personName: { type: "string", maxLength: 180 }, roleTitle: { type: "string", maxLength: 180 },
        effectiveFrom: { type: "string", maxLength: 40 }, effectiveTo: { type: "string", maxLength: 40 },
        confidence: { type: "string", enum: ["exact", "high", "medium", "low"] }, exact: { type: "boolean" },
        sources: { type: "array", minItems: 1, maxItems: 8, items: sourceSchema },
      },
    } },
    caveats: { type: "array", maxItems: 12, items: { type: "string", maxLength: 500 } },
  },
};

function responseText(response) {
  if (typeof response?.output_text === "string") return response.output_text;
  for (const output of response?.output || []) for (const item of output?.content || []) if (item?.type === "output_text" && item.text) return item.text;
  return "";
}

function consultedSources(response) {
  const urls = [];
  for (const output of response?.output || []) {
    if (output?.type !== "web_search_call") continue;
    for (const source of output?.action?.sources || []) if (source?.url) urls.push(normalizedUrl(source.url));
  }
  return new Set(urls.filter(Boolean));
}

function normalizeResearch(payload, providerSources, config) {
  const claims = [];
  for (const row of Array.isArray(payload?.claims) ? payload.claims.slice(0, config.maxClaimsPerTarget) : []) {
    const claimType = CLAIM_TYPES.has(row?.claimType) ? row.claimType : "";
    const sources = (Array.isArray(row?.sources) ? row.sources : []).slice(0, config.maxSourcesPerTarget).map((source) => ({
      url: officialUrl(source?.url), title: text(source?.title, 240), publisher: text(source?.publisher, 180), quote: text(source?.quote, 1200),
    })).filter((source) => source.url && source.title && source.quote && (!providerSources.size || providerSources.has(normalizedUrl(source.url))));
    if (!claimType || !text(row?.label, 240) || !text(row?.value, 2000) || !sources.length) continue;
    claims.push({
      claimType, fieldPath: FIELD_PATHS[claimType], label: text(row.label, 240), value: text(row.value, 2000),
      numericValue: Number.isFinite(Number(row.numericValue)) ? Number(row.numericValue) : 0,
      unit: text(row.unit, 80), measureType: text(row.measureType, 100), personName: text(row.personName, 180),
      roleTitle: text(row.roleTitle, 180), effectiveFrom: text(row.effectiveFrom, 40), effectiveTo: text(row.effectiveTo, 40),
      confidence: ["exact", "high", "medium", "low"].includes(row.confidence) ? row.confidence : "low",
      exact: row.exact === true, sources,
    });
  }
  return { claims, caveats: (Array.isArray(payload?.caveats) ? payload.caveats : []).map((item) => text(item, 500)).filter(Boolean).slice(0, 12) };
}

function researchRequest(target, config) {
  return {
    model: config.model,
    store: false,
    reasoning: { effort: config.reasoningEffort },
    tools: [{ type: "web_search", search_context_size: "low" }],
    tool_choice: "required",
    include: ["web_search_call.action.sources"],
    max_output_tokens: 2600,
    text: { format: { type: "json_schema", name: "organization_discovery", strict: true, schema: researchSchema } },
    instructions: [
      "Research one public organization intelligence gap for Defense Budget Intelligence.",
      "Use no more than three focused web searches and only official HTTPS .gov or .mil sources.",
      "Return public professional information only. Never return private contact, family, home, credential, or personal-profile data.",
      "Every claim must include an exact supporting quote and its official source URL.",
      "Do not infer appointment dates, tenure endings, hierarchy, money, or mission. Use empty date fields when an official source does not state dates.",
      "A current directory listing may support an observed-current role, but never an appointment date.",
      "Keep request, authority, apportionment, obligation, outlay, award value, and ceiling as distinct financial measures.",
      "Set exact=true only for a directly stated fact whose subject is unambiguous. Otherwise return no claim and explain the gap in caveats.",
    ].join(" "),
    input: JSON.stringify({ organization: target.dossierLabel, dossierId: target.dossierId, gapType: target.gapType, gap: target.description, knownSources: target.sourceUrls.slice(0, 8) }),
  };
}

async function openAiResearch(apiKey, target, config, env) {
  if (String(env.DBI_DISCOVERY_MOCK_MODE || env.DBI_EVENT_AI_MOCK_MODE || "").toLowerCase() === "true") {
    const source = target.sourceUrls.map(officialUrl).find(Boolean) || "https://www.defense.gov/";
    const leadership = target.gapType === "leadership";
    return { response: { id: `mock-${crypto.randomUUID()}`, usage: { input_tokens: 120, output_tokens: 80 }, output: [{ type: "web_search_call", action: { sources: [{ url: source }] } }] }, payload: { claims: [{ claimType: leadership ? "leadership" : target.gapType === "mission" ? "mission" : "hierarchy", label: `${target.dossierLabel} verified fact`, value: `Official evidence for ${target.dossierLabel}`, numericValue: 0, unit: "", measureType: "", personName: leadership ? `Verification Leader ${target.dossierLabel}` : "", roleTitle: leadership ? "Director" : "", effectiveFrom: "", effectiveTo: "", confidence: "exact", exact: true, sources: [{ url: source, title: "Official source", publisher: "U.S. Government", quote: `Official evidence for ${target.dossierLabel}` }] }], caveats: [] }, latencyMs: 0, requestId: "mock-request" };
  }
  const started = Date.now();
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST", headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" }, body: JSON.stringify(researchRequest(target, config)),
  });
  const requestId = response.headers.get("x-request-id") || response.headers.get("openai-request-id") || "";
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(text(body?.error?.message || `OpenAI returned HTTP ${response.status}`, 500));
    error.code = text(body?.error?.code || body?.error?.type || "provider_failed", 100); error.httpStatus = response.status; error.requestId = requestId; error.latencyMs = Date.now() - started;
    throw error;
  }
  const raw = responseText(body);
  let payload; try { payload = JSON.parse(raw); } catch { const error = new Error("OpenAI returned invalid structured output"); error.code = "invalid_structured_output"; throw error; }
  return { response: body, payload, latencyMs: Date.now() - started, requestId };
}

async function ensureConfig(db, workspaceId, updatedBy = "system") {
  const existing = await db.prepare("SELECT * FROM dbi_research_configs WHERE workspace_id = ?").bind(workspaceId).first();
  if (existing) return configFromRow(existing);
  const now = iso(); const config = { ...DEFAULT_CONFIG };
  await db.prepare(`INSERT INTO dbi_research_configs (workspace_id, enabled, cadence_minutes, batch_size, concurrency, max_sources_per_target,
    max_claims_per_target, revisit_after_hours, model, reasoning_effort, auto_publish, updated_by, created_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(workspaceId, 1, config.cadenceMinutes, config.batchSize, config.concurrency,
    config.maxSourcesPerTarget, config.maxClaimsPerTarget, config.revisitAfterHours, config.model, config.reasoningEffort, 1, updatedBy, now, now).run();
  return config;
}

async function credentialForWorkspace(db, workspaceId, env, decryptSecret) {
  const mock = String(env.DBI_DISCOVERY_MOCK_MODE || env.DBI_EVENT_AI_MOCK_MODE || "").toLowerCase() === "true";
  if (mock) return { id: "mock-credential", apiKey: "mock" };
  const row = await db.prepare(`SELECT * FROM dbi_openai_keys WHERE workspace_id = ? AND scope_type = 'workspace'
    AND revoked_at = '' ORDER BY is_default DESC, created_at DESC LIMIT 1`).bind(workspaceId).first();
  if (!row) return null;
  const apiKey = await decryptSecret(row, env);
  return apiKey ? { id: row.id, apiKey } : null;
}

async function targetsForRun(db, artifact, workspaceId, config) {
  const cutoff = new Date(Date.now() - config.revisitAfterHours * 3_600_000).toISOString();
  const recent = await db.prepare("SELECT DISTINCT gap_id FROM dbi_research_run_targets WHERE workspace_id = ? AND completed_at >= ?").bind(workspaceId, cutoff).all();
  const seen = new Set((recent.results || []).map((row) => row.gap_id));
  const dossiers = new Map((artifact?.dossiers || []).map((row) => [row.id, row]));
  const priority = { high: 0, medium: 1, low: 2 };
  return (artifact?.researchGaps || []).filter((gap) => gap.status === "open" && !seen.has(gap.id)).sort((left, right) => (priority[left.priority] ?? 9) - (priority[right.priority] ?? 9) || left.label.localeCompare(right.label)).slice(0, config.batchSize).map((gap) => {
    const dossier = dossiers.get(gap.dossierId) || {};
    return { dossierId: gap.dossierId, dossierLabel: dossier.label || gap.label.split(":")[0], organizationId: dossier.organizationId || "", gapId: gap.id, gapType: gap.gapType, description: gap.description, sourceUrls: dossier.sourceUrls || [] };
  });
}

async function leadershipGraphStatements(db, run, target, claim, proposalId, now) {
  if (claim.claimType !== "leadership" || !claim.personName || !claim.roleTitle) return { statements: [], entities: 0, relations: 0 };
  const personId = `workspace:person:${(await sha256(claim.personName.toLowerCase())).slice(0, 24)}`;
  const roleId = `workspace:official-role:${(await sha256(`${target.dossierId}|${claim.roleTitle}|${claim.personName}`.toLowerCase())).slice(0, 24)}`;
  const relationSpecs = [
    ["person-holds-official-role", personId, roleId],
    ["organization-dossier-includes-person", target.dossierId, personId],
    ["organization-dossier-includes-role", target.dossierId, roleId],
    ...(target.organizationId ? [["official-role-at-organization", roleId, target.organizationId]] : []),
  ];
  const relationRows = await Promise.all(relationSpecs.map(async ([type, from, to]) => {
    const id = `workspace:relation:${(await sha256(`${run.workspaceId}|${type}|${from}|${to}`)).slice(0, 24)}`;
    const existing = await db.prepare("SELECT relation_id FROM dbi_intelligence_relations WHERE workspace_id=? AND relation_id=?").bind(run.workspaceId, id).first();
    return { id, type, from, to, isNew: !existing };
  }));
  const [personExisting, roleExisting] = await Promise.all([
    db.prepare("SELECT entity_id FROM dbi_intelligence_entities WHERE workspace_id=? AND entity_id=?").bind(run.workspaceId, personId).first(),
    db.prepare("SELECT entity_id FROM dbi_intelligence_entities WHERE workspace_id=? AND entity_id=?").bind(run.workspaceId, roleId).first(),
  ]);
  const evidence = JSON.stringify({ proposalId, confidence: claim.confidence, sources: claim.sources, evidenceGate: "exact_official_source" });
  const validity = JSON.stringify({ observedAt: now, effectiveFrom: claim.effectiveFrom || null, effectiveTo: claim.effectiveTo || null, status: claim.effectiveTo ? "historical" : "current", basis: "autonomous-exact-evidence" });
  const personPayload = JSON.stringify({ id: personId, type: "person", label: claim.personName, name: claim.personName, publicProfessional: true, sourceUrls: claim.sources.map((source) => source.url) });
  const rolePayload = JSON.stringify({ id: roleId, type: "official-role", label: `${claim.personName} — ${claim.roleTitle}`, title: claim.roleTitle, personId, dossierId: target.dossierId, organizationId: target.organizationId || null, status: claim.effectiveTo ? "historical" : "observed-current", effectiveFrom: claim.effectiveFrom || null, effectiveTo: claim.effectiveTo || null, datePrecision: claim.effectiveFrom ? "source-stated" : "observed-current-lower-bound", sourceUrls: claim.sources.map((source) => source.url) });
  const statements = [
    db.prepare(`INSERT INTO dbi_intelligence_entities (workspace_id,entity_id,entity_type,label,payload_json,status,version,proposal_id,created_by,created_at,updated_at)
      VALUES (?,?,'person',?,?,'active',1,?,'server:research-discovery',?,?) ON CONFLICT(workspace_id,entity_id) DO UPDATE SET label=excluded.label,payload_json=excluded.payload_json,updated_at=excluded.updated_at`)
      .bind(run.workspaceId, personId, claim.personName, personPayload, proposalId, now, now),
    db.prepare(`INSERT INTO dbi_intelligence_entities (workspace_id,entity_id,entity_type,label,payload_json,status,version,proposal_id,created_by,created_at,updated_at)
      VALUES (?,?,'official-role',?,?,'active',1,?,'server:research-discovery',?,?) ON CONFLICT(workspace_id,entity_id) DO UPDATE SET label=excluded.label,payload_json=excluded.payload_json,updated_at=excluded.updated_at`)
      .bind(run.workspaceId, roleId, `${claim.personName} — ${claim.roleTitle}`, rolePayload, proposalId, now, now),
    ...relationRows.map((relation) => db.prepare(`INSERT OR IGNORE INTO dbi_intelligence_relations
      (relation_id,workspace_id,proposal_id,relation_type,from_entity_id,to_entity_id,attributes_json,evidence_json,validity_json,status,version,created_by,created_at,applied_at)
      VALUES (?,?,?,?,?,?,?, ?,?,'applied',1,'server:research-discovery',?,?)`).bind(relation.id, run.workspaceId, proposalId, relation.type,
      relation.from, relation.to, JSON.stringify({ roleTitle: claim.roleTitle }), evidence, validity, now, now)),
  ];
  return { statements, entities: Number(!personExisting) + Number(!roleExisting), relations: relationRows.filter((row) => row.isNew).length };
}

async function publishClaim(db, run, target, claim, config) {
  const value = { claimType: claim.claimType, label: claim.label, value: claim.value, numericValue: claim.numericValue, unit: claim.unit, measureType: claim.measureType, personName: claim.personName, roleTitle: claim.roleTitle };
  const fingerprint = await sha256(`${target.dossierId}|${claim.fieldPath}|${JSON.stringify(value).toLowerCase()}`);
  const prior = await db.prepare("SELECT id FROM dbi_research_claims WHERE workspace_id = ? AND fingerprint = ? AND status = 'published'").bind(run.workspaceId, fingerprint).first();
  if (prior) return { status: "duplicate", fingerprint, entities: 0, relations: 0 };
  const exactEnough = claim.exact && ["exact", "high"].includes(claim.confidence);
  const now = iso(); const claimRecordId = crypto.randomUUID();
  if (!config.autoPublish || !exactEnough) {
    await db.prepare(`INSERT INTO dbi_research_claims (id, run_id, workspace_id, dossier_id, gap_id, claim_type, field_path, label, value_json,
      confidence, exact, citations_json, status, decision_reason, fingerprint, proposal_id, model, created_at, published_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(claimRecordId, run.id, run.workspaceId, target.dossierId, target.gapId, claim.claimType,
      claim.fieldPath, claim.label, JSON.stringify(value), claim.confidence, claim.exact ? 1 : 0, JSON.stringify(claim.sources), "held",
      config.autoPublish ? "Evidence did not meet exact/high automatic-promotion gate" : "Automatic publication is disabled", fingerprint, "", config.model, now, "").run();
    return { status: "held", fingerprint, entities: 0, relations: 0 };
  }
  const proposalId = crypto.randomUUID(); const sourceIds = [];
  const sourceStatements = [];
  for (const source of claim.sources) {
    const sourceId = `workspace:source:${(await sha256(source.url)).slice(0, 24)}`; sourceIds.push(sourceId);
    sourceStatements.push(db.prepare(`INSERT INTO dbi_intelligence_sources (workspace_id, source_id, url, title, publisher, authority, retrieved_at,
      supports_text, proposal_id, created_by, created_at, updated_at) VALUES (?,?,?,?,?,'official_primary',?,?,?,?,?,?)
      ON CONFLICT(workspace_id, source_id) DO UPDATE SET title=excluded.title, publisher=excluded.publisher, retrieved_at=excluded.retrieved_at,
      supports_text=excluded.supports_text, updated_at=excluded.updated_at`).bind(run.workspaceId, sourceId, source.url, source.title, source.publisher, now,
      source.quote, proposalId, "server:research-discovery", now, now));
  }
  const overlayClaimId = crypto.randomUUID();
  const graph = await leadershipGraphStatements(db, run, target, claim, proposalId, now);
  await db.batch([
    ...sourceStatements,
    db.prepare(`INSERT INTO dbi_intelligence_proposals (id, workspace_id, target_entity_id, target_entity_type, status, title, summary, proposal_json,
      review_json, model, response_id, trace_id, version, created_by_type, created_by, reviewed_by_type, reviewed_by, created_at, updated_at, reviewed_at, applied_at)
      VALUES (?,?,?,'organization-dossier','applied',?,?,?,?,?,'',?,1,'system','server:research-discovery','system','server:evidence-gate',?,?,?,?)`)
      .bind(proposalId, run.workspaceId, target.dossierId, claim.label, `Autonomously researched ${claim.claimType} fact`, JSON.stringify({ target, claim }),
        JSON.stringify({ decision: "auto_published", reason: "exact official-source evidence" }), config.model, run.id, now, now, now, now),
    db.prepare(`INSERT INTO dbi_intelligence_claims (claim_id, workspace_id, proposal_id, target_entity_id, target_entity_type, field_path, operation,
      value_json, confidence, review_state, source_ids_json, evidence_json, validity_json, supersedes_claim_id, superseded_at, version, created_by, created_at, applied_at)
      VALUES (?,?,?,?,'organization-dossier',?,'append',?,?,'applied',?,?,?,'','',1,'server:research-discovery',?,?)`)
      .bind(overlayClaimId, run.workspaceId, proposalId, target.dossierId, claim.fieldPath, JSON.stringify(value), claim.confidence, JSON.stringify(sourceIds),
        JSON.stringify({ sources: claim.sources, evidenceGate: "exact_official_source" }), JSON.stringify({ observedAt: now, effectiveFrom: claim.effectiveFrom || null, effectiveTo: claim.effectiveTo || null }), now, now),
    db.prepare(`INSERT INTO dbi_research_claims (id, run_id, workspace_id, dossier_id, gap_id, claim_type, field_path, label, value_json,
      confidence, exact, citations_json, status, decision_reason, fingerprint, proposal_id, model, created_at, published_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(claimRecordId, run.id, run.workspaceId, target.dossierId, target.gapId, claim.claimType,
      claim.fieldPath, claim.label, JSON.stringify(value), claim.confidence, 1, JSON.stringify(claim.sources), "published", "Exact official-source evidence",
      fingerprint, proposalId, config.model, now, now),
    ...graph.statements,
  ]);
  return { status: "published", fingerprint, proposalId, entities: graph.entities, relations: graph.relations };
}

async function processTarget(db, env, run, target, config, credential, deps) {
  const targetRunId = crypto.randomUUID(); const startedAt = iso(); const startedMs = Date.now();
  await db.prepare(`INSERT INTO dbi_research_run_targets (id, run_id, workspace_id, dossier_id, dossier_label, gap_id, gap_type, status, started_at)
    VALUES (?,?,?,?,?,?,?,'running',?)`).bind(targetRunId, run.id, run.workspaceId, target.dossierId, target.dossierLabel, target.gapId, target.gapType, startedAt).run();
  try {
    const result = await openAiResearch(credential.apiKey, target, config, env);
    const normalized = normalizeResearch(result.payload, consultedSources(result.response), config);
    const counts = { published: 0, held: 0, duplicate: 0, rejected: 0, entities: 0, relations: 0 };
    for (const claim of normalized.claims) { const outcome = await publishClaim(db, run, target, claim, config); counts[outcome.status] += 1; counts.entities += Number(outcome.entities || 0); counts.relations += Number(outcome.relations || 0); }
    const sources = new Set(normalized.claims.flatMap((claim) => claim.sources.map((source) => source.url))).size;
    const completedAt = iso();
    await db.prepare(`UPDATE dbi_research_run_targets SET status='succeeded', sources_explored=?, claims_discovered=?, claims_published=?, entities_published=?, relations_published=?, claims_held=?,
      duration_ms=?, completed_at=? WHERE id=?`).bind(sources, normalized.claims.length, counts.published, counts.entities, counts.relations, counts.held, Date.now() - startedMs, completedAt, targetRunId).run();
    await deps.recordApiRequest(db, { workspaceId: run.workspaceId, userId: "", principalType: "system", principalId: "server:research-discovery",
      requestKind: "openai", provider: "openai", operation: "organization_discovery.research", method: "POST", route: "/v1/responses", status: "succeeded",
      httpStatus: 200, stage: "research", model: config.model, credentialId: credential.id === "mock-credential" ? "" : credential.id,
      credentialScope: "workspace", providerRequestId: result.requestId, traceId: run.id, responseId: result.response?.id || "", latencyMs: result.latencyMs,
      inputTokens: Number(result.response?.usage?.input_tokens || 0), outputTokens: Number(result.response?.usage?.output_tokens || 0), metadata: { targetRunId, dossierId: target.dossierId, gapId: target.gapId, published: counts.published, held: counts.held, duplicates: counts.duplicate }, startedAt, completedAt });
    return { completed: 1, sources, discovered: normalized.claims.length, published: counts.published, entities: counts.entities, relations: counts.relations, held: counts.held, duplicates: counts.duplicate, conflicts: 0, gapsResolved: counts.published ? 1 : 0, inputTokens: Number(result.response?.usage?.input_tokens || 0), outputTokens: Number(result.response?.usage?.output_tokens || 0) };
  } catch (error) {
    const completedAt = iso();
    await db.prepare("UPDATE dbi_research_run_targets SET status='failed', error_code=?, error_message=?, duration_ms=?, completed_at=? WHERE id=?")
      .bind(text(error?.code || "research_failed", 100), text(error?.message || "Research failed", 500), Date.now() - startedMs, completedAt, targetRunId).run();
    await deps.recordApiRequest(db, { workspaceId: run.workspaceId, userId: "", principalType: "system", principalId: "server:research-discovery",
      requestKind: "openai", provider: "openai", operation: "organization_discovery.research", method: "POST", route: "/v1/responses", status: "failed",
      httpStatus: Number(error?.httpStatus || 502), stage: "research", model: config.model, credentialId: credential.id === "mock-credential" ? "" : credential.id,
      credentialScope: "workspace", providerRequestId: error?.requestId || "", traceId: run.id, latencyMs: Number(error?.latencyMs || Date.now() - startedMs),
      retryable: Number(error?.httpStatus || 0) >= 500 || Number(error?.httpStatus || 0) === 429, errorCode: error?.code || "research_failed", errorMessage: error?.message || "Research failed", metadata: { targetRunId, dossierId: target.dossierId, gapId: target.gapId }, startedAt, completedAt }).catch(() => {});
    return { completed: 1, failed: 1, sources: 0, discovered: 0, published: 0, entities: 0, relations: 0, held: 0, duplicates: 0, conflicts: 0, gapsResolved: 0, inputTokens: 0, outputTokens: 0 };
  }
}

export async function executeResearchRun({ db, env, request, runId, workspaceId, config, decryptSecret, assetJson, deps }) {
  const run = { id: runId, workspaceId }; const startedAt = iso();
  try {
    await db.prepare("UPDATE dbi_research_runs SET status='running', stage='selecting_targets' WHERE id=?").bind(runId).run();
    const credential = await credentialForWorkspace(db, workspaceId, env, decryptSecret);
    if (!credential) throw Object.assign(new Error("Configure a workspace-default OpenAI key before enabling research discovery"), { code: "credential_unavailable" });
    const artifact = await assetJson(request, env, "/data/organization-intelligence.json");
    const targets = await targetsForRun(db, artifact, workspaceId, config);
    await db.prepare("UPDATE dbi_research_runs SET stage='researching', targets_planned=? WHERE id=?").bind(targets.length, runId).run();
    const totals = { completed: 0, failed: 0, sources: 0, discovered: 0, published: 0, entities: 0, relations: 0, held: 0, duplicates: 0, conflicts: 0, gapsResolved: 0, inputTokens: 0, outputTokens: 0 };
    for (let index = 0; index < targets.length; index += config.concurrency) {
      const results = await Promise.all(targets.slice(index, index + config.concurrency).map((target) => processTarget(db, env, run, target, config, credential, deps)));
      for (const result of results) for (const key of Object.keys(totals)) totals[key] += Number(result[key] || 0);
      await db.prepare(`UPDATE dbi_research_runs SET targets_completed=?, sources_explored=?, claims_discovered=?, claims_published=?, entities_published=?, relations_published=?, claims_held=?,
        duplicates_suppressed=?, conflicts_held=?, gaps_resolved=?, input_tokens=?, output_tokens=? WHERE id=?`).bind(totals.completed, totals.sources,
        totals.discovered, totals.published, totals.entities, totals.relations, totals.held, totals.duplicates, totals.conflicts, totals.gapsResolved, totals.inputTokens, totals.outputTokens, runId).run();
    }
    const status = totals.failed ? (totals.failed === targets.length ? "failed" : "partial") : "succeeded"; const completedAt = iso();
    await db.prepare("UPDATE dbi_research_runs SET status=?, stage='completed', completed_at=?, error_code=?, error_message=? WHERE id=?")
      .bind(status, completedAt, status === "failed" ? "all_targets_failed" : "", status === "failed" ? "Every selected research target failed" : "", runId).run();
    if (credential.id !== "mock-credential") await db.prepare("UPDATE dbi_openai_keys SET last_used_at=?, updated_at=? WHERE id=?").bind(completedAt, completedAt, credential.id).run();
    await deps.recordActivity(db, { type: "system", id: "server:research-discovery", workspaceId }, "research_discovery_completed", "research_run", runId, totals).catch(() => {});
    return { runId, status, totals, durationMs: Date.now() - Date.parse(startedAt) };
  } catch (error) {
    const completedAt = iso();
    await db.prepare("UPDATE dbi_research_runs SET status='failed', stage='failed', error_code=?, error_message=?, completed_at=? WHERE id=?")
      .bind(text(error?.code || "research_run_failed", 100), text(error?.message || "Research run failed", 500), completedAt, runId).run();
    return { runId, status: "failed", error: error?.code || "research_run_failed" };
  }
}

async function activeRun(db, workspaceId) {
  return db.prepare("SELECT * FROM dbi_research_runs WHERE workspace_id=? AND status IN ('queued','running') ORDER BY started_at DESC LIMIT 1").bind(workspaceId).first();
}

async function queueRun({ db, workspaceId, trigger, config }) {
  const active = await activeRun(db, workspaceId); if (active) return { active };
  const id = crypto.randomUUID(); const now = iso();
  await db.prepare(`INSERT INTO dbi_research_runs (id, workspace_id, trigger_type, status, stage, model, reasoning_effort, config_json, started_at)
    VALUES (?,?,?,'queued','queued',?,?,?,?)`).bind(id, workspaceId, trigger, config.model, config.reasoningEffort, JSON.stringify(config), now).run();
  return { id };
}

function runView(row) { return row ? {
  id: row.id, trigger: row.trigger_type, status: row.status, stage: row.stage, model: row.model, reasoningEffort: row.reasoning_effort,
  targetsPlanned: Number(row.targets_planned || 0), targetsCompleted: Number(row.targets_completed || 0), sourcesExplored: Number(row.sources_explored || 0),
  claimsDiscovered: Number(row.claims_discovered || 0), claimsPublished: Number(row.claims_published || 0), claimsHeld: Number(row.claims_held || 0),
  entitiesPublished: Number(row.entities_published || 0), relationsPublished: Number(row.relations_published || 0),
  duplicatesSuppressed: Number(row.duplicates_suppressed || 0), conflictsHeld: Number(row.conflicts_held || 0), gapsResolved: Number(row.gaps_resolved || 0),
  inputTokens: Number(row.input_tokens || 0), outputTokens: Number(row.output_tokens || 0), errorCode: row.error_code || null,
  errorMessage: row.error_message || null, startedAt: row.started_at, completedAt: row.completed_at || null,
} : null; }

async function dashboard(db, workspaceId, config, credentialAvailable) {
  const [runs, totals, statuses, distinctTargets, distinctGaps, claims, active] = await Promise.all([
    db.prepare("SELECT * FROM dbi_research_runs WHERE workspace_id=? ORDER BY started_at DESC LIMIT 60").bind(workspaceId).all(),
    db.prepare(`SELECT COUNT(*) AS runs, SUM(targets_completed) AS targets, SUM(sources_explored) AS sources, SUM(claims_discovered) AS discovered,
      SUM(claims_published) AS published, SUM(entities_published) AS entities, SUM(relations_published) AS relations, SUM(claims_held) AS held, SUM(duplicates_suppressed) AS duplicates, SUM(conflicts_held) AS conflicts,
      SUM(gaps_resolved) AS gaps, SUM(input_tokens) AS input_tokens, SUM(output_tokens) AS output_tokens
      FROM dbi_research_runs WHERE workspace_id=?`).bind(workspaceId).first(),
    db.prepare("SELECT status, COUNT(*) AS count FROM dbi_research_runs WHERE workspace_id=? GROUP BY status").bind(workspaceId).all(),
    db.prepare("SELECT COUNT(DISTINCT dossier_id) AS count FROM dbi_research_run_targets WHERE workspace_id=?").bind(workspaceId).first(),
    db.prepare("SELECT COUNT(DISTINCT gap_id) AS count FROM dbi_research_run_targets WHERE workspace_id=?").bind(workspaceId).first(),
    db.prepare("SELECT * FROM dbi_research_claims WHERE workspace_id=? ORDER BY created_at DESC LIMIT 50").bind(workspaceId).all(),
    activeRun(db, workspaceId),
  ]);
  const statusCounts = Object.fromEntries((statuses.results || []).map((row) => [row.status, Number(row.count || 0)]));
  const totalRuns = Number(totals?.runs || 0); const successful = Number(statusCounts.succeeded || 0) + Number(statusCounts.partial || 0);
  return {
    config, credentialAvailable, activeRun: runView(active), runs: (runs.results || []).map(runView),
    summary: { runs: totalRuns, successfulRuns: successful, successRate: totalRuns ? successful / totalRuns : 0, targetsExplored: Number(totals?.targets || 0),
      organizationsExplored: Number(distinctTargets?.count || 0), gapsExplored: Number(distinctGaps?.count || 0), sourcesExplored: Number(totals?.sources || 0),
      claimsDiscovered: Number(totals?.discovered || 0), claimsPublished: Number(totals?.published || 0), claimsHeld: Number(totals?.held || 0),
      entitiesPublished: Number(totals?.entities || 0), relationsPublished: Number(totals?.relations || 0),
      duplicatesSuppressed: Number(totals?.duplicates || 0), conflictsHeld: Number(totals?.conflicts || 0), gapsResolved: Number(totals?.gaps || 0),
      inputTokens: Number(totals?.input_tokens || 0), outputTokens: Number(totals?.output_tokens || 0) },
    claims: (claims.results || []).map((row) => ({ id: row.id, runId: row.run_id, dossierId: row.dossier_id, gapId: row.gap_id, claimType: row.claim_type,
      label: row.label, value: parsed(row.value_json, {}), confidence: row.confidence, exact: Boolean(row.exact), status: row.status,
      reason: row.decision_reason, citations: parsed(row.citations_json, []), model: row.model, createdAt: row.created_at, publishedAt: row.published_at || null })),
  };
}

async function schedulerAuthorized(request, env) {
  const expected = String(env.DBI_SCHEDULER_TOKEN || ""); const supplied = String(request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (expected.length < 32 || expected.length !== supplied.length) return false;
  const [left, right] = await Promise.all([expected, supplied].map((value) => crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))));
  return [...new Uint8Array(left)].every((value, index) => value === new Uint8Array(right)[index]);
}

export async function researchSchedulerResponse(request, db, env, _context, deps) {
  if (request.method !== "POST") return deps.json({ error: "Method not allowed" }, 405);
  if (!await schedulerAuthorized(request, env)) return deps.json({ error: "Unauthorized" }, 401);
  const workspaces = await db.prepare("SELECT workspace_id FROM dbi_workspaces ORDER BY created_at LIMIT 20").all();
  const scheduled = [];
  for (const row of workspaces.results || []) {
    const config = await ensureConfig(db, row.workspace_id);
    if (!config.enabled) continue;
    const latest = await db.prepare("SELECT completed_at, started_at FROM dbi_research_runs WHERE workspace_id=? ORDER BY started_at DESC LIMIT 1").bind(row.workspace_id).first();
    const last = Date.parse(latest?.completed_at || latest?.started_at || "");
    if (Number.isFinite(last) && Date.now() - last < config.cadenceMinutes * 60_000) continue;
    const queued = await queueRun({ db, workspaceId: row.workspace_id, trigger: "scheduled", config });
    if (!queued.id) continue;
    scheduled.push(queued.id);
    await executeResearchRun({ db, env, request, runId: queued.id, workspaceId: row.workspace_id, config, decryptSecret: deps.decryptSecret, assetJson: deps.assetJson, deps });
  }
  return deps.json({ scheduled: scheduled.length, runIds: scheduled }, 202);
}

export async function researchOperationsResponse(request, db, env, _context, deps) {
  const session = await deps.sessionUser(db, request); if (!session) return deps.json({ error: "Sign in required" }, 401);
  const workspaceId = session.active_workspace_id || ""; if (!workspaceId) return deps.json({ error: "Select a workspace first" }, 409);
  if (!session.can_manage_workspace && !deps.canAdministerWorkspaces(session)) return deps.json({ error: "Workspace manager access is required" }, 403);
  const segments = new URL(request.url).pathname.slice("/api/v1/auth/research-operations".length).split("/").filter(Boolean);
  if (request.method !== "GET" && !deps.sameOriginRequest(request)) return deps.json({ error: "Cross-origin research changes are not allowed" }, 403);
  let config = await ensureConfig(db, workspaceId, session.user_id);
  if (request.method === "GET" && !segments.length) {
    const credential = await credentialForWorkspace(db, workspaceId, env, deps.decryptSecret);
    return deps.json(await dashboard(db, workspaceId, config, Boolean(credential)));
  }
  if (segments[0] === "config" && request.method === "PATCH") {
    config = normalizeConfig(await deps.safeJson(request)); const now = iso();
    await db.prepare(`UPDATE dbi_research_configs SET enabled=?, cadence_minutes=?, batch_size=?, concurrency=?, max_sources_per_target=?,
      max_claims_per_target=?, revisit_after_hours=?, model=?, reasoning_effort=?, auto_publish=?, updated_by=?, updated_at=? WHERE workspace_id=?`)
      .bind(config.enabled ? 1 : 0, config.cadenceMinutes, config.batchSize, config.concurrency, config.maxSourcesPerTarget, config.maxClaimsPerTarget,
        config.revisitAfterHours, config.model, config.reasoningEffort, config.autoPublish ? 1 : 0, session.user_id, now, workspaceId).run();
    await deps.recordActivity(db, { type: "user", id: session.user_id, workspaceId }, "research_discovery_config_updated", "research_config", workspaceId, config);
    return deps.json({ config });
  }
  if (segments[0] === "run" && request.method === "POST") {
    const queued = await queueRun({ db, workspaceId, trigger: "manual", config });
    if (queued.active) return deps.json({ error: "A research run is already active", run: runView(queued.active) }, 409);
    const result = await executeResearchRun({ db, env, request, runId: queued.id, workspaceId, config, decryptSecret: deps.decryptSecret, assetJson: deps.assetJson, deps });
    return deps.json({ run: { id: queued.id, status: result.status, stage: "completed", model: config.model, reasoningEffort: config.reasoningEffort, totals: result.totals || null } }, 200);
  }
  return deps.json({ error: "Method not allowed" }, 405);
}

export { DEFAULT_CONFIG as DEFAULT_RESEARCH_CONFIG, normalizeConfig as normalizeResearchConfig };
