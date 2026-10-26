function safeObject(value) {
  try {
    const parsed = JSON.parse(value || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function apiRequestFromRow(row) {
  return {
    id: row.id,
    workspaceId: row.workspace_id || null,
    userId: row.user_id || null,
    principalType: row.principal_type,
    principalId: row.principal_id,
    requestKind: row.request_kind,
    provider: row.provider,
    operation: row.operation,
    method: row.method || null,
    route: row.route || null,
    status: row.status,
    httpStatus: Number(row.http_status || 0),
    stage: row.stage || null,
    model: row.model || null,
    credentialId: row.credential_id || null,
    credentialScope: row.credential_scope || null,
    providerRequestId: row.provider_request_id || null,
    traceId: row.trace_id || null,
    responseId: row.response_id || null,
    latencyMs: Number(row.latency_ms || 0),
    inputTokens: Number(row.input_tokens || 0),
    outputTokens: Number(row.output_tokens || 0),
    retryCount: Number(row.retry_count || 0),
    retryable: Boolean(row.retryable),
    errorCode: row.error_code || null,
    errorMessage: row.error_message || null,
    metadata: safeObject(row.metadata_json),
    startedAt: row.started_at,
    completedAt: row.completed_at,
  };
}

export function summarizeRecentLatency(entries = []) {
  const values = entries
    .filter((entry) => !["credential_lifecycle", "client_error"].includes(entry.requestKind))
    .map((entry) => Number(entry.latencyMs || 0))
    .filter((value) => value > 0)
    .sort((left, right) => left - right);
  const offset = values.length ? Math.min(values.length - 1, Math.ceil(values.length * 0.95) - 1) : 0;
  return { p95LatencyMs: values[offset] || 0, latencySampleSize: values.length };
}
