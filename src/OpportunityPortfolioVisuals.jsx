import { useEffect, useMemo, useRef, useState } from "react";
import { forceCollide, forceSimulation, forceX, forceY, max, scaleLinear, scaleSqrt } from "d3";
import { BrainCircuit, CheckSquare2, ExternalLink, FileSpreadsheet, LocateFixed, RotateCcw, Settings2, Sparkles, Waypoints } from "lucide-react";
import { ControlDisclosure, ControlPageBody, ControlTabs } from "control-surface-ui/react";
import ControlSelect from "./ControlSelect.jsx";
import ControlWorkbenchHeader from "./WorkbenchHeader.jsx";
import SearchMultiSelect from "./SearchMultiSelect.jsx";
import StrategySavedViews from "./StrategySavedViews.jsx";
import { useManagementState } from "./management-state.js";
import { TECHNOLOGY_AREA_BY_ID } from "./procurement-taxonomy.js";
import { samNoticeTypeLabel } from "./sam-notice-types.js";
import { fundingStrength, normalizeStrategyConfig, recordSpendFact, scopeSpendSummary, STRATEGY_SPEND_MEASURES, weightedScore } from "./strategic-analysis.js";
import { intelligenceWorkspaceRoute, opportunityRoute } from "./cross-surface-routes.js";
import "./OpportunityPortfolioVisuals.css";

const DAY = 86_400_000;
const STRATEGY_BASELINE_KEY = "dbi:strategy-baseline:v1";
const STAGE_COLORS = Object.freeze({
  award: "#167247",
  solicitation: "#0067a3",
  shaping: "#7a4ca5",
  forecast: "#d97706",
  other: "#60798b",
});

function idOf(record) {
  return record.opportunityId || record.id || record.reference || record.sourceRecordId || "";
}

function valueOf(record) {
  return Math.max(0, ...[
    record.potentialAmount,
    record.valueHigh,
    record.obligatedAmount,
    record.fpdsObligatedAmount,
    record.liveAward?.awardAmountDollars,
  ].map((value) => Number(value || 0)));
}

function money(value) {
  const amount = Number(value || 0);
  if (!amount) return "Not published";
  if (amount >= 1_000_000_000) return `$${(amount / 1_000_000_000).toFixed(amount >= 10_000_000_000 ? 1 : 2)}B`;
  if (amount >= 1_000_000) return `$${(amount / 1_000_000).toFixed(amount >= 10_000_000 ? 1 : 2)}M`;
  return `$${Math.round(amount / 1_000).toLocaleString()}K`;
}

function readableDate(value) {
  if (!value) return "Not published";
  const parsed = new Date(`${String(value).slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) ? "Not published" : parsed.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

function customerOf(record) {
  return [record.organization?.office, record.organization?.component, record.organization?.branch, record.party, record.recipient]
    .find((value) => value && !/not published/i.test(value)) || "Customer not published";
}

function officeOf(record) {
  const value = record.organization?.office;
  return value && !/not published/i.test(value) ? value : "";
}

function stageOf(record) {
  const label = [samNoticeTypeLabel(record.noticeType), record.lifecycleStage, record.mode].filter(Boolean).join(" ").toLowerCase();
  if (label.includes("award")) return "award";
  if (label.includes("solicitation") || label.includes("combined")) return "solicitation";
  if (label.includes("source") || label.includes("rfi") || label.includes("presolicitation")) return "shaping";
  if (label.includes("forecast")) return "forecast";
  return "other";
}

function urgencyOf(record, now) {
  const deadline = record.solicitationEnd || record.responseDeadline;
  if (!deadline) return 12;
  const parsed = Date.parse(`${String(deadline).slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(parsed)) return 12;
  const days = Math.ceil((parsed - now) / DAY);
  if (days <= 0) return 100;
  if (days <= 14) return 92;
  if (days <= 30) return 80;
  if (days <= 60) return 68;
  if (days <= 90) return 55;
  if (days <= 180) return 38;
  return 22;
}

function trustLabel(record) {
  return String(record.evidenceTier || "unclassified").replaceAll("-", " ");
}

function titleOf(record, length = 52) {
  const title = String(record.title || idOf(record) || "Untitled opportunity");
  return title.length > length ? `${title.slice(0, length - 1)}…` : title;
}

function readStrategyBaseline() {
  if (typeof window === "undefined") return null;
  try {
    const parsed = JSON.parse(window.localStorage.getItem(STRATEGY_BASELINE_KEY) || "null");
    if (!parsed || !Array.isArray(parsed.buyers) || !Array.isArray(parsed.capabilities)) return null;
    return {
      buyers: [...new Set(parsed.buyers.filter((value) => typeof value === "string" && value))],
      capabilities: [...new Set(parsed.capabilities.filter((value) => typeof value === "string" && value))],
    };
  } catch {
    return null;
  }
}

function writeStrategyBaseline(value) {
  if (typeof window === "undefined") return;
  try {
    if (value) window.localStorage.setItem(STRATEGY_BASELINE_KEY, JSON.stringify(value));
    else window.localStorage.removeItem(STRATEGY_BASELINE_KEY);
  } catch {
    // A blocked browser store leaves the strategy board usable for the current session.
  }
}

function strategyConfigFromUrl(baseline) {
  if (typeof window === "undefined") return normalizeStrategyConfig({}, baseline);
  const params = new URLSearchParams(window.location.hash.split("?")[1] || "");
  const parseWeights = (name, keys) => {
    const raw = params.get(name);
    if (!raw) return undefined;
    const values = raw.split(",").map(Number);
    return Object.fromEntries(keys.map((key, index) => [key, values[index]]));
  };
  return normalizeStrategyConfig({
    lens: params.get("strategyLens"),
    view: params.get("strategyView"),
    spendMeasure: params.get("spendMeasure"),
    fiscalYear: params.get("fiscalYear"),
    trackedOnly: params.get("trackedOnly") === "1",
    stage: params.get("strategyStage"),
    minimumFit: params.get("minimumFit"),
    threshold: params.get("strategyThreshold"),
    buyers: params.getAll("strategyBuyer"),
    capabilities: params.getAll("strategyCapability"),
    attractivenessWeights: parseWeights("strategyAttractiveness", ["fit", "urgency", "funding", "evidence"]),
    abilityWeights: parseWeights("strategyAbility", ["customer", "capability", "route", "pursuit"]),
  }, baseline);
}

function writeStrategyConfigToUrl(config) {
  const [path, search = ""] = window.location.hash.split("?");
  const params = new URLSearchParams(search);
  const set = (key, value, fallback = "") => { if (String(value) && String(value) !== String(fallback)) params.set(key, String(value)); else params.delete(key); };
  set("strategyLens", config.lens, "ansoff");
  set("strategyView", config.view, "customer");
  set("spendMeasure", config.spendMeasure, "request");
  set("fiscalYear", config.fiscalYear, 2027);
  set("trackedOnly", config.trackedOnly ? "1" : "", "");
  set("strategyStage", config.stage, "all");
  set("minimumFit", config.minimumFit, 0);
  set("strategyThreshold", config.threshold, 50);
  set("strategyAttractiveness", Object.values(config.attractivenessWeights).join(","), "35,25,25,15");
  set("strategyAbility", Object.values(config.abilityWeights).join(","), "30,30,25,15");
  params.delete("strategyBuyer");
  params.delete("strategyCapability");
  config.buyers.slice(0, 40).forEach((value) => params.append("strategyBuyer", value));
  config.capabilities.slice(0, 20).forEach((value) => params.append("strategyCapability", value));
  window.history.replaceState(null, "", `${path}?${params}`);
}

const ANSOFF_QUADRANTS = Object.freeze([
  { id: "a", code: "A", name: "Deepen", strategy: "Market penetration", row: "current", column: "demonstrated", proof: "Retained customer results and available delivery capacity." },
  { id: "c", code: "C", name: "Develop", strategy: "Service development", row: "current", column: "new", proof: "Buyer acceptance, technical proof, and repeatable economics." },
  { id: "b", code: "B", name: "Transfer", strategy: "Market development", row: "new", column: "demonstrated", proof: "A sponsor, buying route, and delivery fit in the new account." },
  { id: "d", code: "D", name: "Extend selectively", strategy: "Related diversification", row: "new", column: "new", proof: "Buyer access, technical proof, contract path, and adoption funding." },
]);

function StrategicMatrix({ records, watchedIds, watchlist, selectedId, onSelect, onQuadrant, config, onConfig, spendByActivity }) {
  const [editing, setEditing] = useState(false);
  const watchById = useMemo(() => new Map(watchlist.map((entry) => [entry.recordId, entry])), [watchlist]);
  const derivedBaseline = useMemo(() => {
    const tracked = records.filter((record) => watchedIds.has(idOf(record)));
    return {
      buyers: [...new Set(tracked.map(officeOf).filter(Boolean))].sort(),
      capabilities: [...new Set(tracked.flatMap((record) => record.technologyAreas || []))].sort(),
    };
  }, [records, watchedIds]);
  const hasConfiguredBaseline = config.buyers?.length || config.capabilities?.length;
  const baseline = useMemo(() => hasConfiguredBaseline
    ? { buyers: config.buyers || [], capabilities: config.capabilities || [] }
    : readStrategyBaseline() || derivedBaseline, [config.buyers, config.capabilities, derivedBaseline, hasConfiguredBaseline]);
  const buyerOptions = useMemo(() => [...new Set(records.map(officeOf).filter(Boolean))].sort().map((value) => ({ value, label: value })), [records]);
  const capabilityOptions = useMemo(() => [...new Set(records.flatMap((record) => record.technologyAreas || []))].sort((left, right) => (TECHNOLOGY_AREA_BY_ID.get(left)?.label || left).localeCompare(TECHNOLOGY_AREA_BY_ID.get(right)?.label || right)).map((value) => ({ value, label: TECHNOLOGY_AREA_BY_ID.get(value)?.label || value })), [records]);
  const hasBaseline = baseline.buyers.length > 0 && baseline.capabilities.length > 0;
  const classified = useMemo(() => {
    if (!hasBaseline) return { placements: [], unclassified: records };
    const buyers = new Set(baseline.buyers);
    const capabilities = new Set(baseline.capabilities);
    const placements = [];
    const unclassified = [];
    for (const record of records) {
      const buyer = officeOf(record);
      const areas = [...new Set(record.technologyAreas || [])];
      if (!buyer || !areas.length) { unclassified.push(record); continue; }
      const buyerCurrent = buyers.has(buyer);
      const capabilityCurrent = areas.some((area) => capabilities.has(area));
      const quadrant = buyerCurrent ? (capabilityCurrent ? "a" : "c") : (capabilityCurrent ? "b" : "d");
      placements.push({ record, quadrant, buyer, areas, buyerCurrent, capabilityCurrent });
    }
    return { placements, unclassified };
  }, [baseline, hasBaseline, records]);
  const quadrantRows = useMemo(() => new Map(ANSOFF_QUADRANTS.map((quadrant) => {
    const rows = classified.placements.filter((placement) => placement.quadrant === quadrant.id).sort((left, right) => Number(watchedIds.has(idOf(right.record))) - Number(watchedIds.has(idOf(left.record))) || Number(right.record.fitAssessment?.score || 0) - Number(left.record.fitAssessment?.score || 0) || valueOf(right.record) - valueOf(left.record));
    return [quadrant.id, rows];
  })), [classified.placements, watchedIds]);
  const view = config.view;
  const updateBaseline = (patch) => {
    const next = { ...baseline, ...patch };
    writeStrategyBaseline(next);
    onConfig({ ...config, buyers: next.buyers, capabilities: next.capabilities });
  };
  const resetBaseline = () => {
    writeStrategyBaseline(null);
    onConfig({ ...config, buyers: derivedBaseline.buyers, capabilities: derivedBaseline.capabilities });
  };
  return <section className="strategy-matrix" data-strategic-matrix data-strategy-view={view}>
    <header className="strategy-matrix__header">
      <div><span>Growth architecture</span><h3>Ansoff strategic matrix</h3><p>{view === "customer" ? "Customers and the work required to expand." : "Capabilities and service offers positioned for growth."}</p></div>
      <div className="strategy-matrix__controls">
        <ControlTabs fill className="strategy-matrix__switch" ariaLabel="Strategy matrix view" activeId={view} onSelect={(next) => onConfig({ ...config, view: next })} items={[["customer", "Customer view"], ["capability", "Capability view"]]} />
        <button type="button" className="if-btn if-btn--secondary" aria-expanded={editing} onClick={() => setEditing((value) => !value)}><Settings2 size={15} />Baseline</button>
      </div>
    </header>
    <div className="strategy-matrix__baseline" data-strategy-baseline-summary>
      <span><b>{baseline.buyers.length}</b> current buying centers</span><span><b>{baseline.capabilities.length}</b> demonstrated capabilities</span><span><b>{classified.unclassified.length}</b> need classification</span><small>{hasConfiguredBaseline ? "Configured strategy baseline" : "Baseline seeded from My Work"}</small>
    </div>
    {editing || !hasBaseline ? <section className="strategy-matrix__editor" aria-label="Strategy baseline editor">
      <div><strong>Define what is already established</strong><p>Only selected buying centers and capabilities are treated as current. Everything else remains new or unclassified; DBI does not infer corporate experience.</p></div>
      <SearchMultiSelect title="Current buying centers" allLabel="Select established buyers" value={JSON.stringify(baseline.buyers)} options={buyerOptions} maxSelected={40} onChange={(buyers) => updateBaseline({ buyers })} />
      <SearchMultiSelect title="Demonstrated capabilities" allLabel="Select proven capabilities" value={JSON.stringify(baseline.capabilities)} options={capabilityOptions} maxSelected={20} onChange={(capabilities) => updateBaseline({ capabilities })} />
      {hasConfiguredBaseline ? <button type="button" className="if-btn if-btn--secondary" onClick={resetBaseline}><RotateCcw size={14} />Reset to My Work</button> : null}
    </section> : null}
    {hasBaseline ? <div className="strategy-matrix__board">
      <div className="strategy-matrix__corner" />
      <div className="strategy-matrix__axis strategy-matrix__axis--column"><strong>Demonstrated services</strong><span>Established delivery</span></div>
      <div className="strategy-matrix__axis strategy-matrix__axis--column"><strong>New service offers</strong><span>New capability or delivery model</span></div>
      <div className="strategy-matrix__axis strategy-matrix__axis--row"><strong>Current buying centers</strong></div>
      {ANSOFF_QUADRANTS.slice(0, 2).map((quadrant) => <StrategyQuadrant key={quadrant.id} quadrant={quadrant} rows={quadrantRows.get(quadrant.id) || []} view={view} watchedIds={watchedIds} watchById={watchById} selectedId={selectedId} onSelect={onSelect} onQuadrant={onQuadrant} config={config} spendByActivity={spendByActivity} />)}
      <div className="strategy-matrix__axis strategy-matrix__axis--row"><strong>New buying centers</strong></div>
      {ANSOFF_QUADRANTS.slice(2).map((quadrant) => <StrategyQuadrant key={quadrant.id} quadrant={quadrant} rows={quadrantRows.get(quadrant.id) || []} view={view} watchedIds={watchedIds} watchById={watchById} selectedId={selectedId} onSelect={onSelect} onQuadrant={onQuadrant} config={config} spendByActivity={spendByActivity} />)}
    </div> : <div className="if-alert if-alert--info" role="status"><Settings2 size={17} /><span><strong>Set the strategy baseline</strong> Select at least one current buying center and one demonstrated capability to classify the active portfolio without guessing.</span></div>}
    <footer className="strategy-matrix__footer"><span>Placement is deterministic from the editable baseline and retained buyer/capability evidence.</span><span>{classified.placements.length.toLocaleString()} classified · {classified.unclassified.length.toLocaleString()} unclassified</span></footer>
  </section>;
}

function StrategyQuadrant({ quadrant, rows, view, watchedIds, watchById, selectedId, onSelect, onQuadrant, config, spendByActivity }) {
  const visible = rows.slice(0, 4);
  const spend = scopeSpendSummary(rows.map(({ record }) => idOf(record)), spendByActivity, config.spendMeasure, config.fiscalYear);
  const spendLabel = config.spendMeasure === "request" ? `FY${config.fiscalYear} requests` : config.spendMeasure === "obligations" ? "Exact obligations" : "Published awards";
  return <article className={`strategy-quadrant strategy-quadrant--${quadrant.id}`} data-strategy-quadrant={quadrant.id}>
    <header><div><strong>{quadrant.code} / {quadrant.name}</strong><span>{quadrant.strategy}</span></div><b>{rows.length}</b></header>
    <div className="strategy-quadrant__spend"><span>{spendLabel}</span><strong>{money(spend.value)}</strong><small>{spend.coveredRecords} of {rows.length} records · {spend.factCount} deduplicated facts</small></div>
    <div className="strategy-quadrant__list">
      {visible.length ? visible.map(({ record, buyer, areas }) => {
        const id = idOf(record);
        const pursuit = watchById.get(id)?.pursuit;
        const primary = view === "customer" ? buyer : areas.map((area) => TECHNOLOGY_AREA_BY_ID.get(area)?.label || area).slice(0, 2).join(" · ");
        const fact = recordSpendFact(id, spendByActivity, config.spendMeasure, config.fiscalYear);
        return <button key={id} type="button" className={id === selectedId ? "is-selected" : ""} onClick={() => onSelect(id)}>
          <span className="strategy-quadrant__title">{primary}</span>
          <strong>{titleOf(record, 68)}</strong>
          <small>{fact.coverage ? `${money(fact.value)} ${spendLabel.toLowerCase()}` : money(valueOf(record))} · fit {Number(record.fitAssessment?.score || 0)} · {watchedIds.has(id) ? pursuit?.owner || "tracked" : trustLabel(record)}</small>
          <em>{pursuit?.nextAction || (watchedIds.has(id) ? "No next action" : "Open evidence and qualify")}</em>
        </button>;
      }) : <p>No classified opportunities in this quadrant.</p>}
    </div>
    <div className="strategy-quadrant__proof"><span>Proof to expand</span><p>{quadrant.proof}</p>{rows.length ? <button type="button" onClick={() => onQuadrant({ ...quadrant, key: `ansoff-${quadrant.id}`, label: `${quadrant.code} / ${quadrant.name}` }, rows.map(({ record }) => idOf(record)))}>Review {rows.length} in queue</button> : null}</div>
  </article>;
}

const WIN_QUADRANTS = Object.freeze([
  { id: "selective", code: "A", name: "Selective bet", row: "high", column: "low", proof: "Confirm strategic importance or free capacity before increasing capture investment." },
  { id: "pursue", code: "B", name: "Pursue now", row: "high", column: "high", proof: "Protect the next action, buyer access, contract path, and decision timeline." },
  { id: "deprioritize", code: "C", name: "Deprioritize", row: "low", column: "low", proof: "Hold until stronger funding, fit, evidence, or a credible access route emerges." },
  { id: "position", code: "D", name: "Build position", row: "low", column: "high", proof: "Close the buyer, capability, vehicle, or pursuit-readiness gap before bidding." },
]);

function evidenceScore(record) {
  const tier = trustLabel(record).toLowerCase();
  const base = tier.includes("exact") || tier.includes("primary") ? 95 : tier.includes("source") || tier.includes("verified") ? 80 : tier.includes("derived") || tier.includes("classified") ? 58 : 35;
  return Math.min(100, base + Math.min(10, Number(record.sourceRoleCount || record.sourceUrls?.length || 0) * 2));
}

function pursuitReadiness(pursuit) {
  if (!pursuit) return 10;
  const stage = { monitor: 20, qualify: 38, capture: 62, proposal: 82, submitted: 90, won: 100, lost: 0 }[pursuit.stage] ?? 20;
  return Math.min(100, stage + (pursuit.owner ? 8 : 0) + (pursuit.nextAction ? 7 : 0) + (pursuit.tasks?.some((task) => task.status !== "done") ? 5 : 0));
}

function scoreStrategicRecord(record, config, watchById, spendByActivity, snapshotTime) {
  const id = idOf(record);
  const areas = record.technologyAreas || [];
  const pursuit = watchById.get(id)?.pursuit;
  const spendEntry = spendByActivity?.[id];
  const currentBuyer = config.buyers.includes(officeOf(record));
  const demonstratedCapability = areas.some((area) => config.capabilities.includes(area));
  const exactFunding = fundingStrength(id, spendByActivity, config.fiscalYear, valueOf(record));
  const evidence = evidenceScore(record);
  const attractivenessParts = { fit: Number(record.fitAssessment?.score || 0), urgency: urgencyOf(record, snapshotTime), funding: exactFunding, evidence };
  const abilityParts = {
    customer: currentBuyer ? 100 : pursuit?.owner ? 60 : watchById.has(id) ? 40 : 15,
    capability: demonstratedCapability ? 100 : areas.length ? 22 : 0,
    route: spendEntry?.hasVehicle ? 100 : spendEntry?.awardFacts?.length ? 78 : record.acquisitionRoute ? 55 : 15,
    pursuit: pursuitReadiness(pursuit),
  };
  const attractiveness = weightedScore(attractivenessParts, config.attractivenessWeights);
  const ability = weightedScore(abilityParts, config.abilityWeights);
  const threshold = config.threshold;
  const quadrant = ability >= threshold ? (attractiveness >= threshold ? "pursue" : "selective") : (attractiveness >= threshold ? "position" : "deprioritize");
  const gaps = [!currentBuyer && "customer access", !demonstratedCapability && "capability proof", !spendEntry?.hasVehicle && "contract route", !pursuit?.nextAction && "next action"].filter(Boolean);
  return { record, id, attractiveness, ability, quadrant, gaps, attractivenessParts, abilityParts };
}

function WinReadinessMatrix({ records, config, watchlist, selectedId, onSelect, onQuadrant, spendByActivity, snapshotTime }) {
  const watchById = useMemo(() => new Map(watchlist.map((entry) => [entry.recordId, entry])), [watchlist]);
  const scored = useMemo(() => records.map((record) => scoreStrategicRecord(record, config, watchById, spendByActivity, snapshotTime)), [config, records, snapshotTime, spendByActivity, watchById]);
  const rowsByQuadrant = useMemo(() => new Map(WIN_QUADRANTS.map((quadrant) => [quadrant.id, scored.filter((entry) => entry.quadrant === quadrant.id).sort((left, right) => (right.attractiveness + right.ability) - (left.attractiveness + left.ability) || valueOf(right.record) - valueOf(left.record))])), [scored]);
  return <section className="strategy-matrix strategy-matrix--win" data-win-readiness-matrix>
    <header className="strategy-matrix__header"><div><span>Operational portfolio</span><h3>Attractiveness × ability to win</h3><p>Evidence-weighted prioritization, not probability of win. Every score exposes its retained components and gaps.</p></div><div className="strategy-matrix__threshold"><span>Decision threshold</span><strong>{config.threshold}</strong></div></header>
    <div className="strategy-matrix__baseline"><span><b>{scored.filter((entry) => entry.attractiveness >= config.threshold).length}</b> attractive</span><span><b>{scored.filter((entry) => entry.ability >= config.threshold).length}</b> positioned</span><span><b>{scored.filter((entry) => entry.gaps.length).length}</b> with evidence gaps</span><small>Scores are explainable proxies, never win probability</small></div>
    <div className="strategy-matrix__board">
      <div className="strategy-matrix__corner" />
      <div className="strategy-matrix__axis strategy-matrix__axis--column"><strong>Lower attractiveness</strong><span>Monitor or validate the market signal</span></div>
      <div className="strategy-matrix__axis strategy-matrix__axis--column"><strong>Higher attractiveness</strong><span>Fit, urgency, funding, and evidence</span></div>
      <div className="strategy-matrix__axis strategy-matrix__axis--row"><strong>Higher ability to win</strong></div>
      {WIN_QUADRANTS.slice(0, 2).map((quadrant) => <WinQuadrant key={quadrant.id} quadrant={quadrant} rows={rowsByQuadrant.get(quadrant.id) || []} selectedId={selectedId} onSelect={onSelect} onQuadrant={onQuadrant} config={config} spendByActivity={spendByActivity} />)}
      <div className="strategy-matrix__axis strategy-matrix__axis--row"><strong>Lower ability to win</strong></div>
      {WIN_QUADRANTS.slice(2).map((quadrant) => <WinQuadrant key={quadrant.id} quadrant={quadrant} rows={rowsByQuadrant.get(quadrant.id) || []} selectedId={selectedId} onSelect={onSelect} onQuadrant={onQuadrant} config={config} spendByActivity={spendByActivity} />)}
    </div>
    <footer className="strategy-matrix__footer"><span>Ability combines explicit customer/capability baselines, retained contract access, and pursuit readiness.</span><span>{scored.length.toLocaleString()} classified</span></footer>
  </section>;
}

function WinQuadrant({ quadrant, rows, selectedId, onSelect, onQuadrant, config, spendByActivity }) {
  const spend = scopeSpendSummary(rows.map((entry) => entry.id), spendByActivity, config.spendMeasure, config.fiscalYear);
  const spendLabel = config.spendMeasure === "request" ? `FY${config.fiscalYear} requests` : config.spendMeasure === "obligations" ? "Exact obligations" : "Published awards";
  return <article className={`strategy-quadrant strategy-quadrant--${quadrant.id}`} data-win-quadrant={quadrant.id}>
    <header><div><strong>{quadrant.code} / {quadrant.name}</strong><span>{quadrant.id === "pursue" ? "Act now" : quadrant.id === "position" ? "Close position gaps" : quadrant.id === "selective" ? "Use capacity selectively" : "Hold or exit"}</span></div><b>{rows.length}</b></header>
    <div className="strategy-quadrant__spend"><span>{spendLabel}</span><strong>{money(spend.value)}</strong><small>{spend.coveredRecords} of {rows.length} records · {spend.factCount} deduplicated facts</small></div>
    <div className="strategy-quadrant__list">{rows.slice(0, 4).map((entry) => {
      const fact = recordSpendFact(entry.id, spendByActivity, config.spendMeasure, config.fiscalYear);
      return <button key={entry.id} type="button" className={entry.id === selectedId ? "is-selected" : ""} onClick={() => onSelect(entry.id)}><span className="strategy-quadrant__title">{customerOf(entry.record)}</span><strong>{titleOf(entry.record, 68)}</strong><small>Attractiveness {entry.attractiveness} · ability {entry.ability}{fact.coverage ? ` · ${money(fact.value)}` : ""}</small><em>{entry.gaps.length ? `Close: ${entry.gaps.slice(0, 2).join(" · ")}` : "Position is supported by retained evidence"}</em></button>;
    })}{rows.length ? null : <p>No opportunities currently score into this quadrant.</p>}</div>
    <div className="strategy-quadrant__proof"><span>Recommended action</span><p>{quadrant.proof}</p>{rows.length ? <button type="button" onClick={() => onQuadrant({ ...quadrant, key: `win-${quadrant.id}`, label: quadrant.name }, rows.map((entry) => entry.id))}>Review {rows.length} in queue</button> : null}</div>
  </article>;
}

function hashOffset(value, magnitude) {
  const hash = [...String(value)].reduce((total, character) => ((total * 31) + character.charCodeAt(0)) >>> 0, 7);
  return ((hash % 101) / 100 - 0.5) * magnitude;
}

function PortfolioMap({ records, selectedId, watchedIds, onSelect, snapshotTime }) {
  const scrollRef = useRef(null);
  const width = 960;
  const height = 430;
  const x = useMemo(() => scaleLinear().domain([0, 100]).range([78, 916]).clamp(true), []);
  const y = useMemo(() => scaleLinear().domain([0, 100]).range([358, 34]).clamp(true), []);
  const largest = useMemo(() => max(records, valueOf) || 1, [records]);
  const radius = useMemo(() => scaleSqrt().domain([0, largest]).range([7, 31]), [largest]);
  const plotted = useMemo(() => {
    const nodes = [...records]
      .sort((left, right) => Number(watchedIds.has(idOf(right))) - Number(watchedIds.has(idOf(left))) || Number(right.fitAssessment?.score || 0) - Number(left.fitAssessment?.score || 0) || valueOf(right) - valueOf(left))
      .slice(0, 90)
      .map((record) => {
        const id = idOf(record);
        const fit = Number(record.fitAssessment?.score || 0);
        const urgency = urgencyOf(record, snapshotTime);
        const r = radius(valueOf(record));
        const targetX = x(fit) + hashOffset(id, 10);
        const targetY = y(urgency) + hashOffset(`${id}:y`, 8);
        return { record, id, fit, urgency, r, targetX, targetY, x: targetX, y: targetY };
      });
    const simulation = forceSimulation(nodes)
      .alpha(1)
      .alphaDecay(0.045)
      .velocityDecay(0.38)
      .force("x", forceX((node) => node.targetX).strength(0.62))
      .force("y", forceY((node) => node.targetY).strength(0.62))
      .force("collision", forceCollide((node) => Math.max(node.r, 22) + 2).iterations(3))
      .stop();
    for (let index = 0; index < 120; index += 1) simulation.tick();
    for (const node of nodes) {
      node.x = Math.max(78 + node.r, Math.min(916 - node.r, node.x));
      node.y = Math.max(34 + node.r, Math.min(358 - node.r, node.y));
    }
    return nodes;
  }, [radius, records, snapshotTime, watchedIds, x, y]);
  useEffect(() => {
    const viewport = scrollRef.current;
    if (!viewport || window.innerWidth > 760 || viewport.scrollWidth <= viewport.clientWidth) return;
    viewport.scrollLeft = Math.round((viewport.scrollWidth - viewport.clientWidth) * 0.58);
  }, [plotted]);

  return <div ref={scrollRef} className="target-d3-scroll" data-opportunity-portfolio-map>
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-labelledby="portfolio-map-title portfolio-map-desc">
      <title id="portfolio-map-title">Opportunity portfolio priority map</title>
      <desc id="portfolio-map-desc">Fit score on the horizontal axis, response urgency on the vertical axis, bubble area by reported value, color by acquisition stage, and a green ring for tracked work.</desc>
      {[0, 25, 50, 75, 100].map((tick) => <g key={`y-${tick}`}><line x1="78" x2="916" y1={y(tick)} y2={y(tick)} className="target-gridline" /><text x="68" y={y(tick) + 4} textAnchor="end" className="target-axis-label">{tick}</text></g>)}
      {[0, 25, 50, 75, 100].map((tick) => <g key={`x-${tick}`}><line y1="34" y2="358" x1={x(tick)} x2={x(tick)} className="target-gridline" /><text x={x(tick)} y="381" textAnchor="middle" className="target-axis-label">{tick}</text></g>)}
      <text x="497" y="414" textAnchor="middle" className="target-axis-title">Explainable fit score</text>
      <text transform="translate(20 196) rotate(-90)" textAnchor="middle" className="target-axis-title">Decision urgency</text>
      {plotted.map((node, index) => {
        const { record, id, fit, urgency, r } = node;
        const tracked = watchedIds.has(id);
        const selected = id === selectedId;
        const cx = node.x;
        const cy = node.y;
        const stage = stageOf(record);
        return <g key={id || index} className="target-bubble" role="button" tabIndex="0" aria-label={`${record.title || id}, fit ${fit}, urgency ${urgency}, ${money(valueOf(record))}${tracked ? ", tracked" : ""}`} onClick={() => onSelect(id)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSelect(id); } }}>
          <circle className="target-bubble__hit" cx={cx} cy={cy} r={Math.max(r, 22)} />
          <circle className="target-bubble__mark" cx={cx} cy={cy} r={r} fill={STAGE_COLORS[stage]} fillOpacity={selected ? 0.95 : 0.72} style={{ stroke: selected ? "#061f33" : tracked ? "#167247" : "#fff", strokeWidth: selected ? 5 : tracked ? 4 : 2 }}>
            <title>{`${record.title || id}\nFit ${fit} · urgency ${urgency}\nReported value ${money(valueOf(record))}\n${customerOf(record)} · ${trustLabel(record)}`}</title>
          </circle>
          {(selected || tracked || index < 7) ? <text x={cx} y={cy + 3} textAnchor="middle">{fit}</text> : null}
        </g>;
      })}
    </svg>
    <div className="target-chart-legend">
      {Object.entries(STAGE_COLORS).map(([stage, color]) => <span key={stage}><i style={{ background: color }} />{stage}</span>)}
      <span><i style={{ background: "#fff", border: "2px solid #167247" }} />tracked</span>
      <small>Bubble area = reported value · absence is shown as a small bubble</small>
    </div>
  </div>;
}

function BuyerCapabilityHeatmap({ records, metric, onScope }) {
  const officeTotals = new Map();
  const capabilityTotals = new Map();
  const cells = new Map();
  for (const record of records) {
    const office = officeOf(record);
    if (!office) continue;
    const capabilities = [...new Set(record.technologyAreas || [])];
    if (!capabilities.length) continue;
    officeTotals.set(office, (officeTotals.get(office) || 0) + 1);
    for (const capability of capabilities) {
      capabilityTotals.set(capability, (capabilityTotals.get(capability) || 0) + 1);
      const key = `${office}|${capability}`;
      const cell = cells.get(key) || { count: 0, value: 0, fit: 0 };
      cell.count += 1;
      cell.value = Math.max(cell.value, valueOf(record));
      cell.fit += Number(record.fitAssessment?.score || 0);
      cells.set(key, cell);
    }
  }
  const offices = [...officeTotals].sort((left, right) => right[1] - left[1]).slice(0, 8).map(([name]) => name);
  const capabilities = [...capabilityTotals].sort((left, right) => right[1] - left[1]).slice(0, 6).map(([id]) => id);
  const scoreOf = (cell) => metric === "value" ? cell.value : metric === "fit" ? cell.fit / Math.max(cell.count, 1) : cell.count;
  const maximum = max([...cells.values()], scoreOf) || 1;
  const width = 960;
  const left = 236;
  const top = 96;
  const cellWidth = (width - left - 18) / Math.max(capabilities.length, 1);
  const cellHeight = 46;
  const height = top + offices.length * cellHeight + 26;
  return <div className="target-d3-scroll" data-buyer-capability-heatmap>
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-labelledby="buyer-capability-title buyer-capability-desc">
      <title id="buyer-capability-title">Buyer and capability opportunity heatmap</title>
      <desc id="buyer-capability-desc">Top published buying offices by classified technology area. Color intensity represents the selected measure. Empty cells mean no matching retained records, not proven market whitespace.</desc>
      {capabilities.map((capability, index) => <text key={capability} className="target-matrix__column" transform={`translate(${left + index * cellWidth + cellWidth / 2} ${top - 12}) rotate(-34)`} textAnchor="start">{TECHNOLOGY_AREA_BY_ID.get(capability)?.label || capability}</text>)}
      {offices.map((office, rowIndex) => <g key={office}>
        <text className="target-matrix__row" x={left - 10} y={top + rowIndex * cellHeight + cellHeight / 2 + 4} textAnchor="end">{titleOf({ title: office }, 36)}</text>
        {capabilities.map((capability, columnIndex) => {
          const cell = cells.get(`${office}|${capability}`);
          const x = left + columnIndex * cellWidth;
          const y = top + rowIndex * cellHeight;
          if (!cell) return <rect key={capability} x={x + 2} y={y + 2} width={cellWidth - 4} height={cellHeight - 4} className="target-matrix__empty" />;
          const score = scoreOf(cell);
          const opacity = 0.18 + (score / maximum) * 0.82;
          const primary = metric === "value" ? money(cell.value) : metric === "fit" ? Math.round(cell.fit / cell.count) : cell.count;
          const secondary = metric === "value" ? `${cell.count} records` : metric === "fit" ? `${cell.count} records` : `max ${money(cell.value)}`;
          return <g key={capability} className="target-matrix__cell" role="button" tabIndex="0" aria-label={`${office}, ${TECHNOLOGY_AREA_BY_ID.get(capability)?.label || capability}, ${cell.count} records, largest reported value ${money(cell.value)}`} onClick={() => onScope(office, capability)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onScope(office, capability); } }}>
            <rect x={x + 2} y={y + 2} width={cellWidth - 4} height={cellHeight - 4} style={{ opacity }} />
            <text x={x + cellWidth / 2} y={y + 21} textAnchor="middle">{primary}</text>
            <text x={x + cellWidth / 2} y={y + 34} textAnchor="middle" className="target-matrix__score">{secondary}</text>
            <title>{`${office}\n${TECHNOLOGY_AREA_BY_ID.get(capability)?.label || capability}\n${cell.count} records · largest reported value ${money(cell.value)}\nAverage fit ${Math.round(cell.fit / cell.count)}`}</title>
          </g>;
        })}
      </g>)}
    </svg>
  </div>;
}

function WeightControl({ label, value, onChange }) {
  return <label className="strategy-config__weight"><span>{label}<b>{value}</b></span><input type="range" min="0" max="100" step="5" value={value} onChange={(event) => onChange(Number(event.target.value))} /></label>;
}

function StrategyConfiguration({ config, onChange, buyerOptions, capabilityOptions, spendMeta }) {
  const patch = (values) => onChange({ ...config, ...values });
  const updateWeight = (group, key, value) => patch({ [group]: { ...config[group], [key]: value } });
  return <details className="strategy-config" data-strategy-configuration>
    <summary><Settings2 size={15} />Configure analysis<span>{config.trackedOnly ? "Tracked only" : "All active"} · fit {config.minimumFit}+ · {config.stage === "all" ? "all stages" : config.stage}</span></summary>
    <div className="strategy-config__grid">
      <ControlSelect compact label="Strategy lens" value={config.lens} options={[["ansoff", "Ansoff growth"], ["win-readiness", "Attractiveness × ability"]]} onChange={(lens) => patch({ lens })} />
      <ControlSelect compact label="Spend measure" value={config.spendMeasure} options={STRATEGY_SPEND_MEASURES} onChange={(spendMeasure) => patch({ spendMeasure })} />
      {config.spendMeasure === "request" ? <ControlSelect compact label="Budget request year" value={String(config.fiscalYear)} options={(spendMeta?.fiscalYears || [2025, 2026, 2027]).map((year) => [String(year), `FY${year}`])} onChange={(fiscalYear) => patch({ fiscalYear: Number(fiscalYear) })} /> : <div className="strategy-config__boundary"><span>Fiscal year</span><strong>Not applied</strong><small>This retained measure has no comparable fiscal-year field.</small></div>}
      <ControlSelect compact label="Acquisition stage" value={config.stage} options={[["all", "All stages"], ["award", "Award"], ["solicitation", "Solicitation"], ["shaping", "Shaping"], ["forecast", "Forecast"], ["other", "Other"]]} onChange={(stage) => patch({ stage })} />
      <label className="strategy-config__weight"><span>Minimum fit<b>{config.minimumFit}</b></span><input type="range" min="0" max="90" step="5" value={config.minimumFit} onChange={(event) => patch({ minimumFit: Number(event.target.value) })} /></label>
      <label className="strategy-config__check"><input type="checkbox" checked={config.trackedOnly} onChange={(event) => patch({ trackedOnly: event.target.checked })} /><span><strong>Tracked work only</strong><small>Restrict the board to My Work.</small></span></label>
    </div>
    <div className="strategy-config__baselines"><SearchMultiSelect title="Current buying centers" allLabel="Select established buyers" value={JSON.stringify(config.buyers)} options={buyerOptions} maxSelected={40} onChange={(buyers) => patch({ buyers })} /><SearchMultiSelect title="Demonstrated capabilities" allLabel="Select proven capabilities" value={JSON.stringify(config.capabilities)} options={capabilityOptions} maxSelected={20} onChange={(capabilities) => patch({ capabilities })} /></div>
    {config.lens === "win-readiness" ? <div className="strategy-config__weights"><section><header><strong>Attractiveness weights</strong><small>Normalized automatically</small></header><WeightControl label="Fit" value={config.attractivenessWeights.fit} onChange={(value) => updateWeight("attractivenessWeights", "fit", value)} /><WeightControl label="Urgency" value={config.attractivenessWeights.urgency} onChange={(value) => updateWeight("attractivenessWeights", "urgency", value)} /><WeightControl label="Funding" value={config.attractivenessWeights.funding} onChange={(value) => updateWeight("attractivenessWeights", "funding", value)} /><WeightControl label="Evidence" value={config.attractivenessWeights.evidence} onChange={(value) => updateWeight("attractivenessWeights", "evidence", value)} /></section><section><header><strong>Ability weights</strong><small>Evidence proxy, not win probability</small></header><WeightControl label="Customer access" value={config.abilityWeights.customer} onChange={(value) => updateWeight("abilityWeights", "customer", value)} /><WeightControl label="Capability proof" value={config.abilityWeights.capability} onChange={(value) => updateWeight("abilityWeights", "capability", value)} /><WeightControl label="Contract route" value={config.abilityWeights.route} onChange={(value) => updateWeight("abilityWeights", "route", value)} /><WeightControl label="Pursuit readiness" value={config.abilityWeights.pursuit} onChange={(value) => updateWeight("abilityWeights", "pursuit", value)} /></section><label className="strategy-config__weight strategy-config__threshold"><span>Quadrant threshold<b>{config.threshold}</b></span><input type="range" min="40" max="80" step="5" value={config.threshold} onChange={(event) => patch({ threshold: Number(event.target.value) })} /></label></div> : null}
    <footer><span>{spendMeta?.trustBoundary || "Spend measures remain separate and retain their published evidence boundary."}</span><button type="button" className="if-btn if-btn--secondary" onClick={() => onChange(normalizeStrategyConfig({}, { buyers: config.buyers, capabilities: config.capabilities }))}><RotateCcw size={14} />Reset controls</button></footer>
  </details>;
}

function OpportunityInspector({ record, tracked, strategyScore, spendFact, spendLabel, onCreateTask }) {
  if (!record) return <div className="if-alert if-alert--info" role="status"><LocateFixed size={17} /><span><strong>Select an opportunity</strong> Choose a bubble to pin its evidence and open the exact operating record.</span></div>;
  const id = idOf(record);
  return <section className="target-brief" data-portfolio-inspector>
    <header>
      <div><span>{tracked ? "Tracked pursuit" : "Portfolio opportunity"}</span><h3>{record.title || id}</h3><p>{customerOf(record)} · {id} · {trustLabel(record)}</p></div>
      <div className={`target-brief__score target-brief__score--${record.fitAssessment.level === "strong" ? "pursue" : "verify"}`}><b>{record.fitAssessment.score}</b><span>fit</span></div>
    </header>
    <div className="target-brief__facts">
      <article><span>Reported value</span><strong>{money(valueOf(record))}</strong><p>Not inferred when absent.</p></article>
      <article><span>Response due</span><strong>{readableDate(record.solicitationEnd || record.responseDeadline)}</strong><p>Published source date.</p></article>
      <article><span>Stage</span><strong>{samNoticeTypeLabel(record.noticeType)}</strong><p>{tracked ? "Already in My Work." : "Not currently tracked."}</p></article>
      <article><span>Evidence</span><strong>{trustLabel(record)}</strong><p>{record.sourceRoleCount ? `${record.sourceRoleCount} retained source roles.` : "Source-backed record."}</p></article>
      {strategyScore ? <><article><span>Attractiveness</span><strong>{strategyScore.attractiveness}/100</strong><p>Fit, urgency, funding, and evidence.</p></article><article><span>Ability proxy</span><strong>{strategyScore.ability}/100</strong><p>{strategyScore.gaps.length ? `Gaps: ${strategyScore.gaps.join(", ")}.` : "No modeled position gap."}</p></article></> : null}
      {spendFact ? <article><span>{spendLabel}</span><strong>{spendFact.coverage ? money(spendFact.value) : "Not linked"}</strong><p>{spendFact.count} retained fact{spendFact.count === 1 ? "" : "s"}; measure classes stay separate.</p></article> : null}
    </div>
    <div className="target-workboard__actions" style={{ padding: "10px 12px" }}>
      <a className="if-btn if-btn--primary" href={opportunityRoute(id, { returnTo: typeof window === "undefined" ? "" : window.location.hash, origin: "strategy" })}><LocateFixed size={15} />Open workspace</a>
      <a className="if-btn if-btn--secondary" href={intelligenceWorkspaceRoute({ entityType: "activity", entityId: id, tab: "money", returnTo: typeof window === "undefined" ? "" : window.location.hash, origin: "strategy" })}><Waypoints size={15} />Money Path</a>
      <button type="button" className="if-btn if-btn--secondary" onClick={() => void onCreateTask(record, strategyScore)}><CheckSquare2 size={15} />Create task</button>
      <a className="if-btn if-btn--ai" href={opportunityRoute(id, { returnTo: typeof window === "undefined" ? "" : window.location.hash, origin: "strategy" })}><Sparkles size={15} />Research</a>
      <a className="if-btn if-btn--secondary" href={`#/budget-spend/explorer?spendView=table&capRecord=${encodeURIComponent(id)}`}><FileSpreadsheet size={15} />Show in queue</a>
      {record.sourceUrl ? <a className="if-btn if-btn--secondary" href={record.sourceUrl} target="_blank" rel="noreferrer"><ExternalLink size={15} />Source</a> : null}
    </div>
  </section>;
}

export default function OpportunityPortfolioVisuals({ records, selectedId, tabs, onSelect, onScope, onQuadrant, asOf }) {
  const management = useManagementState(records);
  const [heatMetric, setHeatMetric] = useState("count");
  const [visualMode, setVisualMode] = useState(() => new URLSearchParams(window.location.hash.split("?")[1] || "").get("visualMode") === "portfolio" ? "portfolio" : "strategy");
  const initialBaseline = readStrategyBaseline() || {
    buyers: [...new Set(records.filter((record) => management.watchedIds.has(idOf(record))).map(officeOf).filter(Boolean))].sort(),
    capabilities: [...new Set(records.filter((record) => management.watchedIds.has(idOf(record))).flatMap((record) => record.technologyAreas || []))].sort(),
  };
  const [strategyConfig, setStrategyConfig] = useState(() => strategyConfigFromUrl(initialBaseline));
  const [spendState, setSpendState] = useState({ status: "idle", data: { metadata: {}, byActivity: {} }, error: "" });
  const [taskNotice, setTaskNotice] = useState("");
  const derivedBaseline = useMemo(() => {
    const trackedRows = records.filter((record) => management.watchedIds.has(idOf(record)));
    return { buyers: [...new Set(trackedRows.map(officeOf).filter(Boolean))].sort(), capabilities: [...new Set(trackedRows.flatMap((record) => record.technologyAreas || []))].sort() };
  }, [management.watchedIds, records]);
  useEffect(() => {
    if (visualMode !== "strategy" || spendState.status !== "idle") return undefined;
    const controller = new AbortController();
    fetch(`${import.meta.env.BASE_URL}data/strategy-spend-index.json`, { signal: controller.signal })
      .then((response) => { if (!response.ok) throw new Error("Strategic spend context is unavailable."); return response.json(); })
      .then((data) => setSpendState({ status: "ready", data, error: "" }))
      .catch((error) => { if (error.name !== "AbortError") setSpendState({ status: "error", data: { metadata: {}, byActivity: {} }, error: error.message }); });
    return () => controller.abort();
  }, [spendState.status, visualMode]);
  const applyStrategyConfig = (candidate) => {
    const next = normalizeStrategyConfig(candidate, derivedBaseline);
    setStrategyConfig(next);
    writeStrategyBaseline({ buyers: next.buyers, capabilities: next.capabilities });
    writeStrategyConfigToUrl(next);
    setTaskNotice("");
  };
  const spendByActivity = spendState.data.byActivity || {};
  const strategyRecords = useMemo(() => records.filter((record) => (!strategyConfig.trackedOnly || management.watchedIds.has(idOf(record))) && (strategyConfig.stage === "all" || stageOf(record) === strategyConfig.stage) && Number(record.fitAssessment?.score || 0) >= strategyConfig.minimumFit), [management.watchedIds, records, strategyConfig.minimumFit, strategyConfig.stage, strategyConfig.trackedOnly]);
  const selected = useMemo(() => records.find((record) => idOf(record) === selectedId) || null, [records, selectedId]);
  const snapshotTime = Date.parse(String(asOf || "1970-01-01"));
  const watchById = useMemo(() => new Map(management.watchlist.map((entry) => [entry.recordId, entry])), [management.watchlist]);
  const selectedScore = selected ? scoreStrategicRecord(selected, strategyConfig, watchById, spendByActivity, snapshotTime) : null;
  const selectedSpend = selected ? recordSpendFact(idOf(selected), spendByActivity, strategyConfig.spendMeasure, strategyConfig.fiscalYear) : null;
  const spendLabel = strategyConfig.spendMeasure === "request" ? `FY${strategyConfig.fiscalYear} request context` : strategyConfig.spendMeasure === "obligations" ? "Exact obligations" : "Published award total";
  const buyerOptions = useMemo(() => [...new Set(records.map(officeOf).filter(Boolean))].sort().map((value) => ({ value, label: value })), [records]);
  const capabilityOptions = useMemo(() => [...new Set(records.flatMap((record) => record.technologyAreas || []))].sort((left, right) => (TECHNOLOGY_AREA_BY_ID.get(left)?.label || left).localeCompare(TECHNOLOGY_AREA_BY_ID.get(right)?.label || right)).map((value) => ({ value, label: TECHNOLOGY_AREA_BY_ID.get(value)?.label || value })), [records]);
  useEffect(() => {
    if (!selectedId) return undefined;
    const clearSelection = (event) => { if (event.key === "Escape") onSelect(""); };
    window.addEventListener("keydown", clearSelection);
    return () => window.removeEventListener("keydown", clearSelection);
  }, [onSelect, selectedId]);
  const strong = strategyRecords.filter((record) => Number(record.fitAssessment?.score || 0) >= 70);
  const nearTerm = strategyRecords.filter((record) => urgencyOf(record, snapshotTime) >= 68);
  const tracked = strategyRecords.filter((record) => management.watchedIds.has(idOf(record)));
  const valued = strategyRecords.filter((record) => valueOf(record) > 0);
  const scopedSpend = scopeSpendSummary(strategyRecords.map(idOf), spendByActivity, strategyConfig.spendMeasure, strategyConfig.fiscalYear);
  const metrics = [
    { id: "scope", label: "Current scope", value: strategyRecords.length.toLocaleString(), meta: strategyConfig.trackedOnly ? "Tracked work only" : "Active strategy filters" },
    { id: "strong", label: "Strong fit", value: strong.length.toLocaleString(), meta: "Explainable 70+ score" },
    { id: "spend", label: spendLabel, value: money(scopedSpend.value), meta: `${scopedSpend.factCount} deduplicated facts · ${scopedSpend.coveredRecords} records` },
    { id: "urgent", label: "Due in 60 days", value: nearTerm.length.toLocaleString(), meta: "Published response dates" },
  ];
  const updateVisualMode = (next) => {
    setVisualMode(next);
    const [path, search = ""] = window.location.hash.split("?");
    const params = new URLSearchParams(search);
    params.set("visualMode", next);
    window.history.replaceState(null, "", `${path}?${params}`);
  };
  const createTask = async (record, score) => {
    const id = idOf(record); const existing = watchById.get(id); const now = new Date().toISOString();
    const title = score?.gaps?.length ? `Close strategy gap: ${score.gaps[0]}` : `Review strategic position: ${titleOf(record, 80)}`;
    const task = { id: `strategy-${crypto.randomUUID?.() || Date.now()}`, title, status: "todo", priority: score?.attractiveness >= 75 ? "high" : "normal", dueAt: "", owner: existing?.pursuit?.owner || "", sourceType: "strategy", sourceId: strategyConfig.lens, sourceLabel: strategyConfig.lens === "ansoff" ? "Ansoff strategic matrix" : "Attractiveness × ability", createdAt: now, completedAt: "" };
    try { await management.savePursuit(id, { stage: existing?.pursuit?.stage || "qualify", owner: existing?.pursuit?.owner || "", nextAction: existing?.pursuit?.nextAction || title, tasks: [task, ...(existing?.pursuit?.tasks || [])] }); setTaskNotice(`Task created for ${titleOf(record, 54)}`); }
    catch (error) { setTaskNotice(error.message); }
  };
  return <section className="spend-explorer spend-explorer--visuals" data-spend-explorer="visuals">
    <ControlWorkbenchHeader eyebrow="Decision visualization" title="Strategic Analysis Studio" summary="Customize growth and win-readiness lenses, apply evidence-safe spend context, save the analysis, and move decisions into action." metrics={metrics} metricLabel="Strategic analysis summary" tabs={tabs} />
    <ControlPageBody compact>
      <section className="capture-targeting" data-opportunity-portfolio-visuals>
        <div className="capture-targeting__heading">
          <div><span>Portfolio decision surface</span><h2>{visualMode === "strategy" ? strategyConfig.lens === "ansoff" ? "Where to grow" : "What to pursue now" : "Where to focus pursuit effort"}</h2><p>{visualMode === "strategy" ? strategyConfig.lens === "ansoff" ? "Classify active opportunities against an explicit customer and capability baseline, then review comparable spend and next actions." : "Compare evidence-weighted attractiveness with an explainable ability-to-win proxy. Scores never represent win probability." : "Fit, timing, reported value, customer demand, and evidence remain separate signals. These views direct analyst attention; they do not invent market whitespace."}</p></div>
          <div className="capture-targeting__lanes"><span><b>{tracked.length}</b>Tracked</span><span><b>{strong.length}</b>Strong fit</span><span><b>{nearTerm.length}</b>Due soon</span><span><b>{valued.length}</b>Valued</span></div>
        </div>
        <ControlTabs fill className="capture-targeting__mode" ariaLabel="Portfolio visualization mode" activeId={visualMode} onSelect={updateVisualMode} items={[["strategy", "Strategic matrix"], ["portfolio", "Analytical maps"]]} />
        {visualMode === "strategy" ? <>
          <div className="strategy-studio__toolbar"><StrategySavedViews analysis={strategyConfig} onLoad={(view) => applyStrategyConfig(view.analysis)} />{["idle", "loading"].includes(spendState.status) ? <span role="status">Loading spend context…</span> : spendState.status === "error" ? <span role="alert">{spendState.error}</span> : <span><BrainCircuit size={14} />{strategyConfig.lens === "ansoff" ? "Growth direction" : "Pursuit priority"} · spend {spendState.data.metadata?.status || "unknown"}</span>}</div>
          <StrategyConfiguration config={strategyConfig} onChange={applyStrategyConfig} buyerOptions={buyerOptions} capabilityOptions={capabilityOptions} spendMeta={spendState.data.metadata} />
          {strategyConfig.lens === "ansoff" ? <StrategicMatrix records={strategyRecords} watchedIds={management.watchedIds} watchlist={management.watchlist} selectedId={selectedId} onSelect={onSelect} onQuadrant={onQuadrant} config={strategyConfig} onConfig={applyStrategyConfig} spendByActivity={spendByActivity} /> : <WinReadinessMatrix records={strategyRecords} config={strategyConfig} watchlist={management.watchlist} selectedId={selectedId} onSelect={onSelect} onQuadrant={onQuadrant} spendByActivity={spendByActivity} snapshotTime={snapshotTime} />}
          {selected ? <OpportunityInspector record={selected} tracked={management.watchedIds.has(idOf(selected))} strategyScore={selectedScore} spendFact={selectedSpend} spendLabel={spendLabel} onCreateTask={createTask} /> : null}
          {taskNotice ? <div className="if-alert if-alert--info" role="status"><CheckSquare2 size={16} /><span>{taskNotice}</span></div> : null}
          <ControlDisclosure compact className="capture-targeting__method" title="Methodology and evidence boundary" summary="Explainable strategy inputs; no probability-of-win claim"><p>{strategyConfig.lens === "ansoff" ? "Current customers and demonstrated capabilities come only from the editable strategy baseline. Buyer identity uses the published buying office. Capability identity uses the retained technology classification. Records missing either field remain unclassified." : "Attractiveness combines configurable fit, urgency, funding, and evidence signals. Ability combines the explicit customer/capability baseline, retained contract route, and pursuit readiness. The score is a transparent prioritization proxy, not probability of win."} Budget requests, exact obligations, and published award totals remain separate classes and are deduplicated by source identity before any displayed scope summary.</p></ControlDisclosure>
        </> : <>
          <div className="capture-targeting__interpretations" aria-label="Portfolio interpretation">
            <article><span>Priority quadrant</span><strong>{records.filter((record) => Number(record.fitAssessment?.score || 0) >= 70 && urgencyOf(record, snapshotTime) >= 68).length}</strong><p>Strong-fit records with a published deadline inside 60 days.</p></article>
            <article><span>Tracked coverage</span><strong>{records.length ? `${Math.round((tracked.length / records.length) * 100)}%` : "0%"}</strong><p>Current filtered opportunities already represented in My Work.</p></article>
            <article><span>Buyer-capability cells</span><strong>{new Set(records.flatMap((record) => (record.technologyAreas || []).map((area) => `${officeOf(record)}|${area}`)).filter((value) => !value.startsWith("|"))).size}</strong><p>Observed combinations in retained records; blanks are not proof of absence.</p></article>
          </div>
          <OpportunityInspector record={selected} tracked={Boolean(selected && management.watchedIds.has(idOf(selected)))} strategyScore={selectedScore} spendFact={selectedSpend} spendLabel={spendLabel} onCreateTask={createTask} />
          <div className="capture-targeting__visuals">
            <section className="capture-targeting__route"><header><div><strong>Opportunity priority map</strong><small>Fit × decision urgency · bubble area = reported value · green ring = tracked</small></div></header><PortfolioMap records={records} selectedId={selectedId} watchedIds={management.watchedIds} onSelect={onSelect} snapshotTime={snapshotTime} /></section>
            <section className="capture-targeting__route"><header><div><strong>Buyer × capability heatmap</strong><small>Observed retained opportunities; click a populated cell to filter the operating queue</small></div><ControlSelect compact ariaLabel="Heatmap measure" value={heatMetric} options={[{ value: "count", label: "Opportunity count" }, { value: "value", label: "Largest reported value" }, { value: "fit", label: "Average fit" }]} onChange={setHeatMetric} /></header><BuyerCapabilityHeatmap records={records} metric={heatMetric} onScope={onScope} /></section>
          </div>
          <ControlDisclosure compact className="capture-targeting__method" title="How to read these views" summary="Visual encodings, missing values, and queue handoff"><p>The portfolio map uses the explainable public capability fit score, published response timing, and reported value. The heatmap uses published buying-office hierarchy and classified technology areas. Missing values remain missing. Empty cells mean no matching retained record in the active scope, not zero demand. Selecting a heatmap cell applies exact workbench filters so the table remains the canonical operating queue.</p></ControlDisclosure>
        </>}
      </section>
    </ControlPageBody>
  </section>;
}
