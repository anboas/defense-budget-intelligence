import OpportunityCommandRail from "./OpportunityCommandRail.jsx";
import OpportunityFitBadge from "./OpportunityFitBadge.jsx";
import OpportunityFactSummary from "./OpportunityFactSummary.jsx";
import { useManagementState } from "./management-state.js";
import { useRecordIntelligence } from "./record-intelligence.js";
import { intelligenceWorkspaceRoute } from "./cross-surface-routes.js";
import "./OpportunityWorkbenchDetail.css";

function recordId(record) {
  return record.opportunityId || record.sourceRecordId || record.noticeId || record.id || record.reference || "";
}

export default function OpportunityWorkbenchDetail({ record, records = [record] }) {
  const id = recordId(record);
  const assessment = record.fitAssessment || { reasons: [], methodology: "No scoring method is published for this record." };
  const management = useManagementState(records);
  const intelligence = useRecordIntelligence(records, id);
  const watch = management.watchlist.find((entry) => entry.recordId === id) || null;
  const returnTo = typeof window === "undefined" ? "" : window.location.hash;
  return <div className="opportunity-workspace opportunity-workspace--preview" data-opportunity-workbench-detail data-entity-quick-preview>
    <header className="opportunity-workspace__header">
      <div><small>Decision workspace</small><h3>{record.title || record.id || record.reference || "Untitled public record"}</h3><span>{record.reference || record.noticeId || id}</span></div>
      <OpportunityFitBadge assessment={assessment} />
    </header>
    <div className="opportunity-workspace__preview-layout">
      <section className="opportunity-workspace__context" aria-label="Opportunity context">
        <OpportunityFactSummary record={record} compact />
        <section className="opportunity-workspace__fit"><header><small>Why it fits</small></header><ul>{assessment.reasons.length ? assessment.reasons.slice(0, 4).map((reason) => <li key={reason}>{reason}</li>) : <li>No strong published capability or code signal was found.</li>}</ul><details><summary>Scoring method</summary><p>{assessment.methodology}</p></details></section>
        <details className="opportunity-workspace__scope"><summary><span><small>Published scope</small><strong>{record.naicsCode || record.pscCode || "Review source detail"}</strong></span><span>Review</span></summary><div><p>{record.description || record.scope || record.context || "The retained source did not publish scope text for this record."}</p><dl><div><dt>NAICS</dt><dd>{record.naicsCode || "Not published"}</dd></div><div><dt>PSC</dt><dd>{record.pscCode || "Not published"}</dd></div><div><dt>Set-aside</dt><dd>{record.setAside || "Not published"}</dd></div></dl></div></details>
        <OpportunityCommandRail compact record={record} watch={watch} canWrite={management.canWrite} onSavePursuit={management.savePursuit} onToggleTrack={management.toggleWatch} intelligence={intelligence} workspaceActions={management.watchlist} />
      </section>
      <section className="if-panel"><header className="if-panel__header"><div><small>Continue analysis</small><h4 className="if-panel__title">One workspace, every lens</h4><p className="if-panel__subtitle">Timeline, connections, money, evidence, and tasks use the same entity context and URL state.</p></div></header><footer className="if-panel__footer"><a className="if-btn if-btn--primary" href={intelligenceWorkspaceRoute({ entityType: "activity", entityId: id, returnTo, origin: "opportunities" })}>Open Intelligence Workspace</a></footer></section>
    </div>
  </div>;
}
