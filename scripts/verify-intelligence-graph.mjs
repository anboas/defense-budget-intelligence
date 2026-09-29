import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { INTELLIGENCE_ENTITY_TYPES, INTELLIGENCE_GRAPH_SCHEMA_VERSION, INTELLIGENCE_RELATION_TYPES } from "../src/intelligence-graph.js";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const graph = JSON.parse(readFileSync(resolve(ROOT, "public/data/intelligence-graph.json"), "utf8"));
const graphIndex = JSON.parse(readFileSync(resolve(ROOT, "public/data/intelligence-graph-index.json"), "utf8"));
const graphSummary = JSON.parse(readFileSync(resolve(ROOT, "public/data/intelligence-graph-summary.json"), "utf8"));
const organizationReview = JSON.parse(readFileSync(resolve(ROOT, "public/data/organization-identity-review.json"), "utf8"));
const entities = new Set(Object.values(graph.entities || {}).flatMap((rows) => rows.map((row) => row.id)));
const relations = graph.relations || [];

assert.equal(graph.metadata?.schemaVersion, INTELLIGENCE_GRAPH_SCHEMA_VERSION);
assert.equal(graphSummary.metadata?.schemaVersion, INTELLIGENCE_GRAPH_SCHEMA_VERSION, "Graph summary must publish the canonical schema version");
assert.equal(graphSummary.totals.relations, graph.relations.length, "Graph summary must retain the complete relation count");
assert.equal(graphSummary.totals.entities, Object.values(graph.metadata.entityCounts).reduce((total, count) => total + count, 0), "Graph summary must retain the complete entity count");
assert.deepEqual(graph.domain?.entityTypes, INTELLIGENCE_ENTITY_TYPES);
assert.deepEqual(graph.domain?.relationTypes, INTELLIGENCE_RELATION_TYPES);
assert.equal(graph.entities?.activity?.length, 888, "All stable activities must exist in the graph");
assert.equal(graph.entities?.award?.length, 702, "All retained USAspending awards must exist in the graph");
assert.equal(graph.entities?.event?.length, 502, "All normalized public events must exist in the graph");
assert.equal(graph.entities?.transaction?.length, 3085, "All exact FPDS actions must exist in the graph");
assert.equal(graph.entities?.location?.length, 885, "All authoritative locations must exist in the graph");
assert.equal(graph.entities?.["budget-line"]?.length, 3888, "All public budget lines must exist in the graph");
assert.equal(Object.keys(graph.indices?.byActivity || {}).length, 888, "Every activity must have a graph index");
assert.ok(relations.length > 15000, "The graph should retain the complete cross-surface relation set");
assert.ok(relations.every((relation) => INTELLIGENCE_RELATION_TYPES.includes(relation.type)), "Graph contains an unknown relationship type");
assert.ok(relations.every((relation) => entities.has(relation.from) && entities.has(relation.to)), "Graph contains a dangling relationship endpoint");
assert.ok(relations.every((relation) => relation.evidence?.sourceArtifact && relation.evidence?.basis && relation.evidence?.confidence), "Every graph relationship must retain evidence metadata");
assert.equal(graph.metadata.coverage.activities.awardLinked, 702, "All retained awards must link to the canonical activity spine");
assert.equal(graph.metadata.coverage.awards.accountLinked, 183, "Known unique award-to-account coverage changed");
assert.equal(graph.metadata.relationCounts["award-funded-by-account"], 485, "Known exact award-to-account relationships changed");
assert.equal(graph.metadata.coverage.awards.subawardLinked, 379, "All checked subaward primes must join exact award IDs");
assert.equal(graph.metadata.coverage.budget.exactAccountTitleLinks, 3569, "Known exact budget-line to federal-account title links changed");
assert.equal(graph.metadata.coverage.geography.activityLocationRelations, 400, "Reviewed map placement relationship coverage changed");
assert.equal(graph.metadata.coverage.organizations.canonicalUeiIdentities, 264, "Published UEI identity coverage changed");
assert.equal(graph.metadata.coverage.organizations.reviewedOfficeCodeIdentities, 50, "Reviewed contracting-office code coverage changed");
assert.equal(graph.metadata.coverage.organizations.cageIdentities, 0, "CAGE coverage must remain explicit until published evidence enters the retained corpus");
assert.equal(graph.metadata.coverage.organizations.resolvedAliasGroups, 23, "Known UEI-resolved alias coverage changed");
assert.equal(graph.metadata.coverage.organizations.ambiguousNormalizedLabels, 11, "Known ambiguous normalized-label queue changed");
assert.equal(graph.metadata.coverage.organizations.hierarchyRelations, 93, "Source-declared organization hierarchy coverage changed");
assert.equal(graph.metadata.coverage.organizations.officeLocationRelations, 52, "Reviewed office-code/location coverage changed");
assert.equal(graph.metadata.coverage.organizations.transactionRecipientRelations, 3085, "Every exact FPDS transaction must retain its recipient identity edge");

const organizationIdentifiers = graph.entities?.["organization-identifier"] || [];
const ueiIdentifiers = organizationIdentifiers.filter((item) => item.namespace === "uei");
const officeIdentifiers = organizationIdentifiers.filter((item) => item.namespace === "officeCode");
assert.equal(ueiIdentifiers.length, 264, "Every published UEI must exist once as a typed organization identifier");
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
console.log(JSON.stringify({ status: "passed", entities: graph.metadata.entityCounts, relations: relations.length, coverage: graph.metadata.coverage }, null, 2));
