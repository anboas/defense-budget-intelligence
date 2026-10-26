import { accessCapabilities } from "./access-model.js";
import { sameOriginRequest } from "./security-policy.js";

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

export async function taskingResponse(request, db, { json, sessionUser }) {
  if (!sameOriginRequest(request)) return json({ error: "Cross-origin tasking access is not allowed" }, 403);
  const user = await sessionUser(db, request);
  if (!user) return json({ error: "Sign in required" }, 401);
  if (!user.active_workspace_id) return json({ error: "Select a workspace before using Tasking" }, 409);
  if (request.method === "GET") return json({ tasks: [] });
  if (!accessCapabilities(user.role, user.membership_role, { isEmulating: Boolean(user.is_emulating) }).canWriteWorkspace) return json({ error: "Workspace write access is required" }, 403);
  return json({ error: "Legacy Tasking overrides are retired; use /api/v1/agent/tasking/tasks", code: "legacy_tasking_retired" }, 410);
}
