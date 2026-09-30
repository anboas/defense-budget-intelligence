export const INTELLIGENCE_GRAPH_SCHEMA_VERSION = "2.2.0";
export const CONTRACT_LINEAGE_SCHEMA_VERSION = "1.0.0";
export const TEMPORAL_EVIDENCE_SCHEMA_VERSION = "1.0.0";

export const INTELLIGENCE_ENTITY_TYPES = Object.freeze([
  "activity",
  "award",
  "event",
  "transaction",
  "organization",
  "organization-identifier",
  "contract-vehicle",
  "acquisition-path",
  "recompete-signal",
  "evidence-claim",
  "evidence-conflict",
  "location",
  "federal-account",
  "budget-line",
  "subaward-summary",
  "spending-observation",
  "opportunity-notice",
  "notice-version",
  "award-action",
  "vendor-registration",
  "business-certification",
  "organization-hierarchy-observation",
  "subaward",
  "treasury-account",
  "apportionment-revision",
  "execution-balance",
  "program-activity",
  "object-class",
  "treasury-outlay-observation",
  "legislative-measure",
  "legislative-version",
  "committee-report",
  "enacted-provision",
  "appropriation-mark",
  "budget-adjustment",
  "program-element",
  "project",
  "defense-program",
  "program-office",
  "acquisition-milestone",
  "program-baseline",
  "cost-estimate",
  "schedule-event",
  "unit-cost-breach",
  "test-finding",
  "program-risk",
  "person",
  "official-role",
  "role-succession",
  "supplier-relationship",
  "buyer-profile",
  "vendor-profile",
  "incumbent-position",
  "program-health-profile",
  "accountability-finding",
  "official-document",
  "document-version",
  "document-section",
  "document-table",
  "document-citation",
  "saved-query-template",
  "brief-template",
  "acquisition-forecast",
  "mission-assignment",
  "installation-tenant",
  "sbir-topic",
  "sbir-award",
  "competitive-signal",
  "expiration-signal",
  "execution-risk-signal",
  "protest-decision",
  "audit-finding",
  "outcome-evidence",
  "classification",
  "source",
]);

export const INTELLIGENCE_RELATION_TYPES = Object.freeze([
  "activity-awarded-as",
  "activity-has-event",
  "activity-has-transaction",
  "activity-ordered-under-vehicle",
  "activity-uses-acquisition-path",
  "activity-follow-on-to",
  "activity-has-recompete-signal",
  "activity-recipient",
  "activity-contracting-organization",
  "activity-funding-organization",
  "contracting-activity-at",
  "funding-activity-at",
  "award-recipient",
  "award-awarding-organization",
  "award-funding-organization",
  "award-funded-by-account",
  "award-has-subaward-summary",
  "award-ordered-under-vehicle",
  "award-has-recompete-signal",
  "contract-vehicle-associated-with-path",
  "budget-line-matches-account-title",
  "budget-line-owned-by-organization",
  "organization-located-at",
  "organization-operates-at-location",
  "organization-part-of",
  "organization-has-identifier",
  "transaction-recipient",
  "spending-observation-measures-entity",
  "notice-has-version",
  "notice-version-supersedes",
  "notice-results-in-award",
  "award-modified-by-action",
  "award-action-ordered-under-vehicle",
  "award-action-recipient",
  "organization-has-registration",
  "registration-has-certification",
  "organization-hierarchy-observed-as",
  "hierarchy-observation-parent",
  "award-has-subaward",
  "subaward-prime",
  "subaward-recipient",
  "federal-account-has-treasury-account",
  "federal-account-has-execution-balance",
  "treasury-account-has-execution-balance",
  "treasury-account-apportioned-by-revision",
  "program-activity-owned-by-organization",
  "object-class-used-by-organization",
  "treasury-outlay-observation-measures-organization",
  "measure-has-version",
  "legislative-version-supersedes",
  "measure-backed-by-report",
  "measure-enacted-as",
  "appropriation-mark-adjusts-budget-line",
  "enacted-provision-affects-budget-line",
  "budget-adjustment-affects-budget-line",
  "program-element-represented-by-budget-line",
  "project-represented-by-budget-line",
  "defense-program-represented-by-budget-line",
  "defense-program-owned-by-program-office",
  "program-office-part-of-organization",
  "defense-program-has-acquisition-milestone",
  "defense-program-has-baseline",
  "defense-program-has-cost-estimate",
  "defense-program-has-schedule-event",
  "defense-program-has-unit-cost-breach",
  "defense-program-has-test-finding",
  "defense-program-has-risk",
  "appropriation-mark-affects-defense-program",
  "appropriation-mark-recommended-by-report",
  "appropriation-mark-considered-by-measure",
  "person-holds-official-role",
  "official-role-at-organization",
  "role-succession-predecessor",
  "role-succession-successor",
  "supplier-relationship-prime",
  "supplier-relationship-supplier",
  "buyer-profile-for-organization",
  "vendor-profile-for-organization",
  "incumbent-position-for-activity",
  "incumbent-position-for-organization",
  "program-health-profile-summarizes-program",
  "accountability-finding-about-program",
  "official-document-has-version",
  "official-document-has-section",
  "official-document-has-table",
  "official-document-has-citation",
  "document-citation-supports-official-role",
  "document-citation-supports-appropriation-mark",
  "document-citation-supports-accountability-finding",
  "activity-has-forecast",
  "mission-assignment-at-location",
  "mission-assignment-for-organization",
  "installation-tenant-at-location",
  "installation-tenant-organization",
  "sbir-topic-results-in-award",
  "activity-has-competitive-signal",
  "award-has-expiration-signal",
  "execution-balance-has-risk-signal",
  "activity-has-outcome-evidence",
  "outcome-evidence-award",
  "protest-decision-about-award",
  "audit-finding-about-entity",
  "entity-classified-as",
  "supported-by-source",
  "evidence-claim-about",
  "evidence-conflict-has-claim",
  "evidence-conflict-resolved-by",
]);

const EMPTY_GRAPH = Object.freeze({ metadata: {}, domain: {}, entities: {}, relations: [], indices: { byActivity: {} } });
let cached = null;
let pending = null;
let cachedSummary = null;
let pendingSummary = null;
let cachedContractLineage = null;
let pendingContractLineage = null;
let cachedTemporalEvidence = null;
let pendingTemporalEvidence = null;

export function emptyIntelligenceGraph() {
  return EMPTY_GRAPH;
}

export async function loadIntelligenceGraph() {
  if (cached) return cached;
  if (!pending) {
    pending = fetch(`${import.meta.env.BASE_URL}data/intelligence-graph-index.json`)
      .then((response) => {
        if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
        return response.json();
      })
      .then((payload) => {
        if (payload?.metadata?.schemaVersion !== INTELLIGENCE_GRAPH_SCHEMA_VERSION) {
          throw new Error(`Intelligence graph requires schema ${INTELLIGENCE_GRAPH_SCHEMA_VERSION}`);
        }
        cached = payload;
        return cached;
      })
      .finally(() => { pending = null; });
  }
  return pending;
}

export async function loadIntelligenceGraphSummary() {
  if (cachedSummary) return cachedSummary;
  if (!pendingSummary) {
    pendingSummary = fetch(`${import.meta.env.BASE_URL}data/intelligence-graph-summary.json`)
      .then((response) => {
        if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
        return response.json();
      })
      .then((payload) => {
        if (payload?.metadata?.schemaVersion !== INTELLIGENCE_GRAPH_SCHEMA_VERSION) {
          throw new Error(`Intelligence graph summary requires schema ${INTELLIGENCE_GRAPH_SCHEMA_VERSION}`);
        }
        cachedSummary = payload;
        return cachedSummary;
      })
      .finally(() => { pendingSummary = null; });
  }
  return pendingSummary;
}

export async function loadContractLineage() {
  if (cachedContractLineage) return cachedContractLineage;
  if (!pendingContractLineage) {
    pendingContractLineage = fetch(`${import.meta.env.BASE_URL}data/contract-lineage-index.json`)
      .then((response) => {
        if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
        return response.json();
      })
      .then((payload) => {
        if (payload?.metadata?.schemaVersion !== CONTRACT_LINEAGE_SCHEMA_VERSION || payload?.metadata?.graphSchemaVersion !== INTELLIGENCE_GRAPH_SCHEMA_VERSION) {
          throw new Error(`Contract lineage requires schema ${CONTRACT_LINEAGE_SCHEMA_VERSION} on graph ${INTELLIGENCE_GRAPH_SCHEMA_VERSION}`);
        }
        cachedContractLineage = payload;
        return cachedContractLineage;
      })
      .finally(() => { pendingContractLineage = null; });
  }
  return pendingContractLineage;
}

export async function loadTemporalEvidence() {
  if (cachedTemporalEvidence) return cachedTemporalEvidence;
  if (!pendingTemporalEvidence) {
    pendingTemporalEvidence = fetch(`${import.meta.env.BASE_URL}data/temporal-evidence-index.json`)
      .then((response) => {
        if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
        return response.json();
      })
      .then((payload) => {
        if (payload?.metadata?.schemaVersion !== TEMPORAL_EVIDENCE_SCHEMA_VERSION || payload?.metadata?.graphSchemaVersion !== INTELLIGENCE_GRAPH_SCHEMA_VERSION) {
          throw new Error(`Temporal evidence requires schema ${TEMPORAL_EVIDENCE_SCHEMA_VERSION} on graph ${INTELLIGENCE_GRAPH_SCHEMA_VERSION}`);
        }
        cachedTemporalEvidence = payload;
        return cachedTemporalEvidence;
      })
      .finally(() => { pendingTemporalEvidence = null; });
  }
  return pendingTemporalEvidence;
}
