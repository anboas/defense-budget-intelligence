import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { INTELLIGENCE_ENTITY_TYPES, INTELLIGENCE_GRAPH_SCHEMA_VERSION, INTELLIGENCE_RELATION_TYPES } from "../src/intelligence-graph.js";
import { buildOrganizationIdentityRegistry, splitOfficeCodes } from "./organization-identity-resolver.mjs";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const DATA_DIR = resolve(ROOT, "public/data");
const OUT_FILE = resolve(DATA_DIR, "intelligence-graph.json");
const INDEX_FILE = resolve(DATA_DIR, "intelligence-graph-index.json");
const SUMMARY_FILE = resolve(DATA_DIR, "intelligence-graph-summary.json");
const ORGANIZATION_REVIEW_FILE = resolve(DATA_DIR, "organization-identity-review.json");
const read = (name) => JSON.parse(readFileSync(resolve(DATA_DIR, name), "utf8"));
const hash = (value) => createHash("sha256").update(String(value)).digest("hex").slice(0, 20);
const normalized = (value) => String(value || "").trim().toUpperCase().replace(/[^A-Z0-9]+/g, "");
const safeUrl = (value) => { try { const url = new URL(String(value || "")); return ["http:", "https:"].includes(url.protocol) ? url.href : ""; } catch { return ""; } };
const entityId = (type, value) => `${type}:${hash(value)}`;
const relationId = (type, from, to, discriminator = "") => `rel:${hash(`${type}|${from}|${to}|${discriminator}`)}`;

const core = read("budget-core.json");
const execution = read("budget-execution.json");
const agents = read("agent-records.json");
const calendar = read("capture-calendar.json");
const transactions = read("capture-transactions.json");
const accountSpine = read("account-spine.json");
const subawards = read("usaspending-subawards.json");
const map = read("opportunity-map-data.json");
const locationMetadata = read("opportunity-map-location-metadata.json");
const monitor = read("contract-monitor.json");
const discovery = read("procurement-discovery.json");
const organizationRegistry = buildOrganizationIdentityRegistry({ agents, transactions });
const transactionRecipientByActivity = new Map(Object.entries(transactions.byOpportunity || {}).map(([opportunityId, actions]) => {
  const identities = [...new Map((actions || []).filter((action) => action.uei && action.vendor).map((action) => [String(action.uei).trim().toUpperCase(), { uei: action.uei, label: action.vendor }])).values()];
  return [opportunityId, identities.length === 1 ? identities[0] : null];
}));

const entities = Object.fromEntries(INTELLIGENCE_ENTITY_TYPES.map((type) => [type, []]));
const entityKeys = Object.fromEntries(INTELLIGENCE_ENTITY_TYPES.map((type) => [type, new Set()]));
const relations = [];
const relationKeys = new Set();
const byActivity = {};
const organizationByKey = new Map();
const organizationIdentifierByKey = new Map();
const sourceByUrl = new Map();
const classificationByKey = new Map();

function addEntity(type, entity) {
  if (!entity?.id || entityKeys[type].has(entity.id)) return entity?.id;
  entityKeys[type].add(entity.id);
  entities[type].push(entity);
  return entity.id;
}

function addRelation(type, from, to, evidence, attributes = undefined) {
  if (!from || !to) return null;
  const id = relationId(type, from, to, `${evidence?.sourceArtifact || ""}|${evidence?.basis || ""}|${attributes?.role || ""}`);
  if (relationKeys.has(id)) return id;
  relationKeys.add(id);
  relations.push({ id, type, from, to, evidence, ...(attributes ? { attributes } : {}) });
  return id;
}

function organizationIdentifier(namespace, value, sourceArtifact) {
  const normalizedValue = String(value || "").trim().toUpperCase();
  if (!normalizedValue) return null;
  const key = `${namespace}:${normalizedValue}`;
  if (!organizationIdentifierByKey.has(key)) {
    const id = `org-identifier:${namespace}:${normalizedValue}`;
    organizationIdentifierByKey.set(key, id);
    addEntity("organization-identifier", { id, namespace, value: normalizedValue, label: `${namespace.toUpperCase()} ${normalizedValue}`, sourceArtifacts: [sourceArtifact] });
  } else {
    const entity = entities["organization-identifier"].find((item) => item.id === organizationIdentifierByKey.get(key));
    if (entity && !entity.sourceArtifacts.includes(sourceArtifact)) entity.sourceArtifacts.push(sourceArtifact);
  }
  return organizationIdentifierByKey.get(key);
}

function organization(label, sourceArtifact, identifiers = {}, options = {}) {
  const resolved = organizationRegistry.resolve({ label, uei: identifiers.uei, officeCode: identifiers.officeCode, identityClass: options.identityClass || "other" });
  if (!resolved.key || !resolved.canonicalLabel) return null;
  if (!organizationByKey.has(resolved.key)) {
    const id = entityId("org", resolved.key);
    organizationByKey.set(resolved.key, id);
    addEntity("organization", { id, label: resolved.canonicalLabel, aliases: [...resolved.aliases], identity: resolved.identity, sourceArtifacts: [sourceArtifact] });
  } else {
    const id = organizationByKey.get(resolved.key);
    const entity = entities.organization.find((item) => item.id === id);
    if (entity && !entity.sourceArtifacts.includes(sourceArtifact)) entity.sourceArtifacts.push(sourceArtifact);
    for (const alias of [String(label || "").trim(), ...resolved.aliases]) if (entity && alias && alias !== entity.label && !entity.aliases.includes(alias)) entity.aliases.push(alias);
    const stateRank = { label_only: 0, needs_review: 1, derived: 2, resolved: 3 };
    if (entity && (stateRank[resolved.identity.resolutionState] || 0) > (stateRank[entity.identity.resolutionState] || 0)) entity.identity = resolved.identity;
  }
  const id = organizationByKey.get(resolved.key);
  for (const [namespace, value] of Object.entries(resolved.identity.identifiers || {})) {
    const identifierId = organizationIdentifier(namespace, value, sourceArtifact);
    addRelation("organization-has-identifier", id, identifierId, evidence("organization-identity-registry", resolved.identity.method, identifiers[namespace] ? "exact" : "derived", "", identifiers[namespace] ? "verified" : "deterministic"), { namespace });
  }
  return id;
}

function source(url, sourceArtifact, label = "Public source") {
  const canonical = safeUrl(url);
  if (!canonical) return null;
  if (!sourceByUrl.has(canonical)) {
    const id = entityId("source", canonical);
    sourceByUrl.set(canonical, id);
    const parsed = new URL(canonical);
    addEntity("source", { id, label, url: canonical, publisher: parsed.hostname, sourceArtifacts: [sourceArtifact] });
  } else {
    const entity = entities.source.find((item) => item.id === sourceByUrl.get(canonical));
    if (entity && !entity.sourceArtifacts.includes(sourceArtifact)) entity.sourceArtifacts.push(sourceArtifact);
  }
  return sourceByUrl.get(canonical);
}

function classification(namespace, code, label, sourceArtifact) {
  if (!code) return null;
  const key = `${namespace}:${String(code).trim().toLowerCase()}`;
  if (!classificationByKey.has(key)) {
    const id = `class:${key}`;
    classificationByKey.set(key, id);
    addEntity("classification", { id, namespace, code: String(code), label: label || String(code), sourceArtifacts: [sourceArtifact] });
  } else {
    const entity = entities.classification.find((item) => item.id === classificationByKey.get(key));
    if (entity && !entity.sourceArtifacts.includes(sourceArtifact)) entity.sourceArtifacts.push(sourceArtifact);
  }
  return classificationByKey.get(key);
}

function evidence(sourceArtifact, basis, confidence = "exact", sourceUrl = "", reviewState = "verified") {
  return { sourceArtifact, basis, confidence, reviewState, ...(sourceUrl ? { sourceUrl } : {}) };
}

for (const location of map.locations || []) {
  const id = `location:${location.id}`;
  addEntity("location", { id, sourceId: location.id, label: location.name, city: location.city, state: location.state, kind: location.kind, branch: location.branch, coordinates: [location.longitude, location.latitude], sourceArtifact: "opportunity-map-data" });
  const profile = locationMetadata.locations?.[location.id];
  const sourceId = source(profile?.evidence?.primarySource?.url || location.sourceUrl, "opportunity-map-location-metadata", profile?.evidence?.primarySource?.title || location.sourceDataset || "Location source");
  if (sourceId) addRelation("supported-by-source", id, sourceId, evidence("opportunity-map-location-metadata", "primary-source-url", "reviewed", profile?.evidence?.primarySource?.url || location.sourceUrl, profile?.passes?.identity?.state || "source_snapshot"));
  const reviewedOrganizations = profile?.identity?.organizations || [];
  for (const item of reviewedOrganizations) {
    if (!item?.name || /installation record/i.test(item.name)) continue;
    const organizationId = organization(item.name, "opportunity-map-location-metadata", {}, { identityClass: "government" });
    addRelation("organization-located-at", organizationId, id, evidence("opportunity-map-location-metadata", "source-declared-location", "reviewed", item.url || profile?.evidence?.primarySource?.url, profile?.passes?.identity?.state || "reviewed"));
  }
  if (profile?.acquisition?.buyerName) {
    const organizationId = organization(profile.acquisition.buyerName, "opportunity-map-location-metadata", {}, { identityClass: "government" });
    addRelation("organization-located-at", organizationId, id, evidence("opportunity-map-location-metadata", "reviewed-buyer-location", "reviewed", profile?.evidence?.primarySource?.url, profile?.passes?.acquisition?.state || "reviewed"), { role: profile.acquisition.status || "buyer" });
  }
  const officeLabel = profile?.acquisition?.contractingOffice?.name || profile?.acquisition?.buyerName || `${location.name} contracting office`;
  for (const officeCode of splitOfficeCodes([...(location.officeCodes || []), profile?.acquisition?.contractingOffice?.code])) {
    const organizationId = organization(officeLabel, "opportunity-map-location-metadata", { officeCode }, { identityClass: "government-office" });
    addRelation("organization-operates-at-location", organizationId, id, evidence("opportunity-map-location-metadata", "reviewed-office-code-location", "reviewed", profile?.evidence?.primarySource?.url || location.sourceUrl, profile?.passes?.acquisition?.state || "reviewed"), { role: profile?.acquisition?.status || location.buyerRole || "contracting-office" });
  }
}

const awardByGeneratedId = new Map();
const awardByPiid = new Map();
for (const award of execution.awardDrilldown?.awards || []) {
  const id = `award:${award.id}`;
  awardByGeneratedId.set(award.id, id);
  awardByPiid.set(normalized(award.awardId), id);
  addEntity("award", { id, generatedAwardId: award.id, piid: award.awardId, label: award.description || award.awardId, recipient: award.recipient, obligatedAmount: Number(award.awardAmountDollars || 0), startDate: award.startDate, endDate: award.endDate, sourceArtifact: "budget-execution" });
  const recipientId = organization(award.recipient, "budget-execution", {}, { identityClass: "recipient" });
  addRelation("award-recipient", id, recipientId, evidence("budget-execution", "published-recipient", "exact"));
  for (const [type, labelValue, role] of [["award-awarding-organization", award.awardingOffice || award.awardingSubAgency, "awarding"], ["award-funding-organization", award.fundingOffice || award.fundingSubAgency || award.buyerSubAgency, "funding"]]) {
    const organizationId = organization(labelValue, "budget-execution", {}, { identityClass: "government" });
    addRelation(type, id, organizationId, evidence("budget-execution", "published-organization-label", "source_declared"), { role });
  }
  for (const area of award.areaIds || (award.areaId ? [award.areaId] : [])) addRelation("entity-classified-as", id, classification("technology-area", area, (award.areas || []).find((label) => normalized(label) === normalized(award.area)) || award.area, "budget-execution"), evidence("budget-execution", "published-technology-area", "deterministic"));
  addRelation("entity-classified-as", id, classification("naics", award.naicsCode, award.naicsDescription, "budget-execution"), evidence("budget-execution", "published-naics", "exact"));
  addRelation("entity-classified-as", id, classification("psc", award.pscCode, award.pscDescription, "budget-execution"), evidence("budget-execution", "published-psc", "exact"));
  const sourceId = source(award.id ? `https://www.usaspending.gov/award/${award.id}/` : "", "budget-execution", `USAspending award ${award.awardId}`);
  if (sourceId) addRelation("supported-by-source", id, sourceId, evidence("budget-execution", "generated-award-url", "exact", entities.source.find((item) => item.id === sourceId)?.url));
}

const discoveryIds = new Set((discovery.discovery || []).map((item) => item.opportunityId));
const monitorIds = new Set((monitor.records || []).map((item) => item.opportunityId));
const calendarById = new Map((calendar.records || []).map((item) => [item.opportunityId, item]));
const mapById = new Map((map.records || []).map((item) => [item.opportunityId, item]));

for (const record of agents.records || []) {
  const id = `activity:${record.opportunityId}`;
  addEntity("activity", { id, opportunityId: record.opportunityId, displayId: record.id, reference: record.reference, label: record.title, mode: record.mode, lifecycle: record.lifecycleStatus, sourceSystem: record.sourceSystem, sourceArtifact: "agent-records" });
  const connection = byActivity[record.opportunityId] = { activityId: record.opportunityId, entityId: id, awardIds: [], eventIds: [], transactionIds: [], organizationIds: [], locationIds: [], accountIds: [], subawardSummaryIds: [], classificationIds: [], sourceIds: [], surfaces: ["spend-explorer", "opportunity-map", "procurement-discovery"], relationIds: [] };
  if (calendarById.has(record.opportunityId)) connection.surfaces.push("capture-calendar");
  if (monitorIds.has(record.opportunityId)) connection.surfaces.push("contract-monitor");
  if (!discoveryIds.has(record.opportunityId)) throw new Error(`Activity ${record.opportunityId} is missing from procurement discovery`);
  const observedAwardId = record.automationCoverage?.observation?.generatedAwardId || record.liveAward?.id || record.liveAward?.generatedAwardId;
  const awardEntityId = awardByGeneratedId.get(observedAwardId) || awardByPiid.get(normalized(record.reference));
  if (awardEntityId) {
    connection.awardIds.push(awardEntityId);
    const relation = addRelation("activity-awarded-as", id, awardEntityId, evidence("agent-records", observedAwardId ? "exact-generated-award-id" : "exact-piid", "exact", record.automationCoverage?.observation?.sourceUrl || record.sourceUrls?.[0]));
    if (relation) connection.relationIds.push(relation);
  }
  const organizationPath = (record.organization?.path || []).filter((labelValue) => labelValue && !/not published/i.test(labelValue));
  const organizationPathIds = organizationPath.map((labelValue) => organization(labelValue, "agent-records", {}, { identityClass: "government" })).filter(Boolean);
  for (let index = 1; index < organizationPathIds.length; index += 1) {
    addRelation("organization-part-of", organizationPathIds[index], organizationPathIds[index - 1], evidence("agent-records", "source-declared-organization-path", "source_declared", record.sourceUrls?.[0]), { depth: index });
  }
  const transactionRecipient = transactionRecipientByActivity.get(record.opportunityId);
  for (const [type, labelValue, role, identifiers, identityClass] of [
    ["activity-recipient", record.party || record.recipient || transactionRecipient?.label, "recipient", { uei: record.automationCoverage?.observation?.recipientUei || transactionRecipient?.uei }, "recipient"],
    ["activity-contracting-organization", record.automationCoverage?.observation?.awardingOffice || record.contractingOffice || record.owner, "contracting", {}, "government"],
    ["activity-funding-organization", record.automationCoverage?.observation?.fundingOffice || record.fundingOffice || record.owner, "funding", {}, "government"],
  ]) {
    const organizationId = organization(labelValue, "agent-records", identifiers, { identityClass });
    if (!organizationId) continue;
    connection.organizationIds.push(organizationId);
    const relation = addRelation(type, id, organizationId, evidence("agent-records", "published-role-label", identifiers.uei ? "exact-identifier" : "source_declared", record.automationCoverage?.observation?.sourceUrl || record.sourceUrls?.[0]), { role });
    if (relation) connection.relationIds.push(relation);
  }
  for (const term of record.technologyAreas || []) connection.classificationIds.push(classification("technology-area", term, record.technologyAreaLabels?.[(record.technologyAreas || []).indexOf(term)] || term, "agent-records"));
  if (record.workCategory) connection.classificationIds.push(classification("work-category", record.workCategory, record.workCategory, "agent-records"));
  for (const classificationId of [...new Set(connection.classificationIds.filter(Boolean))]) {
    const relation = addRelation("entity-classified-as", id, classificationId, evidence("agent-records", "deterministic-classification", "deterministic"));
    if (relation) connection.relationIds.push(relation);
  }
  for (const url of record.sourceUrls || []) {
    const sourceId = source(url, "agent-records", "Activity source");
    if (!sourceId) continue;
    connection.sourceIds.push(sourceId);
    const relation = addRelation("supported-by-source", id, sourceId, evidence("agent-records", "published-source-url", "exact", url));
    if (relation) connection.relationIds.push(relation);
  }
  for (const relationRecord of mapById.get(record.opportunityId)?.relations || []) {
    const locationId = `location:${relationRecord.locationId}`;
    connection.locationIds.push(locationId);
    const relation = addRelation(relationRecord.type, id, locationId, evidence("opportunity-map-data", relationRecord.evidenceBasis, relationRecord.evidenceBasis === "exact-award-detail" ? "exact" : "reviewed"));
    if (relation) connection.relationIds.push(relation);
  }
}

for (const record of calendar.records || []) {
  const activityId = `activity:${record.opportunityId}`;
  const connection = byActivity[record.opportunityId];
  for (const item of record.events || []) {
    const id = `event:${item.eventId}`;
    addEntity("event", { id, eventId: item.eventId, label: item.label, kind: item.kind, start: item.start, end: item.end, precision: item.precision, status: item.status, sourceArtifact: "capture-calendar" });
    connection?.eventIds.push(id);
    const relation = addRelation("activity-has-event", activityId, id, evidence("capture-calendar", "stable-opportunity-id", "exact", item.sourceUrl));
    if (relation) connection?.relationIds.push(relation);
    const sourceId = source(item.sourceUrl, "capture-calendar", `${item.label} source`);
    if (sourceId) addRelation("supported-by-source", id, sourceId, evidence("capture-calendar", "event-source-url", "exact", item.sourceUrl));
  }
}

for (const [opportunityId, actions] of Object.entries(transactions.byOpportunity || {})) {
  const activityId = `activity:${opportunityId}`;
  const connection = byActivity[opportunityId];
  for (const action of actions || []) {
    const id = `transaction:${action.actionId}`;
    addEntity("transaction", { id, actionId: action.actionId, piid: action.piid, label: action.description || `${action.piid} ${action.modification}`, signed: action.signed, obligationDelta: Number(action.obligationDelta || 0), direction: action.direction, sourceArtifact: "capture-transactions" });
    connection?.transactionIds.push(id);
    const relation = addRelation("activity-has-transaction", activityId, id, evidence("capture-transactions", "stable-opportunity-group", "exact"));
    if (relation) connection?.relationIds.push(relation);
    const recipientId = organization(action.vendor, "capture-transactions", { uei: action.uei }, { identityClass: "recipient" });
    if (recipientId) {
      addRelation("transaction-recipient", id, recipientId, evidence("capture-transactions", action.uei ? "published-uei" : "published-vendor-label", action.uei ? "exact" : "source_declared"), { role: "recipient" });
    }
  }
}

const accountByTitle = new Map();
const accountByCode = new Map();
for (const account of accountSpine.accounts || []) {
  const id = `account:${account.federalAccountCode}`;
  accountByTitle.set(normalized(account.title), id);
  accountByCode.set(account.federalAccountCode, id);
  addEntity("federal-account", { id, federalAccountCode: account.federalAccountCode, label: account.title, bureauName: account.bureauName, obligatedAmount: Number(account.obligatedAmount || 0), sourceArtifact: "account-spine" });
  const sourceId = source(account.sourceUrl, "account-spine", `Federal account ${account.federalAccountCode}`);
  if (sourceId) addRelation("supported-by-source", id, sourceId, evidence("account-spine", "official-account-url", "exact", account.sourceUrl));
}

for (const flow of accountSpine.awardFlows || []) {
  const awardId = awardByGeneratedId.get(flow.awardId);
  if (!awardId) continue;
  for (const item of flow.accounts || []) {
    const accountId = accountByCode.get(item.federalAccountCode);
    if (!accountId) continue;
    addRelation("award-funded-by-account", awardId, accountId, evidence("account-spine", "exact-usa-spending-account-flow", "exact", flow.sourceUrl), { obligatedAmount: Number(item.obligatedAmount || 0), relationshipClass: item.relationshipClass || "exact" });
  }
}

for (const prime of subawards.primes || []) {
  const awardId = awardByGeneratedId.get(prime.primeAwardId) || awardByPiid.get(normalized(prime.primePiid));
  if (!awardId) continue;
  const id = `subaward-summary:${prime.primeAwardId}`;
  addEntity("subaward-summary", { id, primeAwardId: prime.primeAwardId, primePiid: prime.primePiid, label: `${prime.reportedCount || 0} reported subawards`, reportedCount: Number(prime.reportedCount || 0), sampledAmount: Number(prime.sampledAmount || 0), detailStatus: prime.detailStatus, sourceArtifact: "usaspending-subawards" });
  addRelation("award-has-subaward-summary", awardId, id, evidence("usaspending-subawards", "exact-generated-prime-award-id", "exact"));
}

for (const line of core.records || []) {
  const id = `budget-line:${line.id}`;
  addEntity("budget-line", { id, sourceId: line.id, label: line.lineTitle || line.accountTitle, bookId: line.bookId, accountTitle: line.accountTitle, organization: line.orgName, fiscalValues: { fy2025: line.fy2025, fy2026: line.fy2026, fy2027: line.fy2027 }, sourceArtifact: "budget-core" });
  const accountId = accountByTitle.get(normalized(line.accountTitle || line.account));
  if (accountId) addRelation("budget-line-matches-account-title", id, accountId, evidence("budget-core", "exact-normalized-account-title", "derived", "", "deterministic"));
  const organizationId = organization(line.orgName, "budget-core", {}, { identityClass: "government" });
  addRelation("budget-line-owned-by-organization", id, organizationId, evidence("budget-core", "published-budget-organization", "source_declared"));
  for (const term of line.technologyAreas || []) addRelation("entity-classified-as", id, classification("technology-area", term, term, "budget-core"), evidence("budget-core", "deterministic-technology-area", "deterministic"));
  for (const signal of line.signals || []) addRelation("entity-classified-as", id, classification("budget-signal", signal, signal, "budget-core"), evidence("budget-core", "deterministic-budget-signal", "deterministic"));
}

for (const connection of Object.values(byActivity)) {
  const awardAccountIds = connection.awardIds.flatMap((awardId) => relations.filter((relation) => relation.type === "award-funded-by-account" && relation.from === awardId).map((relation) => relation.to));
  const subawardIds = connection.awardIds.flatMap((awardId) => relations.filter((relation) => relation.type === "award-has-subaward-summary" && relation.from === awardId).map((relation) => relation.to));
  connection.accountIds = [...new Set(awardAccountIds)];
  connection.subawardSummaryIds = [...new Set(subawardIds)];
  connection.organizationIds = [...new Set(connection.organizationIds)];
  connection.locationIds = [...new Set(connection.locationIds)];
  connection.classificationIds = [...new Set(connection.classificationIds.filter(Boolean))];
  connection.sourceIds = [...new Set(connection.sourceIds)];
  connection.relationIds = [...new Set(connection.relationIds)];
  connection.surfaces = [...new Set(connection.surfaces)];
  connection.counts = {
    awards: connection.awardIds.length,
    events: connection.eventIds.length,
    transactions: connection.transactionIds.length,
    organizations: connection.organizationIds.length,
    locations: connection.locationIds.length,
    federalAccounts: connection.accountIds.length,
    subawardSummaries: connection.subawardSummaryIds.length,
    classifications: connection.classificationIds.length,
    sources: connection.sourceIds.length,
  };
}

for (const item of entities.organization) item.aliases.sort((left, right) => left.localeCompare(right));
const organizationCoverage = {
  total: entities.organization.length,
  canonicalUeiIdentities: entities.organization.filter((item) => item.identity?.identifiers?.uei).length,
  publishedUeiIdentities: entities.organization.filter((item) => item.identity?.method === "published-uei").length,
  reviewedOfficeCodeIdentities: entities.organization.filter((item) => item.identity?.identifiers?.officeCode).length,
  cageIdentities: entities.organization.filter((item) => item.identity?.identifiers?.cage).length,
  labelOnlyIdentities: entities.organization.filter((item) => item.identity?.resolutionState === "label_only").length,
  needsReviewIdentities: entities.organization.filter((item) => item.identity?.resolutionState === "needs_review").length,
  aliases: entities.organization.reduce((total, item) => total + item.aliases.length, 0),
  resolvedAliasGroups: organizationRegistry.aliasResolutions.length,
  ambiguousNormalizedLabels: organizationRegistry.conflicts.length,
  hierarchyRelations: relations.filter((item) => item.type === "organization-part-of").length,
  officeLocationRelations: relations.filter((item) => item.type === "organization-operates-at-location").length,
  transactionRecipientRelations: relations.filter((item) => item.type === "transaction-recipient").length,
};

const graph = {
  metadata: {
    schemaVersion: INTELLIGENCE_GRAPH_SCHEMA_VERSION,
    generatedAt: agents.metadata?.generatedAt || new Date().toISOString(),
    asOf: agents.metadata?.asOf || calendar.metadata?.asOf,
    title: "Defense Intelligence cross-surface evidence graph",
    authorityBoundary: "Deterministic public-source joins only. Exact IDs and source-declared relationships are authoritative; normalized-label and account-title joins are explicitly derived and never presented as universal federal crosswalks.",
    entityCounts: Object.fromEntries(Object.entries(entities).map(([type, rows]) => [type, rows.length])),
    relationCounts: Object.fromEntries(INTELLIGENCE_RELATION_TYPES.map((type) => [type, relations.filter((relation) => relation.type === type).length])),
    coverage: {
      activities: { total: entities.activity.length, discovery: discoveryIds.size, map: map.records?.length || 0, monitor: monitorIds.size, calendar: calendar.records?.length || 0, awardLinked: Object.values(byActivity).filter((item) => item.awardIds.length).length },
      awards: { total: entities.award.length, accountLinked: new Set(relations.filter((item) => item.type === "award-funded-by-account").map((item) => item.from)).size, subawardLinked: new Set(relations.filter((item) => item.type === "award-has-subaward-summary").map((item) => item.from)).size },
      budget: { lines: entities["budget-line"].length, exactAccountTitleLinks: relations.filter((item) => item.type === "budget-line-matches-account-title").length, unresolvedAccountTitleLinks: entities["budget-line"].length - relations.filter((item) => item.type === "budget-line-matches-account-title").length },
      geography: { locations: entities.location.length, activityLocationRelations: relations.filter((item) => ["contracting-activity-at", "funding-activity-at"].includes(item.type)).length },
      organizations: organizationCoverage,
    },
  },
  domain: {
    entityTypes: INTELLIGENCE_ENTITY_TYPES,
    relationTypes: INTELLIGENCE_RELATION_TYPES,
    identityRules: {
      activity: "Stable opportunityId across procurement discovery, map, timeline, analytics, tracking, and agent records.",
      award: "USAspending generated award ID; PIID is retained as an alias.",
      organization: "Published UEI for recipients and reviewed office code for contracting offices take precedence. Unique normalized-label joins to a published UEI remain derived; ambiguous labels remain separate and queued for review. No fuzzy entity merge.",
      organizationIdentifier: "Typed public identifier entity. UEI and reviewed office-code claims retain their source artifact and join basis; CAGE remains empty until published evidence enters the corpus.",
      location: "Stable reviewed location ID from the authoritative map snapshot.",
      federalAccount: "Federal account code from USAspending account spine.",
      source: "Canonical HTTP(S) URL.",
    },
    evidenceRules: {
      exact: "Stable source identifier or exact public relationship.",
      reviewed: "Human-reviewed source relationship from the installation/location evidence layer.",
      source_declared: "Role or label explicitly published by the source artifact.",
      deterministic: "Repeatable classification or projection from retained source fields.",
      derived: "Useful deterministic join that remains labeled non-authoritative, such as an exact normalized account-title match.",
    },
    organizationIdentityPolicy: {
      precedence: ["published UEI", "reviewed contracting-office code", "unique normalized label to a single published UEI", "role-scoped normalized label"],
      conflictRule: "A normalized label published with multiple UEIs never merges those legal entities; it remains a review queue item.",
      aliasRule: "Multiple public labels sharing one exact UEI are retained as aliases of the UEI-canonical entity.",
      hierarchyRule: "Parent-child edges come only from retained source-declared acquisition paths and remain source-declared rather than legal-corporate claims.",
    },
  },
  entities,
  relations,
  indices: { byActivity },
};

mkdirSync(DATA_DIR, { recursive: true });
writeFileSync(OUT_FILE, JSON.stringify(graph));
const organizationReview = {
  metadata: {
    schemaVersion: "1.0.0",
    graphSchemaVersion: INTELLIGENCE_GRAPH_SCHEMA_VERSION,
    generatedAt: graph.metadata.generatedAt,
    title: "Organization identity resolution and conflict review",
    trustBoundary: "Exact published UEIs and reviewed office codes resolve identity. Unique normalized-label matches remain derived. Ambiguous labels are never auto-merged.",
  },
  summary: organizationCoverage,
  resolvedAliases: organizationRegistry.aliasResolutions,
  conflicts: organizationRegistry.conflicts,
};
writeFileSync(ORGANIZATION_REVIEW_FILE, JSON.stringify(organizationReview));
const lookup = Object.fromEntries(Object.entries(entities).map(([type, rows]) => [type, new Map(rows.map((row) => [row.id, row]))]));
const compact = (type, id) => {
  const entity = lookup[type]?.get(id);
  if (!entity) return null;
  if (type === "award") return { id, piid: entity.piid, label: entity.label, obligatedAmount: entity.obligatedAmount };
  if (type === "organization") return { id, label: entity.label, aliases: entity.aliases, identity: entity.identity };
  if (type === "location") return { id, sourceId: entity.sourceId, label: entity.label, city: entity.city, state: entity.state };
  if (type === "federal-account") return { id, federalAccountCode: entity.federalAccountCode, label: entity.label };
  if (type === "subaward-summary") return { id, label: entity.label, reportedCount: entity.reportedCount, detailStatus: entity.detailStatus };
  if (type === "classification") return { id, namespace: entity.namespace, code: entity.code, label: entity.label };
  if (type === "source") return { id, label: entity.label, url: entity.url, publisher: entity.publisher };
  return { id, label: entity.label };
};
const activityIndex = Object.fromEntries(Object.entries(byActivity).map(([id, connection]) => {
  const relatedRelations = connection.relationIds.map((relationIdValue) => relations.find((relation) => relation.id === relationIdValue)).filter(Boolean);
  const evidenceSummary = [...relatedRelations.reduce((groups, relation) => {
    const key = `${relation.type}|${relation.evidence.basis}|${relation.evidence.confidence}|${relation.evidence.sourceArtifact}`;
    const current = groups.get(key) || { type: relation.type, basis: relation.evidence.basis, confidence: relation.evidence.confidence, sourceArtifact: relation.evidence.sourceArtifact, count: 0 };
    current.count += 1;
    groups.set(key, current);
    return groups;
  }, new Map()).values()];
  const deferredConnection = { ...connection };
  delete deferredConnection.eventIds;
  delete deferredConnection.transactionIds;
  delete deferredConnection.relationIds;
  delete deferredConnection.sourceIds;
  return [id, {
    ...deferredConnection,
    connected: {
      awards: connection.awardIds.map((entityIdValue) => compact("award", entityIdValue)).filter(Boolean),
      organizations: connection.organizationIds.map((entityIdValue) => compact("organization", entityIdValue)).filter(Boolean),
      locations: connection.locationIds.map((entityIdValue) => compact("location", entityIdValue)).filter(Boolean),
      federalAccounts: connection.accountIds.map((entityIdValue) => compact("federal-account", entityIdValue)).filter(Boolean),
      subawardSummaries: connection.subawardSummaryIds.map((entityIdValue) => compact("subaward-summary", entityIdValue)).filter(Boolean),
      classifications: connection.classificationIds.map((entityIdValue) => compact("classification", entityIdValue)).filter(Boolean),
      sources: connection.sourceIds.map((entityIdValue) => compact("source", entityIdValue)).filter(Boolean),
    },
    evidenceSummary,
  }];
}));
const graphIndex = { metadata: graph.metadata, domain: graph.domain, indices: { byActivity: activityIndex } };
writeFileSync(INDEX_FILE, JSON.stringify(graphIndex));
const graphSummary = {
  metadata: graph.metadata,
  domain: graph.domain,
  totals: {
    entities: Object.values(graph.metadata.entityCounts).reduce((total, count) => total + count, 0),
    relations: graph.relations.length,
  },
};
writeFileSync(SUMMARY_FILE, JSON.stringify(graphSummary));
console.log(JSON.stringify({ output: OUT_FILE, bytes: readFileSync(OUT_FILE).byteLength, index: INDEX_FILE, indexBytes: readFileSync(INDEX_FILE).byteLength, summary: SUMMARY_FILE, summaryBytes: readFileSync(SUMMARY_FILE).byteLength, organizationReview: ORGANIZATION_REVIEW_FILE, organizationReviewBytes: readFileSync(ORGANIZATION_REVIEW_FILE).byteLength, metadata: graph.metadata }, null, 2));
