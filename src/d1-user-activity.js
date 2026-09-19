import { cleanText, sameOriginRequest } from "./security-policy.js";

const RETAINED_LIMIT = 500;
const PAGE_BUCKET_MS = 15 * 60 * 1000;

export const D1_USER_ACTIVITY_SCHEMA = Object.freeze([
  `CREATE TABLE IF NOT EXISTS dbi_user_activity (
    id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL DEFAULT '', actor_user_id TEXT NOT NULL DEFAULT '',
    effective_user_id TEXT NOT NULL DEFAULT '', event_type TEXT NOT NULL CHECK (event_type IN ('page_visit', 'action')),
    action TEXT NOT NULL, surface TEXT NOT NULL DEFAULT '', target_type TEXT NOT NULL DEFAULT '', target_id TEXT NOT NULL DEFAULT '',
    detail_json TEXT NOT NULL DEFAULT '{}', visit_count INTEGER NOT NULL DEFAULT 1, dedupe_key TEXT NOT NULL UNIQUE, occurred_at TEXT NOT NULL
  )`,
  "CREATE INDEX IF NOT EXISTS idx_dbi_user_activity_at ON dbi_user_activity (occurred_at DESC)",
  "CREATE INDEX IF NOT EXISTS idx_dbi_user_activity_actor_at ON dbi_user_activity (actor_user_id, occurred_at DESC)",
  "CREATE INDEX IF NOT EXISTS idx_dbi_user_activity_action_at ON dbi_user_activity (action, occurred_at DESC)",
  "CREATE INDEX IF NOT EXISTS idx_dbi_user_activity_workspace_at ON dbi_user_activity (workspace_id, occurred_at DESC)",
]);

function safeSurface(value) {
  const surface = cleanText(value, 80).toLowerCase();
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(surface) ? surface : "";
}

function rowPayload(row) {
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

export async function recordUserActivityD1(db, session, entry = {}) {
  if (!session?.actor_user_id && !session?.user_id) return;
  const eventType = entry.eventType === "page_visit" ? "page_visit" : "action";
  const action = cleanText(entry.action || (eventType === "page_visit" ? "page_viewed" : "action_completed"), 80);
  const surface = safeSurface(entry.surface);
  const actorUserId = session.actor_user_id || session.user_id;
  const effectiveUserId = session.user_id;
  const workspaceId = session.active_workspace_id || "";
  const now = new Date();
  const dedupeKey = eventType === "page_visit"
    ? [actorUserId, effectiveUserId, workspaceId || "none", surface || "unknown", Math.floor(now.getTime() / PAGE_BUCKET_MS)].join(":")
    : crypto.randomUUID();
  await db.prepare(`INSERT INTO dbi_user_activity
    (id, workspace_id, actor_user_id, effective_user_id, event_type, action, surface, target_type, target_id, detail_json, visit_count, dedupe_key, occurred_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '{}', 1, ?, ?)
    ON CONFLICT(dedupe_key) DO UPDATE SET visit_count=dbi_user_activity.visit_count+1, occurred_at=excluded.occurred_at`)
    .bind(crypto.randomUUID(), workspaceId, actorUserId, effectiveUserId, eventType, action, surface,
      cleanText(entry.targetType, 80), cleanText(entry.targetId, 180), dedupeKey, now.toISOString()).run();
}

export async function userActivityResponse(request, db, deps) {
  const { json, safeJson, sessionUser } = deps;
  if (!sameOriginRequest(request)) return json({ error: "Cross-origin activity reporting is not allowed" }, 403);
  const session = await sessionUser(db, request);
  if (!session) return json({ error: "Sign in required" }, 401);
  if (request.method === "GET") {
    if (session.is_emulating || session.actor_role !== "super_user" || session.role !== "super_user") return json({ error: "Super user access is required" }, 403);
    const result = await db.prepare(`SELECT activity.*, workspace.name AS workspace_name,
      actor.display_name AS actor_name, effective.display_name AS effective_name
      FROM dbi_user_activity activity
      LEFT JOIN dbi_workspaces workspace ON workspace.workspace_id=activity.workspace_id
      LEFT JOIN dbi_users actor ON actor.user_id=activity.actor_user_id
      LEFT JOIN dbi_users effective ON effective.user_id=activity.effective_user_id
      ORDER BY activity.occurred_at DESC LIMIT ?`).bind(RETAINED_LIMIT).all();
    return json({ activities: (result.results || []).map(rowPayload), retentionDays: 90 });
  }
  if (request.method === "POST") {
    const body = await safeJson(request);
    if (body?.eventType !== "page_visit") return json({ error: "Only page visits may be reported by the browser" }, 400);
    const surface = safeSurface(body?.surface);
    if (!surface) return json({ error: "A valid application surface is required" }, 400);
    await recordUserActivityD1(db, session, { eventType: "page_visit", action: "page_viewed", surface });
    return json({ ok: true }, 202);
  }
  return json({ error: "Method not allowed" }, 405);
}
