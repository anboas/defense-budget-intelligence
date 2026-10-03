import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  analyzeRecordGroupWithOpenAi,
  automaticLifecycleGroups,
  automaticRecordRelationships,
  buildRecordGroupAiRequest,
  collapseLifecycleRecords,
  exactLifecycleEvidence,
  exactFollowOnEvidence,
  exactRecordGroupAssessment,
} from "../src/record-linking.js";
import { automatedSamRecord } from "../src/procurement-taxonomy.js";

const capture = JSON.parse(readFileSync(resolve("src/data/capture-calendar.json"), "utf8"));
const supportV = capture.records.find((record) => record.id === "C104");
const supportIV = capture.records.find((record) => record.id === "C105");
const aviationEnvironment = capture.records.find((record) => record.id === "C106");
assert.ok(supportV && supportIV && aviationEnvironment, "NDMS lifecycle fixtures must remain in the canonical capture corpus");

const exact = exactLifecycleEvidence(supportIV, supportV);
assert.equal(exact?.relationship, "successive-phase");
assert.equal(exact?.confidence, "exact");
assert.ok(exact.basis.includes("Shared parent award 47QFAA21A0002"));
assert.ok(exact.basis.includes("1-day transition between reported terms"));
assert.equal(exactLifecycleEvidence(supportIV, aviationEnvironment), null, "A shared acronym and recipient must not merge a different requirement");

const automatic = automaticLifecycleGroups([supportIV, supportV, aviationEnvironment]);
assert.equal(automatic.length, 1);
assert.deepEqual(automatic[0].memberIds, [supportIV.opportunityId, supportV.opportunityId]);
const collapsed = collapseLifecycleRecords([supportIV, supportV, aviationEnvironment]);
assert.equal(collapsed.length, 2);
const lifecycle = collapsed.find((record) => record.lifecycleMembers);
assert.deepEqual(lifecycle.lifecycleMembers.map((record) => record.reference), ["47QFAA24F0008", "47QFAA25F0006"]);
assert.equal(lifecycle.title, "NDMS software development support");

const ndmsDraft = automatedSamRecord({
  noticeId: "6e5fd58fa1c5435ab1d565a9a21bc2a0",
  solicitationNumber: "N6852026R1003",
  title: "Naval Air Systems Command (NAVAIR) Depot Maintenance System (NDMS) DRAFT Request for Proposal (RFP)",
  description: "Official SAM.gov notice description",
  noticeType: "Presolicitation",
  postedDate: "2026-09-03",
  responseDeadline: "2026-10-05",
  naicsCode: "541511",
  pscCode: "DA01",
  organizationPath: "DEPT OF DEFENSE.DEPT OF THE NAVY.NAVAIR.NAVAIR HQS.FLEET READINESS CENTER",
  sourceUrl: "https://sam.gov/workspace/contract/opp/6e5fd58fa1c5435ab1d565a9a21bc2a0/view",
}, "2026-10-02");
const supportVWithCodes = { ...supportV, naicsCode: "541511", pscCode: "DA01" };
const supportIVWithCodes = { ...supportIV, naicsCode: "541511", pscCode: "DA01" };
const followOn = exactFollowOnEvidence(supportVWithCodes, ndmsDraft);
assert.equal(followOn?.sourceId, supportV.opportunityId, "The active NDMS V work must be the predecessor");
assert.equal(followOn?.targetId, ndmsDraft.opportunityId, "The draft RFP must be the follow-on target");
assert.equal(followOn?.relationship, "follow-on");
assert.equal(exactFollowOnEvidence(supportIVWithCodes, ndmsDraft), null, "Expired NDMS IV work must not be linked as the active predecessor");
assert.equal(exactRecordGroupAssessment([supportVWithCodes, ndmsDraft])?.relationship, "follow-on", "Exact follow-ons must bypass the provider boundary");
assert.equal(exactRecordGroupAssessment([supportVWithCodes, ndmsDraft], { allowFollowOn: false }), null, "Follow-ons must remain separate records rather than collapse onto one lifecycle row");
assert.equal(exactRecordGroupAssessment([supportIV, supportV])?.confidence, "exact", "Exact lifecycle phases must bypass the provider boundary");
assert.equal(exactRecordGroupAssessment([supportIV, supportV, aviationEnvironment]), null, "Mixed requirements must still require model or manual review");
const relationships = automaticRecordRelationships([supportIVWithCodes, supportVWithCodes, aviationEnvironment, ndmsDraft]);
assert.equal(relationships.length, 2, "The record graph must expose both prior lifecycle work and the future follow-on");
assert.ok(relationships.some((relationship) => relationship.sourceId === supportIV.opportunityId && relationship.targetId === supportV.opportunityId && relationship.relationship === "successive-phase"));
assert.ok(relationships.some((relationship) => relationship.sourceId === supportV.opportunityId && relationship.targetId === ndmsDraft.opportunityId && relationship.relationship === "follow-on"));

const performanceFixture = Array.from({ length: 2_000 }, (_value, index) => ({
  opportunityId: `perf-${index}`,
  mode: "contract-performance",
  title: `Unrelated requirement ${index}`,
  party: `Recipient ${index}`,
  owner: `Owner ${index}`,
  contractingOffice: `Office ${index}`,
  start: "2025-01-01",
  currentEnd: "2026-01-01",
  sourceUrls: [`https://example.gov/CONT_AWD_TEST_${index}_PARENT_${index}`],
}));
const started = performance.now();
automaticLifecycleGroups([...performanceFixture, supportIV, supportV]);
assert.ok(performance.now() - started < 300, "Lifecycle grouping must remain indexed rather than quadratic for large timelines");

const request = buildRecordGroupAiRequest([supportIV, supportV]);
assert.equal(request.store, false);
assert.equal(request.text.format.type, "json_schema");
assert.equal(request.text.format.strict, true);
assert.ok(!JSON.stringify(request).includes("apiKey"));

let posted;
const result = await analyzeRecordGroupWithOpenAi({
  apiKey: "masked-test-key",
  records: [supportIV, supportV],
  fetchImpl: async (_url, options) => {
    posted = JSON.parse(options.body);
    return {
      ok: true,
      status: 200,
      headers: { get: () => "req-test" },
      json: async () => ({
        id: "resp-test",
        output_text: JSON.stringify({
          decision: "group",
          title: "NDMS software development support",
          relationship: "successive-phase",
          confidence: "high",
          rationale: "Same requirement, parent award, recipient, office, and contiguous phase dates.",
          evidence: ["Shared parent award 47QFAA21A0002", "One-day phase transition"],
          caveats: ["Distinct task-order awards remain separate source records"],
        }),
      }),
    };
  },
});
assert.equal(posted.store, false);
assert.equal(result.decision, "group");
assert.equal(result.provenance.reviewState, "accepted");
assert.equal(result.provenance.responseId, "resp-test");
assert.deepEqual(result.memberIds, [supportIV.opportunityId, supportV.opportunityId]);
assert.equal(result.provenance.attempts, 1);

let retryAttempts = 0;
const retryResult = await analyzeRecordGroupWithOpenAi({
  apiKey: "masked-test-key", records: [supportIV, supportV],
  fetchImpl: async () => {
    retryAttempts += 1;
    if (retryAttempts === 1) return { ok: true, status: 200, json: async () => ({ output_text: "{malformed" }) };
    return { ok: true, status: 200, json: async () => ({ id: "resp-retry", output_text: JSON.stringify({
      decision: "group", title: "NDMS software development support", relationship: "successive-phase", confidence: "high",
      rationale: "Same requirement and contiguous phases.", evidence: ["Shared parent award"], caveats: [],
    }) }) };
  },
});
assert.equal(retryAttempts, 2, "Malformed lifecycle output must receive one bounded retry");
assert.equal(retryResult.provenance.attempts, 2);

console.log("Record lifecycle linking contract passed");
