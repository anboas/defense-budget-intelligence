export const INTELLIGENCE_GRAPH_SCHEMA_VERSION = "1.1.0";

export const INTELLIGENCE_ENTITY_TYPES = Object.freeze([
  "activity",
  "award",
  "event",
  "transaction",
  "organization",
  "organization-identifier",
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
  "budget-line-matches-account-title",
  "budget-line-owned-by-organization",
  "organization-located-at",
  "organization-operates-at-location",
  "organization-part-of",
  "organization-has-identifier",
  "transaction-recipient",
  "entity-classified-as",
  "supported-by-source",
]);

const EMPTY_GRAPH = Object.freeze({ metadata: {}, domain: {}, entities: {}, relations: [], indices: { byActivity: {} } });
let cached = null;
let pending = null;
let cachedSummary = null;
let pendingSummary = null;

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
