import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { chromium } from "playwright-core";

const baseUrl =
  process.env.TASKING_VERIFY_URL || "http://127.0.0.1:4177/";
const chromiumPath = [
  process.env.CHROMIUM_PATH,
  "/usr/bin/chromium-browser",
  "/usr/bin/chromium",
].find((candidate) => candidate && fs.existsSync(candidate));
const browser = await chromium.launch({
  headless: true,
  ...(chromiumPath ? { executablePath: chromiumPath } : {}),
});

const authenticated = {
  authVersion: "dbi-pages-auth-v1",
  enabled: true,
  required: true,
  claimed: true,
  user: {
    id: "fallback-verifier",
    displayName: "Fallback verifier",
    role: "super_user",
    membershipRole: "administrator",
    hasWorkspaceAccess: true,
    canWriteWorkspace: true,
    activeWorkspace: {
      id: "workspace-fallback-verification",
      name: "Fallback verification",
    },
  },
};

const liveWorkspace = {
  metadata: {
    mode: "workspace",
    label: "Live workspace",
    coverage: "Persisted Tasking data loaded.",
    counts: {
      workstreams: 1,
      anchors: 1,
      tasks: 0,
      contextRecords: 0,
      relationships: 0,
      sourceItems: 0,
      sourceFiles: 0,
      sourceFolders: 0,
      linkedSourceItems: 0,
    },
  },
  folders: [],
  workstreams: [
    {
      id: "live-workstream",
      name: "Live persisted workstream",
      shortName: "LIVE",
      category: "Operations",
      status: "active",
    },
  ],
  anchors: [
    {
      id: "live-anchor",
      kind: "Project",
      title: "Live anchor",
      workstreamId: "live-workstream",
      status: "active",
    },
  ],
  tasks: [],
  contextRecords: [],
  relationships: [],
  sourceItems: [],
};

async function verify(viewport, screenshotName = "") {
  const page = await browser.newPage({ viewport });
  const errors = [];
  let liveAvailable = false;
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (
      message.type() === "error" &&
      !message.text().startsWith("Failed to load resource:")
    )
      errors.push(message.text());
  });
  await page.route("**/api/v1/auth/**", async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(
        pathname.endsWith("/status")
          ? authenticated
          : pathname.includes("event-ai/jobs")
            ? { jobs: [] }
            : {},
      ),
    });
  });
  await page.route("**/api/v1/agent/tasking", async (route) => {
    await route.fulfill({
      status: liveAvailable ? 200 : 503,
      contentType: "application/json",
      body: JSON.stringify(
        liveAvailable
          ? { data: liveWorkspace }
          : {
              error: {
                code: "tasking_store_unavailable",
                message: "The live Tasking store is temporarily unavailable.",
              },
            },
      ),
    });
  });

  await page.goto(`${baseUrl}#/tasking?taskingView=workstreams`, {
    waitUntil: "domcontentloaded",
  });
  await page.locator("[data-tasking-fallback]").waitFor();
  assert.equal(
    await page.locator(".tasking-workstream-item").count(),
    2,
    "Transient Tasking failure must populate the bounded template workspace",
  );
  assert.equal(
    await page.locator('[data-tasking-data-mode="fallback"]').count(),
    1,
  );
  await page.getByRole("button", { name: /Delivery readiness/ }).click();
  await page.getByRole("button", { name: /^Tasks/ }).click();
  await page.getByText("Reconcile the staffing model", { exact: true }).waitFor();
  assert.equal(
    await page.getByRole("button", { name: "Create task" }).last().isDisabled(),
    true,
    "Template task actions must remain read only",
  );
  await page.getByRole("button", { name: /^Sources/ }).click();
  await page.getByRole("button", { name: "Expand Delivery readiness" }).click();
  await page.getByText("readiness-checklist.pdf", { exact: true }).click();
  await page.getByText("Selected file", { exact: true }).waitFor();
  await page.getByText("Template preview · read only", { exact: true }).waitFor();

  if (screenshotName) {
    fs.mkdirSync(path.resolve("test-results"), { recursive: true });
    await page.screenshot({
      path: path.resolve(`test-results/${screenshotName}.png`),
      fullPage: true,
    });
  }

  liveAvailable = true;
  await page.getByRole("button", { name: "Retry live data" }).click();
  await page.locator('[data-tasking-data-mode="live"]').waitFor();
  assert.equal(
    await page.locator("[data-tasking-fallback]").count(),
    0,
    "Successful D1 retry must remove every fallback marker",
  );
  await page
    .getByRole("heading", { name: "Live persisted workstream" })
    .waitFor();
  assert.equal(
    await page.getByText("Mission software capture", { exact: true }).count(),
    0,
    "Template records must not remain when the live workspace connects",
  );
  const bounds = await page.evaluate(() => ({
    width: window.innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  assert.ok(bounds.scrollWidth <= bounds.width);
  assert.deepEqual(errors, []);
  await page.close();
  return bounds;
}

try {
  const desktop = await verify(
    { width: 1440, height: 1000 },
    "tasking-template-fallback-desktop",
  );
  const mobile = await verify({ width: 390, height: 844 });
  console.log("Tasking D1 fallback verification passed", { desktop, mobile });
} finally {
  await browser.close();
}
