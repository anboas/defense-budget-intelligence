import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const SOURCE_DIR =
  process.env.BUDGET_SOURCE_DIR ||
  resolve(homedir(), "clawd/artifacts/defense-budget-intelligence/budget");
const CURRENT_YEAR = 2027;
const HISTORICAL_YEARS = [2024, 2025, 2026];
const CURRENT_BOOKS = [
  "m1_display.xlsx",
  "o1_display.xlsx",
  "p1_display.xlsx",
  "r1_display.xlsx",
  "rf1_display.xlsx",
  "c1_display.xlsx",
];
const HISTORICAL_BOOKS = CURRENT_BOOKS.filter(
  (file) => file !== "c1_display.xlsx",
);
const BASE_URL = "https://comptroller.war.gov/Portals/45/Documents/defbudget";

async function download(requestYear, file) {
  const url = `${BASE_URL}/FY${requestYear}/${file}`;
  const response = await fetch(url, {
    headers: { "user-agent": "defense-budget-intelligence-workbook-fetch/1.0" },
  });
  if (!response.ok)
    throw new Error(`${response.status} ${response.statusText} for ${url}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes[0] !== 0x50 || bytes[1] !== 0x4b)
    throw new Error(`Invalid XLSX payload for ${url}`);
  const outDir =
    requestYear === CURRENT_YEAR
      ? SOURCE_DIR
      : resolve(SOURCE_DIR, `FY${requestYear}`);
  mkdirSync(outDir, { recursive: true });
  writeFileSync(resolve(outDir, file), bytes);
  return { requestYear, file, bytes: bytes.length, url };
}

const targets = [
  ...HISTORICAL_YEARS.flatMap((requestYear) =>
    HISTORICAL_BOOKS.map((file) => ({ requestYear, file })),
  ),
  ...CURRENT_BOOKS.map((file) => ({ requestYear: CURRENT_YEAR, file })),
];
const downloaded = [];
for (const target of targets)
  downloaded.push(await download(target.requestYear, target.file));

writeFileSync(
  resolve(SOURCE_DIR, "workbook-manifest.json"),
  `${JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      source: BASE_URL,
      count: downloaded.length,
      downloaded,
      generator: resolve(ROOT, "scripts/fetch-budget-workbooks.mjs"),
    },
    null,
    2,
  )}\n`,
);
console.log(
  `Cached ${downloaded.length} official budget workbooks in ${SOURCE_DIR}.`,
);
