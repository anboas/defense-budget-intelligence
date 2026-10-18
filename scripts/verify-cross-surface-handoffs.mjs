import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  accountFlowRoute,
  awardsRoute,
  classificationRoute,
  dataLibraryRoute,
  intelligenceGraphRoute,
  mapLocationRoute,
  opportunityRoute,
  sourceLineageRoute,
  timelineRoute,
} from "../src/cross-surface-routes.js";

function params(href) {
  return new URLSearchParams(href.split("?")[1] || "");
}

assert.equal(params(mapLocationRoute("location:patuxent-river", "Naval Air Systems Command")).get("mapOrg"), "location:patuxent-river");
assert.equal(params(mapLocationRoute("patuxent-river", "Naval Air Systems Command")).get("mapQuery"), "Naval Air Systems Command");
assert.equal(params(awardsRoute("N00019-24-C-0012")).get("query"), "N00019-24-C-0012");
assert.equal(params(awardsRoute("N00019-24-C-0012")).get("awardId"), "N00019-24-C-0012");
assert.equal(params(accountFlowRoute("097-0400")).get("selected"), "097-0400");
assert.equal(params(dataLibraryRoute({ organizationId: "org:navair", query: "Naval Air Systems Command" })).get("libraryOrg"), "org:navair");
assert.equal(params(dataLibraryRoute({ recordId: "record-1" })).get("capRecord"), "record-1");
assert.equal(params(timelineRoute("record-1")).get("capRecord"), "record-1");
assert.equal(params(timelineRoute("", { vehicle: "N00019-D-0001" })).get("capVehicle"), "N00019-D-0001");
assert.equal(params(timelineRoute("record-1", { research: "report-1", researchDate: "2026-10-17", from: 2025, to: 2027 })).get("capResearchDate"), "2026-10-17");
assert.equal(params(opportunityRoute("record-1")).get("spendView"), "record");
assert.equal(params(intelligenceGraphRoute("record-1")).get("graphRecord"), "record-1");
assert.equal(params(sourceLineageRoute("record-1")).get("capRecord"), "record-1");
assert.equal(params(classificationRoute("NAICS 541512")).get("capQuery"), "NAICS 541512");

const visual = readFileSync(new URL("../src/ConnectedEvidenceVisual.jsx", import.meta.url), "utf8");
const related = readFileSync(new URL("../src/ConnectedEvidence.jsx", import.meta.url), "utf8");
const graphPage = readFileSync(new URL("../src/IntelligenceGraphPage.jsx", import.meta.url), "utf8");
const workbench = readFileSync(new URL("../src/OpportunityWorkbenchDetail.jsx", import.meta.url), "utf8");
for (const legacy of ["awardQuery", "accountQuery", "mapOrg=${encodeURIComponent(primaryLocation.sourceId)"]) {
  assert.equal(visual.includes(legacy) || related.includes(legacy), false, `Cross-surface graph links must not retain legacy route state: ${legacy}`);
}
for (const source of [visual, related, graphPage, workbench]) {
  assert.equal(/#\/budget-spend\/(?:map|awards|lifecycle|library|timeline|intelligence-graph)\?/.test(source), false, "Evidence surfaces must use canonical cross-surface route builders instead of handwritten query contracts");
}

console.log("Cross-surface route contract passed: exact target identities, canonical parameters, and legacy drift checks are green.");
