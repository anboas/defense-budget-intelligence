import { useMemo, useState } from "react";
import { ArrowLeft, CalendarClock, ExternalLink } from "lucide-react";
import { ControlAsyncState, ControlAutocomplete } from "control-surface-ui/react";
import ConnectedEvidence from "./ConnectedEvidence.jsx";
import ControlWorkbenchHeader from "./WorkbenchHeader.jsx";
import { intelligenceGraphRoute, opportunityRoute, timelineRoute } from "./cross-surface-routes.js";
import { applyProcurementChanges, assembleProcurementRecords } from "./procurement-taxonomy.js";
import "./IntelligenceGraphPage.css";

function recordId(record) {
  return record?.opportunityId || record?.sourceRecordId || record?.noticeId || record?.id || record?.reference || "";
}

function updateRoot(record) {
  const id = recordId(record);
  window.location.hash = intelligenceGraphRoute(id);
}

function GraphRecordSearch({ selected, suggestions }) {
  const [query, setQuery] = useState(() => selected?.reference || selected?.noticeId || selected?.id || "");
  return <ControlAutocomplete label="Find a record" value={query} items={suggestions} minLength={1} limit={10} onChange={setQuery} onSelect={(item) => updateRoot(item.record)} placeholder="Program, company, reference, buyer" emptyText="No connected record matches" data-intelligence-graph-search />;
}

export default function IntelligenceGraphPage({ dataset, awards = [], samOpportunities = { records: [] }, manualProcurement = { records: [] }, procurementDelta = { records: [] }, subawardSnapshot = { primes: [] }, routeHash = "" }) {
  const params = new URLSearchParams(String(routeHash).split("?")[1] || "");
  const routedId = params.get("graphRecord") || params.get("capRecord") || "";
  const records = useMemo(() => applyProcurementChanges(assembleProcurementRecords(dataset?.records || [], awards, dataset?.metadata?.asOf, samOpportunities.records || [], manualProcurement.records || [], subawardSnapshot), procurementDelta.records || [], []), [awards, dataset, manualProcurement.records, procurementDelta.records, samOpportunities.records, subawardSnapshot]);
  const selected = records.find((record) => recordId(record) === routedId) || records[0] || null;
  const suggestions = useMemo(() => records.slice(0, 1600).map((record) => ({
    id: recordId(record),
    value: record.reference || record.noticeId || record.id || record.title,
    label: record.title || record.reference || record.id,
    meta: [record.reference || record.noticeId, record.party, record.contractingOffice || record.owner].filter(Boolean).join(" · "),
    type: record.mode === "acquisition-window" ? "Opportunity" : "Contract",
    record,
  })), [records]);

  return <div className="intelligence-graph-page" data-intelligence-graph-page>
    <ControlWorkbenchHeader eyebrow="Investigate connected intelligence" title="Intelligence Graph" summary="Traverse a bounded evidence neighborhood, re-root the graph on linked contract-family records, and continue into organizations, awards, classifications, accounts, or locations without losing the selected opportunity." />
    <section className="if-panel intelligence-graph-page__rail" aria-label="Intelligence Graph controls">
      <GraphRecordSearch key={recordId(selected)} selected={selected} suggestions={suggestions} />
      {selected ? <span className="if-field intelligence-graph-page__root"><small className="if-field__label">Graph root</small><strong>{selected.title || selected.reference || selected.id}</strong></span> : null}
      <div className="if-button-group intelligence-graph-page__actions">
        <a className="if-btn if-btn--secondary" href="#/budget-spend/explorer?spendView=table"><ArrowLeft size={15} />Opportunities</a>
        {selected ? <a className="if-btn if-btn--secondary" href={timelineRoute(recordId(selected))}><CalendarClock size={15} />Timeline</a> : null}
        {selected ? <a className="if-btn if-btn--secondary" href={opportunityRoute(recordId(selected))}><ExternalLink size={15} />Open Record</a> : null}
      </div>
    </section>
    {selected ? <section className="if-panel intelligence-graph-page__canvas" aria-label="Traversable evidence graph"><ConnectedEvidence key={recordId(selected)} opportunityId={recordId(selected)} record={selected} fullView /></section> : <ControlAsyncState compact state="empty" title="No intelligence record available" message="Return to Opportunities and select a retained record." />}
  </div>;
}
