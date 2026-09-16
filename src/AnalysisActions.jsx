import { useState } from "react";
import { Bookmark, Copy, Download } from "lucide-react";

function csvCell(value) {
  const normalized = value && typeof value === "object" ? JSON.stringify(value) : String(value ?? "");
  return `"${normalized.replace(/"/g, '""')}"`;
}

function auditedRows(rows, sourceUrlForRow, metadata) {
  const viewUrl = window.location.href;
  return (rows || []).map((row) => ({
    _snapshot_generated_at: metadata.snapshotGeneratedAt || "",
    _exported_at: new Date().toISOString(),
    _view_url: viewUrl,
    _source_url: sourceUrlForRow?.(row) || "",
    ...row,
  }));
}

function downloadRows(rows, filename, format, sourceUrlForRow, metadata) {
  const safeRows = rows || [];
  const exportRows = auditedRows(safeRows, sourceUrlForRow, metadata);
  let body;
  let type;
  if (format === "json") {
    body = JSON.stringify({
      metadata: {
        exportedAt: new Date().toISOString(),
        snapshotGeneratedAt: metadata.snapshotGeneratedAt || "",
        viewUrl: window.location.href,
        methodology: metadata.methodology || "",
        rowCount: safeRows.length,
      },
      rows: exportRows,
    }, null, 2);
    type = "application/json";
  } else {
    const columns = [...new Set(exportRows.flatMap((row) => Object.keys(row || {})))];
    body = [columns.map(csvCell).join(","), ...exportRows.map((row) => columns.map((column) => csvCell(row?.[column])).join(","))].join("\n");
    type = "text/csv";
  }
  const url = URL.createObjectURL(new Blob([body], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `${filename}.${format}`;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 60000);
}

async function copyText(value) {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(value);
  const field = document.createElement("textarea");
  field.value = value;
  field.style.position = "fixed";
  field.style.opacity = "0";
  document.body.append(field);
  field.select();
  document.execCommand("copy");
  field.remove();
}

export default function AnalysisActions({
  rows = [],
  filename = "budget-analysis",
  copyValue = "",
  copyLabel = "Copy view",
  sourceUrlForRow,
  exportMetadata = {},
}) {
  const [message, setMessage] = useState("");
  const [watchedUrls, setWatchedUrls] = useState(() => JSON.parse(localStorage.getItem("budget-intelligence-watches") || "[]").map((watch) => watch.url));
  const watched = watchedUrls.includes(window.location.href);
  async function handleCopy() {
    await copyText(copyValue || window.location.href);
    setMessage("Copied");
    window.setTimeout(() => setMessage(""), 1600);
  }
  function handleWatch() {
    const watches = JSON.parse(localStorage.getItem("budget-intelligence-watches") || "[]");
    const currentUrl = window.location.href;
    const next = watched
      ? watches.filter((watch) => watch.url !== currentUrl)
      : [...watches.filter((watch) => watch.url !== currentUrl), { url: currentUrl, label: document.title.split(" · ")[0], createdAt: new Date().toISOString() }].slice(-12);
    localStorage.setItem("budget-intelligence-watches", JSON.stringify(next));
    setWatchedUrls(next.map((watch) => watch.url));
    setMessage(watched ? "Saved view removed" : "View saved");
    window.setTimeout(() => setMessage(""), 1600);
  }
  return (
    <div className="analysis-actions" data-analysis-actions>
      <button type="button" onClick={handleCopy}><Copy size={14} aria-hidden="true" />{copyLabel}</button>
      <button type="button" onClick={handleWatch} aria-pressed={watched}><Bookmark size={14} aria-hidden="true" />{watched ? "Saved" : "Save view"}</button>
      <button type="button" onClick={() => downloadRows(rows, filename, "csv", sourceUrlForRow, exportMetadata)} disabled={!rows.length}><Download size={14} aria-hidden="true" />CSV</button>
      <button type="button" onClick={() => downloadRows(rows, filename, "json", sourceUrlForRow, exportMetadata)} disabled={!rows.length}><Download size={14} aria-hidden="true" />JSON</button>
      <span role="status" aria-live="polite">{message}</span>
    </div>
  );
}
