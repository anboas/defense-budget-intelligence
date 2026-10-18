import { useEffect, useRef, useState } from "react";
import { CalendarClock, Check, Circle, ExternalLink, ListChecks, MoreHorizontal, Pencil, Plus, Sparkles, Star, Trash2 } from "lucide-react";
import ControlSelect from "./ControlSelect.jsx";
import { PURSUIT_STAGES, PURSUIT_TASK_EVENT, PURSUIT_TASK_PRIORITIES, PURSUIT_TASK_STATUSES, normalizePursuit } from "./pursuit-metadata.js";
import "./OpportunityCommandRail.css";

function recordId(record) {
  return record?.opportunityId || record?.sourceRecordId || record?.noticeId || record?.id || record?.reference || "";
}

function PursuitFields({ watch, canWrite, onCommit }) {
  const [draft, setDraft] = useState(() => normalizePursuit(watch?.pursuit));
  const [reviewAt, setReviewAt] = useState(watch?.reviewAt || "");

  function commit(patch) {
    const nextDraft = normalizePursuit({ ...draft, ...patch });
    const nextReviewAt = patch.reviewAt ?? reviewAt;
    setDraft(nextDraft);
    setReviewAt(nextReviewAt);
    void onCommit(nextDraft, nextReviewAt);
  }

  return <div className="if-panel__body if-form-grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 12rem), 1fr))", gap: "0.5rem" }}>
    <div className="if-field"><span className="if-field__label">Stage</span><ControlSelect label="Stage" value={draft.stage} options={PURSUIT_STAGES} disabled={!canWrite} triggerProps={{ style: { minHeight: "2.75rem" } }} onChange={(stage) => commit({ stage })} /></div>
    <label className="if-field"><span className="if-field__label">Owner</span><input className="if-input if-touch-target" value={draft.owner} disabled={!canWrite} maxLength="80" placeholder="Unassigned" onChange={(event) => setDraft((current) => ({ ...current, owner: event.target.value }))} onBlur={() => { if (draft.owner !== (watch?.pursuit?.owner || "")) commit({ owner: draft.owner }); }} onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} /></label>
    <label className="if-field"><span className="if-field__label">Next action</span><input className="if-input if-touch-target" value={draft.nextAction} disabled={!canWrite} maxLength="320" placeholder="Define the next decision or customer action" onChange={(event) => setDraft((current) => ({ ...current, nextAction: event.target.value }))} onBlur={() => { if (draft.nextAction !== (watch?.pursuit?.nextAction || "")) commit({ nextAction: draft.nextAction }); }} onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} /></label>
    <label className="if-field"><span className="if-field__label">Checkpoint</span><input className="if-input if-touch-target" type="date" value={reviewAt} disabled={!canWrite} onChange={(event) => commit({ reviewAt: event.target.value })} /></label>
  </div>;
}

function taskId() {
  return globalThis.crypto?.randomUUID?.() || `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function TaskList({ recordId: id, pursuit, canWrite, onCommit }) {
  const [composer, setComposer] = useState(null);
  const tasks = pursuit.tasks || [];
  const active = tasks.filter((task) => task.status !== "done");
  const [expanded, setExpanded] = useState(active.length > 0);
  const canAdd = canWrite && active.length < 6;

  function saveTasks(nextTasks) {
    return onCommit({ ...pursuit, tasks: nextTasks });
  }

  function addTask(candidate = {}) {
    const title = String(candidate.title || pursuit.nextAction || "").trim();
    setExpanded(true);
    setComposer({ id: candidate.id || "", title, priority: candidate.priority || "normal", dueAt: candidate.dueAt || "", owner: candidate.owner || pursuit.owner || "", sourceType: candidate.sourceType || "manual", sourceId: candidate.sourceId || "", sourceLabel: candidate.sourceLabel || "", status: candidate.status || "todo", createdAt: candidate.createdAt || "" });
  }

  useEffect(() => {
    const receive = (event) => {
      if (event.detail?.recordId !== id) return;
      addTask(event.detail);
    };
    window.addEventListener(PURSUIT_TASK_EVENT, receive);
    return () => window.removeEventListener(PURSUIT_TASK_EVENT, receive);
  });

  function commitTask() {
    if (!composer?.title.trim()) return;
    const now = new Date().toISOString();
    const saved = { id: composer.id || taskId(), title: composer.title.trim(), status: composer.status, priority: composer.priority, dueAt: composer.dueAt, owner: composer.owner.trim(), sourceType: composer.sourceType, sourceId: composer.sourceId, sourceLabel: composer.sourceLabel, createdAt: composer.createdAt || now, completedAt: "" };
    const next = composer.id ? tasks.map((task) => task.id === composer.id ? saved : task) : [...active, saved, ...tasks.filter((task) => task.status === "done")].slice(0, 6);
    void saveTasks(next);
    setComposer(null);
  }

  function patchTask(task, patch) {
    const completedAt = patch.status === "done" ? new Date().toISOString() : patch.status ? "" : task.completedAt;
    void saveTasks(tasks.map((item) => item.id === task.id ? { ...item, ...patch, completedAt } : item));
  }

  return <details className="pursuit-tasks" data-pursuit-tasks open={expanded} onToggle={(event) => setExpanded(event.currentTarget.open)}>
    <summary><span><strong>Actions</strong><small>{active.length ? `${active.length} open` : "No open tasks"}</small></span><span>{expanded ? "Hide" : "Review"}</span></summary>
    <div className="pursuit-tasks__body">
    <header><p>Keep the next decision tied to an owner, due date, and evidence.</p>{canWrite ? <button type="button" className="if-btn if-btn--secondary if-touch-target" disabled={!canAdd} title={canAdd ? "Add a linked pursuit task" : "Complete or remove a task before adding another"} onClick={() => addTask()}><Plus size={15} />Add task</button> : null}</header>
    {active.length ? <div className="pursuit-tasks__list">{active.slice(0, 5).map((task) => <article key={task.id} data-pursuit-task={task.status} data-task-priority={task.priority}>
      <button type="button" className="pursuit-tasks__complete" disabled={!canWrite} aria-label={`Complete ${task.title}`} onClick={() => patchTask(task, { status: "done" })}><Circle size={18} /></button>
      <div><strong>{task.title}</strong><small>{[task.owner || "Unassigned", task.dueAt ? `Due ${task.dueAt.slice(0, 10)}` : "No due date", task.sourceLabel || (task.sourceType === "manual" ? "Manual task" : task.sourceType)].filter(Boolean).join(" · ")}</small></div>
      <ControlSelect label={`Status for ${task.title}`} value={task.status} options={PURSUIT_TASK_STATUSES} disabled={!canWrite} onChange={(status) => patchTask(task, { status })} triggerProps={{ className: "if-touch-target pursuit-tasks__status" }} />
      {canWrite ? <div className="pursuit-tasks__row-actions"><button type="button" aria-label={`Edit ${task.title}`} onClick={() => addTask(task)}><Pencil size={15} /></button><button type="button" aria-label={`Delete ${task.title}`} onClick={() => void saveTasks(tasks.filter((item) => item.id !== task.id))}><Trash2 size={15} /></button></div> : null}
    </article>)}</div> : <p className="pursuit-tasks__empty">Turn the next decision, a cited research action, or selected evidence into a dated task.</p>}
    {composer ? <div className="pursuit-tasks__composer" data-task-composer>
      <label className="if-field pursuit-tasks__title"><span className="if-field__label">Task</span><input className="if-input if-touch-target" autoFocus value={composer.title} maxLength="160" placeholder="What needs to happen next?" onChange={(event) => setComposer((current) => ({ ...current, title: event.target.value }))} onKeyDown={(event) => { if (event.key === "Enter") commitTask(); if (event.key === "Escape") setComposer(null); }} /></label>
      <div className="if-field"><span className="if-field__label">Priority</span><ControlSelect label="Task priority" value={composer.priority} options={PURSUIT_TASK_PRIORITIES} onChange={(priority) => setComposer((current) => ({ ...current, priority }))} triggerProps={{ className: "if-touch-target" }} /></div>
      <label className="if-field"><span className="if-field__label">Due</span><input className="if-input if-touch-target" type="date" value={composer.dueAt} onChange={(event) => setComposer((current) => ({ ...current, dueAt: event.target.value }))} /></label>
      <label className="if-field"><span className="if-field__label">Owner</span><input className="if-input if-touch-target" value={composer.owner} maxLength="80" placeholder="Unassigned" onChange={(event) => setComposer((current) => ({ ...current, owner: event.target.value }))} /></label>
      <div className="pursuit-tasks__composer-actions"><button type="button" className="if-btn if-btn--primary if-touch-target" disabled={!composer.title.trim()} onClick={commitTask}><Check size={15} />{composer.id ? "Save task" : "Create task"}</button><button type="button" className="if-btn if-btn--secondary if-touch-target" onClick={() => setComposer(null)}>Cancel</button></div>
    </div> : null}
    {tasks.some((task) => task.status === "done") ? <details className="pursuit-tasks__completed"><summary><Check size={14} />{tasks.filter((task) => task.status === "done").length} completed</summary><div>{tasks.filter((task) => task.status === "done").map((task) => <span key={task.id}><s>{task.title}</s><button type="button" disabled={!canWrite} onClick={() => patchTask(task, { status: "todo" })}>Restore</button></span>)}</div></details> : null}
    </div>
  </details>;
}

export default function OpportunityCommandRail({ record, watch = null, canWrite = false, onSavePursuit, onToggleTrack, intelligence, showRecordLink = true, compact = false }) {
  const id = recordId(record);
  const sourceUrl = record?.sourceUrl || record?.sourceUrls?.[0] || null;
  const [status, setStatus] = useState("");
  const saveQueue = useRef(Promise.resolve());
  const researchBusy = Boolean(intelligence?.activeJob || ["queued", "in_progress", "researching"].includes(intelligence?.state));

  async function commit(nextDraft, nextReviewAt) {
    if (!canWrite || !onSavePursuit) return;
    setStatus("Saving…");
    try {
      const task = saveQueue.current.catch(() => {}).then(() => onSavePursuit(id, { ...nextDraft, reviewAt: nextReviewAt }));
      saveQueue.current = task;
      await task;
      setStatus("Saved");
      window.setTimeout(() => setStatus((current) => current === "Saved" ? "" : current), 1_600);
    } catch (error) {
      setStatus(error.message || "Could not save pursuit state.");
    }
  }

  const actions = <nav className="if-panel__footer" style={{ justifyContent: "flex-start", flexWrap: "wrap" }} aria-label="Selected opportunity actions">
    <button type="button" className={watch ? "if-btn if-btn--secondary if-touch-target is-active" : "if-btn if-btn--secondary if-touch-target"} disabled={!canWrite} onClick={() => watch ? onToggleTrack?.(id) : void commit(normalizePursuit(), "")}><Star size={15} fill={watch ? "currentColor" : "none"} />{watch ? "Tracked" : "Track"}</button>
    <button type="button" className="if-btn if-btn--ai if-touch-target" disabled={!intelligence?.canWrite || researchBusy} aria-label="Build AI decision brief" aria-busy={researchBusy} onClick={() => { void intelligence?.research().catch(() => {}); }}><Sparkles size={15} />{researchBusy ? "Research running…" : "Research"}</button>
    {showRecordLink ? <a className="if-btn if-btn--primary if-touch-target" href={`#/budget-spend/explorer?spendView=record&capRecord=${encodeURIComponent(id)}`}><ListChecks size={15} />Open record</a> : null}
    <details className="dbi-data-table__columns pursuit-actions__more"><summary className="if-btn if-btn--secondary if-touch-target"><MoreHorizontal size={15} />More</summary><div><a className="if-btn if-btn--ghost" href={`#/budget-spend/timeline?capRecord=${encodeURIComponent(id)}`}><CalendarClock size={15} />Timeline</a>{sourceUrl ? <a className="if-btn if-btn--ghost" href={sourceUrl} target="_blank" rel="noreferrer"><ExternalLink size={15} />Source</a> : null}</div></details>
  </nav>;

  const compactActions = <nav className="if-panel__footer" aria-label="Selected opportunity actions">
    <button type="button" className={watch ? "if-btn if-btn--secondary if-touch-target is-active" : "if-btn if-btn--secondary if-touch-target"} disabled={!canWrite} onClick={() => watch ? onToggleTrack?.(id) : void commit(normalizePursuit(), "")}><Star size={15} fill={watch ? "currentColor" : "none"} />{watch ? "Tracked" : "Track"}</button>
    <button type="button" className="if-btn if-btn--ai if-touch-target" disabled={!intelligence?.canWrite || researchBusy} aria-label="Build AI decision brief" aria-busy={researchBusy} onClick={() => { void intelligence?.research().catch(() => {}); }}><Sparkles size={15} />{researchBusy ? "Research running…" : "Research"}</button>
    <details className="dbi-data-table__columns pursuit-actions__more"><summary className="if-btn if-btn--secondary if-touch-target"><MoreHorizontal size={15} />More</summary><div>{showRecordLink ? <a className="if-btn if-btn--ghost" href={`#/budget-spend/explorer?spendView=record&capRecord=${encodeURIComponent(id)}`}><ListChecks size={15} />Open record</a> : null}<a className="if-btn if-btn--ghost" href={`#/budget-spend/timeline?capRecord=${encodeURIComponent(id)}`}><CalendarClock size={15} />Timeline</a>{sourceUrl ? <a className="if-btn if-btn--ghost" href={sourceUrl} target="_blank" rel="noreferrer"><ExternalLink size={15} />Source</a> : null}</div></details>
  </nav>;

  if (compact) return <section className="opportunity-command-rail opportunity-command-rail--compact" data-opportunity-command-rail data-tracked={watch ? "true" : "false"}>
    {compactActions}
    <details className="opportunity-command-rail__setup">
      <summary><span><strong>Pursuit setup</strong><small>{watch ? `${normalizePursuit(watch.pursuit).stage} · ${normalizePursuit(watch.pursuit).owner || "Unassigned"}` : "Owner, stage, next action, and tasks"}</small></span><span>{status || (watch ? "Saved" : "Set up")}</span></summary>
      <div className="opportunity-command-rail__setup-body"><PursuitFields key={`${id}:${watch?.updatedAt || "new"}`} watch={watch} canWrite={canWrite} onCommit={commit} /><TaskList key={`${id}:${watch?.updatedAt || "new"}:tasks`} recordId={id} pursuit={normalizePursuit(watch?.pursuit)} canWrite={canWrite} onCommit={(next) => commit(next, watch?.reviewAt || "")} /></div>
    </details>
    {intelligence?.notice ? <div className={`if-alert ${intelligence.state === "failed" ? "if-alert--warning" : "if-alert--info"}`} role="status"><span>{intelligence.notice}</span></div> : null}
  </section>;

  return <section className="if-panel" data-opportunity-command-rail data-tracked={watch ? "true" : "false"}>
    <header className="if-panel__header">
      <div><h3 className="if-panel__title">Pursuit controls</h3><p className="if-panel__subtitle">Assign ownership, stage the work, and keep the next decision visible.</p></div>
      <span className="if-status if-status--sm" role="status" aria-live="polite">{status || (watch ? "Workspace pursuit" : "Not tracked")}</span>
    </header>
    <PursuitFields key={`${id}:${watch?.updatedAt || "new"}`} watch={watch} canWrite={canWrite} onCommit={commit} />
    <TaskList key={`${id}:${watch?.updatedAt || "new"}:tasks`} recordId={id} pursuit={normalizePursuit(watch?.pursuit)} canWrite={canWrite} onCommit={(next) => commit(next, watch?.reviewAt || "")} />
    {actions}
    {intelligence?.notice ? <div className={`if-alert ${intelligence.state === "failed" ? "if-alert--warning" : "if-alert--info"}`} role="status"><span>{intelligence.notice}</span></div> : null}
  </section>;
}
