import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { ArchiveRestore, ArchiveX, BarChart3, CalendarClock, FileSpreadsheet } from "lucide-react";
import { ControlAsyncState, ControlPageBody } from "control-surface-ui/react";
import OperationalDataTable from "./OperationalDataTable.jsx";
import ControlWorkbenchHeader from "./WorkbenchHeader.jsx";
import ControlSelect from "./ControlSelect.jsx";
import { applyProcurementChanges, assembleProcurementRecords, TECHNOLOGY_AREA_BY_ID } from "./procurement-taxonomy.js";
import { useRecordDispositions } from "./record-dispositions.js";
import { emptyProcurementDiscovery, loadProcurementDiscovery } from "./procurement-discovery.js";

const CaptureCalendar = lazy(() => import("./CaptureCalendar.jsx"));
const TransactionAnalytics = lazy(() => import("./TransactionAnalytics.jsx"));

const VIEWS = new Set(["timeline", "table", "charts"]);

function readRoute() {
  const params = new URLSearchParams(window.location.hash.split("?")[1] || "");
  const value = params.get("spendView");
  return VIEWS.has(value) ? value : "timeline";
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

export default function SpendExplorer({ dataset, awards, samOpportunities, manualProcurement, procurementDelta, subawardSnapshot, accountSpine, requestLineCount }) {
  const [view, setView] = useState(readRoute);
  const [query, setQuery] = useState(() => new URLSearchParams(window.location.hash.split("?")[1] || "").get("capQuery") || "");
  const [tableFilters, setTableFilters] = useState(() => {
    const params = new URLSearchParams(window.location.hash.split("?")[1] || "");
    return { technology: params.get("technology") || "all", branch: params.get("orgBranch") || "all", component: params.get("orgComponent") || "all", office: params.get("orgOffice") || "all", disposition: params.get("records") === "tombstoned" ? "tombstoned" : "active" };
  });
  const dispositions = useRecordDispositions();
  const [discoveryFeed, setDiscoveryFeed] = useState(() => procurementDelta?.discovery?.length ? procurementDelta : emptyProcurementDiscovery());
  useEffect(() => {
    const sync = () => {
      setView(readRoute());
      setQuery(new URLSearchParams(window.location.hash.split("?")[1] || "").get("capQuery") || "");
      const params = new URLSearchParams(window.location.hash.split("?")[1] || "");
      setTableFilters({ technology: params.get("technology") || "all", branch: params.get("orgBranch") || "all", component: params.get("orgComponent") || "all", office: params.get("orgOffice") || "all", disposition: params.get("records") === "tombstoned" ? "tombstoned" : "active" });
    };
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);
  useEffect(() => {
    if (view !== "table" || discoveryFeed.discovery.length) return undefined;
    let active = true;
    loadProcurementDiscovery()
      .then((payload) => { if (active) setDiscoveryFeed(payload); })
      .catch(() => { /* Date-added fields remain explicitly unavailable when the deferred feed cannot load. */ });
    return () => { active = false; };
  }, [discoveryFeed.discovery.length, view]);
  const select = (next) => { setView(next); updateRoute(next); };
  const tabs = <nav className="if-tabs__list spend-explorer__tabs" aria-label="Spend Explorer view">
    <button type="button" className={`if-tab${view === "timeline" ? " is-active" : ""}`} aria-pressed={view === "timeline"} onClick={() => select("timeline")}><CalendarClock size={15} />Timeline</button>
    <button type="button" className={`if-tab${view === "table" ? " is-active" : ""}`} aria-pressed={view === "table"} onClick={() => select("table")}><FileSpreadsheet size={15} />Table</button>
    <button type="button" className={`if-tab${view === "charts" ? " is-active" : ""}`} aria-pressed={view === "charts"} onClick={() => select("charts")}><BarChart3 size={15} />Charts</button>
  </nav>;
  const rows = useMemo(
    () => applyProcurementChanges(assembleProcurementRecords(dataset.records || [], awards || [], dataset.metadata?.asOf, samOpportunities?.records || [], manualProcurement?.records || [], subawardSnapshot), procurementDelta?.records || [], discoveryFeed.discovery || []),
    [awards, dataset.metadata?.asOf, dataset.records, discoveryFeed.discovery, manualProcurement?.records, procurementDelta?.records, samOpportunities?.records, subawardSnapshot],
  );
  const technologyOptions = useMemo(() => [...new Set(rows.flatMap((record) => record.technologyAreas || []))].sort((left, right) => (TECHNOLOGY_AREA_BY_ID.get(left)?.label || left).localeCompare(TECHNOLOGY_AREA_BY_ID.get(right)?.label || right)), [rows]);
  const branchOptions = useMemo(() => [...new Set(rows.map((record) => record.organization?.branch).filter(Boolean))].sort(), [rows]);
  const componentOptions = useMemo(() => [...new Set(rows.filter((record) => tableFilters.branch === "all" || record.organization?.branch === tableFilters.branch).map((record) => record.organization?.component).filter(Boolean))].sort(), [rows, tableFilters.branch]);
  const officeOptions = useMemo(() => [...new Set(rows.filter((record) => (tableFilters.branch === "all" || record.organization?.branch === tableFilters.branch) && (tableFilters.component === "all" || record.organization?.component === tableFilters.component)).map((record) => record.organization?.office).filter((value) => value && value !== "Office not published"))].sort(), [rows, tableFilters.branch, tableFilters.component]);
  const tableRows = useMemo(() => rows.filter((record) => {
    const tombstoned = dispositions.tombstonedIds.has(record.opportunityId);
    return (tableFilters.disposition === "tombstoned" ? tombstoned : !tombstoned)
      && (tableFilters.technology === "all" || (record.technologyAreas || []).includes(tableFilters.technology))
      && (tableFilters.branch === "all" || record.organization?.branch === tableFilters.branch)
      && (tableFilters.component === "all" || record.organization?.component === tableFilters.component)
      && (tableFilters.office === "all" || record.organization?.office === tableFilters.office);
  }), [dispositions.tombstonedIds, rows, tableFilters]);
  const setTableFilter = (key, value) => {
    const next = { ...tableFilters, [key]: value };
    if (key === "branch") { next.component = "all"; next.office = "all"; }
    if (key === "component") next.office = "all";
    setTableFilters(next);
    updateRoute("table", { technology: next.technology === "all" ? "" : next.technology, orgBranch: next.branch === "all" ? "" : next.branch, orgComponent: next.component === "all" ? "" : next.component, orgOffice: next.office === "all" ? "" : next.office, records: next.disposition === "tombstoned" ? "tombstoned" : "" });
  };
  const tableColumns = [
    { key: "record", label: "Record", required: true, sticky: true, minWidth: 300, value: (record) => `${record.id || record.reference || "Unidentified"} ${record.title || "Untitled"}`, render: (record) => <><strong>{record.id || record.reference || "Unidentified"}</strong><small>{record.title || "Untitled public record"}</small></> },
    { key: "recipient", label: "Recipient / sponsor", facet: true, minWidth: 190, value: (record) => record.party || record.recipient || "Not published" },
    { key: "portfolio", label: "Portfolio", facet: true, minWidth: 150, value: (record) => record.portfolio || "Unclassified" },
    { key: "technology", label: "Technology area", minWidth: 190, value: (record) => (record.technologyAreas || []).map((area) => TECHNOLOGY_AREA_BY_ID.get(area)?.label || area).join(" · ") || "Not classified" },
    { key: "organization", label: "DoW hierarchy", minWidth: 220, value: (record) => record.organization?.path?.slice(1, 4).join(" → ") || "Not published", render: (record) => <><strong>{record.organization?.component || "Component not published"}</strong><small>{[record.organization?.branch, record.organization?.office].filter(Boolean).join(" · ")}</small></> },
    { key: "dateAdded", label: "Date added", minWidth: 140, value: (record) => record.firstSeenAt || "", sortValue: (record) => record.firstSeenAt || "", render: (record) => <><strong>{date(record.firstSeenAt)}</strong>{record.sourcePublishedAt ? <small>Source posted {date(record.sourcePublishedAt)}</small> : null}</> },
    { key: "obligations", label: "Observed", sortValue: (record) => Number(record.obligatedAmount || record.fpdsObligatedAmount || 0), exportValue: (record) => Number(record.obligatedAmount || record.fpdsObligatedAmount || 0), render: (record) => <strong>{money(record.obligatedAmount || record.fpdsObligatedAmount)}</strong> },
    { key: "end", label: "Reported end", minWidth: 140, value: (record) => record.currentEnd || record.potentialEnd || "", render: (record) => date(record.currentEnd || record.potentialEnd) },
    { key: "evidence", label: "Evidence", facet: true, minWidth: 120, value: (record) => record.evidenceTier || "unclassified" },
    { key: "actions", label: "Actions", role: "actions", required: true, sortable: false, render: (record) => <div className="dbi-table-actions"><a href={`#/budget-spend/explorer?spendView=timeline&capRecord=${encodeURIComponent(record.opportunityId || record.id || record.reference || "")}`}>Open</a>{dispositions.canWrite ? dispositions.tombstonedIds.has(record.opportunityId) ? <button type="button" onClick={() => dispositions.restore(record.opportunityId)} aria-label={`Restore ${record.title}`} title="Restore to active explorer"><ArchiveRestore size={15} /></button> : <button type="button" onClick={() => dispositions.tombstone(record.opportunityId)} aria-label={`Tombstone ${record.title}`} title="Tombstone this record"><ArchiveX size={15} /></button> : null}</div> },
  ];
  const sevenDaysAgo = new Date(Date.parse(discoveryFeed.metadata?.generatedAt || procurementDelta?.metadata?.generatedAt || dataset.metadata?.generatedAt || "1970-01-01T00:00:00.000Z") - 7 * 86_400_000).toISOString();
  const tableMetrics = [
    { id: "records", label: tableFilters.disposition === "tombstoned" ? "Tombstoned" : "Active records", value: tableRows.length.toLocaleString(), meta: tableFilters.disposition === "tombstoned" ? "Recoverable workspace exclusions" : `${rows.length.toLocaleString()} total published records` },
    { id: "added", label: "Added in 7 days", value: rows.filter((record) => record.firstSeenAt >= sevenDaysAgo).length.toLocaleString(), meta: "First seen by DBI" },
    { id: "awards", label: "Awards", value: Number(awards?.length || 0).toLocaleString(), meta: "Retained award evidence" },
    { id: "snapshot", label: "Snapshot", value: dataset.metadata?.asOf || "Current", meta: "Published-data boundary" },
  ];

  if (view === "timeline") return <Suspense fallback={<RouteLoading label="timeline" />}><CaptureCalendar embedded embeddedTabs={tabs} dataset={dataset} awards={awards} samOpportunities={samOpportunities} manualProcurement={manualProcurement} procurementDelta={procurementDelta} subawardSnapshot={subawardSnapshot} /></Suspense>;
  if (view === "charts") return <Suspense fallback={<RouteLoading label="charts" />}><TransactionAnalytics embedded embeddedTabs={tabs} dataset={dataset} awards={awards} samOpportunities={samOpportunities} manualProcurement={manualProcurement} procurementDelta={procurementDelta} subawardSnapshot={subawardSnapshot} accountSpine={accountSpine} requestLineCount={requestLineCount} /></Suspense>;
  return <section className="spend-explorer spend-explorer--table" data-spend-explorer="table">
    <ControlWorkbenchHeader eyebrow="Spend intelligence" title="Spend Explorer" summary="Timeline, records, and charts share one public-data scope." metrics={tableMetrics} metricLabel="Spend table summary" tabs={tabs} />
    <ControlPageBody compact>
      <details className="spend-explorer__daily-feed" data-daily-acquisition-feed>
        <summary><span><strong>Daily acquisition updates</strong><small>{discoveryFeed.history?.[0] ? `${discoveryFeed.history[0].summary.added} added · ${discoveryFeed.history[0].summary.updated} updated · ${discoveryFeed.history[0].summary.removed} removed` : "History begins with the next retained refresh"}</small></span><span>{discoveryFeed.history?.[0]?.sources?.sam === "current" ? "SAM.gov current" : "SAM.gov unavailable"}</span></summary>
        <div>{(discoveryFeed.history || []).slice(0, 14).map((entry) => <article key={entry.date}><time dateTime={entry.date}>{date(entry.date)}</time><span><b>{entry.summary.added}</b> added</span><span><b>{entry.summary.updated}</b> updated</span><span><b>{entry.summary.removed}</b> removed</span><small>SAM.gov {entry.sources?.sam || "unknown"} · USAspending {entry.sources?.usaspending || "unknown"}</small></article>)}</div>
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
      <OperationalDataTable id="spend-records" label="Spend and transaction records" rows={tableRows} columns={tableColumns} rowKey={(record) => record.opportunityId || record.id || record.reference} defaultSort={{ key: "dateAdded", direction: "desc" }} queryValue={query} onQueryChange={(value) => { setQuery(value); updateRoute("table", { capQuery: value }); }} searchPlaceholder="Search records, recipients, technology areas, organizations, and references…" exportFilename="spend-explorer.csv" mobileColumns={["record", "technology", "dateAdded", "actions"]} empty={tableFilters.disposition === "tombstoned" ? "No tombstoned records. Records you intentionally suppress will remain recoverable here." : "No active records match the current hierarchy and table controls."} />
    </ControlPageBody>
  </section>;
}
