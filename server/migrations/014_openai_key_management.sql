CREATE TABLE app_openai_keys (
  id UUID PRIMARY KEY,
  scope_type TEXT NOT NULL CHECK (scope_type IN ('workspace', 'user')),
  workspace_id UUID REFERENCES app_workspaces(workspace_id) ON DELETE CASCADE,
  user_id UUID REFERENCES app_users(user_id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  encrypted_key TEXT NOT NULL,
  key_iv TEXT NOT NULL,
  key_version INTEGER NOT NULL DEFAULT 1,
  key_last_four TEXT NOT NULL,
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  created_by UUID NOT NULL REFERENCES app_users(user_id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at TIMESTAMPTZ,
  last_used_at TIMESTAMPTZ,
  CHECK (
    (scope_type = 'workspace' AND workspace_id IS NOT NULL AND user_id IS NULL)
    OR (scope_type = 'user' AND user_id IS NOT NULL AND workspace_id IS NULL)
  )
);

CREATE INDEX app_openai_keys_workspace_idx ON app_openai_keys (workspace_id, scope_type, revoked_at, created_at DESC);
CREATE INDEX app_openai_keys_user_idx ON app_openai_keys (user_id, scope_type, revoked_at, created_at DESC);
