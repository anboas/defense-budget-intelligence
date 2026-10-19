import { AlertTriangle, CheckCircle2, Inbox, RefreshCcw } from "lucide-react";
import { ControlAsyncState } from "control-surface-ui/react";

const ICONS = {
  loading: <RefreshCcw size={18} aria-hidden="true" />,
  error: <AlertTriangle size={18} aria-hidden="true" />,
  empty: <Inbox size={18} aria-hidden="true" />,
  success: <CheckCircle2 size={18} aria-hidden="true" />,
};

export default function SurfaceState({ owner, state, title, message, onRetry, action, compact = true, ...props }) {
  const retry = state === "error" && onRetry ? <button type="button" className="if-btn if-btn--secondary" onClick={onRetry}>Retry</button> : null;
  return <div data-surface-state={state} data-surface-state-owner={owner}><ControlAsyncState {...props} compact={compact} state={state} icon={ICONS[state]} title={title} message={message} action={action || retry} /></div>;
}

export function SurfaceFeedback({ owner, state = "success", children }) {
  if (!children) return null;
  const tone = state === "error" ? "danger" : state === "warning" ? "warning" : state === "info" ? "info" : "success";
  return <div className={`if-alert if-alert--${tone}`} role={state === "error" ? "alert" : "status"} data-surface-feedback={state} data-surface-state-owner={owner}>{children}</div>;
}
