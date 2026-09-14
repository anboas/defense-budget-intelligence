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
  return row ? {
    id: row.user_id,
    email: row.email,
    displayName: row.display_name,
    title: row.title || "",
    role: "Super user",
    createdAt: row.created_at,
  } : null;
}

async function superUser(db) {
  return db.prepare("SELECT * FROM dbi_super_user WHERE singleton = 1").first();
}

async function sessionUser(db, request) {
  const rawToken = cookies(request)[SESSION_COOKIE] || "";
  if (!rawToken) return null;
  const row = await db.prepare(`
    SELECT u.*, s.id AS session_id
    FROM dbi_sessions s
    JOIN dbi_super_user u ON u.user_id = s.user_id
    WHERE s.token_hash = ? AND s.revoked_at = '' AND s.expires_at > ?
  `).bind(await hashValue(rawToken), new Date().toISOString()).first();
  if (!row) return null;
  await db.prepare("UPDATE dbi_sessions SET last_seen_at = ? WHERE id = ?")
    .bind(new Date().toISOString(), row.session_id)
    .run();
  return row;
}

async function createSession(db, userId) {
  const rawToken = randomHex(32);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_MAX_AGE_SECONDS * 1000).toISOString();
  await db.prepare(`
    INSERT INTO dbi_sessions
      (id, user_id, token_hash, expires_at, revoked_at, created_at, last_seen_at)
    VALUES (?, ?, ?, ?, '', ?, ?)
  `).bind(
    crypto.randomUUID(),
    userId,
    await hashValue(rawToken),
    expiresAt,
    now.toISOString(),
    now.toISOString(),
  ).run();
  return { rawToken, expiresAt };
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
    user: publicUser(session),
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

  const session = await createSession(db, userId);
  return json({ user: publicUser({
    user_id: userId,
    email,
    display_name: displayName,
    title,
    created_at: now,
  }) }, 201, { "set-cookie": sessionCookie(session.rawToken, request, env) });
}

async function loginConfigResponse(request, db) {
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (!sameOrigin(request)) return json({ error: "Cross-origin login is not allowed" }, 403);
  const body = await safeJson(request);
  const email = normalizeEmail(body?.email);
  const owner = await superUser(db);
  const matches = Boolean(email && owner && email === owner.email);
  const fallbackSalt = (await hashValue(`dbi-login:${email || "unknown"}`)).slice(0, 48);
  return json({
    passwordSalt: matches ? owner.password_salt : fallbackSalt,
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

  const owner = await superUser(db);
  const storedHash = String(owner?.password_hash || "");
  const verified = Boolean(
    owner
    && email === owner.email
    && validPasswordProof(passwordProof)
    && storedHash.startsWith("v1$")
    && constantTimeEqual(await hashValue(passwordProof), storedHash.slice(3)),
  );
  await recordLoginAttempt(db, client, verified);
  if (!verified) return json({ error: "Email or password is incorrect" }, 401);

  const session = await createSession(db, owner.user_id);
  return json({ user: publicUser(owner), expiresAt: session.expiresAt }, 200, {
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
  const body = await safeJson(request);
  const displayName = cleanText(body?.displayName, 80);
  const title = cleanText(body?.title, 80);
  if (displayName.length < 2) return json({ error: "Display name is required" }, 400);
  await db.prepare(`
    UPDATE dbi_super_user SET display_name = ?, title = ?, updated_at = ? WHERE singleton = 1
  `).bind(displayName, title, new Date().toISOString()).run();
  return json({ user: publicUser({ ...session, display_name: displayName, title }) });
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
  await db.batch([
    db.prepare(`
      UPDATE dbi_super_user
      SET password_salt = ?, password_hash = ?, updated_at = ?
      WHERE singleton = 1
    `).bind(newPasswordSalt, `v1$${await hashValue(newPasswordProof)}`, now),
    db.prepare("UPDATE dbi_sessions SET revoked_at = ? WHERE revoked_at = ''").bind(now),
  ]);
  const nextSession = await createSession(db, session.user_id);
  return json({ ok: true, user: publicUser(session) }, 200, {
    "set-cookie": sessionCookie(nextSession.rawToken, request, env),
  });
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
    scopes: [...AGENT_SCOPES],
  };
  const authorization = request.headers.get("authorization") || "";
  const rawToken = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  if (!rawToken.startsWith(AGENT_TOKEN_PREFIX) || rawToken.length < 72) return null;
  const now = new Date().toISOString();
  const row = await db.prepare(`
    SELECT * FROM dbi_agent_keys
    WHERE token_hash = ? AND revoked_at = '' AND (expires_at = '' OR expires_at > ?)
  `).bind(await hashValue(rawToken), now).first();
  if (!row) return null;
  await db.prepare("UPDATE dbi_agent_keys SET last_used_at = ? WHERE id = ?").bind(now, row.id).run();
  return { type: "agent", id: row.id, name: row.name, scopes: parsedScopes(row.scopes_json) };
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
  await db.prepare(`
    INSERT INTO dbi_operator_activity
      (id, actor_type, actor_id, action, entity_type, entity_id, detail_json, occurred_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    crypto.randomUUID(), principal.type, principal.id, cleanText(action, 80), cleanText(entityType, 80),
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
  const pathname = new URL(request.url).pathname.replace(/\/+$/, "");
  const prefix = "/api/v1/auth/agent-keys";
  const keyId = cleanText(decodeURIComponent(pathname.slice(prefix.length).replace(/^\//, "")), 80);
  if (request.method === "GET" && !keyId) {
    const result = await db.prepare("SELECT * FROM dbi_agent_keys ORDER BY created_at DESC").all();
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
    const active = await db.prepare("SELECT COUNT(*) AS count FROM dbi_agent_keys WHERE revoked_at = '' AND (expires_at = '' OR expires_at > ?)").bind(new Date().toISOString()).first();
    if (Number(active?.count || 0) >= 25) return json({ error: "Revoke an existing agent credential before creating another" }, 409);
    const id = crypto.randomUUID();
    const token = `${AGENT_TOKEN_PREFIX}${id}.${randomHex(32)}`;
    const now = new Date().toISOString();
    await db.prepare(`
      INSERT INTO dbi_agent_keys
        (id, name, token_hash, scopes_json, created_by, created_at, last_used_at, expires_at, revoked_at)
      VALUES (?, ?, ?, ?, ?, ?, '', ?, '')
    `).bind(id, name, await hashValue(token), JSON.stringify(scopes), session.user_id, now, expiresAt).run();
    await recordActivity(db, { type: "user", id: session.user_id }, "agent_key_created", "agent_key", id, { name, scopes });
    return json({ key: { id, name, scopes, createdAt: now, expiresAt: expiresAt || null }, token }, 201);
  }
  if (request.method === "DELETE" && keyId) {
    const now = new Date().toISOString();
    const changed = await db.prepare("UPDATE dbi_agent_keys SET revoked_at = ? WHERE id = ? AND revoked_at = ''")
      .bind(now, keyId).run();
    if (!Number(changed?.meta?.changes || 0)) return json({ error: "Agent credential not found or already revoked" }, 404);
    await recordActivity(db, { type: "user", id: session.user_id }, "agent_key_revoked", "agent_key", keyId);
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

async function allAgentRecords(request, env, db) {
  const source = await assetJson(request, env, "/data/agent-records.json");
  const stored = await db.prepare("SELECT * FROM dbi_manual_records WHERE deleted_at = '' ORDER BY created_at").all();
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

function eventFromRow(row) {
  let recordIds = [];
  try { recordIds = JSON.parse(row.record_ids_json || "[]"); } catch { /* empty */ }
  return {
    id: row.id, title: row.title, startsAt: row.starts_at, endsAt: row.ends_at || "",
    location: row.location || "", notes: row.notes || "", status: row.status,
    recordIds, wallboard: Boolean(row.wallboard), version: row.version,
    createdAt: row.created_at, updatedAt: row.updated_at,
  };
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
  const existing = await db.prepare(`
    SELECT * FROM dbi_agent_idempotency WHERE principal_id = ? AND idempotency_key = ?
  `).bind(principal.id, key).first();
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
    `).bind(principal.id, key, fingerprint, response.status, await response.clone().text(), new Date().toISOString()).run();
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
  const trackedRows = trackedOnly ? await db.prepare("SELECT record_id FROM dbi_watchlist").all() : { results: [] };
  const tracked = new Set((trackedRows.results || []).map((row) => row.record_id));
  const universe = await allAgentRecords(request, env, db);
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
  const universe = await allAgentRecords(request, env, db);
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
    const trackedRows = trackedOnly ? await db.prepare("SELECT record_id FROM dbi_watchlist").all() : { results: [] };
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
    await db.prepare(`INSERT INTO dbi_manual_records (id, payload_json, version, created_at, updated_at, deleted_at) VALUES (?, ?, 1, ?, ?, '')`)
      .bind(id, JSON.stringify(payload), now, now).run();
    await recordActivity(db, principal, "record_created", "manual_record", id, { title: payload.title });
    return agentJson(payload, 201);
  });
  const stored = recordId ? await db.prepare("SELECT * FROM dbi_manual_records WHERE id = ? AND deleted_at = ''").bind(recordId).first() : null;
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
    await db.prepare("UPDATE dbi_manual_records SET payload_json = ?, version = version + 1, updated_at = ? WHERE id = ?")
      .bind(JSON.stringify(payload), now, recordId).run();
    await recordActivity(db, principal, "record_updated", "manual_record", recordId, { version: payload.version });
    return agentJson(payload);
  }
  if (request.method === "DELETE") {
    const now = new Date().toISOString();
    await db.prepare("UPDATE dbi_manual_records SET deleted_at = ?, updated_at = ?, version = version + 1 WHERE id = ?")
      .bind(now, now, recordId).run();
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
    const result = await db.prepare("SELECT * FROM dbi_watchlist ORDER BY updated_at DESC").all();
    return agentJson((result.results || []).map(trackingFromRow), 200, { total: result.results?.length || 0 });
  }
  if (!recordId) return agentError("record_id_required", "A stable record ID is required", 400);
  if (request.method === "GET") {
    const row = await db.prepare("SELECT * FROM dbi_watchlist WHERE record_id = ?").bind(recordId).first();
    return row ? agentJson(trackingFromRow(row)) : agentError("tracking_not_found", "Tracked record not found", 404);
  }
  if (request.method === "PUT") {
    const body = await safeJson(request);
    const existing = await db.prepare("SELECT * FROM dbi_watchlist WHERE record_id = ?").bind(recordId).first();
    if (!existing) {
      const universe = await allAgentRecords(request, env, db);
      if (!universe.records.some((record) => record.opportunityId === recordId)) return agentError("record_not_found", "Only an existing stable record ID can be tracked", 404);
    }
    const version = expectedVersion(request, body);
    if (existing && version === null) return agentError("precondition_required", "If-Match with the current tracking version is required", 428);
    if (existing && version !== null && version !== Number(existing.version)) return agentError("version_conflict", "Tracking state changed since the supplied version", 409, undefined, { currentVersion: existing.version });
    const now = new Date().toISOString();
    await db.prepare(`
      INSERT INTO dbi_watchlist (record_id, note, review_at, wallboard, version, created_at, updated_at)
      VALUES (?, ?, ?, ?, 1, ?, ?)
      ON CONFLICT(record_id) DO UPDATE SET note = excluded.note, review_at = excluded.review_at,
        wallboard = excluded.wallboard, version = dbi_watchlist.version + 1, updated_at = excluded.updated_at
    `).bind(recordId, cleanText(body?.note, 4000), cleanDate(body?.reviewAt), body?.wallboard === false ? 0 : 1, existing?.created_at || now, now).run();
    const row = await db.prepare("SELECT * FROM dbi_watchlist WHERE record_id = ?").bind(recordId).first();
    await recordActivity(db, principal, existing ? "tracking_updated" : "tracking_added", "tracking", recordId);
    return agentJson(trackingFromRow(row), existing ? 200 : 201);
  }
  if (request.method === "DELETE") {
    const changed = await db.prepare("DELETE FROM dbi_watchlist WHERE record_id = ?").bind(recordId).run();
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
      const row = await db.prepare("SELECT * FROM dbi_management_events WHERE id = ?").bind(eventId).first();
      return row ? agentJson(eventFromRow(row)) : agentError("event_not_found", "Event not found", 404);
    }
    const result = await db.prepare("SELECT * FROM dbi_management_events ORDER BY starts_at, created_at").all();
    return agentJson((result.results || []).map(eventFromRow), 200, { total: result.results?.length || 0 });
  }
  if (request.method === "POST" && !eventId) return idempotent(db, principal, request, async () => {
    const body = await safeJson(request);
    const title = cleanText(body?.title, 180);
    const startsAt = cleanDate(body?.startsAt);
    if (!title || !startsAt) return agentError("invalid_event", "Event title and start time are required", 400);
    const recordIds = cleanStringArray(body?.recordIds);
    if (recordIds.length) {
      const universe = await allAgentRecords(request, env, db);
      const known = new Set(universe.records.map((record) => record.opportunityId));
      if (recordIds.some((recordId) => !known.has(recordId))) return agentError("record_not_found", "Every linked record must use an existing stable record ID", 404);
    }
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    await db.prepare(`
      INSERT INTO dbi_management_events
        (id, title, starts_at, ends_at, location, notes, status, record_ids_json, wallboard, version, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
    `).bind(id, title, startsAt, cleanDate(body?.endsAt), cleanText(body?.location, 500), cleanText(body?.notes, 4000),
      ["scheduled", "completed", "cancelled"].includes(body?.status) ? body.status : "scheduled",
      JSON.stringify(recordIds), body?.wallboard === false ? 0 : 1, now, now).run();
    const row = await db.prepare("SELECT * FROM dbi_management_events WHERE id = ?").bind(id).first();
    await recordActivity(db, principal, "event_created", "event", id, { title });
    return agentJson(eventFromRow(row), 201);
  });
  const existing = eventId ? await db.prepare("SELECT * FROM dbi_management_events WHERE id = ?").bind(eventId).first() : null;
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
    if (recordIds.length) {
      const universe = await allAgentRecords(request, env, db);
      const known = new Set(universe.records.map((record) => record.opportunityId));
      if (recordIds.some((recordId) => !known.has(recordId))) return agentError("record_not_found", "Every linked record must use an existing stable record ID", 404);
    }
    const now = new Date().toISOString();
    await db.prepare(`
      UPDATE dbi_management_events SET title = ?, starts_at = ?, ends_at = ?, location = ?, notes = ?, status = ?,
        record_ids_json = ?, wallboard = ?, version = version + 1, updated_at = ? WHERE id = ?
    `).bind(title, startsAt, cleanDate(next.endsAt), cleanText(next.location, 500), cleanText(next.notes, 4000),
      ["scheduled", "completed", "cancelled"].includes(next.status) ? next.status : "scheduled",
      JSON.stringify(recordIds), next.wallboard === false ? 0 : 1, now, eventId).run();
    const row = await db.prepare("SELECT * FROM dbi_management_events WHERE id = ?").bind(eventId).first();
    await recordActivity(db, principal, "event_updated", "event", eventId, { version: row.version });
    return agentJson(eventFromRow(row));
  }
  if (request.method === "DELETE") {
    await db.prepare("DELETE FROM dbi_management_events WHERE id = ?").bind(eventId).run();
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
    const result = await db.prepare("SELECT * FROM dbi_operator_activity ORDER BY occurred_at DESC LIMIT ?").bind(limit).all();
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
  if (!principal) return agentError("authentication_required", "Use a valid DBI agent bearer token or signed-in Super-user session", 401, requestId);
  if (principal.type === "user" && !["GET", "HEAD"].includes(request.method) && !sameOrigin(request)) {
    return agentError("cross_origin_forbidden", "Cross-origin workspace mutations are not allowed", 403, requestId);
  }
  if (await rateLimited(db, principal)) return agentError("rate_limited", `Limit is ${AGENT_RATE_LIMIT} requests per minute`, 429, requestId);
  const pathname = new URL(request.url).pathname.replace(/\/+$/, "");
  const relative = pathname.slice("/api/v1/agent".length).replace(/^\//, "");
  const [resource = "capabilities", ...segments] = relative.split("/").filter(Boolean);
  if (resource === "capabilities" && request.method === "GET") return agentJson({
    principal, scopes: AGENT_SCOPES, rateLimitPerMinute: AGENT_RATE_LIMIT,
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
  if (pathname === "/api/v1/auth/login-config") return loginConfigResponse(request, db);
  if (pathname === "/api/v1/auth/login") return loginResponse(request, db, env);
  if (pathname === "/api/v1/auth/logout") return logoutResponse(request, db, env);
  if (pathname === "/api/v1/auth/profile") return profileResponse(request, db);
  if (pathname === "/api/v1/auth/password") return passwordResponse(request, db, env);
  if (pathname === "/api/v1/auth/agent-keys" || pathname.startsWith("/api/v1/auth/agent-keys/")) return agentKeysResponse(request, db);
  if (pathname === "/api/v1/agent" || pathname.startsWith("/api/v1/agent/")) return agentApiResponse(request, env, db);
  return json({ error: "Unknown account route" }, 404);
}
