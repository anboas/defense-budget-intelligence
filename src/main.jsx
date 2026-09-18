import { lazy, Suspense, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { ControlAsyncState, ControlErrorBoundary, ToastProvider } from "control-surface-ui/react";
import "./control-surface.css";
import {
  BarChart3,
  BrainCircuit,
  Building2,
  CalendarClock,
  Database,
  FileSpreadsheet,
  ListChecks,
  Network,
  RefreshCcw,
  Star,
  TrendingUp,
} from "lucide-react";
import AuthProvider from "./AuthContext.jsx";
import NotificationProvider from "./NotificationContext.jsx";
import ProductMark from "./ProductMark.jsx";
import SiteHeader from "./SiteHeader.jsx";
import "./styles.generated.css";

const SpendExplorer = lazy(() => import("./SpendExplorer.jsx"));
const OperationsHub = lazy(() => import("./OperationsHub.jsx"));
const AnalyticsSources = lazy(() => import("./AnalyticsSources.jsx"));
const AwardsRoute = lazy(() => import("./AwardsRoute.jsx"));
const BudgetRequestRoutes = lazy(() => import("./BudgetRequestRoutes.jsx"));
const ProfilePage = lazy(() => import("./ProfilePage.jsx"));

const TABS = [
  { id: "overview", label: "PDB Request", icon: FileSpreadsheet, stage: "Request" },
  { id: "trends", label: "Request History", icon: TrendingUp, stage: "History" },
  { id: "lifecycle", label: "Account Flow", icon: Network, stage: "Accounts" },
  { id: "awards", label: "Awards", icon: FileSpreadsheet },
  { id: "spend", label: "Spend Explorer", icon: BarChart3 },
  { id: "schedule", label: "Schedule", icon: CalendarClock },
  { id: "watchlist", label: "Watchlist", icon: Star },
  { id: "tasks", label: "Task Center", icon: ListChecks },
  { id: "connections", label: "Connections", icon: Database },
  { id: "users", label: "Accounts", icon: Building2 },
  { id: "workspaces", label: "Workspaces", icon: Building2 },
  { id: "workspace-settings", label: "Workspace Settings", icon: Building2 },
  { id: "sources", label: "Source Lineage", icon: Database },
  { id: "profile", label: "Profile", icon: Building2 },
  { id: "security", label: "Security", icon: Building2 },
  { id: "personal-ai", label: "OpenAI Keys", icon: BrainCircuit },
];

const HASH_ROUTES = {
  overview: "#/budget-spend",
  lifecycle: "#/budget-spend/lifecycle",
  trends: "#/budget-spend/trends",
  awards: "#/budget-spend/awards",
  spend: "#/budget-spend/explorer",
  schedule: "#/budget-spend/schedule",
  watchlist: "#/budget-spend/watchlist",
  tasks: "#/budget-spend/tasks",
  connections: "#/budget-spend/connections",
  users: "#/budget-spend/users",
  workspaces: "#/budget-spend/workspaces",
  "workspace-settings": "#/budget-spend/workspace",
  sources: "#/budget-spend/sources",
  profile: "#/profile",
  security: "#/profile/security",
  "personal-ai": "#/profile/openai",
};

const LEGACY_ROUTE_TARGETS = {
  "#/budget-spend/transactions": "#/budget-spend/explorer?spendView=timeline",
  "#/budget-spend/analytics": "#/budget-spend/explorer?spendView=charts",
  "#/budget-spend/events": "#/budget-spend/schedule?scheduleView=list",
  "#/budget-spend/wallboard": "#/budget-spend/schedule?scheduleView=display",
  "#/budget-spend/integrations": "#/budget-spend/connections?connectionsView=integrations",
  "#/budget-spend/agents": "#/budget-spend/connections?connectionsView=credentials",
  "#/budget-spend/api-log": "#/budget-spend/connections?connectionsView=activity",
  "#/profile/agents": "#/budget-spend/connections?connectionsView=credentials",
  "#/profile/activity": "#/budget-spend/connections?connectionsView=activity",
};

const LEGACY_ROUTE_TABS = {
  "#/budget-spend/strategy": "overview",
  "#/budget-spend/briefs": "overview",
  "#/budget-spend/visuals": "spend",
  "#/budget-spend/hypotheses": "overview",
  "#/budget-spend/accounts": "lifecycle",
  "#/budget-spend/fit": "overview",
  "#/budget-spend/relationships": "awards",
  "#/budget-spend/pursuits": "spend",
  "#/budget-spend/capture-calendar": "spend",
  "#/budget-spend/queue": "spend",
  "#/budget-spend/services": "overview",
  "#/budget-spend/fourth-estate": "overview",
  "#/budget-spend/ai-autonomy": "overview",
  "#/budget-spend/drilldown": "overview",
  "#/budget-spend/changes": "sources",
  "#/budget-spend/operations": "watchlist",
};

function tabFromHash(hash = "") {
  const normalized = hash || HASH_ROUTES.spend;
  const routePath = normalized.split("?")[0];
  if (LEGACY_ROUTE_TARGETS[routePath]) return tabFromHash(LEGACY_ROUTE_TARGETS[routePath]);
  return Object.entries(HASH_ROUTES).find(([, route]) => route === routePath)?.[0] || LEGACY_ROUTE_TABS[routePath] || "spend";
}

function useBudgetRoute() {
  const [routeState, setRouteState] = useState(() => {
    const hash = typeof window === "undefined" ? "" : window.location.hash;
    return { activeTab: tabFromHash(hash), hash };
  });

  useEffect(() => {
    function handleRouteChange() {
      const nextTab = tabFromHash(window.location.hash);
      const routePath = (window.location.hash || HASH_ROUTES.spend).split("?")[0];
      const knownRoute = Object.values(HASH_ROUTES).includes(routePath);
      if (!window.location.hash) {
        window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}${HASH_ROUTES.spend}`);
      }
      if (LEGACY_ROUTE_TARGETS[routePath]) {
        window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}${LEGACY_ROUTE_TARGETS[routePath]}`);
      } else if (LEGACY_ROUTE_TABS[routePath] || (!knownRoute && routePath)) {
        window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}${HASH_ROUTES[nextTab]}`);
      }
      setRouteState({ activeTab: nextTab, hash: window.location.hash });
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
      setRouteState({ activeTab: tabId, hash: window.location.hash });
      return;
    }
    window.location.hash = route;
  }

  return [routeState.activeTab, openTab, routeState.hash];
}

let data = null;
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

const ADMINISTRATION_TAB_IDS = new Set(["watchlist", "tasks", "connections", "users", "workspaces", "workspace-settings"]);
const OPERATIONS_TAB_IDS = new Set(["schedule", ...ADMINISTRATION_TAB_IDS]);
const PROFILE_TAB_IDS = new Set(["profile", "security", "personal-ai"]);
const BUDGET_REQUEST_TAB_IDS = new Set(["overview", "trends", "lifecycle"]);
const CORE_TAB_IDS = new Set(["overview", "trends", "lifecycle", "sources"]);
const EXECUTION_TAB_IDS = new Set(["awards", "spend", ...OPERATIONS_TAB_IDS]);

function hydrateCore(nextData) {
  data = nextData;
  EXECUTION_COVERAGE = data.metadata.dataInventory?.executionCoverage || EXECUTION_COVERAGE;
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
  EXECUTION_COVERAGE = data.metadata.dataInventory?.executionCoverage || execution.coverage || {};
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

function App() {
  const [activeTab, , routeHash] = useBudgetRoute();
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
  const activeTitle = TABS.find((tab) => tab.id === activeTab)?.label || "PDB Request";
  const needsCore = CORE_TAB_IDS.has(activeTab);
  const needsExecution = EXECUTION_TAB_IDS.has(activeTab) || activeTab === "sources";
  const spendView = new URLSearchParams(String(routeHash || "").split("?")[1] || "").get("spendView") || "timeline";
  const needsAccountSpine = activeTab === "lifecycle" || (activeTab === "spend" && spendView === "charts") || activeTab === "sources";
  const needsCaptureCalendar = activeTab === "spend" || OPERATIONS_TAB_IDS.has(activeTab) || activeTab === "sources";

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
          {activeTitle} view loaded.
        </p>
        {needsCore && !coreReady ? (
          <RuntimeDataState data-budget-core-loading error={coreError} errorTitle="Budget request data unavailable" loadingTitle="Loading budget request data" loadingMessage="The detailed budget request dataset is loading for this workspace." onRetry={() => { setCoreError(""); setCoreLoadAttempt((value) => value + 1); }} />
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

        {coreReady && BUDGET_REQUEST_TAB_IDS.has(activeTab) && (activeTab !== "lifecycle" || accountSpineReady) ? <Suspense fallback={<RuntimeDataState loadingTitle={`Loading ${activeTitle.toLowerCase()}`} loadingMessage="Budget request analysis and money-flow evidence are loading." />}><BudgetRequestRoutes view={activeTab} budgetData={data} accountSpine={ACCOUNT_SPINE} /></Suspense> : null}
        {executionReady && activeTab === "awards" ? <Suspense fallback={<RuntimeDataState loadingTitle="Loading awards" loadingMessage="Award filters, evidence, and market rollups are loading." />}><AwardsRoute awardDrilldown={AWARD_DRILLDOWN} books={data.metadata.sources || []} sourcePackageUrl={data.metadata.dataInventory?.sourcePackageUrl || ""} snapshotGeneratedAt={data.metadata.generatedAt} methodology={data.metadata.methodology} executionCoverage={EXECUTION_COVERAGE} /></Suspense> : null}
        {executionReady && captureCalendarReady && (!needsAccountSpine || accountSpineReady) && activeTab === "spend" ? <Suspense fallback={<RuntimeDataState loadingTitle="Loading Spend Explorer" loadingMessage="Timeline, table, and chart views are loading." />}><SpendExplorer dataset={CAPTURE_CALENDAR} awards={AWARD_DRILLDOWN.awards} samOpportunities={SAM_OPPORTUNITIES} manualProcurement={MANUAL_PROCUREMENT} procurementDelta={PROCUREMENT_DELTA} subawardSnapshot={USASPENDING_SUBAWARDS} accountSpine={ACCOUNT_SPINE} requestLineCount={data.metadata.recordCount || data.records?.length || 0} /></Suspense> : null}
        {executionReady && captureCalendarReady && OPERATIONS_TAB_IDS.has(activeTab) ? <Suspense fallback={<RuntimeDataState loadingTitle={`Loading ${activeTitle.toLowerCase()}`} loadingMessage="The shared management workspace is loading." />}><OperationsHub view={activeTab} dataset={CAPTURE_CALENDAR} awards={AWARD_DRILLDOWN.awards} samOpportunities={SAM_OPPORTUNITIES} manualProcurement={MANUAL_PROCUREMENT} procurementDelta={PROCUREMENT_DELTA} subawardSnapshot={USASPENDING_SUBAWARDS} budgetGeneratedAt={data.metadata.generatedAt} awardGeneratedAt={EXECUTION_COVERAGE.cachedAt} /></Suspense> : null}
        {coreReady && executionReady && accountSpineReady && captureCalendarReady && activeTab === "sources" ? <Suspense fallback={<RuntimeDataState loadingTitle="Loading source lineage" loadingMessage="Source coverage and health evidence are loading." />}><AnalyticsSources budgetData={data} accountSpine={ACCOUNT_SPINE} captureCalendar={CAPTURE_CALENDAR} awardSummary={AWARD_DRILLDOWN.summary} executionCoverage={EXECUTION_COVERAGE} subawardSnapshot={USASPENDING_SUBAWARDS} /></Suspense> : null}
        {PROFILE_TAB_IDS.has(activeTab) ? <Suspense fallback={<RuntimeDataState loadingTitle={`Loading ${activeTitle.toLowerCase()}`} loadingMessage="Personal settings and account controls are loading." />}><ProfilePage section={activeTab} /></Suspense> : null}
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
