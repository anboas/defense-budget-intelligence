import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const OUT = "src/data/program-intelligence.json";
const PUBLIC_OUT = "public/data/program-intelligence.json";
const SOURCE = JSON.parse(readFileSync("src/data/program-intelligence-sources.json", "utf8"));
const CORE = JSON.parse(readFileSync("public/data/budget-core.json", "utf8"));
const BUDGET_SOURCE_DIR = process.env.BUDGET_SOURCE_DIR || resolve(process.env.HOME || ".", "clawd/artifacts/defense-budget-intelligence/budget");
const FY2024_R1 = resolve(BUDGET_SOURCE_DIR, "FY2024/r1_display.xlsx");
const hash = (value) => createHash("sha256").update(String(value)).digest("hex").slice(0, 20);
const normalized = (value) => String(value || "").trim().toUpperCase().replace(/[^A-Z0-9]+/g, "");
const programKey = (row) => `${row.bookId}|${row.org}|${normalized(row.lineCode || row.lineNumber || row.lineTitle)}`;
const programId = (row) => `defense-program:${hash(programKey(row))}`;
const officeId = (organization) => `program-office:${hash(organization)}`;
const sourceById = new Map((SOURCE.sources || []).map((row) => [row.id, row]));

function unzipText(file, path) {
  return execFileSync("unzip", ["-p", file, path], { encoding: "utf8", maxBuffer: 120 * 1024 * 1024 });
}

function decodeXml(value = "") {
  return String(value).replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&apos;/g, "'").replace(/&#10;/g, "\n").replace(/&#13;/g, "\r").replace(/_x000D_/g, "\r");
}

function text(value = "") {
  return decodeXml(value).replace(/\s+/g, " ").trim();
}

function columnIndex(reference) {
  let index = 0;
  for (const character of reference) index = index * 26 + character.charCodeAt(0) - 64;
  return index - 1;
}

function parseRows(file) {
  const sharedXml = unzipText(file, "xl/sharedStrings.xml");
  const strings = [...sharedXml.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((match) => text([...match[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((part) => part[1]).join("")));
  const sheetXml = unzipText(file, "xl/worksheets/sheet1.xml");
  return [...sheetXml.matchAll(/<row[^>]*r="(\d+)"[^>]*>([\s\S]*?)<\/row>/g)].map((match) => {
    const cells = [];
    for (const cell of match[2].matchAll(/<c[^>]*r="([A-Z]+)\d+"([^>]*)>([\s\S]*?)<\/c>/g)) {
      const raw = cell[3].match(/<v>([\s\S]*?)<\/v>/)?.[1] || "";
      cells[columnIndex(cell[1])] = cell[2].includes('t="s"') ? strings[Number(raw)] : text(raw);
    }
    return cells;
  });
}

function number(value) {
  const result = Number(String(value || "").replace(/,/g, ""));
  return Number.isFinite(result) ? result : 0;
}

function historicalR1Rows() {
  if (!existsSync(FY2024_R1)) {
    let previous;
    try { previous = JSON.parse(readFileSync(OUT, "utf8")); } catch { previous = null; }
    const retained = previous?.historicalBudgetLines || [];
    if (!retained.length) throw new Error(`Missing authoritative FY2024 R-1 workbook and verified extract: ${FY2024_R1}`);
    console.warn(`FY2024 R-1 workbook cache unavailable; using ${retained.length} committed rows previously verified from the official workbook`);
    return retained.map((row) => ({
      bookId: row.bookId,
      account: row.account,
      accountTitle: row.accountTitle,
      org: row.organizationCode,
      lineNumber: String(row.lineNumber),
      lineCode: row.lineCode,
      lineTitle: row.label,
      requestAmountThousands: Number(row.requestAmountThousands),
    }));
  }
  const rows = parseRows(FY2024_R1);
  const header = rows.find((row) => row.includes("Account") && row.includes("Line Number") && row.includes("FY 2024 Request"));
  if (!header) throw new Error("FY2024 R-1 header not found");
  const columns = Object.fromEntries(header.map((value, index) => [text(value), index]));
  return rows.slice(rows.indexOf(header) + 1).map((row) => ({
    bookId: "R-1",
    account: text(row[columns.Account]),
    accountTitle: text(row[columns["Account Title"]]),
    org: text(row[columns.Organization]),
    lineNumber: text(row[columns["Line Number"]]),
    lineCode: text(row[columns["PE/BLI"]]),
    lineTitle: text(row[columns["Program Element/Budget Line Item (BLI) Title"]]),
    requestAmountThousands: number(row[columns["FY 2024 Request"]]),
  })).filter((row) => row.lineNumber && row.lineCode && row.requestAmountThousands >= 0);
}

const aliases = new Map();
for (const row of SOURCE.reviewedProgramAliases || []) {
  for (const alias of row.aliases || []) aliases.set(normalized(alias), row);
}

const grouped = new Map();
for (const line of (CORE.records || []).filter((row) => ["R-1", "P-1", "C-1"].includes(row.bookId) && (row.lineCode || row.lineNumber))) {
  const alias = aliases.get(normalized(line.lineTitle));
  const key = alias ? `reviewed-alias:${alias.canonicalName}` : programKey(line);
  const existing = grouped.get(key) || {
    id: `defense-program:${hash(key)}`,
    key,
    label: alias?.canonicalName || line.lineTitle || line.lineCode,
    programKind: line.bookId === "R-1" ? "research-development" : line.bookId === "P-1" ? "procurement" : "military-construction",
    organization: line.orgName,
    organizationCode: line.org,
    budgetBookIds: [],
    budgetLineCodes: [],
    aliases: [],
    sourceArtifact: "budget-core",
    identityBasis: alias ? "reviewed-official-alias" : "exact-budget-line-identifier",
    reviewState: alias ? "reviewed" : "source_snapshot",
  };
  existing.budgetBookIds.push(line.bookId);
  existing.budgetLineCodes.push(line.lineCode || line.lineNumber);
  existing.aliases.push(line.lineTitle);
  grouped.set(key, existing);
}

const portfolioProgram = {
  id: `defense-program:${hash("portfolio:major-defense-acquisition-programs")}`,
  key: "portfolio:major-defense-acquisition-programs",
  label: "Major Defense Acquisition Program portfolio",
  programKind: "acquisition-portfolio",
  organization: "Department of Defense",
  organizationCode: "DOD",
  budgetBookIds: [],
  budgetLineCodes: [],
  aliases: ["MDAP portfolio"],
  sourceArtifact: "program-intelligence-sources",
  identityBasis: "gao-source-declared-portfolio",
  reviewState: "source_snapshot"
};
grouped.set(portfolioProgram.key, portfolioProgram);

const programs = [...grouped.values()].map((row) => ({
  ...row,
  budgetBookIds: [...new Set(row.budgetBookIds)].sort(),
  budgetLineCodes: [...new Set(row.budgetLineCodes)].sort(),
  aliases: [...new Set(row.aliases.filter(Boolean))].sort(),
})).sort((left, right) => left.label.localeCompare(right.label));
const programByKey = new Map(programs.map((row) => [row.key, row]));
const programByLine = new Map();
for (const line of (CORE.records || []).filter((row) => ["R-1", "P-1", "C-1"].includes(row.bookId) && (row.lineCode || row.lineNumber))) {
  const alias = aliases.get(normalized(line.lineTitle));
  programByLine.set(line.id, programByKey.get(alias ? `reviewed-alias:${alias.canonicalName}` : programKey(line)));
}
const programBudgetLines = [...programByLine.entries()].map(([budgetLineSourceId, program]) => ({
  programId: program.id,
  budgetLineId: `budget-line:${budgetLineSourceId}`,
  basis: program.identityBasis === "reviewed-official-alias" ? "reviewed-program-alias" : "exact-budget-line-identifier",
}));

const organizations = [...new Set(programs.map((row) => row.organization).filter(Boolean))].sort();
const programOffices = organizations.map((organization) => ({
  id: officeId(organization),
  label: `${organization} budget sponsor`,
  organization,
  roleType: "budget-sponsor",
  identityBasis: "published-budget-organization",
  reviewState: "source_snapshot",
}));

const baselineByProgram = new Map();
for (const line of CORE.records || []) {
  const program = programByLine.get(line.id);
  if (!program) continue;
  const baseline = baselineByProgram.get(program.id) || {
    id: `program-baseline:${hash(`${program.id}|PB2027`)}`,
    programId: program.id,
    label: `${program.label} FY2027 request baseline`,
    baselineType: "presidents-budget-request",
    requestYear: 2027,
    amountsMillions: { fy2025: 0, fy2026: 0, fy2027: 0 },
    sourceUrl: CORE.metadata?.sources?.find((source) => source.id === line.bookId)?.sourceUrl || "https://comptroller.war.gov/Budget-Materials/",
    reviewState: "source_snapshot",
  };
  baseline.amountsMillions.fy2025 += Number(line.fy2025 || 0);
  baseline.amountsMillions.fy2026 += Number(line.fy2026 || 0);
  baseline.amountsMillions.fy2027 += Number(line.fy2027 || 0);
  baselineByProgram.set(program.id, baseline);
}

const historicalRows = historicalR1Rows();
const historicalBudgetLines = [];
const appropriationMarks = [];
const historicalBaselines = [];
for (const table of SOURCE.appropriationTables || []) {
  for (const [printedPage, lineNumber, title, requestAmountThousands, recommendedAmountThousands, changeAmountThousands] of table.marks || []) {
    if (recommendedAmountThousands - requestAmountThousands !== changeAmountThousands) throw new Error(`Mark arithmetic mismatch on ${table.id} line ${lineNumber}`);
    const candidates = historicalRows.filter((row) => row.org === table.organization && row.accountTitle === table.accountTitle && Number(row.lineNumber) === Number(lineNumber) && row.requestAmountThousands === requestAmountThousands);
    if (candidates.length !== 1) throw new Error(`Expected one exact FY2024 R-1 match for ${table.id} line ${lineNumber}; found ${candidates.length}`);
    const line = candidates[0];
    const alias = aliases.get(normalized(line.lineTitle));
    const key = alias ? `reviewed-alias:${alias.canonicalName}` : programKey(line);
    let program = programByKey.get(key);
    if (!program) {
      program = {
        id: programId(line), key, label: line.lineTitle, programKind: "research-development", organization: "Army", organizationCode: line.org,
        budgetBookIds: ["R-1"], budgetLineCodes: [line.lineCode], aliases: [line.lineTitle], sourceArtifact: "fy2024-r1-workbook", identityBasis: "exact-budget-line-identifier", reviewState: "source_snapshot",
      };
      programByKey.set(key, program);
      programs.push(program);
    }
    const budgetLineId = `budget-line:2024:R-1:${line.org}:${line.lineCode}`;
    historicalBudgetLines.push({ id: budgetLineId, programId: program.id, sourceId: `2024-R-1-${line.lineCode}`, label: line.lineTitle, bookId: "R-1", requestYear: 2024, account: line.account, accountTitle: line.accountTitle, organization: "Army", organizationCode: line.org, lineNumber: Number(line.lineNumber), lineCode: line.lineCode, requestAmountThousands, sourceUrl: "https://comptroller.war.gov/Portals/45/Documents/defbudget/FY2024/r1_display.xlsx", reviewState: "source_snapshot" });
    historicalBaselines.push({ id: `program-baseline:${hash(`${program.id}|PB2024`)}`, programId: program.id, label: `${program.label} FY2024 request baseline`, baselineType: "presidents-budget-request", requestYear: 2024, amountsThousands: { fy2024: requestAmountThousands }, sourceUrl: "https://comptroller.war.gov/Portals/45/Documents/defbudget/FY2024/r1_display.xlsx", reviewState: "source_snapshot" });
    appropriationMarks.push({
      id: `appropriation-mark:${hash(`${table.id}|${line.lineCode}`)}`,
      programId: program.id,
      budgetLineId,
      measureId: table.measureId,
      reportId: table.reportId,
      label: `${title} House recommendation`,
      fiscalYear: table.fiscalYear,
      chamber: "House",
      stage: "committee-reported",
      printedPage,
      tableTitle: table.tableTitle,
      lineNumber,
      lineCode: line.lineCode,
      requestAmountThousands,
      recommendedAmountThousands,
      changeAmountThousands,
      sourceUrl: sourceById.get(table.sourceId)?.url,
      sourceId: table.sourceId,
      reviewState: "reviewed",
      matchBasis: "exact-account-line-number-and-request-amount",
    });
  }
}

const uniqueHistoricalBaselines = [...new Map(historicalBaselines.map((row) => [row.id, row])).values()];
const findings = (SOURCE.portfolioFindings || []).map((row) => {
  const program = programByKey.get(row.programKey);
  if (!program) throw new Error(`Unknown finding program key: ${row.programKey}`);
  return { ...row, programId: program.id, sourceUrl: sourceById.get(row.sourceId)?.url };
});

const payload = {
  metadata: {
    schemaVersion: "1.0.0",
    generatedAt: new Date().toISOString(),
    coverage: {
      programs: programs.length,
      programOffices: programOffices.length,
      requestBaselines: baselineByProgram.size + uniqueHistoricalBaselines.length,
      historicalBudgetLines: historicalBudgetLines.length,
      appropriationMarks: appropriationMarks.length,
      changedMarks: appropriationMarks.filter((row) => row.changeAmountThousands !== 0).length,
      costEstimates: findings.filter((row) => row.kind === "cost-estimate").length,
      scheduleEvents: findings.filter((row) => row.kind === "schedule-event").length,
      programRisks: findings.filter((row) => row.kind === "program-risk").length,
      acquisitionMilestones: 0,
      unitCostBreaches: 0,
      testFindings: 0,
    },
    evidenceBoundary: "Request baselines are official budget proposals, not acquisition program baselines or independent cost estimates. House marks are committee recommendations, not enacted amounts. Empty milestone, breach, and test domains remain explicit until authoritative program-level evidence is collected.",
    contentHash: hash(JSON.stringify({ programs, appropriationMarks, findings })),
  },
  sources: SOURCE.sources,
  programs,
  programOffices,
  programBudgetLines,
  programBaselines: [...baselineByProgram.values(), ...uniqueHistoricalBaselines],
  historicalBudgetLines,
  appropriationMarks,
  findings,
};

for (const target of [OUT, PUBLIC_OUT]) {
  const temporary = `${target}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(payload, null, 2)}\n`);
  renameSync(temporary, target);
}
console.log(`Program intelligence: ${programs.length} programs, ${payload.programBaselines.length} baselines, ${appropriationMarks.length} page-cited House marks, ${findings.length} GAO findings`);
