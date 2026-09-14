import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Activity,
  CalendarDays,
  ChevronRight,
  Database,
  Maximize2,
  Minimize2,
  MonitorUp,
  Plus,
  Search,
  Star,
  Trash2,
  X,
} from "lucide-react";
import sourceHealth from "./data/source-health.json";
import ProductMark from "./ProductMark.jsx";
import { applyProcurementChanges, assembleProcurementRecords, WORK_CATEGORY_BY_ID } from "./procurement-taxonomy.js";
import { useManagementState } from "./management-state.js";

const VIEWS = [
  ["watchlist", "Watchlist", Star],
  ["events", "Events", CalendarDays],
  ["integrations", "Integrations", Database],
  ["activity", "API Log", Activity],
  ["wallboard", "Wallboard", MonitorUp],
];

const VIEW_COPY = {
  watchlist: ["Management", "Watchlist", "Tracked records, private notes, review dates, and wallboard visibility."],
  events: ["Management", "Events", "Operator meetings, checkpoints, linked records, and display timing."],
  integrations: ["Administration", "Integrations", "Connector health, refresh cadence, yields, and unavailable probes."],
  activity: ["Administration", "API & activity log", "Append-only human and agent changes across the shared workspace."],
};

function compactDate(value) {
  if (!value) return "Not scheduled";
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return "Not scheduled";
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

function dateTime(value) {
  const date = new Date(value || "");
  if (Number.isNaN(date.getTime())) return "Unavailable";
  return date.toLocaleString([], { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
}

function freshnessState(timestamp, maxAgeDays) {
  if (!timestamp) return { label: "Unavailable", tone: "unavailable" };
  const ageDays = Math.max(0, (Date.now() - new Date(timestamp).getTime()) / 86400000);
  return ageDays <= maxAgeDays ? { label: "Current", tone: "current" } : { label: "Review", tone: "stale" };
}

function IntegrationFreshness({ budgetGeneratedAt, awardGeneratedAt }) {
  const layers = [
    { id: "budget", label: "Budget books", mobileLabel: "Budget", at: budgetGeneratedAt, maxAgeDays: 400 },
    { id: "awards", label: "Award execution", mobileLabel: "Awards", at: awardGeneratedAt, maxAgeDays: 14 },
    { id: "health", label: "Source health", mobileLabel: "Sources", at: sourceHealth.metadata.checkedAt, maxAgeDays: 7 },
  ];
  return <section className="freshness-strip" aria-label="Data freshness" data-freshness-strip data-integration-freshness>{layers.map((layer) => {
    const state = freshnessState(layer.at, layer.maxAgeDays);
    return <span key={layer.id} className={`freshness-chip freshness-chip--${state.tone}`} title={`${layer.label}: ${state.label} · ${layer.at ? dateTime(layer.at) : "No snapshot"}`}><strong data-mobile-label={layer.mobileLabel}>{layer.label}</strong><em>{state.label}</em><small>{layer.at ? dateTime(layer.at) : "No snapshot"}</small></span>;
  })}</section>;
}

function money(value) {
  const amount = Number(value || 0);
  if (!amount) return "$0";
  if (Math.abs(amount) >= 1e9) return `$${(amount / 1e9).toFixed(1)}B`;
  if (Math.abs(amount) >= 1e6) return `$${(amount / 1e6).toFixed(1)}M`;
  if (Math.abs(amount) >= 1e3) return `$${(amount / 1e3).toFixed(0)}K`;
  return `$${amount.toLocaleString()}`;
}

function recordAmount(record) {
  return Number(record.liveAward?.awardAmountDollars || record.obligatedAmount || record.fpdsObligatedAmount || 0);
}

function futureRecordDates(record, asOf) {
  const dated = [
    ...(record.events || []).flatMap((event) => [event.start, event.end]),
    ...(record.milestones || []).flatMap((event) => [event.start, event.end]),
    record.solicitationEnd,
    record.currentEnd,
    record.potentialEnd,
  ].filter((value) => value && value >= asOf);
  return [...new Set(dated)].sort();
}

function nextPublishedDate(record, asOf) {
  return futureRecordDates(record, asOf)[0] || "";
}

function EventEditor({ event, records, onSave, onClose }) {
  const dialogRef = useRef(null);
  const [draft, setDraft] = useState(() => event || {
    id: `event-${Date.now()}`,
    title: "",
    startsAt: new Date(Date.now() + 86400000).toISOString().slice(0, 16),
    endsAt: "",
    location: "",
    notes: "",
    status: "scheduled",
    recordIds: [],
    wallboard: true,
  });
  const [error, setError] = useState("");
  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
    return () => { if (dialog?.open) dialog.close(); };
  }, []);
  const linked = new Set(draft.recordIds || []);
  function submit(formEvent) {
    formEvent.preventDefault();
    if (!draft.title.trim() || !draft.startsAt) {
      setError("Title and start time are required.");
      return;
    }
    if (draft.endsAt && new Date(draft.endsAt) < new Date(draft.startsAt)) {
      setError("End time must be after the start time.");
      return;
    }
    onSave({ ...draft, updatedAt: new Date().toISOString() });
    onClose();
  }
  return createPortal(
    <dialog ref={dialogRef} className="ops-dialog" aria-labelledby="ops-event-title" onCancel={(e) => { e.preventDefault(); onClose(); }} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <form className="ops-dialog__surface" onSubmit={submit} data-ops-event-editor>
        <header><div><span>Workspace schedule</span><h2 id="ops-event-title">{event ? "Edit event" : "Add event"}</h2></div><button type="button" onClick={onClose} aria-label="Close event editor"><X size={18} /></button></header>
        <div className="ops-event-form">
          {error ? <p role="alert" className="ops-alert">{error}</p> : null}
          <label className="ops-field ops-field--wide"><span>Title</span><input autoFocus value={draft.title} onChange={(e) => setDraft((value) => ({ ...value, title: e.target.value }))} /></label>
          <label className="ops-field"><span>Starts</span><input type="datetime-local" value={String(draft.startsAt || "").slice(0, 16)} onChange={(e) => setDraft((value) => ({ ...value, startsAt: e.target.value }))} /></label>
          <label className="ops-field"><span>Ends</span><input type="datetime-local" value={String(draft.endsAt || "").slice(0, 16)} onChange={(e) => setDraft((value) => ({ ...value, endsAt: e.target.value }))} /></label>
          <label className="ops-field"><span>Location / link</span><input value={draft.location} onChange={(e) => setDraft((value) => ({ ...value, location: e.target.value }))} /></label>
          <label className="ops-field"><span>Status</span><select value={draft.status} onChange={(e) => setDraft((value) => ({ ...value, status: e.target.value }))}><option value="scheduled">Scheduled</option><option value="completed">Completed</option><option value="cancelled">Cancelled</option></select></label>
          <label className="ops-field ops-field--wide"><span>Notes</span><textarea value={draft.notes} onChange={(e) => setDraft((value) => ({ ...value, notes: e.target.value }))} /></label>
          <label className="ops-check ops-field--wide"><input type="checkbox" checked={draft.wallboard !== false} onChange={(e) => setDraft((value) => ({ ...value, wallboard: e.target.checked }))} /><span><b>Show on wallboard</b><small>Read-only display projection</small></span></label>
          <fieldset className="ops-event-links ops-field--wide"><legend>Linked watched records</legend>{records.length ? records.map((record) => <label key={record.opportunityId}><input type="checkbox" checked={linked.has(record.opportunityId)} onChange={() => setDraft((value) => ({ ...value, recordIds: linked.has(record.opportunityId) ? value.recordIds.filter((id) => id !== record.opportunityId) : [...value.recordIds, record.opportunityId] }))} /><span><b>{record.id}</b>{record.title}</span></label>) : <p>Star records in Transactions to link them here.</p>}</fieldset>
        </div>
        <footer><button type="button" onClick={onClose}>Cancel</button><button type="submit">Save event</button></footer>
      </form>
    </dialog>,
    document.body,
  );
}

function WatchlistView({ rows, watchlist, asOf, query, setQuery, toggleWatch, updateWatch }) {
  const filtered = rows.filter((record) => !query || [record.id, record.title, record.party, record.portfolio, record.reference].join(" ").toLowerCase().includes(query.toLowerCase()));
  const watchById = new Map(watchlist.map((entry) => [entry.recordId, entry]));
  return (
    <section className="ops-panel" data-ops-watchlist>
      <header className="ops-panel__header"><div><span>Stable-ID working set</span><h2>Tracked records</h2></div><label className="ops-search"><Search size={15} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search tracked records" /></label></header>
      {filtered.length ? <div className="ops-watch-table"><table><thead><tr><th>Record</th><th>Next published date</th><th>Observed</th><th>Review</th><th>Wallboard</th><th><span className="sr-only">Actions</span></th></tr></thead><tbody>{filtered.map((record) => {
        const watch = watchById.get(record.opportunityId);
        return <tr key={record.opportunityId} data-ops-watch-row={record.opportunityId}><td><a href={`#/budget-spend/transactions?capRecord=${encodeURIComponent(record.opportunityId)}`}><b>{record.id}</b><strong>{record.title}</strong><small>{record.party || record.portfolio} · {WORK_CATEGORY_BY_ID.get(record.workCategory)?.label || "Unclassified work"}</small></a><details><summary>Note</summary><textarea key={watch.updatedAt} defaultValue={watch.note} placeholder="Private workspace note" onBlur={(e) => { if (e.target.value !== watch.note) updateWatch(record.opportunityId, { note: e.target.value }); }} /></details></td><td>{compactDate(nextPublishedDate(record, asOf))}</td><td>{money(recordAmount(record))}</td><td><input aria-label={`Review date for ${record.title}`} type="date" value={String(watch.reviewAt || "").slice(0, 10)} onChange={(e) => updateWatch(record.opportunityId, { reviewAt: e.target.value })} /></td><td><label className="ops-switch"><input type="checkbox" checked={watch.wallboard} onChange={(e) => updateWatch(record.opportunityId, { wallboard: e.target.checked })} /><span>{watch.wallboard ? "Shown" : "Hidden"}</span></label></td><td><button type="button" className="ops-icon-button is-starred" onClick={() => toggleWatch(record.opportunityId)} aria-label={`Stop tracking ${record.title}`}><Star size={17} fill="currentColor" /></button></td></tr>;
      })}</tbody></table></div> : <div className="ops-empty"><Star size={22} /><strong>{rows.length ? "No tracked records match" : "No tracked records yet"}</strong><p>{rows.length ? "Clear the search to restore the complete watchlist." : "Use the star on any Transactions Gantt row to build this working set."}</p><a href="#/budget-spend/transactions">Open Transactions</a></div>}
    </section>
  );
}

function EventsView({ events, records, onAdd, onEdit, onDelete }) {
  const byId = new Map(records.map((record) => [record.opportunityId, record]));
  const sorted = [...events].sort((a, b) => new Date(a.startsAt) - new Date(b.startsAt));
  return <section className="ops-panel" data-ops-events><header className="ops-panel__header"><div><span>Operator schedule</span><h2>Events</h2></div><button type="button" className="ops-primary" onClick={onAdd}><Plus size={15} />Add event</button></header>{sorted.length ? <div className="ops-event-list">{sorted.map((event) => <article key={event.id}><time>{dateTime(event.startsAt)}</time><div><span>{event.status}{event.wallboard ? " · wallboard" : ""}</span><strong>{event.title}</strong><p>{event.location || "Location not set"}</p><small>{event.recordIds.map((id) => byId.get(id)?.id).filter(Boolean).join(" · ") || "No linked records"}</small></div><div><button type="button" onClick={() => onEdit(event)}>Edit</button><button type="button" aria-label={`Delete ${event.title}`} onClick={() => onDelete(event.id)}><Trash2 size={15} /></button></div></article>)}</div> : <div className="ops-empty"><CalendarDays size={22} /><strong>No operator events</strong><p>Add meetings, checkpoints, or reviews and optionally publish them to the wallboard.</p></div>}</section>;
}

function IntegrationsView({ dataset, samOpportunities, manualProcurement, procurementDelta, subawardSnapshot, budgetGeneratedAt, awardGeneratedAt }) {
  const rows = [
    { name: "PDB display books", status: "current", count: "3,888 request lines", detail: "Scheduled workbook and justification build" },
    { name: "USAspending prime awards", status: "current", count: `${dataset.metadata?.coverage?.totalPublicRecords?.toLocaleString?.() || "875"} assembled records`, detail: "Automatic award feed plus normalized source records" },
    { name: "FPDS actions", status: "current", count: `${Number(dataset.metadata?.coverage?.fpdsActions || 0).toLocaleString()} actions`, detail: "Deferred exact action payload" },
    { name: "USAspending subawards", status: subawardSnapshot.metadata?.status || "unavailable", count: `${Number(subawardSnapshot.metadata?.reportedSubawardCount || 0).toLocaleString()} reported`, detail: `${Number(subawardSnapshot.metadata?.failedPrimeCount || 0).toLocaleString()} unavailable prime probes disclosed` },
    { name: "SAM.gov opportunities", status: samOpportunities.metadata?.status || "unavailable", count: `${Number(samOpportunities.metadata?.recordCount || samOpportunities.records?.length || 0).toLocaleString()} records`, detail: "Credentialed rolling-window importer" },
    { name: "Manual / CRM imports", status: "ready", count: `${Number(manualProcurement.records?.length || 0).toLocaleString()} records`, detail: "Stable procurement identifiers required" },
    { name: "Change detection", status: procurementDelta.metadata?.status || "baseline", count: `${Number(procurementDelta.summary?.added || 0) + Number(procurementDelta.summary?.updated || 0)} changes`, detail: "Deterministic consecutive-snapshot comparison" },
  ];
  return <section className="ops-panel" data-ops-integrations><header className="ops-panel__header"><div><span>Connector operations</span><h2>Integrations</h2></div><a href="#/budget-spend/sources">Open full lineage<ChevronRight size={15} /></a></header><IntegrationFreshness budgetGeneratedAt={budgetGeneratedAt} awardGeneratedAt={awardGeneratedAt} /><div className="ops-integration-summary"><article><strong>{sourceHealth.totals?.online || 0}</strong><span>sources online</span></article><article><strong>{sourceHealth.totals?.unavailable || 0}</strong><span>unavailable at probe</span></article><article><strong>{dateTime(sourceHealth.metadata?.checkedAt)}</strong><span>health checked</span></article></div><div className="ops-integration-list">{rows.map((row) => <article key={row.name}><i className={`is-${String(row.status).toLowerCase().replaceAll(" ", "-")}`} /><div><strong>{row.name}</strong><span>{row.detail}</span></div><b>{row.count}</b><em>{row.status}</em></article>)}</div></section>;
}

function ActivityView({ activity, records, remote }) {
  const byId = new Map(records.map((record) => [record.opportunityId, record]));
  return <section className="ops-panel" data-ops-activity><header className="ops-panel__header"><div><span>Append-only {remote ? "workspace" : "browser"} history</span><h2>API & activity log</h2></div><small>{activity.length} retained events</small></header>{activity.length ? <ol className="ops-activity-list">{activity.map((entry) => { const record = byId.get(entry.recordId); return <li key={entry.id}><i /><time>{dateTime(entry.at)}</time><div><strong>{entry.type.replaceAll("_", " ")}</strong><span>{entry.detail}</span>{entry.actorType ? <small>{entry.actorType}{entry.actorId ? ` · ${entry.actorId}` : ""}</small> : null}{record ? <a href={`#/budget-spend/transactions?capRecord=${encodeURIComponent(record.opportunityId)}`}>{record.id} · {record.title}</a> : null}</div></li>; })}</ol> : <div className="ops-empty"><Activity size={22} /><strong>No API or operator activity</strong><p>Human and agent changes will be recorded here.</p></div>}</section>;
}

function WallboardView({ records, watchlist, events, asOf }) {
  const [mode, setMode] = useState("overview");
  const [rotate, setRotate] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [clock, setClock] = useState(() => new Date().toISOString());
  const ref = useRef(null);
  const watchById = new Map(watchlist.map((entry) => [entry.recordId, entry]));
  const visibleRecords = records.filter((record) => watchById.get(record.opportunityId)?.wallboard).sort((a, b) => (nextPublishedDate(a, asOf) || "9999").localeCompare(nextPublishedDate(b, asOf) || "9999"));
  const upcomingEvents = events.filter((event) => event.wallboard && event.status === "scheduled" && (event.endsAt || event.startsAt) >= clock).sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  useEffect(() => {
    if (!rotate) return undefined;
    const timer = window.setInterval(() => setMode((value) => value === "overview" ? "schedule" : value === "schedule" ? "records" : "overview"), 15000);
    return () => window.clearInterval(timer);
  }, [rotate]);
  useEffect(() => {
    const timer = window.setInterval(() => setClock(new Date().toISOString()), 60000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    const update = () => setIsFullscreen(document.fullscreenElement === ref.current);
    document.addEventListener("fullscreenchange", update);
    return () => document.removeEventListener("fullscreenchange", update);
  }, []);
  const reviewHorizon = useMemo(() => {
    const horizon = new Date(`${asOf}T00:00:00Z`);
    horizon.setUTCDate(horizon.getUTCDate() + 30);
    return horizon.toISOString().slice(0, 10);
  }, [asOf]);
  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen?.();
      else await ref.current?.requestFullscreen?.();
    } catch { /* The board remains usable without browser fullscreen permission. */ }
  }
  const now = new Date(clock);
  const reviewsDue = watchlist.filter((entry) => entry.reviewAt && entry.reviewAt >= asOf && entry.reviewAt <= reviewHorizon).length;
  return <section ref={ref} className="ops-wallboard" data-ops-wallboard data-wallboard-mode={mode} data-wallboard-fullscreen={isFullscreen ? "true" : "false"}>
    <header className="ops-wallboard__masthead">
      <div className="ops-wallboard__brand"><ProductMark eager /><div><span>Conference room display</span><h2>Defense Budget Intelligence</h2></div></div>
      <div className="ops-wallboard__time"><time dateTime={clock}><strong>{now.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</strong><span>{now.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" })}</span></time><small>Data through {compactDate(asOf)}</small></div>
    </header>
    <div className="ops-wallboard__toolbar">
      <nav aria-label="Wallboard view"><button type="button" className={mode === "overview" ? "is-active" : ""} onClick={() => setMode("overview")}>Overview</button><button type="button" className={mode === "records" ? "is-active" : ""} onClick={() => setMode("records")}>Tracked records</button><button type="button" className={mode === "schedule" ? "is-active" : ""} onClick={() => setMode("schedule")}>Schedule</button></nav>
      <div><button type="button" aria-pressed={rotate} onClick={() => setRotate((value) => !value)}>{rotate ? "Auto-cycle on" : "Auto-cycle off"}</button><button type="button" aria-pressed={isFullscreen} onClick={toggleFullscreen}>{isFullscreen ? <Minimize2 size={17} /> : <Maximize2 size={17} />}{isFullscreen ? "Exit kiosk" : "Enter kiosk"}</button></div>
    </div>
    <div className="ops-wallboard__metrics" aria-label="Wallboard summary">
      <article><span>Tracked records</span><strong>{visibleRecords.length}</strong><small>Enabled for this display</small></article>
      <article><span>Upcoming events</span><strong>{upcomingEvents.length}</strong><small>Scheduled operator activity</small></article>
      <article><span>Reviews within 30 days</span><strong>{reviewsDue}</strong><small>Workspace review dates</small></article>
      <article><span>Source health</span><strong>{sourceHealth.totals?.online || 0}/{sourceHealth.totals?.targets || 0}</strong><small>Feeds online at last probe</small></article>
    </div>
    {mode === "overview" ? <div className="ops-wallboard__split"><WallboardRecords records={visibleRecords.slice(0, 8)} asOf={asOf} watchById={watchById} /><WallboardSchedule events={upcomingEvents.slice(0, 5)} /></div> : mode === "schedule" ? <WallboardSchedule events={upcomingEvents.slice(0, 12)} /> : <WallboardRecords records={visibleRecords.slice(0, 12)} asOf={asOf} watchById={watchById} />}
  </section>;
}

function WallboardSchedule({ events }) {
  return <section className="ops-wallboard__section ops-wallboard__section--schedule"><header><div><span>Operator schedule</span><strong>Upcoming events</strong></div><b>{events.length}</b></header>{events.length ? <div className="ops-wallboard__cards">{events.map((event) => {
    const start = new Date(event.startsAt);
    return <article key={event.id} className="ops-wallboard__event"><div className="ops-wallboard__date"><span>{start.toLocaleDateString([], { month: "short" })}</span><strong>{start.getDate()}</strong></div><div><time dateTime={event.startsAt}>{start.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</time><strong>{event.title}</strong><span>{event.location || "Location not set"}</span></div></article>;
  })}</div> : <div className="ops-wallboard__empty"><CalendarDays size={30} /><strong>No upcoming events</strong><p>Scheduled wallboard events will appear here.</p></div>}</section>;
}

function WallboardRecords({ records, asOf, watchById }) {
  return <section className="ops-wallboard__section ops-wallboard__section--records"><header><div><span>Stable-ID watchlist</span><strong>Tracked records</strong></div><b>{records.length}</b></header>{records.length ? <div className="ops-wallboard__cards">{records.map((record) => {
    const nextDate = nextPublishedDate(record, asOf);
    const reviewAt = watchById.get(record.opportunityId)?.reviewAt;
    return <article key={record.opportunityId} className="ops-wallboard__record"><div className="ops-wallboard__record-copy"><span>{record.id} · {record.portfolio}</span><strong>{record.title}</strong><small>{record.party || "Party not published"} · {money(recordAmount(record))}</small></div><div className="ops-wallboard__record-dates"><span>Next published date</span><time dateTime={nextDate}>{nextDate ? compactDate(nextDate) : "Not scheduled"}</time>{reviewAt ? <small>Review {compactDate(reviewAt)}</small> : null}</div></article>;
  })}</div> : <div className="ops-wallboard__empty"><Star size={30} /><strong>No tracked records</strong><p>Enable wallboard visibility from the Watchlist.</p></div>}</section>;
}

export default function OperationsHub({ view: requestedView = "watchlist", dataset, awards = [], samOpportunities = { metadata: {}, records: [] }, manualProcurement = { records: [] }, procurementDelta = { records: [], summary: {} }, subawardSnapshot = { metadata: {}, primes: [] }, budgetGeneratedAt = "", awardGeneratedAt = "" }) {
  const records = useMemo(() => applyProcurementChanges(assembleProcurementRecords(dataset.records || [], awards, dataset.metadata.asOf, samOpportunities.records || [], manualProcurement.records || [], subawardSnapshot), procurementDelta.records || []), [awards, dataset, manualProcurement.records, procurementDelta.records, samOpportunities.records, subawardSnapshot]);
  const state = useManagementState(records);
  const view = VIEWS.some(([id]) => id === requestedView) ? requestedView : "watchlist";
  const [query, setQuery] = useState("");
  const [editor, setEditor] = useState(null);
  const watchedRecords = state.watchlist.map((entry) => records.find((record) => record.opportunityId === entry.recordId)).filter(Boolean);
  const reviewHorizon = useMemo(() => {
    const horizon = new Date(`${dataset.metadata.asOf}T00:00:00Z`);
    horizon.setUTCDate(horizon.getUTCDate() + 30);
    return horizon.toISOString().slice(0, 10);
  }, [dataset.metadata.asOf]);
  const dueReviews = state.watchlist.filter((entry) => entry.reviewAt && entry.reviewAt <= reviewHorizon).length;
  const copy = VIEW_COPY[view];
  return <div className={`operations-hub operations-hub--${view}`} data-operations-hub data-operations-view={view}>
    {view !== "wallboard" ? <section className="operations-hero"><div><span>{copy[0]}</span><h2>{copy[1]}</h2><p>{copy[2]}</p></div><dl><div><dt>Tracked</dt><dd>{state.watchlist.length}</dd></div><div><dt>Review due</dt><dd>{dueReviews}</dd></div><div><dt>Events</dt><dd>{state.events.length}</dd></div><div><dt>Sources online</dt><dd>{sourceHealth.totals?.online || 0}</dd></div></dl></section> : null}
    {state.error ? <p className="ops-alert" role="alert">Workspace sync failed: {state.error}</p> : null}
    {view === "watchlist" ? <WatchlistView rows={watchedRecords} watchlist={state.watchlist} asOf={dataset.metadata.asOf} query={query} setQuery={setQuery} toggleWatch={state.toggleWatch} updateWatch={state.updateWatch} /> : null}
    {view === "events" ? <EventsView events={state.events} records={watchedRecords} onAdd={() => setEditor({ mode: "add" })} onEdit={(event) => setEditor({ mode: "edit", event })} onDelete={state.deleteEvent} /> : null}
    {view === "integrations" ? <IntegrationsView dataset={dataset} samOpportunities={samOpportunities} manualProcurement={manualProcurement} procurementDelta={procurementDelta} subawardSnapshot={subawardSnapshot} budgetGeneratedAt={budgetGeneratedAt} awardGeneratedAt={awardGeneratedAt} /> : null}
    {view === "activity" ? <ActivityView activity={state.activity} records={records} remote={state.remote} /> : null}
    {view === "wallboard" ? <WallboardView records={records} watchlist={state.watchlist} events={state.events} asOf={dataset.metadata.asOf} /> : null}
    {editor ? <EventEditor event={editor.mode === "edit" ? editor.event : null} records={watchedRecords} onSave={state.saveEvent} onClose={() => setEditor(null)} /> : null}
    {view !== "wallboard" ? <section className="operations-boundary"><Database size={17} /><p><strong>State boundary:</strong> {state.remote ? "stars, notes, review dates, events, and activity are stored in the authenticated D1 workspace and shared with scoped agents." : "this static fallback stores stars, notes, review dates, events, and activity only in this browser."} Operator state never changes source-backed evidence, public JSON, evidence exports, or shareable record URLs.</p></section> : null}
  </div>;
}
