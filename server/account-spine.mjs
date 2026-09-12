import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const ACCOUNT_SPINE_FILE = resolve(ROOT, "src/data/account-spine.json");

function hash(value) {
  return createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(value)).digest("hex");
}

async function sourceDocument(client, document) {
  const result = await client.query(
    `INSERT INTO source_documents
      (source_system, source_identifier, source_uri, content_hash, published_at, observed_at, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
     ON CONFLICT (source_system, source_identifier, content_hash)
     DO UPDATE SET observed_at = GREATEST(source_documents.observed_at, EXCLUDED.observed_at)
     RETURNING id`,
    [
      document.sourceSystem,
      document.sourceIdentifier,
      document.sourceUri,
      document.contentHash,
      document.publishedAt || null,
      document.observedAt,
      JSON.stringify(document.metadata || {}),
    ],
  );
  return result.rows[0].id;
}

async function observation(client, accountId, fiscalYear, row) {
  await client.query(
    `INSERT INTO fiscal_account_observations
      (fiscal_account_id, fiscal_year, treasury_account_symbol, amount_type, amount,
       relationship_class, source_document_id, observed_at, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
     ON CONFLICT DO NOTHING`,
    [
      accountId,
      fiscalYear,
      row.tasCode || "",
      row.amountType,
      row.amount,
      row.relationshipClass,
      row.sourceDocumentId,
      row.observedAt,
      JSON.stringify(row.metadata || {}),
    ],
  );
}

export async function importAccountSpine(pool) {
  const raw = await readFile(ACCOUNT_SPINE_FILE, "utf8");
  const payload = JSON.parse(raw);
  const observedAt = payload.metadata.generatedAt;
  const fiscalYear = Number(payload.metadata.fiscalYear);
  const client = await pool.connect();
  let accountCount = 0;
  let observationCount = 0;
  let awardCount = 0;
  let awardAccountCount = 0;
  try {
    await client.query("BEGIN");
    const budgetDocumentId = await sourceDocument(client, {
      sourceSystem: "DoW Comptroller",
      sourceIdentifier: `budget-request-FY${fiscalYear}`,
      sourceUri: payload.metadata.sources.budgetRequestSource || "https://comptroller.war.gov/Budget-Materials/",
      contentHash: hash({ generatedAt: payload.metadata.sources.budgetRequestGeneratedAt, fiscalYear }),
      publishedAt: payload.metadata.sources.budgetRequestGeneratedAt,
      observedAt,
      metadata: { amountType: "request", relationshipClass: "derived" },
    });

    for (const account of payload.accounts || []) {
      const accountResult = await client.query(
        `INSERT INTO fiscal_accounts
          (federal_account_code, agency_identifier, main_account_code, account_title, bureau_name)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (federal_account_code)
         DO UPDATE SET account_title = EXCLUDED.account_title,
                       bureau_name = EXCLUDED.bureau_name,
                       updated_at = NOW()
         RETURNING id`,
        [account.federalAccountCode, account.agencyIdentifier, account.mainAccountCode, account.title, account.bureauName || ""],
      );
      const accountId = accountResult.rows[0].id;
      accountCount += 1;
      const usaDocumentId = await sourceDocument(client, {
        sourceSystem: "USAspending",
        sourceIdentifier: `${account.federalAccountCode}-FY${fiscalYear}`,
        sourceUri: account.sourceUrl,
        contentHash: hash(account),
        observedAt,
        metadata: { federalAccountCode: account.federalAccountCode },
      });

      const accountRows = [
        ["budgetary_resources", account.budgetaryResourcesAmount, "exact"],
        ["obligated", account.obligatedAmount, "exact"],
        ["outlayed", account.outlayedAmount, "exact"],
      ];
      if (account.requestMatch) accountRows.unshift(["request", account.requestAmount, "derived"]);
      for (const [amountType, amount, relationshipClass] of accountRows) {
        await observation(client, accountId, fiscalYear, {
          amountType,
          amount,
          relationshipClass,
          sourceDocumentId: amountType === "request" ? budgetDocumentId : usaDocumentId,
          observedAt,
          metadata: amountType === "request" ? account.requestMatch : {},
        });
        observationCount += 1;
      }

      for (const treasury of account.treasuryAccounts || []) {
        for (const [amountType, amount] of [
          ["budgetary_resources", treasury.budgetaryResourcesAmount],
          ["obligated", treasury.obligatedAmount],
          ["outlayed", treasury.outlayedAmount],
        ]) {
          await observation(client, accountId, fiscalYear, {
            tasCode: treasury.tasCode,
            amountType,
            amount,
            relationshipClass: "exact",
            sourceDocumentId: usaDocumentId,
            observedAt,
          });
          observationCount += 1;
        }
        if (treasury.apportionment) {
          const omb = treasury.apportionment;
          const ombDocumentId = await sourceDocument(client, {
            sourceSystem: "OMB Apportionment",
            sourceIdentifier: omb.sourceIdentifier,
            sourceUri: omb.sourceUrl,
            contentHash: hash(omb),
            publishedAt: null,
            observedAt,
            metadata: { approvalTimestamp: omb.approvalTimestamp, iteration: omb.iteration },
          });
          await observation(client, accountId, fiscalYear, {
            tasCode: treasury.tasCode,
            amountType: "apportioned",
            amount: omb.approvedAmount,
            relationshipClass: "exact",
            sourceDocumentId: ombDocumentId,
            observedAt,
            metadata: { approvedLine: omb.approvedLine, tafs: omb.tafs },
          });
          observationCount += 1;
        }
      }
    }

    const awardFlows = payload.awardFlows || [];
    let awardAccountsDocumentId = null;
    if (awardFlows.length) {
      awardAccountsDocumentId = await sourceDocument(client, {
        sourceSystem: "USAspending Award Accounts",
        sourceIdentifier: `sampled-award-accounts-FY${fiscalYear}`,
        sourceUri: payload.metadata.sources.usaSpendingAwardAccounts,
        contentHash: hash(awardFlows),
        observedAt,
        metadata: {
          relationshipClass: "exact",
          sampledAwards: payload.metadata.coverage.sampledAwards,
          availableSampledAwards: payload.metadata.coverage.availableSampledAwards,
        },
      });
    }
    for (const award of awardFlows) {
      await client.query(
        `INSERT INTO federal_awards
          (award_id, award_number, recipient_name, description, start_date, end_date,
           total_award_amount, source_uri, metadata)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
         ON CONFLICT (award_id)
         DO UPDATE SET award_number = EXCLUDED.award_number,
                       recipient_name = EXCLUDED.recipient_name,
                       description = EXCLUDED.description,
                       start_date = EXCLUDED.start_date,
                       end_date = EXCLUDED.end_date,
                       total_award_amount = EXCLUDED.total_award_amount,
                       source_uri = EXCLUDED.source_uri,
                       metadata = EXCLUDED.metadata,
                       updated_at = NOW()`,
        [
          award.awardId,
          award.awardNumber,
          award.recipient,
          award.description || "",
          award.startDate || null,
          award.endDate || null,
          award.awardAmount,
          award.sourceUrl,
          JSON.stringify({ areas: award.areas || [], fundingOffice: award.fundingOffice, awardingOffice: award.awardingOffice }),
        ],
      );
      awardCount += 1;
      for (const account of award.accounts || []) {
        const fiscalAccount = await client.query(
          `SELECT id FROM fiscal_accounts WHERE federal_account_code = $1`,
          [account.federalAccountCode],
        );
        await client.query(
          `INSERT INTO award_account_observations
            (award_id, fiscal_account_id, federal_account_code, account_title, obligated_amount,
             relationship_class, source_document_id, observed_at, metadata)
           VALUES ($1, $2, $3, $4, $5, 'exact', $6, $7, $8::jsonb)
           ON CONFLICT DO NOTHING`,
          [
            award.awardId,
            fiscalAccount.rows[0]?.id || null,
            account.federalAccountCode,
            account.accountTitle,
            account.obligatedAmount,
            awardAccountsDocumentId,
            observedAt,
            JSON.stringify({ fundingAgencyName: account.fundingAgencyName, fundingAgencySlug: account.fundingAgencySlug }),
          ],
        );
        awardAccountCount += 1;
      }
    }

    const agencyDocumentId = await sourceDocument(client, {
      sourceSystem: "USAspending Agency Budgetary Resources",
      sourceIdentifier: `agency-${payload.metadata.agencyCode}-history-observed-${observedAt}`,
      sourceUri: payload.metadata.sources.usaSpendingBudgetaryResources,
      contentHash: hash(payload.agencyBurn || {}),
      observedAt,
      metadata: { agencyCode: payload.metadata.agencyCode },
    });
    for (const year of payload.agencyBurn?.agency_data_by_year || []) {
      for (const [amountType, amount] of [
        ["budgetary_resources", year.agency_budgetary_resources],
        ["obligated", year.agency_total_obligated],
        ["outlayed", year.agency_total_outlayed],
      ]) {
        await client.query(
          `INSERT INTO agency_fiscal_year_observations
            (agency_code, fiscal_year, amount_type, amount, source_document_id, observed_at)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT DO NOTHING`,
          [payload.metadata.agencyCode, year.fiscal_year, amountType, Number(amount || 0), agencyDocumentId, observedAt],
        );
      }
    }
    await client.query("COMMIT");
    return { accounts: accountCount, observations: observationCount, awards: awardCount, awardAccounts: awardAccountCount, fiscalYear };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function registerAccountSpineRoutes(app, pool) {
  app.get("/api/v1/account-spine", async () => {
    const result = await pool.query(`
      WITH latest AS (
        SELECT DISTINCT ON (fiscal_account_id, fiscal_year, treasury_account_symbol, amount_type)
          fiscal_account_id, fiscal_year, treasury_account_symbol, amount_type, amount,
          relationship_class, observed_at
        FROM fiscal_account_observations
        ORDER BY fiscal_account_id, fiscal_year, treasury_account_symbol, amount_type, observed_at DESC, id DESC
      )
      SELECT
        MAX(fiscal_year)::integer AS fiscal_year,
        COUNT(DISTINCT fiscal_account_id)::integer AS federal_accounts,
        COUNT(DISTINCT NULLIF(treasury_account_symbol, ''))::integer AS treasury_accounts,
        COUNT(*) FILTER (WHERE amount_type = 'apportioned')::integer AS exact_tafs_joins,
        MAX(observed_at) AS observed_at
      FROM latest
    `);
    return result.rows[0];
  });

  app.get("/api/v1/account-spine/accounts", async (request) => {
    const fiscalYear = Number(request.query?.fiscal_year || 0) || null;
    const result = await pool.query(`
      WITH latest AS (
        SELECT DISTINCT ON (fiscal_account_id, fiscal_year, treasury_account_symbol, amount_type)
          fiscal_account_id, fiscal_year, treasury_account_symbol, amount_type, amount,
          relationship_class, observed_at
        FROM fiscal_account_observations
        WHERE treasury_account_symbol = '' AND ($1::integer IS NULL OR fiscal_year = $1)
        ORDER BY fiscal_account_id, fiscal_year, treasury_account_symbol, amount_type, observed_at DESC, id DESC
      )
      SELECT a.federal_account_code, a.account_title, a.bureau_name, l.fiscal_year,
        MAX(l.amount) FILTER (WHERE l.amount_type = 'request') AS requested_amount,
        MAX(l.amount) FILTER (WHERE l.amount_type = 'budgetary_resources') AS budgetary_resources_amount,
        MAX(l.amount) FILTER (WHERE l.amount_type = 'obligated') AS obligated_amount,
        MAX(l.amount) FILTER (WHERE l.amount_type = 'outlayed') AS outlayed_amount,
        MAX(l.observed_at) AS observed_at
      FROM latest l
      JOIN fiscal_accounts a ON a.id = l.fiscal_account_id
      GROUP BY a.id, l.fiscal_year
      ORDER BY obligated_amount DESC NULLS LAST
    `, [fiscalYear]);
    return { accounts: result.rows };
  });

  app.get("/api/v1/account-spine/accounts/:code", async (request, reply) => {
    const account = await pool.query(
      `SELECT id, federal_account_code, agency_identifier, main_account_code, account_title, bureau_name
       FROM fiscal_accounts WHERE federal_account_code = $1`,
      [request.params.code],
    );
    if (!account.rowCount) return reply.code(404).send({ error: "federal account not found" });
    const observations = await pool.query(`
      SELECT DISTINCT ON (o.fiscal_year, o.treasury_account_symbol, o.amount_type)
        o.fiscal_year, o.treasury_account_symbol, o.amount_type, o.amount,
        o.relationship_class, o.observed_at, o.metadata,
        d.source_system, d.source_identifier, d.source_uri, d.published_at
      FROM fiscal_account_observations o
      JOIN source_documents d ON d.id = o.source_document_id
      WHERE o.fiscal_account_id = $1
      ORDER BY o.fiscal_year, o.treasury_account_symbol, o.amount_type, o.observed_at DESC, o.id DESC
    `, [account.rows[0].id]);
    return { account: account.rows[0], observations: observations.rows };
  });

  app.get("/api/v1/account-spine/history", async (request) => {
    const agencyCode = String(request.query?.agency_code || "097");
    const result = await pool.query(`
      WITH latest AS (
        SELECT DISTINCT ON (agency_code, fiscal_year, amount_type)
          agency_code, fiscal_year, amount_type, amount, observed_at
        FROM agency_fiscal_year_observations
        WHERE agency_code = $1
        ORDER BY agency_code, fiscal_year, amount_type, observed_at DESC, id DESC
      )
      SELECT fiscal_year,
        MAX(amount) FILTER (WHERE amount_type = 'budgetary_resources') AS budgetary_resources_amount,
        MAX(amount) FILTER (WHERE amount_type = 'obligated') AS obligated_amount,
        MAX(amount) FILTER (WHERE amount_type = 'outlayed') AS outlayed_amount,
        MAX(observed_at) AS observed_at
      FROM latest
      GROUP BY fiscal_year
      ORDER BY fiscal_year
    `, [agencyCode]);
    return { agency_code: agencyCode, fiscal_years: result.rows };
  });

  app.get("/api/v1/account-spine/award-flows", async () => {
    const result = await pool.query(`
      WITH latest AS (
        SELECT DISTINCT ON (award_id, federal_account_code)
          award_id, federal_account_code, obligated_amount, observed_at
        FROM award_account_observations
        ORDER BY award_id, federal_account_code, observed_at DESC, id DESC
      )
      SELECT COUNT(DISTINCT award_id)::integer AS awards,
        COUNT(*)::integer AS exact_account_links,
        COUNT(DISTINCT federal_account_code)::integer AS federal_accounts,
        SUM(obligated_amount) AS linked_obligations,
        MAX(observed_at) AS observed_at
      FROM latest
    `);
    return result.rows[0];
  });

  app.get("/api/v1/account-spine/accounts/:code/awards", async (request) => {
    const limit = Math.min(100, Math.max(1, Number(request.query?.limit || 25)));
    const result = await pool.query(`
      WITH latest AS (
        SELECT DISTINCT ON (award_id, federal_account_code)
          award_id, federal_account_code, account_title, obligated_amount,
          relationship_class, observed_at, metadata
        FROM award_account_observations
        WHERE federal_account_code = $1
        ORDER BY award_id, federal_account_code, observed_at DESC, id DESC
      )
      SELECT l.federal_account_code, l.account_title, l.obligated_amount,
        l.relationship_class, l.observed_at, l.metadata,
        a.award_id, a.award_number, a.recipient_name, a.description,
        a.start_date, a.end_date, a.total_award_amount, a.source_uri, a.metadata AS award_metadata
      FROM latest l
      JOIN federal_awards a ON a.award_id = l.award_id
      ORDER BY l.obligated_amount DESC
      LIMIT $2
    `, [request.params.code, limit]);
    return { federal_account_code: request.params.code, awards: result.rows };
  });
}
