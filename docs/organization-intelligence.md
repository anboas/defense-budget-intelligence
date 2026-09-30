# Organization Intelligence

## Purpose

Organization Intelligence turns fragmented public evidence into durable, reviewable research
dossiers. Each dossier is a bounded projection over the canonical graph, not a claim that the
public record is complete.

## Dossier model

Every dossier can connect one reviewed organization identity to:

- parent organization and category;
- public professionals, official roles, tenure bounds, and succession evidence;
- official mission, charter, or congressional jurisdiction claims;
- typed financial summaries whose money semantics remain explicit;
- defense programs, awards, federal accounts, vendors, and locations;
- a dated change timeline;
- a source register; and
- unresolved research gaps with priority and review state.

## Selection policy

The first cohort is fixed at 100 high-value organizations. Category quotas preserve breadth
across sourced leadership and oversight organizations, reviewed mission organizations,
program offices, major buyers, and major vendors. Within each category, deterministic
evidence depth and retained financial relevance determine priority.

## People and tenure policy

- Only public professional roles are retained.
- Exact appointment, transition, or end dates require an official source statement.
- A current official directory establishes `observed-current-lower-bound`; it does not
  establish the true appointment date.
- Historical records remain addressable after succession.
- Personal contact details, home information, family details, and inferred employment are
  excluded.

## Financial policy

Every amount declares a measure type and evidence boundary. President's Budget request,
authority, apportionment, obligation, outlay, life-of-award value, and ceiling may never be
added together or presented as interchangeable measures.

## Research workflow

1. Seed a dossier from an exact identifier or reviewed official name.
2. Collect approved official and public sources.
3. Normalize claims with source URI, observation date, validity, precision, and review state.
4. Compare new claims with the current dossier.
5. Preserve competing claims and create a review item.
6. Promote only exact or reviewed relationships.
7. Publish source changes as dated events rather than silent overwrites.

## Schema 2.3 coverage

- 100 organization dossiers
- 111 public professionals
- 292 sourced official roles
- 54 mission or jurisdiction claims
- 59 financial summaries
- 257 research gaps
- 257 change events
- 72,073 graph entities and 134,924 relations

The ADMIN route loads `organization-intelligence.json` only when opened. The initial shell,
Opportunity Map, and deferred activity index remain unchanged.
