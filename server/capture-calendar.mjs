import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const TRANSACTIONS_FILE = resolve(ROOT, "src/data/capture-transactions.json");
const SAM_FILE = resolve(ROOT, "src/data/sam-opportunities.json");
const BUDGET_FILE = resolve(ROOT, "src/data/budget-intelligence.json");
const MANUAL_FILE = resolve(ROOT, "src/data/manual-procurement.json");
import { assembleProcurementRecords } from "../src/procurement-taxonomy.js";

async function currentCaptureSnapshot(pool) {
  const result = await pool.query(
    `SELECT id, captured_at, payload
     FROM intelligence_snapshots
     WHERE kind = 'capture_calendar'
     ORDER BY captured_at DESC, imported_at DESC
     LIMIT 1`,
  );
  return result.rows[0] || null;
}

export async function importCaptureCalendar(pool) {
  const snapshot = await currentCaptureSnapshot(pool);
  if (!snapshot) return { opportunities: 0, events: 0, actions: 0 };
  const transactions = JSON.parse(await readFile(TRANSACTIONS_FILE, "utf8"));
  const budget = JSON.parse(await readFile(BUDGET_FILE, "utf8"));
  const sam = JSON.parse(await readFile(SAM_FILE, "utf8"));
  const manual = JSON.parse(await readFile(MANUAL_FILE, "utf8"));
  const awards = budget.metadata?.dataInventory?.strategyAnalytics?.executionAnalytics?.awardDrilldown?.awards || [];
  const opportunities = assembleProcurementRecords(snapshot.payload.records || [], awards, snapshot.payload.metadata?.asOf, sam.records || [], manual.records || []);
  const events = opportunities.flatMap((opportunity) => (opportunity.events || []).map((event) => ({ opportunityId: opportunity.opportunityId, ...event })));
  const actions = Object.entries(transactions.byOpportunity || {}).flatMap(([opportunityId, rows]) => rows.map((action) => ({ opportunityId, ...action })));
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const opportunityResult = await client.query(
      `INSERT INTO capture_opportunities
        (snapshot_id, opportunity_id, gantt_alias, portfolio, record_type, award_piid, validation_status, event_count, action_count,
         work_category, ingestion_method, psc_code, naics_code, automated_import, payload)
       SELECT $1, row.opportunity_id, row.gantt_alias, row.portfolio, row.record_type, row.award_piid,
              row.validation_status, row.event_count, row.action_count, row.work_category, row.ingestion_method,
              row.psc_code, row.naics_code, row.automated_import, row.payload
       FROM jsonb_to_recordset($2::jsonb) AS row(
         opportunity_id TEXT, gantt_alias TEXT, portfolio TEXT, record_type TEXT, award_piid TEXT,
         validation_status TEXT, event_count INTEGER, action_count INTEGER, work_category TEXT,
         ingestion_method TEXT, psc_code TEXT, naics_code TEXT, automated_import BOOLEAN, payload JSONB
       )
       ON CONFLICT (snapshot_id, opportunity_id) DO UPDATE SET
         work_category = EXCLUDED.work_category,
         ingestion_method = EXCLUDED.ingestion_method,
         psc_code = EXCLUDED.psc_code,
         naics_code = EXCLUDED.naics_code,
         automated_import = EXCLUDED.automated_import,
         payload = EXCLUDED.payload`,
      [snapshot.id, JSON.stringify(opportunities.map((record) => ({
        opportunity_id: record.opportunityId,
        gantt_alias: record.id,
        portfolio: record.portfolio,
        record_type: record.mode,
        award_piid: record.reference,
        validation_status: record.validationStatus,
        event_count: record.events?.length || 0,
        action_count: record.transactionSummary?.actions || 0,
        work_category: record.workCategory,
        ingestion_method: record.ingestionMethod,
        psc_code: record.pscCode,
        naics_code: record.naicsCode,
        automated_import: record.automatedImport,
        payload: record,
      })))],
    );
    const sourceRows = opportunities.flatMap((record) => (record.ingestionChannels || []).map((channel) => ({
      opportunity_id: record.opportunityId,
      source_channel: channel.id,
      ingestion_method: channel.method || record.ingestionMethod,
      source_label: channel.label,
      payload: channel,
    })));
    if (sourceRows.length) await client.query(
      `INSERT INTO capture_opportunity_sources
        (snapshot_id, opportunity_id, source_channel, ingestion_method, source_label, payload)
       SELECT $1, row.opportunity_id, row.source_channel, row.ingestion_method, row.source_label, row.payload
       FROM jsonb_to_recordset($2::jsonb) AS row(
         opportunity_id TEXT, source_channel TEXT, ingestion_method TEXT, source_label TEXT, payload JSONB
       )
       ON CONFLICT DO NOTHING`,
      [snapshot.id, JSON.stringify(sourceRows)],
    );
    const eventResult = await client.query(
      `INSERT INTO capture_events
        (snapshot_id, event_id, opportunity_id, event_kind, event_start, event_end, precision, source_uri, payload)
       SELECT $1, row.event_id, row.opportunity_id, row.event_kind, row.event_start, row.event_end,
              row.precision, row.source_uri, row.payload
       FROM jsonb_to_recordset($2::jsonb) AS row(
         event_id TEXT, opportunity_id TEXT, event_kind TEXT, event_start DATE, event_end DATE,
         precision TEXT, source_uri TEXT, payload JSONB
       )
       ON CONFLICT DO NOTHING`,
      [snapshot.id, JSON.stringify(events.map((event) => ({
        event_id: event.eventId,
        opportunity_id: event.opportunityId,
        event_kind: event.kind,
        event_start: event.start,
        event_end: event.end,
        precision: event.precision,
        source_uri: event.sourceUrl,
        payload: event,
      })))],
    );
    const actionResult = await client.query(
      `INSERT INTO capture_fpds_actions
        (snapshot_id, action_id, opportunity_id, piid, parent_piid, modification, transaction_number,
         signed_at, obligation_delta, potential_delta, supporting_instrument, payload)
       SELECT $1, row.action_id, row.opportunity_id, row.piid, row.parent_piid, row.modification,
              row.transaction_number, row.signed_at, row.obligation_delta, row.potential_delta,
              row.supporting_instrument, row.payload
       FROM jsonb_to_recordset($2::jsonb) AS row(
         action_id TEXT, opportunity_id TEXT, piid TEXT, parent_piid TEXT, modification TEXT,
         transaction_number TEXT, signed_at DATE, obligation_delta NUMERIC, potential_delta NUMERIC,
         supporting_instrument BOOLEAN, payload JSONB
       )
       ON CONFLICT DO NOTHING`,
      [snapshot.id, JSON.stringify(actions.map((action) => ({
        action_id: action.actionId,
        opportunity_id: action.opportunityId,
        piid: action.piid,
        parent_piid: action.parentPiid,
        modification: action.modification,
        transaction_number: action.transactionNumber,
        signed_at: action.signed,
        obligation_delta: action.obligationDelta,
        potential_delta: action.potentialDelta,
        supporting_instrument: action.supportingInstrument,
        payload: action,
      })))],
    );
    await client.query("COMMIT");
    return { opportunities: opportunityResult.rowCount, events: eventResult.rowCount, actions: actionResult.rowCount };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function registerCaptureCalendarRoutes(app, pool) {
  app.get("/api/v1/capture-calendar", async () => {
    const snapshot = await currentCaptureSnapshot(pool);
    const counts = await pool.query(
      `SELECT
         (SELECT COUNT(*) FROM capture_opportunities WHERE snapshot_id = $1)::INTEGER AS opportunities,
         (SELECT COUNT(*) FROM capture_events WHERE snapshot_id = $1)::INTEGER AS events,
         (SELECT COUNT(*) FROM capture_fpds_actions WHERE snapshot_id = $1)::INTEGER AS actions,
         (SELECT COUNT(DISTINCT piid) FROM capture_fpds_actions WHERE snapshot_id = $1)::INTEGER AS instruments,
         (SELECT COUNT(*) FROM capture_opportunities WHERE snapshot_id = $1 AND automated_import)::INTEGER AS automated_imports,
         (SELECT COUNT(*) FROM capture_opportunity_sources WHERE snapshot_id = $1)::INTEGER AS source_channels,
         (SELECT COUNT(*) FROM capture_opportunities WHERE snapshot_id = $1 AND work_category IS NOT NULL AND work_category <> 'other-unclassified')::INTEGER AS classified_records`,
      [snapshot.id],
    );
    return { snapshot_id: snapshot.id, captured_at: snapshot.captured_at, ...counts.rows[0], coverage: snapshot.payload.metadata?.coverage };
  });

  app.get("/api/v1/capture-calendar/opportunities/:opportunityId", async (request, reply) => {
    const snapshot = await currentCaptureSnapshot(pool);
    const result = await pool.query(
      `SELECT payload FROM capture_opportunities WHERE snapshot_id = $1 AND opportunity_id = $2`,
      [snapshot.id, request.params.opportunityId],
    );
    return result.rows[0]?.payload || reply.code(404).send({ error: "capture opportunity not found" });
  });

  app.get("/api/v1/capture-calendar/opportunities/:opportunityId/actions", async (request, reply) => {
    const snapshot = await currentCaptureSnapshot(pool);
    const exists = await pool.query(
      `SELECT 1 FROM capture_opportunities WHERE snapshot_id = $1 AND opportunity_id = $2`,
      [snapshot.id, request.params.opportunityId],
    );
    if (!exists.rowCount) return reply.code(404).send({ error: "capture opportunity not found" });
    const result = await pool.query(
      `SELECT payload FROM capture_fpds_actions
       WHERE snapshot_id = $1 AND opportunity_id = $2
       ORDER BY signed_at, action_id`,
      [snapshot.id, request.params.opportunityId],
    );
    return { opportunity_id: request.params.opportunityId, actions: result.rows.map((row) => row.payload) };
  });
}
