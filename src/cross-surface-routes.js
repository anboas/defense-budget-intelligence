function route(path, values = {}) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value == null || value === "") continue;
    params.set(key, String(value));
  }
  const search = params.toString();
  return `#/budget-spend/${path}${search ? `?${search}` : ""}`;
}

export function opportunityRoute(recordId, query = "") {
  return route("explorer", { spendView: "record", capQuery: query, capRecord: recordId });
}

export function timelineRoute(recordId, values = {}) {
  return route("timeline", {
    timelineScope: values.scope || "all",
    capRecord: recordId,
    capVehicle: values.vehicle,
    capResearch: values.research,
    capResearchDate: values.researchDate,
    capFrom: values.from,
    capTo: values.to,
  });
}

export function intelligenceGraphRoute(recordId, nodeId = "") {
  return route("intelligence-graph", { graphRecord: recordId, graphNode: nodeId });
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
