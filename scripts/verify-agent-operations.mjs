import assert from "node:assert/strict";
import {
  apiActivityLane,
  apiActivityLaneCounts,
  filterApiActivity,
  summarizeApiActivity,
} from "../src/api-observability.js";
import {
  agentAccessProfiles,
  agentCredentialState,
  agentScopeSummary,
  groupedAgentScopes,
  summarizeAgentCredentials,
} from "../src/agent-access-policy.js";

const activity = [
  { id: "ai-ok", requestKind: "openai", status: "succeeded", latencyMs: 100, inputTokens: 30, outputTokens: 20 },
  { id: "ai-failed", requestKind: "openai", status: "failed", latencyMs: 500, inputTokens: 10, outputTokens: 0 },
  { id: "agent-running", requestKind: "agent_api", status: "running", latencyMs: 0 },
  { id: "agent-ok", requestKind: "agent_api", status: "succeeded", latencyMs: 200 },
  { id: "client", requestKind: "client_error", status: "failed", latencyMs: 2 },
  { id: "credential", requestKind: "credential_lifecycle", status: "succeeded", latencyMs: 1 },
];

assert.equal(apiActivityLane(activity[0]), "ai");
assert.equal(apiActivityLane(activity[2]), "agent");
assert.equal(filterApiActivity(activity, "client").length, 1);
assert.deepEqual(apiActivityLaneCounts(activity).map(({ id, count }) => [id, count]), [
  ["all", 6], ["ai", 2], ["agent", 2], ["client", 1], ["security", 1],
]);
assert.deepEqual(summarizeApiActivity(activity), {
  retained: 6,
  requests: 4,
  succeeded: 2,
  failed: 1,
  inProgress: 1,
  terminalRequests: 3,
  successRate: 66.7,
  averageLatencyMs: 267,
  p95LatencyMs: 500,
  inputTokens: 40,
  outputTokens: 20,
  aiRequests: 2,
  agentRequests: 2,
  clientErrors: 1,
  credentialEvents: 1,
});

const scopes = ["records:read", "tracking:read", "tracking:write", "events:read", "events:write", "activity:read", "activity:write", "integrations:read", "graph:read", "evidence:read", "enrichment:propose", "review:read", "review:write", "graph:admin"];
const profiles = agentAccessProfiles(scopes);
assert.equal(profiles.length, 4);
assert.deepEqual(profiles.find(({ id }) => id === "read").scopes, scopes.filter((scope) => scope.endsWith(":read")));
assert.ok(profiles.find(({ id }) => id === "workflow").scopes.includes("tracking:write"));
assert.ok(!profiles.find(({ id }) => id === "research").scopes.includes("review:write"));
assert.deepEqual(groupedAgentScopes(scopes).map(({ id }) => id), ["records", "events", "intelligence", "administration"]);
assert.equal(agentScopeSummary(["records:read", "events:write"]), "2 permissions · 1 can change or propose");

const now = new Date("2026-10-22T12:00:00.000Z");
const keys = [
  { id: "active", scopes, expiresAt: "2027-01-01T00:00:00.000Z" },
  { id: "expiring", scopes, expiresAt: "2026-11-01T00:00:00.000Z" },
  { id: "expired", scopes, expiresAt: "2026-10-01T00:00:00.000Z" },
  { id: "revoked", scopes, expiresAt: "2027-01-01T00:00:00.000Z", revokedAt: "2026-10-20T00:00:00.000Z" },
];
assert.equal(agentCredentialState(keys[0], now), "active");
assert.equal(agentCredentialState(keys[2], now), "expired");
assert.equal(agentCredentialState(keys[3], now), "revoked");
const inventory = summarizeAgentCredentials(keys, now);
assert.deepEqual(inventory.active.map(({ id }) => id), ["active", "expiring"]);
assert.deepEqual(inventory.expiring.map(({ id }) => id), ["expiring"]);
assert.deepEqual(inventory.expired.map(({ id }) => id), ["expired"]);
assert.deepEqual(inventory.revoked.map(({ id }) => id), ["revoked"]);

console.log("Agent operations policy and observability contracts verified.");
