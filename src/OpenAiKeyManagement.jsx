import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Building2, CheckCircle2, KeyRound, Plus, ShieldCheck, Trash2, UserRound } from "lucide-react";
import { ControlAsyncState, ControlDialog, ControlDisclosure, ControlMetricStrip, ControlPageBody, ControlPageHeader, useToast } from "control-surface-ui/react";

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
  return <section className={embedded ? "openai-key-vault" : "if-operations-workspace"} data-openai-key-vault={scope} data-openai-key-embedded={embedded ? "true" : "false"} aria-labelledby={headingId}>
    {!embedded ? <ControlPageHeader compact divided eyebrow={personal ? "Personal credential vault" : "Workspace credential vault"} title={<><Icon size={18} aria-hidden="true" />{personal ? "My OpenAI keys" : `${workspace?.name || "Workspace"} OpenAI keys`}</>} summary={personal ? "Available only to contextual requests you initiate." : "Shared server-side credentials for approved workspace actions."} headingLevel={3} titleId={headingId} actions={canManage ? <button type="button" className="if-btn if-btn--primary" onClick={() => setAdding(true)} disabled={busy}><Plus size={15} aria-hidden="true" />Add key</button> : null} /> : null}
    <ControlPageBody compact>
      {embedded ? <ControlPageHeader compact eyebrow={personal ? "Personal credential vault" : "Workspace credential vault"} title={<><Icon size={18} aria-hidden="true" />Credential vault</>} summary={personal ? "Keys are available only to contextual requests you initiate." : `Shared credentials for approved ${workspace?.name || "workspace"} actions.`} headingLevel={3} titleId={headingId} actions={canManage ? <button type="button" className="if-btn if-btn--primary" onClick={() => setAdding(true)} disabled={busy}><Plus size={15} aria-hidden="true" />Add key</button> : null} /> : null}
      <ControlMetricStrip label="OpenAI key summary" items={[
        { id: "keys", label: "Active keys", value: active.length, meta: active.find((key) => key.isDefault)?.label || "No default selected", tone: "info" },
        { id: "vault", label: "Vault", value: capability?.encryptionReady ? "Ready" : "Unavailable", meta: "Encrypted, write-only storage", tone: capability?.encryptionReady ? "success" : "danger" },
        { id: "calls", label: "Logged calls", value: usage.requests.toLocaleString(), meta: `${usage.failures.toLocaleString()} failed in retained window` },
        { id: "tokens", label: "Token usage", value: (usage.inputTokens + usage.outputTokens).toLocaleString(), meta: `${usage.inputTokens.toLocaleString()} in · ${usage.outputTokens.toLocaleString()} out`, tone: "purple" },
      ]} />
      <div className={`if-alert ${capability?.encryptionReady ? "if-alert--success" : "if-alert--danger"}`} role="status"><ShieldCheck size={17} aria-hidden="true" /><div><strong>{capability?.encryptionReady ? "Write-only encrypted vault" : "Credential vault unavailable"}</strong><p>Secrets are never returned after save. Logs retain safe metadata, latency, tokens, provider IDs, and bounded errors for {capability?.retentionDays || 90} days, never keys, prompts, headers, or response bodies.</p></div><span className="if-badge if-badge--info">{capability?.queryRuntimeEnabled ? "Calls enabled" : "Management ready"}</span></div>

    <section className="if-analytics-panel" aria-busy={busy}>
      <header className="if-analytics-panel__header"><div className="if-analytics-panel__heading"><h4 className="if-analytics-panel__title">Configured credentials</h4><p className="if-analytics-panel__summary">Only labels, scope, final four characters, lifecycle dates, and aggregate usage are visible.</p></div><strong className="if-analytics-panel__count">{active.length}</strong></header>
      {busy && !keys.length ? <ControlAsyncState compact state="loading" icon={<KeyRound size={22} />} title="Loading key metadata" message="Reading the encrypted credential inventory." /> : !active.length ? <ControlAsyncState compact state="empty" icon={<KeyRound size={22} />} title={`No active ${personal ? "personal" : "workspace"} OpenAI keys`} message="Add a credential when you are ready to enable approved contextual actions." /> : <div className="if-action-row-list" data-openai-active-keys>
        {active.map((key) => <article key={key.id} className="if-action-row">
          <span className="if-icon-slot" aria-hidden="true"><KeyRound size={16} /></span>
          <span><strong>{key.label} · •••• {key.lastFour}</strong><em>{key.isDefault ? "Default credential" : "Active credential"} · Added {dateLabel(key.createdAt)} · {key.lastUsedAt ? `Last used ${dateLabel(key.lastUsedAt)}` : "Never used"}</em></span>
          <span className={`if-badge ${Number(key.usage?.failureCount || 0) ? "if-badge--warning" : "if-badge--info"}`}>{Number(key.usage?.requestCount || 0).toLocaleString()} calls · {Number(key.usage?.averageLatencyMs || 0).toLocaleString()} ms avg</span>
          {canManage ? <span className="if-action-row__actions">{!key.isDefault ? <button type="button" className="if-btn if-btn--secondary if-btn--sm" onClick={() => void makeDefault(key)} disabled={busy}><CheckCircle2 size={15} aria-hidden="true" />Make default</button> : null}<button type="button" className="if-icon-btn" onClick={() => void revoke(key)} disabled={busy} aria-label={`Revoke ${key.label}`} title={`Revoke ${key.label}`}><Trash2 size={14} aria-hidden="true" /></button></span> : null}
        </article>)}
      </div>}
      {revoked.length ? <ControlDisclosure title={`${revoked.length} revoked key${revoked.length === 1 ? "" : "s"}`} summary="Inactive credentials retained for lifecycle audit"><div className="if-action-row-list">{revoked.map((key) => <article className="if-action-row" key={key.id}><span className="if-icon-slot"><KeyRound size={15} /></span><span><strong>{key.label} · •••• {key.lastFour}</strong><em>Revoked {dateLabel(key.revokedAt || key.updatedAt)}</em></span><span className="if-badge">Revoked</span></article>)}</div></ControlDisclosure> : null}
    </section>
    </ControlPageBody>

    {adding ? <ControlDialog open onClose={() => setAdding(false)} title={`Add ${personal ? "personal" : "workspace"} OpenAI key`} eyebrow="Write-only encrypted vault" summary="The key can be submitted once. Only safe metadata will be shown after save." size="default" dialogRef={dialogRef} closeLabel="Close OpenAI key form" surfaceProps={{ "data-openai-key-dialog": scope }} footer={<><button type="button" className="if-btn" onClick={() => setAdding(false)}>Cancel</button><button type="submit" className="if-btn if-btn--primary" form={`openai-key-form-${scope}`} disabled={busy || !capability?.encryptionReady}><KeyRound size={15} aria-hidden="true" />Save encrypted key</button></>}>
      <form id={`openai-key-form-${scope}`} className="if-form-grid" onSubmit={createKey}>
        <label className="if-field if-field--full"><span className="if-field__label">Key label</span><input className="if-input" name="label" required minLength={2} maxLength={80} autoComplete="off" placeholder={personal ? "My project key" : "Workspace default"} /><small className="if-field__hint">A recognizable label visible to authorized operators.</small></label>
        <label className="if-field if-field--full"><span className="if-field__label">OpenAI API key</span><input className="if-input" name="apiKey" required type="password" minLength={23} maxLength={243} autoComplete="off" spellCheck="false" placeholder="Paste key once" /><small className="if-field__hint">The value is encrypted server-side and cannot be viewed after save.</small></label>
        <label className="if-card if-field--full"><input name="isDefault" type="checkbox" defaultChecked={!active.length} /> <strong>Use as default</strong><p className="if-field__hint">Approved actions can still target another configured key explicitly.</p></label>
      </form>
    </ControlDialog> : null}
  </section>;
}
