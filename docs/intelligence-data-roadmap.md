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
| Exact account and execution history | Operational | USAspending FY2017-FY2026 |
| OMB apportionment revision history | Operational | 6,105 source-linked revisions |
| Independent Treasury outlay reconciliation | Operational | Monthly Treasury Statement table 5 |
| SAM acquisition backbone | Code-complete, source blocked | Protected key required |
| Autonomous graph proposals and publication | Operational | Agent API 1.1 scoped workflow |
| Priority-award action history | Operational, bounded | USAspending exact transaction IDs |
| Request-to-law traceability | Operational baseline | GovInfo and Congress.gov exact bill, version, report, and law identities |
| Forecast and installation mission evidence | Operational baseline | Agency-source records and reviewed official installation sources |
| Competitive, expiration, execution, and outcome signals | Operational review layer | Deterministic, dated, caveated signals only |
| Organization intelligence | Operational bounded baseline | 100 prioritized dossiers, mission/finance/timeline projections, explicit research queues |
| Organization source monitoring | Operational review baseline | 10 hashed official sources, 17 exact dossier links, fail-closed change proposals |
| Official people and role tenure | Operational expanded baseline | 113 public professionals, 294 sourced roles, four exact successions |
| Industrial-base and teaming intelligence | Operational partial baseline | 1,000 sampled prime-to-supplier relationships and retained-award market profiles |
| Outcomes and accountability | Operational bounded baseline | Program health summaries and four source-linked official findings |
| Document intelligence | Operational cited baseline | 57 official documents, 57 versions, 335 typed citations |
| Operational intelligence products | Operational template baseline | Eight saved graph queries and five review-before-send briefs |
| SBIR/STTR | Source unavailable | Official API under maintenance; no empty coverage claimed |

## Preserved strategic sequence: program intelligence through operational products

This sequence is durable. Finishing one release does not remove the later workstreams.

2. **Defense Program Intelligence.** Model programs, budget sponsors, baselines, cost and
   schedule observations, acquisition milestones, breaches, tests, and risks. Connect them
   to budget lines, accounts, locations, awards, vehicles, vendors, legislation, and mission
   evidence. Initial delivery begins with exact R-1/P-1/C-1 identities and official GAO
   findings. Empty evidence domains remain visible until authoritative records are retained.
3. **Line-item request-to-law traceability.** Parse House, Senate, conference, and enacted
   tables with page/table provenance. Preserve request, recommendation, conference, enacted,
   transfer, and rescission amounts as different claims.
4. **Industrial-base and teaming intelligence.** Model corporate families, CAGE facilities,
   prime/subcontract networks, supplier concentration, geographic dependencies, incumbent
   position, certifications, and vehicle or office concentration.
5. **Official people and role tenure. Strategic priority.** Model public professional roles
   such as program executive officers, program managers, contracting officers, requirement
   owners, and congressional committee roles. Every role edge requires an official source,
   effective dates, historical retention, and succession evidence. Personal profiles and
   inferred employment are out of scope. This workstream is promoted immediately after the
   current Program Intelligence and line-item traceability release.
6. **Outcomes and accountability.** Add exact GAO protest decisions, GAO and DoD IG findings,
   DOT&E test findings, hearings, breaches, corrective actions, and resolution state while
   disclosing incomplete public coverage.
7. **Document intelligence.** Store official documents, versions, sections, tables, hashes,
   citations, and embeddings as first-class evidence so agents can answer with paragraph and
   table-level provenance.
8. **Operational products.** Deliver program health, buyer, office, vendor, industrial-base,
   and request-to-enactment pages plus recompete and expiring-funds calendars, source-change
   alerts, saved graph queries, scheduled briefs, and policy-controlled agent promotion.

### Schema 2.2 operational baseline

The first integrated delivery of workstreams 4–8 is intentionally bounded:

- 20 public professionals and 20 official roles retain exact dates where the official
  source states them; current-directory observations are lower bounds, not inferred starts.
- Four source-published changes of charter preserve predecessor, successor, effective date,
  organization, quotation, and official source.
- 1,000 prime-to-supplier relationships, 22 buyer profiles, 235 vendor profiles, and 879
  incumbent positions summarize retained award and sampled subaward evidence. They do not
  claim complete federal-market coverage.
- Every one of the 2,723 defense programs has a deterministic evidence summary. Four
  official program findings are retained as accountability evidence. Public protest,
  audit, and corrective-action coverage remains explicit zero until exact joins pass.
- 45 official documents, 45 observed versions, 25 sections, three verified table extracts,
  and 60 typed citations connect evidence to official roles, appropriation marks, and
  accountability findings. Embeddings remain explicit zero until a reproducible cited
  retrieval pipeline is configured.
- Eight saved-query templates and five weekly brief templates are first-class graph
  entities. Brief publication policy is `review-before-send`; templates do not create an
  external delivery authorization.

The remaining depth work continues: broaden role coverage to contracting officers and
requirements owners, add exact corporate-family and CAGE evidence after SAM activation,
build a stable protest/audit/corrective-action crosswalk, retain complete source bytes and
revision diffs, and connect operational templates to policy-controlled scheduling and
workspace review state.

### Schema 2.3 Organization Intelligence baseline

Organization is now a primary research object rather than a label shared across isolated
datasets. The bounded first cohort includes:

- 100 durable dossiers selected across sourced leadership, mission organizations, program
  offices, major buyers, and major vendors.
- 113 public professionals and 294 official role observations. Current-directory evidence
  establishes an observation lower bound only; it never manufactures an appointment date.
- 56 official mission or jurisdiction claims and 60 typed financial summaries. Request,
  obligation, outlay, award value, and ceiling semantics remain separate.
- 254 open research gaps and 257 dated change events. Missing public evidence is work to do,
  not a negative assertion.
- Full ADMIN dossier routes and Agent API traversal into people, roles, programs, awards,
  accounts, vendors, locations, sources, mission claims, financial summaries, and timelines.

### Schema 2.4 Organization Watch baseline

Organization Watch operationalizes the source-diff portion of the depth roadmap:

- 10 official source pages are registered with allowed hosts, adapters, cadence, priority,
  content hash, and current observation state.
- Exact source membership connects those monitors to 17 organization dossiers.
- Previous verified role and dossier snapshots are retained during scheduled refreshes.
- New role listings, absent role listings, mission or finance additions, content changes,
  and dossier-coverage changes create review proposals.
- A missing directory listing never ends a tenure, and no proposal is promoted
  automatically. The unchanged current baseline therefore has zero pending proposals.
- ADMIN, Source Lineage, the canonical graph, and Agent API expose monitoring state without
  adding the 15 KB deferred artifact to the initial shell or Opportunity Map.

The next depth pass expands exact executive and program-management coverage beyond
committee directories, adds official hierarchy and charter adapters, and connects reviewed
proposals to Agent API enrichment publication while retaining human-visible provenance.

### Cross-workstream acceptance gates

- Exact identifiers or cited review proposals only; title similarity never creates fact.
- Effective dates and role tenure are mandatory wherever the claim can change over time.
- Every amount declares its semantic type and unit.
- Every extracted table value retains document, page, table, row identifier, and arithmetic
  reconciliation.
- Agent API vocabulary, ADMIN inventory, review queues, and graph integrity checks ship with
  each new domain.

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

### Delivered in schema 2.0

- FY2017-FY2026 federal-account and TAS execution history
- complete retained OMB revision history for that window
- program activity and object class by fiscal year
- Treasury Monthly Statement DoD military-program outlay observations
- period-of-availability and expiring/expired state derived from exact TAS syntax
- exact sampled award-to-account relationships
- exact bounded transaction histories for 100 priority awards, retaining first, latest,
  and largest-obligation actions plus the full observed-action count

### Next increments

1. Increase exact award-account coverage with resumable, rate-aware batches and durable
   source cursors.
2. Reconcile account execution to Treasury-published datasets where a compatible TAS-level
   public endpoint exists; never manufacture an account-level Treasury total from agency data.
3. Expand priority transaction history beyond the current bounded cohort only when source
   throughput and Agent API payload budgets remain green.
4. Promote reviewed alerts for expiring authority, abnormal obligation acceleration, revised
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

### Operational baseline

- exact Congress/bill identities for the bounded annual defense authorization and
  appropriations corpus
- official text-version history from Congress.gov and GovInfo package identity when
  available
- exact committee-report and public-law links published by Congress.gov
- first-class R-1 program elements and C-1 projects from the DoD budget corpus

### Domain additions

`legislative-measure`, `committee-report`, `appropriation-mark`, `enacted-provision`,
`budget-adjustment`, `program-element`, and `project`.

The first exact table pass covers 35 FY2024 House RDT&E Army recommendations from House
Report 118-121, printed pages 188-190. Each mark joins by account, line number, program
element, and request amount, with arithmetic reconciliation. Senate, conference, enacted,
transfer, rescission, and other account tables remain unasserted until the same evidence
standard is met. Table-to-budget-line matches without exact identifiers remain cited proposals.

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

### Operational baseline

- agency-forecast records are first-class entities with per-record source state
- reviewed installation missions and tenants link to their official primary sources
- expiration and competition signals are review-only and retain their inputs
- SBIR/STTR remains explicitly unavailable while the federal API is under maintenance

## Workstream E: outcomes and risk

**Outcome:** Connect public financial and acquisition evidence to delivery, protest,
schedule, and mission-result evidence without overstating public visibility.

- GAO protest decisions as incomplete risk evidence, not a complete protest registry
- official inspector-general, audit, congressional-hearing, and program-test evidence
- sourced analyst annotations and outcome claims with competing evidence preserved
- no claim of invoice-level or CPARS completeness without authorized system access

### Operational baseline

- exact award/transaction observations create outcome-evidence records without claiming
  delivery or mission success
- high unobligated-share observations create caveated execution-review signals, not findings
- GAO protest coverage remains explicitly partial and no protest edge is promoted without
  an exact award or notice identifier
- audit-finding entities remain empty until a stable official identifier crosswalk passes
  the promotion gate

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
