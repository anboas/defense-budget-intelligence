CREATE TABLE app_api_request_log (
  id UUID PRIMARY KEY,
  workspace_id UUID REFERENCES app_workspaces(workspace_id) ON DELETE CASCADE,
  user_id UUID REFERENCES app_users(user_id) ON DELETE SET NULL,
  principal_type TEXT NOT NULL DEFAULT 'user',
  principal_id TEXT,
  request_kind TEXT NOT NULL,
  provider TEXT NOT NULL,
  operation TEXT NOT NULL,
  method TEXT,
  route TEXT,
  status TEXT NOT NULL,
  http_status INTEGER,
  stage TEXT,
  model TEXT,
  credential_id UUID REFERENCES app_openai_keys(id) ON DELETE SET NULL,
  credential_scope TEXT,
  provider_request_id TEXT,
  trace_id TEXT,
  response_id TEXT,
  latency_ms INTEGER NOT NULL DEFAULT 0,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  retry_count INTEGER NOT NULL DEFAULT 0,
  retryable BOOLEAN NOT NULL DEFAULT FALSE,
  error_code TEXT,
  error_message TEXT,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX app_api_request_log_workspace_time_idx ON app_api_request_log (workspace_id, completed_at DESC);
CREATE INDEX app_api_request_log_user_time_idx ON app_api_request_log (user_id, completed_at DESC);
CREATE INDEX app_api_request_log_credential_time_idx ON app_api_request_log (credential_id, completed_at DESC);
CREATE INDEX app_api_request_log_status_time_idx ON app_api_request_log (workspace_id, status, completed_at DESC);
