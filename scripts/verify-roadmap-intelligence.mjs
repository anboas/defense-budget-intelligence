import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const artifact = JSON.parse(readFileSync(resolve(ROOT, "src/data/roadmap-intelligence.json"), "utf8"));
const directorySnapshot = JSON.parse(readFileSync(resolve(ROOT, "src/data/official-role-directory-snapshot.json"), "utf8"));
const coverage = artifact.metadata?.coverage || {};

assert.equal(artifact.metadata?.schemaVersion, "1.0.0", "Roadmap intelligence schema changed");
assert.ok(coverage.people >= 100, "Public professional coverage fell below the Organization Intelligence release floor");
assert.ok(coverage.officialRoles >= 250, "Official role coverage fell below the Organization Intelligence release floor");
assert.equal(coverage.successions, 4, "Exact role succession coverage changed");
assert.ok(coverage.observedCurrentRoles >= 250, "Observed-current role coverage fell below the official-directory floor");
assert.equal(coverage.supplierRelationships, 1000, "Bounded supplier relationship coverage changed");
assert.equal(coverage.buyerProfiles, 22, "Buyer profile coverage changed");
assert.equal(coverage.vendorProfiles, 235, "Vendor profile coverage changed");
assert.equal(coverage.incumbentPositions, 879, "Incumbent-position coverage changed");
assert.equal(coverage.programHealthProfiles, 2723, "Every defense program must retain a health summary");
assert.equal(coverage.accountabilityFindings, 4, "Bounded accountability finding coverage changed");
assert.ok(coverage.officialDocuments >= 50, "Official document coverage fell below the expanded source-register floor");
assert.equal(coverage.documentVersions, coverage.officialDocuments, "Every official document must retain one observed version");
assert.equal(coverage.documentTables, 3, "Verified table coverage changed");
assert.ok(coverage.citations >= 300, "Exact document citation coverage fell below the expanded role-evidence floor");
assert.equal(coverage.embeddings, 0, "Embeddings must remain explicit zero until configured");
assert.equal(coverage.correctiveActions, 0, "Corrective-action coverage must remain explicit zero until sourced");
assert.equal(coverage.protestDecisions, 0, "Protest coverage must remain explicit zero until sourced");
assert.equal(coverage.auditFindings, 0, "Audit coverage must remain explicit zero until sourced");
assert.equal(coverage.savedQueryTemplates, 8, "Saved query template coverage changed");
assert.equal(coverage.briefTemplates, 5, "Brief template coverage changed");

const people = new Set(artifact.people.map((row) => row.id));
const roles = new Set(artifact.officialRoles.map((row) => row.id));
const sources = new Map(artifact.sources.map((row) => [row.id, row]));
assert.equal(people.size, artifact.people.length, "Public professional IDs must be unique");
assert.equal(roles.size, artifact.officialRoles.length, "Official role IDs must be unique");
assert.equal(directorySnapshot.metadata?.status, "current", "Official directory snapshot must be current");
assert.ok(directorySnapshot.roles.length >= 250, "Official directory snapshot fell below the role floor");
assert.ok(directorySnapshot.sources.every((row) => /^https:\/\//.test(row.url) && row.contentHash), "Official directory sources require HTTPS URLs and content hashes");
for (const role of artifact.officialRoles) {
  assert.ok(people.has(role.personId), `${role.id} references an unknown person`);
  assert.ok(role.effectiveFrom || role.effectiveTo, `${role.id} lacks a temporal boundary`);
  assert.ok(role.sourceIds?.length && role.sourceIds.every((id) => sources.has(id)), `${role.id} lacks official source evidence`);
  assert.ok(role.evidenceQuote && role.reviewState, `${role.id} lacks reviewed evidence`);
}
for (const succession of artifact.roleSuccessions) {
  assert.ok(roles.has(succession.predecessorRoleId), `${succession.id} lacks a predecessor role`);
  assert.ok(roles.has(succession.successorRoleId), `${succession.id} lacks a successor role`);
  assert.ok(sources.has(succession.sourceId), `${succession.id} lacks an official source`);
}

assert.ok(artifact.supplierRelationships.every((row) => row.coverageState === "partial" && row.primeName && row.supplierName), "Supplier relationships must disclose bounded partial coverage");
assert.ok(artifact.programHealthProfiles.every((row) => row.evidenceBoundary?.includes("not a predictive program rating")), "Program health profiles must retain their non-predictive boundary");
assert.ok(artifact.officialDocuments.every((row) => /^https:\/\//.test(row.url)), "Official documents require HTTPS source URLs");
assert.ok(artifact.documentVersions.every((row) => row.contentHash && row.hashBasis === "normalized-source-metadata"), "Document versions must disclose their hash basis");
assert.ok(artifact.documentTables.every((row) => row.printedPage && row.contentHash && row.hashBasis === "verified-table-extract"), "Document tables require page-cited verified extracts");
assert.ok(artifact.citations.every((row) => row.documentId && row.targetType && row.targetId && row.selectorType && row.sourceUrl), "Every citation requires a document, target, selector, and source URL");
assert.ok(artifact.briefTemplates.every((row) => row.publicationPolicy === "review-before-send"), "Brief templates must require review before publication");
assert.match(artifact.metadata.evidenceBoundary, /public professional roles only/i);
assert.match(artifact.metadata.evidenceBoundary, /not a complete supplier registry/i);
assert.match(artifact.metadata.evidenceBoundary, /Embeddings.*explicit zero/i);

const forbidden = /(?:home address|personal email|personal phone|social security|date of birth)/i;
assert.ok(!forbidden.test(JSON.stringify({ people: artifact.people, roles: artifact.officialRoles })), "Official people artifact contains forbidden personal-profile data");

console.log(`Roadmap intelligence verified: ${coverage.officialRoles} roles, ${coverage.supplierRelationships} supplier relationships, ${coverage.officialDocuments} documents, ${coverage.savedQueryTemplates} query templates`);
