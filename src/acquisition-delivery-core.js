const DEFAULT_APP_URL = "https://defense-budget-intelligence.pages.dev";
const MAX_EMAIL_ITEMS = 40;

function text(value, limit = 500) {
  return [...String(value || "")].map((character) => {
    const code = character.charCodeAt(0);
    return code < 32 || code === 127 ? " " : character;
  }).join("").replace(/\s+/g, " ").trim().slice(0, limit);
}

function escapeHtml(value) {
  return text(value, 2_000).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]));
}

export function deliveryProviderConfig(env = {}) {
  const apiKey = String(env.RESEND_API_KEY || "").trim();
  const from = text(env.DBI_ALERT_FROM_EMAIL, 200);
  const replyTo = text(env.DBI_ALERT_REPLY_TO, 200);
  const appUrl = String(env.DBI_PUBLIC_APP_URL || DEFAULT_APP_URL).replace(/\/+$/, "");
  return {
    provider: "resend",
    configured: apiKey.length >= 20 && /^[^\s@]+@[^\s@]+$/.test(from),
    apiKey,
    from,
    replyTo: /^[^\s@]+@[^\s@]+$/.test(replyTo) ? replyTo : "",
    appUrl: /^https:\/\//i.test(appUrl) ? appUrl : DEFAULT_APP_URL,
  };
}

export function nextDailyDeliveryAt(now = new Date(), hourUtc = 13) {
  const hour = Math.max(0, Math.min(23, Number(hourUtc) || 13));
  const next = new Date(now);
  next.setUTCHours(hour, 0, 0, 0);
  if (next.getTime() <= now.getTime()) next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString();
}

export function deliveryBackoffAt(attemptCount, now = new Date()) {
  const minutes = Math.min(24 * 60, 5 * (2 ** Math.max(0, Number(attemptCount || 1) - 1)));
  return new Date(now.getTime() + minutes * 60_000).toISOString();
}

export function deliveryJobSchedule(mode, env = {}, now = new Date()) {
  return mode === "daily" ? nextDailyDeliveryAt(now, env.DBI_ALERT_DIGEST_HOUR_UTC) : now.toISOString();
}

function publicItem(item) {
  const record = item.record || {};
  return {
    title: text(record.title || record.name || item.sourceRecordId || "Acquisition record", 180),
    reference: text(record.solicitationNumber || record.reference || item.sourceRecordId, 120),
    changeType: text(item.changeType || "updated", 40),
    deadline: text(record.responseDeadline || record.deadline || record.archiveDate, 80),
    office: text(record.office || record.buyingOffice || "", 160),
  };
}

export function renderAcquisitionEmail({ displayName, workspaceName, savedViewName, mode, items, appUrl }) {
  const safeItems = (items || []).slice(0, MAX_EMAIL_ITEMS).map(publicItem);
  const viewUrl = `${String(appUrl || DEFAULT_APP_URL).replace(/\/+$/, "")}/#/budget-spend/explorer?spendView=today`;
  const settingsUrl = `${String(appUrl || DEFAULT_APP_URL).replace(/\/+$/, "")}/#/budget-spend/explorer?spendView=today&savedViews=1`;
  const subject = mode === "daily"
    ? `${safeItems.length} acquisition update${safeItems.length === 1 ? "" : "s"} · ${text(savedViewName, 80) || "Saved view"}`
    : `${safeItems[0]?.changeType === "added" ? "New" : "Changed"} acquisition · ${safeItems[0]?.title || "Saved view match"}`;
  const rows = safeItems.map((item) => `<tr><td style="padding:12px 0;border-bottom:1px solid #dbe3ee"><strong>${escapeHtml(item.title)}</strong><br><span style="color:#536273">${escapeHtml(item.changeType)}${item.reference ? ` · ${escapeHtml(item.reference)}` : ""}${item.office ? ` · ${escapeHtml(item.office)}` : ""}${item.deadline ? ` · closes ${escapeHtml(item.deadline)}` : ""}</span></td></tr>`).join("");
  const greeting = displayName ? `Hi ${escapeHtml(displayName)},` : "Hello,";
  const hiddenCount = Math.max(0, (items || []).length - safeItems.length);
  const html = `<!doctype html><html><body style="margin:0;background:#f4f7fb;color:#172235;font-family:Arial,sans-serif"><main style="max-width:680px;margin:0 auto;padding:28px"><section style="background:#fff;border:1px solid #dbe3ee;border-radius:14px;padding:28px"><p>${greeting}</p><h1 style="font-size:22px;margin:8px 0">${escapeHtml(savedViewName || "Acquisition alert")}</h1><p style="color:#536273">${escapeHtml(workspaceName || "Your workspace")} has ${safeItems.length}${hiddenCount ? `+` : ""} retained ${mode === "daily" ? "updates" : "match"}.</p><table role="presentation" style="width:100%;border-collapse:collapse">${rows}</table>${hiddenCount ? `<p style="color:#536273">${hiddenCount} additional updates are available in DBI.</p>` : ""}<p style="margin-top:24px"><a href="${escapeHtml(viewUrl)}" style="display:inline-block;background:#315ee8;color:#fff;text-decoration:none;padding:12px 18px;border-radius:8px">Open acquisition inbox</a></p><p style="font-size:12px;color:#6b7788;margin-top:24px">In-app alerts remain the source of truth. <a href="${escapeHtml(settingsUrl)}">Manage this saved view or turn off email delivery</a>.</p></section></main></body></html>`;
  const plainRows = safeItems.map((item) => `- ${item.title} — ${item.changeType}${item.reference ? ` · ${item.reference}` : ""}${item.deadline ? ` · closes ${item.deadline}` : ""}`).join("\n");
  return { subject: text(subject, 180), html, text: `${displayName ? `Hi ${displayName},\n\n` : ""}${workspaceName || "Your workspace"} has ${safeItems.length}${hiddenCount ? "+" : ""} retained updates for ${savedViewName || "your saved view"}.\n\n${plainRows}\n\nOpen: ${viewUrl}\nManage alerts: ${settingsUrl}` };
}

export async function sendAcquisitionEmail(env, { to, idempotencyKey, message }) {
  const provider = deliveryProviderConfig(env);
  if (!provider.configured) return { ok: false, code: "provider_unavailable", retryable: false };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${provider.apiKey}`, "content-type": "application/json", "idempotency-key": text(idempotencyKey, 180) },
      body: JSON.stringify({ from: provider.from, to: [text(to, 254)], subject: message.subject, html: message.html, text: message.text, ...(provider.replyTo ? { reply_to: provider.replyTo } : {}) }),
      signal: controller.signal,
    });
    const retryAfter = Math.max(0, Number(response.headers.get("retry-after") || 0));
    if (!response.ok) return { ok: false, code: response.status === 429 ? "rate_limited" : response.status >= 500 ? "provider_unavailable" : "provider_rejected", retryable: response.status === 429 || response.status >= 500, retryAfterSeconds: retryAfter };
    const body = await response.json().catch(() => ({}));
    return { ok: true, providerMessageId: text(body?.id, 180) };
  } catch (error) {
    return { ok: false, code: error?.name === "AbortError" ? "provider_timeout" : "provider_unavailable", retryable: true };
  } finally {
    clearTimeout(timeout);
  }
}

export const ACQUISITION_DELIVERY_MAX_ATTEMPTS = 5;
