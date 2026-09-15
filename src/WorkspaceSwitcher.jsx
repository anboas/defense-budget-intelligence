import { useMemo, useState } from "react";
import { ControlPicker } from "control-surface-ui/react";
import WorkspaceMark from "./WorkspaceMark.jsx";

function roleLabel(workspace) {
  if (workspace?.roleId === "super_user") return "Super user";
  if (workspace?.roleId === "administrator") return "Workspace manager";
  return workspace?.role || "Workspace member";
}

export default function WorkspaceSwitcher({ workspaces = [], activeWorkspace, onSelect }) {
  const [switchingId, setSwitchingId] = useState("");
  const [error, setError] = useState("");
  const options = useMemo(() => workspaces.map((workspace) => ({
    value: workspace.id,
    label: workspace.name,
    description: workspace.description || roleLabel(workspace),
    meta: workspace.id === switchingId ? "Opening" : roleLabel(workspace),
    searchText: roleLabel(workspace),
    icon: <WorkspaceMark workspace={workspace} />,
    disabled: Boolean(switchingId),
  })), [switchingId, workspaces]);

  async function chooseWorkspace(workspaceId) {
    if (!workspaceId || workspaceId === activeWorkspace?.id) return;
    setSwitchingId(workspaceId);
    setError("");
    try {
      await onSelect(workspaceId);
    } catch (switchError) {
      setError(switchError.message || "Workspace switch failed.");
    } finally {
      setSwitchingId("");
    }
  }

  return <div className="profile-workspace-switcher__control">
    <ControlPicker
      className="profile-workspace-switcher__picker"
      label="Workspaces"
      value={activeWorkspace?.id || ""}
      options={options}
      onChange={(workspaceId) => void chooseWorkspace(workspaceId)}
      placeholder="Choose workspace"
      searchable
      align="end"
    />
    {error ? <p className="if-field__error" role="alert">{error}</p> : null}
  </div>;
}
