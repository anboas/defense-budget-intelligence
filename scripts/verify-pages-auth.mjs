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
    assert.equal(body.user.canManageUsers, true);
    assert.equal(body.user.canManageWorkspaces, true);
    assert.equal(body.user.activeWorkspace.name, "Defense budget");
    const ownerId = body.user.id;
    const defaultWorkspaceId = body.user.activeWorkspace.id;

    response = await apiRequest(baseUrl, "/api/v1/auth/directory", { cookie: ownerCookie });
    body = await response.json();
    assert.deepEqual(body.users.map((user) => user.displayName), [winner.displayName], "The attendee directory should initially contain the active owner only");

    response = await apiRequest(baseUrl, "/api/v1/auth/users");
    assert.equal(response.status, 401, "Anonymous callers must not enumerate workspace users");

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

    response = await apiRequest(baseUrl, "/api/v1/auth/directory", { cookie: ownerCookie });
    body = await response.json();
    assert.equal(body.users.length, 2, "The attendee directory should include newly created active users");

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
    response = await apiRequest(baseUrl, "/api/v1/auth/directory", { cookie: viewerCookie });
    assert.equal(response.status, 200, "Signed-in viewers may read the minimal active-user directory used by event filters");

    response = await apiRequest(baseUrl, `/api/v1/auth/users/${encodeURIComponent(viewerId)}`, {
      method: "PATCH",
      body: { email: viewer.email, displayName: viewer.displayName, title: viewer.title, role: "analyst", status: "active" },
      cookie: ownerCookie,
      origin: baseUrl.slice(0, -1),
    });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).user.role, "Analyst", "Role changes must take effect without recreating the account");

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
    response = await apiRequest(baseUrl, "/api/v1/agent/events", {
      method: "POST", cookie: ownerCookie, origin: baseUrl.slice(0, -1), headers: { "idempotency-key": "avatar-event-verification" },
      body: { title: "Avatar propagation verification", startsAt: "2027-02-01T09:00", endsAt: "2027-02-01T10:00", attendeeIds: [ownerId] },
    });
    assert.equal(response.status, 201);
    response = await apiRequest(baseUrl, "/api/v1/agent/events", { cookie: ownerCookie });
    assert.equal(response.status, 200);
    body = await response.json();
    const ownedEventAttendee = body.data.find((event) => event.title === "Avatar propagation verification")?.attendees?.find((attendee) => attendee.id === ownerId);
    assert.equal(ownedEventAttendee?.avatarDataUrl, avatarDataUrl, "Calendar attendee payloads must carry the current profile image");

    const personalOpenAiKey = "sk-verification_personal_000000000001";
    const workspaceOpenAiKey = "sk-verification_workspace_000000000002";
    response = await apiRequest(baseUrl, "/api/v1/auth/openai-keys", { cookie: ownerCookie });
    assert.equal(response.status, 200);
    body = await response.json();
    assert.equal(body.capability.encryptionReady, true, "D1 must advertise the configured credential vault");
    assert.equal(body.capability.queryRuntimeEnabled, false, "Management must not imply that OpenAI query execution is enabled yet");
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
    response = await apiRequest(baseUrl, `/api/v1/auth/openai-keys/${workspaceOpenAiKeyId}`, {
      method: "DELETE", cookie: ownerCookie, origin: baseUrl.slice(0, -1),
    });
    assert.equal(response.status, 200, "Workspace managers must be able to revoke a workspace OpenAI key");
    response = await apiRequest(baseUrl, "/api/v1/auth/openai-keys", { cookie: ownerCookie });
    body = await response.json();
    assert.equal(body.personalKeys[0].label, "Owner rotated label");
    assert.equal(body.workspaceKeys[0].status, "revoked");
    assert.doesNotMatch(JSON.stringify(body), /encryptedKey|encrypted_key|keyIv|key_iv/i, "Credential listings must expose metadata only");

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
    assert.equal(body.user.canManageWorkspaces, true, "Workspace manager permission must be exposed in the signed-in user contract");
    assert.equal(body.user.role, "Workspace manager");
    response = await apiRequest(baseUrl, "/api/v1/auth/workspace-admin", { cookie: selfCookie });
    body = await response.json();
    assert.deepEqual(body.workspaces.map((workspace) => workspace.id), [defaultWorkspaceId], "Workspace managers must see only their active administrative boundary");
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
