import assert from "node:assert/strict";
import { readFile, readdir, stat } from "node:fs/promises";
import { resolve } from "node:path";
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

const architectureCeilings = {
  "src/main.jsx": 4_900,
  "src/OperationsHub.jsx": 1_180,
  "src/pages-auth-api.js": 3_300,
  "server/auth-routes.mjs": 1_400,
};
for (const [path, ceiling] of Object.entries(architectureCeilings)) {
  const lines = (await read(path)).split(/\r?\n/).length;
  assert.ok(lines <= ceiling, `${path} grew to ${lines} lines; split the owning surface before exceeding ${ceiling}`);
}

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
assert.ok((await stat(resolve(root, "dist/data/contract-monitor.json"))).size > 500_000, "Deferred contract monitor payload must be emitted as runtime data");

console.log("Security and architecture contracts passed", {
  headers: requiredHeaders.length,
  workflows: workflows.length,
  bodyLimit: MAX_JSON_BODY_BYTES,
  routeChunks: assets.filter((name) => name.endsWith(".js")).length,
});
