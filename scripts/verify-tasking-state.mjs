import assert from "node:assert/strict";
import { D1_TASKING_SCHEMA, taskingResponse } from "../src/d1-tasking.js";
import { TASKING_TASK_STATUSES, mergeTaskingTasks, taskingTaskMutation, taskingTaskFromRow } from "../src/tasking-model.js";

assert.deepEqual(TASKING_TASK_STATUSES, ["draft", "ready", "in-progress", "waiting", "review", "blocked", "completed"]);

const mutation = taskingTaskMutation("task-solution-owner", {
  version: 0,
  status: "completed",
  owner: "Verification owner",
  acceptance: "Verified persistence contract",
});
assert.equal(mutation.error, undefined);
assert.equal(mutation.task.status, "completed");
assert.equal(mutation.task.owner, "Verification owner");

const draftMutation = taskingTaskMutation("task-solution-owner", {
  version: 0,
  status: "draft",
  owner: "",
  acceptance: "Approval remains required before execution",
});
assert.equal(draftMutation.error, undefined);
assert.equal(draftMutation.task.status, "draft");
assert.equal(draftMutation.task.owner, "");
assert.equal(taskingTaskMutation("task-solution-owner", { version: 0, status: "ready", owner: "" }).error, "Task owner is required unless status is draft");

assert.equal(taskingTaskMutation("task-solution-owner", { version: 0, status: "invented" }).error, "A valid task status is required");
assert.equal(taskingTaskMutation("missing-task", { version: 0, status: "ready" }).error, "Task not found");

const stored = taskingTaskFromRow({ task_id: "task-solution-owner", ...mutation.task, version: 3, updated_at: "2026-10-25T12:00:00.000Z" });
const merged = mergeTaskingTasks([stored]);
const updated = merged.find((task) => task.id === "task-solution-owner");
assert.equal(updated.persisted, true);
assert.equal(updated.version, 3);
assert.equal(updated.anchorId, "anchor-pursuit");
assert.equal(updated.status, "completed");
assert.equal(mergeTaskingTasks([]).find((task) => task.id === "task-solution-owner").version, 0);

assert.ok(D1_TASKING_SCHEMA.some((statement) => statement.includes("dbi_workspace_tasking_tasks")), "D1 schema must include workspace task persistence");
assert.ok(D1_TASKING_SCHEMA.some((statement) => statement.includes("workspace_id, status")), "D1 schema must index workspace task status reads");

class TaskingStatement {
  constructor(db, sql) { this.db = db; this.sql = sql.replace(/\s+/g, " ").trim(); this.args = []; }
  bind(...args) { this.args = args; return this; }
  async all() {
    if (this.sql.startsWith("SELECT * FROM dbi_workspace_tasking_tasks WHERE workspace_id = ? ORDER")) return { results: [...this.db.rows.values()].filter((row) => row.workspace_id === this.args[0]) };
    throw new Error(`Unhandled all: ${this.sql}`);
  }
  async first() {
    if (this.sql.startsWith("SELECT * FROM dbi_workspace_tasking_tasks WHERE workspace_id = ? AND task_id = ?")) return this.db.rows.get(`${this.args[0]}:${this.args[1]}`) || null;
    throw new Error(`Unhandled first: ${this.sql}`);
  }
  async run() {
    if (this.sql.startsWith("INSERT OR IGNORE INTO dbi_workspace_tasking_tasks")) {
      const [workspace_id, task_id, title, description, status, owner, acceptance, version, updated_by, created_at, updated_at] = this.args;
      const key = `${workspace_id}:${task_id}`;
      if (this.db.rows.has(key)) return { meta: { changes: 0 } };
      this.db.rows.set(key, { workspace_id, task_id, title, description, status, owner, acceptance, version, updated_by, created_at, updated_at });
      return { meta: { changes: 1 } };
    }
    if (this.sql.startsWith("UPDATE dbi_workspace_tasking_tasks SET")) {
      const [title, description, status, owner, acceptance, version, updated_by, updated_at, workspace_id, task_id, expected] = this.args;
      const key = `${workspace_id}:${task_id}`; const row = this.db.rows.get(key);
      if (!row || row.version !== expected) return { meta: { changes: 0 } };
      this.db.rows.set(key, { ...row, title, description, status, owner, acceptance, version, updated_by, updated_at });
      return { meta: { changes: 1 } };
    }
    if (this.sql.startsWith("DELETE FROM dbi_workspace_tasking_tasks")) {
      const [workspaceId, taskId, version] = this.args; const key = `${workspaceId}:${taskId}`; const row = this.db.rows.get(key);
      if (!row || row.version !== version) return { meta: { changes: 0 } };
      this.db.rows.delete(key); return { meta: { changes: 1 } };
    }
    throw new Error(`Unhandled run: ${this.sql}`);
  }
}
class TaskingDb { constructor() { this.rows = new Map(); } prepare(sql) { return new TaskingStatement(this, sql); } }

const db = new TaskingDb();
const activity = [];
const deps = {
  json: (body, status = 200, headers = {}) => Response.json(body, { status, headers }),
  recordActivity: async (...args) => activity.push(args),
  safeJson: (request) => request.json(),
  sessionUser: async () => ({ user_id: "user-1", active_workspace_id: "workspace-a", role: "analyst", membership_role: "analyst" }),
};
const apiRequest = (path = "", options = {}) => new Request(`https://example.test/api/v1/auth/tasking${path}`, { headers: { origin: "https://example.test" }, ...options });
const createdResponse = await taskingResponse(apiRequest("/task-solution-owner", { method: "PATCH", headers: { origin: "https://example.test", "content-type": "application/json" }, body: JSON.stringify({ version: 0, status: "completed", owner: "API owner", acceptance: "API accepted" }) }), db, deps);
assert.equal(createdResponse.status, 200);
assert.equal((await createdResponse.json()).task.version, 1);
const listResponse = await taskingResponse(apiRequest(), db, deps);
assert.equal((await listResponse.json()).tasks[0].owner, "API owner");
const conflictResponse = await taskingResponse(apiRequest("/task-solution-owner", { method: "PATCH", headers: { origin: "https://example.test", "content-type": "application/json" }, body: JSON.stringify({ version: 0, status: "ready" }) }), db, deps);
assert.equal(conflictResponse.status, 409);
const deletedResponse = await taskingResponse(apiRequest("/task-solution-owner?version=1", { method: "DELETE" }), db, deps);
assert.equal(deletedResponse.status, 204);
assert.equal(db.rows.size, 0);
assert.equal(activity.length, 2);

const draftResponse = await taskingResponse(apiRequest("/task-solution-owner", { method: "PATCH", headers: { origin: "https://example.test", "content-type": "application/json" }, body: JSON.stringify({ version: 0, status: "draft", owner: "", acceptance: "Approval remains required before execution" }) }), db, deps);
assert.equal(draftResponse.status, 200);
assert.equal((await draftResponse.json()).task.owner, "", "Draft persistence must not invent an owner");
const draftListResponse = await taskingResponse(apiRequest(), db, deps);
const draftList = await draftListResponse.json();
assert.equal(draftList.tasks[0].status, "draft");
assert.equal(draftList.tasks[0].owner, "", "Draft reads must preserve an explicitly blank owner");

console.log("Tasking state verification passed", { taskCount: merged.length, statuses: TASKING_TASK_STATUSES.length, version: updated.version, apiActivity: activity.length });
