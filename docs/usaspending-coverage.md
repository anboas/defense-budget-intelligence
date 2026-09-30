# USAspending contract coverage

**Source:** Official [USAspending API](https://api.usaspending.gov/docs/)
**Graph schema:** `1.5.0`
**Refresh:** `npm run source:usaspending-coverage`

## Published boundary

The breadth registry covers Department of Defense contract transactions from FY2017 through the current fiscal year. It publishes three different financial products that must remain separate:

1. **Annual contract obligations** are complete inside the disclosed agency, contract-award-type, and fiscal-year query boundary.
2. **Category observations** are ranked, bounded views of awarding subagencies, funding subagencies, recipients, PSCs, and NAICS industries. They are not complete population tables.
3. **Ranked awards and IDVs** are bounded top lists. Their `Award Amount` values are published life-of-award totals or ceilings, not fiscal-year obligations.

Annual/category obligations may be analyzed within their declared fiscal period. Award-level values must never be added to those obligations.

## Current retained coverage

- 10 fiscal years, FY2017–FY2026
- 10 annual DoD contract-obligation totals
- 7,061 deduplicated ranked category rows
  - 236 awarding-subagency observations
  - 825 funding-subagency observations
  - 2,000 recipient observations
  - 2,000 PSC observations
  - 2,000 NAICS observations
- 1,489 unique ranked contracts and IDVs
- 798 ranked awards with published recipient UEIs

The graph represents the ten annual totals plus category rows as 7,071 `spending-observation` entities. Every observation measures exactly one organization or classification and retains a source relation to the exact official API endpoint.

## Pagination and integrity

USAspending can repeat a later category page while reporting more results. The collector deduplicates within fiscal year and dimension by stable source identity and stops when a page contributes no new rows. Requested limits and realized row counts are both disclosed. A repeated page can therefore reduce realized coverage but cannot inflate it.

The release verifier requires:

- continuous fiscal-year coverage;
- explicit `complete-fiscal-year` versus `year-to-date` state;
- unique category identities within each fiscal year and dimension;
- unique generated award identities;
- official USAspending API source URLs;
- non-additive amount semantics;
- exact graph observation-to-subject and observation-to-source relationships.

## Account spine

The FY2022-FY2026 account spine combines official USAspending federal-account, Treasury-account, program-activity, object-class, and budgetary-resource endpoints with all discovered OMB apportionment revisions and independent Treasury Monthly Statement observations. Award-to-account relationships are added only through the exact USAspending generated award identifier and `/api/v2/awards/accounts/`. Titles and descriptions never create award-account links.

The account sampler ranks the union of the technology corpus and the breadth registry, then probes a bounded number of exact award identifiers. Coverage metadata records the available population, selected sample, successful probes, exact account links, mapped current accounts, and failures.

## Known gaps

- The ranked category and award lists are bounded rather than exhaustive transaction storage.
- Current-fiscal-year totals are year-to-date and subject to USAspending source latency.
- Award-account probing remains bounded; it is not a complete historical award-account transaction warehouse.
- Subaward detail is a retained recent sample even when the exact reported count is known.
- SAM.gov opportunity breadth remains unavailable to the static refresh when no protected API key is configured.
- CAGE and vendor-parent coverage remain incomplete.

These gaps stay explicit in source health, graph coverage, and the ADMIN Domain Model. Agents may add cited workspace overlays through Agent API 1.1, but source-backed snapshots remain immutable until reviewed publication.
