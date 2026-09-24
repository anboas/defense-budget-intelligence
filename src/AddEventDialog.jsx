import { useMemo, useRef, useState } from "react";
import { CalendarDays, CircleAlert, MapPin, Search, Sparkles, Tags, X } from "lucide-react";
import { ControlAsyncState, ControlDialog, ControlStatusBadge } from "control-surface-ui/react";
import ControlSelect from "./ControlSelect.jsx";
import EventLocationLink from "./EventLocationLink.jsx";
import EventPlacementSettings from "./EventPlacementSettings.jsx";
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

function EventCatalogCard({ event, badgeStatus, badgeLabel, secondaryIcon: SecondaryIcon = Tags, secondaryText, caveat, sourceUrl, sourceLabel = "Official source", unavailableSourceLabel = "No official link retained", actions, dataProps = {} }) {
  const topics = event.topics || [];
  const visibleTopics = topics.slice(0, 3);
  const hiddenTopicCount = Math.max(0, topics.length - visibleTopics.length);
  const identity = [event.sponsor, event.branch].filter(Boolean).join(" · ") || "Sponsor not published";
  return <article className="event-catalog-card" role="listitem" {...dataProps}>
    <header>
      <span className="event-catalog-card__identity"><strong>{event.title}</strong><small>{identity}</small></span>
      <ControlStatusBadge status={badgeStatus} label={badgeLabel} />
    </header>
    <p className="event-catalog-card__summary">{event.summary || "No summary was published in the official structured source."}</p>
    <div className="event-catalog-card__meta">
      <span><CalendarDays size={14} aria-hidden="true" /><span>{event.startsAt ? `${compactDate(event.startsAt)}${event.endsAt ? ` – ${compactDate(event.endsAt)}` : ""}` : "Date needs verification"}</span></span>
      <span><MapPin size={14} aria-hidden="true" /><EventLocationLink location={event.location} fallback="Location pending" /></span>
      <span><SecondaryIcon size={14} aria-hidden="true" /><span>{secondaryText}</span></span>
    </div>
    {visibleTopics.length ? <div className="event-catalog-card__topics" aria-label="Event topics">{visibleTopics.map((topic) => <span key={topic} className="if-badge if-badge--neutral">{topic}</span>)}{hiddenTopicCount ? <span className="if-badge if-badge--neutral">+{hiddenTopicCount}</span> : null}</div> : null}
    {caveat ? <small className="event-catalog-card__caveat">{caveat}</small> : null}
    <footer>{sourceUrl ? <a href={sourceUrl} target="_blank" rel="noreferrer">{sourceLabel}</a> : <span>{unavailableSourceLabel}</span>}{actions}</footer>
  </article>;
}

export default function AddEventDialog({ catalog, existingEvents, categories, teams, onCreate, onAugment, onSaved, onClose }) {
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
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [discardPrompt, setDiscardPrompt] = useState(false);
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
  const manualDirty = Boolean(manual.title || manual.startsAt || manual.endsAt || manual.location || manual.officialUrl || teamIds.length || wallboard === false);
  const manualErrors = {
    title: manual.title.trim() ? "" : "Enter an event name.",
    endsAt: manual.startsAt && manual.endsAt && new Date(manual.endsAt) < new Date(manual.startsAt) ? "End time must be after the start time." : "",
    officialUrl: manual.officialUrl?.trim() && !validEventLinkUrl(manual.officialUrl.trim()) ? "Use a complete HTTP or HTTPS URL." : "",
  };
  const manualValid = !Object.values(manualErrors).some(Boolean);

  function selectMode(nextMode) {
    setMode(nextMode);
    setError("");
    setDiscardPrompt(false);
  }
  function clearCatalogFilters() {
    setQuery("");
    setBranch("");
    setEventType("");
  }

  function draftFromCatalog(event) { return { ...catalogEventToDraft(event, catalogCategoryIds(event, categories)), teamIds, wallboard }; }
  async function addCatalogEvent(event) {
    setError("");
    if (!event.startsAt) { setMode("manual"); setManual(draftFromCatalog(event)); return; }
    setBusyId(event.id);
    try { const saved = await onCreate(draftFromCatalog(event)); onClose(); onSaved?.(saved); } catch (requestError) { setError(requestError.message); } finally { setBusyId(""); }
  }
  function manualDraft() {
    const officialUrl = manual.officialUrl?.trim();
    const links = [...(manual.links || [])];
    if (officialUrl && !links.some((link) => link.url === officialUrl)) links.unshift({ id: `manual-official-${Date.now()}`, label: "Official event", url: officialUrl });
    return { ...manual, links, teamIds, wallboard, updatedAt: new Date().toISOString() };
  }
  async function saveManual(augment) {
    setSubmitAttempted(true);
    if (!manualValid) return;
    setError(""); setBusyId(augment ? "manual-augment" : "manual-save");
    try {
      const created = await onCreate(manualDraft());
      onClose();
      if (augment) onAugment(created);
      else onSaved?.(created);
    } catch (requestError) { setError(requestError.message); } finally { setBusyId(""); }
  }
  function requestClose() {
    if (busyId) return;
    if (mode === "manual" && manualDirty) { setDiscardPrompt(true); return; }
    onClose();
  }
  const footer = mode === "manual"
    ? discardPrompt
      ? <><span className="event-dialog__footer-note">Discard this unsaved event?</span><button type="button" className="if-btn" onClick={() => setDiscardPrompt(false)}>Keep editing</button><button type="button" className="if-btn if-btn--danger" onClick={onClose}>Discard</button></>
      : <><button type="button" className="if-btn" disabled={Boolean(busyId)} onClick={requestClose}>Cancel</button><button type="button" aria-label="Save event" className="if-btn if-btn--secondary" disabled={Boolean(busyId) || !manual.title.trim()} onClick={() => void saveManual(false)}>{busyId === "manual-save" ? workingSpinner() : null}<span>Save</span></button><button type="button" className="if-btn if-btn--ai" disabled={Boolean(busyId) || !manual.title.trim()} onClick={() => void saveManual(true)}>{busyId === "manual-augment" ? workingSpinner() : <Sparkles size={15} aria-hidden="true" />}Save &amp; augment</button></>
    : <button type="button" className="if-btn" disabled={Boolean(busyId)} onClick={onClose}>Close</button>;

  return <ControlDialog open onClose={requestClose} title="Add event" eyebrow="Workspace schedule" summary="Find a curated event or create one from whatever details you have." size="wide" className="event-dialog-shell" dialogRef={dialogRef} closeLabel="Close add event" bodyProps={{ className: "event-dialog__body" }} surfaceProps={{ className: "event-dialog event-dialog--add", "data-add-event-dialog": mode }} footer={footer}>
    <nav className="if-tabs__list event-dialog__tabs" aria-label="Add event method">
      <button type="button" className={`if-tab${mode === "catalog" ? " is-active" : ""}`} aria-pressed={mode === "catalog"} onClick={() => selectMode("catalog")}>Search catalog</button>
      <button type="button" className={`if-tab${mode === "manual" ? " is-active" : ""}`} aria-pressed={mode === "manual"} onClick={() => selectMode("manual")}>Add manually</button>
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
        return <EventCatalogCard
          key={event.id}
          event={event}
          badgeStatus={event.confidence === "high" ? "verified" : event.confidence === "medium" ? "review" : "warning"}
          badgeLabel={`${event.confidence} confidence`}
          secondaryText={`${event.eventType.replaceAll("_", " ")} · ${event.format.replaceAll("_", " ")}`}
          caveat={event.caveats?.[0]}
          sourceUrl={event.links?.[0]?.url}
          dataProps={{ "data-catalog-event": event.id }}
          actions={<button type="button" className="if-btn if-btn--primary if-btn--sm" disabled={Boolean(existing) || Boolean(busyId)} onClick={() => void addCatalogEvent(event)}>{existing ? "Added" : busyId === event.id ? "Adding…" : event.startsAt ? "Add to calendar" : "Review before adding"}</button>}
        />;
      })}</div> : <ControlAsyncState compact state="empty" icon={<Search size={22} />} title="No curated events match" message="Try a broader term or clear the branch and type filters." action={filtered ? <button type="button" className="if-btn if-btn--secondary" onClick={clearCatalogFilters}>Clear filters</button> : null} />}
    </div> : <form className="if-form-grid event-dialog__form" onSubmit={(event) => { event.preventDefault(); void saveManual(false); }}>
      {discardPrompt ? <div className="if-alert if-alert--warning if-field--full" role="alert"><CircleAlert size={17} aria-hidden="true" /><div><strong>Unsaved event</strong><p>Keep editing, or discard the details you entered.</p></div></div> : null}
      <label className="if-field if-field--full"><span className="if-field__label">Event name <small>(required)</small></span><input className="if-input" autoFocus required aria-invalid={submitAttempted && Boolean(manualErrors.title)} value={manual.title} placeholder="SOF Week 2027" onChange={(event) => { setManual((value) => ({ ...value, title: event.target.value })); setDiscardPrompt(false); }} />{submitAttempted && manualErrors.title ? <small className="if-field__error">{manualErrors.title}</small> : null}</label>
      <label className="if-field if-field--full"><span className="if-field__label">Official URL <small>(recommended)</small></span><input className="if-input" type="url" aria-invalid={submitAttempted && Boolean(manualErrors.officialUrl)} value={manual.officialUrl || ""} placeholder="https://…" onChange={(event) => { setManual((value) => ({ ...value, officialUrl: event.target.value })); setDiscardPrompt(false); }} />{submitAttempted && manualErrors.officialUrl ? <small className="if-field__error">{manualErrors.officialUrl}</small> : <small className="if-field__hint">A canonical event page gives augmentation a stronger identity and evidence boundary.</small>}</label>
      <label className="if-field"><span className="if-field__label">Starts <small>(optional)</small></span><input className="if-input" type="datetime-local" value={String(manual.startsAt || "").slice(0, 16)} onChange={(event) => setManual((value) => ({ ...value, startsAt: event.target.value }))} /></label>
      <label className="if-field"><span className="if-field__label">Ends <small>(optional)</small></span><input className="if-input" type="datetime-local" aria-invalid={submitAttempted && Boolean(manualErrors.endsAt)} value={String(manual.endsAt || "").slice(0, 16)} onChange={(event) => setManual((value) => ({ ...value, endsAt: event.target.value }))} />{submitAttempted && manualErrors.endsAt ? <small className="if-field__error">{manualErrors.endsAt}</small> : null}</label>
      <label className="if-field if-field--full"><span className="if-field__label">Location hint</span><input className="if-input" value={manual.location || ""} placeholder="City, venue, virtual, or leave blank" onChange={(event) => setManual((value) => ({ ...value, location: event.target.value }))} /></label>
      <EventPlacementSettings teams={teams} teamIds={teamIds} setTeamIds={setTeamIds} wallboard={wallboard} setWallboard={setWallboard} />
      <div className="if-alert if-alert--info if-field--full event-dialog__note"><CalendarDays size={17} aria-hidden="true" /><div><strong>A title is enough to save</strong><p>Unknown dates stay pending. AI suggestions remain cited and review-first.</p></div></div>
    </form>}
  </ControlDialog>;
}
