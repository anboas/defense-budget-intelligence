const encoder = new TextEncoder();

export const PAGES_AUTH_VERSION = "dbi-pages-auth-v1";
export const PASSWORD_ITERATIONS = 310_000;
export const SESSION_COOKIE = "dbi_session";
export const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

const MAX_ATTEMPTS = 8;
const ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
const MAX_BODY_BYTES = 16_384;
const AGENT_API_VERSION = "dbi-agent-v1";
const AGENT_TOKEN_PREFIX = "dbi_agent_";
const AGENT_RATE_LIMIT = 300;
const AGENT_SCOPES = Object.freeze([
  "records:read", "records:write",
  "tracking:read", "tracking:write",
  "events:read", "events:write",
  "activity:read", "activity:write",
  "integrations:read",
]);
const USER_ROLES = Object.freeze(["administrator", "analyst", "viewer"]);
const USER_STATUSES = Object.freeze(["active", "suspended"]);
const DEFAULT_WORKSPACE_ID = "workspace-defense-budget";
const DEFAULT_HEADER_EYEBROW = "Defense Budget & Spend Analytics";
const DEFAULT_DISPLAY_TITLE = "Defense Budget Intelligence";
const ROLE_LABELS = Object.freeze({
  super_user: "Super user",
  administrator: "Workspace manager",
  analyst: "Analyst",
  viewer: "Viewer",
});
const READ_SCOPES = Object.freeze(["records:read", "tracking:read", "events:read", "activity:read", "integrations:read"]);

const SCHEMA = Object.freeze([
  `CREATE TABLE IF NOT EXISTS dbi_super_user (
    singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
    user_id TEXT NOT NULL UNIQUE,
    email TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    title TEXT NOT NULL DEFAULT '',
    password_salt TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS dbi_users (
    user_id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    title TEXT NOT NULL DEFAULT '',
    role TEXT NOT NULL CHECK (role IN ('super_user', 'administrator', 'analyst', 'viewer')),
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
    password_salt TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    must_change_password INTEGER NOT NULL DEFAULT 0,
    created_by TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    last_login_at TEXT NOT NULL DEFAULT ''
  )`,
  "CREATE UNIQUE INDEX IF NOT EXISTS idx_dbi_users_email_lower ON dbi_users (LOWER(email))",
  `INSERT OR IGNORE INTO dbi_users
    (user_id, email, display_name, title, role, status, password_salt, password_hash, must_change_password, created_by, created_at, updated_at, last_login_at)
    SELECT user_id, email, display_name, title, 'super_user', 'active', password_salt, password_hash, 0, user_id, created_at, updated_at, ''
    FROM dbi_super_user WHERE singleton = 1`,
  `CREATE TABLE IF NOT EXISTS dbi_sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    expires_at TEXT NOT NULL,
    revoked_at TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL
  )`,
  "CREATE INDEX IF NOT EXISTS idx_dbi_sessions_user ON dbi_sessions (user_id, expires_at)",
  `CREATE TABLE IF NOT EXISTS dbi_login_attempts (
    id TEXT PRIMARY KEY,
    client_hash TEXT NOT NULL,
    succeeded INTEGER NOT NULL DEFAULT 0,
    attempted_at TEXT NOT NULL
  )`,
  "CREATE INDEX IF NOT EXISTS idx_dbi_login_attempts_client ON dbi_login_attempts (client_hash, attempted_at)",
  `CREATE TABLE IF NOT EXISTS dbi_agent_keys (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    scopes_json TEXT NOT NULL,
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL,
    last_used_at TEXT NOT NULL DEFAULT '',
    expires_at TEXT NOT NULL DEFAULT '',
    revoked_at TEXT NOT NULL DEFAULT ''
  )`,
  `CREATE TABLE IF NOT EXISTS dbi_watchlist (
    record_id TEXT PRIMARY KEY,
    note TEXT NOT NULL DEFAULT '',
    review_at TEXT NOT NULL DEFAULT '',
    wallboard INTEGER NOT NULL DEFAULT 1,
    version INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS dbi_management_events (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    starts_at TEXT NOT NULL,
    ends_at TEXT NOT NULL DEFAULT '',
    location TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'scheduled',
    record_ids_json TEXT NOT NULL DEFAULT '[]',
    wallboard INTEGER NOT NULL DEFAULT 1,
    version INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS dbi_event_attendees (
    event_id TEXT NOT NULL,
    attendee_name TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (event_id, attendee_name)
  )`,
  "CREATE INDEX IF NOT EXISTS idx_dbi_event_attendees_event ON dbi_event_attendees (event_id)",
  `CREATE TABLE IF NOT EXISTS dbi_event_user_attendees (
    event_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (event_id, user_id)
  )`,
  "CREATE INDEX IF NOT EXISTS idx_dbi_event_user_attendees_event ON dbi_event_user_attendees (event_id)",
  `CREATE TABLE IF NOT EXISTS dbi_schema_migrations (
    name TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL
  )`,
  `INSERT OR IGNORE INTO dbi_management_events
    (id, title, starts_at, ends_at, location, notes, status, record_ids_json, wallboard, version, created_at, updated_at)
    SELECT 'event-air-space-cyber-conference-2026', 'Air, Space & Cyber Conference', '2026-09-14T08:00', '2026-09-16T17:00', 'National Harbor, Maryland, USA', '', 'scheduled', '[]', 1, 1, '2026-09-14T19:00:00.000Z', '2026-09-14T19:00:00.000Z'
    WHERE NOT EXISTS (SELECT 1 FROM dbi_schema_migrations WHERE name = '2026-09-14-event-wallboard-import')`,
  `INSERT OR IGNORE INTO dbi_management_events
    (id, title, starts_at, ends_at, location, notes, status, record_ids_json, wallboard, version, created_at, updated_at)
    SELECT 'event-ausa-annual-meeting-2026', 'AUSA Annual Meeting & Exposition 2026', '2026-10-12T08:00', '2026-10-14T17:00', 'Walter E. Washington Convention Center, 801 Allen Y. Lew Pl NW, Washington, DC 20001', '', 'scheduled', '[]', 1, 1, '2026-09-14T19:00:00.000Z', '2026-09-14T19:00:00.000Z'
    WHERE NOT EXISTS (SELECT 1 FROM dbi_schema_migrations WHERE name = '2026-09-14-event-wallboard-import')`,
  `INSERT OR IGNORE INTO dbi_management_events
    (id, title, starts_at, ends_at, location, notes, status, record_ids_json, wallboard, version, created_at, updated_at)
    SELECT 'event-eighth-annual-defense-conference-2026', '8th Annual Defense Conference', '2026-10-30T08:00', '2026-10-30T17:00', 'Hyatt Regency Crystal City, Virginia or virtual', '', 'scheduled', '[]', 1, 1, '2026-09-14T19:00:00.000Z', '2026-09-14T19:00:00.000Z'
    WHERE NOT EXISTS (SELECT 1 FROM dbi_schema_migrations WHERE name = '2026-09-14-event-wallboard-import')`,
  `INSERT OR IGNORE INTO dbi_management_events
    (id, title, starts_at, ends_at, location, notes, status, record_ids_json, wallboard, version, created_at, updated_at)
    SELECT 'event-i-itsec-2026', 'Interservice/Industry Training, Simulation and Education Conference (I/ITSEC) 2026', '2026-11-30T08:00', '2026-12-04T17:00', 'Orange County Convention Center, South Concourse, 9899 International Drive, Orlando, FL 32819', '', 'scheduled', '[]', 1, 1, '2026-09-14T19:00:00.000Z', '2026-09-14T19:00:00.000Z'
    WHERE NOT EXISTS (SELECT 1 FROM dbi_schema_migrations WHERE name = '2026-09-14-event-wallboard-import')`,
  `INSERT OR IGNORE INTO dbi_management_events
    (id, title, starts_at, ends_at, location, notes, status, record_ids_json, wallboard, version, created_at, updated_at)
    SELECT 'event-weapon-systems-software-summit-2026', '2026 Department of Defense Weapon Systems Software Summit', '2026-12-08T08:00', '2026-12-08T17:00', 'Broward County Convention Center, Fort Lauderdale, Florida, United States', '', 'scheduled', '[]', 1, 1, '2026-09-14T19:00:00.000Z', '2026-09-14T19:00:00.000Z'
    WHERE NOT EXISTS (SELECT 1 FROM dbi_schema_migrations WHERE name = '2026-09-14-event-wallboard-import')`,
  `INSERT OR IGNORE INTO dbi_event_attendees (event_id, attendee_name, created_at)
    SELECT 'event-air-space-cyber-conference-2026', 'Jon VandeMark', '2026-09-14T19:00:00.000Z'
    WHERE NOT EXISTS (SELECT 1 FROM dbi_schema_migrations WHERE name = '2026-09-14-event-wallboard-import')`,
  `INSERT OR IGNORE INTO dbi_event_attendees (event_id, attendee_name, created_at)
    SELECT 'event-air-space-cyber-conference-2026', 'Adam Boas', '2026-09-14T19:00:00.000Z'
    WHERE NOT EXISTS (SELECT 1 FROM dbi_schema_migrations WHERE name = '2026-09-14-event-wallboard-import')`,
  `INSERT OR IGNORE INTO dbi_event_attendees (event_id, attendee_name, created_at)
    SELECT 'event-eighth-annual-defense-conference-2026', 'Jon VandeMark', '2026-09-14T19:00:00.000Z'
    WHERE NOT EXISTS (SELECT 1 FROM dbi_schema_migrations WHERE name = '2026-09-14-event-wallboard-import')`,
  `INSERT OR IGNORE INTO dbi_event_attendees (event_id, attendee_name, created_at)
    SELECT 'event-eighth-annual-defense-conference-2026', 'Adam Boas', '2026-09-14T19:00:00.000Z'
    WHERE NOT EXISTS (SELECT 1 FROM dbi_schema_migrations WHERE name = '2026-09-14-event-wallboard-import')`,
  `INSERT OR IGNORE INTO dbi_event_attendees (event_id, attendee_name, created_at)
    SELECT 'event-i-itsec-2026', 'Jon VandeMark', '2026-09-14T19:00:00.000Z'
    WHERE NOT EXISTS (SELECT 1 FROM dbi_schema_migrations WHERE name = '2026-09-14-event-wallboard-import')`,
  `INSERT OR IGNORE INTO dbi_event_attendees (event_id, attendee_name, created_at)
    SELECT 'event-i-itsec-2026', 'Adam Boas', '2026-09-14T19:00:00.000Z'
    WHERE NOT EXISTS (SELECT 1 FROM dbi_schema_migrations WHERE name = '2026-09-14-event-wallboard-import')`,
  `INSERT OR IGNORE INTO dbi_event_attendees (event_id, attendee_name, created_at)
    SELECT 'event-weapon-systems-software-summit-2026', 'Adam Boas', '2026-09-14T19:00:00.000Z'
    WHERE NOT EXISTS (SELECT 1 FROM dbi_schema_migrations WHERE name = '2026-09-14-event-wallboard-import')`,
  `INSERT OR IGNORE INTO dbi_schema_migrations (name, applied_at)
    VALUES ('2026-09-14-event-wallboard-import', '2026-09-14T19:00:00.000Z')`,
  `INSERT OR IGNORE INTO dbi_event_user_attendees (event_id, user_id, created_at)
    SELECT attendee.event_id, user.user_id, '2026-09-14T19:40:00.000Z'
    FROM dbi_event_attendees attendee
    JOIN dbi_users user ON user.role = 'super_user'
    WHERE attendee.attendee_name = 'Adam Boas'
      AND NOT EXISTS (SELECT 1 FROM dbi_schema_migrations WHERE name = '2026-09-14-event-user-attendees')`,
  `INSERT OR IGNORE INTO dbi_event_user_attendees (event_id, user_id, created_at)
    SELECT attendee.event_id, user.user_id, '2026-09-14T19:40:00.000Z'
    FROM dbi_event_attendees attendee
    JOIN dbi_users user ON LOWER(user.display_name) = LOWER(attendee.attendee_name)
    WHERE NOT EXISTS (SELECT 1 FROM dbi_schema_migrations WHERE name = '2026-09-14-event-user-attendees')`,
  `INSERT OR IGNORE INTO dbi_schema_migrations (name, applied_at)
    VALUES ('2026-09-14-event-user-attendees', '2026-09-14T19:40:00.000Z')`,
  `CREATE TABLE IF NOT EXISTS dbi_operator_activity (
    id TEXT PRIMARY KEY,
    actor_type TEXT NOT NULL,
    actor_id TEXT NOT NULL,
    action TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL DEFAULT '',
    detail_json TEXT NOT NULL DEFAULT '{}',
    occurred_at TEXT NOT NULL
  )`,
  "CREATE INDEX IF NOT EXISTS idx_dbi_operator_activity_at ON dbi_operator_activity (occurred_at DESC)",
  `CREATE TABLE IF NOT EXISTS dbi_manual_records (
    id TEXT PRIMARY KEY,
    payload_json TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT NOT NULL DEFAULT ''
  )`,
  `CREATE TABLE IF NOT EXISTS dbi_agent_idempotency (
    principal_id TEXT NOT NULL,
    idempotency_key TEXT NOT NULL,
    request_fingerprint TEXT NOT NULL,
    response_status INTEGER NOT NULL,
    response_body TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (principal_id, idempotency_key)
  )`,
  `CREATE TABLE IF NOT EXISTS dbi_agent_rate_limits (
    principal_id TEXT NOT NULL,
    minute_bucket TEXT NOT NULL,
    request_count INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (principal_id, minute_bucket)
  )`,
  `CREATE TABLE IF NOT EXISTS dbi_workspaces (
    workspace_id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    description TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
    owner_user_id TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `INSERT OR IGNORE INTO dbi_workspaces
    (workspace_id, name, slug, description, status, owner_user_id, created_at, updated_at)
    VALUES ('workspace-defense-budget', 'Defense budget', 'defense-budget', 'Defense Budget Intelligence shared workspace', 'active', '', '2026-09-14T20:20:00.000Z', '2026-09-14T20:20:00.000Z')`,
  `CREATE TABLE IF NOT EXISTS dbi_workspace_settings (
    workspace_id TEXT PRIMARY KEY,
    icon_data_url TEXT NOT NULL DEFAULT '',
    header_eyebrow TEXT NOT NULL DEFAULT 'Defense Budget & Spend Analytics',
    display_title TEXT NOT NULL DEFAULT 'Defense Budget Intelligence',
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS dbi_workspace_memberships (
    workspace_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('super_user', 'administrator', 'analyst', 'viewer')),
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (workspace_id, user_id)
  )`,
  "CREATE INDEX IF NOT EXISTS idx_dbi_workspace_memberships_user ON dbi_workspace_memberships (user_id, workspace_id)",
  `CREATE TABLE IF NOT EXISTS dbi_workspace_access_requests (
    request_id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    note TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'denied')),
    resolved_by TEXT NOT NULL DEFAULT '',
    resolved_at TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  "CREATE UNIQUE INDEX IF NOT EXISTS idx_dbi_workspace_request_pending ON dbi_workspace_access_requests (workspace_id, user_id) WHERE status = 'pending'",
  `CREATE TABLE IF NOT EXISTS dbi_session_workspaces (
    session_id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS dbi_user_profiles (
    user_id TEXT PRIMARY KEY,
    avatar_data_url TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS dbi_workspace_agent_keys (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    name TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    scopes_json TEXT NOT NULL,
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL,
    last_used_at TEXT NOT NULL DEFAULT '',
    expires_at TEXT NOT NULL DEFAULT '',
    revoked_at TEXT NOT NULL DEFAULT ''
  )`,
  "CREATE INDEX IF NOT EXISTS idx_dbi_workspace_agent_keys_workspace ON dbi_workspace_agent_keys (workspace_id, created_at DESC)",
  `CREATE TABLE IF NOT EXISTS dbi_workspace_watchlist (
    workspace_id TEXT NOT NULL,
    record_id TEXT NOT NULL,
    note TEXT NOT NULL DEFAULT '',
    review_at TEXT NOT NULL DEFAULT '',
    wallboard INTEGER NOT NULL DEFAULT 1,
    version INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (workspace_id, record_id)
  )`,
  `CREATE TABLE IF NOT EXISTS dbi_workspace_events (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    title TEXT NOT NULL,
    starts_at TEXT NOT NULL,
    ends_at TEXT NOT NULL DEFAULT '',
    location TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'scheduled',
    record_ids_json TEXT NOT NULL DEFAULT '[]',
    wallboard INTEGER NOT NULL DEFAULT 1,
    version INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  "CREATE INDEX IF NOT EXISTS idx_dbi_workspace_events_workspace ON dbi_workspace_events (workspace_id, starts_at)",
  `CREATE TABLE IF NOT EXISTS dbi_workspace_event_attendees (
    workspace_id TEXT NOT NULL,
    event_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (workspace_id, event_id, user_id)
  )`,
  `CREATE TABLE IF NOT EXISTS dbi_workspace_event_milestones (
    workspace_id TEXT NOT NULL,
    event_id TEXT NOT NULL,
    milestone_id TEXT NOT NULL,
    type TEXT NOT NULL,
    label TEXT NOT NULL DEFAULT '',
    occurs_at TEXT NOT NULL,
    notes TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (workspace_id, event_id, milestone_id)
  )`,
  "CREATE INDEX IF NOT EXISTS idx_dbi_workspace_event_milestones_date ON dbi_workspace_event_milestones (workspace_id, occurs_at)",
  `CREATE TABLE IF NOT EXISTS dbi_workspace_activity (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    actor_type TEXT NOT NULL,
    actor_id TEXT NOT NULL,
    action TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL DEFAULT '',
    detail_json TEXT NOT NULL DEFAULT '{}',
    occurred_at TEXT NOT NULL
  )`,
  "CREATE INDEX IF NOT EXISTS idx_dbi_workspace_activity_workspace ON dbi_workspace_activity (workspace_id, occurred_at DESC)",
  `CREATE TABLE IF NOT EXISTS dbi_workspace_manual_records (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT NOT NULL DEFAULT ''
  )`,
  `UPDATE dbi_workspaces SET owner_user_id = COALESCE((SELECT user_id FROM dbi_super_user WHERE singleton = 1), owner_user_id)
    WHERE workspace_id = 'workspace-defense-budget' AND owner_user_id = ''`,
  `INSERT OR IGNORE INTO dbi_workspace_memberships (workspace_id, user_id, role, created_by, created_at, updated_at)
    SELECT 'workspace-defense-budget', user_id, role, COALESCE(NULLIF(created_by, ''), user_id), created_at, updated_at
    FROM dbi_users
    WHERE NOT EXISTS (SELECT 1 FROM dbi_schema_migrations WHERE name = '2026-09-14-multi-workspace-v1')`,
  `INSERT OR IGNORE INTO dbi_session_workspaces (session_id, workspace_id, updated_at)
    SELECT id, 'workspace-defense-budget', '2026-09-14T20:20:00.000Z' FROM dbi_sessions
    WHERE NOT EXISTS (SELECT 1 FROM dbi_schema_migrations WHERE name = '2026-09-14-multi-workspace-v1')`,
  `INSERT OR IGNORE INTO dbi_workspace_agent_keys
    (id, workspace_id, name, token_hash, scopes_json, created_by, created_at, last_used_at, expires_at, revoked_at)
    SELECT id, 'workspace-defense-budget', name, token_hash, scopes_json, created_by, created_at, last_used_at, expires_at, revoked_at
    FROM dbi_agent_keys
    WHERE NOT EXISTS (SELECT 1 FROM dbi_schema_migrations WHERE name = '2026-09-14-multi-workspace-v1')`,
  `INSERT OR IGNORE INTO dbi_workspace_watchlist
    (workspace_id, record_id, note, review_at, wallboard, version, created_at, updated_at)
    SELECT 'workspace-defense-budget', record_id, note, review_at, wallboard, version, created_at, updated_at
    FROM dbi_watchlist
    WHERE NOT EXISTS (SELECT 1 FROM dbi_schema_migrations WHERE name = '2026-09-14-multi-workspace-v1')`,
  `INSERT OR IGNORE INTO dbi_workspace_events
    (id, workspace_id, title, starts_at, ends_at, location, notes, status, record_ids_json, wallboard, version, created_at, updated_at)
    SELECT id, 'workspace-defense-budget', title, starts_at, ends_at, location, notes, status, record_ids_json, wallboard, version, created_at, updated_at
    FROM dbi_management_events
    WHERE NOT EXISTS (SELECT 1 FROM dbi_schema_migrations WHERE name = '2026-09-14-multi-workspace-v1')`,
  `INSERT OR IGNORE INTO dbi_workspace_event_attendees (workspace_id, event_id, user_id, created_at)
    SELECT 'workspace-defense-budget', event_id, user_id, created_at FROM dbi_event_user_attendees
    WHERE NOT EXISTS (SELECT 1 FROM dbi_schema_migrations WHERE name = '2026-09-14-multi-workspace-v1')`,
  `INSERT OR IGNORE INTO dbi_workspace_activity
    (id, workspace_id, actor_type, actor_id, action, entity_type, entity_id, detail_json, occurred_at)
    SELECT id, 'workspace-defense-budget', actor_type, actor_id, action, entity_type, entity_id, detail_json, occurred_at
    FROM dbi_operator_activity
    WHERE NOT EXISTS (SELECT 1 FROM dbi_schema_migrations WHERE name = '2026-09-14-multi-workspace-v1')`,
  `INSERT OR IGNORE INTO dbi_workspace_manual_records
    (id, workspace_id, payload_json, version, created_at, updated_at, deleted_at)
    SELECT id, 'workspace-defense-budget', payload_json, version, created_at, updated_at, deleted_at
    FROM dbi_manual_records
    WHERE NOT EXISTS (SELECT 1 FROM dbi_schema_migrations WHERE name = '2026-09-14-multi-workspace-v1')`,
  `INSERT OR IGNORE INTO dbi_schema_migrations (name, applied_at)
    VALUES ('2026-09-14-multi-workspace-v1', '2026-09-14T20:20:00.000Z')`,
]);
const schemaInitialization = new WeakMap();

function databaseFromEnv(env = {}) {
  return env.DBI_DB?.prepare ? env.DBI_DB : null;
}

async function ensureSchema(db) {
  let initialization = schemaInitialization.get(db);
  if (!initialization) {
    initialization = (async () => {
      for (const statement of SCHEMA) await db.prepare(statement).run();
    })().catch((error) => {
      schemaInitialization.delete(db);
      throw error;
    });
    schemaInitialization.set(db, initialization);
  }
  await initialization;
}

function json(payload, status = 200, headers = {}) {
  return Response.json({ authVersion: PAGES_AUTH_VERSION, ...payload }, {
    status,
    headers: { "cache-control": "no-store", ...headers },
  });
}

function cleanText(value, maxLength) {
  return Array.from(String(value || ""), (character) => {
    const code = character.charCodeAt(0);
    return code < 32 || code === 127 ? " " : character;
  }).join("").trim().slice(0, maxLength);
}

function normalizeEmail(value) {
  const email = cleanText(value, 254).toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : "";
}

function bytesToHex(bytes) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function randomHex(byteLength = 32) {
  return bytesToHex(crypto.getRandomValues(new Uint8Array(byteLength)));
}

async function hashValue(value) {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(String(value || "")));
  return bytesToHex(new Uint8Array(digest));
}

function validPasswordProof(value) {
  return /^[a-f0-9]{64}$/i.test(String(value || ""));
}

function validSalt(value) {
  return /^[a-f0-9]{32,128}$/i.test(String(value || ""));
}

function constantTimeEqual(left, right) {
  const a = String(left || "");
  const b = String(right || "");
  if (!a || a.length !== b.length) return false;
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) {
    difference |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return difference === 0;
}

function cookies(request) {
  return Object.fromEntries(String(request.headers.get("cookie") || "")
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const separator = part.indexOf("=");
      return separator < 0
        ? [part, ""]
        : [part.slice(0, separator), decodeURIComponent(part.slice(separator + 1))];
    }));
}

function sessionCookie(token, request, env, maxAge = SESSION_MAX_AGE_SECONDS) {
  const secure = env.DBI_FORCE_SECURE_COOKIES === "1" || new URL(request.url).protocol === "https:"
    ? "; Secure"
    : "";
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure}`;
}

function sameOrigin(request) {
  const origin = request.headers.get("origin");
  return !origin || origin === new URL(request.url).origin;
}

async function safeJson(request, maxBytes = MAX_BODY_BYTES) {
  const length = Number(request.headers.get("content-length") || 0);
  if (length > maxBytes) return null;
  try {
    return await request.json();
  } catch {
    return null;
  }
}

function publicUser(row) {
  const roleId = row?.role === "super_user" ? "super_user" : row?.membership_role || row?.role || "viewer";
  return row ? {
    id: row.user_id,
    email: row.email,
    displayName: row.display_name,
    title: row.title || "",
    avatarDataUrl: row.avatar_data_url || "",
    role: ROLE_LABELS[roleId] || "Viewer",
    roleId,
    status: row.status || "active",
    mustChangePassword: Boolean(row.must_change_password),
    canManageUsers: ["super_user", "administrator"].includes(roleId),
    canManageAgents: ["super_user", "administrator"].includes(roleId),
    canManageWorkspaces: row.role === "super_user" || roleId === "administrator",
    createdAt: row.created_at,
    lastLoginAt: row.last_login_at || null,
  } : null;
}

function validAvatarDataUrl(value) {
  const avatar = cleanText(value, 14_000);
  return !avatar || /^data:image\/(?:png|jpeg|webp);base64,[a-z0-9+/]+=*$/i.test(avatar) ? avatar : null;
}

async function workspacesForUser(db, userId) {
  const result = await db.prepare(`
    SELECT workspace.workspace_id, workspace.name, workspace.slug, workspace.description, membership.role,
      settings.icon_data_url, settings.header_eyebrow, settings.display_title
    FROM dbi_workspace_memberships membership
    JOIN dbi_workspaces workspace ON workspace.workspace_id = membership.workspace_id
    LEFT JOIN dbi_workspace_settings settings ON settings.workspace_id = workspace.workspace_id
    WHERE membership.user_id = ? AND workspace.status = 'active'
    ORDER BY workspace.name COLLATE NOCASE
  `).bind(userId).all();
  return (result.results || []).map((workspace) => ({
    id: workspace.workspace_id,
    name: workspace.name,
    slug: workspace.slug,
    description: workspace.description || "",
    iconDataUrl: workspace.icon_data_url || "",
    headerEyebrow: workspace.header_eyebrow || DEFAULT_HEADER_EYEBROW,
    displayTitle: workspace.display_title || DEFAULT_DISPLAY_TITLE,
    roleId: workspace.role,
    role: ROLE_LABELS[workspace.role] || "Viewer",
  }));
}

async function publicSessionUser(db, row) {
  if (!row) return null;
  const workspaces = await workspacesForUser(db, row.user_id);
  const activeWorkspace = workspaces.find((workspace) => workspace.id === row.active_workspace_id) || null;
  const profile = row.avatar_data_url === undefined
    ? await db.prepare("SELECT avatar_data_url FROM dbi_user_profiles WHERE user_id = ?").bind(row.user_id).first()
    : null;
  const hydrated = {
    ...row,
    membership_role: activeWorkspace?.roleId || row.membership_role,
    avatar_data_url: row.avatar_data_url ?? profile?.avatar_data_url ?? "",
  };
  return { ...publicUser(hydrated), workspaces, activeWorkspace, hasWorkspaceAccess: Boolean(activeWorkspace) };
}

async function superUser(db) {
  return db.prepare("SELECT * FROM dbi_super_user WHERE singleton = 1").first();
}

async function userByEmail(db, email) {
  return db.prepare("SELECT * FROM dbi_users WHERE email = ?").bind(email).first();
}

function canAdministerUsers(user) {
  return Boolean(user && (user.role === "super_user" || user.membership_role === "administrator"));
}

function canAdministerWorkspaces(user) {
  return Boolean(user && (user.role === "super_user" || user.membership_role === "administrator"));
}

async function canAdministerWorkspace(db, user, workspaceId) {
  if (user?.role === "super_user") return true;
  if (!user || String(user.active_workspace_id || "") !== String(workspaceId || "")) return false;
  const membership = await db.prepare("SELECT role FROM dbi_workspace_memberships WHERE workspace_id = ? AND user_id = ?")
    .bind(workspaceId, user.user_id).first();
  return membership?.role === "administrator";
}

function scopesForRole(role) {
  if (["super_user", "administrator", "analyst"].includes(role)) return [...AGENT_SCOPES];
  return [...READ_SCOPES];
}

async function sessionUser(db, request) {
  const rawToken = cookies(request)[SESSION_COOKIE] || "";
  if (!rawToken) return null;
  const row = await db.prepare(`
    SELECT u.*, profile.avatar_data_url, s.id AS session_id,
      session_workspace.workspace_id AS active_workspace_id,
      membership.role AS membership_role,
      workspace.name AS active_workspace_name,
      workspace.slug AS active_workspace_slug
    FROM dbi_sessions s
    JOIN dbi_users u ON u.user_id = s.user_id
    LEFT JOIN dbi_user_profiles profile ON profile.user_id = u.user_id
    LEFT JOIN dbi_session_workspaces session_workspace ON session_workspace.session_id = s.id
    LEFT JOIN dbi_workspace_memberships membership
      ON membership.workspace_id = session_workspace.workspace_id AND membership.user_id = u.user_id
    LEFT JOIN dbi_workspaces workspace
      ON workspace.workspace_id = membership.workspace_id AND workspace.status = 'active'
    WHERE s.token_hash = ? AND s.revoked_at = '' AND s.expires_at > ? AND u.status = 'active'
  `).bind(await hashValue(rawToken), new Date().toISOString()).first();
  if (!row) return null;
  await db.prepare("UPDATE dbi_sessions SET last_seen_at = ? WHERE id = ?")
    .bind(new Date().toISOString(), row.session_id)
    .run();
  return row;
}

async function createSession(db, userId, preferredWorkspaceId = "") {
  const rawToken = randomHex(32);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_MAX_AGE_SECONDS * 1000).toISOString();
  const preferred = preferredWorkspaceId ? await db.prepare(`
    SELECT membership.workspace_id FROM dbi_workspace_memberships membership
    JOIN dbi_workspaces workspace ON workspace.workspace_id = membership.workspace_id
    WHERE membership.user_id = ? AND membership.workspace_id = ? AND workspace.status = 'active'
  `).bind(userId, preferredWorkspaceId).first() : null;
  const fallback = preferred || await db.prepare(`
    SELECT membership.workspace_id FROM dbi_workspace_memberships membership
    JOIN dbi_workspaces workspace ON workspace.workspace_id = membership.workspace_id
    WHERE membership.user_id = ? AND workspace.status = 'active'
    ORDER BY CASE membership.role WHEN 'super_user' THEN 0 WHEN 'administrator' THEN 1 WHEN 'analyst' THEN 2 ELSE 3 END,
      workspace.name COLLATE NOCASE LIMIT 1
  `).bind(userId).first();
  const sessionId = crypto.randomUUID();
  await db.prepare(`
    INSERT INTO dbi_sessions
      (id, user_id, token_hash, expires_at, revoked_at, created_at, last_seen_at)
    VALUES (?, ?, ?, ?, '', ?, ?)
  `).bind(
    sessionId,
    userId,
    await hashValue(rawToken),
    expiresAt,
    now.toISOString(),
    now.toISOString(),
  ).run();
  if (fallback?.workspace_id) await db.prepare(`
    INSERT OR REPLACE INTO dbi_session_workspaces (session_id, workspace_id, updated_at) VALUES (?, ?, ?)
  `).bind(sessionId, fallback.workspace_id, now.toISOString()).run();
  return { rawToken, expiresAt, sessionId, workspaceId: fallback?.workspace_id || "" };
}

async function clientHash(request, email) {
  const ip = request.headers.get("cf-connecting-ip")
    || request.headers.get("x-forwarded-for")
    || "local";
  return hashValue(`${email}|${ip}|${cleanText(request.headers.get("user-agent"), 240)}`);
}

async function loginBlocked(db, client) {
  const since = new Date(Date.now() - ATTEMPT_WINDOW_MS).toISOString();
  const row = await db.prepare(`
    SELECT COUNT(*) AS count
    FROM dbi_login_attempts
    WHERE client_hash = ? AND succeeded = 0 AND attempted_at >= ?
  `).bind(client, since).first();
  return Number(row?.count || 0) >= MAX_ATTEMPTS;
}

async function recordLoginAttempt(db, client, succeeded) {
  await db.prepare(`
    INSERT INTO dbi_login_attempts (id, client_hash, succeeded, attempted_at)
    VALUES (?, ?, ?, ?)
  `).bind(crypto.randomUUID(), client, succeeded ? 1 : 0, new Date().toISOString()).run();
}

async function statusResponse(request, db, env) {
  if (request.method !== "GET") return json({ error: "Method not allowed" }, 405);
  const [owner, session] = await Promise.all([superUser(db), sessionUser(db, request)]);
  return json({
    enabled: true,
    required: env.DBI_AUTH_REQUIRED !== "0",
    claimed: Boolean(owner),
    registrationEnabled: Boolean(owner),
    user: await publicSessionUser(db, session),
  });
}

async function claimResponse(request, db, env) {
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (await superUser(db)) return json({ error: "The super-user account has already been claimed" }, 409);
  if (env.DBI_ALLOW_FIRST_CLAIM !== "1") return json({ error: "Initial account claim is unavailable" }, 403);
  if (!sameOrigin(request)) return json({ error: "Cross-origin account claim is not allowed" }, 403);

  const body = await safeJson(request);
  const email = normalizeEmail(body?.email);
  const displayName = cleanText(body?.displayName, 80);
  const title = cleanText(body?.title, 80);
  const passwordSalt = cleanText(body?.passwordSalt, 128).toLowerCase();
  const passwordProof = cleanText(body?.passwordProof, 64).toLowerCase();
  if (!email || displayName.length < 2 || !validSalt(passwordSalt) || !validPasswordProof(passwordProof)) {
    return json({ error: "Valid account details are required" }, 400);
  }

  const userId = crypto.randomUUID();
  const now = new Date().toISOString();
  const claimed = await db.prepare(`
    INSERT OR IGNORE INTO dbi_super_user
      (singleton, user_id, email, display_name, title, password_salt, password_hash, created_at, updated_at)
    VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    userId,
    email,
    displayName,
    title,
    passwordSalt,
    `v1$${await hashValue(passwordProof)}`,
    now,
    now,
  ).run();
  if (!Number(claimed?.meta?.changes || 0)) {
    return json({ error: "The super-user account has already been claimed" }, 409);
  }

  await db.prepare(`
    INSERT INTO dbi_users
      (user_id, email, display_name, title, role, status, password_salt, password_hash, must_change_password, created_by, created_at, updated_at, last_login_at)
    VALUES (?, ?, ?, ?, 'super_user', 'active', ?, ?, 0, ?, ?, ?, '')
  `).bind(userId, email, displayName, title, passwordSalt, `v1$${await hashValue(passwordProof)}`, userId, now, now).run();

  await db.batch([
    db.prepare("UPDATE dbi_workspaces SET owner_user_id = ?, updated_at = ? WHERE workspace_id = ?")
      .bind(userId, now, DEFAULT_WORKSPACE_ID),
    db.prepare(`INSERT OR REPLACE INTO dbi_workspace_memberships
      (workspace_id, user_id, role, created_by, created_at, updated_at) VALUES (?, ?, 'super_user', ?, ?, ?)`)
      .bind(DEFAULT_WORKSPACE_ID, userId, userId, now, now),
  ]);

  const session = await createSession(db, userId, DEFAULT_WORKSPACE_ID);
  const claimedUser = {
    user_id: userId,
    email,
    display_name: displayName,
    title,
    role: "super_user",
    status: "active",
    must_change_password: 0,
    created_at: now,
    active_workspace_id: DEFAULT_WORKSPACE_ID,
    membership_role: "super_user",
  };
  return json({ user: await publicSessionUser(db, claimedUser) }, 201, { "set-cookie": sessionCookie(session.rawToken, request, env) });
}

async function registrationResponse(request, db, env) {
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (!sameOrigin(request)) return json({ error: "Cross-origin registration is not allowed" }, 403);
  if (!await superUser(db)) return json({ error: "The Super user must claim the service before registration opens" }, 409);
  const body = await safeJson(request);
  const email = normalizeEmail(body?.email);
  const displayName = cleanText(body?.displayName, 80);
  const title = cleanText(body?.title, 80);
  const passwordSalt = cleanText(body?.passwordSalt, 128).toLowerCase();
  const passwordProof = cleanText(body?.passwordProof, 64).toLowerCase();
  if (!email || displayName.length < 2 || !validSalt(passwordSalt) || !validPasswordProof(passwordProof)) {
    return json({ error: "Valid account details are required" }, 400);
  }
  const count = await db.prepare("SELECT COUNT(*) AS count FROM dbi_users").first();
  if (Number(count?.count || 0) >= 250) return json({ error: "Account registration is temporarily full" }, 409);
  const userId = crypto.randomUUID();
  const now = new Date().toISOString();
  const created = await db.prepare(`
    INSERT OR IGNORE INTO dbi_users
      (user_id, email, display_name, title, role, status, password_salt, password_hash, must_change_password, created_by, created_at, updated_at, last_login_at)
    VALUES (?, ?, ?, ?, 'viewer', 'active', ?, ?, 0, ?, ?, ?, ?)
  `).bind(userId, email, displayName, title, passwordSalt, `v1$${await hashValue(passwordProof)}`, userId, now, now, now).run();
  if (!Number(created?.meta?.changes || 0)) return json({ error: "An account with that email already exists" }, 409);
  const session = await createSession(db, userId);
  const row = await db.prepare("SELECT * FROM dbi_users WHERE user_id = ?").bind(userId).first();
  return json({ user: await publicSessionUser(db, row), expiresAt: session.expiresAt }, 201, {
    "set-cookie": sessionCookie(session.rawToken, request, env),
  });
}

async function loginConfigResponse(request, db) {
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (!sameOrigin(request)) return json({ error: "Cross-origin login is not allowed" }, 403);
  const body = await safeJson(request);
  const email = normalizeEmail(body?.email);
  const user = email ? await userByEmail(db, email) : null;
  const matches = Boolean(user && user.status === "active");
  const fallbackSalt = (await hashValue(`dbi-login:${email || "unknown"}`)).slice(0, 48);
  return json({
    passwordSalt: matches ? user.password_salt : fallbackSalt,
    passwordIterations: PASSWORD_ITERATIONS,
  });
}

async function loginResponse(request, db, env) {
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (!sameOrigin(request)) return json({ error: "Cross-origin login is not allowed" }, 403);
  const body = await safeJson(request);
  const email = normalizeEmail(body?.email);
  const passwordProof = cleanText(body?.passwordProof, 64).toLowerCase();
  const client = await clientHash(request, email);
  if (await loginBlocked(db, client)) {
    return json({ error: "Too many sign-in attempts. Try again in 15 minutes." }, 429);
  }

  const user = email ? await userByEmail(db, email) : null;
  const storedHash = String(user?.password_hash || "");
  const verified = Boolean(
    user
    && user.status === "active"
    && validPasswordProof(passwordProof)
    && storedHash.startsWith("v1$")
    && constantTimeEqual(await hashValue(passwordProof), storedHash.slice(3)),
  );
  await recordLoginAttempt(db, client, verified);
  if (!verified) return json({ error: "Email or password is incorrect" }, 401);

  const now = new Date().toISOString();
  await db.prepare("UPDATE dbi_users SET last_login_at = ?, updated_at = updated_at WHERE user_id = ?").bind(now, user.user_id).run();
  const session = await createSession(db, user.user_id);
  return json({ user: await publicSessionUser(db, { ...user, last_login_at: now, active_workspace_id: session.workspaceId }), expiresAt: session.expiresAt }, 200, {
    "set-cookie": sessionCookie(session.rawToken, request, env),
  });
}

async function logoutResponse(request, db, env) {
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (!sameOrigin(request)) return json({ error: "Cross-origin logout is not allowed" }, 403);
  const rawToken = cookies(request)[SESSION_COOKIE] || "";
  if (rawToken) {
    await db.prepare("UPDATE dbi_sessions SET revoked_at = ? WHERE token_hash = ? AND revoked_at = ''")
      .bind(new Date().toISOString(), await hashValue(rawToken))
      .run();
  }
  return json({ ok: true }, 200, { "set-cookie": sessionCookie("", request, env, 0) });
}

async function profileResponse(request, db) {
  if (request.method !== "PATCH") return json({ error: "Method not allowed" }, 405);
  if (!sameOrigin(request)) return json({ error: "Cross-origin profile changes are not allowed" }, 403);
  const session = await sessionUser(db, request);
  if (!session) return json({ error: "Sign in required" }, 401);
  const body = await safeJson(request, 16_384);
  const displayName = cleanText(body?.displayName, 80);
  const title = cleanText(body?.title, 80);
  const avatarDataUrl = validAvatarDataUrl(body?.avatarDataUrl);
  if (displayName.length < 2) return json({ error: "Display name is required" }, 400);
  if (avatarDataUrl === null) return json({ error: "Profile picture must be a small PNG, JPEG, or WebP image" }, 400);
  const now = new Date().toISOString();
  const statements = [db.prepare(`
    UPDATE dbi_users SET display_name = ?, title = ?, updated_at = ? WHERE user_id = ?
  `).bind(displayName, title, now, session.user_id), db.prepare(`
    INSERT INTO dbi_user_profiles (user_id, avatar_data_url, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET avatar_data_url = excluded.avatar_data_url, updated_at = excluded.updated_at
  `).bind(session.user_id, avatarDataUrl, now)];
  if (session.role === "super_user") statements.push(db.prepare(`
    UPDATE dbi_super_user SET display_name = ?, title = ?, updated_at = ? WHERE user_id = ?
  `).bind(displayName, title, now, session.user_id));
  await db.batch(statements);
  return json({ user: await publicSessionUser(db, { ...session, display_name: displayName, title, avatar_data_url: avatarDataUrl }) });
}

async function passwordResponse(request, db, env) {
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (!sameOrigin(request)) return json({ error: "Cross-origin password changes are not allowed" }, 403);
  const session = await sessionUser(db, request);
  if (!session) return json({ error: "Sign in required" }, 401);
  const body = await safeJson(request);
  const currentPasswordProof = cleanText(body?.currentPasswordProof, 64).toLowerCase();
  const newPasswordProof = cleanText(body?.newPasswordProof, 64).toLowerCase();
  const newPasswordSalt = cleanText(body?.newPasswordSalt, 128).toLowerCase();
  const storedHash = String(session.password_hash || "");
  if (!validPasswordProof(currentPasswordProof)
    || !storedHash.startsWith("v1$")
    || !constantTimeEqual(await hashValue(currentPasswordProof), storedHash.slice(3))) {
    return json({ error: "Current password is incorrect" }, 403);
  }
  if (!validPasswordProof(newPasswordProof) || !validSalt(newPasswordSalt)) {
    return json({ error: "New password is invalid" }, 400);
  }

  const now = new Date().toISOString();
  const passwordHash = `v1$${await hashValue(newPasswordProof)}`;
  const statements = [
    db.prepare(`
      UPDATE dbi_users
      SET password_salt = ?, password_hash = ?, must_change_password = 0, updated_at = ?
      WHERE user_id = ?
    `).bind(newPasswordSalt, passwordHash, now, session.user_id),
    db.prepare("UPDATE dbi_sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at = ''").bind(now, session.user_id),
  ];
  if (session.role === "super_user") statements.push(db.prepare(`
    UPDATE dbi_super_user SET password_salt = ?, password_hash = ?, updated_at = ? WHERE user_id = ?
  `).bind(newPasswordSalt, passwordHash, now, session.user_id));
  await db.batch(statements);
  const nextSession = await createSession(db, session.user_id);
  return json({ ok: true, user: await publicSessionUser(db, { ...session, must_change_password: 0, active_workspace_id: nextSession.workspaceId || session.active_workspace_id }) }, 200, {
    "set-cookie": sessionCookie(nextSession.rawToken, request, env),
  });
}

function managedUser(row) {
  return {
    ...publicUser(row),
    activeSessions: Number(row.active_sessions || 0),
    isOwner: row.role === "super_user",
  };
}

async function usersResponse(request, db) {
  if (!sameOrigin(request)) return json({ error: "Cross-origin user management is not allowed" }, 403);
  const administrator = await sessionUser(db, request);
  if (!administrator) return json({ error: "Sign in required" }, 401);
  if (!canAdministerUsers(administrator)) return json({ error: "Administrator access is required" }, 403);
  const workspaceId = administrator.active_workspace_id;
  if (!workspaceId) return json({ error: "Select a workspace before managing users" }, 409);

  const pathname = new URL(request.url).pathname.replace(/\/+$/, "");
  const prefix = "/api/v1/auth/users";
  const relative = pathname.slice(prefix.length).replace(/^\//, "");
  const [encodedUserId = "", action = ""] = relative.split("/");
  const userId = cleanText(decodeURIComponent(encodedUserId), 80);

  if (request.method === "GET" && !userId) {
    const now = new Date().toISOString();
    const result = await db.prepare(`
      SELECT u.*, membership.role AS membership_role, profile.avatar_data_url, COUNT(s.id) AS active_sessions
      FROM dbi_workspace_memberships membership
      JOIN dbi_users u ON u.user_id = membership.user_id
      LEFT JOIN dbi_user_profiles profile ON profile.user_id = u.user_id
      LEFT JOIN dbi_sessions s
        ON s.user_id = u.user_id AND s.revoked_at = '' AND s.expires_at > ?
      WHERE membership.workspace_id = ?
      GROUP BY u.user_id
      ORDER BY CASE membership.role WHEN 'super_user' THEN 0 WHEN 'administrator' THEN 1 WHEN 'analyst' THEN 2 ELSE 3 END,
        u.display_name COLLATE NOCASE
    `).bind(now, workspaceId).all();
    return json({ users: (result.results || []).map(managedUser), availableRoles: USER_ROLES });
  }

  if (request.method === "POST" && !userId) {
    const body = await safeJson(request);
    const email = normalizeEmail(body?.email);
    const displayName = cleanText(body?.displayName, 80);
    const title = cleanText(body?.title, 80);
    const role = cleanText(body?.role, 32);
    const passwordSalt = cleanText(body?.passwordSalt, 128).toLowerCase();
    const passwordProof = cleanText(body?.passwordProof, 64).toLowerCase();
    if (!email || displayName.length < 2 || !USER_ROLES.includes(role) || !validSalt(passwordSalt) || !validPasswordProof(passwordProof)) {
      return json({ error: "Valid user details, role, and temporary password are required" }, 400);
    }
    const count = await db.prepare("SELECT COUNT(*) AS count FROM dbi_workspace_memberships WHERE workspace_id = ?").bind(workspaceId).first();
    if (Number(count?.count || 0) >= 50) return json({ error: "This workspace is limited to 50 human accounts" }, 409);
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const created = await db.prepare(`
      INSERT OR IGNORE INTO dbi_users
        (user_id, email, display_name, title, role, status, password_salt, password_hash, must_change_password, created_by, created_at, updated_at, last_login_at)
      VALUES (?, ?, ?, ?, ?, 'active', ?, ?, 1, ?, ?, ?, '')
    `).bind(id, email, displayName, title, role, passwordSalt, `v1$${await hashValue(passwordProof)}`, administrator.user_id, now, now).run();
    if (!Number(created?.meta?.changes || 0)) return json({ error: "An account with that email already exists" }, 409);
    await db.prepare(`INSERT INTO dbi_workspace_memberships
      (workspace_id, user_id, role, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`)
      .bind(workspaceId, id, role, administrator.user_id, now, now).run();
    await recordActivity(db, { type: "user", id: administrator.user_id, workspaceId }, "user_created", "user", id, { email, role });
    const row = await db.prepare("SELECT *, ? AS membership_role FROM dbi_users WHERE user_id = ?").bind(role, id).first();
    return json({ user: managedUser(row) }, 201);
  }

  const target = userId ? await db.prepare(`
    SELECT user.*, membership.role AS membership_role, profile.avatar_data_url
    FROM dbi_workspace_memberships membership
    JOIN dbi_users user ON user.user_id = membership.user_id
    LEFT JOIN dbi_user_profiles profile ON profile.user_id = user.user_id
    WHERE membership.workspace_id = ? AND membership.user_id = ?
  `).bind(workspaceId, userId).first() : null;
  if (!target) return json({ error: "User not found" }, 404);
  if (target.role === "super_user") return json({ error: "The Super user account is immutable in user management" }, 403);

  if (request.method === "PATCH" && !action) {
    const body = await safeJson(request);
    const email = normalizeEmail(body?.email);
    const displayName = cleanText(body?.displayName, 80);
    const title = cleanText(body?.title, 80);
    const role = cleanText(body?.role, 32);
    const status = cleanText(body?.status, 32);
    if (!email || displayName.length < 2 || !USER_ROLES.includes(role) || !USER_STATUSES.includes(status)) {
      return json({ error: "Valid user details, role, and status are required" }, 400);
    }
    const now = new Date().toISOString();
    const changed = await db.prepare(`
      UPDATE OR IGNORE dbi_users
      SET email = ?, display_name = ?, title = ?, status = ?, updated_at = ?
      WHERE user_id = ?
    `).bind(email, displayName, title, status, now, userId).run();
    if (!Number(changed?.meta?.changes || 0)) {
      const duplicate = await userByEmail(db, email);
      if (duplicate && duplicate.user_id !== userId) return json({ error: "An account with that email already exists" }, 409);
    }
    if (status === "suspended") {
      await db.prepare("UPDATE dbi_sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at = ''").bind(now, userId).run();
    }
    await db.prepare("UPDATE dbi_workspace_memberships SET role = ?, updated_at = ? WHERE workspace_id = ? AND user_id = ?")
      .bind(role, now, workspaceId, userId).run();
    await recordActivity(db, { type: "user", id: administrator.user_id, workspaceId }, "user_updated", "user", userId, { email, role, status });
    const row = await db.prepare("SELECT *, ? AS membership_role FROM dbi_users WHERE user_id = ?").bind(role, userId).first();
    return json({ user: managedUser(row) });
  }

  if (request.method === "POST" && action === "password") {
    const body = await safeJson(request);
    const passwordSalt = cleanText(body?.passwordSalt, 128).toLowerCase();
    const passwordProof = cleanText(body?.passwordProof, 64).toLowerCase();
    if (!validSalt(passwordSalt) || !validPasswordProof(passwordProof)) return json({ error: "A valid temporary password is required" }, 400);
    const now = new Date().toISOString();
    await db.batch([
      db.prepare(`
        UPDATE dbi_users SET password_salt = ?, password_hash = ?, must_change_password = 1, updated_at = ? WHERE user_id = ?
      `).bind(passwordSalt, `v1$${await hashValue(passwordProof)}`, now, userId),
      db.prepare("UPDATE dbi_sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at = ''").bind(now, userId),
    ]);
    await recordActivity(db, { type: "user", id: administrator.user_id, workspaceId }, "user_password_reset", "user", userId, { email: target.email });
    return json({ ok: true });
  }

  return json({ error: "Method not allowed" }, 405);
}

async function directoryResponse(request, db) {
  if (request.method !== "GET") return json({ error: "Method not allowed" }, 405);
  const user = await sessionUser(db, request);
  if (!user) return json({ error: "Sign in required" }, 401);
  const result = await db.prepare(`
    SELECT user.user_id, user.display_name, user.title, profile.avatar_data_url
    FROM dbi_workspace_memberships membership
    JOIN dbi_users user ON user.user_id = membership.user_id
    LEFT JOIN dbi_user_profiles profile ON profile.user_id = user.user_id
    WHERE membership.workspace_id = ? AND user.status = 'active'
    ORDER BY user.display_name COLLATE NOCASE
  `).bind(user.active_workspace_id).all();
  return json({ users: (result.results || []).map((entry) => ({
    id: entry.user_id,
    displayName: entry.display_name,
    title: entry.title || "",
    avatarDataUrl: entry.avatar_data_url || "",
  })) });
}

function workspaceSummary(row, membership = null, request = null) {
  return {
    id: row.workspace_id,
    name: row.name,
    slug: row.slug,
    description: row.description || "",
    iconDataUrl: row.icon_data_url || "",
    headerEyebrow: row.header_eyebrow || DEFAULT_HEADER_EYEBROW,
    displayTitle: row.display_title || DEFAULT_DISPLAY_TITLE,
    status: row.status,
    ownerUserId: row.owner_user_id || "",
    roleId: membership?.role || null,
    role: membership?.role ? ROLE_LABELS[membership.role] || "Viewer" : null,
    requestStatus: request?.status || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function workspacesResponse(request, db) {
  if (!sameOrigin(request)) return json({ error: "Cross-origin workspace access is not allowed" }, 403);
  const user = await sessionUser(db, request);
  if (!user) return json({ error: "Sign in required" }, 401);
  const pathname = new URL(request.url).pathname.replace(/\/+$/, "");
  const relative = pathname.slice("/api/v1/auth/workspaces".length).replace(/^\//, "");
  const [encodedWorkspaceId = "", action = ""] = relative.split("/");
  const workspaceId = cleanText(decodeURIComponent(encodedWorkspaceId), 80);

  if (request.method === "GET" && !workspaceId) {
    const [workspaceResult, membershipResult, requestResult] = await Promise.all([
      db.prepare(`SELECT workspace.*, settings.icon_data_url, settings.header_eyebrow, settings.display_title
        FROM dbi_workspaces workspace LEFT JOIN dbi_workspace_settings settings ON settings.workspace_id = workspace.workspace_id
        WHERE workspace.status = 'active' ORDER BY workspace.name COLLATE NOCASE`).all(),
      db.prepare("SELECT workspace_id, role FROM dbi_workspace_memberships WHERE user_id = ?").bind(user.user_id).all(),
      db.prepare("SELECT workspace_id, status FROM dbi_workspace_access_requests WHERE user_id = ? ORDER BY created_at DESC").bind(user.user_id).all(),
    ]);
    const memberships = new Map((membershipResult.results || []).map((entry) => [entry.workspace_id, entry]));
    const requests = new Map();
    for (const entry of requestResult.results || []) if (!requests.has(entry.workspace_id)) requests.set(entry.workspace_id, entry);
    return json({
      workspaces: (workspaceResult.results || []).map((workspace) => workspaceSummary(workspace, memberships.get(workspace.workspace_id), requests.get(workspace.workspace_id))),
      activeWorkspaceId: user.active_workspace_id || null,
    });
  }

  const workspace = workspaceId ? await db.prepare("SELECT * FROM dbi_workspaces WHERE workspace_id = ? AND status = 'active'").bind(workspaceId).first() : null;
  if (!workspace) return json({ error: "Workspace not found" }, 404);

  if (request.method === "POST" && action === "request") {
    const existingMembership = await db.prepare("SELECT 1 AS found FROM dbi_workspace_memberships WHERE workspace_id = ? AND user_id = ?")
      .bind(workspaceId, user.user_id).first();
    if (existingMembership) return json({ error: "You already have access to this workspace" }, 409);
    const pending = await db.prepare("SELECT request_id FROM dbi_workspace_access_requests WHERE workspace_id = ? AND user_id = ? AND status = 'pending'")
      .bind(workspaceId, user.user_id).first();
    if (pending) return json({ error: "An access request is already pending" }, 409);
    const body = await safeJson(request);
    const now = new Date().toISOString();
    const requestId = crypto.randomUUID();
    await db.prepare(`INSERT INTO dbi_workspace_access_requests
      (request_id, workspace_id, user_id, note, status, resolved_by, resolved_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'pending', '', '', ?, ?)`)
      .bind(requestId, workspaceId, user.user_id, cleanText(body?.note, 500), now, now).run();
    return json({ request: { id: requestId, workspaceId, status: "pending", createdAt: now } }, 201);
  }

  if (request.method === "POST" && action === "switch") {
    const membership = await db.prepare("SELECT role FROM dbi_workspace_memberships WHERE workspace_id = ? AND user_id = ?")
      .bind(workspaceId, user.user_id).first();
    if (!membership) return json({ error: "Workspace access is required" }, 403);
    const now = new Date().toISOString();
    await db.prepare(`INSERT INTO dbi_session_workspaces (session_id, workspace_id, updated_at) VALUES (?, ?, ?)
      ON CONFLICT(session_id) DO UPDATE SET workspace_id = excluded.workspace_id, updated_at = excluded.updated_at`)
      .bind(user.session_id, workspaceId, now).run();
    return json({ user: await publicSessionUser(db, { ...user, active_workspace_id: workspaceId, membership_role: membership.role }) });
  }

  return json({ error: "Method not allowed" }, 405);
}

async function workspaceAdminResponse(request, db) {
  if (!sameOrigin(request)) return json({ error: "Cross-origin workspace administration is not allowed" }, 403);
  const owner = await sessionUser(db, request);
  if (!owner) return json({ error: "Sign in required" }, 401);
  if (!canAdministerWorkspaces(owner)) return json({ error: "Workspace manager access is required" }, 403);
  const isSuperUser = owner.role === "super_user";
  const pathname = new URL(request.url).pathname.replace(/\/+$/, "");
  const relative = pathname.slice("/api/v1/auth/workspace-admin".length).replace(/^\//, "");
  const segments = relative.split("/").filter(Boolean).map((value) => cleanText(decodeURIComponent(value), 80));

  if (request.method === "GET" && !segments.length) {
    const [workspaceResult, membershipResult, requestResult, userResult] = await Promise.all([
      db.prepare(`SELECT workspace.*, settings.icon_data_url, settings.header_eyebrow, settings.display_title,
        (SELECT COUNT(*) FROM dbi_workspace_memberships membership WHERE membership.workspace_id = workspace.workspace_id) AS member_count,
        (SELECT COUNT(*) FROM dbi_workspace_access_requests access_request WHERE access_request.workspace_id = workspace.workspace_id AND access_request.status = 'pending') AS pending_request_count,
        (SELECT COUNT(*) FROM dbi_workspace_watchlist tracked WHERE tracked.workspace_id = workspace.workspace_id) AS tracked_record_count,
        (SELECT COUNT(*) FROM dbi_workspace_events event WHERE event.workspace_id = workspace.workspace_id) AS event_count,
        (SELECT COUNT(*) FROM dbi_workspace_events event WHERE event.workspace_id = workspace.workspace_id AND event.wallboard = 1) AS wallboard_event_count,
        (SELECT COUNT(*) FROM dbi_workspace_event_milestones milestone WHERE milestone.workspace_id = workspace.workspace_id) AS milestone_count,
        (SELECT COUNT(*) FROM dbi_workspace_manual_records manual WHERE manual.workspace_id = workspace.workspace_id AND manual.deleted_at = '') AS manual_record_count,
        (SELECT COUNT(*) FROM dbi_workspace_activity activity WHERE activity.workspace_id = workspace.workspace_id) AS activity_count,
        (SELECT MAX(activity.occurred_at) FROM dbi_workspace_activity activity WHERE activity.workspace_id = workspace.workspace_id) AS last_activity_at,
        (SELECT COUNT(*) FROM dbi_workspace_agent_keys agent_key WHERE agent_key.workspace_id = workspace.workspace_id AND agent_key.revoked_at = '' AND (agent_key.expires_at = '' OR agent_key.expires_at > CURRENT_TIMESTAMP)) AS active_agent_key_count
        FROM dbi_workspaces workspace
        LEFT JOIN dbi_workspace_settings settings ON settings.workspace_id = workspace.workspace_id
        WHERE (? = 1 OR workspace.workspace_id = ?)
        ORDER BY workspace.status, workspace.name COLLATE NOCASE`).bind(isSuperUser ? 1 : 0, owner.active_workspace_id || "").all(),
      db.prepare(`SELECT membership.*, user.email, user.display_name, user.title, user.status, profile.avatar_data_url
        FROM dbi_workspace_memberships membership JOIN dbi_users user ON user.user_id = membership.user_id
        LEFT JOIN dbi_user_profiles profile ON profile.user_id = user.user_id
        WHERE (? = 1 OR membership.workspace_id = ?)
        ORDER BY user.display_name COLLATE NOCASE`).bind(isSuperUser ? 1 : 0, owner.active_workspace_id || "").all(),
      db.prepare(`SELECT access_request.*, user.email, user.display_name, user.title, workspace.name AS workspace_name
        FROM dbi_workspace_access_requests access_request
        JOIN dbi_users user ON user.user_id = access_request.user_id
        JOIN dbi_workspaces workspace ON workspace.workspace_id = access_request.workspace_id
        WHERE (? = 1 OR access_request.workspace_id = ?)
        ORDER BY CASE access_request.status WHEN 'pending' THEN 0 ELSE 1 END, access_request.created_at DESC`).bind(isSuperUser ? 1 : 0, owner.active_workspace_id || "").all(),
      db.prepare(`SELECT user.user_id, user.email, user.display_name, user.title, user.status, profile.avatar_data_url
        FROM dbi_users user LEFT JOIN dbi_user_profiles profile ON profile.user_id = user.user_id
        WHERE user.status = 'active' ORDER BY user.display_name COLLATE NOCASE`).all(),
    ]);
    const memberships = membershipResult.results || [];
    return json({
      workspaces: (workspaceResult.results || []).map((workspace) => ({
        ...workspaceSummary(workspace),
        pendingRequestCount: Number(workspace.pending_request_count || 0),
        lastActivityAt: workspace.last_activity_at || null,
        contents: {
          trackedRecords: Number(workspace.tracked_record_count || 0),
          events: Number(workspace.event_count || 0),
          wallboardEvents: Number(workspace.wallboard_event_count || 0),
          milestones: Number(workspace.milestone_count || 0),
          manualRecords: Number(workspace.manual_record_count || 0),
          activityEntries: Number(workspace.activity_count || 0),
          activeAgentKeys: Number(workspace.active_agent_key_count || 0),
        },
        members: memberships.filter((entry) => entry.workspace_id === workspace.workspace_id).map((entry) => ({
          id: entry.user_id, email: entry.email, displayName: entry.display_name, title: entry.title || "",
          avatarDataUrl: entry.avatar_data_url || "", status: entry.status, roleId: entry.role, role: ROLE_LABELS[entry.role] || "Viewer",
        })),
      })),
      requests: (requestResult.results || []).map((entry) => ({
        id: entry.request_id, workspaceId: entry.workspace_id, workspaceName: entry.workspace_name,
        userId: entry.user_id, email: entry.email, displayName: entry.display_name, title: entry.title || "",
        note: entry.note || "", status: entry.status, createdAt: entry.created_at, resolvedAt: entry.resolved_at || null,
      })),
      users: (userResult.results || []).map((entry) => ({
        id: entry.user_id, email: entry.email, displayName: entry.display_name, title: entry.title || "",
        avatarDataUrl: entry.avatar_data_url || "", status: entry.status,
      })),
      availableRoles: USER_ROLES,
    });
  }

  if (request.method === "POST" && segments[0] === "workspaces" && segments.length === 1) {
    if (!isSuperUser) return json({ error: "Super user access is required to create workspaces" }, 403);
    const body = await safeJson(request);
    const name = cleanText(body?.name, 80);
    const description = cleanText(body?.description, 240);
    const slug = cleanText(body?.slug || name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""), 80).toLowerCase();
    if (name.length < 2 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) return json({ error: "A valid workspace name is required" }, 400);
    const count = await db.prepare("SELECT COUNT(*) AS count FROM dbi_workspaces WHERE status = 'active'").first();
    if (Number(count?.count || 0) >= 25) return json({ error: "Archive a workspace before creating another" }, 409);
    const workspaceId = crypto.randomUUID();
    const now = new Date().toISOString();
    const created = await db.prepare(`INSERT OR IGNORE INTO dbi_workspaces
      (workspace_id, name, slug, description, status, owner_user_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'active', ?, ?, ?)`)
      .bind(workspaceId, name, slug, description, owner.user_id, now, now).run();
    if (!Number(created?.meta?.changes || 0)) return json({ error: "A workspace with that name already exists" }, 409);
    await db.batch([
      db.prepare(`INSERT INTO dbi_workspace_memberships
        (workspace_id, user_id, role, created_by, created_at, updated_at) VALUES (?, ?, 'super_user', ?, ?, ?)`)
        .bind(workspaceId, owner.user_id, owner.user_id, now, now),
      db.prepare(`INSERT INTO dbi_workspace_settings (workspace_id, icon_data_url, header_eyebrow, display_title, updated_at)
        VALUES (?, '', ?, ?, ?)`).bind(workspaceId, DEFAULT_HEADER_EYEBROW, DEFAULT_DISPLAY_TITLE, now),
    ]);
    await recordActivity(db, { type: "user", id: owner.user_id, workspaceId }, "workspace_created", "workspace", workspaceId, { name });
    const row = await db.prepare("SELECT * FROM dbi_workspaces WHERE workspace_id = ?").bind(workspaceId).first();
    return json({ workspace: workspaceSummary(row, { role: "super_user" }) }, 201);
  }

  if (request.method === "PATCH" && segments[0] === "workspaces" && segments[1] && segments.length === 2) {
    const workspaceId = segments[1];
    if (!await canAdministerWorkspace(db, owner, workspaceId)) return json({ error: "Workspace manager access is required" }, 403);
    const workspace = await db.prepare("SELECT * FROM dbi_workspaces WHERE workspace_id = ?").bind(workspaceId).first();
    if (!workspace) return json({ error: "Workspace not found" }, 404);
    const body = await safeJson(request);
    const name = cleanText(body?.name, 80);
    const description = cleanText(body?.description, 240);
    const iconDataUrl = validAvatarDataUrl(body?.iconDataUrl);
    const headerEyebrow = cleanText(body?.headerEyebrow || DEFAULT_HEADER_EYEBROW, 80);
    const displayTitle = cleanText(body?.displayTitle || DEFAULT_DISPLAY_TITLE, 80);
    if (name.length < 2) return json({ error: "A valid workspace name is required" }, 400);
    if (iconDataUrl === null || headerEyebrow.length < 2 || displayTitle.length < 2) return json({ error: "Valid workspace branding is required" }, 400);
    const duplicate = await db.prepare("SELECT workspace_id FROM dbi_workspaces WHERE LOWER(name) = LOWER(?) AND workspace_id <> ?")
      .bind(name, workspaceId).first();
    if (duplicate) return json({ error: "A workspace with that name already exists" }, 409);
    const now = new Date().toISOString();
    await db.batch([
      db.prepare("UPDATE dbi_workspaces SET name = ?, description = ?, updated_at = ? WHERE workspace_id = ?")
        .bind(name, description, now, workspaceId),
      db.prepare(`INSERT INTO dbi_workspace_settings (workspace_id, icon_data_url, header_eyebrow, display_title, updated_at)
        VALUES (?, ?, ?, ?, ?) ON CONFLICT(workspace_id) DO UPDATE SET icon_data_url = excluded.icon_data_url,
        header_eyebrow = excluded.header_eyebrow, display_title = excluded.display_title, updated_at = excluded.updated_at`)
        .bind(workspaceId, iconDataUrl, headerEyebrow, displayTitle, now),
    ]);
    await recordActivity(db, { type: "user", id: owner.user_id, workspaceId }, "workspace_updated", "workspace", workspaceId, { previousName: workspace.name, name, description });
    const row = await db.prepare(`SELECT workspace.*, settings.icon_data_url, settings.header_eyebrow, settings.display_title
      FROM dbi_workspaces workspace LEFT JOIN dbi_workspace_settings settings ON settings.workspace_id = workspace.workspace_id
      WHERE workspace.workspace_id = ?`).bind(workspaceId).first();
    return json({ workspace: workspaceSummary(row) });
  }

  if (request.method === "POST" && segments[0] === "requests" && segments[1]) {
    const accessRequest = await db.prepare("SELECT * FROM dbi_workspace_access_requests WHERE request_id = ?").bind(segments[1]).first();
    if (!accessRequest) return json({ error: "Access request not found" }, 404);
    if (accessRequest.status !== "pending") return json({ error: "Access request is already resolved" }, 409);
    if (!await canAdministerWorkspace(db, owner, accessRequest.workspace_id)) return json({ error: "Workspace manager access is required" }, 403);
    const body = await safeJson(request);
    const decision = cleanText(body?.decision, 20);
    const role = cleanText(body?.role, 32) || "viewer";
    if (!["approved", "denied"].includes(decision) || (decision === "approved" && !USER_ROLES.includes(role))) {
      return json({ error: "A valid approval decision and role are required" }, 400);
    }
    const now = new Date().toISOString();
    const statements = [db.prepare(`UPDATE dbi_workspace_access_requests
      SET status = ?, resolved_by = ?, resolved_at = ?, updated_at = ? WHERE request_id = ?`)
      .bind(decision, owner.user_id, now, now, accessRequest.request_id)];
    if (decision === "approved") {
      statements.push(db.prepare(`INSERT INTO dbi_workspace_memberships
        (workspace_id, user_id, role, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(workspace_id, user_id) DO UPDATE SET role = excluded.role, updated_at = excluded.updated_at`)
        .bind(accessRequest.workspace_id, accessRequest.user_id, role, owner.user_id, now, now));
      statements.push(db.prepare(`INSERT OR IGNORE INTO dbi_session_workspaces (session_id, workspace_id, updated_at)
        SELECT session.id, ?, ? FROM dbi_sessions session
        LEFT JOIN dbi_session_workspaces active ON active.session_id = session.id
        WHERE session.user_id = ? AND active.session_id IS NULL`).bind(accessRequest.workspace_id, now, accessRequest.user_id));
    }
    await db.batch(statements);
    await recordActivity(db, { type: "user", id: owner.user_id, workspaceId: accessRequest.workspace_id }, `workspace_request_${decision}`, "workspace_request", accessRequest.request_id, { userId: accessRequest.user_id, role });
    return json({ ok: true, status: decision });
  }

  if (segments[0] === "workspaces" && segments[1] && segments[2] === "members") {
    const workspaceId = segments[1];
    if (!await canAdministerWorkspace(db, owner, workspaceId)) return json({ error: "Workspace manager access is required" }, 403);
    const workspace = await db.prepare("SELECT * FROM dbi_workspaces WHERE workspace_id = ? AND status = 'active'").bind(workspaceId).first();
    if (!workspace) return json({ error: "Workspace not found" }, 404);
    if (request.method === "POST" && segments.length === 3) {
      const body = await safeJson(request);
      const userId = cleanText(body?.userId, 80);
      const role = cleanText(body?.role, 32);
      const target = await db.prepare("SELECT * FROM dbi_users WHERE user_id = ? AND status = 'active'").bind(userId).first();
      if (!target || !USER_ROLES.includes(role)) return json({ error: "An active user and valid role are required" }, 400);
      if (target.role === "super_user") return json({ error: "The Super user membership is immutable" }, 403);
      const now = new Date().toISOString();
      const existing = await db.prepare("SELECT role FROM dbi_workspace_memberships WHERE workspace_id = ? AND user_id = ?").bind(workspaceId, userId).first();
      await db.prepare(`INSERT INTO dbi_workspace_memberships
        (workspace_id, user_id, role, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(workspace_id, user_id) DO UPDATE SET role = excluded.role, updated_at = excluded.updated_at`)
        .bind(workspaceId, userId, role, owner.user_id, now, now).run();
      await recordActivity(db, { type: "user", id: owner.user_id, workspaceId }, existing ? "workspace_member_role_changed" : "workspace_member_added", "user", userId, { role, previousRole: existing?.role || null });
      return json({ ok: true }, existing ? 200 : 201);
    }
    if (request.method === "DELETE" && segments[3]) {
      const userId = segments[3];
      const membership = await db.prepare("SELECT role FROM dbi_workspace_memberships WHERE workspace_id = ? AND user_id = ?").bind(workspaceId, userId).first();
      if (!membership) return json({ error: "Workspace member not found" }, 404);
      if (membership.role === "super_user") return json({ error: "The Super user cannot be removed from a workspace" }, 403);
      const now = new Date().toISOString();
      await db.batch([
        db.prepare("DELETE FROM dbi_workspace_memberships WHERE workspace_id = ? AND user_id = ?").bind(workspaceId, userId),
        db.prepare(`DELETE FROM dbi_session_workspaces WHERE workspace_id = ? AND session_id IN
          (SELECT id FROM dbi_sessions WHERE user_id = ?)` ).bind(workspaceId, userId),
        db.prepare("DELETE FROM dbi_workspace_event_attendees WHERE workspace_id = ? AND user_id = ?").bind(workspaceId, userId),
        db.prepare("UPDATE dbi_workspace_agent_keys SET revoked_at = ? WHERE workspace_id = ? AND created_by = ? AND revoked_at = ''").bind(now, workspaceId, userId),
      ]);
      await recordActivity(db, { type: "user", id: owner.user_id, workspaceId }, "workspace_member_removed", "user", userId);
      return json({ ok: true });
    }
  }

  return json({ error: "Method not allowed" }, 405);
}

function agentJson(data, status = 200, meta = {}, headers = {}) {
  return Response.json({ apiVersion: AGENT_API_VERSION, data, meta }, {
    status,
    headers: { "cache-control": "no-store", ...headers },
  });
}

function agentError(code, message, status = 400, requestId = crypto.randomUUID(), details = undefined) {
  return Response.json({
    apiVersion: AGENT_API_VERSION,
    error: { code, message, requestId, ...(details === undefined ? {} : { details }) },
  }, { status, headers: { "cache-control": "no-store" } });
}

function parsedScopes(value) {
  try {
    const scopes = JSON.parse(value || "[]");
    return Array.isArray(scopes) ? scopes.filter((scope) => AGENT_SCOPES.includes(scope)) : [];
  } catch {
    return [];
  }
}

async function requestPrincipal(db, request) {
  const session = await sessionUser(db, request);
  if (session) return {
    type: "user",
    id: session.user_id,
    name: session.display_name,
    workspaceId: session.active_workspace_id || "",
    scopes: session.must_change_password || !session.active_workspace_id
      ? []
      : scopesForRole(session.role === "super_user" ? "super_user" : session.membership_role),
  };
  const authorization = request.headers.get("authorization") || "";
  const rawToken = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  if (!rawToken.startsWith(AGENT_TOKEN_PREFIX) || rawToken.length < 72) return null;
  const now = new Date().toISOString();
  const row = await db.prepare(`
    SELECT * FROM dbi_workspace_agent_keys
    WHERE token_hash = ? AND revoked_at = '' AND (expires_at = '' OR expires_at > ?)
  `).bind(await hashValue(rawToken), now).first();
  if (!row) return null;
  await db.prepare("UPDATE dbi_workspace_agent_keys SET last_used_at = ? WHERE id = ?").bind(now, row.id).run();
  return { type: "agent", id: row.id, name: row.name, workspaceId: row.workspace_id, scopes: parsedScopes(row.scopes_json) };
}

function hasScope(principal, scope) {
  return Boolean(principal?.scopes?.includes(scope));
}

async function rateLimited(db, principal) {
  if (principal.type === "user") return false;
  const bucket = new Date().toISOString().slice(0, 16);
  await db.prepare(`
    INSERT INTO dbi_agent_rate_limits (principal_id, minute_bucket, request_count)
    VALUES (?, ?, 1)
    ON CONFLICT(principal_id, minute_bucket)
    DO UPDATE SET request_count = request_count + 1
  `).bind(principal.id, bucket).run();
  const row = await db.prepare(`
    SELECT request_count FROM dbi_agent_rate_limits WHERE principal_id = ? AND minute_bucket = ?
  `).bind(principal.id, bucket).first();
  if (Number(row?.request_count || 0) === 1) {
    const cutoff = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString().slice(0, 16);
    await db.prepare("DELETE FROM dbi_agent_rate_limits WHERE minute_bucket < ?").bind(cutoff).run();
  }
  return Number(row?.request_count || 0) > AGENT_RATE_LIMIT;
}

async function recordActivity(db, principal, action, entityType, entityId = "", detail = {}) {
  if (!principal.workspaceId) return;
  await db.prepare(`
    INSERT INTO dbi_workspace_activity
      (id, workspace_id, actor_type, actor_id, action, entity_type, entity_id, detail_json, occurred_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    crypto.randomUUID(), principal.workspaceId, principal.type, principal.id, cleanText(action, 80), cleanText(entityType, 80),
    cleanText(entityId, 180), JSON.stringify(detail || {}).slice(0, 8_000), new Date().toISOString(),
  ).run();
}

function cleanDate(value) {
  const text = cleanText(value, 32);
  if (!text) return "";
  return /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d{3})?)?Z?)?$/.test(text) ? text : "";
}

function cleanStringArray(value, limit = 50, itemLength = 180) {
  return [...new Set((Array.isArray(value) ? value : []).map((item) => cleanText(item, itemLength)).filter(Boolean))].slice(0, limit);
}

function boundedInteger(value, fallback, minimum, maximum) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) ? Math.min(maximum, Math.max(minimum, parsed)) : fallback;
}

function publicAgentKey(row) {
  return {
    id: row.id,
    name: row.name,
    scopes: parsedScopes(row.scopes_json),
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at || null,
    expiresAt: row.expires_at || null,
    revokedAt: row.revoked_at || null,
  };
}

async function agentKeysResponse(request, db) {
  if (!sameOrigin(request)) return json({ error: "Cross-origin credential management is not allowed" }, 403);
  const session = await sessionUser(db, request);
  if (!session) return json({ error: "Sign in required" }, 401);
  if (!canAdministerUsers(session)) return json({ error: "Administrator access is required" }, 403);
  if (!session.active_workspace_id) return json({ error: "Select a workspace before managing agent credentials" }, 409);
  const workspaceId = session.active_workspace_id;
  const pathname = new URL(request.url).pathname.replace(/\/+$/, "");
  const prefix = "/api/v1/auth/agent-keys";
  const keyId = cleanText(decodeURIComponent(pathname.slice(prefix.length).replace(/^\//, "")), 80);
  if (request.method === "GET" && !keyId) {
    const result = await db.prepare("SELECT * FROM dbi_workspace_agent_keys WHERE workspace_id = ? ORDER BY created_at DESC").bind(workspaceId).all();
    return json({ keys: (result.results || []).map(publicAgentKey), availableScopes: AGENT_SCOPES });
  }
  if (request.method === "POST" && !keyId) {
    const body = await safeJson(request);
    const name = cleanText(body?.name, 80);
    const scopes = cleanStringArray(body?.scopes).filter((scope) => AGENT_SCOPES.includes(scope));
    const expiresInput = cleanText(body?.expiresAt, 64);
    const expiresDate = expiresInput ? new Date(expiresInput) : null;
    const expiresAt = expiresDate && !Number.isNaN(expiresDate.getTime()) ? expiresDate.toISOString() : "";
    if (name.length < 2 || !scopes.length) return json({ error: "A name and at least one valid scope are required" }, 400);
    if (expiresInput && (!expiresAt || expiresDate.getTime() <= Date.now())) return json({ error: "Expiration must be a valid future date and time" }, 400);
    const active = await db.prepare("SELECT COUNT(*) AS count FROM dbi_workspace_agent_keys WHERE workspace_id = ? AND revoked_at = '' AND (expires_at = '' OR expires_at > ?)").bind(workspaceId, new Date().toISOString()).first();
    if (Number(active?.count || 0) >= 25) return json({ error: "Revoke an existing agent credential before creating another" }, 409);
    const id = crypto.randomUUID();
    const token = `${AGENT_TOKEN_PREFIX}${id}.${randomHex(32)}`;
    const now = new Date().toISOString();
    await db.prepare(`
      INSERT INTO dbi_workspace_agent_keys
        (id, workspace_id, name, token_hash, scopes_json, created_by, created_at, last_used_at, expires_at, revoked_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, '', ?, '')
    `).bind(id, workspaceId, name, await hashValue(token), JSON.stringify(scopes), session.user_id, now, expiresAt).run();
    await recordActivity(db, { type: "user", id: session.user_id, workspaceId }, "agent_key_created", "agent_key", id, { name, scopes });
    return json({ key: { id, name, scopes, createdAt: now, expiresAt: expiresAt || null }, token }, 201);
  }
  if (request.method === "DELETE" && keyId) {
    const now = new Date().toISOString();
    const changed = await db.prepare("UPDATE dbi_workspace_agent_keys SET revoked_at = ? WHERE id = ? AND workspace_id = ? AND revoked_at = ''")
      .bind(now, keyId, workspaceId).run();
    if (!Number(changed?.meta?.changes || 0)) return json({ error: "Agent credential not found or already revoked" }, 404);
    await recordActivity(db, { type: "user", id: session.user_id, workspaceId }, "agent_key_revoked", "agent_key", keyId);
    return json({ ok: true });
  }
  return json({ error: "Method not allowed" }, 405);
}

async function assetJson(request, env, path) {
  const url = new URL(path, request.url);
  const response = env.ASSETS?.fetch ? await env.ASSETS.fetch(new Request(url)) : await fetch(url);
  if (!response.ok) throw new Error(`Runtime data unavailable: ${path}`);
  return response.json();
}

function manualRecordPayload(body, id, version, createdAt, updatedAt) {
  const title = cleanText(body?.title, 240);
  if (title.length < 3) return null;
  const workCategories = cleanStringArray(body?.workCategories, 3, 80);
  const sourceUrls = cleanStringArray(body?.sourceUrls, 20, 1000).filter((value) => /^https:\/\//i.test(value));
  return {
    opportunityId: id,
    id: cleanText(body?.id, 100) || id.replace("manual_agent_", "MAN-").slice(0, 24),
    title,
    context: cleanText(body?.context, 2000),
    portfolio: cleanText(body?.portfolio, 160) || "Manual agent import",
    party: cleanText(body?.party, 200),
    owner: cleanText(body?.owner, 200),
    fundingOffice: cleanText(body?.fundingOffice, 200),
    contractingOffice: cleanText(body?.contractingOffice, 200),
    reference: cleanText(body?.reference, 160),
    parentReference: cleanText(body?.parentReference, 160),
    sourceSystem: cleanText(body?.sourceSystem, 120) || "agent-api",
    sourceUrls,
    start: cleanDate(body?.start),
    currentEnd: cleanDate(body?.currentEnd),
    potentialEnd: cleanDate(body?.potentialEnd),
    solicitationStart: cleanDate(body?.solicitationStart),
    solicitationEnd: cleanDate(body?.solicitationEnd),
    obligatedAmount: Number.isFinite(Number(body?.obligatedAmount)) ? Number(body.obligatedAmount) : 0,
    potentialAmount: Number.isFinite(Number(body?.potentialAmount)) ? Number(body.potentialAmount) : 0,
    workCategory: cleanText(body?.workCategory, 80) || workCategories[0] || "other-unclassified",
    workCategories,
    workCategoryBasis: cleanText(body?.workCategoryBasis, 500) || "Operator-supplied manual classification",
    workCategoryConfidence: "manual",
    ingestionMethod: "manual",
    ingestionLabel: "Agent API manual import",
    ingestionChannels: [{ id: "agent-api", label: "Authenticated agent API", method: "manual" }],
    evidenceTier: "operator-entered",
    lifecycleStatus: cleanText(body?.lifecycleStatus, 100) || "schedule-not-published",
    manual: true,
    version,
    createdAt,
    updatedAt,
  };
}

async function allAgentRecords(request, env, db, workspaceId) {
  const source = await assetJson(request, env, "/data/agent-records.json");
  const stored = await db.prepare("SELECT * FROM dbi_workspace_manual_records WHERE workspace_id = ? AND deleted_at = '' ORDER BY created_at").bind(workspaceId).all();
  const manual = (stored.results || []).flatMap((row) => {
    try { return [{ ...JSON.parse(row.payload_json), version: row.version, createdAt: row.created_at, updatedAt: row.updated_at, manual: true }]; }
    catch { return []; }
  });
  return { metadata: source.metadata || {}, records: [...(source.records || []), ...manual] };
}

function recordProjection(record) {
  return {
    opportunityId: record.opportunityId,
    id: record.id,
    title: record.title,
    portfolio: record.portfolio,
    party: record.party,
    owner: record.owner,
    reference: record.reference,
    sourceSystem: record.sourceSystem,
    sourceUrls: record.sourceUrls || [],
    workCategory: record.workCategory,
    workCategories: record.workCategories || [],
    ingestionMethod: record.ingestionMethod,
    lifecycleStatus: record.lifecycleStatus,
    evidenceTier: record.evidenceTier,
    start: record.start,
    currentEnd: record.currentEnd,
    potentialEnd: record.potentialEnd,
    solicitationStart: record.solicitationStart,
    solicitationEnd: record.solicitationEnd,
    obligatedAmount: Number(record.obligatedAmount || record.fpdsObligatedAmount || 0),
    potentialAmount: Number(record.potentialAmount || record.fpdsPotentialAmount || 0),
    manual: Boolean(record.manual),
    version: Number(record.version || 0),
    updatedAt: record.updatedAt || record.validationCheckedAt || null,
  };
}

function eventFromRow(row, attendees = [], milestones = []) {
  let recordIds = [];
  try { recordIds = JSON.parse(row.record_ids_json || "[]"); } catch { /* empty */ }
  return {
    id: row.id, title: row.title, startsAt: row.starts_at, endsAt: row.ends_at || "",
    location: row.location || "", notes: row.notes || "", status: row.status,
    recordIds, attendees, attendeeIds: attendees.map((attendee) => attendee.id), milestones, wallboard: Boolean(row.wallboard), version: row.version,
    createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

async function eventsFromRows(db, workspaceId, rows = []) {
  if (!rows.length) return [];
  const ids = rows.map((row) => row.id);
  const placeholders = ids.map(() => "?").join(", ");
  const attendeeResult = await db.prepare(`
    SELECT attendee.event_id, user.user_id, user.display_name, user.title, user.status, profile.avatar_data_url
    FROM dbi_workspace_event_attendees attendee
    JOIN dbi_users user ON user.user_id = attendee.user_id
    LEFT JOIN dbi_user_profiles profile ON profile.user_id = user.user_id
    WHERE attendee.workspace_id = ? AND attendee.event_id IN (${placeholders})
    ORDER BY user.display_name COLLATE NOCASE
  `).bind(workspaceId, ...ids).all();
  const milestoneResult = await db.prepare(`
    SELECT event_id, milestone_id, type, label, occurs_at, notes
    FROM dbi_workspace_event_milestones
    WHERE workspace_id = ? AND event_id IN (${placeholders})
    ORDER BY occurs_at, milestone_id
  `).bind(workspaceId, ...ids).all();
  const attendeesByEvent = new Map();
  for (const attendee of attendeeResult.results || []) {
    const people = attendeesByEvent.get(attendee.event_id) || [];
    people.push({ id: attendee.user_id, displayName: attendee.display_name, title: attendee.title || "", status: attendee.status, avatarDataUrl: attendee.avatar_data_url || "" });
    attendeesByEvent.set(attendee.event_id, people);
  }
  const milestonesByEvent = new Map();
  for (const milestone of milestoneResult.results || []) {
    const items = milestonesByEvent.get(milestone.event_id) || [];
    items.push({ id: milestone.milestone_id, type: milestone.type, label: milestone.label || "", occursAt: milestone.occurs_at, notes: milestone.notes || "" });
    milestonesByEvent.set(milestone.event_id, items);
  }
  return rows.map((row) => eventFromRow(row, attendeesByEvent.get(row.id) || [], milestonesByEvent.get(row.id) || []));
}

const EVENT_MILESTONE_TYPES = new Set(["registration_deadline", "refund_deadline", "hotel_deadline", "exhibitor_deadline", "submission_deadline", "other"]);

function cleanEventMilestones(value) {
  if (!Array.isArray(value)) return { milestones: [], valid: false };
  const ids = new Set();
  const milestones = [];
  for (const [index, candidate] of value.slice(0, 24).entries()) {
    const id = cleanText(candidate?.id, 100) || `milestone-${index + 1}`;
    const type = EVENT_MILESTONE_TYPES.has(candidate?.type) ? candidate.type : "other";
    const label = cleanText(candidate?.label, 120);
    const occursAt = cleanDate(candidate?.occursAt || candidate?.date);
    const notes = cleanText(candidate?.notes, 500);
    if (!occursAt || ids.has(id) || (type === "other" && !label)) return { milestones: [], valid: false };
    ids.add(id);
    milestones.push({ id, type, label, occursAt, notes });
  }
  return { milestones, valid: value.length <= 24 };
}

async function activeEventAttendeeIds(db, workspaceId, value) {
  const ids = cleanStringArray(value, 30, 80);
  if (!ids.length) return { ids: [], valid: true };
  const placeholders = ids.map(() => "?").join(", ");
  const result = await db.prepare(`
    SELECT user.user_id FROM dbi_users user
    JOIN dbi_workspace_memberships membership ON membership.user_id = user.user_id
    WHERE membership.workspace_id = ? AND user.status = 'active' AND user.user_id IN (${placeholders})
  `).bind(workspaceId, ...ids).all();
  const active = new Set((result.results || []).map((row) => row.user_id));
  return { ids: ids.filter((id) => active.has(id)), valid: active.size === ids.length };
}

async function replaceEventAttendees(db, workspaceId, eventId, attendeeIds) {
  await db.prepare("DELETE FROM dbi_workspace_event_attendees WHERE workspace_id = ? AND event_id = ?").bind(workspaceId, eventId).run();
  const createdAt = new Date().toISOString();
  for (const userId of attendeeIds) {
    await db.prepare("INSERT INTO dbi_workspace_event_attendees (workspace_id, event_id, user_id, created_at) VALUES (?, ?, ?, ?)").bind(workspaceId, eventId, userId, createdAt).run();
  }
}

async function replaceEventMilestones(db, workspaceId, eventId, milestones) {
  await db.prepare("DELETE FROM dbi_workspace_event_milestones WHERE workspace_id = ? AND event_id = ?").bind(workspaceId, eventId).run();
  const now = new Date().toISOString();
  for (const milestone of milestones) {
    await db.prepare(`INSERT INTO dbi_workspace_event_milestones
      (workspace_id, event_id, milestone_id, type, label, occurs_at, notes, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(workspaceId, eventId, milestone.id, milestone.type, milestone.label, milestone.occursAt, milestone.notes, now, now).run();
  }
}

function trackingFromRow(row) {
  return {
    recordId: row.record_id, note: row.note || "", reviewAt: row.review_at || "",
    wallboard: Boolean(row.wallboard), version: row.version,
    starredAt: row.created_at, createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

function expectedVersion(request, body) {
  const header = cleanText(request.headers.get("if-match"), 32).replaceAll('"', "");
  const candidate = header || body?.version;
  return candidate === undefined || candidate === null || candidate === "" ? null : Number(candidate);
}

async function idempotent(db, principal, request, handler) {
  const key = cleanText(request.headers.get("idempotency-key"), 180);
  if (!key) return agentError("idempotency_key_required", "Idempotency-Key is required for this operation", 400);
  const fingerprint = await hashValue(`${request.method}|${new URL(request.url).pathname}|${await request.clone().text()}`);
  const principalKey = `${principal.workspaceId}:${principal.id}`;
  const existing = await db.prepare(`
    SELECT * FROM dbi_agent_idempotency WHERE principal_id = ? AND idempotency_key = ?
  `).bind(principalKey, key).first();
  if (existing) {
    if (existing.request_fingerprint !== fingerprint) return agentError("idempotency_conflict", "This idempotency key was used for a different request", 409);
    return new Response(existing.response_body, { status: existing.response_status, headers: { "content-type": "application/json", "cache-control": "no-store", "idempotent-replay": "true" } });
  }
  const response = await handler();
  if (response.status < 500) {
    await db.prepare(`
      INSERT INTO dbi_agent_idempotency
        (principal_id, idempotency_key, request_fingerprint, response_status, response_body, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).bind(principalKey, key, fingerprint, response.status, await response.clone().text(), new Date().toISOString()).run();
  }
  return response;
}

function openApiDocument(origin) {
  const security = [{ bearerAuth: [] }, { cookieAuth: [] }];
  const paths = {
    "/api/v1/agent/capabilities": { get: { summary: "Discover API capabilities", security } },
    "/api/v1/agent/records": { get: { summary: "Query factual and manual records", security }, post: { summary: "Create a manual record", security } },
    "/api/v1/agent/records/{recordId}": { get: { summary: "Read one record", security }, patch: { summary: "Update a manual record", security }, delete: { summary: "Delete a manual record", security } },
    "/api/v1/agent/tracking": { get: { summary: "List tracked records", security } },
    "/api/v1/agent/tracking/{recordId}": { put: { summary: "Track or update a record", security }, delete: { summary: "Stop tracking a record", security } },
    "/api/v1/agent/events": { get: { summary: "List operator events", security }, post: { summary: "Create an operator event", security } },
    "/api/v1/agent/events/{eventId}": { get: { summary: "Read an event", security }, patch: { summary: "Update an event", security }, delete: { summary: "Delete an event", security } },
    "/api/v1/agent/activity": { get: { summary: "Read append-only audit activity", security }, post: { summary: "Append an agent activity note", security } },
    "/api/v1/agent/integrations": { get: { summary: "Read integration status", security } },
    "/api/v1/agent/analytics": { get: { summary: "Aggregate the factual record universe by a bounded dimension and measure", security } },
  };
  return {
    openapi: "3.1.0",
    info: { title: "Defense Budget Intelligence Agent API", version: "1.0.0", description: "Authenticated factual evidence and workspace-management API." },
    servers: [{ url: origin }],
    paths,
    components: { securitySchemes: {
      bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "DBI agent token" },
      cookieAuth: { type: "apiKey", in: "cookie", name: SESSION_COOKIE },
    } },
  };
}

const ANALYTICS_DIMENSIONS = Object.freeze([
  "portfolio", "party", "owner", "fundingOffice", "contractingOffice", "workCategory",
  "sourceSystem", "lifecycleStatus", "evidenceTier",
]);
const ANALYTICS_MEASURES = Object.freeze(["records", "obligatedAmount", "potentialAmount"]);

async function analyticsResponse(request, env, db, principal) {
  if (request.method !== "GET") return agentError("method_not_allowed", "Method not allowed", 405);
  if (!hasScope(principal, "records:read")) return agentError("insufficient_scope", "Scope records:read is required", 403);
  const params = new URL(request.url).searchParams;
  const dimensionCandidate = cleanText(params.get("dimension"), 40);
  const measureCandidate = cleanText(params.get("measure"), 40);
  const dimension = ANALYTICS_DIMENSIONS.includes(dimensionCandidate) ? dimensionCandidate : "portfolio";
  const measure = ANALYTICS_MEASURES.includes(measureCandidate) ? measureCandidate : "records";
  const query = cleanText(params.get("q"), 200).toLowerCase();
  const category = cleanText(params.get("workCategory"), 80);
  const source = cleanText(params.get("sourceSystem"), 120).toLowerCase();
  const lifecycle = cleanText(params.get("lifecycleStatus"), 100);
  const trackedOnly = params.get("tracked") === "true";
  const trackedRows = trackedOnly ? await db.prepare("SELECT record_id FROM dbi_workspace_watchlist WHERE workspace_id = ?").bind(principal.workspaceId).all() : { results: [] };
  const tracked = new Set((trackedRows.results || []).map((row) => row.record_id));
  const universe = await allAgentRecords(request, env, db, principal.workspaceId);
  const records = universe.records.filter((record) => {
    if (query && ![record.id, record.title, record.party, record.owner, record.reference, record.portfolio].join(" ").toLowerCase().includes(query)) return false;
    if (category && record.workCategory !== category && !(record.workCategories || []).includes(category)) return false;
    if (source && !String(record.sourceSystem || "").toLowerCase().includes(source)) return false;
    if (lifecycle && record.lifecycleStatus !== lifecycle) return false;
    if (trackedOnly && !tracked.has(record.opportunityId)) return false;
    return true;
  });
  const groups = new Map();
  for (const record of records) {
    const label = cleanText(record[dimension], 240) || "Not published";
    const current = groups.get(label) || { key: label, records: 0, obligatedAmount: 0, potentialAmount: 0 };
    current.records += 1;
    current.obligatedAmount += Number(record.obligatedAmount || record.fpdsObligatedAmount || 0);
    current.potentialAmount += Number(record.potentialAmount || record.fpdsPotentialAmount || 0);
    groups.set(label, current);
  }
  const limit = boundedInteger(params.get("limit"), 25, 1, 100);
  const rows = [...groups.values()].sort((left, right) => right[measure] - left[measure] || left.key.localeCompare(right.key)).slice(0, limit);
  return agentJson(rows, 200, {
    dimension,
    measure,
    totalRecords: records.length,
    totalGroups: groups.size,
    totalObligatedAmount: records.reduce((sum, record) => sum + Number(record.obligatedAmount || record.fpdsObligatedAmount || 0), 0),
    totalPotentialAmount: records.reduce((sum, record) => sum + Number(record.potentialAmount || record.fpdsPotentialAmount || 0), 0),
    sourceAsOf: universe.metadata?.asOf || null,
    availableDimensions: ANALYTICS_DIMENSIONS,
    availableMeasures: ANALYTICS_MEASURES,
  });
}

async function recordsResponse(request, env, db, principal, segments) {
  const scope = request.method === "GET" ? "records:read" : "records:write";
  if (!hasScope(principal, scope)) return agentError("insufficient_scope", `Scope ${scope} is required`, 403);
  const recordId = cleanText(decodeURIComponent(segments[0] || ""), 180);
  const universe = await allAgentRecords(request, env, db, principal.workspaceId);
  if (request.method === "GET" && recordId) {
    const record = universe.records.find((item) => item.opportunityId === recordId);
    return record ? agentJson(record) : agentError("record_not_found", "Record not found", 404);
  }
  if (request.method === "GET") {
    const params = new URL(request.url).searchParams;
    const query = cleanText(params.get("q"), 200).toLowerCase();
    const category = cleanText(params.get("workCategory"), 80);
    const source = cleanText(params.get("sourceSystem"), 120).toLowerCase();
    const lifecycle = cleanText(params.get("lifecycleStatus"), 100);
    const trackedOnly = params.get("tracked") === "true";
    const trackedRows = trackedOnly ? await db.prepare("SELECT record_id FROM dbi_workspace_watchlist WHERE workspace_id = ?").bind(principal.workspaceId).all() : { results: [] };
    const tracked = new Set((trackedRows.results || []).map((row) => row.record_id));
    let rows = universe.records.filter((record) => {
      if (query && ![record.id, record.title, record.party, record.owner, record.reference, record.portfolio].join(" ").toLowerCase().includes(query)) return false;
      if (category && record.workCategory !== category && !(record.workCategories || []).includes(category)) return false;
      if (source && !String(record.sourceSystem || "").toLowerCase().includes(source)) return false;
      if (lifecycle && record.lifecycleStatus !== lifecycle) return false;
      if (trackedOnly && !tracked.has(record.opportunityId)) return false;
      return true;
    });
    const sort = cleanText(params.get("sort"), 40) || "title";
    const direction = params.get("direction") === "desc" ? -1 : 1;
    rows.sort((left, right) => {
      if (["obligatedAmount", "potentialAmount"].includes(sort)) return (Number(left[sort] || 0) - Number(right[sort] || 0)) * direction;
      return String(left[sort] || "").localeCompare(String(right[sort] || "")) * direction;
    });
    const total = rows.length;
    const offset = boundedInteger(params.get("cursor"), 0, 0, 1_000_000);
    const limit = boundedInteger(params.get("limit"), 50, 1, 200);
    rows = rows.slice(offset, offset + limit).map(recordProjection);
    return agentJson(rows, 200, { total, limit, cursor: offset, nextCursor: offset + rows.length < total ? String(offset + rows.length) : null, sourceAsOf: universe.metadata?.asOf || null });
  }
  if (request.method === "POST" && !recordId) return idempotent(db, principal, request, async () => {
    const body = await safeJson(request, 131_072);
    const now = new Date().toISOString();
    const id = `manual_agent_${crypto.randomUUID()}`;
    const payload = manualRecordPayload(body, id, 1, now, now);
    if (!payload) return agentError("invalid_record", "A title of at least three characters is required", 400);
    await db.prepare(`INSERT INTO dbi_workspace_manual_records (id, workspace_id, payload_json, version, created_at, updated_at, deleted_at) VALUES (?, ?, ?, 1, ?, ?, '')`)
      .bind(id, principal.workspaceId, JSON.stringify(payload), now, now).run();
    await recordActivity(db, principal, "record_created", "manual_record", id, { title: payload.title });
    return agentJson(payload, 201);
  });
  const stored = recordId ? await db.prepare("SELECT * FROM dbi_workspace_manual_records WHERE id = ? AND workspace_id = ? AND deleted_at = ''").bind(recordId, principal.workspaceId).first() : null;
  if (!stored) return agentError("source_record_immutable", "Only manual Agent API records can be changed; source-backed evidence is read-only", 409);
  if (request.method === "PATCH") {
    const body = await safeJson(request, 131_072);
    const version = expectedVersion(request, body);
    if (version === null) return agentError("precondition_required", "If-Match with the current record version is required", 428);
    if (version !== null && version !== Number(stored.version)) return agentError("version_conflict", "Record changed since the supplied version", 409, undefined, { currentVersion: stored.version });
    const current = JSON.parse(stored.payload_json);
    const now = new Date().toISOString();
    const payload = manualRecordPayload({ ...current, ...body }, recordId, Number(stored.version) + 1, stored.created_at, now);
    if (!payload) return agentError("invalid_record", "A title of at least three characters is required", 400);
    await db.prepare("UPDATE dbi_workspace_manual_records SET payload_json = ?, version = version + 1, updated_at = ? WHERE id = ? AND workspace_id = ?")
      .bind(JSON.stringify(payload), now, recordId, principal.workspaceId).run();
    await recordActivity(db, principal, "record_updated", "manual_record", recordId, { version: payload.version });
    return agentJson(payload);
  }
  if (request.method === "DELETE") {
    const now = new Date().toISOString();
    await db.prepare("UPDATE dbi_workspace_manual_records SET deleted_at = ?, updated_at = ?, version = version + 1 WHERE id = ? AND workspace_id = ?")
      .bind(now, now, recordId, principal.workspaceId).run();
    await recordActivity(db, principal, "record_deleted", "manual_record", recordId);
    return new Response(null, { status: 204 });
  }
  return agentError("method_not_allowed", "Method not allowed", 405);
}

async function trackingResponse(request, env, db, principal, segments) {
  const scope = request.method === "GET" ? "tracking:read" : "tracking:write";
  if (!hasScope(principal, scope)) return agentError("insufficient_scope", `Scope ${scope} is required`, 403);
  const recordId = cleanText(decodeURIComponent(segments[0] || ""), 180);
  if (request.method === "GET" && !recordId) {
    const result = await db.prepare("SELECT * FROM dbi_workspace_watchlist WHERE workspace_id = ? ORDER BY updated_at DESC").bind(principal.workspaceId).all();
    return agentJson((result.results || []).map(trackingFromRow), 200, { total: result.results?.length || 0 });
  }
  if (!recordId) return agentError("record_id_required", "A stable record ID is required", 400);
  if (request.method === "GET") {
    const row = await db.prepare("SELECT * FROM dbi_workspace_watchlist WHERE workspace_id = ? AND record_id = ?").bind(principal.workspaceId, recordId).first();
    return row ? agentJson(trackingFromRow(row)) : agentError("tracking_not_found", "Tracked record not found", 404);
  }
  if (request.method === "PUT") {
    const body = await safeJson(request);
    const existing = await db.prepare("SELECT * FROM dbi_workspace_watchlist WHERE workspace_id = ? AND record_id = ?").bind(principal.workspaceId, recordId).first();
    if (!existing) {
      const universe = await allAgentRecords(request, env, db, principal.workspaceId);
      if (!universe.records.some((record) => record.opportunityId === recordId)) return agentError("record_not_found", "Only an existing stable record ID can be tracked", 404);
    }
    const version = expectedVersion(request, body);
    if (existing && version === null) return agentError("precondition_required", "If-Match with the current tracking version is required", 428);
    if (existing && version !== null && version !== Number(existing.version)) return agentError("version_conflict", "Tracking state changed since the supplied version", 409, undefined, { currentVersion: existing.version });
    const now = new Date().toISOString();
    await db.prepare(`
      INSERT INTO dbi_workspace_watchlist (workspace_id, record_id, note, review_at, wallboard, version, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 1, ?, ?)
      ON CONFLICT(workspace_id, record_id) DO UPDATE SET note = excluded.note, review_at = excluded.review_at,
        wallboard = excluded.wallboard, version = dbi_workspace_watchlist.version + 1, updated_at = excluded.updated_at
    `).bind(principal.workspaceId, recordId, cleanText(body?.note, 4000), cleanDate(body?.reviewAt), body?.wallboard === false ? 0 : 1, existing?.created_at || now, now).run();
    const row = await db.prepare("SELECT * FROM dbi_workspace_watchlist WHERE workspace_id = ? AND record_id = ?").bind(principal.workspaceId, recordId).first();
    await recordActivity(db, principal, existing ? "tracking_updated" : "tracking_added", "tracking", recordId);
    return agentJson(trackingFromRow(row), existing ? 200 : 201);
  }
  if (request.method === "DELETE") {
    const changed = await db.prepare("DELETE FROM dbi_workspace_watchlist WHERE workspace_id = ? AND record_id = ?").bind(principal.workspaceId, recordId).run();
    if (!Number(changed?.meta?.changes || 0)) return agentError("tracking_not_found", "Tracked record not found", 404);
    await recordActivity(db, principal, "tracking_removed", "tracking", recordId);
    return new Response(null, { status: 204 });
  }
  return agentError("method_not_allowed", "Method not allowed", 405);
}

async function eventsResponse(request, env, db, principal, segments) {
  const scope = request.method === "GET" ? "events:read" : "events:write";
  if (!hasScope(principal, scope)) return agentError("insufficient_scope", `Scope ${scope} is required`, 403);
  const eventId = cleanText(decodeURIComponent(segments[0] || ""), 180);
  if (request.method === "GET") {
    if (eventId) {
      const row = await db.prepare("SELECT * FROM dbi_workspace_events WHERE workspace_id = ? AND id = ?").bind(principal.workspaceId, eventId).first();
      return row ? agentJson((await eventsFromRows(db, principal.workspaceId, [row]))[0]) : agentError("event_not_found", "Event not found", 404);
    }
    const result = await db.prepare("SELECT * FROM dbi_workspace_events WHERE workspace_id = ? ORDER BY starts_at, created_at").bind(principal.workspaceId).all();
    return agentJson(await eventsFromRows(db, principal.workspaceId, result.results || []), 200, { total: result.results?.length || 0 });
  }
  if (request.method === "POST" && !eventId) return idempotent(db, principal, request, async () => {
    const body = await safeJson(request);
    const title = cleanText(body?.title, 180);
    const startsAt = cleanDate(body?.startsAt);
    if (!title || !startsAt) return agentError("invalid_event", "Event title and start time are required", 400);
    const recordIds = cleanStringArray(body?.recordIds);
    const attendeeSelection = await activeEventAttendeeIds(db, principal.workspaceId, body?.attendeeIds);
    const milestoneSelection = cleanEventMilestones(body?.milestones || []);
    if (!attendeeSelection.valid) return agentError("user_not_found", "Every attendee must be an active workspace user", 404);
    if (!milestoneSelection.valid) return agentError("invalid_event_milestones", "Milestones require a unique ID, supported type, and valid date; custom milestones also require a label", 400);
    if (recordIds.length) {
      const universe = await allAgentRecords(request, env, db, principal.workspaceId);
      const known = new Set(universe.records.map((record) => record.opportunityId));
      if (recordIds.some((recordId) => !known.has(recordId))) return agentError("record_not_found", "Every linked record must use an existing stable record ID", 404);
    }
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    await db.prepare(`
      INSERT INTO dbi_workspace_events
        (id, workspace_id, title, starts_at, ends_at, location, notes, status, record_ids_json, wallboard, version, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
    `).bind(id, principal.workspaceId, title, startsAt, cleanDate(body?.endsAt), cleanText(body?.location, 500), cleanText(body?.notes, 4000),
      ["scheduled", "completed", "cancelled"].includes(body?.status) ? body.status : "scheduled",
      JSON.stringify(recordIds), body?.wallboard === false ? 0 : 1, now, now).run();
    await replaceEventAttendees(db, principal.workspaceId, id, attendeeSelection.ids);
    await replaceEventMilestones(db, principal.workspaceId, id, milestoneSelection.milestones);
    const row = await db.prepare("SELECT * FROM dbi_workspace_events WHERE workspace_id = ? AND id = ?").bind(principal.workspaceId, id).first();
    await recordActivity(db, principal, "event_created", "event", id, { title });
    return agentJson((await eventsFromRows(db, principal.workspaceId, [row]))[0], 201);
  });
  const existing = eventId ? await db.prepare("SELECT * FROM dbi_workspace_events WHERE workspace_id = ? AND id = ?").bind(principal.workspaceId, eventId).first() : null;
  if (!existing) return agentError("event_not_found", "Event not found", 404);
  if (request.method === "PATCH") {
    const body = await safeJson(request);
    const version = expectedVersion(request, body);
    if (version === null) return agentError("precondition_required", "If-Match with the current event version is required", 428);
    if (version !== null && version !== Number(existing.version)) return agentError("version_conflict", "Event changed since the supplied version", 409, undefined, { currentVersion: existing.version });
    const current = eventFromRow(existing);
    const next = { ...current, ...body };
    const title = cleanText(next.title, 180);
    const startsAt = cleanDate(next.startsAt);
    if (!title || !startsAt) return agentError("invalid_event", "Event title and start time are required", 400);
    const recordIds = cleanStringArray(next.recordIds);
    const attendeeSelection = Array.isArray(body?.attendeeIds) ? await activeEventAttendeeIds(db, principal.workspaceId, body.attendeeIds) : null;
    const milestoneSelection = Array.isArray(body?.milestones) ? cleanEventMilestones(body.milestones) : null;
    if (attendeeSelection && !attendeeSelection.valid) return agentError("user_not_found", "Every attendee must be an active workspace user", 404);
    if (milestoneSelection && !milestoneSelection.valid) return agentError("invalid_event_milestones", "Milestones require a unique ID, supported type, and valid date; custom milestones also require a label", 400);
    if (recordIds.length) {
      const universe = await allAgentRecords(request, env, db, principal.workspaceId);
      const known = new Set(universe.records.map((record) => record.opportunityId));
      if (recordIds.some((recordId) => !known.has(recordId))) return agentError("record_not_found", "Every linked record must use an existing stable record ID", 404);
    }
    const now = new Date().toISOString();
    await db.prepare(`
      UPDATE dbi_workspace_events SET title = ?, starts_at = ?, ends_at = ?, location = ?, notes = ?, status = ?,
        record_ids_json = ?, wallboard = ?, version = version + 1, updated_at = ? WHERE id = ? AND workspace_id = ?
    `).bind(title, startsAt, cleanDate(next.endsAt), cleanText(next.location, 500), cleanText(next.notes, 4000),
      ["scheduled", "completed", "cancelled"].includes(next.status) ? next.status : "scheduled",
      JSON.stringify(recordIds), next.wallboard === false ? 0 : 1, now, eventId, principal.workspaceId).run();
    if (attendeeSelection) await replaceEventAttendees(db, principal.workspaceId, eventId, attendeeSelection.ids);
    if (milestoneSelection) await replaceEventMilestones(db, principal.workspaceId, eventId, milestoneSelection.milestones);
    const row = await db.prepare("SELECT * FROM dbi_workspace_events WHERE workspace_id = ? AND id = ?").bind(principal.workspaceId, eventId).first();
    await recordActivity(db, principal, "event_updated", "event", eventId, { version: row.version });
    return agentJson((await eventsFromRows(db, principal.workspaceId, [row]))[0]);
  }
  if (request.method === "DELETE") {
    await db.prepare("DELETE FROM dbi_workspace_event_attendees WHERE workspace_id = ? AND event_id = ?").bind(principal.workspaceId, eventId).run();
    await db.prepare("DELETE FROM dbi_workspace_event_milestones WHERE workspace_id = ? AND event_id = ?").bind(principal.workspaceId, eventId).run();
    await db.prepare("DELETE FROM dbi_workspace_events WHERE workspace_id = ? AND id = ?").bind(principal.workspaceId, eventId).run();
    await recordActivity(db, principal, "event_deleted", "event", eventId);
    return new Response(null, { status: 204 });
  }
  return agentError("method_not_allowed", "Method not allowed", 405);
}

async function activityResponse(request, db, principal) {
  const scope = request.method === "GET" ? "activity:read" : "activity:write";
  if (!hasScope(principal, scope)) return agentError("insufficient_scope", `Scope ${scope} is required`, 403);
  if (request.method === "GET") {
    const params = new URL(request.url).searchParams;
    const limit = boundedInteger(params.get("limit"), 100, 1, 200);
    const result = await db.prepare("SELECT * FROM dbi_workspace_activity WHERE workspace_id = ? ORDER BY occurred_at DESC LIMIT ?").bind(principal.workspaceId, limit).all();
    return agentJson((result.results || []).map((row) => ({
      id: row.id, actorType: row.actor_type, actorId: row.actor_id, action: row.action,
      entityType: row.entity_type, entityId: row.entity_id, detail: JSON.parse(row.detail_json || "{}"), occurredAt: row.occurred_at,
    })), 200, { total: result.results?.length || 0, limit });
  }
  if (request.method === "POST") return idempotent(db, principal, request, async () => {
    const body = await safeJson(request);
    const detail = cleanText(body?.detail, 4000);
    if (!detail) return agentError("detail_required", "Activity detail is required", 400);
    await recordActivity(db, principal, cleanText(body?.action, 80) || "agent_note", cleanText(body?.entityType, 80) || "workspace", cleanText(body?.entityId, 180), { detail });
    return agentJson({ ok: true }, 201);
  });
  return agentError("method_not_allowed", "Method not allowed", 405);
}

async function integrationsResponse(request, env, principal) {
  if (request.method !== "GET") return agentError("method_not_allowed", "Method not allowed", 405);
  if (!hasScope(principal, "integrations:read")) return agentError("insufficient_scope", "Scope integrations:read is required", 403);
  const paths = ["sam-opportunities.json", "manual-procurement.json", "procurement-delta.json", "usaspending-subawards.json"];
  const payloads = await Promise.all(paths.map((path) => assetJson(request, env, `/data/${path}`).catch(() => ({ metadata: { status: "unavailable" } }))));
  return agentJson([
    { id: "records", name: "Factual record index", status: "current", endpoint: "/api/v1/agent/records" },
    { id: "sam", name: "SAM.gov opportunities", status: payloads[0].metadata?.status || "unknown", recordCount: payloads[0].records?.length || 0 },
    { id: "manual", name: "Manual public imports", status: payloads[1].metadata?.status || "ready", recordCount: payloads[1].records?.length || 0 },
    { id: "changes", name: "Procurement change detection", status: payloads[2].metadata?.status || "baseline", changedCount: Number(payloads[2].summary?.added || 0) + Number(payloads[2].summary?.updated || 0) },
    { id: "subawards", name: "USAspending subawards", status: payloads[3].metadata?.status || "unknown", reportedCount: payloads[3].metadata?.reportedSubawardCount || 0 },
  ]);
}

async function agentApiResponse(request, env, db) {
  const requestId = crypto.randomUUID();
  const principal = await requestPrincipal(db, request);
  if (!principal) return agentError("authentication_required", "Use a valid DBI agent bearer token or signed-in workspace session", 401, requestId);
  if (principal.type === "user" && !["GET", "HEAD"].includes(request.method) && !sameOrigin(request)) {
    return agentError("cross_origin_forbidden", "Cross-origin workspace mutations are not allowed", 403, requestId);
  }
  if (await rateLimited(db, principal)) return agentError("rate_limited", `Limit is ${AGENT_RATE_LIMIT} requests per minute`, 429, requestId);
  const pathname = new URL(request.url).pathname.replace(/\/+$/, "");
  const relative = pathname.slice("/api/v1/agent".length).replace(/^\//, "");
  const [resource = "capabilities", ...segments] = relative.split("/").filter(Boolean);
  if (resource === "capabilities" && request.method === "GET") return agentJson({
    principal, scopes: principal.scopes, rateLimitPerMinute: AGENT_RATE_LIMIT,
    resources: ["records", "analytics", "tracking", "events", "activity", "integrations"],
    writeBoundary: "Source-backed evidence is immutable; management state and manual Agent API records are writable.",
  }, 200, { requestId });
  if (resource === "openapi.json" && request.method === "GET") return Response.json(openApiDocument(new URL(request.url).origin), { headers: { "cache-control": "no-store" } });
  if (resource === "records") return recordsResponse(request, env, db, principal, segments);
  if (resource === "tracking") return trackingResponse(request, env, db, principal, segments);
  if (resource === "events") return eventsResponse(request, env, db, principal, segments);
  if (resource === "activity") return activityResponse(request, db, principal);
  if (resource === "integrations") return integrationsResponse(request, env, principal);
  if (resource === "analytics") return analyticsResponse(request, env, db, principal);
  return agentError("route_not_found", "Unknown Agent API route", 404, requestId);
}

export async function pagesAuthApiResponse(request, env = {}) {
  const db = databaseFromEnv(env);
  if (!db) return json({ error: "Persistent account database is unavailable" }, 503);
  await ensureSchema(db);

  const pathname = new URL(request.url).pathname.replace(/\/+$/, "");
  if (pathname === "/api/v1/auth/status") return statusResponse(request, db, env);
  if (pathname === "/api/v1/auth/claim") return claimResponse(request, db, env);
  if (pathname === "/api/v1/auth/register") return registrationResponse(request, db, env);
  if (pathname === "/api/v1/auth/login-config") return loginConfigResponse(request, db);
  if (pathname === "/api/v1/auth/login") return loginResponse(request, db, env);
  if (pathname === "/api/v1/auth/logout") return logoutResponse(request, db, env);
  if (pathname === "/api/v1/auth/profile") return profileResponse(request, db);
  if (pathname === "/api/v1/auth/password") return passwordResponse(request, db, env);
  if (pathname === "/api/v1/auth/directory") return directoryResponse(request, db);
  if (pathname === "/api/v1/auth/workspaces" || pathname.startsWith("/api/v1/auth/workspaces/")) return workspacesResponse(request, db);
  if (pathname === "/api/v1/auth/workspace-admin" || pathname.startsWith("/api/v1/auth/workspace-admin/")) return workspaceAdminResponse(request, db);
  if (pathname === "/api/v1/auth/users" || pathname.startsWith("/api/v1/auth/users/")) return usersResponse(request, db);
  if (pathname === "/api/v1/auth/agent-keys" || pathname.startsWith("/api/v1/auth/agent-keys/")) return agentKeysResponse(request, db);
  if (pathname === "/api/v1/agent" || pathname.startsWith("/api/v1/agent/")) return agentApiResponse(request, env, db);
  return json({ error: "Unknown account route" }, 404);
}
