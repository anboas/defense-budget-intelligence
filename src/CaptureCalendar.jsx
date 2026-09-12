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

function downloadCsv(records, metadata) {
  const fields = ["snapshotAsOf", "viewUrl", "opportunityId", "ganttAlias", "portfolio", "mode", "title", "party", "reference", "context", "lifecycleStatus", "evidenceTier", "validationStatus", "start", "currentEnd", "potentialEnd", "obligatedAmount", "potentialAmount", "fpdsActionCount", "primarySourceUrl", "fpdsSourceUrl"];
  const rows = records.map((record) => ({
    snapshotAsOf: metadata.asOf,
    viewUrl: window.location.href,
    opportunityId: record.opportunityId,
    ganttAlias: record.id,
    portfolio: record.portfolio,
    mode: record.mode,
    title: record.title,
    party: record.party,
    reference: record.reference,
    context: record.context,
    lifecycleStatus: record.lifecycleStatus,
    evidenceTier: record.evidenceTier,
    validationStatus: record.validationStatus,
    start: record.start,
    currentEnd: record.currentEnd,
    potentialEnd: record.potentialEnd,
    obligatedAmount: record.obligatedAmount,
    potentialAmount: record.potentialAmount,
    fpdsActionCount: record.transactionSummary?.actions || 0,
    primarySourceUrl: record.sourceUrls?.[0] || "",
    fpdsSourceUrl: record.sourceUrls?.find((url) => url.includes("fpds.gov")) || "",
  }));
  const csv = [fields.join(","), ...rows.map((record) => fields.map((field) => escapeCsv(record[field])).join(","))].join("\n");
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

function signedMoney(value) {
  const amount = Number(value || 0);
  if (!amount) return "$0";
  return `${amount > 0 ? "+" : "−"}${formatMoney(Math.abs(amount))}`;
}

function downloadActionsCsv(record, actions) {
  const fields = ["opportunityId", "ganttAlias", "piid", "parentPiid", "modification", "transactionNumber", "signed", "direction", "obligationDelta", "potentialDelta", "obligationsTotal", "potentialTotal", "performanceStart", "currentEnd", "potentialEnd", "supportingInstrument", "vendor", "uei", "description"];
  const rows = actions.map((action) => ({ opportunityId: record.opportunityId, ganttAlias: record.id, ...action }));
  const csv = [fields.join(","), ...rows.map((row) => fields.map((field) => escapeCsv(row[field])).join(","))].join("\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${record.reference || record.id}-fpds-actions.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
}

function ActionTrend({ actions }) {
  const points = actions
    .filter((action) => !action.supportingInstrument && action.signed && action.obligationsTotal != null)
    .sort((left, right) => left.signed.localeCompare(right.signed) || left.actionId.localeCompare(right.actionId));
  if (points.length < 2) return <p className="capture-empty">No primary-award cumulative series is available.</p>;
  const width = 760;
  const height = 190;
  const inset = { top: 18, right: 16, bottom: 28, left: 64 };
  const minimum = Math.min(0, ...points.map((point) => point.obligationsTotal));
  const maximum = Math.max(...points.map((point) => point.obligationsTotal), 1);
  const timeMinimum = Date.parse(`${points[0].signed}T00:00:00Z`);
  const timeMaximum = Date.parse(`${points.at(-1).signed}T00:00:00Z`);
  const x = (date) => inset.left + ((Date.parse(`${date}T00:00:00Z`) - timeMinimum) / Math.max(timeMaximum - timeMinimum, 1)) * (width - inset.left - inset.right);
  const y = (value) => inset.top + (1 - ((value - minimum) / Math.max(maximum - minimum, 1))) * (height - inset.top - inset.bottom);
  const path = points.map((point, index) => `${index ? "L" : "M"}${x(point.signed).toFixed(1)},${y(point.obligationsTotal).toFixed(1)}`).join(" ");
  return (
    <div className="capture-action-trend" data-capture-action-chart>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Cumulative primary-award FPDS obligations from ${formatDate(points[0].signed)} through ${formatDate(points.at(-1).signed)}`}>
        <line x1={inset.left} x2={width - inset.right} y1={y(minimum)} y2={y(minimum)} />
        <path d={path} />
        <circle cx={x(points.at(-1).signed)} cy={y(points.at(-1).obligationsTotal)} r="4" />
        <text x={inset.left} y={height - 8}>{points[0].signed.slice(0, 4)}</text>
        <text x={width - inset.right} y={height - 8} textAnchor="end">{points.at(-1).signed.slice(0, 4)}</text>
        <text x={inset.left - 8} y={y(maximum) + 4} textAnchor="end">{formatMoney(maximum)}</text>
        <text x={inset.left - 8} y={y(minimum) + 4} textAnchor="end">{minimum ? formatMoney(minimum) : "$0"}</text>
      </svg>
    </div>
  );
}

function AwardActionHistory({ record, actions, state, onRetry }) {
  const [expanded, setExpanded] = useState(false);
  if (!record.transactionSummary?.actions) return null;
  if (state === "loading") return <section className="capture-action-history" data-capture-actions-loading role="status">Loading exact FPDS action history…</section>;
  if (state === "error") return <section className="capture-action-history" role="alert">Action history could not be loaded. <button type="button" onClick={onRetry}>Retry</button></section>;
  const recent = [...actions].sort((left, right) => (right.signed || "").localeCompare(left.signed || "") || right.actionId.localeCompare(left.actionId)).slice(0, 24);
  const visible = expanded ? recent : recent.slice(0, 10);
  return (
    <section className="capture-action-history" data-capture-action-history>
      <div className="capture-action-history__heading">
        <div><strong>FPDS modification and transaction history</strong><small>{record.transactionSummary.actions.toLocaleString()} exact public actions across {record.transactionSummary.instruments} instrument{record.transactionSummary.instruments === 1 ? "" : "s"}</small></div>
        <span>{formatDate(record.transactionSummary.firstSigned)} to {formatDate(record.transactionSummary.lastSigned)}</span>
      </div>
      <div className="capture-action-stats">
        <article><span>Primary net obligations</span><strong>{formatMoney(record.transactionSummary.primaryNetObligations)}</strong></article>
        <article><span>Funding actions</span><strong>{record.transactionSummary.fundingActions.toLocaleString()}</strong></article>
        <article><span>Deobligations</span><strong>{record.transactionSummary.deobligationActions.toLocaleString()}</strong></article>
        <article><span>Supporting actions</span><strong>{record.transactionSummary.supportingActions.toLocaleString()}</strong></article>
      </div>
      <ActionTrend actions={actions} />
      {record.corroborationStatus === "newer_fpds_action" ? (
        <p className="capture-action-discrepancy"><strong>Newer FPDS action:</strong> FPDS includes a later public modification than the current USAspending transaction set. USAspending values above remain primary; the FPDS totals are shown separately.</p>
      ) : null}
      <div className="capture-action-table" data-capture-action-table>
        <table>
          <thead><tr><th>Signed</th><th>PIID / modification</th><th>Action</th><th>Obligation change</th><th>Cumulative obligations</th><th>Reported end</th><th>Description</th></tr></thead>
          <tbody>{visible.map((action) => <tr key={action.actionId}>
            <td>{formatDate(action.signed)}</td>
            <td><strong>{action.piid}</strong><small>{action.modification || "Base"} · txn {action.transactionNumber || "0"}{action.supportingInstrument ? " · supporting" : ""}</small></td>
            <td><span className={`capture-action-direction capture-action-direction--${action.direction}`}>{label(action.direction)}</span></td>
            <td className={action.obligationDelta < 0 ? "is-negative" : action.obligationDelta > 0 ? "is-positive" : ""}>{signedMoney(action.obligationDelta)}</td>
            <td>{formatMoney(action.obligationsTotal)}</td>
            <td>{formatDate(action.currentEnd)}</td>
            <td>{action.description || "Not published"}</td>
          </tr>)}</tbody>
        </table>
      </div>
      <div className="capture-action-history__actions">
        {recent.length > 10 ? <button type="button" onClick={() => setExpanded((value) => !value)}>{expanded ? "Show recent 10" : `Show latest ${recent.length}`}</button> : null}
        <button type="button" onClick={() => downloadActionsCsv(record, actions)}><Download size={14} />Export all {actions.length.toLocaleString()} actions</button>
      </div>
      <small className="capture-action-history__limit">Showing {visible.length} of {actions.length.toLocaleString()} actions. The chart uses every primary-award action; the CSV includes the full exact history.</small>
    </section>
  );
}

function DetailPanel({ record, liveAward, actions, actionState, onRetryActions, onClose }) {
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
        <article><span>USAspending money</span><strong>{formatMoney(liveAward?.awardAmountDollars || record.obligatedAmount)}</strong><small>Potential / high {formatMoney(record.potentialAmount || record.valueHigh)}</small></article>
        <article><span>FPDS public action sum</span><strong>{formatMoney(record.fpdsObligatedAmount)}</strong><small>Potential {formatMoney(record.fpdsPotentialAmount)}</small></article>
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
      <AwardActionHistory key={record.opportunityId} record={record} actions={actions} state={actionState} onRetry={onRetryActions} />
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
          <button key={record.opportunityId} type="button" className={`capture-timeline__row${selectedId === record.opportunityId ? " is-selected" : ""}`} onClick={() => onSelect(record.opportunityId)}>
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
  const [selectedId, setSelectedIdState] = useState(() => new URLSearchParams(window.location.hash.split("?")[1] || "").get("capRecord") || "");
  const [actionDataset, setActionDataset] = useState(null);
  const [actionState, setActionState] = useState("idle");
  const [actionLoadAttempt, setActionLoadAttempt] = useState(0);
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
  const selected = enriched.find((record) => record.opportunityId === selectedId) || null;
  const selectedLiveAward = selected ? awardMap.get(String(selected.reference || "").toUpperCase()) : null;
  const selectedActions = actionDataset?.byOpportunity?.[selectedId] || [];
  const resolvedActionState = actionDataset ? "ready" : actionState === "error" ? "error" : "loading";

  function setSelectedId(nextId) {
    setSelectedIdState(nextId);
    const [route] = window.location.hash.split("?");
    const params = new URLSearchParams(window.location.hash.split("?")[1] || "");
    if (nextId) params.set("capRecord", nextId);
    else params.delete("capRecord");
    const query = params.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}${route}${query ? `?${query}` : ""}`);
  }

  useEffect(() => {
    const sync = () => setSelectedIdState(new URLSearchParams(window.location.hash.split("?")[1] || "").get("capRecord") || "");
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);

  useEffect(() => {
    if (!selectedId || selected) return;
    const timer = window.setTimeout(() => setSelectedId(""), 0);
    return () => window.clearTimeout(timer);
  }, [selected, selectedId]);

  useEffect(() => {
    if (!selected?.transactionSummary?.actions || actionDataset) return;
    let cancelled = false;
    fetch(`${import.meta.env.BASE_URL}data/capture-transactions.json`)
      .then((response) => {
        if (!response.ok) throw new Error(`Transaction payload returned ${response.status}`);
        return response.json();
      })
      .then((payload) => {
        if (payload.metadata?.actionCount !== dataset.metadata.coverage.fpdsActions) throw new Error("Transaction payload coverage mismatch");
        if (!cancelled) {
          setActionDataset(payload);
          setActionState("ready");
        }
      })
      .catch(() => { if (!cancelled) setActionState("error"); });
    return () => { cancelled = true; };
  }, [actionDataset, actionLoadAttempt, dataset.metadata.coverage.fpdsActions, selected]);
  const totals = filtered.reduce((summary, record) => ({
    obligated: summary.obligated + Number(record.liveAward?.awardAmountDollars || record.obligatedAmount || 0),
    potential: summary.potential + Number(record.potentialAmount || record.valueHigh || 0),
    matched: summary.matched + Number(Boolean(record.liveAward)),
    sourced: summary.sourced + Number(record.sourceUrls.length > 0),
    actions: summary.actions + Number(record.transactionSummary?.actions || 0),
    fundingActions: summary.fundingActions + Number(record.transactionSummary?.fundingActions || 0),
    deobligationActions: summary.deobligationActions + Number(record.transactionSummary?.deobligationActions || 0),
  }), { obligated: 0, potential: 0, matched: 0, sourced: 0, actions: 0, fundingActions: 0, deobligationActions: 0 });

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
  const actionRows = yearRows.map((year) => ({
    ...year,
    value: filtered.reduce((sum, record) => sum + (record.fiscalActions || []).filter((item) => item.fiscalYear === Number(year.id)).reduce((yearSum, item) => yearSum + item.actions, 0), 0),
  })).filter((row) => row.value);
  const actionDirectionRows = [
    { id: "funding", label: "Funding actions", value: totals.fundingActions },
    { id: "deobligation", label: "Deobligations", value: totals.deobligationActions },
    { id: "non-obligation", label: "Non-obligation actions", value: Math.max(totals.actions - totals.fundingActions - totals.deobligationActions, 0) },
  ].filter((row) => row.value);
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
          <button type="button" onClick={() => downloadCsv(filtered, dataset.metadata)}><Download size={15} />Export {filtered.length.toLocaleString()} rows</button>
        </div>
      </section>

      <section className="capture-trust" aria-label="Capture calendar data boundary">
        <ShieldCheck size={18} aria-hidden="true" />
        <span><strong>{dataset.metadata.coverage.publicRows} public records</strong> with {dataset.metadata.coverage.normalizedEvents.toLocaleString()} normalized events and {dataset.metadata.coverage.fpdsActions.toLocaleString()} exact FPDS actions across {dataset.metadata.coverage.uniqueAwards} awards. {dataset.metadata.coverage.excludedPrivateRows} internal campaign rows are excluded.</span>
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
        <SummaryMetric label="FPDS actions" value={totals.actions.toLocaleString()} helper={`${totals.fundingActions.toLocaleString()} funding · ${totals.deobligationActions.toLocaleString()} deobligation`} tone="green" />
      </section>

      <DetailPanel record={selected} liveAward={selectedLiveAward} actions={selectedActions} actionState={resolvedActionState} onRetryActions={() => { setActionState("idle"); setActionDataset(null); setActionLoadAttempt((value) => value + 1); }} onClose={() => setSelectedId("")} />

      <section className="capture-section">
        <div className="capture-section__heading"><div><CalendarClock size={18} /><span><strong>Performance and acquisition Gantt</strong><small>{visible.length.toLocaleString()} of {filtered.length.toLocaleString()} filtered rows · select a row for evidence</small></span></div><span className="capture-legend"><i className="base" />Reported term<i className="potential" />Potential<i className="window" />Published window<i className="milestone" />Milestone</span></div>
        {visible.length ? <CaptureTimeline records={visible} startYear={timelineStartYear} endYear={timelineEndYear} selectedId={selectedId} onSelect={setSelectedId} /> : <p className="capture-empty">No public records match these filters.</p>}
      </section>

      <div className="capture-dashboard-grid">
        <section className="capture-section"><div className="capture-section__heading"><div><BarChart3 size={18} /><span><strong>Portfolio concentration</strong><small>Top filtered portfolios by record count</small></span></div></div><BarList rows={portfolioRows} testId="portfolio" /></section>
        <section className="capture-section"><div className="capture-section__heading"><div><BarChart3 size={18} /><span><strong>Observed company obligations</strong><small>Top companies using refreshed award values where matched</small></span></div></div><BarList rows={partyRows} format={formatMoney} testId="company-money" /></section>
        <section className="capture-section"><div className="capture-section__heading"><div><CalendarClock size={18} /><span><strong>Calendar density</strong><small>Records touching each visible year</small></span></div></div><BarList rows={yearRows} testId="year-density" /></section>
        <section className="capture-section"><div className="capture-section__heading"><div><CheckCircle2 size={18} /><span><strong>Evidence distribution</strong><small>Corroboration strength across filtered records</small></span></div></div><BarList rows={evidenceRows} testId="evidence" /></section>
        <section className="capture-section"><div className="capture-section__heading"><div><BarChart3 size={18} /><span><strong>FPDS annual net obligations</strong><small>Primary-award action deltas by fiscal year</small></span></div></div>{fiscalRows.length ? <BarList rows={fiscalRows} format={formatMoney} testId="fiscal-obligations" /> : <p className="capture-empty">No annual obligation series match these filters.</p>}</section>
        <section className="capture-section"><div className="capture-section__heading"><div><BarChart3 size={18} /><span><strong>Value posture</strong><small>Observed obligations compared with potential / published high values</small></span></div></div><BarList rows={moneyRows} format={formatMoney} testId="value-posture" /></section>
        <section className="capture-section"><div className="capture-section__heading"><div><CalendarClock size={18} /><span><strong>FPDS action volume</strong><small>Primary-award transaction actions by fiscal year</small></span></div></div>{actionRows.length ? <BarList rows={actionRows} testId="action-volume" /> : <p className="capture-empty">No FPDS action history matches these filters.</p>}</section>
        <section className="capture-section"><div className="capture-section__heading"><div><BarChart3 size={18} /><span><strong>Funding action direction</strong><small>Derived only from signed obligation deltas</small></span></div></div>{actionDirectionRows.length ? <BarList rows={actionDirectionRows} testId="action-direction" /> : <p className="capture-empty">No FPDS action history matches these filters.</p>}</section>
      </div>

      <section className="capture-section">
        <div className="capture-section__heading"><div><BarChart3 size={18} /><span><strong>Portfolio by lifecycle heatmap</strong><small>Top portfolios across the filtered calendar states</small></span></div></div>
        <LifecycleMatrix records={filtered} portfolios={matrixPortfolios} />
      </section>

      <section className="capture-methodology">
        <ChevronDown size={17} aria-hidden="true" />
        <div><strong>Interpretation and publication boundary</strong><p>Dates describe reported performance or published acquisition events. They do not establish recompete dates. USAspending award totals remain primary. FPDS actions provide exact modification history and are never added to USAspending totals. Supporting-instrument actions remain separately labeled. Internal campaign fields, target mappings, access labels, and proposed work packages are excluded from this public runtime.</p></div>
      </section>
    </div>
  );
}
