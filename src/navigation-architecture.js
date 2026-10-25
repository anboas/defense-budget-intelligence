const ROUTES = {
  overview: "#/budget-spend", trends: "#/budget-spend/trends", lifecycle: "#/budget-spend/lifecycle", awards: "#/budget-spend/awards",
  spend: "#/budget-spend/explorer", timeline: "#/budget-spend/timeline", library: "#/budget-spend/library", graph: "#/budget-spend/intelligence-graph",
  workspace: "#/intelligence/workspace", map: "#/budget-spend/map", sources: "#/budget-spend/sources", watchlist: "#/budget-spend/watchlist",
  actions: "#/budget-spend/actions", tasks: "#/budget-spend/tasks", schedule: "#/budget-spend/schedule", discovery: "#/budget-spend/event-discovery", connections: "#/budget-spend/connections",
  model: "#/budget-spend/domain-model", intelligence: "#/budget-spend/intelligence", settings: "#/budget-spend/workspace", users: "#/budget-spend/users", workspaces: "#/budget-spend/workspaces",
  tasking: "#/tasking",
};

export const PRODUCT_WORKSPACES = [
  { id: "today", label: "Today", href: ROUTES.watchlist, tabIds: ["watchlist", "actions", "schedule"], views: [
    { id: "focus", label: "Focus", tabId: "watchlist", href: ROUTES.watchlist },
    { id: "actions", label: "Actions", tabId: "actions", href: ROUTES.actions },
    { id: "schedule", label: "Schedule", tabId: "schedule", href: ROUTES.schedule },
  ] },
  { id: "tasking", label: "Tasking", href: ROUTES.tasking, tabIds: ["tasking"], views: [
    { id: "portfolio", label: "Portfolio", tabId: "tasking", href: `${ROUTES.tasking}?taskingView=portfolio` },
    { id: "files", label: "Files", tabId: "tasking", href: `${ROUTES.tasking}?taskingView=files` },
    { id: "connections", label: "Connections", tabId: "tasking", href: `${ROUTES.tasking}?taskingView=connections` },
  ] },
  { id: "opportunities", label: "Opportunities", href: ROUTES.timeline, tabIds: ["timeline", "spend"], views: [
    { id: "timeline", label: "Timeline", tabId: "timeline", href: ROUTES.timeline },
    { id: "workbench", label: "Workbench", tabId: "spend", href: `${ROUTES.spend}?spendView=table`, spendViews: ["table", "record"] },
    { id: "analysis", label: "Analysis", tabId: "spend", href: `${ROUTES.spend}?spendView=analysis&analysisMode=portfolio`, spendViews: ["analysis", "radar", "visuals", "charts"] },
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
    { id: "automation-runs", label: "Automation Runs", description: "API and AI run history", tabId: "tasks", href: ROUTES.tasks },
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
  const rawSpendView = activeTab === "spend" ? new URLSearchParams(String(routeHash).split("?")[1] || "").get("spendView") || "table" : "";
  const spendView = ["radar", "visuals", "charts"].includes(rawSpendView) ? "analysis" : rawSpendView;
  const taskingView = activeTab === "tasking" ? new URLSearchParams(String(routeHash).split("?")[1] || "").get("taskingView") || "portfolio" : "";
  const workspace = PRODUCT_WORKSPACES.find((entry) => entry.tabIds.includes(activeTab)) || null;
  if (!workspace) return { workspace: null, view: null };
  const view = activeTab === "entity-workspace"
    ? { id: "entity", label: "Entity workspace", tabId: activeTab, href: routeHash || ROUTES.workspace }
    : activeTab === "spend" && spendView === "timeline"
      ? workspace.views.find((entry) => entry.id === "timeline") || null
    : activeTab === "tasking"
      ? workspace.views.find((entry) => entry.id === taskingView) || workspace.views[0] || null
    : workspace.views.find((entry) => entry.tabId === activeTab && (!entry.spendViews || entry.spendViews.includes(spendView))) || null;
  return { workspace, view };
}
