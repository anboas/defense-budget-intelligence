import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Database, RefreshCw, Settings2 } from "lucide-react";
import { ControlAsyncState, ControlDialog } from "control-surface-ui/react";
import { useAuth } from "./AuthContext.jsx";
import ControlSelect from "./ControlSelect.jsx";

const NOTICE_TYPES = [
  ["p", "Pre-solicitation"], ["a", "Award"], ["r", "Sources sought"], ["s", "Special notice"], ["o", "Solicitation"],
  ["g", "Sale of surplus"], ["k", "Combined synopsis / solicitation"], ["i", "Intent to bundle"], ["u", "Justification"],
];

function count(value) { return Number(value || 0).toLocaleString(); }
function when(value) { const date = new Date(value || ""); return Number.isNaN(date.getTime()) ? "Never" : date.toLocaleString(); }

export default function AcquisitionRuntimePanel({ onRefreshComplete }) {
  const auth = useAuth(); const available = Boolean(auth?.enabled && auth?.user && !auth?.staticHost); const canManage = Boolean(auth?.user?.canManageWorkspace);
  const workspaceId = auth?.user?.activeWorkspace?.id || "workspace"; const dialogRef = useRef(null);
  const [status, setStatus] = useState(null); const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [configOpen, setConfigOpen] = useState(false); const [draft, setDraft] = useState(null);
  const load = useCallback(async () => { if (!available) return; setStatus(await auth.getAcquisitionStatus()); setError(""); }, [auth, available]);
  const refresh = useCallback(async (trigger = "manual") => {
    setBusy(true); setError("");
    try { const result = await auth.refreshAcquisitionSource(trigger); await load(); await onRefreshComplete?.(result); }
    catch (requestError) { setError(requestError.message); await load().catch(() => {}); }
    finally { setBusy(false); }
  }, [auth, load, onRefreshComplete]);
  useEffect(() => { let active = true; const timer = window.setTimeout(() => { void load().catch((requestError) => { if (active) setError(requestError.message); }); }, 0); return () => { active = false; window.clearTimeout(timer); }; }, [load]);
  useEffect(() => {
    if (!status?.credential?.configured || !status?.config?.enabled || !status?.refresh?.due || !canManage || busy) return;
    const key = `dbi:acquisition-first-access:${workspaceId}:${new Date().toISOString().slice(0, 10)}`;
    if (window.sessionStorage.getItem(key)) return;
    window.sessionStorage.setItem(key, "started");
    const timer = window.setTimeout(() => void refresh("first_access"), 0);
    return () => window.clearTimeout(timer);
  }, [busy, canManage, refresh, status, workspaceId]);
  if (!available) return null;
  if (!status && !error) return <ControlAsyncState compact state="loading" title="Loading acquisition source status" message="Reading workspace history and source coverage." />;
  const quality = status?.quality || {}; const history = status?.durableHistory || {}; const archives = status?.archives || {}; const latest = status?.refresh?.latest; const config = status?.config || {};
  const openConfig = () => { setDraft({ ...config, noticeTypes: [...(config.noticeTypes || [])] }); setConfigOpen(true); };
  const saveConfig = async (event) => {
    event.preventDefault(); setBusy(true); setError("");
    try { await auth.updateAcquisitionConfig(draft); await load(); setConfigOpen(false); }
    catch (requestError) { setError(requestError.message); }
    finally { setBusy(false); }
  };
  const numberField = (key, label, hint, min, max, step = 1) => <label className="if-field"><span className="if-field__label">{label}</span><input className="if-input" type="number" min={min} max={max} step={step} value={draft?.[key] ?? ""} onChange={(event) => setDraft((current) => ({ ...current, [key]: Number(event.target.value) }))} /><small className="if-field__hint">{hint}</small></label>;
  return <>
    <details className="acquisition-runtime" data-acquisition-runtime>
      <summary><span>{status?.credential?.configured && latest?.status !== "failed" ? <CheckCircle2 size={17} /> : <AlertTriangle size={17} />}<strong>Acquisition source & coverage</strong></span><small>{status?.credential?.configured ? `${count(history.records)} durable records · ${config.enabled ? status.refresh.due ? "refresh due" : "current" : "automation paused"}` : "SAM.gov key not configured · no task will run"}</small></summary>
      <div className="acquisition-runtime__body">
        <div className="acquisition-runtime__metrics" aria-label="Durable acquisition coverage"><span><Database size={15} /><b>{count(history.records)}</b><small>Durable records</small></span><span><b>{count(history.changedToday || history.changed_today)}</b><small>Changed in 24h</small></span><span><b>{count(history.lifecycleLinks)}</b><small>Exact links</small></span><span><b>{count(quality.stale)}</b><small>Stale records</small></span></div>
        <div className="acquisition-runtime__status">
          <span><strong>SAM.gov</strong><small>{status?.credential?.configured ? `Workspace credential ••••${status.credential.lastFour}` : "No key. Scheduler skips this workspace before creating a run."}</small></span>
          <span><strong>{config.enabled ? status?.refresh?.schedule : "Automation paused"}</strong><small>{latest ? `Last ${latest.status} · ${when(latest.completedAt || latest.startedAt)}` : "No retained run yet"}{status?.refresh?.nextDueAt ? ` · next ${when(status.refresh.nextDueAt)}` : ""}</small></span>
          {canManage ? <span className="if-action-row__actions"><button type="button" className="if-btn if-btn--secondary" onClick={openConfig}><Settings2 size={15} />Configure</button><button type="button" className="if-btn if-btn--secondary" disabled={busy || !status?.credential?.configured} onClick={() => void refresh()}><RefreshCw size={15} className={busy ? "is-spinning" : ""} />{busy ? "Refreshing…" : "Refresh now"}</button></span> : null}
        </div>
        <div className="acquisition-runtime__quality"><strong>Data-quality queue</strong><span>{count(quality.missing_identifier)} missing identifiers</span><span>{count(quality.missing_office)} missing offices</span><span>{count(quality.missing_naics)} missing NAICS</span></div>
        <p><strong>Archive health:</strong> {count(archives.observations)} observations, {count(archives.changes)} field-change records, and {count(archives.deliveryAttempts)} delivery attempts retained outside the hot tables. Hot observation history is kept for {count(archives.observationRetentionDays || 365)} days; delivery attempts for {count(archives.deliveryRetentionDays || 180)} days.</p>
        <p>The hourly scheduler runs only due workspaces with automation enabled and an active workspace key. Requests are paced, retried with backoff, and bounded to {count((config.pageSize || 0) * (config.maxPages || 0))} records per run. Failed, rate-limited, or truncated reads preserve the prior verified corpus.</p>
        {status?.delivery?.pendingProvider ? <p className="if-alert if-alert--info" role="status">{count(status.delivery.pendingProvider)} alert delivery job{status.delivery.pendingProvider === 1 ? " is" : "s are"} retained until an outbound provider is configured. In-app alerts remain available.</p> : null}
        {error ? <p className="if-alert if-alert--warning" role="status">{error}</p> : null}
      </div>
    </details>
    {configOpen && draft ? <ControlDialog open onClose={() => setConfigOpen(false)} title="Configure SAM.gov ingestion" eyebrow="Workspace automation" summary="Set the source scope, schedule, and request budget for this workspace." size="wide" dialogRef={dialogRef} surfaceProps={{ "data-sam-ingestion-config": true }} footer={<><button type="button" className="if-btn" onClick={() => setConfigOpen(false)}>Cancel</button><button type="submit" form="sam-ingestion-config" className="if-btn if-btn--primary" disabled={busy}>{busy ? "Saving…" : "Save configuration"}</button></>}>
      <form id="sam-ingestion-config" className="if-form-grid" onSubmit={saveConfig}>
        <label className="if-checkbox if-field--full"><input type="checkbox" checked={draft.enabled} onChange={(event) => setDraft((current) => ({ ...current, enabled: event.target.checked }))} /><span><strong>Run unattended ingestion</strong><small>Pausing automation never revokes the key or removes retained records. Workspaces without an active key are always skipped.</small></span></label>
        <div className="if-field"><span className="if-field__label">Refresh cadence</span><ControlSelect ariaLabel="SAM.gov refresh cadence" value={String(draft.cadenceHours)} options={[["6", "Every 6 hours"], ["12", "Every 12 hours"], ["24", "Daily"], ["48", "Every 2 days"], ["168", "Weekly"]]} onChange={(value) => setDraft((current) => ({ ...current, cadenceHours: Number(value) }))} portalTarget={dialogRef} /></div>
        <label className="if-field"><span className="if-field__label">Organization scope</span><input className="if-input" value={draft.organizationName || ""} maxLength={240} onChange={(event) => setDraft((current) => ({ ...current, organizationName: event.target.value }))} /><small className="if-field__hint">Sent as SAM.gov organizationName. Default: DEPT OF DEFENSE.</small></label>
        {numberField("initialLookbackDays", "Initial lookback", "1–365 days for the first successful run.", 1, 365)}
        {numberField("incrementalLookbackDays", "Incremental overlap", "1–30 days to catch amended or delayed notices.", 1, 30)}
        {numberField("pageSize", "Records per request", "10–1,000. SAM.gov documents 1,000 as the maximum.", 10, 1000, 10)}
        {numberField("maxPages", "Maximum pages per run", "1–25 pages. Partial/truncated results are never applied.", 1, 25)}
        {numberField("requestIntervalMs", "Minimum request interval", "250–10,000 ms between pages.", 250, 10000, 250)}
        {numberField("maxRetries", "Retries per request", "0–6 retries with Retry-After or exponential backoff.", 0, 6)}
        <fieldset className="if-card if-field--full"><legend className="if-form-section-label">Notice types</legend><p className="if-field__hint">Leave every option clear to ingest all notice types.</p><div className="if-form-grid">{NOTICE_TYPES.map(([value, label]) => <label className="if-checkbox if-touch-target" key={value}><input type="checkbox" checked={(draft.noticeTypes || []).includes(value)} onChange={() => setDraft((current) => ({ ...current, noticeTypes: current.noticeTypes.includes(value) ? current.noticeTypes.filter((item) => item !== value) : [...current.noticeTypes, value] }))} /><span>{label}</span></label>)}</div></fieldset>
        <p className="if-detail-card__summary if-field--full">Per-run ceiling: <strong>{count((draft.pageSize || 0) * (draft.maxPages || 0))} records</strong>. Actual API requests may be higher only when a retry is required.</p>
      </form>
    </ControlDialog> : null}
  </>;
}
