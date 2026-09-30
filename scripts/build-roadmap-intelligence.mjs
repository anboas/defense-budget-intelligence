import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const DATA = resolve(ROOT, "src/data");
const PUBLIC = resolve(ROOT, "public/data");
const OUT = resolve(DATA, "roadmap-intelligence.json");
const PUBLIC_OUT = resolve(PUBLIC, "roadmap-intelligence.json");
const read = (path) => JSON.parse(readFileSync(path, "utf8"));
const hash = (value) => createHash("sha256").update(String(value)).digest("hex").slice(0, 20);
const normalized = (value) => String(value || "").trim().toUpperCase().replace(/[^A-Z0-9]+/g, "");
const safeUrl = (value) => {
  try {
    const url = new URL(String(value || ""));
    return ["http:", "https:"].includes(url.protocol) ? url.href : "";
  } catch {
    return "";
  }
};
const sortedUnique = (values) => [...new Set(values.filter(Boolean).map((value) => String(value).trim()))].sort();
const minDate = (values) => sortedUnique(values).at(0) || "";
const maxDate = (values) => sortedUnique(values).at(-1) || "";
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const curatedRoles = read(resolve(DATA, "official-role-sources.json"));
const roleDirectory = read(resolve(DATA, "official-role-directory-snapshot.json"));
const subawards = read(resolve(DATA, "usaspending-subawards.json"));
const program = read(resolve(DATA, "program-intelligence.json"));
const legislation = read(resolve(DATA, "legislative-traceability.json"));
const execution = read(resolve(PUBLIC, "budget-execution.json"));
const agents = read(resolve(PUBLIC, "agent-records.json"));
const generatedAt = new Date().toISOString();

const personKey = (value) => String(value || "").toLowerCase()
  .replace(/\b(senator|representative|rep|dr|jr|sr|ii|iii|iv)\b\.?/g, " ")
  .replace(/\b[a-z]\b/g, " ")
  .replace(/[^a-z0-9]+/g, " ")
  .trim();
const curatedPersonByKey = new Map(curatedRoles.people.map((person) => [personKey(person.label), person]));
const directoryPersonRemap = new Map();
for (const person of roleDirectory.people || []) {
  const existing = curatedPersonByKey.get(personKey(person.label));
  directoryPersonRemap.set(person.id, existing?.id || person.id);
}
const roles = {
  sources: [...new Map([...(curatedRoles.sources || []), ...(roleDirectory.sources || [])].map((row) => [row.id, row])).values()],
  people: [...new Map([
    ...(curatedRoles.people || []),
    ...(roleDirectory.people || []).map((person) => ({ ...person, id: directoryPersonRemap.get(person.id) || person.id })),
  ].map((row) => [row.id, row])).values()],
  roles: [...new Map([
    ...(curatedRoles.roles || []),
    ...(roleDirectory.roles || []).map((role) => ({ ...role, personId: directoryPersonRemap.get(role.personId) || role.personId })),
  ].map((row) => [row.id, row])).values()],
  successions: curatedRoles.successions || [],
  organizations: roleDirectory.organizations || [],
};

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const sourceById = new Map(roles.sources.map((source) => [source.id, source]));
for (const source of roles.sources) {
  assert(source.id && source.title && safeUrl(source.url), `Official role source ${source.id || "unknown"} is incomplete`);
}
const peopleById = new Map(roles.people.map((person) => [person.id, person]));
const rolesById = new Map(roles.roles.map((role) => [role.id, role]));
assert(peopleById.size === roles.people.length, "Official people IDs must be unique");
assert(rolesById.size === roles.roles.length, "Official role IDs must be unique");
for (const role of roles.roles) {
  assert(peopleById.has(role.personId), `Official role ${role.id} references an unknown person`);
  assert(role.effectiveFrom || role.effectiveTo, `Official role ${role.id} requires at least one effective boundary`);
  assert(role.sourceIds?.length, `Official role ${role.id} requires source evidence`);
  assert(role.sourceIds.every((sourceId) => sourceById.has(sourceId)), `Official role ${role.id} references an unknown source`);
  assert(role.reviewState && role.evidenceQuote, `Official role ${role.id} requires review state and evidence`);
}
for (const succession of roles.successions) {
  assert(rolesById.has(succession.predecessorRoleId) && rolesById.has(succession.successorRoleId), `Succession ${succession.id} references an unknown role`);
  assert(sourceById.has(succession.sourceId), `Succession ${succession.id} references an unknown source`);
}

const supplierMap = new Map();
for (const prime of subawards.primes || []) {
  for (const row of prime.subawards || []) {
    const primeName = String(prime.primeRecipient || "").trim();
    const recipientName = String(row.recipientName || "").trim();
    if (!primeName || !recipientName) continue;
    const key = `${normalized(primeName)}|${normalized(recipientName)}`;
    const current = supplierMap.get(key) || {
      id: `supplier-relationship:${hash(key)}`,
      label: `${primeName} → ${recipientName}`,
      primeName,
      supplierName: recipientName,
      primeAwardIds: new Set(),
      subawardCount: 0,
      sampledAmountDollars: 0,
      actionDates: [],
      sourceArtifact: "usaspending-subawards",
      coverageState: "partial",
      reviewState: "source_snapshot",
    };
    current.primeAwardIds.add(prime.primeAwardId);
    current.subawardCount += 1;
    current.sampledAmountDollars += Number(row.amount || 0);
    if (row.actionDate) current.actionDates.push(row.actionDate);
    supplierMap.set(key, current);
  }
}
const supplierRelationships = [...supplierMap.values()]
  .map((row) => ({
    ...row,
    primeAwardIds: [...row.primeAwardIds].sort(),
    earliestActionDate: minDate(row.actionDates),
    latestActionDate: maxDate(row.actionDates),
    actionDates: undefined,
  }))
  .sort((a, b) => b.sampledAmountDollars - a.sampledAmountDollars || b.subawardCount - a.subawardCount)
  .slice(0, 1000);

const awards = execution.awardDrilldown?.awards || [];
const buyerMap = new Map();
const vendorMap = new Map();
for (const award of awards) {
  const buyer = String(award.awardingOffice || award.buyerSubAgency || award.awardingSubAgency || "").trim();
  const vendor = String(award.recipient || "").trim();
  const amount = Number(award.awardAmountDollars || award.awardAmount || 0);
  if (buyer && vendor) {
    const buyerKey = normalized(buyer);
    const buyerProfile = buyerMap.get(buyerKey) || { id: `buyer-profile:${hash(buyerKey)}`, label: buyer, awardCount: 0, totalAwardValueDollars: 0, vendorAmounts: new Map(), naicsCodes: new Set(), pscCodes: new Set() };
    buyerProfile.awardCount += 1;
    buyerProfile.totalAwardValueDollars += amount;
    buyerProfile.vendorAmounts.set(vendor, Number(buyerProfile.vendorAmounts.get(vendor) || 0) + amount);
    if (award.naicsCode) buyerProfile.naicsCodes.add(String(award.naicsCode));
    if (award.pscCode) buyerProfile.pscCodes.add(String(award.pscCode));
    buyerMap.set(buyerKey, buyerProfile);

    const vendorKey = normalized(vendor);
    const vendorProfile = vendorMap.get(vendorKey) || { id: `vendor-profile:${hash(vendorKey)}`, label: vendor, awardCount: 0, totalAwardValueDollars: 0, buyers: new Set(), naicsCodes: new Set(), pscCodes: new Set(), awardIds: new Set() };
    vendorProfile.awardCount += 1;
    vendorProfile.totalAwardValueDollars += amount;
    vendorProfile.buyers.add(buyer);
    vendorProfile.awardIds.add(award.id || award.awardId);
    if (award.naicsCode) vendorProfile.naicsCodes.add(String(award.naicsCode));
    if (award.pscCode) vendorProfile.pscCodes.add(String(award.pscCode));
    vendorMap.set(vendorKey, vendorProfile);
  }
}

const buyerProfiles = [...buyerMap.values()].map((profile) => {
  const vendors = [...profile.vendorAmounts.entries()].sort((a, b) => b[1] - a[1]);
  const shares = profile.totalAwardValueDollars > 0 ? vendors.map(([, amount]) => amount / profile.totalAwardValueDollars) : [];
  return {
    id: profile.id,
    label: profile.label,
    awardCount: profile.awardCount,
    totalAwardValueDollars: profile.totalAwardValueDollars,
    vendorCount: vendors.length,
    topVendor: vendors[0]?.[0] || "",
    topVendorShare: shares[0] || 0,
    concentrationHhi: shares.reduce((total, share) => total + share ** 2, 0),
    naicsCodes: [...profile.naicsCodes].sort(),
    pscCodes: [...profile.pscCodes].sort(),
    evidenceBasis: "exact-retained-award-office-and-recipient",
    reviewState: "deterministic",
  };
}).sort((a, b) => b.totalAwardValueDollars - a.totalAwardValueDollars);

const vendorProfiles = [...vendorMap.values()].map((profile) => ({
  id: profile.id,
  label: profile.label,
  awardCount: profile.awardCount,
  totalAwardValueDollars: profile.totalAwardValueDollars,
  buyerCount: profile.buyers.size,
  buyers: [...profile.buyers].sort(),
  awardIds: [...profile.awardIds].filter(Boolean).sort(),
  naicsCodes: [...profile.naicsCodes].sort(),
  pscCodes: [...profile.pscCodes].sort(),
  evidenceBasis: "exact-retained-award-recipient",
  reviewState: "deterministic",
})).sort((a, b) => b.totalAwardValueDollars - a.totalAwardValueDollars);

const incumbentPositions = (agents.records || []).filter((record) => record.party && (record.liveAward || record.reference)).map((record) => ({
  id: `incumbent-position:${hash(`${record.opportunityId}|${record.party}`)}`,
  label: `${record.party} on ${record.title}`,
  activityId: record.opportunityId,
  organizationName: record.party,
  reference: record.reference || "",
  position: "reported-incumbent-or-awardee",
  observedAt: record.lastSeenAt || record.validationCheckedAt || agents.metadata?.asOf || generatedAt,
  sourceUrls: sortedUnique(record.sourceUrls || []),
  evidenceBasis: record.liveAward ? "retained-live-award" : "source-declared-party",
  reviewState: record.liveAward ? "source_snapshot" : "needs_review",
}));

const programMarks = new Map();
for (const mark of program.appropriationMarks || []) {
  if (!programMarks.has(mark.programId)) programMarks.set(mark.programId, []);
  programMarks.get(mark.programId).push(mark);
}
const programFindings = new Map();
for (const finding of program.findings || []) {
  if (!programFindings.has(finding.programId)) programFindings.set(finding.programId, []);
  programFindings.get(finding.programId).push(finding);
}
const baselineCounts = new Map();
for (const baseline of program.programBaselines || []) baselineCounts.set(baseline.programId, Number(baselineCounts.get(baseline.programId) || 0) + 1);
const programHealthProfiles = (program.programs || []).map((item) => {
  const marks = programMarks.get(item.id) || [];
  const findings = programFindings.get(item.id) || [];
  const changedMarks = marks.filter((mark) => Number(mark.changeAmountThousands || 0) !== 0);
  const riskCount = findings.filter((finding) => finding.kind === "program-risk").length;
  const healthState = riskCount ? "attention" : changedMarks.length ? "legislative-change" : "baseline-only";
  return {
    id: `program-health-profile:${item.id.split(":").at(-1)}`,
    label: item.label,
    programId: item.id,
    healthState,
    requestBaselineCount: Number(baselineCounts.get(item.id) || 0),
    markCount: marks.length,
    changedMarkCount: changedMarks.length,
    findingCount: findings.length,
    riskCount,
    evidenceCompleteness: clamp((Number(baselineCounts.get(item.id) || 0) ? 0.4 : 0) + (marks.length ? 0.25 : 0) + (findings.length ? 0.35 : 0), 0, 1),
    evidenceBoundary: "A profile summarizes retained evidence; it is not a predictive program rating.",
    reviewState: "deterministic",
  };
});

const accountabilityFindings = (program.findings || []).map((finding) => ({
  id: `accountability-finding:${hash(finding.id)}`,
  label: finding.label,
  findingType: finding.kind,
  targetProgramId: finding.programId,
  finding: finding.finding || finding.label,
  amountDollars: Number(finding.amountDollars || finding.estimateDollars || 0),
  sourceId: finding.sourceId,
  sourceUrl: finding.sourceUrl,
  observedAt: sourceById.get(finding.sourceId)?.publishedAt || program.sources?.find((source) => source.id === finding.sourceId)?.publishedAt || "",
  resolutionState: "open-evidence",
  coverageState: "bounded",
  reviewState: finding.reviewState || "source_snapshot",
}));

const officialDocuments = [];
const documentVersions = [];
const documentSections = [];
const documentTables = [];
const citations = [];
const documentIds = new Map();

function addDocument({ sourceId, title, publisher, url, publishedAt = "", documentType = "official-page", packageId = "" }) {
  const canonicalUrl = safeUrl(url);
  if (!canonicalUrl) return "";
  if (documentIds.has(canonicalUrl)) return documentIds.get(canonicalUrl);
  const id = `official-document:${hash(canonicalUrl)}`;
  documentIds.set(canonicalUrl, id);
  const contentHash = createHash("sha256").update(JSON.stringify({ sourceId, title, publisher, canonicalUrl, publishedAt, packageId })).digest("hex");
  officialDocuments.push({ id, sourceId, label: title || canonicalUrl, publisher, url: canonicalUrl, documentType, packageId, reviewState: "source_snapshot" });
  documentVersions.push({ id: `document-version:${hash(`${id}|${contentHash}`)}`, documentId: id, label: `${title || "Official document"} observed version`, observedAt: generatedAt, publishedAt, contentHash, hashBasis: "normalized-source-metadata", sourceUrl: canonicalUrl, reviewState: "source_snapshot" });
  return id;
}

for (const source of [...(program.sources || []), ...roles.sources]) addDocument({ sourceId: source.id, title: source.title, publisher: source.publisher, url: source.url, publishedAt: source.publishedAt, documentType: /report/i.test(source.title) ? "official-report" : "official-page" });
for (const row of legislation.versions || []) addDocument({ sourceId: row.id, title: row.title || row.packageId, publisher: "U.S. Government Publishing Office", url: row.sourceUrl, publishedAt: row.dateIssued || "", documentType: "bill-version", packageId: row.packageId });
for (const row of legislation.committeeReports || []) addDocument({ sourceId: row.id, title: row.title || row.packageId, publisher: "U.S. Government Publishing Office", url: row.sourceUrl, publishedAt: row.dateIssued || "", documentType: "committee-report", packageId: row.packageId });
for (const row of legislation.enactedProvisions || []) addDocument({ sourceId: row.id, title: row.title || row.packageId, publisher: "U.S. Government Publishing Office", url: row.sourceUrl, publishedAt: row.dateIssued || "", documentType: "public-law", packageId: row.packageId });

for (const role of roles.roles) {
  for (const sourceId of role.sourceIds) {
    const source = sourceById.get(sourceId);
    const documentId = documentIds.get(safeUrl(source?.url));
    if (!documentId) continue;
    const sectionId = `document-section:${hash(`${documentId}|${role.id}`)}`;
    documentSections.push({ id: sectionId, documentId, label: role.title, sectionType: "role-tenure-evidence", text: role.evidenceQuote, sourceUrl: source.url, reviewState: role.reviewState });
    citations.push({ id: `document-citation:${hash(`${sectionId}|${role.id}`)}`, documentId, sectionId, targetType: "official-role", targetId: role.id, selectorType: "quoted-claim", selector: role.evidenceQuote, sourceUrl: source.url, reviewState: role.reviewState });
  }
}

for (const finding of program.findings || []) {
  const source = program.sources?.find((item) => item.id === finding.sourceId);
  const documentId = documentIds.get(safeUrl(source?.url));
  if (!documentId) continue;
  const sectionId = `document-section:${hash(`${documentId}|${finding.id}`)}`;
  documentSections.push({ id: sectionId, documentId, label: finding.label, sectionType: "program-finding", text: finding.finding || finding.label, sourceUrl: source.url, reviewState: finding.reviewState });
  citations.push({ id: `document-citation:${hash(`${sectionId}|${finding.id}`)}`, documentId, sectionId, targetType: "accountability-finding", targetId: `accountability-finding:${hash(finding.id)}`, selectorType: "quoted-claim", selector: finding.finding || finding.label, sourceUrl: source.url, reviewState: finding.reviewState });
}

const reportById = new Map((legislation.committeeReports || []).map((row) => [row.id, row]));
for (const [page, marks] of Object.entries(Object.groupBy(program.appropriationMarks || [], (mark) => String(mark.printedPage)))) {
  const first = marks[0];
  const report = reportById.get(first.reportId);
  const documentId = documentIds.get(safeUrl(report?.sourceUrl || first.sourceUrl));
  if (!documentId) continue;
  const tableId = `document-table:${hash(`${documentId}|${page}|${first.tableTitle}`)}`;
  documentTables.push({ id: tableId, documentId, label: `${first.tableTitle}, printed page ${page}`, printedPage: Number(page), tableTitle: first.tableTitle, rowCount: marks.length, contentHash: createHash("sha256").update(JSON.stringify(marks)).digest("hex"), hashBasis: "verified-table-extract", sourceUrl: first.sourceUrl, reviewState: "reviewed" });
  for (const mark of marks) citations.push({ id: `document-citation:${hash(`${tableId}|${mark.id}`)}`, documentId, tableId, targetType: "appropriation-mark", targetId: mark.id, selectorType: "printed-page-table-row", selector: { printedPage: mark.printedPage, tableTitle: mark.tableTitle, lineNumber: mark.lineNumber, lineCode: mark.lineCode }, sourceUrl: mark.sourceUrl, reviewState: mark.reviewState });
}

const savedQueryTemplates = [
  ["program-health-attention", "Programs with sourced risks or legislative changes", ["program-health-profile", "accountability-finding", "appropriation-mark"]],
  ["buyer-concentration", "Buying offices with concentrated retained award value", ["buyer-profile", "award", "organization"]],
  ["supplier-dependencies", "Prime-to-supplier relationships with multiple sampled subawards", ["supplier-relationship", "subaward", "organization"]],
  ["official-role-turnover", "Official role successions and open-ended tenures", ["official-role", "role-succession", "person"]],
  ["expiring-awards", "Awards with review-only expiration signals", ["award", "expiration-signal", "organization"]],
  ["execution-risk", "Execution balances with caveated review signals", ["execution-balance", "execution-risk-signal", "federal-account"]],
  ["request-to-law", "Request baselines with page-cited marks and enacted-document coverage", ["program-baseline", "appropriation-mark", "official-document"]],
  ["source-freshness", "Evidence with stale or open-ended review state", ["source", "official-role", "document-version"]],
].map(([key, label, entityTypes]) => ({ id: `saved-query-template:${key}`, key, label, entityTypes, scope: "workspace-template", reviewState: "deterministic" }));

const briefTemplates = [
  ["weekly-program-health", "Weekly program health brief", "program"],
  ["buyer-office-watch", "Buyer and office movement brief", "buyer"],
  ["industrial-base-watch", "Industrial-base and teaming brief", "industrial-base"],
  ["request-to-law-watch", "Request-to-law change brief", "legislation"],
  ["source-change-watch", "Official source change brief", "evidence"],
].map(([key, label, subject]) => ({ id: `brief-template:${key}`, key, label, subject, cadence: "weekly", publicationPolicy: "review-before-send", reviewState: "deterministic" }));

const output = {
  metadata: {
    schemaVersion: "1.0.0",
    generatedAt,
    coverage: {
      people: roles.people.length,
      officialRoles: roles.roles.length,
      exactStartAndEndTenures: roles.roles.filter((role) => role.effectiveFrom && role.effectiveTo).length,
      observedCurrentRoles: roles.roles.filter((role) => role.status === "observed-current").length,
      successions: roles.successions.length,
      supplierRelationships: supplierRelationships.length,
      buyerProfiles: buyerProfiles.length,
      vendorProfiles: vendorProfiles.length,
      incumbentPositions: incumbentPositions.length,
      programHealthProfiles: programHealthProfiles.length,
      accountabilityFindings: accountabilityFindings.length,
      officialDocuments: officialDocuments.length,
      documentVersions: documentVersions.length,
      documentSections: documentSections.length,
      documentTables: documentTables.length,
      citations: citations.length,
      embeddings: 0,
      correctiveActions: 0,
      protestDecisions: 0,
      auditFindings: 0,
      savedQueryTemplates: savedQueryTemplates.length,
      briefTemplates: briefTemplates.length,
    },
    evidenceBoundary: "Official people records contain public professional roles only. Observed-current dates are lower bounds, not inferred appointment dates. Industrial-base profiles summarize retained award and sampled subaward evidence; partial subaward coverage is not a complete supplier registry. Program health profiles summarize evidence and are not predictive ratings. Document hashes cover normalized retained metadata or verified extracts unless full source bytes were retained. Embeddings, corrective actions, protest decisions, and audit findings remain explicit zero until their source gates pass.",
    sourceStates: {
      people: "bounded-reviewed",
      industrialBase: "bounded-partial",
      accountability: "bounded",
      documents: "bounded-cited",
      embeddings: "unavailable",
    },
  },
  sources: roles.sources,
  people: roles.people,
  officialRoles: roles.roles,
  roleSuccessions: roles.successions,
  officialRoleOrganizations: roles.organizations,
  supplierRelationships,
  buyerProfiles,
  vendorProfiles,
  incumbentPositions,
  programHealthProfiles,
  accountabilityFindings,
  officialDocuments,
  documentVersions,
  documentSections,
  documentTables,
  citations,
  savedQueryTemplates,
  briefTemplates,
  sourceHealth: [
    { id: "official-people", label: "Official people and tenure", status: "bounded-reviewed", records: roles.roles.length, reviewBy: "2026-12-29" },
    { id: "industrial-base", label: "Industrial-base and teaming", status: "partial", records: supplierRelationships.length, caveat: "USAspending subaward details are sampled and source-throttled." },
    { id: "accountability", label: "Outcomes and accountability", status: "bounded", records: accountabilityFindings.length, caveat: "No complete public protest, audit, or corrective-action registry is claimed." },
    { id: "documents", label: "Document intelligence", status: "bounded-cited", records: officialDocuments.length, caveat: "Embeddings are unavailable; exact citations and hashes remain usable." },
  ],
};

output.metadata.contentHash = createHash("sha256").update(JSON.stringify({ ...output, metadata: { ...output.metadata, contentHash: undefined } })).digest("hex").slice(0, 20);
mkdirSync(dirname(OUT), { recursive: true });
mkdirSync(dirname(PUBLIC_OUT), { recursive: true });
const serialized = `${JSON.stringify(output, null, 2)}\n`;
writeFileSync(OUT, serialized);
writeFileSync(PUBLIC_OUT, serialized);
console.log(`Built roadmap intelligence: ${roles.people.length} people, ${roles.roles.length} roles, ${supplierRelationships.length} supplier relationships, ${officialDocuments.length} documents, ${citations.length} citations`);
