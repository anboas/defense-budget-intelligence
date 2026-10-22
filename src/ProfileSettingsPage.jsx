import { useState } from "react";
import { ImagePlus, KeyRound, Save, Trash2, UserRound } from "lucide-react";
import { ControlAsyncState, ControlIdentityEditor, ControlPageBody, useToast } from "control-surface-ui/react";
import { useAuth } from "./AuthContext.jsx";
import OpenAiKeyManagement from "./OpenAiKeyManagement.jsx";
import SectionedPageHeader from "./SectionedPageHeader.jsx";
import SessionManagement from "./SessionManagement.jsx";
import UserAvatar from "./UserAvatar.jsx";

async function squareAvatar(file) {
  if (!file?.type?.startsWith("image/") || file.size > 8_000_000) throw new Error("Choose a PNG, JPEG, or WebP image under 8 MB.");
  const sourceDataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("That image could not be opened."));
    reader.readAsDataURL(file);
  });
  const image = await new Promise((resolve, reject) => {
    const element = new Image();
    element.onload = () => resolve(element);
    element.onerror = () => reject(new Error("That image could not be opened."));
    element.src = sourceDataUrl;
  });
  const sourceSize = Math.min(image.naturalWidth, image.naturalHeight);
  const sourceX = Math.floor((image.naturalWidth - sourceSize) / 2);
  const sourceY = Math.floor((image.naturalHeight - sourceSize) / 2);
  for (const size of [112, 96, 80, 64]) {
    for (const quality of [0.76, 0.62, 0.48]) {
      const canvas = document.createElement("canvas");
      canvas.width = size;
      canvas.height = size;
      canvas.getContext("2d").drawImage(image, sourceX, sourceY, sourceSize, sourceSize, 0, 0, size, size);
      const dataUrl = canvas.toDataURL("image/webp", quality);
      if (dataUrl.length <= 13_500) return dataUrl;
    }
  }
  throw new Error("That image is too complex. Try a simpler crop.");
}

function AccountPanel({ auth, user }) {
  const [displayName, setDisplayName] = useState(user.displayName);
  const [title, setTitle] = useState(user.title || "");
  const [avatarDataUrl, setAvatarDataUrl] = useState(user.avatarDataUrl || "");
  const [busy, setBusy] = useState(false);
  const { showToast } = useToast();

  async function save(event) {
    event.preventDefault();
    setBusy(true);
    try {
      await auth.updateProfile({ displayName, title, avatarDataUrl });
      showToast({ tone: "success", title: "Profile saved.", message: "Your updated identity is now shown across the workspace." });
    } catch (error) { showToast({ tone: "danger", title: "Profile not saved", message: error.message }); }
    finally { setBusy(false); }
  }

  return <section className="if-panel profile-page__panel" data-profile-account aria-labelledby="profile-account-title">
    <header className="if-panel__header profile-page__panel-header"><div><h2 className="if-panel__title" id="profile-account-title">Identity</h2><p className="if-panel__subtitle">Used in the header and shared workspace activity.</p></div></header>
    <form className="profile-page__form account-settings-form" onSubmit={save}>
      <div className="if-panel__body profile-page__panel-body">
        <ControlIdentityEditor compact avatar={<UserAvatar user={{ ...user, displayName, avatarDataUrl }} className="profile-avatar" />} title="Profile picture" summary="Square crop, optimized in your browser before upload." actions={<><label className="if-btn if-btn--sm" htmlFor="profile-avatar-file"><ImagePlus size={15} />{avatarDataUrl ? "Replace" : "Choose image"}</label><input id="profile-avatar-file" className="if-sr-only" type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => void squareAvatar(event.target.files?.[0]).then(setAvatarDataUrl).catch((imageError) => showToast({ tone: "danger", title: "Image not updated", message: imageError.message }))} />{avatarDataUrl ? <button className="if-btn if-btn--sm" type="button" onClick={() => setAvatarDataUrl("")}><Trash2 size={15} />Remove</button> : null}</>} />
        <div className="if-form-grid profile-page__form-grid">
          <label className="if-field"><span className="if-field__label">Display name</span><input className="if-input" required minLength={2} autoComplete="name" value={displayName} onChange={(event) => setDisplayName(event.target.value)} /></label>
          <label className="if-field"><span className="if-field__label">Title <span className="if-field__hint">Optional</span></span><input className="if-input" autoComplete="organization-title" value={title} onChange={(event) => setTitle(event.target.value)} /></label>
        </div>
        <div className="if-form-section-label">Account</div>
        <dl className="if-meta-grid if-meta-grid--dense profile-page__account-meta" data-profile-account-meta><div className="if-kv"><dt>Email</dt><dd>{user.email}</dd></div><div className="if-kv"><dt>Role</dt><dd>{user.role}</dd></div></dl>
      </div>
      <footer className="if-panel__footer profile-page__panel-footer"><button className="if-btn if-btn--primary if-btn--sm" type="submit" disabled={busy}><Save size={15} />{busy ? "Saving…" : "Save profile"}</button></footer>
    </form>
  </section>;
}

function SecurityPanel({ auth, user }) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const { showToast } = useToast();

  async function save(event) {
    event.preventDefault();
    if (newPassword !== confirm) { showToast({ tone: "danger", title: "Passwords do not match", message: "Enter the same new password in both fields." }); return; }
    setBusy(true);
    try {
      await auth.changePassword({ email: user.email, currentPassword, newPassword });
      setCurrentPassword("");
      setNewPassword("");
      setConfirm("");
      showToast({ tone: "success", title: "Password changed", message: "Every other active session was signed out." });
    } catch (error) { showToast({ tone: "danger", title: "Password not changed", message: error.message }); }
    finally { setBusy(false); }
  }

  return <section className="if-panel profile-page__panel" data-profile-security aria-labelledby="profile-security-title">
    <header className="if-panel__header profile-page__panel-header"><div><h2 className="if-panel__title" id="profile-security-title">Password</h2><p className="if-panel__subtitle">Changing it revokes every other active session.</p></div></header>
    <form className="profile-page__form account-settings-form" onSubmit={save}>
      <div className="if-panel__body profile-page__panel-body"><div className="if-form-grid profile-page__form-grid profile-page__form-grid--security">
        <label className="if-field if-field--full"><span className="if-field__label">Current password</span><input className="if-input" required type="password" autoComplete="current-password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} /></label>
        <label className="if-field"><span className="if-field__label">New password</span><input className="if-input" required minLength={12} type="password" autoComplete="new-password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} /></label>
        <label className="if-field"><span className="if-field__label">Confirm new password</span><input className="if-input" required minLength={12} type="password" autoComplete="new-password" value={confirm} onChange={(event) => setConfirm(event.target.value)} /></label>
      </div></div>
      <footer className="if-panel__footer profile-page__panel-footer"><button className="if-btn if-btn--primary if-btn--sm" type="submit" disabled={busy}><KeyRound size={15} />{busy ? "Updating…" : "Update password"}</button></footer>
    </form>
  </section>;
}

export default function ProfileSettingsPage({ section = "profile" }) {
  const auth = useAuth();
  const user = auth?.user;
  if (!auth || auth.staticHost || !auth.enabled || !user) return <section className="profile-page" data-profile-page><ControlAsyncState state="empty" title="Account service unavailable" message="Profile and agent administration are available on the authenticated Cloudflare application." /></section>;
  const sections = [
    { id: "profile", label: "Profile", href: "#/profile", icon: <UserRound size={14} aria-hidden="true" /> },
    { id: "security", label: "Security", href: "#/profile/security", icon: <KeyRound size={14} aria-hidden="true" /> },
    { id: "personal-ai", label: "OpenAI keys", href: "#/profile/openai", icon: <KeyRound size={14} aria-hidden="true" /> },
  ];
  return <div className="profile-page" data-profile-page data-profile-section={section} data-density="compact">
    <SectionedPageHeader eyebrow="Personal administration" title="Account settings" summary="Manage your identity, sign-in security, and personal AI credentials." items={sections} activeId={section} ariaLabel="Profile sections" />
    <ControlPageBody compact><div className="profile-page__content">{section === "security" ? <><SecurityPanel auth={auth} user={user} /><SessionManagement auth={auth} /></> : section === "personal-ai" ? <OpenAiKeyManagement auth={auth} scope="user" embedded /> : <AccountPanel auth={auth} user={user} />}</div></ControlPageBody>
  </div>;
}
