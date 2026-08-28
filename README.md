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
- Drilldown levels: portfolio, service / Fourth Estate, organization, appropriation account, budget activity, budget line item, and source workbook link.
- Signal views: AI / autonomy, cyber, space, software / digital, missiles, shipbuilding, aircraft, medical, logistics, and infrastructure.

## Platform Paradigms

Defense Budget & Spend Intelligence follows the same product-family conventions as Opportunity Intelligence, Policy Intelligence, and Control Surface UI:

- Compact operations workspace with dense scan-first cards, filters, metrics, tables, and source provenance.
- Product header shell with active page title, flat top navigation, and stable `if-*` / `data-*` hooks for future framework alignment.
- Hash-route deep links for each major surface: Overview, Services, Fourth Estate, AI / Autonomy, Drilldown, and Data Sources.
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

The parser reads line-level data from the official display workbooks and preserves FY2025, FY2026, and FY2027 values when present. For C-1, values are organized by the workbook fiscal-year field. CI builds use the committed generated JSON when the local workbook cache is not present.

Local source refresh uses cached workbooks from `BUDGET_SOURCE_DIR`, defaulting to `$HOME/clawd/artifacts/defense-budget-intelligence/budget`. Replace the cached workbooks, run `npm run data:build`, review the Data Sources page, then commit the generated JSON.

Current version depth:

- Budget request packages versioned in this repo: FY2027 only.
- Fiscal-year values extracted from the FY2027 package: FY2025, FY2026, and FY2027.
- Source coverage ladder: budget request line items are live; program narrative, obligations/outlays, and market timing feeds are staged next.
- Next ingest queue: prior-year Comptroller display books, RDT&E justification books, USAspending award search, FPDS / SAM.gov contract data, and SAM.gov contract opportunities.
- Each pipeline source tracks publisher, source URL, priority, status, cadence, access model, join keys, first ingest task, and analytic value.

## Commands

```bash
npm install
npm run data:build
npm run dev
npm run verify
npm run pages:deploy
npm run verify:prod-smoke
```

## Publishing

The primary public surface is Cloudflare Pages at `defense-budget-intelligence.pages.dev`, matching the Opportunity Intelligence and Policy Intelligence app pattern. The repository also publishes to GitHub Pages from the `gh-pages` branch as a fallback.
