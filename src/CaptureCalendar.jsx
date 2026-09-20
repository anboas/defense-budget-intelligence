import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  BarChart3,
  Bookmark,
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Copy,
  Download,
  ExternalLink,
  Filter,
  GitCompareArrows,
  Network,
  Search,
  ShieldCheck,
  Star,
  Trash2,
  X,
} from "lucide-react";
import {
  assembleProcurementRecords,
  applyProcurementChanges,
  INGESTION_METHOD_BY_ID,
  INGESTION_METHOD_OPTIONS,
  TECHNOLOGY_AREA_BY_ID,
  TECHNOLOGY_AREA_OPTIONS,
  WORK_CATEGORY_BY_ID,
  WORK_CATEGORY_OPTIONS,
} from "./procurement-taxonomy.js";
import { useManagementState } from "./management-state.js";
import { useRecordDispositions } from "./record-dispositions.js";
import { emptyProcurementDiscovery, loadProcurementDiscovery } from "./procurement-discovery.js";
import OperationalDataTable from "./OperationalDataTable.jsx";
import ControlSelect from "./ControlSelect.jsx";
import { ControlAsyncState, ControlDialog, ControlDisclosure, ControlDrawer, ControlFactGrid, ControlRecordHeader, ControlStatusBadge } from "control-surface-ui/react";
import SearchMultiSelect, { parseMultiValues, serializeMultiValues } from "./SearchMultiSelect.jsx";
import ControlWorkbenchHeader from "./WorkbenchHeader.jsx";

const COMPARISON_STORAGE_KEY = "dbi:capture-comparison:v1";
const SAVED_VIEWS_STORAGE_KEY = "dbi:capture-saved-views:v1";

function CaptureEmpty({ title, message }) {
  return <ControlAsyncState compact state="empty" title={title} message={message} />;
}

function useMediaQuery(query) {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);

  useEffect(() => {
    const media = window.matchMedia(query);
    const update = () => setMatches(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, [query]);

  return matches;
}

const FILTER_DEFAULTS = {
  capQuery: "",
  capPortfolio: "all",
  capMode: "all",
  capEvidence: "all",
  capLifecycle: "all",
  capParty: "all",
  capOffice: "all",
  capVehicle: "all",
  capWork: "all",
  capTech: "all",
  capOrgBranch: "all",
  capOrgComponent: "all",
  capOrgOffice: "all",
  capOrigin: "all",
  capChange: "all",
  capValidation: "all",
  capHorizon: "all",
  capActivity: "all",
  capSubaward: "all",
  capTracked: "all",
  capFrom: "2023",
  capTo: "2034",
  capMin: "all",
  capSort: "soonest",
  capRows: "50",
  capDensity: "comfortable",
  capGroup: "none",
  capLabels: "dates",
  capFields: "party,reference,value",
  capFeed: "none",
};

const MULTI_FILTER_KEYS = ["capPortfolio", "capEvidence", "capLifecycle", "capParty", "capOffice", "capVehicle", "capWork", "capTech", "capOrgBranch", "capOrgComponent", "capOrgOffice", "capOrigin"];

const GROUP_BY_OPTIONS = [
  ["none", "No grouping"],
  ["portfolio", "Portfolio"],
  ["lifecycle", "Lifecycle state"],
  ["mode", "Record type"],
  ["party", "Company / sponsor"],
  ["funding-office", "Funding office"],
  ["contracting-office", "Contracting office"],
  ["vehicle", "Vehicle / parent"],
  ["evidence", "Evidence tier"],
  ["end-year", "Reported end year"],
  ["work-category", "Work category"],
  ["ingestion-source", "Ingestion provenance"],
  ["change-status", "Changed since refresh"],
  ["subaward-posture", "Subaward posture"],
];

const ROW_FIELD_OPTIONS = [
  ["party", "Company / sponsor"],
  ["reference", "Award / notice reference"],
  ["value", "Potential / high value"],
  ["obligations", "Observed obligations"],
  ["funding-office", "Funding office"],
  ["contracting-office", "Contracting office"],
  ["vehicle", "Vehicle / parent"],
  ["actions", "FPDS action count"],
  ["last-action", "Latest FPDS action"],
  ["evidence", "Evidence tier"],
  ["work-category", "Work category"],
  ["codes", "PSC / NAICS"],
  ["ingestion-source", "Ingestion provenance"],
  ["change-status", "Change status"],
  ["subawards", "Subaward count / value"],
];

const GROUP_BY_IDS = new Set(GROUP_BY_OPTIONS.map(([id]) => id));
const ROW_FIELD_IDS = new Set(ROW_FIELD_OPTIONS.map(([id]) => id));
const MAX_ROW_FIELDS = 4;
const BAR_LABEL_IDS = new Set(["dates", "obligations", "potential", "utilization", "actions", "none"]);
const FEED_OPTIONS = [
  ["fpds", "FPDS action pulses"],
  ["fiscal", "FPDS annual obligations"],
  ["awards", "USAspending refreshed end"],
  ["followon", "Published follow-on activity"],
  ["competition", "Competition / set-aside"],
  ["vehicle", "Contract vehicle"],
  ["structure", "Award / pricing type"],
  ["work", "Type of work"],
  ["provenance", "Ingestion provenance"],
  ["changes", "Changed since refresh"],
  ["subawards", "USAspending subaward actions"],
];
const FEED_IDS = new Set(FEED_OPTIONS.map(([id]) => id));

function normalizeMultiValue(value, options, emptyValue = "all") {
  const available = new Set(options);
  return serializeMultiValues(parseMultiValues(value).filter((item) => available.has(item)), emptyValue);
}

function multiValueMatches(value, candidate) {
  const selected = parseMultiValues(value);
  return !selected.length || selected.includes(candidate);
}

function normalizeFieldIds(value) {
  if (value === "none") return "none";
  const fields = [...new Set(String(value || "").split(",").filter((field) => ROW_FIELD_IDS.has(field)))];
  return fields.length ? fields.slice(0, MAX_ROW_FIELDS).join(",") : FILTER_DEFAULTS.capFields;
}

function selectedFieldIds(value) {
  const normalized = normalizeFieldIds(value);
  return normalized === "none" ? [] : normalized.split(",");
}

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
  "official-record": "Official public record",
  automated: "Automated",
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
  return [record.solicitationStart, record.solicitationEnd, ...record.milestones.flatMap((milestone) => [milestone.start, milestone.end])].filter(Boolean);
}

function firstDate(record) {
  return [...recordDates(record)].sort()[0] || "9999-12-31";
}

function finalDate(record) {
  return [...recordDates(record)].sort().at(-1) || "0000-01-01";
}

function relevantDate(record, asOf) {
  const future = recordDates(record).filter((date) => date >= asOf).sort();
  return future[0] || finalDate(record);
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
  if (!new Set(["soonest", "added", "technology", "organization", "value", "obligations", "portfolio", "company"]).has(parsed.capSort)) parsed.capSort = FILTER_DEFAULTS.capSort;
  if (!new Set(["all", "verified", "corrected", "unresolved"]).has(parsed.capValidation)) parsed.capValidation = FILTER_DEFAULTS.capValidation;
  if (!new Set(["all", "active", "ending12", "ending24", "upcoming", "past", "undated"]).has(parsed.capHorizon)) parsed.capHorizon = FILTER_DEFAULTS.capHorizon;
  if (!new Set(["all", "funding", "deobligation", "recent", "no-actions"]).has(parsed.capActivity)) parsed.capActivity = FILTER_DEFAULTS.capActivity;
  if (!new Set(["all", "has", "recent", "none"]).has(parsed.capSubaward)) parsed.capSubaward = FILTER_DEFAULTS.capSubaward;
  if (!new Set(["all", "tracked"]).has(parsed.capTracked)) parsed.capTracked = FILTER_DEFAULTS.capTracked;
  if (!new Set(["all", "added", "updated", "unchanged"]).has(parsed.capChange)) parsed.capChange = FILTER_DEFAULTS.capChange;
  if (!new Set(["comfortable", "compact"]).has(parsed.capDensity)) parsed.capDensity = FILTER_DEFAULTS.capDensity;
  if (!GROUP_BY_IDS.has(parsed.capGroup)) parsed.capGroup = FILTER_DEFAULTS.capGroup;
  if (!BAR_LABEL_IDS.has(parsed.capLabels)) parsed.capLabels = FILTER_DEFAULTS.capLabels;
  parsed.capFields = normalizeFieldIds(parsed.capFields);
  parsed.capFeed = normalizeMultiValue(parsed.capFeed, FEED_IDS, "none");
  return parsed;
}

function useCaptureFilters() {
  const [filters, setFiltersState] = useState(parseHashFilters);
  useEffect(() => {
    const sync = () => setFiltersState(parseHashFilters());
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);

  useEffect(() => {
    const [route] = window.location.hash.split("?");
    const params = new URLSearchParams(window.location.hash.split("?")[1] || "");
    let changed = params.has("capView");
    params.delete("capView");
    for (const [key, value] of Object.entries(filters)) {
      const canonical = value === FILTER_DEFAULTS[key] || !value ? null : value;
      if (params.get(key) === canonical) continue;
      if (canonical === null) params.delete(key);
      else params.set(key, canonical);
      changed = true;
    }
    if (!changed) return;
    const query = params.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}${route}${query ? `?${query}` : ""}`);
  }, [filters]);

  function setFilters(next) {
    setFiltersState((current) => {
      const resolved = typeof next === "function" ? next(current) : { ...current, ...next };
      const [route] = window.location.hash.split("?");
      const params = new URLSearchParams(window.location.hash.split("?")[1] || "");
      params.delete("capView");
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
  const fields = ["snapshotAsOf", "viewUrl", "opportunityId", "ganttAlias", "portfolio", "mode", "title", "party", "reference", "parentReference", "parentReferenceBasis", "context", "fundingOffice", "contractingOffice", "vehicle", "awardType", "pricingType", "competitionType", "setAside", "eligibility", "workCategory", "workCategories", "workCategoryBasis", "workCategoryConfidence", "pscCode", "pscDescription", "naicsCode", "naicsDescription", "ingestionMethod", "ingestionLabel", "ingestionChannels", "sourceSystem", "automatedImport", "solicitationStart", "solicitationEnd", "noticeType", "lifecycleStatus", "evidenceTier", "validationStatus", "validationCheckedAt", "start", "currentEnd", "potentialEnd", "obligatedAmount", "potentialAmount", "fpdsObligatedAmount", "fpdsPotentialAmount", "reportedSubawardCount", "reportedSubawardAmount", "latestSubawardAction", "subawardDetailStatus", "sourceRoleCount", "normalizedEventCount", "fpdsActionCount", "fundingActionCount", "deobligationActionCount", "lastFpdsAction", "primarySourceUrl", "fpdsSourceUrl"];
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
    parentReferenceBasis: record.parentReferenceBasis,
    context: record.context,
    fundingOffice: record.fundingOffice,
    contractingOffice: record.contractingOffice,
    vehicle: record.vehicle,
    awardType: record.awardType,
    pricingType: record.pricingType,
    competitionType: record.competitionType,
    setAside: record.setAside,
    eligibility: record.eligibility,
    workCategory: WORK_CATEGORY_BY_ID.get(record.workCategory)?.label || label(record.workCategory),
    workCategories: (record.workCategories || []).map((category) => WORK_CATEGORY_BY_ID.get(category)?.label || label(category)).join(" | "),
    workCategoryBasis: record.workCategoryBasis,
    workCategoryConfidence: record.workCategoryConfidence,
    pscCode: record.pscCode,
    pscDescription: record.pscDescription,
    naicsCode: record.naicsCode,
    naicsDescription: record.naicsDescription,
    ingestionMethod: record.ingestionMethod,
    ingestionLabel: record.ingestionLabel,
    ingestionChannels: (record.ingestionChannels || []).map((channel) => channel.label).join(" | "),
    sourceSystem: record.sourceSystem,
    automatedImport: record.automatedImport,
    changeStatus: record.changeStatus,
    changeSourceSystem: record.changeSourceSystem,
    solicitationStart: record.solicitationStart,
    solicitationEnd: record.solicitationEnd,
    noticeType: record.noticeType,
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
    reportedSubawardCount: record.subawardSummary?.reportedCount || 0,
    sampledSubawardAmount: record.subawardSummary?.sampledAmount || 0,
    latestSubawardAction: record.subawardSummary?.latestActionDate || "",
    subawardDetailStatus: record.subawardSummary?.status || "not-reported",
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
  anchor.download = "award-transactions-filtered.csv";
  anchor.click();
  URL.revokeObjectURL(url);
}

function copyLink() {
  navigator.clipboard?.writeText(window.location.href);
}

function readStoredArray(key) {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(key) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function normalizeSavedFilters(candidate) {
  const filters = { ...FILTER_DEFAULTS };
  if (!candidate || typeof candidate !== "object") return filters;
  for (const key of Object.keys(FILTER_DEFAULTS)) {
    if (typeof candidate[key] === "string") filters[key] = candidate[key];
  }
  const years = new Set(Array.from({ length: 12 }, (_value, index) => String(2023 + index)));
  if (!years.has(filters.capFrom)) filters.capFrom = FILTER_DEFAULTS.capFrom;
  if (!years.has(filters.capTo)) filters.capTo = FILTER_DEFAULTS.capTo;
  if (!new Set(["25", "50", "100", "all"]).has(filters.capRows)) filters.capRows = FILTER_DEFAULTS.capRows;
  if (!(filters.capMin in MINIMUM_VALUES)) filters.capMin = FILTER_DEFAULTS.capMin;
  if (!new Set(["all", "contract-performance", "acquisition-window"]).has(filters.capMode)) filters.capMode = FILTER_DEFAULTS.capMode;
  if (!new Set(["soonest", "added", "technology", "organization", "value", "obligations", "portfolio", "company"]).has(filters.capSort)) filters.capSort = FILTER_DEFAULTS.capSort;
  if (!new Set(["all", "verified", "corrected", "unresolved"]).has(filters.capValidation)) filters.capValidation = FILTER_DEFAULTS.capValidation;
  if (!new Set(["all", "active", "ending12", "ending24", "upcoming", "past", "undated"]).has(filters.capHorizon)) filters.capHorizon = FILTER_DEFAULTS.capHorizon;
  if (!new Set(["all", "funding", "deobligation", "recent", "no-actions"]).has(filters.capActivity)) filters.capActivity = FILTER_DEFAULTS.capActivity;
  if (!new Set(["all", "tracked"]).has(filters.capTracked)) filters.capTracked = FILTER_DEFAULTS.capTracked;
  if (!new Set(["all", "added", "updated", "unchanged"]).has(filters.capChange)) filters.capChange = FILTER_DEFAULTS.capChange;
  if (!new Set(["comfortable", "compact"]).has(filters.capDensity)) filters.capDensity = FILTER_DEFAULTS.capDensity;
  if (!GROUP_BY_IDS.has(filters.capGroup)) filters.capGroup = FILTER_DEFAULTS.capGroup;
  if (!BAR_LABEL_IDS.has(filters.capLabels)) filters.capLabels = FILTER_DEFAULTS.capLabels;
  filters.capFields = normalizeFieldIds(filters.capFields);
  filters.capFeed = normalizeMultiValue(filters.capFeed, FEED_IDS, "none");
  return filters;
}

function BarList({ rows, valueKey = "value", format = (value) => value.toLocaleString(), testId, onSelect, selectedId }) {
  const maximum = Math.max(...rows.map((row) => Number(row[valueKey] || 0)), 1);
  const selectedIds = Array.isArray(selectedId) ? selectedId : parseMultiValues(selectedId);
  return (
    <div className="capture-bars" data-capture-chart={testId}>
      {rows.map((row) => {
        const Element = onSelect ? "button" : "article";
        return (
          <Element key={row.id || row.label} type={onSelect ? "button" : undefined} className={`capture-bar-row${selectedIds.includes(String(row.id)) ? " is-selected" : ""}`} onClick={onSelect ? () => onSelect(row) : undefined}>
            <div><strong>{row.label}</strong><span>{format(row[valueKey])}</span></div>
            <i aria-hidden="true"><b style={{ width: `${Math.max((Number(row[valueKey] || 0) / maximum) * 100, 1)}%` }} /></i>
            {row.helper ? <small>{row.helper}</small> : null}
          </Element>
        );
      })}
    </div>
  );
}

function StackedMoneyList({ rows, onSelect }) {
  return (
    <div className="capture-money-stack" data-capture-chart="obligation-headroom">
      {rows.map((row) => {
        const total = Math.max(row.potential, row.obligated, 1);
        const obligatedWidth = Math.min((row.obligated / total) * 100, 100);
        const remaining = Math.max(row.potential - row.obligated, 0);
        return (
          <button key={row.id} type="button" className={onSelect ? "is-interactive" : ""} onClick={onSelect ? () => onSelect(row) : undefined}>
            <div><strong>{row.label}</strong><span>{Math.round(obligatedWidth)}% obligated</span></div>
            <i aria-label={`${formatMoney(row.obligated)} obligated of ${formatMoney(row.potential)} potential`}>
              <b style={{ width: `${obligatedWidth}%` }} />
              <em style={{ width: `${100 - obligatedWidth}%` }} />
            </i>
            <small>{formatMoney(row.obligated)} obligated · {formatMoney(remaining)} reported headroom</small>
          </button>
        );
      })}
    </div>
  );
}

function QuarterOutlook({ rows, onSelect }) {
  const maximum = Math.max(...rows.map((row) => row.total), 1);
  return (
    <div className="capture-quarter-outlook" data-capture-chart="quarter-outlook">
      {rows.map((row) => (
        <button type="button" key={row.id} style={{ "--capture-quarter-intensity": row.total / maximum }} onClick={() => onSelect?.(row)}>
          <strong>{row.label}</strong>
          <span>{row.total}</span>
          <small>{row.ends} end{row.ends === 1 ? "" : "s"} · {row.milestones} milestone{row.milestones === 1 ? "" : "s"}</small>
        </button>
      ))}
    </div>
  );
}

function SingleSelectFilter({ className = "", title, value, options, onChange, ariaLabel = title, searchable }) {
  return <div className={`capture-filter ${className}`.trim()}><span>{title}</span><ControlSelect value={value} options={options} onChange={onChange} ariaLabel={ariaLabel} searchable={searchable} /></div>;
}

function signedMoney(value) {
  const amount = Number(value || 0);
  if (!amount) return "$0";
  return `${amount > 0 ? "+" : "−"}${formatMoney(Math.abs(amount))}`;
}

function ActionTrend({ actions }) {
  const points = actions
    .filter((action) => !action.supportingInstrument && action.signed && action.obligationsTotal != null)
    .sort((left, right) => left.signed.localeCompare(right.signed) || left.actionId.localeCompare(right.actionId));
  if (points.length < 2) return <CaptureEmpty title="No cumulative series" message="Primary-award history is unavailable for the current selection." />;
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
  if (!record.transactionSummary?.actions) return null;
  if (state === "loading") return <section className="capture-action-history" data-capture-actions-loading role="status">Loading exact FPDS action history…</section>;
  if (state === "error") return <section className="capture-action-history" role="alert">Action history could not be loaded. <button type="button" onClick={onRetry}>Retry</button></section>;
  const columns = [
    { key: "signed", label: "Signed", required: true, sticky: true, minWidth: 110, value: (action) => action.signed, render: (action) => formatDate(action.signed) },
    { key: "piid", label: "PIID / modification", minWidth: 180, value: (action) => action.piid, searchValue: (action) => [action.piid, action.modification, action.transactionNumber], render: (action) => <><strong>{action.piid}</strong><small>{action.modification || "Base"} · txn {action.transactionNumber || "0"}{action.supportingInstrument ? " · supporting" : ""}</small></> },
    { key: "direction", label: "Action", facet: true, minWidth: 110, value: (action) => label(action.direction), render: (action) => <span className={`capture-action-direction capture-action-direction--${action.direction}`}>{label(action.direction)}</span> },
    { key: "delta", label: "Obligation change", sortValue: (action) => Number(action.obligationDelta || 0), exportValue: (action) => action.obligationDelta, render: (action) => <span className={action.obligationDelta < 0 ? "is-negative" : action.obligationDelta > 0 ? "is-positive" : ""}>{signedMoney(action.obligationDelta)}</span> },
    { key: "cumulative", label: "Cumulative obligations", sortValue: (action) => Number(action.obligationsTotal || 0), exportValue: (action) => action.obligationsTotal, render: (action) => formatMoney(action.obligationsTotal) },
    { key: "end", label: "Reported end", value: (action) => action.currentEnd || "Not published", render: (action) => formatDate(action.currentEnd) },
    { key: "description", label: "Description", role: "prose", minWidth: 260, value: (action) => action.description || "Not published" },
  ];
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
      <OperationalDataTable id={`fpds-actions-${record.opportunityId}`} label={`FPDS actions for ${record.title}`} rows={actions} columns={columns} rowKey={(action) => action.actionId} defaultSort={{ key: "signed", direction: "desc" }} defaultPageSize={10} pageSizeOptions={[5, 10, 25, 50]} searchPlaceholder="Search PIID, modification, action, or description…" exportFilename={`fpds-actions-${record.id}.csv`} selectable={false} wrapperProps={{ "data-capture-action-table": true }} />
      <small className="capture-action-history__limit">The chart and table use every exact primary-award action. Supporting-instrument actions remain explicitly labeled.</small>
    </section>
  );
}

function DetailPanel({ record, liveAward, actions, actionState, onRetryActions, parentRelations, vehicleRelations, followOnRelations, onSelectRelated }) {
  if (!record) return null;
  const observed = Number(liveAward?.awardAmountDollars || record.obligatedAmount || 0);
  const potential = Number(record.potentialAmount || record.valueHigh || 0);
  const utilization = potential ? Math.min((observed / potential) * 100, 100) : null;
  const durationDays = dateDiffDays(record.start, record.currentEnd);
  const primaryFacts = [
    { label: "Company / sponsor", value: liveAward?.recipient || record.party, meta: liveAward ? "Current award analytics match" : "Source record", wide: true },
    { label: "Reference", value: record.reference || "Not published", meta: record.context },
    { label: "Reported term", value: `${compactDate(record.start)} to ${compactDate(record.currentEnd)}`, meta: `Potential through ${compactDate(record.potentialEnd)}` },
    { label: "USAspending money", value: formatMoney(observed), meta: `Potential / high ${formatMoney(potential)}` },
    { label: "Obligation posture", value: utilization == null ? "Not calculable" : `${Math.round(utilization)}% of potential`, meta: potential ? `${formatMoney(Math.max(potential - observed, 0))} reported headroom` : "No potential value published" },
    { label: "Type of work", value: WORK_CATEGORY_BY_ID.get(record.workCategory)?.label || "Other / unclassified", meta: (record.workCategories || []).slice(1).map((category) => WORK_CATEGORY_BY_ID.get(category)?.label || label(category)).join(" · ") || record.workCategoryConfidence || "No secondary category", wide: true },
  ];
  const secondaryFacts = [
    { label: "Technology areas", value: (record.technologyAreas || []).map((area) => TECHNOLOGY_AREA_BY_ID.get(area)?.label || area).join(" · ") || "Not classified", meta: "Deterministic published-record classification", wide: true },
    { label: "DoW hierarchy", value: record.organization?.path?.slice(0, 3).join(" → ") || "Not published", meta: record.organization?.office || "Office not published", wide: true },
    { label: "FPDS public action sum", value: formatMoney(record.fpdsObligatedAmount), meta: `Potential ${formatMoney(record.fpdsPotentialAmount)}` },
    { label: "USAspending subawards", value: record.subawardSummary?.reportedCount ? `${record.subawardSummary.reportedCount.toLocaleString()} reported` : "None reported", meta: record.subawardSummary?.latestActionDate ? `${formatMoney(record.subawardSummary.sampledAmount)} in retained detail · latest ${formatDate(record.subawardSummary.latestActionDate)}` : "Exact prime-award join" },
    { label: "Reported duration", value: durationDays == null ? "Not published" : `${Math.max(Math.round(durationDays / 30.44), 1)} months`, meta: label(record.lifecycleStatus) },
    { label: "Funding office", value: record.fundingOffice || record.owner || "Not published", meta: "Distinct from contracting office" },
    { label: "Contracting office", value: record.contractingOffice || "Not published", meta: record.vehicle || "Vehicle not identified" },
    record.solicitationStart ? { label: "Solicitation window", value: `${formatDate(record.solicitationStart)} to ${formatDate(record.solicitationEnd)}`, meta: record.noticeType || "Published solicitation" } : null,
    record.competitionType || record.setAside || record.eligibility ? { label: "Competition / eligibility", value: record.competitionType || "Competition not published", meta: [record.setAside, record.eligibility].filter(Boolean).join(" · ") || "Set-aside / eligibility not published" } : null,
    record.vehicle ? { label: "Contract vehicle", value: record.vehicle, meta: record.parentReference ? `Parent / predecessor ${record.parentReference}` : "Published vehicle classification" } : null,
    record.awardType || record.pricingType ? { label: "Award / pricing structure", value: record.pricingType || "Pricing not published", meta: record.awardType || "Award instrument type not published" } : null,
    { label: "PSC / NAICS", value: record.pscCode ? `PSC ${record.pscCode}` : "PSC not published", meta: record.naicsCode ? `NAICS ${record.naicsCode}` : "NAICS not published" },
    { label: "Ingestion provenance", value: record.ingestionLabel || "Not published", meta: (record.ingestionChannels || []).map((channel) => channel.label).join(" · ") || record.sourceSystem || "No ingestion channel recorded" },
    { label: "Latest refresh comparison", value: record.changeStatus === "unchanged" ? "No detected change" : label(record.changeStatus), meta: record.changeSourceSystem || "Current baseline or unchanged public record" },
    { label: "Date added to DBI", value: record.firstSeenAt ? formatDate(record.firstSeenAt.slice(0, 10)) : "Not recorded", meta: record.sourcePublishedAt ? `Source published ${formatDate(String(record.sourcePublishedAt).slice(0, 10))}` : "Source publication date not available" },
    { label: "Source posture", value: `${record.sourceRoleCount} source role${record.sourceRoleCount === 1 ? "" : "s"}`, meta: `${label(record.validationStatus)} · checked ${formatDate(record.validationCheckedAt?.slice(0, 10))}` },
  ].filter(Boolean);
  return (
    <aside className="capture-detail" data-capture-detail aria-label={`${record.title} evidence details`}>
      <ControlFactGrid label="Primary transaction facts" mobileTwoColumn items={primaryFacts} data-capture-primary-facts />
      <ControlDisclosure className="capture-detail__secondary" title="Procurement and provenance details" summary={`${secondaryFacts.length} published fields · offices, competition, instrument, coding, and source posture`}>
        <ControlFactGrid label="Procurement and provenance facts" mobileTwoColumn items={secondaryFacts} data-capture-secondary-facts />
      </ControlDisclosure>
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
      {(parentRelations.length || vehicleRelations.length || followOnRelations.length) ? (
        <div className="capture-detail__relations" data-capture-relations>
          <h3>Published instrument relationships</h3>
          {followOnRelations.length ? <section data-followon-relations><strong>Published follow-on activity</strong><small>Exact PIID links and explicitly labeled curated program crosswalks are distinguished in the activity modal. The activity date is published evidence, not a win or recompete prediction.</small>{followOnRelations.map((related) => <button type="button" key={related.opportunityId} onClick={() => onSelectRelated(related.opportunityId)}><b>{related.id}</b><span>{related.title}</span><em>{related.sourceSystem}</em></button>)}</section> : null}
          {parentRelations.length ? <section><strong>Same parent award / IDV</strong><small>Exact published parent reference: {record.parentReference}</small>{parentRelations.map((related) => <button type="button" key={related.opportunityId} onClick={() => onSelectRelated(related.opportunityId)}><b>{related.id}</b><span>{related.title}</span><em>{formatMoney(recordObligations(related))}</em></button>)}</section> : null}
          {vehicleRelations.length ? <section><strong>Same published vehicle label</strong><small>{record.vehicle}; this is a route relationship, not proof of the same contract family.</small>{vehicleRelations.map((related) => <button type="button" key={related.opportunityId} onClick={() => onSelectRelated(related.opportunityId)}><b>{related.id}</b><span>{related.title}</span><em>{formatMoney(recordObligations(related))}</em></button>)}</section> : null}
        </div>
      ) : null}
      {record.subawardSummary?.reportedCount ? (
        <div className="capture-detail__subawards" data-capture-subawards>
          <h3>USAspending subaward activity</h3>
          <p>{record.subawardSummary.reportedCount.toLocaleString()} reported subawards are linked by exact USAspending generated prime-award ID. The retained {record.subawardSummary.sampledCount.toLocaleString()} recent detail rows total {formatMoney(record.subawardSummary.sampledAmount)}. {record.subawardSummary.detailTruncated ? "This sampled amount is not the complete subaward total." : "The retained detail covers the current reported rows."}</p>
          <div>{(record.subawards || []).slice(0, 12).map((subaward) => <article key={subaward.subawardId}><span><b>{subaward.recipientName}</b><small>{subaward.subawardNumber || subaward.subawardId}</small></span><strong>{formatMoney(subaward.amount)}</strong><time>{formatDate(subaward.actionDate)}</time><p>{subaward.description || "Description not published"}</p></article>)}</div>
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

function ComparisonTray({ records, startYear, endYear, onOpen, onRemove, onClear }) {
  if (!records.length) return null;
  return (
    <section className="capture-compare" data-capture-compare>
      <div className="capture-compare__heading"><div><GitCompareArrows size={18} /><span><strong>Comparison tray</strong><small>{records.length} of 4 records · browser-local</small></span></div><button type="button" onClick={onClear}>Clear comparison</button></div>
      <div className="capture-compare__grid">
        {records.map((record) => {
          const dates = recordDates(record);
          const start = dates.length ? firstDate(record) : null;
          const end = dates.length ? finalDate(record) : null;
          const left = start ? positionFor(start, startYear, endYear) : 0;
          const right = end ? positionFor(end, startYear, endYear) : left;
          return <article key={record.opportunityId}>
            <div className="capture-compare__card-heading"><button type="button" onClick={() => onOpen(record.opportunityId)}><b>{record.id}</b><span>{record.title}</span></button><button type="button" onClick={() => onRemove(record.opportunityId)} aria-label={`Remove ${record.title} from comparison`}><X size={15} /></button></div>
            <dl><div><dt>Company / sponsor</dt><dd>{record.party}</dd></div><div><dt>Observed obligations</dt><dd>{formatMoney(recordObligations(record))}</dd></div><div><dt>Potential / high</dt><dd>{formatMoney(recordValue(record))}</dd></div><div><dt>Lifecycle</dt><dd>{label(record.lifecycleStatus)}</dd></div><div><dt>Evidence</dt><dd>{label(record.evidenceTier)}</dd></div><div><dt>FPDS actions</dt><dd>{record.transactionSummary?.actions?.toLocaleString() || "None"}</dd></div><div><dt>Subawards</dt><dd>{record.subawardSummary?.reportedCount?.toLocaleString() || "None reported"}</dd></div></dl>
            <div className="capture-compare__track" aria-label={start ? `${formatDate(start)} to ${formatDate(end)}` : "Schedule not published"}>{start ? <i style={{ left: `${left}%`, width: `${Math.max(right - left, 1.2)}%` }} /> : null}</div>
            <small>{start ? `${formatDate(start)} to ${formatDate(end)}` : "Schedule not published"}</small>
          </article>;
        })}
      </div>
    </section>
  );
}

function SavedViews({ views, onLoad, onDelete }) {
  if (!views.length) return null;
  return (
    <details className="capture-saved-views" data-capture-saved-views>
      <summary><Bookmark size={16} /><strong>Saved views</strong><span>{views.length}</span><small>Browser-local</small></summary>
      <div className="capture-saved-views__list">{views.map((view) => <span key={view.id}><button type="button" onClick={() => onLoad(view)}><b>{view.name}</b><small>{view.savedAt && !Number.isNaN(Date.parse(view.savedAt)) ? new Date(view.savedAt).toLocaleString() : "Saved view"}</small></button><button type="button" onClick={() => onDelete(view.id)} aria-label={`Delete saved view ${view.name}`}><Trash2 size={14} /></button></span>)}</div>
    </details>
  );
}

function positionFor(date, startYear, endYear) {
  const start = Date.UTC(startYear, 0, 1);
  const end = Date.UTC(endYear + 1, 0, 1);
  const point = Date.parse(`${date}T00:00:00Z`);
  return Math.max(0, Math.min(100, ((point - start) / (end - start)) * 100));
}

function timelineGroupValue(record, groupBy) {
  if (groupBy === "portfolio") return record.portfolio || "Portfolio not published";
  if (groupBy === "lifecycle") return label(record.lifecycleStatus);
  if (groupBy === "mode") return label(record.mode);
  if (groupBy === "party") return record.party || "Company / sponsor not published";
  if (groupBy === "funding-office") return record.fundingOffice || record.owner || "Funding office not published";
  if (groupBy === "contracting-office") return record.contractingOffice || "Contracting office not published";
  if (groupBy === "vehicle") return record.parentReference || record.vehicle || "Vehicle / parent not published";
  if (groupBy === "evidence") return label(record.evidenceTier);
  if (groupBy === "work-category") return WORK_CATEGORY_BY_ID.get(record.workCategory)?.label || "Other / unclassified";
  if (groupBy === "ingestion-source") return record.ingestionLabel || INGESTION_METHOD_BY_ID.get(record.ingestionMethod)?.label || "Provenance not published";
  if (groupBy === "change-status") return record.changeStatus === "unchanged" ? "Unchanged in latest comparison" : `${label(record.changeStatus)} in latest comparison`;
  if (groupBy === "subaward-posture") return record.subawardSummary?.reportedCount ? "Has reported subawards" : "No reported subawards in current snapshot";
  if (groupBy === "end-year") {
    const reportedEnd = record.currentEnd || (finalDate(record) === "0000-01-01" ? "" : finalDate(record));
    return reportedEnd ? reportedEnd.slice(0, 4) : "End year not published";
  }
  return null;
}

function timelineFieldValue(record, field) {
  if (field === "party") return record.party;
  if (field === "reference") return record.reference || label(record.mode);
  if (field === "value") return `Value ${formatMoney(recordValue(record))}`;
  if (field === "obligations") return `Obligated ${formatMoney(recordObligations(record))}`;
  if (field === "funding-office") return record.fundingOffice || record.owner || "Funding office not published";
  if (field === "contracting-office") return record.contractingOffice || "Contracting office not published";
  if (field === "vehicle") return record.parentReference || record.vehicle || "Vehicle / parent not published";
  if (field === "actions") return `${record.transactionSummary?.actions?.toLocaleString() || 0} FPDS actions`;
  if (field === "last-action") return record.transactionSummary?.lastSigned ? `Last action ${compactDate(record.transactionSummary.lastSigned)}` : "No FPDS actions";
  if (field === "evidence") return label(record.evidenceTier);
  if (field === "work-category") return WORK_CATEGORY_BY_ID.get(record.workCategory)?.label || "Other / unclassified";
  if (field === "codes") return [record.pscCode ? `PSC ${record.pscCode}` : "", record.naicsCode ? `NAICS ${record.naicsCode}` : ""].filter(Boolean).join(" · ") || "PSC / NAICS not published";
  if (field === "ingestion-source") return record.ingestionLabel || INGESTION_METHOD_BY_ID.get(record.ingestionMethod)?.label || "Provenance not published";
  if (field === "change-status") return record.changeStatus === "unchanged" ? "No detected change" : `${label(record.changeStatus)} · ${record.changeSourceSystem}`;
  if (field === "subawards") return record.subawardSummary?.reportedCount ? `${record.subawardSummary.reportedCount.toLocaleString()} subawards · ${formatMoney(record.subawardSummary.sampledAmount)} sampled` : "No reported subawards";
  return null;
}

function timelineBarLabel(record, labelMode, start, end) {
  if (labelMode === "dates") return `${monthYear(start)} → ${monthYear(end)}`;
  if (labelMode === "obligations") return formatMoney(recordObligations(record));
  if (labelMode === "potential") return formatMoney(recordValue(record));
  if (labelMode === "actions") return `${record.transactionSummary?.actions?.toLocaleString() || 0} actions`;
  if (labelMode === "utilization") {
    const potential = recordValue(record);
    return potential ? `${Math.round(Math.min((recordObligations(record) / potential) * 100, 100))}% obligated` : "No ratio";
  }
  return "";
}

function timelineActionMarkers(actions, startYear, endYear) {
  const buckets = new Map();
  for (const action of actions || []) {
    if (!action.signed || action.signed < `${startYear}-01-01` || action.signed > `${endYear}-12-31`) continue;
    const month = action.signed.slice(0, 7);
    const bucket = buckets.get(month) || { month, count: 0, obligationDelta: 0, funding: 0, deobligation: 0, latest: "" };
    bucket.count += 1;
    bucket.obligationDelta += Number(action.obligationDelta || 0);
    bucket.funding += Number(action.direction === "funding");
    bucket.deobligation += Number(action.direction === "deobligation");
    bucket.latest = [bucket.latest, action.signed].sort().at(-1);
    buckets.set(month, bucket);
  }
  return [...buckets.values()].sort((left, right) => left.month.localeCompare(right.month));
}

function timelineSubawardMarkers(subawards, startYear, endYear) {
  const buckets = new Map();
  for (const subaward of subawards || []) {
    if (!subaward.actionDate || subaward.actionDate < `${startYear}-01-01` || subaward.actionDate > `${endYear}-12-31`) continue;
    const month = subaward.actionDate.slice(0, 7);
    const bucket = buckets.get(month) || { month, count: 0, amount: 0, recipients: new Set() };
    bucket.count += 1;
    bucket.amount += Number(subaward.amount || 0);
    if (subaward.recipientName) bucket.recipients.add(subaward.recipientName);
    buckets.set(month, bucket);
  }
  return [...buckets.values()].map((bucket) => ({ ...bucket, recipientCount: bucket.recipients.size })).sort((left, right) => left.month.localeCompare(right.month));
}

function TimelineHoverCard({ hover }) {
  if (!hover) return null;
  const { record, actions, context, left, top } = hover;
  const observed = recordObligations(record);
  const potential = recordValue(record);
  const primaryActions = (actions || []).filter((action) => !action.supportingInstrument);
  const latestAction = [...primaryActions].sort((a, b) => (b.signed || "").localeCompare(a.signed || ""))[0];
  return createPortal(
    <aside id="capture-timeline-tooltip" className="capture-timeline-tooltip" role="tooltip" style={{ left, top }} data-capture-hovercard>
      <header><span>{context?.label || "Timeline context"} · {record.id}</span><strong>{record.title}</strong><small>{context?.detail || `${label(record.lifecycleStatus)} · ${label(record.mode)}`}</small></header>
      <dl>
        <div><dt>Observed obligations</dt><dd>{formatMoney(observed)}</dd></div>
        <div><dt>Potential / high</dt><dd>{formatMoney(potential)}</dd></div>
        <div><dt>Reported schedule</dt><dd>{recordDates(record).length ? `${compactDate(firstDate(record))} to ${compactDate(finalDate(record))}` : "Not published"}</dd></div>
        <div><dt>FPDS actions</dt><dd>{record.transactionSummary?.actions?.toLocaleString() || "None"}</dd></div>
        <div><dt>Reported subawards</dt><dd>{record.subawardSummary?.reportedCount ? `${record.subawardSummary.reportedCount.toLocaleString()} · ${formatMoney(record.subawardSummary.sampledAmount)} in retained detail` : "None in current snapshot"}</dd></div>
        <div><dt>Latest FPDS action</dt><dd>{latestAction ? `${compactDate(latestAction.signed)} · ${signedMoney(latestAction.obligationDelta)}` : formatDate(record.transactionSummary?.lastSigned)}</dd></div>
        <div><dt>Contract vehicle</dt><dd>{record.vehicle || "Not published"}</dd></div>
        <div><dt>Award / pricing type</dt><dd>{[record.awardType, record.pricingType].filter(Boolean).join(" · ") || "Not published"}</dd></div>
        <div><dt>Competition / set-aside</dt><dd>{[record.competitionType, record.setAside, record.eligibility].filter(Boolean).join(" · ") || "Not published"}</dd></div>
        <div><dt>Parent / predecessor</dt><dd>{record.parentReference || "Not published"}</dd></div>
        <div><dt>Type of work</dt><dd>{(record.workCategories || []).map((category) => WORK_CATEGORY_BY_ID.get(category)?.label || label(category)).join(" · ") || "Other / unclassified"}</dd></div>
        <div><dt>Imported through</dt><dd>{record.ingestionLabel || "Provenance not published"}</dd></div>
      </dl>
      <p><b>Funding office</b>{record.fundingOffice || record.owner || "Not published"}</p>
      <p><b>Contracting office</b>{record.contractingOffice || "Not published"}</p>
      <footer>{label(record.evidenceTier)} · {record.sourceRoleCount} source role{record.sourceRoleCount === 1 ? "" : "s"} · select for full evidence</footer>
    </aside>,
    document.body,
  );
}

function FollowOnDetailModal({ detail, onClose, onOpenRecord }) {
  if (!detail) return null;
  const { predecessor, activity, milestone } = detail;
  return (
    <ControlDrawer open onClose={onClose} eyebrow={`Published follow-on activity · ${activity.id}`} title={activity.title} summary={`${activity.sourceSystem} · ${activity.parentReferenceBasis || "exact predecessor PIID match"}`} size="wide" closeLabel="Close follow-on details" drawerProps={{ "data-followon-modal": "" }}>
      <section className="capture-followon-detail">
        <div className="capture-followon-detail__lineage">
          <article><span>Predecessor contract</span><strong>{predecessor.id} · {predecessor.title}</strong><small>{activity.parentReference || predecessor.reference || "Reference not published"}</small></article>
          <ChevronRight size={20} aria-hidden="true" />
          <article><span>Published activity</span><strong>{milestone.label}</strong><small>{formatDate(milestone.start)}{milestone.end && milestone.end !== milestone.start ? ` to ${formatDate(milestone.end)}` : ""} · {milestone.precision || "precision not published"}</small></article>
        </div>
        <dl>
          <div><dt>Company / sponsor</dt><dd>{activity.party || "Not published"}</dd></div>
          <div><dt>Vehicle</dt><dd>{activity.vehicle || "Not published"}</dd></div>
          <div><dt>Published value</dt><dd>{formatMoney(recordValue(activity))}</dd></div>
          <div><dt>Portfolio</dt><dd>{activity.portfolio || "Not published"}</dd></div>
          <div><dt>Funding office</dt><dd>{activity.fundingOffice || activity.owner || "Not published"}</dd></div>
          <div><dt>Contracting office</dt><dd>{activity.contractingOffice || "Not published"}</dd></div>
          <div><dt>Evidence tier</dt><dd>{label(activity.evidenceTier)}</dd></div>
          <div><dt>Validation</dt><dd>{label(activity.validationStatus)}</dd></div>
        </dl>
        <p className="capture-followon-detail__boundary"><ShieldCheck size={17} aria-hidden="true" />{activity.parentReferenceBasis || "This is a source-declared predecessor relationship."} It is published acquisition evidence, not a win prediction or an inferred recompete date.</p>
        {activity.sourceDescription ? <p>{activity.sourceDescription}</p> : null}
        <div className="capture-followon-detail__actions">
          <button type="button" onClick={() => onOpenRecord(activity.opportunityId)}>Open full activity record</button>
          {activity.sourceUrls.map((url, index) => <a key={url} href={url} target="_blank" rel="noreferrer">Source {index + 1}<ExternalLink size={13} aria-hidden="true" /></a>)}
        </div>
      </section>
    </ControlDrawer>
  );
}

function TimelineBar({ record, startYear, endYear, asOf, labelMode, feedMode, overlayLanes, actions, followOnActivities, onOpenFollowOn }) {
  const feeds = new Set(parseMultiValues(feedMode));
  const solicitationVisible = record.solicitationStart && record.solicitationEnd && record.solicitationEnd >= `${startYear}-01-01` && record.solicitationStart <= `${endYear}-12-31`;
  const solicitationLeft = solicitationVisible ? positionFor(record.solicitationStart, startYear, endYear) : 0;
  const solicitationRight = solicitationVisible ? positionFor(record.solicitationEnd, startYear, endYear) : 0;
  const solicitationActive = solicitationVisible && record.solicitationStart <= asOf && record.solicitationEnd >= asOf;
  const solicitationElement = solicitationVisible ? <i role="button" tabIndex="0" key={`solicitation-${record.opportunityId}`} className={`capture-timeline__solicitation-window${solicitationActive ? " is-active" : ""}`} data-solicitation-window data-timeline-context={solicitationActive ? "Active solicitation window" : "Published solicitation window"} data-timeline-detail={`${formatDate(record.solicitationStart)} to ${formatDate(record.solicitationEnd)} · ${record.noticeType || "published solicitation"}`} style={{ left: `${solicitationLeft}%`, width: `${Math.max(solicitationRight - solicitationLeft, 0.8)}%` }} aria-label={`${solicitationActive ? "Active" : "Published"} solicitation window ${formatDate(record.solicitationStart)} to ${formatDate(record.solicitationEnd)}`} /> : null;
  const classificationStart = record.solicitationStart || firstDate(record);
  const classificationEnd = record.solicitationEnd || finalDate(record);
  const classificationVisible = classificationStart && classificationEnd && classificationEnd >= `${startYear}-01-01` && classificationStart <= `${endYear}-12-31`;
  const classificationLeft = classificationVisible ? positionFor(classificationStart, startYear, endYear) : 0;
  const classificationRight = classificationVisible ? positionFor(classificationEnd, startYear, endYear) : 0;
  const competitionText = [record.competitionType, record.setAside, record.eligibility].filter(Boolean).join(" · ");
  const competitionKind = /small business|8\(a\)|hubzone|sdvosb|wosb/i.test(competitionText) ? "small-business" : /full and open/i.test(competitionText) ? "full-open" : "other";
  const laneStyle = (lane) => ({ left: `${classificationLeft}%`, width: `${Math.max(classificationRight - classificationLeft, 0.8)}%`, "--capture-lane-index": overlayLanes?.[lane] || 0 });
  const competitionElement = feeds.has("competition") && classificationVisible && competitionText ? <i role="button" tabIndex="0" key={`competition-${record.opportunityId}`} className={`capture-timeline__classification capture-timeline__classification--competition capture-timeline__classification--${competitionKind}`} data-competition-overlay data-timeline-context="Competition / set-aside" data-timeline-detail={competitionText} style={laneStyle("competition")} aria-label={`Competition and set-aside overlay: ${competitionText}`} /> : null;
  const vehicleElement = feeds.has("vehicle") && classificationVisible && record.vehicle ? <i role="button" tabIndex="0" key={`vehicle-${record.opportunityId}`} className="capture-timeline__classification capture-timeline__classification--vehicle" data-vehicle-overlay data-timeline-context="Contract vehicle" data-timeline-detail={record.vehicle} style={laneStyle("vehicle")} aria-label={`Contract vehicle overlay: ${record.vehicle}`} /> : null;
  const pricingText = [record.pricingType, record.awardType].filter(Boolean).join(" · ");
  const pricingKind = /firm fixed price|\bffp\b/i.test(record.pricingType || "") ? "pricing-fixed-price" : /cost plus|cost no fee|\bcpff\b|\bcpaf\b|\bcpif\b/i.test(record.pricingType || "") ? "pricing-cost-reimbursable" : /time and materials|\bt&m\b/i.test(record.pricingType || "") ? "pricing-time-materials" : "pricing-other";
  const structureElement = feeds.has("structure") && classificationVisible && pricingText ? <i role="button" tabIndex="0" key={`structure-${record.opportunityId}`} className={`capture-timeline__classification capture-timeline__classification--structure capture-timeline__classification--${pricingKind}`} data-structure-overlay data-pricing-kind={pricingKind} data-timeline-context="Award / pricing structure" data-timeline-detail={pricingText} style={laneStyle("structure")} aria-label={`Award and pricing type overlay: ${pricingText}`} /> : null;
  const categoryLabels = (record.workCategories || []).map((category) => WORK_CATEGORY_BY_ID.get(category)?.label || label(category));
  const primaryCategory = WORK_CATEGORY_BY_ID.get(record.workCategory) || WORK_CATEGORY_BY_ID.get("other-unclassified");
  const workElement = feeds.has("work") && classificationVisible ? <i role="button" tabIndex="0" key={`work-${record.opportunityId}`} className="capture-timeline__classification capture-timeline__classification--work" data-work-category-overlay data-work-category={record.workCategory} data-timeline-context="Type of work" data-timeline-detail={`${categoryLabels.join(" · ") || "Other / unclassified"} · ${record.workCategoryBasis || "classification basis not published"}`} style={{ ...laneStyle("work"), "--capture-category-color": primaryCategory?.color || "#6c7b88" }} aria-label={`Type of work overlay: ${categoryLabels.join(", ") || "Other / unclassified"}`} /> : null;
  const provenanceMethod = INGESTION_METHOD_BY_ID.get(record.ingestionMethod) || INGESTION_METHOD_BY_ID.get("source-file");
  const provenanceElement = feeds.has("provenance") && classificationVisible ? <i role="button" tabIndex="0" key={`provenance-${record.opportunityId}`} className="capture-timeline__classification capture-timeline__classification--provenance" data-ingestion-provenance-overlay data-ingestion-method={record.ingestionMethod} data-timeline-context="Ingestion provenance" data-timeline-detail={`${record.ingestionLabel || provenanceMethod?.label} · ${(record.ingestionChannels || []).map((channel) => channel.label).join(" · ") || record.sourceSystem || "source channel not published"}`} style={{ ...laneStyle("provenance"), "--capture-provenance-color": provenanceMethod?.color || "#647a8b" }} aria-label={`Ingestion provenance overlay: ${record.ingestionLabel || provenanceMethod?.label}`} /> : null;
  const changeElement = feeds.has("changes") && classificationVisible && record.changeStatus !== "unchanged" ? <i role="button" tabIndex="0" key={`change-${record.opportunityId}`} className={`capture-timeline__classification capture-timeline__classification--change capture-timeline__classification--change-${record.changeStatus}`} data-procurement-change-overlay data-change-status={record.changeStatus} data-timeline-context="Changed since prior snapshot" data-timeline-detail={`${label(record.changeStatus)} in ${record.changeSourceSystem || "public feed"}`} style={laneStyle("changes")} aria-label={`Changed since prior snapshot: ${label(record.changeStatus)}`} /> : null;
  const actionMarkers = feeds.has("fpds") ? timelineActionMarkers(actions, startYear, endYear) : [];
  const subawardMarkers = feeds.has("subawards") ? timelineSubawardMarkers(record.subawards, startYear, endYear) : [];
  const fiscalMaximum = Math.max(...record.fiscalValues.map((item) => Math.abs(Number(item.amount || 0))), 1);
  const fiscalMarkers = feeds.has("fiscal") ? record.fiscalValues.filter((item) => item.fiscalYear >= startYear && item.fiscalYear <= endYear + 1) : [];
  const refreshedEnd = feeds.has("awards") ? record.liveAward?.endDate : null;
  const refreshedEndVisible = refreshedEnd && refreshedEnd >= `${startYear}-01-01` && refreshedEnd <= `${endYear}-12-31`;
  const followOnMarkers = feeds.has("followon") ? (followOnActivities || []).flatMap((activity) => [
    ...(activity.solicitationStart && activity.solicitationEnd ? [{ label: activity.solicitationStart <= asOf && activity.solicitationEnd >= asOf ? "Active solicitation window" : "Published solicitation window", start: activity.solicitationStart, end: activity.solicitationEnd, precision: "range" }] : []),
    ...activity.milestones,
  ].map((milestone) => ({ ...milestone, activity }))).filter((marker) => marker.start && marker.end >= `${startYear}-01-01` && marker.start <= `${endYear}-12-31`) : [];
  const followOnElements = followOnMarkers.map((marker) => {
    const left = positionFor(marker.start, startYear, endYear);
    const right = positionFor(marker.end, startYear, endYear);
    const context = `Published follow-on · ${marker.activity.id}`;
    const detail = `${marker.activity.title} · ${marker.label} · ${marker.activity.parentReferenceBasis || "exact predecessor PIID"} · ${marker.activity.sourceSystem}`;
    const openFollowOn = (event) => {
      event.preventDefault();
      event.stopPropagation();
      onOpenFollowOn({ predecessor: record, activity: marker.activity, milestone: marker });
    };
    const keyboardOpenFollowOn = (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      openFollowOn(event);
    };
    const common = {
      role: "button",
      tabIndex: 0,
      "aria-label": `${context}: ${detail}`,
      "data-followon-activity": "",
      "data-timeline-context": context,
      "data-timeline-detail": detail,
      onClick: openFollowOn,
      onKeyDown: keyboardOpenFollowOn,
    };
    return marker.precision === "day"
      ? <i {...common} key={`followon-${marker.activity.opportunityId}-${marker.label}-${marker.start}`} className="capture-timeline__followon-marker" style={{ left: `${left}%` }} />
      : <i {...common} key={`followon-${marker.activity.opportunityId}-${marker.label}-${marker.start}`} className="capture-timeline__followon-window" style={{ left: `${left}%`, width: `${Math.max(right - left, 0.8)}%` }} />;
  });
  if (record.mode === "contract-performance" && record.start && (record.currentEnd || record.potentialEnd)) {
    const baseEnd = record.currentEnd || record.potentialEnd;
    const left = positionFor(record.start, startYear, endYear);
    const baseRight = positionFor(baseEnd, startYear, endYear);
    const potentialRight = positionFor(record.potentialEnd || baseEnd, startYear, endYear);
    const elapsed = Math.max(0, Math.min(100, (dateDiffDays(record.start, asOf) / Math.max(dateDiffDays(record.start, baseEnd), 1)) * 100));
    const state = baseEnd < asOf ? "historical" : record.start > asOf ? "upcoming" : "active";
    const barLabel = timelineBarLabel(record, labelMode, record.start, baseEnd);
    return (
      <>
        {potentialRight > baseRight ? (
          <i role="button" tabIndex="0" aria-label={`Potential option horizon through ${formatDate(record.potentialEnd)}`} className="capture-timeline__bar capture-timeline__bar--potential" data-timeline-context="Potential option horizon" data-timeline-detail={`Potential through ${formatDate(record.potentialEnd)}`} style={{ left: `${baseRight}%`, width: `${Math.max(potentialRight - baseRight, 0.6)}%` }}>
            {potentialRight - baseRight >= 9 && labelMode !== "none" ? <b>Option to {monthYear(record.potentialEnd)}</b> : null}
          </i>
        ) : null}
        <i role="button" tabIndex="0" aria-label={`Reported performance term ${formatDate(record.start)} to ${formatDate(baseEnd)}`} className={`capture-timeline__bar capture-timeline__bar--base capture-timeline__bar--${state}`} data-timeline-context="Reported performance term" data-timeline-detail={`${formatDate(record.start)} to ${formatDate(baseEnd)}`} style={{ left: `${left}%`, width: `${Math.max(baseRight - left, 0.6)}%` }}>
          <span style={{ width: `${elapsed}%` }} aria-hidden="true" />
          {baseRight - left >= 10 && labelMode !== "none" ? <b>{barLabel}</b> : null}
        </i>
        {fiscalMarkers.map((marker) => { const start = `${marker.fiscalYear - 1}-10-01`; const end = `${marker.fiscalYear}-09-30`; const leftEdge = positionFor(start, startYear, endYear); const rightEdge = positionFor(end, startYear, endYear); return <i key={`fy-${marker.fiscalYear}`} className={`capture-timeline__fiscal-marker${marker.amount < 0 ? " is-negative" : ""}`} data-timeline-context={`FY${marker.fiscalYear} net obligations`} data-timeline-detail={signedMoney(marker.amount)} style={{ left: `${Math.max(0, leftEdge)}%`, width: `${Math.max(Math.min(100, rightEdge) - Math.max(0, leftEdge), 0.8)}%`, "--capture-fiscal-intensity": Math.abs(marker.amount) / fiscalMaximum }} />; })}
        {actionMarkers.map((marker) => <i key={marker.month} className={`capture-timeline__action-marker${marker.deobligation ? " has-deobligation" : ""}`} data-timeline-context={`FPDS actions · ${marker.month}`} data-timeline-detail={`${marker.count} action${marker.count === 1 ? "" : "s"} · ${signedMoney(marker.obligationDelta)}`} style={{ left: `${positionFor(`${marker.month}-15`, startYear, endYear)}%`, "--capture-action-size": Math.min(4 + marker.count, 11) }}><span>{marker.count > 1 ? marker.count : ""}</span></i>)}
        {subawardMarkers.map((marker, index) => <i key={`subaward-${marker.month}`} className="capture-timeline__subaward-marker" data-subaward-overlay role="button" tabIndex={0} aria-label={`${marker.count} sampled subaward action${marker.count === 1 ? "" : "s"} in ${marker.month}`} data-timeline-context={`Subaward actions · ${marker.month}`} data-timeline-detail={`${marker.count} sampled action${marker.count === 1 ? "" : "s"} · ${signedMoney(marker.amount)} · ${marker.recipientCount} recipient${marker.recipientCount === 1 ? "" : "s"}`} style={{ left: `${positionFor(`${marker.month}-15`, startYear, endYear)}%`, top: `${9 + (index % 2) * 11}px`, "--capture-subaward-size": Math.min(5 + marker.count, 10) }}><span>{marker.count > 1 ? marker.count : ""}</span></i>)}
        {refreshedEndVisible ? <i className="capture-timeline__award-marker" data-timeline-context="USAspending refreshed award end" data-timeline-detail={`${formatDate(refreshedEnd)} · exact award-ID match`} style={{ left: `${positionFor(refreshedEnd, startYear, endYear)}%` }} /> : null}
        {solicitationElement}
        {competitionElement}
        {vehicleElement}
        {structureElement}
        {workElement}
        {provenanceElement}
        {changeElement}
        {followOnElements}
      </>
    );
  }
  return [solicitationElement, competitionElement, vehicleElement, structureElement, workElement, provenanceElement, changeElement].filter(Boolean).concat(record.milestones.map((milestone) => {
    const left = positionFor(milestone.start, startYear, endYear);
    const right = positionFor(milestone.end, startYear, endYear);
    return milestone.precision === "day" ? (
      <i role="button" tabIndex="0" aria-label={`${milestone.label}: ${formatDate(milestone.start)}`} key={`${milestone.label}-${milestone.start}`} className="capture-timeline__milestone" data-timeline-context={milestone.label} data-timeline-detail={formatDate(milestone.start)} style={{ left: `${left}%` }}><span>{labelMode === "none" ? "" : milestone.label}</span></i>
    ) : (
      <i role="button" tabIndex="0" aria-label={`${milestone.label}: ${formatDate(milestone.start)} to ${formatDate(milestone.end)}`} key={`${milestone.label}-${milestone.start}`} className="capture-timeline__bar capture-timeline__bar--window" data-timeline-context={milestone.label} data-timeline-detail={`${formatDate(milestone.start)} to ${formatDate(milestone.end)}`} style={{ left: `${left}%`, width: `${Math.max(right - left, 0.8)}%` }}>
        {right - left >= 8 && labelMode !== "none" ? <b>{labelMode === "dates" ? milestone.label : timelineBarLabel(record, labelMode, milestone.start, milestone.end)}</b> : null}
      </i>
    );
  })).concat(fiscalMarkers.map((marker) => { const start = `${marker.fiscalYear - 1}-10-01`; const end = `${marker.fiscalYear}-09-30`; const leftEdge = positionFor(start, startYear, endYear); const rightEdge = positionFor(end, startYear, endYear); return <i key={`fy-${marker.fiscalYear}`} className={`capture-timeline__fiscal-marker${marker.amount < 0 ? " is-negative" : ""}`} data-timeline-context={`FY${marker.fiscalYear} net obligations`} data-timeline-detail={signedMoney(marker.amount)} style={{ left: `${Math.max(0, leftEdge)}%`, width: `${Math.max(Math.min(100, rightEdge) - Math.max(0, leftEdge), 0.8)}%`, "--capture-fiscal-intensity": Math.abs(marker.amount) / fiscalMaximum }} />; })).concat(actionMarkers.map((marker) => <i key={`action-${marker.month}`} className={`capture-timeline__action-marker${marker.deobligation ? " has-deobligation" : ""}`} data-timeline-context={`FPDS actions · ${marker.month}`} data-timeline-detail={`${marker.count} action${marker.count === 1 ? "" : "s"} · ${signedMoney(marker.obligationDelta)}`} style={{ left: `${positionFor(`${marker.month}-15`, startYear, endYear)}%`, "--capture-action-size": Math.min(4 + marker.count, 11) }}><span>{marker.count > 1 ? marker.count : ""}</span></i>)).concat(subawardMarkers.map((marker, index) => <i key={`subaward-${marker.month}`} className="capture-timeline__subaward-marker" data-subaward-overlay role="button" tabIndex={0} aria-label={`${marker.count} sampled subaward actions in ${marker.month}`} data-timeline-context={`Subaward actions · ${marker.month}`} data-timeline-detail={`${marker.count} sampled action${marker.count === 1 ? "" : "s"} · ${signedMoney(marker.amount)} · ${marker.recipientCount} recipients`} style={{ left: `${positionFor(`${marker.month}-15`, startYear, endYear)}%`, top: `${9 + (index % 2) * 11}px`, "--capture-subaward-size": Math.min(5 + marker.count, 10) }}><span>{marker.count > 1 ? marker.count : ""}</span></i>)).concat(refreshedEndVisible ? [<i key="refreshed-end" className="capture-timeline__award-marker" data-timeline-context="USAspending refreshed award end" data-timeline-detail={`${formatDate(refreshedEnd)} · exact award-ID match`} style={{ left: `${positionFor(refreshedEnd, startYear, endYear)}%` }} />] : []).concat(followOnElements);
}

function CaptureTimeline({ records, startYear, endYear, selectedId, onSelect, asOf, density, groupBy, labelMode, rowFields, feedMode, actionsByOpportunity, followOnByOpportunity, watchedIds, onToggleWatch }) {
  const scrollerRef = useRef(null);
  const [hover, setHover] = useState(null);
  const [followOnDetail, setFollowOnDetail] = useState(null);
  const years = Array.from({ length: endYear - startYear + 1 }, (_value, index) => startYear + index);
  const asOfPosition = positionFor(asOf, startYear, endYear);
  const showAsOf = asOf >= `${startYear}-01-01` && asOf <= `${endYear}-12-31`;
  const groups = groupBy === "none"
    ? [{ id: "all", label: null, records }]
    : [...records.reduce((map, record) => {
      const group = timelineGroupValue(record, groupBy);
      const current = map.get(group) || [];
      current.push(record);
      map.set(group, current);
      return map;
    }, new Map())].map(([groupLabel, groupRecords]) => ({ id: groupLabel, label: groupLabel, records: groupRecords }));
  const activeFields = selectedFieldIds(rowFields);
  const activeFeeds = new Set(parseMultiValues(feedMode));
  const categoricalFeeds = ["competition", "vehicle", "structure", "work", "provenance", "changes"].filter((feed) => activeFeeds.has(feed));
  const overlayLanes = Object.fromEntries(categoricalFeeds.map((feed, index) => [feed, index]));
  const hasClassificationLanes = categoricalFeeds.length > 0;
  function showHover(record, target, clientX, clientY, context = null) {
    const bounds = target.getBoundingClientRect();
    const width = Math.min(360, window.innerWidth - 16);
    const left = Math.max(8, Math.min(clientX || bounds.right + 12, window.innerWidth - width - 8));
    const top = Math.max(8, Math.min(clientY || bounds.top, window.innerHeight - 330));
    setHover({ record, actions: actionsByOpportunity?.[record.opportunityId] || [], context, left, top });
  }
  function showPointerContext(record, event) {
    if (event.pointerType !== "mouse") return;
    const mark = event.target.closest("[data-timeline-context]");
    if (!mark) {
      setHover(null);
      return;
    }
    showHover(record, mark, event.clientX + 14, event.clientY + 14, { label: mark.dataset.timelineContext, detail: mark.dataset.timelineDetail });
  }
  function showFocusedContext(record, event) {
    const mark = event.target.closest("[data-timeline-context]");
    if (!mark || window.matchMedia("(pointer: coarse)").matches) return;
    showHover(record, mark, undefined, undefined, { label: mark.dataset.timelineContext, detail: mark.dataset.timelineDetail });
  }
  function activateTimelineMark(record, event) {
    const mark = event.target.closest("[data-timeline-context]");
    if (!mark || mark.hasAttribute("data-followon-activity")) return;
    if (event.type === "keydown" && event.key !== "Enter" && event.key !== " ") return;
    if (event.type === "keydown") event.preventDefault();
    onSelect(record.opportunityId);
  }
  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller || !showAsOf || !window.matchMedia("(max-width: 760px)").matches) return;
    const frame = window.requestAnimationFrame(() => {
      const labelWidth = Number.parseFloat(getComputedStyle(scroller).getPropertyValue("--capture-label-width")) || 330;
      const plotWidth = Math.max(scroller.scrollWidth - labelWidth - 24, 1);
      scroller.scrollLeft = Math.max(labelWidth + (asOfPosition / 100) * plotWidth - scroller.clientWidth / 2, 0);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [asOfPosition, endYear, showAsOf, startYear]);
  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return undefined;
    const sizeToViewport = () => {
      const available = Math.max(360, window.innerHeight - scroller.getBoundingClientRect().top - 12);
      scroller.style.maxHeight = `${available}px`;
      scroller.style.height = scroller.scrollHeight >= available ? `${available}px` : "auto";
    };
    const frame = window.requestAnimationFrame(sizeToViewport);
    window.addEventListener("resize", sizeToViewport);
    return () => { window.cancelAnimationFrame(frame); window.removeEventListener("resize", sizeToViewport); };
  }, [density, groups.length, hasClassificationLanes]);
  return (
    <div ref={scrollerRef} className={`capture-timeline capture-timeline--${density}${hasClassificationLanes ? " capture-timeline--has-classification-lanes" : ""}`} style={{ "--capture-extra-lanes": Math.max(categoricalFeeds.length - 3, 0) }} data-capture-timeline>
      <div className="capture-timeline__inner" style={{ "--capture-years": years.length }}>
        <div className="capture-timeline__head capture-timeline__label"><strong>Contract / acquisition</strong><span>{activeFields.map((field) => ROW_FIELD_OPTIONS.find(([id]) => id === field)?.[1]).join(" · ")}</span></div>
        <div className="capture-timeline__head capture-timeline__years">
          {years.map((year) => <span key={year}><b>{year}</b><small><i>Q1</i><i>Q2</i><i>Q3</i><i>Q4</i></small></span>)}
          {showAsOf ? <em className="capture-timeline__today-label" style={{ left: `${asOfPosition}%` }}>As of {monthYear(asOf)}</em> : null}
        </div>
        {groups.map((group) => (
          <Fragment key={group.id}>
            {group.label ? <div className="capture-timeline__group"><strong>{group.label}</strong><span>{group.records.length} {group.records.length === 1 ? "row" : "rows"} · {formatMoney(group.records.reduce((sum, record) => sum + recordObligations(record), 0))} obligated · {group.records.reduce((sum, record) => sum + Number(record.transactionSummary?.actions || 0), 0).toLocaleString()} actions</span></div> : null}
            {group.records.map((record) => (
              <div key={record.opportunityId} className={`capture-timeline__row capture-timeline__row--${record.lifecycleStatus}${selectedId === record.opportunityId ? " is-selected" : ""}${watchedIds.has(record.opportunityId) ? " is-watched" : ""}`} data-capture-timeline-row data-record-id={record.opportunityId}>
                <div className="capture-timeline__label">
                  <span className="capture-timeline__badges"><b>{record.id}</b><em>{label(record.lifecycleStatus)}</em></span>
                  <button type="button" className={`capture-timeline__star${watchedIds.has(record.opportunityId) ? " is-starred" : ""}`} aria-pressed={watchedIds.has(record.opportunityId)} onClick={() => onToggleWatch(record.opportunityId)} aria-label={watchedIds.has(record.opportunityId) ? `Stop tracking ${record.title}` : `Track ${record.title}`}><Star size={16} fill={watchedIds.has(record.opportunityId) ? "currentColor" : "none"} /></button>
                  <button type="button" className="capture-timeline__record-button" onClick={() => onSelect(record.opportunityId)} aria-label={`Open ${record.title} details`}><strong>{record.title}</strong></button>
                  <small className="capture-timeline__fields">{activeFields.map((field) => <span key={field}>{timelineFieldValue(record, field)}</span>)}</small>
                </div>
                <span className="capture-timeline__plot" role="button" tabIndex={0} onClick={(event) => { if (!event.target.closest("[data-followon-activity]")) onSelect(record.opportunityId); }} onPointerEnter={(event) => showPointerContext(record, event)} onPointerMove={(event) => showPointerContext(record, event)} onPointerLeave={() => setHover(null)} onFocusCapture={(event) => showFocusedContext(record, event)} onBlurCapture={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setHover(null); }} onKeyDown={(event) => activateTimelineMark(record, event)} aria-label={`${record.title}: ${recordDates(record).length ? `${formatDate(firstDate(record))} to ${formatDate(finalDate(record))}` : "schedule not published"}`}>
                  <span className="capture-timeline__grid" aria-hidden="true">{years.map((year) => <i key={year} />)}</span>
                  {showAsOf ? <span className="capture-timeline__today" style={{ left: `${asOfPosition}%` }} aria-hidden="true" /> : null}
                  <TimelineBar record={record} startYear={startYear} endYear={endYear} asOf={asOf} labelMode={labelMode} feedMode={feedMode} overlayLanes={overlayLanes} actions={actionsByOpportunity?.[record.opportunityId] || []} followOnActivities={followOnByOpportunity?.[record.opportunityId] || []} onOpenFollowOn={(detail) => { setHover(null); setFollowOnDetail(detail); }} />
                  {!recordDates(record).length ? <em>Schedule not published</em> : null}
                </span>
                <button type="button" className="capture-timeline__open" onClick={() => onSelect(record.opportunityId)} aria-label={`Open ${record.title} details`}><ChevronRight size={16} aria-hidden="true" /></button>
              </div>
            ))}
          </Fragment>
        ))}
      </div>
      <TimelineHoverCard hover={hover} />
      <FollowOnDetailModal detail={followOnDetail} onClose={() => setFollowOnDetail(null)} onOpenRecord={(opportunityId) => { setFollowOnDetail(null); onSelect(opportunityId); }} />
    </div>
  );
}

function LifecycleMatrix({ records, portfolios, onSelect }) {
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
              return <button type="button" key={status} disabled={!count} onClick={() => onSelect?.(portfolio, status)} style={{ "--capture-intensity": count / maximum }}><strong>{count || "·"}</strong><em>{label(status)}</em></button>;
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

export default function CaptureCalendar({ dataset, awards = [], samOpportunities = { metadata: {}, records: [] }, manualProcurement = { records: [] }, procurementDelta = { records: [], summary: {} }, subawardSnapshot = { metadata: { status: "unavailable" }, primes: [] }, embedded = false, embeddedTabs = null }) {
  const [filters, setFilters] = useCaptureFilters();
  const [discoveryFeed, setDiscoveryFeed] = useState(() => procurementDelta?.discovery?.length ? procurementDelta : emptyProcurementDiscovery());
  const [selectedId, setSelectedIdState] = useState(() => new URLSearchParams(window.location.hash.split("?")[1] || "").get("capRecord") || "");
  const [actionDataset, setActionDataset] = useState(null);
  const [actionState, setActionState] = useState("idle");
  const [actionLoadAttempt, setActionLoadAttempt] = useState(0);
  const actionRequestRef = useRef(null);
  const [subawardDetails, setSubawardDetails] = useState(null);
  const [subawardDetailState, setSubawardDetailState] = useState("idle");
  const subawardRequestRef = useRef(null);
  const [filtersExpanded, setFiltersExpanded] = useState(false);
  const [ganttToolsOpen, setGanttToolsOpen] = useState(false);
  const isMobileViewport = useMediaQuery("(max-width: 760px)");
  const [comparisonIds, setComparisonIds] = useState(() => {
    const validIds = new Set(assembleProcurementRecords(dataset.records || [], awards, dataset.metadata.asOf, samOpportunities.records || [], manualProcurement.records || [], subawardSnapshot).map((record) => record.opportunityId));
    return [...new Set(readStoredArray(COMPARISON_STORAGE_KEY).filter((value) => typeof value === "string" && validIds.has(value)))].slice(0, 4);
  });
  const [savedViews, setSavedViews] = useState(() => readStoredArray(SAVED_VIEWS_STORAGE_KEY)
    .filter((view) => view && typeof view.id === "string" && view.filters)
    .map((view) => ({ ...view, name: typeof view.name === "string" && view.name.trim() ? view.name : "Saved view", filters: normalizeSavedFilters(view.filters) }))
    .slice(0, 8));
  const [compareNotice, setCompareNotice] = useState("");
  useEffect(() => {
    if (filters.capSort !== "added" || discoveryFeed.discovery.length) return undefined;
    let active = true;
    loadProcurementDiscovery()
      .then((payload) => { if (active) setDiscoveryFeed(payload); })
      .catch(() => { /* Date-added sorting remains explicit and stable when the deferred feed is unavailable. */ });
    return () => { active = false; };
  }, [discoveryFeed.discovery.length, filters.capSort]);
  const asOf = dataset.metadata.asOf;
  const sourceRecords = useMemo(() => dataset.records || [], [dataset]);
  const effectiveSubawardSnapshot = useMemo(() => ({
    ...subawardSnapshot,
    primes: (subawardSnapshot.primes || []).map((prime) => ({
      ...prime,
      subawards: subawardDetails?.byPrime?.[prime.primeAwardId] || [],
    })),
  }), [subawardDetails, subawardSnapshot]);
  const records = useMemo(() => applyProcurementChanges(assembleProcurementRecords(sourceRecords, awards, asOf, samOpportunities.records || [], manualProcurement.records || [], effectiveSubawardSnapshot), procurementDelta.records || [], discoveryFeed.discovery || []), [asOf, awards, discoveryFeed.discovery, effectiveSubawardSnapshot, manualProcurement.records, procurementDelta.records, samOpportunities.records, sourceRecords]);
  const management = useManagementState(records);
  const dispositions = useRecordDispositions();
  const timelineStartYear = Math.min(Number(filters.capFrom), Number(filters.capTo));
  const timelineEndYear = Math.max(Number(filters.capFrom), Number(filters.capTo));
  const portfolios = useMemo(() => [...new Set(records.map((record) => record.portfolio))].sort(), [records]);
  const parties = useMemo(() => [...new Set(records.map((record) => record.party).filter(Boolean))].sort(), [records]);
  const offices = useMemo(() => [...new Set(records.flatMap((record) => [record.contractingOffice, record.fundingOffice, record.owner]).filter(Boolean))].sort(), [records]);
  const vehicles = useMemo(() => [...new Set(records.map((record) => record.vehicle).filter(Boolean))].sort(), [records]);
  const workCategories = useMemo(() => WORK_CATEGORY_OPTIONS.filter((category) => records.some((record) => (record.workCategories || []).includes(category.id))), [records]);
  const technologyAreas = useMemo(() => TECHNOLOGY_AREA_OPTIONS.filter((area) => records.some((record) => (record.technologyAreas || []).includes(area.id))), [records]);
  const organizationBranches = useMemo(() => [...new Set(records.map((record) => record.organization?.branch).filter(Boolean))].sort(), [records]);
  const selectedBranches = parseMultiValues(filters.capOrgBranch);
  const organizationComponents = useMemo(() => [...new Set(records
    .filter((record) => !selectedBranches.length || selectedBranches.includes(record.organization?.branch))
    .map((record) => record.organization?.component).filter(Boolean))].sort(), [records, selectedBranches]);
  const selectedComponents = parseMultiValues(filters.capOrgComponent);
  const organizationOffices = useMemo(() => [...new Set(records
    .filter((record) => (!selectedBranches.length || selectedBranches.includes(record.organization?.branch)) && (!selectedComponents.length || selectedComponents.includes(record.organization?.component)))
    .map((record) => record.organization?.office).filter((value) => value && value !== "Office not published"))].sort(), [records, selectedBranches, selectedComponents]);
  const ingestionMethods = useMemo(() => INGESTION_METHOD_OPTIONS.filter((method) => records.some((record) => record.ingestionMethod === method.id)), [records]);
  const evidenceTiers = useMemo(() => [...new Set(records.map((record) => record.evidenceTier))], [records]);
  const lifecycleStates = useMemo(() => [...new Set(records.map((record) => record.lifecycleStatus))], [records]);
  const awardMap = useMemo(() => new Map(awards.map((award) => [String(award.awardId || "").toUpperCase(), award])), [awards]);
  const enriched = useMemo(() => records.map((record) => ({ ...record, liveAward: record.liveAward || awardMap.get(String(record.reference || "").toUpperCase()) || null })), [records, awardMap]);
  const followOnByOpportunity = useMemo(() => {
    const contractsByReference = new Map();
    for (const record of enriched.filter((item) => item.mode === "contract-performance" && item.reference)) {
      const key = String(record.reference).toUpperCase();
      const matches = contractsByReference.get(key) || [];
      matches.push(record.opportunityId);
      contractsByReference.set(key, matches);
    }
    const links = {};
    for (const activity of enriched.filter((item) => item.mode === "acquisition-window" && item.parentReference)) {
      const sourceSystem = activity.sourceUrls.some((url) => /sam\.gov/i.test(url))
        ? "SAM.gov"
        : activity.sourceUrls.some((url) => /forecast|\.pdf(?:$|\?)/i.test(url))
          ? "Agency acquisition forecast"
          : "Published acquisition source";
      for (const opportunityId of contractsByReference.get(String(activity.parentReference).toUpperCase()) || []) {
        links[opportunityId] = [...(links[opportunityId] || []), { ...activity, sourceSystem }];
      }
    }
    return links;
  }, [enriched]);
  const followOnLinkCount = Object.values(followOnByOpportunity).reduce((total, rows) => total + rows.length, 0);
  const comparisonRecords = comparisonIds.map((id) => enriched.find((record) => record.opportunityId === id)).filter(Boolean);

  useEffect(() => {
    window.localStorage.setItem(COMPARISON_STORAGE_KEY, JSON.stringify(comparisonIds));
  }, [comparisonIds]);

  useEffect(() => {
    window.localStorage.setItem(SAVED_VIEWS_STORAGE_KEY, JSON.stringify(savedViews));
  }, [savedViews]);

  useEffect(() => {
    const normalized = {};
    const optionSets = { capPortfolio: portfolios, capEvidence: evidenceTiers, capLifecycle: lifecycleStates, capParty: parties, capOffice: offices, capVehicle: vehicles, capWork: workCategories.map((category) => category.id), capTech: technologyAreas.map((area) => area.id), capOrgBranch: organizationBranches, capOrgComponent: organizationComponents, capOrgOffice: organizationOffices, capOrigin: ingestionMethods.map((method) => method.id) };
    for (const key of MULTI_FILTER_KEYS) {
      const canonical = normalizeMultiValue(filters[key], optionSets[key]);
      if (canonical !== filters[key]) normalized[key] = canonical;
    }
    if (!Object.keys(normalized).length) return undefined;
    const timer = window.setTimeout(() => setFilters(normalized), 0);
    return () => window.clearTimeout(timer);
  }, [evidenceTiers, filters, ingestionMethods, lifecycleStates, offices, organizationBranches, organizationComponents, organizationOffices, parties, portfolios, setFilters, technologyAreas, vehicles, workCategories]);
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
      const subawardMatch = filters.capSubaward === "all"
        || (filters.capSubaward === "has" && record.subawardSummary?.reportedCount > 0)
        || (filters.capSubaward === "recent" && record.subawardSummary?.latestActionDate >= recentCutoff.toISOString().slice(0, 10))
        || (filters.capSubaward === "none" && !record.subawardSummary?.reportedCount);
      const searchable = [record.id, record.title, record.party, record.reference, record.context, record.portfolio, record.sourceDescription, record.contractingOffice, record.fundingOffice, record.vehicle, record.pscCode, record.pscDescription, record.naicsCode, record.naicsDescription, ...(record.workCategories || []).map((category) => WORK_CATEGORY_BY_ID.get(category)?.label || category), ...(record.technologyAreas || []).map((area) => TECHNOLOGY_AREA_BY_ID.get(area)?.label || area), ...(record.organization?.path || []), record.ingestionLabel, record.sourceSystem].join(" ").toLowerCase();
      return (!query || searchable.includes(query))
        && !dispositions.tombstonedIds.has(record.opportunityId)
        && (filters.capTracked === "all" || management.watchedIds.has(record.opportunityId))
        && multiValueMatches(filters.capPortfolio, record.portfolio)
        && (filters.capMode === "all" || record.mode === filters.capMode)
        && multiValueMatches(filters.capEvidence, record.evidenceTier)
        && multiValueMatches(filters.capLifecycle, record.lifecycleStatus)
        && multiValueMatches(filters.capParty, record.party)
        && (!parseMultiValues(filters.capOffice).length || [record.contractingOffice, record.fundingOffice, record.owner].some((office) => parseMultiValues(filters.capOffice).includes(office)))
        && multiValueMatches(filters.capVehicle, record.vehicle)
        && (!parseMultiValues(filters.capWork).length || (record.workCategories || []).some((category) => parseMultiValues(filters.capWork).includes(category)))
        && (!parseMultiValues(filters.capTech).length || (record.technologyAreas || []).some((area) => parseMultiValues(filters.capTech).includes(area)))
        && multiValueMatches(filters.capOrgBranch, record.organization?.branch)
        && multiValueMatches(filters.capOrgComponent, record.organization?.component)
        && multiValueMatches(filters.capOrgOffice, record.organization?.office)
        && multiValueMatches(filters.capOrigin, record.ingestionMethod)
        && (filters.capChange === "all" || record.changeStatus === filters.capChange)
        && (filters.capValidation === "all" || record.validationStatus === filters.capValidation)
        && horizonMatch
        && activityMatch
        && subawardMatch
        && recordValue(record) >= minimum
        && withinWindow;
    }).sort((left, right) => {
      if (filters.capSort === "added") return String(right.firstSeenAt || "").localeCompare(String(left.firstSeenAt || "")) || left.title.localeCompare(right.title);
      if (filters.capSort === "technology") return String(TECHNOLOGY_AREA_BY_ID.get(left.technologyAreas?.[0])?.label || "Unclassified").localeCompare(String(TECHNOLOGY_AREA_BY_ID.get(right.technologyAreas?.[0])?.label || "Unclassified")) || left.title.localeCompare(right.title);
      if (filters.capSort === "organization") return String(left.organization?.path?.join(" / ") || "Unclassified").localeCompare(String(right.organization?.path?.join(" / ") || "Unclassified")) || left.title.localeCompare(right.title);
      if (filters.capSort === "value") return recordValue(right) - recordValue(left);
      if (filters.capSort === "obligations") return (right.liveAward?.awardAmountDollars || right.obligatedAmount || 0) - (left.liveAward?.awardAmountDollars || left.obligatedAmount || 0);
      if (filters.capSort === "portfolio") return left.portfolio.localeCompare(right.portfolio) || left.title.localeCompare(right.title);
      if (filters.capSort === "company") return left.party.localeCompare(right.party) || left.title.localeCompare(right.title);
      const leftDate = relevantDate(left, asOf);
      const rightDate = relevantDate(right, asOf);
      const leftPast = leftDate < asOf;
      const rightPast = rightDate < asOf;
      if (leftPast !== rightPast) return Number(leftPast) - Number(rightPast);
      return leftPast ? rightDate.localeCompare(leftDate) : leftDate.localeCompare(rightDate);
    });
  }, [asOf, dispositions.tombstonedIds, enriched, filters, management.watchedIds, timelineEndYear, timelineStartYear]);

  const visible = filtered.slice(0, filters.capRows === "all" ? filtered.length : Number(filters.capRows));
  const selected = enriched.find((record) => record.opportunityId === selectedId) || null;
  const selectedLiveAward = selected ? awardMap.get(String(selected.reference || "").toUpperCase()) : null;
  const selectedActions = actionDataset?.byOpportunity?.[selectedId] || [];
  const resolvedActionState = actionDataset ? "ready" : actionState === "error" ? "error" : "loading";
  const parentRelations = selected?.parentReference
    ? enriched.filter((record) => record.opportunityId !== selected.opportunityId && record.parentReference === selected.parentReference).slice(0, 8)
    : [];
  const vehicleRelations = selected?.vehicle
    ? enriched.filter((record) => record.opportunityId !== selected.opportunityId && record.vehicle === selected.vehicle && !parentRelations.some((related) => related.opportunityId === record.opportunityId)).slice(0, 8)
    : [];
  const followOnRelations = selected ? followOnByOpportunity[selected.opportunityId] || [] : [];

  function setSelectedId(nextId) {
    setSelectedIdState(nextId);
    const [route] = window.location.hash.split("?");
    const params = new URLSearchParams(window.location.hash.split("?")[1] || "");
    if (nextId) params.set("capRecord", nextId);
    else params.delete("capRecord");
    const query = params.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}${route}${query ? `?${query}` : ""}`);
  }

  function toggleComparison(opportunityId) {
    setComparisonIds((current) => {
      if (current.includes(opportunityId)) {
        setCompareNotice("");
        return current.filter((id) => id !== opportunityId);
      }
      if (current.length >= 4) {
        setCompareNotice("Comparison is limited to four records. Remove one before adding another.");
        return current;
      }
      setCompareNotice("");
      return [...current, opportunityId];
    });
  }

  function saveCurrentView() {
    const primary = filters.capQuery
      ? `Search: ${filters.capQuery}`
      : parseMultiValues(filters.capPortfolio).length
        ? parseMultiValues(filters.capPortfolio).join(", ")
        : parseMultiValues(filters.capParty).length
          ? parseMultiValues(filters.capParty).join(", ")
          : `Transaction view ${savedViews.length + 1}`;
    const savedAt = new Date().toISOString();
    setSavedViews((current) => [{ id: `view-${Date.now()}`, name: primary, savedAt, filters: { ...filters } }, ...current].slice(0, 8));
  }

  function applyChartFilter(next) {
    setFilters(next);
    window.requestAnimationFrame(() => document.querySelector("[data-capture-timeline]")?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }

  function toggleRowField(field) {
    const current = selectedFieldIds(filters.capFields);
    const next = current.includes(field) ? current.filter((item) => item !== field) : [...current, field];
    if (next.length > MAX_ROW_FIELDS) return;
    setFilters({ capFields: next.length ? next.join(",") : "none" });
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
    if (!(parseMultiValues(filters.capFeed).includes("fpds") || selected?.transactionSummary?.actions) || actionDataset || actionRequestRef.current) return;
    setActionState("loading");
    const request = fetch(`${import.meta.env.BASE_URL}data/capture-transactions.json`)
      .then((response) => {
        if (!response.ok) throw new Error(`Transaction payload returned ${response.status}`);
        return response.json();
      })
      .then((payload) => {
        if (payload.metadata?.actionCount !== dataset.metadata.coverage.fpdsActions) throw new Error("Transaction payload coverage mismatch");
        setActionDataset(payload);
        setActionState("ready");
      })
      .catch(() => setActionState("error"))
      .finally(() => { actionRequestRef.current = null; });
    actionRequestRef.current = request;
  }, [actionDataset, actionLoadAttempt, dataset.metadata.coverage.fpdsActions, filters.capFeed, selected]);

  useEffect(() => {
    if (!(parseMultiValues(filters.capFeed).includes("subawards") || selected?.subawardSummary?.reportedCount) || subawardDetails || subawardRequestRef.current) return;
    setSubawardDetailState("loading");
    const request = fetch(`${import.meta.env.BASE_URL}data/usaspending-subaward-details.json`)
      .then((response) => {
        if (!response.ok) throw new Error(`Subaward detail payload returned ${response.status}`);
        return response.json();
      })
      .then((payload) => {
        if (Number(payload.metadata?.retainedDetailCount || 0) !== Number(subawardSnapshot.metadata?.retainedDetailCount || 0)) throw new Error("Subaward detail coverage mismatch");
        setSubawardDetails(payload);
        setSubawardDetailState("ready");
      })
      .catch(() => setSubawardDetailState("error"))
      .finally(() => { subawardRequestRef.current = null; });
    subawardRequestRef.current = request;
  }, [filters.capFeed, selected, subawardDetails, subawardSnapshot.metadata?.retainedDetailCount]);
  const totals = filtered.reduce((summary, record) => ({
    obligated: summary.obligated + Number(record.liveAward?.awardAmountDollars || record.obligatedAmount || 0),
    potential: summary.potential + Number(record.potentialAmount || record.valueHigh || 0),
    matched: summary.matched + Number(Boolean(record.liveAward)),
    sourced: summary.sourced + Number(record.sourceUrls.length > 0),
    actions: summary.actions + Number(record.transactionSummary?.actions || 0),
    fundingActions: summary.fundingActions + Number(record.transactionSummary?.fundingActions || 0),
    deobligationActions: summary.deobligationActions + Number(record.transactionSummary?.deobligationActions || 0),
    subawards: summary.subawards + Number(record.subawardSummary?.reportedCount || 0),
    subawardAmount: summary.subawardAmount + Number(record.subawardSummary?.sampledAmount || 0),
    endingWithinYear: summary.endingWithinYear + Number(Boolean(record.currentEnd && record.currentEnd >= asOf && dateDiffDays(asOf, record.currentEnd) <= 365)),
  }), { obligated: 0, potential: 0, matched: 0, sourced: 0, actions: 0, fundingActions: 0, deobligationActions: 0, subawards: 0, subawardAmount: 0, endingWithinYear: 0 });

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
  const relationshipGroups = new Map();
  for (const record of filtered) {
    const kind = record.parentReference ? "parent" : record.vehicle ? "vehicle" : null;
    const relationship = record.parentReference || record.vehicle;
    if (!kind || !relationship) continue;
    const key = `${kind}|${relationship}`;
    const current = relationshipGroups.get(key) || { id: key, kind, relationship, label: relationship, value: 0, obligations: 0 };
    current.value += 1;
    current.obligations += recordObligations(record);
    relationshipGroups.set(key, current);
  }
  const relationshipRows = [...relationshipGroups.values()]
    .filter((row) => row.value > 1)
    .map((row) => ({ ...row, helper: `${row.kind === "parent" ? "Exact parent" : "Published vehicle"} · ${formatMoney(row.obligations)} observed obligations` }))
    .sort((left, right) => right.value - left.value || right.obligations - left.obligations)
    .slice(0, 10);
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
  const displaySettings = new Set(["capSort", "capRows", "capDensity", "capGroup", "capLabels", "capFields", "capFeed"]);
  const activeFilters = Object.entries(filters).filter(([key, value]) => !displaySettings.has(key) && value !== FILTER_DEFAULTS[key]).length;
  const selectedFeeds = new Set(parseMultiValues(filters.capFeed));
  const feedStatusParts = [];
  if (selectedFeeds.has("structure")) feedStatusParts.push(`${dataset.metadata.coverage.awardsWithPricingType} pricing rows · ${dataset.metadata.coverage.awardsWithAwardType} award-instrument rows`);
  if (selectedFeeds.has("vehicle")) feedStatusParts.push(`${dataset.metadata.coverage.rowsWithVehicle} vehicle rows`);
  if (selectedFeeds.has("competition")) feedStatusParts.push(`${dataset.metadata.coverage.rowsWithCompetition} competition / set-aside rows`);
  if (selectedFeeds.has("work")) feedStatusParts.push(`${records.filter((record) => record.workCategory && record.workCategory !== "other-unclassified").length.toLocaleString()} classified work records · ${workCategories.length} categories`);
  if (selectedFeeds.has("provenance")) feedStatusParts.push(`${records.filter((record) => record.ingestionMethod === "automated").length.toLocaleString()} automated · ${records.filter((record) => record.ingestionMethod !== "automated").length.toLocaleString()} imported / curated`);
  if (selectedFeeds.has("changes")) feedStatusParts.push(`${Number(procurementDelta.summary?.added || 0).toLocaleString()} added · ${Number(procurementDelta.summary?.updated || 0).toLocaleString()} updated since prior snapshot`);
  if (selectedFeeds.has("fiscal")) {
    const fiscalAwardCount = dataset.records.filter((record) => record.fiscalValues?.length).length;
    const fiscalObservationCount = dataset.records.reduce((sum, record) => sum + (record.fiscalValues?.length || 0), 0);
    feedStatusParts.push(`${fiscalObservationCount} FY observations across ${fiscalAwardCount} awards`);
  }
  if (selectedFeeds.has("fpds")) feedStatusParts.push(actionDataset ? `${dataset.metadata.coverage.fpdsActions.toLocaleString()} exact FPDS actions loaded` : actionState === "error" ? "FPDS overlay unavailable" : "Loading FPDS action feed…");
  if (selectedFeeds.has("subawards")) feedStatusParts.push(subawardSnapshot.metadata?.status === "unavailable" ? "Subaward feed unavailable" : subawardDetailState === "error" ? "Subaward summaries loaded · recent detail unavailable" : `${Number(subawardSnapshot.metadata?.reportedSubawardCount || 0).toLocaleString()} reported subawards · ${Number(subawardSnapshot.metadata?.primeWithSubawardsCount || 0).toLocaleString()} indexed primes${subawardDetails ? " · recent detail loaded" : " · loading recent detail…"}`);
  const feedStatusText = feedStatusParts.length ? feedStatusParts.join(" · ") : "Reported schedule remains the baseline";
  const showLegacyTransactionExtras = false;
  const transactionMetrics = [
    { id: "records", label: "Matching records", value: filtered.length.toLocaleString(), meta: `${filtered.filter((record) => record.mode === "contract-performance").length} contracts · ${filtered.filter((record) => record.ingestionMethod === "automated").length} automated`, tone: "info" },
    { id: "obligations", label: "Observed obligations", value: formatMoney(totals.obligated), meta: `${totals.matched} refreshed award-bundle matches`, tone: "success" },
    { id: "potential", label: "Potential / high value", value: formatMoney(totals.potential), meta: "Reported potential values and published ranges", tone: "purple" },
    { id: "evidence", label: "Evidence coverage", value: `${Math.round((totals.sourced / Math.max(filtered.length, 1)) * 100)}%`, meta: `${totals.sourced} rows with external sources`, tone: "warning" },
    { id: "fpds", label: "FPDS actions", value: totals.actions.toLocaleString(), meta: `${totals.fundingActions.toLocaleString()} funding · ${totals.deobligationActions.toLocaleString()} deobligation`, tone: "success" },
    { id: "subawards", label: "Subawards", value: totals.subawards.toLocaleString(), meta: `${formatMoney(totals.subawardAmount)} retained-detail sample · exact prime IDs`, tone: "purple" },
    { id: "endpoints", label: "Near-term endpoints", value: totals.endingWithinYear.toLocaleString(), meta: `Reported current ends within 12 months of ${formatDate(asOf)}`, tone: "warning" },
  ];

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

  const ganttControlGroups = <div className="capture-gantt-tools__grid">
    <fieldset className="capture-gantt-toolgroup capture-gantt-toolgroup--time">
      <legend>Time</legend>
      <button type="button" onClick={scrollTimelineToToday} disabled={asOf < `${timelineStartYear}-01-01` || asOf > `${timelineEndYear}-12-31`}>Center on {monthYear(asOf)}</button>
      <div className="capture-gantt-window" aria-label="Timeline windows"><button type="button" onClick={() => setFilters({ capFrom: String(Math.max(2023, Number(asOf.slice(0, 4)) - 1)), capTo: String(Math.min(2034, Number(asOf.slice(0, 4)) + 2)) })}>Current</button><button type="button" onClick={() => setFilters({ capFrom: String(Math.max(2023, Number(asOf.slice(0, 4)) - 3)), capTo: String(Math.min(2034, Number(asOf.slice(0, 4)) + 3)) })}>7 year</button><button type="button" onClick={() => setFilters({ capFrom: "2023", capTo: "2034" })}>All</button></div>
    </fieldset>
    <fieldset className="capture-gantt-toolgroup capture-gantt-toolgroup--display">
      <legend>Display</legend>
      <SingleSelectFilter title="Density" ariaLabel="Row density" value={filters.capDensity} options={[["comfortable", "Comfortable"], ["compact", "Compact"]]} onChange={(capDensity) => setFilters({ capDensity })} />
      <SingleSelectFilter title="Group" ariaLabel="Grouping" value={filters.capGroup} options={GROUP_BY_OPTIONS} onChange={(capGroup) => setFilters({ capGroup })} />
      <SingleSelectFilter title="Bar text" ariaLabel="Bar labels" value={filters.capLabels} options={[["dates", "Date ranges"], ["obligations", "Observed obligations"], ["potential", "Potential / high value"], ["utilization", "Obligation ratio"], ["actions", "FPDS action count"], ["none", "No labels"]]} onChange={(capLabels) => setFilters({ capLabels })} />
      <details className="capture-gantt-fields" data-capture-field-picker>
        <summary>Row fields ({selectedFieldIds(filters.capFields).length})</summary>
        <div role="group" aria-label="Visible Gantt row fields"><p>Choose up to four fields. Full detail remains available on hover or focus.</p>{ROW_FIELD_OPTIONS.map(([id, text]) => { const activeFields = selectedFieldIds(filters.capFields); const checked = activeFields.includes(id); return <label key={id}><input type="checkbox" checked={checked} disabled={!checked && activeFields.length >= MAX_ROW_FIELDS} onChange={() => toggleRowField(id)} /><span>{text}</span></label>; })}</div>
      </details>
    </fieldset>
    <fieldset className="capture-gantt-toolgroup capture-gantt-toolgroup--data">
      <legend>Data</legend>
      <SearchMultiSelect title="Overlays" allLabel="Schedule only" value={filters.capFeed} options={FEED_OPTIONS} maxSelected={11} onChange={(values) => setFilters({ capFeed: serializeMultiValues(values, "none") })} />
      <span className="capture-gantt-feed-status" role="status">{feedStatusText}</span>
    </fieldset>
  </div>;

  return (
    <div className="capture-page" data-capture-calendar-page data-transaction-analytics-page>
      <ControlWorkbenchHeader eyebrow={embedded ? "Spend intelligence" : "Transaction intelligence"} title={embedded ? "Spend Explorer" : "Transactions"} summary={embedded ? "Timeline, records, and charts share one public-data scope." : "Award actions, obligations, reported performance, acquisition events, recipients, buyers, and evidence."} meta={<span className="capture-hero__boundary"><ShieldCheck size={15} aria-hidden="true" /><strong>{records.length.toLocaleString()} public records</strong><span>{dataset.metadata.coverage.publicRows} normalized source rows · {records.filter((record) => record.ingestionMethod === "automated").length.toLocaleString()} automatic feed additions · SAM.gov {samOpportunities.metadata?.status || "unavailable"}</span></span>} metrics={transactionMetrics} metricLabel="Filtered transaction metrics" mobileScrollMetrics compactMobileMetrics tabs={embeddedTabs} actions={<div className="capture-hero__actions">
          <button type="button" onClick={copyLink}><Copy size={15} />Copy filtered link</button>
          <button type="button" onClick={() => downloadCsv(filtered, dataset.metadata)}><Download size={15} />Export {filtered.length.toLocaleString()} rows</button>
          <button type="button" onClick={saveCurrentView}><Bookmark size={15} />Save view</button>
        </div>} />

      <SavedViews
        views={savedViews}
        onLoad={(view) => setFilters(normalizeSavedFilters(view.filters))}
        onDelete={(viewId) => setSavedViews((current) => current.filter((view) => view.id !== viewId))}
      />

      <section className={`capture-filters${filtersExpanded ? " is-expanded" : ""}`} data-capture-filters>
        <div className="capture-filters__heading"><Filter size={17} /><strong>Filter transactions</strong><span>{activeFilters ? `${activeFilters} active` : "All public records"}</span><button type="button" className="capture-filter-toggle" onClick={() => setFiltersExpanded((value) => !value)}>{filtersExpanded ? "Show core filters" : "Show 20 more filters"}</button>{activeFilters ? <button type="button" onClick={() => setFilters(FILTER_DEFAULTS)}>Reset</button> : null}</div>
        {filtersExpanded ? <div className="capture-quickviews" aria-label="Transaction analytical presets">
          <span>Analytical presets</span>
          <button type="button" onClick={() => setFilters({ ...FILTER_DEFAULTS, capMode: "contract-performance", capHorizon: "active", capFrom: "2025", capTo: "2030" })}>Active terms</button>
          <button type="button" onClick={() => setFilters({ ...FILTER_DEFAULTS, capMode: "contract-performance", capHorizon: "ending12", capFrom: "2026", capTo: "2028" })}>Ending in 12 months</button>
          <button type="button" onClick={() => setFilters({ ...FILTER_DEFAULTS, capMode: "acquisition-window", capFrom: "2026", capTo: "2029" })}>Acquisition horizon</button>
          <button type="button" onClick={() => setFilters({ ...FILTER_DEFAULTS, capActivity: "recent", capSort: "obligations", capFrom: "2025", capTo: "2030" })}>Recent funding movement</button>
          <button type="button" onClick={() => setFilters({ ...FILTER_DEFAULTS, capValidation: "unresolved" })}>Evidence gaps</button>
        </div> : null}
        <label className="capture-filter capture-filter--search"><span>Search</span><i><Search size={15} /><input value={filters.capQuery} onChange={(event) => setFilters({ capQuery: event.target.value })} placeholder="Program, company, reference, buyer" /></i></label>
        <SingleSelectFilter className="capture-filter--core-secondary" title="Tracking" value={filters.capTracked} options={[["all", "All records"], ["tracked", `Tracked only (${management.watchlist.length})`]]} onChange={(capTracked) => setFilters({ capTracked })} />
        <SearchMultiSelect className="capture-filter--core-secondary" title="Portfolio" allLabel="All portfolios" value={filters.capPortfolio} options={portfolios} onChange={(values) => setFilters({ capPortfolio: serializeMultiValues(values) })} />
        <SingleSelectFilter className="capture-filter--core-secondary" title="Record type" value={filters.capMode} options={[["all", "All records"], ["contract-performance", "Contract performance"], ["acquisition-window", "Acquisition windows"]]} onChange={(capMode) => setFilters({ capMode })} />
        <SearchMultiSelect className="capture-filter--advanced" title="Evidence" allLabel="All evidence" value={filters.capEvidence} options={evidenceTiers.map((tier) => [tier, label(tier)])} onChange={(values) => setFilters({ capEvidence: serializeMultiValues(values) })} />
        <SearchMultiSelect className="capture-filter--advanced" title="Lifecycle" allLabel="All lifecycle states" value={filters.capLifecycle} options={lifecycleStates.map((status) => [status, label(status)])} onChange={(values) => setFilters({ capLifecycle: serializeMultiValues(values) })} />
        <SearchMultiSelect className="capture-filter--advanced" title="Company / sponsor" allLabel="All companies and sponsors" value={filters.capParty} options={parties} onChange={(values) => setFilters({ capParty: serializeMultiValues(values) })} />
        <SearchMultiSelect className="capture-filter--advanced" title="Funding / contracting office" allLabel="All offices" value={filters.capOffice} options={offices} onChange={(values) => setFilters({ capOffice: serializeMultiValues(values) })} />
        <SearchMultiSelect className="capture-filter--advanced" title="Vehicle" allLabel="All published vehicles" value={filters.capVehicle} options={vehicles} onChange={(values) => setFilters({ capVehicle: serializeMultiValues(values) })} />
        <SearchMultiSelect className="capture-filter--advanced" title="Technology area" allLabel="All technology areas" value={filters.capTech} options={technologyAreas.map((area) => [area.id, area.label])} onChange={(values) => setFilters({ capTech: serializeMultiValues(values) })} />
        <SearchMultiSelect className="capture-filter--advanced" title="Type of work" allLabel="All work categories" value={filters.capWork} options={workCategories.map((category) => [category.id, category.label])} onChange={(values) => setFilters({ capWork: serializeMultiValues(values) })} />
        <SearchMultiSelect className="capture-filter--advanced" title="DoW branch" allLabel="All DoW branches" value={filters.capOrgBranch} options={organizationBranches} onChange={(values) => setFilters({ capOrgBranch: serializeMultiValues(values), capOrgComponent: "all", capOrgOffice: "all" })} />
        <SearchMultiSelect className="capture-filter--advanced" title="Service / component" allLabel="All services and components" value={filters.capOrgComponent} options={organizationComponents} onChange={(values) => setFilters({ capOrgComponent: serializeMultiValues(values), capOrgOffice: "all" })} />
        <SearchMultiSelect className="capture-filter--advanced" title="Buying office" allLabel="All published offices" value={filters.capOrgOffice} options={organizationOffices} onChange={(values) => setFilters({ capOrgOffice: serializeMultiValues(values) })} />
        <SearchMultiSelect className="capture-filter--advanced" title="Ingestion provenance" allLabel="All ingestion methods" value={filters.capOrigin} options={ingestionMethods.map((method) => [method.id, method.label])} onChange={(values) => setFilters({ capOrigin: serializeMultiValues(values) })} />
        <SingleSelectFilter className="capture-filter--advanced" title="Changed since refresh" value={filters.capChange} options={[["all", "Any change status"], ["added", "Added"], ["updated", "Updated"], ["unchanged", "No detected change"]]} onChange={(capChange) => setFilters({ capChange })} />
        <SingleSelectFilter className="capture-filter--advanced" title="Validation" value={filters.capValidation} options={[["all", "All validation states"], ["verified", "Verified"], ["corrected", "Corrected"], ["unresolved", "Unresolved"]]} onChange={(capValidation) => setFilters({ capValidation })} />
        <SingleSelectFilter className="capture-filter--core-secondary" title="Schedule horizon" value={filters.capHorizon} options={[["all", "Any schedule posture"], ["active", "Active reported term"], ["ending12", "Ending within 12 months"], ["ending24", "Ending within 24 months"], ["upcoming", "Future starts / milestones"], ["past", "All endpoints passed"], ["undated", "Schedule not published"]]} onChange={(capHorizon) => setFilters({ capHorizon })} />
        <SingleSelectFilter className="capture-filter--advanced" title="FPDS activity" value={filters.capActivity} options={[["all", "Any action posture"], ["recent", "Action in past 12 months"], ["funding", "Has funding actions"], ["deobligation", "Has deobligations"], ["no-actions", "No exact action history"]]} onChange={(capActivity) => setFilters({ capActivity })} />
        <SingleSelectFilter className="capture-filter--advanced" title="Subaward activity" value={filters.capSubaward} options={[["all", "Any subaward posture"], ["has", "Has reported subawards"], ["recent", "Subaward action in past 12 months"], ["none", "No reported subawards"]]} onChange={(capSubaward) => setFilters({ capSubaward })} />
        <SingleSelectFilter className="capture-filter--advanced" title="From year" value={filters.capFrom} options={Array.from({ length: 12 }, (_value, index) => String(2023 + index))} onChange={(capFrom) => setFilters({ capFrom })} />
        <SingleSelectFilter className="capture-filter--advanced" title="Through year" value={filters.capTo} options={Array.from({ length: 12 }, (_value, index) => String(2023 + index))} onChange={(capTo) => setFilters({ capTo })} />
        <SingleSelectFilter className="capture-filter--advanced" title="Minimum value" value={filters.capMin} options={[["all", "Any published value"], ["1m", "$1M+"], ["10m", "$10M+"], ["50m", "$50M+"], ["100m", "$100M+"], ["500m", "$500M+"]]} onChange={(capMin) => setFilters({ capMin })} />
        <SingleSelectFilter className="capture-filter--advanced" title="Sort" value={filters.capSort} options={[["soonest", "Soonest start / milestone"], ["added", "Recently added"], ["technology", "Technology area"], ["organization", "DoW hierarchy"], ["value", "Highest potential / value"], ["obligations", "Highest obligations"], ["portfolio", "Portfolio"], ["company", "Company / sponsor"]]} onChange={(capSort) => setFilters({ capSort })} />
        <SingleSelectFilter className="capture-filter--advanced" title="Timeline rows" value={filters.capRows} options={[["25", "25 rows"], ["50", "50 rows"], ["100", "100 rows"], ["all", "All rows"]]} onChange={(capRows) => setFilters({ capRows })} />
      </section>

      {compareNotice ? <p className="capture-compare-notice" role="status">{compareNotice}</p> : null}
      <ComparisonTray records={comparisonRecords} startYear={timelineStartYear} endYear={timelineEndYear} onOpen={setSelectedId} onRemove={toggleComparison} onClear={() => { setComparisonIds([]); setCompareNotice(""); }} />

      {selected ? (
        <ControlDrawer open onClose={() => setSelectedId("")} title={selected.title} header={<ControlRecordHeader eyebrow={selected.id} title={selected.title} summary="Published transaction, schedule, procurement, and provenance evidence." status={<ControlStatusBadge status={selected.lifecycleStatus || "active"} />} meta={[{ label: "Portfolio", value: selected.portfolio }, { label: "Recipient", value: selected.party || "Not published" }, { label: "Reference", value: selected.reference || "Not published" }]} actions={<div className="capture-detail__heading-actions"><button type="button" className={management.watchedIds.has(selected.opportunityId) ? "is-active is-starred" : ""} aria-pressed={management.watchedIds.has(selected.opportunityId)} onClick={() => management.toggleWatch(selected.opportunityId)} aria-label={management.watchedIds.has(selected.opportunityId) ? "Stop tracking this record" : "Track this record"}><Star size={17} fill={management.watchedIds.has(selected.opportunityId) ? "currentColor" : "none"} />{management.watchedIds.has(selected.opportunityId) ? "Tracked" : "Track"}</button><button type="button" className={comparisonIds.includes(selected.opportunityId) ? "is-active" : ""} onClick={() => toggleComparison(selected.opportunityId)} aria-label={comparisonIds.includes(selected.opportunityId) ? "Remove from comparison" : "Add to comparison"}><GitCompareArrows size={17} />{comparisonIds.includes(selected.opportunityId) ? "Compared" : "Compare"}</button></div>} />} size="wide" closeLabel="Close record details" drawerProps={{ "data-capture-detail-modal": "" }}>
          <DetailPanel record={selected} liveAward={selectedLiveAward} actions={selectedActions} actionState={resolvedActionState} onRetryActions={() => { setActionState("idle"); setActionDataset(null); setActionLoadAttempt((value) => value + 1); }} parentRelations={parentRelations} vehicleRelations={vehicleRelations} followOnRelations={followOnRelations} onSelectRelated={setSelectedId} />
        </ControlDrawer>
      ) : null}

      <section className="capture-section capture-gantt-section">
        <div className="capture-section__heading capture-gantt-heading"><div><CalendarClock size={18} /><span><strong>Award performance, acquisition events, and transaction overlays</strong><small>{visible.length.toLocaleString()} of {filtered.length.toLocaleString()} filtered rows · {followOnLinkCount} published or curated predecessor links · hover only actual timeline marks for contextual evidence</small></span></div><span className="capture-legend"><i className="base" />Reported term<i className="potential" />Potential<i className="window" />Published window<i className="solicitation" />Solicitation open<i className="milestone" />Milestone{parseMultiValues(filters.capFeed).includes("fpds") ? <><i className="action" />FPDS action</> : null}{parseMultiValues(filters.capFeed).includes("subawards") ? <><i className="subaward" />Subaward action</> : null}{parseMultiValues(filters.capFeed).includes("fiscal") ? <><i className="fiscal" />FY obligation intensity</> : null}{parseMultiValues(filters.capFeed).includes("awards") ? <><i className="award" />Refreshed end</> : null}{parseMultiValues(filters.capFeed).includes("followon") ? <><i className="followon" />Follow-on activity</> : null}{parseMultiValues(filters.capFeed).includes("competition") ? <><i className="competition" />Competition</> : null}{parseMultiValues(filters.capFeed).includes("vehicle") ? <><i className="vehicle" />Vehicle</> : null}{parseMultiValues(filters.capFeed).includes("structure") ? <><i className="pricing-fixed-price" />FFP<i className="pricing-cost-reimbursable" />Cost type<i className="pricing-time-materials" />T&amp;M</> : null}{parseMultiValues(filters.capFeed).includes("work") ? <><i className="work" />Work category</> : null}{parseMultiValues(filters.capFeed).includes("provenance") ? <><i className="provenance" />Import source</> : null}{parseMultiValues(filters.capFeed).includes("changes") ? <><i className="change" />Changed</> : null}</span></div>
        {isMobileViewport ? <>
          <div className="capture-gantt-tools" data-capture-gantt-tools>
            <button type="button" className="capture-gantt-tools__mobile-trigger" data-capture-gantt-mobile-trigger onClick={() => setGanttToolsOpen(true)}><span>Timeline controls</span><small>Time · display · overlays</small></button>
          </div>
          {ganttToolsOpen ? <ControlDialog open onClose={() => setGanttToolsOpen(false)} title="Timeline controls" eyebrow="Transactions" summary="Adjust the visible time window, row density, grouping, labels, and evidence overlays." size="wide" closeLabel="Close Timeline controls" surfaceProps={{ "data-capture-gantt-dialog": true }} footer={<button type="button" className="if-btn if-btn--primary" onClick={() => setGanttToolsOpen(false)}>Done</button>}>
            <div className="capture-gantt-tools capture-gantt-tools--dialog">{ganttControlGroups}</div>
          </ControlDialog> : null}
        </> : <details className="capture-gantt-tools" data-capture-gantt-tools>
          <summary><span>Timeline controls</span><small>Time · display · overlays</small></summary>
          {ganttControlGroups}
        </details>}
        {visible.length ? <CaptureTimeline records={visible} startYear={timelineStartYear} endYear={timelineEndYear} selectedId={selectedId} onSelect={setSelectedId} asOf={asOf} density={filters.capDensity} groupBy={filters.capGroup} labelMode={filters.capLabels} rowFields={filters.capFields} feedMode={filters.capFeed} actionsByOpportunity={actionDataset?.byOpportunity || {}} followOnByOpportunity={followOnByOpportunity} watchedIds={management.watchedIds} onToggleWatch={management.toggleWatch} /> : <CaptureEmpty title="No matching transactions" message="Adjust or clear filters to restore public transaction records." />}
      </section>

      {showLegacyTransactionExtras ? <><details className="capture-analytics-disclosure" data-capture-analytics-disclosure>
        <summary><span><BarChart3 size={17} aria-hidden="true" /><b>More transaction analytics</b><small>13 descriptive charts and the portfolio lifecycle matrix</small></span><a href="#/budget-spend/explorer?spendView=charts">Open charts</a></summary>
        <div className="capture-dashboard-grid">
        <section className="capture-section"><div className="capture-section__heading"><div><BarChart3 size={18} /><span><strong>Portfolio concentration</strong><small>Select a bar to drive the Gantt</small></span></div></div><BarList rows={portfolioRows} testId="portfolio" onSelect={(row) => applyChartFilter({ capPortfolio: row.id })} selectedId={filters.capPortfolio} /></section>
        <section className="capture-section"><div className="capture-section__heading"><div><BarChart3 size={18} /><span><strong>Observed company obligations</strong><small>Select a company to drive the Gantt</small></span></div></div><BarList rows={partyRows} format={formatMoney} testId="company-money" onSelect={(row) => applyChartFilter({ capParty: row.id })} selectedId={filters.capParty} /></section>
        <section className="capture-section"><div className="capture-section__heading"><div><CalendarClock size={18} /><span><strong>Calendar density</strong><small>Select a year to focus the timeline</small></span></div></div><BarList rows={yearRows} testId="year-density" onSelect={(row) => applyChartFilter({ capFrom: String(row.id), capTo: String(row.id) })} /></section>
        <section className="capture-section"><div className="capture-section__heading"><div><CheckCircle2 size={18} /><span><strong>Evidence distribution</strong><small>Select a tier to drive the Gantt</small></span></div></div><BarList rows={evidenceRows} testId="evidence" onSelect={(row) => applyChartFilter({ capEvidence: row.id })} selectedId={filters.capEvidence} /></section>
        <section className="capture-section"><div className="capture-section__heading"><div><BarChart3 size={18} /><span><strong>FPDS annual net obligations</strong><small>Select a fiscal year to focus the timeline</small></span></div></div>{fiscalRows.length ? <BarList rows={fiscalRows} format={formatMoney} testId="fiscal-obligations" onSelect={(row) => applyChartFilter({ capFrom: String(row.id), capTo: String(row.id) })} /> : <CaptureEmpty title="No annual obligations" message="No annual obligation series match the current filters." />}</section>
        <section className="capture-section"><div className="capture-section__heading"><div><BarChart3 size={18} /><span><strong>Value posture</strong><small>Observed obligations compared with potential / published high values</small></span></div></div><BarList rows={moneyRows} format={formatMoney} testId="value-posture" /></section>
        <section className="capture-section"><div className="capture-section__heading"><div><CalendarClock size={18} /><span><strong>FPDS action volume</strong><small>Select a fiscal year to focus the timeline</small></span></div></div>{actionRows.length ? <BarList rows={actionRows} testId="action-volume" onSelect={(row) => applyChartFilter({ capFrom: String(row.id), capTo: String(row.id) })} /> : <CaptureEmpty title="No action history" message="No FPDS action history matches the current filters." />}</section>
        <section className="capture-section"><div className="capture-section__heading"><div><BarChart3 size={18} /><span><strong>Funding action direction</strong><small>Select funding or deobligation activity</small></span></div></div>{actionDirectionRows.length ? <BarList rows={actionDirectionRows} testId="action-direction" onSelect={(row) => row.id !== "non-obligation" && applyChartFilter({ capActivity: row.id })} selectedId={filters.capActivity} /> : <CaptureEmpty title="No funding actions" message="No funding or deobligation actions match the current filters." />}</section>
        <section className="capture-section"><div className="capture-section__heading"><div><CalendarClock size={18} /><span><strong>Eight-quarter event timeline</strong><small>Select a quarter to focus the timeline</small></span></div></div><QuarterOutlook rows={quarterRows} onSelect={(row) => applyChartFilter({ capFrom: row.id.slice(0, 4), capTo: row.id.slice(0, 4) })} /></section>
        <section className="capture-section"><div className="capture-section__heading"><div><BarChart3 size={18} /><span><strong>Obligation versus reported headroom</strong><small>Select an instrument to open its evidence</small></span></div></div>{headroomRows.length ? <StackedMoneyList rows={headroomRows} onSelect={(row) => setSelectedId(row.id)} /> : <CaptureEmpty title="No comparable values" message="No obligation and potential-value pairs match the current filters." />}</section>
        <section className="capture-section"><div className="capture-section__heading"><div><BarChart3 size={18} /><span><strong>Buying office exposure</strong><small>Select an office to drive the Gantt</small></span></div></div>{officeRows.length ? <BarList rows={officeRows} format={formatMoney} testId="office-money" onSelect={(row) => applyChartFilter({ capOffice: row.id })} selectedId={filters.capOffice} /> : <CaptureEmpty title="No office exposure" message="No office-linked obligations match the current filters." />}</section>
        <section className="capture-section"><div className="capture-section__heading"><div><CalendarClock size={18} /><span><strong>Reported term duration</strong><small>Current performance periods at contract grain</small></span></div></div>{durationBuckets.length ? <BarList rows={durationBuckets} testId="duration" /> : <CaptureEmpty title="No reported durations" message="No contract durations match the current filters." />}</section>
        <section className="capture-section"><div className="capture-section__heading"><div><Network size={18} /><span><strong>Contract family and vehicle relationships</strong><small>Repeated exact parents or published vehicle labels</small></span></div></div>{relationshipRows.length ? <BarList rows={relationshipRows} testId="relationships" onSelect={(row) => applyChartFilter(row.kind === "parent" ? { capQuery: row.relationship } : { capVehicle: row.relationship })} /> : <CaptureEmpty title="No repeated relationships" message="No repeated parent or vehicle relationships match the current filters." />}</section>
        </div>

        <section className="capture-section">
          <div className="capture-section__heading"><div><BarChart3 size={18} /><span><strong>Portfolio by lifecycle heatmap</strong><small>Top portfolios across the filtered calendar states</small></span></div></div>
          <LifecycleMatrix records={filtered} portfolios={matrixPortfolios} onSelect={(portfolio, lifecycle) => applyChartFilter({ capPortfolio: portfolio, capLifecycle: lifecycle })} />
        </section>
      </details>

      <section className="capture-methodology">
        <ChevronDown size={17} aria-hidden="true" />
        <div><strong>Measurement and publication boundary</strong><p>Dates describe reported performance or published acquisition events. They do not establish recompete dates. USAspending prime-award totals, FPDS actions, and USAspending subawards are separate measures and are never added together. Subawards join only through the exact generated prime-award ID; capped detail lists are labeled. Supporting-instrument actions remain separately labeled. Internal campaign fields, target mappings, access labels, proposed work packages, scores, recommendations, and analyst workboard state are excluded from this analytical surface.</p></div>
      </section>
      </> : null}
    </div>
  );
}
