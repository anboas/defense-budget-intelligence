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

Task fields now persist per workspace with optimistic versioning, RBAC, audit activity, reset-to-foundation behavior, and a browser-local static-host fallback. Agent API `1.2.0` adds scoped Tasking CRUD for tasks, workstreams, anchors, context records, and relationships, plus idempotent normalized OneDrive source-item synchronization.

The application does not hold Microsoft Graph credentials or call OneDrive directly. Codex owns that connector boundary and sends only normalized metadata and credential-free links through the Agent API. Signed-in Tasking reads that workspace projection directly, so agent-created workstreams, anchors, tasks, relationships, and normalized OneDrive folders/files appear in the same operating surface. The static-host fallback remains synthetic and browser-local.

## Next gated slice

Run the first bounded Codex-to-OneDrive ingestion against a production workspace. OneDrive ingestion remains isolated from human-confirmed task fields, and source observations must preserve provider identity, versions, deletions, and explicit parse state.

## Verification

Run against a served production build:

```bash
npm run verify:tasking
```

Set `TASKING_VERIFY_URL` for a different served base URL and `CHROMIUM_PATH` when system Chromium is not in a standard location.
