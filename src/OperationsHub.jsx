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
  ListChecks,
  MapPin,
  Maximize2,
  Minimize2,
  MonitorUp,
  Plus,
  ShieldCheck,
  Sparkles,
  CircleAlert,
  CircleCheck,
  Star,
  Trash2,
  UsersRound,
} from "lucide-react";
import sourceHealth from "./data/source-health.json";
import contractMonitor from "./data/contract-monitor.json";
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
import { ControlDialog, ControlMultiSelect, ControlSparkline } from "control-surface-ui/react";
import { useNotifications } from "./NotificationContext.jsx";

const VIEWS = [
  ["watchlist", "Watchlist", Star],
  ["events", "Events", CalendarDays],
  ["tasks", "Task Center", ListChecks],
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
  tasks: ["Workspace work", "Task Center", "Background augmentation and API tasks, progress, outcomes, and review."],
  integrations: ["Administration", "Integrations", "Connector health, refresh cadence, yields, and unavailable probes."],
  activity: ["Administration", "API & activity log", "Append-only human and agent changes across the shared workspace."],
  users: ["Administration", "Users", "Human accounts, roles, status, sessions, and password recovery."],
  workspaces: ["Administration", "Workspaces", "Isolated data boundaries, membership, and access-request decisions."],
  "workspace-settings": ["Workspace", "Workspace settings", "Identity, membership, access requests, roles, and workspace inventory."],
  agents: ["Administration", "Agent access", "Issue and govern narrowly scoped credentials for trusted agents."],
};

const ADMIN_ROUTES = {
  watchlist: "#/budget-spend/watchlist",
  events: "#/budget-spend/events",
  tasks: "#/budget-spend/tasks",
  integrations: "#/budget-spend/integrations",
  users: "#/budget-spend/users",
  workspaces: "#/budget-spend/workspaces",
  "workspace-settings": "#/budget-spend/workspace",
  agents: "#/budget-spend/agents",
  activity: "#/budget-spend/api-log",
};

const CONTROL_AREAS = {
  work: {
    ids: ["watchlist", "events", "tasks"],
    eyebrow: "Workspace work",
    title: "Workspace operations",
    description: "Tracked records, operator events, and background task progress for the active workspace.",
    tone: "if-status--info",
  },
  workspace: {
    ids: ["integrations", "activity", "workspace-settings", "agents"],
    eyebrow: "Workspace administration",
    title: "Workspace controls",
    description: "Connections, audit visibility, workspace identity, membership, and scoped agent access.",
    tone: "if-status--warning",
  },
  platform: {
    ids: ["users", "workspaces"],
    eyebrow: "Platform administration",
    title: "Platform controls",
    description: "Global human accounts and workspace boundaries across the full deployment.",
    tone: "if-status--danger",
  },
};

function controlAreaForView(view) {
  return Object.entries(CONTROL_AREAS).find(([, area]) => area.ids.includes(view))?.[0] || "work";
}

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
    { id: "contracts", label: "Contract monitor", mobileLabel: "Contracts", at: contractMonitor.metadata.generatedAt, maxAgeDays: 2 },
  ];
  return <section className="freshness-strip" aria-label="Data freshness" data-freshness-strip data-integration-freshness>{layers.map((layer) => {
    const state = freshnessState(layer.at, layer.maxAgeDays);
    return <span key={layer.id} className={`freshness-chip freshness-chip--${state.tone}`} title={`${layer.label}: ${state.label} · ${layer.at ? dateTime(layer.at) : "No snapshot"}`}><strong data-mobile-label={layer.mobileLabel}>{layer.label}</strong><em>{state.label}</em><small>{layer.at ? dateTime(layer.at) : "No snapshot"}</small></span>;
  })}</section>;
}

function ContractMonitorCoverage() {
  const metadata = contractMonitor.metadata || {};
  const rows = contractMonitor.records || [];
  const columns = [
    { key: "contract", label: "Contract", required: true, sticky: true, minWidth: 260, value: (row) => `${row.reference || "Unidentified"} ${row.title}`, render: (row) => <><strong>{row.reference || "Identifier unavailable"}</strong><small>{row.title}</small></> },
    { key: "lifecycle", label: "Lifecycle", facet: true, minWidth: 135, value: (row) => row.lifecycle, render: (row) => row.lifecycle.replaceAll("-", " ") },
    { key: "status", label: "Automation", facet: true, minWidth: 135, value: (row) => row.status, render: (row) => <span className={`dbi-status-badge is-${row.status}`}>{row.status.replaceAll("-", " ")}</span> },
    { key: "method", label: "Method", facet: true, minWidth: 200, value: (row) => row.method, render: (row) => <><strong>{row.method.replaceAll("-", " ")}</strong><small>{row.generatedAwardId || row.sourceSystem || "No exact automated key"}</small></> },
    { key: "checked", label: "Checked", minWidth: 165, value: (row) => row.checkedAt || row.lastAttemptAt || "", render: (row) => row.checkedAt || row.lastAttemptAt ? dateTime(row.checkedAt || row.lastAttemptAt) : "Not refreshable" },
    { key: "diagnostic", label: "Coverage note", minWidth: 260, role: "prose", value: (row) => row.diagnostic?.message || "Exact public record refreshed.", render: (row) => row.diagnostic?.message || "Exact public record refreshed." },
  ];
  return <section className="if-panel" data-contract-monitor>
    <header className="if-panel__header"><div><span>Known contract universe</span><h3>Automated active &amp; upcoming coverage</h3><p>{metadata.methodology}</p></div><a href={metadata.sourceUrls?.[0]} target="_blank" rel="noreferrer">USAspending source<ChevronRight size={15} /></a></header>
    <div className="if-metric-grid if-operations-signal-grid if-operations-signal-grid--compact" data-contract-monitor-summary>
      <article className="if-card if-metric if-operations-signal if-operations-signal--compact if-tone-info"><div className="if-metric__top"><p className="if-metric__label">Known targets</p></div><p className="if-metric__value">{Number(metadata.targetCount || 0).toLocaleString()}</p><div className="if-metric__meta"><span>{Number(metadata.byLifecycle?.active || 0).toLocaleString()} active</span><span>{Number(metadata.byLifecycle?.upcoming || 0).toLocaleString()} upcoming</span></div></article>
      <article className="if-card if-metric if-operations-signal if-operations-signal--compact if-tone-success"><div className="if-metric__top"><p className="if-metric__label">Automated coverage</p></div><p className="if-metric__value">{metadata.coveragePercent || 0}%</p><div className="if-metric__meta"><span>{Number(metadata.currentCount || 0).toLocaleString()} current</span><span>{Number(metadata.staleCount || 0).toLocaleString()} stale</span></div></article>
      <article className="if-card if-metric if-operations-signal if-operations-signal--compact if-tone-warning"><div className="if-metric__top"><p className="if-metric__label">Exact-key gaps</p></div><p className="if-metric__value">{Number(metadata.gapCount || 0).toLocaleString()}</p><div className="if-metric__meta"><span>{Number(metadata.byLifecycle?.["unresolved-schedule"] || 0).toLocaleString()} unscheduled</span><span>SAM key can close notice gaps</span></div></article>
      <article className="if-card if-metric if-operations-signal if-operations-signal--compact if-tone-neutral"><div className="if-metric__top"><p className="if-metric__label">Last completed</p></div><p className="if-metric__value">{metadata.generatedAt ? compactDate(metadata.generatedAt) : "Unavailable"}</p><div className="if-metric__meta"><span>{metadata.status || "unknown"}</span><span>Prior verified facts retained on failure</span></div></article>
    </div>
    <OperationalDataTable id="contract-monitor" label="Active and upcoming contract automation" rows={rows} columns={columns} rowKey={(row) => row.opportunityId} defaultSort={{ key: "status", direction: "asc" }} searchPlaceholder="Search monitored contracts, identifiers, lifecycle, methods, and gaps…" exportFilename="contract-monitor.csv" selectable={false} wrapperProps={{ "data-contract-monitor-table": true }} />
  </section>;
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

function validEventLinkUrl(value) {
  try {
    return ["http:", "https:"].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

function newEventDraft() {
  return {
    id: `event-${Date.now()}`,
    title: "",
    startsAt: "",
    endsAt: "",
    location: "",
    links: [],
    categoryIds: [],
    notes: "",
    status: "scheduled",
    recordIds: [],
    attendees: [],
    attendeeIds: [],
    milestones: [],
    wallboard: true,
  };
}

function workingSpinner(size = "sm") {
  return <span className={`if-loading-dots if-loading-dots--orbit${size ? ` if-loading-dots--${size}` : ""}`} aria-hidden="true"><span /><span /><span /></span>;
}

function stoppedEventAiStage(job) {
  if (job?.currentStep === "independent_verification") return "verification";
  if (job?.currentStep === "public_research") return "research";
  return Object.keys(job?.proposal || {}).length ? "verification" : "research";
}

const EVENT_DIFF_FIELDS = [
  ["title", "Title"],
  ["startsAt", "Starts"],
  ["endsAt", "Ends"],
  ["location", "Location"],
  ["notes", "Notes"],
  ["links", "Links"],
  ["milestones", "Milestones"],
  ["categoryIds", "Categories"],
];

function eventDiffValue(field, value) {
  if (field === "links") return value?.length ? value.map((item) => item.label || item.url).join(" · ") : "None";
  if (field === "milestones") return value?.length ? value.map((item) => `${milestoneLabel(item)} · ${compactDate(item.occursAt)}`).join(" · ") : "None";
  if (field === "categoryIds") return value?.length ? value.join(" · ") : "Uncategorized";
  if (["startsAt", "endsAt"].includes(field)) return value ? dateTime(value) : "Not set";
  return String(value || "Not set");
}

function eventAiDiffRows(job) {
  const before = job?.inputSnapshot || {};
  const after = job?.mergeResult?.mergedDraft || {};
  if (!Object.keys(after).length) return [];
  return EVENT_DIFF_FIELDS.map(([field, label]) => ({
    field,
    label,
    before: eventDiffValue(field, before[field]),
    after: eventDiffValue(field, after[field]),
  })).filter((row) => row.before !== row.after);
}

function EventAiLauncher({ event, onClose }) {
  const auth = useAuth();
  const notifications = useNotifications();
  const dialogRef = useRef(null);
  const [draft, setDraft] = useState(() => event || newEventDraft());
  const [capability, setCapability] = useState(null);
  const [credential, setCredential] = useState("");
  const [inventory, setInventory] = useState(null);
  const [producerModel, setProducerModel] = useState("");
  const [verifierModel, setVerifierModel] = useState("");
  const [direction, setDirection] = useState("");
  const [busy, setBusy] = useState(false);
  const [modelsBusy, setModelsBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!auth?.enabled || !auth?.user) return undefined;
    let active = true;
    void auth.getEventAiCapability().then((result) => {
      if (!active) return;
      const next = result.capability || null;
      const personal = next?.personalKeys?.find((key) => key.isDefault) || next?.personalKeys?.[0];
      const selected = personal ? `user:${personal.id}` : next?.workspaceDefault?.available ? "workspace" : "";
      setCapability(next);
      setCredential(selected);
      setModelsBusy(Boolean(selected));
    }).catch((requestError) => { if (active) setError(requestError.message); });
    return () => { active = false; };
  }, [auth]);
  useEffect(() => {
    if (!credential) return undefined;
    let active = true;
    const [credentialScope, credentialId = ""] = credential.split(":");
    void auth.listEventAiModels({ credentialScope, credentialId }).then((result) => {
      if (!active) return;
      const next = result.inventory || null;
      setInventory(next);
      setProducerModel(next?.producerModel || "");
      setVerifierModel(next?.verifierModel || "");
      setError("");
    }).catch((requestError) => {
      if (!active) return;
      setInventory(null);
      setProducerModel("");
      setVerifierModel("");
      setError(requestError.message);
    }).finally(() => { if (active) setModelsBusy(false); });
    return () => { active = false; };
  }, [auth, credential]);
  const credentialOptions = [
    ...(capability?.personalKeys || []).map((key) => [`user:${key.id}`, `${key.label}${key.isDefault ? " · default" : ""} · ••••${key.lastFour}`]),
    ...(capability?.workspaceDefault?.available ? [["workspace", capability.workspaceDefault.lastFour ? `Workspace default · ••••${capability.workspaceDefault.lastFour}` : "Workspace default"]] : []),
  ];
  const modelOptions = (inventory?.models || []).map((model) => ({ value: model.id, label: model.id, description: `${model.ownedBy || "OpenAI"}${model.created ? ` · ${new Date(model.created * 1000).toLocaleDateString()}` : ""}` }));
  async function launch(submitEvent) {
    submitEvent?.preventDefault();
    setError("");
    if (draft.title.trim().length < 2) { setError("Enter an event name before starting AI research."); return; }
    if (!credential || !producerModel || !verifierModel) { setError("Choose a configured credential and both available models."); return; }
    setBusy(true);
    try {
      const [credentialScope, credentialId = ""] = credential.split(":");
      const result = await auth.startEventAiJob({ draft, direction, credentialScope, credentialId, producerModel, verifierModel });
      notifications?.registerJob(result.job);
      setDraft(newEventDraft());
      setDirection("");
      onClose();
    } catch (requestError) { setError(requestError.message); }
    finally { setBusy(false); }
  }
  return <ControlDialog
    open
    onClose={() => { if (!busy) onClose(); }}
    title="Research and augment event"
    eyebrow="Background task"
    summary={`Research missing public details for ${event?.title || "this event"}. Starting the task closes this launcher; progress remains in Task Center and Notifications.`}
    size="wide"
    dialogRef={dialogRef}
    closeLabel="Close event augmentation"
    surfaceProps={{ "data-event-ai-launcher-dialog": true }}
    footer={<><button type="button" className="if-btn" disabled={busy} onClick={onClose}>Cancel</button><button type="submit" form="event-ai-launcher-form" className={`if-btn if-btn--ai if-touch-target${busy ? " is-loading" : ""}`} disabled={busy || modelsBusy || !capability?.available || !credential || !producerModel || !verifierModel}>{busy ? <span className="if-btn__spinner" aria-hidden="true" /> : <Sparkles size={16} aria-hidden="true" />}{busy ? "Starting background task…" : "Start augmentation"}</button></>}
  >
    <form id="event-ai-launcher-form" className="if-form-grid" data-event-ai-launcher aria-busy={busy} onSubmit={launch}>
      <label className="if-field if-field--full"><span className="if-field__label">Event name or research target</span><input className="if-input" value={draft.title} placeholder="Air, Space & Cyber Conference" onChange={(e) => setDraft((value) => ({ ...value, title: e.target.value }))} /></label>
      <label className="if-field if-field--full"><span className="if-field__label">Specific direction <small>(optional)</small></span><textarea className="if-input if-touch-target" value={direction} maxLength={2000} placeholder="Default: fill missing verified public details, links, categories, and published deadlines." onChange={(e) => setDirection(e.target.value)} /></label>
      <div className="if-field"><span className="if-field__label">Credential</span>{credentialOptions.length ? <ControlSelect ariaLabel="AI credential" value={credential} searchable options={credentialOptions} portalTarget={dialogRef} onChange={(value) => { setCredential(value); setInventory(null); setProducerModel(""); setVerifierModel(""); setModelsBusy(Boolean(value)); }} /> : <p className="if-field__hint">Add a personal key or ask a workspace manager to configure a workspace default.</p>}</div>
      <div className="if-field"><span className="if-field__label">Research model</span><ControlSelect ariaLabel="Research model" value={producerModel} searchable options={modelOptions} portalTarget={dialogRef} onChange={setProducerModel} disabled={modelsBusy || !modelOptions.length} placeholder={modelsBusy ? "Loading available models…" : "Choose a model"} /></div>
      <div className="if-field"><span className="if-field__label">Verification model</span><ControlSelect ariaLabel="Verification model" value={verifierModel} searchable options={modelOptions} portalTarget={dialogRef} onChange={setVerifierModel} disabled={modelsBusy || !modelOptions.length} placeholder={modelsBusy ? "Loading available models…" : "Choose a model"} /></div>
      <div className="if-field if-field--full">
        <span className="if-field__label">What happens after launch</span>
        <ol className="if-stepper if-stepper--interactive if-stepper--semantic if-stepper--unboxed if-stepper--compact" style={{ "--step-count": 3 }} aria-label="Event AI workflow">
          <li className="if-stepper__step is-active"><span className="if-stepper__item"><span className="if-stepper__dot">1</span><span className="if-stepper__label">Research</span><span className="if-stepper__meta">Public sources and citations</span></span></li>
          <li className="if-stepper__step"><span className="if-stepper__item"><span className="if-stepper__dot">2</span><span className="if-stepper__label">Verify</span><span className="if-stepper__meta">Independent schema and evidence check</span></span></li>
          <li className="if-stepper__step"><span className="if-stepper__item"><span className="if-stepper__dot">3</span><span className="if-stepper__label">Review</span><span className="if-stepper__meta">Notification tray holds the verified draft</span></span></li>
        </ol>
        <p className="if-field__hint">Verified changes, conflicts, rejected claims, sources, models, and the trace will appear in a dedicated review workspace. Nothing saves automatically.</p>
      </div>
      {inventory ? <p className="if-field__hint if-field--full">{inventory.capabilityNotice} {modelOptions.length} compatible text model{modelOptions.length === 1 ? "" : "s"} shown from this credential’s project.</p> : null}
      {error ? <p className="ops-alert if-field--full" role="alert">{error}</p> : null}
    </form>
  </ControlDialog>;
}

function EventEditor({ event, review = false, records, categories, onSave, onClose }) {
  const auth = useAuth();
  const dialogRef = useRef(null);
  const [draft, setDraft] = useState(() => event || newEventDraft());
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
    if ((draft.links || []).some((link) => !validEventLinkUrl(link.url))) {
      setError("Every event link needs a valid HTTP or HTTPS URL.");
      return;
    }
    onSave({ ...draft, updatedAt: new Date().toISOString() });
    onClose();
  }
  return <ControlDialog
    open
    onClose={onClose}
    title={review ? "Review AI-assisted event" : event ? "Edit event" : "Add event"}
    eyebrow={review ? "Verified draft · unsaved" : "Workspace schedule"}
    summary={review ? "Compare the verified proposal above, inspect every field here, then save only if it is correct." : undefined}
    size="detail"
    dialogRef={dialogRef}
    closeLabel="Close event editor"
    surfaceProps={{ "data-ops-event-editor": true }}
    footer={<><button type="button" className="if-btn" onClick={onClose}>Cancel</button><button type="submit" className="if-btn if-btn--primary" form="ops-event-editor-form">Save event</button></>}
  >
      <form id="ops-event-editor-form" className="ops-event-form" onSubmit={submit}>
          {error ? <p role="alert" className="ops-alert">{error}</p> : null}
          <label className="ops-field ops-field--wide"><span>Title</span><input autoFocus value={draft.title} onChange={(e) => setDraft((value) => ({ ...value, title: e.target.value }))} /></label>
          <label className="ops-field"><span>Starts</span><input type="datetime-local" value={String(draft.startsAt || "").slice(0, 16)} onChange={(e) => setDraft((value) => ({ ...value, startsAt: e.target.value }))} /></label>
          <label className="ops-field"><span>Ends</span><input type="datetime-local" value={String(draft.endsAt || "").slice(0, 16)} onChange={(e) => setDraft((value) => ({ ...value, endsAt: e.target.value }))} /></label>
          <label className="ops-field"><span>Location</span><input value={draft.location} placeholder="Venue, room, city, or virtual" onChange={(e) => setDraft((value) => ({ ...value, location: e.target.value }))} /></label>
          <div className="ops-field"><span>Status</span><ControlSelect ariaLabel="Event status" value={draft.status} options={[["scheduled", "Scheduled"], ["completed", "Completed"], ["cancelled", "Cancelled"]]} onChange={(status) => setDraft((value) => ({ ...value, status }))} portalTarget={dialogRef} /></div>
          <div className="ops-attendee-picker ops-field--wide">
            <SearchMultiSelect title="Event categories" allLabel="Select event types" value={JSON.stringify(draft.categoryIds || [])} options={categories.map((category) => ({ value: category.id, label: category.name, description: category.description }))} onChange={(categoryIds) => setDraft((value) => ({ ...value, categoryIds }))} portalTarget={dialogRef} />
            {!categories.length ? <small>No workspace event categories are available.</small> : null}
          </div>
          <div className="ops-attendee-picker ops-field--wide">
            <SearchMultiSelect title="Attendees" allLabel="Select workspace users" value={JSON.stringify(draft.attendeeIds || [])} options={directory.map((user) => ({ value: user.id, label: user.title ? `${user.displayName} · ${user.title}` : user.displayName }))} onChange={(attendeeIds) => setDraft((value) => ({ ...value, attendeeIds }))} portalTarget={dialogRef} />
            {directoryError ? <small role="alert">User directory unavailable: {directoryError}</small> : !directory.length ? <small>No active workspace users available.</small> : null}
          </div>
          <label className="ops-field ops-field--wide"><span>Notes</span><textarea value={draft.notes} onChange={(e) => setDraft((value) => ({ ...value, notes: e.target.value }))} /></label>
          <fieldset className="if-card if-form-grid if-field--full" data-event-links>
            <legend className="if-field__label">Event links</legend>
            <p className="if-field__hint if-field--full">Add the official event page, registration, agenda, lodging, or other relevant links.</p>
            {(draft.links || []).map((link, index) => <div className="if-card if-form-grid if-field--full" key={link.id}>
              <label className="if-field"><span className="if-field__label">Label</span><input className="if-input" aria-label={`Event link ${index + 1} label`} value={link.label || ""} placeholder="Registration" onChange={(e) => setDraft((value) => ({ ...value, links: value.links.map((item) => item.id === link.id ? { ...item, label: e.target.value } : item) }))} /></label>
              <label className="if-field"><span className="if-field__label">URL</span><input className="if-input" aria-label={`Event link ${index + 1} URL`} type="url" value={link.url || ""} placeholder="https://…" onChange={(e) => setDraft((value) => ({ ...value, links: value.links.map((item) => item.id === link.id ? { ...item, url: e.target.value } : item) }))} /></label>
              <button type="button" className="if-btn if-field--full" aria-label={`Remove event link ${index + 1}`} onClick={() => setDraft((value) => ({ ...value, links: value.links.filter((item) => item.id !== link.id) }))}><Trash2 size={15} aria-hidden="true" />Remove link</button>
            </div>)}
            <button type="button" className="if-btn if-btn--secondary" onClick={() => setDraft((value) => ({ ...value, links: [...(value.links || []), { id: `link-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, label: "", url: "" }] }))}><Plus size={15} aria-hidden="true" />Add link</button>
          </fieldset>
          <fieldset className="if-card if-form-grid if-field--full" data-event-milestones>
            <legend className="if-field__label">Deadlines &amp; milestones</legend>
            <p className="if-field__hint if-field--full">Add only published or operator-confirmed dates. Missing dates stay absent from the calendar.</p>
            {(draft.milestones || []).map((milestone, index) => <div className="if-card if-form-grid if-field--full" key={milestone.id}>
              <div className="if-field"><span className="if-field__label">Type</span><ControlSelect ariaLabel={`Milestone ${index + 1} type`} value={milestone.type} options={EVENT_MILESTONE_TYPES} onChange={(type) => setDraft((value) => ({ ...value, milestones: value.milestones.map((item) => item.id === milestone.id ? { ...item, type } : item) }))} portalTarget={dialogRef} /></div>
              <label className="if-field"><span className="if-field__label">Date</span><input className="if-input" aria-label={`Milestone ${index + 1} date`} type="date" value={String(milestone.occursAt || "").slice(0, 10)} onChange={(e) => setDraft((value) => ({ ...value, milestones: value.milestones.map((item) => item.id === milestone.id ? { ...item, occursAt: e.target.value } : item) }))} /></label>
              <label className="if-field"><span className="if-field__label">Display label</span><input className="if-input" aria-label={`Milestone ${index + 1} label`} value={milestone.label || ""} placeholder={milestoneTypeLabel(milestone.type)} onChange={(e) => setDraft((value) => ({ ...value, milestones: value.milestones.map((item) => item.id === milestone.id ? { ...item, label: e.target.value } : item) }))} /></label>
              <label className="if-field"><span className="if-field__label">Context</span><input className="if-input" aria-label={`Milestone ${index + 1} context`} value={milestone.notes || ""} placeholder="Optional source or policy note" onChange={(e) => setDraft((value) => ({ ...value, milestones: value.milestones.map((item) => item.id === milestone.id ? { ...item, notes: e.target.value } : item) }))} /></label>
              <button type="button" className="if-btn if-field--full" aria-label={`Remove milestone ${index + 1}`} onClick={() => setDraft((value) => ({ ...value, milestones: value.milestones.filter((item) => item.id !== milestone.id) }))}><Trash2 size={15} aria-hidden="true" />Remove milestone</button>
            </div>)}
            <button type="button" className="if-btn if-btn--secondary" onClick={() => setDraft((value) => ({ ...value, milestones: [...(value.milestones || []), { id: `milestone-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, type: "registration_deadline", label: "", occursAt: "", notes: "" }] }))}><Plus size={15} aria-hidden="true" />Add deadline or milestone</button>
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

function EventCategoryCard({ category, onSave, onDelete }) {
  const [name, setName] = useState(category.name);
  const [description, setDescription] = useState(category.description || "");
  const [error, setError] = useState("");
  async function save(formEvent) {
    formEvent.preventDefault();
    try {
      await onSave({ ...category, name, description });
      setError("");
    } catch (requestError) { setError(requestError.message); }
  }
  return <form className="if-card if-form-grid" onSubmit={save} data-event-category={category.id}>
    <label className="if-field"><span className="if-field__label">Category name</span><input className="if-input" value={name} onChange={(event) => setName(event.target.value)} /></label>
    <label className="if-field"><span className="if-field__label">Description</span><input className="if-input" value={description} onChange={(event) => setDescription(event.target.value)} /></label>
    <span className="if-field__hint">{category.assignedEventCount || 0} assigned event{category.assignedEventCount === 1 ? "" : "s"}</span>
    <div><button type="submit" className="if-btn if-btn--secondary">Save category</button> <button type="button" className="if-btn" disabled={Boolean(category.assignedEventCount)} onClick={() => void onDelete(category.id).catch((requestError) => setError(requestError.message))}><Trash2 size={15} aria-hidden="true" />Delete</button></div>
    {error ? <p className="ops-alert if-field--full" role="alert">{error}</p> : null}
  </form>;
}

function EventCategoryManager({ categories, onSave, onDelete, onClose }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState("");
  async function create(formEvent) {
    formEvent.preventDefault();
    try {
      const saved = await onSave({ name, description });
      if (saved) { setName(""); setDescription(""); setError(""); }
    } catch (requestError) { setError(requestError.message); }
  }
  return <ControlDialog
    open
    onClose={onClose}
    title="Event categories"
    eyebrow="Workspace taxonomy"
    summary="Manage the event types available to this workspace and its calendar filters."
    size="wide"
    closeLabel="Close event categories"
    surfaceProps={{ "data-event-category-manager": true }}
    footer={<button type="button" className="if-btn" onClick={onClose}>Close</button>}
  >
    <div className="if-form-grid">
      <form className="if-card if-form-grid if-field--full" onSubmit={create}>
        <label className="if-field"><span className="if-field__label">New category</span><input className="if-input" value={name} onChange={(event) => setName(event.target.value)} placeholder="Customer immersion" /></label>
        <label className="if-field"><span className="if-field__label">Description</span><input className="if-input" value={description} onChange={(event) => setDescription(event.target.value)} placeholder="How this event type is used" /></label>
        <button type="submit" className="if-btn if-btn--primary">Add category</button>
        {error ? <p className="ops-alert if-field--full" role="alert">{error}</p> : null}
      </form>
      {categories.map((category) => <EventCategoryCard key={`${category.id}-${category.updatedAt}`} category={category} onSave={onSave} onDelete={onDelete} />)}
    </div>
  </ControlDialog>;
}

function eventCategoryLabels(event, categories) {
  const byId = new Map(categories.map((category) => [category.id, category.name]));
  return (event.categoryIds || []).map((id) => byId.get(id)).filter(Boolean);
}

function EventAiReview({ jobId, onOpenDraft }) {
  const auth = useAuth();
  const notifications = useNotifications();
  const [fetchedJob, setFetchedJob] = useState(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    void auth.getEventAiJob(jobId).then((result) => { if (active) setFetchedJob(result.job); }).catch((requestError) => { if (active) setError(requestError.message); });
    return () => { active = false; };
  }, [auth, jobId]);
  const job = notifications?.jobs?.find((item) => item.id === jobId) || fetchedJob;
  useEffect(() => {
    if (!job || !["completed", "needs_review", "failed"].includes(job.status)) return;
    notifications?.markRead(`event-ai:${job.id}`, job.status);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job?.id, job?.status]);
  const active = ["researching", "verifying"].includes(job?.status);
  const failedStage = job?.status === "failed" ? stoppedEventAiStage(job) : "";
  const diffRows = eventAiDiffRows(job);
  const statusLabel = job?.status === "completed" ? "Verified draft ready" : job?.status === "needs_review" ? "Operator validation required" : job?.status === "failed" ? "AI workflow stopped safely" : job?.currentStep === "independent_verification" ? "Independent verification" : "Public-source research";
  const researchStepClass = job?.status === "failed" && failedStage === "research" ? "is-blocked" : job?.status === "researching" ? "is-active" : job ? "is-complete" : "is-active";
  const verificationStepClass = job?.status === "failed" && failedStage === "verification" ? "is-blocked" : job?.status === "verifying" ? "is-active" : ["completed", "needs_review"].includes(job?.status) ? "is-complete" : "";
  const reviewStepClass = ["completed", "needs_review"].includes(job?.status) ? "is-active" : "";
  return <section className="if-operations-workspace" data-event-ai-review={job?.status || "loading"}>
    <section className="if-analytics-panel">
      <header className="if-analytics-panel__header"><div className="if-analytics-panel__heading"><span className={`if-status if-status--sm ${job?.status === "failed" ? "if-status--danger" : job?.status === "needs_review" ? "if-status--warning" : job?.status === "completed" ? "if-status--success" : "if-status--info"}`}>{statusLabel}</span><h2 className="if-analytics-panel__title">{job?.inputSnapshot?.title || job?.mergeResult?.mergedDraft?.title || "Event research review"}</h2><p className="if-analytics-panel__summary">Research: {job?.producerModel || "Loading"} · Verification: {job?.verifierModel || "Loading"}{job?.traceId ? ` · Trace ${job.traceId}` : ""}</p></div><a className="if-btn if-btn--secondary" href="#/budget-spend/tasks">Back to Task Center</a></header>
      <ol className="if-stepper if-stepper--interactive if-stepper--semantic if-stepper--unboxed" style={{ "--step-count": 3 }} aria-label="Event AI workflow status">
        <li className={`if-stepper__step ${researchStepClass}`}><span className="if-stepper__item"><span className="if-stepper__dot">1</span><span className="if-stepper__label">Research</span><span className="if-stepper__meta">{failedStage === "research" ? "Stopped by evidence gate" : "Cited public details"}</span></span></li>
        <li className={`if-stepper__step ${verificationStepClass}`}><span className="if-stepper__item"><span className="if-stepper__dot">2</span><span className="if-stepper__label">Verify</span><span className="if-stepper__meta">{failedStage === "research" ? "Not started" : failedStage === "verification" ? "Stopped during verification" : "Independent schema and evidence check"}</span></span></li>
        <li className={`if-stepper__step ${reviewStepClass}`}><span className="if-stepper__item"><span className="if-stepper__dot">3</span><span className="if-stepper__label">Review</span><span className="if-stepper__meta">{job?.status === "failed" ? "No draft produced" : "Human decision before save"}</span></span></li>
      </ol>
    </section>
    {error ? <div className="if-alert if-alert--danger" role="alert"><CircleAlert size={17} aria-hidden="true" /><div><strong>Review unavailable</strong><p>{error}</p></div></div> : null}
    {active || !job ? <section className="if-analytics-panel" aria-busy="true" data-event-ai-review-placeholder>
      <header className="if-analytics-panel__header"><div className="if-analytics-panel__heading"><h3 className="if-analytics-panel__title">{workingSpinner()}Verified changes will appear here</h3><p className="if-analytics-panel__summary">This workspace will fill with proposed additions, preserved conflicts, rejected claims, and cited sources after both stages finish. You can leave this page; the notification remains available.</p></div></header>
      <div className="if-adapter-state if-adapter-state--loading"><span className="if-adapter-state__icon">{workingSpinner("")}</span><div><strong>{statusLabel}</strong><p>No operator action is required yet.</p></div></div>
    </section> : null}
    {job?.status === "failed" ? <>
      <div className="if-management-grid" aria-label="Stopped AI workflow outcome" data-event-ai-stopped-outcome>
        <article className="if-management-card if-tone-warning"><span className="if-management-card__label">Research</span><strong className="if-management-card__value">{failedStage === "research" ? "Rejected" : "Completed"}</strong><small className="if-management-card__meta">{failedStage === "research" ? "Provider output failed the citation gate" : "Cited proposal reached verification"}</small></article>
        <article className="if-management-card if-tone-neutral"><span className="if-management-card__label">Verification</span><strong className="if-management-card__value">{failedStage === "research" ? "Not started" : "Stopped"}</strong><small className="if-management-card__meta">No independently verified result</small></article>
        <article className="if-management-card if-tone-success"><span className="if-management-card__label">Event record</span><strong className="if-management-card__value">Unchanged</strong><small className="if-management-card__meta">Nothing merged · nothing saved</small></article>
      </div>
      <section className="if-analytics-panel"><header className="if-analytics-panel__header"><div className="if-analytics-panel__heading"><h3 className="if-analytics-panel__title">Why it stopped</h3><p className="if-analytics-panel__summary">{failedStage === "research" ? "The research model returned output, but DBI rejected it before independent verification because the evidence contract was not met." : "Research completed, but independent verification did not produce an eligible draft."}</p></div></header><div className="if-alert if-alert--danger"><CircleAlert size={17} aria-hidden="true" /><div><strong>{job.error?.code || "provider_failed"}</strong><p>{job.error?.message || "The provider stopped before returning a verified result."}</p></div></div></section>
    </> : null}
    {["completed", "needs_review"].includes(job?.status) ? <>
      <div className="if-management-grid" aria-label="AI review summary">
        <article className="if-management-card if-tone-success"><span className="if-management-card__label">Verified additions</span><strong className="if-management-card__value">{job.mergeResult?.changes?.length || 0}</strong><small className="if-management-card__meta">Eligible for the draft</small></article>
        <article className="if-management-card if-tone-warning"><span className="if-management-card__label">Preserved conflicts</span><strong className="if-management-card__value">{job.mergeResult?.conflicts?.length || 0}</strong><small className="if-management-card__meta">Operator values kept</small></article>
        <article className="if-management-card if-tone-neutral"><span className="if-management-card__label">Rejected claims</span><strong className="if-management-card__value">{job.verification?.rejectedClaims?.length || 0}</strong><small className="if-management-card__meta">Excluded before merge</small></article>
        <article className="if-management-card if-tone-info"><span className="if-management-card__label">Cited sources</span><strong className="if-management-card__value">{job.proposal?.sources?.length || 0}</strong><small className="if-management-card__meta">Provider annotations retained</small></article>
      </div>
      <section className="if-analytics-panel" data-event-ai-diff-preview><header className="if-analytics-panel__header"><div className="if-analytics-panel__heading"><h3 className="if-analytics-panel__title">Before / verified draft</h3><p className="if-analytics-panel__summary">Only changed fields are shown. This preview is still unsaved.</p></div><span className="if-badge if-badge--info">{diffRows.length} change{diffRows.length === 1 ? "" : "s"}</span></header>{diffRows.length ? <div className="if-chart-grid" aria-label="Event draft difference preview"><section className="if-detail-card if-detail-card--neutral"><header className="if-detail-card__header"><h4 className="if-detail-card__title">Before</h4></header><div className="if-diff">{diffRows.map((row, index) => <div className="if-diff-line if-diff-line--removed" key={`before-${row.field}`}><span>{index + 1}</span><span><span className="if-badge">{row.label}</span> {row.before}</span></div>)}</div></section><section className="if-detail-card if-detail-card--success"><header className="if-detail-card__header"><h4 className="if-detail-card__title">Verified draft</h4></header><div className="if-diff">{diffRows.map((row, index) => <div className="if-diff-line if-diff-line--added" key={`after-${row.field}`}><span>{index + 1}</span><span><span className="if-badge">{row.label}</span> {row.after}</span></div>)}</div></section></div> : <div className="if-empty-state"><CircleCheck size={20} /><strong>No field differences</strong><p>The verifier did not produce a safe change to the original draft.</p></div>}</section>
      <div className="if-chart-grid">
        <section className="if-analytics-panel"><header className="if-analytics-panel__header"><div className="if-analytics-panel__heading"><h3 className="if-analytics-panel__title">Verified draft changes</h3><p className="if-analytics-panel__summary">These changes remain unsaved until you open and save the draft.</p></div></header>{job.mergeResult?.changes?.length ? <ul className="if-notification-contract-list">{job.mergeResult.changes.map((change) => <li key={change}><CircleCheck size={15} aria-hidden="true" /><span>{change}</span></li>)}</ul> : <div className="if-empty-state"><CircleCheck size={20} /><strong>No safe additions</strong><p>The verifier did not find any cited missing fields to add.</p></div>}{job.mergeResult?.conflicts?.length ? <details className="if-detail-card if-detail-card--warning"><summary>Preserved operator values ({job.mergeResult.conflicts.length})</summary><ul>{job.mergeResult.conflicts.map((conflict, index) => <li key={`${conflict.field || "field"}-${index}`}>{conflict.field || String(conflict)}</li>)}</ul></details> : null}</section>
        <section className="if-analytics-panel"><header className="if-analytics-panel__header"><div className="if-analytics-panel__heading"><h3 className="if-analytics-panel__title">Evidence &amp; exclusions</h3><p className="if-analytics-panel__summary">Open cited sources or inspect claims excluded by verification.</p></div></header><div className="if-action-row-list">{(job.proposal?.sources || []).map((source, index) => <a key={source.url} className="if-action-row" href={source.url} target="_blank" rel="noreferrer"><span className="if-icon-slot"><Link2 size={15} /></span><span><strong>{source.publisher || source.title || `Source ${index + 1}`}</strong><em>{source.url}</em></span><span className="if-badge if-badge--info">Source</span></a>)}</div>{job.verification?.rejectedClaims?.length ? <details className="if-detail-card if-detail-card--neutral"><summary>Rejected claims ({job.verification.rejectedClaims.length})</summary><ul>{job.verification.rejectedClaims.map((claim, index) => <li key={index}>{typeof claim === "string" ? claim : claim.reason || claim.claim || "Unsupported claim"}</li>)}</ul></details> : null}</section>
      </div>
      <section className="if-analytics-panel"><header className="if-analytics-panel__header"><div className="if-analytics-panel__heading"><h3 className="if-analytics-panel__title">Operator decision</h3><p className="if-analytics-panel__summary">Opening the draft does not save it. Review every field, then use the normal Save event action.</p></div>{job.mergeResult?.mergedDraft ? <button type="button" className="if-btn if-btn--ai" onClick={() => onOpenDraft(job.mergeResult.mergedDraft)}><Sparkles size={16} aria-hidden="true" />Open verified draft</button> : null}</header></section>
    </> : null}
  </section>;
}

const TASK_ACTIVE_STATUSES = new Set(["researching", "verifying", "running", "pending"]);
const TASK_ATTENTION_STATUSES = new Set(["needs_review", "failed", "rejected", "rate_limited"]);

function taskStatusLabel(status) {
  return ({ researching: "Researching", verifying: "Verifying", needs_review: "Needs review", completed: "Completed", succeeded: "Completed", failed: "Failed", rejected: "Rejected", rate_limited: "Rate limited", running: "Running", pending: "Pending" })[status] || String(status || "Unknown").replaceAll("_", " ");
}

function taskStatusClass(status) {
  if (["failed", "rejected", "rate_limited"].includes(status)) return "if-status if-status--sm if-status--danger";
  if (status === "needs_review") return "if-status if-status--sm if-status--warning";
  if (TASK_ACTIVE_STATUSES.has(status)) return "if-status if-status--sm if-status--info";
  return "if-status if-status--sm if-status--success";
}

function eventTaskRecord(job) {
  const title = job.inputSnapshot?.title || job.mergeResult?.mergedDraft?.title || "Event research";
  const stoppedStage = job.status === "failed" ? stoppedEventAiStage(job) : "";
  const missingCitations = job.error?.code === "missing_citations";
  return {
    id: `event-ai:${job.id}`,
    sourceId: job.id,
    type: "Event augmentation",
    title,
    status: job.status,
    stage: job.status === "researching" ? "Public research" : job.status === "verifying" ? "Independent verification" : job.status === "failed" ? (stoppedStage === "research" ? "Evidence gate" : "Verification") : "Operator review",
    detail: missingCitations ? "Structured research rejected: no verifiable web-search citations." : job.status === "failed" ? (job.error?.message || "The workflow stopped without changing the event.") : job.status === "completed" ? "Verified changes are ready for review." : job.status === "needs_review" ? "Operator validation is required before saving." : "Background work is in progress.",
    startedAt: job.createdAt,
    updatedAt: job.completedAt || job.updatedAt || job.createdAt,
    traceId: job.traceId || "",
    provider: "OpenAI",
    model: [job.producerModel, job.verifierModel].filter(Boolean).join(" → "),
    job,
  };
}

function apiTaskRecords(apiRequests, eventJobs) {
  const eventTraceIds = new Set(eventJobs.map((job) => job.traceId).filter(Boolean));
  const groups = new Map();
  for (const entry of apiRequests) {
    if (entry.traceId && eventTraceIds.has(entry.traceId)) continue;
    const groupId = entry.traceId || entry.providerRequestId || entry.id;
    const group = groups.get(groupId) || [];
    group.push(entry);
    groups.set(groupId, group);
  }
  return [...groups.entries()].map(([groupId, entries]) => {
    const ordered = entries.slice().sort((left, right) => String(right.at).localeCompare(String(left.at)));
    const latest = ordered[0];
    const terminal = ordered.find((entry) => ["failed", "rejected", "rate_limited"].includes(entry.status)) || latest;
    const status = ["failed", "rejected", "rate_limited"].includes(terminal.status) ? terminal.status : TASK_ACTIVE_STATUSES.has(terminal.status) ? terminal.status : "completed";
    return {
      id: `api:${groupId}`,
      sourceId: groupId,
      type: latest.requestKind === "agent" ? "Agent API" : latest.provider === "openai" ? "AI provider" : "API operation",
      title: String(latest.operation || latest.route || "API request").replaceAll("_", " "),
      status,
      stage: latest.stage || `${entries.length} request${entries.length === 1 ? "" : "s"}`,
      detail: terminal.errorMessage || `${entries.length} retained request stage${entries.length === 1 ? "" : "s"}; ${entries.reduce((total, entry) => total + Number(entry.inputTokens || 0) + Number(entry.outputTokens || 0), 0).toLocaleString()} tokens.`,
      startedAt: ordered.at(-1)?.startedAt || ordered.at(-1)?.at,
      updatedAt: latest.at,
      traceId: latest.traceId || "",
      provider: latest.provider,
      model: latest.model,
      entries: ordered,
    };
  });
}

function ApiTaskDetail({ task }) {
  return <section className="if-analytics-panel" data-api-task-detail>
      <header className="if-analytics-panel__header"><div className="if-analytics-panel__heading"><span className={taskStatusClass(task.status)}>{taskStatusLabel(task.status)}</span><h2 className="if-analytics-panel__title">{task.title}</h2><p className="if-analytics-panel__summary">{task.type}{task.traceId ? ` · Trace ${task.traceId}` : ""}</p></div><a className="if-btn if-btn--secondary" href="#/budget-spend/tasks">Back to Task Center</a></header>
    <div className="if-management-grid">
      <article className="if-management-card if-tone-info"><span className="if-management-card__label">Stage</span><strong className="if-management-card__value">{task.stage}</strong><small className="if-management-card__meta">Latest retained stage</small></article>
      <article className="if-management-card if-tone-neutral"><span className="if-management-card__label">Requests</span><strong className="if-management-card__value">{task.entries.length}</strong><small className="if-management-card__meta">Redacted ledger entries</small></article>
      <article className="if-management-card if-tone-neutral"><span className="if-management-card__label">Provider</span><strong className="if-management-card__value">{task.provider || "DBI"}</strong><small className="if-management-card__meta">{task.model || "No model recorded"}</small></article>
      <article className={`if-management-card ${TASK_ATTENTION_STATUSES.has(task.status) ? "if-tone-danger" : "if-tone-success"}`}><span className="if-management-card__label">Outcome</span><strong className="if-management-card__value">{taskStatusLabel(task.status)}</strong><small className="if-management-card__meta">{task.detail}</small></article>
    </div>
  </section>;
}

function TasksView({ apiRequests, selectedTaskId, onOpenDraft }) {
  const notifications = useNotifications();
  const notificationJobs = notifications?.jobs;
  const tasks = useMemo(() => {
    const eventJobs = notificationJobs || [];
    return [...eventJobs.map(eventTaskRecord), ...apiTaskRecords(apiRequests, eventJobs)].sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)));
  }, [apiRequests, notificationJobs]);
  const selected = tasks.find((task) => task.id === selectedTaskId);
  const columns = [
    { key: "task", label: "Task", required: true, sticky: true, minWidth: 300, value: (task) => task.title, searchValue: (task) => [task.title, task.type, task.stage, task.detail, task.traceId], render: (task) => <><strong>{task.title}</strong><small>{task.detail}</small></> },
    { key: "type", label: "Type", facet: true, minWidth: 145, value: (task) => task.type },
    { key: "status", label: "Status", facet: true, minWidth: 120, value: (task) => taskStatusLabel(task.status), render: (task) => <span className={taskStatusClass(task.status)}>{TASK_ACTIVE_STATUSES.has(task.status) ? workingSpinner("") : null}{taskStatusLabel(task.status)}</span> },
    { key: "stage", label: "Current stage", facet: true, minWidth: 160, value: (task) => task.stage },
    { key: "updated", label: "Updated", minWidth: 165, value: (task) => task.updatedAt || task.startedAt || "", render: (task) => dateTime(task.updatedAt || task.startedAt) },
    { key: "trace", label: "Trace", minWidth: 170, value: (task) => task.traceId || "Not recorded" },
    { key: "actions", label: "Actions", role: "actions", required: true, sortable: false, render: (task) => <div className="dbi-table-actions"><a href={`#/budget-spend/tasks?task=${encodeURIComponent(task.id)}`}>Open</a></div> },
  ];
  const activeCount = tasks.filter((task) => TASK_ACTIVE_STATUSES.has(task.status)).length;
  const attentionCount = tasks.filter((task) => TASK_ATTENTION_STATUSES.has(task.status)).length;
  const completedCount = tasks.filter((task) => ["completed", "succeeded"].includes(task.status)).length;
  const failedCount = tasks.filter((task) => ["failed", "rejected", "rate_limited"].includes(task.status)).length;
  return <section className="ops-panel" data-task-center>
    <header className="ops-panel__header"><div><span>Workspace work</span><h2>Task Center</h2><p>One progress surface for augmentation, provider, and authenticated API tasks.</p></div><button type="button" className="if-btn if-btn--secondary" onClick={() => void notifications?.refresh()}>Refresh</button></header>
    <div className="if-management-grid" aria-label="Task summary">
      <article className="if-management-card if-tone-info"><span className="if-management-card__label">In progress</span><strong className="if-management-card__value">{activeCount}</strong><small className="if-management-card__meta">Background stages running</small></article>
      <article className="if-management-card if-tone-warning"><span className="if-management-card__label">Needs attention</span><strong className="if-management-card__value">{attentionCount}</strong><small className="if-management-card__meta">Review or failure detail available</small></article>
      <article className="if-management-card if-tone-success"><span className="if-management-card__label">Completed</span><strong className="if-management-card__value">{completedCount}</strong><small className="if-management-card__meta">Finished retained tasks</small></article>
      <article className="if-management-card if-tone-danger"><span className="if-management-card__label">Stopped</span><strong className="if-management-card__value">{failedCount}</strong><small className="if-management-card__meta">No silent writes or partial merges</small></article>
    </div>
    {tasks.length ? <OperationalDataTable id="tasks" label="Workspace task progress" rows={tasks} columns={columns} rowKey={(task) => task.id} defaultSort={{ key: "updated", direction: "desc" }} searchPlaceholder="Search tasks, stages, outcomes, traces, and task types…" exportFilename="workspace-tasks.csv" selectable={false} wrapperProps={{ "data-task-table": true }} /> : <div className="ops-empty"><ListChecks size={22} /><strong>No retained tasks</strong><p>Augmentation and API work will appear here after it starts.</p></div>}
    {selected?.job ? <EventAiReview jobId={selected.sourceId} onOpenDraft={onOpenDraft} /> : selected?.entries ? <ApiTaskDetail task={selected} /> : selectedTaskId ? <div className="if-alert if-alert--danger" role="alert"><CircleAlert size={17} aria-hidden="true" /><div><strong>Task not found</strong><p>The task is outside the retained workspace window or is no longer available.</p></div></div> : null}
  </section>;
}

function EventsView({ events, records, categories, canManageCategories, onAdd, onEdit, onDelete, onManageCategories }) {
  const [researchEvent, setResearchEvent] = useState(null);
  const byId = new Map(records.map((record) => [record.opportunityId, record]));
  const columns = [
    { key: "title", label: "Event", required: true, sticky: true, minWidth: 260, value: (event) => event.title, searchValue: (event) => [event.title, event.notes, event.location, ...(event.links || []).flatMap((link) => [link.label, link.url]), ...eventCategoryLabels(event, categories), ...(event.milestones || []).flatMap((milestone) => [milestoneLabel(milestone), milestone.notes])], render: (event) => <><strong>{event.title}</strong><small>{event.location || "Location not set"}</small></> },
    { key: "starts", label: "Starts", minWidth: 160, value: (event) => event.startsAt, render: (event) => dateTime(event.startsAt) },
    { key: "ends", label: "Ends", minWidth: 160, value: (event) => event.endsAt || event.startsAt, render: (event) => dateTime(event.endsAt || event.startsAt) },
    { key: "status", label: "Status", facet: true, value: (event) => event.status || "scheduled", render: (event) => <span className={`dbi-status-badge is-${event.status || "scheduled"}`}>{event.status || "scheduled"}</span> },
    { key: "display", label: "Wallboard", facet: true, value: (event) => event.wallboard ? "Shown" : "Hidden" },
    { key: "categories", label: "Categories", facet: true, minWidth: 150, value: (event) => eventCategoryLabels(event, categories).join(" · ") || "Uncategorized" },
    { key: "links", label: "Links", minWidth: 100, sortValue: (event) => event.links?.length || 0, value: (event) => `${event.links?.length || 0}`, render: (event) => <strong>{event.links?.length || 0}</strong> },
    { key: "milestones", label: "Milestones", minWidth: 120, sortValue: (event) => event.milestones?.length || 0, value: (event) => `${event.milestones?.length || 0}`, render: (event) => <strong>{event.milestones?.length || 0}</strong> },
    { key: "records", label: "Linked records", minWidth: 180, value: (event) => event.recordIds.map((id) => byId.get(id)?.id).filter(Boolean).join(" · ") || "No linked records" },
    { key: "actions", label: "Actions", role: "actions", required: true, sortable: false, render: (event) => <div className="dbi-table-actions"><button type="button" className="if-btn--ai-icon" aria-label={`Research and augment ${event.title}`} title="Research and augment" onClick={() => setResearchEvent(event)}><Sparkles size={14} /></button><button type="button" onClick={() => onEdit(event)}>Edit</button><button type="button" className="is-danger" aria-label={`Delete ${event.title}`} onClick={() => onDelete(event.id)}><Trash2 size={14} />Delete</button></div> },
  ];
  const actions = <><a className="if-btn if-btn--secondary" href="#/budget-spend/tasks">Task Center</a>{canManageCategories ? <button type="button" className="if-btn if-btn--secondary" onClick={onManageCategories}>Manage categories</button> : null}<button type="button" className="if-btn if-btn--primary" onClick={onAdd}><Plus size={15} />Add event</button></>;
  return <section className="ops-panel" data-ops-events><header className="ops-panel__header"><div><span>Workspace work</span><h2>Events</h2><p>Schedule, filter, edit, or launch augmentation from a specific event row.</p></div></header>{events.length ? <OperationalDataTable id="events" label="Operator events" rows={events} columns={columns} rowKey={(event) => event.id} defaultSort={{ key: "starts", direction: "asc" }} searchPlaceholder="Search events, locations, links, categories, attendees, milestones, and notes…" exportFilename="operator-events.csv" toolbarActions={actions} wrapperProps={{ "data-ops-event-table": true }} renderDetail={(event) => <div className="dbi-table-detail-grid"><article><span>Categories</span><strong>{eventCategoryLabels(event, categories).join(" · ") || "Uncategorized"}</strong></article><article><span>Links</span><strong>{event.links?.map((link) => link.label || link.url).join(" · ") || "None"}</strong></article><article><span>Attendees</span><strong>{event.attendees?.map((attendee) => attendee.displayName).join(" · ") || "None assigned"}</strong></article><article><span>Deadlines &amp; milestones</span><strong>{event.milestones?.map((milestone) => `${milestoneLabel(milestone)} · ${compactDate(milestone.occursAt)}`).join(" · ") || "None published"}</strong></article><article><span>Notes</span><strong>{event.notes || "No notes"}</strong></article><article><span>Linked record IDs</span><strong>{event.recordIds.join(" · ") || "None"}</strong></article></div>} /> : <div className="ops-empty"><CalendarDays size={22} /><strong>No operator events</strong><p>Add meetings, checkpoints, or reviews and optionally publish them to the wallboard.</p>{canManageCategories ? <button type="button" className="if-btn if-btn--secondary" onClick={onManageCategories}>Manage categories</button> : null}<button type="button" className="if-btn if-btn--primary" onClick={onAdd}><Plus size={15} />Add event</button></div>}{researchEvent ? <EventAiLauncher key={researchEvent.id} event={researchEvent} onClose={() => setResearchEvent(null)} /> : null}</section>;
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
    { name: "Known contract monitor", status: contractMonitor.metadata?.status || "unavailable", count: `${Number(contractMonitor.metadata?.coveredCount || 0).toLocaleString()} of ${Number(contractMonitor.metadata?.targetCount || 0).toLocaleString()} covered`, detail: "Exact award-detail refresh across active, upcoming, option-horizon, and unresolved records" },
  ];
  const columns = [
    { key: "name", label: "Integration", required: true, sticky: true, minWidth: 230, value: (row) => row.name, render: (row) => <><strong>{row.name}</strong><small>{row.detail}</small></> },
    { key: "status", label: "Status", facet: true, minWidth: 110, value: (row) => row.status, render: (row) => <span className={`dbi-status-badge is-${String(row.status).toLowerCase().replaceAll(" ", "-")}`}>{row.status}</span> },
    { key: "count", label: "Current yield", minWidth: 150, value: (row) => row.count, render: (row) => <strong>{row.count}</strong> },
    { key: "health", label: "Health checked", value: () => dateTime(sourceHealth.metadata?.checkedAt) },
  ];
  return <section className="ops-panel" data-ops-integrations><header className="ops-panel__header"><div><span>Connector operations</span><h2>Integrations</h2></div><a href="#/budget-spend/sources">Open full lineage<ChevronRight size={15} /></a></header><OpenAiKeyManagement auth={auth} scope="workspace" embedded /><IntegrationFreshness budgetGeneratedAt={budgetGeneratedAt} awardGeneratedAt={awardGeneratedAt} /><ContractMonitorCoverage /><div className="ops-integration-summary"><article><strong>{sourceHealth.totals?.online || 0}</strong><span>sources online</span></article><article><strong>{sourceHealth.totals?.unavailable || 0}</strong><span>unavailable at probe</span></article><article><strong>{dateTime(sourceHealth.metadata?.checkedAt)}</strong><span>health checked</span></article></div><OperationalDataTable id="integrations" label="Integration status" rows={rows} columns={columns} rowKey={(row) => row.name} defaultSort={{ key: "name", direction: "asc" }} searchPlaceholder="Search integrations and feed details…" exportFilename="integration-status.csv" selectable={false} wrapperProps={{ "data-ops-integration-table": true }} /></section>;
}

function ActivityView({ activity, apiRequests = [], apiRequestSummary = null, records }) {
  const byId = new Map(records.map((record) => [record.opportunityId, record]));
  const activityColumns = [
    { key: "at", label: "Time", required: true, sticky: true, minWidth: 170, value: (entry) => entry.at, render: (entry) => dateTime(entry.at) },
    { key: "type", label: "Event", facet: true, minWidth: 150, value: (entry) => entry.type.replaceAll("_", " "), render: (entry) => <strong>{entry.type.replaceAll("_", " ")}</strong> },
    { key: "detail", label: "Detail", minWidth: 280, role: "prose", value: (entry) => entry.detail },
    { key: "actor", label: "Actor", facet: true, minWidth: 130, value: (entry) => entry.actorType || "operator", render: (entry) => <><strong>{entry.actorType || "operator"}</strong>{entry.actorId ? <small>{entry.actorId}</small> : null}</> },
    { key: "record", label: "Record", minWidth: 210, value: (entry) => byId.get(entry.recordId)?.id || entry.recordId || "Not linked", render: (entry) => { const record = byId.get(entry.recordId); return record ? <a className="dbi-table-record-link" href={`#/budget-spend/transactions?capRecord=${encodeURIComponent(record.opportunityId)}`}><strong>{record.id}</strong><small>{record.title}</small></a> : (entry.recordId || "Not linked"); } },
  ];
  const requestColumns = [
    { key: "at", label: "Time", required: true, sticky: true, minWidth: 170, value: (entry) => entry.at, render: (entry) => dateTime(entry.at) },
    { key: "status", label: "Status", facet: true, minWidth: 120, value: (entry) => entry.status, render: (entry) => <span className={`dbi-status-badge is-${entry.status}`}>{entry.status.replaceAll("_", " ")}</span> },
    { key: "operation", label: "Operation", facet: true, minWidth: 220, value: (entry) => `${entry.provider} ${entry.operation}`, render: (entry) => <><strong>{entry.operation}</strong><small>{entry.provider}{entry.model ? ` · ${entry.model}` : ""}</small></> },
    { key: "route", label: "Interface", facet: true, minWidth: 190, value: (entry) => entry.route || entry.requestKind, render: (entry) => <><strong>{entry.method ? `${entry.method} ` : ""}{entry.route || entry.requestKind}</strong><small>{entry.requestKind.replaceAll("_", " ")}{entry.credentialScope ? ` · ${entry.credentialScope} key` : ""}</small></> },
    { key: "latency", label: "Latency", minWidth: 105, sortValue: (entry) => entry.latencyMs, value: (entry) => entry.latencyMs ? `${entry.latencyMs} ms` : "Not measured" },
    { key: "tokens", label: "Tokens", minWidth: 120, sortValue: (entry) => entry.inputTokens + entry.outputTokens, value: (entry) => entry.inputTokens || entry.outputTokens ? `${entry.inputTokens.toLocaleString()} in · ${entry.outputTokens.toLocaleString()} out` : "Not applicable" },
    { key: "actor", label: "Principal", facet: true, minWidth: 150, value: (entry) => `${entry.principalType} ${entry.principalId}`, render: (entry) => <><strong>{entry.principalType || "system"}</strong><small>{entry.principalId || "system"}</small></> },
    { key: "trace", label: "Trace", minWidth: 190, value: (entry) => entry.traceId || entry.providerRequestId || entry.responseId || "Unavailable", render: (entry) => <code>{entry.traceId || entry.providerRequestId || entry.responseId || "Unavailable"}</code> },
    { key: "error", label: "Safe diagnostic", minWidth: 220, role: "prose", value: (entry) => entry.errorCode || entry.errorMessage || "None", render: (entry) => entry.errorCode || entry.errorMessage ? <><strong>{entry.errorCode || "request_failed"}</strong>{entry.errorMessage ? <small>{entry.errorMessage}</small> : null}</> : "None" },
  ];
  const summary = apiRequestSummary || { retained: apiRequests.length, requests: apiRequests.filter((entry) => entry.requestKind !== "credential_lifecycle").length, successRate: null, averageLatencyMs: 0, p95LatencyMs: 0, inputTokens: 0, outputTokens: 0 };
  const callEntries = apiRequests.filter((entry) => entry.requestKind !== "credential_lifecycle");
  const trend = (() => {
    const ordered = callEntries.map((entry) => ({ ...entry, timestamp: Date.parse(entry.at || "") })).filter((entry) => Number.isFinite(entry.timestamp)).sort((left, right) => left.timestamp - right.timestamp);
    if (ordered.length < 2) return null;
    const bucketCount = Math.min(8, Math.max(2, Math.ceil(Math.sqrt(ordered.length))));
    const start = ordered[0].timestamp;
    const end = Math.max(ordered.at(-1).timestamp, start + 1);
    const span = end - start;
    const buckets = Array.from({ length: bucketCount }, (_, index) => ({ index, entries: [] }));
    ordered.forEach((entry) => buckets[Math.min(bucketCount - 1, Math.floor(((entry.timestamp - start) / span) * bucketCount))].entries.push(entry));
    const dateOptions = span > 2 * 86400000 ? { month: "short", day: "numeric" } : { hour: "numeric", minute: "2-digit" };
    const labels = buckets.map((bucket) => new Date(start + (bucket.index / Math.max(1, bucketCount - 1)) * span).toLocaleString([], dateOptions));
    return {
      labels,
      requests: buckets.map((bucket) => bucket.entries.length),
      success: buckets.map((bucket) => bucket.entries.length ? Math.round((bucket.entries.filter((entry) => entry.status === "succeeded").length / bucket.entries.length) * 100) : 0),
      latency: buckets.map((bucket) => { const measured = bucket.entries.map((entry) => Number(entry.latencyMs || 0)).filter(Boolean); return measured.length ? Math.round(measured.reduce((total, value) => total + value, 0) / measured.length) : 0; }),
      tokens: buckets.map((bucket) => bucket.entries.reduce((total, entry) => total + Number(entry.inputTokens || 0) + Number(entry.outputTokens || 0), 0)),
    };
  })();
  const outcomeRows = ["succeeded", "rejected", "failed", "rate_limited"].map((status) => ({
    id: status,
    label: status === "rate_limited" ? "Rate limited" : status[0].toUpperCase() + status.slice(1),
    value: callEntries.filter((entry) => entry.status === status).length,
  })).filter((row) => row.value > 0);
  const outcomeMaximum = Math.max(...outcomeRows.map((row) => row.value), 1);
  const latencyByOperation = [...callEntries.reduce((groups, entry) => {
    const key = entry.operation || entry.route || "request";
    const current = groups.get(key) || { id: key, label: key.replaceAll("_", " "), total: 0, count: 0 };
    current.total += Number(entry.latencyMs || 0);
    current.count += 1;
    groups.set(key, current);
    return groups;
  }, new Map()).values()].map((row) => ({ ...row, value: Math.round(row.total / row.count) })).sort((left, right) => right.value - left.value).slice(0, 6);
  const latencyMaximum = Math.max(...latencyByOperation.map((row) => row.value), 1);
  return <section className="ops-panel if-operations-workspace" data-ops-activity>
    <header className="ops-panel__header"><div><span>Redacted workspace observability</span><h2>API & activity log</h2><p>Request metadata and append-only changes are retained without secrets, authorization headers, prompts, or response bodies.</p></div><small>90-day API retention</small></header>
    <div className="if-management-grid" aria-label="API request summary" data-api-request-summary>
      <article className="if-management-card if-tone-info"><span className="if-management-card__label">Requests</span><strong className="if-management-card__value">{Number(summary.requests || 0).toLocaleString()}</strong>{trend ? <ControlSparkline values={trend.requests} labels={trend.labels} label="Requests over the retained window" formatValue={(value) => `${value} requests`} /> : null}<small className="if-management-card__meta">{Number(summary.retained || 0).toLocaleString()} retained entries</small></article>
      <article className={`if-management-card ${summary.successRate === null || summary.successRate >= 99 ? "if-tone-success" : summary.successRate >= 95 ? "if-tone-warning" : "if-tone-danger"}`}><span className="if-management-card__label">Success rate</span><strong className="if-management-card__value">{summary.successRate === null ? "No calls" : `${summary.successRate}%`}</strong>{trend ? <ControlSparkline values={trend.success} labels={trend.labels} label="Success rate over the retained window" formatValue={(value) => `${value}%`} /> : null}<small className="if-management-card__meta">Current retained window</small></article>
      <article className="if-management-card if-tone-neutral"><span className="if-management-card__label">Average latency</span><strong className="if-management-card__value">{Number(summary.averageLatencyMs || 0).toLocaleString()} ms</strong>{trend ? <ControlSparkline values={trend.latency} labels={trend.labels} label="Average latency over the retained window" formatValue={(value) => `${value} ms`} /> : null}<small className="if-management-card__meta">P95 {Number(summary.p95LatencyMs || 0).toLocaleString()} ms</small></article>
      <article className="if-management-card if-tone-purple"><span className="if-management-card__label">Token usage</span><strong className="if-management-card__value">{(Number(summary.inputTokens || 0) + Number(summary.outputTokens || 0)).toLocaleString()}</strong>{trend ? <ControlSparkline values={trend.tokens} labels={trend.labels} label="Token usage over the retained window" formatValue={(value) => `${value} tokens`} /> : null}<small className="if-management-card__meta">{Number(summary.inputTokens || 0).toLocaleString()} in · {Number(summary.outputTokens || 0).toLocaleString()} out</small></article>
    </div>
    {callEntries.length ? <div className="if-chart-grid" aria-label="API request charts" data-api-observability-charts>
      <article className="if-chart-card">
        <header className="if-chart-card__header"><div><h3 className="if-chart-card__title">Request outcomes</h3><p className="if-chart-card__meta">Retained calls by final status</p></div><span className="if-badge if-badge--info">Status</span></header>
        <div className="if-chart"><div className="if-chart__bars">{outcomeRows.map((row, index) => <div className="if-chart-bar" key={row.id} aria-label={`${row.label}: ${row.value.toLocaleString()} requests`}><span className="if-chart-bar__label">{row.label}</span><span className="if-chart-bar__track"><i className="if-chart-bar__fill" style={{ "--bar": `${(row.value / outcomeMaximum) * 100}%`, "--i": index }} /></span><strong>{row.value.toLocaleString()}</strong></div>)}</div></div>
        <footer className="if-chart-legend"><span><i />Bars = retained request count</span></footer>
      </article>
      <article className="if-chart-card">
        <header className="if-chart-card__header"><div><h3 className="if-chart-card__title">Average latency by operation</h3><p className="if-chart-card__meta">Slowest retained operations, highest first</p></div><span className="if-badge if-badge--info">Latency</span></header>
        <div className="if-chart"><div className="if-chart__bars">{latencyByOperation.map((row, index) => <div className="if-chart-bar" key={row.id} aria-label={`${row.label}: ${row.value.toLocaleString()} milliseconds average`}><span className="if-chart-bar__label">{row.label}</span><span className="if-chart-bar__track"><i className="if-chart-bar__fill" style={{ "--bar": `${(row.value / latencyMaximum) * 100}%`, "--i": index }} /></span><strong>{row.value.toLocaleString()} ms</strong></div>)}</div></div>
        <footer className="if-chart-legend"><span><i />Bars = mean measured latency</span></footer>
      </article>
    </div> : null}
    <section className="if-analytics-panel" aria-labelledby="api-request-log-title">
      <header className="if-analytics-panel__header"><div className="if-analytics-panel__heading"><h3 className="if-analytics-panel__title" id="api-request-log-title">API requests</h3><p className="if-analytics-panel__summary">Agent API calls today; OpenAI provider IDs, token counts, retries, latency, and safe errors will appear here when contextual actions are enabled.</p></div><strong className="if-analytics-panel__count">{apiRequests.length}</strong></header>
      {apiRequests.length ? <OperationalDataTable id="api-requests" label="API request log" rows={apiRequests} columns={requestColumns} rowKey={(entry) => entry.id} defaultSort={{ key: "at", direction: "desc" }} searchPlaceholder="Search operations, routes, principals, traces, and diagnostics…" exportFilename="api-request-log.csv" selectable={false} wrapperProps={{ "data-api-request-table": true }} /> : <div className="ops-empty"><Activity size={22} /><strong>No API requests retained</strong><p>Authenticated Agent API calls and future OpenAI requests will appear here.</p></div>}
    </section>
    <section className="if-analytics-panel" aria-labelledby="workspace-activity-title">
      <header className="if-analytics-panel__header"><div className="if-analytics-panel__heading"><h3 className="if-analytics-panel__title" id="workspace-activity-title">Workspace changes</h3><p className="if-analytics-panel__summary">Append-only human and agent mutations across the shared workspace.</p></div><strong className="if-analytics-panel__count">{activity.length}</strong></header>
      {activity.length ? <OperationalDataTable id="workspace-activity" label="Workspace activity log" rows={activity} columns={activityColumns} rowKey={(entry) => entry.id} defaultSort={{ key: "at", direction: "desc" }} searchPlaceholder="Search events, actors, details, and record IDs…" exportFilename="workspace-activity-log.csv" selectable={false} wrapperProps={{ "data-ops-activity-table": true }} /> : <div className="ops-empty"><Activity size={22} /><strong>No operator activity</strong><p>Human and agent changes will be recorded here.</p></div>}
    </section>
  </section>;
}

function WallboardView({ records, watchlist, events, categories, asOf, workspace, lastRefreshedAt }) {
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
    {mode === "overview" ? <div className="ops-wallboard__split"><WallboardRecords records={visibleRecords.slice(0, 8)} asOf={asOf} watchById={watchById} /><WallboardSchedule events={upcomingEvents.slice(0, 5)} /></div> : mode === "events" ? <WallboardSchedule events={upcomingEvents.slice(0, 6)} now={now} focus /> : mode === "calendar" ? <WallboardCalendar events={wallboardEvents} categories={categories} month={calendarMonth} onMonthChange={setCalendarMonth} now={now} workspace={workspace} /> : <WallboardRecords records={visibleRecords.slice(0, 12)} asOf={asOf} watchById={watchById} />}
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

function CalendarHoverCard({ hover, categories }) {
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
    {event.categoryIds?.length ? <p><b>Categories</b>{eventCategoryLabels(event, categories).join(" · ")}</p> : null}
    {attendees.length ? <p><b>Attending</b>{attendees.map((attendee) => attendee.displayName).join(" · ")}</p> : null}
    {(milestone?.notes || (!milestone && event.notes)) ? <p><b>Context</b>{milestone?.notes || event.notes}</p> : null}
    <footer>Workspace event calendar · hover or keyboard focus for context</footer>
  </aside>, document.body);
}

function CalendarEventModal({ detail, categories, onClose }) {
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
          <div><dt>Categories</dt><dd>{eventCategoryLabels(event, categories).join(" · ") || "Uncategorized"}</dd></div>
          <div><dt>Linked records</dt><dd>{event.recordIds?.length || "None"}</dd></div>
          <div><dt>Milestones</dt><dd>{event.milestones?.length || "None"}</dd></div>
        </dl>
        {event.attendees?.length ? <section><h3>Attendees</h3><div className="ops-event-detail__attendees">{event.attendees.map((attendee) => <span key={attendee.id || attendee.displayName}><UserAvatar user={attendee} size={34} decorative={false} /><span><strong>{attendee.displayName}</strong><small>{attendee.title || "Workspace member"}</small></span></span>)}</div></section> : null}
        {event.links?.length ? <section><h3>Event links</h3><div>{event.links.map((link) => <a key={link.id} className="if-btn if-btn--secondary" href={link.url} target="_blank" rel="noreferrer"><Link2 size={15} aria-hidden="true" />{link.label || new URL(link.url).hostname}</a>)}</div></section> : null}
        {event.milestones?.length ? <section><h3>Deadlines &amp; milestones</h3><div className="ops-event-detail__milestones">{event.milestones.map((entry) => <article key={entry.id} className={milestone?.id === entry.id ? "is-focused" : ""}><i aria-hidden="true" /><span><strong>{milestoneLabel(entry)}</strong><small>{milestoneTypeLabel(entry.type)}</small></span><time dateTime={entry.occursAt}>{compactDate(entry.occursAt)}</time>{entry.notes ? <p>{entry.notes}</p> : null}</article>)}</div></section> : null}
        {(milestone?.notes || event.notes) ? <section className="ops-event-detail__context"><h3>Context</h3><p>{milestone?.notes || event.notes}</p></section> : null}
  </ControlDialog>;
}

function WallboardCalendar({ events, categories, month, onMonthChange, now, workspace }) {
  const [hover, setHover] = useState(null);
  const [detail, setDetail] = useState(null);
  const [selectedCategoryIds, setSelectedCategoryIds] = useState([]);
  const selectedCategorySet = useMemo(() => new Set(selectedCategoryIds), [selectedCategoryIds]);
  const filteredEvents = selectedCategoryIds.length
    ? events.filter((event) => (event.categoryIds || []).some((categoryId) => selectedCategorySet.has(categoryId)))
    : events;
  const days = monthCalendarDays(month);
  const today = now.toISOString().slice(0, 10);
  const currentMonth = today.slice(0, 7);
  const monthDate = new Date(`${month}-01T00:00:00Z`);
  const monthLabel = monthDate.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
  const monthStart = `${month}-01`;
  const monthEnd = `${month}-${String(new Date(Date.UTC(monthDate.getUTCFullYear(), monthDate.getUTCMonth() + 1, 0)).getUTCDate()).padStart(2, "0")}`;
  const monthEvents = filteredEvents.filter((event) => String(event.startsAt || "").slice(0, 10) <= monthEnd && String(event.endsAt || event.startsAt || "").slice(0, 10) >= monthStart);
  const monthMilestones = filteredEvents.flatMap((event) => (event.milestones || []).filter((milestone) => String(milestone.occursAt || "").slice(0, 10) >= monthStart && String(milestone.occursAt || "").slice(0, 10) <= monthEnd));
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
        <ControlMultiSelect label="Event types" placeholder="All event types" value={selectedCategoryIds} options={categories.map((category) => ({ value: category.id, label: category.name, description: category.description, meta: `${category.assignedEventCount || 0}` }))} onChange={setSelectedCategoryIds} searchable clearable compact triggerProps={{ "data-calendar-category-filter": true }} />
        <button type="button" aria-label="Previous month" onClick={() => onMonthChange(shiftMonth(month, -1))}><ChevronLeft size={17} aria-hidden="true" /></button>
        <button type="button" onClick={() => onMonthChange(currentMonth)}>Today</button>
        <button type="button" aria-label="Next month" onClick={() => onMonthChange(shiftMonth(month, 1))}><ChevronRight size={17} aria-hidden="true" /></button>
        <b aria-label={`${monthEvents.length} events and ${monthMilestones.length} milestones in ${monthLabel}`}>{monthEvents.length}<small>+{monthMilestones.length}</small></b>
      </div>
    </header>
    <div className="ops-wall-calendar__viewport" tabIndex="0" aria-label={`${monthLabel} event calendar`}>
      <div className="ops-wall-calendar__weekdays" aria-hidden="true">{["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => <span key={day}>{day}</span>)}</div>
      <div className="ops-wall-calendar__weeks">{weeks.map((week) => {
        const segments = calendarWeekSegments(filteredEvents, week);
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
              <i aria-hidden="true" /><div className="ops-wall-calendar__bar-copy"><strong>{milestone ? milestoneLabel(milestone) : event.title}</strong><span>{milestone ? event.title : event.location || "Location not set"}</span></div>{!milestone && event.attendees?.length ? <span className="if-profile-avatar-stack ops-wall-calendar__bar-attendees" aria-label={`${event.attendees.length} attendee${event.attendees.length === 1 ? "" : "s"}`}>{event.attendees.slice(0, 3).map((attendee) => <UserAvatar key={attendee.id} user={attendee} className="if-profile-avatar" />)}{event.attendees.length > 3 ? <b className="if-profile-avatar">+{event.attendees.length - 3}</b> : null}</span> : null}
            </div>;
          })}</div>
        </section>;
      })}</div>
    </div>
    <CalendarHoverCard hover={hover} categories={categories} />
    <CalendarEventModal detail={detail} categories={categories} onClose={() => setDetail(null)} />
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
  const notifications = useNotifications();
  const records = useMemo(() => applyProcurementChanges(assembleProcurementRecords(dataset.records || [], awards, dataset.metadata.asOf, samOpportunities.records || [], manualProcurement.records || [], subawardSnapshot), procurementDelta.records || []), [awards, dataset, manualProcurement.records, procurementDelta.records, samOpportunities.records, subawardSnapshot]);
  const state = useManagementState(records);
  const view = VIEWS.some(([id]) => id === requestedView) ? requestedView : "watchlist";
  const [query, setQuery] = useState("");
  const [editor, setEditor] = useState(null);
  const [selectedTaskId, setSelectedTaskId] = useState(() => {
    const params = new URLSearchParams(window.location.hash.split("?")[1] || "");
    return params.get("task") || (params.get("aiJob") ? `event-ai:${params.get("aiJob")}` : "");
  });
  const [categoryManagerOpen, setCategoryManagerOpen] = useState(false);
  useEffect(() => {
    const sync = () => {
      const params = new URLSearchParams(window.location.hash.split("?")[1] || "");
      setSelectedTaskId(params.get("task") || (params.get("aiJob") ? `event-ai:${params.get("aiJob")}` : ""));
    };
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);
  const watchedRecords = state.watchlist.map((entry) => records.find((record) => record.opportunityId === entry.recordId)).filter(Boolean);
  const reviewHorizon = useMemo(() => {
    const horizon = new Date(`${dataset.metadata.asOf}T00:00:00Z`);
    horizon.setUTCDate(horizon.getUTCDate() + 30);
    return horizon.toISOString().slice(0, 10);
  }, [dataset.metadata.asOf]);
  const dueReviews = state.watchlist.filter((entry) => entry.reviewAt && entry.reviewAt <= reviewHorizon).length;
  const copy = VIEW_COPY[view];
  const areaKey = controlAreaForView(view);
  const area = CONTROL_AREAS[areaKey];
  const visibleAreaViews = VIEWS.filter(([id]) => area.ids.includes(id));
  return <div className={`operations-hub operations-hub--${view}`} data-operations-hub data-operations-view={view}>
    {view !== "wallboard" ? <section className="if-admin-control-surface admin-console" data-admin-control-surface data-admin-workspace data-control-area={areaKey}>
      <header className="admin-console__header">
        <div>
          <span>{area.eyebrow}</span>
          <h2>{area.title}</h2>
          <p>{area.description}</p>
        </div>
        <span className={`if-status if-status--sm ${area.tone}`}>{area.eyebrow}</span>
      </header>
      {areaKey === "work" ? <div className="admin-console__metrics" aria-label="Workspace work summary">
        <article><span>Tracked</span><strong>{state.watchlist.length}</strong><small>records</small></article>
        <article><span>Reviews due</span><strong>{dueReviews}</strong><small>within 30 days</small></article>
        <article><span>Events</span><strong>{state.events.length}</strong><small>scheduled</small></article>
        <article><span>Tasks running</span><strong>{notifications?.activeCount || 0}</strong><small>background work</small></article>
      </div> : null}
      <nav className="admin-console__nav" aria-label={`${area.eyebrow} sections`}>
        {visibleAreaViews.filter(([id]) => !["users", "workspaces", "workspace-settings", "agents"].includes(id)
          || (id === "users" ? auth?.user?.canManageUsers
            : id === "workspaces" ? auth?.user?.roleId === "super_user"
              : id === "workspace-settings" ? auth?.user?.canManageWorkspaces
                : auth?.user?.canManageAgents)).map(([id, label, Icon]) => <a key={id} href={ADMIN_ROUTES[id]} className={view === id ? "is-active" : ""} aria-current={view === id ? "page" : undefined}><Icon size={15} aria-hidden="true" /><span>{label}</span></a>)}
      </nav>
      <div className="admin-console__context" aria-live="polite"><span>{copy[0]}</span><strong>{copy[1]}</strong><small>{copy[2]}</small></div>
    </section> : null}
    {state.error ? <p className="ops-alert" role="alert">Workspace sync failed: {state.error}</p> : null}
    {view === "watchlist" ? <WatchlistView rows={watchedRecords} watchlist={state.watchlist} asOf={dataset.metadata.asOf} query={query} setQuery={setQuery} toggleWatch={state.toggleWatch} updateWatch={state.updateWatch} /> : null}
    {view === "events" ? <EventsView events={state.events} records={watchedRecords} categories={state.eventCategories} canManageCategories={Boolean(auth?.user?.canManageWorkspaces)} onAdd={() => setEditor({ mode: "add" })} onEdit={(event) => setEditor({ mode: "edit", event })} onDelete={state.deleteEvent} onManageCategories={() => setCategoryManagerOpen(true)} /> : null}
    {view === "tasks" ? <TasksView apiRequests={state.apiRequests} selectedTaskId={selectedTaskId} onOpenDraft={(event) => setEditor({ mode: "review", event })} /> : null}
    {view === "integrations" ? <IntegrationsView auth={auth} dataset={dataset} samOpportunities={samOpportunities} manualProcurement={manualProcurement} procurementDelta={procurementDelta} subawardSnapshot={subawardSnapshot} budgetGeneratedAt={budgetGeneratedAt} awardGeneratedAt={awardGeneratedAt} /> : null}
    {view === "activity" ? <ActivityView activity={state.activity} apiRequests={state.apiRequests} apiRequestSummary={state.apiRequestSummary} records={records} remote={state.remote} /> : null}
    {view === "users" ? auth?.user?.canManageUsers ? <UserManagement auth={auth} /> : <section className="ops-panel ops-empty" data-users-unavailable><UsersRound size={22} /><strong>Administrator access required</strong><p>Your role cannot manage human accounts.</p></section> : null}
    {view === "workspaces" ? auth?.user?.roleId === "super_user" ? <WorkspaceManagement auth={auth} /> : <section className="ops-panel ops-empty" data-workspaces-unavailable><Building2 size={22} /><strong>Super user access required</strong><p>Cross-workspace administration is limited to the immutable Super user.</p></section> : null}
    {view === "workspace-settings" ? auth?.user?.canManageWorkspaces ? <WorkspaceManagement auth={auth} activeOnly /> : <section className="ops-panel ops-empty" data-workspaces-unavailable><Building2 size={22} /><strong>Workspace manager access required</strong><p>Your role cannot configure this workspace.</p></section> : null}
    {view === "agents" ? auth?.user?.canManageAgents ? <AgentAccessPanel auth={auth} embedded /> : <section className="ops-panel ops-empty" data-profile-agents-unavailable><Bot size={22} /><strong>Administrator access required</strong><p>Your role cannot issue or revoke agent credentials.</p></section> : null}
    {view === "wallboard" ? <WallboardView records={records} watchlist={state.watchlist} events={state.events} categories={state.eventCategories} asOf={dataset.metadata.asOf} workspace={auth?.user?.activeWorkspace || null} lastRefreshedAt={state.lastRefreshedAt} /> : null}
    {editor ? <EventEditor event={editor.mode === "add" ? null : editor.event} review={editor.mode === "review"} records={watchedRecords} categories={state.eventCategories} onSave={state.saveEvent} onClose={() => setEditor(null)} /> : null}
    {categoryManagerOpen ? <EventCategoryManager categories={state.eventCategories} onSave={state.saveEventCategory} onDelete={state.deleteEventCategory} onClose={() => setCategoryManagerOpen(false)} /> : null}
    {view !== "wallboard" ? <section className="operations-boundary"><Database size={17} /><p><strong>State boundary:</strong> {state.remote ? "stars, notes, review dates, events, and activity are stored in the authenticated D1 workspace and shared with scoped agents." : "this static fallback stores stars, notes, review dates, events, and activity only in this browser."} Operator state never changes source-backed evidence, public JSON, evidence exports, or shareable record URLs.</p></section> : null}
  </div>;
}
