CREATE TABLE app_acquisition_delivery_preferences (
  workspace_id UUID NOT NULL REFERENCES app_workspaces(workspace_id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES app_users(user_id) ON DELETE CASCADE,
  email_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (workspace_id, user_id)
);

CREATE TABLE app_acquisition_delivery_attempts (
  id UUID PRIMARY KEY,
  job_id UUID NOT NULL REFERENCES app_acquisition_delivery_jobs(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL REFERENCES app_workspaces(workspace_id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('delivered','failed')),
  provider_message_id TEXT,
  error_code TEXT,
  attempted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX app_acquisition_delivery_attempts_job_idx ON app_acquisition_delivery_attempts (job_id, attempted_at DESC);
CREATE INDEX app_acquisition_delivery_attempts_workspace_idx ON app_acquisition_delivery_attempts (workspace_id, attempted_at DESC);
CREATE INDEX app_acquisition_delivery_jobs_workspace_status_idx ON app_acquisition_delivery_jobs (workspace_id, status, updated_at DESC);
