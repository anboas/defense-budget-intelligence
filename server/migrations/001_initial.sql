CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS intelligence_snapshots (
  id BIGSERIAL PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('budget', 'source_health', 'refresh_delta')),
  source_hash CHAR(64) NOT NULL,
  captured_at TIMESTAMPTZ NOT NULL,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  record_count INTEGER NOT NULL DEFAULT 0 CHECK (record_count >= 0),
  source_uri TEXT NOT NULL,
  payload JSONB NOT NULL,
  UNIQUE (kind, source_hash)
);

CREATE INDEX IF NOT EXISTS intelligence_snapshots_latest_idx
  ON intelligence_snapshots (kind, captured_at DESC, imported_at DESC);

CREATE TABLE IF NOT EXISTS refresh_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ,
  status TEXT NOT NULL CHECK (status IN ('running', 'succeeded', 'failed')),
  source TEXT NOT NULL DEFAULT 'scheduled',
  commit_sha TEXT,
  summary JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS refresh_runs_started_idx
  ON refresh_runs (started_at DESC);

CREATE TABLE IF NOT EXISTS saved_views (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_key TEXT NOT NULL,
  label TEXT NOT NULL,
  route TEXT NOT NULL,
  query JSONB NOT NULL DEFAULT '{}'::JSONB,
  query_hash CHAR(64) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (owner_key, route, query_hash)
);

CREATE INDEX IF NOT EXISTS saved_views_owner_idx
  ON saved_views (owner_key, updated_at DESC);

CREATE TABLE IF NOT EXISTS comparison_sets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_key TEXT NOT NULL,
  label TEXT NOT NULL,
  items JSONB NOT NULL DEFAULT '[]'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS comparison_sets_owner_idx
  ON comparison_sets (owner_key, updated_at DESC);

CREATE TABLE IF NOT EXISTS annotations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_key TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS annotations_entity_idx
  ON annotations (owner_key, entity_type, entity_id, updated_at DESC);
