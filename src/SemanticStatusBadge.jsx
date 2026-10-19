import { ControlStatusBadge } from "control-surface-ui/react";

const DEFINITIONS = {
  workflow: {
    track: ["Track", "info"], tracked: ["Tracked", "info"], active: ["Active", "active"], published: ["Published", "active"], queued: ["Queued", "pending"], monitor: ["Monitor", "neutral"], qualify: ["Qualify", "review"], pursuit: ["Pursue", "active"], pursue: ["Pursue", "active"], waiting: ["Waiting", "pending"], todo: ["To do", "pending"], "in-progress": ["In progress", "active"], completed: ["Complete", "completed"], complete: ["Complete", "completed"], done: ["Complete", "completed"], blocked: ["Blocked", "danger"], cancelled: ["Cancelled", "neutral"],
  },
  evidence: {
    verified: ["Verified", "verified"], supported: ["Supported", "active"], "source-backed": ["Source backed", "active"], partial: ["Partial", "warning"], review: ["Review", "review"], gap: ["Evidence gap", "danger"], unclassified: ["Unclassified", "neutral"], unknown: ["Unknown", "neutral"],
  },
  health: {
    healthy: ["Healthy", "verified"], current: ["Current", "verified"], unchanged: ["Unchanged", "verified"], ready: ["Ready", "verified"], running: ["Running", "active"], delayed: ["Delayed", "warning"], stale: ["Stale", "warning"], changed: ["Changed", "warning"], degraded: ["Degraded", "warning"], failed: ["Failed", "danger"], danger: ["Failed", "danger"], unavailable: ["Unavailable", "danger"], idle: ["Idle", "neutral"],
  },
  urgency: {
    overdue: ["Overdue", "danger"], "due-soon": ["Due soon", "warning"], urgent: ["Urgent", "danger"], upcoming: ["Upcoming", "info"], monitor: ["Monitor", "neutral"], none: ["No deadline", "neutral"],
  },
};

function title(value) {
  return String(value || "Unknown").replaceAll("_", " ").replaceAll("-", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function semanticStatus(category, value, label) {
  const key = String(value || "unknown").toLowerCase().replaceAll("_", "-").trim();
  const definition = DEFINITIONS[category]?.[key];
  return { category, key, label: label || definition?.[0] || title(value), tone: definition?.[1] || "neutral" };
}

export default function SemanticStatusBadge({ category, value, label, ...props }) {
  const status = semanticStatus(category, value, label);
  return <span data-semantic-status={status.category} data-semantic-status-value={status.key}><ControlStatusBadge {...props} status={status.tone} label={status.label} /></span>;
}
