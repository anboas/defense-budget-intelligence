export function agentOpenApiDocument(origin, sessionCookie) {
  const security = [{ bearerAuth: [] }, { cookieAuth: [] }];
  const paths = {
    "/api/v1/agent/capabilities": { get: { summary: "Discover API capabilities", security } },
    "/api/v1/agent/records": { get: { summary: "Query factual and manual records", security }, post: { summary: "Create a manual record", security } },
    "/api/v1/agent/records/{recordId}": { get: { summary: "Read one record", security }, patch: { summary: "Update a manual record", security }, delete: { summary: "Delete a manual record", security } },
    "/api/v1/agent/tracking": { get: { summary: "List tracked records", security } },
    "/api/v1/agent/tracking/{recordId}": { put: { summary: "Track or update a record", security }, delete: { summary: "Stop tracking a record", security } },
    "/api/v1/agent/record-dispositions": { get: { summary: "List workspace record tombstones", security } },
    "/api/v1/agent/record-dispositions/{recordId}": { put: { summary: "Tombstone a record for this workspace", security }, delete: { summary: "Restore a tombstoned record", security } },
    "/api/v1/agent/events": { get: { summary: "List operator events", security }, post: { summary: "Create an operator event", security } },
    "/api/v1/agent/events/{eventId}": { get: { summary: "Read an event", security }, patch: { summary: "Update an event", security }, delete: { summary: "Delete an event", security } },
    "/api/v1/agent/event-categories": { get: { summary: "List workspace event categories", security }, post: { summary: "Create a workspace event category", security } },
    "/api/v1/agent/event-categories/{categoryId}": { patch: { summary: "Update a workspace event category", security }, delete: { summary: "Delete an unused workspace event category", security } },
    "/api/v1/agent/activity": { get: { summary: "Read append-only audit activity", security }, post: { summary: "Append an agent activity note", security } },
    "/api/v1/agent/api-requests": { get: { summary: "Read redacted API request diagnostics and usage metadata", security } },
    "/api/v1/agent/integrations": { get: { summary: "Read integration status", security } },
    "/api/v1/agent/analytics": { get: { summary: "Aggregate the factual record universe by a bounded dimension and measure", security } },
  };
  return {
    openapi: "3.1.0",
    info: { title: "Defense Budget Intelligence Agent API", version: "1.0.0", description: "Authenticated factual evidence and workspace-management API." },
    servers: [{ url: origin }],
    paths,
    components: { securitySchemes: {
      bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "DBI agent token" },
      cookieAuth: { type: "apiKey", in: "cookie", name: sessionCookie },
    } },
  };
}
