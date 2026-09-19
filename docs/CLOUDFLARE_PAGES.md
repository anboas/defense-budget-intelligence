# Cloudflare Pages and D1 deployment

The primary application is deployed as the `defense-budget-intelligence` Cloudflare Pages project.

## Architecture

- Cloudflare Pages serves the compiled Vite application at `/`.
- Pages Functions handle `/api/v1/auth/*` and `/api/v1/agent/*` in the same origin.
- The `DBI_DB` binding points to the existing intelligence-platform D1 database also used by Opportunity Intelligence.
- D1 tables use the `dbi_` prefix and are created idempotently on demand.
- The signed-in Admin surfaces and scoped agents share D1-backed tracking, events, manual records, API activity, and integration status.
- The static GitHub Pages fallback remains publicly readable, hides account controls, rejects the Agent API, and keeps management state browser-local.
- The Docker and PostgreSQL stack remains a portability and release-contract target; it is not required by the Cloudflare deployment.

## Acquisition email delivery

The hourly scheduler also drains due acquisition alert jobs. Immediate saved-view matches are eligible on the next scheduler invocation or immediately after a manual refresh; daily jobs wait for the configured UTC digest hour. Configure Pages with protected `RESEND_API_KEY` and the non-secret deployment values `DBI_ALERT_FROM_EMAIL`, optional `DBI_ALERT_REPLY_TO`, `DBI_PUBLIC_APP_URL`, and `DBI_ALERT_DIGEST_HOUR_UTC`. Pages secrets bind on the next deployment. Never place the provider key in repository files, chat, shell arguments, or logs.

If the provider is absent, no email request is attempted and jobs remain `pending_provider`. In-app alerts remain the source of truth. Delivery attempts retain only status, bounded error code, provider message ID, and timestamp. The real Super user can inspect and retry or cancel jobs under **Connections → Operations**; emulated sessions cannot access that surface.

## Authentication boundary

- `DBI_AUTH_REQUIRED=1` gates the Cloudflare-hosted application UI.
- `DBI_ALLOW_FIRST_CLAIM=1` permits the one-time first-party owner claim.
- The singleton D1 insert is atomic, so concurrent claim attempts produce exactly one Super user.
- Passwords are derived in the browser with PBKDF2-SHA-256 at 310,000 iterations. D1 stores only a second server-side SHA-256 hash of the derived proof.
- Session tokens are random, stored only as hashes, and sent in `HttpOnly; Secure; SameSite=Strict` cookies.
- Password rotation revokes every existing session before issuing the replacement session.
- Profile and account mutations reject cross-origin requests.
- The first account remains the immutable Super user. Super users and Administrators manage human access under **Admin → Users**.
- New accounts receive Administrator, Analyst, or Viewer roles and must replace their temporary password before workspace data becomes accessible.
- Suspending an account immediately revokes its sessions. Administrator password resets also revoke sessions and restore the mandatory first-login password change.

Role enforcement is server-side:

- **Super user:** permanent owner, full workspace access, user administration, and agent credential administration.
- **Administrator:** full workspace access, user administration, and agent credential administration.
- **Analyst:** workspace read/write access without user or agent credential administration.
- **Viewer:** read-only workspace access.

After the first account is claimed and verified, set `DBI_ALLOW_FIRST_CLAIM=0` and redeploy as defense in depth. The singleton constraint remains authoritative even before that flag changes.

## Agent access

The Super user and Administrators manage scoped, revocable credentials under **Admin → Agent Access**. Tokens are displayed once and must move directly into an agent's protected Secret Store. The complete resource, scope, concurrency, audit, and immutability contract is documented in [Agent API](AGENT_API.md).

## Verification

Run the complete isolated Pages contract locally:

```bash
npm run verify:pages-auth
npm run verify:agent-api
```

The verifiers race two claims against fresh D1 databases, test generic login discovery, routed Profile/Security/Users/Agent Access pages, human account creation, RBAC, suspension/reactivation, administrator password reset, mandatory temporary-password replacement, session revocation, logout/login, agent credential issuance/revocation, shared Admin state, Agent API CRUD and safety contracts, runtime restart persistence, secure cookies, and the desktop/mobile browser UI.

## Deployment

1. Confirm the `DBI_DB` binding points to the intelligence-platform D1 database and retains the `dbi_` table namespace.
2. Authorize Wrangler through the protected host credential flow. Never place a Cloudflare token in chat, shell arguments, repository files, or logs.
3. Run `npm run pages:deploy`.
4. Open the Cloudflare Pages hostname and complete the one-time first-party claim.
5. Verify a second claim returns HTTP 409 and the account lifecycle passes on the live hostname.
6. Set `DBI_ALLOW_FIRST_CLAIM=0`, redeploy, and verify the existing Super user can still sign in.
