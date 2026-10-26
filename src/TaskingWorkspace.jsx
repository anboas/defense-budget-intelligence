import { lazy, Suspense, useMemo, useState } from "react";
import {
  AlertTriangle, ArrowRight, CheckCircle2, ChevronDown, ChevronRight, CircleDot,
  File, FileText, Folder, FolderOpen, GitBranch, Link2, ListFilter, RotateCcw, Save, Search,
} from "lucide-react";
import { ControlPageBody, ControlStatusBadge } from "control-surface-ui/react";
import ControlSelect from "./ControlSelect.jsx";
import SemanticStatusBadge from "./SemanticStatusBadge.jsx";
import ControlWorkbenchHeader from "./WorkbenchHeader.jsx";
import { flattenTaskingFolders } from "./tasking-foundation-data.js";
import { buildTaskingFileAnalytics, formatTaskingBytes, formatTaskingDate, sortTaskingFiles } from "./tasking-file-analytics.js";
import { TASKING_TASK_STATUSES, taskingTaskOwnerRequired } from "./tasking-model.js";
import { useTaskingTasks } from "./use-tasking-tasks.js";
import "./TaskingWorkspace.css";

const VIEW_IDS = new Set(["portfolio", "files", "connections"]);
const OPEN_STATUSES = new Set(["draft", "ready", "in-progress", "waiting", "review"]);
const FILE_RELATIONS = new Set(["all", "task", "workspace", "unlinked"]);
const FILE_SORTS = new Set(["modified-desc", "size-desc", "name-asc"]);
const TaskingFileView = lazy(() => import("./TaskingFileView.jsx"));

function taskStatusLabel(status) {
  if (status === "review") return "In review";
  if (status === "completed") return "Complete";
  return status.replaceAll("-", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function routeState(routeHash = "") {
  const params = new URLSearchParams(String(routeHash).split("?")[1] || "");
  const requestedView = params.get("taskingView") || "portfolio";
  return {
    view: VIEW_IDS.has(requestedView) ? requestedView : "portfolio",
    recordId: params.get("taskingRecord") || "",
    query: params.get("taskingQuery") || "",
    workstreamId: params.get("taskingWorkstream") || "all",
    status: params.get("taskingStatus") || "all",
    fileType: params.get("taskingFileType") || "all",
    fileRelation: FILE_RELATIONS.has(params.get("taskingFileRelation")) ? params.get("taskingFileRelation") : "all",
    fileSort: FILE_SORTS.has(params.get("taskingFileSort")) ? params.get("taskingFileSort") : "modified-desc",
  };
}

function updateTaskingRoute(patch) {
  const [path, search = ""] = String(window.location.hash || "#/tasking").split("?");
  const params = new URLSearchParams(search);
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined || value === null || value === "" || value === "all") params.delete(key);
    else params.set(key, String(value));
  }
  window.location.hash = `${path}${params.size ? `?${params}` : ""}`;
}

function recordHref(recordId, view) {
  const params = new URLSearchParams(String(window.location.hash).split("?")[1] || "");
  params.set("taskingView", view);
  params.set("taskingRecord", recordId);
  return `#/tasking?${params}`;
}

function FolderTreeNode({ node, selectedId, onSelect, depth = 0 }) {
  const hasChildren = Boolean(node.children?.length);
  const [expanded, setExpanded] = useState(depth < 2);
  const Icon = node.kind === "folder" ? (expanded ? FolderOpen : Folder) : node.name.endsWith(".xlsx") ? File : FileText;
  return <li className="tasking-tree__item" data-depth={depth}>
    <div className={`tasking-tree__row${selectedId === node.id ? " is-selected" : ""}`} style={{ "--tasking-tree-depth": depth }}>
      {hasChildren ? <button type="button" className="tasking-tree__toggle" aria-label={`${expanded ? "Collapse" : "Expand"} ${node.name}`} aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}>{expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}</button> : <span className="tasking-tree__spacer" aria-hidden="true" />}
      <button type="button" className="tasking-tree__select" aria-current={selectedId === node.id ? "true" : undefined} onClick={() => onSelect(node)}>
        <Icon size={15} aria-hidden="true" />
        <span>{node.name}</span>
        {node.status ? <i className={`tasking-tree__state is-${node.status}`} aria-label={node.status} /> : null}
      </button>
    </div>
    {hasChildren && expanded ? <ul>{node.children.map((child) => <FolderTreeNode key={child.id} node={child} selectedId={selectedId} onSelect={onSelect} depth={depth + 1} />)}</ul> : null}
  </li>;
}

function FolderTree({ folders, selectedId, onSelect, itemCount = 0 }) {
  return <section className="tasking-folder-panel" aria-labelledby="tasking-folder-title">
    <header><div><span>Source structure</span><h3 id="tasking-folder-title">Business homes</h3></div><ControlStatusBadge status={itemCount ? "verified" : "neutral"} label={itemCount ? `${itemCount} indexed` : "No source"} /></header>
    {folders.length ? <ul className="tasking-tree">{folders.map((node) => <FolderTreeNode key={node.id} node={node} selectedId={selectedId} onSelect={onSelect} />)}</ul> : <div className="tasking-empty"><Folder size={20} /><strong>No source metadata</strong><span>Codex can add read-only local source metadata through the Agent API.</span></div>}
    <footer><strong>Folder hierarchy and work context stay separate.</strong><span>Originals are never moved to match Tasking classifications.</span></footer>
  </section>;
}

function sourceTree(sourceItems = []) {
  if (!sourceItems.length) return [];
  const activeItems = sourceItems.filter((item) => !item.deletedAt);
  const nodes = new Map(activeItems.map((item) => [item.sourceId, { ...item, kind: item.itemType, children: [] }]));
  const roots = [];
  for (const item of activeItems) {
    const node = nodes.get(item.sourceId);
    const parent = nodes.get(item.parentSourceId);
    if (parent && parent !== node) parent.children.push(node); else roots.push(node);
  }
  const sortNodes = (items) => items.sort((left, right) => (left.kind === right.kind ? left.name.localeCompare(right.name) : left.kind === "folder" ? -1 : 1)).map((item) => ({ ...item, children: sortNodes(item.children) }));
  return sortNodes(roots);
}

function TaskRow({ task, selected, onSelect }) {
  return <button type="button" className={`tasking-task-row${selected ? " is-selected" : ""}`} onClick={() => onSelect(task.id)}>
    <span className="tasking-task-row__status" data-status={task.status} aria-hidden="true" />
    <span><strong>{task.title}</strong><small>{task.owner || "No owner"} · {task.evidenceCount || 0} evidence{task.dependencyCount ? ` · ${task.dependencyCount} wait` : ""}</small></span>
    <SemanticStatusBadge category="workflow" value={task.status} />
  </button>;
}

function AnchorCard({ anchor, tasks, selectedId, onSelect }) {
  const selected = selectedId === anchor.id || tasks.some((task) => task.id === selectedId);
  return <article className={`tasking-anchor-card${selected ? " is-selected" : ""}`} data-anchor-kind={anchor.kind.toLowerCase()}>
    <button type="button" className="tasking-anchor-card__head" onClick={() => onSelect(anchor.id)}>
      <span><small>{anchor.kind} anchor</small><strong>{anchor.title}</strong></span>
      <SemanticStatusBadge category="workflow" value={anchor.status} />
    </button>
    <div className="tasking-anchor-card__outcome"><span>Outcome</span><p>{anchor.outcome || "No outcome recorded."}</p></div>
    <div className="tasking-anchor-card__move"><span>Next accepted move</span><strong>{anchor.nextMove || "No next move recorded"}</strong><small>{anchor.dueLabel || "No date"}</small></div>
    <div className="tasking-anchor-card__tasks">{tasks.length ? tasks.map((task) => <TaskRow key={task.id} task={task} selected={selectedId === task.id} onSelect={onSelect} />) : <p className="tasking-anchor-card__empty">No tasks attached yet.</p>}</div>
    <footer><span><Link2 size={12} />{anchor.connectionIds?.length || 0} connected records</span><span>{anchor.updatedLabel || "Workspace updated"}</span></footer>
  </article>;
}

function PortfolioView({ workstreams, anchors, tasks, selectedId, onSelect }) {
  return <section className="tasking-lanes" aria-label="Workstream portfolio">
    {workstreams.map((workstream) => {
      const laneAnchors = anchors.filter((anchor) => anchor.workstreamId === workstream.id);
      const laneTasks = tasks.filter((task) => laneAnchors.some((anchor) => anchor.id === task.anchorId));
      return <section key={workstream.id} className="tasking-lane" data-tone={workstream.tone}>
        <header className="tasking-lane__identity"><small>Workstream</small><h3>{workstream.name}</h3><p>{workstream.description}</p><strong>{laneAnchors.length} {laneAnchors.length === 1 ? "anchor" : "anchors"} · {laneTasks.length} {laneTasks.length === 1 ? "task" : "tasks"}</strong></header>
        <div className="tasking-lane__anchors">{laneAnchors.map((anchor) => <AnchorCard key={anchor.id} anchor={anchor} tasks={tasks.filter((task) => task.anchorId === anchor.id)} selectedId={selectedId} onSelect={onSelect} />)}</div>
      </section>;
    })}
  </section>;
}

function ConnectionsView({ records, relationships, selectedId, onSelect }) {
  const visibleIds = new Set(relationships.flatMap((relationship) => [relationship.fromId, relationship.toId]));
  const nodes = records.filter((record) => visibleIds.has(record.id));
  return <section className="tasking-connections" aria-labelledby="tasking-connections-title">
    <header><div><span>Typed relationship view</span><h3 id="tasking-connections-title">Connected work</h3><p>Confirmed links are solid. Suggested links remain dashed until human review.</p></div><span className="tasking-connections__legend"><i />Confirmed <i className="is-suggested" />Suggested</span></header>
    {relationships.length ? <><div className="tasking-graph" aria-label="Records participating in Tasking relationships">
      {nodes.map((record) => <button key={record.id} type="button" className={`tasking-graph__node${selectedId === record.id ? " is-selected" : ""}`} onClick={() => onSelect(record.id)}>
        <small>{record.kind}</small><strong>{record.title}</strong><span>{record.status?.replaceAll("-", " ") || "Context"}</span>
      </button>)}
    </div>
    <div className="tasking-relationship-list" role="list" aria-label="Relationship list alternative">{relationships.map((relationship) => {
      const from = records.find((record) => record.id === relationship.fromId);
      const to = records.find((record) => record.id === relationship.toId);
      return <article key={relationship.id} role="listitem"><span><strong>{from?.title || relationship.fromId}</strong><small>{from?.kind || "Missing record"}</small></span><span className={relationship.status === "suggested" ? "is-suggested" : ""}><GitBranch size={14} />{relationship.type}<small>{relationship.status}</small></span><span><strong>{to?.title || relationship.toId}</strong><small>{to?.kind || "Missing record"}</small></span></article>;
    })}</div></> : <div className="tasking-empty"><GitBranch size={20} /><strong>No relationships recorded</strong><span>Typed connections will appear here after review.</span></div>}
  </section>;
}

function TaskEditor({ task, canWrite, saving, notice, onSave, onReset }) {
  const [draft, setDraft] = useState(() => ({ status: task.status, owner: task.owner, acceptance: task.acceptance }));
  const ownerRequired = taskingTaskOwnerRequired(draft.status);
  return <form className="tasking-task-editor" data-tasking-task-editor onSubmit={(event) => { event.preventDefault(); void onSave(task.id, draft).catch(() => {}); }}>
    <header><h4>Task state <span>{task.persisted ? `Version ${task.version}` : "Foundation value"}</span></h4>{task.persisted ? <ControlStatusBadge status="verified" label="Persisted" /> : null}</header>
    <label><span>Status</span><span data-tasking-status-control><ControlSelect compact ariaLabel="Task status" value={draft.status} options={TASKING_TASK_STATUSES.map((value) => [value, taskStatusLabel(value)])} onChange={(value) => setDraft((current) => ({ ...current, status: value }))} disabled={!canWrite || saving} /></span></label>
    <label><span>Owner{ownerRequired ? "" : " (optional for draft)"}</span><input className="if-input" data-tasking-owner-input value={draft.owner} maxLength={100} placeholder={ownerRequired ? "Name the accountable owner" : "Leave blank until confirmed"} disabled={!canWrite || saving} onChange={(event) => setDraft((current) => ({ ...current, owner: event.target.value }))} /></label>
    <label><span>Acceptance</span><textarea className="if-input" value={draft.acceptance} maxLength={500} rows={3} disabled={!canWrite || saving} onChange={(event) => setDraft((current) => ({ ...current, acceptance: event.target.value }))} /></label>
    <div className="tasking-task-editor__actions"><button className="if-btn if-btn--primary if-btn--sm" type="submit" disabled={!canWrite || saving || (ownerRequired && !draft.owner.trim()) || !draft.acceptance.trim()}><Save size={14} />{saving ? "Saving…" : "Save task"}</button>{task.persisted ? <button className="if-btn if-btn--ghost if-btn--sm" type="button" disabled={!canWrite || saving} onClick={() => void onReset(task.id).catch(() => {})}><RotateCcw size={14} />Remove</button> : null}</div>
    {notice ? <p className="if-field__hint" role="status">{notice}</p> : null}
    {!canWrite ? <p className="if-field__hint">Workspace write access is required to change task state.</p> : null}
  </form>;
}

function ContextPanel({ record, anchor, folder, relatedRecords, relationshipRows, workstreams, onSelect, taskState }) {
  if (!record) return <aside className="tasking-context"><p>No record selected.</p></aside>;
  const task = record.kind === "Task" ? record : null;
  const file = record.kind === "File" ? record : null;
  return <aside className="tasking-context" aria-labelledby="tasking-context-title">
    <header><span>Selected {record.kind}</span><h3 id="tasking-context-title">{record.title || record.name}</h3><SemanticStatusBadge category="workflow" value={record.status || "ready"} /></header>
    <section className="tasking-context__summary"><h4>What matters</h4><p>{record.description || record.outcome || record.summary || (file ? "Read-only source metadata is available without opening or changing the file." : "Folder context is available without changing the source structure.")}</p></section>
    <dl className="tasking-context__facts">
      {file ? <>
        <div><dt>File type</dt><dd>{file.fileType?.label || "Unknown"}</dd></div>
        <div><dt>Size</dt><dd>{formatTaskingBytes(file.size)}</dd></div>
        <div><dt>Last modified</dt><dd>{formatTaskingDate(file.lastModifiedAt)}</dd></div>
        <div><dt>Task relation</dt><dd>{file.taskIds?.length ? `${file.taskIds.length} ${file.taskIds.length === 1 ? "task" : "tasks"}` : file.workspaceLinked ? "Workspace only" : "Not linked"}</dd></div>
      </> : <>
        <div><dt>Primary placement</dt><dd>{anchor ? workstreams.find((workstream) => workstream.id === anchor.workstreamId)?.name : "Source structure"}</dd></div>
        <div><dt>Business home</dt><dd>{folder?.path || "Not linked"}</dd></div>
        <div><dt>Source state</dt><dd>{anchor?.sourceState || record.status || "Observed"}</dd></div>
        <div><dt>Acceptance</dt><dd>{task?.acceptance || "Record-specific review"}</dd></div>
      </>}
    </dl>
    {anchor ? <section className="tasking-context__next"><span>Next accepted move</span><strong>{anchor.nextMove}</strong><small>{anchor.dueLabel}</small></section> : null}
    {task ? <TaskEditor key={`${task.id}:${task.version}`} task={task} canWrite={taskState.canWrite} saving={taskState.savingTaskId === task.id} notice={taskState.notice} onSave={taskState.saveTask} onReset={taskState.resetTask} /> : null}
    <section className="tasking-context__links"><header><h4>Connected context</h4><span>{relatedRecords.length}</span></header>{relatedRecords.map((related) => <button key={related.id} type="button" onClick={() => onSelect(related.id)}><span><strong>{related.title || related.name}</strong><small>{related.kind}</small></span><ArrowRight size={14} /></button>)}</section>
    {relationshipRows.length ? <section className="tasking-context__basis"><h4>Relationship basis</h4>{relationshipRows.map((relationship) => <p key={relationship.id}><span className={relationship.status === "suggested" ? "is-suggested" : ""}>{relationship.status}</span>{relationship.type} · {relationship.basis}</p>)}</section> : null}
    <footer><CircleDot size={14} /><span><strong>{taskState.persistenceLabel}</strong>{taskState.workspace.sourceItems?.length ? "Codex-synchronized source metadata is available; source files remain read only and outside this application." : "Tasking state is scoped to the active workspace."}</span></footer>
  </aside>;
}

export default function TaskingWorkspace({ routeHash = "" }) {
  const routed = routeState(routeHash);
  const taskState = useTaskingTasks();
  const workspace = taskState.workspace;
  const tasks = workspace.tasks;
  const [query, setQuery] = useState(routed.query);
  const [workstreamId, setWorkstreamId] = useState(routed.workstreamId);
  const [status, setStatus] = useState(routed.status);
  const [fileType, setFileType] = useState(routed.fileType);
  const [fileRelation, setFileRelation] = useState(routed.fileRelation);
  const [fileSort, setFileSort] = useState(routed.fileSort);
  const sourceFolders = useMemo(() => sourceTree(workspace.sourceItems), [workspace.sourceItems]);
  const folderRoots = useMemo(() => [...workspace.folders, ...sourceFolders], [sourceFolders, workspace.folders]);
  const flatFolders = useMemo(() => flattenTaskingFolders(folderRoots), [folderRoots]);
  const fileAnalytics = useMemo(() => buildTaskingFileAnalytics(flatFolders, tasks, workspace.relationships), [flatFolders, tasks, workspace.relationships]);
  const activeFileType = fileType === "all" || fileAnalytics.types.some((type) => type.id === fileType) ? fileType : "all";
  const filesById = useMemo(() => new Map(fileAnalytics.files.map((file) => [file.id, file])), [fileAnalytics.files]);
  const records = useMemo(() => [...workspace.anchors, ...tasks, ...workspace.contextRecords, ...flatFolders.map((entry) => ({ ...(filesById.get(entry.id) || entry), title: entry.name, kind: entry.kind === "folder" ? "Folder" : "File" }))], [filesById, flatFolders, tasks, workspace.anchors, workspace.contextRecords]);
  const selected = records.find((record) => record.id === routed.recordId) || workspace.anchors[0] || tasks[0] || flatFolders[0] || null;
  const selectedAnchor = selected?.kind === "Task" ? workspace.anchors.find((anchor) => anchor.id === selected.anchorId) : workspace.anchors.find((anchor) => anchor.id === selected?.id || anchor.id === selected?.recordId || anchor.folderId === selected?.id);
  const selectedFolder = ["Folder", "File"].includes(selected?.kind) ? selected : flatFolders.find((entry) => entry.id === selectedAnchor?.folderId);
  const selectedFolderId = ["Folder", "File"].includes(selected?.kind) ? selected.id : selectedFolder?.id;
  const selectedRelationships = workspace.relationships.filter((relationship) => selected && ([relationship.fromId, relationship.toId].includes(selected.id) || (selectedAnchor && [relationship.fromId, relationship.toId].includes(selectedAnchor.id))));
  const relatedIds = new Set([
    ...(selectedAnchor?.connectionIds || []),
    selected?.recordId,
    ...selectedRelationships.flatMap((relationship) => [relationship.fromId, relationship.toId]),
  ].filter(Boolean));
  relatedIds.delete(selected?.id);
  if (selected?.kind !== "File") relatedIds.delete(selectedAnchor?.id);
  const relatedRecords = records.filter((record) => relatedIds.has(record.id)).slice(0, 6);
  const normalizedQuery = query.trim().toLowerCase();
  const filteredFiles = sortTaskingFiles(fileAnalytics.files.filter((file) => {
    const matchesQuery = !normalizedQuery || [file.name, file.path, file.summary, file.mimeType, file.fileType.label, ...file.taskTitles].some((value) => String(value || "").toLowerCase().includes(normalizedQuery));
    const matchesType = activeFileType === "all" || file.fileType.id === activeFileType;
    const matchesRelation = fileRelation === "all" || (fileRelation === "task" && file.taskIds.length > 0) || (fileRelation === "workspace" && file.workspaceLinked) || (fileRelation === "unlinked" && !file.workspaceLinked && !file.taskIds.length);
    return matchesQuery && matchesType && matchesRelation;
  }), fileSort);
  const filteredAnchors = workspace.anchors.filter((anchor) => {
    const anchorTasks = tasks.filter((task) => task.anchorId === anchor.id);
    const matchesQuery = !normalizedQuery || [anchor.title, anchor.outcome, anchor.nextMove, ...anchorTasks.flatMap((task) => [task.title, task.description])].some((value) => String(value).toLowerCase().includes(normalizedQuery));
    const matchesWorkstream = workstreamId === "all" || anchor.workstreamId === workstreamId;
    const matchesStatus = status === "all" || anchor.status === status || anchorTasks.some((task) => task.status === status);
    return matchesQuery && matchesWorkstream && matchesStatus;
  });
  const visibleAnchorIds = new Set(filteredAnchors.map((anchor) => anchor.id));
  const filteredWorkstreams = workspace.workstreams.filter((workstream) => (workstream.anchors || []).some((anchorId) => visibleAnchorIds.has(anchorId)));
  const filteredTasks = tasks.filter((task) => visibleAnchorIds.has(task.anchorId) && (status === "all" || task.status === status));
  const waiting = tasks.filter((task) => task.status === "waiting").length;
  const review = tasks.filter((task) => task.status === "review").length;

  function selectRecord(recordOrId, preferredView = routed.view) {
    const record = typeof recordOrId === "string" ? records.find((item) => item.id === recordOrId) : recordOrId;
    const recordId = record?.id || recordOrId || "";
    updateTaskingRoute({ taskingView: preferredView, taskingRecord: recordId });
  }

  function commitFilter(key, value, setter) {
    setter(value);
    updateTaskingRoute({ [key]: value, taskingRecord: routed.recordId });
  }

  function commitFileFilter(key, value) {
    const setters = { taskingFileType: setFileType, taskingFileRelation: setFileRelation, taskingFileSort: setFileSort };
    setters[key]?.(value);
    updateTaskingRoute({ [key]: value, taskingRecord: routed.recordId });
  }

  const counts = workspace.metadata?.counts || {};
  const headerMeta = <span className="tasking-workspace-state"><CircleDot size={14} /><strong>{workspace.metadata?.label || taskState.persistenceLabel}</strong><span>{workspace.metadata?.coverage}</span></span>;
  return <section className="tasking-workspace" data-tasking-workspace data-tasking-view={routed.view}>
    <ControlWorkbenchHeader eyebrow="Workspace work" title="Tasking" summary="See where work lives, how it clusters into workstreams, what is connected, and what needs movement next." meta={headerMeta} metrics={[
      { id: "workstreams", label: "Workstreams", value: workspace.workstreams.length, meta: "One primary placement per task" },
      { id: "active", label: "Open work", value: tasks.filter((task) => OPEN_STATUSES.has(task.status)).length, meta: `${tasks.filter((task) => task.status === "draft").length} drafts`, tone: "info" },
      { id: "sources", label: "Source items", value: counts.sourceItems ?? workspace.sourceItems.length, meta: `${fileAnalytics.reviewedFiles} reviewed ${fileAnalytics.reviewedFiles === 1 ? "file" : "files"}` },
      { id: "linked", label: "Linked sources", value: counts.linkedSourceItems ?? workspace.sourceItems.filter((item) => item.recordId).length, meta: "Connected to workspace records", tone: counts.linkedSourceItems ? "success" : "warning" },
      { id: "review", label: "Needs attention", value: waiting + review, meta: `${waiting} waiting · ${review} in review`, tone: waiting + review ? "warning" : "success" },
    ]} metricLabel="Tasking workspace summary" />
    <ControlPageBody compact>
      <section className="tasking-scope" aria-label="Tasking scope controls">
        <label className="tasking-search"><Search size={15} aria-hidden="true" /><span className="sr-only">Search Tasking</span><input value={query} onChange={(event) => setQuery(event.target.value)} onBlur={() => updateTaskingRoute({ taskingQuery: query })} onKeyDown={(event) => { if (event.key === "Enter") updateTaskingRoute({ taskingQuery: query }); }} placeholder="Search work, source names, paths, and context…" /></label>
        {routed.view === "files" ? <>
          <ControlSelect compact ariaLabel="File type" value={activeFileType} options={[["all", "All file types"], ...fileAnalytics.types.map((type) => [type.id, type.label])]} onChange={(value) => commitFileFilter("taskingFileType", value)} />
          <ControlSelect compact ariaLabel="Task relation" value={fileRelation} options={[["all", "All task relations"], ["task", "Related to tasks"], ["workspace", "Workspace linked"], ["unlinked", "Unlinked"]]} onChange={(value) => commitFileFilter("taskingFileRelation", value)} />
        </> : <>
          <ControlSelect compact ariaLabel="Workstream" value={workstreamId} options={[["all", "All workstreams"], ...workspace.workstreams.map((item) => [item.id, item.name])]} onChange={(value) => commitFilter("taskingWorkstream", value, setWorkstreamId)} />
          <ControlSelect compact ariaLabel="Status" value={status} options={[["all", "All states"], ...TASKING_TASK_STATUSES.map((value) => [value, taskStatusLabel(value)])]} onChange={(value) => commitFilter("taskingStatus", value, setStatus)} />
        </>}
        <span className="tasking-scope__result"><ListFilter size={14} />{routed.view === "files" ? `${filteredFiles.length} of ${fileAnalytics.totalFiles} files` : `${filteredAnchors.length} anchors · ${filteredTasks.length} tasks`}</span>
      </section>
      <div className="tasking-schema-rule"><strong>Projection:</strong><span>Workstream</span><ChevronRight size={12} /><span>Pursuit, Account, File, or Goal anchor</span><ChevronRight size={12} /><span>Task</span><small>Connections add context without duplicating work.</small></div>
      <div className="tasking-layout">
        <FolderTree folders={folderRoots} selectedId={selectedFolderId} itemCount={workspace.sourceItems.length} onSelect={(node) => selectRecord(node, node.kind === "file" ? "files" : routed.view)} />
        <main className="tasking-primary">
          {routed.view === "portfolio" ? <PortfolioView workstreams={filteredWorkstreams} anchors={filteredAnchors} tasks={filteredTasks} selectedId={selected?.id} onSelect={selectRecord} /> : null}
          {routed.view === "files" ? <Suspense fallback={<div className="tasking-empty"><FileText size={20} /><strong>Loading file intelligence</strong></div>}><TaskingFileView analytics={fileAnalytics} files={filteredFiles} selectedId={selectedFolderId} fileType={activeFileType} fileSort={fileSort} onFilter={commitFileFilter} onSelect={(node) => selectRecord(node, "files")} /></Suspense> : null}
          {routed.view === "connections" ? <ConnectionsView records={records} relationships={workspace.relationships} selectedId={selected?.id} onSelect={(id) => selectRecord(id, "connections")} /> : null}
          {!filteredAnchors.length && routed.view === "portfolio" ? <div className="tasking-empty"><AlertTriangle size={20} /><strong>No work matches this scope</strong><span>Clear search or filters to restore the portfolio.</span></div> : null}
        </main>
        <ContextPanel record={selected} anchor={selectedAnchor} folder={selectedFolder} relatedRecords={relatedRecords} relationshipRows={selectedRelationships} workstreams={workspace.workstreams} onSelect={selectRecord} taskState={taskState} />
      </div>
      <footer className="tasking-boundary"><CheckCircle2 size={15} /><span><strong>Persistence boundary</strong> Tasking state is workspace-scoped and versioned. Codex reads the local source tree; this workspace stores only normalized metadata and reviewed tasking.</span>{selected ? <a href={recordHref(selected.id, "connections")}>Inspect connections <ArrowRight size={13} /></a> : null}</footer>
    </ControlPageBody>
  </section>;
}
