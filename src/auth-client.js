const AUTH_ROOT = "/api/v1/auth";
const PBKDF2_ITERATIONS = 310_000;

export function isKnownStaticHost() {
  if (typeof window === "undefined") return false;
  return window.location.hostname.endsWith(".github.io");
}

async function request(path, options = {}) {
  const response = await fetch(`${AUTH_ROOT}${path}`, {
    credentials: "same-origin",
    headers: { "content-type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    const error = new Error("Account service is not available on this host.");
    error.staticHost = true;
    throw error;
  }
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "Account request failed.");
  return body;
}

function bytesToHex(bytes) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function createPasswordSalt() {
  return bytesToHex(crypto.getRandomValues(new Uint8Array(24)));
}

export async function derivePasswordProof(password, salt) {
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits({
    name: "PBKDF2",
    hash: "SHA-256",
    salt: new TextEncoder().encode(salt),
    iterations: PBKDF2_ITERATIONS,
  }, material, 256);
  return bytesToHex(new Uint8Array(bits));
}

export const authApi = {
  status: () => request("/status", { method: "GET", headers: {} }),
  async claim({ email, displayName, title, password }) {
    const passwordSalt = createPasswordSalt();
    const passwordProof = await derivePasswordProof(password, passwordSalt);
    return request("/claim", { method: "POST", body: JSON.stringify({ email, displayName, title, passwordSalt, passwordProof }) });
  },
  async register({ email, displayName, title, password, inviteCode }) {
    const passwordSalt = createPasswordSalt();
    const passwordProof = await derivePasswordProof(password, passwordSalt);
    return request("/register", { method: "POST", body: JSON.stringify({ email, displayName, title, passwordSalt, passwordProof, inviteCode }) });
  },
  async login({ email, password }) {
    const config = await request("/login-config", { method: "POST", body: JSON.stringify({ email }) });
    const passwordProof = await derivePasswordProof(password, config.passwordSalt);
    return request("/login", { method: "POST", body: JSON.stringify({ email, passwordProof }) });
  },
  logout: () => request("/logout", { method: "POST", body: "{}" }),
  listSessions: () => request("/sessions", { method: "GET", headers: {} }),
  revokeSession: (id) => request(`/sessions/${encodeURIComponent(id)}`, { method: "DELETE", body: "{}" }),
  revokeOtherSessions: () => request("/sessions", { method: "DELETE", body: "{}" }),
  updateProfile: (profile) => request("/profile", { method: "PATCH", body: JSON.stringify(profile) }),
  listAgentKeys: () => request("/agent-keys", { method: "GET", headers: {} }),
  createAgentKey: (values) => request("/agent-keys", { method: "POST", body: JSON.stringify(values) }),
  revokeAgentKey: (id) => request(`/agent-keys/${encodeURIComponent(id)}`, { method: "DELETE", body: "{}" }),
  listUsers: () => request("/users", { method: "GET", headers: {} }),
  getRegistrationAdministration: () => request("/registration", { method: "GET", headers: {} }),
  updateRegistrationPolicy: (mode) => request("/registration", { method: "PATCH", body: JSON.stringify({ mode }) }),
  createRegistrationInvite: (values) => request("/registration/invites", { method: "POST", body: JSON.stringify(values) }),
  revokeRegistrationInvite: (id) => request(`/registration/invites/${encodeURIComponent(id)}`, { method: "DELETE", body: "{}" }),
  listUserActivity: () => request("/activity", { method: "GET", headers: {} }),
  recordPageVisit: (surface) => request("/activity", { method: "POST", body: JSON.stringify({ eventType: "page_visit", surface }) }),
  listDirectory: () => request("/directory", { method: "GET", headers: {} }),
  listWorkspaces: () => request("/workspaces", { method: "GET", headers: {} }),
  requestWorkspaceAccess: (workspaceId, note = "") => request(`/workspaces/${encodeURIComponent(workspaceId)}/request`, { method: "POST", body: JSON.stringify({ note }) }),
  switchWorkspace: (workspaceId) => request(`/workspaces/${encodeURIComponent(workspaceId)}/switch`, { method: "POST", body: "{}" }),
  startEmulation: (userId) => request("/emulation", { method: "POST", body: JSON.stringify({ userId }) }),
  stopEmulation: () => request("/emulation", { method: "DELETE", body: "{}" }),
  listTeams: () => request("/teams", { method: "GET", headers: {} }),
  createTeam: (values) => request("/teams", { method: "POST", body: JSON.stringify(values) }),
  updateTeam: (id, values) => request(`/teams/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(values) }),
  updateTeamMembers: (id, userIds) => request(`/teams/${encodeURIComponent(id)}/members`, { method: "PUT", body: JSON.stringify({ userIds }) }),
  deleteTeam: (id) => request(`/teams/${encodeURIComponent(id)}`, { method: "DELETE", body: "{}" }),
  getWorkspaceAdmin: () => request("/workspace-admin", { method: "GET", headers: {} }),
  getSaasControlPlane: () => request("/control-plane", { method: "GET", headers: {} }),
  createCommercialOrganization: (values) => request("/control-plane/organizations", { method: "POST", body: JSON.stringify(values) }),
  updateCommercialOrganization: (id, values) => request(`/control-plane/organizations/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(values) }),
  createWorkspace: (values) => request("/workspace-admin/workspaces", { method: "POST", body: JSON.stringify(values) }),
  updateWorkspace: (workspaceId, values) => request(`/workspace-admin/workspaces/${encodeURIComponent(workspaceId)}`, { method: "PATCH", body: JSON.stringify(values) }),
  resolveWorkspaceRequest: (requestId, values) => request(`/workspace-admin/requests/${encodeURIComponent(requestId)}`, { method: "POST", body: JSON.stringify(values) }),
  addWorkspaceMember: (workspaceId, values) => request(`/workspace-admin/workspaces/${encodeURIComponent(workspaceId)}/members`, { method: "POST", body: JSON.stringify(values) }),
  removeWorkspaceMember: (workspaceId, userId) => request(`/workspace-admin/workspaces/${encodeURIComponent(workspaceId)}/members/${encodeURIComponent(userId)}`, { method: "DELETE", body: "{}" }),
  listOpenAiKeys: () => request("/openai-keys", { method: "GET", headers: {} }),
  createOpenAiKey: (values) => request("/openai-keys", { method: "POST", body: JSON.stringify(values) }),
  updateOpenAiKey: (id, values) => request(`/openai-keys/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(values) }),
  revokeOpenAiKey: (id) => request(`/openai-keys/${encodeURIComponent(id)}`, { method: "DELETE", body: "{}" }),
  listProviderCredentials: (provider) => request(`/provider-credentials/${encodeURIComponent(provider)}`, { method: "GET", headers: {} }),
  createProviderCredential: (provider, values) => request(`/provider-credentials/${encodeURIComponent(provider)}`, { method: "POST", body: JSON.stringify(values) }),
  revokeProviderCredential: (provider, id) => request(`/provider-credentials/${encodeURIComponent(provider)}/${encodeURIComponent(id)}`, { method: "DELETE", body: "{}" }),
  getAcquisitionStatus: () => request("/acquisition/status", { method: "GET", headers: {} }),
  getAcquisitionConfig: () => request("/acquisition/config", { method: "GET", headers: {} }),
  updateAcquisitionConfig: (values) => request("/acquisition/config", { method: "PATCH", body: JSON.stringify(values) }),
  refreshAcquisitionSource: (trigger = "manual") => request("/acquisition/refresh", { method: "POST", body: JSON.stringify({ trigger }) }),
  listAcquisitionRecords: ({ limit = 1000, offset = 0, removed = false } = {}) => request(`/acquisition/records?limit=${encodeURIComponent(limit)}&offset=${encodeURIComponent(offset)}${removed ? "&removed=1" : ""}`, { method: "GET", headers: {} }),
  listAcquisitionSavedViews: () => request("/acquisition/saved-views", { method: "GET", headers: {} }),
  createAcquisitionSavedView: (values) => request("/acquisition/saved-views", { method: "POST", body: JSON.stringify(values) }),
  updateAcquisitionSavedView: (id, values) => request(`/acquisition/saved-views/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(values) }),
  deleteAcquisitionSavedView: (id) => request(`/acquisition/saved-views/${encodeURIComponent(id)}`, { method: "DELETE", body: "{}" }),
  getAcquisitionDeliveryPreferences: () => request("/acquisition/delivery-preferences", { method: "GET", headers: {} }),
  updateAcquisitionDeliveryPreferences: (values) => request("/acquisition/delivery-preferences", { method: "PATCH", body: JSON.stringify(values) }),
  getAcquisitionOperations: () => request("/acquisition/operations", { method: "GET", headers: {} }),
  updateAcquisitionDeliveryJob: (id, action) => request(`/acquisition/delivery-jobs/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify({ action }) }),
  getAcquisitionEmailProvider: () => request("/acquisition/email-provider", { method: "GET", headers: {} }),
  saveAcquisitionEmailProvider: (values) => request("/acquisition/email-provider", { method: "POST", body: JSON.stringify(values) }),
  revokeAcquisitionEmailProvider: () => request("/acquisition/email-provider", { method: "DELETE", body: "{}" }),
  verifyAcquisitionEmailProvider: () => request("/acquisition/email-provider/verify", { method: "POST", body: "{}" }),
  testAcquisitionEmailProvider: () => request("/acquisition/email-provider/test", { method: "POST", body: "{}" }),
  updateOperationalIncident: (id, action) => request(`/acquisition/incidents/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify({ action }) }),
  getEventAiCapability: () => request("/event-ai/capability", { method: "GET", headers: {} }),
  listEventAiModels: ({ credentialScope, credentialId = "" }) => request(`/event-ai/models?credentialScope=${encodeURIComponent(credentialScope)}&credentialId=${encodeURIComponent(credentialId)}`, { method: "GET", headers: {} }),
  saveEventAiModelDefaults: (values) => request("/event-ai/model-defaults", { method: "PATCH", body: JSON.stringify(values) }),
  listEventAiJobs: () => request("/event-ai", { method: "GET", headers: {} }),
  startEventAiJob: (values) => request("/event-ai", { method: "POST", body: JSON.stringify(values) }),
  getEventAiJob: (id) => request(`/event-ai/${encodeURIComponent(id)}`, { method: "GET", headers: {} }),
  async createUser({ email, displayName, title, role, password }) {
    const passwordSalt = createPasswordSalt();
    const passwordProof = await derivePasswordProof(password, passwordSalt);
    return request("/users", { method: "POST", body: JSON.stringify({ email, displayName, title, role, passwordSalt, passwordProof }) });
  },
  updateUser: (id, values) => request(`/users/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(values) }),
  async resetUserPassword(id, password) {
    const passwordSalt = createPasswordSalt();
    const passwordProof = await derivePasswordProof(password, passwordSalt);
    return request(`/users/${encodeURIComponent(id)}/password`, { method: "POST", body: JSON.stringify({ passwordSalt, passwordProof }) });
  },
  async changePassword({ email, currentPassword, newPassword }) {
    const config = await request("/login-config", { method: "POST", body: JSON.stringify({ email }) });
    const currentPasswordProof = await derivePasswordProof(currentPassword, config.passwordSalt);
    const newPasswordSalt = createPasswordSalt();
    const newPasswordProof = await derivePasswordProof(newPassword, newPasswordSalt);
    return request("/password", { method: "POST", body: JSON.stringify({ currentPasswordProof, newPasswordSalt, newPasswordProof }) });
  },
};
