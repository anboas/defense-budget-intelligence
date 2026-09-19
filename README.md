# Defense Budget & Spend Analytics

Factual analytics platform tracing published defense money data from the President's Budget request through account execution, awards, and FPDS transactions.

Live Cloudflare Pages site: <https://defense-budget-intelligence.pages.dev/>

GitHub Pages fallback: <https://anboas.github.io/defense-budget-intelligence/>

## Scope

- Services: Army, Navy / Marine Corps, Air Force / Space Force.
- Fourth Estate: OSD / Defense-Wide, defense agencies, combatant commands, and joint organizations.
- Colors of money: M-1, O-1, P-1, R-1, RF-1, and C-1 display books.
- Primary work surfaces: Transactions, Wallboard, and Events. Workspace administration, platform administration, and personal settings remain distinct ownership areas.
- Drilldown levels: request vintage, service / Fourth Estate, organization, appropriation account, budget activity, budget line item, Treasury account, award, modification, and source evidence.
- Classifications: color of money and keyword-derived mission categories remain labeled as classifications, not recommendations.

## Analytics contract

Defense Budget & Spend Analytics uses three primary working surfaces plus grouped analytical and administrative menus:

- Compact operations workspace with dense scan-first cards, filters, metrics, tables, and source provenance.
- Direct Transactions, Wallboard, and Events routes; Analytics groups query-addressable views; Money flow groups PDB Request, Request History, Account Flow, Awards, and Source Lineage; workspace administration groups Integrations, API Log, Workspace Settings, and Agent Access; platform administration groups Users and Workspaces.
- Hash-route deep links for every working, analytical, money-flow, management, and account surface. Profile, Security, and Agent Access are full pages rather than dialogs.
- Validated URL-backed filters and selections, explicit Reset and Retry actions, browser-local saved views, and deterministic snapshots.
- CSV and JSON exports carry the exact view URL, snapshot timestamp, extraction methodology, and row-level official-source lineage.
- No strategy rankings, pursuit recommendations, opportunity scores, decision briefs, or target workboards in the public runtime.
- Cloudflare Pages as the primary public surface, with GitHub Pages retained as a fallback.

## Production state and portability

The primary Cloudflare deployment uses the same platform pattern as Opportunity Intelligence:

- Cloudflare Pages serves the compiled Vite application;
- Pages Functions implement the same-origin `/api/v1/auth/*` account surface and `/api/v1/agent/*` automation control plane;
- the existing intelligence-platform D1 database stores namespace-isolated `dbi_*` account, session, agent-key, management, audit, idempotency, and manual-record state;
- the next successful first-party account claim atomically becomes the permanent Super user;
- people can create their own account, manage a browser-cropped profile picture, and request access without receiving implicit workspace data;
- the sole Super user can create isolated workspaces, approve or deny requests, assign workspace roles, add or remove members, and explicitly emulate an active managed user without inheriting Super user visibility;
- workspace managers can organize members into named teams with optional icons, assign events to one or more team overlays, and preserve workspace-wide events by leaving team visibility unassigned;
- the Super user and Administrators can create human accounts inside their active workspace, assign Administrator/Analyst/Viewer roles, suspend access, revoke sessions, and reset passwords without exposing stored password material;
- the Super user and Administrators can issue narrowly scoped, revocable Agent API credentials for the active workspace from the top-right profile menu;
- authenticated humans and agents share tracking, events, activity, manual records, and wallboard state while source-backed evidence remains immutable; human event reads are filtered to workspace-wide events plus the union of the effective user's teams, and the calendar can toggle those visible overlays;
- the account UI is omitted automatically on the static GitHub Pages fallback because that host has no account API.

The repository also retains a production-neutral Docker and PostgreSQL stack as a portability and release-contract target:

- one Node container serves the compiled Vite application and a versioned `/api/v1` surface;
- PostgreSQL stores immutable intelligence snapshots and mutable analyst state;
- idempotent SQL migrations run under a PostgreSQL advisory lock at application startup;
- committed budget, source-health, refresh-delta, account-spine, and capture-calendar snapshots are imported by content hash;
- public snapshot reads are available immediately;
- saved-view writes are disabled by default and require both `ENABLE_WRITES=true` and a host-injected `APP_WRITE_TOKEN`.

The schema includes `intelligence_snapshots`, `source_documents`, `fiscal_accounts`, `fiscal_account_observations`, `federal_awards`, `award_account_observations`, `agency_fiscal_year_observations`, `refresh_runs`, `saved_views`, `comparison_sets`, and `annotations`. This is an additive migration path: the live Pages sites can remain online while frontend reads move from static JSON to the API route by route.

Run the local stack:

```bash
npm run container:up
npm run container:verify
npm run container:down
```

The Compose database is private to the application network and uses local trust authentication. It is not the Cloudflare production runtime. Do not commit a production connection string or write token.

Container health contracts:

- `GET /api/healthz` confirms the process is running.
- `GET /api/readyz` confirms PostgreSQL is reachable.
- `GET /api/v1/snapshots` lists the latest snapshot metadata by layer.
- `GET /api/v1/snapshots/:kind/current` returns the current persisted payload for `budget`, `source_health`, `refresh_delta`, `account_spine`, or `capture_calendar`.
- `GET /api/v1/account-spine` returns normalized account-spine coverage.
- `GET /api/v1/account-spine/accounts` returns current federal-account execution measures.
- `GET /api/v1/account-spine/accounts/:code` returns source-linked observations by TAFS for one federal account.
- `GET /api/v1/account-spine/history` returns normalized Department resource, obligation, and outlay history by fiscal year.
- `GET /api/v1/account-spine/award-flows` returns exact award-account coverage and linked obligations.
- `GET /api/v1/account-spine/accounts/:code/awards` returns source-linked sampled awards funded by one federal account.

The release workflow treats both stateful implementations as gates. It proves the full first-account lifecycle against a fresh local D1 database, then builds the Docker images, starts a fresh PostgreSQL database, applies migrations, imports snapshots, and verifies the portable API before publishing the static fallback.

Cloudflare deployment and first-claim operations are documented in [Cloudflare Pages and D1](docs/CLOUDFLARE_PAGES.md). The scoped R/W automation contract is documented in [Agent API](docs/AGENT_API.md). The two-stage Responses API workflow, evidence rules, merge contract, and runtime parity for event research are documented in [Event AI enrichment](docs/event-ai-enrichment.md).

The maintained trust boundaries, performance budgets, maintenance seams, release controls, and incident-logging rules are documented in [Architecture, Performance, and Security Baseline](docs/architecture-security.md). Private vulnerability reports follow [SECURITY.md](SECURITY.md).

## Data Sources

The request stage currently uses six official FY2027 Office of the Under Secretary of Defense (Comptroller) display workbooks:

- M-1: Military Personnel
- O-1: Operations and Maintenance
- P-1: Procurement
- R-1: Research, Development, Test, and Evaluation
- RF-1: Revolving and Management Funds
- C-1: Military Construction / Family Housing / BRAC

The parser reads line-level data from the official display workbooks and preserves FY2025, FY2026, and FY2027 values when present. For C-1, values are organized by the workbook fiscal-year field. Cached FY2027 Procurement and RDT&E justification XML adds source-linked narrative evidence. A separate USAspending snapshot adds contract awards, buyers, vendors, PSCs, NAICS, and transaction-funded federal-account links. CI builds use committed generated JSON when the local workbook cache is unavailable.

Local source refresh uses cached workbooks from `BUDGET_SOURCE_DIR`, defaulting to the user home artifact directory. `npm run source:workbooks` downloads the official FY2024-FY2027 display books, and `npm run source:refresh` rebuilds all public snapshots.

Justification source refresh uses `npm run source:justifications`, which caches reachable official FY2027 Procurement and RDT&E XML sources under `BUDGET_SOURCE_DIR/justifications/FY2027` and records unavailable official links in the manifest.

Execution source refresh uses `npm run source:usaspending`, which retains the existing award corpus and paginates every result in a rolling fourteen-day window across eleven disclosed DoW technology-area keyword searches. Each search is split into one-day windows to stay below the API's per-query result ceiling, then merged by generated award identifier so the corpus grows and existing awards can change. Two areas may refresh concurrently, but each area's pages remain sequential. The refresh retries transient failures, resumes from page checkpoints, fails closed if any award query is incomplete, and records window/page/result/truncation metadata. This is an incremental query-scoped corpus, not a claim of historical or exhaustive DoW award coverage. `npm run source:subawards` then joins USAspending subaward counts and a bounded recent-detail sample to those primes by the exact generated award identifier.

SAM.gov refresh uses `npm run source:sam` to retrieve a rolling 180-day Department of Defense opportunity window when a protected `SAM_GOV_API_KEY` is available. Without the credential, the prior snapshot is preserved and the feed is explicitly labeled unavailable. The daily acquisition workflows record new/updated/removed source observations, retain first-seen and last-changed dates, preserve field-level changes and 180 days of compact history, and refresh the paginated USAspending technology corpus. Manual and CRM-derived public records use the separate schema described in [Procurement ingestion and classification](docs/procurement-ingestion.md); private capture fields never enter the public bundle.

The authenticated workspace runtime uses a separate encrypted workspace SAM.gov key and an hourly Cloudflare trigger. Managers configure each workspace's cadence, organization scope, notice types, lookback, pagination ceiling, request interval, and retries. Eligibility is key-gated before task creation: no active workspace key means no refresh run and no SAM.gov request. Runtime observations, field changes, exact links, saved views, in-app alerts, and outbound-delivery jobs are durable and workspace-scoped. Immediate email alerts and daily digests use an optional Super-managed, encrypted, write-only Resend configuration under **Connections → Operations**; protected environment variables remain a deployment fallback. Without either provider, jobs remain queued and in-app alerts remain authoritative. Operations also retains a deduplicated incident history for refresh, provider, dead-letter, and repeated client failures.

Known-contract monitoring uses `npm run source:contracts` after the award and SAM refreshes. Up to 2,000 priority non-historical records receive exact-detail checks, preserving previously monitored records before adding the highest-value records from the wider discovery corpus. Exact USAspending generated award IDs are refreshed individually, single explicit active-contract PIIDs can resolve through identity-validated DoD award or IDV probes, SAM notices inherit the credentialed batch status, and records without an exact automated key remain explicit coverage gaps. Composite identifiers, predecessor references, forecasts, solicitations, and title similarity never create an award relationship. Transient failures retain the prior verified observation as stale instead of dropping the contract. The generated `contract-monitor.json` separately reports eligible, checked, excluded, active, upcoming, option-horizon, unresolved-schedule, current, stale, unavailable, and uncovered counts without inferring award or notice relationships.

Account-spine refresh uses `npm run source:account-spine`. It joins the latest public OMB apportionment document for each Department TAFS to USAspending Treasury-account execution records by the exact TAS code. It separately derives request-to-account links through normalized exact account-title matches and labels those edges `derived` in the data and UI. It also enriches the 250 highest-value awards in the current technology sample through USAspending's award-account endpoint, preserving those transaction-funded federal-account edges as exact while making the sample boundary explicit.

Transactions reconstructs published contract-performance and acquisition-event rows from a source Gantt PDF, reconciles every row to the corroboration CSV, and merges exact award references with the current award analytics bundle. The public runtime excludes internal campaign fields, proposed work packages, scores, recommendations, and analyst workboard state. Rebuild it from authorized local source artifacts with:

```bash
node scripts/build-capture-calendar.mjs --pdf /path/to/gantt.pdf --csv /path/to/corroboration.csv
```

GitHub Actions checks active contracts and SAM notices at 09:32 UTC, then refreshes the complete disclosed source packet, paginated USAspending technology corpus, source health, and acquisition change ledger at 10:17 UTC every day. A partial USAspending pull aborts without replacing the prior verified snapshot. The site labels each layer independently as current, review-needed, or unavailable rather than presenting one misleading global freshness date.

Current version depth:

- Budget request packages versioned in this repo: FY2024-FY2027 display-book vintages, with FY2027 as the current full-color package.
- Fiscal-year values extracted from current and historical packages: FY2022-FY2027 where available by request vintage.
- Source coverage ladder: budget request line items are live; FY2027 OUSD(C) Procurement/RDT&E program narrative is partially ingested; the generated USAspending inventory discloses its live query-scoped award count and pagination boundary; exact FPDS action history and bounded exact prime-to-subaward counts are live; published acquisition schedules and agency forecasts are normalized from the source packet; SAM.gov monitoring is wired but currently unavailable without its protected credential.
- Explorer controls: the Today acquisition inbox, field-level change summaries, browser-local saved views with unread counts, technology-area sorting/filtering, Department of War → Military Departments/Fourth Estate → service or agency → buying-office drilldown, Date added sorting, explicit coverage/data-quality facts, and recoverable workspace tombstones are live. `Date added` means first retained DBI observation; source posting dates remain separate.
- Next ingest queue: exhaustive DoW award/IDV/order coverage beyond the disclosed keyword boundary, historical C-1 discovery, service-hosted RDT&E/procurement justification books, automated agency acquisition forecasts and DoD announcements, complete subaward-detail pagination, and exact predecessor/successor crosswalks.
- Each pipeline source tracks publisher, source URL, priority, status, cadence, access model, readiness, impact, effort, join keys, first ingest task, and analytic value.
- Account Flow preserves request, apportionment, obligation, outlay, and award-account measures at their published grains.
- Awards exposes the sampled USAspending inventory without ranking work or prescribing action.
- Transactions assembles 198 normalized source rows with a growing, non-duplicate automatic USAspending corpus, then exposes reported terms, canonical events, exact FPDS actions, exact subaward counts, bounded recent subaward detail, cumulative obligations, work categories, ingestion provenance, refresh changes, and configurable descriptive Gantt views.
- Analytics adds ten route-loaded D3 views for schedule activity, obligation/value distribution, portfolio-recipient composition, funding-office fiscal history, work categories, ingestion provenance, field coverage, money lineage/public join gaps, refresh changes, and prime-to-subaward concentration.
- Sources visualizes publishers, record counts, refresh times, relationship classes, and join policy.
- Coverage diagnostics show signal-tagged record/value coverage, workbook-level organization mix, and top mission signals by source.
- Justification evidence diagnostics show official XML count, extracted program items, matched budget lines, and narrative-confirmed technology lines.
- USAspending diagnostics show technology searches, award hits, unique awards, sampled award value, top vendors, top buyers, and selected-area execution signals.
- Source health checks track current workbook URLs and pipeline-source URLs with status, probe method, response time, and checked timestamp. Refresh with `npm run source:health`.
- Snapshot deltas remain available in generated data for audit and refresh diagnostics; build them locally with `npm run data:delta` and `PREVIOUS_GIT_REF` or explicit prior-snapshot file paths.
- Budget and award tables link each visible record to its official workbook or USAspending record and expose an evidence-detail drawer with source system, snapshot, method, and record identity.
- The sequenced [Federal Money Lifecycle Roadmap](docs/federal-money-lifecycle-roadmap.md) defines the account-level progression from request through apportionment, execution, procurement, awards, subawards, and active/upcoming work without overstating budget-line-to-contract joins.

## Commands

```bash
npm install
npm run source:workbooks
npm run source:justifications
npm run source:usaspending
npm run source:contracts
npm run source:account-spine
npm run source:refresh
npm run data:build
npm run source:health
npm run dev
npm run verify
npm run verify:pages-auth
npm run verify:agent-api
npm run verify:postgres-auth
npm run verify:postgres-auth:local
npm run container:up
npm run container:verify
npm run container:down
npm run verify:prod-interactions
npm run pages:deploy
npm run verify:prod-smoke
```

`verify:postgres-auth` targets an already running authenticated sidecar (as CI does). Use `verify:postgres-auth:local` for a self-contained local run; it builds the current app image, creates a temporary PostgreSQL database, starts the verifier sidecar, and removes both after the contract finishes.

## Publishing

The primary public surface is Cloudflare Pages at `defense-budget-intelligence.pages.dev`, matching the Opportunity Intelligence and Policy Intelligence app pattern. The repository also publishes to GitHub Pages from the `gh-pages` branch as a fallback.
