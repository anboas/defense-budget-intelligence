import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { enrichSourceRecord } from "../src/procurement-taxonomy.js";

const args = Object.fromEntries(process.argv.slice(2).flatMap((value, index, all) => (
  value.startsWith("--") ? [[value.slice(2), all[index + 1]]] : []
)));

const requiredArgs = ["opportunities", "events", "awards", "transactions", "display", "sources", "targets", "exclusions", "dictionary", "method", "metadata"];
for (const name of requiredArgs) {
  if (!args[name]) throw new Error(`Missing --${name}`);
}

const outPath = resolve(args.out || "src/data/capture-calendar.json");
const transactionsOutPath = resolve(args["transactions-out"] || "src/data/capture-transactions.json");
const privateStatus = "internal_proposal";
const projectionGeneratedAt = new Date().toISOString();
const publicRecordAugmentations = {
  "P-N24": {
    parentReference: "N6600123F3509",
    parentReferenceBasis: "Curated named-program predecessor crosswalk; the solicitation is explicitly an Application Arsenal lifecycle follow-on but does not print the predecessor PIID.",
    solicitationStart: "2026-08-31",
    solicitationEnd: "2026-09-30",
    noticeType: "Negotiated RFP / SeaPort NxG fair-opportunity proposal request",
    competitionType: "Full and open competitive procurement",
    eligibility: "SeaPort NxG contract holders only",
    pricingType: "Cost Plus Fixed Fee (CPFF) Level of Effort",
    sourceUrl: "https://sam.gov/api/prod/opps/v3/opportunities/resources/files/6dc3a7786ab345f2a1686a8851067f42/download",
  },
};

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function stableId(...parts) {
  return createHash("sha256").update(parts.join("\u001f")).digest("hex").slice(0, 24);
}

function parseCsv(input, sourceName) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    if (quoted) {
      if (character === '"' && input[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        cell += character;
      }
    } else if (character === '"') {
      quoted = true;
    } else if (character === ",") {
      row.push(cell);
      cell = "";
    } else if (character === "\n") {
      row.push(cell.replace(/\r$/, ""));
      if (row.some((value) => value.trim())) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += character;
    }
  }
  if (quoted) throw new Error(`${sourceName} ends inside a quoted field`);
  if (cell || row.length) {
    row.push(cell.replace(/\r$/, ""));
    if (row.some((value) => value.trim())) rows.push(row);
  }
  if (!rows.length) throw new Error(`${sourceName} is empty`);
  const headers = rows.shift().map((header) => header.replace(/^\uFEFF/, "").trim());
  return rows.map((values, index) => {
    if (values.length !== headers.length) {
      throw new Error(`${sourceName} row ${index + 2} has ${values.length} columns; expected ${headers.length}`);
    }
    return Object.fromEntries(headers.map((header, column) => [header, values[column].trim()]));
  });
}

function readCsv(argument) {
  const path = resolve(args[argument]);
  return { path, rows: parseCsv(readFileSync(path, "utf8"), argument) };
}

function number(value) {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function bool(value) {
  if (value === "true") return true;
  if (value === "false") return false;
  return null;
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function publicTitle(value) {
  return String(value || "Untitled public record").replace(/^Our\s+/i, "").trim();
}

function publicText(value) {
  return String(value || "")
    .replace(/Value\s*\/\s*Sabre workshare not established/gi, "Value not published")
    .replace(/Sabre workshare/gi, "allocation")
    .replace(/workshare unknown/gi, "allocation not published")
    .replace(/workshare/gi, "allocation")
    .replace(/\bour buying route\b/gi, "purchase route")
    .replace(/\bour delivery lead\b/gi, "delivery lead")
    .replace(/\bour access\b/gi, "access")
    .trim();
}

function evidenceTier(status) {
  if (["matched", "supporting_awards_matched", "newer_fpds_action"].includes(status)) return "corroborated";
  if (status === "agency_announcement") return "official-announcement";
  if (status.startsWith("source_retrieved")) return "source-reviewed";
  if (status === "prior_evidence_only") return "prior-evidence";
  return "evidence-gap";
}

function lifecycleStatus(row, events) {
  if (evidenceTier(row.corroboration_status) === "evidence-gap") return "evidence-gap";
  if (row.row_mode === "contract") {
    if (row.current_performance_end && row.current_performance_end >= metadata.snapshot_as_of) return "active-reported-term";
    if (row.potential_performance_end && row.potential_performance_end >= metadata.snapshot_as_of) return "option-horizon-unconfirmed";
    return row.potential_performance_end ? "historical-term" : "schedule-not-published";
  }
  if (!events.some((event) => event.start || event.end)) return "schedule-not-published";
  return events.some((event) => event.status_as_of_snapshot === "future" || event.status_as_of_snapshot === "intersects_as_of_or_open_bound")
    ? "upcoming-published-milestone"
    : "past-published-milestone";
}

function fiscalYear(date) {
  if (!date) return null;
  const [year, month] = date.split("-").map(Number);
  return month >= 10 ? year + 1 : year;
}

function actionDirection(value) {
  if (value > 0) return "funding";
  if (value < 0) return "deobligation";
  return "non-obligation";
}

const opportunitiesInput = readCsv("opportunities");
const eventsInput = readCsv("events");
const awardsInput = readCsv("awards");
const transactionsInput = readCsv("transactions");
const displayInput = readCsv("display");
const sourcesInput = readCsv("sources");
const targetsInput = readCsv("targets");
const exclusionsInput = readCsv("exclusions");
const dictionaryInput = readCsv("dictionary");
const methodPath = resolve(args.method);
const methodText = readFileSync(methodPath, "utf8");
const metadataPath = resolve(args.metadata);
const metadata = JSON.parse(readFileSync(metadataPath, "utf8"));

if (metadata.schema_version !== "1.1.0") throw new Error(`Unsupported capture schema ${metadata.schema_version}`);
if (opportunitiesInput.rows.length !== 243) throw new Error(`Expected 243 opportunities, got ${opportunitiesInput.rows.length}`);
if (eventsInput.rows.length !== 502) throw new Error(`Expected 502 events, got ${eventsInput.rows.length}`);
if (awardsInput.rows.length !== 130) throw new Error(`Expected 130 awards, got ${awardsInput.rows.length}`);
if (transactionsInput.rows.length !== 3085) throw new Error(`Expected 3,085 FPDS actions, got ${transactionsInput.rows.length}`);
if (displayInput.rows.length !== 2323) throw new Error(`Expected 2,323 display rows, got ${displayInput.rows.length}`);
if (sourcesInput.rows.length !== 884) throw new Error(`Expected 884 opportunity-source links, got ${sourcesInput.rows.length}`);
if (targetsInput.rows.length !== 554) throw new Error(`Expected 554 opportunity-target links, got ${targetsInput.rows.length}`);
if (exclusionsInput.rows.length !== 10) throw new Error(`Expected 10 exclusions, got ${exclusionsInput.rows.length}`);
if (dictionaryInput.rows.length !== 220) throw new Error(`Expected 220 data-dictionary rows, got ${dictionaryInput.rows.length}`);
for (const requiredStatement of ["3,046 public FPDS actions", "39 additional actions", "129 of 130", "Do not aggregate the transaction and award totals together"]) {
  if (!methodText.includes(requiredStatement)) throw new Error(`Corroboration method is missing required statement: ${requiredStatement}`);
}

const opportunitiesById = new Map();
const opportunitiesByAlias = new Map();
for (const row of opportunitiesInput.rows) {
  if (!row.opportunity_id || !row.gantt_row_id) throw new Error("Every opportunity must have a stable ID and Gantt alias");
  if (opportunitiesById.has(row.opportunity_id)) throw new Error(`Duplicate opportunity ID ${row.opportunity_id}`);
  if (opportunitiesByAlias.has(row.gantt_row_id)) throw new Error(`Duplicate Gantt alias ${row.gantt_row_id}`);
  opportunitiesById.set(row.opportunity_id, row);
  opportunitiesByAlias.set(row.gantt_row_id, row);
}

for (const [name, rows] of [["events", eventsInput.rows], ["display", displayInput.rows], ["sources", sourcesInput.rows], ["targets", targetsInput.rows]]) {
  for (const row of rows) {
    const opportunity = opportunitiesById.get(row.opportunity_id);
    if (!opportunity || opportunity.gantt_row_id !== row.gantt_row_id) {
      throw new Error(`${name} contains an invalid opportunity/Gantt join: ${row.opportunity_id} / ${row.gantt_row_id}`);
    }
  }
}

const actionKeys = new Set();
for (const row of transactionsInput.rows) {
  if (!opportunitiesByAlias.has(row.gantt_row_id)) throw new Error(`FPDS action has unknown Gantt alias ${row.gantt_row_id}`);
  const key = [row.agency, row.piid, row.parent, row.modification, row.transaction_number].join("|");
  if (actionKeys.has(key)) throw new Error(`Duplicate FPDS action ${key}`);
  actionKeys.add(key);
}

const publicRows = opportunitiesInput.rows.filter((row) => row.validation_status !== privateStatus);
const publicIds = new Set(publicRows.map((row) => row.opportunity_id));
const privateRows = opportunitiesInput.rows.filter((row) => row.validation_status === privateStatus);
if (publicRows.length !== 198 || privateRows.length !== 45) {
  throw new Error(`Publication boundary changed: ${publicRows.length} public / ${privateRows.length} private`);
}

const awardsById = new Map();
for (const row of awardsInput.rows) {
  if (!row.award_record_id) throw new Error("Every award must have a stable award record ID");
  if (awardsById.has(row.award_record_id)) throw new Error(`Duplicate award record ID ${row.award_record_id}`);
  awardsById.set(row.award_record_id, row);
}
const awardedPublicRows = publicRows.filter((row) => row.row_mode === "contract");
for (const row of awardedPublicRows) {
  const award = awardsById.get(row.award_record_id);
  if (!award || award.canonical_gantt_row_id !== row.gantt_row_id) {
    throw new Error(`Award contains an invalid record/Gantt join: ${row.award_record_id} / ${row.gantt_row_id}`);
  }
}

const eventsByOpportunity = new Map();
for (const row of eventsInput.rows) {
  if (!publicIds.has(row.opportunity_id)) throw new Error(`Private event reached public event table: ${row.event_id}`);
  const event = {
    eventId: row.event_id,
    kind: row.kind,
    start: row.start || null,
    end: row.end || row.start || null,
    precision: row.precision || "unknown",
    label: publicText(row.label),
    sourceUrl: row.source_url || null,
    isForecast: bool(row.is_forecast),
    isVerified: bool(row.is_verified),
    isOptional: bool(row.is_optional),
    status: row.status_as_of_snapshot || row.status || null,
    sourcePublishedDate: row.source_published_date || null,
  };
  const rows = eventsByOpportunity.get(row.opportunity_id) || [];
  rows.push(event);
  eventsByOpportunity.set(row.opportunity_id, rows);
}

const sourceRolesByOpportunity = new Map();
for (const row of sourcesInput.rows) {
  if (!publicIds.has(row.opportunity_id)) continue;
  const roles = sourceRolesByOpportunity.get(row.opportunity_id) || [];
  roles.push(row.source_role);
  sourceRolesByOpportunity.set(row.opportunity_id, roles);
}

const actionsByOpportunity = new Map();
let primaryActionCount = 0;
let supportingActionCount = 0;
for (const row of transactionsInput.rows) {
  const opportunity = opportunitiesByAlias.get(row.gantt_row_id);
  if (!publicIds.has(opportunity.opportunity_id)) throw new Error(`FPDS action maps to private row ${row.gantt_row_id}`);
  const primaryPiid = (opportunity.award_piid || opportunity.related_award_identifier || "").toUpperCase();
  const supportingInstrument = row.piid.toUpperCase() !== primaryPiid;
  if (supportingInstrument) supportingActionCount += 1;
  else primaryActionCount += 1;
  const obligationDelta = number(row.obligation_delta) || 0;
  const action = {
    actionId: `act_${stableId(row.agency, row.piid, row.parent, row.modification, row.transaction_number)}`,
    piid: row.piid,
    parentPiid: row.parent || null,
    agencyCode: row.agency || null,
    modification: row.modification || null,
    transactionNumber: row.transaction_number || null,
    signed: row.signed || null,
    performanceStart: row.start || null,
    currentEnd: row.current_end || null,
    potentialEnd: row.potential_end || null,
    description: publicText(row.description),
    vendor: row.legal_vendor || row.vendor || null,
    uei: row.uei || null,
    obligationDelta,
    potentialDelta: number(row.potential_delta) || 0,
    obligationsTotal: number(row.obligations_total),
    potentialTotal: number(row.potential_total),
    modifiedAt: row.modified || null,
    status: row.status || null,
    direction: actionDirection(obligationDelta),
    supportingInstrument,
  };
  const rows = actionsByOpportunity.get(opportunity.opportunity_id) || [];
  rows.push(action);
  actionsByOpportunity.set(opportunity.opportunity_id, rows);
}

if (primaryActionCount !== 3046 || supportingActionCount !== 39) {
  throw new Error(`FPDS action role split changed: ${primaryActionCount} primary / ${supportingActionCount} supporting`);
}

function transactionSummary(actions) {
  const primary = actions.filter((action) => !action.supportingInstrument);
  const signed = actions.map((action) => action.signed).filter(Boolean).sort();
  const instruments = unique(actions.map((action) => action.piid));
  const directions = { funding: 0, deobligation: 0, "non-obligation": 0 };
  for (const action of actions) directions[action.direction] += 1;
  return {
    actions: actions.length,
    primaryActions: primary.length,
    supportingActions: actions.length - primary.length,
    instruments: instruments.length,
    firstSigned: signed[0] || null,
    lastSigned: signed.at(-1) || null,
    primaryNetObligations: primary.reduce((sum, action) => sum + action.obligationDelta, 0),
    fundingActions: directions.funding,
    deobligationActions: directions.deobligation,
    nonObligationActions: directions["non-obligation"],
  };
}

const records = publicRows.map((row) => {
  const augmentation = publicRecordAugmentations[row.gantt_row_id] || {};
  const award = awardsById.get(row.award_record_id) || {};
  const events = (eventsByOpportunity.get(row.opportunity_id) || []).sort((left, right) => (left.start || "9999").localeCompare(right.start || "9999") || left.eventId.localeCompare(right.eventId));
  const actions = (actionsByOpportunity.get(row.opportunity_id) || []).sort((left, right) => (left.signed || "").localeCompare(right.signed || "") || left.actionId.localeCompare(right.actionId));
  const primaryActions = actions.filter((action) => !action.supportingInstrument);
  const fiscalActions = [...new Set(primaryActions.map((action) => fiscalYear(action.signed)).filter(Boolean))].sort().map((year) => {
    const yearActions = primaryActions.filter((action) => fiscalYear(action.signed) === year);
    return {
      fiscalYear: year,
      actions: yearActions.length,
      obligationDelta: yearActions.reduce((sum, action) => sum + action.obligationDelta, 0),
      fundingActions: yearActions.filter((action) => action.direction === "funding").length,
      deobligationActions: yearActions.filter((action) => action.direction === "deobligation").length,
      nonObligationActions: yearActions.filter((action) => action.direction === "non-obligation").length,
    };
  });
  const fiscalValues = fiscalActions.map((year) => ({ fiscalYear: year.fiscalYear, amount: year.obligationDelta }));
  const milestoneEvents = row.row_mode === "contract"
    ? []
    : events.filter((event) => event.start).map((event) => ({ label: event.label, start: event.start, end: event.end || event.start, precision: event.precision }));
  const sourceUrls = unique([row.primary_source_url, row.fpds_source_url, augmentation.sourceUrl, ...events.map((event) => event.sourceUrl)]);
  return enrichSourceRecord({
    opportunityId: row.opportunity_id,
    id: row.gantt_row_id,
    portfolio: row.portfolio_group,
    mode: row.row_mode === "contract" ? "contract-performance" : "acquisition-window",
    title: publicTitle(row.program),
    party: row.incumbent_or_customer || row.owner_as_recorded || "Not published",
    owner: row.owner_as_recorded || null,
    fundingOffice: row.funding_office || null,
    contractingOffice: row.contracting_office || null,
    reference: row.award_piid || row.related_award_identifier || null,
    parentReference: augmentation.parentReference || row.predecessor_piid || null,
    parentReferenceBasis: augmentation.parentReferenceBasis || (row.predecessor_piid ? "Source-declared predecessor PIID" : null),
    vehicle: row.vehicle || null,
    solicitationStart: augmentation.solicitationStart || null,
    solicitationEnd: augmentation.solicitationEnd || null,
    noticeType: augmentation.noticeType || null,
    competitionType: augmentation.competitionType || award.competition || null,
    setAside: award.set_aside || null,
    eligibility: augmentation.eligibility || null,
    awardType: award.award_type || null,
    pricingType: augmentation.pricingType || award.pricing || null,
    naicsCode: award.naics || award.naics_code || null,
    naicsDescription: award.naics_description || null,
    pscCode: award.psc || award.psc_code || null,
    pscDescription: award.psc_description || null,
    context: publicText(row.scope),
    sourceDescription: publicText(row.scope),
    evidenceTier: evidenceTier(row.corroboration_status),
    corroborationStatus: row.corroboration_status,
    lifecycleStatus: lifecycleStatus(row, events),
    validationStatus: row.validation_status,
    validationCheckedAt: row.validation_checked_at || null,
    corroborationFinding: publicText(row.corroboration_note),
    sourceRoleCount: unique(sourceRolesByOpportunity.get(row.opportunity_id) || []).length,
    sourceUrls,
    events,
    milestones: milestoneEvents,
    start: row.performance_start || row.ordering_start || null,
    currentEnd: row.current_performance_end || row.ordering_end || null,
    potentialEnd: row.potential_performance_end || null,
    obligatedAmount: number(row.award_obligations_usd),
    potentialAmount: number(row.award_base_and_all_options_usd),
    fpdsObligatedAmount: number(row.fpds_public_obligations_usd),
    fpdsPotentialAmount: number(row.fpds_public_potential_usd),
    valueLow: number(row.forecast_estimate_min_usd),
    valueHigh: number(row.forecast_estimate_max_usd) || number(row.forecast_estimate_usd),
    fiscalValues,
    fiscalActions,
    transactionSummary: transactionSummary(actions),
  });
});

const transactionYears = new Map();
for (const actions of actionsByOpportunity.values()) {
  for (const action of actions.filter((item) => !item.supportingInstrument)) {
    const year = fiscalYear(action.signed);
    if (!year) continue;
    const bucket = transactionYears.get(year) || { fiscalYear: year, actions: 0, obligationDelta: 0, fundingActions: 0, deobligationActions: 0, nonObligationActions: 0 };
    bucket.actions += 1;
    bucket.obligationDelta += action.obligationDelta;
    const directionField = {
      funding: "fundingActions",
      deobligation: "deobligationActions",
      "non-obligation": "nonObligationActions",
    }[action.direction];
    bucket[directionField] += 1;
    transactionYears.set(year, bucket);
  }
}

const validationCounts = Object.fromEntries(Object.entries(metadata.validation_status_counts).filter(([key]) => key !== privateStatus));
const sourceFiles = Object.fromEntries([
  ["opportunities", opportunitiesInput], ["events", eventsInput], ["awards", awardsInput], ["transactions", transactionsInput], ["display", displayInput],
  ["sources", sourcesInput], ["targets", targetsInput], ["exclusions", exclusionsInput],
  ["dictionary", dictionaryInput],
].map(([name, input]) => [name, { rows: input.rows.length, sha256: sha256(input.path) }]));
sourceFiles.method = { rows: methodText.split(/\r?\n/).length, sha256: sha256(methodPath) };
sourceFiles.metadata = { rows: 1, sha256: sha256(metadataPath) };

const coreOutput = {
  metadata: {
    title: "Growth and Capture Calendar",
    schemaVersion: metadata.schema_version,
    asOf: metadata.snapshot_as_of,
    generatedAt: projectionGeneratedAt,
    sourceGeneratedAt: metadata.generated_at_utc,
    publicationPolicy: "Public-source facts only. Internal campaign fields, target mappings, management priorities, access labels, and proposed work packages are excluded from the public runtime bundle.",
    identityPolicy: "Stable opportunity IDs are primary. Gantt row IDs are display aliases only.",
    amountPolicy: "USAspending award totals remain primary. FPDS action values are corroborating transaction history and are never added to USAspending totals.",
    sourceFiles,
    coverage: {
      sourceRows: opportunitiesInput.rows.length,
      publicRows: records.length,
      excludedPrivateRows: privateRows.length,
      portfolios: new Set(records.map((record) => record.portfolio)).size,
      contractRows: records.filter((record) => record.mode === "contract-performance").length,
      acquisitionRows: records.filter((record) => record.mode === "acquisition-window").length,
      normalizedEvents: eventsInput.rows.length,
      uniqueAwards: metadata.unique_award_count,
      awardsWithPricingType: records.filter((record) => record.pricingType).length,
      awardsWithAwardType: records.filter((record) => record.awardType).length,
      rowsWithVehicle: records.filter((record) => record.vehicle).length,
      rowsWithCompetition: records.filter((record) => record.competitionType || record.setAside || record.eligibility).length,
      rowsWithWorkCategory: records.filter((record) => record.workCategory && record.workCategory !== "other-unclassified").length,
      workCategories: new Set(records.flatMap((record) => record.workCategories || [])).size,
      rowsWithIngestionProvenance: records.filter((record) => record.ingestionMethod).length,
      fpdsActions: transactionsInput.rows.length,
      primaryAwardActions: primaryActionCount,
      supportingInstrumentActions: supportingActionCount,
      financiallyReconciledAwards: 129,
      newerFpdsActionAwards: 1,
      rowsWithExternalSources: records.filter((record) => record.sourceUrls.length).length,
      validationStatusCounts: validationCounts,
    },
    transactionAnalytics: {
      byFiscalYear: [...transactionYears.values()].sort((left, right) => left.fiscalYear - right.fiscalYear),
      directionCounts: {
        funding: transactionsInput.rows.filter((row) => number(row.obligation_delta) > 0).length,
        deobligation: transactionsInput.rows.filter((row) => number(row.obligation_delta) < 0).length,
        nonObligation: transactionsInput.rows.filter((row) => (number(row.obligation_delta) || 0) === 0).length,
      },
    },
  },
  records,
};

const transactionsOutput = {
  metadata: {
    schemaVersion: metadata.schema_version,
    asOf: metadata.snapshot_as_of,
    generatedAt: projectionGeneratedAt,
    sourceGeneratedAt: metadata.generated_at_utc,
    actionCount: transactionsInput.rows.length,
    primaryAwardActions: primaryActionCount,
    supportingInstrumentActions: supportingActionCount,
    uniqueActionKey: "agency + PIID + parent PIID + modification + transaction number",
    amountPolicy: coreOutput.metadata.amountPolicy,
    source: sourceFiles.transactions,
  },
  byOpportunity: Object.fromEntries([...actionsByOpportunity.entries()].filter(([opportunityId]) => publicIds.has(opportunityId))),
};

const forbiddenProperties = /"(?:sabreRelationship|captureMotion|accessCode|managementPriorities|targetIds|targetNames|statusAsRecorded)"/i;
const forbiddenPhrases = /OUR AWARD \/ DELIVERY-LED EXPANSION|ACTIVE TEAMED BID|Targets A1|campaign qualification|proposed work package/i;
const serializedPublicRows = JSON.stringify({ records, byOpportunity: transactionsOutput.byOpportunity });
const forbiddenPropertyMatch = serializedPublicRows.match(forbiddenProperties);
const forbiddenPhraseMatch = serializedPublicRows.match(forbiddenPhrases);
if (forbiddenPropertyMatch || forbiddenPhraseMatch) {
  throw new Error(`Public capture bundle contains internal campaign data: ${forbiddenPropertyMatch?.[0] || forbiddenPhraseMatch?.[0]}`);
}
if (records.length !== new Set(records.map((record) => record.opportunityId)).size) throw new Error("Public stable opportunity IDs are not unique");
if (records.some((record) => record.id === record.opportunityId)) throw new Error("Gantt aliases must not be used as stable opportunity IDs");

writeFileSync(outPath, `${JSON.stringify(coreOutput, null, 2)}\n`);
writeFileSync(transactionsOutPath, `${JSON.stringify(transactionsOutput)}\n`);
console.log(`Built ${records.length} public opportunities, ${eventsInput.rows.length} events, and ${transactionsInput.rows.length} FPDS actions; excluded ${privateRows.length} internal rows`);
