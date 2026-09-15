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
  async register({ email, displayName, title, password }) {
    const passwordSalt = createPasswordSalt();
    const passwordProof = await derivePasswordProof(password, passwordSalt);
    return request("/register", { method: "POST", body: JSON.stringify({ email, displayName, title, passwordSalt, passwordProof }) });
  },
  async login({ email, password }) {
    const config = await request("/login-config", { method: "POST", body: JSON.stringify({ email }) });
    const passwordProof = await derivePasswordProof(password, config.passwordSalt);
    return request("/login", { method: "POST", body: JSON.stringify({ email, passwordProof }) });
  },
  logout: () => request("/logout", { method: "POST", body: "{}" }),
  updateProfile: (profile) => request("/profile", { method: "PATCH", body: JSON.stringify(profile) }),
  listAgentKeys: () => request("/agent-keys", { method: "GET", headers: {} }),
  createAgentKey: (values) => request("/agent-keys", { method: "POST", body: JSON.stringify(values) }),
  revokeAgentKey: (id) => request(`/agent-keys/${encodeURIComponent(id)}`, { method: "DELETE", body: "{}" }),
  listUsers: () => request("/users", { method: "GET", headers: {} }),
  listDirectory: () => request("/directory", { method: "GET", headers: {} }),
  listWorkspaces: () => request("/workspaces", { method: "GET", headers: {} }),
  requestWorkspaceAccess: (workspaceId, note = "") => request(`/workspaces/${encodeURIComponent(workspaceId)}/request`, { method: "POST", body: JSON.stringify({ note }) }),
  switchWorkspace: (workspaceId) => request(`/workspaces/${encodeURIComponent(workspaceId)}/switch`, { method: "POST", body: "{}" }),
  getWorkspaceAdmin: () => request("/workspace-admin", { method: "GET", headers: {} }),
  createWorkspace: (values) => request("/workspace-admin/workspaces", { method: "POST", body: JSON.stringify(values) }),
  updateWorkspace: (workspaceId, values) => request(`/workspace-admin/workspaces/${encodeURIComponent(workspaceId)}`, { method: "PATCH", body: JSON.stringify(values) }),
  resolveWorkspaceRequest: (requestId, values) => request(`/workspace-admin/requests/${encodeURIComponent(requestId)}`, { method: "POST", body: JSON.stringify(values) }),
  addWorkspaceMember: (workspaceId, values) => request(`/workspace-admin/workspaces/${encodeURIComponent(workspaceId)}/members`, { method: "POST", body: JSON.stringify(values) }),
  removeWorkspaceMember: (workspaceId, userId) => request(`/workspace-admin/workspaces/${encodeURIComponent(workspaceId)}/members/${encodeURIComponent(userId)}`, { method: "DELETE", body: "{}" }),
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
