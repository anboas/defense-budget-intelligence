# Release governance

## Normal path

1. Create a focused branch from current `main`.
2. Open a pull request. Direct pushes to `main` are prohibited.
3. Required checks must pass: release container and PostgreSQL contracts, authenticated D1/browser and build contracts, cyber policy, both container scans, CodeQL, and D1/PostgreSQL recovery assurance.
4. Resolve review conversations. The single-owner repository cannot provide independent approval, so automated evidence is mandatory and administrative bypass is disabled.
5. Squash merge. The `main` push publishes the exact checked revision to GitHub Pages; Cloudflare production deployment remains an explicit exact-revision operation.
6. Verify production assets, authentication `no-store`, cache policy, CSP, HSTS, and the changed behavior.

Daily source refreshes follow the same path through an automation pull request. They may auto-merge only after every required check passes.

## Emergency path

Branch protection may be suspended only for a documented critical recovery when the normal path cannot restore service inside the incident objective. Preserve the current protection configuration, record the incident, use an exact reviewed commit, run the full available local matrix, deploy, verify production, and restore protection immediately. A follow-up pull request and incident review are due within one business day.

## Evidence

- GitHub Actions checks are the authoritative release evidence.
- SBOM and scan artifacts are retained by the security workflows.
- Restore evidence is retained under `docs/recovery-evidence/` without database contents or secrets.
- Releases must be attributable to an exact commit and deployment identifier.
