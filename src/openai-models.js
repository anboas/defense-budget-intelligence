const OPENAI_MODELS_URL = "https://api.openai.com/v1/models";

export const MOCK_EVENT_AI_MODELS = Object.freeze([
  { id: "gpt-5.4", created: 1782864000, ownedBy: "openai", shutdownDate: null },
  { id: "gpt-5.4-mini", created: 1782864000, ownedBy: "openai", shutdownDate: null },
  { id: "gpt-5.4-nano", created: 1782864000, ownedBy: "openai", shutdownDate: null },
]);

const SPECIALIZED_MODEL_PATTERN = /(audio|realtime|transcrib|tts|speech|image|dall-e|embedding|moderation|whisper|computer-use|search-preview|codex)/i;
const TEXT_MODEL_PATTERN = /^(gpt-|chatgpt-|o\d(?:-|$))/i;

function cleanModelText(value, limit = 160) {
  return Array.from(String(value ?? ""), (character) => {
    const code = character.charCodeAt(0);
    return code < 32 || code === 127 ? " " : character;
  }).join("").trim().slice(0, limit);
}

function providerError(body, response, requestId, latencyMs) {
  const error = new Error(cleanModelText(body?.error?.message || `OpenAI model inventory failed with HTTP ${response.status}.`, 500));
  error.code = cleanModelText(body?.error?.code || body?.error?.type || "model_inventory_failed", 120);
  error.httpStatus = response.status;
  error.requestId = cleanModelText(requestId, 180);
  error.latencyMs = latencyMs;
  return error;
}

export function normalizeOpenAiModels(payload) {
  return (Array.isArray(payload?.data) ? payload.data : [])
    .map((model) => ({
      id: cleanModelText(model?.id, 180),
      created: Number.isFinite(Number(model?.created)) ? Number(model.created) : 0,
      ownedBy: cleanModelText(model?.owned_by, 120),
      shutdownDate: model?.shutdown_date == null ? null : cleanModelText(model.shutdown_date, 80),
    }))
    .filter((model) => model.id)
    .sort((left, right) => right.created - left.created || left.id.localeCompare(right.id));
}

export function eventAiModelCandidates(models) {
  return (Array.isArray(models) ? models : []).filter((model) => (
    TEXT_MODEL_PATTERN.test(model.id) && !SPECIALIZED_MODEL_PATTERN.test(model.id)
  ));
}

export function chooseEventAiModel(models, preferred = "") {
  const candidates = eventAiModelCandidates(models);
  const available = new Set(candidates.map((model) => model.id));
  if (preferred && available.has(preferred)) return preferred;
  for (const id of ["gpt-5.4", "gpt-5.4-mini", "gpt-5.2", "gpt-5.1"]) {
    if (available.has(id)) return id;
  }
  return candidates.find((model) => /^gpt-5(?:[.-]|$)/i.test(model.id))?.id || candidates[0]?.id || "";
}

export function assertEventAiModels(models, producerModel, verifierModel) {
  const available = new Set(eventAiModelCandidates(models).map((model) => model.id));
  for (const [label, model] of [["research", producerModel], ["verification", verifierModel]]) {
    if (!model || !available.has(model)) {
      const error = new Error(`${label === "research" ? "Research" : "Verification"} model \`${model || "(none)"}\` is not available to the selected OpenAI credential/project. Refresh the model list and choose an available model.`);
      error.code = "model_not_available";
      error.httpStatus = 409;
      throw error;
    }
  }
}

export async function fetchOpenAiModels(apiKey, fetchImpl = fetch) {
  const started = Date.now();
  let response;
  try {
    response = await fetchImpl(OPENAI_MODELS_URL, {
      method: "GET",
      headers: { authorization: `Bearer ${apiKey}` },
    });
  } catch (cause) {
    const error = new Error("OpenAI model inventory could not be reached.", { cause });
    error.code = "model_inventory_unreachable";
    error.httpStatus = 502;
    error.latencyMs = Date.now() - started;
    throw error;
  }
  const latencyMs = Date.now() - started;
  const requestId = response.headers.get("x-request-id") || response.headers.get("openai-request-id") || "";
  let body;
  try { body = await response.json(); } catch { body = {}; }
  if (!response.ok) throw providerError(body, response, requestId, latencyMs);
  return {
    models: normalizeOpenAiModels(body),
    requestId: cleanModelText(requestId, 180),
    latencyMs,
    retrievedAt: new Date().toISOString(),
  };
}
