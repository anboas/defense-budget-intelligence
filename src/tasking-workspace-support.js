import { flattenTaskingFolders } from "./tasking-foundation-data.js";

export const TASKING_VIEWS = Object.freeze(["workstreams", "tasks", "sources", "communications"]);
export const WORKSTREAM_SECTIONS = Object.freeze(["overview", "tasks", "sources", "communications", "interactions"]);

const LEGACY_VIEWS = Object.freeze({ portfolio: "workstreams", files: "sources", connections: "workstreams" });
const COMMUNICATION_KINDS = new Set(["communication", "email", "im", "message", "chat", "meeting"]);

export function taskingRouteState(routeHash = "") {
  const params = new URLSearchParams(String(routeHash).split("?")[1] || "");
  const requested = params.get("taskingView") || "workstreams";
  const view = LEGACY_VIEWS[requested] || (TASKING_VIEWS.includes(requested) ? requested : "workstreams");
  const legacySection = requested === "connections" ? "interactions" : "";
  const requestedSection = params.get("taskingSection") || legacySection || "overview";
  return {
    view,
    section: WORKSTREAM_SECTIONS.includes(requestedSection) ? requestedSection : "overview",
    recordId: params.get("taskingRecord") || "",
    workstreamId: params.get("taskingWorkstream") || "",
    query: params.get("taskingQuery") || "",
    status: params.get("taskingStatus") || "all",
    sourceType: params.get("taskingFileType") || "all",
    sourceRelation: params.get("taskingFileRelation") || "all",
    sourceSort: params.get("taskingFileSort") || "name-asc",
  };
}

export function replaceTaskingRoute(patch = {}) {
  const [path, search = ""] = String(window.location.hash || "#/tasking").split("?");
  const params = new URLSearchParams(search);
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined || value === null || value === "" || value === "all") params.delete(key);
    else params.set(key, String(value));
  }
  const nextHash = `${path}${params.size ? `?${params}` : ""}`;
  if (nextHash === window.location.hash) return;
  window.history.replaceState(window.history.state, "", nextHash);
  window.dispatchEvent(new HashChangeEvent("hashchange"));
}

export function workstreamShortName(workstream = {}) {
  if (workstream.shortName) return String(workstream.shortName).slice(0, 12).toUpperCase();
  const words = String(workstream.name || "Workstream").match(/[A-Za-z0-9]+/g) || [];
  const meaningful = words.filter((word) => !["and", "the", "of", "for"].includes(word.toLowerCase()));
  const initials = meaningful.slice(0, 5).map((word) => word[0]).join("");
  return (initials || "WS").toUpperCase();
}

export function workstreamState(workstream = {}, anchors = []) {
  if (workstream.status) return workstream.status;
  const values = [...new Set(anchors.map((anchor) => anchor.status).filter(Boolean))];
  if (!values.length) return "unclassified";
  return values.length === 1 ? values[0] : "mixed";
}

export function workstreamCategory(workstream = {}, anchors = []) {
  if (workstream.category) return workstream.category;
  const kinds = [...new Set(anchors.map((anchor) => anchor.kind).filter(Boolean))];
  if (kinds.length === 1) return `${kinds[0]} workstream`;
  return kinds.length ? "Mixed workstream" : "Workstream";
}

export function isCommunication(record = {}) {
  return Boolean(record.channel) || COMMUNICATION_KINDS.has(String(record.kind || "").toLowerCase());
}

export function communicationsForWorkstream(records = [], workstreamId = "", anchorIds = new Set()) {
  return records.filter((record) => isCommunication(record) && (
    !workstreamId || record.workstreamId === workstreamId || anchorIds.has(record.anchorId)
  ));
}

export function buildTaskingSourceTree(sourceItems = []) {
  const active = sourceItems.filter((item) => !item.deletedAt);
  const nodes = new Map(active.map((item) => [item.sourceId, { ...item, id: item.id, kind: item.itemType, children: [] }]));
  const roots = [];
  for (const item of active) {
    const node = nodes.get(item.sourceId);
    const parent = nodes.get(item.parentSourceId);
    if (parent && parent !== node) parent.children.push(node); else roots.push(node);
  }
  const sort = (items) => items
    .sort((left, right) => left.kind === right.kind ? left.name.localeCompare(right.name) : left.kind === "folder" ? -1 : 1)
    .map((item) => ({ ...item, children: sort(item.children) }));
  return sort(roots);
}

export function sourceAncestors(roots = [], selectedId = "") {
  const ancestors = new Set();
  const visit = (nodes, path = []) => {
    for (const node of nodes) {
      if (node.id === selectedId) { path.forEach((id) => ancestors.add(id)); return true; }
      if (visit(node.children || [], [...path, node.id])) return true;
    }
    return false;
  };
  visit(roots);
  return ancestors;
}

export function pruneSourceTree(roots = [], allowedIds = null) {
  if (!allowedIds) return roots;
  return roots.flatMap((node) => {
    const children = pruneSourceTree(node.children || [], allowedIds);
    return allowedIds.has(node.id) || children.length ? [{ ...node, children }] : [];
  });
}

export function sourceIdsForWorkstream(sourceItems = [], anchors = [], workstreamId = "") {
  if (!workstreamId) return null;
  const anchorIds = new Set(anchors.filter((anchor) => anchor.workstreamId === workstreamId).map((anchor) => anchor.id));
  const bySource = new Map(sourceItems.map((item) => [item.sourceId, item]));
  const allowed = new Set();
  for (const item of sourceItems) {
    if (!anchorIds.has(item.recordId)) continue;
    allowed.add(item.id);
    let parent = bySource.get(item.parentSourceId);
    while (parent && !allowed.has(parent.id)) { allowed.add(parent.id); parent = bySource.get(parent.parentSourceId); }
  }
  return allowed;
}

export function flattenSourceTree(roots = []) {
  return flattenTaskingFolders(roots);
}
