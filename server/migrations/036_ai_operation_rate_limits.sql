CREATE TABLE app_ai_operation_rate_limits (
  principal_id UUID NOT NULL,
  workspace_id UUID NOT NULL,
  scope TEXT NOT NULL,
  window_started_at TIMESTAMPTZ NOT NULL,
  request_count INTEGER NOT NULL DEFAULT 0,
  expires_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (principal_id, workspace_id, scope, window_started_at)
);

CREATE INDEX app_ai_operation_rate_limits_expires_idx
  ON app_ai_operation_rate_limits (expires_at);
