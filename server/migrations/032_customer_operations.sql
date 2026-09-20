CREATE TABLE app_organization_onboarding_steps (
  organization_id UUID NOT NULL REFERENCES app_commercial_organizations(organization_id) ON DELETE CASCADE,
  step_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','in_progress','completed','waived')),
  note TEXT NOT NULL DEFAULT '',
  updated_by UUID REFERENCES app_users(user_id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (organization_id,step_key)
);

CREATE TABLE app_organization_service_requests (
  request_id UUID PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES app_commercial_organizations(organization_id) ON DELETE CASCADE,
  workspace_id UUID REFERENCES app_workspaces(workspace_id) ON DELETE SET NULL,
  request_type TEXT NOT NULL CHECK (request_type IN ('support','data_export','data_deletion','cancellation','ownership_transfer')),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_progress','waiting','resolved','cancelled')),
  subject TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '',
  requested_by UUID NOT NULL REFERENCES app_users(user_id),
  assigned_to UUID REFERENCES app_users(user_id),
  resolution_note TEXT NOT NULL DEFAULT '',
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX app_organization_service_requests_org_idx
  ON app_organization_service_requests(organization_id,status,created_at DESC);

INSERT INTO app_organization_onboarding_steps(organization_id,step_key,status,note,updated_by)
SELECT organization_id,step_key,'pending','',created_by
FROM app_commercial_organizations
CROSS JOIN (VALUES
  ('confirm_owner'),
  ('invite_team'),
  ('connect_source'),
  ('create_saved_view'),
  ('review_security')
) AS steps(step_key)
ON CONFLICT(organization_id,step_key) DO NOTHING;
