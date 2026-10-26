# Tasking workspace

Tasking at `#/tasking` is a persisted workspace over normalized source metadata. It does not seed or merge demonstration records into a signed-in workspace.

## Model mapping

- `Workstream` owns the swim lane.
- `Task` is the atomic commitment and appears once in its primary lane.
- A real `Pursuit`, `Account`, `File`, or `Goal` record anchors each operating cluster.
- Typed relationships add decision, evidence, dependency, partner, goal, and file context without creating a generic `Cluster` record.
- The folder hierarchy remains source structure. Contextual links never rename or move source files.
- One route state owns `taskingView`, `taskingRecord`, search, Workstream, and status filters across Portfolio, Files, and Connections.

## Current boundary

Agent API `1.3.0` returns only persisted workspace records. A new workspace starts empty, while signed-in Tasking projects agent-created workstreams, anchors, context records, tasks, relationships, and normalized source items into the same operating surface. Native draft tasks may keep owners and unconfirmed dates blank; promoting a task out of draft requires an owner.

Task writes use optimistic versions, RBAC, idempotency, and append-only audit activity. The retired `/api/v1/auth/tasking` mutation routes return HTTP 410 so older clients cannot recreate synthetic foundation state. The static-host fallback is an empty browser-local workspace.

Source access stays with the calling agent. The API accepts normalized metadata from `localfs` or `onedrive`, stores no Microsoft credentials, never moves or renames source files, and keeps human task fields separate from source observations. Deleted source items are represented as versioned tombstones for reconciliation.

## File intelligence

The Files view derives analytics from active normalized source metadata without opening or mutating source files. It reports observed file types, reported sizes, last-modified freshness bands, review coverage, workspace placement, and actual task relationships as separate measures. A file is task-related only when its reviewed workspace anchor owns a task or an explicit relationship connects the source to a task; a workspace link alone is labeled separately.

File type, task relation, search, and sort controls are URL-backed. The folder tree remains the source hierarchy, while the inventory focuses on files and exposes the selected file's type, size, last-modified date, and task-relation count in the context panel. Unknown dates remain unavailable, and zero or absent source sizes are never inferred from file type.

## Verification

Run against a served production build:

```bash
npm run verify:tasking
```

Set `TASKING_VERIFY_URL` for a different served base URL and `CHROMIUM_PATH` when system Chromium is not in a standard location.
