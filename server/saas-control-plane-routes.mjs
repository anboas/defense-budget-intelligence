import { randomUUID } from "node:crypto";
import {
  COMMERCIAL_PLAN_CATALOG,
  CUSTOMER_ONBOARDING_STEPS,
  CUSTOMER_REQUEST_TYPES,
  entitlementDecision,
  entitlementRows,
  normalizeEntitlements,
  normalizeCustomerRequestStatus,
  normalizeCustomerRequestType,
  normalizeLifecycleState,
  normalizeOnboardingStatus,
  planById,
} from "../src/saas-control-plane-core.js";
import { cleanText, normalizeEmail } from "../src/security-policy.js";

function slugify(value) {
  return cleanText(value, 80).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

async function ensureInternalCommercialModel(pool) {
  await pool.query(`WITH owner AS (SELECT user_id FROM app_super_user WHERE singleton=TRUE)
    INSERT INTO app_commercial_organizations(organization_id,name,slug,lifecycle_state,billing_email,created_by)
    SELECT '00000000-0000-4000-8000-000000000002','Internal','internal','internal','',user_id FROM owner
    ON CONFLICT(organization_id) DO NOTHING`);
  await pool.query(`INSERT INTO app_organization_memberships(organization_id,user_id,role,created_by)
    SELECT '00000000-0000-4000-8000-000000000002',user_id,'owner',user_id FROM app_super_user WHERE singleton=TRUE
    ON CONFLICT(organization_id,user_id) DO NOTHING`);
  await pool.query(`INSERT INTO app_organization_subscriptions(organization_id,plan_id,status,enforcement_mode,source,updated_by)
    SELECT '00000000-0000-4000-8000-000000000002','internal','internal','observe','manual',user_id FROM app_super_user WHERE singleton=TRUE
    ON CONFLICT(organization_id) DO NOTHING`);
  await pool.query(`INSERT INTO app_workspace_organizations(workspace_id,organization_id)
    SELECT workspace_id,'00000000-0000-4000-8000-000000000002' FROM app_workspaces
    ON CONFLICT(workspace_id) DO NOTHING`);
  for (const step of CUSTOMER_ONBOARDING_STEPS) await pool.query(`INSERT INTO app_organization_onboarding_steps(organization_id,step_key,status,note,updated_by)
    SELECT organization_id,$1,'pending','',created_by FROM app_commercial_organizations
    ON CONFLICT(organization_id,step_key) DO NOTHING`, [step.key]);
}

async function usageForWorkspace(pool, organizationId, workspaceId) {
  const result = await pool.query(`SELECT
    (SELECT COUNT(*)::int FROM app_workspace_memberships WHERE workspace_id=$1) AS seats,
    (SELECT COUNT(*)::int FROM app_workspace_teams WHERE workspace_id=$1) AS teams,
    (SELECT COUNT(*)::int FROM app_acquisition_saved_views WHERE workspace_id=$1) AS saved_views,
    (SELECT COUNT(*)::int FROM app_acquisition_records WHERE workspace_id=$1 AND removed_at IS NULL) AS acquisition_records,
    0::int AS agent_credentials,
    (SELECT COUNT(*)::int FROM app_api_request_log WHERE workspace_id=$1 AND completed_at>=NOW()-INTERVAL '30 days') AS api_requests_30d,
    (SELECT COUNT(*)::int FROM app_event_ai_jobs WHERE workspace_id=$1 AND created_at>=NOW()-INTERVAL '30 days') AS ai_jobs_30d`, [workspaceId]);
  const row = result.rows[0];
  const usage = { seats: row.seats, teams: row.teams, savedViews: row.saved_views, acquisitionRecords: row.acquisition_records,
    agentCredentials: row.agent_credentials, apiRequests30d: row.api_requests_30d, aiJobs30d: row.ai_jobs_30d };
  for (const [dimension, quantity] of Object.entries(usage)) await pool.query(`INSERT INTO app_organization_usage_daily
    (organization_id,workspace_id,usage_date,dimension,quantity,measured_at) VALUES ($1,$2,CURRENT_DATE,$3,$4,NOW())
    ON CONFLICT(organization_id,workspace_id,usage_date,dimension) DO UPDATE SET quantity=EXCLUDED.quantity,measured_at=NOW()`, [organizationId, workspaceId, dimension, quantity]);
  return { ...usage, measuredAt: new Date().toISOString() };
}

async function organizationPayload(pool, organization) {
  const [members, workspaces, subscription, overrides, uniqueSeats, onboardingRows, requestRows] = await Promise.all([
    pool.query(`SELECT membership.role,u.user_id,u.email,u.display_name,u.title FROM app_organization_memberships membership
      JOIN app_users u ON u.user_id=membership.user_id WHERE membership.organization_id=$1
      ORDER BY CASE membership.role WHEN 'owner' THEN 0 WHEN 'administrator' THEN 1 ELSE 2 END,u.display_name`, [organization.organization_id]),
    pool.query(`SELECT workspace.workspace_id,workspace.name,workspace.slug,workspace.description,workspace.status
      FROM app_workspace_organizations mapping JOIN app_workspaces workspace ON workspace.workspace_id=mapping.workspace_id
      WHERE mapping.organization_id=$1 ORDER BY workspace.name`, [organization.organization_id]),
    pool.query("SELECT * FROM app_organization_subscriptions WHERE organization_id=$1", [organization.organization_id]),
    pool.query("SELECT entitlement_key,value_json,note FROM app_organization_entitlement_overrides WHERE organization_id=$1", [organization.organization_id]),
    pool.query(`SELECT COUNT(DISTINCT membership.user_id)::int AS count FROM app_workspace_organizations mapping
      JOIN app_workspace_memberships membership ON membership.workspace_id=mapping.workspace_id
      JOIN app_users users ON users.user_id=membership.user_id AND users.status='active'
      WHERE mapping.organization_id=$1`, [organization.organization_id]),
    pool.query("SELECT step_key,status,note,updated_at FROM app_organization_onboarding_steps WHERE organization_id=$1 ORDER BY updated_at,step_key", [organization.organization_id]),
    pool.query(`SELECT request.request_id,request.workspace_id,request.request_type,request.status,request.subject,request.detail,
      request.requested_by,request.assigned_to,request.resolution_note,request.resolved_at,request.created_at,request.updated_at,
      requester.display_name AS requester_name,assignee.display_name AS assignee_name
      FROM app_organization_service_requests request
      LEFT JOIN app_users requester ON requester.user_id=request.requested_by
      LEFT JOIN app_users assignee ON assignee.user_id=request.assigned_to
      WHERE request.organization_id=$1 ORDER BY request.created_at DESC LIMIT 100`, [organization.organization_id]),
  ]);
  const subscriptionRow = subscription.rows[0];
  const planResult = await pool.query("SELECT * FROM app_commercial_plans WHERE plan_id=$1", [subscriptionRow?.plan_id || "internal"]);
  const plan = planResult.rows[0] || planById(subscriptionRow?.plan_id || "internal");
  const entitlements = normalizeEntitlements(plan.entitlements_json || plan.entitlements, subscriptionRow?.plan_id || "internal");
  for (const row of overrides.rows) entitlements[row.entitlement_key] = row.value_json;
  const usageRows = await Promise.all(workspaces.rows.map(async (workspace) => ({ workspaceId: workspace.workspace_id, ...(await usageForWorkspace(pool, organization.organization_id, workspace.workspace_id)) })));
  const usage = usageRows.reduce((total, row) => { for (const [key, value] of Object.entries(row)) if (key !== "workspaceId" && key !== "measuredAt") total[key] = Number(total[key] || 0) + Number(value || 0); return total; }, { workspaces: workspaces.rowCount });
  usage.seats = Number(uniqueSeats.rows[0]?.count || 0);
  return {
    id: organization.organization_id, name: organization.name, slug: organization.slug, lifecycleState: organization.lifecycle_state,
    billingEmail: organization.billing_email || "", createdAt: organization.created_at, updatedAt: organization.updated_at,
    owners: members.rows.filter((row) => row.role === "owner").map((row) => ({ id: row.user_id, email: row.email, displayName: row.display_name, title: row.title || "" })),
    members: members.rows.map((row) => ({ id: row.user_id, email: row.email, displayName: row.display_name, title: row.title || "", role: row.role })),
    workspaces: workspaces.rows.map((row) => ({ id: row.workspace_id, name: row.name, slug: row.slug, description: row.description || "", status: row.status })),
    subscription: { planId: subscriptionRow?.plan_id || "internal", planName: plan.name || planById(subscriptionRow?.plan_id).name, status: subscriptionRow?.status || "internal", enforcementMode: subscriptionRow?.enforcement_mode || "observe", source: subscriptionRow?.source || "manual" },
    usage, entitlements, overrides: overrides.rows.map((row) => ({ key: row.entitlement_key, value: row.value_json, note: row.note || "" })), entitlementRows: entitlementRows(entitlements, usage),
    onboardingSteps: CUSTOMER_ONBOARDING_STEPS.map((step) => {
      const row = onboardingRows.rows.find((item) => item.step_key === step.key);
      return { ...step, status: row?.status || "pending", note: row?.note || "", updatedAt: row?.updated_at || "" };
    }),
    serviceRequests: requestRows.rows.map((row) => ({ id: row.request_id, workspaceId: row.workspace_id || "", type: row.request_type, status: row.status,
      subject: row.subject, detail: row.detail || "", requestedBy: row.requested_by, requesterName: row.requester_name || "Unknown user",
      assignedTo: row.assigned_to || "", assigneeName: row.assignee_name || "", resolutionNote: row.resolution_note || "",
      resolvedAt: row.resolved_at || "", createdAt: row.created_at, updatedAt: row.updated_at })),
    onboarding: { ownerAssigned: members.rows.some((row) => row.role === "owner"), workspaceAttached: workspaces.rowCount > 0, planAssigned: Boolean(subscriptionRow?.plan_id), accessPreserved: true },
  };
}

export async function postgresEntitlementDecision(pool, workspaceId, key, currentUsage) {
  await ensureInternalCommercialModel(pool);
  const result = await pool.query(`SELECT mapping.organization_id,subscription.plan_id,subscription.enforcement_mode,plan.entitlements_json
    FROM app_workspace_organizations mapping LEFT JOIN app_organization_subscriptions subscription ON subscription.organization_id=mapping.organization_id
    LEFT JOIN app_commercial_plans plan ON plan.plan_id=subscription.plan_id WHERE mapping.workspace_id=$1`, [workspaceId]);
  const row = result.rows[0]; const entitlements = normalizeEntitlements(row?.entitlements_json, row?.plan_id || "internal");
  if (row?.organization_id) {
    const override = await pool.query("SELECT value_json FROM app_organization_entitlement_overrides WHERE organization_id=$1 AND entitlement_key=$2", [row.organization_id, key]);
    if (override.rowCount) entitlements[key] = override.rows[0].value_json;
  }
  let organizationUsage = currentUsage;
  if (row?.organization_id && key === "seats") organizationUsage = Number((await pool.query(`SELECT COUNT(DISTINCT membership.user_id)::int AS count
    FROM app_workspace_organizations mapping JOIN app_workspace_memberships membership ON membership.workspace_id=mapping.workspace_id
    JOIN app_users users ON users.user_id=membership.user_id AND users.status='active' WHERE mapping.organization_id=$1`, [row.organization_id])).rows[0]?.count || 0);
  if (row?.organization_id && key === "teams") organizationUsage = Number((await pool.query(`SELECT COUNT(*)::int AS count FROM app_workspace_organizations mapping
    JOIN app_workspace_teams team ON team.workspace_id=mapping.workspace_id WHERE mapping.organization_id=$1`, [row.organization_id])).rows[0]?.count || 0);
  const decision = entitlementDecision({ entitlements, enforcementMode: row?.enforcement_mode || "observe", key, usage: organizationUsage });
  if (decision.wouldBlock && row?.organization_id) await pool.query(`INSERT INTO app_entitlement_observations
    (id,organization_id,workspace_id,entitlement_key,usage_value,limit_value,enforcement_mode) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [randomUUID(), row.organization_id, workspaceId, key, decision.usage, decision.limit, decision.enforcementMode]);
  return decision;
}

export function registerSaasControlPlaneRoutes(app, pool, deps) {
  const { assertSameOrigin, authenticated, recordUserActivity } = deps;
  async function organizationAccess(session, organizationId) {
    if (session.role === "super_user" && !session.is_emulating) return { role: "platform_super", canManage: true };
    const membership = await pool.query("SELECT role FROM app_organization_memberships WHERE organization_id=$1 AND user_id=$2", [organizationId, session.user_id]);
    const workspaceManager = session.membership_role === "administrator" && (await pool.query("SELECT 1 FROM app_workspace_organizations WHERE organization_id=$1 AND workspace_id=$2", [organizationId, session.active_workspace_id])).rowCount > 0;
    return { role: membership.rows[0]?.role || (workspaceManager ? "workspace_administrator" : "member"), canManage: ["owner", "administrator"].includes(membership.rows[0]?.role) || workspaceManager };
  }
  app.get("/api/v1/auth/control-plane", async (request, reply) => {
    const session = await authenticated(pool, request); if (!session) return reply.code(401).send({ error: "sign in required" });
    await ensureInternalCommercialModel(pool);
    const isSuper = session.role === "super_user" && !session.is_emulating;
    const rows = isSuper
      ? await pool.query("SELECT * FROM app_commercial_organizations ORDER BY name")
      : await pool.query(`SELECT organization.* FROM app_commercial_organizations organization JOIN app_workspace_organizations mapping ON mapping.organization_id=organization.organization_id WHERE mapping.workspace_id=$1`, [session.active_workspace_id]);
    let organizations = await Promise.all(rows.rows.map(async (row) => {
      const organization = await organizationPayload(pool, row); const access = await organizationAccess(session, organization.id);
      return { ...organization, organizationRole: access.role, canManageOrganization: access.canManage };
    }));
    if (!isSuper) organizations = organizations.map((organization) => ({
      ...organization, billingEmail: "", members: [], overrides: [],
      serviceRequests: organization.canManageOrganization ? organization.serviceRequests : organization.serviceRequests.filter((item) => String(item.requestedBy) === String(session.user_id)),
      owners: organization.owners.map((owner) => ({ id: owner.id, displayName: owner.displayName })),
    }));
    return { billingEnabled: false, enforcementEnabled: false, mode: "shadow", operatingMode: "manual", paymentCapabilities: false, requestTypes: CUSTOMER_REQUEST_TYPES, plans: COMMERCIAL_PLAN_CATALOG, organizations, activeOrganization: organizations.find((org) => org.workspaces.some((workspace) => String(workspace.id) === String(session.active_workspace_id))) || null, canManage: isSuper };
  });

  app.post("/api/v1/auth/control-plane/organizations/:organizationId/requests", async (request, reply) => {
    if (!assertSameOrigin(request, reply)) return; const session = await authenticated(pool, request); if (!session) return reply.code(401).send({ error: "sign in required" });
    const organizationId = request.params.organizationId; const organization = await pool.query("SELECT * FROM app_commercial_organizations WHERE organization_id=$1", [organizationId]); if (!organization.rowCount) return reply.code(404).send({ error: "organization not found" });
    const access = await organizationAccess(session, organizationId); const attached = access.role === "platform_super" || (await pool.query("SELECT 1 FROM app_workspace_organizations WHERE organization_id=$1 AND workspace_id=$2", [organizationId, session.active_workspace_id])).rowCount > 0;
    if (!attached) return reply.code(403).send({ error: "organization access is required" });
    const type = normalizeCustomerRequestType(request.body?.type); const subject = cleanText(request.body?.subject, 140); const detail = cleanText(request.body?.detail, 4000);
    if (!type || subject.length < 3) return reply.code(400).send({ error: "a valid request type and subject are required" });
    if (!access.canManage && !["support", "data_export"].includes(type)) return reply.code(403).send({ error: "organization manager access is required for this request" });
    const id = randomUUID(); await pool.query(`INSERT INTO app_organization_service_requests
      (request_id,organization_id,workspace_id,request_type,status,subject,detail,requested_by)
      VALUES ($1,$2,$3,$4,'open',$5,$6,$7)`, [id, organizationId, session.active_workspace_id || null, type, subject, detail, session.user_id]);
    await recordUserActivity(pool, session, { eventType: "action", action: "commercial_service_request_created", surface: "workspace-settings", targetType: "organization_request", targetId: id });
    return reply.code(201).send({ organization: await organizationPayload(pool, organization.rows[0]) });
  });

  app.patch("/api/v1/auth/control-plane/organizations/:organizationId/requests/:requestId", async (request, reply) => {
    if (!assertSameOrigin(request, reply)) return; const session = await authenticated(pool, request); if (!session) return reply.code(401).send({ error: "sign in required" });
    const existing = await pool.query("SELECT * FROM app_organization_service_requests WHERE organization_id=$1 AND request_id=$2", [request.params.organizationId, request.params.requestId]); if (!existing.rowCount) return reply.code(404).send({ error: "service request not found" });
    const access = await organizationAccess(session, request.params.organizationId); const row = existing.rows[0]; const status = normalizeCustomerRequestStatus(request.body?.status, row.status);
    const canCancelOwn = String(row.requested_by) === String(session.user_id) && status === "cancelled" && ["open", "waiting"].includes(row.status);
    if (!access.canManage && !canCancelOwn) return reply.code(403).send({ error: "organization manager access is required" });
    const resolutionNote = cleanText(request.body?.resolutionNote ?? row.resolution_note, 2000); const isSuper = session.role === "super_user" && !session.is_emulating; const assignedTo = isSuper ? cleanText(request.body?.assignedTo ?? row.assigned_to, 100) : row.assigned_to;
    if (assignedTo && !(await pool.query("SELECT user_id FROM app_users WHERE user_id=$1 AND status='active'", [assignedTo])).rowCount) return reply.code(400).send({ error: "assignee must be an active account" });
    await pool.query(`UPDATE app_organization_service_requests SET status=$1,assigned_to=$2,resolution_note=$3,resolved_at=$4,updated_at=NOW() WHERE request_id=$5`,
      [status, assignedTo || null, resolutionNote, ["resolved", "cancelled"].includes(status) ? new Date() : null, request.params.requestId]);
    await recordUserActivity(pool, session, { eventType: "action", action: "commercial_service_request_updated", surface: "workspace-settings", targetType: "organization_request", targetId: request.params.requestId });
    return { organization: await organizationPayload(pool, (await pool.query("SELECT * FROM app_commercial_organizations WHERE organization_id=$1", [request.params.organizationId])).rows[0]) };
  });

  app.patch("/api/v1/auth/control-plane/organizations/:organizationId/onboarding/:stepKey", async (request, reply) => {
    if (!assertSameOrigin(request, reply)) return; const session = await authenticated(pool, request); if (!session) return reply.code(401).send({ error: "sign in required" });
    const organization = await pool.query("SELECT * FROM app_commercial_organizations WHERE organization_id=$1", [request.params.organizationId]); if (!organization.rowCount) return reply.code(404).send({ error: "organization not found" });
    const access = await organizationAccess(session, request.params.organizationId); if (!access.canManage) return reply.code(403).send({ error: "organization manager access is required" });
    if (!CUSTOMER_ONBOARDING_STEPS.some((step) => step.key === request.params.stepKey)) return reply.code(400).send({ error: "onboarding step is not available" });
    const status = normalizeOnboardingStatus(request.body?.status); const note = cleanText(request.body?.note, 1000);
    await pool.query(`INSERT INTO app_organization_onboarding_steps(organization_id,step_key,status,note,updated_by) VALUES ($1,$2,$3,$4,$5)
      ON CONFLICT(organization_id,step_key) DO UPDATE SET status=EXCLUDED.status,note=EXCLUDED.note,updated_by=EXCLUDED.updated_by,updated_at=NOW()`,
    [request.params.organizationId, request.params.stepKey, status, note, session.user_id]);
    await recordUserActivity(pool, session, { eventType: "action", action: "commercial_onboarding_updated", surface: "workspace-settings", targetType: "organization", targetId: request.params.organizationId });
    return { organization: await organizationPayload(pool, organization.rows[0]) };
  });

  app.put("/api/v1/auth/control-plane/organizations/:organizationId/entitlements", async (request, reply) => {
    if (!assertSameOrigin(request, reply)) return; const session = await authenticated(pool, request); if (!session) return reply.code(401).send({ error: "sign in required" });
    if (session.role !== "super_user" || session.is_emulating) return reply.code(403).send({ error: "Super user access is required" });
    const organization = await pool.query("SELECT * FROM app_commercial_organizations WHERE organization_id=$1", [request.params.organizationId]); if (!organization.rowCount) return reply.code(404).send({ error: "organization not found" });
    const current = await organizationPayload(pool, organization.rows[0]); const defaults = planById(current.subscription.planId).entitlements;
    const values = request.body?.overrides && typeof request.body.overrides === "object" && !Array.isArray(request.body.overrides) ? request.body.overrides : {}; const notes = request.body?.notes && typeof request.body.notes === "object" ? request.body.notes : {};
    const client = await pool.connect(); try { await client.query("BEGIN"); await client.query("DELETE FROM app_organization_entitlement_overrides WHERE organization_id=$1", [request.params.organizationId]);
      for (const [key, rawValue] of Object.entries(values)) { if (!(key in defaults)) continue; const value = typeof defaults[key] === "boolean" ? Boolean(rawValue) : Math.max(0, Math.trunc(Number(rawValue) || 0));
        await client.query(`INSERT INTO app_organization_entitlement_overrides(organization_id,entitlement_key,value_json,note,updated_by) VALUES ($1,$2,$3::jsonb,$4,$5)`, [request.params.organizationId, key, JSON.stringify(value), cleanText(notes[key], 500), session.user_id]); }
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
    await recordUserActivity(pool, session, { eventType: "action", action: "commercial_entitlements_updated", surface: "workspaces", targetType: "organization", targetId: request.params.organizationId });
    return { organization: await organizationPayload(pool, organization.rows[0]) };
  });

  app.post("/api/v1/auth/control-plane/organizations", async (request, reply) => {
    if (!assertSameOrigin(request, reply)) return; const session = await authenticated(pool, request);
    if (!session) return reply.code(401).send({ error: "sign in required" }); if (session.role !== "super_user" || session.is_emulating) return reply.code(403).send({ error: "Super user access is required" });
    const name = cleanText(request.body?.name, 100); const slug = slugify(request.body?.slug || name); const billingEmail = normalizeEmail(request.body?.billingEmail || "");
    if (name.length < 2 || !slug) return reply.code(400).send({ error: "a valid organization name is required" });
    if (request.body?.billingEmail && !billingEmail) return reply.code(400).send({ error: "billing contact must be a valid email address" });
    const planId = COMMERCIAL_PLAN_CATALOG.some((plan) => plan.id === request.body?.planId) ? request.body.planId : "pilot";
    const lifecycle = normalizeLifecycleState(request.body?.lifecycleState,"prospect");
    const id = randomUUID(); const ownerUserId = cleanText(request.body?.ownerUserId || session.user_id, 100);
    const workspaceIds = [...new Set((Array.isArray(request.body?.workspaceIds) ? request.body.workspaceIds : []).map((value) => cleanText(value, 100)).filter(Boolean))];
    const [owner, workspaceCount] = await Promise.all([
      pool.query("SELECT user_id FROM app_users WHERE user_id=$1 AND status='active'", [ownerUserId]),
      workspaceIds.length ? pool.query("SELECT COUNT(*)::int AS count FROM app_workspaces WHERE workspace_id=ANY($1::uuid[])", [workspaceIds]) : Promise.resolve({ rows: [{ count: 0 }] }),
    ]);
    if (!owner.rowCount) return reply.code(400).send({ error: "organization owner must be an active account" });
    if (Number(workspaceCount.rows[0]?.count || 0) !== workspaceIds.length) return reply.code(400).send({ error: "one or more workspaces do not exist" });
    const client = await pool.connect(); try { await client.query("BEGIN");
      await client.query(`INSERT INTO app_commercial_organizations (organization_id,name,slug,lifecycle_state,billing_email,created_by) VALUES ($1,$2,$3,$4,$5,$6)`, [id,name,slug,lifecycle,billingEmail,session.user_id]);
      await client.query(`INSERT INTO app_organization_memberships (organization_id,user_id,role,created_by) VALUES ($1,$2,'owner',$3)`, [id,ownerUserId,session.user_id]);
      await client.query(`INSERT INTO app_organization_subscriptions (organization_id,plan_id,status,enforcement_mode,source,updated_by) VALUES ($1,$2,$3,'observe','manual',$4)`, [id,planId,lifecycle,session.user_id]);
      for (const step of CUSTOMER_ONBOARDING_STEPS) await client.query(`INSERT INTO app_organization_onboarding_steps(organization_id,step_key,status,note,updated_by) VALUES ($1,$2,'pending','',$3)`, [id, step.key, session.user_id]);
      for (const workspaceId of workspaceIds) await client.query(`INSERT INTO app_workspace_organizations (workspace_id,organization_id) VALUES ($1,$2)
        ON CONFLICT(workspace_id) DO UPDATE SET organization_id=EXCLUDED.organization_id,updated_at=NOW()`, [workspaceId,id]);
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK"); if (error.code === "23505") return reply.code(409).send({ error: "an organization with that name already exists" }); throw error; } finally { client.release(); }
    await recordUserActivity(pool, session, { eventType: "action", action: "commercial_organization_created", surface: "workspaces", targetType: "organization", targetId: id });
    return reply.code(201).send({ organization: await organizationPayload(pool, (await pool.query("SELECT * FROM app_commercial_organizations WHERE organization_id=$1", [id])).rows[0]) });
  });

  app.patch("/api/v1/auth/control-plane/organizations/:organizationId", async (request, reply) => {
    if (!assertSameOrigin(request, reply)) return; const session = await authenticated(pool, request);
    if (!session) return reply.code(401).send({ error: "sign in required" }); if (session.role !== "super_user" || session.is_emulating) return reply.code(403).send({ error: "Super user access is required" });
    const existing = await pool.query("SELECT * FROM app_commercial_organizations WHERE organization_id=$1", [request.params.organizationId]); if (!existing.rowCount) return reply.code(404).send({ error: "organization not found" });
    const current = existing.rows[0]; const name = cleanText(request.body?.name ?? current.name,100); const billingEmail = normalizeEmail(request.body?.billingEmail ?? current.billing_email); const lifecycle = normalizeLifecycleState(request.body?.lifecycleState,current.lifecycle_state);
    if (request.body?.billingEmail && !billingEmail) return reply.code(400).send({ error: "billing contact must be a valid email address" });
    if (request.body?.planId && !COMMERCIAL_PLAN_CATALOG.some((plan) => plan.id === request.body.planId)) return reply.code(400).send({ error: "commercial plan is not available" });
    const currentSubscription = await pool.query("SELECT plan_id FROM app_organization_subscriptions WHERE organization_id=$1", [request.params.organizationId]);
    const planId = request.body?.planId || currentSubscription.rows[0]?.plan_id || "internal"; const enforcementMode = "observe"; const ownerUserId = cleanText(request.body?.ownerUserId,100); const workspaceIds = [...new Set((Array.isArray(request.body?.workspaceIds) ? request.body.workspaceIds : []).map((id) => cleanText(id,100)).filter(Boolean))];
    const [owner, workspaceCount] = await Promise.all([
      ownerUserId ? pool.query("SELECT user_id FROM app_users WHERE user_id=$1 AND status='active'", [ownerUserId]) : Promise.resolve({ rowCount: 1 }),
      workspaceIds.length ? pool.query("SELECT COUNT(*)::int AS count FROM app_workspaces WHERE workspace_id=ANY($1::uuid[])", [workspaceIds]) : Promise.resolve({ rows: [{ count: 0 }] }),
    ]);
    if (!owner.rowCount) return reply.code(400).send({ error: "organization owner must be an active account" });
    if (Number(workspaceCount.rows[0]?.count || 0) !== workspaceIds.length) return reply.code(400).send({ error: "one or more workspaces do not exist" });
    const client = await pool.connect(); try { await client.query("BEGIN");
      await client.query("UPDATE app_commercial_organizations SET name=$1,lifecycle_state=$2,billing_email=$3,updated_at=NOW() WHERE organization_id=$4", [name,lifecycle,billingEmail,request.params.organizationId]);
      await client.query(`INSERT INTO app_organization_subscriptions (organization_id,plan_id,status,enforcement_mode,source,updated_by) VALUES ($1,$2,$3,$4,'manual',$5)
        ON CONFLICT(organization_id) DO UPDATE SET plan_id=EXCLUDED.plan_id,status=EXCLUDED.status,enforcement_mode=EXCLUDED.enforcement_mode,updated_by=EXCLUDED.updated_by,updated_at=NOW()`, [request.params.organizationId,planId,lifecycle === "internal" ? "internal" : lifecycle,enforcementMode,session.user_id]);
      if (ownerUserId) { await client.query("DELETE FROM app_organization_memberships WHERE organization_id=$1 AND role='owner'", [request.params.organizationId]); await client.query(`INSERT INTO app_organization_memberships (organization_id,user_id,role,created_by) VALUES ($1,$2,'owner',$3) ON CONFLICT(organization_id,user_id) DO UPDATE SET role='owner',updated_at=NOW()`, [request.params.organizationId,ownerUserId,session.user_id]); }
      if (Array.isArray(request.body?.workspaceIds)) { await client.query("DELETE FROM app_workspace_organizations WHERE organization_id=$1", [request.params.organizationId]); for (const workspaceId of workspaceIds) await client.query(`INSERT INTO app_workspace_organizations (workspace_id,organization_id) VALUES ($1,$2) ON CONFLICT(workspace_id) DO UPDATE SET organization_id=EXCLUDED.organization_id,updated_at=NOW()`, [workspaceId,request.params.organizationId]); }
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
    await recordUserActivity(pool, session, { eventType: "action", action: "commercial_organization_updated", surface: "workspaces", targetType: "organization", targetId: request.params.organizationId });
    return { organization: await organizationPayload(pool, (await pool.query("SELECT * FROM app_commercial_organizations WHERE organization_id=$1", [request.params.organizationId])).rows[0]) };
  });
}
