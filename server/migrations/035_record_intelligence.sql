CREATE TABLE IF NOT EXISTS app_workspace_record_research (
  id UUID PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES app_workspaces(workspace_id) ON DELETE CASCADE,
  opportunity_id TEXT NOT NULL,
  report_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by UUID NOT NULL REFERENCES app_users(user_id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_app_record_research_workspace_record
  ON app_workspace_record_research (workspace_id, opportunity_id, created_at DESC);

CREATE TABLE IF NOT EXISTS app_workspace_record_relationships (
  id UUID PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES app_workspaces(workspace_id) ON DELETE CASCADE,
  source_id TEXT NOT NULL,
  target_id TEXT NOT NULL,
  relationship TEXT NOT NULL,
  confidence TEXT NOT NULL DEFAULT 'high' CHECK (confidence IN ('high','medium','low','exact')),
  rationale TEXT NOT NULL DEFAULT '',
  evidence_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  source_urls_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  caveats_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  provenance_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by UUID NOT NULL REFERENCES app_users(user_id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (workspace_id, source_id, target_id, relationship)
);

CREATE INDEX IF NOT EXISTS idx_app_record_relationship_source
  ON app_workspace_record_relationships (workspace_id, source_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_app_record_relationship_target
  ON app_workspace_record_relationships (workspace_id, target_id, updated_at DESC);
