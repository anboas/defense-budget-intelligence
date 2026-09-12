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
    await client.query("COMMIT");
    return { accounts: accountCount, observations: observationCount, fiscalYear };
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
}
