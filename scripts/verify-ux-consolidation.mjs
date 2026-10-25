import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = async (name) => readFile(new URL(`../src/${name}`, import.meta.url), "utf8");
const [table, awards, budget, spend, analytics, navigation, preview, analyticsPreview, workspace, today, main, graphPage, graph, structureControls] = await Promise.all([
  read("OperationalDataTable.jsx"), read("AwardsRoute.jsx"), read("BudgetRequestRoutes.jsx"), read("SpendExplorer.jsx"), read("TransactionAnalytics.jsx"), read("navigation-architecture.js"), read("OpportunityWorkbenchDetail.jsx"), read("AnalyticsRecordDrawer.jsx"), read("UniversalIntelligenceWorkspace.jsx"), read("TodayWorkspace.jsx"), read("main.jsx"), read("IntelligenceGraphPage.jsx"), read("LinkedIntelligenceGraph.jsx"), read("OrganizationStructureControls.jsx"),
]);

for (const [label, source] of [["operational tables", table], ["analytics", analytics]]) {
  assert.match(source, /QueryRail/, `${label} must use the canonical Query Rail`);
}
assert.match(awards, /OperationalDataTable[\s\S]*filterContent=/, "Awards must delegate its query and filters to the canonical table Query Rail");
assert.doesNotMatch(awards, /className="award-filter-bar/, "Awards must not restore its route-owned filter toolbar");
assert.match(budget, /QueryRail[\s\S]*filterAriaLabel="Filter budget line items"/, "Funding Request must use the canonical Query Rail instead of a route-owned filter bar");
assert.match(spend, /ANALYSIS_MODES[\s\S]*portfolio[\s\S]*transactions/, "Analysis Studio must own its bounded modes");
assert.match(navigation, /id: "analysis"[\s\S]*spendView=analysis/, "Opportunities must expose one Analysis Studio destination");
const opportunitiesNavigation = navigation.match(/\{ id: "opportunities"[\s\S]*?(?=\n {2}\{ id: "funding")/)?.[0] || "";
assert.ok(opportunitiesNavigation, "Opportunities navigation must remain independently addressable");
assert.doesNotMatch(opportunitiesNavigation, /id: "radar"|id: "portfolio"/, "Radar and Portfolio must not compete as Opportunities destinations");
for (const [label, source] of [["workbench preview", preview], ["analytics preview", analyticsPreview], ["award preview", awards]]) {
  assert.match(source, /EntityPreview/, `${label} must use the canonical entity preview anatomy`);
}
assert.match(spend, /SemanticStatusBadge category="workflow"/, "Opportunity workflow status must declare its semantic category");
assert.match(spend, /SemanticStatusBadge category="evidence"/, "Opportunity evidence status must declare its semantic category");
assert.match(today, /SemanticStatusBadge category="workflow"[\s\S]*SemanticStatusBadge category="evidence"/, "Today must distinguish workflow and evidence status");
assert.match(workspace, /SemanticStatusBadge category=/, "The Intelligence Workspace must use semantic status categories");
assert.match(main, /SurfaceState[\s\S]*owner="route"/, "Route loading and errors must use the shared surface-state owner");
assert.match(graphPage, /ControlPopover[\s\S]*TraceControl/, "Graph connection tracing must use the shared popover owner instead of a permanently open second search field");
assert.match(graphPage, /updateStructureView[\s\S]*history\.replaceState/, "Graph view controls must preserve the mounted canvas while updating their shareable URL state");
assert.match(graph, /ControlTabs[\s\S]*badge:[\s\S]*ControlMenu/, "Graph lenses and secondary inspector actions must use shared tabs, badges, and menu owners");
assert.match(structureControls, /ControlPicker[\s\S]*ControlPopover[\s\S]*ControlTabs/, "Organization drill-down must compose framework pickers, popovers, and tabs");
assert.doesNotMatch(structureControls, /ControlSelect|<select\b/, "Organization drill-down must not restore route-local select anatomy");

console.log("UX consolidation verified: canonical query, analysis, preview, graph-control, status, and route-feedback owners.");
