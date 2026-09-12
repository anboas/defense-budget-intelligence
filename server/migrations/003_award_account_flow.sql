CREATE TABLE IF NOT EXISTS federal_awards (
  award_id TEXT PRIMARY KEY,
  award_number TEXT NOT NULL,
  recipient_name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  start_date DATE,
  end_date DATE,
  total_award_amount NUMERIC(22, 2) NOT NULL DEFAULT 0,
  source_uri TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS award_account_observations (
  id BIGSERIAL PRIMARY KEY,
  award_id TEXT NOT NULL REFERENCES federal_awards(award_id) ON DELETE CASCADE,
  fiscal_account_id BIGINT REFERENCES fiscal_accounts(id) ON DELETE SET NULL,
  federal_account_code TEXT NOT NULL,
  account_title TEXT NOT NULL,
  obligated_amount NUMERIC(22, 2) NOT NULL,
  relationship_class TEXT NOT NULL CHECK (relationship_class = 'exact'),
  source_document_id UUID NOT NULL REFERENCES source_documents(id),
  observed_at TIMESTAMPTZ NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (award_id, federal_account_code, source_document_id)
);

CREATE INDEX IF NOT EXISTS award_account_observations_account_idx
  ON award_account_observations (federal_account_code, observed_at DESC, obligated_amount DESC);

CREATE TABLE IF NOT EXISTS agency_fiscal_year_observations (
  id BIGSERIAL PRIMARY KEY,
  agency_code TEXT NOT NULL,
  fiscal_year INTEGER NOT NULL CHECK (fiscal_year BETWEEN 2000 AND 2200),
  amount_type TEXT NOT NULL CHECK (amount_type IN ('budgetary_resources', 'obligated', 'outlayed')),
  amount NUMERIC(22, 2) NOT NULL,
  source_document_id UUID NOT NULL REFERENCES source_documents(id),
  observed_at TIMESTAMPTZ NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (agency_code, fiscal_year, amount_type, source_document_id)
);

CREATE INDEX IF NOT EXISTS agency_fiscal_year_observations_current_idx
  ON agency_fiscal_year_observations (agency_code, fiscal_year DESC, amount_type, observed_at DESC);
