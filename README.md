# Defense Budget & Spend Intelligence

Purpose-built analytics platform for understanding Department of Defense budget and spend data in detail.

Live Cloudflare Pages site: <https://defense-budget-intelligence.pages.dev/>

GitHub Pages fallback: <https://anboas.github.io/defense-budget-intelligence/>

Complementary intelligence platforms:

- Defense Budget & Spend Intelligence: <https://defense-budget-intelligence.pages.dev/>
- Opportunity Intelligence: <https://opportunity-intelligence-full.pages.dev/>
- Policy Intelligence: <https://policy-intelligence-full.pages.dev/>

## Scope

- Services: Army, Navy / Marine Corps, Air Force / Space Force.
- Fourth Estate: OSD / Defense-Wide, defense agencies, combatant commands, and joint organizations.
- Colors of money: M-1, O-1, P-1, R-1, RF-1, and C-1 display books.
- Drilldown levels: portfolio, request vintage, service / Fourth Estate, organization, appropriation account, budget activity, budget line item, technology area, and source evidence.
- Signal views: AI / autonomy, cyber, space, software / digital, missiles, shipbuilding, aircraft, medical, logistics, and infrastructure.

## Platform Paradigms

Defense Budget & Spend Intelligence follows the same product-family conventions as Opportunity Intelligence, Policy Intelligence, and Control Surface UI:

- Compact operations workspace with dense scan-first cards, filters, metrics, tables, and source provenance.
- Product header shell with active page title, flat top navigation, and stable `if-*` / `data-*` hooks for future framework alignment.
- Hash-route deep links for each major surface: Overview, Trends, Strategy, Hypotheses, Relationships, Awards, Pursuits, Cockpit, Services, Fourth Estate, AI / Autonomy, Drilldown, Data Sources, and Changes.
- Validated URL-backed filters and selections, explicit Reset and Retry actions, browser-local watched views, and deterministic snapshot deltas.
- CSV and JSON exports carry the exact view URL, snapshot timestamp, extraction methodology, and row-level official-source lineage.
- Peer navigation to Budget & Spend, Opportunity, and Policy as complementary intelligence platforms with separate product boundaries.
- Cloudflare Pages as the primary public surface, with GitHub Pages retained as a fallback.

## Stateful container foundation

The repository also includes a production-neutral container stack for the next platform phase:

- one Node container serves the compiled Vite application and a versioned `/api/v1` surface;
- PostgreSQL stores immutable intelligence snapshots and mutable analyst state;
- idempotent SQL migrations run under a PostgreSQL advisory lock at application startup;
- committed budget, source-health, and refresh-delta snapshots are imported by content hash;
- public snapshot reads are available immediately;
- saved-view writes are disabled by default and require both `ENABLE_WRITES=true` and a host-injected `APP_WRITE_TOKEN`.

The initial schema includes `intelligence_snapshots`, `refresh_runs`, `saved_views`, `comparison_sets`, and `annotations`. This is an additive migration path: the live Pages sites can remain online while frontend reads move from static JSON to the API route by route.

Run the local stack:

```bash
npm run container:up
npm run container:verify
npm run container:down
```

The Compose database is private to the application network and uses local trust authentication. Production must use a managed PostgreSQL connection supplied through the host's protected secret store. Do not commit a production connection string or write token.

Container health contracts:

- `GET /api/healthz` confirms the process is running.
- `GET /api/readyz` confirms PostgreSQL is reachable.
- `GET /api/v1/snapshots` lists the latest snapshot metadata by layer.
- `GET /api/v1/snapshots/:kind/current` returns the current persisted payload for `budget`, `source_health`, or `refresh_delta`.

The GitHub Pages workflow treats this stack as a release gate: it builds the images, starts a fresh database, applies migrations, imports snapshots, verifies the API, and only then publishes the static fallback. The public Pages site remains the production surface until a container host and managed Postgres are selected and provisioned.

## Data Sources

The site currently uses six official FY2027 Office of the Under Secretary of Defense (Comptroller) display workbooks:

- M-1: Military Personnel
- O-1: Operations and Maintenance
- P-1: Procurement
- R-1: Research, Development, Test, and Evaluation
- RF-1: Revolving and Management Funds
- C-1: Military Construction / Family Housing / BRAC

The parser reads line-level data from the official display workbooks and preserves FY2025, FY2026, and FY2027 values when present. For C-1, values are organized by the workbook fiscal-year field. It can also read cached FY2027 Procurement and RDT&E justification XML from OUSD(C) to add compact narrative evidence, confidence, and source links to strategy lanes. A separate USAspending snapshot adds execution-side contract award, buyer, vendor, PSC, NAICS, and services-fit signals. CI builds use the committed generated JSON when the local workbook cache is not present.

Local source refresh uses cached workbooks from `BUDGET_SOURCE_DIR`, defaulting to the user home artifact directory. `npm run source:workbooks` downloads the official FY2024-FY2027 display books, and `npm run source:refresh` rebuilds all public snapshots.

Justification source refresh uses `npm run source:justifications`, which caches reachable official FY2027 Procurement and RDT&E XML sources under `BUDGET_SOURCE_DIR/justifications/FY2027` and records unavailable official links in the manifest.

Execution source refresh uses `npm run source:usaspending`, which caches top DoD contract award results by technology-area keyword search under `BUDGET_SOURCE_DIR/usaspending/FY2025-FY2026`.

GitHub Actions checks all source layers every Monday. Budget books are annual source material, while award execution and source health are reviewed weekly. The site labels each layer independently as current, review-needed, or unavailable rather than presenting one misleading global freshness date.

Current version depth:

- Budget request packages versioned in this repo: FY2024-FY2027 display-book vintages, with FY2027 as the current full-color package.
- Fiscal-year values extracted from current and historical packages: FY2022-FY2027 where available by request vintage.
- Source coverage ladder: budget request line items are live; FY2027 OUSD(C) Procurement/RDT&E program narrative is partially ingested; USAspending execution-side award snapshots are partially ingested; FPDS/SAM and market timing feeds are staged next.
- Next ingest queue: historical C-1 discovery, service-hosted RDT&E/procurement justification books, USAspending obligation trend pulls, FPDS / SAM.gov contract data, and SAM.gov contract opportunities.
- Each pipeline source tracks publisher, source URL, priority, status, cadence, access model, readiness, impact, effort, join keys, first ingest task, and analytic value.
- Relationships connects lanes, technology areas, buyers, vendors, work types, budget lines, award evidence, and pursuit actions into a single decision surface.
- Hypotheses turns top pursuit lanes into generated theses with budget evidence, execution evidence, counterpoints, validation tasks, and linked source records.
- Cockpit turns the generated capture queue into selected lane briefs with budget posture, execution posture, timing, incumbent, evidence, gaps, and next actions.
- Data Sources visualizes the ingestion ladder, source join paths, and an impact-versus-readiness matrix for deciding what to integrate next.
- Coverage diagnostics show signal-tagged record/value coverage, workbook-level organization mix, and top mission signals by source.
- Justification evidence diagnostics show official XML count, extracted program items, matched budget lines, and narrative-confirmed technology lines.
- USAspending diagnostics show technology searches, award hits, unique awards, sampled award value, top vendors, top buyers, and selected-area execution signals.
- Source health checks track current workbook URLs and pipeline-source URLs with status, probe method, response time, and checked timestamp. Refresh with `npm run source:health`.
- Changes compares consecutive budget, award, capture-queue, and source-health snapshots; build it locally with `npm run data:delta` and `PREVIOUS_GIT_REF` or explicit prior-snapshot file paths.
- Budget and award tables link each visible record to its official workbook or USAspending record and expose an evidence-detail drawer with source system, snapshot, method, and record identity.
- The sequenced [Federal Money Lifecycle Roadmap](docs/federal-money-lifecycle-roadmap.md) defines the account-level progression from request through apportionment, execution, procurement, awards, subawards, and active/upcoming work without overstating budget-line-to-contract joins.

## Commands

```bash
npm install
npm run source:workbooks
npm run source:justifications
npm run source:usaspending
npm run source:refresh
npm run data:build
npm run source:health
npm run dev
npm run verify
npm run container:up
npm run container:verify
npm run container:down
npm run verify:prod-interactions
npm run pages:deploy
npm run verify:prod-smoke
```

## Publishing

The primary public surface is Cloudflare Pages at `defense-budget-intelligence.pages.dev`, matching the Opportunity Intelligence and Policy Intelligence app pattern. The repository also publishes to GitHub Pages from the `gh-pages` branch as a fallback.
