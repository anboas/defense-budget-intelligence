# Federal Money Lifecycle Roadmap

## Product thesis

Defense Budget & Spend Intelligence should become a **federal money graph**: a source-
linked account of what was requested, what Congress authorized and appropriated, what OMB
made available, what agencies obligated and outlayed, what procurement actions created
demand, which awards and vehicles received the money, which vendors performed the work,
and what remains active or likely to compete next.

The application should answer four questions:

1. What money was asked for, changed, and enacted?
2. How much authority is available, obligated, outlayed, or at risk of expiring?
3. Where did the money go by organization, program, contract, vendor, vehicle, and place?
4. What active or upcoming work is supported by the funding and acquisition evidence?

## The lifecycle

```text
DoD request
  -> House and Senate marks
  -> enacted authority
  -> OMB apportionment
  -> agency allocation and account execution
  -> forecast and SAM opportunity
  -> contract vehicle, award, order, and modification
  -> prime recipient and subaward
  -> outlay and observed mission result
```

Each stage is a different financial or acquisition concept. The application must never
add request, budget authority, apportionment, obligations, outlays, award ceiling, and
potential award value as though they were equivalent dollars.

## Source architecture

### Request and justification

- OUSD(C) display books and justification books remain the authoritative request layer.
- Preserve request vintage, fiscal-year amount, appropriation account, budget activity,
  budget line, program element, project, and source page or worksheet.
- Add historical request packages so the product can show what changed between vintages.

### Legislative action and enacted authority

- Use [GovInfo bulk data](https://www.govinfo.gov/bulkdata) for bills, bill status,
  committee reports when available, public laws, and statutory text.
- Parse House, Senate, and conference tables into explicit marks against request lines.
- Retain the source table and page for every adjustment. Text similarity can propose a
  match but may not silently establish one.

### Apportionment and account execution

- Ingest [OMB public apportionments](https://apportionment-public.max.gov/) by TAFS.
- Use [USAspending](https://api.usaspending.gov/docs/) federal-account, Treasury-account,
  program-activity, object-class, award-account, transaction, obligation, and outlay data.
- Use [Treasury Fiscal Data](https://fiscaldata.treasury.gov/api-documentation/) for
  governmentwide and account-level reconciliation where applicable.
- Make TAFS/TAS plus fiscal year the exact financial spine.

### Procurement demand and awards

- Use the [SAM Contract Opportunities API](https://open.gsa.gov/api/get-opportunities-public-api/)
  for sources sought, presolicitations, solicitations, amendments, award notices, and
  response dates.
- Use the [SAM Contract Awards API](https://open.gsa.gov/api/contract-awards/) as the
  current contract-action ingestion surface. Treat FPDS as the historical lineage and
  field model, not a second competing award truth.
- Join opportunities to awards through notice ID, solicitation number, PIID, and
  referenced IDV PIID when those identifiers are present.
- Preserve order, call, modification, and parent-vehicle relationships.
- Account for the public 90-day delay on unrevealed DoD awards.

### Organizations, vendors, and downstream work

- Use the [SAM Entity API](https://open.gsa.gov/api/entity-api/) for UEI, CAGE, business
  types, NAICS, PSC, and registration attributes.
- Use the [SAM Federal Hierarchy API](https://open.gsa.gov/api/fh-public-api/) to reconcile
  CGAC, FPDS agency/office codes, organization history, and parent paths.
- Add the [Acquisition Subaward Reporting API](https://open.gsa.gov/api/acquisition-subaward-reporting-api/)
  for public subcontract allocation.
- Keep recipient location, place of performance, and subaward location separate.

### Outcomes and limits

- Public data generally does not expose invoice-level PIEE/WAWF records or complete CPARS
  performance. Outlays are not invoices, and award dollars are not mission outcomes.
- Support analyst annotations and sourced outcome evidence without presenting them as
  government system-of-record facts.

## Identity and join model

### Exact joins

- Fiscal account: fiscal year + TAFS/TAS + federal account code
- Procurement: notice ID + solicitation number + PIID + referenced IDV PIID
- Vendor: UEI + CAGE
- Organization: SAM hierarchy ID + FPDS office/agency code + CGAC
- Award funding: USAspending generated award ID/PIID -> federal account/TAS

### Evidence-qualified joins

There is no universal public key from a DoD budget line or program element to a contract.
Every non-exact relationship must store:

- relationship class: `asserted`, `derived`, or `inferred`
- confidence score and method version
- supporting source records
- human review status
- validity dates and superseding relationship

In the UI, exact edges are solid; evidence-qualified edges are dashed and disclose why
the relationship exists.

## Decision surfaces and visualizations

### 1. Money lifecycle

A program or account timeline showing request, House mark, Senate mark, enacted amount,
apportionment, obligations, outlays, award actions, and remaining balances. Users can
switch fiscal year and request vintage without losing the entity context.

### 2. Request-to-execution waterfall

A waterfall for requested, marked, enacted, apportioned, obligated, and outlayed amounts.
Show absolute and percentage variance, time elapsed, and evidence freshness.

### 3. Account flow Sankey

Exact flows only by default:

```text
TAFS / federal account
  -> program activity and object class
  -> funding office
  -> award family or vehicle
  -> prime vendor
  -> subaward vendor and place of performance
```

Users may opt into inferred budget-line edges, which remain dashed and separately totaled.

### 4. Allocation treemap and sunburst

Service -> appropriation -> account -> budget activity -> line/program. Size by selected
money stage; color by growth, execution rate, evidence coverage, or confidence.

### 5. Execution burn curve

Cumulative obligations and outlays against the fiscal-year clock with prior-year bands,
period-of-availability boundaries, continuing-resolution effects, and expiration risk.

### 6. Procurement horizon

A time-axis from agency forecast to sources sought, presolicitation, solicitation,
amendments, award, modifications, option periods, current end date, and likely recompete.
Predicted events must be labeled as predictions.

### 7. Vehicle and award-family tree

IDV/GWAC/BPA -> orders/calls -> modifications, with obligated dollars, current value,
potential ceiling, period of performance, competition, and remaining capacity kept as
separate measures.

### 8. Buyer-vendor network

Funding and contracting offices connected to award families and vendors. Add concentration
metrics, incumbent share, new entrants, set-aside mix, and cross-office relationships.

### 9. Geographic allocation map

Toggle recipient address, place of performance, and subaward performance. Never merge
these into one location measure.

### 10. Active and upcoming work board

Rank active notices, response deadlines, expiring awards, option windows, likely
recompetes, new-start request lines, growing accounts, and unobligated balances. Every
card should explain whether timing is official, derived, or predicted.

## Stateful data model

The existing Postgres foundation should evolve from JSON snapshot storage into normalized,
versioned entities:

- `source_documents` and `source_observations`
- `fiscal_accounts`, `budget_lines`, and `budget_events`
- `apportionments` and `execution_balances`
- `opportunity_notices` and `opportunity_versions`
- `award_families`, `award_actions`, and `award_funding_accounts`
- `contract_vehicles` and `vehicle_orders`
- `organizations`, `vendors`, and `subawards`
- `entity_links` with evidence class and confidence
- `watch_rules`, `alerts`, and analyst annotations

Every financial fact needs an amount type, fiscal period, source timestamp, source URI,
source identifier, content hash, and observation timestamp. Ingestion should be append-only
with current materialized views, so corrections do not erase the historical record.

## Delivery status

### Exact money lifecycle: operational

Schema 1.5 retains five fiscal years of exact money evidence:

- 741 federal-account snapshots across FY2022-FY2026
- 1,335 distinct Treasury accounts and 4,060 FY/TAS execution balances
- 6,105 retained OMB apportionment revisions rather than only the latest file
- 803 deduplicated program activities and 175 object-class observations
- 59 independent Treasury Monthly Statement observations for DoD military-program outlays
- 778 exact award-account relationships from the stratified award sample

USAspending and OMB remain the exact account spine. Treasury MTS observations are an
independent agency-level reconciliation layer, not a substitute for TAS-level execution.
The UI and graph must never add request, budget authority, apportionment, obligations,
outlays, award totals, or ceilings together.

Acceptance is enforced by `verify:money-lifecycle`, graph integrity, Agent API traversal,
and source-linked relationship checks.

### SAM acquisition backbone: implemented, protected source activation pending

The schema, collector, normalization rules, Agent API types, and fail-closed verification
are implemented for:

- opportunity notices and observed versions
- award actions, modifications, orders, and referenced IDVs
- vendor registrations, UEIs, CAGE codes, and public business classifications
- source-declared federal hierarchy observations
- acquisition subawards with prime and subrecipient identity

Live collection requires `SAM_GOV_API_KEY` in the protected secret store. Until the key is
available, every SAM adapter reports `unavailable` or `stale`, preserves prior verified
records, and publishes zero completeness claims. Public Contract Awards data can delay
unrevealed DoD actions by at least 90 days. Observed opportunity versions are not presented
as the complete SAM Data Services version archive.

### Remaining sequence

1. Activate and prove the protected SAM collectors, then backfill 90 days and switch to
   daily delta collection with deleted-record handling.
2. Extend exact money history from five to ten fiscal years and add complete priority-award
   transaction/action histories, subject to source throughput.
3. Add request-to-mark-to-enactment evidence from GovInfo, Congress.gov, official committee
   reports, public laws, and enacted tables.
4. Add agency acquisition-forecast adapters, SBIR/STTR when stable, and authoritative
   installation mission/tenant sources.
5. Derive concentration, incumbent, teaming, recompete, expiration, and execution-risk
   signals only after the relevant exact evidence passes coverage thresholds.

The durable program, source prerequisites, service-level objectives, and promotion gates
are maintained in [`intelligence-data-roadmap.md`](./intelligence-data-roadmap.md).

The validation spike in `.tmp/openclaw-spikes/federal-money-join/` is **PARTIAL**: exact
account-level joins work, including multi-account awards; universal budget-line-to-award
joins do not. The product design above preserves that distinction.
