import { CalendarClock, Network, Waypoints } from "lucide-react";
import { ControlDrawer, ControlMetricStrip, ControlStatusBadge } from "control-surface-ui/react";
import { intelligenceTypeLabel } from "./intelligence-search.js";
import { compareLinkedEntities } from "./linked-intelligence-comparison.js";

function money(value) {
  const amount = Number(value || 0);
  if (!amount) return "$0";
  if (Math.abs(amount) >= 1_000_000_000) return `$${(amount / 1_000_000_000).toFixed(1)}B`;
  if (Math.abs(amount) >= 1_000_000) return `$${(amount / 1_000_000).toFixed(1)}M`;
  return `$${Math.round(amount).toLocaleString()}`;
}

function comparisonRows(result, scope) {
  const value = (profile, field, format = (item) => item.toLocaleString()) => profile.work ? format(profile.work[field]) : "Not retained";
  return [
    { id: "exclusive-links", label: "Exclusive linked entities", meta: "Directly linked to only this side", left: result.leftUniqueNeighborCount.toLocaleString(), right: result.rightUniqueNeighborCount.toLocaleString() },
    { id: "timeline", label: "Timeline records", left: result.left.timelineIds.length.toLocaleString(), right: result.right.timelineIds.length.toLocaleString() },
    { id: "relationships", label: "Retained relationships", left: result.left.coverage.relationships.toLocaleString(), right: result.right.coverage.relationships.toLocaleString() },
    { id: "linked-entities", label: "Linked entities", left: result.left.coverage.neighbors.toLocaleString(), right: result.right.coverage.neighbors.toLocaleString() },
    { id: "opportunities", label: "Opportunities", meta: scope === "direct" ? "Direct ownership" : "Reviewed subtree", left: value(result.left, "opportunities"), right: value(result.right, "opportunities") },
    { id: "awards", label: "Awards", left: value(result.left, "awards"), right: value(result.right, "awards") },
    { id: "accounts", label: "Federal accounts", left: value(result.left, "accounts"), right: value(result.right, "accounts") },
    { id: "obligations", label: "Retained obligations", left: value(result.left, "obligatedAmount", money), right: value(result.right, "obligatedAmount", money) },
  ];
}

function EntityHeading({ profile, current = false }) {
  return <div className="if-stack if-stack--xs" data-comparison-entity={profile.id}>
    <small>{intelligenceTypeLabel(profile.node.type)}</small>
    <span>{profile.node.label}</span>
    <div><ControlStatusBadge status={current ? "Current root" : profile.node.reviewState || "Retained"} tone={current ? "info" : undefined} /></div>
  </div>;
}

function EntityActions({ profile, current = false, rootHref, timelineHref }) {
  return <div className="if-button-group" aria-label={`${profile.node.label} actions`}>
    {!current ? <a className="if-btn if-btn--primary" href={rootHref(profile.node)}><Network size={14} aria-hidden="true" />Make graph root</a> : null}
    {profile.timelineIds.length ? <a className="if-btn if-btn--secondary" href={timelineHref(profile.node)}><CalendarClock size={14} aria-hidden="true" />Timeline {profile.timelineIds.length.toLocaleString()}</a> : null}
  </div>;
}

export default function LinkedEntityComparison({ index, root, comparison, scope = "subtree", onClose, rootHref, timelineHref, traceHref }) {
  const result = compareLinkedEntities(index, root.id, comparison.id, { scope });
  if (!result) return null;
  const overlapMetrics = [
    { id: "timeline", label: "Shared Timeline records", value: result.sharedTimelineIds.length.toLocaleString(), meta: "Exact retained identities", tone: "purple" },
    { id: "neighbors", label: "Shared linked entities", value: result.sharedNeighborCount.toLocaleString(), meta: "Visible below when retained", tone: "info" },
  ];
  const rows = comparisonRows(result, scope);
  return <ControlDrawer
    open
    onClose={onClose}
    eyebrow="Linked intelligence comparison"
    title={`${root.label} vs ${comparison.label}`}
    summary={`Side-by-side retained evidence · ${scope === "direct" ? "direct organization work" : "reviewed descendant rollups where available"}`}
    size="wide"
    closeLabel="Close linked entity comparison"
    drawerProps={{ "data-linked-entity-comparison": "", "data-left-id": result.left.id, "data-right-id": result.right.id }}
    footer={<div className="if-button-group"><a className="if-btn if-btn--primary" href={traceHref}><Waypoints size={15} aria-hidden="true" />Trace connection</a><button type="button" className="if-btn if-btn--secondary" onClick={onClose}>Close</button></div>}
  >
    <div className="if-stack">
      <ControlMetricStrip compactMobile mobileScroll label="Linked entity overlap" items={overlapMetrics} data-linked-comparison-metrics />
      <section className="if-panel" data-linked-comparison-table>
        <header className="if-panel__header"><div><h3 className="if-panel__title">Compared evidence</h3><p className="if-panel__subtitle">Aligned retained measures make gaps and differences explicit.</p></div></header>
        <div className="if-table-wrap">
          <table className="if-table if-table--dense">
            <caption className="if-sr-only">Retained evidence comparison for {result.left.node.label} and {result.right.node.label}</caption>
            <thead><tr><th scope="col">Measure</th><th scope="col"><EntityHeading profile={result.left} current /></th><th scope="col"><EntityHeading profile={result.right} /></th></tr></thead>
            <tbody>{rows.map((row) => <tr key={row.id} data-comparison-measure={row.id}>
              <th scope="row"><span>{row.label}{row.meta ? <><span aria-hidden="true"> · </span><small className="if-text-muted">{row.meta}</small></> : null}</span></th>
              <td>{row.left}</td>
              <td>{row.right}</td>
            </tr>)}</tbody>
          </table>
        </div>
        <footer className="if-panel__footer if-grid if-grid--2" aria-label="Compared entity actions">
          <EntityActions profile={result.left} current rootHref={rootHref} timelineHref={timelineHref} />
          <EntityActions profile={result.right} rootHref={rootHref} timelineHref={timelineHref} />
        </footer>
      </section>
      <section className="if-panel" data-linked-comparison-shared>
        <header className="if-panel__header"><div><h3 className="if-panel__title">Shared retained context</h3><p className="if-panel__subtitle">Exact entities directly linked to both sides. Omission does not imply no real-world relationship.</p></div><span className="if-badge">{result.sharedNeighborCount.toLocaleString()}</span></header>
        <div className="if-panel__body">
          {result.sharedNeighbors.length ? <div className="if-stack if-stack--xs">{result.sharedNeighbors.map((item) => <a className="if-list-item" key={item.id} href={rootHref(item.node)}>
            <span className="if-list-item__icon" aria-hidden="true"><Network size={15} /></span>
            <span className="if-list-item__body"><strong className="if-list-item__title">{item.node.label}</strong><small className="if-list-item__meta">{intelligenceTypeLabel(item.node.type)} · {item.leftCategories.join(" + ")} / {item.rightCategories.join(" + ")}</small></span>
            <span className="if-badge">Open</span>
          </a>)}</div> : <p className="if-text-muted">No exact shared one-hop entity is retained. Use Trace connection to inspect a longer evidence-backed path.</p>}
        </div>
      </section>
      {result.reviewedRelationship || result.directRelations.length ? <section className="if-panel" data-linked-comparison-context>
        <header className="if-panel__header"><div><h3 className="if-panel__title">Relationship context</h3><p className="if-panel__subtitle">Only retained direct or reviewed hierarchy claims are summarized.</p></div></header>
        <div className="if-panel__body if-stack if-stack--xs">
          {result.reviewedRelationship ? <p>{result.reviewedRelationship}</p> : null}
          {result.directRelations.map(({ relation, label }) => <p key={relation.id}><strong>{label}</strong> · {relation.evidence?.basis || "Retained relationship"}</p>)}
        </div>
      </section> : null}
    </div>
  </ControlDrawer>;
}
