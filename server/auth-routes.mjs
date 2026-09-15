import { createCipheriv, createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";

const COOKIE_NAME = "dbi_session";
const SESSION_DAYS = Math.max(1, Number(process.env.AUTH_SESSION_DAYS || 30));
const MAX_ATTEMPTS = Math.max(3, Number(process.env.AUTH_MAX_ATTEMPTS || 8));
const WINDOW_MINUTES = Math.max(1, Number(process.env.AUTH_ATTEMPT_WINDOW_MINUTES || 15));
const USER_ROLES = ["administrator", "analyst", "viewer"];
const USER_STATUSES = ["active", "suspended"];
const ROLE_LABELS = { super_user: "Super user", administrator: "Workspace manager", analyst: "Analyst", viewer: "Viewer" };
const DEFAULT_WORKSPACE_ID = "00000000-0000-4000-8000-000000000001";
const DEFAULT_HEADER_EYEBROW = "Defense Budget & Spend Analytics";
const DEFAULT_DISPLAY_TITLE = "Defense Budget Intelligence";

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
    "SELECT user_id, email, display_name, title, password_salt, created_at, updated_at FROM app_super_user WHERE singleton = TRUE",
  );
  return result.rows[0] || null;
}

async function issueSession(pool, reply, userId, preferredWorkspaceId = null) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86_400_000);
  const membership = await pool.query(`SELECT workspace_id FROM app_workspace_memberships
    WHERE user_id = $1 AND ($2::uuid IS NULL OR workspace_id = $2)
    ORDER BY CASE WHEN workspace_id = $2 THEN 0 ELSE 1 END, created_at LIMIT 1`, [userId, preferredWorkspaceId]);
  const sessionId = randomUUID();
  await pool.query(
    "INSERT INTO app_auth_sessions (id, token_hash, expires_at, user_id, workspace_id) VALUES ($1, $2, $3, $4, $5)",
    [sessionId, sha256(token), expiresAt, userId, membership.rows[0]?.workspace_id || null],
  );
  reply.header("set-cookie", sessionCookie(token, expiresAt));
  return { sessionId, workspaceId: membership.rows[0]?.workspace_id || null };
}

async function authenticated(pool, request) {
  const token = parseCookies(request.headers.cookie)[COOKIE_NAME];
  if (!token) return null;
  const result = await pool.query(
    `SELECT s.id, u.user_id, u.email, u.display_name, u.title, u.avatar_data_url, u.role, u.status,
            u.must_change_password, u.created_at, u.last_login_at, s.workspace_id AS active_workspace_id,
            membership.role AS membership_role
       FROM app_auth_sessions s
       JOIN app_users u ON u.user_id = s.user_id
       LEFT JOIN app_workspace_memberships membership ON membership.workspace_id = s.workspace_id AND membership.user_id = u.user_id
      WHERE s.token_hash = $1 AND s.expires_at > NOW() AND u.status = 'active'
      LIMIT 1`,
    [sha256(token)],
  );
  if (!result.rowCount) return null;
  await pool.query("UPDATE app_auth_sessions SET last_seen_at = NOW() WHERE id = $1", [result.rows[0].id]);
  return result.rows[0];
}

function publicUser(row) {
  const roleId = row?.role === "super_user" ? "super_user" : row?.membership_role || row?.role || "viewer";
  return row ? {
    id: row.user_id,
    email: row.email,
    displayName: row.display_name,
    title: row.title,
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

function validAvatar(value) {
  const avatar = cleanText(value, 14_000);
  return !avatar || /^data:image\/(?:png|jpeg|webp);base64,[a-z0-9+/]+=*$/i.test(avatar) ? avatar : null;
}

function validOpenAiKey(value) {
  const key = String(value || "").trim();
  return /^sk-[A-Za-z0-9_-]{20,240}$/.test(key) ? key : "";
}

function encryptOpenAiKey(value) {
  const secret = String(process.env.DBI_CREDENTIAL_ENCRYPTION_KEY || "");
  if (secret.length < 32) return null;
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", createHash("sha256").update(secret).digest(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final(), cipher.getAuthTag()]);
  return { encryptedKey: encrypted.toString("base64"), keyIv: iv.toString("base64"), keyVersion: 1 };
}

function openAiKeyMetadata(row) {
  return {
    id: row.id,
    scope: row.scope_type,
    workspaceId: row.workspace_id || null,
    userId: row.user_id || null,
    label: row.label,
    lastFour: row.key_last_four,
    isDefault: Boolean(row.is_default),
    status: row.revoked_at ? "revoked" : "active",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastUsedAt: row.last_used_at || null,
  };
}

async function hydratedUser(pool, row) {
  if (!row) return null;
  const result = await pool.query(`SELECT workspace.workspace_id, workspace.name, workspace.slug, workspace.description, membership.role,
      settings.icon_data_url, settings.header_eyebrow, settings.display_title
    FROM app_workspace_memberships membership JOIN app_workspaces workspace ON workspace.workspace_id = membership.workspace_id
    LEFT JOIN app_workspace_settings settings ON settings.workspace_id = workspace.workspace_id
    WHERE membership.user_id = $1 AND workspace.status = 'active' ORDER BY workspace.name`, [row.user_id]);
  const workspaces = result.rows.map((workspace) => ({ id: workspace.workspace_id, name: workspace.name, slug: workspace.slug,
    description: workspace.description, iconDataUrl: workspace.icon_data_url || "",
    headerEyebrow: workspace.header_eyebrow || DEFAULT_HEADER_EYEBROW, displayTitle: workspace.display_title || DEFAULT_DISPLAY_TITLE,
    roleId: workspace.role, role: ROLE_LABELS[workspace.role] || "Viewer" }));
  const activeWorkspace = workspaces.find((workspace) => String(workspace.id) === String(row.active_workspace_id)) || null;
  return { ...publicUser({ ...row, membership_role: activeWorkspace?.roleId || row.membership_role }), workspaces, activeWorkspace, hasWorkspaceAccess: Boolean(activeWorkspace) };
}

function canAdministerUsers(user) {
  return Boolean(user && (user.role === "super_user" || user.membership_role === "administrator"));
}

function canAdministerWorkspaces(user) {
  return Boolean(user && (user.role === "super_user" || user.membership_role === "administrator"));
}

async function canAdministerWorkspace(pool, user, workspaceId) {
  if (user?.role === "super_user") return true;
  if (!user || String(user.active_workspace_id || "") !== String(workspaceId || "")) return false;
  const membership = await pool.query("SELECT role FROM app_workspace_memberships WHERE workspace_id = $1 AND user_id = $2", [workspaceId, user.user_id]);
  return membership.rows[0]?.role === "administrator";
}

export async function registerAuthRoutes(app, pool) {
  const enabled = process.env.ENABLE_AUTH === "true";
  const required = enabled && process.env.AUTH_REQUIRE_LOGIN === "true";
  const allowFirstClaim = process.env.ALLOW_FIRST_CLAIM !== "false";

  app.get("/api/v1/auth/status", async (request) => {
    if (!enabled) return { enabled: false, required: false, claimed: false, user: null };
    const [owner, session] = await Promise.all([account(pool), authenticated(pool, request)]);
    return { enabled: true, required, claimed: Boolean(owner), registrationEnabled: Boolean(owner), user: await hydratedUser(pool, session) };
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
    const userId = randomUUID();
    const client = await pool.connect();
    let owner;
    try {
      await client.query("BEGIN");
      const result = await client.query(
        `INSERT INTO app_super_user (singleton, user_id, email, display_name, title, password_salt, password_proof_hash)
         VALUES (TRUE, $1, $2, $3, $4, $5, $6)
         ON CONFLICT (singleton) DO NOTHING
         RETURNING user_id, email, display_name, title, created_at`,
        [userId, email, displayName, title, passwordSalt, sha256(passwordProof)],
      );
      if (!result.rowCount) { await client.query("ROLLBACK"); return reply.code(409).send({ error: "the super-user account has already been claimed" }); }
      const inserted = await client.query(
        `INSERT INTO app_users
          (user_id, email, display_name, title, role, status, password_salt, password_proof_hash, must_change_password, created_by)
         VALUES ($1, $2, $3, $4, 'super_user', 'active', $5, $6, FALSE, $1)
         RETURNING *`,
        [userId, email, displayName, title, passwordSalt, sha256(passwordProof)],
      );
      owner = inserted.rows[0];
      await client.query(`INSERT INTO app_workspaces (workspace_id, name, slug, description, owner_user_id)
        VALUES ($1, 'Defense budget', 'defense-budget', 'Defense Budget Intelligence shared workspace', $2)
        ON CONFLICT (workspace_id) DO UPDATE SET owner_user_id = EXCLUDED.owner_user_id, updated_at = NOW()`, [DEFAULT_WORKSPACE_ID, userId]);
      await client.query(`INSERT INTO app_workspace_memberships (workspace_id, user_id, role, created_by)
        VALUES ($1, $2, 'super_user', $2) ON CONFLICT (workspace_id, user_id) DO NOTHING`, [DEFAULT_WORKSPACE_ID, userId]);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    const session = await issueSession(pool, reply, userId, DEFAULT_WORKSPACE_ID);
    return reply.code(201).send({ user: await hydratedUser(pool, { ...owner, role: "super_user", status: "active", active_workspace_id: session.workspaceId, membership_role: "super_user" }) });
  });

  app.post("/api/v1/auth/register", async (request, reply) => {
    if (!enabled) return reply.code(404).send({ error: "authentication is unavailable" });
    if (!assertSameOrigin(request, reply)) return;
    if (!await account(pool)) return reply.code(409).send({ error: "the Super user must claim the service before registration opens" });
    const email = cleanText(request.body?.email, 254).toLowerCase();
    const displayName = cleanText(request.body?.displayName, 80);
    const title = cleanText(request.body?.title, 80);
    const passwordSalt = cleanText(request.body?.passwordSalt, 128);
    const passwordProof = cleanText(request.body?.passwordProof, 64).toLowerCase();
    if (!validEmail(email) || displayName.length < 2 || passwordSalt.length < 16 || !validProof(passwordProof)) return reply.code(400).send({ error: "valid account details are required" });
    try {
      const userId = randomUUID();
      const result = await pool.query(`INSERT INTO app_users
        (user_id, email, display_name, title, role, status, password_salt, password_proof_hash, must_change_password, created_by, last_login_at)
        VALUES ($1, $2, $3, $4, 'viewer', 'active', $5, $6, FALSE, $1, NOW()) RETURNING *`,
      [userId, email, displayName, title, passwordSalt, sha256(passwordProof)]);
      const session = await issueSession(pool, reply, userId);
      return reply.code(201).send({ user: await hydratedUser(pool, { ...result.rows[0], active_workspace_id: session.workspaceId }) });
    } catch (error) {
      if (error.code === "23505") return reply.code(409).send({ error: "an account with that email already exists" });
      throw error;
    }
  });

  app.post("/api/v1/auth/login-config", async (request, reply) => {
    if (!enabled) return reply.code(404).send({ error: "authentication is unavailable" });
    if (!assertSameOrigin(request, reply)) return;
    const email = cleanText(request.body?.email, 254).toLowerCase();
    const result = await pool.query("SELECT password_salt FROM app_users WHERE LOWER(email) = $1 AND status = 'active'", [email]);
    return { passwordSalt: result.rows[0]?.password_salt || sha256(`unknown|${email}`) };
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
      "SELECT * FROM app_users WHERE LOWER(email) = $1 AND status = 'active'",
      [email],
    );
    const user = result.rows[0];
    const ok = user && validProof(proof) && equalDigest(user.password_proof_hash, sha256(proof));
    await pool.query("INSERT INTO app_login_attempts (identity_hash, succeeded) VALUES ($1, $2)", [identityHash, Boolean(ok)]);
    if (!ok) return reply.code(401).send({ error: "email or password is incorrect" });
    await pool.query("UPDATE app_users SET last_login_at = NOW() WHERE user_id = $1", [user.user_id]);
    const session = await issueSession(pool, reply, user.user_id);
    return { user: await hydratedUser(pool, { ...user, last_login_at: new Date(), active_workspace_id: session.workspaceId }) };
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
    const avatarDataUrl = validAvatar(request.body?.avatarDataUrl);
    if (displayName.length < 2) return reply.code(400).send({ error: "display name is required" });
    if (avatarDataUrl === null) return reply.code(400).send({ error: "profile picture must be an optimized PNG, JPEG, or WebP image" });
    const result = await pool.query(
      `UPDATE app_users SET display_name = $1, title = $2, avatar_data_url = $3, updated_at = NOW()
        WHERE user_id = $4 RETURNING *`,
      [displayName, title, avatarDataUrl, session.user_id],
    );
    if (session.role === "super_user") {
      await pool.query("UPDATE app_super_user SET display_name = $1, title = $2, updated_at = NOW() WHERE user_id = $3", [displayName, title, session.user_id]);
    }
    return { user: await hydratedUser(pool, { ...result.rows[0], active_workspace_id: session.active_workspace_id, membership_role: session.membership_role }) };
  });

  app.post("/api/v1/auth/password", async (request, reply) => {
    if (!assertSameOrigin(request, reply)) return;
    const session = await authenticated(pool, request);
    if (!session) return reply.code(401).send({ error: "sign in required" });
    const currentProof = cleanText(request.body?.currentPasswordProof, 64).toLowerCase();
    const nextProof = cleanText(request.body?.newPasswordProof, 64).toLowerCase();
    const nextSalt = cleanText(request.body?.newPasswordSalt, 128);
    const result = await pool.query("SELECT password_proof_hash FROM app_users WHERE user_id = $1", [session.user_id]);
    if (!validProof(currentProof) || !equalDigest(result.rows[0].password_proof_hash, sha256(currentProof))) {
      return reply.code(403).send({ error: "current password is incorrect" });
    }
    if (!validProof(nextProof) || nextSalt.length < 16) return reply.code(400).send({ error: "new password is invalid" });
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        "UPDATE app_users SET password_salt = $1, password_proof_hash = $2, must_change_password = FALSE, updated_at = NOW() WHERE user_id = $3",
        [nextSalt, sha256(nextProof), session.user_id],
      );
      if (session.role === "super_user") {
        await client.query("UPDATE app_super_user SET password_salt = $1, password_proof_hash = $2, updated_at = NOW() WHERE user_id = $3", [nextSalt, sha256(nextProof), session.user_id]);
      }
      await client.query("DELETE FROM app_auth_sessions WHERE user_id = $1", [session.user_id]);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    const nextSession = await issueSession(pool, reply, session.user_id, session.active_workspace_id);
    return { ok: true, user: await hydratedUser(pool, { ...session, must_change_password: false, active_workspace_id: nextSession.workspaceId }) };
  });

  app.get("/api/v1/auth/users", async (request, reply) => {
    const administrator = await authenticated(pool, request);
    if (!administrator) return reply.code(401).send({ error: "sign in required" });
    if (!canAdministerUsers(administrator)) return reply.code(403).send({ error: "administrator access is required" });
    if (!administrator.active_workspace_id) return reply.code(409).send({ error: "select a workspace before managing users" });
    const result = await pool.query(`
      SELECT u.*, membership.role AS membership_role, COUNT(s.id)::int AS active_sessions
      FROM app_workspace_memberships membership JOIN app_users u ON u.user_id = membership.user_id
      LEFT JOIN app_auth_sessions s ON s.user_id = u.user_id AND s.expires_at > NOW()
      WHERE membership.workspace_id = $1
      GROUP BY u.user_id, membership.role
      ORDER BY CASE membership.role WHEN 'super_user' THEN 0 WHEN 'administrator' THEN 1 WHEN 'analyst' THEN 2 ELSE 3 END,
        u.display_name
    `, [administrator.active_workspace_id]);
    return {
      users: result.rows.map((row) => ({ ...publicUser(row), activeSessions: row.active_sessions, isOwner: row.role === "super_user" })),
      availableRoles: USER_ROLES,
    };
  });

  app.post("/api/v1/auth/users", async (request, reply) => {
    if (!assertSameOrigin(request, reply)) return;
    const administrator = await authenticated(pool, request);
    if (!administrator) return reply.code(401).send({ error: "sign in required" });
    if (!canAdministerUsers(administrator)) return reply.code(403).send({ error: "administrator access is required" });
    if (!administrator.active_workspace_id) return reply.code(409).send({ error: "select a workspace before managing users" });
    const email = cleanText(request.body?.email, 254).toLowerCase();
    const displayName = cleanText(request.body?.displayName, 80);
    const title = cleanText(request.body?.title, 80);
    const role = cleanText(request.body?.role, 32);
    const passwordSalt = cleanText(request.body?.passwordSalt, 128);
    const passwordProof = cleanText(request.body?.passwordProof, 64).toLowerCase();
    if (!validEmail(email) || displayName.length < 2 || !USER_ROLES.includes(role) || passwordSalt.length < 16 || !validProof(passwordProof)) {
      return reply.code(400).send({ error: "valid user details, role, and temporary password are required" });
    }
    const count = await pool.query("SELECT COUNT(*)::int AS count FROM app_workspace_memberships WHERE workspace_id = $1", [administrator.active_workspace_id]);
    if (count.rows[0].count >= 50) return reply.code(409).send({ error: "this workspace is limited to 50 human accounts" });
    try {
      const userId = randomUUID();
      const result = await pool.query(
        `INSERT INTO app_users
          (user_id, email, display_name, title, role, status, password_salt, password_proof_hash, must_change_password, created_by)
         VALUES ($1, $2, $3, $4, $5, 'active', $6, $7, TRUE, $8)
         RETURNING *`,
        [userId, email, displayName, title, role, passwordSalt, sha256(passwordProof), administrator.user_id],
      );
      await pool.query(`INSERT INTO app_workspace_memberships (workspace_id, user_id, role, created_by)
        VALUES ($1, $2, $3, $4)`, [administrator.active_workspace_id, userId, role, administrator.user_id]);
      return reply.code(201).send({ user: { ...publicUser({ ...result.rows[0], membership_role: role }), activeSessions: 0, isOwner: false } });
    } catch (error) {
      if (error.code === "23505") return reply.code(409).send({ error: "an account with that email already exists" });
      throw error;
    }
  });

  app.patch("/api/v1/auth/users/:userId", async (request, reply) => {
    if (!assertSameOrigin(request, reply)) return;
    const administrator = await authenticated(pool, request);
    if (!administrator) return reply.code(401).send({ error: "sign in required" });
    if (!canAdministerUsers(administrator)) return reply.code(403).send({ error: "administrator access is required" });
    const target = await pool.query(`SELECT u.*, membership.role AS membership_role FROM app_users u
      JOIN app_workspace_memberships membership ON membership.user_id = u.user_id
      WHERE u.user_id = $1 AND membership.workspace_id = $2`, [request.params.userId, administrator.active_workspace_id]);
    if (!target.rowCount) return reply.code(404).send({ error: "user not found" });
    if (target.rows[0].role === "super_user") return reply.code(403).send({ error: "the Super user account is immutable in user management" });
    const email = cleanText(request.body?.email, 254).toLowerCase();
    const displayName = cleanText(request.body?.displayName, 80);
    const title = cleanText(request.body?.title, 80);
    const role = cleanText(request.body?.role, 32);
    const status = cleanText(request.body?.status, 32);
    if (!validEmail(email) || displayName.length < 2 || !USER_ROLES.includes(role) || !USER_STATUSES.includes(status)) {
      return reply.code(400).send({ error: "valid user details, role, and status are required" });
    }
    try {
      const result = await pool.query(
        `UPDATE app_users SET email = $1, display_name = $2, title = $3, status = $4, updated_at = NOW()
          WHERE user_id = $5 RETURNING *`,
        [email, displayName, title, status, request.params.userId],
      );
      await pool.query("UPDATE app_workspace_memberships SET role = $1, updated_at = NOW() WHERE workspace_id = $2 AND user_id = $3", [role, administrator.active_workspace_id, request.params.userId]);
      if (status === "suspended") await pool.query("DELETE FROM app_auth_sessions WHERE user_id = $1", [request.params.userId]);
      return { user: { ...publicUser({ ...result.rows[0], membership_role: role }), activeSessions: 0, isOwner: false } };
    } catch (error) {
      if (error.code === "23505") return reply.code(409).send({ error: "an account with that email already exists" });
      throw error;
    }
  });

  app.post("/api/v1/auth/users/:userId/password", async (request, reply) => {
    if (!assertSameOrigin(request, reply)) return;
    const administrator = await authenticated(pool, request);
    if (!administrator) return reply.code(401).send({ error: "sign in required" });
    if (!canAdministerUsers(administrator)) return reply.code(403).send({ error: "administrator access is required" });
    const target = await pool.query(`SELECT u.role FROM app_users u JOIN app_workspace_memberships membership ON membership.user_id = u.user_id
      WHERE u.user_id = $1 AND membership.workspace_id = $2`, [request.params.userId, administrator.active_workspace_id]);
    if (!target.rowCount) return reply.code(404).send({ error: "user not found" });
    if (target.rows[0].role === "super_user") return reply.code(403).send({ error: "the Super user account is immutable in user management" });
    const passwordSalt = cleanText(request.body?.passwordSalt, 128);
    const passwordProof = cleanText(request.body?.passwordProof, 64).toLowerCase();
    if (passwordSalt.length < 16 || !validProof(passwordProof)) return reply.code(400).send({ error: "a valid temporary password is required" });
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        "UPDATE app_users SET password_salt = $1, password_proof_hash = $2, must_change_password = TRUE, updated_at = NOW() WHERE user_id = $3",
        [passwordSalt, sha256(passwordProof), request.params.userId],
      );
      await client.query("DELETE FROM app_auth_sessions WHERE user_id = $1", [request.params.userId]);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    return { ok: true };
  });

  app.get("/api/v1/auth/directory", async (request, reply) => {
    const user = await authenticated(pool, request);
    if (!user) return reply.code(401).send({ error: "sign in required" });
    if (!user.active_workspace_id) return reply.code(409).send({ error: "select a workspace first" });
    const result = await pool.query(`SELECT u.user_id, u.display_name, u.title, u.avatar_data_url
      FROM app_workspace_memberships membership JOIN app_users u ON u.user_id = membership.user_id
      WHERE membership.workspace_id = $1 AND u.status = 'active' ORDER BY u.display_name`, [user.active_workspace_id]);
    return { users: result.rows.map((row) => ({ id: row.user_id, displayName: row.display_name, title: row.title, avatarDataUrl: row.avatar_data_url })) };
  });

  app.get("/api/v1/auth/workspaces", async (request, reply) => {
    const user = await authenticated(pool, request);
    if (!user) return reply.code(401).send({ error: "sign in required" });
    const [workspaces, memberships, requests] = await Promise.all([
      pool.query(`SELECT workspace.*, settings.icon_data_url, settings.header_eyebrow, settings.display_title
        FROM app_workspaces workspace LEFT JOIN app_workspace_settings settings ON settings.workspace_id = workspace.workspace_id
        WHERE workspace.status = 'active' ORDER BY workspace.name`),
      pool.query("SELECT workspace_id, role FROM app_workspace_memberships WHERE user_id = $1", [user.user_id]),
      pool.query("SELECT DISTINCT ON (workspace_id) workspace_id, status FROM app_workspace_access_requests WHERE user_id = $1 ORDER BY workspace_id, created_at DESC", [user.user_id]),
    ]);
    const membershipById = new Map(memberships.rows.map((row) => [String(row.workspace_id), row]));
    const requestById = new Map(requests.rows.map((row) => [String(row.workspace_id), row]));
    return { activeWorkspaceId: user.active_workspace_id, workspaces: workspaces.rows.map((workspace) => {
      const membership = membershipById.get(String(workspace.workspace_id));
      return { id: workspace.workspace_id, name: workspace.name, slug: workspace.slug, description: workspace.description,
        iconDataUrl: workspace.icon_data_url || "", headerEyebrow: workspace.header_eyebrow || DEFAULT_HEADER_EYEBROW,
        displayTitle: workspace.display_title || DEFAULT_DISPLAY_TITLE,
        status: workspace.status, ownerUserId: workspace.owner_user_id, roleId: membership?.role || null,
        role: membership ? ROLE_LABELS[membership.role] : null, requestStatus: requestById.get(String(workspace.workspace_id))?.status || null };
    }) };
  });

  app.post("/api/v1/auth/workspaces/:workspaceId/request", async (request, reply) => {
    if (!assertSameOrigin(request, reply)) return;
    const user = await authenticated(pool, request);
    if (!user) return reply.code(401).send({ error: "sign in required" });
    const membership = await pool.query("SELECT 1 FROM app_workspace_memberships WHERE workspace_id = $1 AND user_id = $2", [request.params.workspaceId, user.user_id]);
    if (membership.rowCount) return reply.code(409).send({ error: "you already have access to this workspace" });
    try {
      const requestId = randomUUID();
      await pool.query(`INSERT INTO app_workspace_access_requests (request_id, workspace_id, user_id, note)
        VALUES ($1, $2, $3, $4)`, [requestId, request.params.workspaceId, user.user_id, cleanText(request.body?.note, 500)]);
      return reply.code(201).send({ request: { id: requestId, workspaceId: request.params.workspaceId, status: "pending" } });
    } catch (error) {
      if (error.code === "23505") return reply.code(409).send({ error: "an access request is already pending" });
      throw error;
    }
  });

  app.post("/api/v1/auth/workspaces/:workspaceId/switch", async (request, reply) => {
    if (!assertSameOrigin(request, reply)) return;
    const user = await authenticated(pool, request);
    if (!user) return reply.code(401).send({ error: "sign in required" });
    const membership = await pool.query("SELECT role FROM app_workspace_memberships WHERE workspace_id = $1 AND user_id = $2", [request.params.workspaceId, user.user_id]);
    if (!membership.rowCount) return reply.code(403).send({ error: "workspace access is required" });
    await pool.query("UPDATE app_auth_sessions SET workspace_id = $1 WHERE id = $2", [request.params.workspaceId, user.id]);
    return { user: await hydratedUser(pool, { ...user, active_workspace_id: request.params.workspaceId, membership_role: membership.rows[0].role }) };
  });

  app.get("/api/v1/auth/workspace-admin", async (request, reply) => {
    const owner = await authenticated(pool, request);
    if (!owner) return reply.code(401).send({ error: "sign in required" });
    if (!canAdministerWorkspaces(owner)) return reply.code(403).send({ error: "Workspace manager access is required" });
    const isSuperUser = owner.role === "super_user";
    const [workspaces, members, requests, users] = await Promise.all([
      pool.query(`SELECT workspace.*, settings.icon_data_url, settings.header_eyebrow, settings.display_title,
        (SELECT COUNT(*)::int FROM app_workspace_memberships membership WHERE membership.workspace_id = workspace.workspace_id) AS member_count,
        (SELECT COUNT(*)::int FROM app_workspace_access_requests access_request WHERE access_request.workspace_id = workspace.workspace_id AND access_request.status = 'pending') AS pending_request_count
        FROM app_workspaces workspace LEFT JOIN app_workspace_settings settings ON settings.workspace_id = workspace.workspace_id
        WHERE ($1::boolean OR workspace.workspace_id = $2) ORDER BY workspace.status, workspace.name`, [isSuperUser, owner.active_workspace_id]),
      pool.query(`SELECT membership.*, u.email, u.display_name, u.title, u.status, u.avatar_data_url
        FROM app_workspace_memberships membership JOIN app_users u ON u.user_id = membership.user_id
        WHERE ($1::boolean OR membership.workspace_id = $2) ORDER BY u.display_name`, [isSuperUser, owner.active_workspace_id]),
      pool.query(`SELECT access_request.*, u.email, u.display_name, u.title, workspace.name AS workspace_name
        FROM app_workspace_access_requests access_request JOIN app_users u ON u.user_id = access_request.user_id
        JOIN app_workspaces workspace ON workspace.workspace_id = access_request.workspace_id
        WHERE ($1::boolean OR access_request.workspace_id = $2)
        ORDER BY CASE access_request.status WHEN 'pending' THEN 0 ELSE 1 END, access_request.created_at DESC`, [isSuperUser, owner.active_workspace_id]),
      pool.query("SELECT user_id, email, display_name, title, status, avatar_data_url FROM app_users WHERE status = 'active' ORDER BY display_name"),
    ]);
    return {
      workspaces: workspaces.rows.map((workspace) => ({ id: workspace.workspace_id, name: workspace.name, slug: workspace.slug,
        description: workspace.description, status: workspace.status, ownerUserId: workspace.owner_user_id,
        iconDataUrl: workspace.icon_data_url || "", headerEyebrow: workspace.header_eyebrow || DEFAULT_HEADER_EYEBROW,
        displayTitle: workspace.display_title || DEFAULT_DISPLAY_TITLE,
        createdAt: workspace.created_at, updatedAt: workspace.updated_at,
        pendingRequestCount: Number(workspace.pending_request_count || 0), lastActivityAt: null,
        contents: { trackedRecords: null, events: null, wallboardEvents: null, milestones: null, manualRecords: null, activityEntries: null, activeAgentKeys: null },
        members: members.rows.filter((member) => String(member.workspace_id) === String(workspace.workspace_id)).map((member) => ({ id: member.user_id,
          email: member.email, displayName: member.display_name, title: member.title, avatarDataUrl: member.avatar_data_url,
          status: member.status, roleId: member.role, role: ROLE_LABELS[member.role] })) })),
      requests: requests.rows.map((row) => ({ id: row.request_id, workspaceId: row.workspace_id, workspaceName: row.workspace_name,
        userId: row.user_id, email: row.email, displayName: row.display_name, title: row.title, note: row.note,
        status: row.status, createdAt: row.created_at, resolvedAt: row.resolved_at })),
      users: users.rows.map((row) => ({ id: row.user_id, email: row.email, displayName: row.display_name, title: row.title,
        avatarDataUrl: row.avatar_data_url, status: row.status })), availableRoles: USER_ROLES,
    };
  });

  app.post("/api/v1/auth/workspace-admin/workspaces", async (request, reply) => {
    if (!assertSameOrigin(request, reply)) return;
    const owner = await authenticated(pool, request);
    if (!owner) return reply.code(401).send({ error: "sign in required" });
    if (owner.role !== "super_user") return reply.code(403).send({ error: "Super user access is required" });
    const name = cleanText(request.body?.name, 80);
    const description = cleanText(request.body?.description, 240);
    const slug = cleanText(request.body?.slug || name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""), 80);
    if (name.length < 2 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) return reply.code(400).send({ error: "a valid workspace name is required" });
    const workspaceId = randomUUID();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(`INSERT INTO app_workspaces (workspace_id, name, slug, description, owner_user_id) VALUES ($1, $2, $3, $4, $5)`, [workspaceId, name, slug, description, owner.user_id]);
      await client.query(`INSERT INTO app_workspace_settings (workspace_id, header_eyebrow, display_title) VALUES ($1, $2, $3)`, [workspaceId, DEFAULT_HEADER_EYEBROW, DEFAULT_DISPLAY_TITLE]);
      await client.query(`INSERT INTO app_workspace_memberships (workspace_id, user_id, role, created_by) VALUES ($1, $2, 'super_user', $2)`, [workspaceId, owner.user_id]);
      await client.query("COMMIT");
      return reply.code(201).send({ workspace: { id: workspaceId, name, slug, description, roleId: "super_user", role: "Super user" } });
    } catch (error) {
      await client.query("ROLLBACK");
      if (error.code === "23505") return reply.code(409).send({ error: "a workspace with that name already exists" });
      throw error;
    } finally { client.release(); }
  });

  app.patch("/api/v1/auth/workspace-admin/workspaces/:workspaceId", async (request, reply) => {
    if (!assertSameOrigin(request, reply)) return;
    const owner = await authenticated(pool, request);
    if (!owner) return reply.code(401).send({ error: "sign in required" });
    if (!await canAdministerWorkspace(pool, owner, request.params.workspaceId)) return reply.code(403).send({ error: "Workspace manager access is required" });
    const name = cleanText(request.body?.name, 80);
    const description = cleanText(request.body?.description, 240);
    const iconDataUrl = validAvatar(request.body?.iconDataUrl);
    const headerEyebrow = cleanText(request.body?.headerEyebrow || DEFAULT_HEADER_EYEBROW, 80);
    const displayTitle = cleanText(request.body?.displayTitle || DEFAULT_DISPLAY_TITLE, 80);
    if (name.length < 2) return reply.code(400).send({ error: "a valid workspace name is required" });
    if (iconDataUrl === null || headerEyebrow.length < 2 || displayTitle.length < 2) return reply.code(400).send({ error: "valid workspace branding is required" });
    const duplicate = await pool.query("SELECT workspace_id FROM app_workspaces WHERE lower(name) = lower($1) AND workspace_id <> $2", [name, request.params.workspaceId]);
    if (duplicate.rowCount) return reply.code(409).send({ error: "a workspace with that name already exists" });
    const result = await pool.query(`UPDATE app_workspaces SET name = $1, description = $2, updated_at = NOW()
      WHERE workspace_id = $3 RETURNING *`, [name, description, request.params.workspaceId]);
    if (!result.rowCount) return reply.code(404).send({ error: "workspace not found" });
    await pool.query(`INSERT INTO app_workspace_settings (workspace_id, icon_data_url, header_eyebrow, display_title, updated_at)
      VALUES ($1, $2, $3, $4, NOW()) ON CONFLICT (workspace_id) DO UPDATE SET icon_data_url = EXCLUDED.icon_data_url,
      header_eyebrow = EXCLUDED.header_eyebrow, display_title = EXCLUDED.display_title, updated_at = NOW()`,
      [request.params.workspaceId, iconDataUrl, headerEyebrow, displayTitle]);
    const workspace = result.rows[0];
    return { workspace: { id: workspace.workspace_id, name: workspace.name, slug: workspace.slug,
      description: workspace.description, status: workspace.status, ownerUserId: workspace.owner_user_id,
      iconDataUrl, headerEyebrow, displayTitle, createdAt: workspace.created_at, updatedAt: workspace.updated_at } };
  });

  app.post("/api/v1/auth/workspace-admin/requests/:requestId", async (request, reply) => {
    if (!assertSameOrigin(request, reply)) return;
    const owner = await authenticated(pool, request);
    if (!owner) return reply.code(401).send({ error: "sign in required" });
    const decision = cleanText(request.body?.decision, 20);
    const role = cleanText(request.body?.role, 32) || "viewer";
    if (!["approved", "denied"].includes(decision) || (decision === "approved" && !USER_ROLES.includes(role))) return reply.code(400).send({ error: "a valid approval decision and role are required" });
    const access = await pool.query("SELECT * FROM app_workspace_access_requests WHERE request_id = $1 AND status = 'pending'", [request.params.requestId]);
    if (!access.rowCount) return reply.code(404).send({ error: "pending access request not found" });
    const row = access.rows[0];
    if (!await canAdministerWorkspace(pool, owner, row.workspace_id)) return reply.code(403).send({ error: "Workspace manager access is required" });
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("UPDATE app_workspace_access_requests SET status = $1, resolved_by = $2, resolved_at = NOW(), updated_at = NOW() WHERE request_id = $3", [decision, owner.user_id, row.request_id]);
      if (decision === "approved") {
        await client.query(`INSERT INTO app_workspace_memberships (workspace_id, user_id, role, created_by) VALUES ($1, $2, $3, $4)
          ON CONFLICT (workspace_id, user_id) DO UPDATE SET role = EXCLUDED.role, updated_at = NOW()`, [row.workspace_id, row.user_id, role, owner.user_id]);
        await client.query("UPDATE app_auth_sessions SET workspace_id = $1 WHERE user_id = $2 AND workspace_id IS NULL", [row.workspace_id, row.user_id]);
      }
      await client.query("COMMIT");
      return { ok: true, status: decision };
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  });

  app.post("/api/v1/auth/workspace-admin/workspaces/:workspaceId/members", async (request, reply) => {
    if (!assertSameOrigin(request, reply)) return;
    const owner = await authenticated(pool, request);
    if (!owner) return reply.code(401).send({ error: "sign in required" });
    if (!await canAdministerWorkspace(pool, owner, request.params.workspaceId)) return reply.code(403).send({ error: "Workspace manager access is required" });
    const role = cleanText(request.body?.role, 32);
    if (!USER_ROLES.includes(role)) return reply.code(400).send({ error: "a valid workspace role is required" });
    const target = await pool.query("SELECT role, status FROM app_users WHERE user_id = $1", [request.body?.userId]);
    if (!target.rowCount || target.rows[0].status !== "active") return reply.code(400).send({ error: "an active user is required" });
    if (target.rows[0].role === "super_user") return reply.code(403).send({ error: "the Super user membership is immutable" });
    const existing = await pool.query("SELECT role FROM app_workspace_memberships WHERE workspace_id = $1 AND user_id = $2", [request.params.workspaceId, request.body?.userId]);
    await pool.query(`INSERT INTO app_workspace_memberships (workspace_id, user_id, role, created_by) VALUES ($1, $2, $3, $4)
      ON CONFLICT (workspace_id, user_id) DO UPDATE SET role = EXCLUDED.role, updated_at = NOW()`, [request.params.workspaceId, request.body?.userId, role, owner.user_id]);
    return reply.code(existing.rowCount ? 200 : 201).send({ ok: true });
  });

  app.delete("/api/v1/auth/workspace-admin/workspaces/:workspaceId/members/:userId", async (request, reply) => {
    if (!assertSameOrigin(request, reply)) return;
    const owner = await authenticated(pool, request);
    if (!owner) return reply.code(401).send({ error: "sign in required" });
    if (!await canAdministerWorkspace(pool, owner, request.params.workspaceId)) return reply.code(403).send({ error: "Workspace manager access is required" });
    const membership = await pool.query("SELECT role FROM app_workspace_memberships WHERE workspace_id = $1 AND user_id = $2", [request.params.workspaceId, request.params.userId]);
    if (!membership.rowCount) return reply.code(404).send({ error: "workspace member not found" });
    if (membership.rows[0].role === "super_user") return reply.code(403).send({ error: "the Super user cannot be removed from a workspace" });
    await pool.query("DELETE FROM app_workspace_memberships WHERE workspace_id = $1 AND user_id = $2", [request.params.workspaceId, request.params.userId]);
    await pool.query("UPDATE app_auth_sessions SET workspace_id = NULL WHERE workspace_id = $1 AND user_id = $2", [request.params.workspaceId, request.params.userId]);
    return { ok: true };
  });

  app.get("/api/v1/auth/openai-keys", async (request, reply) => {
    const user = await authenticated(pool, request);
    if (!user) return reply.code(401).send({ error: "sign in required" });
    const workspaceId = user.active_workspace_id || null;
    const canManageWorkspaceKeys = workspaceId ? await canAdministerWorkspace(pool, user, workspaceId) : false;
    const [personal, workspace] = await Promise.all([
      pool.query("SELECT * FROM app_openai_keys WHERE scope_type = 'user' AND user_id = $1 ORDER BY revoked_at NULLS FIRST, is_default DESC, created_at DESC", [user.user_id]),
      workspaceId && canManageWorkspaceKeys
        ? pool.query("SELECT * FROM app_openai_keys WHERE scope_type = 'workspace' AND workspace_id = $1 ORDER BY revoked_at NULLS FIRST, is_default DESC, created_at DESC", [workspaceId])
        : Promise.resolve({ rows: [] }),
    ]);
    return {
      capability: {
        provider: "openai",
        encryptionReady: String(process.env.DBI_CREDENTIAL_ENCRYPTION_KEY || "").length >= 32,
        canManageWorkspaceKeys,
        activeWorkspaceId: workspaceId,
        queryRuntimeEnabled: false,
      },
      personalKeys: personal.rows.map(openAiKeyMetadata),
      workspaceKeys: workspace.rows.map(openAiKeyMetadata),
    };
  });

  app.post("/api/v1/auth/openai-keys", async (request, reply) => {
    if (!assertSameOrigin(request, reply)) return;
    const user = await authenticated(pool, request);
    if (!user) return reply.code(401).send({ error: "sign in required" });
    const scope = cleanText(request.body?.scope, 20);
    const label = cleanText(request.body?.label, 80);
    const apiKey = validOpenAiKey(request.body?.apiKey);
    if (!['workspace', 'user'].includes(scope) || label.length < 2 || !apiKey) return reply.code(400).send({ error: "a valid scope, label, and OpenAI API key are required" });
    if (scope === "workspace" && (!user.active_workspace_id || !await canAdministerWorkspace(pool, user, user.active_workspace_id))) return reply.code(403).send({ error: "Workspace manager access is required" });
    const encrypted = encryptOpenAiKey(apiKey);
    if (!encrypted) return reply.code(503).send({ error: "OpenAI key storage is not configured on this runtime" });
    const scopeId = scope === "workspace" ? user.active_workspace_id : user.user_id;
    const existing = await pool.query(`SELECT COUNT(*)::int AS count FROM app_openai_keys WHERE scope_type = $1 AND ${scope === "workspace" ? "workspace_id" : "user_id"} = $2 AND revoked_at IS NULL`, [scope, scopeId]);
    if (existing.rows[0].count >= 10) return reply.code(409).send({ error: "revoke an existing OpenAI key before adding another" });
    const isDefault = Boolean(request.body?.isDefault) || existing.rows[0].count === 0;
    const id = randomUUID();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      if (isDefault) await client.query(`UPDATE app_openai_keys SET is_default = FALSE, updated_at = NOW() WHERE scope_type = $1 AND ${scope === "workspace" ? "workspace_id" : "user_id"} = $2 AND revoked_at IS NULL`, [scope, scopeId]);
      const result = await client.query(`INSERT INTO app_openai_keys
        (id, scope_type, workspace_id, user_id, label, encrypted_key, key_iv, key_version, key_last_four, is_default, created_by)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`, [
        id, scope, scope === "workspace" ? user.active_workspace_id : null, scope === "user" ? user.user_id : null,
        label, encrypted.encryptedKey, encrypted.keyIv, encrypted.keyVersion, apiKey.slice(-4), isDefault, user.user_id,
      ]);
      await client.query("COMMIT");
      return reply.code(201).send({ key: openAiKeyMetadata(result.rows[0]) });
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
  });

  app.patch("/api/v1/auth/openai-keys/:keyId", async (request, reply) => {
    if (!assertSameOrigin(request, reply)) return;
    const user = await authenticated(pool, request);
    if (!user) return reply.code(401).send({ error: "sign in required" });
    const result = await pool.query("SELECT * FROM app_openai_keys WHERE id = $1", [request.params.keyId]);
    if (!result.rowCount) return reply.code(404).send({ error: "OpenAI key not found" });
    const stored = result.rows[0];
    const authorized = stored.scope_type === "user"
      ? String(stored.user_id) === String(user.user_id)
      : String(stored.workspace_id) === String(user.active_workspace_id) && await canAdministerWorkspace(pool, user, stored.workspace_id);
    if (!authorized) return reply.code(403).send({ error: "credential management access is required" });
    if (stored.revoked_at) return reply.code(409).send({ error: "OpenAI key is already revoked" });
    const label = cleanText(request.body?.label ?? stored.label, 80);
    const nextApiKey = request.body?.apiKey ? validOpenAiKey(request.body.apiKey) : "";
    if (label.length < 2 || (request.body?.apiKey && !nextApiKey)) return reply.code(400).send({ error: "a valid label and OpenAI API key are required" });
    const encrypted = nextApiKey ? encryptOpenAiKey(nextApiKey) : null;
    if (nextApiKey && !encrypted) return reply.code(503).send({ error: "OpenAI key storage is not configured on this runtime" });
    const makeDefault = Boolean(request.body?.isDefault);
    const scopeId = stored.scope_type === "workspace" ? stored.workspace_id : stored.user_id;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      if (makeDefault) await client.query(`UPDATE app_openai_keys SET is_default = FALSE, updated_at = NOW() WHERE scope_type = $1 AND ${stored.scope_type === "workspace" ? "workspace_id" : "user_id"} = $2 AND revoked_at IS NULL`, [stored.scope_type, scopeId]);
      const updated = await client.query(`UPDATE app_openai_keys SET label = $1, encrypted_key = $2, key_iv = $3, key_version = $4,
        key_last_four = $5, is_default = $6, updated_at = NOW() WHERE id = $7 AND revoked_at IS NULL RETURNING *`, [
        label, encrypted?.encryptedKey || stored.encrypted_key, encrypted?.keyIv || stored.key_iv, encrypted?.keyVersion || stored.key_version,
        nextApiKey ? nextApiKey.slice(-4) : stored.key_last_four, makeDefault || stored.is_default, stored.id,
      ]);
      await client.query("COMMIT");
      return { key: openAiKeyMetadata(updated.rows[0]) };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
  });

  app.delete("/api/v1/auth/openai-keys/:keyId", async (request, reply) => {
    if (!assertSameOrigin(request, reply)) return;
    const user = await authenticated(pool, request);
    if (!user) return reply.code(401).send({ error: "sign in required" });
    const result = await pool.query("SELECT * FROM app_openai_keys WHERE id = $1", [request.params.keyId]);
    if (!result.rowCount) return reply.code(404).send({ error: "OpenAI key not found" });
    const stored = result.rows[0];
    const authorized = stored.scope_type === "user"
      ? String(stored.user_id) === String(user.user_id)
      : String(stored.workspace_id) === String(user.active_workspace_id) && await canAdministerWorkspace(pool, user, stored.workspace_id);
    if (!authorized) return reply.code(403).send({ error: "credential management access is required" });
    if (stored.revoked_at) return reply.code(409).send({ error: "OpenAI key is already revoked" });
    await pool.query("UPDATE app_openai_keys SET revoked_at = NOW(), is_default = FALSE, updated_at = NOW() WHERE id = $1", [stored.id]);
    return { ok: true };
  });

  if (required) {
    app.addHook("preHandler", async (request, reply) => {
      if (!request.url.startsWith("/api/v1/") || request.url.startsWith("/api/v1/auth/")) return;
      if (!await authenticated(pool, request)) return reply.code(401).send({ error: "sign in required" });
    });
  }
}
