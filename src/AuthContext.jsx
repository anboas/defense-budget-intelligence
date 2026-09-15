import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { LockKeyhole, UserPlus } from "lucide-react";
import { authApi, isKnownStaticHost } from "./auth-client.js";
import ProductMark from "./ProductMark.jsx";
import WorkspaceMark from "./WorkspaceMark.jsx";

const AuthContext = createContext(null);

export function useAuth() {
  return useContext(AuthContext);
}

function AccountGate({ mode, onSubmit, onRegister, registrationEnabled, busy, error }) {
  const [screen, setScreen] = useState(mode);
  const setup = screen === "setup";
  const register = screen === "register";
  const identity = setup || register;
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [title, setTitle] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const mismatch = identity && confirm && password !== confirm;

  return (
    <main className="account-gate" data-account-gate={screen}>
      <section className="account-gate__card" aria-labelledby="account-gate-title">
        <span className="account-gate__mark" aria-hidden="true"><ProductMark eager /></span>
        <p className="account-gate__eyebrow">Defense Budget & Spend Analytics</p>
        <h1 id="account-gate-title">{setup ? "Create the super-user account" : register ? "Create your account" : "Sign in"}</h1>
        <p>{setup ? "The first account created owns this workspace and can manage its profile and access." : register ? "Create an account, then request access to the workspace you need." : "Use your account to continue."}</p>
        <form onSubmit={(event) => {
          event.preventDefault();
          if (mismatch) return;
          (register ? onRegister : onSubmit)({ email, displayName, title, password });
        }}>
          {identity ? <label>Display name<input required minLength={2} autoComplete="name" value={displayName} onChange={(event) => setDisplayName(event.target.value)} /></label> : null}
          <label>Email<input required type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} /></label>
          {identity ? <label>Title <span>(optional)</span><input autoComplete="organization-title" value={title} onChange={(event) => setTitle(event.target.value)} /></label> : null}
          <label>Password<input required minLength={12} type="password" autoComplete={identity ? "new-password" : "current-password"} value={password} onChange={(event) => setPassword(event.target.value)} /></label>
          {identity ? <label>Confirm password<input required minLength={12} type="password" autoComplete="new-password" value={confirm} onChange={(event) => setConfirm(event.target.value)} /></label> : null}
          {mismatch ? <p className="account-form__error" role="alert">Passwords do not match.</p> : null}
          {error ? <p className="account-form__error" role="alert">{error}</p> : null}
          <button type="submit" disabled={busy || mismatch}>{register ? <UserPlus size={17} /> : <LockKeyhole size={17} />}{busy ? "Working…" : setup ? "Create super-user account" : register ? "Create account" : "Sign in"}</button>
          {!setup && registrationEnabled ? <button className="account-gate__alternate" type="button" onClick={() => { setScreen(register ? "login" : "register"); setPassword(""); setConfirm(""); }} disabled={busy}>{register ? "Already have an account? Sign in" : "New here? Create an account"}</button> : null}
        </form>
      </section>
    </main>
  );
}

function WorkspaceAccessGate({ auth }) {
  const [workspaces, setWorkspaces] = useState([]);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    auth.listWorkspaces().then((result) => { if (active) setWorkspaces(result.workspaces || []); })
      .catch((requestError) => { if (active) setMessage(requestError.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [auth]);
  async function requestAccess(workspace) {
    setMessage("");
    try {
      await auth.requestWorkspaceAccess(workspace.id);
      setWorkspaces((current) => current.map((item) => item.id === workspace.id ? { ...item, requestStatus: "pending" } : item));
      setMessage(`Access request sent to ${workspace.name}.`);
    } catch (requestError) { setMessage(requestError.message); }
  }
  return <main className="account-gate" data-account-gate="workspace-access">
    <section className="account-gate__card account-gate__card--workspace" aria-labelledby="workspace-access-title">
      <span className="account-gate__mark" aria-hidden="true"><ProductMark eager /></span>
      <p className="account-gate__eyebrow">Workspace access</p>
      <h1 id="workspace-access-title">Choose a workspace</h1>
      <p>Your account is ready. Request access below and the Super user will review it.</p>
      <div className="workspace-access-list">{loading ? <p>Loading workspaces…</p> : workspaces.map((workspace) => <article key={workspace.id}>
        <span><WorkspaceMark workspace={workspace} /></span>
        <div><strong>{workspace.name}</strong><small>{workspace.description || "Shared intelligence workspace"}</small></div>
        {workspace.roleId ? <button type="button" onClick={() => void auth.switchWorkspace(workspace.id)}>Open</button> : workspace.requestStatus === "pending" ? <b>Pending</b> : <button type="button" onClick={() => void requestAccess(workspace)}>Request access</button>}
      </article>)}</div>
      {message ? <p className="account-form__message" role="status">{message}</p> : null}
      <div className="workspace-access-actions"><button type="button" onClick={() => void auth.listWorkspaces().then((result) => { setWorkspaces(result.workspaces || []); setMessage("Access status refreshed."); }).catch((requestError) => setMessage(requestError.message))}>Refresh access</button><button className="account-gate__alternate" type="button" onClick={() => void auth.logout()}>Sign out</button></div>
    </section>
  </main>;
}

function PasswordChangeGate({ user, onSubmit, busy, error }) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const mismatch = confirm && newPassword !== confirm;
  return (
    <main className="account-gate" data-account-gate="password-change">
      <section className="account-gate__card" aria-labelledby="account-gate-title">
        <span className="account-gate__mark" aria-hidden="true"><ProductMark eager /></span>
        <p className="account-gate__eyebrow">Defense Budget & Spend Analytics</p>
        <h1 id="account-gate-title">Set your password</h1>
        <p>Your administrator issued a temporary password. Replace it before entering the workspace.</p>
        <form onSubmit={(event) => {
          event.preventDefault();
          if (mismatch) return;
          onSubmit({ email: user.email, currentPassword, newPassword });
        }}>
          <label>Temporary password<input required minLength={12} type="password" autoComplete="current-password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} /></label>
          <label>New password<input required minLength={12} type="password" autoComplete="new-password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} /></label>
          <label>Confirm new password<input required minLength={12} type="password" autoComplete="new-password" value={confirm} onChange={(event) => setConfirm(event.target.value)} /></label>
          {mismatch ? <p className="account-form__error" role="alert">Passwords do not match.</p> : null}
          {error ? <p className="account-form__error" role="alert">{error}</p> : null}
          <button type="submit" disabled={busy || mismatch}><LockKeyhole size={17} />{busy ? "Updating…" : "Set password and continue"}</button>
        </form>
      </section>
    </main>
  );
}

export default function AuthProvider({ children }) {
  const [status, setStatus] = useState(() => (
    isKnownStaticHost()
      ? { loading: false, staticHost: true, enabled: false, required: false, claimed: false, user: null }
      : { loading: true, staticHost: false, enabled: false, required: false, claimed: false, user: null }
  ));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (isKnownStaticHost()) return undefined;
    let active = true;
    authApi.status().then((next) => { if (active) setStatus({ loading: false, staticHost: false, ...next }); })
      .catch((requestError) => {
        if (!active) return;
        if (requestError.staticHost) setStatus({ loading: false, staticHost: true, enabled: false, required: false, claimed: false, user: null });
        else {
          setError(requestError.message);
          setStatus({ loading: false, staticHost: false, enabled: true, required: true, claimed: true, user: null });
        }
      });
    return () => { active = false; };
  }, []);

  const run = async (operation) => {
    setBusy(true);
    setError("");
    try {
      const result = await operation();
      setStatus((current) => ({ ...current, claimed: true, user: result.user || current.user }));
      return result;
    } catch (operationError) {
      setError(operationError.message);
      throw operationError;
    } finally {
      setBusy(false);
    }
  };

  const value = useMemo(() => ({
    ...status,
    busy,
    error,
    claim: (values) => run(() => authApi.claim(values)),
    register: (values) => run(() => authApi.register(values)),
    login: (values) => run(() => authApi.login(values)),
    logout: async () => { await authApi.logout(); setStatus((current) => ({ ...current, user: null })); },
    updateProfile: async (values) => { const result = await authApi.updateProfile(values); setStatus((current) => ({ ...current, user: result.user })); return result; },
    changePassword: async (values) => { const result = await authApi.changePassword(values); setStatus((current) => ({ ...current, user: result.user })); return result; },
    listAgentKeys: () => authApi.listAgentKeys(),
    createAgentKey: (values) => authApi.createAgentKey(values),
    revokeAgentKey: (id) => authApi.revokeAgentKey(id),
    listUsers: () => authApi.listUsers(),
    listDirectory: () => authApi.listDirectory(),
    listWorkspaces: () => authApi.listWorkspaces(),
    requestWorkspaceAccess: (workspaceId, note) => authApi.requestWorkspaceAccess(workspaceId, note),
    switchWorkspace: async (workspaceId) => { const result = await authApi.switchWorkspace(workspaceId); setStatus((current) => ({ ...current, user: result.user })); window.location.reload(); return result; },
    getWorkspaceAdmin: () => authApi.getWorkspaceAdmin(),
    createWorkspace: (values) => authApi.createWorkspace(values),
    updateWorkspace: async (workspaceId, values) => {
      const result = await authApi.updateWorkspace(workspaceId, values);
      setStatus((current) => {
        const update = (workspace) => String(workspace?.id || "") === String(workspaceId) ? { ...workspace, ...result.workspace } : workspace;
        return { ...current, user: current.user ? {
          ...current.user,
          workspaces: (current.user.workspaces || []).map(update),
          activeWorkspace: update(current.user.activeWorkspace),
        } : current.user };
      });
      return result;
    },
    resolveWorkspaceRequest: (requestId, values) => authApi.resolveWorkspaceRequest(requestId, values),
    addWorkspaceMember: (workspaceId, values) => authApi.addWorkspaceMember(workspaceId, values),
    removeWorkspaceMember: (workspaceId, userId) => authApi.removeWorkspaceMember(workspaceId, userId),
    createUser: (values) => authApi.createUser(values),
    updateUser: (id, values) => authApi.updateUser(id, values),
    resetUserPassword: (id, password) => authApi.resetUserPassword(id, password),
    clearError: () => setError(""),
  }), [status, busy, error]);

  if (status.loading) return <main className="account-gate account-gate--loading" role="status">
    <span className="account-gate__loading-mark" aria-hidden="true">
      <span className="account-gate__mark"><ProductMark eager /></span>
    </span>
    <h1>Loading workspace</h1>
    <span className="account-gate__loading-dots" aria-hidden="true"><i /><i /><i /></span>
  </main>;
  if (status.enabled && status.required && !status.claimed) return <AccountGate mode="setup" busy={busy} error={error} onSubmit={(values) => void value.claim(values).catch(() => {})} />;
  if (status.enabled && status.required && !status.user) return <AccountGate mode="login" registrationEnabled={status.registrationEnabled} busy={busy} error={error} onSubmit={(values) => void value.login(values).catch(() => {})} onRegister={(values) => void value.register(values).catch(() => {})} />;
  if (status.enabled && status.user?.mustChangePassword) return <PasswordChangeGate user={status.user} busy={busy} error={error} onSubmit={(values) => void run(() => authApi.changePassword(values)).catch(() => {})} />;
  if (status.enabled && status.required && status.user && !status.user.hasWorkspaceAccess) return <AuthContext.Provider value={value}><WorkspaceAccessGate auth={value} /></AuthContext.Provider>;
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
