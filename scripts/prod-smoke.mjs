import assert from "node:assert/strict";

const DEFAULT_PROD_URL = "https://defense-budget-intelligence.pages.dev/";

function argValue(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? "" : process.argv[index + 1] || "";
}

function normalizeBaseUrl(value) {
  const raw = value || DEFAULT_PROD_URL;
  const url = new URL(raw);
  if (!url.pathname.endsWith("/")) {
    url.pathname = `${url.pathname}/`;
  }
  return url;
}

function statusText(response) {
  return `${response.status} ${response.statusText}`.trim();
}

async function fetchWithCheck(url, options = {}) {
  return fetch(url, {
    redirect: "follow",
    ...options,
    headers: {
      "user-agent": "defense-budget-intelligence-prod-smoke/1.0",
      ...(options.headers || {}),
    },
  });
}

function extractAssets(html, baseUrl) {
  const scripts = new Set();
  const stylesheets = new Set();
  const tagPattern = /<(script|link)\b[^>]*>/gi;
  const attrPattern = /\s([a-zA-Z:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g;

  for (const tagMatch of html.matchAll(tagPattern)) {
    const tagName = tagMatch[1].toLowerCase();
    const attrs = {};
    for (const attrMatch of tagMatch[0].matchAll(attrPattern)) {
      attrs[attrMatch[1].toLowerCase()] = attrMatch[2] || attrMatch[3] || attrMatch[4] || "";
    }
    if (tagName === "script" && attrs.src) {
      scripts.add(new URL(attrs.src, baseUrl).href);
    }
    if (tagName === "link" && attrs.rel?.toLowerCase().split(/\s+/).includes("stylesheet") && attrs.href) {
      stylesheets.add(new URL(attrs.href, baseUrl).href);
    }
  }

  return {
    scripts: [...scripts],
    stylesheets: [...stylesheets],
  };
}

const baseUrl = normalizeBaseUrl(argValue("--url"));
const homeResponse = await fetchWithCheck(baseUrl);
assert.equal(homeResponse.status, 200, `Homepage should return 200, got ${statusText(homeResponse)}`);

const html = await homeResponse.text();
assert.match(html, /Defense Budget & Spend Intelligence/, "Homepage should identify the app");

const assets = extractAssets(html, homeResponse.url || baseUrl);
assert.ok(assets.scripts.length > 0, "Homepage should reference at least one JavaScript asset");

for (const assetUrl of [...assets.scripts, ...assets.stylesheets]) {
  const assetResponse = await fetchWithCheck(assetUrl, { method: "HEAD" });
  assert.equal(assetResponse.status, 200, `Asset should return 200: ${assetUrl} got ${statusText(assetResponse)}`);
}

const scriptResponse = await fetchWithCheck(assets.scripts[0]);
assert.equal(scriptResponse.status, 200, `JavaScript bundle should return 200, got ${statusText(scriptResponse)}`);
const scriptBytes = (await scriptResponse.arrayBuffer()).byteLength;
assert.ok(scriptBytes < 500000, `Initial JavaScript bundle should stay below 500KB, got ${scriptBytes}`);

const coreResponse = await fetchWithCheck(new URL("data/budget-core.json", baseUrl));
assert.equal(coreResponse.status, 200, `Core runtime data should return 200, got ${statusText(coreResponse)}`);
const core = await coreResponse.json();
assert.ok(core.records?.length > 3000, "Core runtime data should contain budget records");
assert.equal(core.metadata?.dataInventory?.strategyAnalytics, undefined, "Core runtime data should exclude deferred strategy evidence");

const strategyResponse = await fetchWithCheck(new URL("data/budget-strategy.json", baseUrl));
assert.equal(strategyResponse.status, 200, `Strategy runtime data should return 200, got ${statusText(strategyResponse)}`);
const strategy = await strategyResponse.json();
assert.ok(strategy.technologyAreas?.length > 0, "Deferred strategy data should contain technology areas");

console.log(
  [
    `Verified production smoke for ${baseUrl.href}`,
    "homepage=200",
    `js_assets=${assets.scripts.length}`,
    `css_assets=${assets.stylesheets.length}`,
    `js_bytes=${scriptBytes}`,
    `budget_records=${core.records.length}`,
  ].join(" "),
);
