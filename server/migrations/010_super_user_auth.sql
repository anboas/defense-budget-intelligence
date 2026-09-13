CREATE TABLE app_super_user (
  singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton),
  email TEXT NOT NULL,
  display_name TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  password_salt TEXT NOT NULL,
  password_proof_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX app_super_user_email_lower_idx
  ON app_super_user (LOWER(email));

CREATE TABLE app_auth_sessions (
  id UUID PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX app_auth_sessions_expires_idx
  ON app_auth_sessions (expires_at);

CREATE TABLE app_login_attempts (
  id BIGSERIAL PRIMARY KEY,
  identity_hash TEXT NOT NULL,
  succeeded BOOLEAN NOT NULL,
  attempted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX app_login_attempts_identity_time_idx
  ON app_login_attempts (identity_hash, attempted_at DESC);
