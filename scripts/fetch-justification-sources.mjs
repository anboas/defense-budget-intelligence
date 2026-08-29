import { mkdirSync, writeFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const DEFAULT_SOURCE_DIR = process.env.HOME
  ? resolve(process.env.HOME, "clawd/artifacts/defense-budget-intelligence/budget")
  : resolve(ROOT, "../artifacts/defense-budget-intelligence/budget");
const SOURCE_DIR = process.env.BUDGET_SOURCE_DIR || DEFAULT_SOURCE_DIR;
const OUT_DIR = process.env.JUSTIFICATION_SOURCE_DIR || resolve(SOURCE_DIR, "justifications/FY2027");
const JUSTIFICATION_PAGE = "https://comptroller.war.gov/BudgetMaterials/FY2027budgetjustification.aspx";
const HOST = "https://comptroller.war.gov";
const TARGET_PATHS = ["/02_Procurement/", "/03_RDT_and_E/"];

function absoluteUrl(path) {
  return path.startsWith("http") ? path : `${HOST}${path}`;
}

function sourceKind(url) {
  if (url.includes("/03_RDT_and_E/")) return { kind: "RDT&E justification", bookId: "R-1" };
  if (url.includes("/02_Procurement/")) return { kind: "Procurement justification", bookId: "P-1" };
  return { kind: "Budget justification", bookId: "unknown" };
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: { "user-agent": "defense-budget-intelligence-justification-fetch/1.0" },
  });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText} for ${url}`);
  return response.text();
}

const html = await fetchText(JUSTIFICATION_PAGE);
const links = [...html.matchAll(/href="([^"]+\.xml)"/gi)]
  .map((match) => match[1].replace(/&amp;/g, "&"))
  .filter((url) => TARGET_PATHS.some((path) => url.includes(path)));

const sources = [...new Set(links)].sort().map((path) => {
  const url = absoluteUrl(path);
  const { kind, bookId } = sourceKind(url);
  const localFile = basename(path);
  return {
    id: localFile.replace(/\.xml$/i, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
    name: localFile.replace(/\.xml$/i, "").replace(/_/g, " "),
    kind,
    bookId,
    url,
    pdfUrl: url.replace(/\.xml$/i, ".pdf"),
    localFile,
  };
});

mkdirSync(OUT_DIR, { recursive: true });

let downloaded = 0;
const failed = [];
for (const source of sources) {
  try {
    const xml = await fetchText(source.url);
    writeFileSync(resolve(OUT_DIR, source.localFile), xml);
    downloaded += 1;
  } catch (error) {
    failed.push({ ...source, error: error.message });
  }
}

const manifest = {
  generatedAt: new Date().toISOString(),
  sourcePage: JUSTIFICATION_PAGE,
  budgetYear: 2027,
  targetKinds: TARGET_PATHS,
  sourceCount: sources.length,
  cachedSourceCount: downloaded,
  failedSourceCount: failed.length,
  sources: sources.filter((source) => !failed.some((item) => item.url === source.url)),
  failed,
};

writeFileSync(resolve(OUT_DIR, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Cached ${downloaded} FY2027 justification XML sources in ${OUT_DIR}; ${failed.length} unavailable.`);
