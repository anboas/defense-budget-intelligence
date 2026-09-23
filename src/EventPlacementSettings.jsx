import { ControlDisclosure } from "control-surface-ui/react";
import EventTeamSelector from "./EventTeamSelector.jsx";

export default function EventPlacementSettings({ teams, teamIds, setTeamIds, wallboard, setWallboard, defaultOpen = false }) {
  const visibility = teamIds.length ? `${teamIds.length} team${teamIds.length === 1 ? "" : "s"}` : "Workspace-wide";
  return <ControlDisclosure
    className="event-placement-settings if-field--full"
    title="Visibility & display"
    summary={`${visibility} · Wallboard ${wallboard ? "on" : "off"}`}
    defaultOpen={defaultOpen}
    data-event-placement-settings
  >
    <div className="event-placement-settings__body">
      <EventTeamSelector teams={teams} value={teamIds} onChange={setTeamIds} />
      <label className="if-checkbox event-dialog__checkbox"><input type="checkbox" checked={wallboard} onChange={(event) => setWallboard(event.target.checked)} /><span><strong>Show on wallboard</strong><small>Visibility and display settings stay operator-owned during AI research.</small></span></label>
    </div>
  </ControlDisclosure>;
}
