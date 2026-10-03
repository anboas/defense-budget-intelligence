CREATE INDEX IF NOT EXISTS app_acquisition_records_active_idx
  ON app_acquisition_records (workspace_id, last_changed_at DESC)
  WHERE removed_at IS NULL;

CREATE INDEX IF NOT EXISTS app_acquisition_observations_retention_idx
  ON app_acquisition_observations (observed_at);

CREATE INDEX IF NOT EXISTS app_acquisition_changes_retention_idx
  ON app_acquisition_changes (changed_at);

CREATE INDEX IF NOT EXISTS app_acquisition_delivery_attempts_retention_idx
  ON app_acquisition_delivery_attempts (attempted_at);
