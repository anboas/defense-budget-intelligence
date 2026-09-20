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

function mutationPolicy(pathname, method) {
  if (["GET", "HEAD", "OPTIONS"].includes(method)) return null;
  if (pathname.startsWith("/api/v1/auth/registration")) return { scope: "registration", limit: 20 };
  if (pathname === "/api/v1/auth/emulation") return { scope: "emulation", limit: 30 };
  if (pathname.startsWith("/api/v1/auth/provider-credentials/") || pathname.startsWith("/api/v1/auth/openai-keys")) return { scope: "credentials", limit: 40 };
  if (pathname.startsWith("/api/v1/auth/users") || pathname.startsWith("/api/v1/auth/workspace-admin") || pathname.startsWith("/api/v1/auth/control-plane")) return { scope: "administration", limit: 60 };
  if (pathname.startsWith("/api/v1/auth/acquisition/")) return { scope: "acquisition", limit: 120 };
  return null;
}

export async function enforceD1SensitiveMutationLimit(request, db, pathname, { hashValue, json }) {
  const policy = mutationPolicy(pathname, request.method);
  if (!policy) return null;
  const ip = request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for") || "local";
  const fingerprint = await hashValue(`${policy.scope}|${ip}`);
  const keyHash = await hashValue(`${policy.scope}|${fingerprint}`);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 15 * 60_000);
  await db.prepare(`INSERT INTO dbi_sensitive_rate_limits
    (key_hash, scope, request_count, window_started_at, expires_at) VALUES (?, ?, 1, ?, ?)
    ON CONFLICT(key_hash) DO UPDATE SET
      request_count = CASE WHEN expires_at <= excluded.window_started_at THEN 1 ELSE request_count + 1 END,
      window_started_at = CASE WHEN expires_at <= excluded.window_started_at THEN excluded.window_started_at ELSE window_started_at END,
      expires_at = CASE WHEN expires_at <= excluded.window_started_at THEN excluded.expires_at ELSE expires_at END`)
    .bind(keyHash, policy.scope, now.toISOString(), expiresAt.toISOString()).run();
  const row = await db.prepare("SELECT request_count, expires_at FROM dbi_sensitive_rate_limits WHERE key_hash = ?").bind(keyHash).first();
  if (Number(row?.request_count || 0) <= policy.limit) return null;
  const retryAfter = Math.max(1, Math.ceil((Date.parse(row.expires_at) - Date.now()) / 1000));
  return json({ error: "Too many sensitive account operations; try again later" }, 429, { "retry-after": String(retryAfter) });
}
