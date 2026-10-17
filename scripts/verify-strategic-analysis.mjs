import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { normalizeSavedAcquisitionView } from "../src/acquisition-runtime-core.js";
import { normalizeStrategyConfig, recordSpendFact, scopeSpendSummary, weightedScore } from "../src/strategic-analysis.js";

const root = resolve(import.meta.dirname, "..");
const artifactPath = resolve(root, "public/data/strategy-spend-index.json");
const artifact = JSON.parse(await readFile(artifactPath, "utf8"));
const bytes = (await stat(artifactPath)).size;

assert.equal(artifact.metadata?.schemaVersion, "strategy-spend.v1", "Strategy spend index must publish its independent schema version");
assert.equal(artifact.metadata?.activityCount, Object.keys(artifact.byActivity || {}).length, "Strategy spend coverage must match the published activity count");
assert.deepEqual(artifact.metadata?.fiscalYears, [2025, 2026, 2027], "Strategy request context must retain the supported fiscal years");
assert.ok(bytes > 100_000 && bytes <= 500_000, `Strategy spend index must remain bounded between 100KB and 500KB, got ${bytes} bytes`);
assert.match(artifact.metadata?.trustBoundary || "", /remain separate measure classes/i, "Strategy spend metadata must prohibit unlike-measure aggregation");

let requestFacts = 0;
let obligationFacts = 0;
let awardFacts = 0;
for (const [activityId, entry] of Object.entries(artifact.byActivity || {})) {
  assert.ok(activityId, "Every strategy spend entry must retain an activity identity");
  for (const key of ["requestFacts", "obligationFacts", "awardFacts"]) {
    assert.ok(Array.isArray(entry[key]), `${activityId} must expose ${key}`);
    assert.equal(new Set(entry[key].map((fact) => fact.id)).size, entry[key].length, `${activityId} ${key} must be deduplicated by source identity`);
    assert.ok(entry[key].every((fact) => fact.id && typeof fact.sourceUrl === "string"), `${activityId} ${key} must retain source identity and a source slot`);
  }
  assert.ok(entry.requestFacts.every((fact) => Object.keys(fact.values || {}).every((year) => ["2025", "2026", "2027"].includes(year))), `${activityId} request facts must use supported fiscal years only`);
  requestFacts += entry.requestFacts.length;
  obligationFacts += entry.obligationFacts.length;
  awardFacts += entry.awardFacts.length;
}
assert.ok(requestFacts >= 400, `Strategy analysis should retain the verified broad budget-request baseline or more, got ${requestFacts}`);
assert.ok(obligationFacts >= 300, `Strategy analysis should retain exact obligation evidence, got ${obligationFacts}`);
assert.ok(awardFacts >= 500, `Strategy analysis should retain published award evidence, got ${awardFacts}`);

const sample = Object.entries(artifact.byActivity).find(([, entry]) => entry.awardFacts.length)?.[0];
assert.ok(sample, "Strategy spend verification requires one award-backed activity");
const award = recordSpendFact(sample, artifact.byActivity, "award", 2027);
assert.ok(award.coverage && award.value > 0 && award.count > 0, "Record spend lookup must expose published award facts without mixing measures");
const repeated = scopeSpendSummary([sample, sample], artifact.byActivity, "award", 2027);
assert.equal(repeated.value, award.value, "Portfolio spend summaries must deduplicate repeated records by source identity");

const config = normalizeStrategyConfig({ lens: "win-readiness", threshold: 200, minimumFit: -4, buyers: ["Office A", "Office A"], capabilities: ["cybersecurity"], attractivenessWeights: { fit: 80, urgency: 20, funding: 0, evidence: 0 } });
assert.equal(config.threshold, 80, "Strategy threshold must stay inside the declared decision range");
assert.equal(config.minimumFit, 0, "Strategy minimum fit must stay inside the score range");
assert.deepEqual(config.buyers, ["Office A"], "Strategy baselines must be deduplicated");
assert.equal(weightedScore({ fit: 90, urgency: 50 }, config.attractivenessWeights), 82, "Configurable weights must normalize across enabled signals");
assert.equal(normalizeStrategyConfig({ threshold: null }).threshold, 50, "Missing URL values must preserve the declared strategy defaults");

const saved = normalizeSavedAcquisitionView({ query: "ignored for strategy", filters: { office: "Office A", untrusted: "drop" }, analysis: config });
assert.equal(saved.analysis?.kind, "strategy", "Saved acquisition views must retain a normalized strategy configuration");
assert.equal(saved.analysis?.lens, "win-readiness", "Saved strategy views must retain the selected lens");
assert.equal(saved.filters.untrusted, undefined, "Saved strategy views must preserve the existing filter allowlist");

console.log(`Strategic analysis verified: ${artifact.metadata.activityCount} activities, ${requestFacts} request facts, ${obligationFacts} obligation facts, ${awardFacts} award facts, ${bytes} bytes`);
