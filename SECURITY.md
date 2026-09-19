# Security Policy

## Supported version

The current `main` deployment is the supported version. Older static deployments and local snapshots are not supported security baselines.

## Reporting

Report suspected vulnerabilities privately through GitHub Security Advisories for this repository. Do not place credentials, tokens, personal data, raw provider responses, or exploit payloads in public issues.

Include the affected commit or deployment, route/runtime, bounded reproduction steps, expected impact, and whether the issue affects Cloudflare/D1, Fastify/PostgreSQL, or both.

The maintainer will acknowledge complete reports within two business days. Critical reports are triaged within 24 hours, High reports within three business days, and lower-severity reports within five business days. Remediation targets are defined in [Cybersecurity Governance](docs/cybersecurity-governance.md); a validated issue may require coordinated disclosure rather than immediate public detail.

Good-faith research that avoids privacy violations, service disruption, persistence, lateral movement, and data destruction is welcome. Stop testing and report immediately if you encounter credentials, personal data, or access outside the minimum needed to demonstrate the issue. The maintainer will not pursue action against research performed within this policy.

## Scope

In scope are the current `main` application, its Cloudflare Pages/D1 runtime, the portable Fastify/PostgreSQL runtime, release automation, and first-party source integrations. Third-party services, upstream public datasets, social engineering, denial-of-service testing, and attacks requiring stolen credentials are out of scope unless the defect is caused by this repository's handling of those systems.

## Security invariants

- Workspace data and mutations are server-scoped. Browser filtering is never an authorization boundary.
- Secrets remain write-only and encrypted at rest; logs retain metadata only.
- Human writes are same-origin and session protected. Agent writes require scoped, revocable bearer credentials.
- Event AI output is evidence-gated, independently verified, non-destructive, and operator-saved.
- GitHub Actions are commit pinned and least privilege. CI produces dependency, SBOM, CodeQL, parity, and browser evidence.

See [Architecture, Performance, and Security Baseline](docs/architecture-security.md) for the maintained trust-boundary and verification contract.
See [Threat Model](docs/threat-model.md) and [Cybersecurity Governance](docs/cybersecurity-governance.md) for abuse cases, residual risks, ownership, review cadence, incident handling, recovery, and evidence retention.
