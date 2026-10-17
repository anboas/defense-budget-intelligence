import { useCallback, useEffect, useMemo, useState } from "react";
import { Bookmark, Share2, Trash2 } from "lucide-react";
import { useAuth } from "./AuthContext.jsx";
import ControlSelect from "./ControlSelect.jsx";
import { normalizeStrategyConfig } from "./strategic-analysis.js";

const STORAGE_KEY = "dbi:strategy-saved-views:v1";

function readLocal() {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || "[]");
    return Array.isArray(parsed) ? parsed.filter((entry) => entry?.id && entry?.name && entry?.analysis?.kind === "strategy") : [];
  } catch { return []; }
}

function writeLocal(value) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
}

export default function StrategySavedViews({ analysis, onLoad }) {
  const auth = useAuth();
  const remote = Boolean(auth?.authVersion === "dbi-pages-auth-v1" && auth?.enabled && auth?.user && !auth?.staticHost);
  const [views, setViews] = useState(readLocal);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const ordered = useMemo(() => [...views].sort((left, right) => String(right.updatedAt || right.savedAt || "").localeCompare(String(left.updatedAt || left.savedAt || ""))), [views]);
  const refresh = useCallback(async () => {
    if (!remote) { setViews(readLocal()); return; }
    const payload = await auth.listAcquisitionSavedViews();
    setViews((payload.views || []).filter((entry) => entry.analysis?.kind === "strategy"));
  }, [auth, remote]);
  useEffect(() => { const timer = window.setTimeout(() => { void refresh().catch((error) => setMessage(error.message)); }, 0); return () => window.clearTimeout(timer); }, [refresh]);
  async function save() {
    setBusy(true); setMessage("");
    const savedAt = new Date().toISOString();
    const nextName = name.trim() || `Strategy view ${views.length + 1}`;
    try {
      if (remote) await auth.createAcquisitionSavedView({ name: nextName, query: "", filters: {}, analysis: normalizeStrategyConfig(analysis), alertMode: "none" });
      else {
        const next = [{ id: `strategy-${crypto.randomUUID?.() || Date.now()}`, name: nextName, analysis: normalizeStrategyConfig(analysis), savedAt, updatedAt: savedAt }, ...views];
        writeLocal(next); setViews(next);
      }
      setName(""); setMessage(`${nextName} saved`); if (remote) await refresh();
    } catch (error) { setMessage(error.message); } finally { setBusy(false); }
  }
  async function remove(id) {
    try {
      if (remote) { await auth.deleteAcquisitionSavedView(id); await refresh(); }
      else { const next = views.filter((entry) => entry.id !== id); writeLocal(next); setViews(next); }
    } catch (error) { setMessage(error.message); }
  }
  async function share() {
    const url = new URL(window.location.href);
    url.hash = window.location.hash;
    try { await navigator.clipboard.writeText(url.toString()); setMessage("Strategy link copied"); }
    catch { setMessage("Copy failed. Use the browser address bar."); }
  }
  return <section className="strategy-saved-views" data-strategy-saved-views>
    <ControlSelect compact ariaLabel="Saved strategy views" value="" options={[["", views.length ? `Saved views (${views.length})` : "Saved views"], ...ordered.map((entry) => [entry.id, entry.name])]} onChange={(id) => { const selected = views.find((entry) => entry.id === id); if (selected) onLoad(selected); }} />
    <label><span className="if-sr-only">Strategy view name</span><input value={name} maxLength={100} placeholder={`Strategy view ${views.length + 1}`} onChange={(event) => setName(event.target.value)} /></label>
    <button type="button" className="if-btn if-btn--secondary" disabled={busy} onClick={() => void save()}><Bookmark size={14} />{busy ? "Saving…" : "Save"}</button>
    <button type="button" className="if-btn if-btn--secondary if-btn--icon" aria-label="Copy strategy link" onClick={() => void share()}><Share2 size={14} /></button>
    {ordered.length ? <button type="button" className="if-btn if-btn--secondary if-btn--icon" aria-label={`Delete saved strategy view ${ordered[0].name}`} title={`Delete ${ordered[0].name}`} onClick={() => void remove(ordered[0].id)}><Trash2 size={14} /></button> : null}
    {message ? <span role="status">{message}</span> : null}
  </section>;
}
