CREATE TABLE app_workspace_provider_credentials (
  id UUID PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES app_workspaces(workspace_id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('sam_gov')),
  label TEXT NOT NULL,
  encrypted_secret TEXT NOT NULL,
  secret_iv TEXT NOT NULL,
  secret_version INTEGER NOT NULL DEFAULT 1,
  secret_last_four TEXT NOT NULL,
  created_by UUID NOT NULL REFERENCES app_users(user_id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at TIMESTAMPTZ,
  last_used_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX app_workspace_provider_credentials_active_idx
  ON app_workspace_provider_credentials (workspace_id, provider)
  WHERE revoked_at IS NULL;

CREATE INDEX app_workspace_provider_credentials_history_idx
  ON app_workspace_provider_credentials (workspace_id, provider, revoked_at, created_at DESC);
