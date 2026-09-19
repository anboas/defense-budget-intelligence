const PROVIDERS = Object.freeze({
  "sam-gov": { id: "sam_gov", label: "SAM.gov" },
});

function metadata(row) {
  return {
    id: row.id,
    provider: row.provider,
    label: row.label,
    lastFour: row.secret_last_four,
    status: row.revoked_at ? "revoked" : "active",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    revokedAt: row.revoked_at || null,
    lastUsedAt: row.last_used_at || null,
  };
}

function validSecret(value) {
  const secret = String(value || "").trim();
  return secret.length >= 20 && secret.length <= 160 && /^[A-Za-z0-9._-]+$/.test(secret) ? secret : "";
}

export async function providerCredentialsResponse(request, db, env, deps) {
  const { canAdministerWorkspaces, cleanText, encryptSecret, json, recordActivity, recordApiRequest, safeJson, sameOriginRequest, sessionUser } = deps;
  if (!sameOriginRequest(request)) return json({ error: "Cross-origin credential management is not allowed" }, 403);
  const session = await sessionUser(db, request);
  if (!session) return json({ error: "Sign in required" }, 401);
  const workspaceId = session.active_workspace_id || "";
  if (!workspaceId) return json({ error: "Select a workspace before managing provider credentials" }, 409);
  if (!canAdministerWorkspaces(session)) return json({ error: "Workspace manager access is required" }, 403);

  const pathname = new URL(request.url).pathname.replace(/\/+$/, "");
  const prefix = "/api/v1/auth/provider-credentials/";
  const segments = pathname.slice(prefix.length).split("/").filter(Boolean).map((value) => decodeURIComponent(value));
  const provider = PROVIDERS[cleanText(segments[0], 40)];
  const credentialId = cleanText(segments[1], 80);
  if (!provider) return json({ error: "Unknown credential provider" }, 404);
  const encryptionReady = String(env.DBI_CREDENTIAL_ENCRYPTION_KEY || "").length >= 32;

  if (request.method === "GET" && !credentialId) {
    const result = await db.prepare(`SELECT * FROM dbi_workspace_provider_credentials
      WHERE workspace_id = ? AND provider = ? ORDER BY revoked_at, created_at DESC`).bind(workspaceId, provider.id).all();
    return json({
      capability: {
        provider: provider.id,
        providerLabel: provider.label,
        encryptionReady,
        canManage: true,
        activeWorkspaceId: workspaceId,
        runtimeScope: "workspace",
        scheduledSnapshotMode: "workspace-runtime",
      },
      credentials: (result.results || []).map(metadata),
    });
  }

  if (request.method === "POST" && !credentialId) {
    if (!encryptionReady) return json({ error: `${provider.label} credential storage is not configured on this runtime` }, 503);
    const body = await safeJson(request);
    const label = cleanText(body?.label, 80);
    const secret = validSecret(body?.apiKey);
    if (label.length < 2 || !secret) return json({ error: `A label and valid ${provider.label} API key are required` }, 400);
    const encrypted = await encryptSecret(secret, env);
    if (!encrypted) return json({ error: `${provider.label} credential storage is not configured on this runtime` }, 503);
    const existing = await db.prepare(`SELECT id FROM dbi_workspace_provider_credentials
      WHERE workspace_id = ? AND provider = ? AND revoked_at = '' LIMIT 1`).bind(workspaceId, provider.id).first();
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const statements = [];
    if (existing?.id) statements.push(db.prepare(`UPDATE dbi_workspace_provider_credentials
      SET revoked_at = ?, updated_at = ? WHERE id = ? AND revoked_at = ''`).bind(now, now, existing.id));
    statements.push(db.prepare(`INSERT INTO dbi_workspace_provider_credentials
      (id, workspace_id, provider, label, encrypted_secret, secret_iv, secret_version, secret_last_four, created_by, created_at, updated_at, revoked_at, last_used_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', '')`).bind(
      id, workspaceId, provider.id, label, encrypted.encryptedKey, encrypted.keyIv, encrypted.keyVersion,
      secret.slice(-4), session.user_id, now, now,
    ));
    await db.batch(statements);
    await recordApiRequest(db, {
      workspaceId, userId: session.user_id, principalType: "user", principalId: session.user_id,
      requestKind: "credential_lifecycle", provider: provider.id, operation: existing?.id ? "credential.replaced" : "credential.created",
      method: request.method, route: `${prefix}${segments[0]}`, status: "succeeded", httpStatus: 201,
      stage: "credential_management", credentialScope: "workspace", metadata: { label, providerCredentialId: id },
    });
    await recordActivity(db, { type: "user", id: session.user_id, workspaceId }, "provider_credential_saved", "provider_credential", id, { provider: provider.id, label, replaced: Boolean(existing?.id) });
    return json({ credential: metadata({ id, provider: provider.id, label, secret_last_four: secret.slice(-4), created_at: now, updated_at: now, revoked_at: "", last_used_at: "" }) }, 201);
  }

  if (!credentialId) return json({ error: "Method not allowed" }, 405);
  const stored = await db.prepare(`SELECT * FROM dbi_workspace_provider_credentials
    WHERE id = ? AND workspace_id = ? AND provider = ?`).bind(credentialId, workspaceId, provider.id).first();
  if (!stored) return json({ error: `${provider.label} credential not found` }, 404);
  if (request.method === "DELETE") {
    if (stored.revoked_at) return json({ error: `${provider.label} credential is already revoked` }, 409);
    const now = new Date().toISOString();
    await db.prepare("UPDATE dbi_workspace_provider_credentials SET revoked_at = ?, updated_at = ? WHERE id = ?").bind(now, now, credentialId).run();
    await recordApiRequest(db, {
      workspaceId, userId: session.user_id, principalType: "user", principalId: session.user_id,
      requestKind: "credential_lifecycle", provider: provider.id, operation: "credential.revoked", method: request.method,
      route: `${prefix}${segments[0]}/${credentialId}`, status: "succeeded", httpStatus: 200,
      stage: "credential_management", credentialScope: "workspace", metadata: { label: stored.label, providerCredentialId: credentialId },
    });
    await recordActivity(db, { type: "user", id: session.user_id, workspaceId }, "provider_credential_revoked", "provider_credential", credentialId, { provider: provider.id, label: stored.label });
    return json({ ok: true });
  }
  return json({ error: "Method not allowed" }, 405);
}
