import { cleanText, sameOriginRequest, validAvatarDataUrl } from "./security-policy.js";
import { d1EntitlementDecision } from "./d1-saas-control-plane.js";

function cleanStringArray(value, limit = 50, itemLength = 80) {
  return [...new Set((Array.isArray(value) ? value : []).map((item) => cleanText(item, itemLength)).filter(Boolean))].slice(0, limit);
}

export async function workspaceTeams(db, workspaceId) {
  const [teamResult, memberResult] = await Promise.all([
    db.prepare(`SELECT team.*, COUNT(event_team.event_id) AS event_count FROM dbi_workspace_teams team
      LEFT JOIN dbi_workspace_event_teams event_team ON event_team.workspace_id = team.workspace_id AND event_team.team_id = team.team_id
      WHERE team.workspace_id = ? GROUP BY team.team_id ORDER BY team.name COLLATE NOCASE`).bind(workspaceId).all(),
    db.prepare(`SELECT member.team_id, user.user_id, user.display_name, user.email, user.title, profile.avatar_data_url
      FROM dbi_workspace_team_members member JOIN dbi_users user ON user.user_id = member.user_id AND user.status = 'active'
      LEFT JOIN dbi_user_profiles profile ON profile.user_id = user.user_id
      WHERE member.workspace_id = ? ORDER BY user.display_name COLLATE NOCASE`).bind(workspaceId).all(),
  ]);
  const members = new Map();
  for (const row of memberResult.results || []) { const list = members.get(row.team_id) || []; list.push({ id: row.user_id, displayName: row.display_name, email: row.email, title: row.title || "", avatarDataUrl: row.avatar_data_url || "" }); members.set(row.team_id, list); }
  return (teamResult.results || []).map((row) => ({ id: row.team_id, name: row.name, description: row.description || "", iconDataUrl: row.icon_data_url || "",
    members: members.get(row.team_id) || [], eventCount: Number(row.event_count || 0), createdAt: row.created_at, updatedAt: row.updated_at }));
}

export async function teamsResponse(request, db, deps) {
  const { sessionUser, canAdministerWorkspaces, recordActivity, json, safeJson } = deps;
  if (!sameOriginRequest(request)) return json({ error: "Cross-origin team access is not allowed" }, 403);
  const user = await sessionUser(db, request);
  if (!user) return json({ error: "Sign in required" }, 401);
  const workspaceId = user.active_workspace_id;
  if (!workspaceId) return json({ error: "Select a workspace before using teams" }, 409);
  const relative = new URL(request.url).pathname.replace(/\/+$/, "").slice("/api/v1/auth/teams".length).replace(/^\//, "");
  const [encodedTeamId = "", action = ""] = relative.split("/");
  const teamId = cleanText(decodeURIComponent(encodedTeamId), 80);
  if (request.method === "GET" && !teamId) {
    const teams = await workspaceTeams(db, workspaceId);
    const memberTeamIds = teams.filter((team) => team.members.some((member) => member.id === user.user_id)).map((team) => team.id);
    return json({ teams: canAdministerWorkspaces(user) ? teams : teams.filter((team) => memberTeamIds.includes(team.id)), memberTeamIds });
  }
  if (!canAdministerWorkspaces(user)) return json({ error: "Workspace manager access is required" }, 403);
  if (request.method === "POST" && !teamId) {
    const body = await safeJson(request);
    const name = cleanText(body?.name, 80); const description = cleanText(body?.description, 240); const iconDataUrl = validAvatarDataUrl(body?.iconDataUrl);
    if (name.length < 2 || iconDataUrl === null) return json({ error: "A valid team name and icon are required" }, 400);
    const count = await db.prepare("SELECT COUNT(*) AS count FROM dbi_workspace_teams WHERE workspace_id = ?").bind(workspaceId).first();
    const decision = await d1EntitlementDecision(db, workspaceId, "teams", Number(count?.count || 0));
    if (!decision.allowed) return json({ error: `This workspace has reached its ${decision.limit}-team entitlement` }, 409);
    const id = crypto.randomUUID(); const now = new Date().toISOString();
    const created = await db.prepare(`INSERT OR IGNORE INTO dbi_workspace_teams
      (team_id, workspace_id, name, description, icon_data_url, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(id, workspaceId, name, description, iconDataUrl, user.actor_user_id || user.user_id, now, now).run();
    if (!Number(created?.meta?.changes || 0)) return json({ error: "A team with that name already exists" }, 409);
    await recordActivity(db, { type: "user", id: user.user_id, actorId: user.actor_user_id || user.user_id, isEmulating: Boolean(user.is_emulating), workspaceId }, "team_created", "team", id, { name });
    return json({ team: (await workspaceTeams(db, workspaceId)).find((team) => team.id === id) }, 201);
  }
  const existing = teamId ? await db.prepare("SELECT * FROM dbi_workspace_teams WHERE workspace_id = ? AND team_id = ?").bind(workspaceId, teamId).first() : null;
  if (!existing) return json({ error: "Team not found" }, 404);
  if (request.method === "PATCH" && !action) {
    const body = await safeJson(request); const name = cleanText(body?.name ?? existing.name, 80); const description = cleanText(body?.description ?? existing.description, 240); const iconDataUrl = validAvatarDataUrl(body?.iconDataUrl ?? existing.icon_data_url);
    if (name.length < 2 || iconDataUrl === null) return json({ error: "A valid team name and icon are required" }, 400);
    const changed = await db.prepare(`UPDATE OR IGNORE dbi_workspace_teams SET name=?, description=?, icon_data_url=?, updated_at=? WHERE workspace_id=? AND team_id=?`)
      .bind(name, description, iconDataUrl, new Date().toISOString(), workspaceId, teamId).run();
    if (!Number(changed?.meta?.changes || 0)) { const duplicate = await db.prepare("SELECT team_id FROM dbi_workspace_teams WHERE workspace_id=? AND LOWER(name)=LOWER(?) AND team_id<>?").bind(workspaceId, name, teamId).first(); if (duplicate) return json({ error: "A team with that name already exists" }, 409); }
    await recordActivity(db, { type: "user", id: user.user_id, actorId: user.actor_user_id || user.user_id, isEmulating: Boolean(user.is_emulating), workspaceId }, "team_updated", "team", teamId, { name });
    return json({ team: (await workspaceTeams(db, workspaceId)).find((team) => team.id === teamId) });
  }
  if (request.method === "PUT" && action === "members") {
    const userIds = cleanStringArray((await safeJson(request))?.userIds);
    if (userIds.length) { const placeholders = userIds.map(() => "?").join(", "); const rows = await db.prepare(`SELECT user_id FROM dbi_workspace_memberships WHERE workspace_id=? AND user_id IN (${placeholders})`).bind(workspaceId, ...userIds).all(); if ((rows.results || []).length !== userIds.length) return json({ error: "Every team member must belong to this workspace" }, 404); }
    const now = new Date().toISOString(); const statements = [db.prepare("DELETE FROM dbi_workspace_team_members WHERE workspace_id=? AND team_id=?").bind(workspaceId, teamId)];
    for (const memberId of userIds) statements.push(db.prepare("INSERT INTO dbi_workspace_team_members (workspace_id,team_id,user_id,created_at) VALUES (?,?,?,?)").bind(workspaceId, teamId, memberId, now));
    await db.batch(statements); await recordActivity(db, { type: "user", id: user.user_id, actorId: user.actor_user_id || user.user_id, isEmulating: Boolean(user.is_emulating), workspaceId }, "team_members_updated", "team", teamId, { userIds });
    return json({ team: (await workspaceTeams(db, workspaceId)).find((team) => team.id === teamId) });
  }
  if (request.method === "DELETE" && !action) {
    const assigned = await db.prepare("SELECT COUNT(*) AS count FROM dbi_workspace_event_teams WHERE workspace_id=? AND team_id=?").bind(workspaceId, teamId).first();
    if (Number(assigned?.count || 0)) return json({ error: "Remove or reassign this team's events before deleting it" }, 409);
    await db.batch([db.prepare("DELETE FROM dbi_workspace_team_members WHERE workspace_id=? AND team_id=?").bind(workspaceId, teamId), db.prepare("DELETE FROM dbi_workspace_teams WHERE workspace_id=? AND team_id=?").bind(workspaceId, teamId)]);
    await recordActivity(db, { type: "user", id: user.user_id, actorId: user.actor_user_id || user.user_id, isEmulating: Boolean(user.is_emulating), workspaceId }, "team_deleted", "team", teamId, { name: existing.name });
    return new Response(null, { status: 204 });
  }
  return json({ error: "Method not allowed" }, 405);
}
