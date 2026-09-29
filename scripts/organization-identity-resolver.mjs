const normalizeLabel = (value) => String(value || "").trim().toUpperCase().replace(/[^A-Z0-9]+/g, "");
const normalizeUei = (value) => {
  const normalized = String(value || "").trim().toUpperCase();
  return /^[A-Z0-9]{12}$/.test(normalized) ? normalized : "";
};
const normalizeOfficeCode = (value) => String(value || "").trim().toUpperCase().replace(/[^A-Z0-9]+/g, "");

export function splitOfficeCodes(values = []) {
  return [...new Set(values.flatMap((value) => String(value || "").split(/[;,/]+/)).map(normalizeOfficeCode).filter(Boolean))];
}

export function buildOrganizationIdentityRegistry({ agents, transactions }) {
  const byUei = new Map();
  const byLabel = new Map();

  function observe({ uei, label, sourceArtifact }) {
    const exactUei = normalizeUei(uei);
    const cleanLabel = String(label || "").trim();
    const labelKey = normalizeLabel(cleanLabel);
    if (!exactUei || !labelKey) return;
    if (!byUei.has(exactUei)) byUei.set(exactUei, { uei: exactUei, aliases: new Map(), sourceArtifacts: new Map() });
    const record = byUei.get(exactUei);
    record.aliases.set(cleanLabel, (record.aliases.get(cleanLabel) || 0) + 1);
    record.sourceArtifacts.set(sourceArtifact, (record.sourceArtifacts.get(sourceArtifact) || 0) + 1);
    if (!byLabel.has(labelKey)) byLabel.set(labelKey, { labels: new Map(), ueis: new Set(), sourceArtifacts: new Map() });
    const labelRecord = byLabel.get(labelKey);
    labelRecord.labels.set(cleanLabel, (labelRecord.labels.get(cleanLabel) || 0) + 1);
    labelRecord.ueis.add(exactUei);
    labelRecord.sourceArtifacts.set(sourceArtifact, (labelRecord.sourceArtifacts.get(sourceArtifact) || 0) + 1);
  }

  for (const record of agents.records || []) {
    const observation = record.automationCoverage?.observation;
    observe({ uei: observation?.recipientUei, label: observation?.recipient, sourceArtifact: "agent-records" });
  }
  for (const actions of Object.values(transactions.byOpportunity || {})) {
    for (const action of actions || []) observe({ uei: action.uei, label: action.vendor, sourceArtifact: "capture-transactions" });
  }

  function preferredLabel(uei, fallback = "") {
    const record = byUei.get(normalizeUei(uei));
    if (!record) return String(fallback || "").trim();
    return [...record.aliases.entries()]
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))[0]?.[0] || String(fallback || "").trim();
  }

  function resolve({ label, uei, officeCode, identityClass = "other" }) {
    const cleanLabel = String(label || "").trim();
    const labelKey = normalizeLabel(cleanLabel);
    const exactUei = normalizeUei(uei);
    const exactOfficeCode = normalizeOfficeCode(officeCode);
    if (exactUei) {
      const registry = byUei.get(exactUei);
      return {
        key: `uei:${exactUei}`,
        canonicalLabel: preferredLabel(exactUei, cleanLabel),
        aliases: [...(registry?.aliases?.keys() || [])].filter((alias) => alias !== preferredLabel(exactUei, cleanLabel)),
        identity: { method: "published-uei", class: "recipient", resolutionState: "resolved", identifiers: { uei: exactUei } },
      };
    }
    if (exactOfficeCode) {
      return {
        key: `office:${exactOfficeCode}`,
        canonicalLabel: cleanLabel || exactOfficeCode,
        aliases: [],
        identity: { method: "reviewed-office-code", class: "government-office", resolutionState: "resolved", identifiers: { officeCode: exactOfficeCode } },
      };
    }
    const labelEvidence = byLabel.get(labelKey);
    if (identityClass === "recipient" && labelEvidence?.ueis.size === 1) {
      const [resolvedUei] = labelEvidence.ueis;
      const registry = byUei.get(resolvedUei);
      return {
        key: `uei:${resolvedUei}`,
        canonicalLabel: preferredLabel(resolvedUei, cleanLabel),
        aliases: [...new Set([cleanLabel, ...(registry?.aliases?.keys() || [])])].filter((alias) => alias && alias !== preferredLabel(resolvedUei, cleanLabel)),
        identity: { method: "unique-normalized-label-to-published-uei", class: "recipient", resolutionState: "derived", identifiers: { uei: resolvedUei }, matchBasis: cleanLabel },
      };
    }
    const candidateUeis = identityClass === "recipient" ? [...(labelEvidence?.ueis || [])].sort() : [];
    return {
      key: `${identityClass}:${labelKey}`,
      canonicalLabel: cleanLabel,
      aliases: [],
      identity: {
        method: candidateUeis.length > 1 ? "ambiguous-normalized-label" : "exact-normalized-public-label",
        class: identityClass,
        resolutionState: candidateUeis.length > 1 ? "needs_review" : "label_only",
        identifiers: {},
        ...(candidateUeis.length ? { candidateUeis } : {}),
      },
    };
  }

  const aliasResolutions = [...byUei.values()].filter((record) => record.aliases.size > 1).map((record) => ({
    uei: record.uei,
    canonicalLabel: preferredLabel(record.uei),
    aliases: [...record.aliases.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0])).map(([label, observations]) => ({ label, observations })),
    sourceArtifacts: Object.fromEntries(record.sourceArtifacts),
    status: "resolved_by_exact_uei",
  })).sort((left, right) => left.canonicalLabel.localeCompare(right.canonicalLabel));
  const conflicts = [...byLabel.entries()].filter(([, record]) => record.ueis.size > 1).map(([normalizedLabelValue, record]) => ({
    normalizedLabel: normalizedLabelValue,
    labels: [...record.labels.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0])).map(([label, observations]) => ({ label, observations })),
    candidateUeis: [...record.ueis].sort(),
    sourceArtifacts: Object.fromEntries(record.sourceArtifacts),
    status: "needs_review",
    reason: "The same normalized public label is published with multiple distinct UEIs; no label-only merge is permitted.",
  })).sort((left, right) => left.normalizedLabel.localeCompare(right.normalizedLabel));

  return {
    resolve,
    normalizeLabel,
    normalizeUei,
    preferredLabel,
    exactUeis: new Set(byUei.keys()),
    aliasResolutions,
    conflicts,
    metadata: {
      exactUeis: byUei.size,
      resolvedAliasGroups: aliasResolutions.length,
      ambiguousNormalizedLabels: conflicts.length,
      observationSources: ["agent-records", "capture-transactions"],
    },
  };
}
