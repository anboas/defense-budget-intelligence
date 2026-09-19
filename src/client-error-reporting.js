const REPORTED_FINGERPRINTS = new Set();
const CLIENT_ERROR_ENDPOINT = "/api/v1/client-errors";

function clean(value, limit = 500) {
  return Array.from(String(value ?? ""), (character) => {
    const code = character.charCodeAt(0);
    return code < 32 || code === 127 ? " " : character;
  }).join("")
    .replace(/sk-[A-Za-z0-9_-]{8,}/g, "[redacted-key]")
    .replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/gi, "Bearer [redacted]")
    .replace(/([?&][^=\s]+)=([^&\s)]+)/g, "$1=[redacted]")
    .trim()
    .slice(0, limit);
}

function routeKey() {
  if (typeof window === "undefined") return "";
  const [hashPath, hashQuery = ""] = String(window.location.hash || "").split("?");
  const queryKeys = [...new URLSearchParams(hashQuery).keys()].sort();
  return clean(`${window.location.pathname}${hashPath}${queryKeys.length ? `?${queryKeys.join("&")}` : ""}`, 300);
}

function assetKey() {
  try { return clean(new URL(import.meta.url).pathname.split("/").pop(), 160); } catch { return "unknown-asset"; }
}

function normalizedError(error) {
  if (error instanceof Error) return error;
  if (typeof error === "string") return new Error(error);
  try { return new Error(JSON.stringify(error)); } catch { return new Error("Unknown client error"); }
}

export function reportClientError(error, context = {}) {
  if (typeof window === "undefined" || typeof fetch !== "function") return;
  const normalized = normalizedError(error);
  const payload = {
    reportId: crypto.randomUUID(),
    kind: clean(context.kind || "render_error", 40),
    message: clean(normalized.message || "Unknown client error", 500),
    name: clean(normalized.name || "Error", 80),
    route: routeKey(),
    asset: assetKey(),
    stack: clean(normalized.stack || "", 2_000),
    componentStack: clean(context.componentStack || "", 2_000),
  };
  const fingerprint = [payload.kind, payload.message, payload.route, payload.componentStack.slice(0, 160)].join("|");
  if (REPORTED_FINGERPRINTS.has(fingerprint)) return;
  REPORTED_FINGERPRINTS.add(fingerprint);
  void fetch(CLIENT_ERROR_ENDPOINT, {
    method: "POST",
    credentials: "same-origin",
    keepalive: true,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  }).catch(() => { /* Reporting must never create a second application failure. */ });
}

export function installClientErrorReporting() {
  if (typeof window === "undefined") return () => {};
  const handleError = (event) => reportClientError(event.error || event.message, { kind: "unhandled_error" });
  const handleRejection = (event) => reportClientError(event.reason, { kind: "unhandled_rejection" });
  window.addEventListener("error", handleError);
  window.addEventListener("unhandledrejection", handleRejection);
  return () => {
    window.removeEventListener("error", handleError);
    window.removeEventListener("unhandledrejection", handleRejection);
  };
}
