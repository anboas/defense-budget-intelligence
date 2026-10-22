export const API_ACTIVITY_LANES = Object.freeze([
  { id: "all", label: "All activity" },
  { id: "ai", label: "AI calls" },
  { id: "agent", label: "Agent API" },
  { id: "client", label: "Client health" },
  { id: "security", label: "Credential changes" },
]);

const SUCCESS_STATUSES = new Set(["accepted", "completed", "succeeded"]);
const FAILURE_STATUSES = new Set(["failed", "rate_limited", "rejected"]);
const ACTIVE_STATUSES = new Set(["accepted", "pending", "queued", "researching", "running", "verifying"]);

export function apiActivityLane(entry = {}) {
  const kind = String(entry.requestKind || "").toLowerCase();
  if (kind === "openai") return "ai";
  if (kind === "agent_api" || kind === "agent") return "agent";
  if (kind === "client_error") return "client";
  if (kind === "credential_lifecycle") return "security";
  return "agent";
}

export function isOperationalApiCall(entry = {}) {
  return !["client", "security"].includes(apiActivityLane(entry));
}

export function filterApiActivity(entries = [], lane = "all") {
  return lane === "all" ? entries : entries.filter((entry) => apiActivityLane(entry) === lane);
}

export function summarizeApiActivity(entries = []) {
  const operational = entries.filter(isOperationalApiCall);
  const succeeded = operational.filter((entry) => SUCCESS_STATUSES.has(entry.status)).length;
  const failed = operational.filter((entry) => FAILURE_STATUSES.has(entry.status)).length;
  const inProgress = operational.filter((entry) => ACTIVE_STATUSES.has(entry.status) && !SUCCESS_STATUSES.has(entry.status)).length;
  const terminalRequests = succeeded + failed;
  const measuredLatency = operational.map((entry) => Number(entry.latencyMs || 0)).filter((value) => value > 0).sort((left, right) => left - right);
  const averageLatencyMs = measuredLatency.length ? Math.round(measuredLatency.reduce((total, value) => total + value, 0) / measuredLatency.length) : 0;
  const p95LatencyMs = measuredLatency.length ? measuredLatency[Math.min(measuredLatency.length - 1, Math.ceil(measuredLatency.length * 0.95) - 1)] : 0;
  return {
    retained: entries.length,
    requests: operational.length,
    succeeded,
    failed,
    inProgress,
    terminalRequests,
    successRate: terminalRequests ? Math.round((succeeded / terminalRequests) * 1000) / 10 : null,
    averageLatencyMs,
    p95LatencyMs,
    inputTokens: operational.reduce((total, entry) => total + Number(entry.inputTokens || 0), 0),
    outputTokens: operational.reduce((total, entry) => total + Number(entry.outputTokens || 0), 0),
    aiRequests: entries.filter((entry) => apiActivityLane(entry) === "ai").length,
    agentRequests: entries.filter((entry) => apiActivityLane(entry) === "agent").length,
    clientErrors: entries.filter((entry) => apiActivityLane(entry) === "client").length,
    credentialEvents: entries.filter((entry) => apiActivityLane(entry) === "security").length,
  };
}

export function apiActivityLaneCounts(entries = []) {
  return API_ACTIVITY_LANES.map((lane) => ({
    ...lane,
    count: lane.id === "all" ? entries.length : entries.filter((entry) => apiActivityLane(entry) === lane.id).length,
  }));
}
