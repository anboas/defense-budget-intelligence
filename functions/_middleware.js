import { securityHeadersForPath } from "../src/security-policy.js";

export async function onRequest(context) {
  const response = await context.next();
  const headers = new Headers(response.headers);
  const pathname = new URL(context.request.url).pathname;
  for (const [name, value] of Object.entries(securityHeadersForPath(pathname))) headers.set(name, value);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
