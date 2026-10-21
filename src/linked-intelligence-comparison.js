import { relationCategory, relationLabel, summarizeRelationshipCoverage } from "./linked-intelligence-path.js";

function canonicalId(index, id) {
  return index?.indices?.byEntity?.[id]?.canonicalId || id;
}

function scopedWorkSummary(summary, scope) {
  if (!summary) return null;
  if (scope !== "direct") return {
    opportunities: Number(summary.opportunities || 0),
    awards: Number(summary.awards || 0),
    accounts: Number(summary.accounts || 0),
    obligatedAmount: Number(summary.obligatedAmount || 0),
  };
  return {
    opportunities: Number(summary.directOpportunities || 0),
    awards: Number(summary.directAwards || 0),
    accounts: Number(summary.directAccounts || 0),
    obligatedAmount: Number(summary.directObligatedAmount || 0),
  };
}

function retainedNeighbors(index, entityId) {
  const canonical = canonicalId(index, entityId);
  const neighbors = new Map();
  for (const relationIndex of index?.indices?.byEntity?.[canonical]?.relationIds || []) {
    const relation = index?.relations?.[relationIndex];
    if (!relation) continue;
    const neighborId = relation.from === canonical ? relation.to : relation.from;
    const node = index?.nodes?.[neighborId];
    if (!node) continue;
    const entry = neighbors.get(neighborId) || { node, categories: new Set(), relations: [] };
    entry.categories.add(relationCategory(relation.type));
    entry.relations.push(relation);
    neighbors.set(neighborId, entry);
  }
  return neighbors;
}

function entityProfile(index, entityId, scope) {
  const id = canonicalId(index, entityId);
  const node = index?.nodes?.[id];
  if (!node) return null;
  const entityIndex = index?.indices?.byEntity?.[id] || {};
  const coverage = summarizeRelationshipCoverage(index, id);
  return {
    id,
    node,
    timelineIds: [...new Set(entityIndex.timelineActivityIds || [])],
    work: scopedWorkSummary(entityIndex.workSummary, scope),
    coverage,
    neighbors: retainedNeighbors(index, id),
  };
}

function reviewedRelationship(index, left, right) {
  if (left.node.type !== "organization" || right.node.type !== "organization") return "";
  const leftHierarchy = index?.indices?.byEntity?.[left.id]?.hierarchy;
  const rightHierarchy = index?.indices?.byEntity?.[right.id]?.hierarchy;
  if (!leftHierarchy || !rightHierarchy) return "";
  if ((leftHierarchy.descendantIds || []).includes(right.id)) return `${right.node.label} sits inside ${left.node.label}'s reviewed structure.`;
  if ((rightHierarchy.descendantIds || []).includes(left.id)) return `${left.node.label} sits inside ${right.node.label}'s reviewed structure.`;
  const commonParentId = (leftHierarchy.parentIds || []).find((id) => (rightHierarchy.parentIds || []).includes(id));
  if (commonParentId && index.nodes?.[commonParentId]) return `Reviewed peers under ${index.nodes[commonParentId].label}.`;
  const commonAncestorId = (leftHierarchy.ancestorIds || []).find((id) => (rightHierarchy.ancestorIds || []).includes(id));
  if (commonAncestorId && index.nodes?.[commonAncestorId]) return `Share reviewed ancestor ${index.nodes[commonAncestorId].label}.`;
  return "No reviewed parent-child relationship is asserted between these organizations.";
}

export function compareLinkedEntities(index, leftId, rightId, { scope = "subtree", sharedLimit = 8 } = {}) {
  const left = entityProfile(index, leftId, scope);
  const right = entityProfile(index, rightId, scope);
  if (!left || !right || left.id === right.id) return null;
  const leftTimeline = new Set(left.timelineIds);
  const rightTimeline = new Set(right.timelineIds);
  const sharedTimelineIds = [...leftTimeline].filter((id) => rightTimeline.has(id)).sort();
  const directRelations = [...(left.neighbors.get(right.id)?.relations || [])];
  const sharedNeighbors = [...left.neighbors.entries()]
    .flatMap(([id, leftEntry]) => {
      const rightEntry = right.neighbors.get(id);
      if (!rightEntry || id === left.id || id === right.id) return [];
      return [{
        id,
        node: leftEntry.node,
        leftCategories: [...leftEntry.categories].sort(),
        rightCategories: [...rightEntry.categories].sort(),
      }];
    })
    .sort((a, b) => String(a.node.type).localeCompare(String(b.node.type)) || String(a.node.label).localeCompare(String(b.node.label)));
  return {
    left,
    right,
    scope,
    sharedTimelineIds,
    sharedNeighbors: sharedNeighbors.slice(0, sharedLimit),
    sharedNeighborCount: sharedNeighbors.length,
    leftUniqueNeighborCount: [...left.neighbors.keys()].filter((id) => !right.neighbors.has(id)).length,
    rightUniqueNeighborCount: [...right.neighbors.keys()].filter((id) => !left.neighbors.has(id)).length,
    directRelations: directRelations.map((relation) => ({ relation, label: relationLabel(relation, left.id) })),
    reviewedRelationship: reviewedRelationship(index, left, right),
  };
}
