import { useEffect, useMemo, useState } from "react";
import { ControlAsyncState, ControlPageHeader } from "control-surface-ui/react";
import { BookOpenText, BriefcaseBusiness, Download, FileSearch, Network, ShieldCheck, UsersRound } from "lucide-react";
import { useAuth } from "./AuthContext.jsx";
import "./IntelligenceProductsPage.css";

const SECTIONS = [
  ["people", "People & tenure"],
  ["industrial-base", "Industrial base"],
  ["accountability", "Accountability"],
  ["documents", "Documents"],
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

function SourceState({ row }) {
  return <article className={`intelligence-products__health is-${row.status}`}>
    <div><strong>{row.label}</strong><span>{row.status.replaceAll("-", " ")}</span></div>
    <b>{number(row.records)}</b>
    {row.caveat ? <p>{row.caveat}</p> : null}
  </article>;
}

export default function IntelligenceProductsPage() {
  const auth = useAuth();
  const allowed = auth?.staticHost || auth?.user?.canManageWorkspace;
  const [state, setState] = useState({ status: "loading", data: null, error: "" });
  const [section, setSection] = useState("people");

  useEffect(() => {
    if (!allowed) return undefined;
    let active = true;
    fetch(`${import.meta.env.BASE_URL}data/roadmap-intelligence.json`)
      .then((response) => {
        if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
        return response.json();
      })
      .then((data) => { if (active) setState({ status: "ready", data, error: "" }); })
      .catch((error) => { if (active) setState({ status: "error", data: null, error: error.message }); });
    return () => { active = false; };
  }, [allowed]);

  const roles = useMemo(() => [...(state.data?.officialRoles || [])].sort((a, b) => String(b.effectiveFrom).localeCompare(String(a.effectiveFrom))), [state.data]);
  const people = useMemo(() => new Map((state.data?.people || []).map((row) => [row.id, row])), [state.data]);

  if (!allowed) return <section className="intelligence-products" data-intelligence-products-page><ControlAsyncState compact state="empty" icon={<ShieldCheck size={22} />} title="Workspace manager access required" message="Intelligence operations expose administrative evidence, review boundaries, and reusable workspace templates." /></section>;
  if (state.status !== "ready") return <section className="intelligence-products" data-intelligence-products-page><ControlAsyncState compact state={state.status === "error" ? "error" : "loading"} icon={<Network size={22} />} title={state.status === "error" ? "Intelligence products unavailable" : "Loading intelligence products"} message={state.error || "Loading people, industrial-base, accountability, document, and operational intelligence."} /></section>;

  const data = state.data;
  const coverage = data.metadata.coverage;
  return <section className="intelligence-products" data-intelligence-products-page data-roadmap-schema={data.metadata.schemaVersion}>
    <ControlPageHeader compact divided eyebrow="Workspace intelligence" title="Intelligence operations" summary="Review official people and tenure, industrial-base relationships, accountability evidence, document citations, and reusable analytical products." headingLevel={2} meta={<span className="if-badge if-badge--info">Evidence bounded</span>} actions={<><a className="if-btn if-btn--secondary" href="#/budget-spend/domain-model">Domain model</a><a className="if-btn if-btn--primary" href={`${import.meta.env.BASE_URL}data/roadmap-intelligence.json`} download><Download size={14} />Review artifact</a></>} />

    <div className="intelligence-products__metrics" aria-label="Roadmap intelligence totals">
      <article data-official-role-count={coverage.officialRoles}><UsersRound size={18} /><strong>{number(coverage.officialRoles)}</strong><span>official roles</span></article>
      <article data-supplier-relationship-count={coverage.supplierRelationships}><Network size={18} /><strong>{number(coverage.supplierRelationships)}</strong><span>supplier links</span></article>
      <article data-document-count={coverage.officialDocuments}><BookOpenText size={18} /><strong>{number(coverage.officialDocuments)}</strong><span>official documents</span></article>
      <article data-citation-count={coverage.citations}><FileSearch size={18} /><strong>{number(coverage.citations)}</strong><span>exact citations</span></article>
      <article data-operational-template-count={coverage.savedQueryTemplates + coverage.briefTemplates}><BriefcaseBusiness size={18} /><strong>{number(coverage.savedQueryTemplates + coverage.briefTemplates)}</strong><span>operational templates</span></article>
    </div>

    <div className="intelligence-products__health-grid" data-source-health>{data.sourceHealth.map((row) => <SourceState key={row.id} row={row} />)}</div>

    <nav className="intelligence-products__tabs" aria-label="Intelligence product sections">
      {SECTIONS.map(([id, label]) => <button key={id} type="button" className={section === id ? "is-active" : ""} aria-pressed={section === id} onClick={() => setSection(id)}>{label}</button>)}
    </nav>

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

    {section === "operations" ? <section className="intelligence-products__split" data-operational-products-panel>
      <article className="intelligence-products__panel"><header><div><span>Reusable analysis</span><h3>Saved graph queries</h3><p>Durable definitions for repeatable analyst workflows across the canonical entity model.</p></div><b>{number(coverage.savedQueryTemplates)} templates</b></header><div className="intelligence-products__template-grid">{data.savedQueryTemplates.map((row) => <article key={row.id}><strong>{row.label}</strong><p>{row.entityTypes.join(" · ")}</p><span className="if-badge">{row.scope.replaceAll("-", " ")}</span></article>)}</div></article>
      <article className="intelligence-products__panel"><header><div><span>Scheduled intelligence</span><h3>Brief templates</h3><p>Every brief remains review-before-send. No external delivery is implied or automated by this artifact.</p></div><b>{number(coverage.briefTemplates)} briefs</b></header><div className="intelligence-products__template-grid">{data.briefTemplates.map((row) => <article key={row.id}><strong>{row.label}</strong><p>{row.subject} · {row.cadence}</p><span className="if-badge if-badge--warning">{row.publicationPolicy.replaceAll("-", " ")}</span></article>)}</div></article>
    </section> : null}

    <section className="intelligence-products__boundary"><ShieldCheck size={20} /><div><strong>Evidence boundary</strong><p>{data.metadata.evidenceBoundary}</p></div></section>
  </section>;
}
