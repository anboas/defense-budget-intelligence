# Installation metadata passes

## Purpose

The installation layer is an authoritative geographic inventory with structured, reviewable metadata. It must not silently become a buyer list, spend model, mission ranking, or current-status assertion.

## Baseline pass

The checked-in baseline is a deterministic normalization of the reviewed 885-record source export. It introduces no generated facts. Each location retains:

- stable identity, aliases, component, and source identifiers
- source-reported operating status with its date and reference period
- coordinate precision, method, and confidence
- source-supported mission claims
- acquisition applicability and documented contracting route when available
- financial research status without treating missing evidence as zero spend
- primary evidence, audit dates, research gaps, and nearest-office context

The runtime publishes summary geography in `opportunity-map-data.json` and defers the full profiles to `opportunity-map-location-metadata.json` until a location is opened.

## Review states

- `reviewed`: supported by the reviewed primary-source pass
- `source_snapshot`: faithfully retained from a dated source inventory but not freshly revalidated
- `screened`: evaluated for scope; no stronger claim was promoted
- `not_assessed`: no completed pass exists
- `needs_review`: the current evidence is insufficient or stale for the claim
- `not_applicable`: the pass does not apply to the entity

## Model-assisted enrichment boundary

Any later AI-assisted pass is proposal-only and additive:

1. Search public sources and return strict structured output.
2. Retain the consulted-source inventory and claim-level source URLs.
3. Normalize identifiers, dates, enums, organizations, and links before storage.
4. Reject unsupported, private, malformed, contradicted, or wrong-entity claims.
5. Preserve curated values as conflicts rather than overwriting them.
6. Apply only approved missing fields atomically with their provenance.

No model-assisted result may infer a mission, operating status, purchasing authority, spend relationship, or opportunity from location alone.
