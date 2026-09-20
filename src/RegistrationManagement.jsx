import { useCallback, useEffect, useRef, useState } from "react";
import { Ban, Check, Clipboard, Settings2, TicketPlus } from "lucide-react";
import { ControlAsyncState, ControlDialog, ControlMetricStrip, ControlStatusBadge, useToast } from "control-surface-ui/react";
import ControlSelect from "./ControlSelect.jsx";
import OperationalDataTable from "./OperationalDataTable.jsx";

const EMPTY_INVITE = Object.freeze({ label: "", email: "", expiresInDays: "7" });

function dateTime(value) {
  if (!value) return "Never";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Never" : date.toLocaleString([], { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
}

function statusTone(status) {
  if (status === "active") return "success";
  if (status === "used") return "completed";
  if (status === "expired") return "warning";
  return "neutral";
}

export default function RegistrationManagement({ auth }) {
  const [policy, setPolicy] = useState({ mode: "closed", updatedAt: "" });
  const [invites, setInvites] = useState([]);
  const [allowedExpiryDays, setAllowedExpiryDays] = useState([1, 7, 14, 30]);
  const [mode, setMode] = useState("");
  const [policyDraft, setPolicyDraft] = useState("closed");
  const [inviteDraft, setInviteDraft] = useState(EMPTY_INVITE);
  const [generatedCode, setGeneratedCode] = useState("");
  const [busy, setBusy] = useState(true);
  const [message, setMessage] = useState("");
  const dialogRef = useRef(null);
  const { showToast } = useToast();

  const notify = useCallback((title, text, tone = "success") => showToast({ tone, title, message: text }), [showToast]);
  const refresh = useCallback(async () => {
    const result = await auth.getRegistrationAdministration();
    setPolicy(result.policy || { mode: "closed", updatedAt: "" });
    setInvites(result.invites || []);
    setAllowedExpiryDays(result.defaults?.allowedExpiryDays || [1, 7, 14, 30]);
  }, [auth]);

  useEffect(() => {
    let active = true;
    void auth.getRegistrationAdministration().then((result) => {
      if (!active) return;
      setPolicy(result.policy || { mode: "closed", updatedAt: "" });
      setInvites(result.invites || []);
      setAllowedExpiryDays(result.defaults?.allowedExpiryDays || [1, 7, 14, 30]);
    }).catch((error) => notify("Registration unavailable", error.message, "danger"))
      .finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [auth, notify]);

  const activeCount = invites.filter((invite) => invite.status === "active").length;
  const usedCount = invites.filter((invite) => invite.status === "used").length;
  const expiredCount = invites.filter((invite) => invite.status === "expired").length;
  const inviteColumns = [
    { key: "invite", label: "Invite", required: true, sticky: true, minWidth: 180, value: (invite) => [invite.label, invite.codeSuffix], render: (invite) => <span className="registration-invite__identity"><strong>{invite.label || "Registration invite"}</strong><small>Ends in {invite.codeSuffix}</small></span> },
    { key: "email", label: "Email restriction", minWidth: 210, value: (invite) => invite.email || "Any email", render: (invite) => invite.email || "Any email" },
    { key: "status", label: "Status", facet: true, minWidth: 110, value: (invite) => invite.status, render: (invite) => <ControlStatusBadge status={statusTone(invite.status)} label={invite.status[0].toUpperCase() + invite.status.slice(1)} /> },
    { key: "expires", label: "Expires", minWidth: 180, value: (invite) => invite.expiresAt, render: (invite) => dateTime(invite.expiresAt) },
    { key: "used", label: "Used", minWidth: 180, value: (invite) => invite.usedAt || "", render: (invite) => invite.usedAt ? dateTime(invite.usedAt) : "—" },
    { key: "actions", label: "Actions", role: "actions", sortable: false, required: true, minWidth: 120, value: () => "", render: (invite) => invite.status === "active" ? <button type="button" className="if-btn if-btn--danger if-btn--sm" onClick={() => void revokeInvite(invite)} disabled={busy}><Ban size={14} />Revoke</button> : <span>—</span> },
  ];

  function closeDialog() {
    setMode("");
    setMessage("");
    setGeneratedCode("");
    setInviteDraft(EMPTY_INVITE);
  }

  async function savePolicy(event) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      await auth.updateRegistrationPolicy(policyDraft);
      await refresh();
      setMode("");
      notify("Registration policy updated", policyDraft === "invite_only" ? "People with an active invite code can now create an account." : "New account registration is closed.");
    } catch (error) { setMessage(error.message); }
    finally { setBusy(false); }
  }

  async function createInvite(event) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      const result = await auth.createRegistrationInvite({ ...inviteDraft, expiresInDays: Number(inviteDraft.expiresInDays) });
      setGeneratedCode(result.code || "");
      setMode("code");
      await refresh();
    } catch (error) { setMessage(error.message); }
    finally { setBusy(false); }
  }

  async function revokeInvite(invite) {
    setBusy(true);
    try {
      await auth.revokeRegistrationInvite(invite.id);
      await refresh();
      notify("Invite revoked", `${invite.label || `Invite ending in ${invite.codeSuffix}`} can no longer be used.`);
    } catch (error) { notify("Invite not revoked", error.message, "danger"); }
    finally { setBusy(false); }
  }

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(generatedCode);
      notify("Invite copied", "Share it through a secure channel. The full code will not be shown again.");
    } catch { setMessage("Copy failed. Select and copy the invite code manually."); }
  }

  if (busy && !invites.length && !policy.updatedAt) return <ControlAsyncState compact state="loading" title="Loading registration policy" message="Reading the platform registration boundary and invite history." />;
  return <section className="registration-management" data-registration-management>
    <ControlMetricStrip label="Registration summary" items={[
      { id: "mode", label: "Policy", value: policy.mode === "invite_only" ? "Invite only" : "Closed", tone: policy.mode === "invite_only" ? "info" : "neutral" },
      { id: "active", label: "Active invites", value: activeCount, tone: activeCount ? "success" : "neutral" },
      { id: "used", label: "Used", value: usedCount, tone: "purple" },
      { id: "expired", label: "Expired", value: expiredCount, tone: expiredCount ? "warning" : "neutral" },
    ]} />
    <div className="registration-management__actions">
      <span><strong>Registration policy</strong><small>Invite codes create Viewer accounts without workspace access. Membership is approved separately.</small></span>
      <span>
        <button type="button" className="if-btn if-btn--secondary" onClick={() => { setPolicyDraft(policy.mode); setMode("policy"); }}><Settings2 size={15} />Configure</button>
        <button type="button" className="if-btn if-btn--primary" onClick={() => setMode("invite")}><TicketPlus size={15} />Generate invite</button>
      </span>
    </div>
    {invites.length ? <OperationalDataTable
      id="platform-registration-invites"
      label="Registration invites"
      rows={invites}
      columns={inviteColumns}
      rowKey={(invite) => invite.id}
      defaultSort={{ key: "expires", direction: "desc" }}
      defaultPageSize={25}
      defaultMobilePageSize={5}
      searchPlaceholder="Search labels, email restrictions, and invite status…"
      exportFilename="platform-registration-invites.csv"
      selectable={false}
      mobileColumns={["invite", "email", "status", "expires", "actions"]}
      wrapperProps={{ "data-registration-invites-table": true }}
    /> : <ControlAsyncState compact state="empty" title="No registration invites" message="Generate a one-time invite when someone needs to create a platform account." />}

    {mode === "policy" ? <ControlDialog open onClose={closeDialog} title="Registration policy" eyebrow="Platform security" summary="Public self-registration remains unavailable. Invitation-only mode permits account creation with an active one-time code." dialogRef={dialogRef} surfaceProps={{ "data-registration-policy-dialog": true }} footer={<><button type="button" className="if-btn" onClick={closeDialog}>Cancel</button><button type="submit" form="registration-policy-form" className="if-btn if-btn--primary" disabled={busy}><Check size={15} />Save policy</button></>}><form id="registration-policy-form" className="user-management__form-grid" onSubmit={savePolicy}><div className="user-management__field"><span>Registration mode</span><ControlSelect ariaLabel="Registration mode" value={policyDraft} options={[["closed", "Closed"], ["invite_only", "Invite only"]]} onChange={setPolicyDraft} portalTarget={dialogRef} /><small>Invite-only accounts start without workspace membership or elevated permissions.</small></div>{message ? <p className="if-alert if-alert--danger" role="alert">{message}</p> : null}</form></ControlDialog> : null}

    {mode === "invite" ? <ControlDialog open onClose={closeDialog} title="Generate registration invite" eyebrow="Platform security" summary="The code is displayed once. Bind it to an email when you know the recipient." dialogRef={dialogRef} surfaceProps={{ "data-registration-invite-dialog": true }} footer={<><button type="button" className="if-btn" onClick={closeDialog}>Cancel</button><button type="submit" form="registration-invite-form" className="if-btn if-btn--primary" disabled={busy}><TicketPlus size={15} />Generate invite</button></>}><form id="registration-invite-form" className="user-management__form-grid" onSubmit={createInvite}><label>Label <span>(optional)</span><input maxLength={80} autoComplete="off" value={inviteDraft.label} onChange={(event) => setInviteDraft((draft) => ({ ...draft, label: event.target.value }))} /></label><label>Recipient email <span>(optional)</span><input type="email" maxLength={254} autoComplete="off" value={inviteDraft.email} onChange={(event) => setInviteDraft((draft) => ({ ...draft, email: event.target.value }))} /></label><div className="user-management__field"><span>Expires after</span><ControlSelect ariaLabel="Invite expiration" value={inviteDraft.expiresInDays} options={allowedExpiryDays.map((days) => [String(days), `${days} day${days === 1 ? "" : "s"}`])} onChange={(expiresInDays) => setInviteDraft((draft) => ({ ...draft, expiresInDays }))} portalTarget={dialogRef} /></div>{message ? <p className="if-alert if-alert--danger" role="alert">{message}</p> : null}</form></ControlDialog> : null}

    {mode === "code" ? <ControlDialog open onClose={closeDialog} title="Invite generated" eyebrow="One-time secret" summary="Copy this code now. Only its hash and final four characters are retained." surfaceProps={{ "data-registration-code-dialog": true }} footer={<button type="button" className="if-btn if-btn--primary" onClick={closeDialog}>Done</button>}><div className="registration-code"><code>{generatedCode}</code><button type="button" className="if-btn if-btn--secondary" onClick={() => void copyCode()}><Clipboard size={15} />Copy invite code</button></div>{message ? <p className="if-alert if-alert--danger" role="alert">{message}</p> : null}</ControlDialog> : null}
  </section>;
}
