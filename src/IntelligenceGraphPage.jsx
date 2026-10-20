import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { ArrowLeft, CalendarClock, Network, X } from "lucide-react";
import { ControlAsyncState, ControlAutocomplete, ControlStatusBadge } from "control-surface-ui/react";
import ControlWorkbenchHeader from "./WorkbenchHeader.jsx";
import { intelligenceGraphRoute, timelineRoute } from "./cross-surface-routes.js";
import { loadLinkedIntelligence } from "./intelligence-graph.js";
import { intelligenceTypeLabel, loadIntelligenceSearchIndex } from "./intelligence-search.js";
import "./IntelligenceGraphPage.css";

const LinkedIntelligenceGraph = lazy(() => import("./LinkedIntelligenceGraph.jsx"));

const ROOTABLE_TYPES = new Set(["activity", "award", "organization", "federal-account", "defense-program", "program-office"]);

function routedEntity(routeHash) {
  const params = new URLSearchParams(String(routeHash).split("?")[1] || "");
  const legacyRecord = params.get("graphRecord") || params.get("capRecord") || "";
  return {
    root: {
      id: params.get("graphEntity") || (legacyRecord ? `activity:${legacyRecord}` : ""),
      type: params.get("graphType") || (legacyRecord ? "activity" : ""),
      label: params.get("graphLabel") || "",
    },
    target: {
      id: params.get("graphTarget") || "",
      type: params.get("graphTargetType") || "",
      label: params.get("graphTargetLabel") || "",
    },
    view: {
      depth: params.get("orgDepth") || "2",
      group: params.get("orgGroup") || "services",
      status: params.get("orgStatus") || "current",
      workOnly: params.get("orgWorkOnly") === "1",
      workOverlay: params.get("orgOverlay") || "opportunities",
    },
  };
}

function defaultRoot(index) {
  return Object.values(index?.nodes || {}).find((item) => item.type === "organization" && item.label === "Department of War")
    || Object.values(index?.nodes || {}).find((item) => item.type === "organization" && item.label === "Department of the Navy")
    || Object.values(index?.nodes || {}).find((item) => item.type === "organization")
    || null;
}

function graphRoute(root, target = null) {
  return intelligenceGraphRoute({
    entityType: root.type,
    entityId: root.id,
    entityLabel: root.label,
    targetType: target?.type,
    targetId: target?.id,
    targetLabel: target?.label,
  });
}

function EntitySearch({ selected, suggestions, onSelect }) {
  const [query, setQuery] = useState(() => selected?.label || "");
  return <ControlAutocomplete label="Explore from" value={query} items={suggestions} minLength={1} limit={12} onChange={setQuery} onSelect={(item) => onSelect(item.entity)} placeholder="Navy, NAVAIR, NIWC Pacific, federal account, program, award" emptyText="No retained linked entity matches" data-intelligence-graph-search />;
}

function ConnectionSearch({ root, selected, suggestions, onSelect, onClear }) {
  const [query, setQuery] = useState(() => selected?.label || "");
  const items = useMemo(() => suggestions.filter((item) => item.entity.id !== root.id), [root.id, suggestions]);
  return <div className="intelligence-graph-page__trace-control" data-intelligence-graph-trace-control>
    <ControlAutocomplete label="Trace connection to" value={query} items={items} minLength={1} limit={12} onChange={setQuery} onSelect={(item) => onSelect(item.entity)} placeholder="Account, command, program, award, opportunity" emptyText="No retained linked entity matches" />
    {selected ? <button type="button" className="if-icon-btn" title="Clear connection trace" aria-label="Clear connection trace" onClick={onClear}><X size={15} /></button> : null}
  </div>;
}

export default function IntelligenceGraphPage({ routeHash = "" }) {
  const routed = routedEntity(routeHash);
  const [state, setState] = useState({ status: "loading", index: null, search: null, error: null });
  useEffect(() => {
    let active = true;
    Promise.all([loadLinkedIntelligence(), loadIntelligenceSearchIndex()])
      .then(([index, search]) => { if (active) setState({ status: "ready", index, search, error: null }); })
      .catch((error) => { if (active) setState({ status: "error", index: null, search: null, error }); });
    return () => { active = false; };
  }, []);
  const selected = useMemo(() => {
    if (!state.index) return null;
    const canonicalId = state.index.indices?.byEntity?.[routed.root.id]?.canonicalId || routed.root.id;
    return state.index.nodes?.[canonicalId]
      || Object.values(state.index.nodes || {}).find((item) => item.type === routed.root.type && [item.label, ...(item.aliases || [])].some((name) => String(name).toLowerCase() === String(routed.root.label).toLowerCase()))
      || defaultRoot(state.index);
  }, [routed.root.id, routed.root.label, routed.root.type, state.index]);
  const target = useMemo(() => {
    if (!state.index || !routed.target.id) return null;
    const canonicalId = state.index.indices?.byEntity?.[routed.target.id]?.canonicalId || routed.target.id;
    return state.index.nodes?.[canonicalId]
      || Object.values(state.index.nodes || {}).find((item) => item.type === routed.target.type && [item.label, ...(item.aliases || [])].some((name) => String(name).toLowerCase() === String(routed.target.label).toLowerCase()))
      || null;
  }, [routed.target.id, routed.target.label, routed.target.type, state.index]);
  const suggestions = useMemo(() => {
    if (!state.search || !state.index) return [];
    const seen = new Set();
    return state.search.items.flatMap((item) => {
      if (!ROOTABLE_TYPES.has(item.entityType)) return [];
      const id = item.canonicalGraphId || item.graphId;
      const entity = state.index.nodes?.[id];
      if (!entity || seen.has(id)) return [];
      seen.add(id);
      return [{
        id,
        value: [item.label, ...(item.facts || []), ...(entity.aliases || [])].filter(Boolean).join(" "),
        label: entity.label,
        meta: (item.facts || []).slice(0, 3).join(" · ") || intelligenceTypeLabel(entity.type),
        type: intelligenceTypeLabel(entity.type),
        entity,
      }];
    });
  }, [state.index, state.search]);
  const timelineCount = selected ? state.index?.indices?.byEntity?.[selected.id]?.timelineActivityIds?.length || 0 : 0;
  const updateRoot = (entity) => { window.location.hash = graphRoute(entity); };
  const updateTarget = (entity) => { window.location.hash = graphRoute(selected, entity); };
  const clearTarget = () => { window.location.hash = graphRoute(selected); };
  const updateStructureView = (view) => {
    const [path, query = ""] = String(routeHash || "#/budget-spend/intelligence-graph").split("?");
    const params = new URLSearchParams(query);
    const write = (name, value, fallback) => { if (value === fallback) params.delete(name); else params.set(name, value); };
    write("orgDepth", view.depth, "2");
    write("orgGroup", view.group, "services");
    write("orgStatus", view.status, "current");
    write("orgOverlay", view.workOverlay, "opportunities");
    if (view.workOnly) params.set("orgWorkOnly", "1"); else params.delete("orgWorkOnly");
    window.location.hash = `${path}${params.size ? `?${params}` : ""}`;
  };

  return <div className="if-stack intelligence-graph-page" data-intelligence-graph-page>
    <ControlWorkbenchHeader eyebrow="Investigate linked intelligence" title="Graph Explorer" summary="Drill through reviewed Department of War structure, then pivot from departments, services, commands, components, agencies, accounts, awards, programs, and opportunities into their retained work, money, people, places, evidence, and Timeline." />
    {state.status === "loading" ? <ControlAsyncState state="loading" title="Loading linked intelligence" message="Opening the bounded relationship index and universal entity search." /> : state.status === "error" ? <ControlAsyncState state="error" title="Linked intelligence unavailable" message="The graph index could not be opened. Other intelligence workspaces remain available." /> : selected ? <>
      <section className="if-panel intelligence-graph-page__rail" aria-label="Graph Explorer controls">
        <div className="intelligence-graph-page__searches">
          <EntitySearch key={`root:${selected.id}`} selected={selected} suggestions={suggestions} onSelect={updateRoot} />
          <ConnectionSearch key={`target:${selected.id}:${target?.id || "none"}`} root={selected} selected={target} suggestions={suggestions} onSelect={updateTarget} onClear={clearTarget} />
        </div>
        <span className="if-field intelligence-graph-page__root"><small className="if-field__label">Graph root</small><strong>{selected.label}</strong><span className="if-cluster"><ControlStatusBadge category="evidence" status={selected.reviewState || "source_declared"}>{selected.reviewState === "reviewed" ? "Reviewed identity" : "Retained identity"}</ControlStatusBadge><small className="if-text-muted if-text-xs">{intelligenceTypeLabel(selected.type)}</small></span></span>
        <div className="if-button-group intelligence-graph-page__actions">
          <a className="if-btn if-btn--secondary" href="#/budget-spend/library"><ArrowLeft size={15} />Organizations</a>
          {timelineCount ? <a className="if-btn if-btn--secondary" href={timelineRoute("", { scope: "entity", entityType: selected.type, entityId: selected.id, entityLabel: selected.label })}><CalendarClock size={15} />Timeline <small className="if-text-xs">{timelineCount.toLocaleString()}</small></a> : null}
        </div>
      </section>
      <section className="if-panel intelligence-graph-page__canvas" aria-label="Traversable linked intelligence graph"><Suspense fallback={<ControlAsyncState state="loading" title="Opening linked graph" message="Preparing the bounded relationship canvas." />}><LinkedIntelligenceGraph key={`${selected.id}:${target?.id || "neighborhood"}:${routed.view.depth}:${routed.view.group}:${routed.view.status}:${routed.view.workOnly}:${routed.view.workOverlay}`} index={state.index} rootId={selected.id} targetId={target?.id || ""} initialStructure={routed.view} onStructureChange={updateStructureView} onRootChange={updateRoot} /></Suspense></section>
    </> : <ControlAsyncState state="empty" title="No linked entity available" message="Return to Organizations or Opportunities and choose a retained entity." action={<a className="if-btn if-btn--secondary" href="#/budget-spend/library"><Network size={15} />Open organizations</a>} />}
  </div>;
}
