import { OPPORTUNITY_CLUSTERS, SABRE_FIT_PROFILE, classifyOpportunityFit } from "./opportunity-fit.js";

export const OPPORTUNITY_AI_MODEL = "gpt-5.4-mini";

const clusterIds = OPPORTUNITY_CLUSTERS.map((cluster) => cluster.id);
const schema = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "capabilityClusters", "fitReasons", "risks", "recommendedAction", "caveats", "sourceUrls"],
  properties: {
    summary: { type: "string", maxLength: 800 },
    capabilityClusters: { type: "array", maxItems: 6, items: { type: "object", additionalProperties: false, required: ["id", "rationale", "confidence"], properties: { id: { type: "string", enum: clusterIds }, rationale: { type: "string", maxLength: 500 }, confidence: { type: "string", enum: ["high", "medium", "low"] } } } },
    fitReasons: { type: "array", maxItems: 8, items: { type: "string", maxLength: 500 } },
    risks: { type: "array", maxItems: 8, items: { type: "string", maxLength: 500 } },
    recommendedAction: { type: "string", enum: ["watch", "pursue", "research", "deprioritize"] },
    caveats: { type: "array", maxItems: 8, items: { type: "string", maxLength: 500 } },
    sourceUrls: { type: "array", maxItems: 4, items: { type: "string", maxLength: 2000 } },
  },
};

function responseText(response) {
  if (typeof response?.output_text === "string") return response.output_text;
  for (const item of Array.isArray(response?.output) ? response.output : []) {
    for (const content of Array.isArray(item?.content) ? item.content : []) if (content?.type === "output_text" && typeof content.text === "string") return content.text;
  }
  return "";
}

function safeHttpUrl(value) {
  try { const url = new URL(String(value || "")); return ["http:", "https:"].includes(url.protocol) ? url.toString() : ""; } catch { return ""; }
}

function clean(value, limit) { return String(value || "").trim().slice(0, limit); }

export function normalizeOpportunityAiAssessment(payload, record, { model = OPPORTUNITY_AI_MODEL, responseId = "", createdAt = new Date().toISOString() } = {}) {
  const allowedSource = safeHttpUrl(record?.sourceUrl);
  return {
    summary: clean(payload?.summary, 800),
    capabilityClusters: (Array.isArray(payload?.capabilityClusters) ? payload.capabilityClusters : []).filter((item) => clusterIds.includes(item?.id)).slice(0, 6).map((item) => ({ id: item.id, rationale: clean(item.rationale, 500), confidence: ["high", "medium", "low"].includes(item.confidence) ? item.confidence : "low" })),
    fitReasons: (Array.isArray(payload?.fitReasons) ? payload.fitReasons : []).map((item) => clean(item, 500)).filter(Boolean).slice(0, 8),
    risks: (Array.isArray(payload?.risks) ? payload.risks : []).map((item) => clean(item, 500)).filter(Boolean).slice(0, 8),
    recommendedAction: ["watch", "pursue", "research", "deprioritize"].includes(payload?.recommendedAction) ? payload.recommendedAction : "research",
    caveats: (Array.isArray(payload?.caveats) ? payload.caveats : []).map((item) => clean(item, 500)).filter(Boolean).slice(0, 8),
    sourceUrls: [...new Set((Array.isArray(payload?.sourceUrls) ? payload.sourceUrls : []).map(safeHttpUrl).filter((url) => url && (!allowedSource || url === allowedSource)))].slice(0, 4),
    provenance: { kind: "ai-derived", reviewState: "needs_review", model, responseId: clean(responseId, 180), createdAt, sourceUrl: allowedSource || null },
  };
}

export function buildOpportunityAiRequest(record, { model = OPPORTUNITY_AI_MODEL } = {}) {
  const deterministic = classifyOpportunityFit(record);
  return {
    model,
    store: false,
    reasoning: { effort: "low" },
    max_output_tokens: 1800,
    text: { format: { type: "json_schema", name: "opportunity_fit_assessment", strict: true, schema } },
    instructions: [
      "Analyze one official SAM.gov opportunity for a public capability profile.",
      "Use only the supplied SAM.gov record. Do not invent requirements, incumbent knowledge, eligibility, contract access, win probability, customer intent, or workshare.",
      "Separate published facts from assessment. Explain capability fit using exact title, scope, NAICS, PSC, organization, notice type, and deadline evidence when present.",
      "Return empty arrays and explicit caveats when the source record is insufficient.",
      `Allowed capability cluster IDs: ${clusterIds.join(", ")}.`,
      `Profile: ${SABRE_FIT_PROFILE.description}`,
    ].join(" "),
    input: JSON.stringify({ record, deterministicAssessment: deterministic }),
  };
}

export async function analyzeOpportunityWithOpenAi({ apiKey, record, fetchImpl = fetch, model = OPPORTUNITY_AI_MODEL } = {}) {
  if (!apiKey) return null;
  const response = await fetchImpl("https://api.openai.com/v1/responses", { method: "POST", headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" }, body: JSON.stringify(buildOpportunityAiRequest(record, { model })) });
  const requestId = response.headers.get("x-request-id") || response.headers.get("openai-request-id") || "";
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(clean(body?.error?.message || `OpenAI returned HTTP ${response.status}`, 500));
    error.code = clean(body?.error?.code || body?.error?.type || "provider_failed", 100);
    error.httpStatus = response.status;
    error.requestId = requestId;
    throw error;
  }
  let payload;
  try { payload = JSON.parse(responseText(body)); } catch { const error = new Error("OpenAI returned invalid structured output"); error.code = "invalid_structured_output"; throw error; }
  return normalizeOpportunityAiAssessment(payload, record, { model, responseId: body.id || "" });
}
