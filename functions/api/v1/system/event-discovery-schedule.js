import { pagesAuthApiResponse } from "../../../../src/pages-auth-api.js";

export async function onRequest({ request, env }) {
  return pagesAuthApiResponse(request, env);
}
