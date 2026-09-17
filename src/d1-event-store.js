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

export async function replaceEventAttendees(db, workspaceId, eventId, attendeeIds) {
  await db.prepare("DELETE FROM dbi_workspace_event_attendees WHERE workspace_id = ? AND event_id = ?").bind(workspaceId, eventId).run();
  const createdAt = new Date().toISOString();
  for (const userId of attendeeIds) {
    await db.prepare("INSERT INTO dbi_workspace_event_attendees (workspace_id, event_id, user_id, created_at) VALUES (?, ?, ?, ?)").bind(workspaceId, eventId, userId, createdAt).run();
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
