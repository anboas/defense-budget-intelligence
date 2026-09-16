CREATE INDEX app_api_request_log_trace_kind_time_idx
  ON app_api_request_log (trace_id, request_kind, completed_at DESC);

CREATE INDEX app_api_request_log_completed_time_idx
  ON app_api_request_log (completed_at);

CREATE INDEX app_event_ai_jobs_completed_time_idx
  ON app_event_ai_jobs (completed_at);

CREATE INDEX app_login_attempts_time_idx
  ON app_login_attempts (attempted_at);
