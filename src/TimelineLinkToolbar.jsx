import { GitMerge, Sparkles, X } from "lucide-react";

export default function TimelineLinkToolbar({ records, selectedIds, intelligenceState, groupState, onToggle, onLink, onGroup, onCancel }) {
  const selected = selectedIds.map((id) => records.get(id)).filter(Boolean);
  const busy = intelligenceState === "linking" || groupState === "running";
  const guidance = selected.length === 0 ? "Select two records to review a predecessor or follow-on link."
    : selected.length === 1 ? "Select one more record to review a relationship."
      : selected.length === 2 ? "Review a typed relationship, or group only if both records are phases of one lifecycle."
        : "Three to eight records can be reviewed as one lifecycle; relationship links use exactly two.";
  return <div className="capture-lifecycle-toolbar" data-lifecycle-group-toolbar aria-live="polite">
    <div className="capture-lifecycle-toolbar__copy"><strong>Lifecycle workbench</strong><small>{guidance}</small><div className="capture-lifecycle-toolbar__selection" data-lifecycle-selection-count={selected.length}>{selected.map((record) => <button type="button" key={record.opportunityId} onClick={() => onToggle(record.opportunityId)} disabled={busy} aria-label={`Remove ${record.title} from lifecycle selection`}><span><b>{record.id || record.reference}</b>{record.title}</span><X size={13} /></button>)}</div></div>
    <button type="button" className="if-btn if-btn--ai" disabled={selected.length !== 2 || busy} onClick={onLink}><Sparkles size={15} />{intelligenceState === "linking" ? "Reviewing relationship…" : `Review & link (${selected.length}/2)`}</button>
    <button type="button" className="if-btn if-btn--ai" disabled={selected.length < 2 || selected.length > 8 || busy} onClick={onGroup}><GitMerge size={15} />{groupState === "running" ? "Reviewing lifecycle…" : `Review lifecycle (${selected.length}/8)`}</button>
    <button type="button" className="if-btn if-btn--secondary" disabled={busy} onClick={onCancel}>Cancel</button>
  </div>;
}
