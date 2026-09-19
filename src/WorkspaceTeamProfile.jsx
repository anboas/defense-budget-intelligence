import { useMemo } from "react";
import { ArrowLeft, BriefcaseBusiness, CalendarDays, UsersRound } from "lucide-react";
import { ControlAsyncState, ControlIdentityLink, ControlPageBody, ControlPageHeader } from "control-surface-ui/react";
import TeamAvatar from "./TeamAvatar.jsx";
import UserAvatar from "./UserAvatar.jsx";
import { workspaceMemberHref } from "./workspace-profile-routes.js";

function day(value) {
  const date = new Date(value || "");
  return Number.isNaN(date.getTime()) ? "Not scheduled" : date.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
}

export default function WorkspaceTeamProfile({ teamId, teams = [], events = [], records = [], onBack }) {
  const team = teams.find((candidate) => String(candidate.id) === String(teamId));
  const associations = useMemo(() => events.filter((event) => (event.teamIds || event.teams?.map((entry) => entry.id) || []).some((id) => String(id) === String(teamId))).sort((left, right) => String(left.startsAt).localeCompare(String(right.startsAt))), [events, teamId]);
  const linkedRecords = useMemo(() => {
    const ids = new Set(associations.flatMap((event) => event.recordIds || []));
    return records.filter((record) => ids.has(record.opportunityId));
  }, [associations, records]);

  if (!team) return <section className="workspace-member-profile" data-workspace-team-profile data-state="empty">
    <ControlPageHeader eyebrow="Workspace profile" title="Team profile" actions={<button type="button" className="if-btn if-btn--secondary" onClick={onBack}><ArrowLeft size={15} aria-hidden="true" />Back</button>} />
    <ControlPageBody compact><ControlAsyncState compact state="empty" icon={<UsersRound size={22} />} title="Team not found" message="This team is not visible in your current workspace." /></ControlPageBody>
  </section>;

  return <section className="workspace-member-profile" data-workspace-team-profile data-team-id={team.id}>
    <ControlPageHeader eyebrow="Workspace team" title={team.name} summary="Workspace-visible membership, team-scoped schedule, and linked work. Hidden teams and private account data are excluded." actions={<button type="button" className="if-btn if-btn--secondary" onClick={onBack}><ArrowLeft size={15} aria-hidden="true" />Back</button>} />
    <ControlPageBody compact>
      <div className="workspace-member-profile__identity">
        <TeamAvatar team={team} size={72} nativeTitle={false} />
        <div><span>Calendar overlay</span><strong>{team.name}</strong><small>{team.description || "Workspace team"}</small></div>
      </div>
      <div className="workspace-member-profile__grid">
        <section data-team-members><header><UsersRound size={18} aria-hidden="true" /><span><strong>Members</strong><small>Visible workspace identities</small></span><b>{team.members?.length || 0}</b></header>{team.members?.length ? <div className="workspace-member-profile__teams">{team.members.map((member) => <ControlIdentityLink key={member.id} href={workspaceMemberHref(member.id)} name={member.displayName} detail={member.title || member.role || "Workspace member"} avatar={<UserAvatar user={member} size={34} nativeTitle={false} decorative />} ariaLabel={`Open ${member.displayName} workspace profile`} />)}</div> : <p>No visible team members.</p>}</section>
        <section data-team-events><header><CalendarDays size={18} aria-hidden="true" /><span><strong>Team schedule</strong><small>Visible events only</small></span><b>{associations.length}</b></header>{associations.length ? <div className="workspace-member-profile__events">{associations.map((event) => <article key={event.id}><time dateTime={event.startsAt}>{day(event.startsAt)}</time><span><strong>{event.title}</strong><small>{event.location || "Location not set"}</small></span></article>)}</div> : <p>No visible team events.</p>}</section>
        <section data-team-records><header><BriefcaseBusiness size={18} aria-hidden="true" /><span><strong>Linked work</strong><small>Through team events</small></span><b>{linkedRecords.length}</b></header>{linkedRecords.length ? <div className="workspace-member-profile__records">{linkedRecords.map((record) => <article key={record.opportunityId}><span><strong>{record.id}</strong><small>{record.title}</small></span></article>)}</div> : <p>No linked records on visible team events.</p>}</section>
      </div>
    </ControlPageBody>
  </section>;
}
