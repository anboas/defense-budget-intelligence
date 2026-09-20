# Recovery runbook

## Scope

Private workspace state lives in Cloudflare D1 in production and PostgreSQL in the stateful runtime. Public static snapshots are not backups of private state.

## D1

1. Export the production database with `wrangler d1 export oip-agent-db --remote` into protected temporary storage.
2. Normalize the export with `node scripts/d1-restore-normalizer.mjs <export.sql> <restore.sql>`. The normalizer losslessly breaks the legacy oversized workspace-snapshot insert into bounded updates accepted by the local D1 runtime.
3. Run `npm run verify:recovery:d1 -- --export=<restore-source.sql>`.
4. Confirm the restored database contains users, workspaces, and migration evidence before any recovery cutover is considered.
5. Never import a drill into the production database. A production recovery requires a new database, verification, binding change, smoke test, and documented rollback.

## PostgreSQL

1. Produce an encrypted, access-controlled `pg_dump` from the source database.
2. Restore into a new database, never over the source.
3. Run migrations only after the restored schema and migration ledger have been verified.
4. Validate table count, migration count, critical row counts, authentication, workspace isolation, and a read/write smoke test.
5. Switch application configuration only after the new database passes readiness checks; retain the old database through the rollback window.

## Evidence and objectives

- Pull requests and quarterly CI run deterministic D1 and PostgreSQL restore contracts.
- A credentialed D1 production export drill is required at least annually and after material schema changes.
- Target recovery point: the most recent completed provider export or encrypted PostgreSQL backup.
- Target technical recovery time for the current small dataset: under 15 minutes, excluding incident authorization and DNS/binding review.
- Record the export timestamp, artifact digest, restore duration, validation counts, operator, and corrective actions. Never commit private exports.

## Break glass

Only the repository owner may suspend branch protection for a critical production recovery. Record the incident and reason first when possible, preserve the prior protection JSON, deploy only a reviewed exact commit, run production smoke checks, and restore branch protection immediately. Break-glass changes require a follow-up pull request and incident review within one business day.
