import { Layers3 } from "lucide-react";
import { ControlPopover } from "control-surface-ui/react";
import "./TimelineEvidenceControls.css";

export const TIMELINE_LAYER_GROUPS = [
  {
    id: "timing",
    label: "Timing",
    layers: [
      { id: "followon", label: "Follow-ons", description: "Published successor windows and milestones." },
      { id: "awards", label: "Refreshed award end", description: "Latest USAspending end-date observation." },
    ],
  },
  {
    id: "money",
    label: "Money activity",
    layers: [
      { id: "fpds", label: "FPDS actions", description: "Exact award-action pulses by month." },
      { id: "fiscal", label: "Annual obligations", description: "Fiscal-year obligation intensity behind each term." },
      { id: "subawards", label: "Subawards", description: "Retained USAspending subaward activity." },
    ],
  },
  {
    id: "acquisition",
    label: "Acquisition context",
    layers: [
      { id: "competition", label: "Competition / set-aside", description: "Published competition and eligibility posture." },
      { id: "vehicle", label: "Contract vehicle", description: "Published parent vehicle or ordering route." },
      { id: "structure", label: "Award / pricing type", description: "Instrument and pricing structure where published." },
      { id: "work", label: "Type of work", description: "Normalized capability and work category." },
    ],
  },
  {
    id: "quality",
    label: "Evidence quality",
    layers: [
      { id: "evidence", label: "Evidence tier", description: "Corroboration strength for each retained record." },
      { id: "validation", label: "Validation status", description: "Verified, corrected, or unresolved QA state." },
      { id: "provenance", label: "Ingestion provenance", description: "Automated, imported, or curated source path." },
      { id: "changes", label: "Changes", description: "Added or updated since the prior snapshot." },
    ],
  },
];

export const TIMELINE_LAYER_OPTIONS = TIMELINE_LAYER_GROUPS.flatMap((group) => group.layers.map((layer) => [layer.id, layer.label]));
export const TIMELINE_CATEGORICAL_LAYER_IDS = ["competition", "vehicle", "structure", "work", "evidence", "validation", "provenance", "changes"];

const LAYER_PRESETS = [
  { id: "none", label: "Schedule only", layers: [] },
  { id: "funding", label: "Funding", layers: ["fpds", "fiscal"] },
  { id: "acquisition", label: "Acquisition context", layers: ["followon", "competition", "vehicle", "structure", "work"] },
  { id: "quality", label: "Evidence quality", layers: ["evidence", "validation", "provenance", "changes"] },
];

const BASE_LEGEND = [
  ["base", "Reported term"],
  ["potential", "Potential option"],
  ["window", "Published window"],
  ["solicitation", "Solicitation open"],
  ["milestone", "Milestone"],
  ["today", "Today"],
];

const LAYER_LEGEND = {
  followon: ["followon", "Follow-on"],
  awards: ["award", "Refreshed award end"],
  fpds: ["action", "FPDS action"],
  fiscal: ["fiscal", "FY obligations"],
  subawards: ["subaward", "Subaward"],
  competition: ["competition", "Competition"],
  vehicle: ["vehicle", "Vehicle"],
  structure: ["structure", "Pricing type"],
  work: ["work", "Work type"],
  evidence: ["evidence", "Evidence tier"],
  validation: ["validation", "Validation"],
  provenance: ["provenance", "Provenance"],
  changes: ["change", "Changed"],
};

export function TimelineLegend({ selectedFeeds, showResearch = false }) {
  const activeLayers = [...selectedFeeds].map((id) => LAYER_LEGEND[id]).filter(Boolean);
  const items = [...BASE_LEGEND, ...(showResearch ? [["research", "AI research date"]] : []), ...activeLayers];
  return (
    <div className="capture-legend-rail" data-timeline-legend aria-label="Timeline legend">
      <strong>Legend</strong>
      <ul className="capture-legend">
        {items.map(([kind, label]) => <li key={kind}><i className={kind} aria-hidden="true" /><span>{label}</span></li>)}
      </ul>
    </div>
  );
}

export function TimelineLayerControl({ selectedFeeds, coverage = {}, statusText, onToggle, onSet }) {
  const selectedPreset = (preset) => preset.layers.length === selectedFeeds.size && preset.layers.every((id) => selectedFeeds.has(id));
  return (
    <ControlPopover
      label={`Layers (${selectedFeeds.size})`}
      ariaLabel="Timeline evidence layers"
      icon={<Layers3 size={14} />}
      align="start"
      width={520}
      className="capture-layer-menu"
      triggerClassName="if-btn if-btn--secondary if-btn--sm"
      popoverProps={{ className: "capture-layer-popover" }}
    >
      <div className="capture-layer-panel" data-timeline-layer-panel>
        <header>
          <div><strong>Evidence overlays</strong><small>Schedule remains the baseline. Add only the context needed for the current decision.</small></div>
        </header>
        <div className="capture-layer-presets" role="group" aria-label="Layer presets">
          {LAYER_PRESETS.map((preset) => <button type="button" key={preset.id} aria-pressed={selectedPreset(preset)} onClick={() => onSet(preset.layers)}>{preset.label}</button>)}
        </div>
        <div className="capture-layer-groups">
          {TIMELINE_LAYER_GROUPS.map((group) => (
            <section key={group.id} aria-labelledby={`timeline-layer-${group.id}`}>
              <h3 id={`timeline-layer-${group.id}`}>{group.label}</h3>
              {group.layers.map((layer) => (
                <button type="button" key={layer.id} className="capture-layer-option" aria-label={layer.label} aria-pressed={selectedFeeds.has(layer.id)} onClick={() => onToggle(layer.id)}>
                  <span><strong>{layer.label}</strong><small>{layer.description}</small></span>
                  <em>{coverage[layer.id] || "Available"}</em>
                </button>
              ))}
            </section>
          ))}
        </div>
        <footer>{statusText}</footer>
      </div>
    </ControlPopover>
  );
}
