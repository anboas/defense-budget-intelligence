import { cleanHttpUrl, cleanText } from "./security-policy.js";

const EVENT_MILESTONE_TYPES = new Set([
  "registration_deadline", "refund_deadline", "hotel_deadline",
  "exhibitor_deadline", "submission_deadline", "other",
]);

function cleanDate(value) {
  const text = cleanText(value, 32);
  if (!text) return "";
  return /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d{3})?)?Z?)?$/.test(text) ? text : "";
}

function cleanStringArray(value, limit = 50, itemLength = 180) {
  return [...new Set((Array.isArray(value) ? value : []).map((item) => cleanText(item, itemLength)).filter(Boolean))].slice(0, limit);
}

export function eventAiReviewRisks(verification, outcome) {
  return Boolean(
    outcome.status !== "completed"
    || (outcome.mergeResult?.conflicts || []).length
    || (verification?.approved?.reviewClaims || []).length
    || (verification?.rejectedClaims || []).length,
  );
}

export async function writeEventAiState(db, {
  workspaceId,
  eventId,
  jobId,
  status,
  augmentedAt,
  appliedAt = "",
  validationRequired,
}) {
  if (!eventId) return;
  await db.prepare(`INSERT INTO dbi_event_ai_state
    (workspace_id, event_id, last_job_id, last_status, last_augmented_at, last_applied_at, validation_required, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(workspace_id, event_id) DO UPDATE SET
      last_job_id = excluded.last_job_id,
      last_status = excluded.last_status,
      last_augmented_at = excluded.last_augmented_at,
      last_applied_at = CASE WHEN excluded.last_applied_at <> '' THEN excluded.last_applied_at ELSE dbi_event_ai_state.last_applied_at END,
      validation_required = excluded.validation_required,
      updated_at = excluded.updated_at`)
    .bind(workspaceId, eventId, jobId, status, augmentedAt, appliedAt, validationRequired ? 1 : 0, augmentedAt).run();
}

export function cleanEventMilestones(value) {
  if (!Array.isArray(value)) return { milestones: [], valid: false };
  const ids = new Set();
  const milestones = [];
  for (const [index, candidate] of value.slice(0, 24).entries()) {
    const id = cleanText(candidate?.id, 100) || `milestone-${index + 1}`;
    const type = EVENT_MILESTONE_TYPES.has(candidate?.type) ? candidate.type : "other";
    const label = cleanText(candidate?.label, 120);
    const occursAt = cleanDate(candidate?.occursAt || candidate?.date);
    const notes = cleanText(candidate?.notes, 500);
    if (!occursAt || ids.has(id) || (type === "other" && !label)) return { milestones: [], valid: false };
    ids.add(id);
    milestones.push({ id, type, label, occursAt, notes });
  }
  return { milestones, valid: value.length <= 24 };
}

export function cleanEventLinks(value) {
  if (!Array.isArray(value)) return { links: [], valid: false };
  const ids = new Set();
  const urls = new Set();
  const links = [];
  for (const [index, candidate] of value.slice(0, 12).entries()) {
    const id = cleanText(candidate?.id, 100) || `link-${index + 1}`;
    const label = cleanText(candidate?.label, 120);
    const url = cleanHttpUrl(candidate?.url);
    if (!url || ids.has(id) || urls.has(url)) return { links: [], valid: false };
    ids.add(id);
    urls.add(url);
    links.push({ id, label, url, sortOrder: index });
  }
  return { links, valid: value.length <= 12 };
}

export async function activeEventCategoryIds(db, workspaceId, value) {
  const ids = cleanStringArray(value, 8, 80);
  if (!ids.length) return { ids: [], valid: true };
  const placeholders = ids.map(() => "?").join(", ");
  const result = await db.prepare(`SELECT category_id FROM dbi_workspace_event_categories
    WHERE workspace_id = ? AND category_id IN (${placeholders})`).bind(workspaceId, ...ids).all();
  const active = new Set((result.results || []).map((row) => row.category_id));
  return { ids: ids.filter((id) => active.has(id)), valid: active.size === ids.length };
}

export async function activeEventAttendeeIds(db, workspaceId, value) {
  const ids = cleanStringArray(value, 30, 80);
  if (!ids.length) return { ids: [], valid: true };
  const placeholders = ids.map(() => "?").join(", ");
  const result = await db.prepare(`SELECT user.user_id FROM dbi_users user
    JOIN dbi_workspace_memberships membership ON membership.user_id = user.user_id
    WHERE membership.workspace_id = ? AND user.status = 'active' AND user.user_id IN (${placeholders})`).bind(workspaceId, ...ids).all();
  const active = new Set((result.results || []).map((row) => row.user_id));
  return { ids: ids.filter((id) => active.has(id)), valid: active.size === ids.length };
}

export async function activeEventTeamIds(db, workspaceId, value) {
  const ids = cleanStringArray(value, 12, 80);
  if (!ids.length) return { ids: [], valid: true };
  const placeholders = ids.map(() => "?").join(", ");
  const result = await db.prepare(`SELECT team_id FROM dbi_workspace_teams
    WHERE workspace_id = ? AND team_id IN (${placeholders})`).bind(workspaceId, ...ids).all();
  const active = new Set((result.results || []).map((row) => row.team_id));
  return { ids: ids.filter((id) => active.has(id)), valid: active.size === ids.length };
}

export async function replaceEventAttendees(db, workspaceId, eventId, attendeeIds) {
  await db.prepare("DELETE FROM dbi_workspace_event_attendees WHERE workspace_id = ? AND event_id = ?").bind(workspaceId, eventId).run();
  const createdAt = new Date().toISOString();
  for (const userId of attendeeIds) {
    await db.prepare("INSERT INTO dbi_workspace_event_attendees (workspace_id, event_id, user_id, created_at) VALUES (?, ?, ?, ?)").bind(workspaceId, eventId, userId, createdAt).run();
  }
}

export async function replaceEventTeams(db, workspaceId, eventId, teamIds) {
  await db.prepare("DELETE FROM dbi_workspace_event_teams WHERE workspace_id = ? AND event_id = ?").bind(workspaceId, eventId).run();
  const createdAt = new Date().toISOString();
  for (const teamId of teamIds) {
    await db.prepare("INSERT INTO dbi_workspace_event_teams (workspace_id, event_id, team_id, created_at) VALUES (?, ?, ?, ?)")
      .bind(workspaceId, eventId, teamId, createdAt).run();
  }
}

export async function replaceEventMilestones(db, workspaceId, eventId, milestones) {
  await db.prepare("DELETE FROM dbi_workspace_event_milestones WHERE workspace_id = ? AND event_id = ?").bind(workspaceId, eventId).run();
  const now = new Date().toISOString();
  for (const milestone of milestones) {
    await db.prepare(`INSERT INTO dbi_workspace_event_milestones
      (workspace_id, event_id, milestone_id, type, label, occurs_at, notes, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(workspaceId, eventId, milestone.id, milestone.type, milestone.label, milestone.occursAt, milestone.notes, now, now).run();
  }
}

export async function replaceEventLinks(db, workspaceId, eventId, links) {
  await db.prepare("DELETE FROM dbi_workspace_event_links WHERE workspace_id = ? AND event_id = ?").bind(workspaceId, eventId).run();
  const now = new Date().toISOString();
  for (const link of links) {
    await db.prepare(`INSERT INTO dbi_workspace_event_links
      (workspace_id, event_id, link_id, label, url, sort_order, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(workspaceId, eventId, link.id, link.label, link.url, link.sortOrder, now, now).run();
  }
}

export async function replaceEventCategories(db, workspaceId, eventId, categoryIds) {
  await db.prepare("DELETE FROM dbi_workspace_event_category_assignments WHERE workspace_id = ? AND event_id = ?").bind(workspaceId, eventId).run();
  const now = new Date().toISOString();
  for (const categoryId of categoryIds) {
    await db.prepare(`INSERT INTO dbi_workspace_event_category_assignments
      (workspace_id, event_id, category_id, created_at) VALUES (?, ?, ?, ?)`)
      .bind(workspaceId, eventId, categoryId, now).run();
  }
}

export function eventFromRow(row, attendees = [], milestones = [], links = [], categoryIds = [], teams = [], aiState = null) {
  let recordIds = [];
  try { recordIds = JSON.parse(row.record_ids_json || "[]"); } catch { /* empty */ }
  return {
    id: row.id, title: row.title, startsAt: row.starts_at, endsAt: row.ends_at || "",
    location: row.location || "", notes: row.notes || "", status: row.status,
    recordIds, attendees, attendeeIds: attendees.map((attendee) => attendee.id), milestones, links, categoryIds,
    teams, teamIds: teams.map((team) => team.id), wallboard: Boolean(row.wallboard), version: row.version,
    aiAmended: Boolean(aiState?.last_applied_at), lastAugmentedAt: aiState?.last_augmented_at || null,
    lastAiAppliedAt: aiState?.last_applied_at || null, aiValidationRequired: Boolean(aiState?.validation_required),
    lastAugmentationJobId: aiState?.last_job_id || null, lastAugmentationStatus: aiState?.last_status || null,
    createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

export async function eventsFromRows(db, workspaceId, rows = []) {
  if (!rows.length) return [];
  const ids = rows.map((row) => row.id);
  const placeholders = ids.map(() => "?").join(", ");
  const [attendeeResult, milestoneResult, linkResult, categoryResult, teamResult, aiStateResult] = await Promise.all([
    db.prepare(`SELECT attendee.event_id, user.user_id, user.display_name, user.title, user.status, profile.avatar_data_url
      FROM dbi_workspace_event_attendees attendee JOIN dbi_users user ON user.user_id = attendee.user_id
      LEFT JOIN dbi_user_profiles profile ON profile.user_id = user.user_id
      WHERE attendee.workspace_id = ? AND attendee.event_id IN (${placeholders}) ORDER BY user.display_name COLLATE NOCASE`).bind(workspaceId, ...ids).all(),
    db.prepare(`SELECT event_id, milestone_id, type, label, occurs_at, notes FROM dbi_workspace_event_milestones
      WHERE workspace_id = ? AND event_id IN (${placeholders}) ORDER BY occurs_at, milestone_id`).bind(workspaceId, ...ids).all(),
    db.prepare(`SELECT event_id, link_id, label, url, sort_order FROM dbi_workspace_event_links
      WHERE workspace_id = ? AND event_id IN (${placeholders}) ORDER BY sort_order, link_id`).bind(workspaceId, ...ids).all(),
    db.prepare(`SELECT event_id, category_id FROM dbi_workspace_event_category_assignments
      WHERE workspace_id = ? AND event_id IN (${placeholders}) ORDER BY category_id`).bind(workspaceId, ...ids).all(),
    db.prepare(`SELECT assignment.event_id, team.team_id, team.name, team.description, team.icon_data_url
      FROM dbi_workspace_event_teams assignment JOIN dbi_workspace_teams team
      ON team.workspace_id = assignment.workspace_id AND team.team_id = assignment.team_id
      WHERE assignment.workspace_id = ? AND assignment.event_id IN (${placeholders}) ORDER BY team.name COLLATE NOCASE`).bind(workspaceId, ...ids).all(),
    db.prepare(`SELECT event_id, last_job_id, last_status, last_augmented_at, last_applied_at, validation_required
      FROM dbi_event_ai_state WHERE workspace_id = ? AND event_id IN (${placeholders})`).bind(workspaceId, ...ids).all(),
  ]);
  const group = (rows, key, map) => {
    const result = new Map();
    for (const row of rows || []) { const list = result.get(row.event_id) || []; list.push(map(row)); result.set(row.event_id, list); }
    return result;
  };
  const attendees = group(attendeeResult.results, "event_id", (row) => ({ id: row.user_id, displayName: row.display_name, title: row.title || "", status: row.status, avatarDataUrl: row.avatar_data_url || "" }));
  const milestones = group(milestoneResult.results, "event_id", (row) => ({ id: row.milestone_id, type: row.type, label: row.label || "", occursAt: row.occurs_at, notes: row.notes || "" }));
  const links = group(linkResult.results, "event_id", (row) => ({ id: row.link_id, label: row.label || "", url: row.url, sortOrder: Number(row.sort_order || 0) }));
  const categories = group(categoryResult.results, "event_id", (row) => row.category_id);
  const teams = group(teamResult.results, "event_id", (row) => ({ id: row.team_id, name: row.name, description: row.description || "", iconDataUrl: row.icon_data_url || "" }));
  const aiStates = new Map((aiStateResult.results || []).map((row) => [row.event_id, row]));
  return rows.map((row) => eventFromRow(row, attendees.get(row.id) || [], milestones.get(row.id) || [], links.get(row.id) || [], categories.get(row.id) || [], teams.get(row.id) || [], aiStates.get(row.id) || null));
}

export function principalSeesAllWorkspaceEvents(principal) {
  return principal.type !== "user" || (principal.roleId === "super_user" && !principal.isEmulating);
}

export async function visibleEventRow(db, principal, eventId) {
  if (principalSeesAllWorkspaceEvents(principal)) return db.prepare("SELECT * FROM dbi_workspace_events WHERE workspace_id = ? AND id = ?").bind(principal.workspaceId, eventId).first();
  return db.prepare(`SELECT event.* FROM dbi_workspace_events event WHERE event.workspace_id = ? AND event.id = ? AND (
    NOT EXISTS (SELECT 1 FROM dbi_workspace_event_teams assigned WHERE assigned.workspace_id = event.workspace_id AND assigned.event_id = event.id)
    OR EXISTS (SELECT 1 FROM dbi_workspace_event_teams assigned JOIN dbi_workspace_team_members member
      ON member.workspace_id = assigned.workspace_id AND member.team_id = assigned.team_id
      WHERE assigned.workspace_id = event.workspace_id AND assigned.event_id = event.id AND member.user_id = ?))`)
    .bind(principal.workspaceId, eventId, principal.id).first();
}

export async function visibleEventRows(db, principal) {
  if (principalSeesAllWorkspaceEvents(principal)) return db.prepare("SELECT * FROM dbi_workspace_events WHERE workspace_id = ? ORDER BY starts_at, created_at").bind(principal.workspaceId).all();
  return db.prepare(`SELECT event.* FROM dbi_workspace_events event WHERE event.workspace_id = ? AND (
    NOT EXISTS (SELECT 1 FROM dbi_workspace_event_teams assigned WHERE assigned.workspace_id = event.workspace_id AND assigned.event_id = event.id)
    OR EXISTS (SELECT 1 FROM dbi_workspace_event_teams assigned JOIN dbi_workspace_team_members member
      ON member.workspace_id = assigned.workspace_id AND member.team_id = assigned.team_id
      WHERE assigned.workspace_id = event.workspace_id AND assigned.event_id = event.id AND member.user_id = ?))
    ORDER BY event.starts_at, event.created_at`).bind(principal.workspaceId, principal.id).all();
}

export async function eventTeamSelection(db, principal, value) {
  const selection = await activeEventTeamIds(db, principal.workspaceId, value);
  if (!selection.valid || !selection.ids.length || principalSeesAllWorkspaceEvents(principal) || principal.canManageWorkspace) return selection;
  const placeholders = selection.ids.map(() => "?").join(", ");
  const result = await db.prepare(`SELECT team_id FROM dbi_workspace_team_members
    WHERE workspace_id = ? AND user_id = ? AND team_id IN (${placeholders})`).bind(principal.workspaceId, principal.id, ...selection.ids).all();
  return { ids: selection.ids, valid: (result.results || []).length === selection.ids.length };
}

export async function applyVerifiedEventDraft(db, row, mergedDraft, now) {
  const eventId = cleanText(mergedDraft?.id, 180);
  const expected = Number(mergedDraft?.version || 0);
  if (!eventId || !expected) return { applied: false, reason: "event_identity_unavailable" };
  const existing = await db.prepare("SELECT version FROM dbi_workspace_events WHERE workspace_id = ? AND id = ?")
    .bind(row.workspace_id, eventId).first();
  if (!existing) return { applied: false, reason: "event_not_found" };
  if (Number(existing.version) !== expected) return { applied: false, reason: "event_changed_since_research" };
  const links = cleanEventLinks(mergedDraft.links || []);
  const milestones = cleanEventMilestones(mergedDraft.milestones || []);
  const categories = await activeEventCategoryIds(db, row.workspace_id, mergedDraft.categoryIds || []);
  if (!links.valid || !milestones.valid || !categories.valid) return { applied: false, reason: "verified_draft_invalid" };
  const updated = await db.prepare(`UPDATE dbi_workspace_events SET title = ?, starts_at = ?, ends_at = ?, location = ?, notes = ?, status = ?,
    record_ids_json = ?, wallboard = ?, version = version + 1, updated_at = ?
    WHERE id = ? AND workspace_id = ? AND version = ?`)
    .bind(cleanText(mergedDraft.title, 180), cleanDate(mergedDraft.startsAt), cleanDate(mergedDraft.endsAt),
      cleanText(mergedDraft.location, 500), cleanText(mergedDraft.notes, 4000),
      ["scheduled", "completed", "cancelled"].includes(mergedDraft.status) ? mergedDraft.status : "scheduled",
      JSON.stringify(cleanStringArray(mergedDraft.recordIds)), mergedDraft.wallboard === false ? 0 : 1,
      now, eventId, row.workspace_id, expected).run();
  if (!Number(updated?.meta?.changes || 0)) return { applied: false, reason: "event_changed_since_research" };
  await replaceEventMilestones(db, row.workspace_id, eventId, milestones.milestones);
  await replaceEventLinks(db, row.workspace_id, eventId, links.links);
  await replaceEventCategories(db, row.workspace_id, eventId, categories.ids);
  return { applied: true, eventId };
}
