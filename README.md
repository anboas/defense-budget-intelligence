# Defense Budget Intelligence

Purpose-built analytics platform for understanding Department of Defense budget request data in detail, with a Sabre growth role lens.

## Scope

- Services: Army, Navy / Marine Corps, Air Force / Space Force.
- Fourth Estate: OSD / Defense-Wide, defense agencies, combatant commands, and joint organizations.
- Colors of money: M-1, O-1, P-1, R-1, RF-1, and C-1 display books.
- Drilldown levels: portfolio, service / Fourth Estate, organization, appropriation account, budget activity, budget line item, and source workbook link.
- Signal views: AI / autonomy, cyber, space, software / digital, missiles, shipbuilding, aircraft, medical, logistics, and infrastructure.

## Data Source

The initial build uses FY2027 Comptroller display workbooks cached under:

```text
/home/anboas/clawd/artifacts/sabre-research/budget/
```

The parser reads line-level data from the official display workbooks and preserves FY2025, FY2026, and FY2027 values when present. For C-1, values are organized by the workbook fiscal-year field. CI builds use the committed generated JSON when the local workbook cache is not present.

## Commands

```bash
npm install
npm run data:build
npm run dev
npm run verify
```

## Publishing

The site is built as static Vite output and published through GitHub Pages from the `gh-pages` branch.
