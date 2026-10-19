import { useEffect, useMemo, useState } from "react";
import { ArrowRight, CalendarClock, CheckCircle2, ExternalLink, Filter, ListChecks, MoreHorizontal, Network } from "lucide-react";
import {
  ControlCalendarDay,
  ControlCalendarFooter,
  ControlCalendarGrid,
  ControlCalendarHeader,
  ControlCalendarItem,
  ControlCalendarSurface,
  ControlCalendarViewSwitcher,
  ControlDialog,
  ControlMenu,
  ControlTabs,
} from "control-surface-ui/react";
import SemanticStatusBadge from "./SemanticStatusBadge.jsx";
import { useAuth } from "./AuthContext.jsx";
import { useNotifications } from "./NotificationContext.jsx";
import { intelligenceGraphRoute, opportunityRoute, timelineRoute } from "./cross-surface-routes.js";
import { emptyProcurementFeed, loadProcurementFeed } from "./procurement-discovery.js";
import { normalizePursuit } from "./pursuit-metadata.js";
import "./TodayWorkspace.css";

const DAY = 86_400_000;
const PRIORITY_SCORE = { critical: 50, high: 35, normal: 20, low: 10 };
const LENSES = ["Summary", "Timeline", "Evidence", "Money", "Tasks"];

function dayKey(value) {
  if (!value) return "";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString().slice(0, 10);
}

function compactDate(value, fallback = "Not scheduled") {
  const key = dayKey(value);
  if (!key) return fallback;
  return new Date(`${key}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

function shortText(value, fallback, limit = 260) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text) return fallback;
  return text.length > limit ? `${text.slice(0, limit - 1).trim()}…` : text;
}

function recordId(record) {
  return record?.opportunityId || record?.sourceRecordId || record?.id || record?.reference || "";
}

function recordDates(record) {
  return [
    ...(record?.events || []).flatMap((event) => [event.start, event.end]),
    ...(record?.milestones || []).flatMap((event) => [event.start, event.end]),
    record?.solicitationEnd,
    record?.currentEnd,
    record?.potentialEnd,
  ].map(dayKey).filter(Boolean);
}

function nextMilestone(record, today) {
  const date = [...new Set(recordDates(record))].filter((value) => value >= today).sort()[0] || "";
  if (!date) return { date: "", label: "No published date" };
  const label = date === dayKey(record?.solicitationEnd) ? "Response" : date === dayKey(record?.currentEnd) ? "Term end" : date === dayKey(record?.potentialEnd) ? "Potential end" : "Milestone";
  return { date, label: `${label} · ${compactDate(date)}` };
}

function evidenceLabel(record) {
  const source = record?.sourceSystem || record?.sourceLabel || record?.noticeType || "Published source";
  const freshness = record?.lastChangedAt || record?.firstSeenAt ? "current" : "retained";
  return `${source} · ${freshness}`;
}

function isResearchTask(task) {
  return /research|evidence|brief/i.test(`${task?.sourceType || ""} ${task?.sourceLabel || ""} ${task?.title || ""}`);
}

function isTaskOverdue(task, today) {
  const due = dayKey(task?.dueAt);
  return Boolean(due && due < today);
}

function taskScore(task, today) {
  const due = dayKey(task.dueAt);
  const overdue = due && due < today ? 45 : 0;
  const dueSoon = due && due >= today && Date.parse(`${due}T00:00:00Z`) <= Date.parse(`${today}T00:00:00Z`) + 3 * DAY ? 25 : 0;
  const waiting = task.status === "waiting" ? -8 : 0;
  return overdue + dueSoon + (PRIORITY_SCORE[task.priority] || 20) + waiting;
}

function buildTimelineItems(rows, tasks, events, today) {
  const start = Date.parse(`${today}T00:00:00Z`);
  const end = start + 14 * DAY;
  const within = (date, allowOverdue = false) => {
    const parsed = Date.parse(`${dayKey(date)}T00:00:00Z`);
    return Number.isFinite(parsed) && parsed <= end && (allowOverdue || parsed >= start);
  };
  const items = [];
  tasks.forEach((task) => {
    if (!within(task.dueAt, true)) return;
    items.push({ id: `task:${task.recordId}:${task.id}`, lane: isResearchTask(task) ? "research" : "actions", date: dayKey(task.dueAt) || today, label: task.title, meta: `${task.status === "waiting" ? "Waiting" : isTaskOverdue(task, today) ? "Overdue" : `Due ${compactDate(task.dueAt)}`} · ${task.owner || "Unassigned"}`, recordId: task.recordId, taskId: task.id, tone: isTaskOverdue(task, today) ? "danger" : task.priority === "high" || task.priority === "critical" ? "warning" : "info" });
  });
  rows.forEach((record) => {
    [...new Set(recordDates(record))].filter((date) => within(date)).slice(0, 2).forEach((date) => items.push({ id: `record:${recordId(record)}:${date}`, lane: "opportunities", date, label: date === dayKey(record.solicitationEnd) ? "Response deadline" : "Published milestone", meta: shortText(record.title, recordId(record), 70), recordId: recordId(record), tone: date === dayKey(record.solicitationEnd) ? "danger" : "info" }));
  });
  events.forEach((event) => {
    const date = dayKey(event.startsAt || event.start);
    if (!within(date)) return;
    items.push({ id: `event:${event.id}`, lane: "events", date, label: event.title || "Team event", meta: [compactDate(date), event.location?.name || event.location || event.category].filter(Boolean).join(" · "), recordId: event.recordIds?.[0] || "", tone: "info" });
  });
  return items.sort((left, right) => left.date.localeCompare(right.date) || left.label.localeCompare(right.label));
}

function laneLabel(lane) {
  return { actions: "Actions", opportunities: "Opportunities", research: "Research", events: "Team events" }[lane];
}

function eventStyle(item, today) {
  const start = Date.parse(`${today}T00:00:00Z`);
  const itemDate = Date.parse(`${item.date}T00:00:00Z`);
  const offset = Math.max(0, Math.min(13, Math.floor((itemDate - start) / DAY)));
  return { "--today-event-start": String(offset), "--today-event-span": item.lane === "opportunities" ? "3" : "2" };
}

function TimelineSurface({ mode, setMode, items, selectedId, selectedRecordId, onSelect, today }) {
  const ticks = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(Date.parse(`${today}T00:00:00Z`) + index * 2 * DAY);
    return { key: date.toISOString().slice(0, 10), label: index === 0 ? "Today" : date.toLocaleDateString("en-US", { weekday: "short", day: "numeric", timeZone: "UTC" }) };
  });
  const dates = Array.from({ length: 14 }, (_, index) => new Date(Date.parse(`${today}T00:00:00Z`) + index * DAY).toISOString().slice(0, 10));
  const weekdays = dates.slice(0, 7).map((date) => new Date(`${date}T00:00:00Z`).toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" }));
  const attentionCount = items.filter((item) => item.tone === "danger" || item.tone === "warning").length;
  return <ControlCalendarSurface className="today-forward" data-today-forward-view data-timeline-mode={mode}>
    <ControlCalendarHeader
      eyebrow="Forward view"
      title="Next 14 days"
      compactTitle="Next 14 days"
      description="Tasks, opportunity dates, research, and team events"
      navigation={<ControlCalendarViewSwitcher value={mode} onChange={setMode} label="Today timeline view" />}
    />
    {mode === "lanes" ? <div className="today-lanes" data-today-lanes>
      <div className="today-lanes__axis"><span>Lane</span>{ticks.map((tick) => <time key={tick.key} dateTime={tick.key}>{tick.label}</time>)}</div>
      {["actions", "opportunities", "research", "events"].map((lane) => { const laneItems = items.filter((item) => item.lane === lane); return <div className="today-lanes__row" key={lane} data-today-lane={lane}><div className="today-lanes__label"><strong>{laneLabel(lane)}</strong><small>{laneItems.length} {lane === "events" ? "event" : lane === "opportunities" ? "date" : "item"}{laneItems.length === 1 ? "" : "s"}</small></div><div className="today-lanes__track"><i className="today-lanes__now" aria-hidden="true" />{laneItems.map((item) => <button key={item.id} type="button" className={`today-event is-${item.tone}${selectedId === item.id ? " is-selected" : ""}`} style={eventStyle(item, today)} onClick={() => onSelect(item)}><strong>{item.label}</strong><small>{item.meta}</small></button>)}</div></div>; })}
    </div> : null}
    {mode === "agenda" ? <div className="today-agenda if-action-row-list" data-today-agenda>{items.length ? items.map((item) => <button key={item.id} type="button" className={`if-action-row${selectedId === item.id ? " is-selected" : ""}`} onClick={() => onSelect(item)}><time dateTime={item.date}>{compactDate(item.date)}</time><span><strong>{item.label}</strong><small>{laneLabel(item.lane)} · {item.meta}</small></span></button>) : <p>No dated work in this window.</p>}</div> : null}
    {mode === "calendar" ? <ControlCalendarGrid label="Next 14 days calendar" weekdays={weekdays} layout="range" rows={2} className="today-calendar" data-today-calendar>{dates.map((date) => <ControlCalendarDay key={date} date={date} label={compactDate(date)} current={date === today} meta={date === today ? "Today" : null}>{items.filter((item) => item.date === date).map((item) => <ControlCalendarItem key={item.id} label={item.label} meta={laneLabel(item.lane)} tone={item.tone} selected={selectedId === item.id} aria-label={`${item.label}, ${item.meta}`} onClick={() => onSelect(item)} />)}</ControlCalendarDay>)}</ControlCalendarGrid> : null}
    <ControlCalendarFooter actions={<a className="if-btn if-btn--secondary if-btn--sm" href={timelineRoute(selectedRecordId, { from: today })}>Open full Timeline<ArrowRight size={14} /></a>}><strong>{items.length} visible event{items.length === 1 ? "" : "s"}</strong> · {attentionCount} need attention</ControlCalendarFooter>
  </ControlCalendarSurface>;
}

function SelectedOpportunity({ record, watch, selectedTask, lens, setLens, onRequestComplete, feedback, today }) {
  if (!record) return <aside className="today-selection" data-today-selection><div className="today-selection__empty"><strong>Select work to review</strong><p>Choose an action or dated signal to keep its decision context beside the timeline.</p></div></aside>;
  const id = recordId(record);
  const pursuit = normalizePursuit(watch?.pursuit);
  const milestone = nextMilestone(record, today);
  const summary = shortText(record.summary || record.description || record.scope, `Review the latest official evidence for ${record.title || id}, confirm the buyer and acquisition path, then keep the next decision tied to a named owner.`);
  const openTasks = pursuit.tasks.filter((task) => task.status !== "done");
  const moneyValue = Number(record.amount || record.value || record.ceiling || record.obligatedAmount);
  return <aside className="today-selection" data-today-selection data-selected-record={id}>
    <header><div><small>Selected opportunity</small><h2>{record.title || id}</h2><p>{[record.party || record.portfolio, record.sourceSystem || record.noticeType].filter(Boolean).join(" · ") || "Tracked opportunity"}</p></div></header>
    <dl className="today-selection__facts if-fact-grid if-fact-grid--mobile-two"><div className="if-fact-grid__item"><dt>Pursuit</dt><dd><SemanticStatusBadge category="workflow" value={pursuit.stage} /></dd></div><div className="if-fact-grid__item"><dt>Owner</dt><dd>{pursuit.owner || "Unassigned"}</dd></div><div className="if-fact-grid__item"><dt>Next milestone</dt><dd>{milestone.label}</dd></div><div className="if-fact-grid__item"><dt>Evidence</dt><dd><SemanticStatusBadge category="evidence" value={record.evidenceTier || "supported"} /><small>{evidenceLabel(record)}</small></dd></div></dl>
    <ControlTabs className="today-selection__tabs" ariaLabel="Selected opportunity" activeId={lens} onSelect={setLens} items={LENSES.map((item) => ({ id: item.toLowerCase(), label: item }))} />
    <div className="today-selection__body">
      {lens === "summary" ? <><h3>Decision summary</h3><p>{summary}</p><div className="today-selection__next"><small>Next action</small><strong>{selectedTask?.title || pursuit.nextAction || "Set a named next action"}</strong></div></> : null}
      {lens === "timeline" ? <><h3>Timeline context</h3><p>{milestone.date ? `${milestone.label} is the next retained date for this record.` : "No future official date is retained for this record."}</p><a href={timelineRoute(id)}>Open complete family timeline<ArrowRight size={14} /></a></> : null}
      {lens === "evidence" ? <><h3>Evidence posture</h3><p>{evidenceLabel(record)}. Missing scope, dates, or acquisition details remain unavailable rather than inferred.</p><a href={opportunityRoute(id, { tab: "evidence", origin: "today" })}>Review evidence workspace<ArrowRight size={14} /></a></> : null}
      {lens === "money" ? <><h3>Money context</h3><p>{Number.isFinite(moneyValue) && moneyValue > 0 ? `Published record value: ${moneyValue.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 })}.` : "No comparable published value is retained on this opportunity record."}</p><a href={opportunityRoute(id, { tab: "money", origin: "today" })}>Open Money workspace<ArrowRight size={14} /></a></> : null}
      {lens === "tasks" ? <><h3>Open actions</h3>{openTasks.length ? <ul>{openTasks.map((task) => <li key={task.id}><strong>{task.title}</strong><small>{task.owner || "Unassigned"} · {task.dueAt ? `Due ${compactDate(task.dueAt)}` : "No due date"}</small></li>)}</ul> : <p>No open action is linked to this pursuit.</p>}<a href={opportunityRoute(id, { tab: "tasks", origin: "today" })}>Open task workspace<ArrowRight size={14} /></a></> : null}
      {feedback ? <p className={`today-selection__feedback is-${feedback.tone}`} role={feedback.tone === "danger" ? "alert" : "status"}>{feedback.message}</p> : null}
    </div>
    <footer><button type="button" className="if-btn if-btn--primary" disabled={!selectedTask} onClick={onRequestComplete}>{selectedTask ? "Complete action…" : "No action selected"}</button><ControlMenu
      label="More"
      ariaLabel="More selected opportunity actions"
      icon={<MoreHorizontal size={14} />}
      className="today-selection__more"
      triggerClassName="if-btn if-btn--secondary"
      items={[
        { id: "workspace", label: "Open workspace", description: "Review the full pursuit record", href: opportunityRoute(id, { origin: "today" }), icon: <ListChecks size={15} /> },
        { id: "graph", label: "Open graph", description: "Traverse connected intelligence", href: intelligenceGraphRoute(id), icon: <Network size={15} /> },
        { id: "timeline", label: "Open timeline", description: "Review dates and family history", href: timelineRoute(id), icon: <CalendarClock size={15} /> },
      ]}
    /></footer>
  </aside>;
}

export default function TodayWorkspace({ rows, watchlist, events = [], today, savePursuit, children }) {
  const auth = useAuth();
  const notifications = useNotifications();
  const [attentionFeed, setAttentionFeed] = useState(emptyProcurementFeed);
  useEffect(() => {
    let active = true;
    loadProcurementFeed().then((payload) => { if (active) setAttentionFeed(payload); }).catch(() => { /* Source attention stays unavailable rather than appearing clear. */ });
    return () => { active = false; };
  }, []);
  const recordById = useMemo(() => new Map(rows.map((record) => [recordId(record), record])), [rows]);
  const watchById = useMemo(() => new Map(watchlist.map((watch) => [watch.recordId, watch])), [watchlist]);
  const tasks = useMemo(() => watchlist.flatMap((watch) => normalizePursuit(watch.pursuit).tasks.filter((task) => task.status !== "done").map((task) => ({ ...task, recordId: watch.recordId, record: recordById.get(watch.recordId) }))), [recordById, watchlist]);
  const noActionRecords = useMemo(() => rows.filter((record) => { const pursuit = normalizePursuit(watchById.get(recordId(record))?.pursuit); return !pursuit.nextAction && !pursuit.tasks.some((task) => task.status !== "done"); }), [rows, watchById]);
  const sourceIssues = useMemo(() => Object.entries(attentionFeed.metadata?.coverage?.sources || {}).filter(([, source]) => !["current", "gaps-disclosed"].includes(source?.status)), [attentionFeed.metadata?.coverage?.sources]);
  const taskAttention = useMemo(() => notifications?.notifications?.filter((item) => item.requiresAction || item.active) || [], [notifications?.notifications]);
  const latestFeed = attentionFeed.history?.[0] || null;
  const latestFeedDate = latestFeed?.date || "";
  const changedTodayCount = Number(latestFeed?.summary?.added || 0) + Number(latestFeed?.summary?.updated || 0) + Number(latestFeed?.summary?.removed || 0);
  const priorityItems = useMemo(() => [
    ...taskAttention.map((item) => ({ id: item.id, type: "system", href: item.href, title: item.title, meta: item.message, tone: item.tone || "info", score: item.requiresAction ? 110 : 55 })),
    ...sourceIssues.map(([source, value]) => ({ id: `source:${source}`, type: "system", href: "#/budget-spend/connections?connectionsView=integrations", title: `${source} source issue`, meta: `${value.status}. Missing data is unavailable, not zero.`, tone: "danger", score: 100 })),
    ...tasks.map((task) => ({ id: `task:${task.recordId}:${task.id}`, type: "task", recordId: task.recordId, taskId: task.id, title: task.title, meta: [isTaskOverdue(task, today) ? "Overdue" : task.status === "waiting" ? "Waiting" : task.dueAt ? `Due ${compactDate(task.dueAt)}` : "No due date", task.record?.title || task.recordId].join(" · "), tone: isTaskOverdue(task, today) ? "danger" : task.priority === "high" || task.priority === "critical" ? "warning" : task.status === "waiting" ? "neutral" : "info", score: taskScore(task, today) })),
    ...noActionRecords.map((record) => ({ id: `plan:${recordId(record)}`, type: "plan", recordId: recordId(record), title: "Set a next action", meta: `${record.title || recordId(record)} · Tracked pursuit has no plan`, tone: "warning", score: 18 })),
    ...(changedTodayCount ? [{ id: "changes:today", type: "system", href: "#/budget-spend/explorer?spendView=table&changes=today", title: `${changedTodayCount} record${changedTodayCount === 1 ? "" : "s"} changed`, meta: `${latestFeedDate ? `Latest retained refresh · ${compactDate(latestFeedDate)}` : "Latest retained source refresh"}`, tone: "info", score: 16 }] : []),
  ].sort((left, right) => right.score - left.score).slice(0, 5), [changedTodayCount, latestFeedDate, noActionRecords, sourceIssues, taskAttention, tasks, today]);
  const timelineItems = useMemo(() => buildTimelineItems(rows, tasks, events, today), [events, rows, tasks, today]);
  const initialItem = priorityItems.find((item) => item.recordId) || timelineItems.find((item) => item.recordId) || (rows[0] ? { id: `record:${recordId(rows[0])}`, recordId: recordId(rows[0]) } : null);
  const [selectedItemId, setSelectedItemId] = useState(initialItem?.id || "");
  const [selectedRecordId, setSelectedRecordId] = useState(initialItem?.recordId || "");
  const [selectedTaskId, setSelectedTaskId] = useState(initialItem?.taskId || "");
  const [mode, setMode] = useState("lanes");
  const [lens, setLens] = useState("summary");
  const [pendingComplete, setPendingComplete] = useState(null);
  const [feedback, setFeedback] = useState(null);
  const [busy, setBusy] = useState(false);
  const activeItemId = selectedItemId || initialItem?.id || "";
  const activeRecordId = (selectedItemId ? selectedRecordId : initialItem?.recordId) || recordId(rows[0]);
  const activeTaskId = selectedItemId ? selectedTaskId : initialItem?.taskId || "";
  const selectedRecord = recordById.get(activeRecordId) || rows[0] || null;
  const selectedWatch = watchById.get(recordId(selectedRecord));
  const selectedTask = normalizePursuit(selectedWatch?.pursuit).tasks.find((task) => task.id === activeTaskId && task.status !== "done") || null;
  const waitingCount = tasks.filter((task) => task.status === "waiting").length;
  const evidenceGapCount = rows.filter((record) => /gap|partial|unavailable/i.test(`${record.evidenceStatus || ""} ${record.coverageStatus || ""}`)).length;
  const firstName = String(auth?.user?.displayName || "").trim().split(/\s+/)[0] || "there";

  function select(item) {
    setSelectedItemId(item.id);
    if (item.recordId) setSelectedRecordId(item.recordId);
    setSelectedTaskId(item.taskId || "");
    setLens("summary");
    setFeedback(null);
  }

  async function confirmComplete() {
    if (!pendingComplete || !selectedWatch) return;
    setBusy(true);
    setFeedback(null);
    try {
      const pursuit = normalizePursuit(selectedWatch.pursuit);
      const nextTasks = pursuit.tasks.map((task) => task.id === pendingComplete.id ? { ...task, status: "done", completedAt: new Date().toISOString() } : task);
      await savePursuit(activeRecordId, { ...pursuit, tasks: nextTasks, reviewAt: selectedWatch.reviewAt });
      setFeedback({ tone: "success", message: "Action completed. Restore it from the opportunity Tasks workspace if needed." });
      setSelectedTaskId("");
      setPendingComplete(null);
    } catch (error) {
      setFeedback({ tone: "danger", message: error.message || "The action could not be completed." });
    } finally {
      setBusy(false);
    }
  }

  return <div className="today-workspace" data-today-workspace>
    <header className="today-workspace__hero"><div><small>Workspace focus</small><h1>Good afternoon, {firstName}</h1><p>Start with the work that needs a decision, then move through time without losing the selected opportunity.</p></div><div className="today-workspace__signals"><span className="if-badge"><strong>{priorityItems.length}</strong> need attention</span><span className="if-badge"><strong>{waitingCount}</strong> waiting</span><span className="if-badge"><strong>{evidenceGapCount}</strong> evidence gap{evidenceGapCount === 1 ? "" : "s"}</span></div></header>
    <div className="today-workspace__scope"><strong>Scope</strong><span className="if-btn if-btn--secondary if-btn--sm">My tracked work</span><span className="if-btn if-btn--secondary if-btn--sm">Next 14 days</span><span className="if-btn if-btn--secondary if-btn--sm">Owner: {firstName}</span><ControlMenu
      label="Filters"
      ariaLabel="Filter Today work"
      icon={<Filter size={13} />}
      className="today-workspace__filters"
      triggerClassName="if-btn if-btn--secondary if-btn--sm"
      items={[
        { id: "urgent", label: "Needs attention", description: "Urgent and high-impact work", meta: priorityItems.length, href: "#/budget-spend/watchlist?workFocus=urgent" },
        { id: "waiting", label: "Waiting", description: "Blocked or externally owned work", meta: waitingCount, href: "#/budget-spend/watchlist?workFocus=waiting" },
        { id: "no-action", label: "Needs plan", description: "Tracked pursuits without a next action", meta: noActionRecords.length, href: "#/budget-spend/watchlist?workFocus=no-action" },
        { id: "changes", label: "Changed records", description: "Open the latest retained source-change ledger", meta: changedTodayCount, href: "#/budget-spend/explorer?spendView=table&changes=today" },
      ]}
    /><a className="if-btn if-btn--secondary if-btn--sm" href="#/budget-spend/explorer?spendView=table"><ExternalLink size={13} />Find opportunities</a></div>
    <section className="today-workspace__console" data-today-console>
      <aside className="today-priority" data-today-priority><header><div><small>Priority actions</small><h2>Act now</h2><p>{priorityItems.length} item{priorityItems.length === 1 ? "" : "s"}, ranked by urgency and impact</p></div><span>{priorityItems.length}</span></header><div>{priorityItems.map((item) => { const content = <><i aria-hidden="true" /><strong>{item.title}</strong><small>{item.meta}</small></>; return item.href ? <a key={item.id} href={item.href} className={`today-priority__item is-${item.tone}`} data-today-system-attention>{content}</a> : <button key={item.id} type="button" className={`today-priority__item is-${item.tone}${activeItemId === item.id ? " is-selected" : ""}`} onClick={() => select(item)} data-my-work-task={item.type === "task" ? true : undefined}>{content}</button>; })}</div></aside>
      <TimelineSurface mode={mode} setMode={setMode} items={timelineItems} selectedId={activeItemId} selectedRecordId={activeRecordId} onSelect={select} today={today} />
      <SelectedOpportunity record={selectedRecord} watch={selectedWatch} selectedTask={selectedTask} lens={lens} setLens={setLens} onRequestComplete={() => { if (selectedTask) setPendingComplete(selectedTask); }} feedback={feedback} today={today} />
    </section>
    <section className="if-management-grid if-management-grid--strip" aria-label="Operating loop">{[["Signal", "Dates and changes"], ["Orient", "Evidence and money"], ["Decide", "Pursuit posture"], ["Act", "Owner and task"], ["Learn", "Outcome and refresh"]].map(([label, value]) => <span className="if-management-card" key={label}><small className="if-management-card__label">{label}</small><strong className="if-management-card__value">{value}</strong></span>)}</section>
    {children}
    {pendingComplete ? <ControlDialog open onClose={() => { if (!busy) setPendingComplete(null); }} eyebrow="Today action" title="Complete this action?" summary="This moves the action out of the active queue. You can restore it later from the opportunity Tasks workspace." surfaceProps={{ "data-today-task-confirmation": true }} footer={<><button type="button" className="if-btn" disabled={busy} onClick={() => setPendingComplete(null)}>Cancel</button><button type="button" className="if-btn if-btn--primary" disabled={busy} onClick={() => void confirmComplete()}><CheckCircle2 size={15} />{busy ? "Saving…" : "Complete action"}</button></>}><div className="today-workspace__confirmation"><strong>{pendingComplete.title}</strong><span>{[pendingComplete.owner || "Unassigned", pendingComplete.dueAt ? `Due ${compactDate(pendingComplete.dueAt)}` : "No due date"].join(" · ")}</span></div></ControlDialog> : null}
  </div>;
}
