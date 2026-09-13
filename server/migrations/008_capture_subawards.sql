CREATE TABLE IF NOT EXISTS capture_subawards (
  snapshot_id BIGINT NOT NULL,
  opportunity_id TEXT NOT NULL,
  subaward_id TEXT NOT NULL,
  prime_award_generated_id TEXT NOT NULL,
  subaward_number TEXT,
  action_date DATE,
  amount NUMERIC,
  recipient_name TEXT,
  payload JSONB NOT NULL,
  PRIMARY KEY (snapshot_id, opportunity_id, subaward_id),
  FOREIGN KEY (snapshot_id, opportunity_id)
    REFERENCES capture_opportunities(snapshot_id, opportunity_id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS capture_subawards_opportunity_action_idx
  ON capture_subawards(snapshot_id, opportunity_id, action_date DESC);
CREATE INDEX IF NOT EXISTS capture_subawards_prime_award_idx
  ON capture_subawards(snapshot_id, prime_award_generated_id);
