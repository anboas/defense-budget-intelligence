import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SOURCE_FILE = resolve(ROOT, "src/data/budget-intelligence.json");
const ACCOUNT_SPINE_FILE = resolve(ROOT, "src/data/account-spine.json");
const CAPTURE_CALENDAR_FILE = resolve(ROOT, "src/data/capture-calendar.json");
const OUT_DIR = resolve(ROOT, "public/data");

const source = JSON.parse(readFileSync(SOURCE_FILE, "utf8"));
const captureCalendar = JSON.parse(readFileSync(CAPTURE_CALENDAR_FILE, "utf8"));
const captureIds = new Set(captureCalendar.records.map((record) => record.id));
if (captureCalendar.records.length < 190 || captureIds.size !== captureCalendar.records.length) {
  throw new Error("Capture calendar must contain at least 190 unique public records");
}
if (captureCalendar.metadata?.coverage?.publicRows !== captureCalendar.records.length) {
  throw new Error("Capture calendar metadata does not match its published records");
}
if (captureCalendar.records.some((record) => "statusLabel" in record || "note" in record || "visibility" in record)) {
  throw new Error("Capture calendar contains private parser fields");
}
if (/OUR AWARD \/ DELIVERY-LED EXPANSION|ACTIVE TEAMED BID|Targets A1|campaign qualification/i.test(JSON.stringify(captureCalendar.records))) {
  throw new Error("Capture calendar contains internal campaign language");
}
const { strategyAnalytics = {}, ...coreInventory } =
  source.metadata?.dataInventory || {};
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
writeFileSync(
  resolve(OUT_DIR, "budget-strategy.json"),
  JSON.stringify(strategyAnalytics),
);
writeFileSync(
  resolve(OUT_DIR, "account-spine.json"),
  readFileSync(ACCOUNT_SPINE_FILE, "utf8"),
);
writeFileSync(
  resolve(OUT_DIR, "capture-calendar.json"),
  JSON.stringify(captureCalendar),
);

console.log(
  `Built runtime data: core=${Buffer.byteLength(JSON.stringify(core))} bytes strategy=${Buffer.byteLength(JSON.stringify(strategyAnalytics))} bytes capture=${captureCalendar.records.length} records`,
);
