const PORTFOLIO_SOURCE = "navy-acquisition-intelligence";

function scriptJson(html, id) {
  const expression = new RegExp(`<script[^>]*\\bid=["']${id}["'][^>]*>([\\s\\S]*?)<\\/script>`, "i");
  const match = String(html || "").match(expression);
  if (!match) throw new Error(`The acquisition portfolio is missing ${id}.`);
  try { return JSON.parse(match[1]); }
  catch { throw new Error(`The acquisition portfolio contains invalid ${id} JSON.`); }
}

function optionalScriptJson(html, id) {
  try { return scriptJson(html, id); } catch { return null; }
}

function unique(values) { return [...new Set(values.filter(Boolean))]; }

function numericValue(value) {
  const text = String(value || "").replaceAll(",", "").toUpperCase();
  const matches = [...text.matchAll(/\$?([0-9]+(?:\.[0-9]+)?)\s*([KMB])?/g)];
  const scale = { K: 1_000, M: 1_000_000, B: 1_000_000_000 };
  const amounts = matches.map((match) => Number(match[1]) * (scale[match[2]] || 1)).filter(Number.isFinite);
  return { low: amounts[0] || null, high: amounts.at(-1) || amounts[0] || null };
}

function normalizedEvent(event, row, index, sourceUrl) {
  const start = event.start || event.date || String(event.timestamp || "").slice(0, 10) || null;
  return {
    eventId: event.eventId || `${PORTFOLIO_SOURCE}_${row.id}_${index}`,
    kind: event.kind || event.type || "portfolio-event",
    start,
    end: event.end || start,
    precision: event.precision || (event.timestamp ? "timestamp" : "day"),
    label: event.label || event.title || event.type || "Published acquisition event",
    sourceUrl: event.url || event.sourceUrl || sourceUrl || null,
    isForecast: String(event.evidence || event.status || "").toLowerCase().includes("forecast"),
    isVerified: String(event.evidence || "").toLowerCase().includes("checked"),
    status: event.status || event.evidence || null,
    exactTimestamp: event.timestamp || event.exactTimestamp || null,
    sourceReference: event.reference || event.sourceReference || null,
    limits: event.limits || null,
  };
}

function forecastEvent(row, kind, timing, sourceUrl) {
  if (!timing?.lo && !timing?.hi) return null;
  return {
    eventId: `${PORTFOLIO_SOURCE}_${row.id}_${kind}`,
    kind,
    start: timing.lo || timing.hi,
    end: timing.hi || timing.lo,
    precision: timing.precision || "day",
    label: kind === "forecast-rfp" ? `Forecast RFP · ${timing.label || timing.raw || "published window"}` : `Forecast award · ${timing.label || timing.raw || "published window"}`,
    sourceUrl,
    isForecast: true,
    isVerified: false,
    status: row.timingStatus || "Forecast estimate",
  };
}

export function normalizeAcquisitionPortfolioRecord(row, metadata = {}) {
  if (!row?.id || !row?.title) throw new Error("Every acquisition record requires an id and title.");
  const source = (metadata.sources || []).find((candidate) => candidate.id === row.source) || {};
  const sourceUrls = unique([
    source.url,
    ...(row.intelligenceURLs || []),
    ...(row.intelligence || []).map((item) => item.url),
    ...(row.lineage || []).map((item) => item.url),
    ...(row.events || []).map((item) => item.url || item.sourceUrl),
  ]);
  const sourceUrl = sourceUrls[0] || null;
  const importedEvents = (row.events || []).map((event, index) => normalizedEvent(event, row, index, sourceUrl));
  const events = [
    forecastEvent(row, "forecast-rfp", row.rfpTime, sourceUrl),
    forecastEvent(row, "forecast-award", row.awardTime, sourceUrl),
    ...importedEvents,
  ].filter(Boolean);
  const value = numericValue(row.value);
  const sourceRecordId = String(row.id);
  return {
    recordKind: "acquisition-portfolio",
    portfolioImportId: metadata.importId || null,
    portfolioAsOf: metadata.asof || null,
    opportunityId: `${PORTFOLIO_SOURCE}_${sourceRecordId}`,
    sourceRecordId,
    id: sourceRecordId,
    reference: row.solicitation || row.contract || row.pid || sourceRecordId,
    solicitationNumber: row.solicitation || row.pid || "",
    lifecycleStage: row.status || row.timingStatus || "forecast",
    mode: "acquisition-window",
    title: row.title,
    description: row.description || row.reason || "",
    context: row.description || row.reason || "",
    portfolio: row.sourceName || source.name || "Navy acquisition forecast",
    agency: "Department of the Navy",
    buyerSubAgency: "Department of the Navy",
    office: row.organization || row.customer || "Office not published",
    owner: row.customer || row.organization || null,
    contractingOffice: row.customer || row.organization || null,
    party: row.incumbent || row.researchCounterparty || row.customer || "Not published",
    sourceSystem: "Navy Acquisition Intelligence",
    sourceChannel: PORTFOLIO_SOURCE,
    sourceLabel: `${row.sourceName || source.name || "Navy forecast"} · source-file import`,
    ingestionMethod: "manual",
    sourceUrls,
    sourceUrl,
    sourcePublishedAt: row.sourceDate || source.date || null,
    sourceUpdatedAt: row.sourceDate || source.date || null,
    solicitationStart: row.rfpTime?.lo || row.start || null,
    solicitationEnd: row.awardTime?.hi || row.end || row.responseDeadline || null,
    responseDeadline: row.responseDeadline || null,
    start: row.rfpTime?.lo || row.start || null,
    currentEnd: row.awardTime?.hi || row.end || null,
    potentialEnd: row.awardTime?.hi || row.end || null,
    noticeType: row.events?.length ? "portfolio-deadline" : "forecast",
    competitionType: row.method || row.sourceMethod || null,
    setAside: row.setaside || row.sourceSetaside || null,
    eligibility: row.route || null,
    vehicle: row.strategy || null,
    valueLow: value.low,
    valueHigh: value.high,
    potentialAmount: value.high,
    naicsCode: row.naics || null,
    pscCode: row.psc || null,
    workCategoryBasis: row.area ? `Analyst-assessed work area: ${row.area}` : null,
    events,
    evidenceTier: row.review?.toLowerCase().includes("analyst") ? "source-reviewed" : "evidence-gap",
    corroborationStatus: row.evidenceFactor || "Forecast evidence",
    validationStatus: row.review || "portfolio-import",
    validationCheckedAt: metadata.asof || null,
    corroborationFinding: row.reason || row.factors?.evidence?.basis || "Imported from a source-traceable acquisition forecast.",
    acquisitionPriority: Number(row.priority || 0) || null,
    acquisitionScore: Number(row.score || 0) || null,
    acquisitionArea: row.area || null,
    acquisitionRoute: row.route || null,
    acquisitionFitTier: row.fitTier || null,
    acquisitionAccessFactor: row.accessFactor || null,
    acquisitionEvidenceFactor: row.evidenceFactor || null,
    acquisitionLineageLevel: row.lineageLevel || null,
    acquisitionTimingQuality: row.timingQuality || null,
    acquisitionTimingStatus: row.timingStatus || null,
    acquisitionIntel: row,
  };
}

export function parseAcquisitionPortfolioHtml(html, options = {}) {
  const metadata = scriptJson(html, "portfolio-meta");
  const rows = scriptJson(html, "source-data");
  const legacySavedState = optionalScriptJson(html, "saved-state");
  if (!Array.isArray(rows) || !rows.length) throw new Error("The acquisition portfolio contains no source records.");
  const ids = rows.map((row) => String(row?.id || ""));
  if (ids.some((id) => !id) || new Set(ids).size !== ids.length) throw new Error("The acquisition portfolio contains missing or duplicate record ids.");
  const importedAt = options.importedAt || new Date().toISOString();
  return {
    metadata: {
      ...metadata,
      sourceFormat: "navy-acquisition-intelligence-html",
      filename: options.filename || "Navy Acquisition Intelligence.html",
      importedAt,
      recordCount: rows.length,
      legacySavedState,
    },
    records: rows.map((row) => normalizeAcquisitionPortfolioRecord(row, metadata)),
  };
}

export { PORTFOLIO_SOURCE };
