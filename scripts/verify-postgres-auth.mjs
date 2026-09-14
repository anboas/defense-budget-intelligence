import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";

const BASE_URL = process.env.BUDGET_POSTGRES_AUTH_VERIFY_URL || "http://127.0.0.1:18081/";
const ORIGIN = new URL(BASE_URL).origin;

async function waitForStatus() {
  let error;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try { const response = await fetch(new URL("api/v1/auth/status", BASE_URL)); if (response.ok) return; }
    catch (requestError) { error = requestError; }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw error || new Error("PostgreSQL auth runtime did not become ready");
}

async function request(path, { method = "GET", body, cookie = "" } = {}) {
  const headers = {};
  if (body !== undefined) headers["content-type"] = "application/json";
  if (cookie) headers.cookie = cookie;
  if (method !== "GET") headers.origin = ORIGIN;
  return fetch(new URL(path.replace(/^\//, ""), BASE_URL), { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
}

function cookie(response) { return String(response.headers.get("set-cookie") || "").split(";")[0]; }
function identity(prefix) {
  const token = randomBytes(8).toString("hex");
  return { email: `${prefix}-${token}@example.test`, displayName: `${prefix} ${token.slice(0, 4)}`, title: "Verification user",
    passwordSalt: randomBytes(24).toString("hex"), passwordProof: randomBytes(32).toString("hex") };
}

await waitForStatus();
let response = await request("/api/v1/auth/status");
let body = await response.json();
assert.equal(body.claimed, false, "Fresh PostgreSQL auth contract must begin unclaimed");

const owner = identity("Owner");
response = await request("/api/v1/auth/claim", { method: "POST", body: owner });
assert.equal(response.status, 201, "PostgreSQL must support atomic first claim");
const ownerCookie = cookie(response);
body = await response.json();
assert.equal(body.user.canManageWorkspaces, true);
const defaultWorkspaceId = body.user.activeWorkspace.id;

const avatarDataUrl = "data:image/webp;base64,UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEAAUAmJaQAA3AA/v89WAAAAA==";
response = await request("/api/v1/auth/profile", { method: "PATCH", cookie: ownerCookie,
  body: { displayName: owner.displayName, title: owner.title, avatarDataUrl } });
assert.equal(response.status, 200);
assert.equal((await response.json()).user.avatarDataUrl, avatarDataUrl, "PostgreSQL must persist profile pictures");

const signup = identity("Signup");
response = await request("/api/v1/auth/register", { method: "POST", body: signup });
assert.equal(response.status, 201, "PostgreSQL must support public self-signup");
const signupCookie = cookie(response);
body = await response.json();
assert.equal(body.user.hasWorkspaceAccess, false, "Self-signup must grant no implicit workspace access");
const signupId = body.user.id;

response = await request(`/api/v1/auth/workspaces/${defaultWorkspaceId}/request`, { method: "POST", cookie: signupCookie, body: { note: "Contract access" } });
assert.equal(response.status, 201);
const requestId = (await response.json()).request.id;
response = await request("/api/v1/auth/workspace-admin", { cookie: signupCookie });
assert.equal(response.status, 403, "Only the global Super user may administer workspaces");
response = await request(`/api/v1/auth/workspace-admin/requests/${requestId}`, { method: "POST", cookie: ownerCookie, body: { decision: "approved", role: "analyst" } });
assert.equal(response.status, 200, "Super user must approve requests with a workspace role");
response = await request("/api/v1/auth/status", { cookie: signupCookie });
body = await response.json();
assert.equal(body.user.activeWorkspace.id, defaultWorkspaceId);
assert.equal(body.user.role, "Analyst");

response = await request("/api/v1/auth/workspace-admin/workspaces", { method: "POST", cookie: ownerCookie,
  body: { name: "PostgreSQL isolated", description: "Portability boundary" } });
assert.equal(response.status, 201);
const secondWorkspaceId = (await response.json()).workspace.id;
response = await request(`/api/v1/auth/workspace-admin/workspaces/${secondWorkspaceId}/members`, { method: "POST", cookie: ownerCookie,
  body: { userId: signupId, role: "viewer" } });
assert.equal(response.status, 201, "Super user must add an existing account to a workspace");
response = await request(`/api/v1/auth/workspaces/${secondWorkspaceId}/switch`, { method: "POST", cookie: signupCookie, body: {} });
assert.equal(response.status, 200, "Members must be able to switch active workspaces");
response = await request(`/api/v1/auth/workspace-admin/workspaces/${secondWorkspaceId}/members/${signupId}`, { method: "DELETE", cookie: ownerCookie, body: {} });
assert.equal(response.status, 200, "Super user must remove non-owner workspace members");
response = await request("/api/v1/auth/status", { cookie: signupCookie });
assert.equal((await response.json()).user.hasWorkspaceAccess, false, "Removing the selected membership must clear that session's workspace boundary");

console.log("Verified PostgreSQL profile pictures, self-signup, access requests, Super-user-only workspace administration, role assignment, switching, and removal");
