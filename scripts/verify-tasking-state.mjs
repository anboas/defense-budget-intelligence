import assert from "node:assert/strict";
import { TASKING_FOUNDATION } from "../src/tasking-foundation-data.js";
import { D1_AGENT_TASKING_SCHEMA, normalizeSourceItem, normalizeTaskingTask } from "../src/d1-agent-tasking.js";
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

assert.ok(D1_AGENT_TASKING_SCHEMA.some((statement) => statement.includes("dbi_workspace_tasking_objects")), "Tasking schema must persist typed workspace objects");
assert.ok(D1_AGENT_TASKING_SCHEMA.some((statement) => statement.includes("idx_dbi_tasking_objects_workspace_type")), "Tasking schema must index workspace/type reads");

console.log("Tasking real-data state verification passed", { statuses: TASKING_TASK_STATUSES.length, syntheticRecords: 0, sourceProvider: localSource.payload.provider });
