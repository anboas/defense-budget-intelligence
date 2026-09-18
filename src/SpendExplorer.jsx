import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { BarChart3, CalendarClock, FileSpreadsheet } from "lucide-react";
import { ControlAsyncState, ControlPageBody } from "control-surface-ui/react";
import OperationalDataTable from "./OperationalDataTable.jsx";
import ControlWorkbenchHeader from "./WorkbenchHeader.jsx";
import { applyProcurementChanges, assembleProcurementRecords } from "./procurement-taxonomy.js";

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
  useEffect(() => {
    const sync = () => {
      setView(readRoute());
      setQuery(new URLSearchParams(window.location.hash.split("?")[1] || "").get("capQuery") || "");
    };
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);
  const select = (next) => { setView(next); updateRoute(next); };
  const tabs = <nav className="if-tabs__list spend-explorer__tabs" aria-label="Spend Explorer view">
    <button type="button" className={`if-tab${view === "timeline" ? " is-active" : ""}`} aria-pressed={view === "timeline"} onClick={() => select("timeline")}><CalendarClock size={15} />Timeline</button>
    <button type="button" className={`if-tab${view === "table" ? " is-active" : ""}`} aria-pressed={view === "table"} onClick={() => select("table")}><FileSpreadsheet size={15} />Table</button>
    <button type="button" className={`if-tab${view === "charts" ? " is-active" : ""}`} aria-pressed={view === "charts"} onClick={() => select("charts")}><BarChart3 size={15} />Charts</button>
  </nav>;
  const rows = useMemo(
    () => applyProcurementChanges(assembleProcurementRecords(dataset.records || [], awards || [], dataset.metadata?.asOf, samOpportunities?.records || [], manualProcurement?.records || [], subawardSnapshot), procurementDelta?.records || []),
    [awards, dataset.metadata?.asOf, dataset.records, manualProcurement?.records, procurementDelta?.records, samOpportunities?.records, subawardSnapshot],
  );
  const tableColumns = [
    { key: "record", label: "Record", required: true, sticky: true, minWidth: 300, value: (record) => `${record.id || record.reference || "Unidentified"} ${record.title || "Untitled"}`, render: (record) => <><strong>{record.id || record.reference || "Unidentified"}</strong><small>{record.title || "Untitled public record"}</small></> },
    { key: "recipient", label: "Recipient / sponsor", facet: true, minWidth: 190, value: (record) => record.party || record.recipient || "Not published" },
    { key: "portfolio", label: "Portfolio", facet: true, minWidth: 150, value: (record) => record.portfolio || "Unclassified" },
    { key: "obligations", label: "Observed", sortValue: (record) => Number(record.obligatedAmount || record.fpdsObligatedAmount || 0), exportValue: (record) => Number(record.obligatedAmount || record.fpdsObligatedAmount || 0), render: (record) => <strong>{money(record.obligatedAmount || record.fpdsObligatedAmount)}</strong> },
    { key: "end", label: "Reported end", minWidth: 140, value: (record) => record.currentEnd || record.potentialEnd || "", render: (record) => date(record.currentEnd || record.potentialEnd) },
    { key: "evidence", label: "Evidence", facet: true, minWidth: 120, value: (record) => record.evidenceTier || "unclassified" },
    { key: "actions", label: "Actions", role: "actions", required: true, sortable: false, render: (record) => <div className="dbi-table-actions"><a href={`#/budget-spend/explorer?spendView=timeline&capRecord=${encodeURIComponent(record.opportunityId || record.id || record.reference || "")}`}>Open</a></div> },
  ];
  const tableMetrics = [
    { id: "records", label: "Records", value: rows.length.toLocaleString(), meta: "Public transaction records" },
    { id: "awards", label: "Awards", value: Number(awards?.length || 0).toLocaleString(), meta: "Retained award evidence" },
    { id: "snapshot", label: "Snapshot", value: dataset.metadata?.asOf || "Current", meta: "Published-data boundary" },
  ];

  if (view === "timeline") return <Suspense fallback={<RouteLoading label="timeline" />}><CaptureCalendar embedded embeddedTabs={tabs} dataset={dataset} awards={awards} samOpportunities={samOpportunities} manualProcurement={manualProcurement} procurementDelta={procurementDelta} subawardSnapshot={subawardSnapshot} /></Suspense>;
  if (view === "charts") return <Suspense fallback={<RouteLoading label="charts" />}><TransactionAnalytics embedded embeddedTabs={tabs} dataset={dataset} awards={awards} samOpportunities={samOpportunities} manualProcurement={manualProcurement} procurementDelta={procurementDelta} subawardSnapshot={subawardSnapshot} accountSpine={accountSpine} requestLineCount={requestLineCount} /></Suspense>;
  return <section className="spend-explorer spend-explorer--table" data-spend-explorer="table">
    <ControlWorkbenchHeader eyebrow="Spend intelligence" title="Spend Explorer" summary="Timeline, records, and charts share one public-data scope." metrics={tableMetrics} metricLabel="Spend table summary" tabs={tabs} />
    <ControlPageBody compact>
      <OperationalDataTable id="spend-records" label="Spend and transaction records" rows={rows} columns={tableColumns} rowKey={(record) => record.opportunityId || record.id || record.reference} defaultSort={{ key: "obligations", direction: "desc" }} queryValue={query} onQueryChange={(value) => { setQuery(value); updateRoute("table", { capQuery: value }); }} searchPlaceholder="Search records, recipients, portfolios, and references…" exportFilename="spend-explorer.csv" mobileColumns={["record", "obligations", "end", "actions"]} />
    </ControlPageBody>
  </section>;
}
