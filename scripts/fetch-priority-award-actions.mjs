import { createHash } from "node:crypto";
import { readFileSync, renameSync, writeFileSync } from "node:fs";

const OUT = "src/data/priority-award-actions.json";
const COVERAGE = JSON.parse(readFileSync("src/data/usaspending-coverage.json", "utf8"));
const ACCOUNT = JSON.parse(readFileSync("src/data/account-spine.json", "utf8"));
const LIMIT = Math.max(25, Math.min(500, Number(process.env.PRIORITY_AWARD_LIMIT || 100)));
const PAGE_LIMIT = 100;
const MAX_PAGES = 12;
const CONCURRENCY = 4;
const API = "https://api.usaspending.gov/api/v2/transactions/";
const hash = (value) => createHash("sha256").update(String(value)).digest("hex").slice(0, 20);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function selectAwards() {
  const accountIds = new Set((ACCOUNT.awardFlows || []).map((row) => row.awardId));
  const ranked = [...(COVERAGE.awards || [])].sort((a, b) => {
    const accountDelta = Number(accountIds.has(b.generatedAwardId)) - Number(accountIds.has(a.generatedAwardId));
    if (accountDelta) return accountDelta;
    return Number(b.awardAmount || 0) - Number(a.awardAmount || 0);
  });
  return ranked.slice(0, LIMIT);
}

async function postJson(body, attempt = 0) {
  const response = await fetch(API, {
    method: "POST",
    headers: { "content-type": "application/json", "user-agent": "DefenseBudgetIntelligence/1.0 public-data-research" },
    body: JSON.stringify(body),
  });
  if ([429, 500, 502, 503, 504].includes(response.status) && attempt < 5) {
    await sleep(Math.min(20_000, 750 * (2 ** attempt)));
    return postJson(body, attempt + 1);
  }
  if (!response.ok) throw new Error(`${response.status} ${await response.text()}`.slice(0, 400));
  return response.json();
}

async function collectAward(award) {
  const rows = [];
  let page = 1;
  while (page <= MAX_PAGES) {
    const payload = await postJson({ award_id: award.generatedAwardId, page, limit: PAGE_LIMIT });
    for (const item of payload.results || []) {
      const transactionId = String(item.id || item.transaction_id || "").trim();
      if (!transactionId) continue;
      rows.push({
        id: `award-action:usaspending:${transactionId}`,
        transactionId,
        awardId: award.generatedAwardId,
        piid: award.piid || null,
        modificationNumber: item.modification_number || null,
        actionDate: item.action_date || null,
        actionType: item.action_type || null,
        actionTypeDescription: item.action_type_description || null,
        description: String(item.description || "").slice(0, 500) || null,
        obligatedAmount: Number(item.federal_action_obligation || 0),
        sourceUrl: award.sourceUrl,
      });
    }
    if (!payload.page_metadata?.hasNext) break;
    page = Number(payload.page_metadata?.next || page + 1);
  }
  const unique = [...new Map(rows.map((row) => [row.id, row])).values()];
  const chronological = [...unique].sort((a, b) => String(a.actionDate || "").localeCompare(String(b.actionDate || "")) || a.id.localeCompare(b.id));
  const material = [...unique].sort((a, b) => Math.abs(Number(b.obligatedAmount || 0)) - Math.abs(Number(a.obligatedAmount || 0)) || a.id.localeCompare(b.id));
  const retained = [...new Map([...chronological.slice(0, 5), ...chronological.slice(-15), ...material.slice(0, 10)].map((row) => [row.id, row])).values()];
  return { rows: retained, observedCount: unique.length };
}

async function main() {
  const selected = selectAwards();
  const actions = [];
  const awardSummaries = [];
  const failures = [];
  let cursor = 0;
  async function worker() {
    while (cursor < selected.length) {
      const award = selected[cursor++];
      try {
        const result = await collectAward(award);
        actions.push(...result.rows);
        awardSummaries.push({ awardId: award.generatedAwardId, observedActionCount: result.observedCount, retainedActionCount: result.rows.length, status: "current" });
      }
      catch (error) { failures.push({ awardId: award.generatedAwardId, error: String(error.message || error).slice(0, 400) }); }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
  const previous = (() => { try { return JSON.parse(readFileSync(OUT, "utf8")); } catch { return null; } })();
  const previousByAward = new Map((previous?.actions || []).map((row) => [row.awardId, []]));
  for (const row of previous?.actions || []) previousByAward.get(row.awardId).push(row);
  const failed = new Set(failures.map((row) => row.awardId));
  for (const awardId of failed) actions.push(...(previousByAward.get(awardId) || []));
  const unique = [...new Map(actions.map((row) => [row.id, row])).values()].sort((a, b) => String(a.actionDate || "").localeCompare(String(b.actionDate || "")) || a.id.localeCompare(b.id));
  const coveredAwards = new Set(unique.map((row) => row.awardId));
  const payload = {
    metadata: {
      schemaVersion: "1.0.0",
      generatedAt: new Date().toISOString(),
      source: API,
      sourceAuthority: "official_primary",
      selectionPolicy: "Priority DoD awards are stratified toward exact account-linked awards, then ranked by published award amount. Collection is bounded to 12 pages per award; the artifact retains the first 5, latest 15, and 10 largest absolute obligation actions per award with exact observed totals.",
      coverage: { selectedAwards: selected.length, resolvedAwards: selected.length - failures.length, awardsWithActions: coveredAwards.size, actions: unique.length, failures: failures.length },
      caveat: "This is a bounded priority-award action history, not the complete FPDS/USAspending transaction universe.",
      contentHash: hash(JSON.stringify(unique)),
    },
    awards: selected.map(({ generatedAwardId, piid, recipient, awardAmount, sourceUrl }) => ({ generatedAwardId, piid, recipient, awardAmount, sourceUrl })),
    actions: unique,
    awardSummaries,
    failures,
  };
  const tmp = `${OUT}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(payload, null, 2)}\n`);
  renameSync(tmp, OUT);
  console.log(`Priority award actions: ${unique.length} actions across ${coveredAwards.size}/${selected.length} awards; ${failures.length} failures`);
}

await main();
