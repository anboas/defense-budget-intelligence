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
  await page.locator('[data-nav-group-trigger="admin"]').click();
  assert.equal(await page.locator('[data-budget-nav-menu="admin"] a[data-budget-nav]').count(), 7, "The Super user should receive workspace, user, and agent administration routes");
  assert.match(await page.locator('[data-budget-nav-menu="admin"]').innerText(), /Watchlist[\s\S]*Events[\s\S]*Integrations[\s\S]*API Log[\s\S]*Users[\s\S]*Workspaces[\s\S]*Agent Access/i);
  assert.equal(await page.locator('[data-budget-nav-menu="admin"] a[href="#/profile"]').count(), 0, "Profile should remain owned by the account control rather than duplicated in Admin");
  await page.locator('[data-nav-group-trigger="admin"]').click();
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
  assert.equal(await profileSurface.locator(".if-account-surface__body .if-account-action").count(), 6, "Profile dropdown should expose workspace, user, and agent administration actions");
  assert.equal(await profileSurface.locator(".if-account-action__icon svg").count(), 6, "Every shared account-action row should render its icon glyph");
  assert.equal(await profileSurface.locator(".if-account-surface__footer").count(), 1, "Profile dropdown should use the shared account-surface footer");
  assert.ok(await page.getByText("Super user", { exact: true }).count() >= 1, "Profile menu should identify the first account as super user");
  await page.screenshot({ path: "test-results/profile-menu-desktop.png" });
  await page.getByRole("link", { name: /Open Profile/i }).click();
  await page.waitForSelector('[data-profile-page][data-profile-section="profile"]');
  assert.equal(await page.locator('[role="dialog"]').count(), 0, "Profile should render as a routed page, not a modal");
  assert.match(new URL(page.url()).hash, /^#\/profile$/, "Profile menu should navigate to the canonical profile route");
  assert.equal(await page.locator(".profile-page__nav a").count(), 2, "Profile workspace should contain only identity and security");
  assert.equal(await page.locator('.profile-page__nav a:has-text("Agent access"), .profile-page__nav a:has-text("API log")').count(), 0, "Agent and API administration must not be mixed into the account settings rail");
  assert.equal(await page.locator('[data-profile-account] input:disabled').count(), 0, "Immutable account metadata should use compact key/value rows instead of oversized disabled inputs");
  assert.equal(await page.locator('[data-profile-account-meta] .if-kv').count(), 2, "Profile should expose email and role through the framework metadata primitive");
  assert.equal(await page.locator(".profile-photo-manager").count(), 1, "Profile should expose picture selection, replacement, and removal controls");
  const desktopProfileGeometry = await page.locator("[data-profile-page]").evaluate((node) => {
    const panel = node.querySelector(".profile-page__panel");
    const pageHeader = node.querySelector(".profile-page__header");
    const heading = node.querySelector(".profile-page__heading h2");
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
  assert.ok(desktopProfileGeometry.pageHeaderHeight <= 64, `Profile header should stay operationally compact, got ${desktopProfileGeometry.pageHeaderHeight}px`);
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

  await page.locator("[data-profile-menu-trigger]").click();
  await page.locator("[data-profile-menu-surface]").getByRole("link", { name: /^Users/i }).click();
  await page.waitForSelector('[data-operations-hub][data-operations-view="users"] [data-user-management]');
  assert.equal(await page.locator('[data-admin-workspace]').count(), 1, "Users should render inside the persistent Admin workspace");
  assert.equal(await page.locator('.admin-console__nav a[aria-current="page"]').innerText(), "Users", "Admin workspace should retain Users as its active section");
  await page.getByRole("button", { name: "Add user" }).click();
  const addUser = page.locator("[data-user-create]");
  await addUser.getByLabel("Display name").fill("Browser teammate");
  await addUser.getByLabel("Email").fill("browser-teammate@example.test");
  await addUser.getByLabel(/Title/).fill("Read-only reviewer");
  await addUser.getByLabel("Role").selectOption("viewer");
  await addUser.getByLabel("Temporary password", { exact: true }).fill("Temporary-User-2026!");
  await addUser.getByLabel("Confirm temporary password").fill("Temporary-User-2026!");
  await addUser.getByRole("button", { name: "Create user" }).click();
  const teammate = page.locator("[data-user-row]", { hasText: "browser-teammate@example.test" });
  await teammate.waitFor();
  await page.getByText(/User created\. Share the temporary password/).waitFor();
  assert.match(await teammate.innerText(), /Viewer[\s\S]*Active/);
  await teammate.getByRole("button", { name: "Edit" }).click();
  const editUser = page.locator("[data-user-edit]");
  await editUser.getByLabel("Role").selectOption("analyst");
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

  await page.locator('.admin-console__nav a[href="#/budget-spend/workspaces"]').click();
  await page.waitForSelector("[data-workspace-management]");
  assert.equal(await page.locator('.admin-console__nav a[aria-current="page"]').innerText(), "Workspaces", "Workspace administration should remain inside the Admin control center");
  const workspaceAdmin = page.locator("[data-workspace-management]");
  await workspaceAdmin.getByLabel("Name").fill("Browser verification");
  await workspaceAdmin.getByLabel("Description").fill("Browser-tested isolated workspace");
  await workspaceAdmin.getByRole("button", { name: "Create workspace" }).click();
  const createdWorkspace = workspaceAdmin.locator('[data-workspace]', { hasText: "Browser verification" });
  await createdWorkspace.waitFor();
  const candidateValue = await createdWorkspace.locator('select[aria-label^="User to add"] option', { hasText: "Browser teammate" }).getAttribute("value");
  await createdWorkspace.getByLabel(/User to add/).selectOption(candidateValue);
  await createdWorkspace.getByLabel(/Role for new member/).selectOption("viewer");
  await createdWorkspace.getByRole("button", { name: "Add member" }).click();
  await createdWorkspace.getByText("Browser teammate", { exact: true }).waitFor();
  assert.match(await createdWorkspace.getByLabel(/Role for Browser teammate/).inputValue(), /viewer/, "Super user should see the member's current workspace role");
  await createdWorkspace.getByLabel(/Role for Browser teammate/).selectOption("analyst");
  await page.getByText(/Browser teammate is now Analyst/).waitFor();
  assert.equal(await createdWorkspace.locator('[aria-label="Browser verification contents"] article').count(), 6, "Each workspace should present its isolated content inventory");
  await createdWorkspace.getByRole("button", { name: "Rename" }).click();
  const workspaceEditor = createdWorkspace.locator("[data-workspace-editor]");
  await workspaceEditor.getByLabel("Workspace name").fill("Browser command");
  await workspaceEditor.getByLabel("Description").fill("Renamed browser-tested workspace");
  await workspaceEditor.getByRole("button", { name: "Save" }).click();
  await page.getByText("Browser command updated.", { exact: true }).waitFor();
  const renamedWorkspace = workspaceAdmin.locator('[data-workspace]', { hasText: "Browser command" });
  await renamedWorkspace.waitFor();
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
    const controls = [...node.querySelectorAll("button, input, select")];
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
  await requestRow.getByLabel(/Role for Self Signup User/).selectOption("viewer");
  await requestRow.getByRole("button", { name: "Approve" }).click();
  await page.getByText("Self Signup User approved.", { exact: true }).waitFor();
  await signupPage.reload({ waitUntil: "domcontentloaded" });
  await signupPage.waitForSelector("[data-defense-budget-app]");
  await signupContext.close();

  await page.goto(`${BASE_URL}#/budget-spend/events`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("[data-ops-events]");
  await page.getByRole("button", { name: "Add event" }).click();
  await page.waitForSelector("[data-ops-event-editor]");
  const attendeePicker = page.getByRole("button", { name: /^Attendees\./ });
  await attendeePicker.click();
  await page.getByLabel("Search Attendees options").fill("Browser teammate");
  await page.getByRole("option", { name: /Browser teammate/ }).getByRole("checkbox").check();
  assert.match(await attendeePicker.getAttribute("aria-label"), /Attendees \(1\)/, "Event attendees should use the searchable workspace-user multiselect");
  await page.getByRole("button", { name: "Add deadline or milestone" }).click();
  await page.getByLabel("Milestone 1 type").selectOption("refund_deadline");
  await page.getByLabel("Milestone 1 date").fill("2026-10-01");
  await page.getByLabel("Milestone 1 label").fill("Last day for refunds");
  assert.equal(await page.locator(".ops-event-milestone-row").count(), 1, "Event editor should support typed, optional deadline overlays");
  await page.getByRole("button", { name: "Close event editor" }).click();

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

  await page.locator('.admin-console__nav a[href="#/budget-spend/agents"]').click();
  await page.waitForSelector('[data-operations-hub][data-operations-view="agents"] [data-profile-agents]');
  await page.getByText("records:read", { exact: true }).waitFor();
  assert.equal(await page.locator('[role="dialog"]').count(), 0, "Agent access should render inside the persistent Admin workspace");
  assert.equal(await page.locator("[data-admin-workspace]").count(), 1, "Agent access should use the shared Admin control-center shell");
  assert.equal(await page.locator('.admin-console__nav a[aria-current="page"]').innerText(), "Agent Access", "Admin workspace should retain its active section in place");
  await page.screenshot({ path: "test-results/admin-agent-access-desktop.png", fullPage: true });
  await page.locator('.admin-console__nav a[href="#/budget-spend/api-log"]').click();
  await page.waitForSelector('[data-operations-hub][data-operations-view="activity"] [data-ops-activity]');
  assert.equal(await page.locator("[data-admin-workspace]").count(), 1, "API Log should remain inside the same Admin control-center shell");
  assert.equal(await page.locator("[data-profile-page]").count(), 0, "API Log should not jump into or out of the account-settings page");
  await page.screenshot({ path: "test-results/admin-api-log-desktop.png", fullPage: true });
  await page.locator('.admin-console__nav a[href="#/budget-spend/agents"]').click();
  await page.waitForSelector('[data-operations-hub][data-operations-view="agents"] [data-profile-agents]');
  const activeAdminTrigger = page.locator('[data-nav-group-trigger="admin"]');
  assert.equal(await activeAdminTrigger.getAttribute("data-nav-group-active-child"), "Agent Access", "Authenticated Admin trigger should name the active routed child");
  assert.equal(await activeAdminTrigger.locator(".ci-header-nav__menu-trigger-context").innerText(), "Agent Access", "Authenticated Admin should render the active child in the lighter context label");
  assert.equal(await activeAdminTrigger.locator(".ci-header-nav__menu-trigger-context").evaluate((node) => getComputedStyle(node).color), "rgb(183, 229, 255)", "Authenticated Admin active child should use the established light-blue treatment");
  assert.equal(await page.locator(".ci-header-nav__desktop-groups > .if-operations-topnav__divider").innerText(), "|", "Authenticated header should retain the platform-admin divider");
  await page.getByLabel("Name").fill("Browser verifier");
  await page.getByRole("button", { name: "Create credential" }).click();
  await page.locator(".agent-token-once code").waitFor();
  assert.match(await page.locator(".agent-token-once code").textContent(), /^dbi_agent_/, "Agent credential must be shown exactly once after creation");
  await page.getByRole("button", { name: "Revoke Browser verifier" }).click();
  await page.getByText("Revoked", { exact: true }).waitFor();

  const workspaceSeed = await page.evaluate(async () => {
    const recordsResponse = await fetch("/api/v1/agent/records?limit=1");
    const records = await recordsResponse.json();
    const recordId = records.data[0].opportunityId;
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
  });
  assert.equal(workspaceSeed.trackingStatus, 201);
  await page.goto(`${BASE_URL}#/budget-spend/watchlist`, { waitUntil: "domcontentloaded" });
  await page.locator(`[data-ops-watch-table] [data-row-key="${workspaceSeed.recordId}"]`).waitFor();
  await page.getByText("authenticated D1 workspace").waitFor();
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
  await page.locator("[data-mobile-more-menu-button]").click();
  assert.equal(await page.locator("[data-mobile-more-menu] a[data-budget-nav]").count(), 16, "Authenticated mobile More should retain all grouped routes including workspace administration");
  assert.match(await page.locator("[data-mobile-more-menu]").innerText(), /Analytics[\s\S]*Money flow[\s\S]*Admin[\s\S]*Users[\s\S]*Workspaces[\s\S]*Agent Access/i);
  await page.locator("[data-mobile-more-menu-button]").click();
  const trigger = page.locator("[data-profile-menu-trigger]");
  const box = await trigger.boundingBox();
  assert.ok(box && box.width >= 42 && box.height >= 42, "Mobile profile trigger must meet the 42px touch target");
  await trigger.click();
  const mobileSurface = page.getByRole("dialog", { name: "Profile controls" });
  const mobileSurfaceBox = await mobileSurface.boundingBox();
  assert.ok(mobileSurfaceBox && mobileSurfaceBox.x <= 13 && Math.abs((mobileSurfaceBox.x + mobileSurfaceBox.width) - 378) <= 2, "Mobile profile dropdown should use the same fixed 12px-gutter account sheet as Opportunity Intelligence");
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
      identityCopyDisplay: getComputedStyle(node.querySelector(".profile-page__identity-copy")).display,
      inputHeights: inputs.map((input) => input.getBoundingClientRect().height),
      buttonHeights: buttons.map((button) => button.getBoundingClientRect().height),
    };
  });
  assert.ok(mobileProfileGeometry.panelHeight <= 620, `Mobile Profile picture and identity controls should fit within one screen, got ${mobileProfileGeometry.panelHeight}px`);
  assert.ok(mobileProfileGeometry.panelRadius <= 4, `Mobile Profile should retain the framework radius, got ${mobileProfileGeometry.panelRadius}px`);
  assert.equal(mobileProfileGeometry.identityCopyDisplay, "none", "Mobile Profile should avoid duplicating full account metadata in the route header");
  assert.ok(mobileProfileGeometry.inputHeights.every((height) => height >= 43.5), `Mobile Profile inputs must retain 44px touch geometry: ${mobileProfileGeometry.inputHeights.join(", ")}`);
  assert.ok(mobileProfileGeometry.buttonHeights.every((height) => height >= 43.5), `Mobile Profile actions must retain 44px touch geometry: ${mobileProfileGeometry.buttonHeights.join(", ")}`);
  await page.screenshot({ path: "test-results/profile-page-mobile.png", fullPage: true });

  console.log("Verified first-account Super user, routed Profile/Security/Users/Workspaces/Agent Access, profile picture controls, human account lifecycle, mandatory temporary-password replacement, role-gated navigation, agent credentials, shared D1 state, password rotation, logout/login, and mobile UI");
} finally {
  await browser.close();
}
