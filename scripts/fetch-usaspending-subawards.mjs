import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const BUDGET_FILE = resolve(ROOT, "src/data/budget-intelligence.json");
const OUT_FILE = resolve(ROOT, "src/data/usaspending-subawards.json");
const API_URL = "https://api.usaspending.gov/api/v2/subawards/";
const COUNT_URL = "https://api.usaspending.gov/api/v2/awards/count/subaward/";
const PAGE_LIMIT = Math.max(1, Math.min(100, Number(process.env.SUBAWARD_PAGE_LIMIT || 100)));
const DETAIL_LIMIT = Math.max(1, Number(process.env.SUBAWARD_DETAIL_LIMIT || 100));
const CONCURRENCY = Math.max(1, Math.min(8, Number(process.env.SUBAWARD_CONCURRENCY || 4)));
const PRIME_LIMIT = Math.max(1, Number(process.env.SUBAWARD_PRIME_LIMIT || 1000));

const budget = JSON.parse(readFileSync(BUDGET_FILE, "utf8"));
const awards = budget.metadata?.dataInventory?.strategyAnalytics?.executionAnalytics?.awardDrilldown?.awards || [];
let previous;
try {
  previous = JSON.parse(readFileSync(OUT_FILE, "utf8"));
} catch {
  previous = null;
}
const previousByPrime = new Map((previous?.primes || []).map((prime) => [prime.primeAwardId, prime]));
const retryFailuresOnly = process.env.SUBAWARD_RETRY_FAILURES === "1" && previous?.failures?.length;
const previousFailureIds = new Set((previous?.failures || []).map((failure) => failure.primeAwardId));

function sleep(milliseconds) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}

async function postJson(payload, attempt = 1) {
  const response = await fetch(API_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "user-agent": "defense-budget-intelligence-subaward-fetch/1.0",
    },
    body: JSON.stringify(payload),
  });
  const raw = await response.text();
  if (!response.ok || !raw.trim()) {
    if (attempt < 4 && (response.status === 429 || response.status >= 500 || !raw.trim())) {
      await sleep(350 * (2 ** (attempt - 1)));
      return postJson(payload, attempt + 1);
    }
    throw new Error(`${response.status} ${response.statusText}${raw.trim() ? `: ${raw.slice(0, 240)}` : ": empty response"}`);
  }
  try {
    return JSON.parse(raw);
  } catch (error) {
    if (attempt < 4) {
      await sleep(350 * (2 ** (attempt - 1)));
      return postJson(payload, attempt + 1);
    }
    throw new Error(`invalid JSON response: ${error.message}`, { cause: error });
  }
}

async function fetchCount(primeAwardId, attempt = 1) {
  const response = await fetch(`${COUNT_URL}${encodeURIComponent(primeAwardId)}/`, {
    headers: { "user-agent": "defense-budget-intelligence-subaward-fetch/1.0" },
  });
  const raw = await response.text();
  if (!response.ok || !raw.trim()) {
    if (attempt < 4 && (response.status === 429 || response.status >= 500 || !raw.trim())) {
      await sleep(350 * (2 ** (attempt - 1)));
      return fetchCount(primeAwardId, attempt + 1);
    }
    throw new Error(`${response.status} ${response.statusText}${raw.trim() ? `: ${raw.slice(0, 240)}` : ": empty response"}`);
  }
  const body = JSON.parse(raw);
  return Number(body.subawards || 0);
}

function normalizeSubaward(row, primeAwardId) {
  return {
    subawardId: String(row.id),
    subawardNumber: row.subaward_number || null,
    primeAwardId,
    actionDate: row.action_date || null,
    amount: Number(row.amount || 0),
    recipientName: row.recipient_name || "Recipient not published",
    description: String(row.description || "").replace(/\s+/g, " ").trim(),
  };
}

function changeFor(current, prior) {
  if (!prior) return "baseline";
  return current.reportedCount !== prior.reportedCount
    || current.latestActionDate !== prior.latestActionDate
    ? "updated"
    : "unchanged";
}

async function fetchPrime(award) {
  const primeAwardId = award.id;
  const reportedCount = await fetchCount(primeAwardId);
  if (!reportedCount) return null;
  let detailError = null;
  let body = { results: [] };
  try {
    body = await postJson({
      award_id: primeAwardId,
      page: 1,
      limit: PAGE_LIMIT,
      sort: "action_date",
      order: "desc",
    });
  } catch (error) {
    detailError = error.message;
  }
  const rows = (body.results || []).map((row) => normalizeSubaward(row, primeAwardId));
  const uniqueRows = [...new Map(rows.map((row) => [row.subawardId, row])).values()];
  const prime = {
    primeAwardId,
    primePiid: award.awardId || null,
    primeRecipient: award.recipient || null,
    primeDescription: award.description || null,
    reportedCount,
    sampledAmount: Number(uniqueRows.reduce((total, row) => total + row.amount, 0).toFixed(2)),
    latestActionDate: uniqueRows.map((row) => row.actionDate).filter(Boolean).sort().at(-1) || null,
    earliestActionDate: uniqueRows.map((row) => row.actionDate).filter(Boolean).sort().at(0) || null,
    sampledCount: Math.min(uniqueRows.length, DETAIL_LIMIT),
    detailTruncated: reportedCount > DETAIL_LIMIT,
    detailStatus: detailError ? "unavailable" : "current",
    detailError,
    subawards: uniqueRows.slice(0, DETAIL_LIMIT),
    status: detailError ? "detail-partial" : "current",
  };
  prime.changeStatus = changeFor(prime, previousByPrime.get(primeAwardId));
  return prime;
}

async function mapConcurrent(items, worker, concurrency) {
  const results = new Array(items.length);
  let cursor = 0;
  async function run() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      try {
        results[index] = { ok: true, item: items[index], value: await worker(items[index]) };
      } catch (error) {
        results[index] = { ok: false, item: items[index], error: error.message };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, run));
  return results;
}

const generatedAt = new Date().toISOString();
const eligibleAwards = awards.filter((award) => award.id).sort((left, right) => Number(right.awardAmountDollars || 0) - Number(left.awardAmountDollars || 0));
const awardsToFetch = (retryFailuresOnly ? eligibleAwards.filter((award) => previousFailureIds.has(award.id)) : eligibleAwards.slice(0, PRIME_LIMIT));
const fetched = await mapConcurrent(awardsToFetch, fetchPrime, CONCURRENCY);
const failures = [];
const allPrimeResults = retryFailuresOnly ? [...(previous.primes || [])] : [];
for (const result of fetched) {
  if (result.ok) {
    const priorIndex = allPrimeResults.findIndex((prime) => prime.primeAwardId === result.item.id);
    if (priorIndex >= 0) allPrimeResults.splice(priorIndex, 1);
    if (result.value) allPrimeResults.push(result.value);
    continue;
  }
  const prior = previousByPrime.get(result.item.id);
  if (prior) {
    allPrimeResults.push({ ...prior, status: "stale", error: result.error, changeStatus: "unchanged" });
  }
  failures.push({ primeAwardId: result.item.id, primePiid: result.item.awardId || null, error: result.error, retainedPrevious: Boolean(prior) });
}
const primes = allPrimeResults.filter((prime) => prime.reportedCount > 0 || prime.status === "stale");
const detailRows = primes.flatMap((prime) => prime.subawards || []);
const out = {
  metadata: {
    title: "USAspending Subaward Snapshot for Indexed DoD Prime Awards",
    generatedAt,
    sourceUrl: API_URL,
    joinBasis: "Exact USAspending generated prime-award identifier",
    countUrl: COUNT_URL,
    methodology: `Exact counts use USAspending's prime-award subaward-count endpoint. Up to ${DETAIL_LIMIT} recent detail rows per positive prime are retained; their dollars are a labeled sample, not a complete subaward total.`,
    indexedPrimeCount: eligibleAwards.length,
    primeLimit: PRIME_LIMIT,
    checkedPrimeCount: awardsToFetch.length,
    successfulPrimeCount: awardsToFetch.length - failures.length,
    coverageStatus: failures.length
      ? (eligibleAwards.length > awardsToFetch.length ? "partial-bounded-high-value-primes" : "partial-indexed-primes")
      : (eligibleAwards.length > awardsToFetch.length ? "bounded-high-value-primes" : "complete-indexed-primes"),
    failedPrimeCount: failures.length,
    primeWithSubawardsCount: primes.filter((prime) => prime.reportedCount > 0).length,
    reportedSubawardCount: primes.reduce((total, prime) => total + Number(prime.reportedCount || 0), 0),
    sampledSubawardAmount: Number(primes.reduce((total, prime) => total + Number(prime.sampledAmount || 0), 0).toFixed(2)),
    retainedDetailCount: detailRows.length,
    changedPrimeCount: primes.filter((prime) => prime.changeStatus === "updated").length,
    stalePrimeCount: primes.filter((prime) => prime.status === "stale").length,
    partialPrimeCount: primes.filter((prime) => prime.status !== "current").length,
    status: failures.length ? (allPrimeResults.length ? "partial" : "unavailable") : "current",
  },
  primes,
  failures,
};

writeFileSync(OUT_FILE, `${JSON.stringify(out, null, 2)}\n`);
console.log(`Subawards: checked=${out.metadata.checkedPrimeCount} positive=${out.metadata.primeWithSubawardsCount} count=${out.metadata.reportedSubawardCount} details=${out.metadata.retainedDetailCount} failures=${out.metadata.failedPrimeCount}`);
