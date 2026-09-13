const encoder = new TextEncoder();

export const PAGES_AUTH_VERSION = "dbi-pages-auth-v1";
export const PASSWORD_ITERATIONS = 310_000;
export const SESSION_COOKIE = "dbi_session";
export const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

const MAX_ATTEMPTS = 8;
const ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
const MAX_BODY_BYTES = 16_384;

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
]);

function databaseFromEnv(env = {}) {
  return env.DBI_DB?.prepare ? env.DBI_DB : null;
}

async function ensureSchema(db) {
  for (const statement of SCHEMA) await db.prepare(statement).run();
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

async function safeJson(request) {
  const length = Number(request.headers.get("content-length") || 0);
  if (length > MAX_BODY_BYTES) return null;
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
  return json({ error: "Unknown account route" }, 404);
}
