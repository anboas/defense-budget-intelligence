import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const actions = JSON.parse(readFileSync("src/data/priority-award-actions.json", "utf8"));
const legislation = JSON.parse(readFileSync("src/data/legislative-traceability.json", "utf8"));
const strategic = JSON.parse(readFileSync("src/data/strategic-intelligence.json", "utf8"));

assert.ok(actions.metadata?.coverage?.selectedAwards >= 100, "Priority award selection regressed");
assert.equal(actions.metadata?.coverage?.failures, 0, "Priority award action collection has unresolved failures");
assert.ok((actions.actions || []).length >= 2_500, "Priority award action depth regressed");
assert.ok(new Set((actions.actions || []).map((row) => row.id)).size === actions.actions.length, "Award action IDs must be unique");
for (const row of actions.actions || []) {
  assert.match(row.id, /^award-action:usaspending:/);
  assert.ok(row.awardId && row.transactionId && row.sourceUrl, "Award actions require exact award, transaction, and source identity");
}

assert.ok((legislation.measures || []).length >= 8, "Defense legislative measure coverage regressed");
assert.ok((legislation.versions || []).length >= 20, "Defense bill-version coverage regressed");
assert.ok((legislation.enactedProvisions || []).length >= 5, "Enacted defense law coverage regressed");
for (const row of legislation.relations || []) {
  assert.ok(["measure-has-version", "measure-backed-by-report", "measure-enacted-as"].includes(row.type), `Unsupported legislative relation ${row.type}`);
  assert.ok(row.from && row.to && row.sourceUrl, "Legislative traceability requires exact endpoints and source URL");
}

assert.ok((strategic.forecasts || []).length >= 10, "Acquisition forecast coverage regressed");
assert.ok((strategic.missionAssignments || []).length >= 90, "Reviewed mission coverage regressed");
assert.ok((strategic.tenantAssignments || []).length >= 150, "Reviewed installation-tenant coverage regressed");
assert.ok((strategic.expirationSignals || []).length >= 100, "Expiration signal coverage regressed");
assert.ok((strategic.executionRiskSignals || []).length >= 50, "Execution review-signal coverage regressed");
assert.ok((strategic.outcomeEvidence || []).length >= 100, "Outcome evidence coverage regressed");
for (const row of [...(strategic.competitiveSignals || []), ...(strategic.expirationSignals || []), ...(strategic.executionRiskSignals || [])]) {
  assert.ok(row.evaluationDate && row.modelVersion && row.reviewState && row.caveat, `Signal ${row.id} lacks review controls`);
}
const sbir = strategic.sourceHealth?.find((row) => row.id === "sbir-sttr");
assert.equal(sbir?.status, "unavailable", "SBIR must remain explicitly unavailable while the official API is under maintenance");
assert.equal(sbir?.records, 0, "SBIR must not fabricate empty coverage");
const gao = strategic.sourceHealth?.find((row) => row.id === "gao-protests");
assert.equal(gao?.status, "partial", "GAO protest evidence must remain explicitly partial");
console.log(`Strategic intelligence passed: ${actions.actions.length} award actions, ${legislation.measures.length} measures, ${strategic.missionAssignments.length} missions, ${strategic.outcomeEvidence.length} outcomes`);
