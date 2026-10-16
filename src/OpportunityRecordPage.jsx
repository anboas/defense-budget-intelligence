import { ArrowLeft, ArrowRight, CalendarClock, CheckCircle2, ExternalLink, Link2, SearchCheck, Sparkles } from "lucide-react";
import { ControlAsyncState, ControlFactGrid } from "control-surface-ui/react";
import ControlWorkbenchHeader from "./WorkbenchHeader.jsx";
import ConnectedEvidence from "./ConnectedEvidence.jsx";
import OpportunityCommandRail from "./OpportunityCommandRail.jsx";
import { useManagementState } from "./management-state.js";
import { useRecordIntelligence } from "./record-intelligence.js";
import { samNoticeTypeLabel } from "./sam-notice-types.js";
import "./OpportunityRecordPage.css";

function date(value) {
  if (!value) return "Not published";
  const parsed = new Date(`${String(value).slice(0, 10)}T12:00:00Z`);
  return Number.isNaN(parsed.getTime()) ? "Not published" : parsed.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" });
}

function money(value) {
  const amount = Number(value || 0);
  if (!amount) return "Not published";
  if (Math.abs(amount) >= 1e9) return `$${(amount / 1e9).toFixed(1)}B`;
  if (Math.abs(amount) >= 1e6) return `$${(amount / 1e6).toFixed(1)}M`;
  return `$${Math.round(amount).toLocaleString()}`;
}

function recordHref(opportunityId) {
  return `#/budget-spend/explorer?spendView=record&capRecord=${encodeURIComponent(opportunityId)}`;
}

function RelationshipCard({ relationship, related, direction, onRemove }) {
  if (!related) return null;
  return <article className={`record-page__relationship is-${direction}`} data-record-relationship={relationship.relationship}>
    <span className="record-page__relationship-icon">{direction === "past" ? <ArrowLeft size={16} /> : <ArrowRight size={16} />}</span>
    <div><small>{direction === "past" ? "Predecessor / incumbent" : "Follow-on / future activity"}</small><strong>{related.title}</strong><span>{related.id || related.reference} · {relationship.relationship.replaceAll("-", " ")} · {relationship.confidence} confidence</span><p>{relationship.rationale || relationship.evidence?.[0]}</p></div>
    <div className="record-page__relationship-actions"><a className="if-btn if-btn--secondary" href={recordHref(related.opportunityId)}>Open record</a>{!relationship.automatic && onRemove ? <button type="button" onClick={() => onRemove(relationship.id)}>Remove link</button> : null}</div>
  </article>;
}

function researchTimelineHref(recordId, reportId, item) {
  const year = Number(String(item.date || "").slice(0, 4));
  const params = new URLSearchParams({ spendView: "timeline", capRecord: recordId, capResearch: reportId || "latest", capResearchDate: item.date });
  if (year) { params.set("capFrom", String(Math.max(2023, year - 1))); params.set("capTo", String(Math.min(2034, year + 1))); }
  return `#/budget-spend/explorer?${params}`;
}

function ResearchReport({ report, recordId }) {
  if (!report) return <ControlAsyncState compact state="empty" title="No AI research yet" message="Run official-source research to build a cited brief and check for predecessor or follow-on records." />;
  return <article className="record-page__research-report" data-record-research-report>
    <header><div><span>Latest research</span><strong>{report.stage || "Acquisition research"}</strong></div><small>{date(report.createdAt || report.provenance?.createdAt)} · {report.sources?.length || 0} official source{report.sources?.length === 1 ? "" : "s"}{report.provenance?.degradedRetry ? " · recovered on retry" : ""}</small></header>
    <p className="record-page__research-summary">{report.summary}</p>
    {report.decisionBrief ? <section className={`record-page__decision is-${report.decisionBrief.priority || "low"}`} data-record-decision-brief><header className="if-button-group"><CheckCircle2 size={18} /><span><small>Recommended action: </small><strong>{report.decisionBrief.recommendedAction}</strong></span><b className="if-badge if-badge--info">{report.decisionBrief.priority} priority</b></header><p>{report.decisionBrief.rationale}</p><small>{report.decisionBrief.sourceUrls.map((url, index) => <a key={url} href={url} target="_blank" rel="noreferrer">Decision source {index + 1}<ExternalLink size={12} /></a>)}</small></section> : null}
    {report.keyDates?.length ? <section><h3>Key published dates</h3><ul>{report.keyDates.map((item) => <li key={`${item.label}-${item.date}`}><strong>{item.label} · <time dateTime={item.date}>{date(item.date)}</time></strong><span>{item.basis}</span><small>{item.sourceUrls.map((url, index) => <a key={url} href={url} target="_blank" rel="noreferrer">Date source {index + 1}<ExternalLink size={12} /></a>)}<a className="record-page__timeline-link" href={researchTimelineHref(recordId, report.id, item)}><CalendarClock size={12} />Show on Timeline</a></small></li>)}</ul></section> : null}
    {report.nextActions?.length ? <section><h3>Next actions</h3><ol>{report.nextActions.map((item, index) => <li key={`${item.action}-${index}`}><strong>{item.action}</strong><span>{item.rationale}</span><small>{item.sourceUrls.map((url, sourceIndex) => <a key={url} href={url} target="_blank" rel="noreferrer">Action source {sourceIndex + 1}<ExternalLink size={12} /></a>)}</small></li>)}</ol></section> : null}
    {report.scope ? <section><h3>Published scope</h3><p>{report.scope}</p></section> : null}
    {report.incumbentPosture ? <section><h3>Incumbent and follow-on posture</h3><p>{report.incumbentPosture}</p></section> : null}
    {report.findings?.length ? <section><h3>Cited findings</h3><ul>{report.findings.map((finding, index) => <li key={`${finding.text}-${index}`}><span>{finding.text}</span><small>{finding.sourceUrls.map((url, sourceIndex) => <a key={url} href={url} target="_blank" rel="noreferrer">Source {sourceIndex + 1}<ExternalLink size={12} /></a>)}</small></li>)}</ul></section> : null}
    {report.risks?.length ? <section><h3>Risks and uncertainties</h3><ul>{report.risks.map((risk, index) => <li key={`${risk.text}-${index}`}><span>{risk.text}</span><small>{risk.sourceUrls.map((url, sourceIndex) => <a key={url} href={url} target="_blank" rel="noreferrer">Source {sourceIndex + 1}<ExternalLink size={12} /></a>)}</small></li>)}</ul></section> : null}
    {report.openQuestions?.length ? <section><h3>Questions to resolve</h3><ul>{report.openQuestions.map((question) => <li key={question}>{question}</li>)}</ul></section> : null}
    {report.caveats?.length ? <p className="record-page__caveats"><strong>Review notes:</strong> {report.caveats.join(" ")}</p> : null}
  </article>;
}

function AcquisitionPortfolioDetail({ record }) {
  const intel = record.acquisitionIntel;
  if (!intel) return null;
  const factors = Object.entries(intel.factors || {}).filter(([, value]) => value && typeof value === "object");
  return <section className="record-page__facts record-page__acquisition" data-acquisition-intelligence>
    <header><SearchCheck size={18} /><span><strong>Acquisition intelligence</strong><small>Lossless source-row detail projected into the Defense Intelligence workspace.</small></span></header>
    <ControlFactGrid label="Acquisition screening facts" mobileTwoColumn items={[
      { label: "Source / edition", value: intel.sourceName || record.portfolio, meta: [intel.sourceEdition, intel.sourceDate].filter(Boolean).join(" · ") || "Edition not published", wide: true },
      { label: "Priority / score", value: intel.priority ? `P${intel.priority}` : "Not assessed", meta: intel.score == null ? "Score not assessed" : `${intel.score}/100 rules-based screen` },
      { label: "Set-aside / route", value: intel.setaside || "Not published", meta: intel.route || "Route not assessed" },
      { label: "Organization / customer", value: intel.organization || "Not published", meta: intel.customer || "Customer not published", wide: true },
      { label: "Incumbent / counterparty", value: intel.incumbent || intel.researchCounterparty || "Not established", meta: intel.contract || "Contract reference not established", wide: true },
      { label: "Forecast timing", value: intel.rfp || "RFP not published", meta: intel.award ? `Award ${intel.award}` : "Award not published" },
      { label: "Value / period", value: intel.value || "Not published", meta: [intel.valueKind, intel.pop].filter(Boolean).join(" · ") || "Basis not published" },
      { label: "Timing evidence", value: intel.timingQuality || "Not assessed", meta: intel.timingStatus || "Status not assessed" },
    ]} />
    {factors.length ? <div className="record-page__research-report record-page__factor-grid">{factors.map(([key, factor]) => <article key={key}><small>{key}</small><strong>{factor.label || "Not assessed"}{factor.score != null ? ` · ${factor.score}/${factor.max || 40}` : ""}</strong><p>{factor.basis || "No basis published."}</p></article>)}</div> : null}
    {intel.factors?.gate ? <p className="record-page__gate"><strong>Qualification gate:</strong> {intel.factors.gate}</p> : null}
    {intel.nextAction ? <p><strong>Next action:</strong> {intel.nextAction}</p> : null}
    {intel.lineage?.length ? <div className="record-page__research-report record-page__lineage"><h3>Contract lineage</h3>{intel.lineage.map((stage, index) => <article key={`${stage.stage}-${index}`}><small>{stage.stage}</small><strong>{stage.title || stage.identifier || "Unresolved stage"}</strong><span>{[stage.identifier, stage.party, stage.status].filter(Boolean).join(" · ")}</span><p>{stage.note}</p>{stage.url ? <a href={stage.url} target="_blank" rel="noreferrer">Source evidence<ExternalLink size={12} /></a> : null}</article>)}</div> : null}
    {intel.supportingDocuments || intel.documentFindingsText ? <div className="record-page__documents"><h3>Supporting documents</h3>{intel.supportingDocuments ? <p>{intel.supportingDocuments}</p> : null}{intel.documentFindingsText ? <p>{intel.documentFindingsText}</p> : null}</div> : null}
    {intel.flags?.length ? <p className="record-page__caveats"><strong>Evidence flags:</strong> {intel.flags.join(" · ")}</p> : null}
  </section>;
}

export default function OpportunityRecordPage({ records = [], recordId = "", tabs = null }) {
  const record = records.find((candidate) => candidate.opportunityId === recordId);
  const management = useManagementState(records);
  const intelligence = useRecordIntelligence(records, recordId);
  if (!record) return <div className="record-page"><ControlWorkbenchHeader title="Record not found" description="This record is not present in the active workspace corpus." sectionNav={tabs} actions={<a className="if-btn if-btn--secondary" href="#/budget-spend/explorer?spendView=timeline">Back to Timeline</a>} /><ControlAsyncState state="empty" title="Record unavailable" message="Return to Timeline and open a current record." /></div>;
  const byId = new Map(records.map((candidate) => [candidate.opportunityId, candidate]));
  const past = intelligence.relationships.filter((relationship) => relationship.targetId === recordId).map((relationship) => ({ relationship, related: byId.get(relationship.sourceId) }));
  const future = intelligence.relationships.filter((relationship) => relationship.sourceId === recordId).map((relationship) => ({ relationship, related: byId.get(relationship.targetId) }));
  const relationshipCount = past.length + future.length;
  const lifecycleLabel = String(record.lifecycleStatus || (record.active ? "active" : "published")).replaceAll("-", " ");
  const decisionDate = record.mode === "acquisition-window" ? record.solicitationEnd : record.currentEnd;
  const importedPortfolio = record.recordKind === "acquisition-portfolio";
  const watch = management.watchlist.find((entry) => entry.recordId === recordId) || null;
  const recordMetrics = [
    { id: "status", label: "Lifecycle status", value: lifecycleLabel, meta: record.mode === "acquisition-window" ? samNoticeTypeLabel(record.noticeType) : "Active contract work" },
    { id: "date", label: importedPortfolio ? "Forecast award" : record.mode === "acquisition-window" ? "Response deadline" : "Reported current end", value: date(decisionDate), meta: importedPortfolio && record.solicitationStart ? `Forecast RFP ${date(record.solicitationStart)}` : record.potentialEnd ? `Potential through ${date(record.potentialEnd)}` : "No later date published" },
    { id: "value", label: importedPortfolio ? "Notional value" : "Observed value", value: money(importedPortfolio ? record.valueHigh : record.obligatedAmount), meta: importedPortfolio ? record.acquisitionIntel?.valueKind || "Forecast value; not additive" : record.potentialAmount ? `${money(record.potentialAmount)} potential` : "No potential value published" },
    { id: "evidence", label: "Evidence", value: record.evidenceTier || "Unclassified", meta: `${record.sourceUrls?.length || 0} retained source link${record.sourceUrls?.length === 1 ? "" : "s"}` },
  ];
  const facts = [
    { label: "Record identity", value: record.id || record.reference, meta: record.opportunityId, wide: true },
    { label: "Company / sponsor", value: record.party || "Not published", meta: record.owner || record.contractingOffice || "Organization not published", wide: true },
    { label: "PSC / NAICS", value: record.pscCode ? `PSC ${record.pscCode}` : "PSC not published", meta: record.naicsCode ? `NAICS ${record.naicsCode}` : "NAICS not published" },
    { label: "Public source", value: record.sourceSystem || record.ingestionLabel || "Published record", meta: `${record.sourceUrls?.length || 0} retained source link${record.sourceUrls?.length === 1 ? "" : "s"}` },
  ];
  return <div className="record-page" data-opportunity-record-page data-record-id={recordId}>
    <ControlWorkbenchHeader eyebrow="Opportunity record" title={record.title} summary={`${record.id || record.reference} · ${record.party || "Sponsor not published"} · ${record.owner || record.contractingOffice || "Organization not published"}`} metrics={recordMetrics} metricLabel="Record decision summary" sectionNav={tabs} actions={<a className="if-btn if-btn--secondary" href="#/budget-spend/explorer?spendView=table"><ArrowLeft size={15} />Workbench</a>} />
    <OpportunityCommandRail record={record} watch={watch} canWrite={management.canWrite} onSavePursuit={management.savePursuit} onToggleTrack={management.toggleWatch} intelligence={intelligence} showRecordLink={false} />
    <section className="record-page__lifecycle" data-record-lifecycle>
      <header><div><Link2 size={18} /><span><strong>Acquisition lifecycle</strong><small>{relationshipCount ? `${relationshipCount} source-backed relationship${relationshipCount === 1 ? "" : "s"}; every record remains independently inspectable.` : "No predecessor or follow-on has been linked yet."}</small></span></div><a className="if-btn if-btn--secondary" href={`#/budget-spend/explorer?spendView=timeline&capLink=1&capSeed=${encodeURIComponent(recordId)}`}>{relationshipCount ? "Review links" : "Find related records"}</a></header>
      {relationshipCount ? <div className="record-page__lifecycle-grid"><section><h3>Past / incumbent</h3>{past.length ? past.map(({ relationship, related }) => <RelationshipCard key={relationship.id} relationship={relationship} related={related} direction="past" onRemove={intelligence.canWrite ? intelligence.removeRelationship : null} />) : <p>No predecessor link has been established.</p>}</section><section className="is-current"><h3>This record</h3><article><CalendarClock size={18} /><strong>{record.title}</strong><span>{record.id || record.reference}</span></article></section><section><h3>Future / follow-on</h3>{future.length ? future.map(({ relationship, related }) => <RelationshipCard key={relationship.id} relationship={relationship} related={related} direction="future" onRemove={intelligence.canWrite ? intelligence.removeRelationship : null} />) : <p>No follow-on link has been established.</p>}</section></div> : null}
    </section>
    <AcquisitionPortfolioDetail record={record} />
    <ConnectedEvidence opportunityId={recordId} record={record} researchReport={intelligence.reports[0]} fullView />
    <div className="record-page__body"><section className="record-page__facts"><header><SearchCheck size={18} /><span><strong>Published record</strong><small>Fields retained from authoritative and normalized sources.</small></span></header><ControlFactGrid label="Published record facts" mobileTwoColumn items={facts} />{record.events?.length ? <div className="record-page__events"><h3>Event ledger</h3>{record.events.map((event) => <article key={event.eventId}><strong>{event.label}</strong><span>{date(event.start)}{event.end && event.end !== event.start ? ` to ${date(event.end)}` : ""}</span><small>{event.isForecast ? "Forecast" : "Reported"} · {event.status || "status not published"}</small></article>)}</div> : null}<div className="record-page__sources">{record.sourceUrls?.map((url, index) => <a key={url} href={url} target="_blank" rel="noreferrer">Official source {index + 1}<ExternalLink size={13} /></a>)}</div></section><section className="record-page__research"><header><Sparkles size={18} /><span><strong>AI research brief</strong><small>Resumable official-source research with cited findings, review-required links, and timeline-ready dates.</small></span></header><ResearchReport report={intelligence.reports[0]} recordId={recordId} /></section></div>
  </div>;
}
