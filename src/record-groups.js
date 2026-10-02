import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "./AuthContext.jsx";

const STORAGE_KEY = "dbi:record-groups:v1";

function cleanGroups(rows) {
  return (Array.isArray(rows) ? rows : []).map((row) => ({
    id: String(row?.id || "").trim().slice(0, 180),
    title: String(row?.title || "Grouped lifecycle").trim().slice(0, 240),
    memberIds: [...new Set((Array.isArray(row?.memberIds) ? row.memberIds : []).map((value) => String(value || "").trim().slice(0, 180)).filter(Boolean))].slice(0, 8),
    relationship: String(row?.relationship || "related-workstream").trim().slice(0, 80),
    confidence: ["high", "medium", "low", "exact"].includes(row?.confidence) ? row.confidence : "low",
    rationale: String(row?.rationale || "").trim().slice(0, 1200),
    evidence: (Array.isArray(row?.evidence) ? row.evidence : []).map((value) => String(value || "").trim().slice(0, 500)).filter(Boolean).slice(0, 10),
    caveats: (Array.isArray(row?.caveats) ? row.caveats : []).map((value) => String(value || "").trim().slice(0, 500)).filter(Boolean).slice(0, 8),
    provenance: row?.provenance && typeof row.provenance === "object" ? row.provenance : {},
    createdAt: row?.createdAt || null,
    updatedAt: row?.updatedAt || null,
  })).filter((row) => row.id && row.memberIds.length >= 2);
}

function readLocal() {
  try { return cleanGroups(JSON.parse(window.localStorage.getItem(STORAGE_KEY) || "[]")); }
  catch { return []; }
}

async function request(path = "", options = {}) {
  const response = await fetch(`/api/v1/agent/record-groups${path}`, {
    credentials: "same-origin",
    headers: { ...(options.body ? { "content-type": "application/json" } : {}), ...(options.headers || {}) },
    ...options,
  });
  if (response.status === 204) return null;
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(payload.error?.message || payload.error || "Record grouping request failed."), { code: payload.error?.code || payload.code || "record_group_failed" });
  return payload;
}

export function useRecordGroups(records = []) {
  const auth = useAuth();
  const remote = Boolean(auth?.authVersion === "dbi-pages-auth-v1" && auth?.enabled && auth?.user && !auth?.staticHost);
  const [groups, setGroups] = useState(() => typeof window === "undefined" ? [] : readLocal());
  const [state, setState] = useState("idle");
  const [notice, setNotice] = useState("");
  const recordIds = useMemo(() => new Set(records.map((record) => record.opportunityId)), [records]);

  const refresh = useCallback(async () => {
    if (!remote) { setGroups(readLocal()); return; }
    const payload = await request();
    setGroups(cleanGroups(payload?.data || []));
  }, [remote]);

  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(() => {
      void refresh().catch((error) => { if (active) setNotice(error.message); });
    }, 0);
    return () => { active = false; window.clearTimeout(timer); };
  }, [refresh]);

  const groupWithAi = useCallback(async (memberIds) => {
    const ids = [...new Set(memberIds)].filter((id) => recordIds.has(id)).slice(0, 8);
    if (ids.length < 2) throw new Error("Select at least two records to review.");
    if (!remote) throw new Error("AI grouping requires an authenticated workspace with an OpenAI credential.");
    setState("running");
    setNotice("OpenAI is checking whether the selected records form one lifecycle…");
    try {
      const payload = await request("", { method: "POST", body: JSON.stringify({ memberIds: ids }) });
      const group = cleanGroups([payload?.data])[0];
      if (group) {
        setGroups((current) => [group, ...current.filter((row) => row.id !== group.id && !row.memberIds.some((id) => group.memberIds.includes(id)))]);
        setNotice(`Grouped ${group.memberIds.length} records as “${group.title}”.`);
      } else {
        setNotice(payload?.meta?.message || "OpenAI did not find enough evidence to group these records.");
      }
      setState("succeeded");
      return group || null;
    } catch (error) {
      setState("failed");
      setNotice(error.message);
      throw error;
    }
  }, [recordIds, remote]);

  const remove = useCallback(async (groupId) => {
    const target = groups.find((group) => group.id === groupId);
    setGroups((current) => current.filter((group) => group.id !== groupId));
    if (remote) {
      try { await request(`/${encodeURIComponent(groupId)}`, { method: "DELETE" }); setNotice("Lifecycle group removed; the source records remain unchanged."); }
      catch (error) { if (target) setGroups((current) => [target, ...current]); setNotice(error.message); }
    } else {
      const next = readLocal().filter((group) => group.id !== groupId);
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      setNotice("Lifecycle group removed; the source records remain unchanged.");
    }
  }, [groups, remote]);

  return { groups, state, notice, setNotice, canWrite: Boolean(!remote || auth?.user?.canWriteWorkspace), groupWithAi, remove, refresh };
}
