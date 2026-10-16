import { useId, useMemo, useState } from "react";
import { sankey as createSankey, sankeyLinkHorizontal } from "d3-sankey";
import ControlSelect from "./ControlSelect.jsx";

const CANVAS_WIDTH = 1120;
const LANE_LABELS = ["Program", "Budget line", "Appropriation", "Vehicle", "Award", "Prime", "Supplier sample"];
const TYPE_COLORS = {
  program: "#315f82",
  "budget-line": "#4d7fa3",
  account: "#12828b",
  vehicle: "#76589a",
  award: "#a9682d",
  prime: "#3e7b59",
  supplier: "#a64639",
  request: "#4d7fa3",
  obligation: "#12828b",
  structure: "#76589a",
  subaward: "#a64639",
};
const FLOW_LABELS = {
  request: "Budget request",
  obligation: "Exact obligation",
  structure: "Contract structure",
  prime: "Published award value",
  subaward: "Retained supplier sample",
};
const CLASS_BUDGET = { request: 28, obligation: 20, structure: 3, prime: 20, subaward: 20 };

function money(value) {
  const amount = Number(value || 0);
  const absolute = Math.abs(amount);
  const sign = amount < 0 ? "−" : "";
  if (absolute >= 1_000_000_000) return `${sign}$${(absolute / 1_000_000_000).toFixed(1)}B`;
  if (absolute >= 1_000_000) return `${sign}$${(absolute / 1_000_000).toFixed(1)}M`;
  if (absolute >= 1_000) return `${sign}$${Math.round(absolute / 1_000).toLocaleString()}K`;
  return `${sign}$${Math.round(absolute).toLocaleString()}`;
}

function short(value, length = 27) {
  const text = String(value || "Not published");
  return text.length > length ? `${text.slice(0, length - 1)}…` : text;
}

function labelLines(value, length = 29) {
  const text = String(value || "Not published").trim();
  if (text.length <= length) return [text];
  const words = text.split(/\s+/);
  const lines = [""];
  for (const word of words) {
    const current = lines.at(-1);
    if (!current || `${current} ${word}`.length <= length) lines[lines.length - 1] = current ? `${current} ${word}` : word;
    else if (lines.length === 1) lines.push(word);
    else { lines[1] = short(`${lines[1]} ${word}`, length); break; }
  }
  return lines.slice(0, 2);
}

function amountFor(node, fiscalYear) {
  if (node?.fiscalValues) return Number(node.fiscalValues[`fy${fiscalYear}`] || 0) * 1_000_000_000;
  return Math.abs(Number(node?.magnitude ?? node?.amount ?? 0));
}

function linkAmount(link, nodes, fiscalYear) {
  if (link.type === "request") return amountFor(nodes.get(link.source), fiscalYear);
  return Math.abs(Number(link.amount || 0));
}

function activate(event, callback) {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    callback();
  }
}

function buildDiagram(path, fiscalYear) {
  const sourceNodes = new Map(path.nodes.map((node) => [node.id, node]));
  const candidates = path.links.map((link) => ({ ...link, displayAmount: linkAmount(link, sourceNodes, fiscalYear) }))
    .filter((link) => sourceNodes.has(link.source) && sourceNodes.has(link.target) && (link.type === "structure" || link.displayAmount > 0));
  const rawTotals = new Map();
  for (const link of candidates) {
    const raw = link.type === "structure" ? 1 : Math.sqrt(Math.max(link.displayAmount, 1));
    link.rawWeight = raw;
    rawTotals.set(link.type, (rawTotals.get(link.type) || 0) + raw);
  }
  const links = candidates.map((link) => ({
    ...link,
    value: (CLASS_BUDGET[link.type] || 16) * link.rawWeight / Math.max(rawTotals.get(link.type) || 1, 1),
  }));
  const linkedIds = new Set(links.flatMap((link) => [link.source, link.target]));
  const nodes = path.nodes.filter((node) => linkedIds.has(node.id)).map((node) => ({
    ...node,
    displayAmount: amountFor(node, fiscalYear),
  }));
  const maximumLaneSize = Math.max(...LANE_LABELS.map((_, lane) => nodes.filter((node) => node.lane === lane).length), 1);
  const height = Math.max(500, Math.min(680, 176 + maximumLaneSize * 76));
  const sankey = createSankey()
    .nodeId((node) => node.id)
    .nodeWidth(12)
    .nodePadding(34)
    .iterations(48)
    .extent([[30, 76], [CANVAS_WIDTH - 30, height - 36]]);
  const graph = sankey({ nodes, links });
  const laneStep = (CANVAS_WIDTH - 72) / (LANE_LABELS.length - 1);
  for (const node of graph.nodes) {
    node.x0 = 30 + node.lane * laneStep;
    node.x1 = node.x0 + 12;
  }
  sankey.update(graph);
  return { ...graph, height };
}

function inspectorItem(item, fiscalYear) {
  if (!item) return null;
  if (item.source?.id && item.target?.id) return {
    ...item,
    type: `${item.type}-flow`,
    label: item.label,
    amount: item.amount ?? item.displayAmount,
    detail: item.detail || `${item.confidence} ${String(item.amountType || "published measure").replaceAll("-", " ")}`,
  };
  return {
    ...item,
    detail: item.detail || `${LANE_LABELS[item.lane]} · ${item.confidence || item.status || "published"}`,
    amount: item.type === "supplier" ? item.amount : amountFor(item, fiscalYear),
  };
}

function relatedTo(activeId, item, links) {
  if (!activeId) return true;
  if (item.id === activeId) return true;
  if (item.source?.id && item.target?.id) return item.source.id === activeId || item.target.id === activeId;
  return links.some((link) => link.id === activeId && (link.source.id === item.id || link.target.id === item.id))
    || links.some((link) => (link.source.id === activeId || link.target.id === activeId) && (link.source.id === item.id || link.target.id === item.id));
}

function LegendItem({ type, dashed = false }) {
  return <span style={{ display: "inline-flex", alignItems: "center", gap: "0.35rem", whiteSpace: "nowrap" }}>
    <span aria-hidden="true" style={{ width: "1.75rem", height: 0, borderTop: `${dashed ? "2px dashed" : "4px solid"} ${TYPE_COLORS[type]}`, borderRadius: "999px" }} />
    {FLOW_LABELS[type]}
  </span>;
}

export default function MoneyPath({ path, selected, onSelect }) {
  const [fiscalYear, setFiscalYear] = useState(2027);
  const [hoveredId, setHoveredId] = useState("");
  const gradientSeed = useId().replaceAll(":", "");
  const diagram = useMemo(() => buildDiagram(path, fiscalYear), [fiscalYear, path]);
  const summary = useMemo(() => {
    const nodeMap = new Map(path.nodes.map((node) => [node.id, node]));
    return {
      request: path.links.filter((link) => link.type === "request" && link.target.startsWith("account:")).reduce((sum, link) => sum + linkAmount(link, nodeMap, fiscalYear), 0),
      obligations: path.links.filter((link) => link.type === "obligation").reduce((sum, link) => sum + Number(link.amount || 0), 0),
      suppliers: path.nodes.filter((node) => node.type === "supplier").length,
      exact: path.links.filter((link) => link.confidence === "exact").length,
      derived: path.links.filter((link) => link.confidence === "derived").length,
    };
  }, [fiscalYear, path]);
  const activeId = hoveredId || selected?.id || "";
  const linkPath = sankeyLinkHorizontal();

  return <div style={{ minWidth: 0, maxWidth: "100%", width: "100%", overflow: "hidden" }} data-money-path data-money-path-engine="d3-sankey" data-money-path-year={fiscalYear} data-money-path-nodes={diagram.nodes.length} data-money-path-links={diagram.links.length}>
    <div className="if-panel__body" style={{ display: "flex", alignItems: "end", justifyContent: "space-between", gap: "0.8rem", flexWrap: "wrap", paddingBlock: "0.65rem", background: "linear-gradient(90deg, rgba(18,130,139,0.06), transparent 52%)" }}>
      <div style={{ display: "grid", gap: "0.45rem" }}>
        <div style={{ display: "flex", gap: "0.45rem", flexWrap: "wrap" }} aria-label="Money Path summary">
          <span className="if-status if-status--sm"><strong>FY{fiscalYear}</strong>&nbsp; request {money(summary.request)}</span>
          <span className="if-status if-status--sm"><strong>Obligations</strong>&nbsp; {money(summary.obligations)}</span>
          <span className="if-status if-status--sm"><strong>{summary.suppliers}</strong>&nbsp; retained supplier{summary.suppliers === 1 ? "" : "s"}</span>
        </div>
        <span style={{ color: "var(--if-text-muted, #5f6873)", fontSize: "0.75rem" }}>{summary.exact} exact relationships · {summary.derived} derived context link{summary.derived === 1 ? "" : "s"}</span>
      </div>
      <div className="if-field" style={{ minWidth: "9rem" }}><span className="if-field__label">Budget request year</span><ControlSelect ariaLabel="Budget request year" value={String(fiscalYear)} options={path.fiscalYears.map((year) => [String(year), `FY${year}`])} triggerProps={{ style: { minHeight: "2.75rem" } }} onChange={(value) => setFiscalYear(Number(value))} /></div>
    </div>
    <div className="connected-visual__scroller" style={{ minWidth: 0, maxWidth: "100%", width: "100%", position: "relative", background: "var(--if-surface-subtle, #f7f8fa)", boxShadow: "inset -18px 0 18px -22px rgba(17, 24, 39, 0.6)" }} tabIndex="0" aria-label="Scrollable opportunity Money Path">
      <svg viewBox={`0 0 ${CANVAS_WIDTH} ${diagram.height}`} role="img" aria-label="Funding flow from program and budget line through accounts, awards, prime recipients, and retained supplier samples" style={{ display: "block", minWidth: "880px", width: "100%", height: "auto" }} data-money-path-sankey>
        <defs>{diagram.links.map((link) => <linearGradient key={link.id} id={`${gradientSeed}-${link.index}`} gradientUnits="userSpaceOnUse" x1={link.source.x1} x2={link.target.x0}>
          <stop offset="0%" stopColor={TYPE_COLORS[link.source.type] || TYPE_COLORS[link.type]} />
          <stop offset="100%" stopColor={TYPE_COLORS[link.target.type] || TYPE_COLORS[link.type]} />
        </linearGradient>)}</defs>
        <rect width={CANVAS_WIDTH} height={diagram.height} fill="var(--if-surface-subtle, #f7f8fa)" />
        <g aria-hidden="true">{LANE_LABELS.map((label, lane) => {
          const laneNodes = diagram.nodes.filter((node) => node.lane === lane);
          const x = laneNodes[0]?.x0 ?? 30 + lane * ((CANVAS_WIDTH - 60) / 6);
          const anchor = lane === LANE_LABELS.length - 1 ? "end" : "start";
          return <g key={label}><line x1={x} x2={x} y1="60" y2={diagram.height - 20} stroke="var(--if-border, #d7dce2)" strokeDasharray="2 7" /><text x={x} y="28" textAnchor={anchor} fill="var(--if-text-muted, #5f6873)" fontSize="10" fontWeight="800" letterSpacing="0.7">{label.toUpperCase()}</text><text x={x} y="45" textAnchor={anchor} fill="var(--if-text-muted, #5f6873)" fontSize="9">{laneNodes.length} {laneNodes.length === 1 ? "node" : "nodes"}</text></g>;
        })}</g>
        <g>{diagram.links.map((link) => {
          const related = relatedTo(activeId, link, diagram.links);
          const selectedLink = selected?.id === link.id;
          const dash = link.confidence === "derived" || link.type === "structure";
          const inspect = () => onSelect(inspectorItem(link, fiscalYear));
          return <g key={link.id} role="button" tabIndex="0" aria-label={`${FLOW_LABELS[link.type] || link.label}, ${link.type === "structure" ? "structural relationship" : money(link.amount ?? link.displayAmount)}, ${link.confidence} evidence`} onClick={inspect} onKeyDown={(event) => activate(event, inspect)} onMouseEnter={() => setHoveredId(link.id)} onMouseLeave={() => setHoveredId("")} onFocus={() => setHoveredId(link.id)} onBlur={() => setHoveredId("")} data-money-path-link={link.type} data-money-path-link-width={link.width.toFixed(2)} style={{ cursor: "pointer", outline: "none" }}>
            <path d={linkPath(link)} fill="none" stroke="transparent" strokeWidth={Math.max(18, link.width + 10)} />
            <path d={linkPath(link)} fill="none" stroke={`url(#${gradientSeed}-${link.index})`} strokeWidth={Math.max(link.type === "structure" ? 2 : 3, link.width + (selectedLink ? 2 : 0))} strokeOpacity={related ? (selectedLink || hoveredId === link.id ? 0.92 : 0.54) : 0.16} strokeDasharray={dash ? "7 5" : undefined} strokeLinecap="round" style={{ pointerEvents: "none", transition: "stroke-opacity 150ms ease, stroke-width 150ms ease" }} />
            <title>{FLOW_LABELS[link.type] || link.label} · {link.type === "structure" ? "structural relationship" : money(link.amount ?? link.displayAmount)} · {link.confidence}</title>
          </g>;
        })}</g>
        <g>{diagram.nodes.map((node) => {
          const related = relatedTo(activeId, node, diagram.links);
          const selectedNode = selected?.id === node.id;
          const rightSide = node.lane >= 4;
          const lines = labelLines(node.label);
          const textX = rightSide ? node.x0 - 9 : node.x1 + 9;
          const anchor = rightSide ? "end" : "start";
          const inspect = () => onSelect(inspectorItem(node, fiscalYear));
          return <g key={node.id} role="button" tabIndex="0" aria-label={`${node.label}, ${LANE_LABELS[node.lane]}${node.displayAmount ? `, ${money(node.type === "supplier" ? node.amount : node.displayAmount)}` : ""}`} aria-pressed={selectedNode} onClick={inspect} onKeyDown={(event) => activate(event, inspect)} onMouseEnter={() => setHoveredId(node.id)} onMouseLeave={() => setHoveredId("")} onFocus={() => setHoveredId(node.id)} onBlur={() => setHoveredId("")} data-money-path-node={node.type} style={{ cursor: "pointer", opacity: related ? 1 : 0.45, transition: "opacity 150ms ease", outline: "none" }}>
            <rect x={node.x0} y={node.y0} width={Math.max(12, node.x1 - node.x0)} height={Math.max(12, node.y1 - node.y0)} rx="4" fill={TYPE_COLORS[node.type] || "#5f6873"} stroke={selectedNode ? "#0b1727" : "#ffffff"} strokeWidth={selectedNode ? 3 : 1.5} />
            <circle cx={rightSide ? node.x0 - 4 : node.x1 + 4} cy={node.y0 + 8} r={selectedNode ? 3 : 2} fill={TYPE_COLORS[node.type] || "#5f6873"} />
            <text x={textX} y={node.y0 + 8} textAnchor={anchor} fill="var(--if-text, #111827)" stroke="var(--if-surface-subtle, #f7f8fa)" strokeWidth="3" strokeLinejoin="round" paintOrder="stroke" fontSize="9.5" fontWeight="800">
              <tspan x={textX}>{short(node.code || LANE_LABELS[node.lane], 18)}</tspan>
              {lines.map((line, index) => <tspan key={`${node.id}-${index}`} x={textX} dy={index === 0 ? 14 : 12} fontWeight="650">{line}</tspan>)}
              {node.displayAmount ? <tspan x={textX} dy="13" fill="var(--if-text-muted, #5f6873)" fontWeight="700">{money(node.type === "supplier" ? node.amount : node.displayAmount)}</tspan> : null}
            </text>
          </g>;
        })}</g>
      </svg>
    </div>
    <div className="if-panel__footer" style={{ justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "0.75rem" }} aria-label="Money Path legend">
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem 1rem" }}><LegendItem type="request" /><LegendItem type="obligation" /><LegendItem type="structure" dashed /><LegendItem type="prime" /><LegendItem type="subaward" /></div>
      <span style={{ color: "var(--if-text-muted, #5f6873)" }}>Widths compare within each measure class; classes are never added together. Hover isolates a path; click pins evidence.</span>
    </div>
  </div>;
}
