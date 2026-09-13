import { useMemo, useState } from "react";
import { hierarchy, interpolateBlues, max, scaleBand, scaleOrdinal, scaleSequential, scaleSqrt, schemeTableau10, treemap } from "d3";
import { BarChart3, CalendarClock, Grid3X3, Network } from "lucide-react";

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

export default function TransactionAnalytics({ dataset }) {
  const records = useMemo(() => dataset.records || [], [dataset.records]);
  const [treemapMetric, setTreemapMetric] = useState("obligations");
  const totals = useMemo(() => ({ obligations: records.reduce((sum, record) => sum + recordObligations(record), 0), potential: records.reduce((sum, record) => sum + recordValue(record), 0), actions: records.reduce((sum, record) => sum + Number(record.transactionSummary?.actions || 0), 0) }), [records]);
  const contractRecords = records.filter((record) => record.mode === "contract-performance");
  const acquisitionRecords = records.filter((record) => record.mode === "acquisition-window");
  const contractRefs = new Set(contractRecords.map((record) => String(record.reference || "").toUpperCase()).filter(Boolean));
  const exactFollowOns = acquisitionRecords.filter((record) => record.parentReference && contractRefs.has(String(record.parentReference).toUpperCase())).length;
  const samRecords = acquisitionRecords.filter((record) => record.sourceUrls.some((url) => /sam\.gov/i.test(url))).length;
  return <div className="transaction-analytics-page" data-transaction-d3-page><section className="transaction-analytics-hero"><div><span>Read-only descriptive analysis</span><h2>Contract & Transaction Analytics</h2><p>D3 views of reported schedules, values, recipients, offices, and FPDS activity. Areas, positions, and color encode published measures only.</p></div><dl><div><dt>Contracts</dt><dd>{contractRecords.length.toLocaleString()}</dd></div><div><dt>Acquisition records</dt><dd>{acquisitionRecords.length.toLocaleString()}</dd></div><div><dt>SAM.gov-cited</dt><dd>{samRecords.toLocaleString()}</dd></div><div><dt>Exact follow-on links</dt><dd>{exactFollowOns.toLocaleString()}</dd></div><div><dt>Observed obligations</dt><dd>{money(totals.obligations)}</dd></div><div><dt>FPDS actions</dt><dd>{totals.actions.toLocaleString()}</dd></div></dl></section><div className="transaction-viz-grid"><ChartFrame icon={CalendarClock} title="Quarterly schedule activity" note="Reported term ends and published acquisition events" testId="quarterly"><EventTimeline records={records} /></ChartFrame><ChartFrame icon={BarChart3} title="Obligation and value distribution" note="Square-root scales preserve lower-value record visibility; bubble size is exact FPDS action count" testId="scatter"><ValueScatter records={records} /></ChartFrame><ChartFrame icon={Network} title="Portfolio and recipient composition" note="Area encodes the selected factual measure" testId="treemap"><div className="transaction-viz__segmented" aria-label="Treemap measure">{[["obligations", "Obligations"], ["potential", "Potential"], ["records", "Records"]].map(([id, text]) => <button type="button" className={treemapMetric === id ? "is-active" : ""} key={id} onClick={() => setTreemapMetric(id)}>{text}</button>)}</div><PortfolioTreemap records={records} metric={treemapMetric} /></ChartFrame><ChartFrame icon={Grid3X3} title="Funding office by fiscal year" note="Color encodes annual net obligations reported in the normalized FPDS series" testId="buyer-year"><BuyerYearHeatmap records={records} /></ChartFrame></div><section className="transaction-analytics-note"><strong>Coverage boundary</strong><p>These views describe the current 198-record analytical set: 130 contract rows and 68 acquisition rows. They are not the complete federal contract universe, do not establish recompete dates, and do not determine bidder eligibility. Thirty-eight acquisition records cite SAM.gov; two records have an exact source-declared predecessor PIID matching a contract row.</p></section></div>;
}
