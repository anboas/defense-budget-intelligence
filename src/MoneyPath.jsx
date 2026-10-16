import { useId, useMemo, useState } from "react";
import { sankey as createSankey, sankeyLinkHorizontal } from "d3-sankey";
import ControlSelect from "./ControlSelect.jsx";

const CANVAS_WIDTH = 1080;
const LANE_LABELS = ["Program", "Budget line", "Appropriation", "Vehicle", "Award", "Prime", "Supplier sample"];
const TYPE_COLORS = { program: "#315f82", "budget-line": "#4d7fa3", account: "#087f8c", vehicle: "#76589a", award: "#b66b2b", prime: "#347252", supplier: "#a64639", request: "#4d7fa3", obligation: "#087f8c", structure: "#76589a", subaward: "#a64639" };
const FLOW_LABELS = { request: "Budget request context", obligation: "Exact obligation", structure: "Contract structure", prime: "Published award value", subaward: "Retained supplier sample" };
const CLASS_BUDGET = { obligation: 30, structure: 3, prime: 24, subaward: 22 };

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

function labelLines(value, length = 25) {
  const words = String(value || "Not published").trim().split(/\s+/);
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
  if (event.key === "Enter" || event.key === " ") { event.preventDefault(); callback(); }
}

function buildDiagram(path, fiscalYear) {
  const sourceNodes = new Map(path.nodes.map((node) => [node.id, node]));
  const candidates = path.links.filter((link) => link.type !== "request")
    .map((link) => ({ ...link, displayAmount: linkAmount(link, sourceNodes, fiscalYear) }))
    .filter((link) => sourceNodes.has(link.source) && sourceNodes.has(link.target) && (link.type === "structure" || link.displayAmount > 0));
  const rawTotals = new Map();
  for (const link of candidates) {
    const raw = link.type === "structure" ? 1 : Math.sqrt(Math.max(link.displayAmount, 1));
    link.rawWeight = raw;
    rawTotals.set(link.type, (rawTotals.get(link.type) || 0) + raw);
  }
  const links = candidates.map((link) => ({ ...link, value: (CLASS_BUDGET[link.type] || 18) * link.rawWeight / Math.max(rawTotals.get(link.type) || 1, 1) }));
  const linkedIds = new Set(links.flatMap((link) => [link.source, link.target]));
  const nodes = path.nodes.filter((node) => linkedIds.has(node.id)).map((node) => ({ ...node, displayAmount: amountFor(node, fiscalYear) }));
  const lanes = [...new Set(nodes.map((node) => node.lane))].sort((a, b) => a - b);
  const maximumLaneSize = Math.max(...lanes.map((lane) => nodes.filter((node) => node.lane === lane).length), 1);
  const height = Math.max(340, Math.min(500, 100 + maximumLaneSize * 58));
  const sankey = createSankey().nodeId((node) => node.id).nodeWidth(10).nodePadding(30).iterations(64).extent([[172, 74], [CANVAS_WIDTH - 172, height - 28]]);
  const graph = sankey({ nodes, links });
  const laneStep = lanes.length > 1 ? (CANVAS_WIDTH - 344) / (lanes.length - 1) : 0;
  for (const node of graph.nodes) {
    node.stage = lanes.indexOf(node.lane);
    node.x0 = 172 + node.stage * laneStep;
    node.x1 = node.x0 + 10;
  }
  sankey.update(graph);
  const verticalScale = 0.3;
  const centers = new Map(graph.nodes.map((node) => [node.id, (node.y0 + node.y1) / 2]));
  for (const node of graph.nodes) {
    const center = centers.get(node.id);
    const halfHeight = (node.y1 - node.y0) * verticalScale / 2;
    node.y0 = center - halfHeight;
    node.y1 = center + halfHeight;
  }
  for (const link of graph.links) {
    const sourceCenter = centers.get(link.source.id);
    const targetCenter = centers.get(link.target.id);
    link.y0 = sourceCenter + (link.y0 - sourceCenter) * verticalScale;
    link.y1 = targetCenter + (link.y1 - targetCenter) * verticalScale;
    link.width *= verticalScale;
  }
  return { ...graph, height, lanes };
}

function budgetContext(path, fiscalYear) {
  const nodeMap = new Map(path.nodes.map((node) => [node.id, node]));
  return path.links.filter((link) => link.type === "request")
    .map((link) => ({ ...link, sourceNode: nodeMap.get(link.source), targetNode: nodeMap.get(link.target), displayAmount: linkAmount(link, nodeMap, fiscalYear) }))
    .filter((link) => link.sourceNode && link.targetNode && link.displayAmount > 0)
    .sort((a, b) => b.displayAmount - a.displayAmount);
}

function inspectorItem(item, fiscalYear) {
  if (!item) return null;
  if (item.source?.id && item.target?.id) return { ...item, type: `${item.type}-flow`, label: item.label, amount: item.amount ?? item.displayAmount, detail: item.detail || `${item.confidence} ${String(item.amountType || "published measure").replaceAll("-", " ")}` };
  return { ...item, detail: item.detail || `${LANE_LABELS[item.lane]} · ${item.confidence || item.status || "published"}`, amount: item.type === "supplier" ? item.amount : amountFor(item, fiscalYear) };
}

function relatedTo(activeId, item, links) {
  if (!activeId || item.id === activeId) return true;
  if (item.source?.id && item.target?.id) return item.source.id === activeId || item.target.id === activeId;
  return links.some((link) => link.id === activeId && (link.source.id === item.id || link.target.id === item.id)) || links.some((link) => (link.source.id === activeId || link.target.id === activeId) && (link.source.id === item.id || link.target.id === item.id));
}

function Metric({ label, value, detail }) {
  return <div style={{ display: "grid", gap: "0.12rem", minWidth: 0, padding: "0.65rem 0.75rem", border: "1px solid var(--if-border, #d7dce2)", borderRadius: "0.4rem", background: "var(--if-bg-surface, #fff)" }}><span style={{ color: "var(--if-text-muted, #5f6873)", fontSize: "0.64rem", fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase" }}>{label}</span><strong style={{ fontSize: "1rem", lineHeight: 1.2 }}>{value}</strong>{detail ? <span style={{ color: "var(--if-text-muted, #5f6873)", fontSize: "0.68rem" }}>{detail}</span> : null}</div>;
}

function LegendItem({ type, dashed = false }) {
  return <span style={{ display: "inline-flex", alignItems: "center", gap: "0.35rem", whiteSpace: "nowrap" }}><span aria-hidden="true" style={{ width: "1.5rem", height: 0, borderTop: `${dashed ? "2px dashed" : "4px solid"} ${TYPE_COLORS[type]}`, borderRadius: "999px" }} />{FLOW_LABELS[type]}</span>;
}

export default function MoneyPath({ path, selected, onSelect }) {
  const [fiscalYear, setFiscalYear] = useState(2027);
  const [hoveredId, setHoveredId] = useState("");
  const gradientSeed = useId().replaceAll(":", "");
  const diagram = useMemo(() => buildDiagram(path, fiscalYear), [fiscalYear, path]);
  const context = useMemo(() => budgetContext(path, fiscalYear), [fiscalYear, path]);
  const summary = useMemo(() => {
    const nodeMap = new Map(path.nodes.map((node) => [node.id, node]));
    const award = path.nodes.find((node) => node.type === "award");
    const obligationLinks = path.links.filter((link) => link.type === "obligation");
    return { request: path.links.filter((link) => link.type === "request" && link.target.startsWith("account:")).reduce((sum, link) => sum + linkAmount(link, nodeMap, fiscalYear), 0), obligations: obligationLinks.reduce((sum, link) => sum + Number(link.amount || 0), 0), obligationCount: obligationLinks.length, award: Number(award?.amount || 0), suppliers: path.nodes.filter((node) => node.type === "supplier").length, exact: path.links.filter((link) => link.confidence === "exact").length, derived: path.links.filter((link) => link.confidence === "derived").length };
  }, [fiscalYear, path]);
  const activeId = hoveredId || selected?.id || "";
  const linkPath = sankeyLinkHorizontal();
  const renderedLinks = [...diagram.links].sort((a, b) => b.source.stage - a.source.stage || b.width - a.width);

  return <div style={{ minWidth: 0, maxWidth: "100%", width: "100%", overflow: "hidden", background: "var(--if-bg-surface, #fff)" }} data-money-path data-money-path-engine="d3-sankey" data-money-path-year={fiscalYear} data-money-path-nodes={diagram.nodes.length} data-money-path-links={diagram.links.length}>
    <style>{"[data-money-path-node] text{pointer-events:none}"}</style>
    <div className="if-panel__body" style={{ display: "grid", gap: "0.7rem", paddingBlock: "0.75rem", borderBottom: "1px solid var(--if-border, #d7dce2)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "end", gap: "0.8rem", flexWrap: "wrap" }}><div><strong style={{ display: "block", fontSize: "0.9rem" }}>Money story</strong><span style={{ color: "var(--if-text-muted, #5f6873)" }}>Observed obligations and award lineage, with budget requests kept as separate context.</span></div><div className="if-field" style={{ minWidth: "9rem" }}><span className="if-field__label">Budget request year</span><ControlSelect ariaLabel="Budget request year" value={String(fiscalYear)} options={path.fiscalYears.map((year) => [String(year), `FY${year}`])} triggerProps={{ style: { minHeight: "2.75rem" } }} onChange={(value) => setFiscalYear(Number(value))} /></div></div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(10.5rem, 1fr))", gap: "0.5rem" }} aria-label="Money Path summary"><Metric label={`FY${fiscalYear} request context`} value={money(summary.request)} detail={`${summary.derived} derived link${summary.derived === 1 ? "" : "s"}`} /><Metric label="Exact obligations" value={money(summary.obligations)} detail={`${summary.obligationCount} account flow${summary.obligationCount === 1 ? "" : "s"}`} /><Metric label="Published award" value={money(summary.award)} detail="not added to obligations" /><Metric label="Supplier coverage" value={`${summary.suppliers} retained`} detail="partial sample" /></div>
    </div>

    {context.length ? <section style={{ display: "grid", gap: "0.5rem", padding: "0.65rem 0.75rem", borderBottom: "1px solid var(--if-border, #d7dce2)", background: "var(--if-bg-subtle, #f7f8fa)" }} data-money-path-context><div style={{ display: "flex", justifyContent: "space-between", gap: "0.75rem", flexWrap: "wrap" }}><strong>Budget request context</strong><span style={{ color: "var(--if-text-muted, #5f6873)" }}>Derived title matches · never summed with observed obligations</span></div><div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(13rem, 1fr))", gap: "0.4rem" }}>{context.slice(0, 4).map((link) => <button key={link.id} type="button" onClick={() => onSelect(inspectorItem({ ...link, source: link.sourceNode, target: link.targetNode }, fiscalYear))} style={{ display: "grid", gap: "0.2rem", minHeight: "3.5rem", padding: "0.5rem 0.6rem", border: "1px solid var(--if-border, #d7dce2)", borderRadius: "0.35rem", background: "var(--if-bg-surface, #fff)", color: "inherit", textAlign: "left" }}><span style={{ color: "var(--if-text-muted, #5f6873)", fontSize: "0.68rem", fontWeight: 800 }}>{short(link.sourceNode.code || link.sourceNode.label, 22)} → {short(link.targetNode.code || link.targetNode.label, 22)}</span><strong>{money(link.displayAmount)}</strong></button>)}</div>{context.length > 4 ? <span style={{ color: "var(--if-text-muted, #5f6873)" }}>Showing 4 of {context.length} derived context links.</span> : null}</section> : null}

    <section style={{ display: "grid", gap: "0.35rem", paddingTop: "0.65rem" }}><div style={{ display: "flex", justifyContent: "space-between", gap: "0.75rem", paddingInline: "0.75rem", flexWrap: "wrap" }}><div><strong>Observed money flow</strong><span style={{ marginLeft: "0.45rem", color: "var(--if-text-muted, #5f6873)" }}>{summary.exact} retained exact relationships</span></div><span style={{ color: "var(--if-text-muted, #5f6873)" }}>Hover to isolate · click to pin evidence</span></div><div className="connected-visual__scroller" style={{ minWidth: 0, maxWidth: "100%", width: "100%", position: "relative", background: "var(--if-bg-surface, #fff)", boxShadow: "inset -18px 0 18px -22px rgba(17, 24, 39, 0.45)" }} tabIndex="0" aria-label="Scrollable opportunity Money Path">
      <svg viewBox={`0 0 ${CANVAS_WIDTH} ${diagram.height}`} role="img" aria-label="Observed funding flow from accounts through award and prime recipient to retained supplier samples" style={{ display: "block", minWidth: "880px", width: "100%", height: "auto" }} data-money-path-sankey>
        <defs>{diagram.links.map((link) => <linearGradient key={link.id} id={`${gradientSeed}-${link.index}`} gradientUnits="userSpaceOnUse" x1={link.source.x1} x2={link.target.x0}><stop offset="0%" stopColor={TYPE_COLORS[link.source.type] || TYPE_COLORS[link.type]} /><stop offset="100%" stopColor={TYPE_COLORS[link.target.type] || TYPE_COLORS[link.type]} /></linearGradient>)}</defs><rect width={CANVAS_WIDTH} height={diagram.height} fill="var(--if-bg-surface, #fff)" pointerEvents="none" />
        <g aria-hidden="true" pointerEvents="none">{diagram.lanes.map((lane, stage) => { const laneNodes = diagram.nodes.filter((node) => node.lane === lane); const x = laneNodes[0]?.x0 ?? 172; return <g key={lane}><rect x={Math.max(0, x - 80)} y="12" width="160" height="36" rx="5" fill={stage % 2 ? "var(--if-bg-subtle, #f7f8fa)" : "var(--if-bg-muted, #eef2f5)"} /><text x={x} y="27" textAnchor="middle" fill="var(--if-text, #111827)" fontSize="10" fontWeight="850" letterSpacing="0.65">{LANE_LABELS[lane].toUpperCase()}</text><text x={x} y="41" textAnchor="middle" fill="var(--if-text-muted, #5f6873)" fontSize="8.5">{laneNodes.length} {laneNodes.length === 1 ? "record" : "records"}</text></g>; })}</g>
        <g>{renderedLinks.map((link) => { const related = relatedTo(activeId, link, diagram.links); const selectedLink = selected?.id === link.id; const dash = link.confidence === "derived" || link.type === "structure"; const inspect = () => onSelect(inspectorItem(link, fiscalYear)); return <g key={link.id} role="button" tabIndex="0" aria-label={`${FLOW_LABELS[link.type] || link.label}, ${link.type === "structure" ? "structural relationship" : money(link.amount ?? link.displayAmount)}, ${link.confidence} evidence`} onClick={inspect} onKeyDown={(event) => activate(event, inspect)} onMouseEnter={() => setHoveredId(link.id)} onMouseLeave={() => setHoveredId("")} onFocus={() => setHoveredId(link.id)} onBlur={() => setHoveredId("")} data-money-path-link={link.type} data-money-path-link-width={link.width.toFixed(2)} style={{ cursor: "pointer", outline: "none" }}><path d={linkPath(link)} fill="none" stroke="transparent" strokeWidth={Math.max(18, link.width + 10)} pointerEvents="stroke" /><path d={linkPath(link)} fill="none" stroke={`url(#${gradientSeed}-${link.index})`} strokeWidth={Math.max(link.type === "structure" ? 2 : 3, link.width + (selectedLink ? 2 : 0))} strokeOpacity={related ? (selectedLink || hoveredId === link.id ? 0.9 : 0.48) : 0.1} strokeDasharray={dash ? "7 5" : undefined} strokeLinecap="butt" style={{ pointerEvents: "none", transition: "stroke-opacity 150ms ease, stroke-width 150ms ease" }} /><title>{FLOW_LABELS[link.type] || link.label} · {link.type === "structure" ? "structural relationship" : money(link.amount ?? link.displayAmount)} · {link.confidence}</title></g>; })}</g>
        <g>{diagram.nodes.map((node) => { const related = relatedTo(activeId, node, diagram.links); const selectedNode = selected?.id === node.id; const edgeStage = node.stage === 0 || node.stage === diagram.lanes.length - 1; const leftEdge = node.stage === 0; const textX = edgeStage ? (leftEdge ? node.x0 - 12 : node.x1 + 12) : (node.x0 + node.x1) / 2; const textY = edgeStage ? node.y0 + 7 : 64; const anchor = edgeStage ? (leftEdge ? "end" : "start") : "middle"; const lines = edgeStage ? labelLines(node.label, 22) : [short(node.label, 20)]; const inspect = () => onSelect(inspectorItem(node, fiscalYear)); return <g key={node.id} role="button" tabIndex="0" aria-label={`${node.label}, ${LANE_LABELS[node.lane]}${node.displayAmount ? `, ${money(node.type === "supplier" ? node.amount : node.displayAmount)}` : ""}`} aria-pressed={selectedNode} onClick={inspect} onKeyDown={(event) => activate(event, inspect)} onMouseEnter={() => setHoveredId(node.id)} onMouseLeave={() => setHoveredId("")} onFocus={() => setHoveredId(node.id)} onBlur={() => setHoveredId("")} data-money-path-node={node.type} style={{ cursor: "pointer", opacity: related ? 1 : 0.3, transition: "opacity 150ms ease", outline: "none" }}><rect x={node.x0} y={node.y0} width={Math.max(10, node.x1 - node.x0)} height={Math.max(12, node.y1 - node.y0)} rx="3" fill={TYPE_COLORS[node.type] || "#5f6873"} stroke={selectedNode ? "#0b1727" : "#fff"} strokeWidth={selectedNode ? 3 : 1.5} /><text x={textX} y={textY} textAnchor={anchor} fill="var(--if-text, #111827)" stroke="var(--if-bg-surface, #fff)" strokeWidth="3" strokeLinejoin="round" paintOrder="stroke" fontSize="9.5" fontWeight="800">{node.code ? <tspan x={textX}>{short(node.code, 18)}</tspan> : null}{lines.map((line, index) => <tspan key={`${node.id}-${index}`} x={textX} dy={node.code || index ? 12 : 0} fontWeight="650">{line}</tspan>)}{node.displayAmount ? <tspan x={textX} dy="12" fill="var(--if-text-muted, #5f6873)" fontWeight="750">{money(node.type === "supplier" ? node.amount : node.displayAmount)}</tspan> : null}</text></g>; })}</g>
      </svg>
    </div></section>
    <div className="if-panel__footer" style={{ justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "0.65rem" }} aria-label="Money Path legend"><div style={{ display: "flex", flexWrap: "wrap", gap: "0.65rem 0.9rem" }}><LegendItem type="obligation" /><LegendItem type="structure" dashed /><LegendItem type="prime" /><LegendItem type="subaward" /></div><span style={{ color: "var(--if-text-muted, #5f6873)" }}>Widths compare within each measure class; classes are never added together.</span></div>
  </div>;
}
