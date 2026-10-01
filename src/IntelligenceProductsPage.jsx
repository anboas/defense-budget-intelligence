import { useEffect, useMemo, useState } from "react";
import { ControlAsyncState, ControlPageHeader } from "control-surface-ui/react";
import { BookOpenText, BriefcaseBusiness, Building2, Download, FileSearch, Network, RefreshCcw, Search, ShieldCheck, UsersRound } from "lucide-react";
import { useAuth } from "./AuthContext.jsx";
import "./IntelligenceProductsPage.css";

const SECTIONS = [
  ["organizations", "Organizations"],
  ["people", "People & tenure"],
  ["industrial-base", "Industrial base"],
  ["accountability", "Accountability"],
  ["documents", "Documents"],
  ["monitoring", "Organization watch"],
  ["operations", "Operational products"],
];

function number(value) {
  return Number(value || 0).toLocaleString();
}

function money(value) {
  const amount = Number(value || 0);
  if (Math.abs(amount) >= 1e9) return `$${(amount / 1e9).toFixed(1)}B`;
  if (Math.abs(amount) >= 1e6) return `$${(amount / 1e6).toFixed(1)}M`;
  return `$${Math.round(amount).toLocaleString()}`;
}

function dateRange(role) {
  const start = role.effectiveFrom || "Unknown start";
  const end = role.effectiveTo || (role.status === "observed-current" ? "Observed current" : "Open ended");
  return `${start} → ${end}`;
}

function setOrganizationRoute(id = "") {
  const [path, search = ""] = String(window.location.hash || "#/budget-spend/intelligence").split("?");
  const params = new URLSearchParams(search);
  if (id) params.set("organization", id); else params.delete("organization");
  window.location.hash = `${path}${params.size ? `?${params}` : ""}`;
}

function SourceState({ row }) {
  return <article className={`intelligence-products__health is-${row.status}`}>
    <div><strong>{row.label}</strong><span>{row.status.replaceAll("-", " ")}</span></div>
    <b>{number(row.records)}</b>
    {row.caveat ? <p>{row.caveat}</p> : null}
  </article>;
}

function OrganizationDossier({ dossier, data, rolesById, people }) {
  const missions = data.missionClaims.filter((row) => row.dossierId === dossier.id);
  const finances = data.financialSummaries.filter((row) => row.dossierId === dossier.id);
  const gaps = data.researchGaps.filter((row) => row.dossierId === dossier.id);
  const timeline = data.changeEvents.filter((row) => row.dossierId === dossier.id).sort((a, b) => String(b.effectiveAt).localeCompare(String(a.effectiveAt)));
  const dossierRoles = dossier.roleIds.map((id) => rolesById.get(id)).filter(Boolean);
  const sourceUrls = dossier.sourceUrls || [];
  const linkedList = (ids, labels, empty) => ids.length ? ids.slice(0, 30).map((id) => <li key={id}>{labels?.[id] || id}</li>) : <li className="is-empty">{empty}</li>;
  return <article className="intelligence-products__dossier" data-organization-dossier={dossier.id}>
    <header>
      <div><span>{dossier.priorityTier.replaceAll("-", " ")} · {dossier.categories.join(" · ")}</span><h3>{dossier.label}</h3><p>{dossier.parentOrganizationName ? `Parent organization: ${dossier.parentOrganizationName}` : "Parent hierarchy remains unresolved or is not applicable in the retained evidence."}</p></div>
      <div><span className={`if-badge ${dossier.freshness.status === "current" ? "if-badge--success" : "if-badge--warning"}`}>{dossier.freshness.status.replaceAll("-", " ")}</span><small>Latest evidence {dossier.freshness.latestObservation}</small><small>Review by {dossier.freshness.reviewBy}</small></div>
    </header>
    <div className="intelligence-products__dossier-stats">
      {[['Leaders', dossier.coverage.people], ['Roles', dossier.coverage.roles], ['Programs', dossier.coverage.programs], ['Awards', dossier.coverage.awards], ['Accounts', dossier.coverage.accounts], ['Vendors', dossier.coverage.vendors], ['Sources', dossier.coverage.sources], ['Open gaps', dossier.coverage.researchGaps]].map(([label, value]) => <div key={label}><strong>{number(value)}</strong><span>{label}</span></div>)}
    </div>
    <div className="intelligence-products__dossier-grid">
      <section data-dossier-leadership><h4>People and tenure</h4>{dossierRoles.length ? dossierRoles.map((role) => <article key={role.id}><strong>{people.get(role.personId)?.label || role.personId}</strong><span>{role.title}</span><small>{dateRange(role)} · {role.datePrecision.replaceAll("-", " ")}</small><p>{role.evidenceQuote}</p></article>) : <p className="is-empty">No sourced public professional role is retained. The research queue records this gap.</p>}</section>
      <section data-dossier-mission><h4>Mission and authority</h4>{missions.length ? missions.map((row) => <article key={row.id}><strong>{row.label}</strong><p>{row.claim}</p><a href={row.sourceUrl} target="_blank" rel="noreferrer">Official source</a></article>) : <p className="is-empty">No official mission or charter claim has passed review.</p>}</section>
      <section data-dossier-finance><h4>Financial evidence</h4>{finances.length ? finances.map((row) => <article key={row.id}><strong>{row.label}</strong><b>{money(row.amountDollars)}</b><span>{row.measureType.replaceAll("-", " ")}</span><p>{row.sourceBoundary}</p></article>) : <p className="is-empty">No organization-scoped financial measure is currently retained.</p>}</section>
      <section data-dossier-portfolio><h4>Programs and awards</h4><h5>Programs</h5><ul>{linkedList(dossier.programIds, data.programLabels, "No linked program")}</ul><h5>Awards</h5><ul>{linkedList(dossier.awardIds, data.awardLabels, "No linked award")}</ul></section>
      <section data-dossier-network><h4>Accounts, vendors, and locations</h4><h5>Federal accounts</h5><ul>{linkedList(dossier.accountIds, data.accountLabels, "No linked account")}</ul><h5>Vendors</h5><ul>{dossier.vendorNames.length ? dossier.vendorNames.map((label) => <li key={label}>{label}</li>) : <li className="is-empty">No linked vendor</li>}</ul><h5>Locations</h5><ul>{linkedList(dossier.locationIds, data.locationLabels, "No linked location")}</ul></section>
      <section data-dossier-research-gaps><h4>Research queue</h4>{gaps.length ? gaps.map((row) => <article key={row.id}><div><strong>{row.gapType.replaceAll("-", " ")}</strong><span className={`if-badge ${row.priority === "high" ? "if-badge--warning" : ""}`}>{row.priority}</span></div><p>{row.description}</p></article>) : <p className="is-empty">No unresolved gap is currently registered.</p>}</section>
      <section data-dossier-timeline><h4>Change timeline</h4>{timeline.length ? timeline.slice(0, 30).map((row) => <article key={row.id}><time>{row.effectiveAt}</time><strong>{row.label}</strong><small>{row.reviewState.replaceAll("-", " ")}</small></article>) : <p className="is-empty">No dated change event is retained.</p>}</section>
      <section data-dossier-sources><h4>Source register</h4>{sourceUrls.length ? <ul>{sourceUrls.slice(0, 50).map((url) => <li key={url}><a href={url} target="_blank" rel="noreferrer">{url}</a></li>)}</ul> : <p className="is-empty">No reviewed source is retained.</p>}</section>
    </div>
  </article>;
}

export default function IntelligenceProductsPage({ routeHash = "" }) {
  const auth = useAuth();
  const allowed = auth?.staticHost || auth?.user?.canManageWorkspace;
  const [state, setState] = useState({ status: "loading", roadmap: null, organizations: null, monitor: null, error: "" });
  const [section, setSection] = useState("organizations");
  const [organizationQuery, setOrganizationQuery] = useState("");

  useEffect(() => {
    if (!allowed) return undefined;
    let active = true;
    Promise.all(["roadmap-intelligence.json", "organization-intelligence.json", "organization-change-monitor.json"].map((name) => fetch(`${import.meta.env.BASE_URL}data/${name}`).then((response) => {
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
      return response.json();
    })))
      .then(([roadmap, organizations, monitor]) => { if (active) setState({ status: "ready", roadmap, organizations, monitor, error: "" }); })
      .catch((error) => { if (active) setState({ status: "error", roadmap: null, organizations: null, monitor: null, error: error.message }); });
    return () => { active = false; };
  }, [allowed]);

  const roles = useMemo(() => [...(state.roadmap?.officialRoles || [])].sort((a, b) => String(b.effectiveFrom).localeCompare(String(a.effectiveFrom))), [state.roadmap]);
  const people = useMemo(() => new Map((state.roadmap?.people || []).map((row) => [row.id, row])), [state.roadmap]);
  const rolesById = useMemo(() => new Map(roles.map((row) => [row.id, row])), [roles]);
  const organizationId = new URLSearchParams(String(routeHash).split("?")[1] || "").get("organization") || "";
  const filteredDossiers = useMemo(() => {
    const query = organizationQuery.trim().toLowerCase();
    const rows = state.organizations?.dossiers || [];
    if (!query) return rows;
    return rows.filter((row) => [row.label, row.organizationName, ...(row.categories || [])].join(" ").toLowerCase().includes(query));
  }, [organizationQuery, state.organizations]);
  const selectedDossier = useMemo(() => (state.organizations?.dossiers || []).find((row) => row.id === organizationId) || null, [organizationId, state.organizations]);

  if (!allowed) return <section className="intelligence-products" data-intelligence-products-page><ControlAsyncState compact state="empty" icon={<ShieldCheck size={22} />} title="Workspace manager access required" message="Intelligence operations expose administrative evidence, review boundaries, and reusable workspace templates." /></section>;
  if (state.status !== "ready") return <section className="intelligence-products" data-intelligence-products-page><ControlAsyncState compact state={state.status === "error" ? "error" : "loading"} icon={<Network size={22} />} title={state.status === "error" ? "Intelligence products unavailable" : "Loading intelligence products"} message={state.error || "Loading people, industrial-base, accountability, document, and operational intelligence."} /></section>;

  const data = state.roadmap;
  const organizationData = state.organizations;
  const coverage = data.metadata.coverage;
  return <section className="intelligence-products" data-intelligence-products-page data-roadmap-schema={data.metadata.schemaVersion} data-organization-schema={organizationData.metadata.schemaVersion}>
    <ControlPageHeader compact divided eyebrow="Workspace intelligence" title="Organization intelligence" summary="Investigate source-backed organization identity, hierarchy, mission, people and tenure, finances, programs, awards, vendors, locations, changes, and unresolved research gaps." headingLevel={2} meta={<span className="if-badge if-badge--info">Evidence bounded</span>} actions={<><a className="if-btn if-btn--secondary" href="#/budget-spend/domain-model">Domain model</a><a className="if-btn if-btn--primary" href={`${import.meta.env.BASE_URL}data/organization-intelligence.json`} download><Download size={14} />Dossier artifact</a></>} />

    <div className="intelligence-products__metrics" aria-label="Roadmap intelligence totals">
      <article data-organization-dossier-count={organizationData.metadata.coverage.dossiers}><Building2 size={18} /><strong>{number(organizationData.metadata.coverage.dossiers)}</strong><span>organization dossiers</span></article>
      <article data-official-role-count={coverage.officialRoles}><UsersRound size={18} /><strong>{number(coverage.officialRoles)}</strong><span>official roles</span></article>
      <article data-monitored-source-count={state.monitor.metadata.coverage.monitoredSources}><RefreshCcw size={18} /><strong>{number(state.monitor.metadata.coverage.monitoredSources)}</strong><span>monitored sources</span></article>
      <article data-supplier-relationship-count={coverage.supplierRelationships}><Network size={18} /><strong>{number(coverage.supplierRelationships)}</strong><span>supplier links</span></article>
      <article data-document-count={coverage.officialDocuments}><BookOpenText size={18} /><strong>{number(coverage.officialDocuments)}</strong><span>official documents</span></article>
      <article data-citation-count={coverage.citations}><FileSearch size={18} /><strong>{number(coverage.citations)}</strong><span>exact citations</span></article>
      <article data-operational-template-count={coverage.savedQueryTemplates + coverage.briefTemplates}><BriefcaseBusiness size={18} /><strong>{number(coverage.savedQueryTemplates + coverage.briefTemplates)}</strong><span>operational templates</span></article>
    </div>

    <div className="intelligence-products__health-grid" data-source-health>{data.sourceHealth.map((row) => <SourceState key={row.id} row={row} />)}</div>

    <nav className="intelligence-products__tabs" aria-label="Intelligence product sections">
      {SECTIONS.map(([id, label]) => <button key={id} type="button" className={section === id ? "is-active" : ""} aria-pressed={section === id} onClick={() => setSection(id)}>{label}</button>)}
    </nav>

    {section === "organizations" ? <section className="intelligence-products__organizations" data-organization-intelligence-panel>
      <aside className="intelligence-products__organization-index">
        <label><Search size={15} /><input aria-label="Search organization dossiers" value={organizationQuery} onChange={(event) => setOrganizationQuery(event.target.value)} placeholder="Search organizations" /></label>
        <div><strong>{number(filteredDossiers.length)} dossiers</strong><span>{number(organizationData.metadata.coverage.researchGaps)} open research gaps</span></div>
        <nav aria-label="Organization dossier list">{filteredDossiers.map((row) => <button key={row.id} type="button" className={selectedDossier?.id === row.id ? "is-active" : ""} onClick={() => setOrganizationRoute(row.id)} data-organization-dossier-link={row.id}>
          <strong>{row.label}</strong><span>{row.priorityTier.replaceAll("-", " ")} · {row.categories.join(" · ")}</span><small>{number(row.coverage.roles)} roles · {number(row.coverage.programs)} programs · {number(row.coverage.awards)} awards</small>
        </button>)}</nav>
      </aside>
      {selectedDossier ? <OrganizationDossier dossier={selectedDossier} data={organizationData} rolesById={rolesById} people={people} /> : <article className="intelligence-products__organization-empty"><Building2 size={28} /><h3>Select an organization dossier</h3><p>Open a full research view for leadership and tenure, mission, money, portfolio, industrial base, timeline, sources, and unresolved evidence gaps.</p></article>}
    </section> : null}

    {section === "people" ? <section className="intelligence-products__panel" data-official-people-panel>
      <header><div><span>Public professional roles</span><h3>Official people and role tenure</h3><p>Exact appointment or transition dates are used when an official source states them. Current-directory observations are lower bounds, never inferred appointment dates.</p></div><b>{number(coverage.successions)} sourced successions</b></header>
      <div className="intelligence-products__role-list">{roles.map((role) => <article key={role.id} data-official-role={role.id}>
        <div><strong>{people.get(role.personId)?.label || role.personId}</strong><span>{role.title}</span><small>{role.organizationName}</small></div>
        <div><b>{dateRange(role)}</b><span className={`if-badge ${role.status === "observed-current" ? "if-badge--success" : ""}`}>{role.status.replaceAll("-", " ")}</span><small>{role.evidenceQuote}</small></div>
      </article>)}</div>
    </section> : null}

    {section === "industrial-base" ? <section className="intelligence-products__split" data-industrial-base-panel>
      <article className="intelligence-products__panel"><header><div><span>Prime and supplier evidence</span><h3>Teaming relationships</h3><p>Bounded USAspending subaward evidence. Missing links never imply that a relationship does not exist.</p></div><b>Partial coverage</b></header><div className="intelligence-products__table">{data.supplierRelationships.slice(0, 40).map((row) => <div key={row.id}><span><strong>{row.primeName}</strong><small>{row.supplierName}</small></span><b>{money(row.sampledAmountDollars)}</b><small>{number(row.subawardCount)} sampled actions</small></div>)}</div></article>
      <article className="intelligence-products__panel"><header><div><span>Retained market evidence</span><h3>Buyer concentration</h3><p>Shares and concentration describe the retained award corpus, not the complete federal market.</p></div><b>{number(coverage.buyerProfiles)} buyers</b></header><div className="intelligence-products__table">{data.buyerProfiles.slice(0, 25).map((row) => <div key={row.id}><span><strong>{row.label}</strong><small>{number(row.vendorCount)} vendors · top {row.topVendor}</small></span><b>{money(row.totalAwardValueDollars)}</b><small>HHI {row.concentrationHhi.toFixed(3)}</small></div>)}</div></article>
    </section> : null}

    {section === "accountability" ? <section className="intelligence-products__split" data-accountability-panel>
      <article className="intelligence-products__panel"><header><div><span>Program evidence</span><h3>Health summaries</h3><p>Deterministic summaries of retained baselines, marks, and findings. These are not predictive ratings.</p></div><b>{number(coverage.programHealthProfiles)} programs</b></header><div className="intelligence-products__table">{data.programHealthProfiles.filter((row) => row.healthState !== "baseline-only").slice(0, 30).map((row) => <div key={row.id}><span><strong>{row.label}</strong><small>{row.healthState.replaceAll("-", " ")}</small></span><b>{Math.round(row.evidenceCompleteness * 100)}%</b><small>{number(row.findingCount)} findings · {number(row.changedMarkCount)} changed marks</small></div>)}</div></article>
      <article className="intelligence-products__panel"><header><div><span>Official findings</span><h3>Accountability evidence</h3><p>The public corpus is bounded. Zero protest, audit, or corrective-action records is a source limitation, not a clean-record assertion.</p></div><b>{number(coverage.accountabilityFindings)} findings</b></header><div className="intelligence-products__findings">{data.accountabilityFindings.map((row) => <article key={row.id}><strong>{row.label}</strong><p>{row.finding}</p><a href={row.sourceUrl} target="_blank" rel="noreferrer">Official source</a></article>)}</div></article>
    </section> : null}

    {section === "documents" ? <section className="intelligence-products__split" data-document-intelligence-panel>
      <article className="intelligence-products__panel"><header><div><span>Official corpus</span><h3>Documents and versions</h3><p>Canonical URLs, observed versions, sections, verified table extracts, and content-hash basis remain reviewable.</p></div><b>{number(coverage.documentVersions)} versions</b></header><div className="intelligence-products__table">{data.officialDocuments.slice(0, 40).map((row) => <div key={row.id}><span><strong>{row.label}</strong><small>{row.publisher} · {row.documentType}</small></span><a href={row.url} target="_blank" rel="noreferrer">Open</a></div>)}</div></article>
      <article className="intelligence-products__panel"><header><div><span>Fact-level provenance</span><h3>Exact citations</h3><p>Citations bind quoted claims or printed-page table rows to typed graph facts. Embeddings remain unavailable.</p></div><b>{number(coverage.citations)} citations</b></header><div className="intelligence-products__table">{data.citations.slice(0, 40).map((row) => <div key={row.id}><span><strong>{row.targetType.replaceAll("-", " ")}</strong><small>{row.selectorType.replaceAll("-", " ")}</small></span><a href={row.sourceUrl} target="_blank" rel="noreferrer">Evidence</a></div>)}</div></article>
    </section> : null}

    {section === "monitoring" ? <section className="intelligence-products__split" data-organization-watch-panel>
      <article className="intelligence-products__panel"><header><div><span>Official source registry</span><h3>Organization watch</h3><p>Daily directory and weekly source observations retain content hashes, allowed hosts, dossier coverage, and source state. Unchanged pages are suppressed.</p></div><b>{number(state.monitor.metadata.coverage.monitoredSources)} sources</b></header><div className="intelligence-products__table">{state.monitor.sources.map((row) => <div key={row.id} data-organization-monitor-source={row.sourceId}><span><strong>{row.label}</strong><small>{row.publisher} · {row.cadence} · {number(row.linkedDossierIds.length)} dossiers</small></span><span className={`if-badge ${row.changeState === "changed" ? "if-badge--warning" : "if-badge--success"}`}>{row.changeState.replaceAll("-", " ")}</span></div>)}</div></article>
      <article className="intelligence-products__panel"><header><div><span>Review-first changes</span><h3>Change proposals</h3><p>A new listing is a lower-bound observation. A missing listing never ends a tenure. Changed source content cannot overwrite a dossier until reviewed.</p></div><b>{number(state.monitor.metadata.coverage.reviewProposals)} pending</b></header>{state.monitor.proposals.length ? <div className="intelligence-products__findings">{state.monitor.proposals.map((row) => <article key={row.id} data-organization-change-proposal={row.id}><strong>{row.label}</strong><p>{row.detail}</p><span className="if-badge if-badge--warning">{row.kind.replaceAll("-", " ")}</span></article>)}</div> : <div className="intelligence-products__organization-empty" data-organization-watch-clear><ShieldCheck size={26} /><h3>No source changes pending</h3><p>The current monitored pages match the last verified baseline. Future differences enter this queue instead of silently changing tenure or dossier facts.</p></div>}</article>
    </section> : null}

    {section === "operations" ? <section className="intelligence-products__split" data-operational-products-panel>
      <article className="intelligence-products__panel"><header><div><span>Reusable analysis</span><h3>Saved graph queries</h3><p>Durable definitions for repeatable analyst workflows across the canonical entity model.</p></div><b>{number(coverage.savedQueryTemplates)} templates</b></header><div className="intelligence-products__template-grid">{data.savedQueryTemplates.map((row) => <article key={row.id}><strong>{row.label}</strong><p>{row.entityTypes.join(" · ")}</p><span className="if-badge">{row.scope.replaceAll("-", " ")}</span></article>)}</div></article>
      <article className="intelligence-products__panel"><header><div><span>Scheduled intelligence</span><h3>Brief templates</h3><p>Every brief remains review-before-send. No external delivery is implied or automated by this artifact.</p></div><b>{number(coverage.briefTemplates)} briefs</b></header><div className="intelligence-products__template-grid">{data.briefTemplates.map((row) => <article key={row.id}><strong>{row.label}</strong><p>{row.subject} · {row.cadence}</p><span className="if-badge if-badge--warning">{row.publicationPolicy.replaceAll("-", " ")}</span></article>)}</div></article>
    </section> : null}

    <section className="intelligence-products__boundary"><ShieldCheck size={20} /><div><strong>Evidence boundary</strong><p>{data.metadata.evidenceBoundary}</p></div></section>
  </section>;
}
