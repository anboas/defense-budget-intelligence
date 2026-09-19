import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import { access } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { closePool, createPool } from "./db.mjs";
import { migrate } from "./migrate.mjs";
import {
  importCommittedSnapshots,
  latestSnapshot,
  latestSnapshotMetadata,
} from "./snapshots.mjs";
import { registerStateRoutes } from "./state-routes.mjs";
import { importAccountSpine, registerAccountSpineRoutes } from "./account-spine.mjs";
import { importCaptureCalendar, registerCaptureCalendarRoutes } from "./capture-calendar.mjs";
import { registerAuthRoutes, runAuthRetentionMaintenance } from "./auth-routes.mjs";
import { registerClientErrorRoutes } from "./client-error-routes.mjs";
import { MAX_JSON_BODY_BYTES, securityHeadersForPath } from "../src/security-policy.js";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const DIST_ROOT = resolve(ROOT, "dist");
const SNAPSHOT_KINDS = new Set(["budget", "source_health", "refresh_delta", "account_spine", "capture_calendar", "usaspending_subawards", "contract_monitor"]);
const app = Fastify({
  bodyLimit: MAX_JSON_BODY_BYTES,
  connectionTimeout: 10_000,
  keepAliveTimeout: 5_000,
  logger: {
    level: process.env.LOG_LEVEL || "info",
    redact: ["req.headers.authorization", "request.headers.authorization", "req.headers.cookie", "request.headers.cookie"],
  },
  maxParamLength: 200,
  onConstructorPoisoning: "error",
  onProtoPoisoning: "error",
  requestTimeout: 60_000,
  trustProxy: Math.max(0, Number(process.env.TRUST_PROXY_HOPS || 1)),
});
const pool = createPool();

await migrate(pool);
await runAuthRetentionMaintenance(pool);
const imported = await importCommittedSnapshots(pool);
app.log.info({ imported }, "committed intelligence snapshots synchronized");
const accountSpine = await importAccountSpine(pool);
app.log.info({ accountSpine }, "normalized account spine synchronized");
const captureCalendar = await importCaptureCalendar(pool);
app.log.info({ captureCalendar }, "normalized capture calendar synchronized");

app.addHook("onSend", async (request, reply) => {
  const pathname = request.url.split("?")[0];
  for (const [name, value] of Object.entries(securityHeadersForPath(pathname))) reply.header(name, value);
});

app.setErrorHandler((error, request, reply) => {
  request.log.error({ err: error }, "request failed");
  const status = Number(error.statusCode || 500);
  return reply.code(status).send({ error: status < 500 ? error.message : "request could not be completed" });
});

app.get("/api/healthz", async () => ({ status: "ok" }));
app.get("/api/readyz", async (_request, reply) => {
  try {
    await pool.query("SELECT 1");
    return { status: "ready" };
  } catch {
    return reply.code(503).send({ status: "unavailable" });
  }
});

await registerClientErrorRoutes(app, pool);
await registerAuthRoutes(app, pool);

app.get("/api/v1/snapshots", async () => ({ snapshots: await latestSnapshotMetadata(pool) }));
app.get("/api/v1/snapshots/:kind/current", async (request, reply) => {
  const kind = request.params.kind;
  if (!SNAPSHOT_KINDS.has(kind)) {
    return reply.code(404).send({ error: "snapshot kind not found" });
  }
  const snapshot = await latestSnapshot(pool, kind);
  if (!snapshot) {
    return reply.code(404).send({ error: "snapshot not available" });
  }
  return snapshot;
});

await registerStateRoutes(app, pool);
await registerAccountSpineRoutes(app, pool);
await registerCaptureCalendarRoutes(app, pool);

await access(resolve(DIST_ROOT, "index.html"));
await app.register(fastifyStatic, {
  root: DIST_ROOT,
  prefix: "/",
});

app.setNotFoundHandler((request, reply) => {
  if (request.url.startsWith("/api/")) {
    return reply.code(404).send({ error: "not found" });
  }
  return reply.type("text/html; charset=utf-8").sendFile("index.html");
});

const close = async (signal) => {
  app.log.info({ signal }, "shutting down");
  await app.close();
  await closePool(pool);
  process.exit(0);
};
process.on("SIGTERM", () => void close("SIGTERM"));
process.on("SIGINT", () => void close("SIGINT"));

await app.listen({
  host: process.env.HOST || "0.0.0.0",
  port: Number(process.env.PORT || 8080),
});
