# Threat model

## Scope and security objectives

DBI combines public federal financial/acquisition data with private workspace state, human identities, automation credentials, and external-provider access. The priorities are:

1. prevent cross-workspace or unauthorized disclosure;
2. prevent unauthorized mutation or privileged action;
3. protect restricted credentials and sessions;
4. preserve source provenance and historical integrity;
5. keep ingestion, delivery, and operational monitoring available without turning upstream failure into false data.

## Trust boundaries

```text
Untrusted browser
  -> Cloudflare edge / Fastify HTTP boundary
    -> session or scoped-agent authorization
      -> D1 / PostgreSQL workspace state
      -> encrypted credential vault
      -> public data projections
      -> SAM.gov / USAspending / OpenAI / Resend

GitHub contributor or dependency update
  -> pinned CI and security analysis
    -> exact build artifact
      -> Cloudflare Pages and scheduler Worker
```

Public source content, browser input, provider output, issue text, and repository contributions are untrusted. An authenticated user is trusted only for the scopes granted by the current role and workspace.

## Threat actors

- anonymous Internet attacker seeking account takeover, resource exhaustion, or source/data tampering;
- authenticated Viewer, Analyst, or Manager attempting privilege or workspace escalation;
- compromised Super-user browser or stolen session;
- leaked agent/provider/scheduler credential;
- malicious or compromised dependency, GitHub Action, container base, or source dataset;
- upstream service failure or adversarial provider payload;
- mistaken maintainer or automation performing an over-broad destructive action.

## Abuse cases and controls

| Abuse case | Primary controls | Residual risk |
| --- | --- | --- |
| Credential stuffing or account-creation abuse | No public-open registration; real-Super-controlled closed/invite-only policy; 128-bit one-time expiring codes stored only as hashes; optional email binding; Viewer-only account creation without workspace membership; PBKDF2 proofs, generic login errors, identity/IP attempt limits, secure cookies | No phishing-resistant MFA yet |
| CSRF or cross-origin write | SameSite Strict, same-origin/Fetch Metadata checks, no permissive CORS | Stolen same-origin session remains powerful |
| XSS and browser injection | React escaping, no dynamic-code sinks, restrictive CSP, no inline scripts, bounded URLs | Inline style attributes remain explicitly allowed |
| Workspace data escape | Server-side workspace predicates, role checks beside storage, parity contracts | New routes can regress if not covered |
| Super-user abuse | Real-actor audit, emulation denial on privileged operations, activity ledger | Single-owner governance lacks dual approval |
| Secret disclosure | Write-only vault, AES-GCM, hashed tokens, metadata-only responses, log redaction | Host encryption-key compromise exposes vault ciphertext |
| SSRF/provider pivot | Fixed provider hosts and bounded request builders; no arbitrary server fetch URL | Provider DNS/account compromise |
| SQL injection | Parameterized PostgreSQL queries and D1 binds; bounded identifiers | Dynamic query construction requires continued review |
| Supply-chain compromise | Lockfile install, registry signatures, immutable actions/framework/base images, Dependabot, CodeQL, Trivy, SBOM | A correctly signed malicious upstream release remains possible |
| Source poisoning | Stable identifiers, source provenance, schema validation, fail-closed refresh, exact-link policy | Official source compromise or incorrect official data |
| Scheduler or delivery abuse | Opaque service token, key-gated workspace selection, pacing/backoff, idempotency, queue limits | Valid service-token theft until rotation |
| Evidence destruction | Append-only observations, audit/incident ledgers, retention rules, exact releases | Private-state restore is not yet continuously exercised |
| Denial of service | Body/parameter/time limits, rate limits, bounded pagination/concurrency, edge protection | Distributed low-rate abuse and upstream exhaustion |

## Privileged operations

The following require the real, non-emulating Super user: global account management, emulation, platform email provider configuration, operational incident mutation, and platform activity enumeration. Workspace credential/source/member/team administration requires Super or active-workspace Manager authority. Agent calls are limited to the issuing workspace and explicit scopes.

## Residual risks and roadmap

1. **MFA/passkeys:** password authentication has no second factor. Add WebAuthn/passkeys before broad external user onboarding.
2. **Single-owner review:** CODEOWNERS identifies the owner but cannot provide separation of duties until a second trusted maintainer exists.
3. **Controlled onboarding:** production registration defaults closed and can be enabled only in invitation-only mode by the real Super user. Invite redemption creates no workspace access. Any future public-open onboarding must add approval, edge challenge, and registration-specific rate controls before a new policy mode can be introduced.
4. **Recovery assurance:** D1/PostgreSQL private-state restoration needs recurring exercises and measured recovery objectives.
5. **Legacy agent credentials:** new governance requires expiry, but existing indefinite tokens require inventory and rotation.
6. **Client-derived password proof:** the proof is a reusable credential if intercepted outside TLS. TLS/HSTS and HttpOnly session handling are mandatory; a future passkey flow removes this class.

Revisit this model after any new provider, public upload, authentication method, tenant boundary, executable extension, or external delivery channel.
