import assert from "node:assert/strict";
import {
  EVENT_CATALOG_SOURCE_REGISTRY,
  catalogEventById,
  catalogEventToDraft,
  eventCatalog,
  searchEventCatalog,
} from "../src/event-catalog.js";
import {
  applyCuratorCandidate,
  discoverSourceCandidates,
  eventCandidateQuality,
  extractFeedEventLinks,
  extractIcsEventCandidates,
  extractOfficialDetailLinks,
  extractOfficialEventCandidates,
  extractSamEventCandidates,
  extractSitemapEventLinks,
  findCatalogDuplicate,
  findCatalogDuplicateMatch,
  runEventDiscoverySweep,
} from "../src/event-discovery-runtime.js";

const catalog = eventCatalog();
assert.ok(catalog.length >= 12, "The curated catalog must ship with a useful baseline");
assert.equal(new Set(catalog.map((event) => event.id)).size, catalog.length, "Catalog event IDs must be unique");
assert.equal(new Set(catalog.map((event) => `${event.seriesId}|${event.title}`)).size, catalog.length, "Catalog editions must be unique");
assert.ok(EVENT_CATALOG_SOURCE_REGISTRY.length >= 30, "The discovery registry must cover official acquisition, innovation, service, and industry source families");
assert.ok(EVENT_CATALOG_SOURCE_REGISTRY.every((source) => new URL(source.url).protocol === "https:"), "Discovery sources must use HTTPS");
assert.ok(EVENT_CATALOG_SOURCE_REGISTRY.every((source) => source.adapter && source.cadenceHours > 0 && source.maxDetailPages >= 0), "Every source must declare an adapter, cadence, and bounded detail-page budget");
assert.ok(new Set(EVENT_CATALOG_SOURCE_REGISTRY.map((source) => source.id)).size === EVENT_CATALOG_SOURCE_REGISTRY.length, "Discovery source IDs must be unique");

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
const duplicateMatch = findCatalogDuplicateMatch(discovered[0], eventCatalog());
assert.ok(duplicateMatch.reasons.length && duplicateMatch.score >= 90, "Duplicate matching must explain its evidence instead of returning an opaque match");
const alternateCommentWrapper = extractOfficialEventCandidates(`<script type="application/ld+json"><!--${JSON.stringify({
  "@context": "https://schema.org", "@type": "Event", name: "Official test event", startDate: "2027-02-03",
  url: "https://example.test/events/official-test-event",
})}--!></script>`, { id: "test-official", name: "Test official source", url: "https://example.test/events/" });
assert.equal(alternateCommentWrapper.length, 1, "JSON-LD extraction must handle the alternate HTML comment terminator safely");
const undatedLead = extractOfficialEventCandidates(`<script type="application/ld+json">${JSON.stringify({
  "@context": "https://schema.org", "@type": "Event", name: "Official 2027 Industry Day", url: "https://example.test/events/industry-day-2027",
})}</script>`, { id: "test-official", name: "Test official source", url: "https://example.test/events/", adapter: "jsonld", branch: "Joint" });
assert.equal(undatedLead.length, 1, "Official structured events without dates must enter the queue as discovery leads");
assert.equal(undatedLead[0].status, "lead");
assert.equal(undatedLead[0].startsAt, "");
assert.deepEqual(extractOfficialEventCandidates("<html><h1>Unstructured event rumor</h1></html>", EVENT_CATALOG_SOURCE_REGISTRY[0]), [], "Unstructured pages must not create unsupported event candidates");

const adapterSource = { id: "test", name: "Test official source", url: "https://example.test/events/", adapter: "list_detail", branch: "Joint", maxDetailPages: 3 };
assert.deepEqual(extractOfficialDetailLinks('<a href="/events/industry-day-2027">2027 Industry Day</a><a href="/about">About us</a>', adapterSource).map((link) => link.url), ["https://example.test/events/industry-day-2027"], "List discovery must retain bounded event detail links and reject navigation noise");
for (const title of ["Events", "Chapter Events", "Skip to main content"]) {
  assert.equal(eventCandidateQuality({ title, sources: [{ url: `https://example.test/events/${title.toLowerCase().replaceAll(" ", "-")}` }] }).isLikelyEvent, false, `${title} must be classified as navigation noise instead of an event`);
}
assert.equal(eventCandidateQuality({ title: "2027 Federal Acquisition Summit", sources: [{ url: "https://example.test/events/federal-acquisition-summit-2027" }] }).isLikelyEvent, true, "Specific event titles must remain eligible as undated discovery leads");
const curatorVerified = applyCuratorCandidate({ title: "Federal Acquisition Summit", startsAt: "", sources: [{ title: "Listing", publisher: "Official", url: "https://example.test/events", kind: "official" }], links: [] }, { title: "2027 Federal Acquisition Summit", startsAt: "2027-06-03T09:00", officialUrl: "https://example.test/events/federal-acquisition-summit-2027", location: "Arlington, VA" });
assert.equal(curatorVerified.startsAt, "2027-06-03T09:00", "Curators must be able to add a verified date before publication");
assert.equal(curatorVerified.sources[0].url, "https://example.test/events/federal-acquisition-summit-2027", "Curator verification must retain a corrected canonical official URL");
assert.equal(curatorVerified.location, "Arlington, VA");
assert.equal(extractOfficialDetailLinks('<a href="/events/industry-day">&amp;lt;script&amp;gt; Industry Day</a>', adapterSource)[0].title, "&lt;script&gt; Industry Day", "Entity decoding must be single-pass so double-encoded markup stays inert");
assert.deepEqual(extractFeedEventLinks('<rss><channel><item><title>Vendor Outreach Session</title><link>https://example.test/events/vendor-outreach</link><description>Official outreach</description></item></channel></rss>', adapterSource).map((link) => link.url), ["https://example.test/events/vendor-outreach"], "RSS discovery must retain official event detail links");
assert.deepEqual(extractSitemapEventLinks('<urlset><url><loc>https://example.test/events/industry-day</loc></url><url><loc>https://example.test/about</loc></url></urlset>', adapterSource).map((link) => link.url), ["https://example.test/events/industry-day"], "Sitemap discovery must retain event-like official URLs only");
const icsCandidates = extractIcsEventCandidates("BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nSUMMARY:Official Industry Day\r\nDTSTART:20270304T130000Z\r\nDTEND:20270304T210000Z\r\nLOCATION:Arlington\\, VA\r\nURL:https://example.test/events/industry-day\r\nEND:VEVENT\r\nEND:VCALENDAR", { ...adapterSource, adapter: "ics" });
assert.equal(icsCandidates[0].startsAt, "2027-03-04T13:00", "ICS discovery must normalize event dates");
assert.equal(icsCandidates[0].location, "Arlington, VA");
const samCandidates = extractSamEventCandidates({ records: [
  { title: "Program Office Industry Day", description: "Official notice", sourceUrl: "https://sam.gov/opp/test/view", office: "Program Office" },
  { title: "Software license renewal", description: "Solicitation", sourceUrl: "https://sam.gov/opp/ignored/view" },
] }, { ...adapterSource, id: "sam", name: "SAM.gov", url: "https://sam.gov/content/opportunities", adapter: "sam_feed" });
assert.equal(samCandidates.length, 1, "The SAM feed adapter must create leads only for explicit industry-engagement notices");
assert.equal(samCandidates[0].startsAt, "", "SAM response deadlines must not be mistaken for event dates");

const fetchedUrls = [];
const detailDiscovery = await discoverSourceCandidates(adapterSource, { fetchImpl: async (url) => {
  fetchedUrls.push(String(url));
  if (String(url).endsWith("/events/")) return new Response('<a href="/events/industry-day-2027">2027 Industry Day</a>', { headers: { "content-type": "text/html", etag: '"listing-v1"' } });
  return new Response(`<script type="application/ld+json">${JSON.stringify({ "@context": "https://schema.org", "@type": "Event", name: "2027 Industry Day", startDate: "2027-03-04", url: String(url) })}</script>`, { headers: { "content-type": "text/html" } });
} });
assert.deepEqual(fetchedUrls, ["https://example.test/events/", "https://example.test/events/industry-day-2027"], "List/detail discovery must stay within its bounded official-source traversal");
assert.equal(detailDiscovery.candidates[0].startsAt, "2027-03-04T08:00");
const genericListingDiscovery = await discoverSourceCandidates(adapterSource, { fetchImpl: async (url) => new Response(String(url).endsWith("/events/")
  ? '<a href="/events/chapter-events">Chapter Events</a><a href="/events/skip-to-main-content">Skip to main content</a>'
  : "<html><h1>Events</h1></html>", { headers: { "content-type": "text/html" } }) });
assert.deepEqual(genericListingDiscovery.candidates, [], "Generic event-listing navigation must not create review candidates when the detail page has no structured Event evidence");
const unchangedDiscovery = await discoverSourceCandidates(adapterSource, { state: { contentHash: detailDiscovery.contentHash }, fetchImpl: async () => new Response('<a href="/events/industry-day-2027">2027 Industry Day</a>', { headers: { "content-type": "text/html" } }) });
assert.equal(unchangedDiscovery.unchanged, true, "Content hashes must suppress detail traversal when a source does not support conditional HTTP requests");
assert.deepEqual(unchangedDiscovery.candidates, []);

class DiscoveryStatement {
  constructor(db, sql) { this.db = db; this.sql = sql; this.args = []; }
  bind(...args) { this.args = args; return this; }
  async all() {
    if (this.sql.includes("FROM dbi_event_discovery_source_state")) return { results: [...this.db.sourceState.values()] };
    if (this.sql.includes("FROM dbi_event_catalog_entries")) return { results: [] };
    throw new Error(`Unhandled discovery all query: ${this.sql}`);
  }
  async first() { return null; }
  async run() {
    if (this.sql.startsWith("INSERT INTO dbi_event_discovery_runs")) { this.db.runs.set(this.args[0], { id: this.args[0], source_id: this.args[1], source_url: this.args[2], status: "running", started_at: this.args[3] }); return { meta: { changes: 1 } }; }
    if (this.sql.includes("INSERT OR IGNORE INTO dbi_event_discovery_candidates")) {
      if (this.db.candidates.has(this.args[4])) return { meta: { changes: 0 } };
      this.db.candidates.set(this.args[4], { id: this.args[0], source_id: this.args[2], status: this.args[5], candidate_json: this.args[6] });
      return { meta: { changes: 1 } };
    }
    if (this.sql.startsWith("UPDATE dbi_event_discovery_runs SET status = ?")) { Object.assign(this.db.runs.get(this.args[4]), { status: this.args[0], candidates_seen: this.args[1], candidates_added: this.args[2], completed_at: this.args[3] }); return { meta: { changes: 1 } }; }
    if (this.sql.includes("INSERT INTO dbi_event_discovery_source_state") && this.sql.includes("last_success_at")) { this.db.sourceState.set(this.args[0], { source_id: this.args[0], etag: this.args[1], last_modified: this.args[2], content_hash: this.args[3], last_success_at: this.args[4], consecutive_failures: 0, candidates_seen: this.args[5], candidates_added: this.args[6], updated_at: this.args[7] }); return { meta: { changes: 1 } }; }
    throw new Error(`Unhandled discovery run query: ${this.sql}`);
  }
}
class DiscoveryDb {
  constructor() { this.sourceState = new Map(); this.runs = new Map(); this.candidates = new Map(); }
  prepare(sql) { return new DiscoveryStatement(this, sql); }
  async batch(statements) { return Promise.all(statements.map((statement) => statement.run())); }
}
const discoveryDb = new DiscoveryDb();
const sweep = await runEventDiscoverySweep(discoveryDb, {
  catalog: eventCatalog(), maxSources: 1, now: new Date("2026-09-23T18:00:00.000Z"), appOrigin: "https://app.example.test",
  fetchImpl: async (url) => {
    assert.equal(String(url), "https://app.example.test/data/sam-opportunities.json", "The SAM adapter must consume the already protected local official feed without placing credentials in a request URL");
    return Response.json({ records: [{ title: "Program Executive Office Industry Day", description: "Official industry engagement notice", sourceUrl: "https://sam.gov/opp/industry-day/view", office: "Program Executive Office" }] }, { headers: { etag: '"sam-feed-v1"' } });
  },
});
assert.equal(sweep.sourcesAttempted, 1);
assert.equal(sweep.results[0].sourceId, "sam", "Priority scheduling must select the highest-priority never-scanned source first");
assert.equal(sweep.results[0].added, 1, "A qualifying SAM.gov engagement notice must enter the lead queue");
assert.equal([...discoveryDb.candidates.values()][0].status, "pending");
assert.equal(discoveryDb.sourceState.get("sam").etag, '"sam-feed-v1"', "Successful scans must retain conditional-request state");

console.log(`Verified ${eventCatalog().length} curated event editions, ${EVENT_CATALOG_SOURCE_REGISTRY.length} discovery sources, multi-adapter extraction, explainable matching, and safe calendar projection`);
