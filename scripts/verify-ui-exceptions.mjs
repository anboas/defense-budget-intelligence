import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = async (name) => readFile(new URL(`../src/${name}`, import.meta.url), "utf8");
const [organizations, research, researchCss, evidence, evidenceCss, spend, analytics, domain, integrations, workspaces, surfaceState] = await Promise.all([
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

console.log("UI exception guard verified: collection queries, semantic statuses, async states, and local feedback have one shared owner.");
