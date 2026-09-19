import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const OUTPUT = resolve(ROOT, "src/data/sam-opportunities.json");
const generatedAt = new Date().toISOString();
const previous = existsSync(OUTPUT) ? JSON.parse(readFileSync(OUTPUT, "utf8")) : { metadata: {}, records: [] };
const previousById = new Map((previous.records || []).map((record) => [record.noticeId, record]));
const apiKey = process.env.SAM_GOV_API_KEY;
if (!apiKey) {
  writeFileSync(OUTPUT, `${JSON.stringify({
    ...previous,
    metadata: {
      ...(previous.metadata || {}),
      status: "unavailable",
      lastAttemptAt: generatedAt,
      note: "SAM_GOV_API_KEY was unavailable. Prior records were preserved and no discovery claim was made.",
    },
  }, null, 2)}\n`);
  console.log("SAM_GOV_API_KEY is unavailable; preserving the prior SAM.gov records and recording the failed refresh attempt");
  process.exit(0);
}

function signature(record) {
  const sourceFields = { ...record };
  delete sourceFields.firstSeenAt;
  delete sourceFields.lastSeenAt;
  delete sourceFields.lastChangedAt;
  delete sourceFields.changeCount;
  delete sourceFields.sourceSignature;
  return createHash("sha256").update(JSON.stringify(sourceFields)).digest("hex");
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
    sourceUpdatedAt: row.modifiedDate || row.lastModifiedDate || row.updatedDate || null,
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
const annotated = unique.map((record) => {
  const prior = previousById.get(record.noticeId);
  const sourceSignature = signature(record);
  const priorSignature = prior?.sourceSignature || (prior ? signature(prior) : null);
  const changed = !prior || priorSignature !== sourceSignature;
  return {
    ...record,
    firstSeenAt: prior?.firstSeenAt || previous.metadata?.generatedAt || generatedAt,
    lastSeenAt: generatedAt,
    lastChangedAt: changed ? generatedAt : prior?.lastChangedAt || prior?.firstSeenAt || generatedAt,
    changeCount: Math.max(1, Number(prior?.changeCount || 0) + (changed ? 1 : 0)),
    sourceSignature,
  };
});
const output = {
  metadata: {
    schemaVersion: "2.0.0",
    generatedAt,
    status: "current",
    sourceSystem: "SAM.gov Contract Opportunities API",
    sourceUrl: "https://open.gsa.gov/api/get-opportunities-public-api/",
    lookbackDays: 180,
    recordCount: annotated.length,
    addedCount: annotated.filter((record) => !previousById.has(record.noticeId)).length,
    updatedCount: annotated.filter((record) => {
      const prior = previousById.get(record.noticeId);
      return prior && (prior.sourceSignature || signature(prior)) !== record.sourceSignature;
    }).length,
  },
  records: annotated,
};
writeFileSync(OUTPUT, `${JSON.stringify(output, null, 2)}\n`);
console.log(`Fetched ${annotated.length} Department of Defense SAM.gov notices (${output.metadata.addedCount} added, ${output.metadata.updatedCount} updated)`);
