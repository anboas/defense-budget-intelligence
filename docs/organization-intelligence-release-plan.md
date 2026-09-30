# Organization Intelligence release plan

## Objective

Ship a source-backed organization research system centered on 100 prioritized dossiers and at least 250 public professional role-tenure observations.

## Constraints

- Public professional information only.
- Exact dates remain distinct from observed-current lower bounds.
- Fuzzy matches create review gaps, never canonical relations.
- Financial measures retain their source semantics.
- Users, authentication, workspaces, and existing application state remain unchanged.
- Initial shell and Opportunity Map payloads remain unchanged; dossier detail stays deferred.

## Graph transformations

1. Create `organization-dossier`, `organization-mission-claim`, `organization-financial-summary`, `organization-research-gap`, and `organization-change-event` entities.
2. Expand public `person` and `official-role` entities to at least 250 sourced role-tenure observations.
3. Relate dossiers to exact organization identities, parents/subordinates, leaders, programs, accounts, awards, vendors, locations, documents, sources, and gaps.
4. Publish freshness, coverage, conflict, and unresolved-gap metadata for every dossier.
5. Expose organization dossiers and role tenure through ADMIN and Agent API resources.

## Verification

- Assert 100 dossier identities and at least 250 sourced roles.
- Assert source URLs, observation dates, validity state, and tenure precision on every role.
- Assert every dossier retains at least one official/public source and a visible research-gap inventory.
- Assert financial values retain request/apportionment/obligation/outlay/award/ceiling semantics.
- Verify desktop/mobile ADMIN navigation, dossier drill-down, Agent API traversal, graph integrity, payload budgets, and fail-closed source behavior.

## Release

- Commit to a feature branch.
- Run protected policy, security, recovery, container, authenticated D1/API, graph, and browser gates.
- Squash merge, replay post-merge workflows, deploy exact canonical `main`, and verify hosted parity.

## Implemented schema 2.3 baseline

- 100 prioritized organization dossiers across public leadership, reviewed mission organizations, program offices, major buyers, and major vendors.
- 111 public professionals and 292 sourced professional-role observations from curated transition evidence and 10 official committee directories.
- 54 mission or jurisdiction claims, 59 typed financial summaries, 257 explicit research gaps, and 257 dated organization change events.
- Full ADMIN dossier routes with search, people and tenure, mission, finances, programs, awards, accounts, vendors, locations, timeline, sources, and research queues.
- Agent API traversal for dossiers and every linked graph domain.
- Schema 2.3 contains 72,073 typed entities and 134,924 evidence-bearing relations.
