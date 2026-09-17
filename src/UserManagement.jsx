import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, Eye, KeyRound, Pencil, ShieldCheck, UserCheck, UserPlus, UsersRound, UserX } from "lucide-react";
import UserAvatar from "./UserAvatar.jsx";
import ControlSelect from "./ControlSelect.jsx";
import { ControlAsyncState, ControlDialog, ControlMetricStrip, ControlPageBody, ControlPageHeader, useToast } from "control-surface-ui/react";

const ROLE_LABELS = {
  administrator: "Workspace manager",
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
  const dialogRef = useRef(null);
  const { showToast } = useToast();

  const notify = useCallback((title, text, tone = "success") => {
    showToast({ tone, title, message: text });
  }, [showToast]);

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
    }).catch((error) => notify("Users unavailable", error.message, "danger")).finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [auth, notify]);

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
      notify("User created", "Share the temporary password through a secure channel; the user must replace it at first sign-in.");
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
      notify("User updated", `${editDraft.displayName}'s account changes are active.`);
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
      notify(status === "suspended" ? "User suspended" : "User reactivated", status === "suspended" ? `${user.displayName}'s active sessions were revoked.` : `${user.displayName} can sign in again.`);
    } catch (error) { notify("User status unchanged", error.message, "danger"); }
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
      notify("Temporary password set", "Existing sessions were revoked and the user must replace it at next sign-in.");
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
    <ControlPageHeader compact divided eyebrow="Platform administration" title="Users" summary="Human accounts, least-privilege roles, status, sessions, and password recovery." headingLevel={2} titleId="user-management-title" actions={<button type="button" className="if-btn if-btn--primary" onClick={() => { setMode("create"); setSelectedId(""); setMessage(""); }} disabled={busy}><UserPlus size={15} />Add user</button>} />
    <ControlPageBody compact>

    <ControlMetricStrip label="User access summary" items={[
      { id: "total", label: "Total users", value: users.length },
      { id: "active", label: "Active", value: activeCount, tone: "success" },
      { id: "managers", label: "Managers", value: adminCount, tone: "info" },
      { id: "sessions", label: "Sessions", value: sessionCount, tone: "purple" },
    ]} />

    {mode === "create" ? <ControlDialog open onClose={closeEditor} title="Add user" eyebrow="Platform administration" summary="Create an account with a temporary password that must be replaced at first sign-in." size="wide" dialogRef={dialogRef} surfaceProps={{ "data-user-create": true }} footer={<><button type="button" className="if-btn" onClick={closeEditor}>Cancel</button><button type="submit" form="user-create-form" className="if-btn if-btn--primary" disabled={busy}><UserPlus size={15} />{busy ? "Creating…" : "Create user"}</button></>}><form id="user-create-form" className="user-management__editor if-form-grid" onSubmit={createUser}>
      <div className="user-management__form-grid">
        <label>Display name<input required minLength={2} autoComplete="off" value={createDraft.displayName} onChange={(event) => setCreateDraft((draft) => ({ ...draft, displayName: event.target.value }))} /></label>
        <label>Email<input required type="email" autoComplete="off" value={createDraft.email} onChange={(event) => setCreateDraft((draft) => ({ ...draft, email: event.target.value }))} /></label>
        <label>Title <span>(optional)</span><input autoComplete="off" value={createDraft.title} onChange={(event) => setCreateDraft((draft) => ({ ...draft, title: event.target.value }))} /></label>
        <div className="user-management__field"><span>Role</span><ControlSelect ariaLabel="New user role" value={createDraft.role} options={orderedRoles.map((role) => [role, ROLE_LABELS[role]])} onChange={(role) => setCreateDraft((draft) => ({ ...draft, role }))} portalTarget={dialogRef} /><small>{roleDescription(createDraft.role)}</small></div>
        <label>Temporary password<input required minLength={12} type="password" autoComplete="new-password" value={createDraft.password} onChange={(event) => setCreateDraft((draft) => ({ ...draft, password: event.target.value }))} /></label>
        <label>Confirm temporary password<input required minLength={12} type="password" autoComplete="new-password" value={createDraft.confirm} onChange={(event) => setCreateDraft((draft) => ({ ...draft, confirm: event.target.value }))} /></label>
      </div>
      {message ? <p className="if-alert if-alert--danger account-form__message" role="alert">{message}</p> : null}
    </form></ControlDialog> : null}

    {mode === "edit" && selected && editDraft ? <ControlDialog open onClose={closeEditor} title={`Edit ${selected.displayName}`} eyebrow="Platform administration" summary="Identity and role changes apply to the next request." size="wide" dialogRef={dialogRef} surfaceProps={{ "data-user-edit": true }} footer={<><button type="button" className="if-btn" onClick={closeEditor}>Cancel</button><button type="submit" form="user-edit-form" className="if-btn if-btn--primary" disabled={busy}><Check size={15} />{busy ? "Saving…" : "Save user"}</button></>}><form id="user-edit-form" className="user-management__editor if-form-grid" onSubmit={saveUser}>
      <div className="user-management__form-grid">
        <label>Display name<input required minLength={2} value={editDraft.displayName} onChange={(event) => setEditDraft((draft) => ({ ...draft, displayName: event.target.value }))} /></label>
        <label>Email<input required type="email" value={editDraft.email} onChange={(event) => setEditDraft((draft) => ({ ...draft, email: event.target.value }))} /></label>
        <label>Title <span>(optional)</span><input value={editDraft.title} onChange={(event) => setEditDraft((draft) => ({ ...draft, title: event.target.value }))} /></label>
        <div className="user-management__field"><span>Role</span><ControlSelect ariaLabel="User role" value={editDraft.role} options={orderedRoles.map((role) => [role, ROLE_LABELS[role]])} onChange={(role) => setEditDraft((draft) => ({ ...draft, role }))} portalTarget={dialogRef} /><small>{roleDescription(editDraft.role)}</small></div>
      </div>
      {message ? <p className="if-alert if-alert--danger account-form__message" role="alert">{message}</p> : null}
    </form></ControlDialog> : null}

    {mode === "reset" && selected ? <ControlDialog open onClose={closeEditor} title={`Reset password for ${selected.displayName}`} eyebrow="Security action" summary="This immediately revokes every active session for this user." dialogRef={dialogRef} surfaceProps={{ "data-user-password-reset": true }} footer={<><button type="button" className="if-btn" onClick={closeEditor}>Cancel</button><button type="submit" form="user-reset-form" className="if-btn if-btn--primary" disabled={busy}><KeyRound size={15} />{busy ? "Resetting…" : "Reset password"}</button></>}><form id="user-reset-form" className="user-management__editor user-management__editor--reset if-form-grid" onSubmit={resetPassword}>
      <div className="user-management__form-grid">
        <label>Temporary password<input required minLength={12} type="password" autoComplete="new-password" value={resetDraft.password} onChange={(event) => setResetDraft((draft) => ({ ...draft, password: event.target.value }))} /></label>
        <label>Confirm temporary password<input required minLength={12} type="password" autoComplete="new-password" value={resetDraft.confirm} onChange={(event) => setResetDraft((draft) => ({ ...draft, confirm: event.target.value }))} /></label>
      </div>
      {message ? <p className="if-alert if-alert--danger account-form__message" role="alert">{message}</p> : null}
    </form></ControlDialog> : null}

    <div className="user-management__list" aria-label="Workspace users">
      {users.length ? <div className="user-management__list-header" aria-hidden="true"><span>User</span><span>Role</span><span>Access</span><span>Actions</span></div> : null}
      {busy && !users.length ? <ControlAsyncState compact state="loading" title="Loading users" message="Reading workspace accounts and active sessions." /> : users.map((user) => <article key={user.id} className={`user-management__row${user.status === "suspended" ? " is-suspended" : ""}`} data-user-row={user.id}>
        <UserAvatar user={user} className="user-management__avatar" />
        <div className="user-management__identity"><strong>{user.displayName}</strong><span>{user.email}</span><small>{user.title || "No title"}</small></div>
        <div className="user-management__role"><span className="if-badge if-badge--info if-badge--sm">{user.role}</span><small>{roleDescription(user.roleId)}</small></div>
        <div className="user-management__access"><span className={`if-status if-status--sm ${user.status === "active" ? "if-status--info" : "if-status--danger"}`}>{user.status === "active" ? "Active" : "Suspended"}</span><span>{user.activeSessions} active session{user.activeSessions === 1 ? "" : "s"}</span><small>Last sign-in: {dateTime(user.lastLoginAt)}</small></div>
        <div className="user-management__actions">
          {user.isOwner ? <span className="user-management__owner"><ShieldCheck size={15} />Permanent owner</span> : <>
            {auth.user?.roleId === "super_user" && user.status === "active" && !user.mustChangePassword ? <button type="button" className="if-btn if-btn--secondary if-btn--sm" onClick={() => void auth.startEmulation(user.id).catch((error) => notify("View unavailable", error.message, "danger"))} disabled={busy}><Eye size={14} />View as</button> : null}
            <button type="button" className="if-btn if-btn--secondary if-btn--sm" onClick={() => openEdit(user)} disabled={busy}><Pencil size={14} />Edit</button>
            <button type="button" className="if-btn if-btn--secondary if-btn--sm" onClick={() => openReset(user)} disabled={busy}><KeyRound size={14} />Reset</button>
            <button type="button" className={`if-btn if-btn--sm ${user.status === "active" ? "if-btn--danger" : "if-btn--secondary"}`} onClick={() => void toggleStatus(user)} disabled={busy}>{user.status === "active" ? <UserX size={14} /> : <UserCheck size={14} />}{user.status === "active" ? "Suspend" : "Reactivate"}</button>
          </>}
        </div>
      </article>)}
      {!busy && !users.length ? <ControlAsyncState compact state="empty" icon={<UsersRound size={22} />} title="No workspace users" message="Create the first managed account for this platform." action={<button type="button" className="if-btn if-btn--primary" onClick={() => setMode("create")}><UserPlus size={15} />Add user</button>} /> : null}
    </div>
    </ControlPageBody>
  </section>;
}
