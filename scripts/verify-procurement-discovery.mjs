import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { exactLifecycleLinks, fetchSamOpportunities, matchesSavedAcquisitionView, normalizeAcquisitionConfig, normalizeSamOpportunity, normalizeSavedAcquisitionView, samQueryWindow } from "../src/acquisition-runtime-core.js";

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
  const normalized = normalizeSamOpportunity({ noticeId: "notice-runtime-1", solicitationNumber: "W15P7T-26-R-0001", title: "Runtime notice", type: "Solicitation", postedDate: "2026-09-19", responseDeadLine: "2026-10-15", active: "Yes", uiLink: "https://sam.gov/opp/notice-runtime-1/view" });
  assert.equal(normalized.sourceRecordId, "notice-runtime-1");
  assert.equal(normalized.lifecycleStage, "opportunity");
  const window = samQueryWindow({ lastCompletedAt: "2026-09-18T00:00:00Z", now: new Date("2026-09-19T12:00:00Z") });
  assert.equal(window.lookbackDays, 3, "Incremental workspace refreshes must overlap three days to catch late amendments");
  let requestedUrl = ""; let requestedKey = "";
  const fetched = await fetchSamOpportunities({ apiKey: "sam_runtime_contract_key_0001", lastCompletedAt: "2026-09-18T00:00:00Z", fetchImpl: async (url, options) => {
    requestedUrl = String(url); requestedKey = options.headers["x-api-key"];
    return new Response(JSON.stringify({ totalRecords: 1, opportunitiesData: [{ noticeId: "notice-runtime-1", solicitationNumber: "W15P7T-26-R-0001", title: "Runtime notice", type: "Solicitation", postedDate: "2026-09-19", active: "Yes" }] }), { status: 200, headers: { "content-type": "application/json" } });
  } });
  assert.equal(fetched.records.length, 1);
  assert.match(requestedUrl, /organizationName=DEPT\+OF\+DEFENSE/);
  assert.equal(requestedKey, "sam_runtime_contract_key_0001", "The workspace key must travel only in the protected request header");
  assert.deepEqual(normalizeAcquisitionConfig({ cadenceHours: 1, pageSize: 5000, maxPages: 99, requestIntervalMs: 1, maxRetries: 99, noticeTypes: ["p", "x", "p"] }), {
    enabled: true, cadenceHours: 6, initialLookbackDays: 14, incrementalLookbackDays: 3, pageSize: 1000,
    maxPages: 25, requestIntervalMs: 250, maxRetries: 6, organizationName: "DEPT OF DEFENSE", noticeTypes: ["p"],
  }, "Workspace acquisition settings must be clamped to the documented and operational safety envelope");
  const waits = []; let rateAttempts = 0;
  const recovered = await fetchSamOpportunities({ apiKey: "sam_runtime_contract_key_0001", config: { maxRetries: 1, requestIntervalMs: 250 }, sleep: async (milliseconds) => waits.push(milliseconds), fetchImpl: async () => {
    rateAttempts += 1;
    if (rateAttempts === 1) return new Response("{}", { status: 429, headers: { "retry-after": "2" } });
    return new Response(JSON.stringify({ totalRecords: 0, opportunitiesData: [] }), { status: 200, headers: { "content-type": "application/json" } });
  } });
  assert.deepEqual(waits, [2000], "SAM.gov Retry-After must control bounded rate-limit backoff");
  assert.equal(recovered.metadata.retries, 1);
  assert.equal(recovered.metadata.requests, 2);
  const typeUrls = [];
  await fetchSamOpportunities({ apiKey: "sam_runtime_contract_key_0001", config: { noticeTypes: ["p", "r"], maxPages: 2, requestIntervalMs: 250 }, sleep: async () => {}, fetchImpl: async (url) => {
    typeUrls.push(String(url));
    return new Response(JSON.stringify({ totalRecords: 0, opportunitiesData: [] }), { status: 200, headers: { "content-type": "application/json" } });
  } });
  assert.deepEqual(typeUrls.map((url) => new URL(url).searchParams.get("ptype")), ["p", "r"], "Each selected SAM.gov notice type must use its documented scalar ptype request");
  await assert.rejects(() => fetchSamOpportunities({ apiKey: "sam_runtime_contract_key_0001", config: { maxPages: 1, pageSize: 1000, requestIntervalMs: 250 }, sleep: async () => {}, fetchImpl: async () => new Response(JSON.stringify({ totalRecords: 2000, opportunitiesData: [{ noticeId: "truncated-1", title: "Partial" }] }), { status: 200, headers: { "content-type": "application/json" } }) }), (error) => error.code === "source_truncated", "A bounded partial SAM response must fail closed");
  const links = exactLifecycleLinks([{ sourceRecordId: "notice-a", solicitationNumber: "W15P7T-26-R-0001", postedDate: "2026-09-01", lifecycleStage: "opportunity" }, { sourceRecordId: "notice-b", solicitationNumber: "W15P7T-26-R-0001", postedDate: "2026-09-19", lifecycleStage: "award" }]);
  assert.deepEqual(links.map((link) => [link.fromId, link.toId, link.relationship, link.basis]), [["notice-a", "notice-b", "resulted_in_award", "solicitation_number"]], "Lifecycle links must require an exact disclosed identifier");
  const crossSourceLinks = exactLifecycleLinks([{ sourceSystem: "SAM.gov", noticeId: "notice-a", solicitationNumber: "W15P7T-26-R-0001", postedDate: "2026-09-01", lifecycleStage: "opportunity" }, { sourceSystem: "USAspending", awardId: "CONT_AWD_W15P7T26C0001", solicitationNumber: "W15P7T-26-R-0001", postedDate: "2026-09-19", lifecycleStage: "award" }]);
  assert.deepEqual(crossSourceLinks.map((link) => [link.fromSource, link.fromId, link.toSource, link.toId, link.relationship]), [["sam_gov", "notice-a", "usaspending", "CONT_AWD_W15P7T26C0001", "resulted_in_award"]], "The lifecycle-link contract must support cross-source exact identifiers without fuzzy inference");
  const expandedLinks = exactLifecycleLinks([
    { sourceSystem: "SAM.gov", noticeId: "notice-base", postedDate: "2026-09-01", lifecycleStage: "opportunity" },
    { sourceSystem: "SAM.gov", noticeId: "notice-amendment", relatedNoticeIds: ["notice-base"], postedDate: "2026-09-05", lifecycleStage: "opportunity" },
    { sourceSystem: "USAspending", sourceRecordId: "vehicle", awardId: "W15P7T23D0001", actionDate: "2026-09-06", lifecycleStage: "idv" },
    { sourceSystem: "USAspending", sourceRecordId: "order", awardId: "W15P7T26F0001", parentAwardId: "W15P7T23D0001", actionDate: "2026-09-07", lifecycleStage: "order" },
    { sourceSystem: "FPDS", sourceRecordId: "modification", awardId: "W15P7T26F0001", modificationNumber: "P00001", actionDate: "2026-09-08", lifecycleStage: "modification" },
  ]);
  assert.ok(expandedLinks.some((link) => link.relationship === "amends_notice" && link.basis === "notice_id"), "Exact notice identifiers must link amendments");
  assert.ok(expandedLinks.some((link) => link.relationship === "ordered_from_vehicle" && link.basis === "parent_award_id"), "Exact parent award identifiers must link orders to vehicles");
  assert.ok(expandedLinks.some((link) => link.relationship === "modifies_award" && link.basis === "award_id"), "Exact award identifiers must link modifications");
  const saved = normalizeSavedAcquisitionView({ query: "runtime", filters: { branch: "Army", naics: "541512", untrustedField: "discard me" }, credential: "must-not-survive" });
  assert.deepEqual(saved, { query: "runtime", filters: { branch: "Army", naics: "541512" } }, "Saved acquisition views must retain only the allowlisted filter contract");
  assert.equal(matchesSavedAcquisitionView({ ...normalized, naicsCode: "541512", organization: { branch: "Army" } }, saved), true, "Durable alert matching must use the normalized saved-view contract");
  console.log("Procurement discovery contract passed: field-level diffs, daily history, and explicit coverage boundaries.");
} finally {
  if (process.env.KEEP_PROCUREMENT_DISCOVERY_FIXTURE) console.log(`Retained fixture at ${fixtureRoot}`);
  else rmSync(fixtureRoot, { recursive: true, force: true });
}
