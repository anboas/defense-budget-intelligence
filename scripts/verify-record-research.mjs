import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { automatedSamRecord } from "../src/procurement-taxonomy.js";
import { buildRecordResearchRequest, deleteRecordResearchResponse, normalizeRecordResearch, pollRecordResearchWithOpenAi, rankResearchCandidates, researchRecordWithOpenAi, shouldRetainPriorResearch, startRecordResearchWithOpenAi } from "../src/record-research.js";

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
assert.equal(request.tools[0].filters, undefined, "Research discovery must search broadly before the official .gov/.mil evidence gate");
assert.ok(!JSON.stringify(request).includes("masked-test-key"));

const consulted = [
  { url: ndmsDraft.sourceUrls[0], title: "SAM.gov draft RFP" },
  { url: supportV.sourceUrls[0], title: "USAspending active award" },
];
const sensitiveProviderUrl = `${ndmsDraft.sourceUrls[0]}?api_key=sensitive-source-token&utm_source=provider&noticeid=retained`;
const payload = {
  researchDisposition: "verified",
  summary: "The draft RFP is a follow-on to active NDMS work.", stage: "Draft RFP", scope: "Depot Maintenance System software support.", incumbentPosture: "The active award remains separately preserved.",
  decisionBrief: { recommendedAction: "pursue", priority: "high", rationale: "The published draft and active predecessor support immediate qualification.", sourceUrls: consulted.map((source) => source.url) },
  keyDates: [{ eventType: "proposal-deadline", label: "Response deadline", date: "2026-10-05", basis: "Published SAM.gov response deadline.", confidence: "high", sourceUrls: [consulted[0].url] }],
  timelineAssessment: { status: "corroborated", rationale: "The SAM.gov response deadline corroborates the retained date.", sourceUrls: [consulted[0].url] },
  nextActions: [{ action: "Review the draft RFP attachments.", rationale: "Confirm scope and qualification requirements before shaping.", sourceUrls: [consulted[0].url] }],
  findings: [{ text: "The program identity and published codes align.", sourceUrls: consulted.map((source) => source.url) }, { text: "Unsupported claim", sourceUrls: ["https://example.com/nope"] }],
  risks: [], openQuestions: ["Confirm the final RFP schedule."],
  relationshipProposals: [{ targetId: supportV.opportunityId, relationship: "predecessor", confidence: "high", rationale: "Matching NDMS identity, buyer, codes, and overlapping timing.", sourceUrls: consulted.map((source) => source.url), caveats: ["Distinct records"] }, { targetId: "missing", relationship: "related-workstream", confidence: "high", rationale: "No", sourceUrls: consulted.map((source) => source.url), caveats: [] }],
  caveats: ["Human review required."],
};
const normalized = normalizeRecordResearch(payload, ndmsDraft, candidates, { responseId: "resp-test", consultedSources: consulted });
assert.equal(normalized.findings.length, 1, "Unsupported citations must remove the claim");
assert.equal(normalized.relationshipProposals.length, 1, "Relationships may target only supplied candidates");
assert.equal(normalized.decisionBrief.recommendedAction, "pursue", "Research must produce a grounded operator recommendation");
assert.equal(normalized.keyDates[0].date, "2026-10-05", "Published decision dates must remain structured");
assert.equal(normalized.timelineAssessment.status, "corroborated", "Timeline validation must survive normalization");
assert.equal(normalized.nextActions.length, 1, "Grounded next actions must survive normalization");
assert.equal(normalized.provenance.reviewState, "needs_review");

const sanitized = normalizeRecordResearch({ ...payload, summary: `Sanitized official citation ${sensitiveProviderUrl}`, findings: [{ text: `Sanitized official citation ${sensitiveProviderUrl}`, sourceUrls: [sensitiveProviderUrl] }] }, ndmsDraft, candidates, {
  responseId: "resp-sanitized",
  consultedSources: [{ url: sensitiveProviderUrl, title: "SAM.gov result" }],
});
assert.equal(sanitized.findings.length, 1, "Sanitized provider citations must remain usable");
assert.equal(sanitized.sources[0].url.includes("noticeid=retained"), true, "Non-sensitive source identity parameters may be retained");
assert.doesNotMatch(JSON.stringify(sanitized), /api_key|utm_source|sensitive-source-token/i, "Research output must strip sensitive and tracking query parameters from source URLs");

let posted;
let attempts = 0;
const researched = await researchRecordWithOpenAi({
  apiKey: "masked-test-key", record: ndmsDraft, candidates,
  fetchImpl: async (_url, options) => {
    posted = JSON.parse(options.body);
    return { ok: true, status: 200, headers: { get: () => "req-test" }, json: async () => ({ id: "resp-test", output_text: `\`\`\`json\n${JSON.stringify(payload)}\n\`\`\``, output: [
      { type: "web_search_call", action: { sources: consulted } },
      { type: "message", content: [{ type: "output_text", text: JSON.stringify(payload), annotations: consulted.map((source) => ({ type: "url_citation", url: source.url, title: source.title })) }] },
    ] }) };
  },
});
assert.equal(posted.store, false);
assert.equal(researched.relationshipProposals[0].targetId, supportV.opportunityId);
assert.equal(researched.sources.length, 2);
assert.equal(researched.provenance.attempts, 1);

const retried = await researchRecordWithOpenAi({
  apiKey: "masked-test-key", record: ndmsDraft, candidates,
  fetchImpl: async (_url, options) => {
    attempts += 1;
    posted = JSON.parse(options.body);
    if (attempts === 1) return { ok: true, status: 200, json: async () => ({ id: "resp-malformed", output_text: "{malformed" }) };
    return { ok: true, status: 200, json: async () => ({ id: "resp-retry", output_text: JSON.stringify(payload), output: [
      { type: "web_search_call", action: { sources: consulted } },
      { type: "message", content: [{ type: "output_text", text: JSON.stringify(payload), annotations: consulted.map((source) => ({ type: "url_citation", url: source.url, title: source.title })) }] },
    ] }) };
  },
});
assert.equal(attempts, 2, "Malformed structured output must receive one bounded retry");
assert.equal(posted.reasoning.effort, "low", "The retry must reduce reasoning latency");
assert.equal(posted.tools[0].search_context_size, "high", "The recovery attempt must widen official-source discovery before preserving a prior verified brief");
assert.equal(retried.provenance.degradedRetry, true);

attempts = 0;
const completedAfterTruncation = await researchRecordWithOpenAi({
  apiKey: "masked-test-key", record: ndmsDraft, candidates,
  fetchImpl: async () => {
    attempts += 1;
    if (attempts === 1) return { ok: true, status: 200, json: async () => ({ id: "resp-truncated", status: "incomplete", incomplete_details: { reason: "max_output_tokens" }, output_text: "{\"summary\":" }) };
    return { ok: true, status: 200, json: async () => ({ id: "resp-complete", output_text: JSON.stringify(payload), output: [
      { type: "web_search_call", action: { sources: consulted } },
      { type: "message", content: [{ type: "output_text", text: JSON.stringify(payload), annotations: consulted.map((source) => ({ type: "url_citation", url: source.url, title: source.title })) }] },
    ] }) };
  },
});
assert.equal(attempts, 2, "A max-output truncation must receive one larger bounded retry");
assert.equal(completedAfterTruncation.provenance.degradedRetry, true);

let backgroundRequest;
const started = await startRecordResearchWithOpenAi({
  apiKey: "masked-test-key", record: ndmsDraft, candidates,
  fetchImpl: async (_url, options) => {
    backgroundRequest = JSON.parse(options.body);
    return { ok: true, status: 200, json: async () => ({ id: "resp-background", status: "queued" }) };
  },
});
assert.equal(started.responseId, "resp-background");
assert.equal(backgroundRequest.background, true, "Button-triggered research must return a resumable provider response instead of holding the browser request open");
assert.equal(backgroundRequest.store, false, "Background research must use temporary provider retention only");

let pendingUrl = "";
const pending = await pollRecordResearchWithOpenAi({ apiKey: "masked-test-key", responseId: started.responseId, record: ndmsDraft, candidates, fetchImpl: async (url) => { pendingUrl = url; return { ok: true, status: 200, json: async () => ({ id: started.responseId, status: "in_progress" }) }; } });
assert.equal(pending.status, "in_progress");
assert.doesNotMatch(pendingUrl, /include/, "In-progress polling must not expand web-search sources on every status check");
let completedPolls = 0;
const completed = await pollRecordResearchWithOpenAi({ apiKey: "masked-test-key", responseId: started.responseId, record: ndmsDraft, candidates, fetchImpl: async (_url) => { completedPolls += 1; return { ok: true, status: 200, json: async () => ({ id: started.responseId, status: "completed", output_text: JSON.stringify(payload), output: [
  { type: "web_search_call", action: { sources: consulted } },
  { type: "message", content: [{ type: "output_text", text: JSON.stringify(payload), annotations: consulted.map((source) => ({ type: "url_citation", url: source.url, title: source.title })) }] },
] }) }; } });
assert.equal(completedPolls, 2, "Completed research should expand source details only after the fast status check succeeds");
assert.equal(completed.report.keyDates[0].eventType, "proposal-deadline", "Completed background research must retain timeline-ready cited dates");
const retainedSourceCompletion = await pollRecordResearchWithOpenAi({ apiKey: "masked-test-key", responseId: started.responseId, record: ndmsDraft, candidates, fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ id: started.responseId, status: "completed", output_text: JSON.stringify(payload), output: [] }) }) });
assert.equal(retainedSourceCompletion.report.keyDates[0].date, "2026-10-05", "Supplied official record URLs must remain valid grounding when provider source expansion is unavailable");
assert.equal(shouldRetainPriorResearch({ code: "missing_citations" }, 1), false, "The first evidence-contract failure must receive a bounded retry");
assert.equal(shouldRetainPriorResearch({ code: "missing_citations" }, 2), true, "A second evidence-contract failure may retain the prior cited brief instead of breaking the button");
let deletedResponse = "";
assert.equal(await deleteRecordResearchResponse({ apiKey: "masked-test-key", responseId: started.responseId, fetchImpl: async (url, options) => { deletedResponse = `${options.method} ${url}`; return { ok: true }; } }), true);
assert.match(deletedResponse, /^DELETE .*resp-background$/, "Completed raw provider responses must be deleted after normalization");

console.log("Record research contract passed");
