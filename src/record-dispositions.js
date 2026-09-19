import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "./AuthContext.jsx";

const STORAGE_KEY = "dbi:record-dispositions:v1";

function cleanRows(rows) {
  return (Array.isArray(rows) ? rows : []).map((row) => ({
    recordId: String(row?.recordId || "").trim().slice(0, 180),
    disposition: row?.disposition === "tombstoned" ? "tombstoned" : "",
    reason: String(row?.reason || "").trim().slice(0, 500),
    createdAt: row?.createdAt || new Date().toISOString(),
    updatedAt: row?.updatedAt || row?.createdAt || new Date().toISOString(),
  })).filter((row) => row.recordId && row.disposition);
}

function readLocal() {
  try { return cleanRows(JSON.parse(window.localStorage.getItem(STORAGE_KEY) || "[]")); }
  catch { return []; }
}

async function request(path = "", options = {}) {
  const response = await fetch(`/api/v1/agent/record-dispositions${path}`, {
    credentials: "same-origin",
    headers: { ...(options.body ? { "content-type": "application/json" } : {}), ...(options.headers || {}) },
    ...options,
  });
  if (response.status === 204) return null;
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error?.message || payload.error || "Record disposition request failed.");
  return payload;
}

export function useRecordDispositions() {
  const auth = useAuth();
  const remote = Boolean(auth?.authVersion === "dbi-pages-auth-v1" && auth?.enabled && auth?.user && !auth?.staticHost);
  const [rows, setRows] = useState(() => typeof window === "undefined" ? [] : readLocal());
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    if (!remote) { setRows(readLocal()); return; }
    const payload = await request();
    setRows(cleanRows(payload?.data || []));
    setError("");
  }, [remote]);

  useEffect(() => {
    let active = true;
    const timer = remote ? window.setTimeout(() => { void refresh().catch((refreshError) => { if (active) setError(refreshError.message); }); }, 0) : null;
    const sync = () => { if (active && !remote) setRows(readLocal()); };
    window.addEventListener("storage", sync);
    return () => { active = false; if (timer) window.clearTimeout(timer); window.removeEventListener("storage", sync); };
  }, [refresh, remote]);

  const tombstone = useCallback((recordId, reason = "") => {
    const now = new Date().toISOString();
    const row = { recordId, disposition: "tombstoned", reason, createdAt: now, updatedAt: now };
    setRows((current) => [row, ...current.filter((entry) => entry.recordId !== recordId)]);
    if (remote) {
      void request(`/${encodeURIComponent(recordId)}`, { method: "PUT", body: JSON.stringify({ disposition: "tombstoned", reason }) })
        .then(refresh).catch((requestError) => { setError(requestError.message); void refresh(); });
    } else {
      const next = [row, ...readLocal().filter((entry) => entry.recordId !== recordId)];
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    }
  }, [refresh, remote]);

  const restore = useCallback((recordId) => {
    setRows((current) => current.filter((entry) => entry.recordId !== recordId));
    if (remote) {
      void request(`/${encodeURIComponent(recordId)}`, { method: "DELETE" })
        .then(refresh).catch((requestError) => { setError(requestError.message); void refresh(); });
    } else {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(readLocal().filter((entry) => entry.recordId !== recordId)));
    }
  }, [refresh, remote]);

  return {
    rows,
    tombstonedIds: useMemo(() => new Set(rows.map((row) => row.recordId)), [rows]),
    canWrite: Boolean(!remote || auth?.user?.canWriteWorkspace),
    tombstone,
    restore,
    error,
  };
}
