# Defense Budget Intelligence

Purpose-built analytics platform for understanding Department of Defense budget request data in detail, with a Sabre growth role lens.

Live Cloudflare Pages site: <https://defense-budget-intelligence.pages.dev/>

GitHub Pages fallback: <https://anboas.github.io/defense-budget-intelligence/>

Sibling intelligence platforms:

- Opportunity Intelligence: <https://opportunity-intelligence-full.pages.dev/>
- Policy Intelligence: <https://policy-intelligence-full.pages.dev/>

## Scope

- Services: Army, Navy / Marine Corps, Air Force / Space Force.
- Fourth Estate: OSD / Defense-Wide, defense agencies, combatant commands, and joint organizations.
- Colors of money: M-1, O-1, P-1, R-1, RF-1, and C-1 display books.
- Drilldown levels: portfolio, service / Fourth Estate, organization, appropriation account, budget activity, budget line item, and source workbook link.
- Signal views: AI / autonomy, cyber, space, software / digital, missiles, shipbuilding, aircraft, medical, logistics, and infrastructure.

## Data Sources

The site currently uses six official FY2027 Office of the Under Secretary of Defense (Comptroller) display workbooks:

- M-1: Military Personnel
- O-1: Operations and Maintenance
- P-1: Procurement
- R-1: Research, Development, Test, and Evaluation
- RF-1: Revolving and Management Funds
- C-1: Military Construction / Family Housing / BRAC

The parser reads line-level data from the official display workbooks and preserves FY2025, FY2026, and FY2027 values when present. For C-1, values are organized by the workbook fiscal-year field. CI builds use the committed generated JSON when the local workbook cache is not present.

Local source refresh uses cached workbooks from `BUDGET_SOURCE_DIR`, defaulting to `$HOME/clawd/artifacts/sabre-research/budget`. Replace the cached workbooks, run `npm run data:build`, review the Data Sources page, then commit the generated JSON.

Current version depth:

- Budget request packages versioned in this repo: FY2027 only.
- Fiscal-year values extracted from the FY2027 package: FY2025, FY2026, and FY2027.
- Next expansion targets: prior-year Comptroller workbooks, RDT&E justification PDFs, USAspending / FPDS obligations, and public contract or solicitation feeds.

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
