# Opportunity Map domain model

## Authority boundary

The map is a projection of typed entities and evidence-backed relationships. It is not itself the system of record.

- **Location** is a sourced physical site or mapped organization with stable identity and approximate coordinates.
- **Activity** is a spend award or forward-looking opportunity with its own lifecycle.
- **Organization** is a buyer, sponsor, contracting office, funding office, service, company, or mission customer.
- **Evidence observation** records the source, reference period, precision, and basis for a claim.

Location existence never implies spend, a procurement, or relevance. Spend never establishes a future opportunity. Opportunity lifecycle never changes the sourced operational status of a physical site.

## Relationships

- `located-at`: an organization or office is documented at a location.
- `contracting-activity-at`: an activity resolves to a reviewed contracting-office location.
- `funding-activity-at`: an activity resolves to a reviewed funding-office location.
- `supported-by-evidence`: an entity or relationship is backed by a named source observation.

The UI may cluster locations for display, but a cluster is not a domain entity and must never become an identifier or aggregation source.

## Lifecycle and evidence filters

Lifecycle applies only to **Activity**:

- `live`: active plus upcoming activity
- `active`: current reported performance or monitored active status
- `upcoming`: a future acquisition window or option horizon
- `all`: active, upcoming, historical, and unresolved activity

Evidence applies to the map layers independently:

- `all`: authoritative location coverage plus the selected activity overlay
- `spend`: only activity with published spend evidence and reviewed placement
- `unbacked`: locations with no linked spend-backed activity in the current snapshot

“Unbacked” means no relationship has been established in this dataset. It does not mean zero spend.

## Stable identifiers and precedence

- Location IDs come from the reviewed source snapshot and remain stable across builds.
- Activity IDs use the canonical `opportunityId` shared by the capture and spend systems.
- Exact award-detail office observations override summary office labels.
- Explicit reviewed source offices may be used when exact award detail is unavailable.
- Unknown, redacted, or unmatched offices remain unresolved. They are never placed at a guessed headquarters.

## Runtime contract

`opportunity-map-data.json` is the single route-lazy payload. Schema version `2.0.0` contains:

- `metadata`: snapshot provenance and coverage counts
- `domain`: authoritative entity, relationship, lifecycle, and evidence vocabulary
- `locations`: complete sourced geographic entities
- `records`: spend and opportunity activity entities with explicit placement basis

Every placed activity emits typed `relations` containing the activity ID, location ID, relationship type, and evidence basis. Build validation rejects relationship types outside the domain vocabulary and every dangling location reference.

Build validation rejects missing coordinates, duplicate IDs, incomplete location snapshots, duplicate opportunity IDs, and vocabulary drift.

## Location snapshot maintenance

`src/data/opportunity-map-locations.json` is a normalized snapshot derived from the supplied enriched map record set. It is not the upstream research pipeline. Rebuild it only from a complete reviewed source export:

```bash
node scripts/import-opportunity-map-locations.mjs /absolute/path/to/map-records.json
```

The importer fails closed below 885 records, on duplicate IDs, or on missing names or coordinates. It preserves source identity, reference period, evidence status, buyer role, coordinate precision, and authoritative source URL while excluding presentation-only fields and narrative research artifacts.
