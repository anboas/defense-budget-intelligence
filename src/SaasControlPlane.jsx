import { useEffect, useMemo, useRef, useState } from "react";
import { Building2, Check, Gauge, Pencil, Plus, Save, ShieldCheck } from "lucide-react";
import { ControlAsyncState, ControlDialog, ControlMetricStrip } from "control-surface-ui/react";
import ControlSelect from "./ControlSelect.jsx";
import UserAvatar from "./UserAvatar.jsx";

const LIFECYCLE_OPTIONS = [
  ["internal", "Internal"], ["prospect", "Prospect"], ["trial", "Trial"], ["active", "Active"],
  ["grace", "Grace"], ["suspended", "Suspended"], ["closed", "Closed"],
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

function OrganizationOverview({ organization, showCommercialIdentity = true }) {
  if (!organization) return <ControlAsyncState compact state="empty" title="Commercial model not linked" message="Attach this workspace to an organization before using customer controls." />;
  const usage = organization.usage || {};
  const onboardingComplete = Object.values(organization.onboarding || {}).filter(Boolean).length;
  return <div className="saas-overview" data-saas-overview={organization.id}>
    <section className="saas-identity if-analytics-panel if-analytics-panel--flat">
      <header className="if-analytics-panel__header"><div className="if-analytics-panel__heading"><span className="if-analytics-panel__eyebrow">Customer control plane</span><h3 className="if-analytics-panel__title">{organization.name}</h3><p className="if-analytics-panel__summary">{showCommercialIdentity ? "Organization ownership, plan posture, usage, and onboarding in one internal control surface." : "Plan posture and usage for this workspace."}</p></div><div className="saas-identity__status"><span className="if-badge if-badge--info">{organization.subscription?.planName || "Internal"}</span><span className={`if-badge ${organization.lifecycleState === "active" ? "if-badge--success" : "if-badge--warning"}`}>{organization.lifecycleState}</span><span className="if-badge if-badge--neutral">Observe only</span></div></header>
      <ControlMetricStrip label={`${organization.name} commercial summary`} items={[
        { id: "seats", label: "Seats", value: Number(usage.seats || 0), meta: `${organization.entitlements?.seats ?? "—"} available`, tone: "info" },
        { id: "workspaces", label: "Workspaces", value: Number(usage.workspaces || 0), meta: `${organization.entitlements?.workspaces ?? "—"} available`, tone: "purple" },
        { id: "teams", label: "Teams", value: Number(usage.teams || 0), meta: `${organization.entitlements?.teams ?? "—"} available`, tone: "gold" },
        { id: "onboarding", label: "Foundation", value: `${onboardingComplete}/4`, meta: "Onboarding signals", tone: onboardingComplete >= 3 ? "success" : "warning" },
      ]} />
    </section>
    <div className="saas-overview__grid">
      <section className="if-analytics-panel if-analytics-panel--flat" aria-label={`${organization.name} plan entitlements`}>
        <header className="if-analytics-panel__header"><div className="if-analytics-panel__heading"><h3 className="if-analytics-panel__title">Plan &amp; usage</h3><p className="if-analytics-panel__summary">Server-side limits are measured now. Customer-visible enforcement remains disabled.</p></div><Gauge size={20} /></header>
        <div className="saas-entitlements">{(organization.entitlementRows || []).map((row) => <article key={row.key} data-entitlement={row.key} data-entitlement-status={row.status}><span><strong>{row.label}</strong><small>{usageMeta(row)}</small></span><b>{valueLabel(row)}</b></article>)}</div>
      </section>
      <section className="if-analytics-panel if-analytics-panel--flat" aria-label={`${organization.name} onboarding readiness`}>
        <header className="if-analytics-panel__header"><div className="if-analytics-panel__heading"><h3 className="if-analytics-panel__title">Customer readiness</h3><p className="if-analytics-panel__summary">The current release creates the ownership and commercial boundary without billing or automatic suspension.</p></div><ShieldCheck size={20} /></header>
        <div className="saas-readiness">{[
          ["ownerAssigned", "Customer owner assigned"], ["workspaceAttached", "Workspace attached"], ["billingContactSet", "Billing contact recorded"], ["enforcementReady", "Commercial enforcement activated"],
        ].map(([key, label]) => <div key={key} data-readiness={key} data-complete={organization.onboarding?.[key] ? "true" : "false"}><span>{organization.onboarding?.[key] ? <Check size={16} /> : <span aria-hidden="true">○</span>}</span><strong>{label}</strong></div>)}</div>
        <p className="if-alert if-alert--info">Billing integration, invoices, checkout, and automated access enforcement are deliberately off. Existing access remains grandfathered.</p>
      </section>
    </div>
  </div>;
}

function organizationDraft(organization, users, workspaces) {
  return organization ? {
    id: organization.id, name: organization.name, billingEmail: organization.billingEmail || "", lifecycleState: organization.lifecycleState,
    planId: organization.subscription?.planId || "internal", ownerUserId: organization.owners?.[0]?.id || users[0]?.id || "",
    workspaceIds: organization.workspaces?.map((workspace) => String(workspace.id)) || [],
  } : { id: "", name: "", billingEmail: "", lifecycleState: "prospect", planId: "pilot", ownerUserId: users[0]?.id || "", workspaceIds: workspaces.length === 1 ? [String(workspaces[0].id)] : [] };
}

export default function SaasControlPlane({ auth, users = [], workspaces = [], activeOnly = false, onNotice }) {
  const [control, setControl] = useState(null);
  const [busy, setBusy] = useState(true);
  const [editing, setEditing] = useState(null);
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

  async function save(event) {
    event.preventDefault(); setBusy(true);
    try {
      if (editing.id) await auth.updateCommercialOrganization(editing.id, editing);
      else await auth.createCommercialOrganization(editing);
      await refresh(); setEditing(null); onNotice?.("Customer control plane updated.");
    } catch (error) { onNotice?.(error.message, "error"); }
    finally { setBusy(false); }
  }

  if (busy && !control) return <ControlAsyncState compact state="loading" title="Loading customer control plane" message="Reading organization ownership, plan posture, and usage." />;
  if (activeOnly) return <OrganizationOverview organization={organization} showCommercialIdentity={Boolean(control?.canManage)} />;
  return <section className="saas-control-plane" aria-label="SaaS control plane" data-saas-control-plane>
    <header className="saas-control-plane__header"><div><span>Commercial foundation</span><h3>Customer control plane</h3><p>Manual organizations, ownership, plans, usage, and onboarding. Billing and enforcement remain disabled.</p></div>{control?.canManage ? <button className="if-btn if-btn--primary" type="button" onClick={() => setEditing(organizationDraft(null, users, workspaces))}><Plus size={15} />Create organization</button> : null}</header>
    <div className="saas-control-plane__organizations">{(control?.organizations || []).map((item) => <article key={item.id} className="saas-organization-card" data-commercial-organization={item.id}>
      <header><span className="saas-organization-card__icon"><Building2 size={20} /></span><div><strong>{item.name}</strong><small>{item.workspaces.length} workspace{item.workspaces.length === 1 ? "" : "s"} · {item.usage.seats || 0} unique seat{item.usage.seats === 1 ? "" : "s"} · {item.usage.teams || 0} team{item.usage.teams === 1 ? "" : "s"}</small></div><span className="if-badge if-badge--info">{item.subscription.planName}</span><span className="if-badge if-badge--neutral">{item.lifecycleState}</span><span className="if-badge if-badge--neutral">Observe only</span>{control.canManage ? <button type="button" className="if-btn if-btn--secondary if-btn--sm" onClick={() => setEditing(organizationDraft(item, users, workspaces))}><Pencil size={14} />Configure</button> : null}</header>
      <div className="saas-organization-card__summary"><span><strong>{item.owners?.[0]?.displayName || "Not assigned"}</strong><small>Customer owner</small></span><span><strong>{item.billingEmail || "Not recorded"}</strong><small>Billing contact</small></span><span><strong>{Object.values(item.onboarding || {}).filter(Boolean).length}/4</strong><small>Readiness signals</small></span></div>
    </article>)}</div>
    {editing ? <ControlDialog open onClose={() => setEditing(null)} title={editing.id ? `Configure ${editing.name}` : "Create organization"} eyebrow="Platform administration" summary="Define the customer owner, manual plan, lifecycle, and workspace boundary. No payment or automated gating occurs." size="wide" dialogRef={dialogRef} surfaceProps={{ "data-commercial-organization-dialog": true }} footer={<><button type="button" className="if-btn" onClick={() => setEditing(null)}>Cancel</button><button type="submit" form="commercial-organization-form" className="if-btn if-btn--primary" disabled={busy}><Save size={14} />{editing.id ? "Save organization" : "Create organization"}</button></>}>
      <form id="commercial-organization-form" className="if-form-grid" onSubmit={save}>
        <label className="if-field"><span className="if-field__label">Organization name</span><input className="if-input" required minLength={2} value={editing.name} onChange={(event) => setEditing((current) => ({ ...current, name: event.target.value }))} /></label>
        <label className="if-field"><span className="if-field__label">Billing contact <span className="if-field__hint">(optional)</span></span><input className="if-input" type="email" value={editing.billingEmail} onChange={(event) => setEditing((current) => ({ ...current, billingEmail: event.target.value }))} /></label>
        <div className="if-field"><span className="if-field__label">Customer owner</span><ControlSelect ariaLabel="Customer organization owner" searchable value={editing.ownerUserId} options={userOptions} onChange={(ownerUserId) => setEditing((current) => ({ ...current, ownerUserId }))} portalTarget={dialogRef} /></div>
        <div className="if-field"><span className="if-field__label">Lifecycle</span><ControlSelect ariaLabel="Organization lifecycle" value={editing.lifecycleState} options={LIFECYCLE_OPTIONS} onChange={(lifecycleState) => setEditing((current) => ({ ...current, lifecycleState }))} portalTarget={dialogRef} /></div>
        <div className="if-field if-field--full"><span className="if-field__label">Manual plan</span><ControlSelect ariaLabel="Commercial plan" value={editing.planId} options={planOptions} onChange={(planId) => setEditing((current) => ({ ...current, planId }))} portalTarget={dialogRef} /></div>
        <fieldset className="if-field if-field--full saas-workspace-picker"><legend className="if-field__label">Workspaces</legend>{workspaces.map((workspace) => <label className="if-checkbox" key={workspace.id}><input type="checkbox" checked={workspaceIds.has(String(workspace.id))} onChange={(event) => setEditing((current) => ({ ...current, workspaceIds: event.target.checked ? [...new Set([...current.workspaceIds, String(workspace.id)])] : current.workspaceIds.filter((id) => id !== String(workspace.id)) }))} /><span><strong>{workspace.name}</strong><small>{workspace.description || "Shared intelligence workspace"}</small></span></label>)}</fieldset>
        <p className="if-alert if-alert--info if-field--full">Entitlements are observe-only in this release. Existing users and workspaces remain usable even when a pilot limit would have been exceeded.</p>
      </form>
    </ControlDialog> : null}
  </section>;
}
