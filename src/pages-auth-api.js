const encoder = new TextEncoder();
import {
  EVENT_AI_PRODUCER_MODEL,
  EVENT_AI_VERIFIER_MODEL,
  buildEventAiProducerRequest,
  buildEventAiVerifierRequest,
  citedEventAiDetails,
  deleteOpenAiResponse,
  eventAiEvidenceDiagnostic,
  eventAiProviderError,
  isRetryableEventAiError,
  resolveEventAiVerificationOutcome,
  mockEventAiProposal,
  mockEventAiVerification,
  normalizeEventAiDetails,
  normalizeEventAiDraft,
  parseOpenAiStructuredResponse,
  retrieveOpenAiResponse,
  startOpenAiBackgroundResponse,
} from "./event-ai-runtime.js";
import {
  MOCK_EVENT_AI_MODELS,
  assertEventAiModels,
  chooseEventAiModel,
  eventAiModelCandidates,
  fetchOpenAiModels,
} from "./openai-models.js";
import {
  cleanText,
  normalizeEmail,
  readBoundedJson,
  safeLogMetadata,
  safeLogText,
  sameOriginRequest,
  validAvatarDataUrl,
  validOpenAiKey,
  validPasswordProof,
  validSalt,
} from "./security-policy.js";
import { ACQUISITION_SCHEMA, acquisitionRuntimeResponse, acquisitionSchedulerResponse } from "./d1-acquisition-runtime.js";
import {
  activeEventAttendeeIds,
  activeEventCategoryIds,
  applyVerifiedEventDraft,
  cleanEventLinks,
  cleanEventMilestones,
  eventAiReviewRisks,
  eventFromRow,
  eventTeamSelection,
  eventsFromRows,
  replaceEventAttendees,
  replaceEventCategories,
  replaceEventLinks,
  replaceEventMilestones,
  replaceEventTeams,
  visibleEventRow,
  visibleEventRows,
  writeEventAiState,
} from "./d1-event-store.js";
import { teamsResponse as handleTeamsResponse } from "./d1-team-store.js";
import { emulationResponse as handleEmulationResponse } from "./d1-emulation.js";
import { D1_USER_ACTIVITY_SCHEMA, recordUserActivityD1, userActivityResponse as handleUserActivityResponse } from "./d1-user-activity.js";
import { directoryResponse as handleDirectoryResponse } from "./d1-workspace-directory.js";
import { recordDispositionsResponse as handleRecordDispositionsResponse } from "./d1-record-dispositions.js";
import { clientErrorsResponse as handleClientErrorsResponse } from "./d1-client-errors.js";
import { providerCredentialsResponse as handleProviderCredentialsResponse } from "./d1-provider-credentials.js";
import { D1_REGISTRATION_SCHEMA, d1PublicRegistrationStatus, d1RegistrationResponse } from "./d1-registration.js";
import { agentOpenApiDocument } from "./agent-api-openapi.js";
import {
  ROLE_LABELS,
  WORKSPACE_ROLE_IDS,
  accessCapabilities,
} from "./access-model.js";
export const PAGES_AUTH_VERSION = "dbi-pages-auth-v1";
export const PASSWORD_ITERATIONS = 310_000;
export const SESSION_COOKIE = "dbi_session";
export const SESSION_MAX_AGE_SECONDS = 14 * 24 * 60 * 60;
const MAX_ATTEMPTS = 8;
const ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
const RETENTION_MAINTENANCE_INTERVAL_MS = 24 * 60 * 60 * 1000;
const RETENTION_DAYS = 90;
const MAX_BODY_BYTES = 16_384;
const AGENT_API_VERSION = "dbi-agent-v1";
const AGENT_TOKEN_PREFIX = "dbi_agent_";
const AGENT_RATE_LIMIT = 300;
const AGENT_SCOPES = Object.freeze([
  "records:read", "records:write",
  "tracking:read", "tracking:write",
  "events:read", "events:write",
  "activity:read", "activity:write",
  "integrations:read",
]);
const USER_ROLES = WORKSPACE_ROLE_IDS;
const USER_STATUSES = Object.freeze(["active", "suspended"]);
const DEFAULT_WORKSPACE_ID = "workspace-defense-budget";
const DEFAULT_HEADER_EYEBROW = "Defense Budget & Spend Analytics";
const DEFAULT_DISPLAY_TITLE = "Defense Budget Intelligence";
const DEFAULT_EVENT_CATEGORIES = Object.freeze([
  ["conference", "Conference", "Conferences, conventions, and annual meetings"],
  ["industry-day", "Industry day", "Government and mission-partner industry engagement"],
  ["workshop", "Workshop", "Hands-on working sessions and workshops"],
  ["immersion-day", "Immersion day", "Focused mission, customer, or technology immersion"],
  ["summit", "Summit", "Executive, technical, and mission summits"],
  ["other", "Other", "Workspace events outside the managed categories"],
]);
const READ_SCOPES = Object.freeze(["records:read", "tracking:read", "events:read", "activity:read", "integrations:read"]);
function defaultEventCategoryStatements(db, workspaceId, now) {
  return DEFAULT_EVENT_CATEGORIES.map(([categoryId, name, description]) => db.prepare(`
    INSERT OR IGNORE INTO dbi_workspace_event_categories
      (workspace_id, category_id, name, description, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).bind(workspaceId, categoryId, name, description, now, now));
}
const SCHEMA = Object.freeze([
  `CREATE TABLE IF NOT EXISTS dbi_super_user (
    singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
    user_id TEXT NOT NULL UNIQUE,
    email TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    title TEXT NOT NULL DEFAULT '',
    password_salt TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS dbi_users (
    user_id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    title TEXT NOT NULL DEFAULT '',
    role TEXT NOT NULL CHECK (role IN ('super_user', 'administrator', 'analyst', 'viewer')),
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
    password_salt TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    must_change_password INTEGER NOT NULL DEFAULT 0,
    created_by TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    last_login_at TEXT NOT NULL DEFAULT ''
  )`,
  "CREATE UNIQUE INDEX IF NOT EXISTS idx_dbi_users_email_lower ON dbi_users (LOWER(email))",
  ...D1_REGISTRATION_SCHEMA,
  `INSERT OR IGNORE INTO dbi_users
    (user_id, email, display_name, title, role, status, password_salt, password_hash, must_change_password, created_by, created_at, updated_at, last_login_at)
    SELECT user_id, email, display_name, title, 'super_user', 'active', password_salt, password_hash, 0, user_id, created_at, updated_at, ''
    FROM dbi_super_user WHERE singleton = 1`,
  `CREATE TABLE IF NOT EXISTS dbi_sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    expires_at TEXT NOT NULL,
    revoked_at TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL
  )`,
  "CREATE INDEX IF NOT EXISTS idx_dbi_sessions_user ON dbi_sessions (user_id, expires_at)",
  `CREATE TABLE IF NOT EXISTS dbi_login_attempts (
    id TEXT PRIMARY KEY,
    client_hash TEXT NOT NULL,
    succeeded INTEGER NOT NULL DEFAULT 0,
    attempted_at TEXT NOT NULL
  )`,
  "CREATE INDEX IF NOT EXISTS idx_dbi_login_attempts_client ON dbi_login_attempts (client_hash, attempted_at)",
  "CREATE INDEX IF NOT EXISTS idx_dbi_login_attempts_time ON dbi_login_attempts (attempted_at)",
  `CREATE TABLE IF NOT EXISTS dbi_agent_keys (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    scopes_json TEXT NOT NULL,
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL,
    last_used_at TEXT NOT NULL DEFAULT '',
    expires_at TEXT NOT NULL DEFAULT '',
    revoked_at TEXT NOT NULL DEFAULT ''
  )`,
  `CREATE TABLE IF NOT EXISTS dbi_watchlist (
    record_id TEXT PRIMARY KEY,
    note TEXT NOT NULL DEFAULT '',
    review_at TEXT NOT NULL DEFAULT '',
    wallboard INTEGER NOT NULL DEFAULT 1,
    version INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS dbi_management_events (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    starts_at TEXT NOT NULL,
    ends_at TEXT NOT NULL DEFAULT '',
    location TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'scheduled',
    record_ids_json TEXT NOT NULL DEFAULT '[]',
    wallboard INTEGER NOT NULL DEFAULT 1,
    version INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS dbi_event_attendees (
    event_id TEXT NOT NULL,
    attendee_name TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (event_id, attendee_name)
  )`,
  "CREATE INDEX IF NOT EXISTS idx_dbi_event_attendees_event ON dbi_event_attendees (event_id)",
  `CREATE TABLE IF NOT EXISTS dbi_event_user_attendees (
    event_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (event_id, user_id)
  )`,
  "CREATE INDEX IF NOT EXISTS idx_dbi_event_user_attendees_event ON dbi_event_user_attendees (event_id)",
  `CREATE TABLE IF NOT EXISTS dbi_schema_migrations (
    name TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL
  )`,
  `INSERT OR IGNORE INTO dbi_management_events
    (id, title, starts_at, ends_at, location, notes, status, record_ids_json, wallboard, version, created_at, updated_at)
    SELECT 'event-air-space-cyber-conference-2026', 'Air, Space & Cyber Conference', '2026-09-14T08:00', '2026-09-16T17:00', 'National Harbor, Maryland, USA', '', 'scheduled', '[]', 1, 1, '2026-09-14T19:00:00.000Z', '2026-09-14T19:00:00.000Z'
    WHERE NOT EXISTS (SELECT 1 FROM dbi_schema_migrations WHERE name = '2026-09-14-event-wallboard-import')`,
  `INSERT OR IGNORE INTO dbi_management_events
    (id, title, starts_at, ends_at, location, notes, status, record_ids_json, wallboard, version, created_at, updated_at)
    SELECT 'event-ausa-annual-meeting-2026', 'AUSA Annual Meeting & Exposition 2026', '2026-10-12T08:00', '2026-10-14T17:00', 'Walter E. Washington Convention Center, 801 Allen Y. Lew Pl NW, Washington, DC 20001', '', 'scheduled', '[]', 1, 1, '2026-09-14T19:00:00.000Z', '2026-09-14T19:00:00.000Z'
    WHERE NOT EXISTS (SELECT 1 FROM dbi_schema_migrations WHERE name = '2026-09-14-event-wallboard-import')`,
  `INSERT OR IGNORE INTO dbi_management_events
    (id, title, starts_at, ends_at, location, notes, status, record_ids_json, wallboard, version, created_at, updated_at)
    SELECT 'event-eighth-annual-defense-conference-2026', '8th Annual Defense Conference', '2026-10-30T08:00', '2026-10-30T17:00', 'Hyatt Regency Crystal City, Virginia or virtual', '', 'scheduled', '[]', 1, 1, '2026-09-14T19:00:00.000Z', '2026-09-14T19:00:00.000Z'
    WHERE NOT EXISTS (SELECT 1 FROM dbi_schema_migrations WHERE name = '2026-09-14-event-wallboard-import')`,
  `INSERT OR IGNORE INTO dbi_management_events
    (id, title, starts_at, ends_at, location, notes, status, record_ids_json, wallboard, version, created_at, updated_at)
    SELECT 'event-i-itsec-2026', 'Interservice/Industry Training, Simulation and Education Conference (I/ITSEC) 2026', '2026-11-30T08:00', '2026-12-04T17:00', 'Orange County Convention Center, South Concourse, 9899 International Drive, Orlando, FL 32819', '', 'scheduled', '[]', 1, 1, '2026-09-14T19:00:00.000Z', '2026-09-14T19:00:00.000Z'
    WHERE NOT EXISTS (SELECT 1 FROM dbi_schema_migrations WHERE name = '2026-09-14-event-wallboard-import')`,
  `INSERT OR IGNORE INTO dbi_management_events
    (id, title, starts_at, ends_at, location, notes, status, record_ids_json, wallboard, version, created_at, updated_at)
    SELECT 'event-weapon-systems-software-summit-2026', '2026 Department of Defense Weapon Systems Software Summit', '2026-12-08T08:00', '2026-12-08T17:00', 'Broward County Convention Center, Fort Lauderdale, Florida, United States', '', 'scheduled', '[]', 1, 1, '2026-09-14T19:00:00.000Z', '2026-09-14T19:00:00.000Z'
    WHERE NOT EXISTS (SELECT 1 FROM dbi_schema_migrations WHERE name = '2026-09-14-event-wallboard-import')`,
  `INSERT OR IGNORE INTO dbi_event_attendees (event_id, attendee_name, created_at)
    SELECT 'event-air-space-cyber-conference-2026', 'Jon VandeMark', '2026-09-14T19:00:00.000Z'
    WHERE NOT EXISTS (SELECT 1 FROM dbi_schema_migrations WHERE name = '2026-09-14-event-wallboard-import')`,
  `INSERT OR IGNORE INTO dbi_event_attendees (event_id, attendee_name, created_at)
    SELECT 'event-air-space-cyber-conference-2026', 'Adam Boas', '2026-09-14T19:00:00.000Z'
    WHERE NOT EXISTS (SELECT 1 FROM dbi_schema_migrations WHERE name = '2026-09-14-event-wallboard-import')`,
  `INSERT OR IGNORE INTO dbi_event_attendees (event_id, attendee_name, created_at)
    SELECT 'event-eighth-annual-defense-conference-2026', 'Jon VandeMark', '2026-09-14T19:00:00.000Z'
    WHERE NOT EXISTS (SELECT 1 FROM dbi_schema_migrations WHERE name = '2026-09-14-event-wallboard-import')`,
  `INSERT OR IGNORE INTO dbi_event_attendees (event_id, attendee_name, created_at)
    SELECT 'event-eighth-annual-defense-conference-2026', 'Adam Boas', '2026-09-14T19:00:00.000Z'
    WHERE NOT EXISTS (SELECT 1 FROM dbi_schema_migrations WHERE name = '2026-09-14-event-wallboard-import')`,
  `INSERT OR IGNORE INTO dbi_event_attendees (event_id, attendee_name, created_at)
    SELECT 'event-i-itsec-2026', 'Jon VandeMark', '2026-09-14T19:00:00.000Z'
    WHERE NOT EXISTS (SELECT 1 FROM dbi_schema_migrations WHERE name = '2026-09-14-event-wallboard-import')`,
  `INSERT OR IGNORE INTO dbi_event_attendees (event_id, attendee_name, created_at)
    SELECT 'event-i-itsec-2026', 'Adam Boas', '2026-09-14T19:00:00.000Z'
    WHERE NOT EXISTS (SELECT 1 FROM dbi_schema_migrations WHERE name = '2026-09-14-event-wallboard-import')`,
  `INSERT OR IGNORE INTO dbi_event_attendees (event_id, attendee_name, created_at)
    SELECT 'event-weapon-systems-software-summit-2026', 'Adam Boas', '2026-09-14T19:00:00.000Z'
    WHERE NOT EXISTS (SELECT 1 FROM dbi_schema_migrations WHERE name = '2026-09-14-event-wallboard-import')`,
  `INSERT OR IGNORE INTO dbi_schema_migrations (name, applied_at)
    VALUES ('2026-09-14-event-wallboard-import', '2026-09-14T19:00:00.000Z')`,
  `INSERT OR IGNORE INTO dbi_event_user_attendees (event_id, user_id, created_at)
    SELECT attendee.event_id, user.user_id, '2026-09-14T19:40:00.000Z'
    FROM dbi_event_attendees attendee
    JOIN dbi_users user ON user.role = 'super_user'
    WHERE attendee.attendee_name = 'Adam Boas'
      AND NOT EXISTS (SELECT 1 FROM dbi_schema_migrations WHERE name = '2026-09-14-event-user-attendees')`,
  `INSERT OR IGNORE INTO dbi_event_user_attendees (event_id, user_id, created_at)
    SELECT attendee.event_id, user.user_id, '2026-09-14T19:40:00.000Z'
    FROM dbi_event_attendees attendee
    JOIN dbi_users user ON LOWER(user.display_name) = LOWER(attendee.attendee_name)
    WHERE NOT EXISTS (SELECT 1 FROM dbi_schema_migrations WHERE name = '2026-09-14-event-user-attendees')`,
  `INSERT OR IGNORE INTO dbi_schema_migrations (name, applied_at)
    VALUES ('2026-09-14-event-user-attendees', '2026-09-14T19:40:00.000Z')`,
  `CREATE TABLE IF NOT EXISTS dbi_operator_activity (
    id TEXT PRIMARY KEY,
    actor_type TEXT NOT NULL,
    actor_id TEXT NOT NULL,
    action TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL DEFAULT '',
    detail_json TEXT NOT NULL DEFAULT '{}',
    occurred_at TEXT NOT NULL
  )`,
  "CREATE INDEX IF NOT EXISTS idx_dbi_operator_activity_at ON dbi_operator_activity (occurred_at DESC)",
  `CREATE TABLE IF NOT EXISTS dbi_manual_records (
    id TEXT PRIMARY KEY,
    payload_json TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT NOT NULL DEFAULT ''
  )`,
  `CREATE TABLE IF NOT EXISTS dbi_agent_idempotency (
    principal_id TEXT NOT NULL,
    idempotency_key TEXT NOT NULL,
    request_fingerprint TEXT NOT NULL,
    response_status INTEGER NOT NULL,
    response_body TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (principal_id, idempotency_key)
  )`,
  `CREATE TABLE IF NOT EXISTS dbi_agent_rate_limits (
    principal_id TEXT NOT NULL,
    minute_bucket TEXT NOT NULL,
    request_count INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (principal_id, minute_bucket)
  )`,
  `CREATE TABLE IF NOT EXISTS dbi_workspaces (
    workspace_id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    description TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
    owner_user_id TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `INSERT OR IGNORE INTO dbi_workspaces
    (workspace_id, name, slug, description, status, owner_user_id, created_at, updated_at)
    VALUES ('workspace-defense-budget', 'Defense budget', 'defense-budget', 'Defense Budget Intelligence shared workspace', 'active', '', '2026-09-14T20:20:00.000Z', '2026-09-14T20:20:00.000Z')`,
  `CREATE TABLE IF NOT EXISTS dbi_workspace_settings (
    workspace_id TEXT PRIMARY KEY,
    icon_data_url TEXT NOT NULL DEFAULT '',
    header_eyebrow TEXT NOT NULL DEFAULT 'Defense Budget & Spend Analytics',
    display_title TEXT NOT NULL DEFAULT 'Defense Budget Intelligence',
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS dbi_workspace_memberships (
    workspace_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('super_user', 'administrator', 'analyst', 'viewer')),
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (workspace_id, user_id)
  )`,
  "CREATE INDEX IF NOT EXISTS idx_dbi_workspace_memberships_user ON dbi_workspace_memberships (user_id, workspace_id)",
  `CREATE TABLE IF NOT EXISTS dbi_workspace_teams (
    team_id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    icon_data_url TEXT NOT NULL DEFAULT '',
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  "CREATE UNIQUE INDEX IF NOT EXISTS idx_dbi_workspace_teams_name ON dbi_workspace_teams (workspace_id, LOWER(name))",
  "CREATE INDEX IF NOT EXISTS idx_dbi_workspace_teams_workspace ON dbi_workspace_teams (workspace_id, name)",
  `CREATE TABLE IF NOT EXISTS dbi_workspace_team_members (
    workspace_id TEXT NOT NULL,
    team_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (workspace_id, team_id, user_id)
  )`,
  "CREATE INDEX IF NOT EXISTS idx_dbi_workspace_team_members_user ON dbi_workspace_team_members (workspace_id, user_id, team_id)",
  `CREATE TABLE IF NOT EXISTS dbi_workspace_access_requests (
    request_id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    note TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'denied')),
    resolved_by TEXT NOT NULL DEFAULT '',
    resolved_at TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  "CREATE UNIQUE INDEX IF NOT EXISTS idx_dbi_workspace_request_pending ON dbi_workspace_access_requests (workspace_id, user_id) WHERE status = 'pending'",
  `CREATE TABLE IF NOT EXISTS dbi_session_workspaces (
    session_id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS dbi_session_emulations (
    session_id TEXT PRIMARY KEY,
    actor_user_id TEXT NOT NULL,
    target_user_id TEXT NOT NULL,
    started_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS dbi_user_profiles (
    user_id TEXT PRIMARY KEY,
    avatar_data_url TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS dbi_openai_keys (
    id TEXT PRIMARY KEY,
    scope_type TEXT NOT NULL CHECK (scope_type IN ('workspace', 'user')),
    workspace_id TEXT NOT NULL DEFAULT '',
    user_id TEXT NOT NULL DEFAULT '',
    label TEXT NOT NULL,
    encrypted_key TEXT NOT NULL,
    key_iv TEXT NOT NULL,
    key_version INTEGER NOT NULL DEFAULT 1,
    key_last_four TEXT NOT NULL,
    is_default INTEGER NOT NULL DEFAULT 0,
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    revoked_at TEXT NOT NULL DEFAULT '',
    last_used_at TEXT NOT NULL DEFAULT ''
  )`,
  "CREATE INDEX IF NOT EXISTS idx_dbi_openai_keys_workspace ON dbi_openai_keys (workspace_id, scope_type, revoked_at, created_at DESC)",
  "CREATE INDEX IF NOT EXISTS idx_dbi_openai_keys_user ON dbi_openai_keys (user_id, scope_type, revoked_at, created_at DESC)",
  `CREATE TABLE IF NOT EXISTS dbi_workspace_provider_credentials (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    provider TEXT NOT NULL CHECK (provider IN ('sam_gov')),
    label TEXT NOT NULL,
    encrypted_secret TEXT NOT NULL,
    secret_iv TEXT NOT NULL,
    secret_version INTEGER NOT NULL DEFAULT 1,
    secret_last_four TEXT NOT NULL,
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    revoked_at TEXT NOT NULL DEFAULT '',
    last_used_at TEXT NOT NULL DEFAULT ''
  )`,
  "CREATE UNIQUE INDEX IF NOT EXISTS idx_dbi_workspace_provider_credentials_active ON dbi_workspace_provider_credentials (workspace_id, provider) WHERE revoked_at = ''",
  "CREATE INDEX IF NOT EXISTS idx_dbi_workspace_provider_credentials_history ON dbi_workspace_provider_credentials (workspace_id, provider, revoked_at, created_at DESC)",
  ...ACQUISITION_SCHEMA,
  `CREATE TABLE IF NOT EXISTS dbi_api_request_log (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL DEFAULT '',
    user_id TEXT NOT NULL DEFAULT '',
    principal_type TEXT NOT NULL,
    principal_id TEXT NOT NULL,
    request_kind TEXT NOT NULL,
    provider TEXT NOT NULL,
    operation TEXT NOT NULL,
    method TEXT NOT NULL DEFAULT '',
    route TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL,
    http_status INTEGER NOT NULL DEFAULT 0,
    stage TEXT NOT NULL DEFAULT '',
    model TEXT NOT NULL DEFAULT '',
    credential_id TEXT NOT NULL DEFAULT '',
    credential_scope TEXT NOT NULL DEFAULT '',
    provider_request_id TEXT NOT NULL DEFAULT '',
    trace_id TEXT NOT NULL DEFAULT '',
    response_id TEXT NOT NULL DEFAULT '',
    latency_ms INTEGER NOT NULL DEFAULT 0,
    input_tokens INTEGER NOT NULL DEFAULT 0,
    output_tokens INTEGER NOT NULL DEFAULT 0,
    retry_count INTEGER NOT NULL DEFAULT 0,
    retryable INTEGER NOT NULL DEFAULT 0,
    error_code TEXT NOT NULL DEFAULT '',
    error_message TEXT NOT NULL DEFAULT '',
    metadata_json TEXT NOT NULL DEFAULT '{}',
    started_at TEXT NOT NULL,
    completed_at TEXT NOT NULL
  )`,
  "CREATE INDEX IF NOT EXISTS idx_dbi_api_request_log_workspace ON dbi_api_request_log (workspace_id, completed_at DESC)",
  "CREATE INDEX IF NOT EXISTS idx_dbi_api_request_log_user ON dbi_api_request_log (user_id, completed_at DESC)",
  "CREATE INDEX IF NOT EXISTS idx_dbi_api_request_log_credential ON dbi_api_request_log (credential_id, completed_at DESC)",
  "CREATE INDEX IF NOT EXISTS idx_dbi_api_request_log_status ON dbi_api_request_log (workspace_id, status, completed_at DESC)",
  "CREATE INDEX IF NOT EXISTS idx_dbi_api_request_log_trace_kind_time ON dbi_api_request_log (trace_id, request_kind, completed_at DESC)",
  "CREATE INDEX IF NOT EXISTS idx_dbi_api_request_log_completed ON dbi_api_request_log (completed_at)",
  `CREATE TABLE IF NOT EXISTS dbi_workspace_ai_settings (
    workspace_id TEXT PRIMARY KEY,
    event_research_model TEXT NOT NULL DEFAULT '',
    event_verification_model TEXT NOT NULL DEFAULT '',
    updated_by TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS dbi_workspace_ai_preferences (
    workspace_id TEXT PRIMARY KEY,
    auto_accept_event_augmentations INTEGER NOT NULL DEFAULT 0,
    updated_by TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS dbi_event_ai_jobs (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    status TEXT NOT NULL,
    current_step TEXT NOT NULL,
    credential_id TEXT NOT NULL,
    credential_scope TEXT NOT NULL,
    producer_model TEXT NOT NULL,
    verifier_model TEXT NOT NULL,
    producer_response_id TEXT NOT NULL DEFAULT '',
    verifier_response_id TEXT NOT NULL DEFAULT '',
    direction TEXT NOT NULL DEFAULT '',
    input_snapshot_json TEXT NOT NULL,
    categories_json TEXT NOT NULL DEFAULT '[]',
    proposal_json TEXT NOT NULL DEFAULT '{}',
    verification_json TEXT NOT NULL DEFAULT '{}',
    merge_result_json TEXT NOT NULL DEFAULT '{}',
    error_code TEXT NOT NULL DEFAULT '',
    error_message TEXT NOT NULL DEFAULT '',
    retry_count INTEGER NOT NULL DEFAULT 0,
    trace_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    completed_at TEXT NOT NULL DEFAULT ''
  )`,
  "CREATE INDEX IF NOT EXISTS idx_dbi_event_ai_jobs_workspace ON dbi_event_ai_jobs (workspace_id, created_at DESC)",
  "CREATE INDEX IF NOT EXISTS idx_dbi_event_ai_jobs_user ON dbi_event_ai_jobs (user_id, created_at DESC)",
  "CREATE INDEX IF NOT EXISTS idx_dbi_event_ai_jobs_workspace_user_time ON dbi_event_ai_jobs (workspace_id, user_id, created_at DESC)",
  "CREATE INDEX IF NOT EXISTS idx_dbi_event_ai_jobs_completed ON dbi_event_ai_jobs (completed_at)",
  `CREATE TABLE IF NOT EXISTS dbi_event_ai_state (
    workspace_id TEXT NOT NULL,
    event_id TEXT NOT NULL,
    last_job_id TEXT NOT NULL DEFAULT '',
    last_status TEXT NOT NULL DEFAULT '',
    last_augmented_at TEXT NOT NULL DEFAULT '',
    last_applied_at TEXT NOT NULL DEFAULT '',
    validation_required INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (workspace_id, event_id)
  )`,
  "CREATE INDEX IF NOT EXISTS idx_dbi_event_ai_state_workspace ON dbi_event_ai_state (workspace_id, last_augmented_at DESC)",
  `CREATE TABLE IF NOT EXISTS dbi_maintenance_state (
    task TEXT PRIMARY KEY,
    last_run_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS dbi_workspace_agent_keys (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    name TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    scopes_json TEXT NOT NULL,
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL,
    last_used_at TEXT NOT NULL DEFAULT '',
    expires_at TEXT NOT NULL DEFAULT '',
    revoked_at TEXT NOT NULL DEFAULT ''
  )`,
  "CREATE INDEX IF NOT EXISTS idx_dbi_workspace_agent_keys_workspace ON dbi_workspace_agent_keys (workspace_id, created_at DESC)",
  `CREATE TABLE IF NOT EXISTS dbi_workspace_watchlist (
    workspace_id TEXT NOT NULL,
    record_id TEXT NOT NULL,
    note TEXT NOT NULL DEFAULT '',
    review_at TEXT NOT NULL DEFAULT '',
    wallboard INTEGER NOT NULL DEFAULT 1,
    version INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (workspace_id, record_id)
  )`,
  `CREATE TABLE IF NOT EXISTS dbi_workspace_record_dispositions (
    workspace_id TEXT NOT NULL,
    record_id TEXT NOT NULL,
    disposition TEXT NOT NULL DEFAULT 'tombstoned',
    reason TEXT NOT NULL DEFAULT '',
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (workspace_id, record_id)
  )`,
  "CREATE INDEX IF NOT EXISTS idx_dbi_record_dispositions_workspace ON dbi_workspace_record_dispositions (workspace_id, disposition, updated_at DESC)",
  `CREATE TABLE IF NOT EXISTS dbi_workspace_events (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    title TEXT NOT NULL,
    starts_at TEXT NOT NULL,
    ends_at TEXT NOT NULL DEFAULT '',
    location TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'scheduled',
    record_ids_json TEXT NOT NULL DEFAULT '[]',
    wallboard INTEGER NOT NULL DEFAULT 1,
    version INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  "CREATE INDEX IF NOT EXISTS idx_dbi_workspace_events_workspace ON dbi_workspace_events (workspace_id, starts_at)",
  `CREATE TABLE IF NOT EXISTS dbi_workspace_event_teams (
    workspace_id TEXT NOT NULL,
    event_id TEXT NOT NULL,
    team_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (workspace_id, event_id, team_id)
  )`,
  "CREATE INDEX IF NOT EXISTS idx_dbi_workspace_event_teams_team ON dbi_workspace_event_teams (workspace_id, team_id, event_id)",
  `CREATE TABLE IF NOT EXISTS dbi_workspace_event_attendees (
    workspace_id TEXT NOT NULL,
    event_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (workspace_id, event_id, user_id)
  )`,
  `CREATE TABLE IF NOT EXISTS dbi_workspace_event_links (
    workspace_id TEXT NOT NULL,
    event_id TEXT NOT NULL,
    link_id TEXT NOT NULL,
    label TEXT NOT NULL DEFAULT '',
    url TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (workspace_id, event_id, link_id)
  )`,
  "CREATE INDEX IF NOT EXISTS idx_dbi_workspace_event_links_event ON dbi_workspace_event_links (workspace_id, event_id, sort_order)",
  `CREATE TABLE IF NOT EXISTS dbi_workspace_event_categories (
    workspace_id TEXT NOT NULL,
    category_id TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (workspace_id, category_id)
  )`,
  "CREATE UNIQUE INDEX IF NOT EXISTS idx_dbi_workspace_event_categories_name ON dbi_workspace_event_categories (workspace_id, name COLLATE NOCASE)",
  `CREATE TABLE IF NOT EXISTS dbi_workspace_event_category_assignments (
    workspace_id TEXT NOT NULL,
    event_id TEXT NOT NULL,
    category_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (workspace_id, event_id, category_id)
  )`,
  "CREATE INDEX IF NOT EXISTS idx_dbi_workspace_event_category_assignments_category ON dbi_workspace_event_category_assignments (workspace_id, category_id, event_id)",
  `CREATE TABLE IF NOT EXISTS dbi_workspace_event_milestones (
    workspace_id TEXT NOT NULL,
    event_id TEXT NOT NULL,
    milestone_id TEXT NOT NULL,
    type TEXT NOT NULL,
    label TEXT NOT NULL DEFAULT '',
    occurs_at TEXT NOT NULL,
    notes TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (workspace_id, event_id, milestone_id)
  )`,
  "CREATE INDEX IF NOT EXISTS idx_dbi_workspace_event_milestones_date ON dbi_workspace_event_milestones (workspace_id, occurs_at)",
  `INSERT OR IGNORE INTO dbi_workspace_event_categories (workspace_id, category_id, name, description, created_at, updated_at)
    SELECT workspace_id, 'conference', 'Conference', 'Conferences, conventions, and annual meetings', '2026-09-15T18:00:00.000Z', '2026-09-15T18:00:00.000Z' FROM dbi_workspaces`,
  `INSERT OR IGNORE INTO dbi_workspace_event_categories (workspace_id, category_id, name, description, created_at, updated_at)
    SELECT workspace_id, 'industry-day', 'Industry day', 'Government and mission-partner industry engagement', '2026-09-15T18:00:00.000Z', '2026-09-15T18:00:00.000Z' FROM dbi_workspaces`,
  `INSERT OR IGNORE INTO dbi_workspace_event_categories (workspace_id, category_id, name, description, created_at, updated_at)
    SELECT workspace_id, 'workshop', 'Workshop', 'Hands-on working sessions and workshops', '2026-09-15T18:00:00.000Z', '2026-09-15T18:00:00.000Z' FROM dbi_workspaces`,
  `INSERT OR IGNORE INTO dbi_workspace_event_categories (workspace_id, category_id, name, description, created_at, updated_at)
    SELECT workspace_id, 'immersion-day', 'Immersion day', 'Focused mission, customer, or technology immersion', '2026-09-15T18:00:00.000Z', '2026-09-15T18:00:00.000Z' FROM dbi_workspaces`,
  `INSERT OR IGNORE INTO dbi_workspace_event_categories (workspace_id, category_id, name, description, created_at, updated_at)
    SELECT workspace_id, 'summit', 'Summit', 'Executive, technical, and mission summits', '2026-09-15T18:00:00.000Z', '2026-09-15T18:00:00.000Z' FROM dbi_workspaces`,
  `INSERT OR IGNORE INTO dbi_workspace_event_categories (workspace_id, category_id, name, description, created_at, updated_at)
    SELECT workspace_id, 'other', 'Other', 'Workspace events outside the managed categories', '2026-09-15T18:00:00.000Z', '2026-09-15T18:00:00.000Z' FROM dbi_workspaces`,
  `INSERT OR IGNORE INTO dbi_workspace_event_category_assignments (workspace_id, event_id, category_id, created_at)
    SELECT workspace_id, id, 'conference', '2026-09-15T18:00:00.000Z' FROM dbi_workspace_events
    WHERE id IN ('event-air-space-cyber-conference-2026', 'event-ausa-annual-meeting-2026', 'event-eighth-annual-defense-conference-2026', 'event-i-itsec-2026')`,
  `INSERT OR IGNORE INTO dbi_workspace_event_category_assignments (workspace_id, event_id, category_id, created_at)
    SELECT workspace_id, id, 'summit', '2026-09-15T18:00:00.000Z' FROM dbi_workspace_events
    WHERE id = 'event-weapon-systems-software-summit-2026'`,
  `CREATE TABLE IF NOT EXISTS dbi_workspace_activity (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    actor_type TEXT NOT NULL,
    actor_id TEXT NOT NULL,
    action TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL DEFAULT '',
    detail_json TEXT NOT NULL DEFAULT '{}',
    occurred_at TEXT NOT NULL
  )`,
  "CREATE INDEX IF NOT EXISTS idx_dbi_workspace_activity_workspace ON dbi_workspace_activity (workspace_id, occurred_at DESC)",
  ...D1_USER_ACTIVITY_SCHEMA,
  `CREATE TABLE IF NOT EXISTS dbi_workspace_manual_records (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT NOT NULL DEFAULT ''
  )`,
  `UPDATE dbi_workspaces SET owner_user_id = COALESCE((SELECT user_id FROM dbi_super_user WHERE singleton = 1), owner_user_id)
    WHERE workspace_id = 'workspace-defense-budget' AND owner_user_id = ''`,
  `INSERT OR IGNORE INTO dbi_workspace_memberships (workspace_id, user_id, role, created_by, created_at, updated_at)
    SELECT 'workspace-defense-budget', user_id, role, COALESCE(NULLIF(created_by, ''), user_id), created_at, updated_at
    FROM dbi_users
    WHERE NOT EXISTS (SELECT 1 FROM dbi_schema_migrations WHERE name = '2026-09-14-multi-workspace-v1')`,
  `INSERT OR IGNORE INTO dbi_session_workspaces (session_id, workspace_id, updated_at)
    SELECT id, 'workspace-defense-budget', '2026-09-14T20:20:00.000Z' FROM dbi_sessions
    WHERE NOT EXISTS (SELECT 1 FROM dbi_schema_migrations WHERE name = '2026-09-14-multi-workspace-v1')`,
  `INSERT OR IGNORE INTO dbi_workspace_agent_keys
    (id, workspace_id, name, token_hash, scopes_json, created_by, created_at, last_used_at, expires_at, revoked_at)
    SELECT id, 'workspace-defense-budget', name, token_hash, scopes_json, created_by, created_at, last_used_at, expires_at, revoked_at
    FROM dbi_agent_keys
    WHERE NOT EXISTS (SELECT 1 FROM dbi_schema_migrations WHERE name = '2026-09-14-multi-workspace-v1')`,
  `INSERT OR IGNORE INTO dbi_workspace_watchlist
    (workspace_id, record_id, note, review_at, wallboard, version, created_at, updated_at)
    SELECT 'workspace-defense-budget', record_id, note, review_at, wallboard, version, created_at, updated_at
    FROM dbi_watchlist
    WHERE NOT EXISTS (SELECT 1 FROM dbi_schema_migrations WHERE name = '2026-09-14-multi-workspace-v1')`,
  `INSERT OR IGNORE INTO dbi_workspace_events
    (id, workspace_id, title, starts_at, ends_at, location, notes, status, record_ids_json, wallboard, version, created_at, updated_at)
    SELECT id, 'workspace-defense-budget', title, starts_at, ends_at, location, notes, status, record_ids_json, wallboard, version, created_at, updated_at
    FROM dbi_management_events
    WHERE NOT EXISTS (SELECT 1 FROM dbi_schema_migrations WHERE name = '2026-09-14-multi-workspace-v1')`,
  `INSERT OR IGNORE INTO dbi_workspace_event_attendees (workspace_id, event_id, user_id, created_at)
    SELECT 'workspace-defense-budget', event_id, user_id, created_at FROM dbi_event_user_attendees
    WHERE NOT EXISTS (SELECT 1 FROM dbi_schema_migrations WHERE name = '2026-09-14-multi-workspace-v1')`,
  `INSERT OR IGNORE INTO dbi_workspace_activity
    (id, workspace_id, actor_type, actor_id, action, entity_type, entity_id, detail_json, occurred_at)
    SELECT id, 'workspace-defense-budget', actor_type, actor_id, action, entity_type, entity_id, detail_json, occurred_at
    FROM dbi_operator_activity
    WHERE NOT EXISTS (SELECT 1 FROM dbi_schema_migrations WHERE name = '2026-09-14-multi-workspace-v1')`,
  `INSERT OR IGNORE INTO dbi_workspace_manual_records
    (id, workspace_id, payload_json, version, created_at, updated_at, deleted_at)
    SELECT id, 'workspace-defense-budget', payload_json, version, created_at, updated_at, deleted_at
    FROM dbi_manual_records
    WHERE NOT EXISTS (SELECT 1 FROM dbi_schema_migrations WHERE name = '2026-09-14-multi-workspace-v1')`,
  `INSERT OR IGNORE INTO dbi_workspace_event_category_assignments (workspace_id, event_id, category_id, created_at)
    SELECT workspace_id, id, 'conference', '2026-09-15T18:00:00.000Z' FROM dbi_workspace_events
    WHERE id IN ('event-air-space-cyber-conference-2026', 'event-ausa-annual-meeting-2026', 'event-eighth-annual-defense-conference-2026', 'event-i-itsec-2026')`,
  `INSERT OR IGNORE INTO dbi_workspace_event_category_assignments (workspace_id, event_id, category_id, created_at)
    SELECT workspace_id, id, 'summit', '2026-09-15T18:00:00.000Z' FROM dbi_workspace_events
    WHERE id = 'event-weapon-systems-software-summit-2026'`,
  `INSERT OR IGNORE INTO dbi_schema_migrations (name, applied_at)
    VALUES ('2026-09-14-multi-workspace-v1', '2026-09-14T20:20:00.000Z')`,
]);
const schemaInitialization = new WeakMap();
function databaseFromEnv(env = {}) {
  return env.DBI_DB?.prepare ? env.DBI_DB : null;
}
async function ensureSchema(db) {
  let initialization = schemaInitialization.get(db);
  if (!initialization) {
    initialization = (async () => {
      for (const statement of SCHEMA) await db.prepare(statement).run();
    })().catch((error) => {
      schemaInitialization.delete(db);
      throw error;
    });
    schemaInitialization.set(db, initialization);
  }
  await initialization;
}

async function runD1RetentionMaintenance(db, now = new Date()) {
  const task = "retention-v1";
  const state = await db.prepare("SELECT last_run_at FROM dbi_maintenance_state WHERE task = ?").bind(task).first();
  const lastRunAt = Date.parse(state?.last_run_at || "");
  if (Number.isFinite(lastRunAt) && now.getTime() - lastRunAt < RETENTION_MAINTENANCE_INTERVAL_MS) return false;
  const completedCutoff = new Date(now.getTime() - RETENTION_DAYS * 86_400_000).toISOString();
  const loginCutoff = new Date(now.getTime() - 86_400_000).toISOString();
  await db.batch([
    db.prepare("DELETE FROM dbi_api_request_log WHERE completed_at < ?").bind(completedCutoff),
    db.prepare("DELETE FROM dbi_event_ai_jobs WHERE completed_at <> '' AND completed_at < ?").bind(completedCutoff),
    db.prepare("DELETE FROM dbi_login_attempts WHERE attempted_at < ?").bind(loginCutoff),
    db.prepare("DELETE FROM dbi_user_activity WHERE occurred_at < ?").bind(completedCutoff),
    db.prepare(`INSERT INTO dbi_maintenance_state (task, last_run_at) VALUES (?, ?)
      ON CONFLICT(task) DO UPDATE SET last_run_at = excluded.last_run_at`).bind(task, now.toISOString()),
  ]);
  return true;
}

function json(payload, status = 200, headers = {}) {
  return Response.json({ authVersion: PAGES_AUTH_VERSION, ...payload }, {
    status,
    headers: { "cache-control": "no-store", ...headers },
  });
}

function bytesToHex(bytes) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function randomHex(byteLength = 32) {
  return bytesToHex(crypto.getRandomValues(new Uint8Array(byteLength)));
}

async function hashValue(value) {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(String(value || "")));
  return bytesToHex(new Uint8Array(digest));
}

function constantTimeEqual(left, right) {
  const a = String(left || "");
  const b = String(right || "");
  if (!a || a.length !== b.length) return false;
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) {
    difference |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return difference === 0;
}

function cookies(request) {
  return Object.fromEntries(String(request.headers.get("cookie") || "")
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const separator = part.indexOf("=");
      return separator < 0
        ? [part, ""]
        : [part.slice(0, separator), decodeURIComponent(part.slice(separator + 1))];
    }));
}

function sessionCookie(token, request, env, maxAge = SESSION_MAX_AGE_SECONDS) {
  const secure = env.DBI_FORCE_SECURE_COOKIES === "1" || new URL(request.url).protocol === "https:"
    ? "; Secure"
    : "";
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Priority=High; Max-Age=${maxAge}${secure}`;
}

async function safeJson(request, maxBytes = MAX_BODY_BYTES) {
  return readBoundedJson(request, maxBytes);
}

function publicUser(row) {
  const capabilities = accessCapabilities(row?.role, row?.membership_role, { isEmulating: Boolean(row?.is_emulating) });
  const roleId = capabilities.roleId;
  return row ? {
    id: row.user_id,
    email: row.email,
    displayName: row.display_name,
    title: row.title || "",
    avatarDataUrl: row.avatar_data_url || "",
    role: ROLE_LABELS[roleId] || "Viewer",
    roleId,
    status: row.status || "active",
    mustChangePassword: Boolean(row.must_change_password) && !row.is_emulating,
    canManagePlatform: capabilities.canManagePlatform,
    canManageAccounts: capabilities.canManageAccounts,
    canManageUsers: capabilities.canManageAccounts,
    canEmulateUsers: capabilities.canEmulateUsers,
    canManageWorkspace: capabilities.canManageWorkspace,
    canManageWorkspaces: capabilities.canManageWorkspace,
    canManageTeams: capabilities.canManageTeams,
    canManageAgents: capabilities.canManageAgents,
    canWriteWorkspace: capabilities.canWriteWorkspace,
    canRunEventAi: capabilities.canRunEventAi,
    createdAt: row.created_at,
    lastLoginAt: row.last_login_at || null,
    isEmulating: Boolean(row.is_emulating),
    actor: row.is_emulating ? {
      id: row.actor_user_id,
      displayName: row.actor_display_name || "Super user",
      email: row.actor_email || "",
      role: "Super user",
      roleId: "super_user",
    } : null,
  } : null;
}

function bytesToBase64(bytes) {
  let value = "";
  for (const byte of bytes) value += String.fromCharCode(byte);
  return btoa(value);
}

function base64ToBytes(value) {
  const binary = atob(String(value || ""));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function encryptOpenAiKey(value, env = {}) {
  const secret = String(env.DBI_CREDENTIAL_ENCRYPTION_KEY || "");
  if (secret.length < 32) return null;
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(secret));
  const key = await crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoder.encode(value));
  return { encryptedKey: bytesToBase64(new Uint8Array(encrypted)), keyIv: bytesToBase64(iv), keyVersion: 1 };
}

async function decryptOpenAiKey(row, env = {}) {
  const secret = String(env.DBI_CREDENTIAL_ENCRYPTION_KEY || "");
  if (!row || secret.length < 32 || Number(row.key_version || 0) !== 1) return "";
  try {
    const digest = await crypto.subtle.digest("SHA-256", encoder.encode(secret));
    const key = await crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, ["decrypt"]);
    const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv: base64ToBytes(row.key_iv) }, key, base64ToBytes(row.encrypted_key));
    return new TextDecoder().decode(decrypted);
  } catch {
    return "";
  }
}

function openAiKeyMetadata(row) {
  return {
    id: row.id,
    scope: row.scope_type,
    workspaceId: row.workspace_id || null,
    userId: row.user_id || null,
    label: row.label,
    lastFour: row.key_last_four,
    isDefault: Boolean(row.is_default),
    status: row.revoked_at ? "revoked" : "active",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastUsedAt: row.last_used_at || null,
  };
}

async function openAiKeyUsage(db, column, scopeId) {
  if (!scopeId || !["workspace_id", "user_id"].includes(column)) return new Map();
  const result = await db.prepare(`SELECT credential_id,
      COUNT(*) AS request_count,
      SUM(CASE WHEN status = 'succeeded' THEN 1 ELSE 0 END) AS success_count,
      SUM(CASE WHEN status IN ('failed', 'rejected', 'rate_limited', 'cancelled') THEN 1 ELSE 0 END) AS failure_count,
      SUM(input_tokens) AS input_tokens,
      SUM(output_tokens) AS output_tokens,
      CAST(AVG(CASE WHEN latency_ms > 0 THEN latency_ms END) AS INTEGER) AS average_latency_ms,
      MAX(completed_at) AS last_request_at
    FROM dbi_api_request_log
    WHERE ${column} = ? AND credential_id <> '' AND request_kind = 'openai'
    GROUP BY credential_id`).bind(scopeId).all();
  return new Map((result.results || []).map((row) => [row.credential_id, {
    requestCount: Number(row.request_count || 0),
    successCount: Number(row.success_count || 0),
    failureCount: Number(row.failure_count || 0),
    inputTokens: Number(row.input_tokens || 0),
    outputTokens: Number(row.output_tokens || 0),
    averageLatencyMs: Number(row.average_latency_ms || 0),
    lastRequestAt: row.last_request_at || null,
  }]));
}

function keyMetadataWithUsage(row, usageById) {
  return {
    ...openAiKeyMetadata(row),
    usage: usageById.get(row.id) || {
      requestCount: 0,
      successCount: 0,
      failureCount: 0,
      inputTokens: 0,
      outputTokens: 0,
      averageLatencyMs: 0,
      lastRequestAt: null,
    },
  };
}

async function workspacesForUser(db, userId) {
  const result = await db.prepare(`
    SELECT workspace.workspace_id, workspace.name, workspace.slug, workspace.description, membership.role,
      settings.icon_data_url, settings.header_eyebrow, settings.display_title, ai_preferences.auto_accept_event_augmentations
    FROM dbi_workspace_memberships membership
    JOIN dbi_workspaces workspace ON workspace.workspace_id = membership.workspace_id
    LEFT JOIN dbi_workspace_settings settings ON settings.workspace_id = workspace.workspace_id
    LEFT JOIN dbi_workspace_ai_preferences ai_preferences ON ai_preferences.workspace_id = workspace.workspace_id
    WHERE membership.user_id = ? AND workspace.status = 'active'
    ORDER BY workspace.name COLLATE NOCASE
  `).bind(userId).all();
  return (result.results || []).map((workspace) => ({
    id: workspace.workspace_id,
    name: workspace.name,
    slug: workspace.slug,
    description: workspace.description || "",
    iconDataUrl: workspace.icon_data_url || "",
    headerEyebrow: workspace.header_eyebrow || DEFAULT_HEADER_EYEBROW,
    displayTitle: workspace.display_title || DEFAULT_DISPLAY_TITLE,
    autoAcceptAiAugmentations: Boolean(workspace.auto_accept_event_augmentations),
    roleId: workspace.role,
    role: ROLE_LABELS[workspace.role] || "Viewer",
  }));
}

async function publicSessionUser(db, row) {
  if (!row) return null;
  const workspaces = await workspacesForUser(db, row.user_id);
  const activeWorkspace = workspaces.find((workspace) => workspace.id === row.active_workspace_id) || null;
  const profile = row.avatar_data_url === undefined
    ? await db.prepare("SELECT avatar_data_url FROM dbi_user_profiles WHERE user_id = ?").bind(row.user_id).first()
    : null;
  const hydrated = {
    ...row,
    membership_role: activeWorkspace?.roleId || row.membership_role,
    avatar_data_url: row.avatar_data_url ?? profile?.avatar_data_url ?? "",
  };
  return { ...publicUser(hydrated), workspaces, activeWorkspace, hasWorkspaceAccess: Boolean(activeWorkspace) };
}

async function superUser(db) {
  return db.prepare("SELECT * FROM dbi_super_user WHERE singleton = 1").first();
}

async function userByEmail(db, email) {
  return db.prepare("SELECT * FROM dbi_users WHERE email = ?").bind(email).first();
}

function canAdministerUsers(user) {
  return Boolean(user && !user.is_emulating && user.role === "super_user");
}

function canAdministerWorkspaces(user) {
  return Boolean(user && (user.role === "super_user" || user.membership_role === "administrator"));
}

async function canAdministerWorkspace(db, user, workspaceId) {
  if (user?.role === "super_user") return true;
  if (!user || String(user.active_workspace_id || "") !== String(workspaceId || "")) return false;
  const membership = await db.prepare("SELECT role FROM dbi_workspace_memberships WHERE workspace_id = ? AND user_id = ?")
    .bind(workspaceId, user.user_id).first();
  return membership?.role === "administrator";
}

function scopesForRole(role) {
  if (["super_user", "administrator", "analyst"].includes(role)) return [...AGENT_SCOPES];
  return [...READ_SCOPES];
}

async function sessionUser(db, request) {
  const rawToken = cookies(request)[SESSION_COOKIE] || "";
  if (!rawToken) return null;
  const row = await db.prepare(`
    SELECT COALESCE(target.user_id, actor.user_id) AS user_id,
      COALESCE(target.email, actor.email) AS email,
      COALESCE(target.display_name, actor.display_name) AS display_name,
      COALESCE(target.title, actor.title) AS title,
      COALESCE(target.role, actor.role) AS role,
      COALESCE(target.status, actor.status) AS status,
      COALESCE(target.password_salt, actor.password_salt) AS password_salt,
      COALESCE(target.password_hash, actor.password_hash) AS password_hash,
      COALESCE(target.must_change_password, actor.must_change_password) AS must_change_password,
      COALESCE(target.created_by, actor.created_by) AS created_by,
      COALESCE(target.created_at, actor.created_at) AS created_at,
      COALESCE(target.updated_at, actor.updated_at) AS updated_at,
      COALESCE(target.last_login_at, actor.last_login_at) AS last_login_at,
      profile.avatar_data_url, s.id AS session_id,
      membership.workspace_id AS active_workspace_id,
      membership.role AS membership_role,
      workspace.name AS active_workspace_name,
      workspace.slug AS active_workspace_slug,
      actor.user_id AS actor_user_id,
      actor.email AS actor_email,
      actor.display_name AS actor_display_name,
      actor.role AS actor_role,
      CASE WHEN target.user_id IS NOT NULL THEN 1 ELSE 0 END AS is_emulating
    FROM dbi_sessions s
    JOIN dbi_users actor ON actor.user_id = s.user_id
    LEFT JOIN dbi_session_emulations emulation ON emulation.session_id = s.id
    LEFT JOIN dbi_users target ON target.user_id = emulation.target_user_id AND target.status = 'active'
    LEFT JOIN dbi_user_profiles profile ON profile.user_id = COALESCE(target.user_id, actor.user_id)
    LEFT JOIN dbi_session_workspaces session_workspace ON session_workspace.session_id = s.id
    LEFT JOIN dbi_workspace_memberships membership
      ON membership.workspace_id = session_workspace.workspace_id AND membership.user_id = COALESCE(target.user_id, actor.user_id)
    LEFT JOIN dbi_workspaces workspace
      ON workspace.workspace_id = membership.workspace_id AND workspace.status = 'active'
    WHERE s.token_hash = ? AND s.revoked_at = '' AND s.expires_at > ? AND actor.status = 'active'
  `).bind(await hashValue(rawToken), new Date().toISOString()).first();
  if (!row) return null;
  await db.prepare("UPDATE dbi_sessions SET last_seen_at = ? WHERE id = ?")
    .bind(new Date().toISOString(), row.session_id)
    .run();
  return row;
}

async function createSession(db, userId, preferredWorkspaceId = "") {
  const rawToken = randomHex(32);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_MAX_AGE_SECONDS * 1000).toISOString();
  await db.batch([
    db.prepare(`DELETE FROM dbi_session_workspaces WHERE session_id IN
      (SELECT id FROM dbi_sessions WHERE expires_at <= ? OR revoked_at <> '')`).bind(now.toISOString()),
    db.prepare("DELETE FROM dbi_sessions WHERE expires_at <= ? OR revoked_at <> ''").bind(now.toISOString()),
  ]);
  const preferred = preferredWorkspaceId ? await db.prepare(`
    SELECT membership.workspace_id FROM dbi_workspace_memberships membership
    JOIN dbi_workspaces workspace ON workspace.workspace_id = membership.workspace_id
    WHERE membership.user_id = ? AND membership.workspace_id = ? AND workspace.status = 'active'
  `).bind(userId, preferredWorkspaceId).first() : null;
  const fallback = preferred || await db.prepare(`
    SELECT membership.workspace_id FROM dbi_workspace_memberships membership
    JOIN dbi_workspaces workspace ON workspace.workspace_id = membership.workspace_id
    WHERE membership.user_id = ? AND workspace.status = 'active'
    ORDER BY CASE membership.role WHEN 'super_user' THEN 0 WHEN 'administrator' THEN 1 WHEN 'analyst' THEN 2 ELSE 3 END,
      workspace.name COLLATE NOCASE LIMIT 1
  `).bind(userId).first();
  const sessionId = crypto.randomUUID();
  await db.prepare(`
    INSERT INTO dbi_sessions
      (id, user_id, token_hash, expires_at, revoked_at, created_at, last_seen_at)
    VALUES (?, ?, ?, ?, '', ?, ?)
  `).bind(
    sessionId,
    userId,
    await hashValue(rawToken),
    expiresAt,
    now.toISOString(),
    now.toISOString(),
  ).run();
  if (fallback?.workspace_id) await db.prepare(`
    INSERT OR REPLACE INTO dbi_session_workspaces (session_id, workspace_id, updated_at) VALUES (?, ?, ?)
  `).bind(sessionId, fallback.workspace_id, now.toISOString()).run();
  return { rawToken, expiresAt, sessionId, workspaceId: fallback?.workspace_id || "" };
}

async function clientHash(request, email) {
  const ip = request.headers.get("cf-connecting-ip")
    || request.headers.get("x-forwarded-for")
    || "local";
  return hashValue(`${email}|${ip}|${cleanText(request.headers.get("user-agent"), 240)}`);
}

async function loginBlocked(db, client) {
  const since = new Date(Date.now() - ATTEMPT_WINDOW_MS).toISOString();
  const row = await db.prepare(`
    SELECT COUNT(*) AS count
    FROM dbi_login_attempts
    WHERE client_hash = ? AND succeeded = 0 AND attempted_at >= ?
  `).bind(client, since).first();
  return Number(row?.count || 0) >= MAX_ATTEMPTS;
}

async function recordLoginAttempt(db, client, succeeded) {
  const now = new Date();
  await db.prepare(`
    INSERT INTO dbi_login_attempts (id, client_hash, succeeded, attempted_at)
    VALUES (?, ?, ?, ?)
  `).bind(crypto.randomUUID(), client, succeeded ? 1 : 0, now.toISOString()).run();
}

async function statusResponse(request, db, env) {
  if (request.method !== "GET") return json({ error: "Method not allowed" }, 405);
  await runD1RetentionMaintenance(db).catch((error) => {
    console.error("D1 retention maintenance failed", safeLogText(error?.message, 240));
  });
  const [owner, session] = await Promise.all([superUser(db), sessionUser(db, request)]);
  return json({
    enabled: true,
    required: env.DBI_AUTH_REQUIRED !== "0",
    claimed: Boolean(owner),
    ...await d1PublicRegistrationStatus(db, owner),
    user: await publicSessionUser(db, session),
  });
}

async function claimResponse(request, db, env) {
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (await superUser(db)) return json({ error: "The super-user account has already been claimed" }, 409);
  if (env.DBI_ALLOW_FIRST_CLAIM !== "1") return json({ error: "Initial account claim is unavailable" }, 403);
  if (!sameOriginRequest(request)) return json({ error: "Cross-origin account claim is not allowed" }, 403);

  const body = await safeJson(request);
  const email = normalizeEmail(body?.email);
  const displayName = cleanText(body?.displayName, 80);
  const title = cleanText(body?.title, 80);
  const passwordSalt = cleanText(body?.passwordSalt, 128).toLowerCase();
  const passwordProof = cleanText(body?.passwordProof, 64).toLowerCase();
  if (!email || displayName.length < 2 || !validSalt(passwordSalt) || !validPasswordProof(passwordProof)) {
    return json({ error: "Valid account details are required" }, 400);
  }

  const userId = crypto.randomUUID();
  const now = new Date().toISOString();
  const claimed = await db.prepare(`
    INSERT OR IGNORE INTO dbi_super_user
      (singleton, user_id, email, display_name, title, password_salt, password_hash, created_at, updated_at)
    VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    userId,
    email,
    displayName,
    title,
    passwordSalt,
    `v1$${await hashValue(passwordProof)}`,
    now,
    now,
  ).run();
  if (!Number(claimed?.meta?.changes || 0)) {
    return json({ error: "The super-user account has already been claimed" }, 409);
  }

  await db.prepare(`
    INSERT INTO dbi_users
      (user_id, email, display_name, title, role, status, password_salt, password_hash, must_change_password, created_by, created_at, updated_at, last_login_at)
    VALUES (?, ?, ?, ?, 'super_user', 'active', ?, ?, 0, ?, ?, ?, '')
  `).bind(userId, email, displayName, title, passwordSalt, `v1$${await hashValue(passwordProof)}`, userId, now, now).run();

  await db.batch([
    db.prepare("UPDATE dbi_workspaces SET owner_user_id = ?, updated_at = ? WHERE workspace_id = ?")
      .bind(userId, now, DEFAULT_WORKSPACE_ID),
    db.prepare(`INSERT OR REPLACE INTO dbi_workspace_memberships
      (workspace_id, user_id, role, created_by, created_at, updated_at) VALUES (?, ?, 'super_user', ?, ?, ?)`)
      .bind(DEFAULT_WORKSPACE_ID, userId, userId, now, now),
  ]);

  const session = await createSession(db, userId, DEFAULT_WORKSPACE_ID);
  const claimedUser = {
    user_id: userId,
    email,
    display_name: displayName,
    title,
    role: "super_user",
    status: "active",
    must_change_password: 0,
    created_at: now,
    active_workspace_id: DEFAULT_WORKSPACE_ID,
    membership_role: "super_user",
  };
  return json({ user: await publicSessionUser(db, claimedUser) }, 201, { "set-cookie": sessionCookie(session.rawToken, request, env) });
}

async function loginConfigResponse(request, db) {
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (!sameOriginRequest(request)) return json({ error: "Cross-origin login is not allowed" }, 403);
  const body = await safeJson(request);
  const email = normalizeEmail(body?.email);
  const user = email ? await userByEmail(db, email) : null;
  const matches = Boolean(user && user.status === "active");
  const fallbackSalt = (await hashValue(`dbi-login:${email || "unknown"}`)).slice(0, 48);
  return json({
    passwordSalt: matches ? user.password_salt : fallbackSalt,
    passwordIterations: PASSWORD_ITERATIONS,
  });
}

async function loginResponse(request, db, env) {
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (!sameOriginRequest(request)) return json({ error: "Cross-origin login is not allowed" }, 403);
  const body = await safeJson(request);
  const email = normalizeEmail(body?.email);
  const passwordProof = cleanText(body?.passwordProof, 64).toLowerCase();
  const client = await clientHash(request, email);
  if (await loginBlocked(db, client)) {
    return json({ error: "Too many sign-in attempts. Try again in 15 minutes." }, 429);
  }

  const user = email ? await userByEmail(db, email) : null;
  const storedHash = String(user?.password_hash || "");
  const verified = Boolean(
    user
    && user.status === "active"
    && validPasswordProof(passwordProof)
    && storedHash.startsWith("v1$")
    && constantTimeEqual(await hashValue(passwordProof), storedHash.slice(3)),
  );
  await recordLoginAttempt(db, client, verified);
  if (!verified) return json({ error: "Email or password is incorrect" }, 401);

  const now = new Date().toISOString();
  await db.prepare("UPDATE dbi_users SET last_login_at = ?, updated_at = updated_at WHERE user_id = ?").bind(now, user.user_id).run();
  const session = await createSession(db, user.user_id);
  return json({ user: await publicSessionUser(db, { ...user, last_login_at: now, active_workspace_id: session.workspaceId }), expiresAt: session.expiresAt }, 200, {
    "set-cookie": sessionCookie(session.rawToken, request, env),
  });
}

async function logoutResponse(request, db, env) {
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (!sameOriginRequest(request)) return json({ error: "Cross-origin logout is not allowed" }, 403);
  const rawToken = cookies(request)[SESSION_COOKIE] || "";
  if (rawToken) {
    await db.prepare("UPDATE dbi_sessions SET revoked_at = ? WHERE token_hash = ? AND revoked_at = ''")
      .bind(new Date().toISOString(), await hashValue(rawToken))
      .run();
  }
  return json({ ok: true }, 200, { "set-cookie": sessionCookie("", request, env, 0) });
}

async function profileResponse(request, db) {
  if (request.method !== "PATCH") return json({ error: "Method not allowed" }, 405);
  if (!sameOriginRequest(request)) return json({ error: "Cross-origin profile changes are not allowed" }, 403);
  const session = await sessionUser(db, request);
  if (!session) return json({ error: "Sign in required" }, 401);
  if (session.is_emulating) return json({ error: "Exit user emulation before changing profile identity" }, 403);
  const body = await safeJson(request, 16_384);
  const displayName = cleanText(body?.displayName, 80);
  const title = cleanText(body?.title, 80);
  const avatarDataUrl = validAvatarDataUrl(body?.avatarDataUrl);
  if (displayName.length < 2) return json({ error: "Display name is required" }, 400);
  if (avatarDataUrl === null) return json({ error: "Profile picture must be a small PNG, JPEG, or WebP image" }, 400);
  const now = new Date().toISOString();
  const statements = [db.prepare(`
    UPDATE dbi_users SET display_name = ?, title = ?, updated_at = ? WHERE user_id = ?
  `).bind(displayName, title, now, session.user_id), db.prepare(`
    INSERT INTO dbi_user_profiles (user_id, avatar_data_url, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET avatar_data_url = excluded.avatar_data_url, updated_at = excluded.updated_at
  `).bind(session.user_id, avatarDataUrl, now)];
  if (session.role === "super_user") statements.push(db.prepare(`
    UPDATE dbi_super_user SET display_name = ?, title = ?, updated_at = ? WHERE user_id = ?
  `).bind(displayName, title, now, session.user_id));
  await db.batch(statements);
  return json({ user: await publicSessionUser(db, { ...session, display_name: displayName, title, avatar_data_url: avatarDataUrl }) });
}

async function passwordResponse(request, db, env) {
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (!sameOriginRequest(request)) return json({ error: "Cross-origin password changes are not allowed" }, 403);
  const session = await sessionUser(db, request);
  if (!session) return json({ error: "Sign in required" }, 401);
  if (session.is_emulating) return json({ error: "Exit user emulation before changing a password" }, 403);
  const body = await safeJson(request);
  const currentPasswordProof = cleanText(body?.currentPasswordProof, 64).toLowerCase();
  const newPasswordProof = cleanText(body?.newPasswordProof, 64).toLowerCase();
  const newPasswordSalt = cleanText(body?.newPasswordSalt, 128).toLowerCase();
  const storedHash = String(session.password_hash || "");
  if (!validPasswordProof(currentPasswordProof)
    || !storedHash.startsWith("v1$")
    || !constantTimeEqual(await hashValue(currentPasswordProof), storedHash.slice(3))) {
    return json({ error: "Current password is incorrect" }, 403);
  }
  if (!validPasswordProof(newPasswordProof) || !validSalt(newPasswordSalt)) {
    return json({ error: "New password is invalid" }, 400);
  }

  const now = new Date().toISOString();
  const passwordHash = `v1$${await hashValue(newPasswordProof)}`;
  const statements = [
    db.prepare(`
      UPDATE dbi_users
      SET password_salt = ?, password_hash = ?, must_change_password = 0, updated_at = ?
      WHERE user_id = ?
    `).bind(newPasswordSalt, passwordHash, now, session.user_id),
    db.prepare("UPDATE dbi_sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at = ''").bind(now, session.user_id),
  ];
  if (session.role === "super_user") statements.push(db.prepare(`
    UPDATE dbi_super_user SET password_salt = ?, password_hash = ?, updated_at = ? WHERE user_id = ?
  `).bind(newPasswordSalt, passwordHash, now, session.user_id));
  await db.batch(statements);
  const nextSession = await createSession(db, session.user_id);
  return json({ ok: true, user: await publicSessionUser(db, { ...session, must_change_password: 0, active_workspace_id: nextSession.workspaceId || session.active_workspace_id }) }, 200, {
    "set-cookie": sessionCookie(nextSession.rawToken, request, env),
  });
}

function managedUser(row) {
  return {
    ...publicUser(row),
    activeSessions: Number(row.active_sessions || 0),
    isOwner: row.role === "super_user",
    workspaceRoleId: row.role === "super_user" ? "super_user" : row.membership_role || null,
    hasWorkspaceMembership: row.role === "super_user" || Boolean(row.membership_role),
  };
}

async function usersResponse(request, db) {
  if (!sameOriginRequest(request)) return json({ error: "Cross-origin user management is not allowed" }, 403);
  const administrator = await sessionUser(db, request);
  if (!administrator) return json({ error: "Sign in required" }, 401);
  if (!canAdministerUsers(administrator)) return json({ error: "Super user access is required" }, 403);
  const workspaceId = administrator.active_workspace_id;
  if (!workspaceId) return json({ error: "Select a workspace before managing users" }, 409);

  const pathname = new URL(request.url).pathname.replace(/\/+$/, "");
  const prefix = "/api/v1/auth/users";
  const relative = pathname.slice(prefix.length).replace(/^\//, "");
  const [encodedUserId = "", action = ""] = relative.split("/");
  const userId = cleanText(decodeURIComponent(encodedUserId), 80);

  if (request.method === "GET" && !userId) {
    const now = new Date().toISOString();
    const result = await db.prepare(`
      SELECT u.*, membership.role AS membership_role, profile.avatar_data_url, COUNT(s.id) AS active_sessions
      FROM dbi_users u
      LEFT JOIN dbi_workspace_memberships membership ON membership.user_id = u.user_id AND membership.workspace_id = ?
      LEFT JOIN dbi_user_profiles profile ON profile.user_id = u.user_id
      LEFT JOIN dbi_sessions s
        ON s.user_id = u.user_id AND s.revoked_at = '' AND s.expires_at > ?
      GROUP BY u.user_id
      ORDER BY CASE WHEN u.role = 'super_user' THEN 0 WHEN membership.role = 'administrator' THEN 1 WHEN membership.role = 'analyst' THEN 2 WHEN membership.role = 'viewer' THEN 3 ELSE 4 END,
        u.display_name COLLATE NOCASE
    `).bind(workspaceId, now).all();
    return json({ users: (result.results || []).map(managedUser), availableRoles: USER_ROLES });
  }

  if (request.method === "POST" && !userId) {
    const body = await safeJson(request);
    const email = normalizeEmail(body?.email);
    const displayName = cleanText(body?.displayName, 80);
    const title = cleanText(body?.title, 80);
    const role = cleanText(body?.role, 32);
    const passwordSalt = cleanText(body?.passwordSalt, 128).toLowerCase();
    const passwordProof = cleanText(body?.passwordProof, 64).toLowerCase();
    if (!email || displayName.length < 2 || !USER_ROLES.includes(role) || !validSalt(passwordSalt) || !validPasswordProof(passwordProof)) {
      return json({ error: "Valid user details, role, and temporary password are required" }, 400);
    }
    const count = await db.prepare("SELECT COUNT(*) AS count FROM dbi_workspace_memberships WHERE workspace_id = ?").bind(workspaceId).first();
    if (Number(count?.count || 0) >= 50) return json({ error: "This workspace is limited to 50 human accounts" }, 409);
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const created = await db.prepare(`
      INSERT OR IGNORE INTO dbi_users
        (user_id, email, display_name, title, role, status, password_salt, password_hash, must_change_password, created_by, created_at, updated_at, last_login_at)
      VALUES (?, ?, ?, ?, ?, 'active', ?, ?, 1, ?, ?, ?, '')
    `).bind(id, email, displayName, title, "viewer", passwordSalt, `v1$${await hashValue(passwordProof)}`, administrator.user_id, now, now).run();
    if (!Number(created?.meta?.changes || 0)) return json({ error: "An account with that email already exists" }, 409);
    await db.prepare(`INSERT INTO dbi_workspace_memberships
      (workspace_id, user_id, role, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`)
      .bind(workspaceId, id, role, administrator.user_id, now, now).run();
    await recordActivity(db, { type: "user", id: administrator.user_id, workspaceId }, "user_created", "user", id, { email, role });
    const row = await db.prepare("SELECT *, ? AS membership_role FROM dbi_users WHERE user_id = ?").bind(role, id).first();
    return json({ user: managedUser(row) }, 201);
  }

  const target = userId ? await db.prepare(`
    SELECT user.*, membership.role AS membership_role, profile.avatar_data_url
    FROM dbi_users user
    LEFT JOIN dbi_workspace_memberships membership ON membership.user_id = user.user_id AND membership.workspace_id = ?
    LEFT JOIN dbi_user_profiles profile ON profile.user_id = user.user_id
    WHERE user.user_id = ?
  `).bind(workspaceId, userId).first() : null;
  if (!target) return json({ error: "User not found" }, 404);
  if (target.role === "super_user") return json({ error: "The Super user account is immutable in user management" }, 403);

  if (request.method === "PATCH" && !action) {
    const body = await safeJson(request);
    const email = normalizeEmail(body?.email);
    const displayName = cleanText(body?.displayName, 80);
    const title = cleanText(body?.title, 80);
    const status = cleanText(body?.status, 32);
    if (!email || displayName.length < 2 || !USER_STATUSES.includes(status)) {
      return json({ error: "Valid account details and status are required" }, 400);
    }
    const now = new Date().toISOString();
    const changed = await db.prepare(`
      UPDATE OR IGNORE dbi_users
      SET email = ?, display_name = ?, title = ?, status = ?, updated_at = ?
      WHERE user_id = ?
    `).bind(email, displayName, title, status, now, userId).run();
    if (!Number(changed?.meta?.changes || 0)) {
      const duplicate = await userByEmail(db, email);
      if (duplicate && duplicate.user_id !== userId) return json({ error: "An account with that email already exists" }, 409);
    }
    if (status === "suspended") {
      await db.prepare("UPDATE dbi_sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at = ''").bind(now, userId).run();
    }
    await recordActivity(db, { type: "user", id: administrator.user_id, workspaceId }, "user_updated", "user", userId, { email, status });
    const row = await db.prepare("SELECT *, ? AS membership_role FROM dbi_users WHERE user_id = ?").bind(target.membership_role, userId).first();
    return json({ user: managedUser(row) });
  }

  if (request.method === "POST" && action === "password") {
    const body = await safeJson(request);
    const passwordSalt = cleanText(body?.passwordSalt, 128).toLowerCase();
    const passwordProof = cleanText(body?.passwordProof, 64).toLowerCase();
    if (!validSalt(passwordSalt) || !validPasswordProof(passwordProof)) return json({ error: "A valid temporary password is required" }, 400);
    const now = new Date().toISOString();
    await db.batch([
      db.prepare(`
        UPDATE dbi_users SET password_salt = ?, password_hash = ?, must_change_password = 1, updated_at = ? WHERE user_id = ?
      `).bind(passwordSalt, `v1$${await hashValue(passwordProof)}`, now, userId),
      db.prepare("UPDATE dbi_sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at = ''").bind(now, userId),
    ]);
    await recordActivity(db, { type: "user", id: administrator.user_id, workspaceId }, "user_password_reset", "user", userId, { email: target.email });
    return json({ ok: true });
  }

  return json({ error: "Method not allowed" }, 405);
}

function workspaceSummary(row, membership = null, request = null) {
  return {
    id: row.workspace_id,
    name: row.name,
    slug: row.slug,
    description: row.description || "",
    iconDataUrl: row.icon_data_url || "",
    headerEyebrow: row.header_eyebrow || DEFAULT_HEADER_EYEBROW,
    displayTitle: row.display_title || DEFAULT_DISPLAY_TITLE,
    autoAcceptAiAugmentations: Boolean(row.auto_accept_event_augmentations),
    status: row.status,
    ownerUserId: row.owner_user_id || "",
    roleId: membership?.role || null,
    role: membership?.role ? ROLE_LABELS[membership.role] || "Viewer" : null,
    requestStatus: request?.status || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function workspacesResponse(request, db) {
  if (!sameOriginRequest(request)) return json({ error: "Cross-origin workspace access is not allowed" }, 403);
  const user = await sessionUser(db, request);
  if (!user) return json({ error: "Sign in required" }, 401);
  const pathname = new URL(request.url).pathname.replace(/\/+$/, "");
  const relative = pathname.slice("/api/v1/auth/workspaces".length).replace(/^\//, "");
  const [encodedWorkspaceId = "", action = ""] = relative.split("/");
  const workspaceId = cleanText(decodeURIComponent(encodedWorkspaceId), 80);

  if (request.method === "GET" && !workspaceId) {
    const [workspaceResult, membershipResult, requestResult] = await Promise.all([
      db.prepare(`SELECT workspace.*, settings.icon_data_url, settings.header_eyebrow, settings.display_title,
          ai_preferences.auto_accept_event_augmentations
        FROM dbi_workspaces workspace LEFT JOIN dbi_workspace_settings settings ON settings.workspace_id = workspace.workspace_id
        LEFT JOIN dbi_workspace_ai_preferences ai_preferences ON ai_preferences.workspace_id = workspace.workspace_id
        WHERE workspace.status = 'active' ORDER BY workspace.name COLLATE NOCASE`).all(),
      db.prepare("SELECT workspace_id, role FROM dbi_workspace_memberships WHERE user_id = ?").bind(user.user_id).all(),
      db.prepare("SELECT workspace_id, status FROM dbi_workspace_access_requests WHERE user_id = ? ORDER BY created_at DESC").bind(user.user_id).all(),
    ]);
    const memberships = new Map((membershipResult.results || []).map((entry) => [entry.workspace_id, entry]));
    const requests = new Map();
    for (const entry of requestResult.results || []) if (!requests.has(entry.workspace_id)) requests.set(entry.workspace_id, entry);
    return json({
      workspaces: (workspaceResult.results || []).map((workspace) => workspaceSummary(workspace, memberships.get(workspace.workspace_id), requests.get(workspace.workspace_id))),
      activeWorkspaceId: user.active_workspace_id || null,
    });
  }

  const workspace = workspaceId ? await db.prepare("SELECT * FROM dbi_workspaces WHERE workspace_id = ? AND status = 'active'").bind(workspaceId).first() : null;
  if (!workspace) return json({ error: "Workspace not found" }, 404);

  if (request.method === "POST" && action === "request") {
    const existingMembership = await db.prepare("SELECT 1 AS found FROM dbi_workspace_memberships WHERE workspace_id = ? AND user_id = ?")
      .bind(workspaceId, user.user_id).first();
    if (existingMembership) return json({ error: "You already have access to this workspace" }, 409);
    const pending = await db.prepare("SELECT request_id FROM dbi_workspace_access_requests WHERE workspace_id = ? AND user_id = ? AND status = 'pending'")
      .bind(workspaceId, user.user_id).first();
    if (pending) return json({ error: "An access request is already pending" }, 409);
    const body = await safeJson(request);
    const now = new Date().toISOString();
    const requestId = crypto.randomUUID();
    await db.prepare(`INSERT INTO dbi_workspace_access_requests
      (request_id, workspace_id, user_id, note, status, resolved_by, resolved_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'pending', '', '', ?, ?)`)
      .bind(requestId, workspaceId, user.user_id, cleanText(body?.note, 500), now, now).run();
    return json({ request: { id: requestId, workspaceId, status: "pending", createdAt: now } }, 201);
  }

  if (request.method === "POST" && action === "switch") {
    const membership = await db.prepare("SELECT role FROM dbi_workspace_memberships WHERE workspace_id = ? AND user_id = ?")
      .bind(workspaceId, user.user_id).first();
    if (!membership) return json({ error: "Workspace access is required" }, 403);
    const now = new Date().toISOString();
    await db.prepare(`INSERT INTO dbi_session_workspaces (session_id, workspace_id, updated_at) VALUES (?, ?, ?)
      ON CONFLICT(session_id) DO UPDATE SET workspace_id = excluded.workspace_id, updated_at = excluded.updated_at`)
      .bind(user.session_id, workspaceId, now).run();
    return json({ user: await publicSessionUser(db, { ...user, active_workspace_id: workspaceId, membership_role: membership.role }) });
  }

  return json({ error: "Method not allowed" }, 405);
}

async function workspaceAdminResponse(request, db) {
  if (!sameOriginRequest(request)) return json({ error: "Cross-origin workspace administration is not allowed" }, 403);
  const owner = await sessionUser(db, request);
  if (!owner) return json({ error: "Sign in required" }, 401);
  if (!canAdministerWorkspaces(owner)) return json({ error: "Workspace manager access is required" }, 403);
  const isSuperUser = owner.role === "super_user";
  const pathname = new URL(request.url).pathname.replace(/\/+$/, "");
  const relative = pathname.slice("/api/v1/auth/workspace-admin".length).replace(/^\//, "");
  const segments = relative.split("/").filter(Boolean).map((value) => cleanText(decodeURIComponent(value), 80));

  if (request.method === "GET" && !segments.length) {
    const [workspaceResult, membershipResult, requestResult, userResult] = await Promise.all([
      db.prepare(`SELECT workspace.*, settings.icon_data_url, settings.header_eyebrow, settings.display_title,
        ai_preferences.auto_accept_event_augmentations,
        (SELECT COUNT(*) FROM dbi_workspace_memberships membership WHERE membership.workspace_id = workspace.workspace_id) AS member_count,
        (SELECT COUNT(*) FROM dbi_workspace_access_requests access_request WHERE access_request.workspace_id = workspace.workspace_id AND access_request.status = 'pending') AS pending_request_count,
        (SELECT COUNT(*) FROM dbi_workspace_watchlist tracked WHERE tracked.workspace_id = workspace.workspace_id) AS tracked_record_count,
        (SELECT COUNT(*) FROM dbi_workspace_events event WHERE event.workspace_id = workspace.workspace_id) AS event_count,
        (SELECT COUNT(*) FROM dbi_workspace_events event WHERE event.workspace_id = workspace.workspace_id AND event.wallboard = 1) AS wallboard_event_count,
        (SELECT COUNT(*) FROM dbi_workspace_event_milestones milestone WHERE milestone.workspace_id = workspace.workspace_id) AS milestone_count,
        (SELECT COUNT(*) FROM dbi_workspace_manual_records manual WHERE manual.workspace_id = workspace.workspace_id AND manual.deleted_at = '') AS manual_record_count,
        (SELECT COUNT(*) FROM dbi_workspace_activity activity WHERE activity.workspace_id = workspace.workspace_id) AS activity_count,
        (SELECT MAX(activity.occurred_at) FROM dbi_workspace_activity activity WHERE activity.workspace_id = workspace.workspace_id) AS last_activity_at,
        (SELECT COUNT(*) FROM dbi_workspace_agent_keys agent_key WHERE agent_key.workspace_id = workspace.workspace_id AND agent_key.revoked_at = '' AND (agent_key.expires_at = '' OR agent_key.expires_at > CURRENT_TIMESTAMP)) AS active_agent_key_count
        FROM dbi_workspaces workspace
        LEFT JOIN dbi_workspace_settings settings ON settings.workspace_id = workspace.workspace_id
        LEFT JOIN dbi_workspace_ai_preferences ai_preferences ON ai_preferences.workspace_id = workspace.workspace_id
        WHERE (? = 1 OR workspace.workspace_id = ?)
        ORDER BY workspace.status, workspace.name COLLATE NOCASE`).bind(isSuperUser ? 1 : 0, owner.active_workspace_id || "").all(),
      db.prepare(`SELECT membership.*, user.email, user.display_name, user.title, user.status, profile.avatar_data_url
        FROM dbi_workspace_memberships membership JOIN dbi_users user ON user.user_id = membership.user_id
        LEFT JOIN dbi_user_profiles profile ON profile.user_id = user.user_id
        WHERE (? = 1 OR membership.workspace_id = ?)
        ORDER BY user.display_name COLLATE NOCASE`).bind(isSuperUser ? 1 : 0, owner.active_workspace_id || "").all(),
      db.prepare(`SELECT access_request.*, user.email, user.display_name, user.title, workspace.name AS workspace_name
        FROM dbi_workspace_access_requests access_request
        JOIN dbi_users user ON user.user_id = access_request.user_id
        JOIN dbi_workspaces workspace ON workspace.workspace_id = access_request.workspace_id
        WHERE (? = 1 OR access_request.workspace_id = ?)
        ORDER BY CASE access_request.status WHEN 'pending' THEN 0 ELSE 1 END, access_request.created_at DESC`).bind(isSuperUser ? 1 : 0, owner.active_workspace_id || "").all(),
      isSuperUser
        ? db.prepare(`SELECT user.user_id, user.email, user.display_name, user.title, user.status, profile.avatar_data_url
          FROM dbi_users user LEFT JOIN dbi_user_profiles profile ON profile.user_id = user.user_id
          WHERE user.status = 'active' ORDER BY user.display_name COLLATE NOCASE`).all()
        : Promise.resolve({ results: [] }),
    ]);
    const memberships = membershipResult.results || [];
    return json({
      workspaces: (workspaceResult.results || []).map((workspace) => ({
        ...workspaceSummary(workspace),
        pendingRequestCount: Number(workspace.pending_request_count || 0),
        lastActivityAt: workspace.last_activity_at || null,
        contents: {
          trackedRecords: Number(workspace.tracked_record_count || 0),
          events: Number(workspace.event_count || 0),
          wallboardEvents: Number(workspace.wallboard_event_count || 0),
          milestones: Number(workspace.milestone_count || 0),
          manualRecords: Number(workspace.manual_record_count || 0),
          activityEntries: Number(workspace.activity_count || 0),
          activeAgentKeys: Number(workspace.active_agent_key_count || 0),
        },
        members: memberships.filter((entry) => entry.workspace_id === workspace.workspace_id).map((entry) => ({
          id: entry.user_id, email: entry.email, displayName: entry.display_name, title: entry.title || "",
          avatarDataUrl: entry.avatar_data_url || "", status: entry.status, roleId: entry.role, role: ROLE_LABELS[entry.role] || "Viewer",
        })),
      })),
      requests: (requestResult.results || []).map((entry) => ({
        id: entry.request_id, workspaceId: entry.workspace_id, workspaceName: entry.workspace_name,
        userId: entry.user_id, email: entry.email, displayName: entry.display_name, title: entry.title || "",
        note: entry.note || "", status: entry.status, createdAt: entry.created_at, resolvedAt: entry.resolved_at || null,
      })),
      users: (userResult.results || []).map((entry) => ({
        id: entry.user_id, email: entry.email, displayName: entry.display_name, title: entry.title || "",
        avatarDataUrl: entry.avatar_data_url || "", status: entry.status,
      })),
      availableRoles: USER_ROLES,
    });
  }

  if (request.method === "POST" && segments[0] === "workspaces" && segments.length === 1) {
    if (!isSuperUser) return json({ error: "Super user access is required to create workspaces" }, 403);
    const body = await safeJson(request);
    const name = cleanText(body?.name, 80);
    const description = cleanText(body?.description, 240);
    const slug = cleanText(body?.slug || name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""), 80).toLowerCase();
    if (name.length < 2 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) return json({ error: "A valid workspace name is required" }, 400);
    const count = await db.prepare("SELECT COUNT(*) AS count FROM dbi_workspaces WHERE status = 'active'").first();
    if (Number(count?.count || 0) >= 25) return json({ error: "Archive a workspace before creating another" }, 409);
    const workspaceId = crypto.randomUUID();
    const now = new Date().toISOString();
    const created = await db.prepare(`INSERT OR IGNORE INTO dbi_workspaces
      (workspace_id, name, slug, description, status, owner_user_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'active', ?, ?, ?)`)
      .bind(workspaceId, name, slug, description, owner.user_id, now, now).run();
    if (!Number(created?.meta?.changes || 0)) return json({ error: "A workspace with that name already exists" }, 409);
    await db.batch([
      db.prepare(`INSERT INTO dbi_workspace_memberships
        (workspace_id, user_id, role, created_by, created_at, updated_at) VALUES (?, ?, 'super_user', ?, ?, ?)`)
        .bind(workspaceId, owner.user_id, owner.user_id, now, now),
      db.prepare(`INSERT INTO dbi_workspace_settings (workspace_id, icon_data_url, header_eyebrow, display_title, updated_at)
        VALUES (?, '', ?, ?, ?)`).bind(workspaceId, DEFAULT_HEADER_EYEBROW, DEFAULT_DISPLAY_TITLE, now),
      ...defaultEventCategoryStatements(db, workspaceId, now),
    ]);
    await recordActivity(db, { type: "user", id: owner.user_id, workspaceId }, "workspace_created", "workspace", workspaceId, { name });
    const row = await db.prepare("SELECT * FROM dbi_workspaces WHERE workspace_id = ?").bind(workspaceId).first();
    return json({ workspace: workspaceSummary(row, { role: "super_user" }) }, 201);
  }

  if (request.method === "PATCH" && segments[0] === "workspaces" && segments[1] && segments.length === 2) {
    const workspaceId = segments[1];
    if (!await canAdministerWorkspace(db, owner, workspaceId)) return json({ error: "Workspace manager access is required" }, 403);
    const workspace = await db.prepare(`SELECT workspace.*, ai_preferences.auto_accept_event_augmentations
      FROM dbi_workspaces workspace
      LEFT JOIN dbi_workspace_ai_preferences ai_preferences ON ai_preferences.workspace_id = workspace.workspace_id
      WHERE workspace.workspace_id = ?`).bind(workspaceId).first();
    if (!workspace) return json({ error: "Workspace not found" }, 404);
    const body = await safeJson(request);
    const name = cleanText(body?.name, 80);
    const description = cleanText(body?.description, 240);
    const iconDataUrl = validAvatarDataUrl(body?.iconDataUrl);
    const headerEyebrow = cleanText(body?.headerEyebrow || DEFAULT_HEADER_EYEBROW, 80);
    const displayTitle = cleanText(body?.displayTitle || DEFAULT_DISPLAY_TITLE, 80);
    const autoAcceptAiAugmentations = body?.autoAcceptAiAugmentations === undefined
      ? Boolean(workspace.auto_accept_event_augmentations)
      : body.autoAcceptAiAugmentations === true;
    if (name.length < 2) return json({ error: "A valid workspace name is required" }, 400);
    if (iconDataUrl === null || headerEyebrow.length < 2 || displayTitle.length < 2) return json({ error: "Valid workspace branding is required" }, 400);
    const duplicate = await db.prepare("SELECT workspace_id FROM dbi_workspaces WHERE LOWER(name) = LOWER(?) AND workspace_id <> ?")
      .bind(name, workspaceId).first();
    if (duplicate) return json({ error: "A workspace with that name already exists" }, 409);
    const now = new Date().toISOString();
    await db.batch([
      db.prepare("UPDATE dbi_workspaces SET name = ?, description = ?, updated_at = ? WHERE workspace_id = ?")
        .bind(name, description, now, workspaceId),
      db.prepare(`INSERT INTO dbi_workspace_settings (workspace_id, icon_data_url, header_eyebrow, display_title, updated_at)
        VALUES (?, ?, ?, ?, ?) ON CONFLICT(workspace_id) DO UPDATE SET icon_data_url = excluded.icon_data_url,
        header_eyebrow = excluded.header_eyebrow, display_title = excluded.display_title, updated_at = excluded.updated_at`)
        .bind(workspaceId, iconDataUrl, headerEyebrow, displayTitle, now),
      db.prepare(`INSERT INTO dbi_workspace_ai_preferences
        (workspace_id, auto_accept_event_augmentations, updated_by, updated_at) VALUES (?, ?, ?, ?)
        ON CONFLICT(workspace_id) DO UPDATE SET auto_accept_event_augmentations = excluded.auto_accept_event_augmentations,
        updated_by = excluded.updated_by, updated_at = excluded.updated_at`)
        .bind(workspaceId, autoAcceptAiAugmentations ? 1 : 0, owner.user_id, now),
    ]);
    await recordActivity(db, { type: "user", id: owner.user_id, workspaceId }, "workspace_updated", "workspace", workspaceId, { previousName: workspace.name, name, description });
    const row = await db.prepare(`SELECT workspace.*, settings.icon_data_url, settings.header_eyebrow, settings.display_title,
      ai_preferences.auto_accept_event_augmentations
      FROM dbi_workspaces workspace LEFT JOIN dbi_workspace_settings settings ON settings.workspace_id = workspace.workspace_id
      LEFT JOIN dbi_workspace_ai_preferences ai_preferences ON ai_preferences.workspace_id = workspace.workspace_id
      WHERE workspace.workspace_id = ?`).bind(workspaceId).first();
    return json({ workspace: workspaceSummary(row) });
  }

  if (request.method === "POST" && segments[0] === "requests" && segments[1]) {
    const accessRequest = await db.prepare("SELECT * FROM dbi_workspace_access_requests WHERE request_id = ?").bind(segments[1]).first();
    if (!accessRequest) return json({ error: "Access request not found" }, 404);
    if (accessRequest.status !== "pending") return json({ error: "Access request is already resolved" }, 409);
    if (!await canAdministerWorkspace(db, owner, accessRequest.workspace_id)) return json({ error: "Workspace manager access is required" }, 403);
    const body = await safeJson(request);
    const decision = cleanText(body?.decision, 20);
    const role = cleanText(body?.role, 32) || "viewer";
    if (!["approved", "denied"].includes(decision) || (decision === "approved" && !USER_ROLES.includes(role))) {
      return json({ error: "A valid approval decision and role are required" }, 400);
    }
    const now = new Date().toISOString();
    const statements = [db.prepare(`UPDATE dbi_workspace_access_requests
      SET status = ?, resolved_by = ?, resolved_at = ?, updated_at = ? WHERE request_id = ?`)
      .bind(decision, owner.user_id, now, now, accessRequest.request_id)];
    if (decision === "approved") {
      statements.push(db.prepare(`INSERT INTO dbi_workspace_memberships
        (workspace_id, user_id, role, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(workspace_id, user_id) DO UPDATE SET role = excluded.role, updated_at = excluded.updated_at`)
        .bind(accessRequest.workspace_id, accessRequest.user_id, role, owner.user_id, now, now));
      statements.push(db.prepare(`INSERT OR IGNORE INTO dbi_session_workspaces (session_id, workspace_id, updated_at)
        SELECT session.id, ?, ? FROM dbi_sessions session
        LEFT JOIN dbi_session_workspaces active ON active.session_id = session.id
        WHERE session.user_id = ? AND active.session_id IS NULL`).bind(accessRequest.workspace_id, now, accessRequest.user_id));
    }
    await db.batch(statements);
    await recordActivity(db, { type: "user", id: owner.user_id, workspaceId: accessRequest.workspace_id }, `workspace_request_${decision}`, "workspace_request", accessRequest.request_id, { userId: accessRequest.user_id, role });
    return json({ ok: true, status: decision });
  }

  if (segments[0] === "workspaces" && segments[1] && segments[2] === "members") {
    const workspaceId = segments[1];
    if (!await canAdministerWorkspace(db, owner, workspaceId)) return json({ error: "Workspace manager access is required" }, 403);
    const workspace = await db.prepare("SELECT * FROM dbi_workspaces WHERE workspace_id = ? AND status = 'active'").bind(workspaceId).first();
    if (!workspace) return json({ error: "Workspace not found" }, 404);
    if (request.method === "POST" && segments.length === 3) {
      const body = await safeJson(request);
      const userId = cleanText(body?.userId, 80);
      const role = cleanText(body?.role, 32);
      const target = await db.prepare("SELECT * FROM dbi_users WHERE user_id = ? AND status = 'active'").bind(userId).first();
      if (!target || !USER_ROLES.includes(role)) return json({ error: "An active user and valid role are required" }, 400);
      if (target.role === "super_user") return json({ error: "The Super user membership is immutable" }, 403);
      const now = new Date().toISOString();
      const existing = await db.prepare("SELECT role FROM dbi_workspace_memberships WHERE workspace_id = ? AND user_id = ?").bind(workspaceId, userId).first();
      if (!existing && !isSuperUser) return json({ error: "Super user access is required to add an existing account" }, 403);
      await db.prepare(`INSERT INTO dbi_workspace_memberships
        (workspace_id, user_id, role, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(workspace_id, user_id) DO UPDATE SET role = excluded.role, updated_at = excluded.updated_at`)
        .bind(workspaceId, userId, role, owner.user_id, now, now).run();
      await recordActivity(db, { type: "user", id: owner.user_id, workspaceId }, existing ? "workspace_member_role_changed" : "workspace_member_added", "user", userId, { role, previousRole: existing?.role || null });
      return json({ ok: true }, existing ? 200 : 201);
    }
    if (request.method === "DELETE" && segments[3]) {
      const userId = segments[3];
      const membership = await db.prepare("SELECT role FROM dbi_workspace_memberships WHERE workspace_id = ? AND user_id = ?").bind(workspaceId, userId).first();
      if (!membership) return json({ error: "Workspace member not found" }, 404);
      if (membership.role === "super_user") return json({ error: "The Super user cannot be removed from a workspace" }, 403);
      const now = new Date().toISOString();
      await db.batch([
        db.prepare("DELETE FROM dbi_workspace_memberships WHERE workspace_id = ? AND user_id = ?").bind(workspaceId, userId),
        db.prepare(`DELETE FROM dbi_session_workspaces WHERE workspace_id = ? AND session_id IN
          (SELECT id FROM dbi_sessions WHERE user_id = ?)` ).bind(workspaceId, userId),
        db.prepare("DELETE FROM dbi_workspace_event_attendees WHERE workspace_id = ? AND user_id = ?").bind(workspaceId, userId),
        db.prepare("DELETE FROM dbi_workspace_team_members WHERE workspace_id = ? AND user_id = ?").bind(workspaceId, userId),
        db.prepare("UPDATE dbi_workspace_agent_keys SET revoked_at = ? WHERE workspace_id = ? AND created_by = ? AND revoked_at = ''").bind(now, workspaceId, userId),
      ]);
      await recordActivity(db, { type: "user", id: owner.user_id, workspaceId }, "workspace_member_removed", "user", userId);
      return json({ ok: true });
    }
  }

  return json({ error: "Method not allowed" }, 405);
}

function agentJson(data, status = 200, meta = {}, headers = {}) {
  return Response.json({ apiVersion: AGENT_API_VERSION, data, meta }, {
    status,
    headers: { "cache-control": "no-store", ...headers },
  });
}

function agentError(code, message, status = 400, requestId = crypto.randomUUID(), details = undefined) {
  return Response.json({
    apiVersion: AGENT_API_VERSION,
    error: { code, message, requestId, ...(details === undefined ? {} : { details }) },
  }, { status, headers: { "cache-control": "no-store" } });
}

function parsedScopes(value) {
  try {
    const scopes = JSON.parse(value || "[]");
    return Array.isArray(scopes) ? scopes.filter((scope) => AGENT_SCOPES.includes(scope)) : [];
  } catch {
    return [];
  }
}

async function requestPrincipal(db, request) {
  const session = await sessionUser(db, request);
  if (session) {
    const roleId = session.role === "super_user" ? "super_user" : session.membership_role;
    return {
      type: "user",
      id: session.user_id,
      actorId: session.actor_user_id || session.user_id,
      isEmulating: Boolean(session.is_emulating),
      name: session.display_name,
      workspaceId: session.active_workspace_id || "",
      roleId,
      canManageWorkspace: roleId === "super_user" || roleId === "administrator",
      scopes: (!session.is_emulating && session.must_change_password) || !session.active_workspace_id ? [] : scopesForRole(roleId),
    };
  }
  const authorization = request.headers.get("authorization") || "";
  const rawToken = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  if (!rawToken.startsWith(AGENT_TOKEN_PREFIX) || rawToken.length < 72) return null;
  const now = new Date().toISOString();
  const row = await db.prepare(`
    SELECT * FROM dbi_workspace_agent_keys
    WHERE token_hash = ? AND revoked_at = '' AND (expires_at = '' OR expires_at > ?)
  `).bind(await hashValue(rawToken), now).first();
  if (!row) return null;
  await db.prepare("UPDATE dbi_workspace_agent_keys SET last_used_at = ? WHERE id = ?").bind(now, row.id).run();
  return { type: "agent", id: row.id, name: row.name, workspaceId: row.workspace_id, roleId: "agent", canManageWorkspace: false, scopes: parsedScopes(row.scopes_json) };
}

function hasScope(principal, scope) {
  return Boolean(principal?.scopes?.includes(scope));
}

async function rateLimited(db, principal) {
  if (principal.type === "user") return false;
  const bucket = new Date().toISOString().slice(0, 16);
  await db.prepare(`
    INSERT INTO dbi_agent_rate_limits (principal_id, minute_bucket, request_count)
    VALUES (?, ?, 1)
    ON CONFLICT(principal_id, minute_bucket)
    DO UPDATE SET request_count = request_count + 1
  `).bind(principal.id, bucket).run();
  const row = await db.prepare(`
    SELECT request_count FROM dbi_agent_rate_limits WHERE principal_id = ? AND minute_bucket = ?
  `).bind(principal.id, bucket).first();
  if (Number(row?.request_count || 0) === 1) {
    const cutoff = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString().slice(0, 16);
    await db.prepare("DELETE FROM dbi_agent_rate_limits WHERE minute_bucket < ?").bind(cutoff).run();
  }
  return Number(row?.request_count || 0) > AGENT_RATE_LIMIT;
}

async function recordActivity(db, principal, action, entityType, entityId = "", detail = {}) {
  if (!principal.workspaceId) return;
  await db.prepare(`
    INSERT INTO dbi_workspace_activity
      (id, workspace_id, actor_type, actor_id, action, entity_type, entity_id, detail_json, occurred_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    crypto.randomUUID(), principal.workspaceId, principal.type, principal.actorId || principal.id, cleanText(action, 80), cleanText(entityType, 80),
    cleanText(entityId, 180), JSON.stringify(principal.isEmulating ? { ...(detail || {}), emulatedUserId: principal.id } : (detail || {})).slice(0, 8_000), new Date().toISOString(),
  ).run();
  if (principal.type === "user") await recordUserActivityD1(db, {
    actor_user_id: principal.actorId || principal.id,
    user_id: principal.id,
    active_workspace_id: principal.workspaceId,
  }, { eventType: "action", action: entityType === "user" && !String(action).startsWith("user_emulation") ? String(action).replace(/^user_/, "account_") : action, surface: entityType === "user" ? "users" : entityType === "event" ? "schedule" : entityType, targetType: entityType, targetId: entityId });
}

function safeObject(value) {
  try {
    const parsed = JSON.parse(value || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function apiRequestFromRow(row) {
  return {
    id: row.id,
    workspaceId: row.workspace_id || null,
    userId: row.user_id || null,
    principalType: row.principal_type,
    principalId: row.principal_id,
    requestKind: row.request_kind,
    provider: row.provider,
    operation: row.operation,
    method: row.method || null,
    route: row.route || null,
    status: row.status,
    httpStatus: Number(row.http_status || 0),
    stage: row.stage || null,
    model: row.model || null,
    credentialId: row.credential_id || null,
    credentialScope: row.credential_scope || null,
    providerRequestId: row.provider_request_id || null,
    traceId: row.trace_id || null,
    responseId: row.response_id || null,
    latencyMs: Number(row.latency_ms || 0),
    inputTokens: Number(row.input_tokens || 0),
    outputTokens: Number(row.output_tokens || 0),
    retryCount: Number(row.retry_count || 0),
    retryable: Boolean(row.retryable),
    errorCode: row.error_code || null,
    errorMessage: row.error_message || null,
    metadata: safeObject(row.metadata_json),
    startedAt: row.started_at,
    completedAt: row.completed_at,
  };
}

async function recordApiRequest(db, entry = {}) {
  const completedAt = cleanDate(entry.completedAt) || new Date().toISOString();
  const startedAt = cleanDate(entry.startedAt) || completedAt;
  const status = ["succeeded", "accepted", "failed", "rejected", "rate_limited", "cancelled"].includes(entry.status) ? entry.status : "failed";
  const metadata = safeLogMetadata(entry.metadata) || {};
  await db.prepare(`INSERT INTO dbi_api_request_log
    (id, workspace_id, user_id, principal_type, principal_id, request_kind, provider, operation, method, route,
      status, http_status, stage, model, credential_id, credential_scope, provider_request_id, trace_id, response_id,
      latency_ms, input_tokens, output_tokens, retry_count, retryable, error_code, error_message, metadata_json, started_at, completed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(
      cleanText(entry.id, 100) || crypto.randomUUID(), cleanText(entry.workspaceId, 100), cleanText(entry.userId, 100),
      cleanText(entry.principalType, 40) || "system", cleanText(entry.principalId, 100) || "system",
      cleanText(entry.requestKind, 40) || "api", cleanText(entry.provider, 60) || "dbi", cleanText(entry.operation, 120) || "request",
      cleanText(entry.method, 12), cleanText(entry.route, 180), status, boundedInteger(entry.httpStatus, 0, 0, 599),
      cleanText(entry.stage, 80), cleanText(entry.model, 120), cleanText(entry.credentialId, 100), cleanText(entry.credentialScope, 20),
      cleanText(entry.providerRequestId, 180), cleanText(entry.traceId, 180), cleanText(entry.responseId, 180),
      boundedInteger(entry.latencyMs, 0, 0, 86_400_000), boundedInteger(entry.inputTokens, 0, 0, 1_000_000_000),
      boundedInteger(entry.outputTokens, 0, 0, 1_000_000_000), boundedInteger(entry.retryCount, 0, 0, 25), entry.retryable ? 1 : 0,
      safeLogText(entry.errorCode, 120), safeLogText(entry.errorMessage, 500), JSON.stringify(metadata).slice(0, 8_000), startedAt, completedAt,
    ).run();
}

function cleanDate(value) {
  const text = cleanText(value, 32);
  if (!text) return "";
  return /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d{3})?)?Z?)?$/.test(text) ? text : "";
}

function cleanStringArray(value, limit = 50, itemLength = 180) {
  return [...new Set((Array.isArray(value) ? value : []).map((item) => cleanText(item, itemLength)).filter(Boolean))].slice(0, limit);
}

function boundedInteger(value, fallback, minimum, maximum) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) ? Math.min(maximum, Math.max(minimum, parsed)) : fallback;
}

function publicAgentKey(row) {
  return {
    id: row.id,
    name: row.name,
    scopes: parsedScopes(row.scopes_json),
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at || null,
    expiresAt: row.expires_at || null,
    revokedAt: row.revoked_at || null,
  };
}

async function openAiKeysResponse(request, db, env) {
  if (!sameOriginRequest(request)) return json({ error: "Cross-origin credential management is not allowed" }, 403);
  const session = await sessionUser(db, request);
  if (!session) return json({ error: "Sign in required" }, 401);
  const workspaceId = session.active_workspace_id || "";
  const canManageWorkspaceKeys = Boolean(workspaceId && canAdministerWorkspaces(session));
  const pathname = new URL(request.url).pathname.replace(/\/+$/, "");
  const prefix = "/api/v1/auth/openai-keys";
  const keyId = cleanText(decodeURIComponent(pathname.slice(prefix.length).replace(/^\//, "")), 80);
  const encryptionReady = String(env.DBI_CREDENTIAL_ENCRYPTION_KEY || "").length >= 32;

  if (request.method === "GET" && !keyId) {
    const [personalResult, workspaceResult, personalUsage, workspaceUsage] = await Promise.all([
      db.prepare("SELECT * FROM dbi_openai_keys WHERE scope_type = 'user' AND user_id = ? ORDER BY revoked_at, is_default DESC, created_at DESC").bind(session.user_id).all(),
      workspaceId && canManageWorkspaceKeys
        ? db.prepare("SELECT * FROM dbi_openai_keys WHERE scope_type = 'workspace' AND workspace_id = ? ORDER BY revoked_at, is_default DESC, created_at DESC").bind(workspaceId).all()
        : Promise.resolve({ results: [] }),
      openAiKeyUsage(db, "user_id", session.user_id),
      workspaceId && canManageWorkspaceKeys ? openAiKeyUsage(db, "workspace_id", workspaceId) : Promise.resolve(new Map()),
    ]);
    return json({
      capability: {
        provider: "openai",
        encryptionReady,
        canManageWorkspaceKeys,
        activeWorkspaceId: workspaceId || null,
        queryRuntimeEnabled: encryptionReady,
        loggingReady: true,
        retentionDays: 90,
        loggedFields: ["status", "latency", "tokens", "request IDs", "retry metadata", "safe errors"],
      },
      personalKeys: (personalResult.results || []).map((row) => keyMetadataWithUsage(row, personalUsage)),
      workspaceKeys: (workspaceResult.results || []).map((row) => keyMetadataWithUsage(row, workspaceUsage)),
    });
  }

  if (request.method === "POST" && !keyId) {
    if (!encryptionReady) return json({ error: "OpenAI key storage is not configured on this runtime" }, 503);
    const body = await safeJson(request);
    const scope = cleanText(body?.scope, 20);
    const label = cleanText(body?.label, 80);
    const apiKey = validOpenAiKey(body?.apiKey);
    if (!['workspace', 'user'].includes(scope) || label.length < 2 || !apiKey) return json({ error: "A valid scope, label, and OpenAI API key are required" }, 400);
    if (scope === "workspace" && !canManageWorkspaceKeys) return json({ error: "Workspace manager access is required" }, 403);
    const scopeId = scope === "workspace" ? workspaceId : session.user_id;
    if (!scopeId) return json({ error: "Select a workspace before managing workspace keys" }, 409);
    const existing = await db.prepare(`SELECT COUNT(*) AS count FROM dbi_openai_keys WHERE scope_type = ? AND ${scope === "workspace" ? "workspace_id" : "user_id"} = ? AND revoked_at = ''`).bind(scope, scopeId).first();
    if (Number(existing?.count || 0) >= 10) return json({ error: "Revoke an existing OpenAI key before adding another" }, 409);
    const encrypted = await encryptOpenAiKey(apiKey, env);
    if (!encrypted) return json({ error: "OpenAI key storage is not configured on this runtime" }, 503);
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const isDefault = Boolean(body?.isDefault) || Number(existing?.count || 0) === 0;
    const clearDefault = scope === "workspace"
      ? db.prepare("UPDATE dbi_openai_keys SET is_default = 0, updated_at = ? WHERE scope_type = 'workspace' AND workspace_id = ? AND revoked_at = ''").bind(now, workspaceId)
      : db.prepare("UPDATE dbi_openai_keys SET is_default = 0, updated_at = ? WHERE scope_type = 'user' AND user_id = ? AND revoked_at = ''").bind(now, session.user_id);
    const insert = db.prepare(`INSERT INTO dbi_openai_keys
      (id, scope_type, workspace_id, user_id, label, encrypted_key, key_iv, key_version, key_last_four, is_default, created_by, created_at, updated_at, revoked_at, last_used_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', '')`).bind(
      id, scope, scope === "workspace" ? workspaceId : "", scope === "user" ? session.user_id : "", label,
      encrypted.encryptedKey, encrypted.keyIv, encrypted.keyVersion, apiKey.slice(-4), isDefault ? 1 : 0,
      session.user_id, now, now,
    );
    await db.batch(isDefault ? [clearDefault, insert] : [insert]);
    await recordApiRequest(db, {
      workspaceId: workspaceId || "", userId: session.user_id, principalType: "user", principalId: session.user_id,
      requestKind: "credential_lifecycle", provider: "openai", operation: "credential.created", method: request.method,
      route: "/api/v1/auth/openai-keys", status: "succeeded", httpStatus: 201, stage: "credential_management",
      credentialId: id, credentialScope: scope, metadata: { label, isDefault },
    });
    if (scope === "workspace") await recordActivity(db, { type: "user", id: session.user_id, workspaceId }, "openai_key_added", "openai_key", id, { label });
    return json({ key: openAiKeyMetadata({ id, scope_type: scope, workspace_id: scope === "workspace" ? workspaceId : "", user_id: scope === "user" ? session.user_id : "", label, key_last_four: apiKey.slice(-4), is_default: isDefault ? 1 : 0, created_at: now, updated_at: now, revoked_at: "", last_used_at: "" }) }, 201);
  }

  const stored = keyId ? await db.prepare("SELECT * FROM dbi_openai_keys WHERE id = ?").bind(keyId).first() : null;
  if (!stored) return json({ error: "OpenAI key not found" }, 404);
  const authorized = stored.scope_type === "user"
    ? stored.user_id === session.user_id
    : stored.workspace_id === workspaceId && canManageWorkspaceKeys;
  if (!authorized) return json({ error: "Credential management access is required" }, 403);

  if (request.method === "PATCH") {
    if (stored.revoked_at) return json({ error: "OpenAI key is already revoked" }, 409);
    const body = await safeJson(request);
    const label = cleanText(body?.label ?? stored.label, 80);
    const nextApiKey = body?.apiKey ? validOpenAiKey(body.apiKey) : "";
    if (label.length < 2 || (body?.apiKey && !nextApiKey)) return json({ error: "A valid label and OpenAI API key are required" }, 400);
    if (body?.apiKey && !encryptionReady) return json({ error: "OpenAI key storage is not configured on this runtime" }, 503);
    const encrypted = nextApiKey ? await encryptOpenAiKey(nextApiKey, env) : null;
    const now = new Date().toISOString();
    const makeDefault = Boolean(body?.isDefault);
    const statements = [];
    if (makeDefault) {
      statements.push(stored.scope_type === "workspace"
        ? db.prepare("UPDATE dbi_openai_keys SET is_default = 0, updated_at = ? WHERE scope_type = 'workspace' AND workspace_id = ? AND revoked_at = ''").bind(now, stored.workspace_id)
        : db.prepare("UPDATE dbi_openai_keys SET is_default = 0, updated_at = ? WHERE scope_type = 'user' AND user_id = ? AND revoked_at = ''").bind(now, stored.user_id));
    }
    statements.push(db.prepare(`UPDATE dbi_openai_keys SET label = ?, encrypted_key = ?, key_iv = ?, key_version = ?, key_last_four = ?, is_default = ?, updated_at = ? WHERE id = ? AND revoked_at = ''`).bind(
      label, encrypted?.encryptedKey || stored.encrypted_key, encrypted?.keyIv || stored.key_iv, encrypted?.keyVersion || stored.key_version,
      nextApiKey ? nextApiKey.slice(-4) : stored.key_last_four, makeDefault ? 1 : stored.is_default, now, keyId,
    ));
    await db.batch(statements);
    await recordApiRequest(db, {
      workspaceId: stored.workspace_id || workspaceId || "", userId: session.user_id, principalType: "user", principalId: session.user_id,
      requestKind: "credential_lifecycle", provider: "openai", operation: nextApiKey ? "credential.rotated" : makeDefault ? "credential.default_changed" : "credential.updated",
      method: request.method, route: `/api/v1/auth/openai-keys/${keyId}`, status: "succeeded", httpStatus: 200, stage: "credential_management",
      credentialId: keyId, credentialScope: stored.scope_type, metadata: { label, rotated: Boolean(nextApiKey), isDefault: makeDefault },
    });
    if (stored.scope_type === "workspace") await recordActivity(db, { type: "user", id: session.user_id, workspaceId }, "openai_key_updated", "openai_key", keyId, { label, rotated: Boolean(nextApiKey), default: makeDefault });
    return json({ key: openAiKeyMetadata({ ...stored, label, key_last_four: nextApiKey ? nextApiKey.slice(-4) : stored.key_last_four, is_default: makeDefault ? 1 : stored.is_default, updated_at: now }) });
  }

  if (request.method === "DELETE") {
    if (stored.revoked_at) return json({ error: "OpenAI key is already revoked" }, 409);
    const now = new Date().toISOString();
    await db.prepare("UPDATE dbi_openai_keys SET revoked_at = ?, is_default = 0, updated_at = ? WHERE id = ?").bind(now, now, keyId).run();
    await recordApiRequest(db, {
      workspaceId: stored.workspace_id || workspaceId || "", userId: session.user_id, principalType: "user", principalId: session.user_id,
      requestKind: "credential_lifecycle", provider: "openai", operation: "credential.revoked", method: request.method,
      route: `/api/v1/auth/openai-keys/${keyId}`, status: "succeeded", httpStatus: 200, stage: "credential_management",
      credentialId: keyId, credentialScope: stored.scope_type, metadata: { label: stored.label },
    });
    if (stored.scope_type === "workspace") await recordActivity(db, { type: "user", id: session.user_id, workspaceId }, "openai_key_revoked", "openai_key", keyId, { label: stored.label });
    return json({ ok: true });
  }

  return json({ error: "Method not allowed" }, 405);
}

function canRunEventAi(session) {
  return ["super_user", "administrator", "analyst"].includes(publicUser(session)?.roleId);
}

function eventAiJobFromRow(row) {
  const parse = (value, fallback) => {
    try { return JSON.parse(value || ""); } catch { return fallback; }
  };
  const inputSnapshot = parse(row.input_snapshot_json, {});
  const verification = parse(row.verification_json, {});
  const categories = parse(row.categories_json, []);
  const storedMergeResult = parse(row.merge_result_json, {});
  const mergeResult = storedMergeResult?.mergedDraft || verification?.decision === "rejected"
    ? storedMergeResult
    : resolveEventAiVerificationOutcome({ draft: inputSnapshot, verification, categories }).mergeResult;
  return {
    id: row.id,
    status: row.status,
    currentStep: row.current_step,
    credentialScope: row.credential_scope,
    producerModel: row.producer_model,
    verifierModel: row.verifier_model,
    direction: row.direction || "",
    inputSnapshot,
    proposal: parse(row.proposal_json, {}),
    verification,
    mergeResult,
    error: row.error_message ? { code: row.error_code || "event_ai_failed", message: row.error_message } : null,
    diagnostic: parse(row.diagnostic_metadata_json, {})?.evidence || null,
    providerRequestId: row.diagnostic_provider_request_id || null,
    responseId: row.diagnostic_response_id || null,
    retryCount: Number(row.retry_count || 0),
    traceId: row.trace_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at || null,
  };
}

const EVENT_AI_JOB_DIAGNOSTIC_SELECT = `
  SELECT j.*,
    l.metadata_json AS diagnostic_metadata_json,
    l.provider_request_id AS diagnostic_provider_request_id,
    l.response_id AS diagnostic_response_id
  FROM dbi_event_ai_jobs j
  LEFT JOIN dbi_api_request_log l ON l.id = (
    SELECT candidate.id
    FROM dbi_api_request_log candidate
    WHERE candidate.trace_id = j.trace_id
      AND candidate.request_kind = 'openai'
    ORDER BY candidate.completed_at DESC
    LIMIT 1
  )`;

const EVENT_AI_RECENT_JOBS_SELECT = `
  WITH recent_jobs AS (
    SELECT *
    FROM dbi_event_ai_jobs
    WHERE workspace_id = ? AND user_id = ?
    ORDER BY created_at DESC
    LIMIT 20
  )
  SELECT j.*,
    l.metadata_json AS diagnostic_metadata_json,
    l.provider_request_id AS diagnostic_provider_request_id,
    l.response_id AS diagnostic_response_id
  FROM recent_jobs j
  LEFT JOIN dbi_api_request_log l ON l.id = (
    SELECT candidate.id
    FROM dbi_api_request_log candidate
    WHERE candidate.trace_id = j.trace_id
      AND candidate.request_kind = 'openai'
    ORDER BY candidate.completed_at DESC
    LIMIT 1
  )
  ORDER BY j.created_at DESC`;

async function eventAiJobWithDiagnostic(db, id, workspaceId, userId) {
  return db.prepare(`${EVENT_AI_JOB_DIAGNOSTIC_SELECT} WHERE j.id = ? AND j.workspace_id = ? AND j.user_id = ?`)
    .bind(id, workspaceId, userId).first();
}

async function eventAiCategories(db, workspaceId) {
  const result = await db.prepare("SELECT category_id AS id, name, description FROM dbi_workspace_event_categories WHERE workspace_id = ? ORDER BY LOWER(name)").bind(workspaceId).all();
  return result.results || [];
}

async function eventAiCredentialCapability(db, session, env) {
  const workspaceId = session.active_workspace_id || "";
  const [personal, workspace, workspaceDefaults] = await Promise.all([
    db.prepare("SELECT id, label, key_last_four, is_default FROM dbi_openai_keys WHERE scope_type = 'user' AND user_id = ? AND revoked_at = '' ORDER BY is_default DESC, created_at DESC").bind(session.user_id).all(),
    workspaceId
      ? db.prepare("SELECT id, label, key_last_four FROM dbi_openai_keys WHERE scope_type = 'workspace' AND workspace_id = ? AND revoked_at = '' AND is_default = 1 ORDER BY created_at DESC LIMIT 1").bind(workspaceId).first()
      : Promise.resolve(null),
    eventAiWorkspaceModelDefaults(db, workspaceId),
  ]);
  const mockMode = String(env.DBI_EVENT_AI_MOCK_MODE || "").toLowerCase() === "true";
  return {
    available: canRunEventAi(session) && (mockMode || String(env.DBI_CREDENTIAL_ENCRYPTION_KEY || "").length >= 32) && (mockMode || Boolean(personal.results?.length || workspace)),
    canRun: canRunEventAi(session),
    mockMode,
    personalKeys: (personal.results || []).map((row) => ({ id: row.id, label: row.label, lastFour: row.key_last_four, isDefault: Boolean(row.is_default) })),
    workspaceDefault: workspace ? { available: true, label: "Workspace default", lastFour: canAdministerWorkspaces(session) ? workspace.key_last_four : "" } : { available: false, label: "Workspace default", lastFour: "" },
    canManageWorkspaceDefaults: canAdministerWorkspaces(session),
    workspaceModelDefaults: workspaceDefaults,
    producerModel: EVENT_AI_PRODUCER_MODEL,
    verifierModel: EVENT_AI_VERIFIER_MODEL,
    retentionDays: 90,
    workflow: ["research", "independent verification", "deterministic safe merge", "apply or review by workspace policy"],
  };
}

async function resolveEventAiCredential(db, session, scope, credentialId, env) {
  const mockMode = String(env.DBI_EVENT_AI_MOCK_MODE || "").toLowerCase() === "true";
  let row = null;
  if (scope === "user") {
    row = credentialId
      ? await db.prepare("SELECT * FROM dbi_openai_keys WHERE id = ? AND scope_type = 'user' AND user_id = ? AND revoked_at = ''").bind(credentialId, session.user_id).first()
      : await db.prepare("SELECT * FROM dbi_openai_keys WHERE scope_type = 'user' AND user_id = ? AND revoked_at = '' ORDER BY is_default DESC, created_at DESC LIMIT 1").bind(session.user_id).first();
  } else if (scope === "workspace" && session.active_workspace_id) {
    row = await db.prepare("SELECT * FROM dbi_openai_keys WHERE scope_type = 'workspace' AND workspace_id = ? AND revoked_at = '' AND is_default = 1 ORDER BY created_at DESC LIMIT 1").bind(session.active_workspace_id).first();
  }
  if (!row && mockMode) return { id: "mock-credential", scope: scope === "workspace" ? "workspace" : "user", apiKey: "mock" };
  if (!row) return null;
  const apiKey = await decryptOpenAiKey(row, env);
  return apiKey ? { id: row.id, scope: row.scope_type, apiKey } : null;
}

async function eventAiWorkspaceModelDefaults(db, workspaceId) {
  if (!workspaceId) return { producerModel: "", verifierModel: "" };
  const row = await db.prepare("SELECT event_research_model, event_verification_model FROM dbi_workspace_ai_settings WHERE workspace_id = ?").bind(workspaceId).first();
  return {
    producerModel: cleanText(row?.event_research_model, 180),
    verifierModel: cleanText(row?.event_verification_model, 180),
  };
}

async function eventAiModelInventory(db, session, scope, credentialId, env) {
  const credential = await resolveEventAiCredential(db, session, scope, credentialId, env);
  if (!credential) {
    const error = new Error(`No active ${scope === "workspace" ? "workspace default" : "personal"} OpenAI key is available.`);
    error.code = "credential_unavailable";
    error.httpStatus = 409;
    throw error;
  }
  const mockMode = String(env.DBI_EVENT_AI_MOCK_MODE || "").toLowerCase() === "true";
  const startedAt = new Date().toISOString();
  let inventory;
  try {
    inventory = mockMode
      ? { models: MOCK_EVENT_AI_MODELS, requestId: "", latencyMs: 0, retrievedAt: startedAt }
      : await fetchOpenAiModels(credential.apiKey);
    await recordApiRequest(db, {
      workspaceId: session.active_workspace_id, userId: session.user_id, principalType: "user", principalId: session.user_id,
      requestKind: "openai", provider: "openai", operation: "model_inventory.list", method: "GET", route: "/v1/models",
      status: "succeeded", httpStatus: 200, stage: "model_inventory", credentialId: credential.id === "mock-credential" ? "" : credential.id,
      credentialScope: credential.scope, providerRequestId: inventory.requestId, latencyMs: inventory.latencyMs,
      metadata: { inventoryCount: inventory.models.length, candidateCount: eventAiModelCandidates(inventory.models).length }, startedAt,
    });
  } catch (error) {
    await recordApiRequest(db, {
      workspaceId: session.active_workspace_id, userId: session.user_id, principalType: "user", principalId: session.user_id,
      requestKind: "openai", provider: "openai", operation: "model_inventory.list", method: "GET", route: "/v1/models",
      status: "failed", httpStatus: error?.httpStatus || 502, stage: "model_inventory", credentialId: credential.id === "mock-credential" ? "" : credential.id,
      credentialScope: credential.scope, providerRequestId: error?.requestId || "", latencyMs: error?.latencyMs || 0,
      retryable: Number(error?.httpStatus || 0) >= 500 || Number(error?.httpStatus || 0) === 429,
      errorCode: error?.code || "model_inventory_failed", errorMessage: error?.message || "OpenAI model inventory failed.", startedAt,
    }).catch(() => {});
    throw error;
  }
  const candidates = eventAiModelCandidates(inventory.models);
  if (!candidates.length) {
    const error = new Error("The selected OpenAI credential has no compatible text models in its live model inventory.");
    error.code = "no_compatible_models";
    error.httpStatus = 409;
    throw error;
  }
  const workspaceDefaults = credential.scope === "workspace"
    ? await eventAiWorkspaceModelDefaults(db, session.active_workspace_id)
    : { producerModel: "", verifierModel: "" };
  return {
    credential,
    models: candidates,
    inventoryCount: inventory.models.length,
    retrievedAt: inventory.retrievedAt,
    producerModel: chooseEventAiModel(candidates, workspaceDefaults.producerModel || EVENT_AI_PRODUCER_MODEL),
    verifierModel: chooseEventAiModel(candidates, workspaceDefaults.verifierModel || EVENT_AI_VERIFIER_MODEL),
    workspaceDefaults,
  };
}

async function failEventAiJob(db, row, error) {
  const now = new Date().toISOString();
  await db.prepare("UPDATE dbi_event_ai_jobs SET status = 'failed', error_code = ?, error_message = ?, updated_at = ?, completed_at = ? WHERE id = ?")
    .bind(cleanText(error?.code, 120) || "event_ai_failed", safeLogText(error?.message, 500) || "Event enrichment failed.", now, now, row.id).run();
  return db.prepare("SELECT * FROM dbi_event_ai_jobs WHERE id = ?").bind(row.id).first();
}

async function logEventAiProviderResult(db, row, response, stage, status, latencyMs, requestId, error = null, method = "POST", evidenceDiagnostic = null) {
  const usage = response?.usage || {};
  await recordApiRequest(db, {
    workspaceId: row.workspace_id,
    userId: row.user_id,
    principalType: "user",
    principalId: row.user_id,
    requestKind: "openai",
    provider: "openai",
    operation: stage === "research" ? "event_enrichment.research" : "event_enrichment.verify",
    method,
    route: method === "GET" ? `/v1/responses/${response?.id || (stage === "research" ? row.producer_response_id : row.verifier_response_id)}` : "/v1/responses",
    status,
    httpStatus: error?.httpStatus || (status === "succeeded" || method === "GET" ? 200 : 202),
    stage,
    model: stage === "research" ? row.producer_model : row.verifier_model,
    credentialId: row.credential_id === "mock-credential" ? "" : row.credential_id,
    credentialScope: row.credential_scope,
    providerRequestId: requestId || "",
    traceId: row.trace_id,
    responseId: response?.id || "",
    latencyMs,
    inputTokens: Number(usage.input_tokens || 0),
    outputTokens: Number(usage.output_tokens || 0),
    retryCount: Number(row.retry_count || 0),
    retryable: isRetryableEventAiError(error),
    errorCode: error?.code || "",
    errorMessage: error?.message || "",
    metadata: { jobId: row.id, workflow: "event_enrichment", evidence: error?.diagnostic || evidenceDiagnostic || null },
  });
}

async function finalizeEventAiOutcome(db, row, draft, verification, outcome, now) {
  const changes = outcome.mergeResult?.changes || [];
  const eventId = cleanText(draft?.id, 180);
  const preference = eventId ? await db.prepare(`SELECT auto_accept_event_augmentations
    FROM dbi_workspace_ai_preferences WHERE workspace_id = ?`).bind(row.workspace_id).first() : null;
  const safeToApply = Boolean(preference?.auto_accept_event_augmentations && changes.length && !eventAiReviewRisks(verification, outcome));
  let application = {
    mode: preference?.auto_accept_event_augmentations ? "automatic" : "manual",
    status: changes.length || eventAiReviewRisks(verification, outcome) ? "pending_validation" : "no_changes",
    appliedAt: null,
    reason: preference?.auto_accept_event_augmentations ? "review_required" : "workspace_auto_accept_disabled",
  };
  if (safeToApply) {
    const result = await applyVerifiedEventDraft(db, row, outcome.mergeResult.mergedDraft, now);
    application = result.applied
      ? { mode: "automatic", status: "applied", appliedAt: now, reason: "verified_additive_changes" }
      : { mode: "automatic", status: "pending_validation", appliedAt: null, reason: result.reason };
  } else if (!changes.length && !eventAiReviewRisks(verification, outcome)) {
    application = { mode: preference?.auto_accept_event_augmentations ? "automatic" : "manual", status: "no_changes", appliedAt: null, reason: "event_already_current" };
  }
  const validationRequired = application.status === "pending_validation";
  await writeEventAiState(db, {
    workspaceId: row.workspace_id,
    eventId,
    jobId: row.id,
    status: outcome.status,
    augmentedAt: now,
    appliedAt: application.appliedAt || "",
    validationRequired,
  });
  if (application.status === "applied") {
    await recordActivity(db, { type: "user", id: row.user_id, workspaceId: row.workspace_id }, "event_ai_auto_applied", "event", eventId, { jobId: row.id, changes });
  }
  return { ...outcome, mergeResult: { ...outcome.mergeResult, application }, validationRequired };
}

async function advanceEventAiJob(db, row, env) {
  if (["completed", "needs_review", "failed", "cancelled"].includes(row.status)) return row;
  const categories = (() => { try { return JSON.parse(row.categories_json || "[]"); } catch { return []; } })();
  const draft = (() => { try { return JSON.parse(row.input_snapshot_json || "{}"); } catch { return {}; } })();
  const mockMode = String(env.DBI_EVENT_AI_MOCK_MODE || "").toLowerCase() === "true";
  const credential = await resolveEventAiCredential(db, { user_id: row.user_id, active_workspace_id: row.workspace_id }, row.credential_scope, row.credential_id, env);
  if (!credential) return failEventAiJob(db, row, { code: "credential_unavailable", message: "The selected OpenAI credential is unavailable or could not be decrypted." });
  let providerResponse = null;
  let providerLatencyMs = 0;
  let providerRequestId = "";
  try {
    if (row.status === "researching") {
      let proposal;
      let proposalDiagnostic = null;
      if (mockMode) {
        providerResponse = row.direction === "__mock_provider_failure__"
          ? { id: row.producer_response_id || `mock-producer-${row.id}`, status: "failed", error: { code: "rate_limit_exceeded", message: "Verification-only provider rate limit." }, usage: { input_tokens: 0, output_tokens: 0 } }
          : { id: row.producer_response_id || `mock-producer-${row.id}`, status: "completed", usage: { input_tokens: 120, output_tokens: 80 } };
        if (providerResponse.status !== "completed") throw eventAiProviderError(providerResponse, "Research");
        const mockProposal = mockEventAiProposal(draft, categories);
        if (row.direction === "__mock_missing_citations__") {
          providerResponse.output = [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(mockProposal), annotations: [] }] }];
          proposalDiagnostic = eventAiEvidenceDiagnostic(providerResponse, mockProposal);
          proposal = citedEventAiDetails(providerResponse, mockProposal, draft);
        } else proposal = mockProposal;
      } else {
        const retrieved = await retrieveOpenAiResponse(credential.apiKey, row.producer_response_id);
        providerResponse = retrieved.response;
        providerLatencyMs = retrieved.latencyMs;
        providerRequestId = retrieved.requestId;
        if (["queued", "in_progress"].includes(providerResponse.status)) {
          return row;
        }
        if (providerResponse.status !== "completed") throw eventAiProviderError(providerResponse, "Research");
        const parsedProposal = parseOpenAiStructuredResponse(providerResponse, normalizeEventAiDetails);
        proposalDiagnostic = eventAiEvidenceDiagnostic(providerResponse, parsedProposal);
        proposal = citedEventAiDetails(providerResponse, parsedProposal, draft);
      }
      await logEventAiProviderResult(db, row, providerResponse, "research", "succeeded", providerLatencyMs, providerRequestId, null, "GET", proposalDiagnostic || (mockMode ? { searchQueries: [`${draft.title || "event"} official event details`], webSearchCallCount: 1, searchSourceCount: proposal.sources?.length || 0, structuredSourceCount: proposal.sources?.length || 0, matchedSourceCount: proposal.sources?.length || 0, matchedEvidenceCount: proposal.evidence?.length || 0 } : eventAiEvidenceDiagnostic(providerResponse, proposal)));
      if (!mockMode) await deleteOpenAiResponse(credential.apiKey, row.producer_response_id).catch(() => false);
      let verifierResponseId = `mock-verifier-${row.id}`;
      if (!mockMode) {
        const started = await startOpenAiBackgroundResponse(credential.apiKey, buildEventAiVerifierRequest({ draft, proposal, direction: row.direction, categories, model: row.verifier_model }));
        verifierResponseId = started.response.id;
        await logEventAiProviderResult(db, row, started.response, "verification", "accepted", started.latencyMs, started.requestId);
      }
      const now = new Date().toISOString();
      await db.prepare("UPDATE dbi_event_ai_jobs SET status = 'verifying', current_step = 'independent_verification', proposal_json = ?, verifier_response_id = ?, updated_at = ? WHERE id = ?")
        .bind(JSON.stringify(proposal), verifierResponseId, now, row.id).run();
      return db.prepare("SELECT * FROM dbi_event_ai_jobs WHERE id = ?").bind(row.id).first();
    }

    if (row.status === "verifying") {
      const proposal = (() => { try { return JSON.parse(row.proposal_json || "{}"); } catch { return {}; } })();
      let verification;
      if (mockMode) {
        verification = mockEventAiVerification(proposal);
        providerResponse = { id: row.verifier_response_id || `mock-verifier-${row.id}`, status: "completed", usage: { input_tokens: 100, output_tokens: 70 } };
      } else {
        const retrieved = await retrieveOpenAiResponse(credential.apiKey, row.verifier_response_id);
        providerResponse = retrieved.response;
        providerLatencyMs = retrieved.latencyMs;
        providerRequestId = retrieved.requestId;
        if (["queued", "in_progress"].includes(providerResponse.status)) {
          return row;
        }
        if (providerResponse.status !== "completed") throw eventAiProviderError(providerResponse, "Verification");
        verification = parseOpenAiStructuredResponse(providerResponse, (value) => ({
          decision: ["approved", "needs_review", "rejected"].includes(value?.decision) ? value.decision : "rejected",
          approved: citedEventAiDetails(providerResponse, value?.approved, draft, { trustedSourceUrls: proposal.groundedSourceUrls || proposal.sources?.map((source) => source.url) || [] }),
          checks: Array.isArray(value?.checks) ? value.checks.slice(0, 12) : [],
          rejectedClaims: Array.isArray(value?.rejectedClaims) ? value.rejectedClaims.slice(0, 30) : [],
          mergeNotes: Array.isArray(value?.mergeNotes) ? value.mergeNotes.slice(0, 20) : [],
        }));
      }
      await logEventAiProviderResult(db, row, providerResponse, "verification", "succeeded", providerLatencyMs, providerRequestId, null, "GET", mockMode ? { searchQueries: [`${draft.title || "event"} verify official dates and venue`], webSearchCallCount: 1, searchSourceCount: proposal.sources?.length || 0, structuredSourceCount: proposal.sources?.length || 0, matchedSourceCount: proposal.sources?.length || 0, matchedEvidenceCount: verification.approved?.length || 0 } : eventAiEvidenceDiagnostic(providerResponse, verification.approved));
      if (!mockMode) await deleteOpenAiResponse(credential.apiKey, row.verifier_response_id).catch(() => false);
      const now = new Date().toISOString();
      const outcome = await finalizeEventAiOutcome(db, row, draft, verification, resolveEventAiVerificationOutcome({ draft, verification, categories }), now);
      await db.prepare("UPDATE dbi_event_ai_jobs SET status = ?, current_step = ?, verification_json = ?, merge_result_json = ?, updated_at = ?, completed_at = ? WHERE id = ?")
        .bind(outcome.status, outcome.currentStep, JSON.stringify(verification), JSON.stringify(outcome.mergeResult), now, now, row.id).run();
      await db.prepare("UPDATE dbi_openai_keys SET last_used_at = ?, updated_at = ? WHERE id = ?").bind(now, now, row.credential_id).run();
      await recordActivity(db, { type: "user", id: row.user_id, workspaceId: row.workspace_id }, "event_ai_completed", "event_ai_job", row.id, { status: outcome.status, changes: outcome.mergeResult.changes || [] });
      return db.prepare("SELECT * FROM dbi_event_ai_jobs WHERE id = ?").bind(row.id).first();
    }
  } catch (error) {
    await logEventAiProviderResult(db, row, providerResponse, row.status === "researching" ? "research" : "verification", "failed", providerLatencyMs, providerRequestId, error, "GET").catch(() => {});
    return failEventAiJob(db, row, error);
  }
  return row;
}

async function eventAiResponse(request, db, env) {
  if (!sameOriginRequest(request)) return json({ error: "Cross-origin AI requests are not allowed" }, 403);
  const session = await sessionUser(db, request);
  if (!session) return json({ error: "Sign in required" }, 401);
  if (!session.active_workspace_id) return json({ error: "Select a workspace before using AI assistance" }, 409);
  const pathname = new URL(request.url).pathname.replace(/\/+$/, "");
  const prefix = "/api/v1/auth/event-ai";
  const suffix = pathname.slice(prefix.length).replace(/^\//, "");
  if (request.method === "GET" && suffix === "capability") return json({ capability: await eventAiCredentialCapability(db, session, env) });
  if (!canRunEventAi(session)) return json({ error: "Event write access is required" }, 403);

  if (request.method === "GET" && suffix === "models") {
    const url = new URL(request.url);
    const credentialScope = url.searchParams.get("credentialScope") === "workspace" ? "workspace" : "user";
    try {
      const inventory = await eventAiModelInventory(db, session, credentialScope, cleanText(url.searchParams.get("credentialId"), 100), env);
      return json({ inventory: {
        models: inventory.models,
        inventoryCount: inventory.inventoryCount,
        retrievedAt: inventory.retrievedAt,
        producerModel: inventory.producerModel,
        verifierModel: inventory.verifierModel,
        workspaceDefaults: inventory.workspaceDefaults,
        credentialScope: inventory.credential.scope,
        source: "openai_models_api",
        capabilityNotice: "Availability is credential-specific. Compatibility with web search and structured outputs is proven when the workflow runs.",
      } });
    } catch (error) {
      return json({ error: safeLogText(error?.message, 500) || "OpenAI model inventory is unavailable", code: cleanText(error?.code, 120) }, error?.httpStatus || 502);
    }
  }

  if (request.method === "PATCH" && suffix === "model-defaults") {
    if (!canAdministerWorkspaces(session)) return json({ error: "Workspace manager access is required" }, 403);
    const body = await safeJson(request);
    try {
      const inventory = await eventAiModelInventory(db, session, "workspace", "", env);
      const producerModel = cleanText(body?.producerModel, 180);
      const verifierModel = cleanText(body?.verifierModel, 180);
      assertEventAiModels(inventory.models, producerModel, verifierModel);
      const now = new Date().toISOString();
      await db.prepare(`INSERT INTO dbi_workspace_ai_settings
        (workspace_id, event_research_model, event_verification_model, updated_by, updated_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(workspace_id) DO UPDATE SET event_research_model = excluded.event_research_model,
          event_verification_model = excluded.event_verification_model, updated_by = excluded.updated_by, updated_at = excluded.updated_at`)
        .bind(session.active_workspace_id, producerModel, verifierModel, session.user_id, now).run();
      await recordActivity(db, { type: "user", id: session.user_id, workspaceId: session.active_workspace_id }, "event_ai_models_updated", "workspace_ai_settings", session.active_workspace_id, { producerModel, verifierModel });
      return json({ defaults: { producerModel, verifierModel, updatedAt: now } });
    } catch (error) {
      return json({ error: safeLogText(error?.message, 500) || "Workspace model defaults could not be saved", code: cleanText(error?.code, 120) }, error?.httpStatus || 502);
    }
  }

  if (request.method === "GET" && !suffix) {
    const result = await db.prepare(EVENT_AI_RECENT_JOBS_SELECT).bind(session.active_workspace_id, session.user_id).all();
    return json({ jobs: (result.results || []).map(eventAiJobFromRow) });
  }

  if (request.method === "POST" && !suffix) {
    const body = await safeJson(request);
    const draft = normalizeEventAiDraft(body?.draft || {});
    const direction = cleanText(body?.direction, 2000);
    const credentialScope = body?.credentialScope === "workspace" ? "workspace" : "user";
    if (draft.title.length < 2) return json({ error: "Enter an event name before starting AI research" }, 400);
    const active = await db.prepare("SELECT COUNT(*) AS count FROM dbi_event_ai_jobs WHERE workspace_id = ? AND user_id = ? AND status IN ('researching', 'verifying')").bind(session.active_workspace_id, session.user_id).first();
    if (Number(active?.count || 0) >= 3) return json({ error: "Wait for an active event-enrichment job to finish before starting another" }, 429);
    const daily = await db.prepare("SELECT COUNT(*) AS count FROM dbi_event_ai_jobs WHERE workspace_id = ? AND user_id = ? AND created_at >= ?")
      .bind(session.active_workspace_id, session.user_id, new Date(Date.now() - 86400000).toISOString()).first();
    if (Number(daily?.count || 0) >= 20) return json({ error: "Daily event-enrichment limit reached; try again after the oldest job is 24 hours old" }, 429);
    let inventory;
    try {
      inventory = await eventAiModelInventory(db, session, credentialScope, cleanText(body?.credentialId, 100), env);
    } catch (error) {
      return json({ error: safeLogText(error?.message, 500) || "OpenAI model inventory is unavailable", code: cleanText(error?.code, 120) }, error?.httpStatus || 502);
    }
    const credential = inventory.credential;
    const producerModel = cleanText(body?.producerModel, 180) || inventory.producerModel;
    const verifierModel = cleanText(body?.verifierModel, 180) || inventory.verifierModel;
    try { assertEventAiModels(inventory.models, producerModel, verifierModel); }
    catch (error) { return json({ error: error.message, code: error.code }, error.httpStatus || 409); }
    const categories = await eventAiCategories(db, session.active_workspace_id);
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const traceId = crypto.randomUUID();
    const mockMode = String(env.DBI_EVENT_AI_MOCK_MODE || "").toLowerCase() === "true";
    await db.prepare(`INSERT INTO dbi_event_ai_jobs
      (id, workspace_id, user_id, status, current_step, credential_id, credential_scope, producer_model, verifier_model,
       producer_response_id, verifier_response_id, direction, input_snapshot_json, categories_json, proposal_json,
       verification_json, merge_result_json, error_code, error_message, retry_count, trace_id, created_at, updated_at, completed_at)
      VALUES (?, ?, ?, 'researching', 'public_research', ?, ?, ?, ?, '', '', ?, ?, ?, '{}', '{}', '{}', '', '', 0, ?, ?, ?, '')`)
      .bind(id, session.active_workspace_id, session.user_id, credential.id, credential.scope, producerModel, verifierModel,
        direction, JSON.stringify(draft), JSON.stringify(categories), traceId, now, now).run();
    let row = await db.prepare("SELECT * FROM dbi_event_ai_jobs WHERE id = ?").bind(id).first();
    if (!mockMode) {
      try {
        const started = await startOpenAiBackgroundResponse(credential.apiKey, buildEventAiProducerRequest({ draft, direction, categories, model: producerModel }));
        await db.prepare("UPDATE dbi_event_ai_jobs SET producer_response_id = ?, updated_at = ? WHERE id = ?").bind(started.response.id, new Date().toISOString(), id).run();
        row = await db.prepare("SELECT * FROM dbi_event_ai_jobs WHERE id = ?").bind(id).first();
        await logEventAiProviderResult(db, row, started.response, "research", "accepted", started.latencyMs, started.requestId);
      } catch (error) {
        row = await failEventAiJob(db, row, error);
        await logEventAiProviderResult(db, row, null, "research", "failed", 0, "", error).catch(() => {});
      }
    } else {
      await db.prepare("UPDATE dbi_event_ai_jobs SET producer_response_id = ?, updated_at = ? WHERE id = ?").bind(`mock-producer-${id}`, now, id).run();
      row = await db.prepare("SELECT * FROM dbi_event_ai_jobs WHERE id = ?").bind(id).first();
    }
    await recordActivity(db, { type: "user", id: session.user_id, workspaceId: session.active_workspace_id }, "event_ai_started", "event_ai_job", id, { credentialScope, producerModel, verifierModel });
    return json({ job: eventAiJobFromRow(row) }, 202);
  }

  const jobId = cleanText(decodeURIComponent(suffix), 100);
  const row = jobId ? await db.prepare("SELECT * FROM dbi_event_ai_jobs WHERE id = ? AND workspace_id = ? AND user_id = ?").bind(jobId, session.active_workspace_id, session.user_id).first() : null;
  if (!row) return json({ error: "Event-enrichment job not found" }, 404);
  if (request.method === "GET") {
    const advanced = await advanceEventAiJob(db, row, env);
    const decorated = await eventAiJobWithDiagnostic(db, advanced.id, session.active_workspace_id, session.user_id);
    return json({ job: eventAiJobFromRow(decorated || advanced) });
  }
  return json({ error: "Method not allowed" }, 405);
}

async function agentKeysResponse(request, db) {
  if (!sameOriginRequest(request)) return json({ error: "Cross-origin credential management is not allowed" }, 403);
  const session = await sessionUser(db, request);
  if (!session) return json({ error: "Sign in required" }, 401);
  if (!canAdministerWorkspaces(session)) return json({ error: "Workspace manager access is required" }, 403);
  if (!session.active_workspace_id) return json({ error: "Select a workspace before managing agent credentials" }, 409);
  const workspaceId = session.active_workspace_id;
  const pathname = new URL(request.url).pathname.replace(/\/+$/, "");
  const prefix = "/api/v1/auth/agent-keys";
  const keyId = cleanText(decodeURIComponent(pathname.slice(prefix.length).replace(/^\//, "")), 80);
  if (request.method === "GET" && !keyId) {
    const result = await db.prepare("SELECT * FROM dbi_workspace_agent_keys WHERE workspace_id = ? ORDER BY created_at DESC").bind(workspaceId).all();
    return json({ keys: (result.results || []).map(publicAgentKey), availableScopes: AGENT_SCOPES });
  }
  if (request.method === "POST" && !keyId) {
    const body = await safeJson(request);
    const name = cleanText(body?.name, 80);
    const scopes = cleanStringArray(body?.scopes).filter((scope) => AGENT_SCOPES.includes(scope));
    const expiresInput = cleanText(body?.expiresAt, 64);
    const expiresDate = expiresInput ? new Date(expiresInput) : null;
    const expiresAt = expiresDate && !Number.isNaN(expiresDate.getTime()) ? expiresDate.toISOString() : "";
    if (name.length < 2 || !scopes.length) return json({ error: "A name and at least one valid scope are required" }, 400);
    if (expiresInput && (!expiresAt || expiresDate.getTime() <= Date.now())) return json({ error: "Expiration must be a valid future date and time" }, 400);
    const active = await db.prepare("SELECT COUNT(*) AS count FROM dbi_workspace_agent_keys WHERE workspace_id = ? AND revoked_at = '' AND (expires_at = '' OR expires_at > ?)").bind(workspaceId, new Date().toISOString()).first();
    if (Number(active?.count || 0) >= 25) return json({ error: "Revoke an existing agent credential before creating another" }, 409);
    const id = crypto.randomUUID();
    const token = `${AGENT_TOKEN_PREFIX}${id}.${randomHex(32)}`;
    const now = new Date().toISOString();
    await db.prepare(`
      INSERT INTO dbi_workspace_agent_keys
        (id, workspace_id, name, token_hash, scopes_json, created_by, created_at, last_used_at, expires_at, revoked_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, '', ?, '')
    `).bind(id, workspaceId, name, await hashValue(token), JSON.stringify(scopes), session.user_id, now, expiresAt).run();
    await recordActivity(db, { type: "user", id: session.user_id, workspaceId }, "agent_key_created", "agent_key", id, { name, scopes });
    return json({ key: { id, name, scopes, createdAt: now, expiresAt: expiresAt || null }, token }, 201);
  }
  if (request.method === "DELETE" && keyId) {
    const now = new Date().toISOString();
    const changed = await db.prepare("UPDATE dbi_workspace_agent_keys SET revoked_at = ? WHERE id = ? AND workspace_id = ? AND revoked_at = ''")
      .bind(now, keyId, workspaceId).run();
    if (!Number(changed?.meta?.changes || 0)) return json({ error: "Agent credential not found or already revoked" }, 404);
    await recordActivity(db, { type: "user", id: session.user_id, workspaceId }, "agent_key_revoked", "agent_key", keyId);
    return json({ ok: true });
  }
  return json({ error: "Method not allowed" }, 405);
}

async function assetJson(request, env, path) {
  const url = new URL(path, request.url);
  const response = env.ASSETS?.fetch ? await env.ASSETS.fetch(new Request(url)) : await fetch(url);
  if (!response.ok) throw new Error(`Runtime data unavailable: ${path}`);
  return response.json();
}

function manualRecordPayload(body, id, version, createdAt, updatedAt) {
  const title = cleanText(body?.title, 240);
  if (title.length < 3) return null;
  const workCategories = cleanStringArray(body?.workCategories, 3, 80);
  const sourceUrls = cleanStringArray(body?.sourceUrls, 20, 1000).filter((value) => /^https:\/\//i.test(value));
  return {
    opportunityId: id,
    id: cleanText(body?.id, 100) || id.replace("manual_agent_", "MAN-").slice(0, 24),
    title,
    context: cleanText(body?.context, 2000),
    portfolio: cleanText(body?.portfolio, 160) || "Manual agent import",
    party: cleanText(body?.party, 200),
    owner: cleanText(body?.owner, 200),
    fundingOffice: cleanText(body?.fundingOffice, 200),
    contractingOffice: cleanText(body?.contractingOffice, 200),
    reference: cleanText(body?.reference, 160),
    parentReference: cleanText(body?.parentReference, 160),
    sourceSystem: cleanText(body?.sourceSystem, 120) || "agent-api",
    sourceUrls,
    start: cleanDate(body?.start),
    currentEnd: cleanDate(body?.currentEnd),
    potentialEnd: cleanDate(body?.potentialEnd),
    solicitationStart: cleanDate(body?.solicitationStart),
    solicitationEnd: cleanDate(body?.solicitationEnd),
    obligatedAmount: Number.isFinite(Number(body?.obligatedAmount)) ? Number(body.obligatedAmount) : 0,
    potentialAmount: Number.isFinite(Number(body?.potentialAmount)) ? Number(body.potentialAmount) : 0,
    workCategory: cleanText(body?.workCategory, 80) || workCategories[0] || "other-unclassified",
    workCategories,
    workCategoryBasis: cleanText(body?.workCategoryBasis, 500) || "Operator-supplied manual classification",
    workCategoryConfidence: "manual",
    ingestionMethod: "manual",
    ingestionLabel: "Agent API manual import",
    ingestionChannels: [{ id: "agent-api", label: "Authenticated agent API", method: "manual" }],
    evidenceTier: "operator-entered",
    lifecycleStatus: cleanText(body?.lifecycleStatus, 100) || "schedule-not-published",
    manual: true,
    version,
    createdAt,
    updatedAt,
  };
}

async function allAgentRecords(request, env, db, workspaceId) {
  const source = await assetJson(request, env, "/data/agent-records.json");
  const stored = await db.prepare("SELECT * FROM dbi_workspace_manual_records WHERE workspace_id = ? AND deleted_at = '' ORDER BY created_at").bind(workspaceId).all();
  const manual = (stored.results || []).flatMap((row) => {
    try { return [{ ...JSON.parse(row.payload_json), version: row.version, createdAt: row.created_at, updatedAt: row.updated_at, manual: true }]; }
    catch { return []; }
  });
  return { metadata: source.metadata || {}, records: [...(source.records || []), ...manual] };
}

function recordProjection(record) {
  return {
    opportunityId: record.opportunityId,
    id: record.id,
    title: record.title,
    portfolio: record.portfolio,
    party: record.party,
    owner: record.owner,
    reference: record.reference,
    sourceSystem: record.sourceSystem,
    sourceUrls: record.sourceUrls || [],
    workCategory: record.workCategory,
    workCategories: record.workCategories || [],
    technologyAreas: record.technologyAreas || [],
    organization: record.organization || null,
    ingestionMethod: record.ingestionMethod,
    lifecycleStatus: record.lifecycleStatus,
    evidenceTier: record.evidenceTier,
    start: record.start,
    currentEnd: record.currentEnd,
    potentialEnd: record.potentialEnd,
    solicitationStart: record.solicitationStart,
    solicitationEnd: record.solicitationEnd,
    obligatedAmount: Number(record.obligatedAmount || record.fpdsObligatedAmount || 0),
    potentialAmount: Number(record.potentialAmount || record.fpdsPotentialAmount || 0),
    manual: Boolean(record.manual),
    firstSeenAt: record.firstSeenAt || null,
    lastSeenAt: record.lastSeenAt || null,
    lastChangedAt: record.lastChangedAt || null,
    sourcePublishedAt: record.sourcePublishedAt || null,
    sourceUpdatedAt: record.sourceUpdatedAt || null,
    version: Number(record.version || 0),
    updatedAt: record.updatedAt || record.validationCheckedAt || null,
  };
}

function trackingFromRow(row) {
  return {
    recordId: row.record_id, note: row.note || "", reviewAt: row.review_at || "",
    wallboard: Boolean(row.wallboard), version: row.version,
    starredAt: row.created_at, createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

function expectedVersion(request, body) {
  const header = cleanText(request.headers.get("if-match"), 32).replaceAll('"', "");
  const candidate = header || body?.version;
  return candidate === undefined || candidate === null || candidate === "" ? null : Number(candidate);
}

async function idempotent(db, principal, request, handler) {
  const key = cleanText(request.headers.get("idempotency-key"), 180);
  if (!key) return agentError("idempotency_key_required", "Idempotency-Key is required for this operation", 400);
  const fingerprint = await hashValue(`${request.method}|${new URL(request.url).pathname}|${await request.clone().text()}`);
  const principalKey = `${principal.workspaceId}:${principal.id}`;
  const existing = await db.prepare(`
    SELECT * FROM dbi_agent_idempotency WHERE principal_id = ? AND idempotency_key = ?
  `).bind(principalKey, key).first();
  if (existing) {
    if (existing.request_fingerprint !== fingerprint) return agentError("idempotency_conflict", "This idempotency key was used for a different request", 409);
    return new Response(existing.response_body, { status: existing.response_status, headers: { "content-type": "application/json", "cache-control": "no-store", "idempotent-replay": "true" } });
  }
  const response = await handler();
  if (response.status < 500) {
    await db.prepare(`
      INSERT INTO dbi_agent_idempotency
        (principal_id, idempotency_key, request_fingerprint, response_status, response_body, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).bind(principalKey, key, fingerprint, response.status, await response.clone().text(), new Date().toISOString()).run();
  }
  return response;
}

const ANALYTICS_DIMENSIONS = Object.freeze([
  "portfolio", "party", "owner", "fundingOffice", "contractingOffice", "workCategory",
  "technologyArea", "organizationBranch", "organizationComponent", "organizationOffice",
  "sourceSystem", "lifecycleStatus", "evidenceTier",
]);
const ANALYTICS_MEASURES = Object.freeze(["records", "obligatedAmount", "potentialAmount"]);

async function analyticsResponse(request, env, db, principal) {
  if (request.method !== "GET") return agentError("method_not_allowed", "Method not allowed", 405);
  if (!hasScope(principal, "records:read")) return agentError("insufficient_scope", "Scope records:read is required", 403);
  const params = new URL(request.url).searchParams;
  const dimensionCandidate = cleanText(params.get("dimension"), 40);
  const measureCandidate = cleanText(params.get("measure"), 40);
  const dimension = ANALYTICS_DIMENSIONS.includes(dimensionCandidate) ? dimensionCandidate : "portfolio";
  const measure = ANALYTICS_MEASURES.includes(measureCandidate) ? measureCandidate : "records";
  const query = cleanText(params.get("q"), 200).toLowerCase();
  const category = cleanText(params.get("workCategory"), 80);
  const source = cleanText(params.get("sourceSystem"), 120).toLowerCase();
  const lifecycle = cleanText(params.get("lifecycleStatus"), 100);
  const trackedOnly = params.get("tracked") === "true";
  const trackedRows = trackedOnly ? await db.prepare("SELECT record_id FROM dbi_workspace_watchlist WHERE workspace_id = ?").bind(principal.workspaceId).all() : { results: [] };
  const tracked = new Set((trackedRows.results || []).map((row) => row.record_id));
  const universe = await allAgentRecords(request, env, db, principal.workspaceId);
  const records = universe.records.filter((record) => {
    if (query && ![record.id, record.title, record.party, record.owner, record.reference, record.portfolio].join(" ").toLowerCase().includes(query)) return false;
    if (category && record.workCategory !== category && !(record.workCategories || []).includes(category)) return false;
    if (source && !String(record.sourceSystem || "").toLowerCase().includes(source)) return false;
    if (lifecycle && record.lifecycleStatus !== lifecycle) return false;
    if (trackedOnly && !tracked.has(record.opportunityId)) return false;
    return true;
  });
  const dimensionValues = (record) => {
    if (dimension === "technologyArea") return record.technologyAreas?.length ? record.technologyAreas : ["Unclassified"];
    if (dimension === "organizationBranch") return [record.organization?.branch || "Not published"];
    if (dimension === "organizationComponent") return [record.organization?.component || "Not published"];
    if (dimension === "organizationOffice") return [record.organization?.office || "Not published"];
    return [record[dimension] || "Not published"];
  };
  const groups = new Map();
  for (const record of records) {
    for (const value of dimensionValues(record)) {
      const label = cleanText(value, 240) || "Not published";
      const current = groups.get(label) || { key: label, records: 0, obligatedAmount: 0, potentialAmount: 0 };
      current.records += 1;
      current.obligatedAmount += Number(record.obligatedAmount || record.fpdsObligatedAmount || 0);
      current.potentialAmount += Number(record.potentialAmount || record.fpdsPotentialAmount || 0);
      groups.set(label, current);
    }
  }
  const limit = boundedInteger(params.get("limit"), 25, 1, 100);
  const rows = [...groups.values()].sort((left, right) => right[measure] - left[measure] || left.key.localeCompare(right.key)).slice(0, limit);
  return agentJson(rows, 200, {
    dimension,
    measure,
    totalRecords: records.length,
    totalGroups: groups.size,
    totalObligatedAmount: records.reduce((sum, record) => sum + Number(record.obligatedAmount || record.fpdsObligatedAmount || 0), 0),
    totalPotentialAmount: records.reduce((sum, record) => sum + Number(record.potentialAmount || record.fpdsPotentialAmount || 0), 0),
    sourceAsOf: universe.metadata?.asOf || null,
    availableDimensions: ANALYTICS_DIMENSIONS,
    availableMeasures: ANALYTICS_MEASURES,
  });
}

async function recordsResponse(request, env, db, principal, segments) {
  const scope = request.method === "GET" ? "records:read" : "records:write";
  if (!hasScope(principal, scope)) return agentError("insufficient_scope", `Scope ${scope} is required`, 403);
  const recordId = cleanText(decodeURIComponent(segments[0] || ""), 180);
  const universe = await allAgentRecords(request, env, db, principal.workspaceId);
  if (request.method === "GET" && recordId) {
    const record = universe.records.find((item) => item.opportunityId === recordId);
    return record ? agentJson(record) : agentError("record_not_found", "Record not found", 404);
  }
  if (request.method === "GET") {
    const params = new URL(request.url).searchParams;
    const query = cleanText(params.get("q"), 200).toLowerCase();
    const category = cleanText(params.get("workCategory"), 80);
    const source = cleanText(params.get("sourceSystem"), 120).toLowerCase();
    const lifecycle = cleanText(params.get("lifecycleStatus"), 100);
    const trackedOnly = params.get("tracked") === "true";
    const trackedRows = trackedOnly ? await db.prepare("SELECT record_id FROM dbi_workspace_watchlist WHERE workspace_id = ?").bind(principal.workspaceId).all() : { results: [] };
    const tracked = new Set((trackedRows.results || []).map((row) => row.record_id));
    let rows = universe.records.filter((record) => {
      if (query && ![record.id, record.title, record.party, record.owner, record.reference, record.portfolio].join(" ").toLowerCase().includes(query)) return false;
      if (category && record.workCategory !== category && !(record.workCategories || []).includes(category)) return false;
      if (source && !String(record.sourceSystem || "").toLowerCase().includes(source)) return false;
      if (lifecycle && record.lifecycleStatus !== lifecycle) return false;
      if (trackedOnly && !tracked.has(record.opportunityId)) return false;
      return true;
    });
    const sort = cleanText(params.get("sort"), 40) || "title";
    const direction = params.get("direction") === "desc" ? -1 : 1;
    rows.sort((left, right) => {
      if (["obligatedAmount", "potentialAmount"].includes(sort)) return (Number(left[sort] || 0) - Number(right[sort] || 0)) * direction;
      return String(left[sort] || "").localeCompare(String(right[sort] || "")) * direction;
    });
    const total = rows.length;
    const offset = boundedInteger(params.get("cursor"), 0, 0, 1_000_000);
    const limit = boundedInteger(params.get("limit"), 50, 1, 200);
    rows = rows.slice(offset, offset + limit).map(recordProjection);
    return agentJson(rows, 200, { total, limit, cursor: offset, nextCursor: offset + rows.length < total ? String(offset + rows.length) : null, sourceAsOf: universe.metadata?.asOf || null });
  }
  if (request.method === "POST" && !recordId) return idempotent(db, principal, request, async () => {
    const body = await safeJson(request, 131_072);
    const now = new Date().toISOString();
    const id = `manual_agent_${crypto.randomUUID()}`;
    const payload = manualRecordPayload(body, id, 1, now, now);
    if (!payload) return agentError("invalid_record", "A title of at least three characters is required", 400);
    await db.prepare(`INSERT INTO dbi_workspace_manual_records (id, workspace_id, payload_json, version, created_at, updated_at, deleted_at) VALUES (?, ?, ?, 1, ?, ?, '')`)
      .bind(id, principal.workspaceId, JSON.stringify(payload), now, now).run();
    await recordActivity(db, principal, "record_created", "manual_record", id, { title: payload.title });
    return agentJson(payload, 201);
  });
  const stored = recordId ? await db.prepare("SELECT * FROM dbi_workspace_manual_records WHERE id = ? AND workspace_id = ? AND deleted_at = ''").bind(recordId, principal.workspaceId).first() : null;
  if (!stored) return agentError("source_record_immutable", "Only manual Agent API records can be changed; source-backed evidence is read-only", 409);
  if (request.method === "PATCH") {
    const body = await safeJson(request, 131_072);
    const version = expectedVersion(request, body);
    if (version === null) return agentError("precondition_required", "If-Match with the current record version is required", 428);
    if (version !== null && version !== Number(stored.version)) return agentError("version_conflict", "Record changed since the supplied version", 409, undefined, { currentVersion: stored.version });
    const current = JSON.parse(stored.payload_json);
    const now = new Date().toISOString();
    const payload = manualRecordPayload({ ...current, ...body }, recordId, Number(stored.version) + 1, stored.created_at, now);
    if (!payload) return agentError("invalid_record", "A title of at least three characters is required", 400);
    await db.prepare("UPDATE dbi_workspace_manual_records SET payload_json = ?, version = version + 1, updated_at = ? WHERE id = ? AND workspace_id = ?")
      .bind(JSON.stringify(payload), now, recordId, principal.workspaceId).run();
    await recordActivity(db, principal, "record_updated", "manual_record", recordId, { version: payload.version });
    return agentJson(payload);
  }
  if (request.method === "DELETE") {
    const now = new Date().toISOString();
    await db.prepare("UPDATE dbi_workspace_manual_records SET deleted_at = ?, updated_at = ?, version = version + 1 WHERE id = ? AND workspace_id = ?")
      .bind(now, now, recordId, principal.workspaceId).run();
    await recordActivity(db, principal, "record_deleted", "manual_record", recordId);
    return new Response(null, { status: 204 });
  }
  return agentError("method_not_allowed", "Method not allowed", 405);
}

async function trackingResponse(request, env, db, principal, segments) {
  const scope = request.method === "GET" ? "tracking:read" : "tracking:write";
  if (!hasScope(principal, scope)) return agentError("insufficient_scope", `Scope ${scope} is required`, 403);
  const recordId = cleanText(decodeURIComponent(segments[0] || ""), 180);
  if (request.method === "GET" && !recordId) {
    const result = await db.prepare("SELECT * FROM dbi_workspace_watchlist WHERE workspace_id = ? ORDER BY updated_at DESC").bind(principal.workspaceId).all();
    return agentJson((result.results || []).map(trackingFromRow), 200, { total: result.results?.length || 0 });
  }
  if (!recordId) return agentError("record_id_required", "A stable record ID is required", 400);
  if (request.method === "GET") {
    const row = await db.prepare("SELECT * FROM dbi_workspace_watchlist WHERE workspace_id = ? AND record_id = ?").bind(principal.workspaceId, recordId).first();
    return row ? agentJson(trackingFromRow(row)) : agentError("tracking_not_found", "Tracked record not found", 404);
  }
  if (request.method === "PUT") {
    const body = await safeJson(request);
    const existing = await db.prepare("SELECT * FROM dbi_workspace_watchlist WHERE workspace_id = ? AND record_id = ?").bind(principal.workspaceId, recordId).first();
    if (!existing) {
      const universe = await allAgentRecords(request, env, db, principal.workspaceId);
      if (!universe.records.some((record) => record.opportunityId === recordId)) return agentError("record_not_found", "Only an existing stable record ID can be tracked", 404);
    }
    const version = expectedVersion(request, body);
    if (existing && version === null) return agentError("precondition_required", "If-Match with the current tracking version is required", 428);
    if (existing && version !== null && version !== Number(existing.version)) return agentError("version_conflict", "Tracking state changed since the supplied version", 409, undefined, { currentVersion: existing.version });
    const now = new Date().toISOString();
    await db.prepare(`
      INSERT INTO dbi_workspace_watchlist (workspace_id, record_id, note, review_at, wallboard, version, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 1, ?, ?)
      ON CONFLICT(workspace_id, record_id) DO UPDATE SET note = excluded.note, review_at = excluded.review_at,
        wallboard = excluded.wallboard, version = dbi_workspace_watchlist.version + 1, updated_at = excluded.updated_at
    `).bind(principal.workspaceId, recordId, cleanText(body?.note, 4000), cleanDate(body?.reviewAt), body?.wallboard === false ? 0 : 1, existing?.created_at || now, now).run();
    const row = await db.prepare("SELECT * FROM dbi_workspace_watchlist WHERE workspace_id = ? AND record_id = ?").bind(principal.workspaceId, recordId).first();
    await recordActivity(db, principal, existing ? "tracking_updated" : "tracking_added", "tracking", recordId);
    return agentJson(trackingFromRow(row), existing ? 200 : 201);
  }
  if (request.method === "DELETE") {
    const changed = await db.prepare("DELETE FROM dbi_workspace_watchlist WHERE workspace_id = ? AND record_id = ?").bind(principal.workspaceId, recordId).run();
    if (!Number(changed?.meta?.changes || 0)) return agentError("tracking_not_found", "Tracked record not found", 404);
    await recordActivity(db, principal, "tracking_removed", "tracking", recordId);
    return new Response(null, { status: 204 });
  }
  return agentError("method_not_allowed", "Method not allowed", 405);
}

function eventCategoryFromRow(row) {
  return {
    id: row.category_id,
    name: row.name,
    description: row.description || "",
    assignedEventCount: Number(row.assigned_event_count || 0),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function eventCategoriesResponse(request, db, principal, segments) {
  if (!hasScope(principal, "events:read")) return agentError("insufficient_scope", "Scope events:read is required", 403);
  const categoryId = cleanText(decodeURIComponent(segments[0] || ""), 80);
  if (request.method === "GET") {
    const result = await db.prepare(`
      SELECT category.*,
        (SELECT COUNT(*) FROM dbi_workspace_event_category_assignments assignment
          WHERE assignment.workspace_id = category.workspace_id AND assignment.category_id = category.category_id) AS assigned_event_count
      FROM dbi_workspace_event_categories category
      WHERE category.workspace_id = ?
      ORDER BY category.name COLLATE NOCASE
    `).bind(principal.workspaceId).all();
    return agentJson((result.results || []).map(eventCategoryFromRow), 200, { total: result.results?.length || 0 });
  }
  if (principal.type !== "user" || !principal.canManageWorkspace) {
    return agentError("workspace_manager_required", "Workspace manager access is required to manage event categories", 403);
  }
  if (request.method === "POST" && !categoryId) {
    const body = await safeJson(request);
    const name = cleanText(body?.name, 80);
    const description = cleanText(body?.description, 240);
    if (name.length < 2) return agentError("invalid_event_category", "Category name must be at least two characters", 400);
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const created = await db.prepare(`INSERT OR IGNORE INTO dbi_workspace_event_categories
      (workspace_id, category_id, name, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`)
      .bind(principal.workspaceId, id, name, description, now, now).run();
    if (!Number(created?.meta?.changes || 0)) return agentError("event_category_exists", "An event category with that name already exists", 409);
    const row = await db.prepare("SELECT * FROM dbi_workspace_event_categories WHERE workspace_id = ? AND category_id = ?").bind(principal.workspaceId, id).first();
    await recordActivity(db, principal, "event_category_created", "event_category", id, { name });
    return agentJson(eventCategoryFromRow(row), 201);
  }
  const existing = categoryId
    ? await db.prepare("SELECT * FROM dbi_workspace_event_categories WHERE workspace_id = ? AND category_id = ?").bind(principal.workspaceId, categoryId).first()
    : null;
  if (!existing) return agentError("event_category_not_found", "Event category not found", 404);
  if (request.method === "PATCH") {
    const body = await safeJson(request);
    const name = cleanText(body?.name ?? existing.name, 80);
    const description = cleanText(body?.description ?? existing.description, 240);
    if (name.length < 2) return agentError("invalid_event_category", "Category name must be at least two characters", 400);
    const now = new Date().toISOString();
    const updated = await db.prepare(`UPDATE OR IGNORE dbi_workspace_event_categories
      SET name = ?, description = ?, updated_at = ? WHERE workspace_id = ? AND category_id = ?`)
      .bind(name, description, now, principal.workspaceId, categoryId).run();
    if (!Number(updated?.meta?.changes || 0)) return agentError("event_category_exists", "An event category with that name already exists", 409);
    const row = await db.prepare("SELECT * FROM dbi_workspace_event_categories WHERE workspace_id = ? AND category_id = ?").bind(principal.workspaceId, categoryId).first();
    await recordActivity(db, principal, "event_category_updated", "event_category", categoryId, { name });
    return agentJson(eventCategoryFromRow(row));
  }
  if (request.method === "DELETE") {
    const assignment = await db.prepare(`SELECT COUNT(*) AS count FROM dbi_workspace_event_category_assignments
      WHERE workspace_id = ? AND category_id = ?`).bind(principal.workspaceId, categoryId).first();
    if (Number(assignment?.count || 0)) return agentError("event_category_in_use", "Remove this category from its events before deleting it", 409);
    await db.prepare("DELETE FROM dbi_workspace_event_categories WHERE workspace_id = ? AND category_id = ?").bind(principal.workspaceId, categoryId).run();
    await recordActivity(db, principal, "event_category_deleted", "event_category", categoryId, { name: existing.name });
    return new Response(null, { status: 204 });
  }
  return agentError("method_not_allowed", "Method not allowed", 405);
}

async function eventsResponse(request, env, db, principal, segments) {
  const scope = request.method === "GET" ? "events:read" : "events:write";
  if (!hasScope(principal, scope)) return agentError("insufficient_scope", `Scope ${scope} is required`, 403);
  const eventId = cleanText(decodeURIComponent(segments[0] || ""), 180);
  if (request.method === "GET") {
    if (eventId) {
      const row = await visibleEventRow(db, principal, eventId);
      return row ? agentJson((await eventsFromRows(db, principal.workspaceId, [row]))[0]) : agentError("event_not_found", "Event not found", 404);
    }
    const result = await visibleEventRows(db, principal);
    return agentJson(await eventsFromRows(db, principal.workspaceId, result.results || []), 200, { total: result.results?.length || 0 });
  }
  if (request.method === "POST" && !eventId) return idempotent(db, principal, request, async () => {
    const body = await safeJson(request);
    const title = cleanText(body?.title, 180);
    const startsAt = cleanDate(body?.startsAt);
    if (!title || !startsAt) return agentError("invalid_event", "Event title and start time are required", 400);
    const recordIds = cleanStringArray(body?.recordIds);
    const attendeeSelection = await activeEventAttendeeIds(db, principal.workspaceId, body?.attendeeIds);
    const milestoneSelection = cleanEventMilestones(body?.milestones || []);
    const linkSelection = cleanEventLinks(body?.links || []);
    const categorySelection = await activeEventCategoryIds(db, principal.workspaceId, body?.categoryIds || []);
    const teamSelection = await eventTeamSelection(db, principal, body?.teamIds || []);
    if (!attendeeSelection.valid) return agentError("user_not_found", "Every attendee must be an active workspace user", 404);
    if (!milestoneSelection.valid) return agentError("invalid_event_milestones", "Milestones require a unique ID, supported type, and valid date; custom milestones also require a label", 400);
    if (!linkSelection.valid) return agentError("invalid_event_links", "Event links require unique IDs and valid HTTP or HTTPS URLs", 400);
    if (!categorySelection.valid) return agentError("event_category_not_found", "Every event category must exist in this workspace", 404);
    if (!teamSelection.valid) return agentError("event_team_not_found", "Every event team must exist and be available to the current user", 404);
    if (recordIds.length) {
      const universe = await allAgentRecords(request, env, db, principal.workspaceId);
      const known = new Set(universe.records.map((record) => record.opportunityId));
      if (recordIds.some((recordId) => !known.has(recordId))) return agentError("record_not_found", "Every linked record must use an existing stable record ID", 404);
    }
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    await db.prepare(`
      INSERT INTO dbi_workspace_events
        (id, workspace_id, title, starts_at, ends_at, location, notes, status, record_ids_json, wallboard, version, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
    `).bind(id, principal.workspaceId, title, startsAt, cleanDate(body?.endsAt), cleanText(body?.location, 500), cleanText(body?.notes, 4000),
      ["scheduled", "completed", "cancelled"].includes(body?.status) ? body.status : "scheduled",
      JSON.stringify(recordIds), body?.wallboard === false ? 0 : 1, now, now).run();
    await replaceEventAttendees(db, principal.workspaceId, id, attendeeSelection.ids);
    await replaceEventMilestones(db, principal.workspaceId, id, milestoneSelection.milestones);
    await replaceEventLinks(db, principal.workspaceId, id, linkSelection.links);
    await replaceEventCategories(db, principal.workspaceId, id, categorySelection.ids);
    await replaceEventTeams(db, principal.workspaceId, id, teamSelection.ids);
    const row = await db.prepare("SELECT * FROM dbi_workspace_events WHERE workspace_id = ? AND id = ?").bind(principal.workspaceId, id).first();
    await recordActivity(db, principal, "event_created", "event", id, { title });
    return agentJson((await eventsFromRows(db, principal.workspaceId, [row]))[0], 201);
  });
  const existing = eventId ? await visibleEventRow(db, principal, eventId) : null;
  if (!existing) return agentError("event_not_found", "Event not found", 404);
  if (request.method === "PATCH") {
    const body = await safeJson(request);
    const version = expectedVersion(request, body);
    if (version === null) return agentError("precondition_required", "If-Match with the current event version is required", 428);
    if (version !== null && version !== Number(existing.version)) return agentError("version_conflict", "Event changed since the supplied version", 409, undefined, { currentVersion: existing.version });
    const current = eventFromRow(existing);
    const next = { ...current, ...body };
    const title = cleanText(next.title, 180);
    const startsAt = cleanDate(next.startsAt);
    if (!title || !startsAt) return agentError("invalid_event", "Event title and start time are required", 400);
    const recordIds = cleanStringArray(next.recordIds);
    const attendeeSelection = Array.isArray(body?.attendeeIds) ? await activeEventAttendeeIds(db, principal.workspaceId, body.attendeeIds) : null;
    const milestoneSelection = Array.isArray(body?.milestones) ? cleanEventMilestones(body.milestones) : null;
    const linkSelection = Array.isArray(body?.links) ? cleanEventLinks(body.links) : null;
    const categorySelection = Array.isArray(body?.categoryIds) ? await activeEventCategoryIds(db, principal.workspaceId, body.categoryIds) : null;
    const teamSelection = Array.isArray(body?.teamIds) ? await eventTeamSelection(db, principal, body.teamIds) : null;
    if (attendeeSelection && !attendeeSelection.valid) return agentError("user_not_found", "Every attendee must be an active workspace user", 404);
    if (milestoneSelection && !milestoneSelection.valid) return agentError("invalid_event_milestones", "Milestones require a unique ID, supported type, and valid date; custom milestones also require a label", 400);
    if (linkSelection && !linkSelection.valid) return agentError("invalid_event_links", "Event links require unique IDs and valid HTTP or HTTPS URLs", 400);
    if (categorySelection && !categorySelection.valid) return agentError("event_category_not_found", "Every event category must exist in this workspace", 404);
    if (teamSelection && !teamSelection.valid) return agentError("event_team_not_found", "Every event team must exist and be available to the current user", 404);
    if (recordIds.length) {
      const universe = await allAgentRecords(request, env, db, principal.workspaceId);
      const known = new Set(universe.records.map((record) => record.opportunityId));
      if (recordIds.some((recordId) => !known.has(recordId))) return agentError("record_not_found", "Every linked record must use an existing stable record ID", 404);
    }
    const now = new Date().toISOString();
    await db.prepare(`
      UPDATE dbi_workspace_events SET title = ?, starts_at = ?, ends_at = ?, location = ?, notes = ?, status = ?,
        record_ids_json = ?, wallboard = ?, version = version + 1, updated_at = ? WHERE id = ? AND workspace_id = ?
    `).bind(title, startsAt, cleanDate(next.endsAt), cleanText(next.location, 500), cleanText(next.notes, 4000),
      ["scheduled", "completed", "cancelled"].includes(next.status) ? next.status : "scheduled",
      JSON.stringify(recordIds), next.wallboard === false ? 0 : 1, now, eventId, principal.workspaceId).run();
    if (attendeeSelection) await replaceEventAttendees(db, principal.workspaceId, eventId, attendeeSelection.ids);
    if (milestoneSelection) await replaceEventMilestones(db, principal.workspaceId, eventId, milestoneSelection.milestones);
    if (linkSelection) await replaceEventLinks(db, principal.workspaceId, eventId, linkSelection.links);
    if (categorySelection) await replaceEventCategories(db, principal.workspaceId, eventId, categorySelection.ids);
    if (teamSelection) await replaceEventTeams(db, principal.workspaceId, eventId, teamSelection.ids);
    const aiReviewJobId = cleanText(body?.aiReviewJobId, 100);
    if (aiReviewJobId) {
      const job = await db.prepare(`SELECT id, status, input_snapshot_json, merge_result_json, completed_at FROM dbi_event_ai_jobs
        WHERE id = ? AND workspace_id = ? AND status IN ('completed', 'needs_review')`)
        .bind(aiReviewJobId, principal.workspaceId).first();
      let jobEventId = "";
      try { jobEventId = cleanText(JSON.parse(job?.input_snapshot_json || "{}").id, 180); } catch { /* invalid retained snapshot */ }
      if (job && jobEventId === eventId) {
        await writeEventAiState(db, {
          workspaceId: principal.workspaceId,
          eventId,
          jobId: job.id,
          status: job.status,
          augmentedAt: job.completed_at || now,
          appliedAt: now,
          validationRequired: false,
        });
        try {
          const mergeResult = JSON.parse(job.merge_result_json || "{}");
          mergeResult.application = { mode: "manual", status: "applied", appliedAt: now, reason: "operator_validated" };
          await db.prepare("UPDATE dbi_event_ai_jobs SET merge_result_json = ?, updated_at = ? WHERE id = ?")
            .bind(JSON.stringify(mergeResult), now, job.id).run();
        } catch { /* state remains authoritative */ }
        await recordActivity(db, principal, "event_ai_manually_applied", "event", eventId, { jobId: job.id });
      }
    }
    const row = await db.prepare("SELECT * FROM dbi_workspace_events WHERE workspace_id = ? AND id = ?").bind(principal.workspaceId, eventId).first();
    await recordActivity(db, principal, "event_updated", "event", eventId, { version: row.version });
    return agentJson((await eventsFromRows(db, principal.workspaceId, [row]))[0]);
  }
  if (request.method === "DELETE") {
    await db.prepare("DELETE FROM dbi_workspace_event_attendees WHERE workspace_id = ? AND event_id = ?").bind(principal.workspaceId, eventId).run();
    await db.prepare("DELETE FROM dbi_workspace_event_milestones WHERE workspace_id = ? AND event_id = ?").bind(principal.workspaceId, eventId).run();
    await db.prepare("DELETE FROM dbi_workspace_event_links WHERE workspace_id = ? AND event_id = ?").bind(principal.workspaceId, eventId).run();
    await db.prepare("DELETE FROM dbi_workspace_event_category_assignments WHERE workspace_id = ? AND event_id = ?").bind(principal.workspaceId, eventId).run();
    await db.prepare("DELETE FROM dbi_workspace_event_teams WHERE workspace_id = ? AND event_id = ?").bind(principal.workspaceId, eventId).run();
    await db.prepare("DELETE FROM dbi_event_ai_state WHERE workspace_id = ? AND event_id = ?").bind(principal.workspaceId, eventId).run();
    await db.prepare("DELETE FROM dbi_workspace_events WHERE workspace_id = ? AND id = ?").bind(principal.workspaceId, eventId).run();
    await recordActivity(db, principal, "event_deleted", "event", eventId);
    return new Response(null, { status: 204 });
  }
  return agentError("method_not_allowed", "Method not allowed", 405);
}
async function activityResponse(request, db, principal) {
  const scope = request.method === "GET" ? "activity:read" : "activity:write";
  if (!hasScope(principal, scope)) return agentError("insufficient_scope", `Scope ${scope} is required`, 403);
  if (request.method === "GET") {
    const params = new URL(request.url).searchParams;
    const limit = boundedInteger(params.get("limit"), 100, 1, 200);
    const result = await db.prepare("SELECT * FROM dbi_workspace_activity WHERE workspace_id = ? ORDER BY occurred_at DESC LIMIT ?").bind(principal.workspaceId, limit).all();
    return agentJson((result.results || []).map((row) => ({
      id: row.id, actorType: row.actor_type, actorId: row.actor_id, action: row.action,
      entityType: row.entity_type, entityId: row.entity_id, detail: JSON.parse(row.detail_json || "{}"), occurredAt: row.occurred_at,
    })), 200, { total: result.results?.length || 0, limit });
  }
  if (request.method === "POST") return idempotent(db, principal, request, async () => {
    const body = await safeJson(request);
    const detail = cleanText(body?.detail, 4000);
    if (!detail) return agentError("detail_required", "Activity detail is required", 400);
    await recordActivity(db, principal, cleanText(body?.action, 80) || "agent_note", cleanText(body?.entityType, 80) || "workspace", cleanText(body?.entityId, 180), { detail });
    return agentJson({ ok: true }, 201);
  });
  return agentError("method_not_allowed", "Method not allowed", 405);
}
async function apiRequestsResponse(request, db, principal) {
  if (request.method !== "GET") return agentError("method_not_allowed", "Method not allowed", 405);
  if (!hasScope(principal, "activity:read")) return agentError("insufficient_scope", "Scope activity:read is required", 403);
  const params = new URL(request.url).searchParams;
  const limit = boundedInteger(params.get("limit"), 200, 1, 500);
  const provider = cleanText(params.get("provider"), 60);
  const status = cleanText(params.get("status"), 30);
  const requestKind = cleanText(params.get("kind"), 40);
  const clauses = ["workspace_id = ?"];
  const values = [principal.workspaceId];
  if (provider) { clauses.push("provider = ?"); values.push(provider); }
  if (status) { clauses.push("status = ?"); values.push(status); }
  if (requestKind) { clauses.push("request_kind = ?"); values.push(requestKind); }
  const result = await db.prepare(`SELECT * FROM dbi_api_request_log WHERE ${clauses.join(" AND ")} ORDER BY completed_at DESC LIMIT ?`)
    .bind(...values, limit).all();
  const rows = (result.results || []).map(apiRequestFromRow);
  const requestRows = rows.filter((row) => row.requestKind !== "credential_lifecycle");
  const latencies = requestRows.map((row) => row.latencyMs).filter((value) => value > 0).sort((left, right) => left - right);
  const percentileIndex = latencies.length ? Math.min(latencies.length - 1, Math.ceil(latencies.length * 0.95) - 1) : -1;
  const succeeded = requestRows.filter((row) => row.status === "succeeded").length;
  return agentJson(rows, 200, {
    summary: {
      retained: rows.length,
      requests: requestRows.length,
      succeeded,
      failed: requestRows.length - succeeded,
      successRate: requestRows.length ? Math.round((succeeded / requestRows.length) * 1000) / 10 : null,
      averageLatencyMs: requestRows.length ? Math.round(requestRows.reduce((sum, row) => sum + row.latencyMs, 0) / requestRows.length) : 0,
      p95LatencyMs: percentileIndex >= 0 ? latencies[percentileIndex] : 0,
      inputTokens: requestRows.reduce((sum, row) => sum + row.inputTokens, 0),
      outputTokens: requestRows.reduce((sum, row) => sum + row.outputTokens, 0),
    },
    retentionDays: 90,
    redaction: "Metadata only. Secrets, authorization headers, prompts, and response bodies are never stored.",
    total: rows.length,
    limit,
  });
}
async function integrationsResponse(request, env, principal) {
  if (request.method !== "GET") return agentError("method_not_allowed", "Method not allowed", 405);
  if (!hasScope(principal, "integrations:read")) return agentError("insufficient_scope", "Scope integrations:read is required", 403);
  const paths = ["sam-opportunities.json", "manual-procurement.json", "procurement-delta.json", "usaspending-subawards.json"];
  const payloads = await Promise.all(paths.map((path) => assetJson(request, env, `/data/${path}`).catch(() => ({ metadata: { status: "unavailable" } }))));
  return agentJson([
    { id: "records", name: "Factual record index", status: "current", endpoint: "/api/v1/agent/records" },
    { id: "sam", name: "SAM.gov opportunities", status: payloads[0].metadata?.status || "unknown", recordCount: payloads[0].records?.length || 0 },
    { id: "manual", name: "Manual public imports", status: payloads[1].metadata?.status || "ready", recordCount: payloads[1].records?.length || 0 },
    { id: "changes", name: "Procurement change detection", status: payloads[2].metadata?.status || "baseline", changedCount: Number(payloads[2].summary?.added || 0) + Number(payloads[2].summary?.updated || 0) },
    { id: "subawards", name: "USAspending subawards", status: payloads[3].metadata?.status || "unknown", reportedCount: payloads[3].metadata?.reportedSubawardCount || 0 },
  ]);
}
async function agentApiResponse(request, env, db) {
  const requestId = crypto.randomUUID();
  const startedAt = new Date().toISOString();
  const startedMs = Date.now();
  const principal = await requestPrincipal(db, request);
  if (!principal) return agentError("authentication_required", "Use a valid DBI agent bearer token or signed-in workspace session", 401, requestId);
  const pathname = new URL(request.url).pathname.replace(/\/+$/, "");
  const relative = pathname.slice("/api/v1/agent".length).replace(/^\//, "");
  const [resource = "capabilities", ...segments] = relative.split("/").filter(Boolean);
  const route = `/api/v1/agent/${cleanText(resource, 80)}`;
  let response;
  let thrownError = null;
  try {
    if (principal.type === "user" && !["GET", "HEAD"].includes(request.method) && !sameOriginRequest(request)) {
      response = agentError("cross_origin_forbidden", "Cross-origin workspace mutations are not allowed", 403, requestId);
    } else if (await rateLimited(db, principal)) {
      response = agentError("rate_limited", `Limit is ${AGENT_RATE_LIMIT} requests per minute`, 429, requestId);
    } else if (resource === "capabilities" && request.method === "GET") response = agentJson({
      principal, scopes: principal.scopes, rateLimitPerMinute: AGENT_RATE_LIMIT,
      resources: ["records", "analytics", "tracking", "record-dispositions", "events", "event-categories", "activity", "api-requests", "integrations"],
      writeBoundary: "Source-backed evidence is immutable; management state and manual Agent API records are writable.",
    }, 200, { requestId });
    else if (resource === "openapi.json" && request.method === "GET") response = Response.json(agentOpenApiDocument(new URL(request.url).origin, SESSION_COOKIE), { headers: { "cache-control": "no-store" } });
    else if (resource === "records") response = await recordsResponse(request, env, db, principal, segments);
    else if (resource === "tracking") response = await trackingResponse(request, env, db, principal, segments);
    else if (resource === "record-dispositions") response = await handleRecordDispositionsResponse(request, env, db, principal, segments, {
      allRecords: allAgentRecords,
      error: agentError,
      hasScope,
      json: agentJson,
      recordActivity,
      safeJson,
    });
    else if (resource === "events") response = await eventsResponse(request, env, db, principal, segments);
    else if (resource === "event-categories") response = await eventCategoriesResponse(request, db, principal, segments);
    else if (resource === "activity") response = await activityResponse(request, db, principal);
    else if (resource === "api-requests") response = await apiRequestsResponse(request, db, principal);
    else if (resource === "integrations") response = await integrationsResponse(request, env, principal);
    else if (resource === "analytics") response = await analyticsResponse(request, env, db, principal);
    else response = agentError("route_not_found", "Unknown Agent API route", 404, requestId);
  } catch (error) {
    thrownError = error;
    response = agentError("internal_error", "The request could not be completed", 500, requestId);
  }
  const completedAt = new Date().toISOString();
  const status = response.status === 429 ? "rate_limited" : response.status >= 400 ? (response.status < 500 ? "rejected" : "failed") : "succeeded";
  await recordApiRequest(db, {
    id: requestId, workspaceId: principal.workspaceId, userId: principal.type === "user" ? principal.id : "",
    principalType: principal.type, principalId: principal.id, requestKind: "agent_api", provider: "dbi",
    operation: `agent.${resource}.${request.method.toLowerCase()}`, method: request.method, route, status, httpStatus: response.status,
    stage: "request", traceId: requestId, latencyMs: Date.now() - startedMs,
    errorCode: status === "succeeded" ? "" : response.status === 429 ? "rate_limited" : thrownError ? "internal_error" : `http_${response.status}`,
    errorMessage: thrownError ? "Unhandled server error" : "", metadata: { segmentCount: segments.length }, startedAt, completedAt,
  });
  const headers = new Headers(response.headers);
  headers.set("x-request-id", requestId);
  if (thrownError) console.error("Agent API request failed", { requestId, resource, error: thrownError?.message });
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
export async function pagesAuthApiResponse(request, env = {}) {
  const db = databaseFromEnv(env);
  if (!db) return json({ error: "Persistent account database is unavailable" }, 503);
  await ensureSchema(db); const pathname = new URL(request.url).pathname.replace(/\/+$/, "");
  if (pathname === "/api/v1/system/acquisition-schedule") return acquisitionSchedulerResponse(request, db, env, { decryptSecret: decryptOpenAiKey, json });
  if (pathname === "/api/v1/auth/status") return statusResponse(request, db, env);
  if (pathname === "/api/v1/auth/claim") return claimResponse(request, db, env);
  if (pathname === "/api/v1/auth/register" || pathname === "/api/v1/auth/registration" || pathname.startsWith("/api/v1/auth/registration/")) return d1RegistrationResponse(request, db, env, {
    canAdministerUsers, cleanText, createSession, hashValue, json, normalizeEmail, publicSessionUser, recordActivity,
    safeJson, sameOriginRequest, sessionCookie, sessionUser, superUser, validPasswordProof, validSalt,
  });
  if (pathname === "/api/v1/auth/login-config") return loginConfigResponse(request, db);
  if (pathname === "/api/v1/auth/login") return loginResponse(request, db, env);
  if (pathname === "/api/v1/auth/logout") return logoutResponse(request, db, env);
  if (pathname === "/api/v1/auth/profile") return profileResponse(request, db);
  if (pathname === "/api/v1/auth/password") return passwordResponse(request, db, env);
  if (pathname === "/api/v1/auth/emulation") return handleEmulationResponse(request, db, { sessionUser, publicSessionUser, recordActivity, json, safeJson });
  if (pathname === "/api/v1/auth/activity") return handleUserActivityResponse(request, db, { json, safeJson, sessionUser });
  if (pathname === "/api/v1/auth/directory") return handleDirectoryResponse(request, db, { sessionUser, json, roleLabels: ROLE_LABELS });
  if (pathname === "/api/v1/auth/teams" || pathname.startsWith("/api/v1/auth/teams/")) return handleTeamsResponse(request, db, { sessionUser, canAdministerWorkspaces, recordActivity, json, safeJson });
  if (pathname === "/api/v1/auth/workspaces" || pathname.startsWith("/api/v1/auth/workspaces/")) return workspacesResponse(request, db);
  if (pathname === "/api/v1/auth/workspace-admin" || pathname.startsWith("/api/v1/auth/workspace-admin/")) return workspaceAdminResponse(request, db);
  if (pathname === "/api/v1/auth/openai-keys" || pathname.startsWith("/api/v1/auth/openai-keys/")) return openAiKeysResponse(request, db, env);
  if (pathname.startsWith("/api/v1/auth/provider-credentials/")) return handleProviderCredentialsResponse(request, db, env, {
    canAdministerWorkspaces, cleanText, encryptSecret: encryptOpenAiKey, json, recordActivity, recordApiRequest, safeJson, sameOriginRequest, sessionUser,
  });
  if (pathname === "/api/v1/auth/acquisition" || pathname.startsWith("/api/v1/auth/acquisition/")) return acquisitionRuntimeResponse(request, db, env, { canAdministerWorkspaces, decryptSecret: decryptOpenAiKey, encryptSecret: encryptOpenAiKey, json, safeJson, sameOriginRequest, sessionUser });
  if (pathname === "/api/v1/auth/event-ai" || pathname.startsWith("/api/v1/auth/event-ai/")) return eventAiResponse(request, db, env);
  if (pathname === "/api/v1/client-errors") return handleClientErrorsResponse(request, db, { json, recordApiRequest, safeJson, sameOriginRequest, sessionUser });
  if (pathname === "/api/v1/auth/users" || pathname.startsWith("/api/v1/auth/users/")) return usersResponse(request, db);
  if (pathname === "/api/v1/auth/agent-keys" || pathname.startsWith("/api/v1/auth/agent-keys/")) return agentKeysResponse(request, db);
  if (pathname === "/api/v1/agent" || pathname.startsWith("/api/v1/agent/")) return agentApiResponse(request, env, db);
  return json({ error: "Unknown account route" }, 404);
}
