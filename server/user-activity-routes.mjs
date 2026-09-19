import { randomUUID } from "node:crypto";
import { cleanText } from "../src/security-policy.js";

const RETAINED_LIMIT = 500;
const PAGE_BUCKET_MS = 15 * 60 * 1000;

function safeSurface(value) {
  const surface = cleanText(value, 80).toLowerCase();
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(surface) ? surface : "";
}

function activityPayload(row) {
  return {
    id: row.id,
    workspaceId: row.workspace_id || null,
    workspaceName: row.workspace_name || "No workspace",
    actorUserId: row.actor_user_id || null,
    actorName: row.actor_name || "Deleted account",
    effectiveUserId: row.effective_user_id || null,
    effectiveUserName: row.effective_name || row.actor_name || "Deleted account",
    eventType: row.event_type,
    action: row.action,
    surface: row.surface || "",
    targetType: row.target_type || "",
    targetId: row.target_id || "",
    visitCount: Number(row.visit_count || 1),
    occurredAt: row.occurred_at,
  };
}

export async function recordUserActivity(pool, session, entry = {}) {
  if (!session?.actor_user_id && !session?.user_id) return;
  const eventType = entry.eventType === "page_visit" ? "page_visit" : "action";
  const action = cleanText(entry.action || (eventType === "page_visit" ? "page_viewed" : "action_completed"), 80);
  const surface = safeSurface(entry.surface);
  const targetType = cleanText(entry.targetType, 80);
  const targetId = cleanText(entry.targetId, 180);
  const actorUserId = session.actor_user_id || session.user_id;
  const effectiveUserId = session.user_id;
  const workspaceId = session.active_workspace_id || null;
  const now = new Date();
  const bucket = eventType === "page_visit" ? Math.floor(now.getTime() / PAGE_BUCKET_MS) : randomUUID();
  const dedupeKey = eventType === "page_visit"
    ? [actorUserId, effectiveUserId, workspaceId || "none", surface || "unknown", bucket].join(":")
    : randomUUID();
  await pool.query(`INSERT INTO app_user_activity
    (id, workspace_id, actor_user_id, effective_user_id, event_type, action, surface, target_type, target_id, detail_json, visit_count, dedupe_key, occurred_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'{}'::jsonb,1,$10,$11)
    ON CONFLICT (dedupe_key) DO UPDATE SET visit_count=app_user_activity.visit_count+1, occurred_at=EXCLUDED.occurred_at`, [
    randomUUID(), workspaceId, actorUserId, effectiveUserId, eventType, action, surface, targetType, targetId, dedupeKey, now,
  ]);
}

export function registerUserActivityRoutes(app, pool, deps) {
  const { assertSameOrigin, authenticated } = deps;
  app.get("/api/v1/auth/activity", async (request, reply) => {
    const session = await authenticated(pool, request);
    if (!session) return reply.code(401).send({ error: "sign in required" });
    if (session.is_emulating || session.actor_role !== "super_user" || session.role !== "super_user") return reply.code(403).send({ error: "Super user access is required" });
    const result = await pool.query(`SELECT activity.*, workspace.name AS workspace_name,
      actor.display_name AS actor_name, effective.display_name AS effective_name
      FROM app_user_activity activity
      LEFT JOIN app_workspaces workspace ON workspace.workspace_id=activity.workspace_id
      LEFT JOIN app_users actor ON actor.user_id=activity.actor_user_id
      LEFT JOIN app_users effective ON effective.user_id=activity.effective_user_id
      ORDER BY activity.occurred_at DESC LIMIT $1`, [RETAINED_LIMIT]);
    return { activities: result.rows.map(activityPayload), retentionDays: 90 };
  });

  app.post("/api/v1/auth/activity", async (request, reply) => {
    if (!assertSameOrigin(request, reply)) return;
    const session = await authenticated(pool, request);
    if (!session) return reply.code(401).send({ error: "sign in required" });
    if (request.body?.eventType !== "page_visit") return reply.code(400).send({ error: "only page visits may be reported by the browser" });
    const surface = safeSurface(request.body?.surface);
    if (!surface) return reply.code(400).send({ error: "a valid application surface is required" });
    await recordUserActivity(pool, session, { eventType: "page_visit", action: "page_viewed", surface });
    return reply.code(202).send({ ok: true });
  });
}
