export const GRAPH_DOWNLOADS = [
  ["Organization dossiers and research queues", "organization-intelligence.json"],
  ["Organization Watch observations", "organization-change-monitor.json"],
  ["People, industrial-base, document, and operations intelligence", "roadmap-intelligence.json"],
  ["Program intelligence", "program-intelligence.json"],
  ["Legislative traceability", "legislative-traceability.json"],
  ["Strategic evidence", "strategic-intelligence.json"],
  ["Priority award actions", "priority-award-actions.json"],
  ["Organization identity review", "organization-identity-review.json"],
  ["Contract lineage review", "contract-lineage-review.json"],
  ["Temporal and conflict review", "temporal-evidence-review.json"],
];

export function sourceProbeDateTime(value) {
  return new Date(value).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
