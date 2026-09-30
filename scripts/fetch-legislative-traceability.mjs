import { createHash } from "node:crypto";
import { readFileSync, renameSync, writeFileSync } from "node:fs";

const OUT = "src/data/legislative-traceability.json";
const GOVINFO = "https://api.govinfo.gov";
const CONGRESS = "https://api.congress.gov/v3";
const PUBLIC_DEMO_KEY = "DEMO_KEY";
const API_KEY = process.env.GOVINFO_API_KEY || process.env.CONGRESS_API_KEY || PUBLIC_DEMO_KEY;
const SINCE = "2017-01-01";
const DEFENSE_BILL_SEEDS = Object.freeze([
  [115, "hr", 2810], [115, "hr", 5515], [115, "hr", 3219], [115, "hr", 6157],
  [116, "s", 1790], [116, "hr", 6395], [116, "hr", 2740], [116, "hr", 133],
  [117, "s", 1605], [117, "hr", 7776], [117, "hr", 4432], [117, "hr", 8236],
  [118, "hr", 2670], [118, "s", 4638], [118, "hr", 4365], [118, "hr", 8774],
  [119, "s", 1071], [119, "hr", 3838], [119, "hr", 4016], [119, "hr", 9495],
]);
const ENACTED_NDAA_BASELINE = Object.freeze([
  { congress: 115, type: "hr", number: 2810, fiscalYear: 2018, law: "115-91" },
  { congress: 115, type: "hr", number: 5515, fiscalYear: 2019, law: "115-232" },
  { congress: 116, type: "s", number: 1790, fiscalYear: 2020, law: "116-92" },
  { congress: 116, type: "hr", number: 6395, fiscalYear: 2021, law: "116-283" },
  { congress: 117, type: "s", number: 1605, fiscalYear: 2022, law: "117-81" },
  { congress: 117, type: "hr", number: 7776, fiscalYear: 2023, law: "117-263" },
  { congress: 118, type: "hr", number: 2670, fiscalYear: 2024, law: "118-31", reports: ["118hrpt125", "118hrpt301"] },
  { congress: 118, type: "s", number: 4638, fiscalYear: 2025, law: "118-159" },
]);
const DEFENSE_APPROPRIATIONS_BASELINE = Object.freeze([
  {
    congress: 118,
    type: "hr",
    number: 4365,
    fiscalYear: 2024,
    title: "Department of Defense Appropriations Act, 2024",
    reports: ["118hrpt121"],
  },
]);
const hash = (value) => createHash("sha256").update(String(value)).digest("hex").slice(0, 20);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function json(url, options = {}, attempt = 0) {
  const response = await fetch(url, { ...options, headers: { "content-type": "application/json", "user-agent": "DefenseBudgetIntelligence/1.0 public-data-research", ...(options.headers || {}) } });
  const retryLimit = API_KEY === PUBLIC_DEMO_KEY ? (url.startsWith(`${GOVINFO}/search`) ? 1 : 2) : 5;
  if ([429, 500, 502, 503, 504].includes(response.status) && attempt < retryLimit) {
    await sleep(Math.min(30_000, 1000 * (2 ** attempt)));
    return json(url, options, attempt + 1);
  }
  if (!response.ok) throw new Error(`${response.status} ${await response.text()}`.slice(0, 500));
  return response.json();
}

async function searchGovInfo(query, pageSize = 100) {
  const payload = await json(`${GOVINFO}/search?api_key=${encodeURIComponent(API_KEY)}`, {
    method: "POST",
    body: JSON.stringify({ query, pageSize, offsetMark: "*", sorts: [{ field: "dateIssued", sortOrder: "DESC" }] }),
  });
  return payload.results || [];
}

async function summary(packageId) {
  return json(`${GOVINFO}/packages/${encodeURIComponent(packageId)}/summary?api_key=${encodeURIComponent(API_KEY)}`);
}

function billIdentity(packageId) {
  const match = String(packageId || "").match(/^BILLS-(\d+)(hr|s)(\d+)([a-z0-9]+)$/i);
  if (!match) return null;
  return { congress: Number(match[1]), type: match[2].toLowerCase(), number: Number(match[3]), versionCode: match[4].toLowerCase() };
}

function dateOf(row) {
  return String(row.dateIssued || row.publishDate || row.lastModified || "").slice(0, 10);
}

async function main() {
  const errors = [];
  const packages = new Map();
  const queries = [
    { kind: "bill", query: 'collection:BILLS AND title:"Department of Defense Appropriations"', limit: 60 },
    { kind: "bill", query: 'collection:BILLS AND title:"National Defense Authorization"', limit: 60 },
    { kind: "report", query: 'collection:CRPT AND "Department of Defense"', limit: 40 },
    { kind: "law", query: 'collection:PLAW AND "Department of Defense"', limit: 40 },
  ];
  if (process.env.SKIP_GOVINFO_SEARCH !== "1") {
    for (const item of queries) {
      try {
        for (const row of (await searchGovInfo(item.query, item.limit)).slice(0, item.limit)) {
          if (dateOf(row) && dateOf(row) < SINCE) continue;
          const packageId = row.packageId || row.package_id;
          if (packageId) packages.set(packageId, { ...row, kind: item.kind });
        }
      } catch (error) { errors.push({ stage: "search", query: item.query, error: String(error.message || error).slice(0, 500) }); }
    }
  } else {
    errors.push({ stage: "search", query: "GovInfo defense collections", error: "GovInfo search skipped after public demo-key throttling; exact Congress.gov seed collection remained active." });
  }

  const details = [];
  for (const row of [...packages.values()].slice(0, 160)) {
    try { details.push({ ...row, ...(await summary(row.packageId || row.package_id)) }); }
    catch (error) { errors.push({ stage: "summary", packageId: row.packageId || row.package_id, error: String(error.message || error).slice(0, 500) }); }
  }

  const measures = new Map();
  const versions = [];
  const reports = [];
  const laws = new Map();
  const relations = [];
  for (const row of details) {
    const packageId = row.packageId || row.package_id;
    const sourceUrl = row.detailsLink || `https://www.govinfo.gov/app/details/${packageId}`;
    if (row.kind === "bill") {
      const identity = billIdentity(packageId);
      if (!identity) continue;
      const measureId = `legislative-measure:${identity.congress}:${identity.type}:${identity.number}`;
      const versionId = `legislative-version:${packageId}`;
      measures.set(measureId, {
        id: measureId,
        congress: identity.congress,
        billType: identity.type,
        billNumber: identity.number,
        label: `${identity.type.toUpperCase()} ${identity.number}, ${identity.congress}th Congress`,
        title: row.title || null,
        sourceUrl: `https://www.congress.gov/bill/${identity.congress}th-congress/${identity.type === "hr" ? "house-bill" : "senate-bill"}/${identity.number}`,
      });
      versions.push({ id: versionId, measureId, packageId, versionCode: identity.versionCode, title: row.title || null, dateIssued: row.dateIssued || null, lastModified: row.lastModified || null, sourceUrl, textLink: row.txtLink || row.textLink || null, pdfLink: row.pdfLink || null });
      relations.push({ type: "measure-has-version", from: measureId, to: versionId, basis: "govinfo-package-identity", sourceUrl });
    } else if (row.kind === "report") {
      const id = `committee-report:${packageId}`;
      reports.push({ id, packageId, title: row.title || packageId, congress: Number(row.congress || 0) || null, dateIssued: row.dateIssued || null, sourceUrl });
      const match = String(row.title || "").match(/(?:H\.?\s*R\.?|S\.?)\s*(\d+)/i);
      if (match && row.congress) {
        const type = /^s/i.test(match[0]) ? "s" : "hr";
        const measureId = `legislative-measure:${Number(row.congress)}:${type}:${Number(match[1])}`;
        if (measures.has(measureId)) relations.push({ type: "measure-backed-by-report", from: measureId, to: id, basis: "exact-bill-citation-in-report-title", sourceUrl });
      }
    } else if (row.kind === "law") {
      const id = `enacted-provision:${packageId}`;
      laws.set(id, { id, packageId, title: row.title || packageId, congress: Number(row.congress || 0) || null, dateIssued: row.dateIssued || null, sourceUrl });
    }
  }

  for (const seed of ENACTED_NDAA_BASELINE) {
    const measureId = `legislative-measure:${seed.congress}:${seed.type}:${seed.number}`;
    const billStem = `${seed.congress}${seed.type}${seed.number}`;
    const measureSource = `https://www.congress.gov/bill/${seed.congress}th-congress/${seed.type === "hr" ? "house-bill" : "senate-bill"}/${seed.number}`;
    if (!measures.has(measureId)) measures.set(measureId, { id: measureId, congress: seed.congress, billType: seed.type, billNumber: seed.number, fiscalYear: seed.fiscalYear, label: `FY${seed.fiscalYear} National Defense Authorization Act`, title: `National Defense Authorization Act for Fiscal Year ${seed.fiscalYear}`, sourceUrl: measureSource, baseline: "exact-official-identifier" });
    const versionCodes = seed.type === "hr" ? [["ih", "Introduced in House"], ["rh", "Reported in House"], ["enr", "Enrolled Bill"]] : [["is", "Introduced in Senate"], ["rs", "Reported in Senate"], ["enr", "Enrolled Bill"]];
    for (const [versionCode, title] of versionCodes) {
      const packageId = `BILLS-${billStem}${versionCode}`;
      const versionId = `legislative-version:${packageId}`;
      if (!versions.some((row) => row.id === versionId)) versions.push({ id: versionId, measureId, packageId, versionCode, title, dateIssued: null, lastModified: null, sourceUrl: `https://www.govinfo.gov/app/details/${packageId}`, textLink: `https://www.congress.gov/${seed.congress}/bills/${seed.type}${seed.number}/${packageId}.htm`, pdfLink: null, baseline: "exact-official-identifier" });
      relations.push({ type: "measure-has-version", from: measureId, to: versionId, basis: "exact-govinfo-package-identity", sourceUrl: `https://www.govinfo.gov/app/details/${packageId}` });
    }
    const lawPackageId = `PLAW-${seed.law.split("-")[0]}publ${seed.law.split("-")[1]}`;
    const lawId = `enacted-provision:${lawPackageId}`;
    if (!laws.has(lawId)) laws.set(lawId, { id: lawId, packageId: lawPackageId, title: `Public Law ${seed.law}`, congress: seed.congress, fiscalYear: seed.fiscalYear, dateIssued: null, sourceUrl: `https://www.govinfo.gov/app/details/${lawPackageId}`, publicLawNumber: seed.law, lawType: "Public Law", baseline: "exact-official-identifier" });
    relations.push({ type: "measure-enacted-as", from: measureId, to: lawId, basis: "exact-public-law-identity", sourceUrl: `https://www.govinfo.gov/app/details/${lawPackageId}` });
    for (const reportCode of seed.reports || []) {
      const packageId = `CRPT-${reportCode}`;
      const reportId = `committee-report:${packageId}`;
      if (!reports.some((row) => row.id === reportId)) reports.push({ id: reportId, packageId, title: packageId, congress: seed.congress, dateIssued: null, sourceUrl: `https://www.govinfo.gov/app/details/${packageId}`, baseline: "exact-official-identifier" });
      relations.push({ type: "measure-backed-by-report", from: measureId, to: reportId, basis: "exact-congress-committee-report-identity", sourceUrl: `https://www.govinfo.gov/app/details/${packageId}` });
    }
  }

  for (const seed of DEFENSE_APPROPRIATIONS_BASELINE) {
    const measureId = `legislative-measure:${seed.congress}:${seed.type}:${seed.number}`;
    const sourceUrl = `https://www.congress.gov/bill/${seed.congress}th-congress/${seed.type === "hr" ? "house-bill" : "senate-bill"}/${seed.number}`;
    if (!measures.has(measureId)) measures.set(measureId, {
      id: measureId,
      congress: seed.congress,
      billType: seed.type,
      billNumber: seed.number,
      fiscalYear: seed.fiscalYear,
      label: `FY${seed.fiscalYear} Department of Defense Appropriations Bill`,
      title: seed.title,
      sourceUrl,
      baseline: "exact-official-identifier",
    });
    for (const reportCode of seed.reports) {
      const packageId = `CRPT-${reportCode}`;
      const reportId = `committee-report:${packageId}`;
      const reportUrl = `https://www.govinfo.gov/app/details/${packageId}`;
      if (!reports.some((row) => row.id === reportId)) reports.push({
        id: reportId,
        packageId,
        title: `House Report 118-121: Department of Defense Appropriations Bill, 2024`,
        congress: seed.congress,
        dateIssued: "2023-06-27",
        sourceUrl: reportUrl,
        baseline: "exact-official-identifier",
      });
      relations.push({ type: "measure-backed-by-report", from: measureId, to: reportId, basis: "exact-congress-committee-report-identity", sourceUrl: reportUrl });
    }
  }

  for (const measure of process.env.CONGRESS_SEED_ENRICHMENT === "0" ? [] : measures.values()) {
    try {
      const payload = await json(`${CONGRESS}/bill/${measure.congress}/${measure.billType}/${measure.billNumber}?format=json&api_key=${encodeURIComponent(API_KEY)}`);
      const bill = payload.bill || {};
      measure.latestAction = bill.latestAction || null;
      measure.updateDate = bill.updateDate || null;
      for (const law of bill.laws || []) {
        const lawId = `enacted-provision:${measure.congress}:${String(law.type || "public").toLowerCase()}:${law.number}`;
        if (!laws.has(lawId)) laws.set(lawId, { id: lawId, packageId: null, title: `${law.type || "Public Law"} ${law.number}`, congress: measure.congress, dateIssued: null, sourceUrl: measure.sourceUrl, publicLawNumber: law.number, lawType: law.type || null });
        relations.push({ type: "measure-enacted-as", from: measure.id, to: lawId, basis: "congress-api-law-identity", sourceUrl: measure.sourceUrl });
      }
    } catch (error) { errors.push({ stage: "congress-bill", measureId: measure.id, error: String(error.message || error).slice(0, 500) }); }
  }

  for (const [congress, type, number] of process.env.CONGRESS_SEED_ENRICHMENT === "0" ? [] : DEFENSE_BILL_SEEDS) {
    const measureId = `legislative-measure:${congress}:${type}:${number}`;
    if (measures.has(measureId)) continue;
    const sourceUrl = `https://www.congress.gov/bill/${congress}th-congress/${type === "hr" ? "house-bill" : "senate-bill"}/${number}`;
    try {
      const payload = await json(`${CONGRESS}/bill/${congress}/${type}/${number}?format=json&api_key=${encodeURIComponent(API_KEY)}`);
      const bill = payload.bill || {};
      const title = bill.title || "";
      if (!/(?:defen[cs]e|military|armed forces|appropriation)/i.test(title)) continue;
      measures.set(measureId, { id: measureId, congress, billType: type, billNumber: number, label: `${type.toUpperCase()} ${number}, ${congress}th Congress`, title, introducedDate: bill.introducedDate || null, latestAction: bill.latestAction || null, updateDate: bill.updateDate || null, sourceUrl });
      const textPayload = await json(`${CONGRESS}/bill/${congress}/${type}/${number}/text?format=json&api_key=${encodeURIComponent(API_KEY)}`);
      for (const [index, textVersion] of (textPayload.textVersions || []).entries()) {
        const primary = (textVersion.formats || []).find((format) => format.type === "Formatted Text") || textVersion.formats?.[0];
        if (!primary?.url) continue;
        const packageMatch = primary.url.match(/\/(BILLS-[^/.]+)\./i);
        const packageId = packageMatch?.[1] || `${congress}${type}${number}-${index}`;
        const versionId = `legislative-version:${packageId}`;
        if (!versions.some((row) => row.id === versionId)) versions.push({ id: versionId, measureId, packageId, versionCode: packageMatch?.[1]?.replace(new RegExp(`^BILLS-${congress}${type}${number}`, "i"), "") || null, title: textVersion.type || title, dateIssued: textVersion.date || null, lastModified: null, sourceUrl: primary.url, textLink: primary.url, pdfLink: (textVersion.formats || []).find((format) => format.type === "PDF")?.url || null });
        relations.push({ type: "measure-has-version", from: measureId, to: versionId, basis: "congress-api-bill-text-version", sourceUrl: primary.url });
      }
      for (const report of bill.committeeReports || []) {
        const citation = report.citation || report.url;
        const reportId = `committee-report:${hash(citation)}`;
        if (!reports.some((row) => row.id === reportId)) reports.push({ id: reportId, packageId: null, title: citation, congress, dateIssued: null, sourceUrl: report.url || sourceUrl });
        relations.push({ type: "measure-backed-by-report", from: measureId, to: reportId, basis: "congress-api-committee-report-link", sourceUrl: report.url || sourceUrl });
      }
      for (const law of bill.laws || []) {
        const lawId = `enacted-provision:${congress}:${String(law.type || "public").toLowerCase().replace(/\s+/g, "-")}:${law.number}`;
        if (!laws.has(lawId)) laws.set(lawId, { id: lawId, packageId: null, title: `${law.type || "Public Law"} ${law.number}`, congress, dateIssued: bill.latestAction?.actionDate || null, sourceUrl, publicLawNumber: law.number, lawType: law.type || null });
        relations.push({ type: "measure-enacted-as", from: measureId, to: lawId, basis: "congress-api-law-identity", sourceUrl });
      }
    } catch (error) { errors.push({ stage: "congress-seed", measureId, error: String(error.message || error).slice(0, 500) }); }
  }

  const previous = (() => { try { return JSON.parse(readFileSync(OUT, "utf8")); } catch { return null; } })();
  if (!versions.length && previous?.versions?.length) {
    console.warn("Legislative sources returned no bill versions; preserving prior verified artifact");
    return;
  }
  const payload = {
    metadata: {
      schemaVersion: "1.0.0",
      generatedAt: new Date().toISOString(),
      sourceAuthority: "official_primary",
      sources: { govinfo: "https://www.govinfo.gov/developers", congress: "https://api.congress.gov/" },
      coverage: { since: SINCE, measures: measures.size, versions: versions.length, committeeReports: reports.length, enactedProvisions: laws.size, exactRelations: relations.length, failures: errors.length },
      caveat: "Package collection is bounded to defense-titled GovInfo results. Report and law linkage is promoted only when exact bill or law identifiers are published. A separately reviewed FY2024 House RDT&E Army table supplies page-cited committee marks; Senate, conference, and enacted line-item amounts remain unasserted until their official tables are parsed.",
      apiCredential: API_KEY === PUBLIC_DEMO_KEY ? "public-demo" : "configured",
      contentHash: hash(JSON.stringify({ measures: [...measures.values()], versions, reports, laws: [...laws.values()], relations })),
    },
    measures: [...measures.values()],
    versions,
    committeeReports: reports,
    enactedProvisions: [...laws.values()],
    relations,
    failures: errors,
  };
  const tmp = `${OUT}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(payload, null, 2)}\n`);
  renameSync(tmp, OUT);
  console.log(`Legislative traceability: ${measures.size} measures, ${versions.length} versions, ${reports.length} reports, ${laws.size} laws, ${errors.length} failures`);
}

await main();
