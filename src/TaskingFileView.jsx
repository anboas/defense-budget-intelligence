import { FileText, Search } from "lucide-react";
import { ControlStatusBadge } from "control-surface-ui/react";
import ControlSelect from "./ControlSelect.jsx";
import { formatTaskingBytes, formatTaskingDate } from "./tasking-file-analytics.js";
import "./TaskingFileView.css";

function statusTone(status) {
  if (["waiting", "changed"].includes(status)) return "warning";
  if (["current", "ready", "indexed", "parsed", "reviewed"].includes(status)) return "verified";
  return "neutral";
}

function FileMetric({ label, value, meta, tone = "neutral" }) {
  return <article className="tasking-file-metric" data-tone={tone}><span>{label}</span><strong>{value}</strong><small>{meta}</small></article>;
}

export default function TaskingFileView({ analytics, files, selectedId, onSelect, fileType, fileSort, onFilter }) {
  const reviewedPercent = analytics.totalFiles ? Math.round((analytics.reviewedFiles / analytics.totalFiles) * 100) : 0;
  return <section className="tasking-file-intelligence" aria-labelledby="tasking-file-intelligence-title">
    <header><div><span>Indexed source view</span><h3 id="tasking-file-intelligence-title">File intelligence</h3><p>Storage, freshness, review coverage, workspace placement, and actual task use remain separate signals.</p></div><strong>{files.length} of {analytics.totalFiles} files</strong></header>
    <section className="tasking-file-analytics" aria-label="File analytics summary">
      <div className="tasking-file-metrics">
        <FileMetric label="Files" value={analytics.totalFiles.toLocaleString("en-US")} meta={`${analytics.types.length} observed ${analytics.types.length === 1 ? "type" : "types"}`} />
        <FileMetric label="Stored size" value={formatTaskingBytes(analytics.totalBytes)} meta={`${analytics.filesWithSize} nonzero ${analytics.filesWithSize === 1 ? "size" : "sizes"}`} />
        <FileMetric label="Reviewed" value={`${reviewedPercent}%`} meta={`${analytics.reviewedFiles} of ${analytics.totalFiles} files`} tone={reviewedPercent === 100 ? "success" : "warning"} />
        <FileMetric label="Task related" value={analytics.taskLinkedFiles.toLocaleString("en-US")} meta={`${analytics.workspaceLinkedFiles} linked to workspace records`} tone={analytics.taskLinkedFiles ? "success" : "neutral"} />
      </div>
      <div className="tasking-file-distributions">
        <section aria-labelledby="tasking-file-types-title"><h4 id="tasking-file-types-title">Files and storage</h4><div className="tasking-file-bars">
          {analytics.types.map((type) => <button key={type.id} type="button" className={fileType === type.id ? "is-selected" : ""} aria-pressed={fileType === type.id} onClick={() => onFilter("taskingFileType", fileType === type.id ? "all" : type.id)}><strong>{type.label}</strong><small>{type.count} {type.count === 1 ? "file" : "files"} · {formatTaskingBytes(type.bytes)}</small></button>)}
        </div></section>
        <section aria-labelledby="tasking-file-recency-title"><h4 id="tasking-file-recency-title">Last modified</h4><div className="tasking-file-bars">
          {analytics.recency.map((bucket) => <div key={bucket.id}><strong>{bucket.label}</strong><small>{bucket.count} {bucket.count === 1 ? "file" : "files"}</small></div>)}
        </div></section>
      </div>
    </section>
    <section className="tasking-file-controls" aria-label="File inventory controls">
      <ControlSelect compact ariaLabel="File sort" value={fileSort} options={[["modified-desc", "Newest modified"], ["size-desc", "Largest size"], ["name-asc", "File name"]]} onChange={(value) => onFilter("taskingFileSort", value)} />
    </section>
    {files.length ? <div className="tasking-file-table" role="table" aria-label="Indexed file inventory">
      <div className="tasking-file-table__head" role="row"><span role="columnheader">File</span><span role="columnheader">Type</span><span role="columnheader">Size</span><span role="columnheader">Modified</span><span role="columnheader">Review</span><span role="columnheader">Task relation</span></div>
      {files.map((entry) => <button key={entry.id} type="button" role="row" data-tasking-file-row className={selectedId === entry.id ? "is-selected" : ""} onClick={() => onSelect(entry)}>
        <span role="cell"><FileText size={15} /><span><strong>{entry.name}</strong><small>{entry.path}</small></span></span>
        <span role="cell"><strong>{entry.fileType.label}</strong><small>{entry.fileType.extension ? `.${entry.fileType.extension}` : entry.mimeType || "Unknown"}</small></span>
        <span role="cell"><strong>{formatTaskingBytes(entry.size)}</strong><small>{Number(entry.size || 0).toLocaleString("en-US")} bytes reported</small></span>
        <span role="cell"><time dateTime={entry.lastModifiedAt || undefined}><strong>{entry.recency.label}</strong><small>{formatTaskingDate(entry.lastModifiedAt)}</small></time></span>
        <span role="cell"><ControlStatusBadge status={entry.reviewed ? "verified" : statusTone(entry.parseStatus)} label={(entry.parseStatus || "Not reviewed").replaceAll("-", " ")} /></span>
        <span role="cell"><strong>{entry.taskIds.length ? `${entry.taskIds.length} ${entry.taskIds.length === 1 ? "task" : "tasks"}` : entry.workspaceLinked ? "Workspace linked" : "Unlinked"}</strong><small>{entry.taskTitles.length ? entry.taskTitles.join(", ") : entry.workspaceLinked ? "No task yet" : "No reviewed relation"}</small></span>
      </button>)}
    </div> : <div className="tasking-empty"><Search size={20} /><strong>No files match</strong><span>Clear the search or file filters to restore the inventory.</span></div>}
  </section>;
}
