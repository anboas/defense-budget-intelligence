import { useMemo } from "react";
import {
  ControlAsyncState,
  ControlDisclosure,
  ControlMetricStrip,
} from "control-surface-ui/react";
import {
  BarChart3,
  BrainCircuit,
  Building2,
  CalendarClock,
  Database,
  ExternalLink,
  Filter,
  GitBranch,
  Layers,
  Network,
  RotateCcw,
  Search,
  TrendingUp,
} from "lucide-react";
import Section from "./AnalysisSection.jsx";
import AnalysisActions from "./AnalysisActions.jsx";
import ControlSelect from "./ControlSelect.jsx";
import PhaseIntro from "./PhaseIntro.jsx";
import useUrlState from "./urlState.js";

const EMPTY_ROWS = Object.freeze([]);
const FILTER_DEFAULTS = { query: "", book: "all", group: "all", signal: "all", org: "all" };
const BOOK_COLORS = {
  "M-1": "#005ea2",
  "O-1": "#216e1f",
  "P-1": "#9d2b22",
  "R-1": "#5c4b8a",
  "RF-1": "#08737a",
  "C-1": "#b65c00",
};
const GROUP_LABELS = {
  service: "Services",
  "fourth-estate": "Fourth Estate",
  other: "Other / Reconciliation",
};

function money(value, digits = 1) {
  const number = Number(value || 0);
  if (number > 0 && Math.abs(number) < 0.1) return `$${(number * 1000).toFixed(0)}M`;
  return `$${number.toFixed(digits)}B`;
}

function federalMoney(value, digits = 1) {
  return money(Number(value || 0) / 1_000_000_000, digits);
}

function dateTime(value) {
  return new Date(value).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function yearList(years = []) {
  return years.map((year) => `FY${year}`).join(", ");
}

function pct(value, digits = 1) {
  const number = Number(value || 0);
  return `${number > 0 ? "+" : ""}${number.toFixed(digits)}%`;
}

function percent(value, digits = 0) {
  return `${Number(value || 0).toFixed(digits)}%`;
}

function growth(row) {
  if (!row?.fy2025) return row?.fy2027 ? 100 : 0;
  return ((row.fy2027 - row.fy2025) / row.fy2025) * 100;
}

function requestGrowth(current, prior) {
  if (!prior) return current ? 100 : 0;
  return ((current - prior) / prior) * 100;
}

function aggregate(records, keyFn) {
  const groups = new Map();
  for (const record of records) {
    const key = keyFn(record);
    const existing = groups.get(key.id) || { ...key, fy2025: 0, fy2026: 0, fy2027: 0, records: 0 };
    existing.fy2025 += record.fy2025;
    existing.fy2026 += record.fy2026;
    existing.fy2027 += record.fy2027;
    existing.records += 1;
    groups.set(key.id, existing);
  }
  return [...groups.values()].sort((a, b) => b.fy2027 - a.fy2027);
}

function Bar({ value, max, color, label }) {
  return <span className="bar-track" aria-label={label}><i style={{ width: `${Math.max((value / Math.max(max, 1)) * 100, value ? 1 : 0)}%`, background: color }} /></span>;
}

function Spark({ row }) {
  const values = [row.fy2025 || 0, row.fy2026 || 0, row.fy2027 || 0];
  const max = Math.max(...values, 1);
  return <span className="spark" aria-label="FY2025 to FY2027 trend">{values.map((value, index) => <i key={index} style={{ height: `${Math.max((value / max) * 100, value ? 8 : 2)}%` }} />)}</span>;
}

function useUrlSelection(defaultValue, validValues = []) {
  const [selection, setSelection] = useUrlState(
    { selected: defaultValue },
    { selected: (value) => validValues.includes(value) },
  );
  return [selection.selected, (selected) => setSelection({ selected })];
}

function LifecycleStage({ label, amount, maximum, source, relationship = "exact" }) {
  const width = maximum > 0 ? Math.max(2, (Number(amount || 0) / maximum) * 100) : 0;
  return <article className="lifecycle-stage">
    <header><div><span>{label}</span><em className={`evidence-class evidence-class--${relationship}`}>{relationship}</em></div><strong>{amount ? federalMoney(amount) : "Unavailable"}</strong></header>
    <i aria-hidden="true"><b style={{ width: `${Math.min(width, 100)}%` }} /></i>
    <p>{source}</p>
  </article>;
}

function TafsFlowCard({ row, maximum }) {
  return <article>
    <header><div><strong>{row.tasCode}</strong><span>{row.title}</span></div><a href={row.apportionment.sourceUrl} target="_blank" rel="noreferrer">OMB source <ExternalLink size={13} aria-hidden="true" /></a></header>
    <div className="tafs-flow__bars">
      {[["Apportioned", row.apportionment.approvedAmount, "blue"], ["Obligated", row.obligatedAmount, "purple"], ["Outlays", row.outlayedAmount, "green"]].map(([label, amount, tone]) => <div key={label}><span>{label}</span><i aria-hidden="true"><b className={`tone-${tone}`} style={{ width: `${Math.max(1, (Number(amount || 0) / maximum) * 100)}%` }} /></i><strong>{federalMoney(amount)}</strong></div>)}
    </div>
  </article>;
}

function AccountLifecycle({ accountSpine }) {
  const accounts = accountSpine?.accounts || EMPTY_ROWS;
  const awardFlows = accountSpine?.awardFlows || EMPTY_ROWS;
  const awardCounts = useMemo(() => {
    const counts = new Map();
    for (const award of awardFlows) for (const account of award.accounts || []) counts.set(account.federalAccountCode, (counts.get(account.federalAccountCode) || 0) + 1);
    return counts;
  }, [awardFlows]);
  const complete = accounts.filter((account) => account.requestMatch && account.exactApportionmentJoinCount > 0 && (!awardCounts.size || awardCounts.has(account.federalAccountCode)));
  const defaultAccount = complete[0] || accounts[0];
  const [selectedCode, setSelectedCode] = useUrlSelection(defaultAccount?.federalAccountCode || "", accounts.map((account) => account.federalAccountCode));
  const selected = accounts.find((account) => account.federalAccountCode === selectedCode) || defaultAccount;
  const fiscalYear = accountSpine?.metadata?.fiscalYear;
  const stages = selected ? [
    { label: "Requested", amount: selected.requestAmount, source: `FY${fiscalYear} President's Budget display books`, relationship: "derived" },
    { label: "Apportioned", amount: selected.apportionedAmount, source: `${selected.exactApportionmentJoinCount} exact OMB TAFS joins` },
    { label: "Obligated", amount: selected.obligatedAmount, source: "USAspending account execution" },
    { label: "Outlays", amount: selected.outlayedAmount, source: "USAspending account execution" },
  ] : [];
  const maximum = Math.max(...stages.map((stage) => stage.amount || 0), 1);
  const treasuryRows = (selected?.treasuryAccounts || []).filter((row) => row.exactApportionmentJoin).sort((left, right) => right.obligatedAmount - left.obligatedAmount).slice(0, 10);
  const maxTreasury = Math.max(...treasuryRows.flatMap((row) => [row.apportionment?.approvedAmount || 0, row.obligatedAmount || 0, row.outlayedAmount || 0]), 1);
  const selectedAwardRows = awardFlows.flatMap((award) => (award.accounts || []).filter((account) => account.federalAccountCode === selected?.federalAccountCode).map((account) => ({ ...award, accountObligatedAmount: account.obligatedAmount }))).sort((left, right) => right.accountObligatedAmount - left.accountObligatedAmount).slice(0, 10);
  const maxAwardObligation = Math.max(...selectedAwardRows.map((award) => award.accountObligatedAmount), 1);
  const burn = (accountSpine?.agencyBurn?.agency_data_by_year || []).find((row) => Number(row.fiscal_year) === Number(fiscalYear));
  const historyRows = (accountSpine?.agencyBurn?.agency_data_by_year || []).filter((row) => Number(row.fiscal_year) <= Number(fiscalYear)).sort((left, right) => Number(left.fiscal_year) - Number(right.fiscal_year)).slice(-5);
  const historyMaximum = Math.max(...historyRows.flatMap((row) => [Number(row.agency_budgetary_resources || 0), Number(row.agency_total_obligated || 0), Number(row.agency_total_outlayed || 0)]), 1);
  const burnRows = burn?.agency_obligation_by_period || EMPTY_ROWS;
  const latestBurnIsPartial = burnRows.length > 1 && Number(burnRows.at(-1)?.obligated || 0) < Math.max(...burnRows.slice(0, -1).map((row) => Number(row.obligated || 0)));
  const burnMaximum = Math.max(...burnRows.map((row) => Number(row.obligated || 0)), 1);
  const burnPoints = burnRows.map((row, index) => `${burnRows.length > 1 ? 24 + (index / (burnRows.length - 1)) * 552 : 24},${176 - (Number(row.obligated || 0) / burnMaximum) * 140}`).join(" ");
  const coverage = accountSpine?.metadata?.coverage || {};

  if (!selected) return <ControlAsyncState compact state="empty" title="No account flow available" message="The current dataset does not include a federal account spine to inspect." />;

  return <div className="grid lifecycle-page" data-account-spine-page>
    <PhaseIntro eyebrow="Account execution" description="Follow a federal account from requested funding through OMB apportionment, obligations, and outlays. Exact TAFS joins stay solid; the request edge is separately labeled derived." facts={[
      { value: coverage.federalAccounts || accounts.length, label: "federal accounts" },
      { value: coverage.exactTafsJoins || 0, label: "exact TAFS joins" },
      { value: `${Math.round((coverage.exactTafsJoinRate || 0) * 100)}%`, label: "TAFS coverage" },
      { value: coverage.requestMatchedAccounts || 0, label: "request matches" },
      { value: coverage.exactAwardAccountLinks || 0, label: "exact award links" },
      { value: coverage.awardsMappedToCurrentAccounts || 0, label: "awards mapped" },
    ]} />

    <section className="lifecycle-account-picker"><span>Federal account</span><ControlSelect ariaLabel="Federal account" searchable value={selected.federalAccountCode} onChange={setSelectedCode} options={accounts.map((account) => ({ value: account.federalAccountCode, label: `${account.federalAccountCode} · ${account.title}`, description: account.bureauName || "Federal account" }))} /><p>{selected.bureauName || "Department of War"} · FY{fiscalYear} · observed {dateTime(accountSpine.metadata.generatedAt)}</p></section>

    <Section title="Request-to-Execution Waterfall" meta="distinct money stages, never summed" icon={BarChart3}><div className="lifecycle-waterfall" data-lifecycle-waterfall>{stages.map((stage) => <LifecycleStage key={stage.label} {...stage} maximum={maximum} />)}</div><p className="lifecycle-caveat">Apportionment can exceed the current request because it can include prior-year balances, collections, and other budgetary resources. These stages are compared, not added.</p></Section>

    <Section title="TAFS Account Flow" meta={`${treasuryRows.length} highest-obligation exact joins shown`} icon={Network}><div className="tafs-flow" data-account-flow>{treasuryRows.slice(0, 2).map((row) => <TafsFlowCard key={row.tasCode} row={row} maximum={maxTreasury} />)}{treasuryRows.length > 2 ? <details className="tafs-flow__more"><summary>{treasuryRows.length - 2} more exact TAFS accounts</summary><div className="tafs-flow tafs-flow--nested">{treasuryRows.slice(2).map((row) => <TafsFlowCard key={row.tasCode} row={row} maximum={maxTreasury} />)}</div></details> : null}</div></Section>

    <ControlDisclosure className="lifecycle-detail-disclosure" icon={<GitBranch size={16} />} title="Execution history and evidence" summary="Award links, five-year totals, obligation burn, and source policy"><div className="grid">
      <Section title="Award-to-Account Flow" meta={`${selectedAwardRows.length} highest-obligation sampled awards shown`} icon={GitBranch}><div className="award-account-flow" data-award-account-flow>{selectedAwardRows.length ? selectedAwardRows.map((award) => <article key={award.awardId}><header><div><strong>{award.recipient}</strong><span>{award.awardNumber} · {award.areas?.map((area) => area.label).join(", ")}</span></div><a href={award.sourceUrl} target="_blank" rel="noreferrer">Award source <ExternalLink size={13} aria-hidden="true" /></a></header><p>{award.description || "No public award description."}</p><div><span>Obligations from {selected.federalAccountCode}</span><i aria-hidden="true"><b style={{ width: `${Math.max(2, (award.accountObligatedAmount / maxAwardObligation) * 100)}%` }} /></i><strong>{federalMoney(award.accountObligatedAmount)}</strong></div></article>) : <ControlAsyncState compact state="empty" title="No exact award links" message="This account has no exact award links in the ranked technology-award sample." />}</div><p className="lifecycle-caveat">Each edge is reported by USAspending from award transactions to a federal account. The set is limited to the {coverage.sampledAwards || 0} highest-value awards in the current technology sample and is not a complete account ledger.</p></Section>

      <Section title="Five-Year Execution History" meta="Department totals as published by USAspending" icon={BarChart3}><div className="fiscal-history" data-fiscal-history>{historyRows.map((row) => <article key={row.fiscal_year}><header><strong>FY{row.fiscal_year}</strong><span>{percent((Number(row.agency_total_obligated || 0) / Math.max(Number(row.agency_budgetary_resources || 0), 1)) * 100)} obligated</span></header>{[["Resources", row.agency_budgetary_resources, "blue"], ["Obligations", row.agency_total_obligated, "purple"], ["Outlays", row.agency_total_outlayed, "green"]].map(([label, amount, tone]) => <div key={label}><span>{label}</span><i aria-hidden="true"><b className={`tone-${tone}`} style={{ width: `${Math.max(1, (Number(amount || 0) / historyMaximum) * 100)}%` }} /></i><strong>{federalMoney(amount)}</strong></div>)}</article>)}</div><p className="lifecycle-caveat">Fiscal years are separate published snapshots. Current-year values may be partial or revised and should not be treated as final year-end totals.</p></Section>

      <Section title="Department Obligation Burn" meta={`FY${fiscalYear} reported agency obligations by period`} icon={TrendingUp}><div className="burn-chart" data-burn-curve><svg viewBox="0 0 600 210" role="img" aria-labelledby="burn-title burn-description"><title id="burn-title">Department-wide obligation burn curve</title><desc id="burn-description">Reported Department of War obligations by USAspending reporting period for fiscal year {fiscalYear}.</desc><line x1="24" y1="176" x2="576" y2="176" /><line x1="24" y1="36" x2="24" y2="176" /><polyline points={burnPoints} />{burnRows.map((row, index) => { const [x, y] = burnPoints.split(" ")[index].split(","); return <circle key={row.period} cx={x} cy={y} r="4"><title>Period {row.period}: {federalMoney(row.obligated)}</title></circle>; })}</svg><div className="burn-chart__periods">{burnRows.map((row) => <span key={row.period}>P{row.period}<strong>{federalMoney(row.obligated)}</strong></span>)}</div>{latestBurnIsPartial ? <p className="lifecycle-caveat">The latest reported period is below the prior high-water mark and may be incomplete or revised. It is shown as published rather than forced into a monotonic curve.</p> : null}</div></Section>

      <Section title="Evidence and Join Policy" meta="reproducible public sources" icon={Database}><div className="lifecycle-evidence" data-lifecycle-evidence><a href={selected.sourceUrl} target="_blank" rel="noreferrer"><strong>USAspending federal account</strong><span>Resources, obligations, outlays, and Treasury accounts</span></a><a href={accountSpine.metadata.sources.ombApportionments} target="_blank" rel="noreferrer"><strong>OMB approved apportionments</strong><span>Latest public FY{fiscalYear} document by TAFS</span></a><a href={accountSpine.metadata.sources.usaSpendingAwardAccounts} target="_blank" rel="noreferrer"><strong>USAspending award accounts</strong><span>Exact transaction-funded federal-account links for sampled awards</span></a>{(selected.requestMatch?.sourceUrls || []).slice(0, 2).map((url) => <a key={url} href={url} target="_blank" rel="noreferrer"><strong>DoW budget request</strong><span>Exact normalized account-title match, labeled derived</span></a>)}</div><p className="lifecycle-caveat">Award-to-account edges are exact. No budget-line or program-element-to-award link is asserted; that last-mile relationship remains unlinked until a public identifier or cited source supports it.</p></Section>
    </div></ControlDisclosure>
  </div>;
}

function ResetFilters({ filters, onReset }) {
  const active = Object.keys(FILTER_DEFAULTS).some((key) => filters[key] !== FILTER_DEFAULTS[key]);
  return <button type="button" className="reset-filters" onClick={onReset} disabled={!active}><RotateCcw size={14} aria-hidden="true" /> Reset</button>;
}

function ControlField({ label, value, options, onChange, ariaLabel = label, searchable }) {
  return <div className="control-field"><span>{label}</span><ControlSelect value={value} options={options} onChange={onChange} ariaLabel={ariaLabel} searchable={searchable} /></div>;
}

function FilterShell({ filters, setFilters, data, books, signals }) {
  const orgs = useMemo(() => aggregate(data.records, (record) => ({ id: record.org, label: record.orgName })).slice(0, 40), [data.records]);
  return <div className="if-control-bar filters" aria-label="Budget filters" data-budget-filter-bar>
    <label className="searchbox"><Search size={15} aria-hidden="true" /><input placeholder="Search line items, accounts, organizations" value={filters.query} onChange={(event) => setFilters({ ...filters, query: event.target.value })} /></label>
    <div className="filters__secondary">
      <ControlField label="Color" value={filters.book} options={[["all", "All colors"], ...books.map((book) => [book.id, `${book.short} · ${book.color}`])]} onChange={(book) => setFilters({ ...filters, book })} />
      <ControlField label="Org type" value={filters.group} options={[["all", "All DoD"], ["service", "Services"], ["fourth-estate", "Fourth Estate"], ["other", "Other / Reconciliation"]]} onChange={(group) => setFilters({ ...filters, group })} />
      <ControlField label="Signal" value={filters.signal} options={[["all", "All signals"], ...signals.map((signal) => [signal.id, signal.label])]} onChange={(signal) => setFilters({ ...filters, signal })} />
      <ControlField label="Organization" searchable value={filters.org} options={[["all", "All organizations"], ...orgs.map((org) => [org.id, org.label])]} onChange={(org) => setFilters({ ...filters, org })} />
      <ResetFilters filters={filters} onReset={() => setFilters(FILTER_DEFAULTS)} />
    </div>
  </div>;
}

function useFilteredRecords(filters, sourceRecords = []) {
  return useMemo(() => {
    const query = filters.query.trim().toLowerCase();
    return sourceRecords.filter((record) => {
      if (filters.book !== "all" && record.bookId !== filters.book) return false;
      if (filters.group !== "all" && record.orgGroup !== filters.group) return false;
      if (filters.signal !== "all" && !record.signals.includes(filters.signal)) return false;
      if (filters.org !== "all" && record.org !== filters.org) return false;
      if (!query) return true;
      return [record.accountTitle, record.orgName, record.budgetActivityTitle, record.subActivityTitle, record.lineTitle, record.lineCode].join(" ").toLowerCase().includes(query);
    });
  }, [filters, sourceRecords]);
}

function sourceUrlForRow(row, books, sourcePackageUrl) {
  if (row?.justificationEvidence?.sourcePdfUrl || row?.justificationEvidence?.sourceUrl) return row.justificationEvidence.sourcePdfUrl || row.justificationEvidence.sourceUrl;
  if (row?.bookId) return books.find((book) => book.id === row.bookId)?.sourceUrl || "";
  if (row?.id?.startsWith("CONT_AWD_") || row?.awardId) return row.id ? `https://www.usaspending.gov/award/${encodeURIComponent(row.id)}/latest` : "https://www.usaspending.gov/";
  return sourcePackageUrl || "";
}

function Overview({ records, signals }) {
  const byBook = aggregate(records, (record) => ({ id: record.bookId, label: record.color, short: record.colorShort }));
  const byOrgGroup = aggregate(records, (record) => ({ id: record.orgGroup, label: GROUP_LABELS[record.orgGroup] }));
  const bySignal = signals.map((signal) => aggregate(records.filter((record) => record.signals.includes(signal.id)), () => ({ id: signal.id, label: signal.label }))[0]).filter(Boolean).sort((a, b) => b.fy2027 - a.fy2027);
  const maxBook = Math.max(...byBook.map((row) => row.fy2027), 1);
  const maxSignal = Math.max(...bySignal.map((row) => row.fy2027), 1);
  return <div className="grid">
    <PhaseIntro eyebrow="Official source request" description="Line-level President's Budget defense request data from official Comptroller display books. Values remain separate from apportionments, obligations, awards, and transactions." dataAttribute={{ "data-pdb-request-page": true }} />
    <div className="grid grid--wide">
      <Section title="Color of Money" meta="FY2027 request" icon={Layers}><div className="rank-list">{byBook.map((row) => <article key={row.id}><i className="dot" style={{ background: BOOK_COLORS[row.id] }} /><div><strong>{row.short}</strong><span>{row.label}</span></div><Bar value={row.fy2027} max={maxBook} color={BOOK_COLORS[row.id]} label={row.label} /><b>{money(row.fy2027)}</b></article>)}</div></Section>
      <Section title="Service / Fourth Estate" meta="FY2025-FY2027" icon={Building2}><div className="group-list">{byOrgGroup.map((row) => <article key={row.id}><div><strong>{row.label}</strong><span>{row.records} line records</span></div><Spark row={row} /><b>{money(row.fy2027)}</b><em>{pct(growth(row))}</em></article>)}</div></Section>
    </div>
    <ControlDisclosure className="request-signal-details" icon={<Filter size={16} />} title="Mission-signal classifications" summary="Keyword-derived categories from line titles"><div className="signal-grid">{bySignal.map((row) => <article key={row.id}><strong>{row.label}</strong><Bar value={row.fy2027} max={maxSignal} color="#005ea2" label={row.label} /><span>{money(row.fy2027)} · {pct(growth(row))}</span></article>)}</div></ControlDisclosure>
  </div>;
}

function RequestTrends({ dataInventory, books }) {
  const rows = dataInventory.requestHistory || EMPTY_ROWS;
  const trendSummary = dataInventory.trendSummary || {};
  const analytics = dataInventory.analyticsReadouts || {};
  const firstComparable = rows.find((row) => row.comparableRequestValue > 0);
  const latest = rows.at(-1);
  const maxRequest = Math.max(...rows.map((row) => row.requestValue), 1);
  const maxComparable = Math.max(...rows.map((row) => row.comparableRequestValue), 1);
  const aiSeries = rows.map((row) => row.bySignal?.find((signal) => signal.id === "ai-autonomy") || { requestValue: 0, records: 0 });
  const colorTrendRows = books.map((book) => ({ ...book, series: rows.map((row) => row.byBook?.find((item) => item.id === book.id)?.requestValue || 0) }));
  const signalTrendRows = (latest?.bySignal || []).filter((signal) => signal.requestValue > 0).slice(0, 8).map((signal) => ({ ...signal, series: rows.map((row) => row.bySignal?.find((item) => item.id === signal.id)?.requestValue || 0) }));
  return <div className="grid">
    <PhaseIntro eyebrow="Published request vintages" description="Year-over-year request values from official budget packages. Comparable trends use only books present across the compared vintages; keyword-derived categories remain labeled as classifications." dataAttribute={{ "data-request-history-page": true }} />
    <ControlMetricStrip className="trend-metrics" label="Request trend summary" mobileScroll compactMobile items={[
      { id: "vintages", label: "Request vintages", value: `${(dataInventory.availableBudgetRequestYears || []).length} years`, meta: `${yearList(dataInventory.availableBudgetRequestYears)} · ${trendSummary.sourceVersionCount || 0} workbook versions`, tone: "info" },
      { id: "records", label: "Historical records", value: (trendSummary.historicalRecordCount || 0).toLocaleString(), meta: "Aggregate model records across request packages", tone: "purple" },
      { id: "comparable", label: "Comparable set", value: `${trendSummary.comparableBookCount || 0} books`, meta: (trendSummary.comparableBooks || []).join(", "), tone: "success" },
      { id: "trend", label: "Comparable trend", value: pct(trendSummary.comparableGrowth || 0), meta: `${money(trendSummary.comparableEarliestRequestValue)} FY${trendSummary.comparableEarliestRequestYear} to ${money(trendSummary.comparableCurrentRequestValue)} FY${latest?.requestYear}`, tone: "warning" },
    ]} />
    <Section title="Request Vintage Timeline" meta="annual President's Budget packages" icon={CalendarClock}><div className="trend-year-list" data-request-history-timeline>{rows.map((row) => <article key={row.requestYear} className="trend-year-card"><header><div><span>{row.sourcePackage}</span><strong>{row.label}</strong></div><b>{money(row.requestValue)}</b></header><Bar value={row.requestValue} max={maxRequest} color="#005ea2" label={`${row.label} request value`} /><div className="trend-year-card__meta" aria-label={`${row.label} request metadata`}><span><strong>{row.sourceVersions}</strong> source versions</span><span><strong>{row.records.toLocaleString()}</strong> records</span><span><strong>{yearList(row.fiscalYears)}</strong> values present</span><span><strong>{money(row.comparableRequestValue)}</strong> comparable set</span></div></article>)}</div></Section>
    <div className="grid grid--sources">
      <Section title="Comparable Request Trend" meta={`${(trendSummary.comparableBooks || []).join(", ")} only`} icon={TrendingUp}><div className="trend-comparable-list" data-comparable-request-trend>{rows.map((row) => <article key={row.requestYear}><div><strong>{row.label}</strong><span>{firstComparable ? pct(requestGrowth(row.comparableRequestValue, firstComparable.comparableRequestValue)) : "+0.0%"}</span></div><Bar value={row.comparableRequestValue} max={maxComparable} color="#216e1f" label={`${row.label} comparable request value`} /><b>{money(row.comparableRequestValue)}</b></article>)}</div></Section>
      <Section title="AI / Autonomy Signal History" meta="keyword-derived request vintages" icon={BrainCircuit}><div className="trend-comparable-list" data-ai-signal-history>{rows.map((row, index) => <article key={row.requestYear}><div><strong>{row.label}</strong><span>{aiSeries[index].records.toLocaleString()} records</span></div><Bar value={aiSeries[index].requestValue} max={Math.max(...aiSeries.map((item) => item.requestValue), 1)} color="#5c4b8a" label={`${row.label} AI/autonomy request value`} /><b>{money(aiSeries[index].requestValue)}</b></article>)}</div></Section>
    </div>
    <ControlDisclosure className="trend-history-details" icon={<TrendingUp size={16} />} title="Detailed request history" summary="Largest changes, color-of-money vintages, and mission-signal movement"><div className="grid">
      <Section title="Largest Request Changes" meta="largest FY2026-FY2027 changes by keyword-derived mission signal" icon={TrendingUp}><div className="momentum-grid" data-momentum-leaders>{(analytics.signalMomentum || []).slice(0, 6).map((row) => <article key={row.id} className="momentum-card"><header><div><span>Mission signal</span><strong>{row.label}</strong></div><b>{pct(row.lastChangePct)}</b></header><p>{money(row.priorValue)} FY{row.priorYear} to {money(row.latestValue)} FY{row.latestYear}</p><Bar value={row.latestValue} max={Math.max(...(analytics.signalMomentum || []).map((item) => item.latestValue), 1)} color="#005ea2" label={`${row.label} latest value`} /></article>)}</div></Section>
      <Section title="Color Of Money History" meta="request value by workbook vintage" icon={Layers}><div className="trend-series-grid" data-color-money-history>{colorTrendRows.map((row) => <article key={row.id} className="trend-series-card"><header><i className="dot" style={{ background: BOOK_COLORS[row.id] }} /><div><strong>{row.short}</strong><span>{row.color}</span></div><b>{money(row.series.at(-1))}</b></header><div className="mini-bars" aria-label={`${row.short} request value history`}>{row.series.map((value, index) => <span key={`${row.id}-${rows[index].requestYear}`}><i style={{ height: `${Math.max((value / Math.max(...row.series, 1)) * 100, value ? 6 : 2)}%`, background: BOOK_COLORS[row.id] }} /><em>FY{rows[index].requestYear}</em></span>)}</div></article>)}</div></Section>
      <Section title="Mission Signal Movement" meta="latest-vintage leading signals" icon={Filter}><div className="trend-series-grid" data-mission-signal-history>{signalTrendRows.map((row) => <article key={row.id} className="trend-series-card trend-series-card--signal"><header><div><strong>{row.label}</strong><span>{row.records.toLocaleString()} latest records</span></div><b>{money(row.requestValue)}</b></header><div className="mini-bars" aria-label={`${row.label} request value history`}>{row.series.map((value, index) => <span key={`${row.id}-${rows[index].requestYear}`}><i style={{ height: `${Math.max((value / Math.max(...row.series, 1)) * 100, value ? 6 : 2)}%`, background: "#005ea2" }} /><em>FY{rows[index].requestYear}</em></span>)}</div></article>)}</div></Section>
    </div></ControlDisclosure>
  </div>;
}

export default function BudgetRequestRoutes({ view, budgetData, accountSpine }) {
  const books = budgetData.metadata.sources || EMPTY_ROWS;
  const signals = budgetData.signals || EMPTY_ROWS;
  const dataInventory = budgetData.metadata.dataInventory || {};
  const [filters, setFilters] = useUrlState(FILTER_DEFAULTS, {
    book: (value) => value === "all" || books.some((book) => book.id === value),
    group: ["all", "service", "fourth-estate", "other"],
    signal: (value) => value === "all" || signals.some((signal) => signal.id === value),
    org: (value) => value === "all" || budgetData.records.some((record) => record.org === value),
  });
  const records = useFilteredRecords(filters, budgetData.records);

  if (view === "lifecycle") return <AccountLifecycle accountSpine={accountSpine} />;
  if (view === "trends") return <RequestTrends dataInventory={dataInventory} books={books} />;

  const total = aggregate(records, () => ({ id: "filtered", label: "Filtered portfolio" }))[0] || { fy2025: 0, fy2026: 0, fy2027: 0, records: 0 };
  const ai = aggregate(records.filter((record) => record.signals.includes("ai-autonomy")), () => ({ id: "ai", label: "AI / Autonomy" }))[0] || { fy2027: 0, records: 0 };
  const fourth = aggregate(records.filter((record) => record.orgGroup === "fourth-estate"), () => ({ id: "fourth", label: "Fourth Estate" }))[0] || { fy2027: 0, records: 0 };
  const evidenceRecords = records.filter((record) => record.justificationEvidence);
  const confirmedEvidenceRecords = evidenceRecords.filter((record) => record.justificationEvidence?.confirmedTechnologyAreas?.length);
  const sourcePackageUrl = dataInventory.sourcePackageUrl || "";

  return <>
    <FilterShell filters={filters} setFilters={setFilters} data={budgetData} books={books} signals={signals} />
    <ControlMetricStrip data-budget-metrics label="Filtered budget metrics" mobileScroll compactMobile items={[
      { id: "request", label: "Filtered FY2027 request", value: money(total.fy2027), meta: `${total.records} line records · ${pct(growth(total))} since FY2025`, tone: "info" },
      { id: "ai", label: "AI / autonomy signal", value: money(ai.fy2027), meta: `${ai.records} matched source lines`, tone: "purple" },
      { id: "fourth", label: "Fourth Estate", value: money(fourth.fy2027), meta: `${fourth.records} agency / joint records`, tone: "success" },
      { id: "depth", label: "Data depth", value: `${budgetData.records.length.toLocaleString()} lines`, meta: "M-1, O-1, P-1, R-1, RF-1, C-1", tone: "warning" },
      { id: "narrative", label: "Narrative coverage", value: records.length ? percent((evidenceRecords.length / records.length) * 100, 1) : "0.0%", meta: `${evidenceRecords.length.toLocaleString()} source-matched · ${confirmedEvidenceRecords.length.toLocaleString()} narrative-confirmed`, tone: "success" },
    ]} />
    <AnalysisActions rows={records} filename="overview-budget-records" sourceUrlForRow={(row) => sourceUrlForRow(row, books, sourcePackageUrl)} exportMetadata={{ snapshotGeneratedAt: budgetData.metadata.generatedAt, methodology: budgetData.metadata.methodology }} />
    <Overview records={records} signals={signals} />
  </>;
}
