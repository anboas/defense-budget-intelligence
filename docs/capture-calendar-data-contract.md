# Capture Calendar data contract

The Capture Calendar publishes a fail-closed projection of the normalized Sabre Executive Growth Capture Packet schema `1.1.0`.

## Identity and joins

- `opportunity_id` is the durable primary key for filters, selected records, exports, database rows, and API routes.
- `gantt_row_id` is retained only as a human-readable display alias.
- Events join through `opportunity_id` plus the matching Gantt alias.
- FPDS actions join from their Gantt alias to the corresponding stable opportunity ID.
- An FPDS action is unique by agency, PIID, parent PIID, modification, and transaction number.

The build fails when IDs are duplicated, joins disagree, an action is duplicated, or the expected publication counts change.

## Public projection

The public runtime includes source-backed opportunity identity, program, portfolio, buyer/vendor, award identifiers, scope, reported dates, normalized events, validation state, public source URLs, USAspending award values, separate FPDS public sums, and exact FPDS actions.

The public runtime excludes all `internal_proposal` records and does not project target mappings, management priorities, access codes or labels, capture motions, company relationship classifications, internal status labels, or proposed work packages. A phrase and property scan runs before either runtime file is written.

## Money semantics

- USAspending award obligations and base-plus-options values remain the primary displayed award totals.
- FPDS actions provide modification history and corroborating public sums.
- FPDS and USAspending totals are never added together.
- Supporting-instrument actions remain explicitly marked and are excluded from the primary-award cumulative chart and fiscal net-obligation series.
- Funding, deobligation, and non-obligation labels are derived only from the signed obligation delta.
- Performance endpoints do not establish recompete dates.

## Runtime and persistence

`capture-calendar.json` contains the 198-record public projection, 502 normalized events, coverage, and aggregate action analytics. `capture-transactions.json` contains 3,085 exact actions and loads only after a record with action history is selected.

PostgreSQL stores the immutable capture snapshot and normalized `capture_opportunities`, `capture_events`, and `capture_fpds_actions` rows. The read API exposes coverage, stable opportunity detail, and exact action history. Browser exports carry the snapshot date, canonical filtered URL, stable opportunity ID, source links, and public money fields.
