import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SOURCE_FILE = resolve(ROOT, "src/data/budget-intelligence.json");
const ACCOUNT_SPINE_FILE = resolve(ROOT, "src/data/account-spine.json");
const OUT_DIR = resolve(ROOT, "public/data");

const source = JSON.parse(readFileSync(SOURCE_FILE, "utf8"));
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

console.log(
  `Built runtime data: core=${Buffer.byteLength(JSON.stringify(core))} bytes strategy=${Buffer.byteLength(JSON.stringify(strategyAnalytics))} bytes`,
);
