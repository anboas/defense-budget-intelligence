import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";

const suffix = `${Date.now()}_${randomBytes(4).toString("hex")}`;
const database = `dbi_auth_verify_${suffix}`;
const container = `dbi-auth-verify-${suffix.replaceAll("_", "-")}`;
const encryptionKey = randomBytes(32).toString("base64url");

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: new URL("..", import.meta.url), stdio: "inherit", ...options });
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed with status ${result.status}`);
}

try {
  run("docker", ["compose", "up", "--detach", "--wait", "db"]);
  run("docker", ["compose", "build", "app"]);
  run("docker", ["compose", "exec", "-T", "db", "createdb", "-U", "postgres", database]);
  run("docker", [
    "compose", "run", "--rm", "--detach", "--name", container,
    "-e", "ENABLE_AUTH=true",
    "-e", "AUTH_REQUIRE_LOGIN=true",
    "-e", "AUTH_SECURE_COOKIE=false",
    "-e", "DBI_CREDENTIAL_ENCRYPTION_KEY",
    "-e", `DATABASE_URL=postgresql://postgres@db:5432/${database}`,
    "-e", "PORT=8081",
    "-p", "18081:8081",
    "app",
  ], { env: { ...process.env, DBI_CREDENTIAL_ENCRYPTION_KEY: encryptionKey } });
  run(process.execPath, ["scripts/verify-postgres-auth.mjs"], {
    env: { ...process.env, BUDGET_POSTGRES_AUTH_VERIFY_URL: "http://127.0.0.1:18081/" },
  });
} finally {
  spawnSync("docker", ["rm", "--force", container], { cwd: new URL("..", import.meta.url), stdio: "ignore" });
  spawnSync("docker", ["compose", "exec", "-T", "db", "dropdb", "--if-exists", "-U", "postgres", database], { cwd: new URL("..", import.meta.url), stdio: "ignore" });
}
