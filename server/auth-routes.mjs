import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";

const COOKIE_NAME = "dbi_session";
const SESSION_DAYS = Math.max(1, Number(process.env.AUTH_SESSION_DAYS || 30));
const MAX_ATTEMPTS = Math.max(3, Number(process.env.AUTH_MAX_ATTEMPTS || 8));
const WINDOW_MINUTES = Math.max(1, Number(process.env.AUTH_ATTEMPT_WINDOW_MINUTES || 15));

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function equalDigest(left, right) {
  const a = Buffer.from(left || "", "hex");
  const b = Buffer.from(right || "", "hex");
  return a.length === b.length && a.length > 0 && timingSafeEqual(a, b);
}

function parseCookies(header = "") {
  return Object.fromEntries(header.split(";").map((item) => {
    const index = item.indexOf("=");
    return index < 0 ? ["", ""] : [item.slice(0, index).trim(), decodeURIComponent(item.slice(index + 1).trim())];
  }).filter(([key]) => key));
}

function sessionCookie(token, expiresAt) {
  const secure = process.env.AUTH_SECURE_COOKIE !== "false";
  return `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Expires=${expiresAt.toUTCString()}${secure ? "; Secure" : ""}`;
}

function clearCookie() {
  const secure = process.env.AUTH_SECURE_COOKIE !== "false";
  return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure ? "; Secure" : ""}`;
}

function cleanText(value, maxLength) {
  return Array.from(String(value || ""), (character) => {
    const code = character.charCodeAt(0);
    return code < 32 || code === 127 ? " " : character;
  }).join("").trim().slice(0, maxLength);
}

function validEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= 254;
}

function validProof(value) {
  return /^[a-f0-9]{64}$/i.test(value || "");
}

function assertSameOrigin(request, reply) {
  const origin = request.headers.origin;
  if (!origin) return true;
  const forwardedHost = request.headers["x-forwarded-host"] || request.headers.host;
  const forwardedProto = request.headers["x-forwarded-proto"] || request.protocol;
  if (origin !== `${forwardedProto}://${forwardedHost}`) {
    reply.code(403).send({ error: "cross-origin request rejected" });
    return false;
  }
  return true;
}

async function account(pool) {
  const result = await pool.query(
    "SELECT email, display_name, title, password_salt, created_at, updated_at FROM app_super_user WHERE singleton = TRUE",
  );
  return result.rows[0] || null;
}

async function issueSession(pool, reply) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86_400_000);
  await pool.query(
    "INSERT INTO app_auth_sessions (id, token_hash, expires_at) VALUES ($1, $2, $3)",
    [randomUUID(), sha256(token), expiresAt],
  );
  reply.header("set-cookie", sessionCookie(token, expiresAt));
}

async function authenticated(pool, request) {
  const token = parseCookies(request.headers.cookie)[COOKIE_NAME];
  if (!token) return null;
  const result = await pool.query(
    `SELECT s.id, u.email, u.display_name, u.title, u.created_at
       FROM app_auth_sessions s
       CROSS JOIN app_super_user u
      WHERE s.token_hash = $1 AND s.expires_at > NOW()
      LIMIT 1`,
    [sha256(token)],
  );
  if (!result.rowCount) return null;
  await pool.query("UPDATE app_auth_sessions SET last_seen_at = NOW() WHERE id = $1", [result.rows[0].id]);
  return result.rows[0];
}

function publicUser(row) {
  return row ? {
    email: row.email,
    displayName: row.display_name,
    title: row.title,
    role: "Super user",
    createdAt: row.created_at,
  } : null;
}

export async function registerAuthRoutes(app, pool) {
  const enabled = process.env.ENABLE_AUTH === "true";
  const required = enabled && process.env.AUTH_REQUIRE_LOGIN === "true";
  const allowFirstClaim = process.env.ALLOW_FIRST_CLAIM !== "false";

  app.get("/api/v1/auth/status", async (request) => {
    if (!enabled) return { enabled: false, required: false, claimed: false, user: null };
    const [owner, session] = await Promise.all([account(pool), authenticated(pool, request)]);
    return { enabled: true, required, claimed: Boolean(owner), user: publicUser(session) };
  });

  app.post("/api/v1/auth/claim", async (request, reply) => {
    if (!enabled || !allowFirstClaim) return reply.code(404).send({ error: "initial account claim is unavailable" });
    if (!assertSameOrigin(request, reply)) return;
    const email = cleanText(request.body?.email, 254).toLowerCase();
    const displayName = cleanText(request.body?.displayName, 80);
    const title = cleanText(request.body?.title, 80);
    const passwordSalt = cleanText(request.body?.passwordSalt, 128);
    const passwordProof = cleanText(request.body?.passwordProof, 64).toLowerCase();
    if (!validEmail(email) || displayName.length < 2 || passwordSalt.length < 16 || !validProof(passwordProof)) {
      return reply.code(400).send({ error: "valid account details are required" });
    }
    const result = await pool.query(
      `INSERT INTO app_super_user (singleton, email, display_name, title, password_salt, password_proof_hash)
       VALUES (TRUE, $1, $2, $3, $4, $5)
       ON CONFLICT (singleton) DO NOTHING
       RETURNING email, display_name, title, created_at`,
      [email, displayName, title, passwordSalt, sha256(passwordProof)],
    );
    if (!result.rowCount) return reply.code(409).send({ error: "the super-user account has already been claimed" });
    await issueSession(pool, reply);
    return reply.code(201).send({ user: publicUser(result.rows[0]) });
  });

  app.post("/api/v1/auth/login-config", async (request, reply) => {
    if (!enabled) return reply.code(404).send({ error: "authentication is unavailable" });
    if (!assertSameOrigin(request, reply)) return;
    const email = cleanText(request.body?.email, 254).toLowerCase();
    const owner = await account(pool);
    return { passwordSalt: owner && owner.email.toLowerCase() === email ? owner.password_salt : sha256(`unknown|${email}`) };
  });

  app.post("/api/v1/auth/login", async (request, reply) => {
    if (!enabled) return reply.code(404).send({ error: "authentication is unavailable" });
    if (!assertSameOrigin(request, reply)) return;
    const email = cleanText(request.body?.email, 254).toLowerCase();
    const proof = cleanText(request.body?.passwordProof, 64).toLowerCase();
    const identityHash = sha256(`${email}|${request.ip}`);
    const attempts = await pool.query(
      `SELECT COUNT(*)::int AS count FROM app_login_attempts
        WHERE identity_hash = $1 AND succeeded = FALSE
          AND attempted_at > NOW() - ($2::text || ' minutes')::interval`,
      [identityHash, WINDOW_MINUTES],
    );
    if (attempts.rows[0].count >= MAX_ATTEMPTS) {
      return reply.code(429).send({ error: "too many attempts; try again later" });
    }
    const result = await pool.query(
      "SELECT email, display_name, title, password_proof_hash, created_at FROM app_super_user WHERE singleton = TRUE",
    );
    const owner = result.rows[0];
    const ok = owner && owner.email.toLowerCase() === email && validProof(proof) && equalDigest(owner.password_proof_hash, sha256(proof));
    await pool.query("INSERT INTO app_login_attempts (identity_hash, succeeded) VALUES ($1, $2)", [identityHash, Boolean(ok)]);
    if (!ok) return reply.code(401).send({ error: "email or password is incorrect" });
    await issueSession(pool, reply);
    return { user: publicUser(owner) };
  });

  app.post("/api/v1/auth/logout", async (request, reply) => {
    if (!assertSameOrigin(request, reply)) return;
    const token = parseCookies(request.headers.cookie)[COOKIE_NAME];
    if (token) await pool.query("DELETE FROM app_auth_sessions WHERE token_hash = $1", [sha256(token)]);
    reply.header("set-cookie", clearCookie());
    return { ok: true };
  });

  app.patch("/api/v1/auth/profile", async (request, reply) => {
    if (!assertSameOrigin(request, reply)) return;
    const session = await authenticated(pool, request);
    if (!session) return reply.code(401).send({ error: "sign in required" });
    const displayName = cleanText(request.body?.displayName, 80);
    const title = cleanText(request.body?.title, 80);
    if (displayName.length < 2) return reply.code(400).send({ error: "display name is required" });
    const result = await pool.query(
      `UPDATE app_super_user SET display_name = $1, title = $2, updated_at = NOW()
        WHERE singleton = TRUE RETURNING email, display_name, title, created_at`,
      [displayName, title],
    );
    return { user: publicUser(result.rows[0]) };
  });

  app.post("/api/v1/auth/password", async (request, reply) => {
    if (!assertSameOrigin(request, reply)) return;
    const session = await authenticated(pool, request);
    if (!session) return reply.code(401).send({ error: "sign in required" });
    const currentProof = cleanText(request.body?.currentPasswordProof, 64).toLowerCase();
    const nextProof = cleanText(request.body?.newPasswordProof, 64).toLowerCase();
    const nextSalt = cleanText(request.body?.newPasswordSalt, 128);
    const result = await pool.query("SELECT password_proof_hash FROM app_super_user WHERE singleton = TRUE");
    if (!validProof(currentProof) || !equalDigest(result.rows[0].password_proof_hash, sha256(currentProof))) {
      return reply.code(403).send({ error: "current password is incorrect" });
    }
    if (!validProof(nextProof) || nextSalt.length < 16) return reply.code(400).send({ error: "new password is invalid" });
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        "UPDATE app_super_user SET password_salt = $1, password_proof_hash = $2, updated_at = NOW() WHERE singleton = TRUE",
        [nextSalt, sha256(nextProof)],
      );
      await client.query("DELETE FROM app_auth_sessions");
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    await issueSession(pool, reply);
    return { ok: true };
  });

  if (required) {
    app.addHook("preHandler", async (request, reply) => {
      if (!request.url.startsWith("/api/v1/") || request.url.startsWith("/api/v1/auth/")) return;
      if (!await authenticated(pool, request)) return reply.code(401).send({ error: "sign in required" });
    });
  }
}
