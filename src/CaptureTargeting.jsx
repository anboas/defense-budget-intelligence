import {
  hierarchy,
  linkHorizontal,
  max,
  pack,
  scaleLinear,
  scaleOrdinal,
  scaleSqrt,
  schemeTableau10,
  tree,
  treemap,
} from "d3";
import { useEffect, useMemo, useState } from "react";

const DAY = 86_400_000;
const TARGET_WORKBOARD_STORAGE_KEY = "dbi:capture-target-workboard:v1";
const WORKBOARD_STAGES = ["verify", "qualify", "shape", "bid", "monitor", "complete"];

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

function addDays(value, days) {
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function normalizeWorkboard(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  return value.flatMap((candidate) => {
    if (!candidate || typeof candidate !== "object") return [];
    const opportunityId = String(candidate.opportunityId || "");
    if (!/^opp_[a-z0-9]+$/.test(opportunityId) || seen.has(opportunityId)) return [];
    seen.add(opportunityId);
    return [{
      opportunityId,
      stage: WORKBOARD_STAGES.includes(candidate.stage) ? candidate.stage : "verify",
      owner: typeof candidate.owner === "string" ? candidate.owner.slice(0, 80) : "",
      dueDate: /^\d{4}-\d{2}-\d{2}$/.test(candidate.dueDate || "") ? candidate.dueDate : "",
      note: typeof candidate.note === "string" ? candidate.note.slice(0, 500) : "",
      createdAt: typeof candidate.createdAt === "string" ? candidate.createdAt : new Date().toISOString(),
      updatedAt: typeof candidate.updatedAt === "string" ? candidate.updatedAt : new Date().toISOString(),
    }];
  }).slice(0, 24);
}

function readWorkboard() {
  try {
    return normalizeWorkboard(JSON.parse(window.localStorage.getItem(TARGET_WORKBOARD_STORAGE_KEY) || "[]"));
  } catch {
    return [];
  }
}

function suggestedStage(signal) {
  if (signal.blocked || signal.evidenceTier === "evidence-gap") return "verify";
  if (signal.factors.route < 8) return "qualify";
  if (signal.lane === "Act now" || signal.lane === "Pursue") return "shape";
  return "monitor";
}

function suggestedCheckpoint(signal, asOf) {
  const interval = signal.decisionDays == null ? 60 : signal.decisionDays <= 30 ? 3 : signal.decisionDays <= 90 ? 7 : signal.decisionDays <= 180 ? 14 : signal.decisionDays <= 365 ? 30 : 60;
  const checkpoint = addDays(asOf, interval);
  return signal.decision?.date && signal.decision.date < checkpoint ? signal.decision.date : checkpoint;
}

function exportWorkboard(rows, asOf) {
  const fields = ["opportunity_id", "gantt_alias", "title", "portfolio", "attention_score", "attention_lane", "analyst_stage", "owner", "analyst_checkpoint", "next_published_signal", "published_buyer", "published_route", "evidence_tier", "observed_obligations_usd", "reported_value_usd", "next_action", "analyst_note", "snapshot_as_of"];
  const escape = (value) => `"${String(value ?? "").replaceAll('"', '""')}"`;
  const records = rows.map(({ task, signal }) => ({
    opportunity_id: signal.opportunityId,
    gantt_alias: signal.id,
    title: signal.title,
    portfolio: signal.portfolio,
    attention_score: signal.attentionScore,
    attention_lane: signal.lane,
    analyst_stage: task.stage,
    owner: task.owner,
    analyst_checkpoint: task.dueDate,
    next_published_signal: signal.decision ? `${signal.decision.label} · ${signal.decision.date} · ${signal.decision.basis}` : "Not published",
    published_buyer: officeOf(signal),
    published_route: signal.parentReference || signal.vehicle || "Not published",
    evidence_tier: signal.evidenceTier,
    observed_obligations_usd: signal.observedObligations,
    reported_value_usd: signal.targetValue,
    next_action: signal.nextAction,
    analyst_note: task.note,
    snapshot_as_of: asOf,
  }));
  const csv = [fields.join(","), ...records.map((record) => fields.map((field) => escape(record[field])).join(","))].join("\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "capture-target-workboard.csv";
  anchor.click();
  URL.revokeObjectURL(url);
}

function valueOf(record) {
  return Number(record.potentialAmount || record.valueHigh || record.obligatedAmount || record.valueLow || 0);
}

function obligationsOf(record) {
  return Number(record.liveAward?.awardAmountDollars || record.obligatedAmount || 0);
}

function officeOf(record) {
  return record.fundingOffice || record.contractingOffice || record.owner || "Buyer not published";
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

function buildAdjacencies(active, signals) {
  if (!active) return [];
  const candidates = [];
  const seen = new Set([active.opportunityId]);
  const add = (signal, relationship, basis, strength) => {
    if (!signal || seen.has(signal.opportunityId)) return;
    seen.add(signal.opportunityId);
    candidates.push({ signal, relationship, basis, strength });
  };
  if (active.parentReference) signals.filter((signal) => signal.parentReference === active.parentReference).forEach((signal) => add(signal, "Same parent award", "exact published identifier", 4));
  if (active.vehicle) signals.filter((signal) => signal.vehicle === active.vehicle).forEach((signal) => add(signal, "Same vehicle", "published vehicle label", 3));
  const activeOffice = officeOf(active);
  if (activeOffice !== "Buyer not published") signals.filter((signal) => officeOf(signal) === activeOffice).forEach((signal) => add(signal, "Same buyer", "published office context", 2));
  signals.filter((signal) => signal.portfolio === active.portfolio).forEach((signal) => add(signal, "Same portfolio", "editorial portfolio context", 1));
  return candidates
    .sort((left, right) => right.strength - left.strength || right.signal.attentionScore - left.signal.attentionScore)
    .slice(0, 12);
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

function BuyerPortfolioMatrix({ signals, onFilter }) {
  const officeTotals = new Map();
  const portfolioTotals = new Map();
  const cells = new Map();
  for (const signal of signals) {
    const office = officeOf(signal);
    if (office === "Buyer not published") continue;
    officeTotals.set(office, (officeTotals.get(office) || 0) + signal.attentionScore);
    portfolioTotals.set(signal.portfolio, (portfolioTotals.get(signal.portfolio) || 0) + signal.attentionScore);
    const key = `${office}|${signal.portfolio}`;
    const cell = cells.get(key) || { count: 0, score: 0, value: 0 };
    cell.count += 1;
    cell.score += signal.attentionScore;
    cell.value += signal.targetValue;
    cells.set(key, cell);
  }
  const offices = [...officeTotals].sort((left, right) => right[1] - left[1]).slice(0, 7).map(([name]) => name);
  const portfolios = [...portfolioTotals].sort((left, right) => right[1] - left[1]).slice(0, 6).map(([name]) => name);
  const width = 960;
  const left = 230;
  const top = 82;
  const cellWidth = (width - left - 18) / Math.max(portfolios.length, 1);
  const cellHeight = 48;
  const height = top + offices.length * cellHeight + 30;
  const maximum = max([...cells.values()], (cell) => cell.score) || 1;
  return (
    <div className="target-d3-scroll" data-capture-chart="buyer-portfolio-matrix" data-targeting-chart="buyer-portfolio-matrix">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-labelledby="buyer-matrix-title buyer-matrix-desc">
        <title id="buyer-matrix-title">Buyer and portfolio targeting coverage</title>
        <desc id="buyer-matrix-desc">Top published buying offices by portfolio. Color intensity represents combined attention score. Empty cells mean no matching public rows in this dataset, not proven market whitespace. Selecting a populated cell filters the full workspace.</desc>
        {portfolios.map((portfolio, index) => <text key={portfolio} className="target-matrix__column" transform={`translate(${left + index * cellWidth + cellWidth / 2} ${top - 10}) rotate(-34)`} textAnchor="start">{short(portfolio, 24)}</text>)}
        {offices.map((office, rowIndex) => <g key={office}>
          <text className="target-matrix__row" x={left - 10} y={top + rowIndex * cellHeight + cellHeight / 2 + 4} textAnchor="end">{short(office, 34)}</text>
          {portfolios.map((portfolio, columnIndex) => {
            const cell = cells.get(`${office}|${portfolio}`);
            const x = left + columnIndex * cellWidth;
            const y = top + rowIndex * cellHeight;
            if (!cell) return <rect key={portfolio} x={x + 2} y={y + 2} width={cellWidth - 4} height={cellHeight - 4} className="target-matrix__empty" />;
            const opacity = 0.2 + (cell.score / maximum) * 0.8;
            return <g key={portfolio} className="target-matrix__cell" role="button" tabIndex="0" aria-label={`${office}, ${portfolio}, ${cell.count} records, combined attention ${cell.score}`} onClick={() => onFilter({ capOffice: office, capPortfolio: portfolio })} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onFilter({ capOffice: office, capPortfolio: portfolio }); } }}>
              <rect x={x + 2} y={y + 2} width={cellWidth - 4} height={cellHeight - 4} style={{ opacity }} />
              <text x={x + cellWidth / 2} y={y + 22} textAnchor="middle">{cell.count}</text>
              <text x={x + cellWidth / 2} y={y + 35} textAnchor="middle" className="target-matrix__score">{cell.score} attention</text>
              <title>{`${office}\n${portfolio}\n${cell.count} records · ${cell.score} combined attention\n${money(cell.value)} reported value`}</title>
            </g>;
          })}
        </g>)}
      </svg>
    </div>
  );
}

function IncumbentPack({ signals, onFilter }) {
  const grouped = new Map();
  for (const signal of signals.filter((row) => row.party && row.targetValue > 0)) {
    const current = grouped.get(signal.party) || { name: signal.party, value: 0, obligations: 0, records: 0, score: 0 };
    current.value += signal.targetValue;
    current.obligations += signal.observedObligations;
    current.records += 1;
    current.score += signal.attentionScore;
    grouped.set(signal.party, current);
  }
  const root = hierarchy({ children: [...grouped.values()] }).sum((node) => node.value || 0).sort((left, right) => right.value - left.value);
  pack().size([960, 400]).padding(5)(root);
  const scoreColor = scaleLinear().domain([25, 85]).range(["#8aa5b6", "#b8322a"]).clamp(true);
  return (
    <div className="target-d3-scroll" data-capture-chart="incumbent-pack" data-targeting-chart="incumbent-pack">
      <svg viewBox="0 0 960 400" role="img" aria-labelledby="incumbent-pack-title incumbent-pack-desc">
        <title id="incumbent-pack-title">Incumbent concentration map</title>
        <desc id="incumbent-pack-desc">Circle area represents reported potential or high value by named company. Color represents average attention score. Large circles are selectable and filter the workspace.</desc>
        {root.leaves().map((leaf) => {
          const row = leaf.data;
          const average = row.score / row.records;
          const interactive = leaf.r >= 22;
          return <g key={row.name} transform={`translate(${leaf.x},${leaf.y})`} className={`target-pack-node${interactive ? " is-interactive" : ""}`} role={interactive ? "button" : undefined} tabIndex={interactive ? "0" : undefined} aria-label={interactive ? `${row.name}, ${row.records} records, ${money(row.value)} reported value` : undefined} onClick={interactive ? () => onFilter({ capParty: row.name }) : undefined} onKeyDown={interactive ? (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onFilter({ capParty: row.name }); } } : undefined}>
            <circle r={leaf.r} fill={scoreColor(average)} />
            {leaf.r >= 34 ? <><text y="-3" textAnchor="middle">{short(row.name, Math.max(10, Math.floor(leaf.r / 3.8)))}</text><text y="12" textAnchor="middle" className="target-pack-node__value">{money(row.value)} · {row.records}</text></> : null}
            <title>{`${row.name}\n${row.records} records · ${money(row.value)} reported value\n${money(row.obligations)} observed obligations\nAverage attention ${Math.round(average)}`}</title>
          </g>;
        })}
      </svg>
      <div className="target-chart-legend"><small>Area = reported value · color shifts toward red as average attention rises</small></div>
    </div>
  );
}

function AdjacencyMap({ active, signals, onSelect }) {
  const adjacencies = buildAdjacencies(active, signals);
  const width = 960;
  const height = 420;
  const center = { x: 480, y: 210 };
  const colors = new Map([["Same parent award", "#0b6b53"], ["Same vehicle", "#0067a3"], ["Same buyer", "#7a4ca5"], ["Same portfolio", "#60798b"]]);
  return (
    <div className="target-d3-scroll" data-capture-chart="adjacency-map" data-targeting-chart="adjacency-map">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-labelledby="adjacency-title adjacency-desc">
        <title id="adjacency-title">Published and contextual adjacencies for {active?.title || "the selected target"}</title>
        <desc id="adjacency-desc">The selected target is connected to records sharing an exact parent award, published vehicle, published buyer, or editorial portfolio. Each relationship is labeled by basis.</desc>
        {adjacencies.map((adjacency, index) => {
          const angle = (Math.PI * 2 * index) / Math.max(adjacencies.length, 1) - Math.PI / 2;
          const radius = index % 2 ? 164 : 142;
          const x = center.x + Math.cos(angle) * radius;
          const y = center.y + Math.sin(angle) * radius;
          return <g key={adjacency.signal.opportunityId}>
            <line x1={center.x} y1={center.y} x2={x} y2={y} stroke={colors.get(adjacency.relationship)} className="target-adjacency__link" />
            <text x={(center.x + x) / 2} y={(center.y + y) / 2 - 5} textAnchor="middle" className="target-adjacency__edge-label">{adjacency.relationship.replace("Same ", "")}</text>
            <g transform={`translate(${x},${y})`} className="target-adjacency__node" role="button" tabIndex="0" aria-label={`${adjacency.signal.id}, ${adjacency.signal.title}, ${adjacency.relationship}, ${adjacency.basis}`} onClick={() => onSelect(adjacency.signal.opportunityId)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSelect(adjacency.signal.opportunityId); } }}>
              <circle r="24" fill={colors.get(adjacency.relationship)} />
              <text textAnchor="middle" dy="3">{adjacency.signal.id}</text>
              <title>{`${adjacency.signal.id} · ${adjacency.signal.title}\n${adjacency.relationship} · ${adjacency.basis}\nAttention ${adjacency.signal.attentionScore}`}</title>
            </g>
          </g>;
        })}
        {active ? <g transform={`translate(${center.x},${center.y})`} className="target-adjacency__active"><circle r="43" /><text textAnchor="middle" y="-2">{active.id}</text><text textAnchor="middle" y="14">Score {active.attentionScore}</text></g> : null}
        {!adjacencies.length ? <text x={center.x} y={center.y + 80} textAnchor="middle" className="target-axis-title">No published or contextual adjacencies in the filtered set.</text> : null}
      </svg>
      <div className="target-chart-legend">{[...colors].map(([name, color]) => <span key={name}><i style={{ background: color }} />{name}</span>)}</div>
    </div>
  );
}

function TargetBrief({ signal, adjacencies, onSelect }) {
  if (!signal) return null;
  const route = signal.parentReference ? `Parent ${signal.parentReference}` : signal.vehicle || "No published vehicle or parent";
  const utilization = signal.targetValue > 0 ? Math.min((signal.observedObligations / signal.targetValue) * 100, 100) : null;
  const evidenceAction = signal.evidenceTier === "evidence-gap" ? "Resolve the source gap before assigning pursuit resources." : "Recheck the current notice and confirm the responsible buyer.";
  const accessAction = signal.vehicle || signal.parentReference ? `Validate eligibility and partner access through ${route}.` : "Identify the contract vehicle, parent instrument, or partner route from an official source.";
  const fundingAction = signal.transactionSummary?.fundingActions ? `Review ${signal.transactionSummary.fundingActions} funding actions through ${signal.transactionSummary.lastSigned || "the latest published modification"} and isolate adjacent funded scope.` : "Establish a recurring funding and modification watch.";
  return (
    <section className="target-brief" data-capture-target-brief>
      <header><div><span>Target execution brief</span><h3>{signal.id} · {signal.title}</h3><p>{signal.context || signal.sourceDescription || "Published scope description unavailable."}</p></div><div className={`target-brief__score target-brief__score--${signal.lane.toLowerCase().replace(" ", "-")}`}><b>{signal.attentionScore}</b><span>{signal.lane}</span></div></header>
      <div className="target-brief__facts">
        <article><span>Why now</span><strong>{signal.decision ? `${signal.decision.label} · ${signal.decision.date}` : "No future event published"}</strong><p>{signal.decision ? `${signal.decisionDays} days · ${signal.decision.basis}` : "Create a dated monitoring checkpoint."}</p></article>
        <article><span>Buyer and route</span><strong>{officeOf(signal)}</strong><p>{route}</p></article>
        <article><span>Incumbent posture</span><strong>{signal.party || "Not published"}</strong><p>{money(signal.observedObligations)} observed obligations · {money(signal.targetValue)} reported value{utilization != null ? ` · ${Math.round(utilization)}% obligated/value ratio` : ""}</p></article>
        <article><span>Evidence gate</span><strong>{signal.evidenceTier.replaceAll("-", " ")}</strong><p>{signal.sourceRoleCount || 0} source roles · {signal.validationStatus || "validation not published"}</p></article>
      </div>
      <div className="target-brief__plan">
        <article><b>1</b><div><strong>Verify the demand signal</strong><p>{evidenceAction}</p></div></article>
        <article><b>2</b><div><strong>Qualify the access route</strong><p>{accessAction}</p></div></article>
        <article><b>3</b><div><strong>Build the funded wedge</strong><p>{fundingAction}</p></div></article>
      </div>
      <div className="target-brief__adjacencies"><span>Adjacent records to inspect</span>{adjacencies.length ? adjacencies.slice(0, 6).map((adjacency) => <button type="button" key={adjacency.signal.opportunityId} onClick={() => onSelect(adjacency.signal.opportunityId)}><b>{adjacency.signal.id}</b><span>{short(adjacency.signal.title, 42)}</span><small>{adjacency.relationship} · {adjacency.basis}</small></button>) : <p>No adjacent published identifiers or contextual portfolio records in the current filtered set.</p>}</div>
      <small className="target-brief__boundary">This brief organizes public evidence. It does not establish customer intent, available workshare, partner access, a recompete, or probability of win.</small>
    </section>
  );
}

function TargetWorkboard({ signals, active, asOf, onSelect }) {
  const [tasks, setTasks] = useState(readWorkboard);
  const signalMap = useMemo(() => new Map(signals.map((signal) => [signal.opportunityId, signal])), [signals]);
  const visibleRows = useMemo(() => tasks
    .map((task) => ({ task, signal: signalMap.get(task.opportunityId) }))
    .filter((row) => row.signal)
    .sort((left, right) => (left.task.stage === "complete") - (right.task.stage === "complete") || (left.task.dueDate || "9999-12-31").localeCompare(right.task.dueDate || "9999-12-31") || right.signal.attentionScore - left.signal.attentionScore), [tasks, signalMap]);
  const hiddenCount = tasks.length - visibleRows.length;
  const stageCounts = WORKBOARD_STAGES.map((stage) => ({ stage, count: visibleRows.filter((row) => row.task.stage === stage).length }));
  const dueSoon = visibleRows.filter(({ task }) => task.stage !== "complete" && task.dueDate && task.dueDate >= asOf && task.dueDate <= addDays(asOf, 30)).length;

  useEffect(() => {
    window.localStorage.setItem(TARGET_WORKBOARD_STORAGE_KEY, JSON.stringify(tasks));
  }, [tasks]);

  function addSignals(candidates) {
    setTasks((current) => {
      const existing = new Set(current.map((task) => task.opportunityId));
      const now = new Date().toISOString();
      const additions = candidates.filter((signal) => signal && !existing.has(signal.opportunityId)).map((signal) => ({
        opportunityId: signal.opportunityId,
        stage: suggestedStage(signal),
        owner: "",
        dueDate: suggestedCheckpoint(signal, asOf),
        note: "",
        createdAt: now,
        updatedAt: now,
      }));
      return normalizeWorkboard([...current, ...additions]);
    });
  }

  function updateTask(opportunityId, patch) {
    setTasks((current) => current.map((task) => task.opportunityId === opportunityId ? { ...task, ...patch, updatedAt: new Date().toISOString() } : task));
  }

  function removeTask(opportunityId) {
    setTasks((current) => current.filter((task) => task.opportunityId !== opportunityId));
  }

  return (
    <section className="target-workboard" data-capture-workboard>
      <header>
        <div><span>Browser-local execution</span><h3>Target workboard</h3><p>Turn public signals into analyst-owned checkpoints. Owners, stages, dates, and notes stay in this browser and never enter the public dataset or URL.</p></div>
        <div className="target-workboard__actions">
          <button type="button" onClick={() => addSignals([active])} disabled={!active || tasks.some((task) => task.opportunityId === active.opportunityId)}>Track selected</button>
          <button type="button" onClick={() => addSignals(signals.filter((signal) => signal.lane !== "Monitor").slice(0, 5))}>Seed top 5</button>
          <button type="button" onClick={() => exportWorkboard(visibleRows, asOf)} disabled={!visibleRows.length}>Export board</button>
        </div>
      </header>
      <div className="target-workboard__status" aria-label="Target workboard status">
        {stageCounts.map(({ stage, count }) => <span key={stage} data-stage={stage}><b>{count}</b>{stage}</span>)}
        <span data-stage="due"><b>{dueSoon}</b>due ≤30d</span>
      </div>
      {hiddenCount ? <p className="target-workboard__hidden">{hiddenCount} tracked {hiddenCount === 1 ? "target is" : "targets are"} outside the current filters. Reset filters to manage the full board.</p> : null}
      {visibleRows.length ? <div className="target-workboard__rows">
        {visibleRows.map(({ task, signal }, index) => <article key={task.opportunityId} data-workboard-row={signal.opportunityId}>
          <details defaultOpen={index === 0}>
            <summary className="target-workboard__record"><span><b>{signal.id} · {signal.title}</b><small>{signal.lane} · attention {signal.attentionScore}</small></span><strong>{task.stage} · {task.dueDate || "no checkpoint"}</strong></summary>
            <div className="target-workboard__row-actions"><button type="button" onClick={() => onSelect(signal.opportunityId)}>Open evidence</button><button type="button" onClick={() => removeTask(signal.opportunityId)} aria-label={`Remove ${signal.title} from target workboard`}>Remove target</button></div>
            <div className="target-workboard__evidence">
              <span><b>Next published signal</b>{signal.decision ? `${signal.decision.label} · ${signal.decision.date}` : "Not published"}</span>
              <span><b>Buyer / route</b>{officeOf(signal)} · {signal.parentReference || signal.vehicle || "route not published"}</span>
              <span><b>Funding posture</b>{money(signal.observedObligations)} observed · {signal.transactionSummary?.fundingActions || 0} funding actions</span>
              <span><b>Recommended action</b>{signal.nextAction}</span>
            </div>
            <div className="target-workboard__fields">
              <label><span>Analyst stage</span><select aria-label={`Analyst stage for ${signal.id}`} value={task.stage} onChange={(event) => updateTask(signal.opportunityId, { stage: event.target.value })}>{WORKBOARD_STAGES.map((stage) => <option key={stage} value={stage}>{stage[0].toUpperCase() + stage.slice(1)}</option>)}</select></label>
              <label><span>Owner</span><input aria-label={`Owner for ${signal.id}`} value={task.owner} maxLength="80" placeholder="Unassigned" onChange={(event) => updateTask(signal.opportunityId, { owner: event.target.value })} /></label>
              <label><span>Analyst checkpoint</span><input aria-label={`Analyst checkpoint for ${signal.id}`} type="date" value={task.dueDate} onChange={(event) => updateTask(signal.opportunityId, { dueDate: event.target.value })} /></label>
              <label className="target-workboard__note"><span>Private browser note</span><textarea aria-label={`Private browser note for ${signal.id}`} value={task.note} maxLength="500" rows="2" placeholder="Decision, question, or next contact to resolve" onChange={(event) => updateTask(signal.opportunityId, { note: event.target.value })} /></label>
            </div>
          </details>
        </article>)}
      </div> : <div className="target-workboard__empty"><strong>No targets tracked yet.</strong><p>Track the selected record or seed the five highest non-monitor signals, then assign a stage, owner, checkpoint, and private note.</p></div>}
      <small className="target-workboard__boundary">Suggested checkpoints are analyst planning dates derived from the snapshot horizon. They are not government deadlines, customer commitments, or evidence of a procurement.</small>
    </section>
  );
}

function FactorBar({ factors }) {
  const rows = [["Timing", factors.timing, 30], ["Value", factors.value, 20], ["Evidence", factors.evidence, 20], ["Route", factors.route, 15], ["Momentum", factors.momentum, 15]];
  return <div className="target-factor-bar" aria-label={rows.map(([name, value, maximum]) => `${name} ${value} of ${maximum}`).join(", ")}>{rows.map(([name, value, maximum]) => <i key={name} title={`${name}: ${value}/${maximum}`} style={{ width: `${(value / maximum) * 20}%` }} data-factor={name.toLowerCase()} />)}</div>;
}

export default function CaptureTargeting({ records, asOf, selectedId, onSelect, onFilter }) {
  const signals = buildTargetSignals(records, asOf);
  const ranked = signals.slice(0, 12);
  const active = signals.find((signal) => signal.opportunityId === selectedId) || ranked[0] || null;
  const adjacencies = buildAdjacencies(active, signals);
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

      <TargetBrief signal={active} adjacencies={adjacencies} onSelect={selectRecord} />

      <TargetWorkboard signals={signals} active={active} asOf={asOf} onSelect={selectRecord} />

      <div className="capture-targeting__visuals">
        <section><header><div><strong>Target map</strong><small>Score versus next published decision</small></div></header><TargetMap signals={signals} onSelect={selectRecord} /></section>
        <section><header><div><strong>Portfolio allocation</strong><small>Area = reported potential or high value</small></div></header><AllocationTreemap signals={signals} onFilter={onFilter} /></section>
        <section className="capture-targeting__route"><header><div><strong>Buyer and access routes</strong><small>Top targets through published office and vehicle/parent relationships</small></div></header><RouteMap signals={signals} onSelect={selectRecord} /></section>
        <section><header><div><strong>Buyer × portfolio coverage</strong><small>Combined attention by published office and editorial portfolio; empty is not proven whitespace</small></div></header><BuyerPortfolioMatrix signals={signals} onFilter={onFilter} /></section>
        <section><header><div><strong>Incumbent concentration</strong><small>Reported value concentration and average attention</small></div></header><IncumbentPack signals={signals} onFilter={onFilter} /></section>
        <section className="capture-targeting__route"><header><div><strong>Target adjacencies</strong><small>Exact parent, published vehicle/buyer, and contextual portfolio links</small></div></header><AdjacencyMap active={active} signals={signals} onSelect={selectRecord} /></section>
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
