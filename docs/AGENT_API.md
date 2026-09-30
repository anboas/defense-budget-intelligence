# Agent API

The Cloudflare Pages deployment exposes Agent API contract `1.1.0` at `/api/v1/agent`. It is designed for trusted automation clients and signed-in workspace users with role-derived scopes. The API combines the immutable published intelligence graph with cited, reviewable workspace overlays.

## Authentication

- The Super user and Administrators create and revoke agent credentials from **Admin → Agent Access**.
- A credential is displayed once. Save it directly to the agent's protected Secret Store. Never place it in chat, source files, command arguments, URLs, or logs.
- Automation clients send the protected credential as an HTTP Bearer authorization header.
- The server stores only a SHA-256 token hash and records last use.
- Credentials may be revoked immediately and may carry an optional expiry.
- Signed-in first-party browser sessions may call the same API through the secure session cookie.
- Super users and Administrators receive the full human workspace scope set. Analysts may read the graph and evidence, submit enrichment proposals, and read review queues, but cannot approve or publish. Viewers receive read scopes only. A temporary-password session receives no workspace scopes until the user replaces that password.

The machine-readable contract is available at `GET /api/v1/agent/openapi.json` after authentication. Capability discovery is available at `GET /api/v1/agent/capabilities`.

## Scopes

- `records:read`, `records:write`
- `tracking:read`, `tracking:write`
- `events:read`, `events:write`
- `activity:read`, `activity:write`
- `integrations:read`
- `graph:read`
- `evidence:read`
- `enrichment:propose`
- `review:read`, `review:write`
- `graph:admin`

Create the narrowest credential that satisfies the agent's job. A research agent normally needs `graph:read`, `evidence:read`, `enrichment:propose`, and `review:read`. Keep `review:write` and `graph:admin` on separate reviewer and publisher credentials so one autonomous process cannot both propose and promote its own evidence.

## Resources

### Records

- `GET /api/v1/agent/records`
- `GET /api/v1/agent/records/{recordId}`
- `POST /api/v1/agent/records`
- `PATCH /api/v1/agent/records/{recordId}`
- `DELETE /api/v1/agent/records/{recordId}`

The list route supports bounded pagination plus query, work-category, source-system, lifecycle, tracked-only, sort, and direction controls. Source-backed evidence is immutable. Create, update, and soft-delete apply only to manual records whose IDs begin with `manual_agent_`.

### Tracking

- `GET /api/v1/agent/tracking`
- `GET /api/v1/agent/tracking/{recordId}`
- `PUT /api/v1/agent/tracking/{recordId}`
- `DELETE /api/v1/agent/tracking/{recordId}`

Tracking stores a stable record ID, private workspace note, review date, wallboard visibility, timestamps, and a version.

### Analytics

- `GET /api/v1/agent/analytics`

The analytical query resource returns bounded aggregates over the same factual/manual record universe. It supports the record filters plus dimensions for portfolio, recipient/sponsor, owner, funding office, contracting office, work category, source system, lifecycle, and evidence tier. Measures include record count, observed obligations, and reported potential amount. Every response includes slice totals, source date, and the allowed dimension/measure inventory.

### Events

- `GET /api/v1/agent/events`
- `GET /api/v1/agent/events/{eventId}`
- `POST /api/v1/agent/events`
- `PATCH /api/v1/agent/events/{eventId}`
- `DELETE /api/v1/agent/events/{eventId}`

Events support status, start/end time, location or link, notes, associated record IDs, active workspace-user attendees, wallboard visibility, timestamps, and a version. Human event payloads may also include `teamIds`; an empty array keeps the event workspace-wide, while one or more active team IDs restrict visibility to members of any assigned team. The optional `milestones` array accepts up to 24 typed, date-backed overlays using `registration_deadline`, `refund_deadline`, `hotel_deadline`, `exhibitor_deadline`, `submission_deadline`, or `other`. Each item has a unique `id`, `occursAt`, optional `label` and `notes`; `other` requires a label. Undated milestones are rejected rather than inferred.

Scoped agent credentials retain workspace-level event visibility because they represent trusted workspace automation rather than a human team identity. Signed-in human requests use the effective user's team union, including during Super user emulation.

### Activity and integrations

- `GET /api/v1/agent/activity`
- `POST /api/v1/agent/activity`
- `GET /api/v1/agent/integrations`

Every server-side mutation writes an append-only actor/action/entity audit row. Agents with `activity:write` may also add explicit operational notes. Integration status summarizes the factual record index and current public ingestion layers.

### Intelligence graph

- `GET /api/v1/agent/graph/summary`
- `GET /api/v1/agent/entities?type={entityType}`
- `GET /api/v1/agent/entities/{entityId}`
- `GET /api/v1/agent/entities/{entityId}/relations`
- `GET /api/v1/agent/activities/{activityId}/connected`
- `GET /api/v1/agent/locations/{locationId}/metadata`

Graph reads expose all published entity and relationship types plus approved workspace overlays. List routes are type-scoped and bounded. Entity reads preserve the immutable published entity, applied claims, and the effective workspace view separately. Connected activity reads include contract lineage, temporal evidence, and approved overlay relations.

### Evidence and sources

- `GET /api/v1/agent/evidence/claims`
- `GET /api/v1/agent/sources`
- `GET /api/v1/agent/sources/{sourceId}`

Evidence queries preserve public URL, title, publisher, authority, retrieval time, supported assertion, confidence, temporal validity, proposal provenance, and review state. Private, loopback, link-local, and credential-bearing source URLs are rejected.

### Enrichment proposals and reviews

- `GET /api/v1/agent/enrichment/proposals`
- `GET /api/v1/agent/enrichment/proposals/{proposalId}`
- `POST /api/v1/agent/enrichment/proposals`
- `GET /api/v1/agent/reviews?queue=workspace|temporal|identity|lineage`
- `GET /api/v1/agent/reviews/{proposalId}`
- `PATCH /api/v1/agent/reviews/{proposalId}`

Agents update intelligence by submitting strict proposals. A proposal targets one published or workspace entity, contains up to 20 claims, and cites one to five public sources for every claim. Supported operations are `fill_missing`, `replace`, `append`, `supersede`, and `add_relation`. New entities use `workspace:{entityType}:{stable-id}` identifiers. Relation types and both endpoints must already exist in the domain model or be the new target entity.

Every claim declares confidence, rationale, observation time, optional effective dates, and evidence sources. Unsupported fields, protected credential-like field paths, oversized values, unknown entity or relation types, dangling endpoints, uncited claims, and private URLs fail closed. Fuzzy similarity never promotes a fact or resolves an identity conflict.

Review decisions require `review:write` and the current proposal version through `If-Match`. Reviewers may approve or reject. Approval does not publish by itself.

### Validation, publication, and indexing jobs

- `GET /api/v1/agent/jobs`
- `GET /api/v1/agent/jobs/{jobId}`
- `POST /api/v1/agent/jobs`

`graph:admin` may run `validate_proposal`, `publish_proposal`, and `reindex_workspace`. Publication requires an approved proposal plus its current version. D1 applies sources, entities, claims, relations, supersession state, proposal state, job result, and append-only audit metadata as one batch. Applied workspace facts become immediately queryable through the Agent API. Published static snapshots remain unchanged until an explicit repository ingestion and release promotes them.

## Write safety

- All create routes require `Idempotency-Key`.
- Mutable records expose integer versions. Updates require the current version through `If-Match` for optimistic concurrency control; missing preconditions return HTTP 428.
- Stale versions return HTTP 409 with the current version.
- Responses use the `dbi-agent-v1` envelope and structured error codes with request IDs.
- Agent calls are limited to 300 requests per credential per minute.
- Request bodies, text fields, arrays, active credentials, and list results are bounded.
- Public source snapshots remain factual and immutable. Agents write workspace-management state, manual records, and cited intelligence overlays through the proposal/review/publication workflow.
- Proposal submission, review, and publication use distinct scopes. The recommended autonomous topology uses separate proposer, reviewer, and publisher credentials.
- Every accepted mutation is workspace-scoped, idempotent, versioned, and audit logged.

## Persistence and fallback

Cloudflare Pages Functions store agent keys, tracking, events, manual records, intelligence proposals, sources, approved overlay entities, claims, relations, jobs, idempotency results, rate counters, and activity in namespace-isolated `dbi_*` D1 tables. The signed-in application and Agent API use the same workspace state, so approved human and agent changes converge immediately.

The GitHub Pages fallback has no authenticated backend. It remains read-only for the Agent API and keeps Operations state browser-local.

## Verification

`npm run verify:agent-api` creates a fresh local D1 database and proves authentication, discovery, scoped credentials, graph traversal, evidence/source reads, strict proposal rejection, proposal idempotency, reviewer separation, optimistic conflicts, atomic publication, immediate overlay queries, manual-record CRUD, immutable source facts, shared tracking and events, runtime-restart persistence, and revocation.
