import {
  COMMERCIAL_PLAN_CATALOG,
  CUSTOMER_ONBOARDING_STEPS,
  CUSTOMER_REQUEST_TYPES,
  commercialPlanSeedRows,
  entitlementDecision,
  entitlementRows,
  normalizeEntitlements,
  normalizeCustomerRequestStatus,
  normalizeCustomerRequestType,
  normalizeLifecycleState,
  normalizeOnboardingStatus,
  planById,
} from "./saas-control-plane-core.js";
import { cleanText, normalizeEmail, sameOriginRequest } from "./security-policy.js";

const seedPlans = commercialPlanSeedRows();

export const D1_SAAS_CONTROL_PLANE_SCHEMA = Object.freeze([
  `CREATE TABLE IF NOT EXISTS dbi_commercial_organizations (
    organization_id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    lifecycle_state TEXT NOT NULL DEFAULT 'internal' CHECK (lifecycle_state IN ('internal','prospect','trial','active','grace','suspended','closed')),
    billing_email TEXT NOT NULL DEFAULT '',
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS dbi_organization_memberships (
    organization_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('owner','administrator','member')),
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (organization_id, user_id)
  )`,
  "CREATE INDEX IF NOT EXISTS idx_dbi_organization_memberships_user ON dbi_organization_memberships (user_id, organization_id)",
  `CREATE TABLE IF NOT EXISTS dbi_workspace_organizations (
    workspace_id TEXT PRIMARY KEY,
    organization_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  "CREATE INDEX IF NOT EXISTS idx_dbi_workspace_organizations_org ON dbi_workspace_organizations (organization_id, workspace_id)",
  `CREATE TABLE IF NOT EXISTS dbi_commercial_plans (
    plan_id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    summary TEXT NOT NULL DEFAULT '',
    entitlements_json TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','retired')),
    version INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS dbi_organization_subscriptions (
    organization_id TEXT PRIMARY KEY,
    plan_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'internal' CHECK (status IN ('internal','prospect','trial','active','grace','suspended','closed')),
    enforcement_mode TEXT NOT NULL DEFAULT 'observe' CHECK (enforcement_mode IN ('observe','enforce')),
    source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','provider')),
    trial_ends_at TEXT NOT NULL DEFAULT '',
    current_period_ends_at TEXT NOT NULL DEFAULT '',
    updated_by TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS dbi_organization_entitlement_overrides (
    organization_id TEXT NOT NULL,
    entitlement_key TEXT NOT NULL,
    value_json TEXT NOT NULL,
    note TEXT NOT NULL DEFAULT '',
    updated_by TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (organization_id, entitlement_key)
  )`,
  `CREATE TABLE IF NOT EXISTS dbi_organization_usage_daily (
    organization_id TEXT NOT NULL,
    workspace_id TEXT NOT NULL,
    usage_date TEXT NOT NULL,
    dimension TEXT NOT NULL,
    quantity INTEGER NOT NULL DEFAULT 0,
    measured_at TEXT NOT NULL,
    PRIMARY KEY (organization_id, workspace_id, usage_date, dimension)
  )`,
  "CREATE INDEX IF NOT EXISTS idx_dbi_organization_usage_daily_org ON dbi_organization_usage_daily (organization_id, usage_date DESC, dimension)",
  `CREATE TABLE IF NOT EXISTS dbi_entitlement_observations (
    id TEXT PRIMARY KEY,
    organization_id TEXT NOT NULL,
    workspace_id TEXT NOT NULL,
    entitlement_key TEXT NOT NULL,
    usage_value INTEGER NOT NULL,
    limit_value INTEGER NOT NULL,
    enforcement_mode TEXT NOT NULL,
    observed_at TEXT NOT NULL
  )`,
  "CREATE INDEX IF NOT EXISTS idx_dbi_entitlement_observations_org ON dbi_entitlement_observations (organization_id, observed_at DESC)",
  `CREATE TABLE IF NOT EXISTS dbi_organization_onboarding_steps (
    organization_id TEXT NOT NULL,
    step_key TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','in_progress','completed','waived')),
    note TEXT NOT NULL DEFAULT '',
    updated_by TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (organization_id, step_key)
  )`,
  `CREATE TABLE IF NOT EXISTS dbi_organization_service_requests (
    request_id TEXT PRIMARY KEY,
    organization_id TEXT NOT NULL,
    workspace_id TEXT NOT NULL DEFAULT '',
    request_type TEXT NOT NULL CHECK (request_type IN ('support','data_export','data_deletion','cancellation','ownership_transfer')),
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_progress','waiting','resolved','cancelled')),
    subject TEXT NOT NULL,
    detail TEXT NOT NULL DEFAULT '',
    requested_by TEXT NOT NULL,
    assigned_to TEXT NOT NULL DEFAULT '',
    resolution_note TEXT NOT NULL DEFAULT '',
    resolved_at TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  "CREATE INDEX IF NOT EXISTS idx_dbi_organization_service_requests_org ON dbi_organization_service_requests (organization_id, status, created_at DESC)",
  ...seedPlans.map((plan) => `INSERT OR IGNORE INTO dbi_commercial_plans
    (plan_id,name,summary,entitlements_json,status,version,created_at,updated_at)
    VALUES ('${plan.id}','${plan.name.replaceAll("'", "''")}','${plan.summary.replaceAll("'", "''")}','${plan.entitlementsJson.replaceAll("'", "''")}','active',1,'2026-09-20T21:00:00.000Z','2026-09-20T21:00:00.000Z')`),
  `INSERT OR IGNORE INTO dbi_commercial_organizations
    (organization_id,name,slug,lifecycle_state,billing_email,created_by,created_at,updated_at)
    SELECT 'organization-internal','Internal','internal','internal','',user_id,'2026-09-20T21:00:00.000Z','2026-09-20T21:00:00.000Z'
    FROM dbi_super_user WHERE singleton=1`,
  `INSERT OR IGNORE INTO dbi_organization_memberships
    (organization_id,user_id,role,created_by,created_at,updated_at)
    SELECT 'organization-internal',user_id,'owner',user_id,'2026-09-20T21:00:00.000Z','2026-09-20T21:00:00.000Z'
    FROM dbi_super_user WHERE singleton=1`,
  `INSERT OR IGNORE INTO dbi_workspace_organizations (workspace_id,organization_id,created_at,updated_at)
    SELECT workspace_id,'organization-internal','2026-09-20T21:00:00.000Z','2026-09-20T21:00:00.000Z' FROM dbi_workspaces`,
  `INSERT OR IGNORE INTO dbi_organization_subscriptions
    (organization_id,plan_id,status,enforcement_mode,source,trial_ends_at,current_period_ends_at,updated_by,created_at,updated_at)
    SELECT 'organization-internal','internal','internal','observe','manual','','',user_id,'2026-09-20T21:00:00.000Z','2026-09-20T21:00:00.000Z'
    FROM dbi_super_user WHERE singleton=1`,
  ...CUSTOMER_ONBOARDING_STEPS.map((step) => `INSERT OR IGNORE INTO dbi_organization_onboarding_steps
    (organization_id,step_key,status,note,updated_by,updated_at)
    SELECT organization_id,'${step.key}','pending','',created_by,'2026-09-20T21:00:00.000Z' FROM dbi_commercial_organizations`),
]);

function parseJson(value, fallback = {}) {
  try { return JSON.parse(value || ""); } catch { return fallback; }
}

function slugify(value) {
  return cleanText(value, 80).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

async function ensureInternalCommercialModel(db) {
  const owner = await db.prepare("SELECT user_id FROM dbi_super_user WHERE singleton=1").first();
  if (!owner?.user_id) return;
  const now = new Date().toISOString();
  await db.batch([
    db.prepare(`INSERT OR IGNORE INTO dbi_commercial_organizations
      (organization_id,name,slug,lifecycle_state,billing_email,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)`)
      .bind("organization-internal", "Internal", "internal", "internal", "", owner.user_id, now, now),
    db.prepare(`INSERT OR IGNORE INTO dbi_organization_memberships
      (organization_id,user_id,role,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?)`)
      .bind("organization-internal", owner.user_id, "owner", owner.user_id, now, now),
    db.prepare(`INSERT OR IGNORE INTO dbi_organization_subscriptions
      (organization_id,plan_id,status,enforcement_mode,source,trial_ends_at,current_period_ends_at,updated_by,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?)`).bind("organization-internal", "internal", "internal", "observe", "manual", "", "", owner.user_id, now, now),
    db.prepare(`INSERT OR IGNORE INTO dbi_workspace_organizations (workspace_id,organization_id,created_at,updated_at)
      SELECT workspace_id,?,?,? FROM dbi_workspaces`).bind("organization-internal", now, now),
    ...CUSTOMER_ONBOARDING_STEPS.map((step) => db.prepare(`INSERT OR IGNORE INTO dbi_organization_onboarding_steps
      (organization_id,step_key,status,note,updated_by,updated_at) SELECT organization_id,?,'pending','',created_by,? FROM dbi_commercial_organizations`).bind(step.key, now)),
  ]);
}

async function usageForWorkspace(db, organizationId, workspaceId) {
  const [seats, teams, savedViews, records, agentCredentials, apiRequests, aiJobs] = await Promise.all([
    db.prepare("SELECT COUNT(*) AS count FROM dbi_workspace_memberships WHERE workspace_id=?").bind(workspaceId).first(),
    db.prepare("SELECT COUNT(*) AS count FROM dbi_workspace_teams WHERE workspace_id=?").bind(workspaceId).first(),
    db.prepare("SELECT COUNT(*) AS count FROM dbi_acquisition_saved_views WHERE workspace_id=?").bind(workspaceId).first(),
    db.prepare("SELECT COUNT(*) AS count FROM dbi_acquisition_records WHERE workspace_id=? AND removed_at=''").bind(workspaceId).first(),
    db.prepare("SELECT COUNT(*) AS count FROM dbi_workspace_agent_keys WHERE workspace_id=? AND revoked_at=''").bind(workspaceId).first(),
    db.prepare("SELECT COUNT(*) AS count FROM dbi_api_request_log WHERE workspace_id=? AND completed_at>=?").bind(workspaceId, new Date(Date.now() - 30 * 86400000).toISOString()).first(),
    db.prepare("SELECT COUNT(*) AS count FROM dbi_event_ai_jobs WHERE workspace_id=? AND created_at>=?").bind(workspaceId, new Date(Date.now() - 30 * 86400000).toISOString()).first(),
  ]);
  const usage = {
    seats: Number(seats?.count || 0), teams: Number(teams?.count || 0), savedViews: Number(savedViews?.count || 0),
    acquisitionRecords: Number(records?.count || 0), agentCredentials: Number(agentCredentials?.count || 0),
    apiRequests30d: Number(apiRequests?.count || 0), aiJobs30d: Number(aiJobs?.count || 0),
  };
  const usageDate = new Date().toISOString().slice(0, 10); const measuredAt = new Date().toISOString();
  await db.batch(Object.entries(usage).map(([dimension, quantity]) => db.prepare(`INSERT INTO dbi_organization_usage_daily
    (organization_id,workspace_id,usage_date,dimension,quantity,measured_at) VALUES (?,?,?,?,?,?)
    ON CONFLICT (organization_id,workspace_id,usage_date,dimension) DO UPDATE SET quantity=excluded.quantity,measured_at=excluded.measured_at`)
    .bind(organizationId, workspaceId, usageDate, dimension, quantity, measuredAt)));
  return { ...usage, measuredAt };
}

async function organizationPayload(db, organization) {
  const [membershipRows, workspaceRows, subscription, overrides, uniqueSeats, onboardingRows, requestRows] = await Promise.all([
    db.prepare(`SELECT membership.role,user.user_id,user.email,user.display_name,user.title
      FROM dbi_organization_memberships membership JOIN dbi_users user ON user.user_id=membership.user_id
      WHERE membership.organization_id=? ORDER BY CASE membership.role WHEN 'owner' THEN 0 WHEN 'administrator' THEN 1 ELSE 2 END,user.display_name`).bind(organization.organization_id).all(),
    db.prepare(`SELECT workspace.workspace_id,workspace.name,workspace.slug,workspace.description,workspace.status
      FROM dbi_workspace_organizations mapping JOIN dbi_workspaces workspace ON workspace.workspace_id=mapping.workspace_id
      WHERE mapping.organization_id=? ORDER BY workspace.name`).bind(organization.organization_id).all(),
    db.prepare("SELECT * FROM dbi_organization_subscriptions WHERE organization_id=?").bind(organization.organization_id).first(),
    db.prepare("SELECT entitlement_key,value_json,note FROM dbi_organization_entitlement_overrides WHERE organization_id=?").bind(organization.organization_id).all(),
    db.prepare(`SELECT COUNT(DISTINCT membership.user_id) AS count FROM dbi_workspace_organizations mapping
      JOIN dbi_workspace_memberships membership ON membership.workspace_id=mapping.workspace_id
      JOIN dbi_users user ON user.user_id=membership.user_id AND user.status='active'
      WHERE mapping.organization_id=?`).bind(organization.organization_id).first(),
    db.prepare("SELECT step_key,status,note,updated_at FROM dbi_organization_onboarding_steps WHERE organization_id=? ORDER BY updated_at,step_key").bind(organization.organization_id).all(),
    db.prepare(`SELECT request.request_id,request.workspace_id,request.request_type,request.status,request.subject,request.detail,
      request.requested_by,request.assigned_to,request.resolution_note,request.resolved_at,request.created_at,request.updated_at,
      requester.display_name AS requester_name,assignee.display_name AS assignee_name
      FROM dbi_organization_service_requests request
      LEFT JOIN dbi_users requester ON requester.user_id=request.requested_by
      LEFT JOIN dbi_users assignee ON assignee.user_id=request.assigned_to
      WHERE request.organization_id=? ORDER BY request.created_at DESC LIMIT 100`).bind(organization.organization_id).all(),
  ]);
  const planRow = await db.prepare("SELECT * FROM dbi_commercial_plans WHERE plan_id=?").bind(subscription?.plan_id || "internal").first();
  const base = normalizeEntitlements(parseJson(planRow?.entitlements_json), subscription?.plan_id || "internal");
  const entitlements = { ...base };
  for (const row of overrides.results || []) entitlements[row.entitlement_key] = parseJson(row.value_json, entitlements[row.entitlement_key]);
  const workspaces = workspaceRows.results || [];
  const usageRows = await Promise.all(workspaces.map(async (workspace) => ({ workspaceId: workspace.workspace_id, ...(await usageForWorkspace(db, organization.organization_id, workspace.workspace_id)) })));
  const usage = usageRows.reduce((total, row) => {
    for (const [key, value] of Object.entries(row)) if (key !== "workspaceId" && key !== "measuredAt") total[key] = Number(total[key] || 0) + Number(value || 0);
    return total;
  }, { workspaces: workspaces.length });
  usage.seats = Number(uniqueSeats?.count || 0);
  return {
    id: organization.organization_id, name: organization.name, slug: organization.slug,
    lifecycleState: organization.lifecycle_state, billingEmail: organization.billing_email || "",
    createdAt: organization.created_at, updatedAt: organization.updated_at,
    owners: (membershipRows.results || []).filter((row) => row.role === "owner").map((row) => ({ id: row.user_id, email: row.email, displayName: row.display_name, title: row.title || "" })),
    members: (membershipRows.results || []).map((row) => ({ id: row.user_id, email: row.email, displayName: row.display_name, title: row.title || "", role: row.role })),
    workspaces: workspaces.map((row) => ({ id: row.workspace_id, name: row.name, slug: row.slug, description: row.description || "", status: row.status })),
    subscription: { planId: subscription?.plan_id || "internal", planName: planRow?.name || planById(subscription?.plan_id).name, status: subscription?.status || "internal", enforcementMode: subscription?.enforcement_mode || "observe", source: subscription?.source || "manual" },
    usage, entitlements, overrides: (overrides.results || []).map((row) => ({ key: row.entitlement_key, value: parseJson(row.value_json), note: row.note || "" })), entitlementRows: entitlementRows(entitlements, usage),
    onboardingSteps: CUSTOMER_ONBOARDING_STEPS.map((step) => {
      const row = (onboardingRows.results || []).find((item) => item.step_key === step.key);
      return { ...step, status: row?.status || "pending", note: row?.note || "", updatedAt: row?.updated_at || "" };
    }),
    serviceRequests: (requestRows.results || []).map((row) => ({
      id: row.request_id, workspaceId: row.workspace_id || "", type: row.request_type, status: row.status,
      subject: row.subject, detail: row.detail || "", requestedBy: row.requested_by,
      requesterName: row.requester_name || "Unknown user", assignedTo: row.assigned_to || "",
      assigneeName: row.assignee_name || "", resolutionNote: row.resolution_note || "",
      resolvedAt: row.resolved_at || "", createdAt: row.created_at, updatedAt: row.updated_at,
    })),
    onboarding: {
      ownerAssigned: (membershipRows.results || []).some((row) => row.role === "owner"),
      workspaceAttached: workspaces.length > 0,
      planAssigned: Boolean(subscription?.plan_id),
      accessPreserved: true,
    },
  };
}

export async function d1EntitlementDecision(db, workspaceId, key, currentUsage) {
  await ensureInternalCommercialModel(db);
  const row = await db.prepare(`SELECT mapping.organization_id,subscription.plan_id,subscription.enforcement_mode,plan.entitlements_json
    FROM dbi_workspace_organizations mapping
    LEFT JOIN dbi_organization_subscriptions subscription ON subscription.organization_id=mapping.organization_id
    LEFT JOIN dbi_commercial_plans plan ON plan.plan_id=subscription.plan_id WHERE mapping.workspace_id=?`).bind(workspaceId).first();
  const entitlements = normalizeEntitlements(parseJson(row?.entitlements_json), row?.plan_id || "internal");
  const override = row?.organization_id ? await db.prepare("SELECT value_json FROM dbi_organization_entitlement_overrides WHERE organization_id=? AND entitlement_key=?").bind(row.organization_id, key).first() : null;
  if (override) entitlements[key] = parseJson(override.value_json, entitlements[key]);
  let organizationUsage = currentUsage;
  if (row?.organization_id && key === "seats") organizationUsage = Number((await db.prepare(`SELECT COUNT(DISTINCT membership.user_id) AS count
    FROM dbi_workspace_organizations mapping JOIN dbi_workspace_memberships membership ON membership.workspace_id=mapping.workspace_id
    JOIN dbi_users user ON user.user_id=membership.user_id AND user.status='active' WHERE mapping.organization_id=?`).bind(row.organization_id).first())?.count || 0);
  if (row?.organization_id && key === "teams") organizationUsage = Number((await db.prepare(`SELECT COUNT(*) AS count FROM dbi_workspace_organizations mapping
    JOIN dbi_workspace_teams team ON team.workspace_id=mapping.workspace_id WHERE mapping.organization_id=?`).bind(row.organization_id).first())?.count || 0);
  const decision = entitlementDecision({ entitlements, enforcementMode: row?.enforcement_mode || "observe", key, usage: organizationUsage });
  if (decision.wouldBlock && row?.organization_id) await db.prepare(`INSERT INTO dbi_entitlement_observations
    (id,organization_id,workspace_id,entitlement_key,usage_value,limit_value,enforcement_mode,observed_at) VALUES (?,?,?,?,?,?,?,?)`)
    .bind(crypto.randomUUID(), row.organization_id, workspaceId, key, decision.usage, decision.limit, decision.enforcementMode, new Date().toISOString()).run();
  return decision;
}

export async function d1SaasControlPlaneResponse(request, db, deps) {
  const { json, recordActivity, safeJson, sessionUser } = deps;
  const session = await sessionUser(db, request);
  if (!session) return json({ error: "Sign in required" }, 401);
  await ensureInternalCommercialModel(db);
  const isSuper = session.role === "super_user" && !session.is_emulating;
  const pathname = new URL(request.url).pathname.replace(/\/+$/, "");
  const suffix = pathname.slice("/api/v1/auth/control-plane".length).replace(/^\//, "");
  const [resource = "", encodedId = "", subresource = "", encodedSubresourceId = ""] = suffix.split("/");
  const organizationId = cleanText(decodeURIComponent(encodedId), 100);

  async function organizationAccess(id) {
    if (isSuper) return { role: "platform_super", canManage: true };
    const membership = await db.prepare("SELECT role FROM dbi_organization_memberships WHERE organization_id=? AND user_id=?").bind(id, session.user_id).first();
    const workspaceManager = session.membership_role === "administrator" && await db.prepare("SELECT 1 AS allowed FROM dbi_workspace_organizations WHERE organization_id=? AND workspace_id=?").bind(id, session.active_workspace_id || "").first();
    return { role: membership?.role || (workspaceManager ? "workspace_administrator" : "member"), canManage: ["owner", "administrator"].includes(membership?.role) || Boolean(workspaceManager) };
  }

  if (request.method === "GET" && !resource) {
    const rows = isSuper
      ? await db.prepare("SELECT * FROM dbi_commercial_organizations ORDER BY name COLLATE NOCASE").all()
      : await db.prepare(`SELECT organization.* FROM dbi_commercial_organizations organization
        JOIN dbi_workspace_organizations mapping ON mapping.organization_id=organization.organization_id
        WHERE mapping.workspace_id=?`).bind(session.active_workspace_id || "").all();
    let organizations = await Promise.all((rows.results || []).map(async (row) => {
      const organization = await organizationPayload(db, row); const access = await organizationAccess(organization.id);
      return { ...organization, organizationRole: access.role, canManageOrganization: access.canManage };
    }));
    if (!isSuper) organizations = organizations.map((organization) => ({
      ...organization, billingEmail: "", members: [], overrides: [],
      serviceRequests: organization.canManageOrganization ? organization.serviceRequests : organization.serviceRequests.filter((request) => request.requestedBy === session.user_id),
      owners: organization.owners.map((owner) => ({ id: owner.id, displayName: owner.displayName })),
    }));
    return json({ billingEnabled: false, enforcementEnabled: false, mode: "shadow", operatingMode: "manual", paymentCapabilities: false, requestTypes: CUSTOMER_REQUEST_TYPES, plans: COMMERCIAL_PLAN_CATALOG, organizations, activeOrganization: organizations.find((org) => org.workspaces.some((workspace) => workspace.id === session.active_workspace_id)) || null, canManage: isSuper });
  }

  if (!sameOriginRequest(request)) return json({ error: "Cross-origin control-plane access is not allowed" }, 403);

  if (resource === "organizations" && organizationId && subresource === "requests") {
    const organization = await db.prepare("SELECT organization_id FROM dbi_commercial_organizations WHERE organization_id=?").bind(organizationId).first();
    if (!organization) return json({ error: "Organization not found" }, 404);
    const access = await organizationAccess(organizationId);
    const attached = isSuper || await db.prepare("SELECT 1 AS allowed FROM dbi_workspace_organizations WHERE organization_id=? AND workspace_id=?").bind(organizationId, session.active_workspace_id || "").first();
    if (!attached) return json({ error: "Organization access is required" }, 403);
    if (request.method === "POST" && !encodedSubresourceId) {
      const body = await safeJson(request); const type = normalizeCustomerRequestType(body?.type); const subject = cleanText(body?.subject, 140); const detail = cleanText(body?.detail, 4000);
      if (!type || subject.length < 3) return json({ error: "A valid request type and subject are required" }, 400);
      if (!access.canManage && !["support", "data_export"].includes(type)) return json({ error: "Organization manager access is required for this request" }, 403);
      const id = crypto.randomUUID(); const now = new Date().toISOString();
      await db.prepare(`INSERT INTO dbi_organization_service_requests
        (request_id,organization_id,workspace_id,request_type,status,subject,detail,requested_by,assigned_to,resolution_note,resolved_at,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(id, organizationId, session.active_workspace_id || "", type, "open", subject, detail, session.user_id, "", "", "", now, now).run();
      await recordActivity(db, { type: "user", id: session.user_id, workspaceId: session.active_workspace_id }, "commercial_service_request_created", "organization_request", id);
      return json({ organization: await organizationPayload(db, await db.prepare("SELECT * FROM dbi_commercial_organizations WHERE organization_id=?").bind(organizationId).first()) }, 201);
    }
    if (request.method === "PATCH" && encodedSubresourceId) {
      const requestId = cleanText(decodeURIComponent(encodedSubresourceId), 100); const existing = await db.prepare("SELECT * FROM dbi_organization_service_requests WHERE organization_id=? AND request_id=?").bind(organizationId, requestId).first();
      if (!existing) return json({ error: "Service request not found" }, 404);
      const body = await safeJson(request); const requestedStatus = normalizeCustomerRequestStatus(body?.status, existing.status);
      const canCancelOwn = existing.requested_by === session.user_id && requestedStatus === "cancelled" && ["open", "waiting"].includes(existing.status);
      if (!access.canManage && !canCancelOwn) return json({ error: "Organization manager access is required" }, 403);
      const resolutionNote = cleanText(body?.resolutionNote ?? existing.resolution_note, 2000); const assignedTo = isSuper ? cleanText(body?.assignedTo ?? existing.assigned_to, 100) : existing.assigned_to;
      if (assignedTo && !(await db.prepare("SELECT user_id FROM dbi_users WHERE user_id=? AND status='active'").bind(assignedTo).first())) return json({ error: "Assignee must be an active account" }, 400);
      const now = new Date().toISOString(); const resolvedAt = ["resolved", "cancelled"].includes(requestedStatus) ? now : "";
      await db.prepare("UPDATE dbi_organization_service_requests SET status=?,assigned_to=?,resolution_note=?,resolved_at=?,updated_at=? WHERE request_id=?").bind(requestedStatus, assignedTo, resolutionNote, resolvedAt, now, requestId).run();
      await recordActivity(db, { type: "user", id: session.user_id, workspaceId: session.active_workspace_id }, "commercial_service_request_updated", "organization_request", requestId);
      return json({ organization: await organizationPayload(db, await db.prepare("SELECT * FROM dbi_commercial_organizations WHERE organization_id=?").bind(organizationId).first()) });
    }
  }

  if (resource === "organizations" && organizationId && subresource === "onboarding" && encodedSubresourceId && request.method === "PATCH") {
    const organization = await db.prepare("SELECT * FROM dbi_commercial_organizations WHERE organization_id=?").bind(organizationId).first(); if (!organization) return json({ error: "Organization not found" }, 404);
    const access = await organizationAccess(organizationId); if (!access.canManage) return json({ error: "Organization manager access is required" }, 403);
    const stepKey = cleanText(decodeURIComponent(encodedSubresourceId), 80); if (!CUSTOMER_ONBOARDING_STEPS.some((step) => step.key === stepKey)) return json({ error: "Onboarding step is not available" }, 400);
    const body = await safeJson(request); const status = normalizeOnboardingStatus(body?.status); const note = cleanText(body?.note, 1000); const now = new Date().toISOString();
    await db.prepare(`INSERT INTO dbi_organization_onboarding_steps (organization_id,step_key,status,note,updated_by,updated_at) VALUES (?,?,?,?,?,?)
      ON CONFLICT (organization_id,step_key) DO UPDATE SET status=excluded.status,note=excluded.note,updated_by=excluded.updated_by,updated_at=excluded.updated_at`).bind(organizationId, stepKey, status, note, session.user_id, now).run();
    await recordActivity(db, { type: "user", id: session.user_id, workspaceId: session.active_workspace_id }, "commercial_onboarding_updated", "organization", organizationId);
    return json({ organization: await organizationPayload(db, organization) });
  }

  if (resource === "organizations" && organizationId && subresource === "entitlements" && request.method === "PUT") {
    if (!isSuper) return json({ error: "Super user access is required" }, 403);
    const existing = await db.prepare("SELECT organization_id FROM dbi_commercial_organizations WHERE organization_id=?").bind(organizationId).first(); if (!existing) return json({ error: "Organization not found" }, 404);
    const body = await safeJson(request); const values = body?.overrides && typeof body.overrides === "object" && !Array.isArray(body.overrides) ? body.overrides : {}; const notes = body?.notes && typeof body.notes === "object" ? body.notes : {};
    const current = await organizationPayload(db, await db.prepare("SELECT * FROM dbi_commercial_organizations WHERE organization_id=?").bind(organizationId).first()); const defaults = planById(current.subscription.planId).entitlements; const now = new Date().toISOString();
    const statements = [db.prepare("DELETE FROM dbi_organization_entitlement_overrides WHERE organization_id=?").bind(organizationId)];
    for (const [key, rawValue] of Object.entries(values)) {
      if (!(key in defaults)) continue; const value = typeof defaults[key] === "boolean" ? Boolean(rawValue) : Math.max(0, Math.trunc(Number(rawValue) || 0));
      statements.push(db.prepare(`INSERT INTO dbi_organization_entitlement_overrides (organization_id,entitlement_key,value_json,note,updated_by,updated_at) VALUES (?,?,?,?,?,?)`).bind(organizationId, key, JSON.stringify(value), cleanText(notes[key], 500), session.user_id, now));
    }
    await db.batch(statements); await recordActivity(db, { type: "user", id: session.user_id, workspaceId: session.active_workspace_id }, "commercial_entitlements_updated", "organization", organizationId);
    return json({ organization: await organizationPayload(db, await db.prepare("SELECT * FROM dbi_commercial_organizations WHERE organization_id=?").bind(organizationId).first()) });
  }

  if (!isSuper) return json({ error: "Super user access is required" }, 403);

  if (request.method === "POST" && resource === "organizations" && !organizationId) {
    const body = await safeJson(request); const name = cleanText(body?.name, 100); const slug = slugify(body?.slug || name); const billingEmail = normalizeEmail(body?.billingEmail || "");
    if (name.length < 2 || !slug) return json({ error: "A valid organization name is required" }, 400);
    if (body?.billingEmail && !billingEmail) return json({ error: "Billing contact must be a valid email address" }, 400);
    const planId = COMMERCIAL_PLAN_CATALOG.some((plan) => plan.id === body?.planId) ? body.planId : "pilot";
    const lifecycle = normalizeLifecycleState(body?.lifecycleState, "prospect");
    const id = crypto.randomUUID(); const now = new Date().toISOString(); const ownerUserId = cleanText(body?.ownerUserId || session.user_id, 100);
    const workspaceIds = [...new Set((Array.isArray(body?.workspaceIds) ? body.workspaceIds : []).map((value) => cleanText(value, 100)).filter(Boolean))];
    const [owner, availableWorkspaces] = await Promise.all([
      db.prepare("SELECT user_id FROM dbi_users WHERE user_id=? AND status='active'").bind(ownerUserId).first(),
      workspaceIds.length ? db.prepare(`SELECT workspace_id FROM dbi_workspaces WHERE workspace_id IN (${workspaceIds.map(() => "?").join(",")})`).bind(...workspaceIds).all() : Promise.resolve({ results: [] }),
    ]);
    if (!owner) return json({ error: "Organization owner must be an active account" }, 400);
    if ((availableWorkspaces.results || []).length !== workspaceIds.length) return json({ error: "One or more workspaces do not exist" }, 400);
    const created = await db.prepare(`INSERT OR IGNORE INTO dbi_commercial_organizations
      (organization_id,name,slug,lifecycle_state,billing_email,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)`)
      .bind(id, name, slug, lifecycle, billingEmail, session.user_id, now, now).run();
    if (!Number(created?.meta?.changes || 0)) return json({ error: "An organization with that name already exists" }, 409);
    await db.batch([
      db.prepare(`INSERT INTO dbi_organization_memberships (organization_id,user_id,role,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?)`).bind(id, ownerUserId, "owner", session.user_id, now, now),
      db.prepare(`INSERT INTO dbi_organization_subscriptions (organization_id,plan_id,status,enforcement_mode,source,trial_ends_at,current_period_ends_at,updated_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)`).bind(id, planId, lifecycle, "observe", "manual", "", "", session.user_id, now, now),
      ...workspaceIds.map((workspaceId) => db.prepare(`INSERT OR REPLACE INTO dbi_workspace_organizations (workspace_id,organization_id,created_at,updated_at) VALUES (?,?,?,?)`).bind(workspaceId, id, now, now)),
      ...CUSTOMER_ONBOARDING_STEPS.map((step) => db.prepare(`INSERT INTO dbi_organization_onboarding_steps (organization_id,step_key,status,note,updated_by,updated_at) VALUES (?,?,?,?,?,?)`).bind(id, step.key, "pending", "", session.user_id, now)),
    ]);
    await recordActivity(db, { type: "user", id: session.user_id, workspaceId: session.active_workspace_id }, "commercial_organization_created", "organization", id);
    return json({ organization: await organizationPayload(db, await db.prepare("SELECT * FROM dbi_commercial_organizations WHERE organization_id=?").bind(id).first()) }, 201);
  }

  if (request.method === "PATCH" && resource === "organizations" && organizationId) {
    const current = await db.prepare("SELECT * FROM dbi_commercial_organizations WHERE organization_id=?").bind(organizationId).first();
    if (!current) return json({ error: "Organization not found" }, 404);
    const body = await safeJson(request); const name = cleanText(body?.name ?? current.name, 100); const billingEmail = normalizeEmail(body?.billingEmail ?? current.billing_email); const lifecycle = normalizeLifecycleState(body?.lifecycleState, current.lifecycle_state);
    if (body?.billingEmail && !billingEmail) return json({ error: "Billing contact must be a valid email address" }, 400);
    if (body?.planId && !COMMERCIAL_PLAN_CATALOG.some((plan) => plan.id === body.planId)) return json({ error: "Commercial plan is not available" }, 400);
    const currentSubscription = await db.prepare("SELECT plan_id FROM dbi_organization_subscriptions WHERE organization_id=?").bind(organizationId).first();
    const planId = body?.planId || currentSubscription?.plan_id || "internal"; const enforcementMode = "observe";
    if (name.length < 2) return json({ error: "A valid organization name is required" }, 400);
    const ownerUserId = cleanText(body?.ownerUserId, 100); const workspaceIds = [...new Set((Array.isArray(body?.workspaceIds) ? body.workspaceIds : []).map((id) => cleanText(id, 100)).filter(Boolean))]; const now = new Date().toISOString();
    const [owner, availableWorkspaces] = await Promise.all([
      ownerUserId ? db.prepare("SELECT user_id FROM dbi_users WHERE user_id=? AND status='active'").bind(ownerUserId).first() : Promise.resolve({ user_id: session.user_id }),
      workspaceIds.length ? db.prepare(`SELECT workspace_id FROM dbi_workspaces WHERE workspace_id IN (${workspaceIds.map(() => "?").join(",")})`).bind(...workspaceIds).all() : Promise.resolve({ results: [] }),
    ]);
    if (!owner) return json({ error: "Organization owner must be an active account" }, 400);
    if ((availableWorkspaces.results || []).length !== workspaceIds.length) return json({ error: "One or more workspaces do not exist" }, 400);
    const statements = [
      db.prepare("UPDATE dbi_commercial_organizations SET name=?,lifecycle_state=?,billing_email=?,updated_at=? WHERE organization_id=?").bind(name, lifecycle, billingEmail, now, organizationId),
      db.prepare(`INSERT INTO dbi_organization_subscriptions (organization_id,plan_id,status,enforcement_mode,source,trial_ends_at,current_period_ends_at,updated_by,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT (organization_id) DO UPDATE SET plan_id=excluded.plan_id,status=excluded.status,enforcement_mode=excluded.enforcement_mode,updated_by=excluded.updated_by,updated_at=excluded.updated_at`)
        .bind(organizationId, planId, lifecycle === "internal" ? "internal" : lifecycle, enforcementMode, "manual", "", "", session.user_id, now, now),
    ];
    if (ownerUserId) {
      statements.push(db.prepare("DELETE FROM dbi_organization_memberships WHERE organization_id=? AND role='owner'").bind(organizationId));
      statements.push(db.prepare(`INSERT OR REPLACE INTO dbi_organization_memberships (organization_id,user_id,role,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?)`).bind(organizationId, ownerUserId, "owner", session.user_id, now, now));
    }
    if (Array.isArray(body?.workspaceIds)) {
      statements.push(db.prepare("DELETE FROM dbi_workspace_organizations WHERE organization_id=?").bind(organizationId));
      for (const workspaceId of workspaceIds) statements.push(db.prepare(`INSERT OR REPLACE INTO dbi_workspace_organizations (workspace_id,organization_id,created_at,updated_at) VALUES (?,?,?,?)`).bind(workspaceId, organizationId, now, now));
    }
    await db.batch(statements);
    await recordActivity(db, { type: "user", id: session.user_id, workspaceId: session.active_workspace_id }, "commercial_organization_updated", "organization", organizationId);
    return json({ organization: await organizationPayload(db, await db.prepare("SELECT * FROM dbi_commercial_organizations WHERE organization_id=?").bind(organizationId).first()) });
  }

  return json({ error: "Method not allowed" }, 405);
}
