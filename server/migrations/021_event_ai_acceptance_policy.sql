CREATE TABLE app_workspace_ai_preferences (
  workspace_id UUID PRIMARY KEY REFERENCES app_workspaces(workspace_id) ON DELETE CASCADE,
  auto_accept_event_augmentations BOOLEAN NOT NULL DEFAULT FALSE,
  updated_by UUID REFERENCES app_users(user_id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE app_event_ai_state (
  workspace_id UUID NOT NULL REFERENCES app_workspaces(workspace_id) ON DELETE CASCADE,
  event_id TEXT NOT NULL,
  last_job_id UUID REFERENCES app_event_ai_jobs(id) ON DELETE SET NULL,
  last_status TEXT NOT NULL DEFAULT '',
  last_augmented_at TIMESTAMPTZ,
  last_applied_at TIMESTAMPTZ,
  validation_required BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (workspace_id, event_id)
);

CREATE INDEX app_event_ai_state_workspace_time_idx
  ON app_event_ai_state (workspace_id, last_augmented_at DESC);
