function fromRow(row) {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    userId: row.user_id,
    principalType: row.principal_type,
    principalId: row.principal_id,
    requestKind: row.request_kind,
    provider: row.provider,
    operation: row.operation,
    method: row.method,
    route: row.route,
    status: row.status,
    httpStatus: row.http_status,
    stage: row.stage,
    model: row.model,
    credentialId: row.credential_id,
    credentialScope: row.credential_scope,
    providerRequestId: row.provider_request_id,
    traceId: row.trace_id,
    responseId: row.response_id,
    latencyMs: row.latency_ms,
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    retryCount: row.retry_count,
    retryable: row.retryable,
    errorCode: row.error_code,
    errorMessage: row.error_message,
    metadata: row.metadata_json,
    startedAt: row.started_at,
    completedAt: row.completed_at,
  };
}

export async function postgresApiRequestLog(pool, workspaceId, requestedLimit = 500) {
  const parsedLimit = Number.parseInt(String(requestedLimit || "500"), 10);
  const limit = Number.isFinite(parsedLimit) ? Math.min(500, Math.max(1, parsedLimit)) : 500;
  const [result, aggregateResult] = await Promise.all([
    pool.query("SELECT * FROM app_api_request_log WHERE workspace_id = $1 ORDER BY completed_at DESC LIMIT $2", [workspaceId, limit]),
    pool.query(`SELECT
      COUNT(*)::int AS retained,
      COUNT(*) FILTER (WHERE request_kind NOT IN ('credential_lifecycle', 'client_error'))::int AS requests,
      COUNT(*) FILTER (WHERE request_kind = 'openai')::int AS ai_requests,
      COUNT(*) FILTER (WHERE request_kind NOT IN ('openai', 'client_error', 'credential_lifecycle'))::int AS agent_requests,
      COUNT(*) FILTER (WHERE request_kind = 'client_error')::int AS client_errors,
      COUNT(*) FILTER (WHERE request_kind = 'credential_lifecycle')::int AS credential_events,
      COUNT(*) FILTER (WHERE request_kind NOT IN ('credential_lifecycle', 'client_error') AND status IN ('accepted', 'completed', 'succeeded'))::int AS succeeded,
      COUNT(*) FILTER (WHERE request_kind NOT IN ('credential_lifecycle', 'client_error') AND status IN ('failed', 'rate_limited', 'rejected'))::int AS failed,
      COUNT(*) FILTER (WHERE request_kind NOT IN ('credential_lifecycle', 'client_error') AND status IN ('pending', 'queued', 'researching', 'running', 'verifying'))::int AS in_progress,
      COALESCE(ROUND(AVG(latency_ms) FILTER (WHERE request_kind NOT IN ('credential_lifecycle', 'client_error') AND latency_ms > 0)), 0)::int AS average_latency_ms,
      COALESCE(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY latency_ms) FILTER (WHERE request_kind NOT IN ('credential_lifecycle', 'client_error') AND latency_ms > 0), 0)::int AS p95_latency_ms,
      COALESCE(SUM(input_tokens) FILTER (WHERE request_kind NOT IN ('credential_lifecycle', 'client_error')), 0)::bigint AS input_tokens,
      COALESCE(SUM(output_tokens) FILTER (WHERE request_kind NOT IN ('credential_lifecycle', 'client_error')), 0)::bigint AS output_tokens,
      MIN(completed_at) AS window_start,
      MAX(completed_at) AS window_end
    FROM app_api_request_log WHERE workspace_id = $1`, [workspaceId]),
  ]);
  const aggregate = aggregateResult.rows[0] || {};
  const retained = Number(aggregate.retained || 0);
  const succeeded = Number(aggregate.succeeded || 0);
  const failed = Number(aggregate.failed || 0);
  const terminalRequests = succeeded + failed;
  return {
    requests: result.rows.map(fromRow),
    summary: {
      retained,
      returned: result.rowCount,
      truncated: retained > result.rowCount,
      requests: Number(aggregate.requests || 0),
      succeeded,
      failed,
      inProgress: Number(aggregate.in_progress || 0),
      terminalRequests,
      successRate: terminalRequests ? Math.round((succeeded / terminalRequests) * 1000) / 10 : null,
      averageLatencyMs: Number(aggregate.average_latency_ms || 0),
      p95LatencyMs: Number(aggregate.p95_latency_ms || 0),
      inputTokens: Number(aggregate.input_tokens || 0),
      outputTokens: Number(aggregate.output_tokens || 0),
      aiRequests: Number(aggregate.ai_requests || 0),
      agentRequests: Number(aggregate.agent_requests || 0),
      clientErrors: Number(aggregate.client_errors || 0),
      credentialEvents: Number(aggregate.credential_events || 0),
      windowStart: aggregate.window_start || null,
      windowEnd: aggregate.window_end || null,
      retentionDays: 90,
      limit,
      redaction: "Secrets, authorization headers, prompts, request bodies, and response bodies are never retained.",
    },
  };
}
