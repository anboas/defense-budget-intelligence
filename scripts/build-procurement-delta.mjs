import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const currentBudgetPath = resolve(ROOT, "src/data/budget-intelligence.json");
const currentSamPath = resolve(ROOT, "src/data/sam-opportunities.json");
const previousBudgetPath = process.env.PREVIOUS_BUDGET_FILE;
const previousSamPath = process.env.PREVIOUS_SAM_FILE;
const outputPath = resolve(ROOT, "src/data/procurement-delta.json");

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
  return { awardAmountDollars: row.awardAmountDollars, startDate: row.startDate, endDate: row.endDate, recipient: row.recipient, description: row.description, contractType: row.contractType, naicsCode: row.naicsCode, pscCode: row.pscCode };
}
function normalizedNotice(row) {
  return { title: row.title, postedDate: row.postedDate, responseDeadline: row.responseDeadline, noticeType: row.noticeType, setAside: row.setAside, naicsCode: row.naicsCode, pscCode: row.pscCode, active: row.active };
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

const currentBudget = read(currentBudgetPath, {});
const currentSam = read(currentSamPath, { records: [] });
const previousBudget = read(previousBudgetPath);
const previousSam = read(previousSamPath);
const baseline = !previousBudget && !previousSam;
const records = baseline ? [] : [
  ...compare("USAspending", awards(currentBudget), awards(previousBudget), (row) => row.id || row.awardId, normalizedAward),
  ...compare("SAM.gov", currentSam.records || [], previousSam?.records || [], (row) => row.noticeId, normalizedNotice),
];
const output = {
  metadata: {
    schemaVersion: "1.0.0",
    generatedAt: new Date().toISOString(),
    status: baseline ? "baseline" : "compared",
    previousSnapshot: previousBudget?.metadata?.generatedAt || previousSam?.metadata?.generatedAt || null,
    currentSnapshot: currentBudget?.metadata?.generatedAt || currentSam?.metadata?.generatedAt || null,
  },
  summary: {
    added: records.filter((record) => record.change === "added").length,
    updated: records.filter((record) => record.change === "updated").length,
    removed: records.filter((record) => record.change === "removed").length,
  },
  records,
};
writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`);
console.log(`Built procurement delta: ${output.summary.added} added, ${output.summary.updated} updated, ${output.summary.removed} removed`);
