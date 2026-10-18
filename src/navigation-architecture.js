const ROUTES = {
  overview: "#/budget-spend", trends: "#/budget-spend/trends", lifecycle: "#/budget-spend/lifecycle", awards: "#/budget-spend/awards",
  spend: "#/budget-spend/explorer", timeline: "#/budget-spend/timeline", library: "#/budget-spend/library", graph: "#/budget-spend/intelligence-graph",
  workspace: "#/intelligence/workspace", map: "#/budget-spend/map", sources: "#/budget-spend/sources", watchlist: "#/budget-spend/watchlist",
  tasks: "#/budget-spend/tasks", schedule: "#/budget-spend/schedule", discovery: "#/budget-spend/event-discovery", connections: "#/budget-spend/connections",
  model: "#/budget-spend/domain-model", intelligence: "#/budget-spend/intelligence", settings: "#/budget-spend/workspace", users: "#/budget-spend/users", workspaces: "#/budget-spend/workspaces",
};

export const PRODUCT_WORKSPACES = [
  { id: "today", label: "Today", href: ROUTES.watchlist, tabIds: ["watchlist", "tasks", "schedule"], views: [
    { id: "brief", label: "Brief", tabId: "watchlist", href: ROUTES.watchlist },
    { id: "tasks", label: "Tasks", tabId: "tasks", href: ROUTES.tasks },
    { id: "schedule", label: "Schedule", tabId: "schedule", href: ROUTES.schedule },
  ] },
  { id: "opportunities", label: "Opportunities", href: `${ROUTES.spend}?spendView=table`, tabIds: ["spend"], views: [
    { id: "workbench", label: "Workbench", tabId: "spend", href: `${ROUTES.spend}?spendView=table`, spendViews: ["table", "record"] },
    { id: "radar", label: "Radar", tabId: "spend", href: `${ROUTES.spend}?spendView=radar`, spendViews: ["radar"] },
    { id: "portfolio", label: "Portfolio", tabId: "spend", href: `${ROUTES.spend}?spendView=visuals`, spendViews: ["visuals", "timeline", "charts"] },
  ] },
  { id: "timeline", label: "Timeline", href: ROUTES.timeline, tabIds: ["timeline"], views: [
    { id: "timeline", label: "Timeline", tabId: "timeline", href: ROUTES.timeline },
  ] },
  { id: "funding", label: "Funding", href: ROUTES.overview, tabIds: ["overview", "trends", "lifecycle", "awards"], views: [
    { id: "request", label: "Request", tabId: "overview", href: ROUTES.overview },
    { id: "changes", label: "Changes", tabId: "trends", href: ROUTES.trends },
    { id: "accounts", label: "Accounts", tabId: "lifecycle", href: ROUTES.lifecycle },
    { id: "awards", label: "Awards", tabId: "awards", href: ROUTES.awards },
  ] },
  { id: "intelligence", label: "Intelligence", href: ROUTES.library, tabIds: ["library", "intelligence-graph", "map", "sources", "entity-workspace"], views: [
    { id: "library", label: "Library", tabId: "library", href: ROUTES.library },
    { id: "graph", label: "Graph", tabId: "intelligence-graph", href: ROUTES.graph },
    { id: "geography", label: "Geography", tabId: "map", href: ROUTES.map },
    { id: "sources", label: "Sources", tabId: "sources", href: ROUTES.sources },
  ] },
];

export const MANAGEMENT_NAVIGATION = [
  { id: "operations", label: "Operations", items: [
    { id: "event-discovery", label: "Event Discovery", description: "Curate official sources", tabId: "event-discovery", href: ROUTES.discovery, capability: "super" },
    { id: "connections", label: "Integrations & API", description: "Health and activity", tabId: "connections", href: ROUTES.connections },
  ] },
  { id: "workspace", label: "Workspace", items: [
    { id: "domain-model", label: "Data Model", description: "Entities and relations", tabId: "domain-model", href: ROUTES.model },
    { id: "intelligence", label: "Intelligence Operations", description: "Review and publish", tabId: "intelligence", href: ROUTES.intelligence },
    { id: "workspace-settings", label: "Workspace Settings", description: "Teams and policy", tabId: "workspace-settings", href: ROUTES.settings, capability: "manageWorkspace" },
  ] },
  { id: "access", label: "Access", items: [
    { id: "users", label: "Accounts", description: "Users and recovery", tabId: "users", href: ROUTES.users, capability: "manageAccounts" },
    { id: "workspaces", label: "Workspaces", description: "Membership and access", tabId: "workspaces", href: ROUTES.workspaces, capability: "super" },
  ] },
];

export function navigationContext(activeTab, routeHash = "") {
  const spendView = activeTab === "spend" ? new URLSearchParams(String(routeHash).split("?")[1] || "").get("spendView") || "table" : "";
  const workspace = activeTab === "spend" && spendView === "today"
    ? PRODUCT_WORKSPACES.find((entry) => entry.id === "today")
    : PRODUCT_WORKSPACES.find((entry) => entry.tabIds.includes(activeTab)) || null;
  if (!workspace) return { workspace: null, view: null };
  const view = activeTab === "spend" && spendView === "today"
    ? workspace.views.find((entry) => entry.id === "brief")
    : activeTab === "entity-workspace"
    ? { id: "entity", label: "Entity workspace", tabId: activeTab, href: routeHash || ROUTES.workspace }
    : workspace.views.find((entry) => entry.tabId === activeTab && (!entry.spendViews || entry.spendViews.includes(spendView))) || null;
  return { workspace, view };
}
