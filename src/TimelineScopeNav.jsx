import { Network, Star } from "lucide-react";

const activeStyle = { borderColor: "var(--brand)", background: "#e2f1fb", color: "#003f67", boxShadow: "inset 0 0 0 1px rgba(0, 94, 162, 0.12)" };

export function replaceTimelineScope(nextScope, defaultScope) {
  const [route] = window.location.hash.split("?");
  const params = new URLSearchParams(window.location.hash.split("?")[1] || "");
  if (nextScope === defaultScope) params.delete("timelineScope"); else params.set("timelineScope", nextScope);
  window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}${route}${params.size ? `?${params}` : ""}`);
}

export default function TimelineScopeNav({ scope, trackedCount, allCount, onChange }) {
  return <div className="capture-timeline-scope capture-gantt-commandbar__actions" role="group" aria-label="Timeline Scope" data-timeline-scope={scope}>
    <span>Timeline Scope</span>
    <button type="button" style={scope === "tracked" ? activeStyle : undefined} aria-pressed={scope === "tracked"} onClick={() => onChange("tracked")}><Star size={13} aria-hidden="true" fill={scope === "tracked" ? "currentColor" : "none"} />Tracked <small>{trackedCount.toLocaleString()}</small></button>
    <button type="button" style={scope === "all" ? activeStyle : undefined} aria-pressed={scope === "all"} onClick={() => onChange("all")}><Network size={13} aria-hidden="true" />All Intelligence <small>{allCount.toLocaleString()}</small></button>
  </div>;
}
