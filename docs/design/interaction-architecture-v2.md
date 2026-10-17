# DBI Interaction Architecture v2

Status: design blueprint and prototype

Prototype artifacts:

- [Interactive HTML prototype](./interaction-architecture-v2-prototype.html)
- [Today desktop](./screenshots/interaction-v2-today-desktop.png)
- [Timeline desktop](./screenshots/interaction-v2-timeline-desktop.png)
- [Timeline mobile](./screenshots/interaction-v2-timeline-mobile.png)
- [Opportunities desktop](./screenshots/interaction-v2-opportunities-desktop.png)
- [Today mobile](./screenshots/interaction-v2-today-mobile.png)
- [Opportunities mobile](./screenshots/interaction-v2-opportunities-mobile.png)

## 1. Objective

Reduce the time from a new signal to a defensible action.

The product should answer three questions immediately:

1. What needs my attention now?
2. What is happening next across the work I track?
3. What should I do with this opportunity?

The current product has strong data and useful analytical views, but users must repeatedly translate between surfaces that each own their own controls, selection, and actions. This redesign makes the operating flow primary and treats visualizations as lenses on that flow.

## 2. Current architecture findings

### Fragmented time

Chronological information is split across:

- My Work task due dates
- Capture Timeline milestones
- Schedule events
- opportunity deadlines and award term dates
- AI research key dates
- Connected Evidence's record timeline
- change and freshness timestamps

Timeline is therefore both everywhere and nowhere. It is available, but it is not the main way users orient themselves.

### Surface-owned state

Each major surface owns its own URL parsing, selection model, filters, view tabs, and action placement. The same record can be represented as a table row, card, timeline event, graph node, Sankey node, or task without one durable cross-surface context.

### Controls outnumber decisions

The product often presents navigation, view tabs, filter controls, table controls, row actions, expanded-workspace actions, and visualization controls at the same time. Most of those controls are valid, but the hierarchy does not make the next decision obvious.

### Analytical views behave like destinations

Graph, Money Path, Portfolio, Strategy, Analytics, and Map are navigated as destinations. Users must leave the operating context to use them, then reconstruct that context when they return.

## 3. Product model

### Primary surfaces

The primary navigation becomes:

1. **Today**: tasks, exceptions, and a compact forward timeline
2. **Timeline**: the first-class chronological operating surface
3. **Opportunities**: the review and qualification queue

Search remains globally available. Administrative and specialist tools remain grouped under one secondary menu.

### Analysis lenses

These are no longer peer destinations in the primary workflow:

- Evidence graph
- Money Path
- Portfolio and strategy matrices
- Analytics
- Map
- Source lineage

They open as lenses on the current scope or selected record. A lens never replaces the operating context.

### Operating loop

```text
SIGNAL -> ORIENT -> DECIDE -> ACT -> LEARN
  |         |         |        |       |
Timeline  Evidence   Pursuit   Task    Outcome
change    money      status    owner   refresh
deadline  context    no-bid    due     feedback
```

The product should preserve the selected record and scope as the user moves through this loop.

## 4. Shared interaction architecture

### Global shell

The shell owns only:

- Today / Timeline / Opportunities
- global search and command palette
- alerts and profile
- the secondary Tools menu

The shell does not own domain filters.

### Scope bar

Every primary surface gets one compact scope bar. It owns:

- workspace or saved view
- time range
- tracked-only or owner scope
- filters
- clear/reset

The scope bar is the only owner for collection-level filtering. It remains visible while scrolling.

### Context dock

Selecting a record opens one shared context dock rather than a route-specific drawer or expanded section. The dock owns:

- record title and source identity
- pursuit stage, owner, next milestone, and next action
- one primary action
- Summary / Timeline / Evidence / Money / Tasks tabs
- cited source links and missing-evidence states

Desktop uses a right dock. Mobile uses a bounded bottom sheet. Back, Forward, Escape, and deep links preserve or clear it predictably.

### Action hierarchy

Each state may expose:

1. one primary action
2. up to two secondary actions
3. remaining actions under More

Examples:

- New opportunity: Track
- Tracked without plan: Set next action
- Overdue task: Complete
- Waiting item: Resume
- Research gap: Run research

The same action must not appear in the row, dock, and visualization at the same time.

## 5. Timeline as a first-class surface

### Unified event model

Timeline v2 normalizes existing data into a derived `WorkEvent` contract:

```text
id
recordId
kind: task | deadline | milestone | research | change | award | event
startAt
endAt
status
priority
title
summary
sourceType
sourceId
sourceUrl
owner
action
confidence
```

The first release can derive this model client-side from existing persisted records. No database migration is required.

### Canonical timeline control surface

The primary Timeline is the dense horizontal range-bar control surface already proven in DBI, not a replacement agenda widget. It is the canonical place to understand duration, overlap, versions, amendments, recompetes, follow-ons, milestones, and gaps across tracked work.

Its default grammar is:

- a fixed identity column on the left
- a shared multi-year quarter axis on the right
- one collapsed row per contract, acquisition, or program family
- one or more labeled range segments on that row for versions, phases, amendments, or successor efforts
- exact milestone and change markers over the ranges
- a Today line, published-data boundary, and explicit uncertain windows
- an expandable child-row state for the exact underlying records and evidence

This surface remains directly reachable from primary navigation. Today carries a compact derivative of the same model, and the selected-record dock carries a record-scoped derivative. They do not become separate timeline implementations.

### Family and version model

The derived `TimelineFamily` contract groups related records without destroying source identity:

```text
familyId
canonicalTitle
familyType: contract | acquisition | program | vehicle | award
memberIds[]
segments[]:
  recordId
  label
  versionLabel
  startAt
  endAt
  status
  relationToPrevious: amends | succeeds | recompetes | renames | continues | potential
  relationConfidence: exact | supported | candidate
  sourceIds[]
unresolvedCandidates[]
```

Examples include a single family row for `Application Arsenal: C4I Storefront (v1) -> AA EELS (v2) -> follow-on (v3)` or a contract line containing modifications I through VI.

Grouping precedence is fail-closed:

1. exact typed predecessor, successor, amendment, modification, vehicle, or task-order relationships
2. official identifier lineage and cited renames
3. supported temporal continuity across the same buyer, capability, scope, and contract family
4. AI-proposed candidate relationships held for review

Only exact and supported links enter the collapsed family line automatically. Candidate links remain dashed, labeled, and reviewable. Every segment still opens its original record and evidence.

### Timeline modes

- **Families**: default multi-year range-bar view grouped by contract/program lineage
- **Agenda**: what requires attention in date order
- **Calendar**: scheduled events and deadlines

Families, Agenda, and Calendar are alternate views of the same normalized event and family contracts, not separate products.

### Timeline layers

Layers enrich the family rows without replacing them:

- Schedule and published windows
- Changes and modifications
- Follow-ons and successor candidates
- Funding and obligations
- Subawards and industrial-base activity
- Milestones, research dates, and team actions

The default view keeps only Schedule, Changes, and Follow-ons visible. Additional layers are progressive disclosures with their own legend and provenance.

### My Work timeline component

Today includes a compact **Next 14 days** strip immediately below the action queue.

It shows:

- overdue and due tasks
- next opportunity deadlines
- cited research dates
- scheduled team events
- recent material changes

Users can select an item without leaving Today. The context dock opens in place. **Open full Timeline** carries the current date range and selection into the full surface.

## 6. Surface definitions

### Today

Default content order:

1. Focus summary: Act now / Waiting / Needs plan
2. Priority actions: maximum five
3. Next 14 days timeline
4. Tracked pursuits summary

The full tracked table, completed work, and low-priority items remain behind disclosure.

### Timeline

Default content order:

1. compact scope bar
2. window controls, layer controls, and family/agenda/calendar switch
3. family-grouped horizontal range-bar canvas
4. context dock on selection

The full Timeline preserves the existing scan-dense control surface while removing duplicate configuration owners. Family grouping, labels, relationship review, feed selection, and field choices live in one Advanced panel. Selecting a family, segment, milestone, or relationship opens the same shared context dock.

### Opportunities

Default content order:

1. compact scope bar
2. queue
3. shared context dock on selection

The queue no longer expands a large workspace inside the table. Inline expansion is replaced by the shared dock so the queue remains stable while users inspect multiple records.

## 7. Control ownership

| State or action | Sole owner |
| --- | --- |
| Global navigation | Product shell |
| Collection filters and saved scope | Scope bar |
| Date range and timeline mode | Timeline toolbar |
| Record selection | Shared context controller |
| Pursuit stage, owner, next action | Context dock |
| Task lifecycle | Today or Tasks tab in context dock |
| Research job lifecycle | Context dock Research action/status |
| Evidence selection | Lens canvas plus context dock |
| Table density and columns | Queue view settings |
| Exports | Surface-level More menu |

## 8. URL and state contract

One shared route state should replace surface-specific record selection keys:

```text
surface=today|timeline|opportunities
record=<record-id>
range=14d|30d|90d|fy
mode=agenda|lanes|calendar
view=<saved-view-id>
lens=summary|timeline|evidence|money|tasks
```

Surface-specific filters remain namespaced but cannot silently survive a handoff that changes the scope owner.

## 9. Noise-removal rules

- Never show a metric unless it changes the next decision.
- Never show the same action in two visible owners.
- Never use a full navigation tab for a view that can be a lens.
- Keep explanatory prose to one sentence by default.
- Collapse methodology, provenance, and advanced configuration until requested.
- Prefer counts inside labels over separate cards.
- Prefer one date phrase with provenance over multiple timestamp rows.
- Empty states must offer the next useful action.

## 10. Release plan

### Release 1: Timeline foundation

- promote Timeline to primary navigation
- add the unified event adapter
- add the `TimelineFamily` adapter and exact/support/candidate relationship contract
- preserve the dense multi-year range-bar surface as the default Families mode
- render related versions, amendments, and follow-ons as labeled segments on one family row
- add expandable child rows for exact underlying records
- add Next 14 days to Today
- add shared selection handoff between Today and Timeline

### Release 2: Shared context dock

- replace opportunity inline expansion with the dock
- move pursuit controls and task management into dock tabs
- connect Timeline selection to the same dock

### Release 3: Lens consolidation

- move Graph, Money Path, Strategy, Analytics, and Map into scoped lenses
- remove duplicate route-level action owners
- unify saved scope and export behavior

### Release 4: Advanced timeline

- agenda and calendar modes
- saved timeline views
- batch planning and task creation from selected events
- movement history and outcome feedback
- assisted family-link review and merge/split controls

## 11. Acceptance criteria

- A user can identify and act on the top item within 10 seconds of opening the product.
- A user can move from a timeline signal to cited evidence and a task without losing selection.
- Related contract/program versions can appear on one collapsed family line while every source record remains independently inspectable.
- Candidate family relationships are never silently merged or presented as exact.
- Today, Timeline, and Opportunities share one record dock and one action hierarchy.
- Primary navigation contains no analytical implementation details.
- Default surfaces show no more than one filter owner and one primary action per selected state.
- Desktop and mobile screenshots show the same information hierarchy.
- Existing D1, Agent API, PostgreSQL, accessibility, payload, and responsive contracts remain green.
