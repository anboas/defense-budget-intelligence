import { useCallback, useEffect, useRef, useState } from "react";
import { KeyRound, RefreshCw, ShieldCheck, Trash2 } from "lucide-react";
import { ControlAsyncState, ControlDialog, ControlDisclosure, ControlMetricStrip, ControlPageHeader, useToast } from "control-surface-ui/react";

function dateLabel(value) {
  if (!value) return "Never used";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Unavailable" : date.toLocaleString([], { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
}

export default function SamGovKeyManagement({ auth, embedded = false }) {
  const [credentials, setCredentials] = useState([]);
  const [capability, setCapability] = useState(null);
  const [busy, setBusy] = useState(true);
  const [editing, setEditing] = useState(false);
  const dialogRef = useRef(null);
  const { showToast } = useToast();
  const active = credentials.find((credential) => credential.status === "active");
  const revoked = credentials.filter((credential) => credential.status === "revoked");

  const notice = useCallback((message, tone = "success") => showToast({
    tone: tone === "error" ? "danger" : tone,
    title: tone === "error" ? "Action needed" : "SAM.gov credential updated",
    message,
  }), [showToast]);

  const refresh = useCallback(async () => {
    setBusy(true);
    try {
      const result = await auth.listProviderCredentials("sam-gov");
      setCapability(result.capability || null);
      setCredentials(result.credentials || []);
    } catch (error) {
      notice(error.message, "error");
    } finally {
      setBusy(false);
    }
  }, [auth, notice]);

  useEffect(() => {
    let cancelled = false;
    auth.listProviderCredentials("sam-gov").then((result) => {
      if (cancelled) return;
      setCapability(result.capability || null);
      setCredentials(result.credentials || []);
    }).catch((error) => {
      if (!cancelled) notice(error.message, "error");
    }).finally(() => {
      if (!cancelled) setBusy(false);
    });
    return () => { cancelled = true; };
  }, [auth, notice]);

  async function save(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    try {
      await auth.createProviderCredential("sam-gov", { label: form.get("label"), apiKey: form.get("apiKey") });
      setEditing(false);
      await refresh();
      notice(active ? "The workspace SAM.gov key was replaced. The previous key remains in the audit history." : "The workspace SAM.gov key was saved to the encrypted vault.");
    } catch (error) {
      notice(error.message, "error");
      setBusy(false);
    }
  }

  async function revoke() {
    if (!active) return;
    setBusy(true);
    try {
      await auth.revokeProviderCredential("sam-gov", active.id);
      await refresh();
      notice("The workspace SAM.gov key was revoked.");
    } catch (error) {
      notice(error.message, "error");
      setBusy(false);
    }
  }

  return <section data-sam-gov-key-management>
    <ControlPageHeader compact eyebrow="Workspace credential vault" title="SAM.gov API key" summary="One encrypted, write-only key shared by approved workspace integrations." headingLevel={embedded ? 3 : 2} actions={capability?.canManage ? <button type="button" className="if-btn if-btn--primary" onClick={() => setEditing(true)} disabled={busy}><RefreshCw size={15} aria-hidden="true" />{active ? "Replace key" : "Add key"}</button> : null} />
    <ControlMetricStrip label="SAM.gov credential summary" items={[
      { id: "status", label: "Credential", value: active ? "Configured" : "Not configured", meta: active ? `${active.label} · •••• ${active.lastFour}` : "No active workspace key", tone: active ? "success" : "warning" },
      { id: "vault", label: "Vault", value: capability?.encryptionReady ? "Ready" : "Unavailable", meta: "Encrypted, write-only storage", tone: capability?.encryptionReady ? "success" : "danger" },
      { id: "scope", label: "Scope", value: "Workspace", meta: "Managers can replace or revoke", tone: "info" },
    ]} />
    <div className={`if-alert ${capability?.encryptionReady ? "if-alert--success" : "if-alert--danger"}`} role="status">
      <ShieldCheck size={17} aria-hidden="true" /><div><strong>{capability?.encryptionReady ? "Encrypted workspace credential" : "Credential vault unavailable"}</strong><p>The key is never returned after save. Only its label, final four characters, and lifecycle dates remain visible.</p></div>
    </div>
    <section className="if-analytics-panel" aria-busy={busy}>
      <header className="if-analytics-panel__header"><div className="if-analytics-panel__heading"><h4 className="if-analytics-panel__title">Configured credential</h4><p className="if-analytics-panel__summary">SAM.gov allows one active key per workspace. Saving another key safely replaces the current one.</p></div><strong className="if-analytics-panel__count">{active ? 1 : 0}</strong></header>
      {busy && !credentials.length ? <ControlAsyncState compact state="loading" icon={<KeyRound size={22} />} title="Loading SAM.gov credential" message="Reading workspace credential metadata." /> : active ? <div className="if-action-row-list"><article className="if-action-row"><span className="if-icon-slot" aria-hidden="true"><KeyRound size={16} /></span><span><strong>{active.label} · •••• {active.lastFour}</strong><em>Added {dateLabel(active.createdAt)} · {active.lastUsedAt ? `Last used ${dateLabel(active.lastUsedAt)}` : "Never used"}</em></span><span className="if-badge if-badge--success">Active</span><span className="if-action-row__actions"><button type="button" className="if-icon-btn" onClick={() => void revoke()} disabled={busy} aria-label={`Revoke ${active.label}`} title={`Revoke ${active.label}`}><Trash2 size={14} aria-hidden="true" /></button></span></article></div> : <ControlAsyncState compact state="empty" icon={<KeyRound size={22} />} title="No workspace SAM.gov key" message="No automated or manual SAM.gov acquisition task can run for this workspace until a key is added." />}
      {revoked.length ? <ControlDisclosure title={`${revoked.length} revoked credential${revoked.length === 1 ? "" : "s"}`} summary="Inactive credentials retained for lifecycle audit"><div className="if-action-row-list">{revoked.map((credential) => <article className="if-action-row" key={credential.id}><span className="if-icon-slot" aria-hidden="true"><KeyRound size={15} /></span><span><strong>{credential.label} · •••• {credential.lastFour}</strong><em>Revoked {dateLabel(credential.revokedAt || credential.updatedAt)}</em></span><span className="if-badge">Revoked</span></article>)}</div></ControlDisclosure> : null}
    </section>
    <p className="if-detail-card__summary">This vault is the only credential source used by workspace SAM.gov ingestion. The scheduler selects only due workspaces with an active key; a workspace without one is skipped before any run or source request is created.</p>
    {editing ? <ControlDialog open onClose={() => setEditing(false)} title={active ? "Replace SAM.gov API key" : "Add SAM.gov API key"} eyebrow="Write-only encrypted vault" summary="The value can be submitted once and cannot be viewed after save." size="default" dialogRef={dialogRef} closeLabel="Close SAM.gov key form" surfaceProps={{ "data-sam-gov-key-dialog": true }} footer={<><button type="button" className="if-btn" onClick={() => setEditing(false)}>Cancel</button><button type="submit" className="if-btn if-btn--primary" form="sam-gov-key-form" disabled={busy || !capability?.encryptionReady}><KeyRound size={15} aria-hidden="true" />{active ? "Replace encrypted key" : "Save encrypted key"}</button></>}>
      <form id="sam-gov-key-form" className="if-form-grid" onSubmit={save}>
        <label className="if-field if-field--full"><span className="if-field__label">Key label</span><input className="if-input" name="label" required minLength={2} maxLength={80} autoComplete="off" defaultValue={active?.label || "Workspace SAM.gov"} /><small className="if-field__hint">A recognizable label visible to workspace managers.</small></label>
        <label className="if-field if-field--full"><span className="if-field__label">SAM.gov API key</span><input className="if-input" name="apiKey" required type="password" minLength={20} maxLength={160} autoComplete="off" spellCheck="false" placeholder="Paste key once" /><small className="if-field__hint">The value is encrypted server-side and never returned to the browser.</small></label>
      </form>
    </ControlDialog> : null}
  </section>;
}
