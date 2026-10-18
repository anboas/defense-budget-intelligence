import { ControlFactGrid } from "control-surface-ui/react";
import { WORK_CATEGORY_BY_ID } from "./procurement-taxonomy.js";
import "./OpportunityFactSummary.css";

function money(value) {
  const amount = Number(value || 0);
  if (!Number.isFinite(amount) || !amount) return "Not published";
  if (Math.abs(amount) >= 1_000_000_000) return `$${(amount / 1_000_000_000).toFixed(1)}B`;
  if (Math.abs(amount) >= 1_000_000) return `$${(amount / 1_000_000).toFixed(1)}M`;
  return `$${Math.round(amount).toLocaleString()}`;
}

function date(value) {
  if (!value) return "Not published";
  const parsed = new Date(`${String(value).slice(0, 10)}T12:00:00Z`);
  return Number.isNaN(parsed.getTime()) ? "Not published" : parsed.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

export default function OpportunityFactSummary({ record, liveAward = null, label = "Opportunity decision facts", compact = false, ...props }) {
  const observed = Number(liveAward?.awardAmountDollars || record?.obligatedAmount || 0);
  const potential = Number(record?.potentialAmount || record?.valueHigh || 0);
  const utilization = potential ? Math.min((observed / potential) * 100, 100) : null;
  const work = WORK_CATEGORY_BY_ID.get(record?.workCategory)?.label || record?.workCategory || "Unclassified";
  const items = [
    { label: "Customer / sponsor", value: liveAward?.recipient || record?.party || record?.owner || "Not published", meta: record?.contractingOffice || "Buying office not published", wide: true },
    { label: "Reference", value: record?.reference || record?.noticeId || record?.id || "Not published", meta: record?.vehicle || record?.context || "Vehicle not identified" },
    { label: record?.mode === "acquisition-window" ? "Decision window" : "Reported term", value: `${date(record?.start || record?.solicitationStart)} to ${date(record?.solicitationEnd || record?.currentEnd)}`, meta: record?.potentialEnd ? `Potential through ${date(record.potentialEnd)}` : "No later end published" },
    { label: "Published money", value: money(observed || potential), meta: observed && potential ? `${Math.round(utilization)}% of ${money(potential)} potential` : observed ? "Exact observed obligations" : potential ? "Published potential / high value" : "No comparable value published" },
    { label: "Type of work", value: work, meta: [record?.pscCode ? `PSC ${record.pscCode}` : "", record?.naicsCode ? `NAICS ${record.naicsCode}` : ""].filter(Boolean).join(" · ") || "Codes not published", wide: true },
    { label: "Evidence posture", value: String(record?.evidenceTier || record?.validationStatus || "Unknown").replaceAll("_", " "), meta: record?.sourceRoleCount ? `${record.sourceRoleCount} retained source roles` : record?.ingestionLabel || "Source posture not published" },
  ];
  return <ControlFactGrid {...props} className={compact ? "opportunity-fact-summary opportunity-fact-summary--compact" : "opportunity-fact-summary"} label={label} mobileTwoColumn items={items} data-opportunity-fact-summary />;
}
