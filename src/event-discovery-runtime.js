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

export function extractOfficialEventCandidates(html, source) {
  const scripts = [...String(html || "").matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  const candidates = [];
  for (const match of scripts) {
    const root = parsed(match[1].replace(/^\s*<!--|-->\s*$/g, ""), null);
    for (const node of jsonLdNodes(root)) {
      const types = safeArray(node?.["@type"]).map((item) => clean(item, 80).toLowerCase());
      if (!types.some((type) => type === "event" || type.endsWith("event"))) continue;
      const title = clean(node.name || node.headline, 180);
      const startsAt = dateValue(node.startDate);
      if (title.length < 3 || !startsAt) continue;
      const endsAt = dateValue(node.endDate);
      const officialUrl = httpUrl(node.url, source.url) || source.url;
      const location = locationValue(node.location);
      const eventStatus = clean(node.eventStatus, 180).toLowerCase();
      const attendanceMode = clean(node.eventAttendanceMode, 180).toLowerCase();
      candidates.push({
        title,
        seriesId: slug(title.replace(/\b20\d{2}\b/g, "")),
        summary: clean(node.description, 1600),
        startsAt,
        endsAt,
        timezone: "",
        location,
        venue: typeof node.location === "object" ? clean(node.location?.name, 240) : "",
        city: typeof node.location === "object" ? clean(node.location?.address?.addressLocality, 120) : "",
        region: typeof node.location === "object" ? clean(node.location?.address?.addressRegion, 80) : "",
        country: typeof node.location === "object" ? clean(node.location?.address?.addressCountry, 120) : "",
        format: attendanceMode.includes("online") && attendanceMode.includes("mixed") ? "hybrid" : attendanceMode.includes("online") ? "virtual" : "in_person",
        eventType: "event",
        branch: source.branch || "Joint",
        sponsor: clean(node.organizer?.name || source.name, 180),
        status: eventStatus.includes("cancel") ? "cancelled" : "discovered",
        confidence: "medium",
        lastVerifiedAt: new Date().toISOString().slice(0, 10),
        topics: safeArray(node.keywords).flatMap((item) => String(item || "").split(",")).map((item) => clean(item, 120)).filter(Boolean).slice(0, 20),
        capabilityAreas: [], missionThreads: [], stakeholders: [], keywords: [], milestones: [],
        links: [{ label: "Official event", url: officialUrl }],
        sources: [{ title, publisher: source.name, url: officialUrl, kind: "official", confidence: "medium", lastVerifiedAt: new Date().toISOString().slice(0, 10) }],
        caveats: ["Discovered from official structured data. A curator must verify and publish this edition."],
      });
    }
  }
  const seen = new Set();
  return candidates.filter((candidate) => {
    const key = `${candidate.title.toLowerCase()}|${candidate.startsAt.slice(0, 10)}`;
    return !seen.has(key) && seen.add(key);
  });
}

export function eventCandidateFingerprint(candidate, sourceId = "") {
  return [sourceId, clean(candidate?.title, 180).toLowerCase(), clean(candidate?.startsAt, 10)].join("|");
}

function catalogIdentity(event) {
  return `${slug(event?.seriesId || String(event?.title || "").replace(/\b20\d{2}\b/g, ""))}|${clean(event?.startsAt, 10)}`;
}

export function findCatalogDuplicate(candidate, catalog = []) {
  const identity = catalogIdentity(candidate);
  const candidateDate = clean(candidate?.startsAt, 10);
  const candidateUrls = new Set(safeArray(candidate?.sources).map((source) => httpUrl(source?.url)).filter(Boolean));
  return catalog.find((event) => {
    if (catalogIdentity(event) === identity) return true;
    if (candidateDate && clean(event?.startsAt, 10) !== candidateDate) return false;
    return safeArray(event?.sources).some((source) => candidateUrls.has(httpUrl(source?.url)));
  }) || null;
}

export async function dynamicEventCatalog(db) {
  const result = await db.prepare("SELECT event_json FROM dbi_event_catalog_entries WHERE status = 'published' ORDER BY updated_at DESC").all();
  return (result.results || []).map((row) => parsed(row.event_json, null)).filter(Boolean);
}

export async function runEventDiscoverySweep(db, { fetchImpl = fetch, catalog = [], maxSources = 2, now = new Date() } = {}) {
  const latest = await db.prepare("SELECT source_id, MAX(started_at) AS last_started_at FROM dbi_event_discovery_runs GROUP BY source_id").all();
  const lastBySource = new Map((latest.results || []).map((row) => [row.source_id, row.last_started_at]));
  const sources = [...EVENT_CATALOG_SOURCE_REGISTRY]
    .filter((source) => source.id !== "sam")
    .sort((left, right) => String(lastBySource.get(left.id) || "").localeCompare(String(lastBySource.get(right.id) || "")) || right.priority - left.priority)
    .slice(0, Math.max(1, Math.min(5, Number(maxSources) || 2)));
  const dynamic = await dynamicEventCatalog(db);
  const knownCatalog = [...catalog, ...dynamic];
  const results = [];
  for (const source of sources) {
    const runId = crypto.randomUUID();
    const startedAt = now.toISOString();
    await db.prepare("INSERT INTO dbi_event_discovery_runs (id, source_id, source_url, status, started_at) VALUES (?, ?, ?, 'running', ?)")
      .bind(runId, source.id, source.url, startedAt).run();
    try {
      const response = await fetchImpl(source.url, { headers: { accept: "text/html,application/xhtml+xml", "user-agent": "DefenseBudgetIntelligence-EventDiscovery/1.0" } });
      if (!response.ok) throw Object.assign(new Error(`Official source returned ${response.status}`), { code: "source_http_error" });
      const html = (await response.text()).slice(0, 2_000_000);
      const candidates = extractOfficialEventCandidates(html, source);
      let added = 0;
      for (const candidate of candidates) {
        const duplicate = findCatalogDuplicate(candidate, knownCatalog);
        const fingerprint = await sha256(eventCandidateFingerprint(candidate, source.id));
        const id = `candidate-${fingerprint.slice(0, 24)}`;
        const evidence = candidate.sources || [];
        const result = await db.prepare(`INSERT OR IGNORE INTO dbi_event_discovery_candidates
          (id, run_id, source_id, source_url, fingerprint, status, candidate_json, evidence_json, duplicate_catalog_id, discovered_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .bind(id, runId, source.id, source.url, fingerprint, duplicate ? "duplicate" : "pending", JSON.stringify(candidate), JSON.stringify(evidence), duplicate?.id || "", startedAt).run();
        if (Number(result?.meta?.changes || 0)) added += 1;
      }
      await db.prepare("UPDATE dbi_event_discovery_runs SET status = 'succeeded', candidates_seen = ?, candidates_added = ?, completed_at = ? WHERE id = ?")
        .bind(candidates.length, added, new Date().toISOString(), runId).run();
      results.push({ sourceId: source.id, status: "succeeded", seen: candidates.length, added });
    } catch (error) {
      await db.prepare("UPDATE dbi_event_discovery_runs SET status = 'failed', error_code = ?, error_message = ?, completed_at = ? WHERE id = ?")
        .bind(clean(error?.code || "source_unavailable", 80), clean(error?.message, 500), new Date().toISOString(), runId).run();
      results.push({ sourceId: source.id, status: "failed", code: clean(error?.code || "source_unavailable", 80) });
    }
  }
  return { sourcesAttempted: results.length, succeeded: results.filter((result) => result.status === "succeeded").length, results };
}

function candidateFromRow(row) {
  return row ? {
    id: row.id, runId: row.run_id, sourceId: row.source_id, sourceUrl: row.source_url, status: row.status,
    candidate: parsed(row.candidate_json, {}), evidence: parsed(row.evidence_json, []), duplicateCatalogId: row.duplicate_catalog_id || null,
    rejectionReason: row.rejection_reason || "", discoveredAt: row.discovered_at, reviewedBy: row.reviewed_by || null, reviewedAt: row.reviewed_at || null,
  } : null;
}

export async function eventDiscoverySnapshot(db, { status = "pending", limit = 100 } = {}) {
  const safeStatus = ["pending", "published", "rejected", "duplicate"].includes(status) ? status : "pending";
  const [rows, counts, latest] = await Promise.all([
    db.prepare("SELECT * FROM dbi_event_discovery_candidates WHERE status = ? ORDER BY discovered_at DESC LIMIT ?").bind(safeStatus, Math.max(1, Math.min(200, Number(limit) || 100))).all(),
    db.prepare("SELECT status, COUNT(*) AS count FROM dbi_event_discovery_candidates GROUP BY status").all(),
    db.prepare("SELECT * FROM dbi_event_discovery_runs ORDER BY started_at DESC LIMIT 1").first(),
  ]);
  return {
    candidates: (rows.results || []).map(candidateFromRow),
    counts: Object.fromEntries((counts.results || []).map((row) => [row.status, Number(row.count || 0)])),
    latestRun: latest ? { id: latest.id, sourceId: latest.source_id, status: latest.status, candidatesSeen: Number(latest.candidates_seen || 0), candidatesAdded: Number(latest.candidates_added || 0), errorCode: latest.error_code || null, startedAt: latest.started_at, completedAt: latest.completed_at || null } : null,
    sources: EVENT_CATALOG_SOURCE_REGISTRY.map(({ id, name, url, branch, priority }) => ({ id, name, url, branch, priority })),
  };
}

export async function reviewEventCandidate(db, candidateId, { decision, reviewerId, reason = "" } = {}) {
  const row = await db.prepare("SELECT * FROM dbi_event_discovery_candidates WHERE id = ?").bind(clean(candidateId, 100)).first();
  if (!row) return { error: "not_found" };
  if (row.status !== "pending") return { error: "already_reviewed", candidate: candidateFromRow(row) };
  const now = new Date().toISOString();
  if (decision === "reject") {
    await db.prepare("UPDATE dbi_event_discovery_candidates SET status = 'rejected', rejection_reason = ?, reviewed_by = ?, reviewed_at = ? WHERE id = ?")
      .bind(clean(reason, 500), clean(reviewerId, 100), now, row.id).run();
    return { candidate: candidateFromRow({ ...row, status: "rejected", rejection_reason: clean(reason, 500), reviewed_by: reviewerId, reviewed_at: now }) };
  }
  if (decision !== "publish") return { error: "invalid_decision" };
  const candidate = parsed(row.candidate_json, {});
  if (!candidate.title || !candidate.startsAt || !safeArray(candidate.sources).some((source) => httpUrl(source?.url))) return { error: "insufficient_evidence" };
  const year = candidate.startsAt.slice(0, 4);
  const id = `catalog-${slug(candidate.seriesId || candidate.title)}-${year}`;
  const existing = await db.prepare("SELECT revision FROM dbi_event_catalog_entries WHERE id = ?").bind(id).first();
  const event = { ...candidate, id, revision: Number(existing?.revision || 0) + 1, status: candidate.status === "cancelled" ? "cancelled" : "upcoming", caveats: safeArray(candidate.caveats).filter((item) => !String(item).includes("curator must")) };
  await db.batch([
    db.prepare(`INSERT INTO dbi_event_catalog_entries (id, series_id, revision, status, event_json, source_candidate_id, published_by, published_at, updated_at)
      VALUES (?, ?, ?, 'published', ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET revision = excluded.revision, status = 'published', event_json = excluded.event_json, source_candidate_id = excluded.source_candidate_id, published_by = excluded.published_by, updated_at = excluded.updated_at`)
      .bind(id, clean(event.seriesId, 120), event.revision, JSON.stringify(event), row.id, clean(reviewerId, 100), now, now),
    db.prepare("UPDATE dbi_event_discovery_candidates SET status = 'published', reviewed_by = ?, reviewed_at = ? WHERE id = ?").bind(clean(reviewerId, 100), now, row.id),
  ]);
  return { event, candidate: candidateFromRow({ ...row, status: "published", reviewed_by: reviewerId, reviewed_at: now }) };
}
