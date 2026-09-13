import { pagesAuthApiResponse } from "../../../../src/pages-auth-api.js";

export function onRequest({ request, env }) {
  return pagesAuthApiResponse(request, env);
}
