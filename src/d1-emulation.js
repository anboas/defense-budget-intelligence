import { cleanText, sameOriginRequest } from "./security-policy.js";

export async function emulationResponse(request, db, deps) {
  const { sessionUser, publicSessionUser, recordActivity, json, safeJson } = deps;
  if (!sameOriginRequest(request)) return json({ error: "Cross-origin user emulation is not allowed" }, 403);
  const session = await sessionUser(db, request);
  if (!session) return json({ error: "Sign in required" }, 401);
  if (request.method === "DELETE") {
    if (session.actor_role !== "super_user") return json({ error: "Super user access is required" }, 403);
    await db.prepare("DELETE FROM dbi_session_emulations WHERE session_id = ?").bind(session.session_id).run();
    await recordActivity(db, { type: "user", id: session.actor_user_id, workspaceId: session.active_workspace_id }, "user_emulation_stopped", "user", session.user_id);
    return json({ user: await publicSessionUser(db, await sessionUser(db, request)) });
  }
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (session.is_emulating || session.role !== "super_user" || session.actor_role !== "super_user") return json({ error: "Only the signed-in Super user may start emulation" }, 403);
  const targetUserId = cleanText((await safeJson(request))?.userId, 80);
  if (!targetUserId || targetUserId === session.user_id) return json({ error: "Choose a managed user to emulate" }, 400);
  const target = await db.prepare(`SELECT user.user_id, user.must_change_password, membership.workspace_id
    FROM dbi_users user JOIN dbi_workspace_memberships membership ON membership.user_id = user.user_id
    JOIN dbi_workspaces workspace ON workspace.workspace_id = membership.workspace_id AND workspace.status = 'active'
    WHERE user.user_id = ? AND user.status = 'active'
    ORDER BY CASE WHEN membership.workspace_id = ? THEN 0 ELSE 1 END, workspace.name COLLATE NOCASE LIMIT 1`)
    .bind(targetUserId, session.active_workspace_id || "").first();
  if (!target) return json({ error: "The selected user has no active workspace access" }, 404);
  if (target.must_change_password) return json({ error: "The selected user must finish account setup before emulation" }, 409);
  const now = new Date().toISOString();
  await db.batch([
    db.prepare(`INSERT INTO dbi_session_emulations (session_id, actor_user_id, target_user_id, started_at) VALUES (?, ?, ?, ?)
      ON CONFLICT(session_id) DO UPDATE SET target_user_id=excluded.target_user_id, started_at=excluded.started_at`).bind(session.session_id, session.user_id, targetUserId, now),
    db.prepare(`INSERT INTO dbi_session_workspaces (session_id, workspace_id, updated_at) VALUES (?, ?, ?)
      ON CONFLICT(session_id) DO UPDATE SET workspace_id=excluded.workspace_id, updated_at=excluded.updated_at`).bind(session.session_id, target.workspace_id, now),
  ]);
  await recordActivity(db, { type: "user", id: session.user_id, workspaceId: target.workspace_id }, "user_emulation_started", "user", targetUserId);
  return json({ user: await publicSessionUser(db, await sessionUser(db, request)) });
}
