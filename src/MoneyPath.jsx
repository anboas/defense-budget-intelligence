import { useMemo, useState } from "react";
import ControlSelect from "./ControlSelect.jsx";

const LANE_LABELS = ["Program", "Budget line", "Appropriation", "Vehicle", "Award", "Prime", "Supplier sample"];
const TYPE_COLORS = {
  program: "#294f73",
  "budget-line": "#3e6f94",
  account: "#087f8c",
  vehicle: "#7a4ca5",
  award: "#9c5b1f",
  prime: "#2c6e49",
  supplier: "#8f2e20",
  request: "#3e6f94",
  obligation: "#087f8c",
  structure: "#7a4ca5",
  subaward: "#8f2e20",
};

function money(value) {
  const amount = Number(value || 0);
  const absolute = Math.abs(amount);
  const sign = amount < 0 ? "−" : "";
  if (absolute >= 1_000_000_000) return `${sign}$${(absolute / 1_000_000_000).toFixed(1)}B`;
  if (absolute >= 1_000_000) return `${sign}$${(absolute / 1_000_000).toFixed(1)}M`;
  if (absolute >= 1_000) return `${sign}$${Math.round(absolute / 1_000).toLocaleString()}K`;
  return `${sign}$${Math.round(absolute).toLocaleString()}`;
}

function short(value, length = 21) {
  const text = String(value || "Not published");
  return text.length > length ? `${text.slice(0, length - 1)}…` : text;
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

function layout(path, fiscalYear) {
  const nodeMap = new Map(path.nodes.map((node) => [node.id, node]));
  const lanes = LANE_LABELS.map((_, lane) => path.nodes.filter((node) => node.lane === lane));
  const positioned = new Map();
  lanes.forEach((nodes, lane) => {
    const max = Math.max(...nodes.map((node) => amountFor(node, fiscalYear)), 1);
    const gap = 18;
    const heights = nodes.map((node) => Math.max(28, Math.min(58, 26 + Math.sqrt(amountFor(node, fiscalYear) / max) * 32)));
    const total = heights.reduce((sum, height) => sum + height, 0) + Math.max(0, nodes.length - 1) * gap;
    let y = Math.max(38, (384 - total) / 2 + 26);
    nodes.forEach((node, index) => {
      positioned.set(node.id, { ...node, x: 18 + lane * 131, y, width: 104, height: heights[index], displayAmount: amountFor(node, fiscalYear) });
      y += heights[index] + gap;
    });
  });
  const maxByType = new Map();
  for (const link of path.links) maxByType.set(link.type, Math.max(maxByType.get(link.type) || 0, linkAmount(link, nodeMap, fiscalYear)));
  const links = path.links.map((link) => {
    const source = positioned.get(link.source);
    const target = positioned.get(link.target);
    const amount = linkAmount(link, nodeMap, fiscalYear);
    const maximum = maxByType.get(link.type) || 1;
    return { ...link, sourceNode: source, targetNode: target, displayAmount: amount, width: link.type === "structure" ? 2 : Math.max(2.5, Math.min(20, 2 + Math.sqrt(amount / maximum) * 18)) };
  }).filter((link) => link.sourceNode && link.targetNode);
  return { nodes: [...positioned.values()], links };
}

function pathD(link) {
  const x1 = link.sourceNode.x + link.sourceNode.width;
  const y1 = link.sourceNode.y + link.sourceNode.height / 2;
  const x2 = link.targetNode.x;
  const y2 = link.targetNode.y + link.targetNode.height / 2;
  const middle = (x1 + x2) / 2;
  return `M${x1},${y1} C${middle},${y1} ${middle},${y2} ${x2},${y2}`;
}

export default function MoneyPath({ path, selected, onSelect }) {
  const [fiscalYear, setFiscalYear] = useState(2027);
  const diagram = useMemo(() => layout(path, fiscalYear), [fiscalYear, path]);
  const summary = useMemo(() => {
    const nodeMap = new Map(path.nodes.map((node) => [node.id, node]));
    return {
      request: path.links.filter((link) => link.type === "request" && link.target.startsWith("account:")).reduce((sum, link) => sum + linkAmount(link, nodeMap, fiscalYear), 0),
      obligations: path.links.filter((link) => link.type === "obligation").reduce((sum, link) => sum + Math.abs(Number(link.amount || 0)), 0),
      suppliers: path.nodes.filter((node) => node.type === "supplier").length,
    };
  }, [fiscalYear, path]);

  return <div style={{ minWidth: 0, maxWidth: "100%", width: "100%", overflow: "hidden" }} data-money-path data-money-path-year={fiscalYear} data-money-path-nodes={diagram.nodes.length} data-money-path-links={diagram.links.length}>
    <div className="if-panel__body" style={{ display: "flex", alignItems: "end", justifyContent: "space-between", gap: "0.75rem", flexWrap: "wrap", paddingBlock: "0.5rem" }}>
      <div style={{ display: "flex", gap: "0.45rem", flexWrap: "wrap" }} aria-label="Money Path summary">
        <span className="if-status if-status--sm">FY{fiscalYear} request {money(summary.request)}</span>
        <span className="if-status if-status--sm">Obligation activity {money(summary.obligations)}</span>
        <span className="if-status if-status--sm">{summary.suppliers} retained supplier{summary.suppliers === 1 ? "" : "s"}</span>
      </div>
      <div className="if-field" style={{ minWidth: "9rem" }}><span className="if-field__label">Budget request year</span><ControlSelect ariaLabel="Budget request year" value={String(fiscalYear)} options={path.fiscalYears.map((year) => [String(year), `FY${year}`])} triggerProps={{ style: { minHeight: "2.75rem" } }} onChange={(value) => setFiscalYear(Number(value))} /></div>
    </div>
    <div className="connected-visual__scroller" style={{ minWidth: 0, maxWidth: "100%", width: "100%" }} tabIndex="0" aria-label="Scrollable opportunity Money Path">
      <svg viewBox="0 0 940 420" role="img" aria-label="Funding flow from program and budget line through accounts, awards, prime recipients, and retained supplier samples" style={{ display: "block", minWidth: "880px", width: "100%", height: "auto", background: "var(--if-surface-subtle, #f7f8fa)" }} data-money-path-sankey>
        <g aria-hidden="true">{LANE_LABELS.map((label, lane) => <g key={label}><line x1={16 + lane * 131} x2={122 + lane * 131} y1="25" y2="25" stroke="var(--if-border, #d7dce2)" /><text x={18 + lane * 131} y="18" fill="var(--if-text-muted, #5f6873)" fontSize="10" fontWeight="700">{label.toUpperCase()}</text></g>)}</g>
        <g>{diagram.links.map((link) => <path key={link.id} d={pathD(link)} fill="none" stroke={TYPE_COLORS[link.type] || "#66717d"} strokeWidth={link.width + (selected?.id === link.id ? 2 : 0)} strokeOpacity={selected?.id === link.id ? 0.95 : 0.45} strokeDasharray={link.confidence === "derived" || link.type === "structure" ? "7 5" : undefined} style={{ outline: "none" }} role="button" tabIndex="0" aria-label={`${link.label}, ${link.type === "structure" ? "structural relationship" : money(link.amount ?? link.displayAmount)}, ${link.confidence} evidence`} onClick={() => onSelect({ ...link, type: `${link.type}-flow`, label: link.label, amount: link.amount ?? link.displayAmount, detail: link.detail || `${link.confidence} ${link.amountType.replaceAll("-", " ")}` })} onKeyDown={(event) => activate(event, () => onSelect({ ...link, type: `${link.type}-flow`, label: link.label, amount: link.amount ?? link.displayAmount, detail: link.detail || `${link.confidence} ${link.amountType.replaceAll("-", " ")}` }))} data-money-path-link={link.type}><title>{link.label} · {link.type === "structure" ? "structural relationship" : money(link.amount ?? link.displayAmount)} · {link.confidence}</title></path>)}</g>
        <g>{diagram.nodes.map((node) => <g key={node.id} role="button" tabIndex="0" aria-label={`${node.label}, ${LANE_LABELS[node.lane]}${node.displayAmount ? `, ${money(node.displayAmount)}` : ""}`} aria-pressed={selected?.id === node.id} onClick={() => onSelect({ ...node, detail: node.detail || `${LANE_LABELS[node.lane]} · ${node.confidence || node.status || "published"}`, amount: node.type === "supplier" ? node.amount : node.displayAmount })} onKeyDown={(event) => activate(event, () => onSelect({ ...node, detail: node.detail || `${LANE_LABELS[node.lane]} · ${node.confidence || node.status || "published"}`, amount: node.type === "supplier" ? node.amount : node.displayAmount }))} data-money-path-node={node.type}>
          <rect x={node.x} y={node.y} width={node.width} height={node.height} rx="5" fill={TYPE_COLORS[node.type] || "#5f6873"} opacity={selected?.id === node.id ? 1 : 0.88} stroke={selected?.id === node.id ? "#111827" : "#ffffff"} strokeWidth={selected?.id === node.id ? 3 : 1.5} />
          <text x={node.x + 7} y={node.y + 15} fill="#fff" fontSize="9" fontWeight="800">{short(node.code || LANE_LABELS[node.lane], 17)}</text>
          <text x={node.x + 7} y={node.y + 29} fill="#fff" fontSize="9.5" fontWeight="650">{short(node.label)}</text>
          {node.height >= 45 && node.displayAmount ? <text x={node.x + 7} y={node.y + 44} fill="#fff" fontSize="9">{money(node.type === "supplier" ? node.amount : node.displayAmount)}</text> : null}
        </g>)}</g>
      </svg>
    </div>
    <div className="if-panel__footer" style={{ justifyContent: "flex-start", flexWrap: "wrap", gap: "0.65rem" }} aria-label="Money Path legend">
      <span><strong style={{ color: TYPE_COLORS.request }}>━━</strong> Budget request</span><span><strong style={{ color: TYPE_COLORS.obligation }}>━━</strong> Exact obligation</span><span><strong style={{ color: TYPE_COLORS.structure }}>┅┅</strong> Contract structure</span><span><strong style={{ color: TYPE_COLORS.subaward }}>━━</strong> Retained subaward sample</span><span>Widths compare within each measure class; classes are never added together.</span>
    </div>
  </div>;
}
