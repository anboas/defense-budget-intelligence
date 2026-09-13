import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "./AuthContext.jsx";

export const WATCHLIST_STORAGE_KEY = "dbi:watchlist:v1";
export const MANAGEMENT_EVENTS_STORAGE_KEY = "dbi:management-events:v1";
export const OPERATOR_ACTIVITY_STORAGE_KEY = "dbi:operator-activity:v1";
export const MANAGEMENT_STATE_EVENT = "dbi:management-state-changed";

const WATCHLIST_LIMIT = 250;
const EVENT_LIMIT = 200;
const ACTIVITY_LIMIT = 500;

function cleanText(value, limit = 500) {
  return Array.from(String(value ?? ""), (character) => {
    const code = character.charCodeAt(0);
    return code < 32 || code === 127 ? " " : character;
  }).join("").trim().slice(0, limit);
}

function cleanDate(value) {
  const text = cleanText(value, 32);
  return /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d{3})?)?Z?)?$/.test(text) ? text : "";
}

function storedArray(key) {
  if (typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(key) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function normalizeWatch(entry = {}) {
  const recordId = cleanText(entry.recordId, 180);
  if (!recordId) return null;
  const starredAt = cleanDate(entry.starredAt) || new Date().toISOString();
  return {
    recordId,
    starredAt,
    updatedAt: cleanDate(entry.updatedAt) || starredAt,
    reviewAt: cleanDate(entry.reviewAt),
    note: cleanText(entry.note, 1200),
    wallboard: entry.wallboard !== false,
  };
}

function normalizeEvent(entry = {}) {
  const id = cleanText(entry.id, 180) || `event-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const title = cleanText(entry.title, 180);
  const startsAt = cleanDate(entry.startsAt);
  if (!title || !startsAt) return null;
  return {
    id,
    title,
    startsAt,
    endsAt: cleanDate(entry.endsAt),
    location: cleanText(entry.location, 240),
    notes: cleanText(entry.notes, 1200),
    status: ["scheduled", "completed", "cancelled"].includes(entry.status) ? entry.status : "scheduled",
    recordIds: [...new Set((Array.isArray(entry.recordIds) ? entry.recordIds : []).map((value) => cleanText(value, 180)).filter(Boolean))].slice(0, 50),
    wallboard: entry.wallboard !== false,
    createdAt: cleanDate(entry.createdAt) || new Date().toISOString(),
    updatedAt: cleanDate(entry.updatedAt) || new Date().toISOString(),
  };
}

function normalizeActivity(entry = {}) {
  const at = cleanDate(entry.at) || new Date().toISOString();
  return {
    id: cleanText(entry.id, 180) || `activity-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    at,
    type: cleanText(entry.type, 80) || "updated",
    recordId: cleanText(entry.recordId, 180),
    eventId: cleanText(entry.eventId, 180),
    detail: cleanText(entry.detail, 500),
  };
}

export function readWatchlist(validIds = null) {
  const allowed = validIds ? new Set(validIds) : null;
  const seen = new Set();
  return storedArray(WATCHLIST_STORAGE_KEY)
    .map(normalizeWatch)
    .filter((entry) => entry && (!allowed || allowed.has(entry.recordId)) && !seen.has(entry.recordId) && seen.add(entry.recordId))
    .slice(0, WATCHLIST_LIMIT);
}

export function readManagementEvents(validIds = null) {
  const allowed = validIds ? new Set(validIds) : null;
  return storedArray(MANAGEMENT_EVENTS_STORAGE_KEY)
    .map(normalizeEvent)
    .filter((entry) => entry)
    .map((entry) => ({ ...entry, recordIds: allowed ? entry.recordIds.filter((id) => allowed.has(id)) : entry.recordIds }))
    .slice(0, EVENT_LIMIT);
}

export function readOperatorActivity(validIds = null) {
  const allowed = validIds ? new Set(validIds) : null;
  return storedArray(OPERATOR_ACTIVITY_STORAGE_KEY)
    .map(normalizeActivity)
    .filter((entry) => !entry.recordId || !allowed || allowed.has(entry.recordId))
    .slice(0, ACTIVITY_LIMIT);
}

function write(key, value) {
  window.localStorage.setItem(key, JSON.stringify(value));
  window.dispatchEvent(new CustomEvent(MANAGEMENT_STATE_EVENT, { detail: { key } }));
}

function appendActivity(activity, current) {
  const next = [normalizeActivity(activity), ...current].filter(Boolean).slice(0, ACTIVITY_LIMIT);
  write(OPERATOR_ACTIVITY_STORAGE_KEY, next);
  return next;
}

async function workspaceRequest(path, options = {}) {
  const response = await fetch(`/api/v1/agent${path}`, {
    credentials: "same-origin",
    headers: { ...(options.body ? { "content-type": "application/json" } : {}), ...(options.headers || {}) },
    ...options,
  });
  if (response.status === 204) return null;
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error?.message || payload.error || "Workspace state request failed.");
  return payload;
}

function remoteActivity(entry = {}) {
  const detail = entry.detail && typeof entry.detail === "object" ? entry.detail : {};
  return normalizeActivity({
    id: entry.id,
    at: entry.occurredAt,
    type: entry.action,
    recordId: entry.entityType === "tracking" || entry.entityType === "manual_record" ? entry.entityId : "",
    eventId: entry.entityType === "event" ? entry.entityId : "",
    detail: detail.detail || detail.title || (detail.version ? `Version ${detail.version}` : `${entry.actorType || "workspace"} change`),
  });
}

export function useManagementState(records = []) {
  const auth = useAuth();
  const remote = Boolean(auth?.authVersion === "dbi-pages-auth-v1" && auth?.enabled && auth?.user && !auth?.staticHost);
  const validIds = useMemo(() => records.map((record) => record.opportunityId), [records]);
  const [watchlist, setWatchlist] = useState(() => readWatchlist(validIds));
  const [events, setEvents] = useState(() => readManagementEvents(validIds));
  const [activity, setActivity] = useState(() => readOperatorActivity(validIds));
  const [loading, setLoading] = useState(remote);
  const [error, setError] = useState("");

  const sync = useCallback(() => {
    setWatchlist(readWatchlist(validIds));
    setEvents(readManagementEvents(validIds));
    setActivity(readOperatorActivity(validIds));
  }, [validIds]);

  const syncRemote = useCallback(async () => {
    const [trackingPayload, eventPayload, activityPayload] = await Promise.all([
      workspaceRequest("/tracking"),
      workspaceRequest("/events"),
      workspaceRequest("/activity?limit=200"),
    ]);
    const allowed = new Set(validIds);
    setWatchlist((trackingPayload.data || []).map(normalizeWatch).filter((entry) => entry && allowed.has(entry.recordId)));
    setEvents((eventPayload.data || []).map(normalizeEvent).filter(Boolean));
    setActivity((activityPayload.data || []).map(remoteActivity).filter(Boolean));
    setError("");
  }, [validIds]);

  useEffect(() => {
    if (remote) {
      let active = true;
      const timer = window.setTimeout(() => {
        void syncRemote().catch((requestError) => { if (active) setError(requestError.message); }).finally(() => { if (active) setLoading(false); });
      }, 0);
      const interval = window.setInterval(() => { void syncRemote().catch((requestError) => { if (active) setError(requestError.message); }); }, 30_000);
      const onFocus = () => { void syncRemote().catch((requestError) => { if (active) setError(requestError.message); }); };
      window.addEventListener("focus", onFocus);
      return () => { active = false; window.clearTimeout(timer); window.clearInterval(interval); window.removeEventListener("focus", onFocus); };
    }
    window.addEventListener(MANAGEMENT_STATE_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(MANAGEMENT_STATE_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, [remote, sync, syncRemote]);

  const toggleWatch = useCallback((recordId) => {
    if (remote) {
      const existing = watchlist.find((entry) => entry.recordId === recordId);
      setWatchlist((current) => existing ? current.filter((entry) => entry.recordId !== recordId) : [{ recordId, starredAt: new Date().toISOString(), updatedAt: new Date().toISOString(), reviewAt: "", note: "", wallboard: true, version: 0 }, ...current]);
      const task = existing
        ? workspaceRequest(`/tracking/${encodeURIComponent(recordId)}`, { method: "DELETE" })
        : workspaceRequest(`/tracking/${encodeURIComponent(recordId)}`, { method: "PUT", body: JSON.stringify({ note: "", reviewAt: "", wallboard: true }) });
      void task.then(() => syncRemote()).catch((requestError) => { setError(requestError.message); void syncRemote(); });
      return;
    }
    const current = readWatchlist(validIds);
    const existing = current.find((entry) => entry.recordId === recordId);
    const next = existing
      ? current.filter((entry) => entry.recordId !== recordId)
      : [{ recordId, starredAt: new Date().toISOString(), updatedAt: new Date().toISOString(), reviewAt: "", note: "", wallboard: true }, ...current].slice(0, WATCHLIST_LIMIT);
    write(WATCHLIST_STORAGE_KEY, next);
    setWatchlist(next);
    setActivity((items) => appendActivity({ type: existing ? "watch_removed" : "watch_added", recordId, detail: existing ? "Removed from watchlist" : "Added to watchlist" }, items));
  }, [remote, syncRemote, validIds, watchlist]);

  const updateWatch = useCallback((recordId, patch) => {
    if (remote) {
      const existing = watchlist.find((entry) => entry.recordId === recordId);
      if (!existing) return;
      const next = normalizeWatch({ ...existing, ...patch, recordId, updatedAt: new Date().toISOString() });
      setWatchlist((current) => current.map((entry) => entry.recordId === recordId ? next : entry));
      void workspaceRequest(`/tracking/${encodeURIComponent(recordId)}`, {
        method: "PUT",
        headers: existing.version ? { "if-match": String(existing.version) } : {},
        body: JSON.stringify({ note: next.note, reviewAt: next.reviewAt, wallboard: next.wallboard }),
      }).then(() => syncRemote()).catch((requestError) => { setError(requestError.message); void syncRemote(); });
      return;
    }
    const current = readWatchlist(validIds);
    const existing = current.find((entry) => entry.recordId === recordId);
    if (!existing) return;
    const normalized = normalizeWatch({ ...existing, ...patch, recordId, updatedAt: new Date().toISOString() });
    const next = current.map((entry) => entry.recordId === recordId ? normalized : entry);
    write(WATCHLIST_STORAGE_KEY, next);
    setWatchlist(next);
    setActivity((items) => appendActivity({ type: "watch_updated", recordId, detail: cleanText(patch.note ? "Updated note" : patch.reviewAt !== undefined ? "Updated review date" : "Updated wallboard visibility") }, items));
  }, [remote, syncRemote, validIds, watchlist]);

  const saveEvent = useCallback((candidate) => {
    const normalized = normalizeEvent(candidate);
    if (!normalized) return false;
    if (remote) {
      const existing = events.find((entry) => entry.id === normalized.id);
      const path = existing ? `/events/${encodeURIComponent(existing.id)}` : "/events";
      const options = existing
        ? { method: "PATCH", headers: existing.version ? { "if-match": String(existing.version) } : {}, body: JSON.stringify(normalized) }
        : { method: "POST", headers: { "idempotency-key": crypto.randomUUID() }, body: JSON.stringify(normalized) };
      void workspaceRequest(path, options).then(() => syncRemote()).catch((requestError) => { setError(requestError.message); void syncRemote(); });
      return true;
    }
    const current = readManagementEvents(validIds);
    const exists = current.some((entry) => entry.id === normalized.id);
    const next = (exists ? current.map((entry) => entry.id === normalized.id ? normalized : entry) : [normalized, ...current]).slice(0, EVENT_LIMIT);
    write(MANAGEMENT_EVENTS_STORAGE_KEY, next);
    setEvents(next);
    setActivity((items) => appendActivity({ type: exists ? "event_updated" : "event_added", eventId: normalized.id, detail: normalized.title }, items));
    return true;
  }, [events, remote, syncRemote, validIds]);

  const deleteEvent = useCallback((eventId) => {
    if (remote) {
      setEvents((current) => current.filter((entry) => entry.id !== eventId));
      void workspaceRequest(`/events/${encodeURIComponent(eventId)}`, { method: "DELETE" }).then(() => syncRemote()).catch((requestError) => { setError(requestError.message); void syncRemote(); });
      return;
    }
    const current = readManagementEvents(validIds);
    const removed = current.find((entry) => entry.id === eventId);
    const next = current.filter((entry) => entry.id !== eventId);
    write(MANAGEMENT_EVENTS_STORAGE_KEY, next);
    setEvents(next);
    setActivity((items) => appendActivity({ type: "event_removed", eventId, detail: removed?.title || "Removed event" }, items));
  }, [remote, syncRemote, validIds]);

  return {
    watchlist,
    watchedIds: useMemo(() => new Set(watchlist.map((entry) => entry.recordId)), [watchlist]),
    events,
    activity,
    toggleWatch,
    updateWatch,
    saveEvent,
    deleteEvent,
    remote,
    loading,
    error,
  };
}
