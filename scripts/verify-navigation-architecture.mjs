import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { MANAGEMENT_NAVIGATION, PRODUCT_WORKSPACES, navigationContext } from "../src/navigation-architecture.js";

const expectedWorkspaces = ["Today", "Opportunities", "Funding", "Intelligence"];
assert.deepEqual(PRODUCT_WORKSPACES.map(({ label }) => label), expectedWorkspaces, "Primary navigation must keep Timeline inside the Opportunities workspace");

const ownedTabs = PRODUCT_WORKSPACES.flatMap(({ id, tabIds }) => tabIds.map((tabId) => ({ id, tabId })));
for (const tabId of ["watchlist", "actions", "schedule", "spend", "timeline", "overview", "trends", "lifecycle", "awards", "library", "intelligence-graph", "map", "sources", "entity-workspace"]) {
  assert.equal(ownedTabs.filter((entry) => entry.tabId === tabId).length, 1, `${tabId} must have exactly one product-workspace owner`);
}

const managedTabs = MANAGEMENT_NAVIGATION.flatMap(({ id, items }) => items.map((item) => ({ group: id, ...item })));
for (const tabId of ["tasks", "event-discovery", "connections", "domain-model", "intelligence", "workspace-settings", "users", "workspaces"]) {
  assert.equal(managedTabs.filter((entry) => entry.tabId === tabId).length, 1, `${tabId} must have exactly one management owner`);
  assert.equal(ownedTabs.some((entry) => entry.tabId === tabId), false, `${tabId} must not compete with a primary workspace`);
}

assert.equal(navigationContext("awards").workspace?.id, "funding", "Awards belongs to Funding");
assert.equal(navigationContext("map").workspace?.id, "intelligence", "Geography belongs to Intelligence");
assert.equal(navigationContext("actions").workspace?.id, "today", "Human Actions belongs to Today");
assert.equal(navigationContext("tasks").workspace, null, "Technical Automation Runs belongs to Manage, not a product workspace");
assert.equal(navigationContext("watchlist", "#/budget-spend/watchlist").view?.id, "focus", "The three-pane workspace is the only Today focus owner");
assert.equal(PRODUCT_WORKSPACES.find(({ id }) => id === "opportunities")?.href, "#/budget-spend/timeline", "Opportunities must open its default Timeline view");
assert.deepEqual(PRODUCT_WORKSPACES.find(({ id }) => id === "opportunities")?.views.map(({ label }) => label), ["Timeline", "Workbench", "Analysis"], "Opportunities secondary navigation must use the requested decision order");
assert.equal(navigationContext("timeline", "#/budget-spend/timeline").workspace?.id, "opportunities", "Timeline belongs to Opportunities");
assert.equal(navigationContext("timeline", "#/budget-spend/timeline").view?.id, "timeline", "The canonical Timeline route must activate the default Opportunities view");
assert.equal(navigationContext("spend", "#/budget-spend/explorer?spendView=timeline").view?.id, "timeline", "Legacy embedded Timeline links must retain the canonical secondary-navigation state");
for (const legacyView of ["visuals", "radar", "charts"]) {
  assert.equal(navigationContext("spend", `#/budget-spend/explorer?spendView=${legacyView}`).view?.id, "analysis", `${legacyView} must resolve into Analysis Studio`);
}
assert.equal(navigationContext("spend", "#/budget-spend/explorer?spendView=analysis&analysisMode=portfolio").view?.id, "analysis", "Analysis Studio must own its canonical route");
assert.equal(navigationContext("spend", "#/budget-spend/explorer?spendView=today").workspace?.id, "opportunities", "Legacy query state must not create a second Today owner inside Opportunities");

const headerSource = await readFile(new URL("../src/SiteHeader.jsx", import.meta.url), "utf8");
assert.doesNotMatch(headerSource, /ci-topnav-menu-badge|data-nav-group-trigger|data-budget-nav-menu/, "Header must not restore the mixed-purpose route-card navigation");
assert.match(headerSource, /data-primary-workspace/, "Header must expose primary workspace semantics");
assert.match(headerSource, /data-workspace-view/, "Header must expose owned secondary-view semantics");
assert.match(headerSource, /data-manage-menu/, "Header must keep governance behind the Manage utility");

console.log(`Navigation architecture verified: ${PRODUCT_WORKSPACES.length} workspaces, ${ownedTabs.length} owned routes, ${managedTabs.length} managed capabilities.`);
