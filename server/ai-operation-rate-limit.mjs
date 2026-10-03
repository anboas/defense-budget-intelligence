export const AI_OPERATION_LIMIT = 12;
export const AI_OPERATION_WINDOW_MINUTES = 15;

export async function consumeAiOperationLimit(pool, user, scope = "record_ai") {
  const principalId = user.actor_user_id || user.user_id;
  const result = await pool.query(`WITH current_window AS (
      SELECT to_timestamp(floor(extract(epoch FROM NOW()) / ($4 * 60)) * ($4 * 60)) AS started_at
    )
    INSERT INTO app_ai_operation_rate_limits
      (principal_id, workspace_id, scope, window_started_at, request_count, expires_at)
    SELECT $1, $2, $3, started_at, 1, started_at + make_interval(mins => $4) FROM current_window
    ON CONFLICT (principal_id, workspace_id, scope, window_started_at)
    DO UPDATE SET request_count = app_ai_operation_rate_limits.request_count + 1
    RETURNING request_count, expires_at`, [principalId, user.active_workspace_id, scope, AI_OPERATION_WINDOW_MINUTES]);
  const row = result.rows[0] || {};
  return {
    limited: Number(row.request_count || 0) > AI_OPERATION_LIMIT,
    retryAfter: Math.max(1, Math.ceil((Date.parse(row.expires_at) - Date.now()) / 1000)),
  };
}

export function sendAiRateLimit(reply, quota) {
  return reply.header("retry-after", String(quota.retryAfter)).code(429).send({
    error: `AI research is limited to ${AI_OPERATION_LIMIT} provider operations per ${AI_OPERATION_WINDOW_MINUTES} minutes`,
    code: "ai_rate_limited",
    retryAfterSeconds: quota.retryAfter,
  });
}
