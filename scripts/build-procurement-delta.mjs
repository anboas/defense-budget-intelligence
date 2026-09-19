import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assembleProcurementRecords, attachContractMonitor } from "../src/procurement-taxonomy.js";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const paths = {
  budget: process.env.BUDGET_FILE || resolve(ROOT, "src/data/budget-intelligence.json"),
  sam: process.env.SAM_FILE || resolve(ROOT, "src/data/sam-opportunities.json"),
  capture: process.env.CAPTURE_FILE || resolve(ROOT, "src/data/capture-calendar.json"),
  manual: process.env.MANUAL_PROCUREMENT_FILE || resolve(ROOT, "src/data/manual-procurement.json"),
  subawards: process.env.SUBAWARDS_FILE || resolve(ROOT, "src/data/usaspending-subawards.json"),
  monitor: process.env.CONTRACT_MONITOR_FILE || resolve(ROOT, "src/data/contract-monitor.json"),
  output: process.env.PROCUREMENT_DELTA_OUTPUT || resolve(ROOT, "src/data/procurement-delta.json"),
  discovery: process.env.PROCUREMENT_DISCOVERY_OUTPUT || resolve(ROOT, "src/data/procurement-discovery.json"),
  feed: process.env.PROCUREMENT_FEED_OUTPUT || resolve(ROOT, "src/data/procurement-feed.json"),
};
const generatedAt = new Date().toISOString();
const day = generatedAt.slice(0, 10);

function read(path, fallback = null) {
  return path && existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : fallback;
}
function awards(payload) {
  return payload?.metadata?.dataInventory?.strategyAnalytics?.executionAnalytics?.awardDrilldown?.awards || [];
}
function executionCoverage(payload) {
  return payload?.metadata?.dataInventory?.strategyAnalytics?.executionAnalytics?.coverage || {};
}
function signature(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
function normalizedAward(row) {
  return { awardAmountDollars: row.awardAmountDollars, startDate: row.startDate, endDate: row.endDate, recipient: row.recipient, description: row.description, contractType: row.contractType, naicsCode: row.naicsCode, pscCode: row.pscCode, buyerSubAgency: row.buyerSubAgency, fundingOffice: row.fundingOffice, awardingOffice: row.awardingOffice, areaIds: row.areaIds };
}
function normalizedNotice(row) {
  return { title: row.title, postedDate: row.postedDate, responseDeadline: row.responseDeadline, noticeType: row.noticeType, setAside: row.setAside, naicsCode: row.naicsCode, pscCode: row.pscCode, active: row.active, department: row.department, subTier: row.subTier, office: row.office, sourceUpdatedAt: row.sourceUpdatedAt };
}
function normalizedMonitor(row) {
  return { status: row.status, lifecycle: row.lifecycle, diagnostic: row.diagnostic, observation: row.observation };
}
const FIELD_LABELS = {
  active: "Active status",
  areaIds: "Technology areas",
  awardAmountDollars: "Award amount",
  awardingOffice: "Awarding office",
  buyerSubAgency: "Buying component",
  contractType: "Award type",
  department: "Department",
  description: "Description",
  diagnostic: "Monitor diagnostic",
  endDate: "Period of performance end",
  fundingOffice: "Funding office",
  lifecycle: "Lifecycle",
  naicsCode: "NAICS",
  noticeType: "Notice type",
  observation: "Source observation",
  office: "Buying office",
  pscCode: "PSC",
  recipient: "Recipient",
  responseDeadline: "Response deadline",
  setAside: "Set-aside",
  sourceUpdatedAt: "Source update",
  startDate: "Period of performance start",
  status: "Monitor status",
  subTier: "Agency / component",
  title: "Title",
};
function sameValue(left, right) {
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
}
function fieldChanges(previous, current) {
  const before = previous || {};
  const after = current || {};
  return [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .filter((field) => !sameValue(before[field], after[field]))
    .map((field) => ({ field, label: FIELD_LABELS[field] || field, before: before[field] ?? null, after: after[field] ?? null }));
}
function compare(sourceSystem, currentRows, previousRows, idFor, normalize) {
  const current = new Map(currentRows.map((row) => [idFor(row), row]).filter(([id]) => id));
  const previous = new Map(previousRows.map((row) => [idFor(row), row]).filter(([id]) => id));
  const changes = [];
  for (const [id, row] of current) {
    if (!previous.has(id)) changes.push({ sourceSystem, sourceRecordId: id, change: "added", current: normalize(row), previous: null, fields: [] });
    else if (signature(normalize(row)) !== signature(normalize(previous.get(id)))) {
      const currentValue = normalize(row);
      const previousValue = normalize(previous.get(id));
      changes.push({ sourceSystem, sourceRecordId: id, change: "updated", current: currentValue, previous: previousValue, fields: fieldChanges(previousValue, currentValue) });
    }
  }
  for (const [id, row] of previous) if (!current.has(id)) changes.push({ sourceSystem, sourceRecordId: id, change: "removed", current: null, previous: normalize(row), fields: [] });
  return changes;
}

const currentBudget = read(paths.budget, {});
const currentSam = read(paths.sam, { metadata: {}, records: [] });
const currentCapture = read(paths.capture, { metadata: {}, records: [] });
const currentManual = read(paths.manual, { metadata: {}, records: [] });
const currentSubawards = read(paths.subawards, { metadata: {}, primes: [] });
const currentMonitor = read(paths.monitor, { metadata: {}, records: [] });
const currentUsaspendingGeneratedAt = executionCoverage(currentBudget).cachedAt || currentBudget.metadata?.generatedAt || generatedAt;
const previousBudget = read(process.env.PREVIOUS_BUDGET_FILE);
const previousSam = read(process.env.PREVIOUS_SAM_FILE);
const previousMonitor = read(process.env.PREVIOUS_CONTRACT_MONITOR_FILE);
const previousUsaspendingGeneratedAt = executionCoverage(previousBudget).cachedAt || previousBudget?.metadata?.generatedAt || null;
const previousOutput = read(paths.output, {});
const previousDiscovery = read(paths.discovery, { discovery: previousOutput.discovery || [], history: previousOutput.history || [] });
const hasComparisonBaseline = Boolean(previousBudget || previousSam || previousMonitor || (previousDiscovery.discovery || []).length);

const sourceChanges = [
  ...(previousBudget ? compare("USAspending", awards(currentBudget), awards(previousBudget), (row) => row.id || row.awardId, normalizedAward) : []),
  ...(previousSam ? compare("SAM.gov", currentSam.records || [], previousSam.records || [], (row) => row.noticeId, normalizedNotice) : []),
  ...(previousMonitor ? compare("Contract monitor", currentMonitor.records || [], previousMonitor.records || [], (row) => row.generatedAwardId || row.opportunityId, normalizedMonitor) : []),
];

const currentRecords = attachContractMonitor(assembleProcurementRecords(
  currentCapture.records || [],
  awards(currentBudget),
  currentCapture.metadata?.asOf || currentBudget.metadata?.asOf || day,
  currentSam.records || [],
  currentManual.records || [],
  currentSubawards,
), currentMonitor);
const priorDiscovery = new Map((previousDiscovery.discovery || []).map((entry) => [entry.opportunityId, entry]));
const sourceSeedAt = (record) => record.sourceSystem === "SAM.gov"
  ? currentSam.metadata?.generatedAt || currentSam.metadata?.lastAttemptAt || generatedAt
  : record.sourceSystem === "USAspending"
    ? currentUsaspendingGeneratedAt
    : currentCapture.metadata?.generatedAt || generatedAt;
const discovery = currentRecords.map((record) => {
  const normalized = {
    title: record.title,
    reference: record.reference,
    sourceSystem: record.sourceSystem,
    lifecycleStatus: record.lifecycleStatus,
    start: record.start || record.solicitationStart,
    end: record.currentEnd || record.solicitationEnd,
    obligatedAmount: record.obligatedAmount,
    potentialAmount: record.potentialAmount,
    technologyAreas: record.technologyAreas || [],
    organization: record.organization || null,
    monitor: record.automationCoverage?.observation || null,
  };
  const sourceSignature = signature(normalized);
  const prior = priorDiscovery.get(record.opportunityId);
  const changed = !prior || prior.sourceSignature !== sourceSignature;
  return {
    opportunityId: record.opportunityId,
    sourceRecordId: record.sourceRecordId || record.reference || record.opportunityId,
    sourceSystem: record.sourceSystem || "Published source record",
    title: record.title,
    firstSeenAt: prior?.firstSeenAt || record.firstSeenAt || sourceSeedAt(record),
    lastSeenAt: generatedAt,
    lastChangedAt: changed ? generatedAt : prior?.lastChangedAt || prior?.firstSeenAt || sourceSeedAt(record),
    sourcePublishedAt: record.sourcePublishedAt || record.events?.find((event) => event.kind === "notice-posted")?.start || null,
    sourceUpdatedAt: record.sourceUpdatedAt || record.automationCoverage?.observation?.sourceModifiedAt || null,
    technologyAreas: record.technologyAreas || [],
    organization: record.organization || null,
    changeCount: Math.max(1, Number(prior?.changeCount || 0) + (changed ? 1 : 0)),
    present: true,
    sourceSignature,
  };
});
const currentIds = new Set(discovery.map((entry) => entry.opportunityId));
for (const prior of priorDiscovery.values()) {
  if (!currentIds.has(prior.opportunityId)) discovery.push({ ...prior, present: false, lastChangedAt: generatedAt, changeCount: Number(prior.changeCount || 0) + 1 });
}

const bySourceId = new Map(sourceChanges.map((change) => [String(change.sourceRecordId || "").toUpperCase(), change]));
for (const entry of discovery) {
  const prior = priorDiscovery.get(entry.opportunityId);
  const change = !hasComparisonBaseline ? null : !prior ? "added" : prior.present && !entry.present ? "removed" : prior.sourceSignature !== entry.sourceSignature ? "updated" : null;
  const keys = [entry.opportunityId, entry.sourceRecordId].map((value) => String(value || "").toUpperCase()).filter(Boolean);
  if (change && !keys.some((key) => bySourceId.has(key))) {
    const current = entry.present ? { title: entry.title } : null;
    const previous = prior ? { title: prior.title } : null;
    const row = { sourceSystem: entry.sourceSystem, sourceRecordId: entry.sourceRecordId, opportunityId: entry.opportunityId, change, current, previous, fields: change === "updated" ? fieldChanges(previous, current) : [] };
    sourceChanges.push(row);
    keys.forEach((key) => bySourceId.set(key, row));
  }
}

for (const entry of discovery) {
  const keys = [entry.opportunityId, entry.sourceRecordId].map((value) => String(value || "").toUpperCase()).filter(Boolean);
  const sourceChange = keys.map((key) => bySourceId.get(key)).find(Boolean);
  const prior = priorDiscovery.get(entry.opportunityId);
  if (sourceChange) {
    sourceChange.opportunityId ||= entry.opportunityId;
    if (sourceChange.current && !sourceChange.current.title) sourceChange.current.title = entry.title;
    if (sourceChange.previous && !sourceChange.previous.title) sourceChange.previous.title = prior?.title || entry.title;
  }
  entry.lastChangeType = sourceChange?.change || prior?.lastChangeType || (prior ? null : "added");
  entry.changedFields = sourceChange?.fields || prior?.changedFields || [];
}

const records = [...new Map(sourceChanges.map((change) => [`${change.sourceSystem}:${change.sourceRecordId}:${change.change}`, change])).values()];
const summary = {
  added: records.filter((record) => record.change === "added").length,
  updated: records.filter((record) => record.change === "updated").length,
  removed: records.filter((record) => record.change === "removed").length,
};
const compactChanges = records.slice(0, 100).map((record) => ({
  sourceSystem: record.sourceSystem,
  sourceRecordId: record.sourceRecordId,
  opportunityId: record.opportunityId || null,
  change: record.change,
  title: record.current?.title || record.previous?.title || null,
  fields: (record.fields || []).slice(0, 12),
  fieldCount: (record.fields || []).length,
}));
const historyEntry = {
  date: day,
  generatedAt,
  summary,
  sources: {
    sam: currentSam.metadata?.status || "unknown",
    usaspending: currentBudget.metadata?.generatedAt ? "current" : "unavailable",
    contractMonitor: currentMonitor.metadata?.status || "unknown",
  },
  changes: compactChanges,
  truncated: records.length > compactChanges.length,
};
const history = [historyEntry, ...(previousDiscovery.history || []).filter((entry) => entry.date !== day)].slice(0, 180);
const compared = hasComparisonBaseline;
const presentOpportunityIds = new Set(discovery.filter((entry) => entry.present !== false).map((entry) => entry.opportunityId));
const presentRecords = currentRecords.filter((record) => presentOpportunityIds.has(record.opportunityId));
const sourceCounts = presentRecords.reduce((counts, record) => {
  const key = record.sourceSystem || "Published source record";
  counts[key] = (counts[key] || 0) + 1;
  return counts;
}, {});
const coverage = {
  scope: "Technology-focused acquisition records assembled from disclosed public-source queries; not exhaustive DoW award coverage.",
  knownRecords: presentRecords.length,
  sourceCounts,
  unknownHierarchy: presentRecords.filter((record) => !record.organization?.branch || !record.organization?.component).length,
  unclassifiedTechnology: presentRecords.filter((record) => !(record.technologyAreas || []).length).length,
  missingExactIdentifier: presentRecords.filter((record) => !(record.sourceRecordId || record.reference)).length,
  contractMonitor: {
    targetCount: Number(currentMonitor.metadata?.targetCount || currentMonitor.records?.length || 0),
    eligibleTargetCount: Number(currentMonitor.metadata?.eligibleTargetCount || currentMonitor.metadata?.targetCount || currentMonitor.records?.length || 0),
    excludedTargetCount: Number(currentMonitor.metadata?.excludedTargetCount || 0),
    exactCount: Number(currentMonitor.metadata?.exactTargetCount || currentMonitor.metadata?.currentCount || 0),
    gapCount: Number(currentMonitor.metadata?.gapCount || currentMonitor.metadata?.coverageGapCount || 0),
    coveragePct: Number(currentMonitor.metadata?.coveragePercent || 0),
    corpusCoveragePct: Number(currentMonitor.metadata?.corpusCoveragePercent || currentMonitor.metadata?.coveragePercent || 0),
  },
  sources: {
    sam: { status: currentSam.metadata?.status || "unknown", generatedAt: currentSam.metadata?.generatedAt || null, lastAttemptAt: currentSam.metadata?.lastAttemptAt || null },
    usaspending: { status: currentUsaspendingGeneratedAt ? "current" : "unavailable", generatedAt: currentUsaspendingGeneratedAt || null, coverageStatus: executionCoverage(currentBudget).coverageStatus || null },
    contractMonitor: { status: currentMonitor.metadata?.status || "unknown", generatedAt: currentMonitor.metadata?.generatedAt || null },
  },
};
const feedBoundary = Date.parse(`${day}T00:00:00Z`);
const closingSoon = currentRecords.filter((record) => {
  const deadline = Date.parse(record.currentEnd || record.solicitationEnd || record.responseDeadline || "");
  return Number.isFinite(deadline) && deadline >= feedBoundary && deadline <= feedBoundary + 30 * 86_400_000;
}).map((record) => ({
  opportunityId: record.opportunityId,
  sourceRecordId: record.sourceRecordId || record.reference || record.opportunityId,
  sourceSystem: record.sourceSystem || "Published source record",
  title: record.title,
  date: record.currentEnd || record.solicitationEnd || record.responseDeadline,
})).sort((left, right) => String(left.date).localeCompare(String(right.date))).slice(0, 250);
const output = {
  metadata: {
    schemaVersion: "2.0.0",
    generatedAt,
    status: compared ? "compared" : "baseline",
    previousSnapshot: previousUsaspendingGeneratedAt || previousSam?.metadata?.generatedAt || previousMonitor?.metadata?.generatedAt || previousDiscovery.metadata?.generatedAt || previousOutput.metadata?.generatedAt || null,
    currentSnapshot: currentUsaspendingGeneratedAt || currentSam?.metadata?.generatedAt || currentMonitor?.metadata?.generatedAt || generatedAt,
  },
  summary,
  records,
};
writeFileSync(paths.output, `${JSON.stringify(output, null, 2)}\n`);
writeFileSync(paths.discovery, `${JSON.stringify({
  metadata: { schemaVersion: "1.1.0", generatedAt, status: compared ? "compared" : "baseline", discoveryCount: discovery.filter((entry) => entry.present).length, historyDays: history.length, coverage },
  discovery,
  history,
}, null, 2)}\n`);
writeFileSync(paths.feed, `${JSON.stringify({
  metadata: { schemaVersion: "1.0.0", generatedAt, status: compared ? "compared" : "baseline", discoveryCount: discovery.filter((entry) => entry.present).length, historyDays: history.length, coverage },
  history,
  closingSoon,
}, null, 2)}\n`);
console.log(`Built procurement delta: ${summary.added} added, ${summary.updated} updated, ${summary.removed} removed; ${discovery.filter((entry) => entry.present).length} discoverable records across ${history.length} daily snapshots`);
