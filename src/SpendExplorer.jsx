import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { ArchiveRestore, ArchiveX, BarChart3, CalendarClock, ChevronDown, FileSpreadsheet, Filter, Inbox, MoreHorizontal, Radar as RadarIcon, RotateCcw, ScatterChart } from "lucide-react";
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
import { SAM_NOTICE_TYPE_OPTIONS, samNoticeTypeId, samNoticeTypeLabel } from "./sam-notice-types.js";
import { parseMultiValues, serializeMultiValues } from "./SearchMultiSelect.jsx";
import OpportunityRadar from "./OpportunityRadar.jsx";
import { classifyOpportunityFit } from "./opportunity-fit.js";
import OpportunityWorkbenchDetail, { OpportunityFitBadge } from "./OpportunityWorkbenchDetail.jsx";
import "./SpendExplorer.css";

const CaptureCalendar = lazyWithRefresh(() => import("./CaptureCalendar.jsx"), "capture-calendar");
const TransactionAnalytics = lazyWithRefresh(() => import("./TransactionAnalytics.jsx"), "transaction-analytics");
const OpportunityRecordPage = lazyWithRefresh(() => import("./OpportunityRecordPage.jsx"), "opportunity-record-page");
const OpportunityPortfolioVisuals = lazyWithRefresh(() => import("./OpportunityPortfolioVisuals.jsx"), "opportunity-portfolio-visuals");

const VIEWS = new Set(["radar", "today", "visuals", "timeline", "table", "charts", "record"]);
const STRATEGY_SCOPE_KEY = "dbi:strategy-scope:v1";

function readRoute() {
  const params = new URLSearchParams(window.location.hash.split("?")[1] || "");
  const value = params.get("spendView");
  return VIEWS.has(value) ? value : "table";
}

function readTableNoticeType(params) {
  return params.get("noticeType") || parseMultiValues(params.get("capNoticeType"))[0] || "all";
}

function readTableFilters(params) {
  return {
    customer: params.get("customer") || "all",
    stage: params.get("stage") || "all",
    trust: params.get("trust") || "all",
    technology: params.get("technology") || "all",
    noticeType: readTableNoticeType(params),
    branch: params.get("orgBranch") || "all",
    component: params.get("orgComponent") || "all",
    office: params.get("orgOffice") || "all",
    disposition: params.get("records") === "tombstoned" ? "tombstoned" : "active",
    changes: params.get("changes") === "today" ? "today" : "all",
  };
}

function readStrategyScope(params = new URLSearchParams(window.location.hash.split("?")[1] || "")) {
  const key = params.get("strategyScope") || "";
  if (!key) return null;
  try {
    const parsed = JSON.parse(window.sessionStorage.getItem(STRATEGY_SCOPE_KEY) || "null");
    return parsed?.key === key && Array.isArray(parsed.ids) ? parsed : null;
  } catch {
    return null;
  }
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

function customer(record) {
  return [record.organization?.office, record.organization?.component, record.organization?.branch, record.party, record.recipient]
    .find((value) => value && !/not published/i.test(value)) || "Customer not published";
}

function RouteLoading({ label }) {
  return <ControlAsyncState compact state="loading" title={`Loading ${label}`} message="Preparing the selected spend view." />;
}

function SpendViewBoundary({ view, children }) {
  const label = { charts: "Analytics", timeline: "Timeline", visuals: "Portfolio visuals", record: "Record workspace" }[view] || "Spend view";
  return <ControlErrorBoundary resetKey={view} title={`${label} could not render`} message="Retry this view. The failure was recorded in Connections → API Log." onError={(error, info) => reportClientError(error, { kind: "route_render_error", componentStack: info?.componentStack })}>{children}</ControlErrorBoundary>;
}

export default function SpendExplorer({ dataset, awards, samOpportunities, manualProcurement, procurementDelta, subawardSnapshot, accountSpine, requestLineCount }) {
  const auth = useAuth();
  const runtimeAvailable = Boolean(auth?.authVersion === "dbi-pages-auth-v1" && auth?.enabled && auth?.user && !auth?.staticHost);
  const [view, setView] = useState(readRoute);
  const [query, setQuery] = useState(() => new URLSearchParams(window.location.hash.split("?")[1] || "").get("capQuery") || "");
  const [focusedRecordId, setFocusedRecordId] = useState(() => new URLSearchParams(window.location.hash.split("?")[1] || "").get("capRecord") || "");
  const [tableFilters, setTableFilters] = useState(() => readTableFilters(new URLSearchParams(window.location.hash.split("?")[1] || "")));
  const [strategyScope, setStrategyScope] = useState(readStrategyScope);
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
      const params = new URLSearchParams(window.location.hash.split("?")[1] || "");
      setQuery(params.get("capQuery") || "");
      setFocusedRecordId(params.get("capRecord") || "");
      setTableFilters(readTableFilters(params));
      setStrategyScope(readStrategyScope(params));
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
    const samRuntime = runtimeSamRecords.filter((record) => record.recordKind !== "acquisition-portfolio");
    if (!samRuntime.length) return samOpportunities;
    const merged = new Map();
    for (const record of samOpportunities?.records || []) merged.set(record.sourceRecordId || record.noticeId, record);
    for (const record of samRuntime) merged.set(record.sourceRecordId || record.noticeId, record);
    return {
      ...(samOpportunities || {}),
      metadata: { ...(samOpportunities?.metadata || {}), status: "workspace-runtime", runtimeRecordCount: samRuntime.length },
      records: [...merged.values()],
    };
  }, [runtimeSamRecords, samOpportunities]);
  const effectiveManualProcurement = useMemo(() => {
    const imported = runtimeSamRecords.filter((record) => record.recordKind === "acquisition-portfolio");
    return { ...(manualProcurement || {}), metadata: { ...(manualProcurement?.metadata || {}), runtimePortfolioRecords: imported.length }, records: [...(manualProcurement?.records || []), ...imported] };
  }, [manualProcurement, runtimeSamRecords]);
  const select = (next) => {
    setView(next);
    if (next === "timeline") {
      updateRoute(next, { capNoticeType: tableFilters.noticeType === "all" ? "" : serializeMultiValues([tableFilters.noticeType]) });
      return;
    }
    updateRoute(next, { noticeType: tableFilters.noticeType === "all" ? "" : tableFilters.noticeType });
  };
  const analysisView = { visuals: "Visuals", timeline: "Timeline", charts: "Analytics" }[view] || "";
  const tabs = <div className="spend-explorer__viewbar">
    <nav className="if-tabs__list spend-explorer__tabs" aria-label="Opportunity views">
      <button type="button" className={`if-tab${["table", "record"].includes(view) ? " is-active" : ""}`} aria-pressed={["table", "record"].includes(view)} onClick={() => select("table")}><FileSpreadsheet size={15} />Workbench</button>
      <button type="button" className={`if-tab${view === "radar" ? " is-active" : ""}`} aria-pressed={view === "radar"} onClick={() => select("radar")}><RadarIcon size={15} />Radar</button>
      <button type="button" className={`if-tab${view === "today" ? " is-active" : ""}`} aria-pressed={view === "today"} onClick={() => select("today")}><Inbox size={15} />Brief</button>
    </nav>
    <details className={`dbi-data-table__columns spend-explorer__analysis-menu${analysisView ? " is-active" : ""}`}>
      <summary className="if-tab" aria-label={analysisView ? `Analysis view: ${analysisView}` : "Open analysis views"}><MoreHorizontal size={15} />{analysisView || "Analyze"}</summary>
      <div role="menu" aria-label="Analysis views">
        <button className="if-btn if-btn--ghost" type="button" role="menuitem" onClick={(event) => { event.currentTarget.closest("details")?.removeAttribute("open"); select("visuals"); }}><ScatterChart size={15} /><span><strong>Visuals</strong><small>Portfolio, strategy, and heatmap views</small></span></button>
        <button className="if-btn if-btn--ghost" type="button" role="menuitem" onClick={(event) => { event.currentTarget.closest("details")?.removeAttribute("open"); select("timeline"); }}><CalendarClock size={15} /><span><strong>Timeline</strong><small>Dates, milestones, and linked research</small></span></button>
        <button className="if-btn if-btn--ghost" type="button" role="menuitem" onClick={(event) => { event.currentTarget.closest("details")?.removeAttribute("open"); select("charts"); }}><BarChart3 size={15} /><span><strong>Analytics</strong><small>Spend, awards, and comparison charts</small></span></button>
      </div>
    </details>
  </div>;
  const rows = useMemo(
    () => applyProcurementChanges(assembleProcurementRecords(dataset.records || [], awards || [], dataset.metadata?.asOf, effectiveSamOpportunities?.records || [], effectiveManualProcurement?.records || [], subawardSnapshot), procurementDelta?.records || [], discoveryIndex.discovery || []),
    [awards, dataset.metadata?.asOf, dataset.records, discoveryIndex.discovery, effectiveManualProcurement?.records, effectiveSamOpportunities?.records, procurementDelta?.records, subawardSnapshot],
  );
  const technologyOptions = useMemo(() => [...new Set(rows.flatMap((record) => record.technologyAreas || []))].sort((left, right) => (TECHNOLOGY_AREA_BY_ID.get(left)?.label || left).localeCompare(TECHNOLOGY_AREA_BY_ID.get(right)?.label || right)), [rows]);
  const noticeTypeOptions = useMemo(() => SAM_NOTICE_TYPE_OPTIONS.filter((option) => rows.some((record) => samNoticeTypeId(record.noticeType) === option.id)), [rows]);
  const latestFeed = dailyFeed.history?.[0];
  const latestFeedDate = latestFeed?.date || null;
  const branchOptions = useMemo(() => [...new Set(rows.map((record) => record.organization?.branch).filter(Boolean))].sort(), [rows]);
  const customerOptions = useMemo(() => [...new Set(rows.map(customer).filter((value) => value !== "Customer not published"))].sort(), [rows]);
  const stageOptions = useMemo(() => [...new Set(rows.map((record) => samNoticeTypeLabel(record.noticeType)).filter(Boolean))].sort(), [rows]);
  const trustOptions = useMemo(() => [...new Set(rows.map((record) => record.evidenceTier || "unclassified"))].sort(), [rows]);
  const componentOptions = useMemo(() => [...new Set(rows.filter((record) => tableFilters.branch === "all" || record.organization?.branch === tableFilters.branch).map((record) => record.organization?.component).filter(Boolean))].sort(), [rows, tableFilters.branch]);
  const officeOptions = useMemo(() => [...new Set(rows.filter((record) => (tableFilters.branch === "all" || record.organization?.branch === tableFilters.branch) && (tableFilters.component === "all" || record.organization?.component === tableFilters.component)).map((record) => record.organization?.office).filter((value) => value && value !== "Office not published"))].sort(), [rows, tableFilters.branch, tableFilters.component]);
  const tableRows = useMemo(() => rows.filter((record) => {
    const tombstoned = dispositions.tombstonedIds.has(record.opportunityId);
    return (tableFilters.disposition === "tombstoned" ? tombstoned : !tombstoned)
      && (tableFilters.customer === "all" || customer(record) === tableFilters.customer)
      && (tableFilters.stage === "all" || samNoticeTypeLabel(record.noticeType) === tableFilters.stage)
      && (tableFilters.trust === "all" || (record.evidenceTier || "unclassified") === tableFilters.trust)
      && (tableFilters.technology === "all" || (record.technologyAreas || []).includes(tableFilters.technology))
      && (tableFilters.noticeType === "all" || samNoticeTypeId(record.noticeType) === tableFilters.noticeType)
      && (tableFilters.branch === "all" || record.organization?.branch === tableFilters.branch)
      && (tableFilters.component === "all" || record.organization?.component === tableFilters.component)
      && (tableFilters.office === "all" || record.organization?.office === tableFilters.office)
      && (!strategyScope?.ids?.length || strategyScope.ids.includes(record.opportunityId || record.id || record.reference || record.sourceRecordId))
      && (tableFilters.changes !== "today" || !latestFeedDate || String(record.lastChangedAt || record.firstSeenAt || "").slice(0, 10) === latestFeedDate);
  }).map((record) => ({ ...record, fitAssessment: classifyOpportunityFit(record) })), [dispositions.tombstonedIds, latestFeedDate, rows, strategyScope, tableFilters]);
  const setTableFilter = (key, value) => {
    const next = { ...tableFilters, [key]: value };
    if (key === "branch") { next.component = "all"; next.office = "all"; }
    if (key === "component") next.office = "all";
    setTableFilters(next);
    updateRoute(view === "today" ? "today" : "table", { customer: next.customer === "all" ? "" : next.customer, stage: next.stage === "all" ? "" : next.stage, trust: next.trust === "all" ? "" : next.trust, technology: next.technology === "all" ? "" : next.technology, noticeType: next.noticeType === "all" ? "" : next.noticeType, orgBranch: next.branch === "all" ? "" : next.branch, orgComponent: next.component === "all" ? "" : next.component, orgOffice: next.office === "all" ? "" : next.office, records: next.disposition === "tombstoned" ? "tombstoned" : "", changes: next.changes === "today" ? "today" : "" });
  };
  const tableColumns = [
    { key: "record", label: "Opportunity", required: true, sticky: true, minWidth: 320, mobilePrimary: true, value: (record) => `${record.title || "Untitled"} ${record.id || record.reference || "Unidentified"}`, searchValue: (record) => [record.opportunityId, record.id, record.reference, record.sourceRecordId, record.liveAward?.id, record.liveAward?.generatedAwardId, record.title, record.description].filter(Boolean).join(" "), render: (record) => <><strong>{record.title || "Untitled public record"}</strong><small>{record.id || record.reference || record.sourceRecordId || "Unidentified"}</small></> },
    { key: "customer", label: "Customer", facet: true, minWidth: 210, value: customer, render: (record) => <><strong>{customer(record)}</strong><small>{[record.organization?.branch, record.organization?.component, record.party, record.recipient].find((value) => value && value !== customer(record) && !/not published/i.test(value)) || ""}</small></> },
    { key: "stage", label: "Stage", facet: true, minWidth: 160, value: (record) => samNoticeTypeLabel(record.noticeType) },
    { key: "fit", label: "Fit", minWidth: 145, sortValue: (record) => record.fitAssessment.score, value: (record) => `${record.fitAssessment.score} ${record.fitAssessment.level}`, render: (record) => <OpportunityFitBadge assessment={record.fitAssessment} /> },
    { key: "trust", label: "Trust", facet: true, minWidth: 135, value: (record) => record.evidenceTier || "unclassified", render: (record) => <span className={`opportunity-trust opportunity-trust--${record.evidenceTier || "unclassified"}`}><strong>{String(record.evidenceTier || "unclassified").replaceAll("-", " ")}</strong><small>{record.sourceRoleCount ? `${record.sourceRoleCount} source roles` : "Source backed"}</small></span> },
    { key: "deadline", label: "Due", minWidth: 145, value: (record) => record.solicitationEnd || "", sortValue: (record) => record.solicitationEnd || "9999-12-31", render: (record) => date(record.solicitationEnd) },
    { key: "obligations", label: "Value", minWidth: 110, sortValue: (record) => Number(record.obligatedAmount || record.fpdsObligatedAmount || 0), exportValue: (record) => Number(record.obligatedAmount || record.fpdsObligatedAmount || 0), render: (record) => <strong>{money(record.obligatedAmount || record.fpdsObligatedAmount)}</strong> },
    { key: "change", label: "Last change", minWidth: 190, value: (record) => [record.lastChangeType, ...(record.changedFields || []).map((field) => field.label)].filter(Boolean).join(" "), render: (record) => <><strong>{record.lastChangeType === "added" ? "Added" : record.lastChangeType === "removed" ? "Removed" : record.lastChangeType === "updated" ? "Updated" : "No retained change"}</strong>{record.changedFields?.length ? <small>{record.changedFields.slice(0, 2).map((field) => field.label).join(" · ")}{record.changedFields.length > 2 ? ` +${record.changedFields.length - 2}` : ""}</small> : null}</> },
    { key: "source", label: "Source", facet: true, minWidth: 170, value: (record) => record.recordKind === "acquisition-portfolio" ? record.portfolio : record.sourceSystem || record.evidenceTier || "Defense intelligence", render: (record) => <><strong>{record.recordKind === "acquisition-portfolio" ? record.portfolio : record.sourceSystem || "Official source"}</strong><small>{record.sourcePublishedAt ? `Published ${date(record.sourcePublishedAt)}` : "Retained evidence"}</small></> },
    { key: "recipient", label: "Recipient / sponsor", facet: true, minWidth: 190, value: (record) => record.party || record.recipient || "Not published" },
    { key: "portfolio", label: "Portfolio", facet: true, minWidth: 150, value: (record) => record.portfolio || "Unclassified" },
    { key: "technology", label: "Technology area", minWidth: 190, value: (record) => (record.technologyAreas || []).map((area) => TECHNOLOGY_AREA_BY_ID.get(area)?.label || area).join(" · ") || "Not classified" },
    { key: "noticeType", label: "Notice type", minWidth: 170, value: (record) => samNoticeTypeLabel(record.noticeType) },
    { key: "organization", label: "DoW hierarchy", minWidth: 220, value: (record) => record.organization?.path?.slice(1, 4).join(" → ") || "Not published", render: (record) => <><strong>{record.organization?.component || "Component not published"}</strong><small>{[record.organization?.branch, record.organization?.office].filter(Boolean).join(" · ")}</small></> },
    { key: "dateAdded", label: "Date added", minWidth: 140, value: (record) => record.firstSeenAt || "", sortValue: (record) => record.firstSeenAt || "", render: (record) => <><strong>{date(record.firstSeenAt)}</strong>{record.sourcePublishedAt ? <small>Source posted {date(record.sourcePublishedAt)}</small> : null}</> },
    { key: "posted", label: "Posted date", minWidth: 140, value: (record) => record.sourcePublishedAt || record.solicitationStart || "", sortValue: (record) => record.sourcePublishedAt || record.solicitationStart || "0000-00-00", render: (record) => date(record.sourcePublishedAt || record.solicitationStart) },
    { key: "end", label: "Reported end", minWidth: 140, value: (record) => record.currentEnd || record.potentialEnd || "", render: (record) => date(record.currentEnd || record.potentialEnd) },
    { key: "evidence", label: "Evidence", minWidth: 120, value: (record) => record.evidenceTier || "unclassified" },
    { key: "acquisitionSource", label: "Acquisition source", facet: true, minWidth: 190, value: (record) => record.recordKind === "acquisition-portfolio" ? record.portfolio : "Other Defense Intelligence source" },
    { key: "setAside", label: "Set-aside", facet: true, minWidth: 170, value: (record) => record.setAside || "Not published" },
    { key: "acquisitionArea", label: "Acquisition work area", facet: true, minWidth: 210, value: (record) => record.acquisitionArea || "Not assessed" },
    { key: "acquisitionRoute", label: "Access route", facet: true, minWidth: 190, value: (record) => record.acquisitionRoute || "Not assessed" },
    { key: "acquisitionPriority", label: "Priority", facet: true, minWidth: 110, sortValue: (record) => Number(record.acquisitionPriority || 99), value: (record) => record.acquisitionPriority ? `P${record.acquisitionPriority}` : "Not assessed" },
    { key: "acquisitionScore", label: "Screening", minWidth: 120, sortValue: (record) => Number(record.acquisitionScore || 0), value: (record) => record.acquisitionScore == null ? "Not assessed" : `${record.acquisitionScore}/100` },
    { key: "actions", label: "Actions", role: "actions", required: true, sortable: false, render: (record) => <div className="dbi-table-actions">{dispositions.canWrite ? dispositions.tombstonedIds.has(record.opportunityId) ? <button type="button" onClick={() => dispositions.restore(record.opportunityId)} aria-label={`Restore ${record.title}`} title="Restore to active opportunities"><ArchiveRestore size={15} /></button> : <button type="button" onClick={() => dispositions.tombstone(record.opportunityId)} aria-label={`Hide ${record.title}`} title="Hide from active opportunities"><ArchiveX size={15} /></button> : null}</div> },
  ];
  const todayMetrics = [
    { id: "known", label: "Known records", value: Number(dailyFeed.metadata?.coverage?.knownRecords || dailyFeed.metadata?.discoveryCount || rows.length).toLocaleString(), meta: "Disclosed discovery scope" },
    { id: "new", label: "New today", value: Number(latestFeed?.summary?.added || 0).toLocaleString(), meta: "First observed by DBI" },
    { id: "changed", label: "Changed today", value: Number(latestFeed?.summary?.updated || 0).toLocaleString(), meta: "Field-level source changes" },
    { id: "coverage", label: "Monitor coverage", value: `${Number(dailyFeed.metadata?.coverage?.contractMonitor?.coveragePct || 0).toLocaleString()}%`, meta: `${Number(dailyFeed.metadata?.coverage?.contractMonitor?.gapCount || 0).toLocaleString()} disclosed gaps` },
  ];
  const radarAssessments = useMemo(() => rows.map((record) => classifyOpportunityFit(record)), [rows]);
  const radarMetrics = [
    { id: "strong", label: "Strong fit", value: radarAssessments.filter((item) => item.score >= 70).length.toLocaleString(), meta: "Explainable 70+ profile score" },
    { id: "potential", label: "Potential fit", value: radarAssessments.filter((item) => item.score >= 45).length.toLocaleString(), meta: "Explainable 45+ profile score" },
    { id: "rfi", label: "RFIs / sources sought", value: rows.filter((record) => samNoticeTypeId(record.noticeType) === "r").length.toLocaleString(), meta: "Source-backed opportunity records" },
    { id: "coded", label: "Code-backed", value: rows.filter((record) => record.naicsCode || record.pscCode).length.toLocaleString(), meta: "Published NAICS or PSC" },
  ];
  const activeScopeFilterCount = [tableFilters.customer, tableFilters.stage, tableFilters.trust, tableFilters.technology, tableFilters.noticeType, tableFilters.branch, tableFilters.component, tableFilters.office, tableFilters.disposition].filter((value) => value && !["all", "active"].includes(value)).length;
  const resetTableFilters = () => {
    setTableFilters(readTableFilters(new URLSearchParams()));
    updateRoute("table", { customer: "", stage: "", trust: "", technology: "", noticeType: "", orgBranch: "", orgComponent: "", orgOffice: "", records: "", changes: "" });
  };
  const savedViewRows = rows.length ? rows : (discoveryIndex.discovery || []);
  const savedViews = <SpendSavedViews compact={view === "table"} rows={savedViewRows} tombstonedIds={dispositions.tombstonedIds} query={query} filters={tableFilters} onHasViews={setHasSavedViews} onSummary={setSavedViewSummary} onLoad={(saved) => {
    const next = { ...tableFilters, ...(saved.filters || {}), disposition: saved.filters?.disposition === "tombstoned" ? "tombstoned" : "active", changes: "all" };
    setTableFilters(next);
    setQuery(saved.query || "");
    updateRoute("table", { capQuery: saved.query || "", customer: next.customer === "all" ? "" : next.customer, stage: next.stage === "all" ? "" : next.stage, trust: next.trust === "all" ? "" : next.trust, technology: next.technology === "all" ? "" : next.technology, noticeType: next.noticeType === "all" ? "" : next.noticeType, orgBranch: next.branch === "all" ? "" : next.branch, orgComponent: next.component === "all" ? "" : next.component, orgOffice: next.office === "all" ? "" : next.office, records: next.disposition === "tombstoned" ? "tombstoned" : "", changes: "" });
  }} />;
  const scopeFilters = <details className="dbi-data-table__columns spend-explorer__scope-menu" data-opportunity-workbench-scope>
    <summary className="if-btn if-btn--secondary"><Filter size={15} aria-hidden="true" /><span>Filters{activeScopeFilterCount ? ` · ${activeScopeFilterCount}` : ""}</span><ChevronDown size={13} aria-hidden="true" /></summary>
    <div><header><strong>Filter opportunities</strong>{activeScopeFilterCount ? <button className="if-btn if-btn--secondary if-btn--sm" type="button" onClick={resetTableFilters}><RotateCcw size={13} />Reset</button> : null}</header><div className="spend-explorer__scope-grid">
      <ControlSelect compact label="Customer" value={tableFilters.customer} options={[{ value: "all", label: "All customers" }, ...customerOptions.map((value) => ({ value, label: value }))]} onChange={(value) => setTableFilter("customer", value)} />
      <ControlSelect compact label="Stage" value={tableFilters.stage} options={[{ value: "all", label: "All stages" }, ...stageOptions.map((value) => ({ value, label: value }))]} onChange={(value) => setTableFilter("stage", value)} />
      <ControlSelect compact label="Trust" value={tableFilters.trust} options={[{ value: "all", label: "All evidence" }, ...trustOptions.map((value) => ({ value, label: value.replaceAll("-", " ") }))]} onChange={(value) => setTableFilter("trust", value)} />
      <ControlSelect compact label="Notice type" value={tableFilters.noticeType} options={[{ value: "all", label: "All notice types" }, ...noticeTypeOptions.map((option) => ({ value: option.id, label: option.label }))]} onChange={(value) => setTableFilter("noticeType", value)} />
      <ControlSelect compact label="Branch" value={tableFilters.branch} options={[{ value: "all", label: "All branches" }, ...branchOptions.map((value) => ({ value, label: value }))]} onChange={(value) => setTableFilter("branch", value)} />
      <ControlSelect compact label="Technology" value={tableFilters.technology} options={[{ value: "all", label: "All technology" }, ...technologyOptions.map((area) => ({ value: area, label: TECHNOLOGY_AREA_BY_ID.get(area)?.label || area }))]} onChange={(value) => setTableFilter("technology", value)} />
      <ControlSelect compact label="Component" value={tableFilters.component} options={[{ value: "all", label: "All components" }, ...componentOptions.map((value) => ({ value, label: value }))]} onChange={(value) => setTableFilter("component", value)} />
      <ControlSelect compact label="Buying office" value={tableFilters.office} options={[{ value: "all", label: "All offices" }, ...officeOptions.map((value) => ({ value, label: value }))]} onChange={(value) => setTableFilter("office", value)} />
      <ControlSelect compact label="Record state" value={tableFilters.disposition} options={[{ value: "active", label: "Active" }, { value: "tombstoned", label: `Hidden (${dispositions.rows.length})` }]} onChange={(value) => setTableFilter("disposition", value)} />
    </div></div>
  </details>;

  if (view === "radar") return <section className="spend-explorer spend-explorer--radar" data-spend-explorer="radar">
    <ControlWorkbenchHeader eyebrow="Opportunity intelligence" title="Opportunity Radar" summary="Find applicable work, inspect why it fits, add known SAM.gov notices, and track what matters." metrics={radarMetrics} metricLabel="Opportunity radar summary" tabs={tabs} />
    <ControlPageBody compact><OpportunityRadar rows={rows.filter((record) => !dispositions.tombstonedIds.has(record.opportunityId))} runtimeAvailable={runtimeAvailable} onRuntimeRecordsChanged={loadRuntimeRecords} /></ControlPageBody>
  </section>;
  if (view === "today") return <section className="spend-explorer spend-explorer--today" data-spend-explorer="today">
    <ControlWorkbenchHeader eyebrow="Decision support" title="Decision Brief" summary="What changed, what needs attention, and where to continue." metrics={todayMetrics} metricLabel="Decision brief summary" tabs={tabs} />
    <ControlPageBody compact><SpendToday rows={rows.filter((record) => !dispositions.tombstonedIds.has(record.opportunityId))} discoveryFeed={dailyFeed} savedViews={savedViews} savedViewSummary={savedViewSummary} runtimePanel={<AcquisitionRuntimePanel onRefreshComplete={loadRuntimeRecords} />} /></ControlPageBody>
  </section>;
  if (view === "visuals") return <SpendViewBoundary view={view}><Suspense fallback={<RouteLoading label="portfolio visuals" />}><OpportunityPortfolioVisuals records={tableRows} selectedId={focusedRecordId} tabs={tabs} asOf={dataset.metadata?.asOf || dataset.metadata?.generatedAt} onSelect={(recordId) => { setFocusedRecordId(recordId); updateRoute("visuals", { capRecord: recordId }); }} onScope={(office, technology) => { const next = { ...tableFilters, customer: "all", stage: "all", trust: "all", office, technology, disposition: "active", changes: "all" }; setStrategyScope(null); window.sessionStorage.removeItem(STRATEGY_SCOPE_KEY); setTableFilters(next); setQuery(""); setFocusedRecordId(""); updateRoute("table", { capQuery: "", customer: "", stage: "", trust: "", technology, noticeType: next.noticeType === "all" ? "" : next.noticeType, orgBranch: next.branch === "all" ? "" : next.branch, orgComponent: next.component === "all" ? "" : next.component, orgOffice: office, records: "", changes: "", capRecord: "", strategyScope: "" }); }} onQuadrant={(quadrant, ids) => { const scope = { key: quadrant.key || `ansoff-${quadrant.id}`, label: quadrant.label || `${quadrant.code} / ${quadrant.name}`, ids }; window.sessionStorage.setItem(STRATEGY_SCOPE_KEY, JSON.stringify(scope)); setStrategyScope(scope); setQuery(""); setFocusedRecordId(""); updateRoute("table", { capQuery: "", capRecord: "", strategyScope: scope.key }); }} /></Suspense></SpendViewBoundary>;
  if (view === "record") return <SpendViewBoundary view={view}><Suspense fallback={<RouteLoading label="record workspace" />}><OpportunityRecordPage records={rows.filter((record) => !dispositions.tombstonedIds.has(record.opportunityId))} recordId={focusedRecordId} tabs={tabs} /></Suspense></SpendViewBoundary>;
  if (view === "timeline") return <SpendViewBoundary view={view}><Suspense fallback={<RouteLoading label="timeline" />}><CaptureCalendar embedded embeddedTabs={tabs} dataset={dataset} awards={awards} samOpportunities={effectiveSamOpportunities} manualProcurement={effectiveManualProcurement} procurementDelta={procurementDelta} subawardSnapshot={subawardSnapshot} onOpenRecord={(recordId) => updateRoute("record", { capRecord: recordId })} /></Suspense></SpendViewBoundary>;
  if (view === "charts") return <SpendViewBoundary view={view}><Suspense fallback={<RouteLoading label="charts" />}><TransactionAnalytics embedded embeddedTabs={tabs} dataset={dataset} awards={awards} samOpportunities={effectiveSamOpportunities} manualProcurement={effectiveManualProcurement} procurementDelta={procurementDelta} subawardSnapshot={subawardSnapshot} accountSpine={accountSpine} requestLineCount={requestLineCount} /></Suspense></SpendViewBoundary>;
  return <section className="spend-explorer spend-explorer--table" data-spend-explorer="table">
    <ControlWorkbenchHeader eyebrow="Opportunity intelligence" title="Opportunity Workbench" summary="Review the best-fit opportunities, inspect evidence, and move promising work into action." meta={<span className="spend-explorer__snapshot"><strong>{tableRows.length.toLocaleString()} {tableFilters.disposition === "tombstoned" ? "hidden" : "active"}</strong><span>{Number(awards?.length || 0).toLocaleString()} awards · Data through {dataset.metadata?.asOf || "current snapshot"}</span></span>} tabs={tabs} />
    <ControlPageBody compact>
      {strategyScope ? <div className="if-alert if-alert--info spend-explorer__strategy-scope" role="status"><span><strong>Strategic matrix scope</strong>Showing {strategyScope.label} opportunities from the current Ansoff baseline.</span><button type="button" className="if-button if-button--secondary" onClick={() => { setStrategyScope(null); window.sessionStorage.removeItem(STRATEGY_SCOPE_KEY); updateRoute("table", { strategyScope: "" }); }}>Clear scope</button></div> : null}
      {tableFilters.changes === "today" ? <div className="if-alert if-alert--info spend-explorer__change-scope" role="status"><span><strong>Complete daily update ledger</strong>Showing every retained record changed on {date(latestFeedDate)}.</span><button type="button" className="if-button if-button--secondary" onClick={() => setTableFilter("changes", "all")}>Show all records</button></div> : null}
      {dispositions.error ? <p className="if-alert if-alert--warning" role="status">{dispositions.error}</p> : null}
      <OperationalDataTable id="opportunity-workbench-v1" label="Opportunity workbench" rows={tableRows} columns={tableColumns} rowKey={(record) => record.opportunityId || record.id || record.reference} defaultSort={{ key: "fit", direction: "desc" }} defaultPageSize={10} pageSizeOptions={[5, 10, 25, 50, 100]} defaultVisibleColumns={["record", "customer", "stage", "fit", "trust", "deadline", "obligations", "change", "source", "actions"]} queryValue={query} onQueryChange={(value) => { setQuery(value); setFocusedRecordId(""); updateRoute("table", { capQuery: value, capRecord: "" }); }} searchPlaceholder="Search opportunities, scope, customers, codes, and references…" exportFilename="opportunity-workbench.csv" showFacets={false} toolbarActions={<>{scopeFilters}{savedViews}</>} mobileColumns={tableFilters.changes === "today" ? ["record", "change", "fit", "actions"] : ["record", "customer", "fit", "deadline", "actions"]} highlightedRowId={focusedRecordId} initialExpandedId={focusedRecordId || null} expandedRowId={focusedRecordId || null} onRowActivate={(record, expanded) => { const id = expanded ? record.opportunityId || record.id || record.reference : ""; setFocusedRecordId(id); updateRoute("table", { capRecord: id }); }} renderDetail={(record) => <OpportunityWorkbenchDetail record={record} records={rows} />} detailLabel="Review opportunity" detailCloseLabel="Close workspace" bulkActions={dispositions.canWrite ? (selectedRows, clear) => <button type="button" className="if-btn if-btn--secondary" onClick={() => { selectedRows.forEach((record) => tableFilters.disposition === "tombstoned" ? dispositions.restore(record.opportunityId) : dispositions.tombstone(record.opportunityId)); clear(); }}>{tableFilters.disposition === "tombstoned" ? <ArchiveRestore size={15} /> : <ArchiveX size={15} />}{tableFilters.disposition === "tombstoned" ? "Restore selected" : "Hide selected"}</button> : null} empty={tableFilters.disposition === "tombstoned" ? "No hidden records. Records you remove from the active queue remain recoverable here." : "No active opportunities match the current workbench controls."} />
    </ControlPageBody>
  </section>;
}
