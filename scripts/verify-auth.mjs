import assert from "node:assert/strict";
import { existsSync, mkdirSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { chromium } from "playwright-core";

const BASE_URL = process.env.BUDGET_AUTH_VERIFY_URL || "http://127.0.0.1:8080/";
const email = `owner-${randomBytes(6).toString("hex")}@example.test`;
const initialPassword = `${randomBytes(18).toString("base64url")}Aa1!`;
const nextPassword = `${randomBytes(18).toString("base64url")}Bb2!`;
const initialName = "Initial Owner";
const finalName = "Workspace Owner";
mkdirSync("test-results", { recursive: true });

async function chooseControlSelect(page, label, option) {
  const trigger = page.getByRole("button", { name: new RegExp(`^${label}:`, "i") }).first();
  await trigger.click();
  await page.getByRole("option", { name: new RegExp(`^${option}`, "i") }).first().click();
}

async function assertPageBodyGutter(page, selector, label) {
  const geometry = await page.locator(selector).evaluate((node) => {
    const body = node.querySelector(":scope > .if-page-body");
    const child = body?.firstElementChild;
    const bodyBox = body?.getBoundingClientRect();
    const childBox = child?.getBoundingClientRect();
    return body && child ? { count: 1, left: childBox.left - bodyBox.left, right: bodyBox.right - childBox.right } : { count: 0, left: 0, right: 0 };
  });
  assert.equal(geometry.count, 1, `${label} must use the shared page-body contract`);
  assert.ok(geometry.left >= 10 && geometry.right >= 10, `${label} content must not touch its page boundary (${geometry.left}px / ${geometry.right}px)`);
}

async function assertInteractionSurface(page, selector, label, mobile = false) {
  const root = page.locator(selector);
  await root.locator("details").evaluateAll((nodes) => nodes.forEach((node) => { node.open = true; }));
  const defects = await root.evaluate((node, narrow) => [...node.querySelectorAll("button, [role='button'], summary, input:not([type='hidden']), select, textarea")].flatMap((control) => {
    const binaryInput = control.matches("input[type='checkbox'], input[type='radio']");
    const hitTarget = binaryInput ? control.closest("label") || control : control;
    const style = getComputedStyle(hitTarget);
    const rect = hitTarget.getBoundingClientRect();
    if (style.display === "none" || style.visibility === "hidden" || rect.width <= 0 || rect.height <= 0) return [];
    const label = control.getAttribute("aria-label") || control.getAttribute("title") || control.labels?.[0]?.textContent || control.textContent.trim();
    const dataMark = control.matches("[data-timeline-context], [data-analytics-tooltip], svg [role='button']");
    const touchCritical = control.matches(".if-btn, summary, input, select, textarea, [aria-haspopup]");
    const minimum = narrow && touchCritical ? 43.5 : 24;
    const issues = [];
    if (!label) issues.push("missing accessible name");
    if (!dataMark && rect.width < 24) issues.push(`width ${rect.width.toFixed(1)}`);
    if (!dataMark && rect.height < minimum) issues.push(`height ${rect.height.toFixed(1)} < ${minimum}`);
    if (!dataMark && hitTarget.scrollHeight > hitTarget.clientHeight + 2) issues.push(`vertical clip ${hitTarget.clientHeight}/${hitTarget.scrollHeight}`);
    return issues.length ? [{ tag: control.tagName, label: String(label || "").trim().replace(/\s+/g, " ").slice(0, 80), issues, className: control.className?.baseVal || control.className }] : [];
  }), mobile);
  assert.deepEqual(defects, [], `${label} must keep every open-state control named, measurable, and unclipped`);
  const overflowSources = await page.evaluate(() => [...document.body.querySelectorAll("*")].flatMap((element) => {
    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 || (rect.right <= innerWidth + 2 && rect.left >= -2)) return [];
    let ancestor = element.parentElement;
    while (ancestor && ancestor !== document.body) {
      const ancestorRect = ancestor.getBoundingClientRect();
      const overflowX = getComputedStyle(ancestor).overflowX;
      if (["auto", "scroll", "hidden", "clip"].includes(overflowX) && ancestorRect.left >= -2 && ancestorRect.right <= innerWidth + 2) return [];
      ancestor = ancestor.parentElement;
    }
    return [{ tag: element.tagName, className: element.className?.baseVal || element.className || "", left: Math.round(rect.left), right: Math.round(rect.right), width: Math.round(rect.width) }];
  }).sort((left, right) => (right.right - innerWidth) - (left.right - innerWidth)).slice(0, 8));
  assert.deepEqual(overflowSources, [], `${label} must not introduce uncontained page overflow`);
}

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
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  let delayedInitialStatus = false;
  await page.route("**/api/v1/auth/status", async (route) => {
    if (!delayedInitialStatus) {
      delayedInitialStatus = true;
      await new Promise((resolve) => setTimeout(resolve, 450));
    }
    await route.continue();
  });
  await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
  const loadingGate = page.locator(".account-gate--loading");
  const setupGate = page.locator('[data-account-gate="setup"]');
  await loadingGate.or(setupGate).first().waitFor({ timeout: 5000 });
  const observedLoadingGate = await loadingGate.count() > 0;
  if (observedLoadingGate) {
    assert.equal(await loadingGate.getByRole("heading", { name: "Loading workspace" }).count(), 1, "Loading state should retain a clear status label");
    assert.equal(await loadingGate.locator(".account-gate__loading-dots i").count(), 3, "Loading state should render the three-dot progress cadence");
    const loadingAnimation = await loadingGate.locator(".account-gate__loading-mark").evaluate((node) => ({
      ringAnimation: getComputedStyle(node, "::before").animationName,
      dotAnimation: getComputedStyle(node.parentElement.querySelector(".account-gate__loading-dots i")).animationName,
      ringDiameter: node.getBoundingClientRect().width,
    }));
    assert.equal(loadingAnimation.ringAnimation, "account-loading-spin", "Product mark should be surrounded by the segmented loading spinner");
    assert.equal(loadingAnimation.dotAnimation, "account-loading-dot", "Loading dots should use the shared cadence animation");
    assert.ok(loadingAnimation.ringDiameter >= 60 && loadingAnimation.ringDiameter <= 64, `Loading spinner should remain compact, got ${loadingAnimation.ringDiameter}px`);
    await page.screenshot({ path: "test-results/account-loading.png" });
  }
  await page.waitForSelector('[data-account-gate="setup"]');
  await page.unroute("**/api/v1/auth/status");
  const setupMark = page.locator(".account-gate__mark img");
  assert.deepEqual(await setupMark.evaluate((node) => [node.naturalWidth, node.naturalHeight]), [192, 192], "First-account setup should use the supplied product mark");
  assert.equal(await page.locator(".account-gate").evaluate((node) => getComputedStyle(node).backgroundImage), "none", "Authentication surface should preserve the established flat control-surface treatment");
  if (process.env.BUDGET_AUTH_SKIP_PROTECTED_API !== "1") {
    assert.equal(await page.evaluate(async () => (await fetch("/api/v1/snapshots")).status), 401, "Protected data APIs must reject anonymous requests");
  }
  await page.getByLabel("Display name").fill(initialName);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Title (optional)").fill("Platform administrator");
  await page.getByLabel("Password", { exact: true }).fill(initialPassword);
  await page.getByLabel("Confirm password").fill(initialPassword);
  await page.getByRole("button", { name: "Create super-user account" }).click();
  await page.waitForSelector("[data-defense-budget-app]");
  await page.locator('[data-nav-group-trigger="work"]').click();
  assert.equal(await page.locator('[data-budget-nav-menu="work"] a[data-budget-nav]').count(), 2, "Workspace work should contain only Watchlist and Task Center");
  assert.match(await page.locator('[data-budget-nav-menu="work"]').innerText(), /Watchlist[\s\S]*Task Center/i);
  assert.doesNotMatch(await page.locator('[data-budget-nav-menu="work"]').innerText(), /Events/i, "Events must not be nested under Workspace work");
  await page.locator('[data-nav-group-trigger="work"]').click();
  await page.locator('[data-nav-group-trigger="workspace-admin"]').click();
  assert.equal(await page.locator('[data-nav-group-trigger="workspace-admin"] .ci-header-nav__menu-trigger-label').innerText(), "Workspace Admin", "Workspace Admin navigation must use title case");
  assert.equal(await page.locator('[data-budget-nav-menu="workspace-admin"] a[data-budget-nav]').count(), 2, "Workspace administration should contain only Connections and Workspace Settings");
  assert.match(await page.locator('[data-budget-nav-menu="workspace-admin"]').innerText(), /Connections[\s\S]*Workspace Settings/i);
  assert.equal(await page.locator('[data-budget-nav-menu="workspace-admin"] a[href="#/profile"]').count(), 0, "Profile should remain owned by the account control rather than duplicated in Workspace administration");
  await page.locator('[data-nav-group-trigger="workspace-admin"]').click();
  await page.locator('[data-nav-group-trigger="platform-admin"]').click();
  assert.equal(await page.locator('[data-nav-group-trigger="platform-admin"] .ci-header-nav__menu-trigger-label').innerText(), "Platform Admin", "Platform Admin navigation must use title case");
  assert.equal(await page.locator('[data-budget-nav-menu="platform-admin"] a[data-budget-nav]').count(), 2, "Platform administration should contain Accounts and Workspaces only");
  assert.match(await page.locator('[data-budget-nav-menu="platform-admin"]').innerText(), /Accounts[\s\S]*Workspaces/i);
  await page.locator('[data-nav-group-trigger="platform-admin"]').click();
  const desktopTrigger = page.locator("[data-profile-menu-trigger]");
  const desktopTriggerBox = await desktopTrigger.boundingBox();
  assert.ok(desktopTriggerBox && desktopTriggerBox.height >= 34 && desktopTriggerBox.height <= 38, `Desktop profile trigger should match the compact account control, got ${desktopTriggerBox?.height}px`);
  assert.equal(await desktopTrigger.locator("small").count(), 0, "Desktop account trigger should keep role metadata inside the menu, not in a second header line");
  const desktopTriggerStyle = await desktopTrigger.evaluate((element) => {
    const style = getComputedStyle(element);
    return { backgroundColor: style.backgroundColor, color: style.color };
  });
  assert.equal(desktopTriggerStyle.backgroundColor, "rgb(255, 255, 255)", "Desktop profile trigger should use the shared white account-control surface");
  assert.match(await page.locator("[data-profile-menu]").getAttribute("class"), /if-popover[\s\S]*if-account-popover[\s\S]*ci-profile-menu/, "Profile should use the same Control Framework popover shell as Opportunity Intelligence");
  await desktopTrigger.click();
  const profileSurface = page.getByRole("dialog", { name: "Profile controls" });
  await profileSurface.waitFor();
  const profileSurfaceBox = await profileSurface.boundingBox();
  assert.ok(profileSurfaceBox && Math.abs(profileSurfaceBox.width - 360) <= 1, `Desktop profile surface should match the 360px Opportunity Intelligence account component, got ${profileSurfaceBox?.width}px`);
  assert.equal(await profileSurface.locator(".if-account-surface__header").count(), 1, "Profile dropdown should use the shared account-surface header");
  assert.equal(await profileSurface.locator(".if-account-surface__body .if-account-action").count(), 3, "Profile dropdown should expose only personal profile, security, and OpenAI-key actions");
  assert.equal(await profileSurface.locator(".if-account-action__icon svg").count(), 3, "Every personal account-action row should render its icon glyph");
  assert.equal(await profileSurface.locator(".if-account-surface__footer").count(), 1, "Profile dropdown should use the shared account-surface footer");
  const workspaceTriggerSelector = ".profile-workspace-switcher__picker .if-picker__trigger";
  const initialWorkspaceName = await profileSurface.locator(`${workspaceTriggerSelector} strong`).innerText();
  assert.ok(initialWorkspaceName.length >= 2, "Workspace switcher should expose the active workspace name in its trigger");
  assert.equal(await profileSurface.locator(`${workspaceTriggerSelector} img`).count(), 1, "Workspace switcher trigger should expose the active workspace icon");
  assert.ok(await page.getByText("Super user", { exact: true }).count() >= 1, "Profile menu should identify the first account as super user");
  await page.screenshot({ path: "test-results/profile-menu-desktop.png" });
  await page.getByRole("link", { name: /Open Profile/i }).click();
  await page.waitForSelector('[data-profile-page][data-profile-section="profile"]');
  assert.equal(await page.locator('[role="dialog"]').count(), 0, "Profile should render as a routed page, not a modal");
  assert.match(new URL(page.url()).hash, /^#\/profile$/, "Profile menu should navigate to the canonical profile route");
  assert.equal(await page.locator(".profile-page__nav a").count(), 3, "Personal settings should contain identity, security, and personal OpenAI keys");
  assert.equal(await page.locator('.profile-page__nav a:has-text("Agent access"), .profile-page__nav a:has-text("API log")').count(), 0, "Agent and API administration must not be mixed into the account settings rail");
  assert.equal(await page.locator('[data-profile-account] input:disabled').count(), 0, "Immutable account metadata should use compact key/value rows instead of oversized disabled inputs");
  assert.equal(await page.locator('[data-profile-account-meta] .if-kv').count(), 2, "Profile should expose email and role through the framework metadata primitive");
  await assertPageBodyGutter(page, "[data-profile-page]", "Profile");
  assert.equal(await page.locator(".if-identity-editor").count(), 1, "Profile should expose the shared identity editor for picture selection, replacement, and removal");
  const desktopProfileGeometry = await page.locator("[data-profile-page]").evaluate((node) => {
    const panel = node.querySelector(".profile-page__panel");
    const pageHeader = node.querySelector(":scope > .if-page-header");
    const heading = pageHeader.querySelector(".if-page-header__title");
    const panelTitle = node.querySelector(".profile-page__panel .if-panel__title");
    const input = node.querySelector(".profile-page__panel .if-input");
    const content = node.querySelector(".profile-page__content");
    const panelStyle = getComputedStyle(panel);
    return {
      pageHeaderHeight: pageHeader.getBoundingClientRect().height,
      pageHeaderBackground: getComputedStyle(pageHeader).backgroundImage,
      headingSize: parseFloat(getComputedStyle(heading).fontSize),
      panelRadius: parseFloat(panelStyle.borderRadius),
      panelShadow: panelStyle.boxShadow,
      panelTitleSize: parseFloat(getComputedStyle(panelTitle).fontSize),
      inputHeight: input.getBoundingClientRect().height,
      contentWidth: content.getBoundingClientRect().width,
      panelBottom: panel.getBoundingClientRect().bottom,
    };
  });
  assert.equal(desktopProfileGeometry.pageHeaderBackground, "none", "Profile header should be flat, never a decorative gradient hero");
  assert.ok(desktopProfileGeometry.pageHeaderHeight <= 96, `Profile header should stay operationally compact while retaining its full framework inset and route summary, got ${desktopProfileGeometry.pageHeaderHeight}px`);
  assert.ok(desktopProfileGeometry.headingSize <= 20, `Profile route heading should use framework scale, got ${desktopProfileGeometry.headingSize}px`);
  assert.ok(desktopProfileGeometry.panelRadius <= 4, `Profile panel should use the framework's restrained radius, got ${desktopProfileGeometry.panelRadius}px`);
  assert.equal(desktopProfileGeometry.panelShadow, "none", "Profile panel should remain flat rather than float like a marketing card");
  assert.ok(desktopProfileGeometry.panelTitleSize <= 15, `Profile panel title should remain compact, got ${desktopProfileGeometry.panelTitleSize}px`);
  assert.ok(desktopProfileGeometry.inputHeight >= 29.5 && desktopProfileGeometry.inputHeight <= 34.5, `Desktop profile inputs should use compact framework controls, got ${desktopProfileGeometry.inputHeight}px`);
  assert.ok(desktopProfileGeometry.contentWidth <= 761, `Profile form should preserve a readable utility width, got ${desktopProfileGeometry.contentWidth}px`);
  assert.ok(desktopProfileGeometry.panelBottom <= 640, `Profile picture and identity controls should fit high in a 1000px viewport while retaining the shared page-body gutter, ending at ${desktopProfileGeometry.panelBottom}px`);
  await page.screenshot({ path: "test-results/profile-page-desktop.png", fullPage: true });
  await page.locator("#profile-avatar-file").setInputFiles("public/icon-192.png");
  await page.locator(".if-identity-editor .user-avatar img").waitFor();
  await page.getByLabel("Display name").fill(finalName);
  await page.getByRole("button", { name: "Save profile" }).click();
  await page.getByText("Profile saved.").waitFor();
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.locator(".if-identity-editor .user-avatar img").waitFor();
  await page.locator("[data-profile-menu-trigger] .user-avatar img").waitFor();
  await page.goto(`${BASE_URL}#/profile/security`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-profile-page][data-profile-section="security"]');
  const securityGeometry = await page.locator("[data-profile-security]").evaluate((node) => ({
    width: node.getBoundingClientRect().width,
    bottom: node.getBoundingClientRect().bottom,
    fields: node.querySelectorAll(".if-field").length,
    disabledFields: node.querySelectorAll("input:disabled").length,
  }));
  assert.ok(securityGeometry.width <= 761, `Security form should retain the same readable utility width as Profile, got ${securityGeometry.width}px`);
  assert.ok(securityGeometry.bottom <= 620, `Security controls should remain high in the desktop viewport, ending at ${securityGeometry.bottom}px`);
  assert.equal(securityGeometry.fields, 3, "Security should expose only current, new, and confirmation password fields");
  assert.equal(securityGeometry.disabledFields, 0, "Security should not render decorative disabled inputs");
  await page.screenshot({ path: "test-results/profile-security-desktop.png", fullPage: true });
  await page.goto(`${BASE_URL}#/profile/openai`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-openai-key-vault="user"]');
  const personalVault = page.locator('[data-openai-key-vault="user"]');
  await personalVault.locator('[data-if-async-state="loading"]').waitFor({ state: "detached" });
  assert.match(await personalVault.innerText(), /Credential vault[\s\S]*write-only encrypted vault[\s\S]*Configured credentials/i, "Personal settings should expose the structured write-only OpenAI credential manager without a duplicate route header");
  assert.equal(await personalVault.locator(".if-management-card").count(), 4, "The vault summary must use the shared four-card management grid");
  assert.equal(await personalVault.locator(".if-analytics-panel").count(), 1, "The vault should reserve panel chrome for the credential list instead of nesting its summary in another box");
  assert.equal(await personalVault.locator(".if-page-header").count(), 1, "The vault must use the shared compact section header");
  await personalVault.getByRole("button", { name: "Add key" }).click();
  const keyDialog = page.locator('[data-openai-key-dialog="user"]');
  await keyDialog.waitFor();
  assert.equal(await keyDialog.locator(".if-form-grid .if-field").count(), 2, "Credential entry must use the shared form-field grid");
  assert.equal(await keyDialog.getByLabel("OpenAI API key").getAttribute("type"), "password");
  const keyDialogBounds = await keyDialog.boundingBox();
  assert.ok(keyDialogBounds && keyDialogBounds.x >= 0 && keyDialogBounds.y >= 0 && keyDialogBounds.x + keyDialogBounds.width <= 1440 && keyDialogBounds.y + keyDialogBounds.height <= 1000, "Credential dialog must remain inside the desktop viewport");
  await keyDialog.getByRole("button", { name: "Close OpenAI key form" }).click();

  await page.goto(`${BASE_URL}#/budget-spend/connections?connectionsView=integrations`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-ops-integrations][data-integration-surface="coverage"]');
  assert.equal(await page.locator("[data-ops-integration-table]").count(), 1, "Integrations should open on the source coverage work surface");
  assert.equal(await page.locator('[data-openai-key-vault="workspace"]').count(), 0, "Workspace credentials should not compete with source coverage by default");
  assert.equal(await page.locator('[data-contract-monitor-disclosure][open]').count(), 0, "Deep contract-monitor diagnostics should stay collapsed until requested");
  await page.screenshot({ path: "test-results/admin-integrations-coverage-desktop.png", fullPage: true });
  await page.getByRole("button", { name: "Credentials", exact: true }).click();
  await page.waitForSelector('[data-connections-surface="credentials"] [data-openai-key-vault="workspace"]');
  assert.equal(await page.locator("[data-ops-integration-table]").count(), 0, "Credential management should replace the source ledger instead of stacking below it");
  assert.equal(await page.locator('[data-openai-key-vault="workspace"] .if-page-header').count(), 1, "Embedded workspace credentials should use one compact section header");
  await page.getByRole("button", { name: "SAM.gov", exact: true }).click();
  const samVault = page.locator("[data-sam-gov-key-management]");
  await samVault.waitFor();
  await samVault.locator('[data-if-async-state="loading"]').waitFor({ state: "detached" }).catch(() => {});
  assert.match(await samVault.innerText(), /SAM\.gov API key[\s\S]*Encrypted workspace credential[\s\S]*Configured credential/i, "Connections must expose a dedicated workspace SAM.gov credential vault");
  await samVault.getByRole("button", { name: /Add key|Replace key/ }).click();
  const samDialog = page.locator("[data-sam-gov-key-dialog]");
  await samDialog.waitFor();
  assert.equal(await samDialog.getByLabel("SAM.gov API key").getAttribute("type"), "password", "SAM.gov credential entry must remain write-only");
  await samDialog.getByRole("button", { name: "Close SAM.gov key form" }).click();
  await page.getByRole("button", { name: "OpenAI", exact: true }).click();
  await page.screenshot({ path: "test-results/admin-integrations-credentials-desktop.png", fullPage: true });

  await page.goto(`${BASE_URL}#/budget-spend/connections?connectionsView=activity`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("[data-api-request-summary]");
  assert.equal(await page.locator("[data-api-request-summary] .if-management-card").count(), 5, "Runtime & API Log must summarize request volume, success, latency, tokens, and client errors");
  await page.waitForSelector("[data-api-request-table], [data-api-request-empty]");
  const requestTableCount = await page.locator("[data-api-request-table]").count();
  if (requestTableCount) assert.ok(await page.locator('[data-api-request-table] tbody tr').count() <= 10, "API Log should default to a scannable ten-row desktop page");
  else assert.match(await page.locator("[data-api-request-empty]").innerText(), /No runtime or API requests retained/i, "A fresh workspace should expose an explicit empty request ledger while retaining the Runtime & API Log shell");
  const requestChartCount = await page.locator("[data-api-observability-charts] .if-chart-card").count();
  assert.ok(requestChartCount === 0 || requestChartCount === 2, `API Log should render either no charts for a fresh workspace or the complete two-chart observability band, got ${requestChartCount}`);
  assert.match(await page.locator("[data-ops-activity]").innerText(), /Runtime & API[\s\S]*Workspace changes/i, "Connections activity must expose distinct runtime/API and workspace-change ledgers");
  assert.equal(await page.locator('[data-ops-activity] > .if-page-body > .if-tabs__list .if-tab').count(), 2, "API Log must switch between ledgers instead of stacking both tables");
  await assertPageBodyGutter(page, "[data-ops-activity]", "API Log");

  await page.goto(`${BASE_URL}#/budget-spend/users`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-operations-hub][data-operations-view="users"] [data-user-management]');
  assert.equal(await page.locator('[data-admin-workspace]').count(), 0, "Accounts should not repeat a second administration shell below global navigation");
  assert.equal(await page.locator('[data-user-management] > .if-page-header').count(), 1, "Accounts should expose one framework-owned route header");
  await assertPageBodyGutter(page, "[data-user-management]", "Accounts");
  await page.getByRole("button", { name: "Add account" }).click();
  const addUser = page.locator("[data-user-create]");
  await addUser.getByLabel("Display name").fill("Browser teammate");
  await addUser.getByLabel("Email").fill("browser-teammate@example.test");
  await addUser.getByLabel(/Title/).fill("Read-only reviewer");
  await chooseControlSelect(page, "Initial workspace role", "Viewer");
  await addUser.getByLabel("Temporary password", { exact: true }).fill("Temporary-User-2026!");
  await addUser.getByLabel("Confirm temporary password").fill("Temporary-User-2026!");
  await addUser.getByRole("button", { name: "Create account" }).click();
  const teammate = page.locator('[data-dbi-data-table="platform-accounts"] [data-if-table-row]', { hasText: "browser-teammate@example.test" });
  await teammate.waitFor();
  await page.getByText("Account created", { exact: true }).waitFor();
  assert.match(await teammate.innerText(), /Viewer[\s\S]*Active/);
  const accountColumnAlignment = await page.locator('[data-dbi-data-table="platform-accounts"]').evaluate((table) => {
    const headers = [...table.querySelectorAll("thead th")];
    const cells = [...table.querySelectorAll("tbody tr:first-child > td")];
    return headers.map((header, index) => Math.abs(header.getBoundingClientRect().left - cells[index].getBoundingClientRect().left));
  });
  assert.ok(accountColumnAlignment.every((delta) => delta < 1), `Account headers and cells must share exact column tracks, got ${accountColumnAlignment.join(", ")}`);
  await teammate.getByRole("button", { name: "Edit" }).click();
  const editUser = page.locator("[data-user-edit]");
  const accessLink = editUser.getByRole("link", { name: "Workspace Settings → Access" });
  assert.equal(await accessLink.getAttribute("href"), "#/budget-spend/workspace?workspaceSection=people", "Account editors must link directly to workspace access management");
  await editUser.getByLabel(/Title/).fill("Read-only reviewer updated");
  assert.equal(await editUser.getByRole("button", { name: /role/i }).count(), 0, "Global account editing must not duplicate workspace role management");
  await editUser.getByRole("button", { name: "Save account" }).click();
  await page.getByText("Account updated", { exact: true }).waitFor();
  assert.match(await teammate.innerText(), /Viewer/, "Global identity edits must preserve the workspace role");
  await teammate.getByRole("button", { name: "Reset" }).click();
  const resetUser = page.locator("[data-user-password-reset]");
  await resetUser.getByLabel("Temporary password", { exact: true }).fill("Replacement-User-2026!");
  await resetUser.getByLabel("Confirm temporary password").fill("Replacement-User-2026!");
  await resetUser.getByRole("button", { name: "Reset password" }).click();
  await page.getByText("Temporary password set", { exact: true }).waitFor();
  await teammate.getByRole("button", { name: "Suspend" }).click();
  await page.getByText("User suspended", { exact: true }).waitFor();
  await teammate.getByRole("button", { name: "Reactivate" }).click();
  await page.getByText("User reactivated", { exact: true }).waitFor();
  const viewAs = teammate.getByRole("button", { name: "View as" });
  await viewAs.waitFor();
  await viewAs.click();
  const emulationBanner = page.locator("[data-emulation-banner]");
  await emulationBanner.waitFor();
  assert.match(await emulationBanner.innerText(), /Viewing as Browser teammate[\s\S]*Permissions and team visibility match this user/i, "Super users must be able to emulate an active user even while first-login setup is pending");
  assert.equal(await page.locator("[data-password-change-gate]").count(), 0, "User emulation must inspect effective access instead of forcing the actor through the target's password setup");
  await page.screenshot({ path: "test-results/admin-user-emulation-desktop.png", fullPage: true });
  await emulationBanner.getByRole("button", { name: "Exit view" }).click();
  await emulationBanner.waitFor({ state: "detached" });
  await page.waitForSelector('[data-operations-hub][data-operations-view="users"]');
  await page.locator("[data-user-management]").waitFor();
  await page.getByRole("button", { name: /^Activity/ }).click();
  const activityTable = page.locator('[data-platform-activity-table]');
  await activityTable.waitFor();
  assert.match(await activityTable.innerText(), /Browser teammate[\s\S]*Account Created[\s\S]*Users/i, "Platform activity must retain account lifecycle actions with account and surface metadata");
  assert.ok(await activityTable.getByRole("button", { name: "Account filter" }).count(), "Activity must expose an account filter");
  assert.ok(await activityTable.getByRole("button", { name: "Activity type filter" }).count(), "Activity must expose an activity-type filter");
  assert.ok(await activityTable.getByRole("button", { name: "Action filter" }).count(), "Activity must expose an action filter");
  await page.screenshot({ path: "test-results/admin-user-activity-desktop.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForSelector('[data-platform-activity-table][data-table-layout="cards"]');
  const activityMobileGeometry = await page.locator('[data-user-management]').evaluate(() => ({
    viewportWidth: window.innerWidth,
    documentWidth: document.documentElement.scrollWidth,
  }));
  assert.ok(activityMobileGeometry.documentWidth <= activityMobileGeometry.viewportWidth, "Platform activity must not create mobile overflow");
  await page.screenshot({ path: "test-results/admin-user-activity-mobile.png", fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole("button", { name: /^Accounts/ }).click();
  await page.screenshot({ path: "test-results/admin-users-desktop.png", fullPage: true });
  await teammate.getByRole("button", { name: "Edit" }).click();
  await page.locator("[data-user-edit]").getByRole("link", { name: "Workspace Settings → Access" }).click();
  await page.waitForSelector("[data-workspace-management]");
  assert.equal(await page.locator("[data-workspace-teams]").count(), 0, "Workspace settings should show only the selected section instead of stacking teams below General");
  assert.equal(await page.getByRole("button", { name: "Access", exact: true }).getAttribute("aria-pressed"), "true", "The account-editor access link must open the Access section directly");
  const accessModel = page.locator(".workspace-access-model");
  await accessModel.waitFor();
  assert.equal(await page.locator('[data-workspace-scope="active"] .workspace-card > header').count(), 0, "Focused workspace tabs must not repeat workspace identity above their content");
  assert.equal(await accessModel.getAttribute("open"), null, "The access model should stay collapsed until requested");
  await accessModel.locator("summary").click();
  assert.match(await accessModel.innerText(), /Super user[\s\S]*Workspace manager[\s\S]*Analyst[\s\S]*Viewer[\s\S]*Teams are visibility overlays[\s\S]*never grant write or administration permission/i, "Workspace access must distinguish platform ownership, workspace authority, and team visibility");
  await page.screenshot({ path: "test-results/workspace-access-desktop.png", fullPage: true });
  await chooseControlSelect(page, "Workspace role for Browser teammate in Defense budget", "Analyst");
  await page.getByText(/Browser teammate is now Analyst/).waitFor();
  await page.getByRole("button", { name: "Teams", exact: true }).click();
  await page.waitForSelector("[data-workspace-teams]");
  const teamSurface = page.locator("[data-workspace-teams]");
  assert.match(await teamSurface.innerText(), /Teams & event visibility[\s\S]*never grant workspace permissions[\s\S]*union of their assigned teams/i, "Workspace settings must explain that teams narrow visibility without granting authority");
  await teamSurface.getByRole("button", { name: "Add team" }).click();
  const teamDialog = page.getByRole("dialog", { name: "Create team" });
  await teamDialog.getByLabel("Team name").fill("Browser HR");
  await teamDialog.getByLabel("Description").fill("Private people operations calendar");
  await teamDialog.getByLabel(/Browser teammate/).check();
  await teamDialog.getByRole("button", { name: "Save team" }).click();
  await page.getByText("Team saved", { exact: true }).waitFor();
  const browserTeam = teamSurface.locator("[data-team]", { hasText: "Browser HR" });
  await browserTeam.waitFor();
  assert.equal(await browserTeam.locator('[aria-label="Browser HR"]').innerText(), "BH", "Teams without an uploaded icon must use name initials");
  assert.match(await browserTeam.innerText(), /Browser HR[\s\S]*Private people operations calendar[\s\S]*0 events/i);
  const browserTeamId = await browserTeam.getAttribute("data-team");
  assert.ok(browserTeamId, "Team rows must retain a stable team identity");
  await page.screenshot({ path: "test-results/workspace-teams-desktop.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  const mobileTeamGeometry = await teamSurface.evaluate((node) => ({
    overflow: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - innerWidth,
    buttons: [...node.querySelectorAll("button")].filter((button) => button.offsetParent !== null).map((button) => button.getBoundingClientRect().height),
    tabs: [...document.querySelectorAll(".workspace-settings-tabs button")].map((button) => button.getBoundingClientRect().height),
    offenders: [...document.querySelectorAll("body *")].filter((element) => {
      const bounds = element.getBoundingClientRect();
      return bounds.right > innerWidth + 1 || bounds.left < -1;
    }).slice(0, 8).map((element) => ({ tag: element.tagName, className: String(element.getAttribute("class") || ""), parent: `${element.parentElement?.tagName || ""}.${String(element.parentElement?.getAttribute("class") || "")}`, label: element.parentElement?.getAttribute("aria-label") || element.parentElement?.getAttribute("title") || "", right: Math.round(element.getBoundingClientRect().right), width: Math.round(element.getBoundingClientRect().width) })),
  }));
  assert.ok(mobileTeamGeometry.overflow <= 1, `Team administration must not overflow the mobile viewport: ${JSON.stringify(mobileTeamGeometry)}`);
  assert.ok(mobileTeamGeometry.buttons.every((height) => height >= 43.5), `Visible mobile team actions must retain 44px targets: ${mobileTeamGeometry.buttons.join(", ")}`);
  assert.ok(mobileTeamGeometry.tabs.every((height) => height >= 43.5), `Workspace section tabs must retain 44px mobile targets: ${mobileTeamGeometry.tabs.join(", ")}`);
  await page.screenshot({ path: "test-results/workspace-teams-mobile.png", fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });

  await page.goto(`${BASE_URL}#/budget-spend/schedule?scheduleView=list`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("[data-ops-event-table]");
  await page.getByRole("button", { name: "Add event" }).click();
  const eventDialog = page.getByRole("dialog", { name: "Add event" });
  await eventDialog.getByLabel("Title").fill("Browser HR private planning");
  await eventDialog.getByLabel("Starts").fill("2026-01-05T09:00");
  await eventDialog.getByLabel("Ends").fill("2026-01-05T10:00");
  const hrTeamOption = eventDialog.locator(`[data-event-team-option="${browserTeamId}"]`);
  await hrTeamOption.click();
  assert.equal(await hrTeamOption.getAttribute("aria-pressed"), "true", "Event editors must visibly select a team before save");
  assert.match(await eventDialog.locator("[data-event-team-picker]").innerText(), /1 team selected[\s\S]*Only members of those teams/i, "Event editors must explain the resulting visibility scope");
  await page.screenshot({ path: "test-results/event-team-assignment-desktop.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  const mobileEventTeamGeometry = await eventDialog.locator("[data-event-team-picker]").evaluate((node) => ({
    overflow: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - innerWidth,
    buttons: [...node.querySelectorAll("button")]
      .filter((button) => button.offsetParent !== null)
      .map((button) => button.getBoundingClientRect().height),
  }));
  assert.ok(mobileEventTeamGeometry.overflow <= 1, `Event team assignment must not overflow the mobile viewport: ${JSON.stringify(mobileEventTeamGeometry)}`);
  assert.ok(mobileEventTeamGeometry.buttons.every((height) => height >= 43.5), `Mobile event team choices must retain 44px targets: ${mobileEventTeamGeometry.buttons.join(", ")}`);
  await hrTeamOption.scrollIntoViewIfNeeded();
  await page.screenshot({ path: "test-results/event-team-assignment-mobile.png", fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await eventDialog.getByRole("button", { name: "Save event" }).click();
  await page.locator('[data-ops-event-table] input[type="search"]').fill("Browser HR private planning");
  await page.getByText("Browser HR private planning", { exact: true }).waitFor();
  assert.match(await page.locator("[data-ops-event-table]").innerText(), /Browser HR private planning[\s\S]*Browser HR/i, "The Events grid must expose team visibility without opening event details");
  const eventActionGeometry = await page.locator('[data-ops-event-table] [data-if-table-row] td[data-ui-table-cell-role="actions"]').first().evaluate((cell) => {
    const buttons = [...cell.querySelectorAll("button")];
    const header = cell.closest("table")?.querySelector('th[data-table-column-role="actions"]');
    return {
      cellWidth: cell.getBoundingClientRect().width,
      railWidth: cell.querySelector(".dbi-table-actions")?.getBoundingClientRect().width || 0,
      buttonWidths: buttons.map((button) => button.getBoundingClientRect().width),
      accessibleNames: buttons.map((button) => button.getAttribute("aria-label") || ""),
      headerControls: header?.querySelectorAll(".dbi-data-table__reorder, .dbi-data-table__resizer").length || 0,
    };
  });
  assert.ok(eventActionGeometry.cellWidth <= 130, `Event actions must use a compact content-sized rail: ${JSON.stringify(eventActionGeometry)}`);
  assert.ok(eventActionGeometry.railWidth <= 100, `Three icon-first event actions must remain compact: ${JSON.stringify(eventActionGeometry)}`);
  assert.ok(eventActionGeometry.buttonWidths.every((width) => width <= 34), `Desktop event actions must avoid text-width controls: ${JSON.stringify(eventActionGeometry)}`);
  assert.ok(eventActionGeometry.accessibleNames.every(Boolean), `Icon-first event actions must retain accessible names: ${JSON.stringify(eventActionGeometry)}`);
  assert.equal(eventActionGeometry.headerControls, 0, "Pinned event actions must not expose resize or reorder controls");
  await page.screenshot({ path: "test-results/events-actions-compact-desktop.png", fullPage: true });
  const browserOverlayEvent = await page.evaluate(async () => {
    const response = await fetch("/api/v1/agent/events");
    const body = await response.json();
    return body.data.find((event) => event.title === "Browser HR private planning");
  });
  assert.deepEqual(browserOverlayEvent.teamIds, [browserTeamId], "The event editor must persist the selected team through the API boundary");

  await page.goto(`${BASE_URL}#/budget-spend/schedule?scheduleView=display`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("[data-ops-wallboard]");
  await page.locator("[data-ops-wallboard]").getByRole("button", { name: "Calendar", exact: true }).click();
  const overlayRail = page.locator("[data-calendar-overlays]");
  await overlayRail.waitFor();
  const browserHrOverlay = overlayRail.getByRole("button", { name: /Browser HR/ });
  assert.equal(await browserHrOverlay.getAttribute("aria-pressed"), "true");
  assert.match(await browserHrOverlay.innerText(), /Browser HR[\s\S]*Shown/i, "Visible calendar overlays must state their shown status without relying on opacity");
  assert.equal(await overlayRail.getByRole("button", { name: /Workspace-wide/ }).count(), 1, "The calendar must retain a workspace-wide overlay beside team overlays");
  await page.getByText("Browser HR private planning", { exact: true }).waitFor();
  const calendarTeamAvatar = page.locator(`[data-calendar-event="${browserOverlayEvent.id}"] .ops-wall-calendar__bar-team .team-avatar`);
  await calendarTeamAvatar.waitFor();
  const calendarTeamAvatarGeometry = await calendarTeamAvatar.evaluate((node) => {
    const bounds = node.getBoundingClientRect();
    const style = getComputedStyle(node);
    return { width: bounds.width, height: bounds.height, color: style.color, flexGrow: style.flexGrow };
  });
  assert.ok(calendarTeamAvatarGeometry.width <= 21 && calendarTeamAvatarGeometry.height <= 21, `Calendar team initials must stay compact: ${JSON.stringify(calendarTeamAvatarGeometry)}`);
  assert.equal(calendarTeamAvatarGeometry.color, "rgb(255, 255, 255)", "Calendar team initials must render in white");
  assert.equal(calendarTeamAvatarGeometry.flexGrow, "0", "Calendar team avatars must never stretch across an event bar");
  await browserHrOverlay.click();
  assert.equal(await browserHrOverlay.getAttribute("aria-pressed"), "false", "Calendar overlays must be independently toggleable");
  assert.match(await browserHrOverlay.innerText(), /Browser HR[\s\S]*Hidden/i, "Disabled calendar overlays must retain readable text and state");
  assert.equal(await page.getByText("Browser HR private planning", { exact: true }).count(), 0, "Disabling a team overlay must remove its events from the calendar");
  await browserHrOverlay.click();
  await page.getByText("Browser HR private planning", { exact: true }).waitFor();
  await page.screenshot({ path: "test-results/calendar-team-overlays-desktop.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  const mobileOverlayGeometry = await overlayRail.evaluate((node) => ({
    overflow: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - innerWidth,
    buttons: [...node.querySelectorAll("button")].map((button) => button.getBoundingClientRect().height),
  }));
  assert.ok(mobileOverlayGeometry.overflow <= 1, `Calendar overlays must not overflow the mobile viewport: ${JSON.stringify(mobileOverlayGeometry)}`);
  assert.ok(mobileOverlayGeometry.buttons.every((height) => height >= 43.5), `Mobile overlay toggles must retain 44px targets: ${mobileOverlayGeometry.buttons.join(", ")}`);
  await page.screenshot({ path: "test-results/calendar-team-overlays-mobile.png", fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.evaluate(async ({ eventId }) => {
    await fetch(`/api/v1/agent/events/${encodeURIComponent(eventId)}`, { method: "DELETE" });
  }, { eventId: browserOverlayEvent.id });

  await page.goto(`${BASE_URL}#/budget-spend/workspaces`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("[data-workspace-management]");
  assert.equal(await page.locator('[data-nav-group-trigger="platform-admin"]').getAttribute("data-nav-group-active-child"), "Workspaces", "Workspace governance should activate the dedicated Platform admin dropdown");
  assert.equal(await page.locator('[data-workspace-management] > .if-page-header').count(), 1, "Workspace governance should expose one framework-owned route header");
  await assertPageBodyGutter(page, "[data-workspace-management]", "Workspaces");
  assert.equal(await page.locator('[data-admin-workspace]').count(), 0, "Workspace governance should not repeat platform navigation inside the page");
  const workspaceAdmin = page.locator("[data-workspace-management]");
  await workspaceAdmin.getByRole("button", { name: "Create workspace" }).click();
  const createWorkspaceDialog = page.locator("[data-workspace-create]");
  await createWorkspaceDialog.getByLabel("Name").fill("Browser verification");
  await createWorkspaceDialog.getByLabel("Description").fill("Browser-tested isolated workspace");
  await createWorkspaceDialog.getByRole("button", { name: "Create workspace" }).click();
  const createdWorkspace = workspaceAdmin.locator('[data-workspace]', { hasText: "Browser verification" });
  await createdWorkspace.waitFor();
  assert.equal(await createdWorkspace.locator('[aria-label="Browser verification contents"]').count(), 0, "Global workspace rows should stay collapsed until explicitly managed");
  await createdWorkspace.getByRole("button", { name: "Manage" }).click();
  const manageWorkspaceDialog = page.locator('[data-workspace-manage-dialog]');
  await manageWorkspaceDialog.waitFor();
  await manageWorkspaceDialog.getByRole("button", { name: "Add account" }).click();
  const addMemberDialog = page.locator('[data-workspace-member-dialog]');
  await addMemberDialog.waitFor();
  await chooseControlSelect(page, "User to add to Browser verification", "Browser teammate");
  await chooseControlSelect(page, "Role for new member in Browser verification", "Viewer");
  await addMemberDialog.getByRole("button", { name: "Add member" }).click();
  await addMemberDialog.waitFor({ state: "hidden" });
  await createdWorkspace.getByRole("button", { name: "Manage" }).click();
  await manageWorkspaceDialog.waitFor();
  await manageWorkspaceDialog.getByText("Browser teammate", { exact: true }).waitFor();
  assert.match(await manageWorkspaceDialog.getByRole("button", { name: /^Workspace role for Browser teammate.*:/ }).getAttribute("aria-label"), /Viewer/, "Super user should see the member's current workspace role");
  await chooseControlSelect(page, "Workspace role for Browser teammate in Browser verification", "Analyst");
  await page.getByText(/Browser teammate is now Analyst/).waitFor();
  assert.equal(await manageWorkspaceDialog.locator('[aria-label="Browser verification contents"] article').count(), 6, "Each managed workspace should present its isolated content inventory");
  await manageWorkspaceDialog.getByRole("button", { name: "Configure workspace" }).click();
  const workspaceEditor = page.locator("[data-workspace-editor]");
  await workspaceEditor.getByLabel("Workspace name").fill("Browser command");
  await workspaceEditor.getByLabel("Description").fill("Renamed browser-tested workspace");
  await workspaceEditor.getByLabel("Header eyebrow").fill("Sabre workspace intelligence");
  await workspaceEditor.getByLabel("Display title").fill("Sabre BD");
  const autoAcceptAi = workspaceEditor.getByLabel("Automatically accept safe AI augmentations");
  assert.equal(await autoAcceptAi.isChecked(), false, "AI augmentation auto-acceptance must be an explicit workspace opt-in");
  assert.match(await workspaceEditor.locator("[data-workspace-ai-auto-accept]").innerText(), /verified, additive, conflict-free[\s\S]*remain pending for validation/i, "The workspace policy must explain its safe acceptance boundary");
  await workspaceEditor.locator('input[type="file"]').setInputFiles("public/icon-192.png");
  await workspaceEditor.locator(".workspace-card__branding > img").waitFor();
  await workspaceEditor.getByRole("button", { name: "Save workspace" }).click();
  await page.getByText("Browser command updated.", { exact: true }).waitFor();
  const workspaceToast = page.locator(".if-toast").filter({ hasText: "Browser command updated." });
  assert.match(await workspaceToast.innerText(), /Workspace updated[\s\S]*Browser command updated/);
  assert.equal(await workspaceToast.getByRole("button", { name: "Dismiss notification" }).count(), 1, "Workspace actions should use a dismissible framework toast");
  const renamedWorkspace = workspaceAdmin.locator('[data-workspace]', { hasText: "Browser command" });
  await renamedWorkspace.waitFor();
  assert.equal(await renamedWorkspace.locator(':scope > header > span img[src^="data:image/webp"]').count(), 1, "Workspace cards should render their configured icon in the identity slot");
  assert.doesNotMatch(await renamedWorkspace.innerText(), /Workspace inventory|Manual records|Audit entries/, "Global workspace rows should stay concise after configuration");
  await renamedWorkspace.getByRole("button", { name: "Manage" }).click();
  const renamedManageDialog = page.locator('[data-workspace-manage-dialog]');
  await renamedManageDialog.waitFor();
  assert.match(await renamedManageDialog.innerText(), /Workspace inventory[\s\S]*Tracked[\s\S]*Events[\s\S]*Milestones[\s\S]*Manual records[\s\S]*Audit entries[\s\S]*Agent keys/i);
  await renamedManageDialog.getByRole("button", { name: /Remove Browser teammate/ }).click();
  await page.getByText(/removed from Browser command/).waitFor();
  const addMemberButton = renamedManageDialog.getByRole("button", { name: "Add account" });
  await addMemberButton.waitFor();
  await page.waitForFunction((button) => !button.disabled, await addMemberButton.elementHandle());
  await page.screenshot({ path: "test-results/admin-workspaces-desktop.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  const mobileWorkspaceGeometry = await renamedManageDialog.evaluate((node) => {
    const inventory = node.querySelector('[aria-label="Browser command inventory"]');
    const controls = [...node.querySelectorAll("button, input")];
    const inventoryStyle = getComputedStyle(inventory);
    return {
      documentOverflow: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - innerWidth,
      inventoryDisplay: inventoryStyle.display,
      inventoryOverflow: inventoryStyle.overflowX,
      inventoryScrollWidth: inventory.scrollWidth,
      inventoryClientWidth: inventory.clientWidth,
      inventoryItems: inventory.children.length,
      controlHeights: controls.map((control) => control.getBoundingClientRect().height),
    };
  });
  assert.ok(mobileWorkspaceGeometry.documentOverflow <= 2, `Mobile workspace command should not overflow the document, got ${mobileWorkspaceGeometry.documentOverflow}px`);
  assert.equal(mobileWorkspaceGeometry.inventoryDisplay, "flex", "Mobile workspace inventory should use the shared horizontal metric rail");
  assert.equal(mobileWorkspaceGeometry.inventoryOverflow, "auto", "Mobile workspace inventory should keep overflow inside the metric rail");
  assert.ok(mobileWorkspaceGeometry.inventoryScrollWidth > mobileWorkspaceGeometry.inventoryClientWidth, "Mobile workspace inventory should expose all metrics through contained horizontal scrolling");
  assert.equal(mobileWorkspaceGeometry.inventoryItems, 6, "Mobile workspace inventory should preserve all six content categories");
  assert.ok(mobileWorkspaceGeometry.controlHeights.every((height) => height >= 43.5), `Mobile workspace controls must retain 44px targets: ${mobileWorkspaceGeometry.controlHeights.join(", ")}`);
  const addMemberPresentation = await addMemberButton.evaluate((button) => ({ text: button.innerText.trim(), opacity: getComputedStyle(button).opacity }));
  assert.equal(addMemberPresentation.text, "Add account", "Mobile workspace add control must retain its visible label");
  assert.equal(addMemberPresentation.opacity, "1", "Mobile workspace add control must remain fully visible when ready");
  assert.ok(await page.locator(".if-toast-stack .if-toast").count() <= 1, "Transient mutation feedback must never obscure the management surface with more than one toast");
  await page.screenshot({ path: "test-results/admin-workspaces-mobile.png", fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await renamedManageDialog.getByRole("button", { name: "Close", exact: true }).click();
  await renamedManageDialog.waitFor({ state: "detached" });

  await page.locator("[data-profile-menu-trigger]").click();
  const workspaceSwitcher = page.locator(workspaceTriggerSelector);
  await workspaceSwitcher.click();
  const workspaceMenu = page.locator("[data-if-picker-menu]");
  await workspaceMenu.waitFor();
  assert.equal(await workspaceMenu.getByLabel("Search workspaces").count(), 1, "Workspace picker should expose a dedicated search field");
  assert.equal(await workspaceMenu.getByRole("option").count(), 2, "Workspace picker should present every available workspace");
  assert.equal(await workspaceMenu.getByRole("option").locator("img").count(), 2, "Every workspace option should carry its workspace icon");
  assert.equal(await workspaceMenu.getByRole("option", { selected: true }).count(), 1, "Workspace picker should clearly mark the active workspace");
  assert.match(await workspaceMenu.getByRole("option", { name: /Browser command/ }).innerText(), /Super user/i, "Workspace identity edits must preserve the membership role shown in the picker");
  const workspaceMenuGeometry = await workspaceMenu.evaluate((node) => {
    const bounds = node.getBoundingClientRect();
    return { left: bounds.left, right: bounds.right, top: bounds.top, bottom: bounds.bottom, searchHeight: node.querySelector('input[type="search"]').getBoundingClientRect().height };
  });
  assert.ok(workspaceMenuGeometry.left >= 11 && workspaceMenuGeometry.right <= 1429 && workspaceMenuGeometry.top >= 11 && workspaceMenuGeometry.bottom <= 989, `Workspace menu should remain inside the desktop viewport: ${JSON.stringify(workspaceMenuGeometry)}`);
  await page.screenshot({ path: "test-results/profile-workspace-switcher-desktop.png" });
  await workspaceMenu.getByLabel("Search workspaces").fill("Browser command");
  assert.equal(await workspaceMenu.getByRole("option").count(), 1, "Workspace search should filter by workspace identity");
  await workspaceMenu.getByLabel("Search workspaces").press("ArrowDown");
  assert.equal(await workspaceMenu.getByRole("option").evaluate((node) => node === document.activeElement), true, "Arrow Down should move focus from search to the matching workspace");
  await Promise.all([
    page.waitForNavigation({ waitUntil: "domcontentloaded" }),
    workspaceMenu.getByRole("option").press("Enter"),
  ]);
  await page.waitForSelector("[data-defense-budget-app]");
  await page.locator("[data-profile-menu-trigger]").click();
  assert.equal((await page.locator(`${workspaceTriggerSelector} strong`).innerText()).toLocaleLowerCase(), "browser command", "Keyboard selection should switch to the matching workspace");
  await page.locator(workspaceTriggerSelector).click();
  await page.locator("[data-if-picker-menu]").getByLabel("Search workspaces").fill(initialWorkspaceName);
  await Promise.all([
    page.waitForNavigation({ waitUntil: "domcontentloaded" }),
    page.locator("[data-if-picker-menu]").getByRole("option").click(),
  ]);
  await page.waitForSelector("[data-defense-budget-app]");
  await page.locator("[data-profile-menu-trigger]").click();
  assert.equal(await page.locator(`${workspaceTriggerSelector} strong`).innerText(), initialWorkspaceName, "Workspace switcher should return to the original active workspace");
  await page.locator("[data-profile-menu-trigger]").click();

  const signupContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const signupPage = await signupContext.newPage();
  await signupPage.goto(BASE_URL, { waitUntil: "domcontentloaded" });
  await signupPage.waitForSelector('[data-account-gate="login"]');
  const mobileLoginGeometry = await signupPage.locator(".account-gate form > .if-btn").evaluateAll((buttons) => buttons.map((button) => ({
    height: button.getBoundingClientRect().height,
    label: button.textContent.trim().replace(/\s+/g, " "),
  })));
  assert.equal(mobileLoginGeometry.length, 2, "Mobile sign-in should expose one submit action and one account-creation action");
  assert.ok(mobileLoginGeometry.every(({ height }) => height >= 43.5), `Mobile sign-in actions must retain 44px targets: ${JSON.stringify(mobileLoginGeometry)}`);
  await signupPage.screenshot({ path: "test-results/account-login-mobile.png" });
  await signupPage.setViewportSize({ width: 1080, height: 900 });
  await signupPage.getByRole("button", { name: "New here? Create an account" }).click();
  await signupPage.waitForSelector('[data-account-gate="register"]');
  await signupPage.getByLabel("Display name").fill("Self Signup User");
  await signupPage.getByLabel("Email").fill("self-signup@example.test");
  await signupPage.getByLabel(/Title/).fill("Workspace requestor");
  await signupPage.getByLabel("Password", { exact: true }).fill("Self-Signup-2026!");
  await signupPage.getByLabel("Confirm password").fill("Self-Signup-2026!");
  await signupPage.getByRole("button", { name: "Create account" }).click();
  await signupPage.waitForSelector('[data-account-gate="workspace-access"]');
  await signupPage.getByRole("button", { name: "Request access" }).first().click();
  await signupPage.getByText(/Access request sent/).waitFor();

  await page.reload({ waitUntil: "domcontentloaded" });
  const requestRow = page.locator("[data-workspace-request]", { hasText: "Self Signup User" });
  await requestRow.waitFor();
  await chooseControlSelect(page, "Role for Self Signup User", "Viewer");
  await requestRow.getByRole("button", { name: "Approve" }).click();
  await page.getByText("Self Signup User approved.", { exact: true }).waitFor();
  await signupPage.reload({ waitUntil: "domcontentloaded" });
  await signupPage.waitForSelector("[data-defense-budget-app]");
  await signupContext.close();

  await page.goto(`${BASE_URL}#/budget-spend/schedule?scheduleView=list`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("[data-ops-events]");
  await page.getByRole("button", { name: "Manage categories" }).click();
  await page.waitForSelector("[data-event-category-manager]");
  assert.equal(await page.locator("[data-event-category]").count(), 6, "Every workspace should expose the default managed event taxonomy");
  await page.getByLabel("New category").fill("Customer forum");
  await page.getByLabel("Description").first().fill("Customer-led mission and roadmap sessions");
  await page.getByRole("button", { name: "Add category" }).click();
  await page.waitForFunction(() => document.querySelectorAll("[data-event-category]").length === 7);
  await page.getByRole("button", { name: "Close event categories" }).click();
  const browserAiKey = "sk-browser_event_ai_verification_00000001";
  const browserAiCredential = await page.evaluate(async (apiKey) => {
    const response = await fetch("/api/v1/auth/openai-keys", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ scope: "user", label: "Browser event AI", apiKey, isDefault: true }) });
    return { status: response.status, body: await response.json() };
  }, browserAiKey);
  assert.equal(browserAiCredential.status, 201, "Authenticated event AI browser proof requires a personal encrypted key");
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector("[data-ops-events]");
  assert.equal(await page.locator('[data-control-area]').count(), 0, "Schedule List must render as a primary surface without a management shell");
  assert.equal(await page.locator('[data-primary-nav="schedule"][aria-current="page"]').count(), 1, "Schedule must own the direct primary-navigation position for event work");
  assert.equal(await page.locator('[data-ops-events] > [data-event-ai-launcher]').count(), 0, "Events must not place the augmentation launcher above the data table");
  await page.goto(`${BASE_URL}#/budget-spend/schedule?scheduleView=calendar`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-wallboard-calendar][data-calendar-layout="standalone"]');
  const authenticatedScheduleCalendar = await page.locator('[data-wallboard-calendar][data-calendar-layout="standalone"]').evaluate((node) => ({
    days: node.querySelectorAll("[data-calendar-day]").length,
    height: node.querySelector(".ops-wall-calendar__weeks").getBoundingClientRect().height,
  }));
  assert.equal(authenticatedScheduleCalendar.days, 42, "Authenticated Schedule Calendar must render the complete six-week month");
  assert.ok(authenticatedScheduleCalendar.height >= 539, `Authenticated Schedule Calendar must not collapse: ${JSON.stringify(authenticatedScheduleCalendar)}`);
  const publicDirectoryMember = await page.evaluate(async () => {
    const response = await fetch("/api/v1/auth/directory");
    const body = await response.json();
    return body.users.find((user) => user.displayName === "Workspace Owner");
  });
  assert.equal(publicDirectoryMember.role, "Super user", "Workspace-public profiles require the directory's scoped role label");
  await page.goto(`${BASE_URL}#/workspace/directory?member=${encodeURIComponent(publicDirectoryMember.id)}`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(`[data-workspace-member-profile][data-member-id="${publicDirectoryMember.id}"]`);
  assert.equal(new URL(page.url()).hash, `#/workspace/directory?member=${encodeURIComponent(publicDirectoryMember.id)}`, "Member profiles must use a canonical workspace-public URL independent of Schedule state");
  assert.match(await page.locator("[data-workspace-member-profile]").innerText(), /Workspace Owner[\s\S]*Super user[\s\S]*Teams[\s\S]*Schedule associations[\s\S]*Linked work/i, "Authenticated workspace profiles must expose only role, visible teams, and visible work associations");
  assert.doesNotMatch(await page.locator("[data-workspace-member-profile]").innerText(), new RegExp(email.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"), "Workspace-public profiles must not expose account email addresses");
  await page.goto(`${BASE_URL}#/workspace/directory?team=${encodeURIComponent(browserTeamId)}`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(`[data-workspace-team-profile][data-team-id="${browserTeamId}"]`);
  assert.match(await page.locator("[data-workspace-team-profile]").innerText(), /Browser HR[\s\S]*Members[\s\S]*Team schedule[\s\S]*Linked work/i, "Team profiles must expose only caller-visible membership, schedule, and linked work");
  assert.doesNotMatch(await page.locator("[data-workspace-team-profile]").innerText(), /password|credential|authorization/i, "Workspace-public team profiles must exclude private authentication data");
  await page.evaluate(async (teamId) => {
    await fetch(`/api/v1/auth/teams/${encodeURIComponent(teamId)}`, { method: "DELETE" });
  }, browserTeamId);
  await page.goto(`${BASE_URL}#/budget-spend/schedule?scheduleView=list`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("[data-ops-events]");
  const augmentedEventAction = page.getByRole("button", { name: /^Research and augment / }).first();
  const augmentedEventId = await augmentedEventAction.evaluate((button) => button.closest("[data-row-key]")?.getAttribute("data-row-key") || "");
  assert.ok(augmentedEventId, "The augmentation action must retain the event's stable row identity");
  await augmentedEventAction.click();
  await page.waitForSelector("[data-event-ai-launcher-dialog]");
  await page.waitForSelector("[data-event-ai-launcher]");
  const aiLauncher = page.locator("[data-event-ai-launcher]");
  assert.match(await aiLauncher.innerText(), /What happens after launch[\s\S]*Research[\s\S]*Verify[\s\S]*Apply or review/i, "Events must explain the detached research, verification, and workspace-policy lifecycle");
  await aiLauncher.getByRole("button", { name: /^Research model: gpt-5\.4/ }).waitFor();
  await aiLauncher.getByRole("button", { name: /^Verification model: gpt-5\.4/ }).waitFor();
  assert.match(await aiLauncher.innerText(), /credential-specific[\s\S]*3 compatible text models[\s\S]*credential.s project/i, "The launcher must disclose credential-specific model inventory semantics");
  const aiAction = page.getByRole("button", { name: "Start augmentation" });
  assert.match(await aiAction.getAttribute("class"), /if-btn--ai/, "The primary AI action must use the shared Control Surface AI treatment");
  const aiActionStyle = await aiAction.evaluate((node) => ({ backgroundColor: getComputedStyle(node).backgroundColor, backgroundImage: getComputedStyle(node).backgroundImage }));
  assert.equal(aiActionStyle.backgroundImage, "none", "The shared AI action must retain the framework's flat treatment");
  assert.notEqual(aiActionStyle.backgroundColor, "rgba(0, 0, 0, 0)", "The shared AI action must expose its violet action color");
  await chooseControlSelect(page, "Research model", "gpt-5.4-mini");
  assert.match(await aiLauncher.getByRole("button", { name: /^Research model:/ }).getAttribute("aria-label"), /gpt-5\.4-mini/, "The research and verification models must be independently selectable");
  await aiLauncher.scrollIntoViewIfNeeded();
  await page.screenshot({ path: "test-results/event-ai-model-picker-desktop.png" });
  await aiLauncher.getByLabel("Event name or research target").fill("Browser AI assisted event");
  await page.route("**/api/v1/auth/event-ai", async (route) => {
    if (route.request().method() === "POST") await new Promise((resolve) => setTimeout(resolve, 400));
    await route.continue();
  });
  const launchClick = aiAction.click();
  const actionSpinner = page.locator("[data-event-ai-launcher-dialog] .if-btn__spinner");
  await actionSpinner.waitFor();
  assert.equal(await actionSpinner.evaluate((node) => getComputedStyle(node).animationName), "if-spin", "Working AI actions must expose visible rotational progress");
  await launchClick;
  await page.getByText("Event research started", { exact: true }).waitFor();
  await page.unroute("**/api/v1/auth/event-ai");
  assert.equal(await page.locator(".if-toast-stack--bottom .if-toast--info").count(), 1, "Starting background work must produce one visible bottom-edge toast without covering the route header");
  assert.equal(await page.locator("[data-event-ai-launcher-dialog]").count(), 0, "Starting augmentation must close its dedicated launcher modal");
  assert.equal(await page.locator("[data-ops-event-editor]").count(), 0, "Starting background research must not trap the operator in the event editor");
  const notificationButton = page.getByRole("button", { name: /^Notifications/ });
  await notificationButton.click();
  const notificationCenter = page.locator("[data-notification-center]");
  await notificationCenter.getByText(/Browser AI assisted event is (in progress|ready)|Browser AI assisted event needs review/).waitFor();
  await page.waitForFunction(() => /Browser AI assisted event (is ready|needs review)/.test(document.querySelector("[data-notification-center]")?.innerText || ""), null, { timeout: 15_000 });
  assert.match(await notificationCenter.innerText(), /Needs attention[\s\S]*(Verified additions are ready for your review|resolve the remaining validation issue)/i, "Completed background work must remain in the notification tray until reviewed");
  await notificationCenter.getByText(/Browser AI assisted event (is ready|needs review)/, { exact: true }).click();
  await page.waitForSelector("[data-task-center]");
  assert.equal(await page.locator('[data-task-center] > .if-page-header').count(), 0, "Selected Task Center detail should remove the redundant route header");
  assert.equal(await page.locator('[data-task-center] > .if-page-body').count(), 1, "Task Center content must use the shared page-body gutter");
  await page.waitForSelector('[data-event-ai-review="completed"], [data-event-ai-review="needs_review"]');
  const aiReview = page.locator('[data-event-ai-review="completed"], [data-event-ai-review="needs_review"]');
  assert.match(await aiReview.innerText(), /(Verified draft ready|Operator validation required)[\s\S]*Research: gpt-5\.4-mini · Verification: gpt-5\.4[\s\S]*Verified changes[\s\S]*Evidence & exclusions/i, "The dedicated review workspace must disclose stages, selected models, unified changes, and evidence");
  assert.ok(await aiReview.locator("[data-event-ai-diff-preview] .if-change-list__item").count() >= 1, "AI review must render each changed field once in the shared change list");
  assert.equal(await page.locator('[data-task-center] > .if-page-body > .if-management-grid[aria-label="Task summary"]').count(), 0, "Selected task detail must replace the summary boxes instead of stacking beneath them");
  assert.equal(await page.locator("[data-task-table]").count(), 0, "Selected task detail must replace the retained task table instead of stacking above it");
  assert.equal(await aiReview.locator(".if-progress-rail").count(), 1, "Task progress must use the compact shared progress rail");
  assert.equal(await aiReview.locator("[data-task-activity]").count(), 0, "Task review should not stack the full activity chain below the draft by default");
  await aiReview.getByRole("button", { name: /Activity/ }).click();
  const taskInspector = aiReview.locator("[data-task-activity] .if-activity-inspector");
  assert.equal(await taskInspector.count(), 1, "Task detail must expose one ordered framework activity inspector");
  const researchStage = taskInspector.getByRole("tab", { name: /Research/ });
  await researchStage.waitFor({ state: "visible", timeout: 10_000 });
  assert.ok(await taskInspector.getByRole("tab").count() >= 3, "Task activity must retain submission, every logged provider exchange, and the terminal outcome");
  assert.equal(await aiReview.locator("[data-task-exchange]").count(), 1, "Task activity must render only the selected request and response stage");
  assert.match(await aiReview.locator("[data-task-exchange]").first().innerText(), /TASK[\s\S]*Research and augment event[\s\S]*JOB ID[\s\S]*STATUS/i, "Task activity must disclose a concise submitted request and normalized response");
  assert.equal(await aiReview.locator("[data-task-exchange] details[open]").count(), 0, "Raw task payloads should stay collapsed by default");
  await researchStage.click();
  assert.equal(await aiReview.locator("[data-task-exchange]").count(), 1, "Selecting another stage must replace rather than stack the request and response inspector");
  assert.match(await aiReview.locator("[data-task-exchange]").innerText(), /OPERATION[\s\S]*STAGE[\s\S]*Research[\s\S]*STATUS[\s\S]*(succeeded|completed)/i, "Research activity must expose a concise provider exchange before raw diagnostics");
  await aiReview.locator("[data-task-exchange]").getByText("View payload", { exact: true }).click();
  assert.match(await aiReview.locator("[data-task-exchange]").innerText(), /searchQueries[\s\S]*official event details[\s\S]*Response[\s\S]*(succeeded|completed)/i, "The explicit payload disclosure must retain bounded search queries and normalized provider response");
  await researchStage.focus();
  await researchStage.press("ArrowRight");
  assert.equal(await taskInspector.locator('[role="tab"][aria-selected="true"]').count(), 1, "Arrow keys must retain one selected activity stage");
  assert.notEqual(await researchStage.getAttribute("aria-selected"), "true", "Arrow keys must move selection to the next retained activity stage");
  await taskInspector.getByRole("tab", { name: /Research/ }).click();
  await assertPageBodyGutter(page, "[data-task-center]", "Task Center");
  assert.doesNotMatch(await aiReview.innerText(), /sk-browser|authorization|request body|response body/i, "AI review must never expose secrets or raw provider payloads");
  await page.screenshot({ path: "test-results/task-center-activity-desktop.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  const taskMobileGeometry = await page.locator("[data-task-center]").evaluate((node) => ({
    documentWidth: document.documentElement.scrollWidth,
    viewportWidth: document.documentElement.clientWidth,
    codeWidths: [...node.querySelectorAll("[data-task-exchange] pre")].map((item) => item.getBoundingClientRect().width),
    stageHeights: [...node.querySelectorAll('.if-activity-inspector__stage')].map((item) => item.getBoundingClientRect().height),
    activityHeight: node.querySelector('[data-task-activity]')?.getBoundingClientRect().height || 0,
  }));
  assert.ok(taskMobileGeometry.documentWidth <= taskMobileGeometry.viewportWidth + 1, "Task request and response details must not create mobile document overflow");
  assert.ok(taskMobileGeometry.codeWidths.every((width) => width < 350), "Task request and response inspectors must stay within the mobile page gutter");
  assert.ok(taskMobileGeometry.stageHeights.every((height) => height >= 44), "Every mobile activity stage must remain a touch-safe selector");
  assert.ok(taskMobileGeometry.activityHeight < 1250, `Selected-stage activity must stay below 1250 px on mobile, got ${taskMobileGeometry.activityHeight}px`);
  await page.screenshot({ path: "test-results/task-center-activity-mobile.png", fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await aiReview.getByRole("button", { name: "Review", exact: true }).click();
  await page.screenshot({ path: "test-results/task-center-desktop.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: "test-results/task-center-mobile.png", fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await aiReview.getByRole("button", { name: "Open verified draft" }).click();
  await page.waitForSelector("[data-ops-event-editor]");
  const eventEditor = page.locator("[data-ops-event-editor]");
  const reviewDialogBounds = await page.locator('dialog:has([data-ops-event-editor])').boundingBox();
  assert.ok(reviewDialogBounds?.width >= 900, `AI-assisted event review must use the expanded detail-dialog width, got ${reviewDialogBounds?.width}px`);
  await eventEditor.locator("[data-event-more-details] > summary").click();
  assert.equal(await eventEditor.getByLabel("Location", { exact: true }).inputValue(), "National Harbor, Maryland, USA", "Verified AI review must preserve an existing operator location");
  assert.equal(await eventEditor.locator("label", { hasText: "Notes" }).locator("textarea").inputValue(), "Verified public event summary.", "Verified AI additions must fill genuinely missing event fields");
  await eventEditor.getByRole("textbox", { name: "Starts", exact: true }).fill("2027-05-10T09:00");
  const categoryPicker = page.getByRole("button", { name: /^Event categories:/ });
  await categoryPicker.click();
  await page.getByLabel("Search Event categories").fill("Customer forum");
  await page.getByRole("option", { name: /Customer forum/ }).click();
  await page.keyboard.press("Escape");
  const attendeePicker = page.getByRole("button", { name: /^Attendees:/ });
  await attendeePicker.click();
  await page.getByLabel("Search Attendees").fill("Browser teammate");
  await page.getByRole("option", { name: /Browser teammate/ }).click();
  assert.match(await attendeePicker.getAttribute("aria-label"), /Attendees \(1\)/, "Event attendees should use the searchable workspace-user multiselect");
  const initialLinkCount = await eventEditor.locator("[data-event-links] .if-collection-editor__item").count();
  await page.getByRole("button", { name: "Add link" }).click();
  assert.equal(await eventEditor.locator("[data-event-links] .if-collection-editor__item").count(), initialLinkCount + 1, "Adding an event link must append one shared collection-editor item");
  assert.equal(await eventEditor.locator("[data-event-links] .if-collection-editor__body:visible").count(), 1, "A newly added event link must open for immediate editing");
  await page.getByLabel(`Event link ${initialLinkCount + 1} label`).fill("Official page");
  await page.getByLabel(`Event link ${initialLinkCount + 1} URL`).fill("https://example.test/customer-forum");
  const initialMilestoneCount = await eventEditor.locator("[data-event-milestones] .if-collection-editor__item").count();
  await page.getByRole("button", { name: "Add milestone" }).click();
  const newMilestoneNumber = initialMilestoneCount + 1;
  await chooseControlSelect(page, `Milestone ${newMilestoneNumber} type`, "Refund deadline");
  await page.getByLabel(`Milestone ${newMilestoneNumber} date`).fill("2026-10-01");
  await page.getByLabel(`Milestone ${newMilestoneNumber} label`).fill("Last day for refunds");
  assert.equal(await eventEditor.locator("[data-event-milestones] .if-collection-editor__item").count(), newMilestoneNumber, "Adding an event milestone must append one shared collection-editor item");
  assert.equal(await eventEditor.locator(".if-card .if-card").count(), 0, "Event editing must not nest bordered cards inside bordered cards");
  assert.equal(await eventEditor.locator("[data-event-record-links][open]").count(), 0, "Secondary watched-record linking must remain collapsed by default");
  const milestoneAction = page.getByRole("button", { name: "Add milestone" });
  assert.match(await milestoneAction.getAttribute("class"), /if-btn--secondary/, "The milestone action must use the shared secondary button contract");
  const milestoneActionBox = await milestoneAction.boundingBox();
  const milestoneActionContentFits = await milestoneAction.evaluate((node) => node.scrollWidth <= node.clientWidth + 1);
  assert.ok(milestoneActionBox?.height >= 30 && milestoneActionBox?.width >= 110 && milestoneActionContentFits, "The compact milestone action must retain a complete readable control shape");
  await page.screenshot({ path: "test-results/event-ai-review-desktop.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  const eventEditorMobileGeometry = await eventEditor.evaluate((node) => {
    const body = node.querySelector(".if-dialog__body").getBoundingClientRect();
    const collections = [...node.querySelectorAll(".if-collection-editor")].map((item) => item.getBoundingClientRect());
    return {
      documentOverflow: document.documentElement.scrollWidth - innerWidth,
      collectionsContained: collections.every((item) => item.left >= body.left - 1 && item.right <= body.right + 1),
      visibleEditors: node.querySelectorAll(".if-collection-editor__body:not([hidden])").length,
      minimumControlHeight: Math.min(...[...node.querySelectorAll(".if-btn, .if-input, .if-textarea, .if-picker__trigger, .if-collection-editor__summary")].filter((item) => item.offsetParent !== null).map((item) => item.getBoundingClientRect().height)),
    };
  });
  assert.ok(eventEditorMobileGeometry.documentOverflow <= 1, "The sleek event editor must not create mobile document overflow");
  assert.ok(eventEditorMobileGeometry.collectionsContained, "Event collections must stay within the measured mobile dialog gutters");
  assert.equal(eventEditorMobileGeometry.visibleEditors, 2, "Each independent event collection must expose only its single active editor");
  assert.ok(eventEditorMobileGeometry.minimumControlHeight >= 43.5, `Visible event editor controls must retain 44px mobile geometry, got ${eventEditorMobileGeometry.minimumControlHeight}px`);
  await page.screenshot({ path: "test-results/event-editor-sleek-mobile.png" });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole("button", { name: "Close event editor" }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${BASE_URL}#/budget-spend/schedule?scheduleView=list`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-ops-event-table][data-table-layout="cards"]');
  const augmentedEventState = await page.evaluate(async (eventId) => {
    const response = await fetch("/api/v1/agent/events");
    const payload = await response.json();
    return payload.data?.find((event) => event.id === eventId) || null;
  }, augmentedEventId);
  assert.ok(augmentedEventState, `The augmented event must remain addressable by its stable ID in the owning workspace: ${augmentedEventId}`);
  assert.equal(Boolean(augmentedEventState.aiValidationRequired || augmentedEventState.aiAmended), true, `The augmented event API must expose its review/application state: ${JSON.stringify(augmentedEventState)}`);
  const augmentedEventSearch = page.locator('[data-ops-event-table] input[type="search"]');
  await augmentedEventSearch.fill(augmentedEventState.title);
  await page.locator('[data-ops-event-table]').getByText(/Validation required|AI amended/).first().waitFor({ timeout: 10_000 });
  assert.match(await page.locator('[data-ops-event-table]').innerText(), /(Validation required|AI amended)[\s\S]*Last augmented/i, "The Events grid must expose augmentation state and recency without opening Task Center");
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${BASE_URL}#/budget-spend/connections?connectionsView=activity`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("[data-api-request-summary] .if-sparkline svg");
  assert.equal(await page.locator("[data-api-request-summary] .if-sparkline svg").count(), 4, "API Log summary metrics must use the shared sparkline component when retained history is available");
  assert.equal(await page.locator("[data-api-request-summary].if-management-grid--strip").count(), 1, "API Log metrics must use one flat summary strip instead of four boxed cards");
  assert.equal(await page.locator("[data-api-observability-charts].if-chart-grid--band .if-chart-card--flat").count(), 2, "API Log charts must use one flat chart band instead of nested chart cards");
  const summaryGeometry = await page.locator("[data-api-request-summary]").evaluate((node) => ({
    width: node.getBoundingClientRect().width,
    sparklineWidths: [...node.querySelectorAll(".if-sparkline")].map((sparkline) => sparkline.getBoundingClientRect().width),
    cardBorders: [...node.querySelectorAll(".if-management-card")].map((card) => getComputedStyle(card).borderTopWidth),
  }));
  assert.ok(summaryGeometry.sparklineWidths.every((width) => width <= 145 && width < summaryGeometry.width / 4), "Summary sparklines must stay compact and proportional instead of stretching across their metric cell");
  assert.ok(summaryGeometry.cardBorders.every((width) => width === "0px"), "Flat summary cells must remove redundant card borders");
  const firstSparklineSample = page.locator("[data-api-request-summary] .if-sparkline__sample").first();
  await firstSparklineSample.hover();
  assert.match(await page.locator("[data-api-request-summary] .if-sparkline__tooltip").first().innerText(), /requests/i, "Sparkline samples must expose visible hover values");
  const outcomeBar = page.locator("[data-api-observability-charts] .if-chart-card").first().locator("button.if-chart-bar").first();
  await outcomeBar.hover();
  assert.match(await page.locator("[data-api-observability-charts] .if-chart-tooltip").innerText(), /click to filter/i, "Chart bars must expose a visible hover value and action");
  await outcomeBar.click();
  assert.equal(await outcomeBar.getAttribute("aria-pressed"), "true", "Clicking an outcome bar must select it");
  assert.match(await page.getByRole("button", { name: /Status filter:/ }).getAttribute("aria-label"), /succeeded|failed|rejected|rate limited/i, "Outcome selection must synchronize the request-table status filter");
  await outcomeBar.click();
  assert.equal(await outcomeBar.getAttribute("aria-pressed"), "false", "Clicking the selected outcome again must clear it");
  const latencyBar = page.locator("[data-api-observability-charts] .if-chart-card").nth(1).locator("button.if-chart-bar").first();
  await latencyBar.click();
  assert.equal(await latencyBar.getAttribute("aria-pressed"), "true", "Clicking a latency bar must select its operation filter");
  assert.doesNotMatch(await page.getByRole("button", { name: /Operation filter:/ }).getAttribute("aria-label"), /: All$/i, "Latency selection must synchronize the request-table operation filter");
  await latencyBar.click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${BASE_URL}#/budget-spend/connections?connectionsView=activity`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("[data-api-request-summary] .if-sparkline svg");
  const mobileApiLogGeometry = await page.locator("[data-ops-activity]").evaluate((node) => ({
    documentWidth: document.documentElement.scrollWidth,
    viewportWidth: window.innerWidth,
    chartColumns: getComputedStyle(node.querySelector("[data-api-observability-charts]")).gridTemplateColumns.split(" ").length,
    minimumBarHeight: Math.min(...[...node.querySelectorAll("button.if-chart-bar")].map((bar) => bar.getBoundingClientRect().height)),
  }));
  assert.ok(mobileApiLogGeometry.documentWidth <= mobileApiLogGeometry.viewportWidth, "Compact API Log must not create mobile document overflow");
  assert.equal(mobileApiLogGeometry.chartColumns, 1, "Compact API Log charts must stack into one clean mobile band");
  assert.ok(mobileApiLogGeometry.minimumBarHeight >= 44, "Interactive mobile chart bars must retain 44px touch targets");
  assert.ok(await page.locator("[data-api-request-table] [data-if-table-row]").count() <= 3, "Mobile API Log should default to three request cards before pagination");
  const firstMobileRequest = page.locator("[data-api-request-table] [data-if-table-row]").first();
  assert.equal(await firstMobileRequest.locator('td[data-table-mobile-visible="true"]').count(), 4, "Mobile API request cards should show only the four decision-useful summary fields");
  assert.equal(await firstMobileRequest.locator('td[data-table-mobile-visible="false"]:visible').count(), 0, "Secondary API request diagnostics must stay behind disclosure on mobile");
  const mobileRequestCardGeometry = await firstMobileRequest.evaluate((row) => ({
    height: row.getBoundingClientRect().height,
    primary: row.querySelectorAll('[data-table-mobile-layout="primary"]:not([data-table-mobile-visible="false"])').length,
    compact: row.querySelectorAll('[data-table-mobile-layout="compact"]:not([data-table-mobile-visible="false"])').length,
    wide: row.querySelectorAll('[data-table-mobile-layout="wide"]:not([data-table-mobile-visible="false"])').length,
  }));
  assert.deepEqual({ primary: mobileRequestCardGeometry.primary, compact: mobileRequestCardGeometry.compact, wide: mobileRequestCardGeometry.wide }, { primary: 1, compact: 2, wide: 1 }, `Mobile API request cards should use a compact two-column fact rhythm: ${JSON.stringify(mobileRequestCardGeometry)}`);
  assert.ok(mobileRequestCardGeometry.height <= 250, `Mobile API request cards should stay compact, got ${mobileRequestCardGeometry.height}px`);
  await page.screenshot({ path: "test-results/admin-api-log-mobile.png", fullPage: true });
  await firstMobileRequest.click();
  await page.waitForSelector("[data-api-request-table] [data-if-table-detail]");
  assert.match(await page.locator("[data-api-request-table] [data-if-table-detail]").innerText(), /Interface[\s\S]*Tokens[\s\S]*Principal[\s\S]*Trace[\s\S]*Safe diagnostic/i, "Expanded mobile API requests must expose the complete redacted diagnostic record");
  await page.screenshot({ path: "test-results/admin-api-log-detail-mobile.png", fullPage: true });
  await page.goto(`${BASE_URL}#/budget-spend/schedule?scheduleView=list`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-ops-event-table][data-table-layout="cards"]');
  const mobileAugmentAction = page.getByRole("button", { name: /^Research and augment / }).first();
  await mobileAugmentAction.evaluate((button) => button.click());
  await page.waitForSelector("[data-event-ai-launcher]");
  const mobileLauncher = page.locator("[data-event-ai-launcher]");
  await mobileLauncher.getByRole("button", { name: /^AI credential:/ }).waitFor();
  const mobileAiGeometry = await mobileLauncher.evaluate((node) => {
    const rect = node.getBoundingClientRect();
    const direction = node.querySelector("textarea")?.getBoundingClientRect();
    const modelTriggers = [...node.querySelectorAll(".if-picker__trigger")].map((trigger) => trigger.getBoundingClientRect());
    return { left: rect.left, right: rect.right, viewport: innerWidth, directionHeight: direction?.height || 0, modelHeights: modelTriggers.map((trigger) => trigger.height), modelContained: modelTriggers.every((trigger) => trigger.left >= 0 && trigger.right <= innerWidth + 1), documentOverflow: document.documentElement.scrollWidth - innerWidth };
  });
  const mobileAiActionBox = await page.getByRole("button", { name: "Start augmentation" }).boundingBox();
  assert.ok(mobileAiGeometry.left >= 0 && mobileAiGeometry.right <= mobileAiGeometry.viewport + 1, "The event AI launcher must remain within the mobile viewport");
  assert.ok(mobileAiActionBox?.height >= 43.5 && mobileAiGeometry.directionHeight >= 43.5, "Event AI mobile controls must retain 44px touch geometry");
  assert.equal(mobileAiGeometry.modelHeights.length, 3, "The mobile Event AI launcher must expose credential plus both model pickers");
  assert.ok(mobileAiGeometry.modelHeights.every((height) => height >= 43.5) && mobileAiGeometry.modelContained, "Event AI model pickers must retain 44px contained mobile geometry");
  assert.ok(mobileAiGeometry.documentOverflow <= 1, "The event AI launcher must not create document-level mobile overflow");
  await page.screenshot({ path: "test-results/event-ai-launcher-mobile.png", fullPage: true });
  await page.getByRole("button", { name: "Close event augmentation" }).click();
  await page.setViewportSize({ width: 1440, height: 1000 });

  const teammateContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const teammatePage = await teammateContext.newPage();
  await teammatePage.goto(BASE_URL, { waitUntil: "domcontentloaded" });
  await teammatePage.waitForSelector('[data-account-gate="login"]');
  await teammatePage.getByLabel("Email").fill("browser-teammate@example.test");
  await teammatePage.getByLabel("Password").fill("Replacement-User-2026!");
  await teammatePage.getByRole("button", { name: "Sign in" }).click();
  await teammatePage.waitForSelector('[data-account-gate="password-change"]');
  await teammatePage.getByLabel("Temporary password").fill("Replacement-User-2026!");
  await teammatePage.getByLabel("New password", { exact: true }).fill("Teammate-Permanent-2026!");
  await teammatePage.getByLabel("Confirm new password").fill("Teammate-Permanent-2026!");
  await teammatePage.getByRole("button", { name: "Set password and continue" }).click();
  await teammatePage.waitForSelector("[data-defense-budget-app]");
  await teammatePage.locator("[data-profile-menu-trigger]").click();
  assert.ok(await teammatePage.getByText("Analyst", { exact: true }).count() >= 1, "Managed user should enter with the assigned role after replacing the temporary password");
  assert.equal(await teammatePage.locator('[data-profile-menu-surface] a[href="#/budget-spend/users"]').count(), 0, "Analysts must not receive user-management navigation");
  assert.equal(await teammatePage.locator('[data-profile-menu-surface] a[href^="#/budget-spend/connections"]').count(), 0, "Analysts must not receive workspace-connection administration");
  await teammateContext.close();

  await page.goto(`${BASE_URL}#/budget-spend/connections?connectionsView=credentials`, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Agent access", exact: true }).click();
  await page.waitForSelector('[data-operations-hub][data-operations-view="connections"] [data-profile-agents]');
  assert.equal(await page.locator('[role="dialog"]').count(), 0, "Agent access should show its credential list before any creation form");
  assert.equal(await page.locator("[data-admin-workspace]").count(), 0, "Agent access should not repeat a second administration shell");
  assert.equal(await page.locator('[data-profile-agents] > .if-page-header').count(), 1, "Agent access should expose one framework-owned route header");
  assert.equal(await page.locator('[data-profile-agents] .if-analytics-panel--flat').count(), 1, "Agent access should not nest its only credential inventory inside another bordered panel");
  await page.locator('[data-profile-agents] .if-async-state').waitFor({ state: "detached" }).catch(() => {});
  const agentKeyList = page.locator('[data-profile-agents] .if-action-row-list');
  const agentEmptyState = page.locator('[data-profile-agents] [data-if-async-state="empty"]');
  await agentKeyList.or(agentEmptyState).first().waitFor();
  if (await agentKeyList.count()) {
    assert.ok(await agentKeyList.locator('.if-action-row').count() >= 1, "Agent access should render credentials through the shared action-row list");
  } else {
    assert.equal(await agentEmptyState.getByRole("button", { name: "Add credential" }).count(), 1, "Empty Agent access should expose one focused creation action");
  }
  await page.screenshot({ path: "test-results/admin-agent-access-desktop.png", fullPage: true });
  await page.goto(`${BASE_URL}#/budget-spend/connections?connectionsView=activity`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-operations-hub][data-operations-view="connections"] [data-ops-activity]');
  assert.equal(await page.locator("[data-admin-workspace]").count(), 0, "API Log should stay a direct route without a repeated administration shell");
  assert.equal(await page.locator("[data-profile-page]").count(), 0, "API Log should not jump into or out of the account-settings page");
  await page.screenshot({ path: "test-results/admin-api-log-desktop.png", fullPage: true });
  await page.goto(`${BASE_URL}#/budget-spend/connections?connectionsView=credentials`, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Agent access", exact: true }).click();
  await page.waitForSelector('[data-operations-hub][data-operations-view="connections"] [data-profile-agents]');
  const activeAdminTrigger = page.locator('[data-nav-group-trigger="workspace-admin"]');
  assert.equal(await activeAdminTrigger.getAttribute("data-nav-group-active-child"), "Connections", "Authenticated Workspace trigger should name the consolidated active child");
  assert.equal(await activeAdminTrigger.locator(".ci-header-nav__menu-trigger-context").innerText(), "Connections", "Authenticated Workspace should render the consolidated active child in the lighter context label");
  assert.equal(await activeAdminTrigger.locator(".ci-header-nav__menu-trigger-context").evaluate((node) => getComputedStyle(node).color), "rgb(183, 229, 255)", "Authenticated Workspace active child should use the established light-blue treatment");
  assert.equal(await page.locator(".ci-header-nav__desktop-groups > .if-operations-topnav__divider").innerText(), "|", "Authenticated header should retain the platform-admin divider");
  await page.getByRole("button", { name: "Add credential" }).click();
  const agentDialog = page.locator("[data-agent-key-dialog]");
  await agentDialog.getByText("records:read", { exact: true }).waitFor();
  await agentDialog.getByLabel("Name").fill("Browser verifier");
  await agentDialog.getByRole("button", { name: "Create credential" }).click();
  await page.locator(".agent-token-once code").waitFor();
  assert.match(await page.locator(".agent-token-once code").textContent(), /^dbi_agent_/, "Agent credential must be shown exactly once after creation");
  await agentDialog.getByRole("button", { name: "Done" }).click();
  await page.getByRole("button", { name: "Revoke Browser verifier" }).click();
  await page.getByText("Revoked", { exact: true }).waitFor();

  await page.goto(`${BASE_URL}#/budget-spend/explorer?spendView=timeline`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("[data-capture-timeline-row]");
  const visibleRecordId = await page.locator("[data-capture-timeline-row]").first().getAttribute("data-record-id");
  const workspaceSeed = await page.evaluate(async (recordId) => {
    const trackingResponse = await fetch(`/api/v1/agent/tracking/${encodeURIComponent(recordId)}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ note: "Shared browser and agent state", reviewAt: "2026-11-15", wallboard: true }),
    });
    const eventResponse = await fetch("/api/v1/agent/events", {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() },
      body: JSON.stringify({ title: "Shared D1 verification event", startsAt: "2026-11-15T14:00", recordIds: [recordId], wallboard: true }),
    });
    return { recordId, eventId: (await eventResponse.json()).data.id, trackingStatus: trackingResponse.status };
  }, visibleRecordId);
  assert.equal(workspaceSeed.trackingStatus, 201);
  const dispositionContract = await page.evaluate(async (recordId) => {
    const saved = await fetch(`/api/v1/agent/record-dispositions/${encodeURIComponent(recordId)}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ disposition: "tombstoned", reason: "Authenticated D1 disposition contract" }),
    });
    const savedBody = await saved.json();
    const listed = await fetch("/api/v1/agent/record-dispositions");
    const listedBody = await listed.json();
    return { savedStatus: saved.status, savedBody, listedStatus: listed.status, listedBody };
  }, visibleRecordId);
  assert.equal(dispositionContract.savedStatus, 200, "Authenticated D1 users with workspace write access should tombstone a stable explorer record");
  assert.equal(dispositionContract.savedBody.data.recordId, visibleRecordId);
  assert.ok(dispositionContract.listedBody.data.some((row) => row.recordId === visibleRecordId && row.disposition === "tombstoned"), "Authenticated D1 disposition listing should retain the workspace tombstone");
  const dispositionRestoreStatus = await page.evaluate(async (recordId) => (await fetch(`/api/v1/agent/record-dispositions/${encodeURIComponent(recordId)}`, { method: "DELETE" })).status, visibleRecordId);
  assert.equal(dispositionRestoreStatus, 204, "Authenticated D1 users should restore a workspace tombstone");
  await page.goto(`${BASE_URL}#/budget-spend/watchlist`, { waitUntil: "domcontentloaded" });
  await page.locator(`[data-ops-watch-table] [data-row-key="${workspaceSeed.recordId}"]`).waitFor();
  assert.equal(await page.locator(".operations-boundary").count(), 0, "Working routes should not repeat the storage contract as persistent page chrome");
  await page.goto(`${BASE_URL}#/budget-spend/schedule?scheduleView=list`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("[data-ops-events]");
  await page.getByText("Shared D1 verification event").waitFor();
  await page.evaluate(async ({ recordId, eventId }) => {
    await fetch(`/api/v1/agent/events/${encodeURIComponent(eventId)}`, { method: "DELETE" });
    await fetch(`/api/v1/agent/tracking/${encodeURIComponent(recordId)}`, { method: "DELETE" });
  }, workspaceSeed);

  await page.locator("[data-profile-menu-trigger]").click();
  await page.locator("[data-profile-menu-surface]").getByRole("link", { name: /Security/i }).click();
  await page.waitForSelector('[data-profile-page][data-profile-section="security"]');
  assert.equal(await page.locator('[role="dialog"]').count(), 0, "Password management should render as a routed profile page");
  await page.getByLabel("Current password").fill(initialPassword);
  await page.getByLabel("New password", { exact: true }).fill(nextPassword);
  await page.getByLabel("Confirm new password").fill(nextPassword);
  await page.getByRole("button", { name: "Update password" }).click();
  await page.getByText(/Every other active session was signed out/i).waitFor();

  const cookies = await context.cookies();
  const sessionCookie = cookies.find((cookie) => cookie.name === "dbi_session");
  assert.ok(sessionCookie?.httpOnly, "Session cookie must be HttpOnly");
  assert.equal(sessionCookie.sameSite, "Strict", "Session cookie must be SameSite Strict");

  const duplicateClaimStatus = await page.evaluate(async () => {
    const response = await fetch("/api/v1/auth/claim", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "other@example.test", displayName: "Other Owner", title: "", passwordSalt: "0123456789abcdef", passwordProof: "a".repeat(64) }),
    });
    return response.status;
  });
  assert.equal(duplicateClaimStatus, 409, "A second first-account claim must be rejected atomically");

  await page.locator("[data-profile-menu-trigger]").click();
  await page.getByRole("button", { name: "Sign out" }).click();
  await page.waitForSelector('[data-account-gate="login"]');
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(initialPassword);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByText(/email or password is incorrect/i).waitFor();
  await page.getByLabel("Password").fill(nextPassword);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForSelector("[data-defense-budget-app]");

  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector("[data-defense-budget-app]");
  const overflow = await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - window.innerWidth);
  assert.ok(overflow <= 2, `Authenticated mobile shell should not overflow, got ${overflow}px`);
  const authenticatedHeader = await page.locator("[data-budget-spend-header]").evaluate((node) => ({
    height: node.getBoundingClientRect().height,
    condensed: node.classList.contains("if-product-header--mobile-condensed"),
    eyebrow: getComputedStyle(node.querySelector(".if-product-header__eyebrow")).display,
  }));
  assert.equal(authenticatedHeader.condensed, true, "Authenticated mobile navigation should consume the Control Surface condensed header variant");
  assert.ok(authenticatedHeader.height <= 92, `Authenticated mobile masthead should remain within the 92px Control Surface contract, got ${authenticatedHeader.height}px`);
  assert.equal(authenticatedHeader.eyebrow, "none", "Authenticated mobile masthead should suppress only the secondary eyebrow");
  await page.goto(`${BASE_URL}#/budget-spend/users`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-user-management]');
  await page.getByRole("button", { name: "Add account" }).click();
  const mobileUserDialog = page.locator("[data-user-create]");
  await mobileUserDialog.waitFor();
  const mobileUserEditorGeometry = await mobileUserDialog.evaluate((node) => ({
    overflow: Math.max(node.scrollWidth - node.clientWidth, 0),
    inputs: [...node.querySelectorAll("input")].map((input) => ({ visible: getComputedStyle(input).display !== "none", height: input.getBoundingClientRect().height })),
    roleHeight: node.querySelector(".if-picker__trigger")?.getBoundingClientRect().height || 0,
  }));
  assert.equal(mobileUserEditorGeometry.inputs.length, 5, `Mobile Add account should retain all five identity and password fields: ${JSON.stringify(mobileUserEditorGeometry)}`);
  assert.ok(mobileUserEditorGeometry.inputs.every((input) => input.visible && input.height >= 43.5), `Mobile Add account fields must remain visible with 44px controls: ${JSON.stringify(mobileUserEditorGeometry)}`);
  assert.ok(mobileUserEditorGeometry.roleHeight >= 43.5, `Mobile initial workspace role picker must retain a 44px target, got ${mobileUserEditorGeometry.roleHeight}px`);
  assert.ok(mobileUserEditorGeometry.overflow <= 2, `Mobile Add account dialog should not overflow horizontally: ${JSON.stringify(mobileUserEditorGeometry)}`);
  await page.screenshot({ path: "test-results/admin-users-mobile-dialog.png", fullPage: true });
  await mobileUserDialog.getByRole("button", { name: "Close dialog" }).click();
  await mobileUserDialog.waitFor({ state: "detached" });
  const mobileEventId = await page.evaluate(async () => {
    const response = await fetch("/api/v1/agent/events", {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() },
      body: JSON.stringify({ title: "Mobile event card verification", startsAt: "2026-12-10T14:00", notes: "Secondary details stay behind row expansion.", wallboard: false }),
    });
    return (await response.json()).data.id;
  });
  await page.goto(`${BASE_URL}#/budget-spend/schedule?scheduleView=list`, { waitUntil: "domcontentloaded" });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-ops-event-table][data-table-layout="cards"]');
  const mobileEventSearch = page.locator('[data-ops-event-table] input[type="search"]');
  assert.match(await page.locator('[data-ops-event-table]').innerText(), /Not augmented|Validation required|AI amended|Checked/i, "Mobile event cards must retain a readable augmentation status");
  const mobileEventFilterToggle = page.locator('[data-ops-event-table] .dbi-data-table__mobile-filter-toggle');
  assert.ok(await mobileEventFilterToggle.evaluate((button) => button.getBoundingClientRect().height >= 43.5), "Mobile DataTable filters should use a 44px disclosure control");
  assert.equal(await page.locator('[data-ops-event-table] [data-table-filters]:visible').count(), 0, "Mobile DataTable facets should start collapsed");
  await mobileEventFilterToggle.click();
  assert.equal(await page.locator('[data-ops-event-table] [data-table-filters]:visible').count(), 1, "Mobile DataTable facets should remain available on demand");
  await mobileEventFilterToggle.click();
  await mobileEventSearch.fill("no-event-can-match-this-control");
  await page.locator('[data-ops-event-table] [data-if-table-empty]').waitFor();
  assert.match(await page.locator('[data-ops-event-table] [data-if-table-empty]').innerText(), /No matching records[\s\S]*Reset table controls/i, "A filtered-empty table should explain the state and offer one-step recovery");
  assert.equal(await page.locator('[data-ops-event-table] .dbi-data-table__footer').count(), 0, "A filtered-empty table should not render inert pagination");
  await page.locator('[data-ops-event-table]').getByRole("button", { name: "Reset table controls" }).click();
  await page.locator('[data-ops-event-table] [data-if-table-row]').first().waitFor();
  const mobileEventCardGeometry = await page.locator('[data-ops-event-table] [data-if-table-row]').first().evaluate((row) => ({
    visibleCells: [...row.querySelectorAll("td")].filter((cell) => getComputedStyle(cell).display !== "none").length,
    height: row.getBoundingClientRect().height,
  }));
  assert.ok(mobileEventCardGeometry.visibleCells <= 5, `Mobile Events should expose only the scan-and-act fields, got ${mobileEventCardGeometry.visibleCells} visible cells`);
  assert.ok(mobileEventCardGeometry.height <= 260, `Mobile Events cards should stay compact before detail expansion, got ${mobileEventCardGeometry.height}px`);
  await page.screenshot({ path: "test-results/events-table-mobile.png", fullPage: true });
  await page.evaluate(async (eventId) => { await fetch(`/api/v1/agent/events/${encodeURIComponent(eventId)}`, { method: "DELETE" }); }, mobileEventId);
  await page.locator("[data-mobile-more-menu-button]").click();
  assert.equal(await page.locator("[data-mobile-more-menu] a[data-budget-nav]").count(), 13, "Authenticated mobile navigation should expose the reduced primary, work, and administration route set in one menu");
  assert.match(await page.locator("[data-mobile-more-menu]").textContent(), /Primary Surfaces[\s\S]*Spend Explorer[\s\S]*Schedule[\s\S]*Money Flow[\s\S]*Work[\s\S]*Task Center[\s\S]*Workspace Admin[\s\S]*Connections[\s\S]*Platform Admin[\s\S]*Accounts[\s\S]*Workspaces/);
  await page.locator("[data-mobile-more-menu-button]").click();
  const trigger = page.locator("[data-profile-menu-trigger]");
  const box = await trigger.boundingBox();
  assert.ok(box && box.width >= 42 && box.height >= 42, "Mobile profile trigger must meet the 42px touch target");
  await trigger.click();
  const mobileSurface = page.getByRole("dialog", { name: "Profile controls" });
  const mobileSurfaceBox = await mobileSurface.boundingBox();
  assert.ok(mobileSurfaceBox && mobileSurfaceBox.x <= 13 && Math.abs((mobileSurfaceBox.x + mobileSurfaceBox.width) - 378) <= 2, "Mobile profile dropdown should use the same fixed 12px-gutter account sheet as Opportunity Intelligence");
  await mobileSurface.locator(workspaceTriggerSelector).click();
  const mobileWorkspaceMenu = page.locator("[data-if-picker-menu]");
  await mobileWorkspaceMenu.waitFor({ state: "visible" });
  const mobileWorkspaceMenuGeometry = await mobileWorkspaceMenu.evaluate((node) => {
    const bounds = node.getBoundingClientRect();
    return {
      left: bounds.left,
      right: bounds.right,
      top: bounds.top,
      bottom: bounds.bottom,
      searchHeight: node.querySelector('input[type="search"]').getBoundingClientRect().height,
      optionHeights: [...node.querySelectorAll('[role="option"]')].map((option) => option.getBoundingClientRect().height),
    };
  });
  assert.ok(mobileWorkspaceMenuGeometry.left >= 11 && mobileWorkspaceMenuGeometry.right <= 379 && mobileWorkspaceMenuGeometry.top >= 11 && mobileWorkspaceMenuGeometry.bottom <= 833, `Mobile workspace picker should remain inside the viewport: ${JSON.stringify(mobileWorkspaceMenuGeometry)}`);
  assert.ok(mobileWorkspaceMenuGeometry.searchHeight >= 43.5, `Mobile workspace search must keep a 44px target, got ${mobileWorkspaceMenuGeometry.searchHeight}px`);
  assert.ok(mobileWorkspaceMenuGeometry.optionHeights.every((height) => height >= 43.5), `Mobile workspace options must keep 44px targets: ${mobileWorkspaceMenuGeometry.optionHeights.join(", ")}`);
  await page.screenshot({ path: "test-results/profile-workspace-switcher-mobile.png" });
  await mobileWorkspaceMenu.getByLabel("Search workspaces").press("Escape");
  assert.equal(await page.locator("[data-if-picker-menu]").count(), 0, "Escape should close only the workspace picker");
  assert.equal(await mobileSurface.count(), 1, "Closing the workspace picker should preserve the parent profile surface");
  await page.screenshot({ path: "test-results/profile-menu-mobile.png" });
  await page.getByRole("link", { name: /Open Profile/i }).click();
  await page.waitForSelector('[data-profile-page][data-profile-section="profile"]');
  const profileOverflow = await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - window.innerWidth);
  assert.ok(profileOverflow <= 2, `Mobile profile page should not overflow, got ${profileOverflow}px`);
  const profileNavHeights = await page.locator(".profile-page__nav a").evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().height));
  assert.ok(profileNavHeights.every((height) => height >= 43.5), `Mobile profile navigation should keep 44px touch targets: ${profileNavHeights.join(", ")}`);
  const mobileProfileGeometry = await page.locator("[data-profile-page]").evaluate((node) => {
    const panel = node.querySelector(".profile-page__panel");
    const inputs = [...node.querySelectorAll(".profile-page__panel .if-input")];
    const buttons = [...node.querySelectorAll(".profile-page__panel .if-btn")];
    return {
      panelHeight: panel.getBoundingClientRect().height,
      panelRadius: parseFloat(getComputedStyle(panel).borderRadius),
      routeHeaderActions: node.querySelectorAll(":scope > .if-page-header > .if-page-header__actions").length,
      inputHeights: inputs.map((input) => input.getBoundingClientRect().height),
      buttonHeights: buttons.map((button) => button.getBoundingClientRect().height),
    };
  });
  assert.ok(mobileProfileGeometry.panelHeight <= 620, `Mobile Profile picture and identity controls should fit within one screen, got ${mobileProfileGeometry.panelHeight}px`);
  assert.ok(mobileProfileGeometry.panelRadius <= 4, `Mobile Profile should retain the framework radius, got ${mobileProfileGeometry.panelRadius}px`);
  assert.equal(mobileProfileGeometry.routeHeaderActions, 0, "Mobile Profile should avoid duplicating account identity inside the route header");
  assert.ok(mobileProfileGeometry.inputHeights.every((height) => height >= 43.5), `Mobile Profile inputs must retain 44px touch geometry: ${mobileProfileGeometry.inputHeights.join(", ")}`);
  assert.ok(mobileProfileGeometry.buttonHeights.every((height) => height >= 43.5), `Mobile Profile actions must retain 44px touch geometry: ${mobileProfileGeometry.buttonHeights.join(", ")}`);
  await page.screenshot({ path: "test-results/profile-page-mobile.png", fullPage: true });

  await page.goto(`${BASE_URL}#/profile/security`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-profile-page][data-profile-section="security"]');
  const mobileSecurityGeometry = await page.locator("[data-profile-security]").evaluate((node) => ({
    width: node.getBoundingClientRect().width,
    inputHeights: [...node.querySelectorAll(".if-input")].map((input) => input.getBoundingClientRect().height),
    buttonHeights: [...node.querySelectorAll(".if-btn")].map((button) => button.getBoundingClientRect().height),
  }));
  assert.ok(mobileSecurityGeometry.width <= 360, `Mobile Security should stay inside the shared page gutter, got ${mobileSecurityGeometry.width}px`);
  assert.ok(mobileSecurityGeometry.inputHeights.every((height) => height >= 43.5), `Mobile Security inputs must retain 44px touch geometry: ${mobileSecurityGeometry.inputHeights.join(", ")}`);
  assert.ok(mobileSecurityGeometry.buttonHeights.every((height) => height >= 43.5), `Mobile Security action must retain 44px touch geometry: ${mobileSecurityGeometry.buttonHeights.join(", ")}`);
  await page.screenshot({ path: "test-results/profile-security-mobile.png", fullPage: true });

  await page.goto(`${BASE_URL}#/profile/openai`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-openai-key-vault="user"]');
  const mobileVaultOverflow = await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - window.innerWidth);
  assert.ok(mobileVaultOverflow <= 2, `Mobile credential vault should not overflow, got ${mobileVaultOverflow}px`);
  const mobileVaultButtons = await page.locator('[data-openai-key-vault="user"] .if-btn').evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().height));
  assert.ok(mobileVaultButtons.every((height) => height >= 43.5), `Mobile credential controls must retain 44px targets: ${mobileVaultButtons.join(", ")}`);
  await page.locator('[data-openai-key-vault="user"]').getByRole("button", { name: "Add key" }).click();
  const mobileKeyDialog = page.locator('[data-openai-key-dialog="user"]');
  await mobileKeyDialog.waitFor();
  const mobileKeyBounds = await mobileKeyDialog.boundingBox();
  assert.ok(mobileKeyBounds && mobileKeyBounds.x >= 0 && mobileKeyBounds.y >= 0 && mobileKeyBounds.x + mobileKeyBounds.width <= 390 && mobileKeyBounds.y + mobileKeyBounds.height <= 844, `Mobile key dialog must stay inside the viewport: ${JSON.stringify(mobileKeyBounds)}`);
  const mobileKeyFields = await mobileKeyDialog.locator(".if-input").evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().height));
  assert.ok(mobileKeyFields.every((height) => height >= 43.5), `Mobile key fields must retain 44px controls: ${mobileKeyFields.join(", ")}`);
  await page.screenshot({ path: "test-results/openai-key-vault-mobile.png", fullPage: true });
  await mobileKeyDialog.getByRole("button", { name: "Close OpenAI key form" }).click();

  await page.goto(`${BASE_URL}#/budget-spend/connections?connectionsView=credentials`, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "SAM.gov", exact: true }).click();
  const mobileSamVault = page.locator("[data-sam-gov-key-management]");
  await mobileSamVault.waitFor();
  const mobileSamOverflow = await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - window.innerWidth);
  assert.ok(mobileSamOverflow <= 2, `Mobile SAM.gov credential vault should not overflow, got ${mobileSamOverflow}px`);
  const mobileSamButtons = await mobileSamVault.locator(".if-btn, .if-icon-btn").evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().height));
  assert.ok(mobileSamButtons.every((height) => height >= 43.5), `Mobile SAM.gov credential controls must retain 44px targets: ${mobileSamButtons.join(", ")}`);
  await mobileSamVault.getByRole("button", { name: /Add key|Replace key/ }).click();
  const mobileSamDialog = page.locator("[data-sam-gov-key-dialog]");
  await mobileSamDialog.waitFor();
  const mobileSamBounds = await mobileSamDialog.boundingBox();
  assert.ok(mobileSamBounds && mobileSamBounds.x >= 0 && mobileSamBounds.y >= 0 && mobileSamBounds.x + mobileSamBounds.width <= 390 && mobileSamBounds.y + mobileSamBounds.height <= 844, `Mobile SAM.gov key dialog must stay inside the viewport: ${JSON.stringify(mobileSamBounds)}`);
  await mobileSamDialog.getByRole("button", { name: "Close SAM.gov key form" }).click();

  const interactionSurfaces = [
    ["#/budget-spend/explorer?spendView=today", '[data-spend-explorer="today"]', "Acquisition Today"],
    ["#/budget-spend/schedule?scheduleView=list", "[data-schedule-surface]", "Schedule list"],
    ["#/budget-spend/schedule?scheduleView=calendar", "[data-wallboard-calendar]", "Schedule calendar"],
    ["#/budget-spend/explorer?spendView=timeline", "[data-capture-calendar-page]", "Spend timeline"],
    ["#/budget-spend/explorer?spendView=charts", "[data-transaction-d3-page]", "Spend charts"],
    ["#/budget-spend/awards", "[data-awards-page]", "Awards"],
    ["#/budget-spend/tasks", "[data-task-center]", "Task Center"],
    ["#/budget-spend/connections?connectionsView=integrations", "[data-connections-surface]", "Connections integrations"],
    ["#/budget-spend/connections?connectionsView=credentials", "[data-connections-surface]", "Connections credentials"],
    ["#/budget-spend/connections?connectionsView=activity", "[data-connections-surface]", "Connections activity"],
    ["#/budget-spend/workspace", "[data-workspace-management]", "Workspace settings"],
    ["#/budget-spend/users", "[data-user-management]", "Accounts"],
    ["#/budget-spend/workspaces", "[data-workspace-management]", "Workspaces"],
    ["#/profile", "[data-profile-page]", "Profile"],
  ];
  for (const [width, height, narrow] of [[1440, 1000, false], [390, 844, true]]) {
    await page.setViewportSize({ width, height });
    for (const [route, selector, label] of interactionSurfaces) {
      await page.goto(`${BASE_URL}${route}`, { waitUntil: "domcontentloaded" });
      await page.waitForSelector(selector);
      await assertInteractionSurface(page, selector, `${narrow ? "Mobile" : "Desktop"} ${label}`, narrow);
    }
  }

  console.log("Verified first-account Super user, routed Profile/Security/Users/Workspaces/Agent Access, profile picture controls, OpenAI credential vault and API request log, human account lifecycle, mandatory temporary-password replacement, role-gated navigation, agent credentials, shared D1 state, password rotation, logout/login, and mobile UI");
} finally {
  await browser.close();
}
