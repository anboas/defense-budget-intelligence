# Tasking foundation

This first production-code slice implements the read-first Tasking workspace at `#/tasking` while preserving the supplied Sabre Tasking Dashboard model and the later DBI integration decisions.

## Model mapping

- `Workstream` owns the swim lane.
- `Task` is the atomic commitment and appears once in its primary lane.
- A real `Pursuit`, `Account`, `File`, or `Goal` record anchors each operating cluster.
- Typed relationships add decision, evidence, dependency, partner, goal, and file context without creating a generic `Cluster` record.
- The folder hierarchy remains source structure. Contextual links never rename or move source files.
- One route state owns `taskingView`, `taskingRecord`, search, Workstream, and status filters across Portfolio, Files, and Connections.

## Current boundary

The committed data is synthetic and explicitly labeled. It proves:

1. mirrored folder navigation;
2. Workstream and anchor projection;
3. stable selected-record context across views;
4. confirmed versus suggested relationship display;
5. accessible list fallback for the visual relationship map;
6. desktop and mobile containment on the exact production build.

It does not claim a live OneDrive connection, persistent task mutation, source synchronization, or current business status.

## Next gated slice

Add the authenticated, workspace-scoped read model and scoped file observation importer. The UI should replace the synthetic adapter without changing its route state or projection rules. Persistence and mutation remain separate gates so ingestion cannot overwrite human-confirmed task fields.

## Verification

Run against a served production build:

```bash
npm run verify:tasking
```

Set `TASKING_VERIFY_URL` for a different served base URL and `CHROMIUM_PATH` when system Chromium is not in a standard location.
