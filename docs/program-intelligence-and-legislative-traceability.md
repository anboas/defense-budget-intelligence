# Program Intelligence and Legislative Traceability

## Purpose

Program Intelligence connects official defense budget identities to sourced cost, schedule,
test, milestone, risk, legislative, execution, contract, organization, and mission evidence.
This release establishes the canonical program spine and a bounded, page-cited legislative
line-item pass without converting source similarity into fact.

## Program identity

The baseline program identity is an exact combination of:

- budget book: R-1, P-1, or C-1;
- source-published organization code; and
- program element, budget line item, or construction-project code.

One explicitly reviewed exception maps the official prior name `Ground Based Strategic
Deterrent` and current Sentinel construction names to `LGM-35A Sentinel`, based on the named
Sentinel finding in GAO-25-107569 and official DoD budget rows. All other aliases remain
unmerged until reviewed.

`program-office` currently means the source-published budget sponsor. It does not assert a
PEO, program manager, or acquisition chain. Those role-tenure claims belong to the preserved
official-people roadmap and require dated official sources.

## Baselines and assessments

`program-baseline` records in this release are President's Budget request baselines. They are
not Acquisition Program Baselines and are not independent cost estimates. Cost, schedule,
and risk records from GAO remain separate observations with the report date, source URL, and
scope. Portfolio findings attach only to the portfolio entity unless GAO names a program.

Empty acquisition-milestone, unit-cost-breach, and test-finding inventories are deliberate.
They expose missing coverage without manufacturing evidence.

## FY2024 House mark pass

The first line-item pass covers 35 RDT&E Army rows from House Report 118-121, printed pages
188 through 190, `Explanation of Project Level Adjustments`.

Each mark is promoted only after all of these checks pass:

1. exact FY2024 R-1 account and organization;
2. exact printed line number;
3. exact President's Budget request amount;
4. committee recommendation minus request equals the reported change;
5. retained report package, printed page, table title, and official URL.

The resulting chain is:

`FY2024 request line -> House appropriation mark -> House Report 118-121 -> H.R. 4365`

The House mark is a committee recommendation, not enacted authority. No enacted line amount,
Senate mark, conference adjustment, transfer, or rescission is asserted until its official
table is parsed and reconciled. The graph keeps those domains explicit so later passes can
extend the chain without overwriting the House recommendation.

## Sources

- [OUSD(C) Defense Budget Materials](https://comptroller.war.gov/Budget-Materials/)
- [House Report 118-121](https://www.govinfo.gov/app/details/CRPT-118hrpt121)
- [H.R. 4365, 118th Congress](https://www.congress.gov/bill/118th-congress/house-bill/4365)
- [GAO-25-107569](https://www.gao.gov/products/gao-25-107569)

## Refresh and review

- Rebuild with `npm run source:program-intelligence` after budget or reviewed source changes.
- Run `npm run data:runtime` to republish graph artifacts and Agent API shards.
- Scheduled source refreshes regenerate from the official FY2024 R-1 workbook. A failed
  workbook join or amount reconciliation aborts that refresh.
- Ordinary CI builds may use the committed 35-line extract that a prior source refresh
  verified from the workbook. Both paths enforce the same identifiers, arithmetic, source,
  and coverage assertions.
- Model-assisted extraction may propose additional rows, but promotion requires the same
  document, page, table, row, amount, and reviewer evidence.
