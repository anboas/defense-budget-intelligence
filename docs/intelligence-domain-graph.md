# Defense Intelligence domain graph

**Status:** Implemented deterministic baseline  
**Schema:** `1.0.0`  
**Runtime artifacts:** `data/intelligence-graph.json`, `data/intelligence-graph-index.json`

## Decision

Defense Intelligence uses one evidence graph across Budget Request, Account Flow, Awards, Spend Explorer, Opportunity Map, Schedule, tracking, discovery, and source-lineage surfaces. A surface is a projection of the graph, not a separate identity system.

The graph is generated from retained public-source snapshots. It does not create new factual claims. Every relationship records a source artifact, evidence basis, confidence class, and review state.

## Authority planes

| Plane | Owns | Rule |
| --- | --- | --- |
| Evidence | Source snapshots, URLs, notices, budget lines, accounts, awards, actions, subaward summaries, locations | Append or supersede through source refresh. Never edited as analyst opinion. |
| Identity | Stable IDs, exact aliases, exact source identifiers, deterministic source-to-source joins | No fuzzy merge. Conflicting identifiers remain separate until reviewed. |
| Research | Reviewed organization-location links, installation metadata, findings, gaps, confidence | Claim-level provenance and explicit review state. |
| Management | Tracking, owners, notes, tasks, events, workspace state | Versioned tenant-scoped writes. Never changes evidence. |
| Projection | Tables, maps, timelines, charts, callouts, summaries | Derived at read/build time. Never becomes authoritative identity or rank. |

## Canonical entities

| Entity | Canonical identity | Current scope |
| --- | --- | ---: |
| Activity | `opportunityId` | 888 |
| Award | USAspending generated award ID; PIID retained as alias | 702 |
| Event | Stable normalized `eventId` | 502 |
| Transaction | Stable exact FPDS `actionId` | 3,085 |
| Organization | Exact normalized public label, upgraded with UEI when published | 957 |
| Location | Stable reviewed Opportunity Map location ID | 885 |
| Federal account | Federal account code | 153 |
| Budget line | Stable PDB line ID | 3,888 |
| Subaward summary | Exact generated prime-award ID | 379 |
| Classification | Namespace plus code, such as NAICS, PSC, technology area, work category, or budget signal | 270 |
| Source | Canonical public HTTP(S) URL | 2,845 |

Organization identity is deliberately conservative. Exact normalized labels may connect repeated public labels across surfaces, but this is not a fuzzy legal-entity resolution claim. UEI and future official organization/office codes supersede label-only identity when available.

## Relationship vocabulary

### Activity spine

- `activity-awarded-as`
- `activity-has-event`
- `activity-has-transaction`
- `activity-recipient`
- `activity-contracting-organization`
- `activity-funding-organization`
- `contracting-activity-at`
- `funding-activity-at`

### Money lineage

- `award-recipient`
- `award-awarding-organization`
- `award-funding-organization`
- `award-funded-by-account`
- `award-has-subaward-summary`
- `budget-line-matches-account-title`
- `budget-line-owned-by-organization`

### Context and provenance

- `organization-located-at`
- `entity-classified-as`
- `supported-by-source`

## Evidence classes

| Class | Meaning | Example |
| --- | --- | --- |
| `exact` | Stable source identifier or exact public relationship | Activity to award by generated award ID; award to account from USAspending flow |
| `reviewed` | Human-reviewed source-backed relationship | Contracting activity to reviewed location |
| `source_declared` | Role or label explicitly published in a source artifact | Award funding organization |
| `deterministic` | Repeatable classification from retained fields | PSC, NAICS, technology area, work category |
| `derived` | Useful deterministic join that is not a universal official crosswalk | Exact normalized budget account title to federal account |

The UI must show the class and basis when the distinction affects interpretation. Derived joins never inherit the authority of exact joins.

## Current deterministic coverage

- All 888 activities exist in procurement discovery and the Opportunity Map projection.
- 702 activities connect to retained USAspending awards by generated award ID or exact PIID.
- 198 activities connect to 502 normalized calendar events.
- 131 activities connect to 3,085 exact FPDS actions.
- 530 activities connect to contract-monitor observations.
- 400 activity-to-location relationships retain contracting or funding placement basis.
- 250 award-flow records produce 485 exact award-to-account relationships across 183 unique awards.
- 379 award entities connect to exact prime subaward summaries.
- 3,569 of 3,888 budget lines connect to 66 federal accounts by exact normalized account title. The remaining 319 are explicit unresolved account-title joins.
- 373 reviewed/source-declared organization-to-location relationships are retained from installation metadata.

## Runtime design

`intelligence-graph.json` is the complete generated graph and release-integrity artifact. It is not part of initial page load.

`intelligence-graph-index.json` is a bounded deferred projection keyed by canonical activity ID. Record detail surfaces load it once on demand and reuse it for the browser session. It contains connected entity summaries, surface coverage, counts, and relationship evidence summaries without duplicating transaction and event bodies.

Build validation rejects:

- unknown entity or relationship types;
- duplicate entity IDs;
- dangling relationship endpoints;
- relationships without source artifact, basis, and confidence;
- unsafe or credential-shaped source URLs;
- loss of the established activity, award, event, transaction, location, subaward, account, or budget-line coverage;
- an activity index that omits any canonical opportunity ID;
- a deferred index above its route-on-demand budget.

## Cross-surface behavior

Every record detail surface should expose the same Connected Evidence summary:

- awards and PIIDs;
- exact FPDS action count;
- schedule/milestone count;
- recipient, contracting, and funding organizations;
- reviewed map locations;
- federal accounts;
- subaward coverage;
- classifications;
- primary source URLs;
- links to the timeline, map, account flow, awards, and source-lineage surfaces.

Deep links carry canonical IDs. Human-readable identifiers remain aliases for search and display.

## Known gaps and next passes

1. **Organization master data.** Promote UEI, agency/subagency codes, office codes, and reviewed parent-child hierarchy. Keep label-only entities separate until official identity evidence exists.
2. **Budget-to-account crosswalk.** Replace exact-title derived joins with Treasury/Federal Account Symbol evidence wherever a source mapping exists. Preserve unmatched lines.
3. **Award-to-opportunity lineage.** Add solicitation and predecessor/successor relationships using exact source-declared notice or parent PIIDs. Do not infer recompetes from timing alone.
4. **Location tenancy.** Expand reviewed organization-to-installation relationships and effective dates. Never infer tenancy from proximity.
5. **People and contacts.** Add only public professional contacts with source URL, role, organization, review state, and freshness. Keep personal data out.
6. **Events.** Unify source events and workspace events under one typed event entity while preserving evidence versus management ownership.
7. **Documents and claims.** Model source documents and claim-level observations explicitly so every promoted fact can be traced to a source span or structured source field.
8. **Outcomes.** Link pursued opportunities to capture decisions, submissions, awards, no-bids, losses, and lessons without rewriting public evidence.
9. **Model-assisted enrichment.** AI produces cited proposals only. Approved additions are atomic, additive, conflict-aware, and auditable.

## Non-goals

- No master opportunity score.
- No fuzzy company, office, installation, or account merge without review.
- No spend inference from geography.
- No future opportunity inference from historical spend.
- No conversion of a UI cluster, chart group, or callout priority into a persistent domain entity.
