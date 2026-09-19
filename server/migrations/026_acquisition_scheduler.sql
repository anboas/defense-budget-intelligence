CREATE TABLE app_acquisition_source_configs (
  workspace_id UUID PRIMARY KEY REFERENCES app_workspaces(workspace_id) ON DELETE CASCADE,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  cadence_hours INTEGER NOT NULL DEFAULT 24 CHECK (cadence_hours BETWEEN 6 AND 168),
  config_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_by UUID REFERENCES app_users(user_id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX app_acquisition_source_configs_due_idx ON app_acquisition_source_configs (enabled, cadence_hours, updated_at);

CREATE TABLE app_acquisition_delivery_jobs (
  id UUID PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES app_workspaces(workspace_id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES app_users(user_id) ON DELETE CASCADE,
  saved_view_id UUID NOT NULL REFERENCES app_acquisition_saved_views(id) ON DELETE CASCADE,
  alert_id TEXT NOT NULL,
  delivery_mode TEXT NOT NULL CHECK (delivery_mode IN ('daily','immediate')),
  status TEXT NOT NULL DEFAULT 'pending_provider' CHECK (status IN ('pending_provider','pending','sending','delivered','failed','cancelled')),
  attempt_count INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  delivered_at TIMESTAMPTZ,
  UNIQUE (alert_id, delivery_mode)
);
CREATE INDEX app_acquisition_delivery_jobs_queue_idx ON app_acquisition_delivery_jobs (status, next_attempt_at);
