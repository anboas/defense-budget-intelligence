export const analysisDrawerStyle = {
  display: "grid",
  gridTemplateRows: "auto minmax(0, 1fr) auto",
  width: "min(96vw, 88rem)",
  overflow: "var(--analysis-drawer-overflow, hidden)",
};

export const analysisDrawerBodyStyle = {
  minHeight: 0,
  padding: 0,
  overflow: "var(--analysis-overflow, hidden)",
};

export const analysisWorkspaceStyle = {
  display: "grid",
  gridTemplateColumns: "var(--analysis-columns, minmax(22rem, 26rem) minmax(0, 1fr))",
  height: "var(--analysis-height, 100%)",
  minHeight: 0,
  overflow: "var(--analysis-overflow, hidden)",
};

export const analysisContextStyle = {
  display: "grid",
  alignContent: "start",
  gap: 12,
  minWidth: 0,
  minHeight: 0,
  padding: 12,
  overflow: "var(--analysis-pane-overflow, auto)",
  borderRight: "var(--analysis-divider-right, 1px solid var(--border-soft))",
  borderBottom: "var(--analysis-divider-bottom, 0)",
  background: "var(--surface-muted)",
};

export const analysisCanvasStyle = {
  display: "grid",
  alignContent: "start",
  gap: 14,
  minWidth: 0,
  minHeight: 0,
  padding: 12,
  overflow: "var(--analysis-pane-overflow, auto)",
  background: "var(--surface)",
};
