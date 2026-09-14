# Agent API

The Cloudflare Pages deployment exposes a versioned, same-origin control plane at `/api/v1/agent`. It is designed for trusted automation clients and signed-in workspace users with role-derived scopes.

## Authentication

- The Super user and Administrators create and revoke agent credentials from **Admin → Agent Access**.
- A credential is displayed once. Save it directly to the agent's protected Secret Store. Never place it in chat, source files, command arguments, URLs, or logs.
- Automation clients send the protected credential as an HTTP Bearer authorization header.
- The server stores only a SHA-256 token hash and records last use.
- Credentials may be revoked immediately and may carry an optional expiry.
- Signed-in first-party browser sessions may call the same API through the secure session cookie.
- Super users, Administrators, and Analysts receive the full human workspace scope set. Viewers receive read scopes only. A temporary-password session receives no workspace scopes until the user replaces that password.

The machine-readable contract is available at `GET /api/v1/agent/openapi.json` after authentication. Capability discovery is available at `GET /api/v1/agent/capabilities`.

## Scopes

- `records:read`, `records:write`
- `tracking:read`, `tracking:write`
- `events:read`, `events:write`
- `activity:read`, `activity:write`
- `integrations:read`

Create the narrowest credential that satisfies the agent's job. Record reads, tracking, events, activity, and integrations can be granted independently.

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

Events support status, start/end time, location or link, notes, associated record IDs, active workspace-user attendees, wallboard visibility, timestamps, and a version. The optional `milestones` array accepts up to 24 typed, date-backed overlays using `registration_deadline`, `refund_deadline`, `hotel_deadline`, `exhibitor_deadline`, `submission_deadline`, or `other`. Each item has a unique `id`, `occursAt`, optional `label` and `notes`; `other` requires a label. Undated milestones are rejected rather than inferred.

### Activity and integrations

- `GET /api/v1/agent/activity`
- `POST /api/v1/agent/activity`
- `GET /api/v1/agent/integrations`

Every server-side mutation writes an append-only actor/action/entity audit row. Agents with `activity:write` may also add explicit operational notes. Integration status summarizes the factual record index and current public ingestion layers.

## Write safety

- All create routes require `Idempotency-Key`.
- Mutable records expose integer versions. Updates require the current version through `If-Match` for optimistic concurrency control; missing preconditions return HTTP 428.
- Stale versions return HTTP 409 with the current version.
- Responses use the `dbi-agent-v1` envelope and structured error codes with request IDs.
- Agent calls are limited to 300 requests per credential per minute.
- Request bodies, text fields, arrays, active credentials, and list results are bounded.
- Public source snapshots remain factual and immutable; agents write only workspace-management state and manual records.

## Persistence and fallback

Cloudflare Pages Functions store agent keys, tracking, events, manual records, idempotency results, rate counters, and activity in namespace-isolated `dbi_*` D1 tables. The signed-in Operations UI uses the same tables, so human and agent changes converge immediately.

The GitHub Pages fallback has no authenticated backend. It remains read-only for the Agent API and keeps Operations state browser-local.

## Verification

`npm run verify:agent-api` creates a fresh local D1 database and proves authentication, discovery, scoped credentials, evidence reads, manual-record CRUD, immutable source facts, shared tracking and events, activity, integrations, idempotent replay, version conflicts, runtime-restart persistence, and revocation.
