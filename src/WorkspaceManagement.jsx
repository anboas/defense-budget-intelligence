import { useEffect, useMemo, useState } from "react";
import { Building2, Check, Plus, UserPlus, UserX, X } from "lucide-react";
import UserAvatar from "./UserAvatar.jsx";

const ROLE_LABELS = { administrator: "Administrator", analyst: "Analyst", viewer: "Viewer" };

export default function WorkspaceManagement({ auth }) {
  const [data, setData] = useState({ workspaces: [], requests: [], users: [], availableRoles: [] });
  const [draft, setDraft] = useState({ name: "", description: "" });
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

  async function mutate(operation, success) {
    setBusy(true);
    setMessage("");
    try { await operation(); await refresh(); setMessage(success); }
    catch (error) { setMessage(error.message); }
    finally { setBusy(false); }
  }

  function createWorkspace(event) {
    event.preventDefault();
    void mutate(() => auth.createWorkspace(draft), "Workspace created.").then(() => setDraft({ name: "", description: "" }));
  }

  return <section className="ops-panel workspace-management" data-workspace-management aria-labelledby="workspace-management-title">
    <header className="ops-panel__header workspace-management__header"><div><span>Super-user control</span><h2 id="workspace-management-title">Workspaces</h2><p>Create isolated workspaces, review access requests, and control membership.</p></div><span className="if-badge if-badge--info if-badge--sm">Super user only</span></header>

    <div className="workspace-management__metrics"><article><span>Workspaces</span><strong>{data.workspaces.length}</strong></article><article><span>Pending requests</span><strong>{pending.length}</strong></article><article><span>Registered users</span><strong>{data.users.length}</strong></article></div>

    <form className="workspace-management__create" onSubmit={createWorkspace}>
      <label>Name<input required minLength={2} value={draft.name} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} placeholder="Program intelligence" /></label>
      <label>Description<input value={draft.description} onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))} placeholder="What this workspace covers" /></label>
      <button className="if-btn if-btn--primary" type="submit" disabled={busy}><Plus size={15} />Create workspace</button>
    </form>

    {pending.length ? <section className="workspace-request-queue" aria-labelledby="workspace-requests-title"><header><div><span>Approval queue</span><h3 id="workspace-requests-title">Access requests</h3></div><b>{pending.length}</b></header>{pending.map((request) => <article key={request.id} data-workspace-request={request.id}>
      <UserAvatar user={request} size={38} />
      <div><strong>{request.displayName}</strong><span>{request.email}</span><small>{request.workspaceName}{request.note ? ` · ${request.note}` : ""}</small></div>
      <select aria-label={`Role for ${request.displayName}`} value={requestRoles[request.id] || "viewer"} onChange={(event) => setRequestRoles((current) => ({ ...current, [request.id]: event.target.value }))}>{roles.map((role) => <option key={role} value={role}>{ROLE_LABELS[role]}</option>)}</select>
      <button className="is-approve" type="button" disabled={busy} onClick={() => void mutate(() => auth.resolveWorkspaceRequest(request.id, { decision: "approved", role: requestRoles[request.id] || "viewer" }), `${request.displayName} approved.`)}><Check size={14} />Approve</button>
      <button className="is-deny" type="button" disabled={busy} onClick={() => void mutate(() => auth.resolveWorkspaceRequest(request.id, { decision: "denied", role: "viewer" }), `${request.displayName} denied.`)}><X size={14} />Deny</button>
    </article>)}</section> : null}

    {message ? <p className="account-form__message workspace-management__message" role="status">{message}</p> : null}

    <div className="workspace-management__list">{busy && !data.workspaces.length ? <p>Loading workspaces…</p> : data.workspaces.map((workspace) => {
      const memberIds = new Set(workspace.members.map((member) => member.id));
      const candidates = data.users.filter((user) => !memberIds.has(user.id));
      const memberDraft = memberDrafts[workspace.id] || { userId: candidates[0]?.id || "", role: "viewer" };
      return <article className="workspace-card" key={workspace.id} data-workspace={workspace.id}>
        <header><span><Building2 size={19} /></span><div><h3>{workspace.name}</h3><p>{workspace.description || "Shared intelligence workspace"}</p></div><b>{workspace.members.length} member{workspace.members.length === 1 ? "" : "s"}</b></header>
        {candidates.length ? <form onSubmit={(event) => { event.preventDefault(); void mutate(() => auth.addWorkspaceMember(workspace.id, memberDraft), "Workspace member added."); }}>
          <select aria-label={`User to add to ${workspace.name}`} value={memberDraft.userId} onChange={(event) => setMemberDrafts((current) => ({ ...current, [workspace.id]: { ...memberDraft, userId: event.target.value } }))}>{candidates.map((user) => <option key={user.id} value={user.id}>{user.displayName} · {user.email}</option>)}</select>
          <select aria-label="Workspace role" value={memberDraft.role} onChange={(event) => setMemberDrafts((current) => ({ ...current, [workspace.id]: { ...memberDraft, role: event.target.value } }))}>{roles.map((role) => <option key={role} value={role}>{ROLE_LABELS[role]}</option>)}</select>
          <button type="submit" disabled={busy || !memberDraft.userId}><UserPlus size={14} />Add</button>
        </form> : null}
        <div className="workspace-card__members">{workspace.members.map((member) => <div key={member.id}>
          <UserAvatar user={member} size={34} /><span><strong>{member.displayName}</strong><small>{member.email}</small></span><b>{member.role}</b>
          {member.roleId !== "super_user" ? <button type="button" aria-label={`Remove ${member.displayName} from ${workspace.name}`} disabled={busy} onClick={() => void mutate(() => auth.removeWorkspaceMember(workspace.id, member.id), `${member.displayName} removed from ${workspace.name}.`)}><UserX size={14} />Remove</button> : <em>Owner</em>}
        </div>)}</div>
      </article>;
    })}</div>
  </section>;
}
