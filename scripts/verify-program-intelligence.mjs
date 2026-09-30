import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const program = JSON.parse(readFileSync(resolve(ROOT, "src/data/program-intelligence.json"), "utf8"));
const legislation = JSON.parse(readFileSync(resolve(ROOT, "src/data/legislative-traceability.json"), "utf8"));
const roadmap = readFileSync(resolve(ROOT, "docs/intelligence-data-roadmap.md"), "utf8");

assert.equal(program.metadata.schemaVersion, "1.0.0", "Program intelligence schema changed");
assert.deepEqual(program.metadata.coverage, {
  programs: 2723,
  programOffices: 30,
  requestBaselines: 2755,
  historicalBudgetLines: 35,
  appropriationMarks: 35,
  changedMarks: 15,
  costEstimates: 1,
  scheduleEvents: 1,
  programRisks: 2,
  acquisitionMilestones: 0,
  unitCostBreaches: 0,
  testFindings: 0,
}, "Program intelligence coverage changed");

const programById = new Map(program.programs.map((row) => [row.id, row]));
const lineById = new Map(program.historicalBudgetLines.map((row) => [row.id, row]));
assert.equal(programById.size, program.programs.length, "Defense program IDs must be unique");
assert.equal(lineById.size, program.historicalBudgetLines.length, "Historical budget-line IDs must be unique");
assert.equal(new Set(program.appropriationMarks.map((row) => row.id)).size, 35, "Appropriation mark IDs must be unique");

for (const mark of program.appropriationMarks) {
  const line = lineById.get(mark.budgetLineId);
  assert.ok(line, `Mark ${mark.id} must resolve one exact historical budget line`);
  assert.ok(programById.has(mark.programId), `Mark ${mark.id} must resolve one defense program`);
  assert.equal(mark.programId, line.programId, `Mark ${mark.id} must preserve the line's program identity`);
  assert.equal(mark.measureId, "legislative-measure:118:hr:4365", `Mark ${mark.id} must point to the exact House measure`);
  assert.equal(mark.reportId, "committee-report:CRPT-118hrpt121", `Mark ${mark.id} must point to the exact House report`);
  assert.ok(mark.printedPage >= 188 && mark.printedPage <= 190, `Mark ${mark.id} must retain a reviewed printed page`);
  assert.equal(mark.requestAmountThousands, line.requestAmountThousands, `Mark ${mark.id} request must match the official FY2024 R-1 line`);
  assert.equal(mark.recommendedAmountThousands - mark.requestAmountThousands, mark.changeAmountThousands, `Mark ${mark.id} arithmetic changed`);
  assert.equal(mark.matchBasis, "exact-account-line-number-and-request-amount", `Mark ${mark.id} must retain its exact join basis`);
  assert.match(mark.sourceUrl, /^https:\/\/www\.govinfo\.gov\//, `Mark ${mark.id} must retain official GovInfo provenance`);
}

assert.equal(program.appropriationMarks.filter((row) => row.changeAmountThousands !== 0).length, 15, "Changed House mark coverage changed");
assert.equal(program.findings.length, 4, "GAO program finding coverage changed");
assert.ok(program.findings.every((row) => row.reviewState === "source_snapshot" && row.sourceUrl === "https://www.gao.gov/products/gao-25-107569"), "GAO findings must retain the reviewed official source");
assert.equal(legislation.measures.some((row) => row.id === "legislative-measure:118:hr:4365"), true, "FY2024 defense appropriations measure must remain addressable");
assert.equal(legislation.committeeReports.some((row) => row.id === "committee-report:CRPT-118hrpt121"), true, "House Report 118-121 must remain addressable");
assert.match(legislation.metadata.caveat, /House RDT&E Army table supplies page-cited committee marks/i, "Legislative caveat must disclose the exact mark scope");
assert.match(legislation.metadata.caveat, /enacted line-item amounts remain unasserted/i, "Legislative caveat must not overstate request-to-law coverage");

assert.match(roadmap, /Official people and role tenure/i, "The enduring roadmap must preserve public professional role intelligence");
assert.match(roadmap, /Official people and role tenure\. Strategic priority/i, "The roadmap must retain the user's elevated priority for people and role tenure");
assert.match(roadmap, /promoted immediately after the[\s\S]*current Program Intelligence/i, "People and role tenure must remain the next promoted strategic workstream");
assert.match(roadmap, /Document intelligence/i, "The enduring roadmap must preserve document intelligence");
assert.match(roadmap, /Operational products/i, "The enduring roadmap must preserve operational products");

console.log(JSON.stringify({ status: "passed", coverage: program.metadata.coverage, evidenceBoundary: program.metadata.evidenceBoundary }, null, 2));
