export const RECORD_LINKING_MODEL = "gpt-5.4-mini";

const ROMAN_PHASE = /\b(?:i|ii|iii|iv|v|vi|vii|viii|ix|x)\b/gi;
const SAFE_RELATIONSHIPS = new Set(["successive-phase", "follow-on", "same-requirement", "related-workstream"]);

function clean(value, limit = 500) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, limit);
}

function normalized(value) {
  return clean(value, 1000).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function dateDiffDays(start, end) {
  const left = Date.parse(`${start || ""}T00:00:00Z`);
  const right = Date.parse(`${end || ""}T00:00:00Z`);
  return Number.isFinite(left) && Number.isFinite(right) ? Math.round((right - left) / 86_400_000) : null;
}

function parentFromSourceUrl(value) {
  const match = String(value || "").match(/CONT_AWD_[^_/?]+_[^_/?]+_([^_/?]+)_[^/?]+/i);
  return clean(match?.[1], 180).toUpperCase();
}

export function recordParentReference(record) {
  return clean(record?.parentReference || record?.liveAward?.parentAwardId || (record?.sourceUrls || []).map(parentFromSourceUrl).find(Boolean), 180).toUpperCase();
}

export function lifecycleTitleStem(value) {
  return clean(value, 500)
    .replace(ROMAN_PHASE, " ")
    .replace(/\b(?:phase|option|task order|to)\s*\d+\b/gi, " ")
    .replace(/\s+/g, " ")
    .replace(/[\s/,:;-]+$/, "")
    .trim();
}

export function exactLifecycleEvidence(left, right) {
  if (!left?.opportunityId || !right?.opportunityId || left.opportunityId === right.opportunityId) return null;
  if (left.mode !== "contract-performance" || right.mode !== "contract-performance") return null;
  const earlier = String(left.start || "") <= String(right.start || "") ? left : right;
  const later = earlier === left ? right : left;
  const parent = recordParentReference(earlier);
  const laterParent = recordParentReference(later);
  const titleStem = lifecycleTitleStem(earlier.title);
  const laterTitleStem = lifecycleTitleStem(later.title);
  const gapDays = dateDiffDays(earlier.currentEnd || earlier.potentialEnd, later.start);
  const sameParent = Boolean(parent && parent === laterParent);
  const sameTitle = normalized(titleStem).length >= 12 && normalized(titleStem) === normalized(laterTitleStem);
  const sameParty = normalized(earlier.party).length >= 3 && normalized(earlier.party) === normalized(later.party);
  const sameOwner = normalized(earlier.owner).length >= 3 && normalized(earlier.owner) === normalized(later.owner);
  const sameOffice = normalized(earlier.contractingOffice).length >= 3 && normalized(earlier.contractingOffice) === normalized(later.contractingOffice);
  const contiguous = gapDays !== null && gapDays >= 0 && gapDays <= 31;
  if (!(sameParent && sameTitle && sameParty && contiguous && (sameOwner || sameOffice))) return null;
  return {
    title: titleStem,
    relationship: "successive-phase",
    confidence: "exact",
    basis: [
      `Shared parent award ${parent}`,
      `Same recipient ${clean(earlier.party, 180)}`,
      sameOwner ? `Same owner ${clean(earlier.owner, 180)}` : `Same contracting office ${clean(earlier.contractingOffice, 180)}`,
      `Matching requirement title with phase suffix removed`,
      gapDays === 0 ? "Successive performance terms meet on the same day" : `${gapDays}-day transition between reported terms`,
    ],
  };
}

export function automaticLifecycleGroups(records = []) {
  const claimed = new Set();
  const groups = [];
  const ordered = [...records].filter((record) => record?.opportunityId).sort((left, right) => String(left.start || "9999").localeCompare(String(right.start || "9999")));
  for (let leftIndex = 0; leftIndex < ordered.length; leftIndex += 1) {
    const left = ordered[leftIndex];
    if (claimed.has(left.opportunityId)) continue;
    for (let rightIndex = leftIndex + 1; rightIndex < ordered.length; rightIndex += 1) {
      const right = ordered[rightIndex];
      if (claimed.has(right.opportunityId)) continue;
      const evidence = exactLifecycleEvidence(left, right);
      if (!evidence) continue;
      const members = [left, right].sort((a, b) => String(a.start || "").localeCompare(String(b.start || "")));
      const memberIds = members.map((record) => record.opportunityId);
      groups.push({
        id: `auto:${memberIds.join("+")}`,
        title: evidence.title,
        memberIds,
        relationship: evidence.relationship,
        confidence: evidence.confidence,
        basis: evidence.basis,
        provenance: { kind: "exact-rule", reviewState: "accepted", model: null, createdAt: null },
        automatic: true,
      });
      memberIds.forEach((id) => claimed.add(id));
      break;
    }
  }
  return groups;
}

function commonValue(records, key, fallback = "") {
  const values = [...new Set(records.map((record) => clean(record?.[key], 500)).filter(Boolean))];
  return values.length === 1 ? values[0] : fallback;
}

function groupRecord(group, records) {
  const members = [...records].sort((left, right) => String(left.start || left.solicitationStart || "9999").localeCompare(String(right.start || right.solicitationStart || "9999")));
  const starts = members.map((record) => record.start || record.solicitationStart).filter(Boolean).sort();
  const currentEnds = members.map((record) => record.currentEnd || record.solicitationEnd).filter(Boolean).sort();
  const potentialEnds = members.map((record) => record.potentialEnd || record.currentEnd || record.solicitationEnd).filter(Boolean).sort();
  const current = members.find((record) => record.lifecycleStatus === "active-reported-term") || members.at(-1);
  return {
    ...current,
    opportunityId: `lifecycle:${group.id}`,
    id: `${members.length} records`,
    title: clean(group.title, 240) || lifecycleTitleStem(members.at(-1)?.title) || "Grouped lifecycle",
    party: commonValue(members, "party", "Multiple recipients"),
    owner: commonValue(members, "owner", "Multiple owners"),
    contractingOffice: commonValue(members, "contractingOffice", "Multiple offices"),
    reference: members.map((record) => record.reference).filter(Boolean).join(" → "),
    start: starts[0] || null,
    currentEnd: currentEnds.at(-1) || null,
    potentialEnd: potentialEnds.at(-1) || null,
    obligatedAmount: members.reduce((sum, record) => sum + Number(record.obligatedAmount || 0), 0),
    potentialAmount: members.reduce((sum, record) => sum + Number(record.potentialAmount || 0), 0),
    events: members.flatMap((record) => record.events || []),
    milestones: members.flatMap((record) => record.milestones || []),
    fiscalValues: [],
    fiscalActions: [],
    subawards: members.flatMap((record) => record.subawards || []),
    transactionSummary: { actions: members.reduce((sum, record) => sum + Number(record.transactionSummary?.actions || 0), 0) },
    lifecycleMembers: members,
    lifecycleGroup: group,
    lifecycleStatus: current?.lifecycleStatus || members.at(-1)?.lifecycleStatus,
    primaryOpportunityId: current?.opportunityId || members.at(-1)?.opportunityId,
  };
}

export function collapseLifecycleRecords(records = [], savedGroups = []) {
  const byId = new Map(records.map((record) => [record.opportunityId, record]));
  const claimed = new Set();
  const groups = [];
  const acceptedSaved = (Array.isArray(savedGroups) ? savedGroups : []).filter((group) => Array.isArray(group?.memberIds) && group.memberIds.length >= 2);
  for (const group of [...acceptedSaved, ...automaticLifecycleGroups(records)]) {
    const members = group.memberIds.map((id) => byId.get(id)).filter(Boolean);
    if (members.length < 2 || members.some((record) => claimed.has(record.opportunityId))) continue;
    members.forEach((record) => claimed.add(record.opportunityId));
    groups.push(groupRecord(group, members));
  }
  return [...records.filter((record) => !claimed.has(record.opportunityId)), ...groups]
    .sort((left, right) => String(left.start || left.solicitationStart || "9999").localeCompare(String(right.start || right.solicitationStart || "9999")) || left.title.localeCompare(right.title));
}

const recordGroupSchema = {
  type: "object",
  additionalProperties: false,
  required: ["decision", "title", "relationship", "confidence", "rationale", "evidence", "caveats"],
  properties: {
    decision: { type: "string", enum: ["group", "separate", "review"] },
    title: { type: "string", maxLength: 240 },
    relationship: { type: "string", enum: [...SAFE_RELATIONSHIPS] },
    confidence: { type: "string", enum: ["high", "medium", "low"] },
    rationale: { type: "string", maxLength: 1200 },
    evidence: { type: "array", maxItems: 10, items: { type: "string", maxLength: 500 } },
    caveats: { type: "array", maxItems: 8, items: { type: "string", maxLength: 500 } },
  },
};

function responseText(response) {
  if (typeof response?.output_text === "string") return response.output_text;
  for (const item of Array.isArray(response?.output) ? response.output : []) {
    for (const content of Array.isArray(item?.content) ? item.content : []) if (content?.type === "output_text" && typeof content.text === "string") return content.text;
  }
  return "";
}

export function recordLinkingInput(record) {
  return {
    opportunityId: clean(record?.opportunityId, 180),
    displayId: clean(record?.id, 80),
    title: clean(record?.title, 500),
    recipient: clean(record?.party, 300),
    owner: clean(record?.owner, 300),
    fundingOffice: clean(record?.fundingOffice, 300),
    contractingOffice: clean(record?.contractingOffice, 300),
    awardReference: clean(record?.reference, 180),
    parentReference: recordParentReference(record),
    start: clean(record?.start || record?.solicitationStart, 32),
    currentEnd: clean(record?.currentEnd || record?.solicitationEnd, 32),
    potentialEnd: clean(record?.potentialEnd, 32),
    workCategories: (record?.workCategories || []).map((value) => clean(value, 80)).filter(Boolean).slice(0, 8),
    context: clean(record?.context || record?.sourceDescription, 2000),
    sourceUrls: (record?.sourceUrls || []).map((value) => clean(value, 2000)).filter((value) => /^https?:\/\//i.test(value)).slice(0, 6),
  };
}

export function buildRecordGroupAiRequest(records, { model = RECORD_LINKING_MODEL } = {}) {
  return {
    model,
    store: false,
    reasoning: { effort: "low" },
    max_output_tokens: 1800,
    text: { format: { type: "json_schema", name: "record_lifecycle_group", strict: true, schema: recordGroupSchema } },
    instructions: [
      "Assess whether the supplied public federal procurement records belong on one non-destructive lifecycle timeline row.",
      "Group only when they are successive phases, follow-ons, or distinct award instruments for the same underlying requirement or workstream.",
      "Different award identifiers are expected and must be preserved. Similar acronyms alone are insufficient.",
      "Prioritize exact shared parent awards, recipient, buying organization, normalized requirement title, published scope, and contiguous performance dates.",
      "Return separate when the records are merely related programs or share only an organization, contractor, acronym, or broad capability.",
      "Return review when evidence is plausible but insufficient. Never invent predecessor links, parent awards, dates, or scope.",
      "The title must describe the shared lifecycle without a phase number.",
    ].join(" "),
    input: JSON.stringify({ records: records.map(recordLinkingInput) }),
  };
}

export function normalizeRecordGroupAiResult(payload, records, { model = RECORD_LINKING_MODEL, responseId = "", createdAt = new Date().toISOString() } = {}) {
  const decision = ["group", "separate", "review"].includes(payload?.decision) ? payload.decision : "review";
  const confidence = ["high", "medium", "low"].includes(payload?.confidence) ? payload.confidence : "low";
  return {
    decision,
    title: clean(payload?.title, 240) || lifecycleTitleStem(records.at(-1)?.title) || "Grouped lifecycle",
    relationship: SAFE_RELATIONSHIPS.has(payload?.relationship) ? payload.relationship : "related-workstream",
    confidence,
    rationale: clean(payload?.rationale, 1200),
    evidence: (Array.isArray(payload?.evidence) ? payload.evidence : []).map((value) => clean(value, 500)).filter(Boolean).slice(0, 10),
    caveats: (Array.isArray(payload?.caveats) ? payload.caveats : []).map((value) => clean(value, 500)).filter(Boolean).slice(0, 8),
    memberIds: records.map((record) => clean(record.opportunityId, 180)),
    provenance: { kind: "openai-review", reviewState: decision === "group" && confidence === "high" ? "accepted" : "needs_review", model, responseId: clean(responseId, 180), createdAt },
  };
}

export async function analyzeRecordGroupWithOpenAi({ apiKey, records, fetchImpl = fetch, model = RECORD_LINKING_MODEL } = {}) {
  if (!apiKey) throw Object.assign(new Error("No active workspace OpenAI credential is available"), { code: "credential_unavailable", httpStatus: 409 });
  const response = await fetchImpl("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body: JSON.stringify(buildRecordGroupAiRequest(records, { model })),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(clean(body?.error?.message || `OpenAI returned HTTP ${response.status}`, 500)), { code: clean(body?.error?.code || body?.error?.type || "provider_failed", 100), httpStatus: response.status });
  let payload;
  try { payload = JSON.parse(responseText(body)); }
  catch { throw Object.assign(new Error("OpenAI returned invalid structured lifecycle data"), { code: "invalid_structured_output", httpStatus: 502 }); }
  return normalizeRecordGroupAiResult(payload, records, { model, responseId: body.id || "" });
}
