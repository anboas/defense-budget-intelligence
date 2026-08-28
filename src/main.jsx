import { useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  BarChart3,
  BrainCircuit,
  Building2,
  Database,
  ExternalLink,
  Filter,
  GitBranch,
  Layers,
  Search,
  TrendingUp,
} from "lucide-react";
import data from "./data/budget-intelligence.json";
import "./styles.css";

const TABS = [
  { id: "overview", label: "Overview", icon: BarChart3 },
  { id: "services", label: "Services", icon: Building2 },
  { id: "fourth", label: "Fourth Estate", icon: Layers },
  { id: "ai", label: "AI / Autonomy", icon: BrainCircuit },
  { id: "drilldown", label: "Drilldown", icon: Search },
  { id: "sources", label: "Sources", icon: Database },
];

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

function money(value, digits = 1) {
  const number = Number(value || 0);
  if (number > 0 && Math.abs(number) < 0.1) return `$${(number * 1000).toFixed(0)}M`;
  return `$${number.toFixed(digits)}B`;
}

function pct(value, digits = 1) {
  const number = Number(value || 0);
  return `${number > 0 ? "+" : ""}${number.toFixed(digits)}%`;
}

function growth(row) {
  if (!row?.fy2025) return row?.fy2027 ? 100 : 0;
  return ((row.fy2027 - row.fy2025) / row.fy2025) * 100;
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
    <article className={`metric metric--${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <p>{helper}</p>
    </article>
  );
}

function Section({ title, meta, children, icon: Icon }) {
  return (
    <section className="panel">
      <header className="panel__header">
        <div>
          {Icon ? <Icon size={16} aria-hidden="true" /> : null}
          <h2>{title}</h2>
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
    <div className="filters" aria-label="Budget filters">
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
        <button type="button" className={sort === "growth" ? "active" : ""} onClick={() => setSort("growth")}><TrendingUp size={14} /> Growth</button>
      </div>
      <RecordTable records={rows} />
    </Section>
  );
}

function Sources() {
  return (
    <Section title="Metadata And Source Trail" meta="official display workbooks" icon={Database}>
      <div className="source-copy">
        <p>{data.metadata.methodology}</p>
        <p>Generated: {new Date(data.metadata.generatedAt).toLocaleString()}</p>
      </div>
      <div className="source-grid">
        {BOOKS.map((source) => (
          <a key={source.id} href={source.sourceUrl} target="_blank" rel="noreferrer">
            <strong>{source.short}</strong>
            <span>{source.color}</span>
            <ExternalLink size={14} aria-hidden="true" />
          </a>
        ))}
      </div>
    </Section>
  );
}

function App() {
  const [activeTab, setActiveTab] = useState("overview");
  const [filters, setFilters] = useState({ query: "", book: "all", group: "all", signal: "all", org: "all" });
  const records = useFilteredRecords(filters);
  const total = aggregate(records, () => ({ id: "filtered", label: "Filtered portfolio" }))[0] || { fy2025: 0, fy2026: 0, fy2027: 0, records: 0 };
  const ai = aggregate(records.filter((record) => record.signals.includes("ai-autonomy")), () => ({ id: "ai", label: "AI / Autonomy" }))[0] || { fy2027: 0, records: 0 };
  const fourth = aggregate(records.filter((record) => record.orgGroup === "fourth-estate"), () => ({ id: "fourth", label: "Fourth Estate" }))[0] || { fy2027: 0, records: 0 };

  return (
    <main className="app" data-defense-budget-app>
      <header className="masthead">
        <div>
          <span>Sabre Growth Intelligence</span>
          <h1>Defense Budget Intelligence</h1>
          <p>Drill from DoD portfolio totals into services, Fourth Estate agencies, colors of money, mission signals, and source line items.</p>
        </div>
        <nav aria-label="Budget analytics views">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            return (
              <button key={tab.id} type="button" className={activeTab === tab.id ? "active" : ""} onClick={() => setActiveTab(tab.id)}>
                <Icon size={15} aria-hidden="true" />
                {tab.label}
              </button>
            );
          })}
        </nav>
      </header>

      <FilterShell filters={filters} setFilters={setFilters} />

      <section className="metrics" aria-label="Filtered budget metrics">
        <Metric label="Filtered FY2027 request" value={money(total.fy2027)} helper={`${total.records} line records · ${pct(growth(total))} since FY2025`} />
        <Metric label="AI / autonomy signal" value={money(ai.fy2027)} helper={`${ai.records} matched source lines`} tone="purple" />
        <Metric label="Fourth Estate" value={money(fourth.fy2027)} helper={`${fourth.records} agency / joint records`} tone="green" />
        <Metric label="Data depth" value={`${data.records.length.toLocaleString()} lines`} helper="M-1, O-1, P-1, R-1, RF-1, C-1" tone="orange" />
      </section>

      {activeTab === "overview" ? <Overview records={records} /> : null}
      {activeTab === "services" ? <Services records={records} /> : null}
      {activeTab === "fourth" ? <FourthEstate records={records} /> : null}
      {activeTab === "ai" ? <AiAutonomy records={records} /> : null}
      {activeTab === "drilldown" ? <Drilldown records={records} /> : null}
      {activeTab === "sources" ? <Sources /> : null}
    </main>
  );
}

createRoot(document.getElementById("root")).render(<App />);
