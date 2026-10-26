import { useMemo, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  File,
  FileCode2,
  FileSpreadsheet,
  FileText,
  Folder,
  FolderOpen,
  Search,
} from "lucide-react";
import ControlSelect from "./ControlSelect.jsx";
import {
  formatTaskingBytes,
  formatTaskingDate,
} from "./tasking-file-analytics.js";
import {
  buildTaskingSourceTree,
  flattenSourceTree,
  sourceAncestors,
} from "./tasking-workspace-support.js";
import "./TaskingSourceExplorer.css";

const TYPE_OPTIONS = [
  ["all", "All types"],
  ["word", "Word"],
  ["spreadsheet", "Spreadsheet"],
  ["pdf", "PDF"],
  ["markdown", "Markdown"],
  ["other", "Other"],
];

function fileKind(item) {
  const value = `${item.name || ""} ${item.mimeType || ""}`.toLowerCase();
  if (/\.docx?\b|wordprocessingml|msword/.test(value))
    return { id: "word", label: "Word", Icon: FileText };
  if (/\.xlsx?\b|spreadsheetml|excel/.test(value))
    return { id: "spreadsheet", label: "Spreadsheet", Icon: FileSpreadsheet };
  if (/\.pdf\b|application\/pdf/.test(value))
    return { id: "pdf", label: "PDF", Icon: FileText };
  if (/\.md\b|markdown/.test(value))
    return { id: "markdown", label: "Markdown", Icon: FileCode2 };
  return { id: "other", label: "File", Icon: File };
}

function workstreamFor(item, anchorsById, workstreamsById) {
  const anchor = anchorsById.get(item.recordId);
  return anchor ? workstreamsById.get(anchor.workstreamId) : null;
}

function SourceBadge({ item, anchorsById, workstreamsById }) {
  const stream = workstreamFor(item, anchorsById, workstreamsById);
  return stream ? (
    <span className="tasking-source-pill" title={stream.name}>
      {stream.shortName}
    </span>
  ) : null;
}

function SourceRow({
  item,
  depth,
  selectedId,
  expandedIds,
  onToggle,
  onSelect,
  anchorsById,
  workstreamsById,
}) {
  const folder = item.kind === "folder";
  const expanded = expandedIds.has(item.id);
  const type = folder
    ? { id: "folder", label: "Folder", Icon: expanded ? FolderOpen : Folder }
    : fileKind(item);
  const Icon = type.Icon;
  return (
    <>
      <div
        className={`tasking-source-row${selectedId === item.id ? " is-selected" : ""}`}
        style={{ "--source-depth": depth }}
        data-source-kind={type.id}
      >
        {folder ? (
          <button
            type="button"
            className="tasking-source-toggle"
            onClick={() => onToggle(item.id)}
            aria-expanded={expanded}
            aria-label={`${expanded ? "Collapse" : "Expand"} ${item.name}`}
          >
            {expanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
          </button>
        ) : (
          <span className="tasking-source-spacer" />
        )}
        <button
          type="button"
          className="tasking-source-select"
          onClick={() => (folder ? onToggle(item.id) : onSelect(item))}
          aria-current={selectedId === item.id ? "true" : undefined}
        >
          <span className="tasking-source-icon" data-file-kind={type.id}>
            <Icon size={16} />
            <small>{folder ? "DIR" : type.label}</small>
          </span>
          <span className="tasking-source-copy">
            <strong>{item.name}</strong>
            <small>
              {folder
                ? `${item.children?.length || 0} immediate items`
                : `${formatTaskingBytes(item.size)} · ${formatTaskingDate(item.lastModifiedAt)}`}
            </small>
          </span>
          <span className="tasking-source-tags">
            <SourceBadge
              item={item}
              anchorsById={anchorsById}
              workstreamsById={workstreamsById}
            />
            {!folder && item.parseStatus ? (
              <span className="tasking-source-state">{item.parseStatus}</span>
            ) : null}
          </span>
        </button>
      </div>
      {folder ? (
        <div className={`tasking-source-children${expanded ? " is-open" : ""}`}>
          <div>
            {item.children?.map((child) => (
              <SourceRow
                key={child.id}
                item={child}
                depth={depth + 1}
                selectedId={selectedId}
                expandedIds={expandedIds}
                onToggle={onToggle}
                onSelect={onSelect}
                anchorsById={anchorsById}
                workstreamsById={workstreamsById}
              />
            ))}
          </div>
        </div>
      ) : null}
    </>
  );
}

function SearchResult({
  item,
  selectedId,
  onSelect,
  anchorsById,
  workstreamsById,
}) {
  const type = fileKind(item);
  const Icon = type.Icon;
  return (
    <button
      type="button"
      className={`tasking-source-result${selectedId === item.id ? " is-selected" : ""}`}
      onClick={() => onSelect(item)}
    >
      <span className="tasking-source-icon" data-file-kind={type.id}>
        <Icon size={16} />
        <small>{type.label}</small>
      </span>
      <span className="tasking-source-copy">
        <strong>{item.name}</strong>
        <small>{item.path}</small>
      </span>
      <span className="tasking-source-tags">
        <SourceBadge
          item={item}
          anchorsById={anchorsById}
          workstreamsById={workstreamsById}
        />
        <span>{formatTaskingBytes(item.size)}</span>
      </span>
    </button>
  );
}

export default function TaskingSourceExplorer({
  sourceItems = [],
  anchors = [],
  workstreams = [],
  selectedId = "",
  onSelect,
}) {
  const roots = useMemo(
    () => buildTaskingSourceTree(sourceItems),
    [sourceItems],
  );
  const flat = useMemo(() => flattenSourceTree(roots), [roots]);
  const files = useMemo(
    () => flat.filter((item) => item.kind === "file"),
    [flat],
  );
  const [expandedIds, setExpandedIds] = useState(() => new Set());
  const [query, setQuery] = useState("");
  const [type, setType] = useState("all");
  const [relation, setRelation] = useState("all");
  const [sort, setSort] = useState("name");
  const anchorsById = useMemo(
    () => new Map(anchors.map((item) => [item.id, item])),
    [anchors],
  );
  const workstreamsById = useMemo(
    () => new Map(workstreams.map((item) => [item.id, item])),
    [workstreams],
  );

  const effectiveExpandedIds = useMemo(
    () => new Set([...expandedIds, ...sourceAncestors(roots, selectedId)]),
    [expandedIds, roots, selectedId],
  );

  const results = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    const filtered = files.filter((item) => {
      const kind = fileKind(item).id;
      const linked = Boolean(workstreamFor(item, anchorsById, workstreamsById));
      return (
        (!normalized ||
          `${item.name} ${item.path} ${item.summary || ""}`
            .toLowerCase()
            .includes(normalized)) &&
        (type === "all" || kind === type) &&
        (relation === "all" || (relation === "linked" ? linked : !linked))
      );
    });
    return filtered.sort((a, b) =>
      sort === "newest"
        ? String(b.lastModifiedAt || "").localeCompare(
            String(a.lastModifiedAt || ""),
          )
        : sort === "largest"
          ? (b.size || 0) - (a.size || 0)
          : a.name.localeCompare(b.name),
    );
  }, [anchorsById, files, query, relation, sort, type, workstreamsById]);

  function toggle(id) {
    setExpandedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  const searching = Boolean(
    query.trim() || type !== "all" || relation !== "all" || sort !== "name",
  );

  return (
    <section className="tasking-source-explorer" data-tasking-source-explorer>
      <header className="tasking-source-toolbar">
        <label className="tasking-source-search">
          <Search size={15} />
          <span className="sr-only">Search source files</span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search files and paths…"
          />
        </label>
        <ControlSelect
          compact
          ariaLabel="Source file type"
          value={type}
          options={TYPE_OPTIONS}
          onChange={setType}
        />
        <ControlSelect
          compact
          ariaLabel="Workstream relation"
          value={relation}
          options={[
            ["all", "All placements"],
            ["linked", "Workstream linked"],
            ["unlinked", "Unlinked"],
          ]}
          onChange={setRelation}
        />
        <ControlSelect
          compact
          ariaLabel="Source sort"
          value={sort}
          options={[
            ["name", "Name"],
            ["newest", "Newest"],
            ["largest", "Largest"],
          ]}
          onChange={setSort}
        />
      </header>
      <div
        className="tasking-source-browser"
        role="tree"
        aria-label="Source structure"
      >
        {searching ? (
          <>
            <div className="tasking-source-results-meta">
              <strong>{results.length} matching files</strong>
              <span>Search results are flat so the tree does not jump.</span>
            </div>
            {results.slice(0, 100).map((item) => (
              <SearchResult
                key={item.id}
                item={item}
                selectedId={selectedId}
                onSelect={onSelect}
                anchorsById={anchorsById}
                workstreamsById={workstreamsById}
              />
            ))}
            {!results.length ? (
              <p className="tasking-source-empty">
                No files match these filters.
              </p>
            ) : null}
          </>
        ) : roots.length ? (
          roots.map((item) => (
            <SourceRow
              key={item.id}
              item={item}
              depth={0}
              selectedId={selectedId}
              expandedIds={effectiveExpandedIds}
              onToggle={toggle}
              onSelect={onSelect}
              anchorsById={anchorsById}
              workstreamsById={workstreamsById}
            />
          ))
        ) : (
          <p className="tasking-source-empty">
            No source metadata is connected yet.
          </p>
        )}
      </div>
      <footer>
        <span>{sourceItems.length} indexed items</span>
        <span>{files.length} files</span>
        <span>Folders start collapsed. Originals remain read only.</span>
      </footer>
    </section>
  );
}
