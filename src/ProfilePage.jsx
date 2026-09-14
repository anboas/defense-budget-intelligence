import { useEffect, useState } from "react";
import { Check, Clipboard, KeyRound, Plus, Save, ShieldCheck, Trash2, UserRound } from "lucide-react";
import { useAuth } from "./AuthContext.jsx";

const DEFAULT_AGENT_SCOPES = ["records:read", "tracking:read", "tracking:write", "events:read", "events:write", "activity:read", "integrations:read"];

function initials(name = "") {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "U";
}

function AccountPanel({ auth, user }) {
  const [displayName, setDisplayName] = useState(user.displayName);
  const [title, setTitle] = useState(user.title || "");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function save(event) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      await auth.updateProfile({ displayName, title });
      setMessage("Profile saved.");
    } catch (error) { setMessage(error.message); }
    finally { setBusy(false); }
  }

  return <section className="profile-page__panel" data-profile-account aria-labelledby="profile-account-title">
    <header><span>Account identity</span><h2 id="profile-account-title">Profile</h2><p>This identity appears in the application header and shared workspace activity.</p></header>
    <form className="profile-page__form" onSubmit={save}>
      <label>Display name<input required minLength={2} autoComplete="name" value={displayName} onChange={(event) => setDisplayName(event.target.value)} /></label>
      <label>Title <span>(optional)</span><input autoComplete="organization-title" value={title} onChange={(event) => setTitle(event.target.value)} /></label>
      <label>Email<input value={user.email} disabled /></label>
      <label>Role<input value={user.role} disabled /></label>
      {message ? <p className="account-form__message" role="status">{message}</p> : null}
      <button type="submit" disabled={busy}><Save size={16} />{busy ? "Saving…" : "Save profile"}</button>
    </form>
  </section>;
}

function SecurityPanel({ auth, user }) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function save(event) {
    event.preventDefault();
    setMessage("");
    if (newPassword !== confirm) { setMessage("New passwords do not match."); return; }
    setBusy(true);
    try {
      await auth.changePassword({ email: user.email, currentPassword, newPassword });
      setCurrentPassword("");
      setNewPassword("");
      setConfirm("");
      setMessage("Password changed. Other sessions were signed out.");
    } catch (error) { setMessage(error.message); }
    finally { setBusy(false); }
  }

  return <section className="profile-page__panel" data-profile-security aria-labelledby="profile-security-title">
    <header><span>Account security</span><h2 id="profile-security-title">Security</h2><p>Changing the password immediately revokes every other active session.</p></header>
    <form className="profile-page__form" onSubmit={save}>
      <label>Current password<input required type="password" autoComplete="current-password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} /></label>
      <label>New password<input required minLength={12} type="password" autoComplete="new-password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} /></label>
      <label>Confirm new password<input required minLength={12} type="password" autoComplete="new-password" value={confirm} onChange={(event) => setConfirm(event.target.value)} /></label>
      {message ? <p className="account-form__message" role="status">{message}</p> : null}
      <button type="submit" disabled={busy}><KeyRound size={16} />{busy ? "Updating…" : "Update password"}</button>
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

  return <section className={`${embedded ? "ops-panel admin-console__agent-panel" : "profile-page__panel profile-page__panel--wide"}`} data-profile-agents aria-labelledby="profile-agents-title">
    {embedded ? <header className="ops-panel__header"><div><span>Agent control plane</span><h2 id="profile-agents-title">Agent access</h2><p>Create narrowly scoped credentials for trusted agents. Tokens are displayed once; the server stores only a SHA-256 hash.</p></div></header> : <header><span>Agent control plane</span><h2 id="profile-agents-title">Agent access</h2><p>Create narrowly scoped credentials for trusted agents. Tokens are displayed once; the server stores only a SHA-256 hash.</p></header>}
    <div className="agent-access-body">
      {createdToken ? <section className="agent-token-once" role="status"><strong>Copy this token now</strong><p>It cannot be retrieved again. Save it directly in the agent’s protected Secret Store, never in chat or source files.</p><code>{createdToken}</code><button type="button" onClick={() => void navigator.clipboard.writeText(createdToken).then(() => setCopied(true))}>{copied ? <Check size={15} /> : <Clipboard size={15} />}{copied ? "Copied" : "Copy token"}</button></section> : null}
      <form className="profile-page__form agent-key-form" onSubmit={create}>
        <div className="profile-page__form-row"><label>Name<input required minLength={2} placeholder="Research agent" value={name} onChange={(event) => setName(event.target.value)} /></label><label>Expires <span>(optional)</span><input type="datetime-local" value={expiresAt} onChange={(event) => setExpiresAt(event.target.value)} /></label></div>
        <fieldset><legend>Scopes</legend>{scopes.map((scope) => <label key={scope}><input type="checkbox" checked={selected.includes(scope)} onChange={() => setSelected((current) => current.includes(scope) ? current.filter((item) => item !== scope) : [...current, scope])} /><span>{scope}</span></label>)}</fieldset>
        <button type="submit" disabled={busy || !selected.length}><Plus size={15} />Create credential</button>
      </form>
      {message ? <p className="account-form__message" role="alert">{message}</p> : null}
      <section className="agent-key-list" aria-label="Agent credentials"><h3>Credentials</h3>{busy && !keys.length ? <p>Loading…</p> : keys.length ? keys.map((key) => <article key={key.id} className={key.revokedAt ? "is-revoked" : ""}><div><strong>{key.name}</strong><span>{key.scopes.join(" · ")}</span><small>{key.revokedAt ? "Revoked" : key.lastUsedAt ? `Last used ${new Date(key.lastUsedAt).toLocaleString()}` : "Never used"}</small></div>{!key.revokedAt ? <button type="button" aria-label={`Revoke ${key.name}`} onClick={() => void revoke(key.id)}><Trash2 size={15} />Revoke</button> : null}</article>) : <p>No agent credentials yet.</p>}</section>
    </div>
  </section>;
}

export default function ProfilePage({ section = "profile" }) {
  const auth = useAuth();
  const user = auth?.user;
  if (!auth || auth.staticHost || !auth.enabled || !user) return <section className="profile-page profile-page--unavailable" data-profile-page><ShieldCheck size={28} /><h2>Account service unavailable</h2><p>Profile and agent administration are available on the authenticated Cloudflare application.</p></section>;

  return <div className="profile-page" data-profile-page data-profile-section={section}>
    <section className="profile-page__hero">
      <span className="profile-avatar profile-avatar--page" aria-hidden="true">{initials(user.displayName)}</span>
      <div><span>Workspace account</span><h2>{user.displayName}</h2><p>{user.title || "No title set"} · {user.role}</p></div>
    </section>
    <div className="profile-page__layout">
      <nav className="profile-page__nav" aria-label="Profile sections">
        <a href="#/profile" className={section === "profile" ? "is-active" : ""} aria-current={section === "profile" ? "page" : undefined}><UserRound size={16} />Profile</a>
        <a href="#/profile/security" className={section === "security" ? "is-active" : ""} aria-current={section === "security" ? "page" : undefined}><KeyRound size={16} />Security</a>
      </nav>
      {section === "security" ? <SecurityPanel auth={auth} user={user} /> : <AccountPanel auth={auth} user={user} />}
    </div>
  </div>;
}
