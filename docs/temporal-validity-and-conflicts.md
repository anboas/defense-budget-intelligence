# Temporal validity and evidence conflicts

**Status:** Implemented deterministic baseline  
**Schema:** `1.0.0` sidecar on intelligence graph `1.5.0`
**Artifacts:** `data/temporal-evidence-index.json`, `data/temporal-evidence-review.json`

## Decision

Every graph relationship carries an explicit temporal record:

- `observedAt`: when the retained source snapshot reported the relationship;
- `effectiveFrom` and `effectiveTo`: the source-supported business interval, when known;
- `supersededAt`: when a later accepted claim replaced it, otherwise `null`;
- `reviewedAt`: last human or deterministic review date, otherwise `null`;
- `reviewBy`: the next freshness boundary;
- `status`: `current`, `historical`, `future`, `stale`, `superseded`, or `unknown`;
- `basis`: the rule used to derive the interval and status.

Unknown dates remain `null`. They are never filled from UI state, proximity, or model inference.

## Conflict policy

A conflict retains every sourced claim as a first-class `evidence-claim` entity. The conflict records subject, field, claim IDs, source artifacts, observation dates, review state, resolution status, reason, and any winning claim.

Only a newer **current** retained source observation can produce `resolved_by_recency`. Stale, missing-date, ambiguous-identity, and unsupported-lineage claims remain `needs_review`. A resolved conflict does not delete older evidence; it records which claim currently wins and why.

The baseline detects:

- material obligated and potential amount changes;
- lifecycle disagreements across retained source projections;
- schedule start/current-end/potential-end changes;
- normalized organization labels mapping to multiple UEIs;
- competing exact parent or predecessor identifiers;
- source wording that indicates a follow-on without an exact retained predecessor.

## Current coverage

- 63,232 graph relationships assessed;
- 50,606 current, 12,356 historical, 270 future, and 0 stale relationships;
- 489 retained conflicts or unresolved claims;
- 408 resolved by newer current evidence;
- 81 still require review;
- 398 amount, 52 lifecycle, 10 schedule, 11 identity, and 18 lineage cases.

## Runtime design

The full graph remains a deployment and audit artifact. Browser record drawers fetch the bounded temporal index only when Connected Intelligence opens, then reuse it across Capture Calendar and Spend Explorer. Source Lineage loads only the lightweight graph summary and offers the full review artifact as an explicit download.

No application database migration is required for this baseline. Public evidence and domain projections remain generated artifacts; tenant users, authentication, workspace ownership, notes, and management state are untouched.

## Promotion and review rules

1. Preserve the original claim and source URL or source artifact.
2. Normalize values only for comparison, never as a replacement for the published value.
3. Auto-resolve only when a newer current observation is unambiguous.
4. Keep stale, ambiguous, or unsupported claims unresolved.
5. Never infer a follow-on, identity, location, or monetary value from similarity alone.
6. Regenerate the graph and fail release verification if counts, membership, provenance, or payload budgets drift unexpectedly.
