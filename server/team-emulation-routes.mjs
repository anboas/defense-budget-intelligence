import { randomUUID } from "node:crypto";
import { cleanText, validAvatarDataUrl } from "../src/security-policy.js";
import { recordUserActivity } from "./user-activity-routes.mjs";

async function teamPayload(pool, workspaceId) {
  const [teams, members] = await Promise.all([
    pool.query(`SELECT team.*, COUNT(event_team.event_id)::int AS event_count FROM app_workspace_teams team
      LEFT JOIN app_workspace_event_teams event_team ON event_team.workspace_id=team.workspace_id AND event_team.team_id=team.team_id
      WHERE team.workspace_id=$1 GROUP BY team.team_id ORDER BY team.name`, [workspaceId]),
    pool.query(`SELECT member.team_id,u.user_id,u.display_name,u.email,u.title,u.avatar_data_url FROM app_workspace_team_members member
      JOIN app_users u ON u.user_id=member.user_id AND u.status='active' WHERE member.workspace_id=$1 ORDER BY u.display_name`, [workspaceId]),
  ]);
  return teams.rows.map((team) => ({ id: team.team_id, name: team.name, description: team.description || "", iconDataUrl: team.icon_data_url || "",
    members: members.rows.filter((member) => String(member.team_id) === String(team.team_id)).map((member) => ({ id: member.user_id, displayName: member.display_name, email: member.email, title: member.title || "", avatarDataUrl: member.avatar_data_url || "" })),
    eventCount: Number(team.event_count || 0), createdAt: team.created_at, updatedAt: team.updated_at }));
}

export function registerTeamEmulationRoutes(app, pool, deps) {
  const { assertSameOrigin, authenticated, hydratedUser, canAdministerWorkspaces } = deps;
  app.post("/api/v1/auth/emulation", async (request, reply) => {
    if (!assertSameOrigin(request, reply)) return;
    const session = await authenticated(pool, request);
    if (!session) return reply.code(401).send({ error: "sign in required" });
    if (session.is_emulating || session.actor_role !== "super_user" || session.role !== "super_user") return reply.code(403).send({ error: "only the signed-in Super user may start emulation" });
    const targetUserId = cleanText(request.body?.userId, 80);
    if (!targetUserId || targetUserId === String(session.user_id)) return reply.code(400).send({ error: "choose a managed user to emulate" });
    const target = await pool.query(`SELECT u.user_id,membership.workspace_id FROM app_users u
      JOIN app_workspace_memberships membership ON membership.user_id=u.user_id JOIN app_workspaces workspace ON workspace.workspace_id=membership.workspace_id AND workspace.status='active'
      WHERE u.user_id=$1 AND u.status='active' ORDER BY CASE WHEN membership.workspace_id=$2 THEN 0 ELSE 1 END,workspace.name LIMIT 1`, [targetUserId, session.active_workspace_id]);
    if (!target.rowCount) return reply.code(404).send({ error: "the selected user has no active workspace access" });
    await pool.query(`INSERT INTO app_session_emulations (session_id,actor_user_id,target_user_id) VALUES ($1,$2,$3)
      ON CONFLICT (session_id) DO UPDATE SET target_user_id=EXCLUDED.target_user_id,started_at=NOW()`, [session.id, session.actor_user_id, targetUserId]);
    await pool.query("UPDATE app_auth_sessions SET workspace_id=$1 WHERE id=$2", [target.rows[0].workspace_id, session.id]);
    await recordUserActivity(pool, { ...session, active_workspace_id: target.rows[0].workspace_id }, { eventType: "action", action: "user_emulation_started", surface: "users", targetType: "account", targetId: targetUserId });
    return { user: await hydratedUser(pool, await authenticated(pool, request)) };
  });
  app.delete("/api/v1/auth/emulation", async (request, reply) => {
    if (!assertSameOrigin(request, reply)) return;
    const session = await authenticated(pool, request);
    if (!session) return reply.code(401).send({ error: "sign in required" });
    if (session.actor_role !== "super_user") return reply.code(403).send({ error: "Super user access is required" });
    await pool.query("DELETE FROM app_session_emulations WHERE session_id=$1", [session.id]);
    await recordUserActivity(pool, session, { eventType: "action", action: "user_emulation_stopped", surface: "users", targetType: "account", targetId: session.user_id });
    return { user: await hydratedUser(pool, await authenticated(pool, request)) };
  });
  app.get("/api/v1/auth/teams", async (request, reply) => {
    const user = await authenticated(pool, request);
    if (!user) return reply.code(401).send({ error: "sign in required" });
    if (!user.active_workspace_id) return reply.code(409).send({ error: "select a workspace before using teams" });
    const teams = await teamPayload(pool, user.active_workspace_id);
    const memberTeamIds = teams.filter((team) => team.members.some((member) => String(member.id) === String(user.user_id))).map((team) => team.id);
    return { teams: canAdministerWorkspaces(user) ? teams : teams.filter((team) => memberTeamIds.includes(team.id)), memberTeamIds };
  });
  app.post("/api/v1/auth/teams", async (request, reply) => {
    if (!assertSameOrigin(request, reply)) return;
    const user = await authenticated(pool, request);
    if (!user) return reply.code(401).send({ error: "sign in required" });
    if (!canAdministerWorkspaces(user)) return reply.code(403).send({ error: "Workspace manager access is required" });
    const name = cleanText(request.body?.name, 80); const description = cleanText(request.body?.description, 240); const iconDataUrl = validAvatarDataUrl(request.body?.iconDataUrl);
    if (name.length < 2 || iconDataUrl === null) return reply.code(400).send({ error: "a valid team name and icon are required" });
    const id = randomUUID();
    try { await pool.query("INSERT INTO app_workspace_teams (team_id,workspace_id,name,description,icon_data_url,created_by) VALUES ($1,$2,$3,$4,$5,$6)", [id, user.active_workspace_id, name, description, iconDataUrl, user.actor_user_id || user.user_id]); }
    catch (error) { if (error.code === "23505") return reply.code(409).send({ error: "a team with that name already exists" }); throw error; }
    return reply.code(201).send({ team: (await teamPayload(pool, user.active_workspace_id)).find((team) => String(team.id) === id) });
  });
  app.patch("/api/v1/auth/teams/:teamId", async (request, reply) => {
    if (!assertSameOrigin(request, reply)) return;
    const user = await authenticated(pool, request); if (!user) return reply.code(401).send({ error: "sign in required" });
    if (!canAdministerWorkspaces(user)) return reply.code(403).send({ error: "Workspace manager access is required" });
    const current = await pool.query("SELECT * FROM app_workspace_teams WHERE workspace_id=$1 AND team_id=$2", [user.active_workspace_id, request.params.teamId]);
    if (!current.rowCount) return reply.code(404).send({ error: "team not found" });
    const name = cleanText(request.body?.name ?? current.rows[0].name, 80); const description = cleanText(request.body?.description ?? current.rows[0].description, 240); const iconDataUrl = validAvatarDataUrl(request.body?.iconDataUrl ?? current.rows[0].icon_data_url);
    if (name.length < 2 || iconDataUrl === null) return reply.code(400).send({ error: "a valid team name and icon are required" });
    try { await pool.query("UPDATE app_workspace_teams SET name=$1,description=$2,icon_data_url=$3,updated_at=NOW() WHERE workspace_id=$4 AND team_id=$5", [name, description, iconDataUrl, user.active_workspace_id, request.params.teamId]); }
    catch (error) { if (error.code === "23505") return reply.code(409).send({ error: "a team with that name already exists" }); throw error; }
    return { team: (await teamPayload(pool, user.active_workspace_id)).find((team) => String(team.id) === request.params.teamId) };
  });
  app.put("/api/v1/auth/teams/:teamId/members", async (request, reply) => {
    if (!assertSameOrigin(request, reply)) return;
    const user = await authenticated(pool, request); if (!user) return reply.code(401).send({ error: "sign in required" });
    if (!canAdministerWorkspaces(user)) return reply.code(403).send({ error: "Workspace manager access is required" });
    const team = await pool.query("SELECT team_id FROM app_workspace_teams WHERE workspace_id=$1 AND team_id=$2", [user.active_workspace_id, request.params.teamId]);
    if (!team.rowCount) return reply.code(404).send({ error: "team not found" });
    const ids = [...new Set((Array.isArray(request.body?.userIds) ? request.body.userIds : []).map((id) => cleanText(id, 80)).filter(Boolean))].slice(0, 50);
    const valid = ids.length ? await pool.query("SELECT user_id FROM app_workspace_memberships WHERE workspace_id=$1 AND user_id=ANY($2::uuid[])", [user.active_workspace_id, ids]) : { rowCount: 0 };
    if (valid.rowCount !== ids.length) return reply.code(404).send({ error: "every team member must belong to this workspace" });
    const client = await pool.connect();
    try { await client.query("BEGIN"); await client.query("DELETE FROM app_workspace_team_members WHERE workspace_id=$1 AND team_id=$2", [user.active_workspace_id, request.params.teamId]); for (const id of ids) await client.query("INSERT INTO app_workspace_team_members (workspace_id,team_id,user_id) VALUES ($1,$2,$3)", [user.active_workspace_id, request.params.teamId, id]); await client.query("COMMIT"); }
    catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
    return { team: (await teamPayload(pool, user.active_workspace_id)).find((team) => String(team.id) === request.params.teamId) };
  });
  app.delete("/api/v1/auth/teams/:teamId", async (request, reply) => {
    if (!assertSameOrigin(request, reply)) return;
    const user = await authenticated(pool, request); if (!user) return reply.code(401).send({ error: "sign in required" });
    if (!canAdministerWorkspaces(user)) return reply.code(403).send({ error: "Workspace manager access is required" });
    const assigned = await pool.query("SELECT COUNT(*)::int AS count FROM app_workspace_event_teams WHERE workspace_id=$1 AND team_id=$2", [user.active_workspace_id, request.params.teamId]);
    if (assigned.rows[0].count) return reply.code(409).send({ error: "remove or reassign this team's events before deleting it" });
    const result = await pool.query("DELETE FROM app_workspace_teams WHERE workspace_id=$1 AND team_id=$2", [user.active_workspace_id, request.params.teamId]);
    return result.rowCount ? reply.code(204).send() : reply.code(404).send({ error: "team not found" });
  });
}
