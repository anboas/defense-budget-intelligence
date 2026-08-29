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
const START_DATE = process.env.USASPENDING_START_DATE || "2024-10-01";
const END_DATE = process.env.USASPENDING_END_DATE || new Date().toISOString().slice(0, 10);
const LIMIT = Number(process.env.USASPENDING_LIMIT || 75);

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

const out = {
  metadata: {
    title: "USAspending DoD Technology Award Snapshot",
    generatedAt: new Date().toISOString(),
    sourceUrl: API_URL,
    startDate: START_DATE,
    endDate: END_DATE,
    methodology: "Top Department of Defense contract awards by technology-area keyword search using USAspending award search. Values are award amounts returned by USAspending, not audited budget-line obligations.",
    limitPerArea: LIMIT,
    areaCount: TECHNOLOGY_QUERIES.length,
    cachedAreaCount: areas.length,
    failedAreaCount: failed.length,
  },
  areas,
  failed,
};

writeFileSync(OUT_FILE, `${JSON.stringify(out, null, 2)}\n`);
console.log(`Cached USAspending awards for ${areas.length} technology areas in ${OUT_FILE}; ${failed.length} failed.`);
