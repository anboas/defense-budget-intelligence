import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { chromium } from "playwright-core";

const REMOTE_BASE_URL = process.env.BUDGET_VERIFY_URL;
const BASE_URL = REMOTE_BASE_URL ? new URL(REMOTE_BASE_URL).href : "http://127.0.0.1:4188/";
const OUT_DIR = "test-results";
const FORBIDDEN_SURFACE_TEXT = /Decision Briefs|Portfolio Strategy|Pursuit Cockpit|Target execution brief|Target workboard|attention score|win probability|Response Library|Capture Playbooks|Response Assets/i;
mkdirSync(OUT_DIR, { recursive: true });
const compiledScripts = readdirSync("dist/assets").filter((name) => name.endsWith(".js")).map((name) => readFileSync(`dist/assets/${name}`, "utf8")).join("\n");
const builtAssets = readdirSync("dist/assets");
const compiledStyleBytes = builtAssets.filter((name) => name.endsWith(".css")).reduce((total, name) => total + readFileSync(`dist/assets/${name}`).byteLength, 0);
assert.doesNotMatch(compiledScripts, /Response Library|Capture Playbooks|Response Assets/i, "Compiled application must not import response-development capabilities from reference sites");
assert.ok(compiledStyleBytes <= 350_000, `Scoped application CSS must stay below 350 KB, got ${compiledStyleBytes.toLocaleString()} bytes`);
assert.equal(builtAssets.some((name) => name.includes("adamboas-hero")), false, "Application builds must not ship the Control Surface example hero asset");

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
  let link = page.locator(`[data-budget-nav="${route}"]:visible`).first();
  if (!await link.count()) {
    if (await page.locator('[data-nav-group-trigger="analytics"]').isVisible()) {
      const group = route.startsWith("#/budget-spend/analytics") ? "analytics"
        : ["#/budget-spend", "#/budget-spend/trends", "#/budget-spend/lifecycle", "#/budget-spend/awards", "#/budget-spend/sources"].includes(route) ? "money"
          : "admin";
      await page.locator(`[data-nav-group-trigger="${group}"]`).click();
    } else {
      await page.locator("[data-mobile-more-menu-button]").click();
    }
    link = page.locator(`[data-budget-nav="${route}"]:visible`).first();
  }
  await link.click();
  await page.waitForSelector(selector);
}

async function assertNoPageOverflow(page, label) {
  const overflow = await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - window.innerWidth);
  assert.ok(overflow <= 2, `${label} page overflow should be contained, got ${overflow}px`);
}

async function assertActiveGroupState(page, group, childLabel) {
  const trigger = page.locator(`[data-nav-group-trigger="${group}"]`);
  await page.waitForFunction((groupId) => document.querySelector(`[data-nav-group-trigger="${groupId}"]`)?.getAttribute("aria-expanded") === "false", group);
  await page.mouse.move(0, 0);
  await page.waitForTimeout(160);
  assert.equal(await trigger.getAttribute("data-nav-group-active-child"), childLabel, `${group} should name its active child in the trigger contract`);
  assert.match(await trigger.getAttribute("class"), /has-active-child/, `${group} should use the established active-child state`);
  const context = trigger.locator(".ci-header-nav__menu-trigger-context");
  assert.equal(await context.innerText(), childLabel, `${group} should render the active child beside its group label`);
  const appearance = await trigger.evaluate((node) => {
    const triggerStyle = getComputedStyle(node);
    const contextNode = node.querySelector(".ci-header-nav__menu-trigger-context");
    const contextStyle = getComputedStyle(contextNode);
    return {
      background: triggerStyle.backgroundColor,
      shadow: triggerStyle.boxShadow,
      contextColor: contextStyle.color,
      contextBorder: contextStyle.borderLeft,
    };
  });
  assert.equal(appearance.background, "rgba(255, 255, 255, 0.08)", `${group} should use the established lighter active-group background`);
  assert.match(appearance.shadow, /rgba?\(139, 211, 255(?:, 0\.52)?\)/, `${group} should use the established light-blue active indicator`);
  assert.equal(appearance.contextColor, "rgb(183, 229, 255)", `${group} active child should use the established light-blue context label`);
  assert.equal(appearance.contextBorder, "1px solid rgba(255, 255, 255, 0.28)", `${group} active child should retain the internal divider`);
}

async function assertFlowShell(page) {
  assert.equal(await page.locator(".ci-header-nav > a[data-budget-nav]").count(), 2, "Header should expose only Transactions and Wallboard as primary links");
  assert.deepEqual(await page.locator(".ci-header-nav > a[data-budget-nav]").allTextContents(), ["Transactions", "Wallboard"], "Primary navigation should contain only the two working surfaces");
  assert.equal(await page.locator("[data-nav-group-trigger]").count(), 3, "Header should expose Analytics, Money flow, and Admin menus");
  assert.equal(await page.locator("[data-budget-nav-menu]").count(), 0, "Workspace menu should be closed by default");
  if (await page.locator('[data-nav-group-trigger="analytics"]').isVisible()) {
    const divider = page.locator(".ci-header-nav__desktop-groups > .if-operations-topnav__divider");
    assert.equal(await divider.count(), 1, "Desktop navigation should separate Admin from analytical and money-flow groups");
    assert.equal(await divider.innerText(), "|", "Admin separator should use the established vertical-bar component");
    const dividerOrder = await page.evaluate(() => {
      const money = document.querySelector('[data-nav-group-trigger="money"]')?.getBoundingClientRect();
      const separator = document.querySelector(".ci-header-nav__desktop-groups > .if-operations-topnav__divider")?.getBoundingClientRect();
      const admin = document.querySelector('[data-nav-group-trigger="admin"]')?.getBoundingClientRect();
      return { moneyRight: money?.right, separatorLeft: separator?.left, separatorRight: separator?.right, adminLeft: admin?.left };
    });
    assert.ok(dividerOrder.moneyRight <= dividerOrder.separatorLeft && dividerOrder.separatorRight <= dividerOrder.adminLeft, "Admin divider should sit between Money flow and Admin");
    await page.locator('[data-nav-group-trigger="analytics"]').click();
    assert.equal(await page.locator('[data-budget-nav-menu="analytics"] a[data-budget-nav]').count(), 4, "Analytics should expose all four analytical workspaces");
    assert.match(await page.locator('[data-budget-nav-menu="analytics"]').innerText(), /Overview[\s\S]*Schedule[\s\S]*Spend & structure[\s\S]*Coverage & lineage/i);
    await page.locator('[data-nav-group-trigger="analytics"]').click();
    await page.locator('[data-nav-group-trigger="money"]').click();
    assert.equal(await page.locator('[data-budget-nav-menu="money"] a[data-budget-nav]').count(), 5, "Money flow should contain every non-Transactions stage plus lineage");
    assert.match(await page.locator('[data-budget-nav-menu="money"]').innerText(), /PDB Request[\s\S]*Request History[\s\S]*Account Flow[\s\S]*Awards[\s\S]*Source Lineage/i);
    await page.locator('[data-nav-group-trigger="money"]').click();
    await page.locator('[data-nav-group-trigger="admin"]').click();
    assert.equal(await page.locator('[data-budget-nav-menu="admin"] a[data-budget-nav]').count(), 4, "Static Admin should expose browser-local management and audit surfaces");
    assert.match(await page.locator('[data-budget-nav-menu="admin"]').innerText(), /Watchlist[\s\S]*Events[\s\S]*Integrations[\s\S]*API Log/i);
    await page.locator('[data-nav-group-trigger="admin"]').click();
  } else {
    await page.locator("[data-mobile-more-menu-button]").click();
    assert.equal(await page.locator("[data-mobile-more-menu] a[data-budget-nav]").count(), 13, "Mobile More should contain analytics, money-flow, and management routes");
    assert.match(await page.locator("[data-mobile-more-menu]").innerText(), /Analytics[\s\S]*Money flow[\s\S]*Admin/i, "Mobile More should retain all three grouped menus");
    await page.locator("[data-mobile-more-menu-button]").click();
  }
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
  await page.waitForSelector("[data-transaction-analytics-page]");
  assert.equal(await resourceCount(page, "runtime-manifest.json"), 1, "Transactions should load the compact runtime manifest once");
  assert.equal(await resourceCount(page, "budget-core.json"), 0, "Transactions should defer the detailed budget request dataset");
  const initialDecodedDataBytes = await page.evaluate(() => performance.getEntriesByType("resource")
    .filter((entry) => entry.name.includes("/data/"))
    .reduce((total, entry) => total + (entry.decodedBodySize || 0), 0));
  assert.ok(initialDecodedDataBytes <= 2_000_000, `Transactions should stay below a 2 MB decoded initial data payload, got ${initialDecodedDataBytes.toLocaleString()} bytes`);
  assert.equal(await page.locator("[data-active-page-title]").innerText(), "Transactions");
  assert.match(await page.title(), /^Transactions · Defense Budget & Spend Analytics$/);
  assert.equal(await page.locator("h1").count(), 1, "Each route should expose one product H1");
  await assertFlowShell(page);
  const productMark = page.locator(".masthead__icon");
  assert.equal(await productMark.count(), 1, "Header should render the supplied Defense Budget Intelligence product mark");
  const productMarkGeometry = await productMark.evaluate((node) => ({ width: node.getBoundingClientRect().width, height: node.getBoundingClientRect().height, naturalWidth: node.naturalWidth, naturalHeight: node.naturalHeight }));
  assert.deepEqual([productMarkGeometry.naturalWidth, productMarkGeometry.naturalHeight], [192, 192], "Header should use the supplied 192px icon asset");
  assert.deepEqual([productMarkGeometry.width, productMarkGeometry.height], [30, 30], `Header product image should fill the 30px content box inside the established 32px bordered mark, got ${productMarkGeometry.width}×${productMarkGeometry.height}`);
  assert.match(await page.locator('link[rel="manifest"]').getAttribute("href"), /site\.webmanifest$/, "Document should advertise install metadata");
  assert.match(await page.locator('link[rel="icon"]').getAttribute("href"), /icon-192\.png$/, "Document favicon should use the supplied product mark");

  const frameworkHeaderContract = await page.evaluate(() => {
    const header = document.querySelector("[data-budget-spend-header]");
    const link = document.querySelector(".ci-header-nav > .if-operations-topnav__link");
    const active = document.querySelector(".ci-header-nav > .if-operations-topnav__link[aria-current='page']");
    const style = (node) => {
      const computed = getComputedStyle(node);
      const bounds = node.getBoundingClientRect();
      return {
        width: bounds.width,
        height: bounds.height,
        display: computed.display,
        background: computed.backgroundColor,
        border: computed.border,
        boxShadow: computed.boxShadow,
        fontFamily: computed.fontFamily,
        fontSize: computed.fontSize,
        fontWeight: computed.fontWeight,
        padding: computed.padding,
      };
    };
    return {
      header: style(header),
      inner: style(header.querySelector(".if-product-header__inner")),
      mark: style(header.querySelector(".if-brand__mark")),
      title: style(header.querySelector(".if-product-header__title")),
      link: style(link),
      active: style(active),
      linkIconCount: link.querySelectorAll("svg").length,
    };
  });
  assert.equal(frameworkHeaderContract.header.display, "flex", "Masthead should use the established Control Framework header component layout");
  assert.equal(frameworkHeaderContract.header.background, "rgb(22, 46, 81)", "Masthead should use the established intelligence-site header color");
  assert.ok(frameworkHeaderContract.header.height >= 49 && frameworkHeaderContract.header.height <= 52, `Desktop masthead should match the established compact height, got ${frameworkHeaderContract.header.height}px`);
  assert.equal(frameworkHeaderContract.inner.padding, "0px 16px", "Desktop masthead inner should match the established component inset");
  assert.deepEqual([frameworkHeaderContract.mark.width, frameworkHeaderContract.mark.height], [32, 32], "Desktop product mark should match the established 32px framework component");
  assert.equal(frameworkHeaderContract.title.fontSize, "18.496px", "Desktop masthead title should match the established framework type scale");
  assert.equal(frameworkHeaderContract.title.fontWeight, "900", "Desktop masthead title should match the established framework emphasis");
  assert.equal(frameworkHeaderContract.linkIconCount, 0, "Primary navigation should use the established text-tab component without decorative icons");
  assert.equal(frameworkHeaderContract.link.height, 30, "Primary navigation tabs should match the 30px Control Framework component");
  assert.equal(frameworkHeaderContract.link.fontFamily, '"Public Sans", system-ui, sans-serif', "Primary navigation should use the framework typography");
  assert.equal(frameworkHeaderContract.link.fontSize, "12px", "Primary navigation should match the framework type scale");
  assert.equal(frameworkHeaderContract.link.fontWeight, "750", "Primary navigation should match the framework emphasis");
  assert.match(frameworkHeaderContract.active.boxShadow, /rgb\(139, 211, 255\)/, "Active navigation should use the established inset blue indicator");

  await page.locator('[data-nav-group-trigger="analytics"]').click();
  const frameworkMenuContract = await page.evaluate(() => {
    const menu = document.querySelector('[data-budget-nav-menu="analytics"]');
    const item = menu.querySelector(".if-operations-topnav__menu-item");
    const badge = item.querySelector(".ci-topnav-menu-badge");
    const description = item.querySelector(".ci-topnav-menu-description");
    const style = (node) => {
      const computed = getComputedStyle(node);
      const bounds = node.getBoundingClientRect();
      return {
        width: bounds.width,
        height: bounds.height,
        background: computed.backgroundColor,
        border: computed.border,
        fontSize: computed.fontSize,
        fontWeight: computed.fontWeight,
        padding: computed.padding,
      };
    };
    return { menu: style(menu), item: style(item), badge: style(badge), description: style(description) };
  });
  assert.equal(frameworkMenuContract.menu.width, 280, "Analytics menu should match the established 280px Control Framework popover");
  assert.equal(frameworkMenuContract.item.width, 262, "Analytics menu cards should match the established inner width");
  assert.equal(frameworkMenuContract.item.height, 48, "Analytics menu cards should match the established compact height");
  assert.equal(frameworkMenuContract.item.background, "rgb(255, 255, 255)", "Analytics menu cards should use the established white surface");
  assert.equal(frameworkMenuContract.item.border, "1px solid rgb(227, 232, 239)", "Analytics menu cards should use the established divider border");
  assert.equal(frameworkMenuContract.item.padding, "0px 9px", "Analytics menu cards should match the established horizontal inset");
  assert.equal(frameworkMenuContract.badge.height, 20, "Analytics count badges should match the established badge component");
  assert.equal(frameworkMenuContract.badge.fontSize, "10.5px", "Analytics count badges should match the established type scale");
  assert.ok(frameworkMenuContract.description.height >= 27 && frameworkMenuContract.description.height <= 28, "Analytics card descriptions should use the established two-line treatment");
  await page.screenshot({ path: `${OUT_DIR}/navigation-analytics-desktop.png` });
  await page.locator('[data-nav-group-trigger="analytics"]').click();

  const analyticsTrigger = page.locator('[data-nav-group-trigger="analytics"]');
  await analyticsTrigger.focus();
  await page.keyboard.press("ArrowDown");
  assert.equal(await analyticsTrigger.getAttribute("aria-expanded"), "true", "Arrow Down should open the Analytics menu");
  assert.equal(await page.evaluate(() => document.activeElement?.textContent.includes("Overview")), true, "Arrow Down should focus the first Analytics item");
  await page.keyboard.press("ArrowDown");
  assert.equal(await page.evaluate(() => document.activeElement?.textContent.includes("Schedule")), true, "Arrow keys should move through Analytics items");
  await page.keyboard.press("Escape");
  assert.equal(await analyticsTrigger.getAttribute("aria-expanded"), "false", "Escape should close the Analytics menu");
  assert.equal(await analyticsTrigger.evaluate((node) => document.activeElement === node), true, "Escape should return focus to the Analytics trigger");

  await openSurface(page, "#/budget-spend/analytics?analyticsView=schedule", "[data-transaction-d3-page]");
  await assertActiveGroupState(page, "analytics", "Schedule");
  assert.equal(await page.locator('[data-nav-group-trigger="money"] .ci-header-nav__menu-trigger-context').count(), 0, "Inactive Money flow should not show stale child context");
  await openSurface(page, "#/budget-spend/sources", "[data-analytics-sources-page]");
  await assertActiveGroupState(page, "money", "Source Lineage");
  assert.equal(await page.locator('[data-nav-group-trigger="analytics"] .ci-header-nav__menu-trigger-context').count(), 0, "Inactive Analytics should not show stale child context");
  await openSurface(page, "#/budget-spend/api-log", "[data-ops-activity]");
  await assertActiveGroupState(page, "admin", "API Log");
  assert.equal(await page.locator("[data-admin-workspace]").count(), 1, "API Log should render inside the persistent Admin control-center shell");
  assert.equal(await page.locator('.admin-console__nav a[aria-current="page"]').innerText(), "API Log", "Admin shell should identify API Log as its active in-place section");
  assert.equal(await page.locator('[data-nav-group-trigger="money"] .ci-header-nav__menu-trigger-context').count(), 0, "Inactive Money flow should not show stale child context");
  await page.screenshot({ path: `${OUT_DIR}/navigation-active-admin-desktop.png` });

  const pdbVerificationUrl = new URL(BASE_URL);
  pdbVerificationUrl.searchParams.set("verify", "pdb");
  pdbVerificationUrl.hash = "#/budget-spend";
  await page.goto(pdbVerificationUrl.href, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("[data-pdb-request-page]");
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
  assert.equal(await page.locator("[data-award-record-table] [data-if-table-row]").count(), 25, "Awards should paginate the sampled award table without rendering hundreds of DOM rows at once");
  assert.match(await page.locator("[data-award-record-table] .dbi-data-table__status").innerText(), /689|records/i, "Awards should disclose the complete sampled award scope");
  assert.equal(await page.locator("[data-award-record-table] [data-table-filters]").count(), 0, "Awards should not duplicate the page-level filter deck inside the record table");
  assert.equal(await page.locator("[data-award-record-table] .dbi-data-table__columns").count(), 1, "Awards should expose persistent column configuration");
  const awardColumnManager = page.locator("[data-award-record-table] .dbi-data-table__columns");
  const awardColumnTrigger = awardColumnManager.locator("summary").first();
  await awardColumnTrigger.click();
  assert.equal(await page.locator("[data-award-record-table]").getByRole("button", { name: "Reset", exact: true }).count(), 1, "DataTable column management should expose a one-step layout reset");
  await page.keyboard.press("Escape");
  assert.equal(await awardColumnManager.getAttribute("open"), null, "Escape should close the DataTable column manager");
  assert.equal(await awardColumnTrigger.evaluate((node) => node === document.activeElement), true, "Closing the DataTable column manager should restore focus to its trigger");
  const awardStickyGeometry = await page.locator("[data-award-record-table] .dbi-data-table__wrap").evaluate((wrap) => {
    const identity = wrap.querySelector("th[data-column-key='award']");
    const actions = wrap.querySelector("th[data-table-column-role='actions']");
    const before = { identity: identity?.getBoundingClientRect().left || 0, actions: actions?.getBoundingClientRect().right || 0 };
    wrap.scrollLeft = wrap.scrollWidth;
    const after = { identity: identity?.getBoundingClientRect().left || 0, actions: actions?.getBoundingClientRect().right || 0 };
    return { before, after, clientWidth: wrap.clientWidth, scrollWidth: wrap.scrollWidth };
  });
  assert.ok(awardStickyGeometry.scrollWidth > awardStickyGeometry.clientWidth, "Wide award records should scroll inside the DataTable rather than the document");
  assert.ok(Math.abs(awardStickyGeometry.before.identity - awardStickyGeometry.after.identity) <= 1, `The identity column should remain pinned during horizontal scroll: ${JSON.stringify(awardStickyGeometry)}`);
  assert.ok(Math.abs(awardStickyGeometry.before.actions - awardStickyGeometry.after.actions) <= 5, `The action column should remain pinned within the table border during horizontal scroll: ${JSON.stringify(awardStickyGeometry)}`);
  const awardContentOrder = await page.evaluate(() => ({
    records: document.querySelector("[data-award-record-table]")?.getBoundingClientRect().top || 0,
    rollups: document.querySelector(".awards-page > .grid--sources")?.getBoundingClientRect().top || 0,
    filterBottoms: [...document.querySelectorAll("[data-award-filter-bar] input, [data-award-filter-bar] select, [data-award-filter-bar] > button")].map((node) => Math.round(node.getBoundingClientRect().bottom)),
    metricTops: [...document.querySelectorAll(".awards-page > .source-metrics > .metric")].map((node) => Math.round(node.getBoundingClientRect().top)),
  }));
  assert.ok(awardContentOrder.records < awardContentOrder.rollups, `Award records should precede secondary rollups: ${JSON.stringify(awardContentOrder)}`);
  assert.equal(new Set(awardContentOrder.filterBottoms).size, 1, `Desktop award controls should occupy one aligned Control Framework command row: ${JSON.stringify(awardContentOrder)}`);
  assert.equal(new Set(awardContentOrder.metricTops).size, 1, `Desktop award KPIs should occupy one aligned row: ${JSON.stringify(awardContentOrder)}`);
  assert.ok(awardContentOrder.records <= 560, `Award records should remain visible in the first desktop viewport: ${JSON.stringify(awardContentOrder)}`);
  assert.ok(await page.locator("[data-awards-page] .phase-intro").evaluate((node) => node.getBoundingClientRect().height) <= 72, "Awards intro should remain compact");
  assert.doesNotMatch(await page.locator("[data-awards-page] .phase-intro").innerText(), /Stage\s+4/i, "Awards should not repeat numbered phase navigation");
  assert.doesNotMatch(await page.locator("[data-awards-page]").innerText(), /Pursuit score|recommended action|Target execution brief|Target workboard/i);
  const awardSearchGeometry = await page.getByPlaceholder("Search award IDs, vendors, buyers, descriptions").evaluate((input) => {
    const icon = input.parentElement?.querySelector("svg")?.getBoundingClientRect();
    const bounds = input.getBoundingClientRect();
    return { iconRight: icon?.right || 0, textStart: bounds.left + Number.parseFloat(getComputedStyle(input).paddingLeft) };
  });
  assert.ok(awardSearchGeometry.iconRight + 5 <= awardSearchGeometry.textStart, `Award search icon must not overlap its text lane: ${JSON.stringify(awardSearchGeometry)}`);

  const tablet = await browser.newPage({ viewport: { width: 768, height: 900 } });
  await tablet.goto(`${BASE_URL}#/budget-spend/awards`, { waitUntil: "domcontentloaded" });
  await tablet.waitForSelector("[data-awards-page]");
  await tablet.waitForFunction(() => document.querySelector("[data-award-record-table]")?.getAttribute("data-table-layout") === "cards");
  const tabletAwards = await tablet.evaluate(() => ({
    height: document.documentElement.scrollHeight,
    layout: document.querySelector("[data-award-record-table]")?.getAttribute("data-table-layout"),
    rows: document.querySelectorAll("[data-award-record-table] [data-if-table-row]").length,
  }));
  assert.equal(tabletAwards.layout, "cards", `The 768px Awards table should synchronize pagination with its card layout: ${JSON.stringify(tabletAwards)}`);
  assert.ok(tabletAwards.rows <= 5, `The 768px card layout must not render the 25-row desktop page: ${JSON.stringify(tabletAwards)}`);
  assert.ok(tabletAwards.height <= 5_500, `The 768px Awards route must stay bounded instead of expanding beyond 11,000px: ${JSON.stringify(tabletAwards)}`);
  await tablet.setViewportSize({ width: 769, height: 900 });
  await tablet.waitForFunction(() => document.querySelector("[data-award-record-table]")?.getAttribute("data-table-layout") === "table");
  assert.ok(await tablet.evaluate(() => document.documentElement.scrollHeight <= 5_500), "The 769px Awards route should remain bounded after switching to its table layout");
  await tablet.close();

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
  assert.equal(await page.locator("[data-capture-filters] .capture-filter").count(), 21, "Transactions should expose twenty factual data filters plus tracking scope");
  assert.equal(await page.locator("[data-capture-filters] .capture-filter--advanced:visible").count(), 0, "Advanced filters should start collapsed to reduce vertical noise");
  const compactDesktopGeometry = await page.evaluate(() => ({
    freshnessCount: document.querySelectorAll("[data-freshness-strip]").length,
    firstRowTop: document.querySelector("[data-capture-timeline] .capture-timeline__row")?.getBoundingClientRect().top || 0,
    timelineToolsHeight: document.querySelector("[data-capture-gantt-tools]")?.getBoundingClientRect().height || 0,
  }));
  assert.equal(compactDesktopGeometry.freshnessCount, 0, "Transactions should not render source-freshness cards above the working canvas");
  assert.ok(compactDesktopGeometry.timelineToolsHeight <= 40, `Timeline controls should start collapsed, got ${compactDesktopGeometry.timelineToolsHeight}px`);
  assert.ok(compactDesktopGeometry.firstRowTop <= 520, `The first desktop Gantt row should be visible without scrolling, got ${compactDesktopGeometry.firstRowTop}px`);
  assert.equal(await page.getByRole("button", { name: "Data table" }).count(), 0, "Transactions must remain a Gantt-only workspace");
  assert.equal(await page.locator("[data-transaction-data-table]").count(), 0, "Transactions must not render the shared DataTable");
  await page.evaluate(() => { window.location.hash = "#/budget-spend/transactions?capView=table"; });
  await page.waitForFunction(() => !window.location.hash.includes("capView"));
  await page.waitForSelector("[data-capture-timeline]");
  assert.equal(await page.locator("[data-transaction-data-table]").count(), 0, "Legacy table links must canonicalize back to the Gantt");
  const wallboardRecordIds = await page.locator("[data-capture-timeline-row]").evaluateAll((nodes) => nodes.slice(0, 8).map((node) => node.dataset.recordId));
  assert.equal(wallboardRecordIds.length, 8, "Wallboard density fixture should use eight factual stable record IDs");
  const firstWatchRow = page.locator("[data-capture-timeline-row]").first();
  const firstWatchId = await firstWatchRow.getAttribute("data-record-id");
  const firstWatchStar = firstWatchRow.locator(".capture-timeline__star");
  await firstWatchStar.click();
  assert.equal(await firstWatchStar.getAttribute("aria-pressed"), "true", "Gantt rows should support stable-ID tracking");
  await page.locator("[data-capture-filters] .capture-filter").filter({ hasText: "Tracking" }).locator("select").selectOption("tracked");
  assert.equal(await page.locator("[data-capture-timeline-row]").count(), 1, "Tracked-only scope should reduce the Gantt to the browser watchlist");
  assert.match(decodeURIComponent(new URL(page.url()).hash), /capTracked=tracked/, "Tracked-only scope should be shareable without exposing private notes");
  await openSurface(page, "#/budget-spend/watchlist", "[data-operations-hub]");
  assert.equal(await page.locator("[data-active-page-title]").innerText(), "Administration", "Every Admin section should retain one stable workspace title");
  assert.equal(await page.locator("[data-ops-watch-table] [data-if-table-row]").count(), 1, "Watchlist should project the tracked stable-ID working set");
  assert.equal(await page.locator(`[data-ops-watch-table] [data-row-key="${firstWatchId}"]`).count(), 1, "Watchlist should preserve the exact Gantt stable ID");
  const watchRow = page.locator(`[data-ops-watch-table] [data-row-key="${firstWatchId}"]`);
  await watchRow.click();
  const watchNote = page.locator("[data-ops-watch-table] [data-if-table-detail] textarea");
  await watchNote.fill("Verify public record details before the next review.");
  await watchNote.blur();
  await watchRow.locator('input[type="date"]').fill("2026-10-01");
  await openSurface(page, "#/budget-spend/events", "[data-ops-events]");
  await page.getByRole("button", { name: "Add event" }).click();
  await page.waitForSelector("[data-ops-event-editor]");
  await page.getByLabel("Title").fill("Portfolio evidence review");
  await page.getByLabel("Starts").fill("2027-01-15T14:00");
  await page.getByRole("button", { name: "Save event" }).click();
  await page.waitForSelector("[data-ops-event-editor]", { state: "detached" });
  assert.match(await page.locator("[data-ops-events]").innerText(), /Portfolio evidence review/, "Operations should retain operator events separately from source dates");
  await openSurface(page, "#/budget-spend/integrations", "[data-ops-integrations]");
  assert.equal(await page.locator("[data-ops-integrations] [data-ops-integration-table] [data-if-table-row]").count(), 7, "Operations should summarize each current ingestion layer");
  assert.equal(await page.locator("[data-ops-integrations] [data-integration-freshness] .freshness-chip").count(), 3, "Budget, award, and source freshness should live with Admin integration health");
  await openSurface(page, "#/budget-spend/api-log", "[data-ops-activity]");
  assert.ok(await page.locator("[data-ops-activity] [data-ops-activity-table] [data-if-table-row]").count() >= 4, "Watchlist and event mutations should produce append-only activity entries");
  await page.evaluate((recordIds) => {
    const at = "2026-09-13T12:00:00.000Z";
    localStorage.setItem("dbi:watchlist:v1", JSON.stringify(recordIds.map((recordId, index) => ({ recordId, starredAt: at, updatedAt: at, reviewAt: index < 3 ? `2026-10-0${index + 1}` : "", note: "", wallboard: true }))));
    localStorage.setItem("dbi:management-events:v1", JSON.stringify([
      { id: "event-air-space-cyber-conference-2026", title: "Air, Space & Cyber Conference", startsAt: "2026-09-14T08:00", endsAt: "2026-09-16T17:00", location: "National Harbor, Maryland, USA", attendees: [{ id: "user-jon", displayName: "Jon VandeMark" }, { id: "user-adam", displayName: "Adam Boas" }], milestones: [{ id: "registration", type: "registration_deadline", label: "Registration closes", occursAt: "2026-09-10", notes: "Published registration cutoff" }, { id: "refund", type: "refund_deadline", label: "Last day for refunds", occursAt: "2026-09-11", notes: "Published refund policy" }] },
      { id: "event-ausa-annual-meeting-2026", title: "AUSA Annual Meeting & Exposition 2026", startsAt: "2026-10-12T08:00", endsAt: "2026-10-14T17:00", location: "Walter E. Washington Convention Center, Washington, DC", attendees: [], milestones: [{ id: "hotel", type: "hotel_deadline", label: "Hotel block cutoff", occursAt: "2026-10-01", notes: "Published room-block cutoff" }] },
      { id: "event-eighth-annual-defense-conference-2026", title: "8th Annual Defense Conference", startsAt: "2026-10-30T08:00", endsAt: "2026-10-30T17:00", location: "Hyatt Regency Crystal City, Virginia or virtual", attendees: [{ id: "user-jon", displayName: "Jon VandeMark" }, { id: "user-adam", displayName: "Adam Boas" }] },
      { id: "event-i-itsec-2026", title: "Interservice/Industry Training, Simulation and Education Conference (I/ITSEC) 2026", startsAt: "2026-11-30T08:00", endsAt: "2026-12-04T17:00", location: "Orange County Convention Center, Orlando, Florida", attendees: [{ id: "user-jon", displayName: "Jon VandeMark" }, { id: "user-adam", displayName: "Adam Boas" }] },
      { id: "event-weapon-systems-software-summit-2026", title: "2026 Department of Defense Weapon Systems Software Summit", startsAt: "2026-12-08T08:00", endsAt: "2026-12-08T17:00", location: "Broward County Convention Center, Fort Lauderdale, Florida", attendees: [{ id: "user-adam", displayName: "Adam Boas" }] },
    ].map((event, index) => ({ ...event, attendeeIds: event.attendees.map((attendee) => attendee.id), notes: "", status: "scheduled", recordIds: [recordIds[index]], wallboard: true, createdAt: at, updatedAt: at }))));
    window.dispatchEvent(new CustomEvent("dbi:management-state-changed"));
  }, wallboardRecordIds);
  await openSurface(page, "#/budget-spend/wallboard", "[data-ops-wallboard]");
  assert.match(await page.locator("[data-ops-wallboard]").innerText(), /Air, Space & Cyber Conference/, "The event wallboard should project imported operator events");
  assert.doesNotMatch(await page.locator("[data-ops-wallboard]").innerText(), /AFRL Classified Industry Day/i, "The event wallboard must exclude AFRL Classified Industry Day");
  await page.waitForFunction(() => document.querySelectorAll("[data-wallboard-event-card]").length === 5);
  await page.setViewportSize({ width: 1920, height: 1080 });
  const eventWallboardGeometry = await page.locator("[data-ops-wallboard]").evaluate((node) => {
    const cards = [...node.querySelectorAll("[data-wallboard-event-card]")];
    const grid = node.querySelector(".ops-wallboard__event-grid");
    const gridRect = grid.getBoundingClientRect();
    const rects = cards.map((card) => card.getBoundingClientRect());
    const rowTops = [...new Set(rects.map((rect) => Math.round(rect.top)))].sort((a, b) => a - b);
    const topRow = rects.filter((rect) => Math.round(rect.top) === rowTops[0]);
    const bottomRow = rects.filter((rect) => Math.round(rect.top) === rowTops[1]);
    const body = cards[0].querySelector(".ops-wall-event__body");
    const content = [...body.children].map((child) => child.getBoundingClientRect());
    const contentHeight = content.at(-1).bottom - content[0].top;
    const countdown = cards[0].querySelector(".ops-wall-event__countdown").getBoundingClientRect();
    const countdownValue = cards[0].querySelector(".ops-wall-event__countdown strong").getBoundingClientRect();
    return { topRowCount: topRow.length, bottomRowCount: bottomRow.length, topCardWidth: topRow[0].width, bottomCardWidth: bottomRow[0].width, rows: rowTops.length, titleSize: parseFloat(getComputedStyle(cards[0].querySelector("h3")).fontSize), contentRatio: contentHeight / body.getBoundingClientRect().height, countdownFits: countdownValue.left >= countdown.left && countdownValue.right <= countdown.right, lastCardBottom: rects.at(-1).bottom, gridBottom: gridRect.bottom, writeControls: grid.querySelectorAll("button, input, textarea, select").length };
  });
  assert.equal(eventWallboardGeometry.topRowCount, 3, `Event focus should retain three cards in its primary scan row, got ${eventWallboardGeometry.topRowCount}`);
  assert.equal(eventWallboardGeometry.bottomRowCount, 2, `Five events should reflow into a full-width two-card final row, got ${eventWallboardGeometry.bottomRowCount}`);
  assert.ok(eventWallboardGeometry.bottomCardWidth > eventWallboardGeometry.topCardWidth * 1.4, "The two-card row should expand to use the space formerly left blank");
  assert.equal(eventWallboardGeometry.rows, 2, `Five events should occupy two dense wallboard rows, got ${eventWallboardGeometry.rows}`);
  assert.ok(eventWallboardGeometry.titleSize >= 28, `1080p event titles should scale with the display, got ${eventWallboardGeometry.titleSize}px`);
  assert.ok(eventWallboardGeometry.contentRatio >= 0.4, `Event copy should occupy the card body instead of floating in dead space, got ${(eventWallboardGeometry.contentRatio * 100).toFixed(1)}%`);
  assert.equal(eventWallboardGeometry.countdownFits, true, "Fluid countdown typography must remain inside its dedicated column");
  assert.ok(eventWallboardGeometry.lastCardBottom <= eventWallboardGeometry.gridBottom + 1, "Every focused event card should fit inside the 1080p wallboard");
  assert.equal(eventWallboardGeometry.writeControls, 0, "Focused event cards should remain read-only");
  await page.screenshot({ path: `${OUT_DIR}/wallboard-events-1080p.png` });

  await page.setViewportSize({ width: 3840, height: 2160 });
  const fourKEventGeometry = await page.locator("[data-ops-wallboard]").evaluate((node) => {
    const cards = [...node.querySelectorAll("[data-wallboard-event-card]")];
    const rects = cards.map((card) => card.getBoundingClientRect());
    const rowTops = [...new Set(rects.map((rect) => Math.round(rect.top)))].sort((a, b) => a - b);
    const body = cards[0].querySelector(".ops-wall-event__body");
    const content = [...body.children].map((child) => child.getBoundingClientRect());
    const countdown = cards[0].querySelector(".ops-wall-event__countdown").getBoundingClientRect();
    const countdownValue = cards[0].querySelector(".ops-wall-event__countdown strong").getBoundingClientRect();
    return {
      topRowCount: rects.filter((rect) => Math.round(rect.top) === rowTops[0]).length,
      bottomRowCount: rects.filter((rect) => Math.round(rect.top) === rowTops[1]).length,
      titleSize: parseFloat(getComputedStyle(cards[0].querySelector("h3")).fontSize),
      dateSize: parseFloat(getComputedStyle(cards[0].querySelector("time")).fontSize),
      contentRatio: (content.at(-1).bottom - content[0].top) / body.getBoundingClientRect().height,
      countdownFits: countdownValue.left >= countdown.left && countdownValue.right <= countdown.right,
      lastCardBottom: rects.at(-1).bottom,
      gridBottom: node.querySelector(".ops-wallboard__event-grid").getBoundingClientRect().bottom,
    };
  });
  assert.equal(fourKEventGeometry.topRowCount, 3, "4K event focus should retain three cards in its primary row");
  assert.equal(fourKEventGeometry.bottomRowCount, 2, "4K event focus should retain two expanded cards in its final row");
  assert.ok(fourKEventGeometry.titleSize >= 44, `4K event titles should scale with the display, got ${fourKEventGeometry.titleSize}px`);
  assert.ok(fourKEventGeometry.dateSize >= 20, `4K event dates should scale with the display, got ${fourKEventGeometry.dateSize}px`);
  assert.ok(fourKEventGeometry.contentRatio >= 0.24, `4K event copy should use the card body, got ${(fourKEventGeometry.contentRatio * 100).toFixed(1)}%`);
  assert.equal(fourKEventGeometry.countdownFits, true, "4K countdown typography must remain inside its dedicated column");
  assert.ok(fourKEventGeometry.lastCardBottom <= fourKEventGeometry.gridBottom + 1, "Every focused event card should fit inside the 4K wallboard");
  await assertNoPageOverflow(page, "4K focused event wallboard");
  await page.screenshot({ path: `${OUT_DIR}/wallboard-events-4k.png` });

  await page.setViewportSize({ width: 390, height: 844 });
  const mobileEventGeometry = await page.locator("[data-ops-wallboard]").evaluate((node) => {
    const cards = [...node.querySelectorAll("[data-wallboard-event-card]")];
    const rects = cards.map((card) => card.getBoundingClientRect());
    return {
      columns: new Set(rects.map((rect) => Math.round(rect.left))).size,
      titleSize: parseFloat(getComputedStyle(cards[0].querySelector("h3")).fontSize),
      minControlHeight: Math.min(...[...node.querySelectorAll("button")].map((button) => button.getBoundingClientRect().height)),
      viewportWidth: innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
    };
  });
  assert.equal(mobileEventGeometry.columns, 1, "Mobile event focus should stack cards in one readable column");
  assert.ok(mobileEventGeometry.titleSize >= 18, `Mobile event titles should remain readable, got ${mobileEventGeometry.titleSize}px`);
  assert.ok(mobileEventGeometry.minControlHeight >= 44, `Mobile wallboard controls should retain 44px targets, got ${mobileEventGeometry.minControlHeight}px`);
  assert.ok(mobileEventGeometry.scrollWidth <= mobileEventGeometry.viewportWidth + 1, "Mobile event focus must not overflow horizontally");
  await page.screenshot({ path: `${OUT_DIR}/wallboard-events-mobile.png`, fullPage: true });

  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.getByRole("button", { name: "Calendar", exact: true }).click();
  await page.waitForSelector("[data-wallboard-calendar]");
  assert.match(await page.locator("[data-wallboard-calendar] > header").innerText(), /September 2026/, "Calendar should open on the first scheduled event month");
  assert.equal(await page.locator("[data-calendar-day]").count(), 42, "Calendar should render a stable six-week month grid");
  assert.equal(await page.locator('[data-calendar-event="event-air-space-cyber-conference-2026"]').count(), 1, "A multi-day event should render as one continuous Gantt-style weekly bar");
  assert.equal(await page.locator('[data-calendar-milestone][data-parent-event="event-air-space-cyber-conference-2026"]').count(), 2, "Published event deadlines should render as linked Gantt overlays");
  const registrationMilestone = page.locator('[data-calendar-milestone="registration"]');
  const registrationDatePlacement = await registrationMilestone.evaluate((node) => {
    const milestone = node.getBoundingClientRect();
    const date = document.querySelector('[data-calendar-day="2026-09-10"]').getBoundingClientRect();
    return { insideDateColumn: milestone.left >= date.left - 1 && milestone.right <= date.right + 1 };
  });
  assert.equal(registrationDatePlacement.insideDateColumn, true, "Registration cutoff overlay should occupy its exact calendar date column");
  await registrationMilestone.hover();
  await page.waitForSelector("[data-calendar-hovercard]");
  assert.match(await page.locator("[data-calendar-hovercard]").innerText(), /Registration closes[\s\S]*Air, Space & Cyber Conference[\s\S]*4 days before start/, "Milestone hover should explain its parent event, date, and lead time");
  const milestoneHoverGeometry = await page.locator("[data-calendar-hovercard]").evaluate((node) => { const rect = node.getBoundingClientRect(); return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: innerWidth, height: innerHeight }; });
  assert.ok(milestoneHoverGeometry.left >= 0 && milestoneHoverGeometry.top >= 0 && milestoneHoverGeometry.right <= milestoneHoverGeometry.width && milestoneHoverGeometry.bottom <= milestoneHoverGeometry.height, "Calendar hover cards should remain contained within the viewport");
  await page.screenshot({ path: `${OUT_DIR}/wallboard-calendar-hover-1080p.png` });
  await page.mouse.move(2, 2);
  await page.locator('[data-calendar-event="event-air-space-cyber-conference-2026"]').focus();
  await page.waitForSelector('[data-calendar-hovercard][data-kind="event"]');
  assert.match(await page.locator('[data-calendar-hovercard][data-kind="event"]').innerText(), /Event schedule[\s\S]*2 milestones[\s\S]*National Harbor/i, "Keyboard focus should expose the rich event hover card");
  await page.locator('[data-calendar-event="event-air-space-cyber-conference-2026"]').blur();
  const calendarGeometry = await page.locator("[data-wallboard-calendar]").evaluate((node) => {
    const grid = node.querySelector(".ops-wall-calendar__weeks");
    const cells = [...grid.querySelectorAll("[data-calendar-day]")];
    const rects = cells.map((cell) => cell.getBoundingClientRect());
    return {
      columns: new Set(rects.map((rect) => Math.round(rect.left))).size,
      rows: new Set(rects.map((rect) => Math.round(rect.top))).size,
      firstCellHeight: rects[0].height,
      lastCellBottom: rects.at(-1).bottom,
      gridBottom: grid.getBoundingClientRect().bottom,
      eventSize: parseFloat(getComputedStyle(node.querySelector("[data-calendar-event] strong")).fontSize),
      eventCopy: (() => {
        const bar = node.querySelector('[data-calendar-event="event-air-space-cyber-conference-2026"]');
        const copy = bar.querySelector(".ops-wall-calendar__bar-copy");
        const title = copy.querySelector("strong");
        const location = copy.querySelector("span");
        const barBox = bar.getBoundingClientRect();
        const copyBox = copy.getBoundingClientRect();
        const titleBox = title.getBoundingClientRect();
        const locationBox = location.getBoundingClientRect();
        return {
          stacked: locationBox.top >= titleBox.bottom - 1,
          copyUsesSpan: copyBox.width >= barBox.width * .9,
          titleUsesCopyWidth: titleBox.width >= copyBox.width - 1,
          locationUsesCopyWidth: locationBox.width >= copyBox.width - 1,
          contained: titleBox.right <= barBox.right + 1 && locationBox.right <= barBox.right + 1 && locationBox.bottom <= barBox.bottom + 1,
          lineCount: copy.children.length,
        };
      })(),
      writeControls: node.querySelectorAll("[data-calendar-event] button, [data-calendar-event] input, [data-calendar-event] textarea, [data-calendar-event] select").length,
    };
  });
  assert.equal(calendarGeometry.columns, 7, "Desktop calendar should retain seven weekday columns");
  assert.equal(calendarGeometry.rows, 6, "Desktop calendar should retain six stable week rows");
  assert.ok(calendarGeometry.firstCellHeight >= 100, `1080p calendar dates should remain distance-readable, got ${calendarGeometry.firstCellHeight}px cells`);
  assert.ok(calendarGeometry.eventSize >= 12, `1080p calendar event labels should remain readable, got ${calendarGeometry.eventSize}px`);
  assert.equal(calendarGeometry.eventCopy.stacked, true, "Calendar event title and location should render on separate lines");
  assert.equal(calendarGeometry.eventCopy.copyUsesSpan, true, "Calendar copy should use the full event-bar span");
  assert.equal(calendarGeometry.eventCopy.titleUsesCopyWidth, true, "Calendar event titles should receive the full copy width before truncation");
  assert.equal(calendarGeometry.eventCopy.locationUsesCopyWidth, true, "Calendar event locations should receive the full copy width before truncation");
  assert.equal(calendarGeometry.eventCopy.contained, true, "Stacked calendar copy must remain inside its event bar");
  assert.equal(calendarGeometry.eventCopy.lineCount, 2, "Calendar bars should reserve exactly two unclipped lines for title and location");
  assert.ok(calendarGeometry.lastCellBottom <= calendarGeometry.gridBottom + 1, "Every calendar week should fit within the 1080p wallboard");
  assert.equal(calendarGeometry.writeControls, 0, "Calendar event entries should remain read-only");
  await assertNoPageOverflow(page, "1080p event calendar");
  await page.screenshot({ path: `${OUT_DIR}/wallboard-calendar-1080p.png` });

  await page.getByRole("button", { name: "Auto-cycle off" }).click();
  await page.getByRole("button", { name: "Enter kiosk" }).click();
  await page.waitForFunction(() => document.querySelector("[data-ops-wallboard]")?.dataset.wallboardFullscreen === "true");
  const calendarKioskGeometry = await page.locator("[data-ops-wallboard]").evaluate((node) => ({
    mode: node.dataset.wallboardMode,
    width: node.getBoundingClientRect().width,
    height: node.getBoundingClientRect().height,
    viewportWidth: innerWidth,
    viewportHeight: innerHeight,
    toolbarCount: node.querySelectorAll(".ops-wallboard__toolbar").length,
    metricsCount: node.querySelectorAll(".ops-wallboard__metrics").length,
    brandTitleCount: node.querySelectorAll(".ops-wallboard__brand h2").length,
    brandEyebrowVisible: node.querySelector(".ops-wallboard__brand span")?.getBoundingClientRect().height > 0,
    clockCount: node.querySelectorAll(".ops-wallboard__time strong").length,
    clockSupportingCopy: node.querySelectorAll(".ops-wallboard__time span, .ops-wallboard__time small").length,
    calendarControlsVisible: [...node.querySelectorAll(".ops-wall-calendar__controls")].some((control) => control.getBoundingClientRect().height > 0),
    sectionEyebrowsVisible: [...node.querySelectorAll(".ops-wallboard__section > header span")].some((item) => item.getBoundingClientRect().height > 0),
    sectionCountsVisible: [...node.querySelectorAll(".ops-wallboard__section > header > b")].some((item) => item.getBoundingClientRect().height > 0),
  }));
  assert.equal(calendarKioskGeometry.mode, "calendar", "Entering kiosk should preserve the selected wallboard view");
  assert.ok(Math.abs(calendarKioskGeometry.width - calendarKioskGeometry.viewportWidth) <= 1 && Math.abs(calendarKioskGeometry.height - calendarKioskGeometry.viewportHeight) <= 1, `Calendar kiosk should fill the viewport, got ${calendarKioskGeometry.width}×${calendarKioskGeometry.height}`);
  assert.equal(calendarKioskGeometry.toolbarCount, 0, "Kiosk should remove the wallboard mode and rotation configuration");
  assert.equal(calendarKioskGeometry.metricsCount, 0, "Kiosk should remove the summary KPI strip");
  assert.equal(calendarKioskGeometry.brandTitleCount, 1, "Kiosk should retain the Defense Budget Intelligence identity");
  assert.equal(calendarKioskGeometry.brandEyebrowVisible, false, "Kiosk should remove the conference-room eyebrow");
  assert.equal(calendarKioskGeometry.clockCount, 1, "Kiosk should retain one current-time display");
  assert.equal(calendarKioskGeometry.clockSupportingCopy, 0, "Kiosk should remove date and data-cutoff copy from the clock");
  assert.equal(calendarKioskGeometry.calendarControlsVisible, false, "Kiosk should hide calendar navigation and count controls");
  assert.equal(calendarKioskGeometry.sectionEyebrowsVisible, false, "Kiosk should hide secondary section labels");
  assert.equal(calendarKioskGeometry.sectionCountsVisible, false, "Kiosk should hide secondary section count badges");
  await assertNoPageOverflow(page, "Minimal calendar kiosk");
  await page.screenshot({ path: `${OUT_DIR}/wallboard-calendar-kiosk-1080p.png` });
  await page.evaluate(() => document.exitFullscreen());
  await page.waitForFunction(() => document.querySelector("[data-ops-wallboard]")?.dataset.wallboardFullscreen === "false");
  assert.equal(await page.getByRole("button", { name: "Auto-cycle off" }).getAttribute("aria-pressed"), "false", "Entering kiosk should freeze the selected view by disabling auto-cycle");

  await page.getByRole("button", { name: "Next month" }).click();
  assert.match(await page.locator("[data-wallboard-calendar] > header").innerText(), /October 2026/, "Calendar month navigation should advance one month");
  assert.equal(await page.locator('[data-calendar-event="event-ausa-annual-meeting-2026"]').count(), 1, "October should show AUSA as one multi-day bar");
  assert.equal(await page.locator('[data-calendar-event="event-eighth-annual-defense-conference-2026"]').count(), 1, "October should show the defense conference date");
  await page.getByRole("button", { name: "Next month" }).click();
  assert.match(await page.locator("[data-wallboard-calendar] > header").innerText(), /November 2026/, "Calendar should support sequential month navigation");
  assert.equal(await page.locator('[data-calendar-event="event-i-itsec-2026"]').count(), 1, "A cross-month event should remain one continuous weekly bar through its final December date");
  await page.getByRole("button", { name: "Previous month" }).click();
  await page.getByRole("button", { name: "Previous month" }).click();

  await page.setViewportSize({ width: 3840, height: 2160 });
  const fourKCalendarGeometry = await page.locator("[data-wallboard-calendar]").evaluate((node) => ({
    monthSize: parseFloat(getComputedStyle(node.querySelector(":scope > header strong")).fontSize),
    eventSize: parseFloat(getComputedStyle(node.querySelector("[data-calendar-event] strong")).fontSize),
    columns: getComputedStyle(node.querySelector(".ops-wall-calendar__days")).gridTemplateColumns.split(" ").length,
  }));
  assert.ok(fourKCalendarGeometry.monthSize >= 28, `4K calendar heading should scale for viewing distance, got ${fourKCalendarGeometry.monthSize}px`);
  assert.ok(fourKCalendarGeometry.eventSize >= 17, `4K calendar event labels should scale for viewing distance, got ${fourKCalendarGeometry.eventSize}px`);
  assert.equal(fourKCalendarGeometry.columns, 7, "4K calendar should preserve its seven-column structure");
  await assertNoPageOverflow(page, "4K event calendar");
  await page.screenshot({ path: `${OUT_DIR}/wallboard-calendar-4k.png` });
  await page.getByRole("button", { name: "Enter kiosk" }).click();
  await page.waitForFunction(() => document.querySelector("[data-ops-wallboard]")?.dataset.wallboardFullscreen === "true");
  const fourKCalendarKioskGeometry = await page.locator("[data-ops-wallboard]").evaluate((node) => ({
    toolbarCount: node.querySelectorAll(".ops-wallboard__toolbar").length,
    metricsCount: node.querySelectorAll(".ops-wallboard__metrics").length,
    clockSize: parseFloat(getComputedStyle(node.querySelector(".ops-wallboard__time strong")).fontSize),
    calendarBottom: node.querySelector("[data-wallboard-calendar]").getBoundingClientRect().bottom,
    viewportHeight: innerHeight,
  }));
  assert.equal(fourKCalendarKioskGeometry.toolbarCount, 0, "4K kiosk should remove wallboard configuration");
  assert.equal(fourKCalendarKioskGeometry.metricsCount, 0, "4K kiosk should remove summary metrics");
  assert.ok(fourKCalendarKioskGeometry.clockSize >= 50, `4K kiosk clock should remain distance-readable, got ${fourKCalendarKioskGeometry.clockSize}px`);
  assert.ok(fourKCalendarKioskGeometry.calendarBottom >= fourKCalendarKioskGeometry.viewportHeight - 50, `4K kiosk calendar should consume the freed display height, ending at ${fourKCalendarKioskGeometry.calendarBottom}px of ${fourKCalendarKioskGeometry.viewportHeight}px`);
  await assertNoPageOverflow(page, "Minimal 4K calendar kiosk");
  await page.screenshot({ path: `${OUT_DIR}/wallboard-calendar-kiosk-4k.png` });
  await page.evaluate(() => document.exitFullscreen());
  await page.waitForFunction(() => document.querySelector("[data-ops-wallboard]")?.dataset.wallboardFullscreen === "false");

  await page.setViewportSize({ width: 390, height: 844 });
  const mobileCalendarGeometry = await page.locator("[data-wallboard-calendar]").evaluate((node) => {
    const viewport = node.querySelector(".ops-wall-calendar__viewport");
    return {
      viewportClientWidth: viewport.clientWidth,
      viewportScrollWidth: viewport.scrollWidth,
      viewportOverflowX: getComputedStyle(viewport).overflowX,
      minControlHeight: Math.min(...[...node.querySelectorAll("button")].map((button) => button.getBoundingClientRect().height)),
      documentWidth: document.documentElement.scrollWidth,
      windowWidth: innerWidth,
    };
  });
  assert.ok(mobileCalendarGeometry.viewportScrollWidth > mobileCalendarGeometry.viewportClientWidth, "Mobile calendar should preserve the month grid inside a contained horizontal scroller");
  assert.equal(mobileCalendarGeometry.viewportOverflowX, "auto", "Mobile calendar should expose intentional horizontal calendar scrolling");
  assert.ok(mobileCalendarGeometry.minControlHeight >= 44, `Mobile calendar controls should retain 44px targets, got ${mobileCalendarGeometry.minControlHeight}px`);
  assert.ok(mobileCalendarGeometry.documentWidth <= mobileCalendarGeometry.windowWidth + 1, "Mobile calendar must not overflow the document");
  await page.screenshot({ path: `${OUT_DIR}/wallboard-calendar-mobile.png`, fullPage: true });

  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.getByRole("button", { name: "Overview" }).click();
  await page.waitForFunction(() => document.querySelectorAll(".ops-wallboard__record").length === 8 && document.querySelectorAll(".ops-wallboard__event").length === 5);
  assert.match(await page.locator("[data-ops-wallboard]").innerText(), /Tracked records\s+8/i, "Wallboard should project tracked-record counts");
  const wallboardBaseline = await page.locator("[data-ops-wallboard]").evaluate((node) => ({
    background: getComputedStyle(node).backgroundColor,
    height: node.getBoundingClientRect().height,
    viewportHeight: window.innerHeight,
    writeControls: node.querySelectorAll(".ops-wallboard__record button").length,
  }));
  assert.match(wallboardBaseline.background, /rgb\((?:23[0-9]|24[0-9]|25[0-5]), (?:23[0-9]|24[0-9]|25[0-5]), (?:23[0-9]|24[0-9]|25[0-5])\)/, `Wallboard should use a bright kiosk canvas, got ${wallboardBaseline.background}`);
  assert.ok(wallboardBaseline.height >= wallboardBaseline.viewportHeight * 0.8, `Wallboard should fill the visible display, got ${wallboardBaseline.height}px of ${wallboardBaseline.viewportHeight}px`);
  assert.equal(wallboardBaseline.writeControls, 0, "Wallboard should remain a read-only projection without watchlist mutation controls");
  await assertNoPageOverflow(page, "Desktop wallboard");
  await page.screenshot({ path: `${OUT_DIR}/wallboard-desktop.png`, fullPage: true });
  await page.setViewportSize({ width: 1920, height: 1080 });
  const conferenceGeometry = await page.locator("[data-ops-wallboard]").evaluate((node) => ({
    width: node.getBoundingClientRect().width,
    height: node.getBoundingClientRect().height,
    metricSize: parseFloat(getComputedStyle(node.querySelector(".ops-wallboard__metrics strong")).fontSize),
    recordTitleSize: parseFloat(getComputedStyle(node.querySelector(".ops-wallboard__record-copy > strong")).fontSize),
  }));
  assert.ok(conferenceGeometry.width >= 1860, `1080p wallboard should use the display width, got ${conferenceGeometry.width}px`);
  assert.ok(conferenceGeometry.height >= 960, `1080p wallboard should fill the conference display, got ${conferenceGeometry.height}px`);
  assert.ok(await page.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight + 2), "Routed 1080p wallboard should fit the viewport without document scrolling");
  assert.ok(conferenceGeometry.metricSize >= 40, `1080p metric values should be distance-readable, got ${conferenceGeometry.metricSize}px`);
  assert.ok(conferenceGeometry.recordTitleSize >= 17, `1080p record titles should be distance-readable, got ${conferenceGeometry.recordTitleSize}px`);
  const conferenceFit = await page.evaluate(() => {
    const records = [...document.querySelectorAll(".ops-wallboard__record")];
    const events = [...document.querySelectorAll(".ops-wallboard__event")];
    const recordPanel = document.querySelector(".ops-wallboard__section--records").getBoundingClientRect();
    const eventPanel = document.querySelector(".ops-wallboard__section--schedule").getBoundingClientRect();
    return { lastRecord: records.at(-1).getBoundingClientRect().bottom, recordBottom: recordPanel.bottom, lastEvent: events.at(-1).getBoundingClientRect().bottom, eventBottom: eventPanel.bottom };
  });
  assert.ok(conferenceFit.lastRecord <= conferenceFit.recordBottom + 1, `1080p kiosk should show all eight tracked cards, got ${conferenceFit.lastRecord}px beyond ${conferenceFit.recordBottom}px`);
  assert.ok(conferenceFit.lastEvent <= conferenceFit.eventBottom + 1, `1080p kiosk should show all five event cards, got ${conferenceFit.lastEvent}px beyond ${conferenceFit.eventBottom}px`);
  await page.screenshot({ path: `${OUT_DIR}/wallboard-1080p.png` });
  await page.getByRole("button", { name: "Enter kiosk" }).click();
  await page.waitForFunction(() => document.querySelector("[data-ops-wallboard]")?.dataset.wallboardFullscreen === "true");
  const fullscreenGeometry = await page.locator("[data-ops-wallboard]").evaluate((node) => ({ width: node.getBoundingClientRect().width, height: node.getBoundingClientRect().height, viewportWidth: innerWidth, viewportHeight: innerHeight, toolbarCount: node.querySelectorAll(".ops-wallboard__toolbar").length, metricsCount: node.querySelectorAll(".ops-wallboard__metrics").length }));
  assert.ok(Math.abs(fullscreenGeometry.width - fullscreenGeometry.viewportWidth) <= 1 && Math.abs(fullscreenGeometry.height - fullscreenGeometry.viewportHeight) <= 1, `Kiosk mode should fill the viewport, got ${fullscreenGeometry.width}×${fullscreenGeometry.height}`);
  assert.equal(fullscreenGeometry.toolbarCount, 0, "Every kiosk view should remove wallboard configuration");
  assert.equal(fullscreenGeometry.metricsCount, 0, "Every kiosk view should remove summary metrics");
  await page.screenshot({ path: `${OUT_DIR}/wallboard-kiosk-1080p.png` });
  await page.evaluate(() => document.exitFullscreen());
  await page.waitForFunction(() => document.querySelector("[data-ops-wallboard]")?.dataset.wallboardFullscreen === "false");
  await page.setViewportSize({ width: 3840, height: 2160 });
  const fourKGeometry = await page.locator("[data-ops-wallboard]").evaluate((node) => ({
    height: node.getBoundingClientRect().height,
    brandSize: parseFloat(getComputedStyle(node.querySelector(".ops-wallboard__brand h2")).fontSize),
    metricSize: parseFloat(getComputedStyle(node.querySelector(".ops-wallboard__metrics strong")).fontSize),
    recordColumns: getComputedStyle(node.querySelector(".ops-wallboard__section--records .ops-wallboard__cards")).gridTemplateColumns.split(" ").length,
  }));
  assert.ok(fourKGeometry.height >= 2040, `4K wallboard should fill the conference display, got ${fourKGeometry.height}px`);
  assert.ok(fourKGeometry.brandSize >= 42, `4K wallboard title should scale for viewing distance, got ${fourKGeometry.brandSize}px`);
  assert.ok(fourKGeometry.metricSize >= 62, `4K wallboard metrics should scale for viewing distance, got ${fourKGeometry.metricSize}px`);
  assert.equal(fourKGeometry.recordColumns, 3, `4K overview should use three tracked-record columns, got ${fourKGeometry.recordColumns}`);
  await assertNoPageOverflow(page, "4K wallboard");
  await page.screenshot({ path: `${OUT_DIR}/wallboard-4k.png` });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openSurface(page, "#/budget-spend/transactions", "[data-transaction-analytics-page]");
  assert.equal(await page.locator("[data-capture-timeline-row]").first().locator(".capture-timeline__star").getAttribute("aria-pressed"), "true", "Tracking state should persist across application surfaces");
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
  const analyticsAccessibility = await page.evaluate(() => [...document.querySelectorAll("[data-d3-analytics]")].map((chart) => {
    const interactive = [...chart.querySelectorAll('[role="button"]')];
    const marks = [...chart.querySelectorAll('[role="button"][data-analytics-mark]')];
    return {
      interactive: interactive.length,
      unnamedInteractive: interactive.filter((mark) => !mark.getAttribute("aria-label")?.trim() && !mark.textContent?.trim()).length,
      marks: marks.length,
      unnamed: marks.filter((mark) => !mark.getAttribute("aria-label")?.trim()).length,
      tabbable: marks.filter((mark) => mark.getAttribute("tabindex") === "0").length,
    };
  }));
  assert.ok(analyticsAccessibility.some((chart) => chart.marks > 0), "Analytics should retain interactive chart marks");
  assert.ok(analyticsAccessibility.every((chart) => chart.unnamedInteractive === 0), `Every analytical control needs an accessible name: ${JSON.stringify(analyticsAccessibility)}`);
  assert.ok(analyticsAccessibility.every((chart) => chart.unnamed === 0), `Every interactive chart mark needs an accessible name: ${JSON.stringify(analyticsAccessibility)}`);
  assert.ok(analyticsAccessibility.every((chart) => chart.marks === 0 || chart.tabbable === 1), `Each chart should expose one roving tab stop instead of hundreds: ${JSON.stringify(analyticsAccessibility)}`);
  await page.locator('[data-d3-analytics="dimension-explorer"] [role="button"]').first().hover();
  await page.waitForSelector("[data-analytics-hovercard]");
  assert.match(await page.locator("[data-analytics-hovercard]").innerText(), /records/i, "D3 marks should expose immediate contextual hover detail");
  await page.locator('[data-d3-analytics="dimension-explorer"] header').hover();
  await page.waitForSelector("[data-analytics-hovercard]", { state: "detached" });
  const firstDimensionMark = page.locator('[data-d3-analytics="dimension-explorer"] [data-analytics-mark]').first();
  await firstDimensionMark.focus();
  await page.waitForSelector("[data-analytics-hovercard]");
  assert.match(await page.locator("[data-analytics-hovercard]").innerText(), /records/i, "Keyboard focus should expose the same contextual chart detail as pointer hover");
  const firstDimensionLabel = await firstDimensionMark.getAttribute("aria-label");
  await page.keyboard.press("ArrowDown");
  assert.notEqual(await page.evaluate(() => document.activeElement?.getAttribute("aria-label")), firstDimensionLabel, "Arrow keys should move through chart marks using one roving tab stop");
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
  const analyticalDetailTrigger = page.locator('[data-analytics-records] tbody button').first();
  await analyticalDetailTrigger.click();
  await page.waitForSelector('.analytics-modal [role="dialog"]');
  assert.match(await page.locator('.analytics-modal [role="dialog"]').innerText(), /Observed obligations|Reported potential/i);
  assert.match(await page.locator('.analytics-modal [role="dialog"] a').first().getAttribute('href'), /capRecord=/, "Analytical detail should deep-link to the exact Transactions record");
  assert.equal(await page.locator('.analytics-modal [role="dialog"] header button').evaluate((node) => node === document.activeElement), true, "Analytical detail should focus its close control on open");
  await page.keyboard.press("Shift+Tab");
  assert.equal(await page.locator('.analytics-modal [role="dialog"]').evaluate((dialog) => dialog.contains(document.activeElement)), true, "Shift+Tab must wrap within analytical detail");
  await page.keyboard.press("Tab");
  assert.equal(await page.locator('.analytics-modal [role="dialog"] header button').evaluate((node) => node === document.activeElement), true, "Tab must wrap back to the first analytical-detail control");
  await page.keyboard.press("Escape");
  await page.waitForSelector('.analytics-modal', { state: "detached" });
  assert.equal(await analyticalDetailTrigger.evaluate((node) => node === document.activeElement), true, "Closing analytical detail should restore focus to its trigger");
  assert.doesNotMatch(await page.locator("[data-transaction-d3-page]").innerText(), FORBIDDEN_SURFACE_TEXT);
  assert.match(await page.locator("[data-transaction-d3-page]").innerText(), /not the complete federal contract universe/i, "Analytics should disclose its coverage boundary");
  await page.screenshot({ path: `${OUT_DIR}/transactions-d3-desktop.png`, fullPage: true });

  await page.goto(`${BASE_URL}#/budget-spend/analytics?analyticsView=bogus`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("[data-transaction-d3-page]");
  await page.waitForFunction(() => !window.location.hash.includes("analyticsView=bogus"));
  assert.equal(new URL(page.url()).hash, "#/budget-spend/analytics", "Unknown Analytics workspace values should canonicalize to Overview");

  await openSurface(page, "#/budget-spend/sources", "[data-analytics-sources-page]");
  assert.equal(await page.locator("[data-active-page-title]").innerText(), "Source Lineage");
  assert.equal(await page.locator("[data-source-flow] .source-flow__step").count(), 6, "Sources should trace six published data layers");
  assert.equal(await page.locator(".join-policy-grid article").count(), 6, "Sources should disclose six join rules");
  assert.ok(await page.locator("[data-source-health-monitor] article").count() >= 1, "Sources should expose source health");
  assert.doesNotMatch(await page.locator("[data-analytics-sources-page]").innerText(), FORBIDDEN_SURFACE_TEXT);

  await page.goto(`${BASE_URL}#/budget-spend/strategy`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("[data-pdb-request-page]");
  assert.equal(new URL(page.url()).hash, "#/budget-spend", "Legacy strategy URLs should canonicalize to the request analytics surface");
  assert.equal(await page.locator("[data-strategy-page]").count(), 0, "Legacy strategy surface should not render");
  await page.goto(`${BASE_URL}#/definitely-not-a-route`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("[data-transaction-analytics-page]");
  assert.equal(new URL(page.url()).hash, "#/budget-spend/transactions", "Unknown routes should canonicalize to the flagship Transactions surface");
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
  await mobile.waitForSelector("[data-transaction-analytics-page]");
  await assertFlowShell(mobile);
  const mobileNavHeights = await mobile.locator(".ci-header-nav > a[data-budget-nav], .ci-header-nav > .if-operations-topnav__secondary > button").evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().height));
  assert.ok(mobileNavHeights.filter(Boolean).every((height) => height >= 43.5), `Mobile navigation controls should preserve 44px touch targets: ${mobileNavHeights.join(", ")}`);
  assert.ok(await mobile.locator("[data-budget-spend-header]").evaluate((node) => node.getBoundingClientRect().height) <= 108, "Mobile masthead should remain compact while preserving 44px navigation targets");
  await mobile.locator("[data-mobile-more-menu-button]").click();
  assert.equal(await mobile.locator("[data-mobile-more-menu] a[data-budget-nav]").count(), 13, "Mobile More should expose every Analytics, Money flow, and Admin route in grouped Control Framework cards");
  assert.match(await mobile.locator("[data-mobile-more-menu]").innerText(), /Analytics[\s\S]*Money flow[\s\S]*Admin/i, "Mobile More should use the established grouped menu pattern");
  await mobile.screenshot({ path: `${OUT_DIR}/navigation-groups-mobile.png` });
  await mobile.locator("[data-mobile-more-menu-button]").click();
  assert.deepEqual(await mobile.locator('.ci-header-nav > a[data-budget-nav]:visible').allTextContents(), ["Transactions", "Wallboard"], "Mobile should keep only Transactions and Wallboard as direct routes");
  assert.equal(await mobile.locator('.ci-header-nav > a[data-budget-nav]:visible').allTextContents().then((items) => items.every((item) => item.trim().length > 0)), true, "Every visible mobile route tab should have a text label");
  await openSurface(mobile, "#/budget-spend", "[data-pdb-request-page]");
  const mobileRequestChrome = await mobile.evaluate(() => ({
    filters: document.querySelector("[data-budget-filter-bar]")?.getBoundingClientRect().height || 0,
    metrics: document.querySelector(".metrics")?.getBoundingClientRect().height || 0,
    freshnessCount: document.querySelectorAll("[data-freshness-strip]").length,
  }));
  assert.ok(mobileRequestChrome.filters <= 140, `Mobile request filters should use one search row and one contained control rail, got ${mobileRequestChrome.filters}px`);
  assert.ok(mobileRequestChrome.metrics <= 115, `Mobile request KPIs should use one horizontal strip, got ${mobileRequestChrome.metrics}px`);
  assert.equal(mobileRequestChrome.freshnessCount, 0, "Money-flow pages should not carry the integration-health strip");
  assert.ok(await mobile.locator("[data-pdb-request-page]").evaluate((node) => node.getBoundingClientRect().height) <= 80, "Mobile request intro should stay compact");
  await assertNoPageOverflow(mobile, "Mobile request");

  await openSurface(mobile, "#/budget-spend/trends", "[data-request-history-page]");
  assert.ok(await mobile.locator("[data-request-history-page]").evaluate((node) => node.getBoundingClientRect().height) <= 80, "Mobile request-history intro should stay compact");
  assert.ok(await mobile.locator(".trend-metrics").evaluate((node) => node.getBoundingClientRect().height) <= 115, "Mobile request-history KPIs should use one compact horizontal strip");
  await assertNoPageOverflow(mobile, "Mobile request history");

  await openSurface(mobile, "#/budget-spend/lifecycle", "[data-account-spine-page]");
  const accountHeight = await mobile.locator("#lifecycle-account").evaluate((node) => node.getBoundingClientRect().height);
  assert.ok(accountHeight >= 43.5, `Mobile account selector should be 44px, got ${accountHeight}`);
  assert.ok(await mobile.locator("[data-account-spine-page] .phase-intro").evaluate((node) => node.getBoundingClientRect().height) <= 120, "Mobile account-flow intro should stay compact");
  await assertNoPageOverflow(mobile, "Mobile account flow");

  await openSurface(mobile, "#/budget-spend/awards", "[data-awards-page]");
  assert.ok(await mobile.locator("[data-awards-page] .phase-intro").evaluate((node) => node.getBoundingClientRect().height) <= 120, "Mobile awards intro should stay compact");
  assert.equal(await mobile.locator("[data-award-record-table] [data-if-table-row]").count(), 5, "Mobile DataTables should default to five readable record cards instead of a 25-card wall");
  const mobileAwardTableControls = await mobile.locator("[data-award-record-table] .dbi-data-table__tools .if-btn, [data-award-record-table] .dbi-data-table__columns > summary, [data-award-record-table] .dbi-data-table__footer .if-page-btn, [data-award-record-table] .dbi-data-table__footer .if-select").evaluateAll((nodes) => nodes.filter((node) => getComputedStyle(node).display !== "none").map((node) => node.getBoundingClientRect().height));
  assert.ok(mobileAwardTableControls.every((height) => height >= 43.5), `Mobile DataTable controls should preserve 44px touch targets: ${mobileAwardTableControls.join(", ")}`);
  assert.ok(await mobile.evaluate(() => document.documentElement.scrollHeight) <= 4600, "Mobile Awards should stay within a bounded five-card working surface");
  await assertNoPageOverflow(mobile, "Mobile awards");

  await openSurface(mobile, "#/budget-spend/transactions", "[data-transaction-analytics-page]");
  assert.equal(await mobile.locator("[data-capture-filters] .capture-filter--advanced:visible").count(), 0, "Advanced transaction filters should start collapsed on mobile");
  assert.equal(await mobile.locator("[data-capture-filters] .capture-filter--core-secondary:visible").count(), 0, "Secondary core filters should stay behind disclosure on narrow screens");
  const compactMobileGeometry = await mobile.evaluate(() => ({
    freshnessCount: document.querySelectorAll("[data-freshness-strip]").length,
    firstRowTop: document.querySelector("[data-capture-timeline] .capture-timeline__row")?.getBoundingClientRect().top || 0,
    metricHeight: document.querySelector(".capture-metrics")?.getBoundingClientRect().height || 0,
  }));
  assert.equal(compactMobileGeometry.freshnessCount, 0, "Mobile Transactions should begin with the transaction workspace, not source-health cards");
  assert.ok(compactMobileGeometry.metricHeight <= 56, `Mobile metrics should use a compact horizontal strip, got ${compactMobileGeometry.metricHeight}px`);
  assert.ok(compactMobileGeometry.firstRowTop <= 760, `The first mobile Gantt row should be reachable within one viewport, got ${compactMobileGeometry.firstRowTop}px`);
  await mobile.getByRole("button", { name: "Show 16 more filters" }).click();
  assert.equal(await mobile.locator("[data-capture-filters] .capture-filter--advanced:visible").count(), 16, "All advanced filters should remain reachable");
  assert.equal(await mobile.locator("[data-capture-filters] .capture-filter--core-secondary:visible").count(), 4, "Expanded mobile filters should expose every core dimension including tracking scope");
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
  assert.equal(await mobile.getByRole("button", { name: "Data table" }).count(), 0, "Mobile Transactions must remain Gantt-only");
  assert.equal(await mobile.locator("[data-transaction-data-table]").count(), 0, "Mobile Transactions must not render a DataTable card view");
  await assertNoPageOverflow(mobile, "Mobile transactions");
  await mobile.locator("[data-capture-timeline]").scrollIntoViewIfNeeded();
  await mobile.screenshot({ path: `${OUT_DIR}/transactions-gantt-mobile.png` });

  await openSurface(mobile, "#/budget-spend/analytics", "[data-transaction-d3-page]");
  assert.equal(await mobile.locator("[data-d3-analytics]").count(), 6);
  const compactAnalyticsGeometry = await mobile.evaluate(() => ({
    hero: document.querySelector(".transaction-analytics-hero")?.getBoundingClientRect().height || 0,
    controls: document.querySelector(".analytics-commandbar")?.getBoundingClientRect().height || 0,
    firstChartTop: document.querySelector("[data-d3-analytics]")?.getBoundingClientRect().top || 0,
  }));
  assert.ok(compactAnalyticsGeometry.hero <= 190, `Mobile Analytics hero should stay compact, got ${compactAnalyticsGeometry.hero}px`);
  assert.ok(compactAnalyticsGeometry.controls <= 235, `Mobile Analytics controls should use a search row plus horizontal secondary rail, got ${compactAnalyticsGeometry.controls}px`);
  assert.ok(compactAnalyticsGeometry.firstChartTop <= 590, `Mobile Analytics should surface a chart within the first viewport, got ${compactAnalyticsGeometry.firstChartTop}px`);
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

  await openSurface(mobile, "#/budget-spend/watchlist", "[data-operations-hub]");
  const mobileAdminShellHeight = await mobile.locator("[data-admin-workspace]").evaluate((node) => node.getBoundingClientRect().height);
  assert.ok(mobileAdminShellHeight <= 360, `Mobile Admin control center should stay compact enough to expose working content, got ${mobileAdminShellHeight}px`);
  assert.equal(await mobile.locator(".admin-console__nav a").count(), 4, "Static mobile Admin should keep every browser-local management section in one shell");
  const mobileAdminTargetHeights = await mobile.locator(".admin-console__nav a").evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().height));
  assert.ok(mobileAdminTargetHeights.every((height) => height >= 43.5), `Mobile Admin sections should keep 44px touch targets: ${mobileAdminTargetHeights.join(", ")}`);
  assert.equal(await mobile.locator(".operations-tabs").count(), 0, "Admin pages should not repeat route navigation inside the working surface");
  await assertNoPageOverflow(mobile, "Mobile Admin control center");
  await openSurface(mobile, "#/budget-spend/wallboard", "[data-ops-wallboard]");
  await assertNoPageOverflow(mobile, "Mobile wallboard");
  await mobile.screenshot({ path: `${OUT_DIR}/wallboard-mobile.png`, fullPage: true });

  await openSurface(mobile, "#/budget-spend/sources", "[data-analytics-sources-page]");
  const mobileSourcesHeroHeight = await mobile.locator(".analytics-sources .request-hero").evaluate((node) => node.getBoundingClientRect().height);
  assert.ok(mobileSourcesHeroHeight <= 185, `Mobile Sources should surface lineage without a tall introductory wall, got ${mobileSourcesHeroHeight}px`);
  assert.equal(await mobile.locator("[data-source-flow] .source-flow__step").count(), 6);
  await assertNoPageOverflow(mobile, "Mobile sources");
  await mobile.screenshot({ path: `${OUT_DIR}/analytics-flow-mobile.png`, fullPage: true });

  await mobile.setViewportSize({ width: 360, height: 740 });
  await openSurface(mobile, "#/budget-spend/analytics", "[data-transaction-d3-page]");
  const narrowAnalyticsGeometry = await mobile.evaluate(() => ({
    header: document.querySelector("[data-budget-spend-header]")?.getBoundingClientRect().height || 0,
    hero: document.querySelector(".transaction-analytics-hero")?.getBoundingClientRect().height || 0,
    firstChartTop: document.querySelector("[data-d3-analytics]")?.getBoundingClientRect().top || 0,
  }));
  assert.ok(narrowAnalyticsGeometry.header <= 108, `360px masthead should stay compact while preserving 44px navigation targets, got ${narrowAnalyticsGeometry.header}px`);
  assert.ok(narrowAnalyticsGeometry.hero <= 205, `360px Analytics hero should stay compact, got ${narrowAnalyticsGeometry.hero}px`);
  assert.ok(narrowAnalyticsGeometry.firstChartTop <= 610, `360px Analytics should surface its first chart without a second screen of chrome, got ${narrowAnalyticsGeometry.firstChartTop}px`);
  await assertNoPageOverflow(mobile, "360px Analytics");

  console.log(`Verified ${REMOTE_BASE_URL ? "hosted" : "local"} analytics flow: primary_surfaces=2 grouped_routes=13 analytics_workspaces=4 money_flow_routes=5 admin_routes=4 wallboard=primary watchlist=stable-id events=operator-local integrations=7 api_log=audited request_records>3000 accounts>100 awards>600 opportunities>=875 normalized_source_rows=198 automated_imports>=677 events>=502 fpds_actions=3085 d3_views=19 searchable_facets=8 chart_management=true contextual_hover=true subaward_counts=exact subaward_details=deferred_sample`);
} finally {
  await browser.close();
  if (server) server.kill("SIGTERM");
}
