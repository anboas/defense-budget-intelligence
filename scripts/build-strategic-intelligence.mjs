import { createHash } from "node:crypto";
import { readFileSync, renameSync, writeFileSync } from "node:fs";

const OUT = "src/data/strategic-intelligence.json";
const calendar = JSON.parse(readFileSync("public/data/capture-calendar.json", "utf8"));
const locations = JSON.parse(readFileSync("public/data/opportunity-map-data.json", "utf8"));
const metadata = JSON.parse(readFileSync("public/data/opportunity-map-location-metadata.json", "utf8"));
const coverage = JSON.parse(readFileSync("src/data/usaspending-coverage.json", "utf8"));
const accounts = JSON.parse(readFileSync("src/data/account-spine.json", "utf8"));
const hash = (value) => createHash("sha256").update(String(value)).digest("hex").slice(0, 20);
const asOf = accounts.metadata?.asOf || coverage.metadata?.asOf || new Date().toISOString().slice(0, 10);
const mapLocation = new Map((locations.locations || []).map((row) => [row.id, row]));
const officialUrl = (value) => {
  try {
    const url = new URL(String(value || "").trim());
    return /(?:^|\.)(?:gov|mil)$/.test(url.hostname) ? url.href : "";
  } catch { return ""; }
};
const sourceUrls = (row) => (row.sourceUrls || []).flatMap((value) => String(value || "").split(/\s*;\s*/)).map(officialUrl).filter(Boolean);

const forecasts = (calendar.records || []).filter((row) => (row.ingestionChannels || []).some((channel) => channel.id === "agency-forecast"))
  .map((row) => ({
    id: `acquisition-forecast:${row.opportunityId}`,
    activityId: `activity:${row.opportunityId}`,
    label: row.title,
    portfolio: row.portfolio || null,
    reference: row.reference || null,
    solicitationStart: row.solicitationStart || row.start || null,
    solicitationEnd: row.solicitationEnd || row.currentEnd || null,
    competitionType: row.competitionType || null,
    setAside: row.setAside || null,
    valueLow: row.valueLow ?? null,
    valueHigh: row.valueHigh ?? null,
    status: row.lifecycleStatus || row.validationStatus || "unknown",
    evidenceTier: row.evidenceTier || null,
    sourceUrls: sourceUrls(row),
    reviewState: sourceUrls(row).length ? (row.validationStatus === "unresolved" ? "needs_review" : "source_snapshot") : "unavailable",
  }));

const missionAssignments = [];
const tenantAssignments = [];
for (const [locationId, profile] of Object.entries(metadata.locations || {})) {
  const location = mapLocation.get(locationId);
  if (!location || profile.passes?.mission?.state !== "reviewed" || !profile.evidence?.primarySource?.url) continue;
  const sourceUrl = officialUrl(profile.evidence.primarySource.url);
  if (!sourceUrl) continue;
  const missionId = `mission-assignment:${hash(`${locationId}|${profile.summary}`)}`;
  missionAssignments.push({ id: missionId, locationId: `location:${locationId}`, label: `${location.name} mission`, summary: profile.summary, verifiedClaims: profile.evidence.verifiedClaims || [], reviewedAt: profile.evidence.reviewedAt || profile.evidence.auditedAt || null, sourceUrl, supports: profile.evidence.primarySource.supports || null, reviewState: "reviewed" });
  for (const organization of profile.identity?.organizations || []) {
    const organizationUrl = officialUrl(organization.url);
    if (!organization.name || !organizationUrl) continue;
    tenantAssignments.push({ id: `installation-tenant:${hash(`${locationId}|${organization.name}`)}`, locationId: `location:${locationId}`, organizationName: organization.name, label: `${organization.name} at ${location.name}`, sourceUrl: organizationUrl, reviewedAt: profile.evidence.reviewedAt || null, reviewState: "reviewed" });
  }
}

const competitiveSignals = (calendar.records || []).filter((row) => (row.competitionType || row.setAside) && sourceUrls(row).length).map((row) => ({
  id: `competitive-signal:${hash(row.opportunityId)}`,
  targetId: `activity:${row.opportunityId}`,
  label: `${row.title} competition posture`,
  competitionType: row.competitionType || null,
  setAside: row.setAside || null,
  evaluationDate: asOf,
  modelVersion: "deterministic-1.0.0",
  reviewState: "source_snapshot",
  sourceUrls: sourceUrls(row),
  caveat: "Published forecast posture is not proof of the final solicitation strategy.",
}));

const asOfMs = Date.parse(asOf);
const expirationSignals = (coverage.awards || []).filter((row) => {
  const end = Date.parse(row.endDate || "");
  const days = (end - asOfMs) / 86_400_000;
  return Number.isFinite(days) && days >= -180 && days <= 1095;
}).slice(0, 750).map((row) => {
  const daysUntilEnd = Math.round((Date.parse(row.endDate) - asOfMs) / 86_400_000);
  return {
    id: `expiration-signal:${hash(`${row.generatedAwardId}|${row.endDate}`)}`,
    targetAwardId: `award:${row.generatedAwardId}`,
    label: `${row.piid || row.generatedAwardId} reported end`,
    reportedEndDate: row.endDate,
    daysUntilEnd,
    horizon: daysUntilEnd < 0 ? "recently-ended" : daysUntilEnd <= 365 ? "within-12-months" : daysUntilEnd <= 730 ? "within-24-months" : "within-36-months",
    evaluationDate: asOf,
    modelVersion: "deterministic-1.0.0",
    reviewState: "review_only",
    sourceUrl: row.sourceUrl,
    caveat: "Reported award end date is not proof of a recompete, follow-on, option exercise, or funding availability.",
  };
});

const executionRiskSignals = (accounts.executionBalances || []).filter((row) => {
  const resources = Number(row.obligatedAmount || 0) + Number(row.unobligatedAmount || 0);
  const unobligated = Number(row.unobligatedAmount || 0);
  return row.fiscalYear === 2026 && resources > 0 && unobligated > 0 && unobligated / resources >= 0.25;
}).slice(0, 750).map((row) => ({
  id: `execution-risk-signal:${hash(row.id)}`,
  targetBalanceId: row.id,
  label: `${row.tasCode} unobligated-share review`,
  unobligatedShare: Number(row.unobligatedAmount || 0) / Math.max(1, Number(row.obligatedAmount || 0) + Number(row.unobligatedAmount || 0)),
  availability: row.availability,
  fiscalYear: row.fiscalYear,
  evaluationDate: asOf,
  modelVersion: "deterministic-1.0.0",
  reviewState: "review_only",
  sourceUrl: row.sourceUrl,
  caveat: "A high unobligated share is a review trigger, not evidence of execution failure; timing, transfer, and availability rules may explain the balance.",
}));

const outcomeEvidence = (calendar.records || []).filter((row) => row.liveAward?.generatedAwardId || (row.transactionSummary?.primaryActions || 0) > 0).map((row) => ({
  id: `outcome-evidence:${hash(row.opportunityId)}`,
  targetActivityId: `activity:${row.opportunityId}`,
  awardId: row.liveAward?.generatedAwardId ? `award:${row.liveAward.generatedAwardId}` : null,
  label: `${row.title} award activity observed`,
  outcome: row.liveAward?.generatedAwardId ? "award-observed" : "transaction-activity-observed",
  actionCount: row.transactionSummary?.primaryActions || 0,
  lastActionDate: row.transactionSummary?.lastSigned || null,
  sourceUrls: sourceUrls(row),
  evaluationDate: asOf,
  reviewState: "source_snapshot",
  caveat: "Observed award activity does not prove program success, delivery quality, or mission outcome.",
}));

const sourceHealth = [
  { id: "agency-forecasts", label: "Agency acquisition forecasts", status: forecasts.length ? "partial" : "unavailable", records: forecasts.length, reason: "Forecast publication is fragmented across agencies; adapters retain only ingested source-declared records." },
  { id: "sbir-sttr", label: "SBIR/STTR topics and awards", status: "unavailable", records: 0, url: "https://www.sbir.gov/api", reason: "The official API is under maintenance and its public endpoint rejects collection. No empty snapshot is treated as coverage." },
  { id: "gao-protests", label: "GAO bid protest decisions", status: "partial", records: 0, url: "https://www.gao.gov/legal/bid-protests/search", reason: "GAO publishes selected decisions; many dismissals and corrective actions are not public. No award-level signal is promoted without an exact PIID or notice identifier." },
  { id: "audit-findings", label: "Audit findings", status: "not_configured", records: 0, reason: "No stable exact award/account crosswalk is configured. Audit signals remain blocked by the promotion gate." },
];

const payload = {
  metadata: {
    schemaVersion: "1.0.0",
    generatedAt: new Date().toISOString(),
    asOf,
    coverage: { forecasts: forecasts.length, reviewedMissionAssignments: missionAssignments.length, reviewedTenantAssignments: tenantAssignments.length, competitiveSignals: competitiveSignals.length, expirationSignals: expirationSignals.length, executionRiskSignals: executionRiskSignals.length, outcomeEvidence: outcomeEvidence.length },
    promotionPolicy: "Derived signals require stable source identity, an evaluation date, model version, retained inputs, a caveat, and review-only status unless the source publishes the fact directly.",
    contentHash: hash(JSON.stringify({ forecasts, missionAssignments, tenantAssignments, competitiveSignals, expirationSignals, executionRiskSignals, outcomeEvidence })),
  },
  forecasts,
  missionAssignments,
  tenantAssignments,
  competitiveSignals,
  expirationSignals,
  executionRiskSignals,
  outcomeEvidence,
  sourceHealth,
};
const tmp = `${OUT}.tmp`;
writeFileSync(tmp, `${JSON.stringify(payload, null, 2)}\n`);
renameSync(tmp, OUT);
console.log(`Strategic intelligence: ${forecasts.length} forecasts, ${missionAssignments.length} missions, ${tenantAssignments.length} tenants, ${competitiveSignals.length + expirationSignals.length + executionRiskSignals.length} gated signals, ${outcomeEvidence.length} outcomes`);
