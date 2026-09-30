import { createHash } from "node:crypto";

const DAY_MS = 86_400_000;
const FOLLOW_ON_PATTERN = /\b(?:follow[ -]?on|recompete)\b/i;

const text = (value) => String(value || "").trim();
const normalized = (value) => text(value).toUpperCase().replace(/[^A-Z0-9]+/g, "");
const hash = (value) => createHash("sha256").update(String(value)).digest("hex").slice(0, 20);
const referenceTokens = (value) => text(value).split(/\s*\/\s*/).map(normalized).filter(Boolean);
const normalizedPathLabel = (value) => text(value).replace(/\*+$/, "").trim();

export const CONTRACT_LINEAGE_SCHEMA_VERSION = "1.0.0";

export function buildContractLineageRegistry({ activities = [], monitorRecords = [], awards = [], asOf } = {}) {
  const activitiesByReference = new Map();
  for (const record of activities) {
    for (const reference of referenceTokens(record.reference)) {
      activitiesByReference.set(reference, [...(activitiesByReference.get(reference) || []), record]);
    }
  }

  const exactVehicles = new Map();
  const exactOrders = [];
  const namedPaths = new Map();
  const activityPaths = [];
  const vehiclePathLinks = new Map();

  for (const record of monitorRecords) {
    const observation = record.observation || {};
    const parentGeneratedAwardId = text(observation.parentAwardId);
    const parentPiid = text(observation.parentPiid);
    if (parentGeneratedAwardId && parentPiid) {
      const existing = exactVehicles.get(parentGeneratedAwardId) || {
        key: parentGeneratedAwardId,
        generatedAwardId: parentGeneratedAwardId,
        piid: parentPiid,
        label: parentPiid,
        kind: "idv",
        sourceUrls: new Set(),
        activityIds: new Set(),
        childPiids: new Set(),
      };
      existing.activityIds.add(record.opportunityId);
      if (observation.piid) existing.childPiids.add(text(observation.piid));
      if (observation.sourceUrl) existing.sourceUrls.add(text(observation.sourceUrl));
      exactVehicles.set(parentGeneratedAwardId, existing);
      exactOrders.push({
        activityId: record.opportunityId,
        childGeneratedAwardId: text(observation.generatedAwardId || record.generatedAwardId),
        childPiid: text(observation.piid || record.reference),
        parentGeneratedAwardId,
        parentPiid,
        awardType: text(observation.awardType),
        sourceUrl: text(observation.sourceUrl),
      });
    }
  }

  for (const record of activities) {
    const label = normalizedPathLabel(record.vehicle);
    if (!label || /^TBD$/i.test(label)) continue;
    const key = normalized(label);
    const existing = namedPaths.get(key) || { key, label, activityIds: new Set(), sourceUrls: new Set() };
    existing.activityIds.add(record.opportunityId);
    for (const url of record.sourceUrls || []) existing.sourceUrls.add(text(url));
    namedPaths.set(key, existing);
    activityPaths.push({ activityId: record.opportunityId, pathKey: key, label, sourceUrl: text(record.sourceUrls?.[0]) });
  }

  const exactOrderByActivity = new Map(exactOrders.map((item) => [item.activityId, item]));
  for (const activityPath of activityPaths) {
    const exactOrder = exactOrderByActivity.get(activityPath.activityId);
    if (!exactOrder) continue;
    const key = `${exactOrder.parentGeneratedAwardId}|${activityPath.pathKey}`;
    if (!vehiclePathLinks.has(key)) vehiclePathLinks.set(key, { parentGeneratedAwardId: exactOrder.parentGeneratedAwardId, pathKey: activityPath.pathKey, activityIds: new Set() });
    vehiclePathLinks.get(key).activityIds.add(activityPath.activityId);
  }

  const predecessorLinks = [];
  const predecessorConflicts = [];
  for (const successor of activities.filter((record) => record.parentReference)) {
    const predecessorReference = normalized(successor.parentReference);
    const candidates = (activitiesByReference.get(predecessorReference) || []).filter((candidate) => candidate.opportunityId !== successor.opportunityId);
    const contractCandidates = candidates.filter((candidate) => candidate.mode === "contract-performance");
    const eligible = contractCandidates.length ? contractCandidates : candidates;
    if (eligible.length !== 1) {
      predecessorConflicts.push({
        activityId: successor.opportunityId,
        title: successor.title,
        predecessorReference: successor.parentReference,
        basis: successor.parentReferenceBasis,
        status: eligible.length ? "ambiguous" : "unresolved",
        candidateActivityIds: eligible.map((candidate) => candidate.opportunityId),
        sourceUrls: successor.sourceUrls || [],
      });
      continue;
    }
    const predecessor = eligible[0];
    const curated = /curated/i.test(successor.parentReferenceBasis || "");
    predecessorLinks.push({
      successorActivityId: successor.opportunityId,
      predecessorActivityId: predecessor.opportunityId,
      predecessorReference: text(successor.parentReference),
      basis: text(successor.parentReferenceBasis) || "Source-declared predecessor PIID",
      confidence: curated ? "reviewed" : "exact",
      reviewState: curated ? "reviewed" : "verified",
      sourceUrl: text(successor.sourceUrls?.[0]),
    });
  }

  const linkedSuccessors = new Set(predecessorLinks.map((item) => item.successorActivityId));
  const unresolvedFollowOnClaims = activities
    .filter((record) => FOLLOW_ON_PATTERN.test(`${record.title || ""} ${record.context || ""} ${record.sourceDescription || ""}`) && !linkedSuccessors.has(record.opportunityId))
    .map((record) => ({
      activityId: record.opportunityId,
      reference: record.reference || null,
      title: record.title,
      lifecycle: record.lifecycleStatus,
      claim: /recompete/i.test(`${record.title || ""} ${record.context || ""}`) ? "recompete" : "follow-on",
      status: "needs_review",
      reason: "Published wording indicates lineage, but no exact or reviewed predecessor identifier is retained.",
      sourceUrls: record.sourceUrls || [],
    }));

  const asOfDate = text(asOf);
  const asOfTime = Date.parse(asOfDate);
  const timingSignals = awards.flatMap((award) => {
    const endTime = Date.parse(award.endDate || "");
    if (!Number.isFinite(asOfTime) || !Number.isFinite(endTime)) return [];
    const daysUntilEnd = Math.floor((endTime - asOfTime) / DAY_MS);
    if (daysUntilEnd < 0 || daysUntilEnd > 730) return [];
    return [{
      id: `recompete-signal:${hash(award.id)}`,
      awardGeneratedId: award.id,
      piid: award.awardId,
      endDate: award.endDate,
      daysUntilEnd,
      status: "candidate",
      confidence: "derived",
      reviewState: "needs_review",
      basis: "reported-end-within-730-days",
      caveat: "A reported period-of-performance end is a timing signal, not evidence that a recompete or follow-on exists.",
    }];
  });

  const familySizes = [...exactVehicles.values()].map((vehicle) => vehicle.activityIds.size);
  const resolvedExactVehicles = [...exactVehicles.values()].map((vehicle) => ({
    ...vehicle,
    sourceUrls: [...vehicle.sourceUrls].sort(),
    activityIds: [...vehicle.activityIds].sort(),
    childPiids: [...vehicle.childPiids].sort(),
  })).sort((left, right) => left.piid.localeCompare(right.piid));
  const resolvedNamedPaths = [...namedPaths.values()].map((path) => ({
    ...path,
    sourceUrls: [...path.sourceUrls].filter(Boolean).sort(),
    activityIds: [...path.activityIds].sort(),
  })).sort((left, right) => left.label.localeCompare(right.label));
  const resolvedVehiclePathLinks = [...vehiclePathLinks.values()].map((item) => ({ ...item, activityIds: [...item.activityIds].sort() }));

  return {
    metadata: {
      schemaVersion: CONTRACT_LINEAGE_SCHEMA_VERSION,
      asOf: asOfDate,
      trustBoundary: "Exact USAspending parent award identifiers establish order-to-IDV lineage. Published acquisition-path labels remain source-declared. A reported end date creates a review-only timing signal and never asserts a recompete.",
    },
    exactVehicles: resolvedExactVehicles,
    exactOrders,
    namedPaths: resolvedNamedPaths,
    activityPaths,
    vehiclePathLinks: resolvedVehiclePathLinks,
    predecessorLinks,
    timingSignals,
    review: {
      summary: {
        exactParentVehicles: resolvedExactVehicles.length,
        activitiesWithExactParent: exactOrders.length,
        multiOrderFamilies: familySizes.filter((count) => count > 1).length,
        ordersInMultiOrderFamilies: familySizes.filter((count) => count > 1).reduce((total, count) => total + count, 0),
        namedAcquisitionPaths: resolvedNamedPaths.length,
        activitiesWithNamedPath: activityPaths.length,
        exactVehiclePathCrosswalks: resolvedVehiclePathLinks.length,
        resolvedPredecessorLinks: predecessorLinks.length,
        predecessorConflicts: predecessorConflicts.length,
        unresolvedFollowOnClaims: unresolvedFollowOnClaims.length,
        recompeteTimingSignals: timingSignals.length,
      },
      predecessorConflicts,
      unresolvedFollowOnClaims,
    },
  };
}
