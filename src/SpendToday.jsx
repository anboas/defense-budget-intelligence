import { useMemo, useState } from "react";
import { AlertTriangle, CalendarClock, CircleMinus, FilePlus2, RefreshCw } from "lucide-react";
import OperationalDataTable from "./OperationalDataTable.jsx";
import ControlSelect from "./ControlSelect.jsx";

const TYPES = {
  added: { label: "New", icon: FilePlus2 },
  updated: { label: "Changed", icon: RefreshCw },
  closing: { label: "Closing soon", icon: CalendarClock },
  removed: { label: "Removed", icon: CircleMinus },
};

function readableDate(value, fallback = "Not published") {
  if (!value) return fallback;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? fallback : parsed.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

function resolveChange(change, recordsById) {
  const record = recordsById.get(String(change.opportunityId || "").toUpperCase()) || recordsById.get(String(change.sourceRecordId || "").toUpperCase());
  return {
    id: `${change.change}:${change.opportunityId || change.sourceRecordId}`,
    kind: change.change,
    title: change.title || record?.title || change.sourceRecordId || "Untitled public record",
    reference: record?.id || record?.reference || change.sourceRecordId || "Identifier not published",
    sourceSystem: change.sourceSystem || record?.sourceSystem || "Published source",
    opportunityId: record?.opportunityId || change.opportunityId || null,
    date: record?.lastChangedAt || record?.firstSeenAt || null,
    fields: change.fields || record?.changedFields || [],
  };
}

export default function SpendToday({ rows, discoveryFeed, savedViews }) {
  const [kind, setKind] = useState("all");
  const latest = discoveryFeed.history?.[0] || null;
  const recordsById = useMemo(() => {
    const map = new Map();
    rows.forEach((record) => [record.opportunityId, record.sourceRecordId, record.id, record.reference].filter(Boolean).forEach((key) => map.set(String(key).toUpperCase(), record)));
    return map;
  }, [rows]);
  const inboxRows = useMemo(() => {
    const changed = (latest?.changes || []).map((change) => resolveChange(change, recordsById));
    const changedIds = new Set(changed.map((entry) => entry.opportunityId).filter(Boolean));
    const closing = (discoveryFeed.closingSoon || []).filter((record) => !changedIds.has(record.opportunityId)).map((record) => ({
      id: `closing:${record.opportunityId || record.sourceRecordId}`,
      kind: "closing",
      title: record.title,
      reference: record.sourceRecordId || "Identifier not published",
      sourceSystem: record.sourceSystem || "Published source",
      opportunityId: record.opportunityId,
      date: record.date,
      fields: [],
    }));
    return [...changed, ...closing].filter((entry) => TYPES[entry.kind]);
  }, [discoveryFeed.closingSoon, latest, recordsById]);
  const visibleRows = kind === "all" ? inboxRows : inboxRows.filter((entry) => entry.kind === kind);
  const coverage = discoveryFeed.metadata?.coverage || {};
  const sourceIssues = Object.entries(coverage.sources || {}).filter(([, source]) => !["current", "gaps-disclosed"].includes(source?.status));
  const columns = [
    { key: "kind", label: "Update", facet: true, minWidth: 120, value: (row) => TYPES[row.kind]?.label || row.kind, render: (row) => { const Icon = TYPES[row.kind]?.icon || RefreshCw; return <span className={`if-badge spend-today__kind spend-today__kind--${row.kind}`}><Icon size={14} />{TYPES[row.kind]?.label || row.kind}</span>; } },
    { key: "record", label: "Record", required: true, sticky: true, minWidth: 300, value: (row) => `${row.reference} ${row.title}`, render: (row) => <><strong>{row.title}</strong><small>{row.reference}</small></> },
    { key: "detail", label: "What changed", minWidth: 250, value: (row) => row.fields.map((field) => field.label).join(", "), render: (row) => row.fields.length ? <><strong>{row.fields.slice(0, 3).map((field) => field.label).join(" · ")}</strong><small>{row.fields.length > 3 ? `+${row.fields.length - 3} more fields` : "Field-level source comparison"}</small></> : <span>{row.kind === "added" ? "First observed by DBI" : row.kind === "removed" ? "No longer present in the current source scope" : row.kind === "closing" ? "Published response or performance date" : "Source record changed"}</span> },
    { key: "date", label: "Date", minWidth: 135, sortValue: (row) => row.date || "", value: (row) => row.date || "", render: (row) => readableDate(row.date) },
    { key: "source", label: "Source", facet: true, minWidth: 150, value: (row) => row.sourceSystem },
    { key: "actions", label: "Actions", role: "actions", required: true, sortable: false, render: (row) => row.opportunityId ? <a href={`#/budget-spend/explorer?spendView=timeline&capRecord=${encodeURIComponent(row.opportunityId)}`}>Open</a> : null },
  ];

  return <div className="spend-today" data-spend-today>
    {savedViews}
    <section className="spend-today__status" aria-label="Acquisition source status">
      <div><strong>{readableDate(latest?.date, "History begins after the next retained refresh")}</strong><span>{latest ? `${latest.summary.added} new · ${latest.summary.updated} changed · ${latest.summary.removed} removed` : "No retained daily comparison yet"}</span></div>
      <div><strong>{Number(coverage.knownRecords || rows.length).toLocaleString()}</strong><span>known records in the disclosed discovery scope</span></div>
      <div><strong>{sourceIssues.length}</strong><span>source issue{sourceIssues.length === 1 ? "" : "s"} requiring attention</span></div>
    </section>
    {sourceIssues.length ? <div className="if-alert if-alert--warning spend-today__source-alert" role="status"><AlertTriangle size={17} /><span><strong>Source coverage is incomplete.</strong>{sourceIssues.map(([source, value]) => `${source} ${value.status}`).join(" · ")}. No missing source is treated as an empty update.</span></div> : null}
    {latest?.truncated ? <div className="if-alert if-alert--info spend-today__source-alert" role="status"><span><strong>The compact inbox shows {(latest.changes || []).length.toLocaleString()} of {(latest.summary.added + latest.summary.updated + latest.summary.removed).toLocaleString()} daily changes.</strong><a href="#/budget-spend/explorer?spendView=table&changes=today">Open the complete daily update ledger</a></span></div> : null}
    <div className="spend-today__controls"><ControlSelect label="Inbox" value={kind} options={[{ value: "all", label: `All updates (${inboxRows.length})` }, ...Object.entries(TYPES).map(([value, item]) => ({ value, label: `${item.label} (${inboxRows.filter((row) => row.kind === value).length})` }))]} onChange={setKind} /></div>
    <OperationalDataTable id="spend-today" label="Today's acquisition inbox" rows={visibleRows} columns={columns} rowKey={(row) => row.id} defaultSort={{ key: "date", direction: "desc" }} searchPlaceholder="Search today's changes, references, and sources…" exportFilename="daily-acquisition-inbox.csv" mobileColumns={["kind", "record", "detail", "actions"]} empty="No retained updates match this inbox view. Source status remains visible above." />
    <details className="spend-today__coverage" data-acquisition-coverage>
      <summary><span><strong>Coverage and data quality</strong><small>{coverage.scope || "Coverage is disclosed by source and query boundary."}</small></span></summary>
      <div>
        <span><b>{Number(coverage.unknownHierarchy || 0).toLocaleString()}</b>Unknown hierarchy</span>
        <span><b>{Number(coverage.unclassifiedTechnology || 0).toLocaleString()}</b>Unclassified technology</span>
        <span><b>{Number(coverage.missingExactIdentifier || 0).toLocaleString()}</b>Missing exact identifier</span>
        <span><b>{Number(coverage.contractMonitor?.gapCount || 0).toLocaleString()}</b>Monitor gaps</span>
        <span><b>{Number(coverage.contractMonitor?.coveragePct || 0).toLocaleString()}%</b>Checked-record coverage</span>
        <span><b>{Number(coverage.contractMonitor?.excludedTargetCount || 0).toLocaleString()}</b>Records outside detail-monitor limit</span>
        <span><b>{Number(coverage.contractMonitor?.corpusCoveragePct || 0).toLocaleString()}%</b>Eligible-corpus detail coverage</span>
      </div>
    </details>
  </div>;
}
