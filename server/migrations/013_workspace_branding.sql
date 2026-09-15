CREATE TABLE app_workspace_settings (
  workspace_id UUID PRIMARY KEY REFERENCES app_workspaces(workspace_id) ON DELETE CASCADE,
  icon_data_url TEXT NOT NULL DEFAULT '',
  header_eyebrow TEXT NOT NULL DEFAULT 'Defense Budget & Spend Analytics',
  display_title TEXT NOT NULL DEFAULT 'Defense Budget Intelligence',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
