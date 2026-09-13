ALTER TABLE capture_opportunities
  ADD COLUMN IF NOT EXISTS work_category TEXT,
  ADD COLUMN IF NOT EXISTS ingestion_method TEXT,
  ADD COLUMN IF NOT EXISTS psc_code TEXT,
  ADD COLUMN IF NOT EXISTS naics_code TEXT,
  ADD COLUMN IF NOT EXISTS automated_import BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS capture_opportunities_work_category_idx
  ON capture_opportunities(snapshot_id, work_category);
CREATE INDEX IF NOT EXISTS capture_opportunities_ingestion_method_idx
  ON capture_opportunities(snapshot_id, ingestion_method);
CREATE INDEX IF NOT EXISTS capture_opportunities_psc_idx
  ON capture_opportunities(snapshot_id, psc_code);
CREATE INDEX IF NOT EXISTS capture_opportunities_naics_idx
  ON capture_opportunities(snapshot_id, naics_code);

CREATE TABLE IF NOT EXISTS capture_opportunity_sources (
  snapshot_id BIGINT NOT NULL,
  opportunity_id TEXT NOT NULL,
  source_channel TEXT NOT NULL,
  ingestion_method TEXT NOT NULL,
  source_label TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::JSONB,
  PRIMARY KEY (snapshot_id, opportunity_id, source_channel),
  FOREIGN KEY (snapshot_id, opportunity_id)
    REFERENCES capture_opportunities(snapshot_id, opportunity_id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS capture_opportunity_sources_method_idx
  ON capture_opportunity_sources(snapshot_id, ingestion_method, source_channel);
