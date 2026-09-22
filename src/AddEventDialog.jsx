import { useMemo, useRef, useState } from "react";
import { Bot, CalendarDays, CircleAlert, MapPin, RotateCw, Search, Sparkles, Tags, X } from "lucide-react";
import { ControlAsyncState, ControlDialog, ControlDisclosure, ControlStatusBadge } from "control-surface-ui/react";
import ControlSelect from "./ControlSelect.jsx";
import EventTeamSelector from "./EventTeamSelector.jsx";
import { useAuth } from "./AuthContext.jsx";
import { MANAGEMENT_STATE_EVENT } from "./management-state.js";
import { catalogEventToDraft } from "./event-catalog.js";

function compactDate(value) {
  if (!value) return "Not scheduled";
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? "Not scheduled" : date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

function validEventLinkUrl(value) {
  try { return ["http:", "https:"].includes(new URL(value).protocol); } catch { return false; }
}

function newEventDraft() {
  return { id: `event-${Date.now()}`, title: "", startsAt: "", endsAt: "", location: "", links: [], categoryIds: [], notes: "", status: "scheduled", recordIds: [], attendees: [], attendeeIds: [], teamIds: [], milestones: [], wallboard: true };
}

function workingSpinner() {
  return <span className="if-loading-dots if-loading-dots--orbit if-loading-dots--sm" aria-hidden="true"><span /><span /><span /></span>;
}

function catalogCategoryIds(event, categories) {
  const wanted = String(event?.eventType || "").replaceAll("_", "-").toLowerCase();
  const match = categories.find((category) => category.id === wanted || category.name.toLowerCase() === wanted.replaceAll("-", " "));
  return match ? [match.id] : [];
}

function EventPlacementSettings({ teams, teamIds, setTeamIds, wallboard, setWallboard }) {
  const visibility = teamIds.length ? `${teamIds.length} team${teamIds.length === 1 ? "" : "s"}` : "Workspace-wide";
  return <ControlDisclosure
    className="event-placement-settings if-field--full"
    title="Visibility & display"
    summary={`${visibility} · Wallboard ${wallboard ? "on" : "off"}`}
    data-event-placement-settings
  >
    <div className="event-placement-settings__body">
      <EventTeamSelector teams={teams} value={teamIds} onChange={setTeamIds} />
      <label className="if-checkbox event-dialog__checkbox"><input type="checkbox" checked={wallboard} onChange={(event) => setWallboard(event.target.checked)} /><span><strong>Show on wallboard</strong><small>Visibility and display settings stay operator-owned during AI research.</small></span></label>
    </div>
  </ControlDisclosure>;
}

export default function AddEventDialog({ catalog, existingEvents, categories, teams, onCreate, onAugment, onClose }) {
  const auth = useAuth();
  const dialogRef = useRef(null);
  const [mode, setMode] = useState("catalog");
  const [query, setQuery] = useState("");
  const [branch, setBranch] = useState("");
  const [eventType, setEventType] = useState("");
  const [teamIds, setTeamIds] = useState([]);
  const [wallboard, setWallboard] = useState(true);
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");
  const [manual, setManual] = useState(() => newEventDraft());
  const [discovery, setDiscovery] = useState(null);
  const canCurate = auth?.user?.roleId === "super_user" && auth?.authVersion === "dbi-pages-auth-v1";
  const added = useMemo(() => new Map(existingEvents.filter((event) => event.catalogEventId).map((event) => [event.catalogEventId, event])), [existingEvents]);
  const branches = useMemo(() => [...new Set(catalog.map((event) => event.branch))].sort(), [catalog]);
  const eventTypes = useMemo(() => [...new Set(catalog.map((event) => event.eventType))].sort(), [catalog]);
  const results = useMemo(() => {
    const term = query.trim().toLowerCase();
    return catalog.filter((event) => {
      if (branch && event.branch !== branch) return false;
      if (eventType && event.eventType !== eventType) return false;
      return !term || [event.title, event.summary, event.branch, event.sponsor, event.location, ...(event.topics || []), ...(event.keywords || [])].join(" ").toLowerCase().includes(term);
    });
  }, [branch, catalog, eventType, query]);
  const filtered = Boolean(query || branch || eventType);

  function selectMode(nextMode) {
    setMode(nextMode);
    setError("");
  }
  function clearCatalogFilters() {
    setQuery("");
    setBranch("");
    setEventType("");
  }

  async function discoveryRequest(path = "", options = {}) {
    const response = await fetch(`/api/v1/auth/event-discovery${path}`, { credentials: "same-origin", headers: { "content-type": "application/json", ...(options.headers || {}) }, ...options });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "Event discovery is unavailable.");
    return payload;
  }
  async function loadDiscovery() {
    setBusyId("discovery-load");
    try { setDiscovery(await discoveryRequest("?status=pending")); setError(""); } catch (requestError) { setError(requestError.message); } finally { setBusyId(""); }
  }
  async function runDiscovery() {
    setBusyId("discovery-run");
    try { setDiscovery(await discoveryRequest("", { method: "POST", body: JSON.stringify({ action: "run", maxSources: 2 }) })); setError(""); } catch (requestError) { setError(requestError.message); } finally { setBusyId(""); }
  }
  async function reviewDiscovery(candidateId, decision) {
    setBusyId(candidateId);
    try {
      await discoveryRequest(`/${encodeURIComponent(candidateId)}`, { method: "PATCH", body: JSON.stringify({ decision }) });
      setDiscovery(await discoveryRequest("?status=pending"));
      if (decision === "publish") window.dispatchEvent(new CustomEvent(MANAGEMENT_STATE_EVENT));
      setError("");
    } catch (requestError) { setError(requestError.message); } finally { setBusyId(""); }
  }
  function draftFromCatalog(event) { return { ...catalogEventToDraft(event, catalogCategoryIds(event, categories)), teamIds, wallboard }; }
  async function addCatalogEvent(event) {
    setError("");
    if (!event.startsAt) { setMode("manual"); setManual(draftFromCatalog(event)); return; }
    setBusyId(event.id);
    try { await onCreate(draftFromCatalog(event)); onClose(); } catch (requestError) { setError(requestError.message); } finally { setBusyId(""); }
  }
  function validateManual() {
    if (!manual.title.trim()) return "Enter an event name.";
    if (manual.startsAt && manual.endsAt && new Date(manual.endsAt) < new Date(manual.startsAt)) return "End time must be after the start time.";
    if (manual.officialUrl?.trim() && !validEventLinkUrl(manual.officialUrl.trim())) return "The official URL must use HTTP or HTTPS.";
    return "";
  }
  function manualDraft() {
    const officialUrl = manual.officialUrl?.trim();
    const links = [...(manual.links || [])];
    if (officialUrl && !links.some((link) => link.url === officialUrl)) links.unshift({ id: `manual-official-${Date.now()}`, label: "Official event", url: officialUrl });
    return { ...manual, links, teamIds, wallboard, updatedAt: new Date().toISOString() };
  }
  async function saveManual(augment) {
    const validation = validateManual();
    if (validation) { setError(validation); return; }
    setError(""); setBusyId(augment ? "manual-augment" : "manual-save");
    try { const created = await onCreate(manualDraft()); onClose(); if (augment) onAugment(created); } catch (requestError) { setError(requestError.message); } finally { setBusyId(""); }
  }
  const footer = mode === "manual"
    ? <><button type="button" className="if-btn" disabled={Boolean(busyId)} onClick={onClose}>Cancel</button><button type="button" aria-label="Save event" className="if-btn if-btn--secondary" disabled={Boolean(busyId)} onClick={() => void saveManual(false)}>{busyId === "manual-save" ? workingSpinner() : null}<span>Save</span></button><button type="button" className="if-btn if-btn--ai" disabled={Boolean(busyId)} onClick={() => void saveManual(true)}>{busyId === "manual-augment" ? workingSpinner() : <Sparkles size={15} aria-hidden="true" />}Save &amp; augment</button></>
    : mode === "discovery"
      ? <><button type="button" className="if-btn if-btn--secondary" disabled={Boolean(busyId)} onClick={() => void runDiscovery()}>{busyId === "discovery-run" ? workingSpinner() : <RotateCw size={15} aria-hidden="true" />}Scan next sources</button><button type="button" className="if-btn" disabled={Boolean(busyId)} onClick={onClose}>Close</button></>
      : <button type="button" className="if-btn" disabled={Boolean(busyId)} onClick={onClose}>Close</button>;

  return <ControlDialog open onClose={() => { if (!busyId) onClose(); }} title="Add event" eyebrow="Workspace schedule" summary="Find a curated event or create one from whatever details you have." size="wide" dialogRef={dialogRef} closeLabel="Close add event" bodyProps={{ className: "event-dialog__body" }} surfaceProps={{ className: "event-dialog event-dialog--add", "data-add-event-dialog": mode }} footer={footer}>
    <nav className="if-tabs__list event-dialog__tabs" aria-label="Add event method">
      <button type="button" className={`if-tab${mode === "catalog" ? " is-active" : ""}`} aria-pressed={mode === "catalog"} onClick={() => selectMode("catalog")}>Search catalog</button>
      <button type="button" className={`if-tab${mode === "manual" ? " is-active" : ""}`} aria-pressed={mode === "manual"} onClick={() => selectMode("manual")}>Add manually</button>
      {canCurate ? <button type="button" className={`if-tab${mode === "discovery" ? " is-active" : ""}`} aria-label="Discovery review" aria-pressed={mode === "discovery"} onClick={() => { selectMode("discovery"); if (!discovery) void loadDiscovery(); }}>Discovery{discovery?.counts?.pending ? ` (${discovery.counts.pending})` : ""}</button> : null}
    </nav>
    {error ? <div role="alert" className="if-alert if-alert--danger event-dialog__alert"><CircleAlert size={17} aria-hidden="true" /><div><strong>Could not complete that action</strong><p>{error}</p></div></div> : null}
    {mode === "catalog" ? <div className="event-catalog-browser">
      <div className="event-catalog-browser__controls">
        <label className="if-field event-catalog-browser__search"><span className="if-field__label">Search curated events</span><span className="if-input-with-icon"><Search size={16} aria-hidden="true" /><input className="if-input" type="search" value={query} placeholder="SOF Week, Army, autonomy, Orlando…" onChange={(event) => setQuery(event.target.value)} />{query ? <button type="button" className="event-catalog-browser__clear" aria-label="Clear catalog search" onClick={() => setQuery("")}><X size={15} aria-hidden="true" /></button> : null}</span></label>
        <div className="if-field"><span className="if-field__label">Branch</span><ControlSelect ariaLabel="Catalog branch" value={branch} options={[["", "All branches"], ...branches.map((value) => [value, value])]} onChange={setBranch} portalTarget={dialogRef} /></div>
        <div className="if-field"><span className="if-field__label">Type</span><ControlSelect ariaLabel="Catalog event type" value={eventType} options={[["", "All types"], ...eventTypes.map((value) => [value, value.replaceAll("_", " ")])]} onChange={setEventType} portalTarget={dialogRef} /></div>
      </div>
      <div className="event-catalog-browser__status"><p><strong>{results.length}</strong> of {catalog.length} curated events</p>{filtered ? <button type="button" className="if-btn if-btn--secondary if-btn--sm" onClick={clearCatalogFilters}>Clear filters</button> : <span>Official sources first · projected dates stay marked</span>}</div>
      <EventPlacementSettings teams={teams} teamIds={teamIds} setTeamIds={setTeamIds} wallboard={wallboard} setWallboard={setWallboard} />
      {results.length ? <div className="event-catalog-results" role="list" aria-label="Curated event catalog">{results.map((event) => {
        const existing = added.get(event.id);
        return <article key={event.id} className="event-catalog-card" role="listitem" data-catalog-event={event.id}><header><span><strong>{event.title}</strong><small>{event.sponsor} · {event.branch}</small></span><ControlStatusBadge status={event.confidence === "high" ? "verified" : event.confidence === "medium" ? "review" : "warning"} label={`${event.confidence} confidence`} /></header><p>{event.summary}</p><div className="event-catalog-card__meta"><span><CalendarDays size={14} aria-hidden="true" />{event.startsAt ? `${compactDate(event.startsAt)}${event.endsAt ? ` – ${compactDate(event.endsAt)}` : ""}` : "Date needs verification"}</span><span><MapPin size={14} aria-hidden="true" />{event.location || "Location pending"}</span><span><Tags size={14} aria-hidden="true" />{event.eventType.replaceAll("_", " ")} · {event.format.replaceAll("_", " ")}</span></div>{event.topics?.length ? <div className="event-catalog-card__topics">{event.topics.slice(0, 4).map((topic) => <span key={topic} className="if-badge if-badge--neutral">{topic}</span>)}</div> : null}{event.caveats?.length ? <small className="event-catalog-card__caveat">{event.caveats[0]}</small> : null}<footer>{event.links?.[0] ? <a href={event.links[0].url} target="_blank" rel="noreferrer">Official source</a> : <span>No official link retained</span>}<button type="button" className="if-btn if-btn--primary if-btn--sm" disabled={Boolean(existing) || Boolean(busyId)} onClick={() => void addCatalogEvent(event)}>{existing ? "Added" : busyId === event.id ? "Adding…" : event.startsAt ? "Add to calendar" : "Review before adding"}</button></footer></article>;
      })}</div> : <ControlAsyncState compact state="empty" icon={<Search size={22} />} title="No curated events match" message="Try a broader term or clear the branch and type filters." action={filtered ? <button type="button" className="if-btn if-btn--secondary" onClick={clearCatalogFilters}>Clear filters</button> : null} />}
    </div> : mode === "discovery" ? <div className="event-catalog-browser" data-event-discovery-review>
      <div className="if-alert if-alert--info"><Bot size={17} aria-hidden="true" /><div><strong>Official-source discovery queue</strong><p>The hourly agent scans source registry pages for structured event editions. Nothing enters the catalog until you publish it here.</p></div></div>
      {busyId === "discovery-load" ? <ControlAsyncState compact state="loading" title="Loading discovery queue" message="Reading source-backed candidates." /> : discovery?.candidates?.length ? <div className="event-catalog-results" role="list" aria-label="Event discovery candidates">{discovery.candidates.map((entry) => <article key={entry.id} className="event-catalog-card" role="listitem" data-event-discovery-candidate={entry.id}><header><span><strong>{entry.candidate.title}</strong><small>{entry.candidate.sponsor || entry.sourceId} · {entry.candidate.branch || "Joint"}</small></span><ControlStatusBadge status="review" label="Needs review" /></header><p>{entry.candidate.summary || "No summary was published in the official structured source."}</p><div className="event-catalog-card__meta"><span><CalendarDays size={14} aria-hidden="true" />{compactDate(entry.candidate.startsAt)}{entry.candidate.endsAt ? ` – ${compactDate(entry.candidate.endsAt)}` : ""}</span><span><MapPin size={14} aria-hidden="true" />{entry.candidate.location || "Location not published"}</span><span><Bot size={14} aria-hidden="true" />Discovered {compactDate(entry.discoveredAt)}</span></div><footer><a href={entry.sourceUrl} target="_blank" rel="noreferrer">Inspect official source</a><span className="event-catalog-card__actions"><button type="button" className="if-btn if-btn--secondary if-btn--sm" disabled={Boolean(busyId)} onClick={() => void reviewDiscovery(entry.id, "reject")}>Reject</button><button type="button" className="if-btn if-btn--primary if-btn--sm" disabled={Boolean(busyId)} onClick={() => void reviewDiscovery(entry.id, "publish")}>{busyId === entry.id ? "Reviewing…" : "Publish to catalog"}</button></span></footer></article>)}</div> : <ControlAsyncState compact state="empty" icon={<Search size={22} />} title="No pending candidates" message="The queue is clear. Scan the next source pair now or wait for the hourly schedule." />}
      {discovery?.latestRun ? <p className="if-field__hint">Latest scan: {discovery.latestRun.sourceId} · {discovery.latestRun.status} · {discovery.latestRun.candidatesAdded} new candidate{discovery.latestRun.candidatesAdded === 1 ? "" : "s"}</p> : null}
    </div> : <form className="if-form-grid event-dialog__form" onSubmit={(event) => { event.preventDefault(); void saveManual(false); }}>
      <label className="if-field if-field--full"><span className="if-field__label">Event name</span><input className="if-input" autoFocus value={manual.title} placeholder="SOF Week 2027" onChange={(event) => setManual((value) => ({ ...value, title: event.target.value }))} /></label>
      <label className="if-field if-field--full"><span className="if-field__label">Official URL <small>(recommended)</small></span><input className="if-input" type="url" value={manual.officialUrl || ""} placeholder="https://…" onChange={(event) => setManual((value) => ({ ...value, officialUrl: event.target.value }))} /><small className="if-field__hint">A canonical event page gives augmentation a stronger identity and evidence boundary.</small></label>
      <label className="if-field"><span className="if-field__label">Starts <small>(optional)</small></span><input className="if-input" type="datetime-local" value={String(manual.startsAt || "").slice(0, 16)} onChange={(event) => setManual((value) => ({ ...value, startsAt: event.target.value }))} /></label>
      <label className="if-field"><span className="if-field__label">Ends <small>(optional)</small></span><input className="if-input" type="datetime-local" value={String(manual.endsAt || "").slice(0, 16)} onChange={(event) => setManual((value) => ({ ...value, endsAt: event.target.value }))} /></label>
      <label className="if-field if-field--full"><span className="if-field__label">Location hint</span><input className="if-input" value={manual.location || ""} placeholder="City, venue, virtual, or leave blank" onChange={(event) => setManual((value) => ({ ...value, location: event.target.value }))} /></label>
      <EventPlacementSettings teams={teams} teamIds={teamIds} setTeamIds={setTeamIds} wallboard={wallboard} setWallboard={setWallboard} />
      <div className="if-alert if-alert--info if-field--full event-dialog__note"><CalendarDays size={17} aria-hidden="true" /><div><strong>A title is enough to save</strong><p>Unknown dates stay pending. AI suggestions remain cited and review-first.</p></div></div>
    </form>}
  </ControlDialog>;
}
