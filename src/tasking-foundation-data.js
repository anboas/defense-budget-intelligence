export const TASKING_FOUNDATION = Object.freeze({
  metadata: {
    mode: "synthetic",
    label: "Synthetic foundation",
    observedAt: "2026-10-24T16:00:00Z",
    sourceHealth: "ready",
    coverage: "Illustrative records only. No OneDrive source is connected.",
  },
  folders: [
    {
      id: "folder-portfolio", name: "Portfolio", path: "Portfolio", kind: "folder", children: [
        {
          id: "folder-pipeline", name: "Pipeline and Priorities", path: "Portfolio/Pipeline and Priorities", kind: "folder", children: [
            { id: "folder-tasking-data", name: "Tasking Dashboard Data", path: "Portfolio/Pipeline and Priorities/Tasking Dashboard Data", kind: "folder", status: "indexed", children: [] },
          ],
        },
      ],
    },
    {
      id: "folder-growth", name: "Growth", path: "Growth", kind: "folder", children: [
        {
          id: "folder-pursuit", name: "Example mission pursuit", path: "Growth/Example mission pursuit", kind: "folder", recordId: "anchor-pursuit", children: [
            { id: "file-capture-brief", name: "Capture brief v0.2.docx", path: "Growth/Example mission pursuit/Capture brief v0.2.docx", kind: "file", recordId: "anchor-file", status: "changed", parseStatus: "parsed", summary: "Illustrative capture position, evidence gaps, and partner role." },
            { id: "file-evidence-index", name: "Evidence index.xlsx", path: "Growth/Example mission pursuit/Evidence index.xlsx", kind: "file", recordId: "evidence-customer", status: "current", parseStatus: "indexed", summary: "Illustrative source register with review state." },
          ],
        },
      ],
    },
    {
      id: "folder-accounts", name: "Accounts", path: "Accounts", kind: "folder", children: [
        {
          id: "folder-partner", name: "Example partner", path: "Accounts/Example partner", kind: "folder", recordId: "anchor-account", children: [
            { id: "file-partner-notes", name: "Partner conversation notes.docx", path: "Accounts/Example partner/Partner conversation notes.docx", kind: "file", recordId: "task-partner-followup", status: "current", parseStatus: "parsed", summary: "Illustrative conversation notes and open workshare questions." },
          ],
        },
      ],
    },
    {
      id: "folder-admin", name: "Administrative", path: "Administrative", kind: "folder", children: [
        {
          id: "folder-goals", name: "Goals", path: "Administrative/Goals", kind: "folder", recordId: "anchor-goal", children: [
            { id: "file-goals", name: "2026 Performance Goals Tracker.xlsx", path: "Administrative/Goals/2026 Performance Goals Tracker.xlsx", kind: "file", recordId: "anchor-goal", status: "current", parseStatus: "indexed", summary: "Illustrative goal source. Assessment remains human-controlled." },
          ],
        },
      ],
    },
  ],
  workstreams: [
    {
      id: "workstream-capture", name: "Capture & pursuits", description: "Customer outcomes, positioning, and capture gates.", tone: "blue", anchors: ["anchor-pursuit"],
    },
    {
      id: "workstream-partners", name: "Partner development", description: "External conversations, commitments, and follow-up.", tone: "green", anchors: ["anchor-account"],
    },
    {
      id: "workstream-products", name: "Products & deliverables", description: "Files, briefs, and reviewable authored outputs.", tone: "purple", anchors: ["anchor-file"],
    },
    {
      id: "workstream-operations", name: "Operating commitments", description: "Goals, recurring reviews, and internal operating work.", tone: "amber", anchors: ["anchor-goal"],
    },
  ],
  anchors: [
    {
      id: "anchor-pursuit", kind: "Pursuit", title: "Example mission pursuit", workstreamId: "workstream-capture", folderId: "folder-pursuit", status: "in-progress", priority: "high", outcome: "Confirm a source-supported solution position before review.", nextMove: "Confirm solution owner", dueLabel: "Due soon", taskIds: ["task-solution-owner", "task-evidence-gaps"], connectionIds: ["anchor-account", "anchor-file", "anchor-goal", "decision-position", "evidence-customer"], sourceState: "current", updatedLabel: "Observed today",
    },
    {
      id: "anchor-account", kind: "Account", title: "Example partner", workstreamId: "workstream-partners", folderId: "folder-partner", status: "waiting", priority: "medium", outcome: "Clarify the partner role and workshare before the next commitment.", nextMove: "Send bounded follow-up", dueLabel: "No date", taskIds: ["task-partner-followup", "task-workshare"], connectionIds: ["anchor-pursuit", "anchor-file", "decision-position"], sourceState: "current", updatedLabel: "Observed yesterday",
    },
    {
      id: "anchor-file", kind: "File", title: "Capture brief v0.2", workstreamId: "workstream-products", folderId: "file-capture-brief", status: "review", priority: "high", outcome: "Produce one reviewable, evidence-bounded capture position.", nextMove: "Review changed evidence", dueLabel: "Review ready", taskIds: ["task-brief-review", "task-direct-impacts"], connectionIds: ["anchor-pursuit", "anchor-account", "anchor-goal", "evidence-customer"], sourceState: "changed", updatedLabel: "Version observed today",
    },
    {
      id: "anchor-goal", kind: "Goal", title: "Demonstrate reusable evidence", workstreamId: "workstream-operations", folderId: "folder-goals", status: "ready", priority: "medium", outcome: "Attach reviewed evidence without inferring goal achievement.", nextMove: "Assess supporting evidence", dueLabel: "No target date", taskIds: ["task-goal-evidence"], connectionIds: ["anchor-pursuit", "anchor-file", "evidence-customer"], sourceState: "current", updatedLabel: "Observed today",
    },
  ],
  tasks: [
    { id: "task-solution-owner", kind: "Task", title: "Confirm solution owner", description: "Confirm the accountable owner and evidence basis for the proposed solution position.", anchorId: "anchor-pursuit", status: "in-progress", owner: "Example owner", acceptance: "Named owner and reviewed basis", evidenceCount: 2, dependencyCount: 0 },
    { id: "task-evidence-gaps", kind: "Task", title: "Review evidence gaps", description: "Separate supported findings from unresolved questions before the capture review.", anchorId: "anchor-pursuit", status: "waiting", owner: "Example owner", acceptance: "Every gap has a source or explicit limitation", evidenceCount: 3, dependencyCount: 1 },
    { id: "task-partner-followup", kind: "Task", title: "Send bounded partner follow-up", description: "Prepare a follow-up that asks only for the unresolved role and workshare decisions.", anchorId: "anchor-account", status: "ready", owner: "Example owner", acceptance: "Draft reviewed before any external send", evidenceCount: 1, dependencyCount: 0 },
    { id: "task-workshare", kind: "Task", title: "Resolve workshare question", description: "Record the decision owner and outcome without treating conversation notes as agreement.", anchorId: "anchor-account", status: "waiting", owner: "Example owner", acceptance: "Decision outcome and rationale recorded", evidenceCount: 1, dependencyCount: 1 },
    { id: "task-brief-review", kind: "Task", title: "Review capture brief", description: "Review the current file version against the explicit acceptance criteria.", anchorId: "anchor-file", status: "review", owner: "Example reviewer", acceptance: "Three criteria reviewed with accepted evidence", evidenceCount: 4, dependencyCount: 0 },
    { id: "task-direct-impacts", kind: "Task", title: "Review direct impacts", description: "Inspect tasks directly affected by the newest observed file version.", anchorId: "anchor-file", status: "ready", owner: "Example owner", acceptance: "Direct and possible impacts remain distinct", evidenceCount: 2, dependencyCount: 0 },
    { id: "task-goal-evidence", kind: "Task", title: "Assess supporting evidence", description: "Review the evidence attached to the goal action. Completion does not assess the goal.", anchorId: "anchor-goal", status: "ready", owner: "Example owner", acceptance: "Human assessment remains explicit", evidenceCount: 3, dependencyCount: 0 },
  ],
  contextRecords: [
    { id: "decision-position", kind: "Decision", title: "Which solution position should advance?", status: "open", description: "Human decision. One unresolved option currently blocks partner workshare." },
    { id: "evidence-customer", kind: "Evidence", title: "Customer need excerpt", status: "review", description: "Proposed evidence with source and limitation retained." },
  ],
  relationships: [
    { id: "rel-account-pursuit", fromId: "anchor-account", toId: "anchor-pursuit", type: "supports", status: "confirmed", basis: "Explicit account and pursuit membership" },
    { id: "rel-file-pursuit", fromId: "anchor-file", toId: "anchor-pursuit", type: "informs", status: "confirmed", basis: "File contextual link" },
    { id: "rel-goal-pursuit", fromId: "anchor-goal", toId: "anchor-pursuit", type: "supported by", status: "suggested", basis: "Requires human relationship review" },
    { id: "rel-decision-pursuit", fromId: "decision-position", toId: "anchor-pursuit", type: "blocks", status: "confirmed", basis: "Named open dependency" },
    { id: "rel-evidence-file", fromId: "evidence-customer", toId: "anchor-file", type: "evidences", status: "suggested", basis: "Proposed evidence awaiting review" },
  ],
});

export function flattenTaskingFolders(nodes = TASKING_FOUNDATION.folders, depth = 0) {
  return nodes.flatMap((node) => [{ ...node, depth }, ...flattenTaskingFolders(node.children || [], depth + 1)]);
}
