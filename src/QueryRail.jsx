import { Filter, MoreHorizontal, RotateCcw } from "lucide-react";
import { ControlAutocomplete, ControlPopover, ControlSearch } from "control-surface-ui/react";
import "./QueryRail.css";

/**
 * Canonical collection-surface controls.
 *
 * Search identifies the working set, Filters owns scope, the summary explains
 * the applied state, Results reports the outcome, and saved/utilities own the
 * remaining persistence and export actions. Route components provide data and
 * filter fields; this component owns their order and interaction grammar.
 */
export default function QueryRail({
  label,
  query = "",
  onQueryChange,
  searchItems = null,
  onSearchSelect,
  searchPlaceholder = "Search records…",
  searchEmptyText = "No matching records",
  searchProps = {},
  filters = null,
  filterAriaLabel = null,
  filterOwnerProps = {},
  filterWidth = 680,
  activeFilterCount = 0,
  activeFilterSummary = null,
  onClear,
  resultCount = 0,
  totalCount = resultCount,
  showTotal = false,
  resultNoun = "records",
  savedViews = null,
  utilities = null,
  className = "",
  children = null,
}) {
  const search = searchItems ? <ControlAutocomplete
    {...searchProps}
    className="query-rail__search"
    ariaLabel={`Search ${label}`}
    value={query}
    items={searchItems}
    minLength={1}
    limit={10}
    onChange={onQueryChange}
    onSelect={onSearchSelect}
    placeholder={searchPlaceholder}
    emptyText={searchEmptyText}
  /> : <ControlSearch
    {...searchProps}
    className="query-rail__search"
    ariaLabel={`Search ${label}`}
    value={query}
    onChange={onQueryChange}
    placeholder={searchPlaceholder}
  />;

  return <div className={`query-rail ${className}`.trim()} data-query-rail data-query-rail-label={label}>
    {search}
    {filters ? <ControlPopover
      {...filterOwnerProps}
      label={`Filters${activeFilterCount ? ` · ${activeFilterCount}` : ""}`}
      ariaLabel={filterAriaLabel || `Filter ${label}`}
      icon={<Filter size={14} aria-hidden="true" />}
      className="query-rail__filters"
      triggerClassName="if-btn if-btn--secondary"
      width={filterWidth}
      popoverProps={{ className: "query-rail__filter-popover" }}
    >
      <header className="query-rail__filter-header"><span><strong>Filter {label}</strong><small>{activeFilterCount ? `${activeFilterCount} active` : `All ${resultNoun}`}</small></span>{activeFilterCount && onClear ? <button type="button" className="if-btn if-btn--secondary if-btn--sm" onClick={onClear}><RotateCcw size={13} />Clear all</button> : null}</header>
      <div className="query-rail__filter-content">{filters}</div>
    </ControlPopover> : null}
    {activeFilterSummary ? <div className="query-rail__summary" aria-label="Applied filters">{activeFilterSummary}</div> : null}
    <div className="query-rail__results" aria-live="polite" style={{ minHeight: 34, alignItems: "center" }}><strong>{Number(resultCount).toLocaleString()}</strong><span>{!showTotal && resultCount === totalCount ? resultNoun : `of ${Number(totalCount).toLocaleString()} ${resultNoun}`}</span></div>
    <div className="query-rail__actions">
      {savedViews}
      {children}
      {utilities || null}
    </div>
  </div>;
}

export function QueryRailUtilities({ label = "More", ariaLabel = label, children, width = 300, className = "", popoverClassName = "" }) {
  return <ControlPopover
    label={label}
    ariaLabel={ariaLabel}
    icon={<MoreHorizontal size={14} aria-hidden="true" />}
    className={`query-rail__utilities ${className}`.trim()}
    triggerClassName="if-btn if-btn--secondary"
    width={width}
    popoverProps={{ className: `query-rail__utilities-popover ${popoverClassName}`.trim() }}
  >{children}</ControlPopover>;
}
