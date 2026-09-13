import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { enrichSourceRecord } from "../src/procurement-taxonomy.js";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const file = resolve(ROOT, "src/data/capture-calendar.json");
const payload = JSON.parse(readFileSync(file, "utf8"));
payload.records = (payload.records || []).map((record) => enrichSourceRecord(record));
payload.metadata.coverage.rowsWithWorkCategory = payload.records.filter((record) => record.workCategory && record.workCategory !== "other-unclassified").length;
payload.metadata.coverage.workCategories = new Set(payload.records.flatMap((record) => record.workCategories || [])).size;
payload.metadata.coverage.rowsWithIngestionProvenance = payload.records.filter((record) => record.ingestionMethod).length;
writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`);
console.log(`Enriched ${payload.records.length} capture rows with ${payload.metadata.coverage.rowsWithWorkCategory} classified work types and ${payload.metadata.coverage.rowsWithIngestionProvenance} provenance records`);
