import { useEffect, useState } from "react";
import { loadIntelligenceGraph } from "./intelligence-graph.js";
import "./ConnectedEvidence.css";

const RELATION_LABELS = {
  "activity-awarded-as": "Award identity",
  "activity-has-event": "Canonical events",
  "activity-has-transaction": "FPDS transactions",
  "activity-recipient": "Recipient",
  "activity-contracting-organization": "Contracting organization",
  "activity-funding-organization": "Funding organization",
  "contracting-activity-at": "Contracting location",
  "funding-activity-at": "Funding location",
  "award-funded-by-account": "Federal account",
  "award-has-subaward-summary": "Subaward summary",
  "entity-classified-as": "Classification",
  "supported-by-source": "Primary source",
};

const SURFACE_LABELS = {
  "spend-explorer": "Spend Explorer",
  "opportunity-map": "Opportunity Map",
  "procurement-discovery": "Discovery",
  "capture-calendar": "Capture Calendar",
  "contract-monitor": "Contract Monitor",
};

function money(value) {
  const amount = Number(value || 0);
  if (amount >= 1_000_000_000) return `$${(amount / 1_000_000_000).toFixed(1)}B`;
  if (amount >= 1_000_000) return `$${(amount / 1_000_000).toFixed(1)}M`;
  if (amount >= 1_000) return `$${Math.round(amount / 1_000).toLocaleString()}K`;
  return `$${amount.toLocaleString()}`;
}

function countLabel(value, singular, plural = `${singular}s`) {
  return `${Number(value || 0).toLocaleString()} ${Number(value || 0) === 1 ? singular : plural}`;
}

function ConnectionGroup({ title, items, renderItem }) {
  if (!items?.length) return null;
  return <section className="connected-evidence__group"><h4>{title}</h4><div>{items.map(renderItem)}</div></section>;
}

export default function ConnectedEvidence({ opportunityId }) {
  const [state, setState] = useState({ status: "loading", graph: null });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    loadIntelligenceGraph()
      .then((graph) => { if (active) setState({ status: "ready", graph }); })
      .catch((error) => { if (active) setState({ status: "error", graph: null, error }); });
    return () => { active = false; };
  }, [attempt]);

  const connection = state.graph?.indices?.byActivity?.[opportunityId] || null;
  const primaryLocation = connection?.connected?.locations?.[0] || null;
  const counts = connection?.counts || {};
  const metrics = connection ? [
    [counts.awards, "award"],
    [counts.events, "event"],
    [counts.transactions, "FPDS action", "FPDS actions"],
    [counts.organizations, "organization"],
    [counts.locations, "location"],
    [counts.federalAccounts, "federal account"],
    [counts.subawardSummaries, "subaward set", "subaward sets"],
    [counts.sources, "source"],
  ].filter(([value]) => Number(value || 0) > 0) : [];

  if (!opportunityId) return null;
  if (state.status === "loading") return <section className="connected-evidence connected-evidence--state" data-connected-evidence data-connected-evidence-state="loading" role="status"><strong>Connected evidence</strong><span>Resolving exact cross-surface links…</span></section>;
  if (state.status === "error") return <section className="connected-evidence connected-evidence--state" data-connected-evidence data-connected-evidence-state="error" role="alert"><strong>Connected evidence unavailable</strong><span>The primary record remains usable.</span><button type="button" onClick={() => { setState({ status: "loading", graph: null }); setAttempt((value) => value + 1); }}>Retry</button></section>;
  if (!connection) return <section className="connected-evidence connected-evidence--state" data-connected-evidence data-connected-evidence-state="empty"><strong>No deterministic cross-surface links</strong><span>This record remains available from its source surface.</span></section>;

  const connected = connection.connected || {};
  const routeLinks = [
    ["Timeline", `#/budget-spend/explorer?spendView=timeline&capRecord=${encodeURIComponent(opportunityId)}`],
    primaryLocation ? ["Map", `#/budget-spend/map?mapOrg=${encodeURIComponent(primaryLocation.sourceId)}`] : null,
    counts.awards ? ["Awards", "#/budget-spend/awards"] : null,
    counts.federalAccounts ? ["Account flow", "#/budget-spend/lifecycle"] : null,
    ["Source lineage", "#/budget-spend/sources"],
  ].filter(Boolean);

  return (
    <section className="connected-evidence" data-connected-evidence data-connected-evidence-state="ready" data-connected-evidence-id={opportunityId}>
      <header>
        <div><span>Evidence graph</span><h3>Connected intelligence</h3></div>
        <small>{connection.surfaces.length} linked surfaces · deterministic joins only</small>
      </header>
      <div className="connected-evidence__metrics" aria-label="Connected evidence counts">
        {metrics.map(([value, singular, plural]) => <span key={singular}><strong>{Number(value).toLocaleString()}</strong><small>{Number(value) === 1 ? singular : plural || `${singular}s`}</small></span>)}
      </div>
      <nav className="connected-evidence__routes" aria-label="Open connected surfaces">
        {routeLinks.map(([label, href]) => <a key={label} href={href}>{label}<span aria-hidden="true">→</span></a>)}
      </nav>
      <div className="connected-evidence__connections">
        <ConnectionGroup title="Awards" items={connected.awards} renderItem={(award) => <article key={award.id}><strong>{award.piid || award.label}</strong><span>{award.label}</span><em>{money(award.obligatedAmount)} obligated</em></article>} />
        <ConnectionGroup title="Organizations" items={connected.organizations} renderItem={(organization) => <article key={organization.id}><strong>{organization.label}</strong><span>{organization.identity?.uei ? `UEI ${organization.identity.uei}` : "Exact public label"}</span><em>{organization.identity?.method?.replaceAll("-", " ")}</em></article>} />
        <ConnectionGroup title="Reviewed locations" items={connected.locations} renderItem={(location) => <article key={location.id}><strong>{location.label}</strong><span>{[location.city, location.state].filter(Boolean).join(", ")}</span><em>Reviewed map registry</em></article>} />
        <ConnectionGroup title="Federal accounts" items={connected.federalAccounts} renderItem={(account) => <article key={account.id}><strong>{account.federalAccountCode}</strong><span>{account.label}</span><em>Exact award transaction funding</em></article>} />
        <ConnectionGroup title="Classifications" items={connected.classifications} renderItem={(classification) => <article key={classification.id}><strong>{classification.label}</strong><span>{classification.namespace.replaceAll("-", " ")}</span><em>Deterministic taxonomy</em></article>} />
      </div>
      <details className="connected-evidence__evidence">
        <summary><strong>Evidence and join policy</strong><span>{connection.evidenceSummary.length} relation methods</span></summary>
        <div>
          {connection.evidenceSummary.map((evidence) => <article key={`${evidence.type}-${evidence.basis}-${evidence.sourceArtifact}`}><strong>{RELATION_LABELS[evidence.type] || evidence.type}</strong><span>{evidence.basis.replaceAll("-", " ")} · {evidence.confidence.replaceAll("_", " ")}</span><em>{countLabel(evidence.count, "edge")} · {evidence.sourceArtifact}</em></article>)}
        </div>
        <p>Exact identifiers and source-declared relationships are authoritative. Normalized-label and account-title matches remain explicitly derived; no fuzzy identity merge or unsupported budget-line-to-award link is asserted.</p>
      </details>
      <footer>
        <div>{connection.surfaces.map((surface) => <span key={surface}>{SURFACE_LABELS[surface] || surface}</span>)}</div>
        <div>{connected.sources.slice(0, 6).map((source, index) => <a key={source.id} href={source.url} target="_blank" rel="noreferrer">{source.publisher || `Source ${index + 1}`}<span aria-hidden="true">↗</span></a>)}</div>
      </footer>
    </section>
  );
}
