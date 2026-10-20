function route(path, values = {}) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value == null || value === "") continue;
    params.set(key, String(value));
  }
  const search = params.toString();
  return `#/budget-spend/${path}${search ? `?${search}` : ""}`;
}

export function opportunityRoute(recordId, options = "") {
  const values = typeof options === "string" ? { query: options } : options || {};
  return intelligenceWorkspaceRoute({ entityType: "activity", entityId: recordId, ...values });
}

export function intelligenceWorkspaceRoute({ entityType = "activity", entityId = "", tab = "overview", query = "", returnTo = "", origin = "" } = {}) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries({
    entityType,
    entityId,
    workspaceTab: tab,
    workspaceQuery: query,
    returnTo: String(returnTo || "").replace(/^#/, ""),
    origin,
  })) if (value != null && value !== "") params.set(key, String(value));
  return `#/intelligence/workspace?${params}`;
}

export function timelineRoute(recordId, values = {}) {
  return route("timeline", {
    timelineScope: values.scope || "all",
    capRecord: recordId,
    timelineEntityType: values.entityType,
    timelineEntityId: values.entityId,
    timelineEntityLabel: values.entityLabel,
    capVehicle: values.vehicle,
    capResearch: values.research,
    capResearchDate: values.researchDate,
    capFrom: values.from,
    capTo: values.to,
  });
}

export function intelligenceGraphRoute(recordOrEntity, nodeId = "") {
  if (recordOrEntity && typeof recordOrEntity === "object") {
    return route("intelligence-graph", {
      graphType: recordOrEntity.entityType,
      graphEntity: recordOrEntity.entityId,
      graphLabel: recordOrEntity.entityLabel,
      graphNode: recordOrEntity.nodeId || nodeId,
      graphTargetType: recordOrEntity.targetType,
      graphTarget: recordOrEntity.targetId,
      graphTargetLabel: recordOrEntity.targetLabel,
    });
  }
  return route("intelligence-graph", { graphRecord: recordOrEntity, graphNode: nodeId });
}

export function dataLibraryRoute({ organizationId = "", query = "", recordId = "", view = "relationships" } = {}) {
  return route("library", { libraryView: view, libraryOrg: organizationId, libraryQuery: query, capRecord: recordId });
}

export function mapLocationRoute(locationId, label = "") {
  const id = String(locationId || "").replace(/^location:/, "");
  return route("map", { mapOrg: id ? `location:${id}` : "", mapQuery: label });
}

export function awardsRoute(awardId, label = "") {
  return route("awards", { query: awardId || label, awardId: awardId || "" });
}

export function accountFlowRoute(accountCode) {
  return route("lifecycle", { selected: accountCode });
}

export function sourceLineageRoute(recordId) {
  return route("sources", { capRecord: recordId });
}

export function classificationRoute(label) {
  return route("explorer", { spendView: "table", capQuery: label });
}

export { route as crossSurfaceRoute };
