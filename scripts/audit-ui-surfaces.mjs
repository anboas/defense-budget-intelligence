import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "playwright-core";

const BASE_URL = process.env.DBI_UI_AUDIT_URL || "http://127.0.0.1:4173/";
const STATE_PATH = process.env.DBI_UI_AUDIT_STATE || "/home/anboas/.openclaw/test-accounts/defense-budget-intelligence/storage-state.json";
const OUTPUT_DIR = resolve(process.env.DBI_UI_AUDIT_OUTPUT || "test-results/ui-audit");
const SHOULD_CLAIM_OWNER = process.env.DBI_UI_AUDIT_CLAIM_OWNER === "1";
const REQUESTED_ROUTES = new Set(String(process.env.DBI_UI_AUDIT_ROUTES || "").split(",").map((value) => value.trim()).filter(Boolean));
const REQUESTED_VIEWPORTS = new Set(String(process.env.DBI_UI_AUDIT_VIEWPORTS || "").split(",").map((value) => value.trim()).filter(Boolean));
const READY_TIMEOUT_MS = Number(process.env.DBI_UI_AUDIT_TIMEOUT_MS || 20_000);
const ALLOW_FULL_PRODUCTION_AUDIT = process.env.DBI_UI_AUDIT_ALLOW_PRODUCTION_FULL === "1";
const executablePath = [
  process.env.CHROMIUM_PATH,
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium-browser",
  "/usr/bin/chromium",
].find((candidate) => candidate && existsSync(candidate));

const ROUTES = [
  ["spend-radar", "#/budget-spend/explorer?spendView=radar", "[data-opportunity-radar]"],
  ["spend-brief", "#/budget-spend/explorer?spendView=today", '[data-spend-explorer="today"]'],
  ["spend-timeline", "#/budget-spend/explorer?spendView=timeline", "[data-capture-calendar-page]"],
  ["spend-table", "#/budget-spend/explorer?spendView=table", '[data-spend-explorer="table"]'],
  ["spend-charts", "#/budget-spend/explorer?spendView=charts", "[data-transaction-d3-page]"],
  ["opportunity-map", "#/budget-spend/map", "[data-opportunity-map]"],
  ["schedule-list", "#/budget-spend/schedule?scheduleView=list", "[data-ops-events]"],
  ["schedule-calendar", "#/budget-spend/schedule?scheduleView=calendar", "[data-wallboard-calendar]"],
  ["schedule-display", "#/budget-spend/schedule?scheduleView=display", "[data-ops-wallboard]"],
  ["pdb-request", "#/budget-spend", "[data-pdb-request-page]"],
  ["request-history", "#/budget-spend/trends", "[data-request-history-page]"],
  ["account-flow", "#/budget-spend/lifecycle", "[data-account-spine-page]"],
  ["awards", "#/budget-spend/awards", "[data-awards-page]"],
  ["source-lineage", "#/budget-spend/sources", "[data-analytics-sources-page]"],
  ["watchlist", "#/budget-spend/watchlist", "[data-operations-hub]"],
  ["task-center", "#/budget-spend/tasks", "[data-task-center], [data-operations-hub]"],
  ["workspace-directory", "#/workspace/directory", "[data-operations-hub]"],
  ["connections-integrations", "#/budget-spend/connections?connectionsView=integrations", "[data-connections-surface], [data-users-unavailable]"],
  ["connections-credentials", "#/budget-spend/connections?connectionsView=credentials", "[data-connections-surface], [data-users-unavailable]"],
  ["connections-activity", "#/budget-spend/connections?connectionsView=activity", "[data-connections-surface], [data-users-unavailable]"],
  ["connections-operations", "#/budget-spend/connections?connectionsView=operations", "[data-acquisition-operations], [data-users-unavailable]"],
  ["domain-model", "#/budget-spend/domain-model", "[data-domain-model-page]"],
  ["intelligence-overview", "#/budget-spend/intelligence", "[data-intelligence-products-page]"],
  ["intelligence-discovery", "#/budget-spend/intelligence?view=discovery", "[data-intelligence-products-page]"],
  ["workspace-settings", "#/budget-spend/workspace", "[data-workspace-management], [data-workspaces-unavailable]"],
  ["accounts", "#/budget-spend/users", "[data-user-management], [data-users-unavailable]"],
  ["workspaces", "#/budget-spend/workspaces", "[data-workspace-management], [data-workspaces-unavailable]"],
  ["event-discovery", "#/budget-spend/event-discovery", "[data-event-discovery-page], [data-users-unavailable]"],
  ["profile", "#/profile", '[data-profile-section="profile"]'],
  ["security", "#/profile/security", '[data-profile-section="security"]'],
  ["personal-openai", "#/profile/openai", '[data-profile-section="personal-ai"]'],
];

const VIEWPORTS = [
  ["mobile", { width: 390, height: 844 }],
  ["desktop", { width: 1440, height: 1000 }],
  ["ultrawide", { width: 1920, height: 1080 }],
];
const auditRoutes = REQUESTED_ROUTES.size ? ROUTES.filter(([id]) => REQUESTED_ROUTES.has(id)) : ROUTES;
const auditViewports = REQUESTED_VIEWPORTS.size ? VIEWPORTS.filter(([id]) => REQUESTED_VIEWPORTS.has(id)) : VIEWPORTS;

if (!auditRoutes.length || !auditViewports.length) throw new Error("UI audit route or viewport filters matched nothing");
const auditHost = new URL(BASE_URL).hostname;
if (auditHost === "defense-budget-intelligence.pages.dev" && !ALLOW_FULL_PRODUCTION_AUDIT && auditRoutes.length * auditViewports.length > 12) {
  throw new Error("Production UI audits are limited to 12 surfaces. Set route and viewport filters, or explicitly allow a full production audit.");
}

mkdirSync(OUTPUT_DIR, { recursive: true });
let ownerCookie = "";
if (SHOULD_CLAIM_OWNER) {
  const claimResponse = await fetch(new URL("api/v1/auth/claim", BASE_URL), {
    method: "POST",
    headers: { "content-type": "application/json", origin: new URL(BASE_URL).origin },
    body: JSON.stringify({
      email: "ui-audit-owner@example.test",
      displayName: "UI Audit Owner",
      title: "Visual verification",
      passwordSalt: "31".repeat(24),
      passwordProof: "47".repeat(32),
    }),
  });
  if (!claimResponse.ok) throw new Error(`Could not claim isolated audit owner: ${claimResponse.status}`);
  ownerCookie = String(claimResponse.headers.get("set-cookie") || "").split(";")[0];
  if (!ownerCookie.includes("=")) throw new Error("Audit owner claim did not return a session cookie");
}
const browser = await chromium.launch({
  ...(executablePath ? { executablePath } : {}),
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
const results = [];

try {
  for (const [viewportName, viewport] of auditViewports) {
    const context = await browser.newContext({
      viewport,
      ...(existsSync(STATE_PATH) ? { storageState: STATE_PATH } : {}),
      reducedMotion: "reduce",
    });
    if (ownerCookie) {
      const separator = ownerCookie.indexOf("=");
      await context.addCookies([{ name: ownerCookie.slice(0, separator), value: ownerCookie.slice(separator + 1), url: BASE_URL }]);
    }
    const page = await context.newPage();
    const pageErrors = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    for (const [id, hash, readySelector] of auditRoutes) {
      const consoleErrors = [];
      const responseErrors = [];
      const consoleListener = (entry) => { if (entry.type() === "error") consoleErrors.push(entry.text()); };
      const responseListener = (response) => { if (response.status() >= 400 && !response.url().includes("favicon")) responseErrors.push(`${response.status()} ${new URL(response.url()).pathname}`); };
      page.on("console", consoleListener);
      page.on("response", responseListener);
      const startedAt = Date.now();
      let loadError = "";
      try {
        await page.goto(`${BASE_URL}${hash}`, { waitUntil: "domcontentloaded", timeout: READY_TIMEOUT_MS });
        await page.locator(readySelector).first().waitFor({ state: "visible", timeout: READY_TIMEOUT_MS });
        await page.waitForTimeout(400);
      } catch (error) {
        loadError = error.message;
      }
      const metrics = await page.evaluate(() => {
        const visible = (node) => {
          const style = getComputedStyle(node);
          const rect = node.getBoundingClientRect();
          return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
        };
        const surfaceSelector = ".if-card, .if-panel, .if-analytics-panel, .ops-panel, .if-page-header, .if-page-body, .if-section, .if-table-shell, [role='dialog']";
        const overflow = [...document.body.querySelectorAll("*")].flatMap((node) => {
          if (!visible(node)) return [];
          const rect = node.getBoundingClientRect();
          if (rect.left >= -2 && rect.right <= innerWidth + 2) return [];
          let ancestor = node.parentElement;
          while (ancestor && ancestor !== document.body) {
            const ancestorRect = ancestor.getBoundingClientRect();
            if (["auto", "scroll", "hidden", "clip"].includes(getComputedStyle(ancestor).overflowX) && ancestorRect.left >= -2 && ancestorRect.right <= innerWidth + 2) return [];
            ancestor = ancestor.parentElement;
          }
          return [{ tag: node.tagName, className: String(node.className?.baseVal || node.className || "").slice(0, 180), left: Math.round(rect.left), right: Math.round(rect.right) }];
        }).slice(0, 12);
        const clippedText = [...document.body.querySelectorAll("h1,h2,h3,h4,p,span,strong,small,label,button,a,td,th")].flatMap((node) => {
          if (!visible(node) || !node.textContent.trim()) return [];
          const style = getComputedStyle(node);
          const clipsX = node.scrollWidth > node.clientWidth + 2 && ["hidden", "clip"].includes(style.overflowX);
          const clipsY = node.scrollHeight > node.clientHeight + 2 && ["hidden", "clip"].includes(style.overflowY);
          return clipsX || clipsY ? [{ tag: node.tagName, text: node.textContent.trim().replace(/\s+/g, " ").slice(0, 100), className: String(node.className || "").slice(0, 140), client: [node.clientWidth, node.clientHeight], scroll: [node.scrollWidth, node.scrollHeight] }] : [];
        }).slice(0, 16);
        const smallControls = [...document.querySelectorAll("button, a.if-btn, summary, input, select, textarea, [role='button'], [role='tab']")].flatMap((node) => {
          if (!visible(node)) return [];
          const rect = node.getBoundingClientRect();
          if (innerWidth > 600 || (rect.width >= 43.5 && rect.height >= 43.5)) return [];
          return [{ tag: node.tagName, label: (node.getAttribute("aria-label") || node.getAttribute("title") || node.textContent || "").trim().replace(/\s+/g, " ").slice(0, 90), className: String(node.className || "").slice(0, 140), size: [Math.round(rect.width), Math.round(rect.height)] }];
        }).slice(0, 24);
        const nestedSurfaces = [...document.querySelectorAll(surfaceSelector)].flatMap((node) => {
          if (!visible(node)) return [];
          let depth = 0;
          let ancestor = node.parentElement;
          while (ancestor) {
            if (ancestor.matches?.(surfaceSelector)) depth += 1;
            ancestor = ancestor.parentElement;
          }
          if (depth < 3) return [];
          return [{ tag: node.tagName, className: String(node.className || "").slice(0, 160), depth }];
        }).sort((left, right) => right.depth - left.depth).slice(0, 16);
        const malformedText = [...document.body.querySelectorAll("*")].flatMap((node) => {
          if (node.children.length || !visible(node)) return [];
          const text = node.textContent.trim();
          return /(?:�|Ã.|Â.|â€)/.test(text) || text.includes(String.fromCharCode(0)) ? [text.slice(0, 160)] : [];
        }).slice(0, 12);
        const headings = [...document.querySelectorAll("h1,h2,h3,h4")].filter(visible).map((node) => ({ level: node.tagName, text: node.textContent.trim().replace(/\s+/g, " ").slice(0, 120), left: Math.round(node.getBoundingClientRect().left), top: Math.round(node.getBoundingClientRect().top) }));
        const topLevelSurfaceCount = [...document.querySelectorAll(".if-page-body > .if-card, .if-page-body > .if-panel, .if-page-body > .if-analytics-panel, .if-page-body > .ops-panel")].filter(visible).length;
        return {
          title: document.title,
          bodyWidth: document.body.scrollWidth,
          bodyHeight: document.body.scrollHeight,
          overflow,
          clippedText,
          smallControls,
          nestedSurfaces,
          malformedText,
          headings,
          surfaceCount: [...document.querySelectorAll(surfaceSelector)].filter(visible).length,
          topLevelSurfaceCount,
          textLength: document.body.innerText.length,
        };
      }).catch(() => ({}));
      const screenshot = resolve(OUTPUT_DIR, `${viewportName}-${id}.png`);
      await page.screenshot({ path: screenshot, fullPage: true }).catch(() => {});
      results.push({
        viewport: viewportName,
        viewportSize: viewport,
        id,
        hash,
        finalHash: new URL(page.url()).hash,
        loadMs: Date.now() - startedAt,
        loadError,
        pageErrors: [...pageErrors],
        consoleErrors,
        responseErrors,
        screenshot,
        ...metrics,
      });
      pageErrors.length = 0;
      page.off("console", consoleListener);
      page.off("response", responseListener);
    }
    await context.close();
  }
} finally {
  await browser.close();
}

const reportPath = resolve(OUTPUT_DIR, "report.json");
writeFileSync(reportPath, `${JSON.stringify({ baseUrl: BASE_URL, generatedAt: new Date().toISOString(), results }, null, 2)}\n`);
const issueCount = results.reduce((sum, entry) => sum + Number(Boolean(entry.loadError)) + (entry.overflow?.length || 0) + (entry.clippedText?.length || 0) + (entry.smallControls?.length || 0) + (entry.nestedSurfaces?.length || 0) + (entry.malformedText?.length || 0), 0);
console.log(JSON.stringify({ reportPath, surfaces: results.length, issueCount, loadErrors: results.filter((entry) => entry.loadError).map((entry) => `${entry.viewport}:${entry.id}`) }, null, 2));
