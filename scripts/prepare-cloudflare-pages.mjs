import assert from "node:assert/strict";
import { existsSync, rmSync, statSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const fullGraph = resolve(root, "dist/data/intelligence-graph.json");
const compressedGraph = resolve(root, "dist/data/intelligence-graph.json.gz");
const pagesFileLimit = 25 * 1024 * 1024;

assert.ok(existsSync(fullGraph), "Cloudflare preparation requires the complete integrity graph build artifact");
assert.ok(existsSync(compressedGraph), "Cloudflare preparation requires the compressed integrity graph download");
assert.ok(statSync(compressedGraph).size > 0 && statSync(compressedGraph).size < pagesFileLimit, "Compressed integrity graph must fit the Cloudflare Pages per-file limit");

rmSync(fullGraph);
console.log(JSON.stringify({ status: "prepared", removed: "dist/data/intelligence-graph.json", published: "dist/data/intelligence-graph.json.gz", bytes: statSync(compressedGraph).size }));
