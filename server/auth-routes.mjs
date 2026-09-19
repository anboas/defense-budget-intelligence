import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
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
} from "../src/event-ai-runtime.js";
import {
  MOCK_EVENT_AI_MODELS,
  assertEventAiModels,
  chooseEventAiModel,
  eventAiModelCandidates,
  fetchOpenAiModels,
} from "../src/openai-models.js";
import {
  cleanText,
  safeLogMetadata,
  safeLogText,
  sameOriginValues,
  validAvatarDataUrl,
  validEmail,
  validOpenAiKey,
  validPasswordProof,
} from "../src/security-policy.js";
import { registerTeamEmulationRoutes } from "./team-emulation-routes.mjs";
import { recordUserActivity, registerUserActivityRoutes } from "./user-activity-routes.mjs";
import { registerRecordDispositionRoutes } from "./record-disposition-routes.mjs";
import { registerProviderCredentialRoutes } from "./provider-credential-routes.mjs";
import { registerAcquisitionRuntimeRoutes } from "./acquisition-runtime-routes.mjs";
import { ROLE_LABELS, WORKSPACE_ROLE_IDS, accessCapabilities } from "../src/access-model.js";
const COOKIE_NAME = "dbi_session";
const SESSION_DAYS = Math.min(14, Math.max(1, Number(process.env.AUTH_SESSION_DAYS || 14)));
const MAX_ATTEMPTS = Math.max(3, Number(process.env.AUTH_MAX_ATTEMPTS || 8));
const WINDOW_MINUTES = Math.max(1, Number(process.env.AUTH_ATTEMPT_WINDOW_MINUTES || 15));
const USER_ROLES = WORKSPACE_ROLE_IDS;
const USER_STATUSES = ["active", "suspended"];
const DEFAULT_WORKSPACE_ID = "00000000-0000-4000-8000-000000000001";
const DEFAULT_HEADER_EYEBROW = "Defense Budget & Spend Analytics";
const DEFAULT_DISPLAY_TITLE = "Defense Budget Intelligence";
function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}
function equalDigest(left, right) {
  const a = Buffer.from(left || "", "hex");
  const b = Buffer.from(right || "", "hex");
  return a.length === b.length && a.length > 0 && timingSafeEqual(a, b);
}
function parseCookies(header = "") {
  return Object.fromEntries(header.split(";").map((item) => {
    const index = item.indexOf("=");
    return index < 0 ? ["", ""] : [item.slice(0, index).trim(), decodeURIComponent(item.slice(index + 1).trim())];
  }).filter(([key]) => key));
}
function sessionCookie(token, expiresAt) {
  const secure = process.env.AUTH_SECURE_COOKIE !== "false";
  return `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Priority=High; Expires=${expiresAt.toUTCString()}${secure ? "; Secure" : ""}`;
}
function clearCookie() {
  const secure = process.env.AUTH_SECURE_COOKIE !== "false";
  return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Strict; Priority=High; Max-Age=0${secure ? "; Secure" : ""}`;
}
function validProof(value) {
  return validPasswordProof(value);
}
function assertSameOrigin(request, reply) {
  if (!sameOriginValues(`${request.protocol}://${request.host}${request.url}`, request.headers.origin || "", request.headers["sec-fetch-site"] || "")) {
    reply.code(403).send({ error: "cross-origin request rejected" });
    return false;
  }
  return true;
}
async function account(pool) {
  const result = await pool.query(
    "SELECT user_id, email, display_name, title, password_salt, created_at, updated_at FROM app_super_user WHERE singleton = TRUE",
  );
  return result.rows[0] || null;
}
async function issueSession(pool, reply, userId, preferredWorkspaceId = null) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86_400_000);
  await pool.query("DELETE FROM app_auth_sessions WHERE expires_at <= NOW()");
  const membership = await pool.query(`SELECT workspace_id FROM app_workspace_memberships
    WHERE user_id = $1 AND ($2::uuid IS NULL OR workspace_id = $2)
    ORDER BY CASE WHEN workspace_id = $2 THEN 0 ELSE 1 END, created_at LIMIT 1`, [userId, preferredWorkspaceId]);
  const sessionId = randomUUID();
  await pool.query(
    "INSERT INTO app_auth_sessions (id, token_hash, expires_at, user_id, workspace_id) VALUES ($1, $2, $3, $4, $5)",
    [sessionId, sha256(token), expiresAt, userId, membership.rows[0]?.workspace_id || null],
  );
  reply.header("set-cookie", sessionCookie(token, expiresAt));
  return { sessionId, workspaceId: membership.rows[0]?.workspace_id || null };
}
export async function authenticated(pool, request) {
  const token = parseCookies(request.headers.cookie)[COOKIE_NAME];
  if (!token) return null;
  const result = await pool.query(
    `SELECT s.id, COALESCE(target.user_id, actor.user_id) AS user_id,
            COALESCE(target.email, actor.email) AS email, COALESCE(target.display_name, actor.display_name) AS display_name,
            COALESCE(target.title, actor.title) AS title, COALESCE(target.avatar_data_url, actor.avatar_data_url) AS avatar_data_url,
            COALESCE(target.role, actor.role) AS role, COALESCE(target.status, actor.status) AS status,
            COALESCE(target.must_change_password, actor.must_change_password) AS must_change_password,
            COALESCE(target.created_at, actor.created_at) AS created_at, COALESCE(target.last_login_at, actor.last_login_at) AS last_login_at,
            actor.user_id AS actor_user_id, actor.display_name AS actor_display_name, actor.email AS actor_email, actor.role AS actor_role,
            (target.user_id IS NOT NULL) AS is_emulating, membership.workspace_id AS active_workspace_id, membership.role AS membership_role
       FROM app_auth_sessions s
       JOIN app_users actor ON actor.user_id = s.user_id
       LEFT JOIN app_session_emulations emulation ON emulation.session_id = s.id
       LEFT JOIN app_users target ON target.user_id = emulation.target_user_id AND target.status = 'active'
       LEFT JOIN app_workspace_memberships membership ON membership.workspace_id = s.workspace_id AND membership.user_id = COALESCE(target.user_id, actor.user_id)
      WHERE s.token_hash = $1 AND s.expires_at > NOW() AND actor.status = 'active'
      LIMIT 1`,
    [sha256(token)],
  );
  if (!result.rowCount) return null;
  await pool.query("UPDATE app_auth_sessions SET last_seen_at = NOW() WHERE id = $1", [result.rows[0].id]);
  return result.rows[0];
}
function publicUser(row) {
  const capabilities = accessCapabilities(row?.role, row?.membership_role, { isEmulating: Boolean(row?.is_emulating) }); const roleId = capabilities.roleId;
  return row ? {
    id: row.user_id,
    email: row.email,
    displayName: row.display_name,
    title: row.title,
    avatarDataUrl: row.avatar_data_url || "",
    role: ROLE_LABELS[roleId] || "Viewer",
    roleId,
    status: row.status || "active",
    mustChangePassword: Boolean(row.must_change_password) && !row.is_emulating,
    canManagePlatform: capabilities.canManagePlatform, canManageAccounts: capabilities.canManageAccounts, canManageUsers: capabilities.canManageAccounts, canEmulateUsers: capabilities.canEmulateUsers,
    canManageWorkspace: capabilities.canManageWorkspace, canManageWorkspaces: capabilities.canManageWorkspace, canManageTeams: capabilities.canManageTeams, canManageAgents: capabilities.canManageAgents,
    canWriteWorkspace: capabilities.canWriteWorkspace, canRunEventAi: capabilities.canRunEventAi,
    createdAt: row.created_at,
    lastLoginAt: row.last_login_at || null,
    isEmulating: Boolean(row.is_emulating),
    actor: row.is_emulating ? { id: row.actor_user_id, displayName: row.actor_display_name || "Super user", email: row.actor_email || "", role: "Super user", roleId: "super_user" } : null,
  } : null;
}
const validAvatar = validAvatarDataUrl;
function encryptOpenAiKey(value) {
  const secret = String(process.env.DBI_CREDENTIAL_ENCRYPTION_KEY || "");
  if (secret.length < 32) return null;
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", createHash("sha256").update(secret).digest(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final(), cipher.getAuthTag()]);
  return { encryptedKey: encrypted.toString("base64"), keyIv: iv.toString("base64"), keyVersion: 1 };
}
function decryptOpenAiKey(row) {
  const secret = String(process.env.DBI_CREDENTIAL_ENCRYPTION_KEY || "");
  if (!row || secret.length < 32 || Number(row.key_version || 0) !== 1) return "";
  try {
    const payload = Buffer.from(row.encrypted_key, "base64");
    if (payload.length <= 16) return "";
    const decipher = createDecipheriv("aes-256-gcm", createHash("sha256").update(secret).digest(), Buffer.from(row.key_iv, "base64"));
    decipher.setAuthTag(payload.subarray(payload.length - 16));
    return Buffer.concat([decipher.update(payload.subarray(0, payload.length - 16)), decipher.final()]).toString("utf8");
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
async function openAiKeyUsage(pool, credentialIds) {
  const ids = credentialIds.filter(Boolean);
  if (!ids.length) return new Map();
  const result = await pool.query(`SELECT credential_id,
      COUNT(*) FILTER (WHERE request_kind <> 'credential_lifecycle')::int AS request_count,
      COUNT(*) FILTER (WHERE request_kind <> 'credential_lifecycle' AND status = 'succeeded')::int AS success_count,
      COUNT(*) FILTER (WHERE request_kind <> 'credential_lifecycle' AND status NOT IN ('succeeded', 'accepted'))::int AS failure_count,
      COALESCE(SUM(input_tokens), 0)::int AS input_tokens,
      COALESCE(SUM(output_tokens), 0)::int AS output_tokens,
      COALESCE(ROUND(AVG(latency_ms) FILTER (WHERE request_kind <> 'credential_lifecycle')), 0)::int AS average_latency_ms,
      MAX(completed_at) FILTER (WHERE request_kind <> 'credential_lifecycle') AS last_request_at
    FROM app_api_request_log WHERE credential_id = ANY($1::uuid[]) GROUP BY credential_id`, [ids]);
  return new Map(result.rows.map((row) => [String(row.credential_id), {
    requestCount: row.request_count || 0, successCount: row.success_count || 0, failureCount: row.failure_count || 0,
    inputTokens: row.input_tokens || 0, outputTokens: row.output_tokens || 0,
    averageLatencyMs: row.average_latency_ms || 0, lastRequestAt: row.last_request_at || null,
  }]));
}
export async function recordApiRequest(pool, input = {}) {
  const now = new Date();
  const id = randomUUID();
  const metadata = safeLogMetadata(input.metadata) || {};
  await pool.query(`INSERT INTO app_api_request_log
    (id, workspace_id, user_id, principal_type, principal_id, request_kind, provider, operation, method, route,
     status, http_status, stage, model, credential_id, credential_scope, provider_request_id, trace_id, response_id,
     latency_ms, input_tokens, output_tokens, retry_count, retryable, error_code, error_message, metadata_json, started_at, completed_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29)`, [
    id, input.workspaceId || null, input.userId || null, cleanText(input.principalType || "user", 40), cleanText(input.principalId, 100) || null,
    cleanText(input.requestKind || "api", 40), cleanText(input.provider || "dbi", 60), cleanText(input.operation || "request", 120),
    cleanText(input.method, 12) || null, cleanText(input.route, 180) || null, cleanText(input.status || "failed", 30), Number(input.httpStatus || 0) || null,
    cleanText(input.stage, 80) || null, cleanText(input.model, 120) || null, input.credentialId || null, cleanText(input.credentialScope, 20) || null,
    cleanText(input.providerRequestId, 180) || null, cleanText(input.traceId, 180) || null, cleanText(input.responseId, 180) || null,
    Math.max(0, Number(input.latencyMs || 0)), Math.max(0, Number(input.inputTokens || 0)), Math.max(0, Number(input.outputTokens || 0)),
    Math.max(0, Number(input.retryCount || 0)), Boolean(input.retryable), safeLogText(input.errorCode, 120) || null, safeLogText(input.errorMessage, 500) || null,
    JSON.stringify(metadata).slice(0, 8_000), input.startedAt || now, input.completedAt || now,
  ]);
  return id;
}

export async function runAuthRetentionMaintenance(pool) {
  await pool.query("DELETE FROM app_api_request_log WHERE completed_at < NOW() - INTERVAL '90 days'");
  await pool.query("DELETE FROM app_event_ai_jobs WHERE completed_at < NOW() - INTERVAL '90 days'");
  await pool.query("DELETE FROM app_login_attempts WHERE attempted_at < NOW() - INTERVAL '24 hours'");
  await pool.query("DELETE FROM app_user_activity WHERE occurred_at < NOW() - INTERVAL '90 days'");
}

async function hydratedUser(pool, row) {
  if (!row) return null;
  const result = await pool.query(`SELECT workspace.workspace_id, workspace.name, workspace.slug, workspace.description, membership.role,
      settings.icon_data_url, settings.header_eyebrow, settings.display_title, ai_preferences.auto_accept_event_augmentations
    FROM app_workspace_memberships membership JOIN app_workspaces workspace ON workspace.workspace_id = membership.workspace_id
    LEFT JOIN app_workspace_settings settings ON settings.workspace_id = workspace.workspace_id
    LEFT JOIN app_workspace_ai_preferences ai_preferences ON ai_preferences.workspace_id = workspace.workspace_id
    WHERE membership.user_id = $1 AND workspace.status = 'active' ORDER BY workspace.name`, [row.user_id]);
  const workspaces = result.rows.map((workspace) => ({ id: workspace.workspace_id, name: workspace.name, slug: workspace.slug,
    description: workspace.description, iconDataUrl: workspace.icon_data_url || "",
    headerEyebrow: workspace.header_eyebrow || DEFAULT_HEADER_EYEBROW, displayTitle: workspace.display_title || DEFAULT_DISPLAY_TITLE,
    autoAcceptAiAugmentations: Boolean(workspace.auto_accept_event_augmentations),
    roleId: workspace.role, role: ROLE_LABELS[workspace.role] || "Viewer" }));
  const activeWorkspace = workspaces.find((workspace) => String(workspace.id) === String(row.active_workspace_id)) || null;
  return { ...publicUser({ ...row, membership_role: activeWorkspace?.roleId || row.membership_role }), workspaces, activeWorkspace, hasWorkspaceAccess: Boolean(activeWorkspace) };
}

function canAdministerUsers(user) { return Boolean(user && !user.is_emulating && user.role === "super_user"); }

function canAdministerWorkspaces(user) {
  return Boolean(user && (user.role === "super_user" || user.membership_role === "administrator"));
}

async function canAdministerWorkspace(pool, user, workspaceId) {
  if (user?.role === "super_user") return true;
  if (!user || String(user.active_workspace_id || "") !== String(workspaceId || "")) return false;
  const membership = await pool.query("SELECT role FROM app_workspace_memberships WHERE workspace_id = $1 AND user_id = $2", [workspaceId, user.user_id]);
  return membership.rows[0]?.role === "administrator";
}

const EVENT_AI_CATEGORIES = Object.freeze([
  { id: "conference", name: "Conference" },
  { id: "industry-day", name: "Industry day" },
  { id: "workshop", name: "Workshop" },
  { id: "immersion-day", name: "Immersion day" },
  { id: "summit", name: "Summit" },
  { id: "other", name: "Other" },
]);

function canRunEventAi(user) {
  return ["super_user", "administrator", "analyst"].includes(publicUser(user)?.roleId);
}

function eventAiJob(row) {
  const verification = row.verification_json || {};
  const storedMergeResult = row.merge_result_json || {};
  const mergeResult = storedMergeResult?.mergedDraft || verification?.decision === "rejected"
    ? storedMergeResult
    : resolveEventAiVerificationOutcome({ draft: row.input_snapshot_json || {}, verification, categories: row.categories_json || EVENT_AI_CATEGORIES }).mergeResult;
  return {
    id: row.id,
    status: row.status,
    currentStep: row.current_step,
    credentialScope: row.credential_scope,
    producerModel: row.producer_model,
    verifierModel: row.verifier_model,
    direction: row.direction || "",
    inputSnapshot: row.input_snapshot_json || {},
    proposal: row.proposal_json || {},
    verification,
    mergeResult,
    error: row.error_message ? { code: row.error_code || "event_ai_failed", message: row.error_message } : null,
    diagnostic: row.diagnostic_metadata_json?.evidence || null,
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
    diagnostic.metadata_json AS diagnostic_metadata_json,
    diagnostic.provider_request_id AS diagnostic_provider_request_id,
    diagnostic.response_id AS diagnostic_response_id
  FROM app_event_ai_jobs j
  LEFT JOIN LATERAL (
    SELECT metadata_json, provider_request_id, response_id
    FROM app_api_request_log candidate
    WHERE candidate.trace_id = j.trace_id::text
      AND candidate.request_kind = 'openai'
    ORDER BY candidate.completed_at DESC
    LIMIT 1
  ) diagnostic ON TRUE`;

const EVENT_AI_RECENT_JOBS_SELECT = `
  WITH recent_jobs AS (
    SELECT *
    FROM app_event_ai_jobs
    WHERE workspace_id = $1 AND user_id = $2
    ORDER BY created_at DESC
    LIMIT 20
  )
  SELECT j.*,
    diagnostic.metadata_json AS diagnostic_metadata_json,
    diagnostic.provider_request_id AS diagnostic_provider_request_id,
    diagnostic.response_id AS diagnostic_response_id
  FROM recent_jobs j
  LEFT JOIN LATERAL (
    SELECT metadata_json, provider_request_id, response_id
    FROM app_api_request_log candidate
    WHERE candidate.trace_id = j.trace_id::text
      AND candidate.request_kind = 'openai'
    ORDER BY candidate.completed_at DESC
    LIMIT 1
  ) diagnostic ON TRUE
  ORDER BY j.created_at DESC`;

async function eventAiJobWithDiagnostic(pool, id, workspaceId, userId) {
  const result = await pool.query(`${EVENT_AI_JOB_DIAGNOSTIC_SELECT} WHERE j.id = $1 AND j.workspace_id = $2 AND j.user_id = $3`, [id, workspaceId, userId]);
  return result.rows[0] || null;
}

async function resolveEventAiCredential(pool, user, scope, credentialId = "") {
  let result;
  if (scope === "user") {
    result = credentialId
      ? await pool.query("SELECT * FROM app_openai_keys WHERE id = $1 AND scope_type = 'user' AND user_id = $2 AND revoked_at IS NULL", [credentialId, user.user_id])
      : await pool.query("SELECT * FROM app_openai_keys WHERE scope_type = 'user' AND user_id = $1 AND revoked_at IS NULL ORDER BY is_default DESC, created_at DESC LIMIT 1", [user.user_id]);
  } else if (scope === "workspace" && user.active_workspace_id) {
    result = await pool.query("SELECT * FROM app_openai_keys WHERE scope_type = 'workspace' AND workspace_id = $1 AND revoked_at IS NULL AND is_default = TRUE ORDER BY created_at DESC LIMIT 1", [user.active_workspace_id]);
  } else return null;
  const row = result.rows[0];
  const apiKey = decryptOpenAiKey(row);
  return row && apiKey ? { id: row.id, scope: row.scope_type, apiKey } : null;
}

async function eventAiWorkspaceModelDefaults(pool, workspaceId) {
  if (!workspaceId) return { producerModel: "", verifierModel: "" };
  const result = await pool.query("SELECT event_research_model, event_verification_model FROM app_workspace_ai_settings WHERE workspace_id = $1", [workspaceId]);
  return {
    producerModel: cleanText(result.rows[0]?.event_research_model, 180),
    verifierModel: cleanText(result.rows[0]?.event_verification_model, 180),
  };
}

async function eventAiModelInventory(pool, user, scope, credentialId = "") {
  const credential = await resolveEventAiCredential(pool, user, scope, credentialId);
  if (!credential) {
    const error = new Error(`No active ${scope === "workspace" ? "workspace default" : "personal"} OpenAI key is available.`);
    error.code = "credential_unavailable";
    error.httpStatus = 409;
    throw error;
  }
  const mockMode = String(process.env.DBI_EVENT_AI_MOCK_MODE || "").toLowerCase() === "true";
  const startedAt = new Date();
  let inventory;
  try {
    inventory = mockMode
      ? { models: MOCK_EVENT_AI_MODELS, requestId: "", latencyMs: 0, retrievedAt: startedAt.toISOString() }
      : await fetchOpenAiModels(credential.apiKey);
    await recordApiRequest(pool, {
      workspaceId: user.active_workspace_id, userId: user.user_id, principalType: "user", principalId: user.user_id,
      requestKind: "openai", provider: "openai", operation: "model_inventory.list", method: "GET", route: "/v1/models",
      status: "succeeded", httpStatus: 200, stage: "model_inventory", credentialId: credential.id,
      credentialScope: credential.scope, providerRequestId: inventory.requestId, latencyMs: inventory.latencyMs,
      metadata: { inventoryCount: inventory.models.length, candidateCount: eventAiModelCandidates(inventory.models).length }, startedAt,
    });
  } catch (error) {
    await recordApiRequest(pool, {
      workspaceId: user.active_workspace_id, userId: user.user_id, principalType: "user", principalId: user.user_id,
      requestKind: "openai", provider: "openai", operation: "model_inventory.list", method: "GET", route: "/v1/models",
      status: "failed", httpStatus: error?.httpStatus || 502, stage: "model_inventory", credentialId: credential.id,
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
    ? await eventAiWorkspaceModelDefaults(pool, user.active_workspace_id)
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

async function failEventAiJob(pool, row, error) {
  const result = await pool.query(`UPDATE app_event_ai_jobs SET status = 'failed', error_code = $1,
    error_message = $2, updated_at = NOW(), completed_at = NOW() WHERE id = $3 RETURNING *`, [
    cleanText(error?.code || "event_ai_failed", 120), cleanText(error?.message || "Event enrichment failed.", 500), row.id,
  ]);
  return result.rows[0];
}

async function logEventAiProvider(pool, row, response, stage, status, latencyMs = 0, requestId = "", error = null, method = "POST", evidenceDiagnostic = null) {
  const usage = response?.usage || {};
  await recordApiRequest(pool, {
    workspaceId: row.workspace_id, userId: row.user_id, principalType: "user", principalId: row.user_id,
    requestKind: "openai", provider: "openai", operation: stage === "research" ? "event_enrichment.research" : "event_enrichment.verify",
    method, route: method === "GET" ? `/v1/responses/${response?.id || (stage === "research" ? row.producer_response_id : row.verifier_response_id)}` : "/v1/responses", status, httpStatus: error?.httpStatus || (status === "succeeded" || method === "GET" ? 200 : 202),
    stage, model: stage === "research" ? row.producer_model : row.verifier_model, credentialId: row.credential_id,
    credentialScope: row.credential_scope, providerRequestId: requestId, traceId: row.trace_id, responseId: response?.id,
    latencyMs, inputTokens: usage.input_tokens, outputTokens: usage.output_tokens, retryCount: row.retry_count,
    retryable: isRetryableEventAiError(error),
    errorCode: error?.code, errorMessage: error?.message, metadata: { jobId: row.id, workflow: "event_enrichment", evidence: error?.diagnostic || evidenceDiagnostic || null },
  });
}

function eventAiReviewRisks(verification, outcome) {
  return Boolean(
    outcome.status !== "completed"
    || (outcome.mergeResult?.conflicts || []).length
    || (verification?.approved?.reviewClaims || []).length
    || (verification?.rejectedClaims || []).length,
  );
}

async function finalizeEventAiOutcome(pool, row, draft, verification, outcome) {
  const changes = outcome.mergeResult?.changes || [];
  const eventId = cleanText(draft?.id, 180);
  const preference = eventId ? await pool.query(`SELECT auto_accept_event_augmentations
    FROM app_workspace_ai_preferences WHERE workspace_id = $1`, [row.workspace_id]) : { rows: [] };
  const autoAccept = Boolean(preference.rows[0]?.auto_accept_event_augmentations);
  const validationRequired = Boolean(changes.length || eventAiReviewRisks(verification, outcome));
  const application = {
    mode: autoAccept ? "automatic" : "manual",
    status: validationRequired ? "pending_validation" : "no_changes",
    appliedAt: null,
    reason: autoAccept && validationRequired ? "event_store_unavailable_on_this_runtime" : autoAccept ? "event_already_current" : "workspace_auto_accept_disabled",
  };
  if (eventId) {
    await pool.query(`INSERT INTO app_event_ai_state
      (workspace_id, event_id, last_job_id, last_status, last_augmented_at, validation_required, updated_at)
      VALUES ($1, $2, $3, $4, NOW(), $5, NOW())
      ON CONFLICT (workspace_id, event_id) DO UPDATE SET last_job_id = EXCLUDED.last_job_id,
      last_status = EXCLUDED.last_status, last_augmented_at = EXCLUDED.last_augmented_at,
      validation_required = EXCLUDED.validation_required, updated_at = NOW()`,
    [row.workspace_id, eventId, row.id, outcome.status, validationRequired]);
  }
  return { ...outcome, mergeResult: { ...outcome.mergeResult, application } };
}

async function advanceEventAiJob(pool, row) {
  if (["completed", "needs_review", "failed", "cancelled"].includes(row.status)) return row;
  const draft = row.input_snapshot_json || {};
  const categories = row.categories_json || EVENT_AI_CATEGORIES;
  const mockMode = String(process.env.DBI_EVENT_AI_MOCK_MODE || "").toLowerCase() === "true";
  const credential = await resolveEventAiCredential(pool, { user_id: row.user_id, active_workspace_id: row.workspace_id }, row.credential_scope, row.credential_id);
  if (!credential) return failEventAiJob(pool, row, { code: "credential_unavailable", message: "The selected OpenAI credential is unavailable or could not be decrypted." });
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
      await logEventAiProvider(pool, row, providerResponse, "research", "succeeded", providerLatencyMs, providerRequestId, null, "GET", proposalDiagnostic || (mockMode ? null : eventAiEvidenceDiagnostic(providerResponse, proposal)));
      if (!mockMode) await deleteOpenAiResponse(credential.apiKey, row.producer_response_id).catch(() => false);
      let verifierResponseId = `mock-verifier-${row.id}`;
      if (!mockMode) {
        const started = await startOpenAiBackgroundResponse(credential.apiKey, buildEventAiVerifierRequest({ draft, proposal, direction: row.direction, categories, model: row.verifier_model }));
        verifierResponseId = started.response.id;
        await logEventAiProvider(pool, row, started.response, "verification", "accepted", started.latencyMs, started.requestId);
      }
      const result = await pool.query(`UPDATE app_event_ai_jobs SET status = 'verifying', current_step = 'independent_verification',
        proposal_json = $1::jsonb, verifier_response_id = $2, updated_at = NOW() WHERE id = $3 RETURNING *`, [JSON.stringify(proposal), verifierResponseId, row.id]);
      return result.rows[0];
    }
    if (row.status === "verifying") {
      let verification;
      if (mockMode) {
        verification = mockEventAiVerification(row.proposal_json || {});
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
          approved: citedEventAiDetails(providerResponse, value?.approved, draft, { trustedSourceUrls: (row.proposal_json?.groundedSourceUrls || row.proposal_json?.sources?.map((source) => source.url) || []) }), checks: Array.isArray(value?.checks) ? value.checks.slice(0, 12) : [],
          rejectedClaims: Array.isArray(value?.rejectedClaims) ? value.rejectedClaims.slice(0, 30) : [],
          mergeNotes: Array.isArray(value?.mergeNotes) ? value.mergeNotes.slice(0, 20) : [],
        }));
      }
      await logEventAiProvider(pool, row, providerResponse, "verification", "succeeded", providerLatencyMs, providerRequestId, null, "GET", mockMode ? null : eventAiEvidenceDiagnostic(providerResponse, verification.approved));
      if (!mockMode) await deleteOpenAiResponse(credential.apiKey, row.verifier_response_id).catch(() => false);
      const outcome = await finalizeEventAiOutcome(pool, row, draft, verification, resolveEventAiVerificationOutcome({ draft, verification, categories }));
      const result = await pool.query(`UPDATE app_event_ai_jobs SET status = $1, current_step = $2, verification_json = $3::jsonb,
        merge_result_json = $4::jsonb, updated_at = NOW(), completed_at = NOW() WHERE id = $5 RETURNING *`, [
        outcome.status, outcome.currentStep,
        JSON.stringify(verification), JSON.stringify(outcome.mergeResult), row.id,
      ]);
      await pool.query("UPDATE app_openai_keys SET last_used_at = NOW(), updated_at = NOW() WHERE id = $1", [row.credential_id]);
      return result.rows[0];
    }
  } catch (error) {
    await logEventAiProvider(pool, row, providerResponse, row.status === "researching" ? "research" : "verification", "failed", providerLatencyMs, providerRequestId, error, "GET").catch(() => {});
    return failEventAiJob(pool, row, error);
  }
  return row;
}
export async function registerAuthRoutes(app, pool) {
  const enabled = process.env.ENABLE_AUTH === "true";
  const required = enabled && process.env.AUTH_REQUIRE_LOGIN === "true";
  const allowFirstClaim = process.env.ALLOW_FIRST_CLAIM !== "false";
  registerTeamEmulationRoutes(app, pool, { assertSameOrigin, authenticated, hydratedUser, canAdministerWorkspaces });
  registerUserActivityRoutes(app, pool, { assertSameOrigin, authenticated });
  registerRecordDispositionRoutes(app, pool, { assertSameOrigin, authenticated });
  registerProviderCredentialRoutes(app, pool, { assertSameOrigin, authenticated, canAdministerWorkspace, cleanText, encryptSecret: encryptOpenAiKey, recordApiRequest });
  registerAcquisitionRuntimeRoutes(app, pool, { assertSameOrigin, authenticated, canAdministerWorkspace, cleanText, decryptSecret: decryptOpenAiKey, encryptSecret: encryptOpenAiKey });
  app.get("/api/v1/auth/status", async (request) => {
    if (!enabled) return { enabled: false, required: false, claimed: false, user: null };
    const [owner, session] = await Promise.all([account(pool), authenticated(pool, request)]);
    return { enabled: true, required, claimed: Boolean(owner), registrationEnabled: Boolean(owner), user: await hydratedUser(pool, session) };
  });

  app.post("/api/v1/auth/claim", async (request, reply) => {
    if (!enabled || !allowFirstClaim) return reply.code(404).send({ error: "initial account claim is unavailable" });
    if (!assertSameOrigin(request, reply)) return;
    const email = cleanText(request.body?.email, 254).toLowerCase();
    const displayName = cleanText(request.body?.displayName, 80);
    const title = cleanText(request.body?.title, 80);
    const passwordSalt = cleanText(request.body?.passwordSalt, 128);
    const passwordProof = cleanText(request.body?.passwordProof, 64).toLowerCase();
    if (!validEmail(email) || displayName.length < 2 || passwordSalt.length < 16 || !validProof(passwordProof)) {
      return reply.code(400).send({ error: "valid account details are required" });
    }
    const userId = randomUUID();
    const client = await pool.connect();
    let owner;
    try {
      await client.query("BEGIN");
      const result = await client.query(
        `INSERT INTO app_super_user (singleton, user_id, email, display_name, title, password_salt, password_proof_hash)
         VALUES (TRUE, $1, $2, $3, $4, $5, $6)
         ON CONFLICT (singleton) DO NOTHING
         RETURNING user_id, email, display_name, title, created_at`,
        [userId, email, displayName, title, passwordSalt, sha256(passwordProof)],
      );
      if (!result.rowCount) { await client.query("ROLLBACK"); return reply.code(409).send({ error: "the super-user account has already been claimed" }); }
      const inserted = await client.query(
        `INSERT INTO app_users
          (user_id, email, display_name, title, role, status, password_salt, password_proof_hash, must_change_password, created_by)
         VALUES ($1, $2, $3, $4, 'super_user', 'active', $5, $6, FALSE, $1)
         RETURNING *`,
        [userId, email, displayName, title, passwordSalt, sha256(passwordProof)],
      );
      owner = inserted.rows[0];
      await client.query(`INSERT INTO app_workspaces (workspace_id, name, slug, description, owner_user_id)
        VALUES ($1, 'Defense budget', 'defense-budget', 'Defense Budget Intelligence shared workspace', $2)
        ON CONFLICT (workspace_id) DO UPDATE SET owner_user_id = EXCLUDED.owner_user_id, updated_at = NOW()`, [DEFAULT_WORKSPACE_ID, userId]);
      await client.query(`INSERT INTO app_workspace_memberships (workspace_id, user_id, role, created_by)
        VALUES ($1, $2, 'super_user', $2) ON CONFLICT (workspace_id, user_id) DO NOTHING`, [DEFAULT_WORKSPACE_ID, userId]);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    const session = await issueSession(pool, reply, userId, DEFAULT_WORKSPACE_ID);
    return reply.code(201).send({ user: await hydratedUser(pool, { ...owner, role: "super_user", status: "active", active_workspace_id: session.workspaceId, membership_role: "super_user" }) });
  });

  app.post("/api/v1/auth/register", async (request, reply) => {
    if (!enabled) return reply.code(404).send({ error: "authentication is unavailable" });
    if (!assertSameOrigin(request, reply)) return;
    if (!await account(pool)) return reply.code(409).send({ error: "the Super user must claim the service before registration opens" });
    const email = cleanText(request.body?.email, 254).toLowerCase();
    const displayName = cleanText(request.body?.displayName, 80);
    const title = cleanText(request.body?.title, 80);
    const passwordSalt = cleanText(request.body?.passwordSalt, 128);
    const passwordProof = cleanText(request.body?.passwordProof, 64).toLowerCase();
    if (!validEmail(email) || displayName.length < 2 || passwordSalt.length < 16 || !validProof(passwordProof)) return reply.code(400).send({ error: "valid account details are required" });
    try {
      const userId = randomUUID();
      const result = await pool.query(`INSERT INTO app_users
        (user_id, email, display_name, title, role, status, password_salt, password_proof_hash, must_change_password, created_by, last_login_at)
        VALUES ($1, $2, $3, $4, 'viewer', 'active', $5, $6, FALSE, $1, NOW()) RETURNING *`,
      [userId, email, displayName, title, passwordSalt, sha256(passwordProof)]);
      const session = await issueSession(pool, reply, userId);
      return reply.code(201).send({ user: await hydratedUser(pool, { ...result.rows[0], active_workspace_id: session.workspaceId }) });
    } catch (error) {
      if (error.code === "23505") return reply.code(409).send({ error: "an account with that email already exists" });
      throw error;
    }
  });

  app.post("/api/v1/auth/login-config", async (request, reply) => {
    if (!enabled) return reply.code(404).send({ error: "authentication is unavailable" });
    if (!assertSameOrigin(request, reply)) return;
    const email = cleanText(request.body?.email, 254).toLowerCase();
    const result = await pool.query("SELECT password_salt FROM app_users WHERE LOWER(email) = $1 AND status = 'active'", [email]);
    return { passwordSalt: result.rows[0]?.password_salt || sha256(`unknown|${email}`) };
  });

  app.post("/api/v1/auth/login", async (request, reply) => {
    if (!enabled) return reply.code(404).send({ error: "authentication is unavailable" });
    if (!assertSameOrigin(request, reply)) return;
    const email = cleanText(request.body?.email, 254).toLowerCase();
    const proof = cleanText(request.body?.passwordProof, 64).toLowerCase();
    const identityHash = sha256(`${email}|${request.ip}`);
    const attempts = await pool.query(
      `SELECT COUNT(*)::int AS count FROM app_login_attempts
        WHERE identity_hash = $1 AND succeeded = FALSE
          AND attempted_at > NOW() - ($2::text || ' minutes')::interval`,
      [identityHash, WINDOW_MINUTES],
    );
    if (attempts.rows[0].count >= MAX_ATTEMPTS) {
      return reply.code(429).send({ error: "too many attempts; try again later" });
    }
    const result = await pool.query(
      "SELECT * FROM app_users WHERE LOWER(email) = $1 AND status = 'active'",
      [email],
    );
    const user = result.rows[0];
    const ok = user && validProof(proof) && equalDigest(user.password_proof_hash, sha256(proof));
    await pool.query("INSERT INTO app_login_attempts (identity_hash, succeeded) VALUES ($1, $2)", [identityHash, Boolean(ok)]);
    if (!ok) return reply.code(401).send({ error: "email or password is incorrect" });
    await pool.query("UPDATE app_users SET last_login_at = NOW() WHERE user_id = $1", [user.user_id]);
    const session = await issueSession(pool, reply, user.user_id);
    return { user: await hydratedUser(pool, { ...user, last_login_at: new Date(), active_workspace_id: session.workspaceId }) };
  });

  app.post("/api/v1/auth/logout", async (request, reply) => {
    if (!assertSameOrigin(request, reply)) return;
    const token = parseCookies(request.headers.cookie)[COOKIE_NAME];
    if (token) await pool.query("DELETE FROM app_auth_sessions WHERE token_hash = $1", [sha256(token)]);
    reply.header("set-cookie", clearCookie());
    return { ok: true };
  });

  app.patch("/api/v1/auth/profile", async (request, reply) => {
    if (!assertSameOrigin(request, reply)) return;
    const session = await authenticated(pool, request);
    if (!session) return reply.code(401).send({ error: "sign in required" });
    if (session.is_emulating) return reply.code(403).send({ error: "exit user emulation before changing profile identity" });
    const displayName = cleanText(request.body?.displayName, 80);
    const title = cleanText(request.body?.title, 80);
    const avatarDataUrl = validAvatar(request.body?.avatarDataUrl);
    if (displayName.length < 2) return reply.code(400).send({ error: "display name is required" });
    if (avatarDataUrl === null) return reply.code(400).send({ error: "profile picture must be an optimized PNG, JPEG, or WebP image" });
    const result = await pool.query(
      `UPDATE app_users SET display_name = $1, title = $2, avatar_data_url = $3, updated_at = NOW()
        WHERE user_id = $4 RETURNING *`,
      [displayName, title, avatarDataUrl, session.user_id],
    );
    if (session.role === "super_user") {
      await pool.query("UPDATE app_super_user SET display_name = $1, title = $2, updated_at = NOW() WHERE user_id = $3", [displayName, title, session.user_id]);
    }
    return { user: await hydratedUser(pool, { ...result.rows[0], active_workspace_id: session.active_workspace_id, membership_role: session.membership_role }) };
  });

  app.post("/api/v1/auth/password", async (request, reply) => {
    if (!assertSameOrigin(request, reply)) return;
    const session = await authenticated(pool, request);
    if (!session) return reply.code(401).send({ error: "sign in required" });
    if (session.is_emulating) return reply.code(403).send({ error: "exit user emulation before changing a password" });
    const currentProof = cleanText(request.body?.currentPasswordProof, 64).toLowerCase();
    const nextProof = cleanText(request.body?.newPasswordProof, 64).toLowerCase();
    const nextSalt = cleanText(request.body?.newPasswordSalt, 128);
    const result = await pool.query("SELECT password_proof_hash FROM app_users WHERE user_id = $1", [session.user_id]);
    if (!validProof(currentProof) || !equalDigest(result.rows[0].password_proof_hash, sha256(currentProof))) {
      return reply.code(403).send({ error: "current password is incorrect" });
    }
    if (!validProof(nextProof) || nextSalt.length < 16) return reply.code(400).send({ error: "new password is invalid" });
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        "UPDATE app_users SET password_salt = $1, password_proof_hash = $2, must_change_password = FALSE, updated_at = NOW() WHERE user_id = $3",
        [nextSalt, sha256(nextProof), session.user_id],
      );
      if (session.role === "super_user") {
        await client.query("UPDATE app_super_user SET password_salt = $1, password_proof_hash = $2, updated_at = NOW() WHERE user_id = $3", [nextSalt, sha256(nextProof), session.user_id]);
      }
      await client.query("DELETE FROM app_auth_sessions WHERE user_id = $1", [session.user_id]);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    const nextSession = await issueSession(pool, reply, session.user_id, session.active_workspace_id);
    return { ok: true, user: await hydratedUser(pool, { ...session, must_change_password: false, active_workspace_id: nextSession.workspaceId }) };
  });

  app.get("/api/v1/auth/users", async (request, reply) => {
    const administrator = await authenticated(pool, request);
    if (!administrator) return reply.code(401).send({ error: "sign in required" });
    if (!canAdministerUsers(administrator)) return reply.code(403).send({ error: "Super user access is required" });
    if (!administrator.active_workspace_id) return reply.code(409).send({ error: "select a workspace before managing users" });
    const result = await pool.query(`
      SELECT u.*, membership.role AS membership_role, COUNT(s.id)::int AS active_sessions
      FROM app_users u
      LEFT JOIN app_workspace_memberships membership ON membership.user_id = u.user_id AND membership.workspace_id = $1
      LEFT JOIN app_auth_sessions s ON s.user_id = u.user_id AND s.expires_at > NOW()
      GROUP BY u.user_id, membership.role
      ORDER BY CASE WHEN u.role = 'super_user' THEN 0 WHEN membership.role = 'administrator' THEN 1 WHEN membership.role = 'analyst' THEN 2 WHEN membership.role = 'viewer' THEN 3 ELSE 4 END,
        u.display_name
    `, [administrator.active_workspace_id]);
    return {
      users: result.rows.map((row) => ({ ...publicUser(row), activeSessions: row.active_sessions, isOwner: row.role === "super_user",
        workspaceRoleId: row.role === "super_user" ? "super_user" : row.membership_role || null, hasWorkspaceMembership: row.role === "super_user" || Boolean(row.membership_role) })),
      availableRoles: USER_ROLES,
    };
  });

  app.post("/api/v1/auth/users", async (request, reply) => {
    if (!assertSameOrigin(request, reply)) return;
    const administrator = await authenticated(pool, request);
    if (!administrator) return reply.code(401).send({ error: "sign in required" });
    if (!canAdministerUsers(administrator)) return reply.code(403).send({ error: "Super user access is required" });
    if (!administrator.active_workspace_id) return reply.code(409).send({ error: "select a workspace before managing users" });
    const email = cleanText(request.body?.email, 254).toLowerCase();
    const displayName = cleanText(request.body?.displayName, 80);
    const title = cleanText(request.body?.title, 80);
    const role = cleanText(request.body?.role, 32);
    const passwordSalt = cleanText(request.body?.passwordSalt, 128);
    const passwordProof = cleanText(request.body?.passwordProof, 64).toLowerCase();
    if (!validEmail(email) || displayName.length < 2 || !USER_ROLES.includes(role) || passwordSalt.length < 16 || !validProof(passwordProof)) {
      return reply.code(400).send({ error: "valid user details, role, and temporary password are required" });
    }
    const count = await pool.query("SELECT COUNT(*)::int AS count FROM app_workspace_memberships WHERE workspace_id = $1", [administrator.active_workspace_id]);
    if (count.rows[0].count >= 50) return reply.code(409).send({ error: "this workspace is limited to 50 human accounts" });
    try {
      const userId = randomUUID();
      const result = await pool.query(
        `INSERT INTO app_users
          (user_id, email, display_name, title, role, status, password_salt, password_proof_hash, must_change_password, created_by)
         VALUES ($1, $2, $3, $4, $5, 'active', $6, $7, TRUE, $8)
         RETURNING *`,
        [userId, email, displayName, title, "viewer", passwordSalt, sha256(passwordProof), administrator.user_id],
      );
      await pool.query(`INSERT INTO app_workspace_memberships (workspace_id, user_id, role, created_by)
        VALUES ($1, $2, $3, $4)`, [administrator.active_workspace_id, userId, role, administrator.user_id]);
      await recordUserActivity(pool, administrator, { eventType: "action", action: "account_created", surface: "users", targetType: "account", targetId: userId });
      return reply.code(201).send({ user: { ...publicUser({ ...result.rows[0], membership_role: role }), activeSessions: 0, isOwner: false } });
    } catch (error) {
      if (error.code === "23505") return reply.code(409).send({ error: "an account with that email already exists" });
      throw error;
    }
  });

  app.patch("/api/v1/auth/users/:userId", async (request, reply) => {
    if (!assertSameOrigin(request, reply)) return;
    const administrator = await authenticated(pool, request);
    if (!administrator) return reply.code(401).send({ error: "sign in required" });
    if (!canAdministerUsers(administrator)) return reply.code(403).send({ error: "Super user access is required" });
    const target = await pool.query(`SELECT u.*, membership.role AS membership_role FROM app_users u
      LEFT JOIN app_workspace_memberships membership ON membership.user_id = u.user_id AND membership.workspace_id = $2
      WHERE u.user_id = $1`, [request.params.userId, administrator.active_workspace_id]);
    if (!target.rowCount) return reply.code(404).send({ error: "user not found" });
    if (target.rows[0].role === "super_user") return reply.code(403).send({ error: "the Super user account is immutable in user management" });
    const email = cleanText(request.body?.email, 254).toLowerCase();
    const displayName = cleanText(request.body?.displayName, 80);
    const title = cleanText(request.body?.title, 80);
    const status = cleanText(request.body?.status, 32);
    if (!validEmail(email) || displayName.length < 2 || !USER_STATUSES.includes(status)) {
      return reply.code(400).send({ error: "valid account details and status are required" });
    }
    try {
      const result = await pool.query(
        `UPDATE app_users SET email = $1, display_name = $2, title = $3, status = $4, updated_at = NOW()
          WHERE user_id = $5 RETURNING *`,
        [email, displayName, title, status, request.params.userId],
      );
      if (status === "suspended") await pool.query("DELETE FROM app_auth_sessions WHERE user_id = $1", [request.params.userId]);
      await recordUserActivity(pool, administrator, { eventType: "action", action: status === target.rows[0].status ? "account_updated" : status === "suspended" ? "account_suspended" : "account_reactivated", surface: "users", targetType: "account", targetId: request.params.userId });
      return { user: { ...publicUser({ ...result.rows[0], membership_role: target.rows[0].membership_role }), activeSessions: 0, isOwner: false } };
    } catch (error) {
      if (error.code === "23505") return reply.code(409).send({ error: "an account with that email already exists" });
      throw error;
    }
  });

  app.post("/api/v1/auth/users/:userId/password", async (request, reply) => {
    if (!assertSameOrigin(request, reply)) return;
    const administrator = await authenticated(pool, request);
    if (!administrator) return reply.code(401).send({ error: "sign in required" });
    if (!canAdministerUsers(administrator)) return reply.code(403).send({ error: "Super user access is required" });
    const target = await pool.query("SELECT role FROM app_users WHERE user_id = $1", [request.params.userId]);
    if (!target.rowCount) return reply.code(404).send({ error: "user not found" });
    if (target.rows[0].role === "super_user") return reply.code(403).send({ error: "the Super user account is immutable in user management" });
    const passwordSalt = cleanText(request.body?.passwordSalt, 128);
    const passwordProof = cleanText(request.body?.passwordProof, 64).toLowerCase();
    if (passwordSalt.length < 16 || !validProof(passwordProof)) return reply.code(400).send({ error: "a valid temporary password is required" });
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        "UPDATE app_users SET password_salt = $1, password_proof_hash = $2, must_change_password = TRUE, updated_at = NOW() WHERE user_id = $3",
        [passwordSalt, sha256(passwordProof), request.params.userId],
      );
      await client.query("DELETE FROM app_auth_sessions WHERE user_id = $1", [request.params.userId]);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    await recordUserActivity(pool, administrator, { eventType: "action", action: "account_password_reset", surface: "users", targetType: "account", targetId: request.params.userId });
    return { ok: true };
  });

  app.get("/api/v1/auth/directory", async (request, reply) => {
    const user = await authenticated(pool, request);
    if (!user) return reply.code(401).send({ error: "sign in required" });
    if (!user.active_workspace_id) return reply.code(409).send({ error: "select a workspace first" });
    const result = await pool.query(`SELECT u.user_id, u.display_name, u.title, u.avatar_data_url, membership.role
      FROM app_workspace_memberships membership JOIN app_users u ON u.user_id = membership.user_id
      WHERE membership.workspace_id = $1 AND u.status = 'active' ORDER BY u.display_name`, [user.active_workspace_id]);
    return { users: result.rows.map((row) => ({ id: row.user_id, displayName: row.display_name, title: row.title, avatarDataUrl: row.avatar_data_url, roleId: row.role, role: ROLE_LABELS[row.role] || "Viewer" })) };
  });

  app.get("/api/v1/auth/workspaces", async (request, reply) => {
    const user = await authenticated(pool, request);
    if (!user) return reply.code(401).send({ error: "sign in required" });
    const [workspaces, memberships, requests] = await Promise.all([
      pool.query(`SELECT workspace.*, settings.icon_data_url, settings.header_eyebrow, settings.display_title,
          ai_preferences.auto_accept_event_augmentations
        FROM app_workspaces workspace LEFT JOIN app_workspace_settings settings ON settings.workspace_id = workspace.workspace_id
        LEFT JOIN app_workspace_ai_preferences ai_preferences ON ai_preferences.workspace_id = workspace.workspace_id
        WHERE workspace.status = 'active' ORDER BY workspace.name`),
      pool.query("SELECT workspace_id, role FROM app_workspace_memberships WHERE user_id = $1", [user.user_id]),
      pool.query("SELECT DISTINCT ON (workspace_id) workspace_id, status FROM app_workspace_access_requests WHERE user_id = $1 ORDER BY workspace_id, created_at DESC", [user.user_id]),
    ]);
    const membershipById = new Map(memberships.rows.map((row) => [String(row.workspace_id), row]));
    const requestById = new Map(requests.rows.map((row) => [String(row.workspace_id), row]));
    return { activeWorkspaceId: user.active_workspace_id, workspaces: workspaces.rows.map((workspace) => {
      const membership = membershipById.get(String(workspace.workspace_id));
      return { id: workspace.workspace_id, name: workspace.name, slug: workspace.slug, description: workspace.description,
        iconDataUrl: workspace.icon_data_url || "", headerEyebrow: workspace.header_eyebrow || DEFAULT_HEADER_EYEBROW,
        displayTitle: workspace.display_title || DEFAULT_DISPLAY_TITLE,
        autoAcceptAiAugmentations: Boolean(workspace.auto_accept_event_augmentations),
        status: workspace.status, ownerUserId: workspace.owner_user_id, roleId: membership?.role || null,
        role: membership ? ROLE_LABELS[membership.role] : null, requestStatus: requestById.get(String(workspace.workspace_id))?.status || null };
    }) };
  });

  app.post("/api/v1/auth/workspaces/:workspaceId/request", async (request, reply) => {
    if (!assertSameOrigin(request, reply)) return;
    const user = await authenticated(pool, request);
    if (!user) return reply.code(401).send({ error: "sign in required" });
    const membership = await pool.query("SELECT 1 FROM app_workspace_memberships WHERE workspace_id = $1 AND user_id = $2", [request.params.workspaceId, user.user_id]);
    if (membership.rowCount) return reply.code(409).send({ error: "you already have access to this workspace" });
    try {
      const requestId = randomUUID();
      await pool.query(`INSERT INTO app_workspace_access_requests (request_id, workspace_id, user_id, note)
        VALUES ($1, $2, $3, $4)`, [requestId, request.params.workspaceId, user.user_id, cleanText(request.body?.note, 500)]);
      return reply.code(201).send({ request: { id: requestId, workspaceId: request.params.workspaceId, status: "pending" } });
    } catch (error) {
      if (error.code === "23505") return reply.code(409).send({ error: "an access request is already pending" });
      throw error;
    }
  });

  app.post("/api/v1/auth/workspaces/:workspaceId/switch", async (request, reply) => {
    if (!assertSameOrigin(request, reply)) return;
    const user = await authenticated(pool, request);
    if (!user) return reply.code(401).send({ error: "sign in required" });
    const membership = await pool.query("SELECT role FROM app_workspace_memberships WHERE workspace_id = $1 AND user_id = $2", [request.params.workspaceId, user.user_id]);
    if (!membership.rowCount) return reply.code(403).send({ error: "workspace access is required" });
    await pool.query("UPDATE app_auth_sessions SET workspace_id = $1 WHERE id = $2", [request.params.workspaceId, user.id]);
    return { user: await hydratedUser(pool, { ...user, active_workspace_id: request.params.workspaceId, membership_role: membership.rows[0].role }) };
  });

  app.get("/api/v1/auth/workspace-admin", async (request, reply) => {
    const owner = await authenticated(pool, request);
    if (!owner) return reply.code(401).send({ error: "sign in required" });
    if (!canAdministerWorkspaces(owner)) return reply.code(403).send({ error: "Workspace manager access is required" });
    const isSuperUser = owner.role === "super_user";
    const [workspaces, members, requests, users] = await Promise.all([
      pool.query(`SELECT workspace.*, settings.icon_data_url, settings.header_eyebrow, settings.display_title,
        ai_preferences.auto_accept_event_augmentations,
        (SELECT COUNT(*)::int FROM app_workspace_memberships membership WHERE membership.workspace_id = workspace.workspace_id) AS member_count,
        (SELECT COUNT(*)::int FROM app_workspace_access_requests access_request WHERE access_request.workspace_id = workspace.workspace_id AND access_request.status = 'pending') AS pending_request_count
        FROM app_workspaces workspace LEFT JOIN app_workspace_settings settings ON settings.workspace_id = workspace.workspace_id
        LEFT JOIN app_workspace_ai_preferences ai_preferences ON ai_preferences.workspace_id = workspace.workspace_id
        WHERE ($1::boolean OR workspace.workspace_id = $2) ORDER BY workspace.status, workspace.name`, [isSuperUser, owner.active_workspace_id]),
      pool.query(`SELECT membership.*, u.email, u.display_name, u.title, u.status, u.avatar_data_url
        FROM app_workspace_memberships membership JOIN app_users u ON u.user_id = membership.user_id
        WHERE ($1::boolean OR membership.workspace_id = $2) ORDER BY u.display_name`, [isSuperUser, owner.active_workspace_id]),
      pool.query(`SELECT access_request.*, u.email, u.display_name, u.title, workspace.name AS workspace_name
        FROM app_workspace_access_requests access_request JOIN app_users u ON u.user_id = access_request.user_id
        JOIN app_workspaces workspace ON workspace.workspace_id = access_request.workspace_id
        WHERE ($1::boolean OR access_request.workspace_id = $2)
        ORDER BY CASE access_request.status WHEN 'pending' THEN 0 ELSE 1 END, access_request.created_at DESC`, [isSuperUser, owner.active_workspace_id]),
      isSuperUser
        ? pool.query("SELECT user_id, email, display_name, title, status, avatar_data_url FROM app_users WHERE status = 'active' ORDER BY display_name")
        : Promise.resolve({ rows: [] }),
    ]);
    return {
      workspaces: workspaces.rows.map((workspace) => ({ id: workspace.workspace_id, name: workspace.name, slug: workspace.slug,
        description: workspace.description, status: workspace.status, ownerUserId: workspace.owner_user_id,
        iconDataUrl: workspace.icon_data_url || "", headerEyebrow: workspace.header_eyebrow || DEFAULT_HEADER_EYEBROW,
        displayTitle: workspace.display_title || DEFAULT_DISPLAY_TITLE,
        autoAcceptAiAugmentations: Boolean(workspace.auto_accept_event_augmentations),
        createdAt: workspace.created_at, updatedAt: workspace.updated_at,
        pendingRequestCount: Number(workspace.pending_request_count || 0), lastActivityAt: null,
        contents: { trackedRecords: null, events: null, wallboardEvents: null, milestones: null, manualRecords: null, activityEntries: null, activeAgentKeys: null },
        members: members.rows.filter((member) => String(member.workspace_id) === String(workspace.workspace_id)).map((member) => ({ id: member.user_id,
          email: member.email, displayName: member.display_name, title: member.title, avatarDataUrl: member.avatar_data_url,
          status: member.status, roleId: member.role, role: ROLE_LABELS[member.role] })) })),
      requests: requests.rows.map((row) => ({ id: row.request_id, workspaceId: row.workspace_id, workspaceName: row.workspace_name,
        userId: row.user_id, email: row.email, displayName: row.display_name, title: row.title, note: row.note,
        status: row.status, createdAt: row.created_at, resolvedAt: row.resolved_at })),
      users: users.rows.map((row) => ({ id: row.user_id, email: row.email, displayName: row.display_name, title: row.title,
        avatarDataUrl: row.avatar_data_url, status: row.status })), availableRoles: USER_ROLES,
    };
  });

  app.post("/api/v1/auth/workspace-admin/workspaces", async (request, reply) => {
    if (!assertSameOrigin(request, reply)) return;
    const owner = await authenticated(pool, request);
    if (!owner) return reply.code(401).send({ error: "sign in required" });
    if (owner.role !== "super_user") return reply.code(403).send({ error: "Super user access is required" });
    const name = cleanText(request.body?.name, 80);
    const description = cleanText(request.body?.description, 240);
    const slug = cleanText(request.body?.slug || name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""), 80);
    if (name.length < 2 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) return reply.code(400).send({ error: "a valid workspace name is required" });
    const workspaceId = randomUUID();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(`INSERT INTO app_workspaces (workspace_id, name, slug, description, owner_user_id) VALUES ($1, $2, $3, $4, $5)`, [workspaceId, name, slug, description, owner.user_id]);
      await client.query(`INSERT INTO app_workspace_settings (workspace_id, header_eyebrow, display_title) VALUES ($1, $2, $3)`, [workspaceId, DEFAULT_HEADER_EYEBROW, DEFAULT_DISPLAY_TITLE]);
      await client.query(`INSERT INTO app_workspace_memberships (workspace_id, user_id, role, created_by) VALUES ($1, $2, 'super_user', $2)`, [workspaceId, owner.user_id]);
      await client.query("COMMIT");
      return reply.code(201).send({ workspace: { id: workspaceId, name, slug, description, roleId: "super_user", role: "Super user" } });
    } catch (error) {
      await client.query("ROLLBACK");
      if (error.code === "23505") return reply.code(409).send({ error: "a workspace with that name already exists" });
      throw error;
    } finally { client.release(); }
  });

  app.patch("/api/v1/auth/workspace-admin/workspaces/:workspaceId", async (request, reply) => {
    if (!assertSameOrigin(request, reply)) return;
    const owner = await authenticated(pool, request);
    if (!owner) return reply.code(401).send({ error: "sign in required" });
    if (!await canAdministerWorkspace(pool, owner, request.params.workspaceId)) return reply.code(403).send({ error: "Workspace manager access is required" });
    const name = cleanText(request.body?.name, 80);
    const description = cleanText(request.body?.description, 240);
    const iconDataUrl = validAvatar(request.body?.iconDataUrl);
    const headerEyebrow = cleanText(request.body?.headerEyebrow || DEFAULT_HEADER_EYEBROW, 80);
    const displayTitle = cleanText(request.body?.displayTitle || DEFAULT_DISPLAY_TITLE, 80);
    const currentAiPreference = await pool.query(`SELECT auto_accept_event_augmentations
      FROM app_workspace_ai_preferences WHERE workspace_id = $1`, [request.params.workspaceId]);
    const autoAcceptAiAugmentations = request.body?.autoAcceptAiAugmentations === undefined
      ? Boolean(currentAiPreference.rows[0]?.auto_accept_event_augmentations)
      : request.body.autoAcceptAiAugmentations === true;
    if (name.length < 2) return reply.code(400).send({ error: "a valid workspace name is required" });
    if (iconDataUrl === null || headerEyebrow.length < 2 || displayTitle.length < 2) return reply.code(400).send({ error: "valid workspace branding is required" });
    const duplicate = await pool.query("SELECT workspace_id FROM app_workspaces WHERE lower(name) = lower($1) AND workspace_id <> $2", [name, request.params.workspaceId]);
    if (duplicate.rowCount) return reply.code(409).send({ error: "a workspace with that name already exists" });
    const result = await pool.query(`UPDATE app_workspaces SET name = $1, description = $2, updated_at = NOW()
      WHERE workspace_id = $3 RETURNING *`, [name, description, request.params.workspaceId]);
    if (!result.rowCount) return reply.code(404).send({ error: "workspace not found" });
    await pool.query(`INSERT INTO app_workspace_settings (workspace_id, icon_data_url, header_eyebrow, display_title, updated_at)
      VALUES ($1, $2, $3, $4, NOW()) ON CONFLICT (workspace_id) DO UPDATE SET icon_data_url = EXCLUDED.icon_data_url,
      header_eyebrow = EXCLUDED.header_eyebrow, display_title = EXCLUDED.display_title, updated_at = NOW()`,
      [request.params.workspaceId, iconDataUrl, headerEyebrow, displayTitle]);
    await pool.query(`INSERT INTO app_workspace_ai_preferences
      (workspace_id, auto_accept_event_augmentations, updated_by, updated_at) VALUES ($1, $2, $3, NOW())
      ON CONFLICT (workspace_id) DO UPDATE SET auto_accept_event_augmentations = EXCLUDED.auto_accept_event_augmentations,
      updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
      [request.params.workspaceId, autoAcceptAiAugmentations, owner.user_id]);
    const workspace = result.rows[0];
    return { workspace: { id: workspace.workspace_id, name: workspace.name, slug: workspace.slug,
      description: workspace.description, status: workspace.status, ownerUserId: workspace.owner_user_id,
      iconDataUrl, headerEyebrow, displayTitle, autoAcceptAiAugmentations, createdAt: workspace.created_at, updatedAt: workspace.updated_at } };
  });

  app.post("/api/v1/auth/workspace-admin/requests/:requestId", async (request, reply) => {
    if (!assertSameOrigin(request, reply)) return;
    const owner = await authenticated(pool, request);
    if (!owner) return reply.code(401).send({ error: "sign in required" });
    const decision = cleanText(request.body?.decision, 20);
    const role = cleanText(request.body?.role, 32) || "viewer";
    if (!["approved", "denied"].includes(decision) || (decision === "approved" && !USER_ROLES.includes(role))) return reply.code(400).send({ error: "a valid approval decision and role are required" });
    const access = await pool.query("SELECT * FROM app_workspace_access_requests WHERE request_id = $1 AND status = 'pending'", [request.params.requestId]);
    if (!access.rowCount) return reply.code(404).send({ error: "pending access request not found" });
    const row = access.rows[0];
    if (!await canAdministerWorkspace(pool, owner, row.workspace_id)) return reply.code(403).send({ error: "Workspace manager access is required" });
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("UPDATE app_workspace_access_requests SET status = $1, resolved_by = $2, resolved_at = NOW(), updated_at = NOW() WHERE request_id = $3", [decision, owner.user_id, row.request_id]);
      if (decision === "approved") {
        await client.query(`INSERT INTO app_workspace_memberships (workspace_id, user_id, role, created_by) VALUES ($1, $2, $3, $4)
          ON CONFLICT (workspace_id, user_id) DO UPDATE SET role = EXCLUDED.role, updated_at = NOW()`, [row.workspace_id, row.user_id, role, owner.user_id]);
        await client.query("UPDATE app_auth_sessions SET workspace_id = $1 WHERE user_id = $2 AND workspace_id IS NULL", [row.workspace_id, row.user_id]);
      }
      await client.query("COMMIT");
      return { ok: true, status: decision };
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  });

  app.post("/api/v1/auth/workspace-admin/workspaces/:workspaceId/members", async (request, reply) => {
    if (!assertSameOrigin(request, reply)) return;
    const owner = await authenticated(pool, request);
    if (!owner) return reply.code(401).send({ error: "sign in required" });
    if (!await canAdministerWorkspace(pool, owner, request.params.workspaceId)) return reply.code(403).send({ error: "Workspace manager access is required" });
    const role = cleanText(request.body?.role, 32);
    if (!USER_ROLES.includes(role)) return reply.code(400).send({ error: "a valid workspace role is required" });
    const target = await pool.query("SELECT role, status FROM app_users WHERE user_id = $1", [request.body?.userId]);
    if (!target.rowCount || target.rows[0].status !== "active") return reply.code(400).send({ error: "an active user is required" });
    if (target.rows[0].role === "super_user") return reply.code(403).send({ error: "the Super user membership is immutable" });
    const existing = await pool.query("SELECT role FROM app_workspace_memberships WHERE workspace_id = $1 AND user_id = $2", [request.params.workspaceId, request.body?.userId]);
    if (!existing.rowCount && owner.role !== "super_user") return reply.code(403).send({ error: "Super user access is required to add an existing account" });
    await pool.query(`INSERT INTO app_workspace_memberships (workspace_id, user_id, role, created_by) VALUES ($1, $2, $3, $4)
      ON CONFLICT (workspace_id, user_id) DO UPDATE SET role = EXCLUDED.role, updated_at = NOW()`, [request.params.workspaceId, request.body?.userId, role, owner.user_id]);
    return reply.code(existing.rowCount ? 200 : 201).send({ ok: true });
  });

  app.delete("/api/v1/auth/workspace-admin/workspaces/:workspaceId/members/:userId", async (request, reply) => {
    if (!assertSameOrigin(request, reply)) return;
    const owner = await authenticated(pool, request);
    if (!owner) return reply.code(401).send({ error: "sign in required" });
    if (!await canAdministerWorkspace(pool, owner, request.params.workspaceId)) return reply.code(403).send({ error: "Workspace manager access is required" });
    const membership = await pool.query("SELECT role FROM app_workspace_memberships WHERE workspace_id = $1 AND user_id = $2", [request.params.workspaceId, request.params.userId]);
    if (!membership.rowCount) return reply.code(404).send({ error: "workspace member not found" });
    if (membership.rows[0].role === "super_user") return reply.code(403).send({ error: "the Super user cannot be removed from a workspace" });
    await pool.query("DELETE FROM app_workspace_memberships WHERE workspace_id = $1 AND user_id = $2", [request.params.workspaceId, request.params.userId]);
    await pool.query("UPDATE app_auth_sessions SET workspace_id = NULL WHERE workspace_id = $1 AND user_id = $2", [request.params.workspaceId, request.params.userId]);
    return { ok: true };
  });

  app.get("/api/v1/auth/openai-keys", async (request, reply) => {
    const user = await authenticated(pool, request);
    if (!user) return reply.code(401).send({ error: "sign in required" });
    const workspaceId = user.active_workspace_id || null;
    const canManageWorkspaceKeys = workspaceId ? await canAdministerWorkspace(pool, user, workspaceId) : false;
    const [personal, workspace] = await Promise.all([
      pool.query("SELECT * FROM app_openai_keys WHERE scope_type = 'user' AND user_id = $1 ORDER BY revoked_at NULLS FIRST, is_default DESC, created_at DESC", [user.user_id]),
      workspaceId && canManageWorkspaceKeys
        ? pool.query("SELECT * FROM app_openai_keys WHERE scope_type = 'workspace' AND workspace_id = $1 ORDER BY revoked_at NULLS FIRST, is_default DESC, created_at DESC", [workspaceId])
        : Promise.resolve({ rows: [] }),
    ]);
    const usage = await openAiKeyUsage(pool, [...personal.rows, ...workspace.rows].map((row) => row.id));
    const withUsage = (row) => ({ ...openAiKeyMetadata(row), usage: usage.get(String(row.id)) || { requestCount: 0, successCount: 0, failureCount: 0, inputTokens: 0, outputTokens: 0, averageLatencyMs: 0, lastRequestAt: null } });
    return {
      capability: {
        provider: "openai",
        encryptionReady: String(process.env.DBI_CREDENTIAL_ENCRYPTION_KEY || "").length >= 32,
        canManageWorkspaceKeys,
        activeWorkspaceId: workspaceId,
        queryRuntimeEnabled: String(process.env.DBI_CREDENTIAL_ENCRYPTION_KEY || "").length >= 32,
        loggingReady: true,
        retentionDays: 90,
        loggedFields: ["status", "latency", "tokens", "provider request ID", "trace ID", "retry count", "safe error"],
      },
      personalKeys: personal.rows.map(withUsage),
      workspaceKeys: workspace.rows.map(withUsage),
    };
  });

  app.get("/api/v1/auth/api-requests", async (request, reply) => {
    const user = await authenticated(pool, request);
    if (!user) return reply.code(401).send({ error: "sign in required" });
    if (!user.active_workspace_id) return { requests: [], summary: { retained: 0, requests: 0, succeeded: 0, failed: 0, successRate: null, averageLatencyMs: 0, p95LatencyMs: 0, inputTokens: 0, outputTokens: 0, retentionDays: 90 } };
    const allowed = await canAdministerWorkspace(pool, user, user.active_workspace_id);
    if (!allowed) return reply.code(403).send({ error: "Workspace manager access is required" });
    const result = await pool.query(`SELECT * FROM app_api_request_log WHERE workspace_id = $1 ORDER BY completed_at DESC LIMIT 500`, [user.active_workspace_id]);
    const calls = result.rows.filter((row) => row.request_kind !== "credential_lifecycle");
    const latencies = calls.map((row) => Number(row.latency_ms || 0)).sort((a, b) => a - b);
    const succeeded = calls.filter((row) => row.status === "succeeded").length;
    return {
      requests: result.rows.map((row) => ({ id: row.id, workspaceId: row.workspace_id, userId: row.user_id, principalType: row.principal_type,
        principalId: row.principal_id, requestKind: row.request_kind, provider: row.provider, operation: row.operation, method: row.method,
        route: row.route, status: row.status, httpStatus: row.http_status, stage: row.stage, model: row.model, credentialId: row.credential_id,
        credentialScope: row.credential_scope, providerRequestId: row.provider_request_id, traceId: row.trace_id, responseId: row.response_id,
        latencyMs: row.latency_ms, inputTokens: row.input_tokens, outputTokens: row.output_tokens, retryCount: row.retry_count,
        retryable: row.retryable, errorCode: row.error_code, errorMessage: row.error_message, metadata: row.metadata_json,
        startedAt: row.started_at, completedAt: row.completed_at })),
      summary: { retained: result.rowCount, requests: calls.length, succeeded, failed: calls.length - succeeded,
        successRate: calls.length ? Math.round((succeeded / calls.length) * 10_000) / 100 : null,
        averageLatencyMs: calls.length ? Math.round(calls.reduce((sum, row) => sum + Number(row.latency_ms || 0), 0) / calls.length) : 0,
        p95LatencyMs: latencies.length ? latencies[Math.min(latencies.length - 1, Math.ceil(latencies.length * 0.95) - 1)] : 0,
        inputTokens: calls.reduce((sum, row) => sum + Number(row.input_tokens || 0), 0), outputTokens: calls.reduce((sum, row) => sum + Number(row.output_tokens || 0), 0),
        retentionDays: 90, redaction: "Secrets, authorization headers, prompts, request bodies, and response bodies are never retained." },
    };
  });

  app.get("/api/v1/auth/event-ai/capability", async (request, reply) => {
    const user = await authenticated(pool, request);
    if (!user) return reply.code(401).send({ error: "sign in required" });
    const [personal, workspace, workspaceDefaults] = await Promise.all([
      pool.query("SELECT id, label, key_last_four, is_default FROM app_openai_keys WHERE scope_type = 'user' AND user_id = $1 AND revoked_at IS NULL ORDER BY is_default DESC, created_at DESC", [user.user_id]),
      user.active_workspace_id
        ? pool.query("SELECT id, label, key_last_four FROM app_openai_keys WHERE scope_type = 'workspace' AND workspace_id = $1 AND revoked_at IS NULL AND is_default = TRUE ORDER BY created_at DESC LIMIT 1", [user.active_workspace_id])
        : Promise.resolve({ rows: [] }),
      eventAiWorkspaceModelDefaults(pool, user.active_workspace_id),
    ]);
    const mockMode = String(process.env.DBI_EVENT_AI_MOCK_MODE || "").toLowerCase() === "true";
    const encryptionReady = String(process.env.DBI_CREDENTIAL_ENCRYPTION_KEY || "").length >= 32;
    return { capability: {
      available: canRunEventAi(user) && encryptionReady && Boolean(personal.rowCount || workspace.rowCount),
      canRun: canRunEventAi(user), mockMode,
      personalKeys: personal.rows.map((row) => ({ id: row.id, label: row.label, lastFour: row.key_last_four, isDefault: row.is_default })),
      workspaceDefault: workspace.rowCount ? { available: true, label: "Workspace default", lastFour: canAdministerWorkspaces(user) ? workspace.rows[0].key_last_four : "" } : { available: false, label: "Workspace default", lastFour: "" },
      canManageWorkspaceDefaults: canAdministerWorkspaces(user), workspaceModelDefaults: workspaceDefaults,
      producerModel: EVENT_AI_PRODUCER_MODEL, verifierModel: EVENT_AI_VERIFIER_MODEL, retentionDays: 90,
      workflow: ["research", "independent verification", "deterministic safe merge", "apply or review by workspace policy"],
    } };
  });

  app.get("/api/v1/auth/event-ai/models", async (request, reply) => {
    const user = await authenticated(pool, request);
    if (!user) return reply.code(401).send({ error: "sign in required" });
    if (!user.active_workspace_id) return reply.code(409).send({ error: "select a workspace before using AI assistance" });
    if (!canRunEventAi(user)) return reply.code(403).send({ error: "event write access is required" });
    const credentialScope = request.query?.credentialScope === "workspace" ? "workspace" : "user";
    try {
      const inventory = await eventAiModelInventory(pool, user, credentialScope, cleanText(request.query?.credentialId, 100));
      return { inventory: {
        models: inventory.models, inventoryCount: inventory.inventoryCount, retrievedAt: inventory.retrievedAt,
        producerModel: inventory.producerModel, verifierModel: inventory.verifierModel, workspaceDefaults: inventory.workspaceDefaults,
        credentialScope: inventory.credential.scope, source: "openai_models_api",
        capabilityNotice: "Availability is credential-specific. Compatibility with web search and structured outputs is proven when the workflow runs.",
      } };
    } catch (error) {
      return reply.code(error?.httpStatus || 502).send({ error: cleanText(error?.message || "OpenAI model inventory is unavailable", 500), code: cleanText(error?.code, 120) });
    }
  });

  app.patch("/api/v1/auth/event-ai/model-defaults", async (request, reply) => {
    if (!assertSameOrigin(request, reply)) return;
    const user = await authenticated(pool, request);
    if (!user) return reply.code(401).send({ error: "sign in required" });
    if (!user.active_workspace_id) return reply.code(409).send({ error: "select a workspace before configuring AI defaults" });
    if (!await canAdministerWorkspace(pool, user, user.active_workspace_id)) return reply.code(403).send({ error: "Workspace manager access is required" });
    try {
      const inventory = await eventAiModelInventory(pool, user, "workspace");
      const producerModel = cleanText(request.body?.producerModel, 180);
      const verifierModel = cleanText(request.body?.verifierModel, 180);
      assertEventAiModels(inventory.models, producerModel, verifierModel);
      const result = await pool.query(`INSERT INTO app_workspace_ai_settings
        (workspace_id, event_research_model, event_verification_model, updated_by, updated_at)
        VALUES ($1,$2,$3,$4,NOW())
        ON CONFLICT(workspace_id) DO UPDATE SET event_research_model = EXCLUDED.event_research_model,
          event_verification_model = EXCLUDED.event_verification_model, updated_by = EXCLUDED.updated_by, updated_at = NOW()
        RETURNING updated_at`, [user.active_workspace_id, producerModel, verifierModel, user.user_id]);
      return { defaults: { producerModel, verifierModel, updatedAt: result.rows[0].updated_at } };
    } catch (error) {
      return reply.code(error?.httpStatus || 502).send({ error: cleanText(error?.message || "Workspace model defaults could not be saved", 500), code: cleanText(error?.code, 120) });
    }
  });

  app.get("/api/v1/auth/event-ai", async (request, reply) => {
    const user = await authenticated(pool, request);
    if (!user) return reply.code(401).send({ error: "sign in required" });
    if (!user.active_workspace_id) return { jobs: [] };
    const result = await pool.query(EVENT_AI_RECENT_JOBS_SELECT, [user.active_workspace_id, user.user_id]);
    return { jobs: result.rows.map(eventAiJob) };
  });

  app.post("/api/v1/auth/event-ai", async (request, reply) => {
    if (!assertSameOrigin(request, reply)) return;
    const user = await authenticated(pool, request);
    if (!user) return reply.code(401).send({ error: "sign in required" });
    if (!user.active_workspace_id) return reply.code(409).send({ error: "select a workspace before using AI assistance" });
    if (!canRunEventAi(user)) return reply.code(403).send({ error: "event write access is required" });
    const draft = normalizeEventAiDraft(request.body?.draft || {});
    if (draft.title.length < 2) return reply.code(400).send({ error: "enter an event name before starting AI research" });
    const active = await pool.query("SELECT COUNT(*)::int AS count FROM app_event_ai_jobs WHERE workspace_id = $1 AND user_id = $2 AND status IN ('researching', 'verifying')", [user.active_workspace_id, user.user_id]);
    if (active.rows[0].count >= 3) return reply.code(429).send({ error: "wait for an active event-enrichment job to finish before starting another" });
    const daily = await pool.query("SELECT COUNT(*)::int AS count FROM app_event_ai_jobs WHERE workspace_id = $1 AND user_id = $2 AND created_at >= NOW() - INTERVAL '24 hours'", [user.active_workspace_id, user.user_id]);
    if (daily.rows[0].count >= 20) return reply.code(429).send({ error: "daily event-enrichment limit reached; try again after the oldest job is 24 hours old" });
    const credentialScope = request.body?.credentialScope === "workspace" ? "workspace" : "user";
    let inventory;
    try { inventory = await eventAiModelInventory(pool, user, credentialScope, cleanText(request.body?.credentialId, 100)); }
    catch (error) { return reply.code(error?.httpStatus || 502).send({ error: cleanText(error?.message || "OpenAI model inventory is unavailable", 500), code: cleanText(error?.code, 120) }); }
    const credential = inventory.credential;
    const producerModel = cleanText(request.body?.producerModel, 180) || inventory.producerModel;
    const verifierModel = cleanText(request.body?.verifierModel, 180) || inventory.verifierModel;
    try { assertEventAiModels(inventory.models, producerModel, verifierModel); }
    catch (error) { return reply.code(error.httpStatus || 409).send({ error: error.message, code: error.code }); }
    const id = randomUUID();
    const traceId = randomUUID();
    const direction = cleanText(request.body?.direction, 2000);
    let result = await pool.query(`INSERT INTO app_event_ai_jobs
      (id, workspace_id, user_id, status, current_step, credential_id, credential_scope, producer_model, verifier_model,
       direction, input_snapshot_json, categories_json, trace_id)
      VALUES ($1,$2,$3,'researching','public_research',$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11) RETURNING *`, [
      id, user.active_workspace_id, user.user_id, credential.id, credential.scope, producerModel, verifierModel,
      direction, JSON.stringify(draft), JSON.stringify(EVENT_AI_CATEGORIES), traceId,
    ]);
    let row = result.rows[0];
    const mockMode = String(process.env.DBI_EVENT_AI_MOCK_MODE || "").toLowerCase() === "true";
    try {
      let responseId = `mock-producer-${id}`;
      if (!mockMode) {
        const started = await startOpenAiBackgroundResponse(credential.apiKey, buildEventAiProducerRequest({ draft, direction, categories: EVENT_AI_CATEGORIES, model: producerModel }));
        responseId = started.response.id;
        await logEventAiProvider(pool, row, started.response, "research", "accepted", started.latencyMs, started.requestId);
      }
      result = await pool.query("UPDATE app_event_ai_jobs SET producer_response_id = $1, updated_at = NOW() WHERE id = $2 RETURNING *", [responseId, id]);
      row = result.rows[0];
    } catch (error) {
      row = await failEventAiJob(pool, row, error);
      await logEventAiProvider(pool, row, null, "research", "failed", 0, "", error).catch(() => {});
    }
    return reply.code(202).send({ job: eventAiJob(row) });
  });

  app.get("/api/v1/auth/event-ai/:jobId", async (request, reply) => {
    const user = await authenticated(pool, request);
    if (!user) return reply.code(401).send({ error: "sign in required" });
    const result = await pool.query("SELECT * FROM app_event_ai_jobs WHERE id = $1 AND workspace_id = $2 AND user_id = $3", [request.params.jobId, user.active_workspace_id, user.user_id]);
    if (!result.rowCount) return reply.code(404).send({ error: "event-enrichment job not found" });
    const advanced = await advanceEventAiJob(pool, result.rows[0]);
    const decorated = await eventAiJobWithDiagnostic(pool, advanced.id, user.active_workspace_id, user.user_id);
    return { job: eventAiJob(decorated || advanced) };
  });

  app.post("/api/v1/auth/openai-keys", async (request, reply) => {
    if (!assertSameOrigin(request, reply)) return;
    const user = await authenticated(pool, request);
    if (!user) return reply.code(401).send({ error: "sign in required" });
    const scope = cleanText(request.body?.scope, 20);
    const label = cleanText(request.body?.label, 80);
    const apiKey = validOpenAiKey(request.body?.apiKey);
    if (!['workspace', 'user'].includes(scope) || label.length < 2 || !apiKey) return reply.code(400).send({ error: "a valid scope, label, and OpenAI API key are required" });
    if (scope === "workspace" && (!user.active_workspace_id || !await canAdministerWorkspace(pool, user, user.active_workspace_id))) return reply.code(403).send({ error: "Workspace manager access is required" });
    const encrypted = encryptOpenAiKey(apiKey);
    if (!encrypted) return reply.code(503).send({ error: "OpenAI key storage is not configured on this runtime" });
    const scopeId = scope === "workspace" ? user.active_workspace_id : user.user_id;
    const existing = await pool.query(`SELECT COUNT(*)::int AS count FROM app_openai_keys WHERE scope_type = $1 AND ${scope === "workspace" ? "workspace_id" : "user_id"} = $2 AND revoked_at IS NULL`, [scope, scopeId]);
    if (existing.rows[0].count >= 10) return reply.code(409).send({ error: "revoke an existing OpenAI key before adding another" });
    const isDefault = Boolean(request.body?.isDefault) || existing.rows[0].count === 0;
    const id = randomUUID();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      if (isDefault) await client.query(`UPDATE app_openai_keys SET is_default = FALSE, updated_at = NOW() WHERE scope_type = $1 AND ${scope === "workspace" ? "workspace_id" : "user_id"} = $2 AND revoked_at IS NULL`, [scope, scopeId]);
      const result = await client.query(`INSERT INTO app_openai_keys
        (id, scope_type, workspace_id, user_id, label, encrypted_key, key_iv, key_version, key_last_four, is_default, created_by)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`, [
        id, scope, scope === "workspace" ? user.active_workspace_id : null, scope === "user" ? user.user_id : null,
        label, encrypted.encryptedKey, encrypted.keyIv, encrypted.keyVersion, apiKey.slice(-4), isDefault, user.user_id,
      ]);
      await recordApiRequest(client, { workspaceId: user.active_workspace_id, userId: user.user_id, principalType: "user", principalId: user.user_id,
        requestKind: "credential_lifecycle", provider: "openai", operation: "credential.created", status: "accepted", httpStatus: 201,
        credentialId: id, credentialScope: scope, metadata: { label, isDefault } });
      await client.query("COMMIT");
      return reply.code(201).send({ key: openAiKeyMetadata(result.rows[0]) });
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
  });

  app.patch("/api/v1/auth/openai-keys/:keyId", async (request, reply) => {
    if (!assertSameOrigin(request, reply)) return;
    const user = await authenticated(pool, request);
    if (!user) return reply.code(401).send({ error: "sign in required" });
    const result = await pool.query("SELECT * FROM app_openai_keys WHERE id = $1", [request.params.keyId]);
    if (!result.rowCount) return reply.code(404).send({ error: "OpenAI key not found" });
    const stored = result.rows[0];
    const authorized = stored.scope_type === "user"
      ? String(stored.user_id) === String(user.user_id)
      : String(stored.workspace_id) === String(user.active_workspace_id) && await canAdministerWorkspace(pool, user, stored.workspace_id);
    if (!authorized) return reply.code(403).send({ error: "credential management access is required" });
    if (stored.revoked_at) return reply.code(409).send({ error: "OpenAI key is already revoked" });
    const label = cleanText(request.body?.label ?? stored.label, 80);
    const nextApiKey = request.body?.apiKey ? validOpenAiKey(request.body.apiKey) : "";
    if (label.length < 2 || (request.body?.apiKey && !nextApiKey)) return reply.code(400).send({ error: "a valid label and OpenAI API key are required" });
    const encrypted = nextApiKey ? encryptOpenAiKey(nextApiKey) : null;
    if (nextApiKey && !encrypted) return reply.code(503).send({ error: "OpenAI key storage is not configured on this runtime" });
    const makeDefault = Boolean(request.body?.isDefault);
    const scopeId = stored.scope_type === "workspace" ? stored.workspace_id : stored.user_id;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      if (makeDefault) await client.query(`UPDATE app_openai_keys SET is_default = FALSE, updated_at = NOW() WHERE scope_type = $1 AND ${stored.scope_type === "workspace" ? "workspace_id" : "user_id"} = $2 AND revoked_at IS NULL`, [stored.scope_type, scopeId]);
      const updated = await client.query(`UPDATE app_openai_keys SET label = $1, encrypted_key = $2, key_iv = $3, key_version = $4,
        key_last_four = $5, is_default = $6, updated_at = NOW() WHERE id = $7 AND revoked_at IS NULL RETURNING *`, [
        label, encrypted?.encryptedKey || stored.encrypted_key, encrypted?.keyIv || stored.key_iv, encrypted?.keyVersion || stored.key_version,
        nextApiKey ? nextApiKey.slice(-4) : stored.key_last_four, makeDefault || stored.is_default, stored.id,
      ]);
      await recordApiRequest(client, { workspaceId: user.active_workspace_id, userId: user.user_id, principalType: "user", principalId: user.user_id,
        requestKind: "credential_lifecycle", provider: "openai", operation: nextApiKey ? "credential.rotated" : makeDefault ? "credential.default_changed" : "credential.updated",
        status: "accepted", httpStatus: 200, credentialId: stored.id, credentialScope: stored.scope_type,
        metadata: { label, madeDefault: makeDefault, rotated: Boolean(nextApiKey) } });
      await client.query("COMMIT");
      return { key: openAiKeyMetadata(updated.rows[0]) };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
  });

  app.delete("/api/v1/auth/openai-keys/:keyId", async (request, reply) => {
    if (!assertSameOrigin(request, reply)) return;
    const user = await authenticated(pool, request);
    if (!user) return reply.code(401).send({ error: "sign in required" });
    const result = await pool.query("SELECT * FROM app_openai_keys WHERE id = $1", [request.params.keyId]);
    if (!result.rowCount) return reply.code(404).send({ error: "OpenAI key not found" });
    const stored = result.rows[0];
    const authorized = stored.scope_type === "user"
      ? String(stored.user_id) === String(user.user_id)
      : String(stored.workspace_id) === String(user.active_workspace_id) && await canAdministerWorkspace(pool, user, stored.workspace_id);
    if (!authorized) return reply.code(403).send({ error: "credential management access is required" });
    if (stored.revoked_at) return reply.code(409).send({ error: "OpenAI key is already revoked" });
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("UPDATE app_openai_keys SET revoked_at = NOW(), is_default = FALSE, updated_at = NOW() WHERE id = $1", [stored.id]);
      await recordApiRequest(client, { workspaceId: user.active_workspace_id, userId: user.user_id, principalType: "user", principalId: user.user_id,
        requestKind: "credential_lifecycle", provider: "openai", operation: "credential.revoked", status: "accepted", httpStatus: 200,
        credentialId: stored.id, credentialScope: stored.scope_type, metadata: { label: stored.label } });
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
    return { ok: true };
  });

  if (required) {
    app.addHook("preHandler", async (request, reply) => {
      if (!request.url.startsWith("/api/v1/") || request.url.startsWith("/api/v1/auth/") || request.url.startsWith("/api/v1/client-errors")) return;
      if (!await authenticated(pool, request)) return reply.code(401).send({ error: "sign in required" });
    });
  }
}
