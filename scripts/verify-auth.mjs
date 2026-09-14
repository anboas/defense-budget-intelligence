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
  await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-account-gate="setup"]');
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
  assert.equal(await page.locator('[data-budget-nav-menu="admin"] a[data-budget-nav]').count(), 5, "Authenticated Admin should add Agent Access to the four shared management routes");
  assert.match(await page.locator('[data-budget-nav-menu="admin"]').innerText(), /Watchlist[\s\S]*Events[\s\S]*Integrations[\s\S]*API Log[\s\S]*Agent Access/i);
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
  assert.equal(await profileSurface.locator(".if-account-surface__body .if-account-action").count(), 4, "Profile dropdown should use shared account-action rows for Defense Budget destinations");
  assert.equal(await profileSurface.locator(".if-account-action__icon svg").count(), 4, "Every shared account-action row should render its icon glyph");
  assert.equal(await profileSurface.locator(".if-account-surface__footer").count(), 1, "Profile dropdown should use the shared account-surface footer");
  assert.ok(await page.getByText("Super user", { exact: true }).count() >= 1, "Profile menu should identify the first account as super user");
  await page.screenshot({ path: "test-results/profile-menu-desktop.png" });
  await page.getByRole("link", { name: /Open Profile/i }).click();
  await page.waitForSelector('[data-profile-page][data-profile-section="profile"]');
  assert.equal(await page.locator('[role="dialog"]').count(), 0, "Profile should render as a routed page, not a modal");
  assert.match(new URL(page.url()).hash, /^#\/profile$/, "Profile menu should navigate to the canonical profile route");
  await page.screenshot({ path: "test-results/profile-page-desktop.png", fullPage: true });
  await page.getByLabel("Display name").fill(finalName);
  await page.getByRole("button", { name: "Save profile" }).click();
  await page.getByText("Profile saved.").waitFor();

  await page.locator("[data-profile-menu-trigger]").click();
  await page.locator("[data-profile-menu-surface]").getByRole("link", { name: /Agent Access/i }).click();
  await page.waitForSelector('[data-profile-page][data-profile-section="agents"]');
  assert.equal(await page.locator('[role="dialog"]').count(), 0, "Agent access should render in the routed profile workspace");
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
  assert.equal(await page.locator("[data-mobile-more-menu] a[data-budget-nav]").count(), 14, "Authenticated mobile More should retain all grouped routes including Agent Access");
  assert.match(await page.locator("[data-mobile-more-menu]").innerText(), /Analytics[\s\S]*Money flow[\s\S]*Admin[\s\S]*Agent Access/i);
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
  await page.screenshot({ path: "test-results/profile-page-mobile.png", fullPage: true });

  console.log("Verified first-account super-user claim, atomic singleton ownership, secure session cookie, routed profile/security/agent pages, one-time agent credential lifecycle, shared D1 admin state, password rotation, logout/login, and mobile profile UI");
} finally {
  await browser.close();
}
