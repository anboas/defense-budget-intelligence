import assert from "node:assert/strict";
import { TASKING_FOUNDATION } from "../src/tasking-foundation-data.js";
import { TASKING_FALLBACK_WORKSPACE, taskingFallbackEligible } from "../src/tasking-fallback-data.js";
import { D1_AGENT_TASKING_SCHEMA, normalizeSourceItem, normalizeTaskingTask } from "../src/d1-agent-tasking.js";
import { buildTaskingFileAnalytics, formatTaskingBytes, sortTaskingFiles, taskingFileType } from "../src/tasking-file-analytics.js";
import { TASKING_TASK_STATUSES, taskingTaskOwnerRequired } from "../src/tasking-model.js";
import { buildTaskingSourceTree, communicationsForWorkstream, sourceAncestors, sourceIdsForWorkstream, taskingRouteState, workstreamShortName } from "../src/tasking-workspace-support.js";

assert.deepEqual(TASKING_TASK_STATUSES, ["draft", "ready", "in-progress", "waiting", "review", "blocked", "completed"]);
assert.equal(taskingTaskOwnerRequired("draft"), false);
assert.equal(taskingTaskOwnerRequired("ready"), true);

for (const collection of ["folders", "workstreams", "anchors", "tasks", "contextRecords", "relationships", "sourceItems"]) {
  assert.deepEqual(TASKING_FOUNDATION[collection], [], `${collection} must not ship synthetic workspace records`);
}
assert.equal(TASKING_FOUNDATION.metadata.mode, "empty");
assert.equal(TASKING_FOUNDATION.metadata.counts.sourceItems, 0);
assert.equal(TASKING_FALLBACK_WORKSPACE.metadata.mode, "template-fallback");
assert.equal(TASKING_FALLBACK_WORKSPACE.workstreams.length, 2);
assert.equal(TASKING_FALLBACK_WORKSPACE.tasks.length, 6);
assert.equal(TASKING_FALLBACK_WORKSPACE.sourceItems.filter((item) => item.itemType === "file").length, 6);
assert.equal(TASKING_FALLBACK_WORKSPACE.contextRecords.length, 4);
assert.equal(TASKING_FALLBACK_WORKSPACE.relationships.length, 7);
assert.ok(TASKING_FALLBACK_WORKSPACE.tasks.every((task) => task.id.startsWith("template-")));
assert.ok(TASKING_FALLBACK_WORKSPACE.sourceItems.every((item) => item.path.startsWith("Template workspace/")));
assert.equal(taskingFallbackEligible({ status: 500 }), true);
assert.equal(taskingFallbackEligible({ status: 429 }), true);
assert.equal(taskingFallbackEligible(new TypeError("network")), true);
assert.equal(taskingFallbackEligible({ status: 401 }), false);
assert.equal(taskingFallbackEligible({ status: 403 }), false);

const draft = normalizeTaskingTask({
  title: "Review source-backed action",
  description: "Source reference retained. Timing remains unconfirmed.",
  status: "draft",
  owner: "",
  acceptance: "Confirm approval before execution.",
  anchorId: "anchor-reviewed-source",
  evidenceCount: 1,
});
assert.equal(draft.error, undefined);
assert.equal(draft.payload.owner, "");
assert.equal(normalizeTaskingTask({ ...draft.payload, status: "ready" }).error, "Task owner is required unless status is draft");
assert.equal(normalizeTaskingTask({ ...draft.payload, status: "invented" }).error, "A valid task status is required");

const localSource = normalizeSourceItem({
  provider: "localfs",
  sourceId: "localfs:volume:item",
  name: "Reviewed source.docx",
  path: "Documents/Reviewed source.docx",
  itemType: "file",
  parseStatus: "reviewed",
  recordId: "anchor-reviewed-source",
});
assert.equal(localSource.error, undefined);
assert.equal(localSource.payload.provider, "localfs");
assert.equal(normalizeSourceItem({ ...localSource.payload, provider: "dropbox" }).error, "Source provider must be localfs or onedrive");

const fileAnalytics = buildTaskingFileAnalytics([
  { id: "source-doc", sourceId: "localfs:doc", itemType: "file", name: "Brief.docx", path: "Documents/Brief.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", size: 5_500_000, lastModifiedAt: "2026-10-23T12:00:00Z", parseStatus: "reviewed", recordId: "anchor-reviewed-source" },
  { id: "source-notes", sourceId: "localfs:notes", itemType: "file", name: "Notes.md", path: "Documents/Notes.md", mimeType: "text/markdown", size: 9_000, lastModifiedAt: "2026-10-01T12:00:00Z", parseStatus: "reviewed" },
  { id: "source-pdf", sourceId: "localfs:pdf", itemType: "file", name: "Archive.pdf", path: "Archive.pdf", mimeType: "application/pdf", size: 500_000, lastModifiedAt: "2026-05-01T12:00:00Z", parseStatus: "metadata-only" },
  { id: "source-folder", sourceId: "localfs:folder", itemType: "folder", name: "Documents", path: "Documents", size: 99_000_000 },
], [
  { id: "task-linked", title: "Review brief", anchorId: "anchor-reviewed-source" },
], [], { now: new Date("2026-10-26T12:00:00Z") });
assert.equal(fileAnalytics.totalFiles, 3, "Folder metadata must not inflate file analytics");
assert.equal(fileAnalytics.totalBytes, 6_009_000);
assert.equal(fileAnalytics.reviewedFiles, 2);
assert.equal(fileAnalytics.workspaceLinkedFiles, 1);
assert.equal(fileAnalytics.taskLinkedFiles, 1);
assert.deepEqual(fileAnalytics.types.map(({ id, count }) => ({ id, count })), [{ id: "document", count: 1 }, { id: "pdf", count: 1 }, { id: "markdown", count: 1 }]);
assert.deepEqual(fileAnalytics.recency.map(({ id, count }) => ({ id, count })), [{ id: "week", count: 1 }, { id: "month", count: 1 }, { id: "quarter", count: 0 }, { id: "older", count: 1 }, { id: "unknown", count: 0 }]);
assert.equal(fileAnalytics.files.find((file) => file.id === "source-doc").taskTitles[0], "Review brief");
assert.equal(taskingFileType({ name: "Sheet.XLSX" }).id, "spreadsheet");
assert.equal(formatTaskingBytes(5_500_000), "5.5 MB");
assert.deepEqual(sortTaskingFiles(fileAnalytics.files, "size-desc").map((file) => file.id), ["source-doc", "source-pdf", "source-notes"]);

const hierarchy = buildTaskingSourceTree([
  { id: "root", sourceId: "localfs:root", itemType: "folder", name: "Documents", path: "Documents" },
  { id: "folder", sourceId: "localfs:folder", parentSourceId: "localfs:root", itemType: "folder", name: "Pursuits", path: "Documents/Pursuits" },
  { id: "file", sourceId: "localfs:file", parentSourceId: "localfs:folder", itemType: "file", name: "Brief.docx", path: "Documents/Pursuits/Brief.docx", recordId: "anchor-1" },
]);
assert.deepEqual(hierarchy.map((item) => item.id), ["root"], "Source browser must begin with stable roots instead of a flat expanded list");
assert.deepEqual([...sourceAncestors(hierarchy, "file")], ["root", "folder"], "Selecting a file must retain its expanded ancestor chain");
assert.deepEqual([...sourceIdsForWorkstream([{ id: "root", sourceId: "localfs:root", itemType: "folder" }, { id: "file", sourceId: "localfs:file", parentSourceId: "localfs:root", itemType: "file", recordId: "anchor-1" }], [{ id: "anchor-1", workstreamId: "ws-1" }], "ws-1")], ["file", "root"], "Workstream source scope must retain required parent folders");
assert.equal(workstreamShortName({ name: "Local Sabre File Review" }), "LSFR");
assert.equal(taskingRouteState("#/tasking?taskingView=connections").section, "interactions", "Legacy Connections links must resolve into scoped interactions");
assert.equal(taskingRouteState("#/tasking?taskingView=files").view, "sources", "Legacy Files links must resolve into Sources");
assert.equal(communicationsForWorkstream([{ id: "mail-1", kind: "email", workstreamId: "ws-1" }, { id: "note-1", kind: "note", workstreamId: "ws-1" }], "ws-1").length, 1, "Communications must have one explicit typed owner");

assert.ok(D1_AGENT_TASKING_SCHEMA.some((statement) => statement.includes("dbi_workspace_tasking_objects")), "Tasking schema must persist typed workspace objects");
assert.ok(D1_AGENT_TASKING_SCHEMA.some((statement) => statement.includes("idx_dbi_tasking_objects_workspace_type")), "Tasking schema must index workspace/type reads");

console.log("Tasking real-data state verification passed", { statuses: TASKING_TASK_STATUSES.length, syntheticRecords: 0, sourceProvider: localSource.payload.provider, fileAnalytics: fileAnalytics.totalFiles });
