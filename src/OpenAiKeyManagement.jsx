import { useEffect, useState } from "react";
import { Building2, Check, KeyRound, Plus, ShieldCheck, Trash2, UserRound, X } from "lucide-react";

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
  const [notice, setNotice] = useState(null);
  const workspace = auth?.user?.activeWorkspace;
  const personal = scope === "user";
  const canManage = personal || Boolean(capability?.canManageWorkspaceKeys);

  async function refresh() {
    setBusy(true);
    try {
      const result = await auth.listOpenAiKeys();
      setCapability(result.capability || null);
      setKeys(personal ? result.personalKeys || [] : result.workspaceKeys || []);
    } catch (error) {
      setNotice({ tone: "error", text: error.message });
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
      if (!cancelled) setNotice({ tone: "error", text: error.message });
    }).finally(() => {
      if (!cancelled) setBusy(false);
    });
    return () => { cancelled = true; };
  }, [auth, personal]);
  useEffect(() => {
    if (!notice) return undefined;
    const timer = window.setTimeout(() => setNotice(null), 5000);
    return () => window.clearTimeout(timer);
  }, [notice]);

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
      setNotice({ tone: "success", text: `${personal ? "Personal" : "Workspace"} OpenAI key saved.` });
      await refresh();
    } catch (error) {
      setNotice({ tone: "error", text: error.message });
      setBusy(false);
    }
  }

  async function makeDefault(key) {
    setBusy(true);
    try {
      await auth.updateOpenAiKey(key.id, { isDefault: true });
      setNotice({ tone: "success", text: `${key.label} is now the default ${personal ? "personal" : "workspace"} key.` });
      await refresh();
    } catch (error) {
      setNotice({ tone: "error", text: error.message });
      setBusy(false);
    }
  }

  async function revoke(key) {
    setBusy(true);
    try {
      await auth.revokeOpenAiKey(key.id);
      setNotice({ tone: "success", text: `${key.label} was revoked.` });
      await refresh();
    } catch (error) {
      setNotice({ tone: "error", text: error.message });
      setBusy(false);
    }
  }

  const active = keys.filter((key) => key.status === "active");
  const revoked = keys.filter((key) => key.status === "revoked");
  const Icon = personal ? UserRound : Building2;
  return <section className={`openai-key-vault ${embedded ? "openai-key-vault--embedded" : ""}`} data-openai-key-vault={scope}>
    {notice ? <div className="if-toast-stack workspace-toast-stack" aria-live="polite"><div className={`if-toast workspace-toast is-${notice.tone}`} role={notice.tone === "error" ? "alert" : "status"}><span>{notice.tone === "error" ? <X size={17} /> : <Check size={17} />}</span><div><strong>{notice.tone === "error" ? "Action needed" : "Credential updated"}</strong><p>{notice.text}</p></div><button type="button" aria-label="Dismiss notification" onClick={() => setNotice(null)}><X size={15} /></button></div></div> : null}
    <header className="openai-key-vault__header"><span><Icon size={18} aria-hidden="true" /></span><div><small>{personal ? "Personal credential" : "Workspace credential"}</small><h3>{personal ? "My OpenAI keys" : `${workspace?.name || "Workspace"} OpenAI keys`}</h3><p>{personal ? "Available only to contextual requests you initiate." : "Shared server-side credentials for approved workspace actions."}</p></div>{canManage ? <button type="button" className="if-btn if-btn--primary" onClick={() => setAdding((value) => !value)} disabled={busy}><Plus size={15} />Add key</button> : null}</header>
    <div className="openai-key-vault__boundary"><ShieldCheck size={16} aria-hidden="true" /><p><strong>Write-only vault.</strong> Secret values are encrypted before storage, never returned to the browser, and will only be decrypted inside a future server-side OpenAI request.</p><span className={capability?.encryptionReady ? "is-ready" : "is-disabled"}>{capability?.encryptionReady ? "Vault ready" : "Vault unavailable"}</span></div>
    {adding ? <form className="openai-key-vault__form" onSubmit={createKey}>
      <label><span>Key label</span><input name="label" required minLength={2} maxLength={80} autoComplete="off" placeholder={personal ? "My project key" : "Workspace default"} /></label>
      <label><span>OpenAI API key</span><input name="apiKey" required type="password" minLength={23} maxLength={243} autoComplete="off" spellCheck="false" placeholder="Paste key once" /></label>
      <label className="openai-key-vault__default"><input name="isDefault" type="checkbox" defaultChecked={!active.length} /><span><strong>Use as default</strong><small>Context actions can still target another configured key explicitly.</small></span></label>
      <footer><button type="button" onClick={() => setAdding(false)}>Cancel</button><button type="submit" disabled={busy || !capability?.encryptionReady}><KeyRound size={15} />Save encrypted key</button></footer>
    </form> : null}
    <div className="openai-key-vault__list" aria-busy={busy}>
      {busy && !keys.length ? <p className="openai-key-vault__empty">Loading key metadata…</p> : !active.length ? <p className="openai-key-vault__empty">No active {personal ? "personal" : "workspace"} OpenAI keys configured.</p> : active.map((key) => <article key={key.id} className={key.isDefault ? "is-default" : ""}>
        <span className="openai-key-vault__key-icon"><KeyRound size={16} aria-hidden="true" /></span>
        <div><strong>{key.label}</strong><code>•••• {key.lastFour}</code><small>Added {dateLabel(key.createdAt)} · {key.lastUsedAt ? `Last used ${dateLabel(key.lastUsedAt)}` : "Never used"}</small></div>
        <span className="openai-key-vault__state">{key.isDefault ? "Default" : "Active"}</span>
        {canManage ? <span className="openai-key-vault__actions">{!key.isDefault ? <button type="button" onClick={() => void makeDefault(key)} disabled={busy}>Make default</button> : null}<button type="button" className="is-danger" onClick={() => void revoke(key)} disabled={busy} aria-label={`Revoke ${key.label}`}><Trash2 size={14} />Revoke</button></span> : null}
      </article>)}
      {revoked.length ? <details><summary>{revoked.length} revoked key{revoked.length === 1 ? "" : "s"}</summary>{revoked.map((key) => <p key={key.id}><strong>{key.label}</strong><code>•••• {key.lastFour}</code><span>Revoked</span></p>)}</details> : null}
    </div>
  </section>;
}
