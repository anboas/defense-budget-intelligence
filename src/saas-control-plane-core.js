export const COMMERCIAL_LIFECYCLE_STATES = Object.freeze([
  "internal",
  "prospect",
  "trial",
  "active",
  "grace",
  "suspended",
  "closed",
]);

export const COMMERCIAL_ENFORCEMENT_MODES = Object.freeze(["observe", "enforce"]);

export const COMMERCIAL_PLAN_CATALOG = Object.freeze([
  Object.freeze({
    id: "internal",
    name: "Internal",
    summary: "Grandfathered access for the current DBI team while the commercial model is developed.",
    entitlements: Object.freeze({
      seats: 50,
      teams: 50,
      workspaces: 10,
      savedViews: 100,
      agentCredentials: 25,
      retentionDays: 365,
      samRefreshHours: 6,
      aiJobsMonthly: 1_000,
      auditExport: true,
      agentApi: true,
      customBranding: true,
    }),
  }),
  Object.freeze({
    id: "pilot",
    name: "Pilot",
    summary: "Sales-assisted design-partner plan with bounded capacity and full workspace workflows.",
    entitlements: Object.freeze({
      seats: 10,
      teams: 10,
      workspaces: 1,
      savedViews: 25,
      agentCredentials: 5,
      retentionDays: 180,
      samRefreshHours: 24,
      aiJobsMonthly: 250,
      auditExport: true,
      agentApi: true,
      customBranding: false,
    }),
  }),
]);

export const ENTITLEMENT_LABELS = Object.freeze({
  seats: "Seats",
  teams: "Teams",
  workspaces: "Workspaces",
  savedViews: "Saved views",
  agentCredentials: "Agent credentials",
  retentionDays: "History retention",
  samRefreshHours: "SAM.gov refresh cadence",
  aiJobsMonthly: "AI jobs per month",
  auditExport: "Audit export",
  agentApi: "Agent API",
  customBranding: "Custom branding",
});

export const USAGE_DIMENSIONS = Object.freeze([
  "seats",
  "teams",
  "savedViews",
  "acquisitionRecords",
  "agentCredentials",
  "apiRequests30d",
  "aiJobs30d",
]);

export function planById(planId) {
  return COMMERCIAL_PLAN_CATALOG.find((plan) => plan.id === planId) || COMMERCIAL_PLAN_CATALOG[0];
}

export function normalizeLifecycleState(value, fallback = "internal") {
  return COMMERCIAL_LIFECYCLE_STATES.includes(value) ? value : fallback;
}

export function normalizeEnforcementMode(value, fallback = "observe") {
  return COMMERCIAL_ENFORCEMENT_MODES.includes(value) ? value : fallback;
}

export function normalizeEntitlements(value, fallbackPlanId = "internal") {
  const base = planById(fallbackPlanId).entitlements;
  const input = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return Object.fromEntries(Object.entries(base).map(([key, defaultValue]) => {
    if (typeof defaultValue === "boolean") return [key, typeof input[key] === "boolean" ? input[key] : defaultValue];
    const candidate = Number(input[key]);
    return [key, Number.isFinite(candidate) && candidate >= 0 ? Math.trunc(candidate) : defaultValue];
  }));
}

export function entitlementRows(entitlements, usage = {}) {
  return Object.entries(entitlements || {}).map(([key, value]) => {
    const current = Number(usage[key]);
    const measurable = Number.isFinite(current) && typeof value === "number";
    return {
      key,
      label: ENTITLEMENT_LABELS[key] || key,
      value,
      usage: measurable ? current : null,
      status: measurable && current > value ? "over" : measurable && value > 0 && current / value >= 0.8 ? "near" : "within",
    };
  });
}

export function entitlementDecision({ entitlements, enforcementMode = "observe", key, usage = 0 }) {
  const limit = Number(entitlements?.[key]);
  const hasLimit = Number.isFinite(limit) && limit >= 0;
  const wouldBlock = hasLimit && Number(usage) >= limit;
  const normalizedMode = normalizeEnforcementMode(enforcementMode);
  return {
    key,
    limit: hasLimit ? limit : null,
    usage: Number(usage) || 0,
    enforcementMode: normalizedMode,
    wouldBlock,
    allowed: !wouldBlock || normalizedMode !== "enforce",
  };
}

export function commercialPlanSeedRows() {
  return COMMERCIAL_PLAN_CATALOG.map((plan) => ({ ...plan, entitlementsJson: JSON.stringify(plan.entitlements) }));
}
