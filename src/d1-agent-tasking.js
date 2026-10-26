import { TASKING_FOUNDATION } from "./tasking-foundation-data.js";
import { TASKING_TASK_STATUSES, taskingTaskOwnerRequired } from "./tasking-model.js";
import { cleanText } from "./security-policy.js";

export const TASKING_AGENT_SCOPES = Object.freeze(["tasking:read", "tasking:write"]);

export const D1_AGENT_TASKING_SCHEMA = Object.freeze([
  `CREATE TABLE IF NOT EXISTS dbi_workspace_tasking_objects (
    workspace_id TEXT NOT NULL,
    object_id TEXT NOT NULL,
    object_type TEXT NOT NULL CHECK (object_type IN ('task','workstream','anchor','context','relationship','source_item')),
    payload_json TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    source_system TEXT NOT NULL DEFAULT '',
    source_key TEXT NOT NULL DEFAULT '',
    created_by_type TEXT NOT NULL,
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT NOT NULL DEFAULT '',
    PRIMARY KEY (workspace_id, object_id)
  )`,
  "CREATE INDEX IF NOT EXISTS idx_dbi_tasking_objects_workspace_type ON dbi_workspace_tasking_objects (workspace_id, object_type, updated_at DESC)",
  "CREATE UNIQUE INDEX IF NOT EXISTS idx_dbi_tasking_objects_source ON dbi_workspace_tasking_objects (workspace_id, source_system, source_key) WHERE source_system <> '' AND source_key <> ''",
]);

const RECORD_TYPES = new Set(["workstream", "anchor", "context"]);
const SOURCE_PROVIDERS = new Set(["localfs", "onedrive"]);
const MAX_BATCH_ITEMS = 50;

function objectId(value) {
  const id = cleanText(value, 160);
  return /^[A-Za-z0-9][A-Za-z0-9._:~-]{0,159}$/.test(id) ? id : "";
}

function integer(value, fallback = 0, minimum = 0, maximum = Number.MAX_SAFE_INTEGER) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(maximum, Math.max(minimum, Math.trunc(number))) : fallback;
}

function cleanIso(value) {
  const input = cleanText(value, 48);
  if (!input) return null;
  const time = Date.parse(input);
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

function cleanWebUrl(value) {
  const input = cleanText(value, 2_000);
  if (!input) return "";
  try {
    const url = new URL(input);
    if (url.protocol !== "https:" || url.username || url.password) return "";
    if ([...url.searchParams.keys()].some((key) => /(?:token|secret|password|credential|authorization|code)/i.test(key))) return "";
    return url.toString();
  } catch {
    return "";
  }
}

function parsePayload(row) {
  try { return JSON.parse(row?.payload_json || "{}"); }
  catch { return {}; }
}

function objectFromRow(row) {
  if (!row) return null;
  return {
    ...parsePayload(row),
    id: row.object_id,
    type: row.object_type,
    version: Number(row.version || 1),
    sourceSystem: row.source_system || null,
    sourceKey: row.source_key || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at || null,
  };
}

export function normalizeTaskingTask(body = {}, current = null) {
  const status = cleanText(body.status ?? current?.status ?? "ready", 40);
  if (!TASKING_TASK_STATUSES.includes(status)) return { error: "A valid task status is required" };
  const task = {
    kind: "Task",
    title: cleanText(body.title ?? current?.title, 160),
    description: cleanText(body.description ?? current?.description, 1_200),
    status,
    owner: cleanText(body.owner ?? current?.owner, 100),
    acceptance: cleanText(body.acceptance ?? current?.acceptance, 500),
    anchorId: objectId(body.anchorId ?? current?.anchorId),
    evidenceCount: integer(body.evidenceCount ?? current?.evidenceCount, 0, 0, 10_000),
    dependencyCount: integer(body.dependencyCount ?? current?.dependencyCount, 0, 0, 10_000),
  };
  if (!task.title || !task.description || !task.acceptance || !task.anchorId) return { error: "Task title, description, acceptance, and anchorId are required" };
  if (taskingTaskOwnerRequired(status) && !task.owner) return { error: "Task owner is required unless status is draft" };
  return { payload: task };
}

function normalizeRecord(type, body = {}, current = null) {
  if (type === "workstream") {
    const payload = {
      name: cleanText(body.name ?? current?.name, 160),
      description: cleanText(body.description ?? current?.description, 1_200),
      tone: cleanText(body.tone ?? current?.tone ?? "blue", 40),
    };
    return payload.name ? { payload } : { error: "Workstream name is required" };
  }
  if (type === "anchor") {
    const payload = {
      kind: cleanText(body.kind ?? current?.kind, 80),
      title: cleanText(body.title ?? current?.title, 200),
      workstreamId: objectId(body.workstreamId ?? current?.workstreamId),
      folderId: objectId(body.folderId ?? current?.folderId),
      status: cleanText(body.status ?? current?.status ?? "ready", 40),
      priority: cleanText(body.priority ?? current?.priority ?? "medium", 40),
      outcome: cleanText(body.outcome ?? current?.outcome, 1_200),
      nextMove: cleanText(body.nextMove ?? current?.nextMove, 500),
      dueLabel: cleanText(body.dueLabel ?? current?.dueLabel, 120),
      sourceState: cleanText(body.sourceState ?? current?.sourceState ?? "current", 40),
    };
    return payload.kind && payload.title && payload.workstreamId ? { payload } : { error: "Anchor kind, title, and workstreamId are required" };
  }
  const payload = {
    kind: cleanText(body.kind ?? current?.kind, 80),
    title: cleanText(body.title ?? current?.title, 200),
    status: cleanText(body.status ?? current?.status ?? "open", 40),
    description: cleanText(body.description ?? current?.description, 1_200),
  };
  return payload.kind && payload.title ? { payload } : { error: "Context kind and title are required" };
}

function normalizeRelationship(body = {}, current = null) {
  const payload = {
    fromId: objectId(body.fromId ?? current?.fromId),
    toId: objectId(body.toId ?? current?.toId),
    type: cleanText(body.type ?? current?.type, 80),
    status: cleanText(body.status ?? current?.status ?? "suggested", 40),
    basis: cleanText(body.basis ?? current?.basis, 1_200),
  };
  if (!payload.fromId || !payload.toId || payload.fromId === payload.toId || !payload.type || !payload.basis) return { error: "Relationship fromId, toId, type, and basis are required" };
  return { payload };
}

export function normalizeSourceItem(body = {}, current = null) {
  const provider = cleanText(body.provider ?? current?.provider ?? "localfs", 40).toLowerCase();
  const sourceId = cleanText(body.sourceId ?? current?.sourceId, 500);
  const itemType = cleanText(body.itemType ?? body.kind ?? current?.itemType, 20).toLowerCase();
  const webUrlInput = body.webUrl ?? current?.webUrl ?? "";
  const lastModifiedInput = body.lastModifiedAt ?? current?.lastModifiedAt ?? "";
  if (!SOURCE_PROVIDERS.has(provider)) return { error: "Source provider must be localfs or onedrive" };
  if (!sourceId || !["file", "folder"].includes(itemType)) return { error: "Source ID and item type are required" };
  if (webUrlInput && !cleanWebUrl(webUrlInput)) return { error: "Source webUrl must be a credential-free HTTPS URL" };
  if (lastModifiedInput && !cleanIso(lastModifiedInput)) return { error: "Source lastModifiedAt must be a valid date" };
  const payload = {
    provider,
    sourceId,
    driveId: cleanText(body.driveId ?? current?.driveId, 300),
    itemId: cleanText(body.itemId ?? current?.itemId, 300),
    parentSourceId: cleanText(body.parentSourceId ?? current?.parentSourceId, 500),
    name: cleanText(body.name ?? current?.name, 240),
    path: cleanText(body.path ?? current?.path, 1_000),
    itemType,
    webUrl: cleanWebUrl(webUrlInput),
    etag: cleanText(body.etag ?? current?.etag, 300),
    mimeType: cleanText(body.mimeType ?? current?.mimeType, 160),
    size: integer(body.size ?? current?.size, 0, 0),
    lastModifiedAt: cleanIso(lastModifiedInput),
    status: cleanText(body.status ?? current?.status ?? "current", 40),
    parseStatus: cleanText(body.parseStatus ?? current?.parseStatus ?? "observed", 40),
    summary: cleanText(body.summary ?? current?.summary, 2_000),
    recordId: objectId(body.recordId ?? current?.recordId),
  };
  return payload.name && payload.path ? { payload, sourceKey: sourceId } : { error: "Source name and path are required" };
}

async function rows(db, workspaceId, type = "", includeDeleted = false) {
  const clauses = ["workspace_id = ?"];
  const values = [workspaceId];
  if (type) { clauses.push("object_type = ?"); values.push(type); }
  if (!includeDeleted) clauses.push("deleted_at = ''");
  const result = await db.prepare(`SELECT * FROM dbi_workspace_tasking_objects WHERE ${clauses.join(" AND ")} ORDER BY updated_at DESC`).bind(...values).all();
  return (result.results || []).map(objectFromRow);
}

async function row(db, workspaceId, id, includeDeleted = false) {
  const result = await db.prepare(`SELECT * FROM dbi_workspace_tasking_objects WHERE workspace_id = ? AND object_id = ?${includeDeleted ? "" : " AND deleted_at = ''"}`).bind(workspaceId, id).first();
  return objectFromRow(result);
}

async function storeObject(db, principal, { id, type, payload, sourceSystem = "", sourceKey = "", expected = null, allowRestore = false }) {
  const current = await row(db, principal.workspaceId, id, true);
  const now = new Date().toISOString();
  if (!current) {
    if (expected !== null && expected !== 0) return { conflict: null };
    const created = await db.prepare(`INSERT OR IGNORE INTO dbi_workspace_tasking_objects
      (workspace_id,object_id,object_type,payload_json,version,source_system,source_key,created_by_type,created_by,created_at,updated_at,deleted_at)
      VALUES (?,?,?,?,1,?,?,?,?,?,?, '')`).bind(principal.workspaceId, id, type, JSON.stringify(payload), sourceSystem, sourceKey,
      principal.type, principal.actorId || principal.id, now, now).run();
    if (!Number(created?.meta?.changes || 0)) return { conflict: await row(db, principal.workspaceId, id, true) };
    return { object: await row(db, principal.workspaceId, id) };
  }
  if (current.type !== type) return { typeConflict: current };
  if (expected !== null && expected !== current.version) return { conflict: current };
  if (current.deletedAt && !allowRestore) return { deleted: current };
  const changed = await db.prepare(`UPDATE dbi_workspace_tasking_objects SET payload_json=?, version=version+1, source_system=?, source_key=?, updated_at=?, deleted_at=''
    WHERE workspace_id=? AND object_id=? AND version=?`).bind(JSON.stringify(payload), sourceSystem, sourceKey, now, principal.workspaceId, id, current.version).run();
  if (!Number(changed?.meta?.changes || 0)) return { conflict: await row(db, principal.workspaceId, id, true) };
  return { object: await row(db, principal.workspaceId, id) };
}

async function deleteObject(db, principal, id, expected) {
  const current = await row(db, principal.workspaceId, id);
  if (!current) return { missing: true };
  if (expected === null) return { precondition: current };
  if (expected !== current.version) return { conflict: current };
  const now = new Date().toISOString();
  const changed = await db.prepare("UPDATE dbi_workspace_tasking_objects SET version=version+1, updated_at=?, deleted_at=? WHERE workspace_id=? AND object_id=? AND version=? AND deleted_at='' ")
    .bind(now, now, principal.workspaceId, id, current.version).run();
  if (!Number(changed?.meta?.changes || 0)) return { conflict: await row(db, principal.workspaceId, id, true) };
  return { object: current };
}

function writeResult(result, deps) {
  if (result.typeConflict) return deps.error("object_type_conflict", "This ID is already used by another Tasking object type", 409, undefined, { current: result.typeConflict });
  if (result.deleted) return deps.error("object_deleted", "This Tasking object is deleted; use the source sync route to restore source items", 409, undefined, { current: result.deleted });
  if (Object.hasOwn(result, "conflict")) return deps.error("version_conflict", "Tasking state changed since the supplied version", 409, undefined, { current: result.conflict });
  return null;
}

async function snapshot(db, workspaceId) {
  const objects = await rows(db, workspaceId);
  const byType = (type) => objects.filter((item) => item.type === type);
  const sourceItems = byType("source_item");
  const relationships = byType("relationship");
  const tasks = byType("task").map((task) => ({ ...task, taskId: task.id, persisted: true }));
  const anchors = byType("anchor").map((anchor) => ({
    ...anchor,
    taskIds: tasks.filter((task) => task.anchorId === anchor.id).map((task) => task.id),
    connectionIds: [...new Set([
      ...(anchor.connectionIds || []),
      ...relationships.filter((relationship) => relationship.fromId === anchor.id).map((relationship) => relationship.toId),
      ...relationships.filter((relationship) => relationship.toId === anchor.id).map((relationship) => relationship.fromId),
    ])],
    dueLabel: anchor.dueLabel || "No date",
    updatedLabel: anchor.updatedLabel || (anchor.updatedAt ? "Workspace updated" : "Observed"),
  }));
  const workstreams = byType("workstream").map((workstream) => ({
    ...workstream,
    anchors: anchors.filter((anchor) => anchor.workstreamId === workstream.id).map((anchor) => anchor.id),
  }));
  const contextRecords = byType("context");
  const linkedSourceItems = sourceItems.filter((item) => item.recordId).length;
  const sourceFiles = sourceItems.filter((item) => item.itemType === "file").length;
  const sourceFolders = sourceItems.filter((item) => item.itemType === "folder").length;
  const observedAt = objects.reduce((latest, item) => !latest || item.updatedAt > latest ? item.updatedAt : latest, null);
  const counts = {
    workstreams: workstreams.length,
    anchors: anchors.length,
    tasks: tasks.length,
    contextRecords: contextRecords.length,
    relationships: relationships.length,
    sourceItems: sourceItems.length,
    sourceFiles,
    sourceFolders,
    linkedSourceItems,
  };
  return {
    metadata: {
      ...TASKING_FOUNDATION.metadata,
      mode: objects.length ? "workspace" : TASKING_FOUNDATION.metadata.mode,
      label: objects.length ? "Workspace tasking" : TASKING_FOUNDATION.metadata.label,
      observedAt,
      sourceHealth: sourceItems.length ? "connected" : TASKING_FOUNDATION.metadata.sourceHealth,
      coverage: sourceItems.length
        ? `${sourceItems.length} normalized source item${sourceItems.length === 1 ? "" : "s"}; ${linkedSourceItems} linked to workspace records.`
        : objects.length ? "Workspace records are available; no source metadata is connected." : TASKING_FOUNDATION.metadata.coverage,
      counts,
    },
    folders: [],
    workstreams,
    anchors,
    tasks,
    contextRecords,
    relationships,
    sourceItems,
  };
}

async function customCollectionResponse(request, db, principal, type, segments, deps) {
  const id = objectId(decodeURIComponent(segments[1] || ""));
  const current = id ? await row(db, principal.workspaceId, id) : null;
  if (id && current && current.type !== type) return deps.error("object_type_conflict", "This ID belongs to another Tasking object type", 409, undefined, { current });
  if (request.method === "GET") {
    if (id) return current ? deps.json(current) : deps.error("tasking_object_not_found", "Tasking object not found", 404);
    return deps.json(await rows(db, principal.workspaceId, type), 200, { type });
  }
  if (request.method === "POST" && !id) return deps.idempotent(db, principal, request, async () => {
    const body = await deps.safeJson(request);
    const newId = objectId(body?.id);
    if (!newId) return deps.error("invalid_tasking_id", "A stable Tasking object ID is required", 400);
    const normalized = type === "task" ? normalizeTaskingTask(body) : type === "relationship" ? normalizeRelationship(body) : normalizeRecord(type, body);
    if (normalized.error) return deps.error("invalid_tasking_object", normalized.error, 400);
    const result = await storeObject(db, principal, { id: newId, type, payload: normalized.payload, expected: 0 });
    const error = writeResult(result, deps); if (error) return error;
    await deps.recordActivity(db, principal, "tasking_object_created", type, newId, { version: result.object.version });
    return deps.json(result.object, 201);
  });
  if (request.method === "PATCH" && id) {
    if (!current) return deps.error("tasking_object_not_found", "Tasking object not found", 404);
    const body = await deps.safeJson(request);
    const expected = deps.expectedVersion(request, body);
    if (expected === null) return deps.error("precondition_required", "If-Match with the current Tasking object version is required", 428);
    const normalized = type === "task" ? normalizeTaskingTask(body, current) : type === "relationship" ? normalizeRelationship(body, current) : normalizeRecord(type, body, current);
    if (normalized.error) return deps.error("invalid_tasking_object", normalized.error, 400);
    const result = await storeObject(db, principal, { id, type, payload: normalized.payload, expected });
    const error = writeResult(result, deps); if (error) return error;
    await deps.recordActivity(db, principal, "tasking_object_updated", type, id, { version: result.object.version });
    return deps.json(result.object);
  }
  if (request.method === "DELETE" && id) {
    const current = await row(db, principal.workspaceId, id);
    if (current && current.type !== type) return deps.error("object_type_conflict", "This ID belongs to another Tasking object type", 409, undefined, { current });
    const result = await deleteObject(db, principal, id, deps.expectedVersion(request));
    if (result.missing) return new Response(null, { status: 204 });
    if (result.precondition) return deps.error("precondition_required", "If-Match with the current Tasking object version is required", 428);
    const error = writeResult(result, deps); if (error) return error;
    await deps.recordActivity(db, principal, "tasking_object_deleted", type, id, { version: result.object.version });
    return new Response(null, { status: 204 });
  }
  return deps.error("method_not_allowed", "Method not allowed", 405);
}

async function tasksResponse(request, db, principal, segments, deps) {
  const taskId = objectId(decodeURIComponent(segments[1] || ""));
  if (request.method === "GET" && !taskId) {
    const tasks = await rows(db, principal.workspaceId, "task");
    return deps.json(tasks.map((task) => ({ ...task, taskId: task.id, persisted: true })), 200, { total: tasks.length });
  }
  return customCollectionResponse(request, db, principal, "task", segments, deps);
}

async function recordsResponse(request, db, principal, segments, deps) {
  const id = objectId(decodeURIComponent(segments[1] || ""));
  if (request.method === "GET" && !id) {
    const requestedType = cleanText(new URL(request.url).searchParams.get("type"), 30);
    if (requestedType && !RECORD_TYPES.has(requestedType)) return deps.error("invalid_record_type", "Record type must be workstream, anchor, or context", 400);
    const records = requestedType ? await rows(db, principal.workspaceId, requestedType) : (await rows(db, principal.workspaceId)).filter((item) => RECORD_TYPES.has(item.type));
    return deps.json(records, 200, { total: records.length, type: requestedType || "all" });
  }
  if (request.method === "POST" && !id) {
    const clone = request.clone(); const body = await deps.safeJson(clone); const type = cleanText(body?.type, 30);
    if (!RECORD_TYPES.has(type)) return deps.error("invalid_record_type", "Record type must be workstream, anchor, or context", 400);
    return customCollectionResponse(request, db, principal, type, segments, deps);
  }
  if (!id) return deps.error("invalid_tasking_id", "A stable Tasking object ID is required", 400);
  const current = await row(db, principal.workspaceId, id);
  if (!current || !RECORD_TYPES.has(current.type)) return deps.error("tasking_object_not_found", "Tasking record not found", 404);
  return customCollectionResponse(request, db, principal, current.type, segments, deps);
}

async function sourceItemsResponse(request, db, principal, segments, deps) {
  const id = objectId(decodeURIComponent(segments[1] || ""));
  if (request.method === "GET" && !id) {
    const includeDeleted = new URL(request.url).searchParams.get("includeDeleted") === "1";
    const items = await rows(db, principal.workspaceId, "source_item", includeDeleted);
    return deps.json(items, 200, { providers: [...new Set(items.map((item) => item.provider))], total: items.length, includeDeleted });
  }
  if (request.method === "POST" && segments[1] === "batch") return deps.idempotent(db, principal, request, async () => {
    const body = await deps.safeJson(request);
    const items = Array.isArray(body?.items) ? body.items : [];
    if (!items.length || items.length > MAX_BATCH_ITEMS) return deps.error("invalid_source_batch", `Source batches must contain 1 to ${MAX_BATCH_ITEMS} items`, 400);
    const normalized = items.map((item) => ({ id: objectId(item?.id), result: normalizeSourceItem(item) }));
    const invalid = normalized.find((item) => !item.id || item.result.error);
    if (invalid) return deps.error("invalid_source_item", invalid.result.error || "Every source item requires a stable ID", 400);
    if (new Set(normalized.map((item) => item.id)).size !== normalized.length || new Set(normalized.map((item) => `${item.result.payload.provider}:${item.result.sourceKey}`)).size !== normalized.length) return deps.error("duplicate_source_item", "Source batch IDs and provider/sourceId pairs must be unique", 400);
    const current = await Promise.all(normalized.map(async (item) => ({
      ...item,
      byId: await row(db, principal.workspaceId, item.id, true),
      bySource: objectFromRow(await db.prepare("SELECT * FROM dbi_workspace_tasking_objects WHERE workspace_id=? AND source_system=? AND source_key=?")
        .bind(principal.workspaceId, item.result.payload.provider, item.result.sourceKey).first()),
    })));
    const conflict = current.find((item) => (item.byId && item.byId.type !== "source_item") || (item.bySource && item.bySource.id !== item.id));
    if (conflict) return deps.error("source_identity_conflict", "A source ID or provider/sourceId pair is already bound to another Tasking object", 409, undefined, { current: conflict.byId || conflict.bySource });
    const now = new Date().toISOString();
    await db.batch(current.map((item) => item.byId
      ? db.prepare(`UPDATE dbi_workspace_tasking_objects SET payload_json=?,version=version+1,source_system=?,source_key=?,updated_at=?,deleted_at=''
          WHERE workspace_id=? AND object_id=?`).bind(JSON.stringify(item.result.payload), item.result.payload.provider, item.result.sourceKey, now, principal.workspaceId, item.id)
      : db.prepare(`INSERT INTO dbi_workspace_tasking_objects
          (workspace_id,object_id,object_type,payload_json,version,source_system,source_key,created_by_type,created_by,created_at,updated_at,deleted_at)
          VALUES (?,?,'source_item',?,1,?,?,?,?,?,?, '')`).bind(principal.workspaceId, item.id, JSON.stringify(item.result.payload), item.result.payload.provider,
          item.result.sourceKey, principal.type, principal.actorId || principal.id, now, now)));
    const stored = await Promise.all(normalized.map((item) => row(db, principal.workspaceId, item.id)));
    await deps.recordActivity(db, principal, "tasking_source_batch_synced", "source_item", "", { itemCount: stored.length });
    return deps.json({ items: stored }, 200, { providers: [...new Set(stored.map((item) => item.provider))], accepted: stored.length });
  });
  if (request.method === "PUT" && id) return deps.idempotent(db, principal, request, async () => {
    const body = await deps.safeJson(request); const normalized = normalizeSourceItem(body);
    if (normalized.error) return deps.error("invalid_source_item", normalized.error, 400);
    const result = await storeObject(db, principal, { id, type: "source_item", payload: normalized.payload, sourceSystem: normalized.payload.provider, sourceKey: normalized.sourceKey, allowRestore: true });
    const error = writeResult(result, deps); if (error) return error;
    await deps.recordActivity(db, principal, "tasking_source_item_synced", "source_item", id, { version: result.object.version });
    return deps.json(result.object, result.object.version === 1 ? 201 : 200);
  });
  if (request.method === "GET" && id) {
    const item = await row(db, principal.workspaceId, id, new URL(request.url).searchParams.get("includeDeleted") === "1");
    return item?.type === "source_item" ? deps.json(item) : deps.error("source_item_not_found", "Source item not found", 404);
  }
  if (request.method === "DELETE" && id) {
    const result = await deleteObject(db, principal, id, deps.expectedVersion(request));
    if (result.missing) return new Response(null, { status: 204 });
    if (result.precondition) return deps.error("precondition_required", "If-Match with the current source item version is required", 428);
    const error = writeResult(result, deps); if (error) return error;
    await deps.recordActivity(db, principal, "tasking_source_item_deleted", "source_item", id, { version: result.object.version });
    return new Response(null, { status: 204 });
  }
  return deps.error("method_not_allowed", "Method not allowed", 405);
}

export async function agentTaskingResponse(request, db, principal, segments, deps) {
  const requiredScope = ["GET", "HEAD"].includes(request.method) ? "tasking:read" : "tasking:write";
  if (!deps.hasScope(principal, requiredScope)) return deps.error("insufficient_scope", `Scope ${requiredScope} is required`, 403);
  if (!segments.length) return request.method === "GET" ? deps.json(await snapshot(db, principal.workspaceId)) : deps.error("method_not_allowed", "Method not allowed", 405);
  if (segments[0] === "tasks") return tasksResponse(request, db, principal, segments, deps);
  if (segments[0] === "records") return recordsResponse(request, db, principal, segments, deps);
  if (segments[0] === "relationships") return customCollectionResponse(request, db, principal, "relationship", segments, deps);
  if (segments[0] === "source-items") return sourceItemsResponse(request, db, principal, segments, deps);
  return deps.error("route_not_found", "Unknown Tasking Agent API route", 404);
}
