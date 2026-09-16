import { useState } from "react";
import { ChevronRight } from "lucide-react";
import { ControlAsyncState, ControlMetricStrip, ControlPageBody, ControlPageHeader } from "control-surface-ui/react";
import sourceHealth from "./data/source-health.json";
import OpenAiKeyManagement from "./OpenAiKeyManagement.jsx";
import OperationalDataTable from "./OperationalDataTable.jsx";

function dateTime(value) {
  const date = new Date(value || "");
  if (Number.isNaN(date.getTime())) return "Unavailable";
  return date.toLocaleString([], { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
}

function compactDate(value) {
  if (!value) return "Not scheduled";
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return "Not scheduled";
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

function freshnessState(timestamp, maxAgeDays) {
  if (!timestamp) return { label: "Unavailable", tone: "unavailable" };
  const ageDays = Math.max(0, (Date.now() - new Date(timestamp).getTime()) / 86400000);
  return ageDays <= maxAgeDays ? { label: "Current", tone: "current" } : { label: "Review", tone: "stale" };
}

function IntegrationFreshness({ budgetGeneratedAt, awardGeneratedAt, contractMonitor }) {
  const layers = [
    { id: "budget", label: "Budget books", mobileLabel: "Budget", at: budgetGeneratedAt, maxAgeDays: 400 },
    { id: "awards", label: "Award execution", mobileLabel: "Awards", at: awardGeneratedAt, maxAgeDays: 14 },
    { id: "health", label: "Source health", mobileLabel: "Sources", at: sourceHealth.metadata.checkedAt, maxAgeDays: 7 },
    { id: "contracts", label: "Contract monitor", mobileLabel: "Contracts", at: contractMonitor.metadata.generatedAt, maxAgeDays: 2 },
  ];
  return <section className="freshness-strip" aria-label="Data freshness" data-freshness-strip data-integration-freshness>{layers.map((layer) => {
    const state = freshnessState(layer.at, layer.maxAgeDays);
    return <span key={layer.id} className={`freshness-chip freshness-chip--${state.tone}`} title={`${layer.label}: ${state.label} · ${layer.at ? dateTime(layer.at) : "No snapshot"}`}><strong data-mobile-label={layer.mobileLabel}>{layer.label}</strong><em>{state.label}</em><small>{layer.at ? dateTime(layer.at) : "No snapshot"}</small></span>;
  })}</section>;
}

function ContractMonitorCoverage({ contractMonitor }) {
  const metadata = contractMonitor.metadata || {};
  const rows = contractMonitor.records || [];
  const columns = [
    { key: "contract", label: "Contract", required: true, sticky: true, minWidth: 260, value: (row) => `${row.reference || "Unidentified"} ${row.title}`, render: (row) => <><strong>{row.reference || "Identifier unavailable"}</strong><small>{row.title}</small></> },
    { key: "lifecycle", label: "Lifecycle", facet: true, minWidth: 135, value: (row) => row.lifecycle, render: (row) => row.lifecycle.replaceAll("-", " ") },
    { key: "status", label: "Automation", facet: true, minWidth: 135, value: (row) => row.status, render: (row) => <span className={`dbi-status-badge is-${row.status}`}>{row.status.replaceAll("-", " ")}</span> },
    { key: "method", label: "Method", facet: true, minWidth: 200, value: (row) => row.method, render: (row) => <><strong>{row.method.replaceAll("-", " ")}</strong><small>{row.generatedAwardId || row.sourceSystem || "No exact automated key"}</small></> },
    { key: "checked", label: "Checked", minWidth: 165, value: (row) => row.checkedAt || row.lastAttemptAt || "", render: (row) => row.checkedAt || row.lastAttemptAt ? dateTime(row.checkedAt || row.lastAttemptAt) : "Not refreshable" },
    { key: "diagnostic", label: "Coverage note", minWidth: 260, role: "prose", value: (row) => row.diagnostic?.message || "Exact public record refreshed.", render: (row) => row.diagnostic?.message || "Exact public record refreshed." },
  ];
  return <div data-contract-monitor>
    <p className="if-detail-card__summary">{metadata.methodology} {metadata.sourceUrls?.[0] ? <a href={metadata.sourceUrls[0]} target="_blank" rel="noreferrer">Open USAspending source<ChevronRight size={15} /></a> : null}</p>
    <ControlMetricStrip mobileScroll label="Contract monitor summary" data-contract-monitor-summary items={[
      { id: "targets", label: "Known targets", value: Number(metadata.targetCount || 0).toLocaleString(), meta: `${Number(metadata.byLifecycle?.active || 0).toLocaleString()} active · ${Number(metadata.byLifecycle?.upcoming || 0).toLocaleString()} upcoming`, tone: "info" },
      { id: "coverage", label: "Automated coverage", value: `${metadata.coveragePercent || 0}%`, meta: `${Number(metadata.currentCount || 0).toLocaleString()} current · ${Number(metadata.staleCount || 0).toLocaleString()} stale`, tone: "success" },
      { id: "gaps", label: "Exact-key gaps", value: Number(metadata.gapCount || 0).toLocaleString(), meta: `${Number(metadata.byLifecycle?.["unresolved-schedule"] || 0).toLocaleString()} unscheduled`, tone: "warning" },
      { id: "completed", label: "Last completed", value: metadata.generatedAt ? compactDate(metadata.generatedAt) : "Unavailable", meta: metadata.status || "unknown", tone: "neutral" },
    ]} />
    <OperationalDataTable id="contract-monitor" label="Active and upcoming contract automation" rows={rows} columns={columns} rowKey={(row) => row.opportunityId} defaultSort={{ key: "status", direction: "asc" }} searchPlaceholder="Search monitored contracts, identifiers, lifecycle, methods, and gaps…" exportFilename="contract-monitor.csv" selectable={false} wrapperProps={{ "data-contract-monitor-table": true }} />
  </div>;
}

export default function IntegrationManagement({ auth, dataset, samOpportunities, manualProcurement, procurementDelta, subawardSnapshot, budgetGeneratedAt, awardGeneratedAt, contractMonitor, contractMonitorState, onRetryContractMonitor }) {
  const [surface, setSurface] = useState("coverage");
  const rows = [
    { name: "PDB display books", status: "current", count: "3,888 request lines", detail: "Scheduled workbook and justification build" },
    { name: "USAspending prime awards", status: "current", count: `${dataset.metadata?.coverage?.totalPublicRecords?.toLocaleString?.() || "875"} assembled records`, detail: "Automatic award feed plus normalized source records" },
    { name: "FPDS actions", status: "current", count: `${Number(dataset.metadata?.coverage?.fpdsActions || 0).toLocaleString()} actions`, detail: "Deferred exact action payload" },
    { name: "USAspending subawards", status: subawardSnapshot.metadata?.status || "unavailable", count: `${Number(subawardSnapshot.metadata?.reportedSubawardCount || 0).toLocaleString()} reported`, detail: `${Number(subawardSnapshot.metadata?.failedPrimeCount || 0).toLocaleString()} unavailable prime probes disclosed` },
    { name: "SAM.gov opportunities", status: samOpportunities.metadata?.status || "unavailable", count: `${Number(samOpportunities.metadata?.recordCount || samOpportunities.records?.length || 0).toLocaleString()} records`, detail: "Credentialed rolling-window importer" },
    { name: "Manual / CRM imports", status: "ready", count: `${Number(manualProcurement.records?.length || 0).toLocaleString()} records`, detail: "Stable procurement identifiers required" },
    { name: "Change detection", status: procurementDelta.metadata?.status || "baseline", count: `${Number(procurementDelta.summary?.added || 0) + Number(procurementDelta.summary?.updated || 0)} changes`, detail: "Deterministic consecutive-snapshot comparison" },
    { name: "Known contract monitor", status: contractMonitor.metadata?.status || "unavailable", count: `${Number(contractMonitor.metadata?.coveredCount || 0).toLocaleString()} of ${Number(contractMonitor.metadata?.targetCount || 0).toLocaleString()} covered`, detail: "Exact award-detail refresh across active, upcoming, option-horizon, and unresolved records" },
  ];
  const columns = [
    { key: "name", label: "Integration", required: true, sticky: true, minWidth: 230, value: (row) => row.name, render: (row) => <><strong>{row.name}</strong><small>{row.detail}</small></> },
    { key: "status", label: "Status", facet: true, minWidth: 110, value: (row) => row.status, render: (row) => <span className={`dbi-status-badge is-${String(row.status).toLowerCase().replaceAll(" ", "-")}`}>{row.status}</span> },
    { key: "count", label: "Current yield", minWidth: 150, value: (row) => row.count, render: (row) => <strong>{row.count}</strong> },
    { key: "health", label: "Health checked", value: () => dateTime(sourceHealth.metadata?.checkedAt) },
  ];
  return <section className="ops-panel" data-ops-integrations data-integration-surface={surface}>
    <ControlPageHeader compact divided eyebrow="Workspace administration" title="Integrations" summary="Connector health, credentials, refresh cadence, and source coverage." headingLevel={2} actions={surface === "coverage" ? <a className="if-btn if-btn--secondary" href="#/budget-spend/sources">Open full lineage<ChevronRight size={15} /></a> : null} />
    <ControlPageBody compact>
      <nav className="if-tabs__list" aria-label="Integration surface">
        <button type="button" className={`if-tab${surface === "coverage" ? " is-active" : ""}`} aria-pressed={surface === "coverage"} onClick={() => setSurface("coverage")}>Sources &amp; coverage <span className="if-badge">{rows.length}</span></button>
        <button type="button" className={`if-tab${surface === "credentials" ? " is-active" : ""}`} aria-pressed={surface === "credentials"} onClick={() => setSurface("credentials")}>Credentials</button>
      </nav>
      {surface === "credentials" ? <OpenAiKeyManagement auth={auth} scope="workspace" embedded /> : <>
        <ControlMetricStrip mobileScroll label="Source health summary" items={[
          { id: "online", label: "Sources online", value: sourceHealth.totals?.online || 0, meta: "Available at last probe", tone: "success" },
          { id: "unavailable", label: "Unavailable", value: sourceHealth.totals?.unavailable || 0, meta: "At last probe", tone: sourceHealth.totals?.unavailable ? "warning" : "neutral" },
          { id: "checked", label: "Health checked", value: dateTime(sourceHealth.metadata?.checkedAt), meta: "Point-in-time source probe", tone: "info" },
        ]} />
        <OperationalDataTable id="integrations" label="Integration status" rows={rows} columns={columns} rowKey={(row) => row.name} defaultSort={{ key: "name", direction: "asc" }} searchPlaceholder="Search integrations and feed details…" exportFilename="integration-status.csv" selectable={false} wrapperProps={{ "data-ops-integration-table": true }} />
        <details className="if-detail-card if-detail-card--info" data-contract-monitor-disclosure>
          <summary>Contract monitor coverage <span className="if-badge">{contractMonitorState === "loading" ? "Loading" : contractMonitorState === "error" ? "Unavailable" : contractMonitor.metadata?.status || "Ready"}</span></summary>
          {contractMonitorState === "loading" ? <ControlAsyncState compact state="loading" title="Loading contract coverage" message="Reading the current automated coverage snapshot." /> : contractMonitorState === "error" ? <ControlAsyncState compact state="error" title="Contract coverage unavailable" message="The retained integration summary remains available." action={<button type="button" className="if-btn if-btn--secondary" onClick={onRetryContractMonitor}>Retry</button>} /> : <><IntegrationFreshness budgetGeneratedAt={budgetGeneratedAt} awardGeneratedAt={awardGeneratedAt} contractMonitor={contractMonitor} /><ContractMonitorCoverage contractMonitor={contractMonitor} /></>}
        </details>
      </>}
    </ControlPageBody>
  </section>;
}
