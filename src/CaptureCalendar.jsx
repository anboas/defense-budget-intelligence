import { Fragment, useEffect, useMemo, useRef, useState } from "react";
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
  capOffice: "all",
  capVehicle: "all",
  capValidation: "all",
  capHorizon: "all",
  capActivity: "all",
  capFrom: "2023",
  capTo: "2034",
  capMin: "all",
  capSort: "soonest",
  capRows: "50",
  capDensity: "comfortable",
  capGroup: "none",
  capLabels: "dates",
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

function recordObligations(record) {
  return Number(record.liveAward?.awardAmountDollars || record.obligatedAmount || 0);
}

function dateDiffDays(start, end) {
  if (!start || !end) return null;
  return Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000);
}

function monthYear(value) {
  if (!value) return "";
  return new Date(`${value}T12:00:00Z`).toLocaleDateString(undefined, { month: "short", year: "2-digit", timeZone: "UTC" });
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
  if (!new Set(["all", "verified", "corrected", "unresolved"]).has(parsed.capValidation)) parsed.capValidation = FILTER_DEFAULTS.capValidation;
  if (!new Set(["all", "active", "ending12", "ending24", "upcoming", "past", "undated"]).has(parsed.capHorizon)) parsed.capHorizon = FILTER_DEFAULTS.capHorizon;
  if (!new Set(["all", "funding", "deobligation", "recent", "no-actions"]).has(parsed.capActivity)) parsed.capActivity = FILTER_DEFAULTS.capActivity;
  if (!new Set(["comfortable", "compact"]).has(parsed.capDensity)) parsed.capDensity = FILTER_DEFAULTS.capDensity;
  if (!new Set(["none", "portfolio"]).has(parsed.capGroup)) parsed.capGroup = FILTER_DEFAULTS.capGroup;
  if (!new Set(["dates", "money", "none"]).has(parsed.capLabels)) parsed.capLabels = FILTER_DEFAULTS.capLabels;
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
  const fields = ["snapshotAsOf", "viewUrl", "opportunityId", "ganttAlias", "portfolio", "mode", "title", "party", "reference", "parentReference", "context", "fundingOffice", "contractingOffice", "vehicle", "lifecycleStatus", "evidenceTier", "validationStatus", "validationCheckedAt", "start", "currentEnd", "potentialEnd", "obligatedAmount", "potentialAmount", "fpdsObligatedAmount", "fpdsPotentialAmount", "sourceRoleCount", "normalizedEventCount", "fpdsActionCount", "fundingActionCount", "deobligationActionCount", "lastFpdsAction", "primarySourceUrl", "fpdsSourceUrl"];
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
    parentReference: record.parentReference,
    context: record.context,
    fundingOffice: record.fundingOffice,
    contractingOffice: record.contractingOffice,
    vehicle: record.vehicle,
    lifecycleStatus: record.lifecycleStatus,
    evidenceTier: record.evidenceTier,
    validationStatus: record.validationStatus,
    validationCheckedAt: record.validationCheckedAt,
    start: record.start,
    currentEnd: record.currentEnd,
    potentialEnd: record.potentialEnd,
    obligatedAmount: record.obligatedAmount,
    potentialAmount: record.potentialAmount,
    fpdsObligatedAmount: record.fpdsObligatedAmount,
    fpdsPotentialAmount: record.fpdsPotentialAmount,
    sourceRoleCount: record.sourceRoleCount,
    normalizedEventCount: record.events.length,
    fpdsActionCount: record.transactionSummary?.actions || 0,
    fundingActionCount: record.transactionSummary?.fundingActions || 0,
    deobligationActionCount: record.transactionSummary?.deobligationActions || 0,
    lastFpdsAction: record.transactionSummary?.lastSigned || "",
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

function StackedMoneyList({ rows }) {
  return (
    <div className="capture-money-stack" data-capture-chart="obligation-headroom">
      {rows.map((row) => {
        const total = Math.max(row.potential, row.obligated, 1);
        const obligatedWidth = Math.min((row.obligated / total) * 100, 100);
        const remaining = Math.max(row.potential - row.obligated, 0);
        return (
          <article key={row.id}>
            <div><strong>{row.label}</strong><span>{Math.round(obligatedWidth)}% obligated</span></div>
            <i aria-label={`${formatMoney(row.obligated)} obligated of ${formatMoney(row.potential)} potential`}>
              <b style={{ width: `${obligatedWidth}%` }} />
              <em style={{ width: `${100 - obligatedWidth}%` }} />
            </i>
            <small>{formatMoney(row.obligated)} obligated · {formatMoney(remaining)} reported headroom</small>
          </article>
        );
      })}
    </div>
  );
}

function QuarterOutlook({ rows }) {
  const maximum = Math.max(...rows.map((row) => row.total), 1);
  return (
    <div className="capture-quarter-outlook" data-capture-chart="quarter-outlook">
      {rows.map((row) => (
        <article key={row.id} style={{ "--capture-quarter-intensity": row.total / maximum }}>
          <strong>{row.label}</strong>
          <span>{row.total}</span>
          <small>{row.ends} end{row.ends === 1 ? "" : "s"} · {row.milestones} milestone{row.milestones === 1 ? "" : "s"}</small>
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
  const observed = Number(liveAward?.awardAmountDollars || record.obligatedAmount || 0);
  const potential = Number(record.potentialAmount || record.valueHigh || 0);
  const utilization = potential ? Math.min((observed / potential) * 100, 100) : null;
  const durationDays = dateDiffDays(record.start, record.currentEnd);
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
        <article><span>USAspending money</span><strong>{formatMoney(observed)}</strong><small>Potential / high {formatMoney(potential)}</small></article>
        <article><span>FPDS public action sum</span><strong>{formatMoney(record.fpdsObligatedAmount)}</strong><small>Potential {formatMoney(record.fpdsPotentialAmount)}</small></article>
        <article><span>Obligation posture</span><strong>{utilization == null ? "Not calculable" : `${Math.round(utilization)}% of potential`}</strong><small>{potential ? `${formatMoney(Math.max(potential - observed, 0))} reported headroom` : "No potential value published"}</small></article>
        <article><span>Reported duration</span><strong>{durationDays == null ? "Not published" : `${Math.max(Math.round(durationDays / 30.44), 1)} months`}</strong><small>{label(record.lifecycleStatus)}</small></article>
        <article><span>Funding office</span><strong>{record.fundingOffice || record.owner || "Not published"}</strong><small>Distinct from contracting office</small></article>
        <article><span>Contracting office</span><strong>{record.contractingOffice || "Not published"}</strong><small>{record.vehicle || "Vehicle not identified"}</small></article>
        <article><span>Source posture</span><strong>{record.sourceRoleCount} source role{record.sourceRoleCount === 1 ? "" : "s"}</strong><small>{label(record.validationStatus)} · checked {formatDate(record.validationCheckedAt?.slice(0, 10))}</small></article>
      </div>
      <p className="capture-detail__finding"><ShieldCheck size={17} aria-hidden="true" />{record.corroborationFinding || "No corroboration finding published."}</p>
      {record.sourceDescription ? <p className="capture-detail__description">{record.sourceDescription}</p> : null}
      {record.milestones.length ? (
        <div className="capture-detail__milestones">
          <h3>Published milestones</h3>
          {record.milestones.map((milestone) => <span key={`${milestone.label}-${milestone.start}`}><b>{milestone.label}</b>{formatDate(milestone.start)}{milestone.end !== milestone.start ? ` to ${formatDate(milestone.end)}` : ""}</span>)}
        </div>
      ) : null}
      {record.events.length ? (
        <div className="capture-detail__events" data-capture-event-ledger>
          <h3>Canonical event ledger</h3>
          {record.events.map((event) => (
            <span key={event.eventId}>
              <b>{event.label}</b>
              <small>{formatDate(event.start)}{event.end && event.end !== event.start ? ` to ${formatDate(event.end)}` : ""}</small>
              <em>{event.precision || "unknown precision"}{event.isForecast ? " · forecast" : " · reported"}{event.status ? ` · ${event.status}` : ""}</em>
            </span>
          ))}
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

function TimelineBar({ record, startYear, endYear, asOf, labelMode }) {
  if (record.mode === "contract-performance" && record.start && (record.currentEnd || record.potentialEnd)) {
    const baseEnd = record.currentEnd || record.potentialEnd;
    const left = positionFor(record.start, startYear, endYear);
    const baseRight = positionFor(baseEnd, startYear, endYear);
    const potentialRight = positionFor(record.potentialEnd || baseEnd, startYear, endYear);
    const elapsed = Math.max(0, Math.min(100, (dateDiffDays(record.start, asOf) / Math.max(dateDiffDays(record.start, baseEnd), 1)) * 100));
    const state = baseEnd < asOf ? "historical" : record.start > asOf ? "upcoming" : "active";
    const dateLabel = `${monthYear(record.start)} → ${monthYear(baseEnd)}`;
    const moneyLabel = formatMoney(recordObligations(record));
    return (
      <>
        {potentialRight > baseRight ? (
          <i className="capture-timeline__bar capture-timeline__bar--potential" style={{ left: `${baseRight}%`, width: `${Math.max(potentialRight - baseRight, 0.6)}%` }} title={`Potential through ${formatDate(record.potentialEnd)}`}>
            {potentialRight - baseRight >= 9 && labelMode !== "none" ? <b>Option to {monthYear(record.potentialEnd)}</b> : null}
          </i>
        ) : null}
        <i className={`capture-timeline__bar capture-timeline__bar--base capture-timeline__bar--${state}`} style={{ left: `${left}%`, width: `${Math.max(baseRight - left, 0.6)}%` }} title={`Reported term ${formatDate(record.start)} to ${formatDate(baseEnd)}`}>
          <span style={{ width: `${elapsed}%` }} aria-hidden="true" />
          {baseRight - left >= 10 && labelMode !== "none" ? <b>{labelMode === "money" ? moneyLabel : dateLabel}</b> : null}
        </i>
      </>
    );
  }
  return record.milestones.map((milestone) => {
    const left = positionFor(milestone.start, startYear, endYear);
    const right = positionFor(milestone.end, startYear, endYear);
    return milestone.precision === "day" ? (
      <i key={`${milestone.label}-${milestone.start}`} className="capture-timeline__milestone" style={{ left: `${left}%` }} title={`${milestone.label}: ${formatDate(milestone.start)}`}><span>{labelMode === "none" ? "" : milestone.label}</span></i>
    ) : (
      <i key={`${milestone.label}-${milestone.start}`} className="capture-timeline__bar capture-timeline__bar--window" style={{ left: `${left}%`, width: `${Math.max(right - left, 0.8)}%` }} title={`${milestone.label}: ${formatDate(milestone.start)} to ${formatDate(milestone.end)}`}>
        {right - left >= 8 && labelMode !== "none" ? <b>{labelMode === "money" ? formatMoney(recordValue(record)) : milestone.label}</b> : null}
      </i>
    );
  });
}

function CaptureTimeline({ records, startYear, endYear, selectedId, onSelect, asOf, density, groupBy, labelMode }) {
  const scrollerRef = useRef(null);
  const years = Array.from({ length: endYear - startYear + 1 }, (_value, index) => startYear + index);
  const asOfPosition = positionFor(asOf, startYear, endYear);
  const showAsOf = asOf >= `${startYear}-01-01` && asOf <= `${endYear}-12-31`;
  const groups = groupBy === "portfolio"
    ? [...new Set(records.map((record) => record.portfolio))].map((portfolio) => ({ portfolio, records: records.filter((record) => record.portfolio === portfolio) }))
    : [{ portfolio: null, records }];
  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller || !showAsOf || !window.matchMedia("(max-width: 760px)").matches) return;
    const frame = window.requestAnimationFrame(() => {
      const labelWidth = 244;
      const plotWidth = Math.max(scroller.scrollWidth - labelWidth - 24, 1);
      scroller.scrollLeft = Math.max(labelWidth + (asOfPosition / 100) * plotWidth - scroller.clientWidth / 2, 0);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [asOfPosition, endYear, showAsOf, startYear]);
  return (
    <div ref={scrollerRef} className={`capture-timeline capture-timeline--${density}`} data-capture-timeline>
      <div className="capture-timeline__inner" style={{ "--capture-years": years.length }}>
        <div className="capture-timeline__head capture-timeline__label"><strong>Contract / acquisition</strong><span>Company, reference, value</span></div>
        <div className="capture-timeline__head capture-timeline__years">
          {years.map((year) => <span key={year}><b>{year}</b><small><i>Q1</i><i>Q2</i><i>Q3</i><i>Q4</i></small></span>)}
          {showAsOf ? <em className="capture-timeline__today-label" style={{ left: `${asOfPosition}%` }}>As of {monthYear(asOf)}</em> : null}
        </div>
        {groups.map((group) => (
          <Fragment key={group.portfolio || "all"}>
            {group.portfolio ? <div className="capture-timeline__group"><strong>{group.portfolio}</strong><span>{group.records.length} row{group.records.length === 1 ? "" : "s"}</span></div> : null}
            {group.records.map((record) => (
              <button key={record.opportunityId} type="button" className={`capture-timeline__row capture-timeline__row--${record.lifecycleStatus}${selectedId === record.opportunityId ? " is-selected" : ""}`} onClick={() => onSelect(record.opportunityId)}>
                <span className="capture-timeline__label">
                  <span className="capture-timeline__badges"><b>{record.id}</b><em>{label(record.lifecycleStatus)}</em></span>
                  <strong>{record.title}</strong>
                  <small>{record.party} · {record.reference || label(record.mode)} · {formatMoney(recordValue(record))}</small>
                </span>
                <span className="capture-timeline__plot" aria-label={`${record.title}: ${recordDates(record).length ? `${formatDate(firstDate(record))} to ${formatDate(finalDate(record))}` : "schedule not published"}`}>
                  <span className="capture-timeline__grid" aria-hidden="true">{years.map((year) => <i key={year} />)}</span>
                  {showAsOf ? <span className="capture-timeline__today" style={{ left: `${asOfPosition}%` }} aria-hidden="true" /> : null}
                  <TimelineBar record={record} startYear={startYear} endYear={endYear} asOf={asOf} labelMode={labelMode} />
                  {!recordDates(record).length ? <em>Schedule not published</em> : null}
                </span>
                <ChevronRight size={16} aria-hidden="true" />
              </button>
            ))}
          </Fragment>
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
  const [filtersExpanded, setFiltersExpanded] = useState(false);
  const records = useMemo(() => dataset.records || [], [dataset]);
  const asOf = dataset.metadata.asOf;
  const timelineStartYear = Math.min(Number(filters.capFrom), Number(filters.capTo));
  const timelineEndYear = Math.max(Number(filters.capFrom), Number(filters.capTo));
  const portfolios = useMemo(() => [...new Set(records.map((record) => record.portfolio))].sort(), [records]);
  const parties = useMemo(() => [...new Set(records.map((record) => record.party).filter(Boolean))].sort(), [records]);
  const offices = useMemo(() => [...new Set(records.flatMap((record) => [record.contractingOffice, record.fundingOffice, record.owner]).filter(Boolean))].sort(), [records]);
  const vehicles = useMemo(() => [...new Set(records.map((record) => record.vehicle).filter(Boolean))].sort(), [records]);
  const evidenceTiers = useMemo(() => [...new Set(records.map((record) => record.evidenceTier))], [records]);
  const lifecycleStates = useMemo(() => [...new Set(records.map((record) => record.lifecycleStatus))], [records]);
  const awardMap = useMemo(() => new Map(awards.map((award) => [String(award.awardId || "").toUpperCase(), award])), [awards]);
  const enriched = useMemo(() => records.map((record) => ({ ...record, liveAward: awardMap.get(String(record.reference || "").toUpperCase()) || null })), [records, awardMap]);

  useEffect(() => {
    const normalized = {};
    if (filters.capPortfolio !== "all" && !portfolios.includes(filters.capPortfolio)) normalized.capPortfolio = "all";
    if (filters.capEvidence !== "all" && !evidenceTiers.includes(filters.capEvidence)) normalized.capEvidence = "all";
    if (filters.capLifecycle !== "all" && !lifecycleStates.includes(filters.capLifecycle)) normalized.capLifecycle = "all";
    if (filters.capParty !== "all" && !parties.includes(filters.capParty)) normalized.capParty = "all";
    if (filters.capOffice !== "all" && !offices.includes(filters.capOffice)) normalized.capOffice = "all";
    if (filters.capVehicle !== "all" && !vehicles.includes(filters.capVehicle)) normalized.capVehicle = "all";
    if (!Object.keys(normalized).length) return undefined;
    const timer = window.setTimeout(() => setFilters(normalized), 0);
    return () => window.clearTimeout(timer);
  }, [evidenceTiers, filters.capEvidence, filters.capLifecycle, filters.capOffice, filters.capParty, filters.capPortfolio, filters.capVehicle, lifecycleStates, offices, parties, portfolios, setFilters, vehicles]);
  const filtered = useMemo(() => {
    const query = filters.capQuery.toLowerCase().trim();
    const minimum = MINIMUM_VALUES[filters.capMin] || 0;
    const twelveMonths = new Date(`${asOf}T00:00:00Z`); twelveMonths.setUTCFullYear(twelveMonths.getUTCFullYear() + 1);
    const twentyFourMonths = new Date(`${asOf}T00:00:00Z`); twentyFourMonths.setUTCFullYear(twentyFourMonths.getUTCFullYear() + 2);
    const recentCutoff = new Date(`${asOf}T00:00:00Z`); recentCutoff.setUTCFullYear(recentCutoff.getUTCFullYear() - 1);
    return enriched.filter((record) => {
      const dates = recordDates(record);
      const withinWindow = !dates.length || (Number(finalDate(record).slice(0, 4)) >= timelineStartYear && Number(firstDate(record).slice(0, 4)) <= timelineEndYear);
      const currentEnd = record.currentEnd || record.milestones[0]?.end || record.milestones[0]?.start || null;
      const lastAction = record.transactionSummary?.lastSigned || "";
      const horizonMatch = filters.capHorizon === "all"
        || (filters.capHorizon === "active" && record.start <= asOf && currentEnd >= asOf)
        || (filters.capHorizon === "ending12" && currentEnd >= asOf && currentEnd <= twelveMonths.toISOString().slice(0, 10))
        || (filters.capHorizon === "ending24" && currentEnd >= asOf && currentEnd <= twentyFourMonths.toISOString().slice(0, 10))
        || (filters.capHorizon === "upcoming" && firstDate(record) > asOf)
        || (filters.capHorizon === "past" && finalDate(record) < asOf)
        || (filters.capHorizon === "undated" && !dates.length);
      const activityMatch = filters.capActivity === "all"
        || (filters.capActivity === "funding" && record.transactionSummary?.fundingActions > 0)
        || (filters.capActivity === "deobligation" && record.transactionSummary?.deobligationActions > 0)
        || (filters.capActivity === "recent" && lastAction >= recentCutoff.toISOString().slice(0, 10))
        || (filters.capActivity === "no-actions" && !record.transactionSummary?.actions);
      const searchable = [record.id, record.title, record.party, record.reference, record.context, record.portfolio, record.sourceDescription, record.contractingOffice, record.fundingOffice, record.vehicle].join(" ").toLowerCase();
      return (!query || searchable.includes(query))
        && (filters.capPortfolio === "all" || record.portfolio === filters.capPortfolio)
        && (filters.capMode === "all" || record.mode === filters.capMode)
        && (filters.capEvidence === "all" || record.evidenceTier === filters.capEvidence)
        && (filters.capLifecycle === "all" || record.lifecycleStatus === filters.capLifecycle)
        && (filters.capParty === "all" || record.party === filters.capParty)
        && (filters.capOffice === "all" || [record.contractingOffice, record.fundingOffice, record.owner].includes(filters.capOffice))
        && (filters.capVehicle === "all" || record.vehicle === filters.capVehicle)
        && (filters.capValidation === "all" || record.validationStatus === filters.capValidation)
        && horizonMatch
        && activityMatch
        && recordValue(record) >= minimum
        && withinWindow;
    }).sort((left, right) => {
      if (filters.capSort === "value") return recordValue(right) - recordValue(left);
      if (filters.capSort === "obligations") return (right.liveAward?.awardAmountDollars || right.obligatedAmount || 0) - (left.liveAward?.awardAmountDollars || left.obligatedAmount || 0);
      if (filters.capSort === "portfolio") return left.portfolio.localeCompare(right.portfolio) || left.title.localeCompare(right.title);
      if (filters.capSort === "company") return left.party.localeCompare(right.party) || left.title.localeCompare(right.title);
      return firstDate(left).localeCompare(firstDate(right));
    });
  }, [asOf, enriched, filters, timelineEndYear, timelineStartYear]);

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
    endingWithinYear: summary.endingWithinYear + Number(Boolean(record.currentEnd && record.currentEnd >= asOf && dateDiffDays(asOf, record.currentEnd) <= 365)),
  }), { obligated: 0, potential: 0, matched: 0, sourced: 0, actions: 0, fundingActions: 0, deobligationActions: 0, endingWithinYear: 0 });

  const portfolioRows = [...new Map(portfolios.map((portfolio) => [portfolio, { id: portfolio, label: portfolio, value: filtered.filter((record) => record.portfolio === portfolio).length }])).values()].filter((row) => row.value).sort((a, b) => b.value - a.value).slice(0, 10);
  const partyRows = [...new Set(filtered.map((record) => record.party))].map((party) => {
    const matches = filtered.filter((record) => record.party === party);
    return { id: party, label: party, value: matches.reduce((sum, record) => sum + Number(record.liveAward?.awardAmountDollars || record.obligatedAmount || 0), 0), helper: `${matches.length} record${matches.length === 1 ? "" : "s"}` };
  }).filter((row) => row.value).sort((a, b) => b.value - a.value).slice(0, 10);
  const yearRows = Array.from({ length: timelineEndYear - timelineStartYear + 1 }, (_value, index) => timelineStartYear + index).map((year) => ({
    id: year,
    label: String(year),
    value: filtered.filter((record) => recordDates(record).length && firstDate(record) <= `${year}-12-31` && finalDate(record) >= `${year}-01-01`).length,
  }));
  const evidenceRows = evidenceTiers.map((tier) => ({ id: tier, label: label(tier), value: filtered.filter((record) => record.evidenceTier === tier).length })).filter((row) => row.value).sort((a, b) => b.value - a.value);
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
  const officeRows = offices.map((office) => {
    const matches = filtered.filter((record) => [record.contractingOffice, record.fundingOffice, record.owner].includes(office));
    return { id: office, label: office, value: matches.reduce((sum, record) => sum + recordObligations(record), 0), helper: `${matches.length} linked row${matches.length === 1 ? "" : "s"}` };
  }).filter((row) => row.value).sort((left, right) => right.value - left.value).slice(0, 10);
  const durationBuckets = [
    { id: "under-1", label: "Under 1 year", minimum: 0, maximum: 366 },
    { id: "1-2", label: "1–2 years", minimum: 366, maximum: 731 },
    { id: "2-4", label: "2–4 years", minimum: 731, maximum: 1462 },
    { id: "4-plus", label: "4+ years", minimum: 1462, maximum: Infinity },
  ].map((bucket) => ({ ...bucket, value: filtered.filter((record) => {
    const duration = dateDiffDays(record.start, record.currentEnd);
    return duration != null && duration >= bucket.minimum && duration < bucket.maximum;
  }).length })).filter((row) => row.value);
  const headroomRows = filtered.map((record) => ({
    id: record.opportunityId,
    label: `${record.id} · ${record.title}`,
    obligated: recordObligations(record),
    potential: Number(record.potentialAmount || record.valueHigh || 0),
  })).filter((row) => row.potential > 0).sort((left, right) => right.potential - left.potential).slice(0, 10);
  const snapshotDate = new Date(`${asOf}T00:00:00Z`);
  const startQuarter = Math.floor(snapshotDate.getUTCMonth() / 3);
  const quarterRows = Array.from({ length: 8 }, (_value, index) => {
    const absoluteQuarter = startQuarter + index;
    const year = snapshotDate.getUTCFullYear() + Math.floor(absoluteQuarter / 4);
    const quarter = absoluteQuarter % 4;
    const start = `${year}-${String(quarter * 3 + 1).padStart(2, "0")}-01`;
    const next = new Date(Date.UTC(year, quarter * 3 + 3, 1));
    const end = new Date(next.getTime() - 86_400_000).toISOString().slice(0, 10);
    const endingRecords = filtered.filter((record) => record.currentEnd && record.currentEnd >= start && record.currentEnd <= end);
    const milestoneCount = filtered.reduce((sum, record) => sum + record.milestones.filter((milestone) => milestone.start >= start && milestone.start <= end).length, 0);
    return { id: `${year}-Q${quarter + 1}`, label: `Q${quarter + 1} ${year}`, ends: endingRecords.length, milestones: milestoneCount, total: endingRecords.length + milestoneCount };
  });
  const matrixPortfolios = portfolioRows.slice(0, 8).map((row) => row.id);
  const activeFilters = Object.entries(filters).filter(([key, value]) => value !== FILTER_DEFAULTS[key]).length;

  function scrollTimelineToToday() {
    if (asOf < `${timelineStartYear}-01-01` || asOf > `${timelineEndYear}-12-31`) return;
    const scroller = document.querySelector("[data-capture-timeline]");
    const inner = scroller?.querySelector(".capture-timeline__inner");
    if (!scroller || !inner) return;
    const labelWidth = window.innerWidth <= 760 ? 244 : 330;
    const plotWidth = Math.max(inner.scrollWidth - labelWidth - 26, 1);
    const target = labelWidth + (positionFor(asOf, timelineStartYear, timelineEndYear) / 100) * plotWidth - scroller.clientWidth / 2;
    scroller.scrollTo({ left: Math.max(target, 0), behavior: "smooth" });
  }

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

      <section className={`capture-filters${filtersExpanded ? " is-expanded" : ""}`} data-capture-filters>
        <div className="capture-filters__heading"><Filter size={17} /><strong>Filter calendar</strong><span>{activeFilters ? `${activeFilters} active` : "All public records"}</span><button type="button" className="capture-filter-toggle" onClick={() => setFiltersExpanded((value) => !value)}>{filtersExpanded ? "Show core filters" : "Show 12 more filters"}</button><button type="button" onClick={() => setFilters(FILTER_DEFAULTS)} disabled={!activeFilters}>Reset</button></div>
        <div className="capture-quickviews" aria-label="Capture calendar quick views">
          <span>Quick views</span>
          <button type="button" onClick={() => setFilters({ ...FILTER_DEFAULTS, capMode: "contract-performance", capHorizon: "active", capFrom: "2025", capTo: "2030" })}>Active terms</button>
          <button type="button" onClick={() => setFilters({ ...FILTER_DEFAULTS, capMode: "contract-performance", capHorizon: "ending12", capFrom: "2026", capTo: "2028" })}>Ending in 12 months</button>
          <button type="button" onClick={() => setFilters({ ...FILTER_DEFAULTS, capMode: "acquisition-window", capFrom: "2026", capTo: "2029" })}>Acquisition horizon</button>
          <button type="button" onClick={() => setFilters({ ...FILTER_DEFAULTS, capActivity: "recent", capSort: "obligations", capFrom: "2025", capTo: "2030" })}>Recent funding movement</button>
          <button type="button" onClick={() => setFilters({ ...FILTER_DEFAULTS, capValidation: "unresolved" })}>Evidence gaps</button>
        </div>
        <label className="capture-filter capture-filter--search"><span>Search</span><i><Search size={15} /><input value={filters.capQuery} onChange={(event) => setFilters({ capQuery: event.target.value })} placeholder="Program, company, reference, buyer" /></i></label>
        <label className="capture-filter"><span>Portfolio</span><select value={filters.capPortfolio} onChange={(event) => setFilters({ capPortfolio: event.target.value })}><option value="all">All portfolios</option>{portfolios.map((portfolio) => <option key={portfolio}>{portfolio}</option>)}</select></label>
        <label className="capture-filter"><span>Record type</span><select value={filters.capMode} onChange={(event) => setFilters({ capMode: event.target.value })}><option value="all">All records</option><option value="contract-performance">Contract performance</option><option value="acquisition-window">Acquisition windows</option></select></label>
        <label className="capture-filter capture-filter--advanced"><span>Evidence</span><select value={filters.capEvidence} onChange={(event) => setFilters({ capEvidence: event.target.value })}><option value="all">All evidence</option>{evidenceTiers.map((tier) => <option key={tier} value={tier}>{label(tier)}</option>)}</select></label>
        <label className="capture-filter capture-filter--advanced"><span>Lifecycle</span><select value={filters.capLifecycle} onChange={(event) => setFilters({ capLifecycle: event.target.value })}><option value="all">All lifecycle states</option>{lifecycleStates.map((status) => <option key={status} value={status}>{label(status)}</option>)}</select></label>
        <label className="capture-filter capture-filter--advanced"><span>Company / sponsor</span><select value={filters.capParty} onChange={(event) => setFilters({ capParty: event.target.value })}><option value="all">All companies and sponsors</option>{parties.map((party) => <option key={party}>{party}</option>)}</select></label>
        <label className="capture-filter capture-filter--advanced"><span>Funding / contracting office</span><select value={filters.capOffice} onChange={(event) => setFilters({ capOffice: event.target.value })}><option value="all">All offices</option>{offices.map((office) => <option key={office}>{office}</option>)}</select></label>
        <label className="capture-filter capture-filter--advanced"><span>Vehicle</span><select value={filters.capVehicle} onChange={(event) => setFilters({ capVehicle: event.target.value })}><option value="all">All published vehicles</option>{vehicles.map((vehicle) => <option key={vehicle}>{vehicle}</option>)}</select></label>
        <label className="capture-filter capture-filter--advanced"><span>Validation</span><select value={filters.capValidation} onChange={(event) => setFilters({ capValidation: event.target.value })}><option value="all">All validation states</option><option value="verified">Verified</option><option value="corrected">Corrected</option><option value="unresolved">Unresolved</option></select></label>
        <label className="capture-filter"><span>Schedule horizon</span><select value={filters.capHorizon} onChange={(event) => setFilters({ capHorizon: event.target.value })}><option value="all">Any schedule posture</option><option value="active">Active reported term</option><option value="ending12">Ending within 12 months</option><option value="ending24">Ending within 24 months</option><option value="upcoming">Future starts / milestones</option><option value="past">All endpoints passed</option><option value="undated">Schedule not published</option></select></label>
        <label className="capture-filter capture-filter--advanced"><span>FPDS activity</span><select value={filters.capActivity} onChange={(event) => setFilters({ capActivity: event.target.value })}><option value="all">Any action posture</option><option value="recent">Action in past 12 months</option><option value="funding">Has funding actions</option><option value="deobligation">Has deobligations</option><option value="no-actions">No exact action history</option></select></label>
        <label className="capture-filter capture-filter--advanced"><span>From year</span><select value={filters.capFrom} onChange={(event) => setFilters({ capFrom: event.target.value })}>{Array.from({ length: 12 }, (_value, index) => 2023 + index).map((year) => <option key={year}>{year}</option>)}</select></label>
        <label className="capture-filter capture-filter--advanced"><span>Through year</span><select value={filters.capTo} onChange={(event) => setFilters({ capTo: event.target.value })}>{Array.from({ length: 12 }, (_value, index) => 2023 + index).map((year) => <option key={year}>{year}</option>)}</select></label>
        <label className="capture-filter capture-filter--advanced"><span>Minimum value</span><select value={filters.capMin} onChange={(event) => setFilters({ capMin: event.target.value })}><option value="all">Any published value</option><option value="1m">$1M+</option><option value="10m">$10M+</option><option value="50m">$50M+</option><option value="100m">$100M+</option><option value="500m">$500M+</option></select></label>
        <label className="capture-filter capture-filter--advanced"><span>Sort</span><select value={filters.capSort} onChange={(event) => setFilters({ capSort: event.target.value })}><option value="soonest">Soonest start / milestone</option><option value="value">Highest potential / value</option><option value="obligations">Highest obligations</option><option value="portfolio">Portfolio</option><option value="company">Company / sponsor</option></select></label>
        <label className="capture-filter capture-filter--advanced"><span>Timeline rows</span><select value={filters.capRows} onChange={(event) => setFilters({ capRows: event.target.value })}><option value="25">25 rows</option><option value="50">50 rows</option><option value="100">100 rows</option><option value="all">All rows</option></select></label>
      </section>

      <section className="capture-metrics" aria-label="Filtered calendar metrics">
        <SummaryMetric label="Matching records" value={filtered.length.toLocaleString()} helper={`${filtered.filter((record) => record.mode === "contract-performance").length} contracts · ${filtered.filter((record) => record.mode === "acquisition-window").length} acquisition rows`} />
        <SummaryMetric label="Observed obligations" value={formatMoney(totals.obligated)} helper={`${totals.matched} refreshed award-bundle matches`} tone="green" />
        <SummaryMetric label="Potential / high value" value={formatMoney(totals.potential)} helper="Reported potential values and published ranges" tone="purple" />
        <SummaryMetric label="Evidence coverage" value={`${Math.round((totals.sourced / Math.max(filtered.length, 1)) * 100)}%`} helper={`${totals.sourced} rows with external sources`} tone="orange" />
        <SummaryMetric label="FPDS actions" value={totals.actions.toLocaleString()} helper={`${totals.fundingActions.toLocaleString()} funding · ${totals.deobligationActions.toLocaleString()} deobligation`} tone="green" />
        <SummaryMetric label="Near-term endpoints" value={totals.endingWithinYear.toLocaleString()} helper={`Reported current ends within 12 months of ${formatDate(asOf)}`} tone="orange" />
      </section>

      <DetailPanel record={selected} liveAward={selectedLiveAward} actions={selectedActions} actionState={resolvedActionState} onRetryActions={() => { setActionState("idle"); setActionDataset(null); setActionLoadAttempt((value) => value + 1); }} onClose={() => setSelectedId("")} />

      <section className="capture-section">
        <div className="capture-section__heading capture-gantt-heading"><div><CalendarClock size={18} /><span><strong>Performance and acquisition Gantt</strong><small>{visible.length.toLocaleString()} of {filtered.length.toLocaleString()} filtered rows · exact daily geometry with quarterly guides</small></span></div><span className="capture-legend"><i className="base" />Reported term<i className="potential" />Potential<i className="window" />Published window<i className="milestone" />Milestone</span></div>
        <div className="capture-gantt-tools" data-capture-gantt-tools>
          <button type="button" onClick={scrollTimelineToToday} disabled={asOf < `${timelineStartYear}-01-01` || asOf > `${timelineEndYear}-12-31`}>Center on {monthYear(asOf)}</button>
          <label><span>Row density</span><select value={filters.capDensity} onChange={(event) => setFilters({ capDensity: event.target.value })}><option value="comfortable">Comfortable</option><option value="compact">Compact</option></select></label>
          <label><span>Grouping</span><select value={filters.capGroup} onChange={(event) => setFilters({ capGroup: event.target.value })}><option value="none">No grouping</option><option value="portfolio">Portfolio groups</option></select></label>
          <label><span>Bar labels</span><select value={filters.capLabels} onChange={(event) => setFilters({ capLabels: event.target.value })}><option value="dates">Date ranges</option><option value="money">Observed money</option><option value="none">No labels</option></select></label>
        </div>
        {visible.length ? <CaptureTimeline records={visible} startYear={timelineStartYear} endYear={timelineEndYear} selectedId={selectedId} onSelect={setSelectedId} asOf={asOf} density={filters.capDensity} groupBy={filters.capGroup} labelMode={filters.capLabels} /> : <p className="capture-empty">No public records match these filters.</p>}
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
        <section className="capture-section"><div className="capture-section__heading"><div><CalendarClock size={18} /><span><strong>Eight-quarter decision outlook</strong><small>Reported current ends and published acquisition milestones</small></span></div></div><QuarterOutlook rows={quarterRows} /></section>
        <section className="capture-section"><div className="capture-section__heading"><div><BarChart3 size={18} /><span><strong>Obligation versus reported headroom</strong><small>Largest filtered potential values; values are not additive pipeline</small></span></div></div>{headroomRows.length ? <StackedMoneyList rows={headroomRows} /> : <p className="capture-empty">No comparable obligation and potential values match these filters.</p>}</section>
        <section className="capture-section"><div className="capture-section__heading"><div><BarChart3 size={18} /><span><strong>Buying office exposure</strong><small>Observed obligations by recorded funding or contracting office</small></span></div></div>{officeRows.length ? <BarList rows={officeRows} format={formatMoney} testId="office-money" /> : <p className="capture-empty">No office-linked obligations match these filters.</p>}</section>
        <section className="capture-section"><div className="capture-section__heading"><div><CalendarClock size={18} /><span><strong>Reported term duration</strong><small>Current performance periods at contract grain</small></span></div></div>{durationBuckets.length ? <BarList rows={durationBuckets} testId="duration" /> : <p className="capture-empty">No reported contract durations match these filters.</p>}</section>
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
