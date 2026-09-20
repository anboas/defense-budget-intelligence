# Cybersecurity governance baseline

This baseline assigns ownership and minimum operating rules for Defense Budget Intelligence (DBI). It applies to the Cloudflare Pages/D1 production service, the portable Fastify/PostgreSQL runtime, the acquisition scheduler, source-refresh automation, and repository delivery controls.

## Governance roles

| Role | Accountability |
| --- | --- |
| Product and security owner | Accepts residual risk, approves production trust-boundary changes, performs access reviews, and owns incident decisions. The current owner is the repository owner. |
| Real Super user | Manages platform accounts, emulation, global email delivery, and operational incidents. Super authority is unavailable while emulating. |
| Workspace Manager | Manages only the active workspace, members, teams, workspace credentials, and source policy. |
| Maintainer | Changes application or infrastructure code, preserves cross-runtime parity, and attaches exact-revision evidence. |
| GitHub Actions / Cloudflare Worker | Executes narrowly scoped release, analysis, refresh, and scheduler duties through protected tokens. |

Security-sensitive files are declared in `.github/CODEOWNERS`. A second human reviewer is recommended when another trusted maintainer exists. Until then, the owner must explicitly inspect security-sensitive diffs and exact-revision evidence before deployment.

## Data classification

| Class | Examples | Required handling | Default retention |
| --- | --- | --- | --- |
| Public | Official budget, award, opportunity, source, and classification data | Source provenance, content validation, bounded caching | Source-specific; historical observations may be retained |
| Internal | Workspace events, tombstones, saved views, activity, delivery status, operational incidents | Authenticated, workspace scoped, no public export by default | 90 days for diagnostic/activity records unless a durable business record |
| Confidential | User identity, email, membership, provider metadata, request diagnostics | Least privilege, metadata-only logs, no public snapshots | Account lifetime plus documented deletion/retention needs |
| Restricted | Session tokens, agent tokens, API keys, encryption keys, scheduler tokens, password material | Write-only or one-time display, encryption/hash at rest, redaction, protected host secret store | Only while active; revoke and remove promptly |

Restricted values must never enter chat, source, URLs, issue bodies, CI arguments, artifacts, screenshots, or application logs. Provider response bodies and request bodies are not retained.

## Access review

- Review Super users, active platform accounts, workspace memberships, agent credentials, provider credentials, and scheduler/delivery service credentials at least quarterly.
- Suspend departing users and revoke their sessions immediately. Remove workspace membership and revoke credentials created by that user when access is no longer required.
- New agent credentials require a purpose, least-privilege scopes, and an expiration. Indefinite legacy credentials are reviewed and rotated during the next quarterly review.
- Emulation is support-only. The audit ledger must retain both the real actor and effective user.
- Production bootstrap claiming remains disabled after the first owner is established.
- Public-open self-registration remains unavailable. The real Super user controls a durable platform policy of **Closed** or **Invite only** and can issue one-time, expiring registration codes. Codes are stored only as SHA-256 hashes, may be bound to one email address, create only global Viewer accounts, and never grant workspace membership; workspace access remains a separate approval.

## Authentication and secret management

- Browser sessions are HttpOnly, Secure in production, SameSite Strict, high priority, and expire after at most 14 days.
- Password proofs use PBKDF2-SHA-256 with 310,000 iterations in the browser and constant-time server verification. UI policy requires at least 12 characters. Passkeys or phishing-resistant MFA remain a planned control.
- Repeated login attempts are rate limited. Password resets revoke active sessions.
- Secret vault records use AES-256-GCM with a host-owned encryption key. Browser responses expose metadata only.
- Secret rotations require redeploying Cloudflare Pages because Pages secrets bind to a deployment. The old credential is revoked only after the replacement passes a bounded live proof.

## Vulnerability remediation

| Severity | Containment target | Remediation target |
| --- | --- | --- |
| Critical | 24 hours | 72 hours |
| High | 3 business days | 7 calendar days |
| Medium | 14 days | 30 days |
| Low | Next planned maintenance | 90 days |

`npm audit`, registry signature verification, CodeQL, container scanning, Dependabot, secret scanning, SBOM generation, and application security contracts form the minimum continuous-control set. Exceptions require an owner-recorded rationale, expiration date, and compensating control.

## Change and release governance

1. Keep dependency locks, GitHub Actions, Control Surface, and container bases immutable by commit or digest.
2. Treat auth, access, credential, logging, retention, deployment, and workflow changes as security-sensitive.
3. Require lint, cyber-policy, security/runtime, D1, PostgreSQL, Agent API, browser, dependency, SBOM, container, and CodeQL evidence in proportion to the change.
4. Publish the exact reviewed commit. Production does not move on partial or unrelated green runs.
5. Run anonymous authorization, authentication `no-store`, asset cache, CSP, HSTS, and source/data smoke after deployment.
6. Preserve a known-good artifact and configuration for rollback. Never repair production by editing generated artifacts in place.

## Incident response

1. **Detect and classify:** open one deduplicated incident with time, affected runtime/workspace, severity, and evidence boundary.
2. **Contain:** revoke exposed credentials and sessions, pause affected automation, or roll back to the last exact green release.
3. **Preserve evidence:** retain bounded request IDs, timestamps, hashes, status, and safe metadata. Never copy secret or personal payloads into tickets.
4. **Eradicate and recover:** patch the owning control, prove both runtimes, deploy the exact green revision, and monitor recurrence.
5. **Notify:** contact affected users privately when confidentiality, integrity, or availability may be materially affected.
6. **Learn:** document root cause and durable prevention. Complete a post-incident review for critical/high events.

Operational incidents cover scheduler/source failures, provider backlog, terminal deliveries, and repeated authenticated client errors. Security incidents additionally include credential exposure, authorization bypass, data-scope failure, dependency compromise, destructive corruption, or unexplained privileged activity.

## Business continuity

- Cloudflare D1 is the production source of workspace state. Provider recovery capabilities must be verified periodically; do not assume an untested backup is recoverable.
- PostgreSQL operators must implement encrypted backups, off-host retention, and a tested restoration procedure before treating that runtime as production.
- Static source snapshots are a public-data fallback, not a backup of private workspace state.
- Run at least one annual restore exercise and one annual security incident tabletop. Record recovery point, recovery time, evidence, and corrective actions.

## Control evidence

Retain the exact commit, Release CI and CodeQL URLs, SBOM, container scan, migration number, Cloudflare deployment ID, Worker version when applicable, and production-smoke result for each release. Keep diagnostic and user-activity evidence for 90 days. Security exceptions and access reviews are owner-controlled governance records and must not be embedded in public datasets.
