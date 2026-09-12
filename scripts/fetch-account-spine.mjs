import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const BUDGET_FILE = resolve(ROOT, "src/data/budget-intelligence.json");
const OUT_FILE = resolve(ROOT, "src/data/account-spine.json");
const DEFAULT_SOURCE_DIR = process.env.HOME
  ? resolve(process.env.HOME, "clawd/artifacts/defense-budget-intelligence/budget")
  : resolve(ROOT, "../artifacts/defense-budget-intelligence/budget");
const SOURCE_DIR = process.env.BUDGET_SOURCE_DIR || DEFAULT_SOURCE_DIR;
const AWARD_SOURCE_FILE = process.env.USASPENDING_AWARD_FILE
  || resolve(SOURCE_DIR, "usaspending/FY2025-FY2026/technology-awards.json");
const OMB_INDEX_URL = "https://apportionment-public.max.gov/";
const USASPENDING_API = "https://api.usaspending.gov/api/v2";
const USASPENDING_AWARD_ACCOUNTS_URL = `${USASPENDING_API}/awards/accounts/`;
const today = new Date();
const defaultFiscalYear = today.getUTCMonth() >= 9 ? today.getUTCFullYear() + 1 : today.getUTCFullYear();
const FISCAL_YEAR = Number(process.env.ACCOUNT_SPINE_FISCAL_YEAR || defaultFiscalYear);
const AGENCY_CODE = process.env.ACCOUNT_SPINE_AGENCY_CODE || "097";
const CONCURRENCY = Math.max(1, Number(process.env.ACCOUNT_SPINE_CONCURRENCY || 12));
const AWARD_ACCOUNT_CONCURRENCY = Math.max(1, Number(process.env.AWARD_ACCOUNT_CONCURRENCY || 4));
const AWARD_ACCOUNT_LIMIT = Math.max(1, Number(process.env.AWARD_ACCOUNT_LIMIT || 250));
const USER_AGENT = "defense-budget-intelligence-account-spine/1.0";

function normalizeTitle(value = "") {
  return String(value)
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/defense[ -]wide/g, "defense wide")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

async function fetchText(url, attempt = 1) {
  try {
    const response = await fetch(url, { headers: { "user-agent": USER_AGENT } });
    if (!response.ok) {
      if (attempt < 6 && (response.status === 429 || response.status >= 500)) {
        await new Promise((resolvePromise) => setTimeout(resolvePromise, Math.min(8_000, attempt * 750)));
        return fetchText(url, attempt + 1);
      }
      throw new Error(`${response.status} ${response.statusText}: ${url}`);
    }
    return response.text();
  } catch (error) {
    if (attempt >= 6 || /^\d{3}\s/.test(error.message)) throw error;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, Math.min(8_000, attempt * 750)));
    return fetchText(url, attempt + 1);
  }
}

async function fetchJson(url) {
  return JSON.parse(await fetchText(url));
}

async function fetchJsonPost(url, body, attempt = 1) {
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "user-agent": USER_AGENT,
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      if (attempt < 8 && (response.status === 429 || response.status >= 500)) {
        const retryAfter = Number(response.headers.get("retry-after") || 0) * 1000;
        const backoff = Math.min(10_000, 500 * (2 ** (attempt - 1))) + Math.floor(Math.random() * 250);
        await new Promise((resolvePromise) => setTimeout(resolvePromise, Math.max(retryAfter, backoff)));
        return fetchJsonPost(url, body, attempt + 1);
      }
      throw new Error(`${response.status} ${response.statusText}: ${url}`);
    }
    return response.json();
  } catch (error) {
    if (attempt >= 8 || /^\d{3}\s/.test(error.message)) throw error;
    const backoff = Math.min(10_000, 500 * (2 ** (attempt - 1))) + Math.floor(Math.random() * 250);
    await new Promise((resolvePromise) => setTimeout(resolvePromise, backoff));
    return fetchJsonPost(url, body, attempt + 1);
  }
}

async function mapLimit(items, limit, mapper) {
  const results = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await mapper(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

function parseOmbLink(href) {
  const filename = decodeURIComponent(href.split("/").pop() || "");
  const match = filename.match(/TAFS=([^_]+)_Iteration=(\d+)_/);
  return match ? { href, filename, tafs: match[1], iteration: Number(match[2]) } : null;
}

function currentOmbLinks(html) {
  const fiscalFolder = `/Fiscal Year ${FISCAL_YEAR}/Department of War/JSON/`;
  const links = [...html.matchAll(/href="([^"]+\.json)"/gi)]
    .map((match) => parseOmbLink(match[1]))
    .filter((item) => item && decodeURIComponent(item.href).includes(fiscalFolder));
  const latest = new Map();
  for (const item of links) {
    const prior = latest.get(item.tafs);
    if (!prior || item.iteration > prior.iteration || (item.iteration === prior.iteration && item.filename > prior.filename)) {
      latest.set(item.tafs, item);
    }
  }
  return [...latest.values()];
}

function ombTasCode(row = {}) {
  const allocationAgency = String(row.AllocationAgencyCode || "").padStart(3, "0");
  const agency = String(row.CgacAgency || "").padStart(3, "0");
  const availability = row.AvailabilityTypeCode === "X"
    ? "X"
    : `${row.BeginPoa}/${row.EndPoa}`;
  const main = String(row.CgacAcct || "").padStart(4, "0");
  const sub = String(row.AllocationSubacct || "000").padStart(3, "0");
  return `${allocationAgency && allocationAgency !== "000" ? `${allocationAgency}-` : ""}${agency}-${availability}-${main}-${sub}`;
}

function normalizeOmbDocument(payload, link) {
  const rows = payload.ScheduleData || [];
  const identity = rows.find((row) => row.CgacAgency && row.CgacAcct) || {};
  const total = rows.find((row) => String(row.LineNumber) === "6190")
    || rows.find((row) => String(row.LineNumber) === "1920");
  return {
    tasCode: ombTasCode(identity),
    tafs: link.tafs,
    fiscalYear: Number(payload.FiscalYear || FISCAL_YEAR),
    accountTitle: identity.AccountTitle || "Unlabeled account",
    bureauTitle: identity.BudgetBureauTitle || "",
    approvedAmount: Number(total?.ApprovedAmount || 0),
    approvedLine: total?.LineNumber || null,
    approvalTimestamp: payload.ApprovalTimestamp || null,
    iteration: Number(identity.Iteration || link.iteration),
    sourceUrl: new URL(link.href, OMB_INDEX_URL).href,
    sourceIdentifier: payload.FileName || link.filename.replace(/\.json$/i, ""),
  };
}

async function fetchOmbApportionments() {
  const index = await fetchText(OMB_INDEX_URL);
  const links = currentOmbLinks(index);
  if (!links.length) throw new Error(`No Department of War FY${FISCAL_YEAR} OMB apportionment JSON links found`);
  const failures = [];
  const documents = (await mapLimit(links, CONCURRENCY, async (link) => {
    try {
      return normalizeOmbDocument(await fetchJson(new URL(link.href, OMB_INDEX_URL)), link);
    } catch (error) {
      failures.push({ sourceUrl: new URL(link.href, OMB_INDEX_URL).href, error: error.message });
      return null;
    }
  })).filter(Boolean);
  if (documents.length < Math.floor(links.length * 0.9)) {
    throw new Error(`OMB apportionment coverage too low: ${documents.length}/${links.length}`);
  }
  return { documents, failures, discovered: links.length };
}

async function fetchFederalAccounts() {
  const firstUrl = `${USASPENDING_API}/agency/${AGENCY_CODE}/federal_account/?fiscal_year=${FISCAL_YEAR}&page=1&limit=100`;
  const first = await fetchJson(firstUrl);
  const totalPages = Math.max(1, Math.ceil((first.page_metadata?.total || first.results.length) / 100));
  const remaining = await mapLimit(
    Array.from({ length: totalPages - 1 }, (_, index) => index + 2),
    3,
    (page) => fetchJson(`${USASPENDING_API}/agency/${AGENCY_CODE}/federal_account/?fiscal_year=${FISCAL_YEAR}&page=${page}&limit=100`),
  );
  const summaries = [first, ...remaining].flatMap((page) => page.results || []);
  const failures = [];
  const details = await mapLimit(summaries, CONCURRENCY, async (summary) => {
    const sourceUrl = `${USASPENDING_API}/federal_accounts/${encodeURIComponent(summary.code)}/`;
    try {
      return { ...summary, ...(await fetchJson(sourceUrl)), sourceUrl };
    } catch (error) {
      failures.push({ federalAccountCode: summary.code, sourceUrl, error: error.message });
      return { ...summary, sourceUrl };
    }
  });
  if (details.length < 100) throw new Error(`USAspending federal account coverage too low: ${details.length}`);
  const agencyBudgetaryResources = await fetchJson(
    `${USASPENDING_API}/agency/${AGENCY_CODE}/budgetary_resources/?fiscal_year=${FISCAL_YEAR}`,
  );
  return { accounts: details, failures, agencyBudgetaryResources };
}

function sampledAwards() {
  const payload = JSON.parse(readFileSync(AWARD_SOURCE_FILE, "utf8"));
  const awards = new Map();
  for (const area of payload.areas || []) {
    const areaId = area.area?.id || "unclassified";
    const areaLabel = area.area?.label || "Unclassified technology";
    for (const raw of area.results || []) {
      const awardId = raw.generated_internal_id;
      if (!awardId) continue;
      const current = awards.get(awardId) || {
        awardId,
        awardNumber: String(raw["Award ID"] || ""),
        recipient: String(raw["Recipient Name"] || "Unspecified recipient").replace(/\s+/g, " ").trim(),
        description: String(raw.Description || "").replace(/\s+/g, " ").trim(),
        startDate: raw["Start Date"] || null,
        endDate: raw["End Date"] || null,
        awardAmount: Number(raw["Award Amount"] || 0),
        awardingOffice: raw["Awarding Office"] || null,
        fundingOffice: raw["Funding Office"] || null,
        fundingSubAgency: raw["Funding Sub Agency"] || null,
        areas: new Map(),
        sourceUrl: `https://www.usaspending.gov/award/${encodeURIComponent(awardId)}/`,
      };
      current.areas.set(areaId, areaLabel);
      awards.set(awardId, current);
    }
  }
  const rankedAwards = [...awards.values()]
    .sort((left, right) => right.awardAmount - left.awardAmount);
  return {
    generatedAt: payload.metadata?.generatedAt || null,
    methodology: payload.metadata?.methodology || null,
    availableAwardCount: rankedAwards.length,
    awards: rankedAwards.slice(0, AWARD_ACCOUNT_LIMIT).map((award) => ({
      ...award,
      areas: [...award.areas].map(([id, label]) => ({ id, label })),
    })),
  };
}

async function fetchAwardAccountFlows() {
  const sample = sampledAwards();
  const failures = [];
  const flows = (await mapLimit(sample.awards, AWARD_ACCOUNT_CONCURRENCY, async (award) => {
    try {
      const page = await fetchJsonPost(USASPENDING_AWARD_ACCOUNTS_URL, {
        award_id: award.awardId,
        page: 1,
        limit: 100,
        sort: "total_transaction_obligated_amount",
        order: "desc",
      });
      return {
        ...award,
        accounts: (page.results || []).map((account) => ({
          federalAccountCode: account.federal_account,
          accountTitle: account.account_title,
          obligatedAmount: Number(account.total_transaction_obligated_amount || 0),
          fundingAgencyAbbreviation: account.funding_agency_abbreviation || null,
          fundingAgencyName: account.funding_agency_name || null,
          fundingAgencySlug: account.funding_agency_slug || null,
          relationshipClass: "exact",
        })),
      };
    } catch (error) {
      failures.push({ awardId: award.awardId, awardNumber: award.awardNumber, error: error.message });
      return null;
    }
  })).filter(Boolean);
  if (flows.length < Math.floor(sample.awards.length * 0.9)) {
    throw new Error(`USAspending award-account coverage too low: ${flows.length}/${sample.awards.length}`);
  }
  return { ...sample, flows, failures };
}

function budgetRequests() {
  const payload = JSON.parse(readFileSync(BUDGET_FILE, "utf8"));
  const amountField = `fy${FISCAL_YEAR}`;
  const sourcesById = new Map((payload.metadata?.sources || []).map((source) => [source.id, source]));
  const byTitle = new Map();
  for (const record of payload.records || []) {
    if (record.addNonAdd !== "Add" || !Number(record[amountField])) continue;
    const key = normalizeTitle(record.accountTitle);
    const current = byTitle.get(key) || {
      title: record.accountTitle,
      amount: 0,
      recordCount: 0,
      sourceUrls: new Set(),
    };
    current.amount += Number(record[amountField]) * 1_000_000_000;
    current.recordCount += 1;
    const source = sourcesById.get(record.bookId);
    if (source?.sourceUrl) current.sourceUrls.add(source.sourceUrl);
    byTitle.set(key, current);
  }
  return {
    generatedAt: payload.metadata?.generatedAt,
    methodology: payload.metadata?.methodology,
    byTitle,
  };
}

function accountStages(account, request, ombByTas) {
  const treasuryAccounts = (account.children || []).map((child) => {
    const apportionment = ombByTas.get(child.code) || null;
    return {
      tasCode: child.code,
      title: child.name,
      budgetaryResourcesAmount: Number(child.budgetary_resources_amount || 0),
      obligatedAmount: Number(child.obligated_amount || 0),
      outlayedAmount: Number(child.gross_outlay_amount || 0),
      apportionment,
      exactApportionmentJoin: Boolean(apportionment),
    };
  });
  const apportionedAmount = treasuryAccounts.reduce((total, row) => total + Number(row.apportionment?.approvedAmount || 0), 0);
  const requestMatch = request.byTitle.get(normalizeTitle(account.name || account.account_title));
  const budgetaryResourcesAmount = Number(account.total_budgetary_resources || 0);
  const obligatedAmount = Number(account.obligated_amount ?? account.total_obligated_amount ?? 0);
  const outlayedAmount = Number(account.gross_outlay_amount ?? account.total_gross_outlay_amount ?? 0);
  return {
    federalAccountCode: account.code || account.federal_account_code,
    accountId: account.id || null,
    title: account.name || account.account_title,
    agencyIdentifier: account.agency_identifier || String(account.code || "").split("-")[0],
    mainAccountCode: account.main_account_code || String(account.code || "").split("-")[1],
    bureauName: account.bureau_name || "",
    requestAmount: Number(requestMatch?.amount || 0),
    requestMatch: requestMatch ? {
      relationshipClass: "derived",
      method: "normalized exact account-title match",
      recordCount: requestMatch.recordCount,
      sourceUrls: [...requestMatch.sourceUrls],
    } : null,
    budgetaryResourcesAmount,
    apportionedAmount,
    obligatedAmount,
    outlayedAmount,
    unobligatedAmount: Math.max(0, budgetaryResourcesAmount - obligatedAmount),
    treasuryAccountCount: treasuryAccounts.length,
    exactApportionmentJoinCount: treasuryAccounts.filter((row) => row.exactApportionmentJoin).length,
    treasuryAccounts,
    sourceUrl: account.sourceUrl,
  };
}

const [omb, usa, request] = await Promise.all([
  fetchOmbApportionments(),
  fetchFederalAccounts(),
  Promise.resolve(budgetRequests()),
]);
const awardAccounts = await fetchAwardAccountFlows();
const ombByTas = new Map(omb.documents.map((document) => [document.tasCode, document]));
const accounts = usa.accounts
  .map((account) => accountStages(account, request, ombByTas))
  .sort((left, right) => right.obligatedAmount - left.obligatedAmount);
const joinedTreasuryAccounts = accounts.reduce((total, account) => total + account.exactApportionmentJoinCount, 0);
const treasuryAccounts = accounts.reduce((total, account) => total + account.treasuryAccountCount, 0);
const matchedRequestAccounts = accounts.filter((account) => account.requestMatch).length;
const requestedAmount = accounts.reduce((total, account) => total + account.requestAmount, 0);
const apportionedAmount = accounts.reduce((total, account) => total + account.apportionedAmount, 0);
const obligatedAmount = accounts.reduce((total, account) => total + account.obligatedAmount, 0);
const outlayedAmount = accounts.reduce((total, account) => total + account.outlayedAmount, 0);
const exactAwardAccountLinks = awardAccounts.flows.reduce((total, award) => total + award.accounts.length, 0);
const exactAwardAccountObligations = awardAccounts.flows.reduce(
  (total, award) => total + award.accounts.reduce((accountTotal, account) => accountTotal + account.obligatedAmount, 0),
  0,
);
const currentAccountCodes = new Set(accounts.map((account) => account.federalAccountCode));
const awardsMappedToCurrentAccounts = awardAccounts.flows.filter((award) => (
  award.accounts.some((account) => currentAccountCodes.has(account.federalAccountCode))
)).length;

const output = {
  metadata: {
    title: `FY${FISCAL_YEAR} Department of War Exact Account Spine`,
    generatedAt: new Date().toISOString(),
    fiscalYear: FISCAL_YEAR,
    agencyCode: AGENCY_CODE,
    relationshipPolicy: "TAFS joins are exact. Budget-request joins are derived only when normalized federal-account titles match exactly. No budget-line-to-award relationship is asserted.",
    amountPolicy: "Request, budgetary resources, apportionment, obligations, and outlays are separate measures and must not be added together.",
    sources: {
      ombApportionments: OMB_INDEX_URL,
      usaSpendingAgencyAccounts: `${USASPENDING_API}/agency/${AGENCY_CODE}/federal_account/`,
      usaSpendingBudgetaryResources: `${USASPENDING_API}/agency/${AGENCY_CODE}/budgetary_resources/`,
      usaSpendingAwardAccounts: USASPENDING_AWARD_ACCOUNTS_URL,
      usaSpendingAwardSampleGeneratedAt: awardAccounts.generatedAt,
      usaSpendingAwardSampleMethodology: awardAccounts.methodology,
      budgetRequestGeneratedAt: request.generatedAt,
    },
    coverage: {
      federalAccounts: accounts.length,
      treasuryAccounts,
      ombDocumentsDiscovered: omb.discovered,
      ombDocumentsFetched: omb.documents.length,
      exactTafsJoins: joinedTreasuryAccounts,
      exactTafsJoinRate: treasuryAccounts ? joinedTreasuryAccounts / treasuryAccounts : 0,
      requestMatchedAccounts: matchedRequestAccounts,
      requestMatchRate: accounts.length ? matchedRequestAccounts / accounts.length : 0,
      ombFailures: omb.failures.length,
      usaSpendingFailures: usa.failures.length,
      sampledAwards: awardAccounts.awards.length,
      availableSampledAwards: awardAccounts.availableAwardCount,
      awardAccountsFetched: awardAccounts.flows.length,
      exactAwardAccountLinks,
      awardsMappedToCurrentAccounts,
      awardAccountFailures: awardAccounts.failures.length,
    },
  },
  summary: {
    requestedAmount,
    apportionedAmount,
    obligatedAmount,
    outlayedAmount,
    exactAwardAccountObligations,
  },
  agencyBurn: usa.agencyBudgetaryResources,
  accounts,
  awardFlows: awardAccounts.flows,
  unmatchedApportionments: omb.documents
    .filter((document) => !accounts.some((account) => account.treasuryAccounts.some((row) => row.tasCode === document.tasCode)))
    .map((document) => ({ tasCode: document.tasCode, title: document.accountTitle, approvedAmount: document.approvedAmount, sourceUrl: document.sourceUrl })),
  failures: { omb: omb.failures, usaSpending: usa.failures, awardAccounts: awardAccounts.failures },
};

writeFileSync(OUT_FILE, `${JSON.stringify(output, null, 2)}\n`);
console.log(
  `Built FY${FISCAL_YEAR} account spine: ${accounts.length} federal accounts, ${joinedTreasuryAccounts}/${treasuryAccounts} exact TAFS joins, ${matchedRequestAccounts} request matches, ${exactAwardAccountLinks} exact award-account links.`,
);
