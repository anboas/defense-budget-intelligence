import { useCallback, useEffect, useMemo, useState } from "react";
import { Bell, Bookmark, Trash2 } from "lucide-react";
import { useAuth } from "./AuthContext.jsx";
import ControlSelect from "./ControlSelect.jsx";

const STORAGE_KEY = "dbi:spend-saved-views:v1";
function readLocal() { try { const value = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || "[]"); return Array.isArray(value) ? value.filter((entry) => entry?.id && entry?.name) : []; } catch { return []; } }
function storeLocal(views) { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(views)); }
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

export default function SpendSavedViews({ rows, tombstonedIds, query, filters, onLoad, onHasViews }) {
  const auth = useAuth(); const remote = Boolean(auth?.authVersion === "dbi-pages-auth-v1" && auth?.enabled && auth?.user && !auth?.staticHost);
  const [views, setViews] = useState(() => typeof window === "undefined" ? [] : readLocal()); const [name, setName] = useState(""); const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  const counts = useMemo(() => new Map(views.map((entry) => [entry.id, remote ? Number(entry.unreadCount || 0) : unreadForView(rows, entry, tombstonedIds)])), [remote, rows, tombstonedIds, views]);
  useEffect(() => { onHasViews?.(views.length > 0); }, [onHasViews, views.length]);
  const refresh = useCallback(async () => {
    if (!remote) { setViews(readLocal()); return; }
    const payload = await auth.listAcquisitionSavedViews(); let next = payload.views || []; const local = readLocal();
    if (!next.length && local.length) {
      next = [];
      for (const entry of local) next.push((await auth.createAcquisitionSavedView({ name: entry.name, query: entry.query || "", filters: entry.filters || {}, alertMode: "none" })).view);
      window.localStorage.removeItem(STORAGE_KEY);
    }
    setViews(next); setError("");
  }, [auth, remote]);
  useEffect(() => { let active = true; const timer = window.setTimeout(() => { void refresh().catch((requestError) => { if (active) setError(requestError.message); }); }, 0); return () => { active = false; window.clearTimeout(timer); }; }, [refresh]);
  async function save() {
    setBusy(true); setError(""); const savedAt = new Date().toISOString();
    try {
      if (remote) await auth.createAcquisitionSavedView({ name: name.trim() || `Explorer view ${views.length + 1}`, query, filters, alertMode: "none" });
      else { const next = [...views, { id: `spend-${Date.now()}`, name: name.trim() || `Explorer view ${views.length + 1}`, query, filters, savedAt, lastOpenedAt: savedAt, alertMode: "none" }]; setViews(next); storeLocal(next); }
      setName(""); if (remote) await refresh();
    } catch (requestError) { setError(requestError.message); } finally { setBusy(false); }
  }
  async function load(entry) { const opened = new Date().toISOString(); setError(""); try { if (remote) { await auth.updateAcquisitionSavedView(entry.id, { opened: true }); await refresh(); } else { const next = views.map((item) => item.id === entry.id ? { ...item, lastOpenedAt: opened } : item); setViews(next); storeLocal(next); } onLoad(entry); } catch (requestError) { setError(requestError.message); } }
  async function remove(entry) { setError(""); try { if (remote) { await auth.deleteAcquisitionSavedView(entry.id); await refresh(); } else { const next = views.filter((item) => item.id !== entry.id); setViews(next); storeLocal(next); } } catch (requestError) { setError(requestError.message); } }
  async function setAlert(entry, alertMode) { setError(""); try { if (remote) { await auth.updateAcquisitionSavedView(entry.id, { alertMode }); await refresh(); } else { const next = views.map((item) => item.id === entry.id ? { ...item, alertMode } : item); setViews(next); storeLocal(next); } } catch (requestError) { setError(requestError.message); } }
  return <details className="capture-saved-views spend-saved-views" data-spend-saved-views>
    <summary><Bookmark size={16} /><strong>Saved acquisition views</strong><span>{views.length}</span><small>{views.length ? `${[...counts.values()].reduce((total, value) => total + value, 0)} unread changes` : remote ? "Cross-device" : "Browser-local"}</small></summary>
    <div className="spend-saved-views__create"><label><span>View name</span><input value={name} onChange={(event) => setName(event.target.value)} placeholder={`Explorer view ${views.length + 1}`} /></label><button type="button" className="if-button if-button--secondary" onClick={() => void save()} disabled={busy}><Bookmark size={15} />{busy ? "Saving…" : "Save current view"}</button></div>
    {error ? <p className="if-alert if-alert--warning" role="status">{error}</p> : null}
    {views.length ? <div className="capture-saved-views__list">{views.map((entry) => <span key={entry.id}>
      <button type="button" onClick={() => void load(entry)}><b>{entry.name}</b><small>{counts.get(entry.id) ? `${counts.get(entry.id)} unread changes` : "No unread changes"}</small></button>
      <span className="spend-saved-views__alert"><Bell size={13} /><ControlSelect ariaLabel={`Alert preference for ${entry.name}`} value={entry.alertMode || "none"} options={[{ value: "none", label: "No alerts" }, { value: "daily", label: "Daily digest" }, { value: "immediate", label: "Immediate" }]} onChange={(value) => void setAlert(entry, value)} /></span>
      <button type="button" onClick={() => void remove(entry)} aria-label={`Delete saved view ${entry.name}`}><Trash2 size={14} /></button>
    </span>)}</div> : null}
  </details>;
}
