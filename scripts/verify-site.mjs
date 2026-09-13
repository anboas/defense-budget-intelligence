import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { chromium } from "playwright-core";

const REMOTE_BASE_URL = process.env.BUDGET_VERIFY_URL;
const BASE_URL = REMOTE_BASE_URL ? new URL(REMOTE_BASE_URL).href : "http://127.0.0.1:4188/";
const OUT_DIR = "test-results";
const FLOW_LABELS = ["PDB Request", "Request History", "Account Flow", "Awards", "Transactions"];
const FORBIDDEN_SURFACE_TEXT = /Decision Briefs|Portfolio Strategy|Pursuit Cockpit|Target execution brief|Target workboard|attention score|win probability/i;
mkdirSync(OUT_DIR, { recursive: true });

async function waitForServer(url, timeoutMs = 30000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // The local Vite process may still be starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

function resourceCount(page, filename) {
  return page.evaluate((name) => performance.getEntriesByType("resource").filter((entry) => entry.name.endsWith(`/data/${name}`)).length, filename);
}

async function openSurface(page, route, selector) {
  await page.locator(`[data-budget-nav="${route}"]`).evaluate((node) => node.click());
  await page.waitForSelector(selector);
}

async function assertNoPageOverflow(page, label) {
  const overflow = await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - window.innerWidth);
  assert.ok(overflow <= 2, `${label} page overflow should be contained, got ${overflow}px`);
}

async function assertFlowShell(page) {
  assert.equal(await page.locator(".ci-header-nav > button[data-budget-nav]").count(), 6, "Header should expose exactly six factual surfaces");
  assert.equal(await page.locator("[data-budget-nav-more]").count(), 0, "Header should not expose a secondary strategy menu");
  assert.equal(await page.locator("[data-peer-intelligence-nav]").count(), 0, "Analytics app should not expose peer-product surfaces inside the workspace");
  const rail = page.locator("[data-money-flow-rail]");
  assert.equal(await rail.locator("a").count(), 5, "Money-flow rail should end at transaction-level spend");
  for (const [index, label] of FLOW_LABELS.entries()) {
    assert.match((await rail.locator("a").nth(index).innerText()).replace(/\s+/g, " "), new RegExp(`^${index + 1} ${label}$`), `Stage ${index + 1} should be ${label}`);
  }
  assert.doesNotMatch(await page.locator("[data-defense-budget-app]").innerText(), FORBIDDEN_SURFACE_TEXT, "Rendered analytics shell should not expose judgment surfaces");
}

const server = REMOTE_BASE_URL ? null : spawn("npm", ["run", "dev", "--", "--port", "4188", "--strictPort"], { stdio: "ignore" });
if (server) await waitForServer(BASE_URL);

const executablePath = [
  process.env.CHROMIUM_PATH,
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium-browser",
  "/usr/bin/chromium",
].find((candidate) => candidate && existsSync(candidate));
const browser = await chromium.launch({
  ...(executablePath ? { executablePath } : {}),
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  let transactionRequests = 0;
  await page.route("**/data/capture-transactions.json", async (route) => {
    transactionRequests += 1;
    await new Promise((resolve) => setTimeout(resolve, 250));
    await route.continue();
  });

  await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("[data-defense-budget-app]");
  assert.equal(await page.locator("[data-active-page-title]").innerText(), "PDB Request");
  assert.match(await page.title(), /^PDB Request · Defense Budget & Spend Analytics$/);
  assert.equal(await page.locator("h1").count(), 1, "Each route should expose one product H1");
  await assertFlowShell(page);

  assert.equal(await page.locator("[data-pdb-request-page]").count(), 1, "Default surface should be the source request");
  assert.equal(await page.locator("[data-budget-filter-bar]").count(), 1, "Request surface should expose line-level filters");
  assert.equal(await page.locator("[data-budget-metric]").count(), 5, "Request surface should expose factual coverage metrics");
  assert.equal(await page.locator("[data-analytics-readout]").count(), 0, "Request surface should not generate narrative judgments");
  assert.equal(await resourceCount(page, "budget-execution.json"), 0, "Request surface should defer award data");
  assert.equal(await resourceCount(page, "account-spine.json"), 0, "Request surface should defer account data");
  assert.equal(await resourceCount(page, "budget-strategy.json"), 0, "Retired strategy payload must never load");

  const search = page.getByPlaceholder("Search line items, accounts, organizations");
  await search.fill("artificial intelligence");
  await page.waitForFunction(() => new URLSearchParams(window.location.hash.split("?")[1] || "").get("query") === "artificial intelligence");
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector("[data-pdb-request-page]");
  assert.equal(await page.getByPlaceholder("Search line items, accounts, organizations").inputValue(), "artificial intelligence", "Request filters should survive a reload through the URL");
  await page.getByRole("button", { name: "Reset" }).click();
  assert.equal(await page.getByPlaceholder("Search line items, accounts, organizations").inputValue(), "");

  await openSurface(page, "#/budget-spend/trends", "[data-request-history-page]");
  assert.equal(await page.locator("[data-active-page-title]").innerText(), "Request History");
  assert.equal(await page.locator("[data-request-history-timeline] .trend-year-card").count(), 4, "History should expose four request vintages");
  assert.equal(await page.locator("[data-comparable-request-trend] article").count(), 4, "History should expose comparable request values");
  assert.equal(await page.locator("[data-color-money-history] .trend-series-card").count(), 6, "History should expose all six colors of money");
  const historyText = await page.locator("[data-request-history-page]").locator("xpath=..").innerText();
  assert.match(historyText, /Largest Request Changes/);
  assert.doesNotMatch(historyText, /Momentum Leaders|Trend Readout/);

  await openSurface(page, "#/budget-spend/lifecycle", "[data-account-spine-page]");
  assert.equal(await page.locator("[data-active-page-title]").innerText(), "Account Flow");
  assert.equal(await resourceCount(page, "account-spine.json"), 1, "Account flow should load its factual payload once");
  assert.equal(await page.locator("[data-lifecycle-waterfall] .lifecycle-stage").count(), 4, "Account flow should separate request, apportionment, obligation, and outlay");
  assert.ok(await page.locator("[data-account-flow] article").count() >= 1, "Account flow should expose TAFS allocations");
  assert.ok(await page.locator("[data-award-account-flow] article").count() >= 1, "Account flow should expose award-to-account links");
  assert.equal(await page.locator("[data-burn-curve] svg").count(), 1, "Account flow should expose obligation history");
  assert.ok(await page.locator("#lifecycle-account option").count() > 100, "Account flow should expose the federal-account inventory");
  const lifecycleText = await page.locator("[data-account-spine-page]").innerText();
  assert.match(lifecycleText, /derived/i, "Derived request joins should be labeled");
  assert.match(lifecycleText, /exact TAFS joins/i, "Exact TAFS joins should be labeled");

  await openSurface(page, "#/budget-spend/awards", "[data-awards-page]");
  assert.equal(await page.locator("[data-active-page-title]").innerText(), "Awards");
  assert.equal(await resourceCount(page, "budget-execution.json"), 1, "Awards should load the factual execution payload once");
  assert.equal(await page.locator("[data-award-filter-bar] select").count(), 5, "Awards should expose factual filter dimensions");
  assert.ok(await page.locator("[data-award-record-table] tbody tr").count() >= 100, "Awards should expose the sampled award table");
  assert.doesNotMatch(await page.locator("[data-awards-page]").innerText(), /Pursuit score|recommended action|Target execution brief|Target workboard/i);

  await openSurface(page, "#/budget-spend/transactions", "[data-transaction-analytics-page]");
  assert.equal(await page.locator("[data-active-page-title]").innerText(), "Transactions");
  assert.equal(await resourceCount(page, "capture-calendar.json"), 1, "Transactions should load the public event payload once");
  assert.equal(transactionRequests, 0, "Exact FPDS actions should remain deferred until a record opens");
  const transactionText = await page.locator("[data-transaction-analytics-page]").innerText();
  assert.match(transactionText, /198 public records/i);
  assert.match(transactionText, /502 normalized events and 3,085 exact FPDS actions/i);
  assert.doesNotMatch(transactionText, FORBIDDEN_SURFACE_TEXT);
  assert.equal(await page.locator("[data-targeting-chart]").count(), 0, "Targeting charts should be removed");
  assert.equal(await page.locator("[data-capture-workboard]").count(), 0, "Analyst workboard should be removed");
  assert.equal(await page.locator("[data-capture-chart]").count(), 13, "Transactions should retain thirteen descriptive charts");
  assert.equal(await page.locator("[data-capture-matrix]").count(), 1, "Transactions should retain its descriptive lifecycle matrix");
  assert.equal(await page.locator("[data-capture-filters] .capture-filter").count(), 16, "Transactions should expose sixteen factual filters");
  assert.equal(await page.locator("[data-capture-timeline] .capture-timeline__row").count(), 50, "Transactions should render the default fifty timeline rows");
  const barBox = await page.locator("[data-capture-timeline] .capture-timeline__bar--base").first().boundingBox();
  assert.ok(barBox && barBox.height >= 20 && barBox.height <= 24, `Timeline bars should stay precisely formatted, got ${barBox?.height}px`);
  assert.ok(await page.locator("[data-capture-timeline] .capture-timeline__years small i").count() >= 20, "Timeline should expose quarter guides");
  assert.equal(await page.locator("[data-capture-timeline] .capture-timeline__today").first().count(), 1, "Timeline should expose the source as-of marker");
  assert.equal(await page.getByLabel("Grouping").locator("option").count(), 10, "Gantt should expose ten factual grouping modes");
  assert.equal(await page.getByLabel("Bar labels").locator("option").count(), 6, "Gantt should expose six bar-label modes");
  assert.equal(await page.locator("[data-capture-gantt-tools] .capture-gantt-toolgroup").count(), 3, "Gantt controls should be organized into time, display, and data groups");
  await page.locator("[data-capture-field-picker] summary").click();
  assert.equal(await page.locator("[data-capture-field-picker] input[type=checkbox]").count(), 10, "Gantt should expose ten configurable row fields");
  await page.locator("[data-capture-field-picker]").getByRole("checkbox", { name: "FPDS action count" }).check();
  assert.match(await page.locator("[data-capture-timeline] .capture-timeline__fields").first().innerText(), /FPDS actions/, "Selected row fields should render immediately");
  assert.equal(await page.locator("[data-capture-field-picker] input[type=checkbox]:checked").count(), 4, "Gantt should cap visible row metadata at four fields");
  assert.ok(await page.locator("[data-capture-field-picker] input[type=checkbox]:not(:checked):disabled").count() >= 1, "Additional row fields should disable at the readability cap");
  await page.locator("[data-capture-field-picker] summary").click();
  await page.locator("[data-capture-timeline] .capture-timeline__row").first().hover();
  await page.waitForSelector("[data-capture-hovercard]");
  const hoverText = await page.locator("[data-capture-hovercard]").innerText();
  assert.match(hoverText, /Observed obligations/i);
  assert.match(hoverText, /Funding office/i);
  assert.match(hoverText, /Latest FPDS action/i);
  await page.getByLabel("Grouping").selectOption("funding-office");
  assert.ok(await page.locator("[data-capture-timeline] .capture-timeline__group").count() > 1, "Funding-office grouping should render factual group bands");
  const desktopTimelineScroll = await page.locator("[data-capture-timeline]").evaluate((node) => ({ clientHeight: node.clientHeight, scrollHeight: node.scrollHeight }));
  assert.ok(desktopTimelineScroll.scrollHeight > desktopTimelineScroll.clientHeight, "Long Gantts should use a bounded internal vertical scroller");
  await page.locator("[data-capture-timeline]").evaluate((node) => { node.scrollTop = node.scrollHeight; });
  const desktopLastRowReachable = await page.locator("[data-capture-timeline]").evaluate((node) => {
    const row = node.querySelector(".capture-timeline__row:last-of-type");
    if (!row) return false;
    const timelineRect = node.getBoundingClientRect();
    const rowRect = row.getBoundingClientRect();
    return rowRect.bottom <= timelineRect.bottom + 2 && rowRect.top >= timelineRect.top - 2;
  });
  assert.ok(desktopLastRowReachable, "The final Gantt row should remain reachable inside the bounded timeline");
  await page.locator("[data-capture-timeline]").evaluate((node) => { node.scrollTop = 0; });
  await page.getByLabel("Feed overlay").selectOption("fpds");
  await page.waitForFunction(() => document.querySelectorAll(".capture-timeline__action-marker").length > 0);
  assert.equal(transactionRequests, 1, "Enabling the FPDS overlay should load the exact action feed once");
  assert.ok(await page.locator(".capture-timeline__action-marker").count() > 0, "FPDS feed should render timeline action pulses");
  await page.locator("[data-capture-timeline] .capture-timeline__row").first().click();
  await page.waitForSelector("[data-capture-detail]");
  await page.waitForSelector("[data-capture-action-history]");
  assert.equal(transactionRequests, 1, "Opening an award should reuse the already-loaded FPDS history");
  assert.equal(await page.locator("[data-capture-action-chart]").count(), 1, "Selected award should expose cumulative obligations");
  assert.ok(await page.locator("[data-capture-action-table] tbody tr").count() >= 1, "Selected award should expose exact action rows");

  await page.goto(`${BASE_URL}#/budget-spend/transactions?capGroup=unsupported&capLabels=unsupported&capFields=unsupported&capFeed=unsupported`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("[data-transaction-analytics-page]");
  await page.waitForFunction(() => !window.location.hash.includes("unsupported"));
  assert.equal(await page.getByLabel("Grouping").inputValue(), "none", "Malformed grouping should canonicalize to the factual default");
  assert.equal(await page.getByLabel("Feed overlay").inputValue(), "schedule", "Malformed feed selection should canonicalize to the factual default");
  await page.locator("[data-capture-field-picker] summary").click();
  const checkedFields = page.locator("[data-capture-field-picker] input[type=checkbox]:checked");
  while (await checkedFields.count()) await checkedFields.first().uncheck();
  assert.equal(await page.locator("[data-capture-field-picker] summary").innerText(), "Row fields (0)", "Gantt should support a true title-only row display");
  assert.match(new URL(page.url()).hash, /capFields=none/, "Title-only field state should be shareable");
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector("[data-capture-timeline]");
  assert.equal(await page.locator("[data-capture-field-picker] summary").innerText(), "Row fields (0)", "Title-only field state should survive reload");
  await page.locator("[data-capture-timeline]").scrollIntoViewIfNeeded();
  await page.locator("[data-capture-timeline] .capture-timeline__row").first().hover();
  await page.waitForSelector("[data-capture-hovercard]");
  await page.screenshot({ path: `${OUT_DIR}/transactions-gantt-desktop.png` });

  await openSurface(page, "#/budget-spend/sources", "[data-analytics-sources-page]");
  assert.equal(await page.locator("[data-active-page-title]").innerText(), "Sources");
  assert.equal(await page.locator("[data-source-flow] .source-flow__step").count(), 5, "Sources should trace five published data layers");
  assert.equal(await page.locator(".join-policy-grid article").count(), 5, "Sources should disclose five join rules");
  assert.ok(await page.locator("[data-source-health-monitor] article").count() >= 1, "Sources should expose source health");
  assert.doesNotMatch(await page.locator("[data-analytics-sources-page]").innerText(), FORBIDDEN_SURFACE_TEXT);

  await page.goto(`${BASE_URL}#/budget-spend/strategy`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("[data-pdb-request-page]");
  assert.equal(new URL(page.url()).hash, "#/budget-spend", "Legacy strategy URLs should canonicalize to the request analytics surface");
  assert.equal(await page.locator("[data-strategy-page]").count(), 0, "Legacy strategy surface should not render");
  await assertFlowShell(page);
  await assertNoPageOverflow(page, "Desktop analytics shell");
  await page.screenshot({ path: `${OUT_DIR}/analytics-flow-desktop.png`, fullPage: true });

  const ultrawide = await browser.newPage({ viewport: { width: 3440, height: 1440 } });
  await ultrawide.goto(BASE_URL, { waitUntil: "domcontentloaded" });
  await ultrawide.waitForSelector("[data-defense-budget-app]");
  await openSurface(ultrawide, "#/budget-spend/transactions", "[data-transaction-analytics-page]");
  const ultrawideGeometry = await ultrawide.evaluate(() => {
    const contentNode = document.querySelector(".app__content");
    const content = contentNode?.getBoundingClientRect();
    const contentPadding = contentNode ? Number.parseFloat(getComputedStyle(contentNode).paddingLeft) : 0;
    const header = document.querySelector(".masthead__inner")?.getBoundingClientRect();
    const timeline = document.querySelector("[data-capture-timeline]")?.getBoundingClientRect();
    const controls = document.querySelector("[data-capture-gantt-tools]")?.getBoundingClientRect();
    const label = document.querySelector("[data-capture-timeline] .capture-timeline__label")?.getBoundingClientRect();
    return {
      viewportWidth: window.innerWidth,
      contentWidth: content?.width || 0,
      contentInnerLeft: (content?.left || 0) + contentPadding,
      headerWidth: header?.width || 0,
      headerLeft: header?.left || 0,
      timelineWidth: timeline?.width || 0,
      controlsWidth: controls?.width || 0,
      visibleTimePlane: (timeline?.width || 0) - (label?.width || 0),
    };
  });
  assert.ok(ultrawideGeometry.contentWidth >= ultrawideGeometry.viewportWidth * 0.98, `Ultrawide workspace should use the viewport, got ${ultrawideGeometry.contentWidth}px of ${ultrawideGeometry.viewportWidth}px`);
  assert.ok(ultrawideGeometry.headerWidth >= ultrawideGeometry.viewportWidth * 0.97, `Ultrawide header should use the viewport, got ${ultrawideGeometry.headerWidth}px`);
  assert.ok(Math.abs(ultrawideGeometry.contentInnerLeft - ultrawideGeometry.headerLeft) <= 2, `Header and workspace gutters should align: ${ultrawideGeometry.headerLeft}px vs ${ultrawideGeometry.contentInnerLeft}px`);
  assert.ok(ultrawideGeometry.timelineWidth >= 3300, `Ultrawide Gantt should expand beyond the old 1,580px cap, got ${ultrawideGeometry.timelineWidth}px`);
  assert.ok(ultrawideGeometry.controlsWidth >= 3300, `Ultrawide Gantt controls should expand with the timeline, got ${ultrawideGeometry.controlsWidth}px`);
  assert.ok(ultrawideGeometry.visibleTimePlane >= 2900, `Ultrawide Gantt should expose a broad time plane, got ${ultrawideGeometry.visibleTimePlane}px`);
  await assertNoPageOverflow(ultrawide, "Ultrawide transactions");
  await ultrawide.screenshot({ path: `${OUT_DIR}/transactions-gantt-ultrawide.png` });
  await ultrawide.close();

  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await mobile.goto(BASE_URL, { waitUntil: "domcontentloaded" });
  await mobile.waitForSelector("[data-pdb-request-page]");
  await assertFlowShell(mobile);
  const mobileNavHeights = await mobile.locator(".ci-header-nav > button[data-budget-nav]").evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().height));
  assert.ok(mobileNavHeights.every((height) => height >= 43.5), `Mobile surface controls should be 44px: ${mobileNavHeights.join(", ")}`);
  await assertNoPageOverflow(mobile, "Mobile request");

  await openSurface(mobile, "#/budget-spend/lifecycle", "[data-account-spine-page]");
  const accountHeight = await mobile.locator("#lifecycle-account").evaluate((node) => node.getBoundingClientRect().height);
  assert.ok(accountHeight >= 43.5, `Mobile account selector should be 44px, got ${accountHeight}`);
  await assertNoPageOverflow(mobile, "Mobile account flow");

  await openSurface(mobile, "#/budget-spend/transactions", "[data-transaction-analytics-page]");
  assert.equal(await mobile.locator("[data-capture-filters] .capture-filter--advanced:visible").count(), 0, "Advanced transaction filters should start collapsed on mobile");
  await mobile.getByRole("button", { name: "Show 12 more filters" }).click();
  assert.equal(await mobile.locator("[data-capture-filters] .capture-filter--advanced:visible").count(), 12, "All advanced filters should remain reachable");
  assert.equal(await mobile.locator("[data-targeting-chart]").count(), 0);
  assert.equal(await mobile.locator("[data-capture-workboard]").count(), 0);
  const mobileGanttControlHeights = await mobile.locator("[data-capture-gantt-tools] select, [data-capture-field-picker] summary").evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().height));
  assert.ok(mobileGanttControlHeights.every((height) => height >= 43.5), `Mobile Gantt controls should be 44px: ${mobileGanttControlHeights.join(", ")}`);
  const mobileScroller = await mobile.locator("[data-capture-timeline]").evaluate((node) => ({ clientWidth: node.clientWidth, scrollWidth: node.scrollWidth }));
  assert.ok(mobileScroller.scrollWidth > mobileScroller.clientWidth, "Wide transaction timeline should use an internal mobile scroller");
  const mobileTimelineGeometry = await mobile.locator("[data-capture-timeline]").evaluate((node) => {
    const label = node.querySelector(".capture-timeline__label");
    return {
      clientHeight: node.clientHeight,
      scrollHeight: node.scrollHeight,
      labelWidth: label?.getBoundingClientRect().width || 0,
      visibleTimePlane: node.clientWidth - (label?.getBoundingClientRect().width || 0),
    };
  });
  assert.ok(mobileTimelineGeometry.scrollHeight > mobileTimelineGeometry.clientHeight, "Mobile Gantt should bound long results inside its own vertical scroller");
  assert.ok(mobileTimelineGeometry.labelWidth <= 212, `Mobile sticky labels should preserve the time plane, got ${mobileTimelineGeometry.labelWidth}px`);
  assert.ok(mobileTimelineGeometry.visibleTimePlane >= 140, `Mobile should expose a useful time-plane viewport, got ${mobileTimelineGeometry.visibleTimePlane}px`);
  await mobile.locator("[data-capture-timeline]").evaluate((node) => { node.scrollTop = 0; });
  await mobile.locator("[data-capture-timeline] .capture-timeline__row").first().tap();
  assert.equal(await mobile.locator("[data-capture-hovercard]").count(), 0, "Touch selection should not leave a hover card covering the timeline");
  await assertNoPageOverflow(mobile, "Mobile transactions");
  await mobile.locator("[data-capture-timeline]").scrollIntoViewIfNeeded();
  await mobile.screenshot({ path: `${OUT_DIR}/transactions-gantt-mobile.png` });

  await openSurface(mobile, "#/budget-spend/sources", "[data-analytics-sources-page]");
  assert.equal(await mobile.locator("[data-source-flow] .source-flow__step").count(), 5);
  await assertNoPageOverflow(mobile, "Mobile sources");
  await mobile.screenshot({ path: `${OUT_DIR}/analytics-flow-mobile.png`, fullPage: true });

  console.log(`Verified ${REMOTE_BASE_URL ? "hosted" : "local"} analytics flow: surfaces=6 money_stages=5 request_records>3000 accounts>100 awards>600 opportunities=198 events=502 fpds_actions=3085 descriptive_charts=13`);
} finally {
  await browser.close();
  if (server) server.kill("SIGTERM");
}
