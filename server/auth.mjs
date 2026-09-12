import { createHash, timingSafeEqual } from "node:crypto";

function digest(value) {
  return createHash("sha256").update(value).digest();
}

export function requireWriteAccess(request, reply) {
  if (process.env.ENABLE_WRITES !== "true") {
    return reply.code(503).send({ error: "persistent writes are not enabled" });
  }

  const configured = process.env.APP_WRITE_TOKEN;
  const supplied = request.headers.authorization?.replace(/^Bearer\s+/i, "");
  if (!configured || !supplied) {
    return reply.code(401).send({ error: "write authorization required" });
  }

  const expected = digest(configured);
  const actual = digest(supplied);
  if (!timingSafeEqual(expected, actual)) {
    return reply.code(403).send({ error: "write authorization rejected" });
  }
}
