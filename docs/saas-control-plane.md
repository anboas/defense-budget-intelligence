# SaaS control plane

DBI is introducing its commercial model beside the existing workspace runtime. This foundation does not enable payment processing, checkout, invoices, card handling, automatic suspension, or customer-visible entitlement enforcement.

## Boundaries

- **Platform** retains the immutable Super user and global operational authority.
- **Organization** represents the customer relationship, owner, billing contact, lifecycle, plan, and aggregate usage.
- **Workspace** remains the tenant, data, credential, and authorization boundary. One organization may own multiple workspaces.
- **Organization owner** is durable commercial metadata and is distinct from platform Super authority and workspace roles.

Fresh and existing databases converge through an idempotent Internal organization bootstrap. Unassigned workspaces join the Internal organization without changing memberships, sessions, credentials, or data. A workspace can later move to a manually provisioned customer organization without changing its stable ID.

## Plans and entitlements

The initial catalog contains:

- **Internal:** grandfathered current behavior.
- **Pilot:** sales-assisted design-partner capacity.

Server-side entitlement checks replace the former hard-coded seat and team ceilings. Enforcement is fixed to **observe** in this release: a limit can generate an entitlement observation but cannot reject an existing workflow. A later enforcement cutover must be explicit and separately released.

Usage is measured as bounded daily workspace rollups and an organization summary. Seat usage counts unique active people across the organization's workspaces rather than double-counting multi-workspace members.

## Interfaces

- **Platform → Workspaces** lists customer organizations and supports manual owner, lifecycle, plan, contact, workspace assignment, and entitlement overrides by the real non-emulating Super user.
- **Workspace Settings → Overview** is the customer portal for plan/usage posture, onboarding, support, export, deletion, closure, and ownership-transfer requests.
- Workspace managers can read plan and usage posture for their active workspace. Billing contact, organization membership administration, and owner email metadata remain hidden.

Commercial mutations are same-origin, rate bounded in D1, activity audited, and validated against active accounts and real workspaces. D1 and PostgreSQL implement and test the same lifecycle.

## Customer operations

Every organization receives a durable onboarding checklist covering ownership, team setup, source connection, saved monitoring, and security review. Organization owners, organization administrators, workspace managers, and the real Super user may update the checklist. Changes are activity-audited.

The portal retains customer requests for support, data export, data deletion, organization closure, and ownership transfer. Requests have an explicit status lifecycle and resolution record. Ordinary workspace members may open support and data-export requests and cancel their own open request. Organization managers may administer the broader request lifecycle. The platform Super user can assign and resolve requests.

Manual entitlement overrides are available only to the real non-emulating Super user. Overrides are server-side, auditable, and continue to operate in observe-only mode. Customer-facing responses expose resolved entitlements but redact platform-only override notes, billing contacts, membership administration, and owner email addresses.

## Deliberately disabled

- payment-provider customer or subscription IDs;
- hosted checkout or billing portal;
- invoice or card metadata;
- payment webhooks or automated collections;
- automated trials, grace periods, suspension, or deletion;
- entitlement enforcement;
- public self-service provisioning.

These can be layered onto the existing organization, subscription, entitlement-override, usage, and observation tables after pilot behavior is understood.
