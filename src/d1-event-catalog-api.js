import { catalogEventByIdFromRows, eventCatalog, searchEventCatalogRows } from "./event-catalog.js";
import { dynamicEventCatalog, eventDiscoverySnapshot, reviewEventCandidate, runEventDiscoverySweep } from "./event-discovery-runtime.js";

export async function completeEventCatalog(db) {
  const staticCatalog = eventCatalog();
  const dynamicCatalog = await dynamicEventCatalog(db);
  const byId = new Map(staticCatalog.map((event) => [event.id, event]));
  for (const event of dynamicCatalog) byId.set(event.id, event);
  return [...byId.values()];
}

function eventCategoryFromRow(row) {
  return { id: row.category_id, name: row.name, description: row.description || "", assignedEventCount: Number(row.assigned_event_count || 0), createdAt: row.created_at, updatedAt: row.updated_at };
}

export async function eventCategoriesResponse(request, db, principal, segments, deps) {
  if (!deps.hasScope(principal, "events:read")) return deps.error("insufficient_scope", "Scope events:read is required", 403);
  const categoryId = deps.cleanText(decodeURIComponent(segments[0] || ""), 80);
  if (request.method === "GET") {
    const result = await db.prepare(`SELECT category.*,
      (SELECT COUNT(*) FROM dbi_workspace_event_category_assignments assignment
        WHERE assignment.workspace_id = category.workspace_id AND assignment.category_id = category.category_id) AS assigned_event_count
      FROM dbi_workspace_event_categories category WHERE category.workspace_id = ? ORDER BY category.name COLLATE NOCASE`).bind(principal.workspaceId).all();
    return deps.json((result.results || []).map(eventCategoryFromRow), 200, { total: result.results?.length || 0 });
  }
  if (principal.type !== "user" || !principal.canManageWorkspace) return deps.error("workspace_manager_required", "Workspace manager access is required to manage event categories", 403);
  if (request.method === "POST" && !categoryId) {
    const body = await deps.safeJson(request); const name = deps.cleanText(body?.name, 80); const description = deps.cleanText(body?.description, 240);
    if (name.length < 2) return deps.error("invalid_event_category", "Category name must be at least two characters", 400);
    const id = crypto.randomUUID(); const now = new Date().toISOString();
    const created = await db.prepare("INSERT OR IGNORE INTO dbi_workspace_event_categories (workspace_id, category_id, name, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
      .bind(principal.workspaceId, id, name, description, now, now).run();
    if (!Number(created?.meta?.changes || 0)) return deps.error("event_category_exists", "An event category with that name already exists", 409);
    const row = await db.prepare("SELECT * FROM dbi_workspace_event_categories WHERE workspace_id = ? AND category_id = ?").bind(principal.workspaceId, id).first();
    await deps.recordActivity(db, principal, "event_category_created", "event_category", id, { name });
    return deps.json(eventCategoryFromRow(row), 201);
  }
  const existing = categoryId ? await db.prepare("SELECT * FROM dbi_workspace_event_categories WHERE workspace_id = ? AND category_id = ?").bind(principal.workspaceId, categoryId).first() : null;
  if (!existing) return deps.error("event_category_not_found", "Event category not found", 404);
  if (request.method === "PATCH") {
    const body = await deps.safeJson(request); const name = deps.cleanText(body?.name ?? existing.name, 80); const description = deps.cleanText(body?.description ?? existing.description, 240);
    if (name.length < 2) return deps.error("invalid_event_category", "Category name must be at least two characters", 400);
    const now = new Date().toISOString();
    const updated = await db.prepare("UPDATE OR IGNORE dbi_workspace_event_categories SET name = ?, description = ?, updated_at = ? WHERE workspace_id = ? AND category_id = ?")
      .bind(name, description, now, principal.workspaceId, categoryId).run();
    if (!Number(updated?.meta?.changes || 0)) return deps.error("event_category_exists", "An event category with that name already exists", 409);
    const row = await db.prepare("SELECT * FROM dbi_workspace_event_categories WHERE workspace_id = ? AND category_id = ?").bind(principal.workspaceId, categoryId).first();
    await deps.recordActivity(db, principal, "event_category_updated", "event_category", categoryId, { name });
    return deps.json(eventCategoryFromRow(row));
  }
  if (request.method === "DELETE") {
    const assignment = await db.prepare("SELECT COUNT(*) AS count FROM dbi_workspace_event_category_assignments WHERE workspace_id = ? AND category_id = ?").bind(principal.workspaceId, categoryId).first();
    if (Number(assignment?.count || 0)) return deps.error("event_category_in_use", "Remove this category from its events before deleting it", 409);
    await db.prepare("DELETE FROM dbi_workspace_event_categories WHERE workspace_id = ? AND category_id = ?").bind(principal.workspaceId, categoryId).run();
    await deps.recordActivity(db, principal, "event_category_deleted", "event_category", categoryId, { name: existing.name });
    return new Response(null, { status: 204 });
  }
  return deps.error("method_not_allowed", "Method not allowed", 405);
}

export async function eventDiscoveryResponse(request, db, deps) {
  if (!deps.sameOriginRequest(request)) return deps.json({ error: "Cross-origin discovery management is not allowed" }, 403);
  const session = await deps.sessionUser(db, request);
  if (!session) return deps.json({ error: "Sign in required" }, 401);
  if (!deps.canAdministerUsers(session)) return deps.json({ error: "Super user access is required" }, 403);
  const pathname = new URL(request.url).pathname.replace(/\/+$/, "");
  const candidateId = deps.cleanText(decodeURIComponent(pathname.slice("/api/v1/auth/event-discovery".length).replace(/^\//, "")), 100);
  if (request.method === "GET" && !candidateId) {
    const params = new URL(request.url).searchParams;
    return deps.json(await eventDiscoverySnapshot(db, { status: params.get("status"), limit: params.get("limit") }));
  }
  if (request.method === "POST" && !candidateId) {
    const body = await deps.safeJson(request);
    if (body?.action !== "run") return deps.json({ error: "Use action run to start official-source discovery" }, 400);
    const result = await runEventDiscoverySweep(db, { catalog: eventCatalog(), maxSources: Math.max(1, Math.min(5, Number(body?.maxSources) || 2)) });
    await deps.recordActivity(db, { type: "user", id: session.user_id, workspaceId: session.active_workspace_id || deps.defaultWorkspaceId }, "event_discovery_run", "event_discovery", "", result);
    return deps.json({ result, ...(await eventDiscoverySnapshot(db)) }, 202);
  }
  if (request.method === "PATCH" && candidateId) {
    const body = await deps.safeJson(request);
    const decision = body?.decision === "publish" ? "publish" : body?.decision === "reject" ? "reject" : "";
    if (!decision) return deps.json({ error: "Decision must be publish or reject" }, 400);
    const result = await reviewEventCandidate(db, candidateId, { decision, reviewerId: session.user_id, reason: deps.cleanText(body?.reason, 500) });
    if (result.error === "not_found") return deps.json({ error: "Discovery candidate not found" }, 404);
    if (result.error === "already_reviewed") return deps.json({ error: "Discovery candidate was already reviewed", candidate: result.candidate }, 409);
    if (result.error === "insufficient_evidence") return deps.json({ error: "A title, dated edition, and official source are required before publication" }, 422);
    if (result.error) return deps.json({ error: "Invalid discovery review request" }, 400);
    await deps.recordActivity(db, { type: "user", id: session.user_id, workspaceId: session.active_workspace_id || deps.defaultWorkspaceId }, `event_discovery_${decision}ed`, "event_discovery_candidate", candidateId, { catalogEventId: result.event?.id || "" });
    return deps.json(result);
  }
  return deps.json({ error: "Method not allowed" }, 405);
}

export async function eventDiscoverySchedulerResponse(request, db, env, deps) {
  if (request.method !== "POST") return deps.json({ error: "Method not allowed" }, 405);
  const expected = String(env.DBI_SCHEDULER_TOKEN || "");
  const supplied = String(request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (expected.length < 32 || supplied.length !== expected.length || await deps.hashValue(expected) !== await deps.hashValue(supplied)) return deps.json({ error: "Unauthorized" }, 401);
  return deps.json(await runEventDiscoverySweep(db, { catalog: eventCatalog(), maxSources: 2 }));
}

export async function eventCatalogResponse(request, db, principal, segments, deps) {
  if (request.method !== "GET") return deps.error("method_not_allowed", "Method not allowed", 405);
  if (!deps.hasScope(principal, "events:read")) return deps.error("insufficient_scope", "Scope events:read is required", 403);
  const catalog = await completeEventCatalog(db);
  const eventId = deps.cleanText(segments[0], 120);
  if (eventId) {
    const event = catalogEventByIdFromRows(catalog, eventId);
    return event ? deps.json(event) : deps.error("catalog_event_not_found", "Catalog event not found", 404);
  }
  const params = new URL(request.url).searchParams;
  const rows = searchEventCatalogRows(catalog, { query: params.get("q"), branch: params.get("branch"), eventType: params.get("type"), format: params.get("format"), confidence: params.get("confidence"), datedOnly: params.get("datedOnly"), includePast: params.get("includePast") });
  return deps.json(rows, 200, { total: rows.length, catalogTotal: catalog.length, branches: [...new Set(catalog.map((event) => event.branch))].sort(), eventTypes: [...new Set(catalog.map((event) => event.eventType))].sort(), formats: [...new Set(catalog.map((event) => event.format))].sort(), trustBoundary: "Curated catalog facts are source-backed. Workspace calendar fields remain operator-owned." });
}
