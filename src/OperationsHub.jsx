import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  Bot,
  CalendarDays,
  Building2,
  Link2,
  ListChecks,
  Maximize2,
  Minimize2,
  Pencil,
  Plus,
  RotateCw,
  Sparkles,
  CircleAlert,
  CircleCheck,
  Star,
  Tags,
  Trash2,
  UsersRound,
} from "lucide-react";
import WorkspaceMark from "./WorkspaceMark.jsx";
import TeamAvatar from "./TeamAvatar.jsx";
import EventTeamSelector from "./EventTeamSelector.jsx";
import OperationalDataTable from "./OperationalDataTable.jsx";
import { useAuth } from "./AuthContext.jsx";
import { applyProcurementChanges, assembleProcurementRecords, WORK_CATEGORY_BY_ID } from "./procurement-taxonomy.js";
import { useManagementState } from "./management-state.js";
import SearchMultiSelect from "./SearchMultiSelect.jsx";
import { ApiTaskActivity, EventTaskActivity } from "./TaskActivity.jsx";
import ControlSelect from "./ControlSelect.jsx";
import { ControlAsyncState, ControlChangeList, ControlCollectionEditor, ControlDialog, ControlDisclosure, ControlMetricStrip, ControlPageBody, ControlPageHeader, ControlProgressRail, ControlSparkline, ControlStatusBadge } from "control-surface-ui/react";
import ControlWorkbenchHeader from "./WorkbenchHeader.jsx";
import { useNotifications } from "./NotificationContext.jsx";
import { directorySelection, openWorkspaceProfile, workspaceTeamHref } from "./workspace-profile-routes.js";

const AgentAccessPanel = lazy(() => import("./ProfilePage.jsx").then((module) => ({ default: module.AgentAccessPanel })));
const OpenAiKeyManagement = lazy(() => import("./OpenAiKeyManagement.jsx"));
const SamGovKeyManagement = lazy(() => import("./SamGovKeyManagement.jsx"));
const IntegrationManagement = lazy(() => import("./IntegrationManagement.jsx"));
const AcquisitionOperations = lazy(() => import("./AcquisitionOperations.jsx"));
const UserManagement = lazy(() => import("./UserManagement.jsx"));
const WorkspaceManagement = lazy(() => import("./WorkspaceManagement.jsx"));
const WallboardCalendar = lazy(() => import("./WallboardCalendar.jsx"));
const WorkspaceMemberProfile = lazy(() => import("./WorkspaceMemberProfile.jsx"));
const WorkspaceTeamProfile = lazy(() => import("./WorkspaceTeamProfile.jsx"));

const VIEWS = new Set(["watchlist", "schedule", "tasks", "connections", "users", "workspaces", "workspace-settings", "directory"]);

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
    teamIds: [],
    milestones: [],
    wallboard: true,
  };
}

function workingSpinner(size = "sm") {
  return <span className={`if-loading-dots if-loading-dots--orbit${size ? ` if-loading-dots--${size}` : ""}`} aria-hidden="true"><span /><span /><span /></span>;
}

function RouteFallback({ title }) {
  return <section className="ops-panel"><ControlAsyncState compact state="loading" title={`Loading ${title}`} message="Preparing the focused workspace surface." /></section>;
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
          <li className="if-stepper__step"><span className="if-stepper__item"><span className="if-stepper__dot">3</span><span className="if-stepper__label">Apply or review</span><span className="if-stepper__meta">Workspace policy decides the safe outcome</span></span></li>
        </ol>
        <p className="if-field__hint">{auth?.user?.activeWorkspace?.autoAcceptAiAugmentations ? "Verified, additive, conflict-free changes apply automatically. Anything uncertain remains pending for validation." : "Verified changes remain pending until an operator reviews and saves the draft."} Conflicts, rejected claims, sources, models, and the trace stay available in Task Center.</p>
      </div>
      {inventory ? <p className="if-field__hint if-field--full">{inventory.capabilityNotice} {modelOptions.length} compatible text model{modelOptions.length === 1 ? "" : "s"} shown from this credential’s project.</p> : null}
      {error ? <p className="ops-alert if-field--full" role="alert">{error}</p> : null}
    </form>
  </ControlDialog>;
}

function EventEditor({ event, review = false, records, categories, teams, onSave, onClose }) {
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
      <form id="ops-event-editor-form" className="if-form-grid" onSubmit={submit}>
          {error ? <p role="alert" className="ops-alert">{error}</p> : null}
          <label className="if-field if-field--full"><span className="if-field__label">Title</span><input className="if-input" autoFocus value={draft.title} onChange={(e) => setDraft((value) => ({ ...value, title: e.target.value }))} /></label>
          <label className="if-field"><span className="if-field__label">Starts</span><input className="if-input" type="datetime-local" value={String(draft.startsAt || "").slice(0, 16)} onChange={(e) => setDraft((value) => ({ ...value, startsAt: e.target.value }))} /></label>
          <label className="if-field"><span className="if-field__label">Ends</span><input className="if-input" type="datetime-local" value={String(draft.endsAt || "").slice(0, 16)} onChange={(e) => setDraft((value) => ({ ...value, endsAt: e.target.value }))} /></label>
          <EventTeamSelector teams={teams} value={draft.teamIds || []} onChange={(teamIds) => setDraft((value) => ({ ...value, teamIds }))} />
          <ControlDisclosure className="if-field--full" title="More details" summary="Location, status, categories, attendees, links, milestones, display settings, and linked records" data-event-more-details>
          <div className="if-form-grid">
          <label className="if-field"><span className="if-field__label">Location</span><input className="if-input" value={draft.location} placeholder="Venue, room, city, or virtual" onChange={(e) => setDraft((value) => ({ ...value, location: e.target.value }))} /></label>
          <div className="if-field"><span className="if-field__label">Status</span><ControlSelect ariaLabel="Event status" value={draft.status} options={[["scheduled", "Scheduled"], ["completed", "Completed"], ["cancelled", "Cancelled"]]} onChange={(status) => setDraft((value) => ({ ...value, status }))} portalTarget={dialogRef} /></div>
          <div className="ops-attendee-picker if-field--full">
            <SearchMultiSelect title="Event categories" allLabel="Select event types" value={JSON.stringify(draft.categoryIds || [])} options={categories.map((category) => ({ value: category.id, label: category.name, description: category.description }))} onChange={(categoryIds) => setDraft((value) => ({ ...value, categoryIds }))} portalTarget={dialogRef} />
            {!categories.length ? <small>No workspace event categories are available.</small> : null}
          </div>
          <div className="ops-attendee-picker if-field--full">
            <SearchMultiSelect title="Attendees" allLabel="Select workspace users" value={JSON.stringify(draft.attendeeIds || [])} options={directory.map((user) => ({ value: user.id, label: user.title ? `${user.displayName} · ${user.title}` : user.displayName }))} onChange={(attendeeIds) => setDraft((value) => ({ ...value, attendeeIds }))} portalTarget={dialogRef} />
            {directoryError ? <small role="alert">User directory unavailable: {directoryError}</small> : !directory.length ? <small>No active workspace users available.</small> : null}
          </div>
          <label className="if-field if-field--full"><span className="if-field__label">Notes</span><textarea className="if-textarea" value={draft.notes} onChange={(e) => setDraft((value) => ({ ...value, notes: e.target.value }))} /></label>
          <section className="ops-event-collection if-field--full" data-event-links>
            <header><span><strong>Event links</strong><small>Official page, registration, agenda, lodging, or other useful destinations.</small></span><button type="button" className="if-btn if-btn--secondary if-btn--sm" onClick={() => setDraft((value) => ({ ...value, links: [...(value.links || []), { id: `link-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, label: "", url: "" }] }))}><Plus size={15} aria-hidden="true" />Add link</button></header>
            <ControlCollectionEditor
              label="Event links"
              items={draft.links || []}
              getKey={(link) => link.id}
              empty={<p className="if-field__hint">No links added.</p>}
              renderSummary={(link, index) => <><strong>{link.label || `Link ${index + 1}`}</strong><small>{link.url || "URL not entered"}</small></>}
              renderEditor={(link, index) => <>
                <label className="if-field"><span className="if-field__label">Label</span><input className="if-input" aria-label={`Event link ${index + 1} label`} value={link.label || ""} placeholder="Registration" onChange={(e) => setDraft((value) => ({ ...value, links: value.links.map((item) => item.id === link.id ? { ...item, label: e.target.value } : item) }))} /></label>
                <label className="if-field"><span className="if-field__label">URL</span><input className="if-input" aria-label={`Event link ${index + 1} URL`} type="url" value={link.url || ""} placeholder="https://…" onChange={(e) => setDraft((value) => ({ ...value, links: value.links.map((item) => item.id === link.id ? { ...item, url: e.target.value } : item) }))} /></label>
              </>}
              onRemove={(link) => setDraft((value) => ({ ...value, links: value.links.filter((item) => item.id !== link.id) }))}
              removeLabel="Remove link"
            />
          </section>
          <section className="ops-event-collection if-field--full" data-event-milestones>
            <header><span><strong>Deadlines &amp; milestones</strong><small>Only published or operator-confirmed dates. Missing dates stay absent.</small></span><button type="button" className="if-btn if-btn--secondary if-btn--sm" onClick={() => setDraft((value) => ({ ...value, milestones: [...(value.milestones || []), { id: `milestone-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, type: "registration_deadline", label: "", occursAt: "", notes: "" }] }))}><Plus size={15} aria-hidden="true" />Add milestone</button></header>
            <ControlCollectionEditor
              label="Event deadlines and milestones"
              items={draft.milestones || []}
              getKey={(milestone) => milestone.id}
              empty={<p className="if-field__hint">No milestones added.</p>}
              renderSummary={(milestone, index) => <><strong>{milestone.label || milestoneTypeLabel(milestone.type) || `Milestone ${index + 1}`}</strong><small>{milestone.occursAt ? compactDate(milestone.occursAt) : "Date not set"}</small></>}
              renderEditor={(milestone, index) => <>
                <div className="if-field"><span className="if-field__label">Type</span><ControlSelect ariaLabel={`Milestone ${index + 1} type`} value={milestone.type} options={EVENT_MILESTONE_TYPES} onChange={(type) => setDraft((value) => ({ ...value, milestones: value.milestones.map((item) => item.id === milestone.id ? { ...item, type } : item) }))} portalTarget={dialogRef} /></div>
                <label className="if-field"><span className="if-field__label">Date</span><input className="if-input" aria-label={`Milestone ${index + 1} date`} type="date" value={String(milestone.occursAt || "").slice(0, 10)} onChange={(e) => setDraft((value) => ({ ...value, milestones: value.milestones.map((item) => item.id === milestone.id ? { ...item, occursAt: e.target.value } : item) }))} /></label>
                <label className="if-field"><span className="if-field__label">Display label</span><input className="if-input" aria-label={`Milestone ${index + 1} label`} value={milestone.label || ""} placeholder={milestoneTypeLabel(milestone.type)} onChange={(e) => setDraft((value) => ({ ...value, milestones: value.milestones.map((item) => item.id === milestone.id ? { ...item, label: e.target.value } : item) }))} /></label>
                <label className="if-field"><span className="if-field__label">Context</span><input className="if-input" aria-label={`Milestone ${index + 1} context`} value={milestone.notes || ""} placeholder="Optional source or policy note" onChange={(e) => setDraft((value) => ({ ...value, milestones: value.milestones.map((item) => item.id === milestone.id ? { ...item, notes: e.target.value } : item) }))} /></label>
              </>}
              onRemove={(milestone) => setDraft((value) => ({ ...value, milestones: value.milestones.filter((item) => item.id !== milestone.id) }))}
              removeLabel="Remove milestone"
            />
          </section>
          <label className="if-checkbox ops-event-wallboard if-field--full"><input type="checkbox" checked={draft.wallboard !== false} onChange={(e) => setDraft((value) => ({ ...value, wallboard: e.target.checked }))} /><span><strong>Show on wallboard</strong><small>Include this event in the read-only display projection.</small></span></label>
          <ControlDisclosure className="if-field--full" title={`Linked watched records${linked.size ? ` (${linked.size})` : ""}`} summary="Optional opportunity context for this event" data-event-record-links>
            {records.length ? <div className="ops-event-record-links">{records.map((record) => <label className="if-checkbox" key={record.opportunityId}><input type="checkbox" checked={linked.has(record.opportunityId)} onChange={() => setDraft((value) => ({ ...value, recordIds: linked.has(record.opportunityId) ? value.recordIds.filter((id) => id !== record.opportunityId) : [...value.recordIds, record.opportunityId] }))} /><span><strong>{record.id}</strong><small>{record.title}</small></span></label>)}</div> : <p className="if-field__hint">Star records in Transactions to link them here.</p>}
          </ControlDisclosure>
          </div>
          </ControlDisclosure>
      </form>
  </ControlDialog>;
}

function WatchlistView({ rows, watchlist, asOf, query, setQuery, toggleWatch, updateWatch }) {
  const watchById = new Map(watchlist.map((entry) => [entry.recordId, entry]));
  const columns = [
    { key: "record", label: "Tracked record", required: true, sticky: true, minWidth: 300, value: (record) => record.id, searchValue: (record) => [record.id, record.title, record.party, record.portfolio, record.reference], render: (record) => <a className="dbi-table-record-link" href={`#/budget-spend/explorer?spendView=timeline&capRecord=${encodeURIComponent(record.opportunityId)}`}><b>{record.id}</b><strong>{record.title}</strong><small>{record.party || record.portfolio} · {WORK_CATEGORY_BY_ID.get(record.workCategory)?.label || "Unclassified work"}</small></a> },
    { key: "work", label: "Type of work", facet: true, minWidth: 150, value: (record) => WORK_CATEGORY_BY_ID.get(record.workCategory)?.label || "Unclassified work" },
    { key: "date", label: "Next published date", minWidth: 130, value: (record) => nextPublishedDate(record, asOf) || "Not scheduled", render: (record) => compactDate(nextPublishedDate(record, asOf)) },
    { key: "observed", label: "Observed", sortValue: recordAmount, exportValue: recordAmount, render: (record) => <strong>{money(recordAmount(record))}</strong> },
    { key: "review", label: "Review", minWidth: 150, sortValue: (record) => watchById.get(record.opportunityId)?.reviewAt || "", render: (record) => { const watch = watchById.get(record.opportunityId); return <input aria-label={`Review date for ${record.title}`} type="date" value={String(watch?.reviewAt || "").slice(0, 10)} onChange={(event) => updateWatch(record.opportunityId, { reviewAt: event.target.value })} />; } },
    { key: "wallboard", label: "Wallboard", facet: true, minWidth: 120, value: (record) => watchById.get(record.opportunityId)?.wallboard ? "Shown" : "Hidden", render: (record) => { const watch = watchById.get(record.opportunityId); return <label className="ops-switch"><input type="checkbox" checked={watch?.wallboard !== false} onChange={(event) => updateWatch(record.opportunityId, { wallboard: event.target.checked })} /><span>{watch?.wallboard !== false ? "Shown" : "Hidden"}</span></label>; } },
    { key: "actions", label: "Actions", role: "actions", required: true, sortable: false, render: (record) => <div className="dbi-table-actions"><button type="button" className="ops-icon-button is-starred" onClick={() => toggleWatch(record.opportunityId)} aria-label={`Stop tracking ${record.title}`}><Star size={17} fill="currentColor" />Untrack</button></div> },
  ];
  return (
    <section className="ops-panel" data-ops-watchlist>
      <ControlPageHeader compact divided eyebrow="Workspace work" title="Watchlist" summary="Tracked records, private notes, review dates, and wallboard visibility." headingLevel={2} />
      <ControlPageBody compact>
      {rows.length ? <OperationalDataTable id="watchlist" label="Tracked records" rows={rows} columns={columns} rowKey={(record) => record.opportunityId} defaultSort={{ key: "date", direction: "asc" }} queryValue={query} onQueryChange={setQuery} searchPlaceholder="Search tracked records…" exportFilename="tracked-records.csv" mobileColumns={["record", "date", "review", "wallboard", "actions"]} wrapperProps={{ "data-ops-watch-table": true }} renderDetail={(record) => { const watch = watchById.get(record.opportunityId); return <label className="dbi-table-note"><span>Private workspace note</span><textarea key={watch?.updatedAt} defaultValue={watch?.note || ""} placeholder="Add a private note…" onBlur={(event) => { if (event.target.value !== (watch?.note || "")) updateWatch(record.opportunityId, { note: event.target.value }); }} /></label>; }} /> : <ControlAsyncState compact state="empty" icon={<Star size={22} />} title="No tracked records yet" message="Use the star on any Spend Explorer timeline row to build this working set." action={<a className="if-btn if-btn--primary" href="#/budget-spend/explorer?spendView=timeline">Open Spend Explorer</a>} />}
      </ControlPageBody>
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

function EventAiReview({ jobId, onOpenDraft, activityEntries = [] }) {
  const auth = useAuth();
  const notifications = useNotifications();
  const [fetchedJob, setFetchedJob] = useState(null);
  const [error, setError] = useState("");
  const [panel, setPanel] = useState("review");
  useEffect(() => {
    let active = true;
    void auth.getEventAiJob(jobId).then((result) => { if (active) setFetchedJob(result.job); }).catch((requestError) => { if (active) setError(requestError.message); });
    return () => { active = false; };
  }, [auth, jobId]);
  const notificationJob = notifications?.jobs?.find((item) => item.id === jobId);
  const job = fetchedJob ? { ...(notificationJob || {}), ...fetchedJob } : notificationJob;
  useEffect(() => {
    if (!job || !["completed", "needs_review", "failed"].includes(job.status)) return;
    notifications?.markRead(`event-ai:${job.id}`, job.status);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job?.id, job?.status]);
  const active = ["researching", "verifying"].includes(job?.status);
  const failedStage = job?.status === "failed" ? stoppedEventAiStage(job) : "";
  const evidenceDiagnostic = job?.diagnostic || null;
  const diffRows = eventAiDiffRows(job);
  const reviewClaims = job?.verification?.approved?.reviewClaims || job?.proposal?.reviewClaims || [];
  const reviewSources = job?.verification?.approved?.reviewSources || job?.proposal?.reviewSources || [];
  const autoApplied = job?.mergeResult?.application?.status === "applied";
  const statusLabel = autoApplied ? "AI amendment applied" : job?.status === "completed" ? "Verified draft ready" : job?.status === "needs_review" ? "Operator validation required" : job?.status === "failed" ? "AI workflow stopped safely" : job?.currentStep === "independent_verification" ? "Independent verification" : "Public-source research";
  const researchStepClass = job?.status === "failed" && failedStage === "research" ? "is-blocked" : job?.status === "researching" ? "is-active" : job ? "is-complete" : "is-active";
  const verificationStepClass = job?.status === "failed" && failedStage === "verification" ? "is-blocked" : job?.status === "verifying" ? "is-active" : ["completed", "needs_review"].includes(job?.status) ? "is-complete" : "";
  const reviewStepClass = ["completed", "needs_review"].includes(job?.status) ? "is-active" : "";
  return <section className="if-operations-workspace" data-event-ai-review={job?.status || "loading"}>
    <ControlWorkbenchHeader className="task-detail-header" eyebrow={statusLabel} title={job?.inputSnapshot?.title || job?.mergeResult?.mergedDraft?.title || "Event research review"} summary={`Research: ${job?.producerModel || "Loading"} · Verification: ${job?.verifierModel || "Loading"}${job?.traceId ? ` · Trace ${job.traceId}` : ""}`} actions={<a className="if-btn if-btn--secondary" href="#/budget-spend/tasks">Back to Task Center</a>} tabs={job ? <nav className="if-tabs__list task-review-tabs" aria-label="Task detail sections"><button type="button" className={`if-tab${panel === "review" ? " is-active" : ""}`} aria-pressed={panel === "review"} onClick={() => setPanel("review")}>Review</button><button type="button" className={`if-tab${panel === "activity" ? " is-active" : ""}`} aria-pressed={panel === "activity"} onClick={() => setPanel("activity")}>Activity <span className="if-badge">{activityEntries.length + 2}</span></button></nav> : null} controls={<ControlProgressRail label="Event AI workflow status" items={[
        { id: "research", label: "Research", state: researchStepClass === "is-blocked" ? "blocked" : researchStepClass === "is-active" ? "active" : "complete", meta: failedStage === "research" ? "Stopped by evidence gate" : "Claim-level public evidence" },
        { id: "verification", label: "Verify", state: verificationStepClass === "is-blocked" ? "blocked" : verificationStepClass === "is-active" ? "active" : verificationStepClass === "is-complete" ? "complete" : "pending", meta: failedStage === "research" ? "Not started" : failedStage === "verification" ? "Stopped during verification" : "Independent evidence check" },
        { id: "review", label: autoApplied ? "Applied" : "Review", state: autoApplied ? "complete" : reviewStepClass === "is-active" ? "active" : "pending", meta: job?.status === "failed" ? "No draft produced" : autoApplied ? "Safe workspace policy" : "Human decision before save" },
      ]} />} />
    {error ? <div className="if-alert if-alert--danger" role="alert"><CircleAlert size={17} aria-hidden="true" /><div><strong>Review unavailable</strong><p>{error}</p></div></div> : null}
    {active || !job ? <div className="if-alert if-alert--info" aria-busy="true" data-event-ai-review-progress>{workingSpinner("")}<div><strong>{statusLabel}</strong><p>Background work is running. You can leave this page and return from Notifications or Task Center.</p></div></div> : null}
    {job && panel === "activity" ? <section className="if-analytics-panel if-analytics-panel--flat" data-task-activity><header className="if-analytics-panel__header"><div className="if-analytics-panel__heading"><h3 className="if-analytics-panel__title">Activity chain</h3><p className="if-analytics-panel__summary">Select a stage to inspect its submitted query, normalized provider exchange, timing, IDs, and outcome. Prompts, credentials, headers, and raw provider bodies are excluded.</p></div></header><EventTaskActivity job={job} entries={activityEntries} /></section> : null}
    {panel === "review" && job?.status === "failed" ? <>
      <ControlMetricStrip label="Stopped AI workflow outcome" data-event-ai-stopped-outcome items={[
        { id: "research", label: "Research", value: failedStage === "research" ? "Rejected" : "Completed", meta: failedStage === "research" ? "Provider output failed the citation gate" : "Cited proposal reached verification", tone: "warning" },
        { id: "verification", label: "Verification", value: failedStage === "research" ? "Not started" : "Stopped", meta: "No independently verified result" },
        { id: "record", label: "Event record", value: "Unchanged", meta: "Nothing merged · nothing saved", tone: "success" },
      ]} />
      <section className="if-analytics-panel"><header className="if-analytics-panel__header"><div className="if-analytics-panel__heading"><h3 className="if-analytics-panel__title">Why it stopped</h3><p className="if-analytics-panel__summary">{failedStage === "research" ? "The research model returned output, but DBI rejected it before independent verification because the evidence contract was not met." : "Research completed, but independent verification did not produce an eligible draft."}</p></div><a className="if-btn if-btn--secondary" href="#/budget-spend/connections?connectionsView=activity">Open API activity</a></header><div className="if-alert if-alert--danger"><CircleAlert size={17} aria-hidden="true" /><div><strong>{job.error?.code || "provider_failed"}</strong><p>{job.error?.message || "The provider stopped before returning a verified result."}</p></div></div>{evidenceDiagnostic ? <div className="if-meta-grid" data-event-ai-evidence-diagnostic>
        <dl className="if-kv"><dt>Web-search calls</dt><dd>{evidenceDiagnostic.webSearchCallCount ?? 0}</dd></dl>
        <dl className="if-kv"><dt>Consulted sources</dt><dd>{evidenceDiagnostic.searchSourceCount ?? 0}</dd></dl>
        <dl className="if-kv"><dt>Citation annotations</dt><dd>{evidenceDiagnostic.citationAnnotationCount ?? 0}</dd></dl>
        <dl className="if-kv"><dt>Structured sources</dt><dd>{evidenceDiagnostic.structuredSourceCount ?? 0}</dd></dl>
        <dl className="if-kv"><dt>Matched sources</dt><dd>{evidenceDiagnostic.matchedSourceCount ?? 0}</dd></dl>
        <dl className="if-kv"><dt>Matched evidence</dt><dd>{evidenceDiagnostic.matchedEvidenceCount ?? 0}</dd></dl>
        <dl className="if-kv"><dt>Provider request</dt><dd><code>{job.providerRequestId || "Not returned"}</code></dd></dl>
        <dl className="if-kv"><dt>Response</dt><dd><code>{job.responseId || "Not returned"}</code></dd></dl>
        <dl className="if-kv"><dt>Output shape</dt><dd>{evidenceDiagnostic.outputItemTypes?.join(" · ") || "None"}</dd></dl>
      </div> : <p className="if-analytics-panel__summary" data-event-ai-evidence-diagnostic-unavailable>Evidence-shape diagnostics were not retained for this earlier run. The trace remains searchable in API Log.</p>}</section>
    </> : null}
    {panel === "review" && ["completed", "needs_review"].includes(job?.status) ? <>
      <ControlMetricStrip label="AI review summary" items={[
        { id: "additions", label: "Verified additions", value: job.mergeResult?.changes?.length || 0, meta: "Eligible for the draft", tone: "success" },
        { id: "conflicts", label: "Preserved conflicts", value: job.mergeResult?.conflicts?.length || 0, meta: "Operator values kept", tone: "warning" },
        { id: "review", label: "Review claims", value: reviewClaims.length, meta: "Retained, not auto-merged", tone: reviewClaims.length ? "warning" : "success" },
        { id: "sources", label: "Grounded sources", value: job.proposal?.sources?.length || 0, meta: "Provider or pinned evidence", tone: "info" },
      ]} />
      <section className="if-analytics-panel" data-event-ai-diff-preview><header className="if-analytics-panel__header"><div className="if-analytics-panel__heading"><h3 className="if-analytics-panel__title">Verified changes</h3><p className="if-analytics-panel__summary">Each changed field is shown once. The draft remains unsaved.</p></div><span className="if-badge if-badge--info">{diffRows.length} change{diffRows.length === 1 ? "" : "s"}</span></header><ControlChangeList label="Event draft difference preview" items={diffRows} empty={<ControlAsyncState compact state="empty" icon={<CircleCheck size={20} />} title="No field differences" message="The verifier did not produce a safe change to the original draft." />} />{job.mergeResult?.conflicts?.length ? <ControlDisclosure title={`Preserved operator values (${job.mergeResult.conflicts.length})`} summary="Conflicting operator-entered fields remain unchanged" tone="warning"><ul>{job.mergeResult.conflicts.map((conflict, index) => <li key={`${conflict.field || "field"}-${index}`}>{conflict.field || String(conflict)}</li>)}</ul></ControlDisclosure> : null}</section>
      <section className="if-analytics-panel"><header className="if-analytics-panel__header"><div className="if-analytics-panel__heading"><h3 className="if-analytics-panel__title">Evidence &amp; exclusions</h3><p className="if-analytics-panel__summary">Open grounded sources or inspect claims retained for review without automatic merge.</p></div></header><div className="if-action-row-list">{(job.proposal?.sources || []).map((source, index) => <a key={source.url} className="if-action-row" href={source.url} target="_blank" rel="noreferrer"><span className="if-icon-slot"><Link2 size={15} /></span><span><strong>{source.publisher || source.title || `Source ${index + 1}`}</strong><em>{source.url}</em></span><span className="if-badge if-badge--info">Grounded</span></a>)}{reviewSources.map((source, index) => <a key={`review-${source.url}`} className="if-action-row" href={source.url} target="_blank" rel="noreferrer"><span className="if-icon-slot"><Link2 size={15} /></span><span><strong>{source.publisher || source.title || `Candidate source ${index + 1}`}</strong><em>{source.url}</em></span><span className="if-badge if-badge--warning">Review</span></a>)}</div>{reviewClaims.length ? <ControlDisclosure title={`Claims retained for review (${reviewClaims.length})`} summary="Citation transport was incomplete, so these claims were preserved but not auto-merged" tone="warning"><ul>{reviewClaims.map((claim, index) => <li key={`${claim.field || "claim"}-${index}`}><strong>{claim.field || "Claim"}:</strong> {claim.value || "Proposed value"} · {claim.reason || "Requires operator review"}</li>)}</ul></ControlDisclosure> : null}{job.verification?.rejectedClaims?.length ? <ControlDisclosure title={`Rejected claims (${job.verification.rejectedClaims.length})`} summary="Claims excluded because verification contradicted or could not support them"><ul>{job.verification.rejectedClaims.map((claim, index) => <li key={index}>{typeof claim === "string" ? claim : claim.reason || claim.claim || "Unsupported claim"}</li>)}</ul></ControlDisclosure> : null}</section>
      <section className="if-analytics-panel"><header className="if-analytics-panel__header"><div className="if-analytics-panel__heading"><h3 className="if-analytics-panel__title">Operator decision</h3><p className="if-analytics-panel__summary">{job.mergeResult?.application?.status === "applied" ? "Verified additive changes were applied by workspace policy. Review the event or inspect the retained evidence." : "Opening the draft does not save it. Review every field, then use the normal Save event action."}</p></div>{job.mergeResult?.mergedDraft ? <button type="button" className="if-btn if-btn--ai" onClick={() => onOpenDraft({ ...job.mergeResult.mergedDraft, aiReviewJobId: job.id })}><Sparkles size={16} aria-hidden="true" />{job.mergeResult?.application?.status === "applied" ? "Review applied event" : "Open verified draft"}</button> : null}</header></section>
    </> : null}
  </section>;
}

const TASK_ACTIVE_STATUSES = new Set(["researching", "verifying", "running", "pending"]);
const TASK_ATTENTION_STATUSES = new Set(["needs_review", "failed", "rejected", "rate_limited"]);

function taskStatusLabel(status) {
  return ({ researching: "Researching", verifying: "Verifying", needs_review: "Needs review", completed: "Completed", succeeded: "Completed", failed: "Failed", rejected: "Rejected", rate_limited: "Rate limited", running: "Running", pending: "Pending" })[status] || String(status || "Unknown").replaceAll("_", " ");
}

function eventAugmentationValue(event) {
  const states = [];
  if (event.aiValidationRequired) states.push("Validation required");
  if (event.aiAmended) states.push("AI amended");
  if (!states.length) states.push(event.lastAugmentedAt ? "Checked" : "Not augmented");
  return states.join(" · ");
}

function EventAugmentationState({ event }) {
  return <span className="ops-event-ai-state">
    {event.aiValidationRequired ? <ControlStatusBadge status="validation required" label="Validation required" /> : null}
    {event.aiAmended ? <ControlStatusBadge status="amended" label="AI amended" /> : null}
    {!event.aiValidationRequired && !event.aiAmended && event.lastAugmentedAt ? <ControlStatusBadge status="complete" label="Checked" /> : null}
    {!event.lastAugmentedAt ? <span className="if-field__hint">Not augmented</span> : null}
    {event.lastAugmentedAt ? <small>Last augmented {dateTime(event.lastAugmentedAt)}</small> : null}
  </span>;
}

function eventTaskRecord(job, apiRequests = []) {
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
    entries: apiRequests.filter((entry) => job.traceId && entry.traceId === job.traceId),
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
  const [panel, setPanel] = useState("summary");
  return <section className="if-operations-workspace" data-api-task-detail>
    <ControlWorkbenchHeader className="task-detail-header" eyebrow={taskStatusLabel(task.status)} title={task.title} summary={`${task.type}${task.traceId ? ` · Trace ${task.traceId}` : ""}`} actions={<a className="if-btn if-btn--secondary" href="#/budget-spend/tasks">Back to Task Center</a>} tabs={<nav className="if-tabs__list task-review-tabs" aria-label="Task detail sections"><button type="button" className={`if-tab${panel === "summary" ? " is-active" : ""}`} aria-pressed={panel === "summary"} onClick={() => setPanel("summary")}>Summary</button><button type="button" className={`if-tab${panel === "activity" ? " is-active" : ""}`} aria-pressed={panel === "activity"} onClick={() => setPanel("activity")}>Activity <span className="if-badge">{task.entries.length}</span></button></nav>} metrics={[
      { id: "stage", label: "Stage", value: task.stage, meta: "Latest retained stage", tone: "info" },
      { id: "requests", label: "Requests", value: task.entries.length, meta: "Redacted ledger entries" },
      { id: "provider", label: "Provider", value: task.provider || "DBI", meta: task.model || "No model recorded" },
      { id: "outcome", label: "Outcome", value: taskStatusLabel(task.status), meta: task.detail, tone: TASK_ATTENTION_STATUSES.has(task.status) ? "danger" : "success" },
    ]} metricLabel="Task summary" />
    {panel === "summary" ? <section className="if-analytics-panel"><header className="if-analytics-panel__header"><div className="if-analytics-panel__heading"><h3 className="if-analytics-panel__title">Latest outcome</h3><p className="if-analytics-panel__summary">{task.detail}</p></div><ControlStatusBadge status={task.status} label={taskStatusLabel(task.status)} /></header></section> : <section className="if-analytics-panel if-analytics-panel--flat" data-task-activity><header className="if-analytics-panel__header"><div className="if-analytics-panel__heading"><h3 className="if-analytics-panel__title">Activity chain</h3><p className="if-analytics-panel__summary">Select a retained stage to inspect its normalized, redacted request and response.</p></div></header><ApiTaskActivity entries={task.entries} /></section>}
  </section>;
}

function TasksView({ apiRequests, selectedTaskId, onOpenDraft, onRefresh }) {
  const notifications = useNotifications();
  const notificationJobs = notifications?.jobs;
  useEffect(() => {
    if (!selectedTaskId) return;
    void onRefresh?.();
  }, [onRefresh, selectedTaskId]);
  const tasks = useMemo(() => {
    const eventJobs = notificationJobs || [];
    return [...eventJobs.map((job) => eventTaskRecord(job, apiRequests)), ...apiTaskRecords(apiRequests, eventJobs)].sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)));
  }, [apiRequests, notificationJobs]);
  const selected = tasks.find((task) => task.id === selectedTaskId);
  const columns = [
    { key: "task", label: "Task", required: true, sticky: true, minWidth: 300, value: (task) => task.title, searchValue: (task) => [task.title, task.type, task.stage, task.detail, task.traceId], render: (task) => <><strong>{task.title}</strong><small>{task.detail}</small></> },
    { key: "type", label: "Type", facet: true, minWidth: 145, value: (task) => task.type },
    { key: "status", label: "Status", facet: true, minWidth: 120, value: (task) => taskStatusLabel(task.status), render: (task) => <span className="task-status-cell">{TASK_ACTIVE_STATUSES.has(task.status) ? workingSpinner("") : null}<ControlStatusBadge status={task.status} label={taskStatusLabel(task.status)} /></span> },
    { key: "stage", label: "Current stage", facet: true, minWidth: 160, value: (task) => task.stage },
    { key: "updated", label: "Updated", minWidth: 165, value: (task) => task.updatedAt || task.startedAt || "", render: (task) => dateTime(task.updatedAt || task.startedAt) },
    { key: "trace", label: "Trace", minWidth: 170, value: (task) => task.traceId || "Not recorded" },
    { key: "actions", label: "Actions", role: "actions", required: true, sortable: false, render: (task) => <div className="dbi-table-actions"><a href={`#/budget-spend/tasks?task=${encodeURIComponent(task.id)}`}>Open</a></div> },
  ];
  const activeCount = tasks.filter((task) => TASK_ACTIVE_STATUSES.has(task.status)).length;
  const attentionCount = tasks.filter((task) => TASK_ATTENTION_STATUSES.has(task.status)).length;
  const completedCount = tasks.filter((task) => ["completed", "succeeded"].includes(task.status)).length;
  const failedCount = tasks.filter((task) => ["failed", "rejected", "rate_limited"].includes(task.status)).length;
  return <section className={`ops-panel${selectedTaskId ? " task-center--detail" : ""}`} data-task-center>
    {!selectedTaskId ? <ControlPageHeader compact divided eyebrow="Workspace work" title="Task Center" summary="Augmentation, provider, and authenticated API tasks in one place." headingLevel={2} actions={<button type="button" className="if-btn if-btn--secondary" onClick={() => void Promise.all([notifications?.refresh?.(), onRefresh?.()])}>Refresh</button>} /> : null}
    <ControlPageBody compact>
    {!selectedTaskId ? <ControlMetricStrip label="Task summary" mobileScroll compactMobile items={[
      { id: "active", label: "In progress", value: activeCount, meta: "Background stages running", tone: "info" },
      { id: "attention", label: "Needs attention", value: attentionCount, meta: "Review or failure detail available", tone: "warning" },
      { id: "completed", label: "Completed", value: completedCount, meta: "Finished retained tasks", tone: "success" },
      { id: "stopped", label: "Stopped", value: failedCount, meta: "No silent writes or partial merges", tone: "danger" },
    ]} /> : null}
    {selected?.job ? <EventAiReview jobId={selected.sourceId} onOpenDraft={onOpenDraft} activityEntries={selected.entries} /> : selected?.entries ? <ApiTaskDetail task={selected} /> : selectedTaskId ? <div className="if-alert if-alert--danger" role="alert"><CircleAlert size={17} aria-hidden="true" /><div><strong>Task not found</strong><p>The task is outside the retained workspace window or is no longer available.</p></div></div> : null}
    {!selectedTaskId && tasks.length ? <OperationalDataTable id="tasks" label="Workspace task progress" rows={tasks} columns={columns} rowKey={(task) => task.id} defaultSort={{ key: "updated", direction: "desc" }} searchPlaceholder="Search tasks, stages, outcomes, traces, and task types…" exportFilename="workspace-tasks.csv" selectable={false} mobileColumns={["task", "status", "updated", "actions"]} wrapperProps={{ "data-task-table": true }} /> : !selectedTaskId ? <ControlAsyncState compact state="empty" icon={<ListChecks size={22} />} title="No retained tasks" message="Augmentation and API work will appear here after it starts." /> : null}
    </ControlPageBody>
  </section>;
}

function EventsView({ events, records, categories, canManageCategories, onAdd, onEdit, onDelete, onManageCategories, embedded = false }) {
  const [researchEvent, setResearchEvent] = useState(null);
  const byId = new Map(records.map((record) => [record.opportunityId, record]));
  const columns = [
    { key: "title", label: "Event", required: true, sticky: true, minWidth: 260, value: (event) => event.title, searchValue: (event) => [event.title, event.notes, event.location, ...(event.links || []).flatMap((link) => [link.label, link.url]), ...eventCategoryLabels(event, categories), ...(event.milestones || []).flatMap((milestone) => [milestoneLabel(milestone), milestone.notes])], render: (event) => <><strong>{event.title}</strong><small>{event.location || "Location not set"}</small></> },
    { key: "starts", label: "Starts", minWidth: 160, value: (event) => event.startsAt, render: (event) => dateTime(event.startsAt) },
    { key: "ends", label: "Ends", minWidth: 160, value: (event) => event.endsAt || event.startsAt, render: (event) => dateTime(event.endsAt || event.startsAt) },
    { key: "status", label: "Status", facet: true, value: (event) => event.status || "scheduled", render: (event) => <ControlStatusBadge status={event.status || "scheduled"} /> },
    { key: "augmentation", label: "AI augmentation", facet: true, minWidth: 190, value: eventAugmentationValue, sortValue: (event) => event.lastAugmentedAt || "", render: (event) => <EventAugmentationState event={event} /> },
    { key: "display", label: "Wallboard", facet: true, value: (event) => event.wallboard ? "Shown" : "Hidden" },
    { key: "categories", label: "Categories", facet: true, minWidth: 150, value: (event) => eventCategoryLabels(event, categories).join(" · ") || "Uncategorized" },
    { key: "teams", label: "Visibility", facet: true, minWidth: 180, value: (event) => event.teams?.map((team) => team.name).join(" · ") || "Workspace-wide", render: (event) => event.teams?.length ? <span className="event-team-stack">{event.teams.slice(0, 3).map((team) => <a key={team.id} href={workspaceTeamHref(team.id)} aria-label={`Open ${team.name} workspace profile`}><TeamAvatar team={team} size={24} nativeTitle={false} />{team.name}</a>)}</span> : <span className="if-badge if-badge--neutral">Workspace-wide</span> },
    { key: "links", label: "Links", minWidth: 100, sortValue: (event) => event.links?.length || 0, value: (event) => `${event.links?.length || 0}`, render: (event) => <strong>{event.links?.length || 0}</strong> },
    { key: "milestones", label: "Milestones", minWidth: 120, sortValue: (event) => event.milestones?.length || 0, value: (event) => `${event.milestones?.length || 0}`, render: (event) => <strong>{event.milestones?.length || 0}</strong> },
    { key: "records", label: "Linked records", minWidth: 180, value: (event) => event.recordIds.map((id) => byId.get(id)?.id).filter(Boolean).join(" · ") || "No linked records" },
    { key: "actions", label: "Actions", role: "actions", required: true, sortable: false, render: (event) => <div className="dbi-table-actions"><button type="button" className="if-btn--ai-icon" aria-label={`Research and augment ${event.title}`} title="Research and augment" onClick={() => setResearchEvent(event)}><Sparkles size={14} /></button><button type="button" aria-label={`Edit ${event.title}`} title="Edit event" onClick={() => onEdit(event)}><Pencil size={14} /></button><button type="button" className="is-danger" aria-label={`Delete ${event.title}`} title="Delete event" onClick={() => onDelete(event.id)}><Trash2 size={14} /></button></div> },
  ];
  const actions = <><a className="if-btn if-btn--secondary" href="#/budget-spend/tasks" aria-label="Task Center" title="Task Center"><ListChecks size={15} aria-hidden="true" /><span>Task Center</span></a>{canManageCategories ? <button type="button" className="if-btn if-btn--secondary" aria-label="Manage categories" title="Manage categories" onClick={onManageCategories}><Tags size={15} aria-hidden="true" /><span>Manage categories</span></button> : null}<button type="button" className="if-btn if-btn--primary" aria-label="Add event" title="Add event" onClick={onAdd}><Plus size={15} aria-hidden="true" /><span>Add event</span></button></>;
  const content = events.length ? <OperationalDataTable id="events" label="Operator events" rows={events} columns={columns} rowKey={(event) => event.id} defaultSort={{ key: "starts", direction: "asc" }} searchPlaceholder="Search events, teams, locations, links, categories, attendees, milestones, and notes…" exportFilename="operator-events.csv" toolbarActions={actions} mobileColumns={["title", "teams", "augmentation", "actions"]} wrapperProps={{ "data-ops-event-table": true }} renderDetail={(event) => <div className="dbi-table-detail-grid"><article><span>Visibility</span><strong>{event.teams?.map((team) => team.name).join(" · ") || "Workspace-wide"}</strong></article><article><span>Categories</span><strong>{eventCategoryLabels(event, categories).join(" · ") || "Uncategorized"}</strong></article><article><span>AI augmentation</span><strong>{eventAugmentationValue(event)}{event.lastAugmentedAt ? ` · ${dateTime(event.lastAugmentedAt)}` : ""}</strong></article><article><span>Links</span><strong>{event.links?.map((link) => link.label || link.url).join(" · ") || "None"}</strong></article><article><span>Attendees</span><strong>{event.attendees?.map((attendee) => attendee.displayName).join(" · ") || "None assigned"}</strong></article><article><span>Deadlines &amp; milestones</span><strong>{event.milestones?.map((milestone) => `${milestoneLabel(milestone)} · ${compactDate(milestone.occursAt)}`).join(" · ") || "None published"}</strong></article><article><span>Notes</span><strong>{event.notes || "No notes"}</strong></article><article><span>Linked record IDs</span><strong>{event.recordIds.join(" · ") || "None"}</strong></article></div>} /> : <ControlAsyncState compact state="empty" icon={<CalendarDays size={22} />} title="No operator events" message="Add meetings, checkpoints, or reviews and optionally publish them to the display calendar." action={<>{canManageCategories ? <button type="button" className="if-btn if-btn--secondary" onClick={onManageCategories}>Manage categories</button> : null}<button type="button" className="if-btn if-btn--primary" onClick={onAdd}><Plus size={15} />Add event</button></>} />;
  return <section className={`ops-panel${embedded ? " ops-panel--embedded" : ""}`} data-ops-events>{!embedded ? <ControlPageHeader compact divided eyebrow="Primary surface" title="Events" summary="Schedule, filter, edit, or launch augmentation from an event row." headingLevel={2} /> : null}{embedded ? content : <ControlPageBody compact>{content}</ControlPageBody>}{researchEvent ? <EventAiLauncher key={researchEvent.id} event={researchEvent} onClose={() => setResearchEvent(null)} /> : null}</section>;
}

function ActivityView({ activity, apiRequests = [], apiRequestSummary = null, records, embedded = false }) {
  const [requestFilters, setRequestFilters] = useState({});
  const [chartTooltip, setChartTooltip] = useState(null);
  const [ledger, setLedger] = useState("requests");
  const byId = new Map(records.map((record) => [record.opportunityId, record]));
  const activityColumns = [
    { key: "at", label: "Time", required: true, sticky: true, minWidth: 170, value: (entry) => entry.at, render: (entry) => dateTime(entry.at) },
    { key: "type", label: "Event", facet: true, minWidth: 150, value: (entry) => entry.type.replaceAll("_", " "), render: (entry) => <strong>{entry.type.replaceAll("_", " ")}</strong> },
    { key: "detail", label: "Detail", minWidth: 280, role: "prose", value: (entry) => entry.detail },
    { key: "actor", label: "Actor", facet: true, minWidth: 130, value: (entry) => entry.actorType || "operator", render: (entry) => <><strong>{entry.actorType || "operator"}</strong>{entry.actorId ? <small>{entry.actorId}</small> : null}</> },
    { key: "record", label: "Record", minWidth: 210, value: (entry) => byId.get(entry.recordId)?.id || entry.recordId || "Not linked", render: (entry) => { const record = byId.get(entry.recordId); return record ? <a className="dbi-table-record-link" href={`#/budget-spend/explorer?spendView=timeline&capRecord=${encodeURIComponent(record.opportunityId)}`}><strong>{record.id}</strong><small>{record.title}</small></a> : (entry.recordId || "Not linked"); } },
  ];
  const requestColumns = [
    { key: "at", label: "Time", required: true, sticky: true, minWidth: 170, value: (entry) => entry.at, render: (entry) => dateTime(entry.at) },
    { key: "status", label: "Status", facet: true, minWidth: 120, value: (entry) => entry.status, render: (entry) => <ControlStatusBadge status={entry.status} /> },
    { key: "operation", label: "Operation", facet: true, mobileWide: true, minWidth: 220, value: (entry) => `${entry.provider} ${entry.operation}`, filterValue: (entry) => entry.operation, render: (entry) => <><strong>{entry.operation}</strong><small>{entry.provider}{entry.model ? ` · ${entry.model}` : ""}</small></> },
    { key: "route", label: "Interface", facet: true, minWidth: 190, value: (entry) => entry.route || entry.requestKind, render: (entry) => <><strong>{entry.method ? `${entry.method} ` : ""}{entry.route || entry.requestKind}</strong><small>{entry.requestKind.replaceAll("_", " ")}{entry.credentialScope ? ` · ${entry.credentialScope} key` : ""}</small></> },
    { key: "latency", label: "Latency", minWidth: 105, sortValue: (entry) => entry.latencyMs, value: (entry) => entry.latencyMs ? `${entry.latencyMs} ms` : "Not measured" },
    { key: "tokens", label: "Tokens", minWidth: 120, sortValue: (entry) => entry.inputTokens + entry.outputTokens, value: (entry) => entry.inputTokens || entry.outputTokens ? `${entry.inputTokens.toLocaleString()} in · ${entry.outputTokens.toLocaleString()} out` : "Not applicable" },
    { key: "actor", label: "Principal", facet: true, minWidth: 150, value: (entry) => `${entry.principalType} ${entry.principalId}`, render: (entry) => <><strong>{entry.principalType || "system"}</strong><small>{entry.principalId || "system"}</small></> },
    { key: "trace", label: "Trace", minWidth: 190, value: (entry) => entry.traceId || entry.providerRequestId || entry.responseId || "Unavailable", render: (entry) => <code>{entry.traceId || entry.providerRequestId || entry.responseId || "Unavailable"}</code> },
    { key: "error", label: "Safe diagnostic", minWidth: 220, role: "prose", value: (entry) => entry.errorCode || entry.errorMessage || "None", render: (entry) => entry.errorCode || entry.errorMessage ? <><strong>{entry.errorCode || "request_failed"}</strong>{entry.errorMessage ? <small>{entry.errorMessage}</small> : null}</> : "None" },
  ];
  const requestDetail = (entry) => <dl className="ops-request-detail" aria-label={`Request details for ${entry.operation}`}>
    <div><dt>Interface</dt><dd>{entry.method ? `${entry.method} ` : ""}{entry.route || entry.requestKind}</dd></div>
    <div><dt>Tokens</dt><dd>{entry.inputTokens || entry.outputTokens ? `${entry.inputTokens.toLocaleString()} in · ${entry.outputTokens.toLocaleString()} out` : "Not applicable"}</dd></div>
    <div><dt>Principal</dt><dd>{entry.principalType || "system"}{entry.principalId ? ` · ${entry.principalId}` : ""}</dd></div>
    <div><dt>Trace</dt><dd><code>{entry.traceId || entry.providerRequestId || entry.responseId || "Unavailable"}</code></dd></div>
    <div className="ops-request-detail__wide"><dt>Safe diagnostic</dt><dd>{entry.errorCode || entry.errorMessage ? `${entry.errorCode || "request_failed"}${entry.errorMessage ? ` · ${entry.errorMessage}` : ""}` : "None"}</dd></div>
  </dl>;
  const summary = apiRequestSummary || { retained: apiRequests.length, requests: apiRequests.filter((entry) => entry.requestKind !== "credential_lifecycle").length, successRate: null, averageLatencyMs: 0, p95LatencyMs: 0, inputTokens: 0, outputTokens: 0 };
  const callEntries = apiRequests.filter((entry) => entry.requestKind !== "credential_lifecycle");
  const clientErrorCount = callEntries.filter((entry) => entry.requestKind === "client_error").length;
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
  const toggleRequestFilter = (key, value) => setRequestFilters((current) => {
    if (current[key] === value) {
      const next = { ...current };
      delete next[key];
      return next;
    }
    return { ...current, [key]: value };
  });
  return <section className="ops-panel if-operations-workspace" data-ops-activity data-ledger={ledger}>
    {!embedded ? <ControlPageHeader compact divided eyebrow="Workspace administration" title="Runtime & API Log" summary="Redacted browser failures, request diagnostics, and append-only workspace changes." headingLevel={2} meta={<span className="if-badge if-badge--info">90-day retention</span>} /> : null}
    <ControlPageBody compact>
    <nav className="if-tabs__list" aria-label="Log type">
      <button type="button" className={`if-tab${ledger === "requests" ? " is-active" : ""}`} aria-pressed={ledger === "requests"} onClick={() => setLedger("requests")}>Runtime & API <span className="if-badge">{apiRequests.length}</span></button>
      <button type="button" className={`if-tab${ledger === "changes" ? " is-active" : ""}`} aria-pressed={ledger === "changes"} onClick={() => setLedger("changes")}>Workspace changes <span className="if-badge">{activity.length}</span></button>
    </nav>
    {ledger === "requests" ? <><ControlMetricStrip label="Runtime and API request summary" data-api-request-summary items={[
      { id: "requests", label: "Requests", value: Number(summary.requests || 0).toLocaleString(), meta: `${Number(summary.retained || 0).toLocaleString()} retained entries`, tone: "info", visual: trend ? <ControlSparkline className="if-sparkline--summary" values={trend.requests} labels={trend.labels} label="Requests over the retained window" formatValue={(value) => `${value} requests`} /> : null },
      { id: "success", label: "Success rate", value: summary.successRate === null ? "No calls" : `${summary.successRate}%`, meta: "Current retained window", tone: summary.successRate === null || summary.successRate >= 99 ? "success" : summary.successRate >= 95 ? "warning" : "danger", visual: trend ? <ControlSparkline className="if-sparkline--summary" values={trend.success} labels={trend.labels} label="Success rate over the retained window" formatValue={(value) => `${value}%`} /> : null },
      { id: "latency", label: "Average latency", value: `${Number(summary.averageLatencyMs || 0).toLocaleString()} ms`, meta: `P95 ${Number(summary.p95LatencyMs || 0).toLocaleString()} ms`, visual: trend ? <ControlSparkline className="if-sparkline--summary" values={trend.latency} labels={trend.labels} label="Average latency over the retained window" formatValue={(value) => `${value} ms`} /> : null },
      { id: "tokens", label: "Token usage", value: (Number(summary.inputTokens || 0) + Number(summary.outputTokens || 0)).toLocaleString(), meta: `${Number(summary.inputTokens || 0).toLocaleString()} in · ${Number(summary.outputTokens || 0).toLocaleString()} out`, tone: "purple", visual: trend ? <ControlSparkline className="if-sparkline--summary" values={trend.tokens} labels={trend.labels} label="Token usage over the retained window" formatValue={(value) => `${value} tokens`} /> : null },
      { id: "client-errors", label: "Client errors", value: clientErrorCount.toLocaleString(), meta: "Browser render and promise failures", tone: clientErrorCount ? "danger" : "success" },
    ]} />
    {callEntries.length ? <div className="if-chart-grid if-chart-grid--band" aria-label="API request charts" data-api-observability-charts>
      <article className="if-chart-card if-chart-card--flat">
        <header className="if-chart-card__header"><div><h3 className="if-chart-card__title">Request outcomes</h3><p className="if-chart-card__meta">Select a status to filter the request log</p></div></header>
        <div className="if-chart"><div className="if-chart__bars">{outcomeRows.map((row, index) => <button type="button" className={`if-chart-bar${requestFilters.status === row.id ? " is-selected" : ""}`} key={row.id} aria-label={`${row.label}: ${row.value.toLocaleString()} requests. Filter request log.`} aria-pressed={requestFilters.status === row.id} onClick={() => toggleRequestFilter("status", row.id)} onPointerEnter={() => setChartTooltip({ chart: "outcomes", label: row.label, value: `${row.value.toLocaleString()} requests` })} onPointerLeave={() => setChartTooltip(null)} onFocus={() => setChartTooltip({ chart: "outcomes", label: row.label, value: `${row.value.toLocaleString()} requests` })} onBlur={() => setChartTooltip(null)}><span className="if-chart-bar__label">{row.label}</span><span className="if-chart-bar__track"><i className="if-chart-bar__fill" style={{ "--bar": `${(row.value / outcomeMaximum) * 100}%`, "--i": index }} /></span><strong>{row.value.toLocaleString()}</strong></button>)}</div>{chartTooltip?.chart === "outcomes" ? <span className="if-chart-tooltip" role="tooltip"><strong>{chartTooltip.label}</strong><span>{chartTooltip.value} · click to filter</span></span> : null}</div>
      </article>
      <article className="if-chart-card if-chart-card--flat">
        <header className="if-chart-card__header"><div><h3 className="if-chart-card__title">Average latency by operation</h3><p className="if-chart-card__meta">Select an operation to filter the request log</p></div></header>
        <div className="if-chart"><div className="if-chart__bars">{latencyByOperation.map((row, index) => <button type="button" className={`if-chart-bar${requestFilters.operation === row.id ? " is-selected" : ""}`} key={row.id} aria-label={`${row.label}: ${row.value.toLocaleString()} milliseconds average. Filter request log.`} aria-pressed={requestFilters.operation === row.id} onClick={() => toggleRequestFilter("operation", row.id)} onPointerEnter={() => setChartTooltip({ chart: "latency", label: row.label, value: `${row.value.toLocaleString()} ms average` })} onPointerLeave={() => setChartTooltip(null)} onFocus={() => setChartTooltip({ chart: "latency", label: row.label, value: `${row.value.toLocaleString()} ms average` })} onBlur={() => setChartTooltip(null)}><span className="if-chart-bar__label">{row.label}</span><span className="if-chart-bar__track"><i className="if-chart-bar__fill" style={{ "--bar": `${(row.value / latencyMaximum) * 100}%`, "--i": index }} /></span><strong>{row.value.toLocaleString()} ms</strong></button>)}</div>{chartTooltip?.chart === "latency" ? <span className="if-chart-tooltip" role="tooltip"><strong>{chartTooltip.label}</strong><span>{chartTooltip.value} · click to filter</span></span> : null}</div>
      </article>
    </div> : null}
    <section className="if-analytics-panel if-analytics-panel--flat" aria-labelledby="api-request-log-title">
      <header className="if-analytics-panel__header"><div className="if-analytics-panel__heading"><h3 className="if-analytics-panel__title" id="api-request-log-title">Runtime & API requests</h3><p className="if-analytics-panel__summary">Authenticated browser failures, Agent API calls, and OpenAI diagnostics appear here without request bodies, credentials, or URL values.</p></div><strong className="if-analytics-panel__count">{apiRequests.length}</strong></header>
      {apiRequests.length ? <OperationalDataTable id="api-requests" label="Runtime and API request log" rows={apiRequests} columns={requestColumns} rowKey={(entry) => entry.id} defaultSort={{ key: "at", direction: "desc" }} defaultPageSize={10} defaultMobilePageSize={3} pageSizeOptions={[3, 5, 10, 25, 50, 100]} searchPlaceholder="Search operations, routes, principals, traces, and diagnostics…" exportFilename="api-request-log.csv" selectable={false} filterValues={requestFilters} onFilterChange={setRequestFilters} mobileColumns={["at", "status", "operation", "latency"]} renderDetail={requestDetail} wrapperProps={{ "data-api-request-table": true }} /> : <ControlAsyncState compact state="empty" icon={<Activity size={22} />} title="No runtime or API requests retained" message="Authenticated browser failures, Agent API calls, and OpenAI requests will appear here." data-api-request-empty />}
    </section></> : <section className="if-analytics-panel if-analytics-panel--flat" aria-labelledby="workspace-activity-title">
      <header className="if-analytics-panel__header"><div className="if-analytics-panel__heading"><h3 className="if-analytics-panel__title" id="workspace-activity-title">Workspace changes</h3><p className="if-analytics-panel__summary">Append-only human and agent mutations across the shared workspace.</p></div><strong className="if-analytics-panel__count">{activity.length}</strong></header>
      {activity.length ? <OperationalDataTable id="workspace-activity" label="Workspace activity log" rows={activity} columns={activityColumns} rowKey={(entry) => entry.id} defaultSort={{ key: "at", direction: "desc" }} searchPlaceholder="Search events, actors, details, and record IDs…" exportFilename="workspace-activity-log.csv" selectable={false} wrapperProps={{ "data-ops-activity-table": true }} /> : <ControlAsyncState compact state="empty" icon={<Activity size={22} />} title="No operator activity" message="Human and agent changes will be recorded here." />}
    </section>}
    </ControlPageBody>
  </section>;
}

function WallboardView({ records, watchlist, events, categories, teams, asOf, workspace, lastRefreshedAt, onOpenMember }) {
  const [mode, setMode] = useState("calendar");
  const [rotate, setRotate] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [clock, setClock] = useState(() => new Date().toISOString());
  const [calendarMonth, setCalendarMonth] = useState(() => String(events.find((event) => event.wallboard && event.status === "scheduled")?.startsAt || new Date().toISOString()).slice(0, 7));
  const ref = useRef(null);
  const watchById = new Map(watchlist.map((entry) => [entry.recordId, entry]));
  const visibleRecords = records.filter((record) => watchById.get(record.opportunityId)?.wallboard).sort((a, b) => (nextPublishedDate(a, asOf) || "9999").localeCompare(nextPublishedDate(b, asOf) || "9999"));
  const wallboardEvents = events.filter((event) => event.wallboard && event.status === "scheduled").sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  useEffect(() => {
    if (!rotate) return undefined;
    const modes = ["calendar", "records"];
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
  return <section ref={ref} className="ops-wallboard" data-ops-wallboard data-wallboard-mode={mode} data-wallboard-fullscreen={isFullscreen ? "true" : "false"}>
    <header className="ops-wallboard__masthead">
      <div className="ops-wallboard__brand"><WorkspaceMark workspace={workspace} eager /><div>{!isFullscreen ? <span>Conference room display</span> : null}<h2>{workspace?.displayTitle || "Defense Budget Intelligence"}</h2>{isFullscreen ? <p data-wallboard-workspace>{workspace?.name || "Local workspace"}</p> : null}</div></div>
      <div className="ops-wallboard__time"><time dateTime={clock}><strong>{now.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</strong>{!isFullscreen ? <span>{now.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" })}</span> : null}</time>{!isFullscreen ? <small data-wallboard-last-refresh>{lastRefreshedAt ? `Updated ${new Date(lastRefreshedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : "Updating…"}</small> : null}{!isFullscreen ? <small>Data through {compactDate(asOf)}</small> : null}</div>
    </header>
    {!isFullscreen ? <div className="ops-wallboard__toolbar">
      <nav aria-label="Display view"><button type="button" className={mode === "calendar" ? "is-active" : ""} onClick={() => setMode("calendar")}>Calendar</button><button type="button" className={mode === "records" ? "is-active" : ""} onClick={() => setMode("records")}>Tracked records</button></nav>
      <div><button type="button" data-wallboard-action="rotate" aria-label={rotate ? "Auto-cycle on" : "Auto-cycle off"} title={rotate ? "Auto-cycle on" : "Auto-cycle off"} aria-pressed={rotate} onClick={() => setRotate((value) => !value)}><RotateCw size={17} aria-hidden="true" /><span>{rotate ? "Auto-cycle on" : "Auto-cycle off"}</span></button><button type="button" data-wallboard-action="kiosk" aria-label={isFullscreen ? "Exit kiosk" : "Enter kiosk"} title={isFullscreen ? "Exit kiosk" : "Enter kiosk"} aria-pressed={isFullscreen} onClick={toggleFullscreen}>{isFullscreen ? <Minimize2 size={17} /> : <Maximize2 size={17} />}<span>{isFullscreen ? "Exit kiosk" : "Enter kiosk"}</span></button></div>
    </div> : null}
    {mode === "calendar" ? <Suspense fallback={<RouteFallback title="calendar" />}><WallboardCalendar events={wallboardEvents} categories={categories} teams={teams} month={calendarMonth} onMonthChange={setCalendarMonth} now={now} workspace={workspace} onOpenMember={onOpenMember} /></Suspense> : <WallboardRecords records={visibleRecords.slice(0, 12)} asOf={asOf} watchById={watchById} />}
  </section>;
}

function WallboardRecords({ records, asOf, watchById }) {
  return <section className="ops-wallboard__section ops-wallboard__section--records"><header><div><span>Stable-ID watchlist</span><strong>Tracked records</strong></div><b>{records.length}</b></header>{records.length ? <div className="ops-wallboard__cards">{records.map((record) => {
    const nextDate = nextPublishedDate(record, asOf);
    const reviewAt = watchById.get(record.opportunityId)?.reviewAt;
    return <article key={record.opportunityId} className="ops-wallboard__record"><div className="ops-wallboard__record-copy"><span>{record.id} · {record.portfolio}</span><strong>{record.title}</strong><small>{record.party || "Party not published"} · {money(recordAmount(record))}</small></div><div className="ops-wallboard__record-dates"><span>Next published date</span><time dateTime={nextDate}>{nextDate ? compactDate(nextDate) : "Not scheduled"}</time>{reviewAt ? <small>Review {compactDate(reviewAt)}</small> : null}</div></article>;
  })}</div> : <div className="ops-wallboard__empty"><Star size={30} /><strong>No tracked records</strong><p>Enable wallboard visibility from the Watchlist.</p></div>}</section>;
}

function useRouteSurface(parameter, allowed, fallback, onChange) {
  const read = () => {
    const value = new URLSearchParams(window.location.hash.split("?")[1] || "").get(parameter);
    return allowed.includes(value) ? value : fallback;
  };
  const [surface, setSurface] = useState(read);
  useEffect(() => {
    const sync = () => {
      const value = read();
      setSurface(value);
      onChange?.(value);
    };
    sync();
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  // The allowed list is a static route contract.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parameter]);
  function select(value) {
    const [path, search = ""] = window.location.hash.split("?");
    const params = new URLSearchParams(search);
    params.set(parameter, value);
    window.location.hash = `${path}?${params}`;
    setSurface(value);
    onChange?.(value);
  }
  return [surface, select];
}

function ScheduleView({ state, records, watchedRecords, categories, teams, auth, dataset, onAdd, onEdit, onDelete, onManageCategories }) {
  const [surface, setSurface] = useRouteSurface("scheduleView", ["list", "calendar", "display"], "list");
  const [calendarMonth, setCalendarMonth] = useState(() => String(state.events.find((event) => event.status === "scheduled")?.startsAt || new Date().toISOString()).slice(0, 7));
  const scheduled = state.events.filter((event) => event.status === "scheduled").length;
  const needsValidation = state.events.filter((event) => event.requiresValidation).length;
  const tabs = <nav className="if-tabs__list" aria-label="Schedule view">
    {[['list', 'List'], ['calendar', 'Calendar'], ['display', 'Display']].map(([id, label]) => <button key={id} type="button" className={`if-tab${surface === id ? " is-active" : ""}`} aria-pressed={surface === id} onClick={() => setSurface(id)}>{label}</button>)}
  </nav>;
  return <section className="ops-panel schedule-surface" data-schedule-surface={surface}>
    <ControlWorkbenchHeader eyebrow="Workspace schedule" title="Schedule" summary="Create events once, then work in a list, calendar, or conference-room display." metrics={[
      { id: "scheduled", label: "Scheduled", value: scheduled, meta: "Visible events" },
      { id: "validation", label: "Needs validation", value: needsValidation, meta: "AI review required", tone: needsValidation ? "warning" : "success" },
      { id: "teams", label: "Overlays", value: teams.length + 1, meta: "Workspace-wide plus teams" },
    ]} metricLabel="Schedule summary" tabs={tabs} />
    <ControlPageBody compact>
      {surface === "list" ? <EventsView embedded events={state.events} records={watchedRecords} categories={categories} canManageCategories={Boolean(auth?.user?.canManageWorkspace)} onAdd={onAdd} onEdit={onEdit} onDelete={onDelete} onManageCategories={onManageCategories} /> : null}
      {surface === "calendar" ? <Suspense fallback={<RouteFallback title="calendar" />}><WallboardCalendar standalone events={state.events.filter((event) => event.status === "scheduled")} categories={categories} teams={teams} month={calendarMonth} onMonthChange={setCalendarMonth} now={new Date()} workspace={auth?.user?.activeWorkspace || null} onOpenMember={(member) => openWorkspaceProfile("member", member.id)} /></Suspense> : null}
      {surface === "display" ? <WallboardView records={records} watchlist={state.watchlist} events={state.events} categories={categories} teams={teams} asOf={dataset.metadata.asOf} workspace={auth?.user?.activeWorkspace || null} lastRefreshedAt={state.lastRefreshedAt} onOpenMember={(member) => openWorkspaceProfile("member", member.id)} /> : null}
    </ControlPageBody>
  </section>;
}

function DirectoryView({ auth, state, records, teams }) {
  const [{ memberId, teamId }, setSelection] = useState(() => directorySelection());
  useEffect(() => {
    const sync = () => setSelection(directorySelection());
    window.addEventListener("hashchange", sync);
    window.addEventListener("popstate", sync);
    return () => {
      window.removeEventListener("hashchange", sync);
      window.removeEventListener("popstate", sync);
    };
  }, []);
  const seedMember = state.events.flatMap((event) => event.attendees || []).find((attendee) => String(attendee.id) === String(memberId)) || teams.flatMap((team) => team.members || []).find((member) => String(member.id) === String(memberId)) || null;
  const back = () => { window.location.hash = "#/budget-spend/schedule?scheduleView=calendar"; };
  if (teamId) return <Suspense fallback={<RouteFallback title="team profile" />}><WorkspaceTeamProfile teamId={teamId} teams={teams} events={state.events} records={records} onBack={back} /></Suspense>;
  return <Suspense fallback={<RouteFallback title="member profile" />}><WorkspaceMemberProfile auth={auth} memberId={memberId} seedMember={seedMember} events={state.events} teams={teams} records={records} onBack={back} /></Suspense>;
}

function ConnectionsView({ auth, state, records, dataset, samOpportunities, manualProcurement, procurementDelta, subawardSnapshot, budgetGeneratedAt, awardGeneratedAt, contractMonitor, contractMonitorState, onRetryContractMonitor, onSurfaceChange }) {
  const isSuper = auth?.user?.roleId === "super_user" && !auth?.user?.isEmulating;
  const [surface, setSurface] = useRouteSurface("connectionsView", isSuper ? ["integrations", "credentials", "activity", "operations"] : ["integrations", "credentials", "activity"], "integrations", onSurfaceChange);
  const [credentialProvider, setCredentialProvider] = useState(() => auth?.user?.canManageWorkspace ? "openai" : "agents");
  const tabs = <nav className="if-tabs__list" aria-label="Connections view">
    {[['integrations', 'Integrations'], ['credentials', 'Credentials'], ['activity', 'API activity'], ...(isSuper ? [['operations', 'Operations']] : [])].map(([id, label]) => <button key={id} type="button" className={`if-tab${surface === id ? " is-active" : ""}`} aria-pressed={surface === id} onClick={() => setSurface(id)}>{label}</button>)}
  </nav>;
  return <section className="ops-panel connections-surface" data-connections-surface={surface}>
    <ControlWorkbenchHeader eyebrow="Workspace administration" title="Connections" summary="Source coverage, protected credentials, and technical request diagnostics in one bounded surface." tabs={tabs} />
    {surface === "integrations" ? <Suspense fallback={<RouteFallback title="integrations" />}><IntegrationManagement embedded auth={auth} dataset={dataset} samOpportunities={samOpportunities} manualProcurement={manualProcurement} procurementDelta={procurementDelta} subawardSnapshot={subawardSnapshot} budgetGeneratedAt={budgetGeneratedAt} awardGeneratedAt={awardGeneratedAt} contractMonitor={contractMonitor || { metadata: {}, records: [] }} contractMonitorState={contractMonitorState === "idle" ? "loading" : contractMonitorState} onRetryContractMonitor={onRetryContractMonitor} /></Suspense> : null}
    {surface === "credentials" ? <ControlPageBody compact><nav className="if-tabs__list" aria-label="Credential provider">{auth?.user?.canManageWorkspace ? <><button type="button" className={`if-tab${credentialProvider === "openai" ? " is-active" : ""}`} aria-pressed={credentialProvider === "openai"} onClick={() => setCredentialProvider("openai")}>OpenAI</button><button type="button" className={`if-tab${credentialProvider === "sam-gov" ? " is-active" : ""}`} aria-pressed={credentialProvider === "sam-gov"} onClick={() => setCredentialProvider("sam-gov")}>SAM.gov</button></> : null}{auth?.user?.canManageAgents ? <button type="button" className={`if-tab${credentialProvider === "agents" ? " is-active" : ""}`} aria-pressed={credentialProvider === "agents"} onClick={() => setCredentialProvider("agents")}>Agent access</button> : null}</nav><div className="connections-credential-grid">{auth?.user?.canManageWorkspace && credentialProvider === "openai" ? <Suspense fallback={<RouteFallback title="workspace OpenAI credentials" />}><OpenAiKeyManagement auth={auth} scope="workspace" embedded /></Suspense> : null}{auth?.user?.canManageWorkspace && credentialProvider === "sam-gov" ? <Suspense fallback={<RouteFallback title="workspace SAM.gov credential" />}><SamGovKeyManagement auth={auth} embedded /></Suspense> : null}{auth?.user?.canManageAgents && credentialProvider === "agents" ? <Suspense fallback={<RouteFallback title="agent credentials" />}><AgentAccessPanel auth={auth} embedded /></Suspense> : null}{!auth?.user?.canManageWorkspace && !auth?.user?.canManageAgents ? <ControlAsyncState compact state="empty" icon={<Bot size={22} />} title="Administrator access required" message="Your role cannot manage workspace or agent credentials." /> : null}</div></ControlPageBody> : null}
    {surface === "activity" ? <ActivityView embedded activity={state.activity} apiRequests={state.apiRequests} apiRequestSummary={state.apiRequestSummary} records={records} /> : null}
    {surface === "operations" && isSuper ? <Suspense fallback={<RouteFallback title="acquisition operations" />}><AcquisitionOperations auth={auth} /></Suspense> : null}
  </section>;
}

export default function OperationsHub({ view: requestedView = "watchlist", dataset, awards = [], samOpportunities = { metadata: {}, records: [] }, manualProcurement = { records: [] }, procurementDelta = { records: [], summary: {} }, subawardSnapshot = { metadata: {}, primes: [] }, budgetGeneratedAt = "", awardGeneratedAt = "" }) {
  const auth = useAuth();
  const records = useMemo(() => applyProcurementChanges(assembleProcurementRecords(dataset.records || [], awards, dataset.metadata.asOf, samOpportunities.records || [], manualProcurement.records || [], subawardSnapshot), procurementDelta.records || []), [awards, dataset, manualProcurement.records, procurementDelta.records, samOpportunities.records, subawardSnapshot]);
  const state = useManagementState(records);
  const view = VIEWS.has(requestedView) ? requestedView : "watchlist";
  const [query, setQuery] = useState("");
  const [editor, setEditor] = useState(null);
  const [selectedTaskId, setSelectedTaskId] = useState(() => {
    const params = new URLSearchParams(window.location.hash.split("?")[1] || "");
    return params.get("task") || (params.get("aiJob") ? `event-ai:${params.get("aiJob")}` : "");
  });
  const [categoryManagerOpen, setCategoryManagerOpen] = useState(false);
  const [contractMonitor, setContractMonitor] = useState(null);
  const [contractMonitorState, setContractMonitorState] = useState("idle");
  const [connectionsSurface, setConnectionsSurface] = useState(() => new URLSearchParams(window.location.hash.split("?")[1] || "").get("connectionsView") || "integrations");
  useEffect(() => {
    const sync = () => {
      const params = new URLSearchParams(window.location.hash.split("?")[1] || "");
      setSelectedTaskId(params.get("task") || (params.get("aiJob") ? `event-ai:${params.get("aiJob")}` : ""));
    };
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);
  useEffect(() => {
    if (view !== "connections" || connectionsSurface !== "integrations" || contractMonitorState !== "idle") return undefined;
    const controller = new AbortController();
    const url = new URL(`${import.meta.env.BASE_URL}data/contract-monitor.json`, window.location.origin);
    void fetch(url, { headers: { accept: "application/json" }, signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error(`Contract monitor request failed (${response.status})`);
        return response.json();
      })
      .then((payload) => {
        setContractMonitor(payload);
        setContractMonitorState("ready");
      })
      .catch((error) => {
        if (error?.name !== "AbortError") setContractMonitorState("error");
      });
    return () => controller.abort();
  }, [connectionsSurface, contractMonitorState, view]);
  const watchedRecords = state.watchlist.map((entry) => records.find((record) => record.opportunityId === entry.recordId)).filter(Boolean);
  const calendarTeams = auth?.user?.roleId === "super_user" && !auth?.user?.isEmulating
    ? state.teams
    : state.teams.filter((team) => state.memberTeamIds.includes(team.id));
  return <div className={`operations-hub operations-hub--${view}`} data-operations-hub data-operations-view={view}>
    {state.error ? <p className="ops-alert" role="alert">Workspace sync failed: {state.error}</p> : null}
    {view === "watchlist" ? <WatchlistView rows={watchedRecords} watchlist={state.watchlist} asOf={dataset.metadata.asOf} query={query} setQuery={setQuery} toggleWatch={state.toggleWatch} updateWatch={state.updateWatch} /> : null}
    {view === "schedule" ? <ScheduleView state={state} records={records} watchedRecords={watchedRecords} categories={state.eventCategories} teams={calendarTeams} auth={auth} dataset={dataset} onAdd={() => setEditor({ mode: "add" })} onEdit={(event) => setEditor({ mode: "edit", event })} onDelete={state.deleteEvent} onManageCategories={() => setCategoryManagerOpen(true)} /> : null}
    {view === "directory" ? <DirectoryView auth={auth} state={state} records={records} teams={calendarTeams} /> : null}
    {view === "tasks" ? <TasksView apiRequests={state.apiRequests} selectedTaskId={selectedTaskId} onRefresh={state.refresh} onOpenDraft={(event) => setEditor({ mode: "review", event })} /> : null}
    {view === "connections" ? <ConnectionsView auth={auth} state={state} records={records} dataset={dataset} samOpportunities={samOpportunities} manualProcurement={manualProcurement} procurementDelta={procurementDelta} subawardSnapshot={subawardSnapshot} budgetGeneratedAt={budgetGeneratedAt} awardGeneratedAt={awardGeneratedAt} contractMonitor={contractMonitor} contractMonitorState={contractMonitorState} onRetryContractMonitor={() => setContractMonitorState("idle")} onSurfaceChange={setConnectionsSurface} /> : null}
    {view === "users" ? auth?.user?.canManageAccounts ? <Suspense fallback={<RouteFallback title="Accounts" />}><UserManagement auth={auth} /></Suspense> : <section className="ops-panel" data-users-unavailable><ControlAsyncState compact state="empty" icon={<UsersRound size={22} />} title="Super user access required" message="Global account lifecycle and emulation belong to the immutable Super user." /></section> : null}
    {view === "workspaces" ? auth?.user?.roleId === "super_user" ? <Suspense fallback={<RouteFallback title="Workspaces" />}><WorkspaceManagement auth={auth} /></Suspense> : <section className="ops-panel" data-workspaces-unavailable><ControlAsyncState compact state="empty" icon={<Building2 size={22} />} title="Super user access required" message="Cross-workspace administration is limited to the immutable Super user." /></section> : null}
    {view === "workspace-settings" ? auth?.user?.canManageWorkspace ? <Suspense fallback={<RouteFallback title="Workspace settings" />}><WorkspaceManagement auth={auth} activeOnly /></Suspense> : <section className="ops-panel" data-workspaces-unavailable><ControlAsyncState compact state="empty" icon={<Building2 size={22} />} title="Workspace manager access required" message="Your role cannot configure this workspace." /></section> : null}
    {editor ? <EventEditor event={editor.mode === "add" ? null : editor.event} review={editor.mode === "review"} records={watchedRecords} categories={state.eventCategories} teams={state.teams} onSave={state.saveEvent} onClose={() => setEditor(null)} /> : null}
    {categoryManagerOpen ? <EventCategoryManager categories={state.eventCategories} onSave={state.saveEventCategory} onDelete={state.deleteEventCategory} onClose={() => setCategoryManagerOpen(false)} /> : null}
  </div>;
}
