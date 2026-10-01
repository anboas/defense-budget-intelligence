import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
const OUT_GZIP_FILE = resolve(DATA_DIR, "intelligence-graph.json.gzip");
const LEGACY_GZIP_FILE = resolve(DATA_DIR, "intelligence-graph.json.gz");
const INDEX_FILE = resolve(DATA_DIR, "intelligence-graph-index.json");
const SUMMARY_FILE = resolve(DATA_DIR, "intelligence-graph-summary.json");
const ORGANIZATION_REVIEW_FILE = resolve(DATA_DIR, "organization-identity-review.json");
const CONTRACT_LINEAGE_INDEX_FILE = resolve(DATA_DIR, "contract-lineage-index.json");
const CONTRACT_LINEAGE_REVIEW_FILE = resolve(DATA_DIR, "contract-lineage-review.json");
const TEMPORAL_EVIDENCE_INDEX_FILE = resolve(DATA_DIR, "temporal-evidence-index.json");
const TEMPORAL_EVIDENCE_REVIEW_FILE = resolve(DATA_DIR, "temporal-evidence-review.json");
const AGENT_GRAPH_DIR = resolve(DATA_DIR, "agent-graph");
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
const spendingCoverage = read("usaspending-coverage.json");
const samBackbone = JSON.parse(readFileSync(resolve(ROOT, "src/data/sam-acquisition-backbone.json"), "utf8"));
const priorityAwardActions = JSON.parse(readFileSync(resolve(ROOT, "src/data/priority-award-actions.json"), "utf8"));
const legislative = JSON.parse(readFileSync(resolve(ROOT, "src/data/legislative-traceability.json"), "utf8"));
const strategic = JSON.parse(readFileSync(resolve(ROOT, "src/data/strategic-intelligence.json"), "utf8"));
const programIntelligence = JSON.parse(readFileSync(resolve(ROOT, "src/data/program-intelligence.json"), "utf8"));
const roadmapIntelligence = JSON.parse(readFileSync(resolve(ROOT, "src/data/roadmap-intelligence.json"), "utf8"));
const organizationIntelligence = JSON.parse(readFileSync(resolve(ROOT, "src/data/organization-intelligence.json"), "utf8"));
const organizationChangeMonitor = JSON.parse(readFileSync(resolve(ROOT, "src/data/organization-change-monitor.json"), "utf8"));
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
const treasuryAccountByCode = new Map();

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

const spendingSources = Object.fromEntries(Object.entries(spendingCoverage.metadata?.sourceUrls || {})
  .filter(([key]) => key !== "spendingByCategory")
  .map(([key, url]) => [key, source(String(url), "usaspending-coverage", `USAspending ${key}`)]));
const spendingCategorySources = new Map();
const spendingCategorySource = (dimension) => {
  if (!spendingCategorySources.has(dimension)) {
    const url = String(spendingCoverage.metadata?.sourceUrls?.spendingByCategory || "")
      .replace("{category}", dimension);
    spendingCategorySources.set(dimension, source(url, "usaspending-coverage", `USAspending spendingByCategory ${dimension}`));
  }
  return spendingCategorySources.get(dimension);
};
const dodOrganizationId = organization("Department of Defense", "usaspending-coverage", {}, { identityClass: "government" });
const addSpendingObservation = ({ id, label, fiscalYear, dimension, subjectCode = null, obligatedAmount, rank = null, status, subjectId, sourceId }) => {
  addEntity("spending-observation", {
    id,
    label,
    fiscalYear,
    dimension,
    subjectCode,
    obligatedAmount: Number(obligatedAmount || 0),
    rank,
    status,
    amountType: "fiscal-year-contract-obligations",
    sourceArtifact: "usaspending-coverage",
  });
  addRelation("spending-observation-measures-entity", id, subjectId, evidence("usaspending-coverage", "official-transaction-aggregation", "exact", entities.source.find((item) => item.id === sourceId)?.url), { fiscalYear, dimension, rank, amountType: "obligations" });
  if (sourceId) addRelation("supported-by-source", id, sourceId, evidence("usaspending-coverage", "official-api-endpoint", "exact", entities.source.find((item) => item.id === sourceId)?.url));
};

for (const row of spendingCoverage.annualTotals || []) {
  addSpendingObservation({
    id: `spending-observation:fiscal-year:${row.fiscalYear}`,
    label: `FY${row.fiscalYear} Department of Defense contract obligations`,
    fiscalYear: row.fiscalYear,
    dimension: "fiscal-year",
    obligatedAmount: row.obligatedAmount,
    status: row.fiscalYear === spendingCoverage.metadata?.lastFiscalYear ? "year-to-date" : "complete-fiscal-year",
    subjectId: dodOrganizationId,
    sourceId: spendingSources.spendingOverTime,
  });
}

for (const year of spendingCoverage.years || []) {
  for (const [dimension, rows] of Object.entries(year.categories || {})) {
    for (const row of rows || []) {
      const identity = dimension === "recipient"
        ? row.uei || row.id || row.code || row.name
        : row.id ?? row.code ?? row.name;
      const subjectId = dimension === "recipient"
        ? organization(row.name, "usaspending-coverage", { uei: row.uei }, { identityClass: "recipient" })
        : ["awarding_subagency", "funding_subagency"].includes(dimension)
          ? organization(row.name, "usaspending-coverage", {}, { identityClass: "government" })
          : classification(dimension, row.code || row.name, row.name, "usaspending-coverage");
      addSpendingObservation({
        id: `spending-observation:${year.fiscalYear}:${dimension}:${hash(identity)}`,
        label: `FY${year.fiscalYear} ${row.name} contract obligations`,
        fiscalYear: year.fiscalYear,
        dimension,
        subjectCode: row.uei || row.code || null,
        obligatedAmount: row.obligatedAmount,
        rank: row.rank,
        status: year.status,
        subjectId,
        sourceId: spendingCategorySource(dimension),
      });
    }
  }
}

for (const award of spendingCoverage.awards || []) {
  const existingId = awardByGeneratedId.get(award.generatedAwardId) || awardByPiid.get(normalized(award.piid));
  const id = existingId || `award:${award.generatedAwardId}`;
  if (!existingId) {
    awardByGeneratedId.set(award.generatedAwardId, id);
    awardByPiid.set(normalized(award.piid), id);
    addEntity("award", {
      id,
      generatedAwardId: award.generatedAwardId,
      piid: award.piid,
      label: award.description || award.piid,
      recipient: award.recipient,
      awardAmount: Number(award.awardAmount || 0),
      amountType: award.kind === "idv" ? "published-idv-value-or-ceiling" : "published-award-total",
      startDate: award.startDate,
      endDate: award.endDate,
      observedFiscalYears: award.observedFiscalYears,
      fiscalYearRanks: award.fiscalYearRanks,
      sourceArtifact: "usaspending-coverage",
    });
  } else {
    const entity = entities.award.find((item) => item.id === id);
    if (entity) {
      entity.observedFiscalYears = award.observedFiscalYears;
      entity.fiscalYearRanks = award.fiscalYearRanks;
      entity.coverageAwardAmount = Number(award.awardAmount || 0);
    }
  }
  const recipientId = organization(award.recipient, "usaspending-coverage", { uei: award.recipientUei }, { identityClass: "recipient" });
  addRelation("award-recipient", id, recipientId, evidence("usaspending-coverage", award.recipientUei ? "published-recipient-uei" : "published-recipient-label", award.recipientUei ? "exact" : "source_declared", award.sourceUrl));
  for (const [type, labelValue, role] of [["award-awarding-organization", award.awardingOffice || award.awardingSubAgency, "awarding"], ["award-funding-organization", award.fundingOffice || award.fundingSubAgency, "funding"]]) {
    const organizationId = organization(labelValue, "usaspending-coverage", {}, { identityClass: "government" });
    addRelation(type, id, organizationId, evidence("usaspending-coverage", "published-organization-label", "source_declared", award.sourceUrl), { role });
  }
  addRelation("entity-classified-as", id, classification("naics", award.naicsCode, award.naicsDescription, "usaspending-coverage"), evidence("usaspending-coverage", "published-naics", "exact", award.sourceUrl));
  addRelation("entity-classified-as", id, classification("psc", award.pscCode, award.pscDescription, "usaspending-coverage"), evidence("usaspending-coverage", "published-psc", "exact", award.sourceUrl));
  const sourceId = source(award.sourceUrl, "usaspending-coverage", `USAspending award ${award.piid}`);
  if (sourceId) addRelation("supported-by-source", id, sourceId, evidence("usaspending-coverage", "generated-award-url", "exact", award.sourceUrl));
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

const historicalAccounts = new Map();
for (const snapshot of accountSpine.accountSnapshots || []) {
  const prior = historicalAccounts.get(snapshot.federalAccountCode);
  if (!prior || Number(snapshot.fiscalYear || 0) > Number(prior.fiscalYear || 0)) historicalAccounts.set(snapshot.federalAccountCode, snapshot);
}
for (const [federalAccountCode, account] of historicalAccounts) {
  if (accountByCode.has(federalAccountCode)) continue;
  const id = `account:${federalAccountCode}`;
  accountByTitle.set(normalized(account.title), id);
  accountByCode.set(federalAccountCode, id);
  addEntity("federal-account", {
    id,
    federalAccountCode,
    label: account.title,
    obligatedAmount: Number(account.obligatedAmount || 0),
    lastObservedFiscalYear: Number(account.fiscalYear || 0),
    lifecycleStatus: "historical",
    sourceArtifact: "account-spine",
  });
  const sourceId = source(account.sourceUrl, "account-spine", `Historical federal account ${federalAccountCode}`);
  if (sourceId) addRelation("supported-by-source", id, sourceId, evidence("account-spine", "official-historical-account-url", "exact", account.sourceUrl));
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

for (const row of accountSpine.executionBalances || []) {
  let treasuryAccountId = treasuryAccountByCode.get(row.tasCode);
  if (!treasuryAccountId) {
    treasuryAccountId = `treasury-account:${row.tasCode}`;
    treasuryAccountByCode.set(row.tasCode, treasuryAccountId);
    addEntity("treasury-account", {
      id: treasuryAccountId,
      tasCode: row.tasCode,
      label: row.title,
      availability: row.availability,
      sourceArtifact: "account-spine",
    });
    const sourceId = source(row.sourceUrl, "account-spine", `USAspending Treasury account ${row.tasCode}`);
    if (sourceId) addRelation("supported-by-source", treasuryAccountId, sourceId, evidence("account-spine", "official-account-url", "exact", row.sourceUrl));
  }
  const federalAccountId = accountByCode.get(row.federalAccountCode);
  if (federalAccountId) addRelation("federal-account-has-treasury-account", federalAccountId, treasuryAccountId, evidence("account-spine", "published-federal-account-child", "exact", row.sourceUrl), { fiscalYear: row.fiscalYear });
  addEntity("execution-balance", {
    id: row.id,
    label: `FY${row.fiscalYear} ${row.title}`,
    fiscalYear: row.fiscalYear,
    obligatedAmount: row.obligatedAmount,
    outlayedAmount: row.outlayedAmount,
    apportionmentApprovedAmount: row.apportionmentApprovedAmount,
    unobligatedAmount: row.unobligatedAmount,
    availability: row.availability,
    sourceArtifact: "account-spine",
  });
  if (federalAccountId) addRelation("federal-account-has-execution-balance", federalAccountId, row.id, evidence("account-spine", "exact-federal-account-fiscal-year", "exact", row.sourceUrl), { fiscalYear: row.fiscalYear });
  addRelation("treasury-account-has-execution-balance", treasuryAccountId, row.id, evidence("account-spine", "exact-tafs-fiscal-year", "exact", row.sourceUrl), { fiscalYear: row.fiscalYear });
}

for (const row of accountSpine.apportionmentRevisions || []) {
  addEntity("apportionment-revision", {
    id: row.id,
    label: `FY${row.fiscalYear} ${row.accountTitle} iteration ${row.iteration}`,
    fiscalYear: row.fiscalYear,
    tafs: row.tafs,
    iteration: row.iteration,
    approvedAmount: row.approvedAmount,
    approvedLine: row.approvedLine,
    approvalTimestamp: row.approvalTimestamp,
    isLatest: row.isLatest,
    sourceIdentifier: row.sourceIdentifier,
    sourceArtifact: "account-spine",
  });
  const treasuryAccountId = treasuryAccountByCode.get(row.tasCode);
  if (treasuryAccountId) addRelation("treasury-account-apportioned-by-revision", treasuryAccountId, row.id, evidence("account-spine", "exact-tafs-iteration", "exact", row.sourceUrl), { fiscalYear: row.fiscalYear, iteration: row.iteration, latest: row.isLatest });
  const sourceId = source(row.sourceUrl, "account-spine", `OMB apportionment ${row.sourceIdentifier}`);
  if (sourceId) addRelation("supported-by-source", row.id, sourceId, evidence("account-spine", "official-omb-json", "exact", row.sourceUrl));
}

for (const row of accountSpine.programActivities || []) {
  addEntity("program-activity", { id: row.id, label: row.name, fiscalYear: row.fiscalYear, obligatedAmount: row.obligatedAmount, outlayedAmount: row.outlayedAmount, sourceArtifact: "account-spine" });
  addRelation("program-activity-owned-by-organization", row.id, dodOrganizationId, evidence("account-spine", "official-agency-program-activity", "exact", row.sourceUrl), { fiscalYear: row.fiscalYear });
  const sourceId = source(row.sourceUrl, "account-spine", `USAspending FY${row.fiscalYear} program activities`);
  if (sourceId) addRelation("supported-by-source", row.id, sourceId, evidence("account-spine", "official-api-endpoint", "exact", row.sourceUrl));
}

for (const row of accountSpine.objectClasses || []) {
  addEntity("object-class", { id: row.id, label: row.name, fiscalYear: row.fiscalYear, obligatedAmount: row.obligatedAmount, outlayedAmount: row.outlayedAmount, sourceArtifact: "account-spine" });
  addRelation("object-class-used-by-organization", row.id, dodOrganizationId, evidence("account-spine", "official-agency-object-class", "exact", row.sourceUrl), { fiscalYear: row.fiscalYear });
  const sourceId = source(row.sourceUrl, "account-spine", `USAspending FY${row.fiscalYear} object classes`);
  if (sourceId) addRelation("supported-by-source", row.id, sourceId, evidence("account-spine", "official-api-endpoint", "exact", row.sourceUrl));
}

for (const row of accountSpine.treasuryOutlays || []) {
  const id = `treasury-outlay-observation:${row.recordDate}`;
  addEntity("treasury-outlay-observation", { id, label: `${row.recordDate} Department of Defense military-program outlays`, ...row, sourceArtifact: "account-spine" });
  addRelation("treasury-outlay-observation-measures-organization", id, dodOrganizationId, evidence("account-spine", "official-monthly-treasury-statement", "exact", row.sourceUrl), { fiscalYear: row.fiscalYear, amountType: "net-outlays" });
  const sourceId = source(row.sourceUrl, "account-spine", "Treasury Monthly Statement table 5");
  if (sourceId) addRelation("supported-by-source", id, sourceId, evidence("account-spine", "official-api-endpoint", "exact", row.sourceUrl));
}

const samCollections = samBackbone.collections || {};
const noticeByNoticeId = new Map();
for (const row of samCollections.notices || []) {
  noticeByNoticeId.set(row.noticeId, row.id);
  addEntity("opportunity-notice", { ...row, sourceArtifact: "sam-acquisition-backbone" });
  const sourceId = source(row.sourceUrl, "sam-acquisition-backbone", `SAM.gov notice ${row.noticeId}`);
  if (sourceId) addRelation("supported-by-source", row.id, sourceId, evidence("sam-acquisition-backbone", "official-notice-url", "exact", row.sourceUrl));
}
const noticeVersionsByNotice = new Map();
for (const row of samCollections.noticeVersions || []) {
  addEntity("notice-version", { ...row, label: `${row.noticeId} observed ${row.observedAt}`, sourceArtifact: "sam-acquisition-backbone" });
  const noticeId = noticeByNoticeId.get(row.noticeId);
  if (noticeId) addRelation("notice-has-version", noticeId, row.id, evidence("sam-acquisition-backbone", "exact-notice-id", "exact", row.sourceUrl), { observedAt: row.observedAt });
  const versions = noticeVersionsByNotice.get(row.noticeId) || [];
  versions.push(row);
  noticeVersionsByNotice.set(row.noticeId, versions);
}
for (const versions of noticeVersionsByNotice.values()) {
  versions.sort((left, right) => String(left.observedAt).localeCompare(String(right.observedAt)));
  for (let index = 1; index < versions.length; index += 1) addRelation("notice-version-supersedes", versions[index].id, versions[index - 1].id, evidence("sam-acquisition-backbone", "observation-order", "deterministic", versions[index].sourceUrl));
}
for (const row of samCollections.awardActions || []) {
  addEntity("award-action", { ...row, label: `${row.piid} ${row.modificationNumber}`, sourceArtifact: "sam-acquisition-backbone" });
  let awardId = awardByPiid.get(normalized(row.piid));
  if (!awardId) {
    awardId = `award:sam:${hash(row.piid)}`;
    awardByPiid.set(normalized(row.piid), awardId);
    addEntity("award", { id: awardId, piid: row.piid, label: row.piid, recipient: row.recipientName, sourceArtifact: "sam-acquisition-backbone" });
  }
  addRelation("award-modified-by-action", awardId, row.id, evidence("sam-acquisition-backbone", "exact-piid", "exact", row.sourceUrl), { modificationNumber: row.modificationNumber, actionDate: row.actionDate });
  const noticeId = noticeByNoticeId.get(row.noticeId);
  if (noticeId) addRelation("notice-results-in-award", noticeId, awardId, evidence("sam-acquisition-backbone", "source-declared-notice-award", "exact", row.sourceUrl));
  const recipientId = organization(row.recipientName, "sam-acquisition-backbone", { uei: row.recipientUei }, { identityClass: "recipient" });
  if (recipientId) addRelation("award-action-recipient", row.id, recipientId, evidence("sam-acquisition-backbone", row.recipientUei ? "published-uei" : "published-recipient-label", row.recipientUei ? "exact" : "source_declared", row.sourceUrl));
  const vehicleId = row.referencedIdvPiid ? [...contractVehicleByKey.values()].find((id) => entities["contract-vehicle"].find((item) => item.id === id)?.piid === row.referencedIdvPiid) : null;
  if (vehicleId) addRelation("award-action-ordered-under-vehicle", row.id, vehicleId, evidence("sam-acquisition-backbone", "published-referenced-idv-piid", "exact", row.sourceUrl));
}
for (const row of priorityAwardActions.actions || []) {
  addEntity("award-action", { ...row, label: `${row.piid || row.awardId} ${row.modificationNumber || row.transactionId}`, sourceArtifact: "priority-award-actions" });
  const awardId = awardByGeneratedId.get(row.awardId) || awardByPiid.get(normalized(row.piid));
  if (awardId) addRelation("award-modified-by-action", awardId, row.id, evidence("priority-award-actions", "exact-generated-award-and-transaction-id", "exact", row.sourceUrl), { modificationNumber: row.modificationNumber, actionDate: row.actionDate, obligatedAmount: row.obligatedAmount });
  const sourceId = source(row.sourceUrl, "priority-award-actions", `USAspending transaction ${row.transactionId}`);
  if (sourceId) addRelation("supported-by-source", row.id, sourceId, evidence("priority-award-actions", "official-transaction-url", "exact", row.sourceUrl));
}
for (const row of samCollections.vendorRegistrations || []) {
  addEntity("vendor-registration", { ...row, label: row.legalBusinessName, sourceArtifact: "sam-acquisition-backbone" });
  const organizationId = organization(row.legalBusinessName, "sam-acquisition-backbone", { uei: row.uei }, { identityClass: "recipient" });
  if (organizationId) {
    addRelation("organization-has-registration", organizationId, row.id, evidence("sam-acquisition-backbone", "exact-uei", "exact", row.sourceUrl));
    const cageId = organizationIdentifier("cage", row.cageCode, "sam-acquisition-backbone");
    if (cageId) addRelation("organization-has-identifier", organizationId, cageId, evidence("sam-acquisition-backbone", "published-cage", "exact", row.sourceUrl), { namespace: "cage" });
  }
}
for (const row of samCollections.businessCertifications || []) {
  addEntity("business-certification", { ...row, sourceArtifact: "sam-acquisition-backbone" });
  const registrationId = `vendor-registration:${row.uei}`;
  if (entityKeys["vendor-registration"].has(registrationId)) addRelation("registration-has-certification", registrationId, row.id, evidence("sam-acquisition-backbone", "published-business-type", "exact", row.sourceUrl));
}
for (const row of samCollections.hierarchyObservations || []) {
  addEntity("organization-hierarchy-observation", { ...row, label: row.name, sourceArtifact: "sam-acquisition-backbone" });
  const organizationId = organization(row.name, "sam-acquisition-backbone", { officeCode: row.code }, { identityClass: "government-office" });
  if (organizationId) addRelation("organization-hierarchy-observed-as", organizationId, row.id, evidence("sam-acquisition-backbone", row.basis, "source_declared", row.sourceUrl));
  const parentId = organization(row.parentName, "sam-acquisition-backbone", { officeCode: row.parentCode }, { identityClass: "government-office" });
  if (parentId) addRelation("hierarchy-observation-parent", row.id, parentId, evidence("sam-acquisition-backbone", row.basis, "source_declared", row.sourceUrl));
}
for (const row of samCollections.subawards || []) {
  addEntity("subaward", { ...row, label: row.recipientName || row.subawardNumber || row.reportId, sourceArtifact: "sam-acquisition-backbone" });
  const awardId = awardByPiid.get(normalized(row.piid));
  if (awardId) addRelation("award-has-subaward", awardId, row.id, evidence("sam-acquisition-backbone", "exact-prime-piid", "exact", row.sourceUrl));
  const primeId = organization(row.primeName, "sam-acquisition-backbone", { uei: row.primeUei }, { identityClass: "recipient" });
  if (primeId) addRelation("subaward-prime", row.id, primeId, evidence("sam-acquisition-backbone", row.primeUei ? "published-prime-uei" : "published-prime-label", row.primeUei ? "exact" : "source_declared", row.sourceUrl));
  const recipientId = organization(row.recipientName, "sam-acquisition-backbone", { uei: row.recipientUei }, { identityClass: "recipient" });
  if (recipientId) addRelation("subaward-recipient", row.id, recipientId, evidence("sam-acquisition-backbone", row.recipientUei ? "published-subawardee-uei" : "published-subawardee-label", row.recipientUei ? "exact" : "source_declared", row.sourceUrl));
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
  if (line.bookId === "R-1" && line.lineCode) {
    const programElementId = `program-element:${normalized(`${line.org}|${line.lineCode}`)}`;
    addEntity("program-element", { id: programElementId, code: line.lineCode, label: line.lineTitle || line.subActivityTitle || line.lineCode, organization: line.orgName, sourceArtifact: "budget-core" });
    addRelation("program-element-represented-by-budget-line", programElementId, id, evidence("budget-core", "exact-r1-program-element-code", "exact"));
  }
  if (line.bookId === "C-1" && (line.lineCode || line.lineNumber)) {
    const projectId = `project:${normalized(`${line.org}|${line.lineCode || line.lineNumber}|${line.lineTitle}`)}`;
    addEntity("project", { id: projectId, code: line.lineCode || line.lineNumber, label: line.lineTitle || line.subActivityTitle || line.accountTitle, organization: line.orgName, sourceArtifact: "budget-core" });
    addRelation("project-represented-by-budget-line", projectId, id, evidence("budget-core", "exact-c1-project-line", "exact"));
  }
}

const legislativeEntityById = new Set();
for (const row of legislative.measures || []) { addEntity("legislative-measure", { ...row, sourceArtifact: "legislative-traceability" }); legislativeEntityById.add(row.id); }
for (const row of legislative.versions || []) { addEntity("legislative-version", { ...row, label: `${row.packageId} ${row.title || ""}`.trim(), sourceArtifact: "legislative-traceability" }); legislativeEntityById.add(row.id); }
for (const row of legislative.committeeReports || []) { addEntity("committee-report", { ...row, sourceArtifact: "legislative-traceability" }); legislativeEntityById.add(row.id); }
for (const row of legislative.enactedProvisions || []) { addEntity("enacted-provision", { ...row, sourceArtifact: "legislative-traceability" }); legislativeEntityById.add(row.id); }
for (const row of legislative.relations || []) {
  if (legislativeEntityById.has(row.from) && legislativeEntityById.has(row.to)) addRelation(row.type, row.from, row.to, evidence("legislative-traceability", row.basis, "exact", row.sourceUrl));
}
const versionsByMeasure = new Map();
for (const row of legislative.versions || []) {
  const rows = versionsByMeasure.get(row.measureId) || [];
  rows.push(row);
  versionsByMeasure.set(row.measureId, rows);
  const sourceId = source(row.sourceUrl, "legislative-traceability", `GovInfo ${row.packageId}`);
  if (sourceId) addRelation("supported-by-source", row.id, sourceId, evidence("legislative-traceability", "official-govinfo-package", "exact", row.sourceUrl));
}
for (const rows of versionsByMeasure.values()) {
  rows.sort((left, right) => String(left.dateIssued || "").localeCompare(String(right.dateIssued || "")) || left.id.localeCompare(right.id));
  for (let index = 1; index < rows.length; index += 1) addRelation("legislative-version-supersedes", rows[index].id, rows[index - 1].id, evidence("legislative-traceability", "official-version-date-order", "deterministic", rows[index].sourceUrl, "reviewed"));
}
for (const row of [...(legislative.measures || []), ...(legislative.committeeReports || []), ...(legislative.enactedProvisions || [])]) {
  const sourceId = source(row.sourceUrl, "legislative-traceability", row.title || row.label);
  if (sourceId) addRelation("supported-by-source", row.id, sourceId, evidence("legislative-traceability", "official-source-url", "exact", row.sourceUrl));
}

const programSourceById = new Map();
for (const row of programIntelligence.sources || []) {
  const id = source(row.url, "program-intelligence", row.title);
  if (id) programSourceById.set(row.id, id);
}
for (const row of programIntelligence.programOffices || []) {
  addEntity("program-office", { ...row, sourceArtifact: "program-intelligence" });
  const organizationId = organization(row.organization, "program-intelligence", {}, { identityClass: "government" });
  if (organizationId) addRelation("program-office-part-of-organization", row.id, organizationId, evidence("program-intelligence", row.identityBasis, "source_declared", "", row.reviewState));
}
for (const row of programIntelligence.programs || []) {
  addEntity("defense-program", { ...row, sourceArtifact: "program-intelligence" });
  const officeId = `program-office:${hash(row.organization)}`;
  if (entityKeys["program-office"].has(officeId)) addRelation("defense-program-owned-by-program-office", row.id, officeId, evidence("program-intelligence", "published-budget-sponsor", "source_declared", "", row.reviewState));
}
for (const row of programIntelligence.programBudgetLines || []) {
  if (entityKeys["defense-program"].has(row.programId) && entityKeys["budget-line"].has(row.budgetLineId)) addRelation("defense-program-represented-by-budget-line", row.programId, row.budgetLineId, evidence("program-intelligence", row.basis, row.basis.startsWith("reviewed") ? "reviewed" : "exact"));
}
for (const row of programIntelligence.historicalBudgetLines || []) {
  addEntity("budget-line", { ...row, sourceArtifact: "program-intelligence" });
  const accountId = accountByTitle.get(normalized(row.accountTitle || row.account));
  if (accountId) addRelation("budget-line-matches-account-title", row.id, accountId, evidence("program-intelligence", "exact-normalized-account-title", "derived", row.sourceUrl, "deterministic"));
  const organizationId = organization(row.organization, "program-intelligence", {}, { identityClass: "government" });
  if (organizationId) addRelation("budget-line-owned-by-organization", row.id, organizationId, evidence("program-intelligence", "published-budget-organization", "source_declared", row.sourceUrl, row.reviewState));
  if (entityKeys["defense-program"].has(row.programId)) addRelation("defense-program-represented-by-budget-line", row.programId, row.id, evidence("program-intelligence", "exact-fy2024-r1-program-element-code", "exact", row.sourceUrl, row.reviewState));
  const sourceId = source(row.sourceUrl, "program-intelligence", `FY2024 R-1 ${row.lineCode}`);
  if (sourceId) addRelation("supported-by-source", row.id, sourceId, evidence("program-intelligence", "official-comptroller-workbook", "exact", row.sourceUrl, row.reviewState));
}
for (const row of programIntelligence.programBaselines || []) {
  addEntity("program-baseline", { ...row, sourceArtifact: "program-intelligence" });
  if (entityKeys["defense-program"].has(row.programId)) addRelation("defense-program-has-baseline", row.programId, row.id, evidence("program-intelligence", "official-presidents-budget-request", "exact", row.sourceUrl, row.reviewState));
  const sourceId = source(row.sourceUrl, "program-intelligence", row.label);
  if (sourceId) addRelation("supported-by-source", row.id, sourceId, evidence("program-intelligence", "official-budget-source", "exact", row.sourceUrl, row.reviewState));
}
const findingRelation = {
  "acquisition-milestone": "defense-program-has-acquisition-milestone",
  "cost-estimate": "defense-program-has-cost-estimate",
  "schedule-event": "defense-program-has-schedule-event",
  "unit-cost-breach": "defense-program-has-unit-cost-breach",
  "test-finding": "defense-program-has-test-finding",
  "program-risk": "defense-program-has-risk",
};
for (const row of programIntelligence.findings || []) {
  addEntity(row.kind, { ...row, sourceArtifact: "program-intelligence" });
  if (entityKeys["defense-program"].has(row.programId)) addRelation(findingRelation[row.kind], row.programId, row.id, evidence("program-intelligence", "official-program-assessment", "source_declared", row.sourceUrl, row.reviewState));
  const sourceId = programSourceById.get(row.sourceId);
  if (sourceId) addRelation("supported-by-source", row.id, sourceId, evidence("program-intelligence", "official-report-finding", "exact", row.sourceUrl, row.reviewState));
}
for (const row of programIntelligence.appropriationMarks || []) {
  addEntity("appropriation-mark", { ...row, sourceArtifact: "program-intelligence" });
  if (entityKeys["budget-line"].has(row.budgetLineId)) addRelation("appropriation-mark-adjusts-budget-line", row.id, row.budgetLineId, evidence("program-intelligence", row.matchBasis, "reviewed", row.sourceUrl, row.reviewState));
  if (entityKeys["defense-program"].has(row.programId)) addRelation("appropriation-mark-affects-defense-program", row.id, row.programId, evidence("program-intelligence", row.matchBasis, "reviewed", row.sourceUrl, row.reviewState));
  if (entityKeys["committee-report"].has(row.reportId)) addRelation("appropriation-mark-recommended-by-report", row.id, row.reportId, evidence("program-intelligence", "exact-report-table-and-page", "exact", row.sourceUrl, row.reviewState));
  if (entityKeys["legislative-measure"].has(row.measureId)) addRelation("appropriation-mark-considered-by-measure", row.id, row.measureId, evidence("program-intelligence", "report-accompanies-exact-measure", "exact", row.sourceUrl, row.reviewState));
  const sourceId = programSourceById.get(row.sourceId);
  if (sourceId) addRelation("supported-by-source", row.id, sourceId, evidence("program-intelligence", "official-report-table-page", "exact", row.sourceUrl, row.reviewState));
}

const roadmapSourceById = new Map();
for (const row of roadmapIntelligence.sources || []) {
  const id = source(row.url, "roadmap-intelligence", row.title || row.label);
  if (id) roadmapSourceById.set(row.id, id);
}
for (const row of roadmapIntelligence.people || []) addEntity("person", { ...row, sourceArtifact: "roadmap-intelligence" });
for (const row of roadmapIntelligence.officialRoles || []) {
  addEntity("official-role", { ...row, sourceArtifact: "roadmap-intelligence" });
  if (entityKeys.person.has(row.personId)) addRelation("person-holds-official-role", row.personId, row.id, evidence("roadmap-intelligence", "official-professional-role", "reviewed", roadmapIntelligence.sources?.find((item) => item.id === row.sourceIds?.[0])?.url || "", row.reviewState));
  const organizationId = organization(row.organizationName, "roadmap-intelligence", {}, { identityClass: "government-office" });
  if (organizationId) addRelation("official-role-at-organization", row.id, organizationId, evidence("roadmap-intelligence", "official-role-organization", "source_declared", roadmapIntelligence.sources?.find((item) => item.id === row.sourceIds?.[0])?.url || "", row.reviewState));
  for (const sourceId of row.sourceIds || []) {
    const graphSourceId = roadmapSourceById.get(sourceId);
    if (graphSourceId) addRelation("supported-by-source", row.id, graphSourceId, evidence("roadmap-intelligence", "official-role-source", "reviewed", roadmapIntelligence.sources?.find((item) => item.id === sourceId)?.url || "", row.reviewState));
  }
}
for (const row of roadmapIntelligence.roleSuccessions || []) {
  addEntity("role-succession", { ...row, sourceArtifact: "roadmap-intelligence" });
  if (entityKeys["official-role"].has(row.predecessorRoleId)) addRelation("role-succession-predecessor", row.id, row.predecessorRoleId, evidence("roadmap-intelligence", "official-change-of-charter", "reviewed", roadmapIntelligence.sources?.find((item) => item.id === row.sourceId)?.url || "", row.reviewState));
  if (entityKeys["official-role"].has(row.successorRoleId)) addRelation("role-succession-successor", row.id, row.successorRoleId, evidence("roadmap-intelligence", "official-change-of-charter", "reviewed", roadmapIntelligence.sources?.find((item) => item.id === row.sourceId)?.url || "", row.reviewState));
}
for (const row of roadmapIntelligence.supplierRelationships || []) {
  addEntity("supplier-relationship", { ...row, sourceArtifact: "roadmap-intelligence" });
  const primeId = organization(row.primeName, "roadmap-intelligence", {}, { identityClass: "recipient" });
  const supplierId = organization(row.supplierName, "roadmap-intelligence", {}, { identityClass: "recipient" });
  if (primeId) addRelation("supplier-relationship-prime", row.id, primeId, evidence("roadmap-intelligence", "sampled-usaspending-prime", "exact", "", row.reviewState));
  if (supplierId) addRelation("supplier-relationship-supplier", row.id, supplierId, evidence("roadmap-intelligence", "sampled-usaspending-subrecipient", "exact", "", row.reviewState));
}
for (const row of roadmapIntelligence.buyerProfiles || []) {
  addEntity("buyer-profile", { ...row, sourceArtifact: "roadmap-intelligence" });
  const organizationId = organization(row.label, "roadmap-intelligence", {}, { identityClass: "government-office" });
  if (organizationId) addRelation("buyer-profile-for-organization", row.id, organizationId, evidence("roadmap-intelligence", row.evidenceBasis, "deterministic", "", row.reviewState));
}
for (const row of roadmapIntelligence.vendorProfiles || []) {
  addEntity("vendor-profile", { ...row, sourceArtifact: "roadmap-intelligence" });
  const organizationId = organization(row.label, "roadmap-intelligence", {}, { identityClass: "recipient" });
  if (organizationId) addRelation("vendor-profile-for-organization", row.id, organizationId, evidence("roadmap-intelligence", row.evidenceBasis, "deterministic", "", row.reviewState));
}
for (const row of roadmapIntelligence.incumbentPositions || []) {
  addEntity("incumbent-position", { ...row, sourceArtifact: "roadmap-intelligence" });
  const activityId = String(row.activityId || "").startsWith("activity:") ? row.activityId : `activity:${row.activityId}`;
  if (entityKeys.activity.has(activityId)) addRelation("incumbent-position-for-activity", row.id, activityId, evidence("roadmap-intelligence", row.evidenceBasis, row.evidenceBasis === "retained-live-award" ? "exact" : "source_declared", row.sourceUrls?.[0] || "", row.reviewState));
  const organizationId = organization(row.organizationName, "roadmap-intelligence", {}, { identityClass: "recipient" });
  if (organizationId) addRelation("incumbent-position-for-organization", row.id, organizationId, evidence("roadmap-intelligence", row.evidenceBasis, row.evidenceBasis === "retained-live-award" ? "exact" : "source_declared", row.sourceUrls?.[0] || "", row.reviewState));
}
for (const row of roadmapIntelligence.programHealthProfiles || []) {
  addEntity("program-health-profile", { ...row, sourceArtifact: "roadmap-intelligence" });
  if (entityKeys["defense-program"].has(row.programId)) addRelation("program-health-profile-summarizes-program", row.id, row.programId, evidence("roadmap-intelligence", "deterministic-retained-evidence-summary", "deterministic", "", row.reviewState));
}
for (const row of roadmapIntelligence.accountabilityFindings || []) {
  addEntity("accountability-finding", { ...row, sourceArtifact: "roadmap-intelligence" });
  if (entityKeys["defense-program"].has(row.targetProgramId)) addRelation("accountability-finding-about-program", row.id, row.targetProgramId, evidence("roadmap-intelligence", "official-program-assessment", "source_declared", row.sourceUrl, row.reviewState));
}
for (const row of roadmapIntelligence.officialDocuments || []) {
  addEntity("official-document", { ...row, sourceArtifact: "roadmap-intelligence" });
  const sourceId = source(row.url, "roadmap-intelligence", row.label);
  if (sourceId) addRelation("supported-by-source", row.id, sourceId, evidence("roadmap-intelligence", "canonical-official-document-url", "exact", row.url, row.reviewState));
}
for (const row of roadmapIntelligence.documentVersions || []) {
  addEntity("document-version", { ...row, sourceArtifact: "roadmap-intelligence" });
  if (entityKeys["official-document"].has(row.documentId)) addRelation("official-document-has-version", row.documentId, row.id, evidence("roadmap-intelligence", row.hashBasis, "deterministic", row.sourceUrl, row.reviewState));
}
for (const row of roadmapIntelligence.documentSections || []) {
  addEntity("document-section", { ...row, sourceArtifact: "roadmap-intelligence" });
  if (entityKeys["official-document"].has(row.documentId)) addRelation("official-document-has-section", row.documentId, row.id, evidence("roadmap-intelligence", row.sectionType, "reviewed", row.sourceUrl, row.reviewState));
}
for (const row of roadmapIntelligence.documentTables || []) {
  addEntity("document-table", { ...row, sourceArtifact: "roadmap-intelligence" });
  if (entityKeys["official-document"].has(row.documentId)) addRelation("official-document-has-table", row.documentId, row.id, evidence("roadmap-intelligence", row.hashBasis, "exact", row.sourceUrl, row.reviewState));
}
for (const row of roadmapIntelligence.citations || []) {
  addEntity("document-citation", { ...row, sourceArtifact: "roadmap-intelligence" });
  if (entityKeys["official-document"].has(row.documentId)) addRelation("official-document-has-citation", row.documentId, row.id, evidence("roadmap-intelligence", row.selectorType, "reviewed", row.sourceUrl, row.reviewState));
  const relationType = { "official-role": "document-citation-supports-official-role", "appropriation-mark": "document-citation-supports-appropriation-mark", "accountability-finding": "document-citation-supports-accountability-finding" }[row.targetType];
  if (relationType && entityKeys[row.targetType]?.has(row.targetId)) addRelation(relationType, row.id, row.targetId, evidence("roadmap-intelligence", row.selectorType, "reviewed", row.sourceUrl, row.reviewState));
}
for (const row of roadmapIntelligence.savedQueryTemplates || []) addEntity("saved-query-template", { ...row, sourceArtifact: "roadmap-intelligence" });
for (const row of roadmapIntelligence.briefTemplates || []) addEntity("brief-template", { ...row, sourceArtifact: "roadmap-intelligence" });

for (const row of organizationIntelligence.dossiers || []) {
  addEntity("organization-dossier", { ...row, sourceArtifact: "organization-intelligence" });
  const organizationId = organization(row.organizationName, "organization-intelligence", {}, { identityClass: row.categories?.includes("vendor") ? "recipient" : "government-office" });
  if (organizationId) addRelation("organization-dossier-for-organization", row.id, organizationId, evidence("organization-intelligence", "bounded-reviewed-dossier", "reviewed", row.sourceUrls?.[0] || "", row.reviewState));
  if (row.parentOrganizationName) {
    const parentId = organization(row.parentOrganizationName, "organization-intelligence", {}, { identityClass: "government" });
    if (parentId) addRelation("organization-dossier-parent-organization", row.id, parentId, evidence("organization-intelligence", "source-declared-or-reviewed-parent", "reviewed", row.sourceUrls?.[0] || "", row.reviewState));
  }
  for (const id of row.roleIds || []) if (entityKeys["official-role"].has(id)) addRelation("organization-dossier-includes-role", row.id, id, evidence("organization-intelligence", "exact-retained-role-id", "exact", "", row.reviewState));
  for (const id of row.personIds || []) if (entityKeys.person.has(id)) addRelation("organization-dossier-includes-person", row.id, id, evidence("organization-intelligence", "exact-retained-person-id", "exact", "", row.reviewState));
  for (const id of row.programIds || []) if (entityKeys["defense-program"].has(id)) addRelation("organization-dossier-includes-program", row.id, id, evidence("organization-intelligence", "exact-retained-program-id", "exact", "", row.reviewState));
  for (const id of row.awardIds || []) {
    const awardId = awardByGeneratedId.get(id) || (entityKeys.award.has(id) ? id : null);
    if (awardId) addRelation("organization-dossier-includes-award", row.id, awardId, evidence("organization-intelligence", "exact-retained-award-id", "exact", `https://www.usaspending.gov/award/${id}/`, row.reviewState));
  }
  for (const id of row.accountIds || []) if (entityKeys["federal-account"].has(id)) addRelation("organization-dossier-includes-account", row.id, id, evidence("organization-intelligence", "exact-retained-account-id", "exact", "", row.reviewState));
  for (const label of row.vendorNames || []) {
    const vendorId = organization(label, "organization-intelligence", {}, { identityClass: "recipient" });
    if (vendorId) addRelation("organization-dossier-includes-vendor", row.id, vendorId, evidence("organization-intelligence", "retained-award-vendor", "deterministic", "", row.reviewState));
  }
  for (const id of row.locationIds || []) if (entityKeys.location.has(id)) addRelation("organization-dossier-includes-location", row.id, id, evidence("organization-intelligence", "reviewed-retained-location-id", "reviewed", "", row.reviewState));
  for (const url of row.sourceUrls || []) {
    const sourceId = source(url, "organization-intelligence", `${row.label} dossier evidence`);
    if (sourceId) addRelation("supported-by-source", row.id, sourceId, evidence("organization-intelligence", "dossier-source-register", "reviewed", url, row.reviewState));
  }
}
for (const row of organizationIntelligence.missionClaims || []) {
  addEntity("organization-mission-claim", { ...row, sourceArtifact: "organization-intelligence" });
  if (entityKeys["organization-dossier"].has(row.dossierId)) addRelation("organization-dossier-has-mission-claim", row.dossierId, row.id, evidence("organization-intelligence", row.claimType, "source_declared", row.sourceUrl, row.reviewState));
  const sourceId = source(row.sourceUrl, "organization-intelligence", row.label);
  if (sourceId) addRelation("supported-by-source", row.id, sourceId, evidence("organization-intelligence", row.claimType, "exact", row.sourceUrl, row.reviewState));
}
for (const row of organizationIntelligence.financialSummaries || []) {
  addEntity("organization-financial-summary", { ...row, sourceArtifact: "organization-intelligence" });
  if (entityKeys["organization-dossier"].has(row.dossierId)) addRelation("organization-dossier-has-financial-summary", row.dossierId, row.id, evidence("organization-intelligence", row.measureType, "deterministic", "", row.reviewState));
}
for (const row of organizationIntelligence.researchGaps || []) {
  addEntity("organization-research-gap", { ...row, sourceArtifact: "organization-intelligence" });
  if (entityKeys["organization-dossier"].has(row.dossierId)) addRelation("organization-dossier-has-research-gap", row.dossierId, row.id, evidence("organization-intelligence", row.gapType, "exact", "", row.reviewState));
}
for (const row of organizationIntelligence.changeEvents || []) {
  addEntity("organization-change-event", { ...row, sourceArtifact: "organization-intelligence" });
  if (entityKeys["organization-dossier"].has(row.dossierId)) addRelation("organization-dossier-has-change-event", row.dossierId, row.id, evidence("organization-intelligence", row.eventType, "reviewed", "", row.reviewState));
}
for (const row of organizationChangeMonitor.sources || []) {
  addEntity("organization-source-monitor", { ...row, sourceArtifact: "organization-change-monitor" });
  const sourceId = source(row.url, "organization-change-monitor", row.label);
  if (sourceId) addRelation("supported-by-source", row.id, sourceId, evidence("organization-change-monitor", "monitored-official-source", "exact", row.url, row.reviewState));
  for (const dossierId of row.linkedDossierIds || []) if (entityKeys["organization-dossier"].has(dossierId)) addRelation("organization-source-monitor-covers-dossier", row.id, dossierId, evidence("organization-change-monitor", "exact-source-url-membership", "exact", row.url, row.reviewState));
}
for (const row of organizationChangeMonitor.sourceObservations || []) {
  addEntity("organization-source-observation", { ...row, sourceArtifact: "organization-change-monitor" });
  if (entityKeys["organization-source-monitor"].has(row.monitorId)) addRelation("organization-source-monitor-has-observation", row.monitorId, row.id, evidence("organization-change-monitor", "content-hash-observation", "deterministic", "", row.reviewState));
}
for (const row of organizationChangeMonitor.proposals || []) {
  addEntity("organization-change-proposal", { ...row, sourceArtifact: "organization-change-monitor" });
  if (row.subjectType === "official-role" && entityKeys["official-role"].has(row.subjectId)) addRelation("organization-change-proposal-targets-role", row.id, row.subjectId, evidence("organization-change-monitor", row.kind, "review_only", "", row.status));
  if (row.subjectType === "organization-dossier" && entityKeys["organization-dossier"].has(row.subjectId)) addRelation("organization-change-proposal-targets-dossier", row.id, row.subjectId, evidence("organization-change-monitor", row.kind, "review_only", "", row.status));
}

for (const row of strategic.forecasts || []) {
  addEntity("acquisition-forecast", { ...row, sourceArtifact: "strategic-intelligence" });
  if (entityKeys.activity.has(row.activityId)) addRelation("activity-has-forecast", row.activityId, row.id, evidence("strategic-intelligence", "source-declared-agency-forecast-channel", row.sourceUrls?.length ? "source_declared" : "deterministic", row.sourceUrls?.[0] || "", row.reviewState));
  for (const url of row.sourceUrls || []) {
    const sourceId = source(url, "strategic-intelligence", `${row.label} forecast source`);
    if (sourceId) addRelation("supported-by-source", row.id, sourceId, evidence("strategic-intelligence", "official-forecast-url", "exact", url, row.reviewState));
  }
}
for (const row of strategic.missionAssignments || []) {
  addEntity("mission-assignment", { ...row, sourceArtifact: "strategic-intelligence" });
  if (entityKeys.location.has(row.locationId)) addRelation("mission-assignment-at-location", row.id, row.locationId, evidence("strategic-intelligence", "reviewed-primary-source-mission", "reviewed", row.sourceUrl, row.reviewState));
  const sourceId = source(row.sourceUrl, "strategic-intelligence", `${row.label} source`);
  if (sourceId) addRelation("supported-by-source", row.id, sourceId, evidence("strategic-intelligence", "reviewed-primary-source", "reviewed", row.sourceUrl, row.reviewState));
}
for (const row of strategic.tenantAssignments || []) {
  addEntity("installation-tenant", { ...row, sourceArtifact: "strategic-intelligence" });
  if (entityKeys.location.has(row.locationId)) addRelation("installation-tenant-at-location", row.id, row.locationId, evidence("strategic-intelligence", "reviewed-organization-location", "reviewed", row.sourceUrl, row.reviewState));
  const organizationId = organization(row.organizationName, "strategic-intelligence", {}, { identityClass: "government" });
  if (organizationId) addRelation("installation-tenant-organization", row.id, organizationId, evidence("strategic-intelligence", "reviewed-primary-source-organization", "reviewed", row.sourceUrl, row.reviewState));
  const sourceId = source(row.sourceUrl, "strategic-intelligence", `${row.organizationName} source`);
  if (sourceId) addRelation("supported-by-source", row.id, sourceId, evidence("strategic-intelligence", "reviewed-primary-source", "reviewed", row.sourceUrl, row.reviewState));
}
for (const row of strategic.competitiveSignals || []) {
  addEntity("competitive-signal", { ...row, sourceArtifact: "strategic-intelligence" });
  if (entityKeys.activity.has(row.targetId)) addRelation("activity-has-competitive-signal", row.targetId, row.id, evidence("strategic-intelligence", "published-forecast-competition-posture", "source_declared", row.sourceUrls?.[0] || "", row.reviewState));
}
for (const row of strategic.expirationSignals || []) {
  addEntity("expiration-signal", { ...row, sourceArtifact: "strategic-intelligence" });
  if (entityKeys.award.has(row.targetAwardId)) addRelation("award-has-expiration-signal", row.targetAwardId, row.id, evidence("strategic-intelligence", "deterministic-reported-end-date-horizon", "deterministic", row.sourceUrl, row.reviewState));
}
for (const row of strategic.executionRiskSignals || []) {
  addEntity("execution-risk-signal", { ...row, sourceArtifact: "strategic-intelligence" });
  if (entityKeys["execution-balance"].has(row.targetBalanceId)) addRelation("execution-balance-has-risk-signal", row.targetBalanceId, row.id, evidence("strategic-intelligence", "deterministic-unobligated-share-threshold", "deterministic", row.sourceUrl, row.reviewState));
}
for (const row of strategic.outcomeEvidence || []) {
  addEntity("outcome-evidence", { ...row, sourceArtifact: "strategic-intelligence" });
  if (entityKeys.activity.has(row.targetActivityId)) addRelation("activity-has-outcome-evidence", row.targetActivityId, row.id, evidence("strategic-intelligence", "observed-award-or-transaction-activity", "exact", row.sourceUrls?.[0] || "", row.reviewState));
  if (row.awardId && entityKeys.award.has(row.awardId)) addRelation("outcome-evidence-award", row.id, row.awardId, evidence("strategic-intelligence", "exact-generated-award-id", "exact", row.sourceUrls?.[0] || "", row.reviewState));
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
  cageIdentities: new Set(relations.filter((item) => item.type === "organization-has-identifier" && item.attributes?.namespace === "cage").map((item) => item.from)).size,
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
  samBackbone,
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
      spending: {
        firstFiscalYear: spendingCoverage.metadata?.firstFiscalYear,
        lastFiscalYear: spendingCoverage.metadata?.lastFiscalYear,
        annualTotals: (spendingCoverage.annualTotals || []).length,
        observations: entities["spending-observation"].length,
        uniqueRankedAwards: spendingCoverage.metadata?.coverage?.uniqueRankedAwards || 0,
        categoryRows: (spendingCoverage.years || []).reduce((total, year) => total + Object.values(year.categories || {}).reduce((sum, rows) => sum + rows.length, 0), 0),
        scope: spendingCoverage.metadata?.scope,
        amountPolicy: spendingCoverage.metadata?.amountPolicy,
      },
      acquisition: {
        status: samBackbone.metadata?.status,
        notices: entities["opportunity-notice"].length,
        noticeVersions: entities["notice-version"].length,
        awardActions: entities["award-action"].length,
        vendorRegistrations: entities["vendor-registration"].length,
        businessCertifications: entities["business-certification"].length,
        hierarchyObservations: entities["organization-hierarchy-observation"].length,
        subawards: entities.subaward.length,
        sourceCoverage: samBackbone.coverage,
      },
      money: {
        firstFiscalYear: accountSpine.metadata?.historyFiscalYears?.[0],
        lastFiscalYear: accountSpine.metadata?.historyFiscalYears?.at(-1),
        federalAccountSnapshots: accountSpine.accountSnapshots?.length || 0,
        treasuryAccounts: entities["treasury-account"].length,
        executionBalances: entities["execution-balance"].length,
        apportionmentRevisions: entities["apportionment-revision"].length,
        programActivities: entities["program-activity"].length,
        objectClasses: entities["object-class"].length,
        treasuryOutlayObservations: entities["treasury-outlay-observation"].length,
        exactAwardAccountLinks: relations.filter((item) => item.type === "award-funded-by-account").length,
        amountPolicy: accountSpine.metadata?.amountPolicy,
      },
      legislation: {
        measures: entities["legislative-measure"].length,
        versions: entities["legislative-version"].length,
        committeeReports: entities["committee-report"].length,
        enactedProvisions: entities["enacted-provision"].length,
        appropriationMarks: entities["appropriation-mark"].length,
        exactTraceabilityRelations: relations.filter((item) => ["measure-has-version", "measure-backed-by-report", "measure-enacted-as"].includes(item.type)).length,
        caveat: legislative.metadata?.caveat,
      },
      programs: {
        defensePrograms: entities["defense-program"].length,
        programOffices: entities["program-office"].length,
        requestBaselines: entities["program-baseline"].length,
        costEstimates: entities["cost-estimate"].length,
        scheduleEvents: entities["schedule-event"].length,
        acquisitionMilestones: entities["acquisition-milestone"].length,
        unitCostBreaches: entities["unit-cost-breach"].length,
        testFindings: entities["test-finding"].length,
        programRisks: entities["program-risk"].length,
        pageCitedAppropriationMarks: entities["appropriation-mark"].length,
        changedAppropriationMarks: (programIntelligence.appropriationMarks || []).filter((row) => row.changeAmountThousands !== 0).length,
        evidenceBoundary: programIntelligence.metadata?.evidenceBoundary,
      },
      people: {
        people: entities.person.length,
        officialRoles: entities["official-role"].length,
        successions: entities["role-succession"].length,
        observedCurrentRoles: roadmapIntelligence.metadata?.coverage?.observedCurrentRoles || 0,
        evidenceBoundary: roadmapIntelligence.metadata?.evidenceBoundary,
      },
      organizationIntelligence: {
        dossiers: entities["organization-dossier"].length,
        tier1: organizationIntelligence.metadata?.coverage?.tier1 || 0,
        missionClaims: entities["organization-mission-claim"].length,
        financialSummaries: entities["organization-financial-summary"].length,
        researchGaps: entities["organization-research-gap"].length,
        changeEvents: entities["organization-change-event"].length,
        dossiersWithLeadership: organizationIntelligence.metadata?.coverage?.dossiersWithLeadership || 0,
        dossiersWithMission: organizationIntelligence.metadata?.coverage?.dossiersWithMission || 0,
        dossiersWithFinance: organizationIntelligence.metadata?.coverage?.dossiersWithFinance || 0,
        monitoredSources: organizationChangeMonitor.metadata?.coverage?.monitoredSources || 0,
        changedSources: organizationChangeMonitor.metadata?.coverage?.changedSources || 0,
        reviewProposals: organizationChangeMonitor.metadata?.coverage?.reviewProposals || 0,
        evidenceBoundary: organizationIntelligence.metadata?.evidenceBoundary,
      },
      industrialBase: {
        supplierRelationships: entities["supplier-relationship"].length,
        buyerProfiles: entities["buyer-profile"].length,
        vendorProfiles: entities["vendor-profile"].length,
        incumbentPositions: entities["incumbent-position"].length,
        coverageState: roadmapIntelligence.metadata?.sourceStates?.industrialBase,
      },
      accountability: {
        programHealthProfiles: entities["program-health-profile"].length,
        findings: entities["accountability-finding"].length,
        correctiveActions: roadmapIntelligence.metadata?.coverage?.correctiveActions || 0,
        protestDecisions: roadmapIntelligence.metadata?.coverage?.protestDecisions || 0,
        auditFindings: roadmapIntelligence.metadata?.coverage?.auditFindings || 0,
      },
      documents: {
        officialDocuments: entities["official-document"].length,
        versions: entities["document-version"].length,
        sections: entities["document-section"].length,
        tables: entities["document-table"].length,
        citations: entities["document-citation"].length,
        embeddings: roadmapIntelligence.metadata?.coverage?.embeddings || 0,
      },
      operations: {
        savedQueryTemplates: entities["saved-query-template"].length,
        briefTemplates: entities["brief-template"].length,
        publicationPolicy: "review-before-send",
      },
      market: {
        acquisitionForecasts: entities["acquisition-forecast"].length,
        reviewedMissionAssignments: entities["mission-assignment"].length,
        reviewedTenantAssignments: entities["installation-tenant"].length,
        sbirTopics: entities["sbir-topic"].length,
        sbirAwards: entities["sbir-award"].length,
        sourceHealth: strategic.sourceHealth,
      },
      signals: {
        competitive: entities["competitive-signal"].length,
        expiration: entities["expiration-signal"].length,
        executionRisk: entities["execution-risk-signal"].length,
        protests: entities["protest-decision"].length,
        audits: entities["audit-finding"].length,
        outcomes: entities["outcome-evidence"].length,
        promotionPolicy: strategic.metadata?.promotionPolicy,
      },
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
      treasuryAccount: "Exact Treasury account symbol (TAS/TAFS) published as a child of a USAspending federal account.",
      apportionmentRevision: "Fiscal year plus TAFS plus OMB iteration. Every retained revision remains source-linked; newer revisions do not erase prior approvals.",
      executionBalance: "Fiscal year plus exact TAS. Obligations, outlays, approved apportionment, and availability remain separate measures.",
      programActivity: "Fiscal year plus source-published USAspending program-activity label. It remains agency-scoped unless an exact account relationship is published.",
      objectClass: "Fiscal year plus source-published USAspending object-class label. It remains agency-scoped unless an exact account relationship is published.",
      treasuryOutlayObservation: "Monthly Treasury Statement publication date for the Department of Defense military-program total.",
      opportunityNotice: "Stable SAM.gov notice ID. Observed versions preserve change history without claiming the complete Data Services archive.",
      awardAction: "SAM.gov contract transaction key, or PIID plus modification number plus action date when the source key is absent.",
      vendorRegistration: "Exact SAM UEI registration observation. CAGE and public business attributes remain source claims with observation dates.",
      spendingObservation: "Fiscal year plus dimension plus exact published category identifier from the USAspending transaction aggregation endpoints.",
      legislativeMeasure: "Congress plus exact bill type and bill number from GovInfo/Congress.gov.",
      legislativeVersion: "Exact GovInfo package identifier. Version chronology never substitutes for legal effect.",
      committeeReport: "Exact GovInfo committee-report package identifier. A report links to a measure only when the published title contains the exact bill citation.",
      enactedProvision: "Exact GovInfo package identity or Congress.gov public/private law identity.",
      programElement: "Exact R-1 program-element code scoped by budget organization.",
      project: "Exact C-1 project/line identity scoped by budget organization.",
      defenseProgram: "Exact R-1, P-1, or C-1 identity scoped by budget organization, except for explicitly reviewed public aliases. Program portfolios remain separate from individual programs.",
      programOffice: "Source-published budget sponsor by default. A PEO or program-management office is not asserted until an official role source is retained.",
      programBaseline: "A source-published President's Budget request baseline. It is not an Acquisition Program Baseline or independent cost estimate.",
      programAssessment: "Cost, schedule, risk, test, milestone, and breach observations retain their official report source and never inherit from portfolio findings unless the source names the program.",
      appropriationMark: "Official chamber recommendation linked by account, printed line number, request amount, table, and page. It is not enacted authority.",
      person: "Public professional identity used only to connect an official role to cited government evidence. No private profile or inferred employment history.",
      officialRole: "Officially published professional role with exact dates when stated and an observed-current lower bound otherwise.",
      roleSuccession: "A source-published transfer or change of charter connecting exact predecessor and successor role records.",
      organizationDossier: "A bounded projection of retained public evidence for one reviewed organization identity. Missing coverage remains an explicit research gap.",
      organizationMissionClaim: "A source-published mission, charter, or jurisdiction claim with observation date and official URL.",
      organizationFinancialSummary: "A typed financial measure whose semantics remain explicit; request, obligation, outlay, award value, and ceiling are never conflated.",
      organizationResearchGap: "An unresolved evidence need with priority, status, and review state. Missing evidence is not represented as a negative fact.",
      organizationChangeEvent: "A dated, source-backed change or observation retained in the organization timeline.",
      supplierRelationship: "A bounded prime-to-subrecipient relationship from retained USAspending subaward evidence; it is not a complete supplier registry.",
      marketProfile: "A deterministic summary of retained award evidence. Concentration and share values describe the retained corpus, not the entire federal market.",
      accountabilityFinding: "An official program finding retained with its source and resolution state. Missing public findings do not imply a clean record.",
      officialDocument: "Canonical official publication identity with observed versions, sections, tables, hashes, and exact citations where retained.",
      documentCitation: "A typed selector from an official document to one supported graph fact. Metadata hashes are not represented as source-byte hashes.",
      operationalTemplate: "A reusable query or brief definition. Templates require review before external publication or delivery.",
      acquisitionForecast: "Source-declared agency forecast record retained separately from solicitations and notices.",
      missionAssignment: "Reviewed installation mission claim with an authoritative primary source.",
      signal: "Deterministic, dated review trigger with retained inputs and caveat. Signals are not canonical outcome facts.",
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
rmSync(AGENT_GRAPH_DIR, { recursive: true, force: true });
mkdirSync(AGENT_GRAPH_DIR, { recursive: true });
const graphJson = JSON.stringify(graph);
writeFileSync(OUT_FILE, graphJson);
writeFileSync(OUT_GZIP_FILE, gzipSync(graphJson, { level: 9 }));
if (existsSync(LEGACY_GZIP_FILE)) rmSync(LEGACY_GZIP_FILE);
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

const entityTypeById = new Map(Object.entries(entities).flatMap(([type, rows]) => rows.map((row) => [row.id, type])));
const relationShards = Object.fromEntries(INTELLIGENCE_ENTITY_TYPES.map((type) => [type, []]));
const AGENT_RELATION_PAGE_SIZE = 4_000;
for (const relation of relations) {
  const fromType = entityTypeById.get(relation.from);
  const toType = entityTypeById.get(relation.to);
  if (fromType) relationShards[fromType].push(relation);
  if (toType && toType !== fromType) relationShards[toType].push(relation);
}
const agentGraphManifest = {
  metadata: {
    schemaVersion: "1.1.0",
    graphSchemaVersion: INTELLIGENCE_GRAPH_SCHEMA_VERSION,
    generatedAt: graph.metadata.generatedAt,
    asOf: graph.metadata.asOf,
    title: "Agent API graph directory",
    authorityBoundary: graph.metadata.authorityBoundary,
  },
  domain: graph.domain,
  totals: graphSummary.totals,
  entityTypes: Object.fromEntries(INTELLIGENCE_ENTITY_TYPES.map((type) => [type, {
    count: entities[type].length,
    entityPath: `/data/agent-graph/entities-${type}.json`,
    relationPaths: Array.from({ length: Math.max(1, Math.ceil(relationShards[type].length / AGENT_RELATION_PAGE_SIZE)) }, (_, index) =>
      `/data/agent-graph/relations-${type}-${String(index + 1).padStart(3, "0")}.json`),
    relationCount: relationShards[type].length,
  }])),
};
writeFileSync(resolve(AGENT_GRAPH_DIR, "manifest.json"), JSON.stringify(agentGraphManifest));
for (const type of INTELLIGENCE_ENTITY_TYPES) {
  writeFileSync(resolve(AGENT_GRAPH_DIR, `entities-${type}.json`), JSON.stringify({
    metadata: agentGraphManifest.metadata,
    entityType: type,
    total: entities[type].length,
    entities: entities[type],
  }));
  const relationPages = agentGraphManifest.entityTypes[type].relationPaths;
  for (const [index, relationPath] of relationPages.entries()) {
    writeFileSync(resolve(ROOT, `public${relationPath}`), JSON.stringify({
      metadata: agentGraphManifest.metadata,
      entityType: type,
      total: relationShards[type].length,
      page: index + 1,
      pages: relationPages.length,
      relations: relationShards[type].slice(index * AGENT_RELATION_PAGE_SIZE, (index + 1) * AGENT_RELATION_PAGE_SIZE),
    }));
  }
}
const agentGraphBytes = Object.values(agentGraphManifest.entityTypes).reduce((total, item) => total
  + readFileSync(resolve(ROOT, `public${item.entityPath}`)).byteLength
  + item.relationPaths.reduce((sum, path) => sum + readFileSync(resolve(ROOT, `public${path}`)).byteLength, 0), readFileSync(resolve(AGENT_GRAPH_DIR, "manifest.json")).byteLength);

console.log(JSON.stringify({ output: OUT_FILE, bytes: readFileSync(OUT_FILE).byteLength, compressedOutput: OUT_GZIP_FILE, compressedBytes: readFileSync(OUT_GZIP_FILE).byteLength, index: INDEX_FILE, indexBytes: readFileSync(INDEX_FILE).byteLength, contractLineageIndex: CONTRACT_LINEAGE_INDEX_FILE, contractLineageIndexBytes: readFileSync(CONTRACT_LINEAGE_INDEX_FILE).byteLength, temporalEvidenceIndex: TEMPORAL_EVIDENCE_INDEX_FILE, temporalEvidenceIndexBytes: readFileSync(TEMPORAL_EVIDENCE_INDEX_FILE).byteLength, summary: SUMMARY_FILE, summaryBytes: readFileSync(SUMMARY_FILE).byteLength, agentGraphDirectory: AGENT_GRAPH_DIR, agentGraphBytes, organizationReview: ORGANIZATION_REVIEW_FILE, organizationReviewBytes: readFileSync(ORGANIZATION_REVIEW_FILE).byteLength, contractLineageReview: CONTRACT_LINEAGE_REVIEW_FILE, contractLineageReviewBytes: readFileSync(CONTRACT_LINEAGE_REVIEW_FILE).byteLength, temporalEvidenceReview: TEMPORAL_EVIDENCE_REVIEW_FILE, temporalEvidenceReviewBytes: readFileSync(TEMPORAL_EVIDENCE_REVIEW_FILE).byteLength, metadata: graph.metadata }, null, 2));
