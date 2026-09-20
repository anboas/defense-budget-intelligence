import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { LockKeyhole, UserPlus } from "lucide-react";
import { ControlAsyncState } from "control-surface-ui/react";
import { authApi, isKnownStaticHost } from "./auth-client.js";
import ProductMark from "./ProductMark.jsx";
import WorkspaceMark from "./WorkspaceMark.jsx";

const AuthContext = createContext(null);
const MANAGEMENT_STATE_EVENT = "dbi:management-state-changed";

function notifyManagementStateChanged() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(MANAGEMENT_STATE_EVENT));
}

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
  const [inviteCode, setInviteCode] = useState("");
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
          (register ? onRegister : onSubmit)({ email, displayName, title, password, inviteCode });
        }}>
          {identity ? <label className="if-field"><span className="if-field__label">Display name</span><input className="if-input" required minLength={2} autoComplete="name" value={displayName} onChange={(event) => setDisplayName(event.target.value)} /></label> : null}
          <label className="if-field"><span className="if-field__label">Email</span><input className="if-input" required type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} /></label>
          {identity ? <label className="if-field"><span className="if-field__label">Title <span className="if-field__hint">(optional)</span></span><input className="if-input" autoComplete="organization-title" value={title} onChange={(event) => setTitle(event.target.value)} /></label> : null}
          {register ? <label className="if-field"><span className="if-field__label">Invite code</span><input className="if-input" required minLength={24} autoComplete="one-time-code" spellCheck="false" value={inviteCode} onChange={(event) => setInviteCode(event.target.value.toUpperCase())} /></label> : null}
          <label className="if-field"><span className="if-field__label">Password</span><input className="if-input" required minLength={12} type="password" autoComplete={identity ? "new-password" : "current-password"} value={password} onChange={(event) => setPassword(event.target.value)} /></label>
          {identity ? <label className="if-field"><span className="if-field__label">Confirm password</span><input className="if-input" required minLength={12} type="password" autoComplete="new-password" value={confirm} onChange={(event) => setConfirm(event.target.value)} /></label> : null}
          {mismatch ? <p className="if-alert if-alert--danger account-form__error" role="alert">Passwords do not match.</p> : null}
          {error ? <p className="if-alert if-alert--danger account-form__error" role="alert">{error}</p> : null}
          <button className="if-btn if-btn--primary" type="submit" disabled={busy || mismatch}>{register ? <UserPlus size={17} /> : <LockKeyhole size={17} />}{busy ? "Working…" : setup ? "Create super-user account" : register ? "Create account" : "Sign in"}</button>
          {!setup && registrationEnabled ? <button className="if-btn if-btn--ghost account-gate__alternate" type="button" onClick={() => { setScreen(register ? "login" : "register"); setPassword(""); setConfirm(""); setInviteCode(""); }} disabled={busy}>{register ? "Already have an account? Sign in" : "Have an invite? Create an account"}</button> : null}
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
      <div className="if-action-row-list workspace-access-list">{loading ? <ControlAsyncState compact state="loading" title="Loading workspaces" message="Reading available workspace boundaries and your access status." /> : workspaces.length ? workspaces.map((workspace) => <article className="if-action-row" key={workspace.id}>
        <span className="workspace-access-list__mark"><WorkspaceMark workspace={workspace} /></span>
        <span><strong>{workspace.name}</strong><em>{workspace.description || "Shared intelligence workspace"}</em></span>
        {workspace.requestStatus === "pending" ? <span className="if-badge if-badge--warning">Pending</span> : null}
        <span className="if-action-row__actions">{workspace.roleId ? <button type="button" className="if-btn if-btn--primary if-btn--sm" onClick={() => void auth.switchWorkspace(workspace.id)}>Open</button> : workspace.requestStatus === "pending" ? null : <button type="button" className="if-btn if-btn--secondary if-btn--sm" onClick={() => void requestAccess(workspace)}>Request access</button>}</span>
      </article>) : <ControlAsyncState compact state="empty" title="No workspaces available" message="No workspace is currently available for access requests. Ask the platform owner to create one." />}</div>
      {message ? <p className="if-alert if-alert--info account-form__message" role="status">{message}</p> : null}
      <div className="workspace-access-actions"><button className="if-btn if-btn--secondary" type="button" onClick={() => void auth.listWorkspaces().then((result) => { setWorkspaces(result.workspaces || []); setMessage("Access status refreshed."); }).catch((requestError) => setMessage(requestError.message))}>Refresh access</button><button className="if-btn if-btn--ghost" type="button" onClick={() => void auth.logout()}>Sign out</button></div>
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
          <label className="if-field"><span className="if-field__label">Temporary password</span><input className="if-input" required minLength={12} type="password" autoComplete="current-password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} /></label>
          <label className="if-field"><span className="if-field__label">New password</span><input className="if-input" required minLength={12} type="password" autoComplete="new-password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} /></label>
          <label className="if-field"><span className="if-field__label">Confirm new password</span><input className="if-input" required minLength={12} type="password" autoComplete="new-password" value={confirm} onChange={(event) => setConfirm(event.target.value)} /></label>
          {mismatch ? <p className="if-alert if-alert--danger account-form__error" role="alert">Passwords do not match.</p> : null}
          {error ? <p className="if-alert if-alert--danger account-form__error" role="alert">{error}</p> : null}
          <button className="if-btn if-btn--primary" type="submit" disabled={busy || mismatch}><LockKeyhole size={17} />{busy ? "Updating…" : "Set password and continue"}</button>
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
    listSessions: () => authApi.listSessions(),
    revokeSession: (id) => authApi.revokeSession(id),
    revokeOtherSessions: () => authApi.revokeOtherSessions(),
    updateProfile: async (values) => { const result = await authApi.updateProfile(values); setStatus((current) => ({ ...current, user: result.user })); return result; },
    changePassword: async (values) => { const result = await authApi.changePassword(values); setStatus((current) => ({ ...current, user: result.user })); return result; },
    listAgentKeys: () => authApi.listAgentKeys(),
    createAgentKey: (values) => authApi.createAgentKey(values),
    revokeAgentKey: (id) => authApi.revokeAgentKey(id),
    listUsers: () => authApi.listUsers(),
    getRegistrationAdministration: () => authApi.getRegistrationAdministration(),
    updateRegistrationPolicy: (mode) => authApi.updateRegistrationPolicy(mode),
    createRegistrationInvite: (values) => authApi.createRegistrationInvite(values),
    revokeRegistrationInvite: (id) => authApi.revokeRegistrationInvite(id),
    listUserActivity: () => authApi.listUserActivity(),
    recordPageVisit: (surface) => authApi.recordPageVisit(surface),
    listDirectory: () => authApi.listDirectory(),
    listWorkspaces: () => authApi.listWorkspaces(),
    requestWorkspaceAccess: (workspaceId, note) => authApi.requestWorkspaceAccess(workspaceId, note),
    switchWorkspace: async (workspaceId) => { const result = await authApi.switchWorkspace(workspaceId); setStatus((current) => ({ ...current, user: result.user })); window.location.reload(); return result; },
    startEmulation: async (userId) => { const result = await authApi.startEmulation(userId); setStatus((current) => ({ ...current, user: result.user })); window.location.reload(); return result; },
    stopEmulation: async () => { const result = await authApi.stopEmulation(); setStatus((current) => ({ ...current, user: result.user })); window.location.reload(); return result; },
    listTeams: () => authApi.listTeams(),
    createTeam: async (values) => { const result = await authApi.createTeam(values); notifyManagementStateChanged(); return result; },
    updateTeam: async (id, values) => { const result = await authApi.updateTeam(id, values); notifyManagementStateChanged(); return result; },
    updateTeamMembers: async (id, userIds) => { const result = await authApi.updateTeamMembers(id, userIds); notifyManagementStateChanged(); return result; },
    deleteTeam: async (id) => { const result = await authApi.deleteTeam(id); notifyManagementStateChanged(); return result; },
    getWorkspaceAdmin: () => authApi.getWorkspaceAdmin(),
    getSaasControlPlane: () => authApi.getSaasControlPlane(),
    createCommercialOrganization: (values) => authApi.createCommercialOrganization(values),
    updateCommercialOrganization: (id, values) => authApi.updateCommercialOrganization(id, values),
    updateCommercialEntitlements: (id, values) => authApi.updateCommercialEntitlements(id, values),
    updateCommercialOnboarding: (id, stepKey, values) => authApi.updateCommercialOnboarding(id, stepKey, values),
    createCommercialServiceRequest: (id, values) => authApi.createCommercialServiceRequest(id, values),
    updateCommercialServiceRequest: (id, requestId, values) => authApi.updateCommercialServiceRequest(id, requestId, values),
    createWorkspace: async (values) => {
      const result = await authApi.createWorkspace(values);
      setStatus((current) => ({ ...current, user: current.user ? {
        ...current.user,
        workspaces: [...(current.user.workspaces || []), result.workspace].sort((left, right) => left.name.localeCompare(right.name)),
      } : current.user }));
      return result;
    },
    updateWorkspace: async (workspaceId, values) => {
      const result = await authApi.updateWorkspace(workspaceId, values);
      setStatus((current) => {
        const update = (workspace) => {
          if (String(workspace?.id || "") !== String(workspaceId)) return workspace;
          return {
            ...workspace,
            ...result.workspace,
            roleId: result.workspace.roleId || workspace.roleId,
            role: result.workspace.role || workspace.role,
          };
        };
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
    listOpenAiKeys: () => authApi.listOpenAiKeys(),
    createOpenAiKey: (values) => authApi.createOpenAiKey(values),
    updateOpenAiKey: (id, values) => authApi.updateOpenAiKey(id, values),
    revokeOpenAiKey: (id) => authApi.revokeOpenAiKey(id),
    listProviderCredentials: (provider) => authApi.listProviderCredentials(provider),
    createProviderCredential: (provider, values) => authApi.createProviderCredential(provider, values),
    revokeProviderCredential: (provider, id) => authApi.revokeProviderCredential(provider, id),
    getAcquisitionStatus: () => authApi.getAcquisitionStatus(),
    getAcquisitionConfig: () => authApi.getAcquisitionConfig(),
    updateAcquisitionConfig: (values) => authApi.updateAcquisitionConfig(values),
    refreshAcquisitionSource: (trigger) => authApi.refreshAcquisitionSource(trigger),
    listAcquisitionRecords: (values) => authApi.listAcquisitionRecords(values),
    listAcquisitionSavedViews: () => authApi.listAcquisitionSavedViews(),
    createAcquisitionSavedView: (values) => authApi.createAcquisitionSavedView(values),
    updateAcquisitionSavedView: (id, values) => authApi.updateAcquisitionSavedView(id, values),
    deleteAcquisitionSavedView: (id) => authApi.deleteAcquisitionSavedView(id),
    getAcquisitionDeliveryPreferences: () => authApi.getAcquisitionDeliveryPreferences(),
    updateAcquisitionDeliveryPreferences: (values) => authApi.updateAcquisitionDeliveryPreferences(values),
    getAcquisitionOperations: () => authApi.getAcquisitionOperations(),
    updateAcquisitionDeliveryJob: (id, action) => authApi.updateAcquisitionDeliveryJob(id, action),
    getAcquisitionEmailProvider: () => authApi.getAcquisitionEmailProvider(),
    saveAcquisitionEmailProvider: (values) => authApi.saveAcquisitionEmailProvider(values),
    revokeAcquisitionEmailProvider: () => authApi.revokeAcquisitionEmailProvider(),
    verifyAcquisitionEmailProvider: () => authApi.verifyAcquisitionEmailProvider(),
    testAcquisitionEmailProvider: () => authApi.testAcquisitionEmailProvider(),
    updateOperationalIncident: (id, action) => authApi.updateOperationalIncident(id, action),
    getEventAiCapability: () => authApi.getEventAiCapability(),
    listEventAiModels: (values) => authApi.listEventAiModels(values),
    saveEventAiModelDefaults: (values) => authApi.saveEventAiModelDefaults(values),
    listEventAiJobs: () => authApi.listEventAiJobs(),
    startEventAiJob: (values) => authApi.startEventAiJob(values),
    getEventAiJob: (id) => authApi.getEventAiJob(id),
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
  return <AuthContext.Provider value={value}>{status.user?.isEmulating ? <div className="emulation-banner" role="status" data-emulation-banner><span><strong>Viewing as {status.user.displayName}</strong><small>Signed in as {status.user.actor?.displayName || "Super user"}. Permissions and team visibility match this user.</small></span><button type="button" className="if-btn if-btn--primary if-btn--sm" onClick={() => void value.stopEmulation().catch(() => {})} disabled={busy}>Exit view</button></div> : null}{children}</AuthContext.Provider>;
}
