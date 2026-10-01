import { createHash } from "node:crypto";

const hash = (value) => createHash("sha256").update(String(value)).digest("hex").slice(0, 20);
const rowsById = (rows = []) => new Map(rows.map((row) => [row.id, row]));
const unique = (values) => [...new Set(values.filter(Boolean))];

function host(url) {
  try { return new URL(url).hostname; } catch { return ""; }
}

function proposal(kind, row, sourceIds, observedAt, detail) {
  return {
    id: `organization-change-proposal:${hash(`${kind}|${row.id}|${observedAt}`)}`,
    kind,
    subjectId: row.id,
    subjectType: kind.includes("role") ? "official-role" : "organization-dossier",
    label: row.label || row.title || row.organizationName || row.id,
    detail,
    sourceIds: unique(sourceIds || []),
    observedAt,
    status: "needs_review",
    promotionPolicy: "explicit-review-required",
  };
}

export function buildOrganizationChangeMonitor({ currentRoles, previousRoles, currentOrganizations, previousOrganizations }) {
  const observedAt = currentRoles.metadata?.observedAt || currentOrganizations.metadata?.generatedAt?.slice(0, 10) || new Date().toISOString().slice(0, 10);
  const currentRoleById = rowsById(currentRoles.roles);
  const previousRoleById = rowsById(previousRoles?.roles);
  const currentDossierById = rowsById(currentOrganizations.dossiers);
  const previousDossierById = rowsById(previousOrganizations?.dossiers);
  const currentSourceById = rowsById(currentRoles.sources);
  const previousSourceById = rowsById(previousRoles?.sources);
  const proposals = [];

  for (const row of currentRoleById.values()) {
    if (!previousRoleById.has(row.id)) proposals.push(proposal("role-observed", row, row.sourceIds, observedAt, "A current official directory now lists this public professional role. This observation is a lower bound and does not establish an appointment date."));
  }
  for (const row of previousRoleById.values()) {
    if (!currentRoleById.has(row.id)) proposals.push(proposal("role-no-longer-listed", row, row.sourceIds, observedAt, "The role was not found in the latest official directory snapshot. Review is required; absence does not establish a tenure end date."));
  }

  const currentMissionById = rowsById(currentOrganizations.missionClaims);
  const previousMissionById = rowsById(previousOrganizations?.missionClaims);
  const currentFinanceById = rowsById(currentOrganizations.financialSummaries);
  const previousFinanceById = rowsById(previousOrganizations?.financialSummaries);
  for (const [kind, currentRows, previousRows] of [
    ["mission-claim-added", currentMissionById, previousMissionById],
    ["financial-summary-added", currentFinanceById, previousFinanceById],
  ]) {
    for (const row of currentRows.values()) {
      if (!previousRows.has(row.id)) proposals.push(proposal(kind, row, [], observedAt, "A new typed dossier claim appeared in the current verified projection and requires review before canonical promotion."));
    }
  }

  const sources = [...currentSourceById.values()].map((row) => {
    const previous = previousSourceById.get(row.id);
    const contentHash = row.contentHash || "";
    const previousContentHash = previous?.contentHash || "";
    const changeState = !contentHash ? "metadata-only" : !previous ? "new" : contentHash === previousContentHash ? "unchanged" : "changed";
    const linkedDossierIds = [...currentDossierById.values()].filter((dossier) => (dossier.sourceUrls || []).includes(row.url)).map((dossier) => dossier.id);
    return {
      id: `organization-source-monitor:${row.id}`,
      sourceId: row.id,
      label: row.title || row.id,
      publisher: row.publisher || "",
      url: row.url,
      allowedHosts: unique([host(row.url)]),
      adapter: contentHash ? "official-directory-html" : "official-source-metadata",
      cadence: contentHash ? "daily" : "weekly",
      priority: linkedDossierIds.length ? "high" : "normal",
      observedAt: row.observedAt || row.publishedAt || observedAt,
      contentHash,
      previousContentHash,
      changeState,
      linkedDossierIds,
      reviewState: changeState === "changed" || changeState === "new" ? "needs_review" : "source_snapshot",
    };
  });

  for (const row of sources.filter((sourceRow) => sourceRow.changeState === "changed" && !proposals.some((proposalRow) => proposalRow.sourceIds.includes(sourceRow.sourceId)))) {
    proposals.push({
      id: `organization-change-proposal:${hash(`source-content-changed|${row.sourceId}|${observedAt}`)}`,
      kind: "source-content-changed",
      subjectId: row.sourceId,
      subjectType: "organization-source-monitor",
      label: row.label,
      detail: "The official source content hash changed without a normalized role delta. Review the page before promoting any claim change.",
      sourceIds: [row.sourceId],
      observedAt,
      status: "needs_review",
      promotionPolicy: "explicit-review-required",
    });
  }

  const sourceObservations = sources.map((row) => ({
    id: `organization-source-observation:${hash(`${row.sourceId}|${row.contentHash || row.observedAt}`)}`,
    monitorId: row.id,
    sourceId: row.sourceId,
    observedAt: row.observedAt,
    contentHash: row.contentHash,
    changeState: row.changeState,
    linkedDossierIds: row.linkedDossierIds,
    reviewState: row.reviewState,
  }));

  const dossierChanges = [...currentDossierById.values()].filter((row) => {
    const previous = previousDossierById.get(row.id);
    return previous && JSON.stringify(row.coverage) !== JSON.stringify(previous.coverage);
  });
  for (const row of dossierChanges) proposals.push(proposal("dossier-coverage-changed", row, [], observedAt, "The dossier evidence inventory changed. Review the underlying source-backed additions or removals before promotion."));

  const coverage = {
    monitoredSources: sources.length,
    hashedSources: sources.filter((row) => row.contentHash).length,
    linkedDossiers: new Set(sources.flatMap((row) => row.linkedDossierIds)).size,
    unchangedSources: sources.filter((row) => row.changeState === "unchanged").length,
    changedSources: sources.filter((row) => row.changeState === "changed").length,
    newSources: sources.filter((row) => row.changeState === "new").length,
    metadataOnlySources: sources.filter((row) => row.changeState === "metadata-only").length,
    reviewProposals: proposals.length,
    addedRoles: proposals.filter((row) => row.kind === "role-observed").length,
    absentRoles: proposals.filter((row) => row.kind === "role-no-longer-listed").length,
  };

  const output = {
    metadata: {
      schemaVersion: "1.0.0",
      generatedAt: currentOrganizations.metadata?.generatedAt || new Date().toISOString(),
      observedAt,
      status: "current",
      coverage,
      evidenceBoundary: "Source changes create review proposals only. A missing directory entry never closes a tenure, and changed page content never overwrites a dossier without explicit review.",
    },
    sources,
    sourceObservations,
    proposals: proposals.sort((a, b) => a.kind.localeCompare(b.kind) || a.label.localeCompare(b.label)),
    queues: {
      leads: proposals.filter((row) => row.kind === "role-observed").map((row) => row.id),
      updates: proposals.filter((row) => row.kind !== "role-observed").map((row) => row.id),
      ready: [],
      duplicates: [],
      failures: [],
    },
  };
  output.metadata.contentHash = createHash("sha256").update(JSON.stringify({ ...output, metadata: { ...output.metadata, contentHash: undefined } })).digest("hex").slice(0, 20);
  return output;
}
