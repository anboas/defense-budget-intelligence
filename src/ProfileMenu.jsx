import { useEffect, useRef, useState } from "react";
import { Bot, ChevronDown, KeyRound, LogIn, LogOut, UserRound } from "lucide-react";
import { useAuth } from "./AuthContext.jsx";

function initials(name = "") {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "U";
}

export default function ProfileMenu() {
  const auth = useAuth();
  const [open, setOpen] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const close = (event) => { if (!menuRef.current?.contains(event.target)) setOpen(false); };
    const escape = (event) => { if (event.key === "Escape") setOpen(false); };
    const route = () => setOpen(false);
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", escape);
    window.addEventListener("hashchange", route);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", escape);
      window.removeEventListener("hashchange", route);
    };
  }, [open]);

  if (!auth || auth.staticHost || !auth.enabled) return null;
  const user = auth.user;

  if (!user) return <button className="if-account-menu profile-trigger profile-trigger--signin" type="button" onClick={() => window.location.reload()} title="Sign in to the workspace"><LogIn size={16} /><span>Sign in</span></button>;

  return (
    <div className="if-popover if-account-popover profile-menu" ref={menuRef}>
      <button className={`if-account-menu profile-trigger${open ? " is-active" : ""}`} type="button" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        <span className="if-avatar if-profile-avatar profile-avatar" aria-hidden="true">{initials(user.displayName)}</span>
        <span className="if-account-menu__name profile-trigger__copy"><strong>{user.displayName}</strong></span>
        <ChevronDown className="if-account-menu__chevron" size={15} aria-hidden="true" />
      </button>
      {open ? (
        <div className="if-popover__panel if-account-surface profile-popover" role="menu" aria-label="Account menu">
          <div className="if-account-surface__header profile-popover__identity">
            <span className="profile-avatar profile-avatar--large">{initials(user.displayName)}</span>
            <div><strong>{user.displayName}</strong><span>{user.role}</span><span>{user.email}</span>{user.title ? <span>{user.title}</span> : null}</div>
          </div>
          <a href="#/profile" role="menuitem"><UserRound size={16} />My profile</a>
          <a href="#/profile/security" role="menuitem"><KeyRound size={16} />Security</a>
          <a href="#/profile/agents" role="menuitem"><Bot size={16} />Agent access</a>
          <button type="button" role="menuitem" onClick={() => void auth.logout()}><LogOut size={16} />Sign out</button>
        </div>
      ) : null}
    </div>
  );
}
