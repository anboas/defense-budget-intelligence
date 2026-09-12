import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

const args = Object.fromEntries(process.argv.slice(2).flatMap((value, index, all) => (
  value.startsWith("--") ? [[value.slice(2), all[index + 1]]] : []
)));

if (!args.pdf || !args.csv) {
  throw new Error("Usage: node scripts/build-capture-calendar.mjs --pdf <gantt.pdf> --csv <corroboration.csv> [--out <capture-calendar.json>]");
}

const pdfPath = resolve(args.pdf);
const csvPath = resolve(args.csv);
const outPath = resolve(args.out || "src/data/capture-calendar.json");
const generatedAt = new Date().toISOString();
const asOf = "2026-09-11";
const privateStatuses = new Set(["internal_proposal"]);
const idPattern = /^(C\d{3}|F\d{3}|E\d+|P-[A-Z0-9.]+|T-[A-Z0-9.-]+)\s+(.+)$/;

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function decodeHtml(value) {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replace(/&#(\d+);/g, (_match, code) => String.fromCodePoint(Number(code)));
}

function parseCsv(input) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    if (quoted) {
      if (character === '"' && input[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        cell += character;
      }
    } else if (character === '"') {
      quoted = true;
    } else if (character === ",") {
      row.push(cell);
      cell = "";
    } else if (character === "\n") {
      row.push(cell.replace(/\r$/, ""));
      if (row.some((value) => value.trim())) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += character;
    }
  }
  if (quoted) throw new Error("Corroboration CSV ends inside a quoted field");
  if (cell || row.length) {
    row.push(cell.replace(/\r$/, ""));
    if (row.some((value) => value.trim())) rows.push(row);
  }
  if (!rows.length) throw new Error("Corroboration CSV is empty");
  const headers = rows.shift().map((header) => header.replace(/^\uFEFF/, "").trim());
  const required = ["gantt_row_id", "program", "status", "checked_at", "finding", "usaspending_url", "fpds_url", "other_source_urls"];
  for (const header of required) {
    if (!headers.includes(header)) throw new Error(`Corroboration CSV is missing ${header}`);
  }
  return rows.map((values, index) => {
    if (values.length !== headers.length) {
      throw new Error(`Corroboration row ${index + 2} has ${values.length} columns; expected ${headers.length}`);
    }
    const record = Object.fromEntries(headers.map((header, column) => [header, values[column].trim()]));
    if (!record.gantt_row_id) throw new Error(`Corroboration row ${index + 2} has no gantt_row_id`);
    return record;
  });
}

function parseBlocks(xml) {
  return [...xml.matchAll(/<block xMin="([^"]+)" yMin="([^"]+)" xMax="([^"]+)" yMax="([^"]+)">([\s\S]*?)<\/block>/g)]
    .map((match) => ({
      x: Number(match[1]),
      y: Number(match[2]),
      x2: Number(match[3]),
      y2: Number(match[4]),
      text: decodeHtml([...match[5].matchAll(/<word[^>]*>([\s\S]*?)<\/word>/g)].map((word) => word[1]).join(" ")),
    }));
}

function dollars(value, unit) {
  const scale = { K: 1_000, M: 1_000_000, B: 1_000_000_000 }[unit.toUpperCase()] || 1;
  return Number(value.replaceAll(",", "")) * scale;
}

function parseMoney(text) {
  const obligation = text.match(/\bO\s+\$([\d,.]+)([KMB])/i);
  const potential = text.match(/\b(?:Potential|Ceiling)\s+\$([\d,.]+)([KMB])/i);
  const range = text.match(/\$([\d,.]+)([KMB])\s*-\s*\$([\d,.]+)([KMB])/i);
  const single = !range ? text.match(/\$([\d,.]+)([KMB])\s+(?:reported\s+)?IDIQ ceiling/i) : null;
  return {
    obligatedAmount: obligation ? dollars(obligation[1], obligation[2]) : null,
    potentialAmount: potential ? dollars(potential[1], potential[2]) : single ? dollars(single[1], single[2]) : null,
    valueLow: range ? dollars(range[1], range[2]) : null,
    valueHigh: range ? dollars(range[3], range[4]) : null,
  };
}

const monthNumbers = { JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5, JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11 };

function isoDate(day, month, year) {
  const fullYear = Number(year) < 100 ? 2000 + Number(year) : Number(year);
  const date = new Date(Date.UTC(fullYear, monthNumbers[month.toUpperCase()], Number(day)));
  return Number.isNaN(date.valueOf()) ? null : date.toISOString().slice(0, 10);
}

function parseNamedDate(value) {
  const match = value.match(/(\d{1,2})\s+([A-Z]{3})\s+(\d{2,4})/i);
  return match ? isoDate(match[1], match[2], match[3]) : null;
}

function quarterRange(quarter, fiscalYear) {
  const year = 2000 + Number(fiscalYear);
  const ranges = {
    1: [`${year - 1}-10-01`, `${year}-01-01`],
    2: [`${year}-01-01`, `${year}-04-01`],
    3: [`${year}-04-01`, `${year}-07-01`],
    4: [`${year}-07-01`, `${year}-10-01`],
  };
  const [start, next] = ranges[Number(quarter)] || [];
  if (!start) return null;
  const end = new Date(`${next}T00:00:00Z`);
  end.setUTCDate(end.getUTCDate() - 1);
  return { start, end: end.toISOString().slice(0, 10), precision: "quarter" };
}

function monthRange(month, year) {
  const monthIndex = monthNumbers[month.toUpperCase()];
  if (monthIndex == null) return null;
  const start = new Date(Date.UTC(Number(year), monthIndex, 1));
  const end = new Date(Date.UTC(Number(year), monthIndex + 1, 0));
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10), precision: "month" };
}

function parseMilestoneValue(value) {
  const quarter = value.match(/Q(?:TR)?\s*([1-4])\s+FY(\d{2})/i) || value.match(/FY(\d{2})\s+Q(?:TR)?\s*([1-4])/i);
  if (quarter) {
    return quarter[0].toUpperCase().startsWith("FY")
      ? quarterRange(quarter[2], quarter[1])
      : quarterRange(quarter[1], quarter[2]);
  }
  const exact = parseNamedDate(value);
  if (exact) return { start: exact, end: exact, precision: "day" };
  const month = value.match(/\b([A-Z]{3})\s+(20\d{2})\b/i);
  return month ? monthRange(month[1], month[2]) : null;
}

function parseTiming(text, mode) {
  const performance = text.match(/\b(Start|Ordering start)\s+([^|]+)\|\s*(Current|Ordering end)\s+([^|]+)(?:\|\s*Potential\s+([^|]+))?/i);
  if (performance) {
    const start = parseNamedDate(performance[2]);
    const currentEnd = parseNamedDate(performance[4]);
    const potentialEnd = parseNamedDate(performance[5] || performance[4]);
    return {
      start,
      currentEnd,
      potentialEnd,
      ordering: performance[1].toLowerCase().startsWith("ordering"),
      milestones: [],
    };
  }
  const milestoneLabels = [
    "Questions closed", "Solution briefs due", "Proposals due", "Reported RFP release", "Forecast RFP release",
    "Reported award", "Forecast award", "Draft RFP forecast", "Final RFP forecast", "Award forecast",
    "Screening assumed missed", "AoIs 005/006 intake closed", "Application deadline", "Response due",
  ];
  const milestones = [];
  for (const label of milestoneLabels) {
    const pattern = new RegExp(`${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*:\\s*([^|]+)`, "i");
    const match = text.match(pattern);
    const range = match ? parseMilestoneValue(match[1]) : null;
    if (range) milestones.push({ label, ...range });
  }
  return { start: null, currentEnd: null, potentialEnd: null, ordering: false, milestones, mode };
}

function urlsFrom(value) {
  return [...new Set(value.match(/https?:\/\/[^\s,]+/g) || [])];
}

function publicName(value) {
  return value.replace(/^Our\s+/i, "").replace(/\s+\/\s+our\s+/gi, " / ").trim();
}

function publicText(value) {
  return String(value || "")
    .replace(/Value\s*\/\s*Sabre workshare not established/gi, "Value not published")
    .replace(/Sabre workshare/gi, "allocation")
    .replace(/workshare unknown/gi, "allocation not published")
    .replace(/workshare/gi, "allocation")
    .replace(/\bSabre:\s*/gi, "")
    .replace(/\bour buying route\b/gi, "purchase route")
    .replace(/\bour delivery lead\b/gi, "delivery lead")
    .replace(/\bour access\b/gi, "access")
    .trim();
}

function evidenceTier(status) {
  if (status === "matched" || status === "supporting_awards_matched") return "corroborated";
  if (status === "agency_announcement") return "official-announcement";
  if (status.startsWith("source_retrieved")) return "source-reviewed";
  if (status === "prior_evidence_only") return "prior-evidence";
  return "evidence-gap";
}

function lifecycleStatus(mode, timing, status) {
  if (evidenceTier(status) === "evidence-gap") return "evidence-gap";
  if (mode === "contract-performance") {
    if (timing.currentEnd && timing.currentEnd >= asOf) return "active-reported-term";
    if (timing.potentialEnd && timing.potentialEnd >= asOf) return "option-horizon-unconfirmed";
    return timing.potentialEnd ? "historical-term" : "schedule-not-published";
  }
  if (!timing.milestones.length) return "schedule-not-published";
  return timing.milestones.some((milestone) => milestone.end >= asOf)
    ? "upcoming-published-milestone"
    : "past-published-milestone";
}

const corroboration = parseCsv(readFileSync(csvPath, "utf8"));
const corroborationById = new Map(corroboration.map((record) => [record.gantt_row_id, record]));
const temporaryDirectory = mkdtempSync(resolve(tmpdir(), "capture-gantt-"));
const xmlPath = resolve(temporaryDirectory, "gantt.xml");

try {
  execFileSync("pdftotext", ["-bbox-layout", pdfPath, xmlPath], { stdio: "inherit" });
  const xml = readFileSync(xmlPath, "utf8");
  const pageXml = [...xml.matchAll(/<page\b[^>]*>([\s\S]*?)<\/page>/g)].map((match) => match[1]);
  const records = [];

  for (let pageIndex = 0; pageIndex < pageXml.length; pageIndex += 1) {
    const blocks = parseBlocks(pageXml[pageIndex]);
    const modeText = blocks.find((block) => block.text.startsWith("PURSUIT CALENDAR /"))?.text || "";
    const mode = modeText.includes("CONTRACT PERFORMANCE") ? "contract-performance" : "acquisition-window";
    const portfolioBlock = blocks.find((block) => block.x < 80 && block.y >= 70 && block.y <= 105 && !block.text.startsWith("PURSUIT"));
    const portfolio = portfolioBlock?.text.replace(/\s*\|\s*\d+\s+of\s+\d+\s*$/i, "").trim() || "Unclassified portfolio";
    const starts = blocks
      .filter((block) => block.x < 80 && block.y > 178 && block.y < 545 && idPattern.test(block.text))
      .sort((left, right) => left.y - right.y);

    for (let index = 0; index < starts.length; index += 1) {
      const rowStart = starts[index];
      const rowMatch = rowStart.text.match(idPattern);
      const id = rowMatch[1];
      const source = corroborationById.get(id);
      if (!source) throw new Error(`PDF row ${id} on page ${pageIndex + 1} has no corroboration record`);
      const rowEnd = starts[index + 1]?.y || 545;
      const rowBlocks = blocks.filter((block) => block.y >= rowStart.y - 0.5 && block.y < rowEnd - 0.5);
      const left = rowBlocks.filter((block) => block.x < 270).sort((a, b) => a.y - b.y || a.x - b.x);
      const right = rowBlocks.filter((block) => block.x >= 270).sort((a, b) => a.y - b.y || a.x - b.x);
      const statusBlock = [...left].reverse().find((block) => {
        const letters = block.text.replace(/[^A-Za-z]/g, "");
        return letters.length > 6 && letters === letters.toUpperCase();
      });
      const details = left.filter((block) => block !== rowStart && block !== statusBlock);
      const fiscalLabels = details.filter((block) => /^FY\d{2}\*?$/.test(block.text));
      const fiscalValueBlocks = [];
      const fiscalValues = fiscalLabels.flatMap((fiscalLabel) => {
        const valueBlock = details
          .filter((block) => /^[\d.]+$/.test(block.text) && block.x > fiscalLabel.x && Math.abs(block.y - fiscalLabel.y) <= 2)
          .sort((leftBlock, rightBlock) => leftBlock.x - rightBlock.x)[0];
        if (!valueBlock) return [];
        fiscalValueBlocks.push(valueBlock);
        return [{ fiscalYear: 2000 + Number(fiscalLabel.text.match(/FY(\d{2})/)[1]), amount: Number(valueBlock.text) * 1_000_000 }];
      });
      const fiscalBlocks = new Set([...fiscalLabels, ...fiscalValueBlocks]);
      const nonFiscal = details.filter((block) => !fiscalBlocks.has(block));
      const party = nonFiscal[0]?.text || "Not published";
      const reference = nonFiscal[1]?.text || "";
      const valueText = nonFiscal.find((block, detailIndex) => detailIndex > 0 && (/\$/.test(block.text) || /Value not published/i.test(block.text)))?.text || "";
      const context = nonFiscal.filter((block, detailIndex) => detailIndex > 1 && block.text !== valueText).map((block) => block.text).join(" · ");
      const rightText = right.map((block) => block.text).join(" | ");
      const evidenceLabels = [...rightText.matchAll(/\[([^\]]+)\]/g)].map((match) => match[1]);
      const timing = parseTiming(rightText, mode);
      const money = parseMoney(`${valueText} ${rightText}`);
      const sourceUrls = [...new Set([
        source.usaspending_url,
        source.fpds_url,
        ...urlsFrom(source.other_source_urls),
      ].filter(Boolean))];
      const visibility = privateStatuses.has(source.status) ? "private" : "public";

      records.push({
        id,
        portfolio,
        mode,
        page: pageIndex + 1,
        title: publicName(source.program || rowMatch[2]),
        sourceDescription: publicText(source.source_award_description),
        party,
        reference,
        context: publicText(context),
        valueText: publicText(valueText),
        evidenceLabels,
        corroborationStatus: source.status,
        evidenceTier: evidenceTier(source.status),
        lifecycleStatus: lifecycleStatus(mode, timing, source.status),
        corroborationFinding: publicText(source.finding),
        checkedAt: source.checked_at,
        liveSourceFailures: source.live_source_failures,
        sourceUrls,
        fiscalValues,
        ...money,
        ...timing,
        visibility,
      });
    }
  }

  const ids = new Set(records.map((record) => record.id));
  const missing = corroboration.filter((record) => !ids.has(record.gantt_row_id));
  if (missing.length) throw new Error(`Corroboration rows missing from PDF: ${missing.map((record) => record.gantt_row_id).join(", ")}`);
  if (records.length !== corroboration.length) throw new Error(`Parsed ${records.length} PDF rows for ${corroboration.length} corroboration rows`);

  const publicRecordCandidates = records.filter((record) => record.visibility === "public");
  const publicRecords = publicRecordCandidates.map(({ visibility: _visibility, ...record }) => record);
  const output = {
    metadata: {
      title: "Growth and Capture Calendar",
      asOf,
      generatedAt,
      sourcePdf: { name: "Sabre Executive Growth Capture Gantt.pdf", sha256: sha256(pdfPath), pages: pageXml.length },
      corroboration: { name: "corroboration.csv", sha256: sha256(csvPath), rows: corroboration.length },
      publicationPolicy: "Public-source facts only. Internal campaign fields and proposed work packages are excluded from the public runtime bundle.",
      coverage: {
        sourceRows: records.length,
        publicRows: publicRecords.length,
        excludedPrivateRows: records.length - publicRecords.length,
        portfolios: new Set(publicRecords.map((record) => record.portfolio)).size,
        contractRows: publicRecords.filter((record) => record.mode === "contract-performance").length,
        acquisitionRows: publicRecords.filter((record) => record.mode === "acquisition-window").length,
        corroboratedRows: publicRecords.filter((record) => record.corroborationStatus === "matched").length,
        rowsWithExternalSources: publicRecords.filter((record) => record.sourceUrls.length).length,
      },
    },
    records: publicRecords,
  };
  writeFileSync(outPath, `${JSON.stringify(output, null, 2)}\n`);
  console.log(`Built ${outPath}: ${publicRecords.length} public rows across ${output.metadata.coverage.portfolios} portfolios; ${output.metadata.coverage.excludedPrivateRows} internal rows excluded`);
} finally {
  rmSync(temporaryDirectory, { recursive: true, force: true });
}
