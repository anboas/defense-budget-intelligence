import { BarChart3, BrainCircuit, Building2, CalendarClock, Database, FileSpreadsheet, ListChecks, MapPinned, Network, SearchCheck, TrendingUp } from "lucide-react";

export const TABS = [
  { id: "overview", label: "PDB Request", icon: FileSpreadsheet, stage: "Request" },
  { id: "trends", label: "Request History", icon: TrendingUp, stage: "History" },
  { id: "lifecycle", label: "Account Flow", icon: Network, stage: "Accounts" },
  { id: "awards", label: "Awards", icon: FileSpreadsheet },
  { id: "spend", label: "Opportunities", icon: BarChart3 },
  { id: "timeline", label: "Timeline", icon: CalendarClock },
  { id: "library", label: "Data Library", icon: Database },
  { id: "intelligence-graph", label: "Intelligence Graph", icon: Network },
  { id: "entity-workspace", label: "Intelligence Workspace", icon: SearchCheck },
  { id: "map", label: "Opportunity Map", icon: MapPinned },
  { id: "schedule", label: "Schedule", icon: CalendarClock },
  { id: "event-discovery", label: "Event Discovery", icon: SearchCheck },
  { id: "watchlist", label: "Today", icon: ListChecks },
  { id: "tasks", label: "Task Center", icon: ListChecks },
  { id: "connections", label: "Integrations & API", icon: Database },
  { id: "domain-model", label: "Domain Model", icon: Network },
  { id: "intelligence", label: "Intelligence Operations", icon: BrainCircuit },
  { id: "users", label: "Accounts", icon: Building2 },
  { id: "workspaces", label: "Workspaces", icon: Building2 },
  { id: "workspace-settings", label: "Workspace Settings", icon: Building2 },
  { id: "sources", label: "Source Lineage", icon: Database },
  { id: "profile", label: "Profile", icon: Building2 },
  { id: "security", label: "Security", icon: Building2 },
  { id: "personal-ai", label: "OpenAI Keys", icon: BrainCircuit },
];

export const HASH_ROUTES = {
  overview: "#/budget-spend", lifecycle: "#/budget-spend/lifecycle", trends: "#/budget-spend/trends", awards: "#/budget-spend/awards", spend: "#/budget-spend/explorer", timeline: "#/budget-spend/timeline", library: "#/budget-spend/library", "intelligence-graph": "#/budget-spend/intelligence-graph", "entity-workspace": "#/intelligence/workspace", map: "#/budget-spend/map", schedule: "#/budget-spend/schedule", "event-discovery": "#/budget-spend/event-discovery", directory: "#/workspace/directory", watchlist: "#/budget-spend/watchlist", tasks: "#/budget-spend/tasks", connections: "#/budget-spend/connections", "domain-model": "#/budget-spend/domain-model", intelligence: "#/budget-spend/intelligence", users: "#/budget-spend/users", workspaces: "#/budget-spend/workspaces", "workspace-settings": "#/budget-spend/workspace", sources: "#/budget-spend/sources", profile: "#/profile", security: "#/profile/security", "personal-ai": "#/profile/openai",
};

export const LEGACY_ROUTE_TARGETS = {
  "#/budget-spend/transactions": "#/budget-spend/timeline?timelineScope=all",
  "#/budget-spend/capture-calendar": "#/budget-spend/timeline?timelineScope=all",
  "#/budget-spend/analytics": "#/budget-spend/explorer?spendView=charts",
  "#/budget-spend/events": "#/budget-spend/schedule?scheduleView=list",
  "#/budget-spend/wallboard": "#/budget-spend/schedule?scheduleView=display",
  "#/budget-spend/integrations": "#/budget-spend/connections?connectionsView=integrations",
  "#/budget-spend/agents": "#/budget-spend/connections?connectionsView=credentials",
  "#/budget-spend/api-log": "#/budget-spend/connections?connectionsView=activity",
  "#/profile/agents": "#/budget-spend/connections?connectionsView=credentials",
  "#/profile/activity": "#/budget-spend/connections?connectionsView=activity",
};

export const LEGACY_ROUTE_TABS = {
  "#/budget-spend/strategy": "overview", "#/budget-spend/briefs": "overview", "#/budget-spend/visuals": "spend", "#/budget-spend/hypotheses": "overview", "#/budget-spend/accounts": "lifecycle", "#/budget-spend/fit": "overview", "#/budget-spend/relationships": "library", "#/budget-spend/pursuits": "spend", "#/budget-spend/queue": "spend", "#/budget-spend/services": "overview", "#/budget-spend/fourth-estate": "overview", "#/budget-spend/ai-autonomy": "overview", "#/budget-spend/drilldown": "overview", "#/budget-spend/changes": "sources", "#/budget-spend/operations": "watchlist",
};
