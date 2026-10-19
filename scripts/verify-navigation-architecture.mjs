import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { MANAGEMENT_NAVIGATION, PRODUCT_WORKSPACES, navigationContext } from "../src/navigation-architecture.js";

const expectedWorkspaces = ["Today", "Opportunities", "Timeline", "Funding", "Intelligence"];
assert.deepEqual(PRODUCT_WORKSPACES.map(({ label }) => label), expectedWorkspaces, "Primary navigation must remain five stable user-job workspaces");

const ownedTabs = PRODUCT_WORKSPACES.flatMap(({ id, tabIds }) => tabIds.map((tabId) => ({ id, tabId })));
for (const tabId of ["watchlist", "tasks", "schedule", "spend", "timeline", "overview", "trends", "lifecycle", "awards", "library", "intelligence-graph", "map", "sources", "entity-workspace"]) {
  assert.equal(ownedTabs.filter((entry) => entry.tabId === tabId).length, 1, `${tabId} must have exactly one product-workspace owner`);
}

const managedTabs = MANAGEMENT_NAVIGATION.flatMap(({ id, items }) => items.map((item) => ({ group: id, ...item })));
for (const tabId of ["event-discovery", "connections", "domain-model", "intelligence", "workspace-settings", "users", "workspaces"]) {
  assert.equal(managedTabs.filter((entry) => entry.tabId === tabId).length, 1, `${tabId} must have exactly one management owner`);
  assert.equal(ownedTabs.some((entry) => entry.tabId === tabId), false, `${tabId} must not compete with a primary workspace`);
}

assert.equal(navigationContext("awards").workspace?.id, "funding", "Awards belongs to Funding");
assert.equal(navigationContext("map").workspace?.id, "intelligence", "Geography belongs to Intelligence");
assert.equal(navigationContext("tasks").workspace?.id, "today", "Tasks belongs to Today");
assert.equal(navigationContext("watchlist", "#/budget-spend/watchlist").view?.id, "brief", "The three-pane workspace is the only Today brief owner");
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
