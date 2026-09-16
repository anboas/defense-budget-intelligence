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
  await loadingGate.waitFor();
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
  assert.equal(await page.locator('[data-budget-nav-menu="workspace-admin"] a[data-budget-nav]').count(), 4, "Workspace administration should contain only workspace-scoped controls");
  assert.match(await page.locator('[data-budget-nav-menu="workspace-admin"]').innerText(), /Integrations[\s\S]*API Log[\s\S]*Workspace Settings[\s\S]*Agent Access/i);
  assert.equal(await page.locator('[data-budget-nav-menu="workspace-admin"] a[href="#/profile"]').count(), 0, "Profile should remain owned by the account control rather than duplicated in Workspace administration");
  await page.locator('[data-nav-group-trigger="workspace-admin"]').click();
  await page.locator('[data-nav-group-trigger="platform-admin"]').click();
  assert.equal(await page.locator('[data-budget-nav-menu="platform-admin"] a[data-budget-nav]').count(), 2, "Platform administration should contain Users and Workspaces only");
  assert.match(await page.locator('[data-budget-nav-menu="platform-admin"]').innerText(), /Users[\s\S]*Workspaces/i);
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
  assert.equal(await page.locator(".profile-photo-manager").count(), 1, "Profile should expose picture selection, replacement, and removal controls");
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
  assert.ok(desktopProfileGeometry.pageHeaderHeight <= 84, `Profile header should stay operationally compact while retaining its route summary, got ${desktopProfileGeometry.pageHeaderHeight}px`);
  assert.ok(desktopProfileGeometry.headingSize <= 20, `Profile route heading should use framework scale, got ${desktopProfileGeometry.headingSize}px`);
  assert.ok(desktopProfileGeometry.panelRadius <= 4, `Profile panel should use the framework's restrained radius, got ${desktopProfileGeometry.panelRadius}px`);
  assert.equal(desktopProfileGeometry.panelShadow, "none", "Profile panel should remain flat rather than float like a marketing card");
  assert.ok(desktopProfileGeometry.panelTitleSize <= 15, `Profile panel title should remain compact, got ${desktopProfileGeometry.panelTitleSize}px`);
  assert.ok(desktopProfileGeometry.inputHeight >= 29.5 && desktopProfileGeometry.inputHeight <= 34.5, `Desktop profile inputs should use compact framework controls, got ${desktopProfileGeometry.inputHeight}px`);
  assert.ok(desktopProfileGeometry.contentWidth <= 761, `Profile form should preserve a readable utility width, got ${desktopProfileGeometry.contentWidth}px`);
  assert.ok(desktopProfileGeometry.panelBottom <= 620, `Profile picture and identity controls should fit high in a 1000px viewport, ending at ${desktopProfileGeometry.panelBottom}px`);
  await page.screenshot({ path: "test-results/profile-page-desktop.png", fullPage: true });
  await page.locator("#profile-avatar-file").setInputFiles("public/icon-192.png");
  await page.locator(".profile-photo-manager .user-avatar img").waitFor();
  await page.getByLabel("Display name").fill(finalName);
  await page.getByRole("button", { name: "Save profile" }).click();
  await page.getByText("Profile saved.").waitFor();
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.locator(".profile-photo-manager .user-avatar img").waitFor();
  await page.locator("[data-profile-menu-trigger] .user-avatar img").waitFor();
  await page.goto(`${BASE_URL}#/profile/openai`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-openai-key-vault="user"]');
  const personalVault = page.locator('[data-openai-key-vault="user"]');
  await personalVault.getByText("Loading key metadata…").waitFor({ state: "detached" });
  assert.match(await personalVault.innerText(), /My OpenAI keys[\s\S]*write-only encrypted vault[\s\S]*Configured credentials/i, "Personal settings should expose the structured write-only OpenAI credential manager");
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

  await page.goto(`${BASE_URL}#/budget-spend/api-log`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("[data-api-request-summary]");
  assert.equal(await page.locator("[data-api-request-summary] .if-management-card").count(), 4, "API Log must summarize request volume, success, latency, and tokens");
  await page.waitForSelector("[data-api-request-table]");
  assert.equal(await page.locator("[data-api-observability-charts] .if-chart-card").count(), 2, "API Log must visualize outcome mix and average latency with shared chart cards");
  assert.match(await page.locator("[data-ops-activity]").innerText(), /90-day retention[\s\S]*API requests[\s\S]*Workspace changes/i, "API Log must expose distinct request and workspace-change ledgers");
  assert.equal(await page.locator('[data-ops-activity] > .if-tabs__list .if-tab').count(), 2, "API Log must switch between ledgers instead of stacking both tables");

  await page.goto(`${BASE_URL}#/budget-spend/users`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-operations-hub][data-operations-view="users"] [data-user-management]');
  assert.equal(await page.locator('[data-admin-workspace]').count(), 0, "Users should not repeat a second administration shell below global navigation");
  assert.equal(await page.locator('[data-user-management] > .if-page-header').count(), 1, "Users should expose one framework-owned route header");
  await page.getByRole("button", { name: "Add user" }).click();
  const addUser = page.locator("[data-user-create]");
  await addUser.getByLabel("Display name").fill("Browser teammate");
  await addUser.getByLabel("Email").fill("browser-teammate@example.test");
  await addUser.getByLabel(/Title/).fill("Read-only reviewer");
  await chooseControlSelect(page, "New user role", "Viewer");
  await addUser.getByLabel("Temporary password", { exact: true }).fill("Temporary-User-2026!");
  await addUser.getByLabel("Confirm temporary password").fill("Temporary-User-2026!");
  await addUser.getByRole("button", { name: "Create user" }).click();
  const teammate = page.locator("[data-user-row]", { hasText: "browser-teammate@example.test" });
  await teammate.waitFor();
  await page.getByText(/User created\. Share the temporary password/).waitFor();
  assert.match(await teammate.innerText(), /Viewer[\s\S]*Active/);
  await teammate.getByRole("button", { name: "Edit" }).click();
  const editUser = page.locator("[data-user-edit]");
  await chooseControlSelect(page, "User role", "Analyst");
  await editUser.getByRole("button", { name: "Save user" }).click();
  await page.getByText("User updated.", { exact: true }).waitFor();
  assert.match(await teammate.innerText(), /Analyst/);
  await teammate.getByRole("button", { name: "Reset" }).click();
  const resetUser = page.locator("[data-user-password-reset]");
  await resetUser.getByLabel("Temporary password", { exact: true }).fill("Replacement-User-2026!");
  await resetUser.getByLabel("Confirm temporary password").fill("Replacement-User-2026!");
  await resetUser.getByRole("button", { name: "Reset password" }).click();
  await page.getByText(/Temporary password set\. Existing sessions were revoked/).waitFor();
  await teammate.getByRole("button", { name: "Suspend" }).click();
  await page.getByText(/Browser teammate suspended/).waitFor();
  await teammate.getByRole("button", { name: "Reactivate" }).click();
  await page.getByText("Browser teammate reactivated.", { exact: true }).waitFor();
  await page.screenshot({ path: "test-results/admin-users-desktop.png", fullPage: true });

  await page.goto(`${BASE_URL}#/budget-spend/workspaces`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("[data-workspace-management]");
  assert.equal(await page.locator('[data-nav-group-trigger="platform-admin"]').getAttribute("data-nav-group-active-child"), "Workspaces", "Workspace governance should activate the dedicated Platform admin dropdown");
  assert.equal(await page.locator('[data-workspace-management] > .if-page-header').count(), 1, "Workspace governance should expose one framework-owned route header");
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
  await chooseControlSelect(page, "User to add to Browser verification", "Browser teammate");
  await chooseControlSelect(page, "Role for new member in Browser verification", "Viewer");
  await createdWorkspace.getByRole("button", { name: "Add member" }).click();
  await createdWorkspace.getByText("Browser teammate", { exact: true }).waitFor();
  assert.match(await createdWorkspace.getByRole("button", { name: /^Role for Browser teammate.*:/ }).getAttribute("aria-label"), /Viewer/, "Super user should see the member's current workspace role");
  await chooseControlSelect(page, "Role for Browser teammate in Browser verification", "Analyst");
  await page.getByText(/Browser teammate is now Analyst/).waitFor();
  assert.equal(await createdWorkspace.locator('[aria-label="Browser verification contents"] article').count(), 6, "Each workspace should present its isolated content inventory");
  await createdWorkspace.getByRole("button", { name: "Configure" }).click();
  const workspaceEditor = page.locator("[data-workspace-editor]");
  await workspaceEditor.getByLabel("Workspace name").fill("Browser command");
  await workspaceEditor.getByLabel("Description").fill("Renamed browser-tested workspace");
  await workspaceEditor.getByLabel("Header eyebrow").fill("Sabre workspace intelligence");
  await workspaceEditor.getByLabel("Display title").fill("Sabre BD");
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
  assert.match(await renamedWorkspace.innerText(), /What lives here[\s\S]*Tracked[\s\S]*Events[\s\S]*Milestones[\s\S]*Manual records[\s\S]*Audit entries[\s\S]*Agent keys/);
  await renamedWorkspace.getByRole("button", { name: /Remove Browser teammate/ }).click();
  await page.getByText(/removed from Browser command/).waitFor();
  const addMemberButton = renamedWorkspace.getByRole("button", { name: "Add member" });
  await addMemberButton.waitFor();
  await page.waitForFunction((button) => !button.disabled, await addMemberButton.elementHandle());
  await page.screenshot({ path: "test-results/admin-workspaces-desktop.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  const mobileWorkspaceGeometry = await workspaceAdmin.evaluate((node) => {
    const inventory = node.querySelector(".workspace-card__contents > div");
  const controls = [...node.querySelectorAll("button, input")];
    return {
      documentOverflow: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - innerWidth,
      inventoryOverflow: getComputedStyle(inventory).overflowX,
      inventoryItems: inventory.children.length,
      controlHeights: controls.map((control) => control.getBoundingClientRect().height),
    };
  });
  assert.ok(mobileWorkspaceGeometry.documentOverflow <= 2, `Mobile workspace command should not overflow the document, got ${mobileWorkspaceGeometry.documentOverflow}px`);
  assert.equal(mobileWorkspaceGeometry.inventoryOverflow, "auto", "Mobile workspace inventory should use a contained horizontal rail");
  assert.equal(mobileWorkspaceGeometry.inventoryItems, 6, "Mobile workspace inventory should preserve all six content categories");
  assert.ok(mobileWorkspaceGeometry.controlHeights.every((height) => height >= 43.5), `Mobile workspace controls must retain 44px targets: ${mobileWorkspaceGeometry.controlHeights.join(", ")}`);
  const addMemberPresentation = await addMemberButton.evaluate((button) => ({ text: button.innerText.trim(), color: getComputedStyle(button).color, opacity: getComputedStyle(button).opacity }));
  assert.equal(addMemberPresentation.text, "Add member", "Mobile workspace add control must retain its visible label");
  assert.equal(addMemberPresentation.color, "rgb(255, 255, 255)", "Mobile workspace add control must retain readable text contrast");
  assert.equal(addMemberPresentation.opacity, "1", "Mobile workspace add control must remain fully visible when ready");
  await page.screenshot({ path: "test-results/admin-workspaces-mobile.png", fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });

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

  const signupContext = await browser.newContext({ viewport: { width: 1080, height: 900 } });
  const signupPage = await signupContext.newPage();
  await signupPage.goto(BASE_URL, { waitUntil: "domcontentloaded" });
  await signupPage.waitForSelector('[data-account-gate="login"]');
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

  await page.goto(`${BASE_URL}#/budget-spend/events`, { waitUntil: "domcontentloaded" });
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
  assert.equal(await page.locator('[data-control-area]').count(), 0, "Events must render as a primary surface without a management shell");
  assert.equal(await page.locator('[data-primary-nav="events"][aria-current="page"]').count(), 1, "Events must own a direct primary-navigation position");
  assert.equal(await page.locator('[data-ops-events] > [data-event-ai-launcher]').count(), 0, "Events must not place the augmentation launcher above the data table");
  await page.getByRole("button", { name: /^Research and augment / }).first().click();
  await page.waitForSelector("[data-event-ai-launcher-dialog]");
  await page.waitForSelector("[data-event-ai-launcher]");
  const aiLauncher = page.locator("[data-event-ai-launcher]");
  assert.match(await aiLauncher.innerText(), /What happens after launch[\s\S]*Research[\s\S]*Verify[\s\S]*Review/i, "Events must explain the detached research, verification, and notification review lifecycle");
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
  assert.equal(await page.locator(".if-toast-stack--masthead .if-toast--info").count(), 1, "Starting background work must produce a visible masthead toast");
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
  assert.equal(await page.locator('[data-task-center] > .if-page-header').count(), 1, "Task Center should expose one framework-owned route header");
  await page.waitForSelector('[data-event-ai-review="completed"], [data-event-ai-review="needs_review"]');
  const aiReview = page.locator('[data-event-ai-review="completed"], [data-event-ai-review="needs_review"]');
  assert.match(await aiReview.innerText(), /(Verified draft ready|Operator validation required)[\s\S]*Research: gpt-5\.4-mini · Verification: gpt-5\.4[\s\S]*Before \/ verified draft[\s\S]*Verified draft changes[\s\S]*Evidence & exclusions/i, "The dedicated review workspace must disclose stages, selected models, a diff preview, changes, and evidence");
  assert.equal(await aiReview.locator("[data-event-ai-diff-preview] .if-detail-card").count(), 2, "AI review must render side-by-side before and verified-draft diff panes");
  assert.equal(await page.locator('[data-task-center] > .if-management-grid[aria-label="Task summary"]').count(), 0, "Selected task detail must replace the summary boxes instead of stacking beneath them");
  assert.equal(await page.locator("[data-task-table]").count(), 0, "Selected task detail must replace the retained task table instead of stacking above it");
  assert.match(await aiReview.locator(".if-stepper").getAttribute("class"), /if-stepper--compact/, "Task progress must use the compact shared stepper");
  assert.doesNotMatch(await aiReview.innerText(), /sk-browser|authorization|request body|response body/i, "AI review must never expose secrets or raw provider payloads");
  await page.screenshot({ path: "test-results/task-center-desktop.png", fullPage: true });
  await aiReview.getByRole("button", { name: "Open verified draft" }).click();
  await page.waitForSelector("[data-ops-event-editor]");
  const eventEditor = page.locator("[data-ops-event-editor]");
  const reviewDialogBounds = await page.locator('dialog:has([data-ops-event-editor])').boundingBox();
  assert.ok(reviewDialogBounds?.width >= 900, `AI-assisted event review must use the expanded detail-dialog width, got ${reviewDialogBounds?.width}px`);
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
  await page.getByRole("button", { name: "Add link" }).click();
  await page.getByLabel("Event link 1 label").fill("Official page");
  await page.getByLabel("Event link 1 URL").fill("https://example.test/customer-forum");
  await page.getByRole("button", { name: "Add deadline or milestone" }).click();
  await chooseControlSelect(page, "Milestone 1 type", "Refund deadline");
  await page.getByLabel("Milestone 1 date").fill("2026-10-01");
  await page.getByLabel("Milestone 1 label").fill("Last day for refunds");
  assert.equal(await page.locator("[data-event-milestones] > .if-card").count(), 1, "Event editor should support typed, optional deadline overlays through Control Surface cards");
  const milestoneAction = page.getByRole("button", { name: "Add deadline or milestone" });
  assert.match(await milestoneAction.getAttribute("class"), /if-btn--secondary/, "The milestone action must use the shared secondary button contract");
  const milestoneActionBox = await milestoneAction.boundingBox();
  assert.ok(milestoneActionBox?.height >= 34 && milestoneActionBox?.width > 150, "The milestone action must retain a complete readable control shape");
  await page.screenshot({ path: "test-results/event-ai-review-desktop.png" });
  await page.getByRole("button", { name: "Close event editor" }).click();
  await page.goto(`${BASE_URL}#/budget-spend/api-log`, { waitUntil: "domcontentloaded" });
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
  await page.goto(`${BASE_URL}#/budget-spend/api-log`, { waitUntil: "domcontentloaded" });
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
  await page.screenshot({ path: "test-results/admin-api-log-mobile.png", fullPage: true });
  await page.goto(`${BASE_URL}#/budget-spend/events`, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: /^Research and augment / }).first().click();
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
  assert.equal(await teammatePage.locator('[data-profile-menu-surface] a[href="#/budget-spend/agents"]').count(), 0, "Analysts must not receive agent-credential navigation");
  await teammateContext.close();

  await page.goto(`${BASE_URL}#/budget-spend/agents`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-operations-hub][data-operations-view="agents"] [data-profile-agents]');
  assert.equal(await page.locator('[role="dialog"]').count(), 0, "Agent access should show its credential list before any creation form");
  assert.equal(await page.locator("[data-admin-workspace]").count(), 0, "Agent access should not repeat a second administration shell");
  assert.equal(await page.locator('[data-profile-agents] > .if-page-header').count(), 1, "Agent access should expose one framework-owned route header");
  await page.screenshot({ path: "test-results/admin-agent-access-desktop.png", fullPage: true });
  await page.goto(`${BASE_URL}#/budget-spend/api-log`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-operations-hub][data-operations-view="activity"] [data-ops-activity]');
  assert.equal(await page.locator("[data-admin-workspace]").count(), 0, "API Log should stay a direct route without a repeated administration shell");
  assert.equal(await page.locator("[data-profile-page]").count(), 0, "API Log should not jump into or out of the account-settings page");
  await page.screenshot({ path: "test-results/admin-api-log-desktop.png", fullPage: true });
  await page.goto(`${BASE_URL}#/budget-spend/agents`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-operations-hub][data-operations-view="agents"] [data-profile-agents]');
  const activeAdminTrigger = page.locator('[data-nav-group-trigger="workspace-admin"]');
  assert.equal(await activeAdminTrigger.getAttribute("data-nav-group-active-child"), "Agent Access", "Authenticated Workspace trigger should name the active routed child");
  assert.equal(await activeAdminTrigger.locator(".ci-header-nav__menu-trigger-context").innerText(), "Agent Access", "Authenticated Workspace should render the active child in the lighter context label");
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

  await page.goto(`${BASE_URL}#/budget-spend/transactions`, { waitUntil: "domcontentloaded" });
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
  await page.goto(`${BASE_URL}#/budget-spend/watchlist`, { waitUntil: "domcontentloaded" });
  await page.locator(`[data-ops-watch-table] [data-row-key="${workspaceSeed.recordId}"]`).waitFor();
  assert.equal(await page.locator(".operations-boundary").count(), 0, "Working routes should not repeat the storage contract as persistent page chrome");
  await page.goto(`${BASE_URL}#/budget-spend/events`, { waitUntil: "domcontentloaded" });
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
  await page.getByText(/Other sessions were signed out/).waitFor();

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
  await page.locator("[data-mobile-more-menu-button]").click();
  assert.equal(await page.locator("[data-mobile-more-menu] a[data-budget-nav]").count(), 17, "Authenticated mobile More should retain grouped routes without duplicating primary Events");
  assert.match(await page.locator("[data-mobile-more-menu]").innerText(), /Analytics[\s\S]*Money flow[\s\S]*Work[\s\S]*Task Center[\s\S]*Workspace admin[\s\S]*Agent Access[\s\S]*Platform admin[\s\S]*Users[\s\S]*Workspaces/i);
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

  console.log("Verified first-account Super user, routed Profile/Security/Users/Workspaces/Agent Access, profile picture controls, OpenAI credential vault and API request log, human account lifecycle, mandatory temporary-password replacement, role-gated navigation, agent credentials, shared D1 state, password rotation, logout/login, and mobile UI");
} finally {
  await browser.close();
}
