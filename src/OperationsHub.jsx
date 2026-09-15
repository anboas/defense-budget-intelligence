import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Activity,
  Bot,
  CalendarDays,
  Building2,
  ChevronRight,
  ChevronLeft,
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
} from "lucide-react";
import sourceHealth from "./data/source-health.json";
import WorkspaceMark from "./WorkspaceMark.jsx";
import UserAvatar from "./UserAvatar.jsx";
import OperationalDataTable from "./OperationalDataTable.jsx";
import { AgentAccessPanel } from "./ProfilePage.jsx";
import { useAuth } from "./AuthContext.jsx";
import { applyProcurementChanges, assembleProcurementRecords, WORK_CATEGORY_BY_ID } from "./procurement-taxonomy.js";
import { useManagementState } from "./management-state.js";
import UserManagement from "./UserManagement.jsx";
import WorkspaceManagement from "./WorkspaceManagement.jsx";
import { SearchMultiSelect } from "./CaptureCalendar.jsx";
import OpenAiKeyManagement from "./OpenAiKeyManagement.jsx";
import ControlSelect from "./ControlSelect.jsx";
import { ControlDialog } from "control-surface-ui/react";

const VIEWS = [
  ["watchlist", "Watchlist", Star],
  ["events", "Events", CalendarDays],
  ["integrations", "Integrations", Database],
  ["activity", "API Log", Activity],
  ["users", "Users", UsersRound],
  ["workspaces", "Workspaces", Building2],
  ["workspace-settings", "Workspace settings", Building2],
  ["agents", "Agent Access", Bot],
  ["wallboard", "Wallboard", MonitorUp],
];

const VIEW_COPY = {
  watchlist: ["Management", "Watchlist", "Tracked records, private notes, review dates, and wallboard visibility."],
  events: ["Management", "Events", "Operator meetings, checkpoints, linked records, and display timing."],
  integrations: ["Administration", "Integrations", "Connector health, refresh cadence, yields, and unavailable probes."],
  activity: ["Administration", "API & activity log", "Append-only human and agent changes across the shared workspace."],
  users: ["Administration", "Users", "Human accounts, roles, status, sessions, and password recovery."],
  workspaces: ["Administration", "Workspaces", "Isolated data boundaries, membership, and access-request decisions."],
  "workspace-settings": ["Workspace", "Workspace settings", "Identity, membership, access requests, roles, and workspace inventory."],
  agents: ["Administration", "Agent access", "Issue and govern narrowly scoped credentials for trusted agents."],
};

const ADMIN_VIEWS = VIEWS.filter(([id]) => id !== "wallboard");
const ADMIN_ROUTES = {
  watchlist: "#/budget-spend/watchlist",
  events: "#/budget-spend/events",
  integrations: "#/budget-spend/integrations",
  users: "#/budget-spend/users",
  workspaces: "#/budget-spend/workspaces",
  "workspace-settings": "#/budget-spend/workspace",
  agents: "#/budget-spend/agents",
  activity: "#/budget-spend/api-log",
};

const EVENT_MILESTONE_TYPES = [
  ["registration_deadline", "Registration closes"],
  ["refund_deadline", "Refund deadline"],
  ["hotel_deadline", "Hotel cutoff"],
  ["exhibitor_deadline", "Exhibitor deadline"],
  ["submission_deadline", "Submission deadline"],
  ["other", "Other milestone"],
];

function milestoneTypeLabel(type) {
  return EVENT_MILESTONE_TYPES.find(([id]) => id === type)?.[1] || "Event milestone";
}

function milestoneLabel(milestone) {
  return milestone?.label || milestoneTypeLabel(milestone?.type);
}

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
    milestones: [],
    wallboard: true,
  });
  const [directory, setDirectory] = useState([]);
  const [directoryError, setDirectoryError] = useState("");
  const [error, setError] = useState("");
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
    if ((draft.milestones || []).some((milestone) => !milestone.occursAt || (milestone.type === "other" && !String(milestone.label || "").trim()))) {
      setError("Every milestone needs a date, and custom milestones also need a label.");
      return;
    }
    onSave({ ...draft, updatedAt: new Date().toISOString() });
    onClose();
  }
  return <ControlDialog
    open
    onClose={onClose}
    title={event ? "Edit event" : "Add event"}
    eyebrow="Workspace schedule"
    size="wide"
    dialogRef={dialogRef}
    closeLabel="Close event editor"
    surfaceProps={{ "data-ops-event-editor": true }}
    footer={<><button type="button" onClick={onClose}>Cancel</button><button type="submit" form="ops-event-editor-form">Save event</button></>}
  >
      <form id="ops-event-editor-form" className="ops-event-form" onSubmit={submit}>
          {error ? <p role="alert" className="ops-alert">{error}</p> : null}
          <label className="ops-field ops-field--wide"><span>Title</span><input autoFocus value={draft.title} onChange={(e) => setDraft((value) => ({ ...value, title: e.target.value }))} /></label>
          <label className="ops-field"><span>Starts</span><input type="datetime-local" value={String(draft.startsAt || "").slice(0, 16)} onChange={(e) => setDraft((value) => ({ ...value, startsAt: e.target.value }))} /></label>
          <label className="ops-field"><span>Ends</span><input type="datetime-local" value={String(draft.endsAt || "").slice(0, 16)} onChange={(e) => setDraft((value) => ({ ...value, endsAt: e.target.value }))} /></label>
          <label className="ops-field"><span>Location / link</span><input value={draft.location} onChange={(e) => setDraft((value) => ({ ...value, location: e.target.value }))} /></label>
          <div className="ops-field"><span>Status</span><ControlSelect ariaLabel="Event status" value={draft.status} options={[["scheduled", "Scheduled"], ["completed", "Completed"], ["cancelled", "Cancelled"]]} onChange={(status) => setDraft((value) => ({ ...value, status }))} portalTarget={dialogRef} /></div>
          <div className="ops-attendee-picker ops-field--wide">
            <SearchMultiSelect title="Attendees" allLabel="Select workspace users" value={JSON.stringify(draft.attendeeIds || [])} options={directory.map((user) => ({ value: user.id, label: user.title ? `${user.displayName} · ${user.title}` : user.displayName }))} onChange={(attendeeIds) => setDraft((value) => ({ ...value, attendeeIds }))} portalTarget={dialogRef} />
            {directoryError ? <small role="alert">User directory unavailable: {directoryError}</small> : !directory.length ? <small>No active workspace users available.</small> : null}
          </div>
          <label className="ops-field ops-field--wide"><span>Notes</span><textarea value={draft.notes} onChange={(e) => setDraft((value) => ({ ...value, notes: e.target.value }))} /></label>
          <fieldset className="ops-event-milestones ops-field--wide">
            <legend>Deadlines &amp; milestones</legend>
            <p>Add only published or operator-confirmed dates. Missing dates stay absent from the calendar.</p>
            <div className="ops-event-milestones__list">{(draft.milestones || []).map((milestone, index) => <div className="ops-event-milestone-row" key={milestone.id}>
              <div><span>Type</span><ControlSelect ariaLabel={`Milestone ${index + 1} type`} value={milestone.type} options={EVENT_MILESTONE_TYPES} onChange={(type) => setDraft((value) => ({ ...value, milestones: value.milestones.map((item) => item.id === milestone.id ? { ...item, type } : item) }))} portalTarget={dialogRef} /></div>
              <label><span>Date</span><input aria-label={`Milestone ${index + 1} date`} type="date" value={String(milestone.occursAt || "").slice(0, 10)} onChange={(e) => setDraft((value) => ({ ...value, milestones: value.milestones.map((item) => item.id === milestone.id ? { ...item, occursAt: e.target.value } : item) }))} /></label>
              <label className="ops-event-milestone-row__label"><span>Display label</span><input aria-label={`Milestone ${index + 1} label`} value={milestone.label || ""} placeholder={milestoneTypeLabel(milestone.type)} onChange={(e) => setDraft((value) => ({ ...value, milestones: value.milestones.map((item) => item.id === milestone.id ? { ...item, label: e.target.value } : item) }))} /></label>
              <label className="ops-event-milestone-row__notes"><span>Context</span><input aria-label={`Milestone ${index + 1} context`} value={milestone.notes || ""} placeholder="Optional source or policy note" onChange={(e) => setDraft((value) => ({ ...value, milestones: value.milestones.map((item) => item.id === milestone.id ? { ...item, notes: e.target.value } : item) }))} /></label>
              <button type="button" aria-label={`Remove milestone ${index + 1}`} onClick={() => setDraft((value) => ({ ...value, milestones: value.milestones.filter((item) => item.id !== milestone.id) }))}><Trash2 size={15} aria-hidden="true" /></button>
            </div>)}</div>
            <button type="button" className="ops-event-milestones__add" onClick={() => setDraft((value) => ({ ...value, milestones: [...(value.milestones || []), { id: `milestone-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, type: "registration_deadline", label: "", occursAt: "", notes: "" }] }))}><Plus size={15} aria-hidden="true" />Add deadline or milestone</button>
          </fieldset>
          <label className="ops-check ops-field--wide"><input type="checkbox" checked={draft.wallboard !== false} onChange={(e) => setDraft((value) => ({ ...value, wallboard: e.target.checked }))} /><span><b>Show on wallboard</b><small>Read-only display projection</small></span></label>
          <fieldset className="ops-event-links ops-field--wide"><legend>Linked watched records</legend>{records.length ? records.map((record) => <label key={record.opportunityId}><input type="checkbox" checked={linked.has(record.opportunityId)} onChange={() => setDraft((value) => ({ ...value, recordIds: linked.has(record.opportunityId) ? value.recordIds.filter((id) => id !== record.opportunityId) : [...value.recordIds, record.opportunityId] }))} /><span><b>{record.id}</b>{record.title}</span></label>) : <p>Star records in Transactions to link them here.</p>}</fieldset>
      </form>
  </ControlDialog>;
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
    { key: "title", label: "Event", required: true, sticky: true, minWidth: 260, value: (event) => event.title, searchValue: (event) => [event.title, event.notes, event.location, ...(event.milestones || []).flatMap((milestone) => [milestoneLabel(milestone), milestone.notes])], render: (event) => <><strong>{event.title}</strong><small>{event.location || "Location not set"}</small></> },
    { key: "starts", label: "Starts", minWidth: 160, value: (event) => event.startsAt, render: (event) => dateTime(event.startsAt) },
    { key: "ends", label: "Ends", minWidth: 160, value: (event) => event.endsAt || event.startsAt, render: (event) => dateTime(event.endsAt || event.startsAt) },
    { key: "status", label: "Status", facet: true, value: (event) => event.status || "scheduled", render: (event) => <span className={`dbi-status-badge is-${event.status || "scheduled"}`}>{event.status || "scheduled"}</span> },
    { key: "display", label: "Wallboard", facet: true, value: (event) => event.wallboard ? "Shown" : "Hidden" },
    { key: "milestones", label: "Milestones", minWidth: 120, sortValue: (event) => event.milestones?.length || 0, value: (event) => `${event.milestones?.length || 0}`, render: (event) => <strong>{event.milestones?.length || 0}</strong> },
    { key: "records", label: "Linked records", minWidth: 180, value: (event) => event.recordIds.map((id) => byId.get(id)?.id).filter(Boolean).join(" · ") || "No linked records" },
    { key: "actions", label: "Actions", role: "actions", required: true, sortable: false, render: (event) => <div className="dbi-table-actions"><button type="button" onClick={() => onEdit(event)}>Edit</button><button type="button" className="is-danger" aria-label={`Delete ${event.title}`} onClick={() => onDelete(event.id)}><Trash2 size={14} />Delete</button></div> },
  ];
  return <section className="ops-panel" data-ops-events><header className="ops-panel__header"><div><span>Operator schedule</span><h2>Events</h2></div></header>{events.length ? <OperationalDataTable id="events" label="Operator events" rows={events} columns={columns} rowKey={(event) => event.id} defaultSort={{ key: "starts", direction: "asc" }} searchPlaceholder="Search events, locations, attendees, milestones, and notes…" exportFilename="operator-events.csv" toolbarActions={<button type="button" className="if-btn if-btn--primary" onClick={onAdd}><Plus size={15} />Add event</button>} wrapperProps={{ "data-ops-event-table": true }} renderDetail={(event) => <div className="dbi-table-detail-grid"><article><span>Attendees</span><strong>{event.attendees?.map((attendee) => attendee.displayName).join(" · ") || "None assigned"}</strong></article><article><span>Deadlines &amp; milestones</span><strong>{event.milestones?.map((milestone) => `${milestoneLabel(milestone)} · ${compactDate(milestone.occursAt)}`).join(" · ") || "None published"}</strong></article><article><span>Notes</span><strong>{event.notes || "No notes"}</strong></article><article><span>Linked record IDs</span><strong>{event.recordIds.join(" · ") || "None"}</strong></article></div>} /> : <div className="ops-empty"><CalendarDays size={22} /><strong>No operator events</strong><p>Add meetings, checkpoints, or reviews and optionally publish them to the wallboard.</p><button type="button" className="ops-primary" onClick={onAdd}><Plus size={15} />Add event</button></div>}</section>;
}

function IntegrationsView({ auth, dataset, samOpportunities, manualProcurement, procurementDelta, subawardSnapshot, budgetGeneratedAt, awardGeneratedAt }) {
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
  return <section className="ops-panel" data-ops-integrations><header className="ops-panel__header"><div><span>Connector operations</span><h2>Integrations</h2></div><a href="#/budget-spend/sources">Open full lineage<ChevronRight size={15} /></a></header><OpenAiKeyManagement auth={auth} scope="workspace" embedded /><IntegrationFreshness budgetGeneratedAt={budgetGeneratedAt} awardGeneratedAt={awardGeneratedAt} /><div className="ops-integration-summary"><article><strong>{sourceHealth.totals?.online || 0}</strong><span>sources online</span></article><article><strong>{sourceHealth.totals?.unavailable || 0}</strong><span>unavailable at probe</span></article><article><strong>{dateTime(sourceHealth.metadata?.checkedAt)}</strong><span>health checked</span></article></div><OperationalDataTable id="integrations" label="Integration status" rows={rows} columns={columns} rowKey={(row) => row.name} defaultSort={{ key: "name", direction: "asc" }} searchPlaceholder="Search integrations and feed details…" exportFilename="integration-status.csv" selectable={false} wrapperProps={{ "data-ops-integration-table": true }} /></section>;
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

function WallboardView({ records, watchlist, events, asOf, workspace, lastRefreshedAt }) {
  const [mode, setMode] = useState("events");
  const [rotate, setRotate] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [clock, setClock] = useState(() => new Date().toISOString());
  const [calendarMonth, setCalendarMonth] = useState(() => String(events.find((event) => event.wallboard && event.status === "scheduled")?.startsAt || new Date().toISOString()).slice(0, 7));
  const ref = useRef(null);
  const watchById = new Map(watchlist.map((entry) => [entry.recordId, entry]));
  const visibleRecords = records.filter((record) => watchById.get(record.opportunityId)?.wallboard).sort((a, b) => (nextPublishedDate(a, asOf) || "9999").localeCompare(nextPublishedDate(b, asOf) || "9999"));
  const wallboardEvents = events.filter((event) => event.wallboard && event.status === "scheduled").sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const upcomingEvents = wallboardEvents.filter((event) => (event.endsAt || event.startsAt) >= clock);
  useEffect(() => {
    if (!rotate) return undefined;
    const modes = ["overview", "events", "calendar", "records"];
    const timer = window.setInterval(() => setMode((value) => modes[(modes.indexOf(value) + 1) % modes.length]), 15000);
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
      else {
        setRotate(false);
        await ref.current?.requestFullscreen?.();
      }
    } catch { /* The board remains usable without browser fullscreen permission. */ }
  }
  const now = new Date(clock);
  const reviewsDue = watchlist.filter((entry) => entry.reviewAt && entry.reviewAt >= asOf && entry.reviewAt <= reviewHorizon).length;
  return <section ref={ref} className="ops-wallboard" data-ops-wallboard data-wallboard-mode={mode} data-wallboard-fullscreen={isFullscreen ? "true" : "false"}>
    <header className="ops-wallboard__masthead">
      <div className="ops-wallboard__brand"><WorkspaceMark workspace={workspace} eager /><div>{!isFullscreen ? <span>Conference room display</span> : null}<h2>{workspace?.displayTitle || "Defense Budget Intelligence"}</h2>{isFullscreen ? <p data-wallboard-workspace>{workspace?.name || "Local workspace"}</p> : null}</div></div>
      <div className="ops-wallboard__time"><time dateTime={clock}><strong>{now.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</strong>{!isFullscreen ? <span>{now.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" })}</span> : null}</time>{!isFullscreen ? <small data-wallboard-last-refresh>{lastRefreshedAt ? `Updated ${new Date(lastRefreshedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : "Updating…"}</small> : null}{!isFullscreen ? <small>Data through {compactDate(asOf)}</small> : null}</div>
    </header>
    {!isFullscreen ? <div className="ops-wallboard__toolbar">
      <nav aria-label="Wallboard view"><button type="button" className={mode === "overview" ? "is-active" : ""} onClick={() => setMode("overview")}>Overview</button><button type="button" className={mode === "events" ? "is-active" : ""} onClick={() => setMode("events")}>Events</button><button type="button" className={mode === "calendar" ? "is-active" : ""} onClick={() => setMode("calendar")}>Calendar</button><button type="button" className={mode === "records" ? "is-active" : ""} onClick={() => setMode("records")}>Tracked records</button></nav>
      <div><button type="button" aria-pressed={rotate} onClick={() => setRotate((value) => !value)}>{rotate ? "Auto-cycle on" : "Auto-cycle off"}</button><button type="button" aria-pressed={isFullscreen} onClick={toggleFullscreen}>{isFullscreen ? <Minimize2 size={17} /> : <Maximize2 size={17} />}{isFullscreen ? "Exit kiosk" : "Enter kiosk"}</button></div>
    </div> : null}
    {!isFullscreen ? <div className="ops-wallboard__metrics" aria-label="Wallboard summary">
      <article><span>Tracked records</span><strong>{visibleRecords.length}</strong><small>Enabled for this display</small></article>
      <article><span>Upcoming events</span><strong>{upcomingEvents.length}</strong><small>Scheduled operator activity</small></article>
      <article><span>Reviews within 30 days</span><strong>{reviewsDue}</strong><small>Workspace review dates</small></article>
      <article><span>Source health</span><strong>{sourceHealth.totals?.online || 0}/{sourceHealth.totals?.targets || 0}</strong><small>Feeds online at last probe</small></article>
    </div> : null}
    {mode === "overview" ? <div className="ops-wallboard__split"><WallboardRecords records={visibleRecords.slice(0, 8)} asOf={asOf} watchById={watchById} /><WallboardSchedule events={upcomingEvents.slice(0, 5)} /></div> : mode === "events" ? <WallboardSchedule events={upcomingEvents.slice(0, 6)} now={now} focus /> : mode === "calendar" ? <WallboardCalendar events={wallboardEvents} month={calendarMonth} onMonthChange={setCalendarMonth} now={now} workspace={workspace} /> : <WallboardRecords records={visibleRecords.slice(0, 12)} asOf={asOf} watchById={watchById} />}
  </section>;
}

function shiftMonth(month, offset) {
  const [year, monthIndex] = month.split("-").map(Number);
  const shifted = new Date(Date.UTC(year, monthIndex - 1 + offset, 1));
  return shifted.toISOString().slice(0, 7);
}

function monthCalendarDays(month) {
  const [year, monthIndex] = month.split("-").map(Number);
  const first = new Date(Date.UTC(year, monthIndex - 1, 1));
  const gridStart = new Date(first);
  gridStart.setUTCDate(1 - first.getUTCDay());
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(gridStart);
    date.setUTCDate(gridStart.getUTCDate() + index);
    return {
      key: date.toISOString().slice(0, 10),
      day: date.getUTCDate(),
      inMonth: date.getUTCMonth() === monthIndex - 1,
    };
  });
}

function calendarWeekSegments(events, week) {
  const first = week[0].key;
  const last = week[6].key;
  const lanes = [];
  const calendarItems = events.flatMap((event) => [
    { id: `event-${event.id}`, kind: "event", event, start: String(event.startsAt || "").slice(0, 10), end: String(event.endsAt || event.startsAt || "").slice(0, 10) },
    ...(event.milestones || []).map((milestone) => ({ id: `milestone-${event.id}-${milestone.id}`, kind: "milestone", event, milestone, start: String(milestone.occursAt || "").slice(0, 10), end: String(milestone.occursAt || "").slice(0, 10) })),
  ]);
  return calendarItems
    .filter((item) => item.start <= last && item.end >= first)
    .sort((left, right) => left.start.localeCompare(right.start) || Number(left.kind === "milestone") - Number(right.kind === "milestone") || right.end.localeCompare(left.end))
    .map((item) => {
      const { start, end } = item;
      const startColumn = Math.max(0, week.findIndex((day) => day.key >= start));
      const endColumn = Math.max(startColumn, week.findLastIndex((day) => day.key <= end));
      let lane = lanes.findIndex((occupiedThrough) => startColumn > occupiedThrough);
      if (lane < 0) lane = lanes.length;
      lanes[lane] = endColumn;
      return { ...item, startColumn, endColumn, lane, startsBefore: start < first, endsAfter: end > last };
    });
}

function daysBetween(left, right) {
  const leftDate = Date.parse(`${String(left).slice(0, 10)}T00:00:00Z`);
  const rightDate = Date.parse(`${String(right).slice(0, 10)}T00:00:00Z`);
  return Number.isFinite(leftDate) && Number.isFinite(rightDate) ? Math.round((rightDate - leftDate) / 86400000) : null;
}

function CalendarHoverCard({ hover }) {
  if (!hover) return null;
  const { item, left, top } = hover;
  const { event, milestone } = item;
  const attendees = event.attendees || [];
  const deadlineLead = milestone ? daysBetween(milestone.occursAt, event.startsAt) : null;
  return createPortal(<aside id="ops-wall-calendar-tooltip" className="capture-timeline-tooltip ops-wall-calendar-tooltip" role="tooltip" style={{ left, top }} data-calendar-hovercard data-kind={item.kind}>
    <header><span>{milestone ? milestoneTypeLabel(milestone.type) : "Event schedule"}</span><strong>{milestone ? milestoneLabel(milestone) : event.title}</strong><small>{milestone ? event.title : `${event.status || "scheduled"} · ${event.milestones?.length || 0} milestone${event.milestones?.length === 1 ? "" : "s"}`}</small></header>
    <dl>{milestone ? <>
      <div><dt>Deadline</dt><dd>{compactDate(milestone.occursAt)}</dd></div>
      <div><dt>Lead time</dt><dd>{deadlineLead === null ? "Unavailable" : deadlineLead < 0 ? `${Math.abs(deadlineLead)} days after start` : deadlineLead === 0 ? "Event start day" : `${deadlineLead} days before start`}</dd></div>
      <div><dt>Event begins</dt><dd>{dateTime(event.startsAt)}</dd></div>
      <div><dt>Event ends</dt><dd>{dateTime(event.endsAt || event.startsAt)}</dd></div>
      <div><dt>Location</dt><dd>{event.location || "Not set"}</dd></div>
      <div><dt>Attendees</dt><dd>{attendees.length || "None"}</dd></div>
    </> : <>
      <div><dt>Starts</dt><dd>{dateTime(event.startsAt)}</dd></div>
      <div><dt>Ends</dt><dd>{dateTime(event.endsAt || event.startsAt)}</dd></div>
      <div><dt>Status</dt><dd>{event.status || "scheduled"}</dd></div>
      <div><dt>Milestones</dt><dd>{event.milestones?.length || "None"}</dd></div>
      <div><dt>Attendees</dt><dd>{attendees.length || "None"}</dd></div>
      <div><dt>Linked records</dt><dd>{event.recordIds?.length || "None"}</dd></div>
    </>}</dl>
    <p><b>Location</b>{event.location || "Location not set"}</p>
    {attendees.length ? <p><b>Attending</b>{attendees.map((attendee) => attendee.displayName).join(" · ")}</p> : null}
    {(milestone?.notes || (!milestone && event.notes)) ? <p><b>Context</b>{milestone?.notes || event.notes}</p> : null}
    <footer>Workspace event calendar · hover or keyboard focus for context</footer>
  </aside>, document.body);
}

function CalendarEventModal({ detail, onClose }) {
  if (!detail) return null;
  const { event, milestone } = detail;
  return <ControlDialog
    open
    onClose={onClose}
    title={milestone ? milestoneLabel(milestone) : event.title}
    eyebrow={milestone ? milestoneTypeLabel(milestone.type) : "Workspace event"}
    summary={milestone ? event.title : null}
    size="detail"
    closeLabel="Close event details"
    surfaceProps={{ className: "ops-event-detail", "data-calendar-event-detail": true }}
    bodyProps={{ className: "ops-event-detail__body" }}
    footer={<button type="button" onClick={onClose}>Close</button>}
  >
        <dl>
          <div><dt>{milestone ? "Milestone date" : "Starts"}</dt><dd>{dateTime(milestone?.occursAt || event.startsAt)}</dd></div>
          <div><dt>Event ends</dt><dd>{dateTime(event.endsAt || event.startsAt)}</dd></div>
          <div><dt>Status</dt><dd>{event.status || "scheduled"}</dd></div>
          <div><dt>Location</dt><dd>{event.location || "Not set"}</dd></div>
          <div><dt>Linked records</dt><dd>{event.recordIds?.length || "None"}</dd></div>
          <div><dt>Milestones</dt><dd>{event.milestones?.length || "None"}</dd></div>
        </dl>
        {event.attendees?.length ? <section><h3>Attendees</h3><div className="ops-event-detail__attendees">{event.attendees.map((attendee) => <span key={attendee.id || attendee.displayName}><UserAvatar user={attendee} size={34} decorative={false} /><span><strong>{attendee.displayName}</strong><small>{attendee.title || "Workspace member"}</small></span></span>)}</div></section> : null}
        {event.milestones?.length ? <section><h3>Deadlines &amp; milestones</h3><div className="ops-event-detail__milestones">{event.milestones.map((entry) => <article key={entry.id} className={milestone?.id === entry.id ? "is-focused" : ""}><i aria-hidden="true" /><span><strong>{milestoneLabel(entry)}</strong><small>{milestoneTypeLabel(entry.type)}</small></span><time dateTime={entry.occursAt}>{compactDate(entry.occursAt)}</time>{entry.notes ? <p>{entry.notes}</p> : null}</article>)}</div></section> : null}
        {(milestone?.notes || event.notes) ? <section className="ops-event-detail__context"><h3>Context</h3><p>{milestone?.notes || event.notes}</p></section> : null}
  </ControlDialog>;
}

function WallboardCalendar({ events, month, onMonthChange, now, workspace }) {
  const [hover, setHover] = useState(null);
  const [detail, setDetail] = useState(null);
  const days = monthCalendarDays(month);
  const today = now.toISOString().slice(0, 10);
  const currentMonth = today.slice(0, 7);
  const monthDate = new Date(`${month}-01T00:00:00Z`);
  const monthLabel = monthDate.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
  const monthStart = `${month}-01`;
  const monthEnd = `${month}-${String(new Date(Date.UTC(monthDate.getUTCFullYear(), monthDate.getUTCMonth() + 1, 0)).getUTCDate()).padStart(2, "0")}`;
  const monthEvents = events.filter((event) => String(event.startsAt || "").slice(0, 10) <= monthEnd && String(event.endsAt || event.startsAt || "").slice(0, 10) >= monthStart);
  const monthMilestones = events.flatMap((event) => (event.milestones || []).filter((milestone) => String(milestone.occursAt || "").slice(0, 10) >= monthStart && String(milestone.occursAt || "").slice(0, 10) <= monthEnd));
  const weeks = Array.from({ length: 6 }, (_, index) => days.slice(index * 7, index * 7 + 7));
  function showHover(item, target, clientX, clientY) {
    const bounds = target.getBoundingClientRect();
    const width = Math.min(380, window.innerWidth - 16);
    const left = Math.max(8, Math.min(clientX || bounds.right + 12, window.innerWidth - width - 8));
    const top = Math.max(8, Math.min(clientY || bounds.top, window.innerHeight - 360));
    setHover({ item, left, top });
  }
  return <section className="ops-wallboard__section ops-wallboard__section--calendar" data-wallboard-calendar>
    <header>
      <div className="ops-wall-calendar__identity"><WorkspaceMark workspace={workspace} /><span><small>{workspace?.name || "Operator calendar"}</small><strong data-calendar-month-heading>{monthLabel}</strong></span></div>
      <div className="ops-wall-calendar__controls">
        <button type="button" aria-label="Previous month" onClick={() => onMonthChange(shiftMonth(month, -1))}><ChevronLeft size={17} aria-hidden="true" /></button>
        <button type="button" onClick={() => onMonthChange(currentMonth)}>Today</button>
        <button type="button" aria-label="Next month" onClick={() => onMonthChange(shiftMonth(month, 1))}><ChevronRight size={17} aria-hidden="true" /></button>
        <b aria-label={`${monthEvents.length} events and ${monthMilestones.length} milestones in ${monthLabel}`}>{monthEvents.length}<small>+{monthMilestones.length}</small></b>
      </div>
    </header>
    <div className="ops-wall-calendar__viewport" tabIndex="0" aria-label={`${monthLabel} event calendar`}>
      <div className="ops-wall-calendar__weekdays" aria-hidden="true">{["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => <span key={day}>{day}</span>)}</div>
      <div className="ops-wall-calendar__weeks">{weeks.map((week) => {
        const segments = calendarWeekSegments(events, week);
        const laneCount = Math.max(1, ...segments.map((segment) => segment.lane + 1));
        return <section className="ops-wall-calendar__week" key={week[0].key} style={{ "--calendar-lanes": laneCount }}>
          <div className="ops-wall-calendar__days">{week.map((day) => <article key={day.key} className={`${day.inMonth ? "is-in-month" : "is-outside-month"}${day.key === today ? " is-today" : ""}`} data-calendar-day={day.key} data-in-month={day.inMonth ? "true" : "false"}>
            <header><time dateTime={day.key}>{day.day}</time>{day.key === today ? <span>Today</span> : null}</header>
          </article>)}</div>
          <div className="ops-wall-calendar__bars">{segments.map((item) => {
            const { event, milestone, startColumn, endColumn, lane, startsBefore, endsAfter } = item;
            const countdown = eventCountdown(event, now);
            const milestoneType = milestone?.type?.replaceAll("_", "-") || "";
            return <div key={item.id} role="button" tabIndex="0" aria-haspopup="dialog" aria-label={milestone ? `${milestoneLabel(milestone)} for ${event.title} on ${compactDate(milestone.occursAt)}` : `${event.title}, ${compactDate(event.startsAt)} to ${compactDate(event.endsAt || event.startsAt)}`} className={`ops-wall-calendar__bar ${milestone ? `ops-wall-calendar__bar--milestone is-${milestoneType}` : `is-${countdown.tone}`}${startsBefore ? " continues-before" : ""}${endsAfter ? " continues-after" : ""}`} style={{ gridColumn: `${startColumn + 1} / ${endColumn + 2}`, gridRow: lane + 1 }} {...(milestone ? { "data-calendar-milestone": milestone.id, "data-parent-event": event.id, "data-milestone-date": String(milestone.occursAt).slice(0, 10) } : { "data-calendar-event": event.id })} onClick={() => { setHover(null); setDetail({ event, milestone }); }} onKeyDown={(keyEvent) => { if (keyEvent.key === "Enter" || keyEvent.key === " ") { keyEvent.preventDefault(); setHover(null); setDetail({ event, milestone }); } }} onPointerEnter={(pointerEvent) => { if (pointerEvent.pointerType === "mouse") showHover(item, pointerEvent.currentTarget, pointerEvent.clientX + 14, pointerEvent.clientY + 14); }} onPointerMove={(pointerEvent) => { if (pointerEvent.pointerType === "mouse") showHover(item, pointerEvent.currentTarget, pointerEvent.clientX + 14, pointerEvent.clientY + 14); }} onPointerLeave={() => setHover(null)} onFocus={(focusEvent) => { if (!window.matchMedia("(pointer: coarse)").matches) showHover(item, focusEvent.currentTarget); }} onBlur={() => setHover(null)}>
              <i aria-hidden="true" /><div className="ops-wall-calendar__bar-copy"><strong>{milestone ? milestoneLabel(milestone) : event.title}</strong><span>{milestone ? event.title : event.location || "Location not set"}</span></div>{!milestone && event.attendees?.length ? <span className="ops-wall-calendar__bar-attendees" aria-label={`${event.attendees.length} attendee${event.attendees.length === 1 ? "" : "s"}`}>{event.attendees.slice(0, 3).map((attendee) => <UserAvatar key={attendee.id} user={attendee} size={24} />)}{event.attendees.length > 3 ? <b>+{event.attendees.length - 3}</b> : null}</span> : null}
            </div>;
          })}</div>
        </section>;
      })}</div>
    </div>
    <CalendarHoverCard hover={hover} />
    <CalendarEventModal detail={detail} onClose={() => setDetail(null)} />
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
        {ADMIN_VIEWS.filter(([id]) => !["users", "workspaces", "workspace-settings", "agents"].includes(id)
          || (id === "users" ? auth?.user?.canManageUsers
            : id === "workspaces" ? auth?.user?.roleId === "super_user"
              : id === "workspace-settings" ? auth?.user?.canManageWorkspaces
                : auth?.user?.canManageAgents)).map(([id, label, Icon]) => <a key={id} href={ADMIN_ROUTES[id]} className={view === id ? "is-active" : ""} aria-current={view === id ? "page" : undefined}><Icon size={15} aria-hidden="true" /><span>{label}</span></a>)}
      </nav>
      <div className="admin-console__context" aria-live="polite"><span>{copy[0]}</span><strong>{copy[1]}</strong><small>{copy[2]}</small></div>
    </section> : null}
    {state.error ? <p className="ops-alert" role="alert">Workspace sync failed: {state.error}</p> : null}
    {view === "watchlist" ? <WatchlistView rows={watchedRecords} watchlist={state.watchlist} asOf={dataset.metadata.asOf} query={query} setQuery={setQuery} toggleWatch={state.toggleWatch} updateWatch={state.updateWatch} /> : null}
    {view === "events" ? <EventsView events={state.events} records={watchedRecords} onAdd={() => setEditor({ mode: "add" })} onEdit={(event) => setEditor({ mode: "edit", event })} onDelete={state.deleteEvent} /> : null}
    {view === "integrations" ? <IntegrationsView auth={auth} dataset={dataset} samOpportunities={samOpportunities} manualProcurement={manualProcurement} procurementDelta={procurementDelta} subawardSnapshot={subawardSnapshot} budgetGeneratedAt={budgetGeneratedAt} awardGeneratedAt={awardGeneratedAt} /> : null}
    {view === "activity" ? <ActivityView activity={state.activity} records={records} remote={state.remote} /> : null}
    {view === "users" ? auth?.user?.canManageUsers ? <UserManagement auth={auth} /> : <section className="ops-panel ops-empty" data-users-unavailable><UsersRound size={22} /><strong>Administrator access required</strong><p>Your role cannot manage human accounts.</p></section> : null}
    {view === "workspaces" ? auth?.user?.roleId === "super_user" ? <WorkspaceManagement auth={auth} /> : <section className="ops-panel ops-empty" data-workspaces-unavailable><Building2 size={22} /><strong>Super user access required</strong><p>Cross-workspace administration is limited to the immutable Super user.</p></section> : null}
    {view === "workspace-settings" ? auth?.user?.canManageWorkspaces ? <WorkspaceManagement auth={auth} activeOnly /> : <section className="ops-panel ops-empty" data-workspaces-unavailable><Building2 size={22} /><strong>Workspace manager access required</strong><p>Your role cannot configure this workspace.</p></section> : null}
    {view === "agents" ? auth?.user?.canManageAgents ? <AgentAccessPanel auth={auth} embedded /> : <section className="ops-panel ops-empty" data-profile-agents-unavailable><Bot size={22} /><strong>Administrator access required</strong><p>Your role cannot issue or revoke agent credentials.</p></section> : null}
    {view === "wallboard" ? <WallboardView records={records} watchlist={state.watchlist} events={state.events} asOf={dataset.metadata.asOf} workspace={auth?.user?.activeWorkspace || null} lastRefreshedAt={state.lastRefreshedAt} /> : null}
    {editor ? <EventEditor event={editor.mode === "edit" ? editor.event : null} records={watchedRecords} onSave={state.saveEvent} onClose={() => setEditor(null)} /> : null}
    {view !== "wallboard" ? <section className="operations-boundary"><Database size={17} /><p><strong>State boundary:</strong> {state.remote ? "stars, notes, review dates, events, and activity are stored in the authenticated D1 workspace and shared with scoped agents." : "this static fallback stores stars, notes, review dates, events, and activity only in this browser."} Operator state never changes source-backed evidence, public JSON, evidence exports, or shareable record URLs.</p></section> : null}
  </div>;
}
