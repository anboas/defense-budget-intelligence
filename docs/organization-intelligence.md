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

## Organization Watch

Schema 2.4 adds a fail-closed monitoring layer over the dossier source register:

- every monitored official source retains its canonical URL, allowed host, adapter,
  cadence, priority, content hash, observation time, and exact dossier coverage;
- a newly listed public role becomes a lower-bound observation proposal;
- a role that disappears from a directory becomes a review proposal and never establishes
  a tenure end date by itself;
- changed source content cannot overwrite mission, finance, hierarchy, or leadership facts;
- unchanged observations are suppressed from the analyst queue; and
- failed refreshes preserve the last verified snapshot and expose diagnostics.

The scheduled source-refresh workflow preserves the previous verified role and dossier
snapshots before regeneration. `organization-change-monitor.json` is therefore a bounded,
reviewable diff artifact rather than an ungrounded alert stream.

## Schema 2.4 coverage

- 100 organization dossiers
- 113 public professionals
- 294 sourced official roles
- 56 mission or jurisdiction claims
- 60 financial summaries
- 254 research gaps
- 257 change events
- 10 monitored official sources and 10 current content-hash observations
- 17 exact source-to-dossier coverage links
- 72,113 graph entities and 134,991 relations

The ADMIN route loads `organization-intelligence.json` and the 15 KB
`organization-change-monitor.json` only when opened. The initial shell, Opportunity Map,
and deferred activity index remain unchanged.
