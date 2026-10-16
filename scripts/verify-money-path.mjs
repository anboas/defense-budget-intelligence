import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { INTELLIGENCE_GRAPH_SCHEMA_VERSION, MONEY_PATH_SCHEMA_VERSION } from "../src/intelligence-graph.js";

const root = resolve(import.meta.dirname, "..");
const artifactPath = resolve(root, "public/data/money-path-index.json");
const artifact = JSON.parse(await readFile(artifactPath, "utf8"));
const paths = Object.values(artifact.indices?.byActivity || {});
const bytes = (await stat(artifactPath)).size;

assert.equal(artifact.metadata?.schemaVersion, MONEY_PATH_SCHEMA_VERSION, "Money Path must publish its independent schema version");
assert.equal(artifact.metadata?.graphSchemaVersion, INTELLIGENCE_GRAPH_SCHEMA_VERSION, "Money Path must track the canonical graph schema");
assert.equal(artifact.metadata?.activityCount, paths.length, "Published activity count must match the bounded index");
assert.ok(paths.length >= 600, `Money Path should cover the award-backed opportunity corpus, got ${paths.length}`);
assert.ok(bytes > 0 && bytes <= 3_000_000, `Deferred Money Path index exceeds its 3MB ceiling, got ${bytes} bytes`);
assert.match(artifact.metadata?.trustBoundary || "", /remain distinct/i, "Money Path must disclose that funding measures remain distinct");
assert.match(artifact.metadata?.amountPolicy || "", /must not be added together/i, "Money Path must prohibit adding unlike measures");

let exactObligations = 0;
let derivedRequests = 0;
let supplierSamples = 0;
for (const path of paths) {
  assert.ok(path.nodes.length <= 28, `Money Path ${path.opportunityId} exceeds the 28-node interaction bound`);
  assert.ok(path.links.length <= 36, `Money Path ${path.opportunityId} exceeds the 36-link interaction bound`);
  assert.deepEqual(path.fiscalYears, [2025, 2026, 2027], `Money Path ${path.opportunityId} must retain the supported request years`);
  const nodeIds = new Set(path.nodes.map((node) => node.id));
  assert.equal(nodeIds.size, path.nodes.length, `Money Path ${path.opportunityId} must not publish duplicate node identities`);
  const linkedNodeIds = new Set(path.links.flatMap((link) => [link.source, link.target]));
  assert.equal(linkedNodeIds.size, nodeIds.size, `Money Path ${path.opportunityId} must not publish disconnected nodes`);
  for (const link of path.links) {
    assert.ok(nodeIds.has(link.source) && nodeIds.has(link.target), `Money Path ${path.opportunityId} link ${link.id} must reference published nodes`);
    if (link.type === "obligation") {
      exactObligations += 1;
      assert.equal(link.confidence, "exact", "Award-account obligations must remain exact joins");
      assert.equal(link.amountType, "exact-award-account-obligation", "Award-account obligations must retain their measure type");
      assert.notEqual(Number(link.amount), 0, "Exact obligation links must publish a non-zero signed amount");
    }
    if (link.type === "request") {
      derivedRequests += 1;
      if (link.target.startsWith("account:")) assert.equal(link.confidence, "derived", "Budget-line to account links must remain explicitly derived");
      else assert.ok(["exact", "reviewed"].includes(link.confidence), "Program to budget-line links must retain exact or reviewed source identity");
      assert.match(link.amountType, /^fy20(?:25|26|27)-budget-request$/, "Budget request links must retain their fiscal-year measure type");
    }
    if (link.type === "subaward") {
      supplierSamples += 1;
      assert.equal(link.amountType, "retained-subaward-sample", "Supplier flows must remain labeled as retained samples");
    }
  }
  assert.ok(path.nodes.filter((node) => node.type === "supplier").every((node) => node.coverage === "partial" && node.amountType === "retained-subaward-sample"), `Money Path ${path.opportunityId} supplier nodes must remain visibly partial retained samples`);
}

assert.ok(exactObligations >= 400, `Money Path should retain exact non-zero award-account obligation flows, got ${exactObligations}`);
assert.ok(derivedRequests > 0, "Money Path should expose derived budget-request context where titles support it");
assert.ok(supplierSamples > 0, "Money Path should expose retained supplier samples where the source publishes them");
assert.ok(paths.some((path) => path.links.some((link) => link.type === "obligation") && path.links.some((link) => link.type === "subaward")), "At least one bounded path must connect exact obligations through an award to retained supplier samples");

console.log(`Money Path verified: ${paths.length} activities, ${exactObligations} exact obligations, ${derivedRequests} derived request links, ${supplierSamples} supplier samples, ${bytes} bytes`);
