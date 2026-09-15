const CATEGORY_DEFINITIONS = [
  { id: "software-engineering", label: "Software engineering", color: "#1b6ca8", patterns: [/software|application development|programming|ux\/?ui|user.centered|api interface|code modernization/i] },
  { id: "cloud-infrastructure", label: "Cloud infrastructure", color: "#087f8c", patterns: [/\bcloud\b|aws|azure|hosting|computing infrastructure|cloud broker/i] },
  { id: "devsecops-platform", label: "DevSecOps / platform engineering", color: "#7651a8", patterns: [/devsecops|ci\/?cd|toolchain|software factory|platform service|pipeline|big bang/i] },
  { id: "data-ai", label: "Data, analytics & AI", color: "#a33b6f", patterns: [/artificial intelligence|machine learning|\bai\b|data fabric|data platform|data management|analytics|decision advantage|business intelligence/i] },
  { id: "cybersecurity", label: "Cybersecurity", color: "#b23a2f", patterns: [/cyber|information assurance|zero trust|security operations|incident response|defensive cyber/i] },
  { id: "command-control", label: "Command, control & mission systems", color: "#2457a6", patterns: [/command and control|command, control|\bc2\b|c2bmc|c4isr|gccs|abms|battle management|mission planning|joint fires|aoc\b|caoc/i] },
  { id: "systems-integration", label: "Systems engineering & integration", color: "#446d3c", patterns: [/systems? engineering|system integration|digital engineering|technical integration|interoperability|mosa|open interface/i] },
  { id: "test-evaluation", label: "Test, evaluation & simulation", color: "#bd641e", patterns: [/test and evaluation|test & evaluation|\bt&e\b|test capability|test support|simulation|modeling|cyber range|verification|validation/i] },
  { id: "networks-communications", label: "Networks & communications", color: "#3b7b77", patterns: [/network|communications?|telecom|link 16|satcom|radio|c5i/i] },
  { id: "program-acquisition-support", label: "Program & acquisition support", color: "#786347", patterns: [/program management|acquisition support|seta|business office|administrative management|professional support/i] },
  { id: "it-enterprise-operations", label: "IT & enterprise operations", color: "#526b7a", patterns: [/information technology|\bit support|itss|service desk|enterprise resource planning|\berp\b|operations and maintenance|infrastructure services/i] },
  { id: "logistics-sustainment", label: "Logistics & sustainment", color: "#6f7d29", patterns: [/logistics|sustainment|maintenance|product support|supply chain|lifecycle support/i] },
  { id: "training-readiness", label: "Training & readiness", color: "#9a6523", patterns: [/training|readiness|workshop|certification|courseware|instruction/i] },
  { id: "research-development", label: "Research & development", color: "#5d5ca8", patterns: [/research and development|research, development|\br&d\b|\brdt&e\b|applied research|experimental development|sbir/i] },
  { id: "other-unclassified", label: "Other / unclassified", color: "#6c7b88", patterns: [] },
];

export const WORK_CATEGORY_OPTIONS = CATEGORY_DEFINITIONS.map(({ id, label, color }) => ({ id, label, color }));
export const WORK_CATEGORY_BY_ID = new Map(WORK_CATEGORY_OPTIONS.map((category) => [category.id, category]));

export const INGESTION_METHOD_OPTIONS = [
  { id: "automated", label: "Automated public feed", color: "#0086b3" },
  { id: "source-file", label: "Normalized source-file import", color: "#647a8b" },
  { id: "manual", label: "Manual entry", color: "#bd6b13" },
  { id: "curated", label: "Curated crosswalk", color: "#a63a78" },
];
export const INGESTION_METHOD_BY_ID = new Map(INGESTION_METHOD_OPTIONS.map((method) => [method.id, method]));

function compactText(parts) {
  return parts.filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
}

function codeCategoryIds(pscCode = "", naicsCode = "", pscDescription = "", naicsDescription = "") {
  const psc = String(pscCode).toUpperCase();
  const naics = String(naicsCode);
  const descriptions = compactText([pscDescription, naicsDescription]);
  const ids = [];
  if (/^D[A-Z0-9]/.test(psc) || /computer|information technology|telecom/i.test(descriptions)) ids.push("it-enterprise-operations");
  if (/^D[AB]/.test(psc) || ["518210"].includes(naics)) ids.push("cloud-infrastructure");
  if (/^DA/.test(psc) || ["541511", "541512", "541519"].includes(naics)) ids.push("software-engineering");
  if (/^DJ/.test(psc) || /security and compliance/i.test(descriptions)) ids.push("cybersecurity");
  if (/^AC/.test(psc) || /research and development|experimental development|applied research/i.test(descriptions)) ids.push("research-development");
  if (/^R425/.test(psc) || ["541330", "541715", "541712"].includes(naics)) ids.push("systems-integration");
  if (/^U/.test(psc) || /training/i.test(descriptions)) ids.push("training-readiness");
  if (/^J/.test(psc) || /maintenance|repair|rebuild/i.test(descriptions)) ids.push("logistics-sustainment");
  if (["541611", "541618", "541690"].includes(naics)) ids.push("program-acquisition-support");
  return [...new Set(ids)];
}

export function classifyWork(input = {}) {
  const text = compactText([
    input.title,
    input.description,
    input.context,
    input.pscDescription,
    input.naicsDescription,
  ]);
  const coded = codeCategoryIds(input.pscCode, input.naicsCode, input.pscDescription, input.naicsDescription);
  const scores = new Map(CATEGORY_DEFINITIONS.map((category) => [category.id, coded.includes(category.id) ? 4 : 0]));
  for (const category of CATEGORY_DEFINITIONS) {
    for (const pattern of category.patterns) if (pattern.test(text)) scores.set(category.id, (scores.get(category.id) || 0) + 2);
  }
  const ranked = CATEGORY_DEFINITIONS
    .filter((category) => category.id !== "other-unclassified" && (scores.get(category.id) || 0) > 0)
    .sort((left, right) => (scores.get(right.id) || 0) - (scores.get(left.id) || 0) || CATEGORY_DEFINITIONS.indexOf(left) - CATEGORY_DEFINITIONS.indexOf(right));
  const categories = ranked.length ? ranked.slice(0, 3).map((category) => category.id) : ["other-unclassified"];
  const codedEvidence = compactText([
    input.pscCode ? `PSC ${input.pscCode}${input.pscDescription ? ` (${input.pscDescription})` : ""}` : "",
    input.naicsCode ? `NAICS ${input.naicsCode}${input.naicsDescription ? ` (${input.naicsDescription})` : ""}` : "",
  ]);
  return {
    primary: categories[0],
    categories,
    basis: codedEvidence || (ranked.length ? "Deterministic classification of published title and scope" : "No sufficiently specific published work description"),
    confidence: codedEvidence ? "source-coded" : ranked.length ? "description-derived" : "unclassified",
  };
}

export function provenanceForSourceRecord(record = {}, liveAward = null) {
  const curated = /curated/i.test(record.parentReferenceBasis || "");
  const channels = [{ id: "source-packet", label: "Normalized source packet", method: "source-file" }];
  if (liveAward) channels.push({ id: "usaspending", label: "USAspending award API enrichment", method: "automated" });
  if (record.transactionSummary?.actions) channels.push({ id: "fpds", label: "FPDS public action feed", method: "automated" });
  if ((record.sourceUrls || []).some((url) => /sam\.gov/i.test(url))) channels.push({ id: "sam-reference", label: "SAM.gov source reference", method: "source-file" });
  if ((record.sourceUrls || []).some((url) => /forecast|\.pdf(?:$|\?)/i.test(url))) channels.push({ id: "agency-forecast", label: "Agency forecast source import", method: "source-file" });
  if (curated) channels.push({ id: "curated-crosswalk", label: "Curated public-record crosswalk", method: "curated" });
  return {
    method: curated ? "curated" : "source-file",
    label: curated ? "Curated crosswalk" : "Normalized source-file import",
    channels,
  };
}

function lifecycleForDates(start, end, asOf) {
  if (!start && !end) return "schedule-not-published";
  if (end && end < asOf) return "historical-term";
  if (start && start > asOf) return "upcoming-published-milestone";
  return "active-reported-term";
}

export function automatedAwardRecord(award, asOf) {
  const reference = String(award.awardId || "").toUpperCase();
  const stableIdentifier = String(award.id || award.awardId || "USAspending-award").toUpperCase();
  const classification = classifyWork({
    title: award.description,
    description: award.description,
    pscCode: award.pscCode,
    pscDescription: award.pscDescription,
    naicsCode: award.naicsCode,
    naicsDescription: award.naicsDescription,
  });
  return {
    opportunityId: `auto_usaspending_${stableIdentifier.replace(/[^A-Z0-9]/g, "_")}`,
    id: reference || "USAspending award",
    portfolio: award.buyerSubAgency || award.fundingSubAgency || "USAspending award feed",
    mode: "contract-performance",
    title: award.description || `${award.contractType || "Contract"} ${reference}`,
    party: award.recipient || "Recipient not published",
    owner: award.fundingSubAgency || award.buyerSubAgency || null,
    fundingOffice: award.fundingOffice || award.fundingSubAgency || null,
    contractingOffice: award.awardingOffice || award.awardingSubAgency || null,
    reference,
    parentReference: null,
    parentReferenceBasis: null,
    vehicle: null,
    competitionType: null,
    setAside: null,
    eligibility: null,
    awardType: award.contractType || null,
    pricingType: null,
    context: award.description || "",
    sourceDescription: award.description || "",
    evidenceTier: "official-record",
    corroborationStatus: "official-record",
    lifecycleStatus: lifecycleForDates(award.startDate, award.endDate, asOf),
    validationStatus: "automated",
    validationCheckedAt: null,
    corroborationFinding: "Imported automatically from the current USAspending award feed; no separate cross-system corroboration is claimed.",
    sourceRoleCount: 1,
    sourceUrls: [award.id ? `https://www.usaspending.gov/award/${encodeURIComponent(award.id)}/latest` : "https://www.usaspending.gov/"],
    events: [],
    milestones: [],
    start: award.startDate || null,
    currentEnd: award.endDate || null,
    potentialEnd: null,
    obligatedAmount: Number(award.awardAmountDollars || 0),
    potentialAmount: null,
    fpdsObligatedAmount: null,
    fpdsPotentialAmount: null,
    valueLow: null,
    valueHigh: null,
    fiscalValues: [],
    fiscalActions: [],
    transactionSummary: { actions: 0, primaryActions: 0, supportingActions: 0, instruments: 0, firstSigned: null, lastSigned: null, primaryNetObligations: 0, fundingActions: 0, deobligationActions: 0, nonObligationActions: 0 },
    naicsCode: award.naicsCode || null,
    naicsDescription: award.naicsDescription || null,
    pscCode: award.pscCode || null,
    pscDescription: award.pscDescription || null,
    workCategory: classification.primary,
    workCategories: classification.categories,
    workCategoryBasis: classification.basis,
    workCategoryConfidence: classification.confidence,
    ingestionMethod: "automated",
    ingestionLabel: "Automated USAspending feed",
    ingestionChannels: [{ id: "usaspending", label: "USAspending award API", method: "automated" }],
    sourceSystem: "USAspending",
    sourceRecordId: award.id || reference,
    automatedImport: true,
    liveAward: award,
  };
}

export function automatedSamRecord(notice, asOf) {
  const noticeId = String(notice.noticeId || notice.solicitationNumber || "").trim();
  const classification = classifyWork({ title: notice.title, description: notice.description, pscCode: notice.pscCode, naicsCode: notice.naicsCode });
  const events = [
    notice.postedDate ? { eventId: `sam_${noticeId}_posted`, kind: "notice-posted", start: notice.postedDate, end: notice.postedDate, precision: "day", label: "Notice posted", sourceUrl: notice.sourceUrl, isForecast: false, isVerified: true, isOptional: false, status: notice.postedDate <= asOf ? "past" : "future", sourcePublishedDate: notice.postedDate } : null,
    notice.responseDeadline ? { eventId: `sam_${noticeId}_deadline`, kind: "response-deadline", start: notice.responseDeadline, end: notice.responseDeadline, precision: "day", label: "Response deadline", sourceUrl: notice.sourceUrl, isForecast: false, isVerified: true, isOptional: false, status: notice.responseDeadline >= asOf ? "future" : "past", sourcePublishedDate: notice.postedDate } : null,
  ].filter(Boolean);
  return {
    opportunityId: `auto_sam_${noticeId.replace(/[^A-Za-z0-9]/g, "_")}`,
    id: notice.solicitationNumber || noticeId,
    portfolio: notice.subTier || notice.department || "SAM.gov opportunity feed",
    mode: "acquisition-window",
    title: notice.title || "Untitled SAM.gov opportunity",
    party: notice.office || notice.subTier || "Government office not published",
    owner: notice.office || notice.subTier || null,
    fundingOffice: null,
    contractingOffice: notice.office || null,
    reference: notice.solicitationNumber || noticeId,
    parentReference: null,
    parentReferenceBasis: null,
    vehicle: null,
    solicitationStart: notice.postedDate || null,
    solicitationEnd: notice.responseDeadline || null,
    noticeType: notice.noticeType || null,
    competitionType: null,
    setAside: notice.setAside || null,
    eligibility: null,
    awardType: null,
    pricingType: null,
    context: notice.description || "",
    sourceDescription: notice.description || "",
    evidenceTier: "official-record",
    corroborationStatus: "official-record",
    lifecycleStatus: lifecycleForDates(notice.postedDate, notice.responseDeadline, asOf),
    validationStatus: "automated",
    validationCheckedAt: null,
    corroborationFinding: "Imported automatically from SAM.gov Contract Opportunities; no predecessor or award relationship is inferred.",
    sourceRoleCount: 1,
    sourceUrls: [notice.sourceUrl].filter(Boolean),
    events,
    milestones: events.map((event) => ({ label: event.label, start: event.start, end: event.end, precision: event.precision })),
    start: null,
    currentEnd: null,
    potentialEnd: null,
    obligatedAmount: null,
    potentialAmount: null,
    fpdsObligatedAmount: null,
    fpdsPotentialAmount: null,
    valueLow: null,
    valueHigh: null,
    fiscalValues: [],
    fiscalActions: [],
    transactionSummary: { actions: 0, primaryActions: 0, supportingActions: 0, instruments: 0, firstSigned: null, lastSigned: null, primaryNetObligations: 0, fundingActions: 0, deobligationActions: 0, nonObligationActions: 0 },
    naicsCode: notice.naicsCode || null,
    naicsDescription: null,
    pscCode: notice.pscCode || null,
    pscDescription: null,
    workCategory: classification.primary,
    workCategories: classification.categories,
    workCategoryBasis: classification.basis,
    workCategoryConfidence: classification.confidence,
    ingestionMethod: "automated",
    ingestionLabel: "Automated SAM.gov feed",
    ingestionChannels: [{ id: "sam", label: "SAM.gov Contract Opportunities API", method: "automated" }],
    sourceSystem: "SAM.gov",
    sourceRecordId: notice.noticeId || noticeId,
    automatedImport: true,
    placeOfPerformance: notice.placeOfPerformance || null,
  };
}

export function importedManualRecord(input, asOf) {
  const method = input.ingestionMethod === "curated" ? "curated" : "manual";
  const classification = classifyWork(input);
  const identifier = String(input.opportunityId || input.noticeId || input.solicitationNumber || input.reference || input.title || "manual-record").replace(/[^A-Za-z0-9]/g, "_");
  const events = (input.events || []).map((event, index) => ({
    eventId: event.eventId || `manual_${identifier}_${index}`,
    kind: event.kind || "published-event",
    start: event.start || null,
    end: event.end || event.start || null,
    precision: event.precision || "day",
    label: event.label || "Published event",
    sourceUrl: event.sourceUrl || input.sourceUrl || null,
    isForecast: Boolean(event.isForecast),
    isVerified: Boolean(event.isVerified),
    isOptional: Boolean(event.isOptional),
    status: event.status || null,
    sourcePublishedDate: event.sourcePublishedDate || null,
  }));
  return {
    opportunityId: input.opportunityId || `${method}_${identifier}`,
    id: input.ganttAlias || input.solicitationNumber || input.reference || input.noticeId || identifier,
    portfolio: input.portfolio || input.agency || "Manual import",
    mode: input.mode === "contract-performance" ? "contract-performance" : "acquisition-window",
    title: input.title || "Untitled imported record",
    party: input.party || input.office || "Not published",
    owner: input.owner || input.office || null,
    fundingOffice: input.fundingOffice || null,
    contractingOffice: input.contractingOffice || input.office || null,
    reference: input.reference || input.solicitationNumber || input.noticeId || null,
    parentReference: input.parentReference || null,
    parentReferenceBasis: input.parentReferenceBasis || null,
    vehicle: input.vehicle || null,
    solicitationStart: input.solicitationStart || null,
    solicitationEnd: input.solicitationEnd || null,
    noticeType: input.noticeType || null,
    competitionType: input.competitionType || null,
    setAside: input.setAside || null,
    eligibility: input.eligibility || null,
    awardType: input.awardType || null,
    pricingType: input.pricingType || null,
    context: input.description || input.context || "",
    sourceDescription: input.description || input.context || "",
    evidenceTier: input.evidenceTier || "source-reviewed",
    corroborationStatus: input.corroborationStatus || "source-reviewed",
    lifecycleStatus: input.lifecycleStatus || lifecycleForDates(input.start || input.solicitationStart, input.currentEnd || input.solicitationEnd, asOf),
    validationStatus: input.validationStatus || "manual",
    validationCheckedAt: input.validationCheckedAt || null,
    corroborationFinding: input.corroborationFinding || "Imported from an analyst-maintained public record; use the linked source to validate the fields.",
    sourceRoleCount: (input.sourceUrls || [input.sourceUrl]).filter(Boolean).length,
    sourceUrls: [...new Set((input.sourceUrls || [input.sourceUrl]).filter(Boolean))],
    events,
    milestones: events.filter((event) => event.start).map((event) => ({ label: event.label, start: event.start, end: event.end, precision: event.precision })),
    start: input.start || null,
    currentEnd: input.currentEnd || null,
    potentialEnd: input.potentialEnd || null,
    obligatedAmount: Number(input.obligatedAmount || 0) || null,
    potentialAmount: Number(input.potentialAmount || 0) || null,
    fpdsObligatedAmount: null,
    fpdsPotentialAmount: null,
    valueLow: Number(input.valueLow || 0) || null,
    valueHigh: Number(input.valueHigh || 0) || null,
    fiscalValues: input.fiscalValues || [],
    fiscalActions: [],
    transactionSummary: { actions: 0, primaryActions: 0, supportingActions: 0, instruments: 0, firstSigned: null, lastSigned: null, primaryNetObligations: 0, fundingActions: 0, deobligationActions: 0, nonObligationActions: 0 },
    naicsCode: input.naicsCode || null,
    naicsDescription: input.naicsDescription || null,
    pscCode: input.pscCode || null,
    pscDescription: input.pscDescription || null,
    workCategory: input.workCategory || classification.primary,
    workCategories: input.workCategories?.length ? input.workCategories : classification.categories,
    workCategoryBasis: input.workCategoryBasis || classification.basis,
    workCategoryConfidence: input.workCategoryConfidence || classification.confidence,
    ingestionMethod: method,
    ingestionLabel: method === "curated" ? "Curated crosswalk" : "Manual public-record entry",
    ingestionChannels: [{ id: input.sourceChannel || method, label: input.sourceLabel || (method === "curated" ? "Curated crosswalk" : "Manual public-record entry"), method }],
    sourceSystem: input.sourceSystem || "Analyst-maintained public record",
    sourceRecordId: input.sourceRecordId || input.noticeId || input.reference || input.opportunityId || identifier,
    automatedImport: false,
  };
}

function subawardSummaryForAward(subawardByPrime, award = null) {
  if (!award?.id) return null;
  return subawardByPrime.get(award.id) || null;
}

function attachSubawards(record, subawardSummary = null) {
  if (!subawardSummary) return record;
  const ingestionChannels = [...(record.ingestionChannels || [])];
  if (!ingestionChannels.some((channel) => channel.id === "usaspending-subawards")) {
    ingestionChannels.push({ id: "usaspending-subawards", label: "USAspending subaward API", method: "automated" });
  }
  return {
    ...record,
    subawardSummary: {
      primeAwardId: subawardSummary.primeAwardId,
      reportedCount: subawardSummary.reportedCount,
      sampledAmount: subawardSummary.sampledAmount,
      latestActionDate: subawardSummary.latestActionDate,
      earliestActionDate: subawardSummary.earliestActionDate,
      sampledCount: subawardSummary.sampledCount,
      detailTruncated: subawardSummary.detailTruncated,
      detailStatus: subawardSummary.detailStatus,
      status: subawardSummary.status,
      changeStatus: subawardSummary.changeStatus,
    },
    subawards: subawardSummary.subawards || [],
    ingestionChannels,
  };
}

export function enrichSourceRecord(record, liveAward = null, subawardSummary = null) {
  const classification = classifyWork({
    title: record.title,
    description: record.sourceDescription,
    context: record.context,
    pscCode: record.pscCode || liveAward?.pscCode,
    pscDescription: record.pscDescription || liveAward?.pscDescription,
    naicsCode: record.naicsCode || liveAward?.naicsCode,
    naicsDescription: record.naicsDescription || liveAward?.naicsDescription,
  });
  const provenance = record.ingestionMethod
    ? { method: record.ingestionMethod, label: record.ingestionLabel, channels: record.ingestionChannels || [] }
    : provenanceForSourceRecord(record, liveAward);
  return attachSubawards({
    ...record,
    liveAward,
    naicsCode: record.naicsCode || liveAward?.naicsCode || null,
    naicsDescription: record.naicsDescription || liveAward?.naicsDescription || null,
    pscCode: record.pscCode || liveAward?.pscCode || null,
    pscDescription: record.pscDescription || liveAward?.pscDescription || null,
    workCategory: record.workCategory || classification.primary,
    workCategories: record.workCategories?.length ? record.workCategories : classification.categories,
    workCategoryBasis: record.workCategoryBasis || classification.basis,
    workCategoryConfidence: record.workCategoryConfidence || classification.confidence,
    ingestionMethod: provenance.method,
    ingestionLabel: provenance.label,
    ingestionChannels: provenance.channels,
    sourceSystem: record.sourceSystem || "Normalized capture source packet",
    sourceRecordId: record.sourceRecordId || record.opportunityId,
    automatedImport: Boolean(record.automatedImport),
  }, subawardSummary);
}

export function assembleProcurementRecords(sourceRecords = [], awards = [], asOf = "9999-12-31", samRecords = [], manualRecords = [], subawardSnapshot = { primes: [] }) {
  const awardMap = new Map(awards.map((award) => [String(award.awardId || "").toUpperCase(), award]));
  const subawardByPrime = new Map((subawardSnapshot.primes || []).map((prime) => [prime.primeAwardId, prime]));
  const references = new Set(sourceRecords.map((record) => String(record.reference || "").toUpperCase()).filter(Boolean));
  const curated = sourceRecords.map((record) => {
    const liveAward = awardMap.get(String(record.reference || "").toUpperCase()) || null;
    return enrichSourceRecord(record, liveAward, subawardSummaryForAward(subawardByPrime, liveAward));
  });
  const automatic = awards.filter((award) => award.awardId && !references.has(String(award.awardId).toUpperCase())).map((award) => attachSubawards(automatedAwardRecord(award, asOf), subawardSummaryForAward(subawardByPrime, award)));
  const knownNotices = new Set(sourceRecords.flatMap((record) => [record.reference, record.noticeId, record.solicitationNumber]).map((value) => String(value || "").toUpperCase()).filter(Boolean));
  const sam = samRecords.filter((notice) => {
    const keys = [notice.noticeId, notice.solicitationNumber].map((value) => String(value || "").toUpperCase()).filter(Boolean);
    return keys.length && !keys.some((key) => knownNotices.has(key));
  }).map((notice) => automatedSamRecord(notice, asOf));
  const knownIds = new Set([...curated, ...automatic, ...sam].flatMap((record) => [record.opportunityId, record.reference]).map((value) => String(value || "").toUpperCase()).filter(Boolean));
  const manual = manualRecords.map((record) => importedManualRecord(record, asOf)).filter((record) => ![record.opportunityId, record.reference].some((value) => knownIds.has(String(value || "").toUpperCase())));
  return [...curated, ...automatic, ...sam, ...manual];
}

export function applyProcurementChanges(records = [], changes = []) {
  const byReference = new Map(changes.map((change) => [String(change.sourceRecordId || "").toUpperCase(), change]));
  return records.map((record) => {
    const change = [record.sourceRecordId, record.liveAward?.id, record.reference]
      .map((value) => String(value || "").toUpperCase())
      .map((key) => byReference.get(key))
      .find(Boolean);
    return change ? { ...record, changeStatus: change.change, changeSourceSystem: change.sourceSystem, changeDetail: change } : { ...record, changeStatus: "unchanged", changeSourceSystem: null, changeDetail: null };
  });
}

export function attachContractMonitor(records = [], snapshot = { records: [] }) {
  const byOpportunity = new Map((snapshot.records || []).map((entry) => [entry.opportunityId, entry]));
  return records.map((record) => {
    const monitor = byOpportunity.get(record.opportunityId);
    if (!monitor) return { ...record, automationCoverage: null };
    return {
      ...record,
      automationCoverage: {
        status: monitor.status,
        method: monitor.method,
        lifecycle: monitor.lifecycle,
        checkedAt: monitor.checkedAt || monitor.lastAttemptAt || null,
        diagnostic: monitor.diagnostic || null,
        observation: monitor.observation || null,
      },
      ingestionChannels: monitor.observation && !(record.ingestionChannels || []).some((channel) => channel.id === "usaspending-award-detail")
        ? [...(record.ingestionChannels || []), { id: "usaspending-award-detail", label: "USAspending exact award monitor", method: "automated" }]
        : record.ingestionChannels || [],
    };
  });
}
