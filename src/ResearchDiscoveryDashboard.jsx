import { useCallback, useEffect, useState } from "react";
import { Activity, AlertTriangle, Bot, CheckCircle2, Gauge, Play, RefreshCcw, Save, SearchCheck, ShieldCheck } from "lucide-react";
import { ControlAsyncState } from "control-surface-ui/react";
import { useAuth } from "./AuthContext.jsx";
import ControlSelect from "./ControlSelect.jsx";
import "./ResearchDiscoveryDashboard.css";

const number = (value) => Number(value || 0).toLocaleString();
const percent = (value) => `${Math.round(Number(value || 0) * 100)}%`;
const compactDate = (value) => value ? new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(value)) : "Not yet";
const duration = (run) => {
  if (!run?.startedAt) return "—";
  const end = run.completedAt ? Date.parse(run.completedAt) : Date.now();
  const seconds = Math.max(0, Math.round((end - Date.parse(run.startedAt)) / 1000));
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
};

function TrendChart({ runs }) {
  const rows = [...runs].reverse().slice(-20);
  const records = (run) => Number(run.claimsPublished || 0) + Number(run.entitiesPublished || 0) + Number(run.relationsPublished || 0);
  const maximum = Math.max(1, ...rows.map(records));
  const width = 640; const height = 190; const inset = 24;
  const x = (index) => rows.length < 2 ? width / 2 : inset + (index / (rows.length - 1)) * (width - inset * 2);
  const y = (value) => height - inset - (value / maximum) * (height - inset * 2);
  const points = rows.map((run, index) => `${x(index)},${y(records(run))}`).join(" ");
  return <article className="research-dashboard__chart" data-research-run-chart>
    <header><div><span>Published evidence</span><h3>Run throughput</h3></div><b>Last {rows.length} runs</b></header>
    {rows.length ? <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Published graph records per run. ${rows.map(records).join(", ")}`}>
      {[0, .5, 1].map((ratio) => <line key={ratio} x1={inset} x2={width - inset} y1={y(maximum * ratio)} y2={y(maximum * ratio)} />)}
      <polyline points={points} />
      {rows.map((run, index) => <circle key={run.id} cx={x(index)} cy={y(records(run))} r="4"><title>{`${compactDate(run.startedAt)}: ${records(run)} graph records (${run.claimsPublished} claims, ${run.entitiesPublished || 0} entities, ${run.relationsPublished || 0} relations), ${run.claimsHeld} held`}</title></circle>)}
    </svg> : <div className="research-dashboard__empty">Run history will appear after the first server-side cycle.</div>}
  </article>;
}

function ConfigField({ label, children, help }) {
  return <div className="research-dashboard__field"><span>{label}</span>{children}<small>{help}</small></div>;
}

export default function ResearchDiscoveryDashboard({ totalGaps = 0, totalOrganizations = 0 }) {
  const auth = useAuth();
  const [state, setState] = useState({ status: "loading", data: null, error: "" });
  const [draft, setDraft] = useState(null);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");

  const load = useCallback(async (quiet = false) => {
    if (auth?.staticHost) return;
    if (!quiet) setState((current) => ({ ...current, status: current.data ? "ready" : "loading", error: "" }));
    try {
      const data = await auth.getResearchOperations();
      setState({ status: "ready", data, error: "" });
      setDraft((current) => current || data.config);
    } catch (error) {
      setState((current) => ({ ...current, status: current.data ? "ready" : "error", error: error.message }));
    }
  }, [auth]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!state.data?.activeRun && busy !== "run") return undefined;
    const timer = window.setInterval(() => void load(true), 5000);
    return () => window.clearInterval(timer);
  }, [busy, load, state.data?.activeRun]);

  const update = (key, value) => setDraft((current) => ({ ...current, [key]: value }));
  const save = async (event) => {
    event.preventDefault(); setBusy("save"); setMessage("");
    try { const result = await auth.updateResearchOperationsConfig(draft); setDraft(result.config); setMessage("Research controls saved."); await load(true); }
    catch (error) { setMessage(error.message); } finally { setBusy(""); }
  };
  const runNow = async () => {
    setBusy("run"); setMessage("");
    try { const result = await auth.runResearchDiscovery(); setMessage(`Research run ${result.run.status}.`); await load(true); }
    catch (error) { setMessage(error.message); } finally { setBusy(""); }
  };

  if (auth?.staticHost) return <section className="research-dashboard" data-research-discovery-dashboard data-research-discovery-state="primary-only"><ControlAsyncState compact state="empty" icon={<Bot size={24} />} title="Server-side operations live on Cloudflare" message="Open the primary authenticated application to configure research speed, run discovery, and inspect live D1 run history." /></section>;
  if (state.status !== "ready") return <section className="research-dashboard" data-research-discovery-dashboard data-research-discovery-state={state.status}><ControlAsyncState compact state={state.status === "error" ? "error" : "loading"} icon={<Activity size={24} />} title={state.status === "error" ? "Research operations unavailable" : "Loading research operations"} message={state.error || "Loading server-side run history and controls."} /></section>;

  const { summary, runs, claims, activeRun, credentialAvailable } = state.data;
  const organizationCoverage = totalOrganizations ? Math.min(1, summary.organizationsExplored / totalOrganizations) : 0;
  const publishedShare = summary.claimsDiscovered ? summary.claimsPublished / summary.claimsDiscovered : 0;
  const graphRecordsPublished = Number(summary.claimsPublished || 0) + Number(summary.entitiesPublished || 0) + Number(summary.relationsPublished || 0);
  const recentRuns = runs.slice(0, 12);
  const funnel = [
    ["Targets", summary.targetsExplored], ["Sources", summary.sourcesExplored], ["Claims", summary.claimsDiscovered], ["Published", summary.claimsPublished],
  ];

  return <section className="research-dashboard" data-research-discovery-dashboard>
    <header className="research-dashboard__hero">
      <div><span>Server-side autonomous research</span><h2>Discovery operations</h2><p>Cloudflare schedules bounded OpenAI Responses API research, verifies official-source citations, and publishes exact additive evidence into the workspace overlay.</p></div>
      <div className="research-dashboard__actions"><span className={`if-badge ${credentialAvailable ? "if-badge--success" : "if-badge--warning"}`}>{credentialAvailable ? "Credential ready" : "Credential required"}</span><button type="button" className="if-btn if-btn--primary" onClick={runNow} disabled={Boolean(busy) || Boolean(activeRun) || !credentialAvailable}><Play size={15} />{activeRun ? "Run active" : busy === "run" ? "Queuing…" : "Run now"}</button></div>
    </header>

    {message || state.error ? <div className="research-dashboard__notice" role="status">{state.error || message}</div> : null}
    {activeRun ? <article className="research-dashboard__active" data-active-research-run={activeRun.id}><RefreshCcw size={20} className="is-spinning" /><div><strong>Run in progress</strong><span>{activeRun.stage.replaceAll("_", " ")} · {activeRun.targetsCompleted} of {activeRun.targetsPlanned || "?"} targets · {duration(activeRun)}</span></div><progress value={activeRun.targetsCompleted} max={Math.max(activeRun.targetsPlanned, 1)} /></article> : null}

    <div className="research-dashboard__metrics">
      <article><Gauge size={18} /><strong>{number(graphRecordsPublished)}</strong><span>graph records added</span><small>{number(summary.claimsPublished)} claims · {number(summary.entitiesPublished)} entities · {number(summary.relationsPublished)} relations</small></article>
      <article><SearchCheck size={18} /><strong>{number(summary.organizationsExplored)}</strong><span>organizations explored</span><small>{percent(organizationCoverage)} of dossiers</small></article>
      <article><ShieldCheck size={18} /><strong>{number(summary.gapsResolved)}</strong><span>gaps resolved</span><small>{number(summary.gapsExplored)} investigated</small></article>
      <article><CheckCircle2 size={18} /><strong>{percent(summary.successRate)}</strong><span>run success rate</span><small>{number(summary.successfulRuns)} of {number(summary.runs)} runs</small></article>
      <article><Activity size={18} /><strong>{number(summary.sourcesExplored)}</strong><span>official sources</span><small>{number(summary.targetsExplored)} target attempts</small></article>
      <article><AlertTriangle size={18} /><strong>{number(summary.claimsHeld + summary.conflictsHeld)}</strong><span>held findings</span><small>{number(summary.duplicatesSuppressed)} duplicates suppressed</small></article>
    </div>

    <div className="research-dashboard__progress-grid">
      <article><header><strong>Research-gap exploration</strong><span>{number(summary.gapsExplored)} / {number(totalGaps)}</span></header><progress value={summary.gapsExplored} max={Math.max(totalGaps, 1)} /><small>Distinct registered gaps attempted at least once.</small></article>
      <article><header><strong>Organization coverage</strong><span>{number(summary.organizationsExplored)} / {number(totalOrganizations)}</span></header><progress value={summary.organizationsExplored} max={Math.max(totalOrganizations, 1)} /><small>Distinct dossiers reached by a server-side run.</small></article>
      <article><header><strong>Publication yield</strong><span>{percent(publishedShare)}</span></header><progress value={summary.claimsPublished} max={Math.max(summary.claimsDiscovered, 1)} /><small>Exact cited claims automatically published.</small></article>
    </div>

    <div className="research-dashboard__analytics">
      <TrendChart runs={runs} />
      <article className="research-dashboard__funnel"><header><div><span>Evidence funnel</span><h3>Exploration to publication</h3></div><b>{number(summary.claimsHeld)} held</b></header><div>{funnel.map(([label, value], index) => <div key={label}><span>{label}</span><i style={{ width: `${Math.max(8, (value / Math.max(funnel[0][1], 1)) * 100)}%` }} /><strong>{number(value)}</strong>{index < funnel.length - 1 ? <em>{percent(value ? funnel[index + 1][1] / value : 0)} next-stage yield</em> : null}</div>)}</div></article>
    </div>

    <form className="research-dashboard__config" onSubmit={save} data-research-config>
      <header><div><span>Speed and cost controls</span><h3>Research configuration</h3><p>Defaults use GPT-5 nano with low reasoning. Increase batch size and concurrency for throughput; increase cadence to reduce spend.</p></div><button type="submit" className="if-btn if-btn--secondary" disabled={Boolean(busy)}><Save size={14} />{busy === "save" ? "Saving…" : "Save controls"}</button></header>
      <div className="research-dashboard__fields">
        <ConfigField label="Enabled" help="Allow scheduled cycles"><ControlSelect ariaLabel="Research scheduler status" value={draft.enabled ? "yes" : "no"} options={[["yes", "Enabled"], ["no", "Paused"]]} onChange={(value) => update("enabled", value === "yes")} /></ConfigField>
        <ConfigField label="Cadence" help="Minimum time between runs"><ControlSelect ariaLabel="Research cadence" value={String(draft.cadenceMinutes)} options={[[15,"15 minutes"],[30,"30 minutes"],[60,"Hourly"],[120,"Every 2 hours"],[240,"Every 4 hours"],[720,"Every 12 hours"],[1440,"Daily"]].map(([value, label]) => [String(value), label])} onChange={(value) => update("cadenceMinutes", Number(value))} /></ConfigField>
        <ConfigField label="Targets per run" help="1 to 20 gaps"><input aria-label="Targets per research run" type="number" min="1" max="20" value={draft.batchSize} onChange={(event) => update("batchSize", Number(event.target.value))} /></ConfigField>
        <ConfigField label="Concurrency" help="1 to 5 simultaneous targets"><input aria-label="Research concurrency" type="number" min="1" max="5" value={draft.concurrency} onChange={(event) => update("concurrency", Number(event.target.value))} /></ConfigField>
        <ConfigField label="Sources per target" help="Official sources retained"><input aria-label="Sources per research target" type="number" min="1" max="8" value={draft.maxSourcesPerTarget} onChange={(event) => update("maxSourcesPerTarget", Number(event.target.value))} /></ConfigField>
        <ConfigField label="Claims per target" help="Strict maximum output"><input aria-label="Claims per research target" type="number" min="1" max="6" value={draft.maxClaimsPerTarget} onChange={(event) => update("maxClaimsPerTarget", Number(event.target.value))} /></ConfigField>
        <ConfigField label="Revisit delay" help="Hours before retrying a gap"><input aria-label="Research gap revisit delay" type="number" min="12" max="720" value={draft.revisitAfterHours} onChange={(event) => update("revisitAfterHours", Number(event.target.value))} /></ConfigField>
        <ConfigField label="Model" help="GPT-5 nano is cheapest"><ControlSelect ariaLabel="Research model" value={draft.model} options={[["gpt-5-nano", "GPT-5 nano"], ["gpt-5.4-nano", "GPT-5.4 nano"], ["gpt-5.4-mini", "GPT-5.4 mini"]]} onChange={(value) => update("model", value)} /></ConfigField>
        <ConfigField label="Reasoning" help="Low optimizes search cost"><ControlSelect ariaLabel="Research reasoning" value={draft.reasoningEffort} options={[["low", "Low"], ["medium", "Medium"]]} onChange={(value) => update("reasoningEffort", value)} /></ConfigField>
        <ConfigField label="Publication" help="Exact cited claims only"><ControlSelect ariaLabel="Research publication policy" value={draft.autoPublish ? "auto" : "hold"} options={[["auto", "Auto-publish exact"], ["hold", "Hold all findings"]]} onChange={(value) => update("autoPublish", value === "auto")} /></ConfigField>
      </div>
    </form>

    <div className="research-dashboard__lists">
      <article className="research-dashboard__runs"><header><div><span>Durable run ledger</span><h3>Recent cycles</h3></div><button type="button" className="if-btn" onClick={() => void load()}><RefreshCcw size={14} />Refresh</button></header><div>{recentRuns.length ? recentRuns.map((run) => <div key={run.id} data-research-run={run.id}><span className={`research-dashboard__status is-${run.status}`}>{run.status}</span><span><strong>{compactDate(run.startedAt)}</strong><small>{run.trigger} · {run.model} · {duration(run)}</small></span><b>{Number(run.claimsPublished || 0) + Number(run.entitiesPublished || 0) + Number(run.relationsPublished || 0)} records</b><small>{run.claimsPublished} claims · {run.entitiesPublished || 0} entities · {run.relationsPublished || 0} relations</small></div>) : <p>No completed runs yet.</p>}</div></article>
      <article className="research-dashboard__claims"><header><div><span>Publication ledger</span><h3>Recent findings</h3></div><b>{number(summary.claimsPublished)} total</b></header><div>{claims.length ? claims.slice(0, 20).map((claim) => <article key={claim.id} data-research-claim={claim.id}><div><span className={`if-badge ${claim.status === "published" ? "if-badge--success" : "if-badge--warning"}`}>{claim.status}</span><small>{claim.claimType} · {claim.confidence}</small></div><strong>{claim.label}</strong><p>{claim.value?.value || claim.value?.label || "Structured evidence"}</p><footer><span>{claim.dossierId}</span><time>{compactDate(claim.createdAt)}</time></footer></article>) : <p>No findings recorded yet.</p>}</div></article>
    </div>
  </section>;
}
