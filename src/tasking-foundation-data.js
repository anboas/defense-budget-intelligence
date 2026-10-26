export const TASKING_FOUNDATION = Object.freeze({
  metadata: {
    mode: "empty",
    label: "Workspace tasking",
    observedAt: null,
    sourceHealth: "not-connected",
    coverage: "No workspace tasking records or source metadata are available yet.",
    counts: {
      workstreams: 0,
      anchors: 0,
      tasks: 0,
      contextRecords: 0,
      relationships: 0,
      sourceItems: 0,
      sourceFiles: 0,
      sourceFolders: 0,
      linkedSourceItems: 0,
    },
  },
  folders: [],
  workstreams: [],
  anchors: [],
  tasks: [],
  contextRecords: [],
  relationships: [],
  sourceItems: [],
});

export function flattenTaskingFolders(nodes = [], depth = 0) {
  return nodes.flatMap((node) => [{ ...node, depth }, ...flattenTaskingFolders(node.children || [], depth + 1)]);
}
