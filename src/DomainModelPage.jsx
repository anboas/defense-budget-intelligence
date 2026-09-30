import { useEffect, useMemo, useState } from "react";
import { ControlAsyncState, ControlPageHeader } from "control-surface-ui/react";
import { AlertTriangle, Clock3, Database, Download, GitBranch, Network, ShieldCheck } from "lucide-react";
import { useAuth } from "./AuthContext.jsx";
import ConnectedEvidence from "./ConnectedEvidence.jsx";
import { loadIntelligenceGraphSummary } from "./intelligence-graph.js";
import "./DomainModelPage.css";

const ENTITY_META = {
  activity: ["Activities", "opportunity"],
  award: ["Awards", "execution"],
  event: ["Events", "opportunity"],
  transaction: ["FPDS actions", "execution"],
  organization: ["Organizations", "organization"],
  "organization-identifier": ["Organization identifiers", "organization"],
  "contract-vehicle": ["Parent vehicles", "lineage"],
  "acquisition-path": ["Acquisition paths", "lineage"],
  "recompete-signal": ["Timing signals", "lineage"],
  "evidence-claim": ["Evidence claims", "evidence"],
  "evidence-conflict": ["Evidence conflicts", "evidence"],
  location: ["Locations", "geography"],
  "federal-account": ["Federal accounts", "funding"],
  "budget-line": ["Budget lines", "funding"],
  "subaward-summary": ["Subaward sets", "execution"],
  "spending-observation": ["Spending observations", "execution"],
  "opportunity-notice": ["SAM notices", "opportunity"],
  "notice-version": ["Notice versions", "opportunity"],
  "award-action": ["Award actions", "execution"],
  "vendor-registration": ["Vendor registrations", "organization"],
  "business-certification": ["Business certifications", "organization"],
  "organization-hierarchy-observation": ["Hierarchy observations", "organization"],
  subaward: ["Acquisition subawards", "execution"],
  "treasury-account": ["Treasury accounts", "funding"],
  "apportionment-revision": ["Apportionment revisions", "funding"],
  "execution-balance": ["Execution balances", "funding"],
  "program-activity": ["Program activities", "funding"],
  "object-class": ["Object classes", "funding"],
  "treasury-outlay-observation": ["Treasury outlays", "funding"],
  "legislative-measure": ["Legislative measures", "legislation"],
  "legislative-version": ["Bill versions", "legislation"],
  "committee-report": ["Committee reports", "legislation"],
  "enacted-provision": ["Enacted provisions", "legislation"],
  "appropriation-mark": ["Appropriation marks", "legislation"],
  "budget-adjustment": ["Budget adjustments", "legislation"],
  "program-element": ["Program elements", "funding"],
  project: ["Budget projects", "funding"],
  "defense-program": ["Defense programs", "programs"],
  "program-office": ["Program offices", "programs"],
  "acquisition-milestone": ["Acquisition milestones", "programs"],
  "program-baseline": ["Program baselines", "programs"],
  "cost-estimate": ["Cost estimates", "programs"],
  "schedule-event": ["Schedule events", "programs"],
  "unit-cost-breach": ["Unit-cost breaches", "programs"],
  "test-finding": ["Test findings", "programs"],
  "program-risk": ["Program risks", "programs"],
  person: ["Public professionals", "people"],
  "official-role": ["Official roles", "people"],
  "role-succession": ["Role successions", "people"],
  "supplier-relationship": ["Supplier relationships", "industrial-base"],
  "buyer-profile": ["Buyer profiles", "industrial-base"],
  "vendor-profile": ["Vendor profiles", "industrial-base"],
  "incumbent-position": ["Incumbent positions", "industrial-base"],
  "program-health-profile": ["Program health profiles", "programs"],
  "accountability-finding": ["Accountability findings", "signals"],
  "official-document": ["Official documents", "documents"],
  "document-version": ["Document versions", "documents"],
  "document-section": ["Document sections", "documents"],
  "document-table": ["Document tables", "documents"],
  "document-citation": ["Document citations", "documents"],
  "saved-query-template": ["Saved query templates", "operations"],
  "brief-template": ["Brief templates", "operations"],
  "acquisition-forecast": ["Acquisition forecasts", "opportunity"],
  "mission-assignment": ["Mission assignments", "geography"],
  "installation-tenant": ["Installation tenants", "geography"],
  "sbir-topic": ["SBIR/STTR topics", "opportunity"],
  "sbir-award": ["SBIR/STTR awards", "execution"],
  "competitive-signal": ["Competition signals", "signals"],
  "expiration-signal": ["Expiration signals", "signals"],
  "execution-risk-signal": ["Execution review signals", "signals"],
  "protest-decision": ["Protest decisions", "signals"],
  "audit-finding": ["Audit findings", "signals"],
  "outcome-evidence": ["Outcome evidence", "signals"],
  classification: ["Classifications", "classification"],
  source: ["Source records", "evidence"],
};

const RELATION_ENDPOINTS = {
  "activity-awarded-as": ["activity", "award"],
  "activity-has-event": ["activity", "event"],
  "activity-has-transaction": ["activity", "transaction"],
  "activity-ordered-under-vehicle": ["activity", "contract-vehicle"],
  "activity-uses-acquisition-path": ["activity", "acquisition-path"],
  "activity-follow-on-to": ["activity", "activity"],
  "activity-has-recompete-signal": ["activity", "recompete-signal"],
  "activity-recipient": ["activity", "organization"],
  "activity-contracting-organization": ["activity", "organization"],
  "activity-funding-organization": ["activity", "organization"],
  "contracting-activity-at": ["activity", "location"],
  "funding-activity-at": ["activity", "location"],
  "award-recipient": ["award", "organization"],
  "award-awarding-organization": ["award", "organization"],
  "award-funding-organization": ["award", "organization"],
  "award-funded-by-account": ["award", "federal-account"],
  "award-has-subaward-summary": ["award", "subaward-summary"],
  "award-ordered-under-vehicle": ["award", "contract-vehicle"],
  "award-has-recompete-signal": ["award", "recompete-signal"],
  "contract-vehicle-associated-with-path": ["contract-vehicle", "acquisition-path"],
  "budget-line-matches-account-title": ["budget-line", "federal-account"],
  "budget-line-owned-by-organization": ["budget-line", "organization"],
  "organization-located-at": ["organization", "location"],
  "organization-operates-at-location": ["organization", "location"],
  "organization-part-of": ["organization", "organization"],
  "organization-has-identifier": ["organization", "organization-identifier"],
  "transaction-recipient": ["transaction", "organization"],
  "spending-observation-measures-entity": ["spending-observation", "organization"],
  "notice-has-version": ["opportunity-notice", "notice-version"],
  "notice-version-supersedes": ["notice-version", "notice-version"],
  "notice-results-in-award": ["opportunity-notice", "award"],
  "award-modified-by-action": ["award", "award-action"],
  "award-action-ordered-under-vehicle": ["award-action", "contract-vehicle"],
  "award-action-recipient": ["award-action", "organization"],
  "organization-has-registration": ["organization", "vendor-registration"],
  "registration-has-certification": ["vendor-registration", "business-certification"],
  "organization-hierarchy-observed-as": ["organization", "organization-hierarchy-observation"],
  "hierarchy-observation-parent": ["organization-hierarchy-observation", "organization"],
  "award-has-subaward": ["award", "subaward"],
  "subaward-prime": ["subaward", "organization"],
  "subaward-recipient": ["subaward", "organization"],
  "federal-account-has-treasury-account": ["federal-account", "treasury-account"],
  "federal-account-has-execution-balance": ["federal-account", "execution-balance"],
  "treasury-account-has-execution-balance": ["treasury-account", "execution-balance"],
  "treasury-account-apportioned-by-revision": ["treasury-account", "apportionment-revision"],
  "program-activity-owned-by-organization": ["program-activity", "organization"],
  "object-class-used-by-organization": ["object-class", "organization"],
  "treasury-outlay-observation-measures-organization": ["treasury-outlay-observation", "organization"],
  "measure-has-version": ["legislative-measure", "legislative-version"],
  "legislative-version-supersedes": ["legislative-version", "legislative-version"],
  "measure-backed-by-report": ["legislative-measure", "committee-report"],
  "measure-enacted-as": ["legislative-measure", "enacted-provision"],
  "appropriation-mark-adjusts-budget-line": ["appropriation-mark", "budget-line"],
  "enacted-provision-affects-budget-line": ["enacted-provision", "budget-line"],
  "budget-adjustment-affects-budget-line": ["budget-adjustment", "budget-line"],
  "program-element-represented-by-budget-line": ["program-element", "budget-line"],
  "project-represented-by-budget-line": ["project", "budget-line"],
  "defense-program-represented-by-budget-line": ["defense-program", "budget-line"],
  "defense-program-owned-by-program-office": ["defense-program", "program-office"],
  "program-office-part-of-organization": ["program-office", "organization"],
  "defense-program-has-acquisition-milestone": ["defense-program", "acquisition-milestone"],
  "defense-program-has-baseline": ["defense-program", "program-baseline"],
  "defense-program-has-cost-estimate": ["defense-program", "cost-estimate"],
  "defense-program-has-schedule-event": ["defense-program", "schedule-event"],
  "defense-program-has-unit-cost-breach": ["defense-program", "unit-cost-breach"],
  "defense-program-has-test-finding": ["defense-program", "test-finding"],
  "defense-program-has-risk": ["defense-program", "program-risk"],
  "appropriation-mark-affects-defense-program": ["appropriation-mark", "defense-program"],
  "appropriation-mark-recommended-by-report": ["appropriation-mark", "committee-report"],
  "appropriation-mark-considered-by-measure": ["appropriation-mark", "legislative-measure"],
  "person-holds-official-role": ["person", "official-role"],
  "official-role-at-organization": ["official-role", "organization"],
  "role-succession-predecessor": ["role-succession", "official-role"],
  "role-succession-successor": ["role-succession", "official-role"],
  "supplier-relationship-prime": ["supplier-relationship", "organization"],
  "supplier-relationship-supplier": ["supplier-relationship", "organization"],
  "buyer-profile-for-organization": ["buyer-profile", "organization"],
  "vendor-profile-for-organization": ["vendor-profile", "organization"],
  "incumbent-position-for-activity": ["incumbent-position", "activity"],
  "incumbent-position-for-organization": ["incumbent-position", "organization"],
  "program-health-profile-summarizes-program": ["program-health-profile", "defense-program"],
  "accountability-finding-about-program": ["accountability-finding", "defense-program"],
  "official-document-has-version": ["official-document", "document-version"],
  "official-document-has-section": ["official-document", "document-section"],
  "official-document-has-table": ["official-document", "document-table"],
  "official-document-has-citation": ["official-document", "document-citation"],
  "document-citation-supports-official-role": ["document-citation", "official-role"],
  "document-citation-supports-appropriation-mark": ["document-citation", "appropriation-mark"],
  "document-citation-supports-accountability-finding": ["document-citation", "accountability-finding"],
  "activity-has-forecast": ["activity", "acquisition-forecast"],
  "mission-assignment-at-location": ["mission-assignment", "location"],
  "mission-assignment-for-organization": ["mission-assignment", "organization"],
  "installation-tenant-at-location": ["installation-tenant", "location"],
  "installation-tenant-organization": ["installation-tenant", "organization"],
  "sbir-topic-results-in-award": ["sbir-topic", "sbir-award"],
  "activity-has-competitive-signal": ["activity", "competitive-signal"],
  "award-has-expiration-signal": ["award", "expiration-signal"],
  "execution-balance-has-risk-signal": ["execution-balance", "execution-risk-signal"],
  "activity-has-outcome-evidence": ["activity", "outcome-evidence"],
  "outcome-evidence-award": ["outcome-evidence", "award"],
  "protest-decision-about-award": ["protest-decision", "award"],
  "audit-finding-about-entity": ["audit-finding", "activity"],
  "entity-classified-as": ["activity", "classification"],
  "supported-by-source": ["activity", "source"],
  "evidence-claim-about": ["evidence-claim", "activity"],
  "evidence-conflict-has-claim": ["evidence-conflict", "evidence-claim"],
  "evidence-conflict-resolved-by": ["evidence-conflict", "evidence-claim"],
};

const GROUPS = [
  { id: "evidence", label: "Evidence & provenance", types: ["source", "evidence-claim", "evidence-conflict"], x: 420, y: 18, width: 360, tone: "evidence" },
  { id: "opportunity", label: "Opportunity lifecycle", types: ["activity", "event", "opportunity-notice", "notice-version", "acquisition-forecast", "sbir-topic"], x: 420, y: 168, width: 360, tone: "activity" },
  { id: "organization", label: "Organization identity", types: ["organization", "organization-identifier", "vendor-registration", "business-certification", "organization-hierarchy-observation", "buyer-profile", "vendor-profile"], x: 34, y: 328, width: 294, tone: "identity" },
  { id: "geography", label: "Geography & missions", types: ["location", "mission-assignment", "installation-tenant"], x: 34, y: 506, width: 294, tone: "location" },
  { id: "execution", label: "Contract execution", types: ["award", "award-action", "transaction", "subaward-summary", "subaward", "spending-observation", "sbir-award", "supplier-relationship", "incumbent-position"], x: 872, y: 328, width: 294, tone: "execution" },
  { id: "funding", label: "Funding structure", types: ["federal-account", "treasury-account", "budget-line", "apportionment-revision", "execution-balance", "program-activity", "object-class", "treasury-outlay-observation", "program-element", "project"], x: 872, y: 506, width: 294, tone: "funding" },
  { id: "lineage", label: "Vehicle lineage", types: ["contract-vehicle", "acquisition-path", "recompete-signal"], x: 453, y: 358, width: 294, tone: "lineage" },
  { id: "programs", label: "Program intelligence", types: ["defense-program", "program-office", "program-baseline", "cost-estimate", "schedule-event", "acquisition-milestone", "unit-cost-breach", "test-finding", "program-risk", "program-health-profile"], x: 453, y: 536, width: 294, tone: "program" },
  { id: "classification", label: "Classification", types: ["classification"], x: 453, y: 680, width: 294, tone: "classification" },
  { id: "legislation", label: "Request to enactment", types: ["legislative-measure", "legislative-version", "committee-report", "enacted-provision", "appropriation-mark", "budget-adjustment"], x: 780, y: 18, width: 386, tone: "funding" },
  { id: "signals", label: "Decision signals", types: ["competitive-signal", "expiration-signal", "execution-risk-signal", "protest-decision", "audit-finding", "outcome-evidence", "accountability-finding"], x: 34, y: 18, width: 386, tone: "lineage" },
  { id: "people", label: "Official people & tenure", types: ["person", "official-role", "role-succession"], x: 34, y: 680, width: 294, tone: "identity" },
  { id: "documents", label: "Document intelligence", types: ["official-document", "document-version", "document-section", "document-table", "document-citation"], x: 780, y: 680, width: 386, tone: "evidence" },
  { id: "operations", label: "Operational products", types: ["saved-query-template", "brief-template"], x: 453, y: 824, width: 294, tone: "activity" },
];

const CONNECTORS = [
  ["M600 118V168", "supported by"],
  ["M420 218C310 218 265 292 181 328", "buyer / recipient"],
  ["M420 240C292 276 214 410 181 506", "located at"],
  ["M780 218C890 218 935 292 1019 328", "award / action"],
  ["M600 268V358", "vehicle / follow-on"],
  ["M600 268V680", "classified as"],
  ["M872 556H747", "program funding"],
  ["M872 388C824 405 786 420 747 420", "ordered under"],
  ["M1019 428V506", "funded by"],
  ["M328 378C398 390 420 412 453 420", "organization path"],
];

function number(value) {
  return Number(value || 0).toLocaleString();
}

function title(value) {
  return String(value || "").split("-").map((part) => part ? `${part[0].toUpperCase()}${part.slice(1)}` : "").join(" ");
}

function groupCount(group, counts) {
  return group.types.reduce((total, type) => total + Number(counts[type] || 0), 0);
}

function diagramDetail(group, counts) {
  const visible = group.types.slice(0, 2).map((type) => `${number(counts[type])} ${ENTITY_META[type]?.[0].toLowerCase() || title(type).toLowerCase()}`);
  if (group.types.length > 2) visible.push(`+${group.types.length - 2} types`);
  return visible.join(" · ");
}

function DomainDiagram({ counts }) {
  return <div className="domain-model__diagram-scroller" tabIndex="0" aria-label="Scrollable domain model diagram">
    <svg className="domain-model__diagram" viewBox="0 0 1200 970" role="img" aria-labelledby="domain-diagram-title domain-diagram-description" data-domain-diagram>
      <title id="domain-diagram-title">Defense Intelligence domain model</title>
      <desc id="domain-diagram-description">Evidence and sources support opportunity, program, organization, geography, contract, funding, legislative, lineage, signal, and classification domains.</desc>
      <defs><marker id="domain-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0 0L8 4L0 8Z" /></marker></defs>
      <g className="domain-model__connectors" aria-hidden="true">
        {CONNECTORS.map(([path, label], index) => <path key={`${label}-${index}`} d={path} data-domain-connector={label} />)}
      </g>
      {GROUPS.map((group) => <g key={group.id} className={`domain-model__node is-${group.tone}`} data-domain-diagram-node={group.id}>
        <rect x={group.x} y={group.y} width={group.width} height="100" rx="8" />
        <text x={group.x + 24} y={group.y + 32} className="domain-model__node-title">{group.label}</text>
        <text x={group.x + 24} y={group.y + 58} className="domain-model__node-count">{number(groupCount(group, counts))}</text>
        <text x={group.x + 24} y={group.y + 80} className="domain-model__node-detail">{diagramDetail(group, counts)}</text>
      </g>)}
    </svg>
  </div>;
}

export default function DomainModelPage({ routeHash = "" }) {
  const auth = useAuth();
  const allowed = auth?.staticHost || auth?.user?.canManageWorkspace;
  const [state, setState] = useState({ status: "loading", summary: null, error: "" });
  const [selectedGroup, setSelectedGroup] = useState("all");
  const params = new URLSearchParams(String(routeHash).split("?")[1] || "");
  const activityId = params.get("activity") || "";

  useEffect(() => {
    if (!allowed) return undefined;
    let active = true;
    loadIntelligenceGraphSummary()
      .then((summary) => { if (active) setState({ status: "ready", summary, error: "" }); })
      .catch((error) => { if (active) setState({ status: "error", summary: null, error: error.message }); });
    return () => { active = false; };
  }, [allowed]);

  const entityTypes = useMemo(() => {
    const types = state.summary?.domain?.entityTypes || [];
    if (selectedGroup === "all") return types;
    return types.filter((type) => ENTITY_META[type]?.[1] === selectedGroup);
  }, [selectedGroup, state.summary]);

  const relationTypes = useMemo(() => {
    const types = state.summary?.domain?.relationTypes || [];
    if (selectedGroup === "all") return types;
    return types.filter((type) => (RELATION_ENDPOINTS[type] || []).some((endpoint) => ENTITY_META[endpoint]?.[1] === selectedGroup));
  }, [selectedGroup, state.summary]);

  if (!allowed) return <section className="domain-model-page" data-domain-model-page><ControlAsyncState compact state="empty" icon={<ShieldCheck size={22} />} title="Workspace manager access required" message="The domain model is an administrative evidence and integrity surface." /></section>;
  if (state.status !== "ready") return <section className="domain-model-page" data-domain-model-page><ControlAsyncState compact state={state.status === "error" ? "error" : "loading"} icon={<Network size={22} />} title={state.status === "error" ? "Domain model unavailable" : "Loading domain model"} message={state.error || "Loading the bounded graph summary."} /></section>;

  const summary = state.summary;
  const counts = summary.metadata.entityCounts || {};
  const relationCounts = summary.metadata.relationCounts || {};
  const temporal = summary.metadata.coverage.temporal || {};
  const organizations = summary.metadata.coverage.organizations || {};
  const contracts = summary.metadata.coverage.contracts || {};
  const spending = summary.metadata.coverage.spending || {};
  const money = summary.metadata.coverage.money || {};
  const acquisition = summary.metadata.coverage.acquisition || {};
  const programs = summary.metadata.coverage.programs || {};
  const people = summary.metadata.coverage.people || {};
  const industrialBase = summary.metadata.coverage.industrialBase || {};
  const documents = summary.metadata.coverage.documents || {};
  const operations = summary.metadata.coverage.operations || {};

  return <section className="domain-model-page" data-domain-model-page data-domain-schema={summary.metadata.schemaVersion}>
    <ControlPageHeader compact divided eyebrow="Workspace administration" title="Domain model" summary="Inspect the canonical intelligence graph, its entity inventory, relationship coverage, validity, conflicts, and full record views." headingLevel={2} meta={<span className="if-badge if-badge--info">Schema {summary.metadata.schemaVersion}</span>} actions={<><a className="if-btn if-btn--secondary" href="#/budget-spend/sources">Source lineage</a><a className="if-btn if-btn--primary" href={`${import.meta.env.BASE_URL}data/intelligence-graph.json.gzip`} download><Download size={14} />Full graph</a></>} />

    {activityId ? <section className="domain-model__record" data-domain-record-view={activityId}>
      <header><div><span>Full record view</span><h3>{activityId}</h3><p>The same evidence shown in drawers, expanded into a durable route that can be linked, reloaded, and reviewed independently.</p></div><a className="if-btn if-btn--secondary" href="#/budget-spend/domain-model">Back to model</a></header>
      <ConnectedEvidence opportunityId={activityId} fullView />
    </section> : null}

    <div className="domain-model__metrics" aria-label="Domain graph totals">
      <article><Database size={17} /><strong>{number(summary.totals.entities)}</strong><span>typed entities</span></article>
      <article><GitBranch size={17} /><strong>{number(summary.totals.relations)}</strong><span>evidence relations</span></article>
      <article><Clock3 size={17} /><strong>{number(temporal.current)}</strong><span>current relations</span></article>
      <article><AlertTriangle size={17} /><strong>{number(temporal.needs_review)}</strong><span>review required</span></article>
    </div>

    <section className="domain-model__panel" data-domain-architecture>
      <header><div><span>Architecture</span><h3>How the intelligence model connects</h3><p>Evidence supports every domain. The activity spine links opportunity lifecycle to execution, identity, geography, funding, lineage, and classification.</p></div><span className="if-badge">{GROUPS.length} domain groups</span></header>
      <DomainDiagram counts={counts} />
    </section>

    <nav className="domain-model__filters" aria-label="Filter model inventory">
      <button type="button" className={selectedGroup === "all" ? "is-active" : ""} aria-pressed={selectedGroup === "all"} onClick={() => setSelectedGroup("all")}>All domains <span>{Object.keys(counts).length}</span></button>
      {GROUPS.map((group) => <button key={group.id} type="button" className={selectedGroup === group.id ? "is-active" : ""} aria-pressed={selectedGroup === group.id} onClick={() => setSelectedGroup(group.id)}>{group.label} <span>{number(groupCount(group, counts))}</span></button>)}
    </nav>

    <section className="domain-model__inventory" data-domain-entity-inventory>
      <header><div><span>Entity inventory</span><h3>{selectedGroup === "all" ? "Every typed entity" : GROUPS.find((group) => group.id === selectedGroup)?.label}</h3></div><b>{entityTypes.length} types</b></header>
      <div>{entityTypes.map((type) => <article key={type} data-domain-entity-card={type}><span>{ENTITY_META[type]?.[0] || title(type)}</span><strong>{number(counts[type])}</strong><small>{type}</small></article>)}</div>
    </section>

    <section className="domain-model__panel" data-domain-relation-inventory>
      <header><div><span>Relationship inventory</span><h3>Typed connections</h3><p>Every edge has an evidence basis, source artifact, confidence, observation date, validity window, and review state.</p></div><b>{relationTypes.length} types</b></header>
      <div className="domain-model__relations" role="table" aria-label="Domain relationship counts">
        <div className="domain-model__relation domain-model__relation--head" role="row"><span role="columnheader">From</span><span role="columnheader">Relationship</span><span role="columnheader">To</span><span role="columnheader">Count</span></div>
        {relationTypes.map((type) => { const [from = "entity", to = "entity"] = RELATION_ENDPOINTS[type] || []; return <div key={type} className="domain-model__relation" role="row" data-domain-relation-row={type}><span role="cell">{title(from)}</span><strong role="cell">{title(type)}</strong><span role="cell">{title(to)}</span><b role="cell">{number(relationCounts[type])}</b></div>; })}
      </div>
    </section>

    <div className="domain-model__quality-grid">
      <section className="domain-model__panel"><header><div><span>Validity</span><h3>Temporal state</h3></div><Clock3 size={18} /></header><dl><div><dt>Current</dt><dd>{number(temporal.current)}</dd></div><div><dt>Historical</dt><dd>{number(temporal.historical)}</dd></div><div><dt>Future</dt><dd>{number(temporal.future)}</dd></div><div><dt>Stale</dt><dd>{number(temporal.stale)}</dd></div></dl></section>
      <section className="domain-model__panel"><header><div><span>Conflicts</span><h3>Evidence review</h3></div><AlertTriangle size={18} /></header><dl><div><dt>Retained disagreements</dt><dd>{number(temporal.totalConflicts)}</dd></div><div><dt>Resolved by recency</dt><dd>{number(temporal.resolved_by_recency)}</dd></div><div><dt>Require review</dt><dd>{number(temporal.needs_review)}</dd></div><div><dt>Ambiguous identities</dt><dd>{number(organizations.ambiguousNormalizedLabels)}</dd></div></dl><a href={`${import.meta.env.BASE_URL}data/temporal-evidence-review.json`} download>Download review queue <span aria-hidden="true">→</span></a></section>
      <section className="domain-model__panel"><header><div><span>Identity</span><h3>Organization resolution</h3></div><ShieldCheck size={18} /></header><dl><div><dt>UEI-backed</dt><dd>{number(organizations.canonicalUeiIdentities)}</dd></div><div><dt>Office-code</dt><dd>{number(organizations.reviewedOfficeCodeIdentities)}</dd></div><div><dt>Safe alias groups</dt><dd>{number(organizations.resolvedAliasGroups)}</dd></div><div><dt>Label-only</dt><dd>{number(organizations.labelOnlyIdentities)}</dd></div></dl></section>
      <section className="domain-model__panel"><header><div><span>Lineage</span><h3>Contract families</h3></div><GitBranch size={18} /></header><dl><div><dt>Parent IDVs</dt><dd>{number(contracts.exactParentVehicles)}</dd></div><div><dt>Linked orders</dt><dd>{number(contracts.activitiesWithExactParent)}</dd></div><div><dt>Resolved predecessors</dt><dd>{number(contracts.resolvedPredecessorLinks)}</dd></div><div><dt>Unresolved follow-ons</dt><dd>{number(contracts.unresolvedFollowOnClaims)}</dd></div></dl></section>
      <section className="domain-model__panel" data-domain-spending-coverage><header><div><span>Spending depth</span><h3>DoD contract coverage</h3></div><Database size={18} /></header><dl><div><dt>Fiscal years</dt><dd>{spending.firstFiscalYear}–{spending.lastFiscalYear}</dd></div><div><dt>Spending observations</dt><dd>{number(spending.observations)}</dd></div><div><dt>Ranked awards / IDVs</dt><dd>{number(spending.uniqueRankedAwards)}</dd></div><div><dt>Category rows</dt><dd>{number(spending.categoryRows)}</dd></div></dl></section>
      <section className="domain-model__panel" data-domain-money-coverage><header><div><span>Exact money</span><h3>Account lifecycle</h3></div><Database size={18} /></header><dl><div><dt>Fiscal years</dt><dd>{money.firstFiscalYear}–{money.lastFiscalYear}</dd></div><div><dt>Treasury accounts</dt><dd>{number(money.treasuryAccounts)}</dd></div><div><dt>Execution balances</dt><dd>{number(money.executionBalances)}</dd></div><div><dt>OMB revisions</dt><dd>{number(money.apportionmentRevisions)}</dd></div></dl></section>
      <section className="domain-model__panel" data-domain-program-coverage><header><div><span>Program intelligence</span><h3>Program evidence</h3></div><Network size={18} /></header><dl><div><dt>Defense programs</dt><dd>{number(programs.defensePrograms)}</dd></div><div><dt>Request baselines</dt><dd>{number(programs.requestBaselines)}</dd></div><div><dt>Page-cited House marks</dt><dd>{number(programs.pageCitedAppropriationMarks)}</dd></div><div><dt>Changed marks</dt><dd>{number(programs.changedAppropriationMarks)}</dd></div></dl></section>
      <section className="domain-model__panel" data-domain-people-coverage><header><div><span>Official people</span><h3>Role tenure</h3></div><ShieldCheck size={18} /></header><dl><div><dt>Public professionals</dt><dd>{number(people.people)}</dd></div><div><dt>Official roles</dt><dd>{number(people.officialRoles)}</dd></div><div><dt>Observed current</dt><dd>{number(people.observedCurrentRoles)}</dd></div><div><dt>Sourced successions</dt><dd>{number(people.successions)}</dd></div></dl></section>
      <section className="domain-model__panel" data-domain-industrial-base-coverage><header><div><span>Industrial base</span><h3>Market relationships</h3></div><GitBranch size={18} /></header><dl><div><dt>Supplier links</dt><dd>{number(industrialBase.supplierRelationships)}</dd></div><div><dt>Buyer profiles</dt><dd>{number(industrialBase.buyerProfiles)}</dd></div><div><dt>Vendor profiles</dt><dd>{number(industrialBase.vendorProfiles)}</dd></div><div><dt>Incumbent positions</dt><dd>{number(industrialBase.incumbentPositions)}</dd></div></dl></section>
      <section className="domain-model__panel" data-domain-document-coverage><header><div><span>Document intelligence</span><h3>Cited corpus</h3></div><Database size={18} /></header><dl><div><dt>Official documents</dt><dd>{number(documents.officialDocuments)}</dd></div><div><dt>Observed versions</dt><dd>{number(documents.versions)}</dd></div><div><dt>Verified tables</dt><dd>{number(documents.tables)}</dd></div><div><dt>Exact citations</dt><dd>{number(documents.citations)}</dd></div></dl></section>
      <section className="domain-model__panel" data-domain-operations-coverage><header><div><span>Operational products</span><h3>Reusable analysis</h3></div><Network size={18} /></header><dl><div><dt>Saved query templates</dt><dd>{number(operations.savedQueryTemplates)}</dd></div><div><dt>Brief templates</dt><dd>{number(operations.briefTemplates)}</dd></div><div><dt>Publication policy</dt><dd>{title(operations.publicationPolicy || "review before send")}</dd></div><div><dt>Embeddings</dt><dd>{number(documents.embeddings)}</dd></div></dl><a href="#/budget-spend/intelligence">Open intelligence operations <span aria-hidden="true">→</span></a></section>
      <section className="domain-model__panel" data-domain-acquisition-coverage><header><div><span>Acquisition backbone</span><h3>SAM.gov source state</h3></div><Network size={18} /></header><dl><div><dt>Status</dt><dd>{title(acquisition.status || "unknown")}</dd></div><div><dt>Notices / versions</dt><dd>{number(acquisition.notices)} / {number(acquisition.noticeVersions)}</dd></div><div><dt>Award actions</dt><dd>{number(acquisition.awardActions)}</dd></div><div><dt>Registrations</dt><dd>{number(acquisition.vendorRegistrations)}</dd></div></dl></section>
    </div>

    <section className="domain-model__policy" data-domain-policy>
      <ShieldCheck size={20} />
      <div><strong>Evidence boundary</strong><p>{summary.metadata.authorityBoundary}</p></div>
    </section>
  </section>;
}
