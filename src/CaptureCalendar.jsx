import { useEffect, useMemo, useState } from "react";
import {
  BarChart3,
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Copy,
  Download,
  ExternalLink,
  Filter,
  Search,
  ShieldCheck,
  X,
} from "lucide-react";

const FILTER_DEFAULTS = {
  capQuery: "",
  capPortfolio: "all",
  capMode: "all",
  capEvidence: "all",
  capLifecycle: "all",
  capParty: "all",
  capFrom: "2023",
  capTo: "2034",
  capMin: "all",
  capSort: "soonest",
  capRows: "50",
};

const MINIMUM_VALUES = {
  all: 0,
  "1m": 1_000_000,
  "10m": 10_000_000,
  "50m": 50_000_000,
  "100m": 100_000_000,
  "500m": 500_000_000,
};

const LABELS = {
  "contract-performance": "Contract performance",
  "acquisition-window": "Acquisition window",
  corroborated: "Corroborated",
  "official-announcement": "Official announcement",
  "source-reviewed": "Source reviewed",
  "prior-evidence": "Prior evidence",
  "evidence-gap": "Evidence gap",
  "active-reported-term": "Active reported term",
  "option-horizon-unconfirmed": "Option horizon unconfirmed",
  "historical-term": "Historical term",
  "upcoming-published-milestone": "Upcoming published milestone",
  "past-published-milestone": "Past published milestone",
  "schedule-not-published": "Schedule not published",
};

function label(value) {
  return LABELS[value] || value?.replaceAll("-", " ") || "Not published";
}

function formatMoney(value) {
  const amount = Number(value || 0);
  if (!amount) return "Not published";
  if (amount >= 1_000_000_000) return `$${(amount / 1_000_000_000).toFixed(amount >= 10_000_000_000 ? 1 : 2)}B`;
  if (amount >= 1_000_000) return `$${(amount / 1_000_000).toFixed(amount >= 10_000_000 ? 1 : 2)}M`;
  return `$${Math.round(amount / 1_000).toLocaleString()}K`;
}

function formatDate(value) {
  if (!value) return "Not published";
  return new Date(`${value}T12:00:00Z`).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" });
}

function compactDate(value) {
  if (!value) return "Undated";
  return new Date(`${value}T12:00:00Z`).toLocaleDateString(undefined, { year: "2-digit", month: "short", timeZone: "UTC" });
}

function recordDates(record) {
  if (record.mode === "contract-performance") {
    return [record.start, record.currentEnd, record.potentialEnd].filter(Boolean);
  }
  return record.milestones.flatMap((milestone) => [milestone.start, milestone.end]).filter(Boolean);
}

function firstDate(record) {
  return [...recordDates(record)].sort()[0] || "9999-12-31";
}

function finalDate(record) {
  return [...recordDates(record)].sort().at(-1) || "0000-01-01";
}

function recordValue(record) {
  return record.potentialAmount || record.valueHigh || record.obligatedAmount || record.valueLow || 0;
}

function parseHashFilters() {
  const params = new URLSearchParams(window.location.hash.split("?")[1] || "");
  const parsed = Object.fromEntries(Object.entries(FILTER_DEFAULTS).map(([key, fallback]) => [key, params.get(key) || fallback]));
  const years = new Set(Array.from({ length: 12 }, (_value, index) => String(2023 + index)));
  if (!years.has(parsed.capFrom)) parsed.capFrom = FILTER_DEFAULTS.capFrom;
  if (!years.has(parsed.capTo)) parsed.capTo = FILTER_DEFAULTS.capTo;
  if (!new Set(["25", "50", "100", "all"]).has(parsed.capRows)) parsed.capRows = FILTER_DEFAULTS.capRows;
  if (!(parsed.capMin in MINIMUM_VALUES)) parsed.capMin = FILTER_DEFAULTS.capMin;
  if (!new Set(["all", "contract-performance", "acquisition-window"]).has(parsed.capMode)) parsed.capMode = FILTER_DEFAULTS.capMode;
  if (!new Set(["soonest", "value", "obligations", "portfolio", "company"]).has(parsed.capSort)) parsed.capSort = FILTER_DEFAULTS.capSort;
  return parsed;
}

function useCaptureFilters() {
  const [filters, setFiltersState] = useState(parseHashFilters);
  useEffect(() => {
    const sync = () => setFiltersState(parseHashFilters());
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);

  function setFilters(next) {
    setFiltersState((current) => {
      const resolved = typeof next === "function" ? next(current) : { ...current, ...next };
      const [route] = window.location.hash.split("?");
      const params = new URLSearchParams(window.location.hash.split("?")[1] || "");
      for (const [key, value] of Object.entries(resolved)) {
        if (value === FILTER_DEFAULTS[key] || !value) params.delete(key);
        else params.set(key, value);
      }
      const query = params.toString();
      window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}${route}${query ? `?${query}` : ""}`);
      return resolved;
    });
  }
  return [filters, setFilters];
}

function escapeCsv(value) {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}

function downloadCsv(records) {
  const fields = ["id", "portfolio", "mode", "title", "party", "reference", "context", "lifecycleStatus", "evidenceTier", "start", "currentEnd", "potentialEnd", "obligatedAmount", "potentialAmount", "corroborationFinding"];
  const csv = [fields.join(","), ...records.map((record) => fields.map((field) => escapeCsv(record[field])).join(","))].join("\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "capture-calendar-filtered.csv";
  anchor.click();
  URL.revokeObjectURL(url);
}

function copyLink() {
  navigator.clipboard?.writeText(window.location.href);
}

function BarList({ rows, valueKey = "value", format = (value) => value.toLocaleString(), testId }) {
  const maximum = Math.max(...rows.map((row) => Number(row[valueKey] || 0)), 1);
  return (
    <div className="capture-bars" data-capture-chart={testId}>
      {rows.map((row) => (
        <article key={row.id || row.label}>
          <div><strong>{row.label}</strong><span>{format(row[valueKey])}</span></div>
          <i aria-hidden="true"><b style={{ width: `${Math.max((Number(row[valueKey] || 0) / maximum) * 100, 1)}%` }} /></i>
          {row.helper ? <small>{row.helper}</small> : null}
        </article>
      ))}
    </div>
  );
}

function SummaryMetric({ label: metricLabel, value, helper, tone = "blue" }) {
  return (
    <article className={`capture-metric capture-metric--${tone}`} data-capture-metric>
      <span>{metricLabel}</span>
      <strong>{value}</strong>
      <small>{helper}</small>
    </article>
  );
}

function DetailPanel({ record, liveAward, onClose }) {
  if (!record) return null;
  return (
    <aside className="capture-detail" data-capture-detail aria-label={`${record.title} evidence details`}>
      <div className="capture-detail__heading">
        <div>
          <span>{record.id} · {record.portfolio}</span>
          <h2>{record.title}</h2>
        </div>
        <button type="button" onClick={onClose} aria-label="Close record details"><X size={18} /></button>
      </div>
      <div className="capture-detail__grid">
        <article><span>Company / sponsor</span><strong>{liveAward?.recipient || record.party}</strong><small>{liveAward ? "Current award analytics match" : "Source record"}</small></article>
        <article><span>Reference</span><strong>{record.reference || "Not published"}</strong><small>{record.context}</small></article>
        <article><span>Reported term</span><strong>{compactDate(record.start)} to {compactDate(record.currentEnd)}</strong><small>Potential through {compactDate(record.potentialEnd)}</small></article>
        <article><span>Money</span><strong>{formatMoney(liveAward?.awardAmountDollars || record.obligatedAmount)}</strong><small>Potential / high {formatMoney(record.potentialAmount || record.valueHigh)}</small></article>
      </div>
      <p className="capture-detail__finding"><ShieldCheck size={17} aria-hidden="true" />{record.corroborationFinding || "No corroboration finding published."}</p>
      {record.sourceDescription ? <p className="capture-detail__description">{record.sourceDescription}</p> : null}
      {record.milestones.length ? (
        <div className="capture-detail__milestones">
          <h3>Published milestones</h3>
          {record.milestones.map((milestone) => <span key={`${milestone.label}-${milestone.start}`}><b>{milestone.label}</b>{formatDate(milestone.start)}{milestone.end !== milestone.start ? ` to ${formatDate(milestone.end)}` : ""}</span>)}
        </div>
      ) : null}
      <div className="capture-detail__sources">
        {record.sourceUrls.map((url, index) => (
          <a key={url} href={url} target="_blank" rel="noreferrer">Source {index + 1}<ExternalLink size={13} aria-hidden="true" /></a>
        ))}
      </div>
    </aside>
  );
}

function positionFor(date, startYear, endYear) {
  const start = Date.UTC(startYear, 0, 1);
  const end = Date.UTC(endYear + 1, 0, 1);
  const point = Date.parse(`${date}T00:00:00Z`);
  return Math.max(0, Math.min(100, ((point - start) / (end - start)) * 100));
}

function TimelineBar({ record, startYear, endYear }) {
  if (record.mode === "contract-performance" && record.start && (record.currentEnd || record.potentialEnd)) {
    const baseEnd = record.currentEnd || record.potentialEnd;
    const left = positionFor(record.start, startYear, endYear);
    const baseRight = positionFor(baseEnd, startYear, endYear);
    const potentialRight = positionFor(record.potentialEnd || baseEnd, startYear, endYear);
    return (
      <>
        <i className="capture-timeline__bar capture-timeline__bar--base" style={{ left: `${left}%`, width: `${Math.max(baseRight - left, 0.6)}%` }} title={`Reported term ${formatDate(record.start)} to ${formatDate(baseEnd)}`} />
        {potentialRight > baseRight ? <i className="capture-timeline__bar capture-timeline__bar--potential" style={{ left: `${baseRight}%`, width: `${Math.max(potentialRight - baseRight, 0.6)}%` }} title={`Potential through ${formatDate(record.potentialEnd)}`} /> : null}
      </>
    );
  }
  return record.milestones.map((milestone) => {
    const left = positionFor(milestone.start, startYear, endYear);
    const right = positionFor(milestone.end, startYear, endYear);
    return milestone.precision === "day" ? (
      <i key={`${milestone.label}-${milestone.start}`} className="capture-timeline__milestone" style={{ left: `${left}%` }} title={`${milestone.label}: ${formatDate(milestone.start)}`} />
    ) : (
      <i key={`${milestone.label}-${milestone.start}`} className="capture-timeline__bar capture-timeline__bar--window" style={{ left: `${left}%`, width: `${Math.max(right - left, 0.8)}%` }} title={`${milestone.label}: ${formatDate(milestone.start)} to ${formatDate(milestone.end)}`} />
    );
  });
}

function CaptureTimeline({ records, startYear, endYear, selectedId, onSelect }) {
  const years = Array.from({ length: endYear - startYear + 1 }, (_value, index) => startYear + index);
  const asOfPosition = positionFor("2026-09-11", startYear, endYear);
  return (
    <div className="capture-timeline" data-capture-timeline>
      <div className="capture-timeline__inner" style={{ "--capture-years": years.length }}>
        <div className="capture-timeline__head capture-timeline__label"><strong>Contract / acquisition</strong><span>Company, reference, value</span></div>
        <div className="capture-timeline__head capture-timeline__years">
          {years.map((year) => <span key={year}>{year}</span>)}
        </div>
        {records.map((record) => (
          <button key={record.id} type="button" className={`capture-timeline__row${selectedId === record.id ? " is-selected" : ""}`} onClick={() => onSelect(record.id)}>
            <span className="capture-timeline__label">
              <b>{record.id}</b>
              <strong>{record.title}</strong>
              <small>{record.party} · {record.reference || label(record.mode)} · {formatMoney(recordValue(record))}</small>
            </span>
            <span className="capture-timeline__plot" aria-label={`${record.title}: ${recordDates(record).length ? `${formatDate(firstDate(record))} to ${formatDate(finalDate(record))}` : "schedule not published"}`}>
              <span className="capture-timeline__grid" aria-hidden="true">{years.map((year) => <i key={year} />)}</span>
              {asOfPosition >= 0 && asOfPosition <= 100 ? <span className="capture-timeline__today" style={{ left: `${asOfPosition}%` }} aria-hidden="true" /> : null}
              <TimelineBar record={record} startYear={startYear} endYear={endYear} />
              {!recordDates(record).length ? <em>Schedule not published</em> : null}
            </span>
            <ChevronRight size={16} aria-hidden="true" />
          </button>
        ))}
      </div>
    </div>
  );
}

function LifecycleMatrix({ records, portfolios }) {
  const statuses = [...new Set(records.map((record) => record.lifecycleStatus))];
  const counts = new Map();
  for (const record of records) counts.set(`${record.portfolio}|${record.lifecycleStatus}`, (counts.get(`${record.portfolio}|${record.lifecycleStatus}`) || 0) + 1);
  const maximum = Math.max(...counts.values(), 1);
  return (
    <div className="capture-matrix" data-capture-matrix>
      <div className="capture-matrix__grid" style={{ "--capture-matrix-columns": statuses.length }}>
        <strong>Portfolio</strong>
        {statuses.map((status) => <strong key={status}>{label(status)}</strong>)}
        {portfolios.map((portfolio) => (
          <div className="capture-matrix__row" key={portfolio}>
            <b>{portfolio}</b>
            {statuses.map((status) => {
              const count = counts.get(`${portfolio}|${status}`) || 0;
              return <span key={status} style={{ "--capture-intensity": count / maximum }}><strong>{count || "·"}</strong><em>{label(status)}</em></span>;
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

export default function CaptureCalendar({ dataset, awards = [] }) {
  const [filters, setFilters] = useCaptureFilters();
  const [selectedId, setSelectedId] = useState("");
  const records = useMemo(() => dataset.records || [], [dataset]);
  const timelineStartYear = Math.min(Number(filters.capFrom), Number(filters.capTo));
  const timelineEndYear = Math.max(Number(filters.capFrom), Number(filters.capTo));
  const portfolios = useMemo(() => [...new Set(records.map((record) => record.portfolio))].sort(), [records]);
  const parties = useMemo(() => [...new Set(records.map((record) => record.party).filter(Boolean))].sort(), [records]);
  const awardMap = useMemo(() => new Map(awards.map((award) => [String(award.awardId || "").toUpperCase(), award])), [awards]);
  const enriched = useMemo(() => records.map((record) => ({ ...record, liveAward: awardMap.get(String(record.reference || "").toUpperCase()) || null })), [records, awardMap]);
  const filtered = useMemo(() => {
    const query = filters.capQuery.toLowerCase().trim();
    const minimum = MINIMUM_VALUES[filters.capMin] || 0;
    return enriched.filter((record) => {
      const dates = recordDates(record);
      const withinWindow = !dates.length || (Number(finalDate(record).slice(0, 4)) >= timelineStartYear && Number(firstDate(record).slice(0, 4)) <= timelineEndYear);
      const searchable = [record.id, record.title, record.party, record.reference, record.context, record.portfolio, record.sourceDescription].join(" ").toLowerCase();
      return (!query || searchable.includes(query))
        && (filters.capPortfolio === "all" || record.portfolio === filters.capPortfolio)
        && (filters.capMode === "all" || record.mode === filters.capMode)
        && (filters.capEvidence === "all" || record.evidenceTier === filters.capEvidence)
        && (filters.capLifecycle === "all" || record.lifecycleStatus === filters.capLifecycle)
        && (filters.capParty === "all" || record.party === filters.capParty)
        && recordValue(record) >= minimum
        && withinWindow;
    }).sort((left, right) => {
      if (filters.capSort === "value") return recordValue(right) - recordValue(left);
      if (filters.capSort === "obligations") return (right.liveAward?.awardAmountDollars || right.obligatedAmount || 0) - (left.liveAward?.awardAmountDollars || left.obligatedAmount || 0);
      if (filters.capSort === "portfolio") return left.portfolio.localeCompare(right.portfolio) || left.title.localeCompare(right.title);
      if (filters.capSort === "company") return left.party.localeCompare(right.party) || left.title.localeCompare(right.title);
      return firstDate(left).localeCompare(firstDate(right));
    });
  }, [enriched, filters, timelineEndYear, timelineStartYear]);

  const visible = filtered.slice(0, filters.capRows === "all" ? filtered.length : Number(filters.capRows));
  const selected = enriched.find((record) => record.id === selectedId) || null;
  const selectedLiveAward = selected ? awardMap.get(String(selected.reference || "").toUpperCase()) : null;
  const totals = filtered.reduce((summary, record) => ({
    obligated: summary.obligated + Number(record.liveAward?.awardAmountDollars || record.obligatedAmount || 0),
    potential: summary.potential + Number(record.potentialAmount || record.valueHigh || 0),
    matched: summary.matched + Number(Boolean(record.liveAward)),
    sourced: summary.sourced + Number(record.sourceUrls.length > 0),
  }), { obligated: 0, potential: 0, matched: 0, sourced: 0 });

  const portfolioRows = [...new Map(portfolios.map((portfolio) => [portfolio, { id: portfolio, label: portfolio, value: filtered.filter((record) => record.portfolio === portfolio).length }])).values()].filter((row) => row.value).sort((a, b) => b.value - a.value).slice(0, 10);
  const partyRows = [...new Set(filtered.map((record) => record.party))].map((party) => {
    const matches = filtered.filter((record) => record.party === party);
    return { id: party, label: party, value: matches.reduce((sum, record) => sum + Number(record.liveAward?.awardAmountDollars || record.obligatedAmount || 0), 0), helper: `${matches.length} record${matches.length === 1 ? "" : "s"}` };
  }).filter((row) => row.value).sort((a, b) => b.value - a.value).slice(0, 10);
  const yearRows = Array.from({ length: timelineEndYear - timelineStartYear + 1 }, (_value, index) => timelineStartYear + index).map((year) => ({
    id: year,
    label: String(year),
    value: filtered.filter((record) => recordDates(record).some((date) => Number(date.slice(0, 4)) === year)).length,
  }));
  const evidenceRows = [...new Set(records.map((record) => record.evidenceTier))].map((tier) => ({ id: tier, label: label(tier), value: filtered.filter((record) => record.evidenceTier === tier).length })).filter((row) => row.value).sort((a, b) => b.value - a.value);
  const fiscalRows = yearRows.map((year) => ({
    ...year,
    value: filtered.reduce((sum, record) => sum + record.fiscalValues.filter((item) => item.fiscalYear === Number(year.id)).reduce((yearSum, item) => yearSum + item.amount, 0), 0),
  })).filter((row) => row.value);
  const moneyRows = [
    { id: "obligated", label: "Observed obligations", value: totals.obligated, helper: "Refreshed award amount where matched" },
    { id: "potential", label: "Potential / published high", value: totals.potential, helper: "Potential values and opportunity range highs" },
  ];
  const matrixPortfolios = portfolioRows.slice(0, 8).map((row) => row.id);
  const activeFilters = Object.entries(filters).filter(([key, value]) => value !== FILTER_DEFAULTS[key]).length;

  return (
    <div className="capture-page" data-capture-calendar-page>
      <section className="capture-hero">
        <div>
          <span className="eyebrow">Public-source performance and acquisition intelligence</span>
          <h2>Growth and Capture Calendar</h2>
          <p>Interactive performance periods, acquisition windows, incumbents, spending, and evidence. Contract endpoints are not recompete dates.</p>
        </div>
        <div className="capture-hero__actions">
          <button type="button" onClick={copyLink}><Copy size={15} />Copy filtered link</button>
          <button type="button" onClick={() => downloadCsv(filtered)}><Download size={15} />Export {filtered.length.toLocaleString()} rows</button>
        </div>
      </section>

      <section className="capture-trust" aria-label="Capture calendar data boundary">
        <ShieldCheck size={18} aria-hidden="true" />
        <span><strong>{dataset.metadata.coverage.publicRows} public records</strong> from {dataset.metadata.sourcePdf.pages} source pages, checked against {dataset.metadata.corroboration.rows} corroboration rows. {dataset.metadata.coverage.excludedPrivateRows} internal campaign rows are excluded.</span>
      </section>

      <section className="capture-filters" data-capture-filters>
        <div className="capture-filters__heading"><Filter size={17} /><strong>Filter calendar</strong><span>{activeFilters ? `${activeFilters} active` : "All public records"}</span><button type="button" onClick={() => setFilters(FILTER_DEFAULTS)} disabled={!activeFilters}>Reset</button></div>
        <label className="capture-filter capture-filter--search"><span>Search</span><i><Search size={15} /><input value={filters.capQuery} onChange={(event) => setFilters({ capQuery: event.target.value })} placeholder="Program, company, reference, buyer" /></i></label>
        <label className="capture-filter"><span>Portfolio</span><select value={filters.capPortfolio} onChange={(event) => setFilters({ capPortfolio: event.target.value })}><option value="all">All portfolios</option>{portfolios.map((portfolio) => <option key={portfolio}>{portfolio}</option>)}</select></label>
        <label className="capture-filter"><span>Record type</span><select value={filters.capMode} onChange={(event) => setFilters({ capMode: event.target.value })}><option value="all">All records</option><option value="contract-performance">Contract performance</option><option value="acquisition-window">Acquisition windows</option></select></label>
        <label className="capture-filter"><span>Evidence</span><select value={filters.capEvidence} onChange={(event) => setFilters({ capEvidence: event.target.value })}><option value="all">All evidence</option>{[...new Set(records.map((record) => record.evidenceTier))].map((tier) => <option key={tier} value={tier}>{label(tier)}</option>)}</select></label>
        <label className="capture-filter"><span>Lifecycle</span><select value={filters.capLifecycle} onChange={(event) => setFilters({ capLifecycle: event.target.value })}><option value="all">All lifecycle states</option>{[...new Set(records.map((record) => record.lifecycleStatus))].map((status) => <option key={status} value={status}>{label(status)}</option>)}</select></label>
        <label className="capture-filter"><span>Company / sponsor</span><select value={filters.capParty} onChange={(event) => setFilters({ capParty: event.target.value })}><option value="all">All companies and sponsors</option>{parties.map((party) => <option key={party}>{party}</option>)}</select></label>
        <label className="capture-filter"><span>From year</span><select value={filters.capFrom} onChange={(event) => setFilters({ capFrom: event.target.value })}>{Array.from({ length: 12 }, (_value, index) => 2023 + index).map((year) => <option key={year}>{year}</option>)}</select></label>
        <label className="capture-filter"><span>Through year</span><select value={filters.capTo} onChange={(event) => setFilters({ capTo: event.target.value })}>{Array.from({ length: 12 }, (_value, index) => 2023 + index).map((year) => <option key={year}>{year}</option>)}</select></label>
        <label className="capture-filter"><span>Minimum value</span><select value={filters.capMin} onChange={(event) => setFilters({ capMin: event.target.value })}><option value="all">Any published value</option><option value="1m">$1M+</option><option value="10m">$10M+</option><option value="50m">$50M+</option><option value="100m">$100M+</option><option value="500m">$500M+</option></select></label>
        <label className="capture-filter"><span>Sort</span><select value={filters.capSort} onChange={(event) => setFilters({ capSort: event.target.value })}><option value="soonest">Soonest start / milestone</option><option value="value">Highest potential / value</option><option value="obligations">Highest obligations</option><option value="portfolio">Portfolio</option><option value="company">Company / sponsor</option></select></label>
        <label className="capture-filter"><span>Timeline rows</span><select value={filters.capRows} onChange={(event) => setFilters({ capRows: event.target.value })}><option value="25">25 rows</option><option value="50">50 rows</option><option value="100">100 rows</option><option value="all">All rows</option></select></label>
      </section>

      <section className="capture-metrics" aria-label="Filtered calendar metrics">
        <SummaryMetric label="Matching records" value={filtered.length.toLocaleString()} helper={`${filtered.filter((record) => record.mode === "contract-performance").length} contracts · ${filtered.filter((record) => record.mode === "acquisition-window").length} acquisition rows`} />
        <SummaryMetric label="Observed obligations" value={formatMoney(totals.obligated)} helper={`${totals.matched} refreshed award-bundle matches`} tone="green" />
        <SummaryMetric label="Potential / high value" value={formatMoney(totals.potential)} helper="Reported potential values and published ranges" tone="purple" />
        <SummaryMetric label="Evidence coverage" value={`${Math.round((totals.sourced / Math.max(filtered.length, 1)) * 100)}%`} helper={`${totals.sourced} rows with external sources`} tone="orange" />
      </section>

      <DetailPanel record={selected} liveAward={selectedLiveAward} onClose={() => setSelectedId("")} />

      <section className="capture-section">
        <div className="capture-section__heading"><div><CalendarClock size={18} /><span><strong>Performance and acquisition Gantt</strong><small>{visible.length.toLocaleString()} of {filtered.length.toLocaleString()} filtered rows · select a row for evidence</small></span></div><span className="capture-legend"><i className="base" />Reported term<i className="potential" />Potential<i className="window" />Published window<i className="milestone" />Milestone</span></div>
        {visible.length ? <CaptureTimeline records={visible} startYear={timelineStartYear} endYear={timelineEndYear} selectedId={selectedId} onSelect={setSelectedId} /> : <p className="capture-empty">No public records match these filters.</p>}
      </section>

      <div className="capture-dashboard-grid">
        <section className="capture-section"><div className="capture-section__heading"><div><BarChart3 size={18} /><span><strong>Portfolio concentration</strong><small>Top filtered portfolios by record count</small></span></div></div><BarList rows={portfolioRows} testId="portfolio" /></section>
        <section className="capture-section"><div className="capture-section__heading"><div><BarChart3 size={18} /><span><strong>Observed company obligations</strong><small>Top companies using refreshed award values where matched</small></span></div></div><BarList rows={partyRows} format={formatMoney} testId="company-money" /></section>
        <section className="capture-section"><div className="capture-section__heading"><div><CalendarClock size={18} /><span><strong>Calendar density</strong><small>Records touching each visible year</small></span></div></div><BarList rows={yearRows} testId="year-density" /></section>
        <section className="capture-section"><div className="capture-section__heading"><div><CheckCircle2 size={18} /><span><strong>Evidence distribution</strong><small>Corroboration strength across filtered records</small></span></div></div><BarList rows={evidenceRows} testId="evidence" /></section>
        <section className="capture-section"><div className="capture-section__heading"><div><BarChart3 size={18} /><span><strong>Reported annual net obligations</strong><small>Fiscal values printed in the source Gantt</small></span></div></div>{fiscalRows.length ? <BarList rows={fiscalRows} format={formatMoney} testId="fiscal-obligations" /> : <p className="capture-empty">No annual obligation series match these filters.</p>}</section>
        <section className="capture-section"><div className="capture-section__heading"><div><BarChart3 size={18} /><span><strong>Value posture</strong><small>Observed obligations compared with potential / published high values</small></span></div></div><BarList rows={moneyRows} format={formatMoney} testId="value-posture" /></section>
      </div>

      <section className="capture-section">
        <div className="capture-section__heading"><div><BarChart3 size={18} /><span><strong>Portfolio by lifecycle heatmap</strong><small>Top portfolios across the filtered calendar states</small></span></div></div>
        <LifecycleMatrix records={filtered} portfolios={matrixPortfolios} />
      </section>

      <section className="capture-methodology">
        <ChevronDown size={17} aria-hidden="true" />
        <div><strong>Interpretation and publication boundary</strong><p>Dates describe reported performance or published acquisition events. They do not establish recompete dates. Dollar values are award-level obligations, reported potential values, or published opportunity ranges. Internal campaign fields and proposed work packages are excluded from this public runtime.</p></div>
      </section>
    </div>
  );
}
