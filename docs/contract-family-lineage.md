# Contract-family lineage

## Purpose

Defense Intelligence represents contract-family structure as evidence-bearing graph relationships rather than title similarity. The model connects exact parent IDVs, child orders, published acquisition paths, predecessor/follow-on crosswalks, sibling orders, and review-only timing signals without treating a possible recompete as an established procurement.

## Entity model

- **Contract vehicle**: one exact USAspending parent IDV generated award identifier and its published parent PIID.
- **Acquisition path**: a source-declared vehicle or access-path label retained independently from the exact parent IDV.
- **Recompete signal**: a review-only timing observation created when a retained award's reported end date falls within 730 days of the source snapshot.
- **Activity and award**: the existing canonical activity and USAspending award entities remain the order/follow-on endpoints.

## Relationship rules

1. `activity-ordered-under-vehicle` and `award-ordered-under-vehicle` require the exact `parentAwardId` and `parentPiid` returned by the retained USAspending award-detail observation.
2. `activity-uses-acquisition-path` retains the source-published vehicle label. It does not replace or manufacture an exact parent IDV.
3. `contract-vehicle-associated-with-path` is source-declared only when the same retained activity publishes both an exact parent IDV and an acquisition-path label.
4. `activity-follow-on-to` requires a predecessor reference that resolves to exactly one different retained activity. Exact source-declared PIIDs are verified; a curated named-program crosswalk remains visibly reviewed.
5. `activity-has-recompete-signal` and `award-has-recompete-signal` are derived, `needs_review` relationships. An end date alone never establishes a recompete, successor, solicitation, acquisition strategy, or accessible vehicle.

## Conflict and review policy

- Ambiguous or unresolved predecessor references do not create graph edges.
- Follow-on or recompete wording without a retained predecessor identifier remains in `contract-lineage-review.json`.
- `TBD` vehicle labels are excluded from the acquisition-path registry.
- Sibling orders are graph neighbors under one exact parent IDV, not inferred from titles, vendors, offices, dates, or descriptions.
- The review artifact is deterministic and can be regenerated from the retained public-source corpus.

## Runtime artifacts

- `intelligence-graph.json`: complete deployment/review graph.
- `intelligence-graph-index.json`: bounded cross-surface activity evidence index.
- `contract-lineage-index.json`: deferred browser index for vehicles, sibling orders, predecessor/successor links, and timing signals.
- `contract-lineage-review.json`: bounded unresolved-claim and conflict queue.

The initial shell and Opportunity Map do not fetch any lineage artifact. Record drawers fetch the deferred lineage index with the existing Connected Intelligence panel, then reuse it for the browser session.
