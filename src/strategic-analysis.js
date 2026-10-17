export const STRATEGY_CONFIG_VERSION = 1;

export const DEFAULT_STRATEGY_CONFIG = Object.freeze({
  kind: "strategy",
  version: STRATEGY_CONFIG_VERSION,
  lens: "ansoff",
  view: "customer",
  spendMeasure: "request",
  fiscalYear: 2027,
  trackedOnly: false,
  stage: "all",
  minimumFit: 0,
  threshold: 50,
  attractivenessWeights: Object.freeze({ fit: 35, urgency: 25, funding: 25, evidence: 15 }),
  abilityWeights: Object.freeze({ customer: 30, capability: 30, route: 25, pursuit: 15 }),
});

export const STRATEGY_SPEND_MEASURES = Object.freeze([
  ["request", "Budget request context"],
  ["obligations", "Exact obligations"],
  ["award", "Published award totals"],
]);

const LENSES = new Set(["ansoff", "win-readiness"]);
const VIEWS = new Set(["customer", "capability"]);
const SPEND = new Set(STRATEGY_SPEND_MEASURES.map(([value]) => value));
const STAGES = new Set(["all", "award", "solicitation", "shaping", "forecast", "other"]);

function boundedNumber(value, fallback, minimum = 0, maximum = 100) {
  if (value === null || value === undefined || value === "") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(minimum, Math.min(maximum, Math.round(parsed))) : fallback;
}

function stringArray(values, limit) {
  return [...new Set((Array.isArray(values) ? values : []).map((value) => String(value || "").trim()).filter(Boolean))].slice(0, limit);
}

function weights(values, defaults) {
  return Object.fromEntries(Object.entries(defaults).map(([key, fallback]) => [key, boundedNumber(values?.[key], fallback)]));
}

export function normalizeStrategyConfig(value = {}, baseline = {}) {
  return {
    kind: "strategy",
    version: STRATEGY_CONFIG_VERSION,
    lens: LENSES.has(value.lens) ? value.lens : DEFAULT_STRATEGY_CONFIG.lens,
    view: VIEWS.has(value.view) ? value.view : DEFAULT_STRATEGY_CONFIG.view,
    spendMeasure: SPEND.has(value.spendMeasure) ? value.spendMeasure : DEFAULT_STRATEGY_CONFIG.spendMeasure,
    fiscalYear: [2025, 2026, 2027].includes(Number(value.fiscalYear)) ? Number(value.fiscalYear) : DEFAULT_STRATEGY_CONFIG.fiscalYear,
    trackedOnly: Boolean(value.trackedOnly),
    stage: STAGES.has(value.stage) ? value.stage : DEFAULT_STRATEGY_CONFIG.stage,
    minimumFit: boundedNumber(value.minimumFit, DEFAULT_STRATEGY_CONFIG.minimumFit),
    threshold: boundedNumber(value.threshold, DEFAULT_STRATEGY_CONFIG.threshold, 40, 80),
    buyers: stringArray(value.buyers ?? baseline.buyers, 40),
    capabilities: stringArray(value.capabilities ?? baseline.capabilities, 20),
    attractivenessWeights: weights(value.attractivenessWeights, DEFAULT_STRATEGY_CONFIG.attractivenessWeights),
    abilityWeights: weights(value.abilityWeights, DEFAULT_STRATEGY_CONFIG.abilityWeights),
  };
}

export function weightedScore(parts, weightValues) {
  const entries = Object.entries(weightValues).filter(([, weight]) => Number(weight) > 0);
  const total = entries.reduce((sum, [, weight]) => sum + Number(weight), 0);
  if (!total) return 0;
  return Math.round(entries.reduce((sum, [key, weight]) => sum + Number(parts[key] || 0) * Number(weight), 0) / total);
}

function factValue(fact, measure, fiscalYear) {
  if (measure === "request") return Number(fact.values?.[String(fiscalYear)] || 0);
  return Number(fact.amount || 0);
}

function factsFor(entry, measure) {
  if (!entry) return [];
  if (measure === "request") return entry.requestFacts || [];
  if (measure === "obligations") return entry.obligationFacts || [];
  return entry.awardFacts || [];
}

export function recordSpendFact(recordId, spendByActivity, measure, fiscalYear) {
  const entry = spendByActivity?.[recordId];
  const facts = factsFor(entry, measure);
  const value = facts.reduce((sum, fact) => sum + factValue(fact, measure, fiscalYear), 0);
  return {
    value,
    count: facts.filter((fact) => factValue(fact, measure, fiscalYear) !== 0).length,
    coverage: Boolean(facts.length),
    hasVehicle: Boolean(entry?.hasVehicle),
    supplierCount: Number(entry?.supplierCount || 0),
  };
}

export function scopeSpendSummary(recordIds, spendByActivity, measure, fiscalYear) {
  const facts = new Map();
  let coveredRecords = 0;
  for (const recordId of recordIds) {
    const entry = spendByActivity?.[recordId];
    const rows = factsFor(entry, measure);
    if (rows.some((fact) => factValue(fact, measure, fiscalYear) !== 0)) coveredRecords += 1;
    for (const fact of rows) {
      const value = factValue(fact, measure, fiscalYear);
      if (!value || facts.has(fact.id)) continue;
      facts.set(fact.id, value);
    }
  }
  return { value: [...facts.values()].reduce((sum, value) => sum + value, 0), factCount: facts.size, coveredRecords };
}

export function fundingStrength(recordId, spendByActivity, fiscalYear, fallbackValue = 0) {
  const obligations = recordSpendFact(recordId, spendByActivity, "obligations", fiscalYear);
  const award = recordSpendFact(recordId, spendByActivity, "award", fiscalYear);
  const request = recordSpendFact(recordId, spendByActivity, "request", fiscalYear);
  if (Math.abs(obligations.value) > 0) return 100;
  if (award.value > 0) return 85;
  if (request.value > 0) return 65;
  return fallbackValue > 0 ? 40 : 0;
}
