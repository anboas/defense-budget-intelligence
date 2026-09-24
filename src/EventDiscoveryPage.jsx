import { useEffect, useMemo, useState } from "react";
import { CalendarCheck2, CircleAlert, ExternalLink, RefreshCw, SearchCheck, ShieldCheck, Trash2 } from "lucide-react";
import { ControlAsyncState, ControlDialog, ControlMetricStrip, ControlPageBody, ControlPageHeader, ControlStatusBadge, useToast } from "control-surface-ui/react";
import OperationalDataTable from "./OperationalDataTable.jsx";
import { useAuth } from "./AuthContext.jsx";

const QUEUES = [
  ["review", "Needs review", "review"],
  ["ready", "Ready", "ready"],
  ["leads", "Undated leads", "leads"],
  ["updates", "Updates", "updates"],
  ["low-quality", "Likely noise", "lowQuality"],
  ["duplicates", "Duplicates", "duplicates"],
  ["published", "Published", "published"],
  ["rejected", "Rejected", "rejected"],
];

function dateTime(value, fallback = "Never") {
  if (!value) return fallback;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? fallback : date.toLocaleString([], { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
}

function dateInput(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 16);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function sourceName(snapshot, sourceId) {
  return snapshot?.sources?.find((source) => source.id === sourceId)?.name || sourceId || "Unknown source";
}

function queueLabel(entry) {
  if (entry.status === "published") return "Published";
  if (entry.status === "rejected") return "Rejected";
  if (entry.status === "update") return "Update";
  if (entry.status === "duplicate") return "Duplicate";
  if (entry.status === "invalid" || entry.quality?.isLikelyEvent === false) return "Likely noise";
  return entry.candidate?.startsAt ? "Ready" : "Undated lead";
}

function queueTone(entry) {
  if (entry.status === "published") return "verified";
  if (entry.status === "rejected" || entry.status === "invalid" || entry.quality?.isLikelyEvent === false) return "neutral";
  if (entry.status === "update") return "warning";
  if (entry.status === "duplicate") return "info";
  return entry.candidate?.startsAt ? "review" : "warning";
}

function candidateDraft(entry) {
  const candidate = entry?.candidate || {};
  return {
    title: candidate.title || "",
    officialUrl: candidate.sources?.[0]?.url || candidate.links?.[0]?.url || entry?.sourceUrl || "",
    startsAt: dateInput(candidate.startsAt),
    endsAt: dateInput(candidate.endsAt),
    location: candidate.location || "",
    sponsor: candidate.sponsor || "",
    branch: candidate.branch || "Joint",
    eventType: candidate.eventType || "event",
    summary: candidate.summary || "",
  };
}

function CandidateReviewDialog({ entry, busy, onClose, onPublish, onReject }) {
  const [draft, setDraft] = useState(() => candidateDraft(entry));
  const officialUrlValid = (() => { try { return ["http:", "https:"].includes(new URL(draft.officialUrl).protocol); } catch { return false; } })();
  const datesValid = !draft.endsAt || !draft.startsAt || Date.parse(draft.endsAt) >= Date.parse(draft.startsAt);
  const publishable = Boolean(draft.title.trim() && draft.startsAt && officialUrlValid && datesValid);
  const footer = <>
    <button type="button" className="if-btn if-btn--danger" disabled={busy} onClick={() => onReject(entry)}>Reject as non-event</button>
    <button type="button" className="if-btn" disabled={busy} onClick={onClose}>Cancel</button>
    <button type="button" className="if-btn if-btn--primary" disabled={busy || !publishable} onClick={() => onPublish(entry, draft)}>{busy ? "Publishing…" : entry.status === "update" ? "Apply verified update" : "Publish verified event"}</button>
  </>;
  return <ControlDialog open onClose={onClose} title="Verify discovery candidate" eyebrow="Event discovery" summary="Correct the official details, then publish only when this is a specific dated event." size="wide" surfaceProps={{ "data-event-discovery-review-dialog": entry.id }} footer={footer}>
    <form className="if-form-grid event-dialog__form" onSubmit={(event) => { event.preventDefault(); if (publishable) onPublish(entry, draft); }}>
      {entry.quality?.issues?.length ? <div className="if-alert if-alert--warning if-field--full"><CircleAlert size={17} aria-hidden="true" /><div><strong>Quality checks need attention</strong><p>{entry.quality.issues.join(" ")}</p></div></div> : null}
      <label className="if-field if-field--full"><span className="if-field__label">Event name <small>(required)</small></span><input className="if-input" value={draft.title} onChange={(event) => setDraft((value) => ({ ...value, title: event.target.value }))} /></label>
      <label className="if-field if-field--full"><span className="if-field__label">Official event URL <small>(required)</small></span><input className="if-input" type="url" aria-invalid={Boolean(draft.officialUrl) && !officialUrlValid} value={draft.officialUrl} onChange={(event) => setDraft((value) => ({ ...value, officialUrl: event.target.value }))} />{draft.officialUrl && !officialUrlValid ? <small className="if-field__error">Use a complete HTTP or HTTPS URL.</small> : null}</label>
      <label className="if-field"><span className="if-field__label">Starts <small>(required)</small></span><input className="if-input" type="datetime-local" value={draft.startsAt} onChange={(event) => setDraft((value) => ({ ...value, startsAt: event.target.value }))} /></label>
      <label className="if-field"><span className="if-field__label">Ends</span><input className="if-input" type="datetime-local" aria-invalid={!datesValid} value={draft.endsAt} onChange={(event) => setDraft((value) => ({ ...value, endsAt: event.target.value }))} />{!datesValid ? <small className="if-field__error">End must be on or after the start.</small> : null}</label>
      <label className="if-field if-field--full"><span className="if-field__label">Location</span><input className="if-input" value={draft.location} onChange={(event) => setDraft((value) => ({ ...value, location: event.target.value }))} /></label>
      <label className="if-field"><span className="if-field__label">Organizer</span><input className="if-input" value={draft.sponsor} onChange={(event) => setDraft((value) => ({ ...value, sponsor: event.target.value }))} /></label>
      <label className="if-field"><span className="if-field__label">Branch</span><input className="if-input" value={draft.branch} onChange={(event) => setDraft((value) => ({ ...value, branch: event.target.value }))} /></label>
      <label className="if-field if-field--full"><span className="if-field__label">Summary</span><textarea className="if-textarea" rows={4} value={draft.summary} onChange={(event) => setDraft((value) => ({ ...value, summary: event.target.value }))} /></label>
      <div className="if-alert if-alert--info if-field--full"><ShieldCheck size={17} aria-hidden="true" /><div><strong>Publication boundary</strong><p>Publishing adds this verified edition to the curated catalog. It does not add the event to a workspace calendar.</p></div></div>
    </form>
  </ControlDialog>;
}

function RejectDialog({ entries, busy, onClose, onConfirm }) {
  const [reason, setReason] = useState(entries.length === 1 ? "Not an event" : "Bulk rejected as non-events");
  return <ControlDialog open onClose={onClose} title={entries.length === 1 ? "Reject discovery candidate" : `Reject ${entries.length} candidates`} eyebrow="Event discovery" summary="Rejected candidates leave the active review queue and remain in review history." footer={<><button type="button" className="if-btn" disabled={busy} onClick={onClose}>Cancel</button><button type="button" className="if-btn if-btn--danger" disabled={busy || !reason.trim()} onClick={() => onConfirm(entries, reason)}>{busy ? "Rejecting…" : "Reject"}</button></>}>
    <label className="if-field"><span className="if-field__label">Reason</span><textarea className="if-textarea" rows={3} value={reason} onChange={(event) => setReason(event.target.value)} /></label>
  </ControlDialog>;
}

async function requestDiscovery(path = "", options = {}) {
  const response = await fetch(`/api/v1/auth/event-discovery${path}`, { credentials: "same-origin", headers: { "content-type": "application/json", ...(options.headers || {}) }, ...options });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "Event discovery is unavailable.");
  return payload;
}

export default function EventDiscoveryPage() {
  const auth = useAuth();
  const { showToast } = useToast();
  const [surface, setSurface] = useState("queue");
  const [queue, setQueue] = useState("review");
  const [snapshot, setSnapshot] = useState(null);
  const [busy, setBusy] = useState("load");
  const [error, setError] = useState("");
  const [reviewing, setReviewing] = useState(null);
  const [rejecting, setRejecting] = useState([]);
  const canCurate = auth?.user?.roleId === "super_user" && auth?.authVersion === "dbi-pages-auth-v1";

  async function load(nextQueue = queue) {
    setBusy("load");
    try {
      setSnapshot(await requestDiscovery(`?view=${encodeURIComponent(nextQueue)}&limit=200`));
      setError("");
    } catch (requestError) { setError(requestError.message); } finally { setBusy(""); }
  }

  useEffect(() => {
    if (!canCurate) return undefined;
    let cancelled = false;
    async function fetchSnapshot() {
      try {
        const payload = await requestDiscovery(`?view=${encodeURIComponent(queue)}&limit=200`);
        if (!cancelled) { setSnapshot(payload); setError(""); }
      } catch (requestError) {
        if (!cancelled) setError(requestError.message);
      } finally {
        if (!cancelled) setBusy("");
      }
    }
    void fetchSnapshot();
    return () => { cancelled = true; };
  }, [canCurate, queue]);

  async function runScan() {
    setBusy("scan");
    try {
      const payload = await requestDiscovery("", { method: "POST", body: JSON.stringify({ action: "run", maxSources: 8, view: queue }) });
      setSnapshot(payload);
      setError("");
      showToast({ tone: "success", title: "Source scan completed", message: `${payload.result?.sourcesAttempted || 0} due sources checked, ${payload.result?.results?.reduce((total, row) => total + Number(row.added || 0), 0) || 0} new candidates retained.` });
    } catch (requestError) { setError(requestError.message); } finally { setBusy(""); }
  }

  async function publish(entry, draft) {
    setBusy(`publish:${entry.id}`);
    try {
      await requestDiscovery(`/${encodeURIComponent(entry.id)}`, { method: "PATCH", body: JSON.stringify({ decision: "publish", candidate: draft }) });
      setReviewing(null);
      await load(queue);
      showToast({ tone: "success", title: "Verified event published", message: `${draft.title} is now available in the curated event catalog.` });
    } catch (requestError) { setError(requestError.message); } finally { setBusy(""); }
  }

  async function reject(entries, reason) {
    setBusy("reject");
    try {
      await Promise.all(entries.map((entry) => requestDiscovery(`/${encodeURIComponent(entry.id)}`, { method: "PATCH", body: JSON.stringify({ decision: "reject", reason }) })));
      setRejecting([]);
      setReviewing(null);
      await load(queue);
      showToast({ tone: "success", title: entries.length === 1 ? "Candidate rejected" : `${entries.length} candidates rejected`, message: "The active review queue has been refreshed." });
    } catch (requestError) { setError(requestError.message); } finally { setBusy(""); }
  }

  const sourceMap = useMemo(() => new Map((snapshot?.sources || []).map((source) => [source.id, source])), [snapshot?.sources]);
  const candidateRows = snapshot?.candidates || [];
  const candidateColumns = [
    { key: "title", label: "Candidate", required: true, sticky: true, mobilePrimary: true, minWidth: 260, value: (entry) => entry.candidate?.title || "Untitled", render: (entry) => <><strong>{entry.candidate?.title || "Untitled"}</strong><small>{entry.candidate?.summary || "No event summary published"}</small></> },
    { key: "queue", label: "Queue", facet: true, minWidth: 130, value: queueLabel, render: (entry) => <ControlStatusBadge status={queueTone(entry)} label={queueLabel(entry)} /> },
    { key: "quality", label: "Quality", facet: true, minWidth: 155, sortValue: (entry) => entry.quality?.score || 0, value: (entry) => entry.quality?.label || "Unscored", render: (entry) => <><strong>{entry.quality?.label || "Unscored"}</strong><small>{entry.quality ? `${entry.quality.score}/100 signal score` : "Legacy candidate"}</small></> },
    { key: "date", label: "Event date", facet: true, facetAllLabel: "All date states", minWidth: 170, sortValue: (entry) => entry.candidate?.startsAt || "9999", filterValue: (entry) => entry.candidate?.startsAt ? "Dated" : "Date pending", value: (entry) => entry.candidate?.startsAt ? dateTime(entry.candidate.startsAt) : "Date pending" },
    { key: "source", label: "Source", facet: true, minWidth: 190, value: (entry) => sourceMap.get(entry.sourceId)?.name || entry.sourceId, render: (entry) => <><strong>{sourceMap.get(entry.sourceId)?.name || entry.sourceId}</strong><small>{sourceMap.get(entry.sourceId)?.adapter?.replaceAll("_", " / ") || "official source"}</small></> },
    { key: "branch", label: "Branch", facet: true, minWidth: 120, value: (entry) => entry.candidate?.branch || sourceMap.get(entry.sourceId)?.branch || "Joint" },
    { key: "discovered", label: "Discovered", minWidth: 170, value: (entry) => entry.discoveredAt || "", render: (entry) => dateTime(entry.discoveredAt) },
    { key: "actions", label: "Actions", role: "actions", required: true, sortable: false, render: (entry) => <div className="dbi-table-actions">{["pending", "update", "invalid"].includes(entry.status) ? <><button type="button" className="if-btn if-btn--secondary if-btn--sm" onClick={() => setRejecting([entry])}>Reject</button><button type="button" className="if-btn if-btn--primary if-btn--sm" onClick={() => setReviewing(entry)}>Review details</button></> : null}<a className="if-btn if-btn--secondary if-btn--sm" href={entry.candidate?.sources?.[0]?.url || entry.sourceUrl} target="_blank" rel="noreferrer" aria-label={`Open official source for ${entry.candidate?.title || "candidate"}`}><ExternalLink size={14} /></a></div> },
  ];
  const sourceRows = snapshot?.sources || [];
  const sourceColumns = [
    { key: "name", label: "Official source", required: true, sticky: true, mobilePrimary: true, minWidth: 240, value: (source) => source.name, render: (source) => <><strong>{source.name}</strong><small>{source.url}</small></> },
    { key: "health", label: "Health", facet: true, minWidth: 130, value: (source) => source.health?.consecutiveFailures ? "Failing" : source.health?.lastSuccessAt ? "Healthy" : "Not scanned", render: (source) => <ControlStatusBadge status={source.health?.consecutiveFailures ? "danger" : source.health?.lastSuccessAt ? "verified" : "neutral"} label={source.health?.consecutiveFailures ? `${source.health.consecutiveFailures} failures` : source.health?.lastSuccessAt ? "Healthy" : "Not scanned"} /> },
    { key: "adapter", label: "Adapter", facet: true, minWidth: 145, value: (source) => source.adapter.replaceAll("_", " / ") },
    { key: "branch", label: "Branch", facet: true, minWidth: 120, value: (source) => source.branch || "Joint" },
    { key: "lastSuccess", label: "Last success", minWidth: 175, value: (source) => source.health?.lastSuccessAt || "", render: (source) => dateTime(source.health?.lastSuccessAt) },
    { key: "seen", label: "Seen", minWidth: 90, sortValue: (source) => source.health?.candidatesSeen || 0, value: (source) => source.health?.candidatesSeen || 0 },
    { key: "added", label: "Added", minWidth: 90, sortValue: (source) => source.health?.candidatesAdded || 0, value: (source) => source.health?.candidatesAdded || 0 },
    { key: "cadence", label: "Cadence", minWidth: 110, sortValue: (source) => source.cadenceHours, value: (source) => `${source.cadenceHours} hours` },
    { key: "actions", label: "Actions", role: "actions", required: true, sortable: false, render: (source) => <a className="if-btn if-btn--secondary if-btn--sm" href={source.url} target="_blank" rel="noreferrer" aria-label={`Open ${source.name}`}><ExternalLink size={14} /></a> },
  ];
  const runRows = snapshot?.runs || [];
  const runColumns = [
    { key: "started", label: "Started", required: true, sticky: true, mobilePrimary: true, minWidth: 180, value: (run) => run.startedAt, render: (run) => <strong>{dateTime(run.startedAt)}</strong> },
    { key: "source", label: "Source", facet: true, minWidth: 220, value: (run) => sourceName(snapshot, run.sourceId) },
    { key: "status", label: "Status", facet: true, minWidth: 120, value: (run) => run.status, render: (run) => <ControlStatusBadge status={run.status === "failed" ? "danger" : run.status === "running" ? "review" : run.status === "unchanged" ? "neutral" : "verified"} label={run.status} /> },
    { key: "seen", label: "Candidates seen", minWidth: 130, sortValue: (run) => run.candidatesSeen, value: (run) => run.candidatesSeen },
    { key: "added", label: "New retained", minWidth: 120, sortValue: (run) => run.candidatesAdded, value: (run) => run.candidatesAdded },
    { key: "completed", label: "Completed", minWidth: 180, value: (run) => run.completedAt || "", render: (run) => dateTime(run.completedAt, run.status === "running" ? "Still running" : "Not recorded") },
    { key: "diagnostic", label: "Diagnostic", minWidth: 260, role: "prose", value: (run) => run.errorMessage || run.errorCode || "None" },
  ];

  if (!canCurate) return <section className="ops-panel"><ControlAsyncState compact state="empty" icon={<ShieldCheck size={22} />} title="Super user access required" message="Official-source discovery and catalog publication are limited to the immutable Super user." /></section>;
  const counts = snapshot?.counts || {};
  const healthySources = sourceRows.filter((source) => source.health?.lastSuccessAt && !source.health?.consecutiveFailures).length;
  const tabs = <nav className="if-tabs__list" aria-label="Event discovery management view">{[["queue", "Review queue"], ["sources", "Source health"], ["runs", "Scan history"]].map(([id, label]) => <button key={id} type="button" className={`if-tab${surface === id ? " is-active" : ""}`} aria-pressed={surface === id} onClick={() => setSurface(id)}>{label}</button>)}</nav>;
  return <div className="operations-hub operations-hub--event-discovery" data-event-discovery-page data-event-discovery-surface={surface}>
    <section className="ops-panel">
      <ControlPageHeader compact divided eyebrow="Workspace management" title="Event Discovery" summary="Monitor official-source ingestion, separate real event leads from navigation noise, and publish only verified dated editions." headingLevel={2} actions={<><a className="if-btn if-btn--secondary" href="#/budget-spend/schedule?scheduleView=list"><CalendarCheck2 size={15} />Open Schedule</a><button type="button" className="if-btn if-btn--primary" disabled={Boolean(busy)} onClick={() => void runScan()}><RefreshCw size={15} />{busy === "scan" ? "Scanning…" : "Scan due sources"}</button></>} />
      <ControlPageBody compact>
        {error ? <div className="if-alert if-alert--danger" role="alert"><CircleAlert size={17} /><div><strong>Event discovery action failed</strong><p>{error}</p></div></div> : null}
        <ControlMetricStrip compactMobile label="Event discovery status" items={[
          { id: "review", label: "Needs review", value: Number(counts.review || 0).toLocaleString(), tone: counts.review ? "warning" : "success" },
          { id: "ready", label: "Ready to publish", value: Number(counts.ready || 0).toLocaleString(), tone: "info" },
          { id: "leads", label: "Undated leads", value: Number(counts.leads || 0).toLocaleString(), tone: "neutral" },
          { id: "noise", label: "Likely noise", value: Number(counts.lowQuality || 0).toLocaleString(), tone: counts.lowQuality ? "warning" : "neutral" },
          { id: "sources", label: "Healthy sources", value: `${healthySources}/${sourceRows.length || 0}`, tone: healthySources ? "success" : "neutral" },
        ]} />
        {tabs}
        {busy === "load" && !snapshot ? <ControlAsyncState compact state="loading" title="Loading discovery management" message="Reading candidates, source health, and scan history." /> : null}
        {snapshot && surface === "queue" ? <>
          <nav className="event-discovery-views" aria-label="Discovery queue">{QUEUES.map(([id, label, countKey]) => <button key={id} type="button" className={`if-btn if-btn--sm${queue === id ? " if-btn--primary" : " if-btn--secondary"}`} aria-pressed={queue === id} onClick={() => { setBusy("load"); setQueue(id); }}>{label}<span className="event-discovery-views__count">{Number(counts[countKey] || 0)}</span></button>)}</nav>
          <OperationalDataTable key={`${queue}:${candidateRows.map((entry) => entry.id).join("|")}`} id="event-discovery-candidates" label="Event discovery candidates" rows={candidateRows} columns={candidateColumns} rowKey={(entry) => entry.id} defaultSort={{ key: "discovered", direction: "desc" }} defaultPageSize={25} searchPlaceholder="Search candidate titles, summaries, sources, branches, and dates…" exportFilename={`event-discovery-${queue}.csv`} empty="No candidates in this queue." mobileColumns={["title", "queue", "date", "actions"]} bulkActions={(selected) => selected.some((entry) => ["pending", "update", "invalid"].includes(entry.status)) ? <button type="button" className="if-btn if-btn--danger" onClick={() => setRejecting(selected.filter((entry) => ["pending", "update", "invalid"].includes(entry.status)))}><Trash2 size={14} />Reject selected</button> : null} renderDetail={(entry) => <div className="dbi-table-detail-grid"><article><span>Official source</span><strong><a href={entry.candidate?.sources?.[0]?.url || entry.sourceUrl} target="_blank" rel="noreferrer">{sourceName(snapshot, entry.sourceId)}</a></strong></article><article><span>Location</span><strong>{entry.candidate?.location || "Not published"}</strong></article><article><span>Signal quality</span><strong>{entry.quality?.issues?.join(" · ") || "No automated quality warnings"}</strong></article><article><span>Duplicate match</span><strong>{entry.candidate?.duplicateMatch?.reasons?.join(" · ") || "No catalog match"}</strong></article><article><span>Evidence retained</span><strong>{entry.evidence?.length || 0} source record{entry.evidence?.length === 1 ? "" : "s"}</strong></article><article><span>Reviewed</span><strong>{entry.reviewedAt ? `${dateTime(entry.reviewedAt)} · ${entry.reviewedBy}` : "Not reviewed"}</strong></article></div>} />
        </> : null}
        {snapshot && surface === "sources" ? <OperationalDataTable id="event-discovery-sources" label="Official event discovery sources" rows={sourceRows} columns={sourceColumns} rowKey={(source) => source.id} defaultSort={{ key: "health", direction: "asc" }} searchPlaceholder="Search official sources, branches, and adapters…" exportFilename="event-discovery-sources.csv" selectable={false} mobileColumns={["name", "health", "lastSuccess", "actions"]} /> : null}
        {snapshot && surface === "runs" ? <OperationalDataTable id="event-discovery-runs" label="Event discovery scan history" rows={runRows} columns={runColumns} rowKey={(run) => run.id} defaultSort={{ key: "started", direction: "desc" }} searchPlaceholder="Search scan history by source, status, or diagnostic…" exportFilename="event-discovery-runs.csv" selectable={false} mobileColumns={["started", "source", "status", "added"]} /> : null}
        {snapshot?.latestRun ? <p className="if-field__hint"><SearchCheck size={13} aria-hidden="true" /> Latest scan: {sourceName(snapshot, snapshot.latestRun.sourceId)} · {snapshot.latestRun.status} · {snapshot.latestRun.candidatesSeen} seen · {snapshot.latestRun.candidatesAdded} new · {dateTime(snapshot.latestRun.completedAt || snapshot.latestRun.startedAt)}</p> : null}
      </ControlPageBody>
    </section>
    {reviewing ? <CandidateReviewDialog entry={reviewing} busy={busy.startsWith("publish:")} onClose={() => setReviewing(null)} onPublish={(entry, draft) => void publish(entry, draft)} onReject={(entry) => { setReviewing(null); setRejecting([entry]); }} /> : null}
    {rejecting.length ? <RejectDialog entries={rejecting} busy={busy === "reject"} onClose={() => setRejecting([])} onConfirm={(entries, reason) => void reject(entries, reason)} /> : null}
  </div>;
}
