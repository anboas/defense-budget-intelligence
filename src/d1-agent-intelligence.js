const ENTITY_TYPES = Object.freeze([
  "activity", "award", "event", "transaction", "organization", "organization-identifier",
  "contract-vehicle", "acquisition-path", "recompete-signal", "evidence-claim", "evidence-conflict",
  "location", "federal-account", "budget-line", "subaward-summary", "classification", "source",
  "spending-observation",
]);

const CLAIM_OPERATIONS = Object.freeze(["fill_missing", "replace", "append", "supersede", "add_relation"]);
const CONFIDENCE_VALUES = Object.freeze(["exact", "high", "medium", "low"]);
const SOURCE_AUTHORITIES = Object.freeze(["official_primary", "official_secondary", "public_database", "verified_organization", "other_public"]);
const PROPOSAL_STATUSES = Object.freeze(["needs_review", "approved", "rejected", "applied"]);
const FORBIDDEN_FIELD_SEGMENTS = new Set(["password", "secret", "token", "credential", "authorization", "cookie"]);

export const D1_AGENT_INTELLIGENCE_SCHEMA = Object.freeze([
  `CREATE TABLE IF NOT EXISTS dbi_intelligence_proposals (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    target_entity_id TEXT NOT NULL,
    target_entity_type TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('needs_review','approved','rejected','applied')),
    title TEXT NOT NULL,
    summary TEXT NOT NULL DEFAULT '',
    proposal_json TEXT NOT NULL,
    review_json TEXT NOT NULL DEFAULT '{}',
    model TEXT NOT NULL DEFAULT '',
    response_id TEXT NOT NULL DEFAULT '',
    trace_id TEXT NOT NULL DEFAULT '',
    version INTEGER NOT NULL DEFAULT 1,
    created_by_type TEXT NOT NULL,
    created_by TEXT NOT NULL,
    reviewed_by_type TEXT NOT NULL DEFAULT '',
    reviewed_by TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    reviewed_at TEXT NOT NULL DEFAULT '',
    applied_at TEXT NOT NULL DEFAULT ''
  )`,
  "CREATE INDEX IF NOT EXISTS idx_dbi_intelligence_proposals_workspace ON dbi_intelligence_proposals (workspace_id, status, updated_at DESC)",
  "CREATE INDEX IF NOT EXISTS idx_dbi_intelligence_proposals_target ON dbi_intelligence_proposals (workspace_id, target_entity_id, updated_at DESC)",
  `CREATE TABLE IF NOT EXISTS dbi_intelligence_sources (
    workspace_id TEXT NOT NULL,
    source_id TEXT NOT NULL,
    url TEXT NOT NULL,
    title TEXT NOT NULL,
    publisher TEXT NOT NULL DEFAULT '',
    authority TEXT NOT NULL,
    retrieved_at TEXT NOT NULL,
    supports_text TEXT NOT NULL DEFAULT '',
    proposal_id TEXT NOT NULL,
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (workspace_id, source_id),
    UNIQUE (workspace_id, url)
  )`,
  "CREATE INDEX IF NOT EXISTS idx_dbi_intelligence_sources_workspace ON dbi_intelligence_sources (workspace_id, updated_at DESC)",
  `CREATE TABLE IF NOT EXISTS dbi_intelligence_entities (
    workspace_id TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    label TEXT NOT NULL,
    payload_json TEXT NOT NULL DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','superseded','withdrawn')),
    version INTEGER NOT NULL DEFAULT 1,
    proposal_id TEXT NOT NULL,
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (workspace_id, entity_id)
  )`,
  "CREATE INDEX IF NOT EXISTS idx_dbi_intelligence_entities_type ON dbi_intelligence_entities (workspace_id, entity_type, updated_at DESC)",
  `CREATE TABLE IF NOT EXISTS dbi_intelligence_claims (
    claim_id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    proposal_id TEXT NOT NULL,
    target_entity_id TEXT NOT NULL,
    target_entity_type TEXT NOT NULL,
    field_path TEXT NOT NULL,
    operation TEXT NOT NULL,
    value_json TEXT NOT NULL,
    confidence TEXT NOT NULL,
    review_state TEXT NOT NULL CHECK (review_state IN ('applied','superseded','withdrawn')),
    source_ids_json TEXT NOT NULL,
    evidence_json TEXT NOT NULL,
    validity_json TEXT NOT NULL,
    supersedes_claim_id TEXT NOT NULL DEFAULT '',
    superseded_at TEXT NOT NULL DEFAULT '',
    version INTEGER NOT NULL DEFAULT 1,
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL,
    applied_at TEXT NOT NULL
  )`,
  "CREATE INDEX IF NOT EXISTS idx_dbi_intelligence_claims_target ON dbi_intelligence_claims (workspace_id, target_entity_id, review_state, applied_at DESC)",
  `CREATE TABLE IF NOT EXISTS dbi_intelligence_relations (
    relation_id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    proposal_id TEXT NOT NULL,
    relation_type TEXT NOT NULL,
    from_entity_id TEXT NOT NULL,
    to_entity_id TEXT NOT NULL,
    attributes_json TEXT NOT NULL DEFAULT '{}',
    evidence_json TEXT NOT NULL,
    validity_json TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'applied' CHECK (status IN ('applied','superseded','withdrawn')),
    version INTEGER NOT NULL DEFAULT 1,
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL,
    applied_at TEXT NOT NULL
  )`,
  "CREATE INDEX IF NOT EXISTS idx_dbi_intelligence_relations_from ON dbi_intelligence_relations (workspace_id, from_entity_id, status, applied_at DESC)",
  "CREATE INDEX IF NOT EXISTS idx_dbi_intelligence_relations_to ON dbi_intelligence_relations (workspace_id, to_entity_id, status, applied_at DESC)",
  `CREATE TABLE IF NOT EXISTS dbi_intelligence_jobs (
    job_id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('validate_proposal','publish_proposal','reindex_workspace')),
    proposal_id TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL CHECK (status IN ('accepted','completed','failed')),
    output_json TEXT NOT NULL DEFAULT '{}',
    error_code TEXT NOT NULL DEFAULT '',
    error_message TEXT NOT NULL DEFAULT '',
    created_by_type TEXT NOT NULL,
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    completed_at TEXT NOT NULL DEFAULT ''
  )`,
  "CREATE INDEX IF NOT EXISTS idx_dbi_intelligence_jobs_workspace ON dbi_intelligence_jobs (workspace_id, created_at DESC)",
]);

const allowedKeys = (value, allowed) => value && typeof value === "object" && !Array.isArray(value)
  && Object.keys(value).every((key) => allowed.includes(key));

const clean = (value, limit = 500) => String(value ?? "").trim().slice(0, limit);
const parseJson = (value, fallback) => { try { return JSON.parse(value); } catch { return fallback; } };
const unique = (values) => [...new Set(values)];

function cleanPublicUrl(value) {
  try {
    const url = new URL(clean(value, 1500));
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return "";
    const host = url.hostname.toLowerCase();
    if (host === "localhost" || host === "0.0.0.0" || host === "[::1]" || host.endsWith(".local") || host.endsWith(".internal")
      || /^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host) || /^169\.254\./.test(host)
      || /^172\.(1[6-9]|2\d|3[01])\./.test(host) || /^100\.(6[4-9]|[78]\d|9\d|1[01]\d|12[0-7])\./.test(host)) return "";
    if ([...url.searchParams.keys()].some((key) => /(?:token|key|secret|password|credential|authorization)/i.test(key))) return "";
    return url.href;
  } catch {
    return "";
  }
}

function containsForbiddenKey(value, depth = 0) {
  if (!value || typeof value !== "object" || depth > 8) return false;
  if (Array.isArray(value)) return value.some((item) => containsForbiddenKey(item, depth + 1));
  return Object.entries(value).some(([key, item]) => FORBIDDEN_FIELD_SEGMENTS.has(key.toLowerCase()) || containsForbiddenKey(item, depth + 1));
}

function cleanIsoDate(value) {
  const text = clean(value, 40);
  if (!text) return null;
  const timestamp = Date.parse(text);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

async function sha256(value) {
  const bytes = new TextEncoder().encode(String(value));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function proposalFromRow(row) {
  return {
    id: row.id,
    target: { entityId: row.target_entity_id, entityType: row.target_entity_type },
    status: row.status,
    title: row.title,
    summary: row.summary,
    proposal: parseJson(row.proposal_json, {}),
    review: parseJson(row.review_json, {}),
    model: row.model || null,
    responseId: row.response_id || null,
    traceId: row.trace_id || null,
    version: Number(row.version || 1),
    createdBy: { type: row.created_by_type, id: row.created_by },
    reviewedBy: row.reviewed_by ? { type: row.reviewed_by_type, id: row.reviewed_by } : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    reviewedAt: row.reviewed_at || null,
    appliedAt: row.applied_at || null,
  };
}

function claimFromRow(row) {
  return {
    id: row.claim_id,
    proposalId: row.proposal_id,
    targetEntityId: row.target_entity_id,
    targetEntityType: row.target_entity_type,
    fieldPath: row.field_path,
    operation: row.operation,
    value: parseJson(row.value_json, null),
    confidence: row.confidence,
    reviewState: row.review_state,
    sourceIds: parseJson(row.source_ids_json, []),
    evidence: parseJson(row.evidence_json, {}),
    validity: parseJson(row.validity_json, {}),
    supersedesClaimId: row.supersedes_claim_id || null,
    version: Number(row.version || 1),
    createdAt: row.created_at,
    appliedAt: row.applied_at,
  };
}

function relationFromRow(row) {
  return {
    id: row.relation_id,
    type: row.relation_type,
    from: row.from_entity_id,
    to: row.to_entity_id,
    attributes: parseJson(row.attributes_json, {}),
    evidence: parseJson(row.evidence_json, {}),
    validity: parseJson(row.validity_json, {}),
    status: row.status,
    version: Number(row.version || 1),
    proposalId: row.proposal_id,
    workspaceOverlay: true,
  };
}

function entityTypeFromId(id) {
  const value = clean(id, 220);
  if (value.startsWith("workspace:")) return ENTITY_TYPES.includes(value.split(":")[1]) ? value.split(":")[1] : "";
  const prefixes = [
    ["org-identifier:", "organization-identifier"], ["contract-vehicle:", "contract-vehicle"],
    ["acquisition-path:", "acquisition-path"], ["recompete-signal:", "recompete-signal"],
    ["evidence-claim:", "evidence-claim"], ["evidence-conflict:", "evidence-conflict"],
    ["subaward-summary:", "subaward-summary"], ["budget-line:", "budget-line"],
    ["spending-observation:", "spending-observation"],
    ["activity:", "activity"], ["award:", "award"], ["event:", "event"], ["transaction:", "transaction"],
    ["org:", "organization"], ["location:", "location"], ["account:", "federal-account"],
    ["class:", "classification"], ["source:", "source"],
  ];
  return prefixes.find(([prefix]) => value.startsWith(prefix))?.[1] || "";
}

function setPath(target, path, value, operation) {
  const segments = path.split(".");
  let cursor = target;
  for (const segment of segments.slice(0, -1)) {
    if (!cursor[segment] || typeof cursor[segment] !== "object" || Array.isArray(cursor[segment])) cursor[segment] = {};
    cursor = cursor[segment];
  }
  const key = segments.at(-1);
  if (operation === "fill_missing" && cursor[key] !== undefined && cursor[key] !== null && cursor[key] !== "") return;
  if (operation === "append") {
    const additions = Array.isArray(value) ? value : [value];
    cursor[key] = unique([...(Array.isArray(cursor[key]) ? cursor[key] : []), ...additions].map((item) => JSON.stringify(item))).map((item) => JSON.parse(item));
    return;
  }
  cursor[key] = value;
}

function effectiveEntity(baseEntity, claims) {
  const entity = structuredClone(baseEntity || {});
  for (const claim of claims.filter((item) => item.reviewState === "applied")) {
    if (claim.operation !== "add_relation") setPath(entity, claim.fieldPath, claim.value, claim.operation);
  }
  return entity;
}

async function graphManifest(request, env, deps) {
  return deps.assetJson(request, env, "/data/agent-graph/manifest.json");
}

async function entityShard(request, env, deps, type) {
  if (!ENTITY_TYPES.includes(type)) return null;
  return deps.assetJson(request, env, `/data/agent-graph/entities-${type}.json`);
}

async function relationShard(request, env, deps, type) {
  if (!ENTITY_TYPES.includes(type)) return null;
  const manifest = await graphManifest(request, env, deps);
  const paths = manifest.entityTypes?.[type]?.relationPaths || [];
  const pages = await Promise.all(paths.map((path) => deps.assetJson(request, env, path)));
  return { relations: pages.flatMap((page) => page?.relations || []) };
}

async function workspaceClaims(db, workspaceId, entityId) {
  const result = await db.prepare(`SELECT * FROM dbi_intelligence_claims
    WHERE workspace_id = ? AND target_entity_id = ? AND review_state IN ('applied','superseded')
    ORDER BY applied_at, claim_id`).bind(workspaceId, entityId).all();
  return (result.results || []).map(claimFromRow);
}

async function findEntity(request, env, db, principal, deps, entityId, typeHint = "") {
  const workspace = await db.prepare("SELECT * FROM dbi_intelligence_entities WHERE workspace_id = ? AND entity_id = ? AND status = 'active'")
    .bind(principal.workspaceId, entityId).first();
  if (workspace) {
    const baseEntity = { id: workspace.entity_id, type: workspace.entity_type, label: workspace.label, ...parseJson(workspace.payload_json, {}), workspaceOverlay: true };
    const claims = await workspaceClaims(db, principal.workspaceId, entityId);
    return { type: workspace.entity_type, baseEntity, effectiveEntity: effectiveEntity(baseEntity, claims), claims };
  }
  const type = typeHint || entityTypeFromId(entityId);
  const shard = await entityShard(request, env, deps, type);
  const baseEntity = shard?.entities?.find((item) => item.id === entityId);
  if (!baseEntity) return null;
  const claims = await workspaceClaims(db, principal.workspaceId, entityId);
  return { type, baseEntity, effectiveEntity: effectiveEntity(baseEntity, claims), claims };
}

function normalizeSource(input, errors, location) {
  if (!allowedKeys(input, ["url", "title", "publisher", "retrievedAt", "supports", "authority"])) {
    errors.push(`${location} contains unsupported fields`);
    return null;
  }
  const url = cleanPublicUrl(input.url);
  const title = clean(input.title, 240);
  const authority = clean(input.authority, 40);
  const retrievedAt = cleanIsoDate(input.retrievedAt) || new Date().toISOString();
  if (!url || !title || !SOURCE_AUTHORITIES.includes(authority)) {
    errors.push(`${location} requires a public HTTP(S) URL, title, and supported authority`);
    return null;
  }
  return { url, title, publisher: clean(input.publisher, 180), retrievedAt, supports: clean(input.supports, 1000), authority };
}

function normalizeProposal(input) {
  const errors = [];
  if (!allowedKeys(input, ["title", "summary", "target", "claims", "model", "responseId", "traceId"])) errors.push("Proposal contains unsupported fields");
  if (!allowedKeys(input?.target, ["entityId", "entityType", "create", "label"])) errors.push("Target contains unsupported fields");
  const entityType = clean(input?.target?.entityType, 80);
  const create = input?.target?.create === true;
  let entityId = clean(input?.target?.entityId, 220);
  const label = clean(input?.target?.label, 240);
  if (!ENTITY_TYPES.includes(entityType)) errors.push("Target entityType is not part of the published domain model");
  if (create && !label) errors.push("New entities require a label");
  if (!create && !entityId) errors.push("Existing targets require entityId");
  if (create && entityId && !entityId.startsWith(`workspace:${entityType}:`)) errors.push("New entity IDs must use the workspace namespace");
  if (create && !entityId) entityId = `workspace:${entityType}:${crypto.randomUUID()}`;
  const rawClaims = Array.isArray(input?.claims) ? input.claims : [];
  if (!rawClaims.length || rawClaims.length > 20) errors.push("Proposal requires between 1 and 20 claims");
  const claims = rawClaims.slice(0, 20).flatMap((raw, index) => {
    const location = `claims[${index}]`;
    if (!allowedKeys(raw, ["fieldPath", "operation", "value", "confidence", "rationale", "observedAt", "effectiveFrom", "effectiveTo", "sources", "relation"])) {
      errors.push(`${location} contains unsupported fields`);
      return [];
    }
    const operation = clean(raw.operation, 40);
    const fieldPath = clean(raw.fieldPath, 120);
    const confidence = clean(raw.confidence, 20);
    const relation = raw.relation && typeof raw.relation === "object" && !Array.isArray(raw.relation) ? raw.relation : {};
    if (!CLAIM_OPERATIONS.includes(operation)) errors.push(`${location}.operation is unsupported`);
    if (!CONFIDENCE_VALUES.includes(confidence)) errors.push(`${location}.confidence is unsupported`);
    if (operation === "add_relation") {
      if (!allowedKeys(relation, ["type", "fromEntityId", "toEntityId", "attributes"])) errors.push(`${location}.relation contains unsupported fields`);
      if (!clean(relation?.type, 100) || !clean(relation?.fromEntityId, 220) || !clean(relation?.toEntityId, 220)) errors.push(`${location}.relation requires type, fromEntityId, and toEntityId`);
      if (relation?.attributes !== undefined && (!relation.attributes || typeof relation.attributes !== "object" || Array.isArray(relation.attributes)
        || JSON.stringify(relation.attributes).length > 2_000 || containsForbiddenKey(relation.attributes))) errors.push(`${location}.relation.attributes must be a secret-free object of at most 2 KB`);
    } else {
      const segments = fieldPath.split(".");
      if (!/^[A-Za-z][A-Za-z0-9]*(?:\.[A-Za-z][A-Za-z0-9]*)*$/.test(fieldPath) || segments.some((segment) => FORBIDDEN_FIELD_SEGMENTS.has(segment.toLowerCase()))) {
        errors.push(`${location}.fieldPath is invalid or protected`);
      }
      if (raw.value === undefined || JSON.stringify(raw.value).length > 4_000 || containsForbiddenKey(raw.value)) errors.push(`${location}.value is required, secret-free, and must be at most 4 KB`);
    }
    const rawSources = Array.isArray(raw.sources) ? raw.sources : [];
    if (!rawSources.length || rawSources.length > 5) errors.push(`${location} requires between 1 and 5 cited sources`);
    const sources = rawSources.slice(0, 5).map((source, sourceIndex) => normalizeSource(source, errors, `${location}.sources[${sourceIndex}]`)).filter(Boolean);
    return [{
      fieldPath: operation === "add_relation" ? "relations" : fieldPath,
      operation,
      value: operation === "add_relation" ? null : raw.value,
      confidence,
      rationale: clean(raw.rationale, 1200),
      observedAt: cleanIsoDate(raw.observedAt) || new Date().toISOString(),
      effectiveFrom: cleanIsoDate(raw.effectiveFrom),
      effectiveTo: cleanIsoDate(raw.effectiveTo),
      sources,
      ...(operation === "add_relation" ? { relation: {
        type: clean(relation.type, 100),
        fromEntityId: clean(relation.fromEntityId, 220),
        toEntityId: clean(relation.toEntityId, 220),
        attributes: relation.attributes && typeof relation.attributes === "object" && !Array.isArray(relation.attributes) ? relation.attributes : {},
      } } : {}),
    }];
  });
  const uniqueSources = new Set(claims.flatMap((claim) => claim.sources.map((source) => source.url)));
  if (uniqueSources.size > 30) errors.push("Proposal cites more than 30 unique sources");
  return {
    errors,
    proposal: {
      title: clean(input?.title, 240),
      summary: clean(input?.summary, 2000),
      target: { entityId, entityType, create, label },
      claims,
      model: clean(input?.model, 120),
      responseId: clean(input?.responseId, 180),
      traceId: clean(input?.traceId, 180),
    },
  };
}

async function graphSummaryResponse(request, env, db, principal, deps) {
  if (request.method !== "GET") return deps.error("method_not_allowed", "Method not allowed", 405);
  if (!deps.hasScope(principal, "graph:read")) return deps.error("insufficient_scope", "Scope graph:read is required", 403);
  const [summary, manifest, proposalCounts, entityCount, claimCount, relationCount] = await Promise.all([
    deps.assetJson(request, env, "/data/intelligence-graph-summary.json"),
    graphManifest(request, env, deps),
    db.prepare("SELECT status, COUNT(*) AS count FROM dbi_intelligence_proposals WHERE workspace_id = ? GROUP BY status").bind(principal.workspaceId).all(),
    db.prepare("SELECT COUNT(*) AS count FROM dbi_intelligence_entities WHERE workspace_id = ? AND status = 'active'").bind(principal.workspaceId).first(),
    db.prepare("SELECT COUNT(*) AS count FROM dbi_intelligence_claims WHERE workspace_id = ? AND review_state = 'applied'").bind(principal.workspaceId).first(),
    db.prepare("SELECT COUNT(*) AS count FROM dbi_intelligence_relations WHERE workspace_id = ? AND status = 'applied'").bind(principal.workspaceId).first(),
  ]);
  return deps.json({
    published: summary,
    agentDirectory: manifest,
    workspaceOverlay: {
      entities: Number(entityCount?.count || 0), claims: Number(claimCount?.count || 0), relations: Number(relationCount?.count || 0),
      proposals: Object.fromEntries((proposalCounts.results || []).map((row) => [row.status, Number(row.count || 0)])),
    },
  }, 200, { contractVersion: "1.1.0" });
}

async function entitiesResponse(request, env, db, principal, segments, deps) {
  if (request.method !== "GET") return deps.error("method_not_allowed", "Method not allowed", 405);
  if (!deps.hasScope(principal, "graph:read")) return deps.error("insufficient_scope", "Scope graph:read is required", 403);
  const entityId = clean(decodeURIComponent(segments[0] || ""), 220);
  if (entityId) {
    const found = await findEntity(request, env, db, principal, deps, entityId);
    if (!found) return deps.error("entity_not_found", "Entity not found", 404);
    if (segments[1] === "relations") {
      const shard = found.baseEntity.workspaceOverlay ? { relations: [] } : await relationShard(request, env, deps, found.type);
      const params = new URL(request.url).searchParams;
      const direction = ["incoming", "outgoing", "both"].includes(params.get("direction")) ? params.get("direction") : "both";
      const relationType = clean(params.get("type"), 100);
      const limit = deps.boundedInteger(params.get("limit"), 100, 1, 250);
      const baseRelations = (shard?.relations || []).filter((relation) => (direction === "incoming" ? relation.to === entityId : direction === "outgoing" ? relation.from === entityId : relation.from === entityId || relation.to === entityId) && (!relationType || relation.type === relationType));
      const workspace = await db.prepare(`SELECT * FROM dbi_intelligence_relations WHERE workspace_id = ? AND status = 'applied'
        AND (from_entity_id = ? OR to_entity_id = ?) ORDER BY applied_at DESC LIMIT 250`).bind(principal.workspaceId, entityId, entityId).all();
      const overlayRelations = (workspace.results || []).map(relationFromRow).filter((relation) => (direction === "incoming" ? relation.to === entityId : direction === "outgoing" ? relation.from === entityId : true) && (!relationType || relation.type === relationType));
      const data = [...overlayRelations, ...baseRelations].slice(0, limit);
      return deps.json(data, 200, { total: overlayRelations.length + baseRelations.length, limit, direction, type: relationType || null });
    }
    return deps.json(found, 200, { entityType: found.type });
  }
  const params = new URL(request.url).searchParams;
  const type = clean(params.get("type"), 80);
  if (!ENTITY_TYPES.includes(type)) return deps.error("entity_type_required", "A published entity type is required", 400, undefined, { allowed: ENTITY_TYPES });
  const query = clean(params.get("q"), 200).toLowerCase();
  const limit = deps.boundedInteger(params.get("limit"), 50, 1, 100);
  const offset = deps.boundedInteger(params.get("cursor"), 0, 0, 1_000_000);
  const [shard, workspaceRows] = await Promise.all([
    entityShard(request, env, deps, type),
    db.prepare("SELECT * FROM dbi_intelligence_entities WHERE workspace_id = ? AND entity_type = ? AND status = 'active' ORDER BY updated_at DESC")
      .bind(principal.workspaceId, type).all(),
  ]);
  const workspaceEntities = (workspaceRows.results || []).map((row) => ({ id: row.entity_id, type: row.entity_type, label: row.label, ...parseJson(row.payload_json, {}), workspaceOverlay: true }));
  const all = [...workspaceEntities, ...(shard?.entities || [])].filter((entity) => !query || `${entity.id} ${entity.label || ""} ${JSON.stringify(entity)}`.toLowerCase().includes(query));
  return deps.json(all.slice(offset, offset + limit), 200, { total: all.length, limit, cursor: offset, nextCursor: offset + limit < all.length ? offset + limit : null, entityType: type });
}

async function activitiesConnectedResponse(request, env, db, principal, segments, deps) {
  if (request.method !== "GET") return deps.error("method_not_allowed", "Method not allowed", 405);
  if (!deps.hasScope(principal, "graph:read")) return deps.error("insufficient_scope", "Scope graph:read is required", 403);
  const activityId = clean(decodeURIComponent(segments[0] || ""), 220).replace(/^activity:/, "");
  if (!activityId || segments[1] !== "connected") return deps.error("route_not_found", "Unknown activity graph route", 404);
  const [graphIndex, lineageIndex, temporalIndex, claims, relations] = await Promise.all([
    deps.assetJson(request, env, "/data/intelligence-graph-index.json"),
    deps.assetJson(request, env, "/data/contract-lineage-index.json"),
    deps.assetJson(request, env, "/data/temporal-evidence-index.json"),
    workspaceClaims(db, principal.workspaceId, `activity:${activityId}`),
    db.prepare("SELECT * FROM dbi_intelligence_relations WHERE workspace_id = ? AND status = 'applied' AND (from_entity_id = ? OR to_entity_id = ?) ORDER BY applied_at DESC")
      .bind(principal.workspaceId, `activity:${activityId}`, `activity:${activityId}`).all(),
  ]);
  const connected = graphIndex.indices?.byActivity?.[activityId];
  if (!connected) return deps.error("activity_not_found", "Activity not found", 404);
  return deps.json({
    activityId,
    connected,
    contractLineage: lineageIndex.indices?.byActivity?.[activityId] || null,
    temporalEvidence: temporalIndex.indices?.byActivity?.[activityId] || null,
    workspaceOverlay: { claims, relations: (relations.results || []).map(relationFromRow) },
  });
}

async function locationsMetadataResponse(request, env, principal, segments, deps) {
  if (request.method !== "GET") return deps.error("method_not_allowed", "Method not allowed", 405);
  if (!deps.hasScope(principal, "evidence:read")) return deps.error("insufficient_scope", "Scope evidence:read is required", 403);
  const locationId = clean(decodeURIComponent(segments[0] || ""), 220).replace(/^location:/, "");
  if (!locationId || segments[1] !== "metadata") return deps.error("route_not_found", "Unknown location metadata route", 404);
  const metadata = await deps.assetJson(request, env, "/data/opportunity-map-location-metadata.json");
  const location = metadata.locations?.[locationId];
  if (!location) return deps.error("location_not_found", "Location metadata not found", 404);
  return deps.json({ locationId, metadata: location }, 200, { schemaVersion: metadata.metadata?.schemaVersion || null });
}

async function evidenceClaimsResponse(request, env, db, principal, segments, deps) {
  if (request.method !== "GET") return deps.error("method_not_allowed", "Method not allowed", 405);
  if (!deps.hasScope(principal, "evidence:read")) return deps.error("insufficient_scope", "Scope evidence:read is required", 403);
  if (segments[0] !== "claims") return deps.error("route_not_found", "Unknown evidence route", 404);
  const params = new URL(request.url).searchParams;
  const targetEntityId = clean(params.get("targetEntityId"), 220);
  const limit = deps.boundedInteger(params.get("limit"), 100, 1, 250);
  const shard = await entityShard(request, env, deps, "evidence-claim");
  const base = (shard?.entities || []).filter((claim) => !targetEntityId || claim.targetEntityId === targetEntityId);
  const workspace = targetEntityId
    ? await workspaceClaims(db, principal.workspaceId, targetEntityId)
    : await db.prepare("SELECT * FROM dbi_intelligence_claims WHERE workspace_id = ? ORDER BY applied_at DESC LIMIT ?").bind(principal.workspaceId, limit).all().then((result) => (result.results || []).map(claimFromRow));
  return deps.json([...workspace, ...base].slice(0, limit), 200, { total: workspace.length + base.length, limit, targetEntityId: targetEntityId || null });
}

async function sourcesResponse(request, env, db, principal, segments, deps) {
  if (request.method !== "GET") return deps.error("method_not_allowed", "Method not allowed", 405);
  if (!deps.hasScope(principal, "evidence:read")) return deps.error("insufficient_scope", "Scope evidence:read is required", 403);
  const sourceId = clean(decodeURIComponent(segments[0] || ""), 220);
  const workspaceRows = await db.prepare(`SELECT * FROM dbi_intelligence_sources WHERE workspace_id = ? ${sourceId ? "AND source_id = ?" : ""} ORDER BY updated_at DESC LIMIT 250`)
    .bind(...(sourceId ? [principal.workspaceId, sourceId] : [principal.workspaceId])).all();
  const workspace = (workspaceRows.results || []).map((row) => ({
    id: row.source_id, url: row.url, title: row.title, publisher: row.publisher, authority: row.authority,
    retrievedAt: row.retrieved_at, supports: row.supports_text, proposalId: row.proposal_id, workspaceOverlay: true,
  }));
  const shard = await entityShard(request, env, deps, "source");
  const base = sourceId ? (shard?.entities || []).filter((row) => row.id === sourceId) : [];
  if (sourceId && !workspace.length && !base.length) return deps.error("source_not_found", "Source not found", 404);
  if (sourceId) return deps.json(workspace[0] || base[0]);
  const params = new URL(request.url).searchParams;
  const query = clean(params.get("q"), 200).toLowerCase();
  const limit = deps.boundedInteger(params.get("limit"), 100, 1, 250);
  const matchingWorkspace = workspace.filter((row) => !query || `${row.title || ""} ${row.publisher || ""} ${row.url || ""}`.toLowerCase().includes(query));
  const published = (shard?.entities || []).filter((row) => !query || `${row.label || ""} ${row.publisher || ""} ${row.url || ""}`.toLowerCase().includes(query));
  return deps.json([...matchingWorkspace, ...published].slice(0, limit), 200, { total: matchingWorkspace.length + published.length, limit });
}

async function enrichmentResponse(request, env, db, principal, segments, deps) {
  if (segments[0] !== "proposals") return deps.error("route_not_found", "Unknown enrichment route", 404);
  const proposalId = clean(decodeURIComponent(segments[1] || ""), 100);
  if (request.method === "GET") {
    if (!deps.hasScope(principal, "review:read")) return deps.error("insufficient_scope", "Scope review:read is required", 403);
    if (proposalId) {
      const row = await db.prepare("SELECT * FROM dbi_intelligence_proposals WHERE workspace_id = ? AND id = ?").bind(principal.workspaceId, proposalId).first();
      if (!row) return deps.error("proposal_not_found", "Proposal not found", 404);
      return deps.json(proposalFromRow(row));
    }
    const params = new URL(request.url).searchParams;
    const status = clean(params.get("status"), 30);
    const limit = deps.boundedInteger(params.get("limit"), 100, 1, 250);
    if (status && !PROPOSAL_STATUSES.includes(status)) return deps.error("invalid_status", "Unsupported proposal status", 400);
    const result = await db.prepare(`SELECT * FROM dbi_intelligence_proposals WHERE workspace_id = ? ${status ? "AND status = ?" : ""} ORDER BY updated_at DESC LIMIT ?`)
      .bind(...(status ? [principal.workspaceId, status, limit] : [principal.workspaceId, limit])).all();
    return deps.json((result.results || []).map(proposalFromRow), 200, { total: result.results?.length || 0, limit, status: status || null });
  }
  if (request.method !== "POST" || proposalId) return deps.error("method_not_allowed", "Method not allowed", 405);
  if (!deps.hasScope(principal, "enrichment:propose")) return deps.error("insufficient_scope", "Scope enrichment:propose is required", 403);
  return deps.idempotent(db, principal, request, async () => {
    const body = await deps.safeJson(request);
    const normalized = normalizeProposal(body);
    if (normalized.errors.length) return deps.error("invalid_proposal", "Proposal failed strict validation", 400, undefined, { errors: normalized.errors.slice(0, 20) });
    const proposal = normalized.proposal;
    if (proposal.target.create) {
      const existing = await findEntity(request, env, db, principal, deps, proposal.target.entityId, proposal.target.entityType);
      if (existing) return deps.error("target_exists", "New proposal target already exists", 409);
    } else {
      const target = await findEntity(request, env, db, principal, deps, proposal.target.entityId, proposal.target.entityType);
      if (!target || target.type !== proposal.target.entityType) return deps.error("target_not_found", "Proposal target does not match a published or workspace entity", 404);
    }
    const summary = await deps.assetJson(request, env, "/data/intelligence-graph-summary.json");
    const allowedRelations = new Set(summary.domain?.relationTypes || []);
    const relationErrors = proposal.claims.filter((claim) => claim.operation === "add_relation" && !allowedRelations.has(claim.relation.type));
    if (relationErrors.length) return deps.error("invalid_relation_type", "Proposal contains a relation outside the published domain model", 400, undefined, { allowed: [...allowedRelations] });
    const relationEndpoints = unique(proposal.claims
      .filter((claim) => claim.operation === "add_relation")
      .flatMap((claim) => [claim.relation.fromEntityId, claim.relation.toEntityId]));
    const endpointChecks = await Promise.all(relationEndpoints.map(async (entityId) => {
      if (entityId === proposal.target.entityId && proposal.target.create) return true;
      return Boolean(await findEntity(request, env, db, principal, deps, entityId));
    }));
    const missingEndpoints = relationEndpoints.filter((_, index) => !endpointChecks[index]);
    if (missingEndpoints.length) return deps.error("relation_endpoint_not_found", "Every relation endpoint must resolve to a published or workspace entity", 404, undefined, { missingEntityIds: missingEndpoints });
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    await db.prepare(`INSERT INTO dbi_intelligence_proposals
      (id,workspace_id,target_entity_id,target_entity_type,status,title,summary,proposal_json,review_json,model,response_id,trace_id,version,created_by_type,created_by,created_at,updated_at)
      VALUES (?,?,?,?, 'needs_review', ?,?,?, '{}', ?,?,?, 1, ?,?,?,?)`)
      .bind(id, principal.workspaceId, proposal.target.entityId, proposal.target.entityType, proposal.title || `Enrich ${proposal.target.entityId}`, proposal.summary,
        JSON.stringify(proposal), proposal.model, proposal.responseId, proposal.traceId, principal.type, principal.actorId || principal.id, now, now).run();
    await deps.recordActivity(db, principal, "intelligence_proposal_submitted", "intelligence_proposal", id, { targetEntityId: proposal.target.entityId, claimCount: proposal.claims.length });
    const row = await db.prepare("SELECT * FROM dbi_intelligence_proposals WHERE id = ?").bind(id).first();
    return deps.json(proposalFromRow(row), 201);
  });
}

async function reviewsResponse(request, env, db, principal, segments, deps) {
  if (request.method === "GET") {
    if (!deps.hasScope(principal, "review:read")) return deps.error("insufficient_scope", "Scope review:read is required", 403);
    const proposalId = clean(decodeURIComponent(segments[0] || ""), 100);
    if (proposalId) {
      const row = await db.prepare("SELECT * FROM dbi_intelligence_proposals WHERE workspace_id = ? AND id = ?").bind(principal.workspaceId, proposalId).first();
      if (!row) return deps.error("proposal_not_found", "Review item not found", 404);
      return deps.json(proposalFromRow(row));
    }
    const params = new URL(request.url).searchParams;
    const queue = clean(params.get("queue"), 30);
    const limit = deps.boundedInteger(params.get("limit"), 100, 1, 250);
    const summary = await deps.assetJson(request, env, "/data/intelligence-graph-summary.json");
    if (["temporal", "identity", "lineage"].includes(queue)) {
      const path = queue === "temporal" ? "/data/temporal-evidence-review.json" : queue === "identity" ? "/data/organization-identity-review.json" : "/data/contract-lineage-review.json";
      const artifact = await deps.assetJson(request, env, path);
      const items = queue === "temporal" ? artifact.conflicts || [] : queue === "identity" ? artifact.conflicts || [] : [...(artifact.predecessorConflicts || []), ...(artifact.unresolvedFollowOnClaims || [])];
      return deps.json(items.slice(0, limit), 200, { queue, total: items.length, limit, summary: artifact.summary || null });
    }
    const proposals = await db.prepare("SELECT * FROM dbi_intelligence_proposals WHERE workspace_id = ? AND status = 'needs_review' ORDER BY updated_at DESC LIMIT ?")
      .bind(principal.workspaceId, limit).all();
    return deps.json((proposals.results || []).map(proposalFromRow), 200, {
      queue: "workspace", total: proposals.results?.length || 0, limit,
      publishedQueues: {
        temporal: summary.metadata?.coverage?.temporal?.totalConflicts || 0,
        identity: summary.metadata?.coverage?.organizations?.ambiguousNormalizedLabels || 0,
        lineage: summary.metadata?.coverage?.contracts?.unresolvedFollowOnClaims || 0,
      },
    });
  }
  if (request.method !== "PATCH" || !segments[0]) return deps.error("method_not_allowed", "Method not allowed", 405);
  if (!deps.hasScope(principal, "review:write")) return deps.error("insufficient_scope", "Scope review:write is required", 403);
  const proposalId = clean(decodeURIComponent(segments[0]), 100);
  const body = await deps.safeJson(request);
  if (!allowedKeys(body, ["decision", "note"])) return deps.error("invalid_review", "Review contains unsupported fields", 400);
  const decision = clean(body?.decision, 20);
  if (!["approved", "rejected"].includes(decision)) return deps.error("invalid_review", "Decision must be approved or rejected", 400);
  const expected = deps.expectedVersion(request, body);
  if (!Number.isInteger(expected)) return deps.error("precondition_required", "If-Match with the current proposal version is required", 428);
  const row = await db.prepare("SELECT * FROM dbi_intelligence_proposals WHERE workspace_id = ? AND id = ?").bind(principal.workspaceId, proposalId).first();
  if (!row) return deps.error("proposal_not_found", "Proposal not found", 404);
  if (Number(row.version) !== expected) return deps.error("version_conflict", "Proposal version is stale", 409, undefined, { currentVersion: Number(row.version) });
  if (row.status !== "needs_review") return deps.error("invalid_proposal_state", "Only review-pending proposals may be decided", 409);
  const now = new Date().toISOString();
  await db.prepare(`UPDATE dbi_intelligence_proposals SET status = ?, review_json = ?, reviewed_by_type = ?, reviewed_by = ?,
    reviewed_at = ?, updated_at = ?, version = version + 1 WHERE workspace_id = ? AND id = ? AND version = ?`)
    .bind(decision, JSON.stringify({ decision, note: clean(body.note, 2000) }), principal.type, principal.actorId || principal.id,
      now, now, principal.workspaceId, proposalId, expected).run();
  await deps.recordActivity(db, principal, `intelligence_proposal_${decision}`, "intelligence_proposal", proposalId, { note: clean(body.note, 500) });
  return deps.json(proposalFromRow(await db.prepare("SELECT * FROM dbi_intelligence_proposals WHERE id = ?").bind(proposalId).first()));
}

function validityForClaim(claim, now) {
  const effectiveFrom = claim.effectiveFrom;
  const effectiveTo = claim.effectiveTo;
  const nowMs = Date.parse(now);
  const status = effectiveFrom && Date.parse(effectiveFrom) > nowMs ? "future" : effectiveTo && Date.parse(effectiveTo) < nowMs ? "historical" : "current";
  return {
    observedAt: claim.observedAt,
    effectiveFrom,
    effectiveTo,
    supersededAt: null,
    reviewedAt: now,
    reviewBy: new Date(nowMs + 365 * 86_400_000).toISOString(),
    status,
    basis: "workspace-reviewed-enrichment",
  };
}

async function applyProposal(db, principal, proposalRow, jobId, deps) {
  const proposal = parseJson(proposalRow.proposal_json, {});
  const now = new Date().toISOString();
  const sourceMap = new Map();
  for (const source of proposal.claims.flatMap((claim) => claim.sources)) {
    if (!sourceMap.has(source.url)) sourceMap.set(source.url, { ...source, id: `workspace-source:${(await sha256(source.url)).slice(0, 24)}` });
  }
  const statements = [];
  for (const source of sourceMap.values()) statements.push(db.prepare(`INSERT INTO dbi_intelligence_sources
    (workspace_id,source_id,url,title,publisher,authority,retrieved_at,supports_text,proposal_id,created_by,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(workspace_id,url) DO UPDATE SET title=excluded.title,publisher=excluded.publisher,
    authority=excluded.authority,retrieved_at=excluded.retrieved_at,supports_text=excluded.supports_text,proposal_id=excluded.proposal_id,updated_at=excluded.updated_at`)
    .bind(principal.workspaceId, source.id, source.url, source.title, source.publisher, source.authority, source.retrievedAt, source.supports,
      proposalRow.id, principal.actorId || principal.id, now, now));
  if (proposal.target.create) statements.push(db.prepare(`INSERT INTO dbi_intelligence_entities
    (workspace_id,entity_id,entity_type,label,payload_json,status,version,proposal_id,created_by,created_at,updated_at)
    VALUES (?,?,?,?,?,'active',1,?,?,?,?)`)
    .bind(principal.workspaceId, proposal.target.entityId, proposal.target.entityType, proposal.target.label,
      JSON.stringify({ id: proposal.target.entityId, label: proposal.target.label }), proposalRow.id, principal.actorId || principal.id, now, now));
  let claimIndex = 0;
  let relationIndex = 0;
  for (const claim of proposal.claims) {
    const sourceIds = claim.sources.map((source) => sourceMap.get(source.url).id);
    const evidence = {
      proposalId: proposalRow.id,
      rationale: claim.rationale,
      sources: claim.sources,
      basis: "reviewed-agent-proposal",
      confidence: claim.confidence,
      reviewState: "applied",
    };
    const validity = validityForClaim(claim, now);
    if (claim.operation === "add_relation") {
      relationIndex += 1;
      statements.push(db.prepare(`INSERT INTO dbi_intelligence_relations
        (relation_id,workspace_id,proposal_id,relation_type,from_entity_id,to_entity_id,attributes_json,evidence_json,validity_json,status,version,created_by,created_at,applied_at)
        VALUES (?,?,?,?,?,?,?,?,?,'applied',1,?,?,?)`)
        .bind(`workspace-rel:${proposalRow.id}:${relationIndex}`, principal.workspaceId, proposalRow.id, claim.relation.type,
          claim.relation.fromEntityId, claim.relation.toEntityId, JSON.stringify(claim.relation.attributes || {}), JSON.stringify(evidence),
          JSON.stringify(validity), principal.actorId || principal.id, now, now));
      continue;
    }
    claimIndex += 1;
    const prior = await db.prepare(`SELECT claim_id FROM dbi_intelligence_claims WHERE workspace_id = ? AND target_entity_id = ?
      AND field_path = ? AND review_state = 'applied' ORDER BY applied_at DESC LIMIT 1`)
      .bind(principal.workspaceId, proposal.target.entityId, claim.fieldPath).first();
    if (prior?.claim_id) statements.push(db.prepare("UPDATE dbi_intelligence_claims SET review_state = 'superseded', superseded_at = ?, version = version + 1 WHERE claim_id = ?")
      .bind(now, prior.claim_id));
    statements.push(db.prepare(`INSERT INTO dbi_intelligence_claims
      (claim_id,workspace_id,proposal_id,target_entity_id,target_entity_type,field_path,operation,value_json,confidence,review_state,
        source_ids_json,evidence_json,validity_json,supersedes_claim_id,superseded_at,version,created_by,created_at,applied_at)
      VALUES (?,?,?,?,?,?,?,?,?,'applied',?,?,?,?,'',1,?,?,?)`)
      .bind(`workspace-claim:${proposalRow.id}:${claimIndex}`, principal.workspaceId, proposalRow.id, proposal.target.entityId,
        proposal.target.entityType, claim.fieldPath, claim.operation, JSON.stringify(claim.value), claim.confidence, JSON.stringify(sourceIds),
        JSON.stringify(evidence), JSON.stringify(validity), prior?.claim_id || "", principal.actorId || principal.id, now, now));
  }
  statements.push(db.prepare(`UPDATE dbi_intelligence_proposals SET status = 'applied', applied_at = ?, updated_at = ?, version = version + 1
    WHERE workspace_id = ? AND id = ? AND status = 'approved' AND version = ?`)
    .bind(now, now, principal.workspaceId, proposalRow.id, proposalRow.version));
  statements.push(db.prepare(`INSERT INTO dbi_intelligence_jobs
    (job_id,workspace_id,kind,proposal_id,status,output_json,error_code,error_message,created_by_type,created_by,created_at,updated_at,completed_at)
    VALUES (?,?, 'publish_proposal',?,'completed',?,'','',?,?,?,?,?)`)
    .bind(jobId, principal.workspaceId, proposalRow.id, JSON.stringify({ targetEntityId: proposal.target.entityId, claims: claimIndex, relations: relationIndex, sources: sourceMap.size }),
      principal.type, principal.actorId || principal.id, now, now, now));
  await db.batch(statements);
  await deps.recordActivity(db, principal, "intelligence_proposal_applied", "intelligence_proposal", proposalRow.id, { claimCount: claimIndex, relationCount: relationIndex, sourceCount: sourceMap.size });
  return { targetEntityId: proposal.target.entityId, claims: claimIndex, relations: relationIndex, sources: sourceMap.size };
}

async function jobsResponse(request, db, principal, segments, deps) {
  if (request.method === "GET") {
    if (!deps.hasScope(principal, "review:read")) return deps.error("insufficient_scope", "Scope review:read is required", 403);
    const jobId = clean(decodeURIComponent(segments[0] || ""), 100);
    const result = jobId
      ? await db.prepare("SELECT * FROM dbi_intelligence_jobs WHERE workspace_id = ? AND job_id = ?").bind(principal.workspaceId, jobId).all()
      : await db.prepare("SELECT * FROM dbi_intelligence_jobs WHERE workspace_id = ? ORDER BY created_at DESC LIMIT 100").bind(principal.workspaceId).all();
    const jobs = (result.results || []).map((row) => ({
      id: row.job_id, kind: row.kind, proposalId: row.proposal_id || null, status: row.status, output: parseJson(row.output_json, {}),
      error: row.error_code ? { code: row.error_code, message: row.error_message } : null, createdAt: row.created_at, completedAt: row.completed_at || null,
    }));
    if (jobId && !jobs.length) return deps.error("job_not_found", "Job not found", 404);
    return deps.json(jobId ? jobs[0] : jobs, 200, { total: jobs.length });
  }
  if (request.method !== "POST" || segments.length) return deps.error("method_not_allowed", "Method not allowed", 405);
  if (!deps.hasScope(principal, "graph:admin")) return deps.error("insufficient_scope", "Scope graph:admin is required", 403);
  return deps.idempotent(db, principal, request, async () => {
    const body = await deps.safeJson(request);
    if (!allowedKeys(body, ["kind", "proposalId", "version"])) return deps.error("invalid_job", "Job contains unsupported fields", 400);
    const kind = clean(body?.kind, 40);
    if (!["validate_proposal", "publish_proposal", "reindex_workspace"].includes(kind)) return deps.error("invalid_job", "Unsupported intelligence job kind", 400);
    const jobId = crypto.randomUUID();
    const now = new Date().toISOString();
    if (kind === "publish_proposal") {
      const proposalId = clean(body?.proposalId, 100);
      const proposal = await db.prepare("SELECT * FROM dbi_intelligence_proposals WHERE workspace_id = ? AND id = ?").bind(principal.workspaceId, proposalId).first();
      if (!proposal) return deps.error("proposal_not_found", "Proposal not found", 404);
      if (proposal.status !== "approved") return deps.error("invalid_proposal_state", "Only approved proposals can be published", 409);
      if (Number(body?.version) !== Number(proposal.version)) return deps.error("version_conflict", "Proposal version is stale", 409, undefined, { currentVersion: Number(proposal.version) });
      const output = await applyProposal(db, principal, proposal, jobId, deps);
      return deps.json({ id: jobId, kind, proposalId, status: "completed", output, completedAt: now }, 201);
    }
    let output;
    if (kind === "validate_proposal") {
      const proposalId = clean(body?.proposalId, 100);
      const proposal = await db.prepare("SELECT * FROM dbi_intelligence_proposals WHERE workspace_id = ? AND id = ?").bind(principal.workspaceId, proposalId).first();
      if (!proposal) return deps.error("proposal_not_found", "Proposal not found", 404);
      const normalized = normalizeProposal(parseJson(proposal.proposal_json, {}));
      output = { proposalId, valid: normalized.errors.length === 0, errors: normalized.errors };
    } else {
      const counts = await Promise.all([
        db.prepare("SELECT COUNT(*) AS count FROM dbi_intelligence_entities WHERE workspace_id = ? AND status = 'active'").bind(principal.workspaceId).first(),
        db.prepare("SELECT COUNT(*) AS count FROM dbi_intelligence_claims WHERE workspace_id = ? AND review_state = 'applied'").bind(principal.workspaceId).first(),
        db.prepare("SELECT COUNT(*) AS count FROM dbi_intelligence_relations WHERE workspace_id = ? AND status = 'applied'").bind(principal.workspaceId).first(),
      ]);
      output = { entities: Number(counts[0]?.count || 0), claims: Number(counts[1]?.count || 0), relations: Number(counts[2]?.count || 0), indexedAt: now };
    }
    await db.prepare(`INSERT INTO dbi_intelligence_jobs
      (job_id,workspace_id,kind,proposal_id,status,output_json,error_code,error_message,created_by_type,created_by,created_at,updated_at,completed_at)
      VALUES (?,?,?,?, 'completed',?,'','',?,?,?,?,?)`)
      .bind(jobId, principal.workspaceId, kind, clean(body?.proposalId, 100), JSON.stringify(output), principal.type, principal.actorId || principal.id, now, now, now).run();
    await deps.recordActivity(db, principal, `intelligence_job_${kind}`, "intelligence_job", jobId, output);
    return deps.json({ id: jobId, kind, proposalId: clean(body?.proposalId, 100) || null, status: "completed", output, completedAt: now }, 201);
  });
}

export async function agentIntelligenceResponse(request, env, db, principal, resource, segments, deps) {
  if (resource === "graph" && segments[0] === "summary") return graphSummaryResponse(request, env, db, principal, deps);
  if (resource === "entities") return entitiesResponse(request, env, db, principal, segments, deps);
  if (resource === "activities") return activitiesConnectedResponse(request, env, db, principal, segments, deps);
  if (resource === "locations") return locationsMetadataResponse(request, env, principal, segments, deps);
  if (resource === "evidence") return evidenceClaimsResponse(request, env, db, principal, segments, deps);
  if (resource === "sources") return sourcesResponse(request, env, db, principal, segments, deps);
  if (resource === "enrichment") return enrichmentResponse(request, env, db, principal, segments, deps);
  if (resource === "reviews") return reviewsResponse(request, env, db, principal, segments, deps);
  if (resource === "jobs") return jobsResponse(request, db, principal, segments, deps);
  return deps.error("route_not_found", "Unknown Agent API intelligence route", 404);
}

export const AGENT_INTELLIGENCE_RESOURCES = Object.freeze(["graph", "entities", "activities", "locations", "evidence", "sources", "enrichment", "reviews", "jobs"]);
export const AGENT_INTELLIGENCE_SCOPES = Object.freeze(["graph:read", "evidence:read", "enrichment:propose", "review:read", "review:write", "graph:admin"]);
export const AGENT_INTELLIGENCE_ENTITY_TYPES = ENTITY_TYPES;
