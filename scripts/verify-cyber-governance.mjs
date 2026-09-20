import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const read = (path) => readFile(resolve(root, path), "utf8");

const [securityPolicy, headers, wrangler, dockerfile, postgresDockerfile, compose, securityWorkflow, releaseWorkflow, recoveryWorkflow, refreshWorkflow, governance, threatModel, releaseGovernance, recoveryRunbook, securityPolicyDocument, codeowners, pagesAuth, postgresAuth, registrationCore, d1Registration, postgresRegistration] = await Promise.all([
  read("src/security-policy.js"),
  read("public/_headers"),
  read("wrangler.toml"),
  read("Dockerfile"),
  read("Dockerfile.postgres"),
  read("compose.yaml"),
  read(".github/workflows/security.yml"),
  read(".github/workflows/deploy-pages.yml"),
  read(".github/workflows/recovery.yml"),
  read(".github/workflows/refresh-intelligence.yml"),
  read("docs/cybersecurity-governance.md"),
  read("docs/threat-model.md"),
  read("docs/release-governance.md"),
  read("docs/recovery-runbook.md"),
  read("SECURITY.md"),
  read(".github/CODEOWNERS"),
  read("src/pages-auth-api.js"),
  read("server/auth-routes.mjs"),
  read("src/registration-core.js"),
  read("src/d1-registration.js"),
  read("server/account-registration-routes.mjs"),
]);

for (const source of [securityPolicy, headers]) {
  assert.match(source, /script-src 'self'/, "Executable scripts must remain same-origin");
  assert.match(source, /script-src-attr 'none'/, "Inline script attributes must be blocked");
  assert.match(source, /style-src-elem 'self'/, "Stylesheets must remain same-origin");
  assert.match(source, /style-src-attr 'unsafe-inline'/, "The explicit React style-attribute exception must remain isolated");
  assert.match(source, /frame-(?:ancestors|src) 'none'/, "Framing and frame loading must be blocked");
  assert.match(source, /object-src 'none'/, "Plugin content must be blocked");
  assert.match(source, /upgrade-insecure-requests/, "Mixed-content requests must be upgraded");
}

assert.match(wrangler, /DBI_AUTH_REQUIRED\s*=\s*"1"/, "Production must require authentication");
assert.match(wrangler, /DBI_ALLOW_FIRST_CLAIM\s*=\s*"0"/, "Production bootstrap claiming must remain disabled after ownership is established");
assert.match(registrationCore, /REGISTRATION_MODES\s*=\s*Object\.freeze\(\["closed", "invite_only"\]\)/, "Registration policy must expose only closed and invite-only modes");
assert.doesNotMatch(registrationCore, /["']open["']|public_open/, "Registration policy must not expose a public-open mode");
assert.match(d1Registration, /code_hash[\s\S]+hashValue\(inviteCode\)[\s\S]+hashValue\(normalizeInviteCode\(code\)\)/, "D1 registration invites must be stored and compared through the shared SHA-256 hash boundary");
assert.match(postgresRegistration, /code_hash[\s\S]+sha256\(inviteCode\)[\s\S]+sha256\(normalizeInviteCode\(code\)\)/, "PostgreSQL registration invites must be stored and compared as SHA-256 hashes");
for (const source of [d1Registration, postgresRegistration]) assert.match(source, /['"]viewer['"]/, "Invited accounts must receive only the Viewer global role");
assert.match(wrangler, /DBI_FORCE_SECURE_COOKIES\s*=\s*"1"/, "Production cookies must remain Secure");
assert.match(pagesAuth, /SESSION_MAX_AGE_SECONDS\s*=\s*14 \* 24 \* 60 \* 60/, "Pages sessions must expire within fourteen days");
assert.match(postgresAuth, /SESSION_DAYS \|\| 14/, "PostgreSQL sessions must default to fourteen days");
for (const source of [pagesAuth, postgresAuth]) {
  assert.match(source, /HttpOnly/, "Session cookies must remain HttpOnly");
  assert.match(source, /SameSite=Strict/, "Session cookies must remain SameSite Strict");
  assert.match(source, /Priority=High/, "Session cookies must retain high eviction priority");
}

assert.match(dockerfile, /^FROM node:22-bookworm-slim@sha256:[0-9a-f]{64} AS build$/m, "Build image must be digest pinned");
assert.match(dockerfile, /^FROM node:22-bookworm-slim@sha256:[0-9a-f]{64} AS runtime$/m, "Runtime image must be digest pinned");
assert.match(dockerfile, /^USER node$/m, "Runtime must remain non-root");
assert.match(dockerfile, /rm -rf[^\n]+\/usr\/local\/lib\/node_modules\/npm/, "Runtime image must remove the unused global npm toolchain after installing production dependencies");
assert.match(postgresDockerfile, /^FROM postgres:17-alpine@sha256:[0-9a-f]{64}$/m, "PostgreSQL image must be digest pinned");
assert.match(postgresDockerfile, /rm -f \/usr\/local\/bin\/gosu/, "The non-root PostgreSQL image must remove the unused privilege-drop helper");
assert.match(postgresDockerfile, /^USER postgres$/m, "PostgreSQL must run directly as its unprivileged user");
assert.ok((compose.match(/cap_drop:\s*\n\s*- ALL/g) || []).length >= 2, "Every stateful container must drop Linux capabilities");
assert.doesNotMatch(compose, /cap_add:/, "No stateful container may add Linux capabilities");
assert.ok((compose.match(/no-new-privileges:true/g) || []).length >= 2, "Every stateful container must deny privilege escalation");
assert.match(compose, /read_only:\s*true/, "The application filesystem must remain read-only");

assert.match(securityWorkflow, /npm audit --audit-level=high/, "Security CI must block high dependency vulnerabilities");
assert.match(securityWorkflow, /npm audit signatures/, "Security CI must verify registry signatures");
assert.match(securityWorkflow, /verify:cyber/, "Security CI must enforce the cyber governance contract");
assert.match(securityWorkflow, /aquasecurity\/trivy-action@[0-9a-f]{40}/, "Container scanning action must be immutable");
assert.match(securityWorkflow, /severity:\s*'HIGH,CRITICAL'/, "Container scanning must block high and critical findings");
assert.match(releaseWorkflow, /pull_request:/, "Release contracts must run before merge");
assert.match(releaseWorkflow, /github\.event_name != 'pull_request'/, "Pull-request verification must not publish a release");
assert.match(recoveryWorkflow, /verify:recovery:d1/, "Recovery CI must restore a D1 export contract");
assert.match(recoveryWorkflow, /verify:recovery:postgres/, "Recovery CI must restore a PostgreSQL dump into an isolated database");
assert.doesNotMatch(refreshWorkflow, /git push origin HEAD:main/, "Automated data refreshes must not bypass protected pull requests");
assert.match(refreshWorkflow, /gh pr create/, "Automated data refreshes must open a pull request");

for (const phrase of ["Data classification", "Access review", "Vulnerability remediation", "Incident response", "Business continuity", "Control evidence"]) {
  assert.match(governance, new RegExp(phrase, "i"), `Governance baseline must define ${phrase}`);
}
for (const phrase of ["Trust boundaries", "Threat actors", "Abuse cases", "Residual risks"]) {
  assert.match(threatModel, new RegExp(phrase, "i"), `Threat model must define ${phrase}`);
}
for (const phrase of ["Normal path", "Emergency path", "required checks", "Direct pushes"]) assert.match(releaseGovernance, new RegExp(phrase, "i"), `Release governance must define ${phrase}`);
for (const phrase of ["Cloudflare D1", "PostgreSQL", "Break glass", "recovery point", "recovery time"]) assert.match(recoveryRunbook, new RegExp(phrase, "i"), `Recovery runbook must define ${phrase}`);
assert.match(securityPolicyDocument, /Critical[^\n]+24 hours/i, "Security policy must publish a critical-response target");
assert.match(codeowners, /\/\.github\/workflows\//, "Security-sensitive workflows must have an explicit owner");
assert.match(codeowners, /\/src\/security-policy\.js/, "Shared security policy must have an explicit owner");

const tracked = execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8" }).split("\0").filter(Boolean);
const forbiddenNames = tracked.filter((path) => /(^|\/)(?:\.env(?:\..*)?|id_(?:rsa|ecdsa|ed25519)|[^/]+\.(?:p12|pfx|jks|key|pem))$/i.test(path));
assert.deepEqual(forbiddenNames, [], `Tracked credential-like files are prohibited: ${forbiddenNames.join(", ")}`);

const marker = ["-----BEGIN ", "PRIVATE KEY-----"].join("");
const secretPatterns = [
  ["private key", new RegExp(marker)],
  ["GitHub token", /gh[pousr]_[A-Za-z0-9_]{30,}/],
  ["AWS access key", /AKIA[0-9A-Z]{16}/],
  ["Slack token", /xox[baprs]-[A-Za-z0-9-]{20,}/],
  ["provider key", /sk-(?:live|test|proj)-[A-Za-z0-9_-]{16,}/],
];
const findings = [];
for (const path of tracked.filter((path) => !path.startsWith("src/data/") && !path.startsWith(".learnings/"))) {
  let source;
  try { source = await read(path); } catch { continue; }
  for (const [label, pattern] of secretPatterns) if (pattern.test(source)) findings.push(`${path}: ${label}`);
}
assert.deepEqual(findings, [], `Tracked secret material detected: ${findings.join(", ")}`);

console.log("Cyber governance contracts passed", {
  trackedFiles: tracked.length,
  sessionDays: 14,
  secretFindings: findings.length,
  containerImages: 2,
});
