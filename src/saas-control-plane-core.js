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

export const CUSTOMER_ONBOARDING_STEPS = Object.freeze([
  Object.freeze({ key: "confirm_owner", label: "Confirm customer owner", description: "Verify who owns the customer relationship and workspace decisions." }),
  Object.freeze({ key: "invite_team", label: "Invite the working team", description: "Add the people who will use and administer the workspace." }),
  Object.freeze({ key: "connect_source", label: "Connect a data source", description: "Configure at least one workspace-owned acquisition source." }),
  Object.freeze({ key: "create_saved_view", label: "Create a saved view", description: "Capture the first repeatable monitoring workflow." }),
  Object.freeze({ key: "review_security", label: "Review security", description: "Confirm sessions, credentials, access, and audit posture." }),
]);

export const CUSTOMER_REQUEST_TYPES = Object.freeze([
  Object.freeze({ id: "support", label: "Support request" }),
  Object.freeze({ id: "data_export", label: "Data export" }),
  Object.freeze({ id: "data_deletion", label: "Data deletion" }),
  Object.freeze({ id: "cancellation", label: "Close organization" }),
  Object.freeze({ id: "ownership_transfer", label: "Ownership transfer" }),
]);

export const CUSTOMER_REQUEST_STATUSES = Object.freeze(["open", "in_progress", "waiting", "resolved", "cancelled"]);

export function normalizeOnboardingStatus(value, fallback = "pending") {
  return ["pending", "in_progress", "completed", "waived"].includes(value) ? value : fallback;
}

export function normalizeCustomerRequestType(value) {
  return CUSTOMER_REQUEST_TYPES.some((item) => item.id === value) ? value : "";
}

export function normalizeCustomerRequestStatus(value, fallback = "open") {
  return CUSTOMER_REQUEST_STATUSES.includes(value) ? value : fallback;
}

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
