import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const suffix = `${Date.now()}_${randomBytes(4).toString("hex")}`;
const sourceDb = `dbi_recovery_source_${suffix}`;
const targetDb = `dbi_recovery_target_${suffix}`;
const working = await mkdtemp(join(tmpdir(), "dbi-postgres-recovery-"));
const dumpPath = join(working, "postgres.dump");
const startedAt = Date.now();

function run(args, options = {}) {
  const result = spawnSync("docker", ["compose", ...args], {
    cwd: root,
    encoding: options.encoding ?? "utf8",
    input: options.input,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.status !== 0) throw new Error(`${result.stdout || ""}\n${result.stderr || ""}`.trim());
  return result.stdout;
}

function psql(database, command) {
  return run(["exec", "-T", "db", "psql", "-U", "postgres", "-d", database, "-v", "ON_ERROR_STOP=1", "-Atc", command]).trim();
}

try {
  run(["up", "--detach", "--wait", "db"]);
  run(["exec", "-T", "db", "createdb", "-U", "postgres", sourceDb]);
  run(["run", "--rm", "-e", `DATABASE_URL=postgresql://postgres@db:5432/${sourceDb}`, "app", "node", "server/migrate.mjs"]);
  psql(sourceDb, "CREATE TABLE recovery_probe (id text PRIMARY KEY, payload text NOT NULL, created_at timestamptz NOT NULL DEFAULT NOW()); INSERT INTO recovery_probe(id,payload) VALUES ('sentinel','verified');");
  const sourceTables = Number(psql(sourceDb, "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='public';"));
  const dump = run(["exec", "-T", "db", "pg_dump", "-U", "postgres", "-d", sourceDb, "--format=plain", "--no-owner", "--no-privileges"]);
  await writeFile(dumpPath, dump);
  run(["exec", "-T", "db", "createdb", "-U", "postgres", targetDb]);
  run(["exec", "-T", "db", "psql", "-U", "postgres", "-d", targetDb, "-v", "ON_ERROR_STOP=1"], { input: dump });
  const targetTables = Number(psql(targetDb, "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='public';"));
  assert.equal(targetTables, sourceTables, "Restored PostgreSQL schema must retain every public table");
  assert.equal(psql(targetDb, "SELECT payload FROM recovery_probe WHERE id='sentinel';"), "verified", "Restored PostgreSQL must retain the recovery sentinel");
  assert.equal(psql(targetDb, "SELECT COUNT(*) FROM schema_migrations;"), psql(sourceDb, "SELECT COUNT(*) FROM schema_migrations;"), "Migration evidence must survive restore");
  console.log("PostgreSQL recovery contract passed", { tables: targetTables, recoveryTimeMs: Date.now() - startedAt, evidenceDirectory: working });
} finally {
  spawnSync("docker", ["compose", "exec", "-T", "db", "dropdb", "--if-exists", "-U", "postgres", targetDb], { cwd: root, stdio: "ignore" });
  spawnSync("docker", ["compose", "exec", "-T", "db", "dropdb", "--if-exists", "-U", "postgres", sourceDb], { cwd: root, stdio: "ignore" });
}
