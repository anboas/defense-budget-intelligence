CREATE TABLE app_commercial_organizations (
  organization_id UUID PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  lifecycle_state TEXT NOT NULL DEFAULT 'internal' CHECK (lifecycle_state IN ('internal','prospect','trial','active','grace','suspended','closed')),
  billing_email TEXT NOT NULL DEFAULT '',
  created_by UUID REFERENCES app_users(user_id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE app_organization_memberships (
  organization_id UUID NOT NULL REFERENCES app_commercial_organizations(organization_id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES app_users(user_id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('owner','administrator','member')),
  created_by UUID REFERENCES app_users(user_id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (organization_id,user_id)
);
CREATE INDEX app_organization_memberships_user_idx ON app_organization_memberships(user_id,organization_id);

CREATE TABLE app_workspace_organizations (
  workspace_id UUID PRIMARY KEY REFERENCES app_workspaces(workspace_id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES app_commercial_organizations(organization_id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX app_workspace_organizations_org_idx ON app_workspace_organizations(organization_id,workspace_id);

CREATE TABLE app_commercial_plans (
  plan_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  entitlements_json JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','retired')),
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE app_organization_subscriptions (
  organization_id UUID PRIMARY KEY REFERENCES app_commercial_organizations(organization_id) ON DELETE CASCADE,
  plan_id TEXT NOT NULL REFERENCES app_commercial_plans(plan_id),
  status TEXT NOT NULL DEFAULT 'internal' CHECK (status IN ('internal','prospect','trial','active','grace','suspended','closed')),
  enforcement_mode TEXT NOT NULL DEFAULT 'observe' CHECK (enforcement_mode IN ('observe','enforce')),
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','provider')),
  trial_ends_at TIMESTAMPTZ,
  current_period_ends_at TIMESTAMPTZ,
  updated_by UUID REFERENCES app_users(user_id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE app_organization_entitlement_overrides (
  organization_id UUID NOT NULL REFERENCES app_commercial_organizations(organization_id) ON DELETE CASCADE,
  entitlement_key TEXT NOT NULL,
  value_json JSONB NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  updated_by UUID REFERENCES app_users(user_id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (organization_id,entitlement_key)
);

CREATE TABLE app_organization_usage_daily (
  organization_id UUID NOT NULL REFERENCES app_commercial_organizations(organization_id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL REFERENCES app_workspaces(workspace_id) ON DELETE CASCADE,
  usage_date DATE NOT NULL,
  dimension TEXT NOT NULL,
  quantity BIGINT NOT NULL DEFAULT 0,
  measured_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (organization_id,workspace_id,usage_date,dimension)
);
CREATE INDEX app_organization_usage_daily_org_idx ON app_organization_usage_daily(organization_id,usage_date DESC,dimension);

CREATE TABLE app_entitlement_observations (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES app_commercial_organizations(organization_id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL REFERENCES app_workspaces(workspace_id) ON DELETE CASCADE,
  entitlement_key TEXT NOT NULL,
  usage_value BIGINT NOT NULL,
  limit_value BIGINT NOT NULL,
  enforcement_mode TEXT NOT NULL,
  observed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX app_entitlement_observations_org_idx ON app_entitlement_observations(organization_id,observed_at DESC);

INSERT INTO app_commercial_plans(plan_id,name,summary,entitlements_json,status,version)
VALUES
  ('internal','Internal','Grandfathered access for the current DBI team while the commercial model is developed.',
   '{"seats":50,"teams":50,"workspaces":10,"savedViews":100,"agentCredentials":25,"retentionDays":365,"samRefreshHours":6,"aiJobsMonthly":1000,"auditExport":true,"agentApi":true,"customBranding":true}'::jsonb,'active',1),
  ('pilot','Pilot','Sales-assisted design-partner plan with bounded capacity and full workspace workflows.',
   '{"seats":10,"teams":10,"workspaces":1,"savedViews":25,"agentCredentials":5,"retentionDays":180,"samRefreshHours":24,"aiJobsMonthly":250,"auditExport":true,"agentApi":true,"customBranding":false}'::jsonb,'active',1)
ON CONFLICT(plan_id) DO UPDATE SET name=EXCLUDED.name,summary=EXCLUDED.summary,entitlements_json=EXCLUDED.entitlements_json,updated_at=NOW();

INSERT INTO app_commercial_organizations(organization_id,name,slug,lifecycle_state,billing_email,created_by)
SELECT '00000000-0000-4000-8000-000000000002','Internal','internal','internal','',user_id
FROM app_super_user WHERE singleton=TRUE
ON CONFLICT(organization_id) DO NOTHING;

INSERT INTO app_organization_memberships(organization_id,user_id,role,created_by)
SELECT '00000000-0000-4000-8000-000000000002',user_id,'owner',user_id
FROM app_super_user WHERE singleton=TRUE
ON CONFLICT(organization_id,user_id) DO NOTHING;

INSERT INTO app_workspace_organizations(workspace_id,organization_id)
SELECT workspace_id,'00000000-0000-4000-8000-000000000002' FROM app_workspaces
ON CONFLICT(workspace_id) DO NOTHING;

INSERT INTO app_organization_subscriptions(organization_id,plan_id,status,enforcement_mode,source,updated_by)
SELECT '00000000-0000-4000-8000-000000000002','internal','internal','observe','manual',user_id
FROM app_super_user WHERE singleton=TRUE
ON CONFLICT(organization_id) DO NOTHING;
