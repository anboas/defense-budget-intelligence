# Security Policy

## Supported version

The current `main` deployment is the supported version. Older static deployments and local snapshots are not supported security baselines.

## Reporting

Report suspected vulnerabilities privately through GitHub Security Advisories for this repository. Do not place credentials, tokens, personal data, raw provider responses, or exploit payloads in public issues.

Include the affected commit or deployment, route/runtime, bounded reproduction steps, expected impact, and whether the issue affects Cloudflare/D1, Fastify/PostgreSQL, or both.

## Security invariants

- Workspace data and mutations are server-scoped. Browser filtering is never an authorization boundary.
- Secrets remain write-only and encrypted at rest; logs retain metadata only.
- Human writes are same-origin and session protected. Agent writes require scoped, revocable bearer credentials.
- Event AI output is evidence-gated, independently verified, non-destructive, and operator-saved.
- GitHub Actions are commit pinned and least privilege. CI produces dependency, SBOM, CodeQL, parity, and browser evidence.

See [Architecture, Performance, and Security Baseline](docs/architecture-security.md) for the maintained trust-boundary and verification contract.
