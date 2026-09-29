import { memo, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { geoAlbersUsa, geoPath, select, zoom, zoomIdentity, zoomTransform } from "d3";
import { feature, mesh } from "topojson-client";
import statesTopology from "us-atlas/states-10m.json";
import {
  CircleDollarSign,
  Group,
  Info,
  Layers3,
  ListFilter,
  LocateFixed,
  MapPin,
  Minus,
  Plus,
  Search,
  ShieldCheck,
  Star,
  Tags,
  X,
} from "lucide-react";
import { ControlPageBody, ControlStatusBadge } from "control-surface-ui/react";
import ControlSelect from "./ControlSelect.jsx";
import ControlWorkbenchHeader from "./WorkbenchHeader.jsx";
import { useManagementState } from "./management-state.js";
import { BRANCHES, organizationLocationRules, resolveOrganizationLocation } from "./organization-locations.js";
import "./OpportunityMap.css";

const MAP_WIDTH = 975;
const MAP_HEIGHT = 610;
const DEFAULT_FILTERS = Object.freeze({
  by: "contracting",
  status: "live",
  scope: "all",
  branch: "all",
  spend: "obligated",
  floor: "0",
  query: "",
  organization: "",
  clusters: "on",
  callouts: "on",
});
const ROUTE_KEYS = Object.freeze({
  by: "mapBy",
  status: "mapStatus",
  scope: "mapScope",
  branch: "mapBranch",
  spend: "mapSpend",
  floor: "mapFloor",
  query: "mapQuery",
  organization: "mapOrg",
  clusters: "mapClusters",
  callouts: "mapCallouts",
});
const FILTER_VALUES = Object.freeze({
  by: new Set(["contracting", "funding"]),
  status: new Set(["live", "active", "upcoming", "all"]),
  scope: new Set(["all", "tracked", "acquisition"]),
  branch: new Set(["all", ...Object.keys(BRANCHES)]),
  spend: new Set(["obligated", "potential"]),
  floor: new Set(["0", "10000000", "50000000", "100000000", "500000000", "1000000000"]),
  clusters: new Set(["on", "off"]),
  callouts: new Set(["on", "off"]),
});
const STATE_ABBREVIATIONS = Object.freeze({
  "01": "AL", "02": "AK", "04": "AZ", "05": "AR", "06": "CA", "08": "CO", "09": "CT", "10": "DE", "11": "DC", "12": "FL", "13": "GA", "15": "HI", "16": "ID", "17": "IL", "18": "IN", "19": "IA", "20": "KS", "21": "KY", "22": "LA", "23": "ME", "24": "MD", "25": "MA", "26": "MI", "27": "MN", "28": "MS", "29": "MO", "30": "MT", "31": "NE", "32": "NV", "33": "NH", "34": "NJ", "35": "NM", "36": "NY", "37": "NC", "38": "ND", "39": "OH", "40": "OK", "41": "OR", "42": "PA", "44": "RI", "45": "SC", "46": "SD", "47": "TN", "48": "TX", "49": "UT", "50": "VT", "51": "VA", "53": "WA", "54": "WV", "55": "WI", "56": "WY",
});

const stateFeatures = feature(statesTopology, statesTopology.objects.states).features;
const stateMesh = mesh(statesTopology, statesTopology.objects.states, (left, right) => left !== right);
const projection = geoAlbersUsa().scale(1280).translate([MAP_WIDTH / 2, MAP_HEIGHT / 2]);
const path = geoPath(projection);

function cleanFilters(candidate = {}) {
  return Object.fromEntries(Object.entries(DEFAULT_FILTERS).map(([key, fallback]) => {
    const value = String(candidate[key] ?? fallback);
    if (key === "query" || key === "organization") return [key, value.slice(0, 180)];
    return [key, FILTER_VALUES[key]?.has(value) ? value : fallback];
  }));
}

function readFilters() {
  if (typeof window === "undefined") return { ...DEFAULT_FILTERS };
  const params = new URLSearchParams(String(window.location.hash || "").split("?")[1] || "");
  return cleanFilters(Object.fromEntries(Object.entries(ROUTE_KEYS).map(([key, routeKey]) => [key, params.get(routeKey) ?? DEFAULT_FILTERS[key]])));
}

function writeFilters(filters) {
  const [route = "#/budget-spend/map", search = ""] = String(window.location.hash || "").split("?");
  const params = new URLSearchParams(search);
  Object.entries(ROUTE_KEYS).forEach(([key, routeKey]) => {
    const value = String(filters[key] ?? "");
    if (!value || value === DEFAULT_FILTERS[key]) params.delete(routeKey);
    else params.set(routeKey, value);
  });
  const nextHash = `${route}${params.size ? `?${params}` : ""}`;
  window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}${nextHash}`);
}

function money(value) {
  const amount = Number(value || 0);
  if (!amount) return "$0";
  if (Math.abs(amount) >= 1e9) return `$${(amount / 1e9).toFixed(1)}B`;
  if (Math.abs(amount) >= 1e6) return `$${(amount / 1e6).toFixed(1)}M`;
  if (Math.abs(amount) >= 1e3) return `$${(amount / 1e3).toFixed(0)}K`;
  return `$${amount.toLocaleString()}`;
}

function compactDate(value) {
  if (!value) return "No date published";
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? "No date published" : date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

function recordAmount(record, metric) {
  if (metric === "potential") return Number(record.potentialAmount || 0);
  return Number(record.obligatedAmount || 0);
}

function lifecycleBucket(record, asOf) {
  if (["active", "upcoming", "historical", "unresolved"].includes(record.lifecycle)) return record.lifecycle;
  const lifecycle = String(record.lifecycleStatus || "");
  if (lifecycle === "active-reported-term") return "active";
  if (lifecycle === "option-horizon-unconfirmed") return "upcoming";
  const nextDate = [record.solicitationStart, record.solicitationEnd, ...(record.events || []).flatMap((event) => [event.start, event.end])]
    .filter((value) => value && value >= asOf).sort()[0];
  if (record.mode === "acquisition-window" && nextDate) return "upcoming";
  if (["historical-term", "past-published-milestone"].includes(lifecycle)) return "historical";
  return "unresolved";
}

function lifecycleLabel(record, asOf) {
  const bucket = lifecycleBucket(record, asOf);
  if (bucket === "active") return "Active";
  if (bucket === "upcoming") return "Upcoming";
  if (bucket === "historical") return "Past";
  return "Schedule unresolved";
}

function nextRecordDate(record, asOf) {
  if (record.nextDate) return record.nextDate;
  return [record.solicitationStart, record.solicitationEnd, record.currentEnd, record.potentialEnd, ...(record.events || []).flatMap((event) => [event.start, event.end])]
    .filter((value) => value && value >= asOf).sort()[0] || "";
}

function activityName(record, dimension) {
  if (dimension === "funding") return record.fundingOffice || "";
  return record.contractingOffice || "";
}

function officeBasis(record, dimension) {
  return dimension === "funding" ? record.fundingOfficeBasis : record.contractingOfficeBasis;
}

function branchOptions() {
  return [{ value: "all", label: "All services" }, ...Object.entries(BRANCHES).map(([value, branch]) => ({ value, label: branch.label }))];
}

function projectedPoints(points) {
  return points.map((point) => {
    const coordinate = projection([point.longitude, point.latitude]);
    return coordinate ? { ...point, x: coordinate[0], y: coordinate[1] } : null;
  }).filter(Boolean);
}

function groupNearbyPoints(points, scale, enabled) {
  const projected = projectedPoints(points);
  if (!enabled) return projected.map((point) => ({ ...point, members: [point] }));
  const threshold = 48 / scale;
  const groups = [];
  projected.forEach((point) => {
    let group = groups.find((candidate) => Math.hypot(candidate.x - point.x, candidate.y - point.y) <= threshold);
    if (!group) {
      group = { x: point.x, y: point.y, members: [] };
      groups.push(group);
    }
    group.members.push(point);
    const totalWeight = group.members.reduce((total, member) => total + Math.max(Math.sqrt(member.spend || 0), 1), 0);
    group.x = group.members.reduce((total, member) => total + member.x * Math.max(Math.sqrt(member.spend || 0), 1), 0) / totalWeight;
    group.y = group.members.reduce((total, member) => total + member.y * Math.max(Math.sqrt(member.spend || 0), 1), 0) / totalWeight;
  });
  return groups.map((group) => {
    if (group.members.length === 1) return { ...group.members[0], members: group.members };
    const branches = [...new Set(group.members.map((member) => member.branch))];
    return {
      ...group,
      id: `nearby:${group.members.map((member) => member.id).sort().join("|")}`,
      label: `${group.members.length} nearby acquisition hubs`,
      city: group.members.map((member) => member.city).slice(0, 2).join(" · "),
      branch: branches.length === 1 ? branches[0] : "mixed",
      spend: group.members.reduce((total, member) => total + member.spend, 0),
      activeCount: group.members.reduce((total, member) => total + member.activeCount, 0),
      upcomingCount: group.members.reduce((total, member) => total + member.upcomingCount, 0),
      trackedCount: group.members.reduce((total, member) => total + member.trackedCount, 0),
      exactOfficeCount: group.members.reduce((total, member) => total + member.exactOfficeCount, 0),
      records: group.members.flatMap((member) => member.records),
      organizations: [...new Set(group.members.flatMap((member) => member.organizations))],
      metricLabel: group.members[0].metricLabel,
    };
  }).sort((left, right) => right.spend - left.spend);
}

function distributeCallouts(nodes) {
  const selected = nodes.filter((node) => node.members.length === 1).sort((left, right) => right.spend - left.spend).slice(0, 3);
  const sides = {
    left: selected.filter((node) => node.x < MAP_WIDTH / 2).sort((left, right) => left.y - right.y),
    right: selected.filter((node) => node.x >= MAP_WIDTH / 2).sort((left, right) => left.y - right.y),
  };
  const results = [];
  Object.entries(sides).forEach(([side, entries]) => {
    const minY = 48;
    const maxY = MAP_HEIGHT - 66;
    const spacing = 58;
    const ys = [];
    entries.forEach((node) => {
      const desired = Math.max(minY, Math.min(maxY, node.y - 22));
      ys.push(ys.length ? Math.max(desired, ys.at(-1) + spacing) : desired);
    });
    if (ys.at(-1) > maxY) {
      const shift = ys.at(-1) - maxY;
      ys.forEach((_, index) => { ys[index] -= shift; });
    }
    entries.forEach((node, index) => {
      const width = 200;
      const x = side === "left" ? Math.min(MAP_WIDTH - width - 18, node.x + 28) : Math.max(18, node.x - width - 28);
      results.push({ node, side, x, y: ys[index], width, height: 44 });
    });
  });
  return results;
}

const GeographyLayer = memo(function GeographyLayer() {
  return <g className="opportunity-map__states" aria-hidden="true">
    {stateFeatures.map((state) => <path key={state.id} d={path(state) || ""} />)}
    <path className="opportunity-map__state-borders" d={path(stateMesh) || ""} />
    {stateFeatures.map((state) => {
      const [x, y] = path.centroid(state);
      const label = STATE_ABBREVIATIONS[String(state.id).padStart(2, "0")];
      if (!label || !Number.isFinite(x) || !Number.isFinite(y)) return null;
      return <text key={`label-${state.id}`} className="opportunity-map__state-label" x={x} y={y}>{label}</text>;
    })}
  </g>;
});

function StatusTabs({ value, onChange }) {
  const options = [["live", "Live"], ["active", "Active"], ["upcoming", "Upcoming"], ["all", "All stages"]];
  return <div className="opportunity-map__status-tabs" role="group" aria-label="Opportunity lifecycle">
    {options.map(([id, label]) => <button key={id} type="button" className={value === id ? "is-active" : ""} aria-pressed={value === id} onClick={() => onChange(id)}>{label}</button>)}
  </div>;
}

const MapCanvas = memo(function MapCanvas({ points, selectedId, onSelect, clustersEnabled, calloutsEnabled }) {
  const svgRef = useRef(null);
  const viewportRef = useRef(null);
  const zoomOutputRef = useRef(null);
  const zoomRef = useRef(null);
  const [transform, setTransform] = useState(zoomIdentity);
  const [tooltip, setTooltip] = useState(null);
  const nodes = useMemo(() => groupNearbyPoints(points, transform.k, clustersEnabled), [clustersEnabled, points, transform.k]);
  const maxSpend = Math.max(...nodes.map((point) => point.spend), 1);
  const rankedLabels = useMemo(() => new Set(points.slice(0, 9).map((point) => point.id)), [points]);
  const callouts = useMemo(() => calloutsEnabled && transform.k < 1.35 ? distributeCallouts(nodes) : [], [calloutsEnabled, nodes, transform.k]);

  useEffect(() => {
    const svg = select(svgRef.current);
    const behavior = zoom()
      .scaleExtent([1, 8])
      .extent([[0, 0], [MAP_WIDTH, MAP_HEIGHT]])
      .translateExtent([[-80, -80], [MAP_WIDTH + 80, MAP_HEIGHT + 80]])
      .on("start", () => setTooltip(null))
      .on("zoom", (event) => {
        viewportRef.current?.setAttribute("transform", event.transform.toString());
        if (zoomOutputRef.current) zoomOutputRef.current.textContent = `${Math.round(event.transform.k * 100)}%`;
      })
      .on("end", (event) => setTransform(event.transform));
    svg.call(behavior).on("dblclick.zoom", null);
    zoomRef.current = behavior;
    return () => { svg.on(".zoom", null); };
  }, []);

  useEffect(() => {
    if (!selectedId || !svgRef.current || !zoomRef.current) return;
    const point = projectedPoints(points).find((candidate) => candidate.id === selectedId);
    if (!point) return;
    const nextScale = Math.max(2.35, zoomTransform(svgRef.current).k);
    const next = zoomIdentity.translate(MAP_WIDTH / 2, MAP_HEIGHT / 2).scale(nextScale).translate(-point.x, -point.y);
    select(svgRef.current).transition().duration(260).call(zoomRef.current.transform, next);
  }, [points, selectedId]);

  const zoomBy = (factor) => {
    if (!svgRef.current || !zoomRef.current) return;
    select(svgRef.current).transition().duration(160).call(zoomRef.current.scaleBy, factor);
  };
  const reset = () => {
    if (!svgRef.current || !zoomRef.current) return;
    select(svgRef.current).transition().duration(180).call(zoomRef.current.transform, zoomIdentity);
  };
  const activateNode = (node) => {
    if (node.members.length === 1) {
      onSelect(node.members[0].id);
      return;
    }
    const nextScale = Math.min(8, Math.max(2.25, transform.k * 1.85));
    const next = zoomIdentity.translate(MAP_WIDTH / 2, MAP_HEIGHT / 2).scale(nextScale).translate(-node.x, -node.y);
    select(svgRef.current).transition().duration(260).call(zoomRef.current.transform, next);
  };
  const showTooltip = (event, node) => {
    const bounds = svgRef.current?.getBoundingClientRect();
    if (!bounds) return;
    const fallbackX = (transform.applyX(node.x) / MAP_WIDTH) * bounds.width;
    const fallbackY = (transform.applyY(node.y) / MAP_HEIGHT) * bounds.height;
    const pointerX = event.clientX ? event.clientX - bounds.left : fallbackX;
    const pointerY = event.clientY ? event.clientY - bounds.top : fallbackY;
    setTooltip({ node, x: Math.max(8, Math.min(bounds.width - 300, pointerX)), y: Math.max(64, pointerY) });
  };

  return <div className="opportunity-map__canvas" data-opportunity-map-canvas>
    <svg ref={svgRef} viewBox={`0 0 ${MAP_WIDTH} ${MAP_HEIGHT}`} role="img" aria-labelledby="opportunity-map-svg-title opportunity-map-svg-description">
      <title id="opportunity-map-svg-title">United States contracting activity map</title>
      <desc id="opportunity-map-svg-description">Interactive map of mapped acquisition organizations. Nearby offices group at national scale. Marker size represents the selected spend measure. Select a numbered group to zoom or an office to inspect its activity.</desc>
      <rect className="opportunity-map__water" width={MAP_WIDTH} height={MAP_HEIGHT} />
      <g ref={viewportRef} transform={transform.toString()}>
        <GeographyLayer />
        {callouts.length ? <g className="opportunity-map__callouts">
          {callouts.map(({ node, side, x, y, width, height }) => {
            const edgeX = side === "left" ? x : x + width;
            const selected = node.members.some((member) => member.id === selectedId);
            return <g key={`callout-${node.id}`} className={`opportunity-map__callout${selected ? " is-selected" : ""}`} role="button" tabIndex="0" aria-label={`Inspect ${node.label}`} onClick={() => activateNode(node)} onKeyDown={(event) => { if (["Enter", " "].includes(event.key)) { event.preventDefault(); activateNode(node); } }}>
              <path d={`M${node.x},${node.y} L${edgeX},${y + height / 2}`} />
              <rect x={x} y={y} width={width} height={height} />
              <text x={x + 10} y={y + 17}>{node.members.length > 1 ? `${node.members.length} nearby hubs` : node.label.length > 31 ? `${node.label.slice(0, 30)}…` : node.label}</text>
              <text className="opportunity-map__callout-meta" x={x + 10} y={y + 33}>{money(node.spend)} · {node.records.length} records</text>
            </g>;
          })}
        </g> : null}
        <g className="opportunity-map__markers">
          {nodes.map((node) => {
            const radius = (node.members.length > 1 ? 12 + 10 * Math.sqrt(node.spend / maxSpend) : 7 + 22 * Math.sqrt(node.spend / maxSpend)) / transform.k;
            const selected = node.members.some((member) => member.id === selectedId);
            const color = BRANCHES[node.branch]?.color || "#315b78";
            const showLabel = node.members.length === 1 && (selected || (rankedLabels.has(node.id) && transform.k >= 1.55));
            return <g key={node.id} className={`opportunity-map__marker${node.members.length > 1 ? " is-cluster" : ""}${selected ? " is-selected" : ""}`} transform={`translate(${node.x} ${node.y})`} role="button" tabIndex="0" aria-label={node.members.length > 1 ? `${node.members.length} nearby acquisition hubs, ${money(node.spend)}, ${node.records.length} indexed records. Select to zoom.` : `${node.label}, ${node.organizations.length} organizations, ${money(node.spend)} ${node.metricLabel}, ${node.records.length} indexed records`} aria-pressed={selected} onClick={() => activateNode(node)} onKeyDown={(event) => { if (["Enter", " "].includes(event.key)) { event.preventDefault(); activateNode(node); } }} onPointerEnter={(event) => showTooltip(event, node)} onPointerLeave={() => setTooltip(null)} onFocus={(event) => showTooltip(event, node)} onBlur={() => setTooltip(null)}>
              <circle className="opportunity-map__marker-halo" r={radius + 5 / transform.k} style={{ fill: color }} />
              <circle className="opportunity-map__marker-core" r={radius} style={{ fill: color }} />
              {node.members.length > 1 ? <text className="opportunity-map__cluster-count" style={{ fontSize: `${11 / transform.k}px` }}>{node.members.length}</text> : <circle className="opportunity-map__marker-center" r={Math.max(2.6, radius * 0.22)} />}
              {node.trackedCount ? <circle className="opportunity-map__marker-tracked" cx={radius * .72} cy={-radius * .72} r={5 / transform.k} /> : null}
              {showLabel ? <text className="opportunity-map__marker-label" y={-radius - 8 / transform.k} style={{ fontSize: `${12 / transform.k}px`, strokeWidth: `${4 / transform.k}px` }}>{node.label}</text> : null}
            </g>;
          })}
        </g>
      </g>
    </svg>
    {tooltip ? <div className="opportunity-map__tooltip" role="tooltip" style={{ left: tooltip.x, top: tooltip.y }}>
      <strong>{tooltip.node.label}</strong>
      <span>{money(tooltip.node.spend)} {tooltip.node.metricLabel}</span>
      <small>{BRANCHES[tooltip.node.branch]?.label || "Multiple services"} · {tooltip.node.records.length} records · {tooltip.node.activeCount} active · {tooltip.node.upcomingCount} upcoming{tooltip.node.members.length > 1 ? ` · ${tooltip.node.members.length} hubs` : ""}</small>
    </div> : null}
    <div className="opportunity-map__map-controls" aria-label="Map controls">
      <button type="button" onClick={() => zoomBy(1.4)} aria-label="Zoom in"><Plus size={17} /></button>
      <button type="button" onClick={() => zoomBy(1 / 1.4)} aria-label="Zoom out"><Minus size={17} /></button>
      <button type="button" onClick={reset} aria-label="Fit United States"><LocateFixed size={17} /></button>
      <output ref={zoomOutputRef} aria-label="Zoom level">{Math.round(transform.k * 100)}%</output>
    </div>
    <div className="opportunity-map__interaction-hint">Select a group to zoom · drag or scroll to explore</div>
  </div>;
});

function activeFilterCount(filters) {
  return [filters.by, filters.scope, filters.branch, filters.spend, filters.floor]
    .filter((value, index) => value !== [DEFAULT_FILTERS.by, DEFAULT_FILTERS.scope, DEFAULT_FILTERS.branch, DEFAULT_FILTERS.spend, DEFAULT_FILTERS.floor][index]).length;
}

function OpportunityRow({ record, asOf, watched, onToggleWatch, spendMetric }) {
  const nextDate = nextRecordDate(record, asOf);
  const query = record.reference || record.title;
  return <article className="opportunity-map__record">
    <div className="opportunity-map__record-main">
      <span><ControlStatusBadge status={lifecycleBucket(record, asOf) === "active" ? "active" : lifecycleBucket(record, asOf) === "upcoming" ? "pending" : "neutral"} label={lifecycleLabel(record, asOf)} />{record.mode === "acquisition-window" ? <small>Acquisition</small> : <small>Contract</small>}</span>
      <a href={`#/budget-spend/explorer?spendView=table&capQuery=${encodeURIComponent(query || "")}`}>{record.title || record.reference || "Untitled record"}</a>
      <p>{record.reference || "No reference"} · {record.portfolio || "No portfolio"}</p>
    </div>
    <div className="opportunity-map__record-facts"><strong>{money(recordAmount(record, spendMetric))}</strong><span>{nextDate ? compactDate(nextDate) : "No future date"}</span></div>
    <button type="button" className={watched ? "is-starred" : ""} aria-label={watched ? `Stop tracking ${record.title}` : `Track ${record.title}`} aria-pressed={watched} onClick={() => onToggleWatch(record.opportunityId)}><Star size={16} fill={watched ? "currentColor" : "none"} /></button>
  </article>;
}

function DrawerHeader({ eyebrow, onClose, children }) {
  return <header className="opportunity-map__drawer-header"><div><small>{eyebrow}</small>{children}</div><button type="button" onClick={onClose} aria-label={`Close ${eyebrow.toLowerCase()}`}><X size={18} /></button></header>;
}

function DetailPanel({ point, asOf, watchedIds, onToggleWatch, spendMetric, onClose }) {
  if (!point) return null;
  const branch = BRANCHES[point.branch] || BRANCHES.joint;
  const records = [...point.records].sort((left, right) => recordAmount(right, spendMetric) - recordAmount(left, spendMetric));
  return <aside className="opportunity-map__drawer opportunity-map__detail" data-opportunity-map-detail aria-label="Organization details">
    <DrawerHeader eyebrow={branch.label} onClose={onClose}><h3>{point.label}</h3><p><MapPin size={13} />{point.city}</p></DrawerHeader>
    <div className="opportunity-map__evidence-badge"><ShieldCheck size={14} />{point.exactOfficeCount ? `${point.exactOfficeCount} of ${point.records.length} records use exact award-detail offices` : "Reviewed published-office registry match"}</div>
    <dl className="opportunity-map__detail-metrics">
      <div><dt>{spendMetric === "potential" ? "Potential" : "Obligated"}</dt><dd>{money(point.spend)}</dd></div>
      <div><dt>Organizations</dt><dd>{point.organizations.length}</dd></div>
      <div><dt>Active</dt><dd>{point.activeCount}</dd></div>
      <div><dt>Upcoming</dt><dd>{point.upcomingCount}</dd></div>
    </dl>
    <section className="opportunity-map__organization-list"><span>Mapped activities</span><p>{point.organizations.slice(0, 5).join(" · ")}{point.organizations.length > 5 ? ` · +${point.organizations.length - 5} more` : ""}</p></section>
    <section className="opportunity-map__record-list">
      <header><span>Indexed activity</span><b>{point.records.length}</b></header>
      {records.slice(0, 6).map((record) => <OpportunityRow key={record.opportunityId} record={record} asOf={asOf} watched={watchedIds.has(record.opportunityId)} onToggleWatch={onToggleWatch} spendMetric={spendMetric} />)}
    </section>
    {records.length > 6 ? <a className="opportunity-map__detail-link" href={`#/budget-spend/explorer?spendView=table&capQuery=${encodeURIComponent(point.organizations[0] || point.label)}`}>Open all {records.length} records in Spend Explorer</a> : null}
  </aside>;
}

function DirectoryPanel({ points, spendMetric, onSelect, onClose }) {
  const [query, setQuery] = useState("");
  const visible = points.filter((point) => [point.label, point.city, ...point.organizations].join(" ").toLowerCase().includes(query.trim().toLowerCase()));
  return <aside className="opportunity-map__drawer opportunity-map__directory" data-opportunity-map-directory aria-label="Location directory">
    <DrawerHeader eyebrow="Location directory" onClose={onClose}><h3>Find an organization hub</h3><p>{points.length} reviewed map locations in this view</p></DrawerHeader>
    <label className="opportunity-map__drawer-search"><Search size={15} /><span className="sr-only">Search map locations</span><input autoFocus type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Office, organization, city…" /></label>
    <div className="opportunity-map__directory-results">
      {visible.map((point) => <button type="button" key={point.id} onClick={() => onSelect(point.id)}><span><strong>{point.label}</strong><small>{point.city} · {point.organizations.length} organizations</small></span><span><b>{money(point.spend)}</b><small>{point.records.length} records</small></span></button>)}
      {!visible.length ? <p className="opportunity-map__drawer-empty">No reviewed locations match that search.</p> : null}
    </div>
    <footer>{spendMetric === "potential" ? "Values show published potential value." : "Values show published obligations."}</footer>
  </aside>;
}

function EvidencePanel({ model, asOf, onClose }) {
  const registry = organizationLocationRules();
  const aliasCount = registry.reduce((total, entry) => total + entry.aliases, 0);
  const coverage = model.considered ? Math.round((model.resolvedRecords / model.considered) * 100) : 0;
  return <aside className="opportunity-map__drawer opportunity-map__evidence" data-opportunity-map-evidence aria-label="Map evidence and coverage">
    <DrawerHeader eyebrow="Map evidence" onClose={onClose}><h3>Coverage and placement</h3><p>Current filtered evidence as of {compactDate(asOf)}</p></DrawerHeader>
    <div className="opportunity-map__audit-stats">
      <div><strong>{coverage}%</strong><span>of filtered records resolve to reviewed offices</span></div>
      <div><strong>{model.exactObserved}</strong><span>records have exact award-detail observations</span></div>
      <div><strong>{model.mappedExact}</strong><span>mapped records use exact office evidence</span></div>
      <div><strong>{model.unresolved}</strong><span>records remain unresolved</span></div>
    </div>
    <section><h4>Placement standard</h4><p>Markers use exact USAspending award-detail offices first, then explicit offices from reviewed source records. Both must match the {registry.length}-location, {aliasCount}-alias registry. The map never substitutes a department headquarters for a missing office.</p></section>
    <section><h4>What a marker means</h4><p>Each marker is a buying-activity hub with one or more indexed records. Nearby groups are display-only clusters and separate as you zoom. Marker size follows the selected published spend measure.</p></section>
    <section><h4>Known boundary</h4><p>Redacted, unpublished, or unfamiliar office names stay in the unresolved count. Geographic coverage does not imply a qualified opportunity, active bid, or customer relationship.</p></section>
  </aside>;
}

export default function OpportunityMap({ dataset }) {
  const records = useMemo(() => dataset.records || [], [dataset.records]);
  const management = useManagementState(records);
  const [filters, setFilters] = useState(readFilters);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [openPanel, setOpenPanel] = useState("");
  const [mapResetKey, setMapResetKey] = useState(0);
  const asOf = dataset.metadata.asOf || new Date().toISOString().slice(0, 10);
  const deferredQuery = useDeferredValue(filters.query);

  useEffect(() => {
    const sync = () => setFilters(readFilters());
    window.addEventListener("hashchange", sync);
    window.addEventListener("popstate", sync);
    return () => { window.removeEventListener("hashchange", sync); window.removeEventListener("popstate", sync); };
  }, []);

  const commit = useCallback((patch) => {
    setFilters((current) => {
      const next = cleanFilters({ ...current, ...patch });
      writeFilters(next);
      return next;
    });
  }, []);

  const model = useMemo(() => {
    const query = deferredQuery.trim().toLowerCase();
    const floor = Number(filters.floor || 0);
    const unresolved = [];
    const byLocation = new Map();
    let considered = 0;
    let exactObserved = 0;
    records.forEach((record) => {
      const bucket = lifecycleBucket(record, asOf);
      if (filters.status === "live" && !["active", "upcoming"].includes(bucket)) return;
      if (["active", "upcoming"].includes(filters.status) && bucket !== filters.status) return;
      if (filters.scope === "tracked" && !management.watchedIds.has(record.opportunityId)) return;
      if (filters.scope === "acquisition" && record.mode !== "acquisition-window") return;
      const name = activityName(record, filters.by);
      const searchable = [name, record.title, record.reference, record.portfolio, record.party, record.workCategory].filter(Boolean).join(" ").toLowerCase();
      if (query && !searchable.includes(query)) return;
      considered += 1;
      if (record.monitorStatus === "current" || record.monitorStatus === "stale") exactObserved += 1;
      const location = resolveOrganizationLocation(name);
      if (!location) { unresolved.push(record); return; }
      if (filters.branch !== "all" && location.branch !== filters.branch) return;
      const current = byLocation.get(location.id) || { ...location, organizations: new Set(), records: [], spend: 0, activeCount: 0, upcomingCount: 0, trackedCount: 0, exactOfficeCount: 0 };
      current.organizations.add(name);
      current.records.push(record);
      current.spend += recordAmount(record, filters.spend);
      if (officeBasis(record, filters.by) === "exact-award-detail") current.exactOfficeCount += 1;
      if (bucket === "active") current.activeCount += 1;
      if (bucket === "upcoming") current.upcomingCount += 1;
      if (management.watchedIds.has(record.opportunityId)) current.trackedCount += 1;
      byLocation.set(location.id, current);
    });
    const resolvedPoints = [...byLocation.values()]
      .map((point) => ({ ...point, organizations: [...point.organizations].sort(), metricLabel: filters.spend === "potential" ? "potential value" : "obligated spend" }))
      .sort((left, right) => right.spend - left.spend || left.label.localeCompare(right.label));
    const resolvedRecords = resolvedPoints.reduce((total, point) => total + point.records.length, 0);
    const points = resolvedPoints.filter((point) => point.spend >= floor);
    const mappedRecords = points.reduce((total, point) => total + point.records.length, 0);
    const mappedExact = points.reduce((total, point) => total + point.exactOfficeCount, 0);
    return {
      points,
      considered,
      mappedRecords,
      mappedExact,
      exactObserved,
      resolvedRecords,
      unresolved: unresolved.length,
      spend: points.reduce((total, point) => total + point.spend, 0),
      organizations: new Set(points.flatMap((point) => point.organizations)).size,
      tracked: points.reduce((total, point) => total + point.trackedCount, 0),
    };
  }, [asOf, deferredQuery, filters.branch, filters.by, filters.floor, filters.scope, filters.spend, filters.status, management.watchedIds, records]);

  const selected = model.points.find((point) => point.id === filters.organization) || null;
  useEffect(() => {
    if (!selected && !openPanel) return undefined;
    const closeOnEscape = (event) => {
      if (event.key !== "Escape") return;
      if (openPanel) setOpenPanel("");
      else commit({ organization: "" });
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [commit, openPanel, selected]);

  const selectPoint = useCallback((organization) => { setOpenPanel(""); commit({ organization }); }, [commit]);
  const advancedFilterCount = activeFilterCount(filters);
  const resetAll = useCallback(() => {
    setOpenPanel("");
    setFiltersOpen(false);
    setMapResetKey((current) => current + 1);
    commit({ ...DEFAULT_FILTERS });
  }, [commit]);

  return <section className="opportunity-map" data-opportunity-map data-map-source-records={records.length} data-map-mapped-records={model.mappedRecords} data-map-exact-office-records={model.mappedExact} data-map-visible-spend={Math.round(model.spend)}>
    <ControlWorkbenchHeader eyebrow="Market geography" title="Opportunity Map" summary="Explore reviewed buying offices and move from geography to active opportunity detail." />
    <ControlPageBody compact>
      <section className="opportunity-map__controls" aria-label="Map filters">
        <div className="opportunity-map__control-row opportunity-map__control-row--primary">
          <label className="opportunity-map__search"><Search size={16} /><span className="sr-only">Search organizations and opportunities</span><input type="search" value={filters.query} onChange={(event) => commit({ query: event.target.value, organization: "" })} placeholder="Search offices, records, portfolios…" /></label>
          <StatusTabs value={filters.status} onChange={(status) => commit({ status, organization: "" })} />
          <button type="button" className={`opportunity-map__filter-toggle${filtersOpen ? " is-active" : ""}`} aria-expanded={filtersOpen} onClick={() => setFiltersOpen((current) => !current)}><ListFilter size={14} />Filters{advancedFilterCount ? <b>{advancedFilterCount}</b> : null}</button>
          {(advancedFilterCount || filters.status !== DEFAULT_FILTERS.status || filters.query) ? <button type="button" className="opportunity-map__reset" onClick={resetAll}>Reset</button> : null}
        </div>
        {filtersOpen ? <div className="opportunity-map__control-row opportunity-map__control-row--secondary">
          <ControlSelect label="Map by" value={filters.by} options={[{ value: "contracting", label: "Contracting activity" }, { value: "funding", label: "Funding organization" }]} onChange={(by) => commit({ by, organization: "" })} />
          <ControlSelect label="Scope" value={filters.scope} options={[{ value: "all", label: "Relevant indexed records" }, { value: "tracked", label: `Tracked only (${management.watchlist.length})` }, { value: "acquisition", label: "Acquisition opportunities" }]} onChange={(scope) => commit({ scope, organization: "" })} />
          <ControlSelect label="Service" value={filters.branch} options={branchOptions()} onChange={(branch) => commit({ branch, organization: "" })} />
          <ControlSelect label="Size by" value={filters.spend} options={[{ value: "obligated", label: "Obligated spend" }, { value: "potential", label: "Potential value" }]} onChange={(spend) => commit({ spend, organization: "" })} />
          <ControlSelect label="Minimum" value={filters.floor} options={[{ value: "0", label: "Any spend" }, { value: "10000000", label: "$10M+" }, { value: "50000000", label: "$50M+" }, { value: "100000000", label: "$100M+" }, { value: "500000000", label: "$500M+" }, { value: "1000000000", label: "$1B+" }]} onChange={(floor) => commit({ floor, organization: "" })} />
        </div> : null}
      </section>

      <div className="opportunity-map__workspace">
        <section className="opportunity-map__map-panel">
          <header className="opportunity-map__map-header">
            <div className="opportunity-map__map-title"><Layers3 size={17} /><span><strong>United States acquisition activity</strong><small>{model.points.length} locations · {model.mappedRecords} records · {money(model.spend)} {filters.spend === "potential" ? "potential" : "obligated"}</small></span></div>
            <div className="opportunity-map__map-actions" aria-label="Map display tools">
              <button type="button" aria-pressed={filters.callouts === "on"} onClick={() => commit({ callouts: filters.callouts === "on" ? "off" : "on" })}><Tags size={14} />Callouts</button>
              <button type="button" aria-pressed={filters.clusters === "on"} onClick={() => commit({ clusters: filters.clusters === "on" ? "off" : "on" })}><Group size={14} />Nearby groups</button>
              <button type="button" aria-expanded={openPanel === "directory"} onClick={() => setOpenPanel((current) => current === "directory" ? "" : "directory")}><ListFilter size={14} />Find</button>
              <button type="button" aria-expanded={openPanel === "evidence"} onClick={() => setOpenPanel((current) => current === "evidence" ? "" : "evidence")}><ShieldCheck size={14} />Evidence</button>
            </div>
          </header>
          {model.points.length ? <MapCanvas key={mapResetKey} points={model.points} selectedId={selected?.id || ""} onSelect={selectPoint} clustersEnabled={filters.clusters === "on"} calloutsEnabled={filters.callouts === "on"} /> : <div className="opportunity-map__empty"><CircleDollarSign size={28} /><strong>No mapped organizations match these filters</strong><p>Reduce the spend floor, widen the lifecycle, or clear the search to restore activity.</p><button type="button" className="if-btn if-btn--secondary" onClick={resetAll}>Reset map</button></div>}
          <footer className="opportunity-map__coverage"><span><b>{model.mappedRecords}</b> mapped records</span><span><b>{model.mappedExact}</b> exact-office matches</span><span><b>{model.unresolved}</b> location unresolved</span><p><Info size={13} />Published spend only. Exact award-detail offices are preferred; unrecognized or redacted offices remain unresolved and are never placed heuristically.</p></footer>
        </section>
        {selected ? <DetailPanel point={selected} asOf={asOf} watchedIds={management.watchedIds} onToggleWatch={management.toggleWatch} spendMetric={filters.spend} onClose={() => commit({ organization: "" })} /> : null}
        {openPanel === "directory" ? <DirectoryPanel points={model.points} spendMetric={filters.spend} onSelect={selectPoint} onClose={() => setOpenPanel("")} /> : null}
        {openPanel === "evidence" ? <EvidencePanel model={model} asOf={asOf} onClose={() => setOpenPanel("")} /> : null}
      </div>
    </ControlPageBody>
  </section>;
}
