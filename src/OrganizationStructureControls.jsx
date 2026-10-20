import ControlSelect from "./ControlSelect.jsx";
import "./OrganizationStructureControls.css";

export default function OrganizationStructureControls({ depth, group, status, workOnly, workOverlay, workScope, onDepthChange, onGroupChange, onStatusChange, onWorkOnlyChange, onWorkOverlayChange, onWorkScopeChange }) {
  return <section className="organization-structure-controls" aria-label="Organization structure controls" data-organization-structure-controls>
    <label><span>Depth</span><ControlSelect compact ariaLabel="Hierarchy depth" value={depth} options={[["1", "1 level"], ["2", "2 levels"], ["all", "All reviewed"]]} onChange={onDepthChange} /></label>
    <label><span>Components</span><ControlSelect compact ariaLabel="Organization component filter" value={group} options={[["services", "Departments & services"], ["joint", "Joint & combatant"], ["agencies", "Staff & agencies"], ["commands", "Commands & components"], ["all", "All reviewed"]]} onChange={onGroupChange} /></label>
    <label><span>Status</span><ControlSelect compact ariaLabel="Organization status filter" value={status} options={[["current", "Current"], ["all", "All reviewed"]]} onChange={onStatusChange} /></label>
    <label><span>Work overlay</span><ControlSelect compact ariaLabel="Organization work overlay" value={workOverlay} options={[["none", "None"], ["opportunities", "Opportunities"], ["awards", "Awards"], ["obligations", "Obligations"]]} onChange={onWorkOverlayChange} /></label>
    <label><span>Work scope</span><ControlSelect compact ariaLabel="Organization work scope" value={workScope} options={[["subtree", "Organization + descendants"], ["direct", "Directly owned only"]]} onChange={onWorkScopeChange} /></label>
    <label className="organization-structure-controls__check"><input type="checkbox" checked={workOnly} onChange={(event) => onWorkOnlyChange(event.target.checked)} /><span>Only with linked work</span></label>
  </section>;
}
