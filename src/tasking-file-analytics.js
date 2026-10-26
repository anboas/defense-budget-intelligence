const FILE_TYPES = [
  { id: "document", label: "Word document", extensions: new Set(["doc", "docx", "odt", "rtf"]), mimePrefixes: ["application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml"] },
  { id: "spreadsheet", label: "Spreadsheet", extensions: new Set(["csv", "ods", "xls", "xlsm", "xlsx"]), mimePrefixes: ["text/csv", "application/vnd.ms-excel", "application/vnd.openxmlformats-officedocument.spreadsheetml"] },
  { id: "presentation", label: "Presentation", extensions: new Set(["odp", "ppt", "pptx"]), mimePrefixes: ["application/vnd.ms-powerpoint", "application/vnd.openxmlformats-officedocument.presentationml"] },
  { id: "pdf", label: "PDF", extensions: new Set(["pdf"]), mimePrefixes: ["application/pdf"] },
  { id: "markdown", label: "Markdown", extensions: new Set(["md", "mdx", "markdown"]), mimePrefixes: ["text/markdown"] },
  { id: "text", label: "Text", extensions: new Set(["log", "txt"]), mimePrefixes: ["text/plain"] },
  { id: "image", label: "Image", extensions: new Set(["bmp", "gif", "heic", "jpeg", "jpg", "png", "svg", "tif", "tiff", "webp"]), mimePrefixes: ["image/"] },
  { id: "archive", label: "Archive", extensions: new Set(["7z", "gz", "rar", "tar", "zip"]), mimePrefixes: ["application/gzip", "application/vnd.rar", "application/x-7z-compressed", "application/x-tar", "application/zip"] },
];

const RECENCY_BUCKETS = [
  { id: "week", label: "Last 7 days", maximumDays: 7 },
  { id: "month", label: "8–30 days", maximumDays: 30 },
  { id: "quarter", label: "31–90 days", maximumDays: 90 },
  { id: "older", label: "More than 90 days", maximumDays: Infinity },
  { id: "unknown", label: "Date unavailable", maximumDays: null },
];

function extensionFor(name = "") {
  const value = String(name).trim();
  const separator = value.lastIndexOf(".");
  return separator > -1 && separator < value.length - 1 ? value.slice(separator + 1).toLowerCase() : "";
}

export function taskingFileType(item = {}) {
  const extension = extensionFor(item.name || item.path);
  const mimeType = String(item.mimeType || "").toLowerCase();
  const match = FILE_TYPES.find((type) => type.extensions.has(extension) || type.mimePrefixes.some((prefix) => mimeType.startsWith(prefix)));
  return match ? { id: match.id, label: match.label, extension } : { id: "other", label: extension ? extension.toUpperCase() : "Other", extension };
}

export function formatTaskingBytes(value) {
  const bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes < 0) return "Unknown";
  if (bytes < 1_000) return `${bytes.toLocaleString("en-US")} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let amount = bytes / 1_000;
  let unit = 0;
  while (amount >= 1_000 && unit < units.length - 1) { amount /= 1_000; unit += 1; }
  const digits = amount >= 100 ? 0 : amount >= 10 ? 1 : 2;
  return `${amount.toLocaleString("en-US", { maximumFractionDigits: digits })} ${units[unit]}`;
}

export function formatTaskingDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Date unavailable" : date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

function recencyFor(value, now) {
  const modified = new Date(value);
  if (Number.isNaN(modified.getTime())) return { id: "unknown", label: "Date unavailable", days: null };
  const elapsedDays = Math.max(0, Math.floor((now.getTime() - modified.getTime()) / 86_400_000));
  const bucket = RECENCY_BUCKETS.find((candidate) => candidate.maximumDays !== null && elapsedDays <= candidate.maximumDays) || RECENCY_BUCKETS.at(-1);
  const label = elapsedDays === 0 ? "Today" : elapsedDays === 1 ? "Yesterday" : `${elapsedDays} days ago`;
  return { id: bucket.id, label, days: elapsedDays };
}

function relatedTaskIds(item, tasks, relationships) {
  const taskIds = new Set(tasks.map((task) => task.id));
  const ids = new Set([item.id, item.sourceId, item.recordId].filter(Boolean));
  const related = new Set(tasks.filter((task) => item.recordId && task.anchorId === item.recordId).map((task) => task.id));
  if (taskIds.has(item.recordId)) related.add(item.recordId);
  for (const relationship of relationships) {
    if (ids.has(relationship.fromId) && taskIds.has(relationship.toId)) related.add(relationship.toId);
    if (ids.has(relationship.toId) && taskIds.has(relationship.fromId)) related.add(relationship.fromId);
  }
  return [...related];
}

export function buildTaskingFileAnalytics(sourceItems = [], tasks = [], relationships = [], { now = new Date() } = {}) {
  const activeFiles = sourceItems.filter((item) => !item.deletedAt && (item.itemType === "file" || item.kind === "file"));
  const taskById = new Map(tasks.map((task) => [task.id, task]));
  const files = activeFiles.map((item) => {
    const fileType = taskingFileType(item);
    const taskIds = relatedTaskIds(item, tasks, relationships);
    const recency = recencyFor(item.lastModifiedAt, now);
    return {
      ...item,
      fileType,
      recency,
      taskIds,
      taskTitles: taskIds.map((id) => taskById.get(id)?.title).filter(Boolean),
      workspaceLinked: Boolean(item.recordId),
      reviewed: ["parsed", "reviewed"].includes(item.parseStatus),
    };
  });
  const totalBytes = files.reduce((total, file) => total + (Number.isFinite(Number(file.size)) && Number(file.size) > 0 ? Number(file.size) : 0), 0);
  const typeMap = new Map();
  for (const file of files) {
    const current = typeMap.get(file.fileType.id) || { ...file.fileType, count: 0, bytes: 0 };
    current.count += 1;
    current.bytes += Number(file.size) || 0;
    typeMap.set(file.fileType.id, current);
  }
  const types = [...typeMap.values()].sort((left, right) => right.count - left.count || right.bytes - left.bytes || left.label.localeCompare(right.label));
  const recency = RECENCY_BUCKETS.map((bucket) => ({ ...bucket, count: files.filter((file) => file.recency.id === bucket.id).length }));
  return {
    files,
    totalFiles: files.length,
    totalBytes,
    filesWithSize: files.filter((file) => Number(file.size) > 0).length,
    reviewedFiles: files.filter((file) => file.reviewed).length,
    workspaceLinkedFiles: files.filter((file) => file.workspaceLinked).length,
    taskLinkedFiles: files.filter((file) => file.taskIds.length).length,
    types,
    recency,
  };
}

export function sortTaskingFiles(files, sort = "modified-desc") {
  return [...files].sort((left, right) => {
    if (sort === "size-desc") return (Number(right.size) || 0) - (Number(left.size) || 0) || left.name.localeCompare(right.name);
    if (sort === "name-asc") return left.name.localeCompare(right.name);
    const leftTime = new Date(left.lastModifiedAt).getTime() || 0;
    const rightTime = new Date(right.lastModifiedAt).getTime() || 0;
    return rightTime - leftTime || left.name.localeCompare(right.name);
  });
}
