import {
  effectiveInviteStatus,
  formatInviteCode,
  inviteCodeSuffix,
  normalizeInviteCode,
  normalizeInviteExpiryDays,
  normalizeRegistrationMode,
} from "./registration-core.js";

export const D1_REGISTRATION_SCHEMA = Object.freeze([
  `CREATE TABLE IF NOT EXISTS dbi_registration_settings (
    singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
    mode TEXT NOT NULL DEFAULT 'closed' CHECK (mode IN ('closed', 'invite_only')),
    updated_by TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `INSERT OR IGNORE INTO dbi_registration_settings
    (singleton, mode, updated_by, created_at, updated_at)
    VALUES (1, 'closed', '', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`,
  `CREATE TABLE IF NOT EXISTS dbi_registration_invites (
    id TEXT PRIMARY KEY,
    code_hash TEXT NOT NULL UNIQUE,
    code_suffix TEXT NOT NULL,
    label TEXT NOT NULL DEFAULT '',
    email TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'used', 'revoked')),
    expires_at TEXT NOT NULL,
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL,
    used_by TEXT NOT NULL DEFAULT '',
    used_at TEXT NOT NULL DEFAULT '',
    revoked_by TEXT NOT NULL DEFAULT '',
    revoked_at TEXT NOT NULL DEFAULT ''
  )`,
  "CREATE INDEX IF NOT EXISTS idx_dbi_registration_invites_status_expiry ON dbi_registration_invites (status, expires_at)",
  "CREATE INDEX IF NOT EXISTS idx_dbi_registration_invites_created ON dbi_registration_invites (created_at DESC)",
]);

function inviteView(row) {
  const invite = {
    id: row.id,
    codeSuffix: row.code_suffix,
    label: row.label || "",
    email: row.email || "",
    status: row.status,
    expiresAt: row.expires_at,
    createdBy: row.created_by,
    createdAt: row.created_at,
    usedBy: row.used_by || "",
    usedAt: row.used_at || "",
    revokedBy: row.revoked_by || "",
    revokedAt: row.revoked_at || "",
  };
  return { ...invite, status: effectiveInviteStatus(invite) };
}

async function registrationSettings(db) {
  const row = await db.prepare("SELECT * FROM dbi_registration_settings WHERE singleton = 1").first();
  return {
    mode: normalizeRegistrationMode(row?.mode),
    updatedBy: row?.updated_by || "",
    updatedAt: row?.updated_at || "",
  };
}

export async function d1PublicRegistrationStatus(db, ownerExists) {
  const settings = await registrationSettings(db);
  return {
    registrationEnabled: Boolean(ownerExists) && settings.mode === "invite_only",
    registrationMode: settings.mode,
  };
}

function randomInviteCode() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return formatInviteCode(bytes);
}

export async function d1RegistrationResponse(request, db, env, deps) {
  const {
    canAdministerUsers,
    cleanText,
    createSession,
    hashValue,
    json,
    normalizeEmail,
    publicSessionUser,
    recordActivity,
    safeJson,
    sameOriginRequest,
    sessionCookie,
    sessionUser,
    superUser,
    validPasswordProof,
    validSalt,
  } = deps;
  const pathname = new URL(request.url).pathname.replace(/\/+$/, "");

  if (pathname === "/api/v1/auth/register") {
    if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
    if (!sameOriginRequest(request)) return json({ error: "Cross-origin registration is not allowed" }, 403);
    if (!await superUser(db)) return json({ error: "The Super user must claim the service before registration opens" }, 409);
    const settings = await registrationSettings(db);
    if (settings.mode !== "invite_only") return json({ error: "Registration is closed" }, 403);
    const body = await safeJson(request);
    const email = normalizeEmail(body?.email);
    const displayName = cleanText(body?.displayName, 80);
    const title = cleanText(body?.title, 80);
    const passwordSalt = cleanText(body?.passwordSalt, 128).toLowerCase();
    const passwordProof = cleanText(body?.passwordProof, 64).toLowerCase();
    const inviteCode = normalizeInviteCode(body?.inviteCode);
    if (!email || displayName.length < 2 || !validSalt(passwordSalt) || !validPasswordProof(passwordProof) || inviteCode.length < 24) {
      return json({ error: "Valid account details and invite code are required" }, 400);
    }
    const count = await db.prepare("SELECT COUNT(*) AS count FROM dbi_users").first();
    if (Number(count?.count || 0) >= 250) return json({ error: "Account registration is temporarily full" }, 409);
    const invite = await db.prepare("SELECT * FROM dbi_registration_invites WHERE code_hash = ?")
      .bind(await hashValue(inviteCode)).first();
    const now = new Date().toISOString();
    if (!invite || effectiveInviteStatus(inviteView(invite)) !== "active" || (invite.email && invite.email !== email)) {
      return json({ error: "Invite code is invalid or unavailable" }, 403);
    }
    const userId = crypto.randomUUID();
    try {
      const results = await db.batch([
        db.prepare(`INSERT INTO dbi_users
          (user_id, email, display_name, title, role, status, password_salt, password_hash, must_change_password, created_by, created_at, updated_at, last_login_at)
          SELECT ?, ?, ?, ?, 'viewer', 'active', ?, ?, 0, created_by, ?, ?, ?
          FROM dbi_registration_invites
          WHERE id = ? AND status = 'active' AND expires_at > ? AND (email = '' OR email = ?)`)
          .bind(userId, email, displayName, title, passwordSalt, `v1$${await hashValue(passwordProof)}`, now, now, now, invite.id, now, email),
        db.prepare(`UPDATE dbi_registration_invites
          SET status = 'used', used_by = ?, used_at = ?
          WHERE id = ? AND status = 'active' AND expires_at > ? AND (email = '' OR email = ?)`)
          .bind(userId, now, invite.id, now, email),
      ]);
      if (Number(results[0]?.meta?.changes || 0) !== 1 || Number(results[1]?.meta?.changes || 0) !== 1) {
        return json({ error: "Invite code is invalid or unavailable" }, 403);
      }
    } catch (error) {
      if (/unique|constraint/i.test(String(error?.message || ""))) return json({ error: "An account with that email already exists" }, 409);
      throw error;
    }
    const session = await createSession(db, userId);
    const row = await db.prepare("SELECT * FROM dbi_users WHERE user_id = ?").bind(userId).first();
    return json({ user: await publicSessionUser(db, row), expiresAt: session.expiresAt }, 201, {
      "set-cookie": sessionCookie(session.rawToken, request, env),
    });
  }

  if (!sameOriginRequest(request)) return json({ error: "Cross-origin registration administration is not allowed" }, 403);
  const administrator = await sessionUser(db, request);
  if (!administrator) return json({ error: "Sign in required" }, 401);
  if (!canAdministerUsers(administrator)) return json({ error: "Super user access is required" }, 403);
  const prefix = "/api/v1/auth/registration";
  const relative = pathname.slice(prefix.length).replace(/^\//, "");
  const [resource = "", encodedId = ""] = relative.split("/");

  if (request.method === "GET" && !resource) {
    const [policy, result] = await Promise.all([
      registrationSettings(db),
      db.prepare("SELECT * FROM dbi_registration_invites ORDER BY created_at DESC LIMIT 250").all(),
    ]);
    return json({ policy, invites: (result.results || []).map(inviteView), defaults: { expiresInDays: 7, allowedExpiryDays: [1, 7, 14, 30] } });
  }

  if (request.method === "PATCH" && !resource) {
    const body = await safeJson(request);
    const mode = normalizeRegistrationMode(cleanText(body?.mode, 32));
    if (mode !== body?.mode) return json({ error: "Registration mode must be closed or invite_only" }, 400);
    const now = new Date().toISOString();
    await db.prepare(`UPDATE dbi_registration_settings SET mode = ?, updated_by = ?, updated_at = ? WHERE singleton = 1`)
      .bind(mode, administrator.user_id, now).run();
    await recordActivity(db, { type: "user", id: administrator.user_id, workspaceId: administrator.active_workspace_id }, "registration_policy_updated", "registration", "platform", { mode });
    return json({ policy: await registrationSettings(db) });
  }

  if (request.method === "POST" && resource === "invites" && !encodedId) {
    const body = await safeJson(request);
    const rawEmail = cleanText(body?.email, 254).toLowerCase();
    const email = rawEmail ? normalizeEmail(rawEmail) : "";
    if (rawEmail && !email) return json({ error: "Invite email must be valid" }, 400);
    const label = cleanText(body?.label, 80);
    const expiresInDays = normalizeInviteExpiryDays(body?.expiresInDays);
    const code = randomInviteCode();
    const now = new Date();
    const invite = {
      id: crypto.randomUUID(),
      codeSuffix: inviteCodeSuffix(code),
      label,
      email,
      status: "active",
      expiresAt: new Date(now.getTime() + expiresInDays * 86_400_000).toISOString(),
      createdBy: administrator.user_id,
      createdAt: now.toISOString(),
    };
    await db.prepare(`INSERT INTO dbi_registration_invites
      (id, code_hash, code_suffix, label, email, status, expires_at, created_by, created_at)
      VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?)`)
      .bind(invite.id, await hashValue(normalizeInviteCode(code)), invite.codeSuffix, label, email, invite.expiresAt, administrator.user_id, invite.createdAt).run();
    await recordActivity(db, { type: "user", id: administrator.user_id, workspaceId: administrator.active_workspace_id }, "registration_invite_created", "registration_invite", invite.id, { emailBound: Boolean(email), expiresInDays });
    return json({ invite, code }, 201);
  }

  if (request.method === "DELETE" && resource === "invites" && encodedId) {
    const id = cleanText(decodeURIComponent(encodedId), 80);
    const now = new Date().toISOString();
    const changed = await db.prepare(`UPDATE dbi_registration_invites
      SET status = 'revoked', revoked_by = ?, revoked_at = ?
      WHERE id = ? AND status = 'active'`).bind(administrator.user_id, now, id).run();
    if (!Number(changed?.meta?.changes || 0)) return json({ error: "Active invite not found" }, 404);
    await recordActivity(db, { type: "user", id: administrator.user_id, workspaceId: administrator.active_workspace_id }, "registration_invite_revoked", "registration_invite", id, {});
    return json({ ok: true });
  }

  return json({ error: "Method not allowed" }, 405);
}
