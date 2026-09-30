import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { normalizeD1Export } from "./d1-restore-normalizer.mjs";

const root = resolve(import.meta.dirname, "..");
const suppliedExport = process.argv.find((arg) => arg.startsWith("--export="))?.slice(9);
const working = await mkdtemp(join(tmpdir(), "dbi-d1-recovery-"));
const persist = join(working, "persist");
const sourcePath = suppliedExport ? resolve(suppliedExport) : join(working, "fixture.sql");
const restorePath = join(working, "restore.sql");
const database = "oip-agent-db";
const payload = JSON.stringify({ marker: randomBytes(16).toString("hex"), data: "x".repeat(220_000) });
const payloadHash = createHash("sha256").update(payload).digest("hex");

function sql(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function runWrangler(args) {
  const result = spawnSync("npm", ["exec", "wrangler", "--", ...args], { cwd: root, encoding: "utf8", maxBuffer: 20 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`${result.stdout}\n${result.stderr}`.trim());
  return result.stdout;
}

if (!suppliedExport) {
  await writeFile(sourcePath, [
    "CREATE TABLE oip_workspace_snapshots (workspace_id TEXT PRIMARY KEY, revision INTEGER NOT NULL, schema_version INTEGER NOT NULL, payload_json TEXT NOT NULL, payload_sha256 TEXT NOT NULL, updated_by TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);",
    `INSERT INTO "oip_workspace_snapshots" ("workspace_id","revision","schema_version","payload_json","payload_sha256","updated_by","created_at","updated_at") VALUES(${sql("recovery-fixture")},1,1,${sql(payload)},${sql(payloadHash)},'recovery','2026-09-19T00:00:00.000Z','2026-09-19T00:00:00.000Z');`,
    "CREATE TABLE dbi_users (user_id TEXT PRIMARY KEY, email TEXT NOT NULL);",
    "INSERT INTO dbi_users (user_id,email) VALUES('recovery-user','recovery@example.invalid');",
    "CREATE TABLE dbi_intelligence_proposals (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, proposal_json TEXT NOT NULL);",
    "INSERT INTO dbi_intelligence_proposals VALUES('proposal-recovery','workspace-recovery','{\"claim\":\"retained\"}');",
    "CREATE TABLE dbi_intelligence_sources (source_id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, url TEXT NOT NULL);",
    "INSERT INTO dbi_intelligence_sources VALUES('source-recovery','workspace-recovery','https://example.invalid/source');",
    "CREATE TABLE dbi_intelligence_entities (entity_id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, payload_json TEXT NOT NULL);",
    "INSERT INTO dbi_intelligence_entities VALUES('workspace:organization:recovery','workspace-recovery','{\"label\":\"Recovery\"}');",
    "CREATE TABLE dbi_intelligence_claims (claim_id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, value_json TEXT NOT NULL);",
    "INSERT INTO dbi_intelligence_claims VALUES('claim-recovery','workspace-recovery','{\"value\":1}');",
    "CREATE TABLE dbi_intelligence_relations (relation_id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, evidence_json TEXT NOT NULL);",
    "INSERT INTO dbi_intelligence_relations VALUES('relation-recovery','workspace-recovery','{\"source\":\"source-recovery\"}');",
    "CREATE TABLE dbi_intelligence_jobs (job_id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, output_json TEXT NOT NULL);",
    "INSERT INTO dbi_intelligence_jobs VALUES('job-recovery','workspace-recovery','{\"status\":\"completed\"}');",
  ].join("\n"));
}

const source = await readFile(sourcePath, "utf8");
const normalized = normalizeD1Export(source);
await writeFile(restorePath, normalized.sql);
assert.ok(normalized.longestStatement < 65_000, `Restore statement exceeded the bounded D1 size: ${normalized.longestStatement}`);
runWrangler(["d1", "execute", database, "--local", "--persist-to", persist, "--file", restorePath, "--yes"]);

const query = suppliedExport
  ? "SELECT COUNT(*) AS users FROM dbi_users; SELECT COUNT(*) AS workspaces FROM dbi_workspaces; SELECT COUNT(*) AS migrations FROM dbi_schema_migrations; SELECT COUNT(*) AS intelligence_tables FROM sqlite_master WHERE type='table' AND name LIKE 'dbi_intelligence_%';"
  : "SELECT length(payload_json) AS payload_length, payload_sha256 FROM oip_workspace_snapshots WHERE workspace_id='recovery-fixture'; SELECT COUNT(*) AS users FROM dbi_users; SELECT (SELECT COUNT(*) FROM dbi_intelligence_proposals)+(SELECT COUNT(*) FROM dbi_intelligence_sources)+(SELECT COUNT(*) FROM dbi_intelligence_entities)+(SELECT COUNT(*) FROM dbi_intelligence_claims)+(SELECT COUNT(*) FROM dbi_intelligence_relations)+(SELECT COUNT(*) FROM dbi_intelligence_jobs) AS intelligence_rows;";
const output = runWrangler(["d1", "execute", database, "--local", "--persist-to", persist, "--command", query, "--json"]);
const parsed = JSON.parse(output.slice(output.indexOf("[")));
if (suppliedExport) {
  assert.ok(Number(parsed[0]?.results?.[0]?.users || 0) > 0, "Restored D1 must retain users");
  assert.ok(Number(parsed[1]?.results?.[0]?.workspaces || 0) > 0, "Restored D1 must retain workspaces");
  assert.ok(Number(parsed[2]?.results?.[0]?.migrations || 0) > 0, "Restored D1 must retain migration evidence");
  assert.ok(Number(parsed[3]?.results?.[0]?.intelligence_tables || 0) >= 6, "Restored D1 must retain Agent API intelligence overlay tables");
} else {
  assert.equal(Number(parsed[0]?.results?.[0]?.payload_length), payload.length, "Oversized snapshot payload must restore exactly");
  assert.equal(parsed[0]?.results?.[0]?.payload_sha256, payloadHash, "Oversized snapshot digest must survive restore");
  assert.equal(Number(parsed[1]?.results?.[0]?.users), 1, "Fixture user must survive restore");
  assert.equal(Number(parsed[2]?.results?.[0]?.intelligence_rows), 6, "Agent intelligence proposals, sources, entities, claims, relations, and jobs must survive restore");
}

console.log("D1 recovery contract passed", {
  mode: suppliedExport ? "export" : "fixture",
  rewrittenStatements: normalized.rewrittenStatements,
  longestStatement: normalized.longestStatement,
  evidenceDirectory: working,
});
