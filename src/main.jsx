import { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
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
  const showBudgetControls = !["sources", "trends"].includes(activeTab);

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
