import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assembleProcurementRecords } from "../src/procurement-taxonomy.js";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const OUTPUT = resolve(ROOT, "src/data/contract-monitor.json");
const TODAY = process.env.CONTRACT_MONITOR_AS_OF || new Date().toISOString().slice(0, 10);
const CONCURRENCY = Math.max(1, Math.min(16, Number(process.env.CONTRACT_MONITOR_CONCURRENCY || 8)));
const TIMEOUT_MS = Math.max(5_000, Number(process.env.CONTRACT_MONITOR_TIMEOUT_MS || 20_000));
const TARGET_LIMIT = Math.max(500, Number(process.env.CONTRACT_MONITOR_TARGET_LIMIT || 2000));

function readJson(path, fallback = {}) {
  try { return JSON.parse(readFileSync(resolve(ROOT, path), "utf8")); } catch { return fallback; }
}

const capture = readJson("src/data/capture-calendar.json", { metadata: {}, records: [] });
const budget = readJson("src/data/budget-intelligence.json", { metadata: {} });
const sam = readJson("src/data/sam-opportunities.json", { metadata: {}, records: [] });
const manual = readJson("src/data/manual-procurement.json", { records: [] });
const subawards = readJson("src/data/usaspending-subawards.json", { primes: [] });
const previous = readJson("src/data/contract-monitor.json", { records: [] });
const awards = budget.metadata?.dataInventory?.strategyAnalytics?.executionAnalytics?.awardDrilldown?.awards || [];
const records = assembleProcurementRecords(capture.records || [], awards, TODAY, sam.records || [], manual.records || [], subawards);
const priorByOpportunity = new Map((previous.records || []).map((record) => [record.opportunityId, record]));

function date(value) {
  return /^\d{4}-\d{2}-\d{2}/.test(String(value || "")) ? String(value).slice(0, 10) : null;
}

function lifecycle(record) {
  const start = date(record.start || record.solicitationStart || record.events?.map((event) => event.start).filter(Boolean).sort()[0]);
  const currentEnd = date(record.currentEnd || record.solicitationEnd);
  const potentialEnd = date(record.potentialEnd);
  const futureEvents = [...(record.events || []), ...(record.milestones || [])]
    .flatMap((event) => [date(event.start), date(event.end)])
    .filter((value) => value && value >= TODAY);
  if ((start && start > TODAY) || (!start && futureEvents.length)) return "upcoming";
  if ((currentEnd && currentEnd >= TODAY) || (start && start <= TODAY && !currentEnd)) return "active";
  if (potentialEnd && potentialEnd >= TODAY) return "option-horizon";
  if (!start && !currentEnd && !potentialEnd) return "unresolved-schedule";
  return "historical";
}

function generatedAwardId(record) {
  if (String(record.liveAward?.id || "").startsWith("CONT_")) return record.liveAward.id;
  for (const sourceUrl of record.sourceUrls || []) {
    const match = String(sourceUrl).match(/(?:usaspending\.gov\/award|api\.usaspending\.gov\/api\/v2\/awards)\/([^/?#]+)/i);
    if (match?.[1] && decodeURIComponent(match[1]).startsWith("CONT_")) return decodeURIComponent(match[1]);
  }
  return null;
}

function exactPiidCandidates(record, state) {
  if (state !== "active") return [];
  const reference = String(record.reference || "").trim().toUpperCase();
  if (!/^[A-Z0-9]+(?:-[A-Z0-9]+){0,4}$/.test(reference)) return [];
  const piid = reference.replaceAll("-", "");
  if (piid.length < 10 || piid.length > 22 || !/[A-Z]/.test(piid) || !/\d/.test(piid)) return [];
  return [
    { id: `CONT_AWD_${piid}_9700_-NONE-_-NONE-`, method: "usaspending-piid-resolution" },
    { id: `CONT_IDV_${piid}_9700`, method: "usaspending-piid-resolution" },
  ];
}

function safeError(error) {
  if (error?.name === "AbortError") return { code: "timeout", message: "USAspending did not respond before the monitor timeout." };
  const message = String(error?.message || "Contract refresh failed").replace(/https?:\/\/\S+/g, "upstream endpoint").slice(0, 240);
  return { code: /^HTTP \d+/.test(message) ? message.split(" ").slice(0, 2).join("_").toLowerCase() : "refresh_failed", message };
}

async function fetchAward(id, attempt = 0) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(`https://api.usaspending.gov/api/v2/awards/${encodeURIComponent(id)}/`, {
      headers: { accept: "application/json", "user-agent": "defense-budget-intelligence-contract-monitor/1.0" },
      signal: controller.signal,
    });
    if (!response.ok) {
      if ((response.status === 429 || response.status >= 500) && attempt < 2) {
        await new Promise((resolvePromise) => setTimeout(resolvePromise, 500 * (attempt + 1)));
        return fetchAward(id, attempt + 1);
      }
      const error = new Error(`HTTP ${response.status}`);
      error.status = response.status;
      throw error;
    }
    const body = await response.json();
    if (body.generated_unique_award_id !== id) throw new Error("Award identity mismatch");
    return body;
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeAward(body) {
  const contract = body.latest_transaction_contract_data || {};
  return {
    generatedAwardId: body.generated_unique_award_id,
    piid: body.piid || null,
    title: body.description || null,
    recipient: body.recipient?.recipient_name || null,
    recipientUei: body.recipient?.recipient_uei || null,
    awardType: body.type_description || null,
    signedAt: date(body.date_signed),
    startDate: date(body.period_of_performance?.start_date),
    currentEndDate: date(body.period_of_performance?.end_date),
    potentialEndDate: date(body.period_of_performance?.potential_end_date),
    sourceModifiedAt: date(body.period_of_performance?.last_modified_date),
    obligatedAmount: Number.isFinite(Number(body.total_obligation)) ? Number(body.total_obligation) : null,
    potentialAmount: Number.isFinite(Number(body.base_and_all_options)) ? Number(body.base_and_all_options) : null,
    outlayAmount: Number.isFinite(Number(body.total_outlay)) ? Number(body.total_outlay) : null,
    fundingAgency: body.funding_agency?.subtier_agency?.name || body.funding_agency?.toptier_agency?.name || null,
    fundingOffice: body.funding_agency?.office_agency_name || null,
    awardingAgency: body.awarding_agency?.subtier_agency?.name || body.awarding_agency?.toptier_agency?.name || null,
    awardingOffice: body.awarding_agency?.office_agency_name || null,
    solicitationNumber: contract.solicitation_identifier || null,
    competition: contract.extent_competed_description || null,
    setAside: contract.type_set_aside_description || null,
    pricingType: contract.type_of_contract_pricing_description || null,
    pscCode: contract.product_or_service_code || null,
    pscDescription: contract.product_or_service_description || null,
    naicsCode: contract.naics || null,
    naicsDescription: contract.naics_description || null,
    parentAwardId: body.parent_award?.generated_unique_award_id || null,
    parentPiid: body.parent_award?.piid || null,
    sourceUrl: `https://api.usaspending.gov/api/v2/awards/${encodeURIComponent(body.generated_unique_award_id)}/`,
  };
}

function baseRecord(record, state, id) {
  return {
    opportunityId: record.opportunityId,
    reference: record.reference || record.id || null,
    title: record.title || "Untitled contract",
    lifecycle: state,
    sourceSystem: record.sourceSystem || null,
    automatedImport: Boolean(record.automatedImport),
    generatedAwardId: id,
  };
}

const eligibleTargets = records
  .map((record) => ({ record, state: lifecycle(record), generatedAwardId: generatedAwardId(record) }))
  .filter(({ state }) => state !== "historical")
  .sort((left, right) => {
    const priorDifference = Number(priorByOpportunity.has(right.record.opportunityId)) - Number(priorByOpportunity.has(left.record.opportunityId));
    if (priorDifference) return priorDifference;
    const sourceDifference = Number(left.record.sourceSystem === "USAspending") - Number(right.record.sourceSystem === "USAspending");
    if (sourceDifference) return sourceDifference;
    const valueDifference = Number(right.record.obligatedAmount || right.record.potentialAmount || 0) - Number(left.record.obligatedAmount || left.record.potentialAmount || 0);
    return valueDifference || left.record.opportunityId.localeCompare(right.record.opportunityId);
  });
const targets = eligibleTargets.slice(0, TARGET_LIMIT);

const results = new Array(targets.length);
let cursor = 0;
async function worker() {
  while (cursor < targets.length) {
    const index = cursor++;
    const { record, state, generatedAwardId: sourceId } = targets[index];
    const prior = priorByOpportunity.get(record.opportunityId);
    const knownId = sourceId || prior?.generatedAwardId || null;
    const candidates = knownId
      ? [{ id: knownId, method: prior?.method === "usaspending-piid-resolution" ? prior.method : "usaspending-award-detail" }]
      : exactPiidCandidates(record, state);
    const base = baseRecord(record, state, knownId);
    if (!candidates.length) {
      const isSam = record.sourceSystem === "SAM.gov";
      results[index] = {
        ...base,
        status: isSam && sam.metadata?.status === "current" ? "batch-current" : "coverage-gap",
        method: isSam ? "sam-batch" : "no-exact-automated-key",
        checkedAt: isSam ? sam.metadata?.generatedAt || null : null,
        observation: null,
        diagnostic: isSam
          ? (sam.metadata?.status === "current" ? null : { code: "sam_unavailable", message: sam.metadata?.note || "SAM.gov batch refresh is unavailable." })
          : { code: "exact_identifier_missing", message: "No exact USAspending award ID or current SAM notice was available for automated refresh." },
      };
      continue;
    }
    let resolved = null;
    let failure = null;
    for (const candidate of candidates) {
      try {
        resolved = { candidate, body: await fetchAward(candidate.id) };
        break;
      } catch (error) {
        if (error.status === 404 && !knownId) continue;
        failure = error;
        break;
      }
    }
    if (resolved) {
      results[index] = {
        ...base,
        generatedAwardId: resolved.candidate.id,
        status: "current",
        method: resolved.candidate.method,
        checkedAt: new Date().toISOString(),
        observation: normalizeAward(resolved.body),
        diagnostic: null,
      };
      continue;
    }
    if (!failure && !knownId) {
      results[index] = {
        ...base,
        status: "coverage-gap",
        method: "exact-piid-unresolved",
        checkedAt: null,
        observation: null,
        diagnostic: { code: "exact_piid_not_resolved", message: "The disclosed PIID did not resolve to a standalone DoD award or IDV in USAspending." },
      };
      continue;
    }
    try {
      throw failure || new Error("Contract refresh failed");
    } catch (error) {
      results[index] = prior?.observation
        ? { ...base, status: "stale", method: prior.method || "usaspending-award-detail", checkedAt: prior.checkedAt || null, lastAttemptAt: new Date().toISOString(), observation: prior.observation, diagnostic: safeError(error) }
        : { ...base, status: "unavailable", method: candidates[0].method, checkedAt: null, lastAttemptAt: new Date().toISOString(), observation: null, diagnostic: safeError(error) };
    }
  }
}

await Promise.all(Array.from({ length: Math.min(CONCURRENCY, targets.length || 1) }, () => worker()));

const byLifecycle = Object.fromEntries(["active", "upcoming", "option-horizon", "unresolved-schedule"].map((state) => [state, results.filter((record) => record.lifecycle === state).length]));
const byStatus = Object.fromEntries(["current", "batch-current", "stale", "unavailable", "coverage-gap"].map((status) => [status, results.filter((record) => record.status === status).length]));
const exactTargetCount = results.filter((record) => record.generatedAwardId).length;
const coveredCount = results.filter((record) => ["current", "batch-current", "stale"].includes(record.status)).length;
const output = {
  metadata: {
    schemaVersion: "1.0.0",
    generatedAt: new Date().toISOString(),
    asOf: TODAY,
    status: byStatus.unavailable ? "partial" : byStatus["coverage-gap"] ? "gaps-disclosed" : "current",
    sourceSystem: "USAspending award detail plus SAM.gov opportunity batch",
    sourceUrls: ["https://api.usaspending.gov/api/v2/awards/", "https://open.gsa.gov/api/get-opportunities-public-api/"],
    methodology: "Up to 2,000 priority non-historical DBI procurement records are evaluated through exact detail probes, preserving every previously monitored record before selecting additional high-value records. The paginated daily award corpus independently tracks all query-scoped USAspending additions and field changes. Exact USAspending award identifiers are refreshed individually; single explicit active-contract PIIDs may resolve through identity-validated DoD award or IDV probes; SAM notices inherit the credentialed batch status; records without an exact automated key remain explicit coverage gaps.",
    retention: "The prior verified observation is retained and marked stale when a transient refresh fails.",
    targetCount: results.length,
    eligibleTargetCount: eligibleTargets.length,
    excludedTargetCount: Math.max(0, eligibleTargets.length - results.length),
    targetLimit: TARGET_LIMIT,
    exactTargetCount,
    coveredCount,
    currentCount: byStatus.current + byStatus["batch-current"],
    staleCount: byStatus.stale,
    unavailableCount: byStatus.unavailable,
    gapCount: byStatus["coverage-gap"],
    coveragePercent: results.length ? Number(((coveredCount / results.length) * 100).toFixed(1)) : 0,
    corpusCoveragePercent: eligibleTargets.length ? Number(((coveredCount / eligibleTargets.length) * 100).toFixed(1)) : 0,
    byLifecycle,
    byStatus,
  },
  records: results,
};

mkdirSync(dirname(OUTPUT), { recursive: true });
writeFileSync(OUTPUT, `${JSON.stringify(output, null, 2)}\n`);
console.log(`Refreshed contract monitor: targets=${results.length} exact=${exactTargetCount} current=${output.metadata.currentCount} stale=${byStatus.stale} unavailable=${byStatus.unavailable} gaps=${byStatus["coverage-gap"]}`);
