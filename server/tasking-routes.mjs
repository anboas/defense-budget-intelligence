import { accessCapabilities } from "../src/access-model.js";

export function registerTaskingRoutes(app, pool, { assertSameOrigin, authenticated }) {
  app.get("/api/v1/auth/tasking", async (request, reply) => {
    if (!assertSameOrigin(request, reply)) return;
    const user = await authenticated(pool, request);
    if (!user) return reply.code(401).send({ error: "sign in required" });
    if (!user.active_workspace_id) return reply.code(409).send({ error: "select a workspace before using Tasking" });
    return { tasks: [] };
  });

  const retired = async (request, reply) => {
    if (!assertSameOrigin(request, reply)) return;
    const user = await authenticated(pool, request);
    if (!user) return reply.code(401).send({ error: "sign in required" });
    if (!user.active_workspace_id) return reply.code(409).send({ error: "select a workspace before using Tasking" });
    if (!accessCapabilities(user.role, user.membership_role, { isEmulating: Boolean(user.is_emulating) }).canWriteWorkspace) return reply.code(403).send({ error: "workspace write access is required" });
    return reply.code(410).send({ error: "legacy Tasking overrides are retired; use /api/v1/agent/tasking/tasks", code: "legacy_tasking_retired" });
  };

  app.patch("/api/v1/auth/tasking/:taskId", retired);
  app.delete("/api/v1/auth/tasking/:taskId", retired);
}
