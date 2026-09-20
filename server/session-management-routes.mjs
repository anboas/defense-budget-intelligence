export function registerSessionManagementRoutes(app, pool, {
  assertSameOrigin,
  authenticated,
  recordUserActivity,
}) {
  app.get("/api/v1/auth/sessions", async (request, reply) => {
    const session = await authenticated(pool, request);
    if (!session) return reply.code(401).send({ error: "sign in required" });
    if (session.is_emulating) return reply.code(403).send({ error: "exit user emulation before managing sessions" });
    const result = await pool.query(`SELECT id, created_at, last_seen_at, expires_at
      FROM app_auth_sessions
      WHERE user_id = $1 AND expires_at > NOW()
      ORDER BY last_seen_at DESC, created_at DESC`, [session.actor_user_id]);
    return {
      sessions: result.rows.map((row) => ({
        id: row.id,
        current: String(row.id) === String(session.id),
        createdAt: row.created_at,
        lastSeenAt: row.last_seen_at,
        expiresAt: row.expires_at,
      })),
    };
  });

  app.delete("/api/v1/auth/sessions/:sessionId", async (request, reply) => {
    if (!assertSameOrigin(request, reply)) return;
    const session = await authenticated(pool, request);
    if (!session) return reply.code(401).send({ error: "sign in required" });
    if (session.is_emulating) return reply.code(403).send({ error: "exit user emulation before managing sessions" });
    if (String(request.params.sessionId) === String(session.id)) {
      return reply.code(409).send({ error: "use sign out to end the current session" });
    }
    const result = await pool.query(`DELETE FROM app_auth_sessions
      WHERE id = $1 AND user_id = $2 AND expires_at > NOW()
      RETURNING id`, [request.params.sessionId, session.actor_user_id]);
    if (!result.rowCount) return reply.code(404).send({ error: "active session not found" });
    await recordUserActivity(pool, session, {
      eventType: "action",
      action: "session_revoked",
      surface: "security",
      targetType: "session",
      targetId: request.params.sessionId,
    });
    return { ok: true };
  });

  app.delete("/api/v1/auth/sessions", async (request, reply) => {
    if (!assertSameOrigin(request, reply)) return;
    const session = await authenticated(pool, request);
    if (!session) return reply.code(401).send({ error: "sign in required" });
    if (session.is_emulating) return reply.code(403).send({ error: "exit user emulation before managing sessions" });
    const result = await pool.query(`DELETE FROM app_auth_sessions
      WHERE user_id = $1 AND id <> $2 AND expires_at > NOW()`, [session.actor_user_id, session.id]);
    await recordUserActivity(pool, session, {
      eventType: "action",
      action: "other_sessions_revoked",
      surface: "security",
      targetType: "session",
      targetId: session.id,
      metadata: { revokedCount: result.rowCount },
    });
    return { ok: true, revokedCount: result.rowCount };
  });
}
