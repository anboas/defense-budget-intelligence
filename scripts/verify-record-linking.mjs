import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  analyzeRecordGroupWithOpenAi,
  automaticLifecycleGroups,
  buildRecordGroupAiRequest,
  collapseLifecycleRecords,
  exactLifecycleEvidence,
} from "../src/record-linking.js";

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

console.log("Record lifecycle linking contract passed");
