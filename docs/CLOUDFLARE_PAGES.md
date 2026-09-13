# Cloudflare Pages and D1 deployment

The primary application is deployed as the `defense-budget-intelligence` Cloudflare Pages project.

## Architecture

- Cloudflare Pages serves the compiled Vite application at `/`.
- Pages Functions handle `/api/v1/auth/*` and `/api/v1/agent/*` in the same origin.
- The `DBI_DB` binding points to the existing intelligence-platform D1 database also used by Opportunity Intelligence.
- D1 tables use the `dbi_` prefix and are created idempotently on demand.
- The signed-in Operations UI and scoped agents share D1-backed tracking, events, manual records, activity, and integration status.
- The static GitHub Pages fallback remains publicly readable, hides account controls, rejects the Agent API, and keeps Operations state browser-local.
- The Docker and PostgreSQL stack remains a portability and release-contract target; it is not required by the Cloudflare deployment.

## Authentication boundary

- `DBI_AUTH_REQUIRED=1` gates the Cloudflare-hosted application UI.
- `DBI_ALLOW_FIRST_CLAIM=1` permits the one-time first-party owner claim.
- The singleton D1 insert is atomic, so concurrent claim attempts produce exactly one Super user.
- Passwords are derived in the browser with PBKDF2-SHA-256 at 310,000 iterations. D1 stores only a second server-side SHA-256 hash of the derived proof.
- Session tokens are random, stored only as hashes, and sent in `HttpOnly; Secure; SameSite=Strict` cookies.
- Password rotation revokes every existing session before issuing the replacement session.
- Profile and account mutations reject cross-origin requests.

After the first account is claimed and verified, set `DBI_ALLOW_FIRST_CLAIM=0` and redeploy as defense in depth. The singleton constraint remains authoritative even before that flag changes.

## Agent access

The Super user manages scoped, revocable credentials under **Profile → Agent access**. Tokens are displayed once and must move directly into an agent's protected Secret Store. The complete resource, scope, concurrency, audit, and immutability contract is documented in [Agent API](AGENT_API.md).

## Verification

Run the complete isolated Pages contract locally:

```bash
npm run verify:pages-auth
npm run verify:agent-api
```

The verifiers race two claims against fresh D1 databases, test generic login discovery, profile editing, password rotation, session revocation, logout/login, agent credential issuance/revocation, shared Operations state, Agent API CRUD and safety contracts, runtime restart persistence, secure cookies, and the desktop/mobile browser UI.

## Deployment

1. Confirm the `DBI_DB` binding points to the intelligence-platform D1 database and retains the `dbi_` table namespace.
2. Authorize Wrangler through the protected host credential flow. Never place a Cloudflare token in chat, shell arguments, repository files, or logs.
3. Run `npm run pages:deploy`.
4. Open the Cloudflare Pages hostname and complete the one-time first-party claim.
5. Verify a second claim returns HTTP 409 and the account lifecycle passes on the live hostname.
6. Set `DBI_ALLOW_FIRST_CLAIM=0`, redeploy, and verify the existing Super user can still sign in.
