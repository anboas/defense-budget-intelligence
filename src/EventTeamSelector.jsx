import { CircleCheck, UsersRound } from "lucide-react";
import TeamAvatar from "./TeamAvatar.jsx";

export default function EventTeamSelector({ teams = [], value = [], onChange }) {
  const selected = new Set(value || []);
  const workspaceWide = selected.size === 0;
  const toggle = (teamId) => onChange(selected.has(teamId)
    ? [...selected].filter((id) => id !== teamId)
    : [...selected, teamId]);

  return <fieldset className="ops-event-team-selector if-field--full" data-event-team-picker>
    <legend>Who can see this event?</legend>
    <p>Choose Workspace-wide, or select one or more teams. People in multiple teams see the union.</p>
    <div className="ops-event-team-selector__options">
      <button type="button" className={workspaceWide ? "is-selected" : ""} aria-pressed={workspaceWide} onClick={() => onChange([])} data-event-team-workspace>
        <span className="ops-event-team-selector__workspace"><UsersRound size={18} aria-hidden="true" /></span>
        <span><strong>Workspace-wide</strong><small>Everyone in this workspace</small></span>
        <CircleCheck size={17} aria-hidden="true" />
      </button>
      {teams.map((team) => {
        const active = selected.has(team.id);
        return <button key={team.id} type="button" className={active ? "is-selected" : ""} aria-pressed={active} aria-label={`${team.name}: ${active ? "selected" : "not selected"}`} onClick={() => toggle(team.id)} data-event-team-option={team.id}>
          <TeamAvatar team={team} size={32} />
          <span><strong>{team.name}</strong><small>{team.description || `${team.members?.length || 0} members`}</small></span>
          <CircleCheck size={17} aria-hidden="true" />
        </button>;
      })}
    </div>
    {!teams.length ? <small>No teams are available. Create one in Workspace Settings, or leave this event workspace-wide.</small> : selected.size ? <small>{selected.size} team{selected.size === 1 ? "" : "s"} selected. Only members of those teams can see this event.</small> : <small>Visible to every member of this workspace.</small>}
  </fieldset>;
}
