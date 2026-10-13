import assert from "node:assert/strict";
import fs from "node:fs";
import { parseAcquisitionPortfolioHtml } from "../src/acquisition-portfolio-import.js";
import { mergeD1RecordUniverse } from "../src/d1-record-universe.js";

const requestedPath = process.argv[2];
const fixture = `<!doctype html><script type="application/json" id="portfolio-meta">{"asof":"2026-10-13","sources":[{"id":"DD","name":"NSWCDD FY26 Q4","url":"https://example.test/source","date":"2026-08-10"}],"dedup":[],"supportingDocuments":[]}</script><script type="application/json" id="source-data">[{"id":"DD-1","title":"Cyber support","description":"Cybersecurity engineering","source":"DD","sourceName":"NSWCDD FY26 Q4","organization":"NSWCDD","customer":"A Department","incumbent":"Example Inc.","value":"$10M-$50M","rfpTime":{"lo":"2027-01-01","hi":"2027-03-31","precision":"quarter","label":"FY27 Q2"},"awardTime":{"lo":"2027-07-01","hi":"2027-09-30","precision":"quarter","label":"FY27 Q4"},"setaside":"Unrestricted","route":"Unrestricted","priority":1,"score":85,"area":"Cybersecurity","lineage":[],"events":[]}]</script>`;
const html = requestedPath ? fs.readFileSync(requestedPath, "utf8") : fixture;
const parsed = parseAcquisitionPortfolioHtml(html, { filename: requestedPath || "fixture.html", importedAt: "2026-10-13T16:00:00.000Z" });

assert.equal(parsed.records.length, parsed.metadata.recordCount);
assert.equal(new Set(parsed.records.map((record) => record.sourceRecordId)).size, parsed.records.length);
assert.ok(parsed.records.every((record) => record.recordKind === "acquisition-portfolio"));
assert.ok(parsed.records.every((record) => record.acquisitionIntel?.id === record.sourceRecordId));
assert.ok(parsed.records.every((record) => record.events.some((event) => event.kind === "forecast-rfp") || !record.acquisitionIntel.rfpTime?.lo));
assert.ok(parsed.records.every((record) => record.events.some((event) => event.kind === "forecast-award") || !record.acquisitionIntel.awardTime?.lo));

const imported = parsed.records[0];
const universe = mergeD1RecordUniverse({ metadata: { asOf: "2026-10-13" }, records: [] }, [], [{
  record_json: JSON.stringify({ ...imported, solicitationNumber: "" }),
  first_seen_at: "2026-10-13T16:00:00.000Z",
  last_seen_at: "2026-10-13T16:00:00.000Z",
  last_changed_at: "2026-10-13T16:00:00.000Z",
}]);
assert.equal(universe.records.length, 1, "Portfolio records without solicitation IDs must remain visible");
assert.equal(universe.records[0].opportunityId, imported.opportunityId, "Portfolio imports must retain their stable record identity");
assert.deepEqual(universe.records[0].acquisitionIntel, imported.acquisitionIntel, "Portfolio imports must retain the original source payload");

if (requestedPath) {
  assert.equal(parsed.records.length, 1364);
  assert.equal(parsed.metadata.sources.length, 12);
  assert.equal(parsed.metadata.supportingDocuments.length, 31);
  assert.equal(parsed.metadata.dedup.length, 10);
  assert.equal(parsed.records.reduce((total, record) => total + (record.acquisitionIntel.events?.length || 0), 0), 29);
}

console.log(`Acquisition portfolio import verified: ${parsed.records.length} records, ${parsed.metadata.sources.length} sources, ${parsed.records.reduce((total, record) => total + record.events.length, 0)} timeline events.`);
