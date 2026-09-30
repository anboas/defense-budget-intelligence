import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { applyProcurementChanges, assembleProcurementRecords, attachContractMonitor } from "../src/procurement-taxonomy.js";
import {
  MAP_RELATION_TYPES,
  opportunityMapDomainDescriptor,
  OPPORTUNITY_MAP_SCHEMA_VERSION,
  validateOpportunityMapLocationMetadata,
  validateOpportunityMapLocations,
} from "../src/opportunity-map-domain.js";
import { resolveOrganizationLocation } from "../src/organization-locations.js";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SOURCE_FILE = resolve(ROOT, "src/data/budget-intelligence.json");
const ACCOUNT_SPINE_FILE = resolve(ROOT, "src/data/account-spine.json");
const PRIORITY_AWARD_ACTIONS_FILE = resolve(ROOT, "src/data/priority-award-actions.json");
const LEGISLATIVE_TRACEABILITY_FILE = resolve(ROOT, "src/data/legislative-traceability.json");
const STRATEGIC_INTELLIGENCE_FILE = resolve(ROOT, "src/data/strategic-intelligence.json");
const CAPTURE_CALENDAR_FILE = resolve(ROOT, "src/data/capture-calendar.json");
const CAPTURE_TRANSACTIONS_FILE = resolve(ROOT, "src/data/capture-transactions.json");
const SAM_OPPORTUNITIES_FILE = resolve(ROOT, "src/data/sam-opportunities.json");
const SAM_ACQUISITION_BACKBONE_FILE = resolve(ROOT, "src/data/sam-acquisition-backbone.json");
const MANUAL_PROCUREMENT_FILE = resolve(ROOT, "src/data/manual-procurement.json");
const PROCUREMENT_DELTA_FILE = resolve(ROOT, "src/data/procurement-delta.json");
const PROCUREMENT_DISCOVERY_FILE = resolve(ROOT, "src/data/procurement-discovery.json");
const PROCUREMENT_FEED_FILE = resolve(ROOT, "src/data/procurement-feed.json");
const SUBAWARDS_FILE = resolve(ROOT, "src/data/usaspending-subawards.json");
const USASPENDING_COVERAGE_FILE = resolve(ROOT, "src/data/usaspending-coverage.json");
const CONTRACT_MONITOR_FILE = resolve(ROOT, "src/data/contract-monitor.json");
const MAP_LOCATIONS_FILE = resolve(ROOT, "src/data/opportunity-map-locations.json");
const MAP_LOCATION_METADATA_FILE = resolve(ROOT, "src/data/opportunity-map-location-metadata.json");
const OUT_DIR = resolve(ROOT, "public/data");

const source = JSON.parse(readFileSync(SOURCE_FILE, "utf8"));
const captureCalendar = JSON.parse(readFileSync(CAPTURE_CALENDAR_FILE, "utf8"));
const captureTransactions = JSON.parse(readFileSync(CAPTURE_TRANSACTIONS_FILE, "utf8"));
const subawards = JSON.parse(readFileSync(SUBAWARDS_FILE, "utf8"));
const contractMonitor = JSON.parse(readFileSync(CONTRACT_MONITOR_FILE, "utf8"));
const mapLocationSnapshot = JSON.parse(readFileSync(MAP_LOCATIONS_FILE, "utf8"));
const mapLocations = validateOpportunityMapLocations(mapLocationSnapshot);
const mapLocationIds = new Set(mapLocations.map((location) => location.id));
const mapLocationMetadata = JSON.parse(readFileSync(MAP_LOCATION_METADATA_FILE, "utf8"));
validateOpportunityMapLocationMetadata(mapLocationMetadata, mapLocationIds);
const captureIds = new Set(captureCalendar.records.map((record) => record.opportunityId));
if (captureCalendar.records.length < 190 || captureIds.size !== captureCalendar.records.length) {
  throw new Error("Capture calendar must contain at least 190 unique public records");
}
if (captureCalendar.metadata?.coverage?.publicRows !== captureCalendar.records.length) {
  throw new Error("Capture calendar metadata does not match its published records");
}
if (captureCalendar.metadata?.coverage?.normalizedEvents !== 502 || captureCalendar.metadata?.coverage?.fpdsActions !== 3085) {
  throw new Error("Capture calendar normalized event or FPDS action coverage changed");
}
if (captureTransactions.metadata?.actionCount !== 3085) {
  throw new Error("Capture transaction payload must contain 3,085 exact FPDS actions");
}
if (contractMonitor.metadata?.targetCount !== contractMonitor.records?.length || contractMonitor.metadata?.targetCount < 500) {
  throw new Error("Contract monitor must cover the complete known active, upcoming, option-horizon, and unresolved-schedule universe");
}
if (new Set(contractMonitor.records.map((record) => record.opportunityId)).size !== contractMonitor.records.length) {
  throw new Error("Contract monitor records must retain unique stable opportunity IDs");
}
const subawardPrimeIds = new Set((subawards.primes || []).map((prime) => prime.primeAwardId));
const currentAwardIds = new Set(source.metadata?.dataInventory?.strategyAnalytics?.executionAnalytics?.awardDrilldown?.awards?.map((award) => award.id) || []);
if (subawards.metadata?.checkedPrimeCount < Math.min(currentAwardIds.size, 500) || !subawardPrimeIds.size) {
  throw new Error("Subaward snapshot must cover a disclosed bounded set of indexed USAspending prime awards");
}
if ([...subawardPrimeIds].some((primeAwardId) => !currentAwardIds.has(primeAwardId))) {
  throw new Error("Subaward snapshot contains an unknown prime-award identifier");
}
if (captureCalendar.records.some((record) => "statusLabel" in record || "note" in record || "visibility" in record || "targetIds" in record || "captureMotion" in record)) {
  throw new Error("Capture calendar contains private parser fields");
}
if (/OUR AWARD \/ DELIVERY-LED EXPANSION|ACTIVE TEAMED BID|Targets A1|campaign qualification/i.test(JSON.stringify(captureCalendar.records))) {
  throw new Error("Capture calendar contains internal campaign language");
}
const { strategyAnalytics = {}, ...coreInventory } =
  source.metadata?.dataInventory || {};
const execution = {
  metadata: {
    generatedAt: source.metadata?.generatedAt,
    methodology: strategyAnalytics.executionAnalytics?.coverage?.methodology
      || "Cached USAspending award records with deterministic deduplication.",
  },
  coverage: strategyAnalytics.executionAnalytics?.coverage || {},
  awardDrilldown: strategyAnalytics.executionAnalytics?.awardDrilldown || {},
};
const procurementDelta = JSON.parse(readFileSync(PROCUREMENT_DELTA_FILE, "utf8"));
const procurementDiscovery = JSON.parse(readFileSync(PROCUREMENT_DISCOVERY_FILE, "utf8"));
const agentRecords = applyProcurementChanges(
  attachContractMonitor(assembleProcurementRecords(
    captureCalendar.records,
    execution.awardDrilldown?.awards || [],
    captureCalendar.metadata?.asOf,
    JSON.parse(readFileSync(SAM_OPPORTUNITIES_FILE, "utf8")).records || [],
    JSON.parse(readFileSync(MANUAL_PROCUREMENT_FILE, "utf8")).records || [],
    subawards,
  ), contractMonitor),
  procurementDelta.records || [],
  procurementDiscovery.discovery || [],
);
if (agentRecords.length < 875 || new Set(agentRecords.map((record) => record.opportunityId)).size !== agentRecords.length) {
  throw new Error("Agent record index must contain at least 875 unique stable records");
}

function mapLifecycle(record, asOf) {
  const monitored = record.automationCoverage?.lifecycle;
  if (monitored === "active") return "active";
  if (["upcoming", "option-horizon"].includes(monitored)) return "upcoming";
  const lifecycle = String(record.lifecycleStatus || "");
  if (lifecycle === "active-reported-term") return "active";
  if (lifecycle === "option-horizon-unconfirmed") return "upcoming";
  const nextDate = [record.solicitationStart, record.solicitationEnd, ...(record.events || []).flatMap((event) => [event.start, event.end])]
    .filter((value) => value && value >= asOf).sort()[0];
  if (record.mode === "acquisition-window" && nextDate) return "upcoming";
  if (["historical-term", "past-published-milestone"].includes(lifecycle)) return "historical";
  return "unresolved";
}

function mapOffice(record, dimension) {
  const observation = record.automationCoverage?.observation;
  const exact = dimension === "funding" ? observation?.fundingOffice : observation?.awardingOffice;
  if (exact) return { name: exact, basis: "exact-award-detail" };
  const published = dimension === "funding"
    ? (record.automatedImport ? record.liveAward?.fundingOffice : record.fundingOffice || record.owner)
    : (record.automatedImport ? record.liveAward?.awardingOffice : record.contractingOffice || record.owner);
  return published ? { name: published, basis: "published-source-office" } : { name: "", basis: "unresolved" };
}

const opportunityMapRecords = agentRecords.map((record) => {
  const observation = record.automationCoverage?.observation;
  const contracting = mapOffice(record, "contracting");
  const funding = mapOffice(record, "funding");
  const contractingLocationId = resolveOrganizationLocation(contracting.name)?.locationId || null;
  const fundingLocationId = resolveOrganizationLocation(funding.name)?.locationId || null;
  const nextDate = [
    record.solicitationStart,
    record.solicitationEnd,
    observation?.currentEndDate,
    observation?.potentialEndDate,
    record.currentEnd,
    record.potentialEnd,
    ...(record.events || []).flatMap((event) => [event.start, event.end]),
  ].filter((value) => value && value >= captureCalendar.metadata.asOf).sort()[0] || "";
  const relations = [
    contractingLocationId ? { type: MAP_RELATION_TYPES.contractingActivityAt, activityId: record.opportunityId, locationId: contractingLocationId, evidenceBasis: contracting.basis } : null,
    fundingLocationId ? { type: MAP_RELATION_TYPES.fundingActivityAt, activityId: record.opportunityId, locationId: fundingLocationId, evidenceBasis: funding.basis } : null,
  ].filter(Boolean);
  return {
    opportunityId: record.opportunityId,
    id: record.id,
    sourceSystem: record.sourceSystem,
    mode: record.mode,
    title: record.title,
    portfolio: record.portfolio,
    party: record.party,
    reference: record.reference,
    workCategory: record.workCategory,
    lifecycle: mapLifecycle(record, captureCalendar.metadata.asOf),
    nextDate,
    contractingOffice: contracting.name,
    contractingOfficeBasis: contracting.basis,
    contractingLocationId,
    fundingOffice: funding.name,
    fundingOfficeBasis: funding.basis,
    fundingLocationId,
    relations,
    obligatedAmount: Number(observation?.obligatedAmount ?? record.liveAward?.awardAmountDollars ?? record.obligatedAmount ?? record.fpdsObligatedAmount ?? 0),
    potentialAmount: Number(observation?.potentialAmount ?? record.potentialAmount ?? record.valueHigh ?? record.liveAward?.potentialAmountDollars ?? 0),
    monitorStatus: record.automationCoverage?.status || "not-targeted",
    monitorCheckedAt: record.automationCoverage?.checkedAt || null,
  };
});

const mapRelations = opportunityMapRecords.flatMap((record) => record.relations);
if (mapRelations.some((relation) => !mapLocationIds.has(relation.locationId))) {
  throw new Error("Opportunity Map activity relationship references an unknown location entity");
}
if (mapRelations.some((relation) => !Object.values(MAP_RELATION_TYPES).includes(relation.type))) {
  throw new Error("Opportunity Map activity relationship uses an unknown domain type");
}

const opportunityMapData = {
  metadata: {
    schemaVersion: OPPORTUNITY_MAP_SCHEMA_VERSION,
    generatedAt: contractMonitor.metadata?.generatedAt || source.metadata?.generatedAt,
    asOf: captureCalendar.metadata?.asOf,
    recordCount: agentRecords.length,
    monitorTargetCount: contractMonitor.metadata?.targetCount || 0,
    monitorCoveredCount: contractMonitor.metadata?.coveredCount || 0,
    monitorCoveragePercent: contractMonitor.metadata?.coveragePercent || 0,
    sourceScope: execution.coverage?.methodology || "Published USAspending award records and reviewed acquisition sources.",
    locationCount: mapLocations.length,
    locationAuditedAt: mapLocationSnapshot.metadata?.auditedAt,
    locationSourceScope: mapLocationSnapshot.metadata?.sourceScope,
    locationMetadata: mapLocationMetadata.metadata,
  },
  domain: opportunityMapDomainDescriptor(),
  locations: mapLocations,
  records: opportunityMapRecords,
};
const core = {
  metadata: {
    ...source.metadata,
    dataInventory: coreInventory,
  },
  signals: source.signals || [],
  records: source.records || [],
};

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(resolve(OUT_DIR, "budget-core.json"), JSON.stringify(core));
writeFileSync(resolve(OUT_DIR, "runtime-manifest.json"), JSON.stringify({
  metadata: {
    generatedAt: source.metadata?.generatedAt,
    methodology: source.metadata?.methodology,
    recordCount: core.records.length,
  },
}));
rmSync(resolve(OUT_DIR, "budget-strategy.json"), { force: true });
writeFileSync(resolve(OUT_DIR, "budget-execution.json"), JSON.stringify(execution));
writeFileSync(resolve(OUT_DIR, "opportunity-map-data.json"), JSON.stringify(opportunityMapData));
writeFileSync(resolve(OUT_DIR, "opportunity-map-location-metadata.json"), JSON.stringify(mapLocationMetadata));
writeFileSync(
  resolve(OUT_DIR, "account-spine.json"),
  readFileSync(ACCOUNT_SPINE_FILE, "utf8"),
);
writeFileSync(resolve(OUT_DIR, "priority-award-actions.json"), readFileSync(PRIORITY_AWARD_ACTIONS_FILE, "utf8"));
writeFileSync(resolve(OUT_DIR, "legislative-traceability.json"), readFileSync(LEGISLATIVE_TRACEABILITY_FILE, "utf8"));
writeFileSync(resolve(OUT_DIR, "strategic-intelligence.json"), readFileSync(STRATEGIC_INTELLIGENCE_FILE, "utf8"));
writeFileSync(
  resolve(OUT_DIR, "capture-calendar.json"),
  JSON.stringify(captureCalendar),
);
writeFileSync(
  resolve(OUT_DIR, "agent-records.json"),
  JSON.stringify({
    metadata: {
      generatedAt: source.metadata?.generatedAt,
      asOf: captureCalendar.metadata?.asOf,
      recordCount: agentRecords.length,
      relationship: "Stable opportunityId across the factual analytics application",
    },
    records: agentRecords,
  }),
);
writeFileSync(
  resolve(OUT_DIR, "capture-transactions.json"),
  JSON.stringify(captureTransactions),
);
writeFileSync(
  resolve(OUT_DIR, "sam-opportunities.json"),
  readFileSync(SAM_OPPORTUNITIES_FILE, "utf8"),
);
writeFileSync(
  resolve(OUT_DIR, "sam-acquisition-backbone.json"),
  readFileSync(SAM_ACQUISITION_BACKBONE_FILE, "utf8"),
);
writeFileSync(
  resolve(OUT_DIR, "manual-procurement.json"),
  readFileSync(MANUAL_PROCUREMENT_FILE, "utf8"),
);
writeFileSync(
  resolve(OUT_DIR, "procurement-delta.json"),
  readFileSync(PROCUREMENT_DELTA_FILE, "utf8"),
);
writeFileSync(
  resolve(OUT_DIR, "procurement-discovery.json"),
  readFileSync(PROCUREMENT_DISCOVERY_FILE, "utf8"),
);
writeFileSync(
  resolve(OUT_DIR, "procurement-feed.json"),
  readFileSync(PROCUREMENT_FEED_FILE, "utf8"),
);
writeFileSync(
  resolve(OUT_DIR, "contract-monitor.json"),
  readFileSync(CONTRACT_MONITOR_FILE, "utf8"),
);
writeFileSync(
  resolve(OUT_DIR, "usaspending-subawards.json"),
  JSON.stringify({
    metadata: subawards.metadata,
    primes: (subawards.primes || []).map(({ subawards: _details, ...prime }) => prime),
  }),
);
writeFileSync(
  resolve(OUT_DIR, "usaspending-subaward-details.json"),
  JSON.stringify({
    metadata: {
      generatedAt: subawards.metadata?.generatedAt,
      retainedDetailCount: subawards.metadata?.retainedDetailCount || 0,
      detailLimitPerPrime: subawards.metadata?.detailLimitPerPrime || 0,
      relationship: "Exact USAspending generated prime-award ID",
    },
    byPrime: Object.fromEntries(
      (subawards.primes || [])
        .filter((prime) => prime.subawards?.length)
        .map((prime) => [prime.primeAwardId, prime.subawards]),
    ),
  }),
);
writeFileSync(
  resolve(OUT_DIR, "usaspending-coverage.json"),
  readFileSync(USASPENDING_COVERAGE_FILE, "utf8"),
);

console.log(
  `Built runtime data: core=${Buffer.byteLength(JSON.stringify(core))} bytes execution=${Buffer.byteLength(JSON.stringify(execution))} bytes map=${Buffer.byteLength(JSON.stringify(opportunityMapData))} bytes/${opportunityMapData.records.length} records capture=${captureCalendar.records.length} records/${captureTransactions.metadata.actionCount} actions`,
);
