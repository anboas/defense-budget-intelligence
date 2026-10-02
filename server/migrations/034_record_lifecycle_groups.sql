CREATE TABLE IF NOT EXISTS app_workspace_record_groups (
  id UUID PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES app_workspaces(workspace_id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  member_ids_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  relationship TEXT NOT NULL DEFAULT 'related-workstream',
  confidence TEXT NOT NULL DEFAULT 'high' CHECK (confidence IN ('high','medium','low','exact')),
  rationale TEXT NOT NULL DEFAULT '',
  evidence_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  caveats_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  provenance_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by UUID NOT NULL REFERENCES app_users(user_id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_app_record_groups_workspace
  ON app_workspace_record_groups (workspace_id, updated_at DESC);
