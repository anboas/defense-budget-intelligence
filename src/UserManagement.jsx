import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Activity, Check, Eye, KeyRound, Pencil, RefreshCcw, ShieldCheck, UserCheck, UserPlus, UsersRound, UserX } from "lucide-react";
import UserAvatar from "./UserAvatar.jsx";
import ControlSelect from "./ControlSelect.jsx";
import { ControlAsyncState, ControlDialog, ControlIdentityLink, ControlMetricStrip, ControlPageBody, ControlPageHeader, ControlStatusBadge, useToast } from "control-surface-ui/react";
import { ACCESS_ROLES, WORKSPACE_ROLE_LABELS } from "./access-model.js";
import { workspaceMemberHref } from "./workspace-profile-routes.js";
import OperationalDataTable from "./OperationalDataTable.jsx";
import RegistrationManagement from "./RegistrationManagement.jsx";

const EMPTY_CREATE = { displayName: "", email: "", title: "", role: "analyst", password: "", confirm: "" };

function dateTime(value) {
  if (!value) return "Never";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Never" : date.toLocaleString([], { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
}

function roleDescription(role) {
  return ACCESS_ROLES[role]?.summary || "No access in the active workspace.";
}

const WORKSPACE_ACCESS_HREF = "#/budget-spend/workspace?workspaceSection=people";

function activityLabel(value) {
  return String(value || "Activity").replaceAll("_", " ").replace(/\b\w/g, (character) => character.toUpperCase());
}

function WorkspaceAccessLink({ onClick }) {
  return <a href={WORKSPACE_ACCESS_HREF} onClick={onClick}>Workspace Settings → Access</a>;
}

export default function UserManagement({ auth }) {
  const [users, setUsers] = useState([]);
  const [activities, setActivities] = useState([]);
  const [surface, setSurface] = useState(() => {
    if (typeof window === "undefined") return "accounts";
    const requested = new URLSearchParams(String(window.location.hash || "").split("?")[1] || "").get("accountsView");
    return ["activity", "invitations"].includes(requested) ? requested : "accounts";
  });
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
    const [result, activityResult] = await Promise.all([auth.listUsers(), auth.listUserActivity()]);
    setUsers(result.users || []);
    setRoles(result.availableRoles || []);
    setActivities(activityResult.activities || []);
  }

  useEffect(() => {
    let active = true;
    void Promise.all([auth.listUsers(), auth.listUserActivity()]).then(([result, activityResult]) => {
      if (!active) return;
      setUsers(result.users || []);
      setRoles(result.availableRoles || []);
      setActivities(activityResult.activities || []);
    }).catch((error) => notify("Users unavailable", error.message, "danger")).finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [auth, notify]);

  const selected = users.find((user) => user.id === selectedId);
  const activeCount = users.filter((user) => user.status === "active").length;
  const adminCount = users.filter((user) => ["super_user", "administrator"].includes(user.workspaceRoleId)).length;
  const sessionCount = users.reduce((total, user) => total + user.activeSessions, 0);
  const orderedRoles = useMemo(() => roles.filter((role) => WORKSPACE_ROLE_LABELS[role]), [roles]);
  const userNamesById = useMemo(() => new Map(users.map((user) => [user.id, user.displayName])), [users]);
  const pageVisitCount = activities.filter((entry) => entry.eventType === "page_visit").reduce((total, entry) => total + Number(entry.visitCount || 1), 0);
  const actionCount = activities.filter((entry) => entry.eventType === "action").length;
  const activeAccounts = new Set(activities.map((entry) => entry.effectiveUserId).filter(Boolean)).size;

  function selectSurface(nextSurface) {
    setSurface(nextSurface);
    const base = String(window.location.hash || "").split("?")[0] || "#/budget-spend/users";
    const params = new URLSearchParams(String(window.location.hash || "").split("?")[1] || "");
    if (["activity", "invitations"].includes(nextSurface)) params.set("accountsView", nextSurface);
    else params.delete("accountsView");
    window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}${base}${params.size ? `?${params.toString()}` : ""}`);
  }

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
      notify("Account created", "Share the temporary password through a secure channel; the user must replace it at first sign-in.");
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
      notify("Account updated", `${editDraft.displayName}'s identity changes are active.`);
    } catch (error) { setMessage(error.message); }
    finally { setBusy(false); }
  }

  async function toggleStatus(user) {
    const status = user.status === "active" ? "suspended" : "active";
    setBusy(true);
    setMessage("");
    try {
      await auth.updateUser(user.id, { email: user.email, displayName: user.displayName, title: user.title, status });
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
    setEditDraft({ email: user.email, displayName: user.displayName, title: user.title || "", status: user.status });
    setMode("edit");
    setMessage("");
  }

  function openReset(user) {
    setSelectedId(user.id);
    setResetDraft({ password: "", confirm: "" });
    setMode("reset");
    setMessage("");
  }

  const accountColumns = [
    { key: "account", label: "Account", required: true, sticky: true, minWidth: 260, mobilePrimary: true, value: (user) => [user.displayName, user.email, user.title], render: (user) => <span className="user-management__account-cell">{user.hasWorkspaceMembership ? <a href={workspaceMemberHref(user.id)} aria-label={`Open ${user.displayName} workspace profile`}><UserAvatar user={user} className="user-management__avatar" nativeTitle={false} /></a> : <UserAvatar user={user} className="user-management__avatar" nativeTitle={false} />}{user.hasWorkspaceMembership ? <ControlIdentityLink href={workspaceMemberHref(user.id)} name={user.displayName} detail={user.email} meta={user.title || "No title"} ariaLabel={`Open ${user.displayName} workspace profile`} /> : <span className="user-management__identity"><strong>{user.displayName}</strong><span>{user.email}</span><small>{user.title || "No title"}</small></span>}</span> },
    { key: "workspace", label: "Current workspace", minWidth: 250, value: (user) => user.hasWorkspaceMembership ? user.role : "No workspace access", render: (user) => <span className="user-management__role"><span className="if-badge if-badge--info if-badge--sm">{user.hasWorkspaceMembership ? user.role : "No workspace access"}</span><small>{user.hasWorkspaceMembership ? roleDescription(user.workspaceRoleId || user.roleId) : <>Grant access from <WorkspaceAccessLink />.</>}</small></span> },
    { key: "status", label: "Status", facet: true, minWidth: 130, value: (user) => user.status === "active" ? "Active" : "Suspended", render: (user) => <ControlStatusBadge status={user.status === "active" ? "active" : "blocked"} label={user.status === "active" ? "Active" : "Suspended"} /> },
    { key: "sessions", label: "Sessions", minWidth: 100, align: "right", value: (user) => user.activeSessions, render: (user) => `${user.activeSessions} active` },
    { key: "lastSignIn", label: "Last sign-in", minWidth: 180, value: (user) => user.lastLoginAt || "", render: (user) => dateTime(user.lastLoginAt) },
    { key: "actions", label: "Actions", role: "actions", sortable: false, required: true, value: () => "", render: (user) => <span className="user-management__actions">{user.isOwner ? <span className="user-management__owner"><ShieldCheck size={15} />Permanent owner</span> : <>{auth.user?.roleId === "super_user" && user.status === "active" ? <button type="button" className="if-btn if-btn--secondary if-btn--sm" onClick={() => void auth.startEmulation(user.id).catch((error) => notify("View unavailable", error.message, "danger"))} disabled={busy}><Eye size={14} />View as</button> : null}<button type="button" className="if-btn if-btn--secondary if-btn--sm" onClick={() => openEdit(user)} disabled={busy}><Pencil size={14} />Edit</button><button type="button" className="if-btn if-btn--secondary if-btn--sm" onClick={() => openReset(user)} disabled={busy}><KeyRound size={14} />Reset</button><button type="button" className={`if-btn if-btn--sm ${user.status === "active" ? "if-btn--danger" : "if-btn--secondary"}`} onClick={() => void toggleStatus(user)} disabled={busy}>{user.status === "active" ? <UserX size={14} /> : <UserCheck size={14} />}{user.status === "active" ? "Suspend" : "Reactivate"}</button></>}</span> },
  ];

  const activityColumns = [
    { key: "at", label: "Date & time", required: true, sticky: true, minWidth: 180, value: (entry) => entry.occurredAt, render: (entry) => dateTime(entry.occurredAt) },
    { key: "account", label: "Account", facet: true, facetAllLabel: "All accounts", minWidth: 180, value: (entry) => entry.effectiveUserName, render: (entry) => <span className="user-activity__account"><strong>{entry.effectiveUserName}</strong>{entry.actorUserId && entry.actorUserId !== entry.effectiveUserId ? <small>Actor: {entry.actorName}</small> : null}</span> },
    { key: "type", label: "Activity type", facet: true, minWidth: 130, value: (entry) => entry.eventType === "page_visit" ? "Page visit" : "Action", render: (entry) => <ControlStatusBadge status={entry.eventType === "page_visit" ? "info" : "completed"} label={entry.eventType === "page_visit" ? "Page visit" : "Action"} /> },
    { key: "action", label: "Action", facet: true, minWidth: 180, value: (entry) => activityLabel(entry.action) },
    { key: "surface", label: "Surface", facet: true, minWidth: 150, value: (entry) => activityLabel(entry.surface || "Unknown") },
    { key: "workspace", label: "Workspace", facet: true, minWidth: 170, value: (entry) => entry.workspaceName || "No workspace" },
    { key: "target", label: "Target", minWidth: 170, value: (entry) => [entry.targetType, entry.targetId, userNamesById.get(entry.targetId)], render: (entry) => entry.targetType ? <span className="user-activity__target"><strong>{activityLabel(entry.targetType)}</strong><small>{["user", "account"].includes(entry.targetType) ? userNamesById.get(entry.targetId) || "Account no longer available" : entry.targetId || "No identifier"}</small></span> : "—" },
    { key: "count", label: "Count", minWidth: 80, align: "right", value: (entry) => Number(entry.visitCount || 1), render: (entry) => Number(entry.visitCount || 1).toLocaleString() },
  ];

  return <section className="ops-panel user-management" data-user-management data-platform-accounts aria-labelledby="user-management-title">
    <ControlPageHeader compact divided eyebrow="Platform administration" title="Accounts" summary={<>Global identity, invitation-only registration, status, password recovery, and user emulation. Workspace roles live in <WorkspaceAccessLink />.</>} headingLevel={2} titleId="user-management-title" actions={surface === "accounts" ? <button type="button" className="if-btn if-btn--primary" onClick={() => { setMode("create"); setSelectedId(""); setMessage(""); }} disabled={busy}><UserPlus size={15} />Add account</button> : surface === "activity" ? <button type="button" className="if-btn if-btn--secondary" onClick={() => void refresh().catch((error) => notify("Activity unavailable", error.message, "danger"))} disabled={busy}><RefreshCcw size={15} />Refresh activity</button> : null} />
    <ControlPageBody compact>

    {surface !== "invitations" ? <ControlMetricStrip label={surface === "accounts" ? "User access summary" : "User activity summary"} items={surface === "accounts" ? [
      { id: "total", label: "Accounts", value: users.length },
      { id: "active", label: "Active", value: activeCount, tone: "success" },
      { id: "managers", label: "Managers", value: adminCount, tone: "info" },
      { id: "sessions", label: "Sessions", value: sessionCount, tone: "purple" },
    ] : [
      { id: "events", label: "Retained events", value: activities.length },
      { id: "visits", label: "Page visits", value: pageVisitCount, tone: "info" },
      { id: "actions", label: "Actions", value: actionCount, tone: "purple" },
      { id: "accounts", label: "Active accounts", value: activeAccounts, tone: "success" },
    ]} /> : null}

    <nav className="if-tabs__list user-management__tabs" aria-label="Platform account sections">
      <button type="button" className={`if-tab${surface === "accounts" ? " is-active" : ""}`} aria-pressed={surface === "accounts"} onClick={() => selectSurface("accounts")}>Accounts <span className="if-badge">{users.length}</span></button>
      <button type="button" className={`if-tab${surface === "invitations" ? " is-active" : ""}`} aria-pressed={surface === "invitations"} onClick={() => selectSurface("invitations")}>Invitations</button>
      <button type="button" className={`if-tab${surface === "activity" ? " is-active" : ""}`} aria-pressed={surface === "activity"} onClick={() => selectSurface("activity")}>Activity <span className="if-badge">{activities.length}</span></button>
    </nav>

    {surface === "accounts" && mode === "create" ? <ControlDialog open onClose={closeEditor} title="Add account" eyebrow="Platform administration" summary={<>Create a global account and grant its initial role in the active workspace. Future role changes belong in <WorkspaceAccessLink onClick={closeEditor} />.</>} size="wide" dialogRef={dialogRef} surfaceProps={{ "data-user-create": true }} footer={<><button type="button" className="if-btn" onClick={closeEditor}>Cancel</button><button type="submit" form="user-create-form" className="if-btn if-btn--primary" disabled={busy}><UserPlus size={15} />{busy ? "Creating…" : "Create account"}</button></>}><form id="user-create-form" className="user-management__editor if-form-grid" onSubmit={createUser}>
      <div className="user-management__form-grid">
        <label>Display name<input required minLength={2} autoComplete="off" value={createDraft.displayName} onChange={(event) => setCreateDraft((draft) => ({ ...draft, displayName: event.target.value }))} /></label>
        <label>Email<input required type="email" autoComplete="off" value={createDraft.email} onChange={(event) => setCreateDraft((draft) => ({ ...draft, email: event.target.value }))} /></label>
        <label>Title <span>(optional)</span><input autoComplete="off" value={createDraft.title} onChange={(event) => setCreateDraft((draft) => ({ ...draft, title: event.target.value }))} /></label>
        <div className="user-management__field"><span>Initial workspace role</span><ControlSelect ariaLabel="Initial workspace role" value={createDraft.role} options={orderedRoles.map((role) => [role, WORKSPACE_ROLE_LABELS[role]])} onChange={(role) => setCreateDraft((draft) => ({ ...draft, role }))} portalTarget={dialogRef} /><small>{roleDescription(createDraft.role)}</small></div>
        <label>Temporary password<input required minLength={12} type="password" autoComplete="new-password" value={createDraft.password} onChange={(event) => setCreateDraft((draft) => ({ ...draft, password: event.target.value }))} /></label>
        <label>Confirm temporary password<input required minLength={12} type="password" autoComplete="new-password" value={createDraft.confirm} onChange={(event) => setCreateDraft((draft) => ({ ...draft, confirm: event.target.value }))} /></label>
      </div>
      {message ? <p className="if-alert if-alert--danger account-form__message" role="alert">{message}</p> : null}
    </form></ControlDialog> : null}

    {surface === "accounts" && mode === "edit" && selected && editDraft ? <ControlDialog open onClose={closeEditor} title={`Edit ${selected.displayName}`} eyebrow="Platform account" summary={<>Update global identity or status. Change workspace access and roles from <WorkspaceAccessLink onClick={closeEditor} />.</>} size="wide" dialogRef={dialogRef} surfaceProps={{ "data-user-edit": true }} footer={<><button type="button" className="if-btn" onClick={closeEditor}>Cancel</button><button type="submit" form="user-edit-form" className="if-btn if-btn--primary" disabled={busy}><Check size={15} />{busy ? "Saving…" : "Save account"}</button></>}><form id="user-edit-form" className="user-management__editor if-form-grid" onSubmit={saveUser}>
      <div className="user-management__form-grid">
        <label>Display name<input required minLength={2} value={editDraft.displayName} onChange={(event) => setEditDraft((draft) => ({ ...draft, displayName: event.target.value }))} /></label>
        <label>Email<input required type="email" value={editDraft.email} onChange={(event) => setEditDraft((draft) => ({ ...draft, email: event.target.value }))} /></label>
        <label>Title <span>(optional)</span><input value={editDraft.title} onChange={(event) => setEditDraft((draft) => ({ ...draft, title: event.target.value }))} /></label>
      </div>
      {message ? <p className="if-alert if-alert--danger account-form__message" role="alert">{message}</p> : null}
    </form></ControlDialog> : null}

    {surface === "accounts" && mode === "reset" && selected ? <ControlDialog open onClose={closeEditor} title={`Reset password for ${selected.displayName}`} eyebrow="Security action" summary="This immediately revokes every active session for this user." dialogRef={dialogRef} surfaceProps={{ "data-user-password-reset": true }} footer={<><button type="button" className="if-btn" onClick={closeEditor}>Cancel</button><button type="submit" form="user-reset-form" className="if-btn if-btn--primary" disabled={busy}><KeyRound size={15} />{busy ? "Resetting…" : "Reset password"}</button></>}><form id="user-reset-form" className="user-management__editor user-management__editor--reset if-form-grid" onSubmit={resetPassword}>
      <div className="user-management__form-grid">
        <label>Temporary password<input required minLength={12} type="password" autoComplete="new-password" value={resetDraft.password} onChange={(event) => setResetDraft((draft) => ({ ...draft, password: event.target.value }))} /></label>
        <label>Confirm temporary password<input required minLength={12} type="password" autoComplete="new-password" value={resetDraft.confirm} onChange={(event) => setResetDraft((draft) => ({ ...draft, confirm: event.target.value }))} /></label>
      </div>
      {message ? <p className="if-alert if-alert--danger account-form__message" role="alert">{message}</p> : null}
    </form></ControlDialog> : null}

    {surface === "accounts" ? busy && !users.length ? <ControlAsyncState compact state="loading" title="Loading accounts" message="Reading platform identities, workspace access, sessions, and status." /> : users.length ? <OperationalDataTable
      id="platform-accounts"
      label="Platform accounts"
      rows={users}
      columns={accountColumns}
      rowKey={(user) => user.id}
      defaultSort={{ key: "account", direction: "asc" }}
      defaultPageSize={25}
      defaultMobilePageSize={5}
      searchPlaceholder="Search accounts, roles, status, and titles…"
      exportFilename="platform-accounts.csv"
      selectable={false}
      mobileColumns={["account", "workspace", "status", "actions"]}
      wrapperProps={{ "data-platform-accounts-table": true }}
    /> : <ControlAsyncState compact state="empty" icon={<UsersRound size={22} />} title="No managed accounts" message="Create the first managed account for this platform." action={<button type="button" className="if-btn if-btn--primary" onClick={() => setMode("create")}><UserPlus size={15} />Add account</button>} /> : null}

    {surface === "activity" ? busy && !activities.length ? <ControlAsyncState compact state="loading" title="Loading user activity" message="Reading retained page visits and account actions." /> : activities.length ? <OperationalDataTable
      id="platform-user-activity"
      label="Platform user activity"
      rows={activities}
      columns={activityColumns}
      rowKey={(entry) => entry.id}
      defaultSort={{ key: "at", direction: "desc" }}
      defaultPageSize={25}
      defaultMobilePageSize={5}
      searchPlaceholder="Search accounts, actions, surfaces, workspaces, and targets…"
      exportFilename="platform-user-activity.csv"
      selectable={false}
      mobileColumns={["at", "account", "type", "action", "surface", "count"]}
      wrapperProps={{ "data-platform-activity-table": true }}
    /> : <ControlAsyncState compact state="empty" icon={<Activity size={22} />} title="No user activity retained yet" message="Page visits and meaningful account actions will appear here as people use the application." /> : null}
    {surface === "invitations" ? <RegistrationManagement auth={auth} /> : null}
    </ControlPageBody>
  </section>;
}
