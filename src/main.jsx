import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { ControlAsyncState, ControlDisclosure, ControlErrorBoundary, ControlMetricStrip, ToastProvider } from "control-surface-ui/react";
import "./control-surface.css";
import {
  BarChart3,
  BrainCircuit,
  Building2,
  CalendarClock,
  Database,
  ExternalLink,
  FileSpreadsheet,
  Filter,
  GitBranch,
  Layers,
  ListChecks,
  Network,
  RefreshCcw,
  RotateCcw,
  Search,
  Star,
  TrendingUp,
} from "lucide-react";
import CaptureCalendar from "./CaptureCalendar.jsx";
import Section from "./AnalysisSection.jsx";
import AnalysisActions from "./AnalysisActions.jsx";
import AuthProvider from "./AuthContext.jsx";
import NotificationProvider from "./NotificationContext.jsx";
import ProductMark from "./ProductMark.jsx";
import SiteHeader from "./SiteHeader.jsx";
import ProfilePage from "./ProfilePage.jsx";
import ControlSelect from "./ControlSelect.jsx";
import PhaseIntro from "./PhaseIntro.jsx";
import useUrlState from "./urlState.js";
import "./styles.generated.css";

const TransactionAnalytics = lazy(() => import("./TransactionAnalytics.jsx"));
const OperationsHub = lazy(() => import("./OperationsHub.jsx"));
const AnalyticsSources = lazy(() => import("./AnalyticsSources.jsx"));
const AwardsRoute = lazy(() => import("./AwardsRoute.jsx"));

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
  { id: "tasks", label: "Task Center", icon: ListChecks },
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
  tasks: "#/budget-spend/tasks",
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
let EXECUTION_COVERAGE = {};
let AWARD_DRILLDOWN = { summary: {}, awards: [], byBuyer: [], byVendor: [], byPsc: [], byNaics: [], byTechnologyArea: [] };
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

const ADMINISTRATION_TAB_IDS = new Set(["watchlist", "events", "tasks", "integrations", "activity", "users", "workspaces", "workspace-settings", "agents"]);
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
  const execution = nextExecution || {};
  EXECUTION_COVERAGE = DATA_INVENTORY.executionCoverage || execution.coverage || {};
  AWARD_DRILLDOWN = execution.awardDrilldown || AWARD_DRILLDOWN;
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

function growth(row) {
  if (!row?.fy2025) return row?.fy2027 ? 100 : 0;
  return ((row.fy2027 - row.fy2025) / row.fy2025) * 100;
}

function requestGrowth(current, prior) {
  if (!prior) return current ? 100 : 0;
  return ((current - prior) / prior) * 100;
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

function RuntimeDataState({ error = "", loadingTitle, loadingMessage, errorTitle, onRetry, ...props }) {
  return <ControlAsyncState
    {...props}
    compact
    state={error ? "error" : "loading"}
    icon={<RefreshCcw size={18} />}
    title={error ? errorTitle : loadingTitle}
    message={error || loadingMessage}
    action={error ? <button type="button" className="if-btn if-btn--secondary" onClick={onRetry}>Retry</button> : null}
  />;
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

function TafsFlowCard({ row, maximum }) {
  return <article>
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
          <i aria-hidden="true"><b className={`tone-${tone}`} style={{ width: `${Math.max(1, (Number(amount || 0) / maximum) * 100)}%` }} /></i>
          <strong>{federalMoney(amount)}</strong>
        </div>
      ))}
    </div>
  </article>;
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

  if (!selected) return <ControlAsyncState compact state="empty" title="No account flow available" message="The current dataset does not include a federal account spine to inspect." />;

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
          {treasuryRows.slice(0, 2).map((row) => <TafsFlowCard key={row.tasCode} row={row} maximum={maxTreasury} />)}
          {treasuryRows.length > 2 ? <details className="tafs-flow__more"><summary>{treasuryRows.length - 2} more exact TAFS accounts</summary><div className="tafs-flow tafs-flow--nested">{treasuryRows.slice(2).map((row) => <TafsFlowCard key={row.tasCode} row={row} maximum={maxTreasury} />)}</div></details> : null}
        </div>
      </Section>

      <ControlDisclosure className="lifecycle-detail-disclosure" icon={<GitBranch size={16} />} title="Execution history and evidence" summary="Award links, five-year totals, obligation burn, and source policy">
        <div className="grid">
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
          )) : <ControlAsyncState compact state="empty" title="No exact award links" message="This account has no exact award links in the ranked technology-award sample." />}
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
      </ControlDisclosure>
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

function useFilteredRecords(filters, sourceRecords = []) {
  return useMemo(() => {
    const query = filters.query.trim().toLowerCase();
    return sourceRecords.filter((record) => {
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
  }, [filters, sourceRecords]);
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
      </div>
      <ControlDisclosure className="request-signal-details" icon={<Filter size={16} />} title="Mission-signal classifications" summary="Keyword-derived categories from line titles">
        <div className="signal-grid">
            {bySignal.map((row) => (
              <article key={row.id}>
                <strong>{row.label}</strong>
                <Bar value={row.fy2027} max={maxSignal} color="#005ea2" label={row.label} />
                <span>{money(row.fy2027)} · {pct(growth(row))}</span>
              </article>
            ))}
        </div>
      </ControlDisclosure>
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
      <ControlMetricStrip className="trend-metrics" label="Request trend summary" mobileScroll compactMobile items={[
        { id: "vintages", label: "Request vintages", value: `${DATA_INVENTORY.availableBudgetRequestYears.length} years`, meta: `${yearList(DATA_INVENTORY.availableBudgetRequestYears)} · ${TREND_SUMMARY.sourceVersionCount || 0} workbook versions`, tone: "info" },
        { id: "records", label: "Historical records", value: (TREND_SUMMARY.historicalRecordCount || 0).toLocaleString(), meta: "Aggregate model records across request packages", tone: "purple" },
        { id: "comparable", label: "Comparable set", value: `${TREND_SUMMARY.comparableBookCount || 0} books`, meta: (TREND_SUMMARY.comparableBooks || []).join(", "), tone: "success" },
        { id: "trend", label: "Comparable trend", value: pct(TREND_SUMMARY.comparableGrowth || 0), meta: `${money(TREND_SUMMARY.comparableEarliestRequestValue)} FY${TREND_SUMMARY.comparableEarliestRequestYear} to ${money(TREND_SUMMARY.comparableCurrentRequestValue)} FY${latest?.requestYear}`, tone: "warning" },
      ]} />

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
              <div className="trend-year-card__meta" aria-label={`${row.label} request metadata`}>
                <span><strong>{row.sourceVersions}</strong> source versions</span>
                <span><strong>{row.records.toLocaleString()}</strong> records</span>
                <span><strong>{yearList(row.fiscalYears)}</strong> values present</span>
                <span><strong>{money(row.comparableRequestValue)}</strong> comparable set</span>
              </div>
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

      <ControlDisclosure className="trend-history-details" icon={<TrendingUp size={16} />} title="Detailed request history" summary="Largest changes, color-of-money vintages, and mission-signal movement">
        <div className="grid">
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
      </ControlDisclosure>
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
  const records = useFilteredRecords(filters, data.records);
  const total = aggregate(records, () => ({ id: "filtered", label: "Filtered portfolio" }))[0] || { fy2025: 0, fy2026: 0, fy2027: 0, records: 0 };
  const ai = aggregate(records.filter((record) => record.signals.includes("ai-autonomy")), () => ({ id: "ai", label: "AI / Autonomy" }))[0] || { fy2027: 0, records: 0 };
  const fourth = aggregate(records.filter((record) => record.orgGroup === "fourth-estate"), () => ({ id: "fourth", label: "Fourth Estate" }))[0] || { fy2027: 0, records: 0 };
  const evidenceRecords = records.filter((record) => record.justificationEvidence);
  const confirmedEvidenceRecords = evidenceRecords.filter((record) => record.justificationEvidence?.confirmedTechnologyAreas?.length);
  const activeTitle = TABS.find((tab) => tab.id === activeTab)?.label || "PDB Request";
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
          <RuntimeDataState data-budget-core-loading error={coreError} errorTitle="Budget request data unavailable" loadingTitle="Loading budget request data" loadingMessage="The detailed budget request dataset is loading for this workspace." onRetry={() => { setCoreError(""); setCoreLoadAttempt((value) => value + 1); }} />
        ) : null}
        {showBudgetControls ? (
          <>
            <FilterShell filters={filters} setFilters={setFilters} />

            <ControlMetricStrip data-budget-metrics label="Filtered budget metrics" mobileScroll compactMobile items={[
              { id: "request", label: "Filtered FY2027 request", value: money(total.fy2027), meta: `${total.records} line records · ${pct(growth(total))} since FY2025`, tone: "info" },
              { id: "ai", label: "AI / autonomy signal", value: money(ai.fy2027), meta: `${ai.records} matched source lines`, tone: "purple" },
              { id: "fourth", label: "Fourth Estate", value: money(fourth.fy2027), meta: `${fourth.records} agency / joint records`, tone: "success" },
              { id: "depth", label: "Data depth", value: `${data.records.length.toLocaleString()} lines`, meta: "M-1, O-1, P-1, R-1, RF-1, C-1", tone: "warning" },
              { id: "narrative", label: "Narrative coverage", value: records.length ? percent((evidenceRecords.length / records.length) * 100, 1) : "0.0%", meta: `${evidenceRecords.length.toLocaleString()} source-matched · ${confirmedEvidenceRecords.length.toLocaleString()} narrative-confirmed`, tone: "success" },
            ]} />
            <AnalysisActions rows={records} filename={`${activeTab}-budget-records`} sourceUrlForRow={sourceUrlForRow} exportMetadata={{ snapshotGeneratedAt: data.metadata.generatedAt, methodology: data.metadata.methodology }} />
          </>
        ) : null}

        {needsExecution && !executionReady ? (
          <RuntimeDataState data-execution-loading error={executionError} errorTitle="Award data unavailable" loadingTitle="Loading award data" loadingMessage="Published USAspending award records are loading on demand." onRetry={() => { setExecutionError(""); setExecutionLoadAttempt((value) => value + 1); }} />
        ) : null}

        {needsAccountSpine && !accountSpineReady ? (
          <RuntimeDataState data-account-spine-loading error={accountSpineError} errorTitle="Money-flow data unavailable" loadingTitle="Loading money-flow data" loadingMessage="OMB apportionments and USAspending account execution are loading on demand." onRetry={() => { setAccountSpineError(""); setAccountSpineLoadAttempt((value) => value + 1); }} />
        ) : null}

        {needsCaptureCalendar && !captureCalendarReady ? (
          <RuntimeDataState data-capture-calendar-loading error={captureCalendarError} errorTitle="Transaction timeline unavailable" loadingTitle="Loading transaction timeline" loadingMessage="Public award actions and reported contract periods are loading on demand." onRetry={() => { setCaptureCalendarError(""); setCaptureCalendarLoadAttempt((value) => value + 1); }} />
        ) : null}

        {coreReady && activeTab === "overview" ? <Overview records={records} /> : null}
        {coreReady && accountSpineReady && activeTab === "lifecycle" ? <AccountLifecycle /> : null}
        {coreReady && activeTab === "trends" ? <RequestTrends /> : null}
        {executionReady && activeTab === "awards" ? <Suspense fallback={<RuntimeDataState loadingTitle="Loading awards" loadingMessage="Award filters, evidence, and market rollups are loading." />}><AwardsRoute awardDrilldown={AWARD_DRILLDOWN} books={BOOKS} sourcePackageUrl={DATA_INVENTORY.sourcePackageUrl} snapshotGeneratedAt={data.metadata.generatedAt} methodology={data.metadata.methodology} executionCoverage={EXECUTION_COVERAGE} /></Suspense> : null}
        {executionReady && captureCalendarReady && activeTab === "calendar" ? <CaptureCalendar dataset={CAPTURE_CALENDAR} awards={AWARD_DRILLDOWN.awards} samOpportunities={SAM_OPPORTUNITIES} manualProcurement={MANUAL_PROCUREMENT} procurementDelta={PROCUREMENT_DELTA} subawardSnapshot={USASPENDING_SUBAWARDS} /> : null}
        {executionReady && captureCalendarReady && accountSpineReady && activeTab === "analytics" ? <Suspense fallback={<RuntimeDataState loadingTitle="Loading analytics" loadingMessage="Descriptive contract and transaction visualizations are loading." />}><TransactionAnalytics dataset={CAPTURE_CALENDAR} awards={AWARD_DRILLDOWN.awards} samOpportunities={SAM_OPPORTUNITIES} manualProcurement={MANUAL_PROCUREMENT} procurementDelta={PROCUREMENT_DELTA} subawardSnapshot={USASPENDING_SUBAWARDS} accountSpine={ACCOUNT_SPINE} requestLineCount={data.metadata.recordCount || data.records?.length || 0} /></Suspense> : null}
        {executionReady && captureCalendarReady && OPERATIONS_TAB_IDS.has(activeTab) ? <Suspense fallback={<RuntimeDataState loadingTitle={`Loading ${activeTitle.toLowerCase()}`} loadingMessage="The shared management workspace is loading." />}><OperationsHub view={activeTab} dataset={CAPTURE_CALENDAR} awards={AWARD_DRILLDOWN.awards} samOpportunities={SAM_OPPORTUNITIES} manualProcurement={MANUAL_PROCUREMENT} procurementDelta={PROCUREMENT_DELTA} subawardSnapshot={USASPENDING_SUBAWARDS} budgetGeneratedAt={data.metadata.generatedAt} awardGeneratedAt={EXECUTION_COVERAGE.cachedAt} /></Suspense> : null}
        {coreReady && executionReady && accountSpineReady && captureCalendarReady && activeTab === "sources" ? <Suspense fallback={<RuntimeDataState loadingTitle="Loading source lineage" loadingMessage="Source coverage and health evidence are loading." />}><AnalyticsSources budgetData={data} accountSpine={ACCOUNT_SPINE} captureCalendar={CAPTURE_CALENDAR} awardSummary={AWARD_DRILLDOWN.summary} executionCoverage={EXECUTION_COVERAGE} subawardSnapshot={USASPENDING_SUBAWARDS} /></Suspense> : null}
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

createRoot(document.getElementById("root")).render(<ToastProvider placement="bottom" maxVisible={1}><ControlErrorBoundary title="Defense Budget Intelligence could not render" message="Retry the application. If the problem continues, check the current deployment and request logs."><AuthProvider><NotificationProvider><RuntimeApp /></NotificationProvider></AuthProvider></ControlErrorBoundary></ToastProvider>);
