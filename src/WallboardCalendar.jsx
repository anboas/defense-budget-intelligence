import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { CalendarDays, ChevronLeft, ChevronRight, Eye, EyeOff, Link2 } from "lucide-react";
import { ControlDialog, ControlMultiSelect } from "control-surface-ui/react";
import WorkspaceMark from "./WorkspaceMark.jsx";
import UserAvatar from "./UserAvatar.jsx";
import TeamAvatar from "./TeamAvatar.jsx";

const MAX_VISIBLE_CALENDAR_LANES = 2;
const MILESTONE_TYPES = [
  ["registration_deadline", "Registration closes"],
  ["refund_deadline", "Refund deadline"],
  ["hotel_deadline", "Hotel cutoff"],
  ["exhibitor_deadline", "Exhibitor deadline"],
  ["submission_deadline", "Submission deadline"],
  ["other", "Other milestone"],
];

function milestoneTypeLabel(type) {
  return MILESTONE_TYPES.find(([id]) => id === type)?.[1] || "Event milestone";
}

function milestoneLabel(milestone) {
  return milestone?.label || milestoneTypeLabel(milestone?.type);
}

function compactDate(value) {
  if (!value) return "Not scheduled";
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return "Not scheduled";
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

function dateTime(value) {
  const date = new Date(value || "");
  if (Number.isNaN(date.getTime())) return "Unavailable";
  return date.toLocaleString([], { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
}

function eventCategoryLabels(event, categories) {
  const byId = new Map(categories.map((category) => [category.id, category.name]));
  return (event.categoryIds || []).map((id) => byId.get(id)).filter(Boolean);
}

function eventCountdown(event, now) {
  const startsAt = new Date(event.startsAt);
  const endsAt = new Date(event.endsAt || event.startsAt);
  if (now >= startsAt && now <= endsAt) return { tone: "live" };
  const days = Math.max(0, Math.ceil((startsAt.getTime() - now.getTime()) / 86400000));
  return { tone: days <= 14 ? "urgent" : days <= 45 ? "watch" : "steady" };
}

function shiftMonth(month, offset) {
  const [year, monthIndex] = month.split("-").map(Number);
  const shifted = new Date(Date.UTC(year, monthIndex - 1 + offset, 1));
  return shifted.toISOString().slice(0, 7);
}

function monthCalendarDays(month) {
  const [year, monthIndex] = month.split("-").map(Number);
  const first = new Date(Date.UTC(year, monthIndex - 1, 1));
  const gridStart = new Date(first);
  gridStart.setUTCDate(1 - first.getUTCDay());
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(gridStart);
    date.setUTCDate(gridStart.getUTCDate() + index);
    return { key: date.toISOString().slice(0, 10), day: date.getUTCDate(), inMonth: date.getUTCMonth() === monthIndex - 1 };
  });
}

function calendarItems(events) {
  return events.flatMap((event) => [
    { id: `event-${event.id}`, kind: "event", event, start: String(event.startsAt || "").slice(0, 10), end: String(event.endsAt || event.startsAt || "").slice(0, 10) },
    ...(event.milestones || []).map((milestone) => ({ id: `milestone-${event.id}-${milestone.id}`, kind: "milestone", event, milestone, start: String(milestone.occursAt || "").slice(0, 10), end: String(milestone.occursAt || "").slice(0, 10) })),
  ]);
}

function calendarWeekSegments(events, week) {
  const first = week[0].key;
  const last = week[6].key;
  const lanes = [];
  return calendarItems(events)
    .filter((item) => item.start <= last && item.end >= first)
    .sort((left, right) => left.start.localeCompare(right.start) || Number(left.kind === "milestone") - Number(right.kind === "milestone") || right.end.localeCompare(left.end))
    .map((item) => {
      const startColumn = Math.max(0, week.findIndex((day) => day.key >= item.start));
      const endColumn = Math.max(startColumn, week.findLastIndex((day) => day.key <= item.end));
      let lane = lanes.findIndex((occupiedThrough) => startColumn > occupiedThrough);
      if (lane < 0) lane = lanes.length;
      lanes[lane] = endColumn;
      return { ...item, startColumn, endColumn, lane, startsBefore: item.start < first, endsAfter: item.end > last };
    });
}

function calendarItemsForDay(events, day) {
  return calendarItems(events)
    .filter((item) => item.start <= day && item.end >= day)
    .sort((left, right) => {
      const leftTime = left.kind === "milestone" ? `${left.start}T00:00` : String(left.event.startsAt || left.start);
      const rightTime = right.kind === "milestone" ? `${right.start}T00:00` : String(right.event.startsAt || right.start);
      return leftTime.localeCompare(rightTime) || Number(left.kind === "milestone") - Number(right.kind === "milestone") || left.event.title.localeCompare(right.event.title);
    });
}

function daysBetween(left, right) {
  const leftDate = Date.parse(`${String(left).slice(0, 10)}T00:00:00Z`);
  const rightDate = Date.parse(`${String(right).slice(0, 10)}T00:00:00Z`);
  return Number.isFinite(leftDate) && Number.isFinite(rightDate) ? Math.round((rightDate - leftDate) / 86400000) : null;
}

function CalendarHoverCard({ hover, categories }) {
  if (!hover) return null;
  const { item, attendee, left, top } = hover;
  const { event, milestone } = item;
  const attendees = event.attendees || [];
  const deadlineLead = milestone ? daysBetween(milestone.occursAt, event.startsAt) : null;
  return createPortal(<aside id="ops-wall-calendar-tooltip" className="capture-timeline-tooltip ops-wall-calendar-tooltip" role="tooltip" style={{ left, top }} data-calendar-hovercard data-kind={attendee ? "attendee" : item.kind}>
    <header><span>{attendee ? "Attendee" : milestone ? milestoneTypeLabel(milestone.type) : "Event schedule"}</span><strong>{attendee?.displayName || (milestone ? milestoneLabel(milestone) : event.title)}</strong><small>{attendee ? `${attendee.title || "Workspace member"} · Attending ${event.title}` : milestone ? event.title : `${event.status || "scheduled"} · ${event.milestones?.length || 0} milestone${event.milestones?.length === 1 ? "" : "s"}`}</small></header>
    <dl>{milestone ? <>
      <div><dt>Deadline</dt><dd>{compactDate(milestone.occursAt)}</dd></div>
      <div><dt>Lead time</dt><dd>{deadlineLead === null ? "Unavailable" : deadlineLead < 0 ? `${Math.abs(deadlineLead)} days after start` : deadlineLead === 0 ? "Event start day" : `${deadlineLead} days before start`}</dd></div>
      <div><dt>Event begins</dt><dd>{dateTime(event.startsAt)}</dd></div>
      <div><dt>Event ends</dt><dd>{dateTime(event.endsAt || event.startsAt)}</dd></div>
      <div><dt>Location</dt><dd>{event.location || "Not set"}</dd></div>
      <div><dt>Attendees</dt><dd>{attendees.length || "None"}</dd></div>
    </> : <>
      <div><dt>Starts</dt><dd>{dateTime(event.startsAt)}</dd></div>
      <div><dt>Ends</dt><dd>{dateTime(event.endsAt || event.startsAt)}</dd></div>
      <div><dt>Status</dt><dd>{event.status || "scheduled"}</dd></div>
      <div><dt>Milestones</dt><dd>{event.milestones?.length || "None"}</dd></div>
      <div><dt>Attendees</dt><dd>{attendees.length || "None"}</dd></div>
      <div><dt>Linked records</dt><dd>{event.recordIds?.length || "None"}</dd></div>
    </>}</dl>
    <p><b>Location</b>{event.location || "Location not set"}</p>
    {event.categoryIds?.length ? <p><b>Categories</b>{eventCategoryLabels(event, categories).join(" · ")}</p> : null}
    {attendees.length ? <p><b>Attending</b>{attendees.map((attendee) => attendee.displayName).join(" · ")}</p> : null}
    {(milestone?.notes || (!milestone && event.notes)) ? <p><b>Context</b>{milestone?.notes || event.notes}</p> : null}
    <footer>{attendee ? "Select profile to view workspace associations" : "Workspace event calendar · hover or keyboard focus for context"}</footer>
  </aside>, document.body);
}

function CalendarEventModal({ detail, categories, onClose, onOpenMember }) {
  if (!detail) return null;
  const { event, milestone } = detail;
  return <ControlDialog open onClose={onClose} title={milestone ? milestoneLabel(milestone) : event.title} eyebrow={milestone ? milestoneTypeLabel(milestone.type) : "Workspace event"} summary={milestone ? event.title : null} size="detail" closeLabel="Close event details" surfaceProps={{ className: "ops-event-detail", "data-calendar-event-detail": true }} bodyProps={{ className: "ops-event-detail__body" }} footer={<button type="button" className="if-btn if-btn--secondary" onClick={onClose}>Close</button>}>
    <dl>
      <div><dt>{milestone ? "Milestone date" : "Starts"}</dt><dd>{dateTime(milestone?.occursAt || event.startsAt)}</dd></div>
      <div><dt>Event ends</dt><dd>{dateTime(event.endsAt || event.startsAt)}</dd></div>
      <div><dt>Status</dt><dd>{event.status || "scheduled"}</dd></div>
      <div><dt>Location</dt><dd>{event.location || "Not set"}</dd></div>
      <div><dt>Categories</dt><dd>{eventCategoryLabels(event, categories).join(" · ") || "Uncategorized"}</dd></div>
      <div><dt>Linked records</dt><dd>{event.recordIds?.length || "None"}</dd></div>
      <div><dt>Milestones</dt><dd>{event.milestones?.length || "None"}</dd></div>
    </dl>
    {event.attendees?.length ? <section><h3>Attendees</h3><div className="ops-event-detail__attendees">{event.attendees.map((attendee) => <button type="button" key={attendee.id || attendee.displayName} onClick={() => { onClose(); onOpenMember?.(attendee); }} aria-label={`Open ${attendee.displayName} workspace profile`}><UserAvatar user={attendee} size={34} nativeTitle={false} /><span><strong>{attendee.displayName}</strong><small>{attendee.title || "Workspace member"}</small></span></button>)}</div></section> : null}
    {event.links?.length ? <section><h3>Event links</h3><div>{event.links.map((link) => <a key={link.id} className="if-btn if-btn--secondary" href={link.url} target="_blank" rel="noreferrer"><Link2 size={15} aria-hidden="true" />{link.label || new URL(link.url).hostname}</a>)}</div></section> : null}
    {event.milestones?.length ? <section><h3>Deadlines &amp; milestones</h3><div className="ops-event-detail__milestones">{event.milestones.map((entry) => <article key={entry.id} className={milestone?.id === entry.id ? "is-focused" : ""}><i aria-hidden="true" /><span><strong>{milestoneLabel(entry)}</strong><small>{milestoneTypeLabel(entry.type)}</small></span><time dateTime={entry.occursAt}>{compactDate(entry.occursAt)}</time>{entry.notes ? <p>{entry.notes}</p> : null}</article>)}</div></section> : null}
    {(milestone?.notes || event.notes) ? <section className="ops-event-detail__context"><h3>Context</h3><p>{milestone?.notes || event.notes}</p></section> : null}
  </ControlDialog>;
}

function CalendarDayAgenda({ day, events, onOpenItem, onClose }) {
  if (!day) return null;
  const items = calendarItemsForDay(events, day);
  const dayLabel = new Date(`${day}T00:00:00Z`).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
  return <ControlDialog open onClose={onClose} title={dayLabel} eyebrow="Day agenda" summary={`${items.length} scheduled item${items.length === 1 ? "" : "s"}`} size="detail" closeLabel="Close day agenda" surfaceProps={{ className: "ops-day-agenda", "data-calendar-day-agenda": day }} bodyProps={{ className: "ops-day-agenda__body" }} footer={<button type="button" className="if-btn if-btn--secondary" onClick={onClose}>Close</button>}>
    <div className="ops-day-agenda__list">{items.map((item) => {
      const { event, milestone } = item;
      const time = milestone ? "Milestone" : new Date(event.startsAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
      return <button key={item.id} type="button" className="ops-day-agenda__item" onClick={() => onOpenItem({ event, milestone })}>
        <span className={`ops-day-agenda__marker${milestone ? " is-milestone" : ""}`} aria-hidden="true" />
        <span><strong>{milestone ? milestoneLabel(milestone) : event.title}</strong><small>{milestone ? event.title : event.location || "Location not set"}</small></span>
        <time dateTime={milestone?.occursAt || event.startsAt}>{time}</time>
        <ChevronRight size={17} aria-hidden="true" />
      </button>;
    })}</div>
  </ControlDialog>;
}

export default function WallboardCalendar({ events, categories, teams = [], month, onMonthChange, now, workspace, standalone = false, onOpenMember }) {
  const [hover, setHover] = useState(null);
  const [detail, setDetail] = useState(null);
  const [selectedDay, setSelectedDay] = useState(null);
  const [selectedCategoryIds, setSelectedCategoryIds] = useState([]);
  const overlayStorageKey = `dbi:calendar-overlays:hidden:${workspace?.id || "workspace"}`;
  const [hiddenOverlayIds, setHiddenOverlayIds] = useState(() => {
    try { return JSON.parse(window.localStorage.getItem(overlayStorageKey) || "[]"); } catch { return []; }
  });
  const selectedCategorySet = useMemo(() => new Set(selectedCategoryIds), [selectedCategoryIds]);
  const overlayOptions = useMemo(() => {
    const map = new Map(teams.map((team) => [team.id, team]));
    for (const event of events) for (const team of event.teams || []) map.set(team.id, team);
    return [{ id: "workspace", name: "Workspace-wide", description: "Visible to every workspace member", iconDataUrl: "" }, ...[...map.values()].sort((left, right) => left.name.localeCompare(right.name))];
  }, [events, teams]);
  const hiddenOverlaySet = useMemo(() => new Set(hiddenOverlayIds), [hiddenOverlayIds]);
  const filteredEvents = events.filter((event) => {
    const categoryVisible = !selectedCategoryIds.length || (event.categoryIds || []).some((categoryId) => selectedCategorySet.has(categoryId));
    const overlayIds = event.teamIds?.length ? event.teamIds : ["workspace"];
    return categoryVisible && overlayIds.some((overlayId) => !hiddenOverlaySet.has(overlayId));
  });
  function toggleOverlay(id) {
    setHiddenOverlayIds((current) => {
      const next = current.includes(id) ? current.filter((item) => item !== id) : [...current, id];
      window.localStorage.setItem(overlayStorageKey, JSON.stringify(next));
      return next;
    });
  }
  const days = monthCalendarDays(month);
  const today = now.toISOString().slice(0, 10);
  const currentMonth = today.slice(0, 7);
  const monthDate = new Date(`${month}-01T00:00:00Z`);
  const monthLabel = monthDate.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
  const compactMonthLabel = monthDate.toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
  const monthStart = `${month}-01`;
  const monthEnd = `${month}-${String(new Date(Date.UTC(monthDate.getUTCFullYear(), monthDate.getUTCMonth() + 1, 0)).getUTCDate()).padStart(2, "0")}`;
  const monthEvents = filteredEvents.filter((event) => String(event.startsAt || "").slice(0, 10) <= monthEnd && String(event.endsAt || event.startsAt || "").slice(0, 10) >= monthStart);
  const monthMilestones = filteredEvents.flatMap((event) => (event.milestones || []).filter((milestone) => String(milestone.occursAt || "").slice(0, 10) >= monthStart && String(milestone.occursAt || "").slice(0, 10) <= monthEnd));
  const weeks = Array.from({ length: 6 }, (_, index) => days.slice(index * 7, index * 7 + 7));
  function showHover(item, target, clientX, clientY, attendee = null) {
    const bounds = target.getBoundingClientRect();
    const width = Math.min(380, window.innerWidth - 16);
    const left = Math.max(8, Math.min(clientX || bounds.right + 12, window.innerWidth - width - 8));
    const top = Math.max(8, Math.min(clientY || bounds.top, window.innerHeight - 380));
    setHover({ item, attendee, left, top });
  }
  return <section className={`ops-wallboard__section ops-wallboard__section--calendar${standalone ? " ops-wallboard__section--standalone-calendar" : ""}`} data-wallboard-calendar data-calendar-layout={standalone ? "standalone" : "display"}>
    <header>
      <div className="ops-wall-calendar__identity"><WorkspaceMark workspace={workspace} /><span><small>{workspace?.name || "Operator calendar"}</small><strong data-calendar-month-heading><span className="ops-wall-calendar__month-full">{monthLabel}</span><span className="ops-wall-calendar__month-compact">{compactMonthLabel}</span></strong></span></div>
      <div className="ops-wall-calendar__controls">
        <ControlMultiSelect label="Event types" placeholder="Types" value={selectedCategoryIds} options={categories.map((category) => ({ value: category.id, label: category.name, description: category.description, meta: `${category.assignedEventCount || 0}` }))} onChange={setSelectedCategoryIds} searchable clearable compact triggerProps={{ "data-calendar-category-filter": true }} />
        <button type="button" aria-label="Previous month" onClick={() => onMonthChange(shiftMonth(month, -1))}><ChevronLeft size={17} aria-hidden="true" /></button>
        <button type="button" onClick={() => onMonthChange(currentMonth)}>Today</button>
        <button type="button" aria-label="Next month" onClick={() => onMonthChange(shiftMonth(month, 1))}><ChevronRight size={17} aria-hidden="true" /></button>
        <b data-calendar-count aria-label={`${monthEvents.length} events and ${monthMilestones.length} milestones in ${monthLabel}`}><span>{monthEvents.length}</span><small>+{monthMilestones.length}</small></b>
      </div>
    </header>
    <div className="ops-calendar-overlays" aria-label="Calendar overlays" data-calendar-overlays><span><strong>Calendar overlays</strong><small>Toggle visible schedules.</small></span><div>{overlayOptions.map((team) => {
      const active = !hiddenOverlaySet.has(team.id);
      return <button key={team.id} type="button" className={active ? "is-active" : ""} aria-pressed={active} aria-label={`${team.name} overlay ${active ? "shown" : "hidden"}`} onClick={() => toggleOverlay(team.id)}><TeamAvatar team={team} size={26} nativeTitle={false} /><span>{team.name}</span><small className="ops-calendar-overlay__state">{active ? <Eye size={14} aria-hidden="true" /> : <EyeOff size={14} aria-hidden="true" />}<span>{active ? "Shown" : "Hidden"}</span></small></button>;
    })}</div></div>
    <div className="ops-wall-calendar__viewport" tabIndex="0" aria-label={`${monthLabel} event calendar`}>
      <div className="ops-wall-calendar__weekdays" aria-hidden="true">{["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => <span key={day}>{day}</span>)}</div>
      <div className="ops-wall-calendar__weeks">{weeks.map((week) => {
        const segments = calendarWeekSegments(filteredEvents, week);
        const visibleSegments = segments.filter((segment) => segment.lane < MAX_VISIBLE_CALENDAR_LANES);
        const totalByDay = week.map((day, dayIndex) => segments.filter((segment) => segment.startColumn <= dayIndex && segment.endColumn >= dayIndex).length);
        const busyDays = week.map((day, dayIndex) => ({ ...day, dayIndex, total: totalByDay[dayIndex] })).filter((day) => day.total > MAX_VISIBLE_CALENDAR_LANES);
        const busyDayIndexes = new Set(busyDays.map((day) => day.dayIndex));
        const displaySegments = visibleSegments.filter((segment) => !(segment.lane > 0 && segment.startColumn === segment.endColumn && busyDayIndexes.has(segment.startColumn)));
        return <section className="ops-wall-calendar__week" key={week[0].key} style={{ "--calendar-lanes": MAX_VISIBLE_CALENDAR_LANES }}>
          <div className="ops-wall-calendar__days">{week.map((day) => <article key={day.key} className={`${day.inMonth ? "is-in-month" : "is-outside-month"}${day.key === today ? " is-today" : ""}`} data-calendar-day={day.key} data-in-month={day.inMonth ? "true" : "false"}>
            <header><time dateTime={day.key}>{day.day}</time><span>{day.key === today ? "Today" : null}</span></header>
          </article>)}</div>
          <div className="ops-wall-calendar__bars">{displaySegments.map((item) => {
            const { event, milestone, startColumn, endColumn, lane, startsBefore, endsAfter } = item;
            const countdown = eventCountdown(event, now);
            const milestoneType = milestone?.type?.replaceAll("_", "-") || "";
            return <div key={item.id} className={`ops-wall-calendar__bar ${milestone ? `ops-wall-calendar__bar--milestone is-${milestoneType}` : `is-${countdown.tone}`}${startsBefore ? " continues-before" : ""}${endsAfter ? " continues-after" : ""}`} style={{ gridColumn: `${startColumn + 1} / ${endColumn + 2}`, gridRow: lane + 1 }} data-calendar-lane={lane} {...(milestone ? { "data-calendar-milestone": milestone.id, "data-parent-event": event.id, "data-milestone-date": String(milestone.occursAt).slice(0, 10) } : { "data-calendar-event": event.id })} onPointerEnter={(pointerEvent) => { if (pointerEvent.pointerType === "mouse") showHover(item, pointerEvent.currentTarget, pointerEvent.clientX + 14, pointerEvent.clientY + 14); }} onPointerMove={(pointerEvent) => { if (pointerEvent.pointerType === "mouse" && !pointerEvent.target.closest?.("[data-calendar-attendee]")) showHover(item, pointerEvent.currentTarget, pointerEvent.clientX + 14, pointerEvent.clientY + 14); }} onPointerLeave={() => setHover(null)}>
              <button type="button" className="ops-wall-calendar__bar-main" aria-haspopup="dialog" aria-label={milestone ? `${milestoneLabel(milestone)} for ${event.title} on ${compactDate(milestone.occursAt)}` : `${event.title}, ${compactDate(event.startsAt)} to ${compactDate(event.endsAt || event.startsAt)}`} onClick={() => { setHover(null); setDetail({ event, milestone }); }} onFocus={(focusEvent) => { if (!window.matchMedia("(pointer: coarse)").matches) showHover(item, focusEvent.currentTarget); }} onBlur={() => setHover(null)}>
                <i aria-hidden="true" />{!milestone && event.teams?.length ? <span className="ops-wall-calendar__bar-team"><TeamAvatar team={event.teams[0]} size={20} nativeTitle={false} />{event.teams.length > 1 ? <b>+{event.teams.length - 1}</b> : null}</span> : null}<span className="ops-wall-calendar__bar-copy"><strong>{milestone ? milestoneLabel(milestone) : event.title}</strong></span>
              </button>{!milestone && event.attendees?.length ? <span className="if-profile-avatar-stack ops-wall-calendar__bar-attendees" aria-label={`${event.attendees.length} attendee${event.attendees.length === 1 ? "" : "s"}`}>{event.attendees.slice(0, 3).map((attendee) => <button type="button" key={attendee.id || attendee.displayName} className="ops-wall-calendar__profile-link" data-calendar-attendee={attendee.id || attendee.displayName} aria-label={`Open ${attendee.displayName} workspace profile`} onPointerEnter={(pointerEvent) => { if (pointerEvent.pointerType === "mouse") showHover(item, pointerEvent.currentTarget, pointerEvent.clientX + 14, pointerEvent.clientY + 14, attendee); }} onPointerMove={(pointerEvent) => { if (pointerEvent.pointerType === "mouse") showHover(item, pointerEvent.currentTarget, pointerEvent.clientX + 14, pointerEvent.clientY + 14, attendee); }} onFocus={(focusEvent) => showHover(item, focusEvent.currentTarget, undefined, undefined, attendee)} onBlur={() => setHover(null)} onClick={() => { setHover(null); onOpenMember?.(attendee); }}><UserAvatar user={attendee} className="if-profile-avatar" nativeTitle={false} /></button>)}{event.attendees.length > 3 ? <b className="if-profile-avatar">+{event.attendees.length - 3}</b> : null}</span> : null}
            </div>;
          })}</div>
          {busyDays.length ? <div className="ops-wall-calendar__busy-days">{busyDays.map((day) => <button key={day.key} type="button" className="ops-wall-calendar__more" style={{ gridColumn: day.dayIndex + 1 }} data-calendar-overflow={day.key} aria-label={`Show all ${day.total} items on ${compactDate(day.key)}`} onClick={() => { setHover(null); setSelectedDay(day.key); }}>
            <CalendarDays size={16} aria-hidden="true" />
            <span className="ops-wall-calendar__more-full"><strong>+{day.total - 1} more</strong><small>{day.total} total</small></span>
            <span className="ops-wall-calendar__more-compact" aria-hidden="true"><strong>{day.total}</strong><small>items</small></span>
            <ChevronRight size={15} aria-hidden="true" />
          </button>)}</div> : null}
        </section>;
      })}</div>
    </div>
    <CalendarHoverCard hover={hover} categories={categories} />
    <CalendarDayAgenda day={selectedDay} events={filteredEvents} onOpenItem={(item) => { setSelectedDay(null); setDetail(item); }} onClose={() => setSelectedDay(null)} />
    <CalendarEventModal detail={detail} categories={categories} onClose={() => setDetail(null)} onOpenMember={onOpenMember} />
  </section>;
}
