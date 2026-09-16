import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Building2, CheckCircle2, KeyRound, Plus, ShieldCheck, Trash2, UserRound } from "lucide-react";
import { ControlDialog, useToast } from "control-surface-ui/react";

function dateLabel(value) {
  if (!value) return "Never used";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Never used" : date.toLocaleString([], { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
}

export default function OpenAiKeyManagement({ auth, scope = "workspace", embedded = false }) {
  const [keys, setKeys] = useState([]);
  const [capability, setCapability] = useState(null);
  const [busy, setBusy] = useState(true);
  const [adding, setAdding] = useState(false);
  const dialogRef = useRef(null);
  const { showToast } = useToast();
  const workspace = auth?.user?.activeWorkspace;
  const personal = scope === "user";
  const canManage = personal || Boolean(capability?.canManageWorkspaceKeys);

  const showNotice = useCallback((text, tone = "success") => {
    showToast({
      tone: tone === "error" ? "danger" : tone,
      title: tone === "error" ? "Action needed" : "Credential updated",
      message: text,
    });
  }, [showToast]);

  async function refresh() {
    setBusy(true);
    try {
      const result = await auth.listOpenAiKeys();
      setCapability(result.capability || null);
      setKeys(personal ? result.personalKeys || [] : result.workspaceKeys || []);
    } catch (error) {
      showNotice(error.message, "error");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    auth.listOpenAiKeys().then((result) => {
      if (cancelled) return;
      setCapability(result.capability || null);
      setKeys(personal ? result.personalKeys || [] : result.workspaceKeys || []);
    }).catch((error) => {
      if (!cancelled) showNotice(error.message, "error");
    }).finally(() => {
      if (!cancelled) setBusy(false);
    });
    return () => { cancelled = true; };
  }, [auth, personal, showNotice]);
  async function createKey(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    setBusy(true);
    try {
      await auth.createOpenAiKey({
        scope,
        label: values.get("label"),
        apiKey: values.get("apiKey"),
        isDefault: values.get("isDefault") === "on",
      });
      form.reset();
      setAdding(false);
      showNotice(`${personal ? "Personal" : "Workspace"} OpenAI key saved.`);
      await refresh();
    } catch (error) {
      showNotice(error.message, "error");
      setBusy(false);
    }
  }

  async function makeDefault(key) {
    setBusy(true);
    try {
      await auth.updateOpenAiKey(key.id, { isDefault: true });
      showNotice(`${key.label} is now the default ${personal ? "personal" : "workspace"} key.`);
      await refresh();
    } catch (error) {
      showNotice(error.message, "error");
      setBusy(false);
    }
  }

  async function revoke(key) {
    setBusy(true);
    try {
      await auth.revokeOpenAiKey(key.id);
      showNotice(`${key.label} was revoked.`);
      await refresh();
    } catch (error) {
      showNotice(error.message, "error");
      setBusy(false);
    }
  }

  const active = keys.filter((key) => key.status === "active");
  const revoked = keys.filter((key) => key.status === "revoked");
  const usage = useMemo(() => active.reduce((summary, key) => ({
    requests: summary.requests + Number(key.usage?.requestCount || 0),
    failures: summary.failures + Number(key.usage?.failureCount || 0),
    inputTokens: summary.inputTokens + Number(key.usage?.inputTokens || 0),
    outputTokens: summary.outputTokens + Number(key.usage?.outputTokens || 0),
  }), { requests: 0, failures: 0, inputTokens: 0, outputTokens: 0 }), [active]);
  const Icon = personal ? UserRound : Building2;
  const headingId = `openai-${scope}-keys-title`;
  return <section className="if-operations-workspace" data-openai-key-vault={scope} data-openai-key-embedded={embedded ? "true" : "false"} aria-labelledby={headingId}>
    <section className="if-analytics-panel">
      <header className="if-analytics-panel__header">
        <div className="if-analytics-panel__heading"><span className="if-status if-status--info if-status--sm">{personal ? "Personal credential vault" : "Workspace credential vault"}</span><h3 className="if-analytics-panel__title" id={headingId}><Icon size={18} aria-hidden="true" />{personal ? "My OpenAI keys" : `${workspace?.name || "Workspace"} OpenAI keys`}</h3><p className="if-analytics-panel__summary">{personal ? "Available only to contextual requests you initiate." : "Shared server-side credentials for approved workspace actions."}</p></div>
        {canManage ? <button type="button" className="if-btn if-btn--primary" onClick={() => setAdding(true)} disabled={busy}><Plus size={15} aria-hidden="true" />Add key</button> : null}
      </header>
      <div className="if-management-grid" aria-label="OpenAI key summary">
        <article className="if-management-card if-tone-info"><span className="if-management-card__label">Active keys</span><strong className="if-management-card__value">{active.length}</strong><small className="if-management-card__meta">{active.find((key) => key.isDefault)?.label || "No default selected"}</small></article>
        <article className={`if-management-card ${capability?.encryptionReady ? "if-tone-success" : "if-tone-danger"}`}><span className="if-management-card__label">Vault</span><strong className="if-management-card__value">{capability?.encryptionReady ? "Ready" : "Unavailable"}</strong><small className="if-management-card__meta">Encrypted, write-only storage</small></article>
        <article className="if-management-card if-tone-neutral"><span className="if-management-card__label">Logged calls</span><strong className="if-management-card__value">{usage.requests.toLocaleString()}</strong><small className="if-management-card__meta">{usage.failures.toLocaleString()} failed in retained window</small></article>
        <article className="if-management-card if-tone-purple"><span className="if-management-card__label">Token usage</span><strong className="if-management-card__value">{(usage.inputTokens + usage.outputTokens).toLocaleString()}</strong><small className="if-management-card__meta">{usage.inputTokens.toLocaleString()} in · {usage.outputTokens.toLocaleString()} out</small></article>
      </div>
      <div className={`if-alert ${capability?.encryptionReady ? "if-alert--success" : "if-alert--danger"}`} role="status"><ShieldCheck size={17} aria-hidden="true" /><div><strong>{capability?.encryptionReady ? "Write-only encrypted vault" : "Credential vault unavailable"}</strong><p>Secrets are never returned after save. Logs retain safe metadata, latency, tokens, provider IDs, and bounded errors for {capability?.retentionDays || 90} days, never keys, prompts, headers, or response bodies.</p></div><span className="if-badge if-badge--info">{capability?.queryRuntimeEnabled ? "Calls enabled" : "Management ready"}</span></div>
    </section>

    <section className="if-analytics-panel" aria-busy={busy}>
      <header className="if-analytics-panel__header"><div className="if-analytics-panel__heading"><h4 className="if-analytics-panel__title">Configured credentials</h4><p className="if-analytics-panel__summary">Only labels, scope, final four characters, lifecycle dates, and aggregate usage are visible.</p></div><strong className="if-analytics-panel__count">{active.length}</strong></header>
      {busy && !keys.length ? <div className="ops-empty"><KeyRound size={22} aria-hidden="true" /><strong>Loading key metadata…</strong></div> : !active.length ? <div className="ops-empty"><KeyRound size={22} aria-hidden="true" /><strong>No active {personal ? "personal" : "workspace"} OpenAI keys</strong><p>Add a credential when you are ready to enable approved contextual actions.</p></div> : <div className="if-action-row-list" data-openai-active-keys>
        {active.map((key) => <article key={key.id} className="if-action-row">
          <span className="if-icon-slot" aria-hidden="true"><KeyRound size={16} /></span>
          <span><strong>{key.label} · •••• {key.lastFour}</strong><em>{key.isDefault ? "Default credential" : "Active credential"} · Added {dateLabel(key.createdAt)} · {key.lastUsedAt ? `Last used ${dateLabel(key.lastUsedAt)}` : "Never used"}</em></span>
          <span className={`if-badge ${Number(key.usage?.failureCount || 0) ? "if-badge--warning" : "if-badge--info"}`}>{Number(key.usage?.requestCount || 0).toLocaleString()} calls · {Number(key.usage?.averageLatencyMs || 0).toLocaleString()} ms avg</span>
          {canManage ? <span className="if-action-row__actions">{!key.isDefault ? <button type="button" className="if-btn if-btn--secondary if-btn--sm" onClick={() => void makeDefault(key)} disabled={busy}><CheckCircle2 size={15} aria-hidden="true" />Make default</button> : null}<button type="button" className="if-icon-btn" onClick={() => void revoke(key)} disabled={busy} aria-label={`Revoke ${key.label}`} title={`Revoke ${key.label}`}><Trash2 size={14} aria-hidden="true" /></button></span> : null}
        </article>)}
      </div>}
      {revoked.length ? <details className="if-detail-card if-detail-card--neutral"><summary>{revoked.length} revoked key{revoked.length === 1 ? "" : "s"}</summary><div className="if-action-row-list">{revoked.map((key) => <article className="if-action-row" key={key.id}><span className="if-icon-slot"><KeyRound size={15} /></span><span><strong>{key.label} · •••• {key.lastFour}</strong><em>Revoked {dateLabel(key.revokedAt || key.updatedAt)}</em></span><span className="if-badge">Revoked</span></article>)}</div></details> : null}
    </section>

    {adding ? <ControlDialog open onClose={() => setAdding(false)} title={`Add ${personal ? "personal" : "workspace"} OpenAI key`} eyebrow="Write-only encrypted vault" summary="The key can be submitted once. Only safe metadata will be shown after save." size="default" dialogRef={dialogRef} closeLabel="Close OpenAI key form" surfaceProps={{ "data-openai-key-dialog": scope }} footer={<><button type="button" className="if-btn" onClick={() => setAdding(false)}>Cancel</button><button type="submit" className="if-btn if-btn--primary" form={`openai-key-form-${scope}`} disabled={busy || !capability?.encryptionReady}><KeyRound size={15} aria-hidden="true" />Save encrypted key</button></>}>
      <form id={`openai-key-form-${scope}`} className="if-form-grid" onSubmit={createKey}>
        <label className="if-field if-field--full"><span className="if-field__label">Key label</span><input className="if-input" name="label" required minLength={2} maxLength={80} autoComplete="off" placeholder={personal ? "My project key" : "Workspace default"} /><small className="if-field__hint">A recognizable label visible to authorized operators.</small></label>
        <label className="if-field if-field--full"><span className="if-field__label">OpenAI API key</span><input className="if-input" name="apiKey" required type="password" minLength={23} maxLength={243} autoComplete="off" spellCheck="false" placeholder="Paste key once" /><small className="if-field__hint">The value is encrypted server-side and cannot be viewed after save.</small></label>
        <label className="if-card if-field--full"><input name="isDefault" type="checkbox" defaultChecked={!active.length} /> <strong>Use as default</strong><p className="if-field__hint">Approved actions can still target another configured key explicitly.</p></label>
      </form>
    </ControlDialog> : null}
  </section>;
}
