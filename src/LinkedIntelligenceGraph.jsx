import { useMemo, useState } from "react";
import { CalendarClock, ExternalLink, Network, RotateCcw } from "lucide-react";
import { ControlGraph } from "control-surface-ui/react/graph";
import { ControlStatusBadge, ControlTabs } from "control-surface-ui/react";
import { accountFlowRoute, awardsRoute, intelligenceWorkspaceRoute, mapLocationRoute, opportunityRoute, timelineRoute } from "./cross-surface-routes.js";
import { intelligenceTypeLabel } from "./intelligence-search.js";
import "./control-graph.css";
import "./LinkedIntelligenceGraph.css";

const ROOTABLE_TYPES = new Set(["organization", "federal-account", "defense-program", "program-office", "activity", "award"]);
const LENSES = new Set(["overview", "hierarchy", "work", "money", "organization"]);
const LENS_ITEMS = [["overview", "Overview"], ["hierarchy", "Hierarchy"], ["work", "Work"], ["money", "Money"], ["organization", "People & places"]];
const NODE_TYPES = Object.freeze({
  organization: { className: "org", color: "#0369a1", icon: "department", label: "Organization", data: { linkedNode: "organization" } },
  activity: { className: "opportunity", color: "#0f766e", icon: "star", label: "Opportunity", data: { linkedNode: "activity" } },
  award: { className: "obligation", color: "#b45309", icon: "award", label: "Award", data: { linkedNode: "award" } },
  "federal-account": { className: "source", color: "#4f46e5", icon: "database", label: "Federal account", data: { linkedNode: "federal-account" } },
  "defense-program": { className: "implementation", color: "#73559b", icon: "workflow", label: "Program", data: { linkedNode: "defense-program" } },
  "program-office": { className: "org", color: "#315f82", icon: "building", label: "Program office", data: { linkedNode: "program-office" } },
  "official-role": { className: "evidence", color: "#087f8c", icon: "person", label: "Official role", data: { linkedNode: "official-role" } },
  person: { className: "evidence", color: "#087f8c", icon: "person", label: "Person", data: { linkedNode: "person" } },
  location: { className: "org", color: "#248642", icon: "location", label: "Location", data: { linkedNode: "location" } },
  "contract-vehicle": { className: "implementation", color: "#0f766e", icon: "workflow", label: "Vehicle", data: { linkedNode: "contract-vehicle" } },
});

const CATEGORY_LIMITS = { hierarchy: 10, work: 12, money: 8, program: 8, people: 6, places: 5, other: 4 };

function compact(value, fallback = "Not published") {
  return String(value || fallback).replaceAll("_", " ").replaceAll("-", " ");
}

function short(value, limit = 38) {
  const text = String(value || "");
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

function money(value) {
  const amount = Number(value || 0);
  if (!amount) return "No amount published";
  if (Math.abs(amount) >= 1_000_000_000) return `$${(amount / 1_000_000_000).toFixed(1)}B`;
  if (Math.abs(amount) >= 1_000_000) return `$${(amount / 1_000_000).toFixed(1)}M`;
  return `$${Math.round(amount).toLocaleString()}`;
}

function relationCategory(type) {
  if (["organization-part-of", "organization-equivalent-to"].includes(type)) return "hierarchy";
  if (["activity-awarded-as", "activity-contracting-organization", "activity-funding-organization", "activity-recipient", "activity-ordered-under-vehicle"].includes(type)) return "work";
  if (["award-recipient", "award-awarding-organization", "award-funding-organization", "award-funded-by-account"].includes(type)) return "money";
  if (["defense-program-owned-by-program-office", "program-office-part-of-organization"].includes(type)) return "program";
  if (["official-role-at-organization", "person-holds-official-role"].includes(type)) return "people";
  if (["organization-located-at", "organization-operates-at-location", "contracting-activity-at", "funding-activity-at"].includes(type)) return "places";
  return "other";
}

function lensAllows(lens, category) {
  if (lens === "overview") return ["hierarchy", "work", "money", "program"].includes(category);
  if (lens === "hierarchy") return ["hierarchy", "program"].includes(category);
  if (lens === "work") return category === "work";
  if (lens === "money") return category === "money";
  return ["people", "places"].includes(category);
}

function relationLabel(relation, rootId) {
  const outbound = relation.from === rootId;
  return ({
    "organization-part-of": outbound ? "part of" : "contains",
    "organization-equivalent-to": "same reviewed organization",
    "activity-awarded-as": outbound ? "awarded as" : "supports activity",
    "activity-recipient": outbound ? "recipient" : "performed activity",
    "activity-contracting-organization": outbound ? "contracting organization" : "contracting activity",
    "activity-funding-organization": outbound ? "funding organization" : "funded activity",
    "activity-ordered-under-vehicle": outbound ? "ordered under" : "order",
    "award-recipient": outbound ? "recipient" : "received award",
    "award-awarding-organization": outbound ? "awarding organization" : "awarded",
    "award-funding-organization": outbound ? "funding organization" : "funded award",
    "award-funded-by-account": outbound ? "funded by account" : "funded award",
    "organization-located-at": outbound ? "located at" : "hosts organization",
    "organization-operates-at-location": outbound ? "operates at" : "contracting office",
    "contracting-activity-at": outbound ? "contracting location" : "contracting activity",
    "funding-activity-at": outbound ? "funding location" : "funded activity",
    "defense-program-owned-by-program-office": outbound ? "owned by" : "program",
    "program-office-part-of-organization": outbound ? "part of" : "program office",
    "official-role-at-organization": outbound ? "at organization" : "official role",
    "person-holds-official-role": outbound ? "holds role" : "held by",
  })[relation.type] || compact(relation.type);
}

function nodeDetail(node) {
  if (node.type === "organization") return [compact(node.kind), node.identity?.identifiers?.officeCode ? `DoDAAC ${node.identity.identifiers.officeCode}` : "", compact(node.reviewState)].filter(Boolean).join(" · ");
  if (node.type === "activity") return [node.reference, compact(node.lifecycle), compact(node.mode)].filter(Boolean).join(" · ");
  if (node.type === "award") return [node.piid, node.recipient, money(node.obligatedAmount), node.endDate].filter(Boolean).join(" · ");
  if (node.type === "federal-account") return [node.federalAccountCode, node.bureauName, money(node.obligatedAmount)].filter(Boolean).join(" · ");
  if (node.type === "defense-program") return [compact(node.programKind), node.organization, ...(node.budgetLineCodes || [])].filter(Boolean).join(" · ");
  if (node.type === "program-office") return [node.organization, compact(node.roleType)].filter(Boolean).join(" · ");
  if (node.type === "official-role") return [node.title, node.organizationName, compact(node.status)].filter(Boolean).join(" · ");
  if (node.type === "location") return [node.city, node.state, compact(node.kind)].filter(Boolean).join(" · ");
  if (node.type === "contract-vehicle") return [node.piid, `${node.orderCount || 0} retained orders`].filter(Boolean).join(" · ");
  return intelligenceTypeLabel(node.type);
}

function canonicalRoute(node) {
  if (node.type === "activity") return opportunityRoute(node.opportunityId || node.id.replace(/^activity:/, ""));
  if (node.type === "award") return awardsRoute(node.piid || node.id, node.label);
  if (node.type === "federal-account") return accountFlowRoute(node.federalAccountCode || node.label);
  if (node.type === "location") return mapLocationRoute(node.sourceId || node.id, node.label);
  if (["organization", "defense-program", "program-office"].includes(node.type)) return intelligenceWorkspaceRoute({ entityType: node.type, entityId: node.id, query: node.label, origin: "intelligence-graph" });
  return "";
}

function linkedLayout({ nodes = [] }) {
  const root = nodes.find((item) => item.primary) || nodes[0];
  const neighbors = nodes.filter((item) => item !== root);
  const category = (item) => {
    const relation = String(item.relation || "");
    if (["part of", "contains", "same reviewed organization"].includes(relation)) return "hierarchy";
    if (["owned by", "program", "program office"].includes(relation)) return "program";
    if (/activity|recipient|ordered under|order/.test(relation)) return "work";
    if (/award|funded by account/.test(relation)) return "money";
    if (/role|held by/.test(relation)) return "people";
    if (/location|hosts organization|contracting office/.test(relation)) return "places";
    return "other";
  };
  const lane = (items, x) => {
    const positions = items.length === 1 ? [50]
      : items.length === 2 ? [30, 70]
        : items.length === 3 ? [18, 50, 82]
          : items.map((_, index) => 10 + ((index + 1) / (items.length + 1)) * 80);
    return items.map((item, index) => ({ id: item.id, x, y: positions[index] }));
  };
  if (neighbors.length && neighbors.every((item) => category(item) === "hierarchy")) {
    const parents = neighbors.filter((item) => item.relation === "part of");
    const children = neighbors.filter((item) => item.relation !== "part of");
    return {
      coordinateSpace: "percent",
      layout: "linked-hierarchy",
      nodes: [root ? { id: root.id, x: 50, y: 50 } : null, ...lane(parents, 14), ...lane(children, 86)].filter(Boolean),
    };
  }
  const lanes = new Map();
  for (const item of neighbors) {
    const key = category(item);
    lanes.set(key, [...(lanes.get(key) || []), item]);
  }
  const order = ["hierarchy", "program", "work", "money", "people", "places", "other"].filter((key) => lanes.has(key));
  const positions = [12, 25, 38, 62, 75, 88];
  const placed = [];
  order.forEach((key, laneIndex) => {
    const items = lanes.get(key);
    const x = positions[laneIndex] || 88;
    placed.push(...lane(items, x));
  });
  return { coordinateSpace: "percent", layout: "linked-lanes", nodes: [root ? { id: root.id, x: 50, y: 50 } : null, ...placed].filter(Boolean) };
}

function selectRelations(index, rootId, lens) {
  const canonicalId = index.indices?.byEntity?.[rootId]?.canonicalId || rootId;
  const relationIds = index.indices?.byEntity?.[canonicalId]?.relationIds || [];
  const groups = new Map();
  for (const relationIndex of relationIds) {
    const relation = index.relations[relationIndex];
    if (!relation) continue;
    const category = relationCategory(relation.type);
    if (!lensAllows(lens, category)) continue;
    groups.set(category, [...(groups.get(category) || []), relation]);
  }
  return [...groups.entries()].flatMap(([category, rows]) => rows
    .sort((left, right) => Number(right.evidence?.sourceArtifact === "reviewed-organization-hierarchy") - Number(left.evidence?.sourceArtifact === "reviewed-organization-hierarchy")
      || Number(right.evidence?.confidence === "exact") - Number(left.evidence?.confidence === "exact")
      || String(left.type).localeCompare(String(right.type)))
    .slice(0, CATEGORY_LIMITS[category] || 4));
}

export default function LinkedIntelligenceGraph({ index, rootId, onRootChange }) {
  const canonicalRootId = index.indices?.byEntity?.[rootId]?.canonicalId || rootId;
  const root = index.nodes?.[canonicalRootId];
  const [lens, setLens] = useState("overview");
  const [selectedId, setSelectedId] = useState(canonicalRootId);
  const relations = useMemo(() => selectRelations(index, canonicalRootId, lens), [canonicalRootId, index, lens]);
  const neighbors = useMemo(() => {
    const seen = new Set();
    return relations.flatMap((relation) => {
      const id = relation.from === canonicalRootId ? relation.to : relation.from;
      if (seen.has(id) || !index.nodes?.[id]) return [];
      seen.add(id);
      return [{ node: index.nodes[id], relation }];
    });
  }, [canonicalRootId, index.nodes, relations]);
  const graphNodes = useMemo(() => [root, ...neighbors.map((item) => item.node)].filter(Boolean).map((item) => {
    const related = neighbors.find((candidate) => candidate.node.id === item.id);
    return { id: item.id, kind: item.type, label: short(item.label), meta: intelligenceTypeLabel(item.type), description: nodeDetail(item), primary: item.id === canonicalRootId, relation: related ? relationLabel(related.relation, canonicalRootId) : "graph root", data: { category: related ? relationCategory(related.relation.type) : "root", direction: related?.relation?.from === canonicalRootId ? "outbound" : "inbound" } };
  }), [canonicalRootId, neighbors, root]);
  const graphEdges = useMemo(() => neighbors.map(({ node: item, relation }) => ({ id: relation.id, from: canonicalRootId, to: item.id, type: relationCategory(relation.type), label: relationLabel(relation, canonicalRootId), evidence: relation.evidence?.basis })), [canonicalRootId, neighbors]);
  const selected = index.nodes?.[selectedId] || root;
  const selectedRelation = neighbors.find((item) => item.node.id === selected?.id)?.relation || null;
  const timelineCount = index.indices?.byEntity?.[selected?.id]?.timelineActivityIds?.length || 0;
  const rootTimelineCount = index.indices?.byEntity?.[canonicalRootId]?.timelineActivityIds?.length || 0;
  const selectedRoute = selected ? canonicalRoute(selected) : "";
  const selectNode = ({ nodeId }) => setSelectedId(nodeId);
  const selectEdge = ({ to }) => setSelectedId(to);
  const changeLens = (next) => { if (LENSES.has(next)) { setLens(next); setSelectedId(canonicalRootId); } };
  const graphHeight = Math.max(520, Math.ceil(Math.max(1, neighbors.length) / 4) * 120);

  if (!root) return null;
  return <section className="linked-intelligence" data-linked-intelligence-graph data-root-type={root.type} data-root-id={canonicalRootId} data-lens={lens}>
    <header className="linked-intelligence__header">
      <div><small>Linked intelligence</small><strong>{neighbors.length} visible relationships</strong><span>{rootTimelineCount.toLocaleString()} Timeline records in this reviewed scope</span></div>
      <ControlTabs className="linked-intelligence__lenses" ariaLabel="Choose relationship lens" activeId={lens} onSelect={changeLens} items={LENS_ITEMS} />
    </header>
    <ControlGraph
      className="linked-intelligence__graph"
      style={{ "--linked-intelligence-height": `${graphHeight}px` }}
      nodes={graphNodes}
      edges={graphEdges}
      selected={selected?.id}
      layout="linked-lanes"
      layoutEngine={linkedLayout}
      layoutOptions={{ deconflictPasses: 24, deconflictStrength: 0.82 }}
      nodeTypes={NODE_TYPES}
      panelMode="external"
      a11yMode="screenreader"
      edgeLabelMode="pill"
      canvasLabel="Linked intelligence graph"
      a11yLabel="Linked intelligence relationship index"
      emptyLabel="No retained relationships in this lens"
      onNodeSelect={selectNode}
      onEdgeSelect={selectEdge}
      data-linked-graph-canvas
      data-node-count={graphNodes.length}
    />
    <article className="linked-intelligence__inspector" data-linked-graph-inspector>
      <div className="linked-intelligence__identity"><small>{intelligenceTypeLabel(selected.type)}</small><strong>{selected.label}</strong><span>{nodeDetail(selected)}</span></div>
      {selectedRelation ? <div className="linked-intelligence__evidence"><ControlStatusBadge category="evidence" status={selectedRelation.evidence?.confidence || "source_declared"}>{compact(selectedRelation.evidence?.confidence)}</ControlStatusBadge><span><strong>{relationLabel(selectedRelation, canonicalRootId)}</strong> · {compact(selectedRelation.evidence?.basis)} · {compact(selectedRelation.evidence?.reviewState)}</span>{selectedRelation.validity?.status ? <em>{compact(selectedRelation.validity.status)} · review by {selectedRelation.validity.reviewBy || "not scheduled"}</em> : null}</div> : <p>This entity anchors the visible, bounded relationship neighborhood. Switch lenses to change the relationship class without changing the root.</p>}
      <nav className="if-button-group" aria-label="Selected linked entity actions">
        {selected.id !== canonicalRootId && ROOTABLE_TYPES.has(selected.type) ? <button type="button" className="if-btn if-btn--primary" onClick={() => onRootChange(selected)}><Network size={15} />Explore from here</button> : null}
        {timelineCount ? <a className="if-btn if-btn--secondary" href={timelineRoute("", { scope: "entity", entityType: selected.type, entityId: selected.id, entityLabel: selected.label })}><CalendarClock size={15} />Timeline <small>{timelineCount.toLocaleString()}</small></a> : null}
        {selectedRoute ? <a className="if-btn if-btn--secondary" href={selectedRoute}><ExternalLink size={15} />Open workspace</a> : null}
        {selectedRelation?.evidence?.sourceUrl ? <a className="if-btn if-btn--secondary" href={selectedRelation.evidence.sourceUrl} target="_blank" rel="noreferrer"><ExternalLink size={15} />Cited source</a> : null}
        {selected.id !== canonicalRootId ? <button type="button" className="if-btn if-btn--secondary" onClick={() => setSelectedId(canonicalRootId)}><RotateCcw size={15} />Reset</button> : null}
      </nav>
    </article>
    <footer><span>Only retained relationships are shown. Reviewed command hierarchy is visually and semantically distinct from source-declared acquisition taxonomy.</span><span>{index.metadata?.asOf ? `Evidence as of ${index.metadata.asOf}` : ""}</span></footer>
  </section>;
}
