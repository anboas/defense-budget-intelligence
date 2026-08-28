import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const DEFAULT_SOURCE_DIR = process.env.HOME ? resolve(process.env.HOME, "clawd/artifacts/defense-budget-intelligence/budget") : resolve(ROOT, "../artifacts/defense-budget-intelligence/budget");
const SOURCE_DIR = process.env.BUDGET_SOURCE_DIR || DEFAULT_SOURCE_DIR;
const OUT_FILE = resolve(ROOT, "src/data/budget-intelligence.json");
const CURRENT_REQUEST_YEAR = 2027;

const BOOKS = [
  { id: "M-1", file: "m1_display.xlsx", color: "Military Personnel", short: "MILPERS" },
  { id: "O-1", file: "o1_display.xlsx", color: "Operations and Maintenance", short: "O&M" },
  { id: "P-1", file: "p1_display.xlsx", color: "Procurement", short: "PROC" },
  { id: "R-1", file: "r1_display.xlsx", color: "Research, Development, Test, and Evaluation", short: "RDT&E" },
  { id: "RF-1", file: "rf1_display.xlsx", color: "Revolving and Management Funds", short: "RF" },
  { id: "C-1", file: "c1_display.xlsx", color: "MILCON / Family Housing / BRAC", short: "MILCON" },
];

function sourceUrl(book, requestYear) {
  return `https://comptroller.war.gov/Portals/45/Documents/defbudget/FY${requestYear}/${book.file}`;
}

function fiscalYearsForRequest(requestYear) {
  return [requestYear - 2, requestYear - 1, requestYear];
}

const REQUEST_PACKAGES = [
  { requestYear: 2024, sourceDir: resolve(SOURCE_DIR, "FY2024"), sourcePackage: "FY2024 Defense Budget Materials" },
  { requestYear: 2025, sourceDir: resolve(SOURCE_DIR, "FY2025"), sourcePackage: "FY2025 Defense Budget Materials" },
  { requestYear: 2026, sourceDir: resolve(SOURCE_DIR, "FY2026"), sourcePackage: "FY2026 Defense Budget Materials" },
  { requestYear: CURRENT_REQUEST_YEAR, sourceDir: SOURCE_DIR, sourcePackage: "FY2027 Defense Budget Materials" },
].map((requestPackage) => ({
  ...requestPackage,
  fiscalYears: fiscalYearsForRequest(requestPackage.requestYear),
}));

const SOURCE_NOTES = {
  "M-1": "End strength and military personnel appropriations by account, activity, and organization.",
  "O-1": "Operation and maintenance appropriations covering readiness, sustainment, administration, and activity lines.",
  "P-1": "Procurement appropriations by budget line item, account, and service or defense-wide organization.",
  "R-1": "Research, Development, Test, and Evaluation program elements and budget activities.",
  "RF-1": "Revolving and management fund accounts, including working capital and other fund activity.",
  "C-1": "Military construction, family housing, and BRAC project-level entries by fiscal year.",
};

const SOURCE_LAYERS = [
  {
    id: "request-display-books",
    label: "Budget request line items",
    status: "Live",
    coverage: "FY2024-FY2027 President's Budget display workbooks, with current FY2027 all-color coverage and historical coverage for M-1, O-1, P-1, R-1, and RF-1.",
    role: "Baseline portfolio, color-of-money, organization, program, mission-signal, and request-vintage trend analysis.",
  },
  {
    id: "justification-documents",
    label: "Program narrative",
    status: "Next",
    coverage: "RDT&E and procurement justification books, especially program-element PDFs with narrative detail.",
    role: "Explains why a line is growing, which performers or technical areas are named, and where AI/autonomy signals are hidden outside titles.",
  },
  {
    id: "obligations-outlays",
    label: "Execution spend",
    status: "Next",
    coverage: "USAspending and FPDS/SAM obligation records tied to awarding offices, recipients, PSC/NAICS, and award descriptions.",
    role: "Separates requested budget from actual obligated spend and enables vendor, vehicle, and buyer drilldown.",
  },
  {
    id: "market-timing",
    label: "Opportunity timing",
    status: "Next",
    coverage: "SAM.gov opportunities, acquisition forecasts, and public DoD contract notices.",
    role: "Connects budget lines to near-term capture timing, recompetes, and contract vehicles.",
  },
];

const PIPELINE_SOURCES = [
  {
    id: "prior-year-comptroller-books",
    name: "Prior-Year Comptroller Display Books",
    publisher: "Office of the Under Secretary of Defense (Comptroller)",
    url: "https://comptroller.war.gov/Budget-Materials/",
    priority: 1,
    status: "Partially ingested",
    layer: "Budget request history",
    cadence: "Annual President's Budget releases",
    access: "Public XLSX/PDF downloads",
    readiness: 92,
    impact: 88,
    effort: "Medium",
    joinKeys: ["budget activity", "program element / line item", "appropriation account", "organization"],
    firstTask: "Discover historical C-1 workbook naming and backfill MILCON request package history.",
    value: "Creates request-over-request trend history instead of relying only on values embedded in the FY2027 package.",
  },
  {
    id: "rdte-justification-books",
    name: "RDT&E Justification Books",
    publisher: "Office of the Under Secretary of Defense (Comptroller)",
    url: "https://comptroller.war.gov/Budget-Materials/Budget2027/",
    priority: 2,
    status: "Ready for triage",
    layer: "Program narrative",
    cadence: "Annual President's Budget releases",
    access: "Public PDF downloads",
    readiness: 78,
    impact: 92,
    effort: "High",
    joinKeys: ["program element", "project number", "service", "budget activity"],
    firstTask: "Extract R-1 program-element narratives for AI/autonomy and software-heavy lines.",
    value: "Adds technical rationale, named initiatives, and mission context that display workbooks compress into short titles.",
  },
  {
    id: "usaspending-awards",
    name: "USAspending Award Search",
    publisher: "U.S. Department of the Treasury",
    url: "https://api.usaspending.gov/docs/",
    priority: 3,
    status: "API candidate",
    layer: "Obligations and outlays",
    cadence: "Regular federal award updates",
    access: "Public API",
    readiness: 72,
    impact: 96,
    effort: "High",
    joinKeys: ["awarding agency", "funding agency", "program activity", "PSC", "NAICS", "award description"],
    firstTask: "Prototype DoD obligation pulls by fiscal year, awarding agency, recipient, PSC, and keyword.",
    value: "Turns budget request lines into execution-side spend views with vendor and award drilldown.",
  },
  {
    id: "fpds-contract-data",
    name: "FPDS / SAM.gov Contract Data",
    publisher: "General Services Administration",
    url: "https://sam.gov/contracting",
    priority: 4,
    status: "API candidate",
    layer: "Contract actions",
    cadence: "Regular procurement action updates",
    access: "Public search and data services",
    readiness: 64,
    impact: 86,
    effort: "High",
    joinKeys: ["contracting office", "recipient", "PSC", "NAICS", "PIID", "award description"],
    firstTask: "Map obligation-heavy AI/autonomy and software lines to recent DoD contract actions.",
    value: "Adds action-level contract execution, vehicles, offices, and performers beneath budget themes.",
  },
  {
    id: "sam-opportunities",
    name: "SAM.gov Contract Opportunities",
    publisher: "General Services Administration",
    url: "https://open.gsa.gov/api/get-opportunities-public-api/",
    priority: 5,
    status: "API candidate",
    layer: "Market timing",
    cadence: "Daily opportunity updates",
    access: "Public API with key",
    readiness: 68,
    impact: 82,
    effort: "Medium",
    joinKeys: ["agency", "office", "notice type", "NAICS", "PSC", "description keywords"],
    firstTask: "Pull active DoD opportunities matching high-growth budget signals and agency filters.",
    value: "Connects spending posture to live solicitations, sources sought, and recompete timing.",
  },
];

const SOURCE_JOIN_PATHS = [
  {
    id: "request-to-narrative",
    from: "Budget line item",
    to: "Program narrative",
    confidence: "High",
    bridge: "Program element, budget activity, project number, account, service",
    unlocks: "Technical rationale, named initiatives, performer clues, and hidden AI/autonomy signals.",
  },
  {
    id: "request-to-obligations",
    from: "Budget request",
    to: "Obligated spend",
    confidence: "Medium",
    bridge: "Agency, organization, program activity, PSC/NAICS, fiscal year, keyword match",
    unlocks: "Execution burn, vendor concentration, award vehicle analysis, and request-to-spend comparison.",
  },
  {
    id: "obligations-to-contracts",
    from: "Award totals",
    to: "Contract actions",
    confidence: "Medium",
    bridge: "PIID, recipient, contracting office, PSC/NAICS, award description",
    unlocks: "Buyer offices, action history, contract vehicles, performers, and recompete patterns.",
  },
  {
    id: "request-to-opportunities",
    from: "Budget signal",
    to: "Market timing",
    confidence: "Directional",
    bridge: "Agency, office, NAICS/PSC, description keywords, mission signal",
    unlocks: "Active notices, sources sought, solicitation timing, and capture-entry points.",
  },
];

const missingSource = BOOKS.find((book) => !existsSync(resolve(SOURCE_DIR, book.file)));
if (missingSource) {
  if (existsSync(OUT_FILE)) {
    console.warn(`Source workbook ${missingSource.file} not found in ${SOURCE_DIR}; using committed ${OUT_FILE}.`);
    process.exit(0);
  }
  throw new Error(`Missing source workbook: ${resolve(SOURCE_DIR, missingSource.file)}`);
}

const SERVICES = new Map([
  ["A", "Army"],
  ["N", "Navy / Marine Corps"],
  ["F", "Air Force / Space Force"],
]);

const GROUP_LABELS = {
  service: "Services",
  "fourth-estate": "Fourth Estate",
  other: "Other / Reconciliation",
};

const SIGNALS = [
  { id: "ai-autonomy", label: "AI / Autonomy", terms: ["artificial intelligence", "machine learning", "autonom", "algorithm", "joint all domain command", "jadc2", "decision advantage", "advanced battle management", "robotic", "unmanned", "counter small unmanned", "c-suas"] },
  { id: "software-digital", label: "Software / Digital", terms: ["software", "digital", "data fabric", "data platform", "cloud", "enterprise services", "zero trust", "platform", "analytics", "modeling and simulation"] },
  { id: "cyber", label: "Cyber", terms: ["cyber", "cryptologic", "crypto", "information assurance", "network defense", "cyberspace"] },
  { id: "space", label: "Space", terms: ["space", "satellite", "launch", "missile warning", "gps", "nssl", "orbital"] },
  { id: "missiles", label: "Missiles / Fires", terms: ["missile", "hypersonic", "munition", "rocket", "fires", "interceptor", "tomahawk", "standard missile", "amraam", "jassm", "lrpf"] },
  { id: "aircraft", label: "Aircraft", terms: ["aircraft", "fighter", "bomber", "helicopter", "f-35", "f-22", "f-15", "f/a-18", "b-21", "kc-46", "v-22", "uav", "uas"] },
  { id: "shipbuilding", label: "Shipbuilding", terms: ["ship", "submarine", "destroyer", "frigate", "carrier", "amphibious", "sealift", "vessel"] },
  { id: "medical", label: "Medical / Health", terms: ["medical", "health", "medicine", "combat casualty", "dha", "care program", "clinical"] },
  { id: "logistics", label: "Logistics / Sustainment", terms: ["logistics", "sustainment", "maintenance", "supply", "depot", "working capital", "stockpile", "readiness"] },
  { id: "infrastructure", label: "Infrastructure", terms: ["construction", "facility", "housing", "infrastructure", "installation", "utilities", "brac"] },
];

function unzipText(file, path) {
  return execFileSync("unzip", ["-p", file, path], { encoding: "utf8", maxBuffer: 120 * 1024 * 1024 });
}

function decodeXml(value = "") {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&#10;/g, "\n")
    .replace(/&#13;/g, "\r")
    .replace(/_x000D_/g, "\r");
}

function normalizeText(value = "") {
  return decodeXml(String(value)).replace(/\s+/g, " ").trim();
}

function colIndex(ref) {
  let index = 0;
  for (const char of ref) index = index * 26 + char.charCodeAt(0) - 64;
  return index - 1;
}

function parseSharedStrings(file) {
  const xml = unzipText(file, "xl/sharedStrings.xml");
  return [...xml.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((match) => {
    const parts = [...match[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((part) => part[1]);
    return normalizeText(parts.join(""));
  });
}

function worksheetNames(file) {
  return execFileSync("unzip", ["-l", file], { encoding: "utf8" })
    .split("\n")
    .map((line) => line.match(/xl\/worksheets\/sheet\d+\.xml/)?.[0])
    .filter(Boolean);
}

function parseRows(file, sheetPath = "xl/worksheets/sheet1.xml") {
  const strings = parseSharedStrings(file);
  const xml = unzipText(file, sheetPath);
  return [...xml.matchAll(/<row[^>]*r="(\d+)"[^>]*>([\s\S]*?)<\/row>/g)].map((match) => {
    const cells = [];
    for (const cell of match[2].matchAll(/<c[^>]*r="([A-Z]+)\d+"([^>]*)>([\s\S]*?)<\/c>/g)) {
      const [, col, attrs, body] = cell;
      const raw = body.match(/<v>([\s\S]*?)<\/v>/)?.[1] ?? "";
      const value = attrs.includes('t="s"') ? strings[Number(raw)] : normalizeText(raw);
      cells[colIndex(col)] = value;
    }
    return cells;
  });
}

function numberValue(value) {
  const parsed = Number(String(value || "").replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function pick(row, headers, candidates) {
  for (const candidate of candidates) {
    const index = headers[candidate];
    if (index !== undefined) return normalizeText(row[index] || "");
  }
  return "";
}

function amountHeader(headers, year) {
  const normalized = Object.fromEntries(Object.entries(headers).map(([header, index]) => [
    header.replace(/\*/g, "").replace(/\s+/g, " ").trim(),
    index,
  ]));
  const candidates = [
    `FY ${year} Total Amount`,
    `FY ${year} Total`,
    `FY ${year} Request Amount`,
    `FY ${year} Request`,
    `FY ${year} Discretionary Request Amount`,
    `FY ${year} Discretionary Request`,
    `FY ${year} Disc Request Amount`,
    `FY ${year} Disc Request`,
    `FY${year} Total Obligation Authority`,
    `FY ${year} Total Obligation Authority`,
    `FY ${year} Discretionary Request Amount`,
    `FY ${year} Discretionary Request`,
    `FY${year} Appropriation Amount`,
    `FY ${year} Appropriation Amount`,
    `FY ${year} Total Enacted Amount`,
    `FY ${year} Total Enacted`,
    `FY ${year} Enacted Amount`,
    `FY ${year} Enacted`,
    `FY ${year} Actuals Amount`,
    `FY ${year} Actuals`,
    `FY ${year} PB Request with CR Adjustments Amount`,
    `FY ${year} PB Request with CR Adjustments`,
    `FY ${year} PB Request with CR Amounts`,
    `FY ${year} Less Supplementals Enacted Amount`,
    `FY ${year} Less Supplementals Enacted`,
  ];
  for (const candidate of candidates) {
    if (normalized[candidate] !== undefined) return normalized[candidate];
  }
  return Object.entries(normalized).find(([header]) => (
    header.includes(`FY ${year}`)
    && !header.includes("Quantity")
    && (
      header.includes("Total")
      || header.includes("Request")
      || header.includes("Actual")
      || header.includes("Enacted")
      || header.includes("Obligation Authority")
    )
  ))?.[1];
}

function classifyOrg(code) {
  if (SERVICES.has(code)) return "service";
  if (code === "Unspecified") return "other";
  return "fourth-estate";
}

function orgName(code) {
  if (SERVICES.has(code)) return SERVICES.get(code);
  const names = {
    OSD: "OSD / Defense-Wide",
    DHA: "Defense Health Agency",
    DISA: "Defense Information Systems Agency",
    DLA: "Defense Logistics Agency",
    MDA: "Missile Defense Agency",
    SOCOM: "U.S. Special Operations Command",
    DARPA: "DARPA",
    CYBER: "U.S. Cyber Command",
    DODEA: "DoDEA",
    TJS: "Joint Staff",
    DSCA: "Defense Security Cooperation Agency",
    DTRA: "Defense Threat Reduction Agency",
    DCSA: "Defense Counterintelligence and Security Agency",
    DCMA: "Defense Contract Management Agency",
    DHRA: "Defense Human Resources Activity",
    WHS: "Washington Headquarters Services",
    NSA: "National Security Agency",
    DECA: "Defense Commissary Agency",
    DFAS: "Defense Finance and Accounting Service",
    DCAA: "Defense Contract Audit Agency",
    IG: "Office of Inspector General",
    Unspecified: "Unspecified / Reconciliation",
  };
  return names[code] || code || "Unspecified";
}

function detectSignals(record) {
  const haystack = [
    record.accountTitle,
    record.budgetActivityTitle,
    record.subActivityTitle,
    record.lineTitle,
    record.lineCode,
  ].join(" ").toLowerCase();
  return SIGNALS.filter((signal) => signal.terms.some((term) => haystack.includes(term))).map((signal) => signal.id);
}

function parseBook(book, requestPackage = REQUEST_PACKAGES.find((item) => item.requestYear === CURRENT_REQUEST_YEAR)) {
  const file = resolve(requestPackage.sourceDir, book.file);
  if (!existsSync(file)) throw new Error(`Missing source workbook: ${file}`);
  const rowsBySheet = book.id === "C-1"
    ? worksheetNames(file).slice(0, 3).map((sheet) => parseRows(file, sheet))
    : [parseRows(file)];
  const rows = rowsBySheet.flat();
  const headerRow = rows.find((row) => row.includes("Account") && row.some((cell) => normalizeText(cell) === "Account Title"));
  if (!headerRow) throw new Error(`No header row found in ${book.file}`);
  const headers = Object.fromEntries(headerRow.map((header, index) => [normalizeText(header), index]).filter(([header]) => header));

  const amountHeaders = Object.fromEntries(requestPackage.fiscalYears.map((year) => [year, amountHeader(headers, year)]));
  const c1FiscalYear = headers["Fiscal Year"];
  const c1Amount = Object.entries(headers).find(([header]) => header.includes("Total Obligation Authority"))?.[1];

  return rows.slice(rows.indexOf(headerRow) + 1).map((row, index) => {
    const include = pick(row, headers, ["Include In TOA"]);
    if (include && include !== "Y") return null;
    const addNonAdd = pick(row, headers, ["Add/Non-Add"]);

    const lineTitle = pick(row, headers, [
      "Program Element/Budget Line Item (BLI) Title",
      "SAG/Budget Line Item (BLI) Title",
      "Budget Line Item (BLI) Title",
      "Construction Project Title",
      "Budget SubActivity (BSA) Title",
      "AG/Budget SubActivity (BSA) Title",
    ]);
    const accountTitle = pick(row, headers, ["Account Title"]);
    const org = pick(row, headers, ["Organization"]) || "Unspecified";
    if (!accountTitle && !lineTitle && !org) return null;

    const values = Object.fromEntries(requestPackage.fiscalYears.map((year) => [`fy${year}`, 0]));
    if (book.id === "C-1") {
      const fy = numberValue(row[c1FiscalYear]);
      if (requestPackage.fiscalYears.includes(fy)) values[`fy${fy}`] = numberValue(row[c1Amount]) / 1000000;
    } else {
      for (const year of requestPackage.fiscalYears) {
        values[`fy${year}`] = numberValue(row[amountHeaders[year]]) / 1000000;
      }
    }
    if (!Object.values(values).some(Boolean)) return null;

    const record = {
      id: `${requestPackage.requestYear}-${book.id}-${index}`,
      requestYear: requestPackage.requestYear,
      sourcePackage: requestPackage.sourcePackage,
      bookId: book.id,
      color: book.color,
      colorShort: book.short,
      account: pick(row, headers, ["Account"]),
      accountTitle,
      org,
      orgName: orgName(org),
      orgGroup: classifyOrg(org),
      budgetActivity: pick(row, headers, ["Budget Activity"]),
      budgetActivityTitle: pick(row, headers, ["Budget Activity Title"]),
      subActivity: pick(row, headers, ["BSA", "AG/BSA"]),
      subActivityTitle: pick(row, headers, ["Budget SubActivity (BSA) Title", "AG/Budget SubActivity (BSA) Title"]),
      lineNumber: pick(row, headers, ["Line Number"]),
      lineCode: pick(row, headers, ["PE/BLI", "SAG/BLI", "Budget Line Item", "Construction Project"]),
      lineTitle,
      classification: pick(row, headers, ["Classification"]) || "U",
      addNonAdd: addNonAdd || "Add",
      fiscalValues: values,
      requestValue: values[`fy${requestPackage.requestYear}`] || 0,
      fy2025: values.fy2025 || 0,
      fy2026: values.fy2026 || 0,
      fy2027: values.fy2027 || 0,
    };
    record.signals = detectSignals(record);
    return record;
  }).filter(Boolean);
}

function aggregate(records, keyFn) {
  const groups = new Map();
  for (const record of records) {
    const key = keyFn(record);
    const existing = groups.get(key.id) || { ...key, fy2025: 0, fy2026: 0, fy2027: 0, records: 0 };
    existing.fy2025 += record.fy2025;
    existing.fy2026 += record.fy2026;
    existing.fy2027 += record.fy2027;
    existing.records += 1;
    groups.set(key.id, existing);
  }
  return [...groups.values()].sort((a, b) => b.fy2027 - a.fy2027);
}

function sum(records, key) {
  return records.reduce((total, record) => total + Number(record[key] || 0), 0);
}

function round(value, digits = 1) {
  return Number(Number(value || 0).toFixed(digits));
}

function availableBooks(requestPackage) {
  return BOOKS.filter((book) => existsSync(resolve(requestPackage.sourceDir, book.file)));
}

function valueForRequest(record) {
  return Number(record.requestValue || record.fiscalValues?.[`fy${record.requestYear}`] || 0);
}

function aggregateRequestValues(records, keyFn) {
  const groups = new Map();
  for (const record of records) {
    const key = keyFn(record);
    const existing = groups.get(key.id) || { ...key, requestValue: 0, records: 0 };
    existing.requestValue += valueForRequest(record);
    existing.records += 1;
    groups.set(key.id, existing);
  }
  return [...groups.values()]
    .map((row) => ({ ...row, requestValue: round(row.requestValue) }))
    .sort((a, b) => b.requestValue - a.requestValue);
}

const currentPackage = REQUEST_PACKAGES.find((item) => item.requestYear === CURRENT_REQUEST_YEAR);
const requestPackages = REQUEST_PACKAGES.filter((requestPackage) => availableBooks(requestPackage).length > 0);
const records = BOOKS.flatMap((book) => parseBook(book, currentPackage));
const historicalRecords = requestPackages.flatMap((requestPackage) => availableBooks(requestPackage).flatMap((book) => parseBook(book, requestPackage)));
const total = aggregate(records, () => ({ id: "portfolio", label: "DoD captured portfolio" }))[0];
const byBook = aggregate(records, (record) => ({ id: record.bookId, label: record.color, short: record.colorShort }));
const byOrg = aggregate(records, (record) => ({ id: record.org, label: record.orgName, group: record.orgGroup }));
const byService = aggregate(records.filter((record) => record.orgGroup === "service"), (record) => ({ id: record.org, label: record.orgName, group: record.orgGroup }));
const byFourthEstate = aggregate(records.filter((record) => record.orgGroup === "fourth-estate"), (record) => ({ id: record.org, label: record.orgName, group: record.orgGroup }));
const bySignal = SIGNALS.map((signal) => ({
  id: signal.id,
  label: signal.label,
  terms: signal.terms,
  ...aggregate(records.filter((record) => record.signals.includes(signal.id)), () => ({ id: signal.id, label: signal.label }))[0],
})).map((signal) => ({
  ...signal,
  fy2025: signal.fy2025 || 0,
  fy2026: signal.fy2026 || 0,
  fy2027: signal.fy2027 || 0,
  records: signal.records || 0,
})).sort((a, b) => b.fy2027 - a.fy2027);

const topRecords = records
  .filter((record) => record.fy2027 > 0)
  .sort((a, b) => b.fy2027 - a.fy2027)
  .slice(0, 500);

const sourceFiscalYears = currentPackage.fiscalYears;
const allFiscalYears = [...new Set(requestPackages.flatMap((requestPackage) => requestPackage.fiscalYears))].sort();

function buildSourceInventory(requestPackage, packageRecords) {
  return availableBooks(requestPackage).map((book) => {
    const bookRecords = packageRecords.filter((record) => record.bookId === book.id && record.requestYear === requestPackage.requestYear);
    const filePath = resolve(requestPackage.sourceDir, book.file);
    const stats = statSync(filePath);
    const fiscalYearCoverage = requestPackage.fiscalYears.map((year) => {
      const key = `fy${year}`;
      const yearRecords = bookRecords.filter((record) => record.fiscalValues?.[key] !== 0);
      return {
        year,
        records: yearRecords.length,
        value: round(yearRecords.reduce((value, record) => value + Number(record.fiscalValues?.[key] || 0), 0)),
      };
    });

    return {
      ...book,
      sourceUrl: sourceUrl(book, requestPackage.requestYear),
      sourceOffice: "Office of the Under Secretary of Defense (Comptroller)",
      sourcePackage: requestPackage.sourcePackage,
      sourceRelease: `FY${requestPackage.requestYear} President's Budget display workbook`,
      sourceRefreshCadence: "Annual President's Budget release, with replacement workbooks when Comptroller republishes display books.",
      requestYear: requestPackage.requestYear,
      localFile: requestPackage.requestYear === CURRENT_REQUEST_YEAR ? book.file : `FY${requestPackage.requestYear}/${book.file}`,
      cacheModifiedAt: stats.mtime.toISOString(),
      cacheSizeBytes: stats.size,
      availableBudgetRequestYears: [requestPackage.requestYear],
      availableFiscalYears: fiscalYearCoverage.filter((year) => year.records > 0).map((year) => year.year),
      fiscalYearCoverage,
      records: bookRecords.length,
      requestValue: round(bookRecords.reduce((value, record) => value + valueForRequest(record), 0)),
      fy2027Request: requestPackage.requestYear === CURRENT_REQUEST_YEAR ? sum(bookRecords, "fy2027") : 0,
      notes: SOURCE_NOTES[book.id],
    };
  });
}

const sourceInventory = buildSourceInventory(currentPackage, records);
const historicalSourceVersions = requestPackages.flatMap((requestPackage) => buildSourceInventory(requestPackage, historicalRecords));
const comparableBookIds = BOOKS.filter((book) => requestPackages.every((requestPackage) => existsSync(resolve(requestPackage.sourceDir, book.file)))).map((book) => book.id);
const requestHistory = requestPackages.map((requestPackage) => {
  const packageRecords = historicalRecords.filter((record) => record.requestYear === requestPackage.requestYear);
  const comparableRecords = packageRecords.filter((record) => comparableBookIds.includes(record.bookId));
  return {
    requestYear: requestPackage.requestYear,
    label: `FY${requestPackage.requestYear}`,
    sourcePackage: requestPackage.sourcePackage,
    fiscalYears: requestPackage.fiscalYears,
    sourceVersions: availableBooks(requestPackage).length,
    records: packageRecords.length,
    requestValue: round(packageRecords.reduce((value, record) => value + valueForRequest(record), 0)),
    comparableRequestValue: round(comparableRecords.reduce((value, record) => value + valueForRequest(record), 0)),
    byBook: aggregateRequestValues(packageRecords, (record) => ({ id: record.bookId, label: record.color, short: record.colorShort })),
    byOrgGroup: aggregateRequestValues(packageRecords, (record) => ({ id: record.orgGroup, label: GROUP_LABELS[record.orgGroup] })),
    bySignal: SIGNALS.map((signal) => ({
      id: signal.id,
      label: signal.label,
      terms: signal.terms,
      ...aggregateRequestValues(packageRecords.filter((record) => record.signals.includes(signal.id)), () => ({ id: signal.id, label: signal.label }))[0],
    })).map((signal) => ({
      ...signal,
      requestValue: signal.requestValue || 0,
      records: signal.records || 0,
    })).sort((a, b) => b.requestValue - a.requestValue),
  };
});
const latestHistory = requestHistory.at(-1);
const earliestComparableHistory = requestHistory.find((year) => year.comparableRequestValue > 0);
const trendSummary = {
  requestYears: requestHistory.map((year) => year.requestYear),
  comparableBookIds,
  comparableBookCount: comparableBookIds.length,
  comparableBooks: comparableBookIds.map((id) => BOOKS.find((book) => book.id === id)?.short || id),
  historicalRecordCount: historicalRecords.length,
  sourceVersionCount: historicalSourceVersions.length,
  currentRequestValue: latestHistory?.requestValue || 0,
  comparableCurrentRequestValue: latestHistory?.comparableRequestValue || 0,
  comparableEarliestRequestValue: earliestComparableHistory?.comparableRequestValue || 0,
  comparableEarliestRequestYear: earliestComparableHistory?.requestYear,
};
trendSummary.comparableChange = round(trendSummary.comparableCurrentRequestValue - trendSummary.comparableEarliestRequestValue);
trendSummary.comparableGrowth = round((trendSummary.comparableChange / Math.max(trendSummary.comparableEarliestRequestValue, 1)) * 100);

const generatedAt = sourceInventory
  .map((source) => new Date(source.cacheModifiedAt).getTime())
  .filter(Boolean)
  .sort((a, b) => b - a)[0];
const taggedRecords = records.filter((record) => record.signals.length > 0);
const taggedValue = sum(taggedRecords, "fy2027");
const sourceDiagnostics = sourceInventory.map((source) => {
  const sourceRecords = records.filter((record) => record.bookId === source.id);
  const fy2027 = sum(sourceRecords, "fy2027");
  const signalTagged = sourceRecords.filter((record) => record.signals.length > 0);
  const orgMix = ["service", "fourth-estate", "other"].map((group) => {
    const groupRecords = sourceRecords.filter((record) => record.orgGroup === group);
    const value = sum(groupRecords, "fy2027");
    return {
      id: group,
      label: GROUP_LABELS[group],
      records: groupRecords.length,
      fy2027: round(value),
      share: round((value / Math.max(fy2027, 1)) * 100),
    };
  });
  const topSignals = SIGNALS.map((signal) => {
    const signalRecords = sourceRecords.filter((record) => record.signals.includes(signal.id));
    const value = sum(signalRecords, "fy2027");
    return {
      id: signal.id,
      label: signal.label,
      records: signalRecords.length,
      fy2027: round(value),
      share: round((value / Math.max(fy2027, 1)) * 100),
    };
  }).filter((signal) => signal.records > 0).sort((a, b) => b.fy2027 - a.fy2027).slice(0, 5);
  const topOrganizations = aggregate(sourceRecords, (record) => ({ id: record.org, label: record.orgName })).slice(0, 3).map((org) => ({
    id: org.id,
    label: org.label,
    records: org.records,
    fy2027: round(org.fy2027),
    share: round((org.fy2027 / Math.max(fy2027, 1)) * 100),
  }));

  return {
    id: source.id,
    label: `${source.id} · ${source.short}`,
    color: source.color,
    fy2027: round(fy2027),
    records: sourceRecords.length,
    signalTaggedRecords: signalTagged.length,
    signalTaggedFy2027: round(sum(signalTagged, "fy2027")),
    signalTaggedRecordShare: round((signalTagged.length / Math.max(sourceRecords.length, 1)) * 100),
    signalTaggedValueShare: round((sum(signalTagged, "fy2027") / Math.max(fy2027, 1)) * 100),
    orgMix,
    topSignals,
    topOrganizations,
  };
});

function publicRecord(record) {
  const lineRecord = { ...record };
  delete lineRecord.fiscalValues;
  delete lineRecord.requestValue;
  delete lineRecord.requestYear;
  delete lineRecord.sourcePackage;
  return lineRecord;
}

const publicRecords = records.map(publicRecord);
const publicTopRecords = topRecords.map(publicRecord);

const out = {
  metadata: {
    title: "Defense Budget & Spend Intelligence",
    description: "FY2024-FY2027 DoD budget and spend analytics across services, Fourth Estate, colors of money, line items, source provenance, request vintages, and AI/autonomy signals.",
    fiscalYears: allFiscalYears,
    generatedAt: new Date(generatedAt).toISOString(),
    sourceCache: "Local Comptroller workbook cache supplied through BUDGET_SOURCE_DIR during data generation.",
    sources: sourceInventory,
    dataInventory: {
      publisher: "Office of the Under Secretary of Defense (Comptroller)",
      sourcePackage: "FY2027 Defense Budget Materials",
      sourcePackageUrl: "https://comptroller.war.gov/Budget-Materials/",
      refreshModel: "Manual source refresh. Replace cached workbooks and run npm run data:build; CI uses committed generated JSON when raw workbooks are not present.",
      automationStatus: "No scheduled upstream polling yet.",
      availableBudgetRequestYears: requestHistory.map((year) => year.requestYear),
      availableFiscalYears: allFiscalYears,
      sourceCount: sourceInventory.length,
      sourceVersionCount: historicalSourceVersions.length,
      currentRequestYear: CURRENT_REQUEST_YEAR,
      currentSourceFiscalYears: sourceFiscalYears,
      sourceLayerCount: SOURCE_LAYERS.length,
      pipelineSourceCount: PIPELINE_SOURCES.length,
      recordCount: records.length,
      historicalRecordCount: historicalRecords.length,
      largestExtractedLineSet: topRecords.length,
      sourceLayers: SOURCE_LAYERS,
      pipelineSources: PIPELINE_SOURCES,
      sourceJoinPaths: SOURCE_JOIN_PATHS,
      historicalSourceVersions,
      trendSummary,
      requestHistory,
      coverageDiagnostics: {
        signalTaggedRecords: taggedRecords.length,
        signalTaggedRecordShare: round((taggedRecords.length / Math.max(records.length, 1)) * 100),
        signalTaggedFy2027: round(taggedValue),
        signalTaggedValueShare: round((taggedValue / Math.max(total.fy2027, 1)) * 100),
        sourceDiagnosticsCount: sourceDiagnostics.length,
      },
      sourceDiagnostics,
      limitations: [
        "Budget display books are request and enacted-plan views, not executed outlay or contract-obligation feeds.",
        "Mission signals are keyword-derived from line titles and account fields, not a validated DoD AI taxonomy.",
        "Historical request coverage currently includes M-1, O-1, P-1, R-1, and RF-1 for FY2024-FY2026; C-1 historical workbooks use a different public path and are not backfilled yet.",
        "Request-vintage trends compare workbook request totals and should not be read as execution/outlay trends.",
      ],
      nextSources: [
        "Historical C-1 workbook discovery and MILCON request package backfill.",
        "RDT&E budget justification PDFs for program narrative and hidden AI/autonomy signals.",
        "USAspending and FPDS obligations for execution-side spend and vendor drilldown.",
        "DoD contracts, solicitations, and POM-relevant public releases for market timing context.",
      ],
    },
    methodology: "Parsed official Comptroller display workbooks. Dollar values are billions. Current FY2027 analytics use M-1/O-1/P-1/R-1/RF-1/C-1. Historical request-vintage analytics use reachable FY2024-FY2026 M-1/O-1/P-1/R-1/RF-1 workbooks plus FY2027 comparable books.",
  },
  signals: SIGNALS,
  rollups: {
    total,
    byBook,
    byOrg,
    byService,
    byFourthEstate,
    bySignal,
  },
  records: publicRecords,
  topRecords: publicTopRecords,
};

mkdirSync(dirname(OUT_FILE), { recursive: true });
writeFileSync(OUT_FILE, `${JSON.stringify(out, null, 2)}\n`);
console.log(`Wrote ${records.length} records to ${OUT_FILE}`);
