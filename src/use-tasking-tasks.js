import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "./AuthContext.jsx";
import { mergeTaskingTasks, taskingTaskFromRow } from "./tasking-model.js";

const STORAGE_PREFIX = "dbi:tasking-task-overrides:v1";

function storageKey(workspaceId) {
  return `${STORAGE_PREFIX}:${workspaceId || "local"}`;
}

function readLocal(workspaceId) {
  try { return (JSON.parse(window.localStorage.getItem(storageKey(workspaceId)) || "[]")).map(taskingTaskFromRow).filter(Boolean); }
  catch { return []; }
}

function writeLocal(workspaceId, rows) {
  window.localStorage.setItem(storageKey(workspaceId), JSON.stringify(rows));
}

async function request(path = "", options = {}) {
  const response = await fetch(`/api/v1/auth/tasking${path}`, {
    credentials: "same-origin",
    headers: { ...(options.body ? { "content-type": "application/json" } : {}), ...(options.headers || {}) },
    ...options,
  });
  if (response.status === 204) return null;
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(payload.error?.message || payload.error || "Task update failed."), { code: payload.error?.code || payload.code, task: payload.task });
  return payload;
}

export function useTaskingTasks() {
  const auth = useAuth();
  const workspaceId = auth?.user?.activeWorkspace?.id || "local";
  const remote = Boolean(auth?.enabled && auth?.user && !auth?.staticHost);
  const [overrides, setOverrides] = useState(() => typeof window === "undefined" ? [] : readLocal(workspaceId));
  const [savingTaskId, setSavingTaskId] = useState("");
  const [notice, setNotice] = useState("");

  const refresh = useCallback(async () => {
    if (!remote) { setOverrides(readLocal(workspaceId)); return; }
    const payload = await request();
    setOverrides((payload?.tasks || []).map(taskingTaskFromRow).filter(Boolean));
  }, [remote, workspaceId]);

  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(() => void refresh().catch((error) => { if (active) setNotice(error.message); }), 0);
    return () => { active = false; window.clearTimeout(timer); };
  }, [refresh]);

  const saveTask = useCallback(async (taskId, values) => {
    const current = overrides.find((task) => task.taskId === taskId);
    setSavingTaskId(taskId); setNotice("");
    try {
      if (remote) {
        const payload = await request(`/${encodeURIComponent(taskId)}`, { method: "PATCH", body: JSON.stringify({ ...values, version: current?.version || 0 }) });
        const stored = taskingTaskFromRow(payload?.task);
        setOverrides((rows) => [stored, ...rows.filter((task) => task.taskId !== taskId)].filter(Boolean));
      } else {
        const stored = taskingTaskFromRow({ taskId, ...values, version: (current?.version || 0) + 1, updatedAt: new Date().toISOString(), updatedBy: "local" });
        const next = [stored, ...overrides.filter((task) => task.taskId !== taskId)].filter(Boolean);
        writeLocal(workspaceId, next); setOverrides(next);
      }
      setNotice("Task update saved to this workspace.");
    } catch (error) {
      setNotice(error.message);
      if (error.code === "version_conflict") await refresh().catch(() => {});
      throw error;
    } finally { setSavingTaskId(""); }
  }, [overrides, refresh, remote, workspaceId]);

  const resetTask = useCallback(async (taskId) => {
    const current = overrides.find((task) => task.taskId === taskId);
    if (!current) return;
    setSavingTaskId(taskId); setNotice("");
    try {
      if (remote) await request(`/${encodeURIComponent(taskId)}?version=${current.version}`, { method: "DELETE" });
      const next = overrides.filter((task) => task.taskId !== taskId);
      if (!remote) writeLocal(workspaceId, next);
      setOverrides(next); setNotice("Task reset to the foundation state.");
    } catch (error) {
      setNotice(error.message);
      if (error.code === "version_conflict") await refresh().catch(() => {});
      throw error;
    } finally { setSavingTaskId(""); }
  }, [overrides, refresh, remote, workspaceId]);

  return {
    tasks: useMemo(() => mergeTaskingTasks(overrides), [overrides]),
    canWrite: Boolean(!remote || auth?.user?.canWriteWorkspace),
    persistenceLabel: remote ? "Workspace persisted" : "Browser persisted",
    savingTaskId,
    notice,
    saveTask,
    resetTask,
  };
}
