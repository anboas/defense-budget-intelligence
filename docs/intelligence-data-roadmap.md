# Intelligence Data Roadmap

## Purpose

This is the enduring source and domain-model roadmap for Defense Intelligence. It governs
what the service collects, how facts become canonical, and which customer decisions each
new source must enable. Volume alone is not a release criterion.

## Permanent rules

1. Prefer primary public sources and exact public identifiers.
2. Store source URI, source identifier, observation time, content hash, validity, and
   review state with every retained fact or relationship.
3. Keep unknown, unavailable, partial, stale, and complete coverage distinct.
4. Preserve revisions and competing claims; never overwrite inconvenient history.
5. Keep request, authority, apportionment, obligation, outlay, award total, and ceiling
   amounts semantically separate.
6. Fuzzy or model-assisted matches may create cited proposals, never silent graph edges.
7. Every source refresh is atomic and fail-closed. A partial refresh cannot erase the last
   verified snapshot.
8. Heavy data remains deferred and paged through the Agent API so the product shell and
   map do not inherit data-volume growth.

## Current foundation

| Capability | Status | Canonical evidence |
| --- | --- | --- |
| DoD contract-spending breadth | Operational | USAspending FY2017-FY2026 |
| Exact account and execution history | Operational | USAspending FY2022-FY2026 |
| OMB apportionment revision history | Operational | 6,105 source-linked revisions |
| Independent Treasury outlay reconciliation | Operational | Monthly Treasury Statement table 5 |
| SAM acquisition backbone | Code-complete, source blocked | Protected key required |
| Autonomous graph proposals and publication | Operational | Agent API 1.1 scoped workflow |
| Request-to-law traceability | Planned | GovInfo, Congress.gov, official committee sources |

## Workstream A: acquisition backbone

**Outcome:** A buyer or award-family page that explains who buys, which notice and
amendments preceded the award, which vehicle and modification changed it, who performs,
and which subrecipients participate.

### Source adapters

- SAM Contract Opportunities: daily; 90-day initial backfill; observed version history
- SAM Contract Awards: daily deltas; awards, orders, modifications, referenced IDVs,
  deletions; disclose the public DoD latency boundary
- SAM Entity: weekly refresh for UEIs present in retained opportunities, awards, and
  subawards; registrations, CAGE, business classifications, NAICS, and PSC
- Federal Hierarchy: weekly plus change-triggered refresh for retained buyer codes
- Acquisition Subaward Reporting: weekly priority-prime refresh with published/deleted state

### Acceptance gates

- protected credential never enters URLs, logs, artifacts, or client bundles
- every adapter fixture passes normalization, identity, deletion, pagination, and
  fail-closed refresh tests
- notice/version, PIID/modification, referenced-IDV, UEI, CAGE, and hierarchy identifiers
  remain stable and typed
- source latency and coverage state appear in Source Lineage and Agent API metadata
- exact links only; unresolved solicitation/award candidates enter a review queue

### Activation dependency

`SAM_GOV_API_KEY` must be added through the protected masked secret workflow for
`api.sam.gov`. The collector remains intentionally unavailable until that happens.

## Workstream B: exact money lifecycle

**Outcome:** Users can move from request to account, TAFS, apportionment revision,
obligation, outlay, award, recipient, and time remaining without mixing money concepts.

### Delivered in schema 1.5

- FY2022-FY2026 federal-account and TAS execution history
- complete retained OMB revision history for that window
- program activity and object class by fiscal year
- Treasury Monthly Statement DoD military-program outlay observations
- period-of-availability and expiring/expired state derived from exact TAS syntax
- exact sampled award-to-account relationships

### Next increments

1. Extend the retained exact-account window to FY2017.
2. Add complete action histories for priority awards and vehicles rather than only ranked
   award summaries.
3. Increase exact award-account coverage with resumable, rate-aware batches and durable
   source cursors.
4. Reconcile account execution to Treasury-published datasets where a compatible TAS-level
   public endpoint exists; never manufacture an account-level Treasury total from agency data.
5. Add alerts for expiring authority, abnormal obligation acceleration, revised
   apportionments, and award funding changes.

### Service levels

- USAspending account execution: daily
- OMB apportionments: daily index check, append on new source identifier
- Treasury MTS: monthly plus daily publication check
- source freshness warning: 48 hours after expected cadence
- failed source: preserve prior snapshot, mark stale, expose diagnostic metadata

## Workstream C: request to enacted law

**Outcome:** Explain where a request increased, decreased, moved, disappeared, or became
enacted authority.

### Sources

- historical DoD budget books and justification narratives
- GovInfo bills, committee reports, public laws, and bulk data
- Congress.gov bill, amendment, action, and committee metadata
- official House, Senate, and conference tables

### Domain additions

`legislative-measure`, `committee-report`, `appropriation-mark`, `enacted-provision`,
`budget-adjustment`, `program-element`, and `project`.

Table-to-budget-line matches without an exact identifier remain cited proposals. Acceptance
requires page/table provenance, independent totals reconciliation, and reviewer promotion.

## Workstream D: market and competitive intelligence

**Outcome:** Show likely pursuit paths, incumbents, buyer behavior, teaming networks, and
competitive structure with explainable evidence.

### Sources and features

- agency acquisition-forecast adapters with per-source health checks
- SBIR/STTR topics and awards when the federal API is stable
- prime/subaward networks, recipient-parent identity, and place of performance
- set-aside, competition, incumbent share, new entrant, office/vendor concentration, and
  vehicle utilization metrics
- authoritative installation tenants, missions, units, and contracting organizations

Derived signals must identify the model version, input facts, evaluation date, and review
state. Predictions never become source facts.

## Workstream E: outcomes and risk

**Outcome:** Connect public financial and acquisition evidence to delivery, protest,
schedule, and mission-result evidence without overstating public visibility.

- GAO protest decisions as incomplete risk evidence, not a complete protest registry
- official inspector-general, audit, congressional-hearing, and program-test evidence
- sourced analyst annotations and outcome claims with competing evidence preserved
- no claim of invoice-level or CPARS completeness without authorized system access

## Quarterly roadmap review

Every quarter, review each workstream against:

- decision value enabled
- authoritative-source availability and terms
- exact-identifier join rate
- freshness and failed-refresh rate
- percent of records with source URI and observed time
- unresolved conflict and review-queue age
- Agent API completeness and response budgets
- product surfaces consuming the data
- cost per useful retained fact

Promote a workstream only when its acceptance gates are automated. Defer or retire a source
when it cannot meet provenance, freshness, legal-use, or reproducibility requirements.
