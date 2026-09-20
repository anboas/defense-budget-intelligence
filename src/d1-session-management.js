function publicSession(row, currentSessionId) {
  return {
    id: row.id,
    current: String(row.id) === String(currentSessionId),
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at,
    expiresAt: row.expires_at,
  };
}

export async function d1SessionManagementResponse(request, db, {
  json,
  recordActivity,
  sameOriginRequest,
  sessionUser,
}) {
  const session = await sessionUser(db, request);
  if (!session) return json({ error: "Sign in required" }, 401);
  if (session.is_emulating) return json({ error: "Exit user emulation before managing sessions" }, 403);

  const pathname = new URL(request.url).pathname.replace(/\/+$/, "");
  const prefix = "/api/v1/auth/sessions";
  const sessionId = decodeURIComponent(pathname.slice(prefix.length).replace(/^\//, ""));
  const actorUserId = session.actor_user_id || session.user_id;

  if (request.method === "GET" && !sessionId) {
    const result = await db.prepare(`SELECT id, created_at, last_seen_at, expires_at
      FROM dbi_sessions
      WHERE user_id = ? AND revoked_at = '' AND expires_at > ?
      ORDER BY last_seen_at DESC, created_at DESC`)
      .bind(actorUserId, new Date().toISOString()).all();
    return json({ sessions: (result.results || []).map((row) => publicSession(row, session.session_id)) });
  }

  if (request.method !== "DELETE") return json({ error: "Method not allowed" }, 405);
  if (!sameOriginRequest(request)) return json({ error: "Cross-origin session management is not allowed" }, 403);
  const now = new Date().toISOString();

  if (sessionId) {
    if (String(sessionId) === String(session.session_id)) return json({ error: "Use sign out to end the current session" }, 409);
    const result = await db.prepare(`UPDATE dbi_sessions SET revoked_at = ?
      WHERE id = ? AND user_id = ? AND revoked_at = '' AND expires_at > ?`)
      .bind(now, sessionId, actorUserId, now).run();
    if (!Number(result?.meta?.changes || 0)) return json({ error: "Active session not found" }, 404);
    await recordActivity(db, { type: "user", id: actorUserId, workspaceId: session.active_workspace_id }, "session_revoked", "session", sessionId);
    return json({ ok: true });
  }

  const result = await db.prepare(`UPDATE dbi_sessions SET revoked_at = ?
    WHERE user_id = ? AND id <> ? AND revoked_at = '' AND expires_at > ?`)
    .bind(now, actorUserId, session.session_id, now).run();
  const revokedCount = Number(result?.meta?.changes || 0);
  await recordActivity(db, { type: "user", id: actorUserId, workspaceId: session.active_workspace_id }, "other_sessions_revoked", "session", session.session_id, { revokedCount });
  return json({ ok: true, revokedCount });
}
