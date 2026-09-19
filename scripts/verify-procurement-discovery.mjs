import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const fixtureRoot = mkdtempSync(resolve(tmpdir(), "dbi-procurement-discovery-"));
const write = (name, value) => {
  const path = resolve(fixtureRoot, name);
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
  return path;
};
const award = (amount, endDate) => ({ id: "award-1", awardId: "W15P7T-26-C-0001", awardAmountDollars: amount, startDate: "2026-01-01", endDate, recipient: "EXAMPLE SYSTEMS", description: "Autonomy software", contractType: "Definitive Contract", naicsCode: "541512", pscCode: "DA10", buyerSubAgency: "Department of the Army", fundingOffice: "ACC", awardingOffice: "ACC", areaIds: ["autonomous-systems"] });
const budget = (row) => ({ metadata: { generatedAt: "2026-09-19T00:00:00.000Z", dataInventory: { strategyAnalytics: { executionAnalytics: { awardDrilldown: { awards: [row] }, coverage: { coverageStatus: "complete-within-query-boundary" } } } } } });
const notice = (deadline) => ({ noticeId: "notice-1", title: "Autonomy sources sought", postedDate: "2026-09-18", responseDeadline: deadline, noticeType: "Sources Sought", setAside: null, naicsCode: "541512", pscCode: "DA10", active: true, department: "DEPT OF DEFENSE", subTier: "DEPT OF THE ARMY", office: "ACC", sourceUpdatedAt: "2026-09-19T00:00:00Z" });
const monitor = (status) => ({ generatedAwardId: "award-1", status, lifecycle: "active", diagnostic: null, observation: { sourceModifiedAt: "2026-09-19" } });

try {
  const currentBudget = write("budget-current.json", budget(award(125_000_000, "2028-12-31")));
  const previousBudget = write("budget-previous.json", budget(award(100_000_000, "2028-06-30")));
  const currentSam = write("sam-current.json", { metadata: { status: "current", generatedAt: "2026-09-19T00:00:00Z" }, records: [notice("2026-10-15")] });
  const previousSam = write("sam-previous.json", { metadata: { status: "current", generatedAt: "2026-09-18T00:00:00Z" }, records: [notice("2026-10-01")] });
  const currentMonitor = write("monitor-current.json", { metadata: { status: "gaps-disclosed", targetCount: 1, eligibleTargetCount: 3, excludedTargetCount: 2, exactTargetCount: 1, gapCount: 0, coveragePercent: 100, corpusCoveragePercent: 33.3 }, records: [monitor("current")] });
  const previousMonitor = write("monitor-previous.json", { metadata: { status: "gaps-disclosed", targetCount: 1, eligibleTargetCount: 3, excludedTargetCount: 2, exactTargetCount: 1, gapCount: 0, coveragePercent: 100, corpusCoveragePercent: 33.3 }, records: [monitor("stale")] });
  const capture = write("capture.json", { metadata: { generatedAt: "2026-09-19T00:00:00Z", asOf: "2026-09-19" }, records: [] });
  const manual = write("manual.json", { metadata: {}, records: [] });
  const subawards = write("subawards.json", { metadata: {}, primes: [] });
  const deltaOutput = resolve(fixtureRoot, "delta.json");
  const discoveryOutput = resolve(fixtureRoot, "discovery.json");
  const feedOutput = resolve(fixtureRoot, "feed.json");
  execFileSync(process.execPath, [resolve(ROOT, "scripts/build-procurement-delta.mjs")], {
    cwd: ROOT,
    env: {
      ...process.env,
      BUDGET_FILE: currentBudget,
      SAM_FILE: currentSam,
      CAPTURE_FILE: capture,
      MANUAL_PROCUREMENT_FILE: manual,
      SUBAWARDS_FILE: subawards,
      CONTRACT_MONITOR_FILE: currentMonitor,
      PREVIOUS_BUDGET_FILE: previousBudget,
      PREVIOUS_SAM_FILE: previousSam,
      PREVIOUS_CONTRACT_MONITOR_FILE: previousMonitor,
      PROCUREMENT_DELTA_OUTPUT: deltaOutput,
      PROCUREMENT_DISCOVERY_OUTPUT: discoveryOutput,
      PROCUREMENT_FEED_OUTPUT: feedOutput,
    },
    stdio: "pipe",
  });
  const delta = JSON.parse(readFileSync(deltaOutput, "utf8"));
  const discovery = JSON.parse(readFileSync(discoveryOutput, "utf8"));
  const awardChange = delta.records.find((record) => record.sourceSystem === "USAspending");
  const samChange = delta.records.find((record) => record.sourceSystem === "SAM.gov");
  const monitorChange = delta.records.find((record) => record.sourceSystem === "Contract monitor");
  assert.ok(awardChange, `Expected a USAspending change row, got ${JSON.stringify(delta.records)}`);
  assert.deepEqual(awardChange.fields.map((field) => field.label).sort(), ["Award amount", "Period of performance end"], "Award updates should retain exact field-level changes");
  assert.deepEqual(samChange.fields.map((field) => field.label), ["Response deadline"], "SAM updates should retain the changed response deadline");
  assert.deepEqual(monitorChange.fields.map((field) => field.label), ["Monitor status"], "Monitor updates should retain the changed monitor status");
  assert.equal(discovery.history[0].changes.find((record) => record.sourceSystem === "USAspending").fieldCount, 2, "Daily history should retain the award field-change count");
  assert.equal(discovery.metadata.coverage.contractMonitor.coveragePct, 100, "Coverage metadata should retain the disclosed monitor percentage");
  assert.equal(discovery.metadata.coverage.contractMonitor.excludedTargetCount, 2, "Coverage metadata should distinguish eligible records outside the exact-detail monitor limit");
  assert.equal(discovery.metadata.coverage.contractMonitor.corpusCoveragePct, 33.3, "Coverage metadata should distinguish checked-record coverage from eligible-corpus coverage");
  assert.match(discovery.metadata.coverage.scope, /not exhaustive/i, "Coverage metadata should reject exhaustive-coverage claims");
  console.log("Procurement discovery contract passed: field-level diffs, daily history, and explicit coverage boundaries.");
} finally {
  if (process.env.KEEP_PROCUREMENT_DISCOVERY_FIXTURE) console.log(`Retained fixture at ${fixtureRoot}`);
  else rmSync(fixtureRoot, { recursive: true, force: true });
}
