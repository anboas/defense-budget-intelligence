import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const DEFAULT_SOURCE_DIR = process.env.HOME ? resolve(process.env.HOME, "clawd/artifacts/defense-budget-intelligence/budget") : resolve(ROOT, "../artifacts/defense-budget-intelligence/budget");
const SOURCE_DIR = process.env.BUDGET_SOURCE_DIR || DEFAULT_SOURCE_DIR;
const JUSTIFICATION_SOURCE_DIR = process.env.JUSTIFICATION_SOURCE_DIR || resolve(SOURCE_DIR, "justifications/FY2027");
const USASPENDING_SOURCE_FILE = process.env.USASPENDING_SOURCE_FILE || resolve(SOURCE_DIR, "usaspending/FY2025-FY2026/technology-awards.json");
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
    status: "Partial",
    coverage: "FY2027 official RDT&E and procurement justification XML/PDF sources where line-level program narratives are published by OUSD(C).",
    role: "Explains why a line is growing, which technical areas are named, and where AI/autonomy/software/cyber signals are hidden outside workbook titles.",
  },
  {
    id: "obligations-outlays",
    label: "Execution spend",
    status: "Partial",
    coverage: "FY2025-FY2026 USAspending contract award snapshot by DoD technology-area keyword searches.",
    role: "Starts separating requested budget from execution-side award activity and enables vendor, buyer, PSC/NAICS, and service-fit drilldown.",
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
    status: "First slice ingested",
    layer: "Program narrative",
    cadence: "Annual President's Budget releases",
    access: "Public PDF downloads",
    readiness: 78,
    impact: 92,
    effort: "High",
    joinKeys: ["program element", "project number", "service", "budget activity"],
    firstTask: "Extend coverage beyond OUSD(C) XMLs into service-hosted RDT&E justification books.",
    value: "Adds technical rationale, named initiatives, and mission context that display workbooks compress into short titles.",
  },
  {
    id: "usaspending-awards",
    name: "USAspending Award Search",
    publisher: "U.S. Department of the Treasury",
    url: "https://api.usaspending.gov/docs/",
    priority: 3,
    status: "First slice ingested",
    layer: "Obligations and outlays",
    cadence: "Regular federal award updates",
    access: "Public API",
    readiness: 72,
    impact: 96,
    effort: "High",
    joinKeys: ["awarding agency", "funding agency", "program activity", "PSC", "NAICS", "award description"],
    firstTask: "Broaden from keyword sampled awards into agency/PSC/NAICS obligation trend pulls and line-level joins.",
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

const TECHNOLOGY_AREAS = [
  {
    id: "autonomous-systems",
    label: "Autonomous Systems",
    terms: ["autonom", "unmanned", "uav", "uas", "robotic", "counter small unmanned", "c-suas"],
    conversations: ["Army robotics and C-UAS modernization", "Air and naval unmanned platform demand", "Fourth Estate autonomy-enabling programs"],
  },
  {
    id: "ai-decision-advantage",
    label: "AI / Decision Advantage",
    terms: ["artificial intelligence", "machine learning", "algorithm", "decision advantage", "joint all domain command", "jadc2", "advanced battle management"],
    conversations: ["AI adoption budget visibility", "JADC2 and ABMS adjacency", "analytics and decision-support modernization"],
  },
  {
    id: "cloud-data-platforms",
    label: "Cloud / Data Platforms",
    terms: ["cloud", "data fabric", "data platform", "enterprise services", "platform", "analytics", "digital"],
    conversations: ["Enterprise data modernization", "cloud migration and platform services", "analytics infrastructure for mission owners"],
  },
  {
    id: "software-digital-engineering",
    label: "Software / Digital Engineering",
    terms: ["software", "digital", "modeling and simulation", "simulation", "enterprise services", "zero trust"],
    conversations: ["software factory and sustainment strategy", "digital engineering demand", "modeling and simulation investments"],
  },
  {
    id: "cyber-operations",
    label: "Cyber Operations",
    terms: ["cyber", "cryptologic", "crypto", "information assurance", "network defense", "cyberspace", "zero trust"],
    conversations: ["cyber mission force support", "defensive cyber modernization", "identity, network, and assurance investments"],
  },
  {
    id: "space-systems",
    label: "Space Systems",
    terms: ["space", "satellite", "launch", "missile warning", "gps", "nssl", "orbital"],
    conversations: ["Space Force budget posture", "satellite and missile-warning modernization", "launch and orbital infrastructure"],
  },
  {
    id: "missiles-fires",
    label: "Missiles / Fires",
    terms: ["missile", "hypersonic", "munition", "rocket", "fires", "interceptor", "tomahawk", "standard missile", "amraam", "jassm", "lrpf"],
    conversations: ["munitions demand and industrial base pressure", "hypersonic and interceptor modernization", "service-specific fires priorities"],
  },
  {
    id: "readiness-sustainment",
    label: "Readiness / Sustainment",
    terms: ["readiness", "sustainment", "maintenance", "supply", "depot", "working capital", "stockpile", "logistics"],
    conversations: ["readiness account pressure", "depot and supply-chain modernization", "working capital fund demand"],
  },
  {
    id: "shipbuilding-maritime",
    label: "Shipbuilding / Maritime",
    terms: ["ship", "submarine", "destroyer", "frigate", "carrier", "amphibious", "sealift", "vessel"],
    conversations: ["Navy shipbuilding posture", "submarine and surface combatant pipeline", "maritime industrial base demand"],
  },
  {
    id: "aircraft-aviation",
    label: "Aircraft / Aviation",
    terms: ["aircraft", "fighter", "bomber", "helicopter", "f-35", "f-22", "f-15", "f/a-18", "b-21", "kc-46", "v-22"],
    conversations: ["air platform modernization", "fighter, bomber, and mobility recapitalization", "aviation sustainment demand"],
  },
  {
    id: "installations-infrastructure",
    label: "Installations / Infrastructure",
    terms: ["construction", "facility", "housing", "infrastructure", "installation", "utilities", "brac"],
    conversations: ["installation modernization", "MILCON and facilities backlog", "resilient infrastructure priorities"],
  },
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

function detectTechnologyAreas(record) {
  const haystack = [
    record.accountTitle,
    record.budgetActivityTitle,
    record.subActivityTitle,
    record.lineTitle,
    record.lineCode,
  ].join(" ").toLowerCase();
  return TECHNOLOGY_AREAS.filter((area) => area.terms.some((term) => haystack.includes(term))).map((area) => area.id);
}

function stripXmlTags(value = "") {
  return normalizeText(String(value).replace(/<[^>]+>/g, " "));
}

function xmlTag(block, tag) {
  const match = String(block || "").match(new RegExp(`<[a-z0-9]+:${tag}\\b[^>]*>([\\s\\S]*?)<\\/[a-z0-9]+:${tag}>`, "i"));
  return match ? stripXmlTags(match[1]) : "";
}

function xmlTags(block, tag) {
  return [...String(block || "").matchAll(new RegExp(`<[a-z0-9]+:${tag}\\b[^>]*>([\\s\\S]*?)<\\/[a-z0-9]+:${tag}>`, "gi"))]
    .map((match) => stripXmlTags(match[1]))
    .filter(Boolean);
}

function xmlBlocks(xml, tag) {
  return [...String(xml || "").matchAll(new RegExp(`<[a-z0-9]+:${tag}\\b[^>]*>[\\s\\S]*?<\\/[a-z0-9]+:${tag}>`, "gi"))]
    .map((match) => match[0]);
}

function sentenceSnippets(text, terms, limit = 3) {
  const normalized = normalizeText(text);
  if (!normalized) return [];
  const sentences = normalized
    .replace(/\s*•\s*/g, ". ")
    .split(/(?<=[.!?])\s+|\n+/)
    .map((sentence) => normalizeText(sentence))
    .filter((sentence) => sentence.length >= 40);
  const lowerTerms = terms.map((term) => term.toLowerCase());
  const matches = sentences.filter((sentence) => {
    const lower = sentence.toLowerCase();
    return lowerTerms.some((term) => lower.includes(term));
  });
  return [...new Set(matches)].slice(0, limit).map((sentence) => (
    sentence.length > 260 ? `${sentence.slice(0, 257).trim()}...` : sentence
  ));
}

function serviceAgencyOrgCode(serviceAgencyName = "") {
  const lower = serviceAgencyName.toLowerCase();
  if (lower.includes("army")) return "A";
  if (lower.includes("navy") || lower.includes("marine corps")) return "N";
  if (lower.includes("air force") || lower.includes("space force")) return "F";
  if (lower.includes("cyber command")) return "CYBER";
  if (lower.includes("chemical and biological defense program")) return "CBDP";
  if (lower.includes("defense pow")) return "DPAA";
  if (lower.includes("defense media activity")) return "DMACT";
  if (lower.includes("defense information systems agency")) return "DISA";
  if (lower.includes("defense logistics agency")) return "DLA";
  if (lower.includes("missile defense agency")) return "MDA";
  if (lower.includes("special operations command")) return "SOCOM";
  if (lower.includes("advanced research projects agency") || lower.includes("darpa")) return "DARPA";
  if (lower.includes("defense security cooperation agency")) return "DSCA";
  if (lower.includes("defense technical information center")) return "DTIC";
  if (lower.includes("defense threat reduction agency")) return "DTRA";
  if (lower.includes("defense counterintelligence and security agency")) return "DCSA";
  if (lower.includes("defense contract management agency")) return "DCMA";
  if (lower.includes("defense human resources activity") || lower.includes("dod human resources activity")) return "DHRA";
  if (lower.includes("education activity")) return "DODEA";
  if (lower.includes("operational test and evaluation")) return "OTE";
  if (lower.includes("washington headquarters services")) return "WHS";
  if (lower.includes("joint staff")) return "TJS";
  if (lower.includes("office of the secretary")) return "OSD";
  if (lower === "defense-wide") return "DEFW";
  return "";
}

function readJustificationManifest() {
  const manifestPath = resolve(JUSTIFICATION_SOURCE_DIR, "manifest.json");
  if (existsSync(manifestPath)) {
    return JSON.parse(readFileSync(manifestPath, "utf8"));
  }

  if (!existsSync(JUSTIFICATION_SOURCE_DIR)) {
    return {
      generatedAt: null,
      sourcePage: "https://comptroller.war.gov/BudgetMaterials/FY2027budgetjustification.aspx",
      budgetYear: CURRENT_REQUEST_YEAR,
      sourceCount: 0,
      sources: [],
    };
  }

  const sources = readdirSync(JUSTIFICATION_SOURCE_DIR)
    .filter((file) => file.endsWith(".xml"))
    .sort()
    .map((file) => {
      const bookId = file.includes("RDTE") || file.includes("RDT") ? "R-1" : "P-1";
      const kind = bookId === "R-1" ? "RDT&E justification" : "Procurement justification";
      const pathPart = bookId === "R-1" ? "03_RDT_and_E" : "02_Procurement";
      const url = `https://comptroller.war.gov/Portals/45/Documents/defbudget/FY2027/budget_justification/pdfs/${pathPart}/${file}`;
      return {
        id: file.replace(/\.xml$/i, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
        name: file.replace(/\.xml$/i, "").replace(/_/g, " "),
        kind,
        bookId,
        url,
        pdfUrl: url.replace(/\.xml$/i, ".pdf"),
        localFile: file,
      };
    });

  return {
    generatedAt: null,
    sourcePage: "https://comptroller.war.gov/BudgetMaterials/FY2027budgetjustification.aspx",
    budgetYear: CURRENT_REQUEST_YEAR,
    sourceCount: sources.length,
    sources,
  };
}

function narrativeForTechnologyAreas(text) {
  const lower = text.toLowerCase();
  return TECHNOLOGY_AREAS.filter((area) => area.terms.some((term) => lower.includes(term))).map((area) => area.id);
}

function buildEvidenceSnippets(narrative, technologyAreas) {
  const terms = technologyAreas.flatMap((areaId) => TECHNOLOGY_AREAS.find((area) => area.id === areaId)?.terms || []);
  return sentenceSnippets(narrative, terms.length ? terms : TECHNOLOGY_AREAS.flatMap((area) => area.terms));
}

function parseRdteJustification(source, xml) {
  return xmlBlocks(xml, "ProgramElement").map((block) => {
    const narrative = [
      xmlTag(block, "ProgramElementMissionDescription"),
      ...xmlTags(block, "ProjectMissionDescription"),
      ...xmlTags(block, "Description").slice(0, 12),
    ].filter(Boolean).join(" ");
    const title = xmlTag(block, "ProgramElementTitle");
    const joinKey = xmlTag(block, "ProgramElementNumber");
    const technologyAreas = narrativeForTechnologyAreas(`${title} ${narrative}`);
    return {
      id: `${source.id}-${joinKey}`,
      sourceId: source.id,
      sourceName: source.name,
      sourceUrl: source.url,
      sourcePdfUrl: source.pdfUrl,
      kind: source.kind,
      bookId: "R-1",
      joinKey,
      lineNumber: xmlTag(block, "R1LineNumber"),
      title,
      serviceAgencyName: xmlTag(block, "ServiceAgencyName"),
      org: serviceAgencyOrgCode(xmlTag(block, "ServiceAgencyName")),
      appropriationName: xmlTag(block, "AppropriationName"),
      budgetActivityTitle: xmlTag(block, "BudgetActivityTitle"),
      fy2027: numberValue(xmlTag(block, "BudgetYearOne")),
      narrative,
      technologyAreas,
      evidenceSnippets: buildEvidenceSnippets(narrative, technologyAreas),
    };
  }).filter((item) => item.joinKey && item.title);
}

function parseProcurementJustification(source, xml) {
  return xmlBlocks(xml, "LineItem").map((block) => {
    const narrative = [
      xmlTag(block, "Description"),
      ...xmlTags(block, "MissionDescription"),
      ...xmlTags(block, "Justification"),
      ...xmlTags(block, "Title").slice(0, 12),
    ].filter(Boolean).join(" ");
    const title = xmlTag(block, "LineItemTitle");
    const joinKey = xmlTag(block, "LineItemNumber");
    const technologyAreas = narrativeForTechnologyAreas(`${title} ${narrative}`);
    return {
      id: `${source.id}-${joinKey}`,
      sourceId: source.id,
      sourceName: source.name,
      sourceUrl: source.url,
      sourcePdfUrl: source.pdfUrl,
      kind: source.kind,
      bookId: "P-1",
      joinKey,
      lineNumber: xmlTag(block, "P1LineNumber"),
      title,
      serviceAgencyName: xmlTag(block, "ServiceAgencyName"),
      org: serviceAgencyOrgCode(xmlTag(block, "ServiceAgencyName")),
      appropriationName: xmlTag(block, "AppropriationTitle"),
      budgetActivityTitle: xmlTag(block, "BudgetActivityTitle"),
      fy2027: numberValue(xmlTag(block, "BudgetYearOne") || xmlTag(block, "CurrentYear")),
      narrative,
      technologyAreas,
      evidenceSnippets: buildEvidenceSnippets(narrative, technologyAreas),
    };
  }).filter((item) => item.joinKey && item.title);
}

function loadJustificationEvidence() {
  const manifest = readJustificationManifest();
  const evidence = [];
  for (const source of manifest.sources || []) {
    const file = resolve(JUSTIFICATION_SOURCE_DIR, source.localFile);
    if (!existsSync(file)) continue;
    const xml = readFileSync(file, "utf8");
    const parsed = source.bookId === "R-1"
      ? parseRdteJustification(source, xml)
      : parseProcurementJustification(source, xml);
    evidence.push(...parsed);
  }
  return { manifest, evidence };
}

function loadUsaspendingSnapshot() {
  if (!existsSync(USASPENDING_SOURCE_FILE)) {
    return {
      metadata: {
        title: "USAspending DoD Technology Award Snapshot",
        generatedAt: null,
        sourceUrl: "https://api.usaspending.gov/api/v2/search/spending_by_award/",
        startDate: null,
        endDate: null,
        methodology: "No cached USAspending snapshot found.",
        areaCount: 0,
        cachedAreaCount: 0,
        failedAreaCount: 0,
      },
      areas: [],
      failed: [],
    };
  }
  return JSON.parse(readFileSync(USASPENDING_SOURCE_FILE, "utf8"));
}

function dollarsToBillions(value) {
  return round(Number(value || 0) / 1000000000, 3);
}

function normalizeAward(raw = {}, area) {
  const description = normalizeText(raw.Description || "");
  const awardingSubAgency = normalizeText(raw["Awarding Sub Agency"] || "Unspecified DoD buyer");
  const fundingSubAgency = normalizeText(raw["Funding Sub Agency"] || "");
  return {
    id: raw.generated_internal_id || raw.internal_id || raw["Award ID"],
    awardId: raw["Award ID"] || "",
    recipient: normalizeVendorName(raw["Recipient Name"] || "Unspecified recipient"),
    awardAmount: dollarsToBillions(raw["Award Amount"]),
    awardAmountDollars: Number(raw["Award Amount"] || 0),
    startDate: raw["Start Date"] || "",
    endDate: raw["End Date"] || "",
    buyerSubAgency: fundingSubAgency || awardingSubAgency,
    awardingSubAgency,
    awardingOffice: normalizeText(raw["Awarding Office"] || ""),
    fundingSubAgency,
    fundingOffice: normalizeText(raw["Funding Office"] || ""),
    description: description.length > 240 ? `${description.slice(0, 237).trim()}...` : description,
    contractType: normalizeText(raw["Contract Award Type"] || ""),
    naicsCode: normalizeText(raw.naics_code || ""),
    naicsDescription: normalizeText(raw.naics_description || ""),
    pscCode: normalizeText(raw.psc_code || ""),
    pscDescription: normalizeText(raw.psc_description || ""),
    areaId: area.id,
    area: area.label,
  };
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

function buyerGroup(name = "") {
  const lower = name.toLowerCase();
  if (lower.includes("army")) return "Army";
  if (lower.includes("navy") || lower.includes("marine corps")) return "Navy / Marine Corps";
  if (lower.includes("air force") || lower.includes("space force")) return "Air Force / Space Force";
  if (lower.includes("defense")) return "Fourth Estate";
  return name || "Unspecified";
}

function serviceFitForArea(areaId) {
  const fits = {
    "ai-decision-advantage": "AI/ML delivery, data engineering, model operations, decision-support modernization",
    "autonomous-systems": "systems engineering, mission software, test support, C-UAS and unmanned integration",
    "cyber-operations": "cyber mission engineering, zero trust, security operations, cloud security",
    "software-digital-engineering": "software factory support, agile delivery, DevSecOps, digital engineering",
    "cloud-data-platforms": "cloud migration, data platforms, analytics engineering, platform operations",
    "space-systems": "space systems engineering, ground systems, data integration, mission assurance",
    "missiles-fires": "mission engineering, test/evaluation, modeling, systems integration",
    "readiness-sustainment": "sustainment analytics, maintenance modernization, logistics systems, readiness reporting",
    "shipbuilding-maritime": "digital shipyard, lifecycle engineering, supply-chain analytics, integration support",
    "aircraft-aviation": "aviation sustainment, training systems, software refresh, test and integration",
    "installations-infrastructure": "program management, infrastructure modernization, resilience planning, facilities data",
  };
  return fits[areaId] || "mission services, analytics, engineering, and integration support";
}

function aggregateAwards(awards, keyFn) {
  const groups = new Map();
  for (const award of awards) {
    const key = keyFn(award);
    const existing = groups.get(key.id) || { ...key, awardAmount: 0, awardAmountDollars: 0, awards: 0, areas: new Set() };
    existing.awardAmount += award.awardAmount;
    existing.awardAmountDollars += award.awardAmountDollars;
    existing.awards += 1;
    existing.areas.add(award.area);
    groups.set(key.id, existing);
  }
  return [...groups.values()].map((row) => ({
    ...row,
    awardAmount: round(row.awardAmount, 3),
    areas: [...row.areas].sort(),
  })).sort((a, b) => b.awardAmount - a.awardAmount);
}

function fiscalQuarter(dateString = "") {
  const date = new Date(`${dateString.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return null;
  const month = date.getUTCMonth();
  const fiscalYear = month >= 9 ? date.getUTCFullYear() + 1 : date.getUTCFullYear();
  const quarter = Math.floor(((month + 3) % 12) / 3) + 1;
  return {
    id: `FY${fiscalYear}-Q${quarter}`,
    label: `FY${fiscalYear} Q${quarter}`,
    fiscalYear,
    quarter,
    sort: fiscalYear * 10 + quarter,
  };
}

function awardPeriods(awards) {
  return [...new Map(awards
    .map((award) => fiscalQuarter(award.startDate))
    .filter(Boolean)
    .map((period) => [period.id, period])).values()]
    .sort((a, b) => a.sort - b.sort);
}

function sumPeriodValues(periodValues, periods) {
  const periodIds = new Set(periods.map((period) => period.id));
  return Object.entries(periodValues)
    .filter(([periodId]) => periodIds.has(periodId))
    .reduce((totalValue, [, value]) => totalValue + value, 0);
}

function executionTrendRows(awards, periods, keyFn, limit = 8) {
  const groups = new Map();
  const latestPeriods = periods.slice(-2);
  const previousPeriods = periods.slice(Math.max(periods.length - 4, 0), Math.max(periods.length - 2, 0));
  for (const award of awards) {
    const key = keyFn(award);
    if (!key?.id) continue;
    const period = fiscalQuarter(award.startDate);
    const existing = groups.get(key.id) || {
      ...key,
      awardAmount: 0,
      awardAmountDollars: 0,
      awards: 0,
      periodValues: {},
      periodAwards: {},
      areas: new Set(),
    };
    existing.awardAmount += award.awardAmount;
    existing.awardAmountDollars += award.awardAmountDollars;
    existing.awards += 1;
    existing.areas.add(award.area);
    if (period) {
      existing.periodValues[period.id] = (existing.periodValues[period.id] || 0) + award.awardAmount;
      existing.periodAwards[period.id] = (existing.periodAwards[period.id] || 0) + 1;
    }
    groups.set(key.id, existing);
  }
  return [...groups.values()].map((row) => {
    const latestAmount = sumPeriodValues(row.periodValues, latestPeriods);
    const previousAmount = sumPeriodValues(row.periodValues, previousPeriods);
    return {
      ...row,
      awardAmount: round(row.awardAmount, 3),
      latestAmount: round(latestAmount, 3),
      previousAmount: round(previousAmount, 3),
      latestChange: changePct(latestAmount, previousAmount),
      periods: periods.map((period) => ({
        id: period.id,
        label: period.label,
        awardAmount: round(row.periodValues[period.id] || 0, 3),
        awards: row.periodAwards[period.id] || 0,
      })),
      areas: [...row.areas].sort(),
    };
  }).sort((a, b) => b.latestAmount - a.latestAmount || b.awardAmount - a.awardAmount).slice(0, limit);
}

function executionPeriodTotals(awards, periods) {
  const totals = new Map(periods.map((period) => [period.id, { ...period, awardAmount: 0, awards: 0 }]));
  for (const award of awards) {
    const period = fiscalQuarter(award.startDate);
    if (!period || !totals.has(period.id)) continue;
    const total = totals.get(period.id);
    total.awardAmount += award.awardAmount;
    total.awards += 1;
  }
  return [...totals.values()].map((period) => ({ ...period, awardAmount: round(period.awardAmount, 3) }));
}

function spendingPeriod(raw = {}) {
  const fiscalYear = Number(raw.fiscal_year || raw.fiscalYear);
  const quarter = Number(raw.quarter);
  if (!fiscalYear || !quarter) return null;
  return {
    id: `FY${fiscalYear}-Q${quarter}`,
    label: `FY${fiscalYear} Q${quarter}`,
    fiscalYear,
    quarter,
    sort: fiscalYear * 10 + quarter,
  };
}

function spendingSeriesPeriods(seriesGroups = []) {
  return [...new Map(seriesGroups
    .flatMap((series) => series.results || [])
    .map((point) => spendingPeriod(point.time_period))
    .filter(Boolean)
    .map((period) => [period.id, period])).values()]
    .sort((a, b) => a.sort - b.sort);
}

function spendingTrendRows(seriesList = [], periods = [], limit = 8) {
  const latestPeriods = periods.slice(-2);
  const previousPeriods = periods.slice(Math.max(periods.length - 4, 0), Math.max(periods.length - 2, 0));
  return seriesList.map((series) => {
    const periodValues = {};
    for (const point of series.results || []) {
      const period = spendingPeriod(point.time_period);
      if (!period) continue;
      periodValues[period.id] = (periodValues[period.id] || 0) + dollarsToBillions(point.aggregated_amount || point.Contract_Obligations);
    }
    const awardAmount = Object.values(periodValues).reduce((totalValue, value) => totalValue + value, 0);
    const latestAmount = sumPeriodValues(periodValues, latestPeriods);
    const previousAmount = sumPeriodValues(periodValues, previousPeriods);
    return {
      id: series.id,
      label: series.label,
      group: series.group,
      awardAmount: round(awardAmount, 3),
      sourceAwardAmount: series.sourceAwardAmount || 0,
      awards: series.sourceAwardCount || 0,
      latestAmount: round(latestAmount, 3),
      previousAmount: round(previousAmount, 3),
      latestChange: changePct(latestAmount, previousAmount),
      periods: periods.map((period) => ({
        id: period.id,
        label: period.label,
        awardAmount: round(periodValues[period.id] || 0, 3),
        awards: 0,
      })),
    };
  }).sort((a, b) => b.latestAmount - a.latestAmount || b.awardAmount - a.awardAmount).slice(0, limit);
}

function spendingPeriodTotals(seriesList = [], periods = []) {
  const totals = new Map(periods.map((period) => [period.id, { ...period, awardAmount: 0, awards: 0 }]));
  for (const series of seriesList) {
    for (const point of series.results || []) {
      const period = spendingPeriod(point.time_period);
      if (!period || !totals.has(period.id)) continue;
      const total = totals.get(period.id);
      total.awardAmount += dollarsToBillions(point.aggregated_amount || point.Contract_Obligations);
    }
  }
  return [...totals.values()].map((period) => ({ ...period, awardAmount: round(period.awardAmount, 3) }));
}

function trimTrailingEmptyPeriods(periods = [], totals = []) {
  const totalById = new Map(totals.map((period) => [period.id, period.awardAmount || 0]));
  let lastActiveIndex = periods.length - 1;
  while (lastActiveIndex >= 0 && !totalById.get(periods[lastActiveIndex].id)) {
    lastActiveIndex -= 1;
  }
  return lastActiveIndex >= 0 ? periods.slice(0, lastActiveIndex + 1) : periods;
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
    record.technologyAreas = detectTechnologyAreas(record);
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

function changePct(current, prior) {
  if (!prior) return current ? 100 : 0;
  return round(((current - prior) / prior) * 100);
}

const currentPackage = REQUEST_PACKAGES.find((item) => item.requestYear === CURRENT_REQUEST_YEAR);
const requestPackages = REQUEST_PACKAGES.filter((requestPackage) => availableBooks(requestPackage).length > 0);
const records = BOOKS.flatMap((book) => parseBook(book, currentPackage));
const historicalRecords = requestPackages.flatMap((requestPackage) => availableBooks(requestPackage).flatMap((book) => parseBook(book, requestPackage)));
const { manifest: justificationManifest, evidence: justificationEvidenceItems } = loadJustificationEvidence();
const usaspendingSnapshot = loadUsaspendingSnapshot();

const justificationByJoinKey = justificationEvidenceItems.reduce((groups, item) => {
  const key = `${item.bookId}:${item.joinKey}`;
  const existing = groups.get(key) || [];
  existing.push(item);
  groups.set(key, existing);
  return groups;
}, new Map());

function areaIntersection(left = [], right = []) {
  const rightSet = new Set(right);
  return left.filter((item) => rightSet.has(item));
}

function bestJustificationEvidence(record) {
  const candidates = justificationByJoinKey.get(`${record.bookId}:${record.lineCode}`) || [];
  if (!candidates.length) return null;
  const orgMatches = candidates.filter((candidate) => candidate.org && candidate.org === record.org);
  const eligible = orgMatches.length ? orgMatches : candidates.filter((candidate) => (
    normalizeText(candidate.title).toLowerCase() === normalizeText(record.lineTitle).toLowerCase()
  ));
  if (!eligible.length && record.bookId === "P-1") return null;
  const scored = candidates.map((candidate) => {
    const orgScore = candidate.org && candidate.org === record.org ? 4 : candidate.org ? -4 : 0;
    const titleScore = candidate.title && record.lineTitle && normalizeText(candidate.title).toLowerCase() === normalizeText(record.lineTitle).toLowerCase() ? 2 : 0;
    const areaScore = areaIntersection(record.technologyAreas, candidate.technologyAreas).length;
    return { candidate, score: orgScore + titleScore + areaScore };
  });
  return scored
    .filter((row) => !eligible.length || eligible.includes(row.candidate))
    .sort((a, b) => b.score - a.score)[0]?.candidate || eligible[0] || candidates[0];
}

function evidenceConfidence(record, evidence) {
  if (!evidence) return { score: 0, label: "No narrative match" };
  const confirmedAreas = areaIntersection(record.technologyAreas, evidence.technologyAreas);
  if (evidence.org && evidence.org === record.org && confirmedAreas.length) return { score: 92, label: "High" };
  if (confirmedAreas.length) return { score: 84, label: "High" };
  if (evidence.org && evidence.org === record.org) return { score: 72, label: "Medium" };
  return { score: 62, label: "Directional" };
}

for (const record of records) {
  const evidence = bestJustificationEvidence(record);
  if (!evidence) continue;
  const confidence = evidenceConfidence(record, evidence);
  const confirmedTechnologyAreas = areaIntersection(record.technologyAreas, evidence.technologyAreas);
  record.justificationEvidence = {
    sourceName: evidence.sourceName,
    sourceUrl: evidence.sourceUrl,
    sourcePdfUrl: evidence.sourcePdfUrl,
    kind: evidence.kind,
    title: evidence.title,
    serviceAgencyName: evidence.serviceAgencyName,
    lineNumber: evidence.lineNumber,
    fy2027: round(evidence.fy2027),
    technologyAreas: evidence.technologyAreas,
    confirmedTechnologyAreas,
    confidence: confidence.score,
    confidenceLabel: confidence.label,
    snippets: evidence.evidenceSnippets.slice(0, 3),
  };
}

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

function historySeriesFor(collectionKey, itemId) {
  return requestHistory.map((history) => ({
    requestYear: history.requestYear,
    value: history[collectionKey]?.find((item) => item.id === itemId)?.requestValue || 0,
    records: history[collectionKey]?.find((item) => item.id === itemId)?.records || 0,
  }));
}

function momentumRow(item, collectionKey, extra = {}) {
  const series = historySeriesFor(collectionKey, item.id);
  const first = series.find((point) => point.value > 0);
  const prior = series.at(-2);
  const latest = series.at(-1);
  return {
    ...extra,
    id: item.id,
    label: item.label,
    short: item.short,
    records: latest?.records || item.records || 0,
    latestValue: round(latest?.value || 0),
    priorValue: round(prior?.value || 0),
    earliestValue: round(first?.value || 0),
    latestYear: latest?.requestYear,
    priorYear: prior?.requestYear,
    earliestYear: first?.requestYear,
    lastChange: round((latest?.value || 0) - (prior?.value || 0)),
    lastChangePct: changePct(latest?.value || 0, prior?.value || 0),
    cumulativeChange: round((latest?.value || 0) - (first?.value || 0)),
    cumulativeChangePct: changePct(latest?.value || 0, first?.value || 0),
    series,
  };
}

const bookMomentum = BOOKS.map((book) => momentumRow(
  { id: book.id, label: book.color, short: book.short },
  "byBook",
  { completeHistory: comparableBookIds.includes(book.id) },
));
const signalMomentum = SIGNALS
  .map((signal) => momentumRow(signal, "bySignal"))
  .filter((signal) => signal.latestValue > 0)
  .sort((a, b) => b.lastChange - a.lastChange);
const orgGroupMomentum = Object.entries(GROUP_LABELS)
  .map(([id, label]) => momentumRow({ id, label }, "byOrgGroup"))
  .filter((group) => group.latestValue > 0)
  .sort((a, b) => b.lastChange - a.lastChange);
const topCurrentBook = [...bookMomentum].sort((a, b) => b.latestValue - a.latestValue)[0];
const fastestComparableBook = bookMomentum
  .filter((book) => book.completeHistory)
  .sort((a, b) => b.lastChange - a.lastChange)[0];
const fastestSignal = [...signalMomentum].sort((a, b) => b.lastChangePct - a.lastChangePct)[0];
const fourthEstateMomentum = orgGroupMomentum.find((group) => group.id === "fourth-estate");
const analyticsReadouts = {
  headlineCards: [
    {
      id: "current-request",
      label: "Current request posture",
      value: latestHistory?.requestValue || 0,
      display: "money",
      helper: `FY${CURRENT_REQUEST_YEAR} captured request across all current workbooks.`,
      tone: "blue",
    },
    {
      id: "comparable-growth",
      label: "Comparable book growth",
      value: trendSummary.comparableGrowth,
      display: "percent",
      helper: `${trendSummary.comparableBookCount} comparable books from FY${trendSummary.comparableEarliestRequestYear} to FY${CURRENT_REQUEST_YEAR}.`,
      tone: "green",
    },
    {
      id: "largest-color",
      label: "Largest color of money",
      value: topCurrentBook?.latestValue || 0,
      display: "money",
      helper: `${topCurrentBook?.short || "N/A"} leads the current request model.`,
      tone: "orange",
    },
    {
      id: "fastest-signal",
      label: "Fastest mission signal",
      value: fastestSignal?.lastChangePct || 0,
      display: "percent",
      helper: `${fastestSignal?.label || "N/A"} from FY${fastestSignal?.priorYear} to FY${fastestSignal?.latestYear}.`,
      tone: "purple",
    },
  ],
  observations: [
    {
      id: "proc-rdte-step-up",
      label: "FY2027 shifts hard into modernization accounts",
      value: `${fastestComparableBook?.short || "PROC"} +${fastestComparableBook?.lastChangePct || 0}%`,
      helper: `${fastestComparableBook?.short || "PROC"} adds ${round(fastestComparableBook?.lastChange || 0)}B from FY${fastestComparableBook?.priorYear} to FY${fastestComparableBook?.latestYear}; RDT&E and procurement both show major step-ups.`,
      tone: "orange",
    },
    {
      id: "fourth-estate-surge",
      label: "Fourth Estate becomes a bigger analytic center",
      value: `+${fourthEstateMomentum?.lastChangePct || 0}%`,
      helper: `${fourthEstateMomentum?.label || "Fourth Estate"} grows from ${round(fourthEstateMomentum?.priorValue || 0)}B to ${round(fourthEstateMomentum?.latestValue || 0)}B in the current request vintage.`,
      tone: "green",
    },
    {
      id: "ai-autonomy-spike",
      label: "AI/autonomy needs narrative validation",
      value: `+${fastestSignal?.lastChangePct || 0}%`,
      helper: `${fastestSignal?.label || "AI / Autonomy"} has the sharpest keyword-derived move; justification books are the next source needed to separate real AI spend from title artifacts.`,
      tone: "purple",
    },
  ],
  bookMomentum,
  signalMomentum,
  orgGroupMomentum,
};

function aggregateFy2027(records, keyFn) {
  const groups = new Map();
  for (const record of records) {
    const key = keyFn(record);
    const existing = groups.get(key.id) || { ...key, fy2027: 0, fy2026: 0, fy2025: 0, records: 0 };
    existing.fy2027 += record.fy2027;
    existing.fy2026 += record.fy2026;
    existing.fy2025 += record.fy2025;
    existing.records += 1;
    groups.set(key.id, existing);
  }
  return [...groups.values()]
    .map((row) => ({
      ...row,
      fy2027: round(row.fy2027),
      fy2026: round(row.fy2026),
      fy2025: round(row.fy2025),
      change: round(row.fy2027 - row.fy2025),
      growth: changePct(row.fy2027, row.fy2025),
    }))
    .sort((a, b) => b.fy2027 - a.fy2027);
}

function strategyScore(row) {
  const valueScore = Math.min((row.fy2027 / 120) * 45, 45);
  const growthScore = Math.min(Math.max(row.growth, 0) / 20, 25);
  const recordsScore = Math.min(row.records / 8, 15);
  const modernizationScore = ["ai-decision-advantage", "autonomous-systems", "cloud-data-platforms", "software-digital-engineering", "cyber-operations"].includes(row.areaId) ? 15 : 8;
  return Math.round(valueScore + growthScore + recordsScore + modernizationScore);
}

function compactLine(record) {
  return {
    id: record.id,
    title: record.lineTitle || record.budgetActivityTitle || record.accountTitle,
    org: record.org,
    orgName: record.orgName,
    orgGroup: record.orgGroup,
    colorShort: record.colorShort,
    bookId: record.bookId,
    fy2027: round(record.fy2027),
    growth: changePct(record.fy2027, record.fy2025),
    justificationEvidence: record.justificationEvidence,
  };
}

const technologyTaggedRecords = records.filter((record) => record.technologyAreas.length > 0);
const evidenceBackedRecords = records.filter((record) => record.justificationEvidence);
const evidenceBackedTechnologyRecords = technologyTaggedRecords.filter((record) => record.justificationEvidence);
const narrativeConfirmedTechnologyRecords = technologyTaggedRecords.filter((record) => record.justificationEvidence?.confirmedTechnologyAreas?.length > 0);
const awardEntries = (usaspendingSnapshot.areas || []).flatMap((areaResult) => (
  (areaResult.results || []).map((award) => normalizeAward(award, areaResult.area))
));
const uniqueAwards = [...new Map(awardEntries.map((award) => [award.id, award])).values()];
const uniqueAwardValue = round(uniqueAwards.reduce((totalValue, award) => totalValue + award.awardAmount, 0), 3);
const executionPeriods = awardPeriods(uniqueAwards);
const awardAreaRows = (usaspendingSnapshot.areas || []).map((areaResult) => {
  const areaAwards = (areaResult.results || []).map((award) => normalizeAward(award, areaResult.area));
  const areaUniqueAwards = [...new Map(areaAwards.map((award) => [award.id, award])).values()];
  const topVendors = aggregateAwards(areaUniqueAwards, (award) => ({ id: award.recipient, label: award.recipient })).slice(0, 5);
  const topBuyers = aggregateAwards(areaUniqueAwards, (award) => ({ id: award.buyerSubAgency, label: award.buyerSubAgency, group: buyerGroup(award.buyerSubAgency) })).slice(0, 5);
  return {
    id: areaResult.area.id,
    label: areaResult.area.label,
    keywords: areaResult.area.keywords,
    resultCount: areaAwards.length,
    uniqueAwards: areaUniqueAwards.length,
    awardAmount: round(areaUniqueAwards.reduce((totalValue, award) => totalValue + award.awardAmount, 0), 3),
    serviceFit: serviceFitForArea(areaResult.area.id),
    topVendors,
    topBuyers,
    topAwards: areaUniqueAwards
      .sort((a, b) => b.awardAmount - a.awardAmount)
      .slice(0, 8),
  };
}).sort((a, b) => b.awardAmount - a.awardAmount);
const topExecutionVendors = aggregateAwards(uniqueAwards, (award) => ({ id: award.recipient, label: award.recipient })).slice(0, 12);
const topExecutionBuyers = aggregateAwards(uniqueAwards, (award) => ({ id: award.buyerSubAgency, label: award.buyerSubAgency, group: buyerGroup(award.buyerSubAgency) })).slice(0, 12);
const spendingOverTime = usaspendingSnapshot.spendingOverTime || {};
const spendingSeries = [
  ...(spendingOverTime.technologyAreas || []),
  ...(spendingOverTime.buyerAgencies || []),
  ...(spendingOverTime.vendors || []),
  ...(spendingOverTime.psc || []),
  ...(spendingOverTime.naics || []),
];
const spendingPeriods = spendingSeriesPeriods(spendingSeries);
const spendingTotals = spendingPeriodTotals(spendingOverTime.technologyAreas || [], spendingPeriods);
const trendPeriods = spendingPeriods.length ? trimTrailingEmptyPeriods(spendingPeriods, spendingTotals) : executionPeriods;
const executionTrendModel = spendingPeriods.length ? {
  source: "USAspending spending_over_time quarterly contract obligations",
  periods: trendPeriods,
  totalByPeriod: spendingPeriodTotals(spendingOverTime.technologyAreas || [], trendPeriods),
  byBuyerGroup: executionTrendRows(uniqueAwards, trendPeriods, (award) => ({
    id: buyerGroup(award.buyerSubAgency),
    label: buyerGroup(award.buyerSubAgency),
  }), 6),
  byBuyerAgency: spendingTrendRows(spendingOverTime.buyerAgencies || [], trendPeriods, 8),
  byVendor: spendingTrendRows(spendingOverTime.vendors || [], trendPeriods, 8),
  byPsc: spendingTrendRows(spendingOverTime.psc || [], trendPeriods, 8),
  byNaics: spendingTrendRows(spendingOverTime.naics || [], trendPeriods, 8),
  byTechnologyArea: spendingTrendRows(spendingOverTime.technologyAreas || [], trendPeriods, 11),
} : {
  source: "USAspending award search start dates",
  periods: trendPeriods,
  totalByPeriod: executionPeriodTotals(uniqueAwards, trendPeriods),
  byBuyerGroup: executionTrendRows(uniqueAwards, trendPeriods, (award) => ({
    id: buyerGroup(award.buyerSubAgency),
    label: buyerGroup(award.buyerSubAgency),
  }), 6),
  byBuyerAgency: executionTrendRows(uniqueAwards, trendPeriods, (award) => ({
    id: award.buyerSubAgency,
    label: award.buyerSubAgency,
    group: buyerGroup(award.buyerSubAgency),
  }), 8),
  byVendor: executionTrendRows(uniqueAwards, trendPeriods, (award) => ({
    id: award.recipient,
    label: award.recipient,
  }), 8),
  byPsc: executionTrendRows(uniqueAwards, trendPeriods, (award) => ({
    id: award.pscCode || "unspecified-psc",
    label: award.pscCode ? `${award.pscCode} · ${award.pscDescription || "Unlabeled PSC"}` : "Unspecified PSC",
  }), 8),
  byNaics: executionTrendRows(uniqueAwards, trendPeriods, (award) => ({
    id: award.naicsCode || "unspecified-naics",
    label: award.naicsCode ? `${award.naicsCode} · ${award.naicsDescription || "Unlabeled NAICS"}` : "Unspecified NAICS",
  }), 8),
  byTechnologyArea: executionTrendRows(awardEntries, awardPeriods(awardEntries), (award) => ({
    id: award.areaId,
    label: award.area,
  }), 11),
};
const executionCoverage = {
  sourceUrl: usaspendingSnapshot.metadata?.sourceUrl,
  spendingOverTimeUrl: usaspendingSnapshot.metadata?.spendingOverTimeUrl,
  cachedAt: usaspendingSnapshot.metadata?.generatedAt,
  startDate: usaspendingSnapshot.metadata?.startDate,
  endDate: usaspendingSnapshot.metadata?.endDate,
  methodology: usaspendingSnapshot.metadata?.methodology,
  areaCount: usaspendingSnapshot.metadata?.cachedAreaCount || awardAreaRows.length,
  failedAreaCount: usaspendingSnapshot.metadata?.failedAreaCount || 0,
  trendSeriesCount: usaspendingSnapshot.metadata?.trendSeriesCount || 0,
  failedTrendSeriesCount: usaspendingSnapshot.metadata?.failedTrendSeriesCount || 0,
  awardEntries: awardEntries.length,
  uniqueAwards: uniqueAwards.length,
  uniqueAwardValue,
  vendorCount: topExecutionVendors.length,
  buyerCount: topExecutionBuyers.length,
  trendSource: executionTrendModel.source,
  trendPeriodCount: trendPeriods.length,
  latestTrendPeriod: trendPeriods.at(-1)?.label || "n/a",
  topTrendBuyer: executionTrendModel.byBuyerAgency[0]?.label || "n/a",
  topTrendPsc: executionTrendModel.byPsc[0]?.label || "n/a",
  topTrendNaics: executionTrendModel.byNaics[0]?.label || "n/a",
};
const justificationCoverage = {
  sourcePage: justificationManifest.sourcePage,
  sourceCache: JUSTIFICATION_SOURCE_DIR,
  cachedAt: justificationManifest.generatedAt,
  sourceCount: justificationManifest.cachedSourceCount || (justificationManifest.sources || []).length,
  officialLinkCount: justificationManifest.sourceCount || (justificationManifest.sources || []).length,
  unavailableSourceCount: justificationManifest.failedSourceCount || (justificationManifest.failed || []).length,
  evidenceItems: justificationEvidenceItems.length,
  books: [...new Set(justificationEvidenceItems.map((item) => item.bookId))],
  matchedBudgetRecords: evidenceBackedRecords.length,
  matchedBudgetRecordShare: round((evidenceBackedRecords.length / Math.max(records.length, 1)) * 100),
  evidenceBackedTechnologyRecords: evidenceBackedTechnologyRecords.length,
  evidenceBackedTechnologyValue: round(sum(evidenceBackedTechnologyRecords, "fy2027")),
  evidenceBackedTechnologyShare: round((evidenceBackedTechnologyRecords.length / Math.max(technologyTaggedRecords.length, 1)) * 100),
  narrativeConfirmedTechnologyRecords: narrativeConfirmedTechnologyRecords.length,
  narrativeConfirmedTechnologyValue: round(sum(narrativeConfirmedTechnologyRecords, "fy2027")),
  narrativeConfirmedTechnologyShare: round((narrativeConfirmedTechnologyRecords.length / Math.max(technologyTaggedRecords.length, 1)) * 100),
};
const awardAreaById = new Map(awardAreaRows.map((area) => [area.id, area]));
const obligationTrendByAreaId = new Map((executionTrendModel.byTechnologyArea || []).map((area) => [area.id, area]));
const technologyAreaRows = TECHNOLOGY_AREAS.map((area) => {
  const areaRecords = records.filter((record) => record.technologyAreas.includes(area.id));
  const areaEvidenceRecords = areaRecords.filter((record) => record.justificationEvidence);
  const confirmedAreaRecords = areaRecords.filter((record) => record.justificationEvidence?.confirmedTechnologyAreas?.includes(area.id));
  const executionArea = awardAreaById.get(area.id);
  const obligationTrend = obligationTrendByAreaId.get(area.id);
  const byService = aggregateFy2027(areaRecords.filter((record) => record.orgGroup === "service"), (record) => ({ id: record.org, label: record.orgName }));
  const byClient = aggregateFy2027(areaRecords.filter((record) => record.orgGroup !== "other"), (record) => ({
    id: record.org,
    label: record.orgName,
    group: record.orgGroup,
  })).slice(0, 8);
  const byBookArea = aggregateFy2027(areaRecords, (record) => ({ id: record.bookId, label: record.color, short: record.colorShort }));
  const areaTotal = aggregateFy2027(areaRecords, () => ({ id: area.id, label: area.label }))[0] || {
    fy2027: 0,
    fy2026: 0,
    fy2025: 0,
    change: 0,
    growth: 0,
    records: 0,
  };
  return {
    ...area,
    fy2027: areaTotal.fy2027,
    fy2026: areaTotal.fy2026,
    fy2025: areaTotal.fy2025,
    change: areaTotal.change,
    growth: areaTotal.growth,
    records: areaTotal.records,
    evidenceBackedRecords: areaEvidenceRecords.length,
    evidenceBackedFy2027: round(sum(areaEvidenceRecords, "fy2027")),
    narrativeConfirmedRecords: confirmedAreaRecords.length,
    narrativeConfirmedFy2027: round(sum(confirmedAreaRecords, "fy2027")),
    evidenceShare: round((areaEvidenceRecords.length / Math.max(areaTotal.records, 1)) * 100),
    executionAwards: executionArea?.uniqueAwards || 0,
    executionAwardAmount: executionArea?.awardAmount || 0,
    executionObligationAmount: obligationTrend?.awardAmount || 0,
    latestExecutionObligationAmount: obligationTrend?.latestAmount || 0,
    executionObligationMomentum: obligationTrend?.latestChange || 0,
    executionObligationPeriods: obligationTrend?.periods || [],
    topExecutionVendors: executionArea?.topVendors || [],
    topExecutionBuyers: executionArea?.topBuyers || [],
    topExecutionAwards: executionArea?.topAwards || [],
    serviceFit: executionArea?.serviceFit || serviceFitForArea(area.id),
    narrativeConfidence: confirmedAreaRecords.length ? "Narrative confirmed" : areaEvidenceRecords.length ? "Source matched" : "Title-tagged only",
    byService,
    byClient,
    byBook: byBookArea,
    evidenceExamples: areaRecords
      .filter((record) => record.justificationEvidence?.snippets?.length)
      .sort((a, b) => (b.justificationEvidence?.confidence || 0) - (a.justificationEvidence?.confidence || 0) || b.fy2027 - a.fy2027)
      .slice(0, 5)
      .map(compactLine),
    topLines: areaRecords
      .filter((record) => record.fy2027 > 0)
      .sort((a, b) => b.fy2027 - a.fy2027)
      .slice(0, 8)
      .map(compactLine),
  };
}).filter((area) => area.records > 0).sort((a, b) => b.fy2027 - a.fy2027);

const maxTechnologyBudget = Math.max(...technologyAreaRows.map((area) => area.fy2027), 1);
const maxTechnologyObligations = Math.max(...technologyAreaRows.map((area) => area.executionObligationAmount), 1);
const budgetExecutionAlignment = technologyAreaRows.map((area) => {
  const budgetScore = Math.min((area.fy2027 / maxTechnologyBudget) * 34, 34);
  const obligationScore = Math.min((area.executionObligationAmount / maxTechnologyObligations) * 30, 30);
  const latestScore = Math.min((area.latestExecutionObligationAmount / Math.max(area.executionObligationAmount, 1)) * 18, 18);
  const evidenceScore = area.narrativeConfirmedRecords ? 12 : area.evidenceBackedRecords ? 7 : 3;
  const momentumScore = Math.max(Math.min(area.executionObligationMomentum / 8, 6), -4);
  const score = Math.round(budgetScore + obligationScore + latestScore + evidenceScore + momentumScore);
  return {
    id: area.id,
    label: area.label,
    score,
    fy2027: area.fy2027,
    records: area.records,
    growth: area.growth,
    executionAwardAmount: area.executionAwardAmount,
    executionAwards: area.executionAwards,
    executionObligationAmount: area.executionObligationAmount,
    latestExecutionObligationAmount: area.latestExecutionObligationAmount,
    executionObligationMomentum: area.executionObligationMomentum,
    narrativeConfirmedRecords: area.narrativeConfirmedRecords,
    topBuyer: area.topExecutionBuyers[0]?.label || "n/a",
    topVendor: area.topExecutionVendors[0]?.label || "n/a",
    confidence: area.narrativeConfidence,
    interpretation: `${area.label} shows ${round(area.fy2027)}B in FY2027 tagged request value and ${round(area.executionObligationAmount)}B in sampled FY2025-FY2026 contract obligations.`,
  };
}).sort((a, b) => b.score - a.score || b.executionObligationAmount - a.executionObligationAmount).slice(0, 8);

const strategyIntersections = technologyAreaRows.flatMap((area) => (
  area.byClient.slice(0, 6).map((client) => {
    const laneRecords = records.filter((record) => record.technologyAreas.includes(area.id) && record.org === client.id);
    const evidenceRecords = laneRecords.filter((record) => record.justificationEvidence);
    const confirmedRecords = laneRecords.filter((record) => record.justificationEvidence?.confirmedTechnologyAreas?.includes(area.id));
    const buyerAwards = (area.topExecutionBuyers || []).find((buyer) => buyer.group === client.label || buyer.label === client.label);
    const score = strategyScore({ ...client, areaId: area.id }) + Math.min(confirmedRecords.length * 2, 8) + (buyerAwards ? 5 : 0);
    return {
      id: `${area.id}-${client.id}`,
      areaId: area.id,
      area: area.label,
      clientId: client.id,
      client: client.label,
      group: client.group,
      fy2027: client.fy2027,
      records: client.records,
      growth: client.growth,
      evidenceBackedRecords: evidenceRecords.length,
      narrativeConfirmedRecords: confirmedRecords.length,
      executionAwards: buyerAwards?.awards || 0,
      executionAwardAmount: buyerAwards?.awardAmount || 0,
      confidence: confirmedRecords.length ? "Narrative confirmed" : evidenceRecords.length ? "Source matched" : "Title-tagged only",
      score,
      talkTrack: `${client.label} has ${round(client.fy2027)}B in ${area.label} tagged request lines, with ${client.records} visible line records.`,
    };
  })
)).sort((a, b) => b.score - a.score || b.fy2027 - a.fy2027).slice(0, 18);

const serviceStrategy = ["A", "N", "F"].map((serviceId) => {
  const serviceRecords = records.filter((record) => record.org === serviceId);
  const serviceTech = technologyAreaRows.map((area) => {
    const areaRecords = serviceRecords.filter((record) => record.technologyAreas.includes(area.id));
    return {
      id: area.id,
      label: area.label,
      ...((aggregateFy2027(areaRecords, () => ({ id: area.id, label: area.label }))[0]) || { fy2027: 0, fy2026: 0, fy2025: 0, change: 0, growth: 0, records: 0 }),
    };
  }).filter((area) => area.records > 0).sort((a, b) => b.fy2027 - a.fy2027).slice(0, 6);
  const total = aggregateFy2027(serviceRecords, () => ({ id: serviceId, label: orgName(serviceId) }))[0];
  return {
    id: serviceId,
    label: orgName(serviceId),
    fy2027: total?.fy2027 || 0,
    records: total?.records || 0,
    topTechnologyAreas: serviceTech,
  };
});

const strategyAnalytics = {
  summary: {
    technologyAreaCount: technologyAreaRows.length,
    taggedRecords: technologyTaggedRecords.length,
    taggedFy2027: round(sum(technologyTaggedRecords, "fy2027")),
    taggedRecordShare: round((technologyTaggedRecords.length / Math.max(records.length, 1)) * 100),
    taggedValueShare: round((sum(technologyTaggedRecords, "fy2027") / Math.max(total.fy2027, 1)) * 100),
    narrativeSourceCount: justificationCoverage.sourceCount,
    narrativeEvidenceItems: justificationCoverage.evidenceItems,
    evidenceBackedTechnologyRecords: justificationCoverage.evidenceBackedTechnologyRecords,
    evidenceBackedTechnologyValue: justificationCoverage.evidenceBackedTechnologyValue,
    narrativeConfirmedTechnologyRecords: justificationCoverage.narrativeConfirmedTechnologyRecords,
    narrativeConfirmedTechnologyValue: justificationCoverage.narrativeConfirmedTechnologyValue,
    executionAreaCount: executionCoverage.areaCount,
    executionAwardEntries: executionCoverage.awardEntries,
    executionUniqueAwards: executionCoverage.uniqueAwards,
    executionAwardValue: executionCoverage.uniqueAwardValue,
    topTechnologyArea: technologyAreaRows[0]?.label,
    topTechnologyValue: technologyAreaRows[0]?.fy2027 || 0,
    topClientIntersection: strategyIntersections[0]?.client,
    topClientArea: strategyIntersections[0]?.area,
    topExecutionAlignment: budgetExecutionAlignment[0]?.label,
    topExecutionAlignmentScore: budgetExecutionAlignment[0]?.score || 0,
  },
  readouts: [
    {
      id: "strategy-coverage",
      label: "Strategy coverage",
      value: `${technologyAreaRows.length} areas`,
      helper: "Technology tags connect request value to area, service, and organization priorities.",
      tone: "blue",
    },
    {
      id: "tagged-portfolio",
      label: "Technology-tagged portfolio",
      value: round(sum(technologyTaggedRecords, "fy2027")),
      display: "money",
      helper: `${round((sum(technologyTaggedRecords, "fy2027") / Math.max(total.fy2027, 1)) * 100)}% of current FY2027 request value carries at least one technology tag.`,
      tone: "green",
    },
    {
      id: "top-tech-area",
      label: "Largest technology area",
      value: technologyAreaRows[0]?.fy2027 || 0,
      display: "money",
      helper: `${technologyAreaRows[0]?.label || "N/A"} leads the tagged model.`,
      tone: "orange",
    },
    {
      id: "narrative-evidence",
      label: "Narrative evidence",
      value: justificationCoverage.narrativeConfirmedTechnologyRecords,
      helper: `${justificationCoverage.sourceCount} official RDT&E/procurement justification XMLs cached; ${justificationCoverage.evidenceBackedTechnologyRecords} tagged lines have source matches.`,
      tone: "purple",
    },
    {
      id: "execution-awards",
      label: "Execution snapshot",
      value: executionCoverage.uniqueAwardValue,
      display: "money",
      helper: `${executionCoverage.uniqueAwards} unique USAspending award records across ${executionCoverage.areaCount} technology searches.`,
      tone: "green",
    },
    {
      id: "execution-alignment",
      label: "Budget/execution alignment",
      value: budgetExecutionAlignment[0]?.score || 0,
      helper: `${budgetExecutionAlignment[0]?.label || "N/A"} has the strongest combined request, obligation, and evidence signal.`,
      tone: "orange",
    },
    {
      id: "top-client-lane",
      label: "Priority lane",
      value: strategyIntersections[0]?.score || 0,
      helper: `${strategyIntersections[0]?.client || "N/A"} · ${strategyIntersections[0]?.area || "N/A"} · ${strategyIntersections[0]?.confidence || "Title-tagged only"}.`,
      tone: "blue",
    },
  ],
  technologyAreas: technologyAreaRows,
  serviceStrategy,
  strategyIntersections,
  budgetExecutionAlignment,
  justificationCoverage,
  executionAnalytics: {
    coverage: executionCoverage,
    technologyAreas: awardAreaRows,
    topVendors: topExecutionVendors,
    topBuyers: topExecutionBuyers,
    trends: executionTrendModel,
  },
};

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
      analyticsReadouts,
      strategyAnalytics,
      justificationCoverage,
      executionCoverage,
      coverageDiagnostics: {
        signalTaggedRecords: taggedRecords.length,
        signalTaggedRecordShare: round((taggedRecords.length / Math.max(records.length, 1)) * 100),
        signalTaggedFy2027: round(taggedValue),
        signalTaggedValueShare: round((taggedValue / Math.max(total.fy2027, 1)) * 100),
        sourceDiagnosticsCount: sourceDiagnostics.length,
      },
      sourceDiagnostics,
      limitations: [
        "Budget display books are request and enacted-plan views; USAspending award data is a separate execution-side snapshot and is not yet joined to individual budget lines by accounting code.",
        "Mission signals are keyword-derived from line titles and account fields, not a validated DoD AI taxonomy.",
        "Justification evidence currently covers FY2027 OUSD(C)-published RDT&E and procurement XML sources; some service-hosted justification books require separate discovery.",
        "USAspending technology-area award searches are keyword-sampled contract award records; values should be read as market signal, not total addressable obligation by budget line.",
        "Historical request coverage currently includes M-1, O-1, P-1, R-1, and RF-1 for FY2024-FY2026; C-1 historical workbooks use a different public path and are not backfilled yet.",
        "Request-vintage trends compare workbook request totals and should not be read as execution/outlay trends.",
      ],
      nextSources: [
        "Historical C-1 workbook discovery and MILCON request package backfill.",
        "Service-hosted RDT&E and procurement justification books for Army, Navy / Marine Corps, Air Force, and Space Force narrative coverage.",
        "USAspending obligation trend pulls by agency, PSC, NAICS, and recipient for execution-side time series.",
        "FPDS/SAM contract action joins for office, vehicle, and recompete detail.",
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
