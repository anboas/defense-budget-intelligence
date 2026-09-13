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
  ["account_spine", "budget", "capture_calendar", "refresh_delta", "source_health", "usaspending_subawards"],
);
assert.ok(metadata.snapshots.find((snapshot) => snapshot.kind === "budget")?.record_count > 3000);
assert.ok(metadata.snapshots.find((snapshot) => snapshot.kind === "account_spine")?.record_count > 100);
assert.equal(metadata.snapshots.find((snapshot) => snapshot.kind === "capture_calendar")?.record_count, 198);
assert.ok(metadata.snapshots.find((snapshot) => snapshot.kind === "usaspending_subawards")?.record_count > 0);

const budget = await (await get("api/v1/snapshots/budget/current")).json();
assert.ok(budget.payload?.records?.length > 3000);
const captureCalendar = await (await get("api/v1/snapshots/capture_calendar/current")).json();
assert.equal(captureCalendar.payload?.records?.length, 198);
assert.equal(captureCalendar.payload?.metadata?.coverage?.excludedPrivateRows, 45);
assert.equal(captureCalendar.payload?.metadata?.coverage?.normalizedEvents, 502);
assert.equal(captureCalendar.payload?.metadata?.coverage?.fpdsActions, 3085);
assert.equal(captureCalendar.payload?.metadata?.coverage?.awardsWithPricingType, 113);
assert.equal(captureCalendar.payload?.metadata?.coverage?.awardsWithAwardType, 11);
assert.equal(captureCalendar.payload?.metadata?.coverage?.rowsWithVehicle, 60);
assert.equal(captureCalendar.payload?.metadata?.coverage?.rowsWithCompetition, 119);
assert.ok(captureCalendar.payload.records.every((record) => record.opportunityId && !("statusLabel" in record) && !("note" in record) && !("targetIds" in record) && !("captureMotion" in record)), "capture snapshot should use stable IDs and exclude internal parser fields");

const normalizedCapture = await (await get("api/v1/capture-calendar")).json();
assert.ok(normalizedCapture.opportunities >= 875, "normalized capture API should expose the current baseline and permit automatic feed growth");
assert.ok(normalizedCapture.automated_imports >= 677, "normalized capture API should retain the automated USAspending baseline and permit new feeds");
assert.ok(normalizedCapture.classified_records >= 632, "normalized capture API should report records with a specific work category");
assert.ok(normalizedCapture.source_channels >= 1056, "normalized capture API should preserve every disclosed ingestion channel");
assert.ok(normalizedCapture.events >= 502, "normalized capture API should expose every canonical event and permit new SAM events");
assert.equal(normalizedCapture.actions, 3085, "normalized capture API should expose every exact FPDS action");
assert.equal(normalizedCapture.instruments, 134, "normalized capture API should preserve primary and supporting instruments");
assert.ok(Number(normalizedCapture.reported_subawards) > 0, "normalized capture API should report exact prime-linked subaward totals");
assert.ok(normalizedCapture.retained_subaward_details > 0, "normalized capture API should persist recent subaward details");
const applicationArsenal = await (await get("api/v1/capture-calendar/opportunities/opp_4d78f85a742aeb6f4b59")).json();
assert.equal(applicationArsenal.id, "C028");
assert.equal(applicationArsenal.transactionSummary.actions, 20);
const applicationArsenalActions = await (await get("api/v1/capture-calendar/opportunities/opp_4d78f85a742aeb6f4b59/actions")).json();
assert.equal(applicationArsenalActions.actions.length, 20, "action API should return exact Application Arsenal history");
assert.ok(applicationArsenalActions.actions.every((action) => action.actionId && action.piid === "N6600123F3509"), "action API should preserve exact PIID lineage");
const applicationArsenalFollowOn = await (await get("api/v1/capture-calendar/opportunities/opp_30dde3dd926e0c206843")).json();
assert.equal(applicationArsenalFollowOn.id, "P-N24");
assert.equal(applicationArsenalFollowOn.parentReference, "N6600123F3509", "Application Arsenal follow-on should retain its labeled predecessor crosswalk");
assert.equal(applicationArsenalFollowOn.solicitationStart, "2026-08-31");
assert.equal(applicationArsenalFollowOn.solicitationEnd, "2026-09-30");
assert.match(applicationArsenalFollowOn.competitionType, /full and open/i);
assert.match(applicationArsenalFollowOn.eligibility, /SeaPort NxG contract holders only/i);
assert.match(applicationArsenalFollowOn.pricingType, /CPFF/i);
const submarinePrimeId = "auto_usaspending_CONT_AWD_N0002417C2100_9700__NONE___NONE_";
const submarinePrime = await (await get(`api/v1/capture-calendar/opportunities/${submarinePrimeId}`)).json();
assert.ok(submarinePrime.subawardSummary?.reportedCount > 0, "prime award should retain exact subaward summary");
const submarineSubawards = await (await get(`api/v1/capture-calendar/opportunities/${submarinePrimeId}/subawards`)).json();
assert.equal(submarineSubawards.summary.primeAwardId, "CONT_AWD_N0002417C2100_9700_-NONE-_-NONE-");
assert.ok(submarineSubawards.subawards.length > 0, "subaward API should return retained exact-prime detail rows");
assert.ok(submarineSubawards.subawards.every((row) => row.primeAwardId === submarineSubawards.summary.primeAwardId));

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
assert.match(home, /Defense Budget & Spend Analytics/);

const writesDisabled = await fetch(new URL("api/v1/saved-views", baseUrl));
assert.equal(writesDisabled.status, 503, "persistent writes should be disabled by default");

console.log(
  `Verified container API: snapshots=${metadata.snapshots.length} source_capture_records=${captureCalendar.payload.records.length} normalized_opportunities=${normalizedCapture.opportunities} automated_imports=${normalizedCapture.automated_imports} capture_events=${normalizedCapture.events} fpds_actions=${normalizedCapture.actions} reported_subawards=${normalizedCapture.reported_subawards} retained_subaward_details=${normalizedCapture.retained_subaward_details} accounts=${spine.federal_accounts} exact_tafs=${spine.exact_tafs_joins} writes=disabled`,
);
