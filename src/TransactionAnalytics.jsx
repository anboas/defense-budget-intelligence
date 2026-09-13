import { useMemo, useState } from "react";
import { hierarchy, interpolateBlues, max, scaleBand, scaleOrdinal, scaleSequential, scaleSqrt, schemeTableau10, treemap } from "d3";
import { BarChart3, CalendarClock, Grid3X3, Network } from "lucide-react";
import { applyProcurementChanges, assembleProcurementRecords, INGESTION_METHOD_BY_ID, WORK_CATEGORY_BY_ID } from "./procurement-taxonomy.js";

function money(value) {
  const amount = Number(value || 0);
  if (amount >= 1_000_000_000) return `$${(amount / 1_000_000_000).toFixed(1)}B`;
  if (amount >= 1_000_000) return `$${(amount / 1_000_000).toFixed(1)}M`;
  return `$${Math.round(amount / 1_000).toLocaleString()}K`;
}

function recordValue(record) {
  return Number(record.potentialAmount || record.valueHigh || record.obligatedAmount || record.valueLow || 0);
}

function recordObligations(record) {
  return Number(record.obligatedAmount || 0);
}

function ChartFrame({ icon: Icon, title, note, children, testId }) {
  return <section className="transaction-viz" data-d3-analytics={testId}><header><Icon size={18} aria-hidden="true" /><span><strong>{title}</strong><small>{note}</small></span></header><div className="transaction-viz__scroller">{children}</div></section>;
}

function EventTimeline({ records }) {
  const quarters = useMemo(() => {
    const map = new Map();
    for (let year = 2023; year <= 2034; year += 1) for (let quarter = 1; quarter <= 4; quarter += 1) map.set(`${year} Q${quarter}`, { label: `${year} Q${quarter}`, terms: 0, events: 0 });
    for (const record of records) {
      if (record.currentEnd) {
        const date = new Date(`${record.currentEnd}T00:00:00Z`);
        const row = map.get(`${date.getUTCFullYear()} Q${Math.floor(date.getUTCMonth() / 3) + 1}`);
        if (row) row.terms += 1;
      }
      for (const event of record.milestones || []) {
        if (!event.start) continue;
        const date = new Date(`${event.start}T00:00:00Z`);
        const row = map.get(`${date.getUTCFullYear()} Q${Math.floor(date.getUTCMonth() / 3) + 1}`);
        if (row) row.events += 1;
      }
    }
    return [...map.values()];
  }, [records]);
  const width = 1180; const height = 260; const inset = { top: 24, right: 18, bottom: 50, left: 46 };
  const x = scaleBand().domain(quarters.map((row) => row.label)).range([inset.left, width - inset.right]).padding(0.18);
  const y = scaleSqrt().domain([0, max(quarters, (row) => Math.max(row.terms, row.events)) || 1]).range([height - inset.bottom, inset.top]);
  const colors = { terms: "#005ea2", events: "#7d4e9f" };
  return <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Quarterly reported term ends and published acquisition events"><line x1={inset.left} x2={width - inset.right} y1={height - inset.bottom} y2={height - inset.bottom} />{quarters.map((row, index) => <g key={row.label}><rect x={x(row.label)} y={y(row.terms)} width={x.bandwidth() / 2} height={height - inset.bottom - y(row.terms)} fill={colors.terms}><title>{row.label}: {row.terms} reported term ends</title></rect><rect x={x(row.label) + x.bandwidth() / 2} y={y(row.events)} width={x.bandwidth() / 2} height={height - inset.bottom - y(row.events)} fill={colors.events}><title>{row.label}: {row.events} published events</title></rect>{index % 4 === 0 ? <text x={x(row.label)} y={height - 29}>{row.label.slice(0, 4)}</text> : null}</g>)}</svg>;
}

function ValueScatter({ records }) {
  const points = records.filter((record) => recordValue(record) > 0 && recordObligations(record) > 0);
  const width = 760; const height = 360; const inset = { top: 24, right: 24, bottom: 48, left: 68 };
  const x = scaleSqrt().domain([0, max(points, recordValue) || 1]).range([inset.left, width - inset.right]);
  const y = scaleSqrt().domain([0, max(points, recordObligations) || 1]).range([height - inset.bottom, inset.top]);
  const colors = scaleOrdinal(schemeTableau10);
  return <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Observed obligations compared with reported potential values"><line x1={inset.left} x2={width - inset.right} y1={height - inset.bottom} y2={height - inset.bottom} /><line x1={inset.left} x2={inset.left} y1={inset.top} y2={height - inset.bottom} />{points.map((record) => <circle key={record.opportunityId} cx={x(recordValue(record))} cy={y(recordObligations(record))} r={Math.min(4 + Math.sqrt(record.transactionSummary?.actions || 0), 13)} fill={colors(record.portfolio)} opacity="0.72"><title>{record.id} · {record.title}\n{money(recordObligatedAmount(record))} observed obligations\n{money(recordValue(record))} potential / high\n{record.transactionSummary?.actions || 0} FPDS actions</title></circle>)}<text x={(inset.left + width - inset.right) / 2} y={height - 10} textAnchor="middle">Reported potential / high value</text><text x="16" y={height / 2} transform={`rotate(-90 16 ${height / 2})`} textAnchor="middle">Observed obligations</text></svg>;
}

function recordObligatedAmount(record) {
  return Number(record.obligatedAmount || 0);
}

function PortfolioTreemap({ records, metric }) {
  const grouped = new Map();
  for (const record of records) {
    const portfolio = record.portfolio || "Portfolio not published";
    const party = record.party || "Recipient / sponsor not published";
    const key = `${portfolio}|${party}`;
    const value = metric === "records" ? 1 : metric === "potential" ? recordValue(record) : recordObligations(record);
    grouped.set(key, { portfolio, party, value: (grouped.get(key)?.value || 0) + value });
  }
  const children = [...new Set([...grouped.values()].map((row) => row.portfolio))].map((portfolio) => ({ name: portfolio, children: [...grouped.values()].filter((row) => row.portfolio === portfolio).map((row) => ({ name: row.party, value: row.value })) }));
  const root = treemap().size([920, 420]).paddingOuter(3).paddingInner(1)(hierarchy({ name: "Transactions", children }).sum((node) => node.value || 0).sort((a, b) => b.value - a.value));
  const color = scaleOrdinal(schemeTableau10);
  return <svg viewBox="0 0 920 420" role="img" aria-label={`Portfolio and recipient treemap sized by ${metric}`}><g>{root.leaves().map((leaf) => { const portfolio = leaf.parent.data.name; const width = leaf.x1 - leaf.x0; const height = leaf.y1 - leaf.y0; return <g key={`${portfolio}-${leaf.data.name}`}><rect x={leaf.x0} y={leaf.y0} width={width} height={height} fill={color(portfolio)} opacity="0.78"><title>{portfolio}\n{leaf.data.name}\n{metric === "records" ? `${leaf.value} records` : money(leaf.value)}</title></rect>{width > 90 && height > 34 ? <><text x={leaf.x0 + 6} y={leaf.y0 + 15}>{leaf.data.name.slice(0, Math.max(10, Math.floor(width / 8)))}</text><text x={leaf.x0 + 6} y={leaf.y0 + 29}>{metric === "records" ? `${leaf.value} records` : money(leaf.value)}</text></> : null}</g>; })}</g></svg>;
}

function BuyerYearHeatmap({ records }) {
  const years = [...new Set(records.flatMap((record) => (record.fiscalValues || []).map((row) => row.fiscalYear)))].sort((a, b) => a - b);
  const buyers = [...new Set(records.map((record) => record.fundingOffice || record.owner).filter(Boolean))].map((buyer) => ({ buyer, total: records.filter((record) => (record.fundingOffice || record.owner) === buyer).reduce((sum, record) => sum + recordObligations(record), 0) })).sort((a, b) => b.total - a.total).slice(0, 12).map((row) => row.buyer);
  const cells = buyers.flatMap((buyer) => years.map((year) => ({ buyer, year, value: records.filter((record) => (record.fundingOffice || record.owner) === buyer).reduce((sum, record) => sum + (record.fiscalValues || []).filter((item) => item.fiscalYear === year).reduce((yearSum, item) => yearSum + Number(item.amount || 0), 0), 0) })));
  const width = 1180; const height = 390; const inset = { top: 42, right: 20, bottom: 24, left: 300 };
  const x = scaleBand().domain(years).range([inset.left, width - inset.right]).padding(0.06); const y = scaleBand().domain(buyers).range([inset.top, height - inset.bottom]).padding(0.06); const color = scaleSequential(interpolateBlues).domain([0, max(cells, (row) => row.value) || 1]);
  return <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Funding office annual obligation heatmap">{years.map((year) => <text key={year} x={(x(year) || 0) + x.bandwidth() / 2} y="27" textAnchor="middle">FY{year}</text>)}{buyers.map((buyer) => <text key={buyer} x={inset.left - 8} y={(y(buyer) || 0) + y.bandwidth() / 2 + 4} textAnchor="end">{buyer.slice(0, 42)}</text>)}{cells.map((cell) => <rect key={`${cell.buyer}-${cell.year}`} x={x(cell.year)} y={y(cell.buyer)} width={x.bandwidth()} height={y.bandwidth()} fill={cell.value ? color(cell.value) : "#eef2f5"}><title>{cell.buyer}\nFY{cell.year}: {cell.value ? money(cell.value) : "No reported obligations in this dataset"}</title></rect>)}</svg>;
}

function WorkCategoryTreemap({ records }) {
  const rows = [...new Set(records.map((record) => record.workCategory || "other-unclassified"))].map((category) => ({
    name: WORK_CATEGORY_BY_ID.get(category)?.label || "Other / unclassified",
    color: WORK_CATEGORY_BY_ID.get(category)?.color || "#6c7b88",
    value: records.filter((record) => (record.workCategory || "other-unclassified") === category).length,
    obligations: records.filter((record) => (record.workCategory || "other-unclassified") === category).reduce((sum, record) => sum + recordObligations(record), 0),
  })).sort((left, right) => right.value - left.value);
  const root = treemap().size([920, 420]).paddingOuter(3).paddingInner(2)(hierarchy({ name: "Work", children: rows }).sum((node) => node.value || 0));
  return <svg viewBox="0 0 920 420" role="img" aria-label="Work category composition by record count">{root.leaves().map((leaf) => { const width = leaf.x1 - leaf.x0; const height = leaf.y1 - leaf.y0; return <g key={leaf.data.name}><rect x={leaf.x0} y={leaf.y0} width={width} height={height} fill={leaf.data.color} opacity="0.82"><title>{leaf.data.name}\n{leaf.value} records\n{money(leaf.data.obligations)} observed obligations</title></rect>{width > 100 && height > 36 ? <><text x={leaf.x0 + 7} y={leaf.y0 + 16}>{leaf.data.name.slice(0, Math.max(12, Math.floor(width / 8)))}</text><text x={leaf.x0 + 7} y={leaf.y0 + 31}>{leaf.value} records</text></> : null}</g>; })}</svg>;
}

function ProvenanceBars({ records }) {
  const rows = [...new Set(records.map((record) => record.ingestionMethod || "source-file"))].map((method) => ({
    method,
    label: INGESTION_METHOD_BY_ID.get(method)?.label || method,
    color: INGESTION_METHOD_BY_ID.get(method)?.color || "#647a8b",
    records: records.filter((record) => (record.ingestionMethod || "source-file") === method).length,
    obligations: records.filter((record) => (record.ingestionMethod || "source-file") === method).reduce((sum, record) => sum + recordObligations(record), 0),
  })).sort((left, right) => right.records - left.records);
  const width = 920; const height = 300; const inset = { top: 24, right: 170, bottom: 34, left: 220 };
  const x = scaleBand().domain(rows.map((row) => row.label)).range([inset.top, height - inset.bottom]).padding(0.28);
  const maximum = max(rows, (row) => row.records) || 1;
  return <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Record ingestion provenance">{rows.map((row) => { const barWidth = ((width - inset.left - inset.right) * row.records) / maximum; return <g key={row.method}><text x={inset.left - 10} y={(x(row.label) || 0) + x.bandwidth() / 2 + 4} textAnchor="end">{row.label}</text><rect x={inset.left} y={x(row.label)} width={barWidth} height={x.bandwidth()} fill={row.color}><title>{row.label}: {row.records} records; {money(row.obligations)} observed obligations</title></rect><text x={inset.left + barWidth + 8} y={(x(row.label) || 0) + x.bandwidth() / 2 + 4}>{row.records} records</text></g>; })}</svg>;
}

function ChangeBars({ summary }) {
  const rows = [{ id: "added", label: "Added", value: Number(summary?.added || 0), color: "#248642" }, { id: "updated", label: "Updated", value: Number(summary?.updated || 0), color: "#7651a8" }, { id: "removed", label: "No longer in feed", value: Number(summary?.removed || 0), color: "#b23a2f" }];
  const maximum = Math.max(...rows.map((row) => row.value), 1);
  return <svg viewBox="0 0 920 260" role="img" aria-label="Procurement record changes since the prior snapshot">{rows.map((row, index) => { const y = 38 + index * 66; const width = (row.value / maximum) * 590; return <g key={row.id}><text x="190" y={y + 23} textAnchor="end">{row.label}</text><rect x="210" y={y} width={width} height="32" fill={row.color}><title>{row.label}: {row.value}</title></rect><text x={218 + width} y={y + 23}>{row.value.toLocaleString()}</text></g>; })}</svg>;
}

function FieldCoverageBars({ records }) {
  const rows = [
    ["External source", (record) => record.sourceUrls?.length],
    ["Specific work category", (record) => record.workCategory && record.workCategory !== "other-unclassified"],
    ["PSC", (record) => record.pscCode],
    ["NAICS", (record) => record.naicsCode],
    ["Funding office", (record) => record.fundingOffice],
    ["Contracting office", (record) => record.contractingOffice],
    ["Reported dollars", (record) => recordValue(record) > 0 || recordObligations(record) > 0],
    ["Reported schedule", (record) => record.start || record.currentEnd || record.solicitationStart || record.solicitationEnd || record.milestones?.length],
    ["Acquisition structure", (record) => record.vehicle || record.awardType || record.pricingType || record.competitionType || record.setAside],
  ].map(([label, predicate]) => ({ label, value: records.filter(predicate).length }));
  const total = Math.max(records.length, 1);
  return <svg viewBox="0 0 920 440" role="img" aria-label="Field coverage across the assembled procurement record universe">{rows.map((row, index) => { const y = 25 + index * 44; const width = (row.value / total) * 590; return <g key={row.label}><text x="230" y={y + 21} textAnchor="end">{row.label}</text><rect x="250" y={y} width={width} height="28" fill="#147da1"><title>{row.label}: {row.value.toLocaleString()} of {records.length.toLocaleString()} records</title></rect><text x={258 + width} y={y + 20}>{row.value.toLocaleString()} · {Math.round((row.value / total) * 100)}%</text></g>; })}</svg>;
}

function MoneyLineageMap({ accountSpine, requestLineCount, captureCoverage }) {
  const coverage = accountSpine?.metadata?.coverage || {};
  const nodes = [
    { x: 35, y: 55, width: 150, label: "PDB request lines", value: requestLineCount },
    { x: 270, y: 55, width: 150, label: "Federal accounts", value: coverage.federalAccounts || 0 },
    { x: 505, y: 55, width: 170, label: "Account-linked awards", value: coverage.awardsMappedToCurrentAccounts || 0 },
    { x: 270, y: 250, width: 150, label: "Plotted awards", value: captureCoverage.uniqueAwards || 0 },
    { x: 505, y: 250, width: 170, label: "Exact FPDS actions", value: captureCoverage.fpdsActions || 0 },
  ];
  return <svg viewBox="0 0 920 410" role="img" aria-label="Federal money lineage and unresolved public-data joins">
    <defs><marker id="flow-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="context-stroke" /></marker></defs>
    <path d="M185 100 C220 100 235 100 270 100" fill="none" stroke="#b86b00" strokeWidth="9" strokeDasharray="8 6" markerEnd="url(#flow-arrow)" /><text x="228" y="82" textAnchor="middle" fill="#8a5100">{coverage.requestMatchedAccounts || 0} derived title matches</text>
    <path d="M420 100 C455 100 470 100 505 100" fill="none" stroke="#146ea8" strokeWidth="12" markerEnd="url(#flow-arrow)" /><text x="462" y="82" textAnchor="middle" fill="#075786">{coverage.exactAwardAccountLinks || 0} exact account links</text>
    <path d="M420 295 C455 295 470 295 505 295" fill="none" stroke="#248642" strokeWidth="12" markerEnd="url(#flow-arrow)" /><text x="462" y="277" textAnchor="middle" fill="#19622f">Exact PIID/action lineage</text>
    <path d="M590 145 C590 185 410 185 350 250" fill="none" stroke="#b23a2f" strokeWidth="3" strokeDasharray="5 7" /><text x="490" y="199" textAnchor="middle" fill="#8d2a23">No universal public crosswalk</text>
    {nodes.map((node) => <g key={node.label}><rect x={node.x} y={node.y} width={node.width} height="90" rx="7" fill="#f4f9fc" stroke="#7ea8c2" /><text x={node.x + node.width / 2} y={node.y + 32} textAnchor="middle">{node.label}</text><text x={node.x + node.width / 2} y={node.y + 65} textAnchor="middle" fontSize="24" fontWeight="700">{Number(node.value || 0).toLocaleString()}</text></g>)}
    <g transform="translate(35 365)"><line x1="0" x2="34" y1="0" y2="0" stroke="#146ea8" strokeWidth="8" /><text x="44" y="5">Exact</text><line x1="120" x2="154" y1="0" y2="0" stroke="#b86b00" strokeWidth="8" strokeDasharray="7 5" /><text x="164" y="5">Derived</text><line x1="255" x2="289" y1="0" y2="0" stroke="#b23a2f" strokeWidth="3" strokeDasharray="5 6" /><text x="299" y="5">Unresolved join</text></g>
  </svg>;
}

export default function TransactionAnalytics({ dataset, awards = [], samOpportunities = { records: [] }, manualProcurement = { records: [] }, procurementDelta = { records: [], summary: {} }, accountSpine = null, requestLineCount = 0 }) {
  const records = useMemo(() => applyProcurementChanges(assembleProcurementRecords(dataset.records || [], awards, dataset.metadata.asOf, samOpportunities.records || [], manualProcurement.records || []), procurementDelta.records || []), [awards, dataset.metadata.asOf, dataset.records, manualProcurement.records, procurementDelta.records, samOpportunities.records]);
  const [treemapMetric, setTreemapMetric] = useState("obligations");
  const totals = useMemo(() => ({ obligations: records.reduce((sum, record) => sum + recordObligations(record), 0), potential: records.reduce((sum, record) => sum + recordValue(record), 0), actions: records.reduce((sum, record) => sum + Number(record.transactionSummary?.actions || 0), 0) }), [records]);
  const contractRecords = records.filter((record) => record.mode === "contract-performance");
  const acquisitionRecords = records.filter((record) => record.mode === "acquisition-window");
  const contractRefs = new Set(contractRecords.map((record) => String(record.reference || "").toUpperCase()).filter(Boolean));
  const exactFollowOns = acquisitionRecords.filter((record) => record.parentReference && contractRefs.has(String(record.parentReference).toUpperCase())).length;
  const samRecords = acquisitionRecords.filter((record) => record.sourceUrls.some((url) => /sam\.gov/i.test(url))).length;
  return <div className="transaction-analytics-page" data-transaction-d3-page><section className="transaction-analytics-hero"><div><span>Read-only descriptive analysis</span><h2>Contract & Transaction Analytics</h2><p>D3 views of reported schedules, values, work categories, ingestion provenance, recipients, offices, lineage, and FPDS activity. Areas, positions, and color encode published or explicitly derived measures only.</p></div><dl><div><dt>Contracts</dt><dd>{contractRecords.length.toLocaleString()}</dd></div><div><dt>Acquisition records</dt><dd>{acquisitionRecords.length.toLocaleString()}</dd></div><div><dt>Automated imports</dt><dd>{records.filter((record) => record.ingestionMethod === "automated").length.toLocaleString()}</dd></div><div><dt>Exact follow-on links</dt><dd>{exactFollowOns.toLocaleString()}</dd></div><div><dt>Observed obligations</dt><dd>{money(totals.obligations)}</dd></div><div><dt>FPDS actions</dt><dd>{totals.actions.toLocaleString()}</dd></div></dl></section><div className="transaction-viz-grid"><ChartFrame icon={CalendarClock} title="Quarterly schedule activity" note="Reported term ends and published acquisition events" testId="quarterly"><EventTimeline records={records} /></ChartFrame><ChartFrame icon={BarChart3} title="Obligation and value distribution" note="Square-root scales preserve lower-value record visibility; bubble size is exact FPDS action count" testId="scatter"><ValueScatter records={records} /></ChartFrame><ChartFrame icon={Network} title="Portfolio and recipient composition" note="Area encodes the selected factual measure" testId="treemap"><div className="transaction-viz__segmented" aria-label="Treemap measure">{[["obligations", "Obligations"], ["potential", "Potential"], ["records", "Records"]].map(([id, text]) => <button type="button" className={treemapMetric === id ? "is-active" : ""} key={id} onClick={() => setTreemapMetric(id)}>{text}</button>)}</div><PortfolioTreemap records={records} metric={treemapMetric} /></ChartFrame><ChartFrame icon={Grid3X3} title="Funding office by fiscal year" note="Color encodes annual net obligations reported in the normalized FPDS series" testId="buyer-year"><BuyerYearHeatmap records={records} /></ChartFrame><ChartFrame icon={Network} title="Type of work composition" note="Area encodes record count; categories use PSC/NAICS when available and published descriptions otherwise" testId="work-categories"><WorkCategoryTreemap records={records} /></ChartFrame><ChartFrame icon={BarChart3} title="Ingestion provenance" note="Separates automatic public feeds from normalized source-file and curated imports" testId="provenance"><ProvenanceBars records={records} /></ChartFrame><ChartFrame icon={BarChart3} title="Field coverage" note="Coverage is measured across the full assembled public record universe" testId="field-coverage"><FieldCoverageBars records={records} /></ChartFrame><ChartFrame icon={Network} title="Money lineage and public join gaps" note="Counts encode records and links, not additive dollars; relationship class is explicit" testId="money-lineage"><MoneyLineageMap accountSpine={accountSpine} requestLineCount={requestLineCount} captureCoverage={dataset.metadata.coverage} /></ChartFrame><ChartFrame icon={CalendarClock} title="Changed since prior snapshot" note="Added, updated, and no-longer-returned records are compared by stable public identifier" testId="changes"><ChangeBars summary={procurementDelta.summary} /></ChartFrame></div><section className="transaction-analytics-note"><strong>Coverage boundary</strong><p>These views describe {records.length.toLocaleString()} public records: {dataset.metadata.coverage.publicRows} normalized capture rows plus {records.filter((record) => record.ingestionMethod === "automated").length.toLocaleString()} non-duplicate awards from the automated USAspending feed. They are not the complete federal contract universe, do not establish recompete dates, and do not determine bidder eligibility. {samRecords} acquisition records cite SAM.gov; {exactFollowOns} records have an exact source-declared predecessor PIID matching a contract row. The PDB-to-account relationship remains derived; no universal public crosswalk connects every request line, award, and action.</p></section></div>;
}
