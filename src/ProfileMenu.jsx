import { useEffect, useRef, useState } from "react";
import { Bot, Check, ChevronDown, Clipboard, KeyRound, LogIn, LogOut, Plus, Save, Trash2, UserRound, X } from "lucide-react";
import { useAuth } from "./AuthContext.jsx";

function initials(name = "") {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "U";
}

export default function ProfileMenu() {
  const auth = useAuth();
  const [open, setOpen] = useState(false);
  const [panel, setPanel] = useState("");
  const [message, setMessage] = useState("");
  const menuRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const close = (event) => { if (!menuRef.current?.contains(event.target)) setOpen(false); };
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [open]);

  if (!auth || auth.staticHost || !auth.enabled) return null;
  const user = auth.user;

  if (!user) return (
    <button className="profile-trigger profile-trigger--signin" type="button" onClick={() => window.location.reload()} title="Sign in to the workspace">
      <LogIn size={16} /><span>Sign in</span>
    </button>
  );

  return (
    <div className="profile-menu" ref={menuRef}>
      <button className="profile-trigger" type="button" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        <span className="profile-avatar" aria-hidden="true">{initials(user.displayName)}</span>
        <span className="profile-trigger__copy"><strong>{user.displayName}</strong><small>{user.role}</small></span>
        <ChevronDown size={15} aria-hidden="true" />
      </button>
      {open ? (
        <div className="profile-popover" role="menu" aria-label="Account menu">
          <div className="profile-popover__identity">
            <span className="profile-avatar profile-avatar--large">{initials(user.displayName)}</span>
            <div><strong>{user.displayName}</strong><span>{user.email}</span>{user.title ? <span>{user.title}</span> : null}</div>
          </div>
          <button type="button" role="menuitem" onClick={() => { setPanel("profile"); setOpen(false); }}><UserRound size={16} />My profile</button>
          <button type="button" role="menuitem" onClick={() => { setPanel("password"); setOpen(false); }}><KeyRound size={16} />Change password</button>
          <button type="button" role="menuitem" onClick={() => { setPanel("agents"); setOpen(false); }}><Bot size={16} />Agent access</button>
          <button type="button" role="menuitem" onClick={() => void auth.logout()}><LogOut size={16} />Sign out</button>
        </div>
      ) : null}
      {panel === "agents" ? <AgentAccessDialog auth={auth} onClose={() => setPanel("")} /> : null}
      {panel && panel !== "agents" ? <ProfileDialog mode={panel} user={user} auth={auth} message={message} setMessage={setMessage} onClose={() => { setPanel(""); setMessage(""); }} /> : null}
    </div>
  );
}

const DEFAULT_AGENT_SCOPES = ["records:read", "tracking:read", "tracking:write", "events:read", "events:write", "activity:read", "integrations:read"];

function AgentAccessDialog({ auth, onClose }) {
  const [keys, setKeys] = useState([]);
  const [scopes, setScopes] = useState([]);
  const [name, setName] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [selected, setSelected] = useState(DEFAULT_AGENT_SCOPES);
  const [createdToken, setCreatedToken] = useState("");
  const [copied, setCopied] = useState(false);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(true);

  useEffect(() => {
    let active = true;
    void auth.listAgentKeys().then((result) => {
      if (!active) return;
      setKeys(result.keys || []);
      setScopes(result.availableScopes || []);
    }).catch((error) => setMessage(error.message)).finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [auth]);

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
    } catch (error) { setMessage(error.message); }
    finally { setBusy(false); }
  }

  return <div className="profile-dialog" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section role="dialog" aria-modal="true" aria-labelledby="agent-access-title" className="agent-access-dialog">
      <header><div><p>Account</p><h2 id="agent-access-title">Agent access</h2></div><button type="button" aria-label="Close agent access" onClick={onClose}><X size={18} /></button></header>
      <div className="agent-access-body">
        <p className="agent-access-intro">Create scoped credentials for trusted agents. Tokens are shown once; the server stores only a SHA-256 hash.</p>
        {createdToken ? <section className="agent-token-once" role="status"><strong>Copy this token now</strong><p>It cannot be retrieved again. Save it in the agent’s protected Secret Store, never in chat or source files.</p><code>{createdToken}</code><button type="button" onClick={() => void navigator.clipboard.writeText(createdToken).then(() => setCopied(true))}>{copied ? <Check size={15} /> : <Clipboard size={15} />}{copied ? "Copied" : "Copy token"}</button></section> : null}
        <form className="agent-key-form" onSubmit={create}>
          <label>Name<input required minLength={2} placeholder="Research agent" value={name} onChange={(event) => setName(event.target.value)} /></label>
          <label>Expires <span>(optional)</span><input type="datetime-local" value={expiresAt} onChange={(event) => setExpiresAt(event.target.value)} /></label>
          <fieldset><legend>Scopes</legend>{scopes.map((scope) => <label key={scope}><input type="checkbox" checked={selected.includes(scope)} onChange={() => setSelected((current) => current.includes(scope) ? current.filter((item) => item !== scope) : [...current, scope])} /><span>{scope}</span></label>)}</fieldset>
          <button type="submit" disabled={busy || !selected.length}><Plus size={15} />Create credential</button>
        </form>
        {message ? <p className="account-form__message" role="alert">{message}</p> : null}
        <section className="agent-key-list" aria-label="Agent credentials"><h3>Credentials</h3>{busy && !keys.length ? <p>Loading…</p> : keys.length ? keys.map((key) => <article key={key.id} className={key.revokedAt ? "is-revoked" : ""}><div><strong>{key.name}</strong><span>{key.scopes.join(" · ")}</span><small>{key.revokedAt ? "Revoked" : key.lastUsedAt ? `Last used ${new Date(key.lastUsedAt).toLocaleString()}` : "Never used"}</small></div>{!key.revokedAt ? <button type="button" aria-label={`Revoke ${key.name}`} onClick={() => void revoke(key.id)}><Trash2 size={15} />Revoke</button> : null}</article>) : <p>No agent credentials yet.</p>}</section>
      </div>
    </section>
  </div>;
}

function ProfileDialog({ mode, user, auth, message, setMessage, onClose }) {
  const profile = mode === "profile";
  const [displayName, setDisplayName] = useState(user.displayName);
  const [title, setTitle] = useState(user.title || "");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const close = (event) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [onClose]);

  return (
    <div className="profile-dialog" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section role="dialog" aria-modal="true" aria-labelledby="profile-dialog-title">
        <header><div><p>Account</p><h2 id="profile-dialog-title">{profile ? "My profile" : "Change password"}</h2></div><button type="button" aria-label="Close account dialog" onClick={onClose}><X size={18} /></button></header>
        <form onSubmit={(event) => {
          event.preventDefault();
          setMessage("");
          if (!profile && newPassword !== confirm) return setMessage("New passwords do not match.");
          setBusy(true);
          const task = profile ? auth.updateProfile({ displayName, title }) : auth.changePassword({ email: user.email, currentPassword, newPassword });
          void task.then(() => setMessage(profile ? "Profile saved." : "Password changed. Other sessions were signed out."))
            .catch((error) => setMessage(error.message)).finally(() => setBusy(false));
        }}>
          {profile ? <><label>Display name<input autoFocus required minLength={2} value={displayName} onChange={(event) => setDisplayName(event.target.value)} /></label><label>Title <span>(optional)</span><input value={title} onChange={(event) => setTitle(event.target.value)} /></label><label>Email<input value={user.email} disabled /></label></> : <><label>Current password<input autoFocus required type="password" autoComplete="current-password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} /></label><label>New password<input required minLength={12} type="password" autoComplete="new-password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} /></label><label>Confirm new password<input required minLength={12} type="password" autoComplete="new-password" value={confirm} onChange={(event) => setConfirm(event.target.value)} /></label></>}
          {message ? <p className="account-form__message" role="status">{message}</p> : null}
          <button type="submit" disabled={busy}><Save size={16} />{busy ? "Saving…" : profile ? "Save profile" : "Update password"}</button>
        </form>
      </section>
    </div>
  );
}
