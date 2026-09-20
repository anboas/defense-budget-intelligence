import { useEffect, useMemo, useRef, useState } from "react";
import { Building2, Check, Circle, Gauge, LifeBuoy, Pencil, Plus, Save, Send, ShieldCheck, X } from "lucide-react";
import { ControlAsyncState, ControlDialog, ControlMetricStrip } from "control-surface-ui/react";
import ControlSelect from "./ControlSelect.jsx";
import UserAvatar from "./UserAvatar.jsx";

const LIFECYCLE_OPTIONS = [
  ["internal", "Internal"], ["prospect", "Prospect"], ["trial", "Trial"], ["active", "Active"],
  ["grace", "Grace"], ["suspended", "Suspended"], ["closed", "Closed"],
].map(([value, label]) => ({ value, label }));

const REQUEST_STATUS_OPTIONS = [
  ["open", "Open"], ["in_progress", "In progress"], ["waiting", "Waiting"], ["resolved", "Resolved"], ["cancelled", "Cancelled"],
].map(([value, label]) => ({ value, label }));

function valueLabel(row) {
  if (typeof row.value === "boolean") return row.value ? "Included" : "Unavailable";
  if (row.key === "retentionDays") return `${Number(row.value).toLocaleString()} days`;
  if (row.key === "samRefreshHours") return `Every ${Number(row.value).toLocaleString()}h`;
  return Number(row.value).toLocaleString();
}

function usageMeta(row) {
  if (row.usage === null) return typeof row.value === "boolean" ? "Capability" : "Plan policy";
  return `${Number(row.usage).toLocaleString()} of ${Number(row.value).toLocaleString()} used`;
}

function OnboardingPanel({ organization, busy, onUpdate }) {
  const complete = (organization.onboardingSteps || []).filter((step) => ["completed", "waived"].includes(step.status)).length;
  return <section className="if-analytics-panel if-analytics-panel--flat" aria-label={`${organization.name} onboarding checklist`}>
    <header className="if-analytics-panel__header"><div className="if-analytics-panel__heading"><h3 className="if-analytics-panel__title">Getting started</h3><p className="if-analytics-panel__summary">{complete} of {organization.onboardingSteps?.length || 0} operating steps complete.</p></div><ShieldCheck size={20} /></header>
    <div className="saas-onboarding-steps">{(organization.onboardingSteps || []).map((step) => <article key={step.key} data-onboarding-step={step.key} data-status={step.status}>
      <span className="saas-onboarding-steps__state">{["completed", "waived"].includes(step.status) ? <Check size={16} /> : <Circle size={16} />}</span>
      <span><strong>{step.label}</strong><small>{step.description}</small>{step.note ? <em>{step.note}</em> : null}</span>
      {organization.canManageOrganization ? <button type="button" className="if-btn if-btn--secondary if-btn--sm" disabled={busy} onClick={() => onUpdate(step.key, ["completed", "waived"].includes(step.status) ? "pending" : "completed")}>
        {["completed", "waived"].includes(step.status) ? "Reopen" : "Complete"}
      </button> : <span className="if-badge if-badge--neutral">{step.status.replaceAll("_", " ")}</span>}
    </article>)}</div>
  </section>;
}

function ServiceRequestsPanel({ organization, requestTypes, draft, busy, onDraft, onCreate, onUpdate }) {
  const openCount = (organization.serviceRequests || []).filter((request) => !["resolved", "cancelled"].includes(request.status)).length;
  const typeOptions = (requestTypes || []).map((item) => ({ value: item.id, label: item.label }));
  return <section className="if-analytics-panel if-analytics-panel--flat" aria-label={`${organization.name} support and data requests`}>
    <header className="if-analytics-panel__header"><div className="if-analytics-panel__heading"><h3 className="if-analytics-panel__title">Support &amp; data</h3><p className="if-analytics-panel__summary">{openCount} open request{openCount === 1 ? "" : "s"}. Requests remain inside the customer record and activity ledger.</p></div><LifeBuoy size={20} /></header>
    <form className="saas-request-form" onSubmit={onCreate}>
      <div className="if-field"><span className="if-field__label">Request type</span><ControlSelect ariaLabel="Customer request type" value={draft.type} options={typeOptions} onChange={(type) => onDraft((current) => ({ ...current, type }))} /></div>
      <label className="if-field"><span className="if-field__label">Subject</span><input className="if-input" required minLength={3} maxLength={140} value={draft.subject} onChange={(event) => onDraft((current) => ({ ...current, subject: event.target.value }))} /></label>
      <label className="if-field if-field--full"><span className="if-field__label">Details</span><textarea className="if-textarea" rows={3} maxLength={4000} value={draft.detail} onChange={(event) => onDraft((current) => ({ ...current, detail: event.target.value }))} /></label>
      <button type="submit" className="if-btn if-btn--primary" disabled={busy}><Send size={14} />Submit request</button>
    </form>
    <div className="saas-service-requests">{(organization.serviceRequests || []).length ? organization.serviceRequests.map((request) => <article key={request.id} data-service-request={request.id} data-status={request.status}>
      <div><strong>{request.subject}</strong><small>{request.type.replaceAll("_", " ")} · Requested by {request.requesterName}</small>{request.detail ? <p>{request.detail}</p> : null}{request.resolutionNote ? <em>{request.resolutionNote}</em> : null}</div>
      {organization.canManageOrganization ? <ControlSelect ariaLabel={`Status for ${request.subject}`} value={request.status} options={REQUEST_STATUS_OPTIONS} onChange={(status) => onUpdate(request.id, { status })} /> : <span className="if-badge if-badge--neutral">{request.status.replaceAll("_", " ")}</span>}
      {request.requestedBy && !organization.canManageOrganization && ["open", "waiting"].includes(request.status) ? <button type="button" className="if-btn if-btn--ghost if-btn--sm" onClick={() => onUpdate(request.id, { status: "cancelled" })} disabled={busy}><X size={14} />Cancel</button> : null}
    </article>) : <p className="saas-empty-copy">No customer requests yet.</p>}</div>
  </section>;
}

function OrganizationOverview({ organization, showCommercialIdentity = true, requestTypes, requestDraft, setRequestDraft, busy, onUpdateOnboarding, onCreateRequest, onUpdateRequest }) {
  if (!organization) return <ControlAsyncState compact state="empty" title="Commercial model not linked" message="Attach this workspace to an organization before using customer controls." />;
  const usage = organization.usage || {};
  const onboardingComplete = (organization.onboardingSteps || []).filter((step) => ["completed", "waived"].includes(step.status)).length;
  return <div className="saas-overview" data-saas-overview={organization.id}>
    <section className="saas-identity if-analytics-panel if-analytics-panel--flat">
      <header className="if-analytics-panel__header"><div className="if-analytics-panel__heading"><span className="if-analytics-panel__eyebrow">Customer control plane</span><h3 className="if-analytics-panel__title">{organization.name}</h3><p className="if-analytics-panel__summary">{showCommercialIdentity ? "Organization ownership, plan posture, usage, and onboarding in one internal control surface." : "Plan posture and usage for this workspace."}</p></div><div className="saas-identity__status"><span className="if-badge if-badge--info">{organization.subscription?.planName || "Internal"}</span><span className={`if-badge ${organization.lifecycleState === "active" ? "if-badge--success" : "if-badge--warning"}`}>{organization.lifecycleState}</span><span className="if-badge if-badge--neutral">Observe only</span></div></header>
      <ControlMetricStrip label={`${organization.name} commercial summary`} items={[
        { id: "seats", label: "Seats", value: Number(usage.seats || 0), meta: `${organization.entitlements?.seats ?? "—"} available`, tone: "info" },
        { id: "workspaces", label: "Workspaces", value: Number(usage.workspaces || 0), meta: `${organization.entitlements?.workspaces ?? "—"} available`, tone: "purple" },
        { id: "teams", label: "Teams", value: Number(usage.teams || 0), meta: `${organization.entitlements?.teams ?? "—"} available`, tone: "gold" },
        { id: "onboarding", label: "Onboarding", value: `${onboardingComplete}/${organization.onboardingSteps?.length || 0}`, meta: "Operating steps", tone: onboardingComplete >= (organization.onboardingSteps?.length || 1) ? "success" : "warning" },
      ]} />
    </section>
    <div className="saas-overview__grid">
      <section className="if-analytics-panel if-analytics-panel--flat" aria-label={`${organization.name} plan entitlements`}>
        <header className="if-analytics-panel__header"><div className="if-analytics-panel__heading"><h3 className="if-analytics-panel__title">Plan &amp; usage</h3><p className="if-analytics-panel__summary">Server-side limits are measured now. Customer-visible enforcement remains disabled.</p></div><Gauge size={20} /></header>
        <div className="saas-entitlements">{(organization.entitlementRows || []).map((row) => <article key={row.key} data-entitlement={row.key} data-entitlement-status={row.status}><span><strong>{row.label}</strong><small>{usageMeta(row)}</small></span><b>{valueLabel(row)}</b></article>)}</div>
      </section>
      <section className="if-analytics-panel if-analytics-panel--flat" aria-label={`${organization.name} commercial posture`}>
        <header className="if-analytics-panel__header"><div className="if-analytics-panel__heading"><h3 className="if-analytics-panel__title">Customer readiness</h3><p className="if-analytics-panel__summary">Ownership, workspace attachment, manual plan, and operational readiness without payment processing.</p></div><ShieldCheck size={20} /></header>
        <div className="saas-readiness">{[
          ["ownerAssigned", "Customer owner assigned"], ["workspaceAttached", "Workspace attached"], ["planAssigned", "Manual plan assigned"], ["accessPreserved", "Existing access preserved"],
        ].map(([key, label]) => <div key={key} data-readiness={key} data-complete={organization.onboarding?.[key] ? "true" : "false"}><span>{organization.onboarding?.[key] ? <Check size={16} /> : <span aria-hidden="true">○</span>}</span><strong>{label}</strong></div>)}</div>
        <p className="if-alert if-alert--info">Payments, checkout, invoices, and card handling are deliberately absent. Customer operations remain manual and auditable.</p>
      </section>
      <OnboardingPanel organization={organization} busy={busy} onUpdate={onUpdateOnboarding} />
      <ServiceRequestsPanel organization={organization} requestTypes={requestTypes} draft={requestDraft} busy={busy} onDraft={setRequestDraft} onCreate={onCreateRequest} onUpdate={onUpdateRequest} />
    </div>
  </div>;
}

function organizationDraft(organization, users, workspaces) {
  return organization ? {
    id: organization.id, name: organization.name, billingEmail: organization.billingEmail || "", lifecycleState: organization.lifecycleState,
    planId: organization.subscription?.planId || "internal", ownerUserId: organization.owners?.[0]?.id || users[0]?.id || "",
    workspaceIds: organization.workspaces?.map((workspace) => String(workspace.id)) || [],
    overrideKeys: organization.overrides?.map((override) => override.key) || [],
    overrideValues: Object.fromEntries((organization.overrides || []).map((override) => [override.key, override.value])),
    overrideNotes: Object.fromEntries((organization.overrides || []).map((override) => [override.key, override.note || ""])),
  } : { id: "", name: "", billingEmail: "", lifecycleState: "prospect", planId: "pilot", ownerUserId: users[0]?.id || "", workspaceIds: workspaces.length === 1 ? [String(workspaces[0].id)] : [], overrideKeys: [], overrideValues: {}, overrideNotes: {} };
}

export default function SaasControlPlane({ auth, users = [], workspaces = [], activeOnly = false, onNotice }) {
  const [control, setControl] = useState(null);
  const [busy, setBusy] = useState(true);
  const [editing, setEditing] = useState(null);
  const [requestDraft, setRequestDraft] = useState({ type: "support", subject: "", detail: "" });
  const dialogRef = useRef(null);

  async function refresh() {
    const result = await auth.getSaasControlPlane();
    setControl(result);
    return result;
  }

  useEffect(() => {
    let active = true;
    auth.getSaasControlPlane().then((result) => { if (active) setControl(result); })
      .catch((error) => { if (active) onNotice?.(error.message, "error"); })
      .finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [auth, onNotice]);

  const organization = control?.activeOrganization || null;
  const userOptions = users.map((user) => ({ value: String(user.id), label: user.displayName, description: user.email, icon: <UserAvatar user={user} size={24} /> }));
  const planOptions = (control?.plans || []).map((plan) => ({ value: plan.id, label: plan.name, description: plan.summary }));
  const workspaceIds = useMemo(() => new Set(editing?.workspaceIds || []), [editing?.workspaceIds]);
  const selectedPlan = (control?.plans || []).find((plan) => plan.id === editing?.planId) || null;

  async function save(event) {
    event.preventDefault(); setBusy(true);
    try {
      const result = editing.id ? await auth.updateCommercialOrganization(editing.id, editing) : await auth.createCommercialOrganization(editing);
      const organizationId = editing.id || result.organization?.id;
      if (organizationId) await auth.updateCommercialEntitlements(organizationId, {
        overrides: Object.fromEntries(editing.overrideKeys.map((key) => [key, editing.overrideValues[key]])),
        notes: editing.overrideNotes,
      });
      await refresh(); setEditing(null); onNotice?.("Customer control plane updated.");
    } catch (error) { onNotice?.(error.message, "error"); }
    finally { setBusy(false); }
  }

  async function updateOnboarding(stepKey, status) {
    if (!organization) return; setBusy(true);
    try { await auth.updateCommercialOnboarding(organization.id, stepKey, { status }); await refresh(); onNotice?.("Onboarding checklist updated."); }
    catch (error) { onNotice?.(error.message, "error"); } finally { setBusy(false); }
  }

  async function createRequest(event) {
    event.preventDefault(); if (!organization) return; setBusy(true);
    try { await auth.createCommercialServiceRequest(organization.id, requestDraft); await refresh(); setRequestDraft({ type: "support", subject: "", detail: "" }); onNotice?.("Customer request submitted."); }
    catch (error) { onNotice?.(error.message, "error"); } finally { setBusy(false); }
  }

  async function updateRequest(requestId, values) {
    if (!organization) return; setBusy(true);
    try { await auth.updateCommercialServiceRequest(organization.id, requestId, values); await refresh(); onNotice?.("Customer request updated."); }
    catch (error) { onNotice?.(error.message, "error"); } finally { setBusy(false); }
  }

  if (busy && !control) return <ControlAsyncState compact state="loading" title="Loading customer control plane" message="Reading organization ownership, plan posture, and usage." />;
  if (activeOnly) return <OrganizationOverview organization={organization} showCommercialIdentity={Boolean(control?.canManage)} requestTypes={control?.requestTypes || []} requestDraft={requestDraft} setRequestDraft={setRequestDraft} busy={busy} onUpdateOnboarding={updateOnboarding} onCreateRequest={createRequest} onUpdateRequest={updateRequest} />;
  return <section className="saas-control-plane" aria-label="SaaS control plane" data-saas-control-plane>
    <header className="saas-control-plane__header"><div><span>Commercial foundation</span><h3>Customer control plane</h3><p>Manual organizations, ownership, plans, usage, and onboarding. Billing and enforcement remain disabled.</p></div>{control?.canManage ? <button className="if-btn if-btn--primary" type="button" onClick={() => setEditing(organizationDraft(null, users, workspaces))}><Plus size={15} />Create organization</button> : null}</header>
    <div className="saas-control-plane__organizations">{(control?.organizations || []).map((item) => <article key={item.id} className="saas-organization-card" data-commercial-organization={item.id}>
      <header><span className="saas-organization-card__icon"><Building2 size={20} /></span><div><strong>{item.name}</strong><small>{item.workspaces.length} workspace{item.workspaces.length === 1 ? "" : "s"} · {item.usage.seats || 0} unique seat{item.usage.seats === 1 ? "" : "s"} · {item.usage.teams || 0} team{item.usage.teams === 1 ? "" : "s"}</small></div><span className="if-badge if-badge--info">{item.subscription.planName}</span><span className="if-badge if-badge--neutral">{item.lifecycleState}</span><span className="if-badge if-badge--neutral">Observe only</span>{control.canManage ? <button type="button" className="if-btn if-btn--secondary if-btn--sm" onClick={() => setEditing(organizationDraft(item, users, workspaces))}><Pencil size={14} />Configure</button> : null}</header>
      <div className="saas-organization-card__summary"><span><strong>{item.owners?.[0]?.displayName || "Not assigned"}</strong><small>Customer owner</small></span><span><strong>{item.serviceRequests?.filter((request) => !["resolved", "cancelled"].includes(request.status)).length || 0}</strong><small>Open requests</small></span><span><strong>{item.onboardingSteps?.filter((step) => ["completed", "waived"].includes(step.status)).length || 0}/{item.onboardingSteps?.length || 0}</strong><small>Onboarding</small></span></div>
    </article>)}</div>
    {editing ? <ControlDialog open onClose={() => setEditing(null)} title={editing.id ? `Configure ${editing.name}` : "Create organization"} eyebrow="Platform administration" summary="Define the customer owner, manual plan, lifecycle, and workspace boundary. No payment or automated gating occurs." size="wide" dialogRef={dialogRef} surfaceProps={{ "data-commercial-organization-dialog": true }} footer={<><button type="button" className="if-btn" onClick={() => setEditing(null)}>Cancel</button><button type="submit" form="commercial-organization-form" className="if-btn if-btn--primary" disabled={busy}><Save size={14} />{editing.id ? "Save organization" : "Create organization"}</button></>}>
      <form id="commercial-organization-form" className="if-form-grid" onSubmit={save}>
        <label className="if-field"><span className="if-field__label">Organization name</span><input className="if-input" required minLength={2} value={editing.name} onChange={(event) => setEditing((current) => ({ ...current, name: event.target.value }))} /></label>
        <label className="if-field"><span className="if-field__label">Billing contact <span className="if-field__hint">(optional)</span></span><input className="if-input" type="email" value={editing.billingEmail} onChange={(event) => setEditing((current) => ({ ...current, billingEmail: event.target.value }))} /></label>
        <div className="if-field"><span className="if-field__label">Customer owner</span><ControlSelect ariaLabel="Customer organization owner" searchable value={editing.ownerUserId} options={userOptions} onChange={(ownerUserId) => setEditing((current) => ({ ...current, ownerUserId }))} portalTarget={dialogRef} /></div>
        <div className="if-field"><span className="if-field__label">Lifecycle</span><ControlSelect ariaLabel="Organization lifecycle" value={editing.lifecycleState} options={LIFECYCLE_OPTIONS} onChange={(lifecycleState) => setEditing((current) => ({ ...current, lifecycleState }))} portalTarget={dialogRef} /></div>
        <div className="if-field if-field--full"><span className="if-field__label">Manual plan</span><ControlSelect ariaLabel="Commercial plan" value={editing.planId} options={planOptions} onChange={(planId) => setEditing((current) => ({ ...current, planId }))} portalTarget={dialogRef} /></div>
        <fieldset className="if-field if-field--full saas-workspace-picker"><legend className="if-field__label">Workspaces</legend>{workspaces.map((workspace) => <label className="if-checkbox" key={workspace.id}><input type="checkbox" checked={workspaceIds.has(String(workspace.id))} onChange={(event) => setEditing((current) => ({ ...current, workspaceIds: event.target.checked ? [...new Set([...current.workspaceIds, String(workspace.id)])] : current.workspaceIds.filter((id) => id !== String(workspace.id)) }))} /><span><strong>{workspace.name}</strong><small>{workspace.description || "Shared intelligence workspace"}</small></span></label>)}</fieldset>
        <fieldset className="if-field if-field--full saas-entitlement-overrides"><legend className="if-field__label">Manual entitlement overrides</legend><p>Leave a capability on the plan default unless this customer needs a deliberate exception.</p>{Object.entries(selectedPlan?.entitlements || {}).map(([key, defaultValue]) => {
          const enabled = editing.overrideKeys.includes(key); const value = enabled ? editing.overrideValues[key] : defaultValue;
          return <div key={key} data-entitlement-override={key}><label className="if-checkbox"><input type="checkbox" checked={enabled} onChange={(event) => setEditing((current) => ({ ...current, overrideKeys: event.target.checked ? [...new Set([...current.overrideKeys, key])] : current.overrideKeys.filter((item) => item !== key), overrideValues: event.target.checked ? { ...current.overrideValues, [key]: defaultValue } : current.overrideValues }))} /><span><strong>{key.replace(/([A-Z])/g, " $1")}</strong><small>Plan default: {typeof defaultValue === "boolean" ? (defaultValue ? "Included" : "Unavailable") : Number(defaultValue).toLocaleString()}</small></span></label>{enabled ? typeof defaultValue === "boolean" ? <ControlSelect ariaLabel={`${key} override`} value={String(Boolean(value))} options={[{ value: "true", label: "Included" }, { value: "false", label: "Unavailable" }]} onChange={(next) => setEditing((current) => ({ ...current, overrideValues: { ...current.overrideValues, [key]: next === "true" } }))} portalTarget={dialogRef} /> : <input className="if-input" type="number" min="0" step="1" aria-label={`${key} override`} value={Number(value ?? defaultValue)} onChange={(event) => setEditing((current) => ({ ...current, overrideValues: { ...current.overrideValues, [key]: Number(event.target.value) } }))} /> : null}</div>;
        })}</fieldset>
        <p className="if-alert if-alert--info if-field--full">Entitlements are observe-only in this release. Existing users and workspaces remain usable even when a pilot limit would have been exceeded.</p>
      </form>
    </ControlDialog> : null}
  </section>;
}
