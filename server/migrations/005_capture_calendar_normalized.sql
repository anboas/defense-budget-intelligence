CREATE TABLE IF NOT EXISTS capture_opportunities (
  snapshot_id BIGINT NOT NULL REFERENCES intelligence_snapshots(id) ON DELETE CASCADE,
  opportunity_id TEXT NOT NULL,
  gantt_alias TEXT NOT NULL,
  portfolio TEXT NOT NULL,
  record_type TEXT NOT NULL,
  award_piid TEXT,
  validation_status TEXT NOT NULL,
  event_count INTEGER NOT NULL DEFAULT 0 CHECK (event_count >= 0),
  action_count INTEGER NOT NULL DEFAULT 0 CHECK (action_count >= 0),
  payload JSONB NOT NULL,
  PRIMARY KEY (snapshot_id, opportunity_id),
  UNIQUE (snapshot_id, gantt_alias)
);

CREATE TABLE IF NOT EXISTS capture_events (
  snapshot_id BIGINT NOT NULL,
  event_id TEXT NOT NULL,
  opportunity_id TEXT NOT NULL,
  event_kind TEXT NOT NULL,
  event_start DATE,
  event_end DATE,
  precision TEXT NOT NULL,
  source_uri TEXT,
  payload JSONB NOT NULL,
  PRIMARY KEY (snapshot_id, event_id),
  FOREIGN KEY (snapshot_id, opportunity_id)
    REFERENCES capture_opportunities(snapshot_id, opportunity_id)
    ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS capture_fpds_actions (
  snapshot_id BIGINT NOT NULL,
  action_id TEXT NOT NULL,
  opportunity_id TEXT NOT NULL,
  piid TEXT NOT NULL,
  parent_piid TEXT,
  modification TEXT,
  transaction_number TEXT,
  signed_at DATE,
  obligation_delta NUMERIC,
  potential_delta NUMERIC,
  supporting_instrument BOOLEAN NOT NULL DEFAULT FALSE,
  payload JSONB NOT NULL,
  PRIMARY KEY (snapshot_id, action_id),
  FOREIGN KEY (snapshot_id, opportunity_id)
    REFERENCES capture_opportunities(snapshot_id, opportunity_id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS capture_opportunities_snapshot_portfolio_idx
  ON capture_opportunities(snapshot_id, portfolio);
CREATE INDEX IF NOT EXISTS capture_events_opportunity_start_idx
  ON capture_events(snapshot_id, opportunity_id, event_start);
CREATE INDEX IF NOT EXISTS capture_fpds_actions_opportunity_signed_idx
  ON capture_fpds_actions(snapshot_id, opportunity_id, signed_at);
CREATE INDEX IF NOT EXISTS capture_fpds_actions_piid_idx
  ON capture_fpds_actions(snapshot_id, piid);
