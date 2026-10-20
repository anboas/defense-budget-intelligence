function reviewedHierarchy(index, entityId) {
  return index?.indices?.byEntity?.[entityId]?.hierarchy || null;
}

export function reviewedHierarchyTrail(index, entityId) {
  const trail = [];
  const visited = new Set();
  let currentId = entityId;
  while (currentId && !visited.has(currentId)) {
    const node = index?.nodes?.[currentId];
    const hierarchy = reviewedHierarchy(index, currentId);
    if (!node || node.type !== "organization" || !hierarchy) return [];
    visited.add(currentId);
    trail.unshift(node);
    currentId = hierarchy.parentIds?.[0] || "";
  }
  return trail;
}

export function reviewedHierarchyPeers(index, entityId) {
  const trail = reviewedHierarchyTrail(index, entityId);
  const parent = trail.at(-2);
  if (!parent) return [];
  return (reviewedHierarchy(index, parent.id)?.childIds || [])
    .filter((id) => id !== entityId)
    .map((id) => index?.nodes?.[id])
    .filter(Boolean)
    .sort((left, right) => String(left.label).localeCompare(String(right.label)));
}
