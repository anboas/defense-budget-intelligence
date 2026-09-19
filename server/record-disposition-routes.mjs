import { accessCapabilities } from "../src/access-model.js";
import { cleanText } from "../src/security-policy.js";

function publicRow(row) {
  return { recordId: row.record_id, disposition: row.disposition, reason: row.reason || "", createdBy: row.created_by, createdAt: row.created_at, updatedAt: row.updated_at };
}

export function registerRecordDispositionRoutes(app, pool, { assertSameOrigin, authenticated }) {
  app.get("/api/v1/agent/record-dispositions", async (request, reply) => {
    const user = await authenticated(pool, request);
    if (!user) return reply.code(401).send({ error: "sign in required" });
    if (!user.active_workspace_id) return { data: [], meta: { total: 0 } };
    const result = await pool.query(`SELECT record_id, disposition, reason, created_by, created_at, updated_at
      FROM app_workspace_record_dispositions WHERE workspace_id = $1 ORDER BY updated_at DESC`, [user.active_workspace_id]);
    return { data: result.rows.map(publicRow), meta: { total: result.rowCount } };
  });

  app.put("/api/v1/agent/record-dispositions/:recordId", async (request, reply) => {
    if (!assertSameOrigin(request, reply)) return;
    const user = await authenticated(pool, request);
    if (!user) return reply.code(401).send({ error: "sign in required" });
    if (!user.active_workspace_id) return reply.code(409).send({ error: "select a workspace first" });
    if (!accessCapabilities(user.role, user.membership_role, { isEmulating: Boolean(user.is_emulating) }).canWriteWorkspace) return reply.code(403).send({ error: "workspace write access is required" });
    if (cleanText(request.body?.disposition, 40) !== "tombstoned") return reply.code(400).send({ error: "only the tombstoned disposition is supported" });
    const recordId = cleanText(request.params.recordId, 180);
    if (!recordId) return reply.code(400).send({ error: "a stable record ID is required" });
    const result = await pool.query(`INSERT INTO app_workspace_record_dispositions
      (workspace_id, record_id, disposition, reason, created_by)
      VALUES ($1, $2, 'tombstoned', $3, $4)
      ON CONFLICT (workspace_id, record_id) DO UPDATE SET disposition = 'tombstoned', reason = EXCLUDED.reason, updated_at = NOW()
      RETURNING record_id, disposition, reason, created_by, created_at, updated_at`, [user.active_workspace_id, recordId, cleanText(request.body?.reason, 500), user.actor_user_id || user.user_id]);
    return { data: publicRow(result.rows[0]) };
  });

  app.delete("/api/v1/agent/record-dispositions/:recordId", async (request, reply) => {
    if (!assertSameOrigin(request, reply)) return;
    const user = await authenticated(pool, request);
    if (!user) return reply.code(401).send({ error: "sign in required" });
    if (!user.active_workspace_id) return reply.code(409).send({ error: "select a workspace first" });
    if (!accessCapabilities(user.role, user.membership_role, { isEmulating: Boolean(user.is_emulating) }).canWriteWorkspace) return reply.code(403).send({ error: "workspace write access is required" });
    const result = await pool.query("DELETE FROM app_workspace_record_dispositions WHERE workspace_id = $1 AND record_id = $2 RETURNING record_id", [user.active_workspace_id, cleanText(request.params.recordId, 180)]);
    if (!result.rowCount) return reply.code(404).send({ error: "tombstoned record not found" });
    return reply.code(204).send();
  });
}
