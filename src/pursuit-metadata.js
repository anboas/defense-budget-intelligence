const START = "[[dbi:pursuit:v1]]";
const END = "[[/dbi:pursuit]]";

export const PURSUIT_STAGES = Object.freeze([
  ["monitor", "Monitor"],
  ["qualify", "Qualify"],
  ["capture", "Capture"],
  ["proposal", "Proposal"],
  ["submitted", "Submitted"],
  ["won", "Won"],
  ["lost", "Lost / no-bid"],
]);

const STAGES = new Set(PURSUIT_STAGES.map(([value]) => value));

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

export function normalizePursuit(value = {}) {
  return {
    stage: STAGES.has(value.stage) ? value.stage : "monitor",
    owner: text(value.owner, 80),
    nextAction: text(value.nextAction, 320),
  };
}

export function decodePursuitNote(value = "") {
  const raw = String(value || "");
  if (!raw.startsWith(START)) return { note: text(raw, 4_000), pursuit: normalizePursuit() };
  const end = raw.indexOf(END, START.length);
  if (end < 0) return { note: text(raw, 4_000), pursuit: normalizePursuit() };
  try {
    const pursuit = normalizePursuit(JSON.parse(raw.slice(START.length, end)));
    return { pursuit, note: text(raw.slice(end + END.length), 4_000) };
  } catch {
    return { note: text(raw, 4_000), pursuit: normalizePursuit() };
  }
}

export function encodePursuitNote(note = "", value = {}) {
  const pursuit = normalizePursuit(value);
  const cleanNote = text(note, 3_400);
  const metadata = pursuit.owner || pursuit.nextAction || pursuit.stage !== "monitor"
    ? `${START}${JSON.stringify(pursuit)}${END}`
    : "";
  return [metadata, cleanNote].filter(Boolean).join("\n").slice(0, 4_000);
}
