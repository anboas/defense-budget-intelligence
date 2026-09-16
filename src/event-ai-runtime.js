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

const evidenceSchema = {
  type: "object",
  additionalProperties: false,
  required: ["field", "value", "confidence", "sourceUrls"],
  properties: {
    field: { type: "string", enum: ["title", "startsAt", "endsAt", "location", "notes", "links", "milestones", "categories"] },
    value: { type: "string", maxLength: 2000 },
    confidence: { type: "string", enum: ["high", "medium", "low"] },
    sourceUrls: { type: "array", maxItems: 8, items: { type: "string", maxLength: 2000 } },
  },
};

const eventDetailsSchema = {
  type: "object",
  additionalProperties: false,
  required: ["title", "startsAt", "endsAt", "location", "notes", "links", "milestones", "categoryNames", "evidence", "sources", "caveats"],
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
          name: { type: "string", enum: ["identity", "dates", "location", "links", "milestones", "categories", "evidence", "merge_safety"] },
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
    field: ["title", "startsAt", "endsAt", "location", "notes", "links", "milestones", "categories"].includes(entry?.field) ? entry.field : "notes",
    value: cleanText(entry?.value, 2000),
    confidence: ["high", "medium", "low"].includes(entry?.confidence) ? entry.confidence : "low",
    sourceUrls: unique((Array.isArray(entry?.sourceUrls) ? entry.sourceUrls : []).map(cleanHttpUrl).filter(Boolean), (item) => item).slice(0, 8),
  })).filter((entry) => entry.value && entry.sourceUrls.length).slice(0, 40);
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
    evidence,
    sources,
    caveats: unique((Array.isArray(value.caveats) ? value.caveats : []).map((item) => cleanText(item, 500)), (item) => item).slice(0, 20),
    citedSourceCount: sourceUrls.size,
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
  };
}

export function buildEventAiProducerRequest({ draft, direction, categories, model = EVENT_AI_PRODUCER_MODEL }) {
  const normalizedDraft = publicResearchSeed(draft);
  const categoryNames = (Array.isArray(categories) ? categories : []).map((category) => cleanText(category?.name, 80)).filter(Boolean);
  return {
    model,
    background: true,
    store: true,
    reasoning: { effort: "medium" },
    tools: [{ type: "web_search" }],
    text: { format: { type: "json_schema", name: "event_enrichment_proposal", strict: true, schema: EVENT_AI_PROPOSAL_SCHEMA } },
    instructions: [
      "You research public event information for Defense Budget Intelligence.",
      "Return only facts supported by public HTTP(S) sources. Do not infer dates, venues, links, deadlines, attendees, or categories.",
      "Prefer an official organizer, government, venue, or registration source over aggregators.",
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
    reasoning: { effort: "high" },
    tools: [{ type: "web_search" }],
    text: { format: { type: "json_schema", name: "event_enrichment_verification", strict: true, schema: EVENT_AI_VERIFICATION_SCHEMA } },
    instructions: [
      "You are the independent verification stage for an event-enrichment workflow.",
      "Re-check the producer proposal against public sources and the supplied original draft.",
      "Reject unsupported facts, malformed dates, non-HTTP(S) links, event-identity mismatches, and invented deadlines.",
      "Preserve operator-entered values. Approve only additive fields that can merge without overwriting the original draft.",
      "The approved object must contain only facts you independently verified. Use empty values for rejected or unverified claims.",
      "Choose needs_review when identity or material conflicts remain; choose rejected when the proposal is for the wrong event or lacks usable evidence.",
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
  const response = await fetchImpl(`https://api.openai.com/v1/responses/${encodeURIComponent(responseId)}`, {
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

export function citedEventAiDetails(response, details, original = {}) {
  const citations = new Set();
  for (const output of response?.output || []) {
    for (const content of output?.content || []) {
      for (const annotation of content?.annotations || []) {
        const url = cleanHttpUrl(annotation?.url || annotation?.url_citation?.url);
        if (url) citations.add(url);
      }
    }
  }
  if (!citations.size) {
    const error = new Error("The provider returned structured data without verifiable web-search citations.");
    error.code = "missing_citations";
    throw error;
  }
  const normalized = normalizeEventAiDetails(details);
  const sources = normalized.sources.filter((source) => citations.has(source.url));
  const evidence = normalized.evidence.map((entry) => ({ ...entry, sourceUrls: entry.sourceUrls.filter((url) => citations.has(url)) }))
    .filter((entry) => entry.sourceUrls.length);
  if (!sources.length || !evidence.length) {
    const error = new Error("The provider result did not bind its event claims to cited public sources.");
    error.code = "uncited_structured_output";
    throw error;
  }
  const originalDraft = normalizeEventAiDraft(original);
  const supported = new Set(evidence.filter((entry) => ["high", "medium"].includes(entry.confidence)).map((entry) => entry.field));
  const allowScalar = (field) => originalDraft[field] || supported.has(field) ? normalized[field] : "";
  return {
    ...normalized,
    title: allowScalar("title"),
    startsAt: allowScalar("startsAt"),
    endsAt: allowScalar("endsAt"),
    location: allowScalar("location"),
    notes: allowScalar("notes"),
    links: originalDraft.links.length || supported.has("links") ? normalized.links : [],
    milestones: originalDraft.milestones.length || supported.has("milestones") ? normalized.milestones : [],
    categoryNames: originalDraft.categoryIds.length || supported.has("categories") ? normalized.categoryNames : [],
    evidence,
    sources,
    citedSourceCount: sources.length,
  };
}

export function mergeVerifiedEventDraft(original, approved, categories = []) {
  const current = normalizeEventAiDraft(original);
  const verified = normalizeEventAiDetails(approved);
  const conflicts = [];
  const fill = (field) => {
    if (!verified[field]) return current[field];
    if (current[field] && current[field] !== verified[field]) {
      conflicts.push({ field, current: current[field], proposed: verified[field] });
      return current[field];
    }
    return current[field] || verified[field];
  };
  const links = unique([
    ...current.links,
    ...verified.links.map((link, index) => ({ id: `ai-link-${index + 1}-${stableSuffix(link.url)}`, ...link })),
  ], (link) => link.url).slice(0, 12);
  const milestones = unique([
    ...current.milestones,
    ...verified.milestones.map((milestone, index) => ({ id: `ai-milestone-${index + 1}-${stableSuffix(`${milestone.type}|${milestone.occursAt}|${milestone.label}`)}`, ...milestone })),
  ], (milestone) => `${milestone.type}|${milestone.occursAt}|${milestone.label.toLowerCase()}`).slice(0, 24);
  const categoryByName = new Map((categories || []).map((category) => [String(category.name || "").toLowerCase(), category.id]));
  const categoryIds = unique([
    ...current.categoryIds,
    ...verified.categoryNames.map((name) => categoryByName.get(name.toLowerCase())).filter(Boolean),
  ], (item) => item).slice(0, 8);
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
  });
  const changes = ["title", "startsAt", "endsAt", "location", "notes"].filter((field) => !current[field] && Boolean(mergedDraft[field]));
  if (links.length > current.links.length) changes.push("links");
  if (milestones.length > current.milestones.length) changes.push("milestones");
  if (categoryIds.length > current.categoryIds.length) changes.push("categories");
  return { mergedDraft, changes, conflicts, reviewRequired: conflicts.length > 0 };
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
