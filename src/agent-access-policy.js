export const DEFAULT_AGENT_SCOPES = Object.freeze([
  "records:read",
  "tracking:read",
  "tracking:write",
  "events:read",
  "events:write",
  "activity:read",
  "integrations:read",
]);

const SCOPE_LABELS = Object.freeze({
  "records:read": "Read records",
  "records:write": "Manage manual records",
  "tracking:read": "Read tracking",
  "tracking:write": "Manage tracking",
  "events:read": "Read events",
  "events:write": "Manage events",
  "activity:read": "Read activity and API logs",
  "activity:write": "Write activity notes",
  "integrations:read": "Read integration health",
  "graph:read": "Read the intelligence graph",
  "evidence:read": "Read retained evidence",
  "enrichment:propose": "Propose intelligence enrichments",
  "review:read": "Read review queues",
  "review:write": "Review intelligence proposals",
  "graph:admin": "Administer graph overlays",
});

const GROUP_ORDER = Object.freeze([
  ["records", "Records & tracking"],
  ["events", "Events & activity"],
  ["intelligence", "Intelligence & review"],
  ["administration", "Administration"],
]);

function scopeGroup(scope) {
  if (/^(records|tracking):/.test(scope)) return "records";
  if (/^(events|activity):/.test(scope)) return "events";
  if (/^(graph:read|evidence:read|enrichment:|review:)/.test(scope)) return "intelligence";
  return "administration";
}

export function agentScopeLabel(scope) {
  return SCOPE_LABELS[scope] || String(scope).replaceAll(":", " · ").replaceAll("_", " ");
}

export function groupedAgentScopes(scopes = []) {
  return GROUP_ORDER.map(([id, label]) => ({
    id,
    label,
    scopes: scopes.filter((scope) => scopeGroup(scope) === id),
  })).filter((group) => group.scopes.length);
}

export function agentAccessProfiles(availableScopes = []) {
  const allowed = new Set(availableScopes);
  const include = (scopes) => scopes.filter((scope) => allowed.has(scope));
  const readOnly = availableScopes.filter((scope) => scope.endsWith(":read"));
  const research = include([...readOnly, "activity:write", "enrichment:propose"]);
  return [
    { id: "read", label: "Read only", summary: "Inspect records, evidence, integrations, and activity without changing workspace state.", scopes: readOnly },
    { id: "workflow", label: "Workflow operator", summary: "Read the workspace and manage tracking and events. This is the standard operating profile.", scopes: include(DEFAULT_AGENT_SCOPES) },
    { id: "research", label: "Research & propose", summary: "Read retained intelligence and submit reviewable enrichment proposals without publishing them.", scopes: research },
    { id: "custom", label: "Custom", summary: "Choose individual permissions for a specialized integration.", scopes: [] },
  ];
}

export function agentCredentialState(key = {}, now = new Date()) {
  if (key.revokedAt) return "revoked";
  const expiresAt = key.expiresAt ? new Date(key.expiresAt) : null;
  if (expiresAt && !Number.isNaN(expiresAt.getTime()) && expiresAt <= now) return "expired";
  return "active";
}

export function summarizeAgentCredentials(keys = [], now = new Date()) {
  const state = (value) => keys.filter((key) => agentCredentialState(key, now) === value);
  const active = state("active");
  const expiring = active.filter((key) => {
    if (!key.expiresAt) return false;
    const expiresAt = new Date(key.expiresAt);
    return !Number.isNaN(expiresAt.getTime()) && expiresAt.getTime() - now.getTime() <= 30 * 86400000;
  });
  return { active, expired: state("expired"), revoked: state("revoked"), expiring };
}

export function agentScopeSummary(scopes = []) {
  if (!scopes.length) return "No permissions";
  const writeCount = scopes.filter((scope) => /:(?:write|admin)$/.test(scope) || scope.endsWith(":propose")).length;
  return `${scopes.length} permission${scopes.length === 1 ? "" : "s"}${writeCount ? ` · ${writeCount} can change or propose` : " · read only"}`;
}
