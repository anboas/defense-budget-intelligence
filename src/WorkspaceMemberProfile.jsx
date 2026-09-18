import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, BriefcaseBusiness, CalendarDays, UsersRound } from "lucide-react";
import { ControlAsyncState, ControlPageBody, ControlPageHeader } from "control-surface-ui/react";
import TeamAvatar from "./TeamAvatar.jsx";
import UserAvatar from "./UserAvatar.jsx";

function day(value) {
  const date = new Date(value || "");
  return Number.isNaN(date.getTime()) ? "Not scheduled" : date.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
}

export default function WorkspaceMemberProfile({ auth, memberId, seedMember, events = [], teams = [], records = [], onBack }) {
  const [directoryMember, setDirectoryMember] = useState(null);
  const [requestState, setRequestState] = useState("loading");

  useEffect(() => {
    let active = true;
    if (!auth?.enabled || !auth?.listDirectory) return () => { active = false; };
    void auth.listDirectory().then((payload) => {
      if (!active) return;
      const found = (payload?.users || []).find((candidate) => String(candidate.id) === String(memberId));
      setDirectoryMember(found || null);
      setRequestState(found ? "ready" : "empty");
    }).catch(() => {
      if (active) setRequestState("error");
    });
    return () => { active = false; };
  }, [auth, memberId]);

  const member = directoryMember?.id === memberId ? directoryMember : seedMember || null;
  const state = member ? "ready" : auth?.enabled ? requestState : "empty";

  const visibleTeams = useMemo(() => teams.filter((team) => (team.members || []).some((candidate) => String(candidate.id) === String(memberId))), [memberId, teams]);
  const visibleTeamIds = useMemo(() => new Set(visibleTeams.map((team) => String(team.id))), [visibleTeams]);
  const associations = useMemo(() => events.map((event) => {
    const attending = (event.attendees || []).some((attendee) => String(attendee.id) === String(memberId));
    const eventTeams = (event.teams || []).filter((team) => visibleTeamIds.has(String(team.id)));
    return attending || eventTeams.length ? { event, attending, eventTeams } : null;
  }).filter(Boolean).sort((left, right) => String(left.event.startsAt).localeCompare(String(right.event.startsAt))), [events, memberId, visibleTeamIds]);
  const linkedRecords = useMemo(() => {
    const ids = new Set(associations.flatMap(({ event }) => event.recordIds || []));
    return records.filter((record) => ids.has(record.opportunityId));
  }, [associations, records]);

  if (state !== "ready" || !member) return <section className="workspace-member-profile" data-workspace-member-profile data-state={state}>
    <ControlPageHeader eyebrow="Workspace profile" title="Member profile" actions={<button type="button" className="if-btn if-btn--secondary" onClick={onBack}><ArrowLeft size={15} aria-hidden="true" />Back to Schedule</button>} />
    <ControlPageBody compact><ControlAsyncState compact state={state} icon={<UsersRound size={22} />} title={state === "error" ? "Profile unavailable" : state === "empty" ? "Member not found" : "Loading member profile"} message={state === "error" ? "The workspace directory could not be loaded." : state === "empty" ? "This member is not visible in your current workspace." : "Loading visible workspace associations."} /></ControlPageBody>
  </section>;

  return <section className="workspace-member-profile" data-workspace-member-profile data-member-id={memberId}>
    <ControlPageHeader eyebrow="Workspace profile" title={member.displayName} summary="Workspace-visible identity, team membership, and shared work. Private account data and hidden teams are excluded." actions={<button type="button" className="if-btn if-btn--secondary" onClick={onBack}><ArrowLeft size={15} aria-hidden="true" />Back to Schedule</button>} />
    <ControlPageBody compact>
      <div className="workspace-member-profile__identity">
        <UserAvatar user={member} size={72} nativeTitle={false} decorative={false} />
        <div><span>{member.role || "Workspace member"}</span><strong>{member.displayName}</strong><small>{member.title || "No role title published"}</small></div>
      </div>
      <div className="workspace-member-profile__grid">
        <section data-member-teams><header><UsersRound size={18} aria-hidden="true" /><span><strong>Teams</strong><small>Visible memberships</small></span><b>{visibleTeams.length}</b></header>{visibleTeams.length ? <div className="workspace-member-profile__teams">{visibleTeams.map((team) => <article key={team.id}><TeamAvatar team={team} size={34} nativeTitle={false} /><span><strong>{team.name}</strong><small>{team.description || "Workspace team"}</small></span></article>)}</div> : <p>No visible team memberships.</p>}</section>
        <section data-member-events><header><CalendarDays size={18} aria-hidden="true" /><span><strong>Schedule associations</strong><small>Visible events only</small></span><b>{associations.length}</b></header>{associations.length ? <div className="workspace-member-profile__events">{associations.map(({ event, attending, eventTeams }) => <article key={event.id}><time dateTime={event.startsAt}>{day(event.startsAt)}</time><span><strong>{event.title}</strong><small>{attending ? "Attending" : eventTeams.map((team) => team.name).join(" · ")}</small></span></article>)}</div> : <p>No visible schedule associations.</p>}</section>
        <section data-member-records><header><BriefcaseBusiness size={18} aria-hidden="true" /><span><strong>Linked work</strong><small>Through associated events</small></span><b>{linkedRecords.length}</b></header>{linkedRecords.length ? <div className="workspace-member-profile__records">{linkedRecords.map((record) => <article key={record.opportunityId}><span><strong>{record.id}</strong><small>{record.title}</small></span></article>)}</div> : <p>No linked records on visible associated events.</p>}</section>
      </div>
    </ControlPageBody>
  </section>;
}
