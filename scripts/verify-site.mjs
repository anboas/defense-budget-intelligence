import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { chromium } from "playwright-core";

const BASE_URL = "http://127.0.0.1:4188/";
const OUT_DIR = "test-results";
mkdirSync(OUT_DIR, { recursive: true });

async function waitForServer(url, timeoutMs = 20000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  throw new Error(`Timed out waiting for ${url}`);
}

const server = spawn("npm", ["run", "dev", "--", "--port", "4188", "--strictPort"], { stdio: "ignore" });
await waitForServer(BASE_URL);

const executablePath = [process.env.CHROMIUM_PATH, "/usr/bin/chromium-browser", "/usr/bin/chromium"].find((candidate) => candidate && existsSync(candidate));
const browser = await chromium.launch({
  ...(executablePath ? { executablePath } : {}),
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("[data-defense-budget-app]");
  const text = await page.locator("[data-defense-budget-app]").innerText();
  assert.match(text, /Budget & Spend Intelligence/);
  assert.match(text, /AI \/ Autonomy/);
  assert.match(text, /Fourth Estate/);
  assert.match(text, /Opportunity/);
  assert.match(text, /Policy/);
  assert.equal(await page.locator(".if-operations-app[data-budget-spend-app]").count(), 1, "Budget app should use operations app shell");
  assert.equal(await page.locator(".if-product-header[data-budget-spend-header]").count(), 1, "Budget app should use product header shell");
  assert.equal(await page.locator("[data-active-page-title]").innerText(), "Budget & Spend Intelligence", "Header should expose active page title");
  assert.equal(await page.locator("[data-if-operations-workspace][data-visual-density='compact']").count(), 1, "Budget app should use compact operations workspace");
  assert.equal(await page.locator("[data-budget-filter-bar]").count(), 1, "Budget filters should expose a control bar hook");
  assert.equal(await page.locator("[data-budget-metric]").count(), 4, "Budget metrics should use stable metric hooks");
  assert.equal(await page.locator('a[href="https://opportunity-intelligence-full.pages.dev/"]').count(), 1, "Opportunity peer link should exist");
  assert.equal(await page.locator('a[href="https://policy-intelligence-full.pages.dev/"]').count(), 1, "Policy peer link should exist");
  await page.getByRole("button", { name: /Services/ }).click();
  assert.equal(new URL(page.url()).hash, "#/budget-spend/services", "Services should deep-link through hash route");
  assert.equal(await page.locator("[data-active-page-title]").innerText(), "Services", "Header should track route title");
  await page.getByRole("button", { name: /AI \/ Autonomy/ }).click();
  assert.equal(new URL(page.url()).hash, "#/budget-spend/ai-autonomy", "AI route should deep-link through hash route");
  assert.match(await page.locator("[data-defense-budget-app]").innerText(), /spending/i);
  await page.getByRole("button", { name: /Data Sources/ }).click();
  assert.equal(new URL(page.url()).hash, "#/budget-spend/sources", "Data Sources should deep-link through hash route");
  const sourcesText = await page.locator("[data-defense-budget-app]").innerText();
  assert.match(sourcesText, /Source Governance/i);
  assert.match(sourcesText, /Our versions/i);
  assert.match(sourcesText, /Refresh Model/i);
  await page.getByRole("button", { name: /Drilldown/ }).click();
  assert.equal(new URL(page.url()).hash, "#/budget-spend/drilldown", "Drilldown should deep-link through hash route");
  await page.getByPlaceholder("Search line items").fill("artificial intelligence");
  assert.match(await page.locator("[data-budget-record-table]").innerText(), /Artificial Intelligence|Autonomous|Machine/i);
  const overflow = await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - window.innerWidth);
  assert.ok(overflow <= 2, `desktop overflow ${overflow}`);
  await page.screenshot({ path: `${OUT_DIR}/desktop.png`, fullPage: true });
  await page.close();

  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await mobile.goto(BASE_URL, { waitUntil: "domcontentloaded" });
  await mobile.waitForSelector("[data-defense-budget-app]");
  assert.equal(await mobile.locator(".if-product-header[data-budget-spend-header]").count(), 1, "Mobile should keep product header shell");
  await mobile.getByRole("button", { name: /Data Sources/ }).click();
  assert.match(await mobile.locator("[data-defense-budget-app]").innerText(), /Source Register/i);
  const mobileOverflow = await mobile.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - window.innerWidth);
  assert.ok(mobileOverflow <= 2, `mobile overflow ${mobileOverflow}`);
  await mobile.screenshot({ path: `${OUT_DIR}/mobile.png`, fullPage: true });
  await mobile.close();
  console.log("Verified Defense Budget & Spend Intelligence desktop/mobile.");
} finally {
  await browser.close();
  server.kill("SIGTERM");
}
