CREATE TABLE app_workspace_teams (
  team_id UUID PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES app_workspaces(workspace_id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  icon_data_url TEXT NOT NULL DEFAULT '',
  created_by UUID NOT NULL REFERENCES app_users(user_id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (workspace_id, team_id)
);

CREATE UNIQUE INDEX app_workspace_teams_name_idx ON app_workspace_teams (workspace_id, LOWER(name));

CREATE TABLE app_workspace_team_members (
  workspace_id UUID NOT NULL REFERENCES app_workspaces(workspace_id) ON DELETE CASCADE,
  team_id UUID NOT NULL,
  user_id UUID NOT NULL REFERENCES app_users(user_id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (workspace_id, team_id, user_id),
  FOREIGN KEY (workspace_id, team_id) REFERENCES app_workspace_teams(workspace_id, team_id) ON DELETE CASCADE
);

CREATE INDEX app_workspace_team_members_user_idx ON app_workspace_team_members (workspace_id, user_id, team_id);

CREATE TABLE app_workspace_event_teams (
  workspace_id UUID NOT NULL REFERENCES app_workspaces(workspace_id) ON DELETE CASCADE,
  event_id TEXT NOT NULL,
  team_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (workspace_id, event_id, team_id),
  FOREIGN KEY (workspace_id, team_id) REFERENCES app_workspace_teams(workspace_id, team_id) ON DELETE RESTRICT
);

CREATE INDEX app_workspace_event_teams_event_idx ON app_workspace_event_teams (workspace_id, event_id, team_id);

CREATE TABLE app_session_emulations (
  session_id UUID PRIMARY KEY REFERENCES app_auth_sessions(id) ON DELETE CASCADE,
  actor_user_id UUID NOT NULL REFERENCES app_users(user_id) ON DELETE CASCADE,
  target_user_id UUID NOT NULL REFERENCES app_users(user_id) ON DELETE CASCADE,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
