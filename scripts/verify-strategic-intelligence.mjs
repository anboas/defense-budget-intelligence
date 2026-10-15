import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const actions = JSON.parse(readFileSync("src/data/priority-award-actions.json", "utf8"));
const legislation = JSON.parse(readFileSync("src/data/legislative-traceability.json", "utf8"));
const strategic = JSON.parse(readFileSync("src/data/strategic-intelligence.json", "utf8"));

assert.ok(actions.metadata?.coverage?.selectedAwards >= 100, "Priority award selection regressed");
assert.equal(actions.metadata?.coverage?.resolvedAwards + actions.metadata?.coverage?.failures, actions.metadata?.coverage?.selectedAwards, "Every selected priority award must resolve or disclose a failed refresh");
assert.equal(actions.metadata?.coverage?.failures, (actions.failures || []).length, "Priority award failure metadata must match the retained diagnostics");
assert.ok(["current", "partial", "stale"].includes(actions.metadata?.status || "current"), "Priority award source status must remain explicit");
assert.ok((actions.actions || []).length >= 2_500, "Priority award action depth regressed");
assert.ok(new Set((actions.actions || []).map((row) => row.id)).size === actions.actions.length, "Award action IDs must be unique");
for (const row of actions.actions || []) {
  assert.match(row.id, /^award-action:usaspending:/);
  assert.ok(row.awardId && row.transactionId && row.sourceUrl, "Award actions require exact award, transaction, and source identity");
}
if (actions.metadata?.coverage?.failures > 0) {
  const expectedStatus = actions.metadata.coverage.resolvedAwards > 0 ? "partial" : "stale";
  assert.equal(actions.metadata.status, expectedStatus, "Priority award status must distinguish partial refreshes from fully stale preservation");
  assert.ok(Number.isFinite(Date.parse(actions.metadata.generatedAt)), "A degraded priority award snapshot must retain a successful generation time");
  assert.ok(Number.isFinite(Date.parse(actions.metadata.lastAttemptAt)), "A degraded priority award snapshot must disclose the failed attempt time");
  const actionAwards = new Set((actions.actions || []).map((row) => row.awardId));
  const summaryByAward = new Map((actions.awardSummaries || []).map((row) => [row.awardId, row]));
  for (const failure of actions.failures || []) {
    assert.ok(failure.awardId && failure.error, "Every failed priority award must retain a safe diagnostic");
    assert.ok(actionAwards.has(failure.awardId), `Failed priority award ${failure.awardId} must retain its prior verified actions`);
    assert.equal(summaryByAward.get(failure.awardId)?.status, "stale", `Failed priority award ${failure.awardId} must be marked stale`);
    assert.ok(Number.isFinite(Date.parse(summaryByAward.get(failure.awardId)?.lastAttemptAt)), `Failed priority award ${failure.awardId} must disclose its last attempt`);
  }
} else {
  assert.equal(actions.metadata?.status || "current", "current", "A failure-free priority award refresh must be current");
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
