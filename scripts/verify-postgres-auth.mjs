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

async function request(path, { method = "GET", body, cookie = "", origin = ORIGIN } = {}) {
  const headers = {};
  if (body !== undefined) headers["content-type"] = "application/json";
  if (cookie) headers.cookie = cookie;
  if (method !== "GET") headers.origin = origin;
  return fetch(new URL(path.replace(/^\//, ""), BASE_URL), { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
}

function cookie(response) { return String(response.headers.get("set-cookie") || "").split(";")[0]; }
function identity(prefix) {
  const token = randomBytes(8).toString("hex");
  const emailPrefix = prefix.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return { email: `${emailPrefix}-${token}@example.test`, displayName: `${prefix} ${token.slice(0, 4)}`, title: "Verification user",
    passwordSalt: randomBytes(24).toString("hex"), passwordProof: randomBytes(32).toString("hex") };
}

await waitForStatus();
let response = await request("/api/v1/auth/status");
let body = await response.json();
assert.equal(body.claimed, false, "Fresh PostgreSQL auth contract must begin unclaimed");

const owner = identity("Owner");
response = await request("/api/v1/auth/claim", { method: "POST", body: owner, origin: "https://attacker.example" });
assert.equal(response.status, 403, "PostgreSQL must reject cross-origin first-claim writes");
response = await request("/api/v1/auth/claim", { method: "POST", body: owner });
assert.equal(response.status, 201, "PostgreSQL must support atomic first claim");
const ownerCookie = cookie(response);
body = await response.json();
assert.equal(body.user.canManageWorkspaces, true);
const ownerId = body.user.id;
const defaultWorkspaceId = body.user.activeWorkspace.id;

const pendingSetupUser = identity("Pending setup");
response = await request("/api/v1/auth/users", { method: "POST", cookie: ownerCookie, body: { ...pendingSetupUser, role: "viewer" } });
assert.equal(response.status, 201, "PostgreSQL Super user must create a managed account");
const pendingSetupUserId = (await response.json()).user.id;
response = await request("/api/v1/auth/emulation", { method: "POST", cookie: ownerCookie, body: { userId: pendingSetupUserId } });
assert.equal(response.status, 200, "PostgreSQL Super user must emulate an active account before first-login setup is complete");
body = await response.json();
assert.equal(body.user.isEmulating, true);
assert.equal(body.user.mustChangePassword, false, "PostgreSQL emulation must not force the actor through the target password gate");
response = await request("/api/v1/auth/directory", { cookie: ownerCookie });
assert.equal(response.status, 200, "PostgreSQL pre-setup emulation must expose the target role's effective workspace read access");
response = await request("/api/v1/auth/emulation", { method: "DELETE", cookie: ownerCookie, body: {} });
assert.equal(response.status, 200);

const avatarDataUrl = "data:image/webp;base64,UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEAAUAmJaQAA3AA/v89WAAAAA==";
response = await request("/api/v1/auth/profile", { method: "PATCH", cookie: ownerCookie,
  body: { displayName: owner.displayName, title: owner.title, avatarDataUrl } });
assert.equal(response.status, 200);
assert.equal((await response.json()).user.avatarDataUrl, avatarDataUrl, "PostgreSQL must persist profile pictures");

const personalOpenAiKey = "sk-postgres_personal_verification_0001";
const workspaceOpenAiKey = "sk-postgres_workspace_verification_0002";
response = await request("/api/v1/auth/openai-keys", { cookie: ownerCookie });
body = await response.json();
assert.equal(body.capability.encryptionReady, true, "PostgreSQL must advertise the configured credential vault");
assert.equal(body.capability.queryRuntimeEnabled, true, "The encrypted credential vault must advertise the enabled AI runtime");
assert.equal(body.capability.loggingReady, true, "PostgreSQL must advertise the redacted API request ledger");
assert.equal(body.capability.retentionDays, 90);
response = await request("/api/v1/auth/openai-keys", { method: "POST", cookie: ownerCookie,
  body: { scope: "user", label: "PostgreSQL personal", apiKey: personalOpenAiKey, isDefault: true } });
assert.equal(response.status, 201, "PostgreSQL must store personal OpenAI credentials");
body = await response.json();
const personalOpenAiKeyId = body.key.id;
assert.equal(body.key.lastFour, "0001");
assert.doesNotMatch(JSON.stringify(body), new RegExp(personalOpenAiKey));
response = await request("/api/v1/auth/openai-keys", { method: "POST", cookie: ownerCookie,
  body: { scope: "workspace", label: "PostgreSQL workspace", apiKey: workspaceOpenAiKey, isDefault: true } });
assert.equal(response.status, 201, "PostgreSQL must store workspace OpenAI credentials");
body = await response.json();
const workspaceOpenAiKeyId = body.key.id;
assert.equal(body.key.lastFour, "0002");
assert.doesNotMatch(JSON.stringify(body), new RegExp(workspaceOpenAiKey));
response = await request(`/api/v1/auth/openai-keys/${personalOpenAiKeyId}`, { method: "PATCH", cookie: ownerCookie,
  body: { label: "PostgreSQL personal renamed" } });
assert.equal(response.status, 200);
response = await request("/api/v1/auth/openai-keys", { cookie: ownerCookie });
body = await response.json();
assert.equal(body.personalKeys[0].label, "PostgreSQL personal renamed");
assert.equal(body.workspaceKeys[0].status, "active");
assert.deepEqual(body.personalKeys[0].usage, { requestCount: 0, successCount: 0, failureCount: 0, inputTokens: 0, outputTokens: 0, averageLatencyMs: 0, lastRequestAt: null });
assert.doesNotMatch(JSON.stringify(body), /encryptedKey|encrypted_key|keyIv|key_iv/i, "PostgreSQL credential listings must expose metadata only");
response = await request("/api/v1/auth/event-ai/capability", { cookie: ownerCookie });
assert.equal(response.status, 200);
body = await response.json();
assert.equal(body.capability.available, true);
assert.equal(body.capability.producerModel, "gpt-5.4");
assert.equal(body.capability.verifierModel, "gpt-5.4");
response = await request(`/api/v1/auth/event-ai/models?credentialScope=user&credentialId=${personalOpenAiKeyId}`, { cookie: ownerCookie });
assert.equal(response.status, 200);
body = await response.json();
assert.deepEqual(body.inventory.models.map((model) => model.id), ["gpt-5.4", "gpt-5.4-mini", "gpt-5.4-nano"]);
response = await request("/api/v1/auth/event-ai", { method: "POST", cookie: ownerCookie, body: {
  credentialScope: "user", credentialId: personalOpenAiKeyId, producerModel: "gpt-5.6-terra", verifierModel: "gpt-5.4",
  draft: { title: "Unavailable model guard", startsAt: "2027-04-11T09:00", links: [], milestones: [], categoryIds: [], attendeeIds: [], recordIds: [] },
} });
assert.equal(response.status, 409, "PostgreSQL must reject an unavailable model before job creation");
assert.match((await response.json()).error, /not available to the selected OpenAI credential/i);
response = await request("/api/v1/auth/event-ai/model-defaults", { method: "PATCH", cookie: ownerCookie,
  body: { producerModel: "gpt-5.4-mini", verifierModel: "gpt-5.4" } });
assert.equal(response.status, 200);
response = await request("/api/v1/auth/event-ai/models?credentialScope=workspace", { cookie: ownerCookie });
body = await response.json();
assert.equal(body.inventory.producerModel, "gpt-5.4-mini");
response = await request(`/api/v1/auth/openai-keys/${workspaceOpenAiKeyId}`, { method: "DELETE", cookie: ownerCookie });
assert.equal(response.status, 200);
response = await request("/api/v1/auth/event-ai", { method: "POST", cookie: ownerCookie, body: {
  credentialScope: "user", credentialId: personalOpenAiKeyId, producerModel: "gpt-5.4-mini", verifierModel: "gpt-5.4", direction: "Verify venue and source.",
  draft: { title: "PostgreSQL AI verification event", startsAt: "2027-04-12T09:00", location: "", notes: "", links: [], milestones: [], categoryIds: [], attendeeIds: [], recordIds: [], status: "scheduled", wallboard: true },
} });
assert.equal(response.status, 202);
body = await response.json();
const eventAiJobId = body.job.id;
assert.equal(body.job.status, "researching");
assert.equal(body.job.producerModel, "gpt-5.4-mini");
assert.equal(body.job.verifierModel, "gpt-5.4");
response = await request(`/api/v1/auth/event-ai/${eventAiJobId}`, { cookie: ownerCookie });
body = await response.json();
assert.equal(response.status, 200, `PostgreSQL research advancement failed: ${JSON.stringify(body)}`);
assert.equal(body.job.status, "verifying");
response = await request(`/api/v1/auth/event-ai/${eventAiJobId}`, { cookie: ownerCookie });
body = await response.json();
assert.equal(body.job.status, "completed");
assert.equal(body.job.mergeResult.mergedDraft.location, "Verified test venue");
assert.equal(body.job.mergeResult.application.status, "pending_validation", "PostgreSQL must preserve the default manual-validation policy");
assert.doesNotMatch(JSON.stringify(body), /sk-postgres|authorization|requestBody|responseBody|prompt/i);
response = await request("/api/v1/auth/event-ai", { method: "POST", cookie: ownerCookie, body: {
  credentialScope: "user", credentialId: personalOpenAiKeyId, direction: "__mock_missing_citations__",
  draft: { title: "PostgreSQL evidence diagnostic event", startsAt: "2027-04-13T09:00", location: "", notes: "", links: [], milestones: [], categoryIds: [], attendeeIds: [], recordIds: [], status: "scheduled", wallboard: true },
} });
assert.equal(response.status, 202);
body = await response.json();
const reviewEventAiJobId = body.job.id;
response = await request(`/api/v1/auth/event-ai/${reviewEventAiJobId}`, { cookie: ownerCookie });
body = await response.json();
assert.equal(response.status, 200, `PostgreSQL evidence diagnostic advancement failed: ${JSON.stringify(body)}`);
assert.equal(body.job.status, "verifying");
assert.equal(body.job.currentStep, "independent_verification");
assert.equal(body.job.inputSnapshot.title, "PostgreSQL evidence diagnostic event");
assert.equal(body.job.error, null);
assert.equal(body.job.proposal.acceptedFields.length, 0);
assert.equal(body.job.proposal.reviewClaims.length > 0, true);
assert.equal(body.job.diagnostic.webSearchCallCount, 0);
assert.equal(body.job.diagnostic.structuredSourceCount, 1);
response = await request(`/api/v1/auth/event-ai/${reviewEventAiJobId}`, { cookie: ownerCookie });
body = await response.json();
assert.equal(body.job.status, "needs_review");
assert.deepEqual(body.job.mergeResult.changes, []);
response = await request("/api/v1/auth/api-requests", { cookie: ownerCookie });
assert.equal(response.status, 200, "PostgreSQL workspace managers must be able to inspect redacted request metadata");
body = await response.json();
assert.ok(body.requests.some((entry) => entry.operation === "credential.created" && entry.credentialId === personalOpenAiKeyId));
assert.ok(body.requests.some((entry) => entry.operation === "credential.revoked" && entry.credentialId === workspaceOpenAiKeyId));
assert.ok(body.requests.some((entry) => entry.operation === "event_enrichment.research" && entry.status === "succeeded"));
assert.ok(body.requests.some((entry) => entry.operation === "event_enrichment.verify" && entry.status === "succeeded"));
assert.ok(body.requests.some((entry) => entry.operation === "model_inventory.list" && entry.status === "succeeded"));
const transportGapEntry = body.requests.find((entry) => entry.operation === "event_enrichment.research" && entry.status === "succeeded" && entry.metadata?.jobId === reviewEventAiJobId);
assert.equal(transportGapEntry?.errorCode, null);
assert.equal(transportGapEntry?.metadata?.evidence?.webSearchCallCount, 0);
assert.equal(transportGapEntry?.metadata?.evidence?.structuredSourceCount, 1);
assert.match(transportGapEntry?.responseId || "", /^mock-producer-/);
assert.equal(body.summary.retentionDays, 90);
assert.doesNotMatch(JSON.stringify(body.requests), /authorization|cookie|passwordProof|requestBody|responseBody|prompt|sk-postgres/i, "PostgreSQL request logs must not expose secrets, prompts, headers, or bodies");

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

response = await request("/api/v1/auth/teams", { method: "POST", cookie: ownerCookie, body: { name: "PostgreSQL HR", description: "Team overlay contract" } });
assert.equal(response.status, 201, "PostgreSQL Super user must create workspace teams");
const postgresTeamId = (await response.json()).team.id;
response = await request(`/api/v1/auth/teams/${postgresTeamId}/members`, { method: "PUT", cookie: ownerCookie, body: { userIds: [signupId] } });
assert.equal(response.status, 200, "PostgreSQL must persist team membership");
response = await request("/api/v1/auth/teams", { cookie: signupCookie });
body = await response.json();
assert.deepEqual(body.memberTeamIds.map(String), [String(postgresTeamId)]);
assert.deepEqual(body.teams.map((team) => String(team.id)), [String(postgresTeamId)], "Analysts must enumerate only their own team overlays");

response = await request("/api/v1/auth/emulation", { method: "POST", cookie: ownerCookie, body: { userId: signupId } });
assert.equal(response.status, 200, "PostgreSQL Super user must emulate an active managed user");
body = await response.json();
assert.equal(body.user.isEmulating, true);
assert.equal(String(body.user.id), String(signupId));
assert.equal(String(body.user.actor.id), String(ownerId), "PostgreSQL emulation must retain the real actor identity");
response = await request("/api/v1/auth/teams", { method: "POST", cookie: ownerCookie, body: { name: "Privilege leak" } });
assert.equal(response.status, 403, "Emulation must use the target user's workspace permissions");
response = await request("/api/v1/auth/profile", { method: "PATCH", cookie: ownerCookie, body: { displayName: "Emulated mutation" } });
assert.equal(response.status, 403, "PostgreSQL identity changes must be blocked during emulation");
response = await request("/api/v1/auth/emulation", { method: "DELETE", cookie: ownerCookie, body: {} });
assert.equal(response.status, 200);
assert.equal((await response.json()).user.isEmulating, false, "PostgreSQL must restore the real Super user after emulation");
response = await request(`/api/v1/auth/teams/${postgresTeamId}`, { method: "DELETE", cookie: ownerCookie, body: {} });
assert.equal(response.status, 204, "Unassigned PostgreSQL teams must be removable");

response = await request(`/api/v1/auth/workspace-admin/workspaces/${defaultWorkspaceId}/members`, { method: "POST", cookie: ownerCookie,
  body: { userId: signupId, role: "administrator" } });
assert.equal(response.status, 200);
response = await request("/api/v1/auth/status", { cookie: signupCookie });
body = await response.json();
assert.equal(body.user.canManageWorkspaces, true);
assert.equal(body.user.role, "Workspace manager");
response = await request("/api/v1/auth/workspace-admin", { cookie: signupCookie });
body = await response.json();
assert.deepEqual(body.workspaces.map((workspace) => String(workspace.id)), [String(defaultWorkspaceId)]);
response = await request(`/api/v1/auth/workspace-admin/workspaces/${defaultWorkspaceId}`, { method: "PATCH", cookie: signupCookie,
  body: { name: "Defense budget", description: "Managed boundary", iconDataUrl: avatarDataUrl, headerEyebrow: "Program intelligence", displayTitle: "Defense Budget Command", autoAcceptAiAugmentations: true } });
assert.equal(response.status, 200, "PostgreSQL workspace managers must configure only their assigned workspace");
body = await response.json();
assert.equal(body.workspace.iconDataUrl, avatarDataUrl);
assert.equal(body.workspace.autoAcceptAiAugmentations, true, "PostgreSQL must persist the workspace AI acceptance policy");
response = await request(`/api/v1/auth/workspace-admin/workspaces/${defaultWorkspaceId}`, { method: "PATCH", cookie: signupCookie,
  body: { name: "Defense budget", description: "Managed boundary", iconDataUrl: avatarDataUrl, headerEyebrow: "Program intelligence", displayTitle: "Defense Budget Command" } });
assert.equal(response.status, 200);
assert.equal((await response.json()).workspace.autoAcceptAiAugmentations, true, "PostgreSQL branding updates must preserve the AI acceptance policy");

response = await request("/api/v1/auth/workspace-admin/workspaces", { method: "POST", cookie: ownerCookie,
  body: { name: "PostgreSQL isolated", description: "Portability boundary" } });
assert.equal(response.status, 201);
const secondWorkspaceId = (await response.json()).workspace.id;
response = await request(`/api/v1/auth/workspace-admin/workspaces/${secondWorkspaceId}`, { method: "PATCH", cookie: ownerCookie,
  body: { name: "PostgreSQL command", description: "Renamed portability boundary" } });
assert.equal(response.status, 200, "PostgreSQL must support stable-ID workspace renames");
body = await response.json();
assert.equal(body.workspace.id, secondWorkspaceId);
assert.equal(body.workspace.name, "PostgreSQL command");
response = await request(`/api/v1/auth/workspace-admin/workspaces/${secondWorkspaceId}/members`, { method: "POST", cookie: ownerCookie,
  body: { userId: signupId, role: "viewer" } });
assert.equal(response.status, 201, "Super user must add an existing account to a workspace");
response = await request(`/api/v1/auth/workspace-admin/workspaces/${secondWorkspaceId}/members`, { method: "POST", cookie: ownerCookie,
  body: { userId: signupId, role: "analyst" } });
assert.equal(response.status, 200, "Super user must change an existing workspace role in place");
response = await request("/api/v1/auth/workspace-admin", { cookie: ownerCookie });
body = await response.json();
const workspaceSummary = body.workspaces.find((workspace) => String(workspace.id) === String(secondWorkspaceId));
assert.equal(workspaceSummary.name, "PostgreSQL command");
assert.equal(workspaceSummary.members.find((member) => String(member.id) === String(signupId)).roleId, "analyst");
assert.equal(workspaceSummary.contents.events, null, "PostgreSQL auth portability must mark hosted workspace-content counts unavailable");
response = await request(`/api/v1/auth/workspaces/${secondWorkspaceId}/switch`, { method: "POST", cookie: signupCookie, body: {} });
assert.equal(response.status, 200, "Members must be able to switch active workspaces");
response = await request(`/api/v1/auth/workspace-admin/workspaces/${secondWorkspaceId}/members/${signupId}`, { method: "DELETE", cookie: ownerCookie, body: {} });
assert.equal(response.status, 200, "Super user must remove non-owner workspace members");
response = await request("/api/v1/auth/status", { cookie: signupCookie });
assert.equal((await response.json()).user.hasWorkspaceAccess, false, "Removing the selected membership must clear that session's workspace boundary");

console.log("Verified PostgreSQL profile pictures, OpenAI credential vaults, self-signup, workspace branding, teams, effective-user emulation, scoped workspace managers, role assignment, switching, and removal");
