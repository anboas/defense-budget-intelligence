import { accessCapabilities } from "../src/access-model.js";
import { cleanText } from "../src/security-policy.js";
import { taskingTaskFromRow, taskingTaskMutation } from "../src/tasking-model.js";

function serialize(row) {
  return taskingTaskFromRow(row);
}

export function registerTaskingRoutes(app, pool, { assertSameOrigin, authenticated, recordUserActivity }) {
  app.get("/api/v1/auth/tasking", async (request, reply) => {
    if (!assertSameOrigin(request, reply)) return;
    const user = await authenticated(pool, request);
    if (!user) return reply.code(401).send({ error: "sign in required" });
    if (!user.active_workspace_id) return reply.code(409).send({ error: "select a workspace before using Tasking" });
    const result = await pool.query("SELECT * FROM app_tasking_tasks WHERE workspace_id = $1 ORDER BY updated_at DESC", [user.active_workspace_id]);
    return { tasks: result.rows.map(serialize).filter(Boolean) };
  });

  app.patch("/api/v1/auth/tasking/:taskId", async (request, reply) => {
    if (!assertSameOrigin(request, reply)) return;
    const user = await authenticated(pool, request);
    if (!user) return reply.code(401).send({ error: "sign in required" });
    if (!user.active_workspace_id) return reply.code(409).send({ error: "select a workspace before using Tasking" });
    if (!accessCapabilities(user.role, user.membership_role, { isEmulating: Boolean(user.is_emulating) }).canWriteWorkspace) return reply.code(403).send({ error: "workspace write access is required" });
    const taskId = cleanText(request.params.taskId, 120);
    const currentResult = await pool.query("SELECT * FROM app_tasking_tasks WHERE workspace_id = $1 AND task_id = $2", [user.active_workspace_id, taskId]);
    const current = serialize(currentResult.rows[0]);
    const expectedVersion = Number(request.body?.version ?? 0);
    if (expectedVersion !== Number(current?.version || 0)) return reply.code(409).send({ error: "task changed since it was opened", code: "version_conflict", task: current });
    const mutation = taskingTaskMutation(taskId, request.body, current);
    if (mutation.error) return reply.code(400).send({ error: mutation.error });
    const task = mutation.task;
    const result = await pool.query(`INSERT INTO app_tasking_tasks
      (workspace_id,task_id,title,description,status,owner,acceptance,version,updated_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7,1,$8)
      ON CONFLICT (workspace_id,task_id) DO UPDATE SET title=EXCLUDED.title, description=EXCLUDED.description,
        status=EXCLUDED.status, owner=EXCLUDED.owner, acceptance=EXCLUDED.acceptance,
        version=app_tasking_tasks.version+1, updated_by=EXCLUDED.updated_by, updated_at=NOW()
      WHERE app_tasking_tasks.version=$9
      RETURNING *`, [user.active_workspace_id, taskId, task.title, task.description, task.status, task.owner, task.acceptance, user.actor_user_id || user.user_id, expectedVersion]);
    if (!result.rowCount) return reply.code(409).send({ error: "task changed since it was opened", code: "version_conflict" });
    await recordUserActivity(pool, user, { eventType: "action", action: "tasking_task_updated", surface: "tasking", targetType: "task", targetId: taskId });
    return { task: serialize(result.rows[0]) };
  });

  app.delete("/api/v1/auth/tasking/:taskId", async (request, reply) => {
    if (!assertSameOrigin(request, reply)) return;
    const user = await authenticated(pool, request);
    if (!user) return reply.code(401).send({ error: "sign in required" });
    if (!user.active_workspace_id) return reply.code(409).send({ error: "select a workspace before using Tasking" });
    if (!accessCapabilities(user.role, user.membership_role, { isEmulating: Boolean(user.is_emulating) }).canWriteWorkspace) return reply.code(403).send({ error: "workspace write access is required" });
    const taskId = cleanText(request.params.taskId, 120);
    const expectedVersion = Number(request.query?.version || 0);
    const result = await pool.query("DELETE FROM app_tasking_tasks WHERE workspace_id=$1 AND task_id=$2 AND version=$3", [user.active_workspace_id, taskId, expectedVersion]);
    if (!result.rowCount) {
      const existing = await pool.query("SELECT version FROM app_tasking_tasks WHERE workspace_id=$1 AND task_id=$2", [user.active_workspace_id, taskId]);
      if (existing.rowCount) return reply.code(409).send({ error: "task changed since it was opened", code: "version_conflict" });
      return reply.code(204).send();
    }
    await recordUserActivity(pool, user, { eventType: "action", action: "tasking_task_reset", surface: "tasking", targetType: "task", targetId: taskId });
    return reply.code(204).send();
  });
}
