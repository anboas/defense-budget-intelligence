import { readFile, writeFile } from "node:fs/promises";

const MAX_STATEMENT_CHARS = 60_000;
const SNAPSHOT_INSERT = 'INSERT INTO "oip_workspace_snapshots"';

function splitSqlValues(source) {
  const valuesAt = source.indexOf(" VALUES(");
  if (valuesAt < 0 || !source.endsWith(");")) return null;
  const prefix = source.slice(0, valuesAt + 8);
  const body = source.slice(valuesAt + 8, -2);
  const values = [];
  let start = 0;
  let quoted = false;
  for (let index = 0; index < body.length; index += 1) {
    if (body[index] === "'") {
      if (quoted && body[index + 1] === "'") index += 1;
      else quoted = !quoted;
    } else if (body[index] === "," && !quoted) {
      values.push(body.slice(start, index));
      start = index + 1;
    }
  }
  values.push(body.slice(start));
  return { prefix, values };
}

function decodeLiteral(value) {
  if (!value.startsWith("'") || !value.endsWith("'")) throw new Error("Expected a quoted SQL literal");
  return value.slice(1, -1).replaceAll("''", "'");
}

function quoteLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function normalizeWorkspaceSnapshotInsert(line) {
  const parsed = splitSqlValues(line);
  if (!parsed || parsed.values.length !== 8) throw new Error("Unexpected oip_workspace_snapshots export shape");
  const workspaceId = decodeLiteral(parsed.values[0]);
  const payload = decodeLiteral(parsed.values[3]);
  const baseValues = [...parsed.values];
  baseValues[3] = "''";
  const statements = [`${parsed.prefix}${baseValues.join(",")});`];
  for (let offset = 0; offset < payload.length; offset += MAX_STATEMENT_CHARS) {
    const chunk = payload.slice(offset, offset + MAX_STATEMENT_CHARS);
    statements.push(`UPDATE "oip_workspace_snapshots" SET "payload_json"="payload_json"||${quoteLiteral(chunk)} WHERE "workspace_id"=${quoteLiteral(workspaceId)};`);
  }
  return statements;
}

export function normalizeD1Export(source) {
  const statements = [];
  let rewrittenStatements = 0;
  for (const line of String(source).split("\n")) {
    if (line.startsWith(SNAPSHOT_INSERT) && line.length > MAX_STATEMENT_CHARS) {
      statements.push(...normalizeWorkspaceSnapshotInsert(line));
      rewrittenStatements += 1;
    } else {
      statements.push(line);
    }
  }
  const longestStatement = Math.max(...statements.map((line) => line.length));
  return { sql: statements.join("\n"), rewrittenStatements, longestStatement };
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const [inputPath, outputPath] = process.argv.slice(2);
  if (!inputPath || !outputPath) throw new Error("Usage: node scripts/d1-restore-normalizer.mjs <export.sql> <restore.sql>");
  const normalized = normalizeD1Export(await readFile(inputPath, "utf8"));
  await writeFile(outputPath, normalized.sql);
  console.log(JSON.stringify({ rewrittenStatements: normalized.rewrittenStatements, longestStatement: normalized.longestStatement }));
}
