CREATE TABLE app_user_activity (
  id UUID PRIMARY KEY,
  workspace_id UUID REFERENCES app_workspaces(workspace_id) ON DELETE SET NULL,
  actor_user_id UUID REFERENCES app_users(user_id) ON DELETE SET NULL,
  effective_user_id UUID REFERENCES app_users(user_id) ON DELETE SET NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('page_visit', 'action')),
  action TEXT NOT NULL,
  surface TEXT NOT NULL DEFAULT '',
  target_type TEXT NOT NULL DEFAULT '',
  target_id TEXT NOT NULL DEFAULT '',
  detail_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  visit_count INTEGER NOT NULL DEFAULT 1,
  dedupe_key TEXT NOT NULL UNIQUE,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX app_user_activity_time_idx ON app_user_activity (occurred_at DESC);
CREATE INDEX app_user_activity_actor_time_idx ON app_user_activity (actor_user_id, occurred_at DESC);
CREATE INDEX app_user_activity_action_time_idx ON app_user_activity (action, occurred_at DESC);
CREATE INDEX app_user_activity_workspace_time_idx ON app_user_activity (workspace_id, occurred_at DESC);
