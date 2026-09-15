import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  Bot,
  Building2,
  CalendarDays,
  Check,
  ExternalLink,
  FileStack,
  Flag,
  Pencil,
  Plus,
  Save,
  Star,
  UserPlus,
  UsersRound,
  UserX,
  X,
} from "lucide-react";
import UserAvatar from "./UserAvatar.jsx";

const ROLE_LABELS = { administrator: "Administrator", analyst: "Analyst", viewer: "Viewer" };
const CONTENT_METRICS = [
  ["trackedRecords", "Tracked", Star],
  ["events", "Events", CalendarDays],
  ["milestones", "Milestones", Flag],
  ["manualRecords", "Manual records", FileStack],
  ["activityEntries", "Audit entries", Activity],
  ["activeAgentKeys", "Agent keys", Bot],
];

function displayCount(value) {
  return value === null || value === undefined ? "—" : Number(value).toLocaleString();
}

function displayDate(value) {
  if (!value) return "No workspace activity yet";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "No workspace activity yet" : `Last activity ${date.toLocaleString([], { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" })}`;
}

export default function WorkspaceManagement({ auth }) {
  const [data, setData] = useState({ workspaces: [], requests: [], users: [], availableRoles: [] });
  const [draft, setDraft] = useState({ name: "", description: "" });
  const [editing, setEditing] = useState(null);
  const [memberDrafts, setMemberDrafts] = useState({});
  const [requestRoles, setRequestRoles] = useState({});
  const [busy, setBusy] = useState(true);
  const [message, setMessage] = useState("");

  async function refresh() {
    const result = await auth.getWorkspaceAdmin();
    setData(result);
  }

  useEffect(() => {
    let active = true;
    auth.getWorkspaceAdmin().then((result) => { if (active) setData(result); })
      .catch((error) => { if (active) setMessage(error.message); })
      .finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [auth]);

  const pending = useMemo(() => data.requests.filter((request) => request.status === "pending"), [data.requests]);
  const roles = data.availableRoles?.length ? data.availableRoles : ["administrator", "analyst", "viewer"];
  const totals = useMemo(() => data.workspaces.reduce((summary, workspace) => ({
    tracked: summary.tracked + Number(workspace.contents?.trackedRecords || 0),
    events: summary.events + Number(workspace.contents?.events || 0),
  }), { tracked: 0, events: 0 }), [data.workspaces]);
  const inventoryAvailable = data.workspaces.some((workspace) => Number.isFinite(workspace.contents?.events));

  async function mutate(operation, success) {
    setBusy(true);
    setMessage("");
    try { await operation(); await refresh(); setMessage(success); }
    catch (error) { setMessage(error.message); throw error; }
    finally { setBusy(false); }
  }

  function createWorkspace(event) {
    event.preventDefault();
    void mutate(() => auth.createWorkspace(draft), "Workspace created.")
      .then(() => setDraft({ name: "", description: "" }))
      .catch(() => {});
  }

  function beginEdit(workspace) {
    setEditing({ id: workspace.id, name: workspace.name, description: workspace.description || "" });
    setMessage("");
  }

  function saveWorkspace(event, workspace) {
    event.preventDefault();
    void mutate(() => auth.updateWorkspace(workspace.id, { name: editing.name, description: editing.description }), `${editing.name} updated.`)
      .then(() => setEditing(null))
      .catch(() => {});
  }

  return <section className="ops-panel workspace-management" data-workspace-management aria-labelledby="workspace-management-title">
    <header className="ops-panel__header workspace-management__header"><div><span>Super-user control</span><h2 id="workspace-management-title">Workspace command</h2><p>Inspect each isolated data boundary, rename it, switch context, review requests, and govern membership.</p></div><span className="if-badge if-badge--info if-badge--sm">Super user only</span></header>

    <div className="workspace-management__metrics"><article><span>Workspaces</span><strong>{data.workspaces.length}</strong></article><article><span>Pending requests</span><strong>{pending.length}</strong></article><article><span>Registered users</span><strong>{data.users.length}</strong></article><article><span>Tracked records</span><strong>{inventoryAvailable ? totals.tracked : "—"}</strong></article><article><span>Events</span><strong>{inventoryAvailable ? totals.events : "—"}</strong></article></div>

    <form className="workspace-management__create" onSubmit={createWorkspace}>
      <label>Name<input required minLength={2} value={draft.name} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} placeholder="Program intelligence" /></label>
      <label>Description<input value={draft.description} onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))} placeholder="What this workspace covers" /></label>
      <button className="if-btn if-btn--primary" type="submit" disabled={busy}><Plus size={15} />Create workspace</button>
    </form>

    {pending.length ? <section className="workspace-request-queue" aria-labelledby="workspace-requests-title"><header><div><span>Approval queue</span><h3 id="workspace-requests-title">Access requests</h3></div><b>{pending.length}</b></header>{pending.map((request) => <article key={request.id} data-workspace-request={request.id}>
      <UserAvatar user={request} size={38} />
      <div><strong>{request.displayName}</strong><span>{request.email}</span><small>{request.workspaceName}{request.note ? ` · ${request.note}` : ""}</small></div>
      <select aria-label={`Role for ${request.displayName}`} value={requestRoles[request.id] || "viewer"} onChange={(event) => setRequestRoles((current) => ({ ...current, [request.id]: event.target.value }))}>{roles.map((role) => <option key={role} value={role}>{ROLE_LABELS[role]}</option>)}</select>
      <button className="is-approve" type="button" disabled={busy} onClick={() => void mutate(() => auth.resolveWorkspaceRequest(request.id, { decision: "approved", role: requestRoles[request.id] || "viewer" }), `${request.displayName} approved.`).catch(() => {})}><Check size={14} />Approve</button>
      <button className="is-deny" type="button" disabled={busy} onClick={() => void mutate(() => auth.resolveWorkspaceRequest(request.id, { decision: "denied", role: "viewer" }), `${request.displayName} denied.`).catch(() => {})}><X size={14} />Deny</button>
    </article>)}</section> : null}

    {message ? <p className="account-form__message workspace-management__message" role="status">{message}</p> : null}

    <div className="workspace-management__list">{busy && !data.workspaces.length ? <p>Loading workspaces…</p> : data.workspaces.map((workspace) => {
      const memberIds = new Set(workspace.members.map((member) => member.id));
      const candidates = data.users.filter((user) => !memberIds.has(user.id));
      const memberDraft = memberDrafts[workspace.id] || { userId: candidates[0]?.id || "", role: "viewer" };
      const isCurrent = auth.user?.activeWorkspace?.id === workspace.id;
      const workspacePending = Number(workspace.pendingRequestCount || 0);
      const roleCounts = workspace.members.reduce((counts, member) => ({ ...counts, [member.roleId]: (counts[member.roleId] || 0) + 1 }), {});
      const isEditing = editing?.id === workspace.id;
      return <article className={`workspace-card${isCurrent ? " is-current" : ""}`} key={workspace.id} data-workspace={workspace.id} data-workspace-current={isCurrent ? "true" : "false"}>
        <header>
          <span><Building2 size={19} /></span>
          <div><div className="workspace-card__title"><h3>{workspace.name}</h3>{isCurrent ? <b>Current</b> : null}</div><p>{workspace.description || "Shared intelligence workspace"}</p><small>{displayDate(workspace.lastActivityAt)}</small></div>
          <div className="workspace-card__header-actions"><span>{workspace.members.length} member{workspace.members.length === 1 ? "" : "s"}{workspacePending ? ` · ${workspacePending} pending` : ""}</span>{!isCurrent ? <button type="button" disabled={busy} onClick={() => void auth.switchWorkspace(workspace.id).catch((error) => setMessage(error.message))}><ExternalLink size={14} />Open</button> : null}<button type="button" disabled={busy} onClick={() => beginEdit(workspace)}><Pencil size={14} />Rename</button></div>
        </header>

        {isEditing ? <form className="workspace-card__editor" onSubmit={(event) => saveWorkspace(event, workspace)} data-workspace-editor={workspace.id}>
          <label>Workspace name<input required minLength={2} value={editing.name} onChange={(event) => setEditing((current) => ({ ...current, name: event.target.value }))} /></label>
          <label>Description<input value={editing.description} onChange={(event) => setEditing((current) => ({ ...current, description: event.target.value }))} /></label>
          <button type="submit" disabled={busy}><Save size={14} />Save</button>
          <button type="button" disabled={busy} onClick={() => setEditing(null)}><X size={14} />Cancel</button>
        </form> : null}

        <section className="workspace-card__contents" aria-label={`${workspace.name} contents`}>
          <header><div><span>Workspace inventory</span><strong>What lives here</strong></div><small>{workspace.contents?.wallboardEvents === null || workspace.contents?.wallboardEvents === undefined ? "Hosted counts unavailable locally" : `${workspace.contents.wallboardEvents} event${workspace.contents.wallboardEvents === 1 ? "" : "s"} on wallboard`}</small></header>
          <div>{CONTENT_METRICS.map(([key, label, Icon]) => <article key={key}><Icon size={15} aria-hidden="true" /><span>{label}</span><strong>{displayCount(workspace.contents?.[key])}</strong></article>)}</div>
        </section>

        <div className="workspace-card__role-summary" aria-label={`${workspace.name} role distribution`}><UsersRound size={15} aria-hidden="true" /><span>{Number(roleCounts.super_user || 0)} owner</span><span>{Number(roleCounts.administrator || 0)} admin</span><span>{Number(roleCounts.analyst || 0)} analyst</span><span>{Number(roleCounts.viewer || 0)} viewer</span></div>

        {candidates.length ? <form className="workspace-card__add-member" onSubmit={(event) => { event.preventDefault(); void mutate(() => auth.addWorkspaceMember(workspace.id, memberDraft), "Workspace member added.").catch(() => {}); }}>
          <select aria-label={`User to add to ${workspace.name}`} value={memberDraft.userId} onChange={(event) => setMemberDrafts((current) => ({ ...current, [workspace.id]: { ...memberDraft, userId: event.target.value } }))}>{candidates.map((user) => <option key={user.id} value={user.id}>{user.displayName} · {user.email}</option>)}</select>
          <select aria-label={`Role for new member in ${workspace.name}`} value={memberDraft.role} onChange={(event) => setMemberDrafts((current) => ({ ...current, [workspace.id]: { ...memberDraft, role: event.target.value } }))}>{roles.map((role) => <option key={role} value={role}>{ROLE_LABELS[role]}</option>)}</select>
          <button type="submit" disabled={busy || !memberDraft.userId}><UserPlus size={14} />Add member</button>
        </form> : null}
        <div className="workspace-card__members"><header><span>Members</span><strong>{workspace.members.length}</strong></header>{workspace.members.map((member) => <div key={member.id}>
          <UserAvatar user={member} size={34} /><span><strong>{member.displayName}</strong><small>{member.email}</small></span>
          {member.roleId !== "super_user" ? <select aria-label={`Role for ${member.displayName} in ${workspace.name}`} value={member.roleId} disabled={busy} onChange={(event) => void mutate(() => auth.addWorkspaceMember(workspace.id, { userId: member.id, role: event.target.value }), `${member.displayName} is now ${ROLE_LABELS[event.target.value]}.`).catch(() => {})}>{roles.map((role) => <option key={role} value={role}>{ROLE_LABELS[role]}</option>)}</select> : <b>{member.role}</b>}
          {member.roleId !== "super_user" ? <button type="button" aria-label={`Remove ${member.displayName} from ${workspace.name}`} disabled={busy} onClick={() => void mutate(() => auth.removeWorkspaceMember(workspace.id, member.id), `${member.displayName} removed from ${workspace.name}.`).catch(() => {})}><UserX size={14} />Remove</button> : <em>Immutable owner</em>}
        </div>)}</div>
      </article>;
    })}</div>
  </section>;
}
