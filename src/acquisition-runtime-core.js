import { classifyTechnologyAreas, organizationHierarchy } from "./procurement-taxonomy.js";

const DAY_MS = 86_400_000;

export const ACQUISITION_SOURCE = "sam_gov";
export const SAM_NOTICE_TYPES = Object.freeze(["p", "a", "r", "s", "o", "g", "k", "i", "u"]);
export const DEFAULT_ACQUISITION_CONFIG = Object.freeze({
  enabled: true,
  cadenceHours: 24,
  initialLookbackDays: 14,
  incrementalLookbackDays: 3,
  pageSize: 1000,
  maxPages: 10,
  requestIntervalMs: 1000,
  maxRetries: 3,
  organizationName: "DEPT OF DEFENSE",
  noticeTypes: [],
});

function text(value, limit = 500) {
  return String(value || "").trim().slice(0, limit);
}

function integer(value, fallback, minimum, maximum) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(maximum, Math.max(minimum, Math.trunc(parsed))) : fallback;
}

export function normalizeAcquisitionConfig(input = {}) {
  const noticeTypes = Array.isArray(input.noticeTypes)
    ? [...new Set(input.noticeTypes.map((value) => text(value, 1).toLowerCase()).filter((value) => SAM_NOTICE_TYPES.includes(value)))]
    : [];
  return {
    enabled: input.enabled === undefined ? DEFAULT_ACQUISITION_CONFIG.enabled : Boolean(input.enabled),
    cadenceHours: integer(input.cadenceHours, DEFAULT_ACQUISITION_CONFIG.cadenceHours, 6, 168),
    initialLookbackDays: integer(input.initialLookbackDays, DEFAULT_ACQUISITION_CONFIG.initialLookbackDays, 1, 365),
    incrementalLookbackDays: integer(input.incrementalLookbackDays, DEFAULT_ACQUISITION_CONFIG.incrementalLookbackDays, 1, 30),
    pageSize: integer(input.pageSize, DEFAULT_ACQUISITION_CONFIG.pageSize, 10, 1000),
    maxPages: integer(input.maxPages, DEFAULT_ACQUISITION_CONFIG.maxPages, 1, 25),
    requestIntervalMs: integer(input.requestIntervalMs, DEFAULT_ACQUISITION_CONFIG.requestIntervalMs, 250, 10_000),
    maxRetries: integer(input.maxRetries, DEFAULT_ACQUISITION_CONFIG.maxRetries, 0, 6),
    organizationName: text(input.organizationName, 240) || DEFAULT_ACQUISITION_CONFIG.organizationName,
    noticeTypes,
  };
}

export function acquisitionNextDueAt(lastCompletedAt, configInput = {}) {
  const completed = Date.parse(lastCompletedAt || "");
  if (!Number.isFinite(completed)) return null;
  const config = normalizeAcquisitionConfig(configInput);
  return new Date(completed + config.cadenceHours * 3_600_000).toISOString();
}

function dateOnly(value) {
  const raw = text(value, 80);
  return raw ? raw.slice(0, 10) : null;
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
  }
  return value ?? null;
}

export function stableJson(value) {
  return JSON.stringify(stableValue(value));
}

export async function sha256(value) {
  const bytes = new TextEncoder().encode(String(value || ""));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function normalizeSamOpportunity(row = {}) {
  const noticeId = text(row.noticeId, 180);
  if (!noticeId) return null;
  const solicitationNumber = text(row.solicitationNumber, 180) || null;
  const active = row.active === "Yes" || row.active === true;
  const organization = organizationHierarchy(row);
  const technologyAreas = classifyTechnologyAreas(row);
  return {
    sourceSystem: "SAM.gov",
    sourceRecordId: noticeId,
    noticeId,
    solicitationNumber,
    title: text(row.title, 500) || "Untitled opportunity",
    description: text(row.description || row.additionalInfoLink, 8_000),
    noticeType: text(row.type || row.baseType, 160) || null,
    postedDate: dateOnly(row.postedDate),
    sourceUpdatedAt: text(row.modifiedDate || row.lastModifiedDate || row.updatedDate, 80) || null,
    responseDeadline: dateOnly(row.responseDeadLine || row.archiveDate),
    archiveDate: dateOnly(row.archiveDate),
    naicsCode: text(row.naicsCode, 40) || null,
    pscCode: text(row.classificationCode, 40) || null,
    setAside: text(row.typeOfSetAsideDescription || row.typeOfSetAside, 240) || null,
    department: text(row.department, 240) || null,
    subTier: text(row.subTier, 240) || null,
    office: text(row.office, 320) || null,
    organizationPath: text(row.fullParentPathName, 1_000) || null,
    organization,
    technologyAreas,
    placeOfPerformance: row.placeOfPerformance && typeof row.placeOfPerformance === "object"
      ? stableValue(row.placeOfPerformance)
      : text(row.placeOfPerformance, 1_000) || null,
    lifecycleStage: /award/i.test(text(row.type || row.baseType, 160)) ? "award" : active ? "opportunity" : "archived",
    active,
    sourceUrl: text(row.uiLink, 1_000) || `https://sam.gov/opp/${encodeURIComponent(noticeId)}/view`,
  };
}

const SAVED_VIEW_FILTERS = Object.freeze({
  technology: 120,
  branch: 160,
  component: 240,
  office: 320,
  disposition: 40,
  changes: 40,
  lifecycle: 80,
  naics: 40,
  psc: 40,
});

export function normalizeSavedAcquisitionView(input = {}) {
  const filters = {};
  for (const [key, limit] of Object.entries(SAVED_VIEW_FILTERS)) {
    const value = text(input?.filters?.[key], limit);
    if (value) filters[key] = value;
  }
  return {
    query: text(input?.query, 500),
    filters,
  };
}

export function changedFields(previous = {}, current = {}) {
  const labels = {
    title: "Title",
    description: "Description",
    noticeType: "Notice type",
    responseDeadline: "Response deadline",
    archiveDate: "Archive date",
    naicsCode: "NAICS",
    pscCode: "PSC",
    setAside: "Set-aside",
    department: "Department",
    subTier: "Component",
    office: "Buying office",
    organizationPath: "Organization hierarchy",
    placeOfPerformance: "Place of performance",
    active: "Active status",
    sourceUpdatedAt: "Source updated",
  };
  return Object.entries(labels).flatMap(([key, label]) => {
    const before = stableJson(previous[key]);
    const after = stableJson(current[key]);
    return before === after ? [] : [{ key, label, before: previous[key] ?? null, after: current[key] ?? null }];
  });
}

export function samQueryWindow({ lastCompletedAt, now = new Date(), config: configInput } = {}) {
  const config = normalizeAcquisitionConfig(configInput);
  const completed = Date.parse(lastCompletedAt || "");
  const lookbackDays = Number.isFinite(completed) ? config.incrementalLookbackDays : config.initialLookbackDays;
  const start = new Date(now.getTime() - lookbackDays * DAY_MS);
  const mmddyyyy = (value) => `${String(value.getUTCMonth() + 1).padStart(2, "0")}/${String(value.getUTCDate()).padStart(2, "0")}/${value.getUTCFullYear()}`;
  return { postedFrom: mmddyyyy(start), postedTo: mmddyyyy(now), lookbackDays };
}

function retryDelay(response, attempt, minimum) {
  const rawRetryAfter = response?.headers?.get?.("retry-after");
  const retryAfter = rawRetryAfter === null || rawRetryAfter === undefined ? Number.NaN : Number(rawRetryAfter);
  if (Number.isFinite(retryAfter) && retryAfter >= 0) return Math.min(60_000, Math.max(minimum, retryAfter * 1000));
  return Math.min(30_000, Math.max(minimum, 500 * (2 ** attempt))) + Math.floor(Math.random() * 250);
}

export async function fetchSamOpportunities({ apiKey, lastCompletedAt, fetchImpl = fetch, config: configInput, sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)) } = {}) {
  const key = text(apiKey, 200);
  if (!key) throw Object.assign(new Error("A workspace SAM.gov API key is required"), { code: "credential_unavailable" });
  const config = normalizeAcquisitionConfig(configInput);
  const window = samQueryWindow({ lastCompletedAt, config });
  const records = [];
  const limit = config.pageSize;
  let totalRecords = 0;
  let pages = 0;
  let requests = 0;
  let retries = 0;
  let throttleWaitMs = 0;
  const noticeTypeScopes = config.noticeTypes.length ? config.noticeTypes : [""];
  for (const noticeType of noticeTypeScopes) {
    let offset = 0;
    let scopeTotal = null;
    while (pages < config.maxPages) {
      if (pages > 0 && config.requestIntervalMs) await sleep(config.requestIntervalMs);
      const url = new URL("https://api.sam.gov/opportunities/v2/search");
      url.searchParams.set("postedFrom", window.postedFrom);
      url.searchParams.set("postedTo", window.postedTo);
      if (config.organizationName) url.searchParams.set("organizationName", config.organizationName);
      if (noticeType) url.searchParams.set("ptype", noticeType);
      url.searchParams.set("limit", String(limit));
      url.searchParams.set("offset", String(offset));
      let response;
      let error;
      for (let attempt = 0; attempt <= config.maxRetries; attempt += 1) {
        try {
          requests += 1;
          response = await fetchImpl(url, { headers: { accept: "application/json", "user-agent": "defense-budget-intelligence/1.0", "x-api-key": key } });
          if (response.ok || ![429, 500, 502, 503, 504].includes(response.status)) break;
          error = new Error(`SAM.gov opportunity search returned ${response.status}`);
        } catch (requestError) { error = requestError; }
        if (attempt >= config.maxRetries) break;
        retries += 1;
        const delay = retryDelay(response, attempt, config.requestIntervalMs);
        throttleWaitMs += delay;
        await sleep(delay);
      }
      if (!response?.ok) throw Object.assign(error || new Error(`SAM.gov opportunity search returned ${response?.status || "no response"}`), { code: response?.status === 429 ? "rate_limited" : "source_unavailable" });
      const payload = await response.json();
      const rows = Array.isArray(payload.opportunitiesData) ? payload.opportunitiesData : [];
      scopeTotal = Number(payload.totalRecords || scopeTotal || 0);
      records.push(...rows.map(normalizeSamOpportunity).filter(Boolean));
      pages += 1;
      offset += rows.length;
      if (!rows.length || offset >= scopeTotal) break;
    }
    if (scopeTotal === null) throw Object.assign(new Error(`SAM.gov notice-type scope exceeded the bounded ${config.maxPages}-page request budget; no partial refresh was applied`), { code: "source_truncated" });
    totalRecords += Number(scopeTotal || 0);
    if (scopeTotal !== null && offset < scopeTotal) throw Object.assign(new Error(`SAM.gov returned more than the bounded ${config.maxPages * limit} record window; no partial refresh was applied`), { code: "source_truncated" });
  }
  return {
    records: [...new Map(records.map((record) => [record.sourceRecordId, record])).values()],
    metadata: { ...window, pages, requests, retries, throttleWaitMs, totalRecords: Number(totalRecords || records.length), noticeTypesQueried: config.noticeTypes, complete: true, config },
  };
}

export function exactLifecycleLinks(records = []) {
  const source = (record) => {
    const value = text(record.source || record.sourceSystem, 80).toLowerCase();
    if (value.includes("sam")) return ACQUISITION_SOURCE;
    if (value.includes("usaspending")) return "usaspending";
    return value.replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") || ACQUISITION_SOURCE;
  };
  const id = (record) => text(record.sourceRecordId || record.noticeId || record.id || record.awardId || record.piid, 240);
  const groups = new Map();
  records.forEach((record) => {
    const identifier = text(record.solicitationNumber, 180).toUpperCase();
    if (!identifier || !id(record)) return;
    groups.set(identifier, [...(groups.get(identifier) || []), record]);
  });
  return [...groups.entries()].flatMap(([identifier, rows]) => {
    if (rows.length < 2) return [];
    const ordered = [...rows].sort((left, right) => String(left.postedDate || left.sourceUpdatedAt || "").localeCompare(String(right.postedDate || right.sourceUpdatedAt || "")));
    return ordered.slice(1).map((record, index) => ({
      fromSource: source(ordered[index]),
      fromId: id(ordered[index]),
      toSource: source(record),
      toId: id(record),
      relationship: record.lifecycleStage === "award" || source(record) === "usaspending" ? "resulted_in_award" : "same_solicitation",
      basis: "solicitation_number",
      identifier,
    }));
  });
}

export function matchesSavedAcquisitionView(record = {}, spec = {}) {
  const normalized = normalizeSavedAcquisitionView(spec);
  const filters = normalized.filters;
  const query = normalized.query.toLowerCase();
  const organization = record.organization || organizationHierarchy(record);
  const technologyAreas = record.technologyAreas || classifyTechnologyAreas(record);
  const searchable = [record.title, record.noticeId, record.solicitationNumber, record.department, record.subTier, record.office, record.naicsCode, record.pscCode].filter(Boolean).join(" ").toLowerCase();
  return (!query || searchable.includes(query))
    && (!filters.technology || filters.technology === "all" || technologyAreas.includes(filters.technology))
    && (!filters.branch || filters.branch === "all" || organization.branch === filters.branch)
    && (!filters.component || filters.component === "all" || organization.component === filters.component)
    && (!filters.office || filters.office === "all" || organization.office === filters.office)
    && (!filters.lifecycle || filters.lifecycle === "all" || record.lifecycleStage === filters.lifecycle)
    && (!filters.naics || filters.naics === "all" || record.naicsCode === filters.naics)
    && (!filters.psc || filters.psc === "all" || record.pscCode === filters.psc);
}
