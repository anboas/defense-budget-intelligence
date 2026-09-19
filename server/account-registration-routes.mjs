import { randomUUID } from "node:crypto";

export function registerAccountRegistrationRoute(app, pool, dependencies) {
  const {
    account,
    allowSelfRegistration,
    assertSameOrigin,
    cleanText,
    enabled,
    hydratedUser,
    issueSession,
    sha256,
    validEmail,
    validProof,
  } = dependencies;

  app.post("/api/v1/auth/register", async (request, reply) => {
    if (!enabled) return reply.code(404).send({ error: "authentication is unavailable" });
    if (!allowSelfRegistration) return reply.code(403).send({ error: "self-registration is unavailable" });
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
}
