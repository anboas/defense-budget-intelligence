import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  hierarchyObservations,
  normalizeContractAward,
  normalizeEntityRegistration,
  normalizeOpportunity,
  normalizeSubaward,
} from "./sam-acquisition-backbone-core.mjs";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const OUTPUT = resolve(ROOT, "src/data/sam-acquisition-backbone.json");
const LEGACY = resolve(ROOT, "src/data/sam-opportunities.json");
const COVERAGE = resolve(ROOT, "src/data/usaspending-coverage.json");
const observedAt = new Date().toISOString();
const apiKey = process.env.SAM_GOV_API_KEY;
const prior = existsSync(OUTPUT) ? JSON.parse(readFileSync(OUTPUT, "utf8")) : null;
const legacy = existsSync(LEGACY) ? JSON.parse(readFileSync(LEGACY, "utf8")) : { records: [] };
const priorCollections = prior?.collections || {};
const REQUEST_TIMEOUT_MS = Math.max(5_000, Number(process.env.SAM_BACKBONE_REQUEST_TIMEOUT_MS || 45_000));
const LOOKBACK_DAYS = Math.max(1, Math.min(365, Number(process.env.SAM_BACKBONE_LOOKBACK_DAYS || 90)));
const ENTITY_LIMIT = Math.max(1, Math.min(1000, Number(process.env.SAM_BACKBONE_ENTITY_LIMIT || 250)));
const SUBAWARD_LIMIT = Math.max(1, Math.min(500, Number(process.env.SAM_BACKBONE_SUBAWARD_LIMIT || 100)));
const USER_AGENT = "defense-budget-intelligence-sam-backbone/1.0";

function mmddyyyy(value) {
  return `${String(value.getUTCMonth() + 1).padStart(2, "0")}/${String(value.getUTCDate()).padStart(2, "0")}/${value.getUTCFullYear()}`;
}

async function fetchJson(url, attempt = 1) {
  const response = await fetch(url, {
    headers: { accept: "application/json", "user-agent": USER_AGENT, "x-api-key": apiKey },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) {
    if (attempt < 4 && (response.status === 429 || response.status >= 500)) {
      await new Promise((resolvePromise) => setTimeout(resolvePromise, attempt * 1000));
      return fetchJson(url, attempt + 1);
    }
    throw new Error(`${response.status} ${response.statusText}`);
  }
  return response.json();
}

async function adapter(name, priorRows, task) {
  try {
    const rows = await task();
    return { name, status: "current", rows, retainedPrior: 0, error: null };
  } catch (error) {
    return { name, status: priorRows.length ? "stale" : "unavailable", rows: priorRows, retainedPrior: priorRows.length, error: String(error.message || error).slice(0, 240) };
  }
}

async function fetchOpportunities() {
  const end = new Date();
  const start = new Date(end.getTime() - LOOKBACK_DAYS * 86_400_000);
  const rows = [];
  let offset = 0;
  while (true) {
    const url = new URL("https://api.sam.gov/opportunities/v2/search");
    url.searchParams.set("postedFrom", mmddyyyy(start));
    url.searchParams.set("postedTo", mmddyyyy(end));
    url.searchParams.set("deptname", "DEPT OF DEFENSE");
    url.searchParams.set("limit", "1000");
    url.searchParams.set("offset", String(offset));
    url.searchParams.set("api_key", apiKey);
    const page = await fetchJson(url);
    const pageRows = page.opportunitiesData || [];
    rows.push(...pageRows);
    offset += pageRows.length;
    if (!pageRows.length || rows.length >= Number(page.totalRecords || 0)) break;
  }
  return rows;
}

async function fetchContractAwards() {
  const start = new Date(Date.now() - LOOKBACK_DAYS * 86_400_000).toISOString().slice(0, 10);
  const url = new URL("https://api.sam.gov/contract-awards/v1/search");
  url.searchParams.set("api_key", apiKey);
  url.searchParams.set("contractingDepartmentCode", "9700");
  url.searchParams.set("publicDeltaDate", start);
  url.searchParams.set("limit", "100");
  const page = await fetchJson(url);
  return page.contracts || page.results || page.data || [];
}

async function fetchEntity(uei) {
  const url = new URL("https://api.sam.gov/entity-information/v4/entities");
  url.searchParams.set("api_key", apiKey);
  url.searchParams.set("ueiSAM", uei);
  url.searchParams.set("includeSections", "entityRegistration,coreData,assertions");
  const page = await fetchJson(url);
  return (page.entityData || page.results || page.data || [])[0] || null;
}

async function fetchSubawards(piid) {
  const url = new URL("https://api.sam.gov/contract/v1/subcontracts/search");
  url.searchParams.set("api_key", apiKey);
  url.searchParams.set("piid", piid);
  url.searchParams.set("pageSize", "1000");
  url.searchParams.set("pageNumber", "0");
  const page = await fetchJson(url);
  return page.subawards || page.results || page.data || [];
}

function legacyNormalized() {
  return (legacy.records || []).map((row) => normalizeOpportunity(row, row.lastSeenAt || observedAt)).filter(Boolean);
}

const emptyCollections = {
  notices: [], noticeVersions: [], awardActions: [], vendorRegistrations: [], businessCertifications: [], hierarchyObservations: [], subawards: [],
};

if (!apiKey) {
  const legacyRows = legacyNormalized();
  const collections = { ...emptyCollections, ...priorCollections };
  if (!collections.notices.length && legacyRows.length) {
    collections.notices = legacyRows.map((item) => item.notice);
    collections.noticeVersions = legacyRows.map((item) => item.version);
    collections.awardActions = legacyRows.map((item) => item.awardAction).filter(Boolean);
    collections.hierarchyObservations = hierarchyObservations(collections.notices, observedAt);
  }
  const output = {
    metadata: {
      ...(prior?.metadata || {}), schemaVersion: "1.0.0", status: "unavailable", lastAttemptAt: observedAt,
      note: "SAM_GOV_API_KEY was unavailable. Every prior verified collection was preserved and no completeness claim was made.",
    },
    coverage: {
      opportunities: { status: collections.notices.length ? "stale" : "unavailable", records: collections.notices.length },
      contractAwards: { status: collections.awardActions.length ? "stale" : "unavailable", records: collections.awardActions.length },
      entityRegistrations: { status: collections.vendorRegistrations.length ? "stale" : "unavailable", records: collections.vendorRegistrations.length },
      federalHierarchy: { status: collections.hierarchyObservations.length ? "stale" : "unavailable", records: collections.hierarchyObservations.length },
      acquisitionSubawards: { status: collections.subawards.length ? "stale" : "unavailable", records: collections.subawards.length },
    },
    collections,
  };
  writeFileSync(OUTPUT, `${JSON.stringify(output, null, 2)}\n`);
  console.log("SAM_GOV_API_KEY unavailable; preserved the prior acquisition backbone and marked every protected adapter unavailable or stale");
  process.exit(0);
}

const opportunities = await adapter("opportunities", priorCollections.notices || [], fetchOpportunities);
const opportunityRows = opportunities.status === "current"
  ? opportunities.rows.map((row) => normalizeOpportunity(row, observedAt)).filter(Boolean)
  : [];
const notices = opportunities.status === "current" ? opportunityRows.map((item) => item.notice) : opportunities.rows;
const noticeVersions = opportunities.status === "current"
  ? [...(priorCollections.noticeVersions || []), ...opportunityRows.map((item) => item.version)].filter((row, index, all) => all.findIndex((item) => item.id === row.id) === index)
  : priorCollections.noticeVersions || [];

const contractAwards = await adapter("contractAwards", priorCollections.awardActions || [], async () => (await fetchContractAwards()).map((row) => normalizeContractAward(row, observedAt)).filter(Boolean));
const embeddedActions = opportunityRows.map((item) => item.awardAction).filter(Boolean);
const awardActions = [...contractAwards.rows, ...embeddedActions].filter((row, index, all) => all.findIndex((item) => item.id === row.id) === index);

const coveragePayload = existsSync(COVERAGE) ? JSON.parse(readFileSync(COVERAGE, "utf8")) : {};
const ueiSeeds = [...new Set([
  ...awardActions.flatMap((row) => [row.recipientUei]),
  ...(coveragePayload.awards || []).flatMap((row) => [row.recipientUei]),
].filter(Boolean))].slice(0, ENTITY_LIMIT);
const entityRows = [];
let entityFailures = 0;
for (const uei of ueiSeeds) {
  try { const row = await fetchEntity(uei); if (row) entityRows.push(row); } catch { entityFailures += 1; }
}
const entityNormalized = entityRows.map((row) => normalizeEntityRegistration(row, observedAt)).filter(Boolean);
const vendorRegistrations = entityNormalized.length ? entityNormalized.map((item) => item.registration) : priorCollections.vendorRegistrations || [];
const businessCertifications = entityNormalized.length ? entityNormalized.flatMap((item) => item.certifications) : priorCollections.businessCertifications || [];

const piidSeeds = [...new Set(awardActions.map((row) => row.piid).filter(Boolean))].slice(0, SUBAWARD_LIMIT);
const subawardRows = [];
let subawardFailures = 0;
for (const piid of piidSeeds) {
  try { subawardRows.push(...await fetchSubawards(piid)); } catch { subawardFailures += 1; }
}
const normalizedSubawards = subawardRows.map((row) => normalizeSubaward(row, observedAt)).filter(Boolean);
const subawards = normalizedSubawards.length ? normalizedSubawards : priorCollections.subawards || [];
const hierarchy = hierarchyObservations(notices, observedAt);

const output = {
  metadata: {
    schemaVersion: "1.0.0", generatedAt: observedAt,
    status: [opportunities.status, contractAwards.status, entityFailures ? "partial" : "current", subawardFailures ? "partial" : "current"].includes("unavailable") ? "partial" : "current",
    sourceSystem: "SAM.gov Acquisition Backbone",
    lookbackDays: LOOKBACK_DAYS,
    disclosure: "The public Contract Awards API may delay unrevealed Department of Defense records by at least 90 days. Opportunity versions are observed snapshots; SAM Data Services is required for a complete historical version archive.",
  },
  coverage: {
    opportunities: { status: opportunities.status, records: notices.length, retainedPrior: opportunities.retainedPrior },
    contractAwards: { status: contractAwards.status, records: awardActions.length, retainedPrior: contractAwards.retainedPrior },
    entityRegistrations: { status: entityFailures ? "partial" : "current", requested: ueiSeeds.length, records: vendorRegistrations.length, failures: entityFailures },
    federalHierarchy: { status: "bounded", records: hierarchy.length, basis: "organization paths published on collected notices" },
    acquisitionSubawards: { status: subawardFailures ? "partial" : "current", requestedPrimes: piidSeeds.length, records: subawards.length, failures: subawardFailures },
  },
  collections: { notices, noticeVersions, awardActions, vendorRegistrations, businessCertifications, hierarchyObservations: hierarchy, subawards },
};
writeFileSync(OUTPUT, `${JSON.stringify(output, null, 2)}\n`);
console.log(`Built SAM acquisition backbone: ${notices.length} notices, ${noticeVersions.length} observed versions, ${awardActions.length} award actions, ${vendorRegistrations.length} registrations, ${subawards.length} subawards`);
