# UI System Critique and Consistency Contract

## Executive verdict

The application had strong individual surfaces but no enforceable cross-product hierarchy contract. Geometry checks prevented clipping, yet several routes still delivered information as exhaustive walls instead of progressive analytical tools.

The worst baseline failures were measurable:

- Domain Model reached 16.5 mobile viewports and 8.9 desktop viewports.
- Organization Intelligence reached 7.6 desktop viewports while showing an empty dossier canvas.
- Six routes repeated the active route name in both the masthead and page heading.
- Radar rendered a second large opportunity queue instead of a focused shortlist.
- Data Library changed a left-to-right relationship model into four stacked mobile sections.
- The consistency audit did not measure page length, above-fold control density, or duplicate hierarchy.

## Product-wide interaction rules

1. **The masthead owns product identity.** The page owns its route title and explanation. Primary navigation communicates location.
2. **Today, Timeline, and Opportunities remain the primary operating surfaces.** Secondary routes must clarify, inspect, or administer those surfaces, not recreate them.
3. **One surface, one control owner.** Exclusive modes use segmented controls, filters use one disclosure, status uses badges, and commands use buttons.
4. **Overview before inventory.** Exhaustive records remain available through search, pagination, or bounded internal scrolling.
5. **Preserve analytical direction.** Relationship and money flows remain left-to-right on narrow screens through owned horizontal canvases rather than stacked reinterpretations.
6. **The page must deliver value before configuration.** A useful record, dossier, chart, or action appears by default.
7. **No data is removed to achieve simplicity.** Progressive disclosure changes the initial presentation, not the retained schema or evidence.

## Implemented in this pass

- Masthead now presents stable product identity on desktop while retaining compact route context on mobile and for assistive technology.
- Domain Model keeps every entity and relationship but moves both exhaustive inventories into bounded internal regions.
- Organization Intelligence opens the first relevant dossier by default and bounds the organization index.
- Data Library keeps customer → people → work → company relationships on one horizontal analytical path at compact widths.
- Organization selectors show a useful initial window of 30 dossiers; search still addresses the complete reviewed inventory.
- Operational tables now start with the top ten results on desktop and five cards on mobile unless a workflow explicitly needs a larger review batch; complete inventories remain pageable, searchable, and exportable.
- The permanent route audit now records viewport length, above-fold control count, duplicate headings, control clusters, overflow, and adjacent-control mismatches.

## Remaining ranked backlog

### P1: operating surfaces

- Consolidate Analytics defaults to two high-value charts per analytical mode; keep the full chart inventory in the existing manager.
- Move award filters behind the same single-owner filter pattern used by Opportunities.

### P2: analytical lenses

- Make Map labels selection-led by default while retaining the current callout layer as an explicit toggle.
- Collapse Strategic Analysis configuration after a valid baseline exists.
- Add a common selected-record dock to Map, Analytics, Awards, and customer hierarchy exploration.

### P3: administration

- Apply the bounded-inventory pattern to long source and activity registers.
- Normalize remaining empty states to concise, action-oriented panels.

## Release contract

Every UI release must pass:

- desktop and 390 px mobile route crawl;
- zero page overflow and zero adjacent-control mismatches;
- no duplicate visible route headings;
- bounded page length: at most five viewports on desktop or mobile;
- fixed CSS and route-payload ceilings;
- full backend parity and exact production-artifact screenshots.
