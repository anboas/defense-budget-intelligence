import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { ToastProvider } from "control-surface-ui/react";
import "./control-surface.css";
import {
  BarChart3,
  ArrowRight,
  Bookmark,
  BrainCircuit,
  Building2,
  CalendarClock,
  Copy,
  Database,
  Download,
  ExternalLink,
  FileText,
  FileSpreadsheet,
  Filter,
  GitBranch,
  Layers,
  Lightbulb,
  ListChecks,
  Network,
  RefreshCcw,
  RotateCcw,
  Search,
  Star,
  TrendingUp,
  X,
} from "lucide-react";
import sourceHealth from "./data/source-health.json";
import refreshDelta from "./data/refresh-delta.json";
import CaptureCalendar from "./CaptureCalendar.jsx";
import AuthProvider from "./AuthContext.jsx";
import NotificationProvider from "./NotificationContext.jsx";
import ProductMark from "./ProductMark.jsx";
import SiteHeader from "./SiteHeader.jsx";
import ProfilePage from "./ProfilePage.jsx";
import OperationalDataTable from "./OperationalDataTable.jsx";
import ControlSelect from "./ControlSelect.jsx";
import "./styles.generated.css";

const TransactionAnalytics = lazy(() => import("./TransactionAnalytics.jsx"));
const OperationsHub = lazy(() => import("./OperationsHub.jsx"));

const TABS = [
  { id: "overview", label: "PDB Request", icon: FileSpreadsheet, stage: "Request" },
  { id: "trends", label: "Request History", icon: TrendingUp, stage: "History" },
  { id: "lifecycle", label: "Account Flow", icon: Network, stage: "Accounts" },
  { id: "awards", label: "Awards", icon: FileSpreadsheet },
  { id: "calendar", label: "Transactions", icon: CalendarClock },
  { id: "wallboard", label: "Wallboard", icon: Star },
  { id: "analytics", label: "Analytics", icon: BarChart3 },
  { id: "watchlist", label: "Watchlist", icon: Star },
  { id: "events", label: "Events", icon: CalendarClock },
  { id: "integrations", label: "Integrations", icon: Database },
  { id: "activity", label: "API Log", icon: ListChecks },
  { id: "users", label: "Users", icon: Building2 },
  { id: "workspaces", label: "Workspaces", icon: Building2 },
  { id: "workspace-settings", label: "Workspace Settings", icon: Building2 },
  { id: "sources", label: "Source Lineage", icon: Database },
  { id: "profile", label: "Profile", icon: Building2 },
  { id: "security", label: "Security", icon: Building2 },
  { id: "personal-ai", label: "OpenAI Keys", icon: BrainCircuit },
  { id: "agents", label: "Agent Access", icon: BrainCircuit },
];

const HASH_ROUTES = {
  overview: "#/budget-spend",
  lifecycle: "#/budget-spend/lifecycle",
  trends: "#/budget-spend/trends",
  awards: "#/budget-spend/awards",
  calendar: "#/budget-spend/transactions",
  wallboard: "#/budget-spend/wallboard",
  analytics: "#/budget-spend/analytics",
  watchlist: "#/budget-spend/watchlist",
  events: "#/budget-spend/events",
  integrations: "#/budget-spend/integrations",
  activity: "#/budget-spend/api-log",
  users: "#/budget-spend/users",
  workspaces: "#/budget-spend/workspaces",
  "workspace-settings": "#/budget-spend/workspace",
  sources: "#/budget-spend/sources",
  profile: "#/profile",
  security: "#/profile/security",
  "personal-ai": "#/profile/openai",
  agents: "#/budget-spend/agents",
};

const LEGACY_ROUTE_TABS = {
  "#/budget-spend/strategy": "overview",
  "#/budget-spend/briefs": "overview",
  "#/budget-spend/visuals": "analytics",
  "#/budget-spend/hypotheses": "overview",
  "#/budget-spend/accounts": "lifecycle",
  "#/budget-spend/fit": "overview",
  "#/budget-spend/relationships": "awards",
  "#/budget-spend/pursuits": "calendar",
  "#/budget-spend/capture-calendar": "calendar",
  "#/budget-spend/queue": "calendar",
  "#/budget-spend/services": "overview",
  "#/budget-spend/fourth-estate": "overview",
  "#/budget-spend/ai-autonomy": "overview",
  "#/budget-spend/drilldown": "overview",
  "#/budget-spend/changes": "sources",
  "#/budget-spend/operations": "watchlist",
  "#/profile/agents": "agents",
  "#/profile/activity": "activity",
};

function tabFromHash(hash = "") {
  const normalized = hash || HASH_ROUTES.calendar;
  const routePath = normalized.split("?")[0];
  return Object.entries(HASH_ROUTES).find(([, route]) => route === routePath)?.[0] || LEGACY_ROUTE_TABS[routePath] || "calendar";
}

function hashParams() {
  if (typeof window === "undefined") return new URLSearchParams();
  return new URLSearchParams(window.location.hash.split("?")[1] || "");
}

function normalizeState(candidate, defaults, validators = {}) {
  return Object.fromEntries(Object.entries(defaults).map(([key, fallback]) => {
    const value = candidate[key] ?? fallback;
    const validator = validators[key];
    if (!validator) return [key, value];
    const valid = typeof validator === "function" ? validator(value) : validator.includes(value);
    return [key, valid ? value : fallback];
  }));
}

function stateFromHash(defaults, validators = {}) {
  const params = hashParams();
  return normalizeState(
    Object.fromEntries(Object.entries(defaults).map(([key, fallback]) => [key, params.get(key) ?? fallback])),
    defaults,
    validators,
  );
}

function replaceHashState(nextState, defaults) {
  const route = (window.location.hash || HASH_ROUTES.calendar).split("?")[0];
  const params = hashParams();
  for (const [key, value] of Object.entries(nextState)) {
    if (value === defaults[key] || value === "" || value == null) params.delete(key);
    else params.set(key, value);
  }
  const query = params.toString();
  window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}${route}${query ? `?${query}` : ""}`);
}

function useUrlState(defaults, validators = {}) {
  const [stableDefaults] = useState(defaults);
  const [stableValidators] = useState(validators);
  const [state, setState] = useState(() => stateFromHash(defaults, validators));

  useEffect(() => {
    const sync = () => {
      const raw = Object.fromEntries(Object.entries(stableDefaults).map(([key, fallback]) => [key, hashParams().get(key) ?? fallback]));
      const normalized = normalizeState(raw, stableDefaults, stableValidators);
      setState(normalized);
      if (Object.keys(stableDefaults).some((key) => raw[key] !== normalized[key])) {
        replaceHashState(normalized, stableDefaults);
      }
    };
    sync();
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, [stableDefaults, stableValidators]);

  function update(next) {
    setState((current) => {
      const resolved = normalizeState(typeof next === "function" ? next(current) : next, stableDefaults, stableValidators);
      replaceHashState(resolved, stableDefaults);
      return resolved;
    });
  }

  return [state, update];
}

function useUrlSelection(defaultValue, validValues = []) {
  const [selection, setSelection] = useUrlState(
    { selected: defaultValue },
    { selected: (value) => validValues.includes(value) },
  );
  return [selection.selected, (selected) => setSelection({ selected })];
}

function useBudgetRoute() {
  const [activeTab, setActiveTab] = useState(() => tabFromHash(typeof window === "undefined" ? "" : window.location.hash));

  useEffect(() => {
    function handleRouteChange() {
      const nextTab = tabFromHash(window.location.hash);
      const routePath = (window.location.hash || HASH_ROUTES.calendar).split("?")[0];
      const knownRoute = Object.values(HASH_ROUTES).includes(routePath);
      if (!window.location.hash) {
        window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}${HASH_ROUTES.calendar}`);
      }
      if (LEGACY_ROUTE_TABS[routePath] || (!knownRoute && routePath)) {
        window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}${HASH_ROUTES[nextTab]}`);
      }
      setActiveTab(nextTab);
    }
    handleRouteChange();
    window.addEventListener("hashchange", handleRouteChange);
    window.addEventListener("popstate", handleRouteChange);
    return () => {
      window.removeEventListener("hashchange", handleRouteChange);
      window.removeEventListener("popstate", handleRouteChange);
    };
  }, []);

  function openTab(tabId) {
    const route = HASH_ROUTES[tabId] || HASH_ROUTES.overview;
    if (window.location.hash === route) {
      setActiveTab(tabId);
      return;
    }
    window.location.hash = route;
  }

  return [activeTab, openTab];
}

function csvCell(value) {
  const normalized = value && typeof value === "object" ? JSON.stringify(value) : String(value ?? "");
  return `"${normalized.replace(/"/g, '""')}"`;
}

function sourceUrlForRow(row) {
  if (row?.justificationEvidence?.sourcePdfUrl || row?.justificationEvidence?.sourceUrl) {
    return row.justificationEvidence.sourcePdfUrl || row.justificationEvidence.sourceUrl;
  }
  if (row?.bookId) return BOOKS.find((book) => book.id === row.bookId)?.sourceUrl || "";
  if (row?.id?.startsWith("CONT_AWD_") || row?.awardId) {
    return row.id ? `https://www.usaspending.gov/award/${encodeURIComponent(row.id)}/latest` : "https://www.usaspending.gov/";
  }
  return DATA_INVENTORY.sourcePackageUrl || "";
}

function EvidenceDrawer({ record, onClose }) {
  if (!record) return null;
  const book = record.bookId ? BOOKS.find((item) => item.id === record.bookId) : null;
  const isAward = Boolean(record.awardId || record.id?.startsWith("CONT_AWD_"));
  const sourceUrl = sourceUrlForRow(record);
  const evidence = record.justificationEvidence;
  const title = record.lineTitle || record.accountTitle || record.awardId || record.recipient || record.id;
  return (
    <div
      className="evidence-drawer-backdrop"
      onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}
    >
      <aside
        className="evidence-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="evidence-drawer-title"
        onKeyDown={(event) => { if (event.key === "Escape") onClose(); }}
        data-evidence-drawer
      >
        <header>
          <div>
            <span>{isAward ? "Award evidence" : "Budget evidence"}</span>
            <h2 id="evidence-drawer-title">{title}</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Close evidence details" autoFocus><X size={18} aria-hidden="true" /></button>
        </header>
        <dl>
          <div><dt>Record ID</dt><dd>{record.awardId || record.id}</dd></div>
          <div><dt>Source system</dt><dd>{isAward ? "USAspending award snapshot" : evidence?.kind || `${book?.short || record.bookId} official display workbook`}</dd></div>
          <div><dt>Snapshot</dt><dd>{dateTime(isAward ? EXECUTION_COVERAGE.cachedAt : data.metadata.generatedAt)}</dd></div>
          {!isAward ? <div><dt>Workbook</dt><dd>{book?.label || book?.color || record.bookId}</dd></div> : null}
          {evidence?.sourceDocument || evidence?.sourceName ? <div><dt>Narrative source</dt><dd>{evidence.sourceDocument || evidence.sourceName}</dd></div> : null}
          {evidence?.page || evidence?.lineNumber ? <div><dt>Evidence location</dt><dd>{evidence.page ? `Page ${evidence.page}` : `Line ${evidence.lineNumber}`}</dd></div> : null}
          <div><dt>Method</dt><dd>{isAward ? EXECUTION_COVERAGE.methodology || "Cached USAspending award search with deterministic deduplication." : data.metadata.methodology}</dd></div>
        </dl>
        <a className="evidence-drawer__source" href={sourceUrl} target="_blank" rel="noreferrer" data-evidence-source>
          Open official source <ExternalLink size={14} aria-hidden="true" />
        </a>
      </aside>
    </div>
  );
}

function auditedRows(rows) {
  const viewUrl = window.location.href;
  return (rows || []).map((row) => ({
    _snapshot_generated_at: data.metadata.generatedAt,
    _exported_at: new Date().toISOString(),
    _view_url: viewUrl,
    _source_url: sourceUrlForRow(row),
    ...row,
  }));
}

function downloadRows(rows, filename, format) {
  const safeRows = rows || [];
  const exportRows = auditedRows(safeRows);
  let body;
  let type;
  if (format === "json") {
    body = JSON.stringify({
      metadata: {
        exportedAt: new Date().toISOString(),
        snapshotGeneratedAt: data.metadata.generatedAt,
        viewUrl: window.location.href,
        methodology: data.metadata.methodology,
        rowCount: safeRows.length,
      },
      rows: exportRows,
    }, null, 2);
    type = "application/json";
  } else {
    const columns = [...new Set(exportRows.flatMap((row) => Object.keys(row || {})))];
    body = [columns.map(csvCell).join(","), ...exportRows.map((row) => columns.map((column) => csvCell(row?.[column])).join(","))].join("\n");
    type = "text/csv";
  }
  const url = URL.createObjectURL(new Blob([body], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `${filename}.${format}`;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 60000);
}

async function copyText(value) {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(value);
  const field = document.createElement("textarea");
  field.value = value;
  field.style.position = "fixed";
  field.style.opacity = "0";
  document.body.append(field);
  field.select();
  document.execCommand("copy");
  field.remove();
}

function AnalysisActions({ rows = [], filename = "budget-analysis", copyValue = "", copyLabel = "Copy view" }) {
  const [message, setMessage] = useState("");
  const [watchedUrls, setWatchedUrls] = useState(() => JSON.parse(localStorage.getItem("budget-intelligence-watches") || "[]").map((watch) => watch.url));
  const watched = watchedUrls.includes(window.location.href);
  async function handleCopy() {
    await copyText(copyValue || window.location.href);
    setMessage("Copied");
    window.setTimeout(() => setMessage(""), 1600);
  }
  function handleWatch() {
    const watches = JSON.parse(localStorage.getItem("budget-intelligence-watches") || "[]");
    const currentUrl = window.location.href;
    const next = watched
      ? watches.filter((watch) => watch.url !== currentUrl)
      : [...watches.filter((watch) => watch.url !== currentUrl), { url: currentUrl, label: document.title.split(" · ")[0], createdAt: new Date().toISOString() }].slice(-12);
    localStorage.setItem("budget-intelligence-watches", JSON.stringify(next));
    setWatchedUrls(next.map((watch) => watch.url));
    setMessage(watched ? "Saved view removed" : "View saved");
    window.setTimeout(() => setMessage(""), 1600);
  }
  return (
    <div className="analysis-actions" data-analysis-actions>
      <button type="button" onClick={handleCopy}><Copy size={14} aria-hidden="true" />{copyLabel}</button>
      <button type="button" onClick={handleWatch} aria-pressed={watched}><Bookmark size={14} aria-hidden="true" />{watched ? "Saved" : "Save view"}</button>
      <button type="button" onClick={() => downloadRows(rows, filename, "csv")} disabled={!rows.length}><Download size={14} aria-hidden="true" />CSV</button>
      <button type="button" onClick={() => downloadRows(rows, filename, "json")} disabled={!rows.length}><Download size={14} aria-hidden="true" />JSON</button>
      <span role="status" aria-live="polite">{message}</span>
    </div>
  );
}

function MobileDisclosure({ expanded, onToggle, label }) {
  return (
    <button
      type="button"
      className="mobile-disclosure-toggle"
      aria-expanded={expanded}
      onClick={() => onToggle(!expanded)}
    >
      {expanded ? `Show less ${label}` : `Show full ${label}`}
    </button>
  );
}

const BOOK_COLORS = {
  "M-1": "#005ea2",
  "O-1": "#216e1f",
  "P-1": "#9d2b22",
  "R-1": "#5c4b8a",
  "RF-1": "#08737a",
  "C-1": "#b65c00",
};

const GROUP_LABELS = {
  service: "Services",
  "fourth-estate": "Fourth Estate",
  other: "Other / Reconciliation",
};

let data = null;
let BOOKS = [];
let SIGNALS = [];
let DATA_INVENTORY = {};
let REQUEST_HISTORY = [];
let TREND_SUMMARY = {};
let ANALYTICS = {};
let STRATEGY = {};
let JUSTIFICATION_COVERAGE = {};
let EXECUTION = {};
let EXECUTION_COVERAGE = {};
let AWARD_DRILLDOWN = { summary: {}, awards: [], byBuyer: [], byVendor: [], byPsc: [], byNaics: [], byTechnologyArea: [] };
let PURSUIT_TIMING = { summary: {}, lanes: [], recompeteCandidates: [], byContractType: [], byBuyer: [], byVendor: [] };
let CAPTURE_QUEUE = { summary: {}, stageCounts: [], items: [] };
let ACCOUNT_PLANS = { summary: {}, items: [] };
let CAPABILITY_FIT = { summary: {}, items: [] };
let DECISION_BRIEFS = { summary: {}, items: [] };
let VISUAL_ANALYTICS = { summary: {}, clusters: [], timingBands: [], heatmapColumns: [], heatmapRows: [] };
let HYPOTHESES = { summary: {}, items: [] };
let executionReady = false;
let coreReady = false;
let ACCOUNT_SPINE = null;
let accountSpineReady = false;
let CAPTURE_CALENDAR = null;
let SAM_OPPORTUNITIES = { metadata: { status: "unavailable", recordCount: 0 }, records: [] };
let MANUAL_PROCUREMENT = { metadata: { recordCount: 0 }, records: [] };
let PROCUREMENT_DELTA = { metadata: { status: "baseline" }, summary: { added: 0, updated: 0, removed: 0 }, records: [] };
let USASPENDING_SUBAWARDS = { metadata: { status: "unavailable", reportedSubawardCount: 0 }, primes: [] };
let captureCalendarReady = false;

const ADMINISTRATION_TAB_IDS = new Set(["watchlist", "events", "integrations", "activity", "users", "workspaces", "workspace-settings", "agents"]);
const OPERATIONS_TAB_IDS = new Set(["wallboard", ...ADMINISTRATION_TAB_IDS]);
const PROFILE_TAB_IDS = new Set(["profile", "security", "personal-ai"]);
const CORE_TAB_IDS = new Set(["overview", "trends", "lifecycle", "sources"]);
const EXECUTION_TAB_IDS = new Set(["awards", "calendar", "analytics", ...OPERATIONS_TAB_IDS]);

function hydrateCore(nextData) {
  data = nextData;
  BOOKS = data.metadata.sources || [];
  SIGNALS = data.signals || [];
  DATA_INVENTORY = data.metadata.dataInventory || {};
  REQUEST_HISTORY = DATA_INVENTORY.requestHistory || [];
  TREND_SUMMARY = DATA_INVENTORY.trendSummary || {};
  ANALYTICS = DATA_INVENTORY.analyticsReadouts || {};
  JUSTIFICATION_COVERAGE = DATA_INVENTORY.justificationCoverage || {};
  EXECUTION_COVERAGE = DATA_INVENTORY.executionCoverage || {};
  coreReady = true;
}

function hydrateManifest(nextManifest) {
  data = {
    metadata: {
      generatedAt: nextManifest.metadata?.generatedAt || "",
      methodology: nextManifest.metadata?.methodology || "",
      recordCount: Number(nextManifest.metadata?.recordCount || 0),
      sources: [],
      dataInventory: {},
    },
    signals: [],
    records: [],
  };
}

function hydrateExecution(nextExecution) {
  EXECUTION = nextExecution || {};
  EXECUTION_COVERAGE = DATA_INVENTORY.executionCoverage || EXECUTION.coverage || {};
  AWARD_DRILLDOWN = EXECUTION.awardDrilldown || AWARD_DRILLDOWN;
  executionReady = true;
}

function runtimeDataUrl(filename) {
  return `${import.meta.env.BASE_URL}data/${filename}`;
}

async function fetchRuntimeData(filename) {
  const response = await fetch(runtimeDataUrl(filename));
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.json();
}

let corePromise = null;
function ensureCoreData() {
  if (coreReady) return Promise.resolve();
  if (!corePromise) corePromise = fetchRuntimeData("budget-core.json").then(hydrateCore);
  return corePromise;
}

let executionPromise = null;
function ensureExecutionData() {
  if (executionReady) return Promise.resolve();
  if (!executionPromise) executionPromise = fetchRuntimeData("budget-execution.json").then(hydrateExecution);
  return executionPromise;
}

let accountSpinePromise = null;
function ensureAccountSpineData() {
  if (accountSpineReady) return Promise.resolve();
  if (!accountSpinePromise) {
    accountSpinePromise = fetchRuntimeData("account-spine.json").then((payload) => {
      ACCOUNT_SPINE = payload;
      accountSpineReady = true;
    });
  }
  return accountSpinePromise;
}

let captureCalendarPromise = null;
function ensureCaptureCalendarData() {
  if (captureCalendarReady) return Promise.resolve();
  if (!captureCalendarPromise) {
    captureCalendarPromise = Promise.all([
      fetchRuntimeData("capture-calendar.json"),
      fetchRuntimeData("sam-opportunities.json").catch(() => SAM_OPPORTUNITIES),
      fetchRuntimeData("manual-procurement.json").catch(() => MANUAL_PROCUREMENT),
      fetchRuntimeData("procurement-delta.json").catch(() => PROCUREMENT_DELTA),
      fetchRuntimeData("usaspending-subawards.json").catch(() => USASPENDING_SUBAWARDS),
    ]).then(([capturePayload, samPayload, manualPayload, deltaPayload, subawardPayload]) => {
      CAPTURE_CALENDAR = capturePayload;
      SAM_OPPORTUNITIES = samPayload;
      MANUAL_PROCUREMENT = manualPayload;
      PROCUREMENT_DELTA = deltaPayload;
      USASPENDING_SUBAWARDS = subawardPayload;
      captureCalendarReady = true;
    });
  }
  return captureCalendarPromise;
}
const EMPTY_ROWS = Object.freeze([]);

function money(value, digits = 1) {
  const number = Number(value || 0);
  if (number > 0 && Math.abs(number) < 0.1) return `$${(number * 1000).toFixed(0)}M`;
  return `$${number.toFixed(digits)}B`;
}

function federalMoney(value, digits = 1) {
  return money(Number(value || 0) / 1_000_000_000, digits);
}

function fileSize(bytes) {
  const size = Number(bytes || 0);
  if (size > 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.max(size / 1024, 1).toFixed(0)} KB`;
}

function dateTime(value) {
  return new Date(value).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function yearList(years = []) {
  return years.map((year) => `FY${year}`).join(", ");
}

function pct(value, digits = 1) {
  const number = Number(value || 0);
  return `${number > 0 ? "+" : ""}${number.toFixed(digits)}%`;
}

function percent(value, digits = 0) {
  return `${Number(value || 0).toFixed(digits)}%`;
}

function displayValue(item) {
  if (item.display === "money") return money(item.value);
  if (item.display === "percent") return pct(item.value);
  return item.value;
}

function growth(row) {
  if (!row?.fy2025) return row?.fy2027 ? 100 : 0;
  return ((row.fy2027 - row.fy2025) / row.fy2025) * 100;
}

function requestGrowth(current, prior) {
  if (!prior) return current ? 100 : 0;
  return ((current - prior) / prior) * 100;
}

function sum(rows, key) {
  return rows.reduce((total, row) => total + Number(row[key] || 0), 0);
}

function aggregate(records, keyFn) {
  const groups = new Map();
  for (const record of records) {
    const key = keyFn(record);
    const existing = groups.get(key.id) || { ...key, fy2025: 0, fy2026: 0, fy2027: 0, records: 0 };
    existing.fy2025 += record.fy2025;
    existing.fy2026 += record.fy2026;
    existing.fy2027 += record.fy2027;
    existing.records += 1;
    groups.set(key.id, existing);
  }
  return [...groups.values()].sort((a, b) => b.fy2027 - a.fy2027);
}

function Bar({ value, max, color, label }) {
  return (
    <span className="bar-track" aria-label={label}>
      <i style={{ width: `${Math.max((value / Math.max(max, 1)) * 100, value ? 1 : 0)}%`, background: color }} />
    </span>
  );
}

function Spark({ row }) {
  const values = [row.fy2025 || 0, row.fy2026 || 0, row.fy2027 || 0];
  const max = Math.max(...values, 1);
  return (
    <span className="spark" aria-label="FY2025 to FY2027 trend">
      {values.map((value, index) => (
        <i key={index} style={{ height: `${Math.max((value / max) * 100, value ? 8 : 2)}%` }} />
      ))}
    </span>
  );
}

function Metric({ label, value, helper, tone = "blue" }) {
  return (
    <article className={`if-card if-metric if-operations-signal metric metric--${tone}`} data-budget-metric={label}>
      <span>{label}</span>
      <strong>{value}</strong>
      <p>{helper}</p>
    </article>
  );
}

function PhaseIntro({ eyebrow, description, facts = [], tone = "blue", dataAttribute = {} }) {
  return (
    <section className={`phase-intro phase-intro--${tone}${facts.length ? " phase-intro--with-facts" : ""}`} {...dataAttribute}>
      <div className="phase-intro__copy">
        <span>{eyebrow}</span>
        <p>{description}</p>
      </div>
      {facts.length ? (
        <div className="phase-intro__facts" aria-label={`${eyebrow} coverage`}>
          {facts.map((fact) => (
            <article key={fact.label}>
              <strong>{fact.value}</strong>
              <span>{fact.label}</span>
            </article>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function Section({ title, meta, children, icon: Icon }) {
  return (
    <section className="if-panel panel">
      <header className="if-panel__header panel__header">
        <div className="if-section-heading">
          {Icon ? <Icon className="if-section-heading__icon" size={16} aria-hidden="true" /> : null}
          <h2 className="if-panel__title">{title}</h2>
        </div>
        {meta ? <span>{meta}</span> : null}
      </header>
      {children}
    </section>
  );
}

function AnalyticsReadout({ title = "Analytic Readout", meta = "generated from source data", items = [], icon = TrendingUp }) {
  if (!items.length) return null;
  return (
    <Section title={title} meta={meta} icon={icon}>
      <div className="analytics-readout" data-analytics-readout>
        {items.map((item) => (
          <article key={item.id} className={`analytic-card analytic-card--${item.tone || "blue"}`}>
            <span>{item.label}</span>
            <strong>{displayValue(item)}</strong>
            <p>{item.helper}</p>
          </article>
        ))}
      </div>
    </Section>
  );
}

function ExecutionTrendList({ title, rows = [], periods = [], limit = 5 }) {
  const visibleRows = rows.slice(0, limit);
  if (!visibleRows.length) return null;
  const maxAmount = Math.max(...visibleRows.flatMap((row) => (row.periods || []).map((period) => period.awardAmount || 0)), 1);
  const visiblePeriods = periods.slice(-6);
  return (
    <article className="execution-trend-card">
      <header>
        <span>{title}</span>
        <b>{visiblePeriods[0]?.label || "n/a"} to {visiblePeriods.at(-1)?.label || "n/a"}</b>
      </header>
      <div className="execution-trend-list">
        {visibleRows.map((row) => (
          <div key={row.id} className="execution-trend-row">
            <div>
              <strong>{row.label}</strong>
              <span>{row.awards} source awards · {money(row.latestAmount || row.awardAmount)} latest · {pct(row.latestChange || 0)}</span>
            </div>
            <div className="execution-period-bars" aria-label={`${row.label} execution trend`}>
              {visiblePeriods.map((period) => {
                const point = (row.periods || []).find((item) => item.id === period.id);
                const value = point?.awardAmount || 0;
                return (
                  <i key={`${row.id}-${period.id}`} title={`${period.label}: ${money(value)}`} style={{ height: `${Math.max((value / maxAmount) * 100, value ? 8 : 2)}%` }} />
                );
              })}
            </div>
            <b>{money(row.awardAmount)}</b>
          </div>
        ))}
      </div>
    </article>
  );
}

function relationshipOptionRows() {
  const laneOptions = (CAPTURE_QUEUE.items || []).slice(0, 16).map((item) => ({
    id: `lane:${item.id}`,
    type: "lane",
    label: `${item.buyer} / ${item.area}`,
    meta: `${item.stageLabel} · ${item.workType?.label || "Uncoded work type"}`,
    item,
  }));
  const areaOptions = (STRATEGY.technologyAreas || []).map((area) => ({
    id: `area:${area.id}`,
    type: "area",
    label: area.label,
    meta: `${money(area.fy2027)} request · ${area.executionAwards || 0} awards`,
    area,
  }));
  const buyerOptions = (AWARD_DRILLDOWN.byBuyer || []).slice(0, 16).map((buyer) => ({
    id: `buyer:${buyer.id}`,
    type: "buyer",
    label: buyer.label,
    meta: `${money(buyer.awardAmount)} · ${buyer.awards} awards`,
    buyer,
  }));
  const vendorOptions = (AWARD_DRILLDOWN.byVendor || []).slice(0, 16).map((vendor) => ({
    id: `vendor:${vendor.id}`,
    type: "vendor",
    label: vendor.label,
    meta: `${money(vendor.awardAmount)} · ${vendor.awards} awards`,
    vendor,
  }));
  const workOptions = [...(AWARD_DRILLDOWN.byPsc || []).slice(0, 10), ...(AWARD_DRILLDOWN.byNaics || []).slice(0, 10)].map((work) => ({
    id: `work:${work.id}`,
    type: "work",
    label: work.label,
    meta: `${money(work.awardAmount)} · ${work.awards} awards`,
    work,
  }));
  return [...laneOptions, ...areaOptions, ...buyerOptions, ...vendorOptions, ...workOptions];
}

function matchesWorkType(award, workId = "") {
  if (!workId) return false;
  return award.pscCode === workId || award.naicsCode === workId || award.workType?.id === workId;
}

function relationshipAwards(option) {
  const awards = AWARD_DRILLDOWN.awards || EMPTY_ROWS;
  if (!option) return EMPTY_ROWS;
  if (option.type === "lane") {
    const item = option.item;
    return awards.filter((award) => (
      award.buyerSubAgency === item.buyer
      && (award.areaIds || [award.areaId]).includes(item.areaId)
      && (!item.workType?.code || matchesWorkType(award, item.workType.code))
    ));
  }
  if (option.type === "area") return awards.filter((award) => (award.areaIds || [award.areaId]).includes(option.area.id));
  if (option.type === "buyer") return awards.filter((award) => award.buyerSubAgency === option.buyer.label);
  if (option.type === "vendor") return awards.filter((award) => award.recipient === option.vendor.label);
  if (option.type === "work") return awards.filter((award) => matchesWorkType(award, option.work.id));
  return EMPTY_ROWS;
}

function budgetLinesForRelationship(option, awards) {
  const areas = STRATEGY.technologyAreas || [];
  if (option?.type === "area") return option.area.topLines || EMPTY_ROWS;
  if (option?.type === "lane") return areas.find((area) => area.id === option.item.areaId)?.topLines || EMPTY_ROWS;
  const awardAreaIds = [...new Set(awards.flatMap((award) => award.areaIds || [award.areaId]).filter(Boolean))];
  return awardAreaIds
    .flatMap((areaId) => areas.find((area) => area.id === areaId)?.topLines || [])
    .sort((a, b) => b.fy2027 - a.fy2027)
    .slice(0, 8);
}

function relatedQueueItemsForRelationship(option, awards) {
  const queueItems = CAPTURE_QUEUE.items || EMPTY_ROWS;
  if (option?.type === "lane") {
    return [
      option.item,
      ...queueItems.filter((item) => item.id !== option.item.id && (item.buyer === option.item.buyer || item.areaId === option.item.areaId)),
    ].slice(0, 6);
  }
  const areaIds = new Set(awards.flatMap((award) => award.areaIds || [award.areaId]).filter(Boolean));
  const buyers = new Set(awards.map((award) => award.buyerSubAgency).filter(Boolean));
  const vendors = new Set(awards.map((award) => award.recipient).filter(Boolean));
  return queueItems.filter((item) => (
    areaIds.has(item.areaId)
    || buyers.has(item.buyer)
    || vendors.has(item.topIncumbent)
    || (option?.type === "work" && item.workType?.code === option.work.id)
  )).slice(0, 6);
}

// Retained temporarily for source-history comparison; the analytics shell does not route here.
// eslint-disable-next-line no-unused-vars
function RelationshipMap() {
  const options = useMemo(() => relationshipOptionRows(), []);
  const [selectedId, setSelectedId] = useUrlSelection(options[0]?.id || "", options.map((option) => option.id));
  const selected = options.find((option) => option.id === selectedId) || options[0];
  const awards = useMemo(() => relationshipAwards(selected).sort((a, b) => b.awardAmount - a.awardAmount).slice(0, 80), [selected]);
  const budgetLines = useMemo(() => budgetLinesForRelationship(selected, awards), [selected, awards]);
  const queueItems = useMemo(() => relatedQueueItemsForRelationship(selected, awards), [selected, awards]);
  const buyers = useMemo(() => aggregateAwardsForUi(awards, (award) => ({ id: award.buyerSubAgency, label: award.buyerSubAgency })).slice(0, 5), [awards]);
  const vendors = useMemo(() => aggregateAwardsForUi(awards, (award) => ({ id: award.recipient, label: award.recipient })).slice(0, 5), [awards]);
  const workTypes = useMemo(() => aggregateAwardsForUi(awards.filter((award) => award.pscCode || award.naicsCode), (award) => ({
    id: award.pscCode || award.naicsCode,
    label: award.pscCode ? `${award.pscCode} · ${award.pscDescription || "Unlabeled PSC"}` : `${award.naicsCode} · ${award.naicsDescription || "Unlabeled NAICS"}`,
  })).slice(0, 5), [awards]);
  const areas = useMemo(() => aggregateAwardsForUi(awards, (award) => ({ id: award.areaId, label: award.area })).slice(0, 5), [awards]);
  const selectedArea = selected?.type === "area"
    ? selected.area
    : STRATEGY.technologyAreas?.find((area) => area.id === selected?.item?.areaId || area.id === awards[0]?.areaId);
  const selectedQueue = selected?.type === "lane" ? selected.item : queueItems[0];
  const optionGroups = [
    ["lane", "Lanes"],
    ["area", "Technology Areas"],
    ["buyer", "Buyers"],
    ["vendor", "Vendors"],
    ["work", "Work Types"],
  ];

  return (
    <div className="grid relationship-page" data-relationship-page>
      <section className="relationship-hero">
        <div>
          <span>Relationship surface</span>
          <h2>Entity Relationship Map</h2>
          <p>Pick a lane, technology area, buyer, vendor, or work type and see the connected budget lines, execution awards, incumbents, timing actions, and evidence in one place.</p>
        </div>
        <div className="relationship-hero__facts" aria-label="Relationship summary">
          <article>
            <strong>{options.length}</strong>
            <span>selectable entities</span>
          </article>
          <article>
            <strong>{awards.length.toLocaleString()}</strong>
            <span>connected awards</span>
          </article>
          <article>
            <strong>{money(sum(awards, "awardAmount"))}</strong>
            <span>connected award value</span>
          </article>
          <article>
            <strong>{queueItems.length}</strong>
            <span>linked pursuit actions</span>
          </article>
        </div>
      </section>

      <div className="relationship-shell">
        <aside className="relationship-picker" data-relationship-picker>
          {optionGroups.map(([type, label]) => (
            <div key={type}>
              <h3>{label}</h3>
              {options.filter((option) => option.type === type).slice(0, type === "lane" ? 16 : 10).map((option) => (
                <button
                  key={option.id}
                  type="button"
                  className={selected?.id === option.id ? "active" : ""}
                  onClick={() => setSelectedId(option.id)}
                >
                  <strong>{option.label}</strong>
                  <span>{option.meta}</span>
                </button>
              ))}
            </div>
          ))}
        </aside>

        <div className="relationship-workspace">
          <Section title={selected?.label || "Selected Entity"} meta={selected?.meta} icon={Network}>
            <div className="relationship-brief" data-relationship-brief>
              <article>
                <span>Budget posture</span>
                <strong>{selectedArea ? money(selectedArea.fy2027) : budgetLines.length ? money(sum(budgetLines, "fy2027")) : "n/a"}</strong>
                <p>{selectedArea ? `${selectedArea.records.toLocaleString()} source lines · ${selectedArea.narrativeConfirmedRecords || 0} narrative-confirmed` : `${budgetLines.length} linked source lines`}</p>
              </article>
              <article>
                <span>Execution posture</span>
                <strong>{money(sum(awards, "awardAmount"))}</strong>
                <p>{awards.length.toLocaleString()} award records · {vendors[0]?.label || "no incumbent"} leads the connected execution view.</p>
              </article>
              <article>
                <span>Capture posture</span>
                <strong>{selectedQueue?.stageLabel || "Watch"}</strong>
                <p>{selectedQueue?.recommendedAction || "Validate buyer, office, vehicle, timing, and incumbent scope."}</p>
              </article>
            </div>
          </Section>

          <Section title="Connected Nodes" meta="budget, execution, and capture relationships" icon={GitBranch}>
            <div className="relationship-node-grid" data-relationship-nodes>
              <RelationshipNodeList title="Technology Areas" rows={areas} />
              <RelationshipNodeList title="Buyers" rows={buyers} />
              <RelationshipNodeList title="Incumbents" rows={vendors} />
              <RelationshipNodeList title="Work Types" rows={workTypes} />
              <RelationshipNodeList title="Pursuit Actions" rows={queueItems.map((item) => ({
                id: item.id,
                label: `${item.stageLabel} · ${item.buyer}`,
                awardAmount: item.nearTermAwardAmount,
                awards: item.nearTermAwards,
                helper: item.recommendedAction,
              }))} />
            </div>
          </Section>

          <div className="grid grid--sources">
            <Section title="Budget Lines" meta={`${budgetLines.length} linked source lines`} icon={FileText}>
              <div className="relationship-line-list" data-relationship-budget-lines>
                {budgetLines.slice(0, 8).map((line) => (
                  <article key={line.id}>
                    <div>
                      <strong>{line.title}</strong>
                      <span>{line.orgName} · {line.colorShort} · {line.justificationEvidence?.confidenceLabel || "Title-tagged only"}</span>
                    </div>
                    <b>{money(line.fy2027)}</b>
                  </article>
                ))}
              </div>
            </Section>

            <Section title="Award Evidence" meta={`${awards.length.toLocaleString()} connected records`} icon={FileSpreadsheet}>
              <div className="relationship-award-list" data-relationship-awards>
                {awards.slice(0, 8).map((award) => (
                  <article key={award.id}>
                    <div>
                      <strong>{award.awardId || award.id}</strong>
                      <span>{award.recipient} · {award.buyerSubAgency} · {award.endDate ? `ends ${award.endDate}` : "end unknown"}</span>
                    </div>
                    <b>{money(award.awardAmount)}</b>
                  </article>
                ))}
              </div>
            </Section>
          </div>
        </div>
      </div>
    </div>
  );
}

function RelationshipNodeList({ title, rows }) {
  return (
    <article className="relationship-node-list">
      <header>
        <span>{title}</span>
        <b>{rows.length}</b>
      </header>
      <div>
        {rows.slice(0, 5).map((row) => (
          <span key={row.id}>
            <strong>{row.label}</strong>
            <em>{row.helper || `${money(row.awardAmount || 0)} · ${row.awards || 0} awards`}</em>
          </span>
        ))}
      </div>
    </article>
  );
}

function LifecycleStage({ label, amount, maximum, source, relationship = "exact" }) {
  const width = maximum > 0 ? Math.max(2, (Number(amount || 0) / maximum) * 100) : 0;
  return (
    <article className="lifecycle-stage">
      <header>
        <div>
          <span>{label}</span>
          <em className={`evidence-class evidence-class--${relationship}`}>{relationship}</em>
        </div>
        <strong>{amount ? federalMoney(amount) : "Unavailable"}</strong>
      </header>
      <i aria-hidden="true"><b style={{ width: `${Math.min(width, 100)}%` }} /></i>
      <p>{source}</p>
    </article>
  );
}

function AccountLifecycle() {
  const accounts = ACCOUNT_SPINE?.accounts || EMPTY_ROWS;
  const awardFlows = ACCOUNT_SPINE?.awardFlows || EMPTY_ROWS;
  const awardCounts = useMemo(() => {
    const counts = new Map();
    for (const award of awardFlows) {
      for (const account of award.accounts || []) {
        counts.set(account.federalAccountCode, (counts.get(account.federalAccountCode) || 0) + 1);
      }
    }
    return counts;
  }, [awardFlows]);
  const complete = accounts.filter((account) => (
    account.requestMatch
    && account.exactApportionmentJoinCount > 0
    && (!awardCounts.size || awardCounts.has(account.federalAccountCode))
  ));
  const defaultAccount = complete[0] || accounts[0];
  const [selectedCode, setSelectedCode] = useUrlSelection(
    defaultAccount?.federalAccountCode || "",
    accounts.map((account) => account.federalAccountCode),
  );
  const selected = accounts.find((account) => account.federalAccountCode === selectedCode) || defaultAccount;
  const fiscalYear = ACCOUNT_SPINE?.metadata?.fiscalYear;
  const stages = selected ? [
    { label: "Requested", amount: selected.requestAmount, source: `FY${fiscalYear} President's Budget display books`, relationship: "derived" },
    { label: "Apportioned", amount: selected.apportionedAmount, source: `${selected.exactApportionmentJoinCount} exact OMB TAFS joins` },
    { label: "Obligated", amount: selected.obligatedAmount, source: "USAspending account execution" },
    { label: "Outlays", amount: selected.outlayedAmount, source: "USAspending account execution" },
  ] : [];
  const maximum = Math.max(...stages.map((stage) => stage.amount || 0), 1);
  const treasuryRows = (selected?.treasuryAccounts || [])
    .filter((row) => row.exactApportionmentJoin)
    .sort((left, right) => right.obligatedAmount - left.obligatedAmount)
    .slice(0, 10);
  const maxTreasury = Math.max(...treasuryRows.flatMap((row) => [
    row.apportionment?.approvedAmount || 0,
    row.obligatedAmount || 0,
    row.outlayedAmount || 0,
  ]), 1);
  const selectedAwardRows = awardFlows
    .flatMap((award) => (award.accounts || [])
      .filter((account) => account.federalAccountCode === selected?.federalAccountCode)
      .map((account) => ({ ...award, accountObligatedAmount: account.obligatedAmount })))
    .sort((left, right) => right.accountObligatedAmount - left.accountObligatedAmount)
    .slice(0, 10);
  const maxAwardObligation = Math.max(...selectedAwardRows.map((award) => award.accountObligatedAmount), 1);
  const burn = (ACCOUNT_SPINE?.agencyBurn?.agency_data_by_year || [])
    .find((row) => Number(row.fiscal_year) === Number(fiscalYear));
  const historyRows = (ACCOUNT_SPINE?.agencyBurn?.agency_data_by_year || [])
    .filter((row) => Number(row.fiscal_year) <= Number(fiscalYear))
    .sort((left, right) => Number(left.fiscal_year) - Number(right.fiscal_year))
    .slice(-5);
  const historyMaximum = Math.max(...historyRows.flatMap((row) => [
    Number(row.agency_budgetary_resources || 0),
    Number(row.agency_total_obligated || 0),
    Number(row.agency_total_outlayed || 0),
  ]), 1);
  const burnRows = burn?.agency_obligation_by_period || EMPTY_ROWS;
  const latestBurnIsPartial = burnRows.length > 1
    && Number(burnRows.at(-1)?.obligated || 0) < Math.max(...burnRows.slice(0, -1).map((row) => Number(row.obligated || 0)));
  const burnMaximum = Math.max(...burnRows.map((row) => Number(row.obligated || 0)), 1);
  const burnPoints = burnRows.map((row, index) => {
    const x = burnRows.length > 1 ? 24 + (index / (burnRows.length - 1)) * 552 : 24;
    const y = 176 - (Number(row.obligated || 0) / burnMaximum) * 140;
    return `${x},${y}`;
  }).join(" ");
  const coverage = ACCOUNT_SPINE?.metadata?.coverage || {};

  if (!selected) return <p className="empty-state">No account-spine data is available.</p>;

  return (
    <div className="grid lifecycle-page" data-account-spine-page>
      <PhaseIntro
        eyebrow="Account execution"
        description="Follow a federal account from requested funding through OMB apportionment, obligations, and outlays. Exact TAFS joins stay solid; the request edge is separately labeled derived."
        facts={[
          { value: coverage.federalAccounts || accounts.length, label: "federal accounts" },
          { value: coverage.exactTafsJoins || 0, label: "exact TAFS joins" },
          { value: `${Math.round((coverage.exactTafsJoinRate || 0) * 100)}%`, label: "TAFS coverage" },
          { value: coverage.requestMatchedAccounts || 0, label: "request matches" },
          { value: coverage.exactAwardAccountLinks || 0, label: "exact award links" },
          { value: coverage.awardsMappedToCurrentAccounts || 0, label: "awards mapped" },
        ]}
      />

      <section className="lifecycle-account-picker">
        <span>Federal account</span>
        <ControlSelect ariaLabel="Federal account" searchable value={selected.federalAccountCode} onChange={setSelectedCode} options={accounts.map((account) => ({ value: account.federalAccountCode, label: `${account.federalAccountCode} · ${account.title}`, description: account.bureauName || "Federal account" }))} />
        <p>{selected.bureauName || "Department of War"} · FY{fiscalYear} · observed {dateTime(ACCOUNT_SPINE.metadata.generatedAt)}</p>
      </section>

      <Section title="Request-to-Execution Waterfall" meta="distinct money stages, never summed" icon={BarChart3}>
        <div className="lifecycle-waterfall" data-lifecycle-waterfall>
          {stages.map((stage) => <LifecycleStage key={stage.label} {...stage} maximum={maximum} />)}
        </div>
        <p className="lifecycle-caveat">Apportionment can exceed the current request because it can include prior-year balances, collections, and other budgetary resources. These stages are compared, not added.</p>
      </Section>

      <Section title="TAFS Account Flow" meta={`${treasuryRows.length} highest-obligation exact joins shown`} icon={Network}>
        <div className="tafs-flow" data-account-flow>
          {treasuryRows.map((row) => (
            <article key={row.tasCode}>
              <header>
                <div><strong>{row.tasCode}</strong><span>{row.title}</span></div>
                <a href={row.apportionment.sourceUrl} target="_blank" rel="noreferrer">OMB source <ExternalLink size={13} aria-hidden="true" /></a>
              </header>
              <div className="tafs-flow__bars">
                {[
                  ["Apportioned", row.apportionment.approvedAmount, "blue"],
                  ["Obligated", row.obligatedAmount, "purple"],
                  ["Outlays", row.outlayedAmount, "green"],
                ].map(([label, amount, tone]) => (
                  <div key={label}>
                    <span>{label}</span>
                    <i aria-hidden="true"><b className={`tone-${tone}`} style={{ width: `${Math.max(1, (Number(amount || 0) / maxTreasury) * 100)}%` }} /></i>
                    <strong>{federalMoney(amount)}</strong>
                  </div>
                ))}
              </div>
            </article>
          ))}
        </div>
      </Section>

      <Section title="Award-to-Account Flow" meta={`${selectedAwardRows.length} highest-obligation sampled awards shown`} icon={GitBranch}>
        <div className="award-account-flow" data-award-account-flow>
          {selectedAwardRows.length ? selectedAwardRows.map((award) => (
            <article key={award.awardId}>
              <header>
                <div>
                  <strong>{award.recipient}</strong>
                  <span>{award.awardNumber} · {award.areas?.map((area) => area.label).join(", ")}</span>
                </div>
                <a href={award.sourceUrl} target="_blank" rel="noreferrer">Award source <ExternalLink size={13} aria-hidden="true" /></a>
              </header>
              <p>{award.description || "No public award description."}</p>
              <div>
                <span>Obligations from {selected.federalAccountCode}</span>
                <i aria-hidden="true"><b style={{ width: `${Math.max(2, (award.accountObligatedAmount / maxAwardObligation) * 100)}%` }} /></i>
                <strong>{federalMoney(award.accountObligatedAmount)}</strong>
              </div>
            </article>
          )) : <p className="empty-state">No exact award-account links are present for this account in the ranked technology-award sample.</p>}
        </div>
        <p className="lifecycle-caveat">Each edge is reported by USAspending from award transactions to a federal account. The set is limited to the {coverage.sampledAwards || 0} highest-value awards in the current technology sample and is not a complete account ledger.</p>
      </Section>

      <Section title="Five-Year Execution History" meta="Department totals as published by USAspending" icon={BarChart3}>
        <div className="fiscal-history" data-fiscal-history>
          {historyRows.map((row) => (
            <article key={row.fiscal_year}>
              <header><strong>FY{row.fiscal_year}</strong><span>{percent((Number(row.agency_total_obligated || 0) / Math.max(Number(row.agency_budgetary_resources || 0), 1)) * 100)} obligated</span></header>
              {[
                ["Resources", row.agency_budgetary_resources, "blue"],
                ["Obligations", row.agency_total_obligated, "purple"],
                ["Outlays", row.agency_total_outlayed, "green"],
              ].map(([label, amount, tone]) => (
                <div key={label}>
                  <span>{label}</span>
                  <i aria-hidden="true"><b className={`tone-${tone}`} style={{ width: `${Math.max(1, (Number(amount || 0) / historyMaximum) * 100)}%` }} /></i>
                  <strong>{federalMoney(amount)}</strong>
                </div>
              ))}
            </article>
          ))}
        </div>
        <p className="lifecycle-caveat">Fiscal years are separate published snapshots. Current-year values may be partial or revised and should not be treated as final year-end totals.</p>
      </Section>

      <Section title="Department Obligation Burn" meta={`FY${fiscalYear} reported agency obligations by period`} icon={TrendingUp}>
        <div className="burn-chart" data-burn-curve>
          <svg viewBox="0 0 600 210" role="img" aria-labelledby="burn-title burn-description">
            <title id="burn-title">Department-wide obligation burn curve</title>
            <desc id="burn-description">Reported Department of War obligations by USAspending reporting period for fiscal year {fiscalYear}.</desc>
            <line x1="24" y1="176" x2="576" y2="176" />
            <line x1="24" y1="36" x2="24" y2="176" />
            <polyline points={burnPoints} />
            {burnRows.map((row, index) => {
              const [x, y] = burnPoints.split(" ")[index].split(",");
              return <circle key={row.period} cx={x} cy={y} r="4"><title>Period {row.period}: {federalMoney(row.obligated)}</title></circle>;
            })}
          </svg>
          <div className="burn-chart__periods">
            {burnRows.map((row) => <span key={row.period}>P{row.period}<strong>{federalMoney(row.obligated)}</strong></span>)}
          </div>
          {latestBurnIsPartial ? <p className="lifecycle-caveat">The latest reported period is below the prior high-water mark and may be incomplete or revised. It is shown as published rather than forced into a monotonic curve.</p> : null}
        </div>
      </Section>

      <Section title="Evidence and Join Policy" meta="reproducible public sources" icon={Database}>
        <div className="lifecycle-evidence" data-lifecycle-evidence>
          <a href={selected.sourceUrl} target="_blank" rel="noreferrer"><strong>USAspending federal account</strong><span>Resources, obligations, outlays, and Treasury accounts</span></a>
          <a href={ACCOUNT_SPINE.metadata.sources.ombApportionments} target="_blank" rel="noreferrer"><strong>OMB approved apportionments</strong><span>Latest public FY{fiscalYear} document by TAFS</span></a>
          <a href={ACCOUNT_SPINE.metadata.sources.usaSpendingAwardAccounts} target="_blank" rel="noreferrer"><strong>USAspending award accounts</strong><span>Exact transaction-funded federal-account links for sampled awards</span></a>
          {(selected.requestMatch?.sourceUrls || []).slice(0, 2).map((url) => (
            <a key={url} href={url} target="_blank" rel="noreferrer"><strong>DoW budget request</strong><span>Exact normalized account-title match, labeled derived</span></a>
          ))}
        </div>
        <p className="lifecycle-caveat">Award-to-account edges are exact. No budget-line or program-element-to-award link is asserted; that last-mile relationship remains unlinked until a public identifier or cited source supports it.</p>
      </Section>
    </div>
  );
}

// eslint-disable-next-line no-unused-vars
function DataVisuals() {
  const clusters = VISUAL_ANALYTICS.clusters || EMPTY_ROWS;
  const summary = VISUAL_ANALYTICS.summary || {};
  const timingBands = VISUAL_ANALYTICS.timingBands || EMPTY_ROWS;
  const heatmapColumns = VISUAL_ANALYTICS.heatmapColumns || EMPTY_ROWS;
  const heatmapRows = VISUAL_ANALYTICS.heatmapRows || EMPTY_ROWS;
  const [selectedId, setSelectedId] = useUrlSelection(clusters[0]?.id || "", clusters.map((cluster) => cluster.id));
  const selected = clusters.find((cluster) => cluster.id === selectedId) || clusters[0];
  const maxTimingValue = Math.max(...timingBands.map((band) => band.nearTermAwardAmount || 0), 1);
  const maxBudgetValue = Math.max(...clusters.map((cluster) => cluster.budgetFy2027 || 0), 1);
  const maxActiveValue = Math.max(...clusters.map((cluster) => cluster.activeAwardAmount || 0), 1);
  const maxNearTermValue = Math.max(...clusters.map((cluster) => cluster.nearTermAwardAmount || 0), 1);
  const comparisonMetrics = [
    { id: "score", label: "Score", value: (cluster) => cluster.score || 0, display: (value) => `${Math.round(value)}`, tone: "blue" },
    { id: "budget", label: "Budget", value: (cluster) => ((cluster.budgetFy2027 || 0) / maxBudgetValue) * 100, display: (_value, cluster) => money(cluster.budgetFy2027), tone: "green" },
    { id: "execution", label: "Execution", value: (cluster) => ((cluster.activeAwardAmount || 0) / maxActiveValue) * 100, display: (_value, cluster) => money(cluster.activeAwardAmount), tone: "purple" },
    { id: "timing", label: "Timing", value: (cluster) => ((cluster.nearTermAwardAmount || 0) / maxNearTermValue) * 100, display: (_value, cluster) => money(cluster.nearTermAwardAmount), tone: "orange" },
    { id: "confidence", label: "Confidence", value: (cluster) => cluster.confidence || 0, display: (value) => percent(value, 0), tone: "blue" },
    { id: "pressure", label: "Incumbent", value: (cluster) => cluster.incumbentShare || 0, display: (value) => percent(value, 0), tone: "red" },
  ];

  return (
    <div className="grid visuals-page" data-visuals-page>
      <section className="visuals-hero">
        <div>
          <span>Visualization layer</span>
          <h2>Data Visuals</h2>
          <p>Visual operating picture for budget scale, sampled execution value, near-term timing, buyers, incumbents, capability fit, and decision-brief evidence.</p>
        </div>
        <div className="visuals-hero__facts" aria-label="Visual analytics summary">
          <article>
            <strong>{summary.clusters || clusters.length}</strong>
            <span>visual clusters</span>
          </article>
          <article>
            <strong>{money(summary.nearTermAwardValue || 0)}</strong>
            <span>near-term value</span>
          </article>
          <article>
            <strong>{summary.timingBands || timingBands.length}</strong>
            <span>timing bands</span>
          </article>
          <article>
            <strong>{summary.topCluster || "n/a"}</strong>
            <span>top cluster</span>
          </article>
        </div>
      </section>

      <div className="visuals-shell">
        <aside className="visuals-picker" data-visual-cluster-picker>
          {clusters.map((cluster) => (
            <button
              key={cluster.id}
              type="button"
              className={selected?.id === cluster.id ? "active" : ""}
              onClick={() => setSelectedId(cluster.id)}
            >
              <span>#{cluster.rank} · score {cluster.score} · {cluster.decision}</span>
              <strong>{cluster.title}</strong>
              <em>{money(cluster.nearTermAwardAmount)} near-term · {cluster.capability}</em>
            </button>
          ))}
        </aside>

        {selected ? (
          <div className="visuals-workspace">
            <Section title="Opportunity Field" meta="budget scale versus near-term execution timing" icon={BarChart3}>
              <div className="visual-bubble-field" data-visual-bubble-field>
                <div className="visual-axis visual-axis--x">FY2027 budget signal</div>
                <div className="visual-axis visual-axis--y">near-term sampled awards</div>
                {clusters.map((cluster) => (
                  <button
                    key={cluster.id}
                    type="button"
                    className={selected.id === cluster.id ? "active" : ""}
                    style={{
                      left: `${cluster.x}%`,
                      top: `${cluster.y}%`,
                      width: `${cluster.radius}px`,
                      height: `${cluster.radius}px`,
                    }}
                    title={`${cluster.title}: ${money(cluster.budgetFy2027)} budget, ${money(cluster.nearTermAwardAmount)} near-term`}
                    aria-label={`${cluster.title} visual cluster`}
                    onClick={() => setSelectedId(cluster.id)}
                  >
                    <span>{cluster.rank}</span>
                  </button>
                ))}
              </div>
            </Section>

            <Section title="Lane Comparison" meta="ranked signal board for deciding what deserves validation first" icon={ListChecks}>
              <div className="visual-comparison-board" data-visual-comparison-board>
                <div className="visual-comparison-board__header" style={{ "--comparison-columns": comparisonMetrics.length }}>
                  <span>Lane</span>
                  {comparisonMetrics.map((metric) => (
                    <span key={metric.id}>{metric.label}</span>
                  ))}
                </div>
                {clusters.map((cluster) => (
                  <button
                    key={cluster.id}
                    type="button"
                    className={selected.id === cluster.id ? "active" : ""}
                    style={{ "--comparison-columns": comparisonMetrics.length }}
                    onClick={() => setSelectedId(cluster.id)}
                  >
                    <span className="visual-comparison-board__lane">
                      <strong>#{cluster.rank} {cluster.title}</strong>
                      <em>{cluster.buyer} · {cluster.capability}</em>
                    </span>
                    {comparisonMetrics.map((metric) => {
                      const value = Math.min(Math.max(metric.value(cluster), 0), 100);
                      return (
                        <span className={`visual-comparison-board__metric visual-comparison-board__metric--${metric.tone}`} key={metric.id}>
                          <b>{metric.display(value, cluster)}</b>
                          <i aria-hidden="true"><em style={{ width: `${Math.max(value, 3)}%` }} /></i>
                        </span>
                      );
                    })}
                  </button>
                ))}
              </div>
            </Section>

            <Section title={selected.title} meta={`${selected.capability} · ${selected.timingBand?.label || "timing unknown"}`} icon={Network}>
              <div className="visual-flow-grid" data-visual-flow-map>
                {(selected.flow || []).map((node) => (
                  <article key={node.id} className={`visual-flow-node visual-flow-node--${node.tone}`}>
                    <span>{node.label}</span>
                    <strong>{node.display === "money" ? money(node.value) : node.value}</strong>
                    <p>{node.helper}</p>
                  </article>
                ))}
              </div>
            </Section>

            <Section title="Signal Stack" meta={selected.action} icon={GitBranch}>
              <div className="visual-signal-stack" data-visual-signal-stack>
                {(selected.evidenceBars || []).map((bar) => (
                  <article key={bar.id} className={`visual-signal visual-signal--${bar.tone}`}>
                    <header>
                      <span>{bar.label}</span>
                      <b>{percent(bar.value, 0)}</b>
                    </header>
                    <div aria-label={`${bar.label} signal ${percent(bar.value, 0)}`}>
                      <i style={{ width: `${Math.min(Math.max(bar.value, 3), 100)}%` }} />
                    </div>
                  </article>
                ))}
              </div>
            </Section>

            <Section title="Timing Ribbon" meta="clustered by next sampled award end" icon={CalendarClock}>
              <div className="visual-timing-ribbon" data-visual-timing-ribbon>
                {timingBands.map((band) => (
                  <article key={band.id}>
                    <header>
                      <span>{band.label}</span>
                      <b>{money(band.nearTermAwardAmount)}</b>
                    </header>
                    <div aria-label={`${band.label} timing value`}>
                      <i style={{ width: `${Math.max((band.nearTermAwardAmount / maxTimingValue) * 100, 3)}%` }} />
                    </div>
                    <p>{band.clusters} clusters · {band.topCluster}</p>
                  </article>
                ))}
              </div>
            </Section>

            <Section title="Buyer / Capability Heatmap" meta={`${heatmapRows.length} buyers by ${heatmapColumns.length} capability wedges`} icon={Building2}>
              <div className="visual-heatmap" data-visual-heatmap>
                <div
                  className="visual-heatmap__grid"
                  style={{ "--heatmap-columns": heatmapColumns.length || 1 }}
                >
                  <strong>Buyer</strong>
                  {heatmapColumns.map((column) => (
                    <strong key={column.id}>{column.label}</strong>
                  ))}
                  {heatmapRows.map((row) => (
                    <div className="visual-heatmap__row" key={row.id}>
                      <b>{row.buyer}</b>
                      {row.cells.map((cell) => (
                        <span
                          key={cell.id}
                          style={{ backgroundColor: cell.score ? `rgba(0, 94, 162, ${Math.min(0.14 + (cell.score / 155), 0.78)})` : "#f8fafc" }}
                          title={`${row.buyer} / ${cell.capability}: score ${cell.score}`}
                        >
                          <strong>{cell.score || "-"}</strong>
                          <em>{cell.nearTermAwardAmount ? money(cell.nearTermAwardAmount) : "n/a"}</em>
                        </span>
                      ))}
                    </div>
                  ))}
                </div>
              </div>
            </Section>

            <div className="grid grid--sources">
              <Section title="Selected Cluster" meta="visual readout" icon={FileText}>
                <div className="visual-cluster-brief" data-visual-selected-cluster>
                  <article>
                    <span>Buyer</span>
                    <strong>{selected.buyer}</strong>
                    <p>{selected.buyerGroup}</p>
                  </article>
                  <article>
                    <span>Work type</span>
                    <strong>{selected.workType}</strong>
                    <p>{selected.topIncumbent} leads the sampled execution lane.</p>
                  </article>
                  <article>
                    <span>Next action</span>
                    <strong>{selected.action}</strong>
                    <p>{selected.decision}</p>
                  </article>
                </div>
              </Section>

              <Section title="Award Examples" meta={`${selected.timingExamples?.length || 0} timing records`} icon={FileSpreadsheet}>
                <div className="relationship-award-list" data-visual-award-examples>
                  {(selected.timingExamples || []).map((award) => (
                    <article key={award.id}>
                      <div>
                        <strong>{award.awardId}</strong>
                        <span>{award.recipient} · {award.buyer} · ends {award.endDate}</span>
                      </div>
                      <b>{money(award.awardAmount)}</b>
                    </article>
                  ))}
                </div>
              </Section>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

// eslint-disable-next-line no-unused-vars
function DecisionBriefs() {
  const items = DECISION_BRIEFS.items || EMPTY_ROWS;
  const summary = DECISION_BRIEFS.summary || {};
  const [selectedId, setSelectedId] = useUrlSelection(items[0]?.id || "", items.map((item) => item.id));
  const selected = items.find((item) => item.id === selectedId) || items[0];
  const metrics = selected ? [
    { label: "Brief score", value: selected.score, helper: `${selected.decision} · ${selected.confidenceLabel}` },
    { label: "Budget signal", value: money(selected.keyMetrics?.budgetFy2027), helper: `${selected.area} FY2027 request posture` },
    { label: "Near-term value", value: money(selected.keyMetrics?.nearTermAwardAmount), helper: `${selected.keyMetrics?.nearTermAwards || 0} active awards inside 24 months` },
    { label: "Incumbent share", value: percent(selected.keyMetrics?.incumbentShare, 0), helper: selected.linkedAwards?.[0]?.recipient || "sampled incumbent field" },
  ] : [];

  return (
    <div className="grid briefs-page" data-decision-briefs-page>
      <section className="briefs-hero">
        <div>
          <span>Judgment surface</span>
          <h2>Decision Briefs</h2>
          <p>Plain-language pursuit briefs that compress budget, spend, timing, buyer, incumbent, capability fit, objections, and next validation into one judgment record.</p>
        </div>
        <div className="briefs-hero__facts" aria-label="Decision brief summary">
          <article>
            <strong>{summary.briefs || items.length}</strong>
            <span>briefs</span>
          </article>
          <article>
            <strong>{summary.prioritizeNow || 0}</strong>
            <span>priority validations</span>
          </article>
          <article>
            <strong>{summary.topDecision || "n/a"}</strong>
            <span>top decision</span>
          </article>
          <article>
            <strong>{summary.topBrief || "n/a"}</strong>
            <span>top brief</span>
          </article>
        </div>
      </section>

      {selected ? (
        <AnalysisActions
          rows={[selected]}
          filename={`decision-brief-${selected.id}`}
          copyLabel="Copy brief"
          copyValue={`${selected.title}\n${selected.verdict}\n\n${selected.bestNextMove}\n\n${window.location.href}`}
        />
      ) : null}

      <div className="briefs-shell">
        <aside className="briefs-picker" data-brief-picker>
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              className={selected?.id === item.id ? "active" : ""}
              onClick={() => setSelectedId(item.id)}
            >
              <span>#{item.rank} · {item.decision} · score {item.score}</span>
              <strong>{item.title}</strong>
              <em>{item.subtitle}</em>
            </button>
          ))}
        </aside>

        {selected ? (
          <div className="briefs-workspace">
            <Section title={selected.title} meta={`${selected.capability} · ${selected.subtitle}`} icon={FileText}>
              <div className="brief-verdict" data-brief-verdict>
                <article className="brief-verdict__main">
                  <span>Verdict</span>
                  <strong>{selected.verdict}</strong>
                  <p>{selected.bestNextMove}</p>
                </article>
                {metrics.map((metric) => (
                  <article key={metric.label}>
                    <span>{metric.label}</span>
                    <strong>{metric.value}</strong>
                    <p>{metric.helper}</p>
                  </article>
                ))}
              </div>
            </Section>

            <Section title="Interpretation" meta="the actual read" icon={Lightbulb}>
              <div className="brief-interpretation-grid" data-brief-interpretation>
                <article>
                  <span>So what</span>
                  <p>{selected.soWhat}</p>
                </article>
                <article>
                  <span>Why now</span>
                  <p>{selected.whyNow}</p>
                </article>
                <article>
                  <span>Credible wedge</span>
                  <p>{selected.credibleWedge}</p>
                </article>
                <article>
                  <span>Buyer path</span>
                  <p>{selected.buyerPath}</p>
                </article>
                <article>
                  <span>Incumbent read</span>
                  <p>{selected.incumbentRead}</p>
                </article>
                <article>
                  <span>Timing example</span>
                  <p>{selected.sampleAwardCallout}</p>
                </article>
              </div>
            </Section>

            <Section title="Evidence Chain" meta="why the brief exists" icon={GitBranch}>
              <div className="brief-evidence-chain" data-brief-evidence-chain>
                {(selected.evidenceChain || []).map((item) => (
                  <article key={item.id}>
                    <span>{item.label}</span>
                    <strong>{item.value}</strong>
                    <p>{item.helper}</p>
                  </article>
                ))}
              </div>
            </Section>

            <div className="grid grid--sources">
              <Section title="What Could Be Wrong" meta="failure modes to test" icon={Filter}>
                <div className="brief-risk-list" data-brief-risks>
                  {(selected.whatCouldBeWrong || []).map((risk) => <article key={risk}>{risk}</article>)}
                </div>
              </Section>

              <Section title="Disqualifiers" meta="conditions that would kill the pursuit" icon={Search}>
                <div className="brief-risk-list brief-risk-list--red" data-brief-disqualifiers>
                  {(selected.disqualifiers || []).map((risk) => <article key={risk}>{risk}</article>)}
                </div>
              </Section>
            </div>

            <Section title="Validation Plan" meta="make the next decision concrete" icon={ListChecks}>
              <div className="brief-validation-grid" data-brief-validation>
                {(selected.validationPlan || []).map((task, index) => (
                  <article key={task}>
                    <span>{String(index + 1).padStart(2, "0")}</span>
                    <strong>{task}</strong>
                  </article>
                ))}
              </div>
            </Section>

            <div className="grid grid--sources">
              <Section title="Linked Budget Lines" meta={`${selected.linkedBudgetLines?.length || 0} source examples`} icon={FileText}>
                <div className="relationship-line-list" data-brief-budget-lines>
                  {(selected.linkedBudgetLines || []).map((line) => (
                    <article key={line.id}>
                      <div>
                        <strong>{line.title}</strong>
                        <span>{line.orgName} · {line.colorShort} · {line.justificationEvidence?.confidenceLabel || "Title-tagged only"}</span>
                      </div>
                      <b>{money(line.fy2027)}</b>
                    </article>
                  ))}
                </div>
              </Section>

              <Section title="Linked Awards" meta={`${selected.linkedAwards?.length || 0} sampled award examples`} icon={FileSpreadsheet}>
                <div className="relationship-award-list" data-brief-awards>
                  {(selected.linkedAwards || []).map((award) => (
                    <article key={award.id}>
                      <div>
                        <strong>{award.awardId || award.id}</strong>
                        <span>{award.recipient} · {award.endDate ? `ends ${award.endDate}` : "end unknown"} · {award.workType?.label || "Uncoded"}</span>
                      </div>
                      <b>{money(award.awardAmount)}</b>
                    </article>
                  ))}
                </div>
              </Section>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

// eslint-disable-next-line no-unused-vars
function AccountPlans() {
  const items = ACCOUNT_PLANS.items || EMPTY_ROWS;
  const summary = ACCOUNT_PLANS.summary || {};
  const [selectedId, setSelectedId] = useUrlSelection(items[0]?.id || "", items.map((item) => item.id));
  const selected = items.find((item) => item.id === selectedId) || items[0];
  const selectedMetrics = selected ? [
    { label: "Account score", value: selected.score, helper: selected.posture },
    { label: "Sampled value", value: money(selected.awardAmount), helper: `${selected.awards} deduped awards` },
    { label: "Near-term value", value: money(selected.nearTermAwardAmount), helper: `${selected.nearTermAwards} active awards ending within 24 months` },
    { label: "Top incumbent", value: selected.topIncumbent, helper: selected.topWorkType },
  ] : [];

  return (
    <div className="grid account-page" data-account-plans-page>
      <section className="account-hero">
        <div>
          <span>Buyer account surface</span>
          <h2>Account Plans</h2>
          <p>Buyer-level plans that connect funded technology areas, sampled execution spend, incumbent concentration, near-term award timing, hypotheses, and validation work into one account view.</p>
        </div>
        <div className="account-hero__facts" aria-label="Account plan summary">
          <article>
            <strong>{summary.accounts || items.length}</strong>
            <span>account plans</span>
          </article>
          <article>
            <strong>{summary.buildNowAccounts || 0}</strong>
            <span>build-now accounts</span>
          </article>
          <article>
            <strong>{money(summary.nearTermAwardValue || 0)}</strong>
            <span>near-term value</span>
          </article>
          <article>
            <strong>{summary.topAccount || "n/a"}</strong>
            <span>top account</span>
          </article>
        </div>
      </section>

      <div className="account-shell">
        <aside className="account-picker" data-account-picker>
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              className={selected?.id === item.id ? "active" : ""}
              onClick={() => setSelectedId(item.id)}
            >
              <span>#{item.rank} · {item.posture}</span>
              <strong>{item.buyer}</strong>
              <em>{item.topArea} · {money(item.nearTermAwardAmount)} near-term</em>
            </button>
          ))}
        </aside>

        {selected ? (
          <div className="account-workspace">
            <Section title={selected.buyer} meta={`${selected.buyerGroup} · ${selected.focus}`} icon={Building2}>
              <div className="account-brief" data-account-brief>
                {selectedMetrics.map((metric) => (
                  <article key={metric.label}>
                    <span>{metric.label}</span>
                    <strong>{metric.value}</strong>
                    <p>{metric.helper}</p>
                  </article>
                ))}
              </div>
            </Section>

            <Section title="Account Priority Lanes" meta="technology, budget, timing, and action" icon={GitBranch}>
              <div className="account-priority-grid" data-account-priorities>
                {(selected.areaPriorities || []).map((priority) => (
                  <article key={priority.id} className="account-priority-card">
                    <header>
                      <div>
                        <span>{priority.queueStage} · {priority.narrativeConfirmedRecords} confirmed lines</span>
                        <strong>{priority.area}</strong>
                      </div>
                      <b>{money(priority.nearTermAwardAmount)}</b>
                    </header>
                    <p>{priority.nextAction}</p>
                    <dl>
                      <div>
                        <dt>Budget</dt>
                        <dd>{money(priority.budgetFy2027)} · {pct(priority.budgetGrowth)}</dd>
                      </div>
                      <div>
                        <dt>Execution</dt>
                        <dd>{money(priority.activeAwardAmount)} · {priority.activeAwards} awards</dd>
                      </div>
                      <div>
                        <dt>Timing</dt>
                        <dd>{priority.nearTermAwards} near-term awards</dd>
                      </div>
                      <div>
                        <dt>Incumbent</dt>
                        <dd>{priority.topIncumbent} · {percent(priority.incumbentShare, 0)}</dd>
                      </div>
                    </dl>
                  </article>
                ))}
              </div>
            </Section>

            <div className="grid grid--sources">
              <Section title="Incumbent Map" meta="sampled award value" icon={Database}>
                <div className="account-rank-list" data-account-incumbents>
                  {(selected.incumbentMap || []).map((incumbent) => (
                    <article key={incumbent.id}>
                      <div>
                        <strong>{incumbent.label}</strong>
                        <span>{incumbent.awards} awards · {(incumbent.areas || []).slice(0, 2).join(", ")}</span>
                      </div>
                      <b>{money(incumbent.awardAmount)}</b>
                    </article>
                  ))}
                </div>
              </Section>

              <Section title="Work Type Map" meta="PSC and NAICS concentration" icon={FileSpreadsheet}>
                <div className="account-rank-list" data-account-worktypes>
                  {(selected.workTypeMap || []).map((workType) => (
                    <article key={workType.id}>
                      <div>
                        <strong>{workType.label}</strong>
                        <span>{workType.awards} awards</span>
                      </div>
                      <b>{money(workType.awardAmount)}</b>
                    </article>
                  ))}
                </div>
              </Section>
            </div>

            <div className="grid grid--sources">
              <Section title="Capture Actions" meta={`${selected.captureActions?.length || 0} related queue items`} icon={ListChecks}>
                <div className="account-action-list" data-account-actions>
                  {(selected.captureActions || []).map((action) => (
                    <article key={action.id}>
                      <div>
                        <strong>{action.recommendedAction}</strong>
                        <span>{action.area} · {action.workType?.label || "Uncoded"} · {action.stageLabel}</span>
                      </div>
                      <a href={action.samSearchUrl} target="_blank" rel="noreferrer">
                        SAM search <ExternalLink size={12} aria-hidden="true" />
                      </a>
                    </article>
                  ))}
                </div>
              </Section>

              <Section title="Related Hypotheses" meta={`${selected.hypotheses?.length || 0} generated theses`} icon={Lightbulb}>
                <div className="account-hypothesis-list" data-account-hypotheses>
                  {(selected.hypotheses || []).map((hypothesis) => (
                    <article key={hypothesis.id}>
                      <span>{hypothesis.confidenceLabel} · {hypothesis.status}</span>
                      <strong>{hypothesis.title}</strong>
                      <p>{hypothesis.thesis}</p>
                    </article>
                  ))}
                </div>
              </Section>
            </div>

            <Section title="Validation Plan" meta="account-specific work before pursuit commitment" icon={Filter}>
              <div className="account-validation-grid" data-account-validation>
                {(selected.validationPlan || []).map((task, index) => (
                  <article key={task}>
                    <span>{String(index + 1).padStart(2, "0")}</span>
                    <strong>{task}</strong>
                  </article>
                ))}
              </div>
            </Section>

            <div className="grid grid--sources">
              <Section title="Near-Term Awards" meta={`${selected.nearTermAwardsList?.length || 0} examples`} icon={CalendarClock}>
                <div className="relationship-award-list" data-account-near-term-awards>
                  {(selected.nearTermAwardsList || []).map((award) => (
                    <article key={award.id}>
                      <div>
                        <strong>{award.awardId || award.id}</strong>
                        <span>{award.recipient} · {award.endDate ? `ends ${award.endDate}` : "end unknown"} · {award.workType?.label || "Uncoded"}</span>
                      </div>
                      <b>{money(award.awardAmount)}</b>
                    </article>
                  ))}
                </div>
              </Section>

              <Section title="Linked Budget Lines" meta={`${selected.linkedBudgetLines?.length || 0} source examples`} icon={FileText}>
                <div className="relationship-line-list" data-account-budget-lines>
                  {(selected.linkedBudgetLines || []).map((line) => (
                    <article key={line.id}>
                      <div>
                        <strong>{line.title}</strong>
                        <span>{line.orgName} · {line.colorShort} · {line.justificationEvidence?.confidenceLabel || "Title-tagged only"}</span>
                      </div>
                      <b>{money(line.fy2027)}</b>
                    </article>
                  ))}
                </div>
              </Section>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

// eslint-disable-next-line no-unused-vars
function CapabilityFit() {
  const items = CAPABILITY_FIT.items || EMPTY_ROWS;
  const summary = CAPABILITY_FIT.summary || {};
  const [selectedId, setSelectedId] = useUrlSelection(items[0]?.id || "", items.map((item) => item.id));
  const selected = items.find((item) => item.id === selectedId) || items[0];
  const selectedMetrics = selected ? [
    { label: "Fit score", value: selected.score, helper: selected.posture },
    { label: "Budget signal", value: money(selected.budgetFy2027), helper: `${selected.budgetRecords} source lines · ${selected.narrativeConfirmedRecords} confirmed` },
    { label: "Execution signal", value: money(selected.awardAmount), helper: `${selected.awards} sampled awards` },
    { label: "Near-term timing", value: money(selected.nearTermAwardAmount), helper: `${selected.nearTermAwards} active awards ending within 24 months` },
  ] : [];

  return (
    <div className="grid fit-page" data-capability-fit-page>
      <section className="fit-hero">
        <div>
          <span>Capability fit surface</span>
          <h2>Capability Fit</h2>
          <p>Capability wedges ranked by budget posture, execution spend, near-term timing, buyer account matches, hypotheses, incumbents, work types, and source-line evidence.</p>
        </div>
        <div className="fit-hero__facts" aria-label="Capability fit summary">
          <article>
            <strong>{summary.capabilities || items.length}</strong>
            <span>capability wedges</span>
          </article>
          <article>
            <strong>{summary.primaryWedges || 0}</strong>
            <span>primary wedges</span>
          </article>
          <article>
            <strong>{money(summary.nearTermAwardValue || 0)}</strong>
            <span>near-term value</span>
          </article>
          <article>
            <strong>{summary.topCapability || "n/a"}</strong>
            <span>top capability</span>
          </article>
        </div>
      </section>

      <div className="fit-shell">
        <aside className="fit-picker" data-capability-picker>
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              className={selected?.id === item.id ? "active" : ""}
              onClick={() => setSelectedId(item.id)}
            >
              <span>{item.posture} · score {item.score}</span>
              <strong>{item.label}</strong>
              <em>{money(item.nearTermAwardAmount)} near-term · {item.accountMatches?.length || 0} accounts</em>
            </button>
          ))}
        </aside>

        {selected ? (
          <div className="fit-workspace">
            <Section title={selected.label} meta={selected.fit} icon={BrainCircuit}>
              <div className="fit-brief" data-capability-brief>
                {selectedMetrics.map((metric) => (
                  <article key={metric.label}>
                    <span>{metric.label}</span>
                    <strong>{metric.value}</strong>
                    <p>{metric.helper}</p>
                  </article>
                ))}
              </div>
            </Section>

            <Section title="Capability Areas" meta="technology areas attached to this wedge" icon={GitBranch}>
              <div className="fit-area-grid" data-capability-areas>
                {(selected.areaMap || []).map((area) => (
                  <article key={area.id} className="fit-area-card">
                    <header>
                      <div>
                        <span>{area.records} lines · {money(area.executionObligationAmount)} obligations</span>
                        <strong>{area.label}</strong>
                      </div>
                      <b>{money(area.nearTermAwardAmount)}</b>
                    </header>
                    <dl>
                      <div>
                        <dt>Budget</dt>
                        <dd>{money(area.fy2027)}</dd>
                      </div>
                      <div>
                        <dt>Top buyer</dt>
                        <dd>{area.topBuyer}</dd>
                      </div>
                      <div>
                        <dt>Top incumbent</dt>
                        <dd>{area.topVendor}</dd>
                      </div>
                    </dl>
                  </article>
                ))}
              </div>
            </Section>

            <Section title="Best Account Matches" meta="buyer plans where this capability has timing and evidence" icon={Building2}>
              <div className="fit-account-grid" data-capability-accounts>
                {(selected.accountMatches || []).map((account) => (
                  <article key={account.id} className="fit-account-card">
                    <header>
                      <div>
                        <span>{account.posture} · score {account.score}</span>
                        <strong>{account.buyer}</strong>
                      </div>
                      <b>{money(account.nearTermAwardAmount)}</b>
                    </header>
                    <p>{account.priorityAreas.join(" · ")}</p>
                    <footer>
                      <span>{money(account.activeAwardAmount)} active</span>
                      <span>{account.topIncumbent}</span>
                    </footer>
                  </article>
                ))}
              </div>
            </Section>

            <div className="grid grid--sources">
              <Section title="Buyer / Incumbent Map" meta="execution concentration" icon={Database}>
                <div className="fit-rank-list" data-capability-incumbents>
                  {(selected.topIncumbents || []).map((incumbent) => (
                    <article key={incumbent.id}>
                      <div>
                        <strong>{incumbent.label}</strong>
                        <span>{incumbent.awards} awards · {(incumbent.areas || []).slice(0, 2).join(", ")}</span>
                      </div>
                      <b>{money(incumbent.awardAmount)}</b>
                    </article>
                  ))}
                </div>
              </Section>

              <Section title="Work Type Map" meta="PSC and NAICS concentration" icon={FileSpreadsheet}>
                <div className="fit-rank-list" data-capability-worktypes>
                  {(selected.topWorkTypes || []).map((workType) => (
                    <article key={workType.id}>
                      <div>
                        <strong>{workType.label}</strong>
                        <span>{workType.awards} awards</span>
                      </div>
                      <b>{money(workType.awardAmount)}</b>
                    </article>
                  ))}
                </div>
              </Section>
            </div>

            <div className="grid grid--sources">
              <Section title="Capture Actions" meta={`${selected.captureActions?.length || 0} related cockpit items`} icon={ListChecks}>
                <div className="fit-action-list" data-capability-actions>
                  {(selected.captureActions || []).map((action) => (
                    <article key={action.id}>
                      <div>
                        <strong>{action.recommendedAction}</strong>
                        <span>{action.buyer} · {action.area} · {action.stageLabel}</span>
                      </div>
                      <a href={action.samSearchUrl} target="_blank" rel="noreferrer">
                        SAM search <ExternalLink size={12} aria-hidden="true" />
                      </a>
                    </article>
                  ))}
                </div>
              </Section>

              <Section title="Related Hypotheses" meta={`${selected.hypotheses?.length || 0} theses`} icon={Lightbulb}>
                <div className="fit-hypothesis-list" data-capability-hypotheses>
                  {(selected.hypotheses || []).map((hypothesis) => (
                    <article key={hypothesis.id}>
                      <span>{hypothesis.confidenceLabel} · {hypothesis.status}</span>
                      <strong>{hypothesis.title}</strong>
                      <p>{hypothesis.thesis}</p>
                    </article>
                  ))}
                </div>
              </Section>
            </div>

            <Section title="Validation Plan" meta="turn capability fit into account-specific pursuit work" icon={Filter}>
              <div className="fit-validation-grid" data-capability-validation>
                {(selected.validationPlan || []).map((task, index) => (
                  <article key={task}>
                    <span>{String(index + 1).padStart(2, "0")}</span>
                    <strong>{task}</strong>
                  </article>
                ))}
              </div>
            </Section>

            <div className="grid grid--sources">
              <Section title="Near-Term Awards" meta={`${selected.nearTermAwardsList?.length || 0} examples`} icon={CalendarClock}>
                <div className="relationship-award-list" data-capability-near-term-awards>
                  {(selected.nearTermAwardsList || []).map((award) => (
                    <article key={award.id}>
                      <div>
                        <strong>{award.awardId || award.id}</strong>
                        <span>{award.recipient} · {award.buyerSubAgency} · {award.endDate ? `ends ${award.endDate}` : "end unknown"}</span>
                      </div>
                      <b>{money(award.awardAmount)}</b>
                    </article>
                  ))}
                </div>
              </Section>

              <Section title="Linked Budget Lines" meta={`${selected.linkedBudgetLines?.length || 0} source examples`} icon={FileText}>
                <div className="relationship-line-list" data-capability-budget-lines>
                  {(selected.linkedBudgetLines || []).map((line) => (
                    <article key={line.id}>
                      <div>
                        <strong>{line.title}</strong>
                        <span>{line.orgName} · {line.colorShort} · {line.justificationEvidence?.confidenceLabel || "Title-tagged only"}</span>
                      </div>
                      <b>{money(line.fy2027)}</b>
                    </article>
                  ))}
                </div>
              </Section>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

// eslint-disable-next-line no-unused-vars
function Hypotheses() {
  const items = HYPOTHESES.items || EMPTY_ROWS;
  const summary = HYPOTHESES.summary || {};
  const [selectedId, setSelectedId] = useUrlSelection(items[0]?.id || "", items.map((item) => item.id));
  const selected = items.find((item) => item.id === selectedId) || items[0];
  const selectedMetricRows = selected ? [
    { label: "Budget signal", value: money(selected.metrics?.budgetFy2027), helper: `${selected.metrics?.budgetRecords || 0} lines · ${pct(selected.metrics?.budgetGrowth || 0)}` },
    { label: "Execution signal", value: money(selected.metrics?.activeAwardAmount), helper: `${selected.metrics?.activeAwards || 0} active awards` },
    { label: "Near-term value", value: money(selected.metrics?.nearTermAwardAmount), helper: `${selected.metrics?.nearTermAwards || 0} awards ending within 24 months` },
    { label: "Incumbent share", value: percent(selected.metrics?.incumbentShare, 0), helper: selected.topIncumbent },
    { label: "Alignment", value: selected.metrics?.alignmentScore || 0, helper: `${selected.metrics?.narrativeConfirmedRecords || 0} narrative-confirmed lines` },
    { label: "Timing", value: selected.metrics?.nextEndDate || "n/a", helper: Number.isFinite(selected.metrics?.daysUntilNextEnd) ? `${selected.metrics.daysUntilNextEnd} days` : "unknown" },
  ] : [];

  return (
    <div className="grid hypotheses-page" data-hypotheses-page>
      <section className="hypotheses-hero">
        <div>
          <span>Hypothesis model</span>
          <h2>Pursuit Hypotheses</h2>
          <p>Generated theses that connect budget posture, execution spend, contract timing, incumbent concentration, source evidence, counterpoints, and validation work into a decision record.</p>
        </div>
        <div className="hypotheses-hero__facts" aria-label="Hypothesis summary">
          <article>
            <strong>{summary.hypotheses || items.length}</strong>
            <span>hypotheses</span>
          </article>
          <article>
            <strong>{summary.strongHypotheses || 0}</strong>
            <span>strong theses</span>
          </article>
          <article>
            <strong>{summary.actNowHypotheses || 0}</strong>
            <span>act-now theses</span>
          </article>
          <article>
            <strong>{summary.topHypothesis || "n/a"}</strong>
            <span>top thesis</span>
          </article>
        </div>
      </section>

      <div className="hypothesis-shell">
        <aside className="hypothesis-picker" data-hypothesis-picker>
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              className={selected?.id === item.id ? "active" : ""}
              onClick={() => setSelectedId(item.id)}
            >
              <span>#{item.rank} · {item.status} · {item.confidenceLabel}</span>
              <strong>{item.title}</strong>
              <em>{item.buyer} · {item.workType?.label || "Uncoded"}</em>
            </button>
          ))}
        </aside>

        {selected ? (
          <div className="hypothesis-workspace">
            <Section title={selected.title} meta={`${selected.confidenceLabel} · confidence ${selected.confidence}`} icon={Lightbulb}>
              <div className="hypothesis-thesis" data-hypothesis-thesis>
                <article>
                  <span>Thesis</span>
                  <p>{selected.thesis}</p>
                </article>
                <article>
                  <span>Capture action</span>
                  <p>{selected.validationTasks?.[0]}</p>
                  <a href={selected.samSearchUrl} target="_blank" rel="noreferrer">
                    SAM search <ExternalLink size={12} aria-hidden="true" />
                  </a>
                </article>
              </div>
            </Section>

            <Section title="Evidence Board" meta="budget, execution, timing, and incumbent signals" icon={BarChart3}>
              <div className="hypothesis-metrics" data-hypothesis-metrics>
                {selectedMetricRows.map((row) => (
                  <article key={row.label}>
                    <span>{row.label}</span>
                    <strong>{row.value}</strong>
                    <p>{row.helper}</p>
                  </article>
                ))}
              </div>
            </Section>

            <div className="grid grid--sources">
              <Section title="Evidence" meta={`${selected.evidence?.length || 0} supporting points`} icon={FileText}>
                <div className="hypothesis-list hypothesis-list--evidence" data-hypothesis-evidence>
                  {(selected.evidence || []).map((item) => <article key={item}>{item}</article>)}
                </div>
              </Section>

              <Section title="Counterpoints" meta="what can break the thesis" icon={Filter}>
                <div className="hypothesis-list hypothesis-list--counterpoints" data-hypothesis-counterpoints>
                  {(selected.counterpoints || []).map((item) => <article key={item}>{item}</article>)}
                </div>
              </Section>
            </div>

            <Section title="Validation Plan" meta="turn the thesis into a capture decision" icon={ListChecks}>
              <div className="hypothesis-validation-grid" data-hypothesis-validation>
                {(selected.validationTasks || []).map((task, index) => (
                  <article key={task}>
                    <span>{String(index + 1).padStart(2, "0")}</span>
                    <strong>{task}</strong>
                  </article>
                ))}
              </div>
            </Section>

            <div className="grid grid--sources">
              <Section title="Linked Budget Lines" meta={`${selected.linkedBudgetLines?.length || 0} source examples`} icon={FileText}>
                <div className="relationship-line-list" data-hypothesis-budget-lines>
                  {(selected.linkedBudgetLines || []).map((line) => (
                    <article key={line.id}>
                      <div>
                        <strong>{line.title}</strong>
                        <span>{line.orgName} · {line.colorShort} · {line.justificationEvidence?.confidenceLabel || "Title-tagged only"}</span>
                      </div>
                      <b>{money(line.fy2027)}</b>
                    </article>
                  ))}
                </div>
              </Section>

              <Section title="Linked Awards" meta={`${selected.linkedAwards?.length || 0} award examples`} icon={FileSpreadsheet}>
                <div className="relationship-award-list" data-hypothesis-awards>
                  {(selected.linkedAwards || []).map((award) => (
                    <article key={award.id}>
                      <div>
                        <strong>{award.awardId || award.id}</strong>
                        <span>{award.recipient} · {award.endDate ? `ends ${award.endDate}` : "end unknown"}</span>
                      </div>
                      <b>{money(award.awardAmount)}</b>
                    </article>
                  ))}
                </div>
              </Section>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

const BUDGET_FILTER_DEFAULTS = { query: "", book: "all", group: "all", signal: "all", org: "all" };

function ResetFilters({ filters, defaults, onReset }) {
  const active = Object.keys(defaults).some((key) => filters[key] !== defaults[key]);
  return (
    <button type="button" className="reset-filters" onClick={onReset} disabled={!active}>
      <RotateCcw size={14} aria-hidden="true" /> Reset
    </button>
  );
}

function ControlField({ label, value, options, onChange, ariaLabel = label, searchable }) {
  return <div className="control-field"><span>{label}</span><ControlSelect value={value} options={options} onChange={onChange} ariaLabel={ariaLabel} searchable={searchable} /></div>;
}

function FilterShell({ filters, setFilters }) {
  const orgs = useMemo(() => aggregate(data.records, (record) => ({ id: record.org, label: record.orgName })).slice(0, 40), []);

  return (
    <div className="if-control-bar filters" aria-label="Budget filters" data-budget-filter-bar>
      <label className="searchbox">
        <Search size={15} aria-hidden="true" />
        <input
          placeholder="Search line items, accounts, organizations"
          value={filters.query}
          onChange={(event) => setFilters({ ...filters, query: event.target.value })}
        />
      </label>
      <div className="filters__secondary">
        <ControlField label="Color" value={filters.book} options={[["all", "All colors"], ...BOOKS.map((book) => [book.id, `${book.short} · ${book.color}`])]} onChange={(book) => setFilters({ ...filters, book })} />
        <ControlField label="Org type" value={filters.group} options={[["all", "All DoD"], ["service", "Services"], ["fourth-estate", "Fourth Estate"], ["other", "Other / Reconciliation"]]} onChange={(group) => setFilters({ ...filters, group })} />
        <ControlField label="Signal" value={filters.signal} options={[["all", "All signals"], ...SIGNALS.map((signal) => [signal.id, signal.label])]} onChange={(signal) => setFilters({ ...filters, signal })} />
        <ControlField label="Organization" searchable value={filters.org} options={[["all", "All organizations"], ...orgs.map((org) => [org.id, org.label])]} onChange={(org) => setFilters({ ...filters, org })} />
        <ResetFilters filters={filters} defaults={BUDGET_FILTER_DEFAULTS} onReset={() => setFilters(BUDGET_FILTER_DEFAULTS)} />
      </div>
    </div>
  );
}

function useFilteredRecords(filters) {
  return useMemo(() => {
    const query = filters.query.trim().toLowerCase();
    return data.records.filter((record) => {
      if (filters.book !== "all" && record.bookId !== filters.book) return false;
      if (filters.group !== "all" && record.orgGroup !== filters.group) return false;
      if (filters.signal !== "all" && !record.signals.includes(filters.signal)) return false;
      if (filters.org !== "all" && record.org !== filters.org) return false;
      if (!query) return true;
      return [
        record.accountTitle,
        record.orgName,
        record.budgetActivityTitle,
        record.subActivityTitle,
        record.lineTitle,
        record.lineCode,
      ].join(" ").toLowerCase().includes(query);
    });
  }, [filters]);
}

function Overview({ records }) {
  const byBook = aggregate(records, (record) => ({ id: record.bookId, label: record.color, short: record.colorShort }));
  const byOrgGroup = aggregate(records, (record) => ({ id: record.orgGroup, label: GROUP_LABELS[record.orgGroup] }));
  const bySignal = SIGNALS.map((signal) => aggregate(records.filter((record) => record.signals.includes(signal.id)), () => ({ id: signal.id, label: signal.label }))[0])
    .filter(Boolean)
    .sort((a, b) => b.fy2027 - a.fy2027);
  const maxBook = Math.max(...byBook.map((row) => row.fy2027), 1);
  const maxSignal = Math.max(...bySignal.map((row) => row.fy2027), 1);

  return (
    <div className="grid">
      <PhaseIntro
        eyebrow="Official source request"
        description="Line-level President's Budget defense request data from official Comptroller display books. Values remain separate from apportionments, obligations, awards, and transactions."
        dataAttribute={{ "data-pdb-request-page": true }}
      />
      <div className="grid grid--wide">
        <Section title="Color of Money" meta="FY2027 request" icon={Layers}>
          <div className="rank-list">
            {byBook.map((row) => (
              <article key={row.id}>
                <i className="dot" style={{ background: BOOK_COLORS[row.id] }} />
                <div>
                  <strong>{row.short}</strong>
                  <span>{row.label}</span>
                </div>
                <Bar value={row.fy2027} max={maxBook} color={BOOK_COLORS[row.id]} label={row.label} />
                <b>{money(row.fy2027)}</b>
              </article>
            ))}
          </div>
        </Section>
        <Section title="Service / Fourth Estate" meta="FY2025-FY2027" icon={Building2}>
          <div className="group-list">
            {byOrgGroup.map((row) => (
              <article key={row.id}>
                <div>
                  <strong>{row.label}</strong>
                  <span>{row.records} line records</span>
                </div>
                <Spark row={row} />
                <b>{money(row.fy2027)}</b>
                <em>{pct(growth(row))}</em>
              </article>
            ))}
          </div>
        </Section>
        <Section title="Mission Signals" meta="keyword-derived from line titles" icon={Filter}>
          <div className="signal-grid">
            {bySignal.map((row) => (
              <article key={row.id}>
                <strong>{row.label}</strong>
                <Bar value={row.fy2027} max={maxSignal} color="#005ea2" label={row.label} />
                <span>{money(row.fy2027)} · {pct(growth(row))}</span>
              </article>
            ))}
          </div>
        </Section>
      </div>
    </div>
  );
}

function RequestTrends() {
  const rows = REQUEST_HISTORY;
  const firstComparable = rows.find((row) => row.comparableRequestValue > 0);
  const latest = rows.at(-1);
  const maxRequest = Math.max(...rows.map((row) => row.requestValue), 1);
  const maxComparable = Math.max(...rows.map((row) => row.comparableRequestValue), 1);
  const aiSeries = rows.map((row) => row.bySignal?.find((signal) => signal.id === "ai-autonomy") || { requestValue: 0, records: 0 });
  const colorTrendRows = BOOKS.map((book) => ({
    ...book,
    series: rows.map((row) => row.byBook?.find((item) => item.id === book.id)?.requestValue || 0),
  }));
  const signalTrendRows = (latest?.bySignal || [])
    .filter((signal) => signal.requestValue > 0)
    .slice(0, 8)
    .map((signal) => ({
      ...signal,
      series: rows.map((row) => row.bySignal?.find((item) => item.id === signal.id)?.requestValue || 0),
    }));

  return (
    <div className="grid">
      <PhaseIntro
        eyebrow="Published request vintages"
        description="Year-over-year request values from official budget packages. Comparable trends use only books present across the compared vintages; keyword-derived categories remain labeled as classifications."
        dataAttribute={{ "data-request-history-page": true }}
      />
      <section className="source-metrics trend-metrics" aria-label="Request trend summary">
        <Metric label="Request vintages" value={`${DATA_INVENTORY.availableBudgetRequestYears.length} years`} helper={`${yearList(DATA_INVENTORY.availableBudgetRequestYears)} · ${TREND_SUMMARY.sourceVersionCount || 0} workbook versions`} />
        <Metric label="Historical records" value={(TREND_SUMMARY.historicalRecordCount || 0).toLocaleString()} helper="Aggregate model records across request packages" tone="purple" />
        <Metric label="Comparable set" value={`${TREND_SUMMARY.comparableBookCount || 0} books`} helper={(TREND_SUMMARY.comparableBooks || []).join(", ")} tone="green" />
        <Metric label="Comparable trend" value={pct(TREND_SUMMARY.comparableGrowth || 0)} helper={`${money(TREND_SUMMARY.comparableEarliestRequestValue)} FY${TREND_SUMMARY.comparableEarliestRequestYear} to ${money(TREND_SUMMARY.comparableCurrentRequestValue)} FY${latest?.requestYear}`} tone="orange" />
      </section>

      <Section title="Request Vintage Timeline" meta="annual President's Budget packages" icon={CalendarClock}>
        <div className="trend-year-list" data-request-history-timeline>
          {rows.map((row) => (
            <article key={row.requestYear} className="trend-year-card">
              <header>
                <div>
                  <span>{row.sourcePackage}</span>
                  <strong>{row.label}</strong>
                </div>
                <b>{money(row.requestValue)}</b>
              </header>
              <Bar value={row.requestValue} max={maxRequest} color="#005ea2" label={`${row.label} request value`} />
              <dl>
                <div>
                  <dt>Source versions</dt>
                  <dd>{row.sourceVersions}</dd>
                </div>
                <div>
                  <dt>Records</dt>
                  <dd>{row.records.toLocaleString()}</dd>
                </div>
                <div>
                  <dt>Values present</dt>
                  <dd>{yearList(row.fiscalYears)}</dd>
                </div>
                <div>
                  <dt>Comparable books</dt>
                  <dd>{money(row.comparableRequestValue)}</dd>
                </div>
              </dl>
            </article>
          ))}
        </div>
      </Section>

      <div className="grid grid--sources">
        <Section title="Comparable Request Trend" meta={`${(TREND_SUMMARY.comparableBooks || []).join(", ")} only`} icon={TrendingUp}>
          <div className="trend-comparable-list" data-comparable-request-trend>
            {rows.map((row) => (
              <article key={row.requestYear}>
                <div>
                  <strong>{row.label}</strong>
                  <span>{firstComparable ? pct(requestGrowth(row.comparableRequestValue, firstComparable.comparableRequestValue)) : "+0.0%"}</span>
                </div>
                <Bar value={row.comparableRequestValue} max={maxComparable} color="#216e1f" label={`${row.label} comparable request value`} />
                <b>{money(row.comparableRequestValue)}</b>
              </article>
            ))}
          </div>
        </Section>

        <Section title="AI / Autonomy Signal History" meta="keyword-derived request vintages" icon={BrainCircuit}>
          <div className="trend-comparable-list" data-ai-signal-history>
            {rows.map((row, index) => (
              <article key={row.requestYear}>
                <div>
                  <strong>{row.label}</strong>
                  <span>{aiSeries[index].records.toLocaleString()} records</span>
                </div>
                <Bar value={aiSeries[index].requestValue} max={Math.max(...aiSeries.map((item) => item.requestValue), 1)} color="#5c4b8a" label={`${row.label} AI/autonomy request value`} />
                <b>{money(aiSeries[index].requestValue)}</b>
              </article>
            ))}
          </div>
        </Section>
      </div>

      <Section title="Largest Request Changes" meta="largest FY2026-FY2027 changes by keyword-derived mission signal" icon={TrendingUp}>
        <div className="momentum-grid" data-momentum-leaders>
          {(ANALYTICS.signalMomentum || []).slice(0, 6).map((row) => (
            <article key={row.id} className="momentum-card">
              <header>
                <div>
                  <span>Mission signal</span>
                  <strong>{row.label}</strong>
                </div>
                <b>{pct(row.lastChangePct)}</b>
              </header>
              <p>{money(row.priorValue)} FY{row.priorYear} to {money(row.latestValue)} FY{row.latestYear}</p>
              <Bar value={row.latestValue} max={Math.max(...(ANALYTICS.signalMomentum || []).map((item) => item.latestValue), 1)} color="#005ea2" label={`${row.label} latest value`} />
            </article>
          ))}
        </div>
      </Section>

      <Section title="Color Of Money History" meta="request value by workbook vintage" icon={Layers}>
        <div className="trend-series-grid" data-color-money-history>
          {colorTrendRows.map((row) => (
            <article key={row.id} className="trend-series-card">
              <header>
                <i className="dot" style={{ background: BOOK_COLORS[row.id] }} />
                <div>
                  <strong>{row.short}</strong>
                  <span>{row.color}</span>
                </div>
                <b>{money(row.series.at(-1))}</b>
              </header>
              <div className="mini-bars" aria-label={`${row.short} request value history`}>
                {row.series.map((value, index) => (
                  <span key={`${row.id}-${rows[index].requestYear}`}>
                    <i style={{ height: `${Math.max((value / Math.max(...row.series, 1)) * 100, value ? 6 : 2)}%`, background: BOOK_COLORS[row.id] }} />
                    <em>FY{rows[index].requestYear}</em>
                  </span>
                ))}
              </div>
            </article>
          ))}
        </div>
      </Section>

      <Section title="Mission Signal Movement" meta="latest-vintage leading signals" icon={Filter}>
        <div className="trend-series-grid" data-mission-signal-history>
          {signalTrendRows.map((row) => (
            <article key={row.id} className="trend-series-card trend-series-card--signal">
              <header>
                <div>
                  <strong>{row.label}</strong>
                  <span>{row.records.toLocaleString()} latest records</span>
                </div>
                <b>{money(row.requestValue)}</b>
              </header>
              <div className="mini-bars" aria-label={`${row.label} request value history`}>
                {row.series.map((value, index) => (
                  <span key={`${row.id}-${rows[index].requestYear}`}>
                    <i style={{ height: `${Math.max((value / Math.max(...row.series, 1)) * 100, value ? 6 : 2)}%`, background: "#005ea2" }} />
                    <em>FY{rows[index].requestYear}</em>
                  </span>
                ))}
              </div>
            </article>
          ))}
        </div>
      </Section>
    </div>
  );
}

// eslint-disable-next-line no-unused-vars
function Strategy() {
  const areas = STRATEGY.technologyAreas || [];
  const summary = STRATEGY.summary || {};
  const serviceRows = STRATEGY.serviceStrategy || [];
  const intersections = STRATEGY.strategyIntersections || [];
  const alignmentRows = STRATEGY.budgetExecutionAlignment || [];
  const buyerPursuitLanes = STRATEGY.buyerPursuitLanes || [];
  const execution = EXECUTION || {};
  const trends = execution.trends || {};
  const trendPeriods = trends.periods || [];
  const recentTotalPeriods = (trends.totalByPeriod || []).slice(-6);
  const maxTrendTotal = Math.max(...recentTotalPeriods.map((period) => period.awardAmount || 0), 1);
  const [selectedAreaId, setSelectedAreaId] = useUrlSelection(areas[0]?.id || "all", areas.map((area) => area.id));
  const [expanded, setExpanded] = useState(false);
  const selectedArea = areas.find((area) => area.id === selectedAreaId) || areas[0];
  const maxArea = Math.max(...areas.map((area) => area.fy2027), 1);
  const maxClient = Math.max(...intersections.map((lane) => lane.fy2027), 1);

  return (
    <div className={`grid strategy-page${expanded ? " is-expanded" : ""}`} data-strategy-page>
      <AnalyticsReadout title="Portfolio Strategy" meta="technology, service, and organization posture" items={STRATEGY.readouts || []} icon={GitBranch} />

      <section className="strategy-hero">
        <div>
          <span>Strategy model</span>
          <h2>Technology Area Drilldown</h2>
          <p>Start with budget posture, compare technology concentration, then inspect service and organization lanes with source-line evidence. First-pass justification narratives now confirm part of the model; remaining gaps show where the next ingest should go.</p>
        </div>
        <div className="strategy-hero__facts" aria-label="Strategy summary">
          <article>
            <strong>{summary.technologyAreaCount || areas.length}</strong>
            <span>technology areas</span>
          </article>
          <article>
            <strong>{(summary.taggedRecords || 0).toLocaleString()}</strong>
            <span>tagged lines</span>
          </article>
          <article>
            <strong>{money(summary.taggedFy2027 || 0)}</strong>
            <span>tagged FY2027</span>
          </article>
          <article>
            <strong>{summary.narrativeConfirmedTechnologyRecords || 0}</strong>
            <span>narrative-confirmed lines</span>
          </article>
        </div>
      </section>

      <MobileDisclosure expanded={expanded} onToggle={setExpanded} label="strategy evidence" />

      <div className="grid grid--sources">
        <Section title="Technology Areas" meta="FY2027 tagged request value" icon={BrainCircuit}>
          <div className="technology-area-list" data-technology-area-list>
            {areas.map((area) => (
              <button
                key={area.id}
                type="button"
                className={selectedArea?.id === area.id ? "active" : ""}
                onClick={() => setSelectedAreaId(area.id)}
              >
                <div>
                  <strong>{area.label}</strong>
                  <span>{area.records.toLocaleString()} lines · {area.narrativeConfirmedRecords || 0} confirmed · {pct(area.growth)}</span>
                </div>
                <Bar value={area.fy2027} max={maxArea} color="#005ea2" label={`${area.label} FY2027 value`} />
                <b>{money(area.fy2027)}</b>
              </button>
            ))}
          </div>
        </Section>

        <Section title="Service Strategy" meta="top technology lanes by service" icon={Building2}>
          <div className="service-strategy-grid" data-service-strategy-grid>
            {serviceRows.map((service) => (
              <article key={service.id} className="service-strategy-card">
                <header>
                  <div>
                    <span>{service.records.toLocaleString()} current lines</span>
                    <strong>{service.label}</strong>
                  </div>
                  <b>{money(service.fy2027)}</b>
                </header>
                <div>
                  {service.topTechnologyAreas.map((area) => (
                    <span key={`${service.id}-${area.id}`}>
                      <strong>{area.label}</strong>
                      <em>{money(area.fy2027)}</em>
                    </span>
                  ))}
                </div>
              </article>
            ))}
          </div>
        </Section>
      </div>

      <Section title="Client / Technology Strategy Lanes" meta="ranked by scale, growth, and line depth" icon={TrendingUp}>
        <div className="strategy-lane-grid" data-strategy-lane-grid>
          {intersections.slice(0, 12).map((lane) => (
            <article key={lane.id} className="strategy-lane-card">
              <header>
                <div>
                  <span>{GROUP_LABELS[lane.group] || "Client"}</span>
                  <strong>{lane.client}</strong>
                </div>
                <b>{lane.score}</b>
              </header>
              <p>{lane.area}</p>
              <Bar value={lane.fy2027} max={maxClient} color={lane.group === "service" ? "#005ea2" : "#216e1f"} label={`${lane.client} ${lane.area}`} />
              <footer>
                <span>{money(lane.fy2027)}</span>
                <span>{lane.records} lines</span>
                <span>{lane.confidence}</span>
                <span>{pct(lane.growth)}</span>
              </footer>
            </article>
          ))}
        </div>
      </Section>

      <div className="grid grid--sources">
        <Section title="Execution Buyers" meta="USAspending sampled award value" icon={Building2}>
          <div className="execution-rank-list" data-execution-buyers>
            {(execution.topBuyers || []).slice(0, 8).map((buyer) => (
              <article key={buyer.id}>
                <div>
                  <strong>{buyer.label}</strong>
                  <span>{buyer.group} · {buyer.awards} awards · {(buyer.areas || []).slice(0, 2).join(", ")}</span>
                </div>
                <b>{money(buyer.awardAmount)}</b>
              </article>
            ))}
          </div>
        </Section>

        <Section title="Execution Vendors" meta="USAspending sampled award value" icon={Database}>
          <div className="execution-rank-list" data-execution-vendors>
            {(execution.topVendors || []).slice(0, 8).map((vendor) => (
              <article key={vendor.id}>
                <div>
                  <strong>{vendor.label}</strong>
                  <span>{vendor.awards} awards · {(vendor.areas || []).slice(0, 2).join(", ")}</span>
                </div>
                <b>{money(vendor.awardAmount)}</b>
              </article>
            ))}
          </div>
        </Section>
      </div>

      <Section title="Execution Trend Model" meta="USAspending quarterly contract obligations" icon={CalendarClock}>
        <div className="execution-trend-overview" data-execution-trends>
          <article className="execution-trend-total">
            <header>
              <div>
                <span>Sampled obligation timeline</span>
                <strong>{EXECUTION_COVERAGE.trendPeriodCount || trendPeriods.length} fiscal quarters</strong>
              </div>
              <b>{EXECUTION_COVERAGE.latestTrendPeriod || recentTotalPeriods.at(-1)?.label || "n/a"}</b>
            </header>
            <div className="execution-total-bars" aria-label="Total sampled award value by fiscal quarter">
              {recentTotalPeriods.map((period) => (
                <span key={period.id}>
                  <i style={{ height: `${Math.max(((period.awardAmount || 0) / maxTrendTotal) * 100, period.awardAmount ? 8 : 2)}%` }} />
                  <em>{period.label.replace("FY20", "FY")}</em>
                  <strong>{money(period.awardAmount)}</strong>
                </span>
              ))}
            </div>
          </article>
          <ExecutionTrendList title="Technology area movement" rows={trends.byTechnologyArea || []} periods={trendPeriods} />
          <ExecutionTrendList title="Buyer agency movement" rows={trends.byBuyerAgency || []} periods={trendPeriods} />
          <ExecutionTrendList title="Vendor movement" rows={trends.byVendor || []} periods={trendPeriods} />
          <ExecutionTrendList title="PSC movement" rows={trends.byPsc || []} periods={trendPeriods} />
          <ExecutionTrendList title="NAICS movement" rows={trends.byNaics || []} periods={trendPeriods} />
        </div>
      </Section>

      <Section title="Budget / Execution Alignment" meta="FY2027 request posture against FY2025-FY2026 contract obligations" icon={GitBranch}>
        <div className="budget-execution-alignment" data-budget-execution-alignment>
          {alignmentRows.map((lane) => (
            <article key={lane.id} className="alignment-card">
              <header>
                <div>
                  <span>{lane.confidence}</span>
                  <strong>{lane.label}</strong>
                </div>
                <b>{lane.score}</b>
              </header>
              <p>{lane.interpretation}</p>
              <dl>
                <div>
                  <dt>FY2027 request</dt>
                  <dd>{money(lane.fy2027)}</dd>
                </div>
                <div>
                  <dt>FY2025-FY2026 obligations</dt>
                  <dd>{money(lane.executionObligationAmount)}</dd>
                </div>
                <div>
                  <dt>Latest two quarters</dt>
                  <dd>{money(lane.latestExecutionObligationAmount)} · {pct(lane.executionObligationMomentum)}</dd>
                </div>
                <div>
                  <dt>Top buyer</dt>
                  <dd>{lane.topBuyer}</dd>
                </div>
                <div>
                  <dt>Top vendor</dt>
                  <dd>{lane.topVendor}</dd>
                </div>
                <div>
                  <dt>Evidence</dt>
                  <dd>{lane.narrativeConfirmedRecords} confirmed lines</dd>
                </div>
              </dl>
            </article>
          ))}
        </div>
      </Section>

      <Section title="Buyer Pursuit Lanes" meta="technology area, buyer, work type, and incumbent signal" icon={Building2}>
        <div className="buyer-pursuit-grid" data-buyer-pursuit-lanes>
          {buyerPursuitLanes.map((lane) => (
            <article key={lane.id} className="buyer-pursuit-card">
              <header>
                <div>
                  <span>{lane.buyerGroup} · {lane.area}</span>
                  <strong>{lane.buyer}</strong>
                </div>
                <b>{lane.score}</b>
              </header>
              <p>{lane.rationale}</p>
              <dl>
                <div>
                  <dt>Sampled awards</dt>
                  <dd>{money(lane.awardAmount)} · {lane.awards} awards</dd>
                </div>
                <div>
                  <dt>Budget context</dt>
                  <dd>{lane.budgetFy2027 ? `${money(lane.budgetFy2027)} · ${pct(lane.budgetGrowth)}` : `${money(lane.areaFy2027)} area`}</dd>
                </div>
                <div>
                  <dt>Top work type</dt>
                  <dd>{lane.topWorkType}</dd>
                </div>
                <div>
                  <dt>Top vendor</dt>
                  <dd>{lane.topVendor}</dd>
                </div>
              </dl>
            </article>
          ))}
        </div>
      </Section>

      {selectedArea ? (
        <div className="grid grid--sources">
          <Section title={`${selectedArea.label} Organization Concentration`} meta="top services and defense organizations" icon={Building2}>
            <div className="selected-area-list" data-selected-tech-clients>
              {selectedArea.byClient.map((client) => (
                <article key={`${selectedArea.id}-${client.id}`}>
                  <div>
                    <strong>{client.label}</strong>
                    <span>{GROUP_LABELS[client.group] || "Client"} · {client.records} lines</span>
                  </div>
                  <Bar value={client.fy2027} max={Math.max(...selectedArea.byClient.map((item) => item.fy2027), 1)} color={client.group === "service" ? "#005ea2" : "#216e1f"} label={client.label} />
                  <b>{money(client.fy2027)}</b>
                </article>
              ))}
            </div>
          </Section>

          <Section title={`${selectedArea.label} Strategy Questions`} meta="planning prompts" icon={GitBranch}>
            <div className="talking-point-list" data-talking-points>
              {selectedArea.conversations.map((item) => (
                <article key={item}>
                  <strong>{item}</strong>
                  <span>{money(selectedArea.fy2027)} tagged FY2027 · {selectedArea.records.toLocaleString()} source lines</span>
                </article>
              ))}
            </div>
          </Section>
        </div>
      ) : null}

      {selectedArea ? (
        <Section title={`${selectedArea.label} Execution Signals`} meta={`${selectedArea.executionAwards || 0} USAspending sampled awards`} icon={Database}>
          <div className="area-execution-grid" data-area-execution>
            <article className="area-execution-fit">
              <span>Services fit</span>
              <strong>{selectedArea.serviceFit}</strong>
              <p>{money(selectedArea.executionAwardAmount || 0)} in sampled award value across top matching USAspending results.</p>
            </article>
            {(selectedArea.topExecutionAwards || []).slice(0, 5).map((award) => (
              <article key={`${selectedArea.id}-${award.id}`} className="area-execution-award">
                <header>
                  <div>
                    <span>{award.buyerSubAgency}</span>
                    <strong>{award.recipient}</strong>
                  </div>
                  <b>{money(award.awardAmount)}</b>
                </header>
                <p>{award.description}</p>
                <footer>
                  <span>{award.contractType}</span>
                  <span>{award.pscCode || award.naicsCode}</span>
                  <span>{award.endDate ? `Ends ${award.endDate}` : "End date unknown"}</span>
                </footer>
              </article>
            ))}
          </div>
        </Section>
      ) : null}

      {selectedArea ? (
        <Section title={`${selectedArea.label} Narrative Evidence`} meta={`${selectedArea.narrativeConfirmedRecords || 0} narrative-confirmed source lines`} icon={FileText}>
          <div className="narrative-evidence-grid" data-narrative-evidence>
            {(selectedArea.evidenceExamples || []).map((line) => (
              <article key={`${selectedArea.id}-${line.id}`} className="narrative-evidence-card">
                <header>
                  <div>
                    <span>{line.justificationEvidence.kind} · {line.justificationEvidence.confidenceLabel}</span>
                    <strong>{line.title}</strong>
                  </div>
                  <a href={line.justificationEvidence.sourcePdfUrl || line.justificationEvidence.sourceUrl} target="_blank" rel="noreferrer" aria-label={`${line.title} justification source`}>
                    <ExternalLink size={15} aria-hidden="true" />
                  </a>
                </header>
                <p>{line.justificationEvidence.snippets[0]}</p>
                <footer>
                  <span>{line.orgName}</span>
                  <span>{line.colorShort}</span>
                  <span>{money(line.fy2027)}</span>
                </footer>
              </article>
            ))}
          </div>
        </Section>
      ) : null}

      {selectedArea ? (
        <Section title={`${selectedArea.label} Source Lines`} meta="largest current lines" icon={Search}>
          <div className="strategy-line-table" data-strategy-line-table>
            <table>
              <thead>
                <tr>
                  <th>Line item</th>
                  <th>Client / org</th>
                  <th>Color</th>
                  <th>FY2027</th>
                  <th>Trend</th>
                  <th>Evidence</th>
                </tr>
              </thead>
              <tbody>
                {selectedArea.topLines.map((line) => (
                  <tr key={line.id}>
                    <td><strong>{line.title}</strong></td>
                    <td>{line.orgName}</td>
                    <td><i className="dot" style={{ background: BOOK_COLORS[line.bookId] }} />{line.colorShort}</td>
                    <td>{money(line.fy2027)}</td>
                    <td>{pct(line.growth)}</td>
                    <td>{line.justificationEvidence?.confidenceLabel || "Title only"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      ) : null}
    </div>
  );
}

// eslint-disable-next-line no-unused-vars
function Services({ records }) {
  const serviceRecords = records.filter((record) => record.orgGroup === "service");
  const services = aggregate(serviceRecords, (record) => ({ id: record.org, label: record.orgName }));
  const serviceBookRows = services.map((service) => ({
    ...service,
    books: BOOKS.map((book) => ({
      ...book,
      value: sum(serviceRecords.filter((record) => record.org === service.id && record.bookId === book.id), "fy2027"),
    })),
  }));

  return (
    <Section title="Service Comparison" meta="FY2027 by color of money" icon={Building2}>
      <div className="matrix">
        <div className="matrix__head">
          <span>Service</span>
          {BOOKS.map((book) => <span key={book.id}>{book.short}</span>)}
          <span>Total</span>
          <span>Trend</span>
        </div>
        {serviceBookRows.map((row) => (
          <div key={row.id} className="matrix__row">
            <strong>{row.label}</strong>
            {row.books.map((book) => <span key={book.id}>{money(book.value)}</span>)}
            <b>{money(row.fy2027)}</b>
            <em>{pct(growth(row))}</em>
          </div>
        ))}
      </div>
    </Section>
  );
}

// eslint-disable-next-line no-unused-vars
function FourthEstate({ records }) {
  const rows = aggregate(records.filter((record) => record.orgGroup === "fourth-estate"), (record) => ({ id: record.org, label: record.orgName })).slice(0, 24);
  const max = Math.max(...rows.map((row) => row.fy2027), 1);
  return (
    <Section title="Fourth Estate Ranking" meta="Defense-wide agencies, OSD, and joint organizations" icon={Layers}>
      <div className="agency-list">
        {rows.map((row, index) => (
          <article key={row.id}>
            <span>{String(index + 1).padStart(2, "0")}</span>
            <div>
              <strong>{row.label}</strong>
              <Bar value={row.fy2027} max={max} color="#4d8055" label={row.label} />
            </div>
            <b>{money(row.fy2027)}</b>
            <em>{pct(growth(row))}</em>
          </article>
        ))}
      </div>
    </Section>
  );
}

// eslint-disable-next-line no-unused-vars
function AiAutonomy({ records }) {
  const aiRecords = records.filter((record) => record.signals.includes("ai-autonomy"));
  const byOrg = aggregate(aiRecords, (record) => ({ id: record.org, label: record.orgName, group: record.orgGroup })).slice(0, 12);
  const byService = aggregate(aiRecords.filter((record) => record.orgGroup === "service"), (record) => ({ id: record.org, label: record.orgName, group: record.orgGroup }));
  const byBook = aggregate(aiRecords, (record) => ({ id: record.bookId, label: record.color, short: record.colorShort }));
  const maxOrg = Math.max(...byOrg.map((row) => row.fy2027), 1);
  const maxService = Math.max(...byService.map((row) => row.fy2027), 1);
  const maxBook = Math.max(...byBook.map((row) => row.fy2027), 1);

  return (
    <div className="grid">
      <AnalyticsReadout
        title="AI / Autonomy Readout"
        meta="directional keyword signal"
        items={(ANALYTICS.observations || []).filter((item) => item.id === "ai-autonomy-spike")}
        icon={BrainCircuit}
      />
      <Section title="AI / Autonomy By Service" meta="FY2027 and two-year direction" icon={Building2}>
        <div className="agency-list compact">
          {byService.map((row, index) => (
            <article key={row.id}>
              <span>{String(index + 1).padStart(2, "0")}</span>
              <div>
                <strong>{row.label}</strong>
                <Bar value={row.fy2027} max={maxService} color="#1a4480" label={row.label} />
              </div>
              <b>{money(row.fy2027)}</b>
              <em>{pct(growth(row))}</em>
            </article>
          ))}
        </div>
      </Section>
      <Section title="Who Is Spending Most On AI / Autonomy" meta="FY2027 keyword signal" icon={BrainCircuit}>
        <div className="agency-list compact">
          {byOrg.map((row, index) => (
            <article key={row.id}>
              <span>{String(index + 1).padStart(2, "0")}</span>
              <div>
                <strong>{row.label}</strong>
                <Bar value={row.fy2027} max={maxOrg} color={row.group === "service" ? "#1a4480" : "#4d8055"} label={row.label} />
              </div>
              <b>{money(row.fy2027)}</b>
              <em>{pct(growth(row))}</em>
            </article>
          ))}
        </div>
      </Section>
      <Section title="AI By Color Of Money" meta="FY2025-FY2027" icon={GitBranch}>
        <div className="rank-list">
          {byBook.map((row) => (
            <article key={row.id}>
              <i className="dot" style={{ background: BOOK_COLORS[row.id] }} />
              <div>
                <strong>{row.short}</strong>
                <span>{row.label}</span>
              </div>
              <Bar value={row.fy2027} max={maxBook} color={BOOK_COLORS[row.id]} label={row.label} />
              <b>{money(row.fy2027)}</b>
            </article>
          ))}
        </div>
      </Section>
      <Section title="Largest AI / Autonomy Lines" meta="source line items" icon={Search}>
        <RecordTable records={aiRecords.sort((a, b) => b.fy2027 - a.fy2027).slice(0, 14)} compact />
      </Section>
    </div>
  );
}

function RecordTable({ records, compact = false }) {
  const [evidenceRecord, setEvidenceRecord] = useState(null);
  const columns = [
    {
      key: "line",
      label: "Line item",
      required: true,
      sticky: true,
      minWidth: 280,
      value: (record) => record.lineTitle || record.budgetActivityTitle || record.accountTitle,
      searchValue: (record) => [record.lineTitle, record.budgetActivityTitle, record.accountTitle],
      render: (record) => <><strong>{record.lineTitle || record.budgetActivityTitle || record.accountTitle}</strong>{!compact ? <small>{record.accountTitle} · {record.budgetActivityTitle}</small> : null}</>,
    },
    { key: "org", label: "Organization", facet: true, minWidth: 170, value: (record) => record.orgName },
    {
      key: "color",
      label: "Color of money",
      facet: true,
      minWidth: 130,
      value: (record) => record.colorShort,
      render: (record) => <span className="dbi-table-color"><i className="dot" style={{ background: BOOK_COLORS[record.bookId] }} />{record.colorShort}</span>,
    },
    { key: "fy2025", label: "FY25", align: "right", sortValue: (record) => Number(record.fy2025 || 0), exportValue: (record) => record.fy2025, render: (record) => money(record.fy2025) },
    { key: "fy2026", label: "FY26", align: "right", sortValue: (record) => Number(record.fy2026 || 0), exportValue: (record) => record.fy2026, render: (record) => money(record.fy2026) },
    { key: "fy2027", label: "FY27", align: "right", sortValue: (record) => Number(record.fy2027 || 0), exportValue: (record) => record.fy2027, render: (record) => money(record.fy2027) },
    { key: "trend", label: "Trend", sortValue: growth, exportValue: growth, render: (record) => pct(growth(record)) },
    {
      key: "actions",
      label: "Actions",
      role: "actions",
      sortable: false,
      required: true,
      render: (record) => <div className="dbi-table-actions"><a href={sourceUrlForRow(record)} target="_blank" rel="noreferrer">Source<ExternalLink size={12} /></a><button type="button" onClick={() => setEvidenceRecord(record)}>Details</button></div>,
    },
  ];
  return (
    <>
      <OperationalDataTable
        id={compact ? "budget-records-compact" : "budget-records"}
        label="Budget line items"
        rows={records}
        columns={columns}
        rowKey={(record) => record.id}
        defaultSort={{ key: "fy2027", direction: "desc" }}
        searchPlaceholder="Search line items, accounts, and organizations…"
        exportFilename="defense-budget-line-items.csv"
        wrapperProps={{ "data-budget-record-table": true }}
      />
      <EvidenceDrawer record={evidenceRecord} onClose={() => setEvidenceRecord(null)} />
    </>
  );
}

function awardOptionRows(awards, keyFn) {
  return [...new Map(awards.map(keyFn).filter((item) => item?.id).map((item) => [item.id, item])).values()]
    .sort((a, b) => a.label.localeCompare(b.label));
}

function Awards() {
  const awards = AWARD_DRILLDOWN.awards;
  const summary = AWARD_DRILLDOWN.summary || {};
  const defaults = { query: "", area: "all", buyer: "all", vendor: "all", workType: "all", sort: "amount" };
  const [filters, setFilters] = useUrlState(defaults, {
    area: (value) => value === "all" || awards.some((award) => (award.areaIds || []).includes(value)),
    buyer: (value) => value === "all" || awards.some((award) => award.buyerSubAgency === value),
    vendor: (value) => value === "all" || awards.some((award) => award.recipient === value),
    workType: (value) => value === "all" || awards.some((award) => value === `psc:${award.pscCode}` || value === `naics:${award.naicsCode}`),
    sort: ["amount", "end", "start", "vendor"],
  });
  const areaOptions = useMemo(() => awardOptionRows(awards.flatMap((award) => (award.areaIds || []).map((id, index) => ({ id, label: award.areas?.[index] || id }))), (item) => item), [awards]);
  const buyerOptions = useMemo(() => awardOptionRows(awards, (award) => ({ id: award.buyerSubAgency, label: award.buyerSubAgency })), [awards]);
  const vendorOptions = useMemo(() => awardOptionRows(awards, (award) => ({ id: award.recipient, label: award.recipient })), [awards]);
  const workTypeOptions = useMemo(() => awardOptionRows(awards.flatMap((award) => [
    award.pscCode ? { id: `psc:${award.pscCode}`, label: `${award.pscCode} · ${award.pscDescription || "Unlabeled PSC"}` } : null,
    award.naicsCode ? { id: `naics:${award.naicsCode}`, label: `${award.naicsCode} · ${award.naicsDescription || "Unlabeled NAICS"}` } : null,
  ]), (item) => item), [awards]);

  const filteredAwards = awards.filter((award) => {
    const query = filters.query.trim().toLowerCase();
    const workTypeMatch = filters.workType === "all"
      || filters.workType === `psc:${award.pscCode}`
      || filters.workType === `naics:${award.naicsCode}`;
    return (!query || [
      award.awardId,
      award.recipient,
      award.buyerSubAgency,
      award.awardingSubAgency,
      award.awardingOffice,
      award.fundingOffice,
      award.description,
      award.pscDescription,
      award.naicsDescription,
      ...(award.areas || []),
    ].join(" ").toLowerCase().includes(query))
      && (filters.area === "all" || (award.areaIds || []).includes(filters.area))
      && (filters.buyer === "all" || award.buyerSubAgency === filters.buyer)
      && (filters.vendor === "all" || award.recipient === filters.vendor)
      && workTypeMatch;
  }).sort((a, b) => {
    if (filters.sort === "end") return String(b.endDate || "").localeCompare(String(a.endDate || ""));
    if (filters.sort === "start") return String(b.startDate || "").localeCompare(String(a.startDate || ""));
    if (filters.sort === "vendor") return a.recipient.localeCompare(b.recipient) || b.awardAmount - a.awardAmount;
    return b.awardAmount - a.awardAmount;
  });
  const visibleAwards = filteredAwards.slice(0, 250);
  const filteredValue = sum(filteredAwards, "awardAmount");
  const filteredOfficeCount = filteredAwards.filter((award) => award.fundingOffice || award.awardingOffice).length;
  const topBuyer = aggregateAwardsForUi(filteredAwards, (award) => ({ id: award.buyerSubAgency, label: award.buyerSubAgency })).slice(0, 4);
  const topVendor = aggregateAwardsForUi(filteredAwards, (award) => ({ id: award.recipient, label: award.recipient })).slice(0, 4);
  const topWork = aggregateAwardsForUi(filteredAwards.filter((award) => award.pscCode || award.naicsCode), (award) => ({
    id: award.pscCode || award.naicsCode,
    label: award.pscCode ? `${award.pscCode} · ${award.pscDescription || "Unlabeled PSC"}` : `${award.naicsCode} · ${award.naicsDescription || "Unlabeled NAICS"}`,
  })).slice(0, 4);

  return (
    <div className="grid awards-page" data-awards-page>
      <PhaseIntro
        eyebrow="Award-level spend"
        description="Deduped contract award records from cached USAspending technology searches. This is a sampled award dataset, not exhaustive FPDS action history."
        tone="green"
        facts={[
          { value: (summary.awards || awards.length).toLocaleString(), label: "deduped awards" },
          { value: money(summary.sampledAwardValue || 0), label: "sampled value" },
          { value: summary.buyerCount || 0, label: "buyers" },
          { value: summary.vendorCount || 0, label: "vendors" },
        ]}
      />

      <div className="award-filter-bar" data-award-filter-bar>
        <label className="searchbox">
          <Search size={15} aria-hidden="true" />
          <input placeholder="Search award IDs, vendors, buyers, descriptions" value={filters.query} onChange={(event) => setFilters({ ...filters, query: event.target.value })} />
        </label>
        <ControlField label="Area" value={filters.area} options={[["all", "All areas"], ...areaOptions.map((option) => [option.id, option.label])]} onChange={(area) => setFilters({ ...filters, area })} />
        <ControlField label="Buyer" searchable value={filters.buyer} options={[["all", "All buyers"], ...buyerOptions.map((option) => [option.id, option.label])]} onChange={(buyer) => setFilters({ ...filters, buyer })} />
        <ControlField label="Vendor" searchable value={filters.vendor} options={[["all", "All vendors"], ...vendorOptions.map((option) => [option.id, option.label])]} onChange={(vendor) => setFilters({ ...filters, vendor })} />
        <ControlField label="Work type" searchable value={filters.workType} options={[["all", "All PSC / NAICS"], ...workTypeOptions.map((option) => [option.id, option.label])]} onChange={(workType) => setFilters({ ...filters, workType })} />
        <ControlField label="Sort" value={filters.sort} options={[["amount", "Award value"], ["end", "End date"], ["start", "Start date"], ["vendor", "Vendor"]]} onChange={(sort) => setFilters({ ...filters, sort })} />
        <ResetFilters filters={filters} defaults={defaults} onReset={() => setFilters(defaults)} />
      </div>

      <section className="if-metric-grid source-metrics" aria-label="Award filter metrics">
        <Metric label="Filtered awards" value={filteredAwards.length.toLocaleString()} helper={`${visibleAwards.length.toLocaleString()} shown in table`} />
        <Metric label="Filtered value" value={money(filteredValue)} helper="Deduped award amount from current filters" tone="green" />
        <Metric label="Largest buyer" value={topBuyer[0]?.label || "n/a"} helper={topBuyer[0] ? `${money(topBuyer[0].awardAmount)} · ${topBuyer[0].awards} awards` : "No matching awards"} tone="purple" />
        <Metric label="Largest vendor" value={topVendor[0]?.label || "n/a"} helper={topVendor[0] ? `${money(topVendor[0].awardAmount)} · ${topVendor[0].awards} awards` : "No matching awards"} tone="orange" />
        <Metric label="Office detail" value={filteredAwards.length ? percent((filteredOfficeCount / filteredAwards.length) * 100, 1) : "0.0%"} helper={`${filteredOfficeCount.toLocaleString()} awards identify an awarding or funding office`} tone="green" />
      </section>

      <AnalysisActions rows={filteredAwards} filename="filtered-awards" />

      <Section title="Award Records" meta={`${filteredAwards.length.toLocaleString()} matched · showing ${visibleAwards.length.toLocaleString()}`} icon={FileSpreadsheet}>
        <AwardTable awards={visibleAwards} />
      </Section>

      <div className="grid grid--sources">
        <AwardRollup title="Top Buyers" rows={topBuyer} />
        <AwardRollup title="Top Vendors" rows={topVendor} />
        <AwardRollup title="Top Work Types" rows={topWork} />
      </div>
    </div>
  );
}

// eslint-disable-next-line no-unused-vars
function Pursuits() {
  const lanes = PURSUIT_TIMING.lanes || EMPTY_ROWS;
  const candidates = PURSUIT_TIMING.recompeteCandidates || EMPTY_ROWS;
  const summary = PURSUIT_TIMING.summary || {};
  const defaults = { query: "", area: "all", buyer: "all", workType: "all", sort: "score" };
  const [filters, setFilters] = useUrlState(defaults, {
    area: (value) => value === "all" || lanes.some((lane) => lane.areaId === value),
    buyer: (value) => value === "all" || lanes.some((lane) => lane.buyer === value),
    workType: (value) => value === "all" || lanes.some((lane) => lane.workType?.id === value),
    sort: ["score", "end", "value", "near"],
  });
  const [expanded, setExpanded] = useState(false);
  const areaOptions = useMemo(() => awardOptionRows(lanes, (lane) => ({ id: lane.areaId, label: lane.area })), [lanes]);
  const buyerOptions = useMemo(() => awardOptionRows(lanes, (lane) => ({ id: lane.buyer, label: lane.buyer })), [lanes]);
  const workTypeOptions = useMemo(() => awardOptionRows(lanes, (lane) => ({ id: lane.workType?.id, label: lane.workType?.label })), [lanes]);

  const laneMatches = (lane) => {
    const query = filters.query.trim().toLowerCase();
    return (!query || [
      lane.area,
      lane.buyer,
      lane.buyerGroup,
      lane.workType?.label,
      lane.topVendor,
      lane.rationale,
      ...(lane.topVendors || []).map((vendor) => vendor.label),
    ].join(" ").toLowerCase().includes(query))
      && (filters.area === "all" || lane.areaId === filters.area)
      && (filters.buyer === "all" || lane.buyer === filters.buyer)
      && (filters.workType === "all" || lane.workType?.id === filters.workType);
  };

  const candidateMatches = (award) => {
    const query = filters.query.trim().toLowerCase();
    return (!query || [
      award.awardId,
      award.recipient,
      award.buyerSubAgency,
      award.workType?.label,
      award.contractType,
      award.description,
      ...(award.areas || []),
    ].join(" ").toLowerCase().includes(query))
      && (filters.area === "all" || (award.areaIds || []).includes(filters.area))
      && (filters.buyer === "all" || award.buyerSubAgency === filters.buyer)
      && (filters.workType === "all" || award.workType?.id === filters.workType);
  };

  const filteredLanes = lanes.filter(laneMatches).sort((a, b) => {
    if (filters.sort === "end") return (a.daysUntilNextEnd ?? 99999) - (b.daysUntilNextEnd ?? 99999);
    if (filters.sort === "value") return b.awardAmount - a.awardAmount;
    if (filters.sort === "near") return b.nearTermAwardAmount - a.nearTermAwardAmount;
    return b.score - a.score || b.nearTermAwardAmount - a.nearTermAwardAmount;
  });
  const filteredCandidates = candidates.filter(candidateMatches).sort((a, b) => {
    if (filters.sort === "end") return (a.daysUntilEnd ?? 99999) - (b.daysUntilEnd ?? 99999);
    if (filters.sort === "value") return b.awardAmount - a.awardAmount;
    return b.score - a.score || (a.daysUntilEnd ?? 99999) - (b.daysUntilEnd ?? 99999);
  });
  const visibleCandidates = filteredCandidates.slice(0, 150);
  const nearTermValue = sum(filteredCandidates, "awardAmount");
  const filteredOfficeCount = filteredCandidates.filter((award) => award.fundingOffice || award.awardingOffice).length;
  const topBuyer = aggregateAwardsForUi(filteredCandidates, (award) => ({ id: award.buyerSubAgency, label: award.buyerSubAgency })).slice(0, 1)[0];
  const topVendor = aggregateAwardsForUi(filteredCandidates, (award) => ({ id: award.recipient, label: award.recipient })).slice(0, 1)[0];

  return (
    <div className={`grid pursuits-page${expanded ? " is-expanded" : ""}`} data-pursuits-page>
      <section className="pursuit-hero">
        <div>
          <span>Execution pursuit timing</span>
          <h2>Contract Timing Signals</h2>
          <p>Active USAspending award records grouped by buyer, technology area, PSC or NAICS work type, incumbent, and end date. This is a pursuit-prioritization layer from sampled award data, not a named-contact or full FPDS action-history feed.</p>
        </div>
        <div className="pursuit-hero__facts" aria-label="Pursuit timing summary">
          <article>
            <strong>{(summary.activeAwards || 0).toLocaleString()}</strong>
            <span>active sampled awards</span>
          </article>
          <article>
            <strong>{(summary.nearTermAwards || 0).toLocaleString()}</strong>
            <span>end within 24 months</span>
          </article>
          <article>
            <strong>{summary.laneCount || lanes.length}</strong>
            <span>timing lanes</span>
          </article>
          <article>
            <strong>{percent(summary.officeCoverageShare, 0)}</strong>
            <span>office-field coverage</span>
          </article>
        </div>
      </section>

      <div className="pursuit-filter-bar" data-pursuit-filter-bar>
        <label className="searchbox">
          <Search size={15} aria-hidden="true" />
          <input placeholder="Search buyers, incumbents, work types, awards" value={filters.query} onChange={(event) => setFilters({ ...filters, query: event.target.value })} />
        </label>
        <ControlField label="Area" value={filters.area} options={[["all", "All areas"], ...areaOptions.map((option) => [option.id, option.label])]} onChange={(area) => setFilters({ ...filters, area })} />
        <ControlField label="Buyer" searchable value={filters.buyer} options={[["all", "All buyers"], ...buyerOptions.map((option) => [option.id, option.label])]} onChange={(buyer) => setFilters({ ...filters, buyer })} />
        <ControlField label="Work type" searchable value={filters.workType} options={[["all", "All PSC / NAICS"], ...workTypeOptions.map((option) => [option.id, option.label])]} onChange={(workType) => setFilters({ ...filters, workType })} />
        <ControlField label="Sort" value={filters.sort} options={[["score", "Pursuit score"], ["end", "Next end date"], ["near", "Near-term value"], ["value", "Active value"]]} onChange={(sort) => setFilters({ ...filters, sort })} />
        <ResetFilters filters={filters} defaults={defaults} onReset={() => setFilters(defaults)} />
      </div>

      <section className="if-metric-grid source-metrics" aria-label="Pursuit filter metrics">
        <Metric label="Matched lanes" value={filteredLanes.length.toLocaleString()} helper={`${filteredCandidates.length.toLocaleString()} near-term awards under current filters`} />
        <Metric label="Near-term value" value={money(nearTermValue)} helper="Awards ending within 24 months in current filters" tone="green" />
        <Metric label="Largest buyer" value={topBuyer?.label || "n/a"} helper={topBuyer ? `${money(topBuyer.awardAmount)} · ${topBuyer.awards} awards` : "No matching candidates"} tone="purple" />
        <Metric label="Largest incumbent" value={topVendor?.label || "n/a"} helper={topVendor ? `${money(topVendor.awardAmount)} · ${topVendor.awards} awards` : "No matching candidates"} tone="orange" />
        <Metric label="Office detail" value={filteredCandidates.length ? percent((filteredOfficeCount / filteredCandidates.length) * 100, 1) : "0.0%"} helper={`${filteredOfficeCount.toLocaleString()} candidates identify an awarding or funding office`} tone="green" />
      </section>

      <AnalysisActions rows={filteredCandidates} filename="pursuit-candidates" />
      <MobileDisclosure expanded={expanded} onToggle={setExpanded} label="pursuit evidence" />

      <Section title="Pursuit Timing Lanes" meta={`${filteredLanes.length.toLocaleString()} matched active buyer-area-work type lanes`} icon={GitBranch}>
        <div className="pursuit-timing-grid" data-pursuit-timing-lanes>
          {filteredLanes.map((lane) => (
            <article key={lane.id} className="pursuit-timing-card">
              <header>
                <div>
                  <span>{lane.buyerGroup} · {lane.area}</span>
                  <strong>{lane.buyer}</strong>
                </div>
                <b>{lane.score}</b>
              </header>
              <p>{lane.rationale}</p>
              <dl>
                <div>
                  <dt>Active awards</dt>
                  <dd>{money(lane.awardAmount)} · {lane.awards} awards</dd>
                </div>
                <div>
                  <dt>Near-term timing</dt>
                  <dd>{money(lane.nearTermAwardAmount)} · {lane.nearTermAwards} awards</dd>
                </div>
                <div>
                  <dt>Next end</dt>
                  <dd>{lane.nextEndDate || "n/a"}{lane.nextEndFiscalYear ? ` · FY${lane.nextEndFiscalYear}` : ""}</dd>
                </div>
                <div>
                  <dt>Work type</dt>
                  <dd>{lane.workType?.label || "Uncoded work type"}</dd>
                </div>
                <div>
                  <dt>Top incumbent</dt>
                  <dd>{lane.topVendor} · {percent(lane.incumbentShare, 0)}</dd>
                </div>
                <div>
                  <dt>Contract form</dt>
                  <dd>{(lane.contractTypes || []).map((type) => type.label).slice(0, 2).join(" · ") || "n/a"}</dd>
                </div>
              </dl>
            </article>
          ))}
        </div>
      </Section>

      <div className="grid grid--sources">
        <AwardRollup title="Active Buyers" rows={PURSUIT_TIMING.byBuyer || []} />
        <AwardRollup title="Active Incumbents" rows={PURSUIT_TIMING.byVendor || []} />
        <AwardRollup title="Contract Types" rows={PURSUIT_TIMING.byContractType || []} />
      </div>

      <Section title="Near-Term Award Ends" meta={`${filteredCandidates.length.toLocaleString()} matched · showing ${visibleCandidates.length.toLocaleString()}`} icon={CalendarClock}>
        <PursuitCandidateTable awards={visibleCandidates} />
      </Section>
    </div>
  );
}

function LaneBrief({ item }) {
  if (!item) return null;
  const area = STRATEGY.technologyAreas?.find((technologyArea) => technologyArea.id === item.areaId);
  const alignment = STRATEGY.budgetExecutionAlignment?.find((lane) => lane.id === item.areaId);
  const sampleAwards = item.sampleAwards || EMPTY_ROWS;
  const sourceLines = area?.topLines || EMPTY_ROWS;
  const nextActions = [
    item.recommendedAction,
    "Confirm buyer office, vehicle, and end-date meaning",
    "Check active SAM.gov notices and amendment history",
    "Map incumbent role against Sabre-relevant service wedges",
  ];

  return (
    <Section title="Lane Brief" meta={`${item.buyer} / ${item.area}`} icon={FileText}>
      <div className="lane-brief" data-lane-brief>
        <article className="lane-brief__main">
          <header>
            <div>
              <span>{item.stageLabel} · {item.urgency}</span>
              <strong>{item.buyer}</strong>
            </div>
            <b>{item.score}</b>
          </header>
          <p>{item.rationale}</p>
          <dl>
            <div>
              <dt>Budget signal</dt>
              <dd>{area ? `${money(area.fy2027)} FY2027 · ${pct(area.growth)}` : "n/a"}</dd>
            </div>
            <div>
              <dt>Execution signal</dt>
              <dd>{money(item.activeAwardAmount)} active · {money(item.nearTermAwardAmount)} near-term</dd>
            </div>
            <div>
              <dt>Timing</dt>
              <dd>{item.nextEndDate || "n/a"} · {Number.isFinite(item.daysUntilNextEnd) ? `${item.daysUntilNextEnd} days` : "unknown"}</dd>
            </div>
            <div>
              <dt>Incumbent</dt>
              <dd>{item.topIncumbent} · {percent(item.incumbentShare, 0)}</dd>
            </div>
            <div>
              <dt>Alignment</dt>
              <dd>{alignment ? `${alignment.score} · ${alignment.confidence}` : `${item.areaAlignmentScore} score`}</dd>
            </div>
            <div>
              <dt>Fit</dt>
              <dd>{item.serviceFit}</dd>
            </div>
          </dl>
        </article>

        <article>
          <span>Next actions</span>
          <ul>
            {nextActions.map((action) => <li key={action}>{action}</li>)}
          </ul>
        </article>

        <article>
          <span>Open gaps</span>
          <ul>
            {(item.dataGaps || []).map((gap) => <li key={gap}>{gap}</li>)}
          </ul>
        </article>

        <article>
          <span>Evidence trail</span>
          <div className="lane-brief__evidence">
            {sourceLines.slice(0, 3).map((line) => (
              <p key={line.id}><strong>{line.title}</strong>{line.orgName} · {money(line.fy2027)}</p>
            ))}
            {sampleAwards.slice(0, 3).map((award) => (
              <p key={award.id}><strong>{award.awardId || award.id}</strong>{award.recipient} · {money(award.awardAmount)} · ends {award.endDate || "n/a"}</p>
            ))}
          </div>
        </article>
      </div>
    </Section>
  );
}

// eslint-disable-next-line no-unused-vars
function CaptureQueue() {
  const items = CAPTURE_QUEUE.items || EMPTY_ROWS;
  const summary = CAPTURE_QUEUE.summary || {};
  const stageCounts = CAPTURE_QUEUE.stageCounts || EMPTY_ROWS;
  const defaults = { query: "", stage: "all", area: "all", buyer: "all", sort: "score" };
  const [filters, setFilters] = useUrlState(defaults, {
    stage: (value) => value === "all" || items.some((item) => item.stage === value),
    area: (value) => value === "all" || items.some((item) => item.areaId === value),
    buyer: (value) => value === "all" || items.some((item) => item.buyer === value),
    sort: ["score", "end", "near", "alignment"],
  });
  const [selectedItemId, setSelectedItemId] = useUrlSelection(items[0]?.id || "", items.map((item) => item.id));
  const [expanded, setExpanded] = useState(false);
  const stageOptions = useMemo(() => awardOptionRows(items, (item) => ({ id: item.stage, label: item.stageLabel })), [items]);
  const areaOptions = useMemo(() => awardOptionRows(items, (item) => ({ id: item.areaId, label: item.area })), [items]);
  const buyerOptions = useMemo(() => awardOptionRows(items, (item) => ({ id: item.buyer, label: item.buyer })), [items]);

  const filteredItems = items.filter((item) => {
    const query = filters.query.trim().toLowerCase();
    return (!query || [
      item.buyer,
      item.buyerGroup,
      item.area,
      item.workType?.label,
      item.topIncumbent,
      item.recommendedAction,
      item.rationale,
      item.incumbentRisk,
      item.serviceFit,
      ...(item.dataGaps || []),
    ].join(" ").toLowerCase().includes(query))
      && (filters.stage === "all" || item.stage === filters.stage)
      && (filters.area === "all" || item.areaId === filters.area)
      && (filters.buyer === "all" || item.buyer === filters.buyer);
  }).sort((a, b) => {
    if (filters.sort === "end") return (a.daysUntilNextEnd ?? 99999) - (b.daysUntilNextEnd ?? 99999);
    if (filters.sort === "near") return b.nearTermAwardAmount - a.nearTermAwardAmount;
    if (filters.sort === "alignment") return b.areaAlignmentScore - a.areaAlignmentScore || b.score - a.score;
    return b.score - a.score || b.nearTermAwardAmount - a.nearTermAwardAmount;
  });
  const selectedItem = filteredItems.find((item) => item.id === selectedItemId) || filteredItems[0];

  return (
    <div className={`grid capture-page${expanded ? " is-expanded" : ""}`} data-capture-queue-page>
      <section className="capture-hero">
        <div>
          <span>Pursuit cockpit</span>
          <h2>What To Validate Next</h2>
          <p>Generated pursuit actions ranked from budget/execution alignment, active award value, near-term end dates, coded work type, and incumbent concentration. Select a lane to see its brief, evidence trail, open gaps, and next capture actions.</p>
        </div>
        <div className="capture-hero__facts" aria-label="Capture queue summary">
          <article>
            <strong>{summary.items || items.length}</strong>
            <span>queue items</span>
          </article>
          <article>
            <strong>{summary.actNowItems || 0}</strong>
            <span>act-now lanes</span>
          </article>
          <article>
            <strong>{money(summary.nearTermAwardValue || 0)}</strong>
            <span>near-term value</span>
          </article>
          <article>
            <strong>{summary.topItem || "n/a"}</strong>
            <span>top cockpit lane</span>
          </article>
        </div>
      </section>

      <div className="capture-filter-bar" data-capture-filter-bar>
        <label className="searchbox">
          <Search size={15} aria-hidden="true" />
          <input placeholder="Search actions, buyers, incumbents, work types" value={filters.query} onChange={(event) => setFilters({ ...filters, query: event.target.value })} />
        </label>
        <ControlField label="Stage" value={filters.stage} options={[["all", "All stages"], ...stageOptions.map((option) => [option.id, option.label])]} onChange={(stage) => setFilters({ ...filters, stage })} />
        <ControlField label="Area" value={filters.area} options={[["all", "All areas"], ...areaOptions.map((option) => [option.id, option.label])]} onChange={(area) => setFilters({ ...filters, area })} />
        <ControlField label="Buyer" searchable value={filters.buyer} options={[["all", "All buyers"], ...buyerOptions.map((option) => [option.id, option.label])]} onChange={(buyer) => setFilters({ ...filters, buyer })} />
        <ControlField label="Sort" value={filters.sort} options={[["score", "Queue score"], ["end", "Next end date"], ["near", "Near-term value"], ["alignment", "Budget alignment"]]} onChange={(sort) => setFilters({ ...filters, sort })} />
        <ResetFilters filters={filters} defaults={defaults} onReset={() => setFilters(defaults)} />
      </div>

      <div className="capture-stage-grid" data-capture-stage-counts>
        {stageCounts.map((stage) => (
          <article key={stage.id}>
            <span>{stage.label}</span>
            <strong>{stage.items}</strong>
            <p>{money(stage.nearTermAwardAmount)} near-term award value</p>
          </article>
        ))}
      </div>

      <AnalysisActions rows={filteredItems} filename="capture-queue" />
      <MobileDisclosure expanded={expanded} onToggle={setExpanded} label="cockpit evidence" />

      <LaneBrief item={selectedItem} />

      <Section title="Pursuit Cockpit" meta={`${filteredItems.length.toLocaleString()} matched generated actions`} icon={ListChecks}>
        <div className="capture-queue-grid" data-capture-queue-items>
          {filteredItems.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`capture-queue-card${selectedItem?.id === item.id ? " active" : ""}`}
              onClick={() => setSelectedItemId(item.id)}
            >
              <header>
                <div>
                  <span>{item.stageLabel} · {item.urgency}</span>
                  <strong>{item.buyer}</strong>
                </div>
                <b>{item.score}</b>
              </header>
              <p>{item.recommendedAction}</p>
              <dl>
                <div>
                  <dt>Lane</dt>
                  <dd>{item.area} · {item.workType?.label || "Uncoded"}</dd>
                </div>
                <div>
                  <dt>Timing</dt>
                  <dd>{item.nextEndDate || "n/a"} · {Number.isFinite(item.daysUntilNextEnd) ? `${item.daysUntilNextEnd} days` : "unknown"}</dd>
                </div>
                <div>
                  <dt>Near-term value</dt>
                  <dd>{money(item.nearTermAwardAmount)} · {item.nearTermAwards} awards</dd>
                </div>
                <div>
                  <dt>Incumbent</dt>
                  <dd>{item.topIncumbent} · {percent(item.incumbentShare, 0)}</dd>
                </div>
              </dl>
              <footer>
                <span>{item.incumbentRisk}</span>
                <span>{item.serviceFit}</span>
                <a href={item.samSearchUrl} target="_blank" rel="noreferrer">
                  SAM search <ExternalLink size={12} aria-hidden="true" />
                </a>
              </footer>
            </button>
          ))}
        </div>
      </Section>

      <Section title="Validation Backlog" meta="source gaps to close before treating queue items as live opportunities" icon={Filter}>
        <CaptureQueueTable items={filteredItems} />
      </Section>
    </div>
  );
}

function aggregateAwardsForUi(awards, keyFn) {
  const groups = new Map();
  for (const award of awards) {
    const key = keyFn(award);
    if (!key?.id) continue;
    const existing = groups.get(key.id) || { ...key, awardAmount: 0, awards: 0 };
    existing.awardAmount += award.awardAmount;
    existing.awards += 1;
    groups.set(key.id, existing);
  }
  return [...groups.values()].map((row) => ({ ...row, awardAmount: Number(row.awardAmount.toFixed(3)) })).sort((a, b) => b.awardAmount - a.awardAmount);
}

function CaptureQueueTable({ items }) {
  return (
    <div className="table-shell capture-table-shell" data-capture-queue-table>
      <table>
        <thead>
          <tr>
            <th>Score</th>
            <th>Stage</th>
            <th>Action</th>
            <th>Buyer</th>
            <th>Lane</th>
            <th>Incumbent</th>
            <th>Validation Gaps</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id}>
              <td>{item.score}</td>
              <td>
                <strong>{item.stageLabel}</strong>
                <span>{item.urgency}</span>
              </td>
              <td>
                <strong>{item.recommendedAction}</strong>
                <span>{item.rationale}</span>
              </td>
              <td>{item.buyer}</td>
              <td>
                <strong>{item.area}</strong>
                <span>{item.workType?.label || "Uncoded work type"}</span>
              </td>
              <td>
                <strong>{item.topIncumbent}</strong>
                <span>{item.incumbentRisk}</span>
              </td>
              <td>{(item.dataGaps || []).join(" · ")}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PursuitCandidateTable({ awards }) {
  const [evidenceRecord, setEvidenceRecord] = useState(null);
  return (
    <>
      <div className="table-shell pursuit-table-shell" data-pursuit-candidate-table>
        <table>
        <thead>
          <tr>
            <th>Score</th>
            <th>End</th>
            <th>Award</th>
            <th>Incumbent</th>
            <th>Buyer</th>
            <th>Work type</th>
            <th>Value</th>
          </tr>
        </thead>
        <tbody>
          {awards.map((award) => (
            <tr key={award.id}>
              <td>{award.score}</td>
              <td>
                <strong>{award.endDate || "n/a"}</strong>
                <span>{Number.isFinite(award.daysUntilEnd) ? `${award.daysUntilEnd} days` : "timing unknown"}</span>
              </td>
              <td>
                <strong>{award.awardId || award.id}</strong>
                <span>{award.contractType || "Contract award"} · {award.description || "No description"}</span>
                <a className="record-source-link" href={sourceUrlForRow(award)} target="_blank" rel="noreferrer">
                  USAspending record <ExternalLink size={12} aria-hidden="true" />
                </a>
                <button type="button" className="record-evidence-button" onClick={() => setEvidenceRecord(award)}>Evidence details</button>
              </td>
              <td>{award.recipient}</td>
              <td>
                <strong>{award.buyerSubAgency}</strong>
                <span>{award.buyerGroup}</span>
              </td>
              <td>
                <strong>{award.workType?.code || "n/a"}</strong>
                <span>{award.workType?.label || "Uncoded work type"}</span>
              </td>
              <td>{money(award.awardAmount)}</td>
            </tr>
          ))}
        </tbody>
        </table>
      </div>
      <EvidenceDrawer record={evidenceRecord} onClose={() => setEvidenceRecord(null)} />
    </>
  );
}

function AwardRollup({ title, rows }) {
  const max = Math.max(...rows.map((row) => row.awardAmount || 0), 1);
  return (
    <Section title={title} meta="current filters" icon={BarChart3}>
      <div className="award-rollup-list">
        {rows.map((row) => (
          <article key={row.id}>
            <div>
              <strong>{row.label}</strong>
              <Bar value={row.awardAmount} max={max} color="#005ea2" label={row.label} />
            </div>
            <b>{money(row.awardAmount)}</b>
            <span>{row.awards} awards</span>
          </article>
        ))}
      </div>
    </Section>
  );
}

function AwardTable({ awards }) {
  const [evidenceRecord, setEvidenceRecord] = useState(null);
  const columns = [
    {
      key: "award",
      label: "Award",
      required: true,
      sticky: true,
      minWidth: 310,
      value: (award) => award.awardId || award.id,
      searchValue: (award) => [award.awardId, award.id, award.description, award.contractType],
      render: (award) => <><strong>{award.awardId || award.id}</strong><small>{award.contractType || "Contract award"} · {award.description || "No description"}</small></>,
    },
    { key: "vendor", label: "Vendor", facet: true, minWidth: 180, value: (award) => award.recipient },
    { key: "buyer", label: "Buyer", facet: true, minWidth: 200, value: (award) => award.buyerSubAgency, searchValue: (award) => [award.buyerSubAgency, award.fundingOffice, award.awardingOffice], render: (award) => <><strong>{award.buyerSubAgency}</strong><small>{award.fundingOffice || award.awardingOffice || award.awardingSubAgency}</small></> },
    { key: "area", label: "Area", facet: true, minWidth: 150, value: (award) => (award.areas || [award.area]).slice(0, 2).join(", ") },
    { key: "workType", label: "Work type", facet: true, minWidth: 170, value: (award) => award.pscCode || award.naicsCode || "Uncoded", searchValue: (award) => [award.pscCode, award.naicsCode, award.pscDescription, award.naicsDescription], render: (award) => <><strong>{award.pscCode || award.naicsCode || "n/a"}</strong><small>{award.pscDescription || award.naicsDescription || "Uncoded"}</small></> },
    { key: "start", label: "Start", value: (award) => award.startDate || "Unknown" },
    { key: "end", label: "End", value: (award) => award.endDate || "Unknown" },
    { key: "value", label: "Award value", sortValue: (award) => Number(award.awardAmount || 0), exportValue: (award) => award.awardAmount, render: (award) => <strong>{money(award.awardAmount)}</strong> },
    { key: "actions", label: "Actions", role: "actions", required: true, sortable: false, render: (award) => <div className="dbi-table-actions"><a href={sourceUrlForRow(award)} target="_blank" rel="noreferrer">Source<ExternalLink size={12} /></a><button type="button" onClick={() => setEvidenceRecord(award)}>Details</button></div> },
  ];
  return (
    <>
      <OperationalDataTable
        id="award-records"
        label="Award records"
        rows={awards}
        columns={columns}
        rowKey={(award) => award.id}
        defaultSort={{ key: "value", direction: "desc" }}
        searchPlaceholder="Search awards, vendors, buyers, PSC, or NAICS…"
        exportFilename="defense-awards.csv"
        defaultPageSize={25}
        showSearch={false}
        showFacets={false}
        wrapperProps={{ "data-award-record-table": true }}
      />
      <EvidenceDrawer record={evidenceRecord} onClose={() => setEvidenceRecord(null)} />
    </>
  );
}

// eslint-disable-next-line no-unused-vars
function Drilldown({ records }) {
  const [sort, setSort] = useState("fy2027");
  const rows = [...records]
    .filter((record) => record.fy2027 > 0 || record.fy2026 > 0 || record.fy2025 > 0)
    .sort((a, b) => (sort === "growth" ? growth(b) - growth(a) : b.fy2027 - a.fy2027))
    .slice(0, 250);

  return (
    <Section title="Line Item Drilldown" meta={`${records.length} matched records`} icon={Search}>
      <div className="table-actions">
        <button type="button" className={sort === "fy2027" ? "active" : ""} onClick={() => setSort("fy2027")}><BarChart3 size={14} /> FY2027</button>
        <button type="button" className={sort === "growth" ? "active" : ""} onClick={() => setSort("growth")}><TrendingUp size={14} /> Trend</button>
      </div>
      <RecordTable records={rows} />
    </Section>
  );
}

function scoreTone(score) {
  if (score >= 85) return "high";
  if (score >= 70) return "medium";
  return "low";
}

// eslint-disable-next-line no-unused-vars
function Sources() {
  const latestSourceRefresh = BOOKS
    .map((source) => new Date(source.cacheModifiedAt).getTime())
    .filter(Boolean)
    .sort((a, b) => b - a)[0];
  const workbookRecords = BOOKS.reduce((total, source) => total + source.records, 0);
  const sourceLayers = DATA_INVENTORY.sourceLayers || [];
  const pipelineSources = DATA_INVENTORY.pipelineSources || [];
  const sourceJoinPaths = DATA_INVENTORY.sourceJoinPaths || [];
  const coverageDiagnostics = DATA_INVENTORY.coverageDiagnostics || {};
  const sourceDiagnostics = DATA_INVENTORY.sourceDiagnostics || [];
  const healthSources = sourceHealth.sources || [];
  const healthTotals = sourceHealth.totals || {};
  const [expanded, setExpanded] = useState(false);

  return (
    <div className={`grid source-page${expanded ? " is-expanded" : ""}`} data-source-page>
      <section className="source-hero">
        <div>
          <span>Source Governance</span>
          <h2>Data Sources</h2>
          <p>Official Comptroller display books feed the current line-level budget model. This page tracks provenance, local versions, refresh state, extracted coverage, and the gaps that matter for budget and spend intelligence.</p>
        </div>
        <div className="source-hero__facts" aria-label="Data source summary">
          <article>
            <strong>{DATA_INVENTORY.sourceCount}</strong>
            <span>source workbooks</span>
          </article>
          <article>
            <strong>{workbookRecords.toLocaleString()}</strong>
            <span>parsed records</span>
          </article>
          <article>
            <strong>{DATA_INVENTORY.availableBudgetRequestYears.length}</strong>
            <span>request vintages</span>
          </article>
          <article>
            <strong>{DATA_INVENTORY.availableFiscalYears.length}</strong>
            <span>fiscal years</span>
          </article>
        </div>
      </section>

      <MobileDisclosure expanded={expanded} onToggle={setExpanded} label="source evidence" />

      <div className="source-metrics">
        <Metric label="Official publisher" value="OUSD(C)" helper={DATA_INVENTORY.sourcePackage} />
        <Metric label="Current package" value={yearList(DATA_INVENTORY.availableBudgetRequestYears)} helper={`${DATA_INVENTORY.sourceVersionCount} workbook versions in the trend model`} tone="purple" />
        <Metric label="Value coverage" value={yearList(DATA_INVENTORY.availableFiscalYears)} helper="Actual, enacted or plan, and request columns where present" tone="green" />
        <Metric label="Latest cache refresh" value={latestSourceRefresh ? dateTime(latestSourceRefresh) : "Unknown"} helper="Newest cached workbook timestamp" tone="orange" />
      </div>

      <Section title="Justification Evidence" meta="program narrative coverage" icon={FileText}>
        <div className="justification-evidence-summary" data-justification-evidence>
          <article>
            <strong>{JUSTIFICATION_COVERAGE.sourceCount || 0}</strong>
            <span>cached XML sources</span>
            <p>{JUSTIFICATION_COVERAGE.officialLinkCount || JUSTIFICATION_COVERAGE.sourceCount || 0} official links found; {JUSTIFICATION_COVERAGE.unavailableSourceCount || 0} were unavailable at refresh.</p>
          </article>
          <article>
            <strong>{(JUSTIFICATION_COVERAGE.evidenceItems || 0).toLocaleString()}</strong>
            <span>extracted items</span>
            <p>Program elements and procurement line items parsed from cached official XML.</p>
          </article>
          <article>
            <strong>{(JUSTIFICATION_COVERAGE.matchedBudgetRecords || 0).toLocaleString()}</strong>
            <span>matched budget lines</span>
            <p>{percent(JUSTIFICATION_COVERAGE.matchedBudgetRecordShare, 1)} of current workbook records have a first-pass narrative join.</p>
          </article>
          <article>
            <strong>{(JUSTIFICATION_COVERAGE.narrativeConfirmedTechnologyRecords || 0).toLocaleString()}</strong>
            <span>confirmed tech lines</span>
            <p>{money(JUSTIFICATION_COVERAGE.narrativeConfirmedTechnologyValue || 0)} in technology-tagged FY2027 value is confirmed by narrative terms.</p>
          </article>
        </div>
      </Section>

      <Section title="USAspending Award Snapshot" meta="execution-side vendor and buyer coverage" icon={Database}>
        <div className="execution-evidence-summary" data-execution-evidence>
          <article>
            <strong>{EXECUTION_COVERAGE.areaCount || 0}</strong>
            <span>technology searches</span>
            <p>{EXECUTION_COVERAGE.failedAreaCount || 0} failed USAspending API calls in the cached snapshot.</p>
          </article>
          <article>
            <strong>{(EXECUTION_COVERAGE.awardEntries || 0).toLocaleString()}</strong>
            <span>award hits</span>
            <p>{(EXECUTION_COVERAGE.uniqueAwards || 0).toLocaleString()} unique contract award records after dedupe.</p>
          </article>
          <article>
            <strong>{money(EXECUTION_COVERAGE.uniqueAwardValue || 0)}</strong>
            <span>sampled award value</span>
            <p>{EXECUTION_COVERAGE.startDate || "n/a"} through {EXECUTION_COVERAGE.endDate || "n/a"}.</p>
          </article>
          <article>
            <strong>{EXECUTION_COVERAGE.vendorCount || 0}</strong>
            <span>top vendors tracked</span>
            <p>Buyer rollups use funding sub-agency first, then awarding sub-agency when needed.</p>
          </article>
          <article>
            <strong>{EXECUTION_COVERAGE.trendPeriodCount || 0}</strong>
            <span>trend quarters</span>
            <p>USAspending spending_over_time returns quarterly contract obligations for selected filters.</p>
          </article>
          <article>
            <strong>{EXECUTION_COVERAGE.topTrendPsc || "n/a"}</strong>
            <span>top PSC trend lane</span>
            <p>PSC and NAICS trend rows expose where sampled awards cluster by work type.</p>
          </article>
        </div>
      </Section>

      <Section title="Buyer Pursuit Lane Coverage" meta="generated from sampled award buyer, technology, PSC, NAICS, and vendor fields" icon={Building2}>
        <div className="pursuit-source-summary" data-pursuit-lane-evidence>
          <article>
            <strong>{STRATEGY.summary?.buyerPursuitLaneCount || 0}</strong>
            <span>ranked lanes</span>
            <p>Buyer-area lanes combine sampled USAspending awards with technology-area request context.</p>
          </article>
          <article>
            <strong>{STRATEGY.summary?.topBuyerPursuitLane || "n/a"}</strong>
            <span>top lane</span>
            <p>Ranked by sampled award value, technology alignment score, buyer budget context, and evidence coverage.</p>
          </article>
          <article>
            <strong>{(STRATEGY.buyerPursuitLanes || [])[0]?.topWorkType || "n/a"}</strong>
            <span>top coded work type</span>
            <p>PSC is used first when available, with NAICS as backup for work-type interpretation.</p>
          </article>
        </div>
      </Section>

      <Section title="Pursuit Timing Coverage" meta="active award end dates, contract forms, and incumbent signals" icon={CalendarClock}>
        <div className="pursuit-source-summary" data-pursuit-timing-evidence>
          <article>
            <strong>{PURSUIT_TIMING.summary?.activeAwards || 0}</strong>
            <span>active awards</span>
            <p>{money(PURSUIT_TIMING.summary?.activeAwardValue || 0)} in active sampled award value as of {PURSUIT_TIMING.summary?.asOf || "n/a"}.</p>
          </article>
          <article>
            <strong>{PURSUIT_TIMING.summary?.nearTermAwards || 0}</strong>
            <span>near-term ends</span>
            <p>{money(PURSUIT_TIMING.summary?.nearTermAwardValue || 0)} ends within 24 months in the sampled award set.</p>
          </article>
          <article>
            <strong>{PURSUIT_TIMING.summary?.topLane || "n/a"}</strong>
            <span>top timing lane</span>
            <p>Lane score combines active value, near-term ending value, timing urgency, area alignment, and work-type coding.</p>
          </article>
          <article>
            <strong>{percent(PURSUIT_TIMING.summary?.officeCoverageShare, 0)}</strong>
            <span>office-field coverage</span>
            <p>Current USAspending snapshot does not expose named human contacts; FPDS/SAM joins remain required for office and vehicle detail.</p>
          </article>
        </div>
      </Section>

      <Section title="Capture Queue Coverage" meta="generated validation actions from pursuit timing and budget alignment" icon={ListChecks}>
        <div className="pursuit-source-summary" data-capture-queue-evidence>
          <article>
            <strong>{CAPTURE_QUEUE.summary?.items || 0}</strong>
            <span>generated actions</span>
            <p>{CAPTURE_QUEUE.summary?.actNowItems || 0} lanes are in the act-now validation window.</p>
          </article>
          <article>
            <strong>{money(CAPTURE_QUEUE.summary?.nearTermAwardValue || 0)}</strong>
            <span>near-term value</span>
            <p>Summed across generated queue lanes from active sampled awards ending within 24 months.</p>
          </article>
          <article>
            <strong>{CAPTURE_QUEUE.summary?.topItem || "n/a"}</strong>
            <span>top action lane</span>
            <p>{CAPTURE_QUEUE.summary?.topAction || "Validate buyer office, vehicle, incumbent scope, and timing."}</p>
          </article>
        </div>
      </Section>

      <Section title="Hypothesis Coverage" meta="generated pursuit theses from queue, timing, execution, and evidence signals" icon={Lightbulb}>
        <div className="pursuit-source-summary" data-hypothesis-evidence>
          <article>
            <strong>{HYPOTHESES.summary?.hypotheses || 0}</strong>
            <span>generated theses</span>
            <p>Each thesis connects one top pursuit lane to budget evidence, execution evidence, timing, and validation work.</p>
          </article>
          <article>
            <strong>{HYPOTHESES.summary?.strongHypotheses || 0}</strong>
            <span>strong theses</span>
            <p>Confidence rises when narrative evidence, timing urgency, execution value, alignment score, and work-type coding reinforce one another.</p>
          </article>
          <article>
            <strong>{HYPOTHESES.summary?.actNowHypotheses || 0}</strong>
            <span>act-now theses</span>
            <p>Act-now status is inherited from active awards with near-term end dates in the sampled execution model.</p>
          </article>
          <article>
            <strong>{HYPOTHESES.summary?.topHypothesis || "n/a"}</strong>
            <span>top thesis</span>
            <p>Hypotheses remain generated decision records until SAM.gov and FPDS/SAM validation are attached.</p>
          </article>
        </div>
      </Section>

      <Section title="Decision Brief Coverage" meta="generated judgment records from hypotheses, accounts, capability fit, and evidence chains" icon={FileText}>
        <div className="pursuit-source-summary" data-decision-brief-evidence>
          <article>
            <strong>{DECISION_BRIEFS.summary?.briefs || 0}</strong>
            <span>decision briefs</span>
            <p>Each brief starts from a top pursuit hypothesis and attaches account, capability, award, timing, and budget evidence.</p>
          </article>
          <article>
            <strong>{DECISION_BRIEFS.summary?.prioritizeNow || 0}</strong>
            <span>priority validations</span>
            <p>Priority briefs have enough evidence to justify immediate validation work, not a pursuit commitment.</p>
          </article>
          <article>
            <strong>{DECISION_BRIEFS.summary?.topDecision || "n/a"}</strong>
            <span>top decision</span>
            <p>Decision labels separate validation priority from validated opportunity status.</p>
          </article>
          <article>
            <strong>{DECISION_BRIEFS.summary?.topBrief || "n/a"}</strong>
            <span>top brief</span>
            <p>Briefs remain generated judgment records until SAM.gov, FPDS/SAM, vehicle, and office validation are attached.</p>
          </article>
        </div>
      </Section>

      <Section title="Visualization Coverage" meta="generated visual operating picture from briefs, accounts, capability fit, timing, and sampled awards" icon={BarChart3}>
        <div className="pursuit-source-summary" data-visualization-evidence>
          <article>
            <strong>{VISUAL_ANALYTICS.summary?.clusters || 0}</strong>
            <span>visual clusters</span>
            <p>Clusters inherit the decision-brief evidence chain and expose it as a budget-versus-timing field.</p>
          </article>
          <article>
            <strong>{money(VISUAL_ANALYTICS.summary?.nearTermAwardValue || 0)}</strong>
            <span>near-term value</span>
            <p>Near-term sampled award value is summarized across the generated visual clusters.</p>
          </article>
          <article>
            <strong>{VISUAL_ANALYTICS.summary?.heatmapBuyers || 0} x {VISUAL_ANALYTICS.summary?.heatmapCapabilities || 0}</strong>
            <span>heatmap shape</span>
            <p>Buyer and capability intersections come from generated account plans and capability fit mappings.</p>
          </article>
          <article>
            <strong>{VISUAL_ANALYTICS.summary?.topCluster || "n/a"}</strong>
            <span>top visual cluster</span>
            <p>Visualization remains directional until SAM.gov and FPDS/SAM validation are joined beneath the sampled awards.</p>
          </article>
        </div>
      </Section>

      <Section title="Account Plan Coverage" meta="generated buyer account surfaces from awards, timing, queue, and hypotheses" icon={Building2}>
        <div className="pursuit-source-summary" data-account-plan-evidence>
          <article>
            <strong>{ACCOUNT_PLANS.summary?.accounts || 0}</strong>
            <span>account plans</span>
            <p>Generated from top buyer agencies in the sampled USAspending award model.</p>
          </article>
          <article>
            <strong>{ACCOUNT_PLANS.summary?.buildNowAccounts || 0}</strong>
            <span>build-now accounts</span>
            <p>Accounts qualify when execution value, near-term timing, queue score, and hypothesis confidence reinforce one another.</p>
          </article>
          <article>
            <strong>{money(ACCOUNT_PLANS.summary?.nearTermAwardValue || 0)}</strong>
            <span>near-term value</span>
            <p>Summed active sampled award value ending within 24 months across generated account plans.</p>
          </article>
          <article>
            <strong>{ACCOUNT_PLANS.summary?.topAccount || "n/a"}</strong>
            <span>top account</span>
            <p>{ACCOUNT_PLANS.summary?.topFocus || "Account focus remains generated until SAM.gov and FPDS/SAM validation are attached."}</p>
          </article>
        </div>
      </Section>

      <Section title="Capability Fit Coverage" meta="generated capability wedges from account, timing, execution, and evidence signals" icon={BrainCircuit}>
        <div className="pursuit-source-summary" data-capability-fit-evidence>
          <article>
            <strong>{CAPABILITY_FIT.summary?.capabilities || 0}</strong>
            <span>capability wedges</span>
            <p>Generated from the current technology-area model and mapped onto buyer account plans.</p>
          </article>
          <article>
            <strong>{CAPABILITY_FIT.summary?.primaryWedges || 0}</strong>
            <span>primary wedges</span>
            <p>Primary status is earned from budget scale, execution value, near-term timing, account matches, and hypothesis support.</p>
          </article>
          <article>
            <strong>{money(CAPABILITY_FIT.summary?.nearTermAwardValue || 0)}</strong>
            <span>near-term value</span>
            <p>Active sampled award value ending within 24 months across generated capability wedges.</p>
          </article>
          <article>
            <strong>{CAPABILITY_FIT.summary?.topCapability || "n/a"}</strong>
            <span>top capability</span>
            <p>{CAPABILITY_FIT.summary?.topCapabilityFit || "Capability fit remains generated until opportunity and office validation are attached."}</p>
          </article>
        </div>
      </Section>

      <Section title="Source Health Monitor" meta={`checked ${dateTime(sourceHealth.metadata.checkedAt)}`} icon={RefreshCcw}>
        <div className="source-health-summary">
          <article>
            <strong>{healthTotals.targets}</strong>
            <span>tracked URLs</span>
          </article>
          <article>
            <strong>{healthTotals.online}</strong>
            <span>online</span>
          </article>
          <article>
            <strong>{healthTotals.redirected}</strong>
            <span>redirected</span>
          </article>
          <article>
            <strong>{healthTotals.unavailable}</strong>
            <span>unavailable</span>
          </article>
        </div>
        <div className="source-health-grid" data-source-health-monitor>
          {healthSources.map((source) => (
            <article key={source.id} className={`source-health-card source-health-card--${source.health.toLowerCase()}`}>
              <header>
                <div>
                  <span>{source.group} · {source.layer}</span>
                  <strong>{source.name}</strong>
                </div>
                <b>{source.health}</b>
              </header>
              <dl>
                <div>
                  <dt>Status</dt>
                  <dd>{source.status} {source.statusText}</dd>
                </div>
                <div>
                  <dt>Probe</dt>
                  <dd>{source.method} · {source.responseMs}ms</dd>
                </div>
                <div>
                  <dt>Publisher</dt>
                  <dd>{source.publisher}</dd>
                </div>
                <div>
                  <dt>Priority</dt>
                  <dd>{source.priority ? `P${source.priority}` : "Live source"}</dd>
                </div>
              </dl>
            </article>
          ))}
        </div>
      </Section>

      <Section title="Coverage Diagnostics" meta="parsed-record signal and org coverage" icon={BarChart3}>
        <div className="coverage-diagnostic-summary">
          <article>
            <strong>{coverageDiagnostics.signalTaggedRecords?.toLocaleString()}</strong>
            <span>tagged records</span>
            <p>{percent(coverageDiagnostics.signalTaggedRecordShare, 1)} of parsed lines carry at least one mission signal.</p>
          </article>
          <article>
            <strong>{money(coverageDiagnostics.signalTaggedFy2027)}</strong>
            <span>tagged FY2027 value</span>
            <p>{percent(coverageDiagnostics.signalTaggedValueShare, 1)} of FY2027 request value is mission-coded today.</p>
          </article>
        </div>
        <div className="coverage-diagnostic-grid" data-source-coverage-diagnostics>
          {sourceDiagnostics.map((source) => (
            <article key={source.id} className="coverage-diagnostic-card">
              <header>
                <div>
                  <span>{source.color}</span>
                  <strong>{source.label}</strong>
                </div>
                <b>{percent(source.signalTaggedValueShare)} coded</b>
              </header>
              <div className="coverage-meter" aria-label={`${source.label} tagged value coverage`}>
                <i style={{ width: `${Math.min(Math.max(source.signalTaggedValueShare, 0), 100)}%`, background: BOOK_COLORS[source.id] }} />
              </div>
              <dl>
                <div>
                  <dt>Records</dt>
                  <dd>{source.records.toLocaleString()} lines · {money(source.fy2027)} FY2027</dd>
                </div>
                <div>
                  <dt>Signal tagged</dt>
                  <dd>{source.signalTaggedRecords.toLocaleString()} lines · {money(source.signalTaggedFy2027)}</dd>
                </div>
              </dl>
              <div className="coverage-split" aria-label={`${source.label} organization mix`}>
                {source.orgMix.map((group) => (
                  <span key={group.id}>
                    <b>{group.label}</b>
                    <i><em style={{ width: `${Math.min(Math.max(group.share, 0), 100)}%` }} /></i>
                    <strong>{percent(group.share)}</strong>
                  </span>
                ))}
              </div>
              <div className="signal-chip-list" aria-label={`${source.label} top mission signals`}>
                {source.topSignals.map((signal) => (
                  <span key={signal.id}>{signal.label} · {money(signal.fy2027)}</span>
                ))}
              </div>
            </article>
          ))}
        </div>
      </Section>

      <Section title="Source Coverage Ladder" meta="request to execution model" icon={GitBranch}>
        <div className="source-roadmap" data-source-layer-roadmap>
          {sourceLayers.map((layer) => (
            <article key={layer.id} className={`source-roadmap__item source-roadmap__item--${layer.status.toLowerCase()}`}>
              <span>{layer.status}</span>
              <strong>{layer.label}</strong>
              <p>{layer.coverage}</p>
              <em>{layer.role}</em>
            </article>
          ))}
        </div>
      </Section>

      <div className="grid grid--sources">
        <Section title="Join Path Map" meta="how sources attach to the budget model" icon={Layers}>
          <div className="join-path-map" data-source-join-map>
            {sourceJoinPaths.map((path) => (
              <article key={path.id} className="join-path-card">
                <div>
                  <strong>{path.from}</strong>
                  <span>{path.confidence}</span>
                  <strong>{path.to}</strong>
                </div>
                <p>{path.bridge}</p>
                <em>{path.unlocks}</em>
              </article>
            ))}
          </div>
        </Section>

        <Section title="Ingest Priority Matrix" meta="impact vs readiness" icon={TrendingUp}>
          <div className="pipeline-matrix" data-ingest-priority-matrix>
            <div className="pipeline-matrix__axis pipeline-matrix__axis--impact">impact</div>
            <div className="pipeline-matrix__axis pipeline-matrix__axis--readiness">readiness</div>
            {pipelineSources.map((source) => (
              <article
                key={source.id}
                className="pipeline-matrix__point"
                data-readiness={scoreTone(source.readiness)}
              >
                <span>P{source.priority}</span>
                <strong>{source.name}</strong>
                <em>{source.readiness}% ready · {source.impact}% impact</em>
              </article>
            ))}
          </div>
        </Section>
      </div>

      <Section title="Source Register" meta="official workbook inventory" icon={FileSpreadsheet}>
        <div className="source-register">
          {BOOKS.map((source) => (
            <article key={source.id} className="source-card">
              <header>
                <i className="dot" style={{ background: BOOK_COLORS[source.id] }} />
                <div>
                  <strong>{source.id} · {source.short}</strong>
                  <span>{source.color}</span>
                </div>
                <a href={source.sourceUrl} target="_blank" rel="noreferrer" aria-label={`${source.short} official workbook`}>
                  <ExternalLink size={15} aria-hidden="true" />
                </a>
              </header>
              <p>{source.notes}</p>
              <dl>
                <div>
                  <dt>Publisher</dt>
                  <dd>{source.sourceOffice}</dd>
                </div>
                <div>
                  <dt>Release</dt>
                  <dd>{source.sourceRelease}</dd>
                </div>
                <div>
                  <dt>Our versions</dt>
                  <dd>{source.availableBudgetRequestYears.length} request package · {yearList(source.availableBudgetRequestYears)}</dd>
                </div>
                <div>
                  <dt>Values present</dt>
                  <dd>{source.availableFiscalYears.length} years · {yearList(source.availableFiscalYears)}</dd>
                </div>
                <div>
                  <dt>Records</dt>
                  <dd>{source.records.toLocaleString()} parsed lines · {money(source.fy2027Request)} FY2027</dd>
                </div>
                <div>
                  <dt>Cache</dt>
                  <dd>{dateTime(source.cacheModifiedAt)} · {fileSize(source.cacheSizeBytes)}</dd>
                </div>
              </dl>
              <div className="coverage-bars" aria-label={`${source.short} fiscal year coverage`}>
                {source.fiscalYearCoverage.map((year) => (
                  <span key={year.year}>
                    <b>FY{year.year}</b>
                    <em>{year.records.toLocaleString()} lines</em>
                    <strong>{money(year.value)}</strong>
                  </span>
                ))}
              </div>
            </article>
          ))}
        </div>
      </Section>

      <Section title="Execution Source Pipeline" meta="next ingest queue" icon={Database}>
        <div className="pipeline-source-grid" data-execution-source-pipeline>
          {pipelineSources.map((source) => (
            <article key={source.id} className="pipeline-source-card">
              <header>
                <div>
                  <span>Priority {source.priority} · {source.layer}</span>
                  <strong>{source.name}</strong>
                </div>
                <a href={source.url} target="_blank" rel="noreferrer" aria-label={`${source.name} source`}>
                  <ExternalLink size={15} aria-hidden="true" />
                </a>
              </header>
              <p>{source.value}</p>
              <dl>
                <div>
                  <dt>Status</dt>
                  <dd>{source.status}</dd>
                </div>
                <div>
                  <dt>Publisher</dt>
                  <dd>{source.publisher}</dd>
                </div>
                <div>
                  <dt>Cadence</dt>
                  <dd>{source.cadence}</dd>
                </div>
                <div>
                  <dt>Access</dt>
                  <dd>{source.access}</dd>
                </div>
                <div>
                  <dt>Readiness</dt>
                  <dd>{source.readiness}% · impact {source.impact}% · {source.effort} effort</dd>
                </div>
                <div>
                  <dt>Join keys</dt>
                  <dd>{source.joinKeys.join(" · ")}</dd>
                </div>
                <div>
                  <dt>First ingest</dt>
                  <dd>{source.firstTask}</dd>
                </div>
              </dl>
            </article>
          ))}
        </div>
      </Section>

      <div className="grid grid--sources">
        <Section title="Refresh Model" meta="current operational state" icon={RefreshCcw}>
          <div className="source-copy">
            <p>{DATA_INVENTORY.refreshModel}</p>
            <p>{DATA_INVENTORY.automationStatus} The public Pages build does not need the private workbook cache because the generated JSON is committed with the site.</p>
            <p>{BOOKS[0]?.sourceRefreshCadence}</p>
          </div>
        </Section>

        <Section title="Build Lineage" meta="generated site artifact" icon={CalendarClock}>
          <div className="lineage-list">
            <article>
              <span>Generated</span>
              <strong>{dateTime(data.metadata.generatedAt)}</strong>
            </article>
            <article>
              <span>Source package</span>
              <strong>{DATA_INVENTORY.sourcePackage}</strong>
            </article>
            <article>
              <span>Extraction method</span>
              <strong>{data.metadata.methodology}</strong>
            </article>
            <article>
              <span>Publisher landing page</span>
              <a href={DATA_INVENTORY.sourcePackageUrl} target="_blank" rel="noreferrer">Budget Materials <ExternalLink size={13} aria-hidden="true" /></a>
            </article>
          </div>
        </Section>
      </div>

      <div className="grid grid--sources">
        <Section title="Known Limits" meta="important caveats" icon={Filter}>
          <ul className="source-list">
            {DATA_INVENTORY.limitations.map((item) => <li key={item}>{item}</li>)}
          </ul>
        </Section>

        <Section title="Next Data Sources" meta="needed for deeper spend intelligence" icon={GitBranch}>
          <ul className="source-list source-list--next">
            {DATA_INVENTORY.nextSources.map((item) => <li key={item}>{item}</li>)}
          </ul>
        </Section>
      </div>
    </div>
  );
}

function ChangeList({ title, rows, kind }) {
  return (
    <Section title={title} meta={`${rows.length} highest-impact changes shown`} icon={RefreshCcw}>
      {rows.length ? (
        <div className="change-list" data-change-list={kind}>
          {rows.slice(0, 20).map((row) => (
            <article key={`${kind}-${row.id}`}>
              <div>
                <span>{row.kind || (row.delta > 0 ? "Increased" : "Decreased")}</span>
                <strong>{row.label || row.awardId || row.id}</strong>
                <p>{row.organization || row.buyer || row.action || `${row.before} → ${row.after}`}</p>
              </div>
              <b>
                {kind === "source"
                  ? row.after
                  : kind === "queue"
                    ? `${row.delta > 0 ? "+" : ""}${row.delta}`
                    : money(Math.abs(row.delta || 0))}
              </b>
            </article>
          ))}
        </div>
      ) : <p className="empty-state">No changes were recorded between the two most recent verified snapshots.</p>}
    </Section>
  );
}

// eslint-disable-next-line no-unused-vars
function Changes() {
  const [watches, setWatches] = useState(() => JSON.parse(localStorage.getItem("budget-intelligence-watches") || "[]"));
  const summary = refreshDelta.summary || {};
  function removeWatch(url) {
    const next = watches.filter((watch) => watch.url !== url);
    localStorage.setItem("budget-intelligence-watches", JSON.stringify(next));
    setWatches(next);
  }
  return (
    <div className="grid changes-page" data-changes-page>
      <section className="changes-hero">
        <div>
          <span>Refresh intelligence</span>
          <h2>What Changed</h2>
          <p>Deterministic differences between the two most recent verified snapshots, plus locally saved analysis views. A missing baseline is shown explicitly and never inferred.</p>
        </div>
        <div className="changes-hero__facts" aria-label="Refresh change summary">
          <article><strong>{summary.budgetChanges || 0}</strong><span>budget changes</span></article>
          <article><strong>{summary.awardChanges || 0}</strong><span>award changes</span></article>
          <article><strong>{summary.queueChanges || 0}</strong><span>queue movements</span></article>
          <article><strong>{summary.sourceChanges || 0}</strong><span>source changes</span></article>
        </div>
      </section>

      <section className="delta-lineage" data-delta-lineage>
        <span>Previous <strong>{refreshDelta.metadata.previousSnapshotAt ? dateTime(refreshDelta.metadata.previousSnapshotAt) : "Baseline unavailable"}</strong></span>
        <span>Current <strong>{dateTime(refreshDelta.metadata.currentSnapshotAt)}</strong></span>
        <span>Compared <strong>{dateTime(refreshDelta.metadata.generatedAt)}</strong></span>
      </section>

      <Section title="Saved Watches" meta="stored only in this browser" icon={Bookmark}>
        {watches.length ? (
          <div className="watch-list" data-saved-watches>
            {watches.map((watch) => (
              <article key={watch.url}>
                <a href={watch.url}><strong>{watch.label}</strong><span>{watch.url.split("#")[1] || "overview"}</span></a>
                <button type="button" onClick={() => removeWatch(watch.url)}>Remove</button>
              </article>
            ))}
          </div>
        ) : <p className="empty-state">No watched views yet. Use Watch beside any exportable analysis.</p>}
      </Section>

      <ChangeList title="Budget Line Changes" rows={refreshDelta.budgetChanges || []} kind="budget" />
      <ChangeList title="Award Changes" rows={refreshDelta.awardChanges || []} kind="award" />
      <ChangeList title="Queue Score Movement" rows={refreshDelta.queueChanges || []} kind="queue" />
      <ChangeList title="Source Health Changes" rows={(refreshDelta.sourceChanges || []).map((row) => ({ ...row, label: `${row.label}: ${row.before} → ${row.after}` }))} kind="source" />
    </div>
  );
}

function AnalyticsSources() {
  const accountCoverage = ACCOUNT_SPINE?.metadata?.coverage || {};
  const transactionCoverage = CAPTURE_CALENDAR?.metadata?.coverage || {};
  const healthTotals = sourceHealth.totals || {};
  const layers = [
    {
      id: "request",
      stage: "1",
      title: "PDB request lines",
      system: "OUSD(C) display books",
      count: `${data.records.length.toLocaleString()} lines`,
      detail: `${BOOKS.length} colors of money across ${DATA_INVENTORY.availableBudgetRequestYears?.length || 0} request vintages`,
      href: DATA_INVENTORY.sourcePackageUrl || BOOKS[0]?.sourceUrl,
      relationship: "published",
    },
    {
      id: "apportionment",
      stage: "2",
      title: "Approved apportionments",
      system: "OMB public apportionments",
      count: `${accountCoverage.ombDocumentsFetched || 0} documents`,
      detail: `${accountCoverage.exactTafsJoins || 0} exact TAFS joins`,
      href: ACCOUNT_SPINE?.metadata?.sources?.ombApportionments,
      relationship: "exact TAFS",
    },
    {
      id: "accounts",
      stage: "3",
      title: "Federal and Treasury accounts",
      system: "USAspending account APIs",
      count: `${accountCoverage.federalAccounts || 0} federal accounts`,
      detail: `${accountCoverage.treasuryAccounts || 0} Treasury-account children`,
      href: ACCOUNT_SPINE?.metadata?.sources?.usaSpendingAgencyAccounts,
      relationship: "published",
    },
    {
      id: "awards",
      stage: "4",
      title: "Contract awards",
      system: "USAspending award search",
      count: `${AWARD_DRILLDOWN.summary?.awards || 0} sampled awards`,
      detail: `${accountCoverage.exactAwardAccountLinks || 0} exact award-account links`,
      href: EXECUTION_COVERAGE.sourceUrl,
      relationship: "exact award IDs",
    },
    {
      id: "transactions",
      stage: "5",
      title: "Award actions and modifications",
      system: "FPDS public actions",
      count: `${(transactionCoverage.fpdsActions || 0).toLocaleString()} actions`,
      detail: `${transactionCoverage.primaryAwardActions || 0} primary-award and ${transactionCoverage.supportingInstrumentActions || 0} supporting-instrument actions`,
      href: "https://sam.gov/fpds",
      relationship: "exact PIID context",
    },
    {
      id: "subawards",
      stage: "6",
      title: "Subaward actions",
      system: "USAspending subaward API",
      count: `${Number(USASPENDING_SUBAWARDS.metadata?.reportedSubawardCount || 0).toLocaleString()} reported subawards`,
      detail: `${Number(USASPENDING_SUBAWARDS.metadata?.primeWithSubawardsCount || 0).toLocaleString()} indexed primes with activity · ${Number(USASPENDING_SUBAWARDS.metadata?.failedPrimeCount || 0).toLocaleString()} unavailable count probes · ${USASPENDING_SUBAWARDS.metadata?.status || "unavailable"} snapshot`,
      href: USASPENDING_SUBAWARDS.metadata?.sourceUrl || "https://api.usaspending.gov/docs/endpoints",
      relationship: "exact generated prime-award ID",
    },
  ];

  return (
    <div className="grid analytics-sources" data-analytics-sources-page>
      <section className="request-hero">
        <div>
          <span>Lineage and coverage</span>
          <h2>Sources</h2>
          <p>Source systems, record counts, refresh times, and join classes for every stage of the published money flow. No recommendations or opportunity scores are generated here.</p>
        </div>
        <div className="request-hero__facts">
          <article><strong>{healthTotals.targets || sourceHealth.sources?.length || 0}</strong><span>tracked source URLs</span></article>
          <article><strong>{healthTotals.online || 0}</strong><span>online at last probe</span></article>
          <article><strong>{healthTotals.unavailable || 0}</strong><span>unavailable at last probe</span></article>
        </div>
      </section>
      <Section title="Money-flow lineage" meta="left to right from request to public subaward actions" icon={Database}>
        <div className="source-flow" data-source-flow>
          {layers.map((layer, index) => (
            <div className="source-flow__step" key={layer.id}>
              <article>
                <span>Stage {layer.stage} · {layer.relationship}</span>
                <strong>{layer.title}</strong>
                <b>{layer.count}</b>
                <p>{layer.system}<br />{layer.detail}</p>
                {layer.href ? <a href={layer.href} target="_blank" rel="noreferrer">Open source <ExternalLink size={13} aria-hidden="true" /></a> : null}
              </article>
              {index < layers.length - 1 ? <ArrowRight size={18} aria-hidden="true" /> : null}
            </div>
          ))}
        </div>
      </Section>
      <Section title="Join policy" meta="amounts remain at their published grains" icon={Network}>
        <div className="join-policy-grid">
          <article><strong>Request → federal account</strong><span>Derived only when normalized account titles match exactly.</span></article>
          <article><strong>OMB → Treasury account</strong><span>Exact full TAFS/TAS identifier.</span></article>
          <article><strong>Award → federal account</strong><span>Exact USAspending transaction funding-account relationship.</span></article>
          <article><strong>Award → FPDS action</strong><span>Exact PIID, agency/parent, modification, and transaction context.</span></article>
          <article><strong>Prime award → subaward</strong><span>Exact USAspending generated prime-award identifier. Subaward dollars remain separate from prime-award and FPDS totals.</span></article>
          <article><strong>Budget line → award</strong><span>Unlinked unless a public identifier or cited source supports the edge.</span></article>
        </div>
      </Section>
      <Section title="Source health" meta={`point-in-time probe ${dateTime(sourceHealth.metadata.checkedAt)}`} icon={RefreshCcw}>
        <div className="source-health-grid" data-source-health-monitor>
          {(sourceHealth.sources || []).map((source) => (
            <article key={source.id} className={`source-health-card source-health-card--${source.health.toLowerCase()}`}>
              <header><div><span>{source.group} · {source.layer}</span><strong>{source.name}</strong></div><b>{source.health}</b></header>
              <dl><div><dt>Status</dt><dd>{source.status} {source.statusText}</dd></div><div><dt>Probe</dt><dd>{source.method} · {source.responseMs}ms</dd></div><div><dt>Publisher</dt><dd>{source.publisher}</dd></div></dl>
            </article>
          ))}
        </div>
      </Section>
    </div>
  );
}

function App() {
  const [activeTab] = useBudgetRoute();
  const [filters, setFilters] = useUrlState(BUDGET_FILTER_DEFAULTS, {
    book: (value) => value === "all" || BOOKS.some((book) => book.id === value),
    group: ["all", "service", "fourth-estate", "other"],
    signal: (value) => value === "all" || SIGNALS.some((signal) => signal.id === value),
    org: (value) => value === "all" || data.records.some((record) => record.org === value),
  });
  const [executionRevision, setExecutionRevision] = useState(0);
  const [executionLoadAttempt, setExecutionLoadAttempt] = useState(0);
  const [executionError, setExecutionError] = useState("");
  const [accountSpineRevision, setAccountSpineRevision] = useState(0);
  const [accountSpineLoadAttempt, setAccountSpineLoadAttempt] = useState(0);
  const [accountSpineError, setAccountSpineError] = useState("");
  const [captureCalendarRevision, setCaptureCalendarRevision] = useState(0);
  const [captureCalendarLoadAttempt, setCaptureCalendarLoadAttempt] = useState(0);
  const [captureCalendarError, setCaptureCalendarError] = useState("");
  const [coreRevision, setCoreRevision] = useState(0);
  const [coreLoadAttempt, setCoreLoadAttempt] = useState(0);
  const [coreError, setCoreError] = useState("");
  const records = useFilteredRecords(filters);
  const total = aggregate(records, () => ({ id: "filtered", label: "Filtered portfolio" }))[0] || { fy2025: 0, fy2026: 0, fy2027: 0, records: 0 };
  const ai = aggregate(records.filter((record) => record.signals.includes("ai-autonomy")), () => ({ id: "ai", label: "AI / Autonomy" }))[0] || { fy2027: 0, records: 0 };
  const fourth = aggregate(records.filter((record) => record.orgGroup === "fourth-estate"), () => ({ id: "fourth", label: "Fourth Estate" }))[0] || { fy2027: 0, records: 0 };
  const evidenceRecords = records.filter((record) => record.justificationEvidence);
  const confirmedEvidenceRecords = evidenceRecords.filter((record) => record.justificationEvidence?.confirmedTechnologyAreas?.length);
  const activeTitle = ADMINISTRATION_TAB_IDS.has(activeTab) ? "Administration" : TABS.find((tab) => tab.id === activeTab)?.label || "PDB Request";
  const needsCore = CORE_TAB_IDS.has(activeTab);
  const showBudgetControls = activeTab === "overview" && coreReady;
  const needsExecution = EXECUTION_TAB_IDS.has(activeTab) || activeTab === "sources";
  const needsAccountSpine = activeTab === "lifecycle" || activeTab === "analytics" || activeTab === "sources";
  const needsCaptureCalendar = activeTab === "calendar" || activeTab === "analytics" || OPERATIONS_TAB_IDS.has(activeTab) || activeTab === "sources";

  useEffect(() => {
    document.title = `${activeTitle} · Defense Budget & Spend Analytics`;
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
  }, [activeTitle]);

  useEffect(() => {
    if (!needsCore || coreReady) return;
    let cancelled = false;
    ensureCoreData()
      .then(() => { if (!cancelled) { setCoreError(""); setCoreRevision((value) => value + 1); } })
      .catch((error) => { if (!cancelled) { corePromise = null; setCoreError(error.message); } });
    return () => { cancelled = true; };
  }, [needsCore, coreLoadAttempt]);

  useEffect(() => {
    if (!needsExecution || executionReady) return;
    let cancelled = false;
    ensureExecutionData()
      .then(() => { if (!cancelled) { setExecutionError(""); setExecutionRevision((value) => value + 1); } })
      .catch((error) => { if (!cancelled) { executionPromise = null; setExecutionError(error.message); } });
    return () => { cancelled = true; };
  }, [needsExecution, executionLoadAttempt]);

  useEffect(() => {
    if (!needsAccountSpine || accountSpineReady) return;
    let cancelled = false;
    ensureAccountSpineData()
      .then(() => { if (!cancelled) { setAccountSpineError(""); setAccountSpineRevision((value) => value + 1); } })
      .catch((error) => { if (!cancelled) { accountSpinePromise = null; setAccountSpineError(error.message); } });
    return () => { cancelled = true; };
  }, [needsAccountSpine, accountSpineLoadAttempt]);

  useEffect(() => {
    if (!needsCaptureCalendar || captureCalendarReady) return;
    let cancelled = false;
    ensureCaptureCalendarData()
      .then(() => { if (!cancelled) { setCaptureCalendarError(""); setCaptureCalendarRevision((value) => value + 1); } })
      .catch((error) => { if (!cancelled) { captureCalendarPromise = null; setCaptureCalendarError(error.message); } });
    return () => { cancelled = true; };
  }, [needsCaptureCalendar, captureCalendarLoadAttempt]);

  void coreRevision;
  void executionRevision;
  void accountSpineRevision;
  void captureCalendarRevision;

  return (
    <main className="if-main if-operations-app if-operations-app--wide if-operations-app--sticky-header ci-budget-app ci-intelligence-platform app" data-defense-budget-app data-budget-spend-app>
      <SiteHeader tabs={TABS} routes={HASH_ROUTES} activeTab={activeTab} activeTitle={activeTitle} />

      <div className={`if-content if-page if-operations-workspace if-operations-workspace--compact app__content app__content--${activeTab}`} data-if-operations-workspace data-visual-density="compact">
        <p className="sr-only" role="status" aria-live="polite">
          {activeTitle} view loaded.{showBudgetControls ? ` ${records.length.toLocaleString()} budget records match the current filters.` : ""}
        </p>
        {needsCore && !coreReady ? (
          <section className="runtime-state" data-budget-core-loading role="status">
            <RefreshCcw size={18} aria-hidden="true" />
            <div>
              <strong>{coreError ? "Budget request data unavailable" : "Loading budget request data"}</strong>
              <p>{coreError || "The detailed budget request dataset is loading for this workspace."}</p>
              {coreError ? <button type="button" onClick={() => { setCoreError(""); setCoreLoadAttempt((value) => value + 1); }}>Retry</button> : null}
            </div>
          </section>
        ) : null}
        {showBudgetControls ? (
          <>
            <FilterShell filters={filters} setFilters={setFilters} />

            <section className="if-metric-grid metrics" aria-label="Filtered budget metrics">
              <Metric label="Filtered FY2027 request" value={money(total.fy2027)} helper={`${total.records} line records · ${pct(growth(total))} since FY2025`} />
              <Metric label="AI / autonomy signal" value={money(ai.fy2027)} helper={`${ai.records} matched source lines`} tone="purple" />
              <Metric label="Fourth Estate" value={money(fourth.fy2027)} helper={`${fourth.records} agency / joint records`} tone="green" />
              <Metric label="Data depth" value={`${data.records.length.toLocaleString()} lines`} helper="M-1, O-1, P-1, R-1, RF-1, C-1" tone="orange" />
              <Metric
                label="Narrative coverage"
                value={records.length ? percent((evidenceRecords.length / records.length) * 100, 1) : "0.0%"}
                helper={`${evidenceRecords.length.toLocaleString()} source-matched · ${confirmedEvidenceRecords.length.toLocaleString()} narrative-confirmed`}
                tone="green"
              />
            </section>
            <AnalysisActions rows={records} filename={`${activeTab}-budget-records`} />
          </>
        ) : null}

        {needsExecution && !executionReady ? (
          <section className="runtime-state" data-execution-loading role="status">
            <RefreshCcw size={18} aria-hidden="true" />
            <div>
              <strong>{executionError ? "Award data unavailable" : "Loading award data"}</strong>
              <p>{executionError || "Published USAspending award records are loading on demand."}</p>
              {executionError ? <button type="button" onClick={() => { setExecutionError(""); setExecutionLoadAttempt((value) => value + 1); }}>Retry</button> : null}
            </div>
          </section>
        ) : null}

        {needsAccountSpine && !accountSpineReady ? (
          <section className="runtime-state" data-account-spine-loading role="status">
            <RefreshCcw size={18} aria-hidden="true" />
            <div>
              <strong>{accountSpineError ? "Money-flow data unavailable" : "Loading money-flow data"}</strong>
              <p>{accountSpineError || "OMB apportionments and USAspending account execution are loading on demand."}</p>
              {accountSpineError ? <button type="button" onClick={() => { setAccountSpineError(""); setAccountSpineLoadAttempt((value) => value + 1); }}>Retry</button> : null}
            </div>
          </section>
        ) : null}

        {needsCaptureCalendar && !captureCalendarReady ? (
          <section className="runtime-state" data-capture-calendar-loading role="status">
            <RefreshCcw size={18} aria-hidden="true" />
            <div>
              <strong>{captureCalendarError ? "Transaction timeline unavailable" : "Loading transaction timeline"}</strong>
              <p>{captureCalendarError || "Public award actions and reported contract periods are loading on demand."}</p>
              {captureCalendarError ? <button type="button" onClick={() => { setCaptureCalendarError(""); setCaptureCalendarLoadAttempt((value) => value + 1); }}>Retry</button> : null}
            </div>
          </section>
        ) : null}

        {coreReady && activeTab === "overview" ? <Overview records={records} /> : null}
        {coreReady && accountSpineReady && activeTab === "lifecycle" ? <AccountLifecycle /> : null}
        {coreReady && activeTab === "trends" ? <RequestTrends /> : null}
        {executionReady && activeTab === "awards" ? <Awards /> : null}
        {executionReady && captureCalendarReady && activeTab === "calendar" ? <CaptureCalendar dataset={CAPTURE_CALENDAR} awards={AWARD_DRILLDOWN.awards} samOpportunities={SAM_OPPORTUNITIES} manualProcurement={MANUAL_PROCUREMENT} procurementDelta={PROCUREMENT_DELTA} subawardSnapshot={USASPENDING_SUBAWARDS} /> : null}
        {executionReady && captureCalendarReady && accountSpineReady && activeTab === "analytics" ? <Suspense fallback={<section className="runtime-state" role="status"><RefreshCcw size={18} aria-hidden="true" /><div><strong>Loading D3 analytics</strong><p>Descriptive contract and transaction visualizations are loading.</p></div></section>}><TransactionAnalytics dataset={CAPTURE_CALENDAR} awards={AWARD_DRILLDOWN.awards} samOpportunities={SAM_OPPORTUNITIES} manualProcurement={MANUAL_PROCUREMENT} procurementDelta={PROCUREMENT_DELTA} subawardSnapshot={USASPENDING_SUBAWARDS} accountSpine={ACCOUNT_SPINE} requestLineCount={data.metadata.recordCount || data.records?.length || 0} /></Suspense> : null}
        {executionReady && captureCalendarReady && OPERATIONS_TAB_IDS.has(activeTab) ? <Suspense fallback={<section className="runtime-state" role="status"><RefreshCcw size={18} aria-hidden="true" /><div><strong>Loading {activeTitle.toLowerCase()}</strong><p>The shared management workspace is loading.</p></div></section>}><OperationsHub view={activeTab} dataset={CAPTURE_CALENDAR} awards={AWARD_DRILLDOWN.awards} samOpportunities={SAM_OPPORTUNITIES} manualProcurement={MANUAL_PROCUREMENT} procurementDelta={PROCUREMENT_DELTA} subawardSnapshot={USASPENDING_SUBAWARDS} budgetGeneratedAt={data.metadata.generatedAt} awardGeneratedAt={EXECUTION_COVERAGE.cachedAt} /></Suspense> : null}
        {coreReady && executionReady && accountSpineReady && captureCalendarReady && activeTab === "sources" ? <AnalyticsSources /> : null}
        {PROFILE_TAB_IDS.has(activeTab) ? <ProfilePage section={activeTab} /> : null}
      </div>
    </main>
  );
}

function RuntimeApp() {
  const [status, setStatus] = useState("loading");
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const initialTab = tabFromHash(typeof window === "undefined" ? "" : window.location.hash);
    const initialPayload = CORE_TAB_IDS.has(initialTab) ? "budget-core.json" : "runtime-manifest.json";
    fetchRuntimeData(initialPayload)
      .then((nextData) => {
        if (cancelled) return;
        if (initialPayload === "budget-core.json") hydrateCore(nextData);
        else hydrateManifest(nextData);
        setStatus("ready");
      })
      .catch((runtimeError) => {
        if (cancelled) return;
        setError(runtimeError.message);
        setStatus("error");
      });
    return () => { cancelled = true; };
  }, [attempt]);

  if (status !== "ready") {
    return (
      <main className="runtime-loading" data-runtime-loading role="status">
        <span className="runtime-loading__mark" aria-hidden="true"><ProductMark eager /></span>
        <h1>{status === "error" ? "Budget data unavailable" : "Loading Defense Budget & Spend Analytics"}</h1>
        <p>{status === "error" ? error : "Loading the current budget request dataset."}</p>
        {status === "error" ? <button type="button" onClick={() => { setError(""); setStatus("loading"); setAttempt((value) => value + 1); }}>Retry</button> : null}
      </main>
    );
  }

  return <App />;
}

createRoot(document.getElementById("root")).render(<ToastProvider placement="masthead"><AuthProvider><NotificationProvider><RuntimeApp /></NotificationProvider></AuthProvider></ToastProvider>);
