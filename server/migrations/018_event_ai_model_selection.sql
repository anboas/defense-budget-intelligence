CREATE TABLE app_workspace_ai_settings (
  workspace_id UUID PRIMARY KEY REFERENCES app_workspaces(workspace_id) ON DELETE CASCADE,
  event_research_model TEXT NOT NULL DEFAULT '',
  event_verification_model TEXT NOT NULL DEFAULT '',
  updated_by UUID REFERENCES app_users(user_id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
