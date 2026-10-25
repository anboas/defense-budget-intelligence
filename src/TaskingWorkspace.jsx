import { useMemo, useState } from "react";
import {
  AlertTriangle, ArrowRight, CheckCircle2, ChevronDown, ChevronRight, CircleDot,
  File, FileText, Folder, FolderOpen, GitBranch, Link2, ListFilter, RotateCcw, Save, Search, Sparkles,
} from "lucide-react";
import { ControlPageBody, ControlStatusBadge } from "control-surface-ui/react";
import ControlSelect from "./ControlSelect.jsx";
import SemanticStatusBadge from "./SemanticStatusBadge.jsx";
import ControlWorkbenchHeader from "./WorkbenchHeader.jsx";
import { flattenTaskingFolders } from "./tasking-foundation-data.js";
import { TASKING_TASK_STATUSES } from "./tasking-model.js";
import { useTaskingTasks } from "./use-tasking-tasks.js";
import "./TaskingWorkspace.css";

const VIEW_IDS = new Set(["portfolio", "files", "connections"]);
const OPEN_STATUSES = new Set(["ready", "in-progress", "waiting", "review"]);

function routeState(routeHash = "") {
  const params = new URLSearchParams(String(routeHash).split("?")[1] || "");
  const requestedView = params.get("taskingView") || "portfolio";
  return {
    view: VIEW_IDS.has(requestedView) ? requestedView : "portfolio",
    recordId: params.get("taskingRecord") || "anchor-pursuit",
    query: params.get("taskingQuery") || "",
    workstreamId: params.get("taskingWorkstream") || "all",
    status: params.get("taskingStatus") || "all",
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

function statusTone(status) {
  if (["waiting", "changed"].includes(status)) return "warning";
  if (status === "review") return "review";
  if (["in-progress", "active"].includes(status)) return "active";
  if (["current", "ready", "indexed", "parsed"].includes(status)) return "verified";
  return "neutral";
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

function FolderTree({ folders, selectedId, onSelect }) {
  return <section className="tasking-folder-panel" aria-labelledby="tasking-folder-title">
    <header><div><span>Source structure</span><h3 id="tasking-folder-title">Business homes</h3></div><ControlStatusBadge status="verified" label="Read only" /></header>
    <ul className="tasking-tree">{folders.map((node) => <FolderTreeNode key={node.id} node={node} selectedId={selectedId} onSelect={onSelect} />)}</ul>
    <footer><strong>Folder hierarchy and work context stay separate.</strong><span>Originals are never moved to match Tasking classifications.</span></footer>
  </section>;
}

function oneDriveTree(sourceItems = []) {
  if (!sourceItems.length) return [];
  const nodes = new Map(sourceItems.map((item) => [item.sourceId, {
    id: item.id, name: item.name, path: item.path, kind: item.itemType, status: item.status,
    parseStatus: item.parseStatus, recordId: item.recordId, summary: item.summary, children: [],
  }]));
  const roots = [];
  for (const item of sourceItems) {
    const node = nodes.get(item.sourceId);
    const parent = nodes.get(item.parentSourceId);
    if (parent && parent !== node) parent.children.push(node); else roots.push(node);
  }
  return [{ id: "source-onedrive-root", name: "OneDrive", path: "OneDrive", kind: "folder", status: "indexed", children: roots }];
}

function TaskRow({ task, selected, onSelect }) {
  return <button type="button" className={`tasking-task-row${selected ? " is-selected" : ""}`} onClick={() => onSelect(task.id)}>
    <span className="tasking-task-row__status" data-status={task.status} aria-hidden="true" />
    <span><strong>{task.title}</strong><small>{task.owner} · {task.evidenceCount} evidence{task.dependencyCount ? ` · ${task.dependencyCount} wait` : ""}</small></span>
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
    <div className="tasking-anchor-card__outcome"><span>Outcome</span><p>{anchor.outcome}</p></div>
    <div className="tasking-anchor-card__move"><span>Next accepted move</span><strong>{anchor.nextMove}</strong><small>{anchor.dueLabel}</small></div>
    <div className="tasking-anchor-card__tasks">{tasks.map((task) => <TaskRow key={task.id} task={task} selected={selectedId === task.id} onSelect={onSelect} />)}</div>
    <footer><span><Link2 size={12} />{anchor.connectionIds.length} connected records</span><span>{anchor.updatedLabel}</span></footer>
  </article>;
}

function PortfolioView({ workstreams, anchors, tasks, selectedId, onSelect }) {
  return <section className="tasking-lanes" aria-label="Workstream portfolio">
    {workstreams.map((workstream) => {
      const laneAnchors = anchors.filter((anchor) => anchor.workstreamId === workstream.id);
      const laneTasks = tasks.filter((task) => laneAnchors.some((anchor) => anchor.id === task.anchorId));
      return <section key={workstream.id} className="tasking-lane" data-tone={workstream.tone}>
        <header className="tasking-lane__identity"><small>Workstream</small><h3>{workstream.name}</h3><p>{workstream.description}</p><strong>{laneAnchors.length} anchor · {laneTasks.length} open tasks</strong></header>
        <div className="tasking-lane__anchors">{laneAnchors.map((anchor) => <AnchorCard key={anchor.id} anchor={anchor} tasks={tasks.filter((task) => task.anchorId === anchor.id)} selectedId={selectedId} onSelect={onSelect} />)}</div>
      </section>;
    })}
  </section>;
}

function FileView({ flatFolders, selectedId, onSelect }) {
  return <section className="tasking-file-intelligence" aria-labelledby="tasking-file-intelligence-title">
    <header><div><span>Indexed source view</span><h3 id="tasking-file-intelligence-title">Folder structure and file intelligence</h3><p>Location, derived context, availability, and linked work remain independently labeled.</p></div><strong>{flatFolders.filter((entry) => entry.kind === "file").length} files</strong></header>
    <div className="tasking-file-table" role="table" aria-label="Indexed folders and files">
      <div className="tasking-file-table__head" role="row"><span role="columnheader">Name</span><span role="columnheader">Context</span><span role="columnheader">Parse</span><span role="columnheader">Source state</span></div>
      {flatFolders.map((entry) => <button key={entry.id} type="button" role="row" className={selectedId === entry.id ? "is-selected" : ""} onClick={() => onSelect(entry)}>
        <span role="cell" style={{ "--tasking-file-depth": entry.depth }}>{entry.kind === "folder" ? <Folder size={15} /> : <FileText size={15} />}<span><strong>{entry.name}</strong><small>{entry.path}</small></span></span>
        <span role="cell">{entry.recordId ? "Linked work" : entry.kind === "folder" ? "Source structure" : "Unlinked"}</span>
        <span role="cell">{entry.parseStatus || (entry.kind === "folder" ? "Not applicable" : "Not requested")}</span>
        <span role="cell"><ControlStatusBadge status={statusTone(entry.status || "current")} label={(entry.status || "current").replaceAll("-", " ")} /></span>
      </button>)}
    </div>
  </section>;
}

const GRAPH_POSITIONS = {
  "anchor-account": "left-top", "decision-position": "left-bottom", "anchor-pursuit": "center",
  "anchor-file": "right-top", "anchor-goal": "right-bottom", "evidence-customer": "far-right",
};

function ConnectionsView({ records, relationships, selectedId, onSelect }) {
  const visibleIds = new Set(relationships.flatMap((relationship) => [relationship.fromId, relationship.toId]));
  const nodes = records.filter((record) => visibleIds.has(record.id));
  return <section className="tasking-connections" aria-labelledby="tasking-connections-title">
    <header><div><span>Typed relationship view</span><h3 id="tasking-connections-title">Connected work</h3><p>Confirmed links are solid. Suggested links remain dashed until human review.</p></div><span className="tasking-connections__legend"><i />Confirmed <i className="is-suggested" />Suggested</span></header>
    <div className="tasking-graph" role="img" aria-label="Relationship map linking account, pursuit, file, goal, decision, and evidence records">
      <svg viewBox="0 0 1000 520" preserveAspectRatio="none" aria-hidden="true">
        <path d="M220 120 C350 120 360 250 490 250" />
        <path d="M220 400 C350 400 360 270 490 270" />
        <path d="M510 250 C640 250 650 120 780 120" />
        <path className="is-suggested" d="M510 270 C640 270 650 400 780 400" />
        <path className="is-suggested" d="M790 120 C850 120 860 250 920 250" />
      </svg>
      {nodes.map((record) => <button key={record.id} type="button" className={`tasking-graph__node is-${GRAPH_POSITIONS[record.id] || "center"}${selectedId === record.id ? " is-selected" : ""}`} onClick={() => onSelect(record.id)}>
        <small>{record.kind}</small><strong>{record.title}</strong><span>{record.status?.replaceAll("-", " ") || "Context"}</span>
      </button>)}
    </div>
    <div className="tasking-relationship-list" role="list" aria-label="Relationship list alternative">{relationships.map((relationship) => {
      const from = records.find((record) => record.id === relationship.fromId);
      const to = records.find((record) => record.id === relationship.toId);
      return <article key={relationship.id} role="listitem"><span><strong>{from?.title}</strong><small>{from?.kind}</small></span><span className={relationship.status === "suggested" ? "is-suggested" : ""}><GitBranch size={14} />{relationship.type}<small>{relationship.status}</small></span><span><strong>{to?.title}</strong><small>{to?.kind}</small></span></article>;
    })}</div>
  </section>;
}

function TaskEditor({ task, canWrite, saving, notice, onSave, onReset }) {
  const [draft, setDraft] = useState(() => ({ status: task.status, owner: task.owner, acceptance: task.acceptance }));
  return <form className="tasking-task-editor" data-tasking-task-editor onSubmit={(event) => { event.preventDefault(); void onSave(task.id, draft).catch(() => {}); }}>
    <header><h4>Task state <span>{task.persisted ? `Version ${task.version}` : "Foundation value"}</span></h4>{task.persisted ? <ControlStatusBadge status="verified" label="Persisted" /> : null}</header>
    <label><span>Status</span><span data-tasking-status-control><ControlSelect compact ariaLabel="Task status" value={draft.status} options={TASKING_TASK_STATUSES.map((value) => [value, value.replaceAll("-", " ").replace(/\b\w/g, (letter) => letter.toUpperCase())])} onChange={(value) => setDraft((current) => ({ ...current, status: value }))} disabled={!canWrite || saving} /></span></label>
    <label><span>Owner</span><input className="if-input" data-tasking-owner-input value={draft.owner} maxLength={100} disabled={!canWrite || saving} onChange={(event) => setDraft((current) => ({ ...current, owner: event.target.value }))} /></label>
    <label><span>Acceptance</span><textarea className="if-input" value={draft.acceptance} maxLength={500} rows={3} disabled={!canWrite || saving} onChange={(event) => setDraft((current) => ({ ...current, acceptance: event.target.value }))} /></label>
    <div className="tasking-task-editor__actions"><button className="if-btn if-btn--primary if-btn--sm" type="submit" disabled={!canWrite || saving || !draft.owner.trim() || !draft.acceptance.trim()}><Save size={14} />{saving ? "Saving…" : "Save task"}</button>{task.persisted ? <button className="if-btn if-btn--ghost if-btn--sm" type="button" disabled={!canWrite || saving} onClick={() => void onReset(task.id).catch(() => {})}><RotateCcw size={14} />{task.foundation === false ? "Remove" : "Reset"}</button> : null}</div>
    {notice ? <p className="if-field__hint" role="status">{notice}</p> : null}
    {!canWrite ? <p className="if-field__hint">Workspace write access is required to change task state.</p> : null}
  </form>;
}

function ContextPanel({ record, anchor, folder, relatedRecords, relationshipRows, workstreams, onSelect, taskState }) {
  if (!record) return <aside className="tasking-context"><p>No record selected.</p></aside>;
  const task = record.kind === "Task" ? record : null;
  return <aside className="tasking-context" aria-labelledby="tasking-context-title">
    <header><span>Selected {record.kind}</span><h3 id="tasking-context-title">{record.title || record.name}</h3><SemanticStatusBadge category="workflow" value={record.status || "ready"} /></header>
    <section className="tasking-context__summary"><h4>What matters</h4><p>{record.description || record.outcome || record.summary || "Folder context is available without changing the source structure."}</p></section>
    <dl className="tasking-context__facts">
      <div><dt>Primary placement</dt><dd>{anchor ? workstreams.find((workstream) => workstream.id === anchor.workstreamId)?.name : "Source structure"}</dd></div>
      <div><dt>Business home</dt><dd>{folder?.path || "Not linked"}</dd></div>
      <div><dt>Source state</dt><dd>{anchor?.sourceState || record.status || "Observed"}</dd></div>
      <div><dt>Acceptance</dt><dd>{task?.acceptance || "Record-specific review"}</dd></div>
    </dl>
    {anchor ? <section className="tasking-context__next"><span>Next accepted move</span><strong>{anchor.nextMove}</strong><small>{anchor.dueLabel}</small></section> : null}
    {task ? <TaskEditor key={`${task.id}:${task.version}`} task={task} canWrite={taskState.canWrite} saving={taskState.savingTaskId === task.id} notice={taskState.notice} onSave={taskState.saveTask} onReset={taskState.resetTask} /> : null}
    <section className="tasking-context__links"><header><h4>Connected context</h4><span>{relatedRecords.length}</span></header>{relatedRecords.map((related) => <button key={related.id} type="button" onClick={() => onSelect(related.id)}><span><strong>{related.title || related.name}</strong><small>{related.kind}</small></span><ArrowRight size={14} /></button>)}</section>
    {relationshipRows.length ? <section className="tasking-context__basis"><h4>Relationship basis</h4>{relationshipRows.map((relationship) => <p key={relationship.id}><span className={relationship.status === "suggested" ? "is-suggested" : ""}>{relationship.status}</span>{relationship.type} · {relationship.basis}</p>)}</section> : null}
    <footer><CircleDot size={14} /><span><strong>{task?.persisted ? taskState.persistenceLabel : "Synthetic foundation"}</strong>{taskState.workspace.sourceItems?.length ? "Codex-synchronized source metadata is available; OneDrive credentials remain outside this application." : task?.persisted ? "This task state is scoped to the active workspace." : "No live source connected. Demo state cannot be mistaken for business fact."}</span></footer>
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
  const sourceFolders = useMemo(() => oneDriveTree(workspace.sourceItems), [workspace.sourceItems]);
  const folderRoots = useMemo(() => [...workspace.folders, ...sourceFolders], [sourceFolders, workspace.folders]);
  const flatFolders = useMemo(() => flattenTaskingFolders(folderRoots), [folderRoots]);
  const records = useMemo(() => [...workspace.anchors, ...tasks, ...workspace.contextRecords, ...flatFolders.map((entry) => ({ ...entry, title: entry.name, kind: entry.kind === "folder" ? "Folder" : "File" }))], [flatFolders, tasks, workspace.anchors, workspace.contextRecords]);
  const selected = records.find((record) => record.id === routed.recordId) || workspace.anchors[0];
  const selectedAnchor = selected.kind === "Task" ? workspace.anchors.find((anchor) => anchor.id === selected.anchorId) : workspace.anchors.find((anchor) => anchor.id === selected.id || anchor.folderId === selected.id);
  const selectedFolder = selected.kind === "Folder" || selected.kind === "File" ? selected : flatFolders.find((entry) => entry.id === selectedAnchor?.folderId);
  const selectedFolderId = selected.kind === "Folder" || selected.kind === "File" ? selected.id : selectedFolder?.id;
  const selectedRelationships = workspace.relationships.filter((relationship) => [relationship.fromId, relationship.toId].includes(selected.id) || (selectedAnchor && [relationship.fromId, relationship.toId].includes(selectedAnchor.id)));
  const relatedIds = new Set([
    ...(selectedAnchor?.connectionIds || []),
    ...selectedRelationships.flatMap((relationship) => [relationship.fromId, relationship.toId]),
  ]);
  relatedIds.delete(selected.id);
  relatedIds.delete(selectedAnchor?.id);
  const relatedRecords = records.filter((record) => relatedIds.has(record.id)).slice(0, 6);
  const normalizedQuery = query.trim().toLowerCase();
  const filteredAnchors = workspace.anchors.filter((anchor) => {
    const anchorTasks = tasks.filter((task) => task.anchorId === anchor.id);
    const matchesQuery = !normalizedQuery || [anchor.title, anchor.outcome, anchor.nextMove, ...anchorTasks.flatMap((task) => [task.title, task.description])].some((value) => String(value).toLowerCase().includes(normalizedQuery));
    const matchesWorkstream = workstreamId === "all" || anchor.workstreamId === workstreamId;
    const matchesStatus = status === "all" || anchor.status === status || anchorTasks.some((task) => task.status === status);
    return matchesQuery && matchesWorkstream && matchesStatus;
  });
  const visibleAnchorIds = new Set(filteredAnchors.map((anchor) => anchor.id));
  const filteredWorkstreams = workspace.workstreams.filter((workstream) => (workstream.anchors || []).some((anchorId) => visibleAnchorIds.has(anchorId)));
  const filteredTasks = tasks.filter((task) => visibleAnchorIds.has(task.anchorId));
  const waiting = tasks.filter((task) => task.status === "waiting").length;
  const review = tasks.filter((task) => task.status === "review").length;

  function selectRecord(recordOrId, preferredView = routed.view) {
    const record = typeof recordOrId === "string" ? records.find((item) => item.id === recordOrId) : recordOrId;
    const recordId = record?.recordId || record?.id || recordOrId;
    updateTaskingRoute({ taskingView: preferredView, taskingRecord: recordId });
  }

  function commitFilter(key, value, setter) {
    setter(value);
    updateTaskingRoute({ [key]: value, taskingRecord: routed.recordId });
  }

  const headerMeta = <span className="tasking-foundation-state"><Sparkles size={14} /><strong>{taskState.persistenceLabel}</strong><span>{workspace.sourceItems?.length ? `${workspace.sourceItems.length} normalized OneDrive items from Codex.` : "Task changes persist; file evidence remains illustrative."}</span></span>;
  return <section className="tasking-workspace" data-tasking-workspace data-tasking-view={routed.view}>
    <ControlWorkbenchHeader eyebrow="Workspace work" title="Tasking" summary="See where work lives, how it clusters into workstreams, what is connected, and what needs movement next." meta={headerMeta} metrics={[
      { id: "workstreams", label: "Workstreams", value: workspace.workstreams.length, meta: "One primary placement per task" },
      { id: "active", label: "Open work", value: tasks.filter((task) => OPEN_STATUSES.has(task.status)).length, meta: "Across real anchor types", tone: "info" },
      { id: "waiting", label: "Waiting", value: waiting, meta: "Named dependencies", tone: waiting ? "warning" : "success" },
      { id: "review", label: "In review", value: review, meta: "Human acceptance remains explicit", tone: review ? "warning" : "success" },
      { id: "relationships", label: "Relationships", value: workspace.relationships.length, meta: `${workspace.relationships.filter((item) => item.status === "suggested").length} suggested` },
    ]} metricLabel="Tasking foundation summary" />
    <ControlPageBody compact>
      <section className="tasking-scope" aria-label="Tasking scope controls">
        <label className="tasking-search"><Search size={15} aria-hidden="true" /><span className="sr-only">Search Tasking</span><input value={query} onChange={(event) => setQuery(event.target.value)} onBlur={() => updateTaskingRoute({ taskingQuery: query })} onKeyDown={(event) => { if (event.key === "Enter") updateTaskingRoute({ taskingQuery: query }); }} placeholder="Search anchors, tasks, outcomes, and context…" /></label>
        <ControlSelect compact ariaLabel="Workstream" value={workstreamId} options={[["all", "All workstreams"], ...workspace.workstreams.map((item) => [item.id, item.name])]} onChange={(value) => commitFilter("taskingWorkstream", value, setWorkstreamId)} />
        <ControlSelect compact ariaLabel="Status" value={status} options={[["all", "All states"], ["ready", "Ready"], ["in-progress", "In progress"], ["waiting", "Waiting"], ["review", "In review"], ["blocked", "Blocked"], ["completed", "Complete"]]} onChange={(value) => commitFilter("taskingStatus", value, setStatus)} />
        <span className="tasking-scope__result"><ListFilter size={14} />{filteredAnchors.length} anchors · {filteredTasks.length} tasks</span>
      </section>
      <div className="tasking-schema-rule"><strong>Projection:</strong><span>Workstream</span><ChevronRight size={12} /><span>Pursuit, Account, File, or Goal anchor</span><ChevronRight size={12} /><span>Task</span><small>Connections add context without duplicating work.</small></div>
      <div className="tasking-layout">
        <FolderTree folders={folderRoots} selectedId={selectedFolderId} onSelect={(node) => selectRecord(node, node.kind === "file" ? "files" : routed.view)} />
        <main className="tasking-primary">
          {routed.view === "portfolio" ? <PortfolioView workstreams={filteredWorkstreams} anchors={filteredAnchors} tasks={filteredTasks} selectedId={selected.id} onSelect={selectRecord} /> : null}
          {routed.view === "files" ? <FileView flatFolders={flatFolders} selectedId={selectedFolderId} onSelect={(node) => selectRecord(node, "files")} /> : null}
          {routed.view === "connections" ? <ConnectionsView records={records} relationships={workspace.relationships} selectedId={selected.id} onSelect={(id) => selectRecord(id, "connections")} /> : null}
          {!filteredAnchors.length && routed.view === "portfolio" ? <div className="tasking-empty"><AlertTriangle size={20} /><strong>No work matches this scope</strong><span>Clear search or filters to restore the portfolio.</span></div> : null}
        </main>
        <ContextPanel record={selected} anchor={selectedAnchor} folder={selectedFolder} relatedRecords={relatedRecords} relationshipRows={selectedRelationships} workstreams={workspace.workstreams} onSelect={selectRecord} taskState={taskState} />
      </div>
      <footer className="tasking-boundary"><CheckCircle2 size={15} /><span><strong>Persistence boundary</strong> Tasking state is workspace-scoped and versioned. Codex owns OneDrive access; this workspace stores only normalized source metadata.</span><a href={recordHref(selected.id, "connections")}>Inspect connections <ArrowRight size={13} /></a></footer>
    </ControlPageBody>
  </section>;
}
