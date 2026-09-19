const encoder = new TextEncoder();

export const MAX_JSON_BODY_BYTES = 131_072;

export const SECURITY_HEADERS = Object.freeze({
  "Content-Security-Policy": "default-src 'self'; base-uri 'self'; child-src 'none'; connect-src 'self'; font-src 'self' data:; form-action 'self'; frame-ancestors 'none'; frame-src 'none'; img-src 'self' data: https:; manifest-src 'self'; media-src 'self'; object-src 'none'; script-src 'self'; script-src-attr 'none'; style-src-elem 'self'; style-src-attr 'unsafe-inline'; upgrade-insecure-requests; worker-src 'self'",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Origin-Agent-Cluster": "?1",
  "Permissions-Policy": "accelerometer=(), browsing-topics=(), camera=(), display-capture=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), publickey-credentials-create=(), publickey-credentials-get=(), usb=()",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Strict-Transport-Security": "max-age=63072000; includeSubDomains; preload",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "X-XSS-Protection": "0",
});

export function cacheControlForPath(pathname = "") {
  if (pathname.startsWith("/api/")) return "no-store";
  if (pathname.startsWith("/assets/")) return "public, max-age=31536000, immutable";
  if (pathname.startsWith("/data/")) return "public, max-age=300, stale-while-revalidate=3600";
  if (pathname === "/" || pathname.endsWith(".html")) return "no-cache";
  return "";
}

export function securityHeadersForPath(pathname = "") {
  const cacheControl = cacheControlForPath(pathname);
  return cacheControl ? { ...SECURITY_HEADERS, "Cache-Control": cacheControl } : SECURITY_HEADERS;
}

export function cleanText(value, maxLength = 500) {
  return Array.from(String(value ?? ""), (character) => {
    const code = character.charCodeAt(0);
    return code < 32 || code === 127 ? " " : character;
  }).join("").trim().slice(0, maxLength);
}

export function normalizeEmail(value) {
  const email = cleanText(value, 254).toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : "";
}

export function validEmail(value) {
  return Boolean(normalizeEmail(value));
}

export function validPasswordProof(value) {
  return /^[a-f0-9]{64}$/i.test(String(value || ""));
}

export function validSalt(value) {
  return /^[a-f0-9]{32,128}$/i.test(String(value || ""));
}

export function validAvatarDataUrl(value) {
  const avatar = cleanText(value, 14_000);
  return !avatar || /^data:image\/(?:png|jpeg|webp);base64,[a-z0-9+/]+=*$/i.test(avatar) ? avatar : null;
}

export function validOpenAiKey(value) {
  const key = String(value || "").trim();
  return /^sk-[A-Za-z0-9_-]{20,240}$/.test(key) ? key : "";
}

export function cleanHttpUrl(value) {
  const text = cleanText(value, 2_000);
  if (!text) return "";
  try {
    const url = new URL(text);
    return ["http:", "https:"].includes(url.protocol) ? url.toString() : "";
  } catch {
    return "";
  }
}

export function sameOriginValues(url, origin = "", fetchSite = "") {
  if (fetchSite && !["same-origin", "none"].includes(fetchSite)) return false;
  return !origin || origin === new URL(url).origin;
}

export function sameOriginRequest(request) {
  return sameOriginValues(request.url, request.headers.get("origin") || "", request.headers.get("sec-fetch-site") || "");
}

export async function readBoundedJson(request, maxBytes = MAX_JSON_BODY_BYTES) {
  const length = Number(request.headers.get("content-length") || 0);
  if (!Number.isFinite(length) || length < 0 || length > maxBytes) return null;
  try {
    const text = await request.text();
    if (encoder.encode(text).byteLength > maxBytes) return null;
    return JSON.parse(text);
  } catch {
    return null;
  }
}

const SENSITIVE_LOG_FIELD = /(authorization|cookie|secret|password|api.?key|token|prompt|request.?body|response.?body|raw.?request|raw.?response)/i;

export function safeLogText(value, limit = 500) {
  return cleanText(value, limit)
    .replace(/sk-[A-Za-z0-9_-]{8,}/g, "[redacted-key]")
    .replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/gi, "Bearer [redacted]");
}

export function safeLogMetadata(value, depth = 0) {
  if (depth > 3 || value === null || value === undefined) return null;
  if (["string", "number", "boolean"].includes(typeof value)) return typeof value === "string" ? safeLogText(value, 500) : value;
  if (Array.isArray(value)) return value.slice(0, 25).map((item) => safeLogMetadata(item, depth + 1));
  if (typeof value !== "object") return null;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !SENSITIVE_LOG_FIELD.test(key))
    .slice(0, 50)
    .map(([key, item]) => [safeLogText(key, 80), safeLogMetadata(item, depth + 1)]));
}
