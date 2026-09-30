import assert from "node:assert/strict";
import { readFile, readdir, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { gunzipSync } from "node:zlib";
import {
  MAX_JSON_BODY_BYTES,
  SECURITY_HEADERS,
  cacheControlForPath,
  readBoundedJson,
  safeLogMetadata,
  sameOriginRequest,
} from "../src/security-policy.js";

const root = resolve(import.meta.dirname, "..");
const read = (path) => readFile(resolve(root, path), "utf8");

const requiredHeaders = [
  "Content-Security-Policy",
  "Cross-Origin-Opener-Policy",
  "Cross-Origin-Resource-Policy",
  "Origin-Agent-Cluster",
  "Permissions-Policy",
  "Referrer-Policy",
  "Strict-Transport-Security",
  "X-Content-Type-Options",
  "X-Frame-Options",
];
for (const header of requiredHeaders) assert.ok(SECURITY_HEADERS[header], `Security policy must define ${header}`);
assert.match(SECURITY_HEADERS["Content-Security-Policy"], /frame-ancestors 'none'/);
assert.match(SECURITY_HEADERS["Content-Security-Policy"], /script-src-attr 'none'/);
assert.match(SECURITY_HEADERS["Content-Security-Policy"], /style-src-elem 'self'/);
assert.match(SECURITY_HEADERS["Content-Security-Policy"], /upgrade-insecure-requests/);
assert.equal(cacheControlForPath("/api/v1/auth/status"), "no-store");
assert.match(cacheControlForPath("/assets/index-abcdef.js"), /immutable/);
assert.match(cacheControlForPath("/data/runtime-manifest.json"), /stale-while-revalidate/);

const sameOrigin = new Request("https://example.test/api", { method: "POST", headers: { origin: "https://example.test", "sec-fetch-site": "same-origin" } });
const crossSite = new Request("https://example.test/api", { method: "POST", headers: { origin: "https://attacker.test", "sec-fetch-site": "cross-site" } });
assert.equal(sameOriginRequest(sameOrigin), true, "Same-origin browser writes must be allowed");
assert.equal(sameOriginRequest(crossSite), false, "Cross-site browser writes must be rejected");

const oversized = new Request("https://example.test/api", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ payload: "x".repeat(MAX_JSON_BODY_BYTES) }),
});
assert.equal(await readBoundedJson(oversized), null, "Body limits must apply even without trusting Content-Length");
assert.deepEqual(safeLogMetadata({ token: "secret", nested: { authorization: "Bearer secret", safe: "retained" } }), { nested: { safe: "retained" } });

const workflows = (await readdir(resolve(root, ".github/workflows"))).filter((name) => name.endsWith(".yml"));
for (const workflow of workflows) {
  const source = await read(`.github/workflows/${workflow}`);
  for (const match of source.matchAll(/^\s*uses:\s*([^\s#]+)/gm)) {
    const reference = match[1];
    if (reference.startsWith("./")) continue;
    assert.match(reference, /@[0-9a-f]{40}$/, `${workflow} action must be pinned to a full commit SHA: ${reference}`);
  }
}

const packageJson = JSON.parse(await read("package.json"));
assert.match(packageJson.dependencies["control-surface-ui"], /archive\/[0-9a-f]{40}\.tar\.gz$/, "Control Surface must use an immutable commit pin");

const dockerfile = await read("Dockerfile");
const serverEntries = (await readdir(resolve(root, "server"), { recursive: true })).filter((name) => /\.mjs$/.test(name));
const serverSharedImports = new Set();
for (const entry of serverEntries) {
  const source = await read(`server/${entry}`);
  for (const match of source.matchAll(/from\s+["']\.\.\/src\/([^"']+)["']/g)) serverSharedImports.add(`src/${match[1]}`);
}
for (const path of serverSharedImports) assert.match(dockerfile, new RegExp(`COPY[^\\n]+${path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`), `Runtime image must copy server dependency ${path}`);

const architectureCeilings = {
  "src/main.jsx": 450,
  "src/BudgetRequestRoutes.jsx": 380,
  "src/AwardsRoute.jsx": 200,
  "src/AnalyticsSources.jsx": 170,
  "src/ProfilePage.jsx": 280,
  "src/CaptureCalendar.jsx": 1_750,
  "src/OperationsHub.jsx": 1_180,
  "src/pages-auth-api.js": 3_300,
  "server/auth-routes.mjs": 1_400,
};
for (const [path, ceiling] of Object.entries(architectureCeilings)) {
  const lines = (await read(path)).split(/\r?\n/).length;
  assert.ok(lines <= ceiling, `${path} grew to ${lines} lines; split the owning surface before exceeding ${ceiling}`);
}

const d1RateLimitSource = await read("src/d1-sensitive-rate-limit.js");
assert.match(d1RateLimitSource, /retry-after/i, "D1 sensitive-operation ceilings must publish retry guidance");
assert.match(d1RateLimitSource, /registration/, "D1 registration administration must have an explicit abuse ceiling");
assert.match(d1RateLimitSource, /provider-credentials/, "D1 credential administration must have an explicit abuse ceiling");

const operationsSource = await read("src/OperationsHub.jsx");
assert.doesNotMatch(operationsSource, /import\s+contractMonitor\s+from/, "Contract monitor data must remain route-lazy, not bundled into OperationsHub");
for (const path of ["src", "server", "functions"]) {
  const entries = await readdir(resolve(root, path), { recursive: true });
  for (const entry of entries.filter((name) => /\.(?:js|jsx|mjs)$/.test(name))) {
    const source = await read(`${path}/${entry}`);
    assert.doesNotMatch(source, /\bdangerouslySetInnerHTML\b|\beval\s*\(|\bnew\s+Function\b/, `${path}/${entry} contains a prohibited dynamic-code sink`);
  }
}

const assets = await readdir(resolve(root, "dist/assets"));
for (const asset of assets.filter((name) => name.endsWith(".js"))) {
  const bytes = (await stat(resolve(root, "dist/assets", asset))).size;
  assert.ok(bytes <= 550_000, `${asset} exceeds the 550KB route-chunk ceiling (${bytes} bytes)`);
}
const cssAssets = await Promise.all(assets.filter((name) => name.endsWith(".css")).map(async (asset) => ({ asset, bytes: (await stat(resolve(root, "dist/assets", asset))).size })));
const cssBytes = cssAssets.reduce((total, entry) => total + entry.bytes, 0);
const shellCssBytes = cssAssets.find(({ asset }) => /^index-.*\.css$/.test(asset))?.bytes || 0;
const mapCssBytes = cssAssets.find(({ asset }) => /^OpportunityMap-.*\.css$/.test(asset))?.bytes || 0;
const connectedEvidenceCssBytes = cssAssets.find(({ asset }) => /^ConnectedEvidence-.*\.css$/.test(asset))?.bytes || 0;
assert.ok(shellCssBytes <= 350_000, `Initial production CSS exceeds the 350KB ceiling (${shellCssBytes} bytes)`);
assert.ok(mapCssBytes > 0 && mapCssBytes <= 19_000, `Lazy Opportunity Map CSS exceeds its 19KB route ceiling (${mapCssBytes} bytes)`);
assert.ok(connectedEvidenceCssBytes > 0 && connectedEvidenceCssBytes <= 4_000, `Deferred connected-evidence CSS exceeds its 4KB component ceiling (${connectedEvidenceCssBytes} bytes)`);
assert.ok(cssBytes <= 373_000, `Total production CSS exceeds the 373KB ceiling (${cssBytes} bytes)`);
assert.ok((await stat(resolve(root, "dist/data/contract-monitor.json"))).size > 500_000, "Deferred contract monitor payload must be emitted as runtime data");
const intelligenceGraphBytes = (await stat(resolve(root, "dist/data/intelligence-graph.json"))).size;
const intelligenceGraphCompressedBytes = (await stat(resolve(root, "dist/data/intelligence-graph.json.gzip"))).size;
const intelligenceGraphIndexBytes = (await stat(resolve(root, "dist/data/intelligence-graph-index.json"))).size;
const intelligenceGraphSummaryBytes = (await stat(resolve(root, "dist/data/intelligence-graph-summary.json"))).size;
const organizationIdentityReviewBytes = (await stat(resolve(root, "dist/data/organization-identity-review.json"))).size;
const contractLineageIndexBytes = (await stat(resolve(root, "dist/data/contract-lineage-index.json"))).size;
const contractLineageReviewBytes = (await stat(resolve(root, "dist/data/contract-lineage-review.json"))).size;
const temporalEvidenceIndexBytes = (await stat(resolve(root, "dist/data/temporal-evidence-index.json"))).size;
const temporalEvidenceReviewBytes = (await stat(resolve(root, "dist/data/temporal-evidence-review.json"))).size;
assert.ok(intelligenceGraphBytes >= 28_000_000 && intelligenceGraphBytes <= 29_000_000, `Full evidence graph must retain temporal claims and conflicts within its 29MB ceiling, got ${intelligenceGraphBytes} bytes`);
assert.ok(intelligenceGraphCompressedBytes > 0 && intelligenceGraphCompressedBytes <= 2_500_000, `Compressed integrity graph must remain below its 2.5MB distribution budget, got ${intelligenceGraphCompressedBytes} bytes`);
assert.ok(gunzipSync(await readFile(resolve(root, "dist/data/intelligence-graph.json.gzip"))).equals(await readFile(resolve(root, "dist/data/intelligence-graph.json"))), "Compressed integrity graph must decode to the exact canonical JSON artifact");
assert.ok(intelligenceGraphIndexBytes > 0 && intelligenceGraphIndexBytes <= 3_000_000, `Deferred browser evidence index exceeds its 3MB ceiling, got ${intelligenceGraphIndexBytes} bytes`);
assert.ok(intelligenceGraphSummaryBytes > 0 && intelligenceGraphSummaryBytes <= 10_000, `Source Lineage graph summary exceeds its 10KB ceiling, got ${intelligenceGraphSummaryBytes} bytes`);
assert.ok(organizationIdentityReviewBytes > 0 && organizationIdentityReviewBytes <= 100_000, `Organization identity review exceeds its 100KB audit budget, got ${organizationIdentityReviewBytes} bytes`);
assert.ok(contractLineageIndexBytes > 0 && contractLineageIndexBytes <= 350_000, `Deferred contract-lineage index exceeds its 350KB ceiling, got ${contractLineageIndexBytes} bytes`);
assert.ok(contractLineageReviewBytes > 0 && contractLineageReviewBytes <= 100_000, `Contract-lineage review exceeds its 100KB audit budget, got ${contractLineageReviewBytes} bytes`);
assert.ok(temporalEvidenceIndexBytes > 0 && temporalEvidenceIndexBytes <= 800_000, `Deferred temporal evidence index exceeds its 800KB ceiling, got ${temporalEvidenceIndexBytes} bytes`);
assert.ok(temporalEvidenceReviewBytes > 0 && temporalEvidenceReviewBytes <= 700_000, `Temporal evidence review exceeds its 700KB audit budget, got ${temporalEvidenceReviewBytes} bytes`);
const organizationIdentityReview = JSON.parse(await read("dist/data/organization-identity-review.json"));
assert.equal(organizationIdentityReview.metadata?.schemaVersion, "1.0.0", "Organization identity review must publish its independent schema version");
assert.equal(organizationIdentityReview.metadata?.graphSchemaVersion, "1.3.0", "Organization identity review must track the canonical graph schema");
assert.ok(organizationIdentityReview.conflicts?.every((item) => item.status === "needs_review" && item.candidateUeis?.length > 1), "Ambiguous organization labels must remain explicit review items");
const contractLineageIndex = JSON.parse(await read("dist/data/contract-lineage-index.json"));
const contractLineageReview = JSON.parse(await read("dist/data/contract-lineage-review.json"));
assert.equal(contractLineageIndex.metadata?.schemaVersion, "1.0.0", "Contract lineage index must publish its independent schema version");
assert.equal(contractLineageIndex.metadata?.graphSchemaVersion, "1.3.0", "Contract lineage index must track the canonical graph schema");
assert.equal(contractLineageReview.metadata?.schemaVersion, "1.0.0", "Contract lineage review must publish its independent schema version");
assert.equal(contractLineageReview.metadata?.graphSchemaVersion, "1.3.0", "Contract lineage review must track the canonical graph schema");
assert.ok(contractLineageReview.unresolvedFollowOnClaims?.every((item) => item.status === "needs_review" && item.sourceUrls?.length), "Unresolved lineage claims must remain sourced review items");
const temporalEvidenceIndex = JSON.parse(await read("dist/data/temporal-evidence-index.json"));
const temporalEvidenceReview = JSON.parse(await read("dist/data/temporal-evidence-review.json"));
assert.equal(temporalEvidenceIndex.metadata?.schemaVersion, "1.0.0", "Temporal index must publish its independent schema version");
assert.equal(temporalEvidenceIndex.metadata?.graphSchemaVersion, "1.3.0", "Temporal index must track the canonical graph schema");
assert.equal(temporalEvidenceReview.metadata?.schemaVersion, "1.0.0", "Temporal review must publish its independent schema version");
assert.equal(temporalEvidenceReview.metadata?.graphSchemaVersion, "1.3.0", "Temporal review must track the canonical graph schema");
assert.equal(temporalEvidenceReview.conflicts?.filter((item) => item.status === "needs_review").length, 81, "Review-required temporal and conflict queue changed");
const opportunityMapBytes = (await stat(resolve(root, "dist/data/opportunity-map-data.json"))).size;
assert.ok(opportunityMapBytes >= 1_100_000 && opportunityMapBytes <= 1_200_000, `Opportunity Map evidence payload must retain the complete authoritative location and relationship layers without exceeding its route budget, got ${opportunityMapBytes} bytes`);
const opportunityMapPayload = JSON.parse(await read("dist/data/opportunity-map-data.json"));
assert.equal(opportunityMapPayload.metadata?.schemaVersion, "2.0.0", "Opportunity Map payload must publish the authoritative domain schema version");
assert.equal(opportunityMapPayload.locations?.length, 885, "Opportunity Map payload must retain all 885 authoritative location entities");
const opportunityMapLocationIds = new Set(opportunityMapPayload.locations.map((location) => location.id));
const opportunityMapRelations = opportunityMapPayload.records.flatMap((record) => record.relations || []);
assert.ok(opportunityMapRelations.length >= 200, `Opportunity Map payload must publish reviewed activity-to-location relationships, got ${opportunityMapRelations.length}`);
assert.ok(opportunityMapRelations.every((relation) => opportunityMapPayload.domain.relationTypes.includes(relation.type)), "Opportunity Map relationships must use the published domain vocabulary");
assert.ok(opportunityMapRelations.every((relation) => opportunityMapLocationIds.has(relation.locationId)), "Opportunity Map relationships must never reference an unknown location entity");
assert.ok(opportunityMapRelations.every((relation) => relation.activityId && relation.evidenceBasis), "Opportunity Map relationships must retain activity identity and evidence basis");
const locationMetadataBytes = (await stat(resolve(root, "dist/data/opportunity-map-location-metadata.json"))).size;
assert.ok(locationMetadataBytes >= 2_400_000 && locationMetadataBytes <= 2_700_000, `Deferred location metadata must retain the reviewed structured profiles without exceeding its route budget, got ${locationMetadataBytes} bytes`);
const locationMetadataPayload = JSON.parse(await read("dist/data/opportunity-map-location-metadata.json"));
assert.equal(locationMetadataPayload.metadata?.schemaVersion, "1.0.0", "Location metadata must publish its independent schema version");
assert.equal(Object.keys(locationMetadataPayload.locations || {}).length, 885, "Location metadata must cover all authoritative location entities");
assert.deepEqual(locationMetadataPayload.metadata?.passes, ["identity", "status", "geospatial", "mission", "acquisition", "financial"], "Location metadata must publish the complete enrichment-pass vocabulary");
for (const [id, profile] of Object.entries(locationMetadataPayload.locations || {})) {
  assert.ok(opportunityMapLocationIds.has(id), `Location metadata must not introduce an unknown entity: ${id}`);
  assert.ok(profile.summary && profile.geospatial?.precision && /^https?:\/\//.test(profile.evidence?.primarySource?.url || ""), `Location metadata must retain a summary, precision, and safe primary source: ${id}`);
  assert.equal(Object.keys(profile.passes || {}).length, 6, `Location metadata must retain six review passes: ${id}`);
}
const procurementFeedBytes = (await stat(resolve(root, "dist/data/procurement-feed.json"))).size;
const procurementDiscoveryBytes = (await stat(resolve(root, "dist/data/procurement-discovery.json"))).size;
assert.ok(procurementFeedBytes <= 250_000, `The default Today feed must stay compact, got ${procurementFeedBytes} bytes`);
assert.ok(procurementDiscoveryBytes > procurementFeedBytes, "The full discovery index must remain deferred from the compact Today feed");

console.log("Security and architecture contracts passed", {
  headers: requiredHeaders.length,
  workflows: workflows.length,
  bodyLimit: MAX_JSON_BODY_BYTES,
  routeChunks: assets.filter((name) => name.endsWith(".js")).length,
  cssBytes,
  shellCssBytes,
  mapCssBytes,
  opportunityMapBytes,
  locationMetadataBytes,
});
