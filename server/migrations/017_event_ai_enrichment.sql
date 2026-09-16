CREATE TABLE app_event_ai_jobs (
  id UUID PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES app_workspaces(workspace_id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES app_users(user_id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  current_step TEXT NOT NULL,
  credential_id UUID REFERENCES app_openai_keys(id) ON DELETE SET NULL,
  credential_scope TEXT NOT NULL,
  producer_model TEXT NOT NULL,
  verifier_model TEXT NOT NULL,
  producer_response_id TEXT,
  verifier_response_id TEXT,
  direction TEXT NOT NULL DEFAULT '',
  input_snapshot_json JSONB NOT NULL,
  categories_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  proposal_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  verification_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  merge_result_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  error_code TEXT,
  error_message TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0,
  trace_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX app_event_ai_jobs_workspace_time_idx ON app_event_ai_jobs (workspace_id, created_at DESC);
CREATE INDEX app_event_ai_jobs_user_time_idx ON app_event_ai_jobs (user_id, created_at DESC);
