import { useCallback, useEffect, useMemo, useState } from "react";
import { Ban, RefreshCcw, RotateCcw, Send } from "lucide-react";
import { ControlAsyncState, ControlMetricStrip, ControlPageBody, ControlStatusBadge } from "control-surface-ui/react";
import OperationalDataTable from "./OperationalDataTable.jsx";

function dateTime(value) {
  const date = new Date(value || "");
  return Number.isNaN(date.getTime()) ? "Never" : date.toLocaleString([], { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
}

function statusTone(status) {
  return ({ delivered: "completed", succeeded: "completed", failed: "failed", pending: "running", sending: "running", pending_provider: "blocked", cancelled: "inactive" })[status] || "info";
}

function statusLabel(status) {
  return String(status || "unknown").replaceAll("_", " ").replace(/^./, (value) => value.toUpperCase());
}

export default function AcquisitionOperations({ auth }) {
  const [data, setData] = useState(null); const [error, setError] = useState(""); const [busyId, setBusyId] = useState("");
  const refresh = useCallback(async () => { try { setData(await auth.getAcquisitionOperations()); setError(""); } catch (requestError) { setError(requestError.message); } }, [auth]);
  const mutate = useCallback(async (id, action) => { setBusyId(id); try { await auth.updateAcquisitionDeliveryJob(id, action); await refresh(); } catch (requestError) { setError(requestError.message); } finally { setBusyId(""); } }, [auth, refresh]);
  useEffect(() => { const first = window.setTimeout(() => void refresh(), 0); const timer = window.setInterval(() => void refresh(), 30_000); return () => { window.clearTimeout(first); window.clearInterval(timer); }; }, [refresh]);
  const workspaceColumns = useMemo(() => [
    { key: "workspace", label: "Workspace", required: true, sticky: true, minWidth: 210, value: (row) => row.name, render: (row) => <span><strong>{row.name}</strong><small>{row.status}</small></span> },
    { key: "key", label: "SAM key", facet: true, minWidth: 120, value: (row) => row.keyed ? "Configured" : "No key", render: (row) => <ControlStatusBadge status={row.keyed ? "active" : "inactive"} label={row.keyed ? "Configured" : "No key"} /> },
    { key: "automation", label: "Automation", facet: true, minWidth: 140, value: (row) => row.keyed && row.automationEnabled ? "Enabled" : row.automationEnabled ? "Waiting for key" : "Paused", render: (row) => <span><strong>{row.keyed && row.automationEnabled ? "Enabled" : row.automationEnabled ? "Waiting for key" : "Paused"}</strong><small>Every {row.cadenceHours} hours</small></span> },
    { key: "latest", label: "Latest refresh", minWidth: 190, value: (row) => row.latestRun?.startedAt || "", render: (row) => row.latestRun ? <span><ControlStatusBadge status={statusTone(row.latestRun.status)} label={statusLabel(row.latestRun.status)} /><small>{dateTime(row.latestRun.completedAt || row.latestRun.startedAt)}</small></span> : "No retained run" },
    { key: "changes", label: "Latest result", minWidth: 150, value: (row) => Number(row.latestRun?.recordsAdded || 0) + Number(row.latestRun?.recordsUpdated || 0), render: (row) => row.latestRun ? `${Number(row.latestRun.recordsAdded || 0)} new · ${Number(row.latestRun.recordsUpdated || 0)} changed` : "—" },
  ], []);
  const jobColumns = useMemo(() => [
    { key: "updated", label: "Updated", required: true, sticky: true, minWidth: 180, value: (row) => row.updatedAt, render: (row) => dateTime(row.updatedAt) },
    { key: "workspace", label: "Workspace", facet: true, minWidth: 170, value: (row) => row.workspaceName },
    { key: "recipient", label: "Recipient", facet: true, minWidth: 180, value: (row) => row.userName },
    { key: "view", label: "Saved view", minWidth: 180, value: (row) => row.savedViewName },
    { key: "mode", label: "Mode", facet: true, minWidth: 110, value: (row) => statusLabel(row.mode) },
    { key: "status", label: "Status", facet: true, minWidth: 140, value: (row) => statusLabel(row.status), render: (row) => <span><ControlStatusBadge status={statusTone(row.status)} label={statusLabel(row.status)} />{row.lastError ? <small>{statusLabel(row.lastError)}</small> : null}</span> },
    { key: "attempts", label: "Attempts", minWidth: 90, align: "right", value: (row) => row.attemptCount },
    { key: "actions", label: "Actions", role: "actions", sortable: false, required: true, render: (row) => <span className="acquisition-operations__actions">{["failed", "cancelled"].includes(row.status) ? <button type="button" className="if-btn if-btn--secondary if-btn--icon" aria-label={`Retry delivery for ${row.savedViewName}`} disabled={busyId === row.id} onClick={() => void mutate(row.id, "retry")}><RotateCcw size={15} /></button> : null}{["pending_provider", "pending", "failed"].includes(row.status) ? <button type="button" className="if-btn if-btn--secondary if-btn--icon" aria-label={`Cancel delivery for ${row.savedViewName}`} disabled={busyId === row.id} onClick={() => void mutate(row.id, "cancel")}><Ban size={15} /></button> : null}</span> },
  ], [busyId, mutate]);
  if (!data && !error) return <ControlPageBody compact><ControlAsyncState compact state="loading" title="Loading acquisition operations" message="Reading scheduler, source, and outbound-delivery health." /></ControlPageBody>;
  if (!data) return <ControlPageBody compact><ControlAsyncState compact state="error" title="Acquisition operations unavailable" message={error} action={<button type="button" className="if-btn if-btn--secondary" onClick={() => void refresh()}><RefreshCcw size={15} />Retry</button>} /></ControlPageBody>;
  return <ControlPageBody compact><div className="acquisition-operations" data-acquisition-operations>
    <ControlMetricStrip mobileScroll label="Acquisition operations summary" items={[
      { id: "workspaces", label: "Workspaces", value: data.summary.workspaces },
      { id: "keyed", label: "SAM-keyed", value: data.summary.keyed, tone: data.summary.keyed ? "success" : "neutral" },
      { id: "automated", label: "Automated", value: data.summary.automated, tone: "info" },
      { id: "refresh-failures", label: "Refresh failures", value: data.summary.failedRefreshes, tone: data.summary.failedRefreshes ? "danger" : "success" },
      { id: "backlog", label: "Delivery backlog", value: data.summary.pendingDeliveries, tone: data.summary.pendingDeliveries ? "warning" : "success" },
      { id: "delivery-failures", label: "Delivery failures", value: data.summary.failedDeliveries, tone: data.summary.failedDeliveries ? "danger" : "success" },
    ]} />
    <div className={`if-alert ${data.provider.configured ? "if-alert--success" : "if-alert--warning"}`} role="status"><Send size={17} /><div><strong>{data.provider.configured ? "Outbound email is active" : "Outbound email is queued"}</strong><p>{data.provider.configured ? "The scheduler delivers immediate alerts and due daily digests through the protected provider." : "No protected email provider is configured. In-app alerts continue and delivery jobs remain retained without sending."}</p></div><button type="button" className="if-btn if-btn--secondary if-btn--sm" onClick={() => void refresh()}><RefreshCcw size={14} />Refresh</button></div>
    {error ? <p className="if-alert if-alert--warning" role="status">{error}</p> : null}
    <section className="if-analytics-panel if-analytics-panel--flat"><header className="if-analytics-panel__header"><div className="if-analytics-panel__heading"><h3 className="if-analytics-panel__title">Scheduler and source health</h3><p className="if-analytics-panel__summary">No-key workspaces remain visible here but are excluded before acquisition task creation.</p></div></header><OperationalDataTable id="acquisition-operations-workspaces" label="Acquisition workspace health" rows={data.workspaces || []} columns={workspaceColumns} rowKey={(row) => row.id} defaultSort={{ key: "workspace", direction: "asc" }} defaultPageSize={10} selectable={false} searchPlaceholder="Search workspace and scheduler state…" exportFilename="acquisition-workspace-health.csv" mobileColumns={["workspace", "key", "automation", "latest"]} /></section>
    <section className="if-analytics-panel if-analytics-panel--flat"><header className="if-analytics-panel__header"><div className="if-analytics-panel__heading"><h3 className="if-analytics-panel__title">Outbound delivery jobs</h3><p className="if-analytics-panel__summary">Latest 100 jobs with bounded retry state. Provider response bodies and credentials are never retained.</p></div></header>{data.jobs?.length ? <OperationalDataTable id="acquisition-delivery-jobs" label="Outbound acquisition delivery jobs" rows={data.jobs} columns={jobColumns} rowKey={(row) => row.id} defaultSort={{ key: "updated", direction: "desc" }} defaultPageSize={10} selectable={false} searchPlaceholder="Search recipients, workspaces, saved views, and status…" exportFilename="acquisition-delivery-jobs.csv" mobileColumns={["updated", "workspace", "view", "status", "actions"]} /> : <ControlAsyncState compact state="empty" title="No outbound delivery jobs" message="Saved-view matches will create immediate or daily delivery jobs after a source refresh." />}</section>
  </div></ControlPageBody>;
}
