export const D1_SENSITIVE_RATE_LIMIT_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS dbi_sensitive_rate_limits (
    key_hash TEXT PRIMARY KEY,
    scope TEXT NOT NULL,
    request_count INTEGER NOT NULL DEFAULT 0,
    window_started_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
  )`,
  "CREATE INDEX IF NOT EXISTS idx_dbi_sensitive_rate_limits_expires ON dbi_sensitive_rate_limits (expires_at)",
];

export const AI_OPERATION_LIMIT = 12;
export const AI_OPERATION_WINDOW_MINUTES = 15;

async function digest(value) {
  const bytes = new TextEncoder().encode(String(value || ""));
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map((value) => value.toString(16).padStart(2, "0")).join("");
}

async function consumeLimit(db, keyHash, scope, limit, windowMinutes) {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + windowMinutes * 60_000);
  await db.prepare(`INSERT INTO dbi_sensitive_rate_limits
    (key_hash, scope, request_count, window_started_at, expires_at) VALUES (?, ?, 1, ?, ?)
    ON CONFLICT(key_hash) DO UPDATE SET
      request_count = CASE WHEN expires_at <= excluded.window_started_at THEN 1 ELSE request_count + 1 END,
      window_started_at = CASE WHEN expires_at <= excluded.window_started_at THEN excluded.window_started_at ELSE window_started_at END,
      expires_at = CASE WHEN expires_at <= excluded.window_started_at THEN excluded.expires_at ELSE expires_at END`)
    .bind(keyHash, scope, now.toISOString(), expiresAt.toISOString()).run();
  const row = await db.prepare("SELECT request_count, expires_at FROM dbi_sensitive_rate_limits WHERE key_hash = ?").bind(keyHash).first();
  const retryAfter = Math.max(1, Math.ceil((Date.parse(row?.expires_at || expiresAt.toISOString()) - Date.now()) / 1000));
  return { limited: Number(row?.request_count || 0) > limit, retryAfter };
}

export async function consumeD1AiOperationLimit(db, principal, scope = "record_ai") {
  const actorId = principal?.actorId || principal?.id || "anonymous";
  const workspaceId = principal?.workspaceId || "unassigned";
  const keyHash = await digest(`${scope}|${workspaceId}|${principal?.type || "user"}|${actorId}`);
  return consumeLimit(db, keyHash, scope, AI_OPERATION_LIMIT, AI_OPERATION_WINDOW_MINUTES);
}

function mutationPolicy(pathname, method) {
  if (["GET", "HEAD", "OPTIONS"].includes(method)) return null;
  if (pathname.startsWith("/api/v1/auth/registration")) return { scope: "registration", limit: 20 };
  if (pathname === "/api/v1/auth/emulation") return { scope: "emulation", limit: 30 };
  if (pathname.startsWith("/api/v1/auth/provider-credentials/") || pathname.startsWith("/api/v1/auth/openai-keys")) return { scope: "credentials", limit: 40 };
  if (pathname.startsWith("/api/v1/auth/users") || pathname.startsWith("/api/v1/auth/workspace-admin") || pathname.startsWith("/api/v1/auth/control-plane")) return { scope: "administration", limit: 60 };
  if (pathname.startsWith("/api/v1/auth/acquisition/")) return { scope: "acquisition", limit: 120 };
  if (pathname.startsWith("/api/v1/auth/research-operations/")) return { scope: "research_operations", limit: 60 };
  return null;
}

export async function enforceD1SensitiveMutationLimit(request, db, pathname, { hashValue, json }) {
  const policy = mutationPolicy(pathname, request.method);
  if (!policy) return null;
  const ip = request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for") || "local";
  const fingerprint = await hashValue(`${policy.scope}|${ip}`);
  const keyHash = await hashValue(`${policy.scope}|${fingerprint}`);
  const result = await consumeLimit(db, keyHash, policy.scope, policy.limit, 15);
  if (!result.limited) return null;
  const retryAfter = result.retryAfter;
  return json({ error: "Too many sensitive account operations; try again later" }, 429, { "retry-after": String(retryAfter) });
}
