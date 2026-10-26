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

  await page.goto(`${baseUrl}#/tasking?taskingView=workstreams`, { waitUntil: "domcontentloaded" });
  await page.locator("[data-tasking-workspace]").waitFor();
  assert.equal(await page.locator(".tasking-workstream-item").count(), 0, `${name}: static Tasking must not render synthetic workstreams`);
  assert.equal(await page.locator(".tasking-workstream-rail").count(), 1, `${name}: expected one stable workstream owner`);
  assert.equal(await page.locator(".tasking-inspector").count(), 1, `${name}: expected one selected-record inspector`);
  await page.getByText("No workstreams yet", { exact: true }).waitFor();
  const bodyText = await page.locator("body").innerText();
  assert.doesNotMatch(bodyText, /Synthetic foundation|Example mission pursuit|Example owner|Capture brief v0\.2/i, `${name}: demo copy must not ship`);

  await page.goto(`${baseUrl}#/tasking?taskingView=sources`, { waitUntil: "domcontentloaded" });
  await page.getByText("No workstreams yet", { exact: true }).waitFor();
  await page.goto(`${baseUrl}#/tasking?taskingView=communications`, { waitUntil: "domcontentloaded" });
  await page.getByText("No workstreams yet", { exact: true }).waitFor();

  const pageBounds = await page.evaluate(() => ({ width: window.innerWidth, scrollWidth: document.documentElement.scrollWidth }));
  assert.ok(pageBounds.scrollWidth <= pageBounds.width, `${name}: page overflow ${pageBounds.scrollWidth}px > ${pageBounds.width}px`);

  if (screenshot) {
    fs.mkdirSync(path.resolve("test-results"), { recursive: true });
    await page.screenshot({ path: path.resolve(`test-results/tasking-empty-${name}.png`), fullPage: true });
  }

  assert.deepEqual(errors, [], `${name}: browser errors: ${errors.join(" | ")}`);
  assert.deepEqual(failedResponses, [], `${name}: failed responses: ${failedResponses.join(" | ")}`);
  results.push({ name, ...viewport, pageScrollWidth: pageBounds.scrollWidth, browserErrors: errors.length, failedResponses: failedResponses.length });
  await page.close();
}

try {
  await verifyViewport("desktop", { width: 1440, height: 1000 }, { screenshot: true });
  await verifyViewport("mobile", { width: 390, height: 844 });
  console.log("Tasking empty-state verification passed", results);
} finally {
  await browser.close();
}
