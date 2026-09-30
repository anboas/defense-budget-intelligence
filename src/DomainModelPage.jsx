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
  "entity-classified-as": ["activity", "classification"],
  "supported-by-source": ["activity", "source"],
  "evidence-claim-about": ["evidence-claim", "activity"],
  "evidence-conflict-has-claim": ["evidence-conflict", "evidence-claim"],
  "evidence-conflict-resolved-by": ["evidence-conflict", "evidence-claim"],
};

const GROUPS = [
  { id: "evidence", label: "Evidence & provenance", types: ["source", "evidence-claim", "evidence-conflict"], x: 420, y: 18, width: 360, tone: "evidence" },
  { id: "opportunity", label: "Opportunity lifecycle", types: ["activity", "event"], x: 420, y: 168, width: 360, tone: "activity" },
  { id: "organization", label: "Organization identity", types: ["organization", "organization-identifier"], x: 34, y: 328, width: 294, tone: "identity" },
  { id: "geography", label: "Geography", types: ["location"], x: 34, y: 506, width: 294, tone: "location" },
  { id: "execution", label: "Contract execution", types: ["award", "transaction", "subaward-summary"], x: 872, y: 328, width: 294, tone: "execution" },
  { id: "funding", label: "Funding structure", types: ["federal-account", "budget-line"], x: 872, y: 506, width: 294, tone: "funding" },
  { id: "lineage", label: "Vehicle lineage", types: ["contract-vehicle", "acquisition-path", "recompete-signal"], x: 453, y: 358, width: 294, tone: "lineage" },
  { id: "classification", label: "Classification", types: ["classification"], x: 453, y: 536, width: 294, tone: "classification" },
];

const CONNECTORS = [
  ["M600 118V168", "supported by"],
  ["M420 218C310 218 265 292 181 328", "buyer / recipient"],
  ["M420 240C292 276 214 410 181 506", "located at"],
  ["M780 218C890 218 935 292 1019 328", "award / action"],
  ["M600 268V358", "vehicle / follow-on"],
  ["M600 268V536", "classified as"],
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
  return group.types.map((type) => `${number(counts[type])} ${ENTITY_META[type]?.[0].toLowerCase() || title(type).toLowerCase()}`).join(" · ");
}

function DomainDiagram({ counts }) {
  return <div className="domain-model__diagram-scroller" tabIndex="0" aria-label="Scrollable domain model diagram">
    <svg className="domain-model__diagram" viewBox="0 0 1200 660" role="img" aria-labelledby="domain-diagram-title domain-diagram-description" data-domain-diagram>
      <title id="domain-diagram-title">Defense Intelligence domain model</title>
      <desc id="domain-diagram-description">Evidence and sources support the opportunity lifecycle, which connects to organizations, locations, contract execution, funding, vehicle lineage, and classifications.</desc>
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
    </div>

    <section className="domain-model__policy" data-domain-policy>
      <ShieldCheck size={20} />
      <div><strong>Evidence boundary</strong><p>{summary.metadata.authorityBoundary}</p></div>
    </section>
  </section>;
}
