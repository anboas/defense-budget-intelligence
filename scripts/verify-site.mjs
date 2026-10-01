import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { chromium } from "playwright-core";

const REMOTE_BASE_URL = process.env.BUDGET_VERIFY_URL;
const BASE_URL = REMOTE_BASE_URL ? new URL(REMOTE_BASE_URL).href : "http://127.0.0.1:4188/";
const OUT_DIR = "test-results";
const VERIFY_NOW = "2026-09-13T12:00:00.000Z";
const FORBIDDEN_SURFACE_TEXT = /Decision Briefs|Portfolio Strategy|Pursuit Cockpit|Target execution brief|Target workboard|attention score|win probability|Response Library|Capture Playbooks|Response Assets/i;
mkdirSync(OUT_DIR, { recursive: true });
const compiledScripts = readdirSync("dist/assets").filter((name) => name.endsWith(".js")).map((name) => readFileSync(`dist/assets/${name}`, "utf8")).join("\n");
const builtAssets = readdirSync("dist/assets");
const styleAssets = builtAssets.filter((name) => name.endsWith(".css")).map((name) => ({ name, bytes: readFileSync(`dist/assets/${name}`).byteLength }));
const compiledStyleBytes = styleAssets.reduce((total, asset) => total + asset.bytes, 0);
const shellStyleBytes = styleAssets.find((asset) => /^index-.*\.css$/.test(asset.name))?.bytes || 0;
const mapStyleBytes = styleAssets.find((asset) => /^OpportunityMap-.*\.css$/.test(asset.name))?.bytes || 0;
const connectedEvidenceStyleBytes = styleAssets.find((asset) => /^ConnectedEvidence-.*\.css$/.test(asset.name))?.bytes || 0;
const domainModelStyleBytes = styleAssets.find((asset) => /^DomainModelPage-.*\.css$/.test(asset.name))?.bytes || 0;
const intelligenceProductsStyleBytes = styleAssets.find((asset) => /^IntelligenceProductsPage-.*\.css$/.test(asset.name))?.bytes || 0;
const researchDiscoveryStyleBytes = styleAssets.find((asset) => /^ResearchDiscoveryDashboard-.*\.css$/.test(asset.name))?.bytes || 0;
assert.doesNotMatch(compiledScripts, /Response Library|Capture Playbooks|Response Assets/i, "Compiled application must not import response-development capabilities from reference sites");
assert.ok(shellStyleBytes <= 350_000, `Initial application CSS must stay below 350 KB, got ${shellStyleBytes.toLocaleString()} bytes`);
assert.ok(mapStyleBytes > 0 && mapStyleBytes <= 19_000, `Lazy Opportunity Map CSS must stay within its 19 KB route budget, got ${mapStyleBytes.toLocaleString()} bytes`);
assert.ok(connectedEvidenceStyleBytes > 0 && connectedEvidenceStyleBytes <= 4_000, `Deferred connected-evidence CSS must stay within its 4 KB component budget, got ${connectedEvidenceStyleBytes.toLocaleString()} bytes`);
assert.ok(domainModelStyleBytes > 0 && domainModelStyleBytes <= 8_000, `Lazy Domain Model CSS must stay within its 8 KB route budget, got ${domainModelStyleBytes.toLocaleString()} bytes`);
assert.ok(intelligenceProductsStyleBytes > 0 && intelligenceProductsStyleBytes <= 13_000, `Lazy Organization Intelligence CSS must stay within its 13 KB route budget, got ${intelligenceProductsStyleBytes.toLocaleString()} bytes`);
assert.ok(researchDiscoveryStyleBytes > 0 && researchDiscoveryStyleBytes <= 10_000, `Deferred Discovery Operations CSS must stay within its 10 KB component budget, got ${researchDiscoveryStyleBytes.toLocaleString()} bytes`);
assert.ok(compiledStyleBytes <= 410_000, `Total scoped CSS must stay below 410 KB, got ${compiledStyleBytes.toLocaleString()} bytes`);
assert.equal(builtAssets.some((name) => name.includes("adamboas-hero")), false, "Application builds must not ship the Control Surface example hero asset");
assert.equal(builtAssets.filter((name) => /^BudgetRequestRoutes-.*\.js$/.test(name)).length, 1, "PDB Request, Request History, and Account Flow should ship behind one lazy route boundary");
assert.equal(builtAssets.filter((name) => /^CaptureCalendar-.*\.js$/.test(name)).length, 1, "Transactions should ship behind its own lazy route boundary");
assert.equal(builtAssets.filter((name) => /^SpendExplorer-.*\.js$/.test(name)).length, 1, "Timeline, table, and charts should share one lazy Spend Explorer boundary");
assert.equal(builtAssets.filter((name) => /^OpportunityMap-.*\.js$/.test(name)).length, 1, "Opportunity Map should ship behind its own lazy route boundary");
assert.equal(builtAssets.filter((name) => /^ConnectedEvidence-.*\.js$/.test(name)).length, 1, "Cross-surface evidence should ship behind one shared lazy component boundary");
assert.equal(builtAssets.filter((name) => /^DomainModelPage-.*\.js$/.test(name)).length, 1, "Domain Model should ship behind its own lazy administration boundary");
assert.equal(builtAssets.filter((name) => /^ResearchDiscoveryDashboard-.*\.js$/.test(name)).length, 1, "Discovery Operations should ship behind its own deferred administration boundary");
assert.equal(builtAssets.filter((name) => /^ProfilePage-.*\.js$/.test(name)).length, 1, "Personal account surfaces should ship behind their own lazy route boundary");
assert.equal(builtAssets.filter((name) => /^IntegrationManagement-.*\.js$/.test(name)).length, 1, "Integrations should ship behind its own lazy administration boundary");
assert.equal(builtAssets.filter((name) => /^UserManagement-.*\.js$/.test(name)).length, 1, "User administration should ship behind its own lazy boundary");
assert.equal(builtAssets.filter((name) => /^WorkspaceManagement-.*\.js$/.test(name)).length, 1, "Workspace administration should ship behind its own lazy boundary");

async function waitForServer(url, timeoutMs = 90000) {
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

async function installVerificationDate(page) {
  await page.addInitScript((fixedNow) => {
    const NativeDate = Date;
    const fixedTime = NativeDate.parse(fixedNow);
    window.Date = class extends NativeDate {
      constructor(...args) {
        super(...(args.length ? args : [fixedTime]));
      }

      static now() {
        return fixedTime;
      }
    };
  }, VERIFY_NOW);
}

function resourceCount(page, filename) {
  return page.evaluate((name) => performance.getEntriesByType("resource").filter((entry) => entry.name.endsWith(`/data/${name}`)).length, filename);
}

async function openSurface(page, route, selector) {
  let link = page.locator(`[data-budget-nav="${route}"]:visible`).first();
  if (!await link.count()) {
    if (await page.locator('[data-nav-group-trigger="money"]').isVisible()) {
      const group = ["#/budget-spend", "#/budget-spend/trends", "#/budget-spend/lifecycle", "#/budget-spend/awards", "#/budget-spend/sources"].includes(route) ? "money"
          : ["#/budget-spend/watchlist", "#/budget-spend/tasks"].includes(route) ? "work"
            : ["#/budget-spend/users", "#/budget-spend/workspaces"].includes(route) ? "platform-admin" : "workspace-admin";
      const trigger = page.locator(`[data-nav-group-trigger="${group}"]`);
      if (await trigger.count()) await trigger.click();
    } else {
      await page.locator("[data-mobile-more-menu-button]").click();
    }
    link = page.locator(`[data-budget-nav="${route}"]:visible`).first();
  }
  if (await link.count()) await link.click();
  else await page.evaluate((nextRoute) => { window.location.hash = nextRoute; }, route);
  await page.waitForSelector(selector);
}

async function chooseControlSelect(page, label, option) {
  const trigger = page.getByRole("button", { name: new RegExp(`^${label}:`, "i") }).first();
  await trigger.click();
  await page.getByRole("option", { name: option, exact: true }).click();
}

async function assertNoPageOverflow(page, label) {
  const overflow = await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - window.innerWidth);
  assert.ok(overflow <= 2, `${label} page overflow should be contained, got ${overflow}px`);
}

async function assertButtonIntegrity(page, label, root = "body") {
  const malformed = await page.locator(root).evaluate((node) => [...node.querySelectorAll("button, [role='button'], summary")].filter((control) => {
    const style = getComputedStyle(control);
    const rect = control.getBoundingClientRect();
    if (style.display === "none" || style.visibility === "hidden" || rect.width <= 0 || rect.height <= 0) return false;
    const label = control.getAttribute("aria-label") || control.getAttribute("title") || control.textContent.trim();
    const dataMark = control.matches("[data-timeline-context], [data-analytics-tooltip], svg [role='button']");
    return !label || (!dataMark && (rect.width < 24 || rect.height < 24 || control.scrollHeight > control.clientHeight + 2));
  }).map((control) => {
    const rect = control.getBoundingClientRect();
    return { tag: control.tagName, label: control.getAttribute("aria-label") || control.textContent.trim().replace(/\s+/g, " ").slice(0, 80), width: rect.width, height: rect.height, clientHeight: control.clientHeight, scrollHeight: control.scrollHeight, className: control.className?.baseVal || control.className };
  }));
  assert.deepEqual(malformed, [], `${label} should not render undersized or vertically clipped buttons`);
}

async function assertOpenStateControls(page, label, root = "body") {
  const details = page.locator(`${root} details:visible`);
  const initial = await details.evaluateAll((nodes) => nodes.map((node) => node.open));
  await details.evaluateAll((nodes) => nodes.forEach((node) => { node.open = true; }));
  await assertButtonIntegrity(page, `${label} expanded disclosures`, root);
  const popupTriggers = page.locator(`${root} [aria-haspopup="menu"]:visible, ${root} [aria-haspopup="listbox"]:visible`);
  const triggerCount = Math.min(await popupTriggers.count(), 12);
  for (let index = 0; index < triggerCount; index += 1) {
    const trigger = popupTriggers.nth(index);
    if (!await trigger.isVisible()) continue;
    await trigger.click();
    await assertButtonIntegrity(page, `${label} popup ${index + 1}`);
    await page.keyboard.press("Escape");
  }
  await details.evaluateAll((nodes, states) => nodes.forEach((node, index) => { node.open = states[index]; }), initial);
}

async function assertActiveGroupState(page, group, childLabel) {
  const trigger = page.locator(`[data-nav-group-trigger="${group}"]`);
  await page.mouse.move(0, 0);
  await page.waitForTimeout(160);
  await page.waitForFunction((groupId) => document.querySelector(`[data-nav-group-trigger="${groupId}"]`)?.getAttribute("aria-expanded") === "false", group);
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
  assert.equal(await page.locator(".ci-header-nav > a[data-budget-nav]").count(), 3, "Header should expose Spend Explorer, Opportunity Map, and Schedule as primary links");
  assert.deepEqual(await page.locator(".ci-header-nav > a[data-budget-nav]").allTextContents(), ["Spend Explorer", "Opportunity Map", "Schedule"], "Primary navigation should contain the three consolidated working surfaces");
  assert.equal(await page.getByRole("button", { name: "Search and navigate" }).count(), 1, "The header should expose one global command trigger");
  await page.keyboard.press(process.platform === "darwin" ? "Meta+K" : "Control+K");
  await page.waitForSelector(".if-command-dialog");
  const commandPaletteText = await page.locator(".if-command-dialog").innerText();
  assert.match(commandPaletteText, /Recent[\s\S]*Navigate/i, "The command palette should separate recent and general navigation");
  assert.match(commandPaletteText, /Spend Explorer[\s\S]*Opportunity Map[\s\S]*Schedule/i, "The command palette should expose role-visible primary navigation");
  await page.locator(".if-command-dialog input[type=search]").fill("Source Lineage");
  assert.equal(await page.locator(".if-command-palette__item:visible").count(), 1, "Command search should reduce the visible command set");
  await page.keyboard.press("Escape");
  await page.waitForSelector(".if-command-dialog", { state: "detached" });
  assert.ok(await page.locator("[data-nav-group-trigger]").count() >= 2, "Header should expose money-flow and workspace menus");
  assert.equal(await page.locator("[data-budget-nav-menu]").count(), 0, "Workspace menu should be closed by default");
  if (await page.locator('[data-nav-group-trigger="money"]').isVisible()) {
    assert.equal(await page.locator('[data-nav-group-trigger="money"] .ci-header-nav__menu-trigger-label').innerText(), "Budget & Spend", "Desktop navigation should name the budget domain plainly");
    assert.equal(await page.locator('[data-nav-group-trigger="workspace-admin"] .ci-header-nav__menu-trigger-label').innerText(), "Workspace", "Workspace controls should use one compact navigation label");
    const divider = page.locator(".ci-header-nav__desktop-groups > .if-operations-topnav__divider");
    assert.equal(await divider.count(), 1, "Desktop navigation should separate workspace controls from analytical and money-flow groups");
    assert.equal(await divider.innerText(), "|", "Workspace separator should use the established vertical-bar component");
    const dividerOrder = await page.evaluate(() => {
      const money = document.querySelector('[data-nav-group-trigger="money"]')?.getBoundingClientRect();
      const separator = document.querySelector(".ci-header-nav__desktop-groups > .if-operations-topnav__divider")?.getBoundingClientRect();
      const workspace = document.querySelector('[data-nav-group-trigger="work"]')?.getBoundingClientRect();
      return { moneyRight: money?.right, separatorLeft: separator?.left, separatorRight: separator?.right, workspaceLeft: workspace?.left };
    });
    assert.ok(dividerOrder.moneyRight <= dividerOrder.separatorLeft && dividerOrder.separatorRight <= dividerOrder.workspaceLeft, "Workspace divider should sit between Money flow and Workspace");
    await page.locator('[data-nav-group-trigger="money"]').click();
    assert.equal(await page.locator('[data-budget-nav-menu="money"] a[data-budget-nav]').count(), 5, "Money flow should contain every non-Transactions stage plus lineage");
    assert.match(await page.locator('[data-budget-nav-menu="money"]').innerText(), /PDB Request[\s\S]*Request History[\s\S]*Account Flow[\s\S]*Awards[\s\S]*Source Lineage/i);
    await page.locator('[data-nav-group-trigger="money"]').click();
    await page.locator('[data-nav-group-trigger="work"]').click();
    assert.equal(await page.locator('[data-budget-nav-menu="work"] a[data-budget-nav]').count(), 2, "Workspace should expose supporting work surfaces without primary or administrative surfaces");
    assert.match(await page.locator('[data-budget-nav-menu="work"]').innerText(), /Watchlist[\s\S]*Task Center/i);
    assert.deepEqual(
      await page.locator('[data-budget-nav-menu="work"] a[data-budget-nav]').evaluateAll((links) => links.map((link) => link.getAttribute("href"))),
      ["#/budget-spend/watchlist", "#/budget-spend/tasks"],
      "Schedule views must remain consolidated outside the Work menu",
    );
    await page.locator('[data-nav-group-trigger="work"]').click();
    await page.locator('[data-nav-group-trigger="workspace-admin"]').click();
    assert.ok(await page.locator('[data-budget-nav-menu="workspace-admin"] a[data-budget-nav]').count() >= 1, "Workspace admin should expose consolidated workspace management");
    assert.match(await page.locator('[data-budget-nav-menu="workspace-admin"]').innerText(), /Connections[\s\S]*Domain Model[\s\S]*Intelligence Operations/i);
    await page.locator('[data-nav-group-trigger="workspace-admin"]').click();
  } else {
    await page.locator("[data-mobile-more-menu-button]").click();
    assert.ok(await page.locator("[data-mobile-more-menu] a[data-budget-nav]").count() >= 8, "Mobile navigation should retain money-flow, supporting work, and administration without duplicating primary routes");
    assert.match(await page.locator("[data-mobile-more-menu]").textContent(), /Budget & Spend[\s\S]*Work[\s\S]*Workspace/, "Mobile navigation should keep budget, work, and workspace groups visibly separated");
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
  await installVerificationDate(page);
  let transactionRequests = 0;
  let subawardDetailRequests = 0;
  let budgetRequestRouteRequests = 0;
  let transactionRouteRequests = 0;
  let profileRouteRequests = 0;
  page.on("response", (response) => {
    const filename = new URL(response.url()).pathname.split("/").at(-1) || "";
    if (filename.startsWith("BudgetRequestRoutes")) budgetRequestRouteRequests += 1;
    if (filename.startsWith("CaptureCalendar")) transactionRouteRequests += 1;
    if (filename.startsWith("ProfilePage")) profileRouteRequests += 1;
  });
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

  await page.goto(`${BASE_URL}#/budget-spend/explorer?spendView=today`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("[data-defense-budget-app]");
  await page.waitForSelector("[data-spend-today]");
  assert.equal(await resourceCount(page, "runtime-manifest.json"), 1, "Today should load the compact runtime manifest once");
  assert.equal(await resourceCount(page, "budget-core.json"), 0, "Today should defer the detailed budget request dataset");
  assert.equal(await resourceCount(page, "procurement-feed.json"), 1, "Today should load the compact daily feed exactly once");
  assert.equal(await resourceCount(page, "procurement-discovery.json"), 0, "Today should defer the full discovery index until Table or a saved view requires it");
  assert.equal(budgetRequestRouteRequests, 0, "Today should defer the PDB Request, Request History, and Account Flow route family");
  assert.equal(transactionRouteRequests, 0, "Today should defer the full transaction timeline route");
  assert.equal(profileRouteRequests, 0, "Today should defer personal account surfaces");
  const initialDecodedDataBytes = await page.evaluate(() => performance.getEntriesByType("resource")
    .filter((entry) => entry.name.includes("/data/"))
    .reduce((total, entry) => total + (entry.decodedBodySize || 0), 0));
  assert.ok(initialDecodedDataBytes <= 2_000_000, `Today should stay below a 2 MB decoded initial data payload, got ${initialDecodedDataBytes.toLocaleString()} bytes`);
  assert.equal(await page.locator('[data-spend-explorer="today"] .spend-explorer__tabs .if-tab').count(), 4, "Spend Explorer should expose Brief, Timeline, Table, and Charts");
  assert.equal(await page.locator("[data-spend-saved-views]").count(), 1, "Decision Brief should expose reusable saved acquisition views with unread state");
  assert.equal(await page.locator("[data-acquisition-coverage]").count(), 1, "Decision Brief should expose source coverage and automation behind one disclosure");
  assert.match(await page.locator("[data-decision-brief]").innerText(), /Needs attention[\s\S]*What changed[\s\S]*Due soon[\s\S]*Continue where you left off/i, "Decision Brief should lead with decisions, changes, deadlines, and continuity");
  assert.match(await page.locator("[data-decision-brief]").innerText(), /source issue/i, "Decision Brief should disclose unavailable sources instead of treating them as empty updates");
  await page.locator("[data-spend-saved-views] .spend-saved-views__create-panel > summary").click();
  await page.locator("[data-spend-saved-views] input").fill("AI and autonomy watch");
  await page.locator("[data-spend-saved-views] .spend-saved-views__create button").click();
  assert.match(await page.locator("[data-spend-saved-views]").innerText(), /AI and autonomy watch[\s\S]*No unread changes/i, "Saved acquisition views should retain the current scope and explicit unread state");
  await page.getByRole("button", { name: "Add AI and autonomy watch to favorites" }).click();
  assert.match(await page.locator("[data-spend-saved-views]").innerText(), /AI and autonomy watch[\s\S]*Favorite/i, "Saved views should support a visible favorite state");
  await page.getByRole("button", { name: "Rename saved view AI and autonomy watch" }).click();
  await page.locator(".spend-saved-views__rename input").fill("AI watch");
  await page.getByRole("button", { name: "Save name" }).click();
  await page.getByRole("button", { name: "Duplicate saved view AI watch" }).click();
  assert.match(await page.locator("[data-spend-saved-views]").innerText(), /AI watch copy/i, "Saved views should duplicate without changing the original scope");
  await page.getByRole("button", { name: "Delete saved view AI watch", exact: true }).click();
  await page.getByRole("button", { name: "Delete saved view AI watch copy" }).click();
  assert.equal(await page.locator("[data-active-page-title]").innerText(), "Spend Explorer");
  assert.match(await page.title(), /^Spend Explorer · Defense Budget & Spend Analytics$/);
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

  await page.locator('[data-nav-group-trigger="money"]').click();
  const frameworkMenuContract = await page.evaluate(() => {
    const menu = document.querySelector('[data-budget-nav-menu="money"]');
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
  assert.equal(frameworkMenuContract.menu.width, 280, "Money-flow menu should match the established 280px Control Framework popover");
  assert.equal(frameworkMenuContract.item.width, 262, "Money-flow menu cards should match the established inner width");
  assert.equal(frameworkMenuContract.item.height, 48, "Money-flow menu cards should match the established compact height");
  assert.equal(frameworkMenuContract.item.background, "rgb(255, 255, 255)", "Money-flow menu cards should use the established white surface");
  assert.equal(frameworkMenuContract.item.border, "1px solid rgb(227, 232, 239)", "Money-flow menu cards should use the established divider border");
  assert.equal(frameworkMenuContract.item.padding, "0px 9px", "Money-flow menu cards should match the established horizontal inset");
  assert.equal(frameworkMenuContract.badge.height, 20, "Money-flow count badges should match the established badge component");
  assert.equal(frameworkMenuContract.badge.fontSize, "10.5px", "Money-flow count badges should match the established type scale");
  assert.ok(frameworkMenuContract.description.height >= 27 && frameworkMenuContract.description.height <= 28, "Money-flow card descriptions should use the established two-line treatment");
  await page.screenshot({ path: `${OUT_DIR}/navigation-money-desktop.png` });
  await page.locator('[data-nav-group-trigger="money"]').click();

  const moneyTrigger = page.locator('[data-nav-group-trigger="money"]');
  await moneyTrigger.focus();
  await page.keyboard.press("ArrowDown");
  assert.equal(await moneyTrigger.getAttribute("aria-expanded"), "true", "Arrow Down should open the Money flow menu");
  assert.equal(await page.evaluate(() => document.activeElement?.textContent.includes("PDB Request")), true, "Arrow Down should focus the first Money flow item");
  await page.keyboard.press("ArrowDown");
  assert.equal(await page.evaluate(() => document.activeElement?.textContent.includes("Request History")), true, "Arrow keys should move through Money flow items");
  await page.keyboard.press("Escape");
  assert.equal(await moneyTrigger.getAttribute("aria-expanded"), "false", "Escape should close the Money flow menu");
  assert.equal(await moneyTrigger.evaluate((node) => document.activeElement === node), true, "Escape should return focus to the Money flow trigger");

  await openSurface(page, "#/budget-spend/explorer?spendView=charts", "[data-transaction-d3-page]");
  assert.equal(await page.locator('[data-primary-nav="spend"][aria-current="page"]').count(), 1, "Spend Explorer should remain the active primary route across its views");
  await openSurface(page, "#/budget-spend/sources", "[data-analytics-sources-page]");
  await assertActiveGroupState(page, "money", "Source Lineage");
  await openSurface(page, "#/budget-spend/connections", "[data-connections-surface]");
  await assertActiveGroupState(page, "workspace-admin", "Connections");
  assert.equal(await page.locator("[data-admin-workspace]").count(), 0, "API Log should not repeat a secondary administration shell below global navigation");
  assert.equal(await page.locator('[data-connections-surface] > .if-workbench-header').count(), 1, "Connections should expose one framework-owned workbench header");
  assert.equal(await page.locator('[data-connections-surface] > .if-workbench-header .if-tab').count(), 3, "Connections should consolidate integrations, credentials, and API activity");
  await assertButtonIntegrity(page, "Connections", "[data-connections-surface]");
  await assertOpenStateControls(page, "Connections", "[data-connections-surface]");
  assert.equal(await page.locator('[data-nav-group-trigger="money"] .ci-header-nav__menu-trigger-context').count(), 0, "Inactive Money flow should not show stale child context");
  await page.screenshot({ path: `${OUT_DIR}/navigation-active-admin-desktop.png` });

  await openSurface(page, "#/budget-spend/domain-model", "[data-domain-model-page]");
  await assertActiveGroupState(page, "workspace-admin", "Domain Model");
  assert.equal(await page.locator("[data-domain-diagram]").count(), 1, "Domain Model should expose one integrated architecture diagram");
  assert.equal(await page.locator("[data-domain-diagram-node]").count(), 14, "The architecture diagram should group the graph into fourteen readable domains");
  assert.equal(await page.locator("[data-domain-entity-card]").count(), 83, "Domain Model should inventory every canonical entity type");
  assert.equal(await page.locator("[data-domain-relation-row]").count(), 124, "Domain Model should inventory every canonical relationship type");
  const domainOverviewText = await page.locator("[data-domain-model-page]").innerText();
  assert.match(domainOverviewText, /72,113[\s\S]*typed entities[\s\S]*134,991[\s\S]*evidence relations/i, "Domain Model should disclose canonical graph totals");
  assert.match(domainOverviewText, /120,493[\s\S]*current relations[\s\S]*81[\s\S]*review required/i, "Domain Model should disclose temporal and conflict totals");
  assert.match(domainOverviewText, /Treasury accounts[\s\S]*1,986[\s\S]*Execution balances[\s\S]*7,986[\s\S]*OMB revisions[\s\S]*6,105/i, "Domain Model should disclose exact money lifecycle depth");
  assert.match(domainOverviewText, /Acquisition backbone[\s\S]*Unavailable/i, "Domain Model should disclose the protected SAM source state rather than implying coverage");
  assert.match(domainOverviewText, /Program intelligence[\s\S]*Defense programs[\s\S]*2,723[\s\S]*Page-cited House marks[\s\S]*35/i, "Domain Model should disclose program and page-cited mark coverage");
  assert.match(domainOverviewText, /Official people[\s\S]*Official roles[\s\S]*294[\s\S]*Sourced successions[\s\S]*4/i, "Domain Model should disclose official-role coverage");
  assert.match(domainOverviewText, /Organization intelligence[\s\S]*Prioritized dossiers[\s\S]*100[\s\S]*Open research gaps[\s\S]*254/i, "Domain Model should disclose organization-dossier and research-queue coverage");
  assert.match(domainOverviewText, /Industrial base[\s\S]*Supplier links[\s\S]*1,000[\s\S]*Vendor profiles[\s\S]*235/i, "Domain Model should disclose bounded industrial-base coverage");
  assert.match(domainOverviewText, /Document intelligence[\s\S]*Official documents[\s\S]*57[\s\S]*Exact citations[\s\S]*335/i, "Domain Model should disclose document intelligence coverage");
  await page.getByRole("button", { name: /Evidence & provenance/ }).click();
  assert.equal(await page.locator("[data-domain-entity-card]").count(), 3, "Domain filters should focus the inventory without changing graph facts");
  await page.getByRole("button", { name: /All domains/ }).click();
  assert.equal(await page.locator("[data-domain-entity-card]").count(), 83, "All domains should restore the complete entity inventory");
  await assertNoPageOverflow(page, "Domain Model desktop");
  await page.screenshot({ path: `${OUT_DIR}/domain-model-desktop.png`, fullPage: true });

  await openSurface(page, "#/budget-spend/intelligence", "[data-intelligence-products-page]");
  await assertActiveGroupState(page, "workspace-admin", "Intelligence Operations");
  assert.equal(await resourceCount(page, "roadmap-intelligence.json"), 1, "Intelligence Operations should load its bounded route artifact once");
  assert.equal(await resourceCount(page, "organization-intelligence.json"), 1, "Organization Intelligence should load its bounded dossier artifact once");
  assert.equal(await resourceCount(page, "organization-change-monitor.json"), 1, "Organization Watch should load its bounded monitoring artifact once");
  const intelligenceText = await page.locator("[data-intelligence-products-page]").innerText();
  assert.match(intelligenceText, /100[\s\S]*organization dossiers[\s\S]*294[\s\S]*official roles[\s\S]*1,000[\s\S]*supplier links[\s\S]*57[\s\S]*official documents[\s\S]*335[\s\S]*exact citations/i, "Intelligence Operations should disclose core evidence totals");
  assert.equal(await page.locator("[data-organization-intelligence-panel]").count(), 1, "Organization Intelligence should be the primary research surface");
  await page.locator("[data-organization-dossier-link]").first().click();
  await page.locator("[data-organization-dossier]").waitFor({ state: "attached" });
  const dossierText = await page.locator("[data-organization-dossier]").innerText();
  assert.match(dossierText, /People and tenure[\s\S]*Mission and authority[\s\S]*Financial evidence[\s\S]*Programs and awards[\s\S]*Research queue[\s\S]*Source register/i, "Full organization dossiers should unify people, mission, finance, portfolio, gaps, and sources");
  assert.match(page.url(), /organization=organization-dossier%3A/, "Organization dossiers should own a durable reloadable route");
  await page.screenshot({ path: `${OUT_DIR}/organization-dossier-desktop.png`, fullPage: true });
  await page.getByRole("button", { name: "People & tenure" }).click();
  const peopleIntelligenceText = await page.locator("[data-official-people-panel]").innerText();
  assert.match(peopleIntelligenceText, /Official people and role tenure/i, "Intelligence Operations should expose public professional tenure");
  assert.match(peopleIntelligenceText, /Ross R\. Guckert/i, "Intelligence Operations should retain historical public roleholders");
  assert.match(peopleIntelligenceText, /William Hepworth/i, "Intelligence Operations should expose successor roleholders");
  await page.getByRole("button", { name: "Organization watch" }).click();
  assert.equal(await page.locator("[data-organization-watch-panel]").count(), 1, "Organization Watch should expose its source registry and proposal queue");
  assert.equal(await page.locator("[data-organization-monitor-source]").count(), 10, "Organization Watch should retain every monitored official source");
  assert.equal(await page.locator("[data-organization-watch-clear]").count(), 1, "An unchanged baseline should disclose that no source changes are pending");
  assert.match(await page.locator("[data-organization-watch-panel]").innerText(), /missing listing never ends a tenure[\s\S]*cannot overwrite a dossier until reviewed/i, "Organization Watch should disclose its fail-closed review policy");
  await page.getByRole("button", { name: "Discovery ops" }).click();
  await page.waitForSelector('[data-research-discovery-dashboard][data-research-discovery-state="primary-only"]');
  assert.match(await page.locator("[data-research-discovery-dashboard]").innerText(), /Server-side operations live on Cloudflare[\s\S]*primary authenticated application/i, "The static fallback must direct operators to the authenticated research runtime without simulating run state");
  await page.getByRole("button", { name: "Industrial base" }).click();
  assert.equal(await page.locator("[data-industrial-base-panel]").count(), 1, "Industrial-base evidence should be available on demand");
  await page.getByRole("button", { name: "Accountability" }).click();
  assert.equal(await page.locator("[data-accountability-panel]").count(), 1, "Accountability evidence should be available on demand");
  await page.getByRole("button", { name: "Documents" }).click();
  assert.equal(await page.locator("[data-document-intelligence-panel]").count(), 1, "Document intelligence should be available on demand");
  await page.getByRole("button", { name: "Operational products" }).click();
  assert.match(await page.locator("[data-operational-products-panel]").innerText(), /8 templates[\s\S]*5 briefs[\s\S]*review before send/i, "Operational products should expose reusable queries and review-before-send briefs");
  await assertNoPageOverflow(page, "Intelligence Operations desktop");
  await page.screenshot({ path: `${OUT_DIR}/intelligence-operations-desktop.png`, fullPage: true });

  await openSurface(page, "#/budget-spend/map", "[data-opportunity-map]");
  assert.equal(await page.locator("[data-active-page-title]").innerText(), "Opportunity Map", "Opportunity Map should own a first-class route title");
  assert.equal(await page.locator('[data-primary-nav="map"][aria-current="page"]').count(), 1, "Opportunity Map should own a primary-navigation state");
  assert.equal(await resourceCount(page, "opportunity-map-data.json"), 1, "Opportunity Map should load one map-specific factual payload");
  assert.equal(await resourceCount(page, "opportunity-map-location-metadata.json"), 0, "Detailed location metadata should stay deferred until a user opens a location");
  const mapEvidenceCounts = await page.locator("[data-opportunity-map]").evaluate((node) => ({
    sourceRecords: Number(node.dataset.mapSourceRecords || 0),
    sourceLocations: Number(node.dataset.mapSourceLocations || 0),
    visibleLocations: Number(node.dataset.mapVisibleLocations || 0),
    mappedRecords: Number(node.dataset.mapMappedRecords || 0),
    exactOfficeRecords: Number(node.dataset.mapExactOfficeRecords || 0),
    visibleSpend: Number(node.dataset.mapVisibleSpend || 0),
  }));
  assert.ok(mapEvidenceCounts.sourceRecords >= 875, `Map-specific evidence should retain the complete indexed corpus: ${JSON.stringify(mapEvidenceCounts)}`);
  assert.equal(mapEvidenceCounts.sourceLocations, 885, `The authoritative location layer should retain all 885 supplied geographic entities: ${JSON.stringify(mapEvidenceCounts)}`);
  assert.ok(mapEvidenceCounts.visibleLocations >= 800, `The default atlas should expose the nationwide location layer, less locations replaced by spend hubs: ${JSON.stringify(mapEvidenceCounts)}`);
  assert.ok(mapEvidenceCounts.mappedRecords >= 240, `Exact award-detail enrichment should map at least 240 live records: ${JSON.stringify(mapEvidenceCounts)}`);
  assert.ok(mapEvidenceCounts.exactOfficeRecords >= 220, `The live map should be primarily backed by exact award-detail offices: ${JSON.stringify(mapEvidenceCounts)}`);
  assert.ok(mapEvidenceCounts.visibleSpend >= 200_000_000_000, `The live map should expose more than $200B of directly observed obligations: ${JSON.stringify(mapEvidenceCounts)}`);
  assert.ok(await page.locator('.opportunity-map__marker[role="button"]').count() >= 8, "Default live scope should expose a nationwide set of mapped organization clusters");
  const defaultLocationDotCount = await page.locator(".opportunity-map__location").count();
  assert.ok(defaultLocationDotCount >= 800, `Default live scope should render the authoritative nationwide location layer, got ${defaultLocationDotCount}`);
  assert.ok(await page.locator('.opportunity-map__marker.is-cluster[role="button"]').count() >= 1, "Nearby offices should consolidate into numbered national-scale groups");
  const nationalCalloutCount = await page.locator('.opportunity-map__callout[role="button"]').count();
  assert.ok(nationalCalloutCount >= 6 && nationalCalloutCount <= 8, `National view should expose a useful but bounded set of ranked callouts, got ${nationalCalloutCount}`);
  const calloutGeometry = await page.evaluate(() => {
    const canvas = document.querySelector("[data-opportunity-map-canvas]")?.getBoundingClientRect();
    const callouts = [...document.querySelectorAll("[data-map-callout]")];
    const cards = callouts.map((node) => node.querySelector(".opportunity-map__callout-face").getBoundingClientRect());
    const visibleActivityBounds = [...document.querySelectorAll("[data-map-node]")]
      .map((node) => node.getBoundingClientRect())
      .filter((bounds) => {
        const centerX = bounds.left + bounds.width / 2;
        const centerY = bounds.top + bounds.height / 2;
        return centerX >= canvas.left && centerX <= canvas.right && centerY >= canvas.top && centerY <= canvas.bottom;
      });
    const overlaps = cards.flatMap((left, index) => cards.slice(index + 1).filter((right) => left.left < right.right && left.right > right.left && left.top < right.bottom && left.bottom > right.top));
    const priorities = callouts.map((node) => Number(node.dataset.mapCalloutPriority));
    const leaderLengths = callouts.map((node) => Number(node.dataset.mapCalloutLeaderLength));
    return {
      withinCanvas: cards.every((card) => card.left >= canvas.left && card.right <= canvas.right && card.top >= canvas.top && card.bottom <= canvas.bottom),
      overlaps: overlaps.length,
      prioritiesDescending: priorities.every((value, index) => index === 0 || priorities[index - 1] >= value),
      maximumLeaderLength: Math.max(...leaderLengths),
      strictClearanceCount: callouts.filter((node) => node.dataset.mapCalloutClearance === "all").length,
      cardsAvoidActivityMarkers: cards.every((card) => visibleActivityBounds.every((node) => card.right <= node.left || card.left >= node.right || card.bottom <= node.top || card.top >= node.bottom)),
    };
  });
  assert.equal(calloutGeometry.withinCanvas, true, "National callout cards should stay within the map canvas");
  assert.equal(calloutGeometry.overlaps, 0, "National callout cards should use collision-safe columns without overlap");
  assert.equal(calloutGeometry.prioritiesDescending, true, `National callouts should preserve magnitude-led priority order after collision backfill: ${JSON.stringify(calloutGeometry)}`);
  assert.ok(calloutGeometry.maximumLeaderLength <= 190, `National callout leaders must remain local instead of spanning the map: ${JSON.stringify(calloutGeometry)}`);
  assert.ok(calloutGeometry.strictClearanceCount >= 1, `National placement should use full source-node clearance wherever geometry permits: ${JSON.stringify(calloutGeometry)}`);
  assert.equal(calloutGeometry.cardsAvoidActivityMarkers, true, `National callout cards must never cover visible activity markers: ${JSON.stringify(calloutGeometry)}`);
  await page.locator('.opportunity-map__marker.is-cluster[role="button"]').first().click();
  await page.waitForFunction(() => Number.parseInt(document.querySelector('.opportunity-map__map-controls output')?.textContent || "100", 10) > 200);
  await page.waitForTimeout(350);
  const focusedCalloutGeometry = await page.evaluate(() => {
    const canvas = document.querySelector("[data-opportunity-map-canvas]")?.getBoundingClientRect();
    const markers = [...document.querySelectorAll("[data-map-node]")];
    const callouts = [...document.querySelectorAll("[data-map-callout]")];
    const visibleNodeBounds = [...document.querySelectorAll("[data-map-node], [data-map-location]")]
      .map((node) => node.getBoundingClientRect())
      .filter((bounds) => {
        const centerX = bounds.left + bounds.width / 2;
        const centerY = bounds.top + bounds.height / 2;
        return centerX >= canvas.left && centerX <= canvas.right && centerY >= canvas.top && centerY <= canvas.bottom;
      });
    return {
      count: callouts.length,
      allTargetsVisible: callouts.every((callout) => {
        const marker = callout.dataset.mapCalloutKind === "location"
          ? document.querySelector(`[data-map-location="${CSS.escape(callout.dataset.mapCallout.replace(/^location:/, ""))}"]`)
          : markers.find((candidate) => candidate.dataset.mapNode === callout.dataset.mapCallout);
        const bounds = marker?.getBoundingClientRect();
        if (!bounds) return false;
        const centerX = bounds.left + bounds.width / 2;
        const centerY = bounds.top + bounds.height / 2;
        return centerX >= canvas.left && centerX <= canvas.right && centerY >= canvas.top && centerY <= canvas.bottom;
      }),
      cardsWithinCanvas: callouts.every((callout) => {
        const bounds = callout.querySelector(".opportunity-map__callout-face")?.getBoundingClientRect();
        return bounds && bounds.left >= canvas.left && bounds.right <= canvas.right && bounds.top >= canvas.top && bounds.bottom <= canvas.bottom;
      }),
      duplicateTargetLabels: callouts.filter((callout) => markers.find((candidate) => candidate.dataset.mapNode === callout.dataset.mapCallout)?.querySelector(".opportunity-map__marker-label")).length,
      maximumLeaderLength: Math.max(...callouts.map((callout) => Number(callout.dataset.mapCalloutLeaderLength))),
      closestCalloutDistance: Math.min(...callouts.map((callout) => Number(callout.dataset.mapCalloutCenterDistance))),
      cardsAvoidAllNodes: callouts.every((callout) => {
        const card = callout.querySelector(".opportunity-map__callout-face")?.getBoundingClientRect();
        return card && visibleNodeBounds.every((node) => card.right <= node.left || card.left >= node.right || card.bottom <= node.top || card.top >= node.bottom);
      }),
      strictClearance: callouts.every((callout) => callout.dataset.mapCalloutClearance === "all"),
    };
  });
  assert.ok(focusedCalloutGeometry.count >= 1, `Focused map views should repopulate callouts from visible activity nodes: ${JSON.stringify(focusedCalloutGeometry)}`);
  assert.equal(focusedCalloutGeometry.allTargetsVisible, true, `Focused callouts must target nodes inside the current viewport: ${JSON.stringify(focusedCalloutGeometry)}`);
  assert.equal(focusedCalloutGeometry.cardsWithinCanvas, true, `Focused callout cards must remain inside the current canvas: ${JSON.stringify(focusedCalloutGeometry)}`);
  assert.equal(focusedCalloutGeometry.duplicateTargetLabels, 0, `Callouts should be the sole label owner for their focused nodes: ${JSON.stringify(focusedCalloutGeometry)}`);
  assert.ok(focusedCalloutGeometry.maximumLeaderLength <= 165, `Focused callout leaders must stay local to their targets: ${JSON.stringify(focusedCalloutGeometry)}`);
  assert.ok(focusedCalloutGeometry.closestCalloutDistance <= .35, `Focused callouts should prioritize at least one target near the viewport center: ${JSON.stringify(focusedCalloutGeometry)}`);
  assert.equal(focusedCalloutGeometry.cardsAvoidAllNodes, true, `Focused callout cards must not block visible activity or source-location nodes: ${JSON.stringify(focusedCalloutGeometry)}`);
  assert.equal(focusedCalloutGeometry.strictClearance, true, `Focused callouts must use strict clearance from every visible node: ${JSON.stringify(focusedCalloutGeometry)}`);
  await page.screenshot({ path: `${OUT_DIR}/opportunity-map-focused-desktop.png`, fullPage: false });
  for (let index = 0; index < 5; index += 1) {
    await page.getByRole("button", { name: "Zoom in" }).click();
    await page.waitForTimeout(190);
  }
  const maximumZoomGeometry = await page.evaluate(() => {
    const canvas = document.querySelector("[data-opportunity-map-canvas]")?.getBoundingClientRect();
    const callouts = [...document.querySelectorAll("[data-map-callout]")];
    const visibleNodeBounds = [...document.querySelectorAll("[data-map-node], [data-map-location]")]
      .map((node) => node.getBoundingClientRect())
      .filter((bounds) => {
        const centerX = bounds.left + bounds.width / 2;
        const centerY = bounds.top + bounds.height / 2;
        return centerX >= canvas.left && centerX <= canvas.right && centerY >= canvas.top && centerY <= canvas.bottom;
      });
    const cards = callouts.map((node) => node.querySelector(".opportunity-map__callout-face")?.getBoundingClientRect()).filter(Boolean);
    return {
      zoom: Number.parseInt(document.querySelector(".opportunity-map__map-controls output")?.textContent || "0", 10),
      callouts: callouts.length,
      cardsAvoidAllNodes: cards.every((card) => visibleNodeBounds.every((node) => card.right <= node.left || card.left >= node.right || card.bottom <= node.top || card.top >= node.bottom)),
      strictClearance: callouts.every((callout) => callout.dataset.mapCalloutClearance === "all"),
    };
  });
  assert.ok(maximumZoomGeometry.zoom >= 1_000 && maximumZoomGeometry.zoom <= 1_200, `The map should support a deeper but bounded maximum zoom: ${JSON.stringify(maximumZoomGeometry)}`);
  assert.ok(maximumZoomGeometry.callouts >= 1, `Maximum zoom should retain locally relevant callouts when visible nodes permit placement: ${JSON.stringify(maximumZoomGeometry)}`);
  assert.equal(maximumZoomGeometry.cardsAvoidAllNodes, true, `Maximum-zoom callout cards must avoid every visible map node: ${JSON.stringify(maximumZoomGeometry)}`);
  assert.equal(maximumZoomGeometry.strictClearance, true, `Maximum-zoom callouts must use strict all-node clearance: ${JSON.stringify(maximumZoomGeometry)}`);
  await page.screenshot({ path: `${OUT_DIR}/opportunity-map-maximum-zoom-desktop.png`, fullPage: false });
  await page.getByRole("button", { name: "Fit United States" }).click();
  await page.waitForFunction(() => document.querySelector('.opportunity-map__map-controls output')?.textContent === "100%");
  await page.waitForTimeout(250);
  const westCoastTarget = await page.locator('[data-map-location="ntad-690"]').boundingBox();
  await page.mouse.move(westCoastTarget.x + westCoastTarget.width / 2, westCoastTarget.y + westCoastTarget.height / 2);
  for (let index = 0; index < 4; index += 1) await page.mouse.wheel(0, -420);
  await page.waitForFunction(() => Number.parseInt(document.querySelector('.opportunity-map__map-controls output')?.textContent || "100", 10) >= 350);
  await page.waitForTimeout(350);
  const locationCalloutGeometry = await page.evaluate(() => {
    const canvas = document.querySelector("[data-opportunity-map-canvas]")?.getBoundingClientRect();
    const callouts = [...document.querySelectorAll('[data-map-callout-kind="location"]')];
    return {
      count: callouts.length,
      allTargetsVisible: callouts.every((callout) => {
        const id = callout.dataset.mapCallout.replace(/^location:/, "");
        const target = document.querySelector(`[data-map-location="${CSS.escape(id)}"]`)?.getBoundingClientRect();
        if (!target) return false;
        const centerX = target.left + target.width / 2;
        const centerY = target.top + target.height / 2;
        return centerX >= canvas.left && centerX <= canvas.right && centerY >= canvas.top && centerY <= canvas.bottom;
      }),
    };
  });
  assert.ok(locationCalloutGeometry.count >= 4, `Focused views without nearby spend hubs should call out visible authoritative locations: ${JSON.stringify(locationCalloutGeometry)}`);
  assert.equal(locationCalloutGeometry.allTargetsVisible, true, `Location callouts must target source locations in the current viewport: ${JSON.stringify(locationCalloutGeometry)}`);
  await page.locator('[data-map-callout-kind="location"] .opportunity-map__callout-face').first().click();
  await page.waitForSelector("[data-opportunity-map-location-detail]");
  await page.waitForSelector("[data-location-metadata-profile]");
  assert.equal(await resourceCount(page, "opportunity-map-location-metadata.json"), 1, "Opening a source location should load the metadata sidecar exactly once");
  assert.equal(await page.locator("[data-location-metadata-pass]").count(), 6, "Location details should expose all six structured metadata passes");
  assert.match(await page.locator("[data-opportunity-map-location-detail]").innerText(), /Metadata passes[\s\S]*Identity[\s\S]*Operating status[\s\S]*Acquisition[\s\S]*Financial[\s\S]*Evidence and provenance/i, "Location details should expose structured identity, status, acquisition, financial, and provenance context");
  assert.equal(await page.locator("[data-location-metadata-provenance] a").getAttribute("href").then((href) => /^https?:\/\//.test(href)), true, "Location metadata provenance should retain a safe primary-source link");
  await page.screenshot({ path: `${OUT_DIR}/opportunity-map-location-metadata.png`, fullPage: false });
  await page.getByRole("button", { name: "Close authoritative location" }).click();
  await page.getByRole("button", { name: "Fit United States" }).click();
  await page.waitForFunction(() => document.querySelector('.opportunity-map__map-controls output')?.textContent === "100%");
  await page.waitForTimeout(250);
  assert.ok(await page.locator('.opportunity-map__marker.is-cluster .opportunity-map__marker-segments path').count() >= 2, "Grouped map nodes should expose service-composition ring segments instead of undifferentiated bubbles");
  assert.equal(await page.locator('.opportunity-map__callout-accent').count(), nationalCalloutCount, "Every bounded national callout should carry a service-aware accent stripe");
  const serviceLegendButtons = page.locator('[data-opportunity-map-legend] button');
  assert.equal(await serviceLegendButtons.count(), 10, "The map legend should expose All plus every authoritative service category");
  const allServiceLegendText = (await serviceLegendButtons.first().innerText()).replace(/\s+/g, " ").trim();
  const navyServiceLegendText = (await page.locator('[data-opportunity-map-legend] button', { hasText: /^Navy/ }).innerText()).replace(/\s+/g, " ").trim();
  assert.match(allServiceLegendText, /^All \(\d+\)$/i, "The All-services legend pill should disclose its current marker count compactly");
  assert.match(navyServiceLegendText, /^Navy \(\d+\)$/i, "Every service legend pill should disclose its current marker count");
  const atlasPrimitiveStyles = await page.evaluate(() => ({
    clusterFace: getComputedStyle(document.querySelector('.opportunity-map__marker.is-cluster .opportunity-map__marker-core')).fill,
    markerShell: getComputedStyle(document.querySelector('.opportunity-map__marker-shell')).fill,
    calloutFace: getComputedStyle(document.querySelector('.opportunity-map__callout-face')).fill,
  }));
  assert.equal(atlasPrimitiveStyles.clusterFace, "rgb(23, 53, 76)", "Grouped nodes should use the reference atlas navy face beneath service segments");
  assert.match(atlasPrimitiveStyles.markerShell, /rgba?\(255, 255, 255/, "Map nodes should use a crisp white shell rather than a diffuse color glow");
  assert.match(atlasPrimitiveStyles.calloutFace, /rgba?\(255, 255, 255/, "Callouts should use a restrained white atlas card surface");
  const mapSvg = page.locator('[data-opportunity-map-canvas] > svg');
  assert.equal(await mapSvg.getAttribute("aria-label"), "United States contracting activity map", "The map canvas should retain an accessible name without a native tooltip owner");
  assert.equal(await mapSvg.locator("title").count(), 0, "The map SVG must not expose an ancestor title tooltip that competes with node hover cards");
  assert.equal(await page.locator('[data-opportunity-map-canvas] [title]').count(), 0, "Map targets with rich hover cards must not also expose native title tooltips");
  assert.equal(await page.locator("[data-opportunity-map-detail]").count(), 0, "The organization inspector should stay closed until a user selects a reviewed location");
  assert.equal(await page.locator(".opportunity-map__control-row--secondary").count(), 0, "Advanced map filters should stay collapsed until requested");
  const defaultMapGeometry = await page.evaluate(() => ({
    commandHeight: document.querySelector(".opportunity-map__command-band")?.getBoundingClientRect().height || 0,
    canvasTop: document.querySelector("[data-opportunity-map-canvas]")?.getBoundingClientRect().top || 0,
    canvasHeight: document.querySelector("[data-opportunity-map-canvas]")?.getBoundingClientRect().height || 0,
    legendOverflow: (() => { const legend = document.querySelector("[data-opportunity-map-legend]"); return legend ? legend.scrollWidth - legend.clientWidth : 0; })(),
  }));
  assert.ok(defaultMapGeometry.commandHeight <= 100, `Opportunity Map title, filters, tools, and legend should share one compact command band, got ${defaultMapGeometry.commandHeight}px`);
  assert.equal(defaultMapGeometry.legendOverflow, 0, `Service pills should wrap without a horizontal scrollbar: ${JSON.stringify(defaultMapGeometry)}`);
  assert.ok(defaultMapGeometry.canvasTop <= 255, `Desktop geography should begin within the first 255px, got ${defaultMapGeometry.canvasTop}px`);
  assert.ok(defaultMapGeometry.canvasHeight >= 719, `Desktop geography should provide the requested tall analytical canvas, got ${defaultMapGeometry.canvasHeight}px`);
  const mapCanvasBounds = await page.locator("[data-opportunity-map-canvas]").boundingBox();
  await page.evaluate(() => {
    window.__mapLongTasks = [];
    new PerformanceObserver((list) => window.__mapLongTasks.push(...list.getEntries().map((entry) => entry.duration))).observe({ entryTypes: ["longtask"] });
  });
  await page.mouse.move(mapCanvasBounds.x + mapCanvasBounds.width / 2, mapCanvasBounds.y + mapCanvasBounds.height / 2);
  for (let index = 0; index < 12; index += 1) await page.mouse.wheel(0, index % 2 ? 180 : -180);
  await page.waitForTimeout(300);
  const mapLongTasks = await page.evaluate(() => window.__mapLongTasks || []);
  assert.ok(mapLongTasks.length <= 2 && mapLongTasks.reduce((total, duration) => total + duration, 0) < 200, `Map wheel interactions should stay out of repeated React long tasks: ${JSON.stringify(mapLongTasks)}`);
  assert.match(await page.locator(".opportunity-map__coverage").innerText(), /source locations[\s\S]*mapped activities[\s\S]*activity locations unresolved/i, "The map should disclose geographic, mapped-activity, and unresolved-activity coverage");
  await page.locator('.opportunity-map__marker[role="button"]').last().hover();
  assert.match(await page.locator(".opportunity-map__tooltip").innerText(), /records[\s\S]*(active|upcoming)/i, "Map markers should expose immediate spend and lifecycle context on hover");
  assert.equal(await page.locator('.opportunity-map__tooltip[role="tooltip"]').count(), 1, "A map node should own exactly one hover surface");
  const nearbyGroups = page.getByRole("button", { name: "Nearby groups" });
  await nearbyGroups.click();
  await page.waitForFunction(() => new URLSearchParams(window.location.hash.split("?")[1] || "").get("mapClusters") === "off");
  assert.equal(await page.locator('.opportunity-map__marker.is-cluster[role="button"]').count(), 0, "Nearby grouping toggle should reveal reviewed locations individually");
  await nearbyGroups.click();
  await page.waitForFunction(() => !window.location.hash.includes("mapClusters="));
  await page.locator('.opportunity-map__status-tabs button', { hasText: "Active" }).click();
  await page.waitForFunction(() => new URLSearchParams(window.location.hash.split("?")[1] || "").get("mapStatus") === "active");
  assert.equal(await page.locator(".opportunity-map__location").count(), defaultLocationDotCount, "Lifecycle filters should change activity without redefining authoritative geographic coverage");
  await page.locator('.opportunity-map__status-tabs button', { hasText: "Live" }).click();
  await page.waitForFunction(() => !window.location.hash.includes("mapStatus="));
  await page.getByRole("button", { name: "Spend-backed", exact: true }).click();
  await page.waitForFunction(() => new URLSearchParams(window.location.hash.split("?")[1] || "").get("mapEvidence") === "spend");
  assert.equal(await page.locator(".opportunity-map__location").count(), 0, "Spend-backed evidence mode should isolate activity hubs from the base location layer");
  assert.ok(await page.locator('.opportunity-map__marker[role="button"]').count() >= 8, "Spend-backed evidence mode should retain mapped activity hubs");
  await page.getByRole("button", { name: "No linked spend", exact: true }).click();
  await page.waitForFunction(() => new URLSearchParams(window.location.hash.split("?")[1] || "").get("mapEvidence") === "unbacked");
  assert.equal(await page.locator('.opportunity-map__marker[role="button"]').count(), 0, "No-linked-spend mode should remove spend activity overlays");
  assert.equal(await page.locator(".opportunity-map__location").count(), defaultLocationDotCount, "No-linked-spend mode should retain locations without an established spend relationship");
  await page.getByRole("button", { name: "All locations", exact: true }).click();
  await page.waitForFunction(() => !window.location.hash.includes("mapEvidence="));
  const navyLegend = page.locator('[data-opportunity-map-legend] button', { hasText: /^Navy \(/ });
  const armyLegend = page.locator('[data-opportunity-map-legend] button', { hasText: /^Army \(/ });
  await navyLegend.click();
  await page.waitForFunction(() => new URLSearchParams(window.location.hash.split("?")[1] || "").get("mapBranch") === "navy");
  await armyLegend.click();
  await page.waitForFunction(() => new URLSearchParams(window.location.hash.split("?")[1] || "").get("mapBranch") === "army,navy");
  assert.equal(await navyLegend.getAttribute("aria-pressed"), "true", "Legend pills should retain Navy in a multi-service selection");
  assert.equal(await armyLegend.getAttribute("aria-pressed"), "true", "Legend pills should add Army without clearing Navy");
  assert.equal(await page.locator('[data-opportunity-map-legend] button').first().getAttribute("aria-pressed"), "false", "All services should clear while specific services are selected");
  await navyLegend.click();
  await page.waitForFunction(() => new URLSearchParams(window.location.hash.split("?")[1] || "").get("mapBranch") === "army");
  await page.locator('[data-opportunity-map-legend] button').first().click();
  await page.waitForFunction(() => !window.location.hash.includes("mapBranch="));
  await page.getByRole("button", { name: "Find" }).click();
  await page.locator("[data-opportunity-map-directory] input").fill("Missile Defense");
  const missileDefenseHub = page.locator(".opportunity-map__directory-results button", { hasText: "Spend-backed hub" }).filter({ hasText: "Missile Defense Agency" });
  assert.equal(await missileDefenseHub.count(), 1, "The location directory should distinguish the reviewed spend hub from geographic source results");
  await missileDefenseHub.click();
  await page.waitForSelector("[data-opportunity-map-detail]");
  assert.match(await page.locator("[data-opportunity-map-detail]").innerText(), /Missile Defense Agency[\s\S]*(exact award-detail offices|reviewed published-office registry match)/i, "Directory selection should open an evidence-labeled organization inspector");
  assert.ok(await page.locator(".opportunity-map__detail-metrics dd").count() >= 4, "Organization detail should expose spend, organization, active, and upcoming metrics");
  assert.equal(new URLSearchParams((await page.evaluate(() => window.location.hash)).split("?")[1] || "").get("mapOrg"), "huntsville", "Directory selection should persist the reviewed location in the canonical map URL");
  await page.getByRole("button", { name: "Close joint / fourth estate" }).click();
  await page.getByRole("button", { name: "Evidence" }).click();
  assert.match(await page.locator("[data-opportunity-map-evidence]").innerText(), /Coverage and placement[\s\S]*exact award-detail observations[\s\S]*records remain unresolved/i, "Evidence drawer should disclose exact-office coverage and unresolved records");
  await page.getByRole("button", { name: "Close map evidence" }).click();
  await page.getByRole("button", { name: /^Filters/ }).click();
  assert.equal(await page.locator(".opportunity-map__control-row--secondary").count(), 1, "Filters control should reveal the advanced map dimensions on demand");
  await page.getByRole("button", { name: /^Service:/ }).click();
  const serviceMenu = page.locator('[data-if-picker-menu]');
  assert.match(await serviceMenu.getByRole("option", { name: /^All services \(\d+\)$/ }).innerText(), /^All services \(\d+\)$/i, "Service dropdown should show the All-services population in parentheses");
  assert.match(await serviceMenu.getByRole("option", { name: /^Marine Corps \(\d+\)$/ }).innerText(), /^Marine Corps \(\d+\)$/i, "Service dropdown should show each category population in parentheses");
  await page.keyboard.press("Escape");
  await chooseControlSelect(page, "Size by", "Nothing (uniform markers)");
  await page.waitForFunction(() => new URLSearchParams(window.location.hash.split("?")[1] || "").get("mapSpend") === "none");
  assert.equal(await page.getByRole("button", { name: /^Minimum:/ }).isDisabled(), true, "Minimum spend should disable when marker sizing is not spend-based");
  const uniformRadii = await page.locator('.opportunity-map__marker:not(.is-cluster) .opportunity-map__marker-core').evaluateAll((nodes) => [...new Set(nodes.map((node) => Number(node.getAttribute("r") || 0).toFixed(3)))]);
  assert.equal(uniformRadii.length, 1, `None size mode should render uniform individual marker radii: ${JSON.stringify(uniformRadii)}`);
  await page.getByRole("button", { name: "Fit United States" }).click();
  await page.waitForSelector('.opportunity-map__callout-meta');
  assert.doesNotMatch(await page.locator('.opportunity-map__callout-meta').first().textContent(), /\$/i, "Uniform-size callouts should lead with record evidence rather than a sizing value");
  await chooseControlSelect(page, "Size by", "Potential value");
  await page.waitForFunction(() => new URLSearchParams(window.location.hash.split("?")[1] || "").get("mapSpend") === "potential");
  await page.locator('.opportunity-map__search input').fill("MISSILE DEFENSE AGENCY (MDA)");
  await page.waitForFunction(() => document.querySelectorAll('.opportunity-map__marker[role="button"]').length === 1);
  assert.match(await page.locator('.opportunity-map__marker[role="button"]').getAttribute("aria-label"), /Missile Defense Agency/i, "Search should cross-filter the map and marker evidence together at any zoom level");
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector("[data-opportunity-map]");
  assert.equal(await page.locator('.opportunity-map__search input').inputValue(), "MISSILE DEFENSE AGENCY (MDA)", "Map filters should survive reload through canonical URL state");
  assert.equal(await page.locator('.opportunity-map__marker[role="button"]').count(), 1, "Reloaded map state should retain the filtered marker set");
  await page.locator(".opportunity-map__reset").click();
  await page.waitForFunction(() => !window.location.hash.includes("mapQuery="));
  await assertButtonIntegrity(page, "Opportunity Map", "[data-opportunity-map]");
  await assertNoPageOverflow(page, "Desktop Opportunity Map");
  await page.screenshot({ path: `${OUT_DIR}/opportunity-map-desktop.png`, fullPage: true });

  await page.getByRole("button", { name: "Find" }).click();
  await page.locator("[data-opportunity-map-directory] input").fill("Wright-Patterson");
  const wrightPattersonHub = page.locator(".opportunity-map__directory-results button", { hasText: "Wright-Patterson acquisition cluster" }).filter({ hasText: "Spend-backed hub" });
  assert.equal(await wrightPattersonHub.count(), 1, "The directory should expose the spend-backed Wright-Patterson acquisition cluster");
  await wrightPattersonHub.click();
  await page.waitForSelector("[data-opportunity-map-detail]");
  const mauasRecordLink = page.getByRole("link", { name: "AFLCMC ISR/SOF / MAUAS EPASS", exact: true });
  const mauasHref = await mauasRecordLink.getAttribute("href");
  assert.match(decodeURIComponent(mauasHref), /capRecord=opp_26b736189b1e1357bc2f/, "Map record links should retain the stable platform record identity");
  assert.match(decodeURIComponent(mauasHref), /capQuery=FA862222F8449/, "Map record links should retain the readable award PIID search alias");
  await mauasRecordLink.click();
  await page.waitForSelector('[data-spend-explorer="table"]');
  assert.equal(await page.locator('[data-spend-explorer="table"] input[type="search"]').inputValue(), "FA862222F8449", "Map-to-table navigation should preserve the readable award PIID");
  assert.match(await page.locator('[data-spend-explorer="table"] .dbi-data-table__status').innerText(), /^1\s+of\s+/i, "The award PIID should resolve to its exact Spend Explorer table record");
  const mauasTableRow = page.locator('[data-spend-explorer="table"] [data-row-key="opp_26b736189b1e1357bc2f"]');
  assert.equal(await mauasTableRow.count(), 1, "The map record should resolve through its stable internal identity");
  assert.equal(await mauasTableRow.getAttribute("data-row-highlighted"), "true", "The table should highlight the record selected from the map");

  const pdbVerificationUrl = new URL(BASE_URL);
  pdbVerificationUrl.searchParams.set("verify", "pdb");
  pdbVerificationUrl.hash = "#/budget-spend";
  await page.goto(pdbVerificationUrl.href, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("[data-pdb-request-page]");
  assert.equal(budgetRequestRouteRequests, 1, "PDB Request should load the shared money-flow route family exactly once");
  assert.equal(await page.locator("[data-pdb-request-page]").count(), 1, "Default surface should be the source request");
  assert.equal(await page.locator("[data-budget-filter-bar]").count(), 1, "Request surface should expose line-level filters");
  assert.equal(await page.locator("[data-budget-metrics] > .if-management-card").count(), 5, "Request surface should expose factual coverage metrics");
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
  assert.equal(await page.locator(".trend-history-details").getAttribute("open"), null, "Detailed history should stay collapsed until requested");
  let historyText = await page.locator("[data-request-history-page]").locator("xpath=..").innerText();
  assert.doesNotMatch(historyText, /Largest Request Changes/);
  await page.locator(".trend-history-details > summary").click();
  historyText = await page.locator("[data-request-history-page]").locator("xpath=..").innerText();
  assert.match(historyText, /Largest Request Changes/);
  assert.doesNotMatch(historyText, /Momentum Leaders|Trend Readout/);

  await openSurface(page, "#/budget-spend/lifecycle", "[data-account-spine-page]");
  assert.equal(await page.locator("[data-active-page-title]").innerText(), "Account Flow");
  assert.equal(await resourceCount(page, "account-spine.json"), 1, "Account flow should load its factual payload once");
  assert.equal(await page.locator("[data-lifecycle-waterfall] .lifecycle-stage").count(), 4, "Account flow should separate request, apportionment, obligation, and outlay");
  assert.ok(await page.locator("[data-account-flow] article").count() >= 1, "Account flow should expose TAFS allocations");
  assert.ok(await page.locator("[data-award-account-flow] article").count() >= 1, "Account flow should expose award-to-account links");
  assert.equal(await page.locator("[data-burn-curve] svg").count(), 1, "Account flow should expose obligation history");
  const federalAccountTrigger = page.getByRole("button", { name: /^Federal account:/ });
  await federalAccountTrigger.click();
  assert.ok(await page.locator('[data-if-picker-menu] [role="option"]').count() > 100, "Account flow should expose the federal-account inventory");
  await page.keyboard.press("Escape");
  assert.ok(await page.locator("[data-account-spine-page] .phase-intro").evaluate((node) => node.getBoundingClientRect().height) <= 72, "Account-flow intro should remain compact");
  assert.doesNotMatch(await page.locator("[data-account-spine-page] .phase-intro").innerText(), /Stage\s+3/i, "Account flow should not repeat numbered phase navigation");
  const lifecycleText = await page.locator("[data-account-spine-page]").innerText();
  assert.match(lifecycleText, /derived/i, "Derived request joins should be labeled");
  assert.match(lifecycleText, /exact TAFS joins/i, "Exact TAFS joins should be labeled");
  assert.equal(await page.locator(".lifecycle-detail-disclosure").getAttribute("open"), null, "Secondary execution history should stay collapsed until requested");
  await page.locator(".lifecycle-detail-disclosure > summary").click();
  assert.match(await page.locator("[data-account-spine-page]").innerText(), /Award-to-Account Flow/, "Account detail disclosure should expose award-linked evidence on demand");

  await page.evaluate(() => window.localStorage.setItem("dbi:data-table:award-records", JSON.stringify({ widths: { actions: 720 } })));
  await openSurface(page, "#/budget-spend/awards", "[data-awards-page]");
  assert.equal(await page.locator("[data-active-page-title]").innerText(), "Awards");
  assert.equal(await resourceCount(page, "budget-execution.json"), 1, "Awards should load the factual execution payload once");
  assert.equal(await page.locator("[data-award-filter-bar] .if-picker").count(), 5, "Awards should expose factual filter dimensions");
  assert.equal(await page.locator("[data-award-record-table] [data-if-table-row]").count(), 25, "Awards should paginate the sampled award table without rendering hundreds of DOM rows at once");
  const awardStatusText = await page.locator("[data-award-record-table] .dbi-data-table__status").innerText();
  const awardStatusCounts = awardStatusText.match(/([\d,]+)\s+of ([\d,]+) records/i)?.slice(1).map((value) => Number(value.replaceAll(",", ""))) || [];
  assert.ok(awardStatusCounts[0] >= 689 && awardStatusCounts[0] === awardStatusCounts[1], `Awards should preserve the complete growing corpus in pagination and export, got ${awardStatusText}`);
  assert.equal(await page.locator("[data-award-record-table] [data-table-filters]").count(), 0, "Awards should not duplicate the page-level filter deck inside the record table");
  assert.equal(await page.locator("[data-award-record-table] .dbi-data-table__columns").count(), 1, "Awards should expose persistent column configuration");
  await assertButtonIntegrity(page, "Awards", "[data-awards-page]");
  await assertOpenStateControls(page, "Awards", "[data-awards-page]");
  const awardColumnManager = page.locator("[data-award-record-table] .dbi-data-table__columns");
  const awardColumnTrigger = awardColumnManager.locator("summary").first();
  await awardColumnTrigger.click();
  assert.equal(await page.locator("[data-award-record-table]").getByRole("button", { name: "Reset layout", exact: true }).count(), 1, "The consolidated table-options menu should expose a one-step layout reset");
  await page.keyboard.press("Escape");
  assert.equal(await awardColumnManager.getAttribute("open"), null, "Escape should close the DataTable column manager");
  assert.equal(await awardColumnTrigger.evaluate((node) => node === document.activeElement), true, "Closing the DataTable column manager should restore focus to its trigger");
  const awardStickyGeometry = await page.locator("[data-award-record-table] .dbi-data-table__wrap").evaluate((wrap) => {
    const identity = wrap.querySelector("th[data-column-key='award']");
    const actions = wrap.querySelector("th[data-table-column-role='actions']");
    const before = { identity: identity?.getBoundingClientRect().left || 0, actions: actions?.getBoundingClientRect().right || 0 };
    wrap.scrollLeft = wrap.scrollWidth;
    const after = { identity: identity?.getBoundingClientRect().left || 0, actions: actions?.getBoundingClientRect().right || 0 };
    return {
      before,
      after,
      actionWidth: actions?.getBoundingClientRect().width || 0,
      actionReorderControls: actions?.querySelectorAll(".dbi-data-table__reorder, .dbi-data-table__resizer").length || 0,
      clientWidth: wrap.clientWidth,
      scrollWidth: wrap.scrollWidth,
    };
  });
  assert.ok(awardStickyGeometry.scrollWidth > awardStickyGeometry.clientWidth, "Wide award records should scroll inside the DataTable rather than the document");
  assert.ok(Math.abs(awardStickyGeometry.before.identity - awardStickyGeometry.after.identity) <= 1, `The identity column should remain pinned during horizontal scroll: ${JSON.stringify(awardStickyGeometry)}`);
  assert.ok(Math.abs(awardStickyGeometry.before.actions - awardStickyGeometry.after.actions) <= 5, `The action column should remain pinned within the table border during horizontal scroll: ${JSON.stringify(awardStickyGeometry)}`);
  assert.ok(awardStickyGeometry.actionWidth <= 180, `Shared action columns must ignore stale oversized widths and remain content-sized: ${JSON.stringify(awardStickyGeometry)}`);
  assert.equal(awardStickyGeometry.actionReorderControls, 0, "Pinned action columns must not expose reorder or resize controls");
  await page.locator("[data-award-record-table] tbody input[type=checkbox]").first().check();
  assert.match(await page.locator("[data-award-record-table] .if-table-selection-bar").innerText(), /1 selected[\s\S]*Clear selection/i, "Shared tables should expose the framework selection bar when rows are selected");
  await page.locator("[data-award-record-table] .if-table-selection-bar").getByRole("button", { name: "Clear selection" }).click();
  assert.equal(await page.locator("[data-award-record-table] .if-table-selection-bar").count(), 0, "Clearing a selection should remove the shared bulk-action surface");
  const awardContentOrder = await page.evaluate(() => ({
    records: document.querySelector("[data-award-record-table]")?.getBoundingClientRect().top || 0,
    rollups: document.querySelector(".award-rollup-details")?.getBoundingClientRect().top || 0,
    filterBottoms: [...document.querySelectorAll("[data-award-filter-bar] input, [data-award-filter-bar] .if-picker__trigger, [data-award-filter-bar] > button")].map((node) => Math.round(node.getBoundingClientRect().bottom)),
    metricTops: [...document.querySelectorAll('[aria-label="Award filter metrics"] > .if-management-card')].map((node) => Math.round(node.getBoundingClientRect().top)),
  }));
  assert.ok(awardContentOrder.records < awardContentOrder.rollups, `Award records should precede secondary rollups: ${JSON.stringify(awardContentOrder)}`);
  assert.equal(await page.locator(".award-rollup-details").getAttribute("open"), null, "Award rollups should stay collapsed until the operator requests secondary analysis");
  assert.equal(new Set(awardContentOrder.filterBottoms).size, 1, `Desktop award controls should occupy one aligned Control Framework command row: ${JSON.stringify(awardContentOrder)}`);
  assert.equal(new Set(awardContentOrder.metricTops).size, 1, `Desktop award KPIs should occupy one aligned row: ${JSON.stringify(awardContentOrder)}`);
  assert.ok(awardContentOrder.records <= 560, `Award records should remain visible in the first desktop viewport: ${JSON.stringify(awardContentOrder)}`);
  assert.equal(await page.locator("[data-awards-page] > .if-workbench-header").count(), 1, "Awards should consolidate its intro, metrics, actions, and filters into one workbench header");
  assert.doesNotMatch(await page.locator("[data-awards-page] > .if-workbench-header").innerText(), /Stage\s+4/i, "Awards should not repeat numbered phase navigation");
  assert.doesNotMatch(await page.locator("[data-awards-page]").innerText(), /Pursuit score|recommended action|Target execution brief|Target workboard/i);
  const awardSearchGeometry = await page.getByPlaceholder("Search award IDs, vendors, buyers, descriptions").evaluate((input) => {
    const icon = input.parentElement?.querySelector("svg")?.getBoundingClientRect();
    const bounds = input.getBoundingClientRect();
    return { iconRight: icon?.right || 0, textStart: bounds.left + Number.parseFloat(getComputedStyle(input).paddingLeft) };
  });
  assert.ok(awardSearchGeometry.iconRight + 5 <= awardSearchGeometry.textStart, `Award search icon must not overlap its text lane: ${JSON.stringify(awardSearchGeometry)}`);

  const tablet = await browser.newPage({ viewport: { width: 768, height: 900 } });
  await installVerificationDate(tablet);
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

  await openSurface(page, "#/budget-spend/explorer?spendView=timeline", "[data-transaction-analytics-page]");
  assert.equal(await page.locator("[data-active-page-title]").innerText(), "Spend Explorer");
  assert.equal(await resourceCount(page, "capture-calendar.json"), 1, "Transactions should load the public event payload once");
  assert.equal(await resourceCount(page, "usaspending-subawards.json"), 1, "Transactions should load the compact subaward summary once");
  assert.equal(subawardDetailRequests, 0, "Recent subaward detail should remain deferred until its overlay or a positive prime opens");
  assert.equal(transactionRequests, 0, "Exact FPDS actions should remain deferred until a record opens");
  const transactionText = await page.locator("[data-transaction-analytics-page]").innerText();
  const publicRecordCount = Number(await page.locator("[data-capture-calendar-page]").getAttribute("data-public-record-count") || 0);
  const automaticAdditionCount = Number(await page.locator("[data-capture-calendar-page]").getAttribute("data-automatic-record-count") || 0);
  assert.ok(publicRecordCount >= 875, `Transactions should expose the current expanded baseline or more, got ${publicRecordCount}`);
  assert.ok(automaticAdditionCount >= 677, `Transactions should retain the automated USAspending baseline and permit new feeds, got ${automaticAdditionCount}`);
  await assertButtonIntegrity(page, "Spend Explorer", "[data-transaction-analytics-page]");
  await assertOpenStateControls(page, "Spend Explorer", "[data-transaction-analytics-page]");
  assert.match(transactionText, /Decision view[\s\S]*records/i, "Timeline should lead with the compact decision rail instead of a metric wall");
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
  assert.equal(await page.locator("[data-capture-chart]").count(), 0, "Transactions should omit the secondary analytics deck beneath the Gantt");
  assert.equal(await page.locator("[data-capture-matrix]").count(), 0, "Transactions should omit the secondary lifecycle matrix beneath the Gantt");
  assert.equal(await page.getByText("More transaction analytics", { exact: true }).count(), 0, "Transactions should remove the bottom analytics disclosure");
  assert.equal(await page.getByText("Measurement and publication boundary", { exact: true }).count(), 0, "Transactions should remove the bottom methodology disclosure");
  assert.equal(await page.locator("[data-capture-filters] .capture-filter").count(), 24, "Transactions should expose technology and DoW hierarchy alongside the established factual filters and tracking scope");
  for (const label of ["Technology area", "DoW branch", "Service / component", "Buying office"]) {
    assert.equal(await page.getByText(label, { exact: true }).count(), 1, `Transactions should expose the ${label} drilldown control exactly once`);
  }
  assert.equal(await page.locator("[data-capture-filters] .capture-filter--advanced:visible").count(), 0, "Advanced filters should start collapsed to reduce vertical noise");
  const compactDesktopGeometry = await page.evaluate(() => ({
    freshnessCount: document.querySelectorAll("[data-freshness-strip]").length,
    firstRowTop: document.querySelector("[data-capture-timeline] .capture-timeline__row")?.getBoundingClientRect().top || 0,
    commandbarHeight: document.querySelector("[data-capture-gantt-commandbar]")?.getBoundingClientRect().height || 0,
  }));
  assert.equal(compactDesktopGeometry.freshnessCount, 0, "Transactions should not render source-freshness cards above the working canvas");
  assert.ok(compactDesktopGeometry.commandbarHeight <= 48, `The persistent Gantt command rail should remain compact, got ${compactDesktopGeometry.commandbarHeight}px`);
  assert.ok(compactDesktopGeometry.firstRowTop <= 470, `The first desktop Gantt row should remain visible high in the primary surface, got ${compactDesktopGeometry.firstRowTop}px`);
  assert.equal(await page.getByRole("button", { name: "Data table" }).count(), 0, "Transactions must remain a Gantt-only workspace");
  assert.equal(await page.locator("[data-transaction-data-table]").count(), 0, "Transactions must not render the shared DataTable");
  await page.getByRole("button", { name: "Filters", exact: true }).click();
  await chooseControlSelect(page, "Sort", "Recently added");
  await page.waitForFunction(() => performance.getEntriesByType("resource").some((entry) => entry.name.includes("procurement-discovery.json")));
  assert.equal(await resourceCount(page, "procurement-discovery.json"), 1, "Recently added sorting should load the deferred discovery index exactly once");
  await page.evaluate(() => { window.location.hash = "#/budget-spend/transactions?capView=table"; });
  await page.waitForFunction(() => !window.location.hash.includes("capView"));
  await page.waitForSelector("[data-capture-timeline]");
  assert.equal(await page.locator("[data-transaction-data-table]").count(), 0, "Legacy table links must canonicalize back to the Gantt");
  await page.getByRole("button", { name: "Table", exact: true }).click();
  await page.waitForSelector('[data-spend-explorer="table"]');
  await page.waitForFunction(() => performance.getEntriesByType("resource").some((entry) => entry.name.includes("procurement-discovery.json")));
  assert.equal(await resourceCount(page, "procurement-discovery.json"), 1, "Spend Explorer views should share one deferred discovery request");
  assert.equal(await page.locator("[data-daily-acquisition-feed]").count(), 1, "Spend Explorer Table should expose a compact daily acquisition ledger");
  assert.equal(await page.locator("[data-explorer-hierarchy]").count(), 1, "Spend Explorer Table should expose one technology and DoW hierarchy rail");
  await page.evaluate(() => { window.location.hash = "#/budget-spend/explorer?spendView=table&changes=today"; });
  await page.waitForSelector(".spend-explorer__change-scope");
  assert.match(await page.locator(".spend-explorer__change-scope").innerText(), /Complete daily update ledger/i, "Large daily refreshes should have a complete deferred-ledger route");
  assert.equal(await page.getByRole("columnheader", { name: /Latest change/i }).count(), 1, "The complete daily ledger should expose field-level change summaries");
  await page.getByRole("button", { name: "Show all records" }).click();
  assert.match(await page.locator('[data-spend-explorer="table"] .dbi-data-table__status').innerText(), /of (?:8\d\d|9\d\d|[1-9],\d{3,}) records/i, "Spend Explorer Table should retain the complete assembled transaction universe");
  const tombstoneButton = page.locator('[data-spend-explorer="table"] button[title="Tombstone this record"]').first();
  await tombstoneButton.click();
  await chooseControlSelect(page, "Record state", "Tombstoned (1)");
  const restoreButton = page.locator('[data-spend-explorer="table"] button[title="Restore to active explorer"]').first();
  await restoreButton.waitFor();
  assert.equal(await restoreButton.count(), 1, "Tombstoned records should remain recoverable from their own workspace view");
  await restoreButton.click();
  await chooseControlSelect(page, "Record state", "Active explorer");
  await page.locator('[data-spend-explorer="table"] input[type="search"]').fill("Application Arsenal");
  assert.match(decodeURIComponent(new URL(page.url()).hash), /capQuery=Application\+Arsenal|capQuery=Application%20Arsenal/i, "Spend Explorer search should remain shareable across views");
  await page.getByRole("button", { name: "Timeline", exact: true }).click();
  await page.waitForSelector("[data-capture-timeline]");
  assert.match(await page.getByPlaceholder("Program, company, reference, buyer").inputValue(), /Application Arsenal/i, "Spend Explorer Timeline should inherit the shared table search state");
  await page.getByPlaceholder("Program, company, reference, buyer").fill("");
  const wallboardRecordIds = await page.locator("[data-capture-timeline-row]").evaluateAll((nodes) => nodes.slice(0, 8).map((node) => node.dataset.recordId));
  assert.equal(wallboardRecordIds.length, 8, "Wallboard density fixture should use eight factual stable record IDs");
  const firstWatchRow = page.locator("[data-capture-timeline-row]").first();
  const firstWatchId = await firstWatchRow.getAttribute("data-record-id");
  const firstWatchStar = firstWatchRow.locator(".capture-timeline__star");
  await firstWatchStar.click();
  assert.equal(await firstWatchStar.getAttribute("aria-pressed"), "true", "Gantt rows should support stable-ID tracking");
  await page.getByRole("button", { name: "Filters", exact: true }).click();
  await chooseControlSelect(page, "Tracking", "Tracked only (1)");
  assert.equal(await page.locator("[data-capture-timeline-row]").count(), 1, "Tracked-only scope should reduce the Gantt to the browser watchlist");
  assert.match(decodeURIComponent(new URL(page.url()).hash), /capTracked=tracked/, "Tracked-only scope should be shareable without exposing private notes");
  await openSurface(page, "#/budget-spend/watchlist", "[data-operations-hub]");
  assert.equal(await page.locator("[data-active-page-title]").innerText(), "Watchlist", "The masthead should identify the active workspace surface rather than flatten every area into Administration");
  assert.equal(await page.locator("[data-ops-watch-table] [data-if-table-row]").count(), 1, "Watchlist should project the tracked stable-ID working set");
  assert.equal(await page.locator(`[data-ops-watch-table] [data-row-key="${firstWatchId}"]`).count(), 1, "Watchlist should preserve the exact Gantt stable ID");
  const watchRow = page.locator(`[data-ops-watch-table] [data-row-key="${firstWatchId}"]`);
  await watchRow.click();
  const watchNote = page.locator("[data-ops-watch-table] [data-if-table-detail] textarea");
  await watchNote.fill("Verify public record details before the next review.");
  await watchNote.blur();
  await watchRow.locator('input[type="date"]').fill("2026-10-01");
  await openSurface(page, "#/budget-spend/schedule?scheduleView=list", "[data-ops-events]");
  await page.getByRole("button", { name: "Add event" }).click();
  const addEventDialog = page.getByRole("dialog", { name: "Add event" });
  assert.equal(await addEventDialog.locator(".event-catalog-results").evaluate((node) => getComputedStyle(node).overflowY), "visible", "Catalog cards should use the dialog body as their single scroll owner");
  assert.equal(await addEventDialog.locator("[data-event-placement-settings]").getAttribute("open"), null, "Catalog visibility settings should stay summarized until requested");
  await addEventDialog.getByRole("button", { name: "Add manually" }).click();
  assert.equal(await addEventDialog.getByRole("button").filter({ hasText: "Research details" }).count(), 0, "Manual add should not expose a redundant unsaved research action");
  await addEventDialog.getByLabel("Event name").fill("Portfolio evidence review");
  await addEventDialog.getByLabel("Location hint").fill("Mission center, Room 204");
  await addEventDialog.getByRole("button", { name: "Save event" }).click();
  await addEventDialog.waitFor({ state: "detached" });
  assert.match(await page.locator("[data-ops-events]").innerText(), /Portfolio evidence review/, "Manual events should enter the workspace calendar before optional deep editing");
  assert.match(await page.locator("[data-ops-events]").innerText(), /Portfolio evidence review[\s\S]*Date pending/, "Manual events must save without a start date and expose their pending schedule state");
  await page.getByRole("button", { name: "Edit Portfolio evidence review" }).click();
  await page.waitForSelector("[data-ops-event-editor]");
  const eventEditor = page.locator("[data-ops-event-editor]");
  assert.equal(await eventEditor.getByRole("button", { name: "Save event" }).isDisabled(), true, "Existing events must not submit an unchanged form");
  await eventEditor.getByLabel(/^Starts/).fill("2027-01-15T14:00");
  assert.equal(await eventEditor.getByRole("button", { name: "Save event" }).isEnabled(), true, "Changing a field must enable event persistence");
  await eventEditor.getByRole("button", { name: "Cancel" }).click();
  await eventEditor.getByText("Unsaved changes", { exact: true }).first().waitFor();
  assert.equal(await eventEditor.getByRole("button", { name: "Discard" }).count(), 1, "Closing a dirty event must require an explicit discard decision");
  await eventEditor.getByRole("button", { name: "Keep editing" }).click();
  await eventEditor.locator("[data-event-more-details] > summary").click();
  await eventEditor.locator("[data-event-logistics] > summary").click();
  await eventEditor.getByRole("button", { name: "Add link" }).click();
  await eventEditor.getByLabel("Event link 1 label").fill("Official event page");
  await eventEditor.getByLabel("Event link 1 URL").fill("https://example.test/portfolio-review");
  const eventCategoryPicker = eventEditor.getByRole("button", { name: /^Event categories:/ });
  await eventCategoryPicker.click();
  await page.getByRole("option", { name: /Workshop/ }).click();
  await page.keyboard.press("Escape");
  const milestoneButton = eventEditor.getByRole("button", { name: "Add milestone" });
  assert.match(await milestoneButton.getAttribute("class"), /if-btn--secondary/, "The milestone action must use the Control Surface secondary button");
  await eventEditor.getByRole("button", { name: "Save event" }).click();
  await page.waitForSelector("[data-ops-event-editor]", { state: "detached" });
  assert.match(await page.locator("[data-ops-events]").innerText(), /Portfolio evidence review/, "Operations should retain operator events separately from source dates");
  await openSurface(page, "#/budget-spend/connections?connectionsView=integrations", "[data-ops-integrations]");
  await page.waitForSelector("[data-ops-integrations] [data-integration-freshness] .freshness-chip", { state: "attached" });
  assert.equal(await page.locator("[data-ops-integrations] [data-ops-integration-table] [data-if-table-row]").count(), 8, "Operations should summarize each current ingestion layer");
  assert.equal(await page.locator("[data-ops-integrations] [data-integration-freshness] .freshness-chip").count(), 4, "Budget, award, source, and contract-monitor freshness should live with Admin integration health");
  assert.equal(await page.locator("[data-contract-monitor-summary] .if-management-card").count(), 4, "Contract monitoring should expose target, coverage, gap, and freshness metrics through the shared metric strip");
  assert.ok(await page.locator("[data-contract-monitor-table] [data-if-table-row]").count() > 0, "Contract monitoring should expose its active and upcoming records");
  const contractMonitorPayload = await page.evaluate(() => fetch(new URL("data/contract-monitor.json", document.baseURI)).then((response) => response.json()));
  assert.ok(contractMonitorPayload.metadata.targetCount >= 500, "Contract monitor should cover the complete known non-historical universe");
  assert.ok(contractMonitorPayload.metadata.currentCount + contractMonitorPayload.metadata.staleCount >= 460, "Contract monitor should retain exact USAspending observations and exact-PIID resolutions across transient refresh failures");
  assert.equal(contractMonitorPayload.metadata.targetCount, contractMonitorPayload.records.length, "Contract-monitor metadata should match its published rows");
  assert.equal(new Set(contractMonitorPayload.records.map((record) => record.opportunityId)).size, contractMonitorPayload.records.length, "Contract-monitor rows should retain unique stable IDs");
  const forbiddenMonitorKeys = [];
  (function inspectMonitorKeys(value, path = "contractMonitor") {
    if (Array.isArray(value)) return value.forEach((item, index) => inspectMonitorKeys(item, `${path}[${index}]`));
    if (!value || typeof value !== "object") return;
    for (const [key, nested] of Object.entries(value)) {
      if (/^(authorization|cookie|api[_-]?key|credential|headers?)$/i.test(key)) forbiddenMonitorKeys.push(`${path}.${key}`);
      inspectMonitorKeys(nested, `${path}.${key}`);
    }
  }(contractMonitorPayload));
  assert.deepEqual(forbiddenMonitorKeys, [], "Contract-monitor output must not contain credential or header fields");
  await openSurface(page, "#/budget-spend/connections?connectionsView=activity", "[data-ops-activity]");
  await page.getByRole("button", { name: /Workspace changes/ }).click();
  assert.ok(await page.locator("[data-ops-activity] [data-ops-activity-table] [data-if-table-row]").count() >= 4, "Watchlist and event mutations should produce append-only activity entries");
  await page.evaluate((recordIds) => {
    const at = "2026-09-13T12:00:00.000Z";
    localStorage.setItem("dbi:watchlist:v1", JSON.stringify(recordIds.map((recordId, index) => ({ recordId, starredAt: at, updatedAt: at, reviewAt: index < 3 ? `2026-10-0${index + 1}` : "", note: "", wallboard: true }))));
    localStorage.setItem("dbi:management-events:v1", JSON.stringify([
      { id: "event-air-space-cyber-conference-2026", title: "Air, Space & Cyber Conference", startsAt: "2026-09-14T08:00", endsAt: "2026-09-16T17:00", location: "National Harbor, Maryland, USA", links: [{ id: "official", label: "Official event page", url: "https://example.test/air-space-cyber" }, { id: "agenda", label: "Agenda", url: "https://example.test/air-space-cyber/agenda" }], attendees: [{ id: "user-jon", displayName: "Jon VandeMark" }, { id: "user-adam", displayName: "Adam Boas" }], milestones: [{ id: "registration", type: "registration_deadline", label: "Registration closes", occursAt: "2026-09-10", notes: "Published registration cutoff" }, { id: "refund", type: "refund_deadline", label: "Last day for refunds", occursAt: "2026-09-11", notes: "Published refund policy" }] },
      { id: "event-ausa-annual-meeting-2026", title: "AUSA Annual Meeting & Exposition 2026", startsAt: "2026-10-12T08:00", endsAt: "2026-10-14T17:00", location: "Walter E. Washington Convention Center, Washington, DC", attendees: [], milestones: [{ id: "hotel", type: "hotel_deadline", label: "Hotel block cutoff", occursAt: "2026-10-01", notes: "Published room-block cutoff" }] },
      { id: "event-eighth-annual-defense-conference-2026", title: "8th Annual Defense Conference", startsAt: "2026-10-30T08:00", endsAt: "2026-10-30T17:00", location: "Hyatt Regency Crystal City, Virginia or virtual", attendees: [{ id: "user-jon", displayName: "Jon VandeMark" }, { id: "user-adam", displayName: "Adam Boas" }] },
      { id: "event-i-itsec-2026", title: "Interservice/Industry Training, Simulation and Education Conference (I/ITSEC) 2026", startsAt: "2026-11-30T08:00", endsAt: "2026-12-04T17:00", location: "Orange County Convention Center, Orlando, Florida", attendees: [{ id: "user-jon", displayName: "Jon VandeMark" }, { id: "user-adam", displayName: "Adam Boas" }] },
      { id: "event-weapon-systems-software-summit-2026", title: "2026 Department of Defense Weapon Systems Software Summit", startsAt: "2026-12-08T08:00", endsAt: "2026-12-08T17:00", location: "Broward County Convention Center, Fort Lauderdale, Florida", attendees: [{ id: "user-adam", displayName: "Adam Boas" }] },
    ].map((event, index) => ({ ...event, attendeeIds: event.attendees.map((attendee) => attendee.id), categoryIds: [index === 4 ? "summit" : "conference"], notes: "", status: "scheduled", recordIds: [recordIds[index]], wallboard: true, createdAt: at, updatedAt: at }))));
    localStorage.setItem("dbi:event-categories:v1", JSON.stringify([
      { id: "conference", name: "Conference", description: "Conferences and annual meetings" },
      { id: "industry-day", name: "Industry day", description: "Government industry engagement" },
      { id: "workshop", name: "Workshop", description: "Hands-on working sessions" },
      { id: "immersion-day", name: "Immersion day", description: "Focused customer immersion" },
      { id: "summit", name: "Summit", description: "Executive and technical summits" },
      { id: "other", name: "Other", description: "Other workspace events" },
    ]));
    window.dispatchEvent(new CustomEvent("dbi:management-state-changed"));
  }, wallboardRecordIds);
  await openSurface(page, "#/budget-spend/schedule?scheduleView=calendar", '[data-wallboard-calendar][data-calendar-layout="standalone"]');
  const standaloneCalendarGeometry = await page.locator('[data-wallboard-calendar][data-calendar-layout="standalone"]').evaluate((node) => {
    const weeks = node.querySelector(".ops-wall-calendar__weeks");
    const cells = [...weeks.querySelectorAll("[data-calendar-day]")].map((cell) => cell.getBoundingClientRect());
    return {
      height: weeks.getBoundingClientRect().height,
      rows: new Set(cells.map((cell) => Math.round(cell.top))).size,
      dayCount: cells.length,
    };
  });
  assert.equal(standaloneCalendarGeometry.dayCount, 42, "Standalone Schedule Calendar must render all 42 month cells");
  assert.equal(standaloneCalendarGeometry.rows, 6, "Standalone Schedule Calendar must retain six complete week rows");
  assert.ok(standaloneCalendarGeometry.height >= 539, `Standalone Schedule Calendar must not collapse outside Display: ${JSON.stringify(standaloneCalendarGeometry)}`);
  const standaloneWorkspaceMark = page.locator('[data-wallboard-calendar] .ops-wall-calendar__identity > img');
  assert.ok((await standaloneWorkspaceMark.getAttribute("title"))?.trim(), "Calendar workspace images must disclose the workspace name on hover");
  const standaloneAttendeeAvatars = page.locator('[data-calendar-event="event-air-space-cyber-conference-2026"] .ops-wall-calendar__bar-attendees .user-avatar');
  assert.deepEqual(await standaloneAttendeeAvatars.evaluateAll((nodes) => nodes.map((node) => node.getAttribute("title"))), [null, null], "Calendar attendee profile pictures must not compete with the rich calendar hover card using native title tooltips");
  const adamProfileButton = page.getByRole("button", { name: "Open Adam Boas workspace profile" }).first();
  await adamProfileButton.hover();
  await page.waitForSelector('[data-calendar-hovercard][data-kind="attendee"]');
  assert.match(await page.locator('[data-calendar-hovercard][data-kind="attendee"]').innerText(), /Attendee[\s\S]*Adam Boas[\s\S]*Attending Air, Space & Cyber Conference/i, "Hovering an attendee avatar should update the existing calendar hover card with that member's identity");
  assert.equal(await page.locator('[data-calendar-hovercard]').count(), 1, "Attendee identity should use the existing calendar hover surface instead of opening a second tooltip");
  await adamProfileButton.click();
  await page.waitForSelector('[data-workspace-member-profile][data-member-id="user-adam"]');
  assert.equal(new URL(page.url()).hash, "#/workspace/directory?member=user-adam", "Calendar identities should open the canonical workspace-public profile route");
  assert.match(await page.locator("[data-workspace-member-profile]").innerText(), /Workspace profile[\s\S]*Adam Boas[\s\S]*Schedule associations[\s\S]*Air, Space & Cyber Conference/i, "Selecting an attendee should open a workspace-public profile with visible schedule associations");
  assert.doesNotMatch(await page.locator("[data-workspace-member-profile]").innerText(), /email|password|credential/i, "Workspace-public profiles must exclude private account and authentication data");
  await page.screenshot({ path: `${OUT_DIR}/workspace-member-profile-desktop.png`, fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  const mobileMemberProfile = await page.locator("[data-workspace-member-profile]").evaluate((node) => ({
    documentOverflow: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - innerWidth,
    columns: getComputedStyle(node.querySelector(".workspace-member-profile__grid")).gridTemplateColumns.split(" ").length,
    buttonHeights: [...node.querySelectorAll("button")].filter((button) => button.offsetParent !== null).map((button) => button.getBoundingClientRect().height),
  }));
  assert.ok(mobileMemberProfile.documentOverflow <= 1, `Workspace member profiles must not overflow mobile: ${JSON.stringify(mobileMemberProfile)}`);
  assert.equal(mobileMemberProfile.columns, 1, "Workspace member associations should stack into one mobile column");
  assert.ok(mobileMemberProfile.buttonHeights.every((height) => height >= 43.5), `Workspace member profile actions must retain 44px touch targets: ${mobileMemberProfile.buttonHeights.join(", ")}`);
  await page.screenshot({ path: `${OUT_DIR}/workspace-member-profile-mobile.png`, fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole("button", { name: "Back to Schedule" }).click();
  await page.waitForSelector('[data-wallboard-calendar][data-calendar-layout="standalone"]');
  const standaloneToolbar = await page.locator(".ops-wall-calendar__controls").evaluate((node) => {
    const count = node.querySelector("[data-calendar-count]");
    const main = count.querySelector(":scope > span").getBoundingClientRect();
    const milestones = count.querySelector("small").getBoundingClientRect();
    return { navigatorButtons: node.querySelectorAll(":scope > .if-month-navigator > button").length, countRows: Math.abs(main.top - milestones.top), countHeight: count.getBoundingClientRect().height };
  });
  assert.equal(standaloneToolbar.navigatorButtons, 3, "The framework month navigator should expose exactly previous, Today, and next");
  assert.ok(standaloneToolbar.countRows <= 8, `Calendar event and milestone counts should remain on one compact row: ${JSON.stringify(standaloneToolbar)}`);
  assert.ok(standaloneToolbar.countHeight <= 58, `Calendar count status should not become a malformed two-row control: ${JSON.stringify(standaloneToolbar)}`);
  await assertButtonIntegrity(page, "Standalone Schedule Calendar", "[data-wallboard-calendar]");
  await assertOpenStateControls(page, "Standalone Schedule Calendar", "[data-wallboard-calendar]");
  await page.screenshot({ path: `${OUT_DIR}/schedule-calendar-standalone-desktop.png`, fullPage: true });
  await openSurface(page, "#/budget-spend/schedule?scheduleView=display", "[data-ops-wallboard]");
  assert.equal(await page.locator("[data-active-page-title]").innerText(), "Schedule");
  assert.match(await page.locator("[data-ops-wallboard]").innerText(), /Air, Space & Cyber Conference/, "Schedule Display should project imported operator events");
  assert.doesNotMatch(await page.locator("[data-ops-wallboard]").innerText(), /AFRL Classified Industry Day/i, "Schedule Display must exclude AFRL Classified Industry Day");
  assert.equal(await page.getByRole("button", { name: "Overview", exact: true }).count(), 0, "Schedule must remove the duplicate Overview mode");
  assert.equal(await page.getByRole("button", { name: "Events", exact: true }).count(), 0, "Schedule must remove the duplicate Events mode");
  assert.equal(await page.locator("[data-ops-wallboard]").getByRole("button", { name: "Calendar", exact: true }).count(), 1, "Display should retain the calendar projection");
  assert.equal(await page.locator("[data-ops-wallboard]").getByRole("button", { name: "Tracked records", exact: true }).count(), 1, "Display should retain the tracked-record projection");
  await page.waitForSelector("[data-wallboard-calendar]");

  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.evaluate(() => {
    const key = "dbi:management-events:v1";
    const events = JSON.parse(localStorage.getItem(key) || "[]");
    const at = "2026-09-13T12:00:00.000Z";
    events.push(
      { id: "event-busy-day-a", title: "Busy day review A", startsAt: "2026-09-14T09:00", endsAt: "2026-09-14T10:00", location: "Room A", links: [], attendees: [], attendeeIds: [], milestones: [], categoryIds: ["conference"], notes: "", status: "scheduled", recordIds: [], wallboard: true, createdAt: at, updatedAt: at },
      { id: "event-busy-day-b", title: "Busy day review B", startsAt: "2026-09-14T11:00", endsAt: "2026-09-14T12:00", location: "Room B", links: [], attendees: [], attendeeIds: [], milestones: [], categoryIds: ["conference"], notes: "", status: "scheduled", recordIds: [], wallboard: true, createdAt: at, updatedAt: at },
      { id: "event-busy-day-c", title: "Busy day review C", startsAt: "2026-09-14T14:00", endsAt: "2026-09-14T15:00", location: "Room C", links: [], attendees: [], attendeeIds: [], milestones: [], categoryIds: ["conference"], notes: "", status: "scheduled", recordIds: [], wallboard: true, createdAt: at, updatedAt: at },
      { id: "event-mobile-second-lane", title: "Second lane review", startsAt: "2026-09-16T10:00", endsAt: "2026-09-16T11:00", location: "Room D", links: [], attendees: [], attendeeIds: [], milestones: [], categoryIds: ["conference"], notes: "", status: "scheduled", recordIds: [], wallboard: true, createdAt: at, updatedAt: at },
    );
    localStorage.setItem(key, JSON.stringify(events));
    window.dispatchEvent(new CustomEvent("dbi:management-state-changed"));
  });
  await page.locator("[data-ops-wallboard]").getByRole("button", { name: "Calendar", exact: true }).click();
  await page.waitForSelector("[data-wallboard-calendar]");
  assert.match(await page.locator("[data-wallboard-calendar] > header").innerText(), /September 2026/i, "Calendar should open on the first scheduled event month");
  assert.equal(await page.locator("[data-calendar-day]").count(), 42, "Calendar should render a stable six-week month grid");
  assert.ok(await page.locator("[data-calendar-event] .ops-wall-calendar__bar-attendees .user-avatar").count() >= 1, "Calendar event bars should surface compact attendee avatars without adding a third text line");
  assert.equal(await page.locator('[data-calendar-event="event-air-space-cyber-conference-2026"]').count(), 1, "A multi-day event should render as one continuous Gantt-style weekly bar");
  assert.equal(await page.locator('[data-calendar-milestone][data-parent-event="event-air-space-cyber-conference-2026"]').count(), 2, "Published event deadlines should render as linked Gantt overlays");
  const busyDayOverflow = page.locator('[data-calendar-overflow="2026-09-14"]');
  assert.match(await busyDayOverflow.innerText(), /\+3 more[\s\S]*4 total/i, "A busy day should keep one primary schedule visible and replace competing rows with one deliberate day summary");
  const busyDayGeometry = await busyDayOverflow.evaluate((node) => {
    const summary = node.getBoundingClientRect();
    const day = document.querySelector('[data-calendar-day="2026-09-14"]').getBoundingClientRect();
    return { insideDay: summary.left >= day.left - 1 && summary.right <= day.right + 1 && summary.top >= day.top && summary.bottom <= day.bottom + 1, height: summary.height };
  });
  assert.equal(busyDayGeometry.insideDay, true, "A busy-day summary should remain fully contained by its date cell");
  await busyDayOverflow.click();
  await page.waitForSelector('[data-calendar-day-agenda="2026-09-14"]');
  assert.equal(await page.locator("[data-calendar-day-agenda] .ops-day-agenda__item").count(), 4, "The day agenda should retain every event scheduled on a busy date");
  assert.match(await page.locator("[data-calendar-day-agenda]").innerText(), /Air, Space & Cyber Conference[\s\S]*Busy day review A[\s\S]*Busy day review B[\s\S]*Busy day review C/i, "The day agenda should expose the complete ordered schedule");
  await page.screenshot({ path: `${OUT_DIR}/wallboard-calendar-day-agenda-1080p.png` });
  await page.getByRole("button", { name: /Busy day review B/ }).click();
  await page.waitForSelector("[data-calendar-event-detail]");
  assert.match(await page.locator("[data-calendar-event-detail]").innerText(), /Busy day review B[\s\S]*Room B/i, "A day-agenda item should open the existing event detail surface");
  await page.getByRole("button", { name: "Close event details" }).click();
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
  assert.ok(milestoneHoverGeometry.left >= 0 && milestoneHoverGeometry.top >= 0 && milestoneHoverGeometry.right <= milestoneHoverGeometry.width && milestoneHoverGeometry.bottom <= milestoneHoverGeometry.height, `Calendar hover cards should remain contained within the viewport: ${JSON.stringify(milestoneHoverGeometry)}`);
  await page.screenshot({ path: `${OUT_DIR}/wallboard-calendar-hover-1080p.png` });
  await page.mouse.move(2, 2);
  await page.locator('[data-calendar-event="event-air-space-cyber-conference-2026"] .ops-wall-calendar__bar-main').focus();
  await page.waitForSelector('[data-calendar-hovercard][data-kind="event"]');
  assert.match(await page.locator('[data-calendar-hovercard][data-kind="event"]').innerText(), /Event schedule[\s\S]*2 milestones[\s\S]*National Harbor/i, "Keyboard focus should expose the rich event hover card");
  await page.locator('[data-calendar-event="event-air-space-cyber-conference-2026"] .ops-wall-calendar__bar-main').blur();
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
        const barBox = bar.getBoundingClientRect();
        const copyBox = copy.getBoundingClientRect();
        const titleBox = title.getBoundingClientRect();
        return {
          copyUsesSpan: copyBox.width >= barBox.width * .75,
          titleUsesCopyWidth: titleBox.width >= copyBox.width - 1,
          contained: titleBox.right <= barBox.right + 1 && titleBox.bottom <= barBox.bottom + 1,
          lineCount: copy.children.length,
          barHeight: barBox.height,
        };
      })(),
      formControls: node.querySelectorAll("[data-calendar-event] input, [data-calendar-event] textarea, [data-calendar-event] select").length,
      profileButtons: node.querySelectorAll("[data-calendar-event] [data-calendar-attendee]").length,
    };
  });
  assert.equal(calendarGeometry.columns, 7, "Desktop calendar should retain seven weekday columns");
  assert.equal(calendarGeometry.rows, 6, "Desktop calendar should retain six stable week rows");
  assert.ok(calendarGeometry.firstCellHeight >= 100, `1080p calendar dates should remain distance-readable, got ${calendarGeometry.firstCellHeight}px cells`);
  assert.ok(calendarGeometry.eventSize >= 12, `1080p calendar event labels should remain readable, got ${calendarGeometry.eventSize}px`);
  assert.equal(calendarGeometry.eventCopy.copyUsesSpan, true, "Calendar copy should use the available event-bar lane beside attendee avatars");
  assert.equal(calendarGeometry.eventCopy.titleUsesCopyWidth, true, "Calendar event titles should receive the full copy width before truncation");
  assert.equal(calendarGeometry.eventCopy.contained, true, "Compact calendar copy must remain inside its event bar");
  assert.equal(calendarGeometry.eventCopy.lineCount, 1, "Calendar bars should keep one scan-first title line and move detail into hover and agenda surfaces");
  assert.ok(calendarGeometry.eventCopy.barHeight <= 42, `1080p calendar lanes should remain compact, got ${calendarGeometry.eventCopy.barHeight}px`);
  assert.ok(calendarGeometry.lastCellBottom <= calendarGeometry.gridBottom + 1, "Every calendar week should fit within the 1080p wallboard");
  assert.equal(calendarGeometry.formControls, 0, "Calendar event entries should remain read-only");
  assert.ok(calendarGeometry.profileButtons >= 1, "Calendar event entries should expose attendee profiles as bounded read-only navigation");
  const calendarAttendeeAvatar = page.locator('[data-calendar-event="event-air-space-cyber-conference-2026"] .ops-wall-calendar__bar-attendees .user-avatar').first();
  assert.equal(await calendarAttendeeAvatar.count(), 1, "Calendar bars should render the attendee identity rail");
  const calendarAttendeeAvatarBox = await calendarAttendeeAvatar.boundingBox();
  assert.ok(calendarAttendeeAvatarBox?.width >= 31.5 && calendarAttendeeAvatarBox?.height >= 31.5, `Calendar attendee images should use the larger 32px profile primitive, got ${calendarAttendeeAvatarBox?.width}×${calendarAttendeeAvatarBox?.height}`);
  await page.locator('[data-calendar-event="event-air-space-cyber-conference-2026"] .ops-wall-calendar__bar-main').click();
  await page.waitForSelector("[data-calendar-event-detail]");
  assert.match(await page.locator("[data-calendar-event-detail]").innerText(), /Air, Space & Cyber Conference[\s\S]*National Harbor[\s\S]*Attendees/i, "Clicking a calendar bar should open the complete event detail modal");
  assert.match(await page.locator("[data-calendar-event-detail]").innerText(), /Conference[\s\S]*Official event page[\s\S]*Agenda/i, "Event details should separate category, venue, and multiple event links");
  const eventModalHeader = await page.locator("[data-calendar-event-detail] > header").evaluate((header) => {
    const title = header.querySelector("h2").getBoundingClientRect();
    const close = header.querySelector("button").getBoundingClientRect();
    const bounds = header.getBoundingClientRect();
    return { titleRight: title.right, closeLeft: close.left, closeRight: close.right, headerRight: bounds.right };
  });
  assert.ok(eventModalHeader.titleRight <= eventModalHeader.closeLeft && eventModalHeader.closeRight <= eventModalHeader.headerRight + 1, `Event modal title and close action must not overlap: ${JSON.stringify(eventModalHeader)}`);
  await page.getByRole("button", { name: "Close event details" }).click();
  const calendarCategoryFilter = page.locator("[data-calendar-category-filter]");
  await calendarCategoryFilter.click();
  await page.getByRole("option", { name: /^Summit/ }).click();
  await page.keyboard.press("Escape");
  assert.equal(await page.locator('[data-calendar-event="event-air-space-cyber-conference-2026"]').count(), 0, "Selecting Summit alone should hide Conference events");
  await calendarCategoryFilter.click();
  await page.getByRole("option", { name: /^Conference/ }).click();
  await page.keyboard.press("Escape");
  assert.equal(await page.locator('[data-calendar-event="event-air-space-cyber-conference-2026"]').count(), 1, "Selecting multiple event types should apply inclusive OR filtering");
  await calendarCategoryFilter.click();
  await page.getByRole("button", { name: "Clear" }).click();
  await page.keyboard.press("Escape");
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
    workspaceName: node.querySelector("[data-wallboard-workspace]")?.textContent.trim(),
    workspaceNameVisible: node.querySelector("[data-wallboard-workspace]")?.getBoundingClientRect().height > 0,
    clockCount: node.querySelectorAll(".ops-wallboard__time strong").length,
    clockSupportingCopy: [...node.querySelectorAll(".ops-wallboard__time span, .ops-wallboard__time small")].filter((item) => item.getBoundingClientRect().height > 0).length,
    calendarControlsVisible: [...node.querySelectorAll(".ops-wall-calendar__controls")].some((control) => control.getBoundingClientRect().height > 0),
    sectionEyebrowsVisible: [...node.querySelectorAll(".ops-wallboard__section:not(.ops-wallboard__section--calendar) > header span")].some((item) => item.getBoundingClientRect().height > 0),
    sectionCountsVisible: [...node.querySelectorAll(".ops-wallboard__section > header > b")].some((item) => item.getBoundingClientRect().height > 0),
    calendarMonthHeadingVisible: node.querySelector("[data-calendar-month-heading]")?.getBoundingClientRect().height > 0,
    duplicateCalendarIconVisible: [...node.querySelectorAll(".ops-wall-calendar__identity > img")].some((item) => item.getBoundingClientRect().height > 0),
  }));
  assert.equal(calendarKioskGeometry.mode, "calendar", "Entering kiosk should preserve the selected wallboard view");
  assert.ok(Math.abs(calendarKioskGeometry.width - calendarKioskGeometry.viewportWidth) <= 1 && Math.abs(calendarKioskGeometry.height - calendarKioskGeometry.viewportHeight) <= 1, `Calendar kiosk should fill the viewport, got ${calendarKioskGeometry.width}×${calendarKioskGeometry.height}`);
  assert.equal(calendarKioskGeometry.toolbarCount, 0, "Kiosk should remove the wallboard mode and rotation configuration");
  assert.equal(calendarKioskGeometry.metricsCount, 0, "Kiosk should remove the summary KPI strip");
  assert.equal(calendarKioskGeometry.brandTitleCount, 1, "Kiosk should retain the Defense Budget Intelligence identity");
  assert.equal(calendarKioskGeometry.brandEyebrowVisible, false, "Kiosk should remove the conference-room eyebrow");
  assert.equal(calendarKioskGeometry.workspaceName, "Local workspace", "Kiosk should identify the active workspace");
  assert.equal(calendarKioskGeometry.workspaceNameVisible, true, "Kiosk workspace identity should remain visible");
  assert.equal(calendarKioskGeometry.clockCount, 1, "Kiosk should retain one current-time display");
  assert.equal(calendarKioskGeometry.clockSupportingCopy, 0, "Kiosk should remove date and data-cutoff copy from the clock");
  assert.equal(calendarKioskGeometry.calendarControlsVisible, false, "Kiosk should hide calendar navigation and count controls");
  assert.equal(calendarKioskGeometry.calendarMonthHeadingVisible, true, "Kiosk should preserve the calendar month and year heading");
  assert.equal(calendarKioskGeometry.duplicateCalendarIconVisible, false, "Kiosk should hide the duplicate calendar workspace icon");
  assert.equal(calendarKioskGeometry.sectionEyebrowsVisible, false, "Kiosk should hide secondary section labels");
  assert.equal(calendarKioskGeometry.sectionCountsVisible, false, "Kiosk should hide secondary section count badges");
  await assertNoPageOverflow(page, "Minimal calendar kiosk");
  await page.screenshot({ path: `${OUT_DIR}/wallboard-calendar-kiosk-1080p.png` });
  await page.evaluate(() => document.exitFullscreen());
  await page.waitForFunction(() => document.querySelector("[data-ops-wallboard]")?.dataset.wallboardFullscreen === "false");
  assert.equal(await page.getByRole("button", { name: "Auto-cycle off" }).getAttribute("aria-pressed"), "false", "Entering kiosk should freeze the selected view by disabling auto-cycle");

  await page.getByRole("button", { name: "Next month" }).click();
  assert.match(await page.locator("[data-wallboard-calendar] > header").innerText(), /October 2026/i, "Calendar month navigation should advance one month");
  assert.equal(await page.locator('[data-calendar-event="event-ausa-annual-meeting-2026"]').count(), 1, "October should show AUSA as one multi-day bar");
  assert.equal(await page.locator('[data-calendar-event="event-eighth-annual-defense-conference-2026"]').count(), 1, "October should show the defense conference date");
  await page.getByRole("button", { name: "Next month" }).click();
  assert.match(await page.locator("[data-wallboard-calendar] > header").innerText(), /November 2026/i, "Calendar should support sequential month navigation");
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
    const targetDay = node.querySelector('[data-calendar-day="2026-09-16"]');
    const targetWeek = targetDay.closest(".ops-wall-calendar__week");
    const targetWeekBox = targetWeek.getBoundingClientRect();
    const dateBox = targetDay.querySelector("header").getBoundingClientRect();
    const laneBoxes = [...targetWeek.querySelectorAll('[data-calendar-lane="0"], [data-calendar-lane="1"]')].map((item) => {
      const box = item.getBoundingClientRect();
      return { top: box.top, bottom: box.bottom, height: box.height };
    });
    return {
      viewportClientWidth: viewport.clientWidth,
      viewportScrollWidth: viewport.scrollWidth,
      viewportOverflowX: getComputedStyle(viewport).overflowX,
      minControlHeight: Math.min(...[...node.querySelectorAll(".ops-wall-calendar__controls button, .ops-calendar-overlays button, .ops-wall-calendar__more")].map((button) => button.getBoundingClientRect().height)),
      documentWidth: document.documentElement.scrollWidth,
      windowWidth: innerWidth,
      weekHeight: targetWeekBox.height,
      dateHeaderHeight: dateBox.height,
      dateTopInset: dateBox.top - targetWeekBox.top,
      laneBoxes,
      lanesContained: laneBoxes.length >= 2 && laneBoxes.every((box) => box.top >= dateBox.bottom - 1 && box.bottom <= targetWeekBox.bottom + 1),
    };
  });
  assert.ok(mobileCalendarGeometry.viewportScrollWidth > mobileCalendarGeometry.viewportClientWidth, "Mobile calendar should preserve the month grid inside a contained horizontal scroller");
  assert.equal(mobileCalendarGeometry.viewportOverflowX, "auto", "Mobile calendar should expose intentional horizontal calendar scrolling");
  assert.ok(mobileCalendarGeometry.minControlHeight >= 44, `Mobile calendar controls should retain 44px targets, got ${mobileCalendarGeometry.minControlHeight}px`);
  assert.ok(mobileCalendarGeometry.documentWidth <= mobileCalendarGeometry.windowWidth + 1, "Mobile calendar must not overflow the document");
  assert.ok(mobileCalendarGeometry.weekHeight <= 91, `Mobile calendar weeks should stay compact, got ${mobileCalendarGeometry.weekHeight}px`);
  assert.ok(mobileCalendarGeometry.dateHeaderHeight <= 27, `Mobile calendar dates should sit at the top of each day, got a ${mobileCalendarGeometry.dateHeaderHeight}px header`);
  assert.ok(mobileCalendarGeometry.dateTopInset <= 1, `Mobile calendar dates should not carry extra top inset, got ${mobileCalendarGeometry.dateTopInset}px`);
  assert.equal(mobileCalendarGeometry.lanesContained, true, `Two mobile event lanes should fit completely inside the September 16 week: ${JSON.stringify(mobileCalendarGeometry.laneBoxes)}`);
  assert.ok(mobileCalendarGeometry.laneBoxes.every((box) => box.height <= 31), `Mobile event lanes should remain compact: ${JSON.stringify(mobileCalendarGeometry.laneBoxes)}`);
  const mobileBusyDayGeometry = await page.locator('[data-calendar-overflow="2026-09-14"]').evaluate((node) => {
    const summary = node.getBoundingClientRect();
    const day = document.querySelector('[data-calendar-day="2026-09-14"]').getBoundingClientRect();
    return {
      contained: summary.left >= day.left - 1 && summary.right <= day.right + 1 && summary.top >= day.top && summary.bottom <= day.bottom + 1,
      height: summary.height,
      compactVisible: getComputedStyle(node.querySelector(".ops-wall-calendar__more-compact")).display !== "none",
      fullVisible: getComputedStyle(node.querySelector(".ops-wall-calendar__more-full")).display !== "none",
    };
  });
  assert.equal(mobileBusyDayGeometry.contained, true, "The mobile busy-day summary should remain inside its date cell");
  assert.ok(mobileBusyDayGeometry.height >= 44, `The mobile busy-day summary should retain a 44px touch target, got ${mobileBusyDayGeometry.height}px`);
  assert.equal(mobileBusyDayGeometry.compactVisible, true, "Mobile busy dates should use the compact item-count summary");
  assert.equal(mobileBusyDayGeometry.fullVisible, false, "Mobile busy dates should hide the wider desktop overflow copy");
  const mobileWallboardChrome = await page.locator("[data-ops-wallboard]").evaluate((node) => {
    const bounds = node.getBoundingClientRect();
    const masthead = node.querySelector(".ops-wallboard__masthead");
    const toolbar = node.querySelector(".ops-wallboard__toolbar").getBoundingClientRect();
    const calendarHeader = node.querySelector("[data-wallboard-calendar] .if-calendar-header").getBoundingClientRect();
    const overlays = node.querySelector("[data-calendar-overlays]").getBoundingClientRect();
    const calendarViewport = node.querySelector(".ops-wall-calendar__viewport").getBoundingClientRect();
    const actions = [...node.querySelectorAll("[data-wallboard-action]")].map((button) => {
      const box = button.getBoundingClientRect();
      return { width: box.width, height: box.height };
    });
    const calendarSummary = node.querySelector(".if-calendar-header__summary");
    return {
      mastheadVisible: getComputedStyle(masthead).display !== "none",
      toolbarHeight: toolbar.height,
      toolbarRows: new Set([...node.querySelectorAll(".ops-wallboard__toolbar button")].map((button) => Math.round(button.getBoundingClientRect().top))).size,
      calendarHeaderHeight: calendarHeader.height,
      overlayHeight: overlays.height,
      chromeBeforeCalendar: calendarViewport.top - bounds.top,
      fullscreen: node.dataset.wallboardFullscreen,
      summaryDisplay: getComputedStyle(calendarSummary).display,
      countVisible: calendarSummary.getBoundingClientRect().height > 0,
      actions,
    };
  });
  assert.equal(mobileWallboardChrome.mastheadVisible, false, "The routed mobile wallboard must not repeat product identity below the application masthead");
  assert.ok(mobileWallboardChrome.toolbarHeight <= 53, `Mobile wallboard modes and actions should share one compact row, got ${mobileWallboardChrome.toolbarHeight}px`);
  assert.equal(mobileWallboardChrome.toolbarRows, 1, "Mobile wallboard navigation must not create a second action row");
  assert.ok(mobileWallboardChrome.calendarHeaderHeight <= 53, `Mobile month navigation should stay in one command row, got ${mobileWallboardChrome.calendarHeaderHeight}px`);
  assert.ok(mobileWallboardChrome.overlayHeight <= 53, `Mobile overlays should stay in one compact rail, got ${mobileWallboardChrome.overlayHeight}px`);
  assert.ok(mobileWallboardChrome.chromeBeforeCalendar <= 160, `The month grid should begin within 160px of the routed wallboard, got ${mobileWallboardChrome.chromeBeforeCalendar}px`);
  assert.equal(mobileWallboardChrome.countVisible, false, `Mobile wallboard should omit the redundant event-count bubble: ${JSON.stringify(mobileWallboardChrome)}`);
  assert.ok(mobileWallboardChrome.actions.every(({ width, height }) => width <= 45 && height >= 43.5), `Mobile wallboard actions should be compact 44px icon controls: ${JSON.stringify(mobileWallboardChrome.actions)}`);
  await page.screenshot({ path: `${OUT_DIR}/wallboard-calendar-mobile.png`, fullPage: true });

  await page.setViewportSize({ width: 844, height: 390 });
  const landscapeWallboardGeometry = await page.locator("[data-ops-wallboard]").evaluate((node) => {
    const bounds = node.getBoundingClientRect();
    const viewport = node.querySelector(".ops-wall-calendar__viewport").getBoundingClientRect();
    return {
      mastheadVisible: getComputedStyle(node.querySelector(".ops-wallboard__masthead")).display !== "none",
      toolbarHeight: node.querySelector(".ops-wallboard__toolbar").getBoundingClientRect().height,
      calendarHeaderHeight: node.querySelector("[data-wallboard-calendar] > header").getBoundingClientRect().height,
      overlayHeight: node.querySelector("[data-calendar-overlays]").getBoundingClientRect().height,
      chromeBeforeCalendar: viewport.top - bounds.top,
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: innerWidth,
    };
  });
  assert.equal(landscapeWallboardGeometry.mastheadVisible, false, "Landscape mobile must not repeat the application identity inside Wallboard");
  assert.ok(landscapeWallboardGeometry.toolbarHeight <= 53 && landscapeWallboardGeometry.calendarHeaderHeight <= 53 && landscapeWallboardGeometry.overlayHeight <= 53, `Landscape wallboard command bands must stay compact: ${JSON.stringify(landscapeWallboardGeometry)}`);
  assert.ok(landscapeWallboardGeometry.chromeBeforeCalendar <= 160, `Landscape month content should begin within 160px of Wallboard, got ${landscapeWallboardGeometry.chromeBeforeCalendar}px`);
  assert.ok(landscapeWallboardGeometry.documentWidth <= landscapeWallboardGeometry.viewportWidth + 1, "Landscape wallboard controls must not overflow the document");
  await page.screenshot({ path: `${OUT_DIR}/wallboard-calendar-mobile-landscape.png`, fullPage: true });

  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.locator("[data-ops-wallboard]").getByRole("button", { name: "Tracked records", exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll(".ops-wallboard__record").length === 8);
  assert.match(await page.locator("[data-ops-wallboard]").innerText(), /Tracked records\s+8/i, "Schedule Display should project tracked-record counts without an overview dashboard");
  assert.equal(await page.locator(".ops-wallboard__event").count(), 0, "Tracked-record display must not stack a second event surface");
  await assertNoPageOverflow(page, "Tracked-record display");
  await page.screenshot({ path: `${OUT_DIR}/schedule-display-records-1080p.png` });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openSurface(page, "#/budget-spend/explorer?spendView=timeline", "[data-transaction-analytics-page]");
  assert.equal(await page.locator("[data-capture-timeline-row]").first().locator(".capture-timeline__star").getAttribute("aria-pressed"), "true", "Tracking state should persist across application surfaces");
  await page.getByRole("button", { name: "Filters", exact: true }).click();
  assert.equal(await page.locator("[data-capture-filters] .capture-filter--advanced:visible").count(), 23, "Advanced factual filters should remain reachable");
  const workFilterTrigger = page.getByRole("button", { name: /^Type of work:/ });
  await workFilterTrigger.click();
  await page.getByLabel("Search Type of work").fill("Cloud infrastructure");
  await page.getByRole("option", { name: "Cloud infrastructure" }).click();
  await page.keyboard.press("Escape");
  const provenanceFilterTrigger = page.getByRole("button", { name: /^Ingestion provenance:/ });
  await provenanceFilterTrigger.click();
  await page.getByRole("option", { name: "Automated public feed" }).click();
  await page.keyboard.press("Escape");
  assert.match(await workFilterTrigger.getAttribute("aria-label"), /Type of work \(1\)/, "Work category should support searchable filtering");
  assert.match(await provenanceFilterTrigger.getAttribute("aria-label"), /Ingestion provenance \(1\)/, "Ingestion provenance should support searchable filtering");
  assert.match(decodeURIComponent(new URL(page.url()).hash), /capWork=.*cloud-infrastructure/, "Selected work category should be URL-backed");
  assert.match(decodeURIComponent(new URL(page.url()).hash), /capOrigin=.*automated/, "Selected ingestion provenance should be URL-backed");
  assert.ok(await page.locator("[data-capture-timeline] .capture-timeline__row").count() > 0, "Combined work and provenance filters should retain matching public records");
  await page.getByRole("button", { name: "Reset" }).click();
  await chooseControlSelect(page, "Subaward activity", "Has reported subawards");
  assert.match(decodeURIComponent(new URL(page.url()).hash), /capSubaward=has/, "Subaward posture should be URL-backed");
  assert.ok(await page.locator("[data-capture-timeline] .capture-timeline__row").count() > 0, "Subaward posture should retain exactly joined prime awards");
  await page.getByRole("button", { name: "Reset" }).click();
  const portfolioTrigger = page.getByRole("button", { name: /^Portfolio:/ });
  await portfolioTrigger.click();
  await page.getByLabel("Search Portfolio").fill("Navy Mission");
  await page.getByRole("option", { name: "Navy Mission Engineering" }).click();
  await page.getByLabel("Search Portfolio").fill("DAF Mission");
  await page.getByRole("option", { name: "DAF Mission Software" }).click();
  assert.match(await portfolioTrigger.getAttribute("aria-label"), /Portfolio \(2\)/, "Portfolio filter should support searchable multi-selection");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Reset" }).click();
  await page.getByRole("button", { name: "Close filters", exact: true }).click();
  assert.ok(await page.locator("[data-capture-timeline] .capture-timeline__row").count() > 50, "Transactions should render every matching timeline row instead of silently truncating at fifty");
  assert.equal(await page.locator("[data-capture-timeline] .capture-timeline__row").first().evaluate((node) => getComputedStyle(node).contentVisibility), "auto", "Full-result timelines should use browser-native row virtualization");
  assert.ok(await page.locator("[data-capture-timeline] .capture-timeline__urgency").count() > 50, "Every rendered row should expose date urgency without a composite score");
  const barBox = await page.locator("[data-capture-timeline] .capture-timeline__bar--base").first().boundingBox();
  assert.ok(barBox && barBox.height >= 20 && barBox.height <= 24, `Timeline bars should stay precisely formatted, got ${barBox?.height}px`);
  assert.ok(await page.locator("[data-capture-timeline] .capture-timeline__years small i").count() >= 12, "The default current window should expose at least three years of quarter guides");
  assert.equal(await page.locator("[data-capture-timeline] .capture-timeline__today").first().count(), 1, "Timeline should expose the source as-of marker");
  await page.getByRole("button", { name: "Display", exact: true }).click();
  await page.waitForSelector("[data-capture-gantt-dialog]");
  await page.getByRole("button", { name: /^Grouping:/ }).click();
  assert.equal(await page.locator('[data-if-picker-menu] [role="option"]').count(), 15, "Gantt should expose decision-priority grouping alongside the fourteen factual grouping modes");
  await page.getByRole("option", { name: "Decision priority" }).click();
  await page.getByRole("button", { name: /^Bar labels:/ }).click();
  assert.equal(await page.locator('[data-if-picker-menu] [role="option"]').count(), 6, "Gantt should expose six bar-label modes");
  await page.getByRole("option", { name: "Date ranges" }).click();
  assert.equal(await page.locator("[data-capture-gantt-dialog] .capture-gantt-toolgroup").count(), 3, "Gantt controls should be organized into time, display, and data groups");
  await page.locator("[data-capture-field-picker] summary").click();
  assert.equal(await page.locator("[data-capture-field-picker] input[type=checkbox]").count(), 15, "Gantt should expose fifteen configurable row fields");
  await page.locator("[data-capture-field-picker]").getByRole("checkbox", { name: "FPDS action count" }).check();
  await page.locator("[data-capture-field-picker]").getByRole("checkbox", { name: "Award / notice reference" }).check();
  await page.locator("[data-capture-field-picker]").getByRole("checkbox", { name: "Potential / high value" }).check();
  assert.match(await page.locator("[data-capture-timeline] .capture-timeline__fields").first().innerText(), /FPDS actions/, "Selected row fields should render immediately");
  assert.equal(await page.locator("[data-capture-field-picker] input[type=checkbox]:checked").count(), 4, "Gantt should cap visible row metadata at four fields");
  assert.ok(await page.locator("[data-capture-field-picker] input[type=checkbox]:not(:checked):disabled").count() >= 1, "Additional row fields should disable at the readability cap");
  await page.locator("[data-capture-field-picker] summary").click();
  await page.locator("[data-capture-gantt-dialog]").getByRole("button", { name: "Done" }).click();
  await page.waitForSelector("[data-capture-gantt-dialog]", { state: "detached" });
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
  assert.match(hoverText, /Latest FPDS action/i);
  await firstTimelineBar.focus();
  assert.equal(await page.locator("[data-capture-hovercard]").count(), 1, "Keyboard focus on an actual Gantt bar should expose contextual evidence");
  await page.getByRole("button", { name: "Display", exact: true }).click();
  await chooseControlSelect(page, "Grouping", "Funding office");
  await page.locator("[data-capture-gantt-dialog]").getByRole("button", { name: "Done" }).click();
  assert.ok(await page.locator("[data-capture-timeline] .capture-timeline__group").count() > 1, "Funding-office grouping should render factual group bands");

  await page.getByRole("button", { name: "Display", exact: true }).click();
  const classificationOverlayTrigger = page.getByRole("button", { name: /^Overlays:/ });
  await classificationOverlayTrigger.click();
  await page.getByRole("option", { name: "Type of work" }).click();
  await page.getByRole("option", { name: "Ingestion provenance" }).click();
  await classificationOverlayTrigger.click();
  await chooseControlSelect(page, "Grouping", "Work category");
  await page.locator("[data-capture-gantt-dialog]").getByRole("button", { name: "Done" }).click();
  assert.ok(await page.locator("[data-work-category-overlay]").count() > 50, "Every matching row should expose a contextual work-category lane");
  assert.ok(await page.locator("[data-ingestion-provenance-overlay]").count() > 50, "Every matching row should expose a contextual ingestion-provenance lane");
  const workOverlay = page.locator("[data-work-category-overlay]").first();
  await workOverlay.hover();
  assert.match(await page.locator("[data-capture-hovercard]").innerText(), /Type of work/i, "Work overlay hover should disclose category context");
  const provenanceOverlay = page.locator("[data-ingestion-provenance-overlay]").first();
  await provenanceOverlay.hover();
  assert.match(await page.locator("[data-capture-hovercard]").innerText(), /Ingestion provenance/i, "Provenance overlay hover should disclose import context");
  assert.ok(await page.locator("[data-capture-timeline] .capture-timeline__group").count() > 1, "Work-category grouping should render factual group bands");
  await page.screenshot({ path: `${OUT_DIR}/transactions-classification-overlays-desktop.png` });
  const desktopTimelineScroll = await page.locator("[data-capture-timeline]").evaluate((node) => ({ clientHeight: node.clientHeight, scrollHeight: node.scrollHeight }));
  assert.ok(desktopTimelineScroll.scrollHeight > desktopTimelineScroll.clientHeight, "Long Gantts should use a bounded internal vertical scroller");
  const desktopStickyTimelineHeader = await page.locator("[data-capture-timeline]").evaluate((node) => {
    node.scrollTop = Math.min(800, node.scrollHeight - node.clientHeight);
    const timeline = node.getBoundingClientRect();
    const label = node.querySelector(".capture-timeline__head.capture-timeline__label");
    const years = node.querySelector(".capture-timeline__head.capture-timeline__years");
    const labelRect = label?.getBoundingClientRect();
    const yearsRect = years?.getBoundingClientRect();
    return {
      scrollTop: node.scrollTop,
      timelineTop: timeline.top,
      labelTop: labelRect?.top,
      yearsTop: yearsRect?.top,
      labelPosition: label ? getComputedStyle(label).position : "",
      yearsPosition: years ? getComputedStyle(years).position : "",
    };
  });
  assert.ok(desktopStickyTimelineHeader.scrollTop > 0, "Sticky-header proof must measure the Gantt after a real vertical scroll");
  assert.equal(desktopStickyTimelineHeader.labelPosition, "sticky", "The Gantt identity header should remain sticky during a deep scroll");
  assert.equal(desktopStickyTimelineHeader.yearsPosition, "sticky", "The Gantt year and quarter scale should remain sticky during a deep scroll");
  assert.ok(Math.abs(desktopStickyTimelineHeader.labelTop - desktopStickyTimelineHeader.timelineTop) <= 1, `The Gantt identity header should stay pinned to the scroller top: ${JSON.stringify(desktopStickyTimelineHeader)}`);
  assert.ok(Math.abs(desktopStickyTimelineHeader.yearsTop - desktopStickyTimelineHeader.timelineTop) <= 1, `The Gantt year and quarter scale should stay pinned to the scroller top: ${JSON.stringify(desktopStickyTimelineHeader)}`);
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
  assert.equal(await page.getByRole("button", { name: "Follow-ons", exact: true }).getAttribute("aria-pressed"), "true", "Published follow-on activity should be a default visible layer");
  await page.waitForFunction(() => document.querySelectorAll("[data-followon-activity]").length > 0);
  assert.equal(transactionRequests, 0, "Follow-on relationships should not load the deferred FPDS action payload");
  await page.locator("[data-followon-activity]").first().hover();
  await page.waitForSelector("[data-capture-hovercard]");
  assert.match(await page.locator("[data-capture-hovercard]").innerText(), /predecessor PIID/i, "Follow-on overlay should disclose its predecessor join basis");
  assert.match(await page.locator("[data-capture-hovercard]").innerText(), /Agency acquisition forecast/i, "Follow-on overlay should disclose its source system");
  await page.locator("[data-followon-activity]").first().click();
  await page.waitForSelector("[data-followon-modal]");
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
  assert.equal(await resourceCount(page, "intelligence-graph-index.json"), 0, "The evidence graph must remain deferred until a record detail opens");
  assert.equal(await resourceCount(page, "contract-lineage-index.json"), 0, "Contract lineage must remain deferred until a record detail opens");
  assert.equal(await resourceCount(page, "temporal-evidence-index.json"), 0, "Temporal evidence must remain deferred until a record detail opens");
  assert.equal(await resourceCount(page, "intelligence-graph.json"), 0, "The full integrity graph must never be a browser dependency");
  const evidenceGraphReady = page.waitForResponse((response) => new URL(response.url()).pathname.endsWith("/data/intelligence-graph-index.json") && response.ok());
  const contractLineageReady = page.waitForResponse((response) => new URL(response.url()).pathname.endsWith("/data/contract-lineage-index.json") && response.ok());
  const temporalEvidenceReady = page.waitForResponse((response) => new URL(response.url()).pathname.endsWith("/data/temporal-evidence-index.json") && response.ok());
  await applicationSolicitation.click();
  await Promise.all([evidenceGraphReady, contractLineageReady, temporalEvidenceReady]);
  await page.waitForSelector("[data-capture-detail-modal]");
  await page.waitForSelector('[data-connected-evidence-state="ready"]');
  const connectedEvidence = page.locator("[data-connected-evidence]");
  const connectedEvidenceText = await connectedEvidence.innerText();
  assert.match(connectedEvidenceText, /Connected intelligence/i, "Record detail should expose its cross-surface evidence graph");
  assert.match(connectedEvidenceText, /organization|event|FPDS action/i, "Connected evidence should summarize typed neighboring entities");
  assert.match(connectedEvidenceText, /UEI|Office [A-Z0-9]+|Label-only identity|review required/i, "Connected organization evidence should disclose identifier or resolution state");
  assert.match(connectedEvidenceText, /SeaPort-NxG/i, "Application Arsenal should disclose its published acquisition path");
  assert.match(connectedEvidenceText, /N6600123F3509/i, "Application Arsenal should disclose its resolved predecessor");
  assert.equal(await connectedEvidence.locator("[data-acquisition-path]").count(), 1, "Published acquisition paths should render as typed lineage evidence");
  assert.equal(await connectedEvidence.locator("[data-contract-predecessor]").count(), 1, "Resolved predecessor relationships should render as typed lineage evidence");
  assert.equal(await connectedEvidence.locator('[data-temporal-status="conflicting"]').count(), 1, "Competing current and historical lifecycle claims should mark this record as conflicting");
  assert.equal(await connectedEvidence.locator('[data-evidence-conflict="needs_review"]').count(), 1, "Unresolved lifecycle disagreement should remain visible in the record drawer");
  assert.match(connectedEvidenceText, /historical · agent-records[\s\S]*active · opportunity-map-data/i, "Conflict disclosure should retain competing values and source artifacts");
  const connectedActivityId = await connectedEvidence.getAttribute("data-connected-evidence-id");
  assert.ok(connectedActivityId?.startsWith("opp_"), "Connected evidence should resolve from the stable opportunity identity");
  const connectedFullView = connectedEvidence.getByRole("link", { name: /Full view/i });
  assert.equal(await connectedFullView.count(), 1, "Every Connected Intelligence drawer should expose a durable full-page view");
  assert.match(await connectedFullView.getAttribute("href"), new RegExp(`domain-model\\?activity=${connectedActivityId}$`), "Full view should carry the stable activity identity");
  assert.ok(await connectedEvidence.locator(".connected-evidence__routes a").count() >= 2, "Connected evidence should link back into analytical working surfaces");
  await connectedEvidence.locator(".connected-evidence__evidence > summary").click();
  assert.match(await connectedEvidence.locator(".connected-evidence__evidence").innerText(), /exact|source declared|deterministic/i, "Connected evidence should disclose join basis and confidence");
  assert.equal(await resourceCount(page, "intelligence-graph-index.json"), 1, "Record drawers should load the deferred evidence index exactly once");
  assert.equal(await resourceCount(page, "contract-lineage-index.json"), 1, "Record drawers should load the deferred contract-lineage index exactly once");
  assert.equal(await resourceCount(page, "temporal-evidence-index.json"), 1, "Record drawers should load the deferred temporal evidence index exactly once");
  assert.equal(await resourceCount(page, "intelligence-graph.json"), 0, "Record drawers should use the bounded index rather than the full integrity graph");
  assert.equal(await page.locator(".capture-detail__secondary").getAttribute("open"), null, "Procurement diagnostics should stay collapsed when a record opens");
  await page.locator(".capture-detail__secondary > summary").click();
  const applicationDetail = await page.locator("[data-capture-secondary-facts]").innerText();
  assert.match(applicationDetail, /Full and open competitive procurement/i);
  assert.match(applicationDetail, /SeaPort NxG contract holders only/i);
  assert.match(applicationDetail, /Cost Plus Fixed Fee \(CPFF\) Level of Effort/i);
  await page.getByRole("button", { name: "Close record details" }).click();
  await page.waitForSelector("[data-capture-detail-modal]", { state: "detached" });
  await page.getByRole("button", { name: "Display", exact: true }).click();
  const overlayTrigger = page.getByRole("button", { name: /^Overlays:/ });
  await overlayTrigger.click();
  await page.getByRole("option", { name: "Competition / set-aside" }).click();
  await page.getByRole("option", { name: "Contract vehicle" }).click();
  await page.getByRole("option", { name: "Award / pricing type" }).click();
  await page.getByRole("option", { name: "FPDS annual obligations" }).click();
  await overlayTrigger.click();
  await page.locator("[data-capture-gantt-dialog]").getByRole("button", { name: "Done" }).click();
  assert.ok(await page.locator("[data-competition-overlay]").count() >= 2, "Application Arsenal solicitation and incumbent should retain their distinct competition classifications");
  assert.ok(await page.locator("[data-vehicle-overlay]").count() >= 2, "Application Arsenal solicitation and incumbent should retain their distinct vehicles");
  assert.ok(await page.locator("[data-structure-overlay]").count() >= 2, "Application Arsenal solicitation and incumbent should retain their distinct pricing structures");
  assert.ok(await page.locator('[data-pricing-kind="pricing-cost-reimbursable"]').count() >= 1, "Application Arsenal should distinguish its known cost-reimbursable structure");
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
  await page.waitForSelector("[data-followon-modal]");
  const applicationFollowOn = await page.locator("[data-followon-modal]").innerText();
  assert.match(applicationFollowOn, /Application Arsenal enterprise engineering/i);
  assert.match(applicationFollowOn, /Curated named-program predecessor crosswalk/i);
  assert.match(applicationFollowOn, /SAM\.gov/i);
  await page.getByRole("button", { name: "Close follow-on details" }).click();
  await page.waitForSelector("[data-followon-modal]", { state: "detached" });
  await page.getByPlaceholder("Program, company, reference, buyer").fill("ABMS Digital Infrastructure Consortium");
  await page.waitForFunction(() => [...document.querySelectorAll("[data-pricing-kind]")].some((node) => node.dataset.pricingKind === "pricing-fixed-price"));
  assert.ok(await page.locator('[data-pricing-kind="pricing-fixed-price"]').count() >= 1, "Pricing overlay should distinguish a known fixed-price row");
  await page.getByPlaceholder("Program, company, reference, buyer").fill("Kessel Run Falconer");
  await page.waitForFunction(() => [...document.querySelectorAll("[data-pricing-kind]")].some((node) => node.dataset.pricingKind === "pricing-time-materials"));
  assert.equal(await page.locator('[data-pricing-kind="pricing-time-materials"]').count(), 1, "Pricing overlay should distinguish a known T&M row");
  await page.getByPlaceholder("Program, company, reference, buyer").fill("");
  await page.getByPlaceholder("Program, company, reference, buyer").fill("N0002417C2100");
  await page.getByRole("button", { name: "Subawards", exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll("[data-subaward-overlay]").length > 0);
  assert.equal(subawardDetailRequests, 1, "Enabling the subaward overlay should lazily load recent detail once");
  const subawardMarker = page.locator("[data-subaward-overlay]").first();
  await subawardMarker.focus();
  await page.waitForSelector("[data-capture-hovercard]");
  assert.match(await page.locator("[data-capture-hovercard]").innerText(), /Subaward actions/i, "Subaward markers should expose keyboard-focus evidence");
  await subawardMarker.click();
  await page.waitForSelector("[data-capture-detail-modal]");
  await page.waitForSelector("[data-capture-subawards]");
  const subawardDetailText = await page.locator("[data-capture-subawards]").innerText();
  assert.match(subawardDetailText, /exact USAspending generated prime-award ID/i, "Subaward detail should disclose its exact join basis");
  assert.match(subawardDetailText, /retained/i, "Subaward detail should distinguish the bounded detail sample");
  await page.getByRole("button", { name: "Close record details" }).click();
  await page.waitForSelector("[data-capture-detail-modal]", { state: "detached" });
  await page.getByPlaceholder("Program, company, reference, buyer").fill("Application Arsenal");
  const fpdsReady = page.waitForResponse((response) => new URL(response.url()).pathname.endsWith("/data/capture-transactions.json") && response.ok());
  const fundingLayer = page.getByRole("button", { name: "Funding", exact: true });
  await fundingLayer.click();
  await page.waitForFunction(() => document.querySelector('[data-capture-gantt-section]')?.getAttribute('data-fpds-overlay-state') !== 'disabled');
  assert.equal(await fundingLayer.getAttribute("aria-pressed"), "true", "Funding layer should remain selected while its exact action feed loads");
  await fpdsReady;
  await page.waitForFunction(() => document.querySelector('[data-capture-gantt-section]')?.getAttribute('data-fpds-overlay-state') === 'ready', null, { timeout: 60_000 });
  await page.waitForFunction(() => document.querySelectorAll(".capture-timeline__action-marker").length > 0, null, { timeout: 60_000 });
  assert.equal(transactionRequests, 1, "Enabling the FPDS overlay should load the exact action feed once");
  assert.ok(await page.locator(".capture-timeline__action-marker").count() > 0, "FPDS feed should render timeline action pulses");
  const applicationActionRow = page.locator("[data-capture-timeline-row]").filter({ hasText: "C028" });
  await applicationActionRow.waitFor();
  const pageHeightBeforeModal = await page.evaluate(() => document.documentElement.scrollHeight);
  await applicationActionRow.click();
  await page.waitForSelector("[data-capture-detail-modal]");
  await page.waitForSelector("[data-capture-detail]");
  await page.waitForSelector("[data-capture-action-history]");
  assert.equal(await page.evaluate(() => document.documentElement.scrollHeight), pageHeightBeforeModal, "Opening record detail must not reflow or lengthen the page");
  assert.equal(transactionRequests, 1, "Opening an award should reuse the already-loaded FPDS history");
  assert.equal(await page.locator("[data-capture-action-chart]").count(), 1, "Selected award should expose cumulative obligations");
  assert.ok(await page.locator("[data-capture-action-table] tbody tr").count() >= 1, "Selected award should expose exact action rows");
  assert.equal(await page.locator("[data-capture-primary-facts] > .if-fact-grid__item").count(), 6, "Record detail should lead with six decision-critical facts");
  assert.equal(await page.locator(".capture-detail__secondary").getAttribute("open"), null, "Secondary procurement diagnostics should stay collapsed by default");
  await page.locator(".capture-detail__secondary > summary").click();
  assert.ok(await page.locator("[data-capture-secondary-facts] > .if-fact-grid__item").count() >= 9, "Expanded procurement diagnostics should retain the complete supporting metadata");
  await page.locator(".capture-detail__secondary > summary").click();
  const recordModalHeader = await page.locator("[data-capture-detail-modal] .if-drawer__header").evaluate((header) => {
    const title = header.querySelector("h2").getBoundingClientRect();
    const actions = header.querySelector(".if-drawer__actions").getBoundingClientRect();
    const bounds = header.getBoundingClientRect();
    return { titleRight: title.right, actionsLeft: actions.left, actionsRight: actions.right, headerRight: bounds.right };
  });
  assert.ok(recordModalHeader.titleRight <= recordModalHeader.actionsLeft && recordModalHeader.actionsRight <= recordModalHeader.headerRight + 1, `Gantt detail title and actions must not overlap: ${JSON.stringify(recordModalHeader)}`);
  await page.screenshot({ path: `${OUT_DIR}/transactions-detail-modal-desktop.png` });
  await page.keyboard.press("Escape");
  await page.waitForSelector("[data-capture-detail-modal]", { state: "detached" });
  assert.ok(!new URL(page.url()).hash.includes("capRecord="), "Closing the detail modal should remove the selected record from the shareable URL");

  await page.goto(`${BASE_URL}#/budget-spend/transactions?capGroup=unsupported&capLabels=unsupported&capFields=unsupported&capFeed=unsupported`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("[data-transaction-analytics-page]");
  await page.waitForFunction(() => !window.location.hash.includes("unsupported"));
  await page.getByRole("button", { name: "Display", exact: true }).click();
  await page.waitForSelector("[data-capture-gantt-dialog]");
  await page.getByRole("button", { name: /^Overlays:/ }).waitFor();
  assert.match(await page.getByRole("button", { name: /^Grouping:/ }).getAttribute("aria-label"), /Decision priority/, "Malformed grouping should canonicalize to the decision-first default");
  assert.match(await page.getByRole("button", { name: /^Overlays:/ }).getAttribute("aria-label"), /Overlays \(2\)/, "Malformed overlay selection should canonicalize to the two useful default layers");
  await page.locator("[data-capture-field-picker] summary").click();
  const checkedFields = page.locator("[data-capture-field-picker] input[type=checkbox]:checked");
  while (await checkedFields.count()) await checkedFields.first().uncheck();
  assert.equal(await page.locator("[data-capture-field-picker] summary").innerText(), "Row fields (0)", "Gantt should support a true title-only row display");
  assert.match(new URL(page.url()).hash, /capFields=none/, "Title-only field state should be shareable");
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector("[data-capture-timeline]");
  await page.getByRole("button", { name: "Display", exact: true }).click();
  await page.waitForSelector("[data-capture-gantt-dialog]");
  assert.equal((await page.locator("[data-capture-field-picker] summary").textContent())?.trim(), "Row fields (0)", "Title-only field state should survive reload");
  await page.locator("[data-capture-gantt-dialog]").getByRole("button", { name: "Done" }).click();
  await page.waitForSelector("[data-capture-gantt-dialog]", { state: "detached" });
  await page.locator("[data-capture-timeline]").scrollIntoViewIfNeeded();
  await page.locator("[data-capture-timeline] .capture-timeline__bar--base").first().hover();
  await page.waitForSelector("[data-capture-hovercard]");
  await page.screenshot({ path: `${OUT_DIR}/transactions-gantt-desktop.png` });

  await openSurface(page, "#/budget-spend/explorer?spendView=charts", "[data-transaction-d3-page]");
  assert.equal(await page.locator("[data-active-page-title]").innerText(), "Spend Explorer");
  assert.equal(await page.locator('[data-d3-analytics="dimension-explorer"]').count(), 1, "Overview should start with the shared dimensional ranking");
  assert.equal(await page.locator("[data-d3-analytics]").count(), 6, "Overview should expose six focused factual D3 views");
  assert.equal(await page.locator("[data-d3-analytics] .transaction-viz__scroller > svg").count(), 6, "Every visible Overview view should render its analytical SVG");
  assert.equal(await page.locator('[data-d3-analytics="value-distribution"]').count(), 1, "Overview should include a logarithmic reported-value distribution");
  assert.equal(await page.locator("[data-analytics-insight]").count(), 4, "Every analytics workspace should start with four recomputed factual signals");
  assert.match(await page.locator("[data-analytics-insights]").innerText(), /Leading work category[\s\S]*Leading recipient[\s\S]*Schedule coverage/i, "Overview signals should summarize concentration, near-term schedule, and coverage");
  assert.equal(await page.locator("[data-analytics-legend]").count(), 6, "Every visible chart should explain its visual encoding");
  const insightScopeBefore = Number((await page.locator('[data-analytics-records] > summary > span').innerText()).replace(/\D/g, ""));
  await page.locator('[data-analytics-insight="top-work"]').click();
  assert.match(await page.locator(".analytics-active-filters").innerText(), /Type of work:/, "Actionable factual signals should open their supporting slice");
  assert.ok(Number((await page.locator('[data-analytics-records] > summary > span').innerText()).replace(/\D/g, "")) < insightScopeBefore, "Insight drilldown should reduce the analytical universe");
  await page.locator('.analytics-active-filters button').click();
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
  assert.equal(await page.locator("[data-analytics-manager] .if-picker__trigger").count(), 9, "Analytics should expose eight searchable data facets and one chart manager");
  await page.getByRole("button", { name: /^Type of work:/ }).click();
  await page.getByLabel("Search Type of work").fill("software");
  await page.locator('[data-if-picker-menu] [role="option"]').first().click();
  await page.keyboard.press("Escape");
  assert.match(await page.locator(".analytics-active-filters").innerText(), /Type of work: 1/, "Searchable multi-select facets should filter the analytical universe");
  await page.locator(".analytics-active-filters button").filter({ hasText: "Type of work" }).click();
  await page.getByRole("button", { name: /^Visible charts:/ }).click();
  await page.locator('[data-if-picker-menu] [role="option"]').filter({ hasText: "Reported value distribution" }).click();
  await page.keyboard.press("Escape");
  assert.equal(await page.locator('[data-d3-analytics="value-distribution"]').count(), 0, "Chart management should remove an optional graph without changing the data filters");
  assert.equal(await page.locator("[data-d3-analytics]").count(), 5, "Hiding one Overview graph should leave five visible views");
  await page.getByRole("button", { name: /^Visible charts:/ }).click();
  await page.locator('[data-if-picker-menu] [role="option"]').filter({ hasText: "Reported value distribution" }).click();
  await page.keyboard.press("Escape");
  const overviewScopeBefore = Number((await page.locator('[data-analytics-records] > summary > span').innerText()).replace(/\D/g, ""));
  await page.locator('[data-d3-analytics="value-distribution"] [role="button"]').filter({ hasText: "Under $1M" }).click();
  assert.match(await page.locator('.analytics-active-filters').innerText(), /Under \$1M/, "Value bands should filter every analytical view");
  assert.ok(Number((await page.locator('[data-analytics-records] > summary > span').innerText()).replace(/\D/g, "")) < overviewScopeBefore, "Value-band filtering should reduce the record scope");
  await page.locator('.analytics-active-filters button').click();
  await page.locator('[data-d3-analytics="dimension-explorer"] [role="button"]').first().click();
  assert.equal(await page.locator('.analytics-active-filters button').count(), 1, "A dimension bar should cross-filter the analytical workspace");
  const overviewScopeAfter = Number((await page.locator('[data-analytics-records] > summary > span').innerText()).replace(/\D/g, ""));
  assert.ok(overviewScopeAfter < overviewScopeBefore, "Chart-driven filtering should reduce the record scope");
  await page.locator('.analytics-active-filters button').click();
  await page.getByRole("button", { name: "Schedule" }).click();
  assert.equal(await page.locator("[data-d3-analytics]").count(), 5, "Schedule should expose five focused temporal views");
  assert.match(await page.locator("[data-analytics-insights]").innerText(), /Busiest endpoint year[\s\S]*Median reported term[\s\S]*Undated schedule/i, "Schedule signals should summarize timing concentration and completeness");
  assert.equal(await page.locator("[data-analytics-legend]").count(), 5, "Schedule charts should explain their visual encodings");
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
  assert.equal(await page.locator("[data-d3-analytics]").count(), 7, "Spend should expose seven focused value, concentration, and structure views");
  assert.match(await page.locator("[data-analytics-insights]").innerText(), /Leading funding office[\s\S]*Acquisition structure[\s\S]*Subaward-bearing primes/i, "Spend signals should summarize concentration, structure, and subaward attachment");
  assert.equal(await page.locator('[data-d3-analytics="concentration-pareto"]').count(), 1, "Spend should expose recipient and funding-office concentration as a Pareto view");
  assert.match(await page.locator('[data-d3-analytics="concentration-pareto"] [data-analytics-legend]').innerText(), /cumulative share[\s\S]*80% concentration threshold/i, "Pareto should explain its obligation and cumulative-share encodings");
  await page.locator('[data-d3-analytics="concentration-pareto"] [role="button"]').first().click();
  assert.match(await page.locator('.analytics-active-filters').innerText(), /Recipient \/ sponsor:/, "Pareto bars should filter the full workspace to their supporting recipient slice");
  await page.locator('.analytics-active-filters button').click();
  await page.locator('[data-d3-analytics="concentration-pareto"] .transaction-viz__segmented button').filter({ hasText: "Funding offices" }).click();
  assert.match(await page.locator('[data-d3-analytics="concentration-pareto"]').innerText(), /Funding offices/i, "Pareto should switch between recipient and funding-office concentration");
  await page.screenshot({ path: `${OUT_DIR}/analytics-pareto-desktop.png`, fullPage: true });
  assert.equal(await page.locator('[data-d3-analytics="acquisition-matrix"]').count(), 1, "Spend should cross published pricing and competition classifications");
  assert.equal(await page.locator('[data-d3-analytics="subawards"]').count(), 1, "Spend should disclose exactly joined prime-to-subaward concentration");
  assert.equal(await page.locator('[data-d3-analytics="fiscal-trend"]').count(), 1, "Spend should expose annual obligation history by the selected dimension");
  assert.equal(await page.locator('[data-d3-analytics="vehicle-pricing"]').count(), 1, "Spend should expose vehicle and pricing composition separately");
  await page.locator('[data-d3-analytics="vehicle-pricing"] [role="button"]').first().click();
  assert.match(await page.locator('.analytics-active-filters').innerText(), /Contract vehicle:/, "Vehicle marks should drive the shared contract-vehicle filter");
  await page.locator('.analytics-active-filters button').click();
  await chooseControlSelect(page, "Dimension", "Pricing type");
  await chooseControlSelect(page, "Measure", "Records");
  assert.match(await page.locator('[data-d3-analytics="dimension-explorer"] header').innerText(), /Pricing type by records/i, "Dimension and measure controls should reconfigure the shared ranking");
  await page.locator('.analytics-search input').fill('Application Arsenal');
  assert.ok(Number((await page.locator('[data-analytics-records] > summary > span').innerText()).replace(/\D/g, "")) < overviewScopeBefore, "Search should cross-filter the record explorer and charts");
  assert.match(await page.locator('.analytics-export').innerText(), /Export/, "Filtered analytical slices should be exportable");
  await page.locator('.analytics-reset').click();
  await page.getByRole("button", { name: "Coverage & lineage" }).click();
  assert.equal(await page.locator("[data-d3-analytics]").count(), 6, "Coverage should expose six focused evidence, provenance, and quality views");
  assert.match(await page.locator("[data-analytics-insights]").innerText(), /Source-link coverage[\s\S]*Specific work coding[\s\S]*Snapshot changes/i, "Coverage signals should summarize factual completeness and change detection");
  assert.equal(await page.locator('[data-d3-analytics="provenance"]').count(), 1, "Coverage should include ingestion provenance");
  assert.equal(await page.locator('[data-d3-analytics="changes"]').count(), 1, "Coverage should include refresh changes");
  assert.equal(await page.locator('[data-d3-analytics="field-coverage"]').count(), 1, "Coverage should disclose field coverage");
  assert.equal(await page.locator('[data-d3-analytics="money-lineage"]').count(), 1, "Coverage should disclose money lineage and unresolved join gaps");
  assert.equal(await page.locator('[data-d3-analytics="source-coverage"]').count(), 1, "Coverage should expose source-system field completeness");
  assert.equal(await page.locator('[data-d3-analytics="evidence-risk"]').count(), 1, "Coverage should expose reported-value exposure by explicit evidence gaps");
  const evidenceCells = page.locator('[data-d3-analytics="evidence-risk"] [data-evidence-cell]');
  assert.equal(await evidenceCells.count(), 24, "Evidence matrix should cross four gap levels with six reported-value bands");
  const evidenceCellId = await evidenceCells.evaluateAll((nodes) => nodes.find((node) => Number(node.dataset.recordCount || 0) > 0)?.dataset.evidenceCell || "");
  assert.ok(evidenceCellId, "Evidence matrix should contain at least one populated supporting slice");
  await page.locator(`[data-d3-analytics="evidence-risk"] [data-evidence-cell="${evidenceCellId}"]`).click();
  assert.match(await page.locator('.analytics-active-filters').innerText(), /evidence gap|complete evidence/i, "Evidence cells should filter every view to their supporting records");
  await page.locator('.analytics-active-filters button').click();
  await page.screenshot({ path: `${OUT_DIR}/analytics-evidence-risk-desktop.png`, fullPage: true });
  await page.locator('[data-d3-analytics="source-coverage"] [role="button"]').first().click();
  assert.match(await page.locator('.analytics-active-filters').innerText(), /Source system:/, "Coverage cells should filter the record universe by source system");
  await page.locator('.analytics-active-filters button').click();
  await page.locator('[data-analytics-records] > summary').click();
  const analyticalDetailTrigger = page.locator('[data-analytics-records] tbody button').first();
  await analyticalDetailTrigger.click();
  await page.waitForSelector('[data-analytics-record-drawer]');
  await page.waitForSelector('[data-analytics-record-drawer] [data-connected-evidence-state="ready"]');
  assert.match(new URL(page.url()).hash, /analyticsRecord=/, "Analytical detail should own a shareable URL state");
  assert.match(await page.locator('[data-analytics-record-drawer]').innerText(), /Observed obligations|Reported potential/i);
  assert.equal(await page.locator('[data-analytics-record-drawer] .if-fact-grid').first().locator(':scope > .if-fact-grid__item').count(), 4, "Analytical detail should lead with four decision-critical facts");
  assert.equal(await page.locator('[data-analytics-record-drawer] .if-disclosure').getAttribute('open'), null, "Supporting analytical facts should stay collapsed by default");
  assert.match(await page.locator('[data-analytics-record-drawer] > .if-drawer__footer a').first().getAttribute('href'), /capRecord=/, "Analytical detail should deep-link to the exact Transactions record");
  assert.equal(await page.locator('[data-analytics-record-drawer] [data-connected-evidence]').count(), 1, "Analytical detail should reuse the canonical cross-surface evidence component");
  assert.equal(await resourceCount(page, "intelligence-graph-index.json"), 1, "Analytical detail should reuse the session-cached evidence index");
  assert.equal(await resourceCount(page, "contract-lineage-index.json"), 1, "Analytical detail should reuse the session-cached contract-lineage index");
  assert.equal(await resourceCount(page, "temporal-evidence-index.json"), 1, "Analytical detail should reuse the session-cached temporal evidence index");
  await page.screenshot({ path: `${OUT_DIR}/analytics-record-detail-desktop.png`, fullPage: true });
  assert.equal(await page.locator('[data-analytics-record-drawer] .if-drawer__actions .if-icon-btn').evaluate((node) => node === document.activeElement), true, "Analytical detail should focus its close control on open");
  await page.keyboard.press("Shift+Tab");
  assert.equal(await page.locator('[data-analytics-record-drawer]').evaluate((drawer) => drawer.contains(document.activeElement)), true, "Shift+Tab must wrap within analytical detail");
  await page.keyboard.press("Tab");
  assert.equal(await page.locator('[data-analytics-record-drawer] .if-drawer__actions .if-icon-btn').evaluate((node) => node === document.activeElement), true, "Tab must wrap back to the first analytical-detail control");
  await page.keyboard.press("Escape");
  await page.waitForSelector('[data-analytics-record-drawer]', { state: "detached" });
  assert.doesNotMatch(new URL(page.url()).hash, /analyticsRecord=/, "Closing analytical detail should clear its URL state");
  await page.waitForFunction(() => document.querySelector('[data-analytics-records] tbody button') === document.activeElement);
  assert.equal(await analyticalDetailTrigger.evaluate((node) => node === document.activeElement), true, "Closing analytical detail should restore focus to its trigger");
  await analyticalDetailTrigger.click();
  await page.waitForSelector('[data-analytics-record-drawer]');
  await page.goBack();
  await page.waitForSelector('[data-analytics-record-drawer]', { state: "detached" });
  assert.doesNotMatch(await page.locator("[data-transaction-d3-page]").innerText(), FORBIDDEN_SURFACE_TEXT);
  assert.match(await page.locator(".transaction-analytics-note").textContent(), /not the complete federal contract universe/i, "Analytics should disclose its coverage boundary");
  await page.screenshot({ path: `${OUT_DIR}/transactions-d3-desktop.png`, fullPage: true });

  await page.goto(`${BASE_URL}#/budget-spend/explorer?spendView=charts&analyticsView=bogus`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("[data-transaction-d3-page]");
  await page.waitForFunction(() => !window.location.hash.includes("analyticsView=bogus"));
  assert.equal(new URL(page.url()).hash, "#/budget-spend/explorer?spendView=charts", "Unknown analytical workspace values should canonicalize to Spend Explorer charts");

  await openSurface(page, "#/budget-spend/sources", "[data-analytics-sources-page]");
  assert.equal(await page.locator("[data-active-page-title]").innerText(), "Source Lineage");
  await page.waitForSelector("[data-intelligence-graph-summary]");
  const graphSummaryText = await page.locator("[data-intelligence-graph-summary]").innerText();
  assert.match(graphSummaryText, /888 activities[\s\S]*1,905 awards[\s\S]*3,085 exact FPDS actions/i, "Source Lineage should expose the canonical activity, award, and transaction spine");
  assert.match(graphSummaryText, /571 UEI-backed[\s\S]*50 reviewed office-code identities[\s\S]*11 ambiguous labels remain queued/i, "Source Lineage should expose organization identity coverage and unresolved conflicts");
  assert.match(graphSummaryText, /166 exact parent IDVs[\s\S]*206 linked orders[\s\S]*26 multi-order families/i, "Source Lineage should expose exact contract-family coverage");
  assert.match(graphSummaryText, /3 resolved predecessor links[\s\S]*237 review-only timing signals[\s\S]*18 claims remain unresolved/i, "Source Lineage should distinguish resolved lineage from review-only signals");
  assert.match(graphSummaryText, /120,493 current[\s\S]*14,226 historical[\s\S]*272 future[\s\S]*0 stale relationships/i, "Source Lineage should disclose relationship validity coverage");
  assert.match(graphSummaryText, /489 retained disagreements[\s\S]*408 resolved by newer current evidence[\s\S]*81 require review/i, "Source Lineage should separate deterministic supersession from unresolved conflicts");
  assert.match(graphSummaryText, /316 budget lines remain explicitly unresolved/i, "Source Lineage should keep unresolved crosswalks visible");
  assert.match(graphSummaryText, /FY2017–FY2026[\s\S]*1,986 Treasury accounts[\s\S]*7,986 execution balances[\s\S]*6,105 OMB revisions/i, "Source Lineage should disclose exact money lifecycle depth");
  assert.match(graphSummaryText, /Acquisition backbone[\s\S]*Protected source unavailable/i, "Source Lineage should disclose the blocked SAM source instead of implying coverage");
  assert.match(graphSummaryText, /Program intelligence[\s\S]*2,723 defense programs[\s\S]*2,755 request baselines[\s\S]*30 budget-sponsor offices/i, "Source Lineage should disclose program intelligence coverage");
  assert.match(graphSummaryText, /Request to enactment[\s\S]*35 page-cited House marks[\s\S]*enacted line-item amounts remain pending/i, "Source Lineage should disclose exact committee-mark coverage and the remaining enacted boundary");
  assert.match(graphSummaryText, /Official people and tenure[\s\S]*113 public professionals[\s\S]*294 official roles[\s\S]*4 sourced successions/i, "Source Lineage should disclose official people and tenure coverage");
  assert.match(graphSummaryText, /Organization Intelligence[\s\S]*100 prioritized dossiers[\s\S]*56 mission claims[\s\S]*60 financial summaries[\s\S]*254 open research gaps/i, "Source Lineage should disclose organization dossier and research-queue coverage");
  assert.match(graphSummaryText, /Industrial base[\s\S]*1,000 bounded supplier relationships[\s\S]*22 buyer profiles[\s\S]*235 vendor profiles/i, "Source Lineage should disclose bounded industrial-base coverage");
  assert.match(graphSummaryText, /Document intelligence[\s\S]*57 official documents[\s\S]*335 exact citations[\s\S]*embeddings remain unavailable/i, "Source Lineage should disclose document coverage and the embedding boundary");
  assert.equal(await resourceCount(page, "intelligence-graph-summary.json"), 1, "Source Lineage should load one lightweight graph summary");
  assert.equal(await page.locator('[data-analytics-sources-page] a[download][href$="/data/intelligence-graph.json.gzip"]').count(), 1, "Source Lineage should offer an explicit compressed integrity-graph download");
  assert.equal(await page.locator('[data-analytics-sources-page] a[download][href$="/data/organization-identity-review.json"]').count(), 1, "Source Lineage should offer an explicit organization identity review download");
  assert.equal(await page.locator('[data-analytics-sources-page] a[download][href$="/data/contract-lineage-review.json"]').count(), 1, "Source Lineage should offer an explicit contract-lineage review download");
  assert.equal(await page.locator('[data-analytics-sources-page] a[download][href$="/data/temporal-evidence-review.json"]').count(), 1, "Source Lineage should offer an explicit temporal and conflict review download");
  assert.equal(await page.locator('[data-analytics-sources-page] a[download][href$="/data/program-intelligence.json"]').count(), 1, "Source Lineage should offer the program intelligence artifact");
  assert.equal(await page.locator('[data-analytics-sources-page] a[download][href$="/data/roadmap-intelligence.json"]').count(), 1, "Source Lineage should offer the people, industrial-base, document, and operations artifact");
  assert.equal(await page.locator('[data-analytics-sources-page] a[download][href$="/data/organization-intelligence.json"]').count(), 1, "Source Lineage should offer organization dossiers and research queues");
  assert.equal(await page.locator("[data-source-flow] .if-ingest-stage").count(), 6, "Sources should trace six published data layers with the shared ingest-flow pattern");
  const sourceJoinPolicy = page.locator(".source-join-policy");
  assert.equal(await sourceJoinPolicy.locator(".if-relationship-bundle").count(), 6, "Sources should disclose six join rules with the shared relationship pattern");
  assert.equal(await sourceJoinPolicy.getAttribute("open"), null, "Secondary join methodology should start collapsed");
  await sourceJoinPolicy.locator("summary").click();
  assert.notEqual(await sourceJoinPolicy.getAttribute("open"), null, "Join methodology should remain available on demand");
  assert.equal(await page.locator("[data-source-health-monitor] details").count(), 5, "Sources should start with a bounded health summary instead of an eleven-card wall");
  await page.getByRole("button", { name: /Show all .* sources/ }).click();
  assert.ok(await page.locator("[data-source-health-monitor] details").count() > 5, "Sources should expose the full health inventory on demand");
  assert.doesNotMatch(await page.locator("[data-analytics-sources-page]").innerText(), FORBIDDEN_SURFACE_TEXT);

  await page.evaluate((activityId) => { window.location.hash = `#/budget-spend/domain-model?activity=${encodeURIComponent(activityId)}`; }, connectedActivityId);
  await page.waitForSelector(`[data-domain-record-view="${connectedActivityId}"] [data-connected-evidence-full-view="true"]`);
  assert.equal(await page.locator('[data-active-page-title]').innerText(), "Domain Model", "Connected Intelligence full views should live in the ADMIN Domain Model surface");
  assert.equal(await page.locator('[data-domain-record-view] [data-connected-evidence-id]').getAttribute("data-connected-evidence-id"), connectedActivityId, "Full-page evidence should preserve the exact stable record identity");
  assert.equal(await resourceCount(page, "intelligence-graph-index.json"), 1, "Full-page evidence should reuse the session-cached graph index");
  assert.equal(await resourceCount(page, "contract-lineage-index.json"), 1, "Full-page evidence should reuse the session-cached lineage index");
  assert.equal(await resourceCount(page, "temporal-evidence-index.json"), 1, "Full-page evidence should reuse the session-cached temporal index");
  await assertActiveGroupState(page, "workspace-admin", "Domain Model");

  await page.goto(`${BASE_URL}#/budget-spend/strategy`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("[data-pdb-request-page]");
  assert.equal(new URL(page.url()).hash, "#/budget-spend", "Legacy strategy URLs should canonicalize to the request analytics surface");
  assert.equal(await page.locator("[data-strategy-page]").count(), 0, "Legacy strategy surface should not render");
  await page.goto(`${BASE_URL}#/definitely-not-a-route`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.location.hash === "#/budget-spend/explorer");
  assert.equal(new URL(page.url()).hash, "#/budget-spend/explorer", "Unknown routes should canonicalize to the flagship Spend Timeline");
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector("[data-transaction-analytics-page]");
  await assertFlowShell(page);
  await assertNoPageOverflow(page, "Desktop analytics shell");
  await page.screenshot({ path: `${OUT_DIR}/analytics-flow-desktop.png`, fullPage: true });

  const ultrawide = await browser.newPage({ viewport: { width: 3440, height: 1440 } });
  await installVerificationDate(ultrawide);
  await ultrawide.goto(BASE_URL, { waitUntil: "domcontentloaded" });
  await ultrawide.waitForSelector("[data-defense-budget-app]");
  await ultrawide.waitForSelector("[data-transaction-analytics-page]");
  assert.equal(new URL(ultrawide.url()).hash, "#/budget-spend/explorer", "Spend Explorer should open on the Timeline by default");
  const ultrawideGeometry = await ultrawide.evaluate(() => {
    const contentNode = document.querySelector(".app__content");
    const content = contentNode?.getBoundingClientRect();
    const contentPadding = contentNode ? Number.parseFloat(getComputedStyle(contentNode).paddingLeft) : 0;
    const header = document.querySelector(".masthead__inner")?.getBoundingClientRect();
    const timeline = document.querySelector("[data-capture-timeline]")?.getBoundingClientRect();
    const controls = document.querySelector("[data-capture-gantt-commandbar]")?.getBoundingClientRect();
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
  await openSurface(ultrawide, "#/budget-spend/explorer?spendView=charts", "[data-transaction-d3-page]");
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
  await installVerificationDate(mobile);
  await mobile.goto(`${BASE_URL}#/budget-spend/explorer?spendView=today`, { waitUntil: "domcontentloaded" });
  await mobile.waitForSelector("[data-spend-today]");
  await assertFlowShell(mobile);
  assert.equal(await mobile.locator('[data-spend-explorer="today"] .spend-explorer__tabs .if-tab').count(), 4, "Mobile Spend Explorer should expose the four focused views");
  assert.ok(await mobile.locator("[data-decision-brief] .decision-brief__record-list > a").count() <= 4, "Mobile Decision Brief should start with a tightly bounded change list");
  const mobileBriefActions = await mobile.locator('[data-decision-brief] :is(.decision-brief__action, .decision-brief__record-list > a, .decision-brief__compact-list > a)').evaluateAll((nodes) => nodes.map((node) => ({ width: node.getBoundingClientRect().width, height: node.getBoundingClientRect().height })));
  assert.ok(mobileBriefActions.length > 0 && mobileBriefActions.every(({ width, height }) => width >= 43.5 && height >= 43.5), `Mobile Decision Brief actions should preserve 44px touch targets: ${JSON.stringify(mobileBriefActions)}`);
  await assertButtonIntegrity(mobile, "Mobile Decision Brief", '[data-spend-explorer="today"]');
  await assertNoPageOverflow(mobile, "Mobile Decision Brief");
  await mobile.screenshot({ path: `${OUT_DIR}/decision-brief-mobile.png`, fullPage: true });
  const mobileShellHeights = await mobile.locator("[data-mobile-more-menu-button], [data-notification-center-button], [data-profile-menu-trigger]").evaluateAll((nodes) => nodes.filter((node) => getComputedStyle(node).display !== "none").map((node) => node.getBoundingClientRect().height));
  assert.ok(mobileShellHeights.every((height) => height >= 43.5), `Mobile shell controls should preserve 44px touch targets: ${mobileShellHeights.join(", ")}`);
  assert.ok(await mobile.locator(".if-product-header__brand").evaluate((node) => node.getBoundingClientRect().height) >= 43.5, "Mobile product branding should preserve a 44px interaction target");
  assert.ok(await mobile.locator("[data-budget-spend-header]").evaluate((node) => node.getBoundingClientRect().height) <= 64, "Mobile masthead should use one compact application row");
  assert.equal(await mobile.locator(".if-product-header__eyebrow").evaluate((node) => getComputedStyle(node).display), "none", "The condensed mobile masthead should suppress its secondary eyebrow");
  await mobile.locator("[data-mobile-more-menu-button]").click();
  assert.equal(await mobile.locator("[data-mobile-more-menu] a[data-budget-nav]").count(), 13, "Mobile navigation should expose the reduced primary and grouped route set from one menu");
  assert.match(await mobile.locator("[data-mobile-more-menu]").textContent(), /Primary[\s\S]*Spend Explorer[\s\S]*Opportunity Map[\s\S]*Schedule[\s\S]*Budget & Spend[\s\S]*Work[\s\S]*Admin[\s\S]*Domain Model[\s\S]*Intelligence Operations/, "Mobile navigation should keep primary, budget, work, and administration groups visibly separated");
  await mobile.screenshot({ path: `${OUT_DIR}/navigation-groups-mobile.png` });
  await mobile.locator("[data-mobile-more-menu-button]").click();
  assert.equal(await mobile.locator('.ci-header-nav > a[data-budget-nav]:visible').count(), 0, "Mobile should remove the redundant persistent navigation row");
  await openSurface(mobile, "#/budget-spend/map", "[data-opportunity-map]");
  assert.ok(await mobile.locator('.opportunity-map__marker[role="button"]').count() >= 8, "Mobile Opportunity Map should retain the nationwide marker set");
  assert.ok(await mobile.locator("[data-opportunity-map-canvas]").evaluate((node) => node.getBoundingClientRect().height >= 459), "Mobile Opportunity Map should retain a tall, usable 460px geography canvas");
  const mobileMapGeometry = await mobile.evaluate(() => ({
    documentHeight: document.documentElement.scrollHeight,
    mapHeaderHeight: document.querySelector(".opportunity-map__map-header")?.getBoundingClientRect().height || 0,
    canvasTop: document.querySelector("[data-opportunity-map-canvas]")?.getBoundingClientRect().top || 0,
    advancedFilterCount: document.querySelectorAll(".opportunity-map__control-row--secondary").length,
  }));
  assert.ok(mobileMapGeometry.canvasTop <= 620, `Mobile geography should begin within a bounded introductory region, got ${mobileMapGeometry.canvasTop}px`);
  assert.ok(mobileMapGeometry.mapHeaderHeight <= 112, `Mobile map header should stay compact, got ${mobileMapGeometry.mapHeaderHeight}px`);
  assert.ok(mobileMapGeometry.documentHeight <= 1_400, `Default mobile map should keep the taller atlas within a bounded scroll surface, got ${mobileMapGeometry.documentHeight}px`);
  assert.equal(mobileMapGeometry.advancedFilterCount, 0, "Mobile advanced filters should stay collapsed by default");
  await mobile.getByRole("button", { name: "Find" }).click();
  assert.equal(await mobile.locator("[data-opportunity-map-directory]").evaluate((node) => getComputedStyle(node).position), "fixed", "Mobile location details should use a contained bottom sheet instead of extending the page");
  await mobile.keyboard.press("Escape");
  assert.equal(await mobile.locator("[data-opportunity-map-directory]").count(), 0, "Escape should close the mobile map drawer");
  const mobileMapControls = await mobile.locator('[data-opportunity-map] :is(button, .if-picker__trigger):visible').evaluateAll((nodes) => nodes.map((node) => ({ label: node.getAttribute("aria-label") || node.textContent.trim(), height: node.getBoundingClientRect().height })).filter(({ label }) => label));
  assert.ok(mobileMapControls.every(({ height }) => height >= 43.5), `Mobile map controls should preserve 44px touch targets: ${JSON.stringify(mobileMapControls)}`);
  await assertNoPageOverflow(mobile, "Mobile Opportunity Map");
  await mobile.screenshot({ path: `${OUT_DIR}/opportunity-map-mobile.png`, fullPage: true });
  await openSurface(mobile, "#/budget-spend", "[data-pdb-request-page]");
  const mobileRequestChrome = await mobile.evaluate(() => ({
    filters: document.querySelector("[data-budget-filter-bar]")?.getBoundingClientRect().height || 0,
    metrics: document.querySelector("[data-budget-metrics]")?.getBoundingClientRect().height || 0,
    freshnessCount: document.querySelectorAll("[data-freshness-strip]").length,
  }));
  assert.ok(mobileRequestChrome.filters <= 260, `Mobile request filters should use one search row and a fully visible two-column control grid, got ${mobileRequestChrome.filters}px`);
  assert.ok(mobileRequestChrome.metrics <= 220, `Mobile request KPIs should wrap into a bounded two-column grid, got ${mobileRequestChrome.metrics}px`);
  assert.equal(mobileRequestChrome.freshnessCount, 0, "Money-flow pages should not carry the integration-health strip");
  assert.ok(await mobile.locator("[data-pdb-request-page]").evaluate((node) => node.getBoundingClientRect().height) <= 80, "Mobile request intro should stay compact");
  assert.ok(await mobile.locator(".rank-list article").count() > 0, "Mobile request overview should render its current color-of-money records");
  await mobile.screenshot({ path: `${OUT_DIR}/request-overview-mobile.png`, fullPage: true });
  await assertNoPageOverflow(mobile, "Mobile request");

  await openSurface(mobile, "#/budget-spend/trends", "[data-request-history-page]");
  assert.ok(await mobile.locator("[data-request-history-page]").evaluate((node) => node.getBoundingClientRect().height) <= 80, "Mobile request-history intro should stay compact");
  assert.ok(await mobile.locator(".trend-metrics").evaluate((node) => node.getBoundingClientRect().height) <= 220, "Mobile request-history KPIs should use a bounded two-column grid");
  assert.ok(await mobile.locator("[data-request-history-timeline]").evaluate((node) => node.getBoundingClientRect().height) <= 760, "Mobile request vintages should use compact rows instead of nested fact-card walls");
  await mobile.screenshot({ path: `${OUT_DIR}/request-history-mobile.png`, fullPage: true });
  await assertNoPageOverflow(mobile, "Mobile request history");

  await openSurface(mobile, "#/budget-spend/lifecycle", "[data-account-spine-page]");
  const accountHeight = await mobile.getByRole("button", { name: /^Federal account:/ }).evaluate((node) => node.getBoundingClientRect().height);
  assert.ok(accountHeight >= 43.5, `Mobile account selector should be 44px, got ${accountHeight}`);
  assert.ok(await mobile.locator("[data-account-spine-page] .phase-intro").evaluate((node) => node.getBoundingClientRect().height) <= 120, "Mobile account-flow intro should stay compact");
  assert.ok(await mobile.locator("[data-lifecycle-waterfall]").evaluate((node) => node.getBoundingClientRect().height) <= 360, "Mobile account stages should read as one divided flow instead of four detached cards");
  await mobile.screenshot({ path: `${OUT_DIR}/account-flow-mobile.png`, fullPage: true });
  await assertNoPageOverflow(mobile, "Mobile account flow");

  await openSurface(mobile, "#/budget-spend/awards", "[data-awards-page]");
  assert.equal(await mobile.locator("[data-awards-page] > .if-workbench-header").count(), 1, "Mobile Awards should use one consolidated workbench surface");
  assert.equal(await mobile.locator("[data-award-record-table] [data-if-table-row]").count(), 5, "Mobile DataTables should default to five readable record cards instead of a 25-card wall");
  const mobileAwardCard = await mobile.locator("[data-award-record-table] [data-if-table-row]").first().evaluate((row) => ({
    height: row.getBoundingClientRect().height,
    primary: row.querySelectorAll('[data-table-mobile-layout="primary"]:not([data-table-mobile-visible="false"])').length,
    compact: row.querySelectorAll('[data-table-mobile-layout="compact"]:not([data-table-mobile-visible="false"])').length,
    wide: row.querySelectorAll('[data-table-mobile-layout="wide"]:not([data-table-mobile-visible="false"])').length,
  }));
  assert.deepEqual({ primary: mobileAwardCard.primary, compact: mobileAwardCard.compact, wide: mobileAwardCard.wide }, { primary: 1, compact: 3, wide: 1 }, `Mobile award cards should use one identity row, a compact fact grid, and one action row: ${JSON.stringify(mobileAwardCard)}`);
  assert.ok(mobileAwardCard.height <= 260, `Mobile award cards should stay compact, got ${mobileAwardCard.height}px`);
  const mobileAwardCardLayout = await mobile.locator("[data-award-record-table] [data-if-table-row]").first().evaluate((row) => {
    const rowRect = row.getBoundingClientRect();
    const selectRect = row.querySelector(".dbi-data-table__select")?.getBoundingClientRect();
    const actionRect = row.querySelector('[data-ui-table-cell-role="actions"]')?.getBoundingClientRect();
    return {
      rowWidth: rowRect.width,
      selectRightGap: selectRect ? rowRect.right - selectRect.right : Number.POSITIVE_INFINITY,
      actionWidth: actionRect?.width || 0,
    };
  });
  assert.ok(mobileAwardCardLayout.selectRightGap >= 0 && mobileAwardCardLayout.selectRightGap <= 8, `Mobile selection controls should stay in the card's top-right corner: ${JSON.stringify(mobileAwardCardLayout)}`);
  assert.ok(mobileAwardCardLayout.actionWidth >= mobileAwardCardLayout.rowWidth - 24, `Mobile action rows should use the full card width: ${JSON.stringify(mobileAwardCardLayout)}`);
  const mobileAwardTableControls = await mobile.locator("[data-award-record-table] .dbi-data-table__tools .if-btn, [data-award-record-table] .dbi-data-table__columns > summary, [data-award-record-table] .dbi-data-table__footer .if-page-btn, [data-award-record-table] .dbi-data-table__footer .if-select").evaluateAll((nodes) => nodes.filter((node) => getComputedStyle(node).display !== "none").map((node) => node.getBoundingClientRect().height));
  assert.ok(mobileAwardTableControls.every((height) => height >= 43.5), `Mobile DataTable controls should preserve 44px touch targets: ${mobileAwardTableControls.join(", ")}`);
  assert.ok(await mobile.evaluate(() => document.documentElement.scrollHeight) <= 3000, "Mobile Awards should stay within a bounded five-card working surface");
  await mobile.screenshot({ path: `${OUT_DIR}/awards-mobile.png`, fullPage: true });
  await assertNoPageOverflow(mobile, "Mobile awards");

  await openSurface(mobile, "#/budget-spend/explorer?spendView=timeline", "[data-transaction-analytics-page]");
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
  await mobile.getByRole("button", { name: "Filters", exact: true }).click();
  assert.equal(await mobile.locator("[data-capture-filters] .capture-filter--advanced:visible").count(), 23, "All advanced filters should remain reachable");
  await mobile.getByRole("button", { name: "Close filters", exact: true }).click();
  assert.equal(await mobile.locator("[data-targeting-chart]").count(), 0);
  assert.equal(await mobile.locator("[data-capture-workboard]").count(), 0);
  await mobile.getByRole("button", { name: "Display", exact: true }).click();
  await mobile.waitForSelector("[data-capture-gantt-dialog]");
  assert.equal(await mobile.locator("[data-capture-gantt-dialog]").evaluate((surface) => surface.closest("dialog")?.open), true, "Mobile Timeline controls should open in a focused dialog instead of pushing the Gantt below the viewport");
  const mobileGanttControlHeights = await mobile.locator("[data-capture-gantt-dialog] .if-picker__trigger, [data-capture-gantt-dialog] [data-capture-field-picker] summary").evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().height));
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
  assert.ok(mobileTimelineGeometry.labelWidth <= 152, `Mobile sticky labels should preserve the time plane, got ${mobileTimelineGeometry.labelWidth}px`);
  assert.ok(mobileTimelineGeometry.visibleTimePlane >= 140, `Mobile should expose a useful time-plane viewport, got ${mobileTimelineGeometry.visibleTimePlane}px`);
  const mobileStickyTimelineHeader = await mobile.locator("[data-capture-timeline]").evaluate((node) => {
    node.scrollTop = Math.min(800, node.scrollHeight - node.clientHeight);
    const timeline = node.getBoundingClientRect();
    const years = node.querySelector(".capture-timeline__head.capture-timeline__years");
    const yearsRect = years?.getBoundingClientRect();
    return { scrollTop: node.scrollTop, timelineTop: timeline.top, yearsTop: yearsRect?.top, yearsPosition: years ? getComputedStyle(years).position : "" };
  });
  assert.ok(mobileStickyTimelineHeader.scrollTop > 0, "Mobile sticky-header proof must measure the Gantt after a real vertical scroll");
  assert.equal(mobileStickyTimelineHeader.yearsPosition, "sticky", "The mobile Gantt year and quarter scale should remain sticky during a deep scroll");
  assert.ok(Math.abs(mobileStickyTimelineHeader.yearsTop - mobileStickyTimelineHeader.timelineTop) <= 1, `The mobile Gantt year and quarter scale should stay pinned to the scroller top: ${JSON.stringify(mobileStickyTimelineHeader)}`);
  await mobile.locator("[data-capture-gantt-dialog]").getByRole("button", { name: "Done" }).evaluate((button) => button.click());
  await mobile.waitForSelector("[data-capture-gantt-dialog]", { state: "detached" });
  await mobile.getByRole("button", { name: "Expand", exact: true }).click();
  const fullscreenBounds = await mobile.locator("[data-capture-gantt-section]").evaluate((node) => { const bounds = node.getBoundingClientRect(); return { top: bounds.top, left: bounds.left, width: bounds.width, height: bounds.height, viewportWidth: innerWidth, viewportHeight: innerHeight }; });
  assert.ok(fullscreenBounds.top <= 1 && fullscreenBounds.left <= 1 && fullscreenBounds.width >= fullscreenBounds.viewportWidth - 1 && fullscreenBounds.height >= fullscreenBounds.viewportHeight - 1, `Mobile Timeline expand should use the full viewport: ${JSON.stringify(fullscreenBounds)}`);
  await mobile.getByRole("button", { name: "Exit", exact: true }).click();
  await mobile.locator("[data-capture-timeline]").evaluate((node) => { node.scrollTop = 0; });
  const mobileTimelineRecordButton = mobile.locator("[data-capture-timeline] .capture-timeline__record-button").first();
  assert.ok(await mobileTimelineRecordButton.evaluate((node) => node.getBoundingClientRect().height >= 43.5), "Mobile Timeline row titles should provide a 44px touch target");
  await mobileTimelineRecordButton.tap();
  assert.equal(await mobile.locator("[data-capture-hovercard]").count(), 0, "Touch selection should not leave a hover card covering the timeline");
  await mobile.waitForSelector("[data-capture-detail-modal]");
  const mobileModalGeometry = await mobile.locator("[data-capture-detail-modal]").evaluate((node) => {
    const rect = node.getBoundingClientRect();
    return { width: rect.width, height: rect.height, viewportWidth: window.innerWidth, viewportHeight: window.innerHeight };
  });
  assert.ok(mobileModalGeometry.width <= mobileModalGeometry.viewportWidth, `Mobile detail modal must fit the viewport width, got ${mobileModalGeometry.width}px`);
  assert.ok(mobileModalGeometry.height <= mobileModalGeometry.viewportHeight, `Mobile detail modal must fit the viewport height, got ${mobileModalGeometry.height}px`);
  const mobileFactGeometry = await mobile.locator("[data-capture-primary-facts]").evaluate((node) => ({
    cards: node.children.length,
    columns: getComputedStyle(node).gridTemplateColumns.split(" ").length,
    height: node.getBoundingClientRect().height,
  }));
  assert.equal(mobileFactGeometry.cards, 6, "Mobile record detail should retain all six primary facts");
  assert.equal(mobileFactGeometry.columns, 2, "Mobile primary facts should use a compact two-column metadata grid");
  assert.ok(mobileFactGeometry.height <= 520, `Mobile primary facts should not become a vertical card wall, got ${mobileFactGeometry.height}px`);
  assert.equal(await mobile.locator(".capture-detail__secondary").getAttribute("open"), null, "Mobile secondary procurement diagnostics should stay collapsed until requested");
  await mobile.screenshot({ path: `${OUT_DIR}/transactions-detail-modal-mobile.png` });
  await mobile.getByRole("button", { name: "Close record details" }).evaluate((button) => button.click());
  await mobile.waitForSelector("[data-capture-detail-modal]", { state: "detached" });
  assert.equal(await mobile.getByRole("button", { name: "Data table" }).count(), 0, "Mobile Transactions must remain Gantt-only");
  assert.equal(await mobile.locator("[data-transaction-data-table]").count(), 0, "Mobile Transactions must not render a DataTable card view");
  await assertNoPageOverflow(mobile, "Mobile transactions");
  await mobile.locator("[data-capture-timeline]").scrollIntoViewIfNeeded();
  await mobile.screenshot({ path: `${OUT_DIR}/transactions-gantt-mobile.png` });

  await openSurface(mobile, "#/budget-spend/explorer?spendView=charts", "[data-transaction-d3-page]");
  assert.equal(await mobile.locator("[data-d3-analytics]").count(), 6);
  assert.equal(await mobile.locator("[data-d3-analytics]:visible").count(), 1, "Mobile Analytics should render one selected chart at a time");
  assert.equal(await mobile.locator(".analytics-mobile-chart-picker:visible").count(), 1, "Mobile Analytics should expose its chart switcher inside the workbench");
  const mobileChartMarks = await mobile.locator('[data-d3-analytics]:visible [role="button"][data-analytics-tooltip]').evaluateAll((nodes) => nodes.map((node) => ({ width: node.getBoundingClientRect().width, height: node.getBoundingClientRect().height })));
  assert.ok(mobileChartMarks.length > 0 && mobileChartMarks.every(({ width, height }) => width >= 43.5 && height >= 43.5), `Mobile chart marks should preserve 44px touch targets: ${JSON.stringify(mobileChartMarks)}`);
  const compactAnalyticsGeometry = await mobile.evaluate(() => ({
    workbench: document.querySelector("[data-transaction-d3-page] > .if-workbench-header")?.getBoundingClientRect().height || 0,
    metricColumns: getComputedStyle(document.querySelector("[data-transaction-d3-page] > .if-workbench-header > .if-management-grid--strip")).gridTemplateColumns.split(" ").filter(Boolean).length,
    brief: document.querySelector("[data-analytics-insights]")?.getBoundingClientRect().height || 0,
    briefBottom: document.querySelector("[data-analytics-insights]")?.getBoundingClientRect().bottom || 0,
    briefColumns: getComputedStyle(document.querySelector("[data-analytics-insights] .if-metric-grid")).gridTemplateColumns.split(" ").filter(Boolean).length,
    firstChartTop: document.querySelector("[data-d3-analytics]")?.getBoundingClientRect().top || 0,
  }));
  assert.equal(compactAnalyticsGeometry.metricColumns, 3, "Mobile Analytics should retain all six summary metrics in a compact 3×2 grid");
  assert.ok(compactAnalyticsGeometry.workbench <= 520, `Mobile Analytics title, metrics, tabs, and controls should remain one bounded workbench, got ${compactAnalyticsGeometry.workbench}px`);
  assert.equal(await mobile.locator("[data-analytics-insight]").count(), 4, "Mobile Analytics should retain the complete factual brief");
  assert.equal(compactAnalyticsGeometry.briefColumns, 2, "Mobile factual signals should use the framework two-column compact grid");
  assert.ok(compactAnalyticsGeometry.brief <= 410, `Mobile factual brief should stay dense, got ${compactAnalyticsGeometry.brief}px`);
  const compactAnalyticsChartGap = compactAnalyticsGeometry.firstChartTop - compactAnalyticsGeometry.briefBottom;
  assert.ok(compactAnalyticsChartGap >= 0 && compactAnalyticsChartGap <= 24, `Mobile Analytics should place the first chart immediately after the factual brief, got a ${compactAnalyticsChartGap}px gap`);
  const mobileWorkbenchControls = await mobile.locator('.if-workbench-header button').evaluateAll((nodes) => nodes.map((node) => ({ label: node.getAttribute("aria-label") || node.textContent.trim(), height: node.getBoundingClientRect().height, className: node.className })));
  assert.ok(mobileWorkbenchControls.every(({ height }) => height >= 43.5), `Mobile analytics controls should meet the 44px touch contract: ${JSON.stringify(mobileWorkbenchControls)}`);
  await mobile.locator("[data-analytics-manager] summary").click();
  const mobileAnalyticsManagerHeights = await mobile.locator("[data-analytics-manager] .if-picker__trigger").evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().height));
  assert.equal(mobileAnalyticsManagerHeights.length, 9, "Mobile should retain every data facet and the chart manager");
  assert.ok(mobileAnalyticsManagerHeights.every((height) => height >= 43.5), `Mobile analytics manager controls should be 44px: ${mobileAnalyticsManagerHeights.join(", ")}`);
  await assertNoPageOverflow(mobile, "Expanded mobile analytics manager");
  await mobile.locator("[data-analytics-manager] summary").click();
  assert.ok((await mobile.locator("[data-d3-analytics]").first().evaluate((node) => node.scrollWidth > node.clientWidth || node.querySelector(".transaction-viz__scroller")?.scrollWidth > node.querySelector(".transaction-viz__scroller")?.clientWidth)), "Mobile D3 charts should use contained horizontal scrolling");
  await assertNoPageOverflow(mobile, "Mobile D3 analytics");
  await mobile.screenshot({ path: `${OUT_DIR}/transactions-d3-mobile.png`, fullPage: true });

  await openSurface(mobile, "#/budget-spend/explorer?spendView=charts&analyticsView=spend", '[data-d3-analytics="concentration-pareto"]');
  assert.equal(await mobile.locator('[data-d3-analytics="concentration-pareto"]').count(), 1, "Mobile Spend should retain the concentration Pareto");
  assert.ok(await mobile.locator('[data-d3-analytics="concentration-pareto"] .transaction-viz__scroller').evaluate((node) => node.scrollWidth > node.clientWidth), "Mobile Pareto should stay inside its horizontal chart scroller");
  assert.ok(await mobile.locator('[data-d3-analytics="concentration-pareto"] .transaction-viz__segmented button').first().evaluate((node) => node.getBoundingClientRect().height >= 43.5), "Mobile Pareto dimension controls should meet the 44px touch contract");
  await assertNoPageOverflow(mobile, "Mobile Pareto analytics");

  await openSurface(mobile, "#/budget-spend/explorer?spendView=charts&analyticsView=coverage", '[data-d3-analytics="evidence-risk"]');
  assert.equal(await mobile.locator('[data-d3-analytics="evidence-risk"] [data-evidence-cell]').count(), 24, "Mobile Coverage should retain every evidence matrix cell");
  assert.ok(await mobile.locator('[data-d3-analytics="evidence-risk"] .transaction-viz__scroller').evaluate((node) => node.scrollWidth > node.clientWidth), "Mobile evidence matrix should stay inside its horizontal chart scroller");
  await assertNoPageOverflow(mobile, "Mobile evidence-risk analytics");

  await openSurface(mobile, "#/budget-spend/watchlist", "[data-operations-hub]");
  assert.equal(await mobile.locator("[data-admin-workspace]").count(), 0, "Mobile work surfaces should not repeat ownership navigation below the masthead");
  const mobileWorkHeaderHeight = await mobile.locator("[data-ops-watchlist] > .if-page-header").evaluate((node) => node.getBoundingClientRect().height);
  assert.ok(mobileWorkHeaderHeight <= 120, `Mobile Watchlist should expose a compact route header before the table, got ${mobileWorkHeaderHeight}px`);
  assert.equal(await mobile.locator(".operations-tabs").count(), 0, "Admin pages should not repeat route navigation inside the working surface");
  const mobileWorkboardStatus = mobile.locator(".target-workboard__status");
  if (await mobileWorkboardStatus.count()) {
    const statusGeometry = await mobileWorkboardStatus.evaluate((node) => ({ cards: node.children.length, height: node.getBoundingClientRect().height, clientWidth: node.clientWidth, scrollWidth: node.scrollWidth }));
    assert.equal(statusGeometry.cards, 7, "Target workboard should retain all six workflow stages and the due-soon count");
    assert.ok(statusGeometry.height <= 112, `Mobile target status should stay in one compact rail, got ${statusGeometry.height}px`);
    assert.ok(statusGeometry.scrollWidth > statusGeometry.clientWidth, "Mobile target status should use contained horizontal scrolling instead of another vertical card wall");
  }
  await assertNoPageOverflow(mobile, "Mobile Watchlist");
  await openSurface(mobile, "#/budget-spend/schedule?scheduleView=display", "[data-ops-wallboard]");
  const mobileWallboardEmpty = mobile.locator(".ops-wallboard__empty");
  if (await mobileWallboardEmpty.count()) {
    const emptyHeight = await mobileWallboardEmpty.first().evaluate((node) => node.getBoundingClientRect().height);
    assert.ok(emptyHeight <= 220, `Mobile wallboard empty states should stay concise, got ${emptyHeight}px`);
  }
  await assertNoPageOverflow(mobile, "Mobile wallboard");
  await mobile.screenshot({ path: `${OUT_DIR}/wallboard-mobile.png`, fullPage: true });

  await openSurface(mobile, "#/budget-spend/sources", "[data-analytics-sources-page]");
  const mobileSourcesHeroHeight = await mobile.locator(".analytics-sources .request-hero").evaluate((node) => node.getBoundingClientRect().height);
  assert.ok(mobileSourcesHeroHeight <= 185, `Mobile Sources should surface lineage without a tall introductory wall, got ${mobileSourcesHeroHeight}px`);
  assert.equal(await mobile.locator("[data-source-flow] .if-ingest-stage").count(), 6);
  assert.equal(await mobile.locator("[data-source-health-monitor] details").count(), 5, "Mobile Sources should not render the full health inventory by default");
  assert.equal(await mobile.locator("[data-source-health-monitor] details").evaluateAll((nodes) => nodes.filter((node) => getComputedStyle(node).display !== "none").length), 3, "Mobile Sources should show only three priority probes before explicit expansion");
  await assertNoPageOverflow(mobile, "Mobile sources");
  await mobile.screenshot({ path: `${OUT_DIR}/analytics-flow-mobile.png`, fullPage: true });

  await openSurface(mobile, "#/budget-spend/domain-model", "[data-domain-model-page]");
  assert.equal(await mobile.locator("[data-domain-entity-card]").count(), 83, "Mobile Domain Model should retain the complete entity inventory");
  const domainFilterHeights = await mobile.locator(".domain-model__filters button").evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().height));
  assert.ok(domainFilterHeights.every((height) => height >= 43.5), `Mobile domain filters must retain 44px touch targets: ${domainFilterHeights.join(", ")}`);
  await assertNoPageOverflow(mobile, "Mobile Domain Model");
  await mobile.screenshot({ path: `${OUT_DIR}/domain-model-mobile.png`, fullPage: true });

  await openSurface(mobile, "#/budget-spend/intelligence", "[data-intelligence-products-page]");
  const intelligenceTabHeights = await mobile.locator(".intelligence-products__tabs button").evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().height));
  assert.ok(intelligenceTabHeights.every((height) => height >= 43.5), `Mobile intelligence tabs must retain 44px touch targets: ${intelligenceTabHeights.join(", ")}`);
  await mobile.locator("[data-organization-dossier-link]").first().click();
  await mobile.locator("[data-organization-dossier]").waitFor({ state: "attached" });
  assert.equal(await mobile.locator("[data-dossier-research-gaps]").count(), 1, "Mobile organization dossiers should retain the research queue");
  await mobile.screenshot({ path: `${OUT_DIR}/organization-dossier-mobile.png`, fullPage: true });
  await mobile.getByRole("button", { name: "People & tenure" }).click();
  await mobile.locator("[data-official-people-panel]").waitFor({ state: "attached" });
  assert.equal(await mobile.locator("[data-official-people-panel]").count(), 1, "Mobile Intelligence Operations should retain official people coverage");
  await mobile.getByRole("button", { name: "Organization watch" }).click();
  await mobile.locator("[data-organization-watch-panel]").waitFor({ state: "attached" });
  assert.equal(await mobile.locator("[data-organization-monitor-source]").count(), 10, "Mobile Organization Watch should retain every monitored official source");
  await assertNoPageOverflow(mobile, "Mobile Intelligence Operations");
  await mobile.screenshot({ path: `${OUT_DIR}/intelligence-operations-mobile.png`, fullPage: true });

  await mobile.setViewportSize({ width: 360, height: 740 });
  await openSurface(mobile, "#/budget-spend/explorer?spendView=charts", "[data-transaction-d3-page]");
  const narrowAnalyticsGeometry = await mobile.evaluate(() => ({
    header: document.querySelector("[data-budget-spend-header]")?.getBoundingClientRect().height || 0,
    workbench: document.querySelector("[data-transaction-d3-page] > .if-workbench-header")?.getBoundingClientRect().height || 0,
    brief: document.querySelector("[data-analytics-insights]")?.getBoundingClientRect().height || 0,
    briefBottom: document.querySelector("[data-analytics-insights]")?.getBoundingClientRect().bottom || 0,
    firstChartTop: document.querySelector("[data-d3-analytics]")?.getBoundingClientRect().top || 0,
  }));
  assert.ok(narrowAnalyticsGeometry.header <= 64, `360px masthead should stay within one compact application row, got ${narrowAnalyticsGeometry.header}px`);
  assert.ok(narrowAnalyticsGeometry.workbench <= 540, `360px Analytics workbench should stay bounded, got ${narrowAnalyticsGeometry.workbench}px`);
  assert.ok(narrowAnalyticsGeometry.brief <= 420, `360px factual brief should remain compact, got ${narrowAnalyticsGeometry.brief}px`);
  const narrowAnalyticsChartGap = narrowAnalyticsGeometry.firstChartTop - narrowAnalyticsGeometry.briefBottom;
  assert.ok(narrowAnalyticsChartGap >= 0 && narrowAnalyticsChartGap <= 24, `360px Analytics should place the first chart immediately after the factual brief, got a ${narrowAnalyticsChartGap}px gap`);
  await assertNoPageOverflow(mobile, "360px Analytics");

  console.log(`Verified ${REMOTE_BASE_URL ? "hosted" : "local"} analytics flow: primary_surfaces=3 map=nationwide-spend-scaled schedule_views=3 spend_views=4 grouped_routes=9 money_flow_routes=5 work_routes=2 workspace_admin_routes=3 domain_model=full-view inspectors=drawers editors=dialogs watchlist=stable-id tasks=unified connections=3 integrations=8 contract_monitor>=500 api_activity=audited request_records>3000 accounts>100 awards>600 opportunities>=875 normalized_source_rows=198 automated_imports>=677 events>=502 fpds_actions=3085 d3_views=21 searchable_facets=8 chart_management=true contextual_hover=true subaward_counts=exact subaward_details=deferred_sample`);
} finally {
  await browser.close();
  if (server) server.kill("SIGTERM");
}
