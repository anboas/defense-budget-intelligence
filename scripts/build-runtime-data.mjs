import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SOURCE_FILE = resolve(ROOT, "src/data/budget-intelligence.json");
const ACCOUNT_SPINE_FILE = resolve(ROOT, "src/data/account-spine.json");
const CAPTURE_CALENDAR_FILE = resolve(ROOT, "src/data/capture-calendar.json");
const CAPTURE_TRANSACTIONS_FILE = resolve(ROOT, "src/data/capture-transactions.json");
const OUT_DIR = resolve(ROOT, "public/data");

const source = JSON.parse(readFileSync(SOURCE_FILE, "utf8"));
const captureCalendar = JSON.parse(readFileSync(CAPTURE_CALENDAR_FILE, "utf8"));
const captureTransactions = JSON.parse(readFileSync(CAPTURE_TRANSACTIONS_FILE, "utf8"));
const captureIds = new Set(captureCalendar.records.map((record) => record.opportunityId));
if (captureCalendar.records.length < 190 || captureIds.size !== captureCalendar.records.length) {
  throw new Error("Capture calendar must contain at least 190 unique public records");
}
if (captureCalendar.metadata?.coverage?.publicRows !== captureCalendar.records.length) {
  throw new Error("Capture calendar metadata does not match its published records");
}
if (captureCalendar.metadata?.coverage?.normalizedEvents !== 502 || captureCalendar.metadata?.coverage?.fpdsActions !== 3085) {
  throw new Error("Capture calendar normalized event or FPDS action coverage changed");
}
if (captureTransactions.metadata?.actionCount !== 3085) {
  throw new Error("Capture transaction payload must contain 3,085 exact FPDS actions");
}
if (captureCalendar.records.some((record) => "statusLabel" in record || "note" in record || "visibility" in record || "targetIds" in record || "captureMotion" in record)) {
  throw new Error("Capture calendar contains private parser fields");
}
if (/OUR AWARD \/ DELIVERY-LED EXPANSION|ACTIVE TEAMED BID|Targets A1|campaign qualification/i.test(JSON.stringify(captureCalendar.records))) {
  throw new Error("Capture calendar contains internal campaign language");
}
const { strategyAnalytics = {}, ...coreInventory } =
  source.metadata?.dataInventory || {};
const execution = {
  metadata: {
    generatedAt: source.metadata?.generatedAt,
    methodology: strategyAnalytics.executionAnalytics?.coverage?.methodology
      || "Cached USAspending award records with deterministic deduplication.",
  },
  coverage: strategyAnalytics.executionAnalytics?.coverage || {},
  awardDrilldown: strategyAnalytics.executionAnalytics?.awardDrilldown || {},
};
const core = {
  metadata: {
    ...source.metadata,
    dataInventory: coreInventory,
  },
  signals: source.signals || [],
  records: source.records || [],
};

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(resolve(OUT_DIR, "budget-core.json"), JSON.stringify(core));
rmSync(resolve(OUT_DIR, "budget-strategy.json"), { force: true });
writeFileSync(resolve(OUT_DIR, "budget-execution.json"), JSON.stringify(execution));
writeFileSync(
  resolve(OUT_DIR, "account-spine.json"),
  readFileSync(ACCOUNT_SPINE_FILE, "utf8"),
);
writeFileSync(
  resolve(OUT_DIR, "capture-calendar.json"),
  JSON.stringify(captureCalendar),
);
writeFileSync(
  resolve(OUT_DIR, "capture-transactions.json"),
  JSON.stringify(captureTransactions),
);

console.log(
  `Built runtime data: core=${Buffer.byteLength(JSON.stringify(core))} bytes execution=${Buffer.byteLength(JSON.stringify(execution))} bytes capture=${captureCalendar.records.length} records/${captureTransactions.metadata.actionCount} actions`,
);
