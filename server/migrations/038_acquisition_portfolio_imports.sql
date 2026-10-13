CREATE TABLE app_acquisition_portfolio_imports (
  id UUID PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES app_workspaces(workspace_id) ON DELETE CASCADE,
  source TEXT NOT NULL,
  filename TEXT NOT NULL,
  as_of DATE,
  content_hash TEXT,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  expected_records INTEGER NOT NULL DEFAULT 0,
  imported_records INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running','succeeded','failed')),
  imported_by UUID NOT NULL REFERENCES app_users(user_id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX app_acquisition_portfolio_imports_workspace_idx
  ON app_acquisition_portfolio_imports (workspace_id, created_at DESC);
