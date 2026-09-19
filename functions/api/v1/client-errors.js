import { pagesAuthApiResponse } from "../../../src/pages-auth-api.js";

export async function onRequest({ request, env = {} }) {
  if (request.method === "OPTIONS") return new Response(null, { status: 204 });
  return pagesAuthApiResponse(request, env);
}
