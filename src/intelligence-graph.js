export const INTELLIGENCE_GRAPH_SCHEMA_VERSION = "1.3.0";
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
