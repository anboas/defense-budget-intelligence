import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const baseline = JSON.parse(fs.readFileSync(path.join(root, "scripts/ui-conformance-baseline.json"), "utf8"));
const styles = fs.readFileSync(path.join(root, "src/styles.css"), "utf8");
const sourceFiles = fs.readdirSync(path.join(root, "src"))
  .filter((name) => /\.(?:js|jsx)$/.test(name))
  .map((name) => fs.readFileSync(path.join(root, "src", name), "utf8"));
const source = sourceFiles.join("\n");

const zIndexes = [...styles.matchAll(/z-index\s*:\s*(-?\d+)/g)].map((match) => Number(match[1]));
const metrics = {
  stylesLines: styles.split(/\r?\n/).length,
  rawColors: (styles.match(/#[0-9a-fA-F]{3,8}\b/g) || []).length,
  numericZIndexes: zIndexes.length,
  highZIndexes: zIndexes.filter((value) => value >= 100).length,
  nativeDialogs: (source.match(/<dialog\b/g) || []).length,
  nativeSelects: (source.match(/<select\b/g) || []).length,
};

const violations = [];
for (const [metric, ceiling] of Object.entries(baseline)) {
  if (metrics[metric] > ceiling) violations.push(`${metric} increased from the ${ceiling} baseline to ${metrics[metric]}`);
}

const retiredFamilies = [
  "control-select",
  "capture-multiselect",
  "workspace-toast",
  "profile-workspace-menu",
  "ops-dialog",
];
for (const family of retiredFamilies) {
  const cssPattern = new RegExp(`\\.${family}(?:__|--|\\b)`);
  const sourcePattern = new RegExp(`(?:className|data-[\\w-]+)=?[\\s\\S]{0,80}${family}`);
  if (cssPattern.test(styles)) violations.push(`retired local CSS family remains: ${family}`);
  if (sourcePattern.test(source)) violations.push(`retired local component family remains: ${family}`);
}

const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const frameworkPin = packageJson.dependencies?.["control-surface-ui"] || "";
if (!/control-surface-ui\/archive\/[0-9a-f]{40}\.tar\.gz$/.test(frameworkPin)) {
  violations.push("control-surface-ui must be pinned to an exact 40-character upstream commit archive");
}

if (violations.length) {
  console.error("UI conformance failed:\n- " + violations.join("\n- "));
  process.exit(1);
}

console.log("UI conformance passed", metrics);
