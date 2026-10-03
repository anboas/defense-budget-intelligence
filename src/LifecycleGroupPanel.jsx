import { ChevronRight } from "lucide-react";

function label(value) {
  return String(value || "").replaceAll("-", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatDate(value) {
  if (!value) return "Not published";
  const date = new Date(`${String(value).slice(0, 10)}T12:00:00Z`);
  return Number.isNaN(date.getTime()) ? "Not published" : date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

export default function LifecycleGroupPanel({ record, onOpenMember, onRemove }) {
  const group = record.lifecycleGroup || {};
  const saved = !group.automatic;
  return <div className="capture-lifecycle-detail" data-lifecycle-group-detail>
    <div className="if-alert if-alert--info" role="status"><span><strong>Non-destructive lifecycle group</strong><br />Each award remains a separate source record. This view only combines their timeline lanes.</span></div>
    <dl>
      <div><dt>Relationship</dt><dd>{label(group.relationship || "related-workstream")}</dd></div>
      <div><dt>Confidence</dt><dd>{group.confidence === "exact" ? "Exact evidence" : `${group.confidence || "review"} confidence`}</dd></div>
      <div><dt>Provenance</dt><dd>{group.automatic ? "Automatic exact-link resolver" : `${group.provenance?.model || "OpenAI"} review`}</dd></div>
      <div><dt>Records</dt><dd>{record.lifecycleMembers.length}</dd></div>
    </dl>
    <section><strong>Why these are linked</strong><ul>{(group.basis || group.evidence || []).map((item) => <li key={item}>{item}</li>)}</ul>{group.rationale ? <p>{group.rationale}</p> : null}</section>
    <section><strong>Source records</strong><div className="capture-lifecycle-detail__members">{record.lifecycleMembers.map((member) => <button type="button" key={member.opportunityId} onClick={() => onOpenMember(member.opportunityId)}><span><b>{member.id} · {member.title}</b><small>{member.reference} · {formatDate(member.start)} to {formatDate(member.currentEnd)}</small></span><ChevronRight size={16} /></button>)}</div></section>
    {saved && onRemove ? <button type="button" className="if-btn if-btn--secondary" onClick={() => onRemove(group.id)}>Remove grouping</button> : null}
  </div>;
}
