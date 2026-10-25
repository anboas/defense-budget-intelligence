CREATE TABLE app_tasking_objects (
  workspace_id UUID NOT NULL REFERENCES app_workspaces(workspace_id) ON DELETE CASCADE,
  object_id TEXT NOT NULL,
  object_type TEXT NOT NULL CHECK (object_type IN ('task','workstream','anchor','context','relationship','source_item')),
  payload_json JSONB NOT NULL DEFAULT '{}'::JSONB,
  version INTEGER NOT NULL DEFAULT 1,
  source_system TEXT NOT NULL DEFAULT '',
  source_key TEXT NOT NULL DEFAULT '',
  created_by_type TEXT NOT NULL,
  created_by UUID NOT NULL REFERENCES app_users(user_id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  PRIMARY KEY (workspace_id, object_id)
);

CREATE INDEX app_tasking_objects_workspace_type_idx
  ON app_tasking_objects (workspace_id, object_type, updated_at DESC);

CREATE UNIQUE INDEX app_tasking_objects_source_idx
  ON app_tasking_objects (workspace_id, source_system, source_key)
  WHERE source_system <> '' AND source_key <> '';
