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
assert.match(homeResponse.headers.get("content-security-policy") || "", /frame-ancestors 'none'/, "Production must prevent framing through CSP");
assert.equal(homeResponse.headers.get("x-frame-options"), "DENY", "Production must prevent legacy framing");
assert.match(homeResponse.headers.get("strict-transport-security") || "", /max-age=63072000/, "Production must advertise long-lived HTTPS transport security");
assert.equal(homeResponse.headers.get("x-content-type-options"), "nosniff", "Production must disable MIME sniffing");

const html = await homeResponse.text();
assert.match(html, /Defense Budget & Spend Analytics/, "Homepage should identify the app");

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
let styleBytes = 0;
for (const stylesheetUrl of assets.stylesheets) {
  const styleResponse = await fetchWithCheck(stylesheetUrl);
  assert.equal(styleResponse.status, 200, `Stylesheet should return 200: ${stylesheetUrl}`);
  styleBytes += (await styleResponse.arrayBuffer()).byteLength;
}
assert.ok(styleBytes <= 350000, `Production CSS should stay below 350KB, got ${styleBytes}`);

const manifestResponse = await fetchWithCheck(new URL("data/runtime-manifest.json", baseUrl));
assert.equal(manifestResponse.status, 200, `Runtime manifest should return 200, got ${statusText(manifestResponse)}`);
const manifest = await manifestResponse.json();
assert.ok(manifest.metadata?.recordCount > 3000, "Runtime manifest should expose the request-line count without loading the detailed corpus");

const coreResponse = await fetchWithCheck(new URL("data/budget-core.json", baseUrl));
assert.equal(coreResponse.status, 200, `Core runtime data should return 200, got ${statusText(coreResponse)}`);
const core = await coreResponse.json();
assert.ok(core.records?.length > 3000, "Core runtime data should contain budget records");
assert.equal(core.metadata?.dataInventory?.strategyAnalytics, undefined, "Core runtime data should exclude deferred strategy evidence");

const executionResponse = await fetchWithCheck(new URL("data/budget-execution.json", baseUrl));
assert.equal(executionResponse.status, 200, `Execution runtime data should return 200, got ${statusText(executionResponse)}`);
const execution = await executionResponse.json();
assert.ok(execution.awardDrilldown?.summary?.awards > 600, "Execution runtime data should contain the sampled award inventory");
assert.equal(execution.strategy, undefined, "Execution runtime data should exclude strategy judgments");

const accountSpineResponse = await fetchWithCheck(new URL("data/account-spine.json", baseUrl));
assert.equal(accountSpineResponse.status, 200, `Account-spine runtime data should return 200, got ${statusText(accountSpineResponse)}`);
const accountSpine = await accountSpineResponse.json();
assert.ok(accountSpine.accounts?.length > 100, "Account-spine runtime data should contain federal accounts");
assert.ok(accountSpine.metadata?.coverage?.exactTafsJoins > 300, "Account-spine runtime data should preserve exact TAFS joins");
assert.ok(accountSpine.metadata?.coverage?.exactAwardAccountLinks > 400, "Account-spine runtime data should preserve exact award-account links");
assert.ok(accountSpine.awardFlows?.length >= 200, "Account-spine runtime data should contain the ranked award sample");

console.log(
  [
    `Verified production smoke for ${baseUrl.href}`,
    "homepage=200",
    `js_assets=${assets.scripts.length}`,
    `css_assets=${assets.stylesheets.length}`,
    `js_bytes=${scriptBytes}`,
    `css_bytes=${styleBytes}`,
    `budget_records=${core.records.length}`,
    `awards=${execution.awardDrilldown.summary.awards}`,
    `federal_accounts=${accountSpine.accounts.length}`,
    `exact_tafs=${accountSpine.metadata.coverage.exactTafsJoins}`,
    `exact_award_accounts=${accountSpine.metadata.coverage.exactAwardAccountLinks}`,
  ].join(" "),
);
