# Defense Budget Intelligence Navigation Architecture

Date: 2026-10-18
Status: approved and implemented
Target: desktop-first product navigation

## Problem statement

The current header mixes primary user jobs, lifecycle stages, analytical lenses, data inventories, and administration at the same level. The `Budget & Spend` menu is the clearest failure: Data Library, Intelligence Graph, PDB Request, Request History, Account Flow, Awards, Opportunity Map, and Source Lineage do not answer the same user question. Their badges also mix counts, verbs, health, and categories, so scanning the menu does not establish priority or relationships.

The result is route recall instead of product orientation. Users must remember where a capability lives, why it differs from adjacent routes, and which surface owns the next step.

## Primary user jobs

1. **Act**: understand what needs attention and continue work.
2. **Pursue**: qualify opportunities and advance capture decisions.
3. **Orient in time**: understand milestones, change, and lineage.
4. **Follow money**: move from budget request through accounts and awards.
5. **Investigate intelligence**: find entities, traverse relationships, inspect geography, and verify provenance.

Administration is not a primary product job. It belongs in a separate management utility.

## Proposed top-level architecture

| Workspace | User question | Owned views |
| --- | --- | --- |
| Today | What needs attention now? | Brief, Tasks, Schedule |
| Opportunities | What should we pursue? | Workbench, Radar, Portfolio |
| Timeline | What changed, when, and what follows? | Timeline with owned scope/layer/display controls |
| Funding | Where does money originate and execute? | Request, Changes, Accounts, Awards |
| Intelligence | What is this entity and how is it connected? | Library, Graph, Geography, Sources |

The canonical Intelligence Workspace remains contextual. It opens from Find or a selected entity and is not a competing top-level destination.

## Management utility

Move these routes out of primary navigation and into one role-aware **Manage** utility near the profile menu:

- Event Discovery
- Integrations & API
- Domain Model
- Intelligence Operations
- Workspace Settings
- Accounts
- Workspaces

The utility groups destinations as **Operations**, **Workspace**, and **Access**. It appears only when the server-returned capabilities allow at least one destination.

## Route consolidation map

| Current route | New owner | New label / treatment |
| --- | --- | --- |
| Today | Today | Brief |
| Task Center | Today | Tasks |
| Schedule | Today | Schedule |
| Opportunities | Opportunities | Workbench |
| Timeline | Timeline | Primary workspace |
| PDB Request | Funding | Request |
| Request History | Funding | Changes |
| Account Flow | Funding | Accounts |
| Awards | Funding | Awards |
| Data Library | Intelligence | Library |
| Intelligence Graph | Intelligence | Graph |
| Opportunity Map | Intelligence | Geography |
| Source Lineage | Intelligence | Sources |
| Intelligence Workspace | Contextual | Opened for a selected entity |
| Event Discovery | Manage | Operations / Discovery |
| Integrations & API | Manage | Operations / Integrations |
| Domain Model | Manage | Workspace / Data model |
| Intelligence Operations | Manage | Workspace / Intelligence operations |
| Workspace Settings | Manage | Workspace / Settings |
| Accounts | Manage | Access / Accounts |
| Workspaces | Manage | Access / Workspaces |

## Interaction rules

1. The header contains five plain primary workspace links. There are no route catalogs in header dropdowns.
2. A workspace-owned secondary bar appears directly beneath the header only when that workspace has sibling views.
3. The active workspace and active view are always visible at the same time.
4. Badges are removed from navigation unless they represent a real exception requiring attention. Counts and freshness belong inside the destination.
5. Cross-workspace movement is contextual. Records expose explicit `Continue to Funding`, `Open in Geography`, or `View sources` actions with preserved entity state.
6. Global Find remains the fastest entity-first path and opens the canonical Intelligence Workspace.
7. Browser Back/Forward restores workspace, view, entity, and filters.
8. Manage is capability-driven and visually separated from primary work.

## Desktop layout

- Product identity at left.
- Five primary workspace links in the center.
- Find, notifications, Manage, and profile utilities at right.
- One 40 px secondary workspace bar below the product header.
- No descriptive menu cards, mixed badges, or vertical route list.
- Page content begins immediately after the secondary bar.

## Success criteria

- A user can name the five product workspaces after viewing the header once.
- Every retained route has exactly one workspace owner.
- The active route requires no dropdown inspection to understand its parent.
- No navigation badge mixes counts, categories, health, and verbs.
- Funding sequence reads left-to-right: Request → Changes → Accounts → Awards.
- Intelligence sequence reads left-to-right: Library → Graph → Geography → Sources.
- Today sequence reads left-to-right: Brief → Tasks → Schedule.
- Management routes are absent from the primary product navigation.
- Existing deep links and permissions remain valid through centralized route mapping.

## Implemented architecture

1. One navigation architecture model owns workspace, view, capability, and route metadata.
2. `SiteHeader` renders the same model on desktop and mobile.
3. Workspace secondary navigation and the role-aware Manage utility expose ownership without route recall.
4. Existing hashes, deep links, selected opportunity state, and filters remain valid.
5. Opportunities no longer repeats Workbench, Radar, and Brief inside the page. Portfolio owns the Visuals, Timeline, and Analytics lenses behind progressive disclosure.
6. Browser contracts enforce active workspace/view state, management separation, keyboard traversal, Back/Forward behavior, and deep-link restoration.
7. Obsolete rich-menu metadata, badges, descriptive cards, and their generated CSS have been removed.
