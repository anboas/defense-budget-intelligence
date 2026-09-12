import {
  hierarchy,
  linkHorizontal,
  max,
  scaleLinear,
  scaleOrdinal,
  scaleSqrt,
  schemeTableau10,
  tree,
  treemap,
} from "d3";

const DAY = 86_400_000;

function money(value) {
  const amount = Number(value || 0);
  if (!amount) return "Not published";
  if (amount >= 1_000_000_000) return `$${(amount / 1_000_000_000).toFixed(amount >= 10_000_000_000 ? 1 : 2)}B`;
  if (amount >= 1_000_000) return `$${(amount / 1_000_000).toFixed(amount >= 10_000_000 ? 1 : 2)}M`;
  return `$${Math.round(amount / 1_000).toLocaleString()}K`;
}

function short(value, length = 28) {
  if (!value) return "Not published";
  return value.length > length ? `${value.slice(0, length - 1)}…` : value;
}

function valueOf(record) {
  return Number(record.potentialAmount || record.valueHigh || record.obligatedAmount || record.valueLow || 0);
}

function obligationsOf(record) {
  return Number(record.liveAward?.awardAmountDollars || record.obligatedAmount || 0);
}

function daysBetween(start, end) {
  return Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / DAY);
}

function nextDecision(record, asOf) {
  const futureEvents = (record.events || [])
    .filter((event) => event.start && event.start >= asOf && event.kind !== "potential_performance_end")
    .sort((left, right) => left.start.localeCompare(right.start));
  if (futureEvents.length) return { date: futureEvents[0].start, label: futureEvents[0].label, basis: futureEvents[0].isForecast ? "published forecast" : "published event" };
  if (record.currentEnd && record.currentEnd >= asOf) return { date: record.currentEnd, label: "Reported current end", basis: "contract endpoint, not a recompete date" };
  if (record.potentialEnd && record.potentialEnd >= asOf) return { date: record.potentialEnd, label: "Potential option endpoint", basis: "conditional option horizon" };
  return null;
}

function timingPoints(days) {
  if (days == null) return 0;
  if (days <= 30) return 30;
  if (days <= 90) return 28;
  if (days <= 180) return 24;
  if (days <= 365) return 18;
  if (days <= 730) return 10;
  return 5;
}

function valuePoints(value) {
  if (value >= 500_000_000) return 20;
  if (value >= 100_000_000) return 18;
  if (value >= 50_000_000) return 15;
  if (value >= 10_000_000) return 11;
  if (value >= 1_000_000) return 6;
  return value > 0 ? 3 : 0;
}

function evidencePoints(tier) {
  return ({ corroborated: 20, "official-announcement": 18, "source-reviewed": 14, "prior-evidence": 8, "evidence-gap": 0 })[tier] || 0;
}

function laneFor(score, decisionDays, blocked) {
  if (blocked) return "Verify";
  if (score >= 70 && decisionDays != null && decisionDays <= 180) return "Act now";
  if (score >= 60 && decisionDays != null && decisionDays <= 365) return "Pursue";
  if (score >= 45 && decisionDays != null && decisionDays <= 730) return "Develop";
  return "Monitor";
}

function nextActionFor(record, decision, decisionDays, blocked) {
  if (record.evidenceTier === "evidence-gap") return "Resolve the evidence gap and confirm the responsible buyer.";
  if (blocked) return "Validate the buyer, access route, and current notice before assigning capture effort.";
  if (record.mode === "acquisition-window" && decisionDays != null && decisionDays <= 180) return `Validate ${decision.label.toLowerCase()}, response channel, and vehicle eligibility.`;
  if (record.mode === "contract-performance" && decisionDays != null && decisionDays <= 365) return "Confirm incumbent posture, funded scope, and whether a follow-on action is published.";
  if (record.transactionSummary?.lastSigned && record.transactionSummary.fundingActions > 0) return "Review recent funding modifications and qualify an adjacent funded work package.";
  if (record.vehicle || record.parentReference) return "Map the published vehicle or parent route to buyer demand and partner access.";
  return "Monitor source changes and establish a dated buyer-validation checkpoint.";
}

export function buildTargetSignals(records, asOf) {
  return records.map((record) => {
    const decision = nextDecision(record, asOf);
    const decisionDays = decision ? Math.max(daysBetween(asOf, decision.date), 0) : null;
    const value = valueOf(record);
    const timing = timingPoints(decisionDays);
    const valueScore = valuePoints(value);
    const evidence = evidencePoints(record.evidenceTier);
    const route = Math.min((record.vehicle ? 7 : 0) + (record.parentReference ? 5 : 0) + ((record.fundingOffice || record.contractingOffice || record.owner) ? 3 : 0), 15);
    const lastActionDays = record.transactionSummary?.lastSigned ? daysBetween(record.transactionSummary.lastSigned, asOf) : null;
    const momentum = record.mode === "acquisition-window"
      ? decisionDays != null && decisionDays <= 365 ? 15 : decisionDays != null && decisionDays <= 730 ? 10 : 0
      : Math.min((lastActionDays != null && lastActionDays <= 365 ? 10 : lastActionDays != null && lastActionDays <= 730 ? 5 : 0) + (record.transactionSummary?.fundingActions ? 5 : 0), 15);
    const score = timing + valueScore + evidence + route + momentum;
    const blocked = record.evidenceTier === "evidence-gap" || (decisionDays != null && decisionDays <= 365 && route === 0);
    const lane = laneFor(score, decisionDays, blocked);
    return {
      ...record,
      attentionScore: score,
      decision,
      decisionDays,
      targetValue: value,
      observedObligations: obligationsOf(record),
      factors: { timing, value: valueScore, evidence, route, momentum },
      lane,
      blocked,
      nextAction: nextActionFor(record, decision, decisionDays, blocked),
    };
  }).sort((left, right) => right.attentionScore - left.attentionScore || (left.decisionDays ?? Infinity) - (right.decisionDays ?? Infinity) || right.targetValue - left.targetValue);
}

function TargetMap({ signals, onSelect }) {
  const width = 960;
  const height = 410;
  const x = scaleLinear().domain([0, 730]).range([76, 910]).clamp(true);
  const y = scaleLinear().domain([0, 100]).range([350, 32]);
  const radius = scaleSqrt().domain([0, max(signals, (signal) => signal.targetValue) || 1]).range([6, 30]);
  const colors = new Map([["Act now", "#c43d32"], ["Pursue", "#d97706"], ["Develop", "#0067a3"], ["Verify", "#7a4ca5"], ["Monitor", "#60798b"]]);
  const plotted = signals.filter((signal) => signal.decisionDays != null).slice(0, 60);
  return (
    <div className="target-d3-scroll" data-capture-chart="target-map" data-targeting-chart="target-map">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-labelledby="target-map-title target-map-desc">
        <title id="target-map-title">Target attention map</title>
        <desc id="target-map-desc">Published decision horizon on the horizontal axis and explainable attention score on the vertical axis. Bubble area represents reported value.</desc>
        {[0, 25, 50, 75, 100].map((tick) => <g key={tick}><line x1="76" x2="910" y1={y(tick)} y2={y(tick)} className="target-gridline" /><text x="66" y={y(tick) + 4} textAnchor="end" className="target-axis-label">{tick}</text></g>)}
        {[0, 90, 180, 365, 730].map((tick) => <g key={tick}><line y1="32" y2="350" x1={x(tick)} x2={x(tick)} className="target-gridline" /><text x={x(tick)} y="373" textAnchor="middle" className="target-axis-label">{tick === 0 ? "Now" : `${tick}d`}</text></g>)}
        <text x="493" y="400" textAnchor="middle" className="target-axis-title">Days to next published decision or reported endpoint</text>
        <text transform="translate(18 190) rotate(-90)" textAnchor="middle" className="target-axis-title">Attention score</text>
        {plotted.map((signal, index) => {
          const cx = x(Math.min(signal.decisionDays, 730));
          const cy = y(signal.attentionScore);
          const r = radius(signal.targetValue);
          return <g key={signal.opportunityId} className="target-bubble" role="button" tabIndex="0" aria-label={`${signal.title}, attention score ${signal.attentionScore}, ${signal.decisionDays} days to ${signal.decision.label}`} onClick={() => onSelect(signal.opportunityId)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSelect(signal.opportunityId); } }}>
            <circle className="target-bubble__hit" cx={cx} cy={cy} r={Math.max(r, 22)} />
            <circle className="target-bubble__mark" cx={cx} cy={cy} r={r} fill={colors.get(signal.lane)} fillOpacity="0.78"><title>{`${signal.id} · ${signal.title}\n${signal.lane} · score ${signal.attentionScore}\n${signal.decision.label}: ${signal.decision.date}\nReported value: ${money(signal.targetValue)}`}</title></circle>
            {index < 10 ? <text x={cx} y={cy + 3} textAnchor="middle">{signal.id}</text> : null}
          </g>;
        })}
      </svg>
      <div className="target-chart-legend">{[...colors].map(([lane, color]) => <span key={lane}><i style={{ background: color }} />{lane}</span>)}<small>Bubble area = reported potential or high value</small></div>
    </div>
  );
}

function AllocationTreemap({ signals, onFilter }) {
  const grouped = new Map();
  for (const signal of signals) {
    const current = grouped.get(signal.portfolio) || { name: signal.portfolio, value: 0, obligations: 0, count: 0, scoreTotal: 0 };
    current.value += signal.targetValue;
    current.obligations += signal.observedObligations;
    current.count += 1;
    current.scoreTotal += signal.attentionScore;
    grouped.set(signal.portfolio, current);
  }
  const root = hierarchy({ children: [...grouped.values()] }).sum((node) => node.value || 0).sort((left, right) => right.value - left.value);
  treemap().size([960, 340]).paddingInner(3).paddingOuter(3)(root);
  const color = scaleOrdinal([...grouped.keys()], schemeTableau10);
  return (
    <div className="target-d3-scroll" data-capture-chart="target-treemap" data-targeting-chart="target-treemap">
      <svg viewBox="0 0 960 340" role="img" aria-labelledby="target-treemap-title target-treemap-desc">
        <title id="target-treemap-title">Filtered reported value by portfolio</title>
        <desc id="target-treemap-desc">Area represents the sum of reported potential or high values. Selecting a portfolio filters the Gantt.</desc>
        {root.leaves().map((leaf) => {
          const row = leaf.data;
          const width = leaf.x1 - leaf.x0;
          const height = leaf.y1 - leaf.y0;
          const interactive = width >= 44 && height >= 44;
          return <g key={row.name} className={`target-treemap-node${interactive ? " is-interactive" : ""}`} role={interactive ? "button" : undefined} tabIndex={interactive ? "0" : undefined} onClick={interactive ? () => onFilter({ capPortfolio: row.name }) : undefined} onKeyDown={interactive ? (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onFilter({ capPortfolio: row.name }); } } : undefined} aria-label={interactive ? `${row.name}, ${money(row.value)} reported value, ${row.count} records` : undefined}>
            <rect x={leaf.x0} y={leaf.y0} width={width} height={height} fill={color(row.name)} />
            {width > 105 && height > 54 ? <><text x={leaf.x0 + 9} y={leaf.y0 + 20}>{short(row.name, Math.max(Math.floor(width / 8), 12))}</text><text x={leaf.x0 + 9} y={leaf.y0 + 39} className="target-treemap-value">{money(row.value)} · {row.count} records</text></> : null}
            <title>{`${row.name}\n${money(row.value)} reported value\n${money(row.obligations)} observed obligations\nAverage attention score ${Math.round(row.scoreTotal / row.count)}`}</title>
          </g>;
        })}
      </svg>
    </div>
  );
}

function RouteMap({ signals, onSelect }) {
  const top = signals.filter((signal) => signal.lane !== "Monitor").slice(0, 10);
  const officeGroups = new Map();
  for (const signal of top) {
    const office = signal.fundingOffice || signal.contractingOffice || signal.owner || "Buyer not published";
    const route = signal.parentReference ? `Parent ${signal.parentReference}` : signal.vehicle || "Route not published";
    if (!officeGroups.has(office)) officeGroups.set(office, new Map());
    const routeGroups = officeGroups.get(office);
    if (!routeGroups.has(route)) routeGroups.set(route, []);
    routeGroups.get(route).push(signal);
  }
  const data = {
    name: "Target routes",
    children: [...officeGroups].map(([office, routes]) => ({
      name: office,
      children: [...routes].map(([route, records]) => ({ name: route, children: records.map((signal) => ({ name: signal.id, signal })) })),
    })),
  };
  const root = hierarchy(data);
  tree().size([Math.max(340, top.length * 38), 780])(root);
  const height = Math.max(400, top.length * 38 + 60);
  const link = linkHorizontal().x((node) => node.y + 70).y((node) => node.x + 28);
  return (
    <div className="target-d3-scroll target-route-scroll" data-capture-chart="target-route-map" data-targeting-chart="target-route-map">
      <svg viewBox={`0 0 960 ${height}`} role="img" aria-labelledby="target-route-title target-route-desc">
        <title id="target-route-title">Published buyer and vehicle route map</title>
        <desc id="target-route-desc">The top non-monitor targets connect from buyer to published vehicle or parent award to opportunity. Missing routes are labeled rather than inferred.</desc>
        {root.links().map((edge, index) => <path key={`${edge.source.data.name}-${edge.target.data.name}-${index}`} d={link(edge)} className="target-route-link" />)}
        {root.descendants().map((node, index) => {
          const signal = node.data.signal;
          return <g key={`${node.data.name}-${index}`} transform={`translate(${node.y + 70},${node.x + 28})`} className={`target-route-node${signal ? " is-record" : ""}`} role={signal ? "button" : undefined} tabIndex={signal ? "0" : undefined} onClick={signal ? () => onSelect(signal.opportunityId) : undefined} onKeyDown={signal ? (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSelect(signal.opportunityId); } } : undefined} aria-label={signal ? `${signal.id}, ${signal.title}, attention score ${signal.attentionScore}` : undefined}>
            {signal ? <rect className="target-route-node__hit" x="-22" y="-22" width="96" height="44" /> : null}
            <circle r={signal ? 8 : node.depth === 0 ? 7 : 5} />
            <text x={node.children ? -10 : 11} dy="0.32em" textAnchor={node.children ? "end" : "start"}>{node.depth === 1 ? short(node.data.name, 30) : node.depth === 2 ? short(node.data.name, 24) : node.data.name}</text>
            {signal ? <title>{`${signal.id} · ${signal.title}\n${signal.lane} · score ${signal.attentionScore}`}</title> : null}
          </g>;
        })}
      </svg>
    </div>
  );
}

function FactorBar({ factors }) {
  const rows = [["Timing", factors.timing, 30], ["Value", factors.value, 20], ["Evidence", factors.evidence, 20], ["Route", factors.route, 15], ["Momentum", factors.momentum, 15]];
  return <div className="target-factor-bar" aria-label={rows.map(([name, value, maximum]) => `${name} ${value} of ${maximum}`).join(", ")}>{rows.map(([name, value, maximum]) => <i key={name} title={`${name}: ${value}/${maximum}`} style={{ width: `${(value / maximum) * 20}%` }} data-factor={name.toLowerCase()} />)}</div>;
}

export default function CaptureTargeting({ records, asOf, onSelect, onFilter }) {
  const signals = buildTargetSignals(records, asOf);
  const ranked = signals.slice(0, 12);
  const lanes = ["Act now", "Pursue", "Develop", "Verify", "Monitor"].map((lane) => ({ lane, count: signals.filter((signal) => signal.lane === lane).length }));
  const nearTerm = signals.filter((signal) => signal.decisionDays != null && signal.decisionDays <= 180);
  const blocked = signals.filter((signal) => signal.blocked);
  const strongestPortfolio = [...new Map(signals.map((signal) => [signal.portfolio, 0])).keys()]
    .map((portfolio) => ({ portfolio, score: signals.filter((signal) => signal.portfolio === portfolio).reduce((sum, signal) => sum + signal.attentionScore, 0) }))
    .sort((left, right) => right.score - left.score)[0];

  function selectRecord(opportunityId) {
    onSelect(opportunityId);
    window.requestAnimationFrame(() => document.querySelector("[data-capture-detail]")?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }

  return (
    <section className="capture-targeting" data-capture-targeting>
      <div className="capture-targeting__heading">
        <div><span>D3 targeting workspace</span><h2>Where to place capture effort</h2><p>Transparent attention scores rank timing, reported value, evidence, published access route, and funding momentum. Scores direct analyst attention; they are not win probabilities or proof of procurement.</p></div>
        <div className="capture-targeting__lanes">{lanes.map((row) => <span key={row.lane}><b>{row.count}</b>{row.lane}</span>)}</div>
      </div>

      <div className="capture-targeting__interpretations" aria-label="Targeting interpretation">
        <article><span>Near-term decisions</span><strong>{nearTerm.length}</strong><p>Published events or reported endpoints within 180 days. Validate each endpoint before treating it as acquisition timing.</p></article>
        <article><span>Verification blockers</span><strong>{blocked.length}</strong><p>Near-term rows missing a published route or carrying an evidence gap. Resolve these before assigning bid resources.</p></article>
        <article><span>Strongest portfolio signal</span><strong>{strongestPortfolio?.portfolio || "None"}</strong><p>Highest combined attention score in the current filtered universe, not a recommendation to pursue every record.</p></article>
      </div>

      <div className="capture-targeting__visuals">
        <section><header><div><strong>Target map</strong><small>Score versus next published decision</small></div></header><TargetMap signals={signals} onSelect={selectRecord} /></section>
        <section><header><div><strong>Portfolio allocation</strong><small>Area = reported potential or high value</small></div></header><AllocationTreemap signals={signals} onFilter={onFilter} /></section>
        <section className="capture-targeting__route"><header><div><strong>Buyer and access routes</strong><small>Top targets through published office and vehicle/parent relationships</small></div></header><RouteMap signals={signals} onSelect={selectRecord} /></section>
      </div>

      <section className="capture-target-list" data-capture-target-list>
        <div className="capture-target-list__heading"><div><strong>Ranked targeting queue</strong><small>Click a record to inspect source evidence, events, and exact FPDS history.</small></div><span>Timing 30 · value 20 · evidence 20 · route 15 · momentum 15</span></div>
        <div className="capture-target-list__rows">
          {ranked.map((signal, index) => <button type="button" key={signal.opportunityId} onClick={() => selectRecord(signal.opportunityId)}>
            <span className="capture-target-list__rank">{index + 1}</span>
            <span className={`capture-target-list__score capture-target-list__score--${signal.lane.toLowerCase().replace(" ", "-")}`}><b>{signal.attentionScore}</b><small>{signal.lane}</small></span>
            <span className="capture-target-list__record"><b>{signal.id} · {signal.title}</b><small>{signal.party} · {signal.portfolio}</small><FactorBar factors={signal.factors} /></span>
            <span className="capture-target-list__decision"><b>{signal.decision ? `${signal.decision.label} · ${signal.decision.date}` : "No future decision published"}</b><small>{signal.decision ? `${signal.decisionDays} days · ${signal.decision.basis}` : "Create a monitoring checkpoint"}</small></span>
            <span className="capture-target-list__action"><b>Next action</b><small>{signal.nextAction}</small></span>
          </button>)}
        </div>
      </section>

      <details className="capture-targeting__method"><summary>How the attention score works</summary><p>Timing contributes up to 30 points using the nearest future published event or reported endpoint. Reported potential or high value contributes up to 20. Evidence quality contributes up to 20. A published buyer, vehicle, or parent route contributes up to 15. Recent funding actions or a near-term acquisition event contribute up to 15. Evidence gaps and near-term records without a published route enter the Verify lane. The model does not estimate probability of win, available workshare, revenue, or an unpublished recompete.</p></details>
    </section>
  );
}
