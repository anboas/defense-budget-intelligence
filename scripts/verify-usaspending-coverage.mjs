import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const coverage = JSON.parse(readFileSync(resolve(ROOT, "src/data/usaspending-coverage.json"), "utf8"));
const accountSpine = JSON.parse(readFileSync(resolve(ROOT, "src/data/account-spine.json"), "utf8"));
const subawards = JSON.parse(readFileSync(resolve(ROOT, "src/data/usaspending-subawards.json"), "utf8"));
const metadata = coverage.metadata || {};
const years = coverage.years || [];
const awards = coverage.awards || [];
const dimensions = ["awarding_subagency", "funding_subagency", "recipient", "psc", "naics"];

assert.equal(metadata.schemaVersion, "1.0.0", "USAspending coverage schema changed");
assert.equal(metadata.firstFiscalYear, 2017, "Coverage must retain the FY2017 baseline");
assert.ok(metadata.lastFiscalYear >= 2026, "Coverage must include the current fiscal year");
assert.equal(years.length, metadata.fiscalYearCount, "Every disclosed fiscal year must have one coverage record");
assert.deepEqual(years.map((year) => year.fiscalYear), Array.from({ length: metadata.fiscalYearCount }, (_, index) => metadata.firstFiscalYear + index), "Fiscal-year coverage must be continuous");
assert.equal(coverage.annualTotals?.length, years.length, "Every fiscal year must retain one complete-query-boundary total");
assert.ok(years.slice(0, -1).every((year) => year.status === "complete-fiscal-year"), "Closed fiscal years must never be labeled year-to-date");
assert.equal(years.at(-1)?.status, "year-to-date", "The current fiscal year must remain explicitly partial");
assert.ok(years.every((year) => Number.isFinite(year.obligatedAmount) && year.obligatedAmount > 0), "Every annual obligation total must be positive and finite");
assert.ok(/must never be added/i.test(metadata.amountPolicy || ""), "Award-level values must retain the non-additive amount warning");
assert.ok(/complete within/i.test(metadata.scope || ""), "The complete annual query boundary must remain explicit");

const realized = {};
for (const dimension of dimensions) {
  const rows = years.flatMap((year) => (year.categories?.[dimension] || []).map((row) => ({ ...row, fiscalYear: year.fiscalYear })));
  const identity = (row) => dimension === "recipient"
    ? row.uei || row.id || row.code || row.name
    : row.id ?? row.code ?? row.name;
  const keys = rows.map((row) => `${row.fiscalYear}:${identity(row)}`);
  assert.equal(new Set(keys).size, keys.length, `${dimension} coverage contains a repeated USAspending page or identity`);
  assert.ok(rows.every((row) => Number.isFinite(row.obligatedAmount)), `${dimension} contains a non-numeric obligation amount`);
  realized[dimension] = rows.length;
}
assert.deepEqual(metadata.coverage?.realizedCategoryRows, realized, "Realized category coverage must match the retained deduplicated rows");
assert.equal(Object.values(realized).reduce((total, count) => total + count, 0), 7061, "Known deduplicated category breadth changed");

const awardKeys = awards.map((award) => award.generatedAwardId || `${award.kind}:${award.piid}`);
assert.equal(new Set(awardKeys).size, awards.length, "Ranked award and IDV identities must be unique");
assert.equal(awards.length, metadata.coverage?.uniqueRankedAwards, "Unique ranked award coverage must match metadata");
assert.ok(awards.length >= 1400, "Ranked contract and IDV breadth regressed below 1,400 unique awards");
assert.ok(awards.every((award) => Number.isFinite(award.awardAmount) && award.awardAmount >= 0), "Award-level values must be finite and non-negative");
assert.ok(awards.every((award) => Array.isArray(award.observedFiscalYears) && award.observedFiscalYears.length > 0), "Every ranked award must retain its observed fiscal years");
assert.ok(awards.filter((award) => award.recipientUei).length >= 750, "Recipient UEI enrichment coverage regressed below 750 ranked awards");

const awardById = new Set(awardKeys);
for (const year of years) {
  for (const reference of [...(year.topContracts || []), ...(year.topIdvs || [])]) {
    assert.ok(awardById.has(reference.generatedAwardId || `${reference.kind}:${reference.piid}`), `FY${year.fiscalYear} references an award omitted from the normalized registry`);
  }
}

for (const url of Object.values(metadata.sourceUrls || {})) {
  assert.ok(/^https:\/\/api\.usaspending\.gov\//.test(url), "Coverage sources must remain official USAspending API endpoints");
}

assert.equal(accountSpine.metadata?.status, "current", "The exact account spine must retain a successful current refresh");
assert.equal(accountSpine.metadata?.coverage?.sampledAwards, 500, "The account spine must retain the stratified 500-award sample");
assert.equal(accountSpine.metadata?.coverage?.awardAccountsFetched, 500, "Every selected account-spine award must resolve successfully");
assert.equal(accountSpine.metadata?.coverage?.awardAccountFailures, 0, "The account spine must fail closed on unresolved award-account probes");
assert.ok(accountSpine.metadata?.coverage?.exactAwardAccountLinks >= 750, "Exact award-account depth regressed below 750 links");
assert.ok(accountSpine.metadata?.coverage?.awardsMappedToCurrentAccounts >= 300, "Current-account award coverage regressed below 300 awards");
assert.match(accountSpine.metadata?.sources?.usaSpendingAwardSampleMethodology || "", /stratified/i, "Account sampling must preserve technology depth and DoD breadth");

assert.equal(subawards.metadata?.joinBasis, "Exact USAspending generated prime-award identifier", "Subaward joins must remain exact");
assert.match(subawards.metadata?.methodology || "", /stratified/i, "Subaward sampling must preserve technology depth and DoD breadth");
assert.ok(subawards.metadata?.indexedPrimeCount >= 1900, "Subaward eligible-prime breadth regressed below 1,900 awards");
assert.ok(subawards.metadata?.primeWithSubawardsCount >= 379, "Previously verified positive subaward primes must never be dropped by a partial refresh");
assert.ok(subawards.metadata?.retainedDetailCount >= 26400, "Previously verified subaward details must never be dropped by a partial refresh");
assert.ok(["current", "partial"].includes(subawards.metadata?.status), "Subaward source status must remain explicit");

console.log(JSON.stringify({
  status: "passed",
  fiscalYears: years.length,
  annualTotals: coverage.annualTotals.length,
  categoryRows: realized,
  uniqueRankedAwards: awards.length,
  awardsWithUei: awards.filter((award) => award.recipientUei).length,
  accountSpine: accountSpine.metadata.coverage,
  subawards: {
    indexedPrimeCount: subawards.metadata.indexedPrimeCount,
    checkedPrimeCount: subawards.metadata.checkedPrimeCount,
    positivePrimes: subawards.metadata.primeWithSubawardsCount,
    retainedDetails: subawards.metadata.retainedDetailCount,
    failures: subawards.metadata.failedPrimeCount,
  },
}, null, 2));
