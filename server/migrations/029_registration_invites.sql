CREATE TABLE app_registration_settings (
  singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton),
  mode TEXT NOT NULL DEFAULT 'closed' CHECK (mode IN ('closed', 'invite_only')),
  updated_by UUID REFERENCES app_users(user_id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO app_registration_settings (singleton, mode)
VALUES (TRUE, 'closed');

CREATE TABLE app_registration_invites (
  id UUID PRIMARY KEY,
  code_hash TEXT NOT NULL UNIQUE,
  code_suffix TEXT NOT NULL,
  label TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'used', 'revoked')),
  expires_at TIMESTAMPTZ NOT NULL,
  created_by UUID NOT NULL REFERENCES app_users(user_id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  used_by UUID REFERENCES app_users(user_id),
  used_at TIMESTAMPTZ,
  revoked_by UUID REFERENCES app_users(user_id),
  revoked_at TIMESTAMPTZ
);

CREATE INDEX app_registration_invites_status_expiry_idx
  ON app_registration_invites (status, expires_at);

CREATE INDEX app_registration_invites_created_idx
  ON app_registration_invites (created_at DESC);
