import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const DATA_FILE = resolve(ROOT, "src/data/budget-intelligence.json");
const OUT_FILE = resolve(ROOT, "src/data/source-health.json");
const TIMEOUT_MS = Number(process.env.SOURCE_HEALTH_TIMEOUT_MS || 12000);

const data = JSON.parse(readFileSync(DATA_FILE, "utf8"));
const workbookTargets = (data.metadata.sources || []).map((source) => ({
  id: source.id,
  name: `${source.id} · ${source.short}`,
  group: "Current workbook",
  layer: source.color,
  publisher: source.sourceOffice,
  url: source.sourceUrl,
  priority: 0,
}));

const pipelineTargets = (data.metadata.dataInventory?.pipelineSources || []).map((source) => ({
  id: source.id,
  name: source.name,
  group: "Pipeline source",
  layer: source.layer,
  publisher: source.publisher,
  url: source.url,
  priority: source.priority,
}));

const targets = [...workbookTargets, ...pipelineTargets];

async function requestWithTimeout(url, method) {
  const startedAt = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method,
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "user-agent": "defense-budget-intelligence-source-health/1.0",
        ...(method === "GET" ? { range: "bytes=0-0" } : {}),
      },
    });
    await response.body?.cancel();
    return {
      method,
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
      finalUrl: response.url,
      responseMs: Date.now() - startedAt,
    };
  } finally {
    clearTimeout(timer);
  }
}

async function probe(target) {
  const attempts = [];
  for (const method of ["HEAD", "GET"]) {
    try {
      const result = await requestWithTimeout(target.url, method);
      attempts.push(result);
      if (result.ok || ![403, 405, 501].includes(result.status)) break;
    } catch (error) {
      attempts.push({
        method,
        ok: false,
        status: 0,
        statusText: error.name === "AbortError" ? "Timeout" : error.message,
        finalUrl: target.url,
        responseMs: TIMEOUT_MS,
      });
      if (method === "HEAD") continue;
    }
  }

  const best = attempts.find((attempt) => attempt.ok) || attempts.at(-1);
  const redirected = best.ok && best.finalUrl && new URL(best.finalUrl).href !== new URL(target.url).href;
  const health = best.ok ? (redirected ? "Redirected" : "Online") : "Unavailable";
  return {
    ...target,
    health,
    ok: best.ok,
    status: best.status,
    statusText: best.statusText,
    method: best.method,
    finalUrl: best.finalUrl,
    responseMs: best.responseMs,
    checkedAt: new Date().toISOString(),
    attempts,
  };
}

const checkedAt = new Date().toISOString();
const sources = await Promise.all(targets.map(probe));
const totals = {
  targets: sources.length,
  online: sources.filter((source) => source.health === "Online").length,
  redirected: sources.filter((source) => source.health === "Redirected").length,
  unavailable: sources.filter((source) => source.health === "Unavailable").length,
};

const out = {
  metadata: {
    title: "Defense Budget Source Health",
    checkedAt,
    timeoutMs: TIMEOUT_MS,
    methodology: "HEAD probe with GET fallback and byte-range request when needed. Results are a point-in-time availability check, not a data quality guarantee.",
  },
  totals,
  sources,
};

mkdirSync(dirname(OUT_FILE), { recursive: true });
writeFileSync(OUT_FILE, `${JSON.stringify(out, null, 2)}\n`);
console.log(`Checked ${sources.length} source URLs: ${totals.online} online, ${totals.redirected} redirected, ${totals.unavailable} unavailable.`);
