const ALLOWED_KINDS = new Set(["render_error", "route_render_error", "chunk_error", "unhandled_error", "unhandled_rejection"]);

function safeRoute(value) {
  const text = String(value || "").slice(0, 300);
  const [path, query = ""] = text.split("?");
  const keys = query.split("&").map((entry) => entry.split("=")[0]).filter(Boolean).slice(0, 20);
  return `${path}${keys.length ? `?${keys.join("&")}` : ""}`;
}

function safeClientText(value, limit) {
  return String(value || "")
    .replace(/sk-[A-Za-z0-9_-]{8,}/g, "[redacted-key]")
    .replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/gi, "Bearer [redacted]")
    .replace(/([?&][^=\s]+)=([^&\s)]+)/g, "$1=[redacted]")
    .slice(0, limit);
}

export async function clientErrorsResponse(request, db, dependencies) {
  const { json, recordApiRequest, safeJson, sameOriginRequest, sessionUser } = dependencies;
  if (request.method === "GET") {
    const since = new Date(Date.now() - 86_400_000).toISOString();
    const health = await db.prepare(`SELECT COUNT(*) AS count_24h, MAX(completed_at) AS latest_at
      FROM dbi_api_request_log WHERE request_kind = 'client_error' AND completed_at >= ?`).bind(since).first();
    return json({ status: Number(health?.count_24h || 0) ? "degraded" : "ok", count24h: Number(health?.count_24h || 0), latestAt: health?.latest_at || null });
  }
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405, { allow: "GET, POST" });
  if (!sameOriginRequest(request)) return json({ error: "Cross-origin client reports are not allowed" }, 403);
  const user = await sessionUser(db, request);
  if (!user) return json({ error: "Authentication required" }, 401);
  const body = await safeJson(request, 16_384);
  if (!body) return json({ error: "Invalid client error report" }, 400);
  const kind = ALLOWED_KINDS.has(body.kind) ? body.kind : "render_error";
  const reportId = /^[a-f0-9-]{20,80}$/i.test(String(body.reportId || "")) ? body.reportId : crypto.randomUUID();
  await recordApiRequest(db, {
    id: reportId,
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
    metadata: {
      asset: safeClientText(body.asset, 160),
      errorName: safeClientText(body.name, 80),
      stack: safeClientText(body.stack, 2_000),
      componentStack: safeClientText(body.componentStack, 2_000),
    },
  });
  return json({ accepted: true, reportId }, 202);
}
