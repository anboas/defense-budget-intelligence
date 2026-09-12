ALTER TABLE intelligence_snapshots
  DROP CONSTRAINT IF EXISTS intelligence_snapshots_kind_check;

ALTER TABLE intelligence_snapshots
  ADD CONSTRAINT intelligence_snapshots_kind_check
  CHECK (kind IN ('budget', 'source_health', 'refresh_delta', 'account_spine'));

CREATE TABLE IF NOT EXISTS source_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_system TEXT NOT NULL,
  source_identifier TEXT NOT NULL,
  source_uri TEXT NOT NULL,
  content_hash CHAR(64) NOT NULL,
  published_at TIMESTAMPTZ,
  observed_at TIMESTAMPTZ NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (source_system, source_identifier, content_hash)
);

CREATE INDEX IF NOT EXISTS source_documents_lookup_idx
  ON source_documents (source_system, source_identifier, observed_at DESC);

CREATE TABLE IF NOT EXISTS fiscal_accounts (
  id BIGSERIAL PRIMARY KEY,
  federal_account_code TEXT NOT NULL UNIQUE,
  agency_identifier CHAR(3) NOT NULL,
  main_account_code CHAR(4) NOT NULL,
  account_title TEXT NOT NULL,
  bureau_name TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS fiscal_account_observations (
  id BIGSERIAL PRIMARY KEY,
  fiscal_account_id BIGINT NOT NULL REFERENCES fiscal_accounts(id) ON DELETE CASCADE,
  fiscal_year INTEGER NOT NULL CHECK (fiscal_year BETWEEN 2000 AND 2200),
  treasury_account_symbol TEXT NOT NULL DEFAULT '',
  amount_type TEXT NOT NULL CHECK (amount_type IN (
    'request', 'budgetary_resources', 'apportioned', 'obligated', 'outlayed'
  )),
  amount NUMERIC(22, 2) NOT NULL,
  relationship_class TEXT NOT NULL CHECK (relationship_class IN ('exact', 'derived')),
  source_document_id UUID NOT NULL REFERENCES source_documents(id),
  observed_at TIMESTAMPTZ NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (
    fiscal_account_id,
    fiscal_year,
    treasury_account_symbol,
    amount_type,
    source_document_id
  )
);

CREATE INDEX IF NOT EXISTS fiscal_account_observations_current_idx
  ON fiscal_account_observations (
    fiscal_account_id,
    fiscal_year,
    treasury_account_symbol,
    amount_type,
    observed_at DESC
  );
