# Architecture, Performance, and Security Baseline

This document is the maintained boundary map for Defense Budget Intelligence. Code and release changes must preserve these contracts in both the Cloudflare Pages/D1 runtime and the portable Fastify/PostgreSQL runtime.

## Surface ownership

- **Primary work:** Transactions, Wallboard, Events.
- **Analysis and evidence:** analytics, money flow, watchlists, sources, and Task Center.
- **Workspace administration:** integrations, API request/change ledgers, workspace settings, and Agent Access.
- **Platform administration:** users and global workspaces.
- **Personal:** profile, security, and personal OpenAI credentials.

Each route has one masthead, one framework page header, and one owned work surface. Loading, empty, cancelled, error, retry, dialog, picker, toast, chart, and page-header anatomy comes from the pinned Control Surface package.

## Runtime boundaries

```text
Browser
  ├─ hashed Vite assets and deferred public snapshots
  ├─ same-origin /api/v1/auth/* session control plane
  └─ same-origin /api/v1/agent/* user or bearer-token automation plane

Cloudflare Pages Functions                 Fastify container
  ├─ shared security-policy.js               ├─ shared security-policy.js
  ├─ D1 dbi_* workspace state                ├─ PostgreSQL migrations/snapshots
  ├─ encrypted credential vault              ├─ encrypted credential vault
  └─ background OpenAI Responses             └─ background OpenAI Responses
```

The implementations differ only at persistence and platform adapters. Validation, redaction, provider request construction, evidence normalization, and browser security policy are shared modules where the runtime APIs permit it. New cross-runtime behavior must ship with equivalent D1 and PostgreSQL contracts.

## Trust boundaries and controls

| Boundary | Required controls |
| --- | --- |
| Browser to authenticated API | HttpOnly, Secure, SameSite=Strict sessions; same-origin and Fetch Metadata rejection; bounded JSON; no-store responses; role and active-workspace checks |
| Agent API | Hashed scoped bearer tokens; expiration/revocation; per-principal rate limit; idempotency for writes; optimistic versions; workspace-scoped queries; redacted request ledger |
| Credential vault | AES-256-GCM at rest; host-owned encryption key; write-only secret input; metadata-only browser responses; no keys/prompts/raw provider bodies in logs |
| OpenAI enrichment | Background request IDs; forced web search; provider-source binding; independent verification; deterministic merge; operator review; no direct event write |
| Public data | Build-time validation, stable identifiers, explicit source lineage, deferred route-specific payloads, bounded cache lifetime |
| Container | Non-root user; read-only filesystem; dropped Linux capabilities; no-new-privileges; bounded temporary filesystem; private PostgreSQL network |
| Release | Lockfile install; zero-high dependency audit; CycloneDX SBOM; immutable action pins; CodeQL; least-privilege workflow permissions; exact framework commit pin; D1/PostgreSQL/browser parity before deployment |

## Performance budgets

- Initial JavaScript: below 500 KB uncompressed.
- Any route chunk: below 550 KB uncompressed.
- Compiled CSS: at or below 350 KB.
- Large route-specific snapshots must be fetched on demand, never imported into JavaScript bundles.
- Runtime JSON uses short revalidation; content-hashed assets use one-year immutable caching.
- Data requests must be abortable when their owning surface unmounts or changes.
- D1 list/detail joins must bound the owning rows before enrichment and use purpose-built composite indexes for every correlated lookup.
- Retention pruning is indexed and scheduled at most once per day; request, login, and task writes must never trigger table-wide cleanup.

The contract monitor is intentionally emitted as `data/contract-monitor.json` and loaded only by Integrations. Re-importing it from React source is a release-blocking architecture regression.

`npm run verify:d1-efficiency` executes real SQLite query plans through Wrangler. It blocks Task Center request-log scans, unindexed retention deletes, and per-write pruning regressions.

## Maintainability budgets

`npm run verify:security` enforces shared headers, request bounds, origin handling, log redaction, immutable action pins, framework pinning, prohibited dynamic-code sinks, route chunk budgets, and current monolith ceilings.

The line ceilings are migration guards, not design targets. When a ceiling is approached, split by owned route or adapter instead of raising it. Preferred seams are:

1. pure cross-runtime policy/normalization modules;
2. storage-specific adapters;
3. route-owned React modules loaded with `lazy()`;
4. framework-owned generic interaction anatomy;
5. application-owned domain data and authorization.

## Logging and incident diagnostics

Logs may retain bounded status, latency, token counts, request/response IDs, retry state, evidence counts, operation, route, and trace IDs. They must remove fields whose names imply authorization, cookies, secrets, passwords, API keys, tokens, prompts, request/response bodies, or raw payloads. String redaction covers OpenAI keys and bearer tokens as a second layer.

Server exceptions are logged internally with request context but return generic 5xx messages. Production diagnostics use bounded read-only queries. Historic failed jobs are not mutated to invent evidence that was not retained.

## Change checklist

1. Decide whether the capability belongs in Control Surface, shared runtime policy, a platform adapter, or a route.
2. Keep permissions and workspace predicates next to every storage operation.
3. Add a failure-path contract, not only a success test.
4. Run `npm audit --audit-level=high`, `npm run verify`, authenticated D1, Agent API, and disposable PostgreSQL contracts.
5. Confirm bundle and CSS budgets, security headers, cache behavior, and anonymous rejection.
6. Push the exact framework commit first, pin it in DBI, then release DBI only after CI is green.
