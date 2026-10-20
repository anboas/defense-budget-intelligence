import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { ArrowLeft, ExternalLink, MoreHorizontal, Network, Pin, PinOff, Sparkles, Star } from "lucide-react";
import { ControlAsyncState, ControlDisclosure, ControlFactGrid, ControlMenu, ControlTabs } from "control-surface-ui/react";
import SemanticStatusBadge from "./SemanticStatusBadge.jsx";
import ConnectedEvidence from "./ConnectedEvidence.jsx";
import OpportunityFactSummary from "./OpportunityFactSummary.jsx";
import RecordIntelligenceNotice from "./RecordIntelligenceNotice.jsx";
import { OpportunityLifecycle, OpportunityResearchReport } from "./OpportunityWorkspaceModules.jsx";
import { accountFlowRoute, awardsRoute, classificationRoute, dataLibraryRoute, intelligenceGraphRoute, intelligenceWorkspaceRoute, mapLocationRoute, timelineRoute } from "./cross-surface-routes.js";
import { readPinnedIntelligence, togglePinnedIntelligence } from "./intelligence-history.js";
import { intelligenceTypeLabel, loadIntelligenceSearchIndex } from "./intelligence-search.js";
import { useManagementState } from "./management-state.js";
import { normalizePursuit } from "./pursuit-metadata.js";
import { applyProcurementChanges, assembleProcurementRecords } from "./procurement-taxonomy.js";
import { useRecordIntelligence } from "./record-intelligence.js";
import "./UniversalIntelligenceWorkspace.css";

const OrganizationRelationshipLens = lazy(() => import("./OrganizationRelationshipLens.jsx"));
const OpportunityCommandRail = lazy(() => import("./OpportunityCommandRail.jsx"));
const WORKSPACE_TABS = [
  ["overview", "Overview"],
  ["timeline", "Timeline"],
  ["connections", "Connections"],
  ["money", "Money"],
  ["evidence", "Evidence"],
  ["tasks", "Actions"],
];

function recordId(record) {
  return record?.opportunityId || record?.sourceRecordId || record?.noticeId || record?.id || record?.reference || "";
}

function money(value) {
  const amount = Number(value || 0);
  if (!amount) return "Not published";
  if (Math.abs(amount) >= 1e9) return `$${(amount / 1e9).toFixed(1)}B`;
  if (Math.abs(amount) >= 1e6) return `$${(amount / 1e6).toFixed(1)}M`;
  return `$${Math.round(amount).toLocaleString()}`;
}

function safeReturn(value) {
  const path = String(value || "").replace(/^#/, "");
  return /^\/(budget-spend|workspace|profile|intelligence)(\/|$)/.test(path) ? `#${path}` : "#/budget-spend/explorer?spendView=table";
}

function genericDestination(entity) {
  if (!entity) return "#/budget-spend/library";
  const facts = entity.facts || [];
  if (entity.entityType === "organization" || entity.entityType === "person" || entity.entityType === "official-role" || entity.entityType === "program-office") return dataLibraryRoute({ query: entity.label });
  if (entity.entityType === "award") return awardsRoute(facts[0] || entity.id, entity.label);
  if (entity.entityType === "federal-account") return accountFlowRoute(facts[0] || entity.id.replace(/^account:/, ""));
  if (entity.entityType === "classification") return classificationRoute(entity.label);
  if (entity.entityType === "location") return mapLocationRoute(entity.id, entity.label);
  if (entity.entityType === "contract-vehicle") return timelineRoute("", { vehicle: facts[0] || entity.label });
  return "#/budget-spend/domain-model";
}

function updateWorkspaceTab(entityType, entityId, tab, params) {
  window.location.assign(intelligenceWorkspaceRoute({
    entityType,
    entityId,
    tab,
    query: params.get("workspaceQuery") || "",
    returnTo: params.get("returnTo") || "",
    origin: params.get("origin") || "",
  }));
}

function returnLabel(origin = "") {
  const labels = { analytics: "Analytics", library: "Data Library", opportunities: "Opportunities", timeline: "Timeline", today: "Today" };
  return labels[origin] || "Previous view";
}

function OpportunityOverview({ record, records, intelligence }) {
  const assessment = record.fitAssessment || { reasons: [], methodology: "No scoring method is published for this record." };
  const facts = [
    { label: "Record identity", value: record.reference || record.id || record.opportunityId, meta: record.opportunityId, wide: true },
    { label: "Customer / sponsor", value: record.party || "Not published", meta: record.owner || record.contractingOffice || "Office not published", wide: true },
    { label: "Lifecycle", value: String(record.lifecycleStatus || record.status || "published").replaceAll("-", " "), meta: record.noticeType || record.mode || "Retained record" },
    { label: "Published value", value: money(record.potentialAmount || record.valueHigh || record.obligatedAmount), meta: record.obligatedAmount ? `${money(record.obligatedAmount)} observed obligations` : "Value basis retained from source" },
    { label: "PSC / NAICS", value: record.pscCode ? `PSC ${record.pscCode}` : "PSC not published", meta: record.naicsCode ? `NAICS ${record.naicsCode}` : "NAICS not published" },
    { label: "Evidence", value: record.evidenceTier || "Unclassified", meta: `${record.sourceUrls?.length || 0} retained source links` },
  ];
  return <div className="universal-workspace__overview" data-workspace-overview>
    <section className="if-panel"><header className="if-panel__header"><div><h2 className="if-panel__title">Decision context</h2><p className="if-panel__subtitle">The essential facts, fit rationale, and latest cited research in one place.</p></div></header><div className="if-panel__body"><ControlFactGrid label="Opportunity facts" mobileTwoColumn items={facts} /></div></section>
    <section className="if-panel"><header className="if-panel__header"><div><h2 className="if-panel__title">Why it fits</h2><p className="if-panel__subtitle">Published capability and classification signals, not a win probability.</p></div></header><div className="if-panel__body"><ul>{assessment.reasons?.length ? assessment.reasons.slice(0, 6).map((reason) => <li key={reason}>{reason}</li>) : <li>No strong retained fit signal is published.</li>}</ul><ControlDisclosure compact title="Scoring method" summary="Explainable fit factors and evidence boundary"><p>{assessment.methodology}</p></ControlDisclosure></div></section>
    <section className="if-panel"><header className="if-panel__header"><div><h2 className="if-panel__title">Latest research</h2><p className="if-panel__subtitle">Official-source decision support remains tied to its cited report.</p></div></header><div className="if-panel__body">{intelligence.reports[0] ? <><p>{intelligence.reports[0].summary}</p><ControlFactGrid label="Research coverage" mobileTwoColumn items={[{ label: "Findings", value: intelligence.reports[0].findings?.length || 0 }, { label: "Key dates", value: intelligence.reports[0].keyDates?.length || 0 }, { label: "Risks", value: intelligence.reports[0].risks?.length || 0 }]} /></> : <ControlAsyncState compact state="empty" title="No AI research yet" message="Run research from the context rail to build a cited brief." />}</div></section>
    <OpportunityLifecycle record={record} records={records} intelligence={intelligence} />
  </div>;
}

function GenericWorkspace({ entity, tab }) {
  const facts = (entity.facts || []).map((value, index) => ({ label: ["Identity", "Context", "Status", "Value", "Additional fact"][index] || `Fact ${index + 1}`, value: typeof value === "number" ? value.toLocaleString() : String(value) }));
  const destination = genericDestination(entity);
  if (tab === "connections" && entity.entityType === "organization") return <Suspense fallback={<ControlAsyncState compact state="loading" title="Loading organization relationships" message="Resolving the reviewed dossier and evidence lanes." />}><OrganizationRelationshipLens dossierId="" record={null} organizationQuery={entity.label} compact embedded /></Suspense>;
  return <section className="if-panel universal-workspace__generic" data-generic-workspace-tab={tab}><header className="if-panel__header"><div><h2 className="if-panel__title">{WORKSPACE_TABS.find(([id]) => id === tab)?.[1] || "Overview"}</h2><p className="if-panel__subtitle">{tab === "overview" ? "Canonical identity and retained source facts." : `This ${intelligenceTypeLabel(entity.entityType).toLowerCase()} does not yet publish a dedicated ${tab} projection.`}</p></div></header><div className="if-panel__body">{facts.length ? <ControlFactGrid label="Retained entity facts" mobileTwoColumn items={facts} /> : <ControlAsyncState compact state="empty" title="No compact facts published" message="Open the specialist surface for the complete retained record." />}</div><footer className="if-panel__footer"><a className="if-btn if-btn--primary" href={destination}>Open specialist surface</a></footer></section>;
}

export default function UniversalIntelligenceWorkspace({ dataset, awards = [], samOpportunities = { records: [] }, manualProcurement = { records: [] }, procurementDelta = { records: [] }, subawardSnapshot = { primes: [] }, routeHash = "" }) {
  const params = new URLSearchParams(String(routeHash).split("?")[1] || "");
  const entityType = params.get("entityType") || "activity";
  const entityId = params.get("entityId") || params.get("capRecord") || "";
  const tab = WORKSPACE_TABS.some(([id]) => id === params.get("workspaceTab")) ? params.get("workspaceTab") : "overview";
  const records = useMemo(() => applyProcurementChanges(assembleProcurementRecords(dataset?.records || [], awards, dataset?.metadata?.asOf, samOpportunities.records || [], manualProcurement.records || [], subawardSnapshot), procurementDelta.records || [], []), [awards, dataset, manualProcurement.records, procurementDelta.records, samOpportunities.records, subawardSnapshot]);
  const record = entityType === "activity" ? records.find((candidate) => recordId(candidate) === entityId) || null : null;
  const management = useManagementState(records);
  const intelligence = useRecordIntelligence(records, record ? entityId : "");
  const [indexState, setIndexState] = useState({ status: entityType === "activity" ? "ready" : "loading", items: [] });
  const [pinRevision, setPinRevision] = useState(0);
  useEffect(() => {
    if (entityType === "activity") return undefined;
    let active = true;
    loadIntelligenceSearchIndex().then((payload) => { if (active) setIndexState({ status: "ready", items: payload.items || [] }); }).catch((error) => { if (active) setIndexState({ status: "error", items: [], error }); });
    return () => { active = false; };
  }, [entityType]);
  const workspaceQuery = params.get("workspaceQuery") || "";
  const entity = record ? { id: entityId, entityType: "activity", label: record.title || record.reference, facts: [record.reference, record.party, record.lifecycleStatus, record.sourceSystem] } : indexState.items.find((item) => item.id === entityId && item.entityType === entityType) || (workspaceQuery ? indexState.items.find((item) => item.entityType === entityType && item.label.toLowerCase() === workspaceQuery.toLowerCase()) : null) || null;
  if (!entity && indexState.status === "loading") return <ControlAsyncState state="loading" title="Opening intelligence workspace" message="Resolving the retained entity and its available analysis lenses." />;
  if (!entity) return <ControlAsyncState state="empty" title="Entity not found" message="Use Find to open a current opportunity, organization, award, account, program, or other retained entity." action={<a className="if-btn if-btn--primary" href="#/budget-spend/explorer?spendView=table">Open Opportunities</a>} />;
  const watch = record ? management.watchlist.find((entry) => entry.recordId === entityId) || null : null;
  void pinRevision;
  const pinned = readPinnedIntelligence().some((item) => item.id === entity.id && item.entityType === entity.entityType);
  const backHref = safeReturn(params.get("returnTo"));
  const status = record ? String(record.lifecycleStatus || record.status || "published").replaceAll("-", " ") : intelligenceTypeLabel(entity.entityType);
  const analysisView = tab === "timeline" ? "timeline" : tab === "money" ? "money" : "connections";
  const researchBusy = Boolean(intelligence?.activeJob || ["queued", "in_progress", "researching"].includes(intelligence?.state));
  const sourceUrl = record?.sourceUrl || record?.sourceUrls?.[0] || "";
  const origin = params.get("origin") || "";

  async function toggleTracking() {
    if (!record || !management.canWrite) return;
    if (watch) management.toggleWatch(entityId);
    else await management.savePursuit(entityId, normalizePursuit());
  }

  return <div className="universal-workspace" data-universal-intelligence-workspace data-entity-type={entity.entityType} data-workspace-tab={tab}>
    <header className="universal-workspace__header">
      <div className="universal-workspace__identity"><div className="universal-workspace__identity-line"><a className="universal-workspace__back" href={backHref} aria-label={`Return to ${returnLabel(origin)}`}><ArrowLeft size={13} />{returnLabel(origin)}</a><small>{intelligenceTypeLabel(entity.entityType)}</small></div><h1>{entity.label}</h1><p>{record ? [record.reference, record.party, record.contractingOffice || record.owner].filter(Boolean).join(" · ") : entity.facts?.slice(0, 3).join(" · ") || entity.sourceArtifact}</p></div>
      <div className="universal-workspace__header-actions" aria-label="Workspace actions"><SemanticStatusBadge category={record ? "workflow" : "evidence"} value={status} />{record ? <><button type="button" className={watch ? "if-btn if-btn--secondary if-btn--sm is-active" : "if-btn if-btn--secondary if-btn--sm"} aria-pressed={Boolean(watch)} disabled={!management.canWrite} onClick={() => void toggleTracking()}><Star size={13} fill={watch ? "currentColor" : "none"} />{watch ? "Tracked" : "Track"}</button><button type="button" className="if-btn if-btn--ai if-btn--sm" disabled={!intelligence?.canWrite || researchBusy} aria-label="Build AI decision brief" aria-busy={researchBusy} onClick={() => { void intelligence?.research().catch(() => {}); }}><Sparkles size={13} />{researchBusy ? "Researching…" : "Research"}</button></> : null}<button type="button" className="if-btn if-btn--secondary if-btn--sm" aria-pressed={pinned} onClick={() => { togglePinnedIntelligence(entity); setPinRevision((value) => value + 1); }}>{pinned ? <PinOff size={13} /> : <Pin size={13} />}{pinned ? "Unpin" : "Pin"}</button>{record ? <a className="if-btn if-btn--secondary if-btn--sm" href={intelligenceGraphRoute(entityId)}><Network size={13} />Graph</a> : <a className="if-btn if-btn--secondary if-btn--sm" href={genericDestination(entity)}>Specialist view<ExternalLink size={13} /></a>}{sourceUrl ? <ControlMenu label="More" ariaLabel="More workspace actions" icon={<MoreHorizontal size={13} />} triggerClassName="if-btn if-btn--secondary if-btn--sm" items={[{ id: "source", label: "Official source", description: "Open the published record", href: sourceUrl, target: "_blank", rel: "noreferrer", icon: <ExternalLink size={14} /> }]} /> : null}</div>
    </header>
    <ControlTabs className="universal-workspace__tabs" ariaLabel="Intelligence workspace views" activeId={tab} onSelect={(id) => updateWorkspaceTab(entityType, entityId, id, params)} items={WORKSPACE_TABS} />
    {record ? <RecordIntelligenceNotice intelligence={intelligence} /> : null}
    <div className="universal-workspace__layout">
      <aside className="universal-workspace__context" aria-label="Selected entity context">
        {record ? <><OpportunityFactSummary record={record} compact />{tab !== "tasks" ? <Suspense fallback={<ControlAsyncState compact state="loading" title="Loading pursuit controls" />}><OpportunityCommandRail compact record={record} watch={watch} canWrite={management.canWrite} onSavePursuit={management.savePursuit} onToggleTrack={management.toggleWatch} intelligence={intelligence} showRecordLink={false} showActions={false} workspaceActions={management.watchlist} /></Suspense> : null}</> : <section className="if-panel"><header className="if-panel__header"><div><h2 className="if-panel__title">Entity context</h2><p className="if-panel__subtitle">Stable identity across every analysis surface.</p></div></header><div className="if-panel__body"><ControlFactGrid label="Entity context" items={(entity.facts || []).slice(0, 4).map((value, index) => ({ label: ["Primary identifier", "Context", "Status", "Value"][index], value: typeof value === "number" ? value.toLocaleString() : String(value) }))} /></div></section>}
      </aside>
      <main className="universal-workspace__analysis" aria-label={`${WORKSPACE_TABS.find(([id]) => id === tab)?.[1]} analysis`}>
        {record && tab === "overview" ? <OpportunityOverview record={record} records={records} intelligence={intelligence} /> : null}
        {record && ["timeline", "connections", "money"].includes(tab) ? <ConnectedEvidence opportunityId={entityId} record={record} researchReport={intelligence.reports[0]} fullView workspace view={analysisView} showViewNavigation={false} /> : null}
        {record && tab === "evidence" ? <div className="universal-workspace__evidence"><ConnectedEvidence opportunityId={entityId} record={record} researchReport={intelligence.reports[0]} fullView workspace view="connections" showViewNavigation={false} ledgerOpen /><section className="if-panel"><header className="if-panel__header"><div><h2 className="if-panel__title">Cited research brief</h2><p className="if-panel__subtitle">Complete official-source findings, dates, risks, and approved task handoffs.</p></div></header><div className="if-panel__body"><OpportunityResearchReport report={intelligence.reports[0]} recordId={entityId} /></div></section></div> : null}
        {record && tab === "tasks" ? <Suspense fallback={<ControlAsyncState compact state="loading" title="Loading action plan" />}><OpportunityCommandRail record={record} watch={watch} canWrite={management.canWrite} onSavePursuit={management.savePursuit} onToggleTrack={management.toggleWatch} intelligence={intelligence} showRecordLink={false} showActions={false} workspaceActions={management.watchlist} /></Suspense> : null}
        {!record ? <GenericWorkspace entity={entity} tab={tab} /> : null}
      </main>
    </div>
  </div>;
}
