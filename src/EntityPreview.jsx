import { ArrowUpRight } from "lucide-react";
import SemanticStatusBadge from "./SemanticStatusBadge.jsx";
import "./EntityPreview.css";

export default function EntityPreview({
  eyebrow,
  title,
  reference,
  summary,
  statusCategory = "evidence",
  status = "unknown",
  statusLabel,
  facts,
  evidence,
  primaryHref,
  primaryLabel = "Open Intelligence Workspace",
  secondaryActions = null,
  children = null,
  className = "",
}) {
  return <article className={`entity-preview ${className}`.trim()} data-entity-preview>
    <header className="entity-preview__identity">
      <div><small>{eyebrow}</small><h3>{title}</h3>{reference ? <span>{reference}</span> : null}</div>
      <SemanticStatusBadge category={statusCategory} value={status} label={statusLabel} />
    </header>
    {summary ? <p className="entity-preview__summary">{summary}</p> : null}
    {facts ? <div className="entity-preview__facts">{facts}</div> : null}
    {evidence ? <div className="entity-preview__evidence"><strong>Evidence</strong><span>{evidence}</span></div> : null}
    {children ? <div className="entity-preview__detail">{children}</div> : null}
    <footer className="entity-preview__actions">{primaryHref ? <a className="if-btn if-btn--primary" href={primaryHref}>{primaryLabel}<ArrowUpRight size={14} /></a> : null}{secondaryActions}</footer>
  </article>;
}
