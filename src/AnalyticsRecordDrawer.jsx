import { ControlDisclosure, ControlDrawer, ControlFactGrid } from "control-surface-ui/react";
import { WORK_CATEGORY_BY_ID } from "./procurement-taxonomy.js";
import { intelligenceWorkspaceRoute, timelineRoute } from "./cross-surface-routes.js";
import { analysisDrawerBodyStyle, analysisDrawerStyle } from "./analysis-workspace.js";
import EntityPreview from "./EntityPreview.jsx";

function money(value) {
  const amount = Number(value || 0);
  if (!amount) return "$0";
  if (amount >= 1_000_000_000) return `$${(amount / 1_000_000_000).toFixed(1)}B`;
  if (amount >= 1_000_000) return `$${(amount / 1_000_000).toFixed(1)}M`;
  return `$${Math.round(amount / 1_000).toLocaleString()}K`;
}

export default function AnalyticsRecordDrawer({ record, onClose }) {
  if (!record) return null;
  const primaryFacts = [
    { id: "party", label: "Recipient / sponsor", value: record.party || "Not published", wide: true },
    { id: "work", label: "Type of work", value: WORK_CATEGORY_BY_ID.get(record.workCategory)?.label || "Other / unclassified", meta: record.workCategoryBasis || "No classification basis published", wide: true },
    { id: "obligations", label: "Observed obligations", value: money(record.obligatedAmount) },
    { id: "potential", label: "Reported potential", value: money(record.potentialAmount || record.valueHigh || record.obligatedAmount || record.valueLow) },
  ];
  const secondaryFacts = [
    { id: "schedule", label: "Reported schedule", value: `${record.start || record.solicitationStart || "Unknown"} → ${record.currentEnd || record.solicitationEnd || "Unknown"}`, wide: true },
    { id: "structure", label: "Acquisition structure", value: [record.vehicle, record.pricingType, record.awardType].filter(Boolean).join(" · ") || "Not published", meta: record.setAside || record.competitionType || "Competition not published", wide: true },
    { id: "actions", label: "FPDS actions", value: Number(record.transactionSummary?.actions || 0).toLocaleString() },
    { id: "subawards", label: "Reported subawards", value: Number(record.subawardSummary?.reportedCount || 0).toLocaleString(), meta: record.subawardSummary?.detailTruncated ? "Recent detail is sampled" : "Exact prime count where available" },
    { id: "provenance", label: "Ingestion provenance", value: record.ingestionLabel || record.ingestionMethod || "Not published", meta: record.sourceSystem || "Source system not published", wide: true },
  ];
  return <ControlDrawer
    open
    onClose={onClose}
    title={record.title}
    size="detail"
    className="analysis-workspace-drawer"
    closeLabel="Close analytical detail"
    drawerProps={{ "data-analytics-record-drawer": "", "data-analysis-workspace": true, style: analysisDrawerStyle }}
    bodyProps={{ className: "if-record-detail if-record-detail--intelligence analysis-workspace-drawer__body", style: analysisDrawerBodyStyle }}
  >
    <EntityPreview eyebrow={record.mode === "acquisition-window" ? "Acquisition record" : "Contract record"} title={record.title} reference={record.id} summary="Published analytical facts, schedule, structure, and provenance." statusCategory="workflow" status={record.lifecycleStatus || record.status || "monitor"} facts={<ControlFactGrid label="Primary analytical record facts" mobileTwoColumn items={primaryFacts} />} evidence={record.ingestionLabel || record.sourceSystem || "Retained public-source evidence"} primaryHref={intelligenceWorkspaceRoute({ entityType: "activity", entityId: record.opportunityId, returnTo: typeof window === "undefined" ? "" : window.location.hash, origin: "analytics" })} secondaryActions={<><a className="if-btn if-btn--secondary" href={timelineRoute(record.opportunityId)}>Timeline</a>{(record.sourceUrls || []).slice(0, 1).map((url, index) => <a className="if-btn if-btn--secondary" key={url} href={url} target="_blank" rel="noreferrer">Source {index + 1}</a>)}</>}><ControlDisclosure title="Schedule, structure, and provenance" summary={`${secondaryFacts.length} supporting record facts`}><ControlFactGrid label="Supporting analytical record facts" mobileTwoColumn items={secondaryFacts} /></ControlDisclosure></EntityPreview>
  </ControlDrawer>;
}
