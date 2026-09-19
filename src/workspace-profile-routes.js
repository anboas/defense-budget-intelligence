const DIRECTORY_ROUTE = "#/workspace/directory";

export function workspaceMemberHref(memberId) {
  return `${DIRECTORY_ROUTE}?member=${encodeURIComponent(memberId)}`;
}

export function workspaceTeamHref(teamId) {
  return `${DIRECTORY_ROUTE}?team=${encodeURIComponent(teamId)}`;
}

export function openWorkspaceProfile(kind, id) {
  window.location.hash = kind === "team" ? workspaceTeamHref(id) : workspaceMemberHref(id);
}

export function directorySelection(hash = window.location.hash) {
  const params = new URLSearchParams(String(hash).split("?")[1] || "");
  return { memberId: params.get("member") || "", teamId: params.get("team") || "" };
}

