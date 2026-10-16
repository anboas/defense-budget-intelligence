import { ExternalLink, GitBranch, ListChecks } from "lucide-react";
import ConnectedEvidence from "./ConnectedEvidence.jsx";

function recordId(record) {
  return record.opportunityId || record.sourceRecordId || record.noticeId || record.id || record.reference || "";
}

export function OpportunityFitBadge({ assessment }) {
  const label = assessment.level === "strong" ? "Strong fit"
    : assessment.level === "potential" ? "Potential fit"
      : assessment.level === "adjacent" ? "Adjacent" : "Low signal";
  return <span className={`opportunity-fit-badge opportunity-fit-badge--${assessment.level}`}><b>{assessment.score}</b><span>{label}</span></span>;
}

export default function OpportunityWorkbenchDetail({ record }) {
  const id = recordId(record);
  const assessment = record.fitAssessment;
  const sourceUrl = record.sourceUrl || record.sourceUrls?.[0] || null;
  return <div className="capture-detail" data-opportunity-workbench-detail>
    <header className="capture-hero">
      <div><small>Opportunity workspace</small><h3>{record.title || record.id || record.reference || "Untitled public record"}</h3></div>
      <nav className="capture-detail__heading-actions" aria-label="Opportunity actions">
        <a className="if-btn if-btn--primary" href={`#/budget-spend/explorer?spendView=record&capRecord=${encodeURIComponent(id)}`}><ListChecks size={15} />Open record</a>
        <a className="if-btn if-btn--secondary" href={`#/budget-spend/explorer?spendView=timeline&capRecord=${encodeURIComponent(id)}`}><GitBranch size={15} />Timeline</a>
        {sourceUrl ? <a className="if-btn if-btn--secondary" href={sourceUrl} target="_blank" rel="noreferrer"><ExternalLink size={15} />Source</a> : null}
      </nav>
    </header>
    <div className="opportunity-radar__detail">
      <section><small>Why it fits</small><OpportunityFitBadge assessment={assessment} /><ul>{assessment.reasons.length ? assessment.reasons.map((reason) => <li key={reason}>{reason}</li>) : <li>No strong published capability or code signal was found.</li>}</ul><p>{assessment.methodology}</p></section>
      <section><small>Published scope</small><p>{record.description || record.scope || record.context || "The retained source did not publish scope text for this record."}</p><dl><div><dt>NAICS</dt><dd>{record.naicsCode || "Not published"}</dd></div><div><dt>PSC</dt><dd>{record.pscCode || "Not published"}</dd></div><div><dt>Set-aside</dt><dd>{record.setAside || "Not published"}</dd></div></dl></section>
    </div>
    <ConnectedEvidence opportunityId={id} />
  </div>;
}
