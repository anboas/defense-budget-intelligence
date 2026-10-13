# Emerging Markets evidence campaign

## Objective

Validate every one of the 172 tracked Emerging Markets records against current public evidence, retain source-grounded findings, validate or reject existing dates, and populate native timeline events without inventing unsupported milestones.

## Constraints

- Preserve both imported workbook payloads and every stable record identifier.
- Prefer official procurement, agency, budget, award, and contract sources.
- Retain canonical HTTPS source URLs, retrieval timestamps, evidence confidence, and review state.
- Treat secondary sources as discovery leads only unless no official source exists, and label them accordingly.
- Do not replace curated fields. Add verified evidence, explicitly supersede stale dates, and preserve conflicts for review.
- Do not create exact dates from fiscal quarters, ranges, or narrative estimates.
- Keep credentials and private workbook contents out of the repository and logs.

## Plan

1. Snapshot the live 172-record corpus, existing 170 events, identifiers, and current evidence coverage.
2. Build a resumable, deterministic research campaign with a strict result schema and per-record checkpoints.
3. Search official sources for every record; retain consulted-source inventories and unresolved gaps.
4. Independently validate identities, dates, and event classifications before generating production mutations.
5. Apply additive research reports, evidence, lineage, and native events in bounded atomic batches.
6. Verify record parity, event uniqueness, date semantics, source grounding, UI rendering, and production counts.

## Success criteria

- 172/172 records have a completed research disposition: verified evidence, explicit no-public-evidence result, or named unresolved ambiguity.
- Every accepted fact and event has at least one retained canonical source URL and confidence/review metadata.
- Existing workbook dates are classified as corroborated, superseded, conflicting, or still forecast-only.
- Native timeline events are deduplicated and preserve date precision.
- No imported record, tracked ID, source payload, or existing Navy corpus record is lost.
- Production counts and authenticated browser views match the reviewed campaign manifest.

## Rollback

- All production writes use an immutable campaign ID and preserve the pre-campaign record JSON in acquisition observations.
- Revert by restoring the prior record version for that campaign and deleting only campaign-created research/event rows.
