import { useMemo, useState } from "react";
import { AlertTriangle, CalendarClock, CheckCircle2, ChevronRight, CircleMinus, Clock3, FilePlus2, RefreshCw } from "lucide-react";
import ControlSelect from "./ControlSelect.jsx";
import { useNotifications } from "./NotificationContext.jsx";
import { RECENT_NAVIGATION_KEY, readNavigationList } from "./navigation-history.js";

const TYPES = {
  added: { label: "New", icon: FilePlus2 },
  updated: { label: "Changed", icon: RefreshCw },
  closing: { label: "Closing soon", icon: CalendarClock },
  removed: { label: "Removed", icon: CircleMinus },
};
const DESTINATIONS = {
  schedule: ["Schedule", "#/budget-spend/schedule"], spend: ["Spend Explorer", "#/budget-spend/explorer"], awards: ["Awards", "#/budget-spend/awards"], watchlist: ["Watchlist", "#/budget-spend/watchlist"], tasks: ["Task Center", "#/budget-spend/tasks"], connections: ["Connections", "#/budget-spend/connections"], overview: ["PDB Request", "#/budget-spend/overview"], trends: ["Request History", "#/budget-spend/trends"], lifecycle: ["Account Flow", "#/budget-spend/lifecycle"], sources: ["Source Lineage", "#/budget-spend/sources"], users: ["Accounts", "#/budget-spend/users"], workspaces: ["Workspaces", "#/budget-spend/workspaces"], "workspace-settings": ["Workspace Settings", "#/budget-spend/workspace-settings"], profile: ["Profile", "#/budget-spend/profile"], security: ["Security", "#/budget-spend/security"],
};

function readableDate(value, fallback = "Not published") {
  if (!value) return fallback;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? fallback : parsed.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}
function resolveChange(change, recordsById) {
  const record = recordsById.get(String(change.opportunityId || "").toUpperCase()) || recordsById.get(String(change.sourceRecordId || "").toUpperCase());
  return { id: `${change.change}:${change.opportunityId || change.sourceRecordId}`, kind: change.change, title: change.title || record?.title || change.sourceRecordId || "Untitled public record", reference: record?.id || record?.reference || change.sourceRecordId || "Identifier not published", sourceSystem: change.sourceSystem || record?.sourceSystem || "Published source", opportunityId: record?.opportunityId || change.opportunityId || null, date: record?.lastChangedAt || record?.firstSeenAt || null, fields: change.fields || record?.changedFields || [] };
}
function recordHref(row) { return row.opportunityId ? `#/budget-spend/explorer?spendView=timeline&capRecord=${encodeURIComponent(row.opportunityId)}` : "#/budget-spend/explorer?spendView=table&changes=today"; }

export default function SpendToday({ rows, discoveryFeed, savedViews, savedViewSummary, runtimePanel }) {
  const notifications = useNotifications();
  const [kind, setKind] = useState("all");
  const latest = discoveryFeed.history?.[0] || null;
  const recordsById = useMemo(() => { const map = new Map(); rows.forEach((record) => [record.opportunityId, record.sourceRecordId, record.id, record.reference].filter(Boolean).forEach((key) => map.set(String(key).toUpperCase(), record))); return map; }, [rows]);
  const inboxRows = useMemo(() => {
    const changed = (latest?.changes || []).map((change) => resolveChange(change, recordsById));
    const changedIds = new Set(changed.map((entry) => entry.opportunityId).filter(Boolean));
    const closing = (discoveryFeed.closingSoon || []).filter((record) => !changedIds.has(record.opportunityId)).map((record) => ({ id: `closing:${record.opportunityId || record.sourceRecordId}`, kind: "closing", title: record.title, reference: record.sourceRecordId || "Identifier not published", sourceSystem: record.sourceSystem || "Published source", opportunityId: record.opportunityId, date: record.date, fields: [] }));
    return [...changed, ...closing].filter((entry) => TYPES[entry.kind]);
  }, [discoveryFeed.closingSoon, latest, recordsById]);
  const changedRows = inboxRows.filter((entry) => entry.kind !== "closing");
  const visibleChanges = (kind === "all" ? changedRows : changedRows.filter((entry) => entry.kind === kind)).slice(0, 4);
  const dueSoon = inboxRows.filter((entry) => entry.kind === "closing").slice(0, 3);
  const coverage = discoveryFeed.metadata?.coverage || {};
  const sourceIssues = Object.entries(coverage.sources || {}).filter(([, source]) => !["current", "gaps-disclosed"].includes(source?.status));
  const taskAttention = notifications?.notifications?.filter((item) => item.requiresAction || item.active).slice(0, 4) || [];
  const attentionCount = sourceIssues.length + taskAttention.filter((item) => item.requiresAction).length + Number(savedViewSummary?.unreadCount || 0);
  const recent = readNavigationList(RECENT_NAVIGATION_KEY).filter((id) => id !== "spend" && DESTINATIONS[id]).slice(0, 4);
  return <div className="spend-today decision-brief" data-spend-today data-decision-brief>
    <section className="decision-brief__priority" aria-labelledby="decision-attention-title">
      <header><span><small>Decide</small><h2 id="decision-attention-title">Needs attention</h2></span><span className={`if-badge ${attentionCount ? "if-badge--warning" : "if-badge--success"}`}>{attentionCount || "Clear"}</span></header>
      {sourceIssues.map(([source, value]) => <a key={source} href="#acquisition-source-details" className="decision-brief__action"><AlertTriangle size={17} /><span><strong>{source} source issue</strong><small>{value.status}. Missing data is not treated as an empty update.</small></span><ChevronRight size={16} /></a>)}
      {taskAttention.map((item) => <a key={item.id} href={item.href} className="decision-brief__action"><span className={`decision-brief__signal decision-brief__signal--${item.tone}`} aria-hidden="true" /> <span><strong>{item.title}</strong><small>{item.message}</small></span><ChevronRight size={16} /></a>)}
      {Number(savedViewSummary?.unreadCount || 0) ? <a href="#saved-acquisition-views" className="decision-brief__action"><RefreshCw size={17} /><span><strong>{savedViewSummary.unreadCount} saved-view change{savedViewSummary.unreadCount === 1 ? "" : "s"}</strong><small>Open the view that matters and continue from its exact scope.</small></span><ChevronRight size={16} /></a> : null}
      {!sourceIssues.length && !taskAttention.length && !savedViewSummary?.unreadCount ? <div className="decision-brief__clear"><CheckCircle2 size={20} /><span><strong>No decision is waiting</strong><small>New source changes and active work remain visible below.</small></span></div> : null}
    </section>

    <section className="decision-brief__panel decision-brief__changes" aria-labelledby="decision-changes-title">
      <header><span><small>Understand</small><h2 id="decision-changes-title">What changed</h2></span><ControlSelect ariaLabel="Change type" value={kind} options={[{ value: "all", label: `All (${changedRows.length})` }, ...["added", "updated", "removed"].map((value) => ({ value, label: `${TYPES[value].label} (${changedRows.filter((row) => row.kind === value).length})` }))]} onChange={setKind} /></header>
      {visibleChanges.length ? <div className="decision-brief__record-list">{visibleChanges.map((row) => { const Icon = TYPES[row.kind].icon; return <a key={row.id} href={recordHref(row)}><span className={`decision-brief__record-icon decision-brief__record-icon--${row.kind}`}><Icon size={15} /></span><span><strong>{row.title}</strong><small>{row.fields.length ? row.fields.slice(0, 3).map((field) => field.label).join(" · ") : row.kind === "added" ? "First observed by DBI" : row.kind === "removed" ? "Removed from the current source scope" : "Source record changed"}</small></span><time dateTime={row.date || undefined}>{readableDate(row.date)}</time><ChevronRight size={16} /></a>; })}</div> : <div className="decision-brief__clear"><CheckCircle2 size={20} /><span><strong>No retained changes match this view</strong><small>Source health and refresh controls remain available below.</small></span></div>}
      {(latest?.truncated || changedRows.length > visibleChanges.length) ? <a className="decision-brief__footer-link" href="#/budget-spend/explorer?spendView=table&changes=today">Open the complete daily update ledger <ChevronRight size={15} /></a> : null}
    </section>

    <div className="decision-brief__supporting">
      <section className="decision-brief__panel" aria-labelledby="decision-due-title"><header><span><small>Act</small><h2 id="decision-due-title">Due soon</h2></span><span className="if-badge">{dueSoon.length}</span></header>{dueSoon.length ? <div className="decision-brief__compact-list">{dueSoon.map((row) => <a key={row.id} href={recordHref(row)}><CalendarClock size={16} /><span><strong>{row.title}</strong><small>{row.reference} · {readableDate(row.date)}</small></span><ChevronRight size={15} /></a>)}</div> : <div className="decision-brief__clear"><CheckCircle2 size={19} /><span><strong>No near-term deadline in this feed</strong><small>Saved views can alert on narrower scopes.</small></span></div>}</section>
      <section className="decision-brief__panel" aria-labelledby="decision-continue-title"><header><span><small>Resume</small><h2 id="decision-continue-title">Continue where you left off</h2></span><Clock3 size={17} /></header>{recent.length ? <div className="decision-brief__compact-list">{recent.map((id) => <a key={id} href={DESTINATIONS[id][1]}><Clock3 size={16} /><span><strong>{DESTINATIONS[id][0]}</strong><small>Return to your recent workspace</small></span><ChevronRight size={15} /></a>)}</div> : <div className="decision-brief__clear"><Clock3 size={19} /><span><strong>Your recent work will appear here</strong><small>Open another surface and the Brief will remember it.</small></span></div>}</section>
    </div>

    <div id="saved-acquisition-views">{savedViews}</div>
    <details className="decision-brief__details" id="acquisition-source-details" data-acquisition-coverage>
      <summary><span><strong>Sources, coverage, and automation</strong><small>{sourceIssues.length ? `${sourceIssues.length} source issue${sourceIssues.length === 1 ? "" : "s"} disclosed` : "Sources are current within the published boundary"}</small></span><ChevronRight size={16} /></summary>
      <div className="decision-brief__details-body">
        {runtimePanel}
        <div className="spend-today__coverage-grid">
          <span><b>{Number(coverage.unknownHierarchy || 0).toLocaleString()}</b>Unknown hierarchy</span><span><b>{Number(coverage.unclassifiedTechnology || 0).toLocaleString()}</b>Unclassified technology</span><span><b>{Number(coverage.missingExactIdentifier || 0).toLocaleString()}</b>Missing exact identifier</span><span><b>{Number(coverage.contractMonitor?.gapCount || 0).toLocaleString()}</b>Monitor gaps</span><span><b>{Number(coverage.contractMonitor?.coveragePct || 0).toLocaleString()}%</b>Checked-record coverage</span><span><b>{Number(coverage.contractMonitor?.corpusCoveragePct || 0).toLocaleString()}%</b>Eligible-corpus coverage</span>
        </div>
        <p className="decision-brief__guidance"><strong>How to read this brief:</strong> “New” means first observed by DBI, not necessarily newly published by the government. Coverage always reflects the disclosed source and query boundary. Missing sources remain unavailable, never zero.</p>
      </div>
    </details>
  </div>;
}
