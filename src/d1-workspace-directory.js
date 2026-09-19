export async function directoryResponse(request, db, { sessionUser, json, roleLabels }) {
  if (request.method !== "GET") return json({ error: "Method not allowed" }, 405);
  const user = await sessionUser(db, request);
  if (!user) return json({ error: "Sign in required" }, 401);
  const result = await db.prepare(`
    SELECT user.user_id, user.display_name, user.title, profile.avatar_data_url, membership.role
    FROM dbi_workspace_memberships membership
    JOIN dbi_users user ON user.user_id = membership.user_id
    LEFT JOIN dbi_user_profiles profile ON profile.user_id = user.user_id
    WHERE membership.workspace_id = ? AND user.status = 'active'
    ORDER BY user.display_name COLLATE NOCASE
  `).bind(user.active_workspace_id).all();
  return json({ users: (result.results || []).map((entry) => ({
    id: entry.user_id,
    displayName: entry.display_name,
    title: entry.title || "",
    avatarDataUrl: entry.avatar_data_url || "",
    roleId: entry.role,
    role: roleLabels[entry.role] || "Viewer",
  })) });
}

