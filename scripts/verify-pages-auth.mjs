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
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 200));
  }
  throw lastError || new Error(`Timed out waiting for ${baseUrl}`);
}

async function startPages(persistPath) {
  const port = await freePort();
  const baseUrl = `http://127.0.0.1:${port}/`;
  const output = [];
  const child = spawn("npx", [
    "wrangler",
    "pages",
    "dev",
    "dist",
    "--ip",
    "127.0.0.1",
    "--port",
    String(port),
    "--persist-to",
    persistPath,
    "--binding",
    "DBI_CREDENTIAL_ENCRYPTION_KEY=verification-only-encryption-material-0001",
    "--binding",
    "DBI_EVENT_AI_MOCK_MODE=true",
    "--log-level",
    "error",
  ], { detached: true, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout.on("data", (chunk) => output.push(chunk.toString()));
  child.stderr.on("data", (chunk) => output.push(chunk.toString()));
  try {
    await waitForStatus(baseUrl);
  } catch (error) {
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {
      child.kill("SIGTERM");
    }
    throw new Error(`${error.message}\n${output.join("").slice(-12_000)}`, { cause: error });
  }
  return { child, baseUrl, output };
}

async function stopPages(instance) {
  if (!instance) return;
  try {
    process.kill(-instance.child.pid, "SIGTERM");
  } catch {
    if (instance.child.exitCode === null) instance.child.kill("SIGTERM");
  }
  await Promise.race([
    new Promise((resolveExit) => instance.child.once("exit", resolveExit)),
    new Promise((resolveTimeout) => setTimeout(resolveTimeout, 3_000)),
  ]);
  try {
    process.kill(-instance.child.pid, "SIGKILL");
  } catch {
    if (instance.child.exitCode === null) instance.child.kill("SIGKILL");
  }
  instance.child.stdout?.destroy();
  instance.child.stderr?.destroy();
}

function claimPayload(index) {
  return {
    email: `owner-${index}@example.test`,
    displayName: `Owner ${index}`,
    title: "Platform administrator",
    passwordSalt: String(index).padStart(2, "0").repeat(24),
    passwordProof: String(index + 1).padStart(2, "0").repeat(32),
  };
}

function userPayload(index, role = "viewer") {
  return {
    email: `user-${index}@example.test`,
    displayName: `User ${index}`,
    title: "Budget analyst",
    role,
    passwordSalt: String(index + 10).padStart(2, "0").repeat(24),
    passwordProof: String(index + 11).padStart(2, "0").repeat(32),
  };
}

function cookieFrom(response) {
  return String(response.headers.get("set-cookie") || "").split(";")[0];
}

async function apiRequest(baseUrl, path, { method = "GET", body, cookie = "", origin, headers: suppliedHeaders = {} } = {}) {
  const headers = { ...suppliedHeaders };
  if (body !== undefined) headers["content-type"] = "application/json";
  if (cookie) headers.cookie = cookie;
  if (origin) headers.origin = origin;
  return fetch(new URL(path, baseUrl), {
    method,
    headers,
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  });
}

async function verifyApiLifecycle(persistPath) {
  let instance = await startPages(persistPath);
  const { baseUrl } = instance;
  try {
    let response = await apiRequest(baseUrl, "/api/v1/auth/status");
    assert.match(response.headers.get("content-security-policy") || "", /frame-ancestors 'none'/, "Pages responses must prevent framing through CSP");
    assert.equal(response.headers.get("x-frame-options"), "DENY", "Pages responses must prevent legacy framing");
    assert.match(response.headers.get("strict-transport-security") || "", /max-age=63072000/, "Pages responses must advertise long-lived HTTPS transport security");
    assert.match(response.headers.get("permissions-policy") || "", /camera=\(\)/, "Pages responses must disable unnecessary browser capabilities");
    assert.equal(response.headers.get("x-content-type-options"), "nosniff", "Pages responses must disable MIME sniffing");
    assert.equal(response.headers.get("cross-origin-opener-policy"), "same-origin", "Pages responses must isolate the top-level browsing context");
    assert.equal(response.headers.get("cross-origin-resource-policy"), "same-origin", "Pages responses must restrict cross-origin resource reuse");
    assert.equal(response.headers.get("origin-agent-cluster"), "?1", "Pages responses must request origin-keyed process isolation");
    assert.equal(response.headers.get("cache-control"), "no-store", "Account API responses must never be cached");
    assert.deepEqual(await response.json(), {
      authVersion: "dbi-pages-auth-v1",
      enabled: true,
      required: true,
      claimed: false,
      registrationEnabled: false,
      user: null,
    });

    response = await apiRequest(baseUrl, "/api/v1/auth/claim", {
      method: "POST",
      body: claimPayload(8),
      origin: "https://cross-origin.example",
    });
    assert.equal(response.status, 403, "Cross-origin first claim must be rejected");

    const candidates = [claimPayload(1), claimPayload(2)];
    const claimResponses = await Promise.all(candidates.map((payload) => apiRequest(baseUrl, "/api/v1/auth/claim", {
      method: "POST",
      body: payload,
      origin: baseUrl.slice(0, -1),
    })));
    assert.deepEqual(claimResponses.map((item) => item.status).sort(), [201, 409], "Concurrent claims must produce exactly one owner");
    const winningIndex = claimResponses.findIndex((item) => item.status === 201);
    const winner = candidates[winningIndex];
    const winningResponse = claimResponses[winningIndex];
    const ownerCookie = cookieFrom(winningResponse);
    const setCookie = winningResponse.headers.get("set-cookie") || "";
    assert.match(setCookie, /HttpOnly/i, "D1 session must be HttpOnly");
    assert.match(setCookie, /SameSite=Strict/i, "D1 session must be SameSite Strict");
    assert.match(setCookie, /Secure/i, "Pages session must be Secure");

    response = await apiRequest(baseUrl, "/api/v1/auth/claim", {
      method: "POST",
      body: "not-json",
      origin: baseUrl.slice(0, -1),
    });
    assert.equal(response.status, 409, "A claimed workspace must reject before parsing claimant input");

    response = await apiRequest(baseUrl, "/api/v1/auth/status", { cookie: ownerCookie });
    let body = await response.json();
    assert.equal(body.claimed, true);
    assert.equal(body.user.email, winner.email);
    assert.equal(body.user.role, "Super user");
    assert.equal(body.user.roleId, "super_user");
    assert.equal(body.user.canManageAccounts, true);
    assert.equal(body.user.canManageWorkspace, true);
    assert.equal(body.user.canManageUsers, true);
    assert.equal(body.user.canManageWorkspaces, true);
    assert.equal(body.user.activeWorkspace.name, "Defense budget");
    const ownerId = body.user.id;
    const defaultWorkspaceId = body.user.activeWorkspace.id;

    response = await apiRequest(baseUrl, "/api/v1/client-errors");
    body = await response.json();
    assert.equal(response.status, 200, "Client-error health must remain available without exposing report details");
    assert.equal(body.status, "ok");
    response = await apiRequest(baseUrl, "/api/v1/client-errors", {
      method: "POST", body: { reportId: "11111111-1111-4111-8111-111111111111", kind: "render_error", name: "TypeError", message: "Charts failed sk-sensitive-client-value", route: "/#/budget-spend/explorer?secret=value&spendView=charts", asset: "TransactionAnalytics.js", stack: "TypeError at https://example.test/app.js?token=secret", componentStack: "at TransactionAnalytics" },
      cookie: ownerCookie, origin: baseUrl.slice(0, -1),
    });
    assert.equal(response.status, 202, "Authenticated browser render failures must enter the retained request ledger");
    response = await apiRequest(baseUrl, "/api/v1/client-errors", { method: "POST", body: { kind: "render_error", message: "cross origin" }, cookie: ownerCookie, origin: "https://attacker.example" });
    assert.equal(response.status, 403, "Client-error ingestion must reject cross-origin writes");
    response = await apiRequest(baseUrl, "/api/v1/client-errors");
    body = await response.json();
    assert.equal(body.status, "degraded");
    assert.equal(body.count24h, 1);

    response = await apiRequest(baseUrl, "/api/v1/auth/directory", { cookie: ownerCookie });
    body = await response.json();
    assert.deepEqual(body.users.map((user) => user.displayName), [winner.displayName], "The attendee directory should initially contain the active owner only");
    assert.equal(body.users[0].roleId, "super_user", "The workspace directory must expose the member's workspace role identifier");
    assert.equal(body.users[0].role, "Super user", "The workspace directory must expose the member's public workspace role label");

    response = await apiRequest(baseUrl, "/api/v1/auth/users");
    assert.equal(response.status, 401, "Anonymous callers must not enumerate workspace users");
    response = await apiRequest(baseUrl, "/api/v1/auth/activity");
    assert.equal(response.status, 401, "Anonymous callers must not enumerate user activity");

    const viewer = userPayload(4);
    response = await apiRequest(baseUrl, "/api/v1/auth/users", {
      method: "POST",
      body: viewer,
      cookie: ownerCookie,
      origin: baseUrl.slice(0, -1),
    });
    assert.equal(response.status, 201, "Super user must be able to create a human account");
    body = await response.json();
    const viewerId = body.user.id;
    assert.equal(body.user.role, "Viewer");
    assert.equal(body.user.mustChangePassword, true);

    response = await apiRequest(baseUrl, "/api/v1/auth/activity", { method: "POST", body: { eventType: "page_visit", surface: "users", ignoredSecret: "never-store-this" }, cookie: ownerCookie, origin: baseUrl.slice(0, -1) });
    assert.equal(response.status, 202, "Authenticated page visits must enter the bounded activity ledger");
    response = await apiRequest(baseUrl, "/api/v1/auth/activity", { method: "POST", body: { eventType: "page_visit", surface: "users" }, cookie: ownerCookie, origin: "https://attacker.example" });
    assert.equal(response.status, 403, "Page-visit telemetry must reject cross-origin writes");
    response = await apiRequest(baseUrl, "/api/v1/auth/activity", { cookie: ownerCookie });
    assert.equal(response.status, 200, "Super user must be able to read retained user activity");
    body = await response.json();
    assert.ok(body.activities.some((entry) => entry.action === "account_created" && entry.targetId === viewerId), "Account creation must be retained as a server-authored action");
    assert.ok(body.activities.some((entry) => entry.eventType === "page_visit" && entry.surface === "users"), "Page visits must retain only their canonical surface");
    assert.doesNotMatch(JSON.stringify(body), /never-store-this/, "User activity must exclude arbitrary browser payload values");

    response = await apiRequest(baseUrl, "/api/v1/auth/directory", { cookie: ownerCookie });
    body = await response.json();
    assert.equal(body.users.length, 2, "The attendee directory should include newly created active users");
    assert.equal(body.users.find((user) => user.id === viewerId)?.role, "Viewer", "The directory must retain each member's workspace-scoped role");

    response = await apiRequest(baseUrl, "/api/v1/auth/users", { cookie: ownerCookie });
    body = await response.json();
    assert.equal(body.users.length, 2, "User inventory must retain owner and managed account");
    assert.equal(body.users[0].isOwner, true, "Super user must remain the immutable owner");

    response = await apiRequest(baseUrl, "/api/v1/auth/login", {
      method: "POST",
      body: { email: viewer.email, passwordProof: viewer.passwordProof },
      origin: baseUrl.slice(0, -1),
    });
    assert.equal(response.status, 200, "Managed user must authenticate with the temporary password");
    let viewerCookie = cookieFrom(response);
    body = await response.json();
    assert.equal(body.user.mustChangePassword, true);

    response = await apiRequest(baseUrl, "/api/v1/auth/emulation", {
      method: "POST", body: { userId: viewerId }, cookie: ownerCookie, origin: baseUrl.slice(0, -1),
    });
    assert.equal(response.status, 200, "The Super user must be able to inspect an active account before first-login setup is complete");
    body = await response.json();
    assert.equal(body.user.isEmulating, true);
    assert.equal(body.user.mustChangePassword, false, "Emulation must not force the real actor through the target user's password setup gate");
    response = await apiRequest(baseUrl, "/api/v1/agent/records?limit=1", { cookie: ownerCookie });
    assert.equal(response.status, 200, "Pre-setup emulation must expose the target role's effective read access");
    response = await apiRequest(baseUrl, "/api/v1/auth/emulation", { method: "DELETE", cookie: ownerCookie, origin: baseUrl.slice(0, -1) });
    assert.equal(response.status, 200);

    response = await apiRequest(baseUrl, "/api/v1/agent/records?limit=1", { cookie: viewerCookie });
    assert.equal(response.status, 403, "Temporary-password sessions must not access workspace data before replacement");

    const viewerPasswordSalt = "ef".repeat(24);
    const viewerPasswordProof = "ab".repeat(32);
    response = await apiRequest(baseUrl, "/api/v1/auth/password", {
      method: "POST",
      body: { currentPasswordProof: viewer.passwordProof, newPasswordSalt: viewerPasswordSalt, newPasswordProof: viewerPasswordProof },
      cookie: viewerCookie,
      origin: baseUrl.slice(0, -1),
    });
    assert.equal(response.status, 200, "Managed user must be able to replace a temporary password");
    viewerCookie = cookieFrom(response);
    body = await response.json();
    assert.equal(body.user.mustChangePassword, false);

    response = await apiRequest(baseUrl, "/api/v1/agent/records?limit=1", { cookie: viewerCookie });
    assert.equal(response.status, 200, "Viewer must retain workspace read access");
    response = await apiRequest(baseUrl, "/api/v1/agent/tracking/test-record", {
      method: "PUT",
      body: { note: "Viewer write attempt" },
      cookie: viewerCookie,
      origin: baseUrl.slice(0, -1),
    });
    assert.equal(response.status, 403, "Viewer writes must be rejected server-side");
    response = await apiRequest(baseUrl, "/api/v1/auth/users", { cookie: viewerCookie });
    assert.equal(response.status, 403, "Viewer must not enumerate or manage human accounts");
    response = await apiRequest(baseUrl, "/api/v1/auth/activity", { cookie: viewerCookie });
    assert.equal(response.status, 403, "Only the real Super user may enumerate user activity");
    response = await apiRequest(baseUrl, "/api/v1/auth/directory", { cookie: viewerCookie });
    assert.equal(response.status, 200, "Signed-in viewers may read the minimal active-user directory used by event filters");
    response = await apiRequest(baseUrl, "/api/v1/agent/event-categories", { cookie: viewerCookie });
    assert.equal(response.status, 200, "Viewers may read the workspace taxonomy used by event filters");
    response = await apiRequest(baseUrl, "/api/v1/agent/event-categories", {
      method: "POST",
      body: { name: "Viewer-created category" },
      cookie: viewerCookie,
      origin: baseUrl.slice(0, -1),
    });
    assert.equal(response.status, 403, "Only workspace managers may change the event taxonomy");

    response = await apiRequest(baseUrl, `/api/v1/auth/users/${encodeURIComponent(viewerId)}`, {
      method: "PATCH",
      body: { email: viewer.email, displayName: viewer.displayName, title: viewer.title, role: "analyst", status: "active" },
      cookie: ownerCookie,
      origin: baseUrl.slice(0, -1),
    });
    assert.equal(response.status, 200);
    body = await response.json();
    assert.equal(body.user.role, "Viewer", "Global account updates must not mutate workspace authority");
    response = await apiRequest(baseUrl, `/api/v1/auth/workspace-admin/workspaces/${defaultWorkspaceId}/members`, {
      method: "POST", body: { userId: viewerId, role: "analyst" }, cookie: ownerCookie, origin: baseUrl.slice(0, -1),
    });
    assert.equal(response.status, 200, "Workspace roles must change through the workspace membership boundary");

    const createTeam = async (name) => {
      const created = await apiRequest(baseUrl, "/api/v1/auth/teams", {
        method: "POST", body: { name, description: `${name} calendar overlay` }, cookie: ownerCookie, origin: baseUrl.slice(0, -1),
      });
      assert.equal(created.status, 201, `Super user must create the ${name} team`);
      return (await created.json()).team;
    };
    const hrTeam = await createTeam("Human resources");
    const bdTeam = await createTeam("Business development");
    response = await apiRequest(baseUrl, `/api/v1/auth/teams/${hrTeam.id}/members`, {
      method: "PUT", body: { userIds: [viewerId] }, cookie: ownerCookie, origin: baseUrl.slice(0, -1),
    });
    assert.equal(response.status, 200, "Workspace managers must assign members to teams");

    const createScopedEvent = async (key, title, teamIds = []) => {
      const created = await apiRequest(baseUrl, "/api/v1/agent/events", {
        method: "POST", body: { title, startsAt: "2027-01-15T09:00", teamIds }, cookie: ownerCookie,
        origin: baseUrl.slice(0, -1), headers: { "idempotency-key": key },
      });
      assert.equal(created.status, 201, `Super user must create ${title}`);
      return (await created.json()).data;
    };
    const workspaceEvent = await createScopedEvent("team-wide-event", "Workspace-wide verification");
    const hrEvent = await createScopedEvent("team-hr-event", "HR-only verification", [hrTeam.id]);
    const bdEvent = await createScopedEvent("team-bd-event", "BD-only verification", [bdTeam.id]);

    response = await apiRequest(baseUrl, "/api/v1/agent/events", { cookie: viewerCookie });
    body = await response.json();
    assert.deepEqual(body.data.map((event) => event.id).filter((id) => [workspaceEvent.id, hrEvent.id, bdEvent.id].includes(id)).sort(), [hrEvent.id, workspaceEvent.id].sort(), "A team member must see workspace-wide events plus their team overlay only");
    response = await apiRequest(baseUrl, "/api/v1/auth/teams", { cookie: viewerCookie });
    body = await response.json();
    assert.deepEqual(body.teams.map((team) => team.id), [hrTeam.id], "Non-managers must not enumerate teams outside their membership");

    response = await apiRequest(baseUrl, `/api/v1/auth/teams/${bdTeam.id}/members`, {
      method: "PUT", body: { userIds: [viewerId] }, cookie: ownerCookie, origin: baseUrl.slice(0, -1),
    });
    assert.equal(response.status, 200);
    response = await apiRequest(baseUrl, "/api/v1/agent/events", { cookie: viewerCookie });
    body = await response.json();
    assert.deepEqual(body.data.map((event) => event.id).filter((id) => [workspaceEvent.id, hrEvent.id, bdEvent.id].includes(id)).sort(), [bdEvent.id, hrEvent.id, workspaceEvent.id].sort(), "A multi-team member must see the union of their overlays");
    response = await apiRequest(baseUrl, `/api/v1/auth/teams/${bdTeam.id}/members`, {
      method: "PUT", body: { userIds: [] }, cookie: ownerCookie, origin: baseUrl.slice(0, -1),
    });
    assert.equal(response.status, 200);

    response = await apiRequest(baseUrl, "/api/v1/auth/emulation", {
      method: "POST", body: { userId: viewerId }, cookie: ownerCookie, origin: baseUrl.slice(0, -1),
    });
    assert.equal(response.status, 200, "The real Super user must be able to emulate an active managed user");
    body = await response.json();
    assert.equal(body.user.isEmulating, true);
    assert.equal(body.user.id, viewerId);
    assert.equal(body.user.actor.id, ownerId, "Emulation must retain the real actor identity");
    response = await apiRequest(baseUrl, "/api/v1/agent/events", { cookie: ownerCookie });
    body = await response.json();
    assert.deepEqual(body.data.map((event) => event.id).filter((id) => [workspaceEvent.id, hrEvent.id, bdEvent.id].includes(id)).sort(), [hrEvent.id, workspaceEvent.id].sort(), "Emulation must use the target user's team visibility instead of Super user bypass");
    response = await apiRequest(baseUrl, "/api/v1/auth/teams", { cookie: ownerCookie });
    assert.deepEqual((await response.json()).teams.map((team) => team.id), [hrTeam.id], "Emulation must not leak teams outside the target membership");
    response = await apiRequest(baseUrl, "/api/v1/auth/profile", {
      method: "PATCH", body: { displayName: "Emulated mutation" }, cookie: ownerCookie, origin: baseUrl.slice(0, -1),
    });
    assert.equal(response.status, 403, "Identity changes must be blocked during emulation");
    response = await apiRequest(baseUrl, "/api/v1/auth/emulation", { method: "DELETE", cookie: ownerCookie, origin: baseUrl.slice(0, -1) });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).user.isEmulating, false, "Exiting emulation must restore the real Super user");

    response = await apiRequest(baseUrl, `/api/v1/auth/teams/${hrTeam.id}`, { method: "DELETE", cookie: ownerCookie, origin: baseUrl.slice(0, -1) });
    assert.equal(response.status, 409, "A team assigned to events must not be deleted because that would broaden visibility");
    for (const event of [workspaceEvent, hrEvent, bdEvent]) {
      response = await apiRequest(baseUrl, `/api/v1/agent/events/${event.id}`, { method: "DELETE", cookie: ownerCookie, origin: baseUrl.slice(0, -1) });
      assert.equal(response.status, 204);
    }
    for (const team of [hrTeam, bdTeam]) {
      response = await apiRequest(baseUrl, `/api/v1/auth/teams/${team.id}`, { method: "DELETE", cookie: ownerCookie, origin: baseUrl.slice(0, -1) });
      assert.equal(response.status, 204);
    }

    response = await apiRequest(baseUrl, `/api/v1/auth/users/${encodeURIComponent(viewerId)}`, {
      method: "PATCH",
      body: { email: viewer.email, displayName: viewer.displayName, title: viewer.title, role: "analyst", status: "suspended" },
      cookie: ownerCookie,
      origin: baseUrl.slice(0, -1),
    });
    assert.equal(response.status, 200);
    response = await apiRequest(baseUrl, "/api/v1/auth/status", { cookie: viewerCookie });
    assert.equal((await response.json()).user, null, "Suspension must revoke existing sessions immediately");
    response = await apiRequest(baseUrl, "/api/v1/auth/directory", { cookie: ownerCookie });
    assert.equal((await response.json()).users.some((user) => user.id === viewerId), false, "Suspended users must disappear from attendee choices");
    response = await apiRequest(baseUrl, "/api/v1/auth/login", {
      method: "POST",
      body: { email: viewer.email, passwordProof: viewerPasswordProof },
      origin: baseUrl.slice(0, -1),
    });
    assert.equal(response.status, 401, "Suspended accounts must not sign in");

    const resetProof = "bc".repeat(32);
    const resetSalt = "de".repeat(24);
    response = await apiRequest(baseUrl, `/api/v1/auth/users/${encodeURIComponent(viewerId)}`, {
      method: "PATCH",
      body: { email: viewer.email, displayName: viewer.displayName, title: viewer.title, role: "analyst", status: "active" },
      cookie: ownerCookie,
      origin: baseUrl.slice(0, -1),
    });
    assert.equal(response.status, 200);
    response = await apiRequest(baseUrl, `/api/v1/auth/users/${encodeURIComponent(viewerId)}/password`, {
      method: "POST",
      body: { passwordSalt: resetSalt, passwordProof: resetProof },
      cookie: ownerCookie,
      origin: baseUrl.slice(0, -1),
    });
    assert.equal(response.status, 200, "Administrator must be able to reset a managed user's password");
    response = await apiRequest(baseUrl, "/api/v1/auth/login", {
      method: "POST",
      body: { email: viewer.email, passwordProof: resetProof },
      origin: baseUrl.slice(0, -1),
    });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).user.mustChangePassword, true, "Administrator reset must require password replacement at next sign-in");

    const correctConfig = await apiRequest(baseUrl, "/api/v1/auth/login-config", {
      method: "POST",
      body: { email: winner.email },
      origin: baseUrl.slice(0, -1),
    }).then((item) => item.json());
    const unknownConfig = await apiRequest(baseUrl, "/api/v1/auth/login-config", {
      method: "POST",
      body: { email: "unknown@example.test" },
      origin: baseUrl.slice(0, -1),
    }).then((item) => item.json());
    assert.equal(correctConfig.passwordSalt, winner.passwordSalt);
    assert.equal(unknownConfig.passwordSalt.length, winner.passwordSalt.length);
    assert.notEqual(unknownConfig.passwordSalt, winner.passwordSalt);

    response = await apiRequest(baseUrl, "/api/v1/auth/login", {
      method: "POST",
      body: { email: "unknown@example.test", passwordProof: winner.passwordProof },
      origin: baseUrl.slice(0, -1),
    });
    assert.equal(response.status, 401);
    assert.equal((await response.json()).error, "Email or password is incorrect");

    response = await apiRequest(baseUrl, "/api/v1/auth/login", {
      method: "POST",
      body: { email: winner.email, passwordProof: winner.passwordProof },
      origin: baseUrl.slice(0, -1),
    });
    assert.equal(response.status, 200);
    const secondCookie = cookieFrom(response);

    response = await apiRequest(baseUrl, "/api/v1/auth/profile", {
      method: "PATCH",
      body: { displayName: "D1 Workspace Owner", title: "Analytics administrator" },
      cookie: ownerCookie,
      origin: baseUrl.slice(0, -1),
    });
    assert.equal(response.status, 200);
    body = await response.json();
    assert.equal(body.user.displayName, "D1 Workspace Owner");
    assert.equal(body.user.title, "Analytics administrator");

    const avatarDataUrl = "data:image/png;base64,iVBORw0KGgo=";
    response = await apiRequest(baseUrl, "/api/v1/auth/profile", {
      method: "PATCH",
      body: { displayName: "D1 Workspace Owner", title: "Analytics administrator", avatarDataUrl },
      cookie: ownerCookie,
      origin: baseUrl.slice(0, -1),
    });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).user.avatarDataUrl, avatarDataUrl, "Profile pictures must persist through the account API");
    response = await apiRequest(baseUrl, "/api/v1/agent/event-categories", { cookie: ownerCookie });
    assert.equal(response.status, 200);
    body = await response.json();
    assert.equal(body.data.length, 6, "The initial workspace must expose its managed event taxonomy");
    response = await apiRequest(baseUrl, "/api/v1/agent/event-categories", {
      method: "POST", cookie: ownerCookie, origin: baseUrl.slice(0, -1),
      body: { name: "Customer forum", description: "Customer-led mission and roadmap sessions" },
    });
    assert.equal(response.status, 201, "Workspace managers must be able to create event categories");
    body = await response.json();
    const customerForumCategoryId = body.data.id;
    response = await apiRequest(baseUrl, "/api/v1/agent/events", {
      method: "POST", cookie: ownerCookie, origin: baseUrl.slice(0, -1), headers: { "idempotency-key": "avatar-event-verification" },
      body: { title: "Avatar propagation verification", startsAt: "2027-02-01T09:00", endsAt: "2027-02-01T10:00", location: "Mission center", attendeeIds: [ownerId], categoryIds: [customerForumCategoryId], links: [
        { id: "official", label: "Official page", url: "https://example.test/customer-forum" },
        { id: "registration", label: "Registration", url: "https://example.test/customer-forum/register" },
      ] },
    });
    assert.equal(response.status, 201);
    response = await apiRequest(baseUrl, "/api/v1/agent/events", { cookie: ownerCookie });
    assert.equal(response.status, 200);
    body = await response.json();
    const ownedEventAttendee = body.data.find((event) => event.title === "Avatar propagation verification")?.attendees?.find((attendee) => attendee.id === ownerId);
    assert.equal(ownedEventAttendee?.avatarDataUrl, avatarDataUrl, "Calendar attendee payloads must carry the current profile image");
    const categorizedEvent = body.data.find((event) => event.title === "Avatar propagation verification");
    assert.deepEqual(categorizedEvent?.categoryIds, [customerForumCategoryId], "Event category assignments must be workspace-scoped and stable");
    assert.deepEqual(categorizedEvent?.links?.map((link) => link.label), ["Official page", "Registration"], "Event links must persist independently from the venue field");
    response = await apiRequest(baseUrl, `/api/v1/agent/event-categories/${customerForumCategoryId}`, {
      method: "DELETE", cookie: ownerCookie, origin: baseUrl.slice(0, -1),
    });
    assert.equal(response.status, 409, "Assigned event categories must not be deleted out from under events");

    const personalOpenAiKey = "sk-verification_personal_000000000001";
    const workspaceOpenAiKey = "sk-verification_workspace_000000000002";
    response = await apiRequest(baseUrl, "/api/v1/auth/openai-keys", { cookie: ownerCookie });
    assert.equal(response.status, 200);
    body = await response.json();
    assert.equal(body.capability.encryptionReady, true, "D1 must advertise the configured credential vault");
    assert.equal(body.capability.queryRuntimeEnabled, true, "The encrypted credential vault must advertise the enabled AI runtime");
    assert.equal(body.capability.loggingReady, true, "Credential management must advertise the redacted request ledger");
    assert.equal(body.capability.retentionDays, 90);
    response = await apiRequest(baseUrl, "/api/v1/auth/openai-keys", {
      method: "POST", cookie: ownerCookie, origin: baseUrl.slice(0, -1),
      body: { scope: "user", label: "Owner personal", apiKey: personalOpenAiKey, isDefault: true },
    });
    assert.equal(response.status, 201, "Users must be able to save a personal OpenAI key");
    body = await response.json();
    const personalOpenAiKeyId = body.key.id;
    assert.equal(body.key.lastFour, "0001");
    assert.doesNotMatch(JSON.stringify(body), new RegExp(personalOpenAiKey), "Credential responses must never echo a personal secret");
    response = await apiRequest(baseUrl, "/api/v1/auth/openai-keys", {
      method: "POST", cookie: ownerCookie, origin: baseUrl.slice(0, -1),
      body: { scope: "workspace", label: "Workspace default", apiKey: workspaceOpenAiKey, isDefault: true },
    });
    assert.equal(response.status, 201, "Workspace managers must be able to save a workspace OpenAI key");
    body = await response.json();
    const workspaceOpenAiKeyId = body.key.id;
    assert.equal(body.key.lastFour, "0002");
    assert.doesNotMatch(JSON.stringify(body), new RegExp(workspaceOpenAiKey), "Credential responses must never echo a workspace secret");
    response = await apiRequest(baseUrl, `/api/v1/auth/openai-keys/${personalOpenAiKeyId}`, {
      method: "PATCH", cookie: ownerCookie, origin: baseUrl.slice(0, -1), body: { label: "Owner rotated label" },
    });
    assert.equal(response.status, 200, "Users must be able to update personal key metadata without resubmitting the secret");
    response = await apiRequest(baseUrl, "/api/v1/auth/openai-keys", { cookie: ownerCookie });
    body = await response.json();
    assert.equal(body.personalKeys[0].label, "Owner rotated label");
    assert.equal(body.workspaceKeys[0].status, "active");
    assert.deepEqual(body.personalKeys[0].usage, { requestCount: 0, successCount: 0, failureCount: 0, inputTokens: 0, outputTokens: 0, averageLatencyMs: 0, lastRequestAt: null }, "New credentials must expose an empty aggregate usage boundary without inventing calls");
    assert.doesNotMatch(JSON.stringify(body), /encryptedKey|encrypted_key|keyIv|key_iv/i, "Credential listings must expose metadata only");
    const samGovKey = "sam_verification_workspace_0001";
    response = await apiRequest(baseUrl, "/api/v1/auth/provider-credentials/sam-gov", { cookie: viewerCookie });
    assert.ok([401, 403].includes(response.status), "Non-manager sessions must not read workspace provider credential metadata");
    response = await apiRequest(baseUrl, "/api/v1/auth/provider-credentials/sam-gov", {
      method: "POST", cookie: ownerCookie, origin: baseUrl.slice(0, -1), body: { label: "Workspace SAM.gov", apiKey: samGovKey },
    });
    assert.equal(response.status, 201, "Workspace managers must be able to save a SAM.gov credential");
    body = await response.json();
    const samGovKeyId = body.credential.id;
    assert.equal(body.credential.lastFour, "0001");
    assert.doesNotMatch(JSON.stringify(body), new RegExp(samGovKey), "SAM.gov credential responses must never echo the secret");
    response = await apiRequest(baseUrl, "/api/v1/auth/provider-credentials/sam-gov", { cookie: ownerCookie });
    body = await response.json();
    assert.equal(body.credentials[0].status, "active");
    assert.equal(body.capability.runtimeScope, "workspace");
    assert.doesNotMatch(JSON.stringify(body), /encryptedSecret|encrypted_secret|secretIv|secret_iv/i, "SAM.gov credential listings must expose metadata only");
    response = await apiRequest(baseUrl, "/api/v1/auth/provider-credentials/sam-gov", {
      method: "POST", cookie: ownerCookie, origin: baseUrl.slice(0, -1), body: { label: "Workspace SAM.gov replacement", apiKey: "sam_verification_workspace_0002" },
    });
    assert.equal(response.status, 201, "Saving a second SAM.gov key must atomically replace the active workspace credential");
    const replacementSamGovKeyId = (await response.json()).credential.id;
    response = await apiRequest(baseUrl, "/api/v1/auth/provider-credentials/sam-gov", { cookie: ownerCookie });
    body = await response.json();
    assert.equal(body.credentials.filter((credential) => credential.status === "active").length, 1, "A workspace must retain exactly one active SAM.gov key");
    assert.ok(body.credentials.some((credential) => credential.id === samGovKeyId && credential.status === "revoked"), "Replaced SAM.gov keys must remain in lifecycle history");
    response = await apiRequest(baseUrl, `/api/v1/auth/provider-credentials/sam-gov/${replacementSamGovKeyId}`, { method: "DELETE", cookie: ownerCookie, origin: baseUrl.slice(0, -1) });
    assert.equal(response.status, 200, "Workspace managers must be able to revoke a SAM.gov credential");
    response = await apiRequest(baseUrl, "/api/v1/auth/event-ai/capability", { cookie: ownerCookie });
    assert.equal(response.status, 200);
    body = await response.json();
    assert.equal(body.capability.available, true, "Event AI must be available when an encrypted personal credential exists");
    assert.equal(body.capability.producerModel, "gpt-5.4");
    assert.equal(body.capability.verifierModel, "gpt-5.4");
    response = await apiRequest(baseUrl, `/api/v1/auth/event-ai/models?credentialScope=user&credentialId=${personalOpenAiKeyId}`, { cookie: ownerCookie });
    assert.equal(response.status, 200, "Event AI must expose the selected credential's live model inventory");
    body = await response.json();
    assert.deepEqual(body.inventory.models.map((model) => model.id), ["gpt-5.4", "gpt-5.4-mini", "gpt-5.4-nano"]);
    assert.equal(body.inventory.source, "openai_models_api");
    response = await apiRequest(baseUrl, "/api/v1/auth/event-ai", {
      method: "POST", cookie: ownerCookie, origin: baseUrl.slice(0, -1), body: {
        credentialScope: "user", credentialId: personalOpenAiKeyId, producerModel: "gpt-5.6-terra", verifierModel: "gpt-5.4",
        draft: { title: "Unavailable model guard", startsAt: "2027-03-09T09:00", links: [], milestones: [], categoryIds: [], attendeeIds: [], recordIds: [] },
      },
    });
    assert.equal(response.status, 409, "An unavailable project model must be rejected before a job is created");
    assert.match((await response.json()).error, /not available to the selected OpenAI credential/i);
    response = await apiRequest(baseUrl, "/api/v1/auth/event-ai/model-defaults", {
      method: "PATCH", cookie: ownerCookie, origin: baseUrl.slice(0, -1), body: { producerModel: "gpt-5.4-mini", verifierModel: "gpt-5.4" },
    });
    assert.equal(response.status, 200, "Workspace managers must be able to save separate research and verification defaults");
    body = await response.json();
    assert.equal(body.defaults.producerModel, "gpt-5.4-mini");
    response = await apiRequest(baseUrl, "/api/v1/auth/event-ai/models?credentialScope=workspace", { cookie: ownerCookie });
    body = await response.json();
    assert.equal(body.inventory.producerModel, "gpt-5.4-mini", "Workspace model inventory must apply persisted workspace defaults");
    response = await apiRequest(baseUrl, `/api/v1/auth/openai-keys/${workspaceOpenAiKeyId}`, {
      method: "DELETE", cookie: ownerCookie, origin: baseUrl.slice(0, -1),
    });
    assert.equal(response.status, 200, "Workspace managers must be able to revoke a workspace OpenAI key");
    response = await apiRequest(baseUrl, "/api/v1/auth/event-ai", {
      method: "POST", cookie: ownerCookie, origin: baseUrl.slice(0, -1),
      body: { credentialScope: "user", credentialId: personalOpenAiKeyId, producerModel: "gpt-5.4-mini", verifierModel: "gpt-5.4", direction: "Verify the public venue and official link.", draft: categorizedEvent },
    });
    assert.equal(response.status, 202, "Event AI must start as a durable background job");
    body = await response.json();
    const eventAiJobId = body.job.id;
    assert.equal(body.job.status, "researching");
    assert.equal(body.job.producerModel, "gpt-5.4-mini");
    assert.equal(body.job.verifierModel, "gpt-5.4");
    response = await apiRequest(baseUrl, `/api/v1/auth/event-ai/${eventAiJobId}`, { cookie: ownerCookie });
    body = await response.json();
    assert.equal(body.job.status, "verifying", "A separate verification stage must follow research");
    response = await apiRequest(baseUrl, `/api/v1/auth/event-ai/${eventAiJobId}`, { cookie: ownerCookie });
    body = await response.json();
    assert.equal(body.job.status, "completed", "Strict verified output must complete with a deterministic merge");
    assert.equal(body.job.mergeResult.mergedDraft.location, "Mission center");
    assert.equal(body.job.mergeResult.mergedDraft.attendeeIds[0], ownerId, "AI merge must preserve operator-controlled attendees");
    assert.ok(body.job.mergeResult.changes.includes("notes"));
    assert.equal(body.job.mergeResult.application.status, "pending_validation", "Workspace auto-accept must default off");
    response = await apiRequest(baseUrl, "/api/v1/agent/events", { cookie: ownerCookie });
    body = await response.json();
    let augmentedEvent = body.data.find((event) => event.id === categorizedEvent.id);
    assert.equal(augmentedEvent.notes, "", "A completed augmentation must not change the event while auto-accept is disabled");
    assert.equal(augmentedEvent.aiValidationRequired, true, "The Events grid contract must expose pending operator validation");
    assert.ok(augmentedEvent.lastAugmentedAt, "The Events grid contract must expose the last augmentation time");
    assert.equal(augmentedEvent.aiAmended, false);

    response = await apiRequest(baseUrl, `/api/v1/auth/workspace-admin/workspaces/${defaultWorkspaceId}`, {
      method: "PATCH", cookie: ownerCookie, origin: baseUrl.slice(0, -1), body: {
        name: "Defense budget", description: "Defense Budget Intelligence shared workspace",
        iconDataUrl: avatarDataUrl, headerEyebrow: "Defense Budget & Spend Analytics",
        displayTitle: "Defense Budget Intelligence", autoAcceptAiAugmentations: true,
      },
    });
    assert.equal(response.status, 200, "Workspace managers must be able to opt in to safe AI auto-acceptance");
    assert.equal((await response.json()).workspace.autoAcceptAiAugmentations, true);
    response = await apiRequest(baseUrl, `/api/v1/auth/workspace-admin/workspaces/${defaultWorkspaceId}`, {
      method: "PATCH", cookie: ownerCookie, origin: baseUrl.slice(0, -1), body: {
        name: "Defense budget", description: "Defense Budget Intelligence shared workspace",
        iconDataUrl: avatarDataUrl, headerEyebrow: "Defense Budget & Spend Analytics",
        displayTitle: "Defense Budget Intelligence",
      },
    });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).workspace.autoAcceptAiAugmentations, true, "Unrelated workspace updates must preserve the AI acceptance policy");
    response = await apiRequest(baseUrl, "/api/v1/auth/event-ai", {
      method: "POST", cookie: ownerCookie, origin: baseUrl.slice(0, -1), body: {
        credentialScope: "user", credentialId: personalOpenAiKeyId, producerModel: "gpt-5.4-mini", verifierModel: "gpt-5.4",
        direction: "Apply only verified additive details.", draft: augmentedEvent,
      },
    });
    assert.equal(response.status, 202);
    const autoAcceptJobId = (await response.json()).job.id;
    response = await apiRequest(baseUrl, `/api/v1/auth/event-ai/${autoAcceptJobId}`, { cookie: ownerCookie });
    assert.equal((await response.json()).job.status, "verifying");
    response = await apiRequest(baseUrl, `/api/v1/auth/event-ai/${autoAcceptJobId}`, { cookie: ownerCookie });
    body = await response.json();
    assert.equal(body.job.status, "completed");
    assert.equal(body.job.mergeResult.application.status, "applied", "Safe, conflict-free additive changes must auto-apply when the workspace opts in");
    response = await apiRequest(baseUrl, "/api/v1/agent/events", { cookie: ownerCookie });
    body = await response.json();
    augmentedEvent = body.data.find((event) => event.id === categorizedEvent.id);
    assert.equal(augmentedEvent.notes, "Verified public event summary.");
    assert.equal(augmentedEvent.aiAmended, true, "The Events grid contract must identify an AI-amended event");
    assert.equal(augmentedEvent.aiValidationRequired, false);
    assert.ok(augmentedEvent.lastAiAppliedAt);
    assert.equal(augmentedEvent.lastAugmentationJobId, autoAcceptJobId);
    assert.doesNotMatch(JSON.stringify(body), /sk-verification|authorization|requestBody|responseBody|prompt/i, "AI job responses must not expose credentials or raw provider payloads");
    response = await apiRequest(baseUrl, "/api/v1/auth/event-ai", {
      method: "POST", cookie: ownerCookie, origin: baseUrl.slice(0, -1),
      body: { credentialScope: "user", credentialId: personalOpenAiKeyId, direction: "__mock_missing_citations__", draft: {
        title: "AI evidence diagnostic verification event", startsAt: "2027-03-11T09:00", location: "", notes: "", links: [], milestones: [], categoryIds: [], attendeeIds: [], recordIds: [], status: "scheduled", wallboard: true,
      } },
    });
    assert.equal(response.status, 202);
    body = await response.json();
    const reviewEventAiJobId = body.job.id;
    response = await apiRequest(baseUrl, `/api/v1/auth/event-ai/${reviewEventAiJobId}`, { cookie: ownerCookie });
    body = await response.json();
    assert.equal(body.job.status, "verifying", "Incomplete citation transport must advance to claim-level verification instead of failing the whole job");
    assert.equal(body.job.currentStep, "independent_verification");
    assert.equal(body.job.inputSnapshot.title, "AI evidence diagnostic verification event");
    assert.equal(body.job.error, null);
    assert.equal(body.job.proposal.acceptedFields.length, 0, "Ungrounded producer claims must not be silently approved");
    assert.equal(body.job.proposal.reviewClaims.length > 0, true, "Ungrounded producer claims must remain inspectable for review");
    assert.equal(body.job.diagnostic.webSearchCallCount, 0, "The task must disclose whether web search actually ran");
    assert.equal(body.job.diagnostic.structuredSourceCount, 1, "The task must distinguish structured claims from citation transport");
    assert.deepEqual(body.job.diagnostic.outputItemTypes, ["message"], "The task must retain the safe provider output shape without raw content");
    response = await apiRequest(baseUrl, `/api/v1/auth/event-ai/${reviewEventAiJobId}`, { cookie: ownerCookie });
    body = await response.json();
    assert.equal(body.job.status, "needs_review", "A verifier may retain plausible ungrounded claims for review without merging them");
    assert.deepEqual(body.job.mergeResult.changes, []);
    response = await apiRequest(baseUrl, "/api/v1/agent/api-requests?limit=500", { cookie: ownerCookie });
    assert.equal(response.status, 200, "Workspace managers must be able to inspect redacted API request metadata");
    body = await response.json();
    const credentialEntries = body.data.filter((entry) => entry.requestKind === "credential_lifecycle");
    assert.ok(credentialEntries.some((entry) => entry.operation === "credential.created" && entry.credentialId === personalOpenAiKeyId));
    assert.ok(credentialEntries.some((entry) => entry.operation === "credential.revoked" && entry.credentialId === workspaceOpenAiKeyId));
    assert.ok(body.data.some((entry) => entry.operation === "event_enrichment.research" && entry.status === "succeeded"), "Research-stage metadata must be logged");
    assert.ok(body.data.some((entry) => entry.operation === "event_enrichment.verify" && entry.status === "succeeded"), "Verifier-stage metadata must be logged independently");
    assert.ok(body.data.some((entry) => entry.operation === "model_inventory.list" && entry.status === "succeeded"), "Credential-specific model inventory requests must be logged safely");
    const clientErrorEntry = body.data.find((entry) => entry.requestKind === "client_error");
    assert.equal(clientErrorEntry?.operation, "client.render_error", "Client render failures must remain distinguishable from API calls");
    assert.equal(clientErrorEntry?.route, "/#/budget-spend/explorer?secret&spendView", "Client routes may retain parameter names but never values");
    assert.doesNotMatch(JSON.stringify(clientErrorEntry), /sensitive-client-value|token=secret|secret=value/i, "Client error telemetry must redact credentials and route values");
    const transportGapEntry = body.data.find((entry) => entry.operation === "event_enrichment.research" && entry.status === "succeeded" && entry.metadata?.jobId === reviewEventAiJobId);
    assert.equal(transportGapEntry?.errorCode, null, "Citation transport gaps must not be logged as whole-stage failures");
    assert.equal(transportGapEntry?.metadata?.evidence?.webSearchCallCount, 0, "D1 logs must preserve redacted evidence-shape diagnostics");
    assert.equal(transportGapEntry?.metadata?.evidence?.structuredSourceCount, 1, "D1 logs must distinguish structured claims from provider citations");
    assert.match(transportGapEntry?.responseId || "", /^mock-producer-/, "D1 logs must retain the provider response ID");
    assert.equal(body.meta.retentionDays, 90);
    assert.doesNotMatch(JSON.stringify(body.data), /authorization|cookie|passwordProof|requestBody|responseBody|prompt|sk-verification/i, "D1 request logs must not expose secrets, prompts, headers, or bodies");

    const selfSignup = userPayload(20);
    response = await apiRequest(baseUrl, "/api/v1/auth/register", {
      method: "POST",
      body: selfSignup,
      origin: baseUrl.slice(0, -1),
    });
    assert.equal(response.status, 201, "Public self-signup must create an account after the service is claimed");
    const selfCookie = cookieFrom(response);
    body = await response.json();
    assert.equal(body.user.hasWorkspaceAccess, false, "Self-signups must begin without implicit workspace access");
    const selfUserId = body.user.id;
    response = await apiRequest(baseUrl, `/api/v1/auth/workspace-admin/workspaces/${defaultWorkspaceId}`, {
      method: "PATCH", body: { name: "Unauthorized rename", description: "" }, cookie: selfCookie, origin: baseUrl.slice(0, -1),
    });
    assert.equal(response.status, 403, "Only the global Super user may rename workspaces");
    response = await apiRequest(baseUrl, `/api/v1/auth/workspaces/${defaultWorkspaceId}/request`, {
      method: "POST", body: { note: "Need budget access" }, cookie: selfCookie, origin: baseUrl.slice(0, -1),
    });
    assert.equal(response.status, 201, "A self-signed-up user must be able to request workspace access");
    const accessRequestId = (await response.json()).request.id;
    response = await apiRequest(baseUrl, "/api/v1/auth/workspace-admin", { cookie: ownerCookie });
    body = await response.json();
    assert.equal(body.requests.some((item) => item.id === accessRequestId && item.status === "pending"), true, "Super user must see pending access requests");
    const defaultWorkspaceSummary = body.workspaces.find((item) => item.id === defaultWorkspaceId);
    assert.equal(defaultWorkspaceSummary.pendingRequestCount, 1, "Workspace inventory must surface its pending request count");
    assert.equal(typeof defaultWorkspaceSummary.contents.events, "number", "Hosted workspace administration must report event inventory");
    assert.equal(typeof defaultWorkspaceSummary.contents.trackedRecords, "number", "Hosted workspace administration must report tracked-record inventory");
    response = await apiRequest(baseUrl, `/api/v1/auth/workspace-admin/requests/${accessRequestId}`, {
      method: "POST", body: { decision: "approved", role: "analyst" }, cookie: ownerCookie, origin: baseUrl.slice(0, -1),
    });
    assert.equal(response.status, 200, "Super user must be able to approve access with a workspace role");
    response = await apiRequest(baseUrl, "/api/v1/auth/status", { cookie: selfCookie });
    body = await response.json();
    assert.equal(body.user.activeWorkspace.id, defaultWorkspaceId, "Approval must activate the first granted workspace for an existing session");
    assert.equal(body.user.role, "Analyst");

    response = await apiRequest(baseUrl, "/api/v1/auth/workspace-admin/workspaces", {
      method: "POST", body: { name: "Mission Delta", description: "Isolation verification workspace" }, cookie: ownerCookie, origin: baseUrl.slice(0, -1),
    });
    assert.equal(response.status, 201, "Super user must be able to create another workspace");
    const isolatedWorkspaceId = (await response.json()).workspace.id;
    response = await apiRequest(baseUrl, `/api/v1/auth/workspace-admin/workspaces/${isolatedWorkspaceId}`, {
      method: "PATCH", body: { name: "Mission Delta Command", description: "Renamed isolation verification workspace" }, cookie: ownerCookie, origin: baseUrl.slice(0, -1),
    });
    assert.equal(response.status, 200, "Super user must be able to rename a workspace without replacing its ID");
    body = await response.json();
    assert.equal(body.workspace.id, isolatedWorkspaceId, "Workspace rename must preserve the stable workspace ID");
    assert.equal(body.workspace.name, "Mission Delta Command");
    response = await apiRequest(baseUrl, `/api/v1/auth/workspaces/${isolatedWorkspaceId}/switch`, { method: "POST", body: {}, cookie: ownerCookie, origin: baseUrl.slice(0, -1) });
    assert.equal(response.status, 200);
    response = await apiRequest(baseUrl, "/api/v1/agent/events", {
      method: "POST", body: { title: "Isolated workspace event", startsAt: "2027-01-05T09:00", endsAt: "2027-01-06T17:00" }, cookie: ownerCookie,
      origin: baseUrl.slice(0, -1), headers: { "idempotency-key": "workspace-isolation-event" },
    });
    assert.equal(response.status, 201, "The second workspace must accept its own management state");
    response = await apiRequest(baseUrl, "/api/v1/auth/workspace-admin", { cookie: ownerCookie });
    body = await response.json();
    const isolatedSummary = body.workspaces.find((item) => item.id === isolatedWorkspaceId);
    assert.equal(isolatedSummary.name, "Mission Delta Command", "Workspace inventory must return the renamed identity");
    assert.equal(isolatedSummary.contents.events, 1, "Workspace inventory must report isolated event content");
    assert.equal(isolatedSummary.contents.wallboardEvents, 1, "Workspace inventory must report wallboard-visible events");
    assert.ok(isolatedSummary.contents.activityEntries >= 2, "Workspace inventory must report administrative and content activity");
    assert.ok(isolatedSummary.lastActivityAt, "Workspace inventory must expose its latest activity time");
    response = await apiRequest(baseUrl, `/api/v1/auth/workspace-admin/workspaces/${defaultWorkspaceId}/members`, {
      method: "POST", body: { userId: selfUserId, role: "administrator" }, cookie: ownerCookie, origin: baseUrl.slice(0, -1),
    });
    assert.equal(response.status, 200, "Super user must be able to promote a workspace member to manager");
    response = await apiRequest(baseUrl, "/api/v1/auth/status", { cookie: selfCookie });
    body = await response.json();
    assert.equal(body.user.canManageAccounts, false, "Workspace managers must not gain platform account authority");
    assert.equal(body.user.canManageWorkspace, true);
    assert.equal(body.user.canManageWorkspaces, true, "Workspace manager permission must be exposed in the signed-in user contract");
    assert.equal(body.user.role, "Workspace manager");
    response = await apiRequest(baseUrl, "/api/v1/auth/users", { cookie: selfCookie });
    assert.equal(response.status, 403, "Workspace managers must not enumerate global platform accounts");
    response = await apiRequest(baseUrl, "/api/v1/auth/workspace-admin", { cookie: selfCookie });
    body = await response.json();
    assert.deepEqual(body.workspaces.map((workspace) => workspace.id), [defaultWorkspaceId], "Workspace managers must see only their active administrative boundary");
    assert.deepEqual(body.users, [], "Workspace managers must not receive the global account directory through workspace administration");
    response = await apiRequest(baseUrl, `/api/v1/auth/workspace-admin/workspaces/${defaultWorkspaceId}/members`, {
      method: "POST", body: { userId: viewerId, role: "viewer" }, cookie: selfCookie, origin: baseUrl.slice(0, -1),
    });
    assert.equal(response.status, 200, "Workspace managers may change the role of an existing workspace member");
    const unassignedAccount = userPayload(21);
    response = await apiRequest(baseUrl, "/api/v1/auth/register", { method: "POST", body: unassignedAccount, origin: baseUrl.slice(0, -1) });
    assert.equal(response.status, 201);
    const unassignedAccountId = (await response.json()).user.id;
    response = await apiRequest(baseUrl, `/api/v1/auth/workspace-admin/workspaces/${defaultWorkspaceId}/members`, {
      method: "POST", body: { userId: unassignedAccountId, role: "viewer" }, cookie: selfCookie, origin: baseUrl.slice(0, -1),
    });
    assert.equal(response.status, 403, "Workspace managers must not pull arbitrary platform accounts into a workspace");
    response = await apiRequest(baseUrl, "/api/v1/auth/workspace-admin/workspaces", {
      method: "POST", body: { name: "Manager escape", description: "Must fail" }, cookie: selfCookie, origin: baseUrl.slice(0, -1),
    });
    assert.equal(response.status, 403, "Workspace managers must not create global workspaces");
    response = await apiRequest(baseUrl, `/api/v1/auth/workspace-admin/workspaces/${defaultWorkspaceId}`, {
      method: "PATCH", cookie: selfCookie, origin: baseUrl.slice(0, -1),
      body: { name: "Defense budget", description: "Defense Budget Intelligence shared workspace", iconDataUrl: avatarDataUrl, headerEyebrow: "Program intelligence", displayTitle: "Defense Budget Command" },
    });
    assert.equal(response.status, 200, "Workspace managers must be able to configure their assigned workspace identity");
    body = await response.json();
    assert.equal(body.workspace.iconDataUrl, avatarDataUrl);
    assert.equal(body.workspace.headerEyebrow, "Program intelligence");
    assert.equal(body.workspace.displayTitle, "Defense Budget Command");
    response = await apiRequest(baseUrl, `/api/v1/auth/workspaces/${defaultWorkspaceId}/switch`, { method: "POST", body: {}, cookie: ownerCookie, origin: baseUrl.slice(0, -1) });
    assert.equal(response.status, 200);
    response = await apiRequest(baseUrl, "/api/v1/agent/events", { cookie: ownerCookie });
    body = await response.json();
    assert.equal(body.data.some((event) => event.title === "Isolated workspace event"), false, "Workspace-scoped events must not leak into the original workspace");
    response = await apiRequest(baseUrl, `/api/v1/auth/workspace-admin/workspaces/${defaultWorkspaceId}/members/${selfUserId}`, {
      method: "DELETE", body: {}, cookie: ownerCookie, origin: baseUrl.slice(0, -1),
    });
    assert.equal(response.status, 200, "Super user must be able to remove non-owner workspace members");
    response = await apiRequest(baseUrl, "/api/v1/auth/status", { cookie: selfCookie });
    assert.equal((await response.json()).user.hasWorkspaceAccess, false, "Removed members must immediately lose the selected workspace boundary");

    const nextSalt = "ab".repeat(24);
    const nextProof = "cd".repeat(32);
    response = await apiRequest(baseUrl, "/api/v1/auth/password", {
      method: "POST",
      body: {
        currentPasswordProof: winner.passwordProof,
        newPasswordSalt: nextSalt,
        newPasswordProof: nextProof,
      },
      cookie: ownerCookie,
      origin: baseUrl.slice(0, -1),
    });
    assert.equal(response.status, 200);
    const rotatedCookie = cookieFrom(response);

    response = await apiRequest(baseUrl, "/api/v1/auth/status", { cookie: secondCookie });
    assert.equal((await response.json()).user, null, "Password rotation must revoke other sessions");
    response = await apiRequest(baseUrl, "/api/v1/auth/profile", {
      method: "PATCH",
      body: { displayName: "Invalid session", title: "" },
      cookie: secondCookie,
      origin: baseUrl.slice(0, -1),
    });
    assert.equal(response.status, 401);

    response = await apiRequest(baseUrl, "/api/v1/auth/login", {
      method: "POST",
      body: { email: winner.email, passwordProof: winner.passwordProof },
      origin: baseUrl.slice(0, -1),
    });
    assert.equal(response.status, 401, "Old proof must fail after password rotation");
    response = await apiRequest(baseUrl, "/api/v1/auth/login", {
      method: "POST",
      body: { email: winner.email, passwordProof: nextProof },
      origin: baseUrl.slice(0, -1),
    });
    assert.equal(response.status, 200, "New proof must authenticate after password rotation");

    response = await apiRequest(baseUrl, "/api/v1/auth/logout", {
      method: "POST",
      body: {},
      cookie: rotatedCookie,
      origin: baseUrl.slice(0, -1),
    });
    assert.equal(response.status, 200);
    assert.match(response.headers.get("set-cookie") || "", /Max-Age=0/);

    await stopPages(instance);
    instance = await startPages(persistPath);
    response = await apiRequest(instance.baseUrl, "/api/v1/auth/status");
    body = await response.json();
    assert.equal(body.claimed, true, "D1 first-account state must survive a Pages runtime restart");
    assert.equal(body.user, null);
    response = await apiRequest(instance.baseUrl, "/api/v1/auth/login", {
      method: "POST",
      body: { email: winner.email, passwordProof: nextProof },
      origin: instance.baseUrl.slice(0, -1),
    });
    assert.equal(response.status, 200, "Persisted D1 credentials must remain usable after restart");
    const restartedCookie = cookieFrom(response);
    response = await apiRequest(instance.baseUrl, `/api/v1/auth/event-ai/${eventAiJobId}`, { cookie: restartedCookie });
    assert.equal(response.status, 200, "Completed event AI jobs must remain resumable and inspectable after runtime restart");
    assert.equal((await response.json()).job.status, "completed");
  } finally {
    await stopPages(instance);
  }
}

async function verifyBrowserLifecycle(persistPath) {
  const instance = await startPages(persistPath);
  try {
    const child = spawn("node", ["scripts/verify-auth.mjs"], {
      stdio: "inherit",
      env: {
        ...process.env,
        BUDGET_AUTH_VERIFY_URL: instance.baseUrl,
        BUDGET_AUTH_SKIP_PROTECTED_API: "1",
      },
    });
    const exitCode = await new Promise((resolveExit, reject) => {
      child.once("error", reject);
      child.once("exit", resolveExit);
    });
    assert.equal(exitCode, 0, "Pages + D1 browser account lifecycle must pass");
  } finally {
    await stopPages(instance);
  }
}

const apiPersistPath = resolve(mkdtempSync("test-results/pages-auth-api-"));
const browserPersistPath = resolve(mkdtempSync("test-results/pages-auth-browser-"));
try {
  await verifyApiLifecycle(apiPersistPath);
  await verifyBrowserLifecycle(browserPersistPath);
  console.log("Verified Cloudflare Pages + D1 atomic first claim, multi-user RBAC, suspension/reactivation, administrator password reset, persistent sessions, profile/password lifecycle, and authenticated browser UI");
} finally {
  rmSync(apiPersistPath, { recursive: true, force: true });
  rmSync(browserPersistPath, { recursive: true, force: true });
}
