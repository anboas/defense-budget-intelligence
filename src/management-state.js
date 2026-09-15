import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "./AuthContext.jsx";

export const WATCHLIST_STORAGE_KEY = "dbi:watchlist:v1";
export const MANAGEMENT_EVENTS_STORAGE_KEY = "dbi:management-events:v1";
export const EVENT_CATEGORIES_STORAGE_KEY = "dbi:event-categories:v1";
export const OPERATOR_ACTIVITY_STORAGE_KEY = "dbi:operator-activity:v1";
export const MANAGEMENT_STATE_EVENT = "dbi:management-state-changed";

const WATCHLIST_LIMIT = 250;
const EVENT_LIMIT = 200;
const ACTIVITY_LIMIT = 500;
const EVENT_MILESTONE_LIMIT = 24;
const EVENT_LINK_LIMIT = 12;
const EVENT_CATEGORY_LIMIT = 50;
const DEFAULT_EVENT_CATEGORIES = Object.freeze([
  { id: "conference", name: "Conference", description: "Conferences, conventions, and annual meetings" },
  { id: "industry-day", name: "Industry day", description: "Government and mission-partner industry engagement" },
  { id: "workshop", name: "Workshop", description: "Hands-on working sessions and workshops" },
  { id: "immersion-day", name: "Immersion day", description: "Focused mission, customer, or technology immersion" },
  { id: "summit", name: "Summit", description: "Executive, technical, and mission summits" },
  { id: "other", name: "Other", description: "Workspace events outside the managed categories" },
]);
const EVENT_MILESTONE_TYPES = new Set([
  "registration_deadline",
  "refund_deadline",
  "hotel_deadline",
  "exhibitor_deadline",
  "submission_deadline",
  "other",
]);

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

function cleanHttpUrl(value) {
  const text = cleanText(value, 2_000);
  if (!text) return "";
  try {
    const url = new URL(text);
    return ["http:", "https:"].includes(url.protocol) ? url.toString() : "";
  } catch {
    return "";
  }
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
  const attendees = (Array.isArray(entry.attendees) ? entry.attendees : []).map((attendee) => {
    if (typeof attendee === "string") return { id: "", displayName: cleanText(attendee, 120), title: "", status: "legacy" };
    return { id: cleanText(attendee?.id, 80), displayName: cleanText(attendee?.displayName, 120), title: cleanText(attendee?.title, 120), status: cleanText(attendee?.status, 32) || "active", avatarDataUrl: cleanText(attendee?.avatarDataUrl, 14_000) };
  }).filter((attendee) => attendee.displayName);
  const attendeeIds = [...new Set((Array.isArray(entry.attendeeIds) ? entry.attendeeIds : attendees.map((attendee) => attendee.id)).map((value) => cleanText(value, 80)).filter(Boolean))].slice(0, 30);
  const linkIds = new Set();
  const linkUrls = new Set();
  const links = (Array.isArray(entry.links) ? entry.links : []).map((link, index) => {
    const id = cleanText(link?.id, 100) || `link-${Date.now()}-${index}`;
    const url = cleanHttpUrl(link?.url);
    if (!url || linkIds.has(id) || linkUrls.has(url)) return null;
    linkIds.add(id);
    linkUrls.add(url);
    return { id, label: cleanText(link?.label, 120), url, sortOrder: index };
  }).filter(Boolean).slice(0, EVENT_LINK_LIMIT);
  const milestoneIds = new Set();
  const milestones = (Array.isArray(entry.milestones) ? entry.milestones : []).map((milestone, index) => {
    const occursAt = cleanDate(milestone?.occursAt || milestone?.date);
    const type = EVENT_MILESTONE_TYPES.has(milestone?.type) ? milestone.type : "other";
    const id = cleanText(milestone?.id, 100) || `milestone-${Date.now()}-${index}`;
    const label = cleanText(milestone?.label, 120);
    if (!occursAt || milestoneIds.has(id) || (type === "other" && !label)) return null;
    milestoneIds.add(id);
    return {
      id,
      type,
      label,
      occursAt,
      notes: cleanText(milestone?.notes, 500),
    };
  }).filter(Boolean).slice(0, EVENT_MILESTONE_LIMIT);
  return {
    id,
    title,
    startsAt,
    endsAt: cleanDate(entry.endsAt),
    location: cleanText(entry.location, 240),
    notes: cleanText(entry.notes, 1200),
    status: ["scheduled", "completed", "cancelled"].includes(entry.status) ? entry.status : "scheduled",
    recordIds: [...new Set((Array.isArray(entry.recordIds) ? entry.recordIds : []).map((value) => cleanText(value, 180)).filter(Boolean))].slice(0, 50),
    attendees: attendees.slice(0, 30),
    attendeeIds,
    links,
    categoryIds: [...new Set((Array.isArray(entry.categoryIds) ? entry.categoryIds : []).map((value) => cleanText(value, 80)).filter(Boolean))].slice(0, 8),
    milestones,
    wallboard: entry.wallboard !== false,
    version: Number.isFinite(Number(entry.version)) ? Number(entry.version) : 0,
    createdAt: cleanDate(entry.createdAt) || new Date().toISOString(),
    updatedAt: cleanDate(entry.updatedAt) || new Date().toISOString(),
  };
}

function normalizeEventCategory(entry = {}) {
  const name = cleanText(entry.name, 80);
  if (name.length < 2) return null;
  return {
    id: cleanText(entry.id, 80) || `category-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name,
    description: cleanText(entry.description, 240),
    assignedEventCount: Number(entry.assignedEventCount || 0),
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
    actorType: cleanText(entry.actorType, 80),
    actorId: cleanText(entry.actorId, 180),
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

export function readEventCategories() {
  const stored = storedArray(EVENT_CATEGORIES_STORAGE_KEY).map(normalizeEventCategory).filter(Boolean);
  return (stored.length ? stored : DEFAULT_EVENT_CATEGORIES.map(normalizeEventCategory)).slice(0, EVENT_CATEGORY_LIMIT);
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
    actorType: entry.actorType,
    actorId: entry.actorId,
  });
}

export function useManagementState(records = []) {
  const auth = useAuth();
  const remote = Boolean(auth?.authVersion === "dbi-pages-auth-v1" && auth?.enabled && auth?.user && !auth?.staticHost);
  const validIds = useMemo(() => records.map((record) => record.opportunityId), [records]);
  const [watchlist, setWatchlist] = useState(() => readWatchlist(validIds));
  const [events, setEvents] = useState(() => readManagementEvents(validIds));
  const [eventCategories, setEventCategories] = useState(() => readEventCategories());
  const [activity, setActivity] = useState(() => readOperatorActivity(validIds));
  const [loading, setLoading] = useState(remote);
  const [error, setError] = useState("");
  const [lastRefreshedAt, setLastRefreshedAt] = useState("");

  const sync = useCallback(() => {
    setWatchlist(readWatchlist(validIds));
    setEvents(readManagementEvents(validIds));
    setEventCategories(readEventCategories());
    setActivity(readOperatorActivity(validIds));
  }, [validIds]);

  const syncRemote = useCallback(async () => {
    const [trackingPayload, eventPayload, categoryPayload, activityPayload] = await Promise.all([
      workspaceRequest("/tracking"),
      workspaceRequest("/events"),
      workspaceRequest("/event-categories"),
      workspaceRequest("/activity?limit=200"),
    ]);
    const allowed = new Set(validIds);
    setWatchlist((trackingPayload.data || []).map(normalizeWatch).filter((entry) => entry && allowed.has(entry.recordId)));
    setEvents((eventPayload.data || []).map(normalizeEvent).filter(Boolean));
    setEventCategories((categoryPayload.data || []).map(normalizeEventCategory).filter(Boolean));
    setActivity((activityPayload.data || []).map(remoteActivity).filter(Boolean));
    setError("");
    setLastRefreshedAt(new Date().toISOString());
  }, [validIds]);

  useEffect(() => {
    if (remote) {
      let active = true;
      const timer = window.setTimeout(() => {
        void syncRemote().catch((requestError) => { if (active) setError(requestError.message); }).finally(() => { if (active) setLoading(false); });
      }, 0);
      const refresh = () => {
        if (!document.hidden) void syncRemote().catch((requestError) => { if (active) setError(requestError.message); });
      };
      const interval = window.setInterval(refresh, 120_000);
      const onFocus = () => { void syncRemote().catch((requestError) => { if (active) setError(requestError.message); }); };
      const onVisibility = () => { if (!document.hidden) onFocus(); };
      window.addEventListener("focus", onFocus);
      document.addEventListener("visibilitychange", onVisibility);
      return () => { active = false; window.clearTimeout(timer); window.clearInterval(interval); window.removeEventListener("focus", onFocus); document.removeEventListener("visibilitychange", onVisibility); };
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

  const saveEventCategory = useCallback(async (candidate) => {
    const normalized = normalizeEventCategory(candidate);
    if (!normalized) return false;
    if (remote) {
      const existing = eventCategories.find((entry) => entry.id === normalized.id);
      try {
        await workspaceRequest(existing ? `/event-categories/${encodeURIComponent(existing.id)}` : "/event-categories", {
          method: existing ? "PATCH" : "POST",
          body: JSON.stringify({ name: normalized.name, description: normalized.description }),
        });
        await syncRemote();
        return true;
      } catch (requestError) {
        setError(requestError.message);
        throw requestError;
      }
    }
    const current = readEventCategories();
    const exists = current.some((entry) => entry.id === normalized.id);
    const next = (exists ? current.map((entry) => entry.id === normalized.id ? normalized : entry) : [...current, normalized]).slice(0, EVENT_CATEGORY_LIMIT);
    write(EVENT_CATEGORIES_STORAGE_KEY, next);
    setEventCategories(next);
    return true;
  }, [eventCategories, remote, syncRemote]);

  const deleteEventCategory = useCallback(async (categoryId) => {
    if (events.some((event) => event.categoryIds?.includes(categoryId))) throw new Error("Remove this category from its events before deleting it.");
    if (remote) {
      try {
        await workspaceRequest(`/event-categories/${encodeURIComponent(categoryId)}`, { method: "DELETE" });
        await syncRemote();
      } catch (requestError) {
        setError(requestError.message);
        throw requestError;
      }
      return;
    }
    const next = readEventCategories().filter((entry) => entry.id !== categoryId);
    write(EVENT_CATEGORIES_STORAGE_KEY, next);
    setEventCategories(next);
  }, [events, remote, syncRemote]);
  const eventCategoriesWithCounts = useMemo(() => eventCategories.map((category) => ({
    ...category,
    assignedEventCount: events.filter((event) => event.categoryIds?.includes(category.id)).length,
  })), [eventCategories, events]);

  return {
    watchlist,
    watchedIds: useMemo(() => new Set(watchlist.map((entry) => entry.recordId)), [watchlist]),
    events,
    eventCategories: eventCategoriesWithCounts,
    activity,
    toggleWatch,
    updateWatch,
    saveEvent,
    deleteEvent,
    saveEventCategory,
    deleteEventCategory,
    remote,
    loading,
    error,
    lastRefreshedAt,
    refresh: syncRemote,
  };
}
