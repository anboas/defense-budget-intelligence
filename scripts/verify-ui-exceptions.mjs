import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";

const read = async (name) => readFile(new URL(`../src/${name}`, import.meta.url), "utf8");
const sourceRoot = new URL("../src/", import.meta.url);

async function readSources(directory = sourceRoot) {
  const entries = await readdir(directory, { withFileTypes: true });
  const sources = [];
  for (const entry of entries) {
    const url = new URL(entry.name, directory);
    if (entry.isDirectory()) sources.push(...await readSources(new URL(`${entry.name}/`, directory)));
    else if (/\.(?:jsx|css)$/.test(entry.name) && entry.name !== "control-surface.css") sources.push([url.pathname, await readFile(url, "utf8")]);
  }
  return sources;
}
const [organizations, research, researchCss, evidence, evidenceCss, spend, analytics, domain, integrations, workspaces, surfaceState, today, todayCss, wallboardCalendar, navigation, operations, actions, opportunityActions] = await Promise.all([
  read("IntelligenceProductsPage.jsx"),
  read("ResearchDiscoveryDashboard.jsx"),
  read("ResearchDiscoveryDashboard.css"),
  read("ConnectedEvidence.jsx"),
  read("ConnectedEvidence.css"),
  read("SpendExplorer.jsx"),
  read("TransactionAnalytics.jsx"),
  read("DomainModelPage.jsx"),
  read("IntegrationManagement.jsx"),
  read("WorkspaceManagement.jsx"),
  read("SurfaceState.jsx"),
  read("TodayWorkspace.jsx"),
  read("TodayWorkspace.css"),
  read("WallboardCalendar.jsx"),
  read("navigation-architecture.js"),
  read("OperationsHub.jsx"),
  read("ActionsWorkspace.jsx"),
  read("OpportunityCommandRail.jsx"),
]);

for (const [label, source] of [
  ["Organization Intelligence", organizations],
  ["Research Operations", research],
  ["Connected Evidence", evidence],
  ["Spend Explorer", spend],
  ["Domain Model", domain],
  ["Integration Management", integrations],
  ["Workspace Management", workspaces],
]) {
  assert.doesNotMatch(source, /\bControlAsyncState\b/, `${label} must delegate loading, empty, error, and retry states to SurfaceState`);
}

assert.match(organizations, /QueryRail[\s\S]*label="organization dossiers"/, "Organization dossiers must use the canonical Query Rail");
assert.match(organizations, /SemanticStatusBadge category="health"/, "Organization source and freshness health must use semantic status ownership");
assert.doesNotMatch(organizations, /ControlSearch|className={`if-badge/, "Organization Intelligence must not restore route-local search or computed badge classes");

assert.match(research, /SurfaceState[\s\S]*SurfaceFeedback[\s\S]*SemanticStatusBadge/, "Research Operations must share async feedback and semantic status owners");
assert.doesNotMatch(research, /research-dashboard__notice|research-dashboard__status|className={`if-badge/, "Research Operations must not restore route-local notice or status systems");
assert.doesNotMatch(researchCss, /research-dashboard__(?:notice|status)/, "Research Operations must not retain dead route-local notice or status CSS");

assert.match(evidence, /SurfaceState[\s\S]*SemanticStatusBadge/, "Connected Evidence must share async and temporal status owners");
assert.doesNotMatch(evidence, /connected-evidence__status|<button type="button" onClick=\{\(\) => \{ setState/, "Connected Evidence must not restore bespoke status or retry controls");
assert.doesNotMatch(evidenceCss, /connected-evidence__status/, "Connected Evidence must not retain dead temporal-status CSS");

assert.match(spend, /SurfaceFeedback owner="strategy-scope"[\s\S]*SurfaceFeedback owner="daily-update-scope"[\s\S]*SurfaceFeedback owner="record-dispositions"/, "Spend feedback must remain with its owning scope or action");
assert.doesNotMatch(spend, /className="if-alert/, "Spend Explorer must not restore route-owned feedback alerts");

assert.match(analytics, /QueryRail/, "Transaction Analytics must use the canonical Query Rail");
assert.doesNotMatch(analytics, /analytics-search|analytics-manager/, "Transaction Analytics must not restore its retired parallel query controls");

assert.match(integrations, /SurfaceState[\s\S]*owner="contract-coverage"/, "Integration coverage must own loading and retry feedback locally");
assert.match(workspaces, /SemanticStatusBadge category="workflow"[\s\S]*SurfaceState/, "Workspace administration must use semantic policy status and owned loading states");
assert.match(domain, /SurfaceState[\s\S]*owner="domain-model"/, "Domain Model access and loading states must use the shared surface owner");

assert.match(surfaceState, /state === "info" \? "info"/, "SurfaceFeedback must retain an explicit informational state");

for (const component of ["ControlCalendarSurface", "ControlCalendarHeader", "ControlCalendarViewSwitcher", "ControlCalendarGrid", "ControlCalendarDay", "ControlCalendarItem", "ControlCalendarFooter"]) {
  assert.match(today, new RegExp(`\\b${component}\\b`), `Today forward view must use ${component}`);
}
assert.match(today, /ControlCalendarGrid[\s\S]*layout="range"[\s\S]*rows=\{2\}/, "Today calendar must use the shared two-row range layout");
assert.doesNotMatch(today, /today-calendar if-management-grid|today-forward__(?:header|modes|footer)/, "Today must not restore its local calendar shell, switcher, or footer");
assert.doesNotMatch(todayCss, /today-forward__(?:header|modes|footer)/, "Today must not retain dead local calendar-shell CSS");
assert.match(wallboardCalendar, /ControlCalendarDay/, "The operational month calendar must share the framework day-cell anatomy");

assert.match(navigation, /label: "Focus"[\s\S]*label: "Actions"[\s\S]*label: "Schedule"/, "Today must expose Focus, Actions, and Schedule as its owned human-work views");
assert.match(navigation, /label: "Automation Runs"[\s\S]*tabId: "tasks"/, "Technical API and AI history must live under the Automation Runs management owner");
assert.doesNotMatch(today, /useNotifications|loadProcurementFeed|data-today-system-attention|Operating loop|My tracked work/, "Today Focus must not mix technical operations, decorative process chrome, or fake scope controls into human decision work");
assert.match(operations, /view === "actions"[\s\S]*<ActionsWorkspace/, "Operations Hub must delegate human work to the owned Actions workspace");
assert.match(actions, /data-actions-workspace[\s\S]*title="Actions"[\s\S]*Human-owned next steps across tracked pursuits/, "The Today Actions view must own human pursuit work explicitly");
assert.match(operations, /title="Automation Runs"[\s\S]*AI, provider, and authenticated API run history/, "Automation Runs must identify its technical diagnostic scope explicitly");
assert.doesNotMatch(operations, /title="Task Center"|Open complete task history/, "The generic Task Center label must not return");
assert.match(opportunityActions, /if-field__label">Action<[\s\S]*label="Action priority"[\s\S]*ariaLabel="Action owner"/, "Opportunity planning must use human-facing action language consistently");

const sources = await readSources();
const specializedDetails = new Map([
  ["AnalyticsSources.jsx", [/className={`source-health-card/]],
  ["CaptureTargeting.jsx", [/<details defaultOpen=\{index === 0\}>/]],
  ["OpportunityPortfolioVisuals.jsx", [/className="strategy-config"/]],
]);
for (const [name, source] of sources) {
  assert.doesNotMatch(source, /className=(?:"[^"]*|\{`[^`]*)(?:if-tabs__list|if-tab\b)/, `${name} must consume ControlTabs instead of rebuilding framework tab markup`);
  assert.doesNotMatch(source, /__(?:tabs|switch|mode)\s+(?:button|\.if-tab)|__(?:tabs|switch|mode)>button/, `${name} must not restyle shared tab anatomy`);
  const rawDetails = source.match(/<details\b/g) || [];
  if (!rawDetails.length) continue;
  const file = name.split("/").at(-1);
  const allowed = specializedDetails.get(file) || [];
  assert.equal(rawDetails.length, allowed.length, `${name} must use ControlDisclosure unless it is one of the reviewed record-row disclosure owners`);
  for (const pattern of allowed) assert.match(source, pattern, `${name} must retain only its reviewed specialized disclosure owner`);
}
for (const file of ["ConnectedEvidence.jsx", "WorkspaceManagement.jsx", "IntelligenceProductsPage.jsx", "OpportunityWorkbenchDetail.jsx", "BudgetRequestRoutes.jsx", "TransactionAnalytics.jsx", "AnalyticsSources.jsx", "UniversalIntelligenceWorkspace.jsx", "CaptureTargeting.jsx", "OpportunityPortfolioVisuals.jsx", "AcquisitionRuntimePanel.jsx", "OpportunityCommandRail.jsx", "OrganizationRelationshipLens.jsx", "SpendSavedViews.jsx", "OpportunityRadar.jsx", "CaptureCalendar.jsx"]) {
  assert.match(await read(file), /\bControlDisclosure\b/, `${file} must delegate ordinary reveal controls to ControlDisclosure`);
}
for (const file of ["SectionedPageHeader.jsx", "SpendExplorer.jsx", "TodayWorkspace.jsx", "AddEventDialog.jsx", "UniversalIntelligenceWorkspace.jsx", "TransactionAnalytics.jsx", "OperationsHub.jsx", "ConnectedEvidenceVisual.jsx", "OpportunityPortfolioVisuals.jsx"]) {
  assert.match(await read(file), /\bControlTabs\b/, `${file} must delegate its second-layer views to ControlTabs`);
}

console.log("UI exception guard verified: queries, calendars, tabs, disclosures, semantic statuses, async states, and local feedback have one shared owner.");
