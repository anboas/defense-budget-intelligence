export const REGISTRATION_MODES = Object.freeze(["closed", "invite_only"]);
export const INVITE_EXPIRY_DAYS = Object.freeze([1, 7, 14, 30]);

export function normalizeRegistrationMode(value) {
  return REGISTRATION_MODES.includes(value) ? value : "closed";
}

export function normalizeInviteCode(value) {
  return String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 64);
}

export function formatInviteCode(bytes) {
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("").toUpperCase();
  return `DBI-${hex.match(/.{1,4}/g).join("-")}`;
}

export function inviteCodeSuffix(value) {
  return normalizeInviteCode(value).slice(-4);
}

export function normalizeInviteExpiryDays(value) {
  const days = Math.round(Number(value));
  return INVITE_EXPIRY_DAYS.includes(days) ? days : 7;
}

export function effectiveInviteStatus(invite, now = new Date()) {
  if (!invite) return "unavailable";
  if (invite.status !== "active") return invite.status;
  return new Date(invite.expiresAt || invite.expires_at).getTime() <= now.getTime() ? "expired" : "active";
}
