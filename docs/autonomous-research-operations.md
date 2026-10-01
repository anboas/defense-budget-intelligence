# Autonomous research operations

Defense Budget Intelligence runs organization-gap discovery inside the authenticated Cloudflare application. This replaces the external two-hour scout as the primary runtime and keeps configuration, run history, evidence decisions, and publication state in the workspace D1 boundary.

## Runtime

- The shared Cloudflare scheduler wakes every 15 minutes and calls the protected `/api/v1/system/research-schedule` endpoint.
- Each workspace decides whether a run is due from its own saved cadence.
- Workspaces without an active workspace OpenAI key are excluded before a run is queued.
- One active run is allowed per workspace. A second manual or scheduled trigger returns the active run instead of duplicating work.
- The cron request remains attached until its selected targets complete, giving high-throughput runs the scheduled Worker execution window instead of a short background tail.
- Runs and target attempts are durable. The ADMIN dashboard polls the same D1 ledger used by the scheduler.
- The default model is `gpt-5-nano` with low reasoning. The model supports Responses API structured output and web search; workspace managers may select a stronger nano or mini model when needed.

## Configurable controls

Workspace managers can change these controls in **ADMIN → Intelligence Operations → Discovery ops**:

| Control | Boundary |
| --- | --- |
| Enabled | Pause or resume scheduled cycles |
| Cadence | 15 minutes to 24 hours |
| Targets per run | 1–20 research gaps |
| Concurrency | 1–5 simultaneous targets |
| Sources per target | 1–8 official sources retained |
| Claims per target | 1–6 structured claims |
| Revisit delay | 12–720 hours |
| Model | GPT-5 nano, GPT-5.4 nano, or GPT-5.4 mini |
| Reasoning | Low or medium |
| Publication | Auto-publish exact evidence or hold all findings |

The scheduler evaluates due state at 15-minute resolution. Increasing targets or concurrency raises throughput; increasing cadence or revisit delay reduces API spend.

## Evidence and publication

1. Select open organization research gaps by priority and revisit eligibility.
2. Call the OpenAI Responses API with web search, strict JSON Schema output, bounded searches, and `store: false`.
3. Accept citations only when the provider reports the consulted URL and the URL is official HTTPS `.gov` or `.mil` evidence.
4. Publish only additive claims marked exact with exact/high confidence.
5. Materialize exact leadership findings as typed person and official-role entities plus sourced dossier and organization relationships.
6. Store each source, proposal, workspace-overlay claim, graph mutation, target result, token count, model, and decision in D1.
7. Hold ambiguous output. Suppress a duplicate when the same dossier, field path, and normalized value already has a published fingerprint.

Published claims, people, roles, and their typed relations become immediately queryable workspace overlays through Agent API 1.1. The immutable public graph snapshot remains separate and can be regenerated in a later repository release.

## Dashboard

The dashboard exposes:

- active-run stage and target completion;
- run success rate and duration;
- organizations and registered gaps explored;
- official sources consulted;
- claims discovered, published, held, conflicting, or deduplicated;
- exact graph records created, split into claims, entities, and relations;
- gap, organization, and publication-yield progress bars;
- per-run publication trend and evidence funnel;
- recent run ledger and recent claim ledger;
- cumulative input and output token counts through the API response.

The component is deferred from the initial shell and map. GitHub Pages shows a primary-host boundary instead of inventing server state.

## Credentials and security

- The runtime uses the encrypted workspace-default OpenAI key. Plaintext keys never reach the browser, logs, or D1 rows.
- Scheduler calls require the existing constant-time verified scheduler bearer token.
- Only a Super user or active-workspace Manager may read or configure the dashboard.
- All mutations require same-origin browser requests.
- API request records are redacted and retained under the existing 90-day request-log boundary.
- A failed target cannot partially publish a malformed claim; exact evidence publication uses a D1 batch.

Official OpenAI references used for the runtime defaults:

- [GPT-5 nano](https://developers.openai.com/api/docs/models/gpt-5-nano)
- [Reasoning models](https://developers.openai.com/api/docs/guides/reasoning)
