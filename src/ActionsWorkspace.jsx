import { useMemo, useState } from "react";
import { Activity, CalendarDays, CircleAlert, CircleCheck, ListChecks, Star } from "lucide-react";
import { ControlAsyncState, ControlDialog, ControlPageBody, ControlPageHeader, ControlSearch } from "control-surface-ui/react";
import { opportunityRoute } from "./cross-surface-routes.js";
import { normalizePursuit } from "./pursuit-metadata.js";
import SemanticStatusBadge from "./SemanticStatusBadge.jsx";
import "./ActionsWorkspace.css";

function compactDate(value) {
  if (!value) return "Not scheduled";
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return "Not scheduled";
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

export default function ActionsWorkspace({ rows, watchlist, savePursuit }) {
  const recordById = useMemo(() => new Map(rows.map((record) => [record.opportunityId, record])), [rows]);
  const [referenceTime] = useState(() => Date.now());
  const [query, setQuery] = useState("");
  const [pending, setPending] = useState(null);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState(null);
  const today = new Date(referenceTime).toISOString().slice(0, 10);
  const soon = new Date(referenceTime + 7 * 86_400_000).toISOString().slice(0, 10);
  const actions = useMemo(() => watchlist.flatMap((watch) => {
    const pursuit = normalizePursuit(watch.pursuit);
    const record = recordById.get(watch.recordId);
    return pursuit.tasks.filter((task) => task.status !== "done").map((task) => ({ ...task, pursuit, record, recordId: watch.recordId }));
  }).sort((left, right) => String(left.dueAt || "9999-12-31").localeCompare(String(right.dueAt || "9999-12-31"))), [recordById, watchlist]);
  const needsPlan = useMemo(() => watchlist.filter((watch) => { const pursuit = normalizePursuit(watch.pursuit); return !pursuit.nextAction && !pursuit.tasks.some((task) => task.status !== "done"); }), [watchlist]);
  const normalizedQuery = query.trim().toLowerCase();
  const matchesQuery = (values) => !normalizedQuery || values.some((value) => String(value || "").toLowerCase().includes(normalizedQuery));
  const visibleActions = actions.filter((action) => matchesQuery([action.title, action.record?.title, action.recordId, action.owner, action.pursuit.stage]));
  const visibleNeedsPlan = needsPlan.filter((watch) => { const record = recordById.get(watch.recordId); return matchesQuery([record?.title, watch.recordId, normalizePursuit(watch.pursuit).owner]); });
  const classify = (action) => {
    if (action.status === "waiting") return "waiting";
    const due = action.dueAt?.slice(0, 10) || "";
    if (!due) return "unscheduled";
    if (due < today) return "overdue";
    if (due <= soon) return "due-soon";
    return "upcoming";
  };
  const overdue = actions.filter((action) => classify(action) === "overdue").length;
  const dueSoon = actions.filter((action) => classify(action) === "due-soon").length;
  const waiting = actions.filter((action) => classify(action) === "waiting").length;
  const groupDefinitions = [
    { id: "overdue", title: "Overdue", summary: "Past due and needs attention", tone: "danger", icon: CircleAlert },
    { id: "due-soon", title: "Due soon", summary: "Due in the next 7 days", tone: "warning", icon: CalendarDays },
    { id: "waiting", title: "Waiting", summary: "Blocked on an external decision or dependency", tone: "neutral", icon: Activity },
    { id: "upcoming", title: "Upcoming", summary: "Scheduled beyond the next 7 days", tone: "info", icon: CalendarDays },
    { id: "unscheduled", title: "Unscheduled", summary: "Open actions without a due date", tone: "neutral", icon: ListChecks },
  ];
  const groups = groupDefinitions.map((group) => ({ ...group, rows: visibleActions.filter((action) => classify(action) === group.id) })).filter((group) => group.rows.length);
  const summaryParts = [`${actions.length} open`];
  if (overdue) summaryParts.push(`${overdue} overdue`);
  if (dueSoon) summaryParts.push(`${dueSoon} due soon`);
  if (waiting) summaryParts.push(`${waiting} waiting`);
  if (needsPlan.length) summaryParts.push(`${needsPlan.length} need a plan`);

  async function complete() {
    if (!pending) return;
    setBusy(true);
    try {
      const nextTasks = pending.pursuit.tasks.map((task) => task.id === pending.id ? { ...task, status: "done", completedAt: new Date().toISOString() } : task);
      await savePursuit(pending.recordId, { ...pending.pursuit, tasks: nextTasks });
      setFeedback({ tone: "success", message: `Completed: ${pending.title}` });
      setPending(null);
    } catch (error) {
      setFeedback({ tone: "danger", message: error.message || "The action could not be completed." });
    } finally { setBusy(false); }
  }

  return <section className="ops-panel my-work" data-actions-workspace>
    <ControlPageHeader compact divided eyebrow="Today" title="Actions" summary={`Human-owned next steps across tracked pursuits · ${summaryParts.join(" · ")}.`} headingLevel={2} actions={<a className="if-btn if-btn--secondary" href="#/budget-spend/explorer?spendView=table">Open opportunity workbench</a>} />
    <ControlPageBody compact>
      {feedback ? <p className={`if-alert if-alert--${feedback.tone}`} role={feedback.tone === "danger" ? "alert" : "status"}>{feedback.message}</p> : null}
      <div className="actions-queue" data-actions-queue>
        {actions.length + needsPlan.length > 7 || query ? <ControlSearch className="actions-queue__search" ariaLabel="Search actions" value={query} onChange={setQuery} placeholder="Search actions, opportunities, and owners…" /> : null}
        {groups.map((group) => { const Icon = group.icon; return <section className={`actions-queue__group is-${group.tone}`} data-action-group={group.id} key={group.id}>
          <header><div><h3>{group.title}</h3><p>{group.summary}</p></div><span className={`if-badge${group.tone === "danger" ? " if-badge--danger" : group.tone === "warning" ? " if-badge--warning" : group.tone === "info" ? " if-badge--info" : ""}`}>{group.rows.length}</span></header>
          <div className="actions-queue__list" role="list">{group.rows.map((action) => <article className="if-action-row actions-queue__row" role="listitem" data-action-queue-row key={`${action.recordId}:${action.id}`}>
            <span className="if-icon-slot" aria-hidden="true"><Icon size={16} /></span>
            <span><strong>{action.title}</strong><em>{action.record?.title || action.recordId}</em><small>{action.owner || "Unassigned"} · {action.dueAt ? `Due ${compactDate(action.dueAt)}` : "No due date"}</small></span>
            <SemanticStatusBadge category="workflow" value={action.pursuit.stage} />
            <span className="if-action-row__actions"><a className="if-btn if-btn--secondary if-btn--sm" href={opportunityRoute(action.recordId, { tab: "tasks", origin: "today" })}>Open plan</a><button type="button" className="if-btn if-btn--primary if-btn--sm" onClick={() => setPending(action)}>Complete</button></span>
          </article>)}</div>
        </section>; })}
        {visibleNeedsPlan.length ? <section className="actions-queue__group is-warning" data-action-group="needs-plan" data-actions-needs-plan>
          <header><div><h3>Needs a plan</h3><p>Tracked pursuits without an open action</p></div><span className="if-badge if-badge--warning">{visibleNeedsPlan.length}</span></header>
          <div className="actions-queue__list" role="list">{visibleNeedsPlan.map((watch) => { const record = recordById.get(watch.recordId); const pursuit = normalizePursuit(watch.pursuit); return <article className="if-action-row actions-queue__row" role="listitem" data-action-queue-row key={watch.recordId}>
            <span className="if-icon-slot" aria-hidden="true"><Star size={16} /></span>
            <span><strong>{record?.title || watch.recordId}</strong><em>Tracked pursuit</em><small>{pursuit.owner || "Unassigned"} · Name the next owned step</small></span>
            <SemanticStatusBadge category="workflow" value={pursuit.stage} />
            <span className="if-action-row__actions"><a className="if-btn if-btn--primary if-btn--sm" href={opportunityRoute(watch.recordId, { tab: "tasks", origin: "today" })}>Create plan</a></span>
          </article>; })}</div>
        </section> : null}
        {actions.length || needsPlan.length ? !groups.length && !visibleNeedsPlan.length ? <ControlAsyncState compact state="empty" icon={<ListChecks size={22} />} title="No matching actions" message="Clear the search to restore the complete human work queue." /> : null : <ControlAsyncState compact state="empty" icon={<CircleCheck size={22} />} title="No open actions" message="Add a named next action from an opportunity workspace." />}
      </div>
    </ControlPageBody>
    {pending ? <ControlDialog open onClose={() => { if (!busy) setPending(null); }} eyebrow="Pursuit action" title="Complete this action?" summary="The action will leave the active queue and remain in the opportunity history." footer={<><button type="button" className="if-btn" disabled={busy} onClick={() => setPending(null)}>Cancel</button><button type="button" className="if-btn if-btn--primary" disabled={busy} onClick={() => void complete()}><CircleCheck size={15} />{busy ? "Saving…" : "Complete action"}</button></>}><strong>{pending.title}</strong><p>{pending.record?.title || pending.recordId}</p></ControlDialog> : null}
  </section>;
}
