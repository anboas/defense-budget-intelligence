import { normalizeEventIntelligence } from "./d1-event-store.js";

export const EVENT_AI_PRODUCER_MODEL = "gpt-5.4";
export const EVENT_AI_VERIFIER_MODEL = "gpt-5.4";
export const EVENT_AI_STATUSES = Object.freeze([
  "researching",
  "verifying",
  "completed",
  "needs_review",
  "failed",
  "cancelled",
]);

const RETRYABLE_PROVIDER_ERROR_CODES = new Set([
  "rate_limit_exceeded",
  "server_error",
  "vector_store_timeout",
]);

const MILESTONE_TYPES = [
  "registration_deadline",
  "refund_deadline",
  "hotel_deadline",
  "exhibitor_deadline",
  "submission_deadline",
  "other",
];

const EVENT_AI_EVIDENCE_FIELDS = ["title", "startsAt", "endsAt", "location", "notes", "links", "milestones", "categories", "intelligence"];

const evidenceSchema = {
  type: "object",
  additionalProperties: false,
  required: ["field", "value", "confidence", "sourceUrls"],
  properties: {
    field: { type: "string", enum: EVENT_AI_EVIDENCE_FIELDS },
    value: { type: "string", maxLength: 2000 },
    confidence: { type: "string", enum: ["high", "medium", "low"] },
    sourceUrls: { type: "array", maxItems: 8, items: { type: "string", maxLength: 2000 } },
  },
};

const intelligenceMatchSchema = {
  type: "object",
  additionalProperties: false,
  required: ["id", "title", "kind", "sourceUrl", "reason", "confidence"],
  properties: {
    id: { type: "string", maxLength: 180 }, title: { type: "string", maxLength: 240 }, kind: { type: "string", maxLength: 80 },
    sourceUrl: { type: "string", maxLength: 2000 }, reason: { type: "string", maxLength: 500 },
    confidence: { type: "string", enum: ["high", "medium", "low"] },
  },
};

const eventIntelligenceSchema = {
  type: "object",
  additionalProperties: false,
  required: ["seriesId", "timezone", "venue", "city", "region", "country", "format", "eventType", "branch", "sponsor", "topics", "capabilityAreas", "missionThreads", "stakeholders", "relatedPrograms", "engagementKinds", "contacts", "opportunityMatches", "contractMatches", "spendingMatches", "confidence", "lastVerifiedAt"],
  properties: {
    seriesId: { type: "string", maxLength: 120 }, timezone: { type: "string", maxLength: 80 }, venue: { type: "string", maxLength: 240 },
    city: { type: "string", maxLength: 120 }, region: { type: "string", maxLength: 80 }, country: { type: "string", maxLength: 120 },
    format: { type: "string", maxLength: 40 }, eventType: { type: "string", maxLength: 80 }, branch: { type: "string", maxLength: 120 }, sponsor: { type: "string", maxLength: 180 },
    topics: { type: "array", maxItems: 20, items: { type: "string", maxLength: 120 } },
    capabilityAreas: { type: "array", maxItems: 20, items: { type: "string", maxLength: 120 } },
    missionThreads: { type: "array", maxItems: 20, items: { type: "string", maxLength: 120 } },
    stakeholders: { type: "array", maxItems: 30, items: { type: "string", maxLength: 160 } },
    relatedPrograms: { type: "array", maxItems: 20, items: { type: "string", maxLength: 160 } },
    engagementKinds: { type: "array", maxItems: 12, items: { type: "string", maxLength: 120 } },
    contacts: {
      type: "array", maxItems: 20, items: { type: "object", additionalProperties: false,
        required: ["name", "role", "organization", "email", "phone", "url", "sourceUrls"],
        properties: { name: { type: "string", maxLength: 160 }, role: { type: "string", maxLength: 160 }, organization: { type: "string", maxLength: 180 }, email: { type: "string", maxLength: 240 }, phone: { type: "string", maxLength: 80 }, url: { type: "string", maxLength: 2000 }, sourceUrls: { type: "array", maxItems: 8, items: { type: "string", maxLength: 2000 } } },
      },
    },
    opportunityMatches: { type: "array", maxItems: 30, items: intelligenceMatchSchema },
    contractMatches: { type: "array", maxItems: 30, items: intelligenceMatchSchema },
    spendingMatches: { type: "array", maxItems: 30, items: intelligenceMatchSchema },
    confidence: { type: "string", enum: ["high", "medium", "low"] }, lastVerifiedAt: { type: "string", maxLength: 32 },
  },
};

const eventDetailsSchema = {
  type: "object",
  additionalProperties: false,
  required: ["title", "startsAt", "endsAt", "location", "notes", "links", "milestones", "categoryNames", "intelligence", "evidence", "sources", "caveats"],
  properties: {
    title: { type: "string", maxLength: 180 },
    startsAt: { type: "string", maxLength: 32 },
    endsAt: { type: "string", maxLength: 32 },
    location: { type: "string", maxLength: 500 },
    notes: { type: "string", maxLength: 4000 },
    links: {
      type: "array",
      maxItems: 12,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["label", "url"],
        properties: {
          label: { type: "string", maxLength: 120 },
          url: { type: "string", maxLength: 2000 },
        },
      },
    },
    milestones: {
      type: "array",
      maxItems: 24,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["type", "label", "occursAt", "notes"],
        properties: {
          type: { type: "string", enum: MILESTONE_TYPES },
          label: { type: "string", maxLength: 120 },
          occursAt: { type: "string", maxLength: 32 },
          notes: { type: "string", maxLength: 500 },
        },
      },
    },
    categoryNames: { type: "array", maxItems: 8, items: { type: "string", maxLength: 80 } },
    intelligence: eventIntelligenceSchema,
    evidence: { type: "array", maxItems: 40, items: evidenceSchema },
    sources: {
      type: "array",
      maxItems: 20,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["url", "title", "publisher"],
        properties: {
          url: { type: "string", maxLength: 2000 },
          title: { type: "string", maxLength: 240 },
          publisher: { type: "string", maxLength: 160 },
        },
      },
    },
    caveats: { type: "array", maxItems: 20, items: { type: "string", maxLength: 500 } },
  },
};

export const EVENT_AI_PROPOSAL_SCHEMA = Object.freeze(eventDetailsSchema);
export const EVENT_AI_VERIFICATION_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: ["decision", "approved", "checks", "rejectedClaims", "mergeNotes"],
  properties: {
    decision: { type: "string", enum: ["approved", "needs_review", "rejected"] },
    approved: eventDetailsSchema,
    checks: {
      type: "array",
      minItems: 5,
      maxItems: 12,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "passed", "detail"],
        properties: {
          name: { type: "string", enum: ["identity", "dates", "location", "links", "milestones", "categories", "intelligence", "evidence", "merge_safety"] },
          passed: { type: "boolean" },
          detail: { type: "string", maxLength: 500 },
        },
      },
    },
    rejectedClaims: {
      type: "array",
      maxItems: 30,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["field", "value", "reason"],
        properties: {
          field: { type: "string", maxLength: 80 },
          value: { type: "string", maxLength: 1000 },
          reason: { type: "string", maxLength: 500 },
        },
      },
    },
    mergeNotes: { type: "array", maxItems: 20, items: { type: "string", maxLength: 500 } },
  },
});

function cleanText(value, limit) {
  return Array.from(String(value ?? ""), (character) => {
    const code = character.charCodeAt(0);
    return code < 32 || code === 127 ? " " : character;
  }).join("").trim().slice(0, limit);
}

function cleanDate(value) {
  const text = cleanText(value, 32);
  if (!text) return "";
  return /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d{3})?)?Z?)?$/.test(text) ? text : "";
}

function cleanHttpUrl(value) {
  const text = cleanText(value, 2000);
  if (!text) return "";
  try {
    const url = new URL(text);
    return ["http:", "https:"].includes(url.protocol) ? url.toString() : "";
  } catch {
    return "";
  }
}

function unique(items, key) {
  const seen = new Set();
  return items.filter((item) => {
    const value = key(item);
    return value && !seen.has(value) && seen.add(value);
  });
}

function stableSuffix(value) {
  let hash = 2166136261;
  for (const character of String(value || "")) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  return (hash >>> 0).toString(36);
}

function milestoneIdentity(milestone = {}) {
  return `${milestone.type || "other"}|${milestone.occursAt || ""}|${String(milestone.label || "").toLowerCase()}`;
}

export function normalizeEventAiDraft(value = {}) {
  return {
    id: cleanText(value.id, 180),
    title: cleanText(value.title, 180),
    startsAt: cleanDate(value.startsAt),
    endsAt: cleanDate(value.endsAt),
    location: cleanText(value.location, 500),
    notes: cleanText(value.notes, 4000),
    status: ["scheduled", "completed", "cancelled"].includes(value.status) ? value.status : "scheduled",
    recordIds: unique((Array.isArray(value.recordIds) ? value.recordIds : []).map((item) => cleanText(item, 180)), (item) => item).slice(0, 50),
    attendeeIds: unique((Array.isArray(value.attendeeIds) ? value.attendeeIds : []).map((item) => cleanText(item, 80)), (item) => item).slice(0, 30),
    attendees: [],
    links: unique((Array.isArray(value.links) ? value.links : []).map((link, index) => ({
      id: cleanText(link?.id, 100) || `link-${index + 1}`,
      label: cleanText(link?.label, 120),
      url: cleanHttpUrl(link?.url),
    })).filter((link) => link.url), (link) => link.url).slice(0, 12),
    milestones: unique((Array.isArray(value.milestones) ? value.milestones : []).map((milestone, index) => ({
      id: cleanText(milestone?.id, 100) || `milestone-${index + 1}`,
      type: MILESTONE_TYPES.includes(milestone?.type) ? milestone.type : "other",
      label: cleanText(milestone?.label, 120),
      occursAt: cleanDate(milestone?.occursAt),
      notes: cleanText(milestone?.notes, 500),
    })).filter((milestone) => milestone.occursAt && (milestone.type !== "other" || milestone.label)), (milestone) => `${milestone.type}|${milestone.occursAt}|${milestone.label.toLowerCase()}`).slice(0, 24),
    categoryIds: unique((Array.isArray(value.categoryIds) ? value.categoryIds : []).map((item) => cleanText(item, 80)), (item) => item).slice(0, 8),
    intelligence: normalizeEventIntelligence(value.intelligence || {}),
    wallboard: value.wallboard !== false,
    version: Number.isFinite(Number(value.version)) ? Number(value.version) : 0,
  };
}

export function normalizeEventAiDetails(value = {}) {
  const sourceUrls = new Set();
  const sources = unique((Array.isArray(value.sources) ? value.sources : []).map((source) => {
    const url = cleanHttpUrl(source?.url);
    if (url) sourceUrls.add(url);
    return { url, title: cleanText(source?.title, 240), publisher: cleanText(source?.publisher, 160) };
  }).filter((source) => source.url), (source) => source.url).slice(0, 20);
  const evidence = (Array.isArray(value.evidence) ? value.evidence : []).map((entry) => ({
    field: EVENT_AI_EVIDENCE_FIELDS.includes(entry?.field) ? entry.field : "notes",
    value: cleanText(entry?.value, 2000),
    confidence: ["high", "medium", "low"].includes(entry?.confidence) ? entry.confidence : "low",
    sourceUrls: unique((Array.isArray(entry?.sourceUrls) ? entry.sourceUrls : []).map(cleanHttpUrl).filter(Boolean), (item) => item).slice(0, 8),
  })).filter((entry) => entry.value && entry.sourceUrls.length).slice(0, 40);
  const internal = {};
  if (Array.isArray(value.acceptedFields)) {
    internal.acceptedFields = unique(value.acceptedFields.map((field) => EVENT_AI_EVIDENCE_FIELDS.includes(field) ? field : "").filter(Boolean), (field) => field);
  }
  if (Array.isArray(value.acceptedLinkUrls)) {
    internal.acceptedLinkUrls = unique(value.acceptedLinkUrls.map(cleanHttpUrl).filter(Boolean), (url) => citationKey(url)).slice(0, 12);
  }
  if (Array.isArray(value.acceptedMilestoneKeys)) {
    internal.acceptedMilestoneKeys = unique(value.acceptedMilestoneKeys.map((key) => cleanText(key, 400)).filter(Boolean), (key) => key).slice(0, 24);
  }
  if (Array.isArray(value.acceptedCategoryNames)) {
    internal.acceptedCategoryNames = unique(value.acceptedCategoryNames.map((name) => cleanText(name, 80)).filter(Boolean), (name) => name.toLowerCase()).slice(0, 8);
  }
  if (Array.isArray(value.groundedSourceUrls)) {
    internal.groundedSourceUrls = unique(value.groundedSourceUrls.map(cleanHttpUrl).filter(Boolean), (url) => citationKey(url)).slice(0, 40);
  }
  if (Array.isArray(value.reviewSources)) {
    internal.reviewSources = unique(value.reviewSources.map((source) => ({
      url: cleanHttpUrl(source?.url),
      title: cleanText(source?.title, 240),
      publisher: cleanText(source?.publisher, 160),
    })).filter((source) => source.url), (source) => citationKey(source.url)).slice(0, 20);
  }
  if (Array.isArray(value.reviewClaims)) {
    internal.reviewClaims = value.reviewClaims.map((claim) => ({
      field: EVENT_AI_EVIDENCE_FIELDS.includes(claim?.field) ? claim.field : "notes",
      value: cleanText(claim?.value, 2000),
      confidence: ["high", "medium", "low"].includes(claim?.confidence) ? claim.confidence : "low",
      sourceUrls: unique((Array.isArray(claim?.sourceUrls) ? claim.sourceUrls : []).map(cleanHttpUrl).filter(Boolean), (url) => citationKey(url)).slice(0, 8),
      reason: cleanText(claim?.reason, 500),
    })).filter((claim) => claim.value).slice(0, 40);
  }
  return {
    title: cleanText(value.title, 180),
    startsAt: cleanDate(value.startsAt),
    endsAt: cleanDate(value.endsAt),
    location: cleanText(value.location, 500),
    notes: cleanText(value.notes, 4000),
    links: unique((Array.isArray(value.links) ? value.links : []).map((link) => ({ label: cleanText(link?.label, 120), url: cleanHttpUrl(link?.url) })).filter((link) => link.url), (link) => link.url).slice(0, 12),
    milestones: unique((Array.isArray(value.milestones) ? value.milestones : []).map((milestone) => ({
      type: MILESTONE_TYPES.includes(milestone?.type) ? milestone.type : "other",
      label: cleanText(milestone?.label, 120),
      occursAt: cleanDate(milestone?.occursAt),
      notes: cleanText(milestone?.notes, 500),
    })).filter((milestone) => milestone.occursAt && (milestone.type !== "other" || milestone.label)), (milestone) => `${milestone.type}|${milestone.occursAt}|${milestone.label.toLowerCase()}`).slice(0, 24),
    categoryNames: unique((Array.isArray(value.categoryNames) ? value.categoryNames : []).map((item) => cleanText(item, 80)), (item) => item.toLowerCase()).slice(0, 8),
    intelligence: normalizeEventIntelligence(value.intelligence || {}),
    evidence,
    sources,
    caveats: unique((Array.isArray(value.caveats) ? value.caveats : []).map((item) => cleanText(item, 500)), (item) => item).slice(0, 20),
    citedSourceCount: sourceUrls.size,
    ...internal,
  };
}

function publicResearchSeed(draft) {
  const current = normalizeEventAiDraft(draft);
  return {
    title: current.title,
    startsAt: current.startsAt,
    endsAt: current.endsAt,
    location: current.location,
    notes: current.notes,
    links: current.links.map(({ label, url }) => ({ label, url })),
    milestones: current.milestones.map(({ type, label, occursAt, notes }) => ({ type, label, occursAt, notes })),
    intelligence: current.intelligence,
  };
}

export function buildEventAiProducerRequest({ draft, direction, categories, model = EVENT_AI_PRODUCER_MODEL }) {
  const normalizedDraft = publicResearchSeed(draft);
  const categoryNames = (Array.isArray(categories) ? categories : []).map((category) => cleanText(category?.name, 80)).filter(Boolean);
  return {
    model,
    background: true,
    store: true,
    reasoning: { effort: "low" },
    tools: [{ type: "web_search", search_context_size: "low" }],
    tool_choice: "required",
    include: ["web_search_call.action.sources"],
    text: { format: { type: "json_schema", name: "event_enrichment_proposal", strict: true, schema: EVENT_AI_PROPOSAL_SCHEMA } },
    instructions: [
      "You research public event information for Defense Budget Intelligence.",
      "Return only facts supported by public HTTP(S) sources. Do not infer dates, venues, links, deadlines, attendees, or categories.",
      "Prefer an official organizer, government, venue, or registration source over aggregators.",
      "Use no more than four focused web searches. Stop once the event identity and the requested missing details are supported.",
      "Focus on empty fields and additive links, milestones, categories, notes, and structured event intelligence. Never propose replacing a populated operator field.",
      "Event intelligence may include branch, sponsor, format, venue, topics, capability areas, mission threads, stakeholders, public professional contacts, and cited public opportunity, contract, or spending matches.",
      "Every contact must be explicitly public and professional and must include at least one supporting source URL. Never infer private contact information.",
      "Only return exact event-wide start or end timestamps when an official source publishes them; never derive them from the earliest or latest agenda item.",
      "Use empty strings and empty arrays when a field cannot be verified.",
      "Never add people, workspace records, internal status, or wallboard settings.",
      "Every non-empty researched field must have an evidence entry with at least one source URL.",
    ].join(" "),
    input: JSON.stringify({ task: "Research and augment this event draft", draft: normalizedDraft, allowedCategoryNames: categoryNames, direction: cleanText(direction, 2000) || "Fill missing verified public event details and published deadlines." }),
  };
}

export function buildEventAiVerifierRequest({ draft, proposal, direction, categories, model = EVENT_AI_VERIFIER_MODEL }) {
  return {
    model,
    background: true,
    store: true,
    reasoning: { effort: "low" },
    tools: [{ type: "web_search", search_context_size: "low" }],
    tool_choice: "auto",
    include: ["web_search_call.action.sources"],
    text: { format: { type: "json_schema", name: "event_enrichment_verification", strict: true, schema: EVENT_AI_VERIFICATION_SCHEMA } },
    instructions: [
      "You are the independent verification stage for an event-enrichment workflow.",
      "Verify only the producer's proposed claims against its retained evidence bundle and the supplied original draft; do not repeat open-ended event research.",
      "Treat the proposal's grounded sources as pinned evidence. Do not require those sources to reappear in a new search result or citation annotation.",
      "Use web search only when pinned evidence is ambiguous or incomplete, and use no more than two focused searches.",
      "Reject unsupported facts, malformed dates, non-HTTP(S) links, event-identity mismatches, and invented deadlines.",
      "Preserve operator-entered values. Approve only additive fields that can merge without overwriting the original draft.",
      "The approved object must retain every independently verified additive fact, even when another claim is rejected or needs review. Use empty values only for unsupported claims.",
      "Rejected claims are factually unsupported, malformed, or wrong-event claims. A verified value that merely conflicts with a populated operator field is a preserved merge conflict, not a rejected claim.",
      "Choose approved when the event identity is sound and at least one verified additive fact is usable. Choose needs_review only for a material identity or factual conflict, and rejected only for the wrong event or no usable evidence.",
    ].join(" "),
    input: JSON.stringify({ task: "Verify the proposal and its merge safety", originalDraft: publicResearchSeed(draft), producerProposal: normalizeEventAiDetails(proposal), allowedCategoryNames: (categories || []).map((category) => category.name), direction: cleanText(direction, 2000) }),
  };
}

export async function startOpenAiBackgroundResponse(apiKey, body, fetchImpl = fetch) {
  const startedAt = Date.now();
  const response = await fetchImpl("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload?.id) {
    const error = new Error(cleanText(payload?.error?.message, 500) || `OpenAI request failed with HTTP ${response.status}`);
    error.code = cleanText(payload?.error?.code || payload?.error?.type, 120) || `http_${response.status}`;
    error.httpStatus = response.status;
    throw error;
  }
  return { response: payload, latencyMs: Date.now() - startedAt, requestId: response.headers.get("x-request-id") || "" };
}

export async function retrieveOpenAiResponse(apiKey, responseId, fetchImpl = fetch) {
  const startedAt = Date.now();
  const responseUrl = new URL(`https://api.openai.com/v1/responses/${encodeURIComponent(responseId)}`);
  responseUrl.searchParams.append("include[]", "web_search_call.action.sources");
  const response = await fetchImpl(responseUrl, {
    method: "GET",
    headers: { authorization: `Bearer ${apiKey}` },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(cleanText(payload?.error?.message, 500) || `OpenAI response lookup failed with HTTP ${response.status}`);
    error.code = cleanText(payload?.error?.code || payload?.error?.type, 120) || `http_${response.status}`;
    error.httpStatus = response.status;
    throw error;
  }
  return { response: payload, latencyMs: Date.now() - startedAt, requestId: response.headers.get("x-request-id") || "" };
}

export function eventAiProviderError(response, stage = "Provider") {
  const status = cleanText(response?.status, 40) || "failed";
  const providerCode = cleanText(response?.error?.code, 120);
  const providerMessage = cleanText(response?.error?.message, 500);
  const error = new Error(providerMessage || `${cleanText(stage, 80) || "Provider"} stage ended with provider status ${status}.`);
  error.code = providerCode || `provider_${status}`;
  error.retryable = RETRYABLE_PROVIDER_ERROR_CODES.has(error.code);
  error.providerStatus = status;
  error.responseId = cleanText(response?.id, 180);
  return error;
}

export function isRetryableEventAiError(error) {
  return Boolean(error?.retryable || [408, 409, 429, 500, 502, 503, 504].includes(Number(error?.httpStatus || 0)) || RETRYABLE_PROVIDER_ERROR_CODES.has(cleanText(error?.code, 120)));
}

export async function deleteOpenAiResponse(apiKey, responseId, fetchImpl = fetch) {
  if (!responseId) return false;
  const response = await fetchImpl(`https://api.openai.com/v1/responses/${encodeURIComponent(responseId)}`, {
    method: "DELETE",
    headers: { authorization: `Bearer ${apiKey}` },
  });
  return response.ok;
}

export function parseOpenAiStructuredResponse(response, normalizer) {
  if (!response || response.status !== "completed") return null;
  for (const output of response.output || []) {
    if (output?.type !== "message") continue;
    for (const content of output.content || []) {
      if (content?.type === "refusal") {
        const error = new Error(cleanText(content.refusal, 500) || "The model refused the request.");
        error.code = "model_refusal";
        throw error;
      }
      if (content?.type !== "output_text" || !content.text) continue;
      let parsed;
      try { parsed = JSON.parse(content.text); } catch {
        const error = new Error("The provider returned output that failed strict JSON parsing.");
        error.code = "invalid_structured_output";
        throw error;
      }
      return normalizer(parsed);
    }
  }
  const error = new Error("The provider completed without a structured result.");
  error.code = "missing_structured_output";
  throw error;
}

function citationKey(value) {
  const cleaned = cleanHttpUrl(value);
  if (!cleaned) return "";
  const url = new URL(cleaned);
  url.hash = "";
  if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, "");
  return url.toString();
}

function providerEvidenceContext(response) {
  const citationUrls = new Set();
  const searchSourceUrls = new Set();
  const searchQueries = new Set();
  const outputItemTypes = new Set();
  const webSearchActionTypes = new Set();
  let annotationCount = 0;
  let webSearchCallCount = 0;
  let messageCount = 0;
  let outputTextCount = 0;
  for (const output of response?.output || []) {
    if (output?.type) outputItemTypes.add(cleanText(output.type, 80));
    if (output?.type === "web_search_call") {
      webSearchCallCount += 1;
      if (output?.action?.type) webSearchActionTypes.add(cleanText(output.action.type, 80));
      for (const query of [output?.action?.query, ...(Array.isArray(output?.action?.queries) ? output.action.queries : [])]) {
        const cleaned = cleanText(query, 500);
        if (cleaned) searchQueries.add(cleaned);
      }
      for (const source of output?.action?.sources || []) {
        const url = citationKey(source?.url);
        if (url) searchSourceUrls.add(url);
      }
    }
    if (output?.type === "message") messageCount += 1;
    for (const content of output?.content || []) {
      if (content?.type === "output_text") outputTextCount += 1;
      for (const annotation of content?.annotations || []) {
        annotationCount += 1;
        const url = citationKey(annotation?.url || annotation?.url_citation?.url);
        if (url) citationUrls.add(url);
      }
    }
  }
  return {
    citationUrls,
    searchSourceUrls,
    searchQueries,
    providerUrls: new Set([...citationUrls, ...searchSourceUrls]),
    outputItemTypes,
    webSearchActionTypes,
    annotationCount,
    webSearchCallCount,
    messageCount,
    outputTextCount,
  };
}

export function eventAiEvidenceDiagnostic(response, details = {}) {
  const context = providerEvidenceContext(response);
  const normalized = normalizeEventAiDetails(details);
  const structuredSourceUrls = normalized.sources.map((source) => citationKey(source.url)).filter(Boolean);
  const structuredEvidenceUrls = normalized.evidence.flatMap((entry) => entry.sourceUrls.map(citationKey)).filter(Boolean);
  const matchedSourceUrls = structuredSourceUrls.filter((url) => context.providerUrls.has(url));
  const matchedEvidenceUrls = structuredEvidenceUrls.filter((url) => context.providerUrls.has(url));
  return {
    outputItemTypes: [...context.outputItemTypes],
    webSearchActionTypes: [...context.webSearchActionTypes],
    webSearchCallCount: context.webSearchCallCount,
    searchSourceCount: context.searchSourceUrls.size,
    citationAnnotationCount: context.citationUrls.size,
    annotationCount: context.annotationCount,
    messageCount: context.messageCount,
    outputTextCount: context.outputTextCount,
    structuredSourceCount: structuredSourceUrls.length,
    structuredEvidenceCount: normalized.evidence.length,
    matchedSourceCount: new Set(matchedSourceUrls).size,
    matchedEvidenceCount: new Set(matchedEvidenceUrls).size,
    searchSourceUrls: [...context.searchSourceUrls].slice(0, 20),
    searchQueries: [...context.searchQueries].slice(0, 20),
    citationUrls: [...context.citationUrls].slice(0, 20),
    matchedSourceUrls: [...new Set(matchedSourceUrls)].slice(0, 20),
  };
}

export function citedEventAiDetails(response, details, original = {}, options = {}) {
  const normalized = normalizeEventAiDetails(details);
  const originalDraft = normalizeEventAiDraft(original);
  const context = providerEvidenceContext(response);
  const trustedSourceUrls = new Set([
    ...context.providerUrls,
    ...(Array.isArray(options.trustedSourceUrls) ? options.trustedSourceUrls.map(citationKey).filter(Boolean) : []),
  ]);
  const sources = normalized.sources.filter((source) => trustedSourceUrls.has(citationKey(source.url)));
  const reviewSources = normalized.sources.filter((source) => !trustedSourceUrls.has(citationKey(source.url)));
  const evidence = [];
  const reviewClaims = [...(normalized.reviewClaims || [])];
  const acceptedFields = new Set();
  for (const entry of normalized.evidence) {
    const groundedUrls = entry.sourceUrls.filter((url) => trustedSourceUrls.has(citationKey(url)));
    if (groundedUrls.length && ["high", "medium"].includes(entry.confidence)) {
      evidence.push({ ...entry, sourceUrls: groundedUrls });
      acceptedFields.add(entry.field);
    } else {
      reviewClaims.push({
        ...entry,
        reason: groundedUrls.length
          ? "Low-confidence claim retained for operator review."
          : "Claim source was not present in the provider evidence transport or pinned producer evidence.",
      });
    }
  }
  const proposedIntelligence = normalized.intelligence || normalizeEventIntelligence({});
  const groundedContacts = (proposedIntelligence.contacts || []).map((contact) => ({
    ...contact,
    sourceUrls: (contact.sourceUrls || []).filter((url) => trustedSourceUrls.has(citationKey(url))),
  })).filter((contact) => contact.sourceUrls.length);
  const groundedMatches = (field) => (proposedIntelligence[field] || []).filter((match) => trustedSourceUrls.has(citationKey(match.sourceUrl)));
  const intelligenceValues = normalizeEventIntelligence({
    ...proposedIntelligence,
    contacts: groundedContacts,
    opportunityMatches: groundedMatches("opportunityMatches"),
    contractMatches: groundedMatches("contractMatches"),
    spendingMatches: groundedMatches("spendingMatches"),
  });
  const droppedIntelligenceClaims = (proposedIntelligence.contacts?.length || 0) - groundedContacts.length
    + ["opportunityMatches", "contractMatches", "spendingMatches"].reduce((total, field) => total + (proposedIntelligence[field]?.length || 0) - groundedMatches(field).length, 0);
  if (droppedIntelligenceClaims > 0) reviewClaims.push({
    field: "intelligence", value: `${droppedIntelligenceClaims} contact or acquisition match claim${droppedIntelligenceClaims === 1 ? "" : "s"}`,
    confidence: "low", sourceUrls: [], reason: "The cited URL was not present in the provider evidence transport or pinned producer evidence.",
  });
  const hasIntelligence = ["seriesId", "timezone", "venue", "city", "region", "country", "format", "eventType", "branch", "sponsor", "lastVerifiedAt"]
    .some((field) => Boolean(intelligenceValues[field]))
    || ["topics", "capabilityAreas", "missionThreads", "stakeholders", "relatedPrograms", "engagementKinds", "contacts", "opportunityMatches", "contractMatches", "spendingMatches"]
      .some((field) => Boolean(intelligenceValues[field]?.length));
  const candidateValues = {
    title: normalized.title,
    startsAt: normalized.startsAt,
    endsAt: normalized.endsAt,
    location: normalized.location,
    notes: normalized.notes,
    links: normalized.links.map((link) => `${link.label || "Link"}: ${link.url}`).join("\n"),
    milestones: normalized.milestones.map((milestone) => `${milestone.label || milestone.type}: ${milestone.occursAt}`).join("\n"),
    categories: normalized.categoryNames.join(", "),
    intelligence: hasIntelligence ? JSON.stringify(intelligenceValues) : "",
  };
  for (const field of EVENT_AI_EVIDENCE_FIELDS) {
    if (!candidateValues[field] || acceptedFields.has(field) || reviewClaims.some((claim) => claim.field === field)) continue;
    if (["title", "startsAt", "endsAt", "location", "notes"].includes(field) && originalDraft[field] === normalized[field]) continue;
    reviewClaims.push({ field, value: candidateValues[field], confidence: "low", sourceUrls: [], reason: "Structured claim did not include claim-level evidence." });
  }
  const groundedSourceUrls = unique([
    ...sources.map((source) => source.url),
    ...evidence.flatMap((entry) => entry.sourceUrls),
  ], (url) => citationKey(url)).slice(0, 40);
  const groundedEvidenceFor = (field) => evidence.filter((entry) => entry.field === field);
  const claimMatchesText = (entry, value) => {
    const needle = String(value || "").toLowerCase();
    return Boolean(needle && (entry.value.toLowerCase().includes(needle) || entry.sourceUrls.some((url) => citationKey(url) === citationKey(value))));
  };
  const acceptedLinkUrls = normalized.links.filter((link) => {
    const entries = groundedEvidenceFor("links");
    return entries.some((entry) => claimMatchesText(entry, link.url)) || (normalized.links.length === 1 && entries.length === 1);
  }).map((link) => link.url);
  const acceptedMilestoneKeys = normalized.milestones.filter((milestone) => {
    const entries = groundedEvidenceFor("milestones");
    return entries.some((entry) => claimMatchesText(entry, milestone.occursAt) || (milestone.label && claimMatchesText(entry, milestone.label)))
      || (normalized.milestones.length === 1 && entries.length === 1);
  }).map(milestoneIdentity);
  const acceptedCategoryNames = normalized.categoryNames.filter((name) => groundedEvidenceFor("categories").some((entry) => claimMatchesText(entry, name)));
  const transportCaveat = reviewClaims.length
    ? ["Some proposed claims remain available for review because their citation transport was incomplete."]
    : [];
  return {
    ...normalized,
    intelligence: intelligenceValues,
    evidence,
    sources,
    reviewSources,
    reviewClaims,
    acceptedFields: [...acceptedFields],
    acceptedLinkUrls,
    acceptedMilestoneKeys,
    acceptedCategoryNames,
    groundedSourceUrls,
    caveats: unique([...normalized.caveats, ...transportCaveat], (item) => item).slice(0, 20),
    citedSourceCount: sources.length,
  };
}

export function mergeVerifiedEventDraft(original, approved, categories = []) {
  const current = normalizeEventAiDraft(original);
  const verified = normalizeEventAiDetails(approved);
  const acceptedFields = Array.isArray(approved?.acceptedFields) ? new Set(verified.acceptedFields || []) : null;
  const accepts = (field) => !acceptedFields || acceptedFields.has(field);
  const acceptedLinkUrls = Array.isArray(approved?.acceptedLinkUrls) ? new Set(verified.acceptedLinkUrls || []) : null;
  const acceptedMilestoneKeys = Array.isArray(approved?.acceptedMilestoneKeys) ? new Set(verified.acceptedMilestoneKeys || []) : null;
  const acceptedCategoryNames = Array.isArray(approved?.acceptedCategoryNames) ? new Set((verified.acceptedCategoryNames || []).map((name) => name.toLowerCase())) : null;
  const conflicts = [];
  const fill = (field) => {
    if (!accepts(field)) return current[field];
    if (!verified[field]) return current[field];
    if (current[field] && current[field] !== verified[field]) {
      conflicts.push({ field, current: current[field], proposed: verified[field] });
      return current[field];
    }
    return current[field] || verified[field];
  };
  const links = unique([
    ...current.links,
    ...(accepts("links") ? verified.links.filter((link) => !acceptedLinkUrls || acceptedLinkUrls.has(link.url)) : []).map((link, index) => ({ id: `ai-link-${index + 1}-${stableSuffix(link.url)}`, ...link })),
  ], (link) => link.url).slice(0, 12);
  const milestones = unique([
    ...current.milestones,
    ...(accepts("milestones") ? verified.milestones.filter((milestone) => !acceptedMilestoneKeys || acceptedMilestoneKeys.has(milestoneIdentity(milestone))) : []).map((milestone, index) => ({ id: `ai-milestone-${index + 1}-${stableSuffix(milestoneIdentity(milestone))}`, ...milestone })),
  ], (milestone) => `${milestone.type}|${milestone.occursAt}|${milestone.label.toLowerCase()}`).slice(0, 24);
  const categoryByName = new Map((categories || []).map((category) => [String(category.name || "").toLowerCase(), category.id]));
  const categoryIds = unique([
    ...current.categoryIds,
    ...(accepts("categories") ? verified.categoryNames.filter((name) => !acceptedCategoryNames || acceptedCategoryNames.has(name.toLowerCase())) : []).map((name) => categoryByName.get(name.toLowerCase())).filter(Boolean),
  ], (item) => item).slice(0, 8);
  const mergeIntelligence = () => {
    const currentIntelligence = current.intelligence || normalizeEventIntelligence({});
    if (!accepts("intelligence")) return currentIntelligence;
    const proposed = verified.intelligence || normalizeEventIntelligence({});
    const scalarFields = ["seriesId", "timezone", "venue", "city", "region", "country", "format", "eventType", "branch", "sponsor"];
    const next = { ...currentIntelligence };
    for (const field of scalarFields) {
      if (currentIntelligence[field] && proposed[field] && currentIntelligence[field] !== proposed[field]) {
        conflicts.push({ field: `intelligence.${field}`, current: currentIntelligence[field], proposed: proposed[field] });
      } else if (!currentIntelligence[field] && proposed[field]) next[field] = proposed[field];
    }
    for (const field of ["topics", "capabilityAreas", "missionThreads", "stakeholders", "relatedPrograms", "engagementKinds"]) {
      next[field] = unique([...(currentIntelligence[field] || []), ...(proposed[field] || [])], (item) => item.toLowerCase());
    }
    next.contacts = unique([...(currentIntelligence.contacts || []), ...(proposed.contacts || [])], (item) => `${item.name.toLowerCase()}|${item.organization.toLowerCase()}|${item.email.toLowerCase()}`);
    for (const field of ["opportunityMatches", "contractMatches", "spendingMatches"]) {
      next[field] = unique([...(currentIntelligence[field] || []), ...(proposed[field] || [])], (item) => `${item.kind}|${item.id}`);
    }
    next.sources = unique([...(currentIntelligence.sources || []), ...verified.sources.map((source) => ({ ...source, kind: "official", confidence: "medium", lastVerifiedAt: proposed.lastVerifiedAt || "" }))], (source) => source.url);
    next.caveats = unique([...(currentIntelligence.caveats || []), ...(verified.caveats || [])], (item) => item);
    if (!currentIntelligence.lastVerifiedAt && proposed.lastVerifiedAt) next.lastVerifiedAt = proposed.lastVerifiedAt;
    if ((!currentIntelligence.confidence || currentIntelligence.confidence === "low") && proposed.confidence) next.confidence = proposed.confidence;
    return normalizeEventIntelligence(next);
  };
  const intelligence = mergeIntelligence();
  const mergedDraft = normalizeEventAiDraft({
    ...current,
    title: fill("title"),
    startsAt: fill("startsAt"),
    endsAt: fill("endsAt"),
    location: fill("location"),
    notes: fill("notes"),
    links,
    milestones,
    categoryIds,
    intelligence,
  });
  const changes = ["title", "startsAt", "endsAt", "location", "notes"].filter((field) => !current[field] && Boolean(mergedDraft[field]));
  if (links.length > current.links.length) changes.push("links");
  if (milestones.length > current.milestones.length) changes.push("milestones");
  if (categoryIds.length > current.categoryIds.length) changes.push("categories");
  if (JSON.stringify(intelligence) !== JSON.stringify(current.intelligence)) changes.push("intelligence");
  return { mergedDraft, changes, conflicts, reviewRequired: conflicts.length > 0 };
}

export function resolveEventAiVerificationOutcome({ draft, verification, categories = [] }) {
  const decision = ["approved", "needs_review", "rejected"].includes(verification?.decision) ? verification.decision : "rejected";
  const identityCheck = (verification?.checks || []).find((check) => check?.name === "identity");
  const mayMerge = decision !== "rejected" || identityCheck?.passed === true;
  const mergeResult = mayMerge ? mergeVerifiedEventDraft(draft, verification?.approved || {}, categories) : {};
  const unresolvedClaims = normalizeEventAiDetails(verification?.approved || {}).reviewClaims || [];
  const complete = decision === "approved" && unresolvedClaims.length === 0 && Boolean(mergeResult.mergedDraft?.title && mergeResult.mergedDraft?.startsAt);
  return {
    mergeResult,
    status: complete ? "completed" : "needs_review",
    currentStep: complete ? "operator_review" : "review_required",
  };
}

export function mockEventAiProposal(draft, categories = []) {
  const current = normalizeEventAiDraft(draft);
  return normalizeEventAiDetails({
    title: current.title,
    startsAt: current.startsAt,
    endsAt: current.endsAt,
    location: current.location || "Verified test venue",
    notes: current.notes || "Verified public event summary.",
    links: current.links.length ? current.links : [{ label: "Official event page", url: "https://example.gov/events/verified-event" }],
    milestones: current.milestones,
    categoryNames: categories[0]?.name ? [categories[0].name] : [],
    evidence: [{ field: "location", value: current.location || "Verified test venue", confidence: "high", sourceUrls: ["https://example.gov/events/verified-event"] }],
    sources: [{ url: "https://example.gov/events/verified-event", title: "Verified event", publisher: "Example.gov" }],
    caveats: [],
  });
}

export function mockEventAiVerification(proposal) {
  return {
    decision: "approved",
    approved: normalizeEventAiDetails(proposal),
    checks: ["identity", "dates", "location", "links", "evidence", "merge_safety"].map((name) => ({ name, passed: true, detail: `${name} verified in deterministic test mode.` })),
    rejectedClaims: [],
    mergeNotes: ["Only missing fields and deduplicated collections may be merged."],
  };
}
