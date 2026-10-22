import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Clipboard, KeyRound, Plus, Trash2 } from "lucide-react";
import { ControlAsyncState, ControlDialog, ControlDisclosure, ControlMetricStrip, ControlPageBody, ControlPageHeader, useToast } from "control-surface-ui/react";
import { agentAccessProfiles, agentCredentialState, agentScopeLabel, agentScopeSummary, DEFAULT_AGENT_SCOPES, groupedAgentScopes, summarizeAgentCredentials } from "./agent-access-policy.js";

export default function AgentAccessPanel({ auth, embedded = false }) {
  const [keys, setKeys] = useState([]);
  const [scopes, setScopes] = useState([]);
  const [name, setName] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [selected, setSelected] = useState(DEFAULT_AGENT_SCOPES);
  const [accessProfile, setAccessProfile] = useState("workflow");
  const [createdToken, setCreatedToken] = useState("");
  const [copied, setCopied] = useState(false);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(true);
  const [adding, setAdding] = useState(false);
  const dialogRef = useRef(null);
  const { showToast } = useToast();
  const inventory = useMemo(() => summarizeAgentCredentials(keys), [keys]);
  const profiles = useMemo(() => agentAccessProfiles(scopes), [scopes]);
  const scopeGroups = useMemo(() => groupedAgentScopes(scopes), [scopes]);

  useEffect(() => {
    let active = true;
    void auth.listAgentKeys().then((result) => {
      if (!active) return;
      const availableScopes = result.availableScopes || [];
      setKeys(result.keys || []);
      setScopes(availableScopes);
      setSelected(agentAccessProfiles(availableScopes).find((profile) => profile.id === "workflow")?.scopes || DEFAULT_AGENT_SCOPES);
    }).catch((error) => showToast({ tone: "danger", title: "Credentials unavailable", message: error.message })).finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [auth, showToast]);

  async function create(event) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      const result = await auth.createAgentKey({ name, scopes: selected, expiresAt: expiresAt ? new Date(expiresAt).toISOString() : "" });
      setKeys((current) => [result.key, ...current]);
      setCreatedToken(result.token);
      setCopied(false);
      setName("");
      setExpiresAt("");
      setAccessProfile("workflow");
      setSelected(agentAccessProfiles(scopes).find((profile) => profile.id === "workflow")?.scopes || DEFAULT_AGENT_SCOPES);
    } catch (error) { setMessage(error.message); }
    finally { setBusy(false); }
  }

  async function revoke(id) {
    setBusy(true);
    try {
      await auth.revokeAgentKey(id);
      setKeys((current) => current.map((key) => key.id === id ? { ...key, revokedAt: new Date().toISOString() } : key));
      showToast({ tone: "success", title: "Credential revoked", message: "The agent can no longer use this credential." });
    } catch (error) { showToast({ tone: "danger", title: "Credential not revoked", message: error.message }); }
    finally { setBusy(false); }
  }

  function closeCreate() {
    setAdding(false);
    setCreatedToken("");
    setCopied(false);
    setMessage("");
  }

  function chooseAccessProfile(profileId) {
    setAccessProfile(profileId);
    const profile = profiles.find((item) => item.id === profileId);
    if (profileId !== "custom" && profile) setSelected(profile.scopes);
  }

  function toggleScope(scope) {
    setAccessProfile("custom");
    setSelected((current) => current.includes(scope) ? current.filter((item) => item !== scope) : [...current, scope]);
  }

  const credentialRow = (key) => {
    const state = agentCredentialState(key);
    const stateAt = state === "revoked" ? key.revokedAt : state === "expired" ? key.expiresAt : key.lastUsedAt;
    return <article key={key.id} className={`if-action-row${state !== "active" ? " is-revoked" : ""}`} data-agent-credential-state={state}>
      <span className="if-icon-slot" aria-hidden="true"><KeyRound size={16} /></span>
      <span><strong>{key.name}</strong><em>{agentScopeSummary(key.scopes)}</em><small>{state === "revoked" ? `Revoked ${new Date(stateAt).toLocaleString()}` : state === "expired" ? `Expired ${new Date(stateAt).toLocaleString()}` : stateAt ? `Last used ${new Date(stateAt).toLocaleString()}` : "Never used"}{state === "active" && key.expiresAt ? ` · Expires ${new Date(key.expiresAt).toLocaleDateString()}` : ""}</small></span>
      <span className={`if-badge ${state === "active" ? "if-badge--info" : state === "expired" ? "if-badge--warning" : ""}`}>{state[0].toUpperCase() + state.slice(1)}</span>
      {state === "active" ? <span className="if-action-row__actions"><button type="button" className="if-btn if-btn--secondary if-btn--sm" aria-label={`Revoke ${key.name}`} onClick={() => void revoke(key.id)}><Trash2 size={15} />Revoke</button></span> : null}
    </article>;
  };

  return <section className={`${embedded ? "ops-panel" : "profile-page__panel profile-page__panel--wide"}`} data-profile-agents aria-labelledby="profile-agents-title">
    <ControlPageHeader compact divided eyebrow={embedded ? "Workspace administration" : "Account settings"} title="Agent access" summary="Issue, monitor, and revoke least-privilege credentials for trusted automation." headingLevel={2} titleId="profile-agents-title" actions={keys.length ? <button type="button" className="if-btn if-btn--primary" disabled={busy} onClick={() => setAdding(true)}><Plus size={15} />Add credential</button> : null} />
    <ControlPageBody compact>
      <ControlMetricStrip label="Agent credential summary" data-agent-credential-summary items={[
        { id: "active", label: "Active", value: inventory.active.length, meta: "Credentials that can authenticate", tone: "success" },
        { id: "expiring", label: "Expiring soon", value: inventory.expiring.length, meta: "Within the next 30 days", tone: inventory.expiring.length ? "warning" : "neutral" },
        { id: "history", label: "Lifecycle history", value: inventory.expired.length + inventory.revoked.length, meta: `${inventory.expired.length} expired · ${inventory.revoked.length} revoked` },
      ]} />
      <section className="if-analytics-panel if-analytics-panel--flat" aria-label="Agent credentials">
        <header className="if-analytics-panel__header"><div className="if-analytics-panel__heading"><h3 className="if-analytics-panel__title">Active credentials</h3><p className="if-analytics-panel__summary">Only credentials that can currently authenticate are shown in the operating list.</p></div><strong className="if-analytics-panel__count">{inventory.active.length}</strong></header>
        {busy && !keys.length ? <ControlAsyncState compact state="loading" title="Loading credentials" message="Reading the current workspace credential inventory." /> : inventory.active.length ? <div className="if-action-row-list">{inventory.active.map(credentialRow)}</div> : <ControlAsyncState compact state="empty" title="No active agent credentials" message="Create a least-privilege credential when trusted automation needs workspace access." action={<button type="button" className="if-btn if-btn--primary" onClick={() => setAdding(true)}><Plus size={15} />Add credential</button>} />}
        {inventory.expired.length || inventory.revoked.length ? <ControlDisclosure title={`${inventory.expired.length + inventory.revoked.length} inactive credential${inventory.expired.length + inventory.revoked.length === 1 ? "" : "s"}`} summary="Expired and revoked credentials retained for lifecycle audit"><div className="if-action-row-list">{[...inventory.expired, ...inventory.revoked].map(credentialRow)}</div></ControlDisclosure> : null}
      </section>
      {adding ? <ControlDialog open onClose={closeCreate} title={createdToken ? "Credential created" : "Add agent credential"} eyebrow="Workspace administration" summary={createdToken ? "This token is visible once. Store it now before closing." : "Start with a safe access profile and customize only when the integration requires it."} size="wide" dialogRef={dialogRef} closeLabel="Close agent credential form" surfaceProps={{ "data-agent-key-dialog": true }} footer={createdToken ? <button type="button" className="if-btn if-btn--primary" onClick={closeCreate}>Done</button> : <><button type="button" className="if-btn" onClick={closeCreate}>Cancel</button><button type="submit" className="if-btn if-btn--primary" form="agent-key-create-form" disabled={busy || !selected.length}><Plus size={15} />{busy ? "Creating…" : "Create credential"}</button></>}>
        {createdToken ? <section className="if-alert if-alert--warning agent-token-once" role="status"><strong>Copy this token now</strong><p>It cannot be retrieved again. Save it directly in the agent’s protected Secret Store, never in chat or source files.</p><code>{createdToken}</code><button type="button" className="if-btn if-btn--secondary" onClick={() => void navigator.clipboard.writeText(createdToken).then(() => setCopied(true))}>{copied ? <Check size={15} /> : <Clipboard size={15} />}{copied ? "Copied" : "Copy token"}</button></section> : <form id="agent-key-create-form" className="if-form-grid" onSubmit={create}>
          <label className="if-field"><span className="if-field__label">Name</span><input className="if-input" required minLength={2} placeholder="Research agent" value={name} onChange={(event) => setName(event.target.value)} /></label><label className="if-field"><span className="if-field__label">Expires <span className="if-field__hint">Optional</span></span><input className="if-input" type="datetime-local" value={expiresAt} onChange={(event) => setExpiresAt(event.target.value)} /></label>
          <fieldset className="saas-workspace-picker if-field--full"><legend className="if-form-section-label">Access profile</legend>{profiles.map((profile) => <label className="if-checkbox" key={profile.id}><input type="radio" name="accessProfile" value={profile.id} checked={accessProfile === profile.id} onChange={() => chooseAccessProfile(profile.id)} /><span className="if-analytics-panel__heading"><strong>{profile.label}</strong><small className="if-analytics-panel__summary">{profile.summary}</small></span></label>)}</fieldset>
          <ControlDisclosure className="if-field--full" title={`${selected.length} selected permission${selected.length === 1 ? "" : "s"}`} summary={accessProfile === "custom" ? "Custom access profile" : profiles.find((profile) => profile.id === accessProfile)?.label || "Access profile"}>
            <div className="if-form-grid">{scopeGroups.map((group) => <fieldset className="saas-workspace-picker" key={group.id}><legend>{group.label}</legend>{group.scopes.map((scope) => <label className="if-checkbox" key={scope}><input type="checkbox" checked={selected.includes(scope)} onChange={() => toggleScope(scope)} /><span className="if-analytics-panel__heading"><strong>{agentScopeLabel(scope)}</strong><small className="if-analytics-panel__summary">{scope}</small></span></label>)}</fieldset>)}</div>
          </ControlDisclosure>
          {message ? <p className="account-form__message" role="alert">{message}</p> : null}
        </form>}
      </ControlDialog> : null}
    </ControlPageBody>
  </section>;
}
