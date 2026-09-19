import { useEffect, useMemo, useState } from "react";
import { Bookmark, Trash2 } from "lucide-react";

const STORAGE_KEY = "dbi:spend-saved-views:v1";

function readViews() {
  try {
    const value = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || "[]");
    return Array.isArray(value) ? value.filter((entry) => entry?.id && entry?.name) : [];
  } catch {
    return [];
  }
}

function storeViews(views) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(views));
}

function matches(record, view, tombstonedIds) {
  const filters = view.filters || {};
  const query = String(view.query || "").trim().toLowerCase();
  const searchable = [record.title, record.id, record.reference, record.party, record.recipient, record.portfolio, record.organization?.path?.join(" "), ...(record.technologyAreas || [])].filter(Boolean).join(" ").toLowerCase();
  const tombstoned = tombstonedIds.has(record.opportunityId);
  return (filters.disposition === "tombstoned" ? tombstoned : !tombstoned)
    && (!query || searchable.includes(query))
    && (!filters.technology || filters.technology === "all" || (record.technologyAreas || []).includes(filters.technology))
    && (!filters.branch || filters.branch === "all" || record.organization?.branch === filters.branch)
    && (!filters.component || filters.component === "all" || record.organization?.component === filters.component)
    && (!filters.office || filters.office === "all" || record.organization?.office === filters.office);
}

function unreadForView(rows, view, tombstonedIds) {
  const boundary = Date.parse(view.lastViewedAt || view.savedAt || 0);
  if (!Number.isFinite(boundary)) return 0;
  return rows.filter((record) => matches(record, view, tombstonedIds) && Date.parse(record.lastChangedAt || record.firstSeenAt || 0) > boundary).length;
}

export default function SpendSavedViews({ rows, tombstonedIds, query, filters, onLoad, onHasViews }) {
  const [views, setViews] = useState(readViews);
  const [name, setName] = useState("");
  const counts = useMemo(() => new Map(views.map((view) => [view.id, unreadForView(rows, view, tombstonedIds)])), [rows, tombstonedIds, views]);
  useEffect(() => { onHasViews?.(views.length > 0); }, [onHasViews, views.length]);

  const replace = (next) => {
    setViews(next);
    storeViews(next);
  };
  const save = () => {
    const savedAt = new Date().toISOString();
    const next = [...views, { id: `spend-${Date.now()}`, name: name.trim() || `Explorer view ${views.length + 1}`, query, filters, savedAt, lastViewedAt: savedAt }];
    replace(next);
    setName("");
  };
  const load = (view) => {
    const viewedAt = new Date().toISOString();
    replace(views.map((entry) => entry.id === view.id ? { ...entry, lastViewedAt: viewedAt } : entry));
    onLoad(view);
  };

  return <details className="capture-saved-views spend-saved-views" data-spend-saved-views>
    <summary><Bookmark size={16} /><strong>Saved acquisition views</strong><span>{views.length}</span><small>{views.length ? `${[...counts.values()].reduce((total, value) => total + value, 0)} unread changes` : "Browser-local"}</small></summary>
    <div className="spend-saved-views__create">
      <label><span>View name</span><input value={name} onChange={(event) => setName(event.target.value)} placeholder={`Explorer view ${views.length + 1}`} /></label>
      <button type="button" className="if-button if-button--secondary" onClick={save}><Bookmark size={15} />Save current view</button>
    </div>
    {views.length ? <div className="capture-saved-views__list">{views.map((view) => <span key={view.id}>
      <button type="button" onClick={() => load(view)}><b>{view.name}</b><small>{counts.get(view.id) ? `${counts.get(view.id)} unread changes` : "No unread changes"}</small></button>
      <button type="button" onClick={() => replace(views.filter((entry) => entry.id !== view.id))} aria-label={`Delete saved view ${view.name}`}><Trash2 size={14} /></button>
    </span>)}</div> : null}
  </details>;
}
