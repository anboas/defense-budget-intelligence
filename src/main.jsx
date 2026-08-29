import { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  BarChart3,
  BrainCircuit,
  Building2,
  CalendarClock,
  Database,
  ExternalLink,
  FileText,
  FileSpreadsheet,
  Filter,
  GitBranch,
  Layers,
  RefreshCcw,
  Search,
  TrendingUp,
} from "lucide-react";
import data from "./data/budget-intelligence.json";
import sourceHealth from "./data/source-health.json";
import "./styles.css";

const TABS = [
  { id: "overview", label: "Overview", icon: BarChart3 },
  { id: "trends", label: "Trends", icon: TrendingUp },
  { id: "strategy", label: "Strategy", icon: GitBranch },
  { id: "awards", label: "Awards", icon: FileSpreadsheet },
  { id: "pursuits", label: "Pursuits", icon: CalendarClock },
  { id: "services", label: "Services", icon: Building2 },
  { id: "fourth", label: "Fourth Estate", icon: Layers },
  { id: "ai", label: "AI / Autonomy", icon: BrainCircuit },
  { id: "drilldown", label: "Drilldown", icon: Search },
  { id: "sources", label: "Data Sources", icon: Database },
];

const INTELLIGENCE_SUITE = [
  { label: "Budget & Spend", href: "https://defense-budget-intelligence.pages.dev/", active: true },
  { label: "Opportunity", href: "https://opportunity-intelligence-full.pages.dev/" },
  { label: "Policy", href: "https://policy-intelligence-full.pages.dev/" },
];

const HASH_ROUTES = {
  overview: "#/budget-spend",
  trends: "#/budget-spend/trends",
  strategy: "#/budget-spend/strategy",
  awards: "#/budget-spend/awards",
  pursuits: "#/budget-spend/pursuits",
  services: "#/budget-spend/services",
  fourth: "#/budget-spend/fourth-estate",
  ai: "#/budget-spend/ai-autonomy",
  drilldown: "#/budget-spend/drilldown",
  sources: "#/budget-spend/sources",
};

function tabFromHash(hash = "") {
  const normalized = hash || HASH_ROUTES.overview;
  return Object.entries(HASH_ROUTES).find(([, route]) => route === normalized)?.[0] || "overview";
}

function useBudgetRoute() {
  const [activeTab, setActiveTab] = useState(() => tabFromHash(typeof window === "undefined" ? "" : window.location.hash));

  useEffect(() => {
    function handleRouteChange() {
      setActiveTab(tabFromHash(window.location.hash));
    }
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

const BOOKS = data.metadata.sources;
const SIGNALS = data.signals;
const DATA_INVENTORY = data.metadata.dataInventory;
const REQUEST_HISTORY = DATA_INVENTORY.requestHistory || [];
const TREND_SUMMARY = DATA_INVENTORY.trendSummary || {};
const ANALYTICS = DATA_INVENTORY.analyticsReadouts || {};
const STRATEGY = DATA_INVENTORY.strategyAnalytics || {};
const JUSTIFICATION_COVERAGE = DATA_INVENTORY.justificationCoverage || {};
const EXECUTION = STRATEGY.executionAnalytics || {};
const EXECUTION_COVERAGE = DATA_INVENTORY.executionCoverage || EXECUTION.coverage || {};
const AWARD_DRILLDOWN = EXECUTION.awardDrilldown || { summary: {}, awards: [], byBuyer: [], byVendor: [], byPsc: [], byNaics: [], byTechnologyArea: [] };
const PURSUIT_TIMING = EXECUTION.pursuitTiming || { summary: {}, lanes: [], recompeteCandidates: [], byContractType: [], byBuyer: [], byVendor: [] };
const EMPTY_ROWS = Object.freeze([]);

function money(value, digits = 1) {
  const number = Number(value || 0);
  if (number > 0 && Math.abs(number) < 0.1) return `$${(number * 1000).toFixed(0)}M`;
  return `$${number.toFixed(digits)}B`;
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
      <label>
        <span>Color</span>
        <select value={filters.book} onChange={(event) => setFilters({ ...filters, book: event.target.value })}>
          <option value="all">All colors</option>
          {BOOKS.map((book) => <option key={book.id} value={book.id}>{book.short} · {book.color}</option>)}
        </select>
      </label>
      <label>
        <span>Org type</span>
        <select value={filters.group} onChange={(event) => setFilters({ ...filters, group: event.target.value })}>
          <option value="all">All DoD</option>
          <option value="service">Services</option>
          <option value="fourth-estate">Fourth Estate</option>
          <option value="other">Other / Reconciliation</option>
        </select>
      </label>
      <label>
        <span>Signal</span>
        <select value={filters.signal} onChange={(event) => setFilters({ ...filters, signal: event.target.value })}>
          <option value="all">All signals</option>
          {SIGNALS.map((signal) => <option key={signal.id} value={signal.id}>{signal.label}</option>)}
        </select>
      </label>
      <label>
        <span>Organization</span>
        <select value={filters.org} onChange={(event) => setFilters({ ...filters, org: event.target.value })}>
          <option value="all">All organizations</option>
          {orgs.map((org) => <option key={org.id} value={org.id}>{org.label}</option>)}
        </select>
      </label>
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
      <AnalyticsReadout items={ANALYTICS.headlineCards || []} meta="portfolio posture" />
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
      <section className="source-metrics trend-metrics" aria-label="Request trend summary">
        <Metric label="Request vintages" value={yearList(DATA_INVENTORY.availableBudgetRequestYears)} helper={`${TREND_SUMMARY.sourceVersionCount || 0} workbook versions parsed`} />
        <Metric label="Historical records" value={(TREND_SUMMARY.historicalRecordCount || 0).toLocaleString()} helper="Aggregate model records across request packages" tone="purple" />
        <Metric label="Comparable set" value={`${TREND_SUMMARY.comparableBookCount || 0} books`} helper={(TREND_SUMMARY.comparableBooks || []).join(", ")} tone="green" />
        <Metric label="Comparable trend" value={pct(TREND_SUMMARY.comparableGrowth || 0)} helper={`${money(TREND_SUMMARY.comparableEarliestRequestValue)} FY${TREND_SUMMARY.comparableEarliestRequestYear} to ${money(TREND_SUMMARY.comparableCurrentRequestValue)} FY${latest?.requestYear}`} tone="orange" />
      </section>

      <AnalyticsReadout title="Trend Readout" meta="request-vintage interpretation" items={ANALYTICS.observations || []} icon={TrendingUp} />

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

      <Section title="Momentum Leaders" meta="largest FY2026-FY2027 request moves" icon={TrendingUp}>
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
  const [selectedAreaId, setSelectedAreaId] = useState(() => areas[0]?.id || "all");
  const selectedArea = areas.find((area) => area.id === selectedAreaId) || areas[0];
  const maxArea = Math.max(...areas.map((area) => area.fy2027), 1);
  const maxClient = Math.max(...intersections.map((lane) => lane.fy2027), 1);

  return (
    <div className="grid strategy-page" data-strategy-page>
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
  return (
    <div className="table-shell" data-budget-record-table>
      <table>
        <thead>
          <tr>
            <th>Line item</th>
            <th>Org</th>
            <th>Color</th>
            <th>FY25</th>
            <th>FY26</th>
            <th>FY27</th>
            <th>Trend</th>
          </tr>
        </thead>
        <tbody>
          {records.map((record) => (
            <tr key={record.id}>
              <td>
                <strong>{record.lineTitle || record.budgetActivityTitle || record.accountTitle}</strong>
                {!compact ? <span>{record.accountTitle} · {record.budgetActivityTitle}</span> : null}
              </td>
              <td>{record.orgName}</td>
              <td><i className="dot" style={{ background: BOOK_COLORS[record.bookId] }} />{record.colorShort}</td>
              <td>{money(record.fy2025)}</td>
              <td>{money(record.fy2026)}</td>
              <td>{money(record.fy2027)}</td>
              <td>{pct(growth(record))}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function awardOptionRows(awards, keyFn) {
  return [...new Map(awards.map(keyFn).filter((item) => item?.id).map((item) => [item.id, item])).values()]
    .sort((a, b) => a.label.localeCompare(b.label));
}

function Awards() {
  const awards = AWARD_DRILLDOWN.awards;
  const summary = AWARD_DRILLDOWN.summary || {};
  const [filters, setFilters] = useState({ query: "", area: "all", buyer: "all", vendor: "all", workType: "all", sort: "amount" });
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
  const topBuyer = aggregateAwardsForUi(filteredAwards, (award) => ({ id: award.buyerSubAgency, label: award.buyerSubAgency })).slice(0, 4);
  const topVendor = aggregateAwardsForUi(filteredAwards, (award) => ({ id: award.recipient, label: award.recipient })).slice(0, 4);
  const topWork = aggregateAwardsForUi(filteredAwards.filter((award) => award.pscCode || award.naicsCode), (award) => ({
    id: award.pscCode || award.naicsCode,
    label: award.pscCode ? `${award.pscCode} · ${award.pscDescription || "Unlabeled PSC"}` : `${award.naicsCode} · ${award.naicsDescription || "Unlabeled NAICS"}`,
  })).slice(0, 4);

  return (
    <div className="grid awards-page" data-awards-page>
      <section className="award-hero">
        <div>
          <span>Contract award drilldown</span>
          <h2>USAspending Award Records</h2>
          <p>Deduped contract award records from cached USAspending technology searches, with buyer, vendor, PSC, NAICS, dates, descriptions, and Award IDs. This is sampled award intelligence, not exhaustive FPDS action history.</p>
        </div>
        <div className="award-hero__facts" aria-label="Award drilldown summary">
          <article>
            <strong>{(summary.awards || awards.length).toLocaleString()}</strong>
            <span>deduped awards</span>
          </article>
          <article>
            <strong>{money(summary.sampledAwardValue || 0)}</strong>
            <span>sampled value</span>
          </article>
          <article>
            <strong>{summary.buyerCount || 0}</strong>
            <span>buyers</span>
          </article>
          <article>
            <strong>{summary.vendorCount || 0}</strong>
            <span>vendors</span>
          </article>
        </div>
      </section>

      <div className="award-filter-bar" data-award-filter-bar>
        <label className="searchbox">
          <Search size={15} aria-hidden="true" />
          <input placeholder="Search award IDs, vendors, buyers, descriptions" value={filters.query} onChange={(event) => setFilters({ ...filters, query: event.target.value })} />
        </label>
        <label>
          <span>Area</span>
          <select value={filters.area} onChange={(event) => setFilters({ ...filters, area: event.target.value })}>
            <option value="all">All areas</option>
            {areaOptions.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
          </select>
        </label>
        <label>
          <span>Buyer</span>
          <select value={filters.buyer} onChange={(event) => setFilters({ ...filters, buyer: event.target.value })}>
            <option value="all">All buyers</option>
            {buyerOptions.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
          </select>
        </label>
        <label>
          <span>Vendor</span>
          <select value={filters.vendor} onChange={(event) => setFilters({ ...filters, vendor: event.target.value })}>
            <option value="all">All vendors</option>
            {vendorOptions.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
          </select>
        </label>
        <label>
          <span>Work type</span>
          <select value={filters.workType} onChange={(event) => setFilters({ ...filters, workType: event.target.value })}>
            <option value="all">All PSC / NAICS</option>
            {workTypeOptions.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
          </select>
        </label>
        <label>
          <span>Sort</span>
          <select value={filters.sort} onChange={(event) => setFilters({ ...filters, sort: event.target.value })}>
            <option value="amount">Award value</option>
            <option value="end">End date</option>
            <option value="start">Start date</option>
            <option value="vendor">Vendor</option>
          </select>
        </label>
      </div>

      <section className="if-metric-grid source-metrics" aria-label="Award filter metrics">
        <Metric label="Filtered awards" value={filteredAwards.length.toLocaleString()} helper={`${visibleAwards.length.toLocaleString()} shown in table`} />
        <Metric label="Filtered value" value={money(filteredValue)} helper="Deduped award amount from current filters" tone="green" />
        <Metric label="Largest buyer" value={topBuyer[0]?.label || "n/a"} helper={topBuyer[0] ? `${money(topBuyer[0].awardAmount)} · ${topBuyer[0].awards} awards` : "No matching awards"} tone="purple" />
        <Metric label="Largest vendor" value={topVendor[0]?.label || "n/a"} helper={topVendor[0] ? `${money(topVendor[0].awardAmount)} · ${topVendor[0].awards} awards` : "No matching awards"} tone="orange" />
      </section>

      <div className="grid grid--sources">
        <AwardRollup title="Top Buyers" rows={topBuyer} />
        <AwardRollup title="Top Vendors" rows={topVendor} />
        <AwardRollup title="Top Work Types" rows={topWork} />
      </div>

      <Section title="Award Records" meta={`${filteredAwards.length.toLocaleString()} matched · showing ${visibleAwards.length.toLocaleString()}`} icon={FileSpreadsheet}>
        <AwardTable awards={visibleAwards} />
      </Section>
    </div>
  );
}

function Pursuits() {
  const lanes = PURSUIT_TIMING.lanes || EMPTY_ROWS;
  const candidates = PURSUIT_TIMING.recompeteCandidates || EMPTY_ROWS;
  const summary = PURSUIT_TIMING.summary || {};
  const [filters, setFilters] = useState({ query: "", area: "all", buyer: "all", workType: "all", sort: "score" });
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
  const topBuyer = aggregateAwardsForUi(filteredCandidates, (award) => ({ id: award.buyerSubAgency, label: award.buyerSubAgency })).slice(0, 1)[0];
  const topVendor = aggregateAwardsForUi(filteredCandidates, (award) => ({ id: award.recipient, label: award.recipient })).slice(0, 1)[0];

  return (
    <div className="grid pursuits-page" data-pursuits-page>
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
        <label>
          <span>Area</span>
          <select value={filters.area} onChange={(event) => setFilters({ ...filters, area: event.target.value })}>
            <option value="all">All areas</option>
            {areaOptions.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
          </select>
        </label>
        <label>
          <span>Buyer</span>
          <select value={filters.buyer} onChange={(event) => setFilters({ ...filters, buyer: event.target.value })}>
            <option value="all">All buyers</option>
            {buyerOptions.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
          </select>
        </label>
        <label>
          <span>Work type</span>
          <select value={filters.workType} onChange={(event) => setFilters({ ...filters, workType: event.target.value })}>
            <option value="all">All PSC / NAICS</option>
            {workTypeOptions.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
          </select>
        </label>
        <label>
          <span>Sort</span>
          <select value={filters.sort} onChange={(event) => setFilters({ ...filters, sort: event.target.value })}>
            <option value="score">Pursuit score</option>
            <option value="end">Next end date</option>
            <option value="near">Near-term value</option>
            <option value="value">Active value</option>
          </select>
        </label>
      </div>

      <section className="if-metric-grid source-metrics" aria-label="Pursuit filter metrics">
        <Metric label="Matched lanes" value={filteredLanes.length.toLocaleString()} helper={`${filteredCandidates.length.toLocaleString()} near-term awards under current filters`} />
        <Metric label="Near-term value" value={money(nearTermValue)} helper="Awards ending within 24 months in current filters" tone="green" />
        <Metric label="Largest buyer" value={topBuyer?.label || "n/a"} helper={topBuyer ? `${money(topBuyer.awardAmount)} · ${topBuyer.awards} awards` : "No matching candidates"} tone="purple" />
        <Metric label="Largest incumbent" value={topVendor?.label || "n/a"} helper={topVendor ? `${money(topVendor.awardAmount)} · ${topVendor.awards} awards` : "No matching candidates"} tone="orange" />
      </section>

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

function PursuitCandidateTable({ awards }) {
  return (
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
  return (
    <div className="table-shell award-table-shell" data-award-record-table>
      <table>
        <thead>
          <tr>
            <th>Award</th>
            <th>Vendor</th>
            <th>Buyer</th>
            <th>Area</th>
            <th>Work type</th>
            <th>Dates</th>
            <th>Value</th>
          </tr>
        </thead>
        <tbody>
          {awards.map((award) => (
            <tr key={award.id}>
              <td>
                <strong>{award.awardId || award.id}</strong>
                <span>{award.contractType || "Contract award"} · {award.description || "No description"}</span>
              </td>
              <td>{award.recipient}</td>
              <td>
                <strong>{award.buyerSubAgency}</strong>
                <span>{award.fundingOffice || award.awardingOffice || award.awardingSubAgency}</span>
              </td>
              <td>{(award.areas || [award.area]).slice(0, 2).join(", ")}</td>
              <td>
                <strong>{award.pscCode || award.naicsCode || "n/a"}</strong>
                <span>{award.pscDescription || award.naicsDescription || "Uncoded"}</span>
              </td>
              <td>
                <strong>{award.startDate || "n/a"}</strong>
                <span>{award.endDate ? `Ends ${award.endDate}` : "End date unknown"}</span>
              </td>
              <td>{money(award.awardAmount)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

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

  return (
    <div className="grid">
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

function App() {
  const [activeTab, setActiveTab] = useBudgetRoute();
  const [filters, setFilters] = useState({ query: "", book: "all", group: "all", signal: "all", org: "all" });
  const records = useFilteredRecords(filters);
  const total = aggregate(records, () => ({ id: "filtered", label: "Filtered portfolio" }))[0] || { fy2025: 0, fy2026: 0, fy2027: 0, records: 0 };
  const ai = aggregate(records.filter((record) => record.signals.includes("ai-autonomy")), () => ({ id: "ai", label: "AI / Autonomy" }))[0] || { fy2027: 0, records: 0 };
  const fourth = aggregate(records.filter((record) => record.orgGroup === "fourth-estate"), () => ({ id: "fourth", label: "Fourth Estate" }))[0] || { fy2027: 0, records: 0 };
  const activeTitle = activeTab === "overview" ? "Budget & Spend Intelligence" : TABS.find((tab) => tab.id === activeTab)?.label || "Budget & Spend Intelligence";
  const showBudgetControls = !["sources", "trends", "strategy", "awards", "pursuits"].includes(activeTab);

  return (
    <main className="if-main if-operations-app if-operations-app--wide if-operations-app--sticky-header ci-budget-app ci-intelligence-platform app" data-defense-budget-app data-budget-spend-app>
      <header className="if-product-header if-product-header--masthead if-product-header--compact if-product-header--sticky ci-sticky-header masthead" data-budget-spend-header>
        <div className="if-product-header__inner masthead__inner">
          <button
            type="button"
            className="if-brand masthead__brand if-product-header__brand"
            data-home-link
            aria-label="Go to Budget & Spend overview"
            title="Go to Budget & Spend overview"
            onClick={() => setActiveTab("overview")}
          >
            <span className="if-brand__mark masthead__mark" aria-hidden="true">
              <BarChart3 size={18} strokeWidth={2.4} />
            </span>
            <span className="masthead__copy">
              <span className="if-product-header__eyebrow">Defense Budget & Spend Intelligence</span>
              <span className="if-product-header__title" data-active-page-title>{activeTitle}</span>
            </span>
          </button>
          <nav className="if-operations-topnav ci-header-nav" aria-label="Budget and spend intelligence sections">
            {TABS.map((tab) => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.id}
                  type="button"
                  className={`if-operations-topnav__link${activeTab === tab.id ? " is-active active" : ""}`}
                  aria-current={activeTab === tab.id ? "page" : undefined}
                  data-budget-nav={HASH_ROUTES[tab.id]}
                  onClick={() => setActiveTab(tab.id)}
                >
                  <Icon size={15} aria-hidden="true" />
                  {tab.label}
                </button>
              );
            })}
          </nav>
        </div>
      </header>

      <div className={`if-content if-page if-operations-workspace if-operations-workspace--compact app__content app__content--${activeTab}`} data-if-operations-workspace data-visual-density="compact">
        <div className="suite-links" aria-label="Complementary intelligence platforms" data-peer-intelligence-nav>
          {INTELLIGENCE_SUITE.map((site) => (
            <a
              key={site.label}
              href={site.href}
              target={site.active ? undefined : "_blank"}
              rel={site.active ? undefined : "noreferrer"}
              className={site.active ? "active" : ""}
              aria-current={site.active ? "page" : undefined}
            >
              {site.label}
            </a>
          ))}
        </div>

        {showBudgetControls ? (
          <>
            <FilterShell filters={filters} setFilters={setFilters} />

            <section className="if-metric-grid metrics" aria-label="Filtered budget metrics">
              <Metric label="Filtered FY2027 request" value={money(total.fy2027)} helper={`${total.records} line records · ${pct(growth(total))} since FY2025`} />
              <Metric label="AI / autonomy signal" value={money(ai.fy2027)} helper={`${ai.records} matched source lines`} tone="purple" />
              <Metric label="Fourth Estate" value={money(fourth.fy2027)} helper={`${fourth.records} agency / joint records`} tone="green" />
              <Metric label="Data depth" value={`${data.records.length.toLocaleString()} lines`} helper="M-1, O-1, P-1, R-1, RF-1, C-1" tone="orange" />
            </section>
          </>
        ) : null}

        {activeTab === "overview" ? <Overview records={records} /> : null}
        {activeTab === "trends" ? <RequestTrends /> : null}
        {activeTab === "strategy" ? <Strategy /> : null}
        {activeTab === "awards" ? <Awards /> : null}
        {activeTab === "pursuits" ? <Pursuits /> : null}
        {activeTab === "services" ? <Services records={records} /> : null}
        {activeTab === "fourth" ? <FourthEstate records={records} /> : null}
        {activeTab === "ai" ? <AiAutonomy records={records} /> : null}
        {activeTab === "drilldown" ? <Drilldown records={records} /> : null}
        {activeTab === "sources" ? <Sources /> : null}
      </div>
    </main>
  );
}

createRoot(document.getElementById("root")).render(<App />);
