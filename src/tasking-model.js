import { cleanText } from "./security-policy.js";
import { TASKING_FOUNDATION } from "./tasking-foundation-data.js";

export const TASKING_TASK_STATUSES = Object.freeze(["draft", "ready", "in-progress", "waiting", "review", "blocked", "completed"]);
const STATUS_SET = new Set(TASKING_TASK_STATUSES);

export function taskingTaskOwnerRequired(status) {
  return status !== "draft";
}

export function taskingFoundationTask(taskId) {
  return TASKING_FOUNDATION.tasks.find((task) => task.id === cleanText(taskId, 120)) || null;
}

export function taskingTaskFromRow(row) {
  if (!row) return null;
  const taskId = cleanText(row.taskId ?? row.task_id, 120);
  const foundation = taskingFoundationTask(taskId);
  if (!taskId) return null;
  const persistedStatus = cleanText(row.status, 40);
  const status = STATUS_SET.has(persistedStatus) ? persistedStatus : foundation?.status || "draft";
  const owner = cleanText(row.owner ?? foundation?.owner, 100);
  const title = cleanText(row.title ?? foundation?.title, 160);
  const description = cleanText(row.description ?? foundation?.description, 1_200);
  const acceptance = cleanText(row.acceptance ?? foundation?.acceptance, 500);
  if (!title || !description || !acceptance || !cleanText(row.anchorId ?? foundation?.anchorId, 120)) return null;
  return {
    taskId,
    id: taskId,
    kind: "Task",
    title,
    description,
    status,
    owner: taskingTaskOwnerRequired(status) ? owner || foundation?.owner || "" : owner,
    acceptance,
    anchorId: cleanText(row.anchorId ?? foundation?.anchorId, 120),
    evidenceCount: Math.max(0, Number(row.evidenceCount ?? foundation?.evidenceCount) || 0),
    dependencyCount: Math.max(0, Number(row.dependencyCount ?? foundation?.dependencyCount) || 0),
    version: Math.max(1, Number(row.version) || 1),
    updatedAt: row.updatedAt ?? row.updated_at ?? null,
    updatedBy: cleanText(row.updatedBy ?? row.updated_by, 120),
  };
}

export function taskingTaskMutation(taskId, body = {}, current = null) {
  const foundation = taskingFoundationTask(taskId);
  if (!foundation) return { error: "Task not found" };
  const expectedVersion = Number(body?.version ?? 0);
  if (!Number.isInteger(expectedVersion) || expectedVersion < 0) return { error: "A valid task version is required" };
  const status = cleanText(body?.status ?? current?.status ?? foundation.status, 40);
  if (!STATUS_SET.has(status)) return { error: "A valid task status is required" };
  const task = {
    taskId: foundation.id,
    title: cleanText(body?.title ?? current?.title ?? foundation.title, 160),
    description: cleanText(body?.description ?? current?.description ?? foundation.description, 1_200),
    status,
    owner: cleanText(body?.owner ?? current?.owner ?? foundation.owner, 100),
    acceptance: cleanText(body?.acceptance ?? current?.acceptance ?? foundation.acceptance, 500),
    version: expectedVersion,
  };
  if (!task.title || !task.description || !task.acceptance) return { error: "Task title, description, and acceptance are required" };
  if (taskingTaskOwnerRequired(task.status) && !task.owner) return { error: "Task owner is required unless status is draft" };
  return { task };
}

export function mergeTaskingTasks(overrides = []) {
  const byId = new Map((Array.isArray(overrides) ? overrides : []).map(taskingTaskFromRow).filter(Boolean).map((task) => [task.taskId, task]));
  const foundation = TASKING_FOUNDATION.tasks.map((task) => {
    const override = byId.get(task.id);
    return override ? { ...task, ...override, id: task.id, persisted: true } : { ...task, version: 0, persisted: false };
  });
  const foundationIds = new Set(foundation.map((task) => task.id));
  return [...foundation, ...[...byId.values()].filter((task) => !foundationIds.has(task.id)).map((task) => ({ ...task, persisted: true }))];
}
