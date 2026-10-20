import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { ArrowLeft, CalendarClock, Network } from "lucide-react";
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
    id: params.get("graphEntity") || (legacyRecord ? `activity:${legacyRecord}` : ""),
    type: params.get("graphType") || (legacyRecord ? "activity" : ""),
    label: params.get("graphLabel") || "",
  };
}

function defaultRoot(index) {
  return Object.values(index?.nodes || {}).find((item) => item.type === "organization" && item.label === "Department of the Navy")
    || Object.values(index?.nodes || {}).find((item) => item.type === "organization")
    || null;
}

function updateRoot(entity) {
  window.location.hash = intelligenceGraphRoute({ entityType: entity.type, entityId: entity.id, entityLabel: entity.label });
}

function EntitySearch({ selected, suggestions }) {
  const [query, setQuery] = useState(() => selected?.label || "");
  return <ControlAutocomplete label="Find any linked entity" value={query} items={suggestions} minLength={1} limit={12} onChange={setQuery} onSelect={(item) => updateRoot(item.entity)} placeholder="Navy, NAVAIR, NIWC Pacific, federal account, program, award" emptyText="No retained linked entity matches" data-intelligence-graph-search />;
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
    const canonicalId = state.index.indices?.byEntity?.[routed.id]?.canonicalId || routed.id;
    return state.index.nodes?.[canonicalId]
      || Object.values(state.index.nodes || {}).find((item) => item.type === routed.type && [item.label, ...(item.aliases || [])].some((name) => String(name).toLowerCase() === String(routed.label).toLowerCase()))
      || defaultRoot(state.index);
  }, [routed.id, routed.label, routed.type, state.index]);
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

  return <div className="intelligence-graph-page" data-intelligence-graph-page>
    <ControlWorkbenchHeader eyebrow="Investigate linked intelligence" title="Graph Explorer" summary="Root the graph on an organization, federal account, program, award, or opportunity. Traverse reviewed hierarchy and retained work, money, people, and place relationships without treating raw acquisition taxonomy as command structure." />
    {state.status === "loading" ? <ControlAsyncState state="loading" title="Loading linked intelligence" message="Opening the bounded relationship index and universal entity search." /> : state.status === "error" ? <ControlAsyncState state="error" title="Linked intelligence unavailable" message="The graph index could not be opened. Other intelligence workspaces remain available." /> : selected ? <>
      <section className="if-panel intelligence-graph-page__rail" aria-label="Graph Explorer controls">
        <EntitySearch key={selected.id} selected={selected} suggestions={suggestions} />
        <span className="if-field intelligence-graph-page__root"><small className="if-field__label">Graph root</small><strong>{selected.label}</strong><span><ControlStatusBadge category="evidence" status={selected.reviewState || "source_declared"}>{selected.reviewState === "reviewed" ? "Reviewed identity" : "Retained identity"}</ControlStatusBadge><small>{intelligenceTypeLabel(selected.type)}</small></span></span>
        <div className="if-button-group intelligence-graph-page__actions">
          <a className="if-btn if-btn--secondary" href="#/budget-spend/library"><ArrowLeft size={15} />Organizations</a>
          {timelineCount ? <a className="if-btn if-btn--secondary" href={timelineRoute("", { scope: "entity", entityType: selected.type, entityId: selected.id, entityLabel: selected.label })}><CalendarClock size={15} />Timeline <small>{timelineCount.toLocaleString()}</small></a> : null}
        </div>
      </section>
      <section className="if-panel intelligence-graph-page__canvas" aria-label="Traversable linked intelligence graph"><Suspense fallback={<ControlAsyncState state="loading" title="Opening linked graph" message="Preparing the bounded relationship canvas." />}><LinkedIntelligenceGraph key={selected.id} index={state.index} rootId={selected.id} onRootChange={updateRoot} /></Suspense></section>
    </> : <ControlAsyncState state="empty" title="No linked entity available" message="Return to Organizations or Opportunities and choose a retained entity." action={<a className="if-btn if-btn--secondary" href="#/budget-spend/library"><Network size={15} />Open organizations</a>} />}
  </div>;
}
