import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Database, RefreshCw } from "lucide-react";
import { ControlAsyncState } from "control-surface-ui/react";
import { useAuth } from "./AuthContext.jsx";

function count(value) { return Number(value || 0).toLocaleString(); }
function when(value) { const date = new Date(value || ""); return Number.isNaN(date.getTime()) ? "Never" : date.toLocaleString(); }

export default function AcquisitionRuntimePanel({ onRefreshComplete }) {
  const auth = useAuth(); const available = Boolean(auth?.enabled && auth?.user && !auth?.staticHost); const canManage = Boolean(auth?.user?.canManageWorkspace);
  const workspaceId = auth?.user?.activeWorkspace?.id || "workspace";
  const [status, setStatus] = useState(null); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const load = useCallback(async () => { if (!available) return; setStatus(await auth.getAcquisitionStatus()); setError(""); }, [auth, available]);
  const refresh = useCallback(async (trigger = "manual") => {
    setBusy(true); setError("");
    try { const result = await auth.refreshAcquisitionSource(trigger); await load(); await onRefreshComplete?.(result); }
    catch (requestError) { setError(requestError.message); await load().catch(() => {}); }
    finally { setBusy(false); }
  }, [auth, load, onRefreshComplete]);
  useEffect(() => { let active = true; const timer = window.setTimeout(() => { void load().catch((requestError) => { if (active) setError(requestError.message); }); }, 0); return () => { active = false; window.clearTimeout(timer); }; }, [load]);
  useEffect(() => {
    if (!status?.credential?.configured || !status?.refresh?.due || !canManage || busy) return;
    const key = `dbi:acquisition-first-access:${workspaceId}:${new Date().toISOString().slice(0, 10)}`;
    if (window.sessionStorage.getItem(key)) return;
    window.sessionStorage.setItem(key, "started");
    const timer = window.setTimeout(() => void refresh("first_access"), 0);
    return () => window.clearTimeout(timer);
  }, [busy, canManage, refresh, status, workspaceId]);
  if (!available) return null;
  if (!status && !error) return <ControlAsyncState compact state="loading" title="Loading acquisition source status" message="Reading workspace history and source coverage." />;
  const quality = status?.quality || {}; const history = status?.durableHistory || {}; const latest = status?.refresh?.latest;
  return <details className="acquisition-runtime" data-acquisition-runtime>
    <summary>
      <span>{status?.credential?.configured && latest?.status !== "failed" ? <CheckCircle2 size={17} /> : <AlertTriangle size={17} />}<strong>Acquisition source & coverage</strong></span>
      <small>{status?.credential?.configured ? `${count(history.records)} durable records · ${status.refresh.due ? "refresh due" : "current"}` : "SAM.gov key not configured"}</small>
    </summary>
    <div className="acquisition-runtime__body">
      <div className="acquisition-runtime__metrics" aria-label="Durable acquisition coverage">
        <span><Database size={15} /><b>{count(history.records)}</b><small>Durable records</small></span>
        <span><b>{count(history.changedToday || history.changed_today)}</b><small>Changed in 24h</small></span>
        <span><b>{count(history.lifecycleLinks)}</b><small>Exact links</small></span>
        <span><b>{count(quality.stale)}</b><small>Stale records</small></span>
      </div>
      <div className="acquisition-runtime__status">
        <span><strong>SAM.gov</strong><small>{status?.credential?.configured ? `Workspace credential ••••${status.credential.lastFour}` : "Add the key in Connections → Credentials when ready"}</small></span>
        <span><strong>Last refresh</strong><small>{latest ? `${latest.status} · ${when(latest.completedAt || latest.startedAt)}` : "No retained run yet"}</small></span>
        {canManage ? <button type="button" className="if-button if-button--secondary" disabled={busy || !status?.credential?.configured} onClick={() => void refresh()}><RefreshCw size={15} className={busy ? "is-spinning" : ""} />{busy ? "Refreshing…" : "Refresh now"}</button> : null}
      </div>
      <div className="acquisition-runtime__quality"><strong>Data-quality queue</strong><span>{count(quality.missing_identifier)} missing identifiers</span><span>{count(quality.missing_office)} missing offices</span><span>{count(quality.missing_naics)} missing NAICS</span></div>
      <p>Daily due-state is active. Until a dedicated Cloudflare Cron Worker is attached, a due refresh starts on the first manager visit or by using Refresh now. Failed or truncated source reads preserve the prior verified corpus.</p>
      {error ? <p className="if-alert if-alert--warning" role="status">{error}</p> : null}
    </div>
  </details>;
}
