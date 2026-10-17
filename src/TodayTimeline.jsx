import { ArrowRight, CalendarDays } from "lucide-react";
import { ControlAsyncState } from "control-surface-ui/react";

const styles = { root: { overflow: "hidden", border: "1px solid var(--if-border,#d7dce2)", borderRadius: "var(--if-card-radius)", background: "var(--if-bg-surface,#fff)" }, header: { display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 12, padding: 12, borderBottom: "1px solid var(--if-border,#d7dce2)" }, copy: { display: "grid", gap: 2 }, eyebrow: { color: "var(--if-text-muted,#5f6873)", fontSize: 10, fontWeight: 800, letterSpacing: ".04em", textTransform: "uppercase" }, summary: { margin: 0, color: "var(--if-text-muted,#5f6873)", fontSize: 11 }, axis: { display: "grid", gridTemplateColumns: "1fr 1fr 1fr", padding: "7px 12px", borderBottom: "1px solid var(--if-border,#d7dce2)", color: "var(--if-text-muted,#5f6873)", fontSize: 10, fontWeight: 750 }, items: { display: "grid", padding: "7px 12px 10px" }, item: { display: "grid", gridTemplateColumns: "12px minmax(0,1fr)", alignItems: "center", gap: 9, minHeight: 44, padding: "4px 7px", borderBottom: "1px solid var(--if-border-soft,#e7eaee)", color: "inherit", textDecoration: "none" }, marker: { display: "block", width: 10, height: 10, border: "2px solid #fff", borderRadius: "50%", background: "var(--if-color-info,#315f82)", boxShadow: "0 0 0 1px var(--if-color-info,#315f82)" }, taskMarker: { borderRadius: 2, background: "var(--if-color-warning,#b66b2b)", boxShadow: "0 0 0 1px var(--if-color-warning,#b66b2b)" }, itemCopy: { display: "grid", gap: 1, minWidth: 0 }, meta: { color: "var(--if-text-muted,#5f6873)", fontSize: 10, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } };

function compactDate(value) {
  if (!value) return "Not scheduled";
  return new Date(`${String(value).slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

function trackedTimelineItems(rows, openTasks, startDate, days = 14) {
  const end = new Date(`${startDate}T00:00:00Z`);
  end.setUTCDate(end.getUTCDate() + days);
  const endDate = end.toISOString().slice(0, 10);
  const items = [];
  for (const task of openTasks) {
    const date = String(task.dueAt || "").slice(0, 10);
    if (date && date <= endDate) items.push({ id: `task:${task.recordId}:${task.id}`, date, type: "task", label: task.title, recordId: task.recordId, recordLabel: task.record?.title || task.recordId });
  }
  for (const record of rows) {
    const dated = [...(record.events || []).flatMap((event) => [event.start, event.end]), ...(record.milestones || []).flatMap((event) => [event.start, event.end]), record.solicitationEnd, record.currentEnd, record.potentialEnd].filter((date) => date >= startDate && date <= endDate);
    for (const date of [...new Set(dated)]) items.push({ id: `record:${record.opportunityId}:${date}`, date, type: "milestone", label: date === record.solicitationEnd ? "Response deadline" : date === record.currentEnd ? "Reported term ends" : date === record.potentialEnd ? "Potential term ends" : "Published milestone", recordId: record.opportunityId, recordLabel: record.title });
  }
  return items.sort((left, right) => left.date.localeCompare(right.date) || left.recordLabel.localeCompare(right.recordLabel)).slice(-10);
}

export default function TodayTimeline({ rows, openTasks, today }) {
  const items = trackedTimelineItems(rows, openTasks, today);
  const start = Date.parse(`${today}T00:00:00Z`);
  const dayOffset = (date) => Math.max(0, Math.min(14, Math.round((Date.parse(`${date}T00:00:00Z`) - start) / 86_400_000)));
  return <section style={styles.root} aria-labelledby="my-work-timeline-title" data-my-work-timeline><header style={styles.header}><div style={styles.copy}><small style={styles.eyebrow}>Tracked timeline</small><h3 style={{ margin: 0, fontSize: 18 }} id="my-work-timeline-title">Now + next 14 days</h3><p style={styles.summary}>Overdue tasks, published deadlines, and contract milestones for work you chose to track.</p></div><a className="if-btn if-btn--secondary" href="#/budget-spend/timeline">Open full Timeline<ArrowRight size={15} /></a></header><div style={styles.axis} aria-hidden="true"><span>Now</span><span style={{ textAlign: "center" }}>7 days</span><span style={{ textAlign: "right" }}>14 days</span></div>{items.length ? <div style={styles.items}>{items.map((item) => <a key={item.id} href={`#/budget-spend/timeline?capRecord=${encodeURIComponent(item.recordId)}`} style={{ ...styles.item, marginLeft: `${Math.min(dayOffset(item.date) * 1.5, 20)}%` }} data-timeline-item={item.type}><i style={{ ...styles.marker, ...(item.type === "task" ? styles.taskMarker : {}) }} /><span style={styles.itemCopy}><strong style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.label}</strong><small style={styles.meta}>{compactDate(item.date)}{item.date < today ? " · Overdue" : ""} · {item.recordLabel}</small></span></a>)}</div> : <ControlAsyncState compact state="empty" icon={<CalendarDays size={20} />} title="No urgent or upcoming tracked dates" message="The full Timeline still contains longer-range terms, versions, milestones, and follow-ons." />}</section>;
}
