import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronsLeft, ChevronsRight, ChevronDown, ChevronLeft, ChevronRight, Columns3, Download, GripVertical, RotateCcw, Search, X } from "lucide-react";
import ControlSelect from "./ControlSelect.jsx";

const DENSITIES = {
  compact: "Compact",
  comfortable: "Comfortable",
  spacious: "Spacious",
};

function readPreferences(key, defaults) {
  if (!key || typeof window === "undefined") return defaults;
  try {
    const parsed = JSON.parse(window.localStorage.getItem(`dbi:data-table:${key}`) || "null");
    return parsed && typeof parsed === "object" ? { ...defaults, ...parsed } : defaults;
  } catch {
    return defaults;
  }
}

function useCompactTable(recordListAt, tableRef) {
  const [compact, setCompact] = useState(false);

  useEffect(() => {
    const table = tableRef.current;
    if (!table) return undefined;
    // Container queries evaluate the content box. clientWidth matches that box,
    // while getBoundingClientRect() also includes the table shell's borders.
    const update = () => setCompact(table.clientWidth <= recordListAt);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(table);
    return () => observer.disconnect();
  }, [recordListAt, tableRef]);

  return compact;
}

function searchableValue(value) {
  if (value == null) return "";
  if (Array.isArray(value)) return value.map(searchableValue).join(" ");
  if (typeof value === "object") return Object.values(value).map(searchableValue).join(" ");
  return String(value);
}

function csvCell(value) {
  return `"${searchableValue(value).replaceAll('"', '""')}"`;
}

function compareValues(left, right) {
  if (typeof left === "number" && typeof right === "number") return left - right;
  return searchableValue(left).localeCompare(searchableValue(right), undefined, { numeric: true, sensitivity: "base" });
}

function downloadCsv(filename, columns, rows) {
  const lines = [
    columns.map((column) => csvCell(column.label)).join(","),
    ...rows.map((row) => columns.map((column) => csvCell(column.exportValue?.(row) ?? column.value?.(row) ?? row[column.key])).join(",")),
  ];
  const blob = new Blob([`\ufeff${lines.join("\n")}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export default function OperationalDataTable({
  id,
  label,
  rows,
  columns,
  rowKey = (row) => row.id,
  defaultSort,
  defaultPageSize = 25,
  defaultMobilePageSize = 5,
  pageSizeOptions = [5, 10, 25, 50, 100],
  searchPlaceholder = "Filter rows…",
  empty = "No records match the current table controls.",
  exportFilename = `${id || "records"}.csv`,
  onRowActivate,
  renderDetail,
  initialExpandedId = null,
  selectable = true,
  toolbarActions = null,
  className = "",
  recordListAt = 720,
  wrapperProps = {},
  queryValue,
  onQueryChange,
  filterValues,
  onFilterChange,
  showSearch = true,
  showFacets = true,
  mobileColumns = null,
}) {
  const tableRef = useRef(null);
  const compactTable = useCompactTable(recordListAt, tableRef);
  const columnKeys = useMemo(() => columns.map((column) => column.key), [columns]);
  const defaults = useMemo(() => ({
    density: "compact",
    visible: columnKeys,
    order: columnKeys,
    widths: {},
    pageSize: defaultPageSize,
    mobilePageSize: defaultMobilePageSize,
  }), [columnKeys, defaultMobilePageSize, defaultPageSize]);
  const [preferences, setPreferences] = useState(() => readPreferences(id, defaults));
  const [internalQuery, setInternalQuery] = useState("");
  const [internalFilters, setInternalFilters] = useState({});
  const [sort, setSort] = useState(defaultSort || { key: columns.find((column) => column.sortable !== false)?.key, direction: "asc" });
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState(() => new Set());
  const [expandedId, setExpandedId] = useState(initialExpandedId);
  const [draggingKey, setDraggingKey] = useState("");
  const resizeRef = useRef(null);
  const columnsRef = useRef(null);
  const query = queryValue ?? internalQuery;
  const setQuery = onQueryChange ?? setInternalQuery;
  const filters = filterValues ?? internalFilters;
  const setFilters = onFilterChange ?? setInternalFilters;

  const orderedKeys = useMemo(() => {
    const saved = Array.isArray(preferences.order) ? preferences.order.filter((key) => columnKeys.includes(key)) : [];
    return [...new Set([...saved, ...columnKeys])];
  }, [columnKeys, preferences.order]);
  const visibleKeys = useMemo(() => {
    const saved = Array.isArray(preferences.visible) ? preferences.visible.filter((key) => columnKeys.includes(key)) : [];
    const required = columns.filter((column) => column.required).map((column) => column.key);
    const enabled = new Set([...required, ...saved]);
    return orderedKeys.filter((key) => enabled.has(key));
  }, [columnKeys, columns, orderedKeys, preferences.visible]);
  const columnByKey = useMemo(() => new Map(columns.map((column) => [column.key, column])), [columns]);
  const visibleColumns = visibleKeys.map((key) => columnByKey.get(key)).filter(Boolean);
  const widths = useMemo(() => preferences.widths && typeof preferences.widths === "object" ? preferences.widths : {}, [preferences.widths]);
  const density = DENSITIES[preferences.density] ? preferences.density : "compact";
  const desktopPageSizes = pageSizeOptions.length ? pageSizeOptions : [defaultPageSize];
  const mobilePageSizes = desktopPageSizes.filter((value) => value <= 10);
  const availablePageSizes = compactTable && mobilePageSizes.length ? mobilePageSizes : desktopPageSizes;
  const preferredPageSize = Number(compactTable ? preferences.mobilePageSize : preferences.pageSize);
  const pageSize = availablePageSizes.includes(preferredPageSize)
    ? preferredPageSize
    : compactTable ? availablePageSizes[0] : defaultPageSize;

  useEffect(() => {
    if (!id || typeof window === "undefined") return;
    window.localStorage.setItem(`dbi:data-table:${id}`, JSON.stringify({
      density,
      visible: visibleKeys,
      order: orderedKeys,
      widths,
      pageSize: Number(preferences.pageSize) || defaultPageSize,
      mobilePageSize: Number(preferences.mobilePageSize) || defaultMobilePageSize,
    }));
  }, [defaultMobilePageSize, defaultPageSize, density, id, orderedKeys, preferences.mobilePageSize, preferences.pageSize, visibleKeys, widths]);

  useEffect(() => {
    const closeOnOutside = (event) => {
      if (columnsRef.current?.open && !columnsRef.current.contains(event.target)) columnsRef.current.open = false;
    };
    const closeOnEscape = (event) => {
      if (event.key === "Escape" && columnsRef.current?.open) {
        columnsRef.current.open = false;
        columnsRef.current.querySelector("summary")?.focus();
      }
    };
    document.addEventListener("pointerdown", closeOnOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, []);

  const facetColumns = columns.filter((column) => column.facet);
  const facetOptions = useMemo(() => Object.fromEntries(facetColumns.map((column) => {
    const values = [...new Set(rows.map((row) => searchableValue(column.filterValue?.(row) ?? column.value?.(row) ?? row[column.key])).filter(Boolean))];
    return [column.key, values.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))];
  })), [facetColumns, rows]);

  const filteredRows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return rows.filter((row) => {
      if (needle) {
        const haystack = columns.map((column) => searchableValue(column.searchValue?.(row) ?? column.value?.(row) ?? row[column.key])).join(" ").toLowerCase();
        if (!haystack.includes(needle)) return false;
      }
      return Object.entries(filters).every(([key, value]) => {
        if (!value) return true;
        const column = columns.find((candidate) => candidate.key === key);
        return searchableValue(column?.filterValue?.(row) ?? column?.value?.(row) ?? row[key]) === value;
      });
    });
  }, [columns, filters, query, rows]);

  const sortedRows = useMemo(() => {
    const column = columns.find((candidate) => candidate.key === sort.key);
    if (!column) return filteredRows;
    const direction = sort.direction === "desc" ? -1 : 1;
    return [...filteredRows].sort((left, right) => compareValues(
      column.sortValue?.(left) ?? column.value?.(left) ?? left[column.key],
      column.sortValue?.(right) ?? column.value?.(right) ?? right[column.key],
    ) * direction);
  }, [columns, filteredRows, sort]);

  const pages = Math.max(1, Math.ceil(sortedRows.length / pageSize));
  const safePage = Math.min(page, pages);
  const start = (safePage - 1) * pageSize;
  const pageRows = sortedRows.slice(start, start + pageSize);
  const selectedRows = sortedRows.filter((row) => selected.has(String(rowKey(row))));
  const pageKeys = pageRows.map((row) => String(rowKey(row)));
  const pageSelected = pageKeys.length > 0 && pageKeys.every((key) => selected.has(key));

  function toggleSort(key) {
    setSort((current) => current.key === key
      ? { key, direction: current.direction === "asc" ? "desc" : "asc" }
      : { key, direction: "asc" });
  }

  function toggleColumn(key) {
    const column = columns.find((candidate) => candidate.key === key);
    if (column?.required) return;
    setPreferences((current) => {
      const currentKeys = Array.isArray(current.visible) ? current.visible : columnKeys;
      const next = currentKeys.includes(key) ? currentKeys.filter((item) => item !== key) : [...currentKeys, key];
      return { ...current, visible: next.length ? next : [columns[0].key] };
    });
  }

  function moveColumn(key, direction) {
    setPreferences((current) => {
      const order = [...orderedKeys];
      const from = order.indexOf(key);
      const to = Math.max(0, Math.min(order.length - 1, from + direction));
      if (from < 0 || from === to) return current;
      order.splice(to, 0, order.splice(from, 1)[0]);
      return { ...current, order };
    });
  }

  function dropColumn(targetKey) {
    if (!draggingKey || draggingKey === targetKey) return setDraggingKey("");
    setPreferences((current) => {
      const order = [...orderedKeys];
      const from = order.indexOf(draggingKey);
      const to = order.indexOf(targetKey);
      if (from < 0 || to < 0) return current;
      order.splice(to, 0, order.splice(from, 1)[0]);
      return { ...current, order };
    });
    setDraggingKey("");
  }

  function setColumnWidth(key, nextWidth) {
    setPreferences((current) => ({ ...current, widths: { ...(current.widths || {}), [key]: Math.max(90, Math.min(720, Math.round(nextWidth))) } }));
  }

  function beginResize(event, column) {
    event.preventDefault();
    event.stopPropagation();
    const header = event.currentTarget.closest("th");
    resizeRef.current = { key: column.key, startX: event.clientX, startWidth: header?.getBoundingClientRect().width || widths[column.key] || column.width || column.minWidth || 160 };
    document.body.classList.add("is-resizing-data-table");
    const move = (moveEvent) => {
      if (!resizeRef.current) return;
      setColumnWidth(resizeRef.current.key, resizeRef.current.startWidth + moveEvent.clientX - resizeRef.current.startX);
    };
    const stop = () => {
      resizeRef.current = null;
      document.body.classList.remove("is-resizing-data-table");
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop, { once: true });
  }

  function resetColumnWidth(key) {
    setPreferences((current) => {
      const next = { ...(current.widths || {}) };
      delete next[key];
      return { ...current, widths: next };
    });
  }

  function resetLayout() {
    setPreferences(defaults);
    setPage(1);
  }

  function togglePageSelection() {
    setSelected((current) => {
      const next = new Set(current);
      if (pageSelected) pageKeys.forEach((key) => next.delete(key));
      else pageKeys.forEach((key) => next.add(key));
      return next;
    });
  }

  function toggleRowSelection(key) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function activateRow(row) {
    const key = String(rowKey(row));
    if (renderDetail) setExpandedId((current) => current === key ? null : key);
    onRowActivate?.(row);
  }

  const activeFilterCount = Object.values(filters).filter(Boolean).length;
  return (
    <section
      {...wrapperProps}
      ref={tableRef}
      className={`if-data-table dbi-data-table ${className}`.trim()}
      data-if-data-table
      data-dbi-data-table={id}
      data-if-table-density={density}
      data-if-table-selectable={selectable ? "true" : "false"}
      data-table-layout={compactTable ? "cards" : "table"}
      style={{ "--dbi-table-card-breakpoint": `${recordListAt}px` }}
    >
      <div className="if-table-toolbar dbi-data-table__toolbar">
        <div className="dbi-data-table__status" aria-live="polite">
          <strong>{filteredRows.length.toLocaleString()}</strong><span>of {rows.length.toLocaleString()} records</span>
          {selected.size ? <b>{selected.size.toLocaleString()} selected</b> : null}
        </div>
        {showSearch ? <label className="if-search dbi-data-table__search">
          <Search size={15} aria-hidden="true" />
          <span className="sr-only">Search {label}</span>
          <input className="if-input" type="search" value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} placeholder={searchPlaceholder} />
          {query ? <button type="button" onClick={() => { setQuery(""); setPage(1); }} aria-label="Clear table search"><X size={14} /></button> : null}
        </label> : <div className="dbi-data-table__toolbar-spacer" aria-hidden="true" />}
        <div className="dbi-data-table__tools">
          {toolbarActions}
          <div className="dbi-data-table__density"><span className="sr-only">Table density</span><ControlSelect compact ariaLabel="Table density" value={density} options={Object.entries(DENSITIES)} onChange={(nextDensity) => { setPreferences((current) => ({ ...current, density: nextDensity })); setPage(1); }} /></div>
          <details ref={columnsRef} className="dbi-data-table__columns"><summary className="if-btn if-btn--secondary"><Columns3 size={15} /><span>Columns</span><ChevronDown size={13} /></summary><div><header><strong>Table layout</strong><button type="button" onClick={resetLayout}><RotateCcw size={13} />Reset</button></header>{orderedKeys.map((key, index) => { const column = columnByKey.get(key); return <div className="dbi-data-table__column-option" key={key}><label><input type="checkbox" checked={visibleKeys.includes(key)} disabled={column.required} onChange={() => toggleColumn(key)} /><span>{column.label}</span></label><span className="dbi-data-table__column-order"><button type="button" onClick={() => moveColumn(key, -1)} disabled={index === 0} aria-label={`Move ${column.label} left`}><ChevronLeft size={13} /></button><button type="button" onClick={() => moveColumn(key, 1)} disabled={index === orderedKeys.length - 1} aria-label={`Move ${column.label} right`}><ChevronRight size={13} /></button></span></div>; })}</div></details>
          <button className="if-btn if-btn--secondary" type="button" onClick={() => downloadCsv(exportFilename, visibleColumns, selectedRows.length ? selectedRows : sortedRows)}><Download size={15} /><span>Export{selectedRows.length ? ` ${selectedRows.length}` : ""}</span></button>
        </div>
      </div>
      {showFacets && facetColumns.length ? <div className="dbi-data-table__filters" data-table-filters>{facetColumns.map((column) => <div className="dbi-data-table__filter" key={column.key}><span>{column.label}</span><ControlSelect compact ariaLabel={`${column.label} filter`} value={filters[column.key] || ""} options={[["", "All"], ...facetOptions[column.key].map((value) => [value, value])]} onChange={(nextValue) => { setFilters((current) => ({ ...current, [column.key]: nextValue })); setPage(1); }} /></div>)}{activeFilterCount ? <button type="button" className="if-btn if-btn--secondary" onClick={() => { setFilters({}); setPage(1); }}>Clear {activeFilterCount}</button> : null}</div> : null}
      {selected.size ? <div className="dbi-data-table__bulk" data-if-table-bulk><span><strong>{selected.size}</strong> selected across this table</span><button type="button" onClick={() => setSelected(new Set())}>Clear selection</button></div> : null}
      <div className="if-table-wrap dbi-data-table__wrap">
        <table className={`if-table if-table--${density}`} aria-label={label}>
          <colgroup>{selectable ? <col style={{ width: 38 }} /> : null}{visibleColumns.map((column) => <col key={column.key} style={{ width: widths[column.key] || column.width || column.minWidth }} />)}</colgroup>
          <thead><tr>{selectable ? <th scope="col" className="dbi-data-table__select" data-if-table-pin="left"><label className="dbi-data-table__check"><input type="checkbox" checked={pageSelected} onChange={togglePageSelection} aria-label="Select all rows on this page" /></label></th> : null}{visibleColumns.map((column) => <th scope="col" key={column.key} data-column-key={column.key} data-table-column-role={column.role} data-table-column-dragging={draggingKey === column.key ? "true" : "false"} className={column.sticky ? "is-sticky" : ""} style={{ minWidth: widths[column.key] || column.minWidth, width: widths[column.key] || column.width, textAlign: column.align }} aria-sort={column.sortable === false ? undefined : sort.key === column.key ? (sort.direction === "asc" ? "ascending" : "descending") : "none"} onDragOver={(event) => event.preventDefault()} onDrop={() => dropColumn(column.key)}><span className="dbi-data-table__header"><button type="button" className="dbi-data-table__reorder" draggable onDragStart={() => setDraggingKey(column.key)} onDragEnd={() => setDraggingKey("")} aria-label={`Drag to reorder ${column.label}`}><GripVertical size={13} /></button><button type="button" className="if-table__sort" onClick={() => column.sortable === false ? null : toggleSort(column.key)} disabled={column.sortable === false}>{column.label}{column.sortable === false ? null : <span>{sort.key === column.key ? (sort.direction === "asc" ? "▲" : "▼") : "↕"}</span>}</button><span role="separator" tabIndex={0} aria-orientation="vertical" aria-label={`Resize ${column.label} column`} className="dbi-data-table__resizer" onPointerDown={(event) => beginResize(event, column)} onDoubleClick={() => resetColumnWidth(column.key)} onKeyDown={(event) => { if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return; event.preventDefault(); const current = widths[column.key] || event.currentTarget.closest("th")?.getBoundingClientRect().width || column.width || column.minWidth || 160; setColumnWidth(column.key, current + (event.key === "ArrowLeft" ? -16 : 16)); }} /></span></th>)}</tr></thead>
          <tbody>{pageRows.length ? pageRows.flatMap((row, index) => {
            const key = String(rowKey(row));
            const expanded = expandedId === key;
            const cells = visibleColumns.map((column) => <td key={`${key}-${column.key}`} data-ui-table-card-label={column.label} data-ui-table-cell-role={column.role || "data"} data-table-mobile-visible={!mobileColumns || mobileColumns.includes(column.key) ? "true" : "false"} className={column.sticky ? "is-sticky" : ""} style={{ textAlign: column.align }}>{column.render ? column.render(row) : searchableValue(column.value?.(row) ?? row[column.key]) || "—"}</td>);
            return [<tr
              key={key}
              data-if-table-row
              data-row-key={key}
              data-row-index={start + index}
              data-row-expandable={renderDetail ? "true" : undefined}
              className={`${selected.has(key) ? "is-selected " : ""}${expanded ? "is-expanded" : ""}`.trim()}
              tabIndex={renderDetail ? 0 : undefined}
              aria-expanded={renderDetail ? expanded : undefined}
              onClick={(event) => { if (renderDetail && !event.target.closest("a,button,input,select,textarea,label")) activateRow(row); }}
              onKeyDown={(event) => { if (renderDetail && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); activateRow(row); } }}
            >{selectable ? <td className="dbi-data-table__select" data-ui-table-card-label="Select"><label className="dbi-data-table__check"><input type="checkbox" checked={selected.has(key)} onChange={() => toggleRowSelection(key)} aria-label={`Select ${searchableValue(columns[0].value?.(row) ?? row[columns[0].key])}`} /></label></td> : null}{cells}</tr>, renderDetail && expanded ? <tr key={`${key}-detail`} className="if-table-detail" data-if-table-detail><td colSpan={visibleColumns.length + (selectable ? 1 : 0)}>{renderDetail(row)}</td></tr> : null];
          }) : <tr data-if-table-empty><td colSpan={visibleColumns.length + (selectable ? 1 : 0)}><div className="dbi-data-table__empty">{empty}</div></td></tr>}</tbody>
        </table>
      </div>
      <footer className="if-table-footer dbi-data-table__footer"><span>Showing <strong>{filteredRows.length ? start + 1 : 0}</strong>–<strong>{Math.min(start + pageSize, filteredRows.length)}</strong> of <strong>{filteredRows.length}</strong></span><nav className="if-pagination" aria-label={`${label} pagination`}><button className="if-page-btn dbi-page-edge" type="button" onClick={() => setPage(1)} disabled={safePage <= 1} aria-label="First table page"><ChevronsLeft size={15} /></button><button className="if-page-btn" type="button" onClick={() => setPage((value) => Math.max(1, value - 1))} disabled={safePage <= 1} aria-label="Previous table page"><ChevronLeft size={15} /></button><span>Page {safePage} of {pages}</span><button className="if-page-btn" type="button" onClick={() => setPage((value) => Math.min(pages, value + 1))} disabled={safePage >= pages} aria-label="Next table page"><ChevronRight size={15} /></button><button className="if-page-btn dbi-page-edge" type="button" onClick={() => setPage(pages)} disabled={safePage >= pages} aria-label="Last table page"><ChevronsRight size={15} /></button><ControlSelect compact className="dbi-data-table__page-size" value={String(pageSize)} options={availablePageSizes.map((value) => [String(value), `${value} / page`])} onChange={(nextValue) => { const key = compactTable ? "mobilePageSize" : "pageSize"; setPreferences((current) => ({ ...current, [key]: Number(nextValue) })); setPage(1); }} ariaLabel="Rows per page" /></nav></footer>
    </section>
  );
}
