import { ArrowLeft, ArrowRight, CalendarClock, CheckCircle2, ExternalLink, Link2, Plus } from "lucide-react";
import { ControlAsyncState } from "control-surface-ui/react";
import { PURSUIT_TASK_EVENT } from "./pursuit-metadata.js";
import { opportunityRoute, timelineRoute } from "./cross-surface-routes.js";

function date(value) {
  if (!value) return "Not published";
  const parsed = new Date(`${String(value).slice(0, 10)}T12:00:00Z`);
  return Number.isNaN(parsed.getTime()) ? "Not published" : parsed.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" });
}

function RelationshipCard({ relationship, related, direction, onRemove }) {
  if (!related) return null;
  return <article className={`if-relationship-bundle is-${direction}`} data-record-relationship={relationship.relationship}>
    <small>{direction === "past" ? <><ArrowLeft size={14} /> Predecessor / incumbent</> : <><ArrowRight size={14} /> Follow-on / future activity</>}</small>
    <h3>{related.title}</h3><span>{related.id || related.reference} · {relationship.relationship.replaceAll("-", " ")} · {relationship.confidence} confidence</span><p>{relationship.rationale || relationship.evidence?.[0]}</p>
    <div className="if-button-group"><a className="if-btn if-btn--secondary" href={opportunityRoute(related.opportunityId)}>Open workspace</a>{!relationship.automatic && onRemove ? <button type="button" className="if-btn if-btn--ghost" onClick={() => onRemove(relationship.id)}>Remove link</button> : null}</div>
  </article>;
}

export function OpportunityLifecycle({ record, records, intelligence }) {
  const recordId = record.opportunityId;
  const byId = new Map(records.map((candidate) => [candidate.opportunityId, candidate]));
  const past = intelligence.relationships.filter((relationship) => relationship.targetId === recordId).map((relationship) => ({ relationship, related: byId.get(relationship.sourceId) }));
  const future = intelligence.relationships.filter((relationship) => relationship.sourceId === recordId).map((relationship) => ({ relationship, related: byId.get(relationship.targetId) }));
  const relationshipCount = past.length + future.length;
  return <section className="if-panel" data-record-lifecycle>
    <header className="if-panel__header"><div><h2 className="if-panel__title"><Link2 size={18} /> Acquisition lifecycle</h2><p className="if-panel__subtitle">{relationshipCount ? `${relationshipCount} source-backed relationship${relationshipCount === 1 ? "" : "s"}; every record remains independently inspectable.` : "No predecessor or follow-on has been linked yet."}</p></div><a className="if-btn if-btn--secondary" href={`#/budget-spend/timeline?capLink=1&capSeed=${encodeURIComponent(recordId)}`}>{relationshipCount ? "Review links" : "Find related records"}</a></header>
    {relationshipCount ? <div className="if-panel__body"><div className="if-relationship-bundle-grid"><section>{past.length ? past.map(({ relationship, related }) => <RelationshipCard key={relationship.id} relationship={relationship} related={related} direction="past" onRemove={intelligence.canWrite ? intelligence.removeRelationship : null} />) : <article className="if-relationship-bundle"><h3>Past / incumbent</h3><p>No predecessor link has been established.</p></article>}</section><article className="if-relationship-bundle"><small><CalendarClock size={14} /> This record</small><h3>{record.title}</h3><p>{record.id || record.reference}</p></article><section>{future.length ? future.map(({ relationship, related }) => <RelationshipCard key={relationship.id} relationship={relationship} related={related} direction="future" onRemove={intelligence.canWrite ? intelligence.removeRelationship : null} />) : <article className="if-relationship-bundle"><h3>Future / follow-on</h3><p>No follow-on link has been established.</p></article>}</section></div></div> : null}
  </section>;
}

function researchTimelineHref(recordId, reportId, item) {
  const year = Number(String(item.date || "").slice(0, 4));
  return timelineRoute(recordId, { research: reportId || "latest", researchDate: item.date, from: year ? Math.max(2023, year - 1) : "", to: year ? Math.min(2034, year + 1) : "" });
}

export function OpportunityResearchReport({ report, recordId }) {
  if (!report) return <ControlAsyncState compact state="empty" title="No AI research yet" message="Run official-source research to build a cited brief and check for predecessor or follow-on records." />;
  return <article className="if-record-detail" data-record-research-report>
    <header><div><span>Latest research</span><strong>{report.stage || "Acquisition research"}</strong></div><small>{date(report.createdAt || report.provenance?.createdAt)} · {report.sources?.length || 0} official source{report.sources?.length === 1 ? "" : "s"}{report.provenance?.degradedRetry ? " · recovered on retry" : ""}</small></header>
    <p>{report.summary}</p>
    {report.decisionBrief ? <section className="if-relationship-bundle" data-record-decision-brief><header className="if-button-group"><CheckCircle2 size={18} /><span><small>Recommended action: </small><strong>{report.decisionBrief.recommendedAction}</strong></span><b className="if-badge if-badge--info">{report.decisionBrief.priority} priority</b></header><p>{report.decisionBrief.rationale}</p><small>{report.decisionBrief.sourceUrls.map((url, index) => <a key={url} href={url} target="_blank" rel="noreferrer">Decision source {index + 1}<ExternalLink size={12} /></a>)}</small></section> : null}
    {report.keyDates?.length ? <section><h3>Key published dates</h3><ul>{report.keyDates.map((item) => <li key={`${item.label}-${item.date}`}><strong>{item.label} · <time dateTime={item.date}>{date(item.date)}</time></strong><span>{item.basis}</span><small>{item.sourceUrls.map((url, index) => <a key={url} href={url} target="_blank" rel="noreferrer">Date source {index + 1}<ExternalLink size={12} /></a>)}<a className="record-page__timeline-link" href={researchTimelineHref(recordId, report.id, item)}><CalendarClock size={12} />Show on Timeline</a></small></li>)}</ul></section> : null}
    {report.nextActions?.length ? <section><h3>Next actions</h3><ol>{report.nextActions.map((item, index) => <li key={`${item.action}-${index}`}><strong>{item.action}</strong><span>{item.rationale}</span><small>{item.sourceUrls.map((url, sourceIndex) => <a key={url} href={url} target="_blank" rel="noreferrer">Action source {sourceIndex + 1}<ExternalLink size={12} /></a>)}<button type="button" className="record-page__timeline-link" onClick={() => window.dispatchEvent(new CustomEvent(PURSUIT_TASK_EVENT, { detail: { recordId, title: item.action, priority: report.decisionBrief?.priority === "critical" ? "critical" : report.decisionBrief?.priority === "high" ? "high" : "normal", sourceType: "research", sourceId: report.id, sourceLabel: "AI research brief" } }))}><Plus size={12} />Create task</button></small></li>)}</ol></section> : null}
    {report.scope ? <section><h3>Published scope</h3><p>{report.scope}</p></section> : null}
    {report.incumbentPosture ? <section><h3>Incumbent and follow-on posture</h3><p>{report.incumbentPosture}</p></section> : null}
    {report.findings?.length ? <section><h3>Cited findings</h3><ul>{report.findings.map((finding, index) => <li key={`${finding.text}-${index}`}><span>{finding.text}</span><small>{finding.sourceUrls.map((url, sourceIndex) => <a key={url} href={url} target="_blank" rel="noreferrer">Source {sourceIndex + 1}<ExternalLink size={12} /></a>)}</small></li>)}</ul></section> : null}
    {report.risks?.length ? <section><h3>Risks and uncertainties</h3><ul>{report.risks.map((risk, index) => <li key={`${risk.text}-${index}`}><span>{risk.text}</span><small>{risk.sourceUrls.map((url, sourceIndex) => <a key={url} href={url} target="_blank" rel="noreferrer">Source {sourceIndex + 1}<ExternalLink size={12} /></a>)}</small></li>)}</ul></section> : null}
    {report.openQuestions?.length ? <section><h3>Questions to resolve</h3><ul>{report.openQuestions.map((question) => <li key={question}>{question}</li>)}</ul></section> : null}
    {report.caveats?.length ? <p><strong>Review notes:</strong> {report.caveats.join(" ")}</p> : null}
  </article>;
}
