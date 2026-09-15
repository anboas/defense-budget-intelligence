import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { resolve } from "node:path";

mkdirSync("test-results", { recursive: true });

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

async function startPages(persistPath) {
  const port = await freePort();
  const baseUrl = `http://127.0.0.1:${port}/`;
  const output = [];
  const child = spawn("npx", [
    "wrangler", "pages", "dev", "dist", "--ip", "127.0.0.1", "--port", String(port),
    "--persist-to", persistPath, "--log-level", "error",
  ], { detached: true, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout.on("data", (chunk) => output.push(chunk.toString()));
  child.stderr.on("data", (chunk) => output.push(chunk.toString()));
  try { await waitForStatus(baseUrl); }
  catch (error) {
    try { process.kill(-child.pid, "SIGTERM"); } catch { child.kill("SIGTERM"); }
    throw new Error(`${error.message}\n${output.join("").slice(-12_000)}`, { cause: error });
  }
  return { child, baseUrl };
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

const persistPath = resolve(mkdtempSync("test-results/agent-api-"));
let instance;
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
    "activity:read", "activity:write", "integrations:read",
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
  assert.deepEqual(result.payload.data.resources, ["records", "analytics", "tracking", "events", "event-categories", "activity", "api-requests", "integrations"]);

  result = await body(await request(instance.baseUrl, "/api/v1/agent/openapi.json", { token: agentToken }));
  assert.equal(result.response.status, 200);
  assert.equal(result.payload.openapi, "3.1.0");

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

  result = await body(await request(instance.baseUrl, "/api/v1/agent/analytics?dimension=workCategory&measure=obligatedAmount&limit=10", { token: agentToken }));
  assert.equal(result.response.status, 200);
  assert.equal(result.payload.meta.dimension, "workCategory");
  assert.equal(result.payload.meta.measure, "obligatedAmount");
  assert.ok(result.payload.meta.totalRecords >= 875);
  assert.ok(result.payload.data.length > 0 && result.payload.data.length <= 10);

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
  assert.match(result.payload.meta.redaction, /secrets.*prompts.*response bodies/i);
  const requestLedgerJson = JSON.stringify(result.payload.data);
  assert.doesNotMatch(requestLedgerJson, /authorization|cookie|passwordProof|requestBody|responseBody|prompt/i, "The request ledger must never expose headers, credentials, prompts, or bodies");

  await stopPages(instance);
  instance = await startPages(persistPath);
  result = await body(await request(instance.baseUrl, "/api/v1/auth/status", { cookie: ownerCookie }));
  assert.equal(result.payload.user?.email, owner.email, "Owner session must survive a Pages runtime restart");
  result = await body(await request(instance.baseUrl, "/api/v1/auth/agent-keys", {
    method: "POST", cookie: ownerCookie, body: { name: "Restart verifier", scopes: allScopes },
  }));
  const restartKeyId = result.payload.key.id;
  const restartToken = result.payload.token;
  result = await body(await request(instance.baseUrl, "/api/v1/agent/tracking", { token: restartToken }));
  assert.ok(result.payload.data.some((entry) => entry.recordId === factualRecordId && entry.note === "Updated shared note"), "Tracking state must survive restart");
  result = await body(await request(instance.baseUrl, "/api/v1/agent/events", { token: restartToken }));
  assert.ok(result.payload.data.some((entry) => entry.id === event.id && entry.notes === "Validated through the Agent API" && entry.milestones?.length === 2 && entry.links?.length === 2 && entry.categoryIds?.[0] === "workshop"), "Event milestones, links, and categories must survive restart with the event state");

  await request(instance.baseUrl, `/api/v1/agent/events/${event.id}`, { method: "DELETE", token: restartToken });
  await request(instance.baseUrl, `/api/v1/agent/tracking/${encodeURIComponent(factualRecordId)}`, { method: "DELETE", token: restartToken });
  await request(instance.baseUrl, `/api/v1/agent/records/${encodeURIComponent(updatedManual.opportunityId)}`, { method: "DELETE", token: restartToken });
  await request(instance.baseUrl, `/api/v1/auth/agent-keys/${restartKeyId}`, { method: "DELETE", cookie: ownerCookie });
  await request(instance.baseUrl, `/api/v1/auth/agent-keys/${firstKeyId}`, { method: "DELETE", cookie: ownerCookie });
  result = await body(await request(instance.baseUrl, "/api/v1/agent/capabilities", { token: restartToken }));
  assert.equal(result.response.status, 401, "Revoked agent credentials must fail immediately");

  console.log("Verified authenticated Agent API discovery, scoped credentials, evidence and analytical reads, redacted request logging, manual-record CRUD, shared tracking/events, stable-ID integrity, CSRF protection, audit activity, idempotency, version conflicts, restart persistence, and revocation");
} finally {
  await stopPages(instance);
  rmSync(persistPath, { recursive: true, force: true });
}
