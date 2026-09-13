import { useEffect, useRef, useState } from "react";
import { ChevronDown, KeyRound, LogIn, LogOut, Save, UserRound, X } from "lucide-react";
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
          <button type="button" role="menuitem" onClick={() => void auth.logout()}><LogOut size={16} />Sign out</button>
        </div>
      ) : null}
      {panel ? <ProfileDialog mode={panel} user={user} auth={auth} message={message} setMessage={setMessage} onClose={() => { setPanel(""); setMessage(""); }} /> : null}
    </div>
  );
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
