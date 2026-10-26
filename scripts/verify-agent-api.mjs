import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "playwright-core";

mkdirSync("test-results", { recursive: true });
const publishedGraphSummary = JSON.parse(readFileSync("public/data/intelligence-graph-summary.json", "utf8"));

async function freePort() {
  const server = createServer();
  await new Promise((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  const address = server.address();
  await new Promise((resolveClose) => server.close(resolveClose));
  return address.port;
}

async function waitForStatus(baseUrl, timeoutMs = 30_000) {
  const startedAt = Date.now();
  let lastError;
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(`${baseUrl}api/v1/auth/status`);
      if (response.ok) return;
      lastError = new Error(`Status probe returned ${response.status}`);
    } catch (error) { lastError = error; }
    await new Promise((resolveWait) => setTimeout(resolveWait, 200));
  }
  throw lastError || new Error(`Timed out waiting for ${baseUrl}`);
}

async function startPages(persistPath, attempts = 3) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const port = await freePort();
    const baseUrl = `http://127.0.0.1:${port}/`;
    const output = [];
    const child = spawn("npx", [
      "wrangler", "pages", "dev", "dist", "--ip", "127.0.0.1", "--port", String(port),
      "--persist-to", persistPath, "--binding", "DBI_ALLOW_FIRST_CLAIM=1", "--log-level", "error",
    ], { detached: true, stdio: ["ignore", "pipe", "pipe"] });
    child.stdout.on("data", (chunk) => output.push(chunk.toString()));
    child.stderr.on("data", (chunk) => output.push(chunk.toString()));
    try {
      await Promise.race([
        waitForStatus(baseUrl),
        new Promise((_, reject) => child.once("exit", (code) => reject(new Error(`Wrangler exited before readiness with code ${code}`)))),
      ]);
      return { child, baseUrl };
    } catch (error) {
      try { process.kill(-child.pid, "SIGTERM"); } catch { child.kill("SIGTERM"); }
      const diagnostic = `${error.message}\n${output.join("").slice(-12_000)}`;
      if (/address already in use/i.test(diagnostic) && attempt < attempts) continue;
      throw new Error(diagnostic, { cause: error });
    }
  }
  throw new Error("Wrangler Pages could not acquire a local verification port");
}

async function stopPages(instance) {
  if (!instance) return;
  try { process.kill(-instance.child.pid, "SIGTERM"); }
  catch { if (instance.child.exitCode === null) instance.child.kill("SIGTERM"); }
  await Promise.race([
    new Promise((resolveExit) => instance.child.once("exit", resolveExit)),
    new Promise((resolveTimeout) => setTimeout(resolveTimeout, 3_000)),
  ]);
  try { process.kill(-instance.child.pid, "SIGKILL"); }
  catch { if (instance.child.exitCode === null) instance.child.kill("SIGKILL"); }
  instance.child.stdout?.destroy();
  instance.child.stderr?.destroy();
}

function cookieFrom(response) {
  return String(response.headers.get("set-cookie") || "").split(";")[0];
}

async function request(baseUrl, path, { method = "GET", body, cookie = "", token = "", headers = {} } = {}) {
  return fetch(new URL(path, baseUrl), {
    method,
    headers: {
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...(cookie ? { cookie } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function body(response) {
  const payload = await response.json();
  return { response, payload };
}

async function verifyTaskingBrowser(baseUrl, cookie) {
  const chromiumPath = [process.env.CHROMIUM_PATH, "/usr/bin/chromium-browser", "/usr/bin/chromium"].find((candidate) => candidate && existsSync(candidate));
  const browser = await chromium.launch({ headless: true, ...(chromiumPath ? { executablePath: chromiumPath } : {}) });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const [name, ...valueParts] = cookie.split("=");
    await context.addCookies([{ name, value: valueParts.join("="), url: baseUrl }]);
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => { if (message.type() === "error" && !message.text().startsWith("Failed to load resource:")) errors.push(message.text()); });
    await page.goto(new URL("#/tasking?taskingView=portfolio", baseUrl).toString(), { waitUntil: "domcontentloaded" });
    await page.getByText("Workspace tasking", { exact: true }).waitFor();
    assert.equal(await page.locator(".tasking-lane").count(), 1, "Signed-in Tasking must render only the persisted workstream");
    await page.getByText("Growth", { exact: true }).first().waitFor();
    await page.getByText("Index local source", { exact: true }).waitFor();
    assert.equal(await page.getByText("Capture & pursuits", { exact: true }).count(), 0, "Signed-in Tasking must not merge synthetic workstreams");
    const draftRow = page.locator(".tasking-task-row").filter({ hasText: "Review unconfirmed source action" });
    await draftRow.getByText("Draft", { exact: true }).waitFor();
    await draftRow.getByText(/No owner · 1 evidence/).waitFor();
    await draftRow.click();
    await page.locator("[data-tasking-task-editor]").waitFor();
    assert.equal(await page.locator("[data-tasking-owner-input]").inputValue(), "", "Draft editor must preserve a blank owner");
    assert.equal(await page.getByRole("button", { name: "Save task" }).isEnabled(), true, "Draft Save must remain enabled with a blank owner and acceptance criteria");
    await page.goto(new URL("#/tasking?taskingView=portfolio&taskingStatus=draft", baseUrl).toString(), { waitUntil: "domcontentloaded" });
    await page.getByText("Review unconfirmed source action", { exact: true }).waitFor();
    assert.equal(await page.locator(".tasking-task-row").count(), 1, "Draft status filter must isolate draft tasks");
    await page.locator('[data-workspace-view="files"]').click();
    await page.locator(".tasking-file-table").getByText("Capture brief.docx", { exact: true }).waitFor();
    await page.locator(".tasking-search input").fill("Capture brief");
    assert.equal(await page.locator(".tasking-file-table > button").count(), 1, "Source search must filter the real metadata table");
    await page.goto(new URL("#/tasking?taskingView=connections", baseUrl).toString(), { waitUntil: "domcontentloaded" });
    await page.locator(".tasking-graph__node").first().waitFor();
    assert.equal(await page.locator(".tasking-graph__node").count(), 2, "Connections must lay out persisted records without synthetic coordinates");
    const width = await page.evaluate(() => ({ viewport: window.innerWidth, scroll: document.documentElement.scrollWidth }));
    assert.ok(width.scroll <= width.viewport, `Tasking Agent API desktop projection overflowed: ${width.scroll}px > ${width.viewport}px`);
    mkdirSync("test-results", { recursive: true });
    await page.screenshot({ path: resolve("test-results/tasking-agent-api-desktop.png"), fullPage: true });
    assert.deepEqual(errors, [], `Tasking Agent API browser errors: ${errors.join(" | ")}`);
    await context.close();
  } finally {
    await browser.close();
  }
}

const persistPath = resolve(mkdtempSync("test-results/agent-api-"));
let instance;
let workspaceEntityId;
try {
  instance = await startPages(persistPath);
  let result = await body(await request(instance.baseUrl, "/api/v1/agent/capabilities"));
  assert.equal(result.response.status, 401, "Agent API must reject anonymous access");

  const owner = {
    email: "agent-owner@example.test",
    displayName: "Agent API Owner",
    title: "Super user",
    passwordSalt: "12".repeat(24),
    passwordProof: "34".repeat(32),
  };
  result = await body(await request(instance.baseUrl, "/api/v1/auth/claim", { method: "POST", body: owner }));
  assert.equal(result.response.status, 201);
  const ownerId = result.payload.user.id;
  let ownerCookie = cookieFrom(result.response);

  result = await body(await request(instance.baseUrl, "/api/v1/agent/tracking/not-a-record", {
    method: "PUT", cookie: ownerCookie, headers: { origin: "https://cross-origin.example" }, body: { note: "blocked" },
  }));
  assert.equal(result.response.status, 403, "Cookie-authenticated workspace writes must reject cross-origin requests");

  const allScopes = [
    "records:read", "records:write", "tracking:read", "tracking:write", "events:read", "events:write",
    "activity:read", "activity:write", "integrations:read", "tasking:read", "tasking:write",
    "graph:read", "evidence:read", "enrichment:propose", "review:read", "review:write", "graph:admin",
  ];
  result = await body(await request(instance.baseUrl, "/api/v1/auth/agent-keys", {
    method: "POST", cookie: ownerCookie, body: { name: "API verifier", scopes: allScopes },
  }));
  assert.equal(result.response.status, 201);
  const firstKeyId = result.payload.key.id;
  const agentToken = result.payload.token;
  assert.match(agentToken, /^dbi_agent_/);
  result = await body(await request(instance.baseUrl, "/api/v1/agent/tracking/not-a-record", {
    method: "PUT", token: agentToken, body: { note: "invalid stable ID" },
  }));
  assert.equal(result.response.status, 404, "Tracking must reject unknown record IDs");

  result = await body(await request(instance.baseUrl, "/api/v1/agent/capabilities", { token: agentToken }));
  assert.equal(result.response.status, 200);
  assert.equal(result.payload.apiVersion, "dbi-agent-v1");
  assert.equal(result.payload.data.contractVersion, "1.3.0");
  assert.deepEqual(result.payload.data.resources, [
    "records", "analytics", "tracking", "record-dispositions", "record-groups", "record-intelligence", "events", "event-catalog", "event-categories", "activity", "api-requests", "integrations", "tasking",
    "graph", "entities", "activities", "locations", "evidence", "sources", "enrichment", "reviews", "jobs",
  ]);

  result = await body(await request(instance.baseUrl, "/api/v1/agent/openapi.json", { token: agentToken }));
  assert.equal(result.response.status, 200);
  assert.equal(result.payload.openapi, "3.1.0");
  assert.equal(result.payload.info.version, "1.3.0");
  assert.deepEqual(result.payload.components.schemas.TaskingTaskStatus.enum, ["draft", "ready", "in-progress", "waiting", "review", "blocked", "completed"]);
  assert.deepEqual(result.payload.components.schemas.TaskingSourceItem.properties.provider.enum, ["localfs", "onedrive"]);
  assert.equal(result.payload.paths["/api/v1/agent/tasking/source-items/batch"].post.requestBody.content["application/json"].schema.properties.items.maxItems, 50);
  assert.match(result.payload.components.schemas.TaskingTaskCreate.properties.owner.description, /blank only while status is draft/i);
  assert.ok(result.payload.paths["/api/v1/agent/record-dispositions/{recordId}"], "Agent OpenAPI must document workspace tombstone and restore operations");
  assert.ok(result.payload.paths["/api/v1/agent/record-groups"], "Agent OpenAPI must document lifecycle grouping operations");
  assert.ok(result.payload.paths["/api/v1/agent/record-intelligence/{recordId}"], "Agent OpenAPI must document record research and relationship reads");
  assert.ok(result.payload.paths["/api/v1/agent/record-intelligence/{recordId}/research"], "Agent OpenAPI must document official-source AI research operations");
  assert.ok(result.payload.paths["/api/v1/agent/record-intelligence/{recordId}/jobs/{jobId}"], "Agent OpenAPI must document resumable record-research polling");
  assert.ok(result.payload.paths["/api/v1/agent/event-catalog"], "Agent OpenAPI must document curated event catalog search");
  assert.ok(result.payload.paths["/api/v1/agent/entities/{entityId}/relations"], "Agent OpenAPI must document graph traversal");
  assert.ok(result.payload.paths["/api/v1/agent/enrichment/proposals"], "Agent OpenAPI must document cited enrichment proposals");
  assert.ok(result.payload.paths["/api/v1/agent/jobs"], "Agent OpenAPI must document intelligence publication jobs");
  assert.ok(result.payload.paths["/api/v1/agent/tasking/tasks/{taskId}"], "Agent OpenAPI must document Tasking CRUD");
  assert.ok(result.payload.paths["/api/v1/agent/tasking/source-items/batch"], "Agent OpenAPI must document normalized source synchronization");

  result = await body(await request(instance.baseUrl, "/api/v1/auth/agent-keys", {
    method: "POST", cookie: ownerCookie, body: { name: "Tasking read verifier", scopes: ["tasking:read"] },
  }));
  assert.equal(result.response.status, 201);
  const taskingReadToken = result.payload.token;
  result = await body(await request(instance.baseUrl, "/api/v1/agent/tasking", { token: taskingReadToken }));
  assert.equal(result.response.status, 200);
  assert.deepEqual(result.payload.data.metadata.counts, { workstreams: 0, anchors: 0, tasks: 0, contextRecords: 0, relationships: 0, sourceItems: 0, sourceFiles: 0, sourceFolders: 0, linkedSourceItems: 0 });
  assert.equal(result.payload.data.tasks.length, 0, "A new workspace must not receive synthetic tasks");
  assert.equal(result.payload.data.workstreams.length, 0, "A new workspace must not receive synthetic workstreams");
  assert.doesNotMatch(JSON.stringify(result.payload.data), /Example mission pursuit|Example owner|Synthetic foundation/, "Tasking projection must contain no demo records");
  result = await body(await request(instance.baseUrl, "/api/v1/agent/tasking/tasks", {
    method: "POST", token: taskingReadToken, headers: { "idempotency-key": "read-key-cannot-write" },
    body: { id: "task-agent-created", title: "Index local source", description: "Normalize local source metadata.", status: "ready", owner: "Codex", acceptance: "Source items are queryable", anchorId: "anchor-onedrive" },
  }));
  assert.equal(result.response.status, 403, "tasking:read must not authorize writes");

  result = await body(await request(instance.baseUrl, "/api/v1/agent/tasking/tasks", {
    method: "POST", token: agentToken, headers: { "idempotency-key": "tasking-create-1" },
    body: { id: "task-agent-created", title: "Index local source", description: "Normalize local source metadata.", status: "draft", owner: "", acceptance: "Source items are queryable after review", anchorId: "anchor-onedrive" },
  }));
  assert.equal(result.response.status, 201);
  assert.equal(result.payload.data.version, 1);
  assert.equal(result.payload.data.status, "draft");
  assert.equal(result.payload.data.owner, "", "Agent-created drafts must preserve a blank owner");
  result = await body(await request(instance.baseUrl, "/api/v1/agent/tasking/tasks/task-agent-created", {
    method: "PATCH", token: agentToken, headers: { "if-match": "1" }, body: { status: "ready" },
  }));
  assert.equal(result.response.status, 400, "Promoting a draft without assigning an owner must fail closed");
  assert.match(result.payload.error.message, /owner is required unless status is draft/i);
  result = await body(await request(instance.baseUrl, "/api/v1/agent/tasking/tasks/task-agent-created", {
    method: "PATCH", token: agentToken, headers: { "if-match": "1" }, body: { status: "in-progress", owner: "Codex" },
  }));
  assert.equal(result.response.status, 200);
  assert.equal(result.payload.data.version, 2);
  result = await body(await request(instance.baseUrl, "/api/v1/agent/tasking/tasks/task-agent-created", {
    method: "PATCH", token: agentToken, headers: { "if-match": "1" }, body: { status: "completed" },
  }));
  assert.equal(result.response.status, 409, "Tasking updates must reject stale versions");

  const draftDescription = "Source reference: retained local document. Timing (unconfirmed): Not stated. Draft creation does not approve execution.";
  const draftAcceptance = "Confirm owner, date, and permission to proceed while retaining supporting evidence.";
  result = await body(await request(instance.baseUrl, "/api/v1/agent/tasking/tasks", {
    method: "POST", token: agentToken, headers: { "idempotency-key": "tasking-draft-create-1" },
    body: { id: "task-agent-draft", title: "Review unconfirmed source action", description: draftDescription, status: "draft", owner: "", acceptance: draftAcceptance, anchorId: "anchor-onedrive", evidenceCount: 1 },
  }));
  assert.equal(result.response.status, 201);
  assert.equal(result.payload.data.description, draftDescription, "Draft creation must preserve source references and unconfirmed timing");
  assert.equal(result.payload.data.acceptance, draftAcceptance, "Draft creation must preserve approval conditions");
  assert.equal(result.payload.data.owner, "");

  result = await body(await request(instance.baseUrl, "/api/v1/agent/tasking/records", {
    method: "POST", token: agentToken, headers: { "idempotency-key": "tasking-workstream-1" },
    body: { id: "workstream-onedrive", type: "workstream", name: "Local source intake", description: "Codex-normalized workspace material.", tone: "blue" },
  }));
  assert.equal(result.response.status, 201);
  result = await body(await request(instance.baseUrl, "/api/v1/agent/tasking/records", {
    method: "POST", token: agentToken, headers: { "idempotency-key": "tasking-anchor-1" },
    body: { id: "anchor-onedrive", type: "anchor", kind: "File", title: "Local source intake", workstreamId: "workstream-onedrive", status: "ready", outcome: "Keep source metadata current", nextMove: "Run sync" },
  }));
  assert.equal(result.response.status, 201);
  result = await body(await request(instance.baseUrl, "/api/v1/agent/tasking/relationships", {
    method: "POST", token: agentToken, headers: { "idempotency-key": "tasking-relationship-1" },
    body: { id: "relationship-onedrive-file", fromId: "anchor-onedrive", toId: "source-brief", type: "informs", status: "confirmed", basis: "Explicit Agent API source mapping" },
  }));
  assert.equal(result.response.status, 201);
  assert.equal(result.payload.data.type, "relationship");

  const oneDriveBatch = { items: [
    { id: "source-root", provider: "localfs", sourceId: "localfs:root", name: "Growth", path: "/Growth", itemType: "folder", lastModifiedAt: "2026-10-25T15:00:00Z" },
    { id: "source-brief", provider: "localfs", sourceId: "localfs:item-1", parentSourceId: "localfs:root", name: "Capture brief.docx", path: "/Growth/Capture brief.docx", itemType: "file", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", size: 4096, etag: "etag-1", lastModifiedAt: "2026-10-25T15:01:00Z", parseStatus: "parsed", recordId: "anchor-onedrive" },
  ] };
  result = await body(await request(instance.baseUrl, "/api/v1/agent/tasking/source-items/batch", {
    method: "POST", token: agentToken, headers: { "idempotency-key": "onedrive-batch-1" }, body: oneDriveBatch,
  }));
  assert.equal(result.response.status, 200);
  assert.equal(result.payload.meta.accepted, 2);
  assert.equal(result.payload.data.items[1].webUrl.includes("token"), false, "Stored source metadata must not contain credentials");
  result = await body(await request(instance.baseUrl, "/api/v1/agent/tasking/source-items/batch", {
    method: "POST", token: agentToken, headers: { "idempotency-key": "onedrive-batch-1" }, body: oneDriveBatch,
  }));
  assert.equal(result.response.headers.get("idempotent-replay"), "true", "Source synchronization must replay idempotently");
  result = await body(await request(instance.baseUrl, "/api/v1/agent/tasking/source-items/batch", {
    method: "POST", token: agentToken, headers: { "idempotency-key": "onedrive-batch-conflict" }, body: { items: [
      { id: "source-conflicting-id", provider: "localfs", sourceId: "localfs:item-1", name: "Conflict.docx", path: "/Conflict.docx", itemType: "file" },
      { id: "source-must-not-partially-save", provider: "localfs", sourceId: "localfs:item-2", name: "Partial.docx", path: "/Partial.docx", itemType: "file" },
    ] },
  }));
  assert.equal(result.response.status, 409, "Source identity collisions must fail closed");
  result = await body(await request(instance.baseUrl, "/api/v1/agent/tasking/source-items/source-must-not-partially-save", { token: agentToken }));
  assert.equal(result.response.status, 404, "A rejected source batch must not partially persist later items");
  result = await body(await request(instance.baseUrl, "/api/v1/agent/tasking/source-items/source-credential-url", {
    method: "PUT", token: agentToken, headers: { "idempotency-key": "onedrive-credential-url" },
    body: { provider: "localfs", sourceId: "localfs:credential", name: "Credential URL.docx", path: "/Credential URL.docx", itemType: "file", webUrl: "https://example.test/file?token=forbidden" },
  }));
  assert.equal(result.response.status, 400, "Source metadata must reject credential-bearing URLs");
  result = await body(await request(instance.baseUrl, "/api/v1/agent/tasking", { token: agentToken }));
  assert.equal(result.payload.data.metadata.sourceHealth, "connected");
  assert.equal(result.payload.data.sourceItems.length, 2);
  assert.deepEqual(result.payload.data.metadata.counts, { workstreams: 1, anchors: 1, tasks: 2, contextRecords: 0, relationships: 1, sourceItems: 2, sourceFiles: 1, sourceFolders: 1, linkedSourceItems: 1 });
  assert.equal(result.payload.data.folders.length, 0, "Tasking snapshots must not merge demo folder trees");
  assert.ok(result.payload.data.tasks.some((task) => task.id === "task-agent-created" && task.version === 2));
  result = await body(await request(instance.baseUrl, "/api/v1/agent/tasking/tasks", {
    method: "POST", token: agentToken, headers: { "idempotency-key": "tasking-delete-verifier-create" },
    body: { id: "task-delete-verifier", title: "Delete verifier", description: "Exercise custom task deletion.", status: "draft", owner: "", acceptance: "Deletion returns a tombstone", anchorId: "anchor-onedrive" },
  }));
  assert.equal(result.response.status, 201);
  const taskDeleteResponse = await request(instance.baseUrl, "/api/v1/agent/tasking/tasks/task-delete-verifier", { method: "DELETE", token: agentToken, headers: { "if-match": "1" } });
  assert.equal(taskDeleteResponse.status, 204, "Custom Tasking deletion must accept the matching object type");
  result = await body(await request(instance.baseUrl, "/api/v1/agent/tasking/tasks/task-delete-verifier", { token: agentToken }));
  assert.equal(result.response.status, 404, "Deleted custom tasks must leave the active collection");
  await verifyTaskingBrowser(instance.baseUrl, ownerCookie);

  result = await body(await request(instance.baseUrl, "/api/v1/agent/event-catalog?q=simulation&includePast=1", { token: agentToken }));
  assert.equal(result.response.status, 200);
  assert.ok(result.payload.data.some((event) => event.id === "catalog-iitsec-2026"), "Agent catalog search must return the source-backed I/ITSEC edition");
  assert.ok(result.payload.meta.catalogTotal >= 12, "Agent catalog metadata must report a useful curated baseline");

  result = await body(await request(instance.baseUrl, "/api/v1/agent/events", { token: agentToken }));
  assert.equal(result.response.status, 200);
  assert.equal(result.payload.meta.total, 5, "The shared event migration should import exactly the five approved wallboard events");
  assert.equal(result.payload.data.some((event) => /AFRL Classified Industry Day/i.test(event.title)), false, "The excluded AFRL event must not enter the shared database");
  assert.deepEqual(result.payload.data.find((event) => event.id === "event-air-space-cyber-conference-2026")?.attendees, [], "Imported free-text names must not masquerade as workspace-user attendees");
  assert.ok(result.payload.data.some((event) => event.id === "event-weapon-systems-software-summit-2026"), "The Weapon Systems Software Summit should be imported");
  assert.deepEqual(result.payload.data.find((event) => event.id === "event-air-space-cyber-conference-2026")?.categoryIds, ["conference"], "Title-explicit legacy conferences should receive the managed Conference category");
  assert.deepEqual(result.payload.data.find((event) => event.id === "event-weapon-systems-software-summit-2026")?.categoryIds, ["summit"], "The existing software summit should receive the managed Summit category");

  result = await body(await request(instance.baseUrl, "/api/v1/agent/event-categories", { token: agentToken }));
  assert.equal(result.response.status, 200);
  assert.equal(result.payload.meta.total, 6, "Every workspace should start with the six managed event categories");
  assert.ok(result.payload.data.some((category) => category.id === "industry-day" && category.name === "Industry day"));
  result = await body(await request(instance.baseUrl, "/api/v1/agent/event-categories", {
    method: "POST", token: agentToken, body: { name: "Agent-defined taxonomy" },
  }));
  assert.equal(result.response.status, 403, "Agent event-write scope must not grant workspace taxonomy administration");

  result = await body(await request(instance.baseUrl, "/api/v1/agent/records?limit=5&sort=potentialAmount&direction=desc", { token: agentToken }));
  assert.equal(result.response.status, 200);
  assert.ok(result.payload.meta.total >= 875, `Expected at least 875 factual records, received ${result.payload.meta.total}`);
  const factualRecordId = result.payload.data[0].opportunityId;

  result = await body(await request(instance.baseUrl, "/api/v1/auth/agent-keys", {
    method: "POST", cookie: ownerCookie, body: {
      name: "Autonomous research verifier",
      scopes: ["graph:read", "evidence:read", "enrichment:propose", "review:read"],
    },
  }));
  assert.equal(result.response.status, 201);
  const researchKeyId = result.payload.key.id;
  const researchToken = result.payload.token;

  result = await body(await request(instance.baseUrl, "/api/v1/agent/graph/summary", { token: researchToken }));
  assert.equal(result.response.status, 200);
  assert.equal(result.payload.meta.contractVersion, "1.1.0");
  assert.deepEqual(result.payload.data.published.totals, publishedGraphSummary.totals);
  assert.deepEqual(result.payload.data.workspaceOverlay, { entities: 0, claims: 0, relations: 0, proposals: {} });

  result = await body(await request(instance.baseUrl, "/api/v1/agent/entities?type=activity&limit=1", { token: researchToken }));
  assert.equal(result.response.status, 200);
  assert.equal(result.payload.data.length, 1);
  const activityEntityId = result.payload.data[0].id;
  assert.match(activityEntityId, /^activity:/);
  result = await body(await request(instance.baseUrl, `/api/v1/agent/entities/${encodeURIComponent(activityEntityId)}`, { token: researchToken }));
  assert.equal(result.response.status, 200);
  assert.equal(result.payload.data.baseEntity.id, activityEntityId);
  result = await body(await request(instance.baseUrl, `/api/v1/agent/entities/${encodeURIComponent(activityEntityId)}/relations?limit=10`, { token: researchToken }));
  assert.equal(result.response.status, 200);
  assert.ok(result.payload.data.length > 0, "Graph traversal must return evidence-backed relations");
  result = await body(await request(instance.baseUrl, `/api/v1/agent/activities/${encodeURIComponent(activityEntityId)}/connected`, { token: researchToken }));
  assert.equal(result.response.status, 200);
  assert.equal(result.payload.data.activityId, activityEntityId.replace(/^activity:/, ""));

  result = await body(await request(instance.baseUrl, "/api/v1/agent/entities?type=spending-observation&limit=1", { token: researchToken }));
  assert.equal(result.response.status, 200);
  assert.equal(result.payload.meta.total, publishedGraphSummary.metadata.coverage.spending.observations);
  const spendingObservationId = result.payload.data[0].id;
  assert.match(spendingObservationId, /^spending-observation:/);
  result = await body(await request(instance.baseUrl, `/api/v1/agent/entities/${encodeURIComponent(spendingObservationId)}/relations?limit=10`, { token: researchToken }));
  assert.equal(result.response.status, 200);
  assert.ok(result.payload.data.some((relation) => relation.type === "spending-observation-measures-entity"), "Spending observations must traverse to one measured subject");
  assert.ok(result.payload.data.some((relation) => relation.type === "supported-by-source"), "Spending observations must traverse to official source evidence");

  result = await body(await request(instance.baseUrl, "/api/v1/agent/entities?type=execution-balance&limit=1", { token: researchToken }));
  assert.equal(result.response.status, 200);
  assert.equal(result.payload.meta.total, publishedGraphSummary.metadata.coverage.money.executionBalances);
  const executionBalanceId = result.payload.data[0].id;
  result = await body(await request(instance.baseUrl, `/api/v1/agent/entities/${encodeURIComponent(executionBalanceId)}/relations?limit=20`, { token: researchToken }));
  assert.equal(result.response.status, 200);
  assert.ok(result.payload.data.some((relation) => relation.type === "treasury-account-has-execution-balance"), "Execution balances must traverse to their exact TAS");
  assert.ok(result.payload.data.some((relation) => relation.type === "federal-account-has-execution-balance"), "Execution balances must traverse to their federal account");

  result = await body(await request(instance.baseUrl, "/api/v1/agent/entities?type=apportionment-revision&limit=1", { token: researchToken }));
  assert.equal(result.response.status, 200);
  assert.equal(result.payload.meta.total, publishedGraphSummary.metadata.coverage.money.apportionmentRevisions);
  const apportionmentId = result.payload.data[0].id;
  result = await body(await request(instance.baseUrl, `/api/v1/agent/entities/${encodeURIComponent(apportionmentId)}/relations?limit=20`, { token: researchToken }));
  assert.equal(result.response.status, 200);
  assert.ok(result.payload.data.some((relation) => relation.type === "supported-by-source"), "OMB revisions must traverse to official source evidence");

  result = await body(await request(instance.baseUrl, "/api/v1/agent/entities?type=award-action&limit=1", { token: researchToken }));
  assert.equal(result.response.status, 200);
  assert.equal(result.payload.meta.total, publishedGraphSummary.metadata.coverage.acquisition.awardActions);
  const awardActionId = result.payload.data[0].id;
  result = await body(await request(instance.baseUrl, `/api/v1/agent/entities/${encodeURIComponent(awardActionId)}/relations?limit=20`, { token: researchToken }));
  assert.ok(result.payload.data.some((relation) => relation.type === "award-modified-by-action"), "Priority award actions must traverse to their exact award");
  assert.ok(result.payload.data.some((relation) => relation.type === "supported-by-source"), "Priority award actions must traverse to official transaction evidence");

  result = await body(await request(instance.baseUrl, "/api/v1/agent/entities?type=legislative-measure&limit=100", { token: researchToken }));
  assert.equal(result.response.status, 200);
  assert.equal(result.payload.meta.total, publishedGraphSummary.metadata.coverage.legislation.measures);
  let measureWithVersion = false;
  let enactedMeasure = false;
  for (const measure of result.payload.data) {
    const relations = await body(await request(instance.baseUrl, `/api/v1/agent/entities/${encodeURIComponent(measure.id)}/relations?limit=100`, { token: researchToken }));
    assert.equal(relations.response.status, 200);
    measureWithVersion ||= relations.payload.data.some((relation) => relation.type === "measure-has-version");
    enactedMeasure ||= relations.payload.data.some((relation) => relation.type === "measure-enacted-as");
    if (measureWithVersion && enactedMeasure) break;
  }
  assert.ok(measureWithVersion, "Defense measures must traverse to exact official text versions");
  assert.ok(enactedMeasure, "Enacted defense measures must traverse to exact public-law identity");

  result = await body(await request(instance.baseUrl, "/api/v1/agent/entities?type=defense-program&limit=1", { token: researchToken }));
  assert.equal(result.response.status, 200);
  assert.equal(result.payload.meta.total, publishedGraphSummary.metadata.coverage.programs.defensePrograms);
  const programId = result.payload.data[0].id;
  result = await body(await request(instance.baseUrl, `/api/v1/agent/entities/${encodeURIComponent(programId)}/relations?limit=50`, { token: researchToken }));
  assert.ok(result.payload.data.some((relation) => relation.type === "defense-program-represented-by-budget-line"), "Defense programs must traverse to official budget lines");
  assert.ok(result.payload.data.some((relation) => relation.type === "defense-program-has-baseline"), "Defense programs must traverse to official request baselines");

  result = await body(await request(instance.baseUrl, "/api/v1/agent/entities?type=program-baseline&limit=1", { token: researchToken }));
  assert.equal(result.response.status, 200);
  assert.equal(result.payload.meta.total, publishedGraphSummary.metadata.coverage.programs.requestBaselines);

  result = await body(await request(instance.baseUrl, "/api/v1/agent/entities?type=appropriation-mark&limit=1", { token: researchToken }));
  assert.equal(result.response.status, 200);
  assert.equal(result.payload.meta.total, publishedGraphSummary.metadata.coverage.legislation.appropriationMarks);
  const markId = result.payload.data[0].id;
  result = await body(await request(instance.baseUrl, `/api/v1/agent/entities/${encodeURIComponent(markId)}/relations?limit=20`, { token: researchToken }));
  assert.ok(result.payload.data.some((relation) => relation.type === "appropriation-mark-affects-defense-program"), "House marks must traverse to their exact defense program");
  assert.ok(result.payload.data.some((relation) => relation.type === "appropriation-mark-recommended-by-report"), "House marks must traverse to their exact committee report");
  assert.ok(result.payload.data.some((relation) => relation.type === "appropriation-mark-considered-by-measure"), "House marks must traverse to their exact legislative measure");

  result = await body(await request(instance.baseUrl, "/api/v1/agent/entities?type=official-role&limit=1", { token: researchToken }));
  assert.equal(result.response.status, 200);
  assert.equal(result.payload.meta.total, publishedGraphSummary.metadata.coverage.people.officialRoles);
  const officialRoleId = result.payload.data[0].id;
  result = await body(await request(instance.baseUrl, `/api/v1/agent/entities/${encodeURIComponent(officialRoleId)}/relations?limit=20`, { token: researchToken }));
  assert.ok(result.payload.data.some((relation) => relation.type === "person-holds-official-role"), "Official roles must traverse to public professional identities");
  assert.ok(result.payload.data.some((relation) => relation.type === "official-role-at-organization"), "Official roles must traverse to published organizations");
  assert.ok(result.payload.data.some((relation) => relation.type === "supported-by-source"), "Official roles must traverse to official source evidence");

  result = await body(await request(instance.baseUrl, "/api/v1/agent/entities?type=organization-source-monitor&limit=1", { token: researchToken }));
  assert.equal(result.response.status, 200);
  assert.equal(result.payload.meta.total, publishedGraphSummary.metadata.coverage.organizationIntelligence.monitoredSources);
  const organizationMonitorId = result.payload.data[0].id;
  result = await body(await request(instance.baseUrl, `/api/v1/agent/entities/${encodeURIComponent(organizationMonitorId)}/relations?limit=30`, { token: researchToken }));
  assert.ok(result.payload.data.some((relation) => relation.type === "organization-source-monitor-has-observation"), "Organization source monitors must traverse to their content-hash observations");
  assert.ok(result.payload.data.some((relation) => relation.type === "organization-source-monitor-covers-dossier"), "Organization source monitors must traverse to exactly covered dossiers");

  result = await body(await request(instance.baseUrl, "/api/v1/agent/entities?type=organization-dossier&limit=1", { token: researchToken }));
  assert.equal(result.response.status, 200);
  assert.equal(result.payload.meta.total, publishedGraphSummary.metadata.coverage.organizationIntelligence.dossiers);
  const dossierId = result.payload.data[0].id;
  result = await body(await request(instance.baseUrl, `/api/v1/agent/entities/${encodeURIComponent(dossierId)}/relations?type=organization-dossier-for-organization&limit=10`, { token: researchToken }));
  assert.equal(result.response.status, 200);
  assert.ok(result.payload.data.some((relation) => relation.type === "organization-dossier-for-organization"), "Organization dossiers must traverse to their canonical organization identity");
  result = await body(await request(instance.baseUrl, `/api/v1/agent/entities/${encodeURIComponent(dossierId)}/relations?type=organization-dossier-has-research-gap&limit=10`, { token: researchToken }));
  assert.equal(result.response.status, 200);
  assert.ok(result.payload.data.some((relation) => relation.type === "organization-dossier-has-research-gap"), "Organization dossiers must expose unresolved research work");
  result = await body(await request(instance.baseUrl, `/api/v1/agent/entities/${encodeURIComponent(dossierId)}/relations?type=supported-by-source&limit=10`, { token: researchToken }));
  assert.equal(result.response.status, 200);
  assert.ok(result.payload.data.some((relation) => relation.type === "supported-by-source"), "Organization dossiers must traverse to retained source evidence");

  result = await body(await request(instance.baseUrl, "/api/v1/agent/entities?type=supplier-relationship&limit=1", { token: researchToken }));
  assert.equal(result.response.status, 200);
  assert.equal(result.payload.meta.total, publishedGraphSummary.metadata.coverage.industrialBase.supplierRelationships);
  const supplierRelationshipId = result.payload.data[0].id;
  result = await body(await request(instance.baseUrl, `/api/v1/agent/entities/${encodeURIComponent(supplierRelationshipId)}/relations?limit=20`, { token: researchToken }));
  assert.ok(result.payload.data.some((relation) => relation.type === "supplier-relationship-prime"), "Supplier relationships must traverse to prime organizations");
  assert.ok(result.payload.data.some((relation) => relation.type === "supplier-relationship-supplier"), "Supplier relationships must traverse to supplier organizations");

  result = await body(await request(instance.baseUrl, "/api/v1/agent/entities?type=official-document&limit=1", { token: researchToken }));
  assert.equal(result.response.status, 200);
  assert.equal(result.payload.meta.total, publishedGraphSummary.metadata.coverage.documents.officialDocuments);
  const officialDocumentId = result.payload.data[0].id;
  result = await body(await request(instance.baseUrl, `/api/v1/agent/entities/${encodeURIComponent(officialDocumentId)}/relations?limit=50`, { token: researchToken }));
  assert.ok(result.payload.data.some((relation) => relation.type === "official-document-has-version"), "Official documents must traverse to observed versions");

  result = await body(await request(instance.baseUrl, "/api/v1/agent/entities?type=document-citation&limit=1", { token: researchToken }));
  assert.equal(result.response.status, 200);
  assert.equal(result.payload.meta.total, publishedGraphSummary.metadata.coverage.documents.citations);
  const documentCitationId = result.payload.data[0].id;
  result = await body(await request(instance.baseUrl, `/api/v1/agent/entities/${encodeURIComponent(documentCitationId)}/relations?limit=20`, { token: researchToken }));
  assert.ok(result.payload.data.some((relation) => relation.type === "official-document-has-citation"), "Document citations must traverse to their official document");
  assert.ok(result.payload.data.some((relation) => relation.type.startsWith("document-citation-supports-")), "Document citations must traverse to the supported graph fact");

  result = await body(await request(instance.baseUrl, "/api/v1/agent/entities?type=saved-query-template&limit=20", { token: researchToken }));
  assert.equal(result.response.status, 200);
  assert.equal(result.payload.meta.total, publishedGraphSummary.metadata.coverage.operations.savedQueryTemplates);

  result = await body(await request(instance.baseUrl, "/api/v1/agent/entities?type=mission-assignment&limit=1", { token: researchToken }));
  assert.equal(result.response.status, 200);
  assert.equal(result.payload.meta.total, publishedGraphSummary.metadata.coverage.market.reviewedMissionAssignments);
  const missionId = result.payload.data[0].id;
  result = await body(await request(instance.baseUrl, `/api/v1/agent/entities/${encodeURIComponent(missionId)}/relations?limit=20`, { token: researchToken }));
  assert.ok(result.payload.data.some((relation) => relation.type === "mission-assignment-at-location"), "Reviewed missions must traverse to their installation");
  assert.ok(result.payload.data.some((relation) => relation.type === "supported-by-source"), "Reviewed missions must traverse to authoritative evidence");

  result = await body(await request(instance.baseUrl, "/api/v1/agent/entities?type=location&limit=1", { token: researchToken }));
  const locationEntityId = result.payload.data[0].id;
  result = await body(await request(instance.baseUrl, `/api/v1/agent/locations/${encodeURIComponent(locationEntityId)}/metadata`, { token: researchToken }));
  assert.equal(result.response.status, 200);
  assert.equal(result.payload.data.locationId, locationEntityId.replace(/^location:/, ""));

  result = await body(await request(instance.baseUrl, "/api/v1/agent/reviews?queue=temporal&limit=2", { token: researchToken }));
  assert.equal(result.response.status, 200);
  assert.equal(result.payload.meta.total, publishedGraphSummary.metadata.coverage.temporal.totalConflicts);
  assert.equal(result.payload.data.length, 2);

  result = await body(await request(instance.baseUrl, "/api/v1/agent/enrichment/proposals", {
    method: "POST", token: researchToken, headers: { "idempotency-key": crypto.randomUUID() }, body: {
      title: "Invalid private-source proposal",
      unsupported: true,
      target: { entityId: activityEntityId, entityType: "activity" },
      claims: [{
        fieldPath: "identity.token", operation: "replace", value: "unsafe", confidence: "low",
        sources: [{ url: "http://127.0.0.1/private", title: "Private", authority: "other_public" }],
      }],
    },
  }));
  assert.equal(result.response.status, 400, "Strict proposals must reject extra fields, protected paths, and private sources");

  workspaceEntityId = "workspace:organization:agent-api-verifier";
  const proposalInput = {
    title: "Add a cited workspace organization",
    summary: "Verification proposal for autonomous, evidence-backed graph enrichment.",
    target: { entityId: workspaceEntityId, entityType: "organization", create: true, label: "Agent API Verified Organization" },
    model: "verification-model",
    responseId: "response-verifier",
    traceId: "trace-verifier",
    claims: [{
      fieldPath: "identity.uei", operation: "fill_missing", value: "TESTUEI123456", confidence: "exact",
      rationale: "The cited registration record publishes this exact identifier.", observedAt: "2026-09-29T12:00:00Z",
      sources: [{
        url: "https://sam.gov/entity/TESTUEI123456/coreData", title: "SAM.gov entity registration", publisher: "U.S. General Services Administration",
        authority: "official_primary", retrievedAt: "2026-09-29T12:00:00Z", supports: "Publishes the organization identity and UEI.",
      }],
    }, {
      operation: "add_relation", confidence: "high", rationale: "The cited award record identifies the recipient.", observedAt: "2026-09-29T12:00:00Z",
      relation: { type: "activity-recipient", fromEntityId: activityEntityId, toEntityId: workspaceEntityId, attributes: { basis: "official-award" } },
      sources: [{
        url: "https://www.usaspending.gov/award/CONT_AWD_TEST", title: "USAspending award record", publisher: "U.S. Department of the Treasury",
        authority: "public_database", retrievedAt: "2026-09-29T12:00:00Z", supports: "Identifies the activity recipient.",
      }],
    }],
  };
  const proposalKey = crypto.randomUUID();
  result = await body(await request(instance.baseUrl, "/api/v1/agent/enrichment/proposals", {
    method: "POST", token: researchToken, headers: { "idempotency-key": proposalKey }, body: proposalInput,
  }));
  assert.equal(result.response.status, 201);
  const proposal = result.payload.data;
  assert.equal(proposal.status, "needs_review");
  assert.equal(proposal.version, 1);
  const proposalReplay = await request(instance.baseUrl, "/api/v1/agent/enrichment/proposals", {
    method: "POST", token: researchToken, headers: { "idempotency-key": proposalKey }, body: proposalInput,
  });
  assert.equal(proposalReplay.status, 201);
  assert.equal(proposalReplay.headers.get("idempotent-replay"), "true");

  result = await body(await request(instance.baseUrl, `/api/v1/agent/reviews/${proposal.id}`, {
    method: "PATCH", token: researchToken, headers: { "if-match": "1" }, body: { decision: "approved", note: "Research agents cannot self-approve." },
  }));
  assert.equal(result.response.status, 403, "Proposal scope must not permit self-approval");
  result = await body(await request(instance.baseUrl, "/api/v1/agent/jobs", {
    method: "POST", token: researchToken, headers: { "idempotency-key": crypto.randomUUID() }, body: { kind: "publish_proposal", proposalId: proposal.id, version: 1 },
  }));
  assert.equal(result.response.status, 403, "Proposal scope must not permit publication");

  result = await body(await request(instance.baseUrl, `/api/v1/agent/reviews/${proposal.id}`, {
    method: "PATCH", token: agentToken, headers: { "if-match": "1" }, body: { decision: "approved", note: "Citations and identifiers verified." },
  }));
  assert.equal(result.response.status, 200);
  assert.equal(result.payload.data.status, "approved");
  assert.equal(result.payload.data.version, 2);
  result = await body(await request(instance.baseUrl, `/api/v1/agent/reviews/${proposal.id}`, {
    method: "PATCH", token: agentToken, headers: { "if-match": "1" }, body: { decision: "rejected", note: "Stale decision" },
  }));
  assert.equal(result.response.status, 409, "Stale proposal review versions must be rejected");

  result = await body(await request(instance.baseUrl, "/api/v1/agent/jobs", {
    method: "POST", token: agentToken, headers: { "idempotency-key": crypto.randomUUID() }, body: { kind: "publish_proposal", proposalId: proposal.id, version: 2 },
  }));
  assert.equal(result.response.status, 201);
  assert.equal(result.payload.data.status, "completed");
  assert.deepEqual(result.payload.data.output, { targetEntityId: workspaceEntityId, claims: 1, relations: 1, sources: 2 });

  result = await body(await request(instance.baseUrl, `/api/v1/agent/entities/${encodeURIComponent(workspaceEntityId)}`, { token: researchToken }));
  assert.equal(result.response.status, 200);
  assert.equal(result.payload.data.effectiveEntity.identity.uei, "TESTUEI123456");
  result = await body(await request(instance.baseUrl, `/api/v1/agent/entities/${encodeURIComponent(workspaceEntityId)}/relations`, { token: researchToken }));
  assert.ok(result.payload.data.some((relation) => relation.type === "activity-recipient" && relation.from === activityEntityId));
  result = await body(await request(instance.baseUrl, `/api/v1/agent/evidence/claims?targetEntityId=${encodeURIComponent(workspaceEntityId)}`, { token: researchToken }));
  assert.equal(result.payload.data.length, 1);
  assert.equal(result.payload.data[0].reviewState, "applied");
  result = await body(await request(instance.baseUrl, "/api/v1/agent/sources?q=SAM.gov", { token: researchToken }));
  assert.ok(result.payload.data.some((source) => source.workspaceOverlay && /SAM\.gov entity/.test(source.title)));
  result = await body(await request(instance.baseUrl, "/api/v1/agent/graph/summary", { token: researchToken }));
  assert.deepEqual(result.payload.data.workspaceOverlay, { entities: 1, claims: 1, relations: 1, proposals: { applied: 1 } });
  result = await body(await request(instance.baseUrl, "/api/v1/agent/jobs", {
    method: "POST", token: agentToken, headers: { "idempotency-key": crypto.randomUUID() }, body: { kind: "reindex_workspace" },
  }));
  assert.equal(result.response.status, 201);
  assert.deepEqual(result.payload.data.output, { entities: 1, claims: 1, relations: 1, indexedAt: result.payload.data.output.indexedAt });

  result = await body(await request(instance.baseUrl, "/api/v1/agent/analytics?dimension=workCategory&measure=obligatedAmount&limit=10", { token: agentToken }));
  assert.equal(result.response.status, 200);
  assert.equal(result.payload.meta.dimension, "workCategory");
  assert.equal(result.payload.meta.measure, "obligatedAmount");
  assert.ok(result.payload.meta.totalRecords >= 875);
  assert.ok(result.payload.data.length > 0 && result.payload.data.length <= 10);
  for (const dimension of ["technologyArea", "organizationBranch", "organizationComponent", "organizationOffice"]) {
    result = await body(await request(instance.baseUrl, `/api/v1/agent/analytics?dimension=${dimension}&measure=records&limit=10`, { token: agentToken }));
    assert.equal(result.response.status, 200);
    assert.equal(result.payload.meta.dimension, dimension);
    assert.ok(result.payload.data.length > 0, `Agent analytics should aggregate the ${dimension} explorer dimension`);
  }

  result = await body(await request(instance.baseUrl, `/api/v1/agent/record-dispositions/${encodeURIComponent(factualRecordId)}`, {
    method: "PUT", token: agentToken, body: { disposition: "tombstoned", reason: "Agent API disposition contract" },
  }));
  assert.equal(result.response.status, 200);
  assert.equal(result.payload.data.recordId, factualRecordId);
  result = await body(await request(instance.baseUrl, "/api/v1/agent/record-dispositions", { token: agentToken }));
  assert.ok(result.payload.data.some((row) => row.recordId === factualRecordId && row.disposition === "tombstoned"));
  const dispositionDelete = await request(instance.baseUrl, `/api/v1/agent/record-dispositions/${encodeURIComponent(factualRecordId)}`, { method: "DELETE", token: agentToken });
  assert.equal(dispositionDelete.status, 204);

  const idempotencyKey = crypto.randomUUID();
  const manualInput = {
    title: "Agent-created integration test record",
    id: "AGENT-VERIFY-001",
    context: "Manual workspace record used to verify authenticated write behavior.",
    portfolio: "API verification",
    sourceSystem: "agent-api",
    start: "2026-10-01",
    potentialEnd: "2027-09-30",
    obligatedAmount: 125000,
    workCategory: "other-unclassified",
  };
  result = await body(await request(instance.baseUrl, "/api/v1/agent/records", {
    method: "POST", token: agentToken, headers: { "idempotency-key": idempotencyKey }, body: manualInput,
  }));
  assert.equal(result.response.status, 201);
  const manualRecord = result.payload.data;
  const replay = await request(instance.baseUrl, "/api/v1/agent/records", {
    method: "POST", token: agentToken, headers: { "idempotency-key": idempotencyKey }, body: manualInput,
  });
  assert.equal(replay.status, 201);
  assert.equal(replay.headers.get("idempotent-replay"), "true");
  assert.equal((await replay.json()).data.opportunityId, manualRecord.opportunityId);

  result = await body(await request(instance.baseUrl, `/api/v1/agent/records/${encodeURIComponent(manualRecord.opportunityId)}`, {
    method: "PATCH", token: agentToken, headers: { "if-match": String(manualRecord.version) }, body: { title: "Updated agent integration record" },
  }));
  assert.equal(result.response.status, 200);
  const updatedManual = result.payload.data;
  result = await body(await request(instance.baseUrl, `/api/v1/agent/records/${encodeURIComponent(manualRecord.opportunityId)}`, {
    method: "PATCH", token: agentToken, headers: { "if-match": String(manualRecord.version) }, body: { title: "Stale update" },
  }));
  assert.equal(result.response.status, 409, "Stale record versions must be rejected");
  result = await body(await request(instance.baseUrl, `/api/v1/agent/records/${encodeURIComponent(factualRecordId)}`, {
    method: "PATCH", token: agentToken, body: { title: "Forbidden evidence mutation" },
  }));
  assert.equal(result.response.status, 409, "Source-backed evidence must remain immutable");

  result = await body(await request(instance.baseUrl, `/api/v1/agent/tracking/${encodeURIComponent(factualRecordId)}`, {
    method: "PUT", token: agentToken, body: { note: "Shared agent note", reviewAt: "2026-11-15", wallboard: true },
  }));
  assert.equal(result.response.status, 201);
  const trackedVersion = result.payload.data.version;
  result = await body(await request(instance.baseUrl, `/api/v1/agent/tracking/${encodeURIComponent(factualRecordId)}`, {
    method: "PUT", token: agentToken, headers: { "if-match": String(trackedVersion) }, body: { note: "Updated shared note", reviewAt: "2026-11-20", wallboard: false },
  }));
  assert.equal(result.response.status, 200);

  const eventKey = crypto.randomUUID();
  const eventInput = { title: "Agent coordination review", startsAt: "2026-11-20T14:00", location: "Mission partner center", status: "scheduled", recordIds: [factualRecordId], attendeeIds: [ownerId], categoryIds: ["workshop"], links: [
    { id: "official", label: "Official event page", url: "https://example.test/events/coordination-review" },
    { id: "agenda", label: "Agenda", url: "https://example.test/events/coordination-review/agenda" },
  ], milestones: [
    { id: "registration", type: "registration_deadline", label: "Registration closes", occursAt: "2026-11-10", notes: "Published cutoff" },
    { id: "refund", type: "refund_deadline", label: "Last day for refunds", occursAt: "2026-11-12", notes: "Published refund policy" },
  ], wallboard: true };
  result = await body(await request(instance.baseUrl, "/api/v1/agent/events", {
    method: "POST", token: agentToken, headers: { "idempotency-key": eventKey }, body: eventInput,
  }));
  assert.equal(result.response.status, 201);
  const event = result.payload.data;
  assert.deepEqual(event.attendeeIds, [ownerId], "Event attendees must persist as stable workspace-user IDs");
  assert.equal(event.attendees[0].displayName, owner.displayName, "Event reads should resolve the current workspace-user display name");
  assert.deepEqual(event.milestones.map((milestone) => milestone.type), ["registration_deadline", "refund_deadline"], "Event milestones must persist as typed, date-backed overlays");
  assert.deepEqual(event.categoryIds, ["workshop"], "Event categories must persist as stable workspace taxonomy IDs");
  assert.deepEqual(event.links.map((link) => link.label), ["Official event page", "Agenda"], "Multiple event links must persist separately from the physical location");
  result = await body(await request(instance.baseUrl, "/api/v1/agent/events", {
    method: "POST", token: agentToken, headers: { "idempotency-key": crypto.randomUUID() }, body: { title: "Date pending industry event", wallboard: true },
  }));
  assert.equal(result.response.status, 201, "Events with a known title but unknown date must save for later research");
  assert.equal(result.payload.data.startsAt, "", "Undated events must retain an explicit empty start date instead of inventing one");
  result = await body(await request(instance.baseUrl, "/api/v1/agent/events", {
    method: "POST", token: agentToken, headers: { "idempotency-key": crypto.randomUUID() }, body: { title: "Invalid milestone", startsAt: "2026-11-20", milestones: [{ id: "custom", type: "other", occursAt: "" }] },
  }));
  assert.equal(result.response.status, 400, "Undated event milestones must be rejected rather than inferred");
  result = await body(await request(instance.baseUrl, "/api/v1/agent/events", {
    method: "POST", token: agentToken, headers: { "idempotency-key": crypto.randomUUID() }, body: { title: "Invalid event link", startsAt: "2026-11-20", links: [{ id: "bad", url: "javascript:alert(1)" }] },
  }));
  assert.equal(result.response.status, 400, "Event links must reject non-HTTP protocols");
  result = await body(await request(instance.baseUrl, "/api/v1/agent/events", {
    method: "POST", token: agentToken, headers: { "idempotency-key": crypto.randomUUID() }, body: { title: "Invalid event category", startsAt: "2026-11-20", categoryIds: ["outside-workspace"] },
  }));
  assert.equal(result.response.status, 404, "Event category assignments must stay inside the active workspace taxonomy");
  result = await body(await request(instance.baseUrl, `/api/v1/agent/events/${event.id}`, {
    method: "PATCH", token: agentToken, headers: { "if-match": String(event.version) }, body: { notes: "Validated through the Agent API" },
  }));
  assert.equal(result.response.status, 200);

  result = await body(await request(instance.baseUrl, "/api/v1/agent/activity", {
    method: "POST", token: agentToken, headers: { "idempotency-key": crypto.randomUUID() },
    body: { action: "verification_note", entityType: "workspace", detail: "Agent write path verified" },
  }));
  assert.equal(result.response.status, 201);
  result = await body(await request(instance.baseUrl, "/api/v1/agent/activity?limit=100", { token: agentToken }));
  assert.equal(result.response.status, 200);
  assert.ok(result.payload.data.some((entry) => entry.action === "verification_note"));
  result = await body(await request(instance.baseUrl, "/api/v1/agent/integrations", { token: agentToken }));
  assert.equal(result.response.status, 200);
  assert.ok(result.payload.data.length >= 5);
  result = await body(await request(instance.baseUrl, "/api/v1/agent/api-requests?limit=500", { token: agentToken }));
  assert.equal(result.response.status, 200, "Authorized operators must be able to inspect redacted API request metadata");
  assert.ok(result.payload.data.length >= 10, "The request ledger must retain authenticated Agent API calls");
  assert.ok(result.payload.data.some((entry) => entry.operation === "records.list" || entry.route?.includes("/records")), "Request logs must identify the called operation or route");
  assert.ok(result.payload.data.every((entry) => entry.traceId && Number.isFinite(Number(entry.latencyMs))), "Every request log entry must expose a trace and measured latency");
  assert.equal(result.payload.meta.retentionDays, 90);
  assert.equal(result.payload.meta.total, result.payload.meta.summary.retained, "Agent API summaries must cover the exact retained result set");
  assert.equal(result.payload.meta.summary.requests, result.payload.meta.summary.agentRequests, "This Agent API fixture must reconcile its operational lane");
  assert.equal(result.payload.meta.summary.terminalRequests, result.payload.meta.summary.succeeded + result.payload.meta.summary.failed);
  assert.match(result.payload.meta.redaction, /secrets.*prompts.*response bodies/i);
  const requestLedgerJson = JSON.stringify(result.payload.data);
  assert.doesNotMatch(requestLedgerJson, /authorization|cookie|passwordProof|requestBody|responseBody|prompt/i, "The request ledger must never expose headers, credentials, prompts, or bodies");
  result = await body(await request(instance.baseUrl, "/api/v1/agent/api-requests?limit=3", { token: agentToken }));
  assert.equal(result.payload.data.length, 3);
  assert.ok(result.payload.meta.total > result.payload.data.length, "Exact ledger totals must not collapse to the bounded response slice");
  assert.equal(result.payload.meta.summary.retained, result.payload.meta.total);
  assert.equal(result.payload.meta.summary.returned, 3);
  assert.equal(result.payload.meta.summary.truncated, true);

  await stopPages(instance);
  instance = await startPages(persistPath);
  result = await body(await request(instance.baseUrl, "/api/v1/auth/status", { cookie: ownerCookie }));
  assert.equal(result.payload.user?.email, owner.email, "Owner session must survive a Pages runtime restart");
  result = await body(await request(instance.baseUrl, "/api/v1/auth/agent-keys", {
    method: "POST", cookie: ownerCookie, body: { name: "Restart verifier", scopes: allScopes },
  }));
  const restartKeyId = result.payload.key.id;
  const restartToken = result.payload.token;
  result = await body(await request(instance.baseUrl, "/api/v1/agent/tasking", { token: restartToken }));
  assert.ok(result.payload.data.tasks.some((entry) => entry.id === "task-agent-created" && entry.version === 2), "Tasking task state must survive restart");
  assert.ok(result.payload.data.tasks.some((entry) => entry.id === "task-agent-draft" && entry.status === "draft" && entry.owner === ""), "Blank-owner draft state must survive restart");
  assert.ok(result.payload.data.workstreams.some((entry) => entry.id === "workstream-onedrive"), "Tasking workstreams must survive restart");
  assert.ok(result.payload.data.relationships.some((entry) => entry.id === "relationship-onedrive-file"), "Tasking relationships must survive restart");
  assert.equal(result.payload.data.sourceItems.length, 2, "Normalized source metadata must survive restart");
  result = await body(await request(instance.baseUrl, "/api/v1/agent/tracking", { token: restartToken }));
  assert.ok(result.payload.data.some((entry) => entry.recordId === factualRecordId && entry.note === "Updated shared note"), "Tracking state must survive restart");
  result = await body(await request(instance.baseUrl, "/api/v1/agent/events", { token: restartToken }));
  assert.ok(result.payload.data.some((entry) => entry.id === event.id && entry.notes === "Validated through the Agent API" && entry.milestones?.length === 2 && entry.links?.length === 2 && entry.categoryIds?.[0] === "workshop"), "Event milestones, links, and categories must survive restart with the event state");
  result = await body(await request(instance.baseUrl, `/api/v1/agent/entities/${encodeURIComponent(workspaceEntityId)}`, { token: restartToken }));
  assert.equal(result.response.status, 200);
  assert.equal(result.payload.data.effectiveEntity.identity.uei, "TESTUEI123456", "Approved intelligence overlays must survive runtime restart");

  await request(instance.baseUrl, `/api/v1/agent/events/${event.id}`, { method: "DELETE", token: restartToken });
  await request(instance.baseUrl, `/api/v1/agent/tracking/${encodeURIComponent(factualRecordId)}`, { method: "DELETE", token: restartToken });
  await request(instance.baseUrl, `/api/v1/agent/records/${encodeURIComponent(updatedManual.opportunityId)}`, { method: "DELETE", token: restartToken });
  await request(instance.baseUrl, `/api/v1/auth/agent-keys/${restartKeyId}`, { method: "DELETE", cookie: ownerCookie });
  await request(instance.baseUrl, `/api/v1/auth/agent-keys/${researchKeyId}`, { method: "DELETE", cookie: ownerCookie });
  await request(instance.baseUrl, `/api/v1/auth/agent-keys/${firstKeyId}`, { method: "DELETE", cookie: ownerCookie });
  result = await body(await request(instance.baseUrl, "/api/v1/agent/capabilities", { token: restartToken }));
  assert.equal(result.response.status, 401, "Revoked agent credentials must fail immediately");

  console.log("Verified Agent API 1.3.0 discovery, real-data-only Tasking CRUD, native drafts, normalized local-source synchronization, dynamic relationships, graph traversal, cited proposals, separate review/publish scopes, atomic workspace overlays, evidence/source reads, redacted request logging, manual-record CRUD, shared tracking/events, stable-ID integrity, CSRF protection, audit activity, idempotency, version conflicts, restart persistence, and revocation");
} finally {
  await stopPages(instance);
  rmSync(persistPath, { recursive: true, force: true });
}
