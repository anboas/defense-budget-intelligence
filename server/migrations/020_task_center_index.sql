CREATE INDEX app_event_ai_jobs_workspace_user_time_idx
  ON app_event_ai_jobs (workspace_id, user_id, created_at DESC);
