import { EVENT_CATALOG_SOURCE_REGISTRY } from "./event-catalog.js";

export const EVENT_DISCOVERY_SCHEMA = Object.freeze([
  `CREATE TABLE IF NOT EXISTS dbi_event_discovery_runs (
    id TEXT PRIMARY KEY,
    source_id TEXT NOT NULL,
    source_url TEXT NOT NULL,
    status TEXT NOT NULL,
    candidates_seen INTEGER NOT NULL DEFAULT 0,
    candidates_added INTEGER NOT NULL DEFAULT 0,
    error_code TEXT NOT NULL DEFAULT '',
    error_message TEXT NOT NULL DEFAULT '',
    started_at TEXT NOT NULL,
    completed_at TEXT NOT NULL DEFAULT ''
  )`,
  "CREATE INDEX IF NOT EXISTS idx_dbi_event_discovery_runs_source ON dbi_event_discovery_runs (source_id, started_at DESC)",
  `CREATE TABLE IF NOT EXISTS dbi_event_discovery_candidates (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL,
    source_id TEXT NOT NULL,
    source_url TEXT NOT NULL,
    fingerprint TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'pending',
    candidate_json TEXT NOT NULL,
    evidence_json TEXT NOT NULL DEFAULT '[]',
    duplicate_catalog_id TEXT NOT NULL DEFAULT '',
    rejection_reason TEXT NOT NULL DEFAULT '',
    discovered_at TEXT NOT NULL,
    reviewed_by TEXT NOT NULL DEFAULT '',
    reviewed_at TEXT NOT NULL DEFAULT ''
  )`,
  "CREATE INDEX IF NOT EXISTS idx_dbi_event_discovery_candidates_status ON dbi_event_discovery_candidates (status, discovered_at DESC)",
  `CREATE TABLE IF NOT EXISTS dbi_event_discovery_source_state (
    source_id TEXT PRIMARY KEY,
    etag TEXT NOT NULL DEFAULT '',
    last_modified TEXT NOT NULL DEFAULT '',
    content_hash TEXT NOT NULL DEFAULT '',
    last_success_at TEXT NOT NULL DEFAULT '',
    last_failure_at TEXT NOT NULL DEFAULT '',
    consecutive_failures INTEGER NOT NULL DEFAULT 0,
    candidates_seen INTEGER NOT NULL DEFAULT 0,
    candidates_added INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS dbi_event_catalog_entries (
    id TEXT PRIMARY KEY,
    series_id TEXT NOT NULL,
    revision INTEGER NOT NULL DEFAULT 1,
    status TEXT NOT NULL DEFAULT 'published',
    event_json TEXT NOT NULL,
    source_candidate_id TEXT NOT NULL DEFAULT '',
    published_by TEXT NOT NULL DEFAULT '',
    published_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  "CREATE INDEX IF NOT EXISTS idx_dbi_event_catalog_entries_status ON dbi_event_catalog_entries (status, updated_at DESC)",
]);

function clean(value, limit = 500) {
  return Array.from(String(value ?? ""), (character) => {
    const code = character.charCodeAt(0);
    return code < 32 || code === 127 ? " " : character;
  }).join("").replace(/\s+/g, " ").trim().slice(0, limit);
}

function safeArray(value) { return Array.isArray(value) ? value : value ? [value] : []; }
function parsed(value, fallback) { try { return JSON.parse(value || ""); } catch { return fallback; } }
function dateValue(value) {
  const text = clean(value, 40);
  if (!text || Number.isNaN(Date.parse(text))) return "";
  return text.length === 10 ? `${text}T08:00` : text.slice(0, 32);
}
function httpUrl(value, baseUrl = "") {
  try {
    const result = new URL(clean(value, 2000), baseUrl || undefined);
    return ["http:", "https:"].includes(result.protocol) ? result.toString() : "";
  } catch { return ""; }
}
function canonicalUrl(value, baseUrl = "") {
  const result = httpUrl(value, baseUrl);
  if (!result) return "";
  const url = new URL(result);
  url.hash = "";
  for (const key of [...url.searchParams.keys()]) {
    if (/^(utm_|fbclid|gclid)/i.test(key)) url.searchParams.delete(key);
  }
  return url.toString();
}
function decodeEntities(value) {
  const entities = { amp: "&", quot: '"', "#39": "'", apos: "'", lt: "<", gt: ">" };
  return clean(String(value || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&(amp|quot|#39|apos|lt|gt);/gi, (_match, entity) => entities[entity.toLowerCase()]), 1600);
}
function locationValue(value) {
  if (typeof value === "string") return clean(value, 500);
  const address = value?.address || value || {};
  return [value?.name, address.streetAddress, address.addressLocality, address.addressRegion, address.postalCode, address.addressCountry]
    .map((item) => clean(item, 160)).filter(Boolean).join(", ").slice(0, 500);
}
function slug(value) {
  return clean(value, 180).toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 100);
}
async function sha256(value) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((item) => item.toString(16).padStart(2, "0")).join("");
}

function jsonLdNodes(value) {
  if (Array.isArray(value)) return value.flatMap(jsonLdNodes);
  if (!value || typeof value !== "object") return [];
  if (Array.isArray(value["@graph"])) return [value, ...value["@graph"].flatMap(jsonLdNodes)];
  return [value];
}

function unwrapJsonLd(value) {
  let text = String(value || "").trim();
  if (text.startsWith("<!--")) text = text.slice(4).trimStart();
  if (text.endsWith("--!>")) return text.slice(0, -4).trimEnd();
  if (text.endsWith("-->")) return text.slice(0, -3).trimEnd();
  return text;
}

function candidateFromFields(fields, source, evidenceUrl = source.url, discoveryKind = "structured") {
  const title = clean(fields.title, 180);
  if (title.length < 3) return null;
  const startsAt = dateValue(fields.startsAt);
  const endsAt = dateValue(fields.endsAt);
  const officialUrl = canonicalUrl(fields.officialUrl, evidenceUrl) || canonicalUrl(evidenceUrl) || source.url;
  return {
    title,
    seriesId: slug(title.replace(/\b20\d{2}\b/g, "")),
    summary: clean(fields.summary, 1600),
    startsAt,
    endsAt,
    timezone: clean(fields.timezone, 80),
    location: clean(fields.location, 500),
    venue: clean(fields.venue, 240),
    city: clean(fields.city, 120),
    region: clean(fields.region, 80),
    country: clean(fields.country, 120),
    format: clean(fields.format, 40) || "in_person",
    eventType: clean(fields.eventType, 80) || "event",
    branch: source.branch || "Joint",
    sponsor: clean(fields.sponsor || source.name, 180),
    status: clean(fields.status, 40) || (startsAt ? "discovered" : "lead"),
    confidence: startsAt ? "medium" : "low",
    lastVerifiedAt: new Date().toISOString().slice(0, 10),
    topics: safeArray(fields.topics).map((item) => clean(item, 120)).filter(Boolean).slice(0, 20),
    capabilityAreas: [], missionThreads: [], stakeholders: [], keywords: [], milestones: [],
    links: [{ label: "Official event", url: officialUrl }],
    sources: [{ title, publisher: source.name, url: officialUrl, kind: "official", confidence: startsAt ? "medium" : "low", lastVerifiedAt: new Date().toISOString().slice(0, 10) }],
    caveats: [startsAt
      ? `Discovered from official ${discoveryKind} data. A curator must verify and publish this edition.`
      : `Discovery lead from an official ${discoveryKind} source. Date and details still require verification.`],
    discovery: { adapter: source.adapter || "jsonld", kind: discoveryKind, sourceId: source.id },
  };
}

export function extractOfficialEventCandidates(html, source) {
  const scripts = [...String(html || "").matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  const candidates = [];
  for (const match of scripts) {
    const root = parsed(unwrapJsonLd(match[1]), null);
    for (const node of jsonLdNodes(root)) {
      const types = safeArray(node?.["@type"]).map((item) => clean(item, 80).toLowerCase());
      if (!types.some((type) => type === "event" || type.endsWith("event"))) continue;
      const title = clean(node.name || node.headline, 180);
      if (title.length < 3) continue;
      const startsAt = dateValue(node.startDate);
      const endsAt = dateValue(node.endDate);
      const location = locationValue(node.location);
      const eventStatus = clean(node.eventStatus, 180).toLowerCase();
      const attendanceMode = clean(node.eventAttendanceMode, 180).toLowerCase();
      candidates.push(candidateFromFields({
        title, summary: node.description, startsAt, endsAt, officialUrl: node.url,
        location, venue: typeof node.location === "object" ? node.location?.name : "",
        city: typeof node.location === "object" ? node.location?.address?.addressLocality : "",
        region: typeof node.location === "object" ? node.location?.address?.addressRegion : "",
        country: typeof node.location === "object" ? node.location?.address?.addressCountry : "",
        format: attendanceMode.includes("mixed") ? "hybrid" : attendanceMode.includes("online") ? "virtual" : "in_person",
        sponsor: node.organizer?.name, status: eventStatus.includes("cancel") ? "cancelled" : startsAt ? "discovered" : "",
        topics: safeArray(node.keywords).flatMap((item) => String(item || "").split(",")),
      }, source, source.url, "JSON-LD"));
    }
  }
  const seen = new Set();
  return candidates.filter((candidate) => {
    const key = `${candidate.title.toLowerCase()}|${candidate.startsAt.slice(0, 10)}`;
    return !seen.has(key) && seen.add(key);
  });
}

const EVENT_LINK_HINT = /\b(event|events|conference|symposium|summit|forum|industry[- ]day|vendor[- ]outreach|small[- ]business|workshop|expo|meeting|briefing|webinar|matchmaking|apbi)\b/i;
const TRUSTED_REGISTRATION_HOSTS = new Set(["events.cvent.com", "www.eventbrite.com", "eventbrite.com"]);
const GENERIC_EVENT_TITLES = new Set([
  "event", "events", "all events", "upcoming events", "featured events", "chapter events", "calendar", "event calendar",
  "meetings and events", "conferences and events", "news and events", "home", "about", "learn more", "read more", "view all",
]);

export function eventCandidateQuality(candidate = {}) {
  const title = clean(candidate.title, 180);
  const normalized = title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const sourceUrl = safeArray(candidate.sources).map((source) => canonicalUrl(source?.url)).find(Boolean) || "";
  const pathname = sourceUrl ? new URL(sourceUrl).pathname.replace(/[-_/]+/g, " ").trim().toLowerCase() : "";
  const issues = [];
  if (title.length < 4) issues.push("Title is too short to identify an event");
  if (GENERIC_EVENT_TITLES.has(normalized) || /^(skip to|back to|go to|click here|register|menu|navigation)\b/i.test(title)) issues.push("Title is generic navigation or listing text");
  const hasEventLanguage = EVENT_LINK_HINT.test(title);
  const hasYear = /\b20\d{2}\b/.test(title);
  const hasSpecificPath = pathname && !/^(events?|calendar|chapter events?|news events?)\/?$/.test(pathname);
  const tokenCount = normalized.split(/\s+/).filter((token) => token.length > 1).length;
  let score = 0;
  if (candidate.startsAt) score += 45;
  if (hasEventLanguage) score += 30;
  if (hasYear) score += 15;
  if (hasSpecificPath) score += 10;
  if (tokenCount >= 3) score += 10;
  if (!candidate.startsAt && !hasEventLanguage && !hasYear && !(hasSpecificPath && tokenCount >= 3)) issues.push("No event-specific date, title, or detail-page identity was found");
  const isLikelyEvent = issues.length === 0 && score >= 20;
  return { isLikelyEvent, score, label: isLikelyEvent ? (candidate.startsAt ? "Likely event" : "Plausible lead") : "Likely navigation noise", issues };
}

function detailUrlAllowed(value, source) {
  const result = canonicalUrl(value, source.url);
  if (!result) return false;
  const host = new URL(result).hostname.toLowerCase();
  const sourceHost = new URL(source.url).hostname.toLowerCase();
  return host === sourceHost || host.endsWith(`.${sourceHost}`) || safeArray(source.allowedHosts).includes(host) || TRUSTED_REGISTRATION_HOSTS.has(host);
}

export function extractOfficialDetailLinks(html, source) {
  const links = [];
  for (const match of String(html || "").matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const title = decodeEntities(match[2]);
    const url = canonicalUrl(match[1], source.url);
    if (!url || !detailUrlAllowed(url, source) || (!EVENT_LINK_HINT.test(title) && !EVENT_LINK_HINT.test(new URL(url).pathname.replace(/[-_/]+/g, " ")))) continue;
    links.push({ title: title || decodeEntities(new URL(url).pathname.replace(/[-_/]+/g, " ")), url });
  }
  return [...new Map(links.map((link) => [link.url, link])).values()].slice(0, Math.max(1, Number(source.maxDetailPages) || 6));
}

export function extractFeedEventLinks(xml, source) {
  const entries = [...String(xml || "").matchAll(/<(?:item|entry)\b[^>]*>([\s\S]*?)<\/(?:item|entry)>/gi)];
  return entries.map((entry) => {
    const body = entry[1];
    const title = decodeEntities(body.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1]);
    const href = body.match(/<link\b[^>]*href=["']([^"']+)["'][^>]*\/?\s*>/i)?.[1]
      || decodeEntities(body.match(/<link\b[^>]*>([\s\S]*?)<\/link>/i)?.[1]);
    const url = canonicalUrl(href, source.url);
    const summary = decodeEntities(body.match(/<(?:description|summary|content)\b[^>]*>([\s\S]*?)<\/(?:description|summary|content)>/i)?.[1]);
    return title.length >= 3 && url && detailUrlAllowed(url, source) ? { title, url, summary } : null;
  }).filter(Boolean).slice(0, Math.max(1, Number(source.maxDetailPages) || 8));
}

export function extractSitemapEventLinks(xml, source) {
  return [...String(xml || "").matchAll(/<loc\b[^>]*>([\s\S]*?)<\/loc>/gi)]
    .map((match) => canonicalUrl(decodeEntities(match[1]), source.url))
    .filter((url) => url && detailUrlAllowed(url, source) && EVENT_LINK_HINT.test(new URL(url).pathname.replace(/[-_/]+/g, " ")))
    .filter((url, index, rows) => rows.indexOf(url) === index)
    .slice(0, Math.max(1, Number(source.maxDetailPages) || 8))
    .map((url) => ({ title: decodeEntities(new URL(url).pathname.replace(/[-_/]+/g, " ")), url }));
}

function icsDate(value) {
  const text = clean(value, 40).replace(/Z$/, "");
  const match = text.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?)?$/);
  if (!match) return dateValue(text);
  return `${match[1]}-${match[2]}-${match[3]}T${match[4] || "08"}:${match[5] || "00"}`;
}

export function extractIcsEventCandidates(ics, source) {
  const unfolded = String(ics || "").replace(/\r?\n[ \t]/g, "");
  return [...unfolded.matchAll(/BEGIN:VEVENT\r?\n([\s\S]*?)END:VEVENT/gi)].map((match) => {
    const lines = match[1].split(/\r?\n/);
    const value = (name) => lines.find((line) => line.toUpperCase().startsWith(`${name}:`) || line.toUpperCase().startsWith(`${name};`))?.replace(/^[^:]*:/, "") || "";
    return candidateFromFields({
      title: value("SUMMARY").replace(/\\([,;])/g, "$1"),
      summary: value("DESCRIPTION").replace(/\\n/gi, " "),
      startsAt: icsDate(value("DTSTART")), endsAt: icsDate(value("DTEND")),
      location: value("LOCATION").replace(/\\([,;])/g, "$1"), officialUrl: value("URL"),
    }, source, source.url, "ICS calendar");
  }).filter(Boolean);
}

export function extractSamEventCandidates(payload, source) {
  const EVENT_NOTICE = /\b(industry day|vendor outreach|pre[- ]solicitation conference|pre[- ]proposal conference|business opportunity (?:event|session)|apbi|matchmaking|site visit|small business (?:event|conference|outreach)|industry engagement|draft rfp briefing)\b/i;
  return safeArray(payload?.records || payload?.opportunitiesData).filter((record) => EVENT_NOTICE.test(`${record?.title || ""} ${record?.description || ""}`)).map((record) => candidateFromFields({
    title: record.title,
    summary: record.description,
    officialUrl: record.sourceUrl || record.uiLink,
    sponsor: record.office || record.subTier || record.department || source.name,
    eventType: "industry_engagement",
    topics: [record.noticeType, record.naicsCode ? `NAICS ${record.naicsCode}` : ""].filter(Boolean),
  }, source, source.url, "SAM.gov notice")).filter(Boolean);
}

function minimalLead(link, source, kind) {
  const candidate = candidateFromFields({ title: link.title, summary: link.summary, officialUrl: link.url }, source, link.url, kind);
  return candidate && eventCandidateQuality(candidate).isLikelyEvent ? candidate : null;
}

async function fetchSource(fetchImpl, url, { etag = "", lastModified = "", accept = "text/html,application/xhtml+xml,application/xml,text/calendar,application/json" } = {}) {
  const headers = { accept, "user-agent": "DefenseBudgetIntelligence-EventDiscovery/2.0" };
  if (etag) headers["if-none-match"] = etag;
  if (lastModified) headers["if-modified-since"] = lastModified;
  const response = await fetchImpl(url, { headers });
  if (response.status === 304) return { unchanged: true, response, text: "" };
  if (!response.ok) throw Object.assign(new Error(`Official source returned ${response.status}`), { code: "source_http_error" });
  return { unchanged: false, response, text: (await response.text()).slice(0, 2_000_000) };
}

function uniqueCandidates(candidates) {
  const seen = new Set();
  return candidates.filter(Boolean).filter((candidate) => {
    const url = candidate.sources?.[0]?.url || "";
    const key = `${clean(candidate.title, 180).toLowerCase()}|${clean(candidate.startsAt, 10)}|${url}`;
    return !seen.has(key) && seen.add(key);
  });
}

export async function discoverSourceCandidates(source, { fetchImpl = fetch, state = {}, appOrigin = "https://defense-budget-intelligence.pages.dev" } = {}) {
  if (source.adapter === "sam_feed") {
    const feedUrl = new URL("/data/sam-opportunities.json", appOrigin).toString();
    const document = await fetchSource(fetchImpl, feedUrl, { etag: state.etag, lastModified: state.lastModified, accept: "application/json" });
    if (document.unchanged) return { candidates: [], unchanged: true, response: document.response, contentHash: state.contentHash || "" };
    const contentHash = await sha256(document.text);
    if (state.contentHash && state.contentHash === contentHash) return { candidates: [], unchanged: true, response: document.response, contentHash };
    const payload = parsed(document.text, null);
    if (!payload) throw Object.assign(new Error("SAM.gov discovery feed was invalid JSON"), { code: "source_parse_error" });
    return { candidates: extractSamEventCandidates(payload, source), unchanged: false, response: document.response, contentHash };
  }

  const document = await fetchSource(fetchImpl, source.url, { etag: state.etag, lastModified: state.lastModified });
  if (document.unchanged) return { candidates: [], unchanged: true, response: document.response, contentHash: state.contentHash || "" };
  const contentHash = await sha256(document.text);
  if (state.contentHash && state.contentHash === contentHash) return { candidates: [], unchanged: true, response: document.response, contentHash };
  const contentType = String(document.response.headers.get("content-type") || "").toLowerCase();
  const adapter = source.adapter || "jsonld";
  if (adapter === "ics" || contentType.includes("text/calendar") || /^BEGIN:VCALENDAR/i.test(document.text.trim())) {
    return { candidates: extractIcsEventCandidates(document.text, source), unchanged: false, response: document.response, contentHash };
  }
  if (adapter === "rss" || contentType.includes("rss") || contentType.includes("atom")) {
    const links = extractFeedEventLinks(document.text, source);
    const candidates = [];
    for (const link of links) {
      const detail = await fetchSource(fetchImpl, link.url);
      const extracted = extractOfficialEventCandidates(detail.text, { ...source, url: link.url });
      candidates.push(...(extracted.length ? extracted : [minimalLead(link, source, "RSS/Atom feed")]));
    }
    return { candidates: uniqueCandidates(candidates), unchanged: false, response: document.response, contentHash };
  }
  if (adapter === "sitemap" || contentType.includes("sitemap") || /<urlset\b/i.test(document.text)) {
    const links = extractSitemapEventLinks(document.text, source);
    const candidates = [];
    for (const link of links) {
      const detail = await fetchSource(fetchImpl, link.url);
      const extracted = extractOfficialEventCandidates(detail.text, { ...source, url: link.url });
      candidates.push(...(extracted.length ? extracted : [minimalLead(link, source, "sitemap")]));
    }
    return { candidates: uniqueCandidates(candidates), unchanged: false, response: document.response, contentHash };
  }

  const candidates = extractOfficialEventCandidates(document.text, source);
  if (adapter === "list_detail") {
    for (const link of extractOfficialDetailLinks(document.text, source)) {
      const detail = await fetchSource(fetchImpl, link.url);
      const extracted = extractOfficialEventCandidates(detail.text, { ...source, url: link.url });
      candidates.push(...(extracted.length ? extracted : [minimalLead(link, source, "official event listing")]));
    }
  }
  return { candidates: uniqueCandidates(candidates), unchanged: false, response: document.response, contentHash };
}

export function eventCandidateFingerprint(candidate, sourceId = "") {
  const url = safeArray(candidate?.sources).map((source) => canonicalUrl(source?.url)).find(Boolean) || "";
  return [sourceId, clean(candidate?.title, 180).toLowerCase(), clean(candidate?.startsAt, 10), url].join("|");
}

function catalogIdentity(event) {
  return `${slug(event?.seriesId || String(event?.title || "").replace(/\b20\d{2}\b/g, ""))}|${clean(event?.startsAt, 10)}`;
}

function titleTokens(value) {
  return new Set(slug(String(value || "").replace(/\b20\d{2}\b/g, "")).split("-").filter((token) => token.length > 2));
}

function tokenSimilarity(left, right) {
  const a = titleTokens(left); const b = titleTokens(right);
  const union = new Set([...a, ...b]);
  return union.size ? [...a].filter((token) => b.has(token)).length / union.size : 0;
}

function dateDistanceDays(left, right) {
  if (!left || !right) return null;
  const distance = Math.abs(Date.parse(left) - Date.parse(right));
  return Number.isFinite(distance) ? Math.round(distance / 86_400_000) : null;
}

export function catalogCandidateChanges(candidate, event) {
  const changes = [];
  for (const field of ["startsAt", "endsAt", "location", "venue", "city", "region", "country", "sponsor"]) {
    const proposed = clean(candidate?.[field], 500);
    const existing = clean(event?.[field], 500);
    if (proposed && proposed.toLowerCase() !== existing.toLowerCase()) changes.push({ field, from: existing, to: proposed });
  }
  if (candidate?.status === "cancelled" && event?.status !== "cancelled") changes.push({ field: "status", from: clean(event?.status, 40), to: "cancelled" });
  return changes;
}

export function findCatalogDuplicateMatch(candidate, catalog = []) {
  const identity = catalogIdentity(candidate);
  const candidateDate = clean(candidate?.startsAt, 10);
  const candidateUrls = new Set(safeArray(candidate?.sources).map((source) => canonicalUrl(source?.url)).filter(Boolean));
  let best = null;
  for (const event of catalog) {
    const reasons = [];
    let score = 0;
    if (catalogIdentity(event) === identity) { score += 100; reasons.push("same recurring series and date"); }
    const sharedUrl = safeArray(event?.sources).some((source) => candidateUrls.has(canonicalUrl(source?.url)));
    if (sharedUrl) { score += 90; reasons.push("same canonical official URL"); }
    const similarity = tokenSimilarity(candidate?.title, event?.title);
    const distance = dateDistanceDays(candidateDate, clean(event?.startsAt, 10));
    if (similarity >= 0.72) { score += Math.round(similarity * 60); reasons.push(`${Math.round(similarity * 100)}% title-token match`); }
    if (distance !== null && distance <= 7) { score += 25 - Math.min(21, distance * 3); reasons.push(distance ? `dates are ${distance} days apart` : "same date"); }
    if (candidate?.city && clean(candidate.city, 120).toLowerCase() === clean(event?.city, 120).toLowerCase()) { score += 10; reasons.push("same city"); }
    if (candidate?.sponsor && clean(candidate.sponsor, 180).toLowerCase() === clean(event?.sponsor, 180).toLowerCase()) { score += 10; reasons.push("same organizer"); }
    if ((score >= 90 || (score >= 70 && (distance === null || distance <= 7))) && (!best || score > best.score)) best = { event, score, reasons, changes: catalogCandidateChanges(candidate, event) };
  }
  return best;
}

export function findCatalogDuplicate(candidate, catalog = []) {
  return findCatalogDuplicateMatch(candidate, catalog)?.event || null;
}

export async function dynamicEventCatalog(db) {
  const result = await db.prepare("SELECT event_json FROM dbi_event_catalog_entries WHERE status = 'published' ORDER BY updated_at DESC").all();
  return (result.results || []).map((row) => parsed(row.event_json, null)).filter(Boolean);
}

function stateFromRow(row = {}) {
  return {
    sourceId: row.source_id || "", etag: row.etag || "", lastModified: row.last_modified || "", contentHash: row.content_hash || "",
    lastSuccessAt: row.last_success_at || "", lastFailureAt: row.last_failure_at || "", consecutiveFailures: Number(row.consecutive_failures || 0),
    candidatesSeen: Number(row.candidates_seen || 0), candidatesAdded: Number(row.candidates_added || 0), updatedAt: row.updated_at || "",
  };
}

function sourcePriority(source, state, now) {
  const lastAttempt = Date.parse(state?.updatedAt || "");
  const elapsedHours = Number.isFinite(lastAttempt) ? (now.getTime() - lastAttempt) / 3_600_000 : Number.POSITIVE_INFINITY;
  const cadence = Math.max(1, Number(source.cadenceHours) || 24);
  const backoff = state?.consecutiveFailures ? Math.min(48, 2 ** Math.min(5, state.consecutiveFailures)) : 0;
  const due = !Number.isFinite(elapsedHours) || elapsedHours >= Math.max(cadence, backoff);
  const score = (!Number.isFinite(elapsedHours) ? 10_000 : Math.min(1000, elapsedHours * 10)) + Number(source.priority || 0) + (state?.consecutiveFailures ? Math.max(0, 40 - state.consecutiveFailures * 10) : 50);
  return { due, score };
}

export async function runEventDiscoverySweep(db, { fetchImpl = fetch, catalog = [], maxSources = 2, now = new Date(), appOrigin = "https://defense-budget-intelligence.pages.dev" } = {}) {
  const stateRows = await db.prepare("SELECT * FROM dbi_event_discovery_source_state").all();
  const stateBySource = new Map((stateRows.results || []).map((row) => [row.source_id, stateFromRow(row)]));
  const sources = [...EVENT_CATALOG_SOURCE_REGISTRY]
    .map((source) => ({ source, state: stateBySource.get(source.id) || null, scheduling: sourcePriority(source, stateBySource.get(source.id), now) }))
    .filter((entry) => entry.scheduling.due)
    .sort((left, right) => right.scheduling.score - left.scheduling.score || right.source.priority - left.source.priority)
    .slice(0, Math.max(1, Math.min(8, Number(maxSources) || 2)));
  const dynamic = await dynamicEventCatalog(db);
  const knownCatalog = [...catalog, ...dynamic];
  const results = [];
  for (const { source, state } of sources) {
    const runId = crypto.randomUUID();
    const startedAt = now.toISOString();
    await db.prepare("INSERT INTO dbi_event_discovery_runs (id, source_id, source_url, status, started_at) VALUES (?, ?, ?, 'running', ?)")
      .bind(runId, source.id, source.url, startedAt).run();
    try {
      const discovery = await discoverSourceCandidates(source, { fetchImpl, state: state || {}, appOrigin });
      const candidates = discovery.candidates;
      let added = 0;
      for (const candidate of candidates) {
        const quality = eventCandidateQuality(candidate);
        const duplicate = findCatalogDuplicateMatch(candidate, knownCatalog);
        const enriched = duplicate ? { ...candidate, duplicateMatch: { catalogEventId: duplicate.event.id, reasons: duplicate.reasons, changes: duplicate.changes, baseEvent: duplicate.event } } : candidate;
        const fingerprint = await sha256(eventCandidateFingerprint(candidate, source.id));
        const id = `candidate-${fingerprint.slice(0, 24)}`;
        const evidence = candidate.sources || [];
        const candidateStatus = !quality.isLikelyEvent ? "invalid" : duplicate ? (duplicate.changes.length ? "update" : "duplicate") : "pending";
        const result = await db.prepare(`INSERT OR IGNORE INTO dbi_event_discovery_candidates
          (id, run_id, source_id, source_url, fingerprint, status, candidate_json, evidence_json, duplicate_catalog_id, discovered_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .bind(id, runId, source.id, source.url, fingerprint, candidateStatus, JSON.stringify(enriched), JSON.stringify(evidence), duplicate?.event?.id || "", startedAt).run();
        if (Number(result?.meta?.changes || 0)) added += 1;
        else await db.prepare(`UPDATE dbi_event_discovery_candidates SET run_id = ?, status = ?, candidate_json = ?, evidence_json = ?, duplicate_catalog_id = ?, discovered_at = ?
          WHERE fingerprint = ? AND status IN ('pending', 'duplicate', 'update', 'invalid')`)
          .bind(runId, candidateStatus, JSON.stringify(enriched), JSON.stringify(evidence), duplicate?.event?.id || "", startedAt, fingerprint).run();
      }
      const completedAt = new Date().toISOString();
      const runStatus = discovery.unchanged ? "unchanged" : "succeeded";
      await db.batch([
        db.prepare("UPDATE dbi_event_discovery_runs SET status = ?, candidates_seen = ?, candidates_added = ?, completed_at = ? WHERE id = ?")
          .bind(runStatus, candidates.length, added, completedAt, runId),
        db.prepare(`INSERT INTO dbi_event_discovery_source_state
          (source_id, etag, last_modified, content_hash, last_success_at, last_failure_at, consecutive_failures, candidates_seen, candidates_added, updated_at)
          VALUES (?, ?, ?, ?, ?, '', 0, ?, ?, ?)
          ON CONFLICT(source_id) DO UPDATE SET etag = excluded.etag, last_modified = excluded.last_modified, content_hash = excluded.content_hash,
            last_success_at = excluded.last_success_at, consecutive_failures = 0, candidates_seen = excluded.candidates_seen,
            candidates_added = excluded.candidates_added, updated_at = excluded.updated_at`)
          .bind(source.id, clean(discovery.response?.headers?.get("etag"), 300), clean(discovery.response?.headers?.get("last-modified"), 100), discovery.contentHash || state?.contentHash || "", completedAt, candidates.length, added, completedAt),
      ]);
      results.push({ sourceId: source.id, adapter: source.adapter, status: runStatus, seen: candidates.length, added });
    } catch (error) {
      const completedAt = new Date().toISOString();
      await db.batch([
        db.prepare("UPDATE dbi_event_discovery_runs SET status = 'failed', error_code = ?, error_message = ?, completed_at = ? WHERE id = ?")
          .bind(clean(error?.code || "source_unavailable", 80), clean(error?.message, 500), completedAt, runId),
        db.prepare(`INSERT INTO dbi_event_discovery_source_state
          (source_id, last_failure_at, consecutive_failures, updated_at) VALUES (?, ?, 1, ?)
          ON CONFLICT(source_id) DO UPDATE SET last_failure_at = excluded.last_failure_at,
            consecutive_failures = dbi_event_discovery_source_state.consecutive_failures + 1, updated_at = excluded.updated_at`)
          .bind(source.id, completedAt, completedAt),
      ]);
      results.push({ sourceId: source.id, adapter: source.adapter, status: "failed", code: clean(error?.code || "source_unavailable", 80) });
    }
  }
  return { sourcesAttempted: results.length, succeeded: results.filter((result) => ["succeeded", "unchanged"].includes(result.status)).length, results };
}

function candidateFromRow(row) {
  return row ? {
    id: row.id, runId: row.run_id, sourceId: row.source_id, sourceUrl: row.source_url, status: row.status,
    candidate: parsed(row.candidate_json, {}), evidence: parsed(row.evidence_json, []), duplicateCatalogId: row.duplicate_catalog_id || null,
    rejectionReason: row.rejection_reason || "", discoveredAt: row.discovered_at, reviewedBy: row.reviewed_by || null, reviewedAt: row.reviewed_at || null,
  } : null;
}

export async function eventDiscoverySnapshot(db, { status = "", view = "", limit = 100 } = {}) {
  const requestedView = view || (status === "pending" ? "ready" : status);
  const selectedView = ["review", "leads", "ready", "updates", "low-quality", "duplicates", "failures", "published", "rejected"].includes(requestedView) ? requestedView : "review";
  const resultLimit = Math.max(1, Math.min(200, Number(limit) || 100));
  const [pendingRows, invalidRows, updateRows, duplicateRows, reviewedRows, counts, latest, failures, stateRows, recentRuns] = await Promise.all([
    db.prepare("SELECT * FROM dbi_event_discovery_candidates WHERE status = 'pending' ORDER BY discovered_at DESC LIMIT 500").all(),
    db.prepare("SELECT * FROM dbi_event_discovery_candidates WHERE status = 'invalid' ORDER BY discovered_at DESC LIMIT 500").all(),
    db.prepare("SELECT * FROM dbi_event_discovery_candidates WHERE status = 'update' ORDER BY discovered_at DESC LIMIT 500").all(),
    db.prepare("SELECT * FROM dbi_event_discovery_candidates WHERE status = 'duplicate' ORDER BY discovered_at DESC LIMIT 500").all(),
    ["published", "rejected"].includes(selectedView) ? db.prepare("SELECT * FROM dbi_event_discovery_candidates WHERE status = ? ORDER BY discovered_at DESC LIMIT ?").bind(selectedView, resultLimit).all() : Promise.resolve({ results: [] }),
    db.prepare("SELECT status, COUNT(*) AS count FROM dbi_event_discovery_candidates GROUP BY status").all(),
    db.prepare("SELECT * FROM dbi_event_discovery_runs ORDER BY started_at DESC LIMIT 1").first(),
    db.prepare("SELECT * FROM dbi_event_discovery_runs WHERE status = 'failed' ORDER BY started_at DESC LIMIT ?").bind(resultLimit).all(),
    db.prepare("SELECT * FROM dbi_event_discovery_source_state").all(),
    db.prepare("SELECT * FROM dbi_event_discovery_runs ORDER BY started_at DESC LIMIT 50").all(),
  ]);
  const annotate = (row) => { const entry = candidateFromRow(row); return { ...entry, quality: eventCandidateQuality(entry.candidate) }; };
  const pending = (pendingRows.results || []).map(annotate);
  const invalid = (invalidRows.results || []).map(annotate);
  const updates = (updateRows.results || []).map(annotate);
  const duplicates = (duplicateRows.results || []).map(annotate);
  const likelyPending = pending.filter((entry) => entry.quality.isLikelyEvent);
  const lowQuality = [...invalid, ...pending.filter((entry) => !entry.quality.isLikelyEvent)].sort((left, right) => String(right.discoveredAt).localeCompare(String(left.discoveredAt)));
  const candidateRows = selectedView === "review" ? [...likelyPending, ...updates].sort((left, right) => String(right.discoveredAt).localeCompare(String(left.discoveredAt))).slice(0, resultLimit)
    : selectedView === "leads" ? likelyPending.filter((entry) => !entry.candidate.startsAt).slice(0, resultLimit)
      : selectedView === "ready" ? likelyPending.filter((entry) => entry.candidate.startsAt).slice(0, resultLimit)
        : selectedView === "updates" ? updates.slice(0, resultLimit)
          : selectedView === "low-quality" ? lowQuality.slice(0, resultLimit)
            : selectedView === "duplicates" ? duplicates.slice(0, resultLimit)
              : (reviewedRows.results || []).map(annotate);
  const countMap = Object.fromEntries((counts.results || []).map((row) => [row.status, Number(row.count || 0)]));
  countMap.leads = likelyPending.filter((entry) => !entry.candidate.startsAt).length;
  countMap.ready = likelyPending.filter((entry) => entry.candidate.startsAt).length;
  countMap.updates = Number(countMap.update || 0);
  countMap.duplicates = Number(countMap.duplicate || 0);
  countMap.lowQuality = lowQuality.length;
  countMap.review = countMap.leads + countMap.ready + countMap.updates;
  countMap.reviewed = Number(countMap.published || 0) + Number(countMap.rejected || 0);
  countMap.failures = (failures.results || []).length;
  const sourceState = new Map((stateRows.results || []).map((row) => [row.source_id, stateFromRow(row)]));
  return {
    view: selectedView,
    candidates: selectedView === "failures" ? [] : candidateRows,
    failures: selectedView === "failures" ? (failures.results || []).map((row) => ({ id: row.id, sourceId: row.source_id, sourceUrl: row.source_url, errorCode: row.error_code || "source_unavailable", errorMessage: row.error_message || "Source scan failed", startedAt: row.started_at, completedAt: row.completed_at || null })) : [],
    counts: countMap,
    latestRun: latest ? { id: latest.id, sourceId: latest.source_id, status: latest.status, candidatesSeen: Number(latest.candidates_seen || 0), candidatesAdded: Number(latest.candidates_added || 0), errorCode: latest.error_code || null, startedAt: latest.started_at, completedAt: latest.completed_at || null } : null,
    runs: (recentRuns.results || []).map((row) => ({ id: row.id, sourceId: row.source_id, sourceUrl: row.source_url, status: row.status, candidatesSeen: Number(row.candidates_seen || 0), candidatesAdded: Number(row.candidates_added || 0), errorCode: row.error_code || null, errorMessage: row.error_message || "", startedAt: row.started_at, completedAt: row.completed_at || null })),
    sources: EVENT_CATALOG_SOURCE_REGISTRY.map(({ id, name, url, adapter, branch, priority, cadenceHours, maxDetailPages }) => ({ id, name, url, adapter, branch, priority, cadenceHours, maxDetailPages, health: sourceState.get(id) || null })),
  };
}

function mergeCandidateWithBase(candidate) {
  const base = candidate?.duplicateMatch?.baseEvent || {};
  const proposed = Object.fromEntries(Object.entries(candidate || {}).filter(([key, value]) => key !== "duplicateMatch" && value !== "" && value !== null && value !== undefined && (!Array.isArray(value) || value.length)));
  return { ...base, ...proposed };
}

export function applyCuratorCandidate(candidate, override = {}) {
  const result = { ...candidate };
  const textFields = { title: 180, summary: 1600, timezone: 80, location: 500, venue: 240, city: 120, region: 80, country: 120, format: 40, eventType: 80, branch: 120, sponsor: 180 };
  for (const [field, limit] of Object.entries(textFields)) {
    if (Object.hasOwn(override, field)) result[field] = clean(override[field], limit);
  }
  for (const field of ["startsAt", "endsAt"]) {
    if (Object.hasOwn(override, field)) result[field] = dateValue(override[field]);
  }
  if (Array.isArray(override.topics)) result.topics = override.topics.map((item) => clean(item, 120)).filter(Boolean).slice(0, 20);
  if (Object.hasOwn(override, "officialUrl")) {
    const officialUrl = canonicalUrl(override.officialUrl);
    if (officialUrl) {
      const source = safeArray(candidate.sources)[0] || {};
      result.links = [{ label: "Official event", url: officialUrl }, ...safeArray(candidate.links).filter((link) => canonicalUrl(link?.url) !== officialUrl)].slice(0, 12);
      result.sources = [{ ...source, title: result.title || source.title, url: officialUrl, kind: "official", lastVerifiedAt: new Date().toISOString().slice(0, 10) }, ...safeArray(candidate.sources).slice(1)].slice(0, 12);
    }
  }
  return result;
}

export async function reviewEventCandidate(db, candidateId, { decision, reviewerId, reason = "", candidate: candidateOverride = {} } = {}) {
  const row = await db.prepare("SELECT * FROM dbi_event_discovery_candidates WHERE id = ?").bind(clean(candidateId, 100)).first();
  if (!row) return { error: "not_found" };
  if (!["pending", "update", "invalid"].includes(row.status)) return { error: "already_reviewed", candidate: candidateFromRow(row) };
  const now = new Date().toISOString();
  if (decision === "reject") {
    await db.prepare("UPDATE dbi_event_discovery_candidates SET status = 'rejected', rejection_reason = ?, reviewed_by = ?, reviewed_at = ? WHERE id = ?")
      .bind(clean(reason, 500), clean(reviewerId, 100), now, row.id).run();
    return { candidate: candidateFromRow({ ...row, status: "rejected", rejection_reason: clean(reason, 500), reviewed_by: reviewerId, reviewed_at: now }) };
  }
  if (decision !== "publish") return { error: "invalid_decision" };
  const rawCandidate = parsed(row.candidate_json, {});
  const reviewedCandidate = applyCuratorCandidate(rawCandidate, candidateOverride);
  const candidate = mergeCandidateWithBase(reviewedCandidate);
  if (!candidate.title || !candidate.startsAt || !safeArray(reviewedCandidate.sources).some((source) => httpUrl(source?.url))) return { error: "insufficient_evidence" };
  if (candidate.endsAt && Date.parse(candidate.endsAt) < Date.parse(candidate.startsAt)) return { error: "invalid_dates" };
  const year = candidate.startsAt.slice(0, 4);
  const id = row.status === "update" && row.duplicate_catalog_id ? row.duplicate_catalog_id : `catalog-${slug(candidate.seriesId || candidate.title)}-${year}`;
  const existing = await db.prepare("SELECT revision FROM dbi_event_catalog_entries WHERE id = ?").bind(id).first();
  const baseRevision = Number(reviewedCandidate?.duplicateMatch?.baseEvent?.revision || 0);
  const event = { ...candidate, id, revision: Math.max(Number(existing?.revision || 0), baseRevision) + 1, status: candidate.status === "cancelled" ? "cancelled" : "upcoming", caveats: safeArray(candidate.caveats).filter((item) => !String(item).includes("curator must") && !String(item).includes("still require verification")) };
  await db.batch([
    db.prepare(`INSERT INTO dbi_event_catalog_entries (id, series_id, revision, status, event_json, source_candidate_id, published_by, published_at, updated_at)
      VALUES (?, ?, ?, 'published', ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET revision = excluded.revision, status = 'published', event_json = excluded.event_json, source_candidate_id = excluded.source_candidate_id, published_by = excluded.published_by, updated_at = excluded.updated_at`)
      .bind(id, clean(event.seriesId, 120), event.revision, JSON.stringify(event), row.id, clean(reviewerId, 100), now, now),
    db.prepare("UPDATE dbi_event_discovery_candidates SET status = 'published', candidate_json = ?, reviewed_by = ?, reviewed_at = ? WHERE id = ?").bind(JSON.stringify(reviewedCandidate), clean(reviewerId, 100), now, row.id),
  ]);
  return { event, candidate: candidateFromRow({ ...row, status: "published", candidate_json: JSON.stringify(reviewedCandidate), reviewed_by: reviewerId, reviewed_at: now }) };
}
