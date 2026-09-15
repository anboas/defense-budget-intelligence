import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  Bot,
  CalendarDays,
  Check,
  ExternalLink,
  FileStack,
  Flag,
  ImagePlus,
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
import WorkspaceMark from "./WorkspaceMark.jsx";
import ControlSelect from "./ControlSelect.jsx";

const ROLE_LABELS = { administrator: "Workspace manager", analyst: "Analyst", viewer: "Viewer" };
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

async function squareWorkspaceIcon(file) {
  if (!file?.type?.startsWith("image/") || file.size > 8_000_000) throw new Error("Choose a PNG, JPEG, or WebP image under 8 MB.");
  const sourceDataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("That image could not be opened."));
    reader.readAsDataURL(file);
  });
  const image = await new Promise((resolve, reject) => {
    const element = new Image();
    element.onload = () => resolve(element);
    element.onerror = () => reject(new Error("That image could not be opened."));
    element.src = sourceDataUrl;
  });
  const sourceSize = Math.min(image.naturalWidth, image.naturalHeight);
  const sourceX = Math.floor((image.naturalWidth - sourceSize) / 2);
  const sourceY = Math.floor((image.naturalHeight - sourceSize) / 2);
  for (const size of [96, 80, 64, 48]) {
    for (const quality of [0.76, 0.62, 0.48]) {
      const canvas = document.createElement("canvas");
      canvas.width = size;
      canvas.height = size;
      canvas.getContext("2d").drawImage(image, sourceX, sourceY, sourceSize, sourceSize, 0, 0, size, size);
      const dataUrl = canvas.toDataURL("image/webp", quality);
      if (dataUrl.length <= 13_500) return dataUrl;
    }
  }
  throw new Error("That image is too complex. Try a simpler crop.");
}

export default function WorkspaceManagement({ auth, activeOnly = false }) {
  const [data, setData] = useState({ workspaces: [], requests: [], users: [], availableRoles: [] });
  const [draft, setDraft] = useState({ name: "", description: "" });
  const [editing, setEditing] = useState(null);
  const [memberDrafts, setMemberDrafts] = useState({});
  const [requestRoles, setRequestRoles] = useState({});
  const [busy, setBusy] = useState(true);
  const [notice, setNotice] = useState(null);
  const isSuperUser = auth.user?.roleId === "super_user";
  const visibleWorkspaces = activeOnly
    ? data.workspaces.filter((workspace) => workspace.id === auth.user?.activeWorkspace?.id)
    : data.workspaces;

  function showNotice(text, tone = "success") {
    setNotice({ id: Date.now(), text, tone });
  }

  useEffect(() => {
    if (!notice) return undefined;
    const timeout = window.setTimeout(() => setNotice(null), 4200);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  async function refresh() {
    const result = await auth.getWorkspaceAdmin();
    setData(result);
  }

  useEffect(() => {
    let active = true;
    auth.getWorkspaceAdmin().then((result) => { if (active) setData(result); })
      .catch((error) => { if (active) showNotice(error.message, "error"); })
      .finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [auth]);

  const pending = useMemo(() => data.requests.filter((request) => request.status === "pending"), [data.requests]);
  const visiblePending = pending.filter((request) => !activeOnly || request.workspaceId === auth.user?.activeWorkspace?.id);
  const roles = data.availableRoles?.length ? data.availableRoles : ["administrator", "analyst", "viewer"];
  const roleOptions = roles.map((role) => ({ value: role, label: ROLE_LABELS[role] }));
  const totals = useMemo(() => visibleWorkspaces.reduce((summary, workspace) => ({
    tracked: summary.tracked + Number(workspace.contents?.trackedRecords || 0),
    events: summary.events + Number(workspace.contents?.events || 0),
  }), { tracked: 0, events: 0 }), [visibleWorkspaces]);
  const inventoryAvailable = visibleWorkspaces.some((workspace) => Number.isFinite(workspace.contents?.events));

  async function mutate(operation, success) {
    setBusy(true);
    setNotice(null);
    try { await operation(); await refresh(); showNotice(success); }
    catch (error) { showNotice(error.message, "error"); throw error; }
    finally { setBusy(false); }
  }

  function createWorkspace(event) {
    event.preventDefault();
    void mutate(() => auth.createWorkspace(draft), "Workspace created.")
      .then(() => setDraft({ name: "", description: "" }))
      .catch(() => {});
  }

  function beginEdit(workspace) {
    setEditing({ id: workspace.id, name: workspace.name, description: workspace.description || "", iconDataUrl: workspace.iconDataUrl || "", headerEyebrow: workspace.headerEyebrow || "Defense Budget & Spend Analytics", displayTitle: workspace.displayTitle || "Defense Budget Intelligence" });
    setNotice(null);
  }

  function saveWorkspace(event, workspace) {
    event.preventDefault();
    void mutate(() => auth.updateWorkspace(workspace.id, editing), `${editing.name} updated.`)
      .then(() => setEditing(null))
      .catch(() => {});
  }

  return <section className="ops-panel workspace-management" data-workspace-management aria-labelledby="workspace-management-title">
    <header className="ops-panel__header workspace-management__header"><div><span>{activeOnly ? "Active workspace" : "Super-user control"}</span><h2 id="workspace-management-title">{activeOnly ? "Workspace management" : "Super admin"}</h2><p>{activeOnly ? "Configure this workspace's identity, members, roles, requests, and shared inventory." : "Inspect and govern every isolated workspace boundary from one global console."}</p></div><span className="if-badge if-badge--info if-badge--sm">{activeOnly ? "Scoped manager" : "Super user"}</span></header>

    <div className="workspace-management__metrics"><article><span>Workspaces</span><strong>{visibleWorkspaces.length}</strong></article><article><span>Pending requests</span><strong>{pending.filter((request) => !activeOnly || request.workspaceId === auth.user?.activeWorkspace?.id).length}</strong></article><article><span>Registered users</span><strong>{data.users.length}</strong></article><article><span>Tracked records</span><strong>{inventoryAvailable ? totals.tracked : "—"}</strong></article><article><span>Events</span><strong>{inventoryAvailable ? totals.events : "—"}</strong></article></div>

    {isSuperUser && !activeOnly ? <form className="workspace-management__create" onSubmit={createWorkspace}>
      <label>Name<input required minLength={2} value={draft.name} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} placeholder="Program intelligence" /></label>
      <label>Description<input value={draft.description} onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))} placeholder="What this workspace covers" /></label>
      <button className="if-btn if-btn--primary" type="submit" disabled={busy}><Plus size={15} />Create workspace</button>
    </form> : null}

    {visiblePending.length ? <section className="workspace-request-queue" aria-labelledby="workspace-requests-title"><header><div><span>Approval queue</span><h3 id="workspace-requests-title">Access requests</h3></div><b>{visiblePending.length}</b></header>{visiblePending.map((request) => <article key={request.id} data-workspace-request={request.id}>
      <UserAvatar user={request} size={38} />
      <div><strong>{request.displayName}</strong><span>{request.email}</span><small>{request.workspaceName}{request.note ? ` · ${request.note}` : ""}</small></div>
      <ControlSelect compact ariaLabel={`Role for ${request.displayName}`} value={requestRoles[request.id] || "viewer"} options={roleOptions} onChange={(role) => setRequestRoles((current) => ({ ...current, [request.id]: role }))} />
      <button className="is-approve" type="button" disabled={busy} onClick={() => void mutate(() => auth.resolveWorkspaceRequest(request.id, { decision: "approved", role: requestRoles[request.id] || "viewer" }), `${request.displayName} approved.`).catch(() => {})}><Check size={14} />Approve</button>
      <button className="is-deny" type="button" disabled={busy} onClick={() => void mutate(() => auth.resolveWorkspaceRequest(request.id, { decision: "denied", role: "viewer" }), `${request.displayName} denied.`).catch(() => {})}><X size={14} />Deny</button>
    </article>)}</section> : null}

    {notice ? <div className="if-toast-stack workspace-toast-stack" aria-live="polite"><div className={`if-toast workspace-toast is-${notice.tone}`} role={notice.tone === "error" ? "alert" : "status"}><span>{notice.tone === "error" ? <X size={17} /> : <Check size={17} />}</span><div><strong>{notice.tone === "error" ? "Action needed" : "Workspace updated"}</strong><p>{notice.text}</p></div><button type="button" aria-label="Dismiss notification" onClick={() => setNotice(null)}><X size={15} /></button></div></div> : null}

    <div className="workspace-management__list">{busy && !visibleWorkspaces.length ? <p>Loading workspaces…</p> : visibleWorkspaces.map((workspace) => {
      const memberIds = new Set(workspace.members.map((member) => member.id));
      const candidates = data.users.filter((user) => !memberIds.has(user.id));
      const memberDraft = memberDrafts[workspace.id] || { userId: candidates[0]?.id || "", role: "viewer" };
      const isCurrent = auth.user?.activeWorkspace?.id === workspace.id;
      const workspacePending = Number(workspace.pendingRequestCount || 0);
      const roleCounts = workspace.members.reduce((counts, member) => ({ ...counts, [member.roleId]: (counts[member.roleId] || 0) + 1 }), {});
      const isEditing = editing?.id === workspace.id;
      return <article className={`workspace-card${isCurrent ? " is-current" : ""}`} key={workspace.id} data-workspace={workspace.id} data-workspace-current={isCurrent ? "true" : "false"}>
        <header>
          <span><WorkspaceMark workspace={workspace} /></span>
          <div><div className="workspace-card__title"><h3>{workspace.name}</h3>{isCurrent ? <b>Current</b> : null}</div><p>{workspace.description || "Shared intelligence workspace"}</p><small>{displayDate(workspace.lastActivityAt)}</small></div>
          <div className="workspace-card__header-actions"><span>{workspace.members.length} member{workspace.members.length === 1 ? "" : "s"}{workspacePending ? ` · ${workspacePending} pending` : ""}</span>{!isCurrent ? <button type="button" disabled={busy} onClick={() => void auth.switchWorkspace(workspace.id).catch((error) => showNotice(error.message, "error"))}><ExternalLink size={14} />Open</button> : null}<button type="button" disabled={busy} onClick={() => beginEdit(workspace)}><Pencil size={14} />Configure</button></div>
        </header>

        {isEditing ? <form className="workspace-card__editor" onSubmit={(event) => saveWorkspace(event, workspace)} data-workspace-editor={workspace.id}>
          <div className="workspace-card__branding"><WorkspaceMark workspace={editing} /><span><label className="if-btn if-btn--sm" htmlFor={`workspace-icon-${workspace.id}`}><ImagePlus size={14} />{editing.iconDataUrl ? "Replace icon" : "Choose icon"}</label><input id={`workspace-icon-${workspace.id}`} type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => void squareWorkspaceIcon(event.target.files?.[0]).then((iconDataUrl) => setEditing((current) => ({ ...current, iconDataUrl }))).catch((error) => showNotice(error.message, "error"))} />{editing.iconDataUrl ? <button type="button" onClick={() => setEditing((current) => ({ ...current, iconDataUrl: "" }))}>Use default</button> : null}</span></div>
          <label>Workspace name<input required minLength={2} value={editing.name} onChange={(event) => setEditing((current) => ({ ...current, name: event.target.value }))} /></label>
          <label>Description<input value={editing.description} onChange={(event) => setEditing((current) => ({ ...current, description: event.target.value }))} /></label>
          <label>Header eyebrow<input required minLength={2} value={editing.headerEyebrow} onChange={(event) => setEditing((current) => ({ ...current, headerEyebrow: event.target.value }))} /></label>
          <label>Display title<input required minLength={2} value={editing.displayTitle} onChange={(event) => setEditing((current) => ({ ...current, displayTitle: event.target.value }))} /></label>
          <button type="submit" disabled={busy}><Save size={14} />Save</button>
          <button type="button" disabled={busy} onClick={() => setEditing(null)}><X size={14} />Cancel</button>
        </form> : null}

        <section className="workspace-card__contents" aria-label={`${workspace.name} contents`}>
          <header><div><span>Workspace inventory</span><strong>What lives here</strong></div><small>{workspace.contents?.wallboardEvents === null || workspace.contents?.wallboardEvents === undefined ? "Hosted counts unavailable locally" : `${workspace.contents.wallboardEvents} event${workspace.contents.wallboardEvents === 1 ? "" : "s"} on wallboard`}</small></header>
          <div>{CONTENT_METRICS.map(([key, label, Icon]) => <article key={key}><Icon size={15} aria-hidden="true" /><span>{label}</span><strong>{displayCount(workspace.contents?.[key])}</strong></article>)}</div>
        </section>

        <div className="workspace-card__role-summary" aria-label={`${workspace.name} role distribution`}><UsersRound size={15} aria-hidden="true" /><span>{Number(roleCounts.super_user || 0)} owner</span><span>{Number(roleCounts.administrator || 0)} manager</span><span>{Number(roleCounts.analyst || 0)} analyst</span><span>{Number(roleCounts.viewer || 0)} viewer</span></div>

        {candidates.length ? <form className="workspace-card__add-member" onSubmit={(event) => { event.preventDefault(); void mutate(() => auth.addWorkspaceMember(workspace.id, memberDraft), "Workspace member added.").catch(() => {}); }}>
          <ControlSelect ariaLabel={`User to add to ${workspace.name}`} value={memberDraft.userId} searchable options={candidates.map((user) => ({ value: user.id, label: user.displayName, description: user.email, icon: <UserAvatar user={user} size={24} /> }))} onChange={(userId) => setMemberDrafts((current) => ({ ...current, [workspace.id]: { ...memberDraft, userId } }))} />
          <ControlSelect compact ariaLabel={`Role for new member in ${workspace.name}`} value={memberDraft.role} options={roleOptions} onChange={(role) => setMemberDrafts((current) => ({ ...current, [workspace.id]: { ...memberDraft, role } }))} />
          <button type="submit" disabled={busy || !memberDraft.userId}><UserPlus size={14} /><span>Add member</span></button>
        </form> : null}
        <div className="workspace-card__members"><header><span>Members</span><strong>{workspace.members.length}</strong></header>{workspace.members.map((member) => <div key={member.id}>
          <UserAvatar user={member} size={34} /><span><strong>{member.displayName}</strong><small>{member.email}</small></span>
          {member.roleId !== "super_user" ? <ControlSelect compact ariaLabel={`Role for ${member.displayName} in ${workspace.name}`} value={member.roleId} disabled={busy} options={roleOptions} onChange={(role) => void mutate(() => auth.addWorkspaceMember(workspace.id, { userId: member.id, role }), `${member.displayName} is now ${ROLE_LABELS[role]}.`).catch(() => {})} /> : <b>{member.role}</b>}
          {member.roleId !== "super_user" ? <button type="button" aria-label={`Remove ${member.displayName} from ${workspace.name}`} disabled={busy} onClick={() => void mutate(() => auth.removeWorkspaceMember(workspace.id, member.id), `${member.displayName} removed from ${workspace.name}.`).catch(() => {})}><UserX size={14} />Remove</button> : <em>Immutable owner</em>}
        </div>)}</div>
      </article>;
    })}</div>
  </section>;
}
