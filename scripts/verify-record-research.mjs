import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { automatedSamRecord } from "../src/procurement-taxonomy.js";
import { buildRecordResearchRequest, normalizeRecordResearch, rankResearchCandidates, researchRecordWithOpenAi } from "../src/record-research.js";

const capture = JSON.parse(readFileSync(resolve("src/data/capture-calendar.json"), "utf8"));
const supportV = { ...capture.records.find((record) => record.id === "C104"), naicsCode: "541511", pscCode: "DA01" };
const unrelated = capture.records.find((record) => record.id === "C106");
const ndmsDraft = automatedSamRecord({
  noticeId: "6e5fd58fa1c5435ab1d565a9a21bc2a0", solicitationNumber: "N6852026R1003",
  title: "Naval Air Systems Command (NAVAIR) Depot Maintenance System (NDMS) DRAFT Request for Proposal (RFP)",
  description: "Official SAM.gov notice description", noticeType: "Presolicitation", postedDate: "2026-09-03", responseDeadline: "2026-10-05",
  naicsCode: "541511", pscCode: "DA01", organizationPath: "DEPT OF DEFENSE.DEPT OF THE NAVY.NAVAIR.NAVAIR HQS.FLEET READINESS CENTER",
  sourceUrl: "https://sam.gov/workspace/contract/opp/6e5fd58fa1c5435ab1d565a9a21bc2a0/view",
}, "2026-10-02");

const candidates = rankResearchCandidates(ndmsDraft, [supportV, unrelated]);
assert.equal(candidates[0].opportunityId, supportV.opportunityId, "The active matching work must rank ahead of unrelated NDMS records");
const request = buildRecordResearchRequest(ndmsDraft, candidates);
assert.equal(request.store, false);
assert.equal(request.tool_choice, "required");
assert.equal(request.text.format.strict, true);
assert.deepEqual(request.tools[0].filters.allowed_domains.includes("sam.gov"), true);
assert.ok(!JSON.stringify(request).includes("masked-test-key"));

const consulted = [
  { url: ndmsDraft.sourceUrls[0], title: "SAM.gov draft RFP" },
  { url: supportV.sourceUrls[0], title: "USAspending active award" },
];
const payload = {
  summary: "The draft RFP is a follow-on to active NDMS work.", stage: "Draft RFP", scope: "Depot Maintenance System software support.", incumbentPosture: "The active award remains separately preserved.",
  findings: [{ text: "The program identity and published codes align.", sourceUrls: consulted.map((source) => source.url) }, { text: "Unsupported claim", sourceUrls: ["https://example.com/nope"] }],
  risks: [], openQuestions: ["Confirm the final RFP schedule."],
  relationshipProposals: [{ targetId: supportV.opportunityId, relationship: "predecessor", confidence: "high", rationale: "Matching NDMS identity, buyer, codes, and overlapping timing.", sourceUrls: consulted.map((source) => source.url), caveats: ["Distinct records"] }, { targetId: "missing", relationship: "related-workstream", confidence: "high", rationale: "No", sourceUrls: consulted.map((source) => source.url), caveats: [] }],
  caveats: ["Human review required."],
};
const normalized = normalizeRecordResearch(payload, ndmsDraft, candidates, { responseId: "resp-test", consultedSources: consulted });
assert.equal(normalized.findings.length, 1, "Unsupported citations must remove the claim");
assert.equal(normalized.relationshipProposals.length, 1, "Relationships may target only supplied candidates");
assert.equal(normalized.provenance.reviewState, "needs_review");

let posted;
const researched = await researchRecordWithOpenAi({
  apiKey: "masked-test-key", record: ndmsDraft, candidates,
  fetchImpl: async (_url, options) => {
    posted = JSON.parse(options.body);
    return { ok: true, status: 200, headers: { get: () => "req-test" }, json: async () => ({ id: "resp-test", output_text: JSON.stringify(payload), output: [
      { type: "web_search_call", action: { sources: consulted } },
      { type: "message", content: [{ type: "output_text", text: JSON.stringify(payload), annotations: consulted.map((source) => ({ type: "url_citation", url: source.url, title: source.title })) }] },
    ] }) };
  },
});
assert.equal(posted.store, false);
assert.equal(researched.relationshipProposals[0].targetId, supportV.opportunityId);
assert.equal(researched.sources.length, 2);

console.log("Record research contract passed");
