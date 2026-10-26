import { lazy, Suspense, useMemo, useState } from "react";
import {
  ArrowRight,
  CheckCircle2,
  CircleDot,
  FileText,
  GitBranch,
  Inbox,
  LayoutList,
  Mail,
  MessageCircle,
  Plus,
  Search,
  Send,
  Target,
  Users,
} from "lucide-react";
import { ControlPageBody } from "control-surface-ui/react";
import SemanticStatusBadge from "./SemanticStatusBadge.jsx";
import ControlSelect from "./ControlSelect.jsx";
import ControlWorkbenchHeader from "./WorkbenchHeader.jsx";
import {
  buildTaskingFileAnalytics,
  formatTaskingBytes,
  formatTaskingDate,
} from "./tasking-file-analytics.js";
import {
  TASKING_TASK_STATUSES,
  taskingTaskOwnerRequired,
} from "./tasking-model.js";
import { useTaskingTasks } from "./use-tasking-tasks.js";
import {
  communicationsForWorkstream,
  isCommunication,
  replaceTaskingRoute,
  sourceIdsForWorkstream,
  taskingRouteState,
  workstreamCategory,
  workstreamShortName,
  workstreamState,
} from "./tasking-workspace-support.js";
import "./TaskingWorkspace.css";

const TaskingSourceExplorer = lazy(() => import("./TaskingSourceExplorer.jsx"));
const OPEN_STATUSES = new Set([
  "draft",
  "ready",
  "in-progress",
  "waiting",
  "review",
]);

function label(value = "") {
  if (value === "review") return "In review";
  if (value === "completed") return "Complete";
  return String(value)
    .replaceAll("-", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function EmptyState({ icon: Icon = Inbox, title, copy, action }) {
  return (
    <div className="tasking-empty-state">
      <span>
        <Icon size={21} />
      </span>
      <h3>{title}</h3>
      <p>{copy}</p>
      {action}
    </div>
  );
}

function WorkstreamPill({ workstream, anchors = [] }) {
  return (
    <span className="tasking-workstream-pill" title={workstream.name}>
      <strong>{workstream.shortName}</strong>
      <small>{label(workstreamState(workstream, anchors))}</small>
    </span>
  );
}

function WorkstreamRail({
  workstreams,
  anchors,
  tasks,
  communications,
  sourceItems,
  selectedId,
  onSelect,
}) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("recent");
  const visible = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return workstreams
      .filter(
        (item) =>
          !normalized ||
          `${item.name} ${item.description} ${item.shortName} ${item.category}`
            .toLowerCase()
            .includes(normalized),
      )
      .sort((a, b) =>
        sort === "name"
          ? a.name.localeCompare(b.name)
          : sort === "tasks"
            ? tasks.filter(
                (task) =>
                  task.workstreamId === b.id && OPEN_STATUSES.has(task.status),
              ).length -
              tasks.filter(
                (task) =>
                  task.workstreamId === a.id && OPEN_STATUSES.has(task.status),
              ).length
            : String(b.updatedAt || "").localeCompare(
                String(a.updatedAt || ""),
              ),
      );
  }, [query, sort, tasks, workstreams]);
  return (
    <aside className="tasking-workstream-rail" aria-label="Workstreams">
      <header>
        <span>Primary operating units</span>
        <h2>Workstreams</h2>
        <label className="tasking-rail-search">
          <Search size={14} />
          <span className="sr-only">Search workstreams</span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search workstreams…"
          />
        </label>
        <ControlSelect
          compact
          ariaLabel="Sort workstreams"
          value={sort}
          options={[
            ["recent", "Recent activity"],
            ["name", "Name"],
            ["tasks", "Open tasks"],
          ]}
          onChange={setSort}
        />
      </header>
      <div className="tasking-workstream-list">
        {visible.map((stream) => {
          const streamAnchors = anchors.filter(
            (anchor) => anchor.workstreamId === stream.id,
          );
          const anchorIds = new Set(streamAnchors.map((anchor) => anchor.id));
          const streamTasks = tasks.filter((task) =>
            anchorIds.has(task.anchorId),
          );
          const streamSources = sourceItems.filter(
            (item) => anchorIds.has(item.recordId) && item.itemType === "file",
          );
          const streamComms = communicationsForWorkstream(
            communications,
            stream.id,
            anchorIds,
          );
          return (
            <button
              type="button"
              key={stream.id}
              className="tasking-workstream-item"
              aria-current={selectedId === stream.id ? "true" : undefined}
              onClick={() => onSelect(stream.id)}
            >
              <i data-tone={stream.tone || "blue"} />
              <span>
                <span className="tasking-workstream-item__top">
                  <strong>{stream.shortName}</strong>
                  <small>{label(workstreamState(stream, streamAnchors))}</small>
                </span>
                <b>{stream.name}</b>
                <em>{stream.category}</em>
                <span className="tasking-workstream-item__counts">
                  <small>
                    {
                      streamTasks.filter((task) =>
                        OPEN_STATUSES.has(task.status),
                      ).length
                    }{" "}
                    open
                  </small>
                  <small>{streamSources.length} files</small>
                  <small>{streamComms.length} messages</small>
                </span>
              </span>
            </button>
          );
        })}
      </div>
      {!visible.length ? (
        <p className="tasking-rail-empty">No workstreams match this search.</p>
      ) : null}
    </aside>
  );
}

function TaskRow({ task, selected, onSelect }) {
  return (
    <button
      type="button"
      className={`tasking-task-row${selected ? " is-selected" : ""}`}
      onClick={() => onSelect(task.id)}
    >
      <span className="tasking-task-row__status" data-status={task.status} />
      <span>
        <strong>{task.title}</strong>
        <small>
          {task.owner || "No owner"} ·{" "}
          {task.acceptance ? "Acceptance recorded" : "Acceptance missing"}
        </small>
      </span>
      <SemanticStatusBadge category="workflow" value={task.status} />
    </button>
  );
}

function TaskComposer({ anchors, canWrite, onCreate, onCancel }) {
  const [draft, setDraft] = useState({
    title: "",
    description: "",
    acceptance: "",
    owner: "",
    anchorId: anchors[0]?.id || "",
    status: "draft",
  });
  const [error, setError] = useState("");
  const ready =
    draft.title.trim() &&
    draft.description.trim() &&
    draft.acceptance.trim() &&
    draft.anchorId &&
    (!taskingTaskOwnerRequired(draft.status) || draft.owner.trim());
  return (
    <form
      className="tasking-task-composer"
      data-tasking-task-composer
      onSubmit={(event) => {
        event.preventDefault();
        setError("");
        void onCreate(draft).catch((caught) => setError(caught.message));
      }}
    >
      <header>
        <div>
          <span>New workspace task</span>
          <h3>Create task</h3>
        </div>
        <button
          type="button"
          className="if-btn if-btn--ghost if-btn--sm"
          onClick={onCancel}
        >
          Cancel
        </button>
      </header>
      <label>
        <span>Title</span>
        <input
          className="if-input"
          value={draft.title}
          maxLength={160}
          onChange={(event) =>
            setDraft({ ...draft, title: event.target.value })
          }
        />
      </label>
      <label>
        <span>Anchor</span>
        <ControlSelect
          ariaLabel="Task anchor"
          value={draft.anchorId}
          options={anchors.map((anchor) => [
            anchor.id,
            `${anchor.kind}: ${anchor.title}`,
          ])}
          onChange={(anchorId) => setDraft({ ...draft, anchorId })}
        />
      </label>
      <label>
        <span>Description</span>
        <textarea
          className="if-input"
          rows={3}
          maxLength={1200}
          value={draft.description}
          onChange={(event) =>
            setDraft({ ...draft, description: event.target.value })
          }
        />
      </label>
      <label>
        <span>Acceptance conditions</span>
        <textarea
          className="if-input"
          rows={3}
          maxLength={500}
          value={draft.acceptance}
          onChange={(event) =>
            setDraft({ ...draft, acceptance: event.target.value })
          }
        />
      </label>
      <label>
        <span>
          Owner <small>optional for drafts</small>
        </span>
        <input
          className="if-input"
          maxLength={100}
          value={draft.owner}
          onChange={(event) =>
            setDraft({ ...draft, owner: event.target.value })
          }
          placeholder="Leave blank until confirmed"
        />
      </label>
      <footer>
        <button
          type="submit"
          className="if-btn if-btn--primary if-btn--sm"
          disabled={!canWrite || !ready}
        >
          <Plus size={14} />
          Create draft
        </button>
        {error ? <p role="alert">{error}</p> : null}
      </footer>
    </form>
  );
}

function TasksView({
  tasks,
  anchors,
  selectedId,
  onSelect,
  onCreate,
  canWrite,
}) {
  const [composing, setComposing] = useState(false);
  const open = tasks.filter((task) => OPEN_STATUSES.has(task.status));
  const done = tasks.filter((task) => !OPEN_STATUSES.has(task.status));
  if (composing)
    return (
      <TaskComposer
        anchors={anchors}
        canWrite={canWrite}
        onCancel={() => setComposing(false)}
        onCreate={async (values) => {
          const created = await onCreate(values);
          setComposing(false);
          onSelect(created.id);
        }}
      />
    );
  return (
    <section className="tasking-task-surface" data-tasking-task-surface>
      <header>
        <div>
          <h3>Tasking</h3>
          <p>
            Open and finished work stay visible with evidence and acceptance
            conditions.
          </p>
        </div>
        <button
          type="button"
          className="if-btn if-btn--primary if-btn--sm"
          disabled={!canWrite || !anchors.length}
          onClick={() => setComposing(true)}
        >
          <Plus size={14} />
          Create task
        </button>
      </header>
      <div className="tasking-task-columns">
        <section>
          <header>
            <strong>Open work</strong>
            <span>{open.length}</span>
          </header>
          {open.length ? (
            open.map((task) => (
              <TaskRow
                key={task.id}
                task={task}
                selected={selectedId === task.id}
                onSelect={onSelect}
              />
            ))
          ) : (
            <EmptyState
              icon={Target}
              title="No open tasks"
              copy="Create a draft without inventing an owner or date, then promote it when accountability is confirmed."
              action={
                <button
                  type="button"
                  className="if-btn if-btn--primary if-btn--sm"
                  disabled={!canWrite || !anchors.length}
                  onClick={() => setComposing(true)}
                >
                  Create first task
                </button>
              }
            />
          )}
        </section>
        <section>
          <header>
            <strong>Finished work</strong>
            <span>{done.length}</span>
          </header>
          {done.length ? (
            done.map((task) => (
              <TaskRow
                key={task.id}
                task={task}
                selected={selectedId === task.id}
                onSelect={onSelect}
              />
            ))
          ) : (
            <EmptyState
              icon={CheckCircle2}
              title="No finished tasks"
              copy="Completed and cancelled work remains visible with its source and communication evidence."
            />
          )}
        </section>
      </div>
    </section>
  );
}

function Overview({
  workstream,
  anchors,
  tasks,
  files,
  communications,
  onSection,
  onSelect,
  canWrite,
}) {
  const open = tasks.filter((task) => OPEN_STATUSES.has(task.status));
  return (
    <section className="tasking-overview" data-tasking-overview>
      <div className="tasking-summary-grid">
        <article>
          <span>State</span>
          <strong>{label(workstreamState(workstream, anchors))}</strong>
          <small>{workstream.category}</small>
        </article>
        <article>
          <span>Open tasks</span>
          <strong>{open.length}</strong>
          <small>{tasks.length - open.length} finished</small>
        </article>
        <article>
          <span>Supporting files</span>
          <strong>{files.length}</strong>
          <small>
            {files.filter((file) => file.recordId).length} reviewed placements
          </small>
        </article>
        <article>
          <span>Communications</span>
          <strong>{communications.length}</strong>
          <small>Email, IM, and meetings</small>
        </article>
      </div>
      <section className="tasking-section">
        <header>
          <div>
            <h3>Work to move</h3>
            <p>Tasking lives in the workstream, not behind a selected file.</p>
          </div>
          <button
            type="button"
            className="if-btn if-btn--ghost if-btn--sm"
            onClick={() => onSection("tasks")}
          >
            Open tasks <ArrowRight size={13} />
          </button>
        </header>
        {open.length ? (
          <div className="tasking-overview-tasks">
            {open.slice(0, 5).map((task) => (
              <TaskRow key={task.id} task={task} onSelect={onSelect} />
            ))}
          </div>
        ) : (
          <EmptyState
            icon={Target}
            title="No tasks in this workstream yet"
            copy="Create a reviewed draft here. Blank owners and unconfirmed dates stay blank."
            action={
              <button
                type="button"
                className="if-btn if-btn--primary if-btn--sm"
                disabled={!canWrite || !anchors.length}
                onClick={() => onSection("tasks")}
              >
                <Plus size={14} />
                Create first task
              </button>
            }
          />
        )}
      </section>
      <section className="tasking-section">
        <header>
          <div>
            <h3>Supporting sources</h3>
            <p>
              A bounded preview. The full hierarchy stays collapsed until you
              open it.
            </p>
          </div>
          <button
            type="button"
            className="if-btn if-btn--ghost if-btn--sm"
            onClick={() => onSection("sources")}
          >
            Browse sources <ArrowRight size={13} />
          </button>
        </header>
        {files.length ? (
          <div className="tasking-source-preview">
            {files.slice(0, 6).map((file) => (
              <button
                key={file.id}
                type="button"
                onClick={() => {
                  onSelect(file.id);
                  onSection("sources");
                }}
              >
                <FileText size={17} />
                <span>
                  <strong>{file.name}</strong>
                  <small>
                    {formatTaskingBytes(file.size)} ·{" "}
                    {formatTaskingDate(file.lastModifiedAt)}
                  </small>
                </span>
                <WorkstreamPill workstream={workstream} anchors={anchors} />
              </button>
            ))}
          </div>
        ) : (
          <EmptyState
            icon={FileText}
            title="No files placed here"
            copy="Reviewed file placements appear without moving or modifying source originals."
          />
        )}
      </section>
    </section>
  );
}

function CommunicationsView({ records }) {
  const channels = [
    { id: "email", label: "Email", Icon: Mail },
    { id: "im", label: "IM", Icon: MessageCircle },
    { id: "meeting", label: "Meetings", Icon: Users },
  ];
  return (
    <section className="tasking-communications" data-tasking-communications>
      <div className="tasking-communication-types">
        {channels.map(({ id, label: channelLabel, Icon }) => (
          <article key={id}>
            <Icon size={17} />
            <span>
              <strong>{channelLabel}</strong>
              <small>
                {
                  records.filter((record) =>
                    String(record.channel || record.kind)
                      .toLowerCase()
                      .includes(id),
                  ).length
                }{" "}
                synced
              </small>
            </span>
          </article>
        ))}
      </div>
      {records.length ? (
        <div className="tasking-communication-list">
          {records.map((record) => (
            <article key={record.id}>
              <Mail size={16} />
              <span>
                <strong>{record.title}</strong>
                <small>{record.description || record.summary}</small>
              </span>
              <SemanticStatusBadge
                category="workflow"
                value={record.status || "open"}
              />
            </article>
          ))}
        </div>
      ) : (
        <EmptyState
          icon={Send}
          title="No communications connected yet"
          copy="This workstream owns future email, IM, and meeting records. Synced correspondence will retain participants, time, source system, attachments, and reviewed links to tasks and files. No Microsoft authentication is introduced here."
          action={
            <button
              className="if-btn if-btn--ghost if-btn--sm"
              type="button"
              disabled
            >
              Connector setup coming next
            </button>
          }
        />
      )}
    </section>
  );
}

function InteractionsView({ relationships, records, onSelect, onSources }) {
  return (
    <section className="tasking-interactions" data-tasking-interactions>
      {relationships.length ? (
        relationships.map((relationship) => {
          const from = records.get(relationship.fromId);
          const to = records.get(relationship.toId);
          return (
            <article key={relationship.id}>
              <button type="button" onClick={() => onSelect(from?.id)}>
                <strong>
                  {from?.title || from?.name || relationship.fromId}
                </strong>
                <small>{from?.kind || "Record"}</small>
              </button>
              <span
                className={
                  relationship.status === "suggested" ? "is-suggested" : ""
                }
              >
                <GitBranch size={14} />
                {relationship.type}
                <small>{relationship.status}</small>
              </span>
              <button type="button" onClick={() => onSelect(to?.id)}>
                <strong>{to?.title || to?.name || relationship.toId}</strong>
                <small>{to?.kind || "Record"}</small>
              </button>
              <p>{relationship.basis}</p>
            </article>
          );
        })
      ) : (
        <EmptyState
          icon={GitBranch}
          title="No reviewed interactions yet"
          copy="Interactions show confirmed and suggested links among this workstream's tasks, sources, communications, and context. Nothing is inferred from filenames alone."
          action={
            <button
              type="button"
              className="if-btn if-btn--ghost if-btn--sm"
              onClick={onSources}
            >
              Review supporting sources
            </button>
          }
        />
      )}
    </section>
  );
}

function TaskInspector({ task, taskState }) {
  const [draft, setDraft] = useState({
    status: task.status,
    owner: task.owner || "",
    acceptance: task.acceptance || "",
  });
  const ownerRequired = taskingTaskOwnerRequired(draft.status);
  return (
    <form
      className="tasking-inspector-editor"
      data-tasking-task-editor
      onSubmit={(event) => {
        event.preventDefault();
        void taskState.saveTask(task.id, draft).catch(() => {});
      }}
    >
      <label>
        <span>Status</span>
        <ControlSelect
          ariaLabel="Task status"
          value={draft.status}
          options={TASKING_TASK_STATUSES.map((status) => [
            status,
            label(status),
          ])}
          onChange={(status) => setDraft({ ...draft, status })}
        />
      </label>
      <label>
        <span>Owner{ownerRequired ? "" : " (optional)"}</span>
        <input
          className="if-input"
          data-tasking-owner-input
          value={draft.owner}
          onChange={(event) =>
            setDraft({ ...draft, owner: event.target.value })
          }
        />
      </label>
      <label>
        <span>Acceptance</span>
        <textarea
          className="if-input"
          rows={4}
          value={draft.acceptance}
          onChange={(event) =>
            setDraft({ ...draft, acceptance: event.target.value })
          }
        />
      </label>
      <span className="tasking-inspector-editor__actions">
        <button
          className="if-btn if-btn--primary if-btn--sm"
          type="submit"
          disabled={
            !taskState.canWrite ||
            (ownerRequired && !draft.owner.trim()) ||
            !draft.acceptance.trim()
          }
        >
          Save task
        </button>
        <button
          className="if-btn if-btn--ghost if-btn--sm"
          type="button"
          disabled={!taskState.canWrite}
          onClick={() => void taskState.resetTask(task.id).catch(() => {})}
        >
          Delete task
        </button>
      </span>
    </form>
  );
}

function Inspector({ record, workstream, anchors, taskState, taskIds = [] }) {
  if (!record)
    return (
      <aside className="tasking-inspector">
        <EmptyState
          icon={LayoutList}
          title="Select a record"
          copy="Choose a task, file, communication, or interaction to inspect it without leaving the workstream."
        />
      </aside>
    );
  const file = record.itemType === "file" || record.kind === "File";
  const task = record.kind === "Task";
  return (
    <aside className="tasking-inspector" aria-label="Selected record details">
      <header>
        <span>Selected {file ? "file" : task ? "task" : "record"}</span>
        <h3>{record.title || record.name}</h3>
        <p>
          {record.path ||
            record.description ||
            record.summary ||
            "No description recorded."}
        </p>
      </header>
      <section>
        <h4>Workstream placement</h4>
        {workstream ? (
          <article className="tasking-inspector-placement">
            <WorkstreamPill workstream={workstream} anchors={anchors} />
            <strong>{workstream.name}</strong>
            <small>{workstream.category}</small>
          </article>
        ) : (
          <p>No reviewed workstream placement.</p>
        )}
      </section>
      {file ? (
        <section>
          <h4>File metadata</h4>
          <dl>
            <div>
              <dt>Type</dt>
              <dd>
                {record.mimeType ||
                  record.name?.split(".").pop()?.toUpperCase() ||
                  "Unknown"}
              </dd>
            </div>
            <div>
              <dt>Size</dt>
              <dd>{formatTaskingBytes(record.size)}</dd>
            </div>
            <div>
              <dt>Modified</dt>
              <dd>{formatTaskingDate(record.lastModifiedAt)}</dd>
            </div>
            <div>
              <dt>Review</dt>
              <dd>{record.parseStatus || record.status || "Observed"}</dd>
            </div>
          </dl>
          <p>
            {record.summary ||
              "Read-only source metadata is available without opening or changing the file."}
          </p>
        </section>
      ) : null}
      {file ? (
        <section>
          <h4>Task and communication use</h4>
          <p>
            {taskIds.length
              ? `${taskIds.length} reviewed task relation${taskIds.length === 1 ? "" : "s"}.`
              : "No task or communication uses this file yet. Workstream placement does not imply a task relationship."}
          </p>
        </section>
      ) : null}
      {task ? (
        <section>
          <h4>Task state</h4>
          <TaskInspector
            key={`${record.id}:${record.version}`}
            task={record}
            taskState={taskState}
          />
        </section>
      ) : null}
      <footer>
        <CircleDot size={14} />
        <span>{taskState.persistenceLabel}</span>
      </footer>
    </aside>
  );
}

export default function TaskingWorkspace({ routeHash = "" }) {
  const routed = taskingRouteState(routeHash);
  const taskState = useTaskingTasks();
  const workspace = taskState.workspace;
  const enrichedWorkstreams = useMemo(
    () =>
      workspace.workstreams.map((stream) => {
        const streamAnchors = workspace.anchors.filter(
          (anchor) => anchor.workstreamId === stream.id,
        );
        return {
          ...stream,
          shortName: workstreamShortName(stream),
          category: workstreamCategory(stream, streamAnchors),
        };
      }),
    [workspace.anchors, workspace.workstreams],
  );
  const selectedWorkstream =
    enrichedWorkstreams.find((stream) => stream.id === routed.workstreamId) ||
    enrichedWorkstreams[0] ||
    null;
  const streamAnchors = workspace.anchors.filter(
    (anchor) => anchor.workstreamId === selectedWorkstream?.id,
  );
  const anchorIds = new Set(streamAnchors.map((anchor) => anchor.id));
  const streamTasks = workspace.tasks.filter((task) =>
    anchorIds.has(task.anchorId),
  );
  const streamCommunications = communicationsForWorkstream(
    workspace.contextRecords,
    selectedWorkstream?.id,
    anchorIds,
  );
  const allowedSourceIds = sourceIdsForWorkstream(
    workspace.sourceItems,
    workspace.anchors,
    selectedWorkstream?.id,
  );
  const streamFiles = workspace.sourceItems.filter(
    (item) =>
      item.itemType === "file" &&
      (allowedSourceIds?.has(item.id) || anchorIds.has(item.recordId)),
  );
  const sourceAnalytics = useMemo(
    () =>
      buildTaskingFileAnalytics(
        workspace.sourceItems.map((item) => ({ ...item, kind: item.itemType })),
        workspace.tasks,
        workspace.relationships,
      ),
    [workspace.relationships, workspace.sourceItems, workspace.tasks],
  );
  const records = useMemo(
    () =>
      new Map(
        [
          ...workspace.anchors,
          ...workspace.tasks,
          ...workspace.contextRecords,
          ...workspace.sourceItems,
        ].map((item) => [item.id, item]),
      ),
    [workspace],
  );
  const streamRecordIds = new Set(
    [
      selectedWorkstream?.id,
      ...anchorIds,
      ...streamTasks.map((task) => task.id),
      ...streamFiles.map((file) => file.id),
      ...streamCommunications.map((record) => record.id),
    ].filter(Boolean),
  );
  const streamRelationships = workspace.relationships.filter(
    (relationship) =>
      streamRecordIds.has(relationship.fromId) ||
      streamRecordIds.has(relationship.toId),
  );
  const selectedRecord = records.get(routed.recordId) || null;
  const selectedAnchor = selectedRecord?.anchorId
    ? workspace.anchors.find((anchor) => anchor.id === selectedRecord.anchorId)
    : workspace.anchors.find(
        (anchor) =>
          anchor.id === selectedRecord?.recordId ||
          anchor.id === selectedRecord?.id,
      );
  const inspectorWorkstream =
    enrichedWorkstreams.find(
      (stream) => stream.id === selectedAnchor?.workstreamId,
    ) || selectedWorkstream;
  const selectedFileAnalytics = sourceAnalytics.files.find(
    (file) => file.id === selectedRecord?.id,
  );
  const effectiveRecord = selectedFileAnalytics || selectedRecord;
  const section =
    routed.view === "tasks"
      ? "tasks"
      : routed.view === "sources"
        ? "sources"
        : routed.view === "communications"
          ? "communications"
          : routed.section;
  const counts = workspace.metadata?.counts || {};

  function chooseWorkstream(id) {
    replaceTaskingRoute({
      taskingView: "workstreams",
      taskingWorkstream: id,
      taskingSection: "overview",
      taskingRecord: "",
    });
  }
  function chooseSection(next) {
    replaceTaskingRoute({
      taskingView: "workstreams",
      taskingWorkstream: selectedWorkstream?.id,
      taskingSection: next,
    });
  }
  function selectRecord(id) {
    replaceTaskingRoute({
      taskingWorkstream: selectedWorkstream?.id,
      taskingRecord: id,
    });
  }

  const headerMeta = (
    <span className="tasking-workspace-state">
      <CircleDot size={14} />
      <strong>{workspace.metadata?.label || taskState.persistenceLabel}</strong>
      <span>{workspace.metadata?.coverage}</span>
    </span>
  );
  return (
    <section
      className="tasking-workspace"
      data-tasking-workspace
      data-tasking-view={routed.view}
    >
      <ControlWorkbenchHeader
        eyebrow="Workspace operations"
        title="Tasking"
        summary="Move workstreams forward with tasks, source material, communications, and reviewed interactions in one operating context."
        meta={headerMeta}
        metrics={[
          {
            id: "workstreams",
            label: "Workstreams",
            value: enrichedWorkstreams.length,
            meta: "Primary operating units",
          },
          {
            id: "open",
            label: "Open tasks",
            value: workspace.tasks.filter((task) =>
              OPEN_STATUSES.has(task.status),
            ).length,
            meta: `${workspace.tasks.filter((task) => task.status === "draft").length} drafts`,
            tone: "info",
          },
          {
            id: "sources",
            label: "Sources",
            value: counts.sourceItems ?? workspace.sourceItems.length,
            meta: `${sourceAnalytics.totalFiles} files`,
          },
          {
            id: "messages",
            label: "Messages",
            value: workspace.contextRecords.filter(isCommunication).length,
            meta: "Email, IM, meetings",
          },
        ]}
        metricLabel="Tasking workspace summary"
      />
      <ControlPageBody compact>
        <div className="tasking-operating-shell">
          <WorkstreamRail
            workstreams={enrichedWorkstreams}
            anchors={workspace.anchors}
            tasks={workspace.tasks}
            communications={workspace.contextRecords}
            sourceItems={workspace.sourceItems}
            selectedId={selectedWorkstream?.id}
            onSelect={chooseWorkstream}
          />
          <main className="tasking-workstream-main">
            {selectedWorkstream ? (
              <>
                <header className="tasking-workstream-head">
                  <div>
                    <span className="tasking-workstream-head__title">
                      <WorkstreamPill
                        workstream={selectedWorkstream}
                        anchors={streamAnchors}
                      />
                      <h2>{selectedWorkstream.name}</h2>
                      <i>{selectedWorkstream.category}</i>
                    </span>
                    <p>
                      {selectedWorkstream.description ||
                        "No workstream description recorded."}
                    </p>
                  </div>
                  <button
                    type="button"
                    className="if-btn if-btn--primary if-btn--sm"
                    onClick={() => chooseSection("tasks")}
                  >
                    <Plus size={14} />
                    Create task
                  </button>
                </header>
                <nav
                  className="tasking-workstream-tabs"
                  aria-label="Selected workstream"
                >
                  <button
                    type="button"
                    aria-selected={section === "overview"}
                    onClick={() => chooseSection("overview")}
                  >
                    Overview
                  </button>
                  <button
                    type="button"
                    aria-selected={section === "tasks"}
                    onClick={() => chooseSection("tasks")}
                  >
                    Tasks <span>{streamTasks.length}</span>
                  </button>
                  <button
                    type="button"
                    aria-selected={section === "sources"}
                    onClick={() => chooseSection("sources")}
                  >
                    Sources <span>{streamFiles.length}</span>
                  </button>
                  <button
                    type="button"
                    aria-selected={section === "communications"}
                    onClick={() => chooseSection("communications")}
                  >
                    Communications <span>{streamCommunications.length}</span>
                  </button>
                  <button
                    type="button"
                    aria-selected={section === "interactions"}
                    onClick={() => chooseSection("interactions")}
                  >
                    Interactions <span>{streamRelationships.length}</span>
                  </button>
                </nav>
                <div className="tasking-workstream-view">
                  {section === "overview" ? (
                    <Overview
                      workstream={selectedWorkstream}
                      anchors={streamAnchors}
                      tasks={streamTasks}
                      files={streamFiles}
                      communications={streamCommunications}
                      onSection={chooseSection}
                      onSelect={selectRecord}
                      canWrite={taskState.canWrite}
                    />
                  ) : null}
                  {section === "tasks" ? (
                    <TasksView
                      tasks={streamTasks}
                      anchors={streamAnchors}
                      selectedId={routed.recordId}
                      onSelect={selectRecord}
                      onCreate={taskState.createTask}
                      canWrite={taskState.canWrite}
                    />
                  ) : null}
                  {section === "sources" ? (
                    <Suspense
                      fallback={
                        <EmptyState
                          icon={FileText}
                          title="Loading source structure"
                          copy="Preparing the stable file hierarchy."
                        />
                      }
                    >
                      <TaskingSourceExplorer
                        sourceItems={workspace.sourceItems}
                        anchors={workspace.anchors}
                        workstreams={enrichedWorkstreams}
                        selectedId={routed.recordId}
                        onSelect={(item) => selectRecord(item.id)}
                      />
                    </Suspense>
                  ) : null}
                  {section === "communications" ? (
                    <CommunicationsView records={streamCommunications} />
                  ) : null}
                  {section === "interactions" ? (
                    <InteractionsView
                      relationships={streamRelationships}
                      records={records}
                      onSelect={selectRecord}
                      onSources={() => chooseSection("sources")}
                    />
                  ) : null}
                </div>
              </>
            ) : (
              <EmptyState
                icon={LayoutList}
                title="No workstreams yet"
                copy="Create a workstream through the Tasking Agent API to establish the primary operating unit for tasks, files, and communications."
              />
            )}
          </main>
          <Inspector
            key={effectiveRecord?.id || "empty"}
            record={effectiveRecord}
            workstream={inspectorWorkstream}
            anchors={streamAnchors}
            taskState={taskState}
            taskIds={selectedFileAnalytics?.taskIds || []}
          />
        </div>
        <footer className="tasking-boundary">
          <CheckCircle2 size={15} />
          <span>
            <strong>Workspace boundary</strong> Tasking stores reviewed metadata
            and relationships. Local source files remain read only and
            communications connectors remain separate.
          </span>
        </footer>
      </ControlPageBody>
    </section>
  );
}
