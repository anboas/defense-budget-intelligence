import { CalendarClock, Network, Waypoints } from "lucide-react";
import { ControlDrawer, ControlFactGrid, ControlMetricStrip, ControlStatusBadge } from "control-surface-ui/react";
import { intelligenceTypeLabel } from "./intelligence-search.js";
import { compareLinkedEntities } from "./linked-intelligence-comparison.js";

function money(value) {
  const amount = Number(value || 0);
  if (!amount) return "$0";
  if (Math.abs(amount) >= 1_000_000_000) return `$${(amount / 1_000_000_000).toFixed(1)}B`;
  if (Math.abs(amount) >= 1_000_000) return `$${(amount / 1_000_000).toFixed(1)}M`;
  return `$${Math.round(amount).toLocaleString()}`;
}

function profileFacts(profile, scope) {
  const facts = [
    { label: "Timeline records", value: profile.timelineIds.length.toLocaleString() },
    { label: "Retained relationships", value: profile.coverage.relationships.toLocaleString() },
    { label: "Linked entities", value: profile.coverage.neighbors.toLocaleString() },
  ];
  if (!profile.work) return facts;
  return [
    ...facts,
    { label: "Opportunities", value: profile.work.opportunities.toLocaleString(), meta: scope === "direct" ? "Direct ownership" : "Reviewed subtree" },
    { label: "Awards", value: profile.work.awards.toLocaleString() },
    { label: "Federal accounts", value: profile.work.accounts.toLocaleString() },
    { label: "Retained obligations", value: money(profile.work.obligatedAmount), wide: true },
  ];
}

function EntityProfile({ profile, scope, rootHref, timelineHref, current = false }) {
  return <article className="if-panel" data-comparison-entity={profile.id}>
    <header className="if-panel__header">
      <div><small className="if-panel__eyebrow">{intelligenceTypeLabel(profile.node.type)}</small><h3 className="if-panel__title">{profile.node.label}</h3></div>
      <ControlStatusBadge status={current ? "Current root" : profile.node.reviewState || "Retained"} tone={current ? "info" : undefined} />
    </header>
    <div className="if-panel__body"><ControlFactGrid mobileTwoColumn label={`${profile.node.label} comparison facts`} items={profileFacts(profile, scope)} /></div>
    <footer className="if-panel__footer if-button-group">
      {!current ? <a className="if-btn if-btn--primary" href={rootHref}><Network size={14} aria-hidden="true" />Make graph root</a> : null}
      {profile.timelineIds.length ? <a className="if-btn if-btn--secondary" href={timelineHref}><CalendarClock size={14} aria-hidden="true" />Timeline {profile.timelineIds.length.toLocaleString()}</a> : null}
    </footer>
  </article>;
}

export default function LinkedEntityComparison({ index, root, comparison, scope = "subtree", onClose, rootHref, timelineHref, traceHref }) {
  const result = compareLinkedEntities(index, root.id, comparison.id, { scope });
  if (!result) return null;
  const overlapMetrics = [
    { id: "timeline", label: "Shared Timeline records", value: result.sharedTimelineIds.length.toLocaleString(), meta: "Exact retained identities", tone: "purple" },
    { id: "neighbors", label: "Shared linked entities", value: result.sharedNeighborCount.toLocaleString(), meta: "Visible below when retained", tone: "info" },
    { id: "left-unique", label: "Root-only links", value: result.leftUniqueNeighborCount.toLocaleString(), meta: root.label },
    { id: "right-unique", label: "Comparison-only links", value: result.rightUniqueNeighborCount.toLocaleString(), meta: comparison.label },
  ];
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
      {result.reviewedRelationship || result.directRelations.length ? <section className="if-panel" data-linked-comparison-context>
        <header className="if-panel__header"><div><h3 className="if-panel__title">Relationship context</h3><p className="if-panel__subtitle">Only retained direct or reviewed hierarchy claims are summarized.</p></div></header>
        <div className="if-panel__body if-stack if-stack--xs">
          {result.reviewedRelationship ? <p>{result.reviewedRelationship}</p> : null}
          {result.directRelations.map(({ relation, label }) => <p key={relation.id}><strong>{label}</strong> · {relation.evidence?.basis || "Retained relationship"}</p>)}
        </div>
      </section> : null}
      <section className="if-grid if-grid--2" aria-label="Compared linked entities">
        <EntityProfile profile={result.left} scope={scope} current rootHref={rootHref(result.left.node)} timelineHref={timelineHref(result.left.node)} />
        <EntityProfile profile={result.right} scope={scope} rootHref={rootHref(result.right.node)} timelineHref={timelineHref(result.right.node)} />
      </section>
      <section className="if-panel" data-linked-comparison-shared>
        <header className="if-panel__header"><div><h3 className="if-panel__title">Shared retained context</h3><p className="if-panel__subtitle">Exact entities directly linked to both sides. Omission does not imply no real-world relationship.</p></div><span className="if-badge">{result.sharedNeighborCount.toLocaleString()}</span></header>
        <div className="if-panel__body">
          {result.sharedNeighbors.length ? <div className="if-stack if-stack--xs">{result.sharedNeighbors.map((item) => <a className="if-list-item" key={item.id} href={rootHref(item.node)}>
            <span className="if-list-item__body"><strong className="if-list-item__title">{item.node.label}</strong><small className="if-list-item__meta">{intelligenceTypeLabel(item.node.type)} · {item.leftCategories.join(" + ")} / {item.rightCategories.join(" + ")}</small></span>
            <span className="if-badge">Open</span>
          </a>)}</div> : <p className="if-text-muted">No exact shared one-hop entity is retained. Use Trace connection to inspect a longer evidence-backed path.</p>}
        </div>
      </section>
    </div>
  </ControlDrawer>;
}
