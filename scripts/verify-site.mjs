import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { chromium } from "playwright-core";

const REMOTE_BASE_URL = process.env.BUDGET_VERIFY_URL;
const BASE_URL = REMOTE_BASE_URL ? new URL(REMOTE_BASE_URL).href : "http://127.0.0.1:4188/";
const OUT_DIR = "test-results";
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
  await page.locator(`[data-budget-nav="${route}"]`).click();
  await page.waitForSelector(selector);
}

async function assertNoPageOverflow(page, label) {
  const overflow = await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - window.innerWidth);
  assert.ok(overflow <= 2, `${label} page overflow should be contained, got ${overflow}px`);
}

async function assertFlowShell(page) {
  assert.equal(await page.locator(".ci-header-nav > a[data-budget-nav]").count(), 7, "Header should expose five money stages plus analytics and sources as native links");
  assert.equal(await page.locator("[data-budget-nav-more]").count(), 0, "Header should not expose a secondary strategy menu");
  assert.equal(await page.locator("[data-peer-intelligence-nav]").count(), 0, "Analytics app should not expose peer-product surfaces inside the workspace");
  assert.equal(await page.locator("[data-money-flow-rail]").count(), 0, "Pages should not repeat the primary header navigation as a numbered phase rail");
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
  let subawardDetailRequests = 0;
  await page.route("**/data/capture-transactions.json", async (route) => {
    transactionRequests += 1;
    await new Promise((resolve) => setTimeout(resolve, 250));
    await route.continue();
  });
  await page.route("**/data/usaspending-subaward-details.json", async (route) => {
    subawardDetailRequests += 1;
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
  assert.ok(await page.locator("[data-pdb-request-page]").evaluate((node) => node.getBoundingClientRect().height) <= 72, "Request intro should remain compact");
  assert.doesNotMatch(await page.locator("[data-pdb-request-page]").innerText(), /Stage\s+1/i, "Request intro should not repeat numbered phase navigation");
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
  assert.ok(await page.locator("[data-request-history-page]").evaluate((node) => node.getBoundingClientRect().height) <= 72, "Request-history intro should remain compact");
  assert.doesNotMatch(await page.locator("[data-request-history-page]").innerText(), /Stage\s+2/i, "Request history should not repeat numbered phase navigation");
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
  assert.ok(await page.locator("[data-account-spine-page] .phase-intro").evaluate((node) => node.getBoundingClientRect().height) <= 72, "Account-flow intro should remain compact");
  assert.doesNotMatch(await page.locator("[data-account-spine-page] .phase-intro").innerText(), /Stage\s+3/i, "Account flow should not repeat numbered phase navigation");
  const lifecycleText = await page.locator("[data-account-spine-page]").innerText();
  assert.match(lifecycleText, /derived/i, "Derived request joins should be labeled");
  assert.match(lifecycleText, /exact TAFS joins/i, "Exact TAFS joins should be labeled");

  await openSurface(page, "#/budget-spend/awards", "[data-awards-page]");
  assert.equal(await page.locator("[data-active-page-title]").innerText(), "Awards");
  assert.equal(await resourceCount(page, "budget-execution.json"), 1, "Awards should load the factual execution payload once");
  assert.equal(await page.locator("[data-award-filter-bar] select").count(), 5, "Awards should expose factual filter dimensions");
  assert.ok(await page.locator("[data-award-record-table] tbody tr").count() >= 100, "Awards should expose the sampled award table");
  assert.ok(await page.locator("[data-awards-page] .phase-intro").evaluate((node) => node.getBoundingClientRect().height) <= 72, "Awards intro should remain compact");
  assert.doesNotMatch(await page.locator("[data-awards-page] .phase-intro").innerText(), /Stage\s+4/i, "Awards should not repeat numbered phase navigation");
  assert.doesNotMatch(await page.locator("[data-awards-page]").innerText(), /Pursuit score|recommended action|Target execution brief|Target workboard/i);
  const awardSearchGeometry = await page.getByPlaceholder("Search award IDs, vendors, buyers, descriptions").evaluate((input) => {
    const icon = input.parentElement?.querySelector("svg")?.getBoundingClientRect();
    const bounds = input.getBoundingClientRect();
    return { iconRight: icon?.right || 0, textStart: bounds.left + Number.parseFloat(getComputedStyle(input).paddingLeft) };
  });
  assert.ok(awardSearchGeometry.iconRight + 5 <= awardSearchGeometry.textStart, `Award search icon must not overlap its text lane: ${JSON.stringify(awardSearchGeometry)}`);

  await openSurface(page, "#/budget-spend/transactions", "[data-transaction-analytics-page]");
  assert.equal(await page.locator("[data-active-page-title]").innerText(), "Transactions");
  assert.equal(await resourceCount(page, "capture-calendar.json"), 1, "Transactions should load the public event payload once");
  assert.equal(await resourceCount(page, "usaspending-subawards.json"), 1, "Transactions should load the compact subaward summary once");
  assert.equal(subawardDetailRequests, 0, "Recent subaward detail should remain deferred until its overlay or a positive prime opens");
  assert.equal(transactionRequests, 0, "Exact FPDS actions should remain deferred until a record opens");
  const transactionText = await page.locator("[data-transaction-analytics-page]").innerText();
  const publicRecordCount = Number(transactionText.match(/([\d,]+) public records/i)?.[1].replaceAll(",", "") || 0);
  const automaticAdditionCount = Number(transactionText.match(/198 normalized source rows · ([\d,]+) automatic feed additions/i)?.[1].replaceAll(",", "") || 0);
  assert.ok(publicRecordCount >= 875, `Transactions should expose the current expanded baseline or more, got ${publicRecordCount}`);
  assert.ok(automaticAdditionCount >= 677, `Transactions should retain the automated USAspending baseline and permit new feeds, got ${automaticAdditionCount}`);
  assert.match(transactionText, /FPDS ACTIONS\s+3,085/i);
  const capturePayload = await page.evaluate(() => fetch(new URL("data/capture-calendar.json", document.baseURI)).then((response) => response.json()));
  const subawardPayload = await page.evaluate(() => fetch(new URL("data/usaspending-subawards.json", document.baseURI)).then((response) => response.json()));
  assert.equal(capturePayload.metadata.coverage.normalizedEvents, 502, "Source packet should retain every canonical event");
  assert.equal(capturePayload.metadata.coverage.fpdsActions, 3085, "Source packet should retain every exact FPDS action");
  assert.equal(capturePayload.metadata.coverage.awardsWithPricingType, 113, "Acquisition structure should include pricing on 112 awards plus the active Application Arsenal solicitation");
  assert.equal(capturePayload.metadata.coverage.awardsWithAwardType, 11, "Acquisition structure should retain every published award instrument type");
  assert.equal(capturePayload.metadata.coverage.rowsWithVehicle, 60, "Vehicle overlay should retain all published vehicle labels");
  assert.equal(capturePayload.metadata.coverage.rowsWithCompetition, 119, "Competition overlay should retain competition, set-aside, and eligibility classifications");
  assert.equal(capturePayload.metadata.coverage.rowsWithWorkCategory, 145, "Normalized source rows should retain deterministic work classifications");
  assert.equal(capturePayload.metadata.coverage.workCategories, 15, "Work taxonomy should expose fifteen factual categories including the explicit unclassified state");
  assert.equal(capturePayload.metadata.coverage.rowsWithIngestionProvenance, 198, "Every normalized source row should disclose ingestion provenance");
  assert.ok(subawardPayload.metadata.checkedPrimeCount >= 689, "Subaward summary should cover the indexed prime-award universe");
  assert.ok(["current", "partial"].includes(subawardPayload.metadata.status), `Subaward summary should disclose current or partial status, got ${subawardPayload.metadata.status}`);
  assert.ok(subawardPayload.metadata.reportedSubawardCount > 0, "Subaward summary should retain exact reported counts");
  assert.ok(subawardPayload.metadata.retainedDetailCount > 0, "Subaward summary should disclose the bounded retained detail count");
  assert.ok(subawardPayload.primes.every((prime) => !("subawards" in prime)), "The initial Transactions payload must not embed the multi-megabyte subaward detail list");
  const samPayload = await page.evaluate(() => fetch(new URL("data/sam-opportunities.json", document.baseURI)).then((response) => response.json()));
  assert.ok(["current", "unavailable"].includes(samPayload.metadata.status), `SAM feed should disclose current or unavailable status, got ${samPayload.metadata.status}`);
  assert.doesNotMatch(transactionText, FORBIDDEN_SURFACE_TEXT);
  assert.equal(await page.locator("[data-targeting-chart]").count(), 0, "Targeting charts should be removed");
  assert.equal(await page.locator("[data-capture-workboard]").count(), 0, "Analyst workboard should be removed");
  assert.equal(await page.locator("[data-capture-chart]").count(), 13, "Transactions should retain thirteen descriptive charts");
  assert.equal(await page.locator("[data-capture-matrix]").count(), 1, "Transactions should retain its descriptive lifecycle matrix");
  assert.equal(await page.locator("[data-capture-filters] .capture-filter").count(), 20, "Transactions should expose twenty factual filters");
  assert.equal(await page.locator("[data-capture-filters] .capture-filter--advanced:visible").count(), 0, "Advanced filters should start collapsed to reduce vertical noise");
  const compactDesktopGeometry = await page.evaluate(() => ({
    freshnessHeight: document.querySelector("[data-freshness-strip]")?.getBoundingClientRect().height || 0,
    firstRowTop: document.querySelector("[data-capture-timeline] .capture-timeline__row")?.getBoundingClientRect().top || 0,
    timelineToolsHeight: document.querySelector("[data-capture-gantt-tools]")?.getBoundingClientRect().height || 0,
  }));
  assert.ok(compactDesktopGeometry.freshnessHeight <= 32, `Desktop freshness should be a compact status line, got ${compactDesktopGeometry.freshnessHeight}px`);
  assert.ok(compactDesktopGeometry.timelineToolsHeight <= 40, `Timeline controls should start collapsed, got ${compactDesktopGeometry.timelineToolsHeight}px`);
  assert.ok(compactDesktopGeometry.firstRowTop <= 520, `The first desktop Gantt row should be visible without scrolling, got ${compactDesktopGeometry.firstRowTop}px`);
  await page.getByRole("button", { name: "Show 16 more filters" }).click();
  assert.equal(await page.locator("[data-capture-filters] .capture-filter--advanced:visible").count(), 16, "Advanced factual filters should remain reachable");
  const workFilterTrigger = page.getByRole("button", { name: /^Type of work\./ });
  await workFilterTrigger.click();
  await page.getByLabel("Search Type of work options").fill("Cloud infrastructure");
  await page.getByRole("option", { name: "Cloud infrastructure" }).getByRole("checkbox").check();
  await page.keyboard.press("Escape");
  const provenanceFilterTrigger = page.getByRole("button", { name: /^Ingestion provenance\./ });
  await provenanceFilterTrigger.click();
  await page.getByRole("option", { name: "Automated public feed" }).getByRole("checkbox").check();
  await page.keyboard.press("Escape");
  assert.match(await workFilterTrigger.getAttribute("aria-label"), /Type of work \(1\)/, "Work category should support searchable filtering");
  assert.match(await provenanceFilterTrigger.getAttribute("aria-label"), /Ingestion provenance \(1\)/, "Ingestion provenance should support searchable filtering");
  assert.match(decodeURIComponent(new URL(page.url()).hash), /capWork=.*cloud-infrastructure/, "Selected work category should be URL-backed");
  assert.match(decodeURIComponent(new URL(page.url()).hash), /capOrigin=.*automated/, "Selected ingestion provenance should be URL-backed");
  assert.ok(await page.locator("[data-capture-timeline] .capture-timeline__row").count() > 0, "Combined work and provenance filters should retain matching public records");
  await page.getByRole("button", { name: "Reset" }).click();
  await page.getByLabel("Subaward activity").selectOption("has");
  assert.match(decodeURIComponent(new URL(page.url()).hash), /capSubaward=has/, "Subaward posture should be URL-backed");
  assert.ok(await page.locator("[data-capture-timeline] .capture-timeline__row").count() > 0, "Subaward posture should retain exactly joined prime awards");
  await page.getByRole("button", { name: "Reset" }).click();
  await page.getByRole("button", { name: "Show core filters" }).click();
  const portfolioTrigger = page.getByRole("button", { name: /^Portfolio\./ });
  await portfolioTrigger.click();
  await page.getByLabel("Search Portfolio options").fill("Navy Mission");
  await page.getByRole("option", { name: "Navy Mission Engineering" }).getByRole("checkbox").check();
  await page.getByLabel("Search Portfolio options").fill("DAF Mission");
  await page.getByRole("option", { name: "DAF Mission Software" }).getByRole("checkbox").check();
  assert.match(await portfolioTrigger.getAttribute("aria-label"), /Portfolio \(2\)/, "Portfolio filter should support searchable multi-selection");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Reset" }).click();
  assert.equal(await page.locator("[data-capture-timeline] .capture-timeline__row").count(), 50, "Transactions should render the default fifty timeline rows");
  const barBox = await page.locator("[data-capture-timeline] .capture-timeline__bar--base").first().boundingBox();
  assert.ok(barBox && barBox.height >= 20 && barBox.height <= 24, `Timeline bars should stay precisely formatted, got ${barBox?.height}px`);
  assert.ok(await page.locator("[data-capture-timeline] .capture-timeline__years small i").count() >= 20, "Timeline should expose quarter guides");
  assert.equal(await page.locator("[data-capture-timeline] .capture-timeline__today").first().count(), 1, "Timeline should expose the source as-of marker");
  await page.locator("[data-capture-gantt-tools] > summary").click();
  assert.equal(await page.getByLabel("Grouping").locator("option").count(), 14, "Gantt should expose fourteen factual grouping modes");
  assert.equal(await page.getByLabel("Bar labels").locator("option").count(), 6, "Gantt should expose six bar-label modes");
  assert.equal(await page.locator("[data-capture-gantt-tools] .capture-gantt-toolgroup").count(), 3, "Gantt controls should be organized into time, display, and data groups");
  await page.locator("[data-capture-field-picker] summary").click();
  assert.equal(await page.locator("[data-capture-field-picker] input[type=checkbox]").count(), 15, "Gantt should expose fifteen configurable row fields");
  await page.locator("[data-capture-field-picker]").getByRole("checkbox", { name: "FPDS action count" }).check();
  assert.match(await page.locator("[data-capture-timeline] .capture-timeline__fields").first().innerText(), /FPDS actions/, "Selected row fields should render immediately");
  assert.equal(await page.locator("[data-capture-field-picker] input[type=checkbox]:checked").count(), 4, "Gantt should cap visible row metadata at four fields");
  assert.ok(await page.locator("[data-capture-field-picker] input[type=checkbox]:not(:checked):disabled").count() >= 1, "Additional row fields should disable at the readability cap");
  await page.locator("[data-capture-field-picker] summary").click();
  await page.locator("[data-capture-timeline] .capture-timeline__label").first().hover();
  assert.equal(await page.locator("[data-capture-hovercard]").count(), 0, "Hovering row labels must not open a timeline card");
  const emptyPlotBox = await page.locator("[data-capture-timeline] .capture-timeline__plot").first().boundingBox();
  assert.ok(emptyPlotBox, "Timeline plot should have measurable geometry");
  await page.mouse.move(emptyPlotBox.x + 4, emptyPlotBox.y + 4);
  assert.equal(await page.locator("[data-capture-hovercard]").count(), 0, "Blank timeline space must not open a hover card");
  const firstTimelineBar = page.locator("[data-capture-timeline] .capture-timeline__bar--base").first();
  await firstTimelineBar.hover();
  await page.waitForSelector("[data-capture-hovercard]");
  const hoverText = await page.locator("[data-capture-hovercard]").innerText();
  assert.match(hoverText, /Observed obligations/i);
  assert.match(hoverText, /Funding office/i);
  assert.match(hoverText, /Latest FPDS action/i);
  await firstTimelineBar.focus();
  assert.equal(await page.locator("[data-capture-hovercard]").count(), 1, "Keyboard focus on an actual Gantt bar should expose contextual evidence");
  await page.getByLabel("Grouping").selectOption("funding-office");
  assert.ok(await page.locator("[data-capture-timeline] .capture-timeline__group").count() > 1, "Funding-office grouping should render factual group bands");

  const classificationOverlayTrigger = page.getByRole("button", { name: /^Overlays\./ });
  await classificationOverlayTrigger.click();
  await page.getByRole("option", { name: "Type of work" }).getByRole("checkbox").check();
  await page.getByRole("option", { name: "Ingestion provenance" }).getByRole("checkbox").check();
  await page.keyboard.press("Escape");
  assert.equal(await page.locator("[data-work-category-overlay]").count(), 50, "Every visible row should expose a contextual work-category lane");
  assert.equal(await page.locator("[data-ingestion-provenance-overlay]").count(), 50, "Every visible row should expose a contextual ingestion-provenance lane");
  const workOverlay = page.locator("[data-work-category-overlay]").first();
  await workOverlay.hover();
  assert.match(await page.locator("[data-capture-hovercard]").innerText(), /Type of work/i, "Work overlay hover should disclose category context");
  const provenanceOverlay = page.locator("[data-ingestion-provenance-overlay]").first();
  await provenanceOverlay.hover();
  assert.match(await page.locator("[data-capture-hovercard]").innerText(), /Ingestion provenance/i, "Provenance overlay hover should disclose import context");
  await page.getByLabel("Grouping").selectOption("work-category");
  assert.ok(await page.locator("[data-capture-timeline] .capture-timeline__group").count() > 1, "Work-category grouping should render factual group bands");
  await page.screenshot({ path: `${OUT_DIR}/transactions-classification-overlays-desktop.png` });
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
  await page.getByPlaceholder("Program, company, reference, buyer").fill("Agile SSD");
  const overlayTrigger = page.getByRole("button", { name: /^Overlays\./ });
  await overlayTrigger.click();
  await page.getByRole("option", { name: "Published follow-on activity" }).getByRole("checkbox").check();
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => document.querySelectorAll("[data-followon-activity]").length > 0);
  assert.equal(transactionRequests, 0, "Follow-on relationships should not load the deferred FPDS action payload");
  await page.locator("[data-followon-activity]").first().hover();
  await page.waitForSelector("[data-capture-hovercard]");
  assert.match(await page.locator("[data-capture-hovercard]").innerText(), /predecessor PIID/i, "Follow-on overlay should disclose its predecessor join basis");
  assert.match(await page.locator("[data-capture-hovercard]").innerText(), /Agency acquisition forecast/i, "Follow-on overlay should disclose its source system");
  await page.locator("[data-followon-activity]").first().click();
  await page.waitForSelector("[data-followon-modal][open]");
  const followOnModalText = await page.locator("[data-followon-modal]").innerText();
  assert.match(followOnModalText, /Published follow-on activity/i);
  assert.match(followOnModalText, /predecessor PIID/i);
  assert.match(followOnModalText, /Agency acquisition forecast/i);
  assert.equal(await page.locator("[data-capture-detail]").count(), 0, "Follow-on selection should open its own modal rather than the record detail modal");
  await page.screenshot({ path: `${OUT_DIR}/transactions-followon-modal-desktop.png` });
  await page.getByRole("button", { name: "Close follow-on details" }).click();
  await page.waitForSelector("[data-followon-modal]", { state: "detached" });
  await page.getByPlaceholder("Program, company, reference, buyer").fill("Application Arsenal");
  await page.waitForFunction(() => document.querySelectorAll("[data-solicitation-window]").length === 1);
  const applicationSolicitation = page.locator("[data-solicitation-window]");
  assert.ok(await applicationSolicitation.evaluate((node) => node.classList.contains("is-active")), "Application Arsenal should expose its active solicitation window");
  await applicationSolicitation.hover();
  await page.waitForSelector("[data-capture-hovercard]");
  const solicitationHover = await page.locator("[data-capture-hovercard]").innerText();
  assert.match(solicitationHover, /Active solicitation window/i);
  assert.match(solicitationHover, /Aug 31, 2026 to Sep 30, 2026/i);
  await applicationSolicitation.click();
  await page.waitForSelector("[data-capture-detail-modal][open]");
  const applicationDetail = await page.locator("[data-capture-detail]").innerText();
  assert.match(applicationDetail, /Full and open competitive procurement/i);
  assert.match(applicationDetail, /SeaPort NxG contract holders only/i);
  assert.match(applicationDetail, /Cost Plus Fixed Fee \(CPFF\) Level of Effort/i);
  await page.getByRole("button", { name: "Close record details" }).click();
  await page.waitForSelector("[data-capture-detail-modal]", { state: "detached" });
  await overlayTrigger.click();
  await page.getByRole("option", { name: "Competition / set-aside" }).getByRole("checkbox").check();
  await page.getByRole("option", { name: "Contract vehicle" }).getByRole("checkbox").check();
  await page.getByRole("option", { name: "Award / pricing type" }).getByRole("checkbox").check();
  await page.getByRole("option", { name: "FPDS annual obligations" }).getByRole("checkbox").check();
  await page.keyboard.press("Escape");
  assert.ok(await page.locator("[data-competition-overlay]").count() >= 2, "Application Arsenal solicitation and incumbent should retain their distinct competition classifications");
  assert.ok(await page.locator("[data-vehicle-overlay]").count() >= 2, "Application Arsenal solicitation and incumbent should retain their distinct vehicles");
  assert.ok(await page.locator("[data-structure-overlay]").count() >= 2, "Application Arsenal solicitation and incumbent should retain their distinct pricing structures");
  const applicationIncumbentRow = page.locator("[data-capture-timeline-row]").filter({ hasText: "C028" });
  const fiscalAndStructureGeometry = await Promise.all([
    applicationIncumbentRow.locator(".capture-timeline__fiscal-marker").first().boundingBox(),
    page.locator("[data-structure-overlay]").first().boundingBox(),
  ]);
  if (fiscalAndStructureGeometry[0]) {
    assert.ok(fiscalAndStructureGeometry[1], "Pricing overlay should have measurable geometry");
    assert.ok(fiscalAndStructureGeometry[0].height > fiscalAndStructureGeometry[1].height * 4, `FY obligations should be a background intensity band rather than a competing structure lane: ${JSON.stringify(fiscalAndStructureGeometry)}`);
  }
  await page.getByRole("button", { name: /Competition and set-aside overlay: Full and open competitive procurement/i }).hover();
  await page.waitForSelector("[data-capture-hovercard]");
  assert.match(await page.locator("[data-capture-hovercard]").innerText(), /Full and open competitive procurement/i);
  assert.ok(await applicationIncumbentRow.locator("[data-followon-activity]").count() >= 1, "Application Arsenal incumbent should expose the published follow-on crosswalk");
  const applicationFollowOnWindow = applicationIncumbentRow.getByRole("button", { name: /Active solicitation window/i });
  const applicationDeadline = applicationIncumbentRow.getByRole("button", { name: /Proposals due/i });
  const followOnGeometry = await Promise.all([applicationFollowOnWindow.boundingBox(), applicationDeadline.boundingBox()]);
  assert.ok(followOnGeometry[0] && followOnGeometry[1] && followOnGeometry[0].y + followOnGeometry[0].height <= followOnGeometry[1].y, `Follow-on window and deadline must occupy independently clickable lanes: ${JSON.stringify(followOnGeometry)}`);
  await applicationFollowOnWindow.click();
  await page.waitForSelector("[data-followon-modal][open]");
  const applicationFollowOn = await page.locator("[data-followon-modal]").innerText();
  assert.match(applicationFollowOn, /Application Arsenal enterprise engineering/i);
  assert.match(applicationFollowOn, /Curated named-program predecessor crosswalk/i);
  assert.match(applicationFollowOn, /SAM\.gov/i);
  await page.getByRole("button", { name: "Close follow-on details" }).click();
  await page.waitForSelector("[data-followon-modal]", { state: "detached" });
  await page.getByPlaceholder("Program, company, reference, buyer").fill("");
  await page.waitForFunction(() => new Set([...document.querySelectorAll("[data-pricing-kind]")].map((node) => node.dataset.pricingKind)).size >= 2);
  const visiblePricingKinds = await page.locator("[data-pricing-kind]").evaluateAll((nodes) => [...new Set(nodes.map((node) => node.dataset.pricingKind))]);
  assert.ok(visiblePricingKinds.includes("pricing-fixed-price"), `Pricing overlay should distinguish fixed-price rows: ${visiblePricingKinds}`);
  assert.ok(visiblePricingKinds.includes("pricing-cost-reimbursable"), `Pricing overlay should distinguish cost-type rows: ${visiblePricingKinds}`);
  await page.getByPlaceholder("Program, company, reference, buyer").fill("Kessel Run Falconer");
  await page.waitForFunction(() => [...document.querySelectorAll("[data-pricing-kind]")].some((node) => node.dataset.pricingKind === "pricing-time-materials"));
  assert.equal(await page.locator('[data-pricing-kind="pricing-time-materials"]').count(), 1, "Pricing overlay should distinguish a known T&M row");
  await page.getByPlaceholder("Program, company, reference, buyer").fill("");
  await page.getByPlaceholder("Program, company, reference, buyer").fill("N0002417C2100");
  await overlayTrigger.click();
  await page.getByRole("option", { name: "USAspending subaward actions" }).getByRole("checkbox").check();
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => document.querySelectorAll("[data-subaward-overlay]").length > 0);
  assert.equal(subawardDetailRequests, 1, "Enabling the subaward overlay should lazily load recent detail once");
  const subawardMarker = page.locator("[data-subaward-overlay]").first();
  await subawardMarker.focus();
  await page.waitForSelector("[data-capture-hovercard]");
  assert.match(await page.locator("[data-capture-hovercard]").innerText(), /Subaward actions/i, "Subaward markers should expose keyboard-focus evidence");
  await subawardMarker.click();
  await page.waitForSelector("[data-capture-detail-modal][open]");
  await page.waitForSelector("[data-capture-subawards]");
  const subawardDetailText = await page.locator("[data-capture-subawards]").innerText();
  assert.match(subawardDetailText, /exact USAspending generated prime-award ID/i, "Subaward detail should disclose its exact join basis");
  assert.match(subawardDetailText, /retained/i, "Subaward detail should distinguish the bounded detail sample");
  await page.getByRole("button", { name: "Close record details" }).click();
  await page.waitForSelector("[data-capture-detail-modal]", { state: "detached" });
  await page.getByPlaceholder("Program, company, reference, buyer").fill("");
  await overlayTrigger.click();
  await page.getByRole("option", { name: "FPDS action pulses" }).getByRole("checkbox").check();
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => document.querySelectorAll(".capture-timeline__action-marker").length > 0);
  assert.equal(transactionRequests, 1, "Enabling the FPDS overlay should load the exact action feed once");
  assert.ok(await page.locator(".capture-timeline__action-marker").count() > 0, "FPDS feed should render timeline action pulses");
  await page.getByPlaceholder("Program, company, reference, buyer").fill("Application Arsenal");
  const applicationActionRow = page.locator("[data-capture-timeline-row]").filter({ hasText: "C028" });
  await applicationActionRow.waitFor();
  const pageHeightBeforeModal = await page.evaluate(() => document.documentElement.scrollHeight);
  await applicationActionRow.click();
  await page.waitForSelector("[data-capture-detail-modal][open]");
  await page.waitForSelector("[data-capture-detail]");
  await page.waitForSelector("[data-capture-action-history]");
  assert.equal(await page.evaluate(() => document.documentElement.scrollHeight), pageHeightBeforeModal, "Opening record detail must not reflow or lengthen the page");
  assert.equal(transactionRequests, 1, "Opening an award should reuse the already-loaded FPDS history");
  assert.equal(await page.locator("[data-capture-action-chart]").count(), 1, "Selected award should expose cumulative obligations");
  assert.ok(await page.locator("[data-capture-action-table] tbody tr").count() >= 1, "Selected award should expose exact action rows");
  await page.screenshot({ path: `${OUT_DIR}/transactions-detail-modal-desktop.png` });
  await page.keyboard.press("Escape");
  await page.waitForSelector("[data-capture-detail-modal]", { state: "detached" });
  assert.ok(!new URL(page.url()).hash.includes("capRecord="), "Closing the detail modal should remove the selected record from the shareable URL");

  await page.goto(`${BASE_URL}#/budget-spend/transactions?capGroup=unsupported&capLabels=unsupported&capFields=unsupported&capFeed=unsupported`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("[data-transaction-analytics-page]");
  await page.waitForFunction(() => !window.location.hash.includes("unsupported"));
  await page.locator("[data-capture-gantt-tools]").evaluate((node) => { node.open = true; });
  await page.getByRole("button", { name: /^Overlays\./ }).waitFor();
  assert.equal(await page.getByLabel("Grouping").inputValue(), "none", "Malformed grouping should canonicalize to the factual default");
  assert.match(await page.getByRole("button", { name: /^Overlays\./ }).getAttribute("aria-label"), /Schedule only/, "Malformed overlay selection should canonicalize to the factual default");
  await page.locator("[data-capture-field-picker] summary").click();
  const checkedFields = page.locator("[data-capture-field-picker] input[type=checkbox]:checked");
  while (await checkedFields.count()) await checkedFields.first().uncheck();
  assert.equal(await page.locator("[data-capture-field-picker] summary").innerText(), "Row fields (0)", "Gantt should support a true title-only row display");
  assert.match(new URL(page.url()).hash, /capFields=none/, "Title-only field state should be shareable");
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector("[data-capture-timeline]");
  assert.equal((await page.locator("[data-capture-field-picker] summary").textContent())?.trim(), "Row fields (0)", "Title-only field state should survive reload");
  await page.locator("[data-capture-timeline]").scrollIntoViewIfNeeded();
  await page.locator("[data-capture-timeline] .capture-timeline__bar--base").first().hover();
  await page.waitForSelector("[data-capture-hovercard]");
  await page.screenshot({ path: `${OUT_DIR}/transactions-gantt-desktop.png` });

  await openSurface(page, "#/budget-spend/analytics", "[data-transaction-d3-page]");
  assert.equal(await page.locator("[data-active-page-title]").innerText(), "Analytics");
  assert.equal(await page.locator('[data-d3-analytics="dimension-explorer"]').count(), 1, "Overview should start with the shared dimensional ranking");
  assert.equal(await page.locator("[data-d3-analytics]").count(), 6, "Overview should expose six focused factual D3 views");
  assert.equal(await page.locator("[data-d3-analytics] .transaction-viz__scroller > svg").count(), 6, "Every visible Overview view should render its analytical SVG");
  assert.equal(await page.locator('[data-d3-analytics="value-distribution"]').count(), 1, "Overview should include a logarithmic reported-value distribution");
  await page.locator('[data-d3-analytics="dimension-explorer"] [role="button"]').first().hover();
  await page.waitForSelector("[data-analytics-hovercard]");
  assert.match(await page.locator("[data-analytics-hovercard]").innerText(), /records/i, "D3 marks should expose immediate contextual hover detail");
  await page.locator('[data-d3-analytics="dimension-explorer"] header').hover();
  await page.waitForSelector("[data-analytics-hovercard]", { state: "detached" });
  await page.locator('[data-d3-analytics="dimension-explorer"] [role="button"]').first().focus();
  await page.waitForSelector("[data-analytics-hovercard]");
  assert.match(await page.locator("[data-analytics-hovercard]").innerText(), /records/i, "Keyboard focus should expose the same contextual chart detail as pointer hover");
  await page.locator(".analytics-search input").focus();
  await page.waitForSelector("[data-analytics-hovercard]", { state: "detached" });
  await page.locator("[data-analytics-manager] summary").click();
  assert.equal(await page.locator("[data-analytics-manager] .capture-multiselect__trigger").count(), 9, "Analytics should expose eight searchable data facets and one chart manager");
  await page.getByRole("button", { name: /^Type of work\./ }).click();
  await page.getByLabel("Search Type of work options").fill("software");
  await page.locator('.capture-multiselect__options [role="option"]').first().click();
  await page.keyboard.press("Escape");
  assert.match(await page.locator(".analytics-active-filters").innerText(), /Type of work: 1/, "Searchable multi-select facets should filter the analytical universe");
  await page.locator(".analytics-active-filters button").filter({ hasText: "Type of work" }).click();
  await page.getByRole("button", { name: /^Visible charts\./ }).click();
  await page.locator('.capture-multiselect__options [role="option"]').filter({ hasText: "Reported value distribution" }).click();
  await page.keyboard.press("Escape");
  assert.equal(await page.locator('[data-d3-analytics="value-distribution"]').count(), 0, "Chart management should remove an optional graph without changing the data filters");
  assert.equal(await page.locator("[data-d3-analytics]").count(), 5, "Hiding one Overview graph should leave five visible views");
  await page.getByRole("button", { name: /^Visible charts\./ }).click();
  await page.locator('.capture-multiselect__options [role="option"]').filter({ hasText: "Reported value distribution" }).click();
  await page.keyboard.press("Escape");
  const overviewScopeBefore = Number((await page.locator('[data-analytics-records] > header > span').innerText()).replace(/\D/g, ""));
  await page.locator('[data-d3-analytics="value-distribution"] [role="button"]').filter({ hasText: "Under $1M" }).click();
  assert.match(await page.locator('.analytics-active-filters').innerText(), /Under \$1M/, "Value bands should filter every analytical view");
  assert.ok(Number((await page.locator('[data-analytics-records] > header > span').innerText()).replace(/\D/g, "")) < overviewScopeBefore, "Value-band filtering should reduce the record scope");
  await page.locator('.analytics-active-filters button').click();
  await page.locator('[data-d3-analytics="dimension-explorer"] [role="button"]').first().click();
  assert.equal(await page.locator('.analytics-active-filters button').count(), 1, "A dimension bar should cross-filter the analytical workspace");
  const overviewScopeAfter = Number((await page.locator('[data-analytics-records] > header > span').innerText()).replace(/\D/g, ""));
  assert.ok(overviewScopeAfter < overviewScopeBefore, "Chart-driven filtering should reduce the record scope");
  await page.locator('.analytics-active-filters button').click();
  await page.getByRole("button", { name: "Schedule" }).click();
  assert.equal(await page.locator("[data-d3-analytics]").count(), 5, "Schedule should expose five focused temporal views");
  assert.equal(await page.locator('[data-d3-analytics="schedule-horizon"]').count(), 1, "Schedule should include the reported endpoint distribution");
  assert.equal(await page.locator('[data-d3-analytics="endpoint-seasonality"]').count(), 1, "Schedule should include calendar-month endpoint seasonality");
  assert.equal(await page.locator('[data-d3-analytics="duration-distribution"]').count(), 1, "Schedule should include reported term-duration bands");
  await page.locator('[data-d3-analytics="endpoint-seasonality"] [role="button"]').first().click();
  assert.match(await page.locator('.analytics-active-filters').innerText(), /Endpoint month: Jan/, "Month selection should filter the full analytical workspace");
  await page.locator('.analytics-active-filters button').click();
  const scheduleYear = page.locator('[data-d3-analytics="schedule-horizon"] [role="button"]').filter({ hasText: "2026" }).first();
  await scheduleYear.click();
  assert.match(await page.locator('.analytics-active-filters').innerText(), /Reported endpoint: 2026/, "Schedule-year selection should cross-filter every analytical view");
  await page.locator('.analytics-active-filters button').click();
  await page.getByRole("button", { name: "Spend & structure" }).click();
  assert.equal(await page.locator("[data-d3-analytics]").count(), 6, "Spend should expose six focused value and structure views");
  assert.equal(await page.locator('[data-d3-analytics="acquisition-matrix"]').count(), 1, "Spend should cross published pricing and competition classifications");
  assert.equal(await page.locator('[data-d3-analytics="subawards"]').count(), 1, "Spend should disclose exactly joined prime-to-subaward concentration");
  assert.equal(await page.locator('[data-d3-analytics="fiscal-trend"]').count(), 1, "Spend should expose annual obligation history by the selected dimension");
  assert.equal(await page.locator('[data-d3-analytics="vehicle-pricing"]').count(), 1, "Spend should expose vehicle and pricing composition separately");
  await page.locator('[data-d3-analytics="vehicle-pricing"] [role="button"]').first().click();
  assert.match(await page.locator('.analytics-active-filters').innerText(), /Contract vehicle:/, "Vehicle marks should drive the shared contract-vehicle filter");
  await page.locator('.analytics-active-filters button').click();
  await page.locator('.analytics-commandbar select').nth(1).selectOption('pricing');
  await page.locator('.analytics-commandbar select').nth(2).selectOption('records');
  assert.match(await page.locator('[data-d3-analytics="dimension-explorer"] header').innerText(), /Pricing type by records/i, "Dimension and measure controls should reconfigure the shared ranking");
  await page.locator('.analytics-search input').fill('Application Arsenal');
  assert.ok(Number((await page.locator('[data-analytics-records] > header > span').innerText()).replace(/\D/g, "")) < overviewScopeBefore, "Search should cross-filter the record explorer and charts");
  assert.match(await page.locator('.analytics-export').innerText(), /Export/, "Filtered analytical slices should be exportable");
  await page.locator('.analytics-reset').click();
  await page.getByRole("button", { name: "Coverage & lineage" }).click();
  assert.equal(await page.locator("[data-d3-analytics]").count(), 5, "Coverage should expose five focused provenance and quality views");
  assert.equal(await page.locator('[data-d3-analytics="provenance"]').count(), 1, "Coverage should include ingestion provenance");
  assert.equal(await page.locator('[data-d3-analytics="changes"]').count(), 1, "Coverage should include refresh changes");
  assert.equal(await page.locator('[data-d3-analytics="field-coverage"]').count(), 1, "Coverage should disclose field coverage");
  assert.equal(await page.locator('[data-d3-analytics="money-lineage"]').count(), 1, "Coverage should disclose money lineage and unresolved join gaps");
  assert.equal(await page.locator('[data-d3-analytics="source-coverage"]').count(), 1, "Coverage should expose source-system field completeness");
  await page.locator('[data-d3-analytics="source-coverage"] [role="button"]').first().click();
  assert.match(await page.locator('.analytics-active-filters').innerText(), /Source system:/, "Coverage cells should filter the record universe by source system");
  await page.locator('.analytics-active-filters button').click();
  await page.locator('[data-analytics-records] tbody button').first().click();
  await page.waitForSelector('.analytics-modal [role="dialog"]');
  assert.match(await page.locator('.analytics-modal [role="dialog"]').innerText(), /Observed obligations|Reported potential/i);
  assert.match(await page.locator('.analytics-modal [role="dialog"] a').first().getAttribute('href'), /capRecord=/, "Analytical detail should deep-link to the exact Transactions record");
  await page.keyboard.press("Escape");
  await page.waitForSelector('.analytics-modal', { state: "detached" });
  assert.doesNotMatch(await page.locator("[data-transaction-d3-page]").innerText(), FORBIDDEN_SURFACE_TEXT);
  assert.match(await page.locator("[data-transaction-d3-page]").innerText(), /not the complete federal contract universe/i, "Analytics should disclose its coverage boundary");
  await page.screenshot({ path: `${OUT_DIR}/transactions-d3-desktop.png`, fullPage: true });

  await openSurface(page, "#/budget-spend/sources", "[data-analytics-sources-page]");
  assert.equal(await page.locator("[data-active-page-title]").innerText(), "Sources");
  assert.equal(await page.locator("[data-source-flow] .source-flow__step").count(), 6, "Sources should trace six published data layers");
  assert.equal(await page.locator(".join-policy-grid article").count(), 6, "Sources should disclose six join rules");
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
  await openSurface(ultrawide, "#/budget-spend/analytics", "[data-transaction-d3-page]");
  const ultrawideAnalyticsGeometry = await ultrawide.evaluate(() => {
    const grid = document.querySelector(".transaction-viz-grid");
    const bounds = grid?.getBoundingClientRect();
    const columns = grid ? getComputedStyle(grid).gridTemplateColumns.split(" ").filter(Boolean) : [];
    const charts = [...document.querySelectorAll("[data-d3-analytics]")].map((node) => node.getBoundingClientRect().width);
    return { gridWidth: bounds?.width || 0, columns: columns.length, chartWidths: charts };
  });
  assert.equal(ultrawideAnalyticsGeometry.columns, 3, `Ultrawide Analytics should use three chart columns, got ${ultrawideAnalyticsGeometry.columns}`);
  assert.ok(ultrawideAnalyticsGeometry.gridWidth >= 3300, `Ultrawide Analytics should use the broad workspace, got ${ultrawideAnalyticsGeometry.gridWidth}px`);
  assert.ok(ultrawideAnalyticsGeometry.chartWidths.every((width) => width >= 1000), `Ultrawide Analytics charts should remain substantial: ${ultrawideAnalyticsGeometry.chartWidths.join(", ")}`);
  await assertNoPageOverflow(ultrawide, "Ultrawide D3 analytics");
  await ultrawide.screenshot({ path: `${OUT_DIR}/transactions-d3-ultrawide.png`, fullPage: true });
  await ultrawide.close();

  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await mobile.goto(BASE_URL, { waitUntil: "domcontentloaded" });
  await mobile.waitForSelector("[data-pdb-request-page]");
  await assertFlowShell(mobile);
  const mobileNavHeights = await mobile.locator(".ci-header-nav > a[data-budget-nav]").evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().height));
  assert.ok(mobileNavHeights.every((height) => height >= 43.5), `Mobile surface controls should be 44px: ${mobileNavHeights.join(", ")}`);
  assert.ok(await mobile.locator("[data-pdb-request-page]").evaluate((node) => node.getBoundingClientRect().height) <= 80, "Mobile request intro should stay compact");
  await assertNoPageOverflow(mobile, "Mobile request");

  await openSurface(mobile, "#/budget-spend/trends", "[data-request-history-page]");
  assert.ok(await mobile.locator("[data-request-history-page]").evaluate((node) => node.getBoundingClientRect().height) <= 80, "Mobile request-history intro should stay compact");
  await assertNoPageOverflow(mobile, "Mobile request history");

  await openSurface(mobile, "#/budget-spend/lifecycle", "[data-account-spine-page]");
  const accountHeight = await mobile.locator("#lifecycle-account").evaluate((node) => node.getBoundingClientRect().height);
  assert.ok(accountHeight >= 43.5, `Mobile account selector should be 44px, got ${accountHeight}`);
  assert.ok(await mobile.locator("[data-account-spine-page] .phase-intro").evaluate((node) => node.getBoundingClientRect().height) <= 120, "Mobile account-flow intro should stay compact");
  await assertNoPageOverflow(mobile, "Mobile account flow");

  await openSurface(mobile, "#/budget-spend/awards", "[data-awards-page]");
  assert.ok(await mobile.locator("[data-awards-page] .phase-intro").evaluate((node) => node.getBoundingClientRect().height) <= 120, "Mobile awards intro should stay compact");
  await assertNoPageOverflow(mobile, "Mobile awards");

  await openSurface(mobile, "#/budget-spend/transactions", "[data-transaction-analytics-page]");
  assert.equal(await mobile.locator("[data-capture-filters] .capture-filter--advanced:visible").count(), 0, "Advanced transaction filters should start collapsed on mobile");
  assert.equal(await mobile.locator("[data-capture-filters] .capture-filter--core-secondary:visible").count(), 0, "Secondary core filters should stay behind disclosure on narrow screens");
  const compactMobileGeometry = await mobile.evaluate(() => ({
    freshnessHeight: document.querySelector("[data-freshness-strip]")?.getBoundingClientRect().height || 0,
    firstRowTop: document.querySelector("[data-capture-timeline] .capture-timeline__row")?.getBoundingClientRect().top || 0,
    metricHeight: document.querySelector(".capture-metrics")?.getBoundingClientRect().height || 0,
  }));
  assert.ok(compactMobileGeometry.freshnessHeight <= 34, `Mobile freshness should remain one compact row, got ${compactMobileGeometry.freshnessHeight}px`);
  assert.ok(compactMobileGeometry.metricHeight <= 56, `Mobile metrics should use a compact horizontal strip, got ${compactMobileGeometry.metricHeight}px`);
  assert.ok(compactMobileGeometry.firstRowTop <= 760, `The first mobile Gantt row should be reachable within one viewport, got ${compactMobileGeometry.firstRowTop}px`);
  await mobile.getByRole("button", { name: "Show 16 more filters" }).click();
  assert.equal(await mobile.locator("[data-capture-filters] .capture-filter--advanced:visible").count(), 16, "All advanced filters should remain reachable");
  assert.equal(await mobile.locator("[data-capture-filters] .capture-filter--core-secondary:visible").count(), 3, "Expanded mobile filters should expose every core dimension");
  await mobile.getByRole("button", { name: "Show core filters" }).click();
  assert.equal(await mobile.locator("[data-targeting-chart]").count(), 0);
  assert.equal(await mobile.locator("[data-capture-workboard]").count(), 0);
  await mobile.locator("[data-capture-gantt-tools] > summary").click();
  const mobileGanttControlHeights = await mobile.locator("[data-capture-gantt-tools] select, [data-capture-field-picker] summary, [data-capture-gantt-tools] .capture-multiselect__trigger").evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().height));
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
  await mobile.waitForSelector("[data-capture-detail-modal][open]");
  const mobileModalGeometry = await mobile.locator("[data-capture-detail-modal]").evaluate((node) => {
    const rect = node.getBoundingClientRect();
    return { width: rect.width, height: rect.height, viewportWidth: window.innerWidth, viewportHeight: window.innerHeight };
  });
  assert.ok(mobileModalGeometry.width <= mobileModalGeometry.viewportWidth, `Mobile detail modal must fit the viewport width, got ${mobileModalGeometry.width}px`);
  assert.ok(mobileModalGeometry.height <= mobileModalGeometry.viewportHeight, `Mobile detail modal must fit the viewport height, got ${mobileModalGeometry.height}px`);
  await mobile.screenshot({ path: `${OUT_DIR}/transactions-detail-modal-mobile.png` });
  await mobile.getByRole("button", { name: "Close record details" }).click();
  await mobile.waitForSelector("[data-capture-detail-modal]", { state: "detached" });
  await assertNoPageOverflow(mobile, "Mobile transactions");
  await mobile.locator("[data-capture-timeline]").scrollIntoViewIfNeeded();
  await mobile.screenshot({ path: `${OUT_DIR}/transactions-gantt-mobile.png` });

  await openSurface(mobile, "#/budget-spend/analytics", "[data-transaction-d3-page]");
  assert.equal(await mobile.locator("[data-d3-analytics]").count(), 6);
  assert.ok(await mobile.locator('.analytics-commandbar button').first().evaluate((node) => node.getBoundingClientRect().height >= 44), "Mobile analytics controls should meet the 44px touch contract");
  await mobile.locator("[data-analytics-manager] summary").click();
  const mobileAnalyticsManagerHeights = await mobile.locator("[data-analytics-manager] .capture-multiselect__trigger").evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().height));
  assert.equal(mobileAnalyticsManagerHeights.length, 9, "Mobile should retain every data facet and the chart manager");
  assert.ok(mobileAnalyticsManagerHeights.every((height) => height >= 43.5), `Mobile analytics manager controls should be 44px: ${mobileAnalyticsManagerHeights.join(", ")}`);
  await assertNoPageOverflow(mobile, "Expanded mobile analytics manager");
  await mobile.locator("[data-analytics-manager] summary").click();
  assert.ok((await mobile.locator("[data-d3-analytics]").first().evaluate((node) => node.scrollWidth > node.clientWidth || node.querySelector(".transaction-viz__scroller")?.scrollWidth > node.querySelector(".transaction-viz__scroller")?.clientWidth)), "Mobile D3 charts should use contained horizontal scrolling");
  await assertNoPageOverflow(mobile, "Mobile D3 analytics");
  await mobile.screenshot({ path: `${OUT_DIR}/transactions-d3-mobile.png`, fullPage: true });

  await openSurface(mobile, "#/budget-spend/sources", "[data-analytics-sources-page]");
  assert.equal(await mobile.locator("[data-source-flow] .source-flow__step").count(), 6);
  await assertNoPageOverflow(mobile, "Mobile sources");
  await mobile.screenshot({ path: `${OUT_DIR}/analytics-flow-mobile.png`, fullPage: true });

  console.log(`Verified ${REMOTE_BASE_URL ? "hosted" : "local"} analytics flow: surfaces=7 money_stages=6 request_records>3000 accounts>100 awards>600 opportunities>=875 normalized_source_rows=198 automated_imports>=677 events>=502 fpds_actions=3085 d3_views=19 focused_workspaces=4 searchable_facets=8 chart_management=true contextual_hover=true subaward_counts=exact subaward_details=deferred_sample`);
} finally {
  await browser.close();
  if (server) server.kill("SIGTERM");
}
