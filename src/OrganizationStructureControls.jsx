import { RotateCcw, SlidersHorizontal } from "lucide-react";
import { ControlPicker, ControlPopover, ControlTabs } from "control-surface-ui/react";
import "./OrganizationStructureControls.css";

const DEPTH_OPTIONS = [
  { value: "1", label: "1 level", description: "Immediate reviewed children" },
  { value: "2", label: "2 levels", description: "Children and one subordinate tier" },
  { value: "all", label: "All reviewed", description: "Every retained reviewed descendant" },
];

const GROUP_OPTIONS = [
  { value: "services", label: "Departments & services", description: "Military departments and services" },
  { value: "joint", label: "Joint & combatant", description: "Joint staff and combatant commands" },
  { value: "agencies", label: "Staff & agencies", description: "Principal staff, agencies, and field activities" },
  { value: "commands", label: "Commands & components", description: "Major commands and subordinate components" },
  { value: "all", label: "All reviewed", description: "Every reviewed component class" },
];

const OVERLAY_OPTIONS = [
  { value: "none", label: "No work overlay", description: "Show structure without ranked work" },
  { value: "opportunities", label: "Opportunities", description: "Rank by retained opportunity coverage" },
  { value: "awards", label: "Awards", description: "Rank by linked award coverage" },
  { value: "obligations", label: "Obligations", description: "Rank by retained obligated amount" },
];

const SCOPE_OPTIONS = [
  { value: "subtree", label: "Organization + descendants", description: "Roll up the reviewed subtree" },
  { value: "direct", label: "Directly owned only", description: "Exclude descendant work" },
];

export default function OrganizationStructureControls({ depth, group, status, workOnly, workOverlay, workScope, onDepthChange, onGroupChange, onStatusChange, onWorkOnlyChange, onWorkOverlayChange, onWorkScopeChange, onReset }) {
  const adjustments = Number(depth !== "2") + Number(group !== "services") + Number(status !== "current") + Number(workOnly) + Number(workOverlay !== "opportunities") + Number(workScope !== "subtree");
  return <section className="organization-structure-controls" role="toolbar" aria-label="Organization structure controls" data-organization-structure-controls data-active-adjustments={adjustments}>
    <div className="organization-structure-controls__primary">
      <label><span className="if-field__label">Depth</span><ControlPicker compact label="Hierarchy depth" value={depth} options={DEPTH_OPTIONS} onChange={onDepthChange} /></label>
      <label><span className="if-field__label">Components</span><ControlPicker compact label="Organization components" value={group} options={GROUP_OPTIONS} onChange={onGroupChange} /></label>
      <label><span className="if-field__label">Work overlay</span><ControlPicker compact label="Work overlay" value={workOverlay} options={OVERLAY_OPTIONS} onChange={onWorkOverlayChange} /></label>
      <label><span className="if-field__label">Work scope</span><ControlPicker compact label="Work scope" value={workScope} options={SCOPE_OPTIONS} onChange={onWorkScopeChange} /></label>
    </div>
    <div className="organization-structure-controls__secondary if-cluster">
      <ControlPopover
        label={<>Filters{status !== "current" || workOnly ? <span className="if-badge">{Number(status !== "current") + Number(workOnly)}</span> : null}</>}
        ariaLabel="Organization structure filters"
        icon={<SlidersHorizontal size={14} aria-hidden="true" />}
        triggerClassName="if-btn if-btn--secondary"
        width={320}
        popoverProps={{ className: "if-stack if-stack--sm" }}
      >
        <div className="if-stack if-stack--xs">
          <span className="if-field__label">Temporal status</span>
          <ControlTabs fill ariaLabel="Organization temporal status" activeId={status} onSelect={onStatusChange} items={[["current", "Current"], ["all", "All reviewed"]]} />
        </div>
        <label className="if-checkbox organization-structure-controls__check"><input type="checkbox" checked={workOnly} onChange={(event) => onWorkOnlyChange(event.target.checked)} /><span className="if-stack if-stack--xs"><strong>Only with linked work</strong><small className="if-text-muted if-text-xs">Hide reviewed organizations with no work in the selected scope.</small></span></label>
      </ControlPopover>
      <button type="button" className="if-btn if-btn--secondary" disabled={!adjustments} onClick={onReset} aria-label="Reset graph view controls"><RotateCcw size={14} aria-hidden="true" />Reset</button>
    </div>
  </section>;
}
