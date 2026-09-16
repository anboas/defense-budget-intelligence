import { useState } from "react";
import { ControlDisclosure } from "control-surface-ui/react";
import { Database, ExternalLink, Network, RefreshCcw } from "lucide-react";
import sourceHealth from "./data/source-health.json";
import AnalysisSection from "./AnalysisSection.jsx";

function dateTime(value) {
  return new Date(value).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function AnalyticsSources({ budgetData, accountSpine, captureCalendar, awardSummary, executionCoverage, subawardSnapshot }) {
  const books = budgetData.metadata.sources || [];
  const inventory = budgetData.metadata.dataInventory || {};
  const accountCoverage = accountSpine?.metadata?.coverage || {};
  const transactionCoverage = captureCalendar?.metadata?.coverage || {};
  const healthTotals = sourceHealth.totals || {};
  const [showAllSourceHealth, setShowAllSourceHealth] = useState(false);
  const orderedHealthSources = [...(sourceHealth.sources || [])].sort((left, right) => {
    const severity = { unavailable: 0, redirected: 1, online: 2 };
    return (severity[left.health?.toLowerCase()] ?? 3) - (severity[right.health?.toLowerCase()] ?? 3);
  });
  const visibleHealthSources = showAllSourceHealth ? orderedHealthSources : orderedHealthSources.slice(0, 5);
  const layers = [
    {
      id: "request",
      stage: "1",
      title: "PDB request lines",
      system: "OUSD(C) display books",
      count: `${budgetData.records.length.toLocaleString()} lines`,
      detail: `${books.length} colors of money across ${inventory.availableBudgetRequestYears?.length || 0} request vintages`,
      href: inventory.sourcePackageUrl || books[0]?.sourceUrl,
      relationship: "published",
    },
    {
      id: "apportionment",
      stage: "2",
      title: "Approved apportionments",
      system: "OMB public apportionments",
      count: `${accountCoverage.ombDocumentsFetched || 0} documents`,
      detail: `${accountCoverage.exactTafsJoins || 0} exact TAFS joins`,
      href: accountSpine?.metadata?.sources?.ombApportionments,
      relationship: "exact TAFS",
    },
    {
      id: "accounts",
      stage: "3",
      title: "Federal and Treasury accounts",
      system: "USAspending account APIs",
      count: `${accountCoverage.federalAccounts || 0} federal accounts`,
      detail: `${accountCoverage.treasuryAccounts || 0} Treasury-account children`,
      href: accountSpine?.metadata?.sources?.usaSpendingAgencyAccounts,
      relationship: "published",
    },
    {
      id: "awards",
      stage: "4",
      title: "Contract awards",
      system: "USAspending award search",
      count: `${awardSummary?.awards || 0} sampled awards`,
      detail: `${accountCoverage.exactAwardAccountLinks || 0} exact award-account links`,
      href: executionCoverage.sourceUrl,
      relationship: "exact award IDs",
    },
    {
      id: "transactions",
      stage: "5",
      title: "Award actions and modifications",
      system: "FPDS public actions",
      count: `${(transactionCoverage.fpdsActions || 0).toLocaleString()} actions`,
      detail: `${transactionCoverage.primaryAwardActions || 0} primary-award and ${transactionCoverage.supportingInstrumentActions || 0} supporting-instrument actions`,
      href: "https://sam.gov/fpds",
      relationship: "exact PIID context",
    },
    {
      id: "subawards",
      stage: "6",
      title: "Subaward actions",
      system: "USAspending subaward API",
      count: `${Number(subawardSnapshot.metadata?.reportedSubawardCount || 0).toLocaleString()} reported subawards`,
      detail: `${Number(subawardSnapshot.metadata?.primeWithSubawardsCount || 0).toLocaleString()} indexed primes with activity · ${Number(subawardSnapshot.metadata?.failedPrimeCount || 0).toLocaleString()} unavailable count probes · ${subawardSnapshot.metadata?.status || "unavailable"} snapshot`,
      href: subawardSnapshot.metadata?.sourceUrl || "https://api.usaspending.gov/docs/endpoints",
      relationship: "exact generated prime-award ID",
    },
  ];

  return (
    <div className="grid analytics-sources" data-analytics-sources-page>
      <section className="request-hero">
        <div>
          <span>Lineage and coverage</span>
          <h2>Sources</h2>
          <p>Source systems, record counts, refresh times, and join classes for every stage of the published money flow. No recommendations or opportunity scores are generated here.</p>
        </div>
        <div className="request-hero__facts">
          <article><strong>{healthTotals.targets || sourceHealth.sources?.length || 0}</strong><span>tracked source URLs</span></article>
          <article><strong>{healthTotals.online || 0}</strong><span>online at last probe</span></article>
          <article><strong>{healthTotals.unavailable || 0}</strong><span>unavailable at last probe</span></article>
        </div>
      </section>
      <AnalysisSection title="Money-flow lineage" meta="left to right from request to public subaward actions" icon={Database}>
        <div className="if-ingest-flow if-ingest-flow--mobile-scroll" data-source-flow>
          {layers.map((layer) => <article className="if-ingest-stage" key={layer.id}>
            <span className="if-ingest-stage__index">{layer.stage}</span>
            <div><h3>{layer.title}</h3><p>{layer.system} · {layer.relationship}</p></div>
            <div className="if-ingest-stage__metric"><div><strong>{layer.count}</strong><p>{layer.detail}</p></div>{layer.href ? <a className="if-btn if-btn--secondary if-btn--sm" href={layer.href} target="_blank" rel="noreferrer">Open source <ExternalLink size={13} aria-hidden="true" /></a> : null}</div>
          </article>)}
        </div>
      </AnalysisSection>
      <ControlDisclosure className="source-join-policy" icon={<Network size={16} />} title="Join policy" summary="Six relationship rules; amounts remain at their published grains">
        <div className="if-relationship-bundle-grid if-relationship-bundle-grid--mobile-scroll">
          <article className="if-relationship-bundle"><h3>Request → federal account</h3><p>Derived only when normalized account titles match exactly.</p></article>
          <article className="if-relationship-bundle"><h3>OMB → Treasury account</h3><p>Exact full TAFS/TAS identifier.</p></article>
          <article className="if-relationship-bundle"><h3>Award → federal account</h3><p>Exact USAspending transaction funding-account relationship.</p></article>
          <article className="if-relationship-bundle"><h3>Award → FPDS action</h3><p>Exact PIID, agency/parent, modification, and transaction context.</p></article>
          <article className="if-relationship-bundle"><h3>Prime award → subaward</h3><p>Exact USAspending generated prime-award identifier. Subaward dollars remain separate from prime-award and FPDS totals.</p></article>
          <article className="if-relationship-bundle"><h3>Budget line → award</h3><p>Unlinked unless a public identifier or cited source supports the edge.</p></article>
        </div>
      </ControlDisclosure>
      <AnalysisSection title="Source health" meta={`point-in-time probe ${dateTime(sourceHealth.metadata.checkedAt)}`} icon={RefreshCcw}>
        <div className={`source-health-grid${showAllSourceHealth ? " is-expanded" : ""}`} data-source-health-monitor>
          {visibleHealthSources.map((source) => (
            <details key={source.id} className={`source-health-card source-health-card--${source.health.toLowerCase()}`}>
              <summary className="source-health-card__summary"><div><span>{source.group} · {source.layer}</span><strong>{source.name}</strong></div><b>{source.health}</b></summary>
              <dl><div><dt>Status</dt><dd>{source.status} {source.statusText}</dd></div><div><dt>Probe</dt><dd>{source.method} · {source.responseMs}ms</dd></div><div><dt>Publisher</dt><dd>{source.publisher}</dd></div></dl>
            </details>
          ))}
        </div>
        {orderedHealthSources.length > 5 ? <button type="button" className="if-btn if-btn--secondary source-health-disclosure" aria-expanded={showAllSourceHealth} onClick={() => setShowAllSourceHealth((current) => !current)}>{showAllSourceHealth ? "Show fewer sources" : `Show all ${orderedHealthSources.length} sources`}</button> : null}
      </AnalysisSection>
    </div>
  );
}
