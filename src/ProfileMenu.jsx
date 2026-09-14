import { useEffect, useRef, useState } from "react";
import { Activity, Bot, ChevronDown, KeyRound, LogIn, UserRound } from "lucide-react";
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
    <div
      className="if-popover if-account-popover ci-profile-menu profile-menu"
      data-profile-menu
      ref={menuRef}
      style={{ position: "relative", flex: "0 0 auto", marginLeft: "auto" }}
    >
      <button
        className={`if-account-menu${open ? " is-active" : ""}`}
        type="button"
        data-profile-menu-trigger
        aria-label="Profile menu"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls="workspace-profile-menu"
        title={`Signed in as ${user.displayName} · ${user.email}`}
        onClick={() => setOpen((value) => !value)}
        style={{
          maxWidth: 220,
          minHeight: 36,
          background: open ? "#eff6ff" : "#ffffff",
          borderColor: open ? "#73b3e7" : "rgba(255,255,255,0.42)",
          color: "#1b1b1b",
        }}
      >
        <span className="if-avatar if-profile-avatar" data-profile-avatar aria-hidden="true" style={{ width: 28, height: 28, fontSize: 11, overflow: "hidden" }}>{initials(user.displayName)}</span>
        <span className="if-account-menu__name if-desktop-only" data-profile-menu-name>{user.displayName}</span>
        <ChevronDown className="if-icon-slot if-account-menu__chevron" size={15} aria-hidden="true" />
      </button>
      {open ? (
        <section
          id="workspace-profile-menu"
          className="if-popover__panel if-account-surface ci-profile-menu__surface"
          data-profile-menu-surface
          role="dialog"
          aria-label="Profile controls"
          style={{ position: "absolute", right: 0, top: "calc(100% + 8px)", width: "min(360px, calc(100vw - 24px))", zIndex: 210 }}
        >
          <header className="if-account-surface__header">
            <span className="if-account-surface__avatar if-profile-avatar if-profile-avatar--large" aria-hidden="true">{initials(user.displayName)}</span>
            <span className="if-account-surface__identity">
              <strong data-profile-active-name>{user.displayName}</strong>
              <span>{user.title || "Account owner"}</span>
              <span>{user.email}</span>
            </span>
          </header>
          <div className="if-account-surface__body">
            <section className="if-account-surface__section" aria-label="Hosted account">
              <span className="if-account-surface__label">Account</span>
              <div className="if-account-surface__controls">
                <div className="if-account-surface__control"><span>Role</span><strong>{user.role}</strong></div>
                <div className="if-account-surface__control"><span>Workspace</span><strong>Defense budget</strong></div>
              </div>
            </section>
            <section className="if-account-surface__section" aria-label="Account actions">
              <span className="if-account-surface__label">Account actions</span>
              <a className="if-account-action" href="#/profile" data-profile-open-page onClick={() => setOpen(false)}>
                <span className="if-account-action__icon" aria-hidden="true"><UserRound size={15} /></span>
                <span className="if-account-action__content"><strong className="if-account-action__title">Open Profile</strong><span className="if-account-action__meta">Identity and account details</span></span>
              </a>
              <a className="if-account-action" href="#/profile/security" onClick={() => setOpen(false)}>
                <span className="if-account-action__icon" aria-hidden="true"><KeyRound size={15} /></span>
                <span className="if-account-action__content"><strong className="if-account-action__title">Security</strong><span className="if-account-action__meta">Password and active sessions</span></span>
              </a>
              <a className="if-account-action" href="#/budget-spend/agents" onClick={() => setOpen(false)}>
                <span className="if-account-action__icon" aria-hidden="true"><Bot size={15} /></span>
                <span className="if-account-action__content"><strong className="if-account-action__title">Agent Access</strong><span className="if-account-action__meta">Scoped API credentials</span></span>
              </a>
              <a className="if-account-action" href="#/budget-spend/api-log" onClick={() => setOpen(false)}>
                <span className="if-account-action__icon" aria-hidden="true"><Activity size={15} /></span>
                <span className="if-account-action__content"><strong className="if-account-action__title">API Log</strong><span className="if-account-action__meta">Human and agent activity</span></span>
              </a>
            </section>
          </div>
          <footer className="if-account-surface__footer">
            <span className="if-text-xs if-text-muted">{user.email}</span>
            <button className="if-btn if-btn--sm" type="button" onClick={() => void auth.logout()}>Sign out</button>
          </footer>
        </section>
      ) : null}
    </div>
  );
}
