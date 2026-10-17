import { useEffect, useMemo, useRef, useState } from "react";
import { forceCollide, forceSimulation, forceX, forceY, max, scaleLinear, scaleSqrt } from "d3";
import { ExternalLink, FileSpreadsheet, LocateFixed } from "lucide-react";
import { ControlPageBody } from "control-surface-ui/react";
import ControlSelect from "./ControlSelect.jsx";
import ControlWorkbenchHeader from "./WorkbenchHeader.jsx";
import { useManagementState } from "./management-state.js";
import { TECHNOLOGY_AREA_BY_ID } from "./procurement-taxonomy.js";
import { samNoticeTypeLabel } from "./sam-notice-types.js";

const DAY = 86_400_000;
const STAGE_COLORS = Object.freeze({
  award: "#167247",
  solicitation: "#0067a3",
  shaping: "#7a4ca5",
  forecast: "#d97706",
  other: "#60798b",
});

function idOf(record) {
  return record.opportunityId || record.id || record.reference || record.sourceRecordId || "";
}

function valueOf(record) {
  return Math.max(0, ...[
    record.potentialAmount,
    record.valueHigh,
    record.obligatedAmount,
    record.fpdsObligatedAmount,
    record.liveAward?.awardAmountDollars,
  ].map((value) => Number(value || 0)));
}

function money(value) {
  const amount = Number(value || 0);
  if (!amount) return "Not published";
  if (amount >= 1_000_000_000) return `$${(amount / 1_000_000_000).toFixed(amount >= 10_000_000_000 ? 1 : 2)}B`;
  if (amount >= 1_000_000) return `$${(amount / 1_000_000).toFixed(amount >= 10_000_000 ? 1 : 2)}M`;
  return `$${Math.round(amount / 1_000).toLocaleString()}K`;
}

function readableDate(value) {
  if (!value) return "Not published";
  const parsed = new Date(`${String(value).slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) ? "Not published" : parsed.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

function customerOf(record) {
  return [record.organization?.office, record.organization?.component, record.organization?.branch, record.party, record.recipient]
    .find((value) => value && !/not published/i.test(value)) || "Customer not published";
}

function officeOf(record) {
  const value = record.organization?.office;
  return value && !/not published/i.test(value) ? value : "";
}

function stageOf(record) {
  const label = [samNoticeTypeLabel(record.noticeType), record.lifecycleStage, record.mode].filter(Boolean).join(" ").toLowerCase();
  if (label.includes("award")) return "award";
  if (label.includes("solicitation") || label.includes("combined")) return "solicitation";
  if (label.includes("source") || label.includes("rfi") || label.includes("presolicitation")) return "shaping";
  if (label.includes("forecast")) return "forecast";
  return "other";
}

function urgencyOf(record, now) {
  const deadline = record.solicitationEnd || record.responseDeadline;
  if (!deadline) return 12;
  const parsed = Date.parse(`${String(deadline).slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(parsed)) return 12;
  const days = Math.ceil((parsed - now) / DAY);
  if (days <= 0) return 100;
  if (days <= 14) return 92;
  if (days <= 30) return 80;
  if (days <= 60) return 68;
  if (days <= 90) return 55;
  if (days <= 180) return 38;
  return 22;
}

function trustLabel(record) {
  return String(record.evidenceTier || "unclassified").replaceAll("-", " ");
}

function titleOf(record, length = 52) {
  const title = String(record.title || idOf(record) || "Untitled opportunity");
  return title.length > length ? `${title.slice(0, length - 1)}…` : title;
}

function hashOffset(value, magnitude) {
  const hash = [...String(value)].reduce((total, character) => ((total * 31) + character.charCodeAt(0)) >>> 0, 7);
  return ((hash % 101) / 100 - 0.5) * magnitude;
}

function PortfolioMap({ records, selectedId, watchedIds, onSelect, snapshotTime }) {
  const scrollRef = useRef(null);
  const width = 960;
  const height = 430;
  const x = useMemo(() => scaleLinear().domain([0, 100]).range([78, 916]).clamp(true), []);
  const y = useMemo(() => scaleLinear().domain([0, 100]).range([358, 34]).clamp(true), []);
  const largest = useMemo(() => max(records, valueOf) || 1, [records]);
  const radius = useMemo(() => scaleSqrt().domain([0, largest]).range([7, 31]), [largest]);
  const plotted = useMemo(() => {
    const nodes = [...records]
      .sort((left, right) => Number(watchedIds.has(idOf(right))) - Number(watchedIds.has(idOf(left))) || Number(right.fitAssessment?.score || 0) - Number(left.fitAssessment?.score || 0) || valueOf(right) - valueOf(left))
      .slice(0, 90)
      .map((record) => {
        const id = idOf(record);
        const fit = Number(record.fitAssessment?.score || 0);
        const urgency = urgencyOf(record, snapshotTime);
        const r = radius(valueOf(record));
        const targetX = x(fit) + hashOffset(id, 10);
        const targetY = y(urgency) + hashOffset(`${id}:y`, 8);
        return { record, id, fit, urgency, r, targetX, targetY, x: targetX, y: targetY };
      });
    const simulation = forceSimulation(nodes)
      .alpha(1)
      .alphaDecay(0.045)
      .velocityDecay(0.38)
      .force("x", forceX((node) => node.targetX).strength(0.62))
      .force("y", forceY((node) => node.targetY).strength(0.62))
      .force("collision", forceCollide((node) => Math.max(node.r, 22) + 2).iterations(3))
      .stop();
    for (let index = 0; index < 120; index += 1) simulation.tick();
    for (const node of nodes) {
      node.x = Math.max(78 + node.r, Math.min(916 - node.r, node.x));
      node.y = Math.max(34 + node.r, Math.min(358 - node.r, node.y));
    }
    return nodes;
  }, [radius, records, snapshotTime, watchedIds, x, y]);
  useEffect(() => {
    const viewport = scrollRef.current;
    if (!viewport || window.innerWidth > 760 || viewport.scrollWidth <= viewport.clientWidth) return;
    viewport.scrollLeft = Math.round((viewport.scrollWidth - viewport.clientWidth) * 0.58);
  }, [plotted]);

  return <div ref={scrollRef} className="target-d3-scroll" data-opportunity-portfolio-map>
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-labelledby="portfolio-map-title portfolio-map-desc">
      <title id="portfolio-map-title">Opportunity portfolio priority map</title>
      <desc id="portfolio-map-desc">Fit score on the horizontal axis, response urgency on the vertical axis, bubble area by reported value, color by acquisition stage, and a green ring for tracked work.</desc>
      {[0, 25, 50, 75, 100].map((tick) => <g key={`y-${tick}`}><line x1="78" x2="916" y1={y(tick)} y2={y(tick)} className="target-gridline" /><text x="68" y={y(tick) + 4} textAnchor="end" className="target-axis-label">{tick}</text></g>)}
      {[0, 25, 50, 75, 100].map((tick) => <g key={`x-${tick}`}><line y1="34" y2="358" x1={x(tick)} x2={x(tick)} className="target-gridline" /><text x={x(tick)} y="381" textAnchor="middle" className="target-axis-label">{tick}</text></g>)}
      <text x="497" y="414" textAnchor="middle" className="target-axis-title">Explainable fit score</text>
      <text transform="translate(20 196) rotate(-90)" textAnchor="middle" className="target-axis-title">Decision urgency</text>
      {plotted.map((node, index) => {
        const { record, id, fit, urgency, r } = node;
        const tracked = watchedIds.has(id);
        const selected = id === selectedId;
        const cx = node.x;
        const cy = node.y;
        const stage = stageOf(record);
        return <g key={id || index} className="target-bubble" role="button" tabIndex="0" aria-label={`${record.title || id}, fit ${fit}, urgency ${urgency}, ${money(valueOf(record))}${tracked ? ", tracked" : ""}`} onClick={() => onSelect(id)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSelect(id); } }}>
          <circle className="target-bubble__hit" cx={cx} cy={cy} r={Math.max(r, 22)} />
          <circle className="target-bubble__mark" cx={cx} cy={cy} r={r} fill={STAGE_COLORS[stage]} fillOpacity={selected ? 0.95 : 0.72} style={{ stroke: selected ? "#061f33" : tracked ? "#167247" : "#fff", strokeWidth: selected ? 5 : tracked ? 4 : 2 }}>
            <title>{`${record.title || id}\nFit ${fit} · urgency ${urgency}\nReported value ${money(valueOf(record))}\n${customerOf(record)} · ${trustLabel(record)}`}</title>
          </circle>
          {(selected || tracked || index < 7) ? <text x={cx} y={cy + 3} textAnchor="middle">{fit}</text> : null}
        </g>;
      })}
    </svg>
    <div className="target-chart-legend">
      {Object.entries(STAGE_COLORS).map(([stage, color]) => <span key={stage}><i style={{ background: color }} />{stage}</span>)}
      <span><i style={{ background: "#fff", border: "2px solid #167247" }} />tracked</span>
      <small>Bubble area = reported value · absence is shown as a small bubble</small>
    </div>
  </div>;
}

function BuyerCapabilityHeatmap({ records, metric, onScope }) {
  const officeTotals = new Map();
  const capabilityTotals = new Map();
  const cells = new Map();
  for (const record of records) {
    const office = officeOf(record);
    if (!office) continue;
    const capabilities = [...new Set(record.technologyAreas || [])];
    if (!capabilities.length) continue;
    officeTotals.set(office, (officeTotals.get(office) || 0) + 1);
    for (const capability of capabilities) {
      capabilityTotals.set(capability, (capabilityTotals.get(capability) || 0) + 1);
      const key = `${office}|${capability}`;
      const cell = cells.get(key) || { count: 0, value: 0, fit: 0 };
      cell.count += 1;
      cell.value = Math.max(cell.value, valueOf(record));
      cell.fit += Number(record.fitAssessment?.score || 0);
      cells.set(key, cell);
    }
  }
  const offices = [...officeTotals].sort((left, right) => right[1] - left[1]).slice(0, 8).map(([name]) => name);
  const capabilities = [...capabilityTotals].sort((left, right) => right[1] - left[1]).slice(0, 6).map(([id]) => id);
  const scoreOf = (cell) => metric === "value" ? cell.value : metric === "fit" ? cell.fit / Math.max(cell.count, 1) : cell.count;
  const maximum = max([...cells.values()], scoreOf) || 1;
  const width = 960;
  const left = 236;
  const top = 96;
  const cellWidth = (width - left - 18) / Math.max(capabilities.length, 1);
  const cellHeight = 46;
  const height = top + offices.length * cellHeight + 26;
  return <div className="target-d3-scroll" data-buyer-capability-heatmap>
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-labelledby="buyer-capability-title buyer-capability-desc">
      <title id="buyer-capability-title">Buyer and capability opportunity heatmap</title>
      <desc id="buyer-capability-desc">Top published buying offices by classified technology area. Color intensity represents the selected measure. Empty cells mean no matching retained records, not proven market whitespace.</desc>
      {capabilities.map((capability, index) => <text key={capability} className="target-matrix__column" transform={`translate(${left + index * cellWidth + cellWidth / 2} ${top - 12}) rotate(-34)`} textAnchor="start">{TECHNOLOGY_AREA_BY_ID.get(capability)?.label || capability}</text>)}
      {offices.map((office, rowIndex) => <g key={office}>
        <text className="target-matrix__row" x={left - 10} y={top + rowIndex * cellHeight + cellHeight / 2 + 4} textAnchor="end">{titleOf({ title: office }, 36)}</text>
        {capabilities.map((capability, columnIndex) => {
          const cell = cells.get(`${office}|${capability}`);
          const x = left + columnIndex * cellWidth;
          const y = top + rowIndex * cellHeight;
          if (!cell) return <rect key={capability} x={x + 2} y={y + 2} width={cellWidth - 4} height={cellHeight - 4} className="target-matrix__empty" />;
          const score = scoreOf(cell);
          const opacity = 0.18 + (score / maximum) * 0.82;
          const primary = metric === "value" ? money(cell.value) : metric === "fit" ? Math.round(cell.fit / cell.count) : cell.count;
          const secondary = metric === "value" ? `${cell.count} records` : metric === "fit" ? `${cell.count} records` : `max ${money(cell.value)}`;
          return <g key={capability} className="target-matrix__cell" role="button" tabIndex="0" aria-label={`${office}, ${TECHNOLOGY_AREA_BY_ID.get(capability)?.label || capability}, ${cell.count} records, largest reported value ${money(cell.value)}`} onClick={() => onScope(office, capability)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onScope(office, capability); } }}>
            <rect x={x + 2} y={y + 2} width={cellWidth - 4} height={cellHeight - 4} style={{ opacity }} />
            <text x={x + cellWidth / 2} y={y + 21} textAnchor="middle">{primary}</text>
            <text x={x + cellWidth / 2} y={y + 34} textAnchor="middle" className="target-matrix__score">{secondary}</text>
            <title>{`${office}\n${TECHNOLOGY_AREA_BY_ID.get(capability)?.label || capability}\n${cell.count} records · largest reported value ${money(cell.value)}\nAverage fit ${Math.round(cell.fit / cell.count)}`}</title>
          </g>;
        })}
      </g>)}
    </svg>
  </div>;
}

function OpportunityInspector({ record, tracked }) {
  if (!record) return <div className="if-alert if-alert--info" role="status"><LocateFixed size={17} /><span><strong>Select an opportunity</strong>Choose a bubble to pin its evidence and open the exact operating record.</span></div>;
  const id = idOf(record);
  return <section className="target-brief" data-portfolio-inspector>
    <header>
      <div><span>{tracked ? "Tracked pursuit" : "Portfolio opportunity"}</span><h3>{record.title || id}</h3><p>{customerOf(record)} · {id} · {trustLabel(record)}</p></div>
      <div className={`target-brief__score target-brief__score--${record.fitAssessment.level === "strong" ? "pursue" : "verify"}`}><b>{record.fitAssessment.score}</b><span>fit</span></div>
    </header>
    <div className="target-brief__facts">
      <article><span>Reported value</span><strong>{money(valueOf(record))}</strong><p>Not inferred when absent.</p></article>
      <article><span>Response due</span><strong>{readableDate(record.solicitationEnd || record.responseDeadline)}</strong><p>Published source date.</p></article>
      <article><span>Stage</span><strong>{samNoticeTypeLabel(record.noticeType)}</strong><p>{tracked ? "Already in My Work." : "Not currently tracked."}</p></article>
      <article><span>Evidence</span><strong>{trustLabel(record)}</strong><p>{record.sourceRoleCount ? `${record.sourceRoleCount} retained source roles.` : "Source-backed record."}</p></article>
    </div>
    <div className="target-workboard__actions" style={{ padding: "10px 12px" }}>
      <a className="if-btn if-btn--primary" href={`#/budget-spend/explorer?spendView=record&capRecord=${encodeURIComponent(id)}`}><LocateFixed size={15} />Open workspace</a>
      <a className="if-btn if-btn--secondary" href={`#/budget-spend/explorer?spendView=table&capRecord=${encodeURIComponent(id)}`}><FileSpreadsheet size={15} />Show in queue</a>
      {record.sourceUrl ? <a className="if-btn if-btn--secondary" href={record.sourceUrl} target="_blank" rel="noreferrer"><ExternalLink size={15} />Source</a> : null}
    </div>
  </section>;
}

export default function OpportunityPortfolioVisuals({ records, selectedId, tabs, onSelect, onScope, asOf }) {
  const management = useManagementState(records);
  const [heatMetric, setHeatMetric] = useState("count");
  const selected = useMemo(() => records.find((record) => idOf(record) === selectedId) || null, [records, selectedId]);
  const snapshotTime = Date.parse(String(asOf || "1970-01-01"));
  useEffect(() => {
    if (!selectedId) return undefined;
    const clearSelection = (event) => { if (event.key === "Escape") onSelect(""); };
    window.addEventListener("keydown", clearSelection);
    return () => window.removeEventListener("keydown", clearSelection);
  }, [onSelect, selectedId]);
  const strong = records.filter((record) => Number(record.fitAssessment?.score || 0) >= 70);
  const nearTerm = records.filter((record) => urgencyOf(record, snapshotTime) >= 68);
  const tracked = records.filter((record) => management.watchedIds.has(idOf(record)));
  const valued = records.filter((record) => valueOf(record) > 0);
  const metrics = [
    { id: "scope", label: "Current scope", value: records.length.toLocaleString(), meta: "Active workbench filters" },
    { id: "strong", label: "Strong fit", value: strong.length.toLocaleString(), meta: "Explainable 70+ score" },
    { id: "urgent", label: "Due in 60 days", value: nearTerm.length.toLocaleString(), meta: "Published response dates" },
    { id: "value", label: "Valued records", value: valued.length.toLocaleString(), meta: "Published value; no aggregate" },
  ];
  return <section className="spend-explorer spend-explorer--visuals" data-spend-explorer="visuals">
    <ControlWorkbenchHeader eyebrow="Decision visualization" title="Opportunity Portfolio" summary="Prioritize opportunities and inspect where buyer demand intersects Sabre-aligned capabilities." metrics={metrics} metricLabel="Opportunity portfolio summary" tabs={tabs} />
    <ControlPageBody compact>
      <section className="capture-targeting" data-opportunity-portfolio-visuals>
        <div className="capture-targeting__heading">
          <div><span>Portfolio decision surface</span><h2>Where to focus pursuit effort</h2><p>Fit, timing, reported value, customer demand, and evidence remain separate signals. These views direct analyst attention; they do not estimate probability of win or invent market whitespace.</p></div>
          <div className="capture-targeting__lanes"><span><b>{tracked.length}</b>Tracked</span><span><b>{strong.length}</b>Strong fit</span><span><b>{nearTerm.length}</b>Due soon</span><span><b>{records.filter((record) => valueOf(record) > 0).length}</b>Valued</span></div>
        </div>
        <div className="capture-targeting__interpretations" aria-label="Portfolio interpretation">
          <article><span>Priority quadrant</span><strong>{records.filter((record) => Number(record.fitAssessment?.score || 0) >= 70 && urgencyOf(record, snapshotTime) >= 68).length}</strong><p>Strong-fit records with a published deadline inside 60 days.</p></article>
          <article><span>Tracked coverage</span><strong>{records.length ? `${Math.round((tracked.length / records.length) * 100)}%` : "0%"}</strong><p>Current filtered opportunities already represented in My Work.</p></article>
          <article><span>Buyer-capability cells</span><strong>{new Set(records.flatMap((record) => (record.technologyAreas || []).map((area) => `${officeOf(record)}|${area}`)).filter((value) => !value.startsWith("|"))).size}</strong><p>Observed combinations in retained records; blanks are not proof of absence.</p></article>
        </div>
        <OpportunityInspector record={selected} tracked={Boolean(selected && management.watchedIds.has(idOf(selected)))} />
        <div className="capture-targeting__visuals">
          <section className="capture-targeting__route"><header><div><strong>Opportunity priority map</strong><small>Fit × decision urgency · bubble area = reported value · green ring = tracked</small></div></header><PortfolioMap records={records} selectedId={selectedId} watchedIds={management.watchedIds} onSelect={onSelect} snapshotTime={snapshotTime} /></section>
          <section className="capture-targeting__route"><header><div><strong>Buyer × capability heatmap</strong><small>Observed retained opportunities; click a populated cell to filter the operating queue</small></div><ControlSelect compact ariaLabel="Heatmap measure" value={heatMetric} options={[{ value: "count", label: "Opportunity count" }, { value: "value", label: "Largest reported value" }, { value: "fit", label: "Average fit" }]} onChange={setHeatMetric} /></header><BuyerCapabilityHeatmap records={records} metric={heatMetric} onScope={onScope} /></section>
        </div>
        <details className="capture-targeting__method"><summary>How to read these views</summary><p>The portfolio map uses the explainable public capability fit score, published response timing, and reported value. The heatmap uses published buying-office hierarchy and classified technology areas. Missing values remain missing. Empty cells mean no matching retained record in the active scope, not zero demand. Selecting a heatmap cell applies exact workbench filters so the table remains the canonical operating queue.</p></details>
      </section>
    </ControlPageBody>
  </section>;
}
