import { useEffect, useRef, useState } from "react";
import { Check, Clipboard, ImagePlus, KeyRound, Plus, Save, ShieldCheck, Trash2, UserRound } from "lucide-react";
import { useAuth } from "./AuthContext.jsx";
import UserAvatar from "./UserAvatar.jsx";
import OpenAiKeyManagement from "./OpenAiKeyManagement.jsx";
import { ControlAsyncState, ControlDialog, ControlIdentityEditor, ControlPageBody, ControlPageHeader, useToast } from "control-surface-ui/react";

const DEFAULT_AGENT_SCOPES = ["records:read", "tracking:read", "tracking:write", "events:read", "events:write", "activity:read", "integrations:read"];

async function squareAvatar(file) {
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
  for (const size of [112, 96, 80, 64]) {
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

function AccountPanel({ auth, user }) {
  const [displayName, setDisplayName] = useState(user.displayName);
  const [title, setTitle] = useState(user.title || "");
  const [avatarDataUrl, setAvatarDataUrl] = useState(user.avatarDataUrl || "");
  const [busy, setBusy] = useState(false);
  const { showToast } = useToast();

  async function save(event) {
    event.preventDefault();
    setBusy(true);
    try {
      await auth.updateProfile({ displayName, title, avatarDataUrl });
      showToast({ tone: "success", title: "Profile saved.", message: "Your updated identity is now shown across the workspace." });
    } catch (error) { showToast({ tone: "danger", title: "Profile not saved", message: error.message }); }
    finally { setBusy(false); }
  }

  return <section className="if-panel profile-page__panel" data-profile-account aria-labelledby="profile-account-title">
    <header className="if-panel__header profile-page__panel-header">
      <div>
        <h2 className="if-panel__title" id="profile-account-title">Identity</h2>
        <p className="if-panel__subtitle">Used in the header and shared workspace activity.</p>
      </div>
    </header>
    <form className="profile-page__form account-settings-form" onSubmit={save}>
      <div className="if-panel__body profile-page__panel-body">
        <ControlIdentityEditor
          compact
          avatar={<UserAvatar user={{ ...user, displayName, avatarDataUrl }} className="profile-avatar" />}
          title="Profile picture"
          summary="Square crop, optimized in your browser before upload."
          actions={<><label className="if-btn if-btn--sm" htmlFor="profile-avatar-file"><ImagePlus size={15} />{avatarDataUrl ? "Replace" : "Choose image"}</label><input id="profile-avatar-file" className="if-sr-only" type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => void squareAvatar(event.target.files?.[0]).then(setAvatarDataUrl).catch((imageError) => showToast({ tone: "danger", title: "Image not updated", message: imageError.message }))} />{avatarDataUrl ? <button className="if-btn if-btn--sm" type="button" onClick={() => setAvatarDataUrl("")}><Trash2 size={15} />Remove</button> : null}</>}
        />
        <div className="if-form-grid profile-page__form-grid">
          <label className="if-field">
            <span className="if-field__label">Display name</span>
            <input className="if-input" required minLength={2} autoComplete="name" value={displayName} onChange={(event) => setDisplayName(event.target.value)} />
          </label>
          <label className="if-field">
            <span className="if-field__label">Title <span className="if-field__hint">Optional</span></span>
            <input className="if-input" autoComplete="organization-title" value={title} onChange={(event) => setTitle(event.target.value)} />
          </label>
        </div>
        <div className="if-form-section-label">Account</div>
        <dl className="if-meta-grid if-meta-grid--dense profile-page__account-meta" data-profile-account-meta>
          <div className="if-kv"><dt>Email</dt><dd>{user.email}</dd></div>
          <div className="if-kv"><dt>Role</dt><dd>{user.role}</dd></div>
        </dl>
      </div>
      <footer className="if-panel__footer profile-page__panel-footer">
        <button className="if-btn if-btn--primary if-btn--sm" type="submit" disabled={busy}><Save size={15} />{busy ? "Saving…" : "Save profile"}</button>
      </footer>
    </form>
  </section>;
}

function SecurityPanel({ auth, user }) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const { showToast } = useToast();

  async function save(event) {
    event.preventDefault();
    if (newPassword !== confirm) { showToast({ tone: "danger", title: "Passwords do not match", message: "Enter the same new password in both fields." }); return; }
    setBusy(true);
    try {
      await auth.changePassword({ email: user.email, currentPassword, newPassword });
      setCurrentPassword("");
      setNewPassword("");
      setConfirm("");
      showToast({ tone: "success", title: "Password changed", message: "Every other active session was signed out." });
    } catch (error) { showToast({ tone: "danger", title: "Password not changed", message: error.message }); }
    finally { setBusy(false); }
  }

  return <section className="if-panel profile-page__panel" data-profile-security aria-labelledby="profile-security-title">
    <header className="if-panel__header profile-page__panel-header">
      <div>
        <h2 className="if-panel__title" id="profile-security-title">Password</h2>
        <p className="if-panel__subtitle">Changing it revokes every other active session.</p>
      </div>
    </header>
    <form className="profile-page__form account-settings-form" onSubmit={save}>
      <div className="if-panel__body profile-page__panel-body">
        <div className="if-form-grid profile-page__form-grid profile-page__form-grid--security">
          <label className="if-field if-field--full">
            <span className="if-field__label">Current password</span>
            <input className="if-input" required type="password" autoComplete="current-password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} />
          </label>
          <label className="if-field">
            <span className="if-field__label">New password</span>
            <input className="if-input" required minLength={12} type="password" autoComplete="new-password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} />
          </label>
          <label className="if-field">
            <span className="if-field__label">Confirm new password</span>
            <input className="if-input" required minLength={12} type="password" autoComplete="new-password" value={confirm} onChange={(event) => setConfirm(event.target.value)} />
          </label>
        </div>
      </div>
      <footer className="if-panel__footer profile-page__panel-footer">
        <button className="if-btn if-btn--primary if-btn--sm" type="submit" disabled={busy}><KeyRound size={15} />{busy ? "Updating…" : "Update password"}</button>
      </footer>
    </form>
  </section>;
}

export function AgentAccessPanel({ auth, embedded = false }) {
  const [keys, setKeys] = useState([]);
  const [scopes, setScopes] = useState([]);
  const [name, setName] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [selected, setSelected] = useState(DEFAULT_AGENT_SCOPES);
  const [createdToken, setCreatedToken] = useState("");
  const [copied, setCopied] = useState(false);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(true);
  const [adding, setAdding] = useState(false);
  const dialogRef = useRef(null);
  const { showToast } = useToast();

  useEffect(() => {
    let active = true;
    void auth.listAgentKeys().then((result) => {
      if (!active) return;
      setKeys(result.keys || []);
      setScopes(result.availableScopes || []);
    }).catch((error) => showToast({ tone: "danger", title: "Credentials unavailable", message: error.message })).finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [auth, showToast]);

  async function create(event) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      const result = await auth.createAgentKey({ name, scopes: selected, expiresAt: expiresAt ? new Date(expiresAt).toISOString() : "" });
      setKeys((current) => [result.key, ...current]);
      setCreatedToken(result.token);
      setCopied(false);
      setName("");
      setExpiresAt("");
    } catch (error) { setMessage(error.message); }
    finally { setBusy(false); }
  }

  async function revoke(id) {
    setBusy(true);
    try {
      await auth.revokeAgentKey(id);
      setKeys((current) => current.map((key) => key.id === id ? { ...key, revokedAt: new Date().toISOString() } : key));
      showToast({ tone: "success", title: "Credential revoked", message: "The agent can no longer use this credential." });
    } catch (error) { showToast({ tone: "danger", title: "Credential not revoked", message: error.message }); }
    finally { setBusy(false); }
  }

  function closeCreate() {
    setAdding(false);
    setCreatedToken("");
    setCopied(false);
    setMessage("");
  }

  return <section className={`${embedded ? "ops-panel" : "profile-page__panel profile-page__panel--wide"}`} data-profile-agents aria-labelledby="profile-agents-title">
    <ControlPageHeader compact divided eyebrow={embedded ? "Workspace administration" : "Account settings"} title="Agent access" summary="Issue and revoke narrowly scoped credentials for trusted agents." headingLevel={2} titleId="profile-agents-title" actions={keys.length ? <button type="button" className="if-btn if-btn--primary" disabled={busy} onClick={() => setAdding(true)}><Plus size={15} />Add credential</button> : null} />
    <ControlPageBody compact>
    <section className="if-analytics-panel if-analytics-panel--flat" aria-label="Agent credentials">
      <header className="if-analytics-panel__header"><div className="if-analytics-panel__heading"><h3 className="if-analytics-panel__title">Credentials</h3><p className="if-analytics-panel__summary">Narrowly scoped tokens for trusted automated clients.</p></div><strong className="if-analytics-panel__count">{keys.length}</strong></header>
      {busy && !keys.length ? <ControlAsyncState compact state="loading" title="Loading credentials" message="Reading the current workspace credential inventory." /> : keys.length ? <div className="if-action-row-list">{keys.map((key) => <article key={key.id} className={`if-action-row${key.revokedAt ? " is-revoked" : ""}`}><span className="if-icon-slot" aria-hidden="true"><KeyRound size={16} /></span><span><strong>{key.name}</strong><em>{key.scopes.join(" · ")}</em><small>{key.revokedAt ? `Revoked ${new Date(key.revokedAt).toLocaleString()}` : key.lastUsedAt ? `Last used ${new Date(key.lastUsedAt).toLocaleString()}` : "Never used"}</small></span><span className={`if-badge${key.revokedAt ? "" : " if-badge--info"}`}>{key.revokedAt ? "Revoked" : "Active"}</span>{!key.revokedAt ? <span className="if-action-row__actions"><button type="button" className="if-btn if-btn--secondary if-btn--sm" aria-label={`Revoke ${key.name}`} onClick={() => void revoke(key.id)}><Trash2 size={15} />Revoke</button></span> : null}</article>)}</div> : <ControlAsyncState compact state="empty" title="No agent credentials" message="Create a narrowly scoped credential when a trusted agent needs workspace access." action={<button type="button" className="if-btn if-btn--primary" onClick={() => setAdding(true)}><Plus size={15} />Add credential</button>} />}
    </section>
    {adding ? <ControlDialog open onClose={closeCreate} title={createdToken ? "Credential created" : "Add agent credential"} eyebrow="Workspace administration" summary={createdToken ? "This token is visible once. Store it now before closing." : "Choose only the scopes this agent needs."} size="wide" dialogRef={dialogRef} closeLabel="Close agent credential form" surfaceProps={{ "data-agent-key-dialog": true }} footer={createdToken ? <button type="button" className="if-btn if-btn--primary" onClick={closeCreate}>Done</button> : <><button type="button" className="if-btn" onClick={closeCreate}>Cancel</button><button type="submit" className="if-btn if-btn--primary" form="agent-key-create-form" disabled={busy || !selected.length}><Plus size={15} />{busy ? "Creating…" : "Create credential"}</button></>}>
      {createdToken ? <section className="agent-token-once" role="status"><strong>Copy this token now</strong><p>It cannot be retrieved again. Save it directly in the agent’s protected Secret Store, never in chat or source files.</p><code>{createdToken}</code><button type="button" onClick={() => void navigator.clipboard.writeText(createdToken).then(() => setCopied(true))}>{copied ? <Check size={15} /> : <Clipboard size={15} />}{copied ? "Copied" : "Copy token"}</button></section> : <form id="agent-key-create-form" className="if-form-grid" onSubmit={create}>
        <label className="if-field"><span className="if-field__label">Name</span><input className="if-input" required minLength={2} placeholder="Research agent" value={name} onChange={(event) => setName(event.target.value)} /></label><label className="if-field"><span className="if-field__label">Expires <span className="if-field__hint">Optional</span></span><input className="if-input" type="datetime-local" value={expiresAt} onChange={(event) => setExpiresAt(event.target.value)} /></label>
        <fieldset className="if-card if-field--full"><legend className="if-form-section-label">Scopes</legend><div className="if-form-grid">{scopes.map((scope) => <label className="if-checkbox" key={scope}><input type="checkbox" checked={selected.includes(scope)} onChange={() => setSelected((current) => current.includes(scope) ? current.filter((item) => item !== scope) : [...current, scope])} /><span>{scope}</span></label>)}</div></fieldset>
        {message ? <p className="account-form__message" role="alert">{message}</p> : null}
      </form>}
    </ControlDialog> : null}
    </ControlPageBody>
  </section>;
}

export default function ProfilePage({ section = "profile" }) {
  const auth = useAuth();
  const user = auth?.user;
  if (!auth || auth.staticHost || !auth.enabled || !user) return <section className="profile-page profile-page--unavailable" data-profile-page><ShieldCheck size={28} /><h2>Account service unavailable</h2><p>Profile and agent administration are available on the authenticated Cloudflare application.</p></section>;

  return <div className="profile-page" data-profile-page data-profile-section={section} data-density="compact">
    <ControlPageHeader compact divided eyebrow="Account settings" title={section === "security" ? "Security" : section === "personal-ai" ? "Personal OpenAI keys" : "Profile"} summary={section === "security" ? "Manage the password for this workspace account." : section === "personal-ai" ? "Manage credentials available only to requests you initiate." : "Manage the identity shown across the workspace."} headingLevel={2} />
    <ControlPageBody compact>
    <nav className="if-tabs__list profile-page__nav" aria-label="Profile sections">
      <a role="tab" href="#/profile" className={`if-tab${section === "profile" ? " is-active" : ""}`} aria-selected={section === "profile"} aria-current={section === "profile" ? "page" : undefined}><UserRound size={14} />Profile</a>
      <a role="tab" href="#/profile/security" className={`if-tab${section === "security" ? " is-active" : ""}`} aria-selected={section === "security"} aria-current={section === "security" ? "page" : undefined}><KeyRound size={14} />Security</a>
      <a role="tab" href="#/profile/openai" className={`if-tab${section === "personal-ai" ? " is-active" : ""}`} aria-selected={section === "personal-ai"} aria-current={section === "personal-ai" ? "page" : undefined}><KeyRound size={14} />OpenAI keys</a>
    </nav>
    <div className="profile-page__content">
      {section === "security" ? <SecurityPanel auth={auth} user={user} /> : section === "personal-ai" ? <OpenAiKeyManagement auth={auth} scope="user" embedded /> : <AccountPanel auth={auth} user={user} />}
    </div>
    </ControlPageBody>
  </div>;
}
