import { useEffect, useState } from "react";
import { Laptop, LogOut } from "lucide-react";
import { ControlAsyncState, useToast } from "control-surface-ui/react";

function relativeSessionTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return date.toLocaleString();
}

export default function SessionManagement({ auth }) {
  const [sessions, setSessions] = useState([]);
  const [busy, setBusy] = useState(true);
  const { showToast } = useToast();
  useEffect(() => {
    let active = true;
    void auth.listSessions().then((result) => {
      if (active) setSessions(result.sessions || []);
    }).catch((error) => {
      if (active) showToast({ tone: "danger", title: "Sessions unavailable", message: error.message });
    }).finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [auth, showToast]);

  async function revoke(id) {
    setBusy(true);
    try {
      await auth.revokeSession(id);
      setSessions((current) => current.filter((session) => session.id !== id));
      showToast({ tone: "success", title: "Session ended", message: "That browser session can no longer access your account." });
    } catch (error) { showToast({ tone: "danger", title: "Session not ended", message: error.message }); }
    finally { setBusy(false); }
  }

  async function revokeOthers() {
    setBusy(true);
    try {
      const result = await auth.revokeOtherSessions();
      setSessions((current) => current.filter((session) => session.current));
      showToast({ tone: "success", title: "Other sessions ended", message: `${result.revokedCount || 0} other session${result.revokedCount === 1 ? "" : "s"} revoked.` });
    } catch (error) { showToast({ tone: "danger", title: "Sessions not ended", message: error.message }); }
    finally { setBusy(false); }
  }

  const otherCount = sessions.filter((session) => !session.current).length;
  return <section className="if-panel profile-page__panel" data-profile-sessions aria-labelledby="profile-sessions-title">
    <header className="if-panel__header profile-page__panel-header">
      <div><h2 className="if-panel__title" id="profile-sessions-title">Active sessions</h2><p className="if-panel__subtitle">Review and end browsers that can access your account.</p></div>
      {otherCount ? <button className="if-btn if-btn--secondary if-btn--sm" type="button" disabled={busy} onClick={() => void revokeOthers()}><LogOut size={15} />End other sessions</button> : null}
    </header>
    <div className="if-panel__body profile-page__panel-body">
      {busy && !sessions.length ? <ControlAsyncState compact state="loading" title="Loading sessions" message="Reading active account sessions." /> : sessions.length ? <div className="if-action-row-list">
        {sessions.map((session) => <article className="if-action-row" key={session.id}>
          <span className="if-icon-slot" aria-hidden="true"><Laptop size={16} /></span>
          <span><strong>{session.current ? "Current session" : "Browser session"}</strong><em>Last active {relativeSessionTime(session.lastSeenAt)}</em><small>Created {relativeSessionTime(session.createdAt)} · Expires {relativeSessionTime(session.expiresAt)}</small></span>
          <span className={`if-badge${session.current ? " if-badge--info" : ""}`}>{session.current ? "Current" : "Active"}</span>
          {!session.current ? <span className="if-action-row__actions"><button className="if-btn if-btn--secondary if-btn--sm" type="button" disabled={busy} onClick={() => void revoke(session.id)}><LogOut size={15} />End</button></span> : null}
        </article>)}
      </div> : <ControlAsyncState compact state="empty" title="No active sessions" message="Sign in again to create a new session." />}
    </div>
  </section>;
}
