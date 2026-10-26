import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { normalizeTaskingTask } from "../src/d1-agent-tasking.js";

const representative = [{
  id: "task-draft-verification",
  title: "Review an unconfirmed source action",
  description: "Local source: retained source reference\nTiming (unconfirmed): Not stated.\nCurrent completion is unconfirmed. Draft creation does not approve execution.",
  status: "draft",
  owner: "",
  acceptance: "Confirm approval conditions and retain supporting evidence before completion.",
  anchorId: "anchor-verification",
  evidenceCount: 1,
  dependencyCount: 0,
}];

const fixturePath = process.argv[2];
const tasks = fixturePath ? JSON.parse(await readFile(fixturePath, "utf8")) : representative;
assert.ok(Array.isArray(tasks) && tasks.length > 0, "Draft task fixture must contain at least one task");
const normalizedText = (value) => String(value).replace(/\s+/g, " ").trim();

for (const task of tasks) {
  assert.equal(task.status, "draft", `${task.id} must remain draft`);
  assert.equal(task.owner, "", `${task.id} must keep its owner blank`);
  const normalized = normalizeTaskingTask(task);
  assert.equal(normalized.error, undefined, `${task.id} must pass Tasking validation`);
  assert.equal(normalized.payload.status, "draft");
  assert.equal(normalized.payload.owner, "", `${task.id} must not receive an invented owner`);
  assert.equal(normalized.payload.description, normalizedText(task.description), `${task.id} must preserve its source reference and timing caveat`);
  assert.equal(normalized.payload.acceptance, normalizedText(task.acceptance), `${task.id} must preserve its approval conditions`);
  assert.match(normalized.payload.description, /Timing \(unconfirmed\):/);
  assert.match(normalized.payload.description, /Draft creation does not approve execution\./);
  assert.equal(Object.hasOwn(normalized.payload, "dueAt"), false, `${task.id} must not receive an invented date`);
}

const nonDraft = normalizeTaskingTask({ ...representative[0], status: "ready" });
assert.equal(nonDraft.error, "Task owner is required unless status is draft");

console.log("Tasking draft payload verification passed", { taskCount: tasks.length, fixture: fixturePath || "representative" });
