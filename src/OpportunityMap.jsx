import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { geoAlbersUsa, geoPath, select, zoom, zoomIdentity } from "d3";
import { feature, mesh } from "topojson-client";
import statesTopology from "us-atlas/states-10m.json";
import {
  Building2,
  CircleDollarSign,
  Layers3,
  LocateFixed,
  Minus,
  Plus,
  Search,
  Star,
} from "lucide-react";
import { ControlPageBody, ControlStatusBadge } from "control-surface-ui/react";
import ControlSelect from "./ControlSelect.jsx";
import ControlWorkbenchHeader from "./WorkbenchHeader.jsx";
import { applyProcurementChanges, assembleProcurementRecords } from "./procurement-taxonomy.js";
import { useManagementState } from "./management-state.js";
import { BRANCHES, resolveOrganizationLocation } from "./organization-locations.js";

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
});
const FILTER_VALUES = Object.freeze({
  by: new Set(["contracting", "funding"]),
  status: new Set(["live", "active", "upcoming", "all"]),
  scope: new Set(["all", "tracked", "acquisition"]),
  branch: new Set(["all", ...Object.keys(BRANCHES)]),
  spend: new Set(["obligated", "potential"]),
  floor: new Set(["0", "10000000", "50000000", "100000000", "500000000", "1000000000"]),
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
  if (metric === "potential") return Number(record.potentialAmount || record.valueHigh || record.liveAward?.potentialAmountDollars || 0);
  return Number(record.liveAward?.awardAmountDollars || record.obligatedAmount || record.fpdsObligatedAmount || 0);
}

function lifecycleBucket(record, asOf) {
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
  return [record.solicitationStart, record.solicitationEnd, record.currentEnd, record.potentialEnd, ...(record.events || []).flatMap((event) => [event.start, event.end])]
    .filter((value) => value && value >= asOf).sort()[0] || "";
}

function activityName(record, dimension) {
  if (dimension === "funding") return record.fundingOffice || record.owner || "";
  return record.contractingOffice || record.owner || "";
}

function branchOptions() {
  return [{ value: "all", label: "All services" }, ...Object.entries(BRANCHES).map(([value, branch]) => ({ value, label: branch.label }))];
}

function StatusTabs({ value, onChange }) {
  const options = [["live", "Live"], ["active", "Active"], ["upcoming", "Upcoming"], ["all", "All stages"]];
  return <div className="opportunity-map__status-tabs" role="group" aria-label="Opportunity lifecycle">
    {options.map(([id, label]) => <button key={id} type="button" className={value === id ? "is-active" : ""} aria-pressed={value === id} onClick={() => onChange(id)}>{label}</button>)}
  </div>;
}

function MapCanvas({ points, selectedId, onSelect }) {
  const svgRef = useRef(null);
  const zoomRef = useRef(null);
  const [transform, setTransform] = useState(zoomIdentity);
  const maxSpend = Math.max(...points.map((point) => point.spend), 1);
  const rankedLabels = useMemo(() => new Set(points.slice(0, 9).map((point) => point.id)), [points]);

  useEffect(() => {
    const svg = select(svgRef.current);
    const behavior = zoom()
      .scaleExtent([1, 8])
      .extent([[0, 0], [MAP_WIDTH, MAP_HEIGHT]])
      .translateExtent([[-80, -80], [MAP_WIDTH + 80, MAP_HEIGHT + 80]])
      .on("zoom", (event) => setTransform(event.transform));
    svg.call(behavior).on("dblclick.zoom", null);
    zoomRef.current = behavior;
    return () => { svg.on(".zoom", null); };
  }, []);

  const zoomBy = (factor) => {
    if (!svgRef.current || !zoomRef.current) return;
    select(svgRef.current).transition().duration(160).call(zoomRef.current.scaleBy, factor);
  };
  const reset = () => {
    if (!svgRef.current || !zoomRef.current) return;
    select(svgRef.current).transition().duration(180).call(zoomRef.current.transform, zoomIdentity);
  };

  return <div className="opportunity-map__canvas" data-opportunity-map-canvas>
    <svg ref={svgRef} viewBox={`0 0 ${MAP_WIDTH} ${MAP_HEIGHT}`} role="img" aria-labelledby="opportunity-map-svg-title opportunity-map-svg-description">
      <title id="opportunity-map-svg-title">United States contracting activity map</title>
      <desc id="opportunity-map-svg-description">Interactive map of mapped acquisition organizations. Marker size represents the selected spend measure. Use arrow keys to pan after focusing the map and Enter on a marker to inspect its organization cluster.</desc>
      <rect className="opportunity-map__water" width={MAP_WIDTH} height={MAP_HEIGHT} />
      <g transform={transform.toString()}>
        <g className="opportunity-map__states" aria-hidden="true">
          {stateFeatures.map((state) => <path key={state.id} d={path(state) || ""} />)}
          <path className="opportunity-map__state-borders" d={path(stateMesh) || ""} />
        </g>
        <g className="opportunity-map__markers">
          {points.map((point) => {
            const coordinate = projection([point.longitude, point.latitude]);
            if (!coordinate) return null;
            const radius = (7 + 22 * Math.sqrt(point.spend / maxSpend)) / transform.k;
            const selected = point.id === selectedId;
            const color = BRANCHES[point.branch]?.color || "#82d8e8";
            const showLabel = selected || (rankedLabels.has(point.id) && transform.k >= 1.55);
            return <g key={point.id} className={`opportunity-map__marker${selected ? " is-selected" : ""}`} transform={`translate(${coordinate[0]} ${coordinate[1]})`} role="button" tabIndex="0" aria-label={`${point.label}, ${point.organizations.length} organizations, ${money(point.spend)} ${point.metricLabel}, ${point.records.length} indexed records`} aria-pressed={selected} onClick={() => onSelect(point.id)} onKeyDown={(event) => { if (["Enter", " "].includes(event.key)) { event.preventDefault(); onSelect(point.id); } }}>
              <circle className="opportunity-map__marker-halo" r={radius + 5 / transform.k} style={{ fill: color }} />
              <circle className="opportunity-map__marker-core" r={radius} style={{ fill: color }} />
              <circle className="opportunity-map__marker-center" r={Math.max(2.6, radius * 0.22)} />
              {point.trackedCount ? <circle className="opportunity-map__marker-tracked" cx={radius * .72} cy={-radius * .72} r={5 / transform.k} /> : null}
              {showLabel ? <text className="opportunity-map__marker-label" y={-radius - 8 / transform.k} style={{ fontSize: `${12 / transform.k}px`, strokeWidth: `${4 / transform.k}px` }}>{point.label}</text> : null}
              <title>{point.label}\n{money(point.spend)} {point.metricLabel}\n{point.records.length} indexed records</title>
            </g>;
          })}
        </g>
      </g>
    </svg>
    <div className="opportunity-map__map-controls" aria-label="Map controls">
      <button type="button" onClick={() => zoomBy(1.4)} aria-label="Zoom in"><Plus size={17} /></button>
      <button type="button" onClick={() => zoomBy(1 / 1.4)} aria-label="Zoom out"><Minus size={17} /></button>
      <button type="button" onClick={reset} aria-label="Reset map"><LocateFixed size={17} /></button>
    </div>
  </div>;
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
    <div className="opportunity-map__record-facts">
      <strong>{money(recordAmount(record, spendMetric))}</strong>
      <span>{nextDate ? compactDate(nextDate) : "No future date"}</span>
    </div>
    <button type="button" className={watched ? "is-starred" : ""} aria-label={watched ? `Stop tracking ${record.title}` : `Track ${record.title}`} aria-pressed={watched} onClick={() => onToggleWatch(record.opportunityId)}><Star size={16} fill={watched ? "currentColor" : "none"} /></button>
  </article>;
}

function DetailPanel({ point, asOf, watchedIds, onToggleWatch, spendMetric }) {
  if (!point) return <aside className="opportunity-map__detail opportunity-map__detail--empty"><Building2 size={28} /><strong>Select an organization cluster</strong><p>Choose a marker to inspect its organizations, activity, spend, and tracked opportunities.</p></aside>;
  const branch = BRANCHES[point.branch] || BRANCHES.joint;
  const records = [...point.records].sort((left, right) => recordAmount(right, spendMetric) - recordAmount(left, spendMetric));
  return <aside className="opportunity-map__detail" data-opportunity-map-detail>
    <header>
      <span className="opportunity-map__detail-icon" style={{ color: branch.color }}><Building2 size={19} /></span>
      <div><small>{branch.label}</small><h3>{point.label}</h3><p>{point.city}</p></div>
    </header>
    <dl className="opportunity-map__detail-metrics">
      <div><dt>{spendMetric === "potential" ? "Potential" : "Obligated"}</dt><dd>{money(point.spend)}</dd></div>
      <div><dt>Organizations</dt><dd>{point.organizations.length}</dd></div>
      <div><dt>Active</dt><dd>{point.activeCount}</dd></div>
      <div><dt>Upcoming</dt><dd>{point.upcomingCount}</dd></div>
    </dl>
    <section className="opportunity-map__organization-list">
      <span>Mapped activities</span>
      <p>{point.organizations.slice(0, 5).join(" · ")}{point.organizations.length > 5 ? ` · +${point.organizations.length - 5} more` : ""}</p>
    </section>
    <section className="opportunity-map__record-list">
      <header><span>Indexed activity</span><b>{point.records.length}</b></header>
      {records.slice(0, 6).map((record) => <OpportunityRow key={record.opportunityId} record={record} asOf={asOf} watched={watchedIds.has(record.opportunityId)} onToggleWatch={onToggleWatch} spendMetric={spendMetric} />)}
    </section>
    {records.length > 6 ? <a className="opportunity-map__detail-link" href={`#/budget-spend/explorer?spendView=table&capQuery=${encodeURIComponent(point.organizations[0] || point.label)}`}>Open all {records.length} records in Spend Explorer</a> : null}
  </aside>;
}

export default function OpportunityMap({ dataset, awards = [], samOpportunities = { records: [] }, manualProcurement = { records: [] }, procurementDelta = { records: [] }, subawardSnapshot = { primes: [] } }) {
  const records = useMemo(() => applyProcurementChanges(assembleProcurementRecords(dataset.records || [], awards, dataset.metadata.asOf, samOpportunities.records || [], manualProcurement.records || [], subawardSnapshot), procurementDelta.records || []), [awards, dataset, manualProcurement.records, procurementDelta.records, samOpportunities.records, subawardSnapshot]);
  const management = useManagementState(records);
  const [filters, setFilters] = useState(readFilters);
  const asOf = dataset.metadata.asOf || new Date().toISOString().slice(0, 10);

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
    const query = filters.query.trim().toLowerCase();
    const floor = Number(filters.floor || 0);
    const unresolved = [];
    const byLocation = new Map();
    let considered = 0;

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
      const location = resolveOrganizationLocation(name);
      if (!location) { unresolved.push(record); return; }
      if (filters.branch !== "all" && location.branch !== filters.branch) return;
      const current = byLocation.get(location.id) || { ...location, organizations: new Set(), records: [], spend: 0, activeCount: 0, upcomingCount: 0, trackedCount: 0 };
      current.organizations.add(name);
      current.records.push(record);
      current.spend += recordAmount(record, filters.spend);
      if (bucket === "active") current.activeCount += 1;
      if (bucket === "upcoming") current.upcomingCount += 1;
      if (management.watchedIds.has(record.opportunityId)) current.trackedCount += 1;
      byLocation.set(location.id, current);
    });

    const points = [...byLocation.values()]
      .map((point) => ({ ...point, organizations: [...point.organizations].sort(), metricLabel: filters.spend === "potential" ? "potential value" : "obligated spend" }))
      .filter((point) => point.spend >= floor)
      .sort((left, right) => right.spend - left.spend || left.label.localeCompare(right.label));
    const mappedRecords = points.reduce((total, point) => total + point.records.length, 0);
    return {
      points,
      considered,
      mappedRecords,
      unresolved: unresolved.length,
      spend: points.reduce((total, point) => total + point.spend, 0),
      organizations: new Set(points.flatMap((point) => point.organizations)).size,
      tracked: points.reduce((total, point) => total + point.trackedCount, 0),
    };
  }, [asOf, filters, management.watchedIds, records]);

  const selected = model.points.find((point) => point.id === filters.organization) || model.points[0] || null;
  useEffect(() => {
    const canonicalOrganization = selected?.id || "";
    if (canonicalOrganization !== filters.organization) writeFilters({ ...filters, organization: canonicalOrganization });
  }, [filters, selected?.id]);
  const metrics = [
    { id: "organizations", label: "Mapped offices", value: model.organizations.toLocaleString(), meta: `${model.points.length} geographic clusters` },
    { id: "records", label: "Indexed activity", value: model.mappedRecords.toLocaleString(), meta: `${model.considered.toLocaleString()} match filters` },
    { id: "spend", label: filters.spend === "potential" ? "Potential value" : "Obligated spend", value: money(model.spend), meta: "Visible map total", tone: "info" },
    { id: "tracked", label: "Tracked", value: model.tracked.toLocaleString(), meta: `${management.watchlist.length} workspace-wide`, tone: model.tracked ? "success" : "neutral" },
  ];

  return <section className="opportunity-map" data-opportunity-map>
    <ControlWorkbenchHeader eyebrow="Market geography" title="Opportunity Map" summary="See where buying activity is concentrated, size organizations by published spend, and move directly from a place to its active opportunity set." metrics={metrics} metricLabel="Map summary" />
    <ControlPageBody compact>
      <section className="opportunity-map__controls" aria-label="Map filters">
        <div className="opportunity-map__control-row opportunity-map__control-row--primary">
          <label className="opportunity-map__search"><Search size={16} /><span className="sr-only">Search organizations and opportunities</span><input type="search" value={filters.query} onChange={(event) => commit({ query: event.target.value, organization: "" })} placeholder="Search offices, records, portfolios…" /></label>
          <StatusTabs value={filters.status} onChange={(status) => commit({ status, organization: "" })} />
          <button type="button" className="opportunity-map__reset" onClick={() => commit({ ...DEFAULT_FILTERS })}>Reset filters</button>
        </div>
        <div className="opportunity-map__control-row opportunity-map__control-row--secondary">
          <ControlSelect label="Map by" value={filters.by} options={[{ value: "contracting", label: "Contracting activity" }, { value: "funding", label: "Funding organization" }]} onChange={(by) => commit({ by, organization: "" })} />
          <ControlSelect label="Scope" value={filters.scope} options={[{ value: "all", label: "Relevant indexed records" }, { value: "tracked", label: `Tracked only (${management.watchlist.length})` }, { value: "acquisition", label: "Acquisition opportunities" }]} onChange={(scope) => commit({ scope, organization: "" })} />
          <ControlSelect label="Service" value={filters.branch} options={branchOptions()} onChange={(branch) => commit({ branch, organization: "" })} />
          <ControlSelect label="Size by" value={filters.spend} options={[{ value: "obligated", label: "Obligated spend" }, { value: "potential", label: "Potential value" }]} onChange={(spend) => commit({ spend, organization: "" })} />
          <ControlSelect label="Minimum" value={filters.floor} options={[{ value: "0", label: "Any spend" }, { value: "10000000", label: "$10M+" }, { value: "50000000", label: "$50M+" }, { value: "100000000", label: "$100M+" }, { value: "500000000", label: "$500M+" }, { value: "1000000000", label: "$1B+" }]} onChange={(floor) => commit({ floor, organization: "" })} />
        </div>
      </section>

      <div className="opportunity-map__workspace">
        <section className="opportunity-map__map-panel">
          <header className="opportunity-map__map-header">
            <div><Layers3 size={17} /><span><strong>United States acquisition activity</strong><small>{model.points.length} visible clusters · data as of {compactDate(asOf)}</small></span></div>
            <div className="opportunity-map__legend" aria-label="Service legend">{Object.entries(BRANCHES).map(([id, branch]) => <span key={id}><i style={{ background: branch.color }} />{branch.label}</span>)}</div>
          </header>
          {model.points.length ? <MapCanvas points={model.points} selectedId={selected?.id || ""} onSelect={(organization) => commit({ organization })} /> : <div className="opportunity-map__empty"><CircleDollarSign size={28} /><strong>No mapped organizations match these filters</strong><p>Reduce the spend floor, widen the lifecycle, or clear the search to restore activity.</p><button type="button" className="if-btn if-btn--secondary" onClick={() => commit({ ...DEFAULT_FILTERS })}>Reset map</button></div>}
          <footer className="opportunity-map__coverage"><span><b>{model.mappedRecords}</b> mapped records</span><span><b>{model.unresolved}</b> location unresolved</span><p>Locations are resolved from a reviewed office registry. Records with redacted or unrecognized buying offices remain counted as unresolved and are never placed heuristically.</p></footer>
        </section>
        <DetailPanel point={selected} asOf={asOf} watchedIds={management.watchedIds} onToggleWatch={management.toggleWatch} spendMetric={filters.spend} />
      </div>
    </ControlPageBody>
  </section>;
}
