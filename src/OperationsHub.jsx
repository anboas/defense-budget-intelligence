import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Activity,
  Bot,
  CalendarDays,
  Building2,
  ChevronRight,
  Database,
  Link2,
  MapPin,
  Maximize2,
  Minimize2,
  MonitorUp,
  Plus,
  ShieldCheck,
  Star,
  Trash2,
  UsersRound,
  X,
} from "lucide-react";
import sourceHealth from "./data/source-health.json";
import ProductMark from "./ProductMark.jsx";
import OperationalDataTable from "./OperationalDataTable.jsx";
import { AgentAccessPanel } from "./ProfilePage.jsx";
import { useAuth } from "./AuthContext.jsx";
import { applyProcurementChanges, assembleProcurementRecords, WORK_CATEGORY_BY_ID } from "./procurement-taxonomy.js";
import { useManagementState } from "./management-state.js";
import UserManagement from "./UserManagement.jsx";
import { SearchMultiSelect } from "./CaptureCalendar.jsx";

const VIEWS = [
  ["watchlist", "Watchlist", Star],
  ["events", "Events", CalendarDays],
  ["integrations", "Integrations", Database],
  ["activity", "API Log", Activity],
  ["users", "Users", UsersRound],
  ["agents", "Agent Access", Bot],
  ["wallboard", "Wallboard", MonitorUp],
];

const VIEW_COPY = {
  watchlist: ["Management", "Watchlist", "Tracked records, private notes, review dates, and wallboard visibility."],
  events: ["Management", "Events", "Operator meetings, checkpoints, linked records, and display timing."],
  integrations: ["Administration", "Integrations", "Connector health, refresh cadence, yields, and unavailable probes."],
  activity: ["Administration", "API & activity log", "Append-only human and agent changes across the shared workspace."],
  users: ["Administration", "Users", "Human accounts, roles, status, sessions, and password recovery."],
  agents: ["Administration", "Agent access", "Issue and govern narrowly scoped credentials for trusted agents."],
};

const ADMIN_VIEWS = VIEWS.filter(([id]) => id !== "wallboard");
const ADMIN_ROUTES = {
  watchlist: "#/budget-spend/watchlist",
  events: "#/budget-spend/events",
  integrations: "#/budget-spend/integrations",
  users: "#/budget-spend/users",
  agents: "#/budget-spend/agents",
  activity: "#/budget-spend/api-log",
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
  const auth = useAuth();
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
    attendees: [],
    attendeeIds: [],
    wallboard: true,
  });
  const [directory, setDirectory] = useState([]);
  const [directoryError, setDirectoryError] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
    return () => { if (dialog?.open) dialog.close(); };
  }, []);
  useEffect(() => {
    if (!auth?.enabled || !auth?.user || !auth?.listDirectory) return undefined;
    let active = true;
    void auth.listDirectory().then((result) => {
      if (!active) return;
      setDirectory(result.users || []);
      setDirectoryError("");
    }).catch((requestError) => { if (active) setDirectoryError(requestError.message); });
    return () => { active = false; };
  }, [auth]);
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
          <div className="ops-attendee-picker ops-field--wide">
            <SearchMultiSelect title="Attendees" allLabel="Select workspace users" value={JSON.stringify(draft.attendeeIds || [])} options={directory.map((user) => ({ value: user.id, label: user.title ? `${user.displayName} · ${user.title}` : user.displayName }))} onChange={(attendeeIds) => setDraft((value) => ({ ...value, attendeeIds }))} portalTarget={dialogRef} />
            {directoryError ? <small role="alert">User directory unavailable: {directoryError}</small> : !directory.length ? <small>No active workspace users available.</small> : null}
          </div>
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
  const watchById = new Map(watchlist.map((entry) => [entry.recordId, entry]));
  const columns = [
    { key: "record", label: "Tracked record", required: true, sticky: true, minWidth: 300, value: (record) => record.id, searchValue: (record) => [record.id, record.title, record.party, record.portfolio, record.reference], render: (record) => <a className="dbi-table-record-link" href={`#/budget-spend/transactions?capRecord=${encodeURIComponent(record.opportunityId)}`}><b>{record.id}</b><strong>{record.title}</strong><small>{record.party || record.portfolio} · {WORK_CATEGORY_BY_ID.get(record.workCategory)?.label || "Unclassified work"}</small></a> },
    { key: "work", label: "Type of work", facet: true, minWidth: 150, value: (record) => WORK_CATEGORY_BY_ID.get(record.workCategory)?.label || "Unclassified work" },
    { key: "date", label: "Next published date", minWidth: 130, value: (record) => nextPublishedDate(record, asOf) || "Not scheduled", render: (record) => compactDate(nextPublishedDate(record, asOf)) },
    { key: "observed", label: "Observed", sortValue: recordAmount, exportValue: recordAmount, render: (record) => <strong>{money(recordAmount(record))}</strong> },
    { key: "review", label: "Review", minWidth: 150, sortValue: (record) => watchById.get(record.opportunityId)?.reviewAt || "", render: (record) => { const watch = watchById.get(record.opportunityId); return <input aria-label={`Review date for ${record.title}`} type="date" value={String(watch?.reviewAt || "").slice(0, 10)} onChange={(event) => updateWatch(record.opportunityId, { reviewAt: event.target.value })} />; } },
    { key: "wallboard", label: "Wallboard", facet: true, minWidth: 120, value: (record) => watchById.get(record.opportunityId)?.wallboard ? "Shown" : "Hidden", render: (record) => { const watch = watchById.get(record.opportunityId); return <label className="ops-switch"><input type="checkbox" checked={watch?.wallboard !== false} onChange={(event) => updateWatch(record.opportunityId, { wallboard: event.target.checked })} /><span>{watch?.wallboard !== false ? "Shown" : "Hidden"}</span></label>; } },
    { key: "actions", label: "Actions", role: "actions", required: true, sortable: false, render: (record) => <div className="dbi-table-actions"><button type="button" className="ops-icon-button is-starred" onClick={() => toggleWatch(record.opportunityId)} aria-label={`Stop tracking ${record.title}`}><Star size={17} fill="currentColor" />Untrack</button></div> },
  ];
  return (
    <section className="ops-panel" data-ops-watchlist>
      <header className="ops-panel__header"><div><span>Stable-ID working set</span><h2>Tracked records</h2></div></header>
      {rows.length ? <OperationalDataTable id="watchlist" label="Tracked records" rows={rows} columns={columns} rowKey={(record) => record.opportunityId} defaultSort={{ key: "date", direction: "asc" }} queryValue={query} onQueryChange={setQuery} searchPlaceholder="Search tracked records…" exportFilename="tracked-records.csv" wrapperProps={{ "data-ops-watch-table": true }} renderDetail={(record) => { const watch = watchById.get(record.opportunityId); return <label className="dbi-table-note"><span>Private workspace note</span><textarea key={watch?.updatedAt} defaultValue={watch?.note || ""} placeholder="Add a private note…" onBlur={(event) => { if (event.target.value !== (watch?.note || "")) updateWatch(record.opportunityId, { note: event.target.value }); }} /></label>; }} /> : <div className="ops-empty"><Star size={22} /><strong>No tracked records yet</strong><p>Use the star on any Transactions Gantt row to build this working set.</p><a href="#/budget-spend/transactions">Open Transactions</a></div>}
    </section>
  );
}

function EventsView({ events, records, onAdd, onEdit, onDelete }) {
  const byId = new Map(records.map((record) => [record.opportunityId, record]));
  const columns = [
    { key: "title", label: "Event", required: true, sticky: true, minWidth: 260, value: (event) => event.title, searchValue: (event) => [event.title, event.notes, event.location], render: (event) => <><strong>{event.title}</strong><small>{event.location || "Location not set"}</small></> },
    { key: "starts", label: "Starts", minWidth: 160, value: (event) => event.startsAt, render: (event) => dateTime(event.startsAt) },
    { key: "ends", label: "Ends", minWidth: 160, value: (event) => event.endsAt || event.startsAt, render: (event) => dateTime(event.endsAt || event.startsAt) },
    { key: "status", label: "Status", facet: true, value: (event) => event.status || "scheduled", render: (event) => <span className={`dbi-status-badge is-${event.status || "scheduled"}`}>{event.status || "scheduled"}</span> },
    { key: "display", label: "Wallboard", facet: true, value: (event) => event.wallboard ? "Shown" : "Hidden" },
    { key: "records", label: "Linked records", minWidth: 180, value: (event) => event.recordIds.map((id) => byId.get(id)?.id).filter(Boolean).join(" · ") || "No linked records" },
    { key: "actions", label: "Actions", role: "actions", required: true, sortable: false, render: (event) => <div className="dbi-table-actions"><button type="button" onClick={() => onEdit(event)}>Edit</button><button type="button" className="is-danger" aria-label={`Delete ${event.title}`} onClick={() => onDelete(event.id)}><Trash2 size={14} />Delete</button></div> },
  ];
  return <section className="ops-panel" data-ops-events><header className="ops-panel__header"><div><span>Operator schedule</span><h2>Events</h2></div></header>{events.length ? <OperationalDataTable id="events" label="Operator events" rows={events} columns={columns} rowKey={(event) => event.id} defaultSort={{ key: "starts", direction: "asc" }} searchPlaceholder="Search events, locations, attendees, and notes…" exportFilename="operator-events.csv" toolbarActions={<button type="button" className="if-btn if-btn--primary" onClick={onAdd}><Plus size={15} />Add event</button>} wrapperProps={{ "data-ops-event-table": true }} renderDetail={(event) => <div className="dbi-table-detail-grid"><article><span>Attendees</span><strong>{event.attendees?.map((attendee) => attendee.displayName).join(" · ") || "None assigned"}</strong></article><article><span>Notes</span><strong>{event.notes || "No notes"}</strong></article><article><span>Linked record IDs</span><strong>{event.recordIds.join(" · ") || "None"}</strong></article></div>} /> : <div className="ops-empty"><CalendarDays size={22} /><strong>No operator events</strong><p>Add meetings, checkpoints, or reviews and optionally publish them to the wallboard.</p><button type="button" className="ops-primary" onClick={onAdd}><Plus size={15} />Add event</button></div>}</section>;
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
  const columns = [
    { key: "name", label: "Integration", required: true, sticky: true, minWidth: 230, value: (row) => row.name, render: (row) => <><strong>{row.name}</strong><small>{row.detail}</small></> },
    { key: "status", label: "Status", facet: true, minWidth: 110, value: (row) => row.status, render: (row) => <span className={`dbi-status-badge is-${String(row.status).toLowerCase().replaceAll(" ", "-")}`}>{row.status}</span> },
    { key: "count", label: "Current yield", minWidth: 150, value: (row) => row.count, render: (row) => <strong>{row.count}</strong> },
    { key: "health", label: "Health checked", value: () => dateTime(sourceHealth.metadata?.checkedAt) },
  ];
  return <section className="ops-panel" data-ops-integrations><header className="ops-panel__header"><div><span>Connector operations</span><h2>Integrations</h2></div><a href="#/budget-spend/sources">Open full lineage<ChevronRight size={15} /></a></header><IntegrationFreshness budgetGeneratedAt={budgetGeneratedAt} awardGeneratedAt={awardGeneratedAt} /><div className="ops-integration-summary"><article><strong>{sourceHealth.totals?.online || 0}</strong><span>sources online</span></article><article><strong>{sourceHealth.totals?.unavailable || 0}</strong><span>unavailable at probe</span></article><article><strong>{dateTime(sourceHealth.metadata?.checkedAt)}</strong><span>health checked</span></article></div><OperationalDataTable id="integrations" label="Integration status" rows={rows} columns={columns} rowKey={(row) => row.name} defaultSort={{ key: "name", direction: "asc" }} searchPlaceholder="Search integrations and feed details…" exportFilename="integration-status.csv" selectable={false} wrapperProps={{ "data-ops-integration-table": true }} /></section>;
}

function ActivityView({ activity, records, remote }) {
  const byId = new Map(records.map((record) => [record.opportunityId, record]));
  const columns = [
    { key: "at", label: "Time", required: true, sticky: true, minWidth: 170, value: (entry) => entry.at, render: (entry) => dateTime(entry.at) },
    { key: "type", label: "Event", facet: true, minWidth: 150, value: (entry) => entry.type.replaceAll("_", " "), render: (entry) => <strong>{entry.type.replaceAll("_", " ")}</strong> },
    { key: "detail", label: "Detail", minWidth: 280, role: "prose", value: (entry) => entry.detail },
    { key: "actor", label: "Actor", facet: true, minWidth: 130, value: (entry) => entry.actorType || "operator", render: (entry) => <><strong>{entry.actorType || "operator"}</strong>{entry.actorId ? <small>{entry.actorId}</small> : null}</> },
    { key: "record", label: "Record", minWidth: 210, value: (entry) => byId.get(entry.recordId)?.id || entry.recordId || "Not linked", render: (entry) => { const record = byId.get(entry.recordId); return record ? <a className="dbi-table-record-link" href={`#/budget-spend/transactions?capRecord=${encodeURIComponent(record.opportunityId)}`}><strong>{record.id}</strong><small>{record.title}</small></a> : (entry.recordId || "Not linked"); } },
  ];
  return <section className="ops-panel" data-ops-activity><header className="ops-panel__header"><div><span>Append-only {remote ? "workspace" : "browser"} history</span><h2>API & activity log</h2></div><small>{activity.length} retained events</small></header>{activity.length ? <OperationalDataTable id="api-activity" label="API and activity log" rows={activity} columns={columns} rowKey={(entry) => entry.id} defaultSort={{ key: "at", direction: "desc" }} searchPlaceholder="Search events, actors, details, and record IDs…" exportFilename="api-activity-log.csv" selectable={false} wrapperProps={{ "data-ops-activity-table": true }} /> : <div className="ops-empty"><Activity size={22} /><strong>No API or operator activity</strong><p>Human and agent changes will be recorded here.</p></div>}</section>;
}

function WallboardView({ records, watchlist, events, asOf }) {
  const [mode, setMode] = useState("events");
  const [rotate, setRotate] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [clock, setClock] = useState(() => new Date().toISOString());
  const ref = useRef(null);
  const watchById = new Map(watchlist.map((entry) => [entry.recordId, entry]));
  const visibleRecords = records.filter((record) => watchById.get(record.opportunityId)?.wallboard).sort((a, b) => (nextPublishedDate(a, asOf) || "9999").localeCompare(nextPublishedDate(b, asOf) || "9999"));
  const upcomingEvents = events.filter((event) => event.wallboard && event.status === "scheduled" && (event.endsAt || event.startsAt) >= clock).sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  useEffect(() => {
    if (!rotate) return undefined;
    const timer = window.setInterval(() => setMode((value) => value === "overview" ? "events" : value === "events" ? "records" : "overview"), 15000);
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
      <nav aria-label="Wallboard view"><button type="button" className={mode === "overview" ? "is-active" : ""} onClick={() => setMode("overview")}>Overview</button><button type="button" className={mode === "records" ? "is-active" : ""} onClick={() => setMode("records")}>Tracked records</button><button type="button" className={mode === "events" ? "is-active" : ""} onClick={() => setMode("events")}>Events</button></nav>
      <div><button type="button" aria-pressed={rotate} onClick={() => setRotate((value) => !value)}>{rotate ? "Auto-cycle on" : "Auto-cycle off"}</button><button type="button" aria-pressed={isFullscreen} onClick={toggleFullscreen}>{isFullscreen ? <Minimize2 size={17} /> : <Maximize2 size={17} />}{isFullscreen ? "Exit kiosk" : "Enter kiosk"}</button></div>
    </div>
    <div className="ops-wallboard__metrics" aria-label="Wallboard summary">
      <article><span>Tracked records</span><strong>{visibleRecords.length}</strong><small>Enabled for this display</small></article>
      <article><span>Upcoming events</span><strong>{upcomingEvents.length}</strong><small>Scheduled operator activity</small></article>
      <article><span>Reviews within 30 days</span><strong>{reviewsDue}</strong><small>Workspace review dates</small></article>
      <article><span>Source health</span><strong>{sourceHealth.totals?.online || 0}/{sourceHealth.totals?.targets || 0}</strong><small>Feeds online at last probe</small></article>
    </div>
    {mode === "overview" ? <div className="ops-wallboard__split"><WallboardRecords records={visibleRecords.slice(0, 8)} asOf={asOf} watchById={watchById} /><WallboardSchedule events={upcomingEvents.slice(0, 5)} /></div> : mode === "events" ? <WallboardSchedule events={upcomingEvents.slice(0, 6)} now={now} focus /> : <WallboardRecords records={visibleRecords.slice(0, 12)} asOf={asOf} watchById={watchById} />}
  </section>;
}

function eventCountdown(event, now) {
  const startsAt = new Date(event.startsAt);
  const endsAt = new Date(event.endsAt || event.startsAt);
  if (now >= startsAt && now <= endsAt) return { value: "LIVE", label: "Underway now", tone: "live" };
  const days = Math.max(0, Math.ceil((startsAt.getTime() - now.getTime()) / 86400000));
  return { value: String(days), label: days === 1 ? "Day to go" : "Days to go", tone: days <= 14 ? "urgent" : days <= 45 ? "watch" : "steady" };
}

function WallboardEventCard({ event, index, now }) {
  const countdown = eventCountdown(event, now);
  const start = new Date(event.startsAt);
  const attendees = event.attendees || [];
  return <article className={`ops-wall-event ops-wall-event--${countdown.tone}`} data-wallboard-event-card>
    <div className="ops-wall-event__topline"><span>{String(index + 1).padStart(2, "0")}</span><strong>{countdown.tone === "live" ? "Live" : "Tracking"}</strong><ShieldCheck size={15} aria-label="Wallboard approved" /></div>
    <div className="ops-wall-event__countdown"><strong>{countdown.value}</strong><span>{countdown.label}</span></div>
    <div className="ops-wall-event__body">
      <time dateTime={event.startsAt}>{start.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</time>
      <h3>{event.title}</h3>
      <p><MapPin size={14} aria-hidden="true" /><span>{event.location || "Location not set"}</span></p>
      {attendees.length ? <p className="ops-wall-event__attendees"><UsersRound size={14} aria-hidden="true" /><span>{attendees.map((attendee) => attendee.displayName).join(" · ")}</span></p> : null}
    </div>
    <footer><span><Link2 size={13} aria-hidden="true" /><b>{event.recordIds?.length || 0}</b> pursuits</span><span><Building2 size={13} aria-hidden="true" /><b>0</b> organizations</span><span><UsersRound size={13} aria-hidden="true" /><b>{attendees.length}</b> attendees</span></footer>
  </article>;
}

function WallboardSchedule({ events, focus = false, now = new Date() }) {
  return <section className={`ops-wallboard__section ops-wallboard__section--schedule${focus ? " ops-wallboard__section--event-focus" : ""}`}><header><div><span>Operator schedule</span><strong>Upcoming events</strong></div><b>{events.length}</b></header>{events.length ? focus ? <div className="ops-wallboard__event-grid">{events.map((event, index) => <WallboardEventCard key={event.id} event={event} index={index} now={now} />)}</div> : <div className="ops-wallboard__cards">{events.map((event) => {
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
  const auth = useAuth();
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
    {view !== "wallboard" ? <section className="if-admin-control-surface admin-console" data-admin-control-surface data-admin-workspace>
      <header className="admin-console__header">
        <div>
          <span>Admin control center</span>
          <h2>Workspace administration</h2>
          <p>One place for tracked work, operator events, source health, agent credentials, and the shared audit trail.</p>
        </div>
        <span className={`admin-console__status ${state.remote ? "is-connected" : "is-local"}`}><i aria-hidden="true" />{state.remote ? "D1 workspace" : "Browser-local fallback"}</span>
      </header>
      <div className="admin-console__metrics" aria-label="Administration summary">
        <article><span>Tracked</span><strong>{state.watchlist.length}</strong><small>records</small></article>
        <article><span>Reviews due</span><strong>{dueReviews}</strong><small>within 30 days</small></article>
        <article><span>Events</span><strong>{state.events.length}</strong><small>scheduled</small></article>
        <article><span>Sources online</span><strong>{sourceHealth.totals?.online || 0}/{sourceHealth.totals?.targets || 0}</strong><small>last probe</small></article>
      </div>
      <nav className="admin-console__nav" aria-label="Administration sections">
        {ADMIN_VIEWS.filter(([id]) => !["users", "agents"].includes(id) || (id === "users" ? auth?.user?.canManageUsers : auth?.user?.canManageAgents)).map(([id, label, Icon]) => <a key={id} href={ADMIN_ROUTES[id]} className={view === id ? "is-active" : ""} aria-current={view === id ? "page" : undefined}><Icon size={15} aria-hidden="true" /><span>{label}</span></a>)}
      </nav>
      <div className="admin-console__context" aria-live="polite"><span>{copy[0]}</span><strong>{copy[1]}</strong><small>{copy[2]}</small></div>
    </section> : null}
    {state.error ? <p className="ops-alert" role="alert">Workspace sync failed: {state.error}</p> : null}
    {view === "watchlist" ? <WatchlistView rows={watchedRecords} watchlist={state.watchlist} asOf={dataset.metadata.asOf} query={query} setQuery={setQuery} toggleWatch={state.toggleWatch} updateWatch={state.updateWatch} /> : null}
    {view === "events" ? <EventsView events={state.events} records={watchedRecords} onAdd={() => setEditor({ mode: "add" })} onEdit={(event) => setEditor({ mode: "edit", event })} onDelete={state.deleteEvent} /> : null}
    {view === "integrations" ? <IntegrationsView dataset={dataset} samOpportunities={samOpportunities} manualProcurement={manualProcurement} procurementDelta={procurementDelta} subawardSnapshot={subawardSnapshot} budgetGeneratedAt={budgetGeneratedAt} awardGeneratedAt={awardGeneratedAt} /> : null}
    {view === "activity" ? <ActivityView activity={state.activity} records={records} remote={state.remote} /> : null}
    {view === "users" ? auth?.user?.canManageUsers ? <UserManagement auth={auth} /> : <section className="ops-panel ops-empty" data-users-unavailable><UsersRound size={22} /><strong>Administrator access required</strong><p>Your role cannot manage human accounts.</p></section> : null}
    {view === "agents" ? auth?.user?.canManageAgents ? <AgentAccessPanel auth={auth} embedded /> : <section className="ops-panel ops-empty" data-profile-agents-unavailable><Bot size={22} /><strong>Administrator access required</strong><p>Your role cannot issue or revoke agent credentials.</p></section> : null}
    {view === "wallboard" ? <WallboardView records={records} watchlist={state.watchlist} events={state.events} asOf={dataset.metadata.asOf} /> : null}
    {editor ? <EventEditor event={editor.mode === "edit" ? editor.event : null} records={watchedRecords} onSave={state.saveEvent} onClose={() => setEditor(null)} /> : null}
    {view !== "wallboard" ? <section className="operations-boundary"><Database size={17} /><p><strong>State boundary:</strong> {state.remote ? "stars, notes, review dates, events, and activity are stored in the authenticated D1 workspace and shared with scoped agents." : "this static fallback stores stars, notes, review dates, events, and activity only in this browser."} Operator state never changes source-backed evidence, public JSON, evidence exports, or shareable record URLs.</p></section> : null}
  </div>;
}
