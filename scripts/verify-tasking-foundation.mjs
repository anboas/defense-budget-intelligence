import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { chromium } from "playwright-core";

const baseUrl = process.env.TASKING_VERIFY_URL || "http://127.0.0.1:4177/defense-budget-intelligence/";
const chromiumPath = [process.env.CHROMIUM_PATH, "/usr/bin/chromium-browser", "/usr/bin/chromium"]
  .find((candidate) => candidate && fs.existsSync(candidate));
const browser = await chromium.launch({ headless: true, ...(chromiumPath ? { executablePath: chromiumPath } : {}) });
const results = [];

async function verifyViewport(name, viewport, { screenshot = false } = {}) {
  const page = await browser.newPage({ viewport });
  const errors = [];
  const failedResponses = [];
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().startsWith("Failed to load resource:")) errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("response", (response) => {
    if (response.status() >= 400 && !response.url().endsWith("/api/v1/auth/status")) failedResponses.push(`${response.status()} ${response.url()}`);
  });

  await page.goto(`${baseUrl}#/tasking?taskingView=portfolio`, { waitUntil: "domcontentloaded" });
  await page.locator("[data-tasking-workspace]").waitFor();
  assert.equal(await page.locator(".tasking-lane").count(), 4, `${name}: expected four workstream lanes`);
  assert.equal(await page.locator(".tasking-folder-panel").count(), 1, `${name}: expected one folder hierarchy owner`);
  assert.equal(await page.locator(".tasking-context").count(), 1, `${name}: expected one selected-record context owner`);

  const pageBounds = await page.evaluate(() => ({ width: window.innerWidth, scrollWidth: document.documentElement.scrollWidth }));
  assert.ok(pageBounds.scrollWidth <= pageBounds.width, `${name}: page overflow ${pageBounds.scrollWidth}px > ${pageBounds.width}px`);

  if (name === "desktop") {
    await page.locator("button.tasking-task-row").filter({ hasText: "Confirm solution owner" }).first().click();
    assert.match(page.url(), /taskingRecord=task-solution-owner/, "desktop: selected task ID should own route state");
    fs.mkdirSync(path.resolve("test-results"), { recursive: true });
    await page.screenshot({ path: path.resolve("test-results/tasking-foundation-desktop-portfolio.png"), fullPage: true });
    await page.locator('[data-workspace-view="connections"]').click();
    await page.locator(".tasking-graph").waitFor();
    assert.match(page.url(), /taskingRecord=task-solution-owner/, "desktop: selection should persist across views");
    assert.equal(await page.locator(".tasking-relationship-list article").count(), 5, "desktop: relationship list alternative should retain every visible edge");
    await page.screenshot({ path: path.resolve("test-results/tasking-foundation-desktop-connections.png"), fullPage: true });
    await page.locator('[data-workspace-view="files"]').click();
    await page.locator(".tasking-file-table").waitFor();
    assert.match(page.url(), /taskingRecord=task-solution-owner/, "desktop: selection should persist into the file view");
    await page.screenshot({ path: path.resolve("test-results/tasking-foundation-desktop-files.png"), fullPage: true });
  }

  if (screenshot) {
    fs.mkdirSync(path.resolve("test-results"), { recursive: true });
    await page.screenshot({ path: path.resolve(`test-results/tasking-foundation-${name}.png`), fullPage: true });
  }

  assert.deepEqual(errors, [], `${name}: browser errors: ${errors.join(" | ")}`);
  assert.deepEqual(failedResponses, [], `${name}: failed responses: ${failedResponses.join(" | ")}`);
  results.push({ name, ...viewport, pageScrollWidth: pageBounds.scrollWidth, browserErrors: errors.length, failedResponses: failedResponses.length });
  await page.close();
}

try {
  await verifyViewport("desktop", { width: 1440, height: 1000 }, { screenshot: true });
  await verifyViewport("mobile", { width: 390, height: 844 });
  console.log("Tasking foundation verification passed", results);
} finally {
  await browser.close();
}
