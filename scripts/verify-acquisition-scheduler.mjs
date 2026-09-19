import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import scheduler from "../workers/acquisition-scheduler.js";

const config = readFileSync("wrangler.scheduler.toml", "utf8");
assert.match(config, /crons\s*=\s*\["17 \* \* \* \*"\]/, "The acquisition scheduler must run hourly at a stable offset");
assert.match(config, /DBI_APP_ORIGIN\s*=\s*"https:\/\/defense-budget-intelligence\.pages\.dev"/, "The scheduler must target the production application boundary");

const originalFetch = globalThis.fetch;
let request;
globalThis.fetch = async (url, options) => {
  request = { url: String(url), options };
  return Response.json({ keyedWorkspaces: 0, dueWorkspaces: 0, executed: 0 });
};
try {
  let task;
  await scheduler.scheduled({}, { DBI_APP_ORIGIN: "https://defense-budget-intelligence.pages.dev", DBI_SCHEDULER_TOKEN: "verification-scheduler-token-000000000001" }, { waitUntil: (promise) => { task = promise; } });
  const result = await task;
  assert.equal(result.executed, 0);
  assert.equal(request.url, "https://defense-budget-intelligence.pages.dev/api/v1/system/acquisition-schedule");
  assert.equal(request.options.method, "POST");
  assert.match(request.options.headers.authorization, /^Bearer /);
  const publicResponse = await scheduler.fetch();
  assert.equal(publicResponse.status, 405, "The scheduler worker must not expose a public manual-trigger surface");
} finally {
  globalThis.fetch = originalFetch;
}

console.log("Verified hourly acquisition trigger, protected endpoint handoff, and closed public trigger surface.");
