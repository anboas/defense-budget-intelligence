CREATE TABLE IF NOT EXISTS app_workspace_record_dispositions (
  workspace_id UUID NOT NULL REFERENCES app_workspaces(workspace_id) ON DELETE CASCADE,
  record_id TEXT NOT NULL,
  disposition TEXT NOT NULL DEFAULT 'tombstoned' CHECK (disposition = 'tombstoned'),
  reason TEXT NOT NULL DEFAULT '',
  created_by UUID NOT NULL REFERENCES app_users(user_id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (workspace_id, record_id)
);

CREATE INDEX IF NOT EXISTS idx_app_record_dispositions_workspace
  ON app_workspace_record_dispositions (workspace_id, disposition, updated_at DESC);
