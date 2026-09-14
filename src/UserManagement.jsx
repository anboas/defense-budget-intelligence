import { useEffect, useMemo, useState } from "react";
import { Check, KeyRound, Pencil, ShieldCheck, UserCheck, UserPlus, UsersRound, UserX, X } from "lucide-react";

const ROLE_LABELS = {
  administrator: "Administrator",
  analyst: "Analyst",
  viewer: "Viewer",
};

const EMPTY_CREATE = { displayName: "", email: "", title: "", role: "analyst", password: "", confirm: "" };

function dateTime(value) {
  if (!value) return "Never";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Never" : date.toLocaleString([], { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
}

function roleDescription(role) {
  if (role === "administrator") return "Manage users and agent credentials; full workspace read/write access.";
  if (role === "analyst") return "Read and update records, tracking, events, activity, and integrations.";
  if (role === "viewer") return "Read-only access to records, tracking, events, activity, and integrations.";
  return "Permanent workspace owner with unrestricted access.";
}

export default function UserManagement({ auth }) {
  const [users, setUsers] = useState([]);
  const [roles, setRoles] = useState([]);
  const [mode, setMode] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [createDraft, setCreateDraft] = useState(EMPTY_CREATE);
  const [editDraft, setEditDraft] = useState(null);
  const [resetDraft, setResetDraft] = useState({ password: "", confirm: "" });
  const [busy, setBusy] = useState(true);
  const [message, setMessage] = useState("");

  async function refresh() {
    const result = await auth.listUsers();
    setUsers(result.users || []);
    setRoles(result.availableRoles || []);
  }

  useEffect(() => {
    let active = true;
    void auth.listUsers().then((result) => {
      if (!active) return;
      setUsers(result.users || []);
      setRoles(result.availableRoles || []);
    }).catch((error) => setMessage(error.message)).finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [auth]);

  const selected = users.find((user) => user.id === selectedId);
  const activeCount = users.filter((user) => user.status === "active").length;
  const adminCount = users.filter((user) => ["super_user", "administrator"].includes(user.roleId)).length;
  const sessionCount = users.reduce((total, user) => total + user.activeSessions, 0);
  const orderedRoles = useMemo(() => roles.filter((role) => ROLE_LABELS[role]), [roles]);

  function closeEditor() {
    setMode("");
    setSelectedId("");
    setEditDraft(null);
    setResetDraft({ password: "", confirm: "" });
    setMessage("");
  }

  async function createUser(event) {
    event.preventDefault();
    setMessage("");
    if (createDraft.password !== createDraft.confirm) { setMessage("Temporary passwords do not match."); return; }
    setBusy(true);
    try {
      await auth.createUser(createDraft);
      await refresh();
      setCreateDraft(EMPTY_CREATE);
      setMode("");
      setMessage("User created. Share the temporary password through a secure channel; the user must replace it at first sign-in.");
    } catch (error) { setMessage(error.message); }
    finally { setBusy(false); }
  }

  async function saveUser(event) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      await auth.updateUser(selectedId, editDraft);
      await refresh();
      setMode("");
      setSelectedId("");
      setEditDraft(null);
      setMessage("User updated.");
    } catch (error) { setMessage(error.message); }
    finally { setBusy(false); }
  }

  async function toggleStatus(user) {
    const status = user.status === "active" ? "suspended" : "active";
    setBusy(true);
    setMessage("");
    try {
      await auth.updateUser(user.id, { email: user.email, displayName: user.displayName, title: user.title, role: user.roleId, status });
      await refresh();
      setMessage(status === "suspended" ? `${user.displayName} suspended; active sessions were revoked.` : `${user.displayName} reactivated.`);
    } catch (error) { setMessage(error.message); }
    finally { setBusy(false); }
  }

  async function resetPassword(event) {
    event.preventDefault();
    setMessage("");
    if (resetDraft.password !== resetDraft.confirm) { setMessage("Temporary passwords do not match."); return; }
    setBusy(true);
    try {
      await auth.resetUserPassword(selectedId, resetDraft.password);
      await refresh();
      setMode("");
      setSelectedId("");
      setResetDraft({ password: "", confirm: "" });
      setMessage("Temporary password set. Existing sessions were revoked and the user must replace it at next sign-in.");
    } catch (error) { setMessage(error.message); }
    finally { setBusy(false); }
  }

  function openEdit(user) {
    setSelectedId(user.id);
    setEditDraft({ email: user.email, displayName: user.displayName, title: user.title || "", role: user.roleId, status: user.status });
    setMode("edit");
    setMessage("");
  }

  function openReset(user) {
    setSelectedId(user.id);
    setResetDraft({ password: "", confirm: "" });
    setMode("reset");
    setMessage("");
  }

  return <section className="ops-panel user-management" data-user-management aria-labelledby="user-management-title">
    <header className="ops-panel__header user-management__header">
      <div><span>Human access control</span><h2 id="user-management-title">Users</h2><p>Create accounts, assign least-privilege roles, revoke sessions, and require secure password replacement.</p></div>
      <button type="button" className="if-btn if-btn--primary if-btn--sm" onClick={() => { setMode("create"); setSelectedId(""); setMessage(""); }} disabled={busy}><UserPlus size={15} />Add user</button>
    </header>

    <div className="user-management__metrics" aria-label="User access summary">
      <article><span>Total users</span><strong>{users.length}</strong></article>
      <article><span>Active</span><strong>{activeCount}</strong></article>
      <article><span>Administrators</span><strong>{adminCount}</strong></article>
      <article><span>Active sessions</span><strong>{sessionCount}</strong></article>
    </div>

    {mode === "create" ? <form className="user-management__editor" data-user-create onSubmit={createUser}>
      <header><div><strong>Add user</strong><span>A temporary password is transformed in this browser before transmission.</span></div><button type="button" aria-label="Close add user" onClick={closeEditor}><X size={16} /></button></header>
      <div className="user-management__form-grid">
        <label>Display name<input required minLength={2} autoComplete="off" value={createDraft.displayName} onChange={(event) => setCreateDraft((draft) => ({ ...draft, displayName: event.target.value }))} /></label>
        <label>Email<input required type="email" autoComplete="off" value={createDraft.email} onChange={(event) => setCreateDraft((draft) => ({ ...draft, email: event.target.value }))} /></label>
        <label>Title <span>(optional)</span><input autoComplete="off" value={createDraft.title} onChange={(event) => setCreateDraft((draft) => ({ ...draft, title: event.target.value }))} /></label>
        <label>Role<select value={createDraft.role} onChange={(event) => setCreateDraft((draft) => ({ ...draft, role: event.target.value }))}>{orderedRoles.map((role) => <option value={role} key={role}>{ROLE_LABELS[role]}</option>)}</select><small>{roleDescription(createDraft.role)}</small></label>
        <label>Temporary password<input required minLength={12} type="password" autoComplete="new-password" value={createDraft.password} onChange={(event) => setCreateDraft((draft) => ({ ...draft, password: event.target.value }))} /></label>
        <label>Confirm temporary password<input required minLength={12} type="password" autoComplete="new-password" value={createDraft.confirm} onChange={(event) => setCreateDraft((draft) => ({ ...draft, confirm: event.target.value }))} /></label>
      </div>
      <footer><button type="button" onClick={closeEditor}>Cancel</button><button type="submit" className="is-primary" disabled={busy}><UserPlus size={15} />{busy ? "Creating…" : "Create user"}</button></footer>
    </form> : null}

    {mode === "edit" && selected && editDraft ? <form className="user-management__editor" data-user-edit onSubmit={saveUser}>
      <header><div><strong>Edit {selected.displayName}</strong><span>Role changes apply to the next request.</span></div><button type="button" aria-label="Close edit user" onClick={closeEditor}><X size={16} /></button></header>
      <div className="user-management__form-grid">
        <label>Display name<input required minLength={2} value={editDraft.displayName} onChange={(event) => setEditDraft((draft) => ({ ...draft, displayName: event.target.value }))} /></label>
        <label>Email<input required type="email" value={editDraft.email} onChange={(event) => setEditDraft((draft) => ({ ...draft, email: event.target.value }))} /></label>
        <label>Title <span>(optional)</span><input value={editDraft.title} onChange={(event) => setEditDraft((draft) => ({ ...draft, title: event.target.value }))} /></label>
        <label>Role<select value={editDraft.role} onChange={(event) => setEditDraft((draft) => ({ ...draft, role: event.target.value }))}>{orderedRoles.map((role) => <option value={role} key={role}>{ROLE_LABELS[role]}</option>)}</select><small>{roleDescription(editDraft.role)}</small></label>
      </div>
      <footer><button type="button" onClick={closeEditor}>Cancel</button><button type="submit" className="is-primary" disabled={busy}><Check size={15} />{busy ? "Saving…" : "Save user"}</button></footer>
    </form> : null}

    {mode === "reset" && selected ? <form className="user-management__editor user-management__editor--reset" data-user-password-reset onSubmit={resetPassword}>
      <header><div><strong>Reset password for {selected.displayName}</strong><span>This immediately revokes every active session for this user.</span></div><button type="button" aria-label="Close password reset" onClick={closeEditor}><X size={16} /></button></header>
      <div className="user-management__form-grid">
        <label>Temporary password<input required minLength={12} type="password" autoComplete="new-password" value={resetDraft.password} onChange={(event) => setResetDraft((draft) => ({ ...draft, password: event.target.value }))} /></label>
        <label>Confirm temporary password<input required minLength={12} type="password" autoComplete="new-password" value={resetDraft.confirm} onChange={(event) => setResetDraft((draft) => ({ ...draft, confirm: event.target.value }))} /></label>
      </div>
      <footer><button type="button" onClick={closeEditor}>Cancel</button><button type="submit" className="is-primary" disabled={busy}><KeyRound size={15} />{busy ? "Resetting…" : "Reset password"}</button></footer>
    </form> : null}

    {message ? <p className="account-form__message user-management__message" role="status">{message}</p> : null}

    <div className="user-management__list" aria-label="Workspace users">
      {busy && !users.length ? <p className="ops-empty">Loading users…</p> : users.map((user) => <article key={user.id} className={`user-management__row${user.status === "suspended" ? " is-suspended" : ""}`} data-user-row={user.id}>
        <span className="user-management__avatar" aria-hidden="true">{user.displayName.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase()}</span>
        <div className="user-management__identity"><strong>{user.displayName}</strong><span>{user.email}</span><small>{user.title || "No title"}</small></div>
        <div className="user-management__role"><span className="if-badge if-badge--info if-badge--sm">{user.role}</span><small>{roleDescription(user.roleId)}</small></div>
        <div className="user-management__access"><strong>{user.status === "active" ? "Active" : "Suspended"}</strong><span>{user.activeSessions} active session{user.activeSessions === 1 ? "" : "s"}</span><small>Last sign-in: {dateTime(user.lastLoginAt)}</small></div>
        <div className="user-management__actions">
          {user.isOwner ? <span className="user-management__owner"><ShieldCheck size={15} />Permanent owner</span> : <>
            <button type="button" onClick={() => openEdit(user)} disabled={busy}><Pencil size={14} />Edit</button>
            <button type="button" onClick={() => openReset(user)} disabled={busy}><KeyRound size={14} />Reset</button>
            <button type="button" className={user.status === "active" ? "is-danger" : ""} onClick={() => void toggleStatus(user)} disabled={busy}>{user.status === "active" ? <UserX size={14} /> : <UserCheck size={14} />}{user.status === "active" ? "Suspend" : "Reactivate"}</button>
          </>}
        </div>
      </article>)}
      {!busy && !users.length ? <div className="ops-empty"><UsersRound size={22} /><strong>No workspace users</strong></div> : null}
    </div>
  </section>;
}
