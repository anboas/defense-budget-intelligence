ALTER TABLE capture_opportunities
  DROP CONSTRAINT IF EXISTS capture_opportunities_snapshot_id_gantt_alias_key;

CREATE INDEX IF NOT EXISTS capture_opportunities_snapshot_gantt_alias_idx
  ON capture_opportunities(snapshot_id, gantt_alias);
