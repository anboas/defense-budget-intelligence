import assert from "node:assert/strict";
import {
  effectiveInviteStatus,
  formatInviteCode,
  inviteCodeSuffix,
  normalizeInviteCode,
  normalizeInviteExpiryDays,
  normalizeRegistrationMode,
} from "../src/registration-core.js";

const code = formatInviteCode(Uint8Array.from({ length: 16 }, (_, index) => index));
assert.equal(code, "DBI-0001-0203-0405-0607-0809-0A0B-0C0D-0E0F");
assert.equal(normalizeInviteCode(` ${code.toLowerCase()} `), "DBI000102030405060708090A0B0C0D0E0F");
assert.equal(inviteCodeSuffix(code), "0E0F");
assert.equal(normalizeRegistrationMode("invite_only"), "invite_only");
assert.equal(normalizeRegistrationMode("open"), "closed", "Public-open registration must not be a supported policy");
assert.equal(normalizeInviteExpiryDays(30), 30);
assert.equal(normalizeInviteExpiryDays(365), 7, "Invite expiry must fail to the safe default");
assert.equal(effectiveInviteStatus({ status: "active", expiresAt: "2026-09-20T00:00:00.000Z" }, new Date("2026-09-19T00:00:00.000Z")), "active");
assert.equal(effectiveInviteStatus({ status: "active", expiresAt: "2026-09-18T00:00:00.000Z" }, new Date("2026-09-19T00:00:00.000Z")), "expired");
assert.equal(effectiveInviteStatus({ status: "revoked", expiresAt: "2026-09-20T00:00:00.000Z" }, new Date("2026-09-19T00:00:00.000Z")), "revoked");

console.log("Verified closed-by-default registration modes, one-time invite formatting, expiry, and normalization");
