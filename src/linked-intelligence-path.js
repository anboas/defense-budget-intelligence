const PATH_NODE_TYPES = new Set([
  "activity",
  "award",
  "organization",
  "federal-account",
  "defense-program",
  "program-office",
  "official-role",
  "person",
  "location",
  "contract-vehicle",
]);

const REVIEWED_HIERARCHY_SOURCE = "reviewed-organization-hierarchy";

export function compactRelationship(value, fallback = "Not published") {
  return String(value || fallback).replaceAll("_", " ").replaceAll("-", " ");
}

export function relationCategory(type) {
  if (["organization-part-of", "organization-equivalent-to"].includes(type)) return "hierarchy";
  if (["activity-awarded-as", "activity-contracting-organization", "activity-funding-organization", "activity-recipient", "activity-ordered-under-vehicle"].includes(type)) return "work";
  if (["award-recipient", "award-awarding-organization", "award-funding-organization", "award-funded-by-account"].includes(type)) return "money";
  if (["defense-program-owned-by-program-office", "program-office-part-of-organization"].includes(type)) return "program";
  if (["official-role-at-organization", "person-holds-official-role"].includes(type)) return "people";
  if (["organization-located-at", "organization-operates-at-location", "contracting-activity-at", "funding-activity-at"].includes(type)) return "places";
  return "other";
}

export function relationLabel(relation, fromId) {
  const outbound = relation?.from === fromId;
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
  })[relation?.type] || compactRelationship(relation?.type);
}

function canonicalId(index, id) {
  return index?.indices?.byEntity?.[id]?.canonicalId || id;
}

function relationQualityPenalty(index, relation, nextId, targetId) {
  const confidence = String(relation?.evidence?.confidence || "").toLowerCase();
  const reviewState = String(relation?.evidence?.reviewState || "").toLowerCase();
  let penalty = relation?.evidence?.sourceArtifact === REVIEWED_HIERARCHY_SOURCE ? -0.3 : 0;
  if (["exact", "reviewed"].includes(confidence)) penalty -= 0.15;
  if (["verified", "reviewed"].includes(reviewState)) penalty -= 0.1;
  if (["source_declared", "label_only"].includes(confidence)) penalty += 0.35;
  if (nextId !== targetId) {
    const degree = index?.indices?.byEntity?.[nextId]?.relationIds?.length || 0;
    penalty += Math.min(1.2, Math.log10(degree + 1) * 0.35);
  }
  return penalty;
}

export function summarizeRelationshipCoverage(index, rootId) {
  const root = canonicalId(index, rootId);
  const relationIds = index?.indices?.byEntity?.[root]?.relationIds || [];
  const categories = { hierarchy: 0, work: 0, money: 0, program: 0, people: 0, places: 0, other: 0 };
  const neighbors = new Set();
  const neighborsByCategory = Object.fromEntries(Object.keys(categories).map((key) => [key, new Set()]));
  for (const relationIndex of relationIds) {
    const relation = index?.relations?.[relationIndex];
    if (!relation) continue;
    const neighborId = relation.from === root ? relation.to : relation.from;
    if (!index?.nodes?.[neighborId]) continue;
    const category = relationCategory(relation.type);
    categories[category] += 1;
    neighbors.add(neighborId);
    neighborsByCategory[category].add(neighborId);
  }
  return {
    relationships: relationIds.length,
    neighbors: neighbors.size,
    categories,
    neighborCounts: Object.fromEntries(Object.entries(neighborsByCategory).map(([key, value]) => [key, value.size])),
  };
}

export function findEvidencePath(index, startId, targetId, { maxHops = 4, maxVisited = 5000 } = {}) {
  const start = canonicalId(index, startId);
  const target = canonicalId(index, targetId);
  if (!start || !target || !index?.nodes?.[start] || !index?.nodes?.[target]) return null;
  if (start === target) return { start, target, nodeIds: [start], relations: [], hops: 0, cost: 0 };

  const frontier = [{ id: start, nodeIds: [start], relations: [], cost: 0 }];
  const best = new Map([[`${start}:0`, 0]]);
  let visited = 0;

  while (frontier.length && visited < maxVisited) {
    frontier.sort((left, right) => left.cost - right.cost || left.relations.length - right.relations.length || left.id.localeCompare(right.id));
    const current = frontier.shift();
    visited += 1;
    if (current.id === target) return { start, target, nodeIds: current.nodeIds, relations: current.relations, hops: current.relations.length, cost: current.cost };
    if (current.relations.length >= maxHops) continue;
    const relationIds = index.indices?.byEntity?.[current.id]?.relationIds || [];
    const candidates = relationIds.flatMap((relationIndex) => {
      const relation = index.relations?.[relationIndex];
      if (!relation) return [];
      const nextId = relation.from === current.id ? relation.to : relation.from;
      const node = index.nodes?.[nextId];
      if (!node || !PATH_NODE_TYPES.has(node.type) || current.nodeIds.includes(nextId)) return [];
      return [{ relation, nextId }];
    }).sort((left, right) => left.relation.type.localeCompare(right.relation.type) || left.nextId.localeCompare(right.nextId));

    for (const candidate of candidates) {
      const nextCost = current.cost + 10 + relationQualityPenalty(index, candidate.relation, candidate.nextId, target);
      const nextHops = current.relations.length + 1;
      const stateKey = `${candidate.nextId}:${nextHops}`;
      if (nextCost >= (best.get(stateKey) ?? Number.POSITIVE_INFINITY)) continue;
      const next = {
        id: candidate.nextId,
        nodeIds: [...current.nodeIds, candidate.nextId],
        relations: [...current.relations, candidate.relation],
        cost: nextCost,
      };
      best.set(stateKey, nextCost);
      frontier.push(next);
    }
  }
  return null;
}
