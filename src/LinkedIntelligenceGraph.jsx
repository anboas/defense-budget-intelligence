import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { CalendarClock, ExternalLink, Network, RotateCcw } from "lucide-react";
import { ControlGraph } from "control-surface-ui/react/graph";
import { ControlStatusBadge, ControlTabs } from "control-surface-ui/react";
import { accountFlowRoute, awardsRoute, intelligenceWorkspaceRoute, mapLocationRoute, opportunityRoute, timelineRoute } from "./cross-surface-routes.js";
import { intelligenceTypeLabel } from "./intelligence-search.js";
import { compactRelationship, findEvidencePath, relationCategory, relationLabel, summarizeRelationshipCoverage } from "./linked-intelligence-path.js";
import "./control-graph.css";
import "./LinkedIntelligenceGraph.css";

const OrganizationStructureControls = lazy(() => import("./OrganizationStructureControls.jsx"));

const ROOTABLE_TYPES = new Set(["organization", "federal-account", "defense-program", "program-office", "activity", "award"]);
const LENSES = new Set(["structure", "overview", "hierarchy", "work", "money", "organization"]);
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

function lensAllows(lens, category) {
  if (lens === "overview") return ["hierarchy", "work", "money", "program"].includes(category);
  if (lens === "hierarchy") return ["hierarchy", "program"].includes(category);
  if (lens === "work") return category === "work";
  if (lens === "money") return category === "money";
  return ["people", "places"].includes(category);
}

function nodeDetail(node) {
  if (node.type === "organization") return [compactRelationship(node.kind), node.legalName && node.legalName !== node.label ? `Legal name: ${node.legalName}` : "", node.identity?.identifiers?.officeCode ? `DoDAAC ${node.identity.identifiers.officeCode}` : "", compactRelationship(node.reviewState)].filter(Boolean).join(" · ");
  if (node.type === "activity") return [node.reference, compactRelationship(node.lifecycle), compactRelationship(node.mode)].filter(Boolean).join(" · ");
  if (node.type === "award") return [node.piid, node.recipient, money(node.obligatedAmount), node.endDate].filter(Boolean).join(" · ");
  if (node.type === "federal-account") return [node.federalAccountCode, node.bureauName, money(node.obligatedAmount)].filter(Boolean).join(" · ");
  if (node.type === "defense-program") return [compactRelationship(node.programKind), node.organization, ...(node.budgetLineCodes || [])].filter(Boolean).join(" · ");
  if (node.type === "program-office") return [node.organization, compactRelationship(node.roleType)].filter(Boolean).join(" · ");
  if (node.type === "official-role") return [node.title, node.organizationName, compactRelationship(node.status)].filter(Boolean).join(" · ");
  if (node.type === "location") return [node.city, node.state, compactRelationship(node.kind)].filter(Boolean).join(" · ");
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

function pathLayout({ nodes = [] }) {
  const span = nodes.length > 1 ? 76 / (nodes.length - 1) : 0;
  return {
    coordinateSpace: "percent",
    layout: "linked-path-horizontal",
    nodes: nodes.map((node, index) => ({
      id: node.id,
      x: 12 + span * index,
      y: 50,
    })),
  };
}

function compactPathLayout({ nodes = [] }) {
  const span = nodes.length > 1 ? 72 / (nodes.length - 1) : 0;
  return {
    coordinateSpace: "percent",
    layout: "linked-path-vertical",
    nodes: nodes.map((node, index) => ({
      id: node.id,
      x: 50,
      y: 14 + span * index,
    })),
  };
}

function lensItems(summary, hasHierarchy) {
  const count = (categories) => categories.reduce((total, category) => total + (summary.neighborCounts[category] || 0), 0);
  return [
    ...(hasHierarchy ? [["structure", "Structure"]] : []),
    ["overview", `Overview ${count(["hierarchy", "work", "money", "program"])}`],
    ["hierarchy", `Hierarchy ${count(["hierarchy", "program"])}`],
    ["work", `Work ${count(["work"])}`],
    ["money", `Money ${count(["money"])}`],
    ["organization", `People & places ${count(["people", "places"])}`],
  ];
}

const STRUCTURE_GROUPS = new Map([
  ["all", () => true],
  ["services", (node) => ["military-department", "service"].includes(node.tier)],
  ["joint", (node) => node.tier === "combatant-command" || node.family === "joint"],
  ["agencies", (node) => ["defense-agency", "principal-component"].includes(node.tier)],
  ["commands", (node) => ["major-command", "component"].includes(node.tier)],
]);
const MAX_STRUCTURE_ROWS = 12;

function organizationStructure(index, rootId, { depth = "2", group = "services", status = "current", workOnly = false } = {}) {
  const root = index.nodes[rootId];
  const rootHierarchy = index.indices?.byEntity?.[rootId]?.hierarchy;
  if (!root || !rootHierarchy) return { nodes: [], relations: [], total: 0, matching: 0 };
  const maxDepth = depth === "all" ? Number.POSITIVE_INFINITY : Number(depth || 1);
  const levels = new Map([[rootId, 0]]);
  const parents = new Map();
  const queue = [rootId];
  while (queue.length) {
    const parentId = queue.shift();
    const level = levels.get(parentId) || 0;
    if (level >= maxDepth) continue;
    for (const childId of index.indices?.byEntity?.[parentId]?.hierarchy?.childIds || []) {
      if (!levels.has(childId) || levels.get(childId) > level + 1) levels.set(childId, level + 1);
      parents.set(childId, parentId);
      queue.push(childId);
    }
  }
  const matchesGroup = STRUCTURE_GROUPS.get(group) || STRUCTURE_GROUPS.get("all");
  const matchesStatus = (node) => status === "all" || (status === "current" ? String(node.status || "current").startsWith("current") : node.status === status);
  const matchesWork = (id) => !workOnly || Number(index.indices?.byEntity?.[id]?.workSummary?.opportunities || 0) > 0;
  const matched = [...levels.keys()].filter((id) => id !== rootId && matchesGroup(index.nodes[id]) && matchesStatus(index.nodes[id]) && matchesWork(id));
  const visible = new Set([rootId]);
  for (const id of matched) {
    let cursor = id;
    while (cursor && levels.has(cursor)) {
      visible.add(cursor);
      cursor = parents.get(cursor);
    }
  }
  const bounded = [...visible].sort((left, right) => (levels.get(left) || 0) - (levels.get(right) || 0) || String(index.nodes[left]?.label).localeCompare(String(index.nodes[right]?.label))).slice(0, 36);
  const boundedIds = new Set(bounded);
  const relations = index.relations.filter((relation) => relation.type === "organization-part-of" && boundedIds.has(relation.from) && boundedIds.has(relation.to) && relation.evidence?.sourceArtifact === "reviewed-organization-hierarchy");
  return { nodes: bounded.map((id) => ({ node: index.nodes[id], depth: levels.get(id) || 0 })), relations, total: levels.size - 1, matching: matched.length };
}

function structurePositions(nodes = []) {
  const levels = new Map();
  for (const row of nodes) {
    const depth = Number(row.depth || 0);
    levels.set(depth, [...(levels.get(depth) || []), row.node]);
  }
  const columnCounts = new Map([...levels].map(([depth, items]) => [depth, Math.max(1, Math.ceil(items.length / MAX_STRUCTURE_ROWS))]));
  const totalColumns = [...columnCounts.values()].reduce((total, count) => total + count, 0);
  const xStep = totalColumns > 1 ? 80 / (totalColumns - 1) : 0;
  let columnOffset = 0;
  const positioned = new Map();
  for (const [depth, items] of levels) {
    const columns = columnCounts.get(depth) || 1;
    for (let column = 0; column < columns; column += 1) {
      const rows = items.slice(column * MAX_STRUCTURE_ROWS, (column + 1) * MAX_STRUCTURE_ROWS);
      const x = 8 + (columnOffset + column) * xStep;
      const positions = rows.length === 1 ? [50] : rows.map((_, index) => 6 + ((index + 1) / (rows.length + 1)) * 88);
      rows.forEach((item, index) => positioned.set(item.id, { x, y: positions[index] }));
    }
    columnOffset += columns;
  }
  return positioned;
}

function structureLayout({ nodes = [] }) {
  return { coordinateSpace: "percent", layout: "reviewed-organization-structure", nodes: nodes.map((node) => ({ id: node.id, x: node.x, y: node.y })) };
}

function workDetail(summary, overlay) {
  if (!summary || overlay === "none") return "";
  if (overlay === "opportunities") return `${Number(summary.opportunities || 0).toLocaleString()} opportunities`;
  if (overlay === "awards") return `${Number(summary.awards || 0).toLocaleString()} awards`;
  return money(summary.obligatedAmount || 0);
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

export default function LinkedIntelligenceGraph({ index, rootId, targetId = "", initialStructure = {}, onStructureChange, onRootChange }) {
  const canonicalRootId = index.indices?.byEntity?.[rootId]?.canonicalId || rootId;
  const canonicalTargetId = index.indices?.byEntity?.[targetId]?.canonicalId || targetId;
  const root = index.nodes?.[canonicalRootId];
  const target = canonicalTargetId ? index.nodes?.[canonicalTargetId] : null;
  const connectionPath = useMemo(() => target ? findEvidencePath(index, canonicalRootId, canonicalTargetId) : null, [canonicalRootId, canonicalTargetId, index, target]);
  const traceMode = Boolean(target);
  const coverage = useMemo(() => summarizeRelationshipCoverage(index, canonicalRootId), [canonicalRootId, index]);
  const hasHierarchy = root?.type === "organization" && Boolean(index.indices?.byEntity?.[canonicalRootId]?.hierarchy);
  const [lens, setLens] = useState(hasHierarchy ? "structure" : "overview");
  const [structureDepth, setStructureDepth] = useState(["1", "2", "all"].includes(initialStructure.depth) ? initialStructure.depth : "2");
  const [structureGroup, setStructureGroup] = useState(STRUCTURE_GROUPS.has(initialStructure.group) ? initialStructure.group : "services");
  const [structureStatus, setStructureStatus] = useState(["current", "all"].includes(initialStructure.status) ? initialStructure.status : "current");
  const [workOnly, setWorkOnly] = useState(Boolean(initialStructure.workOnly));
  const [workOverlay, setWorkOverlay] = useState(["none", "opportunities", "awards", "obligations"].includes(initialStructure.workOverlay) ? initialStructure.workOverlay : "opportunities");
  const [selectedId, setSelectedId] = useState(canonicalTargetId || canonicalRootId);
  const [compactTrace, setCompactTrace] = useState(() => typeof window !== "undefined" && window.matchMedia("(max-width: 760px)").matches);
  useEffect(() => {
    const query = window.matchMedia("(max-width: 760px)");
    const update = () => setCompactTrace(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  const structure = useMemo(() => organizationStructure(index, canonicalRootId, { depth: structureDepth, group: structureGroup, status: structureStatus, workOnly }), [canonicalRootId, index, structureDepth, structureGroup, structureStatus, workOnly]);
  const structureCoordinates = useMemo(() => structurePositions(structure.nodes), [structure.nodes]);
  const structureMode = lens === "structure" && hasHierarchy;
  const relations = useMemo(() => structureMode ? structure.relations : selectRelations(index, canonicalRootId, lens), [canonicalRootId, index, lens, structure, structureMode]);
  const neighbors = useMemo(() => {
    const seen = new Set();
    return relations.flatMap((relation) => {
      const id = relation.from === canonicalRootId ? relation.to : relation.from;
      if (seen.has(id) || !index.nodes?.[id]) return [];
      seen.add(id);
      return [{ node: index.nodes[id], relation }];
    });
  }, [canonicalRootId, index.nodes, relations]);
  const graphNodes = useMemo(() => {
    if (traceMode) {
      const nodeIds = connectionPath?.nodeIds || [canonicalRootId, canonicalTargetId].filter(Boolean);
      return nodeIds.map((id, indexValue) => {
        const item = index.nodes?.[id];
        const relation = indexValue ? connectionPath?.relations?.[indexValue - 1] : null;
        const priorId = indexValue ? nodeIds[indexValue - 1] : "";
        return item ? { id: item.id, kind: item.type, label: short(item.label), meta: intelligenceTypeLabel(item.type), description: nodeDetail(item), primary: item.id === canonicalRootId, relation: relation ? relationLabel(relation, priorId) : "trace origin", data: { category: relation ? relationCategory(relation.type) : "root", direction: relation?.from === priorId ? "outbound" : "inbound", pathStep: indexValue } } : null;
      }).filter(Boolean);
    }
    if (structureMode) return structure.nodes.map(({ node: item, depth }) => {
      const summary = index.indices?.byEntity?.[item.id]?.workSummary;
      const coordinates = structureCoordinates.get(item.id) || { x: 50, y: 50 };
      return { id: item.id, kind: item.type, label: item.label, meta: [compactRelationship(item.tier || item.kind), workDetail(summary, workOverlay)].filter(Boolean).join(" · "), description: nodeDetail(item), primary: item.id === canonicalRootId, relation: depth ? "part of reviewed structure" : "structure root", x: coordinates.x, y: coordinates.y };
    });
    return [root, ...neighbors.map((item) => item.node)].filter(Boolean).map((item) => {
      const related = neighbors.find((candidate) => candidate.node.id === item.id);
      return { id: item.id, kind: item.type, label: short(item.label), meta: intelligenceTypeLabel(item.type), description: nodeDetail(item), primary: item.id === canonicalRootId, relation: related ? relationLabel(related.relation, canonicalRootId) : "graph root", data: { category: related ? relationCategory(related.relation.type) : "root", direction: related?.relation?.from === canonicalRootId ? "outbound" : "inbound" } };
    });
  }, [canonicalRootId, canonicalTargetId, connectionPath, index.indices?.byEntity, index.nodes, neighbors, root, structure.nodes, structureCoordinates, structureMode, traceMode, workOverlay]);
  const graphEdges = useMemo(() => {
    if (traceMode) return (connectionPath?.relations || []).map((relation, indexValue) => ({ id: relation.id, from: connectionPath.nodeIds[indexValue], to: connectionPath.nodeIds[indexValue + 1], type: relationCategory(relation.type), label: relationLabel(relation, connectionPath.nodeIds[indexValue]), evidence: relation.evidence?.basis }));
    if (structureMode) return structure.relations.map((relation) => ({ id: relation.id, from: relation.to, to: relation.from, type: "hierarchy", label: compactRelationship(relation.attributes?.relationshipClass || "contains"), evidence: relation.evidence?.basis }));
    return neighbors.map(({ node: item, relation }) => ({ id: relation.id, from: canonicalRootId, to: item.id, type: relationCategory(relation.type), label: relationLabel(relation, canonicalRootId), evidence: relation.evidence?.basis }));
  }, [canonicalRootId, connectionPath, neighbors, structure.relations, structureMode, traceMode]);
  const visibleSelectedId = structureMode && !graphNodes.some((node) => node.id === selectedId) ? canonicalRootId : selectedId;
  const selected = index.nodes?.[visibleSelectedId] || root;
  const selectedPathIndex = connectionPath?.nodeIds?.indexOf(selected?.id) ?? -1;
  const selectedPathRelation = selectedPathIndex > 0 ? connectionPath.relations[selectedPathIndex - 1] : null;
  const selectedPathOriginId = selectedPathIndex > 0 ? connectionPath.nodeIds[selectedPathIndex - 1] : canonicalRootId;
  const structureRelation = structureMode ? structure.relations.find((relation) => relation.from === selected?.id || relation.to === selected?.id) : null;
  const selectedRelation = traceMode ? selectedPathRelation : structureMode ? structureRelation : neighbors.find((item) => item.node.id === selected?.id)?.relation || null;
  const relationOriginId = traceMode ? selectedPathOriginId : structureMode && structureRelation ? (structureRelation.from === selected?.id ? structureRelation.to : structureRelation.from) : canonicalRootId;
  const timelineCount = index.indices?.byEntity?.[selected?.id]?.timelineActivityIds?.length || 0;
  const rootTimelineCount = index.indices?.byEntity?.[canonicalRootId]?.timelineActivityIds?.length || 0;
  const selectedRoute = selected ? canonicalRoute(selected) : "";
  const selectedWork = index.indices?.byEntity?.[selected?.id]?.workSummary;
  const selectedSourceUrl = selectedRelation?.evidence?.sourceUrl || selected?.hierarchySourceUrl || "";
  const selectNode = ({ nodeId }) => setSelectedId(nodeId);
  const selectEdge = ({ to }) => setSelectedId(to);
  const changeLens = (next) => { if (LENSES.has(next)) { setLens(next); setSelectedId(canonicalRootId); } };
  const changeStructure = (key, value) => {
    const next = { depth: structureDepth, group: structureGroup, status: structureStatus, workOnly, workOverlay, [key]: value };
    if (key === "depth") setStructureDepth(value);
    if (key === "group") setStructureGroup(value);
    if (key === "status") setStructureStatus(value);
    if (key === "workOnly") setWorkOnly(value);
    if (key === "workOverlay") setWorkOverlay(value);
    onStructureChange?.(next);
  };
  const widestStructureLane = structureMode ? Math.max(1, ...Object.values(structure.nodes.reduce((groups, row) => ({ ...groups, [row.depth]: Number(groups[row.depth] || 0) + 1 }), {})).map((count) => Math.min(MAX_STRUCTURE_ROWS, count))) : 0;
  const graphHeight = traceMode ? (compactTrace ? 620 : 480) : structureMode ? (widestStructureLane > 5 ? Math.min(2500, widestStructureLane * 195) : 560) : Math.max(520, Math.ceil(Math.max(1, neighbors.length) / 4) * 120);
  const availableInLens = lens === "overview"
    ? ["hierarchy", "work", "money", "program"].reduce((total, category) => total + coverage.neighborCounts[category], 0)
    : lens === "hierarchy"
      ? coverage.neighborCounts.hierarchy + coverage.neighborCounts.program
      : lens === "organization"
        ? coverage.neighborCounts.people + coverage.neighborCounts.places
        : coverage.neighborCounts[lens] || 0;

  if (!root) return null;
  return <section className="linked-intelligence" data-linked-intelligence-graph data-root-type={root.type} data-root-id={canonicalRootId} data-lens={traceMode ? "connection" : lens} data-graph-mode={traceMode ? "connection" : "neighborhood"} data-path-orientation={traceMode ? (compactTrace ? "vertical" : "horizontal") : undefined} data-connection-hops={connectionPath?.hops ?? "none"}>
    <header className="linked-intelligence__header">
      {traceMode ? <div><small>Connection trace</small><strong>{connectionPath ? `${connectionPath.hops} evidence-backed ${connectionPath.hops === 1 ? "step" : "steps"}` : "No retained path within four steps"}</strong><span>{root.label} → {target.label}</span></div> : structureMode ? <div><small>Reviewed structure</small><strong>{structure.nodes.length} of {structure.matching.toLocaleString()} matching organizations shown</strong><span>{structure.total.toLocaleString()} reviewed descendants · {rootTimelineCount.toLocaleString()} linked Timeline records</span></div> : <div><small>Linked intelligence</small><strong>{neighbors.length} of {availableInLens.toLocaleString()} linked entities shown</strong><span>{coverage.relationships.toLocaleString()} retained relationships · {rootTimelineCount.toLocaleString()} Timeline records</span></div>}
      {!traceMode ? <ControlTabs className="linked-intelligence__lenses" ariaLabel="Choose relationship lens" activeId={lens} onSelect={changeLens} items={lensItems(coverage, hasHierarchy)} /> : null}
    </header>
    {structureMode ? <Suspense fallback={null}><OrganizationStructureControls depth={structureDepth} group={structureGroup} status={structureStatus} workOnly={workOnly} workOverlay={workOverlay} onDepthChange={(value) => changeStructure("depth", value)} onGroupChange={(value) => changeStructure("group", value)} onStatusChange={(value) => changeStructure("status", value)} onWorkOnlyChange={(value) => changeStructure("workOnly", value)} onWorkOverlayChange={(value) => changeStructure("workOverlay", value)} /></Suspense> : null}
    <ControlGraph
      className="linked-intelligence__graph"
      style={{ "--linked-intelligence-height": `${graphHeight}px` }}
      nodes={graphNodes}
      edges={graphEdges}
      selected={traceMode ? null : selected?.id}
      layout={traceMode ? (compactTrace ? "linked-path-vertical" : "linked-path-horizontal") : structureMode ? "reviewed-organization-structure" : "linked-lanes"}
      layoutEngine={traceMode ? (compactTrace ? compactPathLayout : pathLayout) : structureMode ? structureLayout : linkedLayout}
      layoutOptions={traceMode ? { deconflictPasses: 18, deconflictStrength: 0.72 } : { deconflictPasses: 24, deconflictStrength: 0.82 }}
      nodeTypes={NODE_TYPES}
      panelMode="external"
      a11yMode="screenreader"
      edgeLabelMode="pill"
      canvasLabel="Linked intelligence graph"
      a11yLabel="Linked intelligence relationship index"
      emptyLabel={traceMode ? "No retained connection within four evidence-backed steps" : "No retained relationships in this lens"}
      onNodeSelect={selectNode}
      onEdgeSelect={selectEdge}
      data-linked-graph-canvas
      data-node-count={graphNodes.length}
    />
    {traceMode ? <section className="linked-intelligence__path" aria-label="Connection evidence path" data-connection-path>
      {connectionPath ? <ol>{connectionPath.relations.map((relation, indexValue) => {
        const from = index.nodes[connectionPath.nodeIds[indexValue]];
        const to = index.nodes[connectionPath.nodeIds[indexValue + 1]];
        return <li key={relation.id} data-connection-step>
          <span className="linked-intelligence__path-index">{indexValue + 1}</span>
          <div><strong>{from.label}</strong><span>{relationLabel(relation, from.id)}</span><strong>{to.label}</strong></div>
          <div className="linked-intelligence__path-evidence"><ControlStatusBadge category="evidence" status={relation.evidence?.confidence || "source_declared"}>{compactRelationship(relation.evidence?.confidence)}</ControlStatusBadge><span>{compactRelationship(relation.evidence?.basis)} · {compactRelationship(relation.evidence?.reviewState)}</span>{relation.evidence?.sourceUrl ? <a href={relation.evidence.sourceUrl} target="_blank" rel="noreferrer" aria-label={`Open source for step ${indexValue + 1}`}><ExternalLink size={13} />Source</a> : null}</div>
        </li>;
      })}</ol> : <div className="linked-intelligence__path-empty"><strong>No retained connection found</strong><span>Try a different target. The trace stops after four evidence-backed steps and never invents missing links.</span></div>}
    </section> : null}
    <article className="linked-intelligence__inspector" data-linked-graph-inspector>
      <div className="linked-intelligence__identity"><small>{intelligenceTypeLabel(selected.type)}</small><strong>{selected.label}</strong><span>{nodeDetail(selected)}</span></div>
      {selectedRelation ? <div className="linked-intelligence__evidence"><ControlStatusBadge category="evidence" status={selectedRelation.evidence?.confidence || "source_declared"}>{compactRelationship(selectedRelation.evidence?.confidence)}</ControlStatusBadge><span><strong>{relationLabel(selectedRelation, relationOriginId)}</strong> · {compactRelationship(selectedRelation.evidence?.basis)} · {compactRelationship(selectedRelation.evidence?.reviewState)}</span>{selectedRelation.validity?.status ? <em>{compactRelationship(selectedRelation.validity.status)} · review by {selectedRelation.validity.reviewBy || "not scheduled"}</em> : null}</div> : <p>{traceMode ? "The trace prefers the fewest retained steps, then stronger evidence and less ambiguous intermediate hubs." : "This entity anchors the visible, bounded relationship neighborhood. Switch lenses to change the relationship class without changing the root."}</p>}
      {selectedWork ? <div className="linked-intelligence__work-summary" aria-label="Selected organization linked work"><span><strong>{selectedWork.opportunities.toLocaleString()}</strong> opportunities</span><span><strong>{selectedWork.awards.toLocaleString()}</strong> awards</span><span><strong>{selectedWork.accounts.toLocaleString()}</strong> accounts</span><span><strong>{money(selectedWork.obligatedAmount)}</strong> obligations</span></div> : null}
      <nav className="if-button-group" aria-label="Selected linked entity actions">
        {selected.id !== canonicalRootId && ROOTABLE_TYPES.has(selected.type) ? <button type="button" className="if-btn if-btn--primary" onClick={() => onRootChange(selected)}><Network size={15} />Explore from here</button> : null}
        {timelineCount ? <a className="if-btn if-btn--secondary" href={timelineRoute("", { scope: "entity", entityType: selected.type, entityId: selected.id, entityLabel: selected.label })}><CalendarClock size={15} />Timeline <small>{timelineCount.toLocaleString()}</small></a> : null}
        {selectedRoute ? <a className="if-btn if-btn--secondary" href={selectedRoute}><ExternalLink size={15} />Open workspace</a> : null}
        {selectedSourceUrl ? <a className="if-btn if-btn--secondary" href={selectedSourceUrl} target="_blank" rel="noreferrer"><ExternalLink size={15} />Cited source</a> : null}
        {selected.id !== canonicalRootId ? <button type="button" className="if-btn if-btn--secondary" onClick={() => setSelectedId(canonicalRootId)}><RotateCcw size={15} />Reset</button> : null}
      </nav>
    </article>
    <footer><span>{traceMode ? "Connection traces use only retained relationships and stop after four steps. Each step exposes its evidence basis." : structureMode ? index.metadata?.reviewedHierarchy?.coverageStatement : "Only retained relationships are shown. Reviewed command hierarchy is visually and semantically distinct from source-declared acquisition taxonomy."}</span><span>{index.metadata?.asOf ? `Evidence as of ${index.metadata.asOf}` : ""}</span></footer>
  </section>;
}
