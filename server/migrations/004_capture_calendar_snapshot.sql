ALTER TABLE intelligence_snapshots
  DROP CONSTRAINT IF EXISTS intelligence_snapshots_kind_check;

ALTER TABLE intelligence_snapshots
  ADD CONSTRAINT intelligence_snapshots_kind_check
  CHECK (kind IN ('budget', 'source_health', 'refresh_delta', 'account_spine', 'capture_calendar'));
