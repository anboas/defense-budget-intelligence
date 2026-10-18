import { ControlGraph } from "control-surface-ui/react/graph";
import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { loadMoneyPath } from "./intelligence-graph.js";
import { PURSUIT_TASK_EVENT } from "./pursuit-metadata.js";
import { accountFlowRoute, awardsRoute, classificationRoute, dataLibraryRoute, intelligenceGraphRoute, mapLocationRoute, opportunityRoute, timelineRoute } from "./cross-surface-routes.js";
import "./control-graph.css";
import "./ConnectedEvidenceVisual.css";

const MoneyPath = lazy(() => import("./MoneyPath.jsx"));
const OrganizationRelationshipLens = lazy(() => import("./OrganizationRelationshipLens.jsx"));

const TYPE_LABEL = {
  activity: "Opportunity",
  award: "Award",
  organization: "Organization",
  location: "Location",
  account: "Federal account",
  classification: "Classification",
  vehicle: "Parent vehicle",
  predecessor: "Predecessor",
  successor: "Successor",
  conflict: "Evidence conflict",
  program: "Program",
  "budget-line": "Budget line",
  prime: "Prime recipient",
  supplier: "Supplier sample",
  "request-flow": "Budget request flow",
  "obligation-flow": "Exact obligation flow",
  "structure-flow": "Contract structure",
  "prime-flow": "Prime award flow",
  "subaward-flow": "Retained subaward flow",
};

const VIEWS = new Set(["connections", "timeline", "money", "relationships"]);

const GRAPH_NODE_TYPES = Object.freeze(Object.fromEntries(Object.entries({
  activity: ["opportunity", "#0f766e", "star"],
  award: ["obligation", "#b45309", "award"],
  organization: ["org", "#0369a1", "department"],
  location: ["org", "#0369a1", "location"],
  account: ["source", "#4f46e5", "database"],
  classification: ["evidence", "#15803d", "tag"],
  vehicle: ["implementation", "#0f766e", "workflow"],
  predecessor: ["event", "#b45309", "history"],
  successor: ["event", "#b45309", "arrowRight"],
  conflict: ["gap", "#b42318", "warning"],
}).map(([type, [className, color, icon]]) => [type, { className, color, icon, label: TYPE_LABEL[type], data: { evidenceNode: type } }])));

const GRAPH_RELATION = Object.freeze({
  award: "linked award",
  organization: "customer organization",
  location: "place of performance",
  account: "federal account",
  classification: "classification",
  vehicle: "contract vehicle",
  predecessor: "predecessor",
  successor: "successor",
  conflict: "evidence conflict",
});

const GRAPH_LAYOUT_OPTIONS = Object.freeze({ deconflictPasses: 20, deconflictStrength: 0.78 });

const graphNodeId = (item) => `${item.type}:${item.id}`;

function evidenceLaneLayout({ nodes = [] }) {
  const anchor = nodes.find((item) => item.kind === "activity") || nodes[0];
  const neighbors = nodes.filter((item) => item !== anchor);
  const left = neighbors.filter((_, index) => index % 2 === 0);
  const right = neighbors.filter((_, index) => index % 2 === 1);
  const lane = (items, x) => items.map((item, index) => ({ id: item.id, x, y: 12 + ((index + 1) / (items.length + 1)) * 76 }));
  return {
    coordinateSpace: "percent",
    layout: "evidence-lanes",
    nodes: [anchor ? { id: anchor.id, x: 50, y: 50 } : null, ...lane(left, 17), ...lane(right, 83)].filter(Boolean),
  };
}

function routeSelection() {
  if (typeof window === "undefined") return { view: "connections", item: "" };
  const params = new URLSearchParams(window.location.hash.split("?")[1] || "");
  const view = params.get("capVisual");
  return { view: VIEWS.has(view) ? view : "connections", item: params.get("capVisualItem") || params.get("graphNode") || "" };
}

function updateRouteSelection(view, item = "") {
  const [path, search = ""] = window.location.hash.split("?");
  const params = new URLSearchParams(search);
  if (view === "connections") params.delete("capVisual");
  else params.set("capVisual", view);
  if (item) params.set("capVisualItem", item);
  else params.delete("capVisualItem");
  const next = `${path}?${params}`;
  window.history.replaceState(window.history.state, "", `${window.location.pathname}${window.location.search}${next}`);
}

function compact(value, fallback = "Not published") {
  return String(value || fallback).replaceAll("_", " ");
}

function short(value, length = 38) {
  const text = compact(value);
  return text.length > length ? `${text.slice(0, length - 1)}…` : text;
}

function date(value) {
  if (!value) return "Unknown date";
  const parsed = new Date(`${String(value).slice(0, 10)}T12:00:00Z`);
  return Number.isNaN(parsed.getTime()) ? "Unknown date" : parsed.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" });
}

function money(value) {
  const amount = Number(value || 0);
  const absolute = Math.abs(amount);
  const sign = amount < 0 ? "−" : "";
  if (absolute >= 1_000_000_000) return `${sign}$${(absolute / 1_000_000_000).toFixed(1)}B`;
  if (absolute >= 1_000_000) return `${sign}$${(absolute / 1_000_000).toFixed(1)}M`;
  if (absolute >= 1_000) return `${sign}$${Math.round(absolute / 1_000).toLocaleString()}K`;
  return `${sign}$${Math.round(absolute).toLocaleString()}`;
}

function node(id, type, label, detail, action = null, actionLabel = "Open connected record") {
  return { id, type, label: compact(label), detail: compact(detail), action, actionLabel };
}

function graphNodes(connection, lineage, temporal, record, opportunityId) {
  const connected = connection?.connected || {};
  const neighbors = [
    ...(connected.organizations || []).slice(0, 3).map((item) => node(item.id, "organization", item.label, item.identity?.identifiers?.uei ? `UEI ${item.identity.identifiers.uei}` : item.identity?.method, dataLibraryRoute({ organizationId: [item.sourceId, item.id].find((id) => String(id || "").startsWith("organization-dossier:")) || "", query: item.label }), "Open customer hierarchy")),
    ...(connected.awards || []).slice(0, 2).map((item) => node(item.id, "award", item.piid || item.label, item.label, awardsRoute(item.piid || item.id, item.label), "Open award evidence")),
    ...(lineage?.vehicles || []).slice(0, 2).map((item) => node(item.id, "vehicle", item.piid || item.label, `${item.orderCount || 0} linked order${item.orderCount === 1 ? "" : "s"}`, timelineRoute("", { vehicle: item.piid || item.label }), "Browse vehicle family")),
    ...(connected.federalAccounts || []).slice(0, 2).map((item) => node(item.id, "account", item.federalAccountCode || item.label, item.label, accountFlowRoute(item.federalAccountCode || item.label), "Open account flow")),
    ...(lineage?.predecessors || []).slice(0, 1).map((item) => node(item.opportunityId, "predecessor", item.reference || item.label, item.label, intelligenceGraphRoute(item.opportunityId), "Traverse from predecessor")),
    ...(lineage?.successors || []).slice(0, 1).map((item) => node(item.opportunityId, "successor", item.reference || item.label, item.label, intelligenceGraphRoute(item.opportunityId), "Traverse into successor")),
    ...(connected.locations || []).slice(0, 1).map((item) => node(item.id, "location", item.label, [item.city, item.state].filter(Boolean).join(", "), mapLocationRoute(item.sourceId || item.id, item.label), "Show on map")),
    ...(connected.classifications || []).slice(0, 2).map((item) => node(item.id, "classification", item.label, item.namespace, classificationRoute(item.label), "Browse matching opportunities")),
    ...(temporal?.conflicts || []).filter((item) => item.status === "needs_review").slice(0, 1).map((item) => node(item.id, "conflict", compact(item.field), item.reason)),
  ].slice(0, 12);
  return [node(opportunityId, "activity", record?.title || record?.id || "Selected opportunity", record?.reference || record?.id || opportunityId, opportunityRoute(opportunityId)), ...neighbors];
}

function timelineEvents(record, report, temporal, lineage, opportunityId) {
  const route = (item) => timelineRoute(opportunityId, { research: item.reportId, researchDate: item.date });
  const events = [
    ...(record?.events || []).map((item) => ({ id: item.eventId || `${item.label}-${item.start}`, date: item.start, label: item.label, detail: `${item.isForecast ? "Forecast" : "Reported"} · ${compact(item.status)}`, type: item.isForecast ? "forecast" : "official" })),
    ...(record?.milestones || []).map((item) => ({ id: `milestone-${item.label}-${item.start}`, date: item.start, label: item.label, detail: "Published milestone", type: "official" })),
    ...(report?.keyDates || []).map((item, index) => ({ id: `research-${item.label}-${item.date}-${index}`, date: item.date, label: item.label, detail: item.basis, type: "research", reportId: report.id, sourceUrl: item.sourceUrls?.[0] })),
    temporal?.validity?.effectiveFrom ? { id: "validity-start", date: temporal.validity.effectiveFrom, label: "Evidence becomes effective", detail: temporal.validity.basis, type: "evidence" } : null,
    temporal?.validity?.effectiveTo ? { id: "validity-end", date: temporal.validity.effectiveTo, label: "Reported effective end", detail: temporal.validity.basis, type: "evidence" } : null,
    temporal?.validity?.reviewBy ? { id: "validity-review", date: temporal.validity.reviewBy, label: "Evidence review due", detail: `Current state: ${compact(temporal.validity.status)}`, type: "review" } : null,
    ...(lineage?.recompeteSignals || []).map((item) => ({ id: item.id, date: item.endDate, label: "Recompete timing review", detail: item.caveat, type: "review" })),
  ].filter((item) => item?.date && !Number.isNaN(Date.parse(item.date))).sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
  const unique = [...new Map(events.map((item) => [`${item.date}|${item.label}`, item])).values()].slice(0, 14);
  return unique.map((item) => ({ ...item, action: route(item) }));
}

function ConnectionsView({ nodes, selected, onSelect }) {
  const neighbors = useMemo(() => nodes.slice(1), [nodes]);
  const leftCount = Math.ceil(neighbors.length / 2);
  const rightCount = Math.floor(neighbors.length / 2);
  const graphHeight = Math.max(480, Math.max(leftCount, rightCount) * 104);
  const graphNodes = useMemo(() => nodes.map((item) => ({
    id: graphNodeId(item),
    kind: item.type,
    label: short(item.label, 34),
    meta: TYPE_LABEL[item.type],
    description: item.detail,
    primary: item.type === "activity",
    relation: GRAPH_RELATION[item.type] || "selected opportunity",
  })), [nodes]);
  const graphEdges = useMemo(() => neighbors.map((item) => ({
    id: `edge:${graphNodeId(item)}`,
    from: graphNodeId(nodes[0]),
    to: graphNodeId(item),
    type: item.type,
    label: GRAPH_RELATION[item.type] || TYPE_LABEL[item.type],
    evidence: item.detail,
  })), [neighbors, nodes]);
  const selectedGraphId = selected ? graphNodeId(selected) : graphNodeId(nodes[0]);
  const selectGraphNode = ({ nodeId }) => {
    const item = nodes.find((candidate) => graphNodeId(candidate) === nodeId);
    if (item) onSelect(item);
  };
  const selectGraphEdge = ({ to }) => {
    const item = nodes.find((candidate) => graphNodeId(candidate) === to);
    if (item) onSelect(item);
  };
  return <ControlGraph
    className="connected-visual__control-graph"
    style={{ "--connected-evidence-graph-height": `${graphHeight}px` }}
    nodes={graphNodes}
    edges={graphEdges}
    selected={selectedGraphId}
    layout="evidence-lanes"
    layoutEngine={evidenceLaneLayout}
    layoutOptions={GRAPH_LAYOUT_OPTIONS}
    nodeTypes={GRAPH_NODE_TYPES}
    panelMode="external"
    a11yMode="screenreader"
    edgeLabelMode="pill"
    canvasLabel="Connected evidence graph"
    a11yLabel="Connected evidence graph index"
    emptyLabel="Connected evidence"
    onNodeSelect={selectGraphNode}
    onEdgeSelect={selectGraphEdge}
    data-evidence-visual-graph
    data-node-count={nodes.length}
  />;
}

function TimelineView({ events, selected, onSelect }) {
  if (!events.length) return <div className="connected-visual__empty" data-evidence-visual-empty>No dated evidence is available for this record yet. Open the full Timeline to inspect the surrounding workspace.</div>;
  return <ol className="if-timeline connected-visual__timeline-list" aria-label="Connected evidence dates" data-evidence-visual-timeline data-marker-count={events.length}>
    {events.map((item) => <li key={item.id} className={`if-timeline__item is-${item.type}${selected.id === item.id ? " is-selected" : ""}`}>
      <button type="button" aria-pressed={selected.id === item.id} onClick={() => onSelect(item)} data-visual-timeline-marker={item.type}>
        <time dateTime={item.date}>{date(item.date)}</time><span><strong>{item.label}</strong><small>{item.detail}</small></span><em>{TYPE_LABEL[item.type] || compact(item.type)}</em>
      </button>
    </li>)}
  </ol>;
}

function createTask(recordId, item, view) {
  window.dispatchEvent(new CustomEvent(PURSUIT_TASK_EVENT, { detail: {
    recordId,
    title: item.date ? `Review ${item.label}` : `Resolve ${item.label}`,
    dueAt: item.date || "",
    priority: item.type === "conflict" ? "high" : "normal",
    sourceType: view,
    sourceId: item.id,
    sourceLabel: item.label,
  } }));
}

export default function ConnectedEvidenceVisual({ connection, lineage, temporal, record, researchReport, opportunityId, fullView = false }) {
  const nodes = useMemo(() => graphNodes(connection, lineage, temporal, record, opportunityId), [connection, lineage, opportunityId, record, temporal]);
  const events = useMemo(() => timelineEvents(record, researchReport, temporal, lineage, opportunityId), [lineage, opportunityId, record, researchReport, temporal]);
  const initial = routeSelection();
  const [view, setView] = useState(initial.view);
  const [selectedId, setSelectedId] = useState(initial.item);
  const [moneyState, setMoneyState] = useState({ status: "loading", path: null });
  useEffect(() => {
    if (view !== "money" || moneyState.status !== "loading") return;
    let active = true;
    loadMoneyPath()
      .then((payload) => { if (active) setMoneyState({ status: "ready", path: payload.indices?.byActivity?.[opportunityId] || null, metadata: payload.metadata }); })
      .catch((error) => { if (active) setMoneyState({ status: "error", path: null, error }); });
    return () => { active = false; };
  }, [moneyState.status, opportunityId, view]);
  const moneyItems = useMemo(() => moneyState.path ? [
    ...moneyState.path.nodes,
    ...moneyState.path.links.map((item) => ({ ...item, type: `${item.type}-flow`, label: item.label, detail: item.detail || `${item.confidence} ${item.amountType.replaceAll("-", " ")}` })),
  ] : [], [moneyState.path]);
  const visibleItems = view === "connections" ? nodes : view === "timeline" ? events : view === "money" ? moneyItems : [];
  const selected = visibleItems.find((item) => item.id === selectedId) || visibleItems[0] || nodes[0];
  const selectView = (next) => { setView(next); setSelectedId(""); updateRouteSelection(next); };
  const selectItem = (item) => { setSelectedId(item.id); updateRouteSelection(view, item.id); };
  const reset = () => { setSelectedId(""); updateRouteSelection(view); };
  useEffect(() => {
    const sync = () => { const next = routeSelection(); setView(next.view); setSelectedId(next.item); };
    const clearOnEscape = (event) => {
      const current = routeSelection();
      if (event.key === "Escape" && current.item) {
        setSelectedId("");
        updateRouteSelection(current.view);
      }
    };
    window.addEventListener("hashchange", sync);
    window.addEventListener("popstate", sync);
    window.addEventListener("keydown", clearOnEscape);
    return () => { window.removeEventListener("hashchange", sync); window.removeEventListener("popstate", sync); window.removeEventListener("keydown", clearOnEscape); };
  }, []);
  return <section className="connected-visual" style={{ minWidth: 0, maxWidth: "100%", width: "100%", overflow: "hidden" }} data-connected-visual-analysis data-connected-visual-view={view} data-connected-visual-selected={selected?.id || ""} onKeyDown={(event) => { if (event.key === "Escape" && selectedId) { event.preventDefault(); reset(); } }}>
    <header><div><span>Connected intelligence ·</span>{" "}<strong>{view === "connections" ? `${nodes.length - 1} bounded neighbors` : view === "timeline" ? `${events.length} dated signals` : view === "relationships" ? "customer and industrial-base lanes" : moneyState.path ? `${moneyState.path.nodes.length} money-path nodes` : "bounded funding chain"}</strong></div><nav aria-label="Choose visual analysis"><button type="button" className={view === "connections" ? "is-active" : ""} aria-pressed={view === "connections"} onClick={() => selectView("connections")}>Connections</button><button type="button" className={view === "timeline" ? "is-active" : ""} aria-pressed={view === "timeline"} onClick={() => selectView("timeline")}>Timeline</button><button type="button" className={view === "money" ? "is-active" : ""} aria-pressed={view === "money"} onClick={() => selectView("money")}>Money Path</button><button type="button" className={view === "relationships" ? "is-active" : ""} aria-pressed={view === "relationships"} onClick={() => selectView("relationships")}>Relationships</button></nav>{view !== "relationships" && selectedId ? <button type="button" onClick={reset}>Reset</button> : null}</header>
    {view === "connections" ? <ConnectionsView nodes={nodes} selected={selected} onSelect={selectItem} /> : view === "timeline" ? <TimelineView events={events} selected={selected} onSelect={selectItem} /> : view === "relationships" ? <Suspense fallback={<div className="connected-visual__empty" role="status">Loading organization relationships…</div>}><OrganizationRelationshipLens record={record} connection={connection} compact embedded /></Suspense> : moneyState.status === "loading" ? <div className="connected-visual__empty" role="status">Loading bounded funding chain…</div> : moneyState.status === "error" ? <div className="connected-visual__empty" role="alert">Money Path is temporarily unavailable. The evidence graph remains usable.</div> : moneyState.path ? <Suspense fallback={<div className="connected-visual__empty" role="status">Drawing Money Path…</div>}><MoneyPath path={moneyState.path} selected={selectedId ? selected : null} onSelect={selectItem} /></Suspense> : <div className="connected-visual__empty" data-money-path-empty>No exact award-account funding path is published for this record yet. No relationship was inferred.</div>}
    {view !== "relationships" && (view !== "money" || selectedId) ? <article className="connected-visual__inspector" data-evidence-visual-inspector><div><small>{TYPE_LABEL[selected.type] || compact(selected.type)}</small> · <strong>{selected.label}</strong> · <span>{selected.date ? date(selected.date) : selected.amount != null ? money(selected.amount) : selected.detail}</span></div><p>{selected.detail || (selected.date ? selected.detail : selected.type === "activity" ? "The selected record anchors this bounded, deterministic neighborhood." : `This ${TYPE_LABEL[selected.type]?.toLowerCase() || "entity"} is linked by retained source evidence.`)}</p><nav className="if-button-group" aria-label="Selected evidence actions">{selected.sourceUrl ? <a href={selected.sourceUrl} target="_blank" rel="noreferrer">Open cited source ↗</a> : selected.action ? <a href={selected.action}>{selected.date ? "Show on full Timeline" : selected.actionLabel} →</a> : null}{!fullView ? <a className="if-btn if-btn--secondary" href={intelligenceGraphRoute(opportunityId, selected.id)}>Open Intelligence Graph</a> : null}<button type="button" className="if-btn if-btn--secondary" onClick={() => createTask(opportunityId, selected, view)}>Create task</button></nav></article> : null}
    <footer aria-live="polite"><span>Click, tap, or tab to inspect. Escape resets selection.</span> · <span>Bounded indexes only · full graph never loaded</span></footer>
  </section>;
}
