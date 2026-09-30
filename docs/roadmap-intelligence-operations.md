# Intelligence Operations: Roadmap Workstreams 4–8

## Scope

Schema 2.2 establishes the first shared evidence model for industrial-base intelligence,
official people and role tenure, accountability, document intelligence, and operational
products. It extends the schema 2.1 program and legislative spine without changing user,
authentication, workspace, or tenant data.

## Official people and role tenure

Public professional roles are facts about an official office, not personal profiles.

- `person` identifies the public professional named by an official source.
- `official-role` stores title, role type, organization, effective bounds, precision,
  current/historical state, quoted evidence, source IDs, and review state.
- `role-succession` connects exact predecessor and successor role observations when an
  official change-of-command or change-of-charter source publishes the transition.

Exact appointment or transition dates are used only when the official source states them.
An observed current directory creates an `observed-current-lower-bound`; it never creates an
inferred appointment date. Personal addresses, personal contact details, family details,
biographical dossiers, and inferred employment are excluded.

The bounded baseline contains 20 public professionals, 20 official roles, and four exact
successions. Sources include DVIDS, Navy leadership pages, and official congressional
committee pages.

## Industrial base and teaming

The baseline contains:

- 1,000 highest-value retained prime-to-supplier relationships from sampled USAspending
  subaward evidence;
- 22 buyer profiles and 235 vendor profiles from retained exact awards;
- 879 incumbent or awardee positions attached to canonical activities.

Buyer and vendor concentration metrics describe only the retained corpus. Sampled
subawards remain partial because the upstream source is rate-limited, and missing links
never imply that a relationship does not exist. Corporate-parent, facility, CAGE, and
certification claims remain pending exact SAM evidence.

## Outcomes and accountability

Every canonical defense program has a deterministic `program-health-profile` summarizing
retained request baselines, page-cited marks, and official findings. This is an evidence
completeness and attention view, not a predictive rating.

Four official program findings are promoted as `accountability-finding` entities and keep
their source URL, observation date, target program, review state, and open-evidence state.
Public protest decisions, audit findings, and corrective actions remain explicit zero until
stable award, account, notice, or program identifiers support exact joins. Missing public
evidence is never represented as a clean record.

## Document intelligence

Official publications are modeled as:

- `official-document`
- `document-version`
- `document-section`
- `document-table`
- `document-citation`

The baseline contains 45 documents, 45 observed versions, 25 retained sections, three
verified page-cited table extracts, and 60 citations. Citation selectors distinguish quoted
claims from printed-page table rows. Metadata hashes are labeled
`normalized-source-metadata`; verified table hashes cover the retained reviewed extract.
Neither is mislabeled as a full-source byte hash. Embeddings remain explicit zero.

## Operational products

Eight saved graph-query templates and five weekly brief templates are first-class graph and
Agent API entities. They cover program health, buyer concentration, supplier dependencies,
role turnover, expiring awards, execution review, request-to-law evidence, and source
freshness. Every brief uses `review-before-send`; the template does not authorize an email,
message, publication, or other external action.

The ADMIN Intelligence Operations route loads one deferred artifact and exposes all five
workstreams. Initial shell and Opportunity Map payloads remain unchanged.

## Refresh and promotion rules

1. Refresh official current-role observations at least quarterly and append exact
   successions when official transition evidence appears.
2. Preserve historical role records when a successor becomes current.
3. Rebuild industrial-base summaries only from retained exact award and sampled subaward
   evidence; disclose the source boundary on every output.
4. Promote accountability records only with a stable target identifier and official source.
5. Preserve document versions and competing claims rather than overwriting history.
6. Require review before any brief leaves the workspace.
7. Publish every entity and relationship through the canonical graph, ADMIN inventory,
   Source Lineage, and paged Agent API.

## Next depth increments

- broaden official-role coverage to PEOs, program managers, contracting officers,
  requirements owners, and congressional committee leadership;
- activate exact CAGE, corporate-family, registration, and certification evidence after
  the protected SAM key is configured;
- add exact GAO protest, DoD IG, DOT&E, hearing, corrective-action, and resolution joins;
- retain complete source bytes, revision diffs, paragraph anchors, and reproducible
  embeddings;
- connect saved queries and briefs to policy-controlled workspace schedules, approvals,
  freshness alerts, and delivery logs.
