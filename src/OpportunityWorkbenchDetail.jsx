import OpportunityFitBadge from "./OpportunityFitBadge.jsx";
import { ControlDisclosure } from "control-surface-ui/react";
import OpportunityFactSummary from "./OpportunityFactSummary.jsx";
import { intelligenceWorkspaceRoute } from "./cross-surface-routes.js";
import EntityPreview from "./EntityPreview.jsx";
import RecordIntelligenceNotice from "./RecordIntelligenceNotice.jsx";
import { useRecordIntelligence } from "./record-intelligence.js";
import { useManagementState } from "./management-state.js";
import { normalizePursuit } from "./pursuit-metadata.js";
import "./OpportunityWorkbenchDetail.css";

function recordId(record) {
  return record.opportunityId || record.sourceRecordId || record.noticeId || record.id || record.reference || "";
}

export default function OpportunityWorkbenchDetail({ record, records = [record] }) {
  const id = recordId(record);
  const assessment = record.fitAssessment || { reasons: [], methodology: "No scoring method is published for this record." };
  const management = useManagementState(records);
  const watch = management.watchlist.find((entry) => entry.recordId === id) || null;
  const intelligence = useRecordIntelligence(records, id);
  const returnTo = typeof window === "undefined" ? "" : window.location.hash;
  const toggleTracking = async () => {
    if (!management.canWrite) return;
    if (watch) management.toggleWatch(id);
    else await management.savePursuit(id, normalizePursuit());
  };
  return <div className="opportunity-workspace opportunity-workspace--preview" data-opportunity-workbench-detail data-entity-quick-preview><RecordIntelligenceNotice intelligence={intelligence} /><EntityPreview
    eyebrow="Opportunity preview"
    title={record.title || record.id || record.reference || "Untitled public record"}
    reference={record.reference || record.noticeId || id}
    summary={record.description || record.scope || record.context || "Review the retained facts, fit rationale, and complete evidence in the canonical workspace."}
    statusCategory="evidence"
    status={record.evidenceTier || "supported"}
    facts={<OpportunityFactSummary record={record} compact />}
    evidence={record.sourceRoleCount ? `${record.sourceRoleCount} retained source roles` : "Source-backed record; open the workspace for provenance and conflicts."}
    primaryHref={intelligenceWorkspaceRoute({ entityType: "activity", entityId: id, returnTo, origin: "opportunities" })}
    secondaryActions={<><button type="button" className="if-btn if-btn--secondary" aria-pressed={Boolean(watch)} disabled={!management.canWrite} onClick={() => void toggleTracking()}>{watch ? "Tracked" : "Track"}</button><OpportunityFitBadge assessment={assessment} /></>}
  ><ControlDisclosure compact flush className="opportunity-workspace__fit" title="Why it fits" summary="Published capability and classification signals"><ul>{assessment.reasons.length ? assessment.reasons.slice(0, 4).map((reason) => <li key={reason}>{reason}</li>) : <li>No strong published capability or code signal was found.</li>}</ul><p>{assessment.methodology}</p></ControlDisclosure></EntityPreview></div>;
}
