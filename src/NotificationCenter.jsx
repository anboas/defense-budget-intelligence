import { useEffect, useRef, useState } from "react";
import { Bell, CircleAlert, CircleCheck } from "lucide-react";
import { useNotifications } from "./NotificationContext.jsx";

function relativeTime(value) {
  const timestamp = Date.parse(value || "");
  if (!Number.isFinite(timestamp)) return "Now";
  const minutes = Math.max(0, Math.round((Date.now() - timestamp) / 60000));
  if (minutes < 1) return "Now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

export default function NotificationCenter() {
  const notifications = useNotifications();
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const closeOutside = (event) => { if (!rootRef.current?.contains(event.target)) setOpen(false); };
    const closeEscape = (event) => { if (event.key === "Escape") setOpen(false); };
    window.addEventListener("pointerdown", closeOutside);
    window.addEventListener("keydown", closeEscape);
    return () => {
      window.removeEventListener("pointerdown", closeOutside);
      window.removeEventListener("keydown", closeEscape);
    };
  }, [open]);
  if (!notifications) return null;
  const attention = notifications.notifications.filter((item) => item.requiresAction);
  const active = notifications.notifications.filter((item) => item.active);
  const earlier = notifications.notifications.filter((item) => !item.requiresAction && !item.active).slice(0, 6);
  const groups = [["Needs attention", attention], ["In progress", active], ["Earlier", earlier]].filter(([, items]) => items.length);
  return <div className="if-popover if-notification-menu" ref={rootRef} data-notification-center>
    <button type="button" className="if-icon-btn if-notification-btn" aria-label={`Notifications${notifications.unreadCount ? `, ${notifications.unreadCount} unread` : ""}`} aria-haspopup="dialog" aria-expanded={open} aria-controls="global-notifications" onClick={() => setOpen((value) => !value)}>
      <Bell size={18} aria-hidden="true" />
      {notifications.unreadCount ? <span className="if-notification-btn__badge">{Math.min(notifications.unreadCount, 99)}</span> : null}
    </button>
    {open ? <section className="if-popover__panel if-notifications" id="global-notifications" role="dialog" aria-label="Notifications">
      <header className="if-notifications__header"><div><h2>Notifications</h2><p>{notifications.unreadCount ? `${notifications.unreadCount} item${notifications.unreadCount === 1 ? "" : "s"} need attention` : notifications.activeCount ? `${notifications.activeCount} background task${notifications.activeCount === 1 ? "" : "s"} running` : "You’re caught up"}</p></div>{notifications.unreadCount ? <button type="button" className="if-btn if-btn--sm" onClick={notifications.markAllRead}>Mark read</button> : null}</header>
      <div className="if-notifications__body">
        {!groups.length ? <div className="if-empty-state"><CircleCheck size={22} aria-hidden="true" /><strong>No notifications</strong><p>Background work and items requiring review will appear here.</p></div> : groups.map(([label, items]) => <div key={label}>
          <div className="if-notifications__group-label">{label}</div>
          {items.map((item) => <a key={item.id} href={item.href} className={`if-notification-item${item.unread ? " if-notification-item--unread" : ""}${item.tone === "warning" ? " if-notification-item--warning" : item.tone === "danger" ? " if-notification-item--danger" : ""}`} onClick={() => { notifications.markRead(item.id, item.job.status); setOpen(false); }}>
            <span className="if-notification-item__icon">{item.active ? <span className="if-loading-dots if-loading-dots--orbit if-loading-dots--sm" aria-hidden="true"><span /><span /><span /></span> : item.tone === "danger" || item.tone === "warning" ? <CircleAlert size={15} aria-hidden="true" /> : <CircleCheck size={15} aria-hidden="true" />}</span>
            <span className="if-notification-item__content"><strong className="if-notification-item__title">{item.title}</strong><span className="if-notification-item__meta">{item.message}</span></span>
            <span className="if-notification-item__time">{relativeTime(item.at)}</span>
          </a>)}
        </div>)}
      </div>
      <footer className="if-notifications__footer"><span className="if-text-xs if-text-muted">Background tasks remain available after you leave the page.</span></footer>
    </section> : null}
  </div>;
}
