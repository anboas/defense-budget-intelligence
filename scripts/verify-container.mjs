import assert from "node:assert/strict";

const baseUrl = new URL(process.env.BUDGET_CONTAINER_URL || "http://127.0.0.1:8080/");

async function waitForHealth(timeoutMs = 30000) {
  const startedAt = Date.now();
  let lastError;
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(new URL("api/healthz", baseUrl));
      if (response.ok) return;
      lastError = new Error(`health check returned ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Timed out waiting for container health: ${lastError?.message || "unknown error"}`);
}

async function get(path) {
  const response = await fetch(new URL(path, baseUrl));
  assert.equal(response.status, 200, `${path} should return 200, got ${response.status}`);
  return response;
}

await waitForHealth();
const health = await (await get("api/healthz")).json();
assert.equal(health.status, "ok");

const readiness = await (await get("api/readyz")).json();
assert.equal(readiness.status, "ready");

const metadata = await (await get("api/v1/snapshots")).json();
assert.deepEqual(
  metadata.snapshots.map((snapshot) => snapshot.kind).sort(),
  ["account_spine", "budget", "refresh_delta", "source_health"],
);
assert.ok(metadata.snapshots.find((snapshot) => snapshot.kind === "budget")?.record_count > 3000);
assert.ok(metadata.snapshots.find((snapshot) => snapshot.kind === "account_spine")?.record_count > 100);

const budget = await (await get("api/v1/snapshots/budget/current")).json();
assert.ok(budget.payload?.records?.length > 3000);

const spine = await (await get("api/v1/account-spine")).json();
assert.ok(spine.federal_accounts > 100, "account spine should contain Department federal accounts");
assert.ok(spine.exact_tafs_joins > 300, "account spine should preserve exact OMB TAFS joins");

const accounts = await (await get("api/v1/account-spine/accounts?fiscal_year=2026")).json();
assert.ok(accounts.accounts?.length > 100, "account summary API should return the Department account inventory");
const operatingNavy = await (await get("api/v1/account-spine/accounts/017-1804")).json();
assert.ok(operatingNavy.observations.some((row) => row.amount_type === "request" && row.relationship_class === "derived"));
assert.ok(operatingNavy.observations.some((row) => row.amount_type === "apportioned" && row.relationship_class === "exact"));
assert.ok(operatingNavy.observations.some((row) => row.amount_type === "obligated" && row.relationship_class === "exact"));
assert.ok(operatingNavy.observations.some((row) => row.amount_type === "outlayed" && row.relationship_class === "exact"));

const history = await (await get("api/v1/account-spine/history")).json();
assert.ok(history.fiscal_years?.length >= 5, "account spine should preserve at least five agency fiscal years");
assert.ok(history.fiscal_years.every((row) => Number(row.obligated_amount) > 0), "history should expose agency obligations");

const awardFlows = await (await get("api/v1/account-spine/award-flows")).json();
assert.ok(Number(awardFlows.sampled_awards) >= 250, "award flow summary should report the ranked award sample");
assert.ok(Number(awardFlows.linked_awards) >= 180, "award flow summary should report awards with federal-account links");
assert.ok(Number(awardFlows.exact_account_links) >= 400, "award flow summary should preserve exact federal-account links");
const operatingNavyAwards = await (await get("api/v1/account-spine/accounts/017-1804/awards?limit=10")).json();
assert.ok(operatingNavyAwards.awards?.length >= 5, "account award API should return linked awards");
assert.ok(operatingNavyAwards.awards.every((row) => row.relationship_class === "exact" && row.source_uri), "account award rows should retain exact lineage and source URLs");

const home = await (await get("/")).text();
assert.match(home, /Defense Budget & Spend Intelligence/);

const writesDisabled = await fetch(new URL("api/v1/saved-views", baseUrl));
assert.equal(writesDisabled.status, 503, "persistent writes should be disabled by default");

console.log(
  `Verified container API: snapshots=${metadata.snapshots.length} budget_records=${budget.payload.records.length} accounts=${spine.federal_accounts} exact_tafs=${spine.exact_tafs_joins} writes=disabled`,
);
