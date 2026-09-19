import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assembleProcurementRecords, attachContractMonitor } from "../src/procurement-taxonomy.js";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const paths = {
  budget: resolve(ROOT, "src/data/budget-intelligence.json"),
  sam: resolve(ROOT, "src/data/sam-opportunities.json"),
  capture: resolve(ROOT, "src/data/capture-calendar.json"),
  manual: resolve(ROOT, "src/data/manual-procurement.json"),
  subawards: resolve(ROOT, "src/data/usaspending-subawards.json"),
  monitor: resolve(ROOT, "src/data/contract-monitor.json"),
  output: resolve(ROOT, "src/data/procurement-delta.json"),
  discovery: resolve(ROOT, "src/data/procurement-discovery.json"),
};
const generatedAt = new Date().toISOString();
const day = generatedAt.slice(0, 10);

function read(path, fallback = null) {
  return path && existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : fallback;
}
function awards(payload) {
  return payload?.metadata?.dataInventory?.strategyAnalytics?.executionAnalytics?.awardDrilldown?.awards || [];
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
function compare(sourceSystem, currentRows, previousRows, idFor, normalize) {
  const current = new Map(currentRows.map((row) => [idFor(row), row]).filter(([id]) => id));
  const previous = new Map(previousRows.map((row) => [idFor(row), row]).filter(([id]) => id));
  const changes = [];
  for (const [id, row] of current) {
    if (!previous.has(id)) changes.push({ sourceSystem, sourceRecordId: id, change: "added", current: normalize(row), previous: null });
    else if (signature(normalize(row)) !== signature(normalize(previous.get(id)))) changes.push({ sourceSystem, sourceRecordId: id, change: "updated", current: normalize(row), previous: normalize(previous.get(id)) });
  }
  for (const [id, row] of previous) if (!current.has(id)) changes.push({ sourceSystem, sourceRecordId: id, change: "removed", current: null, previous: normalize(row) });
  return changes;
}

const currentBudget = read(paths.budget, {});
const currentSam = read(paths.sam, { metadata: {}, records: [] });
const currentCapture = read(paths.capture, { metadata: {}, records: [] });
const currentManual = read(paths.manual, { metadata: {}, records: [] });
const currentSubawards = read(paths.subawards, { metadata: {}, primes: [] });
const currentMonitor = read(paths.monitor, { metadata: {}, records: [] });
const previousBudget = read(process.env.PREVIOUS_BUDGET_FILE);
const previousSam = read(process.env.PREVIOUS_SAM_FILE);
const previousMonitor = read(process.env.PREVIOUS_CONTRACT_MONITOR_FILE);
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
    ? currentBudget.metadata?.generatedAt || generatedAt
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
    const row = { sourceSystem: entry.sourceSystem, sourceRecordId: entry.sourceRecordId, opportunityId: entry.opportunityId, change, current: entry.present ? { title: entry.title } : null, previous: prior ? { title: prior.title } : null };
    sourceChanges.push(row);
    keys.forEach((key) => bySourceId.set(key, row));
  }
}

const records = [...new Map(sourceChanges.map((change) => [`${change.sourceSystem}:${change.sourceRecordId}:${change.change}`, change])).values()];
const summary = {
  added: records.filter((record) => record.change === "added").length,
  updated: records.filter((record) => record.change === "updated").length,
  removed: records.filter((record) => record.change === "removed").length,
};
const compactChanges = records.slice(0, 100).map((record) => ({ sourceSystem: record.sourceSystem, sourceRecordId: record.sourceRecordId, opportunityId: record.opportunityId || null, change: record.change, title: record.current?.title || record.previous?.title || null }));
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
const output = {
  metadata: {
    schemaVersion: "2.0.0",
    generatedAt,
    status: compared ? "compared" : "baseline",
    previousSnapshot: previousBudget?.metadata?.generatedAt || previousSam?.metadata?.generatedAt || previousMonitor?.metadata?.generatedAt || previousDiscovery.metadata?.generatedAt || previousOutput.metadata?.generatedAt || null,
    currentSnapshot: currentBudget?.metadata?.generatedAt || currentSam?.metadata?.generatedAt || currentMonitor?.metadata?.generatedAt || generatedAt,
  },
  summary,
  records,
};
writeFileSync(paths.output, `${JSON.stringify(output, null, 2)}\n`);
writeFileSync(paths.discovery, `${JSON.stringify({
  metadata: { schemaVersion: "1.0.0", generatedAt, status: compared ? "compared" : "baseline", discoveryCount: discovery.filter((entry) => entry.present).length, historyDays: history.length },
  discovery,
  history,
}, null, 2)}\n`);
console.log(`Built procurement delta: ${summary.added} added, ${summary.updated} updated, ${summary.removed} removed; ${discovery.filter((entry) => entry.present).length} discoverable records across ${history.length} daily snapshots`);
