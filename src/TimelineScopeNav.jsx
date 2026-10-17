import { Network, Star } from "lucide-react";

const styles = { nav: { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,320px),1fr))", alignItems: "center", gap: 16, margin: "0 16px 12px", padding: "12px 14px", border: "1px solid var(--border)", borderRadius: "var(--if-card-radius,8px)", background: "var(--panel,#fff)" }, copy: { display: "grid", gap: 3, minWidth: 0 }, summary: { color: "var(--muted)", fontSize: 12, lineHeight: 1.35 }, actions: { display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 6 }, button: { display: "flex", alignItems: "center", justifyContent: "center", gap: 6, minHeight: 44, padding: "7px 10px", border: "1px solid var(--border)", borderRadius: 6, background: "#fff", color: "var(--text)", fontWeight: 750 }, active: { borderColor: "var(--brand)", background: "var(--brand)", color: "#fff" }, count: { padding: "1px 5px", borderRadius: 999, background: "rgba(127,142,153,.16)", fontSize: 10 } };

export function replaceTimelineScope(nextScope, defaultScope) {
  const [route] = window.location.hash.split("?");
  const params = new URLSearchParams(window.location.hash.split("?")[1] || "");
  if (nextScope === defaultScope) params.delete("timelineScope"); else params.set("timelineScope", nextScope);
  window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}${route}${params.size ? `?${params}` : ""}`);
}

export default function TimelineScopeNav({ scope, trackedCount, allCount, onChange }) {
  return <nav style={styles.nav} aria-label="Timeline scope" data-timeline-scope={scope}><div style={styles.copy}><strong>Timeline scope</strong><span style={styles.summary}>Tracked work stays focused. All intelligence uses the same family-first timeline with every matching retained term.</span></div><div style={styles.actions} role="group" aria-label="Choose Timeline scope"><button type="button" style={{ ...styles.button, ...(scope === "tracked" ? styles.active : {}) }} aria-pressed={scope === "tracked"} onClick={() => onChange("tracked")}><Star size={15} fill={scope === "tracked" ? "currentColor" : "none"} />Tracked <b style={styles.count}>{trackedCount.toLocaleString()}</b></button><button type="button" style={{ ...styles.button, ...(scope === "all" ? styles.active : {}) }} aria-pressed={scope === "all"} onClick={() => onChange("all")}><Network size={15} />All intelligence <b style={styles.count}>{allCount.toLocaleString()}</b></button></div></nav>;
}
