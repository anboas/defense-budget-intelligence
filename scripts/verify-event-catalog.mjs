import assert from "node:assert/strict";
import {
  EVENT_CATALOG_SOURCE_REGISTRY,
  catalogEventById,
  catalogEventToDraft,
  eventCatalog,
  searchEventCatalog,
} from "../src/event-catalog.js";
import { extractOfficialEventCandidates, findCatalogDuplicate } from "../src/event-discovery-runtime.js";

const catalog = eventCatalog();
assert.ok(catalog.length >= 12, "The curated catalog must ship with a useful baseline");
assert.equal(new Set(catalog.map((event) => event.id)).size, catalog.length, "Catalog event IDs must be unique");
assert.equal(new Set(catalog.map((event) => `${event.seriesId}|${event.title}`)).size, catalog.length, "Catalog editions must be unique");
assert.ok(EVENT_CATALOG_SOURCE_REGISTRY.length >= 12, "The discovery registry must cover the priority source set");
assert.ok(EVENT_CATALOG_SOURCE_REGISTRY.every((source) => new URL(source.url).protocol === "https:"), "Discovery sources must use HTTPS");

const iitsec = catalogEventById("catalog-iitsec-2026");
assert.ok(iitsec?.startsAt, "A dated catalog event must be available for direct calendar import");
assert.ok(iitsec.sources.some((source) => source.kind === "official"), "A verified catalog event must retain an official source");
assert.deepEqual(searchEventCatalog({ query: "simulation", today: "2026-09-22" }).map((event) => event.id), ["catalog-iitsec-2026"], "Catalog search must include taxonomy fields");
assert.ok(searchEventCatalog({ branch: "Army", includePast: true, today: "2026-09-22" }).every((event) => event.branch === "Army"), "Branch filtering must be exact");
assert.ok(searchEventCatalog({ datedOnly: true, today: "2026-09-22" }).every((event) => event.startsAt), "Dated-only search must exclude projected undated editions");
assert.ok(!searchEventCatalog({ today: "2026-09-22" }).some((event) => event.status === "past"), "Past editions must stay hidden by default");

const draft = catalogEventToDraft(iitsec, ["conference"]);
assert.equal(draft.catalogEventId, iitsec.id);
assert.equal(draft.catalogRevision, iitsec.revision);
assert.deepEqual(draft.categoryIds, ["conference"]);
assert.equal(draft.intelligence.sponsor, iitsec.sponsor);
assert.ok(draft.intelligence.sources.every((source) => source.url.startsWith("https://")), "Imported intelligence must preserve safe source URLs");
assert.deepEqual(draft.attendeeIds, [], "Catalog import must never assign workspace attendees");
assert.deepEqual(draft.recordIds, [], "Catalog import must never assign workspace records");
assert.deepEqual(draft.teamIds, [], "Catalog import must never assign workspace teams");

catalog[0].title = "Mutated";
assert.notEqual(eventCatalog()[0].title, "Mutated", "Catalog reads must return detached values");

const discovered = extractOfficialEventCandidates(`<!doctype html><script type="application/ld+json">${JSON.stringify({
  "@context": "https://schema.org", "@type": "Event", name: "I/ITSEC 2026", startDate: "2026-11-30",
  endDate: "2026-12-04", url: "https://www.iitsec.org/", location: { "@type": "Place", name: "Orange County Convention Center", address: { addressLocality: "Orlando", addressRegion: "FL", addressCountry: "USA" } },
})}</script>`, EVENT_CATALOG_SOURCE_REGISTRY.find((source) => source.id === "iitsec"));
assert.equal(discovered.length, 1, "Official JSON-LD events should enter the review queue");
assert.equal(discovered[0].startsAt, "2026-11-30T08:00");
assert.equal(discovered[0].sources[0].kind, "official");
assert.ok(findCatalogDuplicate(discovered[0], eventCatalog()), "Discovery must flag an edition already represented in the catalog");
assert.deepEqual(extractOfficialEventCandidates("<html><h1>Unstructured event rumor</h1></html>", EVENT_CATALOG_SOURCE_REGISTRY[0]), [], "Unstructured pages must not create unsupported event candidates");

console.log(`Verified ${eventCatalog().length} curated event editions, ${EVENT_CATALOG_SOURCE_REGISTRY.length} discovery sources, search filters, and safe calendar projection`);
