import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  LOCATION_METADATA_PASSES,
  OPPORTUNITY_MAP_LOCATION_METADATA_VERSION,
  normalizeLocationBranch,
} from "../src/opportunity-map-domain.js";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const sourcePath = process.argv[2] ? resolve(process.argv[2]) : null;
const outputPath = resolve(ROOT, "src/data/opportunity-map-locations.json");
const metadataOutputPath = resolve(ROOT, "src/data/opportunity-map-location-metadata.json");

if (!sourcePath) {
  throw new Error("Usage: node scripts/import-opportunity-map-locations.mjs /absolute/path/to/map-records.json");
}

const source = JSON.parse(readFileSync(sourcePath, "utf8"));
if (!Array.isArray(source) || source.length < 885) {
  throw new Error(`Opportunity Map location import requires the complete 885-record snapshot, received ${source?.length ?? "invalid"}`);
}

const ids = new Set();
const metadataProfiles = {};
const stateForReviewedEvidence = (status) => ["reviewed", "linked", "company_listed"].includes(status) ? "reviewed" : "source_snapshot";
const financialState = (status) => {
  if (["financial_evidence_found", "documented"].includes(status)) return "reviewed";
  if (["parent_scope_only", "not_publicly_quantified"].includes(status)) return "screened";
  if (status === "not_applicable") return "not_applicable";
  return "not_assessed";
};

const locations = source.map((record) => {
  if (!record?.id || !record?.name || !Number.isFinite(record?.lat) || !Number.isFinite(record?.lon)) {
    throw new Error(`Invalid map location record: ${JSON.stringify({ id: record?.id, name: record?.name, lat: record?.lat, lon: record?.lon })}`);
  }
  if (ids.has(record.id)) throw new Error(`Duplicate map location id: ${record.id}`);
  ids.add(record.id);
  const evidence = record.profile?.evidence || {};
  const location = record.profile?.location || {};
  const applicability = record.profile?.buyingPower?.applicability || {};
  const financial = applicability.financialResearch || {};
  const context = record.profile?.context || {};
  const sourceEntry = record.profile?.evidence?.sources?.[0] || {};
  const evidenceState = stateForReviewedEvidence(evidence.status);
  const researchStatus = applicability.researchStatus || "not_assessed";
  const acquisitionState = /reviewed|primary/.test(researchStatus) ? "reviewed" : researchStatus === "scope_screened" ? "screened" : "needs_review";
  metadataProfiles[record.id] = {
    summary: record.summary,
    aliases: [...new Set(record.previousNames || [])],
    identity: {
      componentName: record.componentName || null,
      componentCode: record.rawComponent || null,
      jointBase: Boolean(record.isJointBase),
      sourceSiteId: record.sourceSiteId || null,
      sourceObjectIds: [...new Set(record.sourceObjectIds || [])],
      organizations: (record.organizations || []).map((organization) => ({ name: organization.name, url: organization.url || null })),
    },
    inventory: {
      status: record.sourceStatus || null,
      statusCode: record.sourceStatusCode || null,
      sourceDate: record.sourceDate || null,
      referencePeriod: record.sourceReferencePeriod || evidence.referencePeriod || null,
    },
    geospatial: {
      country: location.country || "US",
      address: location.address || null,
      precision: location.precision || record.coordinateMethod || "approximate",
      method: location.method || record.coordinateMethod || "Source-provided coordinates",
      confidence: location.confidence || "Approximate source location",
    },
    evidence: {
      authority: evidence.authority || "unknown",
      status: evidence.status || "unverified",
      auditedAt: evidence.metadataAuditedAt || null,
      reviewedAt: evidence.liveReviewDate || null,
      verifiedClaims: [...new Set(evidence.verifiedClaims || [])],
      sourceCount: evidence.sources?.length || 0,
      primarySource: {
        title: sourceEntry.title || record.sourceDataset || "Authoritative location source",
        publisher: sourceEntry.publisher || record.sourceDataset || "Unknown publisher",
        url: sourceEntry.url || record.sourceUrl || record.organizations?.[0]?.url,
        supports: sourceEntry.supports || "Location identity and source-reported metadata.",
        reviewedAt: sourceEntry.reviewedAt || evidence.liveReviewDate || evidence.metadataAuditedAt || null,
      },
    },
    acquisition: {
      status: applicability.status || "unassessed",
      researchStatus,
      includedInBuyerList: Boolean(applicability.includedInBuyerList),
      buyerName: applicability.buyerName || null,
      summary: record.profile?.buyingPower?.summary || null,
      contractingOffice: applicability.contractingOffice ? {
        name: applicability.contractingOffice.name || null,
        code: applicability.contractingOffice.code || null,
      } : null,
      financialStatus: financial.status || "not_assessed",
      financialNote: financial.note || null,
    },
    context: {
      nearestOffice: context.nearestOffice || null,
      nearbyRecords50km: context.nearbyRecords50km ?? null,
    },
    dataGaps: [...new Set(record.profile?.dataGaps || [])],
    passes: {
      identity: { state: evidenceState, basis: record.sourceSiteId ? "Stable source site identifier retained" : "Primary source identity retained" },
      status: { state: record.sourceStatusCode ? "source_snapshot" : evidence.liveReviewDate ? "reviewed" : "needs_review", basis: record.sourceStatus ? `${record.sourceStatus}${record.sourceReferencePeriod ? ` · ${record.sourceReferencePeriod}` : ""}` : "No current operating status inferred" },
      geospatial: { state: evidenceState, basis: `${location.precision || record.coordinateMethod || "approximate"} coordinates` },
      mission: { state: evidence.verifiedClaims?.length ? evidenceState : applicability.status === "inventory_only" ? "screened" : "needs_review", basis: evidence.verifiedClaims?.length ? `${evidence.verifiedClaims.length} verified claim${evidence.verifiedClaims.length === 1 ? "" : "s"}` : "No mission claim promoted from geography alone" },
      acquisition: { state: acquisitionState, basis: researchStatus.replaceAll("_", " ") },
      financial: { state: financialState(financial.status), basis: (financial.status || "not_assessed").replaceAll("_", " ") },
    },
  };
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

const passCoverage = Object.fromEntries(LOCATION_METADATA_PASSES.map((pass) => [pass, Object.values(metadataProfiles).reduce((counts, profile) => {
  const state = profile.passes[pass].state;
  counts[state] = (counts[state] || 0) + 1;
  return counts;
}, {})]));

const metadataSnapshot = {
  metadata: {
    schemaVersion: OPPORTUNITY_MAP_LOCATION_METADATA_VERSION,
    recordCount: Object.keys(metadataProfiles).length,
    auditedAt: snapshot.metadata.auditedAt,
    sourceScope: snapshot.metadata.sourceScope,
    passes: [...LOCATION_METADATA_PASSES],
    passCoverage,
    methodology: "Deterministic normalization of reviewed source fields. Missing values remain explicit and no status, buyer, mission, or spend relationship is inferred.",
  },
  locations: metadataProfiles,
};

writeFileSync(outputPath, JSON.stringify(snapshot));
writeFileSync(metadataOutputPath, JSON.stringify(metadataSnapshot));
console.log(`Wrote ${locations.length} authoritative map locations and metadata profiles to ${outputPath} and ${metadataOutputPath}`);
