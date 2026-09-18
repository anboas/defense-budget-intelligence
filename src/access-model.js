export const PLATFORM_ROLE_SUPER_USER = "super_user";

export const WORKSPACE_ROLE_IDS = Object.freeze(["administrator", "analyst", "viewer"]);

export const ACCESS_ROLES = Object.freeze({
  super_user: Object.freeze({
    id: "super_user",
    label: "Super user",
    scope: "Platform",
    summary: "Owns accounts and workspaces; can emulate active users.",
    capabilities: Object.freeze(["Accounts", "All workspaces", "Emulation", "All workspace data"]),
  }),
  administrator: Object.freeze({
    id: "administrator",
    label: "Workspace manager",
    scope: "Workspace",
    summary: "Manages this workspace, its members, teams, credentials, and data.",
    capabilities: Object.freeze(["Workspace settings", "Members and roles", "Teams", "Read and write"]),
  }),
  analyst: Object.freeze({
    id: "analyst",
    label: "Analyst",
    scope: "Workspace",
    summary: "Creates and updates workspace data without administering access.",
    capabilities: Object.freeze(["Read and write", "Events", "Tracking", "AI augmentation"]),
  }),
  viewer: Object.freeze({
    id: "viewer",
    label: "Viewer",
    scope: "Workspace",
    summary: "Reads workspace data and only sees events allowed by team membership.",
    capabilities: Object.freeze(["Read only", "Assigned team overlays", "Workspace-wide events"]),
  }),
});

export const WORKSPACE_ROLE_LABELS = Object.freeze(Object.fromEntries(
  WORKSPACE_ROLE_IDS.map((roleId) => [roleId, ACCESS_ROLES[roleId].label]),
));

export const ROLE_LABELS = Object.freeze(Object.fromEntries(
  Object.entries(ACCESS_ROLES).map(([roleId, role]) => [roleId, role.label]),
));

export function effectiveWorkspaceRole(accountRole, membershipRole) {
  if (accountRole === PLATFORM_ROLE_SUPER_USER) return PLATFORM_ROLE_SUPER_USER;
  return WORKSPACE_ROLE_IDS.includes(membershipRole) ? membershipRole : "viewer";
}

export function accessCapabilities(accountRole, membershipRole, { isEmulating = false } = {}) {
  const roleId = effectiveWorkspaceRole(accountRole, membershipRole);
  const isSuperUser = roleId === PLATFORM_ROLE_SUPER_USER && !isEmulating;
  const isWorkspaceManager = roleId === PLATFORM_ROLE_SUPER_USER || roleId === "administrator";
  const canWriteWorkspace = isWorkspaceManager || roleId === "analyst";
  return Object.freeze({
    roleId,
    canManagePlatform: isSuperUser,
    canManageAccounts: isSuperUser,
    canEmulateUsers: isSuperUser,
    canManageWorkspace: isWorkspaceManager,
    canManageTeams: isWorkspaceManager,
    canManageAgents: isWorkspaceManager,
    canWriteWorkspace,
    canRunEventAi: canWriteWorkspace,
  });
}
