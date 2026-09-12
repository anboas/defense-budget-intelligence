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

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const DIST_ROOT = resolve(ROOT, "dist");
const SNAPSHOT_KINDS = new Set(["budget", "source_health", "refresh_delta"]);
const app = Fastify({
  logger: {
    level: process.env.LOG_LEVEL || "info",
    redact: ["req.headers.authorization", "request.headers.authorization"],
  },
  trustProxy: true,
});
const pool = createPool();

await migrate(pool);
const imported = await importCommittedSnapshots(pool);
app.log.info({ imported }, "committed intelligence snapshots synchronized");

app.addHook("onSend", async (_request, reply) => {
  reply.header("x-content-type-options", "nosniff");
  reply.header("referrer-policy", "strict-origin-when-cross-origin");
  reply.header("x-frame-options", "DENY");
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

await access(resolve(DIST_ROOT, "index.html"));
await app.register(fastifyStatic, {
  root: DIST_ROOT,
  prefix: "/",
  wildcard: false,
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
