import { useEffect, useRef, useState } from "react";
import { ImagePlus, Pencil, Plus, Save, Trash2, UsersRound } from "lucide-react";
import { ControlAsyncState, ControlDialog, useToast } from "control-surface-ui/react";
import TeamAvatar from "./TeamAvatar.jsx";
import UserAvatar from "./UserAvatar.jsx";

const EMPTY_TEAM = { id: "", name: "", description: "", iconDataUrl: "", userIds: [] };

async function squareTeamIcon(file) {
  if (!file?.type?.startsWith("image/") || file.size > 8_000_000) throw new Error("Choose a PNG, JPEG, or WebP image under 8 MB.");
  const source = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("That image could not be opened."));
    reader.readAsDataURL(file);
  });
  const image = await new Promise((resolve, reject) => {
    const element = new Image();
    element.onload = () => resolve(element);
    element.onerror = () => reject(new Error("That image could not be opened."));
    element.src = source;
  });
  const crop = Math.min(image.naturalWidth, image.naturalHeight);
  const canvas = document.createElement("canvas");
  canvas.width = 80;
  canvas.height = 80;
  canvas.getContext("2d").drawImage(image, Math.floor((image.naturalWidth - crop) / 2), Math.floor((image.naturalHeight - crop) / 2), crop, crop, 0, 0, 80, 80);
  const value = canvas.toDataURL("image/webp", 0.68);
  if (value.length > 13_500) throw new Error("That image is too complex. Try a simpler crop.");
  return value;
}

export default function WorkspaceTeams({ auth, users = [] }) {
  const [teams, setTeams] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState(null);
  const dialogRef = useRef(null);
  const { showToast } = useToast();

  async function refresh() {
    const result = await auth.listTeams();
    setTeams(result.teams || []);
  }

  useEffect(() => {
    let active = true;
    auth.listTeams().then((result) => { if (active) setTeams(result.teams || []); })
      .catch((error) => showToast({ tone: "danger", title: "Teams unavailable", message: error.message }))
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [auth, showToast]);

  async function save(event) {
    event.preventDefault();
    setBusy(true);
    try {
      const values = { name: draft.name, description: draft.description, iconDataUrl: draft.iconDataUrl };
      const result = draft.id ? await auth.updateTeam(draft.id, values) : await auth.createTeam(values);
      const id = result.team.id;
      await auth.updateTeamMembers(id, draft.userIds);
      await refresh();
      setDraft(null);
      showToast({ tone: "success", title: "Team saved", message: `${values.name} is ready as a calendar overlay.` });
    } catch (error) {
      showToast({ tone: "danger", title: "Team not saved", message: error.message });
    } finally { setBusy(false); }
  }

  async function remove(team) {
    setBusy(true);
    try {
      await auth.deleteTeam(team.id);
      await refresh();
      showToast({ tone: "success", title: "Team deleted", message: `${team.name} was removed.` });
    } catch (error) {
      showToast({ tone: "danger", title: "Team not deleted", message: error.message });
    } finally { setBusy(false); }
  }

  return <section className="workspace-teams if-analytics-panel if-analytics-panel--flat" data-workspace-teams>
    <header className="workspace-teams__header"><span><strong>Teams &amp; calendar overlays</strong><small>Group members and restrict event visibility. People in multiple teams see the union of those overlays.</small></span><button type="button" className="if-btn if-btn--secondary if-btn--sm" onClick={() => setDraft(EMPTY_TEAM)} disabled={busy}><Plus size={14} />Add team</button></header>
    {loading ? <ControlAsyncState compact state="loading" title="Loading teams" message="Reading team membership and event overlays." /> : teams.length ? <div className="workspace-teams__list">{teams.map((team) => <article key={team.id} className="workspace-team" data-team={team.id}>
      <TeamAvatar team={team} size={42} />
      <span className="workspace-team__identity"><strong>{team.name}</strong><small>{team.description || "No description"}</small><em>{team.eventCount} event{team.eventCount === 1 ? "" : "s"}</em></span>
      <span className="workspace-team__members" aria-label={`${team.members.length} members`}>{team.members.slice(0, 4).map((member) => <UserAvatar key={member.id} user={member} size={28} />)}{team.members.length > 4 ? <b>+{team.members.length - 4}</b> : null}{!team.members.length ? <small>No members</small> : null}</span>
      <span className="workspace-team__actions"><button type="button" className="if-btn if-btn--secondary if-btn--sm" onClick={() => setDraft({ id: team.id, name: team.name, description: team.description, iconDataUrl: team.iconDataUrl, userIds: team.members.map((member) => member.id) })} disabled={busy}><Pencil size={14} />Edit</button><button type="button" className="if-btn if-btn--danger if-btn--sm" onClick={() => void remove(team)} disabled={busy || team.eventCount > 0} title={team.eventCount ? "Reassign this team's events before deleting it" : "Delete team"}><Trash2 size={14} />Delete</button></span>
    </article>)}</div> : <ControlAsyncState compact state="empty" icon={<UsersRound size={22} />} title="No teams yet" message="Create HR, BD, leadership, or other team overlays and assign members." action={<button type="button" className="if-btn if-btn--primary" onClick={() => setDraft(EMPTY_TEAM)}><Plus size={14} />Create first team</button>} />}
    {draft ? <ControlDialog open onClose={() => setDraft(null)} title={draft.id ? `Edit ${draft.name}` : "Create team"} eyebrow="Workspace visibility" summary="Members can see workspace-wide events plus events assigned to this team." size="wide" dialogRef={dialogRef} footer={<><button type="button" className="if-btn" onClick={() => setDraft(null)} disabled={busy}>Cancel</button><button type="submit" className="if-btn if-btn--primary" form="workspace-team-form" disabled={busy}><Save size={14} />Save team</button></>}>
      <form id="workspace-team-form" className="if-form-grid" onSubmit={save}>
        <div className="workspace-team-editor__identity if-field--full"><TeamAvatar team={draft} size={54} /><span><label className="if-btn if-btn--sm" htmlFor="team-icon-input"><ImagePlus size={14} />{draft.iconDataUrl ? "Replace icon" : "Choose icon"}</label><input id="team-icon-input" type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => void squareTeamIcon(event.target.files?.[0]).then((iconDataUrl) => setDraft((current) => ({ ...current, iconDataUrl }))).catch((error) => showToast({ tone: "danger", title: "Icon not accepted", message: error.message }))} />{draft.iconDataUrl ? <button type="button" className="if-btn if-btn--sm" onClick={() => setDraft((current) => ({ ...current, iconDataUrl: "" }))}>Use initials</button> : null}</span></div>
        <label className="if-field"><span className="if-field__label">Team name</span><input className="if-input" required minLength={2} value={draft.name} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} /></label>
        <label className="if-field"><span className="if-field__label">Description</span><input className="if-input" value={draft.description} onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))} /></label>
        <fieldset className="workspace-team-editor__members if-field--full"><legend>Members</legend><div>{users.map((user) => <label key={user.id} className="workspace-team-editor__member"><input type="checkbox" checked={draft.userIds.includes(user.id)} onChange={(event) => setDraft((current) => ({ ...current, userIds: event.target.checked ? [...current.userIds, user.id] : current.userIds.filter((id) => id !== user.id) }))} /><UserAvatar user={user} size={28} /><span><strong>{user.displayName}</strong><small>{user.email}</small></span></label>)}</div></fieldset>
      </form>
    </ControlDialog> : null}
  </section>;
}
