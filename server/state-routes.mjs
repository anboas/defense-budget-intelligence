import { createHash } from "node:crypto";
import { requireWriteAccess } from "./auth.mjs";

function ownerKey(request) {
  return String(request.headers["x-owner-key"] || "default").slice(0, 120);
}

function queryHash(query) {
  return createHash("sha256").update(JSON.stringify(query || {})).digest("hex");
}

export async function registerStateRoutes(app, pool) {
  app.get("/api/v1/saved-views", { preHandler: requireWriteAccess }, async (request) => {
    const result = await pool.query(
      `SELECT id, label, route, query, created_at, updated_at
       FROM saved_views WHERE owner_key = $1 ORDER BY updated_at DESC`,
      [ownerKey(request)],
    );
    return { views: result.rows };
  });

  app.post("/api/v1/saved-views", { preHandler: requireWriteAccess }, async (request, reply) => {
    const label = String(request.body?.label || "").trim().slice(0, 160);
    const route = String(request.body?.route || "").trim().slice(0, 240);
    const query = request.body?.query && typeof request.body.query === "object"
      ? request.body.query
      : {};
    if (!label || !route) {
      return reply.code(400).send({ error: "label and route are required" });
    }

    const result = await pool.query(
      `INSERT INTO saved_views (owner_key, label, route, query, query_hash)
       VALUES ($1, $2, $3, $4::jsonb, $5)
       ON CONFLICT (owner_key, route, query_hash)
       DO UPDATE SET label = EXCLUDED.label, updated_at = NOW()
       RETURNING id, label, route, query, created_at, updated_at`,
      [ownerKey(request), label, route, JSON.stringify(query), queryHash(query)],
    );
    return reply.code(201).send(result.rows[0]);
  });

  app.delete("/api/v1/saved-views/:id", { preHandler: requireWriteAccess }, async (request, reply) => {
    const result = await pool.query(
      "DELETE FROM saved_views WHERE id = $1 AND owner_key = $2 RETURNING id",
      [request.params.id, ownerKey(request)],
    );
    return result.rowCount
      ? reply.code(204).send()
      : reply.code(404).send({ error: "saved view not found" });
  });
}
