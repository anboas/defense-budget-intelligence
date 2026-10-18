import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { chromium } from "playwright-core";

const BASE_URL = "http://127.0.0.1:4196/";
const OUT_DIR = "test-results/ui-consistency";
const VERIFY = process.argv.includes("--verify");
const ROUTES = [
  ["brief", "#/budget-spend/explorer?spendView=today", "[data-spend-today]"],
  ["radar", "#/budget-spend/explorer?spendView=radar", "[data-opportunity-radar]"],
  ["visuals", "#/budget-spend/explorer?spendView=visuals", "[data-opportunity-portfolio-visuals]"],
  ["timeline", "#/budget-spend/timeline?timelineScope=all", "[data-capture-timeline]"],
  ["timeline-embedded", "#/budget-spend/explorer?spendView=timeline", "[data-capture-timeline]"],
  ["workbench", "#/budget-spend/explorer?spendView=table", "[data-spend-explorer='table']"],
  ["workbench-expanded", "#/budget-spend/explorer?spendView=table", "[data-spend-explorer='table']"],
  ["analytics", "#/budget-spend/explorer?spendView=charts", "[data-transaction-d3-page]"],
  ["map", "#/budget-spend/map", "[data-opportunity-map]"],
  ["request", "#/budget-spend", "[data-pdb-request-page]"],
  ["history", "#/budget-spend/trends", "[data-request-history-page]"],
  ["account-flow", "#/budget-spend/lifecycle", "[data-account-spine-page]"],
  ["awards", "#/budget-spend/awards", "[data-awards-page]"],
  ["my-work", "#/budget-spend/watchlist", "[data-my-work]"],
  ["tasks", "#/budget-spend/tasks", "[data-ops-task-center]"],
  ["schedule", "#/budget-spend/schedule", "[data-schedule-surface]"],
  ["connections", "#/budget-spend/connections", "[data-connections-surface]"],
  ["domain-model", "#/budget-spend/domain-model", "[data-domain-model-page]"],
  ["data-library", "#/budget-spend/library", "[data-data-library-page]"],
  ["intelligence-graph", "#/budget-spend/intelligence-graph", "[data-intelligence-graph-page]"],
  ["intelligence", "#/budget-spend/intelligence", "[data-intelligence-products-page]"],
  ["sources", "#/budget-spend/sources", "[data-analytics-sources-page]"],
  ["profile", "#/profile", "[data-profile-page]"],
];
const VIEWPORTS = [
  ["desktop", { width: 1440, height: 1000 }],
  ["laptop", { width: 1200, height: 675 }],
  ["mobile", { width: 390, height: 844 }],
  ["ultrawide", { width: 1920, height: 1080 }],
].filter(([name]) => !VERIFY || name !== "ultrawide");

mkdirSync(OUT_DIR, { recursive: true });
const fixtureRecords = JSON.parse(readFileSync("public/data/capture-calendar.json", "utf8")).records.slice(0, 5);
const fixtureWatches = fixtureRecords.map((record, index) => ({
  recordId: record.opportunityId,
  starredAt: "2026-10-10T12:00:00.000Z",
  updatedAt: "2026-10-15T12:00:00.000Z",
  reviewAt: index < 3 ? `2026-10-${String(19 + index).padStart(2, "0")}` : "",
  note: index === 0 ? "Confirm the customer follow-up and vehicle path." : "",
  wallboard: true,
  pursuit: index === 0 ? {
    stage: "capture",
    owner: "Adam",
    nextAction: "Prepare customer follow-up",
    tasks: [{ id: "ui-audit-task", title: "Prepare customer follow-up", status: "todo", priority: "high", dueAt: "2026-10-16", owner: "Adam", sourceType: "timeline", sourceId: "ui-audit", sourceLabel: "Published deadline", createdAt: "2026-10-10T12:00:00.000Z", completedAt: "" }],
  } : undefined,
}));

async function waitForServer(timeoutMs = 60_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(BASE_URL);
      if (response.ok) return;
    } catch {
      // The development server may refuse connections while Vite is starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for ${BASE_URL}`);
}

function rounded(value) {
  return Math.round(Number(value || 0) * 10) / 10;
}

async function collect(page, route, viewport) {
  return page.evaluate(({ routeName, viewportName }) => {
    const visible = (node) => {
      const style = getComputedStyle(node);
      const rect = node.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity || 1) > 0 && rect.width > 0 && rect.height > 0;
    };
    const controlGroupSelector = ".if-page-header__actions, .analysis-actions, .award-filter-bar, .analytics-commandbar__controls, .analytics-commandbar__secondary, .dbi-data-table__toolbar, .dbi-data-table__tools, .dbi-data-table__filters, .dbi-table-actions, .capture-filters__heading, .capture-gantt-commandbar__group, .capture-gantt-commandbar__actions, [data-ui-control-group]";
    const describe = (node, kind) => {
      const style = getComputedStyle(node);
      const rect = node.getBoundingClientRect();
      const group = node.closest(controlGroupSelector) || node.parentElement;
      return {
        kind,
        tag: node.tagName.toLowerCase(),
        text: (node.getAttribute("aria-label") || node.getAttribute("title") || node.textContent || "").trim().replace(/\s+/g, " ").slice(0, 96),
        className: typeof node.className === "string" ? node.className : node.className?.baseVal || "",
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
        fontSize: Number.parseFloat(style.fontSize),
        lineHeight: Number.parseFloat(style.lineHeight),
        fontWeight: style.fontWeight,
        radius: Number.parseFloat(style.borderRadius),
        paddingTop: Number.parseFloat(style.paddingTop),
        paddingRight: Number.parseFloat(style.paddingRight),
        paddingBottom: Number.parseFloat(style.paddingBottom),
        paddingLeft: Number.parseFloat(style.paddingLeft),
        controlGroup: group ? `${group.tagName.toLowerCase()}.${typeof group.className === "string" ? group.className : ""}@${Math.round(group.getBoundingClientRect().y)}` : "",
      };
    };
    const selectors = {
      action: "button, a.if-btn, summary",
      field: "input:not([type='checkbox']):not([type='radio']), textarea, select, [role='combobox']",
      heading: "h1, h2, h3, h4",
      label: "label, .if-field__label",
      tableHeader: "th",
      tableCell: "td",
      meta: "small, .if-eyebrow, .if-page-header__eyebrow",
    };
    // Graph nodes and relationship labels are analytical marks with dedicated
    // overlap, routing, accessibility, and touch contracts. Comparing their
    // geometry as neighboring form controls produces noise and obscures the
    // toolbar and page-control inconsistencies this audit owns.
    const elements = Object.entries(selectors).flatMap(([kind, selector]) => [...document.querySelectorAll(selector)].filter((node) => visible(node) && !node.closest("svg") && !node.closest(".if-graph-viewport") && !node.closest(".if-graph-a11y") && !node.closest("[data-ui-audit-exempt]")) .map((node) => describe(node, kind)));
    const controls = elements.filter((item) => item.kind === "action" || item.kind === "field");
    const adjacentMismatches = [];
    for (let leftIndex = 0; leftIndex < controls.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < controls.length; rightIndex += 1) {
        const left = controls[leftIndex];
        const right = controls[rightIndex];
        const overlap = Math.min(left.y + left.height, right.y + right.height) - Math.max(left.y, right.y);
        const sameRow = overlap >= Math.min(left.height, right.height) * 0.68;
        const gap = Math.max(right.x - (left.x + left.width), left.x - (right.x + right.width), 0);
        if (!sameRow || gap > 18 || left.controlGroup !== right.controlGroup) continue;
        const pairClasses = `${left.className} ${right.className}`;
        const intentionalIconPair = pairClasses.includes("capture-timeline__star") && pairClasses.includes("capture-timeline__record-button");
        const mobileHeaderPair = pairClasses.includes("ci-header-command-trigger") && pairClasses.includes("ci-header-mobile-trigger");
        if (intentionalIconPair || mobileHeaderPair) continue;
        const heightDelta = Math.abs(left.height - right.height);
        const fontDelta = Math.abs(left.fontSize - right.fontSize);
        const radiusDelta = Math.abs(left.radius - right.radius);
        if (heightDelta <= 2 && fontDelta <= 1 && radiusDelta <= 1) continue;
        adjacentMismatches.push({ left, right, heightDelta, fontDelta, radiusDelta, gap });
      }
    }
    const clusters = {};
    for (const item of elements) {
      const key = [item.kind, Math.round(item.height), item.fontSize, item.fontWeight, item.radius].join("|");
      clusters[key] = (clusters[key] || 0) + 1;
    }
    const aboveFoldControls = controls.filter((item) => item.y + item.height > 0 && item.y < innerHeight && item.x + item.width > 0 && item.x < innerWidth).length;
    const headingTexts = elements.filter((item) => item.kind === "heading").map((item) => item.text).filter(Boolean);
    const duplicateHeadings = [...new Set(headingTexts.filter((text, index) => headingTexts.indexOf(text) !== index))];
    const detail = document.querySelector("[data-opportunity-workbench-detail]");
    const primarySurface = document.querySelector("[data-opportunity-workbench-detail] [data-connected-visual-analysis]");
    const detailRect = detail?.getBoundingClientRect();
    const primaryRect = primarySurface?.getBoundingClientRect();
    return {
      route: routeName,
      viewport: viewportName,
      document: { width: document.documentElement.scrollWidth, viewportWidth: innerWidth, height: document.documentElement.scrollHeight, viewportHeight: innerHeight },
      hierarchy: { aboveFoldControls, duplicateHeadings },
      valueDensity: {
        detailToAnalysis: detailRect && primaryRect ? primaryRect.top - detailRect.top : null,
        visibleAnalysisHeight: primaryRect ? Math.max(0, Math.min(innerHeight, primaryRect.bottom) - Math.max(0, primaryRect.top)) : null,
        analysisWidth: primaryRect?.width || null,
      },
      elements,
      clusters,
      adjacentMismatches: adjacentMismatches.slice(0, 100),
    };
  }, { routeName: route, viewportName: viewport });
}

const server = spawn("./node_modules/.bin/vite", ["--host", "127.0.0.1", "--port", "4196", "--strictPort"], { stdio: "ignore" });
await waitForServer();
const executablePath = [process.env.CHROMIUM_PATH, "/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium-browser", "/usr/bin/chromium"].find((candidate) => candidate && existsSync(candidate));
const browser = await chromium.launch({ ...(executablePath ? { executablePath } : {}), headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
const report = [];

try {
  for (const [viewportName, viewport] of VIEWPORTS) {
    const page = await browser.newPage({ viewport });
    await page.addInitScript((watches) => {
      localStorage.setItem("dbi:watchlist:v1", JSON.stringify(watches));
    }, fixtureWatches);
    for (const [routeName, route, selector] of ROUTES) {
      if (viewportName === "laptop" && routeName !== "workbench-expanded") continue;
      console.error(`[ui-audit] ${viewportName} ${routeName}`);
      await page.goto(`${BASE_URL}${route}`, { waitUntil: "domcontentloaded" });
      await page.waitForSelector("[data-defense-budget-app]");
      await page.waitForSelector(selector, { timeout: 8_000 }).catch(() => {});
      await page.waitForTimeout(220);
      if (routeName === "my-work") {
        const first = page.locator("[data-ops-watch-table] tbody tr[data-row-expandable='true']").first();
        if (await first.count()) await first.click();
      }
      if (routeName === "workbench-expanded") {
        const first = page.locator('[data-dbi-data-table="opportunity-workbench-v1"] [data-if-table-row]').first();
        if (await first.count()) await first.click();
        await page.waitForSelector('[data-opportunity-workbench-detail] [data-connected-evidence-state="ready"]');
        await page.waitForSelector('[data-opportunity-workbench-detail] [data-connected-visual-analysis]');
      }
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.waitForTimeout(80);
      report.push(await collect(page, routeName, viewportName));
      if (!VERIFY && (viewportName !== "ultrawide" || ["my-work", "workbench", "visuals", "map", "schedule"].includes(routeName))) {
        await page.screenshot({ path: `${OUT_DIR}/${routeName}-${viewportName}.png`, fullPage: true });
      }
    }
    await page.close();
  }
} finally {
  await browser.close();
  server.kill("SIGTERM");
}

const normalized = report.map((entry) => ({
  ...entry,
  elements: entry.elements.map((item) => Object.fromEntries(Object.entries(item).map(([key, value]) => [key, typeof value === "number" ? rounded(value) : value]))),
  adjacentMismatches: entry.adjacentMismatches.map((mismatch) => ({
    ...mismatch,
    heightDelta: rounded(mismatch.heightDelta),
    fontDelta: rounded(mismatch.fontDelta),
    radiusDelta: rounded(mismatch.radiusDelta),
    gap: rounded(mismatch.gap),
  })),
}));
writeFileSync(`${OUT_DIR}/report.json`, `${JSON.stringify(normalized, null, 2)}\n`);

const summary = normalized.map((entry) => ({
  route: entry.route,
  viewport: entry.viewport,
  overflow: Math.max(0, entry.document.width - entry.document.viewportWidth),
  viewportLengths: rounded(entry.document.height / entry.document.viewportHeight),
  controls: entry.elements.filter((item) => item.kind === "action" || item.kind === "field").length,
  aboveFoldControls: entry.hierarchy.aboveFoldControls,
  duplicateHeadings: entry.hierarchy.duplicateHeadings,
  clusters: Object.keys(entry.clusters).length,
  adjacentMismatches: entry.adjacentMismatches.length,
}));
console.log(JSON.stringify(summary, null, 2));

if (VERIFY) {
  const violations = [];
  for (const entry of normalized) {
    const overflow = Math.max(0, entry.document.width - entry.document.viewportWidth);
    if (overflow > 1) violations.push(`${entry.viewport}/${entry.route}: page overflow ${overflow}px`);
    const viewportLengths = entry.document.height / entry.document.viewportHeight;
    const maximumViewportLengths = 5;
    if (viewportLengths > maximumViewportLengths) violations.push(`${entry.viewport}/${entry.route}: unbounded page length ${rounded(viewportLengths)} viewports`);
    if (entry.hierarchy.aboveFoldControls > 100) violations.push(`${entry.viewport}/${entry.route}: ${entry.hierarchy.aboveFoldControls} controls compete above the fold`);
    if (entry.route === "workbench-expanded" && ["desktop", "laptop"].includes(entry.viewport)) {
      if (entry.valueDensity.detailToAnalysis > 150) violations.push(`${entry.viewport}/${entry.route}: analysis begins ${rounded(entry.valueDensity.detailToAnalysis)}px below record context`);
      const minimumVisibleAnalysis = entry.viewport === "laptop" ? 180 : 300;
      const minimumAnalysisWidth = entry.viewport === "laptop" ? 650 : 700;
      if (entry.valueDensity.visibleAnalysisHeight < minimumVisibleAnalysis) violations.push(`${entry.viewport}/${entry.route}: only ${rounded(entry.valueDensity.visibleAnalysisHeight)}px of analysis is visible without scrolling`);
      if (entry.valueDensity.analysisWidth < minimumAnalysisWidth) violations.push(`${entry.viewport}/${entry.route}: analysis width ${rounded(entry.valueDensity.analysisWidth)}px is not decision-useful`);
    }
    if (entry.hierarchy.duplicateHeadings.length) violations.push(`${entry.viewport}/${entry.route}: duplicate visible headings ${entry.hierarchy.duplicateHeadings.join(", ")}`);
    if (entry.adjacentMismatches.length) violations.push(`${entry.viewport}/${entry.route}: ${entry.adjacentMismatches.length} adjacent control mismatches`);
    const undersizedType = entry.elements.filter((item) =>
      ["action", "field"].includes(item.kind)
      && /(^| )(if-btn|if-picker__trigger|if-input|if-textarea)( |$)/.test(item.className)
      && item.fontSize < 12,
    );
    if (undersizedType.length) violations.push(`${entry.viewport}/${entry.route}: ${undersizedType.length} shared controls below 12px`);
  }
  if (violations.length) throw new Error(`UI consistency verification failed:\n- ${violations.join("\n- ")}`);
  console.log(`UI consistency verification passed across ${normalized.length} rendered route/viewport combinations.`);
}
