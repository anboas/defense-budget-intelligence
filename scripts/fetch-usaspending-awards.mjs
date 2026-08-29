import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const DEFAULT_SOURCE_DIR = process.env.HOME
  ? resolve(process.env.HOME, "clawd/artifacts/defense-budget-intelligence/budget")
  : resolve(ROOT, "../artifacts/defense-budget-intelligence/budget");
const SOURCE_DIR = process.env.BUDGET_SOURCE_DIR || DEFAULT_SOURCE_DIR;
const OUT_DIR = process.env.USASPENDING_SOURCE_DIR || resolve(SOURCE_DIR, "usaspending/FY2025-FY2026");
const OUT_FILE = resolve(OUT_DIR, "technology-awards.json");
const API_URL = "https://api.usaspending.gov/api/v2/search/spending_by_award/";
const SPENDING_OVER_TIME_URL = "https://api.usaspending.gov/api/v2/search/spending_over_time/";
const START_DATE = process.env.USASPENDING_START_DATE || "2024-10-01";
const END_DATE = process.env.USASPENDING_END_DATE || new Date().toISOString().slice(0, 10);
const LIMIT = Number(process.env.USASPENDING_LIMIT || 75);
const TREND_LIMIT = Number(process.env.USASPENDING_TREND_LIMIT || 8);

const TECHNOLOGY_QUERIES = [
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

async function fetchArea(area) {
  const payload = {
    filters: {
      time_period: [{ start_date: START_DATE, end_date: END_DATE }],
      agencies: [{ type: "awarding", tier: "toptier", name: "Department of Defense" }],
      award_type_codes: ["A", "B", "C", "D"],
      keywords: area.keywords,
    },
    fields: FIELDS,
    page: 1,
    limit: LIMIT,
    sort: "Award Amount",
    order: "desc",
    subawards: false,
  };

  const response = await fetch(API_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "user-agent": "defense-budget-intelligence-usaspending-fetch/1.0",
    },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }
  const body = await response.json();
  return {
    area,
    payload,
    pageMetadata: body.page_metadata,
    messages: body.messages || [],
    results: body.results || [],
  };
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
      award_type_codes: ["A", "B", "C", "D"],
      ...series.filters,
    },
    group: "quarter",
  };

  const response = await fetch(SPENDING_OVER_TIME_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "user-agent": "defense-budget-intelligence-usaspending-fetch/1.0",
    },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }
  const body = await response.json();
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

const areas = [];
const failed = [];
for (const area of TECHNOLOGY_QUERIES) {
  try {
    areas.push(await fetchArea(area));
  } catch (error) {
    failed.push({ area, error: error.message });
  }
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
    methodology: "Top Department of Defense contract awards by technology-area keyword search using USAspending award search, plus quarterly contract-obligation time series from USAspending spending_over_time for selected technology, buyer, vendor, PSC, and NAICS filters.",
    limitPerArea: LIMIT,
    trendLimit: TREND_LIMIT,
    areaCount: TECHNOLOGY_QUERIES.length,
    cachedAreaCount: areas.length,
    failedAreaCount: failed.length,
    trendSeriesCount: Object.values(spendingOverTime).reduce((total, series) => total + series.length, 0),
    failedTrendSeriesCount: trendFailed.length,
  },
  areas,
  spendingOverTime,
  failed,
  trendFailed,
};

writeFileSync(OUT_FILE, `${JSON.stringify(out, null, 2)}\n`);
console.log(`Cached USAspending awards for ${areas.length} technology areas and ${out.metadata.trendSeriesCount} trend series in ${OUT_FILE}; ${failed.length} award calls and ${trendFailed.length} trend calls failed.`);
