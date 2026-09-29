import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeLocationBranch } from "../src/opportunity-map-domain.js";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const sourcePath = process.argv[2] ? resolve(process.argv[2]) : null;
const outputPath = resolve(ROOT, "src/data/opportunity-map-locations.json");

if (!sourcePath) {
  throw new Error("Usage: node scripts/import-opportunity-map-locations.mjs /absolute/path/to/map-records.json");
}

const source = JSON.parse(readFileSync(sourcePath, "utf8"));
if (!Array.isArray(source) || source.length < 885) {
  throw new Error(`Opportunity Map location import requires the complete 885-record snapshot, received ${source?.length ?? "invalid"}`);
}

const ids = new Set();
const locations = source.map((record) => {
  if (!record?.id || !record?.name || !Number.isFinite(record?.lat) || !Number.isFinite(record?.lon)) {
    throw new Error(`Invalid map location record: ${JSON.stringify({ id: record?.id, name: record?.name, lat: record?.lat, lon: record?.lon })}`);
  }
  if (ids.has(record.id)) throw new Error(`Duplicate map location id: ${record.id}`);
  ids.add(record.id);
  const sourceEntry = record.profile?.evidence?.sources?.[0] || {};
  return {
    id: record.id,
    name: record.name,
    city: record.city || "",
    state: record.state || "",
    latitude: record.lat,
    longitude: record.lon,
    branch: normalizeLocationBranch(record.category),
    kind: record.type || record.profile?.entityKind || "location",
    recordSet: record.recordSet || "curated",
    inventoryStatus: record.sourceStatusCode === "act" ? "active_inventory" : (record.profile?.evidence?.status === "reviewed" ? "reviewed" : "unverified"),
    evidenceStatus: record.profile?.evidence?.status || (record.sourceDataset ? "historical" : "curated"),
    buyerRole: record.profile?.buyingPower?.applicability?.status || "unassessed",
    officeCodes: [...new Set(record.profile?.buyingPower?.contractingOfficeIds || [])].sort(),
    sourceDataset: record.sourceDataset || sourceEntry.publisher || "Curated defense location source",
    sourceReferencePeriod: record.sourceReferencePeriod || record.profile?.evidence?.referencePeriod || "Not specified",
    sourceUrl: record.sourceUrl || sourceEntry.url || record.organizations?.[0]?.url || null,
    coordinatePrecision: record.profile?.location?.precision || record.coordinateMethod || "approximate",
  };
});

const snapshot = {
  metadata: {
    schemaVersion: "1.0.0",
    recordCount: locations.length,
    auditedAt: "2026-09-28",
    sourceScope: "Curated defense organizations plus the BTS/DoD FY2024 installation inventory. Coordinates are approximate source points, not entrances.",
  },
  locations,
};

writeFileSync(outputPath, JSON.stringify(snapshot));
console.log(`Wrote ${locations.length} authoritative map locations to ${outputPath}`);
