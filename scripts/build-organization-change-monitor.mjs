import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildOrganizationChangeMonitor } from "./organization-change-monitor-core.mjs";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const read = (path) => JSON.parse(readFileSync(path, "utf8"));
const currentRolesPath = resolve(ROOT, "src/data/official-role-directory-snapshot.json");
const currentOrganizationsPath = resolve(ROOT, "src/data/organization-intelligence.json");
const previousRolesPath = process.env.PREVIOUS_ROLE_DIRECTORY_FILE || currentRolesPath;
const previousOrganizationsPath = process.env.PREVIOUS_ORGANIZATION_INTELLIGENCE_FILE || currentOrganizationsPath;
const output = buildOrganizationChangeMonitor({
  currentRoles: read(currentRolesPath),
  previousRoles: read(previousRolesPath),
  currentOrganizations: read(currentOrganizationsPath),
  previousOrganizations: read(previousOrganizationsPath),
});
const serialized = `${JSON.stringify(output, null, 2)}\n`;
for (const path of [resolve(ROOT, "src/data/organization-change-monitor.json"), resolve(ROOT, "public/data/organization-change-monitor.json")]) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, serialized);
}
console.log(JSON.stringify({ ...output.metadata.coverage, contentHash: output.metadata.contentHash, bytes: Buffer.byteLength(serialized) }, null, 2));
