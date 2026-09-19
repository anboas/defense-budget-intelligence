import { randomUUID } from "node:crypto";

const PROVIDERS = Object.freeze({
  "sam-gov": { id: "sam_gov", label: "SAM.gov" },
});

function credentialMetadata(row) {
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

export function registerProviderCredentialRoutes(app, pool, deps) {
  const { assertSameOrigin, authenticated, canAdministerWorkspace, cleanText, encryptSecret, recordApiRequest } = deps;

  async function context(request, reply) {
    const user = await authenticated(pool, request);
    if (!user) { reply.code(401).send({ error: "sign in required" }); return null; }
    const workspaceId = user.active_workspace_id || null;
    if (!workspaceId) { reply.code(409).send({ error: "Select a workspace before managing provider credentials" }); return null; }
    if (!await canAdministerWorkspace(pool, user, workspaceId)) { reply.code(403).send({ error: "Workspace manager access is required" }); return null; }
    const provider = PROVIDERS[cleanText(request.params.provider, 40)];
    if (!provider) { reply.code(404).send({ error: "Unknown credential provider" }); return null; }
    return { user, workspaceId, provider };
  }

  app.get("/api/v1/auth/provider-credentials/:provider", async (request, reply) => {
    if (!assertSameOrigin(request, reply)) return;
    const current = await context(request, reply);
    if (!current) return;
    const result = await pool.query(`SELECT * FROM app_workspace_provider_credentials
      WHERE workspace_id = $1 AND provider = $2 ORDER BY revoked_at NULLS FIRST, created_at DESC`, [current.workspaceId, current.provider.id]);
    return {
      capability: {
        provider: current.provider.id,
        providerLabel: current.provider.label,
        encryptionReady: String(process.env.DBI_CREDENTIAL_ENCRYPTION_KEY || "").length >= 32,
        canManage: true,
        activeWorkspaceId: current.workspaceId,
        runtimeScope: "workspace",
        scheduledSnapshotMode: "workspace-runtime",
      },
      credentials: result.rows.map(credentialMetadata),
    };
  });

  app.post("/api/v1/auth/provider-credentials/:provider", async (request, reply) => {
    if (!assertSameOrigin(request, reply)) return;
    const current = await context(request, reply);
    if (!current) return;
    const label = cleanText(request.body?.label, 80);
    const secret = validSecret(request.body?.apiKey);
    if (label.length < 2 || !secret) return reply.code(400).send({ error: `A label and valid ${current.provider.label} API key are required` });
    const encrypted = encryptSecret(secret);
    if (!encrypted) return reply.code(503).send({ error: `${current.provider.label} credential storage is not configured on this runtime` });
    const client = await pool.connect();
    const id = randomUUID();
    let replaced;
    try {
      await client.query("BEGIN");
      const existing = await client.query(`UPDATE app_workspace_provider_credentials SET revoked_at = NOW(), updated_at = NOW()
        WHERE workspace_id = $1 AND provider = $2 AND revoked_at IS NULL RETURNING id`, [current.workspaceId, current.provider.id]);
      replaced = Boolean(existing.rowCount);
      await client.query(`INSERT INTO app_workspace_provider_credentials
        (id, workspace_id, provider, label, encrypted_secret, secret_iv, secret_version, secret_last_four, created_by)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [
        id, current.workspaceId, current.provider.id, label, encrypted.encryptedKey, encrypted.keyIv,
        encrypted.keyVersion, secret.slice(-4), current.user.user_id,
      ]);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    await recordApiRequest(pool, {
      workspaceId: current.workspaceId, userId: current.user.user_id, principalType: "user", principalId: current.user.user_id,
      requestKind: "credential_lifecycle", provider: current.provider.id, operation: replaced ? "credential.replaced" : "credential.created",
      method: request.method, route: `/api/v1/auth/provider-credentials/${request.params.provider}`, status: "succeeded", httpStatus: 201,
      stage: "credential_management", credentialScope: "workspace", metadata: { label, providerCredentialId: id },
    });
    const now = new Date().toISOString();
    return reply.code(201).send({ credential: credentialMetadata({ id, provider: current.provider.id, label, secret_last_four: secret.slice(-4), created_at: now, updated_at: now }) });
  });

  app.delete("/api/v1/auth/provider-credentials/:provider/:credentialId", async (request, reply) => {
    if (!assertSameOrigin(request, reply)) return;
    const current = await context(request, reply);
    if (!current) return;
    const result = await pool.query(`UPDATE app_workspace_provider_credentials SET revoked_at = NOW(), updated_at = NOW()
      WHERE id = $1 AND workspace_id = $2 AND provider = $3 AND revoked_at IS NULL RETURNING *`, [request.params.credentialId, current.workspaceId, current.provider.id]);
    if (!result.rowCount) return reply.code(404).send({ error: `${current.provider.label} credential not found` });
    await recordApiRequest(pool, {
      workspaceId: current.workspaceId, userId: current.user.user_id, principalType: "user", principalId: current.user.user_id,
      requestKind: "credential_lifecycle", provider: current.provider.id, operation: "credential.revoked", method: request.method,
      route: `/api/v1/auth/provider-credentials/${request.params.provider}/${request.params.credentialId}`, status: "succeeded", httpStatus: 200,
      stage: "credential_management", credentialScope: "workspace", metadata: { label: result.rows[0].label, providerCredentialId: request.params.credentialId },
    });
    return { ok: true };
  });
}
