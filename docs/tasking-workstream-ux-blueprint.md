# Tasking workstream UX blueprint

## Objective

Make workstreams the primary operating unit. Files, tasks, communications, and reviewed interactions become workstream context, not peer destinations that force the operator to reconstruct meaning.

## Current ownership defects

| User job | Current owner | Defect |
| --- | --- | --- |
| See what is moving | Portfolio | Workstreams are visually subordinate to the source tree and anchor cards. |
| Browse supporting material | Permanent left source tree plus Files tab | Two owners, component-local expansion, route remounts, and an unbounded inventory. |
| Inspect a file | Global context panel | Selection is easy to lose and workstream placement is not visually prominent. |
| Manage tasks | Anchor rows plus selected-record editor | Existing tasks can be edited, but there is no dedicated task surface or obvious creation entry point. |
| Understand relationships | Connections tab | Empty or sparse graphs are detached from the selected workstream and do not explain missing links. |
| Prepare for email/IM sync | None | No stable communications owner or empty state exists. |

## Primary jobs and owners

1. **Choose work**: the persistent Workstream rail owns selection, grouping, counts, and sorting.
2. **Move work**: the selected workstream Overview and Tasks tabs own status, next move, open/done work, and task creation/import.
3. **Review evidence**: the Sources tab owns a bounded tree/list explorer and selected-file inspector. It never renders all 317 rows expanded.
4. **Review correspondence**: the Communications tab owns future email, IM, and meeting sync with explicit empty/setup states.
5. **Understand interactions**: the Interactions tab owns reviewed links inside the selected workstream. Cross-workstream exploration remains a secondary index, not a primary top-level destination.

## Desktop flow

`Workstream rail → selected workstream header → Overview / Tasks / Sources / Communications / Interactions → contextual inspector`

The workstream rail remains stable. Route updates use `history.replaceState` plus local state so selection does not remount the route or reset source expansion and scroll.

## Source browser behavior

- Roots begin collapsed except the selected file's ancestor chain.
- Expansion state is keyed by stable source IDs and retained for the session.
- Folder toggle never changes selection or route.
- File selection updates the inspector without changing the scroll container.
- Search returns a flat result list with breadcrumb paths; clearing search restores the prior tree expansion.
- Filters: file type, workstream link, review state, task relation.
- Sort: folder-first/name for tree; modified, size, name for flat results.
- File icons use semantic type colors and accessible labels, not color alone.
- Workstream placement uses short-name pills with type and state metadata.

## Tasks

- Dedicated Tasks tab under a workstream plus cross-workstream Tasks index.
- Visible `Create task` entry point for authorized users.
- Draft creation preserves blank owner and blank dates.
- Task rows show state, owner, acceptance state, source/communication counts, and completion.
- Open and completed work are separated without hiding either.

## Communications scaffold

- Empty-state owner exists now for Email, IM, and Meetings.
- Future communication records normalize into context records with source system, sender/participants, occurred-at timestamp, summary, workstream/anchor placement, and reviewed relationships.
- No Microsoft authentication is introduced by this UI work.

## Prototype acceptance criteria

- Workstreams are the first and largest operating surface.
- The source tree does not jump, auto-expand everything, or steal the whole page.
- Clicking a file updates a useful inspector with type, size, modified time, review state, source path, and workstream placement.
- Tasks and communications have obvious homes.
- Interactions explain empty state and stay scoped to the selected workstream.
- Desktop is dense but legible; mobile stacks rail, view switcher, content, then inspector with contained scrolling.
