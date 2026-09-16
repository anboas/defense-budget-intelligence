import assert from "node:assert/strict";
import {
  EVENT_AI_PROPOSAL_SCHEMA,
  EVENT_AI_VERIFICATION_SCHEMA,
  buildEventAiProducerRequest,
  citedEventAiDetails,
  eventAiEvidenceDiagnostic,
  eventAiProviderError,
  isRetryableEventAiError,
  mergeVerifiedEventDraft,
  normalizeEventAiDetails,
  parseOpenAiStructuredResponse,
  retrieveOpenAiResponse,
} from "../src/event-ai-runtime.js";
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
assert.equal(request.tool_choice, "required", "Evidence-gated research must force at least one web-search tool call");
assert.deepEqual(request.include, ["web_search_call.action.sources"], "Research must retain the provider's consulted-source inventory");
assert.equal(request.text.format.strict, true);
assert.doesNotMatch(request.input, /attendees|displayName|avatar/i, "Provider input must omit human profile data");

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
assert.equal(new URL(retrievedUrl).searchParams.get("include"), "web_search_call.action.sources", "Background response retrieval must request the consulted-source inventory again");

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

const consultedSourceResponse = {
  status: "completed",
  output: [
    { type: "web_search_call", status: "completed", action: { type: "search", sources: [{ type: "url", url: sourceUrl }] } },
    { type: "message", content: [{ type: "output_text", text: JSON.stringify(details), annotations: [] }] },
  ],
};
const consultedSourceDiagnostic = eventAiEvidenceDiagnostic(consultedSourceResponse, details);
assert.equal(consultedSourceDiagnostic.webSearchCallCount, 1);
assert.equal(consultedSourceDiagnostic.searchSourceCount, 1);
assert.equal(consultedSourceDiagnostic.citationAnnotationCount, 0);
assert.equal(consultedSourceDiagnostic.matchedSourceCount, 1);
assert.equal(citedEventAiDetails(consultedSourceResponse, details, {}).sources.length, 1, "Consulted web-search sources must satisfy provenance even when strict JSON output has no inline annotation slots");

const merged = mergeVerifiedEventDraft({
  title: "Industry day", startsAt: "", location: "", notes: "Operator note", attendeeIds: ["user-1"], recordIds: ["record-1"], status: "scheduled", wallboard: true,
}, cited, [{ id: "industry-day", name: "Industry day" }]);
assert.equal(merged.mergedDraft.startsAt, "2027-06-01T09:00");
assert.equal(merged.mergedDraft.location, "Mission center");
assert.equal(merged.mergedDraft.notes, "Operator note", "Operator-entered notes must not be overwritten");
assert.deepEqual(merged.mergedDraft.attendeeIds, ["user-1"]);
assert.deepEqual(merged.mergedDraft.recordIds, ["record-1"]);
assert.deepEqual(merged.mergedDraft.categoryIds, ["industry-day"]);
assert.equal(merged.conflicts.some((conflict) => conflict.field === "notes"), true, "Conflicting researched notes must be disclosed, not overwritten");

assert.throws(() => citedEventAiDetails({ status: "completed", output: [] }, details, {}), (error) => {
  assert.match(error.message, /without verifiable web-search citations/i);
  assert.equal(error.diagnostic.webSearchCallCount, 0);
  assert.equal(error.diagnostic.structuredSourceCount, 1);
  return true;
});
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

console.log("Verified strict event AI schemas, cited evidence, provider-failure diagnostics, malformed-output rejection, and deterministic non-destructive merge");
