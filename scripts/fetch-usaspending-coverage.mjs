import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const DEFAULT_ARTIFACT_DIR = process.env.HOME
  ? resolve(process.env.HOME, "clawd/artifacts/defense-budget-intelligence/usaspending")
  : resolve(ROOT, "../artifacts/defense-budget-intelligence/usaspending");
const ARTIFACT_DIR = process.env.USASPENDING_COVERAGE_SOURCE_DIR || DEFAULT_ARTIFACT_DIR;
const ARTIFACT_FILE = resolve(ARTIFACT_DIR, "dod-contract-coverage.json");
const OUT_FILE = resolve(ROOT, "src/data/usaspending-coverage.json");
const API = "https://api.usaspending.gov/api/v2/search";
const GENERATED_AT = new Date().toISOString();
const AS_OF = process.env.USASPENDING_COVERAGE_END_DATE || GENERATED_AT.slice(0, 10);
const FIRST_FISCAL_YEAR = Math.max(2008, Number(process.env.USASPENDING_COVERAGE_FIRST_FY || 2017));
const currentDate = new Date(`${AS_OF}T00:00:00Z`);
const CURRENT_FISCAL_YEAR = currentDate.getUTCMonth() >= 9 ? currentDate.getUTCFullYear() + 1 : currentDate.getUTCFullYear();
const LAST_FISCAL_YEAR = Math.max(FIRST_FISCAL_YEAR, Number(process.env.USASPENDING_COVERAGE_LAST_FY || CURRENT_FISCAL_YEAR));
const PAGE_SIZE = Math.min(100, Math.max(1, Number(process.env.USASPENDING_COVERAGE_PAGE_SIZE || 100)));
const TOP_AWARD_LIMIT = Math.max(100, Number(process.env.USASPENDING_COVERAGE_TOP_AWARDS || 500));
const TOP_IDV_LIMIT = Math.max(50, Number(process.env.USASPENDING_COVERAGE_TOP_IDVS || 100));
const CATEGORY_LIMITS = Object.freeze({
  awarding_subagency: Math.max(25, Number(process.env.USASPENDING_COVERAGE_AGENCY_LIMIT || 100)),
  funding_subagency: Math.max(25, Number(process.env.USASPENDING_COVERAGE_AGENCY_LIMIT || 100)),
  recipient: Math.max(100, Number(process.env.USASPENDING_COVERAGE_RECIPIENT_LIMIT || 250)),
  psc: Math.max(100, Number(process.env.USASPENDING_COVERAGE_CLASSIFICATION_LIMIT || 250)),
  naics: Math.max(100, Number(process.env.USASPENDING_COVERAGE_CLASSIFICATION_LIMIT || 250)),
});
const CONCURRENCY = Math.max(1, Math.min(4, Number(process.env.USASPENDING_COVERAGE_CONCURRENCY || 3)));
const TIMEOUT_MS = Math.max(10_000, Number(process.env.USASPENDING_COVERAGE_TIMEOUT_MS || 60_000));
const RETRIES = Math.max(2, Number(process.env.USASPENDING_COVERAGE_RETRIES || 6));
const CONTRACT_CODES = Object.freeze(["A", "B", "C", "D"]);
const IDV_CODES = Object.freeze(["IDV_A", "IDV_B", "IDV_B_A", "IDV_B_B", "IDV_B_C", "IDV_C", "IDV_D", "IDV_E"]);
const AWARD_FIELDS = Object.freeze([
  "Award ID",
  "Recipient Name",
  "Award Amount",
  "Start Date",
  "End Date",
  "Awarding Agency",
  "Awarding Sub Agency",
  "Awarding Office",
  "Funding Agency",
  "Funding Sub Agency",
  "Funding Office",
  "Description",
  "Contract Award Type",
  "recipient_id",
  "prime_award_recipient_uei",
  "naics_code",
  "naics_description",
  "psc_code",
  "psc_description",
  "Place of Performance State Code",
]);

function fiscalWindow(fiscalYear) {
  const start = `${fiscalYear - 1}-10-01`;
  const canonicalEnd = `${fiscalYear}-09-30`;
  return { startDate: start, endDate: canonicalEnd < AS_OF ? canonicalEnd : AS_OF };
}

function baseFilters(fiscalYear, awardTypeCodes = CONTRACT_CODES) {
  const window = fiscalWindow(fiscalYear);
  return {
    time_period: [{ start_date: window.startDate, end_date: window.endDate }],
    agencies: [{ type: "awarding", tier: "toptier", name: "Department of Defense" }],
    award_type_codes: awardTypeCodes,
  };
}

const wait = (duration) => new Promise((resolvePromise) => setTimeout(resolvePromise, duration));

async function fetchJson(url, body, label) {
  let lastError;
  for (let attempt = 1; attempt <= RETRIES; attempt += 1) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", "user-agent": "defense-budget-intelligence-coverage/1.0" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!response.ok) {
        const message = `${label} returned ${response.status} ${response.statusText}`;
        if (attempt === RETRIES || (response.status !== 429 && response.status < 500)) throw new Error(message);
        const retryAfter = Number(response.headers.get("retry-after") || 0) * 1_000;
        await wait(Math.max(retryAfter, Math.min(15_000, 750 * (2 ** (attempt - 1)))));
        continue;
      }
      return await response.json();
    } catch (error) {
      lastError = error;
      if (attempt === RETRIES) break;
      await wait(Math.min(15_000, 750 * (2 ** (attempt - 1))));
    }
  }
  throw lastError || new Error(`${label} failed`);
}

async function mapLimit(items, limit, mapper) {
  const values = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      values[index] = await mapper(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return values;
}

async function fetchAnnualTotals() {
  const window = { start_date: fiscalWindow(FIRST_FISCAL_YEAR).startDate, end_date: fiscalWindow(LAST_FISCAL_YEAR).endDate };
  const result = await fetchJson(`${API}/spending_over_time/`, {
    group: "fiscal_year",
    filters: {
      time_period: [window],
      agencies: [{ type: "awarding", tier: "toptier", name: "Department of Defense" }],
      award_type_codes: [...CONTRACT_CODES, ...IDV_CODES],
    },
  }, "DoD fiscal-year obligations");
  return (result.results || []).map((row) => ({
    fiscalYear: Number(row.time_period?.fiscal_year || 0),
    obligatedAmount: Number(row.Contract_Obligations ?? row.aggregated_amount ?? 0),
    sourceMeasure: "Contract_Obligations",
  })).filter((row) => row.fiscalYear >= FIRST_FISCAL_YEAR && row.fiscalYear <= LAST_FISCAL_YEAR);
}

async function fetchCategory(fiscalYear, category, limit) {
  const rows = [];
  const seen = new Set();
  const pages = Math.ceil(limit / PAGE_SIZE);
  for (let page = 1; page <= pages; page += 1) {
    const body = await fetchJson(`${API}/spending_by_category/${category}/`, {
      category,
      limit: Math.min(PAGE_SIZE, limit - rows.length),
      page,
      filters: baseFilters(fiscalYear),
    }, `FY${fiscalYear} ${category}`);
    let added = 0;
    for (const row of body.results || []) {
      const identity = category === "recipient"
        ? row.uei || row.recipient_id || row.id || row.code || row.name
        : row.id ?? row.code ?? row.name;
      const key = String(identity || "unlabeled");
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push({
        rank: rows.length + 1,
        id: row.id ?? row.recipient_id ?? null,
        code: row.code || null,
        name: row.name || "Unlabeled",
        uei: row.uei || null,
        obligatedAmount: Number(row.amount || 0),
      });
      added += 1;
      if (rows.length >= limit) break;
    }
    if (!body.page_metadata?.hasNext || rows.length >= limit || added === 0) break;
  }
  return rows;
}

function normalizeAward(row, fiscalYear, rank, kind) {
  return {
    fiscalYear,
    rank,
    kind,
    generatedAwardId: row.generated_internal_id || null,
    piid: row["Award ID"] || null,
    recipient: row["Recipient Name"] || null,
    recipientId: row.recipient_id || null,
    recipientUei: row.prime_award_recipient_uei || null,
    awardAmount: Number(row["Award Amount"] || 0),
    startDate: row["Start Date"] || null,
    endDate: row["End Date"] || null,
    awardType: row["Contract Award Type"] || null,
    description: row.Description || null,
    awardingSubAgency: row["Awarding Sub Agency"] || null,
    awardingOffice: row["Awarding Office"] || null,
    fundingSubAgency: row["Funding Sub Agency"] || null,
    fundingOffice: row["Funding Office"] || null,
    naicsCode: row.naics_code || row["NAICS Code"] || null,
    naicsDescription: row.naics_description || null,
    pscCode: row.psc_code || row["PSC Code"] || null,
    pscDescription: row.psc_description || null,
    placeOfPerformanceState: row["Place of Performance State Code"] || null,
    sourceUrl: row.generated_internal_id ? `https://www.usaspending.gov/award/${encodeURIComponent(row.generated_internal_id)}/` : "https://www.usaspending.gov/",
  };
}

async function fetchTopAwards(fiscalYear, kind, codes, limit) {
  const rows = [];
  const pages = Math.ceil(limit / PAGE_SIZE);
  for (let page = 1; page <= pages; page += 1) {
    const body = await fetchJson(`${API}/spending_by_award/`, {
      subawards: false,
      limit: Math.min(PAGE_SIZE, limit - rows.length),
      page,
      sort: "Award Amount",
      order: "desc",
      fields: AWARD_FIELDS,
      filters: baseFilters(fiscalYear, codes),
    }, `FY${fiscalYear} top ${kind}`);
    for (const row of body.results || []) {
      rows.push(normalizeAward(row, fiscalYear, rows.length + 1, kind));
      if (rows.length >= limit) break;
    }
    if (!body.page_metadata?.hasNext || rows.length >= limit) break;
  }
  return rows;
}

const fiscalYears = Array.from({ length: LAST_FISCAL_YEAR - FIRST_FISCAL_YEAR + 1 }, (_, index) => FIRST_FISCAL_YEAR + index);
const annualTotals = await fetchAnnualTotals();
const annualTotalByYear = new Map(annualTotals.map((row) => [row.fiscalYear, row]));
const years = await mapLimit(fiscalYears, CONCURRENCY, async (fiscalYear) => {
  const categories = {};
  for (const [category, limit] of Object.entries(CATEGORY_LIMITS)) {
    categories[category] = await fetchCategory(fiscalYear, category, limit);
  }
  const [topContracts, topIdvs] = await Promise.all([
    fetchTopAwards(fiscalYear, "contract", CONTRACT_CODES, TOP_AWARD_LIMIT),
    fetchTopAwards(fiscalYear, "idv", IDV_CODES, TOP_IDV_LIMIT),
  ]);
  const window = fiscalWindow(fiscalYear);
  return {
    fiscalYear,
    startDate: window.startDate,
    endDate: window.endDate,
    status: fiscalYear === CURRENT_FISCAL_YEAR ? "year-to-date" : "complete-fiscal-year",
    obligatedAmount: annualTotalByYear.get(fiscalYear)?.obligatedAmount || 0,
    categories,
    topContracts,
    topIdvs,
  };
});

const recipientUeiById = new Map();
for (const year of years) {
  for (const recipient of year.categories.recipient || []) {
    if (recipient.id && recipient.uei) recipientUeiById.set(recipient.id, recipient.uei);
  }
  for (const award of [...year.topContracts, ...year.topIdvs]) {
    if (!award.recipientUei && award.recipientId) award.recipientUei = recipientUeiById.get(award.recipientId) || null;
  }
}

const uniqueAwards = new Map();
for (const year of years) {
  for (const award of [...year.topContracts, ...year.topIdvs]) {
    const key = award.generatedAwardId || `${award.kind}:${award.piid}`;
    const current = uniqueAwards.get(key) || { ...award, observedFiscalYears: [], fiscalYearRanks: [] };
    current.observedFiscalYears.push(year.fiscalYear);
    current.fiscalYearRanks.push({ fiscalYear: year.fiscalYear, rank: award.rank, kind: award.kind });
    if (award.awardAmount > current.awardAmount) Object.assign(current, award);
    uniqueAwards.set(key, current);
  }
}

const output = {
  metadata: {
    schemaVersion: "1.0.0",
    title: "USAspending Department of Defense Contract Coverage",
    generatedAt: GENERATED_AT,
    dataThrough: AS_OF,
    firstFiscalYear: FIRST_FISCAL_YEAR,
    lastFiscalYear: LAST_FISCAL_YEAR,
    fiscalYearCount: fiscalYears.length,
    sourceUrls: {
      spendingOverTime: `${API}/spending_over_time/`,
      spendingByCategory: `${API}/spending_by_category/{category}/`,
      spendingByAward: `${API}/spending_by_award/`,
    },
    scope: "Department of Defense contract transactions. Annual obligations are complete within the disclosed agency, award-type, and fiscal-year filters. Category and award lists are explicitly ranked and bounded.",
    amountPolicy: "Fiscal-year totals and category amounts are transaction obligations in the selected fiscal year. Top-award and IDV values are published award-level totals or ceilings and must never be added to fiscal-year obligations.",
    coverage: {
      annualObligationSeries: "complete-query-boundary",
      categoryRows: Object.fromEntries(Object.entries(CATEGORY_LIMITS).map(([key, value]) => [key, { perFiscalYearLimit: value, coverage: "ranked-bounded" }])),
      topContractsPerFiscalYear: TOP_AWARD_LIMIT,
      topIdvsPerFiscalYear: TOP_IDV_LIMIT,
      uniqueRankedAwards: uniqueAwards.size,
      realizedCategoryRows: Object.fromEntries(Object.keys(CATEGORY_LIMITS).map((category) => [
        category,
        years.reduce((total, year) => total + (year.categories[category]?.length || 0), 0),
      ])),
    },
  },
  annualTotals,
  years: years.map((year) => ({
    ...year,
    topContracts: year.topContracts.map(({ generatedAwardId, piid, rank }) => ({ generatedAwardId, piid, rank })),
    topIdvs: year.topIdvs.map(({ generatedAwardId, piid, rank }) => ({ generatedAwardId, piid, rank })),
  })),
  awards: [...uniqueAwards.values()].sort((a, b) => b.awardAmount - a.awardAmount || String(a.generatedAwardId).localeCompare(String(b.generatedAwardId))),
};

function atomicWrite(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`);
  renameSync(temporary, path);
}

atomicWrite(ARTIFACT_FILE, output);
atomicWrite(OUT_FILE, output);
console.log(`Collected FY${FIRST_FISCAL_YEAR}-FY${LAST_FISCAL_YEAR} DoD contract coverage: ${annualTotals.length} annual totals, ${output.awards.length} unique ranked awards/IDVs, and ${years.reduce((total, year) => total + Object.values(year.categories).reduce((sum, rows) => sum + rows.length, 0), 0)} category rows.`);
