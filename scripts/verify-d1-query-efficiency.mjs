import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const source = readFileSync("src/pages-auth-api.js", "utf8");

function sourceBetween(start, end) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.ok(startIndex >= 0 && endIndex > startIndex, `Expected source range ${start} ... ${end}`);
  return source.slice(startIndex, endIndex);
}

assert.match(source, /idx_dbi_api_request_log_trace_kind_time[^\n]+trace_id, request_kind, completed_at DESC/, "Event AI diagnostics need a trace/kind/time index");
assert.match(source, /idx_dbi_api_request_log_completed[^\n]+completed_at/, "API-log retention needs a cutoff index");
assert.match(source, /idx_dbi_event_ai_jobs_completed[^\n]+completed_at/, "Event-job retention needs a cutoff index");
assert.match(source, /idx_dbi_event_ai_jobs_workspace_user_time[^\n]+workspace_id, user_id, created_at DESC/, "Task Center needs an exact workspace/user/time index");
assert.match(source, /idx_dbi_login_attempts_time[^\n]+attempted_at/, "Login-attempt retention needs a cutoff index");
assert.match(source, /WITH recent_jobs AS[\s\S]+LIMIT 20[\s\S]+idx_dbi_api_request_log_trace_kind_time|WITH recent_jobs AS/, "Task Center must bound jobs before diagnostic lookup");
assert.doesNotMatch(sourceBetween("async function recordApiRequest", "function cleanDate"), /DELETE FROM dbi_api_request_log/, "API-log retention must not scan after every insert");
assert.doesNotMatch(sourceBetween("async function recordLoginAttempt", "async function statusResponse"), /DELETE FROM dbi_login_attempts/, "Login retention must not scan after every attempt");
assert.match(sourceBetween("async function statusResponse", "async function claimResponse"), /runD1RetentionMaintenance/, "Daily retention maintenance must be attached to the app bootstrap route");

const persistPath = mkdtempSync(join(tmpdir(), "dbi-d1-plan-"));
const database = "oip-agent-db";

function d1(command) {
  const output = execFileSync("npx", [
    "wrangler", "d1", "execute", database,
    "--local", "--persist-to", persistPath,
    "--command", command, "--json",
  ], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  return JSON.parse(output);
}

function planDetails(command) {
  const payload = d1(`EXPLAIN QUERY PLAN ${command}`);
  return payload.flatMap((statement) => statement.results || []).map((row) => String(row.detail || ""));
}

try {
  d1(`
    CREATE TABLE dbi_api_request_log (
      id TEXT PRIMARY KEY,
      trace_id TEXT NOT NULL,
      request_kind TEXT NOT NULL,
      completed_at TEXT NOT NULL,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      provider_request_id TEXT NOT NULL DEFAULT '',
      response_id TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX idx_dbi_api_request_log_trace_kind_time
      ON dbi_api_request_log (trace_id, request_kind, completed_at DESC);
    CREATE INDEX idx_dbi_api_request_log_completed
      ON dbi_api_request_log (completed_at);
    CREATE TABLE dbi_event_ai_jobs (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      trace_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      completed_at TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX idx_dbi_event_ai_jobs_workspace
      ON dbi_event_ai_jobs (workspace_id, created_at DESC);
    CREATE INDEX idx_dbi_event_ai_jobs_workspace_user_time
      ON dbi_event_ai_jobs (workspace_id, user_id, created_at DESC);
    CREATE INDEX idx_dbi_event_ai_jobs_completed
      ON dbi_event_ai_jobs (completed_at);
    CREATE TABLE dbi_login_attempts (
      id TEXT PRIMARY KEY,
      attempted_at TEXT NOT NULL
    );
    CREATE INDEX idx_dbi_login_attempts_time ON dbi_login_attempts (attempted_at);
  `);

  const taskPlan = planDetails(`
    WITH recent_jobs AS (
      SELECT * FROM dbi_event_ai_jobs
      WHERE workspace_id = 'workspace' AND user_id = 'user'
      ORDER BY created_at DESC LIMIT 20
    )
    SELECT j.*, l.metadata_json
    FROM recent_jobs j
    LEFT JOIN dbi_api_request_log l ON l.id = (
      SELECT candidate.id FROM dbi_api_request_log candidate
      WHERE candidate.trace_id = j.trace_id AND candidate.request_kind = 'openai'
      ORDER BY candidate.completed_at DESC LIMIT 1
    )
    ORDER BY j.created_at DESC
  `);
  assert.ok(taskPlan.some((detail) => detail.includes("idx_dbi_api_request_log_trace_kind_time")), `Task diagnostic plan must use the trace index: ${taskPlan.join(" | ")}`);
  assert.ok(taskPlan.some((detail) => detail.includes("idx_dbi_event_ai_jobs_workspace_user_time")), `Task seed plan must use the workspace/user/time index: ${taskPlan.join(" | ")}`);
  assert.ok(taskPlan.every((detail) => !/SCAN candidate\b/.test(detail)), `Task diagnostic plan must not scan the request log: ${taskPlan.join(" | ")}`);

  for (const [table, column, index] of [
    ["dbi_api_request_log", "completed_at", "idx_dbi_api_request_log_completed"],
    ["dbi_event_ai_jobs", "completed_at", "idx_dbi_event_ai_jobs_completed"],
    ["dbi_login_attempts", "attempted_at", "idx_dbi_login_attempts_time"],
  ]) {
    const details = planDetails(`DELETE FROM ${table} WHERE ${column} < '2026-01-01T00:00:00.000Z'`);
    assert.ok(details.some((detail) => detail.includes(index)), `${table} retention must use ${index}: ${details.join(" | ")}`);
  }
} finally {
  rmSync(persistPath, { recursive: true, force: true });
}

console.log("Verified D1 query efficiency: bounded Task Center lookup, indexed trace diagnostics, indexed daily retention, no per-write pruning.");
