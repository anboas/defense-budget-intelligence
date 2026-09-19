import assert from "node:assert/strict";
import {
  deliveryBackoffAt,
  deliveryJobSchedule,
  deliveryProviderConfig,
  nextDailyDeliveryAt,
  renderAcquisitionEmail,
  sendAcquisitionEmail,
} from "../src/acquisition-delivery-core.js";

assert.equal(deliveryProviderConfig({}).configured, false, "Email delivery must fail closed without protected provider configuration");
assert.equal(deliveryProviderConfig({ RESEND_API_KEY: "x".repeat(24), DBI_ALERT_FROM_EMAIL: "alerts@example.com" }).configured, true, "Provider readiness should require a key and valid sender");
assert.equal(nextDailyDeliveryAt(new Date("2026-09-19T12:00:00Z"), 13), "2026-09-19T13:00:00.000Z");
assert.equal(nextDailyDeliveryAt(new Date("2026-09-19T14:00:00Z"), 13), "2026-09-20T13:00:00.000Z");
assert.equal(deliveryJobSchedule("immediate", {}, new Date("2026-09-19T12:00:00Z")), "2026-09-19T12:00:00.000Z");
assert.equal(deliveryBackoffAt(1, new Date("2026-09-19T12:00:00Z")), "2026-09-19T12:05:00.000Z");
assert.equal(deliveryBackoffAt(5, new Date("2026-09-19T12:00:00Z")), "2026-09-19T13:20:00.000Z");

const message = renderAcquisitionEmail({
  displayName: "Analyst <script>", workspaceName: "Defense & Space", savedViewName: "AI / autonomy",
  mode: "daily", appUrl: "https://example.com", items: [{ sourceRecordId: "notice-1", changeType: "added", record: { title: "Official <Notice>", solicitationNumber: "N0001", office: "NAVSEA" } }],
});
assert.match(message.subject, /1 acquisition update/);
assert.match(message.html, /Official &lt;Notice&gt;/, "Email HTML must escape source-controlled content");
assert.doesNotMatch(message.html, /<script>/, "Email HTML must not render injected markup");
assert.match(message.text, /Manage alerts:/, "Every email must expose authenticated preference management");

const originalFetch = globalThis.fetch;
let captured;
globalThis.fetch = async (url, options) => {
  captured = { url, options };
  return new Response(JSON.stringify({ id: "email_123" }), { status: 200, headers: { "content-type": "application/json" } });
};
try {
  const result = await sendAcquisitionEmail({ RESEND_API_KEY: "x".repeat(24), DBI_ALERT_FROM_EMAIL: "alerts@example.com" }, { to: "analyst@example.com", idempotencyKey: "job-1", message });
  assert.deepEqual(result, { ok: true, providerMessageId: "email_123" });
  assert.equal(captured.url, "https://api.resend.com/emails");
  assert.equal(captured.options.headers["idempotency-key"], "job-1");
  assert.ok(!captured.options.body.includes("x".repeat(24)), "Protected provider keys must never enter message bodies");
} finally { globalThis.fetch = originalFetch; }

console.log("Verified provider readiness, digest scheduling, retry backoff, safe templates, and idempotent outbound delivery.");
