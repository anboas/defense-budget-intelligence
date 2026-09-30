import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const payload = JSON.parse(readFileSync("src/data/account-spine.json", "utf8"));
const years = payload.metadata?.historyFiscalYears || [];
assert.equal(payload.metadata?.status, "current", "The exact money lifecycle must be current");
assert.ok(years.length >= 5, "At least five fiscal years must be retained");
assert.deepEqual([...years].sort((a, b) => a - b), years, "Fiscal years must be ordered");
assert.ok((payload.accountSnapshots || []).length >= 700, "Historical federal-account coverage regressed");
assert.ok((payload.executionBalances || []).length >= 3_500, "Historical TAS execution coverage regressed");
assert.ok((payload.apportionmentRevisions || []).length >= 5_000, "OMB revision history regressed");
assert.ok((payload.programActivities || []).length >= 700, "Program-activity coverage regressed");
assert.ok((payload.objectClasses || []).length >= 150, "Object-class coverage regressed");
assert.ok((payload.treasuryOutlays || []).length >= 48, "Treasury monthly reconciliation coverage regressed");
assert.ok((payload.awardFlows || []).length >= 500, "Exact award-account coverage regressed");

const executionIds = new Set();
for (const row of payload.executionBalances || []) {
  assert.match(row.id, /^execution-balance:\d{4}:/);
  assert.ok(row.tasCode && row.federalAccountCode, "Execution balances require exact TAS and federal-account identifiers");
  assert.ok(years.includes(row.fiscalYear), "Execution balance fiscal year must be in the retained history window");
  assert.ok(["annual", "multi-year", "no-year", "unknown"].includes(row.availability?.kind), "Period of availability must be explicit");
  assert.ok(!executionIds.has(row.id), `Duplicate execution balance ${row.id}`);
  executionIds.add(row.id);
}

const revisionIds = new Set();
for (const row of payload.apportionmentRevisions || []) {
  assert.match(row.id, /^apportionment-revision:\d{4}:/);
  assert.ok(row.sourceUrl?.startsWith("https://apportionment-public.max.gov/"), "OMB revisions require their official source URL");
  assert.ok(!revisionIds.has(row.id), `Duplicate OMB revision ${row.id}`);
  revisionIds.add(row.id);
}

for (const row of payload.treasuryOutlays || []) {
  assert.ok(row.recordDate && row.fiscalYear, "Treasury observations require period identity");
  assert.equal(row.sourceUrl, payload.metadata.sources.treasuryMonthlyStatement);
}

assert.match(payload.metadata.amountPolicy, /must not be added together/i);
assert.equal(payload.metadata.coverage.executionBalances, payload.executionBalances.length);
assert.equal(payload.metadata.coverage.apportionmentRevisions, payload.apportionmentRevisions.length);
console.log(`Exact money lifecycle passed: ${years[0]}-${years.at(-1)}, ${payload.executionBalances.length} TAS balances, ${payload.apportionmentRevisions.length} OMB revisions`);
