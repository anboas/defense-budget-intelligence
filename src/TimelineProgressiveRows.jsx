import { useCallback, useEffect, useMemo, useRef, useState } from "react";

function requiredLimit(records, selectedId, batchSize) {
  if (!selectedId) return batchSize;
  const index = records.findIndex((record) => record.opportunityId === selectedId || record.lifecycleMembers?.some((member) => member.opportunityId === selectedId));
  return index < 0 ? batchSize : Math.max(batchSize, Math.ceil((index + 1) / batchSize) * batchSize);
}

export function useProgressiveTimelineRows(records, selectedId, batchSize) {
  const signature = useMemo(() => `${batchSize}:${records.map((record) => record.opportunityId).join("|")}`, [batchSize, records]);
  const selectedLimit = requiredLimit(records, selectedId, batchSize);
  const [state, setState] = useState(() => ({ signature, limit: selectedLimit }));
  const limit = Math.max(state.signature === signature ? state.limit : batchSize, selectedLimit);
  const visible = useMemo(() => records.slice(0, limit), [limit, records]);
  const visibleIds = useMemo(() => new Set(visible.map((record) => record.opportunityId)), [visible]);
  const loadMore = useCallback(() => setState((current) => ({ signature, limit: Math.min(records.length, Math.max(current.signature === signature ? current.limit : batchSize, selectedLimit) + batchSize) })), [batchSize, records.length, selectedLimit, signature]);
  const showAll = useCallback(() => setState({ signature, limit: records.length }), [records.length, signature]);
  return {
    visibleIds,
    rendered: visible.length,
    total: records.length,
    hasMore: visible.length < records.length,
    loadMore,
    showAll,
  };
}

export function TimelineProgressiveLoader({ rendered, total, batchSize, hasMore, onLoadMore, onShowAll }) {
  const sentinelRef = useRef(null);
  useEffect(() => {
    const sentinel = sentinelRef.current;
    const root = sentinel?.closest("[data-capture-timeline]");
    if (!sentinel || !root || !hasMore || typeof IntersectionObserver === "undefined") return undefined;
    const observer = new IntersectionObserver(([entry]) => { if (entry.isIntersecting) onLoadMore(); }, { root, rootMargin: "320px 0px", threshold: 0.01 });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, onLoadMore, rendered]);
  if (!total) return null;
  const nextCount = Math.min(batchSize, total - rendered);
  return <div ref={sentinelRef} className="if-table-footer capture-timeline__progress" data-timeline-progress><span role="status" aria-live="polite">Showing <strong>{rendered.toLocaleString()}</strong> of <strong>{total.toLocaleString()}</strong> timeline lines</span>{hasMore ? <span><button type="button" className="if-btn if-btn--secondary" onClick={onLoadMore}>Load next {nextCount.toLocaleString()}</button><button type="button" className="if-btn if-btn--secondary" onClick={onShowAll}>Show all</button></span> : <small>Complete filtered timeline loaded</small>}</div>;
}
