import assert from "node:assert/strict";
import {
  EVENT_AI_PROPOSAL_SCHEMA,
  EVENT_AI_VERIFICATION_SCHEMA,
  buildEventAiProducerRequest,
  buildEventAiVerifierRequest,
  citedEventAiDetails,
  eventAiEvidenceDiagnostic,
  eventAiProviderError,
  isRetryableEventAiError,
  mergeVerifiedEventDraft,
  resolveEventAiVerificationOutcome,
  normalizeEventAiDetails,
  parseOpenAiStructuredResponse,
  retrieveOpenAiResponse,
} from "../src/event-ai-runtime.js";
import { eventDateTimeInputValue, normalizeEventDate } from "../src/event-date-input.js";
import {
  MOCK_EVENT_AI_MODELS,
  assertEventAiModels,
  chooseEventAiModel,
  eventAiModelCandidates,
  normalizeOpenAiModels,
} from "../src/openai-models.js";

const normalizedModels = normalizeOpenAiModels({ data: [
  { id: "text-embedding-3-large", created: 3, owned_by: "openai" },
  { id: "gpt-5.4", created: 2, owned_by: "openai" },
  { id: "gpt-5.4-mini", created: 1, owned_by: "openai" },
] });
assert.deepEqual(eventAiModelCandidates(normalizedModels).map((model) => model.id), ["gpt-5.4", "gpt-5.4-mini"]);
assert.equal(chooseEventAiModel(normalizedModels, "gpt-5.4-mini"), "gpt-5.4-mini");
assert.equal(chooseEventAiModel(MOCK_EVENT_AI_MODELS), "gpt-5.4");
assert.doesNotThrow(() => assertEventAiModels(normalizedModels, "gpt-5.4", "gpt-5.4-mini"));
assert.throws(() => assertEventAiModels(normalizedModels, "gpt-5.6-terra", "gpt-5.4"), /not available to the selected OpenAI credential/i);
assert.equal(eventDateTimeInputValue("2027-01-11"), "2027-01-11T00:00", "Date-only review drafts must hydrate the native datetime input");
assert.equal(eventDateTimeInputValue("2027-01-11T08:30"), "2027-01-11T08:30", "Local event times must retain their published wall time");
assert.equal(normalizeEventDate("2027-01-11T08:30:00-05:00"), "2027-01-11T13:30:00.000Z", "Offset event times must normalize before persistence");

function assertStrictObjects(schema, path = "schema") {
  if (!schema || typeof schema !== "object") return;
  if (schema.type === "object") {
    assert.equal(schema.additionalProperties, false, `${path} must reject unknown keys`);
    assert.deepEqual([...schema.required].sort(), Object.keys(schema.properties).sort(), `${path} must require every declared key`);
  }
  for (const [key, value] of Object.entries(schema.properties || {})) assertStrictObjects(value, `${path}.${key}`);
  if (schema.items) assertStrictObjects(schema.items, `${path}[]`);
}

assertStrictObjects(EVENT_AI_PROPOSAL_SCHEMA, "proposal");
assertStrictObjects(EVENT_AI_VERIFICATION_SCHEMA, "verification");

const request = buildEventAiProducerRequest({
  draft: { title: "Industry day", startsAt: "", attendeeIds: ["user-1"], recordIds: ["record-1"], status: "scheduled", wallboard: true },
  direction: "Find the official venue and registration deadline.",
  categories: [{ id: "industry-day", name: "Industry day" }],
});
assert.equal(request.background, true);
assert.equal(request.store, true, "Background responses must remain resumable until DBI accepts and deletes each stage");
assert.equal(request.tools[0].type, "web_search");
assert.equal(request.tools[0].search_context_size, "low", "Event lookup should use the bounded web-search context");
assert.equal(request.tool_choice, "required", "Evidence-gated research must force at least one web-search tool call");
assert.equal(request.reasoning.effort, "low", "Event lookup must prefer bounded low-effort reasoning over deep research latency");
assert.deepEqual(request.include, ["web_search_call.action.sources"], "Research must retain the provider's consulted-source inventory");
assert.equal(request.text.format.strict, true);
assert.doesNotMatch(request.input, /attendees|displayName|avatar/i, "Provider input must omit human profile data");

const verifierRequest = buildEventAiVerifierRequest({
  draft: { title: "Industry day", startsAt: "2027-06-01T09:00" },
  proposal: {},
  direction: "Verify only additive event details.",
  categories: [{ id: "industry-day", name: "Industry day" }],
});
assert.equal(verifierRequest.reasoning.effort, "low", "Verification must not repeat event research at high reasoning effort");
assert.equal(verifierRequest.tools[0].search_context_size, "low", "Verification should use bounded search context");
assert.equal(verifierRequest.tool_choice, "auto", "Verification must inspect pinned evidence without requiring a second search");
assert.match(verifierRequest.instructions, /no more than two focused searches/i, "Verification must have a bounded fallback search scope");
assert.match(verifierRequest.instructions, /pinned evidence/i, "Verification must receive and prioritize the producer's retained evidence");
assert.match(verifierRequest.instructions, /not a rejected claim/i, "Merge conflicts must remain distinct from factual rejection");

let retrievedUrl = "";
await retrieveOpenAiResponse("verification-key", "resp_background", async (url, options) => {
  retrievedUrl = String(url);
  assert.equal(options.method, "GET");
  assert.equal(options.headers.authorization, "Bearer verification-key");
  return {
    ok: true,
    headers: new Headers({ "x-request-id": "req_retrieve" }),
    json: async () => ({ id: "resp_background", status: "completed", output: [] }),
  };
});
const retrievedQuery = new URL(retrievedUrl).searchParams;
assert.equal(retrievedQuery.has("include"), false, "Background response retrieval must not collapse the include array into a scalar query parameter");
assert.deepEqual(retrievedQuery.getAll("include[]"), ["web_search_call.action.sources"], "Background response retrieval must encode the consulted-source inventory as an array");

const sourceUrl = "https://example.gov/events/industry-day";
const details = normalizeEventAiDetails({
  title: "Industry day",
  startsAt: "2027-06-01T09:00",
  endsAt: "",
  location: "Mission center",
  notes: "Published event details.",
  links: [{ label: "Official page", url: sourceUrl }],
  milestones: [],
  categoryNames: ["Industry day"],
  evidence: [
    { field: "startsAt", value: "2027-06-01T09:00", confidence: "high", sourceUrls: [sourceUrl] },
    { field: "location", value: "Mission center", confidence: "high", sourceUrls: [sourceUrl] },
    { field: "notes", value: "Published event details.", confidence: "medium", sourceUrls: [sourceUrl] },
    { field: "links", value: sourceUrl, confidence: "high", sourceUrls: [sourceUrl] },
    { field: "categories", value: "Industry day", confidence: "medium", sourceUrls: [sourceUrl] },
  ],
  sources: [{ url: sourceUrl, title: "Industry day", publisher: "Example.gov" }],
  caveats: [],
});
const providerResponse = {
  status: "completed",
  output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(details), annotations: [{ type: "url_citation", url: sourceUrl }] }] }],
};
const parsed = parseOpenAiStructuredResponse(providerResponse, normalizeEventAiDetails);
const cited = citedEventAiDetails(providerResponse, parsed, { title: "Industry day", startsAt: "", attendeeIds: ["user-1"], recordIds: ["record-1"] });
assert.equal(cited.location, "Mission center");
assert.equal(cited.sources.length, 1);

const unsupportedMatchUrl = "https://unsupported.example/contracts/guess";
const intelligenceDetails = normalizeEventAiDetails({
  ...details,
  intelligence: {
    sponsor: "Example acquisition office", branch: "Joint", confidence: "medium", lastVerifiedAt: "2026-09-22",
    contacts: [{ name: "Public event office", role: "Coordinator", organization: "Example.gov", email: "", phone: "", url: sourceUrl, sourceUrls: [sourceUrl] }],
    opportunityMatches: [{ id: "opp-1", title: "Official opportunity", kind: "solicitation", sourceUrl, reason: "The notice names the same office and mission topic.", confidence: "high" }],
    contractMatches: [{ id: "contract-guess", title: "Unsupported contract", kind: "contract", sourceUrl: unsupportedMatchUrl, reason: "Plausible but uncited.", confidence: "low" }],
  },
  evidence: [...details.evidence, { field: "intelligence", value: "Sponsor, contact, and acquisition matches", confidence: "medium", sourceUrls: [sourceUrl] }],
});
const citedIntelligence = citedEventAiDetails(providerResponse, intelligenceDetails, {});
assert.equal(citedIntelligence.intelligence.opportunityMatches.length, 1, "A match whose source is in provider evidence may proceed to independent verification");
assert.equal(citedIntelligence.intelligence.contacts.length, 1, "Public contacts must retain a provider-grounded source");
assert.equal(citedIntelligence.intelligence.contractMatches.length, 0, "A plausible match with an unsupported URL must not enter the verified draft");
assert.ok(citedIntelligence.reviewClaims.some((claim) => claim.field === "intelligence"), "Unsupported intelligence subclaims must remain visible for review");

const consultedSourceResponse = {
  status: "completed",
  output: [
    { type: "web_search_call", status: "completed", action: { type: "search", query: "official industry day schedule", sources: [{ type: "url", url: sourceUrl }] } },
    { type: "message", content: [{ type: "output_text", text: JSON.stringify(details), annotations: [] }] },
  ],
};
const consultedSourceDiagnostic = eventAiEvidenceDiagnostic(consultedSourceResponse, details);
assert.equal(consultedSourceDiagnostic.webSearchCallCount, 1);
assert.equal(consultedSourceDiagnostic.searchSourceCount, 1);
assert.equal(consultedSourceDiagnostic.citationAnnotationCount, 0);
assert.deepEqual(consultedSourceDiagnostic.searchQueries, ["official industry day schedule"], "Bounded provider search queries must be retained for the task activity chain");
assert.equal(consultedSourceDiagnostic.matchedSourceCount, 1);
assert.equal(citedEventAiDetails(consultedSourceResponse, details, {}).sources.length, 1, "Consulted web-search sources must satisfy provenance even when strict JSON output has no inline annotation slots");

const merged = mergeVerifiedEventDraft({
  title: "Industry day", startsAt: "", location: "", notes: "Operator note", attendeeIds: ["user-1"], teamIds: ["team-1"], recordIds: ["record-1"], status: "scheduled", wallboard: true,
}, cited, [{ id: "industry-day", name: "Industry day" }]);
assert.equal(merged.mergedDraft.startsAt, "2027-06-01T09:00");
assert.equal(merged.mergedDraft.location, "Mission center");
assert.equal(merged.mergedDraft.notes, "Operator note", "Operator-entered notes must not be overwritten");
assert.deepEqual(merged.mergedDraft.attendeeIds, ["user-1"]);
assert.deepEqual(merged.mergedDraft.teamIds, ["team-1"], "Review drafts must preserve team visibility through direct save");
assert.deepEqual(merged.mergedDraft.recordIds, ["record-1"]);
assert.deepEqual(merged.mergedDraft.categoryIds, ["industry-day"]);
assert.equal(merged.conflicts.some((conflict) => conflict.field === "notes"), true, "Conflicting researched notes must be disclosed, not overwritten");

const partialOutcome = resolveEventAiVerificationOutcome({
  draft: { title: "Industry day", startsAt: "2027-06-01T09:00", location: "Operator venue", notes: "", links: [] },
  verification: {
    decision: "needs_review",
    approved: { ...cited, location: "Verified venue", notes: "Verified public summary." },
    rejectedClaims: [{ field: "endsAt", value: "agenda-derived", reason: "Not an event-wide timestamp" }],
  },
  categories: [{ id: "industry-day", name: "Industry day" }],
});
assert.equal(partialOutcome.status, "needs_review", "Material review decisions remain visible to the operator");
assert.equal(partialOutcome.mergeResult.mergedDraft.location, "Operator venue", "Partial review must preserve populated operator fields");
assert.equal(partialOutcome.mergeResult.mergedDraft.notes, "Verified public summary.", "Verified additive fields must survive a separate rejected claim");
assert.equal(partialOutcome.mergeResult.changes.includes("notes"), true, "A needs-review result must still expose safe additions");

const citationTransportGap = citedEventAiDetails({ status: "completed", output: [] }, details, {});
assert.deepEqual(citationTransportGap.acceptedFields, [], "Missing provider citation transport must not silently approve claims");
assert.equal(citationTransportGap.reviewClaims.length >= 5, true, "Plausible unmatched claims must remain available for operator review");
assert.equal(citationTransportGap.reviewSources.length, 1, "Unmatched structured sources must remain inspectable instead of failing the whole job");
const transportGapMerge = mergeVerifiedEventDraft({ title: "Industry day", startsAt: "", links: [] }, citationTransportGap, []);
assert.equal(transportGapMerge.changes.length, 0, "Ungrounded claims must not merge merely because the workflow no longer throws");

const secondaryUrl = "https://registration.example/events/industry-day";
const partialDetails = normalizeEventAiDetails({
  ...details,
  links: [{ label: "Official page", url: sourceUrl }, { label: "Registration", url: secondaryUrl }],
  evidence: [
    { field: "location", value: "Mission center", confidence: "high", sourceUrls: [sourceUrl] },
    { field: "links", value: sourceUrl, confidence: "high", sourceUrls: [sourceUrl] },
    { field: "links", value: secondaryUrl, confidence: "high", sourceUrls: [secondaryUrl] },
  ],
  sources: [
    { url: sourceUrl, title: "Industry day", publisher: "Example.gov" },
    { url: secondaryUrl, title: "Registration", publisher: "Registration provider" },
  ],
});
const partialGrounding = citedEventAiDetails(providerResponse, partialDetails, {});
assert.deepEqual(partialGrounding.acceptedFields, ["location", "links"], "Evidence acceptance must be claim-by-claim");
assert.equal(partialGrounding.reviewClaims.some((claim) => claim.field === "links"), true, "An unmatched claim must be retained for review without discarding a matched claim");
const partialGroundingMerge = mergeVerifiedEventDraft({ title: "Industry day", startsAt: "2027-06-01T09:00", location: "", links: [] }, partialGrounding, []);
assert.equal(partialGroundingMerge.mergedDraft.location, "Mission center");
assert.deepEqual(partialGroundingMerge.mergedDraft.links.map((link) => link.url), [sourceUrl], "A grounded link must merge without carrying an unmatched sibling link");

const samUrl = "https://sam.gov/opp/8a9e0e1c7edb489e86704a0d5365df86/view";
const samDetails = normalizeEventAiDetails({
  title: "NSWCDD A Department Industry Day",
  startsAt: "2026-09-29T08:00",
  endsAt: "2026-09-29T17:00",
  location: "University of Mary Washington-Dahlgren Campus, 4224 University Drive, King George, VA",
  notes: "NSWCDD A Department will hold an in-person Industry Day.",
  links: [{ label: "Official SAM.gov notice", url: samUrl }],
  milestones: [{ type: "registration_deadline", label: "Registration deadline", occursAt: "2026-09-22T17:00", notes: "Published in the official notice." }],
  categoryNames: ["Industry day"],
  evidence: [
    { field: "startsAt", value: "2026-09-29T08:00", confidence: "high", sourceUrls: [samUrl] },
    { field: "endsAt", value: "2026-09-29T17:00", confidence: "high", sourceUrls: [samUrl] },
    { field: "location", value: "University of Mary Washington-Dahlgren Campus", confidence: "high", sourceUrls: [samUrl] },
    { field: "notes", value: "In-person Industry Day", confidence: "high", sourceUrls: [samUrl] },
    { field: "links", value: samUrl, confidence: "high", sourceUrls: [samUrl] },
    { field: "milestones", value: "Registration deadline September 22 at 5:00 PM", confidence: "high", sourceUrls: [samUrl] },
    { field: "categories", value: "Industry day", confidence: "medium", sourceUrls: [samUrl] },
  ],
  sources: [{ url: samUrl, title: "Mission Assurance Services (A Dept.)", publisher: "SAM.gov" }],
  caveats: [],
});
const samProducerResponse = {
  status: "completed",
  output: [
    { type: "web_search_call", action: { type: "search", query: "site:sam.gov NSWCDD A Department Industry Day", sources: [{ type: "url", url: samUrl }] } },
    { type: "message", content: [{ type: "output_text", text: JSON.stringify(samDetails), annotations: [] }] },
  ],
};
const samProposal = citedEventAiDetails(samProducerResponse, samDetails, { title: "NSWCDD A Department Industry Day", startsAt: "", location: "Operator-entered venue", links: [], milestones: [] });
const samVerifierResponse = { status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify({}), annotations: [] }] }] };
const samApproved = citedEventAiDetails(samVerifierResponse, samDetails, { title: "NSWCDD A Department Industry Day", startsAt: "", location: "Operator-entered venue", links: [], milestones: [] }, { trustedSourceUrls: samProposal.groundedSourceUrls });
const samOutcome = resolveEventAiVerificationOutcome({
  draft: { title: "NSWCDD A Department Industry Day", startsAt: "", location: "Operator-entered venue", notes: "", links: [], milestones: [], categoryIds: [] },
  verification: {
    decision: "approved",
    approved: samApproved,
    checks: [{ name: "identity", passed: true, detail: "Pinned SAM notice describes the same event." }],
    rejectedClaims: [],
  },
  categories: [{ id: "industry-day", name: "Industry day" }],
});
assert.equal(samOutcome.status, "completed", "Pinned producer evidence must survive a verifier response with no duplicate citation annotations");
assert.equal(samOutcome.mergeResult.mergedDraft.location, "Operator-entered venue", "Pinned evidence must not overwrite operator data");
assert.equal(samOutcome.mergeResult.mergedDraft.links[0].url, samUrl);
assert.equal(samOutcome.mergeResult.mergedDraft.milestones[0].occursAt, "2026-09-22T17:00");
assert.equal(samOutcome.mergeResult.mergedDraft.notes, "NSWCDD A Department will hold an in-person Industry Day.");

const wrongEntityOutcome = resolveEventAiVerificationOutcome({
  draft: { title: "NSWCDD A Department Industry Day", startsAt: "", links: [] },
  verification: { decision: "rejected", approved: samApproved, checks: [{ name: "identity", passed: false, detail: "Wrong event." }] },
  categories: [],
});
assert.deepEqual(wrongEntityOutcome.mergeResult, {}, "An explicit wrong-event identity failure must remain fail-closed");
assert.throws(() => parseOpenAiStructuredResponse({ status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: "{malformed" }] }] }, normalizeEventAiDetails), /strict JSON parsing/i);

const rateLimitFailure = eventAiProviderError({
  id: "resp_failed_rate_limit",
  status: "failed",
  error: { code: "rate_limit_exceeded", message: "Project rate limit reached." },
}, "Research");
assert.equal(rateLimitFailure.code, "rate_limit_exceeded", "Terminal Responses must preserve the provider error code");
assert.equal(rateLimitFailure.message, "Project rate limit reached.", "Terminal Responses must preserve the provider safe error message");
assert.equal(rateLimitFailure.responseId, "resp_failed_rate_limit");
assert.equal(isRetryableEventAiError(rateLimitFailure), true, "Rate-limit and server failures must be marked retryable");

const genericFailure = eventAiProviderError({ id: "resp_failed_unknown", status: "failed", error: null }, "Verification");
assert.equal(genericFailure.code, "provider_failed");
assert.match(genericFailure.message, /Verification stage ended with provider status failed/i);
assert.equal(isRetryableEventAiError(genericFailure), false);

console.log("Verified strict event AI schemas, claim-level evidence, pinned producer sources, NSWCDD regression, malformed-output rejection, and deterministic non-destructive merge");
