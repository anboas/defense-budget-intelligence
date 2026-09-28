# Defense Intelligence SaaS product design

**Status:** Proposed target state

**Date:** 2026-09-28

**Scope:** Convergence of Sabre Research Intelligence, Defense Budget Intelligence, and Opportunity Intelligence into one commercial Defense Intelligence SaaS

## Executive decision

Build the final product on the **Defense Budget Intelligence platform foundation**, but recast the user experience around a closed intelligence-to-capture loop:

```text
Discover signals → qualify opportunities → research accounts and relationships
→ execute capture → produce responses → learn from outcomes
```

Defense Budget Intelligence already has the strongest SaaS shell, tenant model, account administration, security controls, immutable evidence plane, source operations, agent credentials, task execution, and deployment parity. Sabre has the best opportunity queue, connected entity research, source-first inspector, wallboard, and report model. Opportunity Intelligence has the deepest capture lifecycle, response workbench, automation review, and proposal readiness model.

The final system should not place three applications behind one navigation bar. It should expose one domain model, one opportunity lifecycle, one evidence contract, and one task/audit system.

## Evidence reviewed

### Sabre Research Intelligence

- `README.md`
- `docs/research-intelligence-architecture.md`
- `docs/opportunity-intelligence-briefs.md`
- `site/src/main.jsx`, especially the Unified Pursuit Workspace
- `site/src/components/IntelligenceLayer.jsx`
- Current local browser verification at desktop and mobile sizes

### Defense Budget Intelligence

- `README.md`
- `docs/architecture-security.md`
- `docs/cybersecurity-governance.md`
- `docs/saas-control-plane.md`
- `docs/opportunity-intelligence-convergence.md`
- Current transaction, operations, wallboard, account, and administration screenshots

### Opportunity Intelligence

- `README.md`
- `docs/agent-first-backend.md`
- `docs/opportunity-detail-migration.md`
- `scripts/verify-routes.mjs`
- Current opportunity home, detail, timeline, analytics, capture, autonomy, and administration screenshots

## Product assessment

| Product | Keep | Rework or retire |
| --- | --- | --- |
| **Sabre Research Intelligence** | Scan-first pursuit table; saved table preferences; expandable evidence rows; qualification state; reviewed discovery/update flow; shared entity inspector; adjacency graph; organizations, contacts, events, studies, sources, reports, Ask Sabre; wallboard profiles | Icon-only row action overload; thin lifecycle and ownership model; opportunity detail split across table, inspector, and research study; priority labels without explicit rationale; separate access model |
| **Defense Budget Intelligence** | Multi-tenant SaaS control plane; organizations/workspaces/teams; Super/Admin/Analyst/Viewer access; immutable evidence plane; source lineage; budgets, awards, and transactions; encrypted credential vault; agents; tasks; API log; event discovery; wallboard; Cloudflare/D1 and container/Postgres parity | Budget-centric navigation; watchlist as a substitute for real pursuits; separation between money evidence and opportunity/capture objects; weak account/contact graph; no response lifecycle |
| **Opportunity Intelligence** | Opportunity ingestion and normalization; guided lifecycle; owner and next-action discipline; review queue; timeline; capture playbooks; response evidence, compliance, drafting, review, and export; governed agent proposal/approval/commit pattern | Too many top-level surfaces; dense first viewport; overlapping queues and admin pages; opaque composite scores; browser-local state still mixed with hosted scaffolding; product-matrix and proof-loop surfaces exposed as product UI |

## Product principles

1. **One opportunity record.** Discovery, research, money lineage, capture, response, and outcome attach to the same stable opportunity ID.
2. **Evidence and judgment remain distinct.** Official facts are immutable and source-linked. Analyst fields, qualification, posture, notes, and agent proposals live in the management plane.
3. **Scan first, drill down second.** The queue answers what needs attention. The detail route handles the full workflow.
4. **No opaque master score.** Show due-date urgency, evidence strength, capability fit, relationship strength, and analyst priority separately. A human can set priority with a recorded rationale.
5. **Every active pursuit has an owner and next action.** Missing ownership or a stale next action is an operational defect.
6. **Agents propose before they mutate.** High-impact agent work enters a review inbox with evidence, diff, confidence, and target version.
7. **Source systems remain authoritative.** The SaaS stores normalized snapshots and overlays, not silently rewritten source evidence.
8. **One task and audit system.** Source refresh, enrichment, capture tasks, proposal work, exports, and failures share the Task Center and API Log.
9. **One tenant model.** Organization, workspace, team, person, and agent access come from the Defense Intelligence control plane.
10. **Public-source commercial posture first.** Do not imply CUI, ITAR, FedRAMP, or classified-data authorization before the controls and operating environment exist.

## Primary users

| User | Primary question | Required surface |
| --- | --- | --- |
| BD leader | Where should we spend capture effort this week? | Command Center and Wallboard |
| Capture manager | What is the next gate, blocker, owner, and due date? | Opportunity Queue and Capture workspace |
| Solutions architect | What does the customer need and what evidence supports our response? | Evidence, architecture, compliance, and response workspace |
| Analyst | What changed across notices, budgets, awards, incumbents, organizations, and contacts? | Discovery, Account Intelligence, and Research |
| Executive | What is the pipeline posture, risk, and decision calendar? | Executive Wallboard and decision briefs |
| Platform or workspace administrator | Is the tenant secure, healthy, licensed, and supportable? | Workspace and Platform Administration |
| Agent | What bounded context may I read and what changes may I propose? | Agent API, jobs, review queue, and audit ledger |

## Target information architecture

Keep the global navigation small. Domain depth belongs inside routes, not in the masthead.

| Global area | Purpose | Key child views |
| --- | --- | --- |
| **Command** | Daily operational brief | My work, decisions due, changes, event horizon, source health |
| **Opportunities** | Unified pipeline and capture work | Queue, detail, timeline, playbooks, response workspace |
| **Accounts** | Customer and ecosystem intelligence | Organizations, contacts, incumbents, partners, contracts, relationship graph |
| **Research** | Source-backed analysis | Studies, evidence, diagrams, reports, Ask Defense Intelligence |
| **Operations** | Shared execution and visibility | Events, calendar, wallboard, Task Center, review inbox |
| **Money & Sources** | Factual defense market evidence | Budget request, account flow, awards, transactions, source lineage |
| **Admin** | Tenant, integrations, security, and platform operations | Workspace, teams, users, agents, credentials, usage, API log, platform control plane |

Mobile navigation should expose Command, Opportunities, Operations, Search, and Menu. The Menu owns the remaining areas.

## Core domain model

```text
Organization (tenant)
└── Workspace
    ├── Members, teams, roles, agents, credentials
    ├── Opportunity
    │   ├── Official notices and amendments
    │   ├── Customer organization and contacts
    │   ├── Budget, account, award, incumbent, contract evidence
    │   ├── Qualification, priority, posture, owner, next action
    │   ├── Lifecycle phase and decision gates
    │   ├── Research studies, findings, diagrams, sources
    │   ├── Capture plan, tasks, events, partners
    │   ├── Requirements, compliance rows, drafts, reviews
    │   └── Outcome and lessons
    ├── Account graph
    ├── Event calendar
    ├── Source and connector operations
    └── Audit, jobs, usage, exports
```

### Data ownership

| Plane | Owns | Mutation rule |
| --- | --- | --- |
| **Evidence** | Published source snapshots, notices, budget books, accounts, awards, transactions, documents, source URLs, extraction metadata | Append or supersede by source refresh. Never edited as analyst opinion. |
| **Management** | Pursuit state, owner, next action, notes, tasks, events, teams, visibility, saved views | Versioned workspace writes with role checks and audit. |
| **Research** | Findings, entity edges, confidence, questions, diagrams, briefs | Source-linked and reviewable. Repository or source-backed items use overlays/tombstones. |
| **Response** | Requirements, compliance, artifacts, drafts, reviews, exports | Gate-controlled workspace writes with immutable export manifests. |
| **Automation** | Agent actions, jobs, events, proposed patches, approvals, usage | Idempotent proposal/review/commit workflow. Rejected and superseded work remains auditable. |

## Key surface requirements

### 1. Command Center

The first viewport must answer:

- What changed since my last visit?
- What requires my decision today?
- Which pursuits are at risk because of time, evidence, ownership, or response readiness?
- What work is assigned to me?
- Are source and automation systems healthy?

Required modules:

- personal work queue;
- decision queue with approve, reject, defer, and open-context actions;
- changed opportunities with sourced diffs;
- 30-day event and deadline horizon;
- pipeline counts by phase, owner, customer, and notice type;
- source and agent health summary;
- explicit saved-view scope.

### 2. Opportunity Queue

Start with Sabre's Unified Pursuit Workspace, then add the operating fields that it lacks.

Default columns:

1. Priority
2. Opportunity
3. Customer
4. Phase
5. Due in
6. Owner
7. Next action
8. Evidence state
9. Response readiness
10. Actions

Requirements:

- sticky sortable header and dense or comfortable modes;
- one-line quick filters for owner, phase, priority, customer, notice type, team, and attention state;
- direct text search across title, notice ID, customer, contacts, tags, and next action;
- expandable detail row for posture, fit rationale, latest change, and source links;
- bulk assign, phase, qualify/disqualify, tag, and export;
- saved personal and workspace views;
- default date urgency in plain language, such as `12 days`, `due today`, or `4 days overdue`;
- labeled overflow menu for secondary actions instead of a row of ambiguous icons;
- reviewed Discover / Update action that separates new records from changes to tracked records;
- empty, loading, stale, source-unavailable, and conflict states.

### 3. Opportunity Detail

Use Opportunity Intelligence's guided lifecycle shell with Sabre's research and Defense Intelligence's money evidence.

Persistent command header:

- identity, customer, notice, phase, owner, due date, priority, and source state;
- primary next action;
- Ask Defense Intelligence;
- refresh sources;
- edit and overflow actions.

Lifecycle:

```text
Triage → Qualify → Shape → Prepare Response → Submit → Negotiate → Outcome
```

Each phase defines an objective, required inputs, blockers, primary action, completion gate, and audit event. Closed and no-bid are terminal outcomes that preserve evidence and rationale.

Detail navigation:

| Tab | Purpose |
| --- | --- |
| **Brief** | Executive judgment, posture, blockers, next action, key facts |
| **Evidence** | Notices, amendments, money lineage, awards, incumbents, sources, conflicts |
| **Account** | Organizations, contacts, relationship graph, events, engagement history |
| **Capture** | Win themes, partner plan, tasks, calendar, gates, decisions |
| **Response** | Requirements, compliance, artifacts, outline, drafts, reviews, export |
| **History** | Source diffs, human changes, agent proposals, approvals, exports |

Raw source payloads, long document text, and low-level diagnostics belong in drawers or disclosures. They must not dominate the first viewport.

### 4. Account Intelligence

This replaces disconnected organization/contact lists with one customer and ecosystem workspace.

- account summary and mission areas;
- organization hierarchy;
- public contacts and roles;
- internal relationship owners and engagement notes;
- linked opportunities, events, awards, contracts, and budget lines;
- incumbent and partner ecosystem;
- cited one-hop and two-hop adjacency research;
- source freshness and relationship evidence;
- traversable inspector without duplicating records.

### 5. Research and reports

- retain Sabre's study, evidence, diagram, source, and Explore model;
- produce one versioned evidence object for web views, executive brief, and technical brief;
- keep source registers and confidence visible;
- preserve unresolved conflicts, assumptions, and questions;
- require review before research overlays alter shared views;
- release-gate any externally publishable report.

### 6. Capture and response

- phase-specific capture plans and reusable playbooks;
- task ownership, gates, handoffs, reminders, and decision records;
- document ingestion and requirement extraction;
- evidence-to-requirement and evidence-to-claim traceability;
- compliance matrix with status, owner, citation, and validation state;
- outline and section drafting with source-bounded agent assistance;
- review packets and comment resolution;
- immutable proposal export manifest containing versions, sources, approvals, and checksums;
- explicit unsupported-data and stale-source warnings before export.

### 7. Operations and wallboard

- one event model across opportunities, accounts, and workspace planning;
- team overlays and visibility rules;
- wallboard profiles for BD Room, Executive Brief, Events, Pursuits, and Research;
- kiosk mode, display tokens, rotation, connection health, and last successful sync;
- shared Task Center for source refreshes, enrichment, parsing, exports, and failures;
- review inbox for agent proposals and source diffs.

### 8. SaaS administration

Adopt the Defense Intelligence control plane without creating a second identity system.

- platform, organization, workspace, team, person, and agent boundaries;
- Super user, Administrator, Analyst, Viewer, and purpose-scoped agent roles;
- organization plans, entitlements, onboarding, support, export, deletion, closure, and ownership transfer;
- invitation or closed registration posture;
- active sessions and revocation;
- hashed scoped agent credentials;
- encrypted provider vault with metadata-only browser responses;
- usage rollups and entitlement observations;
- real actor plus effective actor in emulation audit events;
- D1 production and PostgreSQL portability contracts.

## Priority requirements

### P0: coherent sellable product

- [ ] One SaaS identity, organization, workspace, team, and role model
- [ ] One stable opportunity ID and normalized source snapshot contract
- [ ] Command Center with decisions, changes, deadlines, and assigned work
- [ ] Unified Opportunity Queue with owner, phase, due urgency, next action, and evidence state
- [ ] Guided opportunity detail through Triage, Qualify, Shape, and Prepare Response
- [ ] Linked customer, contact, event, contract, award, budget, and source evidence
- [ ] Versioned management writes with immutable evidence separation
- [ ] Agent proposal, review, commit, audit, idempotency, and optimistic concurrency
- [ ] Workspace event calendar, Task Center, API Log, and Wallboard
- [ ] Cloudflare/D1 production path and container/PostgreSQL parity
- [ ] Security, rate limits, retention, backups, and release evidence inherited from Defense Intelligence

### P1: differentiated capture platform

- [ ] Account Intelligence graph and relationship evidence
- [ ] Cited adjacency discovery and tracked-record update review
- [ ] Capture playbooks, gates, tasks, handoffs, and decision log
- [ ] Requirements and compliance workspace
- [ ] Response outline, section drafting, review packets, and export manifest
- [ ] Executive and technical intelligence briefs from one evidence model
- [ ] Saved personal and workspace views
- [ ] Named wallboard profiles and display tokens
- [ ] Source coverage, connector operations, and alerting

### P2: scale and commercial maturity

- [ ] Metered usage, plan enforcement, billing integration, and customer portal completion
- [ ] Dedicated tenant storage option
- [ ] Advanced portfolio analytics and outcome learning
- [ ] Cross-workspace account intelligence subject to explicit authorization
- [ ] Enterprise identity, phishing-resistant MFA, and policy integrations
- [ ] Compliance posture expansion only after control evidence exists

## Nonfunctional requirements

### Security and tenancy

- Every query and mutation carries organization and workspace scope.
- Browser sessions remain HttpOnly, Secure, SameSite=Strict, revocable, and bounded.
- Secrets never enter URLs, logs, screenshots, exports, or chat.
- Public evidence, internal workspace data, confidential identity data, and restricted credentials have distinct handling and retention rules.
- Emulation cannot inherit real Super authority and must log real and effective actors.

### Reliability and recovery

- Source refreshes and agent jobs are durable, resumable, observable, and idempotent.
- Every source-backed view shows freshness and last successful sync.
- D1 and PostgreSQL migrations are forward-only and tested against deterministic restore evidence.
- Failed jobs preserve safe diagnostics and retry posture without retaining prompts or provider bodies.

### Performance and usability

- Initial shell loads without opportunity, transaction, or research payloads.
- Large datasets load by route with server-side filtering and cursor pagination.
- Queue interactions respond in under 100 ms after data is present.
- The first desktop viewport of Command and Opportunity Detail contains no more than one decision strip, one summary band, and two primary work panels.
- Desktop, 390 px mobile, 1080p wallboard, and keyboard-only navigation are release gates.

### AI governance

- Models receive bounded tenant-scoped context.
- Claims must bind to supplied or provider-returned sources.
- Agent changes include target version, diff, evidence, confidence, risk, approval policy, and idempotency key.
- Auto-apply is limited to additive, verified, conflict-free, low-risk fields with an explicit workspace policy.
- Destructive, strategic, submission, identity, access, and credential changes always require human approval.

## Migration plan

### Phase 0: freeze contracts, not products

- Document canonical IDs and source ownership across all three systems.
- Preserve current deployments and treat them as source/reference systems.
- Stop adding new identity, audit, task, event, or wallboard implementations outside Defense Intelligence.

### Phase 1: establish the shared platform

- Extend the Defense Intelligence organization/workspace schema with opportunity, account, research, and response namespaces.
- Import the agent action/job/event contract.
- Define adapters for Sabre records and Opportunity Intelligence records without rewriting their source data.

### Phase 2: ship the new operating core

- Build Command Center, Opportunity Queue, and guided Opportunity Detail.
- Link Defense Intelligence money evidence and Sabre graph entities to the canonical opportunity.
- Route all new tasks, agent work, events, and audit activity through shared services.

### Phase 3: converge research and capture

- Move Sabre studies, reports, inspectors, and adjacency workflows behind the shared account/opportunity model.
- Move Opportunity Intelligence playbooks, requirements, response, review, and export into the detail route.

### Phase 4: cut over deliberately

- Run read parity and dual-write verification for management state.
- Migrate workspace members, saved views, events, overlays, and agent identities.
- Redirect old deep links through stable-ID mappings.
- Make old apps read-only, then retire them only after data, authorization, and export parity pass.

## What not to build

- A launcher that opens three branded applications
- Three separate user directories, audit logs, task queues, event stores, or wallboards
- A universal composite opportunity score
- An editable copy of official source evidence
- An unrestricted chat interface with invisible context
- Autonomous bid/no-bid, submission, credential, or access decisions
- A claim of classified, CUI, ITAR, or FedRAMP readiness without the corresponding environment and control evidence

## Success measures

| Outcome | Measure |
| --- | --- |
| Faster triage | Median time from sourced change to reviewed disposition |
| Better operating discipline | Percent of active pursuits with owner, next action, due date, and current phase |
| Better evidence | Percent of key claims with current authoritative source links |
| Better capture execution | Gate completion on time and response-readiness trend |
| Less tool fragmentation | Percent of daily workflows completed without leaving Defense Intelligence |
| Safe automation | Agent proposal acceptance, rejection, conflict, retry, and rollback rates |
| SaaS health | Tenant isolation tests, availability, recovery evidence, and support resolution time |

## Wireframes

Open [`defense-intelligence-saas-wireframes.html`](defense-intelligence-saas-wireframes.html) for the proposed product architecture, Command Center, Opportunity Queue, and Opportunity Detail layouts.

## Immediate implementation slice

The first build should be narrow:

1. Add a canonical opportunity projection to Defense Intelligence.
2. Import Sabre's table interaction model and map owner, phase, due urgency, next action, and evidence state.
3. Build the new guided detail shell with Brief, Evidence, Account, Capture, Response, and History tabs.
4. Link one real opportunity to one customer, one event, one research study, and Defense Intelligence award/transaction evidence.
5. Prove one reviewed source update and one reviewed agent patch end to end.
6. Verify desktop, mobile, tenant isolation, audit, D1, and PostgreSQL behavior before expanding scope.

That slice is large enough to prove the product and small enough to avoid a multi-quarter merge before users see value.
