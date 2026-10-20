import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import { CONTRACT_LINEAGE_SCHEMA_VERSION, INTELLIGENCE_ENTITY_TYPES, INTELLIGENCE_GRAPH_SCHEMA_VERSION, INTELLIGENCE_RELATION_TYPES, LINKED_INTELLIGENCE_SCHEMA_VERSION } from "../src/intelligence-graph.js";
import { findEvidencePath, relationLabel, summarizeRelationshipCoverage } from "../src/linked-intelligence-path.js";
import { CONFLICT_STATUS_VALUES, TEMPORAL_EVIDENCE_SCHEMA_VERSION, TEMPORAL_STATUS_VALUES } from "./temporal-evidence-resolver.mjs";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const graph = JSON.parse(readFileSync(resolve(ROOT, "public/data/intelligence-graph.json"), "utf8"));
const graphIndex = JSON.parse(readFileSync(resolve(ROOT, "public/data/intelligence-graph-index.json"), "utf8"));
const graphSummary = JSON.parse(readFileSync(resolve(ROOT, "public/data/intelligence-graph-summary.json"), "utf8"));
const organizationReview = JSON.parse(readFileSync(resolve(ROOT, "public/data/organization-identity-review.json"), "utf8"));
const contractLineageIndex = JSON.parse(readFileSync(resolve(ROOT, "public/data/contract-lineage-index.json"), "utf8"));
const contractLineageReview = JSON.parse(readFileSync(resolve(ROOT, "public/data/contract-lineage-review.json"), "utf8"));
const temporalEvidenceIndex = JSON.parse(readFileSync(resolve(ROOT, "public/data/temporal-evidence-index.json"), "utf8"));
const temporalEvidenceReview = JSON.parse(readFileSync(resolve(ROOT, "public/data/temporal-evidence-review.json"), "utf8"));
const spendingCoverage = JSON.parse(readFileSync(resolve(ROOT, "src/data/usaspending-coverage.json"), "utf8"));
const subawardCoverage = JSON.parse(readFileSync(resolve(ROOT, "src/data/usaspending-subawards.json"), "utf8"));
const priorityAwardActions = JSON.parse(readFileSync(resolve(ROOT, "src/data/priority-award-actions.json"), "utf8"));
const legislativeTraceability = JSON.parse(readFileSync(resolve(ROOT, "src/data/legislative-traceability.json"), "utf8"));
const roadmapIntelligence = JSON.parse(readFileSync(resolve(ROOT, "src/data/roadmap-intelligence.json"), "utf8"));
const strategicIntelligence = JSON.parse(readFileSync(resolve(ROOT, "src/data/strategic-intelligence.json"), "utf8"));
const agentGraphManifest = JSON.parse(readFileSync(resolve(ROOT, "public/data/agent-graph/manifest.json"), "utf8"));
const linkedIntelligenceBytes = readFileSync(resolve(ROOT, "public/data/linked-intelligence-index.json"));
const linkedIntelligenceGzipBytes = readFileSync(resolve(ROOT, "public/data/linked-intelligence-index.json.gzip"));
const linkedIntelligence = JSON.parse(linkedIntelligenceBytes.toString("utf8"));
const entities = new Set(Object.values(graph.entities || {}).flatMap((rows) => rows.map((row) => row.id)));
const relations = graph.relations || [];

assert.equal(graph.metadata?.schemaVersion, INTELLIGENCE_GRAPH_SCHEMA_VERSION);
assert.equal(graphSummary.metadata?.schemaVersion, INTELLIGENCE_GRAPH_SCHEMA_VERSION, "Graph summary must publish the canonical schema version");
assert.equal(graphSummary.totals.relations, graph.relations.length, "Graph summary must retain the complete relation count");
assert.equal(graphSummary.totals.entities, Object.values(graph.metadata.entityCounts).reduce((total, count) => total + count, 0), "Graph summary must retain the complete entity count");
assert.deepEqual(graph.domain?.entityTypes, INTELLIGENCE_ENTITY_TYPES);
assert.deepEqual(graph.domain?.relationTypes, INTELLIGENCE_RELATION_TYPES);
assert.equal(graph.entities?.activity?.length, 888, "All stable activities must exist in the graph");
assert.equal(graph.entities?.organization?.length, 2972, "Reviewed department, service, command, agency, and component identities must join the canonical organization graph");
assert.equal(graph.entities?.award?.length, 1905, "All activity-linked and ranked USAspending awards must exist in the graph");
assert.equal(graph.entities?.event?.length, 502, "All normalized public events must exist in the graph");
assert.equal(graph.entities?.transaction?.length, 3085, "All exact FPDS actions must exist in the graph");
assert.equal(graph.entities?.location?.length, 885, "All authoritative locations must exist in the graph");
assert.equal(graph.entities?.["budget-line"]?.length, 3923, "All current and page-matched historical budget lines must exist in the graph");
assert.equal(Object.keys(graph.indices?.byActivity || {}).length, 888, "Every activity must have a graph index");
assert.ok(relations.length > 120000, "The graph should retain the complete cross-surface, program, legislative, signal, and money-lifecycle relation set");
assert.ok(relations.every((relation) => INTELLIGENCE_RELATION_TYPES.includes(relation.type)), "Graph contains an unknown relationship type");
assert.ok(relations.every((relation) => entities.has(relation.from) && entities.has(relation.to)), "Graph contains a dangling relationship endpoint");
assert.ok(relations.every((relation) => relation.evidence?.sourceArtifact && relation.evidence?.basis && relation.evidence?.confidence), "Every graph relationship must retain evidence metadata");
assert.ok(relations.every((relation) => relation.validity?.observedAt && "effectiveFrom" in relation.validity && "effectiveTo" in relation.validity && "supersededAt" in relation.validity && "reviewedAt" in relation.validity && relation.validity.reviewBy && TEMPORAL_STATUS_VALUES.includes(relation.validity?.status)), "Every graph relationship must retain explicit temporal and review fields");
assert.equal(graph.metadata.coverage.activities.awardLinked, 702, "All retained awards must link to the canonical activity spine");
assert.equal(graph.metadata.coverage.awards.accountLinked, 305, "Known unique award-to-account coverage changed");
assert.equal(graph.metadata.relationCounts["award-funded-by-account"], 775, "Known exact award-to-account relationships changed");
assert.ok(graph.metadata.coverage.awards.subawardLinked >= 379, "Exact subaward-prime coverage regressed below the verified baseline");
assert.equal(graph.metadata.coverage.awards.subawardLinked, subawardCoverage.metadata?.primeWithSubawardsCount, "All retained positive subaward primes must join exact award IDs");
assert.deepEqual(graph.metadata.coverage.spending, {
  firstFiscalYear: 2017,
  lastFiscalYear: 2026,
  annualTotals: 10,
  observations: 7071,
  uniqueRankedAwards: 1489,
  categoryRows: 7061,
  scope: spendingCoverage.metadata.scope,
  amountPolicy: spendingCoverage.metadata.amountPolicy,
}, "USAspending breadth coverage changed");
assert.equal(graph.entities?.["spending-observation"]?.length, 7071, "Every annual and deduplicated category observation must exist once");
assert.equal(graph.metadata.relationCounts["spending-observation-measures-entity"], 7071, "Every spending observation must measure exactly one typed subject");
assert.equal(graph.metadata.entityCounts["federal-account"], 179, "Current and historical federal accounts must remain independently addressable");
assert.equal(graph.metadata.relationCounts["federal-account-has-execution-balance"], 7986, "Every execution balance must retain its exact federal-account edge");
const sourceRelations = relations.filter((relation) => relation.type === "supported-by-source");
assert.equal(graph.metadata.relationCounts["supported-by-source"], sourceRelations.length, "The published source-evidence count must match the generated graph");
assert.ok(sourceRelations.length >= 30_000, "Source-evidence coverage must not regress below the verified cross-surface baseline");
assert.equal(graph.entities?.["treasury-account"]?.length, 1986, "Every exact historical TAS must exist once");
assert.equal(graph.entities?.["execution-balance"]?.length, 7986, "Every FY/TAS execution balance must exist once");
assert.equal(graph.entities?.["apportionment-revision"]?.length, 6105, "Every retained OMB apportionment revision must exist once");
assert.ok(graph.entities?.["program-activity"]?.length >= 1500, "Program activity depth regressed");
assert.equal(graph.entities?.["object-class"]?.length, 350, "Object-class history regressed");
assert.equal(graph.entities?.["treasury-outlay-observation"]?.length, 119, "Treasury monthly reconciliation history regressed");
assert.equal(graph.metadata.relationCounts["treasury-account-has-execution-balance"], 7986, "Every execution balance must join its exact TAS");
assert.equal(graph.metadata.relationCounts["treasury-account-apportioned-by-revision"], 5943, "Every joinable OMB revision must join its exact TAS");
assert.deepEqual(graph.metadata.coverage.money, {
  firstFiscalYear: 2017,
  lastFiscalYear: 2026,
  federalAccountSnapshots: 1478,
  treasuryAccounts: 1986,
  executionBalances: 7986,
  apportionmentRevisions: 6105,
  programActivities: 1561,
  objectClasses: 350,
  treasuryOutlayObservations: 119,
  exactAwardAccountLinks: 775,
  amountPolicy: "Request, budgetary resources, apportionment, obligations, and outlays are separate measures and must not be added together.",
}, "Exact money lifecycle coverage changed");
assert.equal(graph.metadata.coverage.acquisition.status, "unavailable", "SAM acquisition coverage must remain explicitly unavailable until the protected key is configured");
for (const type of ["opportunity-notice", "notice-version", "award-action", "vendor-registration", "business-certification", "organization-hierarchy-observation", "subaward"]) {
  assert.ok(type in graph.metadata.entityCounts, `SAM acquisition type ${type} must remain first-class even when its protected source is unavailable`);
}
assert.ok(graph.entities?.["award-action"]?.length >= 2_500, "Priority-award action graph coverage regressed below the verified baseline");
assert.equal(graph.entities?.["award-action"]?.length, priorityAwardActions.actions?.length, "Every retained priority-award action must exist once");
assert.equal(graph.metadata.relationCounts["award-modified-by-action"], priorityAwardActions.actions?.length, "Every retained priority-award action must join its exact award");
assert.ok(graph.entities?.["legislative-measure"]?.length >= 9, "The enacted NDAA baseline and FY2024 defense appropriations measure must remain addressable");
assert.equal(graph.entities?.["legislative-measure"]?.length, legislativeTraceability.measures?.length, "Every retained defense measure must exist once");
assert.equal(graph.entities?.["legislative-version"]?.length, legislativeTraceability.versions?.length, "Every retained defense bill version must exist once");
assert.equal(graph.entities?.["committee-report"]?.length, legislativeTraceability.committeeReports?.length, "Every retained committee report must exist once");
assert.equal(graph.entities?.["enacted-provision"]?.length, legislativeTraceability.enactedProvisions?.length, "Every retained enacted provision must exist once");
assert.equal(graph.metadata.relationCounts["measure-has-version"], legislativeTraceability.relations?.filter((row) => row.type === "measure-has-version").length, "Every defense bill version must join its exact measure");
assert.equal(graph.metadata.relationCounts["measure-enacted-as"], legislativeTraceability.relations?.filter((row) => row.type === "measure-enacted-as").length, "Every enacted defense measure must join its exact public law");
assert.equal(graph.entities?.["defense-program"]?.length, 2723, "Every canonical program identity must exist once");
assert.equal(graph.entities?.["program-office"]?.length, 30, "Every source-declared budget-sponsor office must exist once");
assert.equal(graph.entities?.["program-baseline"]?.length, 2755, "Every official request baseline must remain addressable");
assert.equal(graph.entities?.["cost-estimate"]?.length, 1, "Reviewed program cost-estimate coverage changed");
assert.equal(graph.entities?.["schedule-event"]?.length, 1, "Reviewed program schedule-event coverage changed");
assert.equal(graph.entities?.["program-risk"]?.length, 2, "Reviewed program-risk coverage changed");
assert.equal(graph.entities?.["acquisition-milestone"]?.length, 0, "No acquisition milestone may be promoted without authoritative program-level evidence");
assert.equal(graph.entities?.["unit-cost-breach"]?.length, 0, "No unit-cost breach may be promoted without authoritative program-level evidence");
assert.equal(graph.entities?.["test-finding"]?.length, 0, "No test finding may be promoted without authoritative program-level evidence");
assert.equal(graph.entities?.["appropriation-mark"]?.length, 35, "Every reviewed FY2024 House RDT&E Army mark must exist once");
assert.equal(graph.metadata.relationCounts["defense-program-represented-by-budget-line"], 3237, "Program-to-budget-line coverage changed");
assert.equal(graph.metadata.relationCounts["defense-program-has-baseline"], 2755, "Every request baseline must join its program");
assert.equal(graph.metadata.relationCounts["appropriation-mark-adjusts-budget-line"], 35, "Every House mark must join its exact budget line");
assert.equal(graph.metadata.relationCounts["appropriation-mark-affects-defense-program"], 35, "Every House mark must join its exact defense program");
assert.equal(graph.metadata.relationCounts["appropriation-mark-recommended-by-report"], 35, "Every House mark must retain exact report evidence");
assert.equal(graph.metadata.relationCounts["appropriation-mark-considered-by-measure"], 35, "Every House mark must retain exact measure context");
assert.equal(graph.entities?.person?.length, 113, "Reviewed public professional coverage changed");
assert.equal(graph.entities?.["official-role"]?.length, 294, "Official role coverage changed");
assert.equal(graph.entities?.["role-succession"]?.length, 4, "Exact role succession coverage changed");
assert.equal(graph.metadata.relationCounts["person-holds-official-role"], 294, "Every official role must join its public professional identity");
assert.equal(graph.metadata.relationCounts["official-role-at-organization"], 294, "Every official role must join its published organization");
assert.equal(graph.metadata.relationCounts["role-succession-predecessor"], 4, "Every succession must retain its predecessor role");
assert.equal(graph.metadata.relationCounts["role-succession-successor"], 4, "Every succession must retain its successor role");
assert.equal(graph.entities?.["organization-dossier"]?.length, 100, "Organization Intelligence must retain the bounded 100-dossier cohort");
assert.equal(graph.entities?.["organization-mission-claim"]?.length, 56, "Reviewed organization mission coverage changed");
assert.equal(graph.entities?.["organization-financial-summary"]?.length, 60, "Typed organization financial coverage changed");
assert.equal(graph.entities?.["organization-research-gap"]?.length, 254, "Organization research queue coverage changed");
assert.equal(graph.entities?.["organization-change-event"]?.length, 257, "Organization change-timeline coverage changed");
assert.equal(graph.entities?.["organization-source-monitor"]?.length, 10, "Official organization source-monitor coverage changed");
assert.equal(graph.entities?.["organization-source-observation"]?.length, 10, "Every monitored source must retain its current observation");
assert.equal(graph.entities?.["organization-change-proposal"]?.length, 0, "The current unchanged baseline must not manufacture source-change proposals");
assert.equal(graph.metadata.relationCounts["organization-dossier-for-organization"], 100, "Every dossier must join one canonical organization");
assert.equal(graph.metadata.relationCounts["organization-dossier-includes-role"], 292, "Every retained dossier role must remain traversable");
assert.equal(graph.metadata.relationCounts["organization-dossier-includes-program"], 2713, "Dossier program coverage changed");
assert.equal(graph.metadata.relationCounts["organization-dossier-includes-award"], 635, "Dossier award coverage changed");
assert.equal(graph.metadata.relationCounts["organization-dossier-has-research-gap"], 254, "Every research gap must join its dossier");
assert.equal(graph.metadata.relationCounts["organization-source-monitor-has-observation"], 10, "Every source monitor must retain its content-hash observation");
assert.equal(graph.metadata.relationCounts["organization-source-monitor-covers-dossier"], 17, "Every exact monitored-source dossier membership must remain traversable");
assert.equal(graph.entities?.["supplier-relationship"]?.length, 1000, "Bounded supplier relationship coverage changed");
assert.equal(graph.entities?.["buyer-profile"]?.length, 22, "Buyer profile coverage changed");
assert.equal(graph.entities?.["vendor-profile"]?.length, 235, "Vendor profile coverage changed");
assert.equal(graph.entities?.["incumbent-position"]?.length, 879, "Incumbent-position coverage changed");
assert.equal(graph.metadata.relationCounts["supplier-relationship-prime"], 1000, "Every supplier relationship must retain its prime organization");
assert.equal(graph.metadata.relationCounts["supplier-relationship-supplier"], 1000, "Every supplier relationship must retain its supplier organization");
assert.equal(graph.metadata.relationCounts["incumbent-position-for-activity"], 879, "Every incumbent position must join its activity");
assert.equal(graph.entities?.["program-health-profile"]?.length, 2723, "Every defense program must retain one evidence summary");
assert.equal(graph.entities?.["accountability-finding"]?.length, 4, "Bounded accountability finding coverage changed");
assert.equal(graph.metadata.relationCounts["program-health-profile-summarizes-program"], 2723, "Every program health profile must join its defense program");
assert.equal(graph.metadata.relationCounts["accountability-finding-about-program"], 4, "Every accountability finding must join its defense program");
assert.ok(graph.entities?.["official-document"]?.length >= 57, "Official document coverage regressed below the verified baseline");
assert.equal(graph.entities?.["official-document"]?.length, roadmapIntelligence.officialDocuments?.length, "Every retained official document must exist once");
assert.equal(graph.entities?.["document-version"]?.length, roadmapIntelligence.documentVersions?.length, "Every official document must retain an observed version");
assert.equal(graph.entities?.["document-section"]?.length, roadmapIntelligence.documentSections?.length, "Every retained document section must exist once");
assert.equal(graph.entities?.["document-table"]?.length, roadmapIntelligence.documentTables?.length, "Every retained document table must exist once");
assert.equal(graph.entities?.["document-citation"]?.length, roadmapIntelligence.citations?.length, "Every retained document citation must exist once");
assert.equal(graph.metadata.relationCounts["document-citation-supports-official-role"], 296, "Every official-role citation must retain its target");
assert.equal(graph.metadata.relationCounts["document-citation-supports-appropriation-mark"], 35, "Every mark citation must retain its target");
assert.equal(graph.metadata.relationCounts["document-citation-supports-accountability-finding"], 4, "Every accountability citation must retain its target");
assert.equal(graph.entities?.["saved-query-template"]?.length, 8, "Saved query template coverage changed");
assert.equal(graph.entities?.["brief-template"]?.length, 5, "Review-before-send brief coverage changed");
assert.equal(graph.entities?.["program-element"]?.length, 1114, "R-1 program-element coverage changed");
assert.equal(graph.entities?.project?.length, 745, "C-1 project coverage changed");
assert.equal(graph.entities?.["acquisition-forecast"]?.length, 10, "Agency forecast baseline changed");
assert.equal(graph.entities?.["mission-assignment"]?.length, 96, "Reviewed installation mission coverage changed");
assert.equal(graph.entities?.["installation-tenant"]?.length, 185, "Reviewed installation tenant coverage changed");
assert.equal(graph.entities?.["competitive-signal"]?.length, strategicIntelligence.competitiveSignals?.length, "Every retained competition signal must exist once");
assert.ok(graph.entities?.["expiration-signal"]?.length >= 267, "Expiration signal coverage regressed below the verified baseline");
assert.equal(graph.entities?.["expiration-signal"]?.length, strategicIntelligence.expirationSignals?.length, "Every retained expiration signal must exist once");
assert.equal(graph.entities?.["execution-risk-signal"]?.length, strategicIntelligence.executionRiskSignals?.length, "Every retained execution review signal must exist once");
assert.equal(graph.entities?.["outcome-evidence"]?.length, strategicIntelligence.outcomeEvidence?.length, "Every retained outcome evidence record must exist once");
assert.equal(graph.entities?.["sbir-topic"]?.length, 0, "SBIR topics must remain empty while the official API is unavailable");
assert.equal(graph.entities?.["protest-decision"]?.length, 0, "No protest decision may be promoted without an exact award or notice join");
assert.equal(graph.entities?.["audit-finding"]?.length, 0, "No audit finding may be promoted without an exact official identifier crosswalk");
assert.equal(graph.metadata.coverage.budget.exactAccountTitleLinks, 3607, "Known exact budget-line to federal-account title links changed");
assert.equal(graph.metadata.coverage.geography.activityLocationRelations, (graph.metadata.relationCounts["contracting-activity-at"] || 0) + (graph.metadata.relationCounts["funding-activity-at"] || 0), "Reviewed map placement coverage must match the generated activity-location relations");
assert.equal(graph.metadata.coverage.organizations.canonicalUeiIdentities, graph.metadata.coverage.organizations.publishedUeiIdentities, "Canonical UEI coverage must match the published UEI inventory");
assert.ok(graph.metadata.coverage.organizations.canonicalUeiIdentities >= 500, "Published UEI identity coverage regressed below the verified baseline");
assert.equal(graph.metadata.coverage.organizations.reviewedOfficeCodeIdentities, 50, "Reviewed contracting-office code coverage changed");
assert.equal(graph.metadata.coverage.organizations.cageIdentities, 0, "CAGE coverage must remain explicit until published evidence enters the retained corpus");
assert.equal(graph.metadata.coverage.organizations.resolvedAliasGroups, 23, "Known UEI-resolved alias coverage changed");
assert.equal(graph.metadata.coverage.organizations.ambiguousNormalizedLabels, 11, "Known ambiguous normalized-label queue changed");
assert.equal(graph.metadata.coverage.organizations.hierarchyRelations, 158, "Source-declared and reviewed organization hierarchy coverage changed");
assert.equal(graph.metadata.coverage.organizations.officeLocationRelations, 52, "Reviewed office-code/location coverage changed");
assert.equal(graph.metadata.coverage.organizations.transactionRecipientRelations, 3085, "Every exact FPDS transaction must retain its recipient identity edge");
assert.equal(graph.metadata.coverage.contracts.exactParentVehicles, graph.entities?.["contract-vehicle"]?.length, "Every exact parent vehicle must exist once");
assert.equal(graph.metadata.coverage.contracts.activitiesWithExactParent, graph.metadata.relationCounts["activity-ordered-under-vehicle"], "Contract-family activity coverage must match the generated graph");
assert.equal(graph.metadata.coverage.contracts.namedAcquisitionPaths, graph.entities?.["acquisition-path"]?.length, "Every published acquisition path must exist once");
assert.equal(graph.metadata.coverage.contracts.activitiesWithNamedPath, graph.metadata.relationCounts["activity-uses-acquisition-path"], "Acquisition-path activity coverage must match the generated graph");
assert.equal(graph.metadata.coverage.contracts.resolvedPredecessorLinks, graph.metadata.relationCounts["activity-follow-on-to"], "Resolved predecessor coverage must match the generated graph");
assert.equal(graph.metadata.coverage.contracts.recompeteTimingSignals, graph.entities?.["recompete-signal"]?.length, "Recompete timing coverage must match the generated graph");
assert.ok(graph.metadata.coverage.contracts.exactParentVehicles >= 100 && graph.metadata.coverage.contracts.multiOrderFamilies > 0, "Contract-family coverage regressed below the verified operating baseline");
assert.equal(graph.entities?.["acquisition-path"]?.length, 31, "Every published acquisition path must exist once");
assert.equal(graph.entities?.["recompete-signal"]?.length, 237, "Every bounded timing signal must exist once");
assert.equal(graph.metadata.relationCounts["activity-ordered-under-vehicle"], graph.metadata.coverage.contracts.activitiesWithExactParent, "Exact activity-to-parent-vehicle coverage changed");
assert.ok(graph.metadata.relationCounts["award-ordered-under-vehicle"] >= 100, "Award-to-parent-vehicle coverage regressed below the verified baseline");
assert.equal(graph.metadata.relationCounts["activity-uses-acquisition-path"], 58, "Published acquisition-path coverage changed");
assert.ok(graph.metadata.relationCounts["contract-vehicle-associated-with-path"] >= 15, "Exact vehicle/path crosswalk coverage regressed below the verified baseline");
assert.equal(graph.metadata.relationCounts["activity-follow-on-to"], 3, "Exact predecessor coverage changed");
assert.equal(graph.metadata.relationCounts["activity-has-recompete-signal"], 237, "Review-only timing signal coverage changed");
assert.equal(graph.metadata.relationCounts["award-has-recompete-signal"], 237, "Award timing signal coverage changed");
assert.equal(graph.entities?.["evidence-claim"]?.length, graph.metadata.relationCounts["evidence-conflict-has-claim"], "Every retained conflict claim must exist once");
assert.equal(graph.entities?.["evidence-conflict"]?.length, graph.metadata.coverage.temporal.totalConflicts, "Evidence conflict coverage must match the temporal summary");
assert.ok(graph.metadata.relationCounts["evidence-claim-about"] >= 900, "Evidence claim target coverage regressed below the verified baseline");
assert.equal(graph.metadata.relationCounts["evidence-conflict-resolved-by"], graph.metadata.coverage.temporal.resolved_by_recency, "Recency resolution coverage must match the temporal summary");
assert.equal(graph.metadata.coverage.temporal.relationsAssessed, ["current", "historical", "future", "stale", "superseded", "unknown"].reduce((total, key) => total + graph.metadata.coverage.temporal[key], 0), "Temporal status counts must cover every assessed relationship");
assert.equal(graph.metadata.coverage.temporal.totalConflicts, graph.metadata.coverage.temporal.resolved_by_recency + graph.metadata.coverage.temporal.needs_review, "Every evidence conflict must be resolved or queued for review");
assert.equal(graph.metadata.coverage.temporal.totalConflicts, Object.values(graph.metadata.coverage.temporal.kinds).reduce((total, count) => total + count, 0), "Temporal conflict kinds must cover every evidence conflict");

const organizationIdentifiers = graph.entities?.["organization-identifier"] || [];
const ueiIdentifiers = organizationIdentifiers.filter((item) => item.namespace === "uei");
const officeIdentifiers = organizationIdentifiers.filter((item) => item.namespace === "officeCode");
assert.equal(ueiIdentifiers.length, graph.metadata.coverage.organizations.canonicalUeiIdentities, "Every published UEI must exist once as a typed organization identifier");
assert.equal(new Set(ueiIdentifiers.map((item) => item.value)).size, ueiIdentifiers.length, "UEI identifier entities must be unique");
assert.equal(officeIdentifiers.length, 50, "Every reviewed office code must exist once as a typed organization identifier");
assert.equal(new Set(officeIdentifiers.map((item) => item.value)).size, officeIdentifiers.length, "Office-code identifier entities must be unique");
const ueiOrganizations = graph.entities.organization.filter((item) => item.identity?.identifiers?.uei);
assert.equal(new Set(ueiOrganizations.map((item) => item.identity.identifiers.uei)).size, ueiOrganizations.length, "Distinct UEIs must never collapse into one label-based organization");
const vectrus = ueiOrganizations.find((item) => item.identity.identifiers.uei === "RRFJZGASZJ41");
const vectrusNames = new Set([vectrus?.label, ...(vectrus?.aliases || [])]);
assert.ok(vectrusNames.has("VECTRUS SYSTEMS CORPORATION") && vectrusNames.has("V2X SYSTEMS LLC"), "Exact UEI identity must retain published recipient aliases and renames");

assert.equal(organizationReview.metadata?.schemaVersion, "1.0.0", "Organization identity review schema changed");
assert.equal(organizationReview.metadata?.graphSchemaVersion, INTELLIGENCE_GRAPH_SCHEMA_VERSION, "Organization review must track the graph schema");
assert.equal(organizationReview.resolvedAliases.length, 23, "Organization review must publish every UEI-resolved alias group");
assert.equal(organizationReview.conflicts.length, 11, "Organization review must retain every ambiguous normalized label");
assert.ok(organizationReview.conflicts.every((item) => item.status === "needs_review" && item.candidateUeis.length > 1), "Ambiguous organization labels must remain review-only multi-UEI candidates");
assert.ok(readFileSync(resolve(ROOT, "public/data/organization-identity-review.json")).byteLength < 100_000, "Organization identity review exceeds its 100 KB audit budget");

const contractVehicles = graph.entities?.["contract-vehicle"] || [];
const recompeteSignals = graph.entities?.["recompete-signal"] || [];
assert.equal(new Set(contractVehicles.map((item) => item.id)).size, contractVehicles.length, "Contract-vehicle entity IDs must be unique");
assert.equal(new Set(contractVehicles.map((item) => item.generatedAwardId)).size, contractVehicles.length, "Exact parent award IDs must not collapse into one vehicle");
assert.ok(recompeteSignals.every((item) => item.status === "candidate" && item.reviewState === "needs_review"), "Timing signals must remain review-only candidates");
assert.equal(contractLineageIndex.metadata?.schemaVersion, CONTRACT_LINEAGE_SCHEMA_VERSION, "Contract lineage index schema changed");
assert.equal(contractLineageIndex.metadata?.graphSchemaVersion, INTELLIGENCE_GRAPH_SCHEMA_VERSION, "Contract lineage index must track the graph schema");
assert.ok(Object.keys(contractLineageIndex.indices?.byActivity || {}).length >= 350, "Lineage browser index coverage regressed below the verified baseline");
assert.equal(contractLineageIndex.metadata?.summary?.exactParentVehicles, graph.metadata.coverage.contracts.exactParentVehicles, "Lineage index must retain exact parent-vehicle coverage");
assert.equal(contractLineageIndex.metadata?.summary?.resolvedPredecessorLinks, 3, "Lineage index must retain resolved predecessor coverage");
assert.equal(contractLineageIndex.metadata?.summary?.unresolvedFollowOnClaims, 18, "Lineage index must retain unresolved follow-on coverage");
assert.equal(contractLineageReview.metadata?.schemaVersion, CONTRACT_LINEAGE_SCHEMA_VERSION, "Contract lineage review schema changed");
assert.equal(contractLineageReview.metadata?.graphSchemaVersion, INTELLIGENCE_GRAPH_SCHEMA_VERSION, "Contract lineage review must track the graph schema");
assert.equal(contractLineageReview.predecessorConflicts.length, 0, "Exact predecessor conflicts require explicit review");
assert.equal(contractLineageReview.unresolvedFollowOnClaims.length, 18, "Every unresolved follow-on claim must remain in the review queue");
assert.ok(contractLineageReview.unresolvedFollowOnClaims.every((item) => item.status === "needs_review" && item.reason && item.sourceUrls?.length), "Unresolved follow-on claims must retain review state, reason, and sources");
assert.ok(readFileSync(resolve(ROOT, "public/data/contract-lineage-index.json")).byteLength < 350_000, "Contract lineage browser index exceeds its 350 KB route-on-demand budget");
assert.ok(readFileSync(resolve(ROOT, "public/data/contract-lineage-review.json")).byteLength < 100_000, "Contract lineage review exceeds its 100 KB audit budget");

assert.equal(temporalEvidenceIndex.metadata?.schemaVersion, TEMPORAL_EVIDENCE_SCHEMA_VERSION, "Temporal evidence index schema changed");
assert.equal(temporalEvidenceIndex.metadata?.graphSchemaVersion, INTELLIGENCE_GRAPH_SCHEMA_VERSION, "Temporal evidence index must track the graph schema");
assert.equal(Object.keys(temporalEvidenceIndex.indices?.byActivity || {}).length, 888, "Temporal browser index must cover every canonical activity");
assert.deepEqual(temporalEvidenceIndex.metadata?.summary, graph.metadata.coverage.temporal, "Temporal browser summary must match the canonical graph");
assert.equal(temporalEvidenceReview.metadata?.schemaVersion, TEMPORAL_EVIDENCE_SCHEMA_VERSION, "Temporal review schema changed");
assert.equal(temporalEvidenceReview.metadata?.graphSchemaVersion, INTELLIGENCE_GRAPH_SCHEMA_VERSION, "Temporal review must track the graph schema");
assert.equal(temporalEvidenceReview.conflicts?.length, graph.metadata.coverage.temporal.totalConflicts, "Every evidence disagreement must remain reviewable");
const evidenceClaims = new Map(temporalEvidenceReview.conflicts.flatMap((conflict) => conflict.claims || []).map((claim) => [claim.id, claim]));
assert.equal(evidenceClaims.size, graph.entities?.["evidence-claim"]?.length, "Every competing claim must remain in the review artifact");
assert.ok(temporalEvidenceReview.conflicts.every((conflict) => CONFLICT_STATUS_VALUES.includes(conflict.status) && conflict.claimIds?.length >= 1 && conflict.claimIds.every((id) => evidenceClaims.has(id))), "Every conflict or unresolved claim must retain typed status and complete claim membership");
assert.ok(temporalEvidenceReview.conflicts.filter((conflict) => conflict.kind !== "lineage").every((conflict) => conflict.claimIds.length > 1), "Non-lineage disagreements must retain every competing claim");
assert.ok(temporalEvidenceReview.conflicts.filter((conflict) => conflict.status === "resolved_by_recency").every((conflict) => conflict.winningClaimId && conflict.claimIds.includes(conflict.winningClaimId)), "Recency resolutions must point to one of the retained claims");
assert.ok(temporalEvidenceReview.conflicts.filter((conflict) => conflict.status === "needs_review").every((conflict) => !conflict.winningClaimId && conflict.reason), "Review-required conflicts must remain unresolved with a reason");
assert.ok(readFileSync(resolve(ROOT, "public/data/temporal-evidence-index.json")).byteLength < 1_000_000, "Temporal browser index exceeds its 1 MB route-on-demand budget");
assert.ok(readFileSync(resolve(ROOT, "public/data/temporal-evidence-review.json")).byteLength < 900_000, "Temporal evidence review exceeds its 900 KB audit budget");

for (const [opportunityId, index] of Object.entries(graph.indices.byActivity)) {
  assert.equal(index.activityId, opportunityId);
  assert.ok(entities.has(index.entityId));
  for (const id of [...index.awardIds, ...index.eventIds, ...index.transactionIds, ...index.organizationIds, ...index.locationIds, ...index.accountIds, ...index.subawardSummaryIds, ...index.classificationIds, ...index.sourceIds]) assert.ok(entities.has(id), `Activity ${opportunityId} references missing entity ${id}`);
}

const unsafeSources = graph.entities.source.filter((item) => !/^https?:\/\//.test(item.url) || /(?:token|key|secret|password)=/i.test(item.url));
assert.deepEqual(unsafeSources, [], "Source entities must use safe public HTTP(S) URLs without credential-shaped query keys");
assert.equal(graphIndex.metadata?.schemaVersion, INTELLIGENCE_GRAPH_SCHEMA_VERSION);
assert.equal(Object.keys(graphIndex.indices?.byActivity || {}).length, 888, "The deferred activity graph index must cover every canonical activity");
assert.ok(readFileSync(resolve(ROOT, "public/data/intelligence-graph-index.json")).byteLength < 3_000_000, "Deferred record graph index exceeds the 3 MB route-on-demand budget");

assert.equal(linkedIntelligence.metadata?.schemaVersion, LINKED_INTELLIGENCE_SCHEMA_VERSION, "Linked browser index schema changed");
assert.equal(linkedIntelligence.metadata?.graphSchemaVersion, INTELLIGENCE_GRAPH_SCHEMA_VERSION, "Linked browser index must track the canonical graph schema");
assert.deepEqual(gunzipSync(linkedIntelligenceGzipBytes), linkedIntelligenceBytes, "Compressed linked browser index must be byte-identical after decompression");
assert.ok(linkedIntelligenceGzipBytes.byteLength < 1_200_000, "Compressed linked browser index exceeds its 1.2 MB route-on-demand budget");
const linkedNodes = Object.values(linkedIntelligence.nodes || {});
const linkedRelations = linkedIntelligence.relations || [];
const linkedOrganization = (label) => linkedNodes.find((node) => node.type === "organization" && node.label === label);
const departmentOfWar = linkedOrganization("Department of War");
const navy = linkedOrganization("Department of the Navy");
const army = linkedOrganization("United States Army");
const airForce = linkedOrganization("United States Air Force");
const spaceForce = linkedOrganization("United States Space Force");
const cyberCommand = linkedOrganization("United States Cyber Command");
const navair = linkedOrganization("Naval Air Systems Command");
const navwar = linkedOrganization("Naval Information Warfare Systems Command");
const niwcPacific = linkedOrganization("Naval Information Warfare Center Pacific");
const niwcAtlantic = linkedOrganization("Naval Information Warfare Center Atlantic");
for (const organization of [departmentOfWar, navy, army, airForce, spaceForce, cyberCommand, navair, navwar, niwcPacific, niwcAtlantic]) assert.ok(organization, "Every reviewed department, service, command, and component must remain addressable in linked intelligence");
assert.equal(departmentOfWar.legalName, "Department of Defense", "Department of War must retain the controlling statutory legal name");
assert.equal(departmentOfWar.status, "current-secondary-title", "Department of War must remain a time-aware secondary title rather than an asserted statutory rename");
assert.equal(departmentOfWar.effectiveFrom, "2025-09-05", "Department of War secondary-title validity must retain its official effective date");
const linkedHierarchy = linkedRelations.filter((relation) => relation.type === "organization-part-of");
assert.equal(linkedHierarchy.length, 65, "Linked intelligence must expose 61 reviewed department/service/command edges and four reviewed office edges");
assert.ok(linkedHierarchy.every((relation) => relation.evidence?.sourceArtifact === "reviewed-organization-hierarchy" && relation.evidence?.reviewState === "reviewed"), "Source-declared taxonomy must never be presented as reviewed command hierarchy");
assert.equal(linkedIntelligence.metadata?.reviewedHierarchy?.organizations, 62, "Reviewed hierarchy metadata must publish every reviewed organization");
assert.equal(linkedIntelligence.metadata?.reviewedHierarchy?.relationships, 61, "Reviewed hierarchy metadata must publish every reviewed parent-child relationship");
assert.match(linkedIntelligence.metadata?.reviewedHierarchy?.coverageStatement || "", /Omission does not imply/i, "Reviewed hierarchy must disclose that uncovered organizations are not negative assertions");
const departmentHierarchy = linkedIntelligence.indices?.byEntity?.[departmentOfWar.id]?.hierarchy;
assert.equal(departmentHierarchy?.descendantIds?.length, 64, "Department of War drill-down must reach every canonical reviewed organization and contracting-office descendant");
assert.equal(departmentHierarchy?.childIds?.length, 23, "Department of War must expose principal staff, military departments, combatant commands, and selected agencies as direct reviewed components");
assert.ok(departmentHierarchy.childIds.includes(cyberCommand.id), "United States Cyber Command must remain a direct reviewed department component");
const departmentWork = linkedIntelligence.indices?.byEntity?.[departmentOfWar.id]?.workSummary;
assert.ok(departmentWork?.opportunities >= 400 && departmentWork?.awards >= 400 && departmentWork?.accounts >= 30 && departmentWork?.obligatedAmount > 700_000_000_000, "Department drill-down must publish useful descendant work, award, account, and obligation totals");
const navairWorkIndex = linkedIntelligence.indices?.byEntity?.[navair.id];
assert.ok(navairWorkIndex?.workSummary?.directOpportunities >= 40, "NAVAIR must retain exact direct-work coverage in its hierarchy summary");
assert.ok(navairWorkIndex?.workSummary?.directAwards >= 30 && navairWorkIndex?.workSummary?.directAccounts >= 10 && navairWorkIndex?.workSummary?.directObligatedAmount > 200_000_000_000, "NAVAIR must distinguish exact direct award, account, and obligation coverage from its subtree rollup");
assert.ok(navairWorkIndex?.workHighlights?.direct?.activityIds?.length > 0 && navairWorkIndex?.workHighlights?.direct?.activityIds?.length <= 8, "Direct organization work highlights must remain useful and bounded");
assert.ok(navairWorkIndex?.workHighlights?.subtree?.awardIds?.every((id) => linkedIntelligence.nodes?.[id]?.type === "award"), "Organization work highlights must retain exact graph award identities");
assert.ok(navairWorkIndex?.workHighlights?.subtree?.accountIds?.every((id) => linkedIntelligence.nodes?.[id]?.type === "federal-account"), "Organization work highlights must retain exact graph account identities");
assert.ok(linkedHierarchy.some((relation) => relation.from === navair.id && relation.to === navy.id), "NAVAIR must retain its reviewed Department of the Navy parent");
assert.ok(linkedHierarchy.some((relation) => relation.from === niwcPacific.id && relation.to === navwar.id), "NIWC Pacific must retain its reviewed NAVWAR parent");
assert.ok(linkedHierarchy.some((relation) => relation.from === niwcAtlantic.id && relation.to === navwar.id), "NIWC Atlantic must retain its reviewed NAVWAR parent");
for (const [organization, minimum] of [[navy, 100], [navair, 20], [navwar, 5], [niwcPacific, 1], [niwcAtlantic, 1]]) {
  assert.ok((linkedIntelligence.indices?.byEntity?.[organization.id]?.timelineActivityIds || []).length >= minimum, `${organization.label} must retain a useful entity-scoped Timeline`);
}
const operationsNavy = linkedNodes.find((node) => node.type === "federal-account" && node.federalAccountCode === "017-1804");
assert.ok(operationsNavy, "Operation and Maintenance, Navy must remain a rootable linked account");
const navairCoverage = summarizeRelationshipCoverage(linkedIntelligence, navair.id);
assert.ok(navairCoverage.relationships >= 70 && navairCoverage.neighborCounts.hierarchy >= 3 && navairCoverage.neighborCounts.work >= 40, "Graph lens counts must describe NAVAIR's complete retained neighborhood rather than only visible slices");
const navairMoneyPath = findEvidencePath(linkedIntelligence, navair.id, operationsNavy.id);
assert.equal(navairMoneyPath?.hops, 3, "NAVAIR should trace to Operation and Maintenance, Navy through one activity and its exact award");
assert.deepEqual(navairMoneyPath?.relations.map((relation) => relation.type), ["activity-funding-organization", "activity-awarded-as", "award-funded-by-account"], "NAVAIR's account trace must preserve the retained work-to-award-to-account chain");
assert.equal(relationLabel(navairMoneyPath.relations[0], navairMoneyPath.nodeIds[0]), "funded activity", "Connection traces must render relationship direction from each path step");
const niwcNavairPath = findEvidencePath(linkedIntelligence, niwcPacific.id, navair.id);
assert.equal(niwcNavairPath?.hops, 2, "NIWC Pacific should expose its retained two-step activity connection to NAVAIR");
assert.ok(niwcNavairPath.relations.every((relation) => relation.evidence?.basis && relation.evidence?.confidence && relation.evidence?.reviewState), "Every connection-trace step must retain evidence basis, confidence, and review state");
const weightedPathFixture = {
  nodes: Object.fromEntries(["start", "first", "best", "target"].map((id) => [id, { id, type: "organization" }])),
  relations: [
    { id: "start-first", from: "start", to: "first", type: "organization-part-of", evidence: { sourceArtifact: "reviewed-organization-hierarchy" } },
    { id: "first-target", from: "first", to: "target", type: "organization-part-of", evidence: { confidence: "source_declared" } },
    { id: "start-best", from: "start", to: "best", type: "organization-part-of", evidence: { confidence: "exact" } },
    { id: "best-target", from: "best", to: "target", type: "organization-part-of", evidence: { sourceArtifact: "reviewed-organization-hierarchy", confidence: "reviewed", reviewState: "reviewed" } },
  ],
  indices: { byEntity: {
    start: { relationIds: [0, 2] },
    first: { relationIds: [0, 1] },
    best: { relationIds: [2, 3] },
    target: { relationIds: [1, 3] },
  } },
};
assert.deepEqual(findEvidencePath(weightedPathFixture, "start", "target")?.relations.map((relation) => relation.id), ["start-best", "best-target"], "Connection search must return the best evidence-weighted target path, not the first target path discovered");

assert.equal(agentGraphManifest.metadata?.schemaVersion, "1.1.0", "Agent graph directory schema changed");
assert.equal(agentGraphManifest.metadata?.graphSchemaVersion, INTELLIGENCE_GRAPH_SCHEMA_VERSION, "Agent graph directory must track the canonical graph schema");
assert.deepEqual(agentGraphManifest.domain?.entityTypes, INTELLIGENCE_ENTITY_TYPES, "Agent graph directory must publish every entity type");
assert.deepEqual(agentGraphManifest.domain?.relationTypes, INTELLIGENCE_RELATION_TYPES, "Agent graph directory must publish every relation type");
assert.equal(agentGraphManifest.totals?.entities, graphSummary.totals.entities, "Agent graph directory must retain every canonical entity");
assert.equal(agentGraphManifest.totals?.relations, graphSummary.totals.relations, "Agent graph directory must retain the canonical relation count");
const entityTypeById = new Map(Object.entries(graph.entities).flatMap(([type, rows]) => rows.map((row) => [row.id, type])));
for (const type of INTELLIGENCE_ENTITY_TYPES) {
  const entityPath = resolve(ROOT, `public/data/agent-graph/entities-${type}.json`);
  const entityShard = JSON.parse(readFileSync(entityPath, "utf8"));
  const relationPaths = agentGraphManifest.entityTypes[type].relationPaths || [];
  const relationPages = relationPaths.map((path) => ({ path: resolve(ROOT, `public${path}`), shard: JSON.parse(readFileSync(resolve(ROOT, `public${path}`), "utf8")) }));
  const relationRows = relationPages.flatMap(({ shard }) => shard.relations || []);
  assert.equal(entityShard.entityType, type, `Agent entity shard ${type} must self-identify`);
  assert.equal(entityShard.entities.length, graph.metadata.entityCounts[type], `Agent entity shard ${type} count changed`);
  assert.ok(entityShard.entities.every((entity) => entityTypeById.get(entity.id) === type), `Agent entity shard ${type} contains another entity type`);
  assert.ok(relationPages.length >= 1, `Agent relation directory ${type} must publish at least one page`);
  assert.ok(relationPages.every(({ shard }, index) => shard.entityType === type && shard.page === index + 1 && shard.pages === relationPages.length), `Agent relation pages ${type} must self-identify and remain ordered`);
  assert.equal(relationRows.length, agentGraphManifest.entityTypes[type].relationCount, `Agent relation pages ${type} must retain every relation`);
  assert.equal(new Set(relationRows.map((relation) => relation.id)).size, relationRows.length, `Agent relation pages ${type} must not overlap`);
  assert.ok(relationRows.every((relation) => entityTypeById.get(relation.from) === type || entityTypeById.get(relation.to) === type), `Agent relation pages ${type} contain an unrelated relation`);
  assert.ok(statSync(entityPath).size < 10_000_000, `Agent entity shard ${type} exceeds its 10 MB API asset budget`);
  assert.ok(relationPages.every(({ path }) => statSync(path).size < 10_000_000), `Agent relation page ${type} exceeds its 10 MB API asset budget`);
}
console.log(JSON.stringify({ status: "passed", entities: graph.metadata.entityCounts, relations: relations.length, coverage: graph.metadata.coverage }, null, 2));
