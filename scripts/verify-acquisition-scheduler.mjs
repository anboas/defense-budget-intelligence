import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import scheduler from "../workers/acquisition-scheduler.js";

const config = readFileSync("wrangler.scheduler.toml", "utf8");
assert.match(config, /crons\s*=\s*\["17 \* \* \* \*"\]/, "The acquisition scheduler must run hourly at a stable offset");
assert.match(config, /DBI_APP_ORIGIN\s*=\s*"https:\/\/defense-budget-intelligence\.pages\.dev"/, "The scheduler must target the production application boundary");

const originalFetch = globalThis.fetch;
const requests = [];
globalThis.fetch = async (url, options) => {
  requests.push({ url: String(url), options });
  return String(url).includes("event-discovery")
    ? Response.json({ sourcesAttempted: 2, succeeded: 2 })
    : Response.json({ keyedWorkspaces: 0, dueWorkspaces: 0, executed: 0 });
};
try {
  let task;
  await scheduler.scheduled({}, { DBI_APP_ORIGIN: "https://defense-budget-intelligence.pages.dev", DBI_SCHEDULER_TOKEN: "verification-scheduler-token-000000000001" }, { waitUntil: (promise) => { task = promise; } });
  const result = await task;
  assert.equal(result.acquisition.executed, 0);
  assert.equal(result.eventDiscovery.succeeded, 2);
  assert.deepEqual(requests.map((request) => request.url).sort(), [
    "https://defense-budget-intelligence.pages.dev/api/v1/system/acquisition-schedule",
    "https://defense-budget-intelligence.pages.dev/api/v1/system/event-discovery-schedule",
  ]);
  assert.ok(requests.every((request) => request.options.method === "POST"));
  assert.ok(requests.every((request) => /^Bearer /.test(request.options.headers.authorization)));
  const publicResponse = await scheduler.fetch();
  assert.equal(publicResponse.status, 405, "The scheduler worker must not expose a public manual-trigger surface");
} finally {
  globalThis.fetch = originalFetch;
}

console.log("Verified hourly acquisition and event-discovery triggers, protected endpoint handoff, and closed public trigger surface.");
