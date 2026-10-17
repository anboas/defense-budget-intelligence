import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const read = (path) => JSON.parse(readFileSync(resolve(root, path), "utf8"));
const capture = read("src/data/capture-calendar.json");
const organizations = read("src/data/organization-intelligence.json");
const roadmap = read("src/data/roadmap-intelligence.json");
const graph = read("public/data/intelligence-graph-summary.json");

assert.equal(capture.metadata.schemaVersion, "1.1.0", "Architecture v2 must not replace the capture-calendar schema");
assert.ok(capture.records.length >= 190, "Architecture v2 must retain the complete capture-calendar source set");
assert.ok(graph.metadata.coverage.activities.total >= 888, "Architecture v2 must retain the complete opportunity activity library");
assert.ok(graph.metadata.entityCounts.organization >= 2900, "Architecture v2 must retain organization entities");
assert.ok(graph.metadata.relationCounts["organization-part-of"] > 0, "Organization hierarchy relations must remain available");
assert.ok(graph.metadata.relationCounts["person-holds-official-role"] > 0, "Person-to-role relationships must remain available");
assert.ok(graph.metadata.relationCounts["official-role-at-organization"] > 0, "Role-to-customer organization relationships must remain available");
assert.ok(graph.metadata.relationCounts["incumbent-position-for-activity"] > 0, "Company-to-work relationships must remain available");
assert.ok(graph.metadata.relationCounts["supplier-relationship-prime"] > 0, "Prime and supplier relationships must remain available");
assert.equal(organizations.metadata.coverage.dossiers, organizations.dossiers.length, "Organization dossier coverage must match the retained payload");
assert.equal(roadmap.metadata.coverage.people, roadmap.people.length, "People coverage must match the retained payload");
assert.equal(roadmap.metadata.coverage.officialRoles, roadmap.officialRoles.length, "Official-role coverage must match the retained payload");
assert.equal(roadmap.metadata.coverage.supplierRelationships, roadmap.supplierRelationships.length, "Supplier relationship coverage must match the retained payload");
assert.ok(organizations.dossiers.some((dossier) => dossier.parentOrganizationName), "Customer hierarchy must include reviewed parent relationships");
assert.ok(organizations.dossiers.some((dossier) => dossier.personIds?.length && dossier.awardIds?.length && dossier.vendorNames?.length), "At least one customer dossier must connect people, work, and companies");

console.log(JSON.stringify({
  timelineRecords: capture.records.length,
  activities: graph.metadata.coverage.activities.total,
  organizations: graph.metadata.entityCounts.organization,
  dossiers: organizations.dossiers.length,
  people: roadmap.people.length,
  roles: roadmap.officialRoles.length,
  supplierRelationships: roadmap.supplierRelationships.length,
}, null, 2));
