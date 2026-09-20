import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { ArchiveRestore, ArchiveX, BarChart3, CalendarClock, FileSpreadsheet, Inbox } from "lucide-react";
import { ControlAsyncState, ControlErrorBoundary, ControlPageBody } from "control-surface-ui/react";
import OperationalDataTable from "./OperationalDataTable.jsx";
import ControlWorkbenchHeader from "./WorkbenchHeader.jsx";
import ControlSelect from "./ControlSelect.jsx";
import { applyProcurementChanges, assembleProcurementRecords, TECHNOLOGY_AREA_BY_ID } from "./procurement-taxonomy.js";
import { useRecordDispositions } from "./record-dispositions.js";
import { emptyProcurementDiscovery, emptyProcurementFeed, loadProcurementDiscovery, loadProcurementFeed } from "./procurement-discovery.js";
import SpendSavedViews from "./SpendSavedViews.jsx";
import SpendToday from "./SpendToday.jsx";
import AcquisitionRuntimePanel from "./AcquisitionRuntimePanel.jsx";
import { reportClientError } from "./client-error-reporting.js";
import { lazyWithRefresh } from "./lazy-with-refresh.js";
import { useAuth } from "./AuthContext.jsx";

const CaptureCalendar = lazyWithRefresh(() => import("./CaptureCalendar.jsx"), "capture-calendar");
const TransactionAnalytics = lazyWithRefresh(() => import("./TransactionAnalytics.jsx"), "transaction-analytics");

const VIEWS = new Set(["today", "timeline", "table", "charts"]);

function readRoute() {
  const params = new URLSearchParams(window.location.hash.split("?")[1] || "");
  const value = params.get("spendView");
  return VIEWS.has(value) ? value : "today";
}

function updateRoute(view, patch = {}) {
  const [path, search = ""] = window.location.hash.split("?");
  const params = new URLSearchParams(search);
  params.set("spendView", view);
  Object.entries(patch).forEach(([key, value]) => {
    if (value) params.set(key, value);
    else params.delete(key);
  });
  window.location.hash = `${path}?${params}`;
}

function money(value) {
  const amount = Number(value || 0);
  if (!amount) return "$0";
  if (Math.abs(amount) >= 1e9) return `$${(amount / 1e9).toFixed(1)}B`;
  if (Math.abs(amount) >= 1e6) return `$${(amount / 1e6).toFixed(1)}M`;
  return `$${amount.toLocaleString()}`;
}

function date(value) {
  if (!value) return "Not published";
  const parsed = new Date(`${String(value).slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) ? "Not published" : parsed.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

function RouteLoading({ label }) {
  return <ControlAsyncState compact state="loading" title={`Loading ${label}`} message="Preparing the selected spend view." />;
}

function SpendViewBoundary({ view, children }) {
  return <ControlErrorBoundary resetKey={view} title={`${view === "charts" ? "Charts" : "Timeline"} could not render`} message="Retry this view. The failure was recorded in Connections → API Log." onError={(error, info) => reportClientError(error, { kind: "route_render_error", componentStack: info?.componentStack })}>{children}</ControlErrorBoundary>;
}

export default function SpendExplorer({ dataset, awards, samOpportunities, manualProcurement, procurementDelta, subawardSnapshot, accountSpine, requestLineCount }) {
  const auth = useAuth();
  const runtimeAvailable = Boolean(auth?.authVersion === "dbi-pages-auth-v1" && auth?.enabled && auth?.user && !auth?.staticHost);
  const [view, setView] = useState(readRoute);
  const [query, setQuery] = useState(() => new URLSearchParams(window.location.hash.split("?")[1] || "").get("capQuery") || "");
  const [tableFilters, setTableFilters] = useState(() => {
    const params = new URLSearchParams(window.location.hash.split("?")[1] || "");
    return { technology: params.get("technology") || "all", branch: params.get("orgBranch") || "all", component: params.get("orgComponent") || "all", office: params.get("orgOffice") || "all", disposition: params.get("records") === "tombstoned" ? "tombstoned" : "active", changes: params.get("changes") === "today" ? "today" : "all" };
  });
  const dispositions = useRecordDispositions();
  const [discoveryIndex, setDiscoveryIndex] = useState(() => procurementDelta?.discovery?.length ? procurementDelta : emptyProcurementDiscovery());
  const [dailyFeed, setDailyFeed] = useState(emptyProcurementFeed);
  const [hasSavedViews, setHasSavedViews] = useState(false);
  const [savedViewSummary, setSavedViewSummary] = useState({ count: 0, unreadCount: 0, favorites: 0 });
  const [runtimeSamRecords, setRuntimeSamRecords] = useState([]);
  const loadRuntimeRecords = useCallback(async () => {
    if (!runtimeAvailable) { setRuntimeSamRecords([]); return; }
    const records = [];
    let offset = 0;
    let hasMore = true;
    while (hasMore) {
      const payload = await auth.listAcquisitionRecords({ limit: 1000, offset });
      const page = payload.records || [];
      records.push(...page);
      hasMore = Boolean(payload.pagination?.hasMore) && page.length > 0;
      offset += page.length;
    }
    setRuntimeSamRecords(records);
  }, [auth, runtimeAvailable]);
  useEffect(() => {
    const sync = () => {
      setView(readRoute());
      setQuery(new URLSearchParams(window.location.hash.split("?")[1] || "").get("capQuery") || "");
      const params = new URLSearchParams(window.location.hash.split("?")[1] || "");
      setTableFilters({ technology: params.get("technology") || "all", branch: params.get("orgBranch") || "all", component: params.get("orgComponent") || "all", office: params.get("orgOffice") || "all", disposition: params.get("records") === "tombstoned" ? "tombstoned" : "active", changes: params.get("changes") === "today" ? "today" : "all" });
    };
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);
  useEffect(() => {
    if (!(view === "table" || (view === "today" && hasSavedViews)) || discoveryIndex.discovery.length) return undefined;
    let active = true;
    loadProcurementDiscovery()
      .then((payload) => { if (active) setDiscoveryIndex(payload); })
      .catch(() => { /* Date-added fields remain explicitly unavailable when the deferred feed cannot load. */ });
    return () => { active = false; };
  }, [discoveryIndex.discovery.length, hasSavedViews, view]);
  useEffect(() => {
    if (!["today", "table"].includes(view) || dailyFeed.history.length) return undefined;
    let active = true;
    loadProcurementFeed()
      .then((payload) => { if (active) setDailyFeed(payload); })
      .catch(() => { /* Daily source status remains explicitly unavailable when the compact feed cannot load. */ });
    return () => { active = false; };
  }, [dailyFeed.history.length, view]);
  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(() => {
      void loadRuntimeRecords().catch((error) => { if (active) reportClientError(error, { kind: "acquisition_runtime_records" }); });
    }, 0);
    return () => { active = false; window.clearTimeout(timer); };
  }, [loadRuntimeRecords]);
  const effectiveSamOpportunities = useMemo(() => {
    if (!runtimeSamRecords.length) return samOpportunities;
    const merged = new Map();
    for (const record of samOpportunities?.records || []) merged.set(record.sourceRecordId || record.noticeId, record);
    for (const record of runtimeSamRecords) merged.set(record.sourceRecordId || record.noticeId, record);
    return {
      ...(samOpportunities || {}),
      metadata: { ...(samOpportunities?.metadata || {}), status: "workspace-runtime", runtimeRecordCount: runtimeSamRecords.length },
      records: [...merged.values()],
    };
  }, [runtimeSamRecords, samOpportunities]);
  const select = (next) => { setView(next); updateRoute(next); };
  const tabs = <nav className="if-tabs__list spend-explorer__tabs" aria-label="Spend Explorer view">
    <button type="button" className={`if-tab${view === "today" ? " is-active" : ""}`} aria-pressed={view === "today"} onClick={() => select("today")}><Inbox size={15} />Brief</button>
    <button type="button" className={`if-tab${view === "timeline" ? " is-active" : ""}`} aria-pressed={view === "timeline"} onClick={() => select("timeline")}><CalendarClock size={15} />Timeline</button>
    <button type="button" className={`if-tab${view === "table" ? " is-active" : ""}`} aria-pressed={view === "table"} onClick={() => select("table")}><FileSpreadsheet size={15} />Table</button>
    <button type="button" className={`if-tab${view === "charts" ? " is-active" : ""}`} aria-pressed={view === "charts"} onClick={() => select("charts")}><BarChart3 size={15} />Charts</button>
  </nav>;
  const rows = useMemo(
    () => applyProcurementChanges(assembleProcurementRecords(dataset.records || [], awards || [], dataset.metadata?.asOf, effectiveSamOpportunities?.records || [], manualProcurement?.records || [], subawardSnapshot), procurementDelta?.records || [], discoveryIndex.discovery || []),
    [awards, dataset.metadata?.asOf, dataset.records, discoveryIndex.discovery, effectiveSamOpportunities?.records, manualProcurement?.records, procurementDelta?.records, subawardSnapshot],
  );
  const technologyOptions = useMemo(() => [...new Set(rows.flatMap((record) => record.technologyAreas || []))].sort((left, right) => (TECHNOLOGY_AREA_BY_ID.get(left)?.label || left).localeCompare(TECHNOLOGY_AREA_BY_ID.get(right)?.label || right)), [rows]);
  const latestFeed = dailyFeed.history?.[0];
  const latestFeedDate = latestFeed?.date || null;
  const branchOptions = useMemo(() => [...new Set(rows.map((record) => record.organization?.branch).filter(Boolean))].sort(), [rows]);
  const componentOptions = useMemo(() => [...new Set(rows.filter((record) => tableFilters.branch === "all" || record.organization?.branch === tableFilters.branch).map((record) => record.organization?.component).filter(Boolean))].sort(), [rows, tableFilters.branch]);
  const officeOptions = useMemo(() => [...new Set(rows.filter((record) => (tableFilters.branch === "all" || record.organization?.branch === tableFilters.branch) && (tableFilters.component === "all" || record.organization?.component === tableFilters.component)).map((record) => record.organization?.office).filter((value) => value && value !== "Office not published"))].sort(), [rows, tableFilters.branch, tableFilters.component]);
  const tableRows = useMemo(() => rows.filter((record) => {
    const tombstoned = dispositions.tombstonedIds.has(record.opportunityId);
    return (tableFilters.disposition === "tombstoned" ? tombstoned : !tombstoned)
      && (tableFilters.technology === "all" || (record.technologyAreas || []).includes(tableFilters.technology))
      && (tableFilters.branch === "all" || record.organization?.branch === tableFilters.branch)
      && (tableFilters.component === "all" || record.organization?.component === tableFilters.component)
      && (tableFilters.office === "all" || record.organization?.office === tableFilters.office)
      && (tableFilters.changes !== "today" || !latestFeedDate || String(record.lastChangedAt || record.firstSeenAt || "").slice(0, 10) === latestFeedDate);
  }), [dispositions.tombstonedIds, latestFeedDate, rows, tableFilters]);
  const setTableFilter = (key, value) => {
    const next = { ...tableFilters, [key]: value };
    if (key === "branch") { next.component = "all"; next.office = "all"; }
    if (key === "component") next.office = "all";
    setTableFilters(next);
    updateRoute(view === "today" ? "today" : "table", { technology: next.technology === "all" ? "" : next.technology, orgBranch: next.branch === "all" ? "" : next.branch, orgComponent: next.component === "all" ? "" : next.component, orgOffice: next.office === "all" ? "" : next.office, records: next.disposition === "tombstoned" ? "tombstoned" : "", changes: next.changes === "today" ? "today" : "" });
  };
  const tableColumns = [
    { key: "record", label: "Record", required: true, sticky: true, minWidth: 300, value: (record) => `${record.id || record.reference || "Unidentified"} ${record.title || "Untitled"}`, render: (record) => <><strong>{record.id || record.reference || "Unidentified"}</strong><small>{record.title || "Untitled public record"}</small></> },
    { key: "recipient", label: "Recipient / sponsor", facet: true, minWidth: 190, value: (record) => record.party || record.recipient || "Not published" },
    { key: "portfolio", label: "Portfolio", facet: true, minWidth: 150, value: (record) => record.portfolio || "Unclassified" },
    { key: "technology", label: "Technology area", minWidth: 190, value: (record) => (record.technologyAreas || []).map((area) => TECHNOLOGY_AREA_BY_ID.get(area)?.label || area).join(" · ") || "Not classified" },
    { key: "organization", label: "DoW hierarchy", minWidth: 220, value: (record) => record.organization?.path?.slice(1, 4).join(" → ") || "Not published", render: (record) => <><strong>{record.organization?.component || "Component not published"}</strong><small>{[record.organization?.branch, record.organization?.office].filter(Boolean).join(" · ")}</small></> },
    { key: "dateAdded", label: "Date added", minWidth: 140, value: (record) => record.firstSeenAt || "", sortValue: (record) => record.firstSeenAt || "", render: (record) => <><strong>{date(record.firstSeenAt)}</strong>{record.sourcePublishedAt ? <small>Source posted {date(record.sourcePublishedAt)}</small> : null}</> },
    { key: "change", label: "Latest change", minWidth: 210, value: (record) => [record.lastChangeType, ...(record.changedFields || []).map((field) => field.label)].filter(Boolean).join(" "), render: (record) => <><strong>{record.lastChangeType === "added" ? "Added" : record.lastChangeType === "removed" ? "Removed" : record.lastChangeType === "updated" ? "Updated" : "No retained change"}</strong>{record.changedFields?.length ? <small>{record.changedFields.slice(0, 3).map((field) => field.label).join(" · ")}{record.changedFields.length > 3 ? ` +${record.changedFields.length - 3}` : ""}</small> : null}</> },
    { key: "obligations", label: "Observed", sortValue: (record) => Number(record.obligatedAmount || record.fpdsObligatedAmount || 0), exportValue: (record) => Number(record.obligatedAmount || record.fpdsObligatedAmount || 0), render: (record) => <strong>{money(record.obligatedAmount || record.fpdsObligatedAmount)}</strong> },
    { key: "end", label: "Reported end", minWidth: 140, value: (record) => record.currentEnd || record.potentialEnd || "", render: (record) => date(record.currentEnd || record.potentialEnd) },
    { key: "evidence", label: "Evidence", facet: true, minWidth: 120, value: (record) => record.evidenceTier || "unclassified" },
    { key: "actions", label: "Actions", role: "actions", required: true, sortable: false, render: (record) => <div className="dbi-table-actions"><a href={`#/budget-spend/explorer?spendView=timeline&capRecord=${encodeURIComponent(record.opportunityId || record.id || record.reference || "")}`}>Open</a>{dispositions.canWrite ? dispositions.tombstonedIds.has(record.opportunityId) ? <button type="button" onClick={() => dispositions.restore(record.opportunityId)} aria-label={`Restore ${record.title}`} title="Restore to active explorer"><ArchiveRestore size={15} /></button> : <button type="button" onClick={() => dispositions.tombstone(record.opportunityId)} aria-label={`Tombstone ${record.title}`} title="Tombstone this record"><ArchiveX size={15} /></button> : null}</div> },
  ];
  const sevenDaysAgo = new Date(Date.parse(discoveryIndex.metadata?.generatedAt || dailyFeed.metadata?.generatedAt || procurementDelta?.metadata?.generatedAt || dataset.metadata?.generatedAt || "1970-01-01T00:00:00.000Z") - 7 * 86_400_000).toISOString();
  const tableMetrics = [
    { id: "records", label: tableFilters.disposition === "tombstoned" ? "Tombstoned" : "Active records", value: tableRows.length.toLocaleString(), meta: tableFilters.disposition === "tombstoned" ? "Recoverable workspace exclusions" : `${rows.length.toLocaleString()} total published records` },
    { id: "added", label: "Added in 7 days", value: rows.filter((record) => record.firstSeenAt >= sevenDaysAgo).length.toLocaleString(), meta: "First seen by DBI" },
    { id: "awards", label: "Awards", value: Number(awards?.length || 0).toLocaleString(), meta: "Retained award evidence" },
    { id: "snapshot", label: "Snapshot", value: dataset.metadata?.asOf || "Current", meta: "Published-data boundary" },
  ];
  const todayMetrics = [
    { id: "known", label: "Known records", value: Number(dailyFeed.metadata?.coverage?.knownRecords || dailyFeed.metadata?.discoveryCount || rows.length).toLocaleString(), meta: "Disclosed discovery scope" },
    { id: "new", label: "New today", value: Number(latestFeed?.summary?.added || 0).toLocaleString(), meta: "First observed by DBI" },
    { id: "changed", label: "Changed today", value: Number(latestFeed?.summary?.updated || 0).toLocaleString(), meta: "Field-level source changes" },
    { id: "coverage", label: "Monitor coverage", value: `${Number(dailyFeed.metadata?.coverage?.contractMonitor?.coveragePct || 0).toLocaleString()}%`, meta: `${Number(dailyFeed.metadata?.coverage?.contractMonitor?.gapCount || 0).toLocaleString()} disclosed gaps` },
  ];
  const savedViewRows = rows.length ? rows : (discoveryIndex.discovery || []);
  const savedViews = <SpendSavedViews rows={savedViewRows} tombstonedIds={dispositions.tombstonedIds} query={query} filters={tableFilters} onHasViews={setHasSavedViews} onSummary={setSavedViewSummary} onLoad={(saved) => {
    const next = { ...tableFilters, ...(saved.filters || {}), disposition: saved.filters?.disposition === "tombstoned" ? "tombstoned" : "active", changes: "all" };
    setTableFilters(next);
    setQuery(saved.query || "");
    updateRoute("table", { capQuery: saved.query || "", technology: next.technology === "all" ? "" : next.technology, orgBranch: next.branch === "all" ? "" : next.branch, orgComponent: next.component === "all" ? "" : next.component, orgOffice: next.office === "all" ? "" : next.office, records: next.disposition === "tombstoned" ? "tombstoned" : "", changes: "" });
  }} />;

  if (view === "today") return <section className="spend-explorer spend-explorer--today" data-spend-explorer="today">
    <ControlWorkbenchHeader eyebrow="Decision support" title="Decision Brief" summary="What changed, what needs attention, and where to continue." metrics={todayMetrics} metricLabel="Decision brief summary" tabs={tabs} />
    <ControlPageBody compact><SpendToday rows={rows.filter((record) => !dispositions.tombstonedIds.has(record.opportunityId))} discoveryFeed={dailyFeed} savedViews={savedViews} savedViewSummary={savedViewSummary} runtimePanel={<AcquisitionRuntimePanel onRefreshComplete={loadRuntimeRecords} />} /></ControlPageBody>
  </section>;
  if (view === "timeline") return <SpendViewBoundary view={view}><Suspense fallback={<RouteLoading label="timeline" />}><CaptureCalendar embedded embeddedTabs={tabs} dataset={dataset} awards={awards} samOpportunities={effectiveSamOpportunities} manualProcurement={manualProcurement} procurementDelta={procurementDelta} subawardSnapshot={subawardSnapshot} /></Suspense></SpendViewBoundary>;
  if (view === "charts") return <SpendViewBoundary view={view}><Suspense fallback={<RouteLoading label="charts" />}><TransactionAnalytics embedded embeddedTabs={tabs} dataset={dataset} awards={awards} samOpportunities={effectiveSamOpportunities} manualProcurement={manualProcurement} procurementDelta={procurementDelta} subawardSnapshot={subawardSnapshot} accountSpine={accountSpine} requestLineCount={requestLineCount} /></Suspense></SpendViewBoundary>;
  return <section className="spend-explorer spend-explorer--table" data-spend-explorer="table">
    <ControlWorkbenchHeader eyebrow="Spend intelligence" title="Spend Explorer" summary="Timeline, records, and charts share one public-data scope." metrics={tableMetrics} metricLabel="Spend table summary" tabs={tabs} />
    <ControlPageBody compact>
      {savedViews}
      {tableFilters.changes === "today" ? <div className="if-alert if-alert--info spend-explorer__change-scope" role="status"><span><strong>Complete daily update ledger</strong>Showing every retained record changed on {date(latestFeedDate)}.</span><button type="button" className="if-button if-button--secondary" onClick={() => setTableFilter("changes", "all")}>Show all records</button></div> : null}
      <details className="spend-explorer__daily-feed" data-daily-acquisition-feed>
        <summary><span><strong>Daily acquisition updates</strong><small>{dailyFeed.history?.[0] ? `${dailyFeed.history[0].summary.added} added · ${dailyFeed.history[0].summary.updated} updated · ${dailyFeed.history[0].summary.removed} removed` : "History begins with the next retained refresh"}</small></span><span>{dailyFeed.history?.[0]?.sources?.sam === "current" ? "SAM.gov current" : "SAM.gov unavailable"}</span></summary>
        <div>{(dailyFeed.history || []).slice(0, 14).map((entry) => <article key={entry.date}><time dateTime={entry.date}>{date(entry.date)}</time><span><b>{entry.summary.added}</b> added</span><span><b>{entry.summary.updated}</b> updated</span><span><b>{entry.summary.removed}</b> removed</span><small>SAM.gov {entry.sources?.sam || "unknown"} · USAspending {entry.sources?.usaspending || "unknown"}</small></article>)}</div>
      </details>
      <section className="spend-explorer__hierarchy" aria-label="Explorer hierarchy and record controls" data-explorer-hierarchy>
        <div><span>Explore hierarchy</span><strong>{["Department of War", tableFilters.branch !== "all" ? tableFilters.branch : "All branches", tableFilters.component !== "all" ? tableFilters.component : "All services & components", tableFilters.office !== "all" ? tableFilters.office : null].filter(Boolean).join(" → ")}</strong></div>
        <ControlSelect label="Technology area" value={tableFilters.technology} options={[{ value: "all", label: "All technology areas" }, ...technologyOptions.map((area) => ({ value: area, label: TECHNOLOGY_AREA_BY_ID.get(area)?.label || area }))]} onChange={(value) => setTableFilter("technology", value)} />
        <ControlSelect label="DoW branch" value={tableFilters.branch} options={[{ value: "all", label: "DoW: all branches" }, ...branchOptions.map((value) => ({ value, label: value }))]} onChange={(value) => setTableFilter("branch", value)} />
        <ControlSelect label="Service / component" value={tableFilters.component} options={[{ value: "all", label: "All services & components" }, ...componentOptions.map((value) => ({ value, label: value }))]} onChange={(value) => setTableFilter("component", value)} />
        <ControlSelect label="Buying office" value={tableFilters.office} options={[{ value: "all", label: "All published offices" }, ...officeOptions.map((value) => ({ value, label: value }))]} onChange={(value) => setTableFilter("office", value)} />
        <ControlSelect label="Record state" value={tableFilters.disposition} options={[{ value: "active", label: "Active explorer" }, { value: "tombstoned", label: `Tombstoned (${dispositions.rows.length})` }]} onChange={(value) => setTableFilter("disposition", value)} />
      </section>
      {dispositions.error ? <p className="if-alert if-alert--warning" role="status">{dispositions.error}</p> : null}
      <OperationalDataTable id="spend-records" label="Spend and transaction records" rows={tableRows} columns={tableColumns} rowKey={(record) => record.opportunityId || record.id || record.reference} defaultSort={{ key: "dateAdded", direction: "desc" }} queryValue={query} onQueryChange={(value) => { setQuery(value); updateRoute("table", { capQuery: value }); }} searchPlaceholder="Search records, recipients, technology areas, organizations, and references…" exportFilename="spend-explorer.csv" mobileColumns={tableFilters.changes === "today" ? ["record", "change", "dateAdded", "actions"] : ["record", "technology", "dateAdded", "actions"]} empty={tableFilters.disposition === "tombstoned" ? "No tombstoned records. Records you intentionally suppress will remain recoverable here." : "No active records match the current hierarchy and table controls."} />
    </ControlPageBody>
  </section>;
}
