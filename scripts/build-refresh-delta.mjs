import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const CURRENT_BUDGET = resolve(ROOT, "src/data/budget-intelligence.json");
const CURRENT_HEALTH = resolve(ROOT, "src/data/source-health.json");
const OUTPUT = resolve(ROOT, "src/data/refresh-delta.json");

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function readPrevious(pathEnv, gitPath) {
  if (process.env[pathEnv]) return readJson(resolve(process.env[pathEnv]));
  if (process.env.PREVIOUS_GIT_REF) {
    return JSON.parse(
      execFileSync("git", ["show", `${process.env.PREVIOUS_GIT_REF}:${gitPath}`], {
        cwd: ROOT,
        encoding: "utf8",
        maxBuffer: 20 * 1024 * 1024,
      }),
    );
  }
  return null;
}

function changedNumber(before, after) {
  return Math.abs(Number(after || 0) - Number(before || 0)) > 0.000001;
}

function compareBudget(previousRows = [], currentRows = []) {
  const previous = new Map(previousRows.map((row) => [row.id, row]));
  const current = new Map(currentRows.map((row) => [row.id, row]));
  const changes = [];
  for (const row of currentRows) {
    const before = previous.get(row.id);
    if (!before) {
      changes.push({ kind: "Added", id: row.id, label: row.lineTitle || row.accountTitle, organization: row.orgName, bookId: row.bookId, before: 0, after: row.fy2027, delta: row.fy2027 });
    } else if (changedNumber(before.fy2027, row.fy2027) || changedNumber(before.fy2026, row.fy2026) || before.lineTitle !== row.lineTitle) {
      changes.push({ kind: "Changed", id: row.id, label: row.lineTitle || row.accountTitle, organization: row.orgName, bookId: row.bookId, before: before.fy2027, after: row.fy2027, delta: Number((row.fy2027 - before.fy2027).toFixed(6)) });
    }
  }
  for (const row of previousRows) {
    if (!current.has(row.id)) changes.push({ kind: "Removed", id: row.id, label: row.lineTitle || row.accountTitle, organization: row.orgName, bookId: row.bookId, before: row.fy2027, after: 0, delta: -row.fy2027 });
  }
  return changes.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
}

function awardRows(source) {
  return source?.metadata?.dataInventory?.strategyAnalytics?.executionAnalytics?.awardDrilldown?.awards || [];
}

function queueRows(source) {
  return source?.metadata?.dataInventory?.strategyAnalytics?.executionAnalytics?.captureQueue?.items || [];
}

function compareAwards(previousRows = [], currentRows = []) {
  const previous = new Map(previousRows.map((row) => [row.id, row]));
  const current = new Map(currentRows.map((row) => [row.id, row]));
  const changes = [];
  for (const row of currentRows) {
    const before = previous.get(row.id);
    if (!before) changes.push({ kind: "Added", id: row.id, awardId: row.awardId, label: row.recipient, buyer: row.buyerSubAgency, before: 0, after: row.awardAmount, delta: row.awardAmount, endDate: row.endDate });
    else if (changedNumber(before.awardAmount, row.awardAmount) || before.endDate !== row.endDate) changes.push({ kind: "Changed", id: row.id, awardId: row.awardId, label: row.recipient, buyer: row.buyerSubAgency, before: before.awardAmount, after: row.awardAmount, delta: Number((row.awardAmount - before.awardAmount).toFixed(6)), previousEndDate: before.endDate, endDate: row.endDate });
  }
  for (const row of previousRows) {
    if (!current.has(row.id)) changes.push({ kind: "Removed", id: row.id, awardId: row.awardId, label: row.recipient, buyer: row.buyerSubAgency, before: row.awardAmount, after: 0, delta: -row.awardAmount, previousEndDate: row.endDate });
  }
  return changes.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
}

function compareQueue(previousRows = [], currentRows = []) {
  const previous = new Map(previousRows.map((row) => [row.id, row]));
  return currentRows
    .map((row) => {
      const before = previous.get(row.id);
      if (!before || before.score === row.score) return null;
      return { id: row.id, label: `${row.buyer} / ${row.area}`, before: before.score, after: row.score, delta: row.score - before.score, action: row.recommendedAction };
    })
    .filter(Boolean)
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
}

function compareHealth(previousSource, currentSource) {
  const previous = new Map((previousSource?.sources || []).map((row) => [row.id, row]));
  return (currentSource?.sources || []).flatMap((row) => {
    const before = previous.get(row.id);
    return before && before.health !== row.health
      ? [{ id: row.id, label: row.name, before: before.health, after: row.health, status: row.status }]
      : [];
  });
}

const currentBudget = readJson(CURRENT_BUDGET);
const currentHealth = readJson(CURRENT_HEALTH);
const previousBudget = readPrevious("PREVIOUS_BUDGET_FILE", "src/data/budget-intelligence.json");
const previousHealth = readPrevious("PREVIOUS_HEALTH_FILE", "src/data/source-health.json");
const budgetChanges = compareBudget(previousBudget?.records, currentBudget.records);
const awardChanges = compareAwards(awardRows(previousBudget), awardRows(currentBudget));
const queueChanges = compareQueue(queueRows(previousBudget), queueRows(currentBudget));
const sourceChanges = compareHealth(previousHealth, currentHealth);

const output = {
  metadata: {
    generatedAt: new Date().toISOString(),
    previousSnapshotAt: previousBudget?.metadata?.generatedAt || null,
    currentSnapshotAt: currentBudget.metadata.generatedAt,
    methodology: "Deterministic comparison of consecutive committed budget, award, queue, and source-health snapshots. Missing prior snapshots produce an explicit baseline rather than inferred changes.",
    displayLimits: { budgetChanges: 100, awardChanges: 100 },
  },
  summary: {
    budgetChanges: budgetChanges.length,
    awardChanges: awardChanges.length,
    queueChanges: queueChanges.length,
    sourceChanges: sourceChanges.length,
  },
  budgetChanges: budgetChanges.slice(0, 100),
  awardChanges: awardChanges.slice(0, 100),
  queueChanges,
  sourceChanges,
};

writeFileSync(OUTPUT, `${JSON.stringify(output, null, 2)}\n`);
console.log(`Built refresh delta: ${budgetChanges.length} budget, ${awardChanges.length} award, ${queueChanges.length} queue, ${sourceChanges.length} source changes.`);
