import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Bell, Bookmark, Copy, Mail, Pencil, Share2, Star, Trash2 } from "lucide-react";
import { useAuth } from "./AuthContext.jsx";
import ControlSelect from "./ControlSelect.jsx";

const STORAGE_KEY = "dbi:spend-saved-views:v1";
const FAVORITES_KEY = "dbi:spend-saved-view-favorites:v1";

function readLocal() { try { const value = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || "[]"); return Array.isArray(value) ? value.filter((entry) => entry?.id && entry?.name) : []; } catch { return []; } }
function storeLocal(views) { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(views)); }
function readFavorites() { try { const value = JSON.parse(window.localStorage.getItem(FAVORITES_KEY) || "[]"); return new Set(Array.isArray(value) ? value.map(String) : []); } catch { return new Set(); } }
function storeFavorites(values) { window.localStorage.setItem(FAVORITES_KEY, JSON.stringify([...values])); }
function matches(record, view, tombstonedIds) {
  const filters = view.filters || {}; const query = String(view.query || "").trim().toLowerCase();
  const searchable = [record.title, record.id, record.reference, record.party, record.recipient, record.portfolio, record.organization?.path?.join(" "), ...(record.technologyAreas || [])].filter(Boolean).join(" ").toLowerCase();
  const tombstoned = tombstonedIds.has(record.opportunityId);
  return (filters.disposition === "tombstoned" ? tombstoned : !tombstoned) && (!query || searchable.includes(query))
    && (!filters.technology || filters.technology === "all" || (record.technologyAreas || []).includes(filters.technology))
    && (!filters.branch || filters.branch === "all" || record.organization?.branch === filters.branch)
    && (!filters.component || filters.component === "all" || record.organization?.component === filters.component)
    && (!filters.office || filters.office === "all" || record.organization?.office === filters.office);
}
function unreadForView(rows, view, tombstonedIds) {
  const boundary = Date.parse(view.lastOpenedAt || view.lastViewedAt || view.savedAt || 0);
  return Number.isFinite(boundary) ? rows.filter((record) => matches(record, view, tombstonedIds) && Date.parse(record.lastChangedAt || record.firstSeenAt || 0) > boundary).length : 0;
}
function viewHref(entry) {
  const params = new URLSearchParams({ spendView: "table" });
  if (entry.query) params.set("capQuery", entry.query);
  const filters = entry.filters || {};
  if (filters.technology && filters.technology !== "all") params.set("technology", filters.technology);
  if (filters.branch && filters.branch !== "all") params.set("orgBranch", filters.branch);
  if (filters.component && filters.component !== "all") params.set("orgComponent", filters.component);
  if (filters.office && filters.office !== "all") params.set("orgOffice", filters.office);
  if (filters.disposition === "tombstoned") params.set("records", "tombstoned");
  return `#/budget-spend/explorer?${params}`;
}

export default function SpendSavedViews({ rows, tombstonedIds, query, filters, onLoad, onHasViews, onSummary }) {
  const auth = useAuth(); const remote = Boolean(auth?.authVersion === "dbi-pages-auth-v1" && auth?.enabled && auth?.user && !auth?.staticHost);
  const createPanelRef = useRef(null);
  const [views, setViews] = useState(() => typeof window === "undefined" ? [] : readLocal()); const [name, setName] = useState(""); const [error, setError] = useState(""); const [notice, setNotice] = useState(""); const [busy, setBusy] = useState(false); const [emailEnabled, setEmailEnabled] = useState(true); const [favoriteIds, setFavoriteIds] = useState(readFavorites); const [editingId, setEditingId] = useState(""); const [editingName, setEditingName] = useState("");
  const counts = useMemo(() => new Map(views.map((entry) => [entry.id, remote ? Number(entry.unreadCount || 0) : unreadForView(rows, entry, tombstonedIds)])), [remote, rows, tombstonedIds, views]);
  const orderedViews = useMemo(() => [...views].sort((left, right) => Number(favoriteIds.has(right.id)) - Number(favoriteIds.has(left.id)) || String(right.updatedAt || right.savedAt || "").localeCompare(String(left.updatedAt || left.savedAt || ""))), [favoriteIds, views]);
  const unreadCount = useMemo(() => [...counts.values()].reduce((total, value) => total + value, 0), [counts]);
  useEffect(() => { onHasViews?.(views.length > 0); }, [onHasViews, views.length]);
  useEffect(() => { onSummary?.({ count: views.length, unreadCount, favorites: favoriteIds.size }); }, [favoriteIds.size, onSummary, unreadCount, views.length]);
  const refresh = useCallback(async () => {
    if (!remote) { setViews(readLocal()); return; }
    const [payload, delivery] = await Promise.all([auth.listAcquisitionSavedViews(), auth.getAcquisitionDeliveryPreferences()]); let next = payload.views || []; const local = readLocal();
    setEmailEnabled(delivery.preferences?.emailEnabled !== false);
    if (!next.length && local.length) {
      next = [];
      for (const entry of local) next.push((await auth.createAcquisitionSavedView({ name: entry.name, query: entry.query || "", filters: entry.filters || {}, alertMode: "none" })).view);
      window.localStorage.removeItem(STORAGE_KEY);
    }
    setViews(next); setError("");
  }, [auth, remote]);
  useEffect(() => { let active = true; const timer = window.setTimeout(() => { void refresh().catch((requestError) => { if (active) setError(requestError.message); }); }, 0); return () => { active = false; window.clearTimeout(timer); }; }, [refresh]);
  async function createView(values = {}) {
    setBusy(true); setError(""); setNotice(""); const savedAt = new Date().toISOString();
    try {
      const nextName = values.name || name.trim() || `Explorer view ${views.length + 1}`; const nextQuery = values.query ?? query; const nextFilters = values.filters || filters; const nextAlert = values.alertMode || "none";
      if (remote) await auth.createAcquisitionSavedView({ name: nextName, query: nextQuery, filters: nextFilters, alertMode: nextAlert });
      else { const next = [...views, { id: `spend-${crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`}`, name: nextName, query: nextQuery, filters: nextFilters, savedAt, lastOpenedAt: savedAt, alertMode: nextAlert }]; setViews(next); storeLocal(next); }
      setName(""); setNotice(values.name ? `Created ${nextName}` : "Current view saved"); if (createPanelRef.current) createPanelRef.current.open = false; if (remote) await refresh();
    } catch (requestError) { setError(requestError.message); } finally { setBusy(false); }
  }
  async function load(entry) { const opened = new Date().toISOString(); setError(""); try { if (remote) { await auth.updateAcquisitionSavedView(entry.id, { opened: true }); await refresh(); } else { const next = views.map((item) => item.id === entry.id ? { ...item, lastOpenedAt: opened } : item); setViews(next); storeLocal(next); } onLoad(entry); } catch (requestError) { setError(requestError.message); } }
  async function remove(entry) { setError(""); try { if (remote) { await auth.deleteAcquisitionSavedView(entry.id); await refresh(); } else { const next = views.filter((item) => item.id !== entry.id); setViews(next); storeLocal(next); } setFavoriteIds((current) => { const next = new Set(current); next.delete(entry.id); storeFavorites(next); return next; }); } catch (requestError) { setError(requestError.message); } }
  async function setAlert(entry, alertMode) { setError(""); try { if (remote) { await auth.updateAcquisitionSavedView(entry.id, { alertMode }); await refresh(); } else { const next = views.map((item) => item.id === entry.id ? { ...item, alertMode } : item); setViews(next); storeLocal(next); } } catch (requestError) { setError(requestError.message); } }
  async function rename(entry) { const nextName = editingName.trim(); if (!nextName) return; setError(""); try { if (remote) { await auth.updateAcquisitionSavedView(entry.id, { name: nextName }); await refresh(); } else { const next = views.map((item) => item.id === entry.id ? { ...item, name: nextName } : item); setViews(next); storeLocal(next); } setEditingId(""); setEditingName(""); } catch (requestError) { setError(requestError.message); } }
  function toggleFavorite(entry) { setFavoriteIds((current) => { const next = new Set(current); if (next.has(entry.id)) next.delete(entry.id); else next.add(entry.id); storeFavorites(next); return next; }); }
  async function share(entry) { setError(""); setNotice(""); try { await navigator.clipboard.writeText(`${window.location.origin}${window.location.pathname}${viewHref(entry)}`); setNotice(`Link copied for ${entry.name}`); } catch { setError("The browser could not copy the link. Open the view and copy the address from the location bar."); } }
  async function toggleEmail(enabled) { setError(""); setBusy(true); try { if (remote) { const result = await auth.updateAcquisitionDeliveryPreferences({ emailEnabled: enabled }); setEmailEnabled(result.preferences.emailEnabled); } } catch (requestError) { setError(requestError.message); } finally { setBusy(false); } }
  return <section className="spend-saved-views" data-spend-saved-views>
    <header className="spend-saved-views__header"><span><Bookmark size={17} /><span><strong>Saved views</strong><small>{views.length ? `${unreadCount} unread change${unreadCount === 1 ? "" : "s"} across ${views.length} view${views.length === 1 ? "" : "s"}` : remote ? "Reusable across your signed-in devices" : "Saved in this browser"}</small></span></span><details ref={createPanelRef} className="spend-saved-views__create-panel"><summary className="if-btn if-btn--secondary">Save current view</summary><div className="spend-saved-views__create"><label><span>View name</span><input value={name} onChange={(event) => setName(event.target.value)} placeholder={`Explorer view ${views.length + 1}`} /></label><button type="button" className="if-button if-button--primary" onClick={() => void createView()} disabled={busy}><Bookmark size={15} />{busy ? "Saving…" : "Save"}</button></div></details></header>
    {error ? <p className="if-alert if-alert--warning" role="status">{error}</p> : null}{notice ? <p className="if-sr-only" role="status">{notice}</p> : null}
    {remote && views.some((entry) => entry.alertMode && entry.alertMode !== "none") ? <label className="spend-saved-views__delivery"><span><Mail size={15} /><b>Email delivery</b><small>In-app alerts remain available if delivery is disabled.</small></span><input type="checkbox" checked={emailEnabled} disabled={busy} onChange={(event) => void toggleEmail(event.target.checked)} /></label> : null}
    {orderedViews.length ? <div className="spend-saved-views__list">{orderedViews.map((entry) => <article key={entry.id} className={favoriteIds.has(entry.id) ? "is-favorite" : ""}>
      {editingId === entry.id ? <form className="spend-saved-views__rename" onSubmit={(event) => { event.preventDefault(); void rename(entry); }}><label><span className="if-sr-only">Rename {entry.name}</span><input autoFocus value={editingName} maxLength={100} onChange={(event) => setEditingName(event.target.value)} /></label><button type="submit" className="if-btn if-btn--primary">Save name</button><button type="button" className="if-btn" onClick={() => setEditingId("")}>Cancel</button></form> : <>
        <button type="button" className="spend-saved-views__open" onClick={() => void load(entry)}><span><b>{entry.name}</b>{favoriteIds.has(entry.id) ? <span className="if-badge">Favorite</span> : null}</span><small>{counts.get(entry.id) ? `${counts.get(entry.id)} unread changes` : "No unread changes"}</small></button>
        <span className="spend-saved-views__alert"><Bell size={13} /><ControlSelect ariaLabel={`Alert preference for ${entry.name}`} value={entry.alertMode || "none"} options={[{ value: "none", label: "No alerts" }, { value: "daily", label: "Daily digest" }, { value: "immediate", label: "Immediate" }]} onChange={(value) => void setAlert(entry, value)} /></span>
        <span className="spend-saved-views__actions"><button type="button" onClick={() => toggleFavorite(entry)} aria-label={`${favoriteIds.has(entry.id) ? "Remove" : "Add"} ${entry.name} ${favoriteIds.has(entry.id) ? "from" : "to"} favorites`} title="Favorite"><Star size={15} fill={favoriteIds.has(entry.id) ? "currentColor" : "none"} /></button><button type="button" onClick={() => void share(entry)} aria-label={`Share saved view ${entry.name}`} title="Copy shareable link"><Share2 size={15} /></button><button type="button" onClick={() => void createView({ name: `${entry.name} copy`, query: entry.query || "", filters: entry.filters || {}, alertMode: "none" })} aria-label={`Duplicate saved view ${entry.name}`} title="Duplicate"><Copy size={15} /></button><button type="button" onClick={() => { setEditingId(entry.id); setEditingName(entry.name); }} aria-label={`Rename saved view ${entry.name}`} title="Rename"><Pencil size={15} /></button><button type="button" onClick={() => void remove(entry)} aria-label={`Delete saved view ${entry.name}`} title="Delete"><Trash2 size={15} /></button></span>
      </>}
    </article>)}</div> : <p className="spend-saved-views__empty">Save a useful filter once, then reopen, share, duplicate, or alert on it from here.</p>}
  </section>;
}
