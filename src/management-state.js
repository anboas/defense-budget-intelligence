import { useCallback, useEffect, useMemo, useState } from "react";

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

export function useManagementState(records = []) {
  const validIds = useMemo(() => records.map((record) => record.opportunityId), [records]);
  const [watchlist, setWatchlist] = useState(() => readWatchlist(validIds));
  const [events, setEvents] = useState(() => readManagementEvents(validIds));
  const [activity, setActivity] = useState(() => readOperatorActivity(validIds));

  const sync = useCallback(() => {
    setWatchlist(readWatchlist(validIds));
    setEvents(readManagementEvents(validIds));
    setActivity(readOperatorActivity(validIds));
  }, [validIds]);

  useEffect(() => {
    window.addEventListener(MANAGEMENT_STATE_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(MANAGEMENT_STATE_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, [sync]);

  const toggleWatch = useCallback((recordId) => {
    const current = readWatchlist(validIds);
    const existing = current.find((entry) => entry.recordId === recordId);
    const next = existing
      ? current.filter((entry) => entry.recordId !== recordId)
      : [{ recordId, starredAt: new Date().toISOString(), updatedAt: new Date().toISOString(), reviewAt: "", note: "", wallboard: true }, ...current].slice(0, WATCHLIST_LIMIT);
    write(WATCHLIST_STORAGE_KEY, next);
    setWatchlist(next);
    setActivity((items) => appendActivity({ type: existing ? "watch_removed" : "watch_added", recordId, detail: existing ? "Removed from watchlist" : "Added to watchlist" }, items));
  }, [validIds]);

  const updateWatch = useCallback((recordId, patch) => {
    const current = readWatchlist(validIds);
    const existing = current.find((entry) => entry.recordId === recordId);
    if (!existing) return;
    const normalized = normalizeWatch({ ...existing, ...patch, recordId, updatedAt: new Date().toISOString() });
    const next = current.map((entry) => entry.recordId === recordId ? normalized : entry);
    write(WATCHLIST_STORAGE_KEY, next);
    setWatchlist(next);
    setActivity((items) => appendActivity({ type: "watch_updated", recordId, detail: cleanText(patch.note ? "Updated note" : patch.reviewAt !== undefined ? "Updated review date" : "Updated wallboard visibility") }, items));
  }, [validIds]);

  const saveEvent = useCallback((candidate) => {
    const normalized = normalizeEvent(candidate);
    if (!normalized) return false;
    const current = readManagementEvents(validIds);
    const exists = current.some((entry) => entry.id === normalized.id);
    const next = (exists ? current.map((entry) => entry.id === normalized.id ? normalized : entry) : [normalized, ...current]).slice(0, EVENT_LIMIT);
    write(MANAGEMENT_EVENTS_STORAGE_KEY, next);
    setEvents(next);
    setActivity((items) => appendActivity({ type: exists ? "event_updated" : "event_added", eventId: normalized.id, detail: normalized.title }, items));
    return true;
  }, [validIds]);

  const deleteEvent = useCallback((eventId) => {
    const current = readManagementEvents(validIds);
    const removed = current.find((entry) => entry.id === eventId);
    const next = current.filter((entry) => entry.id !== eventId);
    write(MANAGEMENT_EVENTS_STORAGE_KEY, next);
    setEvents(next);
    setActivity((items) => appendActivity({ type: "event_removed", eventId, detail: removed?.title || "Removed event" }, items));
  }, [validIds]);

  return {
    watchlist,
    watchedIds: useMemo(() => new Set(watchlist.map((entry) => entry.recordId)), [watchlist]),
    events,
    activity,
    toggleWatch,
    updateWatch,
    saveEvent,
    deleteEvent,
  };
}
