import { useMemo, useState } from "react";
import { ControlDisclosure, ControlDrawer } from "control-surface-ui/react";
import ControlWorkbenchHeader from "./WorkbenchHeader.jsx";
import { BarChart3, ExternalLink, FileSpreadsheet, RotateCcw, Search } from "lucide-react";
import AnalysisActions from "./AnalysisActions.jsx";
import Section from "./AnalysisSection.jsx";
import ControlSelect from "./ControlSelect.jsx";
import OperationalDataTable from "./OperationalDataTable.jsx";
import useUrlState from "./urlState.js";

const money = (value) => `$${Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 1 })}M`;
const percent = (value, digits = 0) => `${Number(value || 0).toFixed(digits)}%`;
const sum = (rows, key) => rows.reduce((total, row) => total + Number(row?.[key] || 0), 0);
const dateTime = (value) => value ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "Unknown";

function awardOptionRows(awards, keyFn) {
  return [...new Map(awards.map(keyFn).filter((item) => item?.id).map((item) => [item.id, item])).values()]
    .sort((a, b) => a.label.localeCompare(b.label));
}

function sourceUrlForRow(row, books, sourcePackageUrl) {
  if (row?.justificationEvidence?.sourcePdfUrl || row?.justificationEvidence?.sourceUrl) {
    return row.justificationEvidence.sourcePdfUrl || row.justificationEvidence.sourceUrl;
  }
  if (row?.bookId) return books.find((book) => book.id === row.bookId)?.sourceUrl || "";
  if (row?.id?.startsWith("CONT_AWD_") || row?.awardId) {
    return row.id ? `https://www.usaspending.gov/award/${encodeURIComponent(row.id)}/latest` : "https://www.usaspending.gov/";
  }
  return sourcePackageUrl || "";
}

function EvidenceDrawer({ record, onClose, books, sourcePackageUrl, snapshotGeneratedAt, methodology, executionCoverage }) {
  if (!record) return null;
  const book = record.bookId ? books.find((item) => item.id === record.bookId) : null;
  const isAward = Boolean(record.awardId || record.id?.startsWith("CONT_AWD_"));
  const sourceUrl = sourceUrlForRow(record, books, sourcePackageUrl);
  const evidence = record.justificationEvidence;
  const title = record.lineTitle || record.accountTitle || record.awardId || record.recipient || record.id;
  return (
      <ControlDrawer open onClose={onClose} eyebrow={isAward ? "Award evidence" : "Budget evidence"} title={title} size="wide" closeLabel="Close evidence details" drawerProps={{ "data-evidence-drawer": true }} bodyProps={{ className: "evidence-drawer__content" }}>
        <dl>
          <div><dt>Record ID</dt><dd>{record.awardId || record.id}</dd></div>
          <div><dt>Source system</dt><dd>{isAward ? "USAspending award snapshot" : evidence?.kind || `${book?.short || record.bookId} official display workbook`}</dd></div>
          <div><dt>Snapshot</dt><dd>{dateTime(isAward ? executionCoverage.cachedAt : snapshotGeneratedAt)}</dd></div>
          {!isAward ? <div><dt>Workbook</dt><dd>{book?.label || book?.color || record.bookId}</dd></div> : null}
          {evidence?.sourceDocument || evidence?.sourceName ? <div><dt>Narrative source</dt><dd>{evidence.sourceDocument || evidence.sourceName}</dd></div> : null}
          {evidence?.page || evidence?.lineNumber ? <div><dt>Evidence location</dt><dd>{evidence.page ? `Page ${evidence.page}` : `Line ${evidence.lineNumber}`}</dd></div> : null}
          <div><dt>Method</dt><dd>{isAward ? executionCoverage.methodology || "Cached USAspending award search with deterministic deduplication." : methodology}</dd></div>
        </dl>
        <a className="evidence-drawer__source" href={sourceUrl} target="_blank" rel="noreferrer" data-evidence-source>Open official source <ExternalLink size={14} aria-hidden="true" /></a>
      </ControlDrawer>
  );
}

function ResetFilters({ filters, defaults, onReset }) {
  const active = Object.keys(defaults).some((key) => filters[key] !== defaults[key]);
  return <button type="button" className="reset-filters" onClick={onReset} disabled={!active}><RotateCcw size={14} aria-hidden="true" /> Reset</button>;
}

function ControlField({ label, value, options, onChange, ariaLabel = label, searchable }) {
  return <div className="control-field"><span>{label}</span><ControlSelect value={value} options={options} onChange={onChange} ariaLabel={ariaLabel} searchable={searchable} /></div>;
}

function aggregateAwards(awards, keyFn) {
  const groups = new Map();
  for (const award of awards) {
    const key = keyFn(award);
    if (!key?.id) continue;
    const existing = groups.get(key.id) || { ...key, awardAmount: 0, awards: 0 };
    existing.awardAmount += award.awardAmount;
    existing.awards += 1;
    groups.set(key.id, existing);
  }
  return [...groups.values()].map((row) => ({ ...row, awardAmount: Number(row.awardAmount.toFixed(3)) })).sort((a, b) => b.awardAmount - a.awardAmount);
}

function AwardRollup({ title, rows }) {
  const max = Math.max(...rows.map((row) => row.awardAmount || 0), 1);
  return (
    <Section title={title} meta="current filters" icon={BarChart3}>
      <div className="award-rollup-list">
        {rows.map((row) => (
          <article key={row.id}>
            <div><strong>{row.label}</strong><span className="bar-track" aria-label={row.label}><i style={{ width: `${Math.max((row.awardAmount / max) * 100, row.awardAmount ? 1 : 0)}%`, background: "#005ea2" }} /></span></div>
            <b>{money(row.awardAmount)}</b><span>{row.awards} awards</span>
          </article>
        ))}
      </div>
    </Section>
  );
}

function AwardTable({ awards, sourceUrl, evidenceProps }) {
  const [evidenceRecord, setEvidenceRecord] = useState(null);
  const columns = [
    { key: "award", label: "Award", required: true, sticky: true, minWidth: 310, value: (award) => award.awardId || award.id, searchValue: (award) => [award.awardId, award.id, award.description, award.contractType], render: (award) => <><strong>{award.awardId || award.id}</strong><small>{award.contractType || "Contract award"} · {award.description || "No description"}</small></> },
    { key: "vendor", label: "Vendor", facet: true, minWidth: 180, value: (award) => award.recipient },
    { key: "buyer", label: "Buyer", facet: true, minWidth: 200, value: (award) => award.buyerSubAgency, searchValue: (award) => [award.buyerSubAgency, award.fundingOffice, award.awardingOffice], render: (award) => { const office = award.fundingOffice || award.awardingOffice || award.awardingSubAgency; return <><strong>{award.buyerSubAgency}</strong>{office && office !== award.buyerSubAgency ? <small>{office}</small> : null}</>; } },
    { key: "area", label: "Area", facet: true, minWidth: 150, value: (award) => (award.areas || [award.area]).slice(0, 2).join(", ") },
    { key: "workType", label: "Work type", facet: true, minWidth: 170, value: (award) => award.pscCode || award.naicsCode || "Uncoded", searchValue: (award) => [award.pscCode, award.naicsCode, award.pscDescription, award.naicsDescription], render: (award) => <><strong>{award.pscCode || award.naicsCode || "n/a"}</strong><small>{award.pscDescription || award.naicsDescription || "Uncoded"}</small></> },
    { key: "start", label: "Start", value: (award) => award.startDate || "Unknown" },
    { key: "end", label: "End", value: (award) => award.endDate || "Unknown" },
    { key: "value", label: "Award value", sortValue: (award) => Number(award.awardAmount || 0), exportValue: (award) => award.awardAmount, render: (award) => <strong>{money(award.awardAmount)}</strong> },
    { key: "actions", label: "Actions", role: "actions", required: true, sortable: false, render: (award) => <div className="dbi-table-actions"><a href={sourceUrl(award)} target="_blank" rel="noreferrer">Source<ExternalLink size={12} /></a><button type="button" onClick={() => setEvidenceRecord(award)}>Details</button></div> },
  ];
  return <><OperationalDataTable id="award-records" label="Award records" rows={awards} columns={columns} rowKey={(award) => award.id} defaultSort={{ key: "value", direction: "desc" }} searchPlaceholder="Search awards, vendors, buyers, PSC, or NAICS…" exportFilename="defense-awards.csv" defaultPageSize={25} mobileColumns={["award", "vendor", "buyer", "value", "actions"]} showSearch={false} showFacets={false} wrapperProps={{ "data-award-record-table": true }} /><EvidenceDrawer record={evidenceRecord} onClose={() => setEvidenceRecord(null)} {...evidenceProps} /></>;
}

export default function AwardsRoute({ awardDrilldown, books, sourcePackageUrl, snapshotGeneratedAt, methodology, executionCoverage }) {
  const awards = awardDrilldown.awards;
  const defaults = { query: "", area: "all", buyer: "all", vendor: "all", workType: "all", sort: "amount" };
  const [filters, setFilters] = useUrlState(defaults, {
    area: (value) => value === "all" || awards.some((award) => (award.areaIds || []).includes(value)),
    buyer: (value) => value === "all" || awards.some((award) => award.buyerSubAgency === value),
    vendor: (value) => value === "all" || awards.some((award) => award.recipient === value),
    workType: (value) => value === "all" || awards.some((award) => value === `psc:${award.pscCode}` || value === `naics:${award.naicsCode}`),
    sort: ["amount", "end", "start", "vendor"],
  });
  const areaOptions = useMemo(() => awardOptionRows(awards.flatMap((award) => (award.areaIds || []).map((id, index) => ({ id, label: award.areas?.[index] || id }))), (item) => item), [awards]);
  const buyerOptions = useMemo(() => awardOptionRows(awards, (award) => ({ id: award.buyerSubAgency, label: award.buyerSubAgency })), [awards]);
  const vendorOptions = useMemo(() => awardOptionRows(awards, (award) => ({ id: award.recipient, label: award.recipient })), [awards]);
  const workTypeOptions = useMemo(() => awardOptionRows(awards.flatMap((award) => [award.pscCode ? { id: `psc:${award.pscCode}`, label: `${award.pscCode} · ${award.pscDescription || "Unlabeled PSC"}` } : null, award.naicsCode ? { id: `naics:${award.naicsCode}`, label: `${award.naicsCode} · ${award.naicsDescription || "Unlabeled NAICS"}` } : null]), (item) => item), [awards]);
  const filteredAwards = awards.filter((award) => {
    const query = filters.query.trim().toLowerCase();
    const workTypeMatch = filters.workType === "all" || filters.workType === `psc:${award.pscCode}` || filters.workType === `naics:${award.naicsCode}`;
    return (!query || [award.awardId, award.recipient, award.buyerSubAgency, award.awardingSubAgency, award.awardingOffice, award.fundingOffice, award.description, award.pscDescription, award.naicsDescription, ...(award.areas || [])].join(" ").toLowerCase().includes(query))
      && (filters.area === "all" || (award.areaIds || []).includes(filters.area))
      && (filters.buyer === "all" || award.buyerSubAgency === filters.buyer)
      && (filters.vendor === "all" || award.recipient === filters.vendor)
      && workTypeMatch;
  }).sort((a, b) => {
    if (filters.sort === "end") return String(b.endDate || "").localeCompare(String(a.endDate || ""));
    if (filters.sort === "start") return String(b.startDate || "").localeCompare(String(a.startDate || ""));
    if (filters.sort === "vendor") return a.recipient.localeCompare(b.recipient) || b.awardAmount - a.awardAmount;
    return b.awardAmount - a.awardAmount;
  });
  const filteredValue = sum(filteredAwards, "awardAmount");
  const filteredOfficeCount = filteredAwards.filter((award) => award.fundingOffice || award.awardingOffice).length;
  const topBuyer = aggregateAwards(filteredAwards, (award) => ({ id: award.buyerSubAgency, label: award.buyerSubAgency })).slice(0, 4);
  const topVendor = aggregateAwards(filteredAwards, (award) => ({ id: award.recipient, label: award.recipient })).slice(0, 4);
  const topWork = aggregateAwards(filteredAwards.filter((award) => award.pscCode || award.naicsCode), (award) => ({ id: award.pscCode || award.naicsCode, label: award.pscCode ? `${award.pscCode} · ${award.pscDescription || "Unlabeled PSC"}` : `${award.naicsCode} · ${award.naicsDescription || "Unlabeled NAICS"}` })).slice(0, 4);
  const sourceUrl = (row) => sourceUrlForRow(row, books, sourcePackageUrl);
  const evidenceProps = { books, sourcePackageUrl, snapshotGeneratedAt, methodology, executionCoverage };
  const metrics = [{ id: "awards", label: "Matched awards", value: filteredAwards.length.toLocaleString(), meta: `${awards.length.toLocaleString()} in the sampled dataset`, tone: "info" }, { id: "value", label: "Matched value", value: money(filteredValue), meta: "Deduped award amount from current filters", tone: "success" }, { id: "buyer", label: "Largest buyer", value: topBuyer[0]?.label || "n/a", meta: topBuyer[0] ? `${money(topBuyer[0].awardAmount)} · ${topBuyer[0].awards} awards` : "No matching awards", tone: "purple" }, { id: "vendor", label: "Largest vendor", value: topVendor[0]?.label || "n/a", meta: topVendor[0] ? `${money(topVendor[0].awardAmount)} · ${topVendor[0].awards} awards` : "No matching awards", tone: "warning" }, { id: "office", label: "Office detail", value: filteredAwards.length ? percent((filteredOfficeCount / filteredAwards.length) * 100, 1) : "0.0%", meta: `${filteredOfficeCount.toLocaleString()} matched awards identify an office`, tone: "success" }];

  return <div className="grid awards-page" data-awards-page>
    <ControlWorkbenchHeader eyebrow="Award-level spend" title="Awards" summary="Search, inspect, and export the complete matched award set from the cached USAspending sample." metrics={metrics} metricLabel="Award filter metrics" actions={<AnalysisActions rows={filteredAwards} filename="filtered-awards" sourceUrlForRow={sourceUrl} exportMetadata={{ snapshotGeneratedAt, methodology }} />} controls={<div className="award-filter-bar" data-award-filter-bar>
      <label className="searchbox"><Search size={15} aria-hidden="true" /><input placeholder="Search award IDs, vendors, buyers, descriptions" value={filters.query} onChange={(event) => setFilters({ ...filters, query: event.target.value })} /></label>
      <ControlField label="Area" value={filters.area} options={[["all", "All areas"], ...areaOptions.map((option) => [option.id, option.label])]} onChange={(area) => setFilters({ ...filters, area })} />
      <ControlField label="Buyer" searchable value={filters.buyer} options={[["all", "All buyers"], ...buyerOptions.map((option) => [option.id, option.label])]} onChange={(buyer) => setFilters({ ...filters, buyer })} />
      <ControlField label="Vendor" searchable value={filters.vendor} options={[["all", "All vendors"], ...vendorOptions.map((option) => [option.id, option.label])]} onChange={(vendor) => setFilters({ ...filters, vendor })} />
      <ControlField label="Work type" searchable value={filters.workType} options={[["all", "All PSC / NAICS"], ...workTypeOptions.map((option) => [option.id, option.label])]} onChange={(workType) => setFilters({ ...filters, workType })} />
      <ControlField label="Sort" value={filters.sort} options={[["amount", "Award value"], ["end", "End date"], ["start", "Start date"], ["vendor", "Vendor"]]} onChange={(sort) => setFilters({ ...filters, sort })} />
      <ResetFilters filters={filters} defaults={defaults} onReset={() => setFilters(defaults)} />
    </div>} />
    <Section title="Award Records" meta={`${filteredAwards.length.toLocaleString()} matched · paginated below`} icon={FileSpreadsheet}><AwardTable awards={filteredAwards} sourceUrl={sourceUrl} evidenceProps={evidenceProps} /></Section>
    <ControlDisclosure className="award-rollup-details" icon={<BarChart3 size={16} />} title="Market rollups" summary="Top buyers, vendors, and coded work types for the current filters"><div className="grid grid--sources"><AwardRollup title="Top Buyers" rows={topBuyer} /><AwardRollup title="Top Vendors" rows={topVendor} /><AwardRollup title="Top Work Types" rows={topWork} /></div></ControlDisclosure>
  </div>;
}
