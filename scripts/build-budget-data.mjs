import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SOURCE_DIR = process.env.BUDGET_SOURCE_DIR || "/home/anboas/clawd/artifacts/sabre-research/budget";
const OUT_FILE = resolve(ROOT, "src/data/budget-intelligence.json");

const BOOKS = [
  { id: "M-1", file: "m1_display.xlsx", color: "Military Personnel", short: "MILPERS" },
  { id: "O-1", file: "o1_display.xlsx", color: "Operations and Maintenance", short: "O&M" },
  { id: "P-1", file: "p1_display.xlsx", color: "Procurement", short: "PROC" },
  { id: "R-1", file: "r1_display.xlsx", color: "Research, Development, Test, and Evaluation", short: "RDT&E" },
  { id: "RF-1", file: "rf1_display.xlsx", color: "Revolving and Management Funds", short: "RF" },
  { id: "C-1", file: "c1_display.xlsx", color: "MILCON / Family Housing / BRAC", short: "MILCON" },
];

const SOURCE_URLS = {
  "M-1": "https://comptroller.war.gov/Portals/45/Documents/defbudget/FY2027/m1_display.xlsx",
  "O-1": "https://comptroller.war.gov/Portals/45/Documents/defbudget/FY2027/o1_display.xlsx",
  "P-1": "https://comptroller.war.gov/Portals/45/Documents/defbudget/FY2027/p1_display.xlsx",
  "R-1": "https://comptroller.war.gov/Portals/45/Documents/defbudget/FY2027/r1_display.xlsx",
  "RF-1": "https://comptroller.war.gov/Portals/45/Documents/defbudget/FY2027/rf1_display.xlsx",
  "C-1": "https://comptroller.war.gov/Portals/45/Documents/defbudget/FY2027/c1_display.xlsx",
};

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
  const normalized = Object.fromEntries(Object.entries(headers).map(([header, index]) => [header.replace(/\s+/g, " ").trim(), index]));
  const candidates = [
    `FY ${year} Total Amount`,
    `FY ${year} Total`,
    `FY${year} Total Obligation Authority`,
    `FY ${year} Discretionary Request Amount`,
    `FY ${year} Discretionary Request`,
    `FY${year} Appropriation Amount`,
  ];
  for (const candidate of candidates) {
    if (normalized[candidate] !== undefined) return normalized[candidate];
  }
  return Object.entries(normalized).find(([header]) => header.includes(`FY ${year}`) && header.includes("Total") && !header.includes("Quantity"))?.[1];
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

function parseBook(book) {
  const file = resolve(SOURCE_DIR, book.file);
  if (!existsSync(file)) throw new Error(`Missing source workbook: ${file}`);
  const rowsBySheet = book.id === "C-1"
    ? worksheetNames(file).slice(0, 3).map((sheet) => parseRows(file, sheet))
    : [parseRows(file)];
  const rows = rowsBySheet.flat();
  const headerRow = rows.find((row) => row.includes("Account") && row.some((cell) => normalizeText(cell) === "Account Title"));
  if (!headerRow) throw new Error(`No header row found in ${book.file}`);
  const headers = Object.fromEntries(headerRow.map((header, index) => [normalizeText(header), index]).filter(([header]) => header));

  const fy25Total = amountHeader(headers, 2025);
  const fy26Total = amountHeader(headers, 2026);
  const fy27Total = amountHeader(headers, 2027);
  const c1FiscalYear = headers["Fiscal Year"];
  const c1Amount = headers["FY2025 Total Obligation Authority"];

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

    const values = { fy2025: 0, fy2026: 0, fy2027: 0 };
    if (book.id === "C-1") {
      const fy = numberValue(row[c1FiscalYear]);
      if ([2025, 2026, 2027].includes(fy)) values[`fy${fy}`] = numberValue(row[c1Amount]) / 1000000;
    } else {
      values.fy2025 = numberValue(row[fy25Total]) / 1000000;
      values.fy2026 = numberValue(row[fy26Total]) / 1000000;
      values.fy2027 = numberValue(row[fy27Total]) / 1000000;
    }
    if (!values.fy2025 && !values.fy2026 && !values.fy2027) return null;

    const record = {
      id: `${book.id}-${index}`,
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
      fy2025: values.fy2025,
      fy2026: values.fy2026,
      fy2027: values.fy2027,
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

const records = BOOKS.flatMap(parseBook);
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

const out = {
  metadata: {
    title: "Defense Budget Intelligence",
    description: "FY2027 DoD budget analytics across services, Fourth Estate, colors of money, line items, and AI/autonomy signals.",
    fiscalYears: [2025, 2026, 2027],
    generatedAt: new Date().toISOString(),
    sourceDirectory: SOURCE_DIR,
    sources: BOOKS.map((book) => ({ ...book, sourceUrl: SOURCE_URLS[book.id] })),
    methodology: "Parsed official FY2027 Comptroller display workbooks. Dollar values are billions. FY2025/FY2026/FY2027 are derived from workbook total columns where present; C-1 uses the workbook fiscal-year field with total obligation authority.",
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
  records,
  topRecords,
};

mkdirSync(dirname(OUT_FILE), { recursive: true });
writeFileSync(OUT_FILE, `${JSON.stringify(out, null, 2)}\n`);
console.log(`Wrote ${records.length} records to ${OUT_FILE}`);
