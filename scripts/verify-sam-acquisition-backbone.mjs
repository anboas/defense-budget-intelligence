import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  hierarchyObservations,
  normalizeContractAward,
  normalizeEntityRegistration,
  normalizeOpportunity,
  normalizeSubaward,
} from "./sam-acquisition-backbone-core.mjs";

const observedAt = "2026-09-30T12:00:00.000Z";
const opportunity = normalizeOpportunity({
  noticeId: "notice-1", solicitationNumber: "SOL-1", title: "Secure platform modernization", postedDate: "2026-09-01",
  responseDeadLine: "2026-10-15", type: "Solicitation", naicsCode: "541512", classificationCode: "D302",
  fullParentPathName: "DEPT OF DEFENSE.AIR FORCE.AFLCMC", fullParentPathCode: "9700.5700.FA8684", active: "Yes",
  award: { number: "FA0001-26-C-0001", date: "2026-11-01", amount: "1250000", awardee: { name: "Example Systems", ueiSAM: "ABC123XYZ789" } },
}, observedAt);
assert.equal(opportunity.notice.id, "opportunity-notice:notice-1");
assert.match(opportunity.version.id, /^notice-version:notice-1:/);
assert.equal(opportunity.awardAction.piid, "FA0001-26-C-0001");
assert.equal(opportunity.awardAction.recipientUei, "ABC123XYZ789");

const modification = normalizeContractAward({
  contractTransactionUniqueKey: "action-1", piid: "FA0001-26-C-0001", modificationNumber: "P00001",
  actionDate: "2026-12-01", actionObligation: "250000", referencedIdvPiid: "FA0001-25-D-0001", recipientUei: "ABC123XYZ789",
}, observedAt);
assert.equal(modification.modificationNumber, "P00001");
assert.equal(modification.actionObligation, 250000);
assert.equal(modification.referencedIdvPiid, "FA0001-25-D-0001");

const entity = normalizeEntityRegistration({
  entityRegistration: { ueiSAM: "ABC123XYZ789", cageCode: "1A2B3", legalBusinessName: "Example Systems", registrationStatus: "Active" },
  coreData: { businessTypes: { businessTypeList: [{ businessTypeCode: "2X", businessTypeDesc: "For Profit Organization" }] } },
}, observedAt);
assert.equal(entity.registration.cageCode, "1A2B3");
assert.equal(entity.certifications.length, 1);

const subaward = normalizeSubaward({
  primeContractKey: "prime-key", subawardReportId: "report-1", piid: "FA0001-26-C-0001", subAwardAmount: "50000",
  primeAwardeeUEI: "ABC123XYZ789", subAwardeeUEI: "SUB123XYZ789", subAwardeeName: "Example Subcontractor",
}, observedAt);
assert.equal(subaward.amount, 50000);
assert.equal(subaward.recipientUei, "SUB123XYZ789");

const hierarchy = hierarchyObservations([opportunity.notice], observedAt);
assert.equal(hierarchy.length, 3);
assert.equal(hierarchy[2].parentName, "AIR FORCE");

const artifact = JSON.parse(readFileSync(resolve("src/data/sam-acquisition-backbone.json"), "utf8"));
assert.equal(artifact.metadata.schemaVersion, "1.0.0");
for (const collection of ["notices", "noticeVersions", "awardActions", "vendorRegistrations", "businessCertifications", "hierarchyObservations", "subawards"]) {
  assert.ok(Array.isArray(artifact.collections[collection]), `${collection} must be an array`);
}
for (const adapter of ["opportunities", "contractAwards", "entityRegistrations", "federalHierarchy", "acquisitionSubawards"]) {
  assert.ok(artifact.coverage[adapter], `${adapter} coverage must be explicit`);
}
console.log("SAM acquisition backbone normalization and fail-closed coverage contract passed");
