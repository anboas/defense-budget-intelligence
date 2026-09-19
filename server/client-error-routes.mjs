import { sameOriginValues, safeLogMetadata, safeLogText } from "../src/security-policy.js";
import { randomUUID } from "node:crypto";
import { authenticated, recordApiRequest } from "./auth-routes.mjs";

const ALLOWED_KINDS = new Set(["render_error", "route_render_error", "chunk_error", "unhandled_error", "unhandled_rejection"]);

function safeRoute(value) {
  const [path, query = ""] = String(value || "").slice(0, 300).split("?");
  const keys = query.split("&").map((entry) => entry.split("=")[0]).filter(Boolean).slice(0, 20);
  return `${path}${keys.length ? `?${keys.join("&")}` : ""}`;
}

function safeClientText(value, limit) {
  return safeLogText(value, limit).replace(/([?&][^=\s]+)=([^&\s)]+)/g, "$1=[redacted]");
}

export async function registerClientErrorRoutes(app, pool) {
  app.get("/api/v1/client-errors", async () => {
    const result = await pool.query(`SELECT COUNT(*)::int AS count_24h, MAX(completed_at) AS latest_at
      FROM app_api_request_log WHERE request_kind = 'client_error' AND completed_at >= NOW() - INTERVAL '24 hours'`);
    const health = result.rows[0] || {};
    return { status: Number(health.count_24h || 0) ? "degraded" : "ok", count24h: Number(health.count_24h || 0), latestAt: health.latest_at || null };
  });
  app.post("/api/v1/client-errors", async (request, reply) => {
    if (!sameOriginValues(`${request.protocol}://${request.host}${request.url}`, request.headers.origin || "", request.headers["sec-fetch-site"] || "")) return reply.code(403).send({ error: "cross-origin client reports are not allowed" });
    const user = await authenticated(pool, request);
    if (!user) return reply.code(401).send({ error: "authentication required" });
    const body = request.body && typeof request.body === "object" ? request.body : null;
    if (!body) return reply.code(400).send({ error: "invalid client error report" });
    const kind = ALLOWED_KINDS.has(body.kind) ? body.kind : "render_error";
    const reportId = /^[a-f0-9-]{20,80}$/i.test(String(body.reportId || "")) ? body.reportId : randomUUID();
    await recordApiRequest(pool, {
      workspaceId: user.active_workspace_id,
      userId: user.user_id,
      principalType: "user",
      principalId: user.user_id,
      requestKind: "client_error",
      provider: "browser",
      operation: `client.${kind}`,
      method: "CLIENT",
      route: safeRoute(body.route),
      status: "failed",
      stage: kind,
      traceId: reportId,
      errorCode: kind,
      errorMessage: safeClientText(body.message || body.name || "Client render failure", 500),
      metadata: safeLogMetadata({ asset: safeClientText(body.asset, 160), errorName: safeClientText(body.name, 80), stack: safeClientText(body.stack, 2_000), componentStack: safeClientText(body.componentStack, 2_000) }),
    });
    return reply.code(202).send({ accepted: true, reportId });
  });
}
