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
- Hash-route deep links for each major surface: Overview, Trends, Strategy, Services, Fourth Estate, AI / Autonomy, Drilldown, and Data Sources.
- Peer navigation to Budget & Spend, Opportunity, and Policy as complementary intelligence platforms with separate product boundaries.
- Cloudflare Pages as the primary public surface, with GitHub Pages retained as a fallback.

## Data Sources

The site currently uses six official FY2027 Office of the Under Secretary of Defense (Comptroller) display workbooks:

- M-1: Military Personnel
- O-1: Operations and Maintenance
- P-1: Procurement
- R-1: Research, Development, Test, and Evaluation
- RF-1: Revolving and Management Funds
- C-1: Military Construction / Family Housing / BRAC

The parser reads line-level data from the official display workbooks and preserves FY2025, FY2026, and FY2027 values when present. For C-1, values are organized by the workbook fiscal-year field. It can also read cached FY2027 Procurement and RDT&E justification XML from OUSD(C) to add compact narrative evidence, confidence, and source links to strategy lanes. A separate USAspending snapshot adds execution-side contract award, buyer, vendor, PSC, NAICS, and services-fit signals. CI builds use the committed generated JSON when the local workbook cache is not present.

Local source refresh uses cached workbooks from `BUDGET_SOURCE_DIR`, defaulting to `$HOME/clawd/artifacts/defense-budget-intelligence/budget`. Replace the cached workbooks, run `npm run data:build`, review the Data Sources page, then commit the generated JSON.

Justification source refresh uses `npm run source:justifications`, which caches reachable official FY2027 Procurement and RDT&E XML sources under `BUDGET_SOURCE_DIR/justifications/FY2027` and records unavailable official links in the manifest.

Execution source refresh uses `npm run source:usaspending`, which caches top DoD contract award results by technology-area keyword search under `BUDGET_SOURCE_DIR/usaspending/FY2025-FY2026`.

Current version depth:

- Budget request packages versioned in this repo: FY2024-FY2027 display-book vintages, with FY2027 as the current full-color package.
- Fiscal-year values extracted from current and historical packages: FY2022-FY2027 where available by request vintage.
- Source coverage ladder: budget request line items are live; FY2027 OUSD(C) Procurement/RDT&E program narrative is partially ingested; USAspending execution-side award snapshots are partially ingested; FPDS/SAM and market timing feeds are staged next.
- Next ingest queue: historical C-1 discovery, service-hosted RDT&E/procurement justification books, USAspending obligation trend pulls, FPDS / SAM.gov contract data, and SAM.gov contract opportunities.
- Each pipeline source tracks publisher, source URL, priority, status, cadence, access model, readiness, impact, effort, join keys, first ingest task, and analytic value.
- Data Sources visualizes the ingestion ladder, source join paths, and an impact-versus-readiness matrix for deciding what to integrate next.
- Coverage diagnostics show signal-tagged record/value coverage, workbook-level organization mix, and top mission signals by source.
- Justification evidence diagnostics show official XML count, extracted program items, matched budget lines, and narrative-confirmed technology lines.
- USAspending diagnostics show technology searches, award hits, unique awards, sampled award value, top vendors, top buyers, and selected-area execution signals.
- Source health checks track current workbook URLs and pipeline-source URLs with status, probe method, response time, and checked timestamp. Refresh with `npm run source:health`.

## Commands

```bash
npm install
npm run source:justifications
npm run source:usaspending
npm run data:build
npm run source:health
npm run dev
npm run verify
npm run pages:deploy
npm run verify:prod-smoke
```

## Publishing

The primary public surface is Cloudflare Pages at `defense-budget-intelligence.pages.dev`, matching the Opportunity Intelligence and Policy Intelligence app pattern. The repository also publishes to GitHub Pages from the `gh-pages` branch as a fallback.
