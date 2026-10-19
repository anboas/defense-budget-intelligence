import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { decodePursuitNote, encodePursuitNote, normalizePursuit } from "../src/pursuit-metadata.js";

const root = resolve(import.meta.dirname, "..");
const commandRailSource = readFileSync(resolve(root, "src/OpportunityCommandRail.jsx"), "utf8");
const workspaceSource = readFileSync(resolve(root, "src/UniversalIntelligenceWorkspace.jsx"), "utf8");
const previewSource = readFileSync(resolve(root, "src/OpportunityWorkbenchDetail.jsx"), "utf8");
const todaySource = readFileSync(resolve(root, "src/TodayWorkspace.jsx"), "utf8");
const spendExplorerSource = readFileSync(resolve(root, "src/SpendExplorer.jsx"), "utf8");
const dataTableSource = readFileSync(resolve(root, "src/OperationalDataTable.jsx"), "utf8");

const encoded = encodePursuitNote("Customer context remains readable.", {
  stage: "capture",
  owner: "Adam",
  nextAction: "Confirm customer discovery meeting",
  tasks: [{ id: "task-1", title: "Prepare discovery questions", status: "in_progress", priority: "high", dueAt: "2026-10-20", owner: "Adam", sourceType: "research", sourceId: "report-1", sourceLabel: "AI decision brief", createdAt: "2026-10-16T20:00:00Z" }],
});
const decoded = decodePursuitNote(encoded);

assert.deepEqual(decoded.pursuit, {
  stage: "capture",
  owner: "Adam",
  nextAction: "Confirm customer discovery meeting",
  tasks: [{ id: "task-1", title: "Prepare discovery questions", status: "in_progress", priority: "high", dueAt: "2026-10-20", owner: "Adam", sourceType: "research", sourceId: "report-1", sourceLabel: "AI decision brief", createdAt: "2026-10-16T20:00:00Z", completedAt: "" }],
}, "Pursuit metadata should round-trip through the existing tracking note boundary");
assert.equal(decoded.note, "Customer context remains readable.", "Human workspace notes must stay separate from pursuit metadata");
assert.deepEqual(normalizePursuit({ stage: "invented", owner: " A\nB ", nextAction: " Decide\tsoon " }), {
  stage: "monitor",
  owner: "A B",
  nextAction: "Decide soon",
  tasks: [],
}, "Pursuit state should reject unknown stages and strip control characters");
assert.equal(decodePursuitNote("Legacy note").note, "Legacy note", "Legacy notes should remain readable without migration");
const priorEnvelope = `[[dbi:pursuit:v1]]${JSON.stringify({ stage: "qualify", owner: "Prior owner", nextAction: "Prior next action" })}[[/dbi:pursuit]]\nPrior workspace note`;
assert.deepEqual(decodePursuitNote(priorEnvelope), { pursuit: { stage: "qualify", owner: "Prior owner", nextAction: "Prior next action", tasks: [] }, note: "Prior workspace note" }, "Version-one pursuit envelopes should remain readable after task storage is added");

const bounded = encodePursuitNote("N".repeat(4_000), {
  stage: "proposal",
  owner: "Owner".repeat(20),
  nextAction: "Action".repeat(80),
  tasks: Array.from({ length: 10 }, (_, index) => ({ id: `task-${index}`, title: `Task ${index} ${"detail".repeat(40)}`, status: "todo", priority: "critical", dueAt: "2026-10-20", owner: "Owner".repeat(20), sourceType: "timeline", sourceId: "source".repeat(30), sourceLabel: "Evidence".repeat(30) })),
});
assert.ok(bounded.length <= 4_000, "Pursuit state must remain inside the existing tracking-note boundary");
assert.equal(decodePursuitNote(bounded).pursuit.tasks.length, 6, "Task storage should remain valid at the bounded pursuit limit");
assert.doesNotMatch(commandRailSource, /className="pursuit-tasks__complete"|onClick=\{\(\) => patchTask\(task, \{ status: "done" \}\)\}/, "Action plans must not expose silent one-click completion");
assert.match(commandRailSource, /data-task-confirmation.*complete[\s\S]*Complete action/, "Task completion must require an explicit confirmation surface");
assert.match(commandRailSource, /data-task-confirmation.*delete[\s\S]*Delete action/, "Task deletion must require an explicit confirmation surface");
assert.doesNotMatch(commandRailSource, /intelligence\?\.notice/, "Research transport feedback must not render inside pursuit controls");
assert.match(workspaceSource, /RecordIntelligenceNotice/, "The canonical workspace must own record-intelligence feedback outside the action plan");
assert.match(previewSource, /RecordIntelligenceNotice/, "Opportunity previews must keep record-intelligence feedback outside the action plan");
assert.match(todaySource, /ControlMenu[\s\S]*More selected opportunity actions/, "Today must use the shared command-menu owner for secondary opportunity actions");
assert.match(commandRailSource, /ControlMenu[\s\S]*More pursuit actions/, "Pursuit surfaces must use the shared command-menu owner");
assert.match(workspaceSource, /ControlMenu[\s\S]*More workspace actions/, "Intelligence workspaces must use the shared command-menu owner");
assert.match(spendExplorerSource, /ControlTabs[\s\S]*ariaLabel="Analysis Studio lenses"[\s\S]*Capture targets[\s\S]*Spend analysis[\s\S]*data-analysis-studio-tabs/, "Analysis Studio must delegate its visible lenses to the shared tab owner");
assert.match(dataTableSource, /QueryRailUtilities[\s\S]*Table options/, "Table configuration must use the Query Rail utility owner");
assert.doesNotMatch(`${todaySource}\n${commandRailSource}\n${workspaceSource}\n${spendExplorerSource}`, /<details[^>]*(?:more|analysis-menu)[^>]*>/i, "Command lists must not regress to route-specific details elements");

console.log("Interaction foundation contracts passed", { stage: decoded.pursuit.stage, tasks: decoded.pursuit.tasks.length, boundedBytes: bounded.length, legacyCompatible: true, sharedFloatingLayers: true });
