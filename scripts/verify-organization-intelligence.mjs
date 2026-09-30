import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const artifact = JSON.parse(readFileSync(resolve(ROOT, "src/data/organization-intelligence.json"), "utf8"));
const publicArtifact = JSON.parse(readFileSync(resolve(ROOT, "public/data/organization-intelligence.json"), "utf8"));

assert.equal(artifact.metadata.schemaVersion, "1.0.0");
assert.equal(artifact.metadata.coverage.dossiers, 100);
assert.ok(artifact.metadata.coverage.roles >= 250, "Organization Intelligence must retain at least 250 sourced role observations");
assert.ok(artifact.metadata.coverage.people >= 90, "Organization Intelligence should retain the deduplicated public professional directory");
assert.ok(artifact.metadata.coverage.dossiersWithLeadership >= 15, "Leadership coverage is below the bounded cohort floor");
assert.ok(artifact.metadata.coverage.dossiersWithMission >= 20, "Mission coverage is below the bounded cohort floor");
assert.ok(artifact.metadata.coverage.dossiersWithFinance >= 40, "Financial coverage is below the bounded cohort floor");
assert.equal(JSON.stringify(publicArtifact), JSON.stringify(artifact), "Source and public Organization Intelligence artifacts must match");

const dossierIds = new Set(artifact.dossiers.map((row) => row.id));
const roleIds = new Set(artifact.officialRoles.map((row) => row.id));
const personIds = new Set(artifact.people.map((row) => row.id));
const sourceIds = new Set(artifact.sources.map((row) => row.id));
assert.equal(dossierIds.size, artifact.dossiers.length, "Dossier IDs must be unique");
assert.equal(new Set(artifact.missionClaims.map((row) => row.id)).size, artifact.missionClaims.length, "Mission claim IDs must be unique");
assert.equal(new Set(artifact.financialSummaries.map((row) => row.id)).size, artifact.financialSummaries.length, "Financial summary IDs must be unique");
assert.equal(new Set(artifact.researchGaps.map((row) => row.id)).size, artifact.researchGaps.length, "Research gap IDs must be unique");
assert.equal(new Set(artifact.changeEvents.map((row) => row.id)).size, artifact.changeEvents.length, "Change event IDs must be unique");

for (const role of artifact.officialRoles) {
  assert.ok(personIds.has(role.personId), `${role.id} references an unknown person`);
  assert.ok(role.sourceIds?.length, `${role.id} lacks source evidence`);
  assert.ok(role.sourceIds.every((id) => sourceIds.has(id)), `${role.id} references an unknown source`);
  assert.ok(role.effectiveFrom || role.effectiveTo, `${role.id} lacks an effective or observation boundary`);
  if (role.datePrecision === "observed-current-lower-bound") assert.equal(role.status, "observed-current", `${role.id} lower-bound observation must remain observed-current`);
}
for (const dossier of artifact.dossiers) {
  assert.ok(dossier.roleIds.every((id) => roleIds.has(id)), `${dossier.id} references an unknown role`);
  assert.ok(dossier.personIds.every((id) => personIds.has(id)), `${dossier.id} references an unknown person`);
  assert.ok(dossier.researchGapIds.length || dossier.sourceUrls.length, `${dossier.id} must retain evidence or an explicit gap`);
  assert.ok(["tier-1", "tier-2", "tier-3"].includes(dossier.priorityTier), `${dossier.id} has invalid priority tier`);
}
for (const row of artifact.financialSummaries) {
  assert.ok(dossierIds.has(row.dossierId), `${row.id} references an unknown dossier`);
  assert.ok(row.measureType && row.sourceBoundary, `${row.id} lacks financial semantics`);
  assert.doesNotMatch(row.sourceBoundary, /total market size$/i, `${row.id} overstates its boundary`);
}
for (const row of artifact.researchGaps) {
  assert.ok(dossierIds.has(row.dossierId), `${row.id} references an unknown dossier`);
  assert.equal(row.status, "open");
}

console.log(JSON.stringify({ schemaVersion: artifact.metadata.schemaVersion, ...artifact.metadata.coverage, contentHash: artifact.metadata.contentHash }, null, 2));
