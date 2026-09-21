import { useEffect, useMemo, useRef, useState } from "react";
import { Building2, Check, Circle, LifeBuoy, Pencil, Plus, Save, Send, ShieldCheck, X } from "lucide-react";
import { ControlAsyncState, ControlDialog, ControlDisclosure, ControlMetricStrip, ControlStatusBadge } from "control-surface-ui/react";
import ControlSelect from "./ControlSelect.jsx";
import UserAvatar from "./UserAvatar.jsx";

const LIFECYCLE_OPTIONS = [
  ["internal", "Internal"], ["prospect", "Prospect"], ["trial", "Trial"], ["active", "Active"],
  ["grace", "Grace"], ["suspended", "Suspended"], ["closed", "Closed"],
].map(([value, label]) => ({ value, label }));

const REQUEST_STATUS_OPTIONS = [
  ["open", "Open"], ["in_progress", "In progress"], ["waiting", "Waiting"], ["resolved", "Resolved"], ["cancelled", "Cancelled"],
].map(([value, label]) => ({ value, label }));

function titleLabel(value) {
  return String(value || "").replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function lifecycleStatus(value) {
  return ({ active: "active", internal: "info", prospect: "pending", trial: "running", grace: "needs_review", suspended: "blocked", closed: "inactive" })[value] || "inactive";
}

function requestStatus(value) {
  return ({ open: "active", in_progress: "running", waiting: "needs_review", resolved: "completed", cancelled: "cancelled" })[value] || value;
}

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
  const steps = organization.onboardingSteps || [];
  const complete = steps.filter((step) => ["completed", "waived"].includes(step.status)).length;
  return <section className="saas-section" aria-label={`${organization.name} onboarding checklist`}>
    <header className="saas-section__header"><div><h3>Onboarding</h3><p>{complete} of {steps.length} operating steps complete.</p></div><ControlStatusBadge status={complete === steps.length ? "completed" : "in progress"} label={complete === steps.length ? "Ready" : `${steps.length - complete} remaining`} /></header>
    <div className="saas-onboarding-steps">{steps.map((step) => {
      const done = ["completed", "waived"].includes(step.status);
      return <article key={step.key} data-onboarding-step={step.key} data-status={step.status}>
        <span className="saas-onboarding-steps__state">{done ? <Check size={15} /> : <Circle size={15} />}</span>
        <span><strong>{step.label}</strong><small>{step.description}</small>{step.note ? <em>{step.note}</em> : null}</span>
        {organization.canManageOrganization ? <button type="button" className="if-btn if-btn--secondary if-btn--sm" disabled={busy} onClick={() => onUpdate(step.key, done ? "pending" : "completed")}>{done ? "Reopen" : "Complete"}</button> : <ControlStatusBadge status={done ? "completed" : "pending"} label={titleLabel(step.status)} />}
      </article>;
    })}</div>
  </section>;
}

function PlanUsagePanel({ organization }) {
  const metered = (organization.entitlementRows || []).filter((row) => row.usage !== null);
  const policies = (organization.entitlementRows || []).filter((row) => row.usage === null);
  return <section className="saas-section" aria-label={`${organization.name} plan entitlements`}>
    <header className="saas-section__header"><div><h3>Plan &amp; usage</h3><p>Measured against the manual plan. Limits remain observe-only.</p></div><ControlStatusBadge status="info" label={organization.subscription?.planName || "Internal"} /></header>
    <div className="saas-usage-list">{metered.map((row) => <article key={row.key} data-entitlement={row.key} data-entitlement-status={row.status}>
      <span><strong>{row.label}</strong><small>{usageMeta(row)}</small></span><b>{valueLabel(row)}</b>
      <progress value={Math.min(Number(row.usage || 0), Math.max(1, Number(row.value || 1)))} max={Math.max(1, Number(row.value || 1))} aria-label={`${row.label}: ${usageMeta(row)}`} />
    </article>)}</div>
    {policies.length ? <ControlDisclosure className="saas-plan-policies" title={`Plan capabilities (${policies.length})`} summary="Retention, refresh cadence, exports, API access, and branding">
      <dl>{policies.map((row) => <div key={row.key} data-entitlement={row.key} data-entitlement-status={row.status}><dt>{row.label}</dt><dd>{valueLabel(row)}</dd></div>)}</dl>
    </ControlDisclosure> : null}
  </section>;
}

function ServiceRequestsPanel({ organization, busy, onOpen, onUpdate }) {
  const requests = organization.serviceRequests || [];
  const openCount = requests.filter((request) => !["resolved", "cancelled"].includes(request.status)).length;
  return <section className="saas-section" aria-label={`${organization.name} support and data requests`}>
    <header className="saas-section__header"><div><h3>Requests</h3><p>{openCount ? `${openCount} open customer request${openCount === 1 ? "" : "s"}.` : "Support, data, closure, and ownership requests."}</p></div><button type="button" className="if-btn if-btn--primary if-btn--sm" onClick={onOpen}><Plus size={14} />New request</button></header>
    {requests.length ? <div className="saas-service-requests">{requests.map((request) => <article key={request.id} data-service-request={request.id} data-status={request.status}>
      <div><strong>{request.subject}</strong><small>{titleLabel(request.type)} · {request.requesterName}</small>{request.detail ? <p>{request.detail}</p> : null}{request.resolutionNote ? <em>{request.resolutionNote}</em> : null}</div>
      <ControlStatusBadge status={requestStatus(request.status)} label={titleLabel(request.status)} />
      {organization.canManageOrganization ? <ControlSelect compact ariaLabel={`Status for ${request.subject}`} value={request.status} options={REQUEST_STATUS_OPTIONS} onChange={(status) => onUpdate(request.id, { status })} /> : null}
      {request.requestedBy && !organization.canManageOrganization && ["open", "waiting"].includes(request.status) ? <button type="button" className="if-btn if-btn--ghost if-btn--sm" onClick={() => onUpdate(request.id, { status: "cancelled" })} disabled={busy}><X size={14} />Cancel</button> : null}
    </article>)}</div> : <p className="saas-empty-state"><LifeBuoy size={16} />No requests yet. Create one for support, data, closure, or ownership help.</p>}
  </section>;
}

function OrganizationOverview({ organization, showCommercialIdentity = true, busy, onUpdateOnboarding, onOpenRequest, onUpdateRequest }) {
  if (!organization) return <ControlAsyncState compact state="empty" title="Customer organization not linked" message="Attach this workspace to an organization before using customer controls." />;
  const usage = organization.usage || {};
  const steps = organization.onboardingSteps || [];
  const onboardingComplete = steps.filter((step) => ["completed", "waived"].includes(step.status)).length;
  const readiness = organization.onboarding || {};
  const readinessComplete = ["ownerAssigned", "workspaceAttached", "planAssigned", "accessPreserved"].every((key) => readiness[key]);
  return <div className="saas-overview" data-saas-overview={organization.id}>
    <section className="saas-customer-header">
      <header><div><span>Customer workspace</span><h3>{organization.name}</h3><p>{showCommercialIdentity ? "Ownership, readiness, usage, and service operations." : "Plan posture, usage, and service operations."}</p></div><div className="saas-identity__status"><ControlStatusBadge status="info" label={`${organization.subscription?.planName || "Internal"} plan`} />{organization.lifecycleState !== "internal" ? <ControlStatusBadge status={lifecycleStatus(organization.lifecycleState)} label={titleLabel(organization.lifecycleState)} /> : null}<ControlStatusBadge status={readinessComplete ? "completed" : "needs review"} label={readinessComplete ? "Ready" : "Setup needed"} /></div></header>
      <ControlMetricStrip compactMobile label={`${organization.name} customer summary`} items={[
        { id: "seats", label: "Seats", value: Number(usage.seats || 0), meta: `${organization.entitlements?.seats ?? "—"} available`, tone: "info" },
        { id: "workspaces", label: "Workspaces", value: Number(usage.workspaces || 0), meta: `${organization.entitlements?.workspaces ?? "—"} available`, tone: "purple" },
        { id: "teams", label: "Teams", value: Number(usage.teams || 0), meta: `${organization.entitlements?.teams ?? "—"} available`, tone: "gold" },
        { id: "onboarding", label: "Onboarding", value: `${onboardingComplete}/${steps.length}`, meta: onboardingComplete === steps.length ? "Ready" : "Operating steps", tone: onboardingComplete === steps.length ? "success" : "warning" },
      ]} />
    </section>
    <div className="saas-overview__grid">
      <PlanUsagePanel organization={organization} />
      <OnboardingPanel organization={organization} busy={busy} onUpdate={onUpdateOnboarding} />
      <ServiceRequestsPanel organization={organization} busy={busy} onOpen={onOpenRequest} onUpdate={onUpdateRequest} />
    </div>
    <p className="saas-payment-boundary"><ShieldCheck size={15} />Manual customer operations only. Payments, checkout, invoices, and card handling are not enabled.</p>
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
  const [requesting, setRequesting] = useState(false);
  const [requestDraft, setRequestDraft] = useState({ type: "support", subject: "", detail: "" });
  const dialogRef = useRef(null);
  const requestDialogRef = useRef(null);

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
  const requestTypeOptions = (control?.requestTypes || []).map((item) => ({ value: item.id, label: item.label }));

  async function save(event) {
    event.preventDefault(); setBusy(true);
    try {
      const result = editing.id ? await auth.updateCommercialOrganization(editing.id, editing) : await auth.createCommercialOrganization(editing);
      const organizationId = editing.id || result.organization?.id;
      if (organizationId) await auth.updateCommercialEntitlements(organizationId, {
        overrides: Object.fromEntries(editing.overrideKeys.map((key) => [key, editing.overrideValues[key]])),
        notes: editing.overrideNotes,
      });
      await refresh(); setEditing(null); onNotice?.("Customer organization updated.");
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
    try { await auth.createCommercialServiceRequest(organization.id, requestDraft); await refresh(); setRequestDraft({ type: "support", subject: "", detail: "" }); setRequesting(false); onNotice?.("Customer request submitted."); }
    catch (error) { onNotice?.(error.message, "error"); } finally { setBusy(false); }
  }

  async function updateRequest(requestId, values) {
    if (!organization) return; setBusy(true);
    try { await auth.updateCommercialServiceRequest(organization.id, requestId, values); await refresh(); onNotice?.("Customer request updated."); }
    catch (error) { onNotice?.(error.message, "error"); } finally { setBusy(false); }
  }

  if (busy && !control) return <ControlAsyncState compact state="loading" title="Loading customer controls" message="Reading ownership, plan posture, usage, and service operations." />;
  if (activeOnly) return <>
    <OrganizationOverview organization={organization} showCommercialIdentity={Boolean(control?.canManage)} busy={busy} onUpdateOnboarding={updateOnboarding} onOpenRequest={() => setRequesting(true)} onUpdateRequest={updateRequest} />
    {requesting ? <ControlDialog open onClose={() => setRequesting(false)} title="New customer request" eyebrow="Support & data" summary="Ask for support, data access, account closure, or an ownership change." dialogRef={requestDialogRef} surfaceProps={{ "data-customer-request-dialog": true }} footer={<><button type="button" className="if-btn" onClick={() => setRequesting(false)}>Cancel</button><button type="submit" form="customer-request-form" className="if-btn if-btn--primary" disabled={busy}><Send size={14} />Submit request</button></>}>
      <form id="customer-request-form" className="if-form-grid" onSubmit={createRequest}>
        <div className="if-field"><span className="if-field__label">Request type</span><ControlSelect ariaLabel="Customer request type" value={requestDraft.type} options={requestTypeOptions} onChange={(type) => setRequestDraft((current) => ({ ...current, type }))} portalTarget={requestDialogRef} /></div>
        <label className="if-field"><span className="if-field__label">Subject</span><input className="if-input" required minLength={3} maxLength={140} value={requestDraft.subject} onChange={(event) => setRequestDraft((current) => ({ ...current, subject: event.target.value }))} /></label>
        <label className="if-field if-field--full"><span className="if-field__label">Details</span><textarea className="if-textarea" rows={4} maxLength={4000} value={requestDraft.detail} onChange={(event) => setRequestDraft((current) => ({ ...current, detail: event.target.value }))} /></label>
      </form>
    </ControlDialog> : null}
  </>;

  return <section className="saas-control-plane" aria-label="Customer organizations" data-saas-control-plane>
    <header className="saas-control-plane__header"><div><span>Customer operations</span><h3>Organizations</h3><p>Ownership, manual plans, readiness, usage, and service requests. Payments remain disabled.</p></div>{control?.canManage ? <button className="if-btn if-btn--primary" type="button" onClick={() => setEditing(organizationDraft(null, users, workspaces))}><Plus size={15} />Create organization</button> : null}</header>
    {(control?.organizations || []).length ? <div className="saas-organization-list">{control.organizations.map((item) => {
      const openRequests = item.serviceRequests?.filter((request) => !["resolved", "cancelled"].includes(request.status)).length || 0;
      const complete = item.onboardingSteps?.filter((step) => ["completed", "waived"].includes(step.status)).length || 0;
      return <article key={item.id} className="saas-organization-row" data-commercial-organization={item.id}>
        <span className="saas-organization-row__icon"><Building2 size={18} /></span>
        <div className="saas-organization-row__identity"><strong>{item.name}</strong><small>{item.owners?.[0]?.displayName || "Owner not assigned"} · {item.workspaces.length} workspace{item.workspaces.length === 1 ? "" : "s"}</small></div>
        <div className="saas-organization-row__status"><ControlStatusBadge status="info" label={`${item.subscription.planName} plan`} />{item.lifecycleState !== "internal" ? <ControlStatusBadge status={lifecycleStatus(item.lifecycleState)} label={titleLabel(item.lifecycleState)} /> : null}</div>
        <dl className="saas-organization-row__facts"><div><dt>Seats</dt><dd>{item.usage.seats || 0}</dd></div><div><dt>Teams</dt><dd>{item.usage.teams || 0}</dd></div><div><dt>Onboarding</dt><dd>{complete}/{item.onboardingSteps?.length || 0}</dd></div><div><dt>Requests</dt><dd>{openRequests}</dd></div></dl>
        {control.canManage ? <button type="button" className="if-btn if-btn--secondary if-btn--sm" onClick={() => setEditing(organizationDraft(item, users, workspaces))}><Pencil size={14} />Configure</button> : null}
      </article>;
    })}</div> : <ControlAsyncState compact state="empty" icon={<Building2 size={20} />} title="No customer organizations" message="Create an organization to assign ownership, workspaces, and a manual plan." />}

    {editing ? <ControlDialog open onClose={() => setEditing(null)} title={editing.id ? `Configure ${editing.name}` : "Create organization"} eyebrow="Platform administration" summary="Define customer ownership, lifecycle, plan, and workspace scope. Payments and automated gating remain disabled." size="wide" dialogRef={dialogRef} surfaceProps={{ "data-commercial-organization-dialog": true }} footer={<><button type="button" className="if-btn" onClick={() => setEditing(null)}>Cancel</button><button type="submit" form="commercial-organization-form" className="if-btn if-btn--primary" disabled={busy}><Save size={14} />{editing.id ? "Save organization" : "Create organization"}</button></>}>
      <form id="commercial-organization-form" className="if-form-grid" onSubmit={save}>
        <label className="if-field"><span className="if-field__label">Organization name</span><input className="if-input" required minLength={2} value={editing.name} onChange={(event) => setEditing((current) => ({ ...current, name: event.target.value }))} /></label>
        <label className="if-field"><span className="if-field__label">Commercial contact <span className="if-field__hint">(optional)</span></span><input className="if-input" type="email" value={editing.billingEmail} onChange={(event) => setEditing((current) => ({ ...current, billingEmail: event.target.value }))} /></label>
        <div className="if-field"><span className="if-field__label">Customer owner</span><ControlSelect ariaLabel="Customer organization owner" searchable value={editing.ownerUserId} options={userOptions} onChange={(ownerUserId) => setEditing((current) => ({ ...current, ownerUserId }))} portalTarget={dialogRef} /></div>
        <div className="if-field"><span className="if-field__label">Lifecycle</span><ControlSelect ariaLabel="Organization lifecycle" value={editing.lifecycleState} options={LIFECYCLE_OPTIONS} onChange={(lifecycleState) => setEditing((current) => ({ ...current, lifecycleState }))} portalTarget={dialogRef} /></div>
        <div className="if-field if-field--full"><span className="if-field__label">Manual plan</span><ControlSelect ariaLabel="Commercial plan" value={editing.planId} options={planOptions} onChange={(planId) => setEditing((current) => ({ ...current, planId }))} portalTarget={dialogRef} /></div>
        <fieldset className="if-field if-field--full saas-workspace-picker"><legend className="if-field__label">Workspaces</legend>{workspaces.map((workspace) => <label className="if-checkbox" key={workspace.id}><input type="checkbox" checked={workspaceIds.has(String(workspace.id))} onChange={(event) => setEditing((current) => ({ ...current, workspaceIds: event.target.checked ? [...new Set([...current.workspaceIds, String(workspace.id)])] : current.workspaceIds.filter((id) => id !== String(workspace.id)) }))} /><span><strong>{workspace.name}</strong><small>{workspace.description || "Shared intelligence workspace"}</small></span></label>)}</fieldset>
        <ControlDisclosure className="if-field--full saas-entitlement-overrides" title={`Manual entitlement overrides (${editing.overrideKeys.length})`} summary="Use plan defaults unless this customer needs a deliberate exception">
          <div className="saas-entitlement-overrides__list">{Object.entries(selectedPlan?.entitlements || {}).map(([key, defaultValue]) => {
            const enabled = editing.overrideKeys.includes(key); const value = enabled ? editing.overrideValues[key] : defaultValue;
            return <div key={key} data-entitlement-override={key}><label className="if-checkbox"><input type="checkbox" checked={enabled} onChange={(event) => setEditing((current) => ({ ...current, overrideKeys: event.target.checked ? [...new Set([...current.overrideKeys, key])] : current.overrideKeys.filter((item) => item !== key), overrideValues: event.target.checked ? { ...current.overrideValues, [key]: defaultValue } : current.overrideValues }))} /><span><strong>{titleLabel(key.replace(/([A-Z])/g, " $1"))}</strong><small>Plan default: {typeof defaultValue === "boolean" ? (defaultValue ? "Included" : "Unavailable") : Number(defaultValue).toLocaleString()}</small></span></label>{enabled ? typeof defaultValue === "boolean" ? <ControlSelect ariaLabel={`${key} override`} value={String(Boolean(value))} options={[{ value: "true", label: "Included" }, { value: "false", label: "Unavailable" }]} onChange={(next) => setEditing((current) => ({ ...current, overrideValues: { ...current.overrideValues, [key]: next === "true" } }))} portalTarget={dialogRef} /> : <input className="if-input" type="number" min="0" step="1" aria-label={`${key} override`} value={Number(value ?? defaultValue)} onChange={(event) => setEditing((current) => ({ ...current, overrideValues: { ...current.overrideValues, [key]: Number(event.target.value) } }))} /> : null}</div>;
          })}</div>
        </ControlDisclosure>
        <p className="saas-form-note if-field--full">Entitlements remain observe-only. Existing users and workspaces stay usable when a pilot limit would have been exceeded.</p>
      </form>
    </ControlDialog> : null}
  </section>;
}
