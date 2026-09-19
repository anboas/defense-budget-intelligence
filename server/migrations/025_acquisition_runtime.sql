CREATE TABLE app_acquisition_refresh_runs (
  id UUID PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES app_workspaces(workspace_id) ON DELETE CASCADE,
  source TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('running','succeeded','failed')),
  trigger_type TEXT NOT NULL CHECK (trigger_type IN ('manual','scheduled','first_access')),
  window_start DATE,
  window_end DATE,
  records_seen INTEGER NOT NULL DEFAULT 0,
  records_added INTEGER NOT NULL DEFAULT 0,
  records_updated INTEGER NOT NULL DEFAULT 0,
  links_added INTEGER NOT NULL DEFAULT 0,
  error_code TEXT,
  error_message TEXT,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);
CREATE INDEX app_acquisition_refresh_runs_workspace_idx ON app_acquisition_refresh_runs (workspace_id, source, started_at DESC);

CREATE TABLE app_acquisition_records (
  workspace_id UUID NOT NULL REFERENCES app_workspaces(workspace_id) ON DELETE CASCADE,
  source TEXT NOT NULL,
  source_record_id TEXT NOT NULL,
  solicitation_number TEXT,
  lifecycle_stage TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  record_json JSONB NOT NULL,
  first_seen_at TIMESTAMPTZ NOT NULL,
  last_seen_at TIMESTAMPTZ NOT NULL,
  last_changed_at TIMESTAMPTZ NOT NULL,
  removed_at TIMESTAMPTZ,
  PRIMARY KEY (workspace_id, source, source_record_id)
);
CREATE INDEX app_acquisition_records_workspace_idx ON app_acquisition_records (workspace_id, last_changed_at DESC);
CREATE INDEX app_acquisition_records_solicitation_idx ON app_acquisition_records (workspace_id, solicitation_number) WHERE solicitation_number IS NOT NULL;

CREATE TABLE app_acquisition_observations (
  id UUID PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES app_workspaces(workspace_id) ON DELETE CASCADE,
  source TEXT NOT NULL,
  source_record_id TEXT NOT NULL,
  refresh_run_id UUID NOT NULL REFERENCES app_acquisition_refresh_runs(id) ON DELETE CASCADE,
  content_hash TEXT NOT NULL,
  record_json JSONB NOT NULL,
  observed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (workspace_id, source, source_record_id, content_hash)
);
CREATE INDEX app_acquisition_observations_record_idx ON app_acquisition_observations (workspace_id, source, source_record_id, observed_at DESC);

CREATE TABLE app_acquisition_changes (
  id UUID PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES app_workspaces(workspace_id) ON DELETE CASCADE,
  source TEXT NOT NULL,
  source_record_id TEXT NOT NULL,
  refresh_run_id UUID NOT NULL REFERENCES app_acquisition_refresh_runs(id) ON DELETE CASCADE,
  change_type TEXT NOT NULL CHECK (change_type IN ('added','updated','removed')),
  changed_fields_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX app_acquisition_changes_workspace_idx ON app_acquisition_changes (workspace_id, changed_at DESC);

CREATE TABLE app_acquisition_lifecycle_links (
  workspace_id UUID NOT NULL REFERENCES app_workspaces(workspace_id) ON DELETE CASCADE,
  from_source TEXT NOT NULL,
  from_record_id TEXT NOT NULL,
  to_source TEXT NOT NULL,
  to_record_id TEXT NOT NULL,
  relationship TEXT NOT NULL,
  basis TEXT NOT NULL,
  identifier TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (workspace_id, from_source, from_record_id, to_source, to_record_id, relationship)
);
CREATE INDEX app_acquisition_lifecycle_links_workspace_idx ON app_acquisition_lifecycle_links (workspace_id, identifier);

CREATE TABLE app_acquisition_saved_views (
  id UUID PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES app_workspaces(workspace_id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES app_users(user_id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  query_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  alert_mode TEXT NOT NULL DEFAULT 'none' CHECK (alert_mode IN ('none','daily','immediate')),
  last_opened_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX app_acquisition_saved_views_owner_idx ON app_acquisition_saved_views (workspace_id, user_id, updated_at DESC);

CREATE TABLE app_acquisition_alerts (
  id UUID PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES app_workspaces(workspace_id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES app_users(user_id) ON DELETE CASCADE,
  saved_view_id UUID NOT NULL REFERENCES app_acquisition_saved_views(id) ON DELETE CASCADE,
  source TEXT NOT NULL,
  source_record_id TEXT NOT NULL,
  refresh_run_id UUID NOT NULL REFERENCES app_acquisition_refresh_runs(id) ON DELETE CASCADE,
  change_type TEXT NOT NULL CHECK (change_type IN ('added','updated','removed')),
  matched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  read_at TIMESTAMPTZ,
  UNIQUE (saved_view_id, source, source_record_id, refresh_run_id)
);
CREATE INDEX app_acquisition_alerts_owner_idx ON app_acquisition_alerts (workspace_id, user_id, read_at, matched_at DESC);
