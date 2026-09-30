import { useEffect, useState } from "react";
import { loadContractLineage, loadIntelligenceGraph, loadTemporalEvidence } from "./intelligence-graph.js";
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
  "organization-part-of": "Organization hierarchy",
  "organization-has-identifier": "Organization identifier",
  "transaction-recipient": "Transaction recipient",
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

function claimValue(claim) {
  if (/Amount$/.test(claim.field)) return money(claim.value);
  return String(claim.value || "Unknown").replaceAll("_", " ");
}

function ConnectionGroup({ title, items, renderItem }) {
  if (!items?.length) return null;
  return <section className="connected-evidence__group"><h4>{title}</h4><div>{items.map(renderItem)}</div></section>;
}

export default function ConnectedEvidence({ opportunityId, fullView = false }) {
  const [state, setState] = useState({ status: "loading", graph: null });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    Promise.all([loadIntelligenceGraph(), loadContractLineage().catch(() => null), loadTemporalEvidence().catch(() => null)])
      .then(([graph, lineage, temporal]) => { if (active) setState({ status: "ready", graph, lineage, temporal }); })
      .catch((error) => { if (active) setState({ status: "error", graph: null, error }); });
    return () => { active = false; };
  }, [attempt]);

  const connection = state.graph?.indices?.byActivity?.[opportunityId] || null;
  const contractLineage = state.lineage?.indices?.byActivity?.[opportunityId] || null;
  const temporalEvidence = state.temporal?.indices?.byActivity?.[opportunityId] || null;
  const unresolvedConflicts = temporalEvidence?.conflicts?.filter((item) => item.status === "needs_review") || [];
  const validityStatus = unresolvedConflicts.length ? "conflicting" : temporalEvidence?.validity?.status || "unknown";
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
    [counts.contractVehicles, "parent vehicle"],
    [counts.recompeteSignals, "timing signal"],
  ].filter(([value]) => Number(value || 0) > 0) : [];

  if (!opportunityId) return null;
  if (state.status === "loading") return <section className="connected-evidence connected-evidence--state" data-connected-evidence data-connected-evidence-state="loading" role="status"><strong>Connected evidence</strong><span>Resolving exact cross-surface links…</span></section>;
  if (state.status === "error") return <section className="connected-evidence connected-evidence--state" data-connected-evidence data-connected-evidence-state="error" role="alert"><strong>Connected evidence unavailable</strong><span>The primary record remains usable.</span><button type="button" onClick={() => { setState({ status: "loading", graph: null }); setAttempt((value) => value + 1); }}>Retry</button></section>;
  if (!connection) return <section className="connected-evidence connected-evidence--state" data-connected-evidence data-connected-evidence-state="empty"><strong>No deterministic cross-surface links</strong><span>This record remains available from its source surface.</span></section>;

  const connected = connection.connected || {};
  const routeLinks = [
    !fullView ? ["Full view", `#/budget-spend/domain-model?activity=${encodeURIComponent(opportunityId)}`] : null,
    ["Timeline", `#/budget-spend/explorer?spendView=timeline&capRecord=${encodeURIComponent(opportunityId)}`],
    primaryLocation ? ["Map", `#/budget-spend/map?mapOrg=${encodeURIComponent(primaryLocation.sourceId)}`] : null,
    counts.awards ? ["Awards", "#/budget-spend/awards"] : null,
    counts.federalAccounts ? ["Account flow", "#/budget-spend/lifecycle"] : null,
    ["Source lineage", "#/budget-spend/sources"],
  ].filter(Boolean);

  return (
    <section className={`connected-evidence${fullView ? " connected-evidence--full" : ""}`} data-connected-evidence data-connected-evidence-state="ready" data-connected-evidence-id={opportunityId} data-connected-evidence-full-view={fullView || undefined}>
      <header>
        <div><span>Evidence graph</span><h3>Connected intelligence</h3></div>
        <small><b className={`connected-evidence__status is-${validityStatus}`} data-temporal-status={validityStatus}>{validityStatus}</b>{connection.surfaces.length} linked surfaces · deterministic joins only</small>
      </header>
      <div className="connected-evidence__metrics" aria-label="Connected evidence counts">
        {metrics.map(([value, singular, plural]) => <span key={singular}><strong>{Number(value).toLocaleString()}</strong><small>{Number(value) === 1 ? singular : plural || `${singular}s`}</small></span>)}
      </div>
      <nav className="connected-evidence__routes" aria-label="Open connected surfaces">
        {routeLinks.map(([label, href]) => <a key={label} href={href}>{label}<span aria-hidden="true">→</span></a>)}
      </nav>
      <div className="connected-evidence__connections">
        <ConnectionGroup title="Awards" items={connected.awards} renderItem={(award) => <article key={award.id}><strong>{award.piid || award.label}</strong><span>{award.label}</span><em>{money(award.obligatedAmount)} obligated</em></article>} />
        <ConnectionGroup title="Exact parent vehicles" items={contractLineage?.vehicles} renderItem={(vehicle) => <article key={vehicle.id} data-contract-vehicle><strong>{vehicle.piid}</strong><span>{countLabel(vehicle.orderCount, "linked order")}</span><em>Exact USAspending parent IDV</em></article>} />
        <ConnectionGroup title="Published acquisition paths" items={contractLineage?.acquisitionPaths} renderItem={(path) => <article key={path.id} data-acquisition-path><strong>{path.label}</strong><span>{countLabel(path.activityCount, "linked activity")}</span><em>Source-declared path; not a substitute for parent IDV</em></article>} />
        <ConnectionGroup title="Sibling orders" items={contractLineage?.siblingOrders?.slice(0, 8)} renderItem={(activity) => <article key={activity.opportunityId} data-contract-sibling><strong>{activity.reference || activity.label}</strong><span>{activity.label}</span><em>{money(activity.obligatedAmount)} obligated · {activity.lifecycle?.replaceAll("-", " ")}</em></article>} />
        <ConnectionGroup title="Predecessors" items={contractLineage?.predecessors} renderItem={(activity) => <article key={activity.opportunityId} data-contract-predecessor><strong>{activity.reference || activity.label}</strong><span>{activity.label}</span><em>{activity.basis} · {activity.confidence}</em></article>} />
        <ConnectionGroup title="Published successors" items={contractLineage?.successors} renderItem={(activity) => <article key={activity.opportunityId} data-contract-successor><strong>{activity.reference || activity.label}</strong><span>{activity.label}</span><em>{activity.basis} · {activity.confidence}</em></article>} />
        <ConnectionGroup title="Recompete timing review" items={contractLineage?.recompeteSignals} renderItem={(signal) => <article key={signal.id} data-recompete-signal><strong>{signal.endDate}</strong><span>{countLabel(signal.daysUntilEnd, "day")} to reported end</span><em>{signal.caveat}</em></article>} />
        {contractLineage?.unresolvedClaim ? <section className="connected-evidence__group" data-lineage-review><h4>Lineage review required</h4><div><article><strong>{contractLineage.unresolvedClaim.claim} wording</strong><span>{contractLineage.unresolvedClaim.reason}</span><em>No predecessor edge promoted</em></article></div></section> : null}
        <ConnectionGroup title="Validity and conflicts" items={temporalEvidence?.conflicts?.slice(0, 8)} renderItem={(conflict) => <article key={conflict.id} data-evidence-conflict={conflict.status}><strong>{conflict.field.replaceAll(/([A-Z])/g, " $1")}</strong><span>{conflict.claims.map((claim) => `${claimValue(claim)} · ${claim.sourceArtifact}`).join(" | ")}</span><em>{conflict.status === "resolved_by_recency" ? "Newer current evidence supersedes the older claim" : conflict.reason}</em></article>} />
        <ConnectionGroup title="Organizations" items={connected.organizations} renderItem={(organization) => {
          const identifier = organization.identity?.identifiers?.uei ? `UEI ${organization.identity.identifiers.uei}` : organization.identity?.identifiers?.officeCode ? `Office ${organization.identity.identifiers.officeCode}` : organization.identity?.resolutionState === "needs_review" ? `${organization.identity.candidateUeis?.length || 0} UEI candidates · review required` : "Label-only identity";
          const aliases = organization.aliases?.length ? ` · ${organization.aliases.length} ${organization.aliases.length === 1 ? "alias" : "aliases"}` : "";
          return <article key={organization.id}><strong>{organization.label}</strong><span>{identifier}</span><em>{organization.identity?.method?.replaceAll("-", " ")}{aliases}</em></article>;
        }} />
        <ConnectionGroup title="Reviewed locations" items={connected.locations} renderItem={(location) => <article key={location.id}><strong>{location.label}</strong><span>{[location.city, location.state].filter(Boolean).join(", ")}</span><em>Reviewed map registry</em></article>} />
        <ConnectionGroup title="Federal accounts" items={connected.federalAccounts} renderItem={(account) => <article key={account.id}><strong>{account.federalAccountCode}</strong><span>{account.label}</span><em>Exact award transaction funding</em></article>} />
        <ConnectionGroup title="Classifications" items={connected.classifications} renderItem={(classification) => <article key={classification.id}><strong>{classification.label}</strong><span>{classification.namespace.replaceAll("-", " ")}</span><em>Deterministic taxonomy</em></article>} />
      </div>
      <details className="connected-evidence__evidence">
        <summary><strong>Evidence and join policy</strong><span>{connection.evidenceSummary.length} relation methods</span></summary>
        <div>
          {connection.evidenceSummary.map((evidence) => <article key={`${evidence.type}-${evidence.basis}-${evidence.sourceArtifact}`}><strong>{RELATION_LABELS[evidence.type] || evidence.type}</strong><span>{evidence.basis.replaceAll("-", " ")} · {evidence.confidence.replaceAll("_", " ")}</span><em>{countLabel(evidence.count, "edge")} · {evidence.sourceArtifact}</em></article>)}
        </div>
        <p>Exact identifiers and source-declared relationships are authoritative. Temporal state uses source observation and effective dates; newer current evidence may supersede an older value, while stale or ambiguous claims remain unresolved. No fuzzy identity merge or unsupported budget-line-to-award link is asserted.</p>
      </details>
      <footer>
        <div>{connection.surfaces.map((surface) => <span key={surface}>{SURFACE_LABELS[surface] || surface}</span>)}</div>
        <div>{connected.sources.slice(0, 6).map((source, index) => <a key={source.id} href={source.url} target="_blank" rel="noreferrer">{source.publisher || `Source ${index + 1}`}<span aria-hidden="true">↗</span></a>)}</div>
      </footer>
    </section>
  );
}
