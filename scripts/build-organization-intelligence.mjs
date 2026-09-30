import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SRC_DATA = resolve(ROOT, "src/data");
const PUBLIC_DATA = resolve(ROOT, "public/data");
const SRC_OUT = resolve(SRC_DATA, "organization-intelligence.json");
const PUBLIC_OUT = resolve(PUBLIC_DATA, "organization-intelligence.json");
const read = (path) => JSON.parse(readFileSync(path, "utf8"));
const hash = (value) => createHash("sha256").update(String(value)).digest("hex").slice(0, 20);
const normalized = (value) => String(value || "").trim().toUpperCase().replace(/[^A-Z0-9]+/g, "");
const unique = (values) => [...new Set((values || []).filter(Boolean))];
const generatedAt = new Date().toISOString();

const roadmap = read(resolve(SRC_DATA, "roadmap-intelligence.json"));
const program = read(resolve(SRC_DATA, "program-intelligence.json"));
const strategic = read(resolve(SRC_DATA, "strategic-intelligence.json"));
const execution = read(resolve(PUBLIC_DATA, "budget-execution.json"));
const accountSpine = read(resolve(PUBLIC_DATA, "account-spine.json"));
const map = read(resolve(PUBLIC_DATA, "opportunity-map-data.json"));

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const sourceById = new Map((roadmap.sources || []).map((source) => [source.id, source]));
const mapLocationById = new Map((map.locations || []).map((location) => [`location:${location.id}`, location]));
const missionByLocation = new Map((strategic.missionAssignments || []).map((mission) => [mission.locationId, mission]));
const roleOrganizationMetadata = new Map((roadmap.officialRoleOrganizations || []).map((row) => [normalized(row.organizationName), row]));
const rolesByOrganization = new Map();
for (const role of roadmap.officialRoles || []) {
  const key = normalized(role.organizationName);
  if (!rolesByOrganization.has(key)) rolesByOrganization.set(key, []);
  rolesByOrganization.get(key).push(role);
}

const programsByOrganization = new Map();
for (const item of program.programs || []) {
  const key = normalized(item.organization);
  if (!programsByOrganization.has(key)) programsByOrganization.set(key, []);
  programsByOrganization.get(key).push(item);
}
const baselinesByProgram = new Map();
for (const baseline of program.programBaselines || []) {
  if (!baselinesByProgram.has(baseline.programId)) baselinesByProgram.set(baseline.programId, []);
  baselinesByProgram.get(baseline.programId).push(baseline);
}

const awardFlows = accountSpine.awardFlows || [];
const awards = execution.awardDrilldown?.awards || [];
const accountLabelById = new Map((accountSpine.accounts || []).map((account) => [`account:${account.federalAccountCode}`, account.title || account.accountTitle || account.federalAccountCode]));

const candidates = new Map();
function candidate(label, category, score, details = {}) {
  const key = normalized(label);
  if (!key || !label) return;
  const current = candidates.get(key) || { key, label: String(label).trim(), categories: new Set(), score: 0, details: [] };
  current.categories.add(category);
  current.score = Math.max(current.score, score);
  current.details.push(details);
  candidates.set(key, current);
}

for (const rows of rolesByOrganization.values()) candidate(rows[0].organizationName, "public-leadership", 100 + rows.length, { roleCount: rows.length });

const missionOrganizationByLocation = new Map();
for (const tenant of strategic.tenantAssignments || []) {
  if (!tenant.organizationName || !missionByLocation.has(tenant.locationId)) continue;
  if (!missionOrganizationByLocation.has(tenant.locationId)) missionOrganizationByLocation.set(tenant.locationId, tenant.organizationName);
  candidate(tenant.organizationName, "mission-organization", 90, { locationId: tenant.locationId });
}

for (const office of program.programOffices || []) candidate(office.organization, "program-office", 80 + (programsByOrganization.get(normalized(office.organization))?.length || 0), { officeId: office.id });
for (const buyer of roadmap.buyerProfiles || []) candidate(buyer.label, "buyer", 70 + Math.log10(Math.max(1, buyer.totalAwardValueDollars)), { buyerId: buyer.id });
for (const vendor of roadmap.vendorProfiles || []) candidate(vendor.label, "vendor", 60 + Math.log10(Math.max(1, vendor.totalAwardValueDollars)), { vendorId: vendor.id });

const selected = [];
const selectedKeys = new Set();
function select(category, limit) {
  const rows = [...candidates.values()].filter((row) => row.categories.has(category) && !selectedKeys.has(row.key)).sort((a, b) => b.score - a.score || a.label.localeCompare(b.label));
  for (const row of rows.slice(0, limit)) { selected.push(row); selectedKeys.add(row.key); }
}
select("public-leadership", 25);
select("mission-organization", 25);
select("program-office", 20);
select("buyer", 15);
select("vendor", 15);
for (const row of [...candidates.values()].sort((a, b) => b.score - a.score || a.label.localeCompare(b.label))) {
  if (selected.length >= 100) break;
  if (!selectedKeys.has(row.key)) { selected.push(row); selectedKeys.add(row.key); }
}
assert(selected.length === 100, `Organization dossier cohort must contain exactly 100 organizations, got ${selected.length}`);

const missionClaims = [];
const financialSummaries = [];
const researchGaps = [];
const changeEvents = [];
const dossiers = [];

function awardUrl(award) {
  const id = award?.id || award?.awardId || "";
  return id ? `https://www.usaspending.gov/award/${encodeURIComponent(id)}/` : "";
}

for (const row of selected) {
  const dossierId = `organization-dossier:${hash(row.key)}`;
  const categories = [...row.categories].sort();
  const roles = rolesByOrganization.get(row.key) || [];
  const roleMeta = roleOrganizationMetadata.get(row.key);
  const programs = programsByOrganization.get(row.key) || [];
  const buyerProfile = (roadmap.buyerProfiles || []).find((item) => normalized(item.label) === row.key);
  const vendorProfile = (roadmap.vendorProfiles || []).find((item) => normalized(item.label) === row.key);
  const missionTenants = (strategic.tenantAssignments || []).filter((item) => normalized(item.organizationName) === row.key && missionByLocation.has(item.locationId));
  const organizationAwards = awards.filter((award) => {
    if (vendorProfile && normalized(award.recipient) === row.key) return true;
    if (buyerProfile && [award.awardingOffice, award.buyerSubAgency, award.awardingSubAgency, award.fundingOffice, award.fundingSubAgency].some((value) => normalized(value) === row.key)) return true;
    return false;
  }).sort((a, b) => Number(b.awardAmountDollars || 0) - Number(a.awardAmountDollars || 0));
  const organizationFlows = awardFlows.filter((flow) => normalized(flow.recipient) === row.key || [flow.awardingOffice, flow.fundingOffice, flow.fundingSubAgency].some((value) => normalized(value) === row.key));
  const accountIds = unique(organizationFlows.flatMap((flow) => (flow.accounts || []).map((account) => `account:${account.federalAccountCode || account.accountCode || account.id || ""}`).filter((id) => id !== "account:")));
  const vendorNames = buyerProfile ? unique(organizationAwards.map((award) => award.recipient)).slice(0, 25) : [];
  const sourceUrls = unique([
    ...roles.flatMap((role) => role.sourceIds || []).map((sourceId) => sourceById.get(sourceId)?.url),
    ...missionTenants.map((tenant) => tenant.sourceUrl),
    ...programs.flatMap((item) => (baselinesByProgram.get(item.id) || []).map((baseline) => baseline.sourceUrl)),
    ...organizationFlows.map((flow) => flow.sourceUrl),
    ...organizationAwards.slice(0, 5).map(awardUrl),
  ]);

  const dossierMissionIds = [];
  if (roleMeta?.jurisdiction) {
    const id = `organization-mission-claim:${hash(`${dossierId}|jurisdiction`)}`;
    missionClaims.push({ id, dossierId, label: `${row.label} jurisdiction`, claim: roleMeta.jurisdiction, claimType: "official-jurisdiction", sourceUrl: sourceById.get(roleMeta.sourceId)?.url || "", observedAt: sourceById.get(roleMeta.sourceId)?.observedAt || generatedAt.slice(0, 10), reviewState: "source_snapshot" });
    dossierMissionIds.push(id);
  }
  for (const tenant of missionTenants.slice(0, 3)) {
    const mission = missionByLocation.get(tenant.locationId);
    const id = `organization-mission-claim:${hash(`${dossierId}|${mission.id}`)}`;
    if (dossierMissionIds.includes(id)) continue;
    missionClaims.push({ id, dossierId, label: mission.label, claim: mission.summary, claimType: "official-mission-or-assignment", sourceUrl: mission.sourceUrl, observedAt: mission.reviewedAt, locationId: mission.locationId, reviewState: mission.reviewState });
    dossierMissionIds.push(id);
  }
  if (programs.length) {
    const id = `organization-mission-claim:${hash(`${dossierId}|budget-portfolio`)}`;
    missionClaims.push({ id, dossierId, label: `${row.label} published budget portfolio`, claim: `Published budget sponsorship covers ${programs.length.toLocaleString()} retained defense program records.`, claimType: "published-budget-portfolio", sourceUrl: unique(programs.flatMap((item) => (baselinesByProgram.get(item.id) || []).map((baseline) => baseline.sourceUrl)))[0] || "", observedAt: generatedAt.slice(0, 10), reviewState: "deterministic" });
    dossierMissionIds.push(id);
  }

  const dossierFinancialIds = [];
  if (buyerProfile) {
    const id = `organization-financial-summary:${hash(`${dossierId}|buyer-award-value`)}`;
    financialSummaries.push({ id, dossierId, label: "Retained buyer award value", measureType: "retained-life-of-award-value", amountDollars: buyerProfile.totalAwardValueDollars, awardCount: buyerProfile.awardCount, vendorCount: buyerProfile.vendorCount, sourceBoundary: "Retained award corpus; not annual obligations or total market size.", reviewState: "deterministic" });
    dossierFinancialIds.push(id);
  }
  if (vendorProfile) {
    const id = `organization-financial-summary:${hash(`${dossierId}|vendor-award-value`)}`;
    financialSummaries.push({ id, dossierId, label: "Retained vendor award value", measureType: "retained-life-of-award-value", amountDollars: vendorProfile.totalAwardValueDollars, awardCount: vendorProfile.awardCount, buyerCount: vendorProfile.buyerCount, sourceBoundary: "Retained award corpus; not annual revenue or total federal sales.", reviewState: "deterministic" });
    dossierFinancialIds.push(id);
  }
  if (programs.length) {
    const baselines = programs.flatMap((item) => baselinesByProgram.get(item.id) || []);
    const requestedMillions = baselines.reduce((total, baseline) => total + Number(baseline.amountsMillions?.[`fy${baseline.requestYear}`] || 0), 0);
    const id = `organization-financial-summary:${hash(`${dossierId}|request-baselines`)}`;
    financialSummaries.push({ id, dossierId, label: "Published request baselines", measureType: "presidents-budget-request", amountDollars: requestedMillions * 1_000_000, programCount: programs.length, baselineCount: baselines.length, sourceBoundary: "Budget requests are separate from authority, obligations, outlays, award value, and ceilings.", reviewState: "deterministic" });
    dossierFinancialIds.push(id);
  }

  const dossierGapIds = [];
  const gaps = [
    [!dossierMissionIds.length, "mission", "Obtain a current official charter, mission statement, directive, or jurisdiction page."],
    [!roles.length, "leadership", "Identify current and historical public professional leaders with official tenure evidence."],
    [!dossierFinancialIds.length, "finance", "Resolve organization-scoped request, authority, obligation, outlay, or exact award measures."],
    [!roleMeta?.parentOrganizationName, "hierarchy", "Resolve the exact parent and subordinate organization structure from an official hierarchy source."],
    [!sourceUrls.length, "source-coverage", "Add at least one reviewed official/public source before promotion."],
  ].filter(([needed]) => needed);
  for (const [, gapType, description] of gaps) {
    const id = `organization-research-gap:${hash(`${dossierId}|${gapType}`)}`;
    researchGaps.push({ id, dossierId, gapType, label: `${row.label}: ${gapType}`, description, priority: gapType === "leadership" || gapType === "mission" ? "high" : "medium", status: "open", reviewState: "needs_review" });
    dossierGapIds.push(id);
  }

  const dossierEventIds = [];
  for (const role of roles.slice(0, 20)) {
    for (const [eventType, date] of [["role-start-or-observation", role.effectiveFrom], ["role-end", role.effectiveTo]]) {
      if (!date) continue;
      const id = `organization-change-event:${hash(`${dossierId}|${role.id}|${eventType}|${date}`)}`;
      changeEvents.push({ id, dossierId, label: `${role.title}: ${eventType.replaceAll("-", " ")}`, eventType, effectiveAt: date, roleId: role.id, personId: role.personId, sourceIds: role.sourceIds, reviewState: role.reviewState });
      dossierEventIds.push(id);
    }
  }

  const latestObservation = unique([
    ...roles.map((role) => role.effectiveTo || role.effectiveFrom),
    ...missionTenants.map((tenant) => tenant.reviewedAt),
  ]).sort().at(-1) || generatedAt.slice(0, 10);
  dossiers.push({
    id: dossierId,
    label: row.label,
    organizationName: row.label,
    categories,
    priorityTier: roles.length || missionTenants.length ? "tier-1" : programs.length || buyerProfile ? "tier-2" : "tier-3",
    parentOrganizationName: roleMeta?.parentOrganizationName || "",
    roleIds: roles.map((role) => role.id),
    personIds: unique(roles.map((role) => role.personId)),
    missionClaimIds: dossierMissionIds,
    financialSummaryIds: dossierFinancialIds,
    programIds: programs.map((item) => item.id),
    awardIds: organizationAwards.slice(0, 50).map((award) => award.id || award.awardId).filter(Boolean),
    accountIds,
    vendorNames,
    locationIds: unique(missionTenants.map((tenant) => tenant.locationId)),
    sourceUrls,
    researchGapIds: dossierGapIds,
    changeEventIds: dossierEventIds,
    coverage: { roles: roles.length, people: unique(roles.map((role) => role.personId)).length, missions: dossierMissionIds.length, financialMeasures: dossierFinancialIds.length, programs: programs.length, awards: organizationAwards.length, accounts: accountIds.length, vendors: vendorNames.length, locations: missionTenants.length, sources: sourceUrls.length, researchGaps: dossierGapIds.length },
    freshness: { latestObservation, reviewBy: "2026-12-29", status: latestObservation >= "2026-06-30" ? "current" : "review-due" },
    reviewState: sourceUrls.length ? "bounded-reviewed" : "needs_review",
  });
}

const output = {
  metadata: {
    schemaVersion: "1.0.0",
    generatedAt,
    status: "current",
    coverage: { dossiers: dossiers.length, tier1: dossiers.filter((row) => row.priorityTier === "tier-1").length, roles: roadmap.officialRoles.length, people: roadmap.people.length, missionClaims: missionClaims.length, financialSummaries: financialSummaries.length, researchGaps: researchGaps.length, changeEvents: changeEvents.length, dossiersWithLeadership: dossiers.filter((row) => row.coverage.roles > 0).length, dossiersWithMission: dossiers.filter((row) => row.coverage.missions > 0).length, dossiersWithFinance: dossiers.filter((row) => row.coverage.financialMeasures > 0).length },
    evidenceBoundary: "Dossiers are bounded projections of retained public evidence. Observed-current professional roles are lower-bound observations, not appointment dates. Request, authority, obligation, outlay, award value, and ceiling measures remain separate. Missing public evidence is an explicit research gap, never a negative assertion.",
    selectionPolicy: "The 100-dossier cohort prioritizes sourced leadership and oversight organizations, reviewed mission organizations, published budget sponsors, major buyers, and major vendors. Category quotas preserve breadth while deterministic ranking preserves high-value coverage.",
  },
  dossiers: dossiers.sort((a, b) => a.priorityTier.localeCompare(b.priorityTier) || b.coverage.sources - a.coverage.sources || a.label.localeCompare(b.label)),
  missionClaims,
  financialSummaries,
  researchGaps,
  changeEvents,
  people: roadmap.people,
  officialRoles: roadmap.officialRoles,
  sources: roadmap.sources,
  programLabels: Object.fromEntries((program.programs || []).map((item) => [item.id, item.label])),
  awardLabels: Object.fromEntries(awards.map((item) => [item.id || item.awardId, item.description || item.awardId || item.id])),
  accountLabels: Object.fromEntries([...accountLabelById]),
  locationLabels: Object.fromEntries([...mapLocationById].map(([id, item]) => [id, item.name])),
};

assert(output.metadata.coverage.dossiers === 100, "Organization Intelligence must publish 100 dossiers");
assert(output.metadata.coverage.roles >= 250, `Organization Intelligence requires at least 250 sourced role observations, got ${output.metadata.coverage.roles}`);
for (const dossier of dossiers) {
  assert(dossier.researchGapIds.length > 0 || dossier.sourceUrls.length > 0, `Dossier ${dossier.id} has neither evidence nor a research gap`);
  assert(dossier.reviewState !== "bounded-reviewed" || dossier.sourceUrls.length > 0, `Reviewed dossier ${dossier.id} lacks a source`);
}
output.metadata.contentHash = createHash("sha256").update(JSON.stringify({ ...output, metadata: { ...output.metadata, contentHash: undefined } })).digest("hex").slice(0, 20);
mkdirSync(dirname(SRC_OUT), { recursive: true });
mkdirSync(dirname(PUBLIC_OUT), { recursive: true });
const serialized = `${JSON.stringify(output, null, 2)}\n`;
writeFileSync(SRC_OUT, serialized);
writeFileSync(PUBLIC_OUT, serialized);
console.log(JSON.stringify({ output: SRC_OUT, publicOutput: PUBLIC_OUT, ...output.metadata.coverage, bytes: Buffer.byteLength(serialized) }, null, 2));
