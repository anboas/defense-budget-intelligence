import assert from "node:assert/strict";

const baseUrl = new URL(process.env.BUDGET_CONTAINER_URL || "http://127.0.0.1:8080/");

async function get(path) {
  const response = await fetch(new URL(path, baseUrl));
  assert.equal(response.status, 200, `${path} should return 200, got ${response.status}`);
  return response;
}

const health = await (await get("api/healthz")).json();
assert.equal(health.status, "ok");

const readiness = await (await get("api/readyz")).json();
assert.equal(readiness.status, "ready");

const metadata = await (await get("api/v1/snapshots")).json();
assert.deepEqual(
  metadata.snapshots.map((snapshot) => snapshot.kind).sort(),
  ["budget", "refresh_delta", "source_health"],
);
assert.ok(metadata.snapshots.find((snapshot) => snapshot.kind === "budget")?.record_count > 3000);

const budget = await (await get("api/v1/snapshots/budget/current")).json();
assert.ok(budget.payload?.records?.length > 3000);

const home = await (await get("/")).text();
assert.match(home, /Defense Budget & Spend Intelligence/);

const writesDisabled = await fetch(new URL("api/v1/saved-views", baseUrl));
assert.equal(writesDisabled.status, 503, "persistent writes should be disabled by default");

console.log(
  `Verified container API: snapshots=${metadata.snapshots.length} budget_records=${budget.payload.records.length} writes=disabled`,
);
