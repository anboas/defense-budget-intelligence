import { randomUUID } from "node:crypto";
import {
  COMMERCIAL_PLAN_CATALOG,
  entitlementDecision,
  entitlementRows,
  normalizeEntitlements,
  normalizeLifecycleState,
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
  const [members, workspaces, subscription, overrides, uniqueSeats] = await Promise.all([
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
    usage, entitlements, entitlementRows: entitlementRows(entitlements, usage),
    onboarding: { ownerAssigned: members.rows.some((row) => row.role === "owner"), workspaceAttached: workspaces.rowCount > 0, billingContactSet: Boolean(organization.billing_email), enforcementReady: false },
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
  app.get("/api/v1/auth/control-plane", async (request, reply) => {
    const session = await authenticated(pool, request); if (!session) return reply.code(401).send({ error: "sign in required" });
    await ensureInternalCommercialModel(pool);
    const isSuper = session.role === "super_user" && !session.is_emulating;
    const rows = isSuper
      ? await pool.query("SELECT * FROM app_commercial_organizations ORDER BY name")
      : await pool.query(`SELECT organization.* FROM app_commercial_organizations organization JOIN app_workspace_organizations mapping ON mapping.organization_id=organization.organization_id WHERE mapping.workspace_id=$1`, [session.active_workspace_id]);
    let organizations = await Promise.all(rows.rows.map((row) => organizationPayload(pool, row)));
    if (!isSuper) organizations = organizations.map((organization) => ({ ...organization, billingEmail: "", members: [], owners: organization.owners.map((owner) => ({ id: owner.id, displayName: owner.displayName })) }));
    return { billingEnabled: false, enforcementEnabled: false, mode: "shadow", plans: COMMERCIAL_PLAN_CATALOG, organizations, activeOrganization: organizations.find((org) => org.workspaces.some((workspace) => String(workspace.id) === String(session.active_workspace_id))) || null, canManage: isSuper };
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
