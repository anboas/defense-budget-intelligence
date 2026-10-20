import { ArrowRight, CalendarClock } from "lucide-react";
import { accountFlowRoute, awardsRoute, opportunityRoute, timelineRoute } from "./cross-surface-routes.js";
import "./OrganizationWorkDistribution.css";

const LIMIT = 12;

function money(value) {
  const amount = Number(value || 0);
  if (!amount) return "$0";
  if (Math.abs(amount) >= 1_000_000_000) return `$${(amount / 1_000_000_000).toFixed(1)}B`;
  if (Math.abs(amount) >= 1_000_000) return `$${(amount / 1_000_000).toFixed(1)}M`;
  return `$${Math.round(amount).toLocaleString()}`;
}

function scopeSummary(summary = {}, scope = "subtree") {
  if (scope === "direct") return {
    opportunities: Number(summary.directOpportunities || 0),
    awards: Number(summary.directAwards || 0),
    accounts: Number(summary.directAccounts || 0),
    obligations: Number(summary.directObligatedAmount || 0),
  };
  return {
    opportunities: Number(summary.opportunities || 0),
    awards: Number(summary.awards || 0),
    accounts: Number(summary.accounts || 0),
    obligations: Number(summary.obligatedAmount || 0),
  };
}

function metricValue(summary, overlay) {
  if (overlay === "awards") return summary.awards;
  if (overlay === "obligations") return summary.obligations;
  return summary.opportunities;
}

function metricLabel(summary, overlay) {
  if (overlay === "awards") return `${summary.awards.toLocaleString()} awards`;
  if (overlay === "obligations") return money(summary.obligations);
  return `${summary.opportunities.toLocaleString()} opportunities`;
}

function workRoute(node) {
  if (node?.type === "activity") return opportunityRoute(node.opportunityId || node.id.replace(/^activity:/, ""));
  if (node?.type === "award") return awardsRoute(node.piid || node.id, node.label);
  if (node?.type === "federal-account") return accountFlowRoute(node.federalAccountCode || node.label);
  return "";
}

function WorkList({ title, ids = [], index }) {
  return <section>
    <h4>{title}<small>{ids.length}</small></h4>
    {ids.length ? <ul>{ids.slice(0, 4).map((id) => {
      const node = index.nodes?.[id];
      const href = workRoute(node);
      if (!node || !href) return null;
      const meta = node.type === "award" ? [node.recipient, money(node.obligatedAmount)].filter(Boolean).join(" · ")
        : node.type === "federal-account" ? [node.federalAccountCode, money(node.obligatedAmount)].filter(Boolean).join(" · ")
          : [node.reference, node.lifecycle].filter(Boolean).join(" · ");
      return <li key={id}><a href={href}><span><strong>{node.label}</strong><small>{meta || "Exact retained graph identity"}</small></span><ArrowRight size={13} aria-hidden="true" /></a></li>;
    })}</ul> : <p>No exact retained {title.toLowerCase()} in this scope.</p>}
  </section>;
}

export default function OrganizationWorkDistribution({ index, rows = [], selectedId, overlay = "opportunities", scope = "subtree", onSelect }) {
  const ranked = rows.map(({ node }) => {
    const summary = scopeSummary(index.indices?.byEntity?.[node.id]?.workSummary, scope);
    return { node, summary, value: metricValue(summary, overlay) };
  }).filter((row) => row.value > 0).sort((left, right) => right.value - left.value || left.node.label.localeCompare(right.node.label)).slice(0, LIMIT);
  const selected = index.nodes?.[selectedId] || rows[0]?.node;
  const selectedIndex = selected ? index.indices?.byEntity?.[selected.id] : null;
  const selectedSummary = scopeSummary(selectedIndex?.workSummary, scope);
  const highlights = selectedIndex?.workHighlights?.[scope] || {};
  const maximum = Math.max(1, ...ranked.map((row) => row.value));
  const scopeLabel = scope === "direct" ? "Direct work only" : "Includes reviewed descendants";

  return <section className="organization-work-distribution" data-organization-work-distribution data-work-scope={scope} data-work-overlay={overlay}>
    <header><div><small>Work distribution</small><strong>{scopeLabel}</strong><span>Ranked by {overlay === "obligations" ? "retained obligations" : overlay}</span></div><span>{ranked.length} of {rows.length} visible organizations carry this work</span></header>
    <div className="organization-work-distribution__grid">
      <ol aria-label={`Visible organizations ranked by ${overlay}`}>{ranked.map((row, position) => <li key={row.node.id}>
        <button type="button" className={selected?.id === row.node.id ? "is-active" : ""} onClick={() => onSelect(row.node.id)} aria-pressed={selected?.id === row.node.id}>
          <span className="organization-work-distribution__rank">{position + 1}</span>
          <span className="organization-work-distribution__name"><strong>{row.node.label}</strong><small>{String(row.node.tier || row.node.kind || "organization").replaceAll("-", " ")}</small></span>
          <span className="organization-work-distribution__metric"><strong>{metricLabel(row.summary, overlay)}</strong><i style={{ "--work-share": `${Math.max(3, (row.value / maximum) * 100)}%` }} /></span>
        </button>
      </li>)}</ol>
      <article className="organization-work-distribution__evidence" data-organization-work-evidence={selected?.id || "none"}>
        <header><div><small>Exact retained work</small><strong>{selected?.label || "No organization selected"}</strong><span>{selected ? `${selectedSummary.opportunities.toLocaleString()} opportunities · ${selectedSummary.awards.toLocaleString()} awards · ${selectedSummary.accounts.toLocaleString()} accounts · ${money(selectedSummary.obligations)}` : "Select a ranked organization"}</span></div>{selected && selectedSummary.opportunities ? <a className="if-btn if-btn--secondary if-btn--sm" href={timelineRoute("", { scope: "entity", entityType: selected.type, entityId: selected.id, entityLabel: selected.label })}><CalendarClock size={14} />Timeline</a> : null}</header>
        <div><WorkList title="Opportunities" ids={highlights.activityIds} index={index} /><WorkList title="Awards" ids={highlights.awardIds} index={index} /><WorkList title="Accounts" ids={highlights.accountIds} index={index} /></div>
      </article>
    </div>
    {ranked.length === LIMIT && rows.length > LIMIT ? <footer>Showing the 12 strongest visible organizations for this measure. The graph retains the complete filtered structure.</footer> : null}
  </section>;
}
