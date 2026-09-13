# Opportunity Intelligence convergence

## Product boundary

Defense Budget Intelligence is the single factual application for budget requests, account execution, awards, transactions, subawards, source lineage, and operator management. The response-development workspace remains a separate product boundary and is not imported here.

## Reusable crossover

| Opportunity Intelligence capability | Unified destination | Rule |
| --- | --- | --- |
| Working set / tracked items | Operations → Watchlist | Stable public record IDs only; never alters evidence |
| Event tracking | Operations → Events | Operator-authored calendar is stored separately from published acquisition dates |
| Connector health | Operations → Integrations | Status, cadence, yield, and failures; source facts remain in Sources |
| Audit trail | Operations → Activity | Append-only operator changes, distinct from procurement change detection |
| Wall Board | Operations → Wallboard | Read-only projection of tracked records, events, reviews, and source health |
| Global record navigation | Watchlist, events, and wallboard links | Exact stable-ID routes into Transactions |

## Explicit exclusions

- Response authoring, compliance matrices, color-team workflows, proposal libraries, and submission packaging
- Bid / no-bid gates, win probabilities, pursuit scores, recommendations, and strategy briefs
- Any inferred relationship presented as an exact public join

## State model

### Evidence plane

The existing normalized datasets, PostgreSQL snapshots, and public source URLs remain authoritative. Operator actions cannot mutate this plane.

### Management plane

The first increment stores the following in the current browser:

- watch entry: `recordId`, starred and updated timestamps, optional review date and note, wallboard visibility
- event: ID, title, start/end, location, status, notes, linked stable record IDs, wallboard visibility
- activity: append-only timestamp, type, record/event ID, and concise detail

State is bounded, sanitized, deduplicated, and pruned when a record ID leaves the public universe. It is not encoded in shared URLs or public exports.

## Consolidation sequence

1. **Delivered in this increment:** star/unstar from Transactions, unified Operations route, local watchlist/events/activity, integration monitor, and fullscreen rotating wallboard.
2. **Authenticated workspace API:** move the same management schema to a private server-backed store with named users and optimistic concurrency.
3. **Shared wallboard profiles:** durable layouts, rotation intervals, saved filters, and display-only access tokens.
4. **Connector operations:** run history, retries, alerts, and source-specific diagnostics from the scheduled ingestion workflows.
5. **Cross-surface command search:** search public records, tracked items, events, sources, accounts, awards, and transactions from one command surface.

The migration should preserve stable IDs and keep evidence and operator state in separate tables and APIs.
