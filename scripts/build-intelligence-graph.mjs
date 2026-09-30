import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { INTELLIGENCE_ENTITY_TYPES, INTELLIGENCE_GRAPH_SCHEMA_VERSION, INTELLIGENCE_RELATION_TYPES } from "../src/intelligence-graph.js";
import { buildContractLineageRegistry, CONTRACT_LINEAGE_SCHEMA_VERSION } from "./contract-lineage-resolver.mjs";
import { buildOrganizationIdentityRegistry, splitOfficeCodes } from "./organization-identity-resolver.mjs";
import { buildTemporalEvidenceRegistry } from "./temporal-evidence-resolver.mjs";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const DATA_DIR = resolve(ROOT, "public/data");
const OUT_FILE = resolve(DATA_DIR, "intelligence-graph.json");
const OUT_GZIP_FILE = resolve(DATA_DIR, "intelligence-graph.json.gz");
const INDEX_FILE = resolve(DATA_DIR, "intelligence-graph-index.json");
const SUMMARY_FILE = resolve(DATA_DIR, "intelligence-graph-summary.json");
const ORGANIZATION_REVIEW_FILE = resolve(DATA_DIR, "organization-identity-review.json");
const CONTRACT_LINEAGE_INDEX_FILE = resolve(DATA_DIR, "contract-lineage-index.json");
const CONTRACT_LINEAGE_REVIEW_FILE = resolve(DATA_DIR, "contract-lineage-review.json");
const TEMPORAL_EVIDENCE_INDEX_FILE = resolve(DATA_DIR, "temporal-evidence-index.json");
const TEMPORAL_EVIDENCE_REVIEW_FILE = resolve(DATA_DIR, "temporal-evidence-review.json");
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
const contractLineageRegistry = buildContractLineageRegistry({
  activities: agents.records || [],
  monitorRecords: monitor.records || [],
  awards: execution.awardDrilldown?.awards || [],
  asOf: execution.coverage?.endDate || agents.metadata?.asOf,
});
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
const contractVehicleByKey = new Map();
const acquisitionPathByKey = new Map();

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

function contractVehicle(item) {
  if (!item?.generatedAwardId || !item?.piid) return null;
  if (!contractVehicleByKey.has(item.generatedAwardId)) {
    const id = entityId("contract-vehicle", item.generatedAwardId);
    contractVehicleByKey.set(item.generatedAwardId, id);
    addEntity("contract-vehicle", {
      id,
      generatedAwardId: item.generatedAwardId,
      piid: item.piid,
      label: item.label || item.piid,
      kind: "idv",
      orderCount: item.activityIds?.length || 0,
      sourceArtifacts: ["contract-monitor"],
    });
  }
  return contractVehicleByKey.get(item.generatedAwardId);
}

function acquisitionPath(item) {
  if (!item?.key || !item?.label) return null;
  if (!acquisitionPathByKey.has(item.key)) {
    const id = entityId("acquisition-path", item.key);
    acquisitionPathByKey.set(item.key, id);
    addEntity("acquisition-path", {
      id,
      key: item.key,
      label: item.label,
      kind: "source-declared-path",
      activityCount: item.activityIds?.length || 0,
      sourceArtifacts: ["agent-records"],
    });
  }
  return acquisitionPathByKey.get(item.key);
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

for (const item of contractLineageRegistry.exactVehicles) {
  const vehicleId = contractVehicle(item);
  for (const url of item.sourceUrls || []) {
    const sourceId = source(url, "contract-monitor", `USAspending parent award ${item.piid}`);
    if (sourceId) addRelation("supported-by-source", vehicleId, sourceId, evidence("contract-monitor", "published-parent-award-id", "exact", url));
  }
}
for (const item of contractLineageRegistry.namedPaths) {
  const pathId = acquisitionPath(item);
  for (const url of item.sourceUrls.slice(0, 3)) {
    const sourceId = source(url, "agent-records", `${item.label} source`);
    if (sourceId) addRelation("supported-by-source", pathId, sourceId, evidence("agent-records", "published-acquisition-path-label", "source_declared", url));
  }
}
for (const item of contractLineageRegistry.vehiclePathLinks) {
  addRelation(
    "contract-vehicle-associated-with-path",
    contractVehicleByKey.get(item.parentGeneratedAwardId),
    acquisitionPathByKey.get(item.pathKey),
    evidence("agent-records", "co-published-order-and-acquisition-path", "source_declared", "", "source_declared"),
    { supportingActivities: item.activityIds.length },
  );
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
  const connection = byActivity[record.opportunityId] = { activityId: record.opportunityId, entityId: id, awardIds: [], eventIds: [], transactionIds: [], organizationIds: [], locationIds: [], accountIds: [], subawardSummaryIds: [], classificationIds: [], sourceIds: [], contractVehicleIds: [], acquisitionPathIds: [], predecessorActivityIds: [], successorActivityIds: [], recompeteSignalIds: [], surfaces: ["spend-explorer", "opportunity-map", "procurement-discovery"], relationIds: [] };
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

for (const item of contractLineageRegistry.exactOrders) {
  const connection = byActivity[item.activityId];
  const activityId = connection?.entityId;
  const vehicleId = contractVehicleByKey.get(item.parentGeneratedAwardId);
  if (!activityId || !vehicleId) continue;
  connection.contractVehicleIds.push(vehicleId);
  addRelation("activity-ordered-under-vehicle", activityId, vehicleId, evidence("contract-monitor", "exact-parent-award-id", "exact", item.sourceUrl), { parentPiid: item.parentPiid, childPiid: item.childPiid, awardType: item.awardType });
  const awardId = awardByGeneratedId.get(item.childGeneratedAwardId) || awardByPiid.get(normalized(item.childPiid));
  if (awardId) addRelation("award-ordered-under-vehicle", awardId, vehicleId, evidence("contract-monitor", "exact-parent-award-id", "exact", item.sourceUrl), { parentPiid: item.parentPiid, childPiid: item.childPiid, awardType: item.awardType });
}

for (const item of contractLineageRegistry.activityPaths) {
  const connection = byActivity[item.activityId];
  const activityId = connection?.entityId;
  const pathId = acquisitionPathByKey.get(item.pathKey);
  if (!activityId || !pathId) continue;
  connection.acquisitionPathIds.push(pathId);
  addRelation("activity-uses-acquisition-path", activityId, pathId, evidence("agent-records", "published-acquisition-path-label", "source_declared", item.sourceUrl, "source_declared"));
}

for (const item of contractLineageRegistry.predecessorLinks) {
  const successor = byActivity[item.successorActivityId];
  const predecessor = byActivity[item.predecessorActivityId];
  if (!successor || !predecessor) continue;
  successor.predecessorActivityIds.push(predecessor.entityId);
  predecessor.successorActivityIds.push(successor.entityId);
  addRelation("activity-follow-on-to", successor.entityId, predecessor.entityId, evidence("agent-records", item.basis, item.confidence, item.sourceUrl, item.reviewState), { predecessorReference: item.predecessorReference });
}

for (const item of contractLineageRegistry.timingSignals) {
  const awardId = awardByGeneratedId.get(item.awardGeneratedId);
  if (!awardId) continue;
  addEntity("recompete-signal", {
    id: item.id,
    label: `${item.piid} timing review`,
    piid: item.piid,
    endDate: item.endDate,
    daysUntilEnd: item.daysUntilEnd,
    status: item.status,
    reviewState: item.reviewState,
    caveat: item.caveat,
    sourceArtifact: "budget-execution",
  });
  addRelation("award-has-recompete-signal", awardId, item.id, evidence("budget-execution", item.basis, item.confidence, "", item.reviewState));
  const activity = Object.values(byActivity).find((connection) => connection.awardIds.includes(awardId));
  if (activity) {
    activity.recompeteSignalIds.push(item.id);
    addRelation("activity-has-recompete-signal", activity.entityId, item.id, evidence("budget-execution", item.basis, item.confidence, "", item.reviewState));
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
  connection.contractVehicleIds = [...new Set(connection.contractVehicleIds)];
  connection.acquisitionPathIds = [...new Set(connection.acquisitionPathIds)];
  connection.predecessorActivityIds = [...new Set(connection.predecessorActivityIds)];
  connection.successorActivityIds = [...new Set(connection.successorActivityIds)];
  connection.recompeteSignalIds = [...new Set(connection.recompeteSignalIds)];
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
    contractVehicles: connection.contractVehicleIds.length,
    acquisitionPaths: connection.acquisitionPathIds.length,
    predecessors: connection.predecessorActivityIds.length,
    successors: connection.successorActivityIds.length,
    recompeteSignals: connection.recompeteSignalIds.length,
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

const temporalInputs = {
  entities,
  relations,
  agents,
  execution,
  calendar,
  transactions,
  accountSpine,
  subawards,
  map,
  locationMetadata,
  monitor,
  discovery,
  core,
  organizationConflicts: organizationRegistry.conflicts,
  predecessorConflicts: contractLineageRegistry.review.predecessorConflicts,
  unresolvedFollowOnClaims: contractLineageRegistry.review.unresolvedFollowOnClaims,
};
const temporalEvidence = buildTemporalEvidenceRegistry(temporalInputs);
for (const claim of temporalEvidence.claims) {
  addEntity("evidence-claim", {
    id: claim.id,
    label: `${claim.field}: ${String(claim.value)}`,
    field: claim.field,
    value: claim.value,
    observedAt: claim.observedAt,
    reviewState: claim.reviewState,
    sourceArtifact: claim.sourceArtifact,
  });
  if (entityKeys.activity.has(claim.subjectId) || Object.values(entityKeys).some((keys) => keys.has(claim.subjectId))) {
    addRelation("evidence-claim-about", claim.id, claim.subjectId, evidence(claim.sourceArtifact, `published-${claim.field}-claim`, "source_declared", claim.sourceUrl, claim.reviewState));
  }
  const sourceId = source(claim.sourceUrl, claim.sourceArtifact, `${claim.field} claim source`);
  if (sourceId) addRelation("supported-by-source", claim.id, sourceId, evidence(claim.sourceArtifact, "claim-source-url", "exact", claim.sourceUrl, claim.reviewState));
}
for (const conflict of temporalEvidence.conflicts) {
  addEntity("evidence-conflict", {
    id: conflict.id,
    label: `${conflict.kind}: ${conflict.field}`,
    field: conflict.field,
    kind: conflict.kind,
    status: conflict.status,
    reason: conflict.reason,
    resolutionBasis: conflict.resolutionBasis || null,
    sourceArtifact: "temporal-evidence-review",
  });
  for (const claimId of conflict.claimIds) addRelation("evidence-conflict-has-claim", conflict.id, claimId, evidence("temporal-evidence-review", "retained-competing-claim", "exact", "", conflict.status));
  if (conflict.winningClaimId) addRelation("evidence-conflict-resolved-by", conflict.id, conflict.winningClaimId, evidence("temporal-evidence-review", conflict.resolutionBasis, "reviewed", "", "resolved"));
}
const addedTemporalRelationCount = relations.filter((relation) => !relation.validity).length;
const reviewQueueReviewBy = new Date(Date.parse(temporalEvidence.metadata.evaluationDate) + 90 * 86_400_000).toISOString().slice(0, 10);
for (const relation of relations.filter((item) => !item.validity)) {
  relation.validity = {
    observedAt: temporalEvidence.metadata.generatedAt,
    effectiveFrom: null,
    effectiveTo: null,
    supersededAt: null,
    reviewedAt: temporalEvidence.metadata.evaluationDate,
    reviewBy: reviewQueueReviewBy,
    status: "current",
    basis: "review-queue-generation",
  };
}
temporalEvidence.relationStatusCounts.current += addedTemporalRelationCount;
temporalEvidence.review.summary.relationsAssessed = relations.length;
temporalEvidence.review.summary.current += addedTemporalRelationCount;

const graph = {
  metadata: {
    schemaVersion: INTELLIGENCE_GRAPH_SCHEMA_VERSION,
    generatedAt: temporalEvidence.metadata.generatedAt,
    asOf: temporalEvidence.metadata.evaluationDate,
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
      contracts: {
        exactParentVehicles: contractLineageRegistry.review.summary.exactParentVehicles,
        activitiesWithExactParent: contractLineageRegistry.review.summary.activitiesWithExactParent,
        multiOrderFamilies: contractLineageRegistry.review.summary.multiOrderFamilies,
        ordersInMultiOrderFamilies: contractLineageRegistry.review.summary.ordersInMultiOrderFamilies,
        namedAcquisitionPaths: contractLineageRegistry.review.summary.namedAcquisitionPaths,
        activitiesWithNamedPath: contractLineageRegistry.review.summary.activitiesWithNamedPath,
        resolvedPredecessorLinks: contractLineageRegistry.review.summary.resolvedPredecessorLinks,
        unresolvedFollowOnClaims: contractLineageRegistry.review.summary.unresolvedFollowOnClaims,
        recompeteTimingSignals: contractLineageRegistry.review.summary.recompeteTimingSignals,
      },
      temporal: temporalEvidence.review.summary,
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
      contractVehicle: "Exact USAspending parent IDV generated award ID with parent PIID retained as its public identifier.",
      acquisitionPath: "Source-declared vehicle or access-path label retained separately from exact parent IDV identity.",
      recompeteSignal: "Review-only timing signal derived from a reported award end date; never proof of a recompete or successor.",
      location: "Stable reviewed location ID from the authoritative map snapshot.",
      federalAccount: "Federal account code from USAspending account spine.",
      source: "Canonical HTTP(S) URL.",
      evidenceClaim: "One source-attributed field value observed at a stated time. Competing claims are preserved rather than overwritten.",
      evidenceConflict: "A typed disagreement among retained claims. Resolution requires exact evidence, explicit review, or a newer current source under the published recency rule.",
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
    contractLineagePolicy: {
      parentRule: "Only an exact published USAspending parent award identifier creates an order-to-IDV relationship.",
      pathRule: "Published vehicle labels remain source-declared acquisition paths and never replace the exact parent IDV.",
      predecessorRule: "A predecessor relationship requires an exact or explicitly reviewed predecessor reference that resolves to one retained activity.",
      timingRule: "An award ending within 730 days creates a needs-review timing signal only; timing alone never asserts a recompete, follow-on, or successor.",
    },
    temporalValidityPolicy: {
      evaluationRule: "Relationship validity is evaluated against the latest retained source observation, never browser time.",
      states: ["current", "historical", "future", "stale", "superseded", "unknown"],
      supersessionRule: "Only a newer current observation of the same stable subject and field may supersede an older value automatically.",
      conflictRule: "Identifier disagreements, stale observations, ambiguous identity, and unresolved lineage remain review items; fuzzy similarity never selects a winner.",
    },
  },
  entities,
  relations,
  indices: { byActivity },
};

mkdirSync(DATA_DIR, { recursive: true });
const graphJson = JSON.stringify(graph);
writeFileSync(OUT_FILE, graphJson);
writeFileSync(OUT_GZIP_FILE, gzipSync(graphJson, { level: 9 }));
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
const contractLineageReview = {
  metadata: {
    schemaVersion: CONTRACT_LINEAGE_SCHEMA_VERSION,
    graphSchemaVersion: INTELLIGENCE_GRAPH_SCHEMA_VERSION,
    generatedAt: graph.metadata.generatedAt,
    title: "Contract family lineage and review queue",
    trustBoundary: contractLineageRegistry.metadata.trustBoundary,
  },
  summary: contractLineageRegistry.review.summary,
  predecessorConflicts: contractLineageRegistry.review.predecessorConflicts,
  unresolvedFollowOnClaims: contractLineageRegistry.review.unresolvedFollowOnClaims,
};
writeFileSync(CONTRACT_LINEAGE_REVIEW_FILE, JSON.stringify(contractLineageReview));
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
  if (type === "contract-vehicle") return { id, piid: entity.piid, label: entity.label, kind: entity.kind, orderCount: entity.orderCount };
  if (type === "acquisition-path") return { id, label: entity.label, kind: entity.kind, activityCount: entity.activityCount };
  if (type === "recompete-signal") return { id, label: entity.label, piid: entity.piid, endDate: entity.endDate, daysUntilEnd: entity.daysUntilEnd, status: entity.status, caveat: entity.caveat };
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
  delete deferredConnection.contractVehicleIds;
  delete deferredConnection.acquisitionPathIds;
  delete deferredConnection.predecessorActivityIds;
  delete deferredConnection.successorActivityIds;
  delete deferredConnection.recompeteSignalIds;
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
const agentById = new Map((agents.records || []).map((record) => [record.opportunityId, record]));
const compactActivity = (opportunityId) => {
  const record = agentById.get(opportunityId);
  if (!record) return null;
  return { opportunityId, reference: record.reference, label: record.title, lifecycle: record.lifecycleStatus, mode: record.mode, obligatedAmount: Number(record.obligatedAmount || 0) };
};
const familyMembersByVehicleId = new Map(contractLineageRegistry.exactVehicles.map((item) => [contractVehicleByKey.get(item.generatedAwardId), item.activityIds]));
const unresolvedClaimByActivity = new Map(contractLineageRegistry.review.unresolvedFollowOnClaims.map((item) => [item.activityId, item]));
const predecessorLinkBySuccessor = new Map(contractLineageRegistry.predecessorLinks.map((item) => [item.successorActivityId, item]));
const successorLinksByPredecessor = new Map();
for (const item of contractLineageRegistry.predecessorLinks) successorLinksByPredecessor.set(item.predecessorActivityId, [...(successorLinksByPredecessor.get(item.predecessorActivityId) || []), item]);
const contractLineageByActivity = Object.fromEntries(Object.entries(byActivity).flatMap(([opportunityId, connection]) => {
  const vehicles = connection.contractVehicleIds.map((id) => compact("contract-vehicle", id)).filter(Boolean);
  const acquisitionPaths = connection.acquisitionPathIds.map((id) => compact("acquisition-path", id)).filter(Boolean);
  const siblingOrders = [...new Set(connection.contractVehicleIds.flatMap((id) => familyMembersByVehicleId.get(id) || []).filter((id) => id !== opportunityId))].map(compactActivity).filter(Boolean);
  const predecessorLink = predecessorLinkBySuccessor.get(opportunityId);
  const predecessors = predecessorLink ? [{ ...compactActivity(predecessorLink.predecessorActivityId), basis: predecessorLink.basis, confidence: predecessorLink.confidence, reviewState: predecessorLink.reviewState }] : [];
  const successors = (successorLinksByPredecessor.get(opportunityId) || []).map((item) => ({ ...compactActivity(item.successorActivityId), basis: item.basis, confidence: item.confidence, reviewState: item.reviewState }));
  const recompeteSignals = connection.recompeteSignalIds.map((id) => compact("recompete-signal", id)).filter(Boolean);
  const unresolvedClaim = unresolvedClaimByActivity.get(opportunityId) || null;
  if (![vehicles, acquisitionPaths, siblingOrders, predecessors, successors, recompeteSignals].some((items) => items.length) && !unresolvedClaim) return [];
  return [[opportunityId, { vehicles, acquisitionPaths, siblingOrders, predecessors, successors, recompeteSignals, ...(unresolvedClaim ? { unresolvedClaim } : {}) }]];
}));
const contractLineageIndex = {
  metadata: {
    schemaVersion: CONTRACT_LINEAGE_SCHEMA_VERSION,
    graphSchemaVersion: INTELLIGENCE_GRAPH_SCHEMA_VERSION,
    generatedAt: graph.metadata.generatedAt,
    asOf: contractLineageRegistry.metadata.asOf,
    title: "Contract family lineage browser index",
    trustBoundary: contractLineageRegistry.metadata.trustBoundary,
    summary: contractLineageRegistry.review.summary,
  },
  indices: { byActivity: contractLineageByActivity },
};
writeFileSync(CONTRACT_LINEAGE_INDEX_FILE, JSON.stringify(contractLineageIndex));
const temporalEvidenceIndex = {
  metadata: {
    ...temporalEvidence.metadata,
    graphSchemaVersion: INTELLIGENCE_GRAPH_SCHEMA_VERSION,
    title: "Temporal validity and evidence-conflict browser index",
    summary: temporalEvidence.review.summary,
  },
  indices: { byActivity: temporalEvidence.byActivity },
};
writeFileSync(TEMPORAL_EVIDENCE_INDEX_FILE, JSON.stringify(temporalEvidenceIndex));
const temporalClaimById = new Map(temporalEvidence.claims.map((claim) => [claim.id, claim]));
const temporalEvidenceReview = {
  metadata: {
    ...temporalEvidence.metadata,
    graphSchemaVersion: INTELLIGENCE_GRAPH_SCHEMA_VERSION,
    title: "Temporal validity and evidence-conflict review queue",
  },
  summary: temporalEvidence.review.summary,
  conflicts: temporalEvidence.conflicts.map((conflict) => ({
    ...conflict,
    claims: conflict.claimIds.map((id) => temporalClaimById.get(id)),
  })),
};
writeFileSync(TEMPORAL_EVIDENCE_REVIEW_FILE, JSON.stringify(temporalEvidenceReview));
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
console.log(JSON.stringify({ output: OUT_FILE, bytes: readFileSync(OUT_FILE).byteLength, compressedOutput: OUT_GZIP_FILE, compressedBytes: readFileSync(OUT_GZIP_FILE).byteLength, index: INDEX_FILE, indexBytes: readFileSync(INDEX_FILE).byteLength, contractLineageIndex: CONTRACT_LINEAGE_INDEX_FILE, contractLineageIndexBytes: readFileSync(CONTRACT_LINEAGE_INDEX_FILE).byteLength, temporalEvidenceIndex: TEMPORAL_EVIDENCE_INDEX_FILE, temporalEvidenceIndexBytes: readFileSync(TEMPORAL_EVIDENCE_INDEX_FILE).byteLength, summary: SUMMARY_FILE, summaryBytes: readFileSync(SUMMARY_FILE).byteLength, organizationReview: ORGANIZATION_REVIEW_FILE, organizationReviewBytes: readFileSync(ORGANIZATION_REVIEW_FILE).byteLength, contractLineageReview: CONTRACT_LINEAGE_REVIEW_FILE, contractLineageReviewBytes: readFileSync(CONTRACT_LINEAGE_REVIEW_FILE).byteLength, temporalEvidenceReview: TEMPORAL_EVIDENCE_REVIEW_FILE, temporalEvidenceReviewBytes: readFileSync(TEMPORAL_EVIDENCE_REVIEW_FILE).byteLength, metadata: graph.metadata }, null, 2));
