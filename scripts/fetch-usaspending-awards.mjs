import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const DEFAULT_SOURCE_DIR = process.env.HOME
  ? resolve(process.env.HOME, "clawd/artifacts/defense-budget-intelligence/budget")
  : resolve(ROOT, "../artifacts/defense-budget-intelligence/budget");
const SOURCE_DIR = process.env.BUDGET_SOURCE_DIR || DEFAULT_SOURCE_DIR;
const OUT_DIR = process.env.USASPENDING_SOURCE_DIR || resolve(SOURCE_DIR, "usaspending/FY2025-FY2026");
const OUT_FILE = resolve(OUT_DIR, "technology-awards.json");
const SEED_BUDGET_FILE = process.env.USASPENDING_SEED_BUDGET_FILE || resolve(ROOT, "src/data/budget-intelligence.json");
const CHECKPOINT_DIR = process.env.USASPENDING_CHECKPOINT_DIR || resolve(OUT_DIR, "technology-awards.checkpoint");
const API_URL = "https://api.usaspending.gov/api/v2/search/spending_by_award/";
const SPENDING_OVER_TIME_URL = "https://api.usaspending.gov/api/v2/search/spending_over_time/";
const START_DATE = process.env.USASPENDING_START_DATE || "2024-10-01";
const END_DATE = process.env.USASPENDING_END_DATE || new Date().toISOString().slice(0, 10);
const REFRESH_LOOKBACK_DAYS = Math.max(1, Number(process.env.USASPENDING_REFRESH_LOOKBACK_DAYS || 14));
const requestedRefreshStart = new Date(`${END_DATE}T00:00:00Z`);
requestedRefreshStart.setUTCDate(requestedRefreshStart.getUTCDate() - (REFRESH_LOOKBACK_DAYS - 1));
const REFRESH_START_DATE = requestedRefreshStart.toISOString().slice(0, 10) < START_DATE ? START_DATE : requestedRefreshStart.toISOString().slice(0, 10);
const PAGE_SIZE = Math.min(100, Math.max(1, Number(process.env.USASPENDING_PAGE_SIZE || 100)));
const MAX_PAGES = Math.max(0, Number(process.env.USASPENDING_MAX_PAGES || 0));
const DATE_WINDOW_DAYS = Math.max(1, Number(process.env.USASPENDING_DATE_WINDOW_DAYS || 1));
const REQUEST_DELAY_MS = Math.max(0, Number(process.env.USASPENDING_REQUEST_DELAY_MS || 250));
const REQUEST_TIMEOUT_MS = Math.max(5_000, Number(process.env.USASPENDING_REQUEST_TIMEOUT_MS || 60_000));
const RETRIES = Math.max(1, Number(process.env.USASPENDING_RETRIES || 5));
const AREA_PASSES = Math.max(1, Number(process.env.USASPENDING_AREA_PASSES || 10));
const AREA_CONCURRENCY = Math.max(1, Math.min(4, Number(process.env.USASPENDING_AREA_CONCURRENCY || 2)));
const TREND_LIMIT = Number(process.env.USASPENDING_TREND_LIMIT || 8);
const AWARD_TYPE_CODES = Object.freeze(["A", "B", "C", "D", "IDV_A", "IDV_B", "IDV_B_A", "IDV_B_B", "IDV_B_C", "IDV_C", "IDV_D", "IDV_E"]);

const ALL_TECHNOLOGY_QUERIES = [
  {
    id: "ai-decision-advantage",
    label: "AI / Decision Advantage",
    keywords: ["artificial intelligence", "machine learning", "AI/ML", "CDAO"],
  },
  {
    id: "autonomous-systems",
    label: "Autonomous Systems",
    keywords: ["unmanned", "autonomous", "UAS", "counter small unmanned"],
  },
  {
    id: "cyber-operations",
    label: "Cyber Operations",
    keywords: ["cyber", "zero trust", "cyberspace"],
  },
  {
    id: "software-digital-engineering",
    label: "Software / Digital Engineering",
    keywords: ["software", "digital engineering", "modeling and simulation"],
  },
  {
    id: "cloud-data-platforms",
    label: "Cloud / Data Platforms",
    keywords: ["cloud", "data platform", "data analytics"],
  },
  {
    id: "space-systems",
    label: "Space Systems",
    keywords: ["space", "satellite", "missile warning"],
  },
  {
    id: "missiles-fires",
    label: "Missiles / Fires",
    keywords: ["missile", "hypersonic", "munition"],
  },
  {
    id: "readiness-sustainment",
    label: "Readiness / Sustainment",
    keywords: ["sustainment", "maintenance", "readiness"],
  },
  {
    id: "shipbuilding-maritime",
    label: "Shipbuilding / Maritime",
    keywords: ["ship", "submarine", "maritime"],
  },
  {
    id: "aircraft-aviation",
    label: "Aircraft / Aviation",
    keywords: ["aircraft", "aviation", "aircrew"],
  },
  {
    id: "installations-infrastructure",
    label: "Installations / Infrastructure",
    keywords: ["installation", "facility", "military construction"],
  },
];
const requestedAreaIds = new Set(String(process.env.USASPENDING_AREA_IDS || "").split(",").map((value) => value.trim()).filter(Boolean));
const TECHNOLOGY_QUERIES = requestedAreaIds.size ? ALL_TECHNOLOGY_QUERIES.filter((area) => requestedAreaIds.has(area.id)) : ALL_TECHNOLOGY_QUERIES;
if (!TECHNOLOGY_QUERIES.length) throw new Error("USASPENDING_AREA_IDS did not match any configured technology area.");
const CHECKPOINT_FINGERPRINT = JSON.stringify({ refreshStartDate: REFRESH_START_DATE, endDate: END_DATE, pageSize: PAGE_SIZE, maxPages: MAX_PAGES || null, dateWindowDays: DATE_WINDOW_DAYS });

const FIELDS = [
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
  "naics_code",
  "naics_description",
  "psc_code",
  "psc_description",
];

const wait = (duration) => new Promise((resolvePromise) => setTimeout(resolvePromise, duration));

function dateWindows(startDate, endDate) {
  const windows = [];
  let cursor = new Date(`${startDate}T00:00:00Z`);
  const boundary = new Date(`${endDate}T00:00:00Z`);
  while (cursor <= boundary) {
    const windowEnd = new Date(Math.min(boundary.getTime(), cursor.getTime() + (DATE_WINDOW_DAYS - 1) * 86_400_000));
    windows.push({ start_date: cursor.toISOString().slice(0, 10), end_date: windowEnd.toISOString().slice(0, 10) });
    cursor = new Date(windowEnd.getTime() + 86_400_000);
  }
  return windows;
}

function checkpointPath(area) {
  return resolve(CHECKPOINT_DIR, `${area.id}.json`);
}

function readCheckpoint(area) {
  const path = checkpointPath(area);
  if (!existsSync(path)) return null;
  try {
    const value = JSON.parse(readFileSync(path, "utf8"));
    return value.fingerprint === CHECKPOINT_FINGERPRINT ? value : null;
  } catch {
    return null;
  }
}

function writeCheckpoint(area, value) {
  mkdirSync(CHECKPOINT_DIR, { recursive: true });
  const path = checkpointPath(area);
  const temporary = `${path}.tmp`;
  writeFileSync(temporary, `${JSON.stringify({ ...value, fingerprint: CHECKPOINT_FINGERPRINT })}\n`);
  renameSync(temporary, path);
}

async function fetchJson(url, options, label) {
  let lastError;
  for (let attempt = 1; attempt <= RETRIES; attempt += 1) {
    try {
      const response = await fetch(url, { ...options, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
      if (!response.ok) {
        const retryable = response.status === 429 || response.status >= 500;
        if (!retryable || attempt === RETRIES) throw new Error(`${label} returned ${response.status} ${response.statusText}`);
        const retryAfter = Number(response.headers.get("retry-after") || 0) * 1_000;
        await wait(retryAfter || (2 ** (attempt - 1)) * 1_000);
        continue;
      }
      return await response.json();
    } catch (error) {
      lastError = error;
      if (attempt === RETRIES) break;
      await wait((2 ** (attempt - 1)) * 1_000);
    }
  }
  throw lastError || new Error(`${label} failed`);
}

async function fetchArea(area) {
  const windows = dateWindows(REFRESH_START_DATE, END_DATE);
  const payload = {
    filters: {
      agencies: [{ type: "awarding", tier: "toptier", name: "Department of Defense" }],
      award_type_codes: AWARD_TYPE_CODES,
      keywords: area.keywords,
    },
    fields: FIELDS,
    page: 1,
    limit: PAGE_SIZE,
    sort: "Award Amount",
    order: "desc",
    subawards: false,
  };

  const retained = readCheckpoint(area);
  if (retained?.complete) return retained.value;
  let results = retained?.results || [];
  let messages = retained?.messages || [];
  let page = Number(retained?.nextPage || 1);
  let windowIndex = Number(retained?.nextWindowIndex || 0);
  let pagesFetched = Number(retained?.pagesFetched || 0);
  let pageMetadata;
  let truncated = Boolean(retained?.truncated);
  while (windowIndex < windows.length) {
    const window = windows[windowIndex];
    const body = await fetchJson(API_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "user-agent": "defense-budget-intelligence-usaspending-fetch/2.0",
      },
      body: JSON.stringify({ ...payload, filters: { ...payload.filters, time_period: [window] }, page }),
    }, `${area.label} ${window.start_date}–${window.end_date} page ${page}`);
    results.push(...(body.results || []));
    messages.push(...(body.messages || []));
    pageMetadata = body.page_metadata || { page, hasNext: false };
    pagesFetched += 1;
    results = [...new Map(results.map((row) => [row.generated_internal_id || row.internal_id || row["Award ID"], row])).values()];
    messages = [...new Set(messages)];
    if (page >= 100 && (body.results || []).length >= PAGE_SIZE) {
      throw new Error(`${area.label} ${window.start_date}–${window.end_date} reached the USAspending 10,000-row query ceiling; reduce USASPENDING_DATE_WINDOW_DAYS before publishing.`);
    }
    if (MAX_PAGES && pagesFetched >= MAX_PAGES) {
      truncated = true;
      break;
    }
    if (pageMetadata.hasNext) page += 1;
    else {
      windowIndex += 1;
      page = 1;
    }
    if (windowIndex < windows.length) writeCheckpoint(area, { results, messages, nextPage: page, nextWindowIndex: windowIndex, pagesFetched, pageMetadata, truncated: false, complete: false });
    if (REQUEST_DELAY_MS) await wait(REQUEST_DELAY_MS);
  }
  const value = {
    area,
    payload: { ...payload, dateWindows: windows },
    pageMetadata: { ...pageMetadata, pagesFetched, windowsFetched: Math.min(windowIndex + (truncated ? 1 : 0), windows.length), windowCount: windows.length, resultCount: results.length, truncated },
    messages,
    results,
  };
  writeCheckpoint(area, { complete: true, value });
  return value;
}

function normalizeText(value = "") {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalizeVendorName(name = "") {
  const normalized = normalizeText(name).toUpperCase()
    .replace(/\b(CORPORATION|CORP\.?|INCORPORATED|INC\.?|LLC|L\.L\.C\.|LIMITED|LTD\.?)\b/g, "")
    .replace(/[.,]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const aliases = {
    "LOCKHEED MARTIN": "LOCKHEED MARTIN",
    "RAYTHEON COMPANY": "RAYTHEON",
    "RAYTHEON": "RAYTHEON",
    "RTX": "RTX",
    "THE BOEING COMPANY": "BOEING",
    "BOEING": "BOEING",
  };
  return aliases[normalized] || normalized || "UNSPECIFIED RECIPIENT";
}

function dollarsToBillions(value) {
  return Number((Number(value || 0) / 1000000000).toFixed(3));
}

function normalizeAward(raw = {}, area) {
  const fundingSubAgency = normalizeText(raw["Funding Sub Agency"] || "");
  const awardingSubAgency = normalizeText(raw["Awarding Sub Agency"] || "Unspecified DoD buyer");
  return {
    id: raw.generated_internal_id || raw.internal_id || raw["Award ID"],
    areaId: area.id,
    area: area.label,
    recipient: normalizeVendorName(raw["Recipient Name"] || "Unspecified recipient"),
    buyerSubAgency: fundingSubAgency || awardingSubAgency,
    pscCode: normalizeText(raw.psc_code || ""),
    pscDescription: normalizeText(raw.psc_description || ""),
    naicsCode: normalizeText(raw.naics_code || ""),
    naicsDescription: normalizeText(raw.naics_description || ""),
    awardAmount: dollarsToBillions(raw["Award Amount"]),
    awardType: normalizeText(raw["Contract Award Type"] || ""),
  };
}

function aggregateDimension(awards, keyFn, limit = TREND_LIMIT) {
  const groups = new Map();
  for (const award of awards) {
    const key = keyFn(award);
    if (!key?.id) continue;
    const existing = groups.get(key.id) || { ...key, sourceAwardAmount: 0, sourceAwardCount: 0 };
    existing.sourceAwardAmount += award.awardAmount;
    existing.sourceAwardCount += 1;
    groups.set(key.id, existing);
  }
  return [...groups.values()]
    .map((row) => ({ ...row, sourceAwardAmount: Number(row.sourceAwardAmount.toFixed(3)) }))
    .sort((a, b) => b.sourceAwardAmount - a.sourceAwardAmount)
    .slice(0, limit);
}

async function fetchSpendingOverTime(series) {
  const payload = {
    filters: {
      time_period: [{ start_date: START_DATE, end_date: END_DATE }],
      agencies: [{ type: "awarding", tier: "toptier", name: "Department of Defense" }],
      award_type_codes: AWARD_TYPE_CODES,
      ...series.filters,
    },
    group: "quarter",
  };

  const body = await fetchJson(SPENDING_OVER_TIME_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "user-agent": "defense-budget-intelligence-usaspending-fetch/1.0",
    },
    body: JSON.stringify(payload),
  }, `${series.label} spending-over-time`);
  return {
    id: series.id,
    label: series.label,
    group: series.group,
    filters: series.filters,
    sourceAwardAmount: series.sourceAwardAmount,
    sourceAwardCount: series.sourceAwardCount,
    results: body.results || [],
  };
}

mkdirSync(OUT_DIR, { recursive: true });

function retainedAwards() {
  if (!existsSync(SEED_BUDGET_FILE)) return [];
  try {
    const budget = JSON.parse(readFileSync(SEED_BUDGET_FILE, "utf8"));
    const awards = budget.metadata?.dataInventory?.strategyAnalytics?.executionAnalytics?.awardDrilldown?.awards;
    return Array.isArray(awards) ? awards : [];
  } catch {
    return [];
  }
}

const priorAwards = retainedAwards();

const areas = [];
let remaining = TECHNOLOGY_QUERIES;
let failed = [];
for (let pass = 1; pass <= AREA_PASSES && remaining.length; pass += 1) {
  failed = [];
  let areaCursor = 0;
  async function areaWorker() {
    while (areaCursor < remaining.length) {
      const area = remaining[areaCursor++];
      try {
        areas.push(await fetchArea(area));
      } catch (error) {
        failed.push({ area, error: error.message });
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(AREA_CONCURRENCY, remaining.length) }, () => areaWorker()));
  remaining = failed.map((entry) => entry.area);
  if (remaining.length && pass < AREA_PASSES) await wait(pass * 15_000);
}

if (failed.length) {
  throw new Error(`USAspending award refresh was incomplete: ${failed.map((entry) => `${entry.area.label}: ${entry.error}`).join("; ")}. The prior verified snapshot was preserved.`);
}

const awardEntries = areas.flatMap((areaResult) => (
  (areaResult.results || []).map((award) => normalizeAward(award, areaResult.area))
));
const uniqueAwards = [...new Map(awardEntries.map((award) => [award.id, award])).values()];
const buyerSeries = aggregateDimension(uniqueAwards, (award) => ({
  id: award.buyerSubAgency,
  label: award.buyerSubAgency,
  filters: { agencies: [{ type: "funding", tier: "subtier", name: award.buyerSubAgency }] },
}));
const vendorSeries = aggregateDimension(uniqueAwards, (award) => ({
  id: award.recipient,
  label: award.recipient,
  filters: { recipient_search_text: [award.recipient] },
}));
const pscSeries = aggregateDimension(uniqueAwards, (award) => ({
  id: award.pscCode,
  label: award.pscCode ? `${award.pscCode} · ${award.pscDescription || "Unlabeled PSC"}` : "",
  filters: award.pscCode ? { psc_codes: [award.pscCode] } : null,
})).filter((series) => series.filters);
const naicsSeries = aggregateDimension(uniqueAwards, (award) => ({
  id: award.naicsCode,
  label: award.naicsCode ? `${award.naicsCode} · ${award.naicsDescription || "Unlabeled NAICS"}` : "",
  filters: award.naicsCode ? { naics_codes: [award.naicsCode] } : null,
})).filter((series) => series.filters);
const technologySeries = TECHNOLOGY_QUERIES.map((area) => ({
  id: area.id,
  label: area.label,
  filters: { keywords: area.keywords },
  sourceAwardAmount: aggregateDimension(awardEntries.filter((award) => award.areaId === area.id), () => ({ id: area.id, label: area.label }), 1)[0]?.sourceAwardAmount || 0,
  sourceAwardCount: awardEntries.filter((award) => award.areaId === area.id).length,
}));

const spendingOverTime = {
  technologyAreas: [],
  buyerAgencies: [],
  vendors: [],
  psc: [],
  naics: [],
};
const trendFailed = [];
for (const [groupKey, seriesList] of Object.entries({
  technologyAreas: technologySeries,
  buyerAgencies: buyerSeries,
  vendors: vendorSeries,
  psc: pscSeries,
  naics: naicsSeries,
})) {
  for (const series of seriesList) {
    try {
      spendingOverTime[groupKey].push(await fetchSpendingOverTime(series));
    } catch (error) {
      trendFailed.push({ group: groupKey, id: series.id, label: series.label, error: error.message });
    }
  }
}

const out = {
  metadata: {
    title: "USAspending DoD Technology Award Snapshot",
    generatedAt: new Date().toISOString(),
    sourceUrl: API_URL,
    spendingOverTimeUrl: SPENDING_OVER_TIME_URL,
    startDate: START_DATE,
    endDate: END_DATE,
    methodology: `Retained Department of Defense technology-area contract awards, IDVs, orders, and calls plus every paginated result in the rolling ${REFRESH_LOOKBACK_DAYS}-day refresh window. Each query is partitioned into one-day windows to stay below the USAspending per-query result ceiling, then merged by generated award identifier. The corpus grows incrementally and does not claim historical or exhaustive DoW coverage. Quarterly obligation time series use USAspending spending_over_time.`,
    coverageStatus: "incremental-growing-query-boundary",
    pageSize: PAGE_SIZE,
    maxPages: MAX_PAGES || null,
    dateWindowDays: DATE_WINDOW_DAYS,
    refreshLookbackDays: REFRESH_LOOKBACK_DAYS,
    refreshStartDate: REFRESH_START_DATE,
    dateWindowCount: dateWindows(REFRESH_START_DATE, END_DATE).length,
    retainedAwardCount: priorAwards.length,
    trendLimit: TREND_LIMIT,
    areaCount: TECHNOLOGY_QUERIES.length,
    awardTypeCodes: AWARD_TYPE_CODES,
    cachedAreaCount: areas.length,
    failedAreaCount: failed.length,
    truncatedAreaCount: areas.filter((entry) => entry.pageMetadata?.truncated).length,
    pageCount: areas.reduce((total, entry) => total + Number(entry.pageMetadata?.pagesFetched || 0), 0),
    resultCount: areas.reduce((total, entry) => total + Number(entry.results?.length || 0), 0),
    trendSeriesCount: Object.values(spendingOverTime).reduce((total, series) => total + series.length, 0),
    failedTrendSeriesCount: trendFailed.length,
  },
  retainedAwards: priorAwards,
  areas,
  spendingOverTime,
  failed,
  trendFailed,
};

writeFileSync(OUT_FILE, `${JSON.stringify(out, null, 2)}\n`);
rmSync(CHECKPOINT_DIR, { recursive: true, force: true });
console.log(`Cached USAspending awards for ${areas.length} technology areas and ${out.metadata.trendSeriesCount} trend series in ${OUT_FILE}; ${failed.length} award calls and ${trendFailed.length} trend calls failed.`);
