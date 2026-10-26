import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "./AuthContext.jsx";
import {
  TASKING_FALLBACK_WORKSPACE,
  taskingFallbackEligible,
} from "./tasking-fallback-data.js";
import { TASKING_FOUNDATION } from "./tasking-foundation-data.js";
import { mergeTaskingTasks, taskingTaskFromRow } from "./tasking-model.js";

const STORAGE_PREFIX = "dbi:tasking-task-overrides:v1";

function storageKey(workspaceId) {
  return `${STORAGE_PREFIX}:${workspaceId || "local"}`;
}

function readLocal(workspaceId) {
  try {
    return JSON.parse(
      window.localStorage.getItem(storageKey(workspaceId)) || "[]",
    )
      .map(taskingTaskFromRow)
      .filter(Boolean);
  } catch {
    return [];
  }
}

function writeLocal(workspaceId, rows) {
  window.localStorage.setItem(storageKey(workspaceId), JSON.stringify(rows));
}

async function request(path = "", options = {}) {
  const response = await fetch(`/api/v1/agent/tasking${path}`, {
    credentials: "same-origin",
    headers: {
      ...(options.body ? { "content-type": "application/json" } : {}),
      ...(options.headers || {}),
    },
    ...options,
  });
  if (response.status === 204) return null;
  const payload = await response.json().catch(() => ({}));
  if (!response.ok)
    throw Object.assign(
      new Error(
        payload.error?.message || payload.error || "Task update failed.",
      ),
      {
        code: payload.error?.code || payload.code,
        status: response.status,
        task: payload.task,
      },
    );
  return payload?.data ?? payload;
}

export function useTaskingTasks() {
  const auth = useAuth();
  const workspaceId = auth?.user?.activeWorkspace?.id || "local";
  const remote = Boolean(auth?.enabled && auth?.user && !auth?.staticHost);
  const [overrides, setOverrides] = useState(() =>
    typeof window === "undefined" ? [] : readLocal(workspaceId),
  );
  const [workspace, setWorkspace] = useState(() => ({
    ...TASKING_FOUNDATION,
    tasks: mergeTaskingTasks(
      typeof window === "undefined" ? [] : readLocal(workspaceId),
    ),
  }));
  const [savingTaskId, setSavingTaskId] = useState("");
  const [notice, setNotice] = useState("");
  const [connectionState, setConnectionState] = useState(
    remote ? "loading" : "local",
  );
  const [connectionError, setConnectionError] = useState("");
  const fallback = connectionState === "fallback" || connectionState === "retrying";
  const canWrite = Boolean(
    !fallback && (!remote || auth?.user?.canWriteWorkspace),
  );

  const refresh = useCallback(async () => {
    if (!remote) {
      const local = readLocal(workspaceId);
      setOverrides(local);
      setWorkspace({ ...TASKING_FOUNDATION, tasks: mergeTaskingTasks(local) });
      setConnectionState("local");
      setConnectionError("");
      return;
    }
    setConnectionState((current) =>
      current === "fallback" || current === "retrying" ? "retrying" : "loading",
    );
    try {
      const payload = await request();
      setWorkspace(payload || TASKING_FOUNDATION);
      setConnectionState("live");
      setConnectionError("");
      setNotice("");
    } catch (error) {
      setConnectionError(error.message);
      if (taskingFallbackEligible(error)) {
        setWorkspace(TASKING_FALLBACK_WORKSPACE);
        setConnectionState("fallback");
        setNotice(
          "Live Tasking is temporarily unavailable. Showing a read-only template workspace.",
        );
      } else {
        setWorkspace(TASKING_FOUNDATION);
        setConnectionState("error");
        setNotice(error.message);
      }
      throw error;
    }
  }, [remote, workspaceId]);

  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(
      () =>
        void refresh().catch((error) => {
          if (active) setNotice(error.message);
        }),
      0,
    );
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [refresh]);

  const saveTask = useCallback(
    async (taskId, values) => {
      if (fallback) throw new Error("Template preview is read only.");
      const current = overrides.find((task) => task.taskId === taskId);
      setSavingTaskId(taskId);
      setNotice("");
      try {
        if (remote) {
          const currentTask = workspace.tasks.find(
            (task) => task.id === taskId,
          );
          const stored = await request(`/tasks/${encodeURIComponent(taskId)}`, {
            method: "PATCH",
            headers: { "if-match": String(currentTask?.version || 0) },
            body: JSON.stringify(values),
          });
          setWorkspace((state) => ({
            ...state,
            tasks: state.tasks.map((task) =>
              task.id === taskId ? stored : task,
            ),
          }));
        } else {
          const stored = taskingTaskFromRow({
            taskId,
            ...values,
            version: (current?.version || 0) + 1,
            updatedAt: new Date().toISOString(),
            updatedBy: "local",
          });
          const next = [
            stored,
            ...overrides.filter((task) => task.taskId !== taskId),
          ].filter(Boolean);
          writeLocal(workspaceId, next);
          setOverrides(next);
        }
        setNotice("Task update saved to this workspace.");
      } catch (error) {
        setNotice(error.message);
        if (error.code === "version_conflict") await refresh().catch(() => {});
        throw error;
      } finally {
        setSavingTaskId("");
      }
    },
    [fallback, overrides, refresh, remote, workspace.tasks, workspaceId],
  );

  const createTask = useCallback(
    async (values) => {
      if (fallback) throw new Error("Template preview is read only.");
      const taskId = `task-${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`}`;
      setSavingTaskId(taskId);
      setNotice("");
      try {
        if (remote) {
          const stored = await request("/tasks", {
            method: "POST",
            headers: { "idempotency-key": taskId },
            body: JSON.stringify({ id: taskId, ...values }),
          });
          setWorkspace((state) => ({
            ...state,
            tasks: [
              stored,
              ...state.tasks.filter((task) => task.id !== stored.id),
            ],
          }));
          setNotice("Draft task created in this workspace.");
          return stored;
        }
        const stored = taskingTaskFromRow({
          taskId,
          ...values,
          version: 1,
          updatedAt: new Date().toISOString(),
          updatedBy: "local",
        });
        const next = [
          stored,
          ...overrides.filter((task) => task.taskId !== taskId),
        ].filter(Boolean);
        writeLocal(workspaceId, next);
        setOverrides(next);
        setWorkspace({ ...TASKING_FOUNDATION, tasks: mergeTaskingTasks(next) });
        setNotice("Draft task created in this local preview.");
        return stored;
      } catch (error) {
        setNotice(error.message);
        throw error;
      } finally {
        setSavingTaskId("");
      }
    },
    [fallback, overrides, remote, workspaceId],
  );

  const resetTask = useCallback(
    async (taskId) => {
      if (fallback) throw new Error("Template preview is read only.");
      const current = remote
        ? workspace.tasks.find((task) => task.id === taskId)
        : overrides.find((task) => task.taskId === taskId);
      if (!current) return;
      setSavingTaskId(taskId);
      setNotice("");
      try {
        if (remote)
          await request(`/tasks/${encodeURIComponent(taskId)}`, {
            method: "DELETE",
            headers: { "if-match": String(current.version) },
          });
        const next = overrides.filter((task) => task.taskId !== taskId);
        if (!remote) writeLocal(workspaceId, next);
        setOverrides(next);
        if (remote) await refresh();
        else
          setWorkspace({
            ...TASKING_FOUNDATION,
            tasks: mergeTaskingTasks(next),
          });
        setNotice("Task removed from this workspace.");
      } catch (error) {
        setNotice(error.message);
        if (error.code === "version_conflict") await refresh().catch(() => {});
        throw error;
      } finally {
        setSavingTaskId("");
      }
    },
    [fallback, overrides, refresh, remote, workspace.tasks, workspaceId],
  );

  return {
    tasks: useMemo(
      () => (remote ? workspace.tasks : mergeTaskingTasks(overrides)),
      [overrides, remote, workspace.tasks],
    ),
    workspace: useMemo(
      () => ({
        ...workspace,
        tasks: remote ? workspace.tasks : mergeTaskingTasks(overrides),
      }),
      [overrides, remote, workspace],
    ),
    canWrite,
    connectionError,
    connectionState,
    isFallback: fallback,
    isLoading: connectionState === "loading",
    persistenceLabel: remote
      ? fallback
        ? "Template preview · read only"
        : workspace.sourceItems?.length
        ? "Workspace + source metadata"
        : "Workspace persisted"
      : "Local preview",
    savingTaskId,
    notice,
    refresh,
    createTask,
    saveTask,
    resetTask,
  };
}
