import { accessCapabilities } from "./access-model.js";
import { cleanText, sameOriginRequest } from "./security-policy.js";
import { taskingTaskFromRow, taskingTaskMutation } from "./tasking-model.js";

export const D1_TASKING_SCHEMA = Object.freeze([
  `CREATE TABLE IF NOT EXISTS dbi_workspace_tasking_tasks (
    workspace_id TEXT NOT NULL,
    task_id TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    status TEXT NOT NULL,
    owner TEXT NOT NULL,
    acceptance TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    updated_by TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (workspace_id, task_id)
  )`,
  "CREATE INDEX IF NOT EXISTS idx_dbi_tasking_tasks_workspace_status ON dbi_workspace_tasking_tasks (workspace_id, status, updated_at DESC)",
]);

async function rowsForWorkspace(db, workspaceId) {
  const result = await db.prepare("SELECT * FROM dbi_workspace_tasking_tasks WHERE workspace_id = ? ORDER BY updated_at DESC").bind(workspaceId).all();
  return (result.results || []).map(taskingTaskFromRow).filter(Boolean);
}

export async function taskingResponse(request, db, { json, recordActivity, safeJson, sessionUser }) {
  if (!sameOriginRequest(request)) return json({ error: "Cross-origin tasking access is not allowed" }, 403);
  const user = await sessionUser(db, request);
  if (!user) return json({ error: "Sign in required" }, 401);
  const workspaceId = user.active_workspace_id;
  if (!workspaceId) return json({ error: "Select a workspace before using Tasking" }, 409);
  const relative = new URL(request.url).pathname.replace(/\/+$/, "").slice("/api/v1/auth/tasking".length).replace(/^\//, "");
  const taskId = cleanText(decodeURIComponent(relative), 120);

  if (request.method === "GET" && !taskId) return json({ tasks: await rowsForWorkspace(db, workspaceId) });
  if (!taskId) return json({ error: "Task ID is required" }, 400);
  if (!accessCapabilities(user.role, user.membership_role, { isEmulating: Boolean(user.is_emulating) }).canWriteWorkspace) return json({ error: "Workspace write access is required" }, 403);

  const existingRow = await db.prepare("SELECT * FROM dbi_workspace_tasking_tasks WHERE workspace_id = ? AND task_id = ?").bind(workspaceId, taskId).first();
  const existing = taskingTaskFromRow(existingRow);
  if (request.method === "PATCH") {
    const body = await safeJson(request);
    if (!body) return json({ error: "A valid task update is required" }, 400);
    const expectedVersion = Number(body.version ?? 0);
    if (expectedVersion !== Number(existing?.version || 0)) return json({ error: "Task changed since it was opened", code: "version_conflict", task: existing }, 409);
    const mutation = taskingTaskMutation(taskId, body, existing);
    if (mutation.error) return json({ error: mutation.error }, 400);
    const now = new Date().toISOString();
    const actorId = user.actor_user_id || user.user_id;
    const nextVersion = expectedVersion + 1;
    const task = mutation.task;
    const changed = existing
      ? await db.prepare(`UPDATE dbi_workspace_tasking_tasks SET title=?, description=?, status=?, owner=?, acceptance=?, version=?, updated_by=?, updated_at=?
          WHERE workspace_id=? AND task_id=? AND version=?`).bind(task.title, task.description, task.status, task.owner, task.acceptance, nextVersion, actorId, now, workspaceId, taskId, expectedVersion).run()
      : await db.prepare(`INSERT OR IGNORE INTO dbi_workspace_tasking_tasks
          (workspace_id,task_id,title,description,status,owner,acceptance,version,updated_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
          .bind(workspaceId, taskId, task.title, task.description, task.status, task.owner, task.acceptance, nextVersion, actorId, now, now).run();
    if (!Number(changed?.meta?.changes || 0)) return json({ error: "Task changed since it was opened", code: "version_conflict" }, 409);
    await recordActivity(db, { type: "user", id: user.user_id, actorId, isEmulating: Boolean(user.is_emulating), workspaceId }, "tasking_task_updated", "task", taskId, { status: task.status, version: nextVersion });
    const stored = await db.prepare("SELECT * FROM dbi_workspace_tasking_tasks WHERE workspace_id = ? AND task_id = ?").bind(workspaceId, taskId).first();
    return json({ task: taskingTaskFromRow(stored) });
  }
  if (request.method === "DELETE") {
    const expectedVersion = Number(new URL(request.url).searchParams.get("version") || 0);
    if (!existing) return new Response(null, { status: 204 });
    if (expectedVersion !== existing.version) return json({ error: "Task changed since it was opened", code: "version_conflict", task: existing }, 409);
    const changed = await db.prepare("DELETE FROM dbi_workspace_tasking_tasks WHERE workspace_id=? AND task_id=? AND version=?").bind(workspaceId, taskId, expectedVersion).run();
    if (!Number(changed?.meta?.changes || 0)) return json({ error: "Task changed since it was opened", code: "version_conflict" }, 409);
    await recordActivity(db, { type: "user", id: user.user_id, actorId: user.actor_user_id || user.user_id, isEmulating: Boolean(user.is_emulating), workspaceId }, "tasking_task_reset", "task", taskId, {});
    return new Response(null, { status: 204 });
  }
  return json({ error: "Method not allowed" }, 405);
}
