import { pagesAuthApiResponse } from "../../../../src/pages-auth-api.js";

export async function onRequest(context) {
  const { request, env = {} } = context;
  return pagesAuthApiResponse(request, env, context);
}
