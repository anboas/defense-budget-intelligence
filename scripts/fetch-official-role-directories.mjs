import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const OUT = resolve(ROOT, "src/data/official-role-directory-snapshot.json");
const OBSERVED_AT = new Date().toISOString().slice(0, 10);
const HASC_ROOT = "https://armedservices.house.gov";
const HASC_PAGES = [
  ["hasc-members", "House Committee on Armed Services", "/about/members.htm"],
  ["hasc-cyber", "House Armed Services Subcommittee on Cyber, Information Technologies, and Innovation", "/Issues/Issue/?IssueID=14892"],
  ["hasc-intelligence", "House Armed Services Subcommittee on Intelligence and Special Operations", "/Issues/Issue/?IssueID=14893"],
  ["hasc-personnel", "House Armed Services Subcommittee on Military Personnel", "/Issues/Issue/?IssueID=14894"],
  ["hasc-readiness", "House Armed Services Subcommittee on Readiness", "/Issues/Issue/?IssueID=14895"],
  ["hasc-seapower", "House Armed Services Subcommittee on Seapower and Projection Forces", "/Issues/Issue/?IssueID=14896"],
  ["hasc-strategic", "House Armed Services Subcommittee on Strategic Forces", "/Issues/Issue/?IssueID=14897"],
  ["hasc-tactical", "House Armed Services Subcommittee on Tactical Air and Land Forces", "/Issues/Issue/?IssueID=14898"],
];
const SASC_URL = "https://www.armed-services.senate.gov/subcommittees";
const SACD_URL = "https://www.appropriations.senate.gov/subcommittees/defense";

const hash = (value) => createHash("sha256").update(String(value)).digest("hex").slice(0, 20);
const decode = (value) => String(value || "").replace(/&(#x[0-9a-f]+|#\d+|amp|quot|apos|lt|gt|nbsp);/gi, (match, entity) => {
  if (entity[0] === "#") {
    const numeric = entity[1].toLowerCase() === "x" ? Number.parseInt(entity.slice(2), 16) : Number.parseInt(entity.slice(1), 10);
    return Number.isFinite(numeric) ? String.fromCodePoint(numeric) : match;
  }
  return { amp: "&", quot: '"', apos: "'", lt: "<", gt: ">", nbsp: " " }[entity.toLowerCase()] || match;
});
const text = (value) => decode(String(value || "").replace(/<br\s*\/?\s*>/gi, "\n").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
const slug = (value) => text(value).toLowerCase().replace(/\b(senator|representative|rep\.?|dr\.?)\b/g, " ").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const canonicalUrl = (value, base) => new URL(value, base).href;

async function fetchHtml(url) {
  const response = await fetch(url, { headers: { accept: "text/html", "user-agent": "DefenseBudgetIntelligence/2.0 official-public-role-directory" } });
  if (!response.ok) throw new Error(`${url} returned ${response.status}`);
  const html = await response.text();
  if (html.length < 10_000) throw new Error(`${url} returned an unexpectedly small document`);
  return html;
}

function addRole(store, { personName, profileUrl = "", title, roleType, organizationName, sourceId, evidenceQuote }) {
  const label = text(personName);
  if (!label || !organizationName || !sourceId) return;
  const personKey = profileUrl ? new URL(profileUrl).hostname.replace(/^www\./, "") : slug(label);
  const personId = `person:${slug(label)}-${hash(personKey).slice(0, 8)}`;
  if (!store.people.has(personId)) store.people.set(personId, { id: personId, label, publicProfileUrl: profileUrl });
  const id = `official-role:${hash(`${personId}|${organizationName}|${title}`)}`;
  store.roles.set(id, {
    id,
    personId,
    title,
    roleType,
    organizationName,
    effectiveFrom: OBSERVED_AT,
    effectiveTo: "",
    datePrecision: "observed-current-lower-bound",
    status: "observed-current",
    sourceIds: [sourceId],
    evidenceQuote: evidenceQuote || `The official directory lists ${label} as ${title} for ${organizationName}.`,
    reviewState: "source_snapshot",
  });
}

function parseHasc(store, html, { sourceId, organizationName, sourceUrl }) {
  const jurisdiction = text(html.match(/<strong>Jurisdiction:<\/strong>([\s\S]*?)<\/div>/i)?.[1] || "");
  const members = [...html.matchAll(/<a\s+class="member[^"]*"\s+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)].map((match) => ({
    profileUrl: canonicalUrl(match[1], sourceUrl),
    name: text(match[2].match(/<h3[^>]*>([\s\S]*?)<\/h3>/i)?.[1]),
  })).filter((row) => row.name);
  members.forEach((member, index) => {
    const leadership = index === 0 ? "Chair" : index === 1 ? "Ranking Member" : "Member";
    addRole(store, {
      personName: member.name,
      profileUrl: member.profileUrl,
      title: `${leadership}, ${organizationName}`,
      roleType: index === 0 ? "committee-chair" : index === 1 ? "committee-ranking-member" : "committee-member",
      organizationName,
      sourceId,
      sourceUrl,
    });
  });
  return { jurisdiction, records: members.length };
}

function splitSenators(value) {
  return String(value || "").split(/<br\s*\/?\s*>/i).map((item) => text(item).replace(/^Senator\s+/i, "")).filter(Boolean);
}

function parseSasc(store, html, sourceId) {
  const titles = [...html.matchAll(/SubcommitteeOverview__introTitle[\s\S]*?<h2[^>]*>([\s\S]*?)<\/h2>/gi)].map((match) => text(match[1]));
  const memberGroups = [...html.matchAll(/class="SubcommitteeOverview__memberLink"[\s\S]*?>([\s\S]*?)<\/a>/gi)].map((match) => splitSenators(match[1]));
  const missions = [...html.matchAll(/SubcommitteeOverview__introText[\s\S]*?<div[^>]*class="RawHTML"[^>]*>([\s\S]*?)<\/div>/gi)].map((match) => text(match[1]));
  if (!titles.length || memberGroups.length < titles.length * 2) throw new Error("SASC subcommittee parser found no stable membership blocks");
  const organizations = [];
  titles.forEach((title, index) => {
    const organizationName = `Senate Armed Services Subcommittee on ${title}`;
    const sourceUrl = SASC_URL;
    organizations.push({ organizationName, jurisdiction: missions[index] || "", parentOrganizationName: "Senate Committee on Armed Services" });
    for (const member of [...memberGroups[index * 2], ...memberGroups[index * 2 + 1]]) {
      const isChair = /,\s*Chair$/i.test(member);
      const isRanking = /,\s*Ranking Member$/i.test(member);
      const personName = member.replace(/,\s*(Chair|Ranking Member)$/i, "").trim();
      const titleLabel = isChair ? "Chair" : isRanking ? "Ranking Member" : "Member";
      addRole(store, { personName, title: `${titleLabel}, ${organizationName}`, roleType: isChair ? "committee-chair" : isRanking ? "committee-ranking-member" : "committee-member", organizationName, sourceId, sourceUrl });
    }
    for (const [personName, titleLabel, roleType] of [["Roger Wicker", "Ex officio member", "committee-ex-officio"], ["Jack Reed", "Ex officio member", "committee-ex-officio"]]) {
      addRole(store, { personName, title: `${titleLabel}, ${organizationName}`, roleType, organizationName, sourceId, sourceUrl, evidenceQuote: `The official SASC directory states the committee chair and ranking member serve as ex officio members of all subcommittees.` });
    }
  });
  return organizations;
}

function parseSacDefense(store, html, sourceId) {
  const section = html.match(/<div id=["']membership["']>([\s\S]*?)<ul class="nav nav-tabs subcommittee"/i)?.[1] || "";
  const matches = [...section.matchAll(/<a[^>]+href\s*=\s*["']([^"']+senate\.gov\/?)["'][^>]*>([\s\S]*?)<span class="hidden">/gi)];
  if (matches.length < 2) throw new Error("Senate Appropriations Defense parser found no membership records");
  const organizationName = "Senate Appropriations Subcommittee on Defense";
  matches.forEach((match, index) => {
    const personName = text(match[2]);
    const titleLabel = index === 0 ? "Chair" : index === 1 ? "Ranking Member" : "Member";
    addRole(store, { personName, profileUrl: match[1], title: `${titleLabel}, ${organizationName}`, roleType: index === 0 ? "committee-chair" : index === 1 ? "committee-ranking-member" : "committee-member", organizationName, sourceId, sourceUrl: SACD_URL });
  });
  return { organizationName, jurisdiction: "Defense appropriations", parentOrganizationName: "Senate Committee on Appropriations", records: matches.length };
}

const store = { people: new Map(), roles: new Map() };
const sources = [];
const organizations = [];

for (const [sourceId, organizationName, path] of HASC_PAGES) {
  const sourceUrl = canonicalUrl(path, HASC_ROOT);
  const html = await fetchHtml(sourceUrl);
  const parsed = parseHasc(store, html, { sourceId, organizationName, sourceUrl });
  sources.push({ id: sourceId, title: organizationName, publisher: "House Committee on Armed Services", url: sourceUrl, observedAt: OBSERVED_AT, contentHash: createHash("sha256").update(html).digest("hex") });
  organizations.push({ organizationName, jurisdiction: parsed.jurisdiction, parentOrganizationName: organizationName === "House Committee on Armed Services" ? "U.S. House of Representatives" : "House Committee on Armed Services", sourceId });
}

const sascHtml = await fetchHtml(SASC_URL);
sources.push({ id: "sasc-subcommittees-directory", title: "Senate Armed Services Committee Subcommittees", publisher: "Senate Committee on Armed Services", url: SASC_URL, observedAt: OBSERVED_AT, contentHash: createHash("sha256").update(sascHtml).digest("hex") });
organizations.push(...parseSasc(store, sascHtml, "sasc-subcommittees-directory").map((row) => ({ ...row, sourceId: "sasc-subcommittees-directory" })));

const sacdHtml = await fetchHtml(SACD_URL);
sources.push({ id: "senate-appropriations-defense-directory", title: "Senate Appropriations Subcommittee on Defense", publisher: "Senate Committee on Appropriations", url: SACD_URL, observedAt: OBSERVED_AT, contentHash: createHash("sha256").update(sacdHtml).digest("hex") });
organizations.push({ ...parseSacDefense(store, sacdHtml, "senate-appropriations-defense-directory"), sourceId: "senate-appropriations-defense-directory" });

const output = {
  metadata: {
    schemaVersion: "1.0.0",
    observedAt: OBSERVED_AT,
    generatedAt: new Date().toISOString(),
    status: "current",
    people: store.people.size,
    roles: store.roles.size,
    sources: sources.length,
    organizations: organizations.length,
    evidenceBoundary: "Official committee directories create observed-current lower bounds. They do not establish appointment dates. Public professional roles only; private contact data and inferred employment are excluded.",
  },
  sources,
  organizations,
  people: [...store.people.values()].sort((a, b) => a.label.localeCompare(b.label)),
  roles: [...store.roles.values()].sort((a, b) => a.organizationName.localeCompare(b.organizationName) || a.title.localeCompare(b.title) || a.id.localeCompare(b.id)),
};

if (output.roles.length < 250) throw new Error(`Official directory coverage is below the 250-role release floor: ${output.roles.length}`);
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, `${JSON.stringify(output, null, 2)}\n`);
console.log(JSON.stringify({ output: OUT, ...output.metadata }, null, 2));
