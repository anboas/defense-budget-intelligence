import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

const SNAPSHOT_FILES = [
  { kind: "budget", path: "src/data/budget-intelligence.json" },
  { kind: "source_health", path: "src/data/source-health.json" },
  { kind: "refresh_delta", path: "src/data/refresh-delta.json" },
];

function capturedAt(kind, payload) {
  if (kind === "budget") return payload.metadata?.generatedAt;
  if (kind === "source_health") return payload.metadata?.checkedAt;
  return payload.metadata?.generatedAt;
}

function recordCount(kind, payload) {
  if (kind === "budget") return payload.records?.length || 0;
  if (kind === "source_health") return payload.sources?.length || 0;
  return ["budgetChanges", "awardChanges", "queueChanges", "sourceChanges"]
    .reduce((total, key) => total + (payload[key]?.length || 0), 0);
}

export async function importCommittedSnapshots(pool) {
  const imported = [];
  for (const snapshot of SNAPSHOT_FILES) {
    const absolutePath = resolve(ROOT, snapshot.path);
    const raw = await readFile(absolutePath, "utf8");
    const payload = JSON.parse(raw);
    const sourceHash = createHash("sha256").update(raw).digest("hex");
    const captured = capturedAt(snapshot.kind, payload);
    if (!captured || Number.isNaN(Date.parse(captured))) {
      throw new Error(`${snapshot.path} does not contain a valid capture timestamp`);
    }

    const result = await pool.query(
      `INSERT INTO intelligence_snapshots
        (kind, source_hash, captured_at, record_count, source_uri, payload)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb)
       ON CONFLICT (kind, source_hash) DO NOTHING
       RETURNING id`,
      [
        snapshot.kind,
        sourceHash,
        captured,
        recordCount(snapshot.kind, payload),
        snapshot.path,
        raw,
      ],
    );
    imported.push({ kind: snapshot.kind, imported: result.rowCount === 1 });
  }
  return imported;
}

export async function latestSnapshotMetadata(pool) {
  const result = await pool.query(`
    SELECT DISTINCT ON (kind)
      id, kind, source_hash, captured_at, imported_at, record_count, source_uri
    FROM intelligence_snapshots
    ORDER BY kind, captured_at DESC, imported_at DESC
  `);
  return result.rows;
}

export async function latestSnapshot(pool, kind) {
  const result = await pool.query(
    `SELECT id, kind, source_hash, captured_at, imported_at, record_count, source_uri, payload
     FROM intelligence_snapshots
     WHERE kind = $1
     ORDER BY captured_at DESC, imported_at DESC
     LIMIT 1`,
    [kind],
  );
  return result.rows[0] || null;
}
