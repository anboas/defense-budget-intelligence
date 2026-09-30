import { createHash } from "node:crypto";

const DAY_MS = 86_400_000;
const text = (value) => String(value || "").trim();
const hash = (value) => createHash("sha256").update(String(value)).digest("hex").slice(0, 20);
const dateOnly = (value) => {
  const parsed = Date.parse(text(value));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString().slice(0, 10) : null;
};
const iso = (value) => {
  const parsed = Date.parse(text(value));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
};
const addDays = (value, days) => {
  const parsed = Date.parse(text(value));
  return Number.isFinite(parsed) ? new Date(parsed + days * DAY_MS).toISOString().slice(0, 10) : null;
};
const later = (...values) => values.map((value) => Date.parse(text(value))).filter(Number.isFinite).sort((left, right) => right - left)[0];
const normalizedLifecycle = (value) => {
  const current = text(value).toLowerCase();
  if (/historical|past/.test(current)) return "historical";
  if (/upcoming|option-horizon/.test(current)) return "upcoming";
  if (/active/.test(current)) return "active";
  if (/unresolved|schedule-not|evidence-gap/.test(current)) return "unresolved";
  return current || "unknown";
};
const sameNumber = (left, right) => {
  const a = Number(left);
  const b = Number(right);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return true;
  const difference = Math.abs(a - b);
  return difference <= 0.01 || difference / Math.max(Math.abs(a), Math.abs(b), 1) <= 0.001;
};

export const TEMPORAL_EVIDENCE_SCHEMA_VERSION = "1.0.0";
export const TEMPORAL_STATUS_VALUES = Object.freeze(["current", "historical", "future", "stale", "superseded", "unknown"]);
export const CONFLICT_STATUS_VALUES = Object.freeze(["resolved_by_recency", "needs_review"]);

function sourceClock(inputs) {
  const { agents, execution, calendar, transactions, accountSpine, subawards, map, locationMetadata, monitor, discovery, core } = inputs;
  const rows = {
    "agent-records": { observedAt: agents.metadata?.generatedAt, days: 90 },
    "budget-execution": { observedAt: execution.metadata?.generatedAt, days: 90 },
    "capture-calendar": { observedAt: calendar.metadata?.generatedAt, days: 45 },
    "capture-transactions": { observedAt: transactions.metadata?.generatedAt, days: 45 },
    "account-spine": { observedAt: accountSpine.metadata?.generatedAt, days: 45, forcedStatus: accountSpine.metadata?.status === "stale" ? "stale" : null },
    "usaspending-subawards": { observedAt: subawards.metadata?.generatedAt || subawards.generatedAt, days: 45 },
    "opportunity-map-data": { observedAt: map.metadata?.generatedAt, days: 45 },
    "opportunity-map-location-metadata": { observedAt: locationMetadata.metadata?.auditedAt, reviewedAt: locationMetadata.metadata?.auditedAt, days: 365 },
    "contract-monitor": { observedAt: monitor.metadata?.generatedAt, days: 45 },
    "procurement-discovery": { observedAt: discovery.metadata?.generatedAt, days: 45 },
    "budget-core": { observedAt: core.metadata?.generatedAt, days: 365 },
    "organization-identity-registry": { observedAt: monitor.metadata?.generatedAt || discovery.metadata?.generatedAt, days: 90 },
  };
  const fallback = new Date(later(...Object.values(rows).map((item) => item.observedAt))).toISOString();
  return { rows, fallback };
}

function intervalForRelation(relation, entityById, activityById) {
  const from = entityById.get(relation.from);
  const to = entityById.get(relation.to);
  const activity = from?.opportunityId ? activityById.get(from.opportunityId) : null;
  if (to?.eventId) return { effectiveFrom: dateOnly(to.start), effectiveTo: dateOnly(to.end || to.start), basis: "event-effective-date" };
  if (to?.actionId) return { effectiveFrom: dateOnly(to.signed), effectiveTo: dateOnly(to.signed), basis: "transaction-signed-date" };
  if (from?.generatedAwardId || from?.piid && from?.startDate) return { effectiveFrom: dateOnly(from.startDate), effectiveTo: dateOnly(from.endDate), basis: "award-period-of-performance" };
  if (activity) return { effectiveFrom: dateOnly(activity.start), effectiveTo: dateOnly(activity.potentialEnd || activity.currentEnd), basis: "activity-published-window" };
  if (from?.bookId) return { effectiveFrom: "2024-10-01", effectiveTo: "2027-09-30", basis: "published-budget-fiscal-window" };
  return { effectiveFrom: null, effectiveTo: null, basis: "source-observation-window" };
}

function validityStatus({ effectiveFrom, effectiveTo, reviewBy, forcedStatus }, evaluationDate) {
  if (forcedStatus) return forcedStatus;
  const evaluation = Date.parse(evaluationDate);
  if (effectiveFrom && Date.parse(effectiveFrom) > evaluation) return "future";
  if (effectiveTo && Date.parse(effectiveTo) < evaluation) return "historical";
  if (reviewBy && Date.parse(reviewBy) < evaluation) return "stale";
  if (effectiveFrom || effectiveTo || reviewBy) return "current";
  return "unknown";
}

function createClaim({ subjectId, field, value, sourceArtifact, observedAt, sourceUrl = "", reviewState = "source_declared" }) {
  const canonicalValue = typeof value === "number" ? value : text(value);
  const id = `evidence-claim:${hash(`${subjectId}|${field}|${sourceArtifact}|${canonicalValue}`)}`;
  return { id, subjectId, field, value: canonicalValue, sourceArtifact, observedAt: iso(observedAt), sourceUrl: text(sourceUrl), reviewState };
}

function createConflict({ subjectId, opportunityId = null, field, kind, claims, winner = null, reason }) {
  const status = winner ? "resolved_by_recency" : "needs_review";
  return {
    id: `evidence-conflict:${hash(`${subjectId}|${field}|${claims.map((claim) => claim.id).sort().join("|")}`)}`,
    subjectId,
    ...(opportunityId ? { opportunityId } : {}),
    field,
    kind,
    status,
    reason,
    claimIds: claims.map((claim) => claim.id),
    ...(winner ? { winningClaimId: winner.id, resolutionBasis: "newer-current-source-observation" } : {}),
  };
}

export function buildTemporalEvidenceRegistry(inputs = {}) {
  const {
    entities,
    relations,
    agents,
    execution,
    calendar,
    transactions,
    accountSpine,
    subawards,
    map,
    locationMetadata,
    monitor,
    discovery,
    core,
    organizationConflicts = [],
    predecessorConflicts = [],
    unresolvedFollowOnClaims = [],
  } = inputs;
  const clocks = sourceClock({ agents, execution, calendar, transactions, accountSpine, subawards, map, locationMetadata, monitor, discovery, core });
  const evaluationDate = dateOnly(clocks.fallback);
  const entityById = new Map(Object.values(entities).flatMap((rows) => rows.map((item) => [item.id, item])));
  const activityById = new Map((agents.records || []).map((record) => [record.opportunityId, record]));
  const mapById = new Map((map.records || []).map((record) => [record.opportunityId, record]));
  const monitorById = new Map((monitor.records || []).map((record) => [record.opportunityId, record]));

  const statusCounts = Object.fromEntries(TEMPORAL_STATUS_VALUES.map((status) => [status, 0]));
  for (const relation of relations) {
    const clock = clocks.rows[relation.evidence?.sourceArtifact] || { observedAt: clocks.fallback, days: 90 };
    const interval = intervalForRelation(relation, entityById, activityById);
    const observedAt = iso(clock.observedAt || clocks.fallback);
    const reviewBy = addDays(clock.reviewedAt || observedAt, clock.days || 90);
    const status = validityStatus({ ...interval, reviewBy, forcedStatus: clock.forcedStatus }, evaluationDate);
    relation.validity = {
      observedAt,
      effectiveFrom: interval.effectiveFrom,
      effectiveTo: interval.effectiveTo,
      supersededAt: null,
      reviewedAt: dateOnly(clock.reviewedAt),
      reviewBy,
      status,
      basis: interval.basis,
    };
    statusCounts[status] += 1;
  }

  const claims = new Map();
  const conflicts = [];
  const addConflict = (definition) => {
    for (const claim of definition.claims) claims.set(claim.id, claim);
    conflicts.push(createConflict(definition));
  };
  const agentObservedAt = agents.metadata?.generatedAt;
  const mapObservedAt = map.metadata?.generatedAt;

  for (const record of agents.records || []) {
    const subjectId = `activity:${record.opportunityId}`;
    const mapped = mapById.get(record.opportunityId);
    const monitored = monitorById.get(record.opportunityId);
    const monitorObservation = monitored?.observation || {};
    const lifecycleClaims = [
      createClaim({ subjectId, field: "lifecycle", value: normalizedLifecycle(record.lifecycleStatus), sourceArtifact: "agent-records", observedAt: agentObservedAt, sourceUrl: record.sourceUrls?.[0] }),
      ...(mapped?.lifecycle ? [createClaim({ subjectId, field: "lifecycle", value: normalizedLifecycle(mapped.lifecycle), sourceArtifact: "opportunity-map-data", observedAt: mapObservedAt })] : []),
      ...(monitored?.lifecycle ? [createClaim({ subjectId, field: "lifecycle", value: normalizedLifecycle(monitored.lifecycle), sourceArtifact: "contract-monitor", observedAt: monitored.checkedAt, sourceUrl: monitorObservation.sourceUrl })] : []),
    ];
    if (new Set(lifecycleClaims.map((claim) => claim.value)).size > 1) {
      const winner = monitored?.status === "current" ? lifecycleClaims.find((claim) => claim.sourceArtifact === "contract-monitor") : null;
      addConflict({ subjectId, opportunityId: record.opportunityId, field: "lifecycle", kind: "lifecycle", claims: lifecycleClaims, winner, reason: winner ? "The current monitor observation is newer than the retained baseline lifecycle." : "Retained lifecycle claims disagree without a current monitor observation." });
    }

    for (const [field, baseline, observed] of [
      ["startDate", record.start, monitorObservation.startDate],
      ["currentEndDate", record.currentEnd, monitorObservation.currentEndDate],
      ["potentialEndDate", record.potentialEnd, monitorObservation.potentialEndDate],
    ]) {
      if (!baseline || !observed || dateOnly(baseline) === dateOnly(observed)) continue;
      const sourceClaims = [
        createClaim({ subjectId, field, value: dateOnly(baseline), sourceArtifact: "agent-records", observedAt: agentObservedAt, sourceUrl: record.sourceUrls?.[0] }),
        createClaim({ subjectId, field, value: dateOnly(observed), sourceArtifact: "contract-monitor", observedAt: monitored?.checkedAt, sourceUrl: monitorObservation.sourceUrl }),
      ];
      const winner = monitored?.status === "current" ? sourceClaims[1] : null;
      addConflict({ subjectId, opportunityId: record.opportunityId, field, kind: "schedule", claims: sourceClaims, winner, reason: winner ? "The current award-detail observation supersedes the retained schedule value." : "Schedule claims disagree and the newer observation is stale or unavailable." });
    }

    for (const [field, baseline, observed] of [
      ["obligatedAmount", record.obligatedAmount, monitorObservation.obligatedAmount],
      ["potentialAmount", record.potentialAmount, monitorObservation.potentialAmount],
    ]) {
      if (sameNumber(baseline, observed)) continue;
      const sourceClaims = [
        createClaim({ subjectId, field, value: Number(baseline), sourceArtifact: "agent-records", observedAt: agentObservedAt, sourceUrl: record.sourceUrls?.[0] }),
        createClaim({ subjectId, field, value: Number(observed), sourceArtifact: "contract-monitor", observedAt: monitored?.checkedAt, sourceUrl: monitorObservation.sourceUrl }),
      ];
      const winner = monitored?.status === "current" ? sourceClaims[1] : null;
      addConflict({ subjectId, opportunityId: record.opportunityId, field, kind: "amount", claims: sourceClaims, winner, reason: winner ? "The current award-detail observation supersedes the retained amount." : "Amount claims disagree and the newer observation is stale or unavailable." });
    }

    if (record.parentReference && monitorObservation.parentPiid && text(record.parentReference) !== text(monitorObservation.parentPiid)) {
      const sourceClaims = [
        createClaim({ subjectId, field: "parentAward", value: record.parentReference, sourceArtifact: "agent-records", observedAt: agentObservedAt, sourceUrl: record.sourceUrls?.[0] }),
        createClaim({ subjectId, field: "parentAward", value: monitorObservation.parentPiid, sourceArtifact: "contract-monitor", observedAt: monitored?.checkedAt, sourceUrl: monitorObservation.sourceUrl }),
      ];
      addConflict({ subjectId, opportunityId: record.opportunityId, field: "parentAward", kind: "lineage", claims: sourceClaims, winner: null, reason: "Published parent-award identifiers disagree; no lineage edge is promoted from recency alone." });
    }
  }

  for (const item of organizationConflicts) {
    const subjectId = `organization-review:${hash(item.normalizedLabel || item.label)}`;
    const sourceClaims = (item.candidateUeis || []).map((uei) => createClaim({ subjectId, field: "organizationIdentity", value: uei, sourceArtifact: "organization-identity-registry", observedAt: clocks.rows["organization-identity-registry"].observedAt, reviewState: "needs_review" }));
    if (sourceClaims.length > 1) addConflict({ subjectId, field: "organizationIdentity", kind: "identity", claims: sourceClaims, winner: null, reason: "One normalized public label maps to multiple published UEIs; no fuzzy merge is permitted." });
  }

  for (const item of predecessorConflicts) {
    const subjectId = `activity:${item.activityId}`;
    const sourceClaims = (item.candidateActivityIds || [item.predecessorReference]).map((value) => createClaim({ subjectId, field: "predecessor", value, sourceArtifact: "agent-records", observedAt: agentObservedAt, sourceUrl: item.sourceUrls?.[0], reviewState: "needs_review" }));
    addConflict({ subjectId, opportunityId: item.activityId, field: "predecessor", kind: "lineage", claims: sourceClaims, winner: null, reason: item.status === "ambiguous" ? "Multiple retained activities match the predecessor reference." : "The predecessor reference does not resolve to one retained activity." });
  }

  for (const item of unresolvedFollowOnClaims) {
    const subjectId = `activity:${item.activityId}`;
    const sourceClaims = [createClaim({ subjectId, field: "followOnClaim", value: item.claim, sourceArtifact: "agent-records", observedAt: agentObservedAt, sourceUrl: item.sourceUrls?.[0], reviewState: "needs_review" })];
    addConflict({ subjectId, opportunityId: item.activityId, field: "followOnClaim", kind: "lineage", claims: sourceClaims, winner: null, reason: item.reason });
  }

  const conflictCounts = Object.fromEntries(CONFLICT_STATUS_VALUES.map((status) => [status, conflicts.filter((item) => item.status === status).length]));
  const kindCounts = Object.fromEntries([...new Set(conflicts.map((item) => item.kind))].sort().map((kind) => [kind, conflicts.filter((item) => item.kind === kind).length]));
  const activityValidity = new Map();
  for (const record of agents.records || []) {
    const interval = { effectiveFrom: dateOnly(record.start), effectiveTo: dateOnly(record.potentialEnd || record.currentEnd), reviewBy: addDays(record.lastSeenAt || agentObservedAt, 90) };
    const sourceStatus = monitorById.get(record.opportunityId)?.status === "stale" ? "stale" : null;
    activityValidity.set(record.opportunityId, { ...interval, observedAt: iso(record.lastSeenAt || agentObservedAt), status: validityStatus({ ...interval, forcedStatus: sourceStatus }, evaluationDate), basis: "activity-published-window" });
  }

  const conflictsByActivity = new Map();
  for (const conflict of conflicts.filter((item) => item.opportunityId)) conflictsByActivity.set(conflict.opportunityId, [...(conflictsByActivity.get(conflict.opportunityId) || []), conflict]);
  const claimById = claims;
  const byActivity = Object.fromEntries([...activityValidity.entries()].map(([opportunityId, validity]) => [opportunityId, {
    validity,
    conflicts: (conflictsByActivity.get(opportunityId) || []).map((conflict) => ({
      id: conflict.id,
      field: conflict.field,
      kind: conflict.kind,
      status: conflict.status,
      reason: conflict.reason,
      resolutionBasis: conflict.resolutionBasis || null,
      winningClaimId: conflict.winningClaimId || null,
      claims: conflict.claimIds.map((id) => claimById.get(id)),
    })),
  }]));

  return {
    metadata: {
      schemaVersion: TEMPORAL_EVIDENCE_SCHEMA_VERSION,
      generatedAt: clocks.fallback,
      evaluationDate,
      trustBoundary: "Temporal state comes from explicit source dates and bounded review windows. Newer current observations may supersede older values; stale, ambiguous, or identifier-conflicting claims remain unresolved.",
    },
    relationStatusCounts: statusCounts,
    conflicts,
    claims: [...claims.values()],
    byActivity,
    review: {
      summary: {
        relationsAssessed: relations.length,
        ...statusCounts,
        totalConflicts: conflicts.length,
        ...conflictCounts,
        kinds: kindCounts,
      },
    },
  };
}
