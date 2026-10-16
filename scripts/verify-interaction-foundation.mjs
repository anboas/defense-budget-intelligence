import assert from "node:assert/strict";
import { decodePursuitNote, encodePursuitNote, normalizePursuit } from "../src/pursuit-metadata.js";

const encoded = encodePursuitNote("Customer context remains readable.", {
  stage: "capture",
  owner: "Adam",
  nextAction: "Confirm customer discovery meeting",
});
const decoded = decodePursuitNote(encoded);

assert.deepEqual(decoded.pursuit, {
  stage: "capture",
  owner: "Adam",
  nextAction: "Confirm customer discovery meeting",
}, "Pursuit metadata should round-trip through the existing tracking note boundary");
assert.equal(decoded.note, "Customer context remains readable.", "Human workspace notes must stay separate from pursuit metadata");
assert.deepEqual(normalizePursuit({ stage: "invented", owner: " A\nB ", nextAction: " Decide\tsoon " }), {
  stage: "monitor",
  owner: "A B",
  nextAction: "Decide soon",
}, "Pursuit state should reject unknown stages and strip control characters");
assert.equal(decodePursuitNote("Legacy note").note, "Legacy note", "Legacy notes should remain readable without migration");

console.log("Interaction foundation contracts passed", { stage: decoded.pursuit.stage, legacyCompatible: true });
