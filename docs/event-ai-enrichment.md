# Event AI enrichment contract

## Purpose

Event create/edit supports a durable, two-stage AI workflow that researches public event facts, independently verifies them, and produces a deterministic merge into the operator's current draft.

AI does not directly save an event. The verified result is merged into the open editor, where the operator reviews and saves through the normal event API.

## Workflow

1. **Public research**
   - Input: public event fields, workspace category names, and an optional operator direction.
   - Excluded from provider input: attendee IDs/profiles, linked workspace record IDs, internal status, wallboard settings, credentials, and authorization data.
   - Runtime: background Responses API call using the operator-selected research model, web search, and a strict JSON Schema.
2. **Independent verification**
   - Input: the public draft, producer proposal, producer's retained claim/source bundle, allowed category names, and operator direction.
   - Runtime: a separate background Responses API call using the operator-selected verification model, optional bounded web search, and a separate strict JSON Schema.
   - Checks: event identity, dates, venue, links, milestones, categories, evidence, and merge safety.
3. **Deterministic merge**
   - Provider annotations and consulted-source inventories are provenance transport, not an all-or-nothing truth gate.
   - Claims are evaluated independently. Medium/high-confidence claims are eligible when their source appears in the current provider evidence or the producer's pinned grounded evidence.
   - Plausible unmatched claims and sources remain visible as review material but are not auto-merged.
   - Links, milestones, and categories use item-level allowlists so one grounded collection claim cannot admit an unrelated sibling item.
   - Missing scalar fields may be filled.
   - Links, milestones, and category assignments are appended and deduplicated.
   - Operator-entered values are preserved and conflicts are disclosed.
   - Attendees, linked records, status, and wallboard settings are never modified.
4. **Operator review and save**
   - Verified additions enter the editor draft.
   - The operator reviews normal event fields and saves through the existing event lifecycle.

## Durable state

Cloudflare D1 uses `dbi_event_ai_jobs`; PostgreSQL uses `app_event_ai_jobs`. Both persist:

- workspace and initiating user;
- job status and current step;
- credential reference and scope, never the secret;
- producer/verifier model and provider response IDs;
- bounded operator direction and sanitized input snapshot;
- normalized proposal, verification, and merge result;
- safe error metadata, trace ID, retry count, and timestamps.

Terminal jobs are retained for 90 days. A user can run at most three concurrent jobs and twenty jobs per rolling 24-hour window in a workspace.

## Statuses

- `researching`: producer background response is queued or in progress.
- `verifying`: independent verifier is queued or in progress.
- `completed`: verified merge contains the event name and start date and is ready for operator review/save.
- `needs_review`: verification found a material conflict, retained plausible claims with incomplete grounding, rejected part or all of a wrong-entity proposal, or could not verify the minimum saveable fields.
- `failed`: credential, provider, malformed schema, or application validation failed safely.
- `cancelled`: reserved terminal state for provider or future operator cancellation.

Polling `GET /api/v1/auth/event-ai/:jobId` advances a non-terminal job. Provider background work survives an individual HTTP request; the next poll resumes the persisted workflow.

Provider responses remain stored only while their background stage is pending or waiting to be resumed. After DBI accepts and normalizes a completed producer or verifier stage, it deletes that raw provider response. DBI retains the normalized schema-bound result and audit metadata, not the raw Responses payload.

Because the consulted-source inventory is an opt-in Responses API field, DBI requests `web_search_call.action.sources` both when creating a background response and on every later retrieval. When that transport is incomplete, DBI retains affected claims for review instead of failing the whole stage. Grounded producer URLs are pinned into verification so the verifier evaluates the supplied evidence before making an optional fallback search.

## Credentials and permissions

- Workspace manager, analyst, and Super user roles may run event AI because those roles have event write access.
- Personal credentials are usable only by their owner.
- Workspace actions use the active workspace's default credential without exposing its secret or identifier to unauthorized users.
- Secrets are decrypted only on the server for the provider request.

## Model inventory and defaults

- `GET /api/v1/auth/event-ai/models` resolves the selected personal or workspace credential on the server and reads its live OpenAI `GET /v1/models` inventory.
- Only safe model metadata is returned to the browser. The credential is never returned or placed in a URL.
- Research and verification models are selected independently and persisted on the durable job.
- A requested model must appear in the selected credential/project inventory before DBI creates a job or submits a Responses request. Unavailable models fail with `409 model_not_available`.
- Workspace managers may persist separate research and verification defaults for the active workspace. Personal-key selections remain run-specific.
- The Models API proves credential/project availability, not tool or schema compatibility. DBI discloses that distinction and retains any execution failure in the redacted API ledger.
- Model inventory requests are logged with status, latency, safe provider request ID, credential reference, and counts only. The returned inventory and credential secret are not written to the log.

## Audit and redaction

Research and verification are separate `dbi_api_request_log` / `app_api_request_log` entries. Logs include model, stage, status, latency, token counts, provider/trace/response IDs, retry metadata, and safe errors.

When OpenAI returns a terminal failed response, DBI preserves the provider's bounded error code and safe message in both the durable job and its stage log. The corresponding provider response ID, request ID, and retryability classification remain available for diagnosis instead of being collapsed into a generic `provider_failed` result.

Logs never retain keys, authorization headers, cookies, prompts, input snapshots, request/response bodies, or raw model output.

## Verification

- `npm run verify:event-ai`: strict schemas, claim-level evidence binding, pinned-source verification, the NSWCDD SAM.gov regression, malformed-output rejection, provider-error extraction, model filtering/selection, entitlement rejection, and non-destructive merge.
- `npm run verify:pages-auth`: D1 persistence, two-stage transition, editor merge, credential ownership, provider-failure diagnostics, audit entries, and redaction.
- `npm run verify:postgres-auth:local`: disposable PostgreSQL parity, including provider-failure diagnostics.
- `npm run verify`: public UI, responsive presentation, Control Surface conformance, and build contract.
