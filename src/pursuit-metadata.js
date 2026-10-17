const START = "[[dbi:pursuit:v1]]";
const END = "[[/dbi:pursuit]]";
export const PURSUIT_TASK_EVENT = "dbi:create-pursuit-task";

export const PURSUIT_STAGES = Object.freeze([
  ["monitor", "Monitor"],
  ["qualify", "Qualify"],
  ["capture", "Capture"],
  ["proposal", "Proposal"],
  ["submitted", "Submitted"],
  ["won", "Won"],
  ["lost", "Lost / no-bid"],
]);

export const PURSUIT_TASK_STATUSES = Object.freeze([
  ["todo", "To do"],
  ["in_progress", "In progress"],
  ["waiting", "Waiting"],
  ["done", "Done"],
]);

export const PURSUIT_TASK_PRIORITIES = Object.freeze([
  ["critical", "Critical"],
  ["high", "High"],
  ["normal", "Normal"],
  ["low", "Low"],
]);

const STAGES = new Set(PURSUIT_STAGES.map(([value]) => value));
const TASK_STATUSES = new Set(PURSUIT_TASK_STATUSES.map(([value]) => value));
const TASK_PRIORITIES = new Set(PURSUIT_TASK_PRIORITIES.map(([value]) => value));
const TASK_LIMIT = 6;

function text(value, limit) {
  return [...String(value || "")]
    .map((character) => {
      const code = character.charCodeAt(0);
      return code < 32 || code === 127 ? " " : character;
    })
    .join("")
    .trim()
    .slice(0, limit);
}

function date(value) {
  const cleaned = text(value, 32);
  return /^\d{4}-\d{2}-\d{2}(?:T[\d:.+-]+Z?)?$/.test(cleaned) && !Number.isNaN(Date.parse(cleaned)) ? cleaned : "";
}

export function normalizePursuitTask(value = {}) {
  const title = text(value.title, 160);
  if (!title) return null;
  return {
    id: text(value.id, 64),
    title,
    status: TASK_STATUSES.has(value.status) ? value.status : "todo",
    priority: TASK_PRIORITIES.has(value.priority) ? value.priority : "normal",
    dueAt: date(value.dueAt),
    owner: text(value.owner, 60),
    sourceType: text(value.sourceType, 24),
    sourceId: text(value.sourceId, 80),
    sourceLabel: text(value.sourceLabel, 100),
    createdAt: date(value.createdAt),
    completedAt: date(value.completedAt),
  };
}

export function normalizePursuit(value = {}) {
  return {
    stage: STAGES.has(value.stage) ? value.stage : "monitor",
    owner: text(value.owner, 80),
    nextAction: text(value.nextAction, 320),
    tasks: (Array.isArray(value.tasks) ? value.tasks : []).map(normalizePursuitTask).filter(Boolean).slice(0, TASK_LIMIT),
  };
}

function pursuitFromWire(value = {}) {
  if (value?.v !== 2) return value;
  return {
    stage: value.s,
    owner: value.o,
    nextAction: value.n,
    tasks: (Array.isArray(value.t) ? value.t : []).map((task) => ({
      id: task?.[0], title: task?.[1], status: task?.[2], priority: task?.[3], dueAt: task?.[4], owner: task?.[5],
      sourceType: task?.[6], sourceId: task?.[7], sourceLabel: task?.[8], createdAt: task?.[9], completedAt: task?.[10],
    })),
  };
}

function pursuitToWire(value) {
  return {
    v: 2,
    s: value.stage,
    o: value.owner,
    n: value.nextAction,
    t: value.tasks.map((task) => [task.id, task.title, task.status, task.priority, task.dueAt, task.owner, task.sourceType, task.sourceId, task.sourceLabel, task.createdAt, task.completedAt]),
  };
}

export function decodePursuitNote(value = "") {
  const raw = String(value || "");
  if (!raw.startsWith(START)) return { note: text(raw, 4_000), pursuit: normalizePursuit() };
  const end = raw.indexOf(END, START.length);
  if (end < 0) return { note: text(raw, 4_000), pursuit: normalizePursuit() };
  try {
    const pursuit = normalizePursuit(pursuitFromWire(JSON.parse(raw.slice(START.length, end))));
    return { pursuit, note: text(raw.slice(end + END.length), 4_000) };
  } catch {
    return { note: text(raw, 4_000), pursuit: normalizePursuit() };
  }
}

export function encodePursuitNote(note = "", value = {}) {
  const pursuit = normalizePursuit(value);
  const metadata = pursuit.owner || pursuit.nextAction || pursuit.stage !== "monitor" || pursuit.tasks.length
    ? `${START}${JSON.stringify(pursuitToWire(pursuit))}${END}`
    : "";
  const noteLimit = Math.max(0, 4_000 - metadata.length - (metadata ? 1 : 0));
  const cleanNote = text(note, noteLimit);
  return [metadata, cleanNote].filter(Boolean).join("\n");
}
