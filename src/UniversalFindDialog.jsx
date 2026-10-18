import { useEffect, useMemo, useRef, useState } from "react";
import { Clock3, Pin, Search } from "lucide-react";
import { ControlAsyncState, ControlAutocomplete, ControlDialog } from "control-surface-ui/react";
import { intelligenceWorkspaceRoute } from "./cross-surface-routes.js";
import { readPinnedIntelligence, readRecentIntelligence, rememberIntelligence } from "./intelligence-history.js";
import { intelligenceTypeLabel, loadIntelligenceSearchIndex } from "./intelligence-search.js";
import "./UniversalFindDialog.css";

function suggestion(item) {
  return {
    id: `${item.entityType}:${item.id}`,
    value: item.label,
    label: item.label,
    meta: item.facts?.slice(0, 3).join(" · ") || item.sourceArtifact,
    type: intelligenceTypeLabel(item.entityType),
    entity: item,
  };
}

export default function UniversalFindDialog({ open, onClose }) {
  const dialogRef = useRef(null);
  const [query, setQuery] = useState("");
  const [state, setState] = useState({ status: "loading", items: [] });
  const [attempt, setAttempt] = useState(0);
  const [historyRevision, setHistoryRevision] = useState(0);
  useEffect(() => {
    if (!open) return;
    let active = true;
    loadIntelligenceSearchIndex()
      .then((payload) => { if (active) setState({ status: "ready", items: payload.items || [], metadata: payload.metadata }); })
      .catch((error) => { if (active) setState({ status: "error", items: [], error }); });
    return () => { active = false; };
  }, [attempt, open]);
  useEffect(() => {
    const refresh = () => setHistoryRevision((value) => value + 1);
    window.addEventListener("dbi:intelligence-history", refresh);
    return () => window.removeEventListener("dbi:intelligence-history", refresh);
  }, []);
  void historyRevision;
  const items = useMemo(() => state.items.map(suggestion), [state.items]);
  const pinned = readPinnedIntelligence();
  const recent = readRecentIntelligence().filter((item) => !pinned.some((candidate) => candidate.id === item.id && candidate.entityType === item.entityType));

  function openEntity(item) {
    const entity = item.entity || item;
    rememberIntelligence(entity);
    const returnTo = window.location.hash || "#/budget-spend/watchlist";
    window.location.assign(intelligenceWorkspaceRoute({ entityType: entity.entityType, entityId: entity.id, tab: "overview", returnTo, origin: "find" }));
    onClose();
  }

  const historyGroup = (label, icon, entries) => entries.length ? <section className="universal-find__history"><header>{icon}<strong>{label}</strong></header><div>{entries.slice(0, 6).map((item) => <button type="button" key={`${item.entityType}:${item.id}`} onClick={() => openEntity(item)}><span><strong>{item.label}</strong><small>{intelligenceTypeLabel(item.entityType)}{item.facts?.length ? ` · ${item.facts.slice(0, 2).join(" · ")}` : ""}</small></span><span aria-hidden="true">→</span></button>)}</div></section> : null;

  return <ControlDialog open={open} onClose={onClose} title="Find intelligence" eyebrow="One search · every retained entity" summary="Open the canonical workspace for an opportunity, customer, office, person, program, vehicle, award, account, classification, or location." size="wide" dialogRef={dialogRef} closeLabel="Close intelligence search" surfaceProps={{ "data-universal-find-dialog": true }}>
    <div className="universal-find">
      {state.status === "loading" ? <ControlAsyncState compact state="loading" title="Preparing intelligence search" message="Loading the bounded entity index on demand." /> : null}
      {state.status === "error" ? <ControlAsyncState compact state="error" title="Intelligence search unavailable" message={state.error?.message || "The bounded entity index could not be loaded."} action={<button type="button" className="if-btn if-btn--secondary" onClick={() => { setState({ status: "loading", items: [] }); setAttempt((value) => value + 1); }}>Retry</button>} /> : null}
      {state.status === "ready" ? <><ControlAutocomplete autoFocus label="Find anything" value={query} items={items} minLength={1} limit={12} onChange={setQuery} onSelect={openEntity} placeholder="Opportunity, customer, person, program, vehicle, award, account, location…" emptyText="No retained entity matches" ariaLabel="Find intelligence" data-universal-find-autocomplete /><p className="universal-find__coverage"><Search size={14} />{Number(state.metadata?.resultCount || items.length).toLocaleString()} retained entities · search loads only when requested</p>{!query ? <div className="universal-find__history-grid">{historyGroup("Pinned", <Pin size={15} />, pinned)}{historyGroup("Recent", <Clock3 size={15} />, recent)}</div> : null}</> : null}
    </div>
  </ControlDialog>;
}
