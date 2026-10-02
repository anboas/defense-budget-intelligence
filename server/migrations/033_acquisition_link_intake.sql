ALTER TABLE app_acquisition_refresh_runs
  DROP CONSTRAINT IF EXISTS app_acquisition_refresh_runs_trigger_type_check;

ALTER TABLE app_acquisition_refresh_runs
  ADD CONSTRAINT app_acquisition_refresh_runs_trigger_type_check
  CHECK (trigger_type IN ('manual','scheduled','first_access','link_intake'));
