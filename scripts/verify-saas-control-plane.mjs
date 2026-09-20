import assert from "node:assert/strict";
import {
  COMMERCIAL_PLAN_CATALOG,
  entitlementDecision,
  entitlementRows,
  normalizeEntitlements,
  normalizeLifecycleState,
  planById,
} from "../src/saas-control-plane-core.js";

assert.deepEqual(COMMERCIAL_PLAN_CATALOG.map((plan) => plan.id), ["internal", "pilot"], "The shadow control plane must ship only the intentional Internal and Pilot plans");
assert.equal(planById("missing").id, "internal", "Unknown plans must preserve grandfathered behavior");
assert.equal(normalizeLifecycleState("active"), "active");
assert.equal(normalizeLifecycleState("invalid"), "internal", "Invalid lifecycle state must fail back to the internal posture");

const pilot = normalizeEntitlements({ seats: 12, auditExport: false, ignored: 99 }, "pilot");
assert.equal(pilot.seats, 12);
assert.equal(pilot.auditExport, false);
assert.equal(pilot.ignored, undefined, "Entitlement overrides must discard unknown keys");

const observed = entitlementDecision({ entitlements: { seats: 2 }, enforcementMode: "observe", key: "seats", usage: 2 });
assert.equal(observed.wouldBlock, true);
assert.equal(observed.allowed, true, "Observe-only entitlements must never disrupt current users");
const enforced = entitlementDecision({ entitlements: { seats: 2 }, enforcementMode: "enforce", key: "seats", usage: 2 });
assert.equal(enforced.allowed, false, "The central entitlement contract must support a later deliberate enforcement cutover");
assert.equal(entitlementRows({ seats: 10 }, { seats: 8 })[0].status, "near");

console.log("SaaS control-plane core contract passed");
