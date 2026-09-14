ALTER TABLE app_users ADD COLUMN avatar_data_url TEXT NOT NULL DEFAULT '';

CREATE TABLE app_workspaces (
  workspace_id UUID PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  owner_user_id UUID REFERENCES app_users(user_id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO app_workspaces (workspace_id, name, slug, description, owner_user_id)
SELECT '00000000-0000-4000-8000-000000000001', 'Defense budget', 'defense-budget',
  'Defense Budget Intelligence shared workspace', user_id
FROM app_super_user WHERE singleton = TRUE;

CREATE TABLE app_workspace_memberships (
  workspace_id UUID NOT NULL REFERENCES app_workspaces(workspace_id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES app_users(user_id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('super_user', 'administrator', 'analyst', 'viewer')),
  created_by UUID REFERENCES app_users(user_id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (workspace_id, user_id)
);

INSERT INTO app_workspace_memberships (workspace_id, user_id, role, created_by, created_at, updated_at)
SELECT '00000000-0000-4000-8000-000000000001', user_id, role, created_by, created_at, updated_at
FROM app_users
WHERE EXISTS (SELECT 1 FROM app_workspaces WHERE workspace_id = '00000000-0000-4000-8000-000000000001');

CREATE INDEX app_workspace_memberships_user_idx ON app_workspace_memberships (user_id, workspace_id);

CREATE TABLE app_workspace_access_requests (
  request_id UUID PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES app_workspaces(workspace_id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES app_users(user_id) ON DELETE CASCADE,
  note TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'denied')),
  resolved_by UUID REFERENCES app_users(user_id),
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX app_workspace_access_request_pending_idx
  ON app_workspace_access_requests (workspace_id, user_id) WHERE status = 'pending';

ALTER TABLE app_auth_sessions ADD COLUMN workspace_id UUID REFERENCES app_workspaces(workspace_id);
UPDATE app_auth_sessions SET workspace_id = '00000000-0000-4000-8000-000000000001'
WHERE EXISTS (SELECT 1 FROM app_workspaces WHERE workspace_id = '00000000-0000-4000-8000-000000000001');
