import { useEffect, useRef, useState } from "react";
import { CalendarClock, Check, CheckCircle2, ExternalLink, ListChecks, MoreHorizontal, Pencil, Plus, Sparkles, Star, Trash2 } from "lucide-react";
import { ControlDialog } from "control-surface-ui/react";
import ControlSelect from "./ControlSelect.jsx";
import { useAuth } from "./AuthContext.jsx";
import { PURSUIT_STAGES, PURSUIT_TASK_EVENT, PURSUIT_TASK_PRIORITIES, PURSUIT_TASK_STATUSES, normalizePursuit, pursuitActionOptions } from "./pursuit-metadata.js";
import { opportunityRoute, timelineRoute } from "./cross-surface-routes.js";
import "./OpportunityCommandRail.css";

function recordId(record) {
  return record?.opportunityId || record?.sourceRecordId || record?.noticeId || record?.id || record?.reference || "";
}

function PursuitFields({ watch, canWrite, onCommit, ownerOptions, actionOptions }) {
  const [draft, setDraft] = useState(() => normalizePursuit(watch?.pursuit));
  const [reviewAt, setReviewAt] = useState(watch?.reviewAt || "");
  const draftRef = useRef(draft);
  const reviewAtRef = useRef(reviewAt);

  function commit(patch) {
    const nextDraft = normalizePursuit({ ...draftRef.current, ...patch });
    const nextReviewAt = patch.reviewAt ?? reviewAtRef.current;
    draftRef.current = nextDraft;
    reviewAtRef.current = nextReviewAt;
    setDraft(nextDraft);
    setReviewAt(nextReviewAt);
    void onCommit(nextDraft, nextReviewAt).catch(() => {});
  }

  return <div className="if-panel__body if-form-grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 12rem), 1fr))", gap: "0.5rem" }}>
    <div className="if-field"><span className="if-field__label">Stage</span><ControlSelect label="Stage" value={draft.stage} options={PURSUIT_STAGES} disabled={!canWrite} triggerProps={{ style: { minHeight: "2.75rem" } }} onChange={(stage) => commit({ stage })} /></div>
    <div className="if-field"><span className="if-field__label">Owner</span><ControlSelect ariaLabel="Owner" searchable value={draft.owner} options={ownerOptions} disabled={!canWrite} triggerProps={{ className: "if-touch-target" }} onChange={(owner) => commit({ owner })} /></div>
    <div className="if-field"><span className="if-field__label">Next action</span><ControlSelect ariaLabel="Next action" searchable value={draft.nextAction} options={actionOptions} disabled={!canWrite} triggerProps={{ className: "if-touch-target" }} onChange={(nextAction) => commit({ nextAction })} /></div>
    <label className="if-field"><span className="if-field__label">Checkpoint</span><input className="if-input if-touch-target" type="date" value={reviewAt} disabled={!canWrite} onChange={(event) => commit({ reviewAt: event.target.value })} /></label>
  </div>;
}

function taskId() {
  return globalThis.crypto?.randomUUID?.() || `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function TaskList({ recordId: id, pursuit, canWrite, onCommit, ownerOptions }) {
  const [composer, setComposer] = useState(null);
  const [pendingMutation, setPendingMutation] = useState(null);
  const [feedback, setFeedback] = useState(null);
  const [busyTaskId, setBusyTaskId] = useState("");
  const [completedOpen, setCompletedOpen] = useState(false);
  const dialogRef = useRef(null);
  const tasks = pursuit.tasks || [];
  const active = tasks.filter((task) => task.status !== "done");
  const [expanded, setExpanded] = useState(active.length > 0);
  const canAdd = canWrite && active.length < 6;
  const statusOptions = PURSUIT_TASK_STATUSES.map(([value, label]) => [value, value === "done" ? "Complete…" : label]);

  async function saveTasks(nextTasks, message = "Action plan saved.", busyId = "action-plan") {
    setBusyTaskId(busyId);
    setFeedback(null);
    try {
      await onCommit({ ...pursuit, tasks: nextTasks });
      setFeedback({ tone: "success", message });
      return true;
    } catch (error) {
      setFeedback({ tone: "danger", message: error.message || "The action plan could not be saved." });
      return false;
    } finally {
      setBusyTaskId("");
    }
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

  async function commitTask() {
    if (!composer?.title.trim()) return;
    const now = new Date().toISOString();
    const saved = { id: composer.id || taskId(), title: composer.title.trim(), status: composer.status, priority: composer.priority, dueAt: composer.dueAt, owner: composer.owner.trim(), sourceType: composer.sourceType, sourceId: composer.sourceId, sourceLabel: composer.sourceLabel, createdAt: composer.createdAt || now, completedAt: "" };
    const next = composer.id ? tasks.map((task) => task.id === composer.id ? saved : task) : [...active, saved, ...tasks.filter((task) => task.status === "done")].slice(0, 6);
    const savedSuccessfully = await saveTasks(next, composer.id ? "Action updated." : "Action created.", composer.id || "new-action");
    if (savedSuccessfully) setComposer(null);
  }

  function patchTask(task, patch) {
    if (patch.status === "done") {
      setPendingMutation({ type: "complete", task });
      return;
    }
    void applyTaskPatch(task, patch);
  }

  async function applyTaskPatch(task, patch, message = "Action updated.") {
    const completedAt = patch.status === "done" ? new Date().toISOString() : patch.status ? "" : task.completedAt;
    return saveTasks(tasks.map((item) => item.id === task.id ? { ...item, ...patch, completedAt } : item), message, task.id);
  }

  async function confirmMutation() {
    if (!pendingMutation) return;
    const { task, type } = pendingMutation;
    const savedSuccessfully = type === "complete"
      ? await applyTaskPatch(task, { status: "done" }, "Action completed. Restore it from Completed if needed.")
      : await saveTasks(tasks.filter((item) => item.id !== task.id), "Action deleted.", task.id);
    if (savedSuccessfully) {
      if (type === "complete") setCompletedOpen(true);
      setPendingMutation(null);
    }
  }

  return <details className="pursuit-tasks" data-pursuit-tasks open={expanded} onToggle={(event) => setExpanded(event.currentTarget.open)}>
    <summary><span><strong>Action plan</strong><small>{active.length ? `${active.length} open` : "No open actions"}</small></span><span>{expanded ? "Hide" : "Review"}</span></summary>
    <div className="pursuit-tasks__body">
    <header><p>Each action has one owner, status, and due date.</p>{canWrite ? <button type="button" className="if-btn if-btn--secondary if-btn--sm" disabled={!canAdd || Boolean(busyTaskId)} title={canAdd ? "Add a linked pursuit action" : "Complete or remove an action before adding another"} onClick={() => addTask()}><Plus size={14} />Add action</button> : null}</header>
    {active.length ? <div className="pursuit-tasks__list">{active.slice(0, 5).map((task) => <article key={task.id} data-pursuit-task={task.status} data-task-priority={task.priority}>
      <div className="pursuit-tasks__identity"><strong>{task.title}</strong><small>{[task.owner || "Unassigned", task.dueAt ? `Due ${task.dueAt.slice(0, 10)}` : "No due date", task.sourceLabel || (task.sourceType === "manual" ? "Manual action" : task.sourceType)].filter(Boolean).join(" · ")}</small></div>
      <ControlSelect label={`Status for ${task.title}`} value={task.status} options={statusOptions} disabled={!canWrite || busyTaskId === task.id} onChange={(status) => patchTask(task, { status })} triggerProps={{ className: "pursuit-tasks__status" }} />
      {canWrite ? <div className="pursuit-tasks__row-actions"><button type="button" className="if-btn if-btn--ghost if-btn--sm" disabled={Boolean(busyTaskId)} aria-label={`Edit ${task.title}`} onClick={() => addTask(task)}><Pencil size={13} />Edit</button><button type="button" className="if-btn if-btn--ghost if-btn--sm" disabled={Boolean(busyTaskId)} aria-label={`Delete ${task.title}`} onClick={() => setPendingMutation({ type: "delete", task })}><Trash2 size={13} />Delete</button></div> : null}
    </article>)}</div> : <p className="pursuit-tasks__empty">Turn the next decision, a cited research action, or selected evidence into a dated task.</p>}
    {composer ? <div className="pursuit-tasks__composer" data-task-composer>
      <label className="if-field pursuit-tasks__title"><span className="if-field__label">Task</span><input className="if-input if-touch-target" autoFocus value={composer.title} maxLength="160" placeholder="What needs to happen next?" onChange={(event) => setComposer((current) => ({ ...current, title: event.target.value }))} onKeyDown={(event) => { if (event.key === "Enter") commitTask(); if (event.key === "Escape") setComposer(null); }} /></label>
      <div className="if-field"><span className="if-field__label">Priority</span><ControlSelect label="Task priority" value={composer.priority} options={PURSUIT_TASK_PRIORITIES} onChange={(priority) => setComposer((current) => ({ ...current, priority }))} triggerProps={{ className: "if-touch-target" }} /></div>
      <label className="if-field"><span className="if-field__label">Due</span><input className="if-input if-touch-target" type="date" value={composer.dueAt} onChange={(event) => setComposer((current) => ({ ...current, dueAt: event.target.value }))} /></label>
      <div className="if-field"><span className="if-field__label">Owner</span><ControlSelect ariaLabel="Task owner" searchable value={composer.owner} options={ownerOptions} onChange={(owner) => setComposer((current) => ({ ...current, owner }))} triggerProps={{ className: "if-touch-target" }} /></div>
      <div className="pursuit-tasks__composer-actions"><button type="button" className="if-btn if-btn--primary if-btn--sm" disabled={!composer.title.trim() || Boolean(busyTaskId)} onClick={() => void commitTask()}><Check size={14} />{busyTaskId ? "Saving…" : composer.id ? "Save action" : "Create action"}</button><button type="button" className="if-btn if-btn--secondary if-btn--sm" disabled={Boolean(busyTaskId)} onClick={() => setComposer(null)}>Cancel</button></div>
    </div> : null}
    {feedback ? <div className={`if-alert if-alert--${feedback.tone}`} role={feedback.tone === "danger" ? "alert" : "status"} data-action-plan-feedback>{feedback.message}</div> : null}
    {tasks.some((task) => task.status === "done") ? <details className="pursuit-tasks__completed" open={completedOpen} onToggle={(event) => setCompletedOpen(event.currentTarget.open)}><summary><Check size={14} />{tasks.filter((task) => task.status === "done").length} completed</summary><div>{tasks.filter((task) => task.status === "done").map((task) => <span key={task.id} data-completed-task={task.id}><s>{task.title}</s><button type="button" disabled={!canWrite || Boolean(busyTaskId)} onClick={() => void applyTaskPatch(task, { status: "todo" }, "Action restored to the open plan.")}>Restore</button></span>)}</div></details> : null}
    </div>
    {pendingMutation ? <ControlDialog open onClose={() => { if (!busyTaskId) setPendingMutation(null); }} title={pendingMutation.type === "complete" ? "Complete this action?" : "Delete this action?"} eyebrow="Action plan" summary={pendingMutation.type === "complete" ? "This moves the action out of the active plan. You can restore it later from Completed." : "This permanently removes the action from the pursuit plan."} dialogRef={dialogRef} surfaceProps={{ "data-task-confirmation": pendingMutation.type }} footer={<><button type="button" className="if-btn" disabled={Boolean(busyTaskId)} onClick={() => setPendingMutation(null)}>Cancel</button><button type="button" className={pendingMutation.type === "delete" ? "if-btn if-btn--danger" : "if-btn if-btn--primary"} disabled={Boolean(busyTaskId)} onClick={() => void confirmMutation()}>{pendingMutation.type === "complete" ? <CheckCircle2 size={15} /> : <Trash2 size={15} />}{busyTaskId ? "Saving…" : pendingMutation.type === "complete" ? "Complete action" : "Delete action"}</button></>}><div className="pursuit-task-confirmation"><strong>{pendingMutation.task.title}</strong><span>{[pendingMutation.task.owner || "Unassigned", pendingMutation.task.dueAt ? `Due ${pendingMutation.task.dueAt.slice(0, 10)}` : "No due date"].join(" · ")}</span></div></ControlDialog> : null}
  </details>;
}

export default function OpportunityCommandRail({ record, watch = null, canWrite = false, onSavePursuit, onToggleTrack, intelligence, showRecordLink = true, compact = false, showActions = true, workspaceActions = [] }) {
  const auth = useAuth();
  const id = recordId(record);
  const sourceUrl = record?.sourceUrl || record?.sourceUrls?.[0] || null;
  const [status, setStatus] = useState("");
  const [directory, setDirectory] = useState(() => auth?.user ? [{ id: auth.user.id || "current-user", displayName: auth.user.displayName, title: auth.user.title || "" }] : []);
  const saveQueue = useRef(Promise.resolve());
  const researchBusy = Boolean(intelligence?.activeJob || ["queued", "in_progress", "researching"].includes(intelligence?.state));
  useEffect(() => {
    if (!auth?.enabled || !auth?.user || !auth?.listDirectory) return undefined;
    let active = true;
    void auth.listDirectory().then((payload) => { if (active) setDirectory(payload.users || []); }).catch(() => {});
    return () => { active = false; };
  }, [auth]);
  const currentOwner = watch?.pursuit?.owner || "";
  const ownerOptions = [
    { value: "", label: "Unassigned", description: "No workspace owner" },
    ...directory.map((user) => ({ value: user.displayName, label: user.displayName, description: user.title || user.role || "Workspace member" })),
  ];
  if (!auth?.enabled && ownerOptions.length === 1) ownerOptions.push({ value: "Workspace owner", label: "Workspace owner", description: "Local workspace" });
  if (currentOwner && !ownerOptions.some((option) => option.value === currentOwner)) ownerOptions.push({ value: currentOwner, label: currentOwner, description: "Current assignment" });
  const actionOptions = pursuitActionOptions(workspaceActions, intelligence);
  const currentAction = watch?.pursuit?.nextAction || "";
  if (currentAction && !actionOptions.some((option) => option.value === currentAction)) actionOptions.unshift({ value: currentAction, label: currentAction, description: "Current next action" });

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
      throw error;
    }
  }

  const actions = <nav className="if-panel__footer" style={{ justifyContent: "flex-start", flexWrap: "wrap" }} aria-label="Selected opportunity actions">
    <button type="button" className={watch ? "if-btn if-btn--secondary if-touch-target is-active" : "if-btn if-btn--secondary if-touch-target"} disabled={!canWrite} onClick={() => watch ? onToggleTrack?.(id) : void commit(normalizePursuit(), "")}><Star size={15} fill={watch ? "currentColor" : "none"} />{watch ? "Tracked" : "Track"}</button>
    <button type="button" className="if-btn if-btn--ai if-touch-target" disabled={!intelligence?.canWrite || researchBusy} aria-label="Build AI decision brief" aria-busy={researchBusy} onClick={() => { void intelligence?.research().catch(() => {}); }}><Sparkles size={15} />{researchBusy ? "Research running…" : "Research"}</button>
    {showRecordLink ? <a className="if-btn if-btn--primary if-touch-target" href={opportunityRoute(id)}><ListChecks size={15} />Open workspace</a> : null}
    <details className="dbi-data-table__columns pursuit-actions__more"><summary className="if-btn if-btn--secondary if-touch-target"><MoreHorizontal size={15} />More</summary><div><a className="if-btn if-btn--ghost" href={timelineRoute(id)}><CalendarClock size={15} />Timeline</a>{sourceUrl ? <a className="if-btn if-btn--ghost" href={sourceUrl} target="_blank" rel="noreferrer"><ExternalLink size={15} />Source</a> : null}</div></details>
  </nav>;

  const compactActions = <nav className="if-panel__footer" aria-label="Selected opportunity actions">
    <button type="button" className={watch ? "if-btn if-btn--secondary if-touch-target is-active" : "if-btn if-btn--secondary if-touch-target"} disabled={!canWrite} onClick={() => watch ? onToggleTrack?.(id) : void commit(normalizePursuit(), "")}><Star size={15} fill={watch ? "currentColor" : "none"} />{watch ? "Tracked" : "Track"}</button>
    <button type="button" className="if-btn if-btn--ai if-touch-target" disabled={!intelligence?.canWrite || researchBusy} aria-label="Build AI decision brief" aria-busy={researchBusy} onClick={() => { void intelligence?.research().catch(() => {}); }}><Sparkles size={15} />{researchBusy ? "Research running…" : "Research"}</button>
    <details className="dbi-data-table__columns pursuit-actions__more"><summary className="if-btn if-btn--secondary if-touch-target"><MoreHorizontal size={15} />More</summary><div>{showRecordLink ? <a className="if-btn if-btn--ghost" href={opportunityRoute(id)}><ListChecks size={15} />Open workspace</a> : null}<a className="if-btn if-btn--ghost" href={timelineRoute(id)}><CalendarClock size={15} />Timeline</a>{sourceUrl ? <a className="if-btn if-btn--ghost" href={sourceUrl} target="_blank" rel="noreferrer"><ExternalLink size={15} />Source</a> : null}</div></details>
  </nav>;

  if (compact) return <section className="opportunity-command-rail opportunity-command-rail--compact" data-opportunity-command-rail data-tracked={watch ? "true" : "false"}>
    {showActions ? compactActions : null}
    <details className="opportunity-command-rail__setup">
      <summary><span><strong>Pursuit setup</strong><small>{watch ? `${normalizePursuit(watch.pursuit).stage} · ${normalizePursuit(watch.pursuit).owner || "Unassigned"}` : "Owner, stage, next action, and tasks"}</small></span><span>{status || (watch ? "Saved" : "Set up")}</span></summary>
      <div className="opportunity-command-rail__setup-body"><PursuitFields key={`${id}:${watch?.updatedAt || "new"}`} watch={watch} canWrite={canWrite} onCommit={commit} ownerOptions={ownerOptions} actionOptions={actionOptions} /><TaskList key={`${id}:tasks`} recordId={id} pursuit={normalizePursuit(watch?.pursuit)} canWrite={canWrite} onCommit={(next) => commit(next, watch?.reviewAt || "")} ownerOptions={ownerOptions} /></div>
    </details>
  </section>;

  return <section className="if-panel" data-opportunity-command-rail data-tracked={watch ? "true" : "false"}>
    <header className="if-panel__header">
      <div><h3 className="if-panel__title">Pursuit controls</h3><p className="if-panel__subtitle">Assign ownership, stage the work, and keep the next decision visible.</p></div>
      <span className="if-status if-status--sm" role="status" aria-live="polite">{status || (watch ? "Workspace pursuit" : "Not tracked")}</span>
    </header>
    <PursuitFields key={`${id}:${watch?.updatedAt || "new"}`} watch={watch} canWrite={canWrite} onCommit={commit} ownerOptions={ownerOptions} actionOptions={actionOptions} />
    <TaskList key={`${id}:tasks`} recordId={id} pursuit={normalizePursuit(watch?.pursuit)} canWrite={canWrite} onCommit={(next) => commit(next, watch?.reviewAt || "")} ownerOptions={ownerOptions} />
    {showActions ? actions : null}
  </section>;
}
