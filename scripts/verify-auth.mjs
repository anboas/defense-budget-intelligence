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
  await page.getByRole("button", { name: new RegExp(initialName) }).click();
  assert.ok(await page.getByText("Super user", { exact: true }).count() >= 1, "Profile menu should identify the first account as super user");
  await page.getByRole("menuitem", { name: "My profile" }).click();
  await page.getByLabel("Display name").fill(finalName);
  await page.getByRole("button", { name: "Save profile" }).click();
  await page.getByText("Profile saved.").waitFor();
  await page.getByRole("button", { name: "Close account dialog" }).click();

  await page.getByRole("button", { name: new RegExp(finalName) }).click();
  await page.getByRole("menuitem", { name: "Agent access" }).click();
  await page.getByLabel("Name").fill("Browser verifier");
  await page.getByRole("button", { name: "Create credential" }).click();
  await page.locator(".agent-token-once code").waitFor();
  assert.match(await page.locator(".agent-token-once code").textContent(), /^dbi_agent_/, "Agent credential must be shown exactly once after creation");
  await page.getByRole("button", { name: "Revoke Browser verifier" }).click();
  await page.getByText("Revoked", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Close agent access" }).click();

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
  await page.goto(`${BASE_URL}#/budget-spend/operations`, { waitUntil: "domcontentloaded" });
  await page.locator(`[data-ops-watch-row="${workspaceSeed.recordId}"]`).waitFor();
  await page.getByText("authenticated D1 workspace").waitFor();
  await page.getByRole("button", { name: "Events", exact: true }).click();
  await page.getByText("Shared D1 verification event").waitFor();
  await page.evaluate(async ({ recordId, eventId }) => {
    await fetch(`/api/v1/agent/events/${encodeURIComponent(eventId)}`, { method: "DELETE" });
    await fetch(`/api/v1/agent/tracking/${encodeURIComponent(recordId)}`, { method: "DELETE" });
  }, workspaceSeed);

  await page.getByRole("button", { name: new RegExp(finalName) }).click();
  await page.getByRole("menuitem", { name: "Change password" }).click();
  await page.getByLabel("Current password").fill(initialPassword);
  await page.getByLabel("New password", { exact: true }).fill(nextPassword);
  await page.getByLabel("Confirm new password").fill(nextPassword);
  await page.getByRole("button", { name: "Update password" }).click();
  await page.getByText(/Other sessions were signed out/).waitFor();
  await page.getByRole("button", { name: "Close account dialog" }).click();

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

  await page.getByRole("button", { name: new RegExp(finalName) }).click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
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
  const trigger = page.locator(".profile-trigger");
  const box = await trigger.boundingBox();
  assert.ok(box && box.width >= 42 && box.height >= 42, "Mobile profile trigger must meet the 42px touch target");

  console.log("Verified first-account super-user claim, atomic singleton ownership, secure session cookie, profile update, one-time agent credential lifecycle, shared D1 Operations state, password rotation, logout/login, and mobile profile UI");
} finally {
  await browser.close();
}
