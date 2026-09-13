import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const OUTPUT = resolve(ROOT, "src/data/sam-opportunities.json");
const apiKey = process.env.SAM_GOV_API_KEY;
if (!apiKey) {
  console.log("SAM_GOV_API_KEY is unavailable; preserving the prior SAM.gov snapshot");
  process.exit(0);
}

const end = new Date();
const start = new Date(end.getTime() - 180 * 86_400_000);
const mmddyyyy = (date) => `${String(date.getUTCMonth() + 1).padStart(2, "0")}/${String(date.getUTCDate()).padStart(2, "0")}/${date.getUTCFullYear()}`;
const records = [];
let offset = 0;
const limit = 1000;

while (true) {
  const url = new URL("https://api.sam.gov/opportunities/v2/search");
  url.searchParams.set("postedFrom", mmddyyyy(start));
  url.searchParams.set("postedTo", mmddyyyy(end));
  url.searchParams.set("deptname", "DEPT OF DEFENSE");
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("offset", String(offset));
  const response = await fetch(url, { headers: { accept: "application/json", "user-agent": "defense-budget-intelligence/1.0", "x-api-key": apiKey } });
  if (!response.ok) throw new Error(`SAM.gov opportunity search returned ${response.status}`);
  const payload = await response.json();
  const rows = payload.opportunitiesData || [];
  records.push(...rows.map((row) => ({
    noticeId: row.noticeId || null,
    solicitationNumber: row.solicitationNumber || null,
    title: row.title || "Untitled opportunity",
    description: row.description || row.additionalInfoLink || "",
    noticeType: row.type || row.baseType || null,
    postedDate: row.postedDate?.slice(0, 10) || null,
    responseDeadline: row.responseDeadLine?.slice(0, 10) || row.archiveDate?.slice(0, 10) || null,
    archiveDate: row.archiveDate?.slice(0, 10) || null,
    naicsCode: row.naicsCode || null,
    pscCode: row.classificationCode || null,
    setAside: row.typeOfSetAsideDescription || row.typeOfSetAside || null,
    department: row.department || null,
    subTier: row.subTier || null,
    office: row.office || null,
    organizationPath: row.fullParentPathName || null,
    placeOfPerformance: row.placeOfPerformance || null,
    active: row.active === "Yes" || row.active === true,
    sourceUrl: row.uiLink || (row.noticeId ? `https://sam.gov/opp/${row.noticeId}/view` : "https://sam.gov/content/opportunities"),
  })));
  offset += rows.length;
  if (!rows.length || records.length >= Number(payload.totalRecords || 0)) break;
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
}

const unique = [...new Map(records.filter((record) => record.noticeId).map((record) => [record.noticeId, record])).values()];
const output = {
  metadata: {
    schemaVersion: "1.0.0",
    generatedAt: new Date().toISOString(),
    status: "current",
    sourceSystem: "SAM.gov Contract Opportunities API",
    sourceUrl: "https://open.gsa.gov/api/get-opportunities-public-api/",
    lookbackDays: 180,
    recordCount: unique.length,
  },
  records: unique,
};
writeFileSync(OUTPUT, `${JSON.stringify(output, null, 2)}\n`);
console.log(`Fetched ${unique.length} Department of Defense SAM.gov notices`);
