import { randomBytes, randomUUID } from "node:crypto";
import {
  effectiveInviteStatus,
  formatInviteCode,
  inviteCodeSuffix,
  normalizeInviteCode,
  normalizeInviteExpiryDays,
  normalizeRegistrationMode,
} from "../src/registration-core.js";

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

async function settings(pool) {
  const result = await pool.query("SELECT * FROM app_registration_settings WHERE singleton = TRUE");
  const row = result.rows[0];
  return {
    mode: normalizeRegistrationMode(row?.mode),
    updatedBy: row?.updated_by || "",
    updatedAt: row?.updated_at || "",
  };
}

export async function registrationPublicStatus(pool, ownerExists) {
  const policy = await settings(pool);
  return {
    registrationEnabled: Boolean(ownerExists) && policy.mode === "invite_only",
    registrationMode: policy.mode,
  };
}

export function registerAccountRegistrationRoute(app, pool, dependencies) {
  const {
    account,
    assertSameOrigin,
    authenticated,
    canAdministerUsers,
    cleanText,
    enabled,
    hydratedUser,
    issueSession,
    recordUserActivity,
    sha256,
    validEmail,
    validProof,
  } = dependencies;

  app.post("/api/v1/auth/register", async (request, reply) => {
    if (!enabled) return reply.code(404).send({ error: "authentication is unavailable" });
    if (!assertSameOrigin(request, reply)) return;
    if (!await account(pool)) return reply.code(409).send({ error: "the Super user must claim the service before registration opens" });
    const policy = await settings(pool);
    if (policy.mode !== "invite_only") return reply.code(403).send({ error: "registration is closed" });
    const email = cleanText(request.body?.email, 254).toLowerCase();
    const displayName = cleanText(request.body?.displayName, 80);
    const title = cleanText(request.body?.title, 80);
    const passwordSalt = cleanText(request.body?.passwordSalt, 128);
    const passwordProof = cleanText(request.body?.passwordProof, 64).toLowerCase();
    const inviteCode = normalizeInviteCode(request.body?.inviteCode);
    if (!validEmail(email) || displayName.length < 2 || passwordSalt.length < 16 || !validProof(passwordProof) || inviteCode.length < 24) {
      return reply.code(400).send({ error: "valid account details and invite code are required" });
    }
    const client = await pool.connect();
    let result;
    try {
      await client.query("BEGIN");
      const inviteResult = await client.query("SELECT * FROM app_registration_invites WHERE code_hash = $1 FOR UPDATE", [sha256(inviteCode)]);
      const invite = inviteResult.rows[0];
      if (!invite || effectiveInviteStatus(inviteView(invite)) !== "active" || (invite.email && invite.email !== email)) {
        await client.query("ROLLBACK");
        return reply.code(403).send({ error: "invite code is invalid or unavailable" });
      }
      const count = await client.query("SELECT COUNT(*)::int AS count FROM app_users");
      if (count.rows[0].count >= 250) {
        await client.query("ROLLBACK");
        return reply.code(409).send({ error: "account registration is temporarily full" });
      }
      const userId = randomUUID();
      result = await client.query(`INSERT INTO app_users
        (user_id, email, display_name, title, role, status, password_salt, password_proof_hash, must_change_password, created_by, last_login_at)
        VALUES ($1, $2, $3, $4, 'viewer', 'active', $5, $6, FALSE, $7, NOW()) RETURNING *`,
      [userId, email, displayName, title, passwordSalt, sha256(passwordProof), invite.created_by]);
      await client.query(`UPDATE app_registration_invites
        SET status = 'used', used_by = $1, used_at = NOW()
        WHERE id = $2 AND status = 'active'`, [userId, invite.id]);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      if (error.code === "23505") return reply.code(409).send({ error: "an account with that email already exists" });
      throw error;
    } finally {
      client.release();
    }
    const session = await issueSession(pool, reply, result.rows[0].user_id);
    return reply.code(201).send({ user: await hydratedUser(pool, { ...result.rows[0], active_workspace_id: session.workspaceId }) });
  });

  app.get("/api/v1/auth/registration", async (request, reply) => {
    const administrator = await authenticated(pool, request);
    if (!administrator) return reply.code(401).send({ error: "sign in required" });
    if (!canAdministerUsers(administrator)) return reply.code(403).send({ error: "Super user access is required" });
    const [policy, invites] = await Promise.all([
      settings(pool),
      pool.query("SELECT * FROM app_registration_invites ORDER BY created_at DESC LIMIT 250"),
    ]);
    return { policy, invites: invites.rows.map(inviteView), defaults: { expiresInDays: 7, allowedExpiryDays: [1, 7, 14, 30] } };
  });

  app.patch("/api/v1/auth/registration", async (request, reply) => {
    if (!assertSameOrigin(request, reply)) return;
    const administrator = await authenticated(pool, request);
    if (!administrator) return reply.code(401).send({ error: "sign in required" });
    if (!canAdministerUsers(administrator)) return reply.code(403).send({ error: "Super user access is required" });
    const rawMode = cleanText(request.body?.mode, 32);
    const mode = normalizeRegistrationMode(rawMode);
    if (mode !== rawMode) return reply.code(400).send({ error: "registration mode must be closed or invite_only" });
    await pool.query("UPDATE app_registration_settings SET mode = $1, updated_by = $2, updated_at = NOW() WHERE singleton = TRUE", [mode, administrator.user_id]);
    await recordUserActivity(pool, administrator, { eventType: "action", action: "registration_policy_updated", surface: "users", targetType: "registration", targetId: "platform" });
    return { policy: await settings(pool) };
  });

  app.post("/api/v1/auth/registration/invites", async (request, reply) => {
    if (!assertSameOrigin(request, reply)) return;
    const administrator = await authenticated(pool, request);
    if (!administrator) return reply.code(401).send({ error: "sign in required" });
    if (!canAdministerUsers(administrator)) return reply.code(403).send({ error: "Super user access is required" });
    const rawEmail = cleanText(request.body?.email, 254).toLowerCase();
    if (rawEmail && !validEmail(rawEmail)) return reply.code(400).send({ error: "invite email must be valid" });
    const label = cleanText(request.body?.label, 80);
    const expiresInDays = normalizeInviteExpiryDays(request.body?.expiresInDays);
    const code = formatInviteCode(randomBytes(16));
    const id = randomUUID();
    const result = await pool.query(`INSERT INTO app_registration_invites
      (id, code_hash, code_suffix, label, email, status, expires_at, created_by)
      VALUES ($1, $2, $3, $4, $5, 'active', NOW() + ($6 * INTERVAL '1 day'), $7)
      RETURNING *`, [id, sha256(normalizeInviteCode(code)), inviteCodeSuffix(code), label, rawEmail, expiresInDays, administrator.user_id]);
    await recordUserActivity(pool, administrator, { eventType: "action", action: "registration_invite_created", surface: "users", targetType: "registration_invite", targetId: id });
    return reply.code(201).send({ invite: inviteView(result.rows[0]), code });
  });

  app.delete("/api/v1/auth/registration/invites/:inviteId", async (request, reply) => {
    if (!assertSameOrigin(request, reply)) return;
    const administrator = await authenticated(pool, request);
    if (!administrator) return reply.code(401).send({ error: "sign in required" });
    if (!canAdministerUsers(administrator)) return reply.code(403).send({ error: "Super user access is required" });
    const result = await pool.query(`UPDATE app_registration_invites
      SET status = 'revoked', revoked_by = $1, revoked_at = NOW()
      WHERE id = $2 AND status = 'active' RETURNING id`, [administrator.user_id, request.params.inviteId]);
    if (!result.rowCount) return reply.code(404).send({ error: "active invite not found" });
    await recordUserActivity(pool, administrator, { eventType: "action", action: "registration_invite_revoked", surface: "users", targetType: "registration_invite", targetId: request.params.inviteId });
    return { ok: true };
  });
}
