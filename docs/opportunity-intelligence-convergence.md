# Opportunity Intelligence convergence

## Product boundary

Defense Budget Intelligence is the single factual application for budget requests, account execution, awards, transactions, subawards, source lineage, and operator management. The response-development workspace remains a separate product boundary and is not imported here.

## Reusable crossover

| Opportunity Intelligence capability | Unified destination | Rule |
| --- | --- | --- |
| Working set / tracked items | Admin → Watchlist | Stable public record IDs only; never alters evidence |
| Event tracking | Admin → Events | Operator-authored calendar is stored separately from published acquisition dates |
| Connector health | Admin → Integrations | Status, cadence, yield, and failures; source facts remain in Source Lineage |
| Audit trail | Admin → API Log | Append-only human and agent changes, distinct from procurement change detection |
| Wall Board | Primary → Wallboard | Read-only projection of tracked records, events, reviews, and source health |
| Global record navigation | Watchlist, events, and wallboard links | Exact stable-ID routes into Transactions |

## Explicit exclusions

- Response authoring, compliance matrices, color-team workflows, proposal libraries, and submission packaging
- Bid / no-bid gates, win probabilities, pursuit scores, recommendations, and strategy briefs
- Any inferred relationship presented as an exact public join

## State model

### Evidence plane

The existing normalized datasets, PostgreSQL snapshots, and public source URLs remain authoritative. Operator actions cannot mutate this plane.

### Management plane

The authenticated Cloudflare application stores the following in D1; the static GitHub fallback retains browser-local equivalents:

- watch entry: `recordId`, starred and updated timestamps, optional review date and note, wallboard visibility
- event: ID, title, start/end, location, status, notes, linked stable record IDs, wallboard visibility
- activity: append-only timestamp, type, record/event ID, and concise detail

State is bounded, sanitized, deduplicated, and pruned when a record ID leaves the public universe. It is not encoded in shared URLs or public exports.

## Consolidation sequence

1. **Delivered:** star/unstar from Transactions, dedicated Admin routes, D1-backed watchlist/events/API log, integration monitor, and fullscreen rotating Wallboard.
2. **Delivered:** authenticated human and agent workspace APIs with optimistic concurrency and append-only audit history.
3. **Shared wallboard profiles:** durable layouts, rotation intervals, saved filters, and display-only access tokens.
4. **Connector operations:** run history, retries, alerts, and source-specific diagnostics from the scheduled ingestion workflows.
5. **Cross-surface command search:** search public records, tracked items, events, sources, accounts, awards, and transactions from one command surface.

The migration should preserve stable IDs and keep evidence and operator state in separate tables and APIs.
