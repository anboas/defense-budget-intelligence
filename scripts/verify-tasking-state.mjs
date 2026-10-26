import assert from "node:assert/strict";
import { TASKING_FOUNDATION } from "../src/tasking-foundation-data.js";
import { D1_AGENT_TASKING_SCHEMA, normalizeSourceItem, normalizeTaskingTask } from "../src/d1-agent-tasking.js";
import { buildTaskingFileAnalytics, formatTaskingBytes, sortTaskingFiles, taskingFileType } from "../src/tasking-file-analytics.js";
import { TASKING_TASK_STATUSES, taskingTaskOwnerRequired } from "../src/tasking-model.js";

assert.deepEqual(TASKING_TASK_STATUSES, ["draft", "ready", "in-progress", "waiting", "review", "blocked", "completed"]);
assert.equal(taskingTaskOwnerRequired("draft"), false);
assert.equal(taskingTaskOwnerRequired("ready"), true);

for (const collection of ["folders", "workstreams", "anchors", "tasks", "contextRecords", "relationships", "sourceItems"]) {
  assert.deepEqual(TASKING_FOUNDATION[collection], [], `${collection} must not ship synthetic workspace records`);
}
assert.equal(TASKING_FOUNDATION.metadata.mode, "empty");
assert.equal(TASKING_FOUNDATION.metadata.counts.sourceItems, 0);

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

assert.ok(D1_AGENT_TASKING_SCHEMA.some((statement) => statement.includes("dbi_workspace_tasking_objects")), "Tasking schema must persist typed workspace objects");
assert.ok(D1_AGENT_TASKING_SCHEMA.some((statement) => statement.includes("idx_dbi_tasking_objects_workspace_type")), "Tasking schema must index workspace/type reads");

console.log("Tasking real-data state verification passed", { statuses: TASKING_TASK_STATUSES.length, syntheticRecords: 0, sourceProvider: localSource.payload.provider, fileAnalytics: fileAnalytics.totalFiles });
