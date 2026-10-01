import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildOrganizationChangeMonitor } from "./organization-change-monitor-core.mjs";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const artifact = JSON.parse(readFileSync(resolve(ROOT, "src/data/organization-change-monitor.json"), "utf8"));
const publicArtifact = JSON.parse(readFileSync(resolve(ROOT, "public/data/organization-change-monitor.json"), "utf8"));
assert.equal(artifact.metadata.schemaVersion, "1.0.0");
assert.equal(JSON.stringify(publicArtifact), JSON.stringify(artifact), "Source and public Organization Watch artifacts must match");
assert.ok(artifact.metadata.coverage.monitoredSources >= 10, "Organization Watch must retain the official directory registry");
assert.ok(artifact.metadata.coverage.hashedSources >= 10, "Organization Watch must retain content hashes for monitored directory pages");
assert.equal(new Set(artifact.sources.map((row) => row.id)).size, artifact.sources.length, "Monitor IDs must be unique");
for (const source of artifact.sources) {
  assert.match(source.url, /^https:\/\//, `${source.id} must use HTTPS`);
  assert.ok(source.allowedHosts.length === 1 && source.allowedHosts[0], `${source.id} must declare its allowed host`);
  assert.ok(["daily", "weekly"].includes(source.cadence), `${source.id} has an unsupported cadence`);
}
for (const proposal of artifact.proposals) {
  assert.equal(proposal.status, "needs_review", `${proposal.id} must remain review-only`);
  assert.equal(proposal.promotionPolicy, "explicit-review-required", `${proposal.id} cannot silently promote`);
}

const source = { id: "source-a", title: "Official directory", publisher: "Agency", url: "https://example.gov/leaders", observedAt: "2026-09-30", contentHash: "new" };
const role = { id: "role-a", label: "Leader", organizationName: "Office", title: "Director", sourceIds: ["source-a"] };
const priorRole = { id: "role-b", label: "Former leader", organizationName: "Office", title: "Director", sourceIds: ["source-a"] };
const fixture = buildOrganizationChangeMonitor({
  currentRoles: { metadata: { observedAt: "2026-09-30" }, sources: [source], roles: [role] },
  previousRoles: { sources: [{ ...source, contentHash: "old" }], roles: [priorRole] },
  currentOrganizations: { metadata: { generatedAt: "2026-09-30T00:00:00Z" }, dossiers: [], missionClaims: [], financialSummaries: [] },
  previousOrganizations: { dossiers: [], missionClaims: [], financialSummaries: [] },
});
assert.ok(fixture.proposals.some((row) => row.kind === "role-observed"), "A newly listed role must create a lead");
const absent = fixture.proposals.find((row) => row.kind === "role-no-longer-listed");
assert.ok(absent, "A missing role must create a review proposal");
assert.match(absent.detail, /does not establish a tenure end date/i, "A missing role must never auto-close tenure");
assert.equal(fixture.metadata.coverage.changedSources, 1, "Changed page content must remain visible");
assert.equal(fixture.queues.ready.length, 0, "Source changes cannot bypass review");

console.log(JSON.stringify({ ...artifact.metadata.coverage, contentHash: artifact.metadata.contentHash }, null, 2));
