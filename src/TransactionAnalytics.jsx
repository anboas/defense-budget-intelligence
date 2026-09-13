import { useEffect, useMemo, useState } from "react";
import {
  hierarchy,
  interpolateBlues,
  max,
  scaleBand,
  scaleLinear,
  scaleOrdinal,
  scaleSequential,
  scaleSqrt,
  schemeTableau10,
  treemap,
} from "d3";
import {
  BarChart3,
  CalendarClock,
  ChevronRight,
  CircleDollarSign,
  Database,
  Download,
  Filter,
  Grid3X3,
  Layers3,
  Network,
  Search,
  SlidersHorizontal,
  TableProperties,
  X,
} from "lucide-react";
import {
  parseMultiValues,
  SearchMultiSelect,
  serializeMultiValues,
} from "./CaptureCalendar.jsx";
import {
  applyProcurementChanges,
  assembleProcurementRecords,
  INGESTION_METHOD_BY_ID,
  WORK_CATEGORY_BY_ID,
} from "./procurement-taxonomy.js";

function money(value) {
  const amount = Number(value || 0);
  if (amount >= 1_000_000_000)
    return `$${(amount / 1_000_000_000).toFixed(1)}B`;
  if (amount >= 1_000_000) return `$${(amount / 1_000_000).toFixed(1)}M`;
  return `$${Math.round(amount / 1_000).toLocaleString()}K`;
}

function recordValue(record) {
  return Number(
    record.potentialAmount ||
      record.valueHigh ||
      record.obligatedAmount ||
      record.valueLow ||
      0,
  );
}

function recordObligations(record) {
  return Number(record.obligatedAmount || 0);
}

const ANALYTICS_VIEWS = [
  { id: "overview", label: "Overview", icon: BarChart3 },
  { id: "schedule", label: "Schedule", icon: CalendarClock },
  { id: "spend", label: "Spend & structure", icon: CircleDollarSign },
  { id: "coverage", label: "Coverage & lineage", icon: Database },
];

const DIMENSIONS = [
  { id: "portfolio", label: "Portfolio", value: (record) => record.portfolio || "Not published" },
  { id: "work", label: "Type of work", value: (record) => WORK_CATEGORY_BY_ID.get(record.workCategory)?.label || "Other / unclassified" },
  { id: "buyer", label: "Funding office", value: (record) => record.fundingOffice || record.owner || "Not published" },
  { id: "recipient", label: "Recipient / sponsor", value: (record) => record.party || "Not published" },
  { id: "provenance", label: "Ingestion provenance", value: (record) => INGESTION_METHOD_BY_ID.get(record.ingestionMethod)?.label || record.ingestionMethod || "Not published" },
  { id: "pricing", label: "Pricing type", value: (record) => record.pricingType || "Not published" },
  { id: "competition", label: "Competition / set-aside", value: (record) => record.setAside || record.competitionType || "Not published" },
  { id: "vehicle", label: "Contract vehicle", value: (record) => record.vehicle || "Not published" },
  { id: "source", label: "Source system", value: (record) => record.sourceSystem || record.ingestionLabel || "Not published" },
];

const METRICS = [
  { id: "records", label: "Records", value: () => 1, format: (value) => Math.round(value).toLocaleString() },
  { id: "obligations", label: "Observed obligations", value: recordObligations, format: money },
  { id: "potential", label: "Reported potential", value: recordValue, format: money },
  { id: "actions", label: "FPDS actions", value: (record) => Number(record.transactionSummary?.actions || 0), format: (value) => Math.round(value).toLocaleString() },
  { id: "subawards", label: "Reported subawards", value: (record) => Number(record.subawardSummary?.reportedCount || 0), format: (value) => Math.round(value).toLocaleString() },
];

const VIEW_CHARTS = {
  overview: [
    ["dimension-explorer", "Dimension ranking"],
    ["quarterly", "Quarterly schedule activity"],
    ["scatter", "Obligation and value distribution"],
    ["value-distribution", "Reported value distribution"],
    ["treemap", "Portfolio and recipient composition"],
    ["work-categories", "Type of work composition"],
  ],
  schedule: [
    ["schedule-horizon", "Reported schedule horizon"],
    ["endpoint-seasonality", "Endpoint seasonality"],
    ["duration-distribution", "Reported term duration"],
    ["quarterly", "Quarterly schedule activity"],
    ["scatter", "Obligation and value distribution"],
  ],
  spend: [
    ["dimension-explorer", "Dimension ranking"],
    ["fiscal-trend", "Fiscal obligation trend"],
    ["buyer-year", "Funding office by fiscal year"],
    ["acquisition-matrix", "Pricing by competition structure"],
    ["vehicle-pricing", "Vehicle and pricing mix"],
    ["subawards", "Prime-to-subaward concentration"],
  ],
  coverage: [
    ["field-coverage", "Field coverage"],
    ["source-coverage", "Source-system coverage"],
    ["provenance", "Ingestion provenance"],
    ["money-lineage", "Money lineage and public join gaps"],
    ["changes", "Changed since prior snapshot"],
  ],
};

const DEFAULT_VISIBLE_CHARTS = Object.fromEntries(
  Object.entries(VIEW_CHARTS).map(([view, charts]) => [
    view,
    charts.map(([id]) => id),
  ]),
);

function normalizeText(value) {
  return String(value || "").trim().toLowerCase();
}

function dateYear(value) {
  if (!value) return null;
  const year = Number(String(value).slice(0, 4));
  return Number.isFinite(year) ? year : null;
}

function recordMatchesQuery(record, query) {
  const needle = normalizeText(query);
  if (!needle) return true;
  return normalizeText([
    record.id,
    record.title,
    record.party,
    record.portfolio,
    record.fundingOffice,
    record.contractingOffice,
    record.reference,
    record.parentReference,
    record.vehicle,
    record.pricingType,
    record.competitionType,
    record.setAside,
    record.pscCode,
    record.naicsCode,
    WORK_CATEGORY_BY_ID.get(record.workCategory)?.label,
  ].filter(Boolean).join(" ")).includes(needle);
}

function activateWithKeyboard(event, callback) {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    callback();
  }
}

function csvCell(value) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function exportAnalyticsSlice(records, metric, context) {
  const headers = ["snapshot", "analyticsView", "dimension", "measure", "opportunityId", "ganttAlias", "recordType", "title", "recipientOrSponsor", "portfolio", "workCategory", "fundingOffice", "contractingOffice", "reference", "vehicle", "pricingType", "competitionOrSetAside", "reportedStart", "reportedEnd", "potentialEnd", "observedObligations", "reportedPotential", "fpdsActions", "reportedSubawards", "ingestionProvenance", "primarySource"];
  const rows = records.map((record) => [
    context.snapshot,
    context.view,
    context.dimension,
    metric.label,
    record.opportunityId,
    record.id,
    record.mode,
    record.title,
    record.party,
    record.portfolio,
    WORK_CATEGORY_BY_ID.get(record.workCategory)?.label || "Other / unclassified",
    record.fundingOffice,
    record.contractingOffice,
    record.reference,
    record.vehicle,
    record.pricingType,
    record.setAside || record.competitionType,
    record.start || record.solicitationStart,
    record.currentEnd || record.solicitationEnd,
    record.potentialEnd,
    recordObligations(record),
    recordValue(record),
    record.transactionSummary?.actions || 0,
    record.subawardSummary?.reportedCount || 0,
    record.ingestionLabel || record.ingestionMethod,
    record.sourceUrls?.[0],
  ]);
  const csv = [headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\n");
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  link.download = `contract-analytics-${context.view}-${context.snapshot}.csv`;
  link.click();
  URL.revokeObjectURL(link.href);
}

function ChartFrame({ icon: Icon, title, note, children, testId }) {
  const [hover, setHover] = useState(null);

  function showHover(target, clientX, clientY) {
    const mark = target.closest?.("[data-analytics-tooltip]");
    if (!mark) {
      setHover(null);
      return;
    }
    const content = mark.getAttribute("data-analytics-tooltip");
    if (!content) return;
    setHover({
      lines: content.split("\n").filter(Boolean),
      x: Math.min(clientX + 14, window.innerWidth - 292),
      y: Math.min(clientY + 14, window.innerHeight - 170),
    });
  }

  return (
    <section
      className="transaction-viz"
      data-d3-analytics={testId}
      onPointerMove={(event) => {
        if (event.pointerType && event.pointerType !== "mouse") return;
        showHover(event.target, event.clientX, event.clientY);
      }}
      onPointerLeave={() => setHover(null)}
      onFocusCapture={(event) => {
        const bounds = event.target.getBoundingClientRect?.();
        if (bounds) showHover(event.target, bounds.right, bounds.top);
      }}
      onBlurCapture={() => setHover(null)}
    >
      <header>
        <Icon size={18} aria-hidden="true" />
        <span>
          <strong>{title}</strong>
          <small>{note}</small>
        </span>
      </header>
      <div className="transaction-viz__scroller">{children}</div>
      {hover ? (
        <aside
          className="analytics-hovercard"
          data-analytics-hovercard
          style={{ left: hover.x, top: hover.y }}
          role="status"
        >
          <strong>{hover.lines[0]}</strong>
          {hover.lines.slice(1).map((line) => (
            <span key={line}>{line}</span>
          ))}
        </aside>
      ) : null}
    </section>
  );
}

function EventTimeline({ records }) {
  const quarters = useMemo(() => {
    const map = new Map();
    for (let year = 2023; year <= 2034; year += 1)
      for (let quarter = 1; quarter <= 4; quarter += 1)
        map.set(`${year} Q${quarter}`, {
          label: `${year} Q${quarter}`,
          terms: 0,
          events: 0,
        });
    for (const record of records) {
      if (record.currentEnd) {
        const date = new Date(`${record.currentEnd}T00:00:00Z`);
        const row = map.get(
          `${date.getUTCFullYear()} Q${Math.floor(date.getUTCMonth() / 3) + 1}`,
        );
        if (row) row.terms += 1;
      }
      for (const event of record.milestones || []) {
        if (!event.start) continue;
        const date = new Date(`${event.start}T00:00:00Z`);
        const row = map.get(
          `${date.getUTCFullYear()} Q${Math.floor(date.getUTCMonth() / 3) + 1}`,
        );
        if (row) row.events += 1;
      }
    }
    return [...map.values()];
  }, [records]);
  const width = 1180;
  const height = 260;
  const inset = { top: 24, right: 18, bottom: 50, left: 46 };
  const x = scaleBand()
    .domain(quarters.map((row) => row.label))
    .range([inset.left, width - inset.right])
    .padding(0.18);
  const y = scaleSqrt()
    .domain([0, max(quarters, (row) => Math.max(row.terms, row.events)) || 1])
    .range([height - inset.bottom, inset.top]);
  const colors = { terms: "#005ea2", events: "#7d4e9f" };
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label="Quarterly reported term ends and published acquisition events"
    >
      <line
        x1={inset.left}
        x2={width - inset.right}
        y1={height - inset.bottom}
        y2={height - inset.bottom}
      />
      {quarters.map((row, index) => (
        <g key={row.label}>
          <rect
            x={x(row.label)}
            y={y(row.terms)}
            width={x.bandwidth() / 2}
            height={height - inset.bottom - y(row.terms)}
            fill={colors.terms}
            data-analytics-tooltip={`${row.label}\n${row.terms.toLocaleString()} reported term ends`}
          />
          <rect
            x={x(row.label) + x.bandwidth() / 2}
            y={y(row.events)}
            width={x.bandwidth() / 2}
            height={height - inset.bottom - y(row.events)}
            fill={colors.events}
            data-analytics-tooltip={`${row.label}\n${row.events.toLocaleString()} published events`}
          />
          {index % 4 === 0 ? (
            <text x={x(row.label)} y={height - 29}>
              {row.label.slice(0, 4)}
            </text>
          ) : null}
        </g>
      ))}
    </svg>
  );
}

function ValueScatter({ records, onSelect }) {
  const points = records.filter(
    (record) => recordValue(record) > 0 && recordObligations(record) > 0,
  );
  const width = 760;
  const height = 360;
  const inset = { top: 24, right: 24, bottom: 48, left: 68 };
  const x = scaleSqrt()
    .domain([0, max(points, recordValue) || 1])
    .range([inset.left, width - inset.right]);
  const y = scaleSqrt()
    .domain([0, max(points, recordObligations) || 1])
    .range([height - inset.bottom, inset.top]);
  const colors = scaleOrdinal(schemeTableau10);
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label="Observed obligations compared with reported potential values"
    >
      <line
        x1={inset.left}
        x2={width - inset.right}
        y1={height - inset.bottom}
        y2={height - inset.bottom}
      />
      <line
        x1={inset.left}
        x2={inset.left}
        y1={inset.top}
        y2={height - inset.bottom}
      />
      {points.map((record) => (
        <circle
          key={record.opportunityId}
          cx={x(recordValue(record))}
          cy={y(recordObligations(record))}
          r={Math.min(
            4 + Math.sqrt(record.transactionSummary?.actions || 0),
            13,
          )}
          fill={colors(record.portfolio)}
          opacity="0.72"
          role="button"
          tabIndex="0"
          aria-label={`${record.id}, ${record.title}, ${money(recordObligatedAmount(record))} observed obligations`}
          data-analytics-tooltip={`${record.id} · ${record.title}\n${money(recordObligatedAmount(record))} observed obligations\n${money(recordValue(record))} reported potential / high\n${record.transactionSummary?.actions || 0} FPDS actions`}
          onClick={() => onSelect?.(record)}
          onKeyDown={(event) => activateWithKeyboard(event, () => onSelect?.(record))}
        />
      ))}
      <text
        x={(inset.left + width - inset.right) / 2}
        y={height - 10}
        textAnchor="middle"
      >
        Reported potential / high value
      </text>
      <text
        x="16"
        y={height / 2}
        transform={`rotate(-90 16 ${height / 2})`}
        textAnchor="middle"
      >
        Observed obligations
      </text>
    </svg>
  );
}

function recordObligatedAmount(record) {
  return Number(record.obligatedAmount || 0);
}

function PortfolioTreemap({ records, metric, onRecipient }) {
  const grouped = new Map();
  for (const record of records) {
    const portfolio = record.portfolio || "Portfolio not published";
    const party = record.party || "Recipient / sponsor not published";
    const key = `${portfolio}|${party}`;
    const value =
      metric === "records"
        ? 1
        : metric === "potential"
          ? recordValue(record)
          : recordObligations(record);
    grouped.set(key, {
      portfolio,
      party,
      value: (grouped.get(key)?.value || 0) + value,
    });
  }
  const children = [
    ...new Set([...grouped.values()].map((row) => row.portfolio)),
  ].map((portfolio) => ({
    name: portfolio,
    children: [...grouped.values()]
      .filter((row) => row.portfolio === portfolio)
      .map((row) => ({ name: row.party, value: row.value })),
  }));
  const root = treemap().size([920, 420]).paddingOuter(3).paddingInner(1)(
    hierarchy({ name: "Transactions", children })
      .sum((node) => node.value || 0)
      .sort((a, b) => b.value - a.value),
  );
  const color = scaleOrdinal(schemeTableau10);
  return (
    <svg
      viewBox="0 0 920 420"
      role="img"
      aria-label={`Portfolio and recipient treemap sized by ${metric}`}
    >
      <g>
        {root.leaves().map((leaf) => {
          const portfolio = leaf.parent.data.name;
          const width = leaf.x1 - leaf.x0;
          const height = leaf.y1 - leaf.y0;
          return (
            <g key={`${portfolio}-${leaf.data.name}`} role="button" tabIndex="0" data-analytics-tooltip={`${portfolio}\n${leaf.data.name}\n${metric === "records" ? `${leaf.value} records` : money(leaf.value)}\nClick to filter every view`} onClick={() => onRecipient?.(leaf.data.name)} onKeyDown={(event) => activateWithKeyboard(event, () => onRecipient?.(leaf.data.name))}>
              <rect
                x={leaf.x0}
                y={leaf.y0}
                width={width}
                height={height}
                fill={color(portfolio)}
                opacity="0.78"
                data-analytics-tooltip={`${portfolio}\n${leaf.data.name}\n${metric === "records" ? `${leaf.value} records` : money(leaf.value)}`}
              />
              {width > 90 && height > 34 ? (
                <>
                  <text x={leaf.x0 + 6} y={leaf.y0 + 15}>
                    {leaf.data.name.slice(
                      0,
                      Math.max(10, Math.floor(width / 8)),
                    )}
                  </text>
                  <text x={leaf.x0 + 6} y={leaf.y0 + 29}>
                    {metric === "records"
                      ? `${leaf.value} records`
                      : money(leaf.value)}
                  </text>
                </>
              ) : null}
            </g>
          );
        })}
      </g>
    </svg>
  );
}

function BuyerYearHeatmap({ records, onBuyer }) {
  const years = [
    ...new Set(
      records.flatMap((record) =>
        (record.fiscalValues || []).map((row) => row.fiscalYear),
      ),
    ),
  ].sort((a, b) => a - b);
  const buyers = [
    ...new Set(
      records
        .map((record) => record.fundingOffice || record.owner)
        .filter(Boolean),
    ),
  ]
    .map((buyer) => ({
      buyer,
      total: records
        .filter((record) => (record.fundingOffice || record.owner) === buyer)
        .reduce((sum, record) => sum + recordObligations(record), 0),
    }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 12)
    .map((row) => row.buyer);
  const cells = buyers.flatMap((buyer) =>
    years.map((year) => ({
      buyer,
      year,
      value: records
        .filter((record) => (record.fundingOffice || record.owner) === buyer)
        .reduce(
          (sum, record) =>
            sum +
            (record.fiscalValues || [])
              .filter((item) => item.fiscalYear === year)
              .reduce((yearSum, item) => yearSum + Number(item.amount || 0), 0),
          0,
        ),
    })),
  );
  const width = 1180;
  const height = 390;
  const inset = { top: 42, right: 20, bottom: 24, left: 300 };
  const x = scaleBand()
    .domain(years)
    .range([inset.left, width - inset.right])
    .padding(0.06);
  const y = scaleBand()
    .domain(buyers)
    .range([inset.top, height - inset.bottom])
    .padding(0.06);
  const color = scaleSequential(interpolateBlues).domain([
    0,
    max(cells, (row) => row.value) || 1,
  ]);
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label="Funding office annual obligation heatmap"
    >
      {years.map((year) => (
        <text
          key={year}
          x={(x(year) || 0) + x.bandwidth() / 2}
          y="27"
          textAnchor="middle"
        >
          FY{year}
        </text>
      ))}
      {buyers.map((buyer) => (
        <text
          key={buyer}
          x={inset.left - 8}
          y={(y(buyer) || 0) + y.bandwidth() / 2 + 4}
          textAnchor="end"
        >
          {buyer.slice(0, 42)}
        </text>
      ))}
      {cells.map((cell) => (
        <rect
          key={`${cell.buyer}-${cell.year}`}
          x={x(cell.year)}
          y={y(cell.buyer)}
          width={x.bandwidth()}
          height={y.bandwidth()}
          fill={cell.value ? color(cell.value) : "#eef2f5"}
          role="button"
          tabIndex="0"
          data-analytics-tooltip={`${cell.buyer}\nFY${cell.year}\n${cell.value ? money(cell.value) : "No reported obligations in this dataset"}\nClick to filter every view by funding office`}
          onClick={() => onBuyer?.(cell.buyer)}
          onKeyDown={(event) => activateWithKeyboard(event, () => onBuyer?.(cell.buyer))}
        />
      ))}
    </svg>
  );
}

function WorkCategoryTreemap({ records, onCategory }) {
  const rows = [
    ...new Set(
      records.map((record) => record.workCategory || "other-unclassified"),
    ),
  ]
    .map((category) => ({
      name: WORK_CATEGORY_BY_ID.get(category)?.label || "Other / unclassified",
      color: WORK_CATEGORY_BY_ID.get(category)?.color || "#6c7b88",
      value: records.filter(
        (record) => (record.workCategory || "other-unclassified") === category,
      ).length,
      obligations: records
        .filter(
          (record) =>
            (record.workCategory || "other-unclassified") === category,
        )
        .reduce((sum, record) => sum + recordObligations(record), 0),
    }))
    .sort((left, right) => right.value - left.value);
  const root = treemap().size([920, 420]).paddingOuter(3).paddingInner(2)(
    hierarchy({ name: "Work", children: rows }).sum((node) => node.value || 0),
  );
  return (
    <svg
      viewBox="0 0 920 420"
      role="img"
      aria-label="Work category composition by record count"
    >
      {root.leaves().map((leaf) => {
        const width = leaf.x1 - leaf.x0;
        const height = leaf.y1 - leaf.y0;
        return (
          <g key={leaf.data.name} role="button" tabIndex="0" data-analytics-tooltip={`${leaf.data.name}\n${leaf.value} records\n${money(leaf.data.obligations)} observed obligations\nClick to filter every view`} onClick={() => onCategory?.(leaf.data.name)} onKeyDown={(event) => activateWithKeyboard(event, () => onCategory?.(leaf.data.name))}>
            <rect
              x={leaf.x0}
              y={leaf.y0}
              width={width}
              height={height}
              fill={leaf.data.color}
              opacity="0.82"
              data-analytics-tooltip={`${leaf.data.name}\n${leaf.value} records\n${money(leaf.data.obligations)} observed obligations`}
            />
            {width > 100 && height > 36 ? (
              <>
                <text x={leaf.x0 + 7} y={leaf.y0 + 16}>
                  {leaf.data.name.slice(0, Math.max(12, Math.floor(width / 8)))}
                </text>
                <text x={leaf.x0 + 7} y={leaf.y0 + 31}>
                  {leaf.value} records
                </text>
              </>
            ) : null}
          </g>
        );
      })}
    </svg>
  );
}

function ProvenanceBars({ records, onProvenance }) {
  const rows = [
    ...new Set(
      records.map((record) => record.ingestionMethod || "source-file"),
    ),
  ]
    .map((method) => ({
      method,
      label: INGESTION_METHOD_BY_ID.get(method)?.label || method,
      color: INGESTION_METHOD_BY_ID.get(method)?.color || "#647a8b",
      records: records.filter(
        (record) => (record.ingestionMethod || "source-file") === method,
      ).length,
      obligations: records
        .filter(
          (record) => (record.ingestionMethod || "source-file") === method,
        )
        .reduce((sum, record) => sum + recordObligations(record), 0),
    }))
    .sort((left, right) => right.records - left.records);
  const width = 920;
  const height = 300;
  const inset = { top: 24, right: 170, bottom: 34, left: 220 };
  const x = scaleBand()
    .domain(rows.map((row) => row.label))
    .range([inset.top, height - inset.bottom])
    .padding(0.28);
  const maximum = max(rows, (row) => row.records) || 1;
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label="Record ingestion provenance"
    >
      {rows.map((row) => {
        const barWidth =
          ((width - inset.left - inset.right) * row.records) / maximum;
        return (
          <g key={row.method} role="button" tabIndex="0" data-analytics-tooltip={`${row.label}\n${row.records.toLocaleString()} records\n${money(row.obligations)} observed obligations\nClick to filter every view`} onClick={() => onProvenance?.(row.label)} onKeyDown={(event) => activateWithKeyboard(event, () => onProvenance?.(row.label))}>
            <text
              x={inset.left - 10}
              y={(x(row.label) || 0) + x.bandwidth() / 2 + 4}
              textAnchor="end"
            >
              {row.label}
            </text>
            <rect
              x={inset.left}
              y={x(row.label)}
              width={barWidth}
              height={x.bandwidth()}
              fill={row.color}
              data-analytics-tooltip={`${row.label}\n${row.records.toLocaleString()} records\n${money(row.obligations)} observed obligations`}
            />
            <text
              x={inset.left + barWidth + 8}
              y={(x(row.label) || 0) + x.bandwidth() / 2 + 4}
            >
              {row.records} records
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function ChangeBars({ summary }) {
  const rows = [
    {
      id: "added",
      label: "Added",
      value: Number(summary?.added || 0),
      color: "#248642",
    },
    {
      id: "updated",
      label: "Updated",
      value: Number(summary?.updated || 0),
      color: "#7651a8",
    },
    {
      id: "removed",
      label: "No longer in feed",
      value: Number(summary?.removed || 0),
      color: "#b23a2f",
    },
  ];
  const maximum = Math.max(...rows.map((row) => row.value), 1);
  return (
    <svg
      viewBox="0 0 920 260"
      role="img"
      aria-label="Procurement record changes since the prior snapshot"
    >
      {rows.map((row, index) => {
        const y = 38 + index * 66;
        const width = (row.value / maximum) * 590;
        return (
          <g key={row.id}>
            <text x="190" y={y + 23} textAnchor="end">
              {row.label}
            </text>
            <rect x="210" y={y} width={width} height="32" fill={row.color} data-analytics-tooltip={`${row.label}\n${row.value.toLocaleString()} records`} />
            <text x={218 + width} y={y + 23}>
              {row.value.toLocaleString()}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function SubawardConcentration({ records, onSelect }) {
  const rows = records
    .filter((record) => record.subawardSummary?.reportedCount)
    .map((record) => ({
      id: record.opportunityId,
      label: `${record.id} · ${record.party}`,
      amount: Number(record.subawardSummary.sampledAmount || 0),
      count: Number(record.subawardSummary.reportedCount || 0),
      partial: Boolean(record.subawardSummary.detailTruncated),
      record,
    }))
    .sort((left, right) => right.amount - left.amount)
    .slice(0, 12);
  const width = 920;
  const height = 440;
  const inset = { top: 24, right: 150, bottom: 28, left: 300 };
  const maximum = Math.max(...rows.map((row) => row.amount), 1);
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label="Prime award subaward concentration by retained recent-detail amount"
    >
      {rows.map((row, index) => {
        const y = inset.top + index * 32;
        const barWidth =
          ((width - inset.left - inset.right) * row.amount) / maximum;
        return (
          <g key={row.id} role="button" tabIndex="0" data-analytics-tooltip={`${row.label}\n${money(row.amount)} retained-detail sample\n${row.count.toLocaleString()} reported subawards${row.partial ? "\nRecent-detail sample; not a complete total" : ""}\nClick for factual record detail`} onClick={() => onSelect?.(row.record)} onKeyDown={(event) => activateWithKeyboard(event, () => onSelect?.(row.record))}>
            <text x={inset.left - 9} y={y + 18} textAnchor="end">
              {row.label.slice(0, 43)}
            </text>
            <rect
              x={inset.left}
              y={y}
              width={barWidth}
              height="23"
              fill={row.partial ? "#d98775" : "#d34b36"}
              data-analytics-tooltip={`${row.label}\n${money(row.amount)} retained-detail sample\n${row.count.toLocaleString()} reported subawards${row.partial ? "\nRecent-detail sample; not a complete total" : ""}`}
            />
            <text x={inset.left + barWidth + 8} y={y + 17}>
              {money(row.amount)} · {row.count.toLocaleString()}
              {row.partial ? "+" : ""}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function FieldCoverageBars({ records }) {
  const rows = [
    ["External source", (record) => record.sourceUrls?.length],
    [
      "Specific work category",
      (record) =>
        record.workCategory && record.workCategory !== "other-unclassified",
    ],
    ["PSC", (record) => record.pscCode],
    ["NAICS", (record) => record.naicsCode],
    ["Funding office", (record) => record.fundingOffice],
    ["Contracting office", (record) => record.contractingOffice],
    [
      "Reported dollars",
      (record) => recordValue(record) > 0 || recordObligations(record) > 0,
    ],
    [
      "Reported schedule",
      (record) =>
        record.start ||
        record.currentEnd ||
        record.solicitationStart ||
        record.solicitationEnd ||
        record.milestones?.length,
    ],
    [
      "Acquisition structure",
      (record) =>
        record.vehicle ||
        record.awardType ||
        record.pricingType ||
        record.competitionType ||
        record.setAside,
    ],
  ].map(([label, predicate]) => ({
    label,
    value: records.filter(predicate).length,
  }));
  const total = Math.max(records.length, 1);
  return (
    <svg
      viewBox="0 0 920 440"
      role="img"
      aria-label="Field coverage across the assembled procurement record universe"
    >
      {rows.map((row, index) => {
        const y = 25 + index * 44;
        const width = (row.value / total) * 590;
        return (
          <g key={row.label}>
            <text x="230" y={y + 21} textAnchor="end">
              {row.label}
            </text>
            <rect x="250" y={y} width={width} height="28" fill="#147da1" data-analytics-tooltip={`${row.label}\n${row.value.toLocaleString()} of ${records.length.toLocaleString()} records\n${Math.round((row.value / total) * 100)}% coverage`} />
            <text x={258 + width} y={y + 20}>
              {row.value.toLocaleString()} ·{" "}
              {Math.round((row.value / total) * 100)}%
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function MoneyLineageMap({ accountSpine, requestLineCount, captureCoverage }) {
  const coverage = accountSpine?.metadata?.coverage || {};
  const nodes = [
    {
      x: 35,
      y: 55,
      width: 150,
      label: "PDB request lines",
      value: requestLineCount,
    },
    {
      x: 270,
      y: 55,
      width: 150,
      label: "Federal accounts",
      value: coverage.federalAccounts || 0,
    },
    {
      x: 505,
      y: 55,
      width: 170,
      label: "Account-linked awards",
      value: coverage.awardsMappedToCurrentAccounts || 0,
    },
    {
      x: 270,
      y: 250,
      width: 150,
      label: "Plotted awards",
      value: captureCoverage.uniqueAwards || 0,
    },
    {
      x: 505,
      y: 250,
      width: 170,
      label: "Exact FPDS actions",
      value: captureCoverage.fpdsActions || 0,
    },
  ];
  return (
    <svg
      viewBox="0 0 920 410"
      role="img"
      aria-label="Federal money lineage and unresolved public-data joins"
    >
      <defs>
        <marker
          id="flow-arrow"
          viewBox="0 0 10 10"
          refX="8"
          refY="5"
          markerWidth="6"
          markerHeight="6"
          orient="auto-start-reverse"
        >
          <path d="M 0 0 L 10 5 L 0 10 z" fill="context-stroke" />
        </marker>
      </defs>
      <path
        d="M185 100 C220 100 235 100 270 100"
        fill="none"
        stroke="#b86b00"
        strokeWidth="9"
        strokeDasharray="8 6"
        markerEnd="url(#flow-arrow)"
      />
      <text x="228" y="82" textAnchor="middle" fill="#8a5100">
        {coverage.requestMatchedAccounts || 0} derived title matches
      </text>
      <path
        d="M420 100 C455 100 470 100 505 100"
        fill="none"
        stroke="#146ea8"
        strokeWidth="12"
        markerEnd="url(#flow-arrow)"
      />
      <text x="462" y="82" textAnchor="middle" fill="#075786">
        {coverage.exactAwardAccountLinks || 0} exact account links
      </text>
      <path
        d="M420 295 C455 295 470 295 505 295"
        fill="none"
        stroke="#248642"
        strokeWidth="12"
        markerEnd="url(#flow-arrow)"
      />
      <text x="462" y="277" textAnchor="middle" fill="#19622f">
        Exact PIID/action lineage
      </text>
      <path
        d="M590 145 C590 185 410 185 350 250"
        fill="none"
        stroke="#b23a2f"
        strokeWidth="3"
        strokeDasharray="5 7"
      />
      <text x="490" y="199" textAnchor="middle" fill="#8d2a23">
        No universal public crosswalk
      </text>
      {nodes.map((node) => (
        <g key={node.label}>
          <rect
            x={node.x}
            y={node.y}
            width={node.width}
            height="90"
            rx="7"
            fill="#f4f9fc"
            stroke="#7ea8c2"
          />
          <text x={node.x + node.width / 2} y={node.y + 32} textAnchor="middle">
            {node.label}
          </text>
          <text
            x={node.x + node.width / 2}
            y={node.y + 65}
            textAnchor="middle"
            fontSize="24"
            fontWeight="700"
          >
            {Number(node.value || 0).toLocaleString()}
          </text>
        </g>
      ))}
      <g transform="translate(35 365)">
        <line x1="0" x2="34" y1="0" y2="0" stroke="#146ea8" strokeWidth="8" />
        <text x="44" y="5">
          Exact
        </text>
        <line
          x1="120"
          x2="154"
          y1="0"
          y2="0"
          stroke="#b86b00"
          strokeWidth="8"
          strokeDasharray="7 5"
        />
        <text x="164" y="5">
          Derived
        </text>
        <line
          x1="255"
          x2="289"
          y1="0"
          y2="0"
          stroke="#b23a2f"
          strokeWidth="3"
          strokeDasharray="5 6"
        />
        <text x="299" y="5">
          Unresolved join
        </text>
      </g>
    </svg>
  );
}

const VALUE_BANDS = [
  { id: "under-1m", label: "Under $1M", min: 0, max: 1_000_000 },
  { id: "1m-10m", label: "$1M–$10M", min: 1_000_000, max: 10_000_000 },
  { id: "10m-100m", label: "$10M–$100M", min: 10_000_000, max: 100_000_000 },
  { id: "100m-1b", label: "$100M–$1B", min: 100_000_000, max: 1_000_000_000 },
  { id: "1b-10b", label: "$1B–$10B", min: 1_000_000_000, max: 10_000_000_000 },
  { id: "over-10b", label: "$10B+", min: 10_000_000_000, max: Infinity },
];

const DURATION_BANDS = [
  { id: "under-1y", label: "Under 1 year", min: 0, max: 365 },
  { id: "1-2y", label: "1–2 years", min: 365, max: 731 },
  { id: "2-5y", label: "2–5 years", min: 731, max: 1827 },
  { id: "5-10y", label: "5–10 years", min: 1827, max: 3653 },
  { id: "over-10y", label: "10+ years", min: 3653, max: Infinity },
];

function recordDurationDays(record) {
  const start = record.start || record.solicitationStart;
  const end = record.currentEnd || record.solicitationEnd;
  if (!start || !end) return null;
  const duration = (new Date(`${end}T00:00:00Z`) - new Date(`${start}T00:00:00Z`)) / 86_400_000;
  return Number.isFinite(duration) && duration >= 0 ? duration : null;
}

function ValueDistribution({ records, activeBand, onBand }) {
  const rows = VALUE_BANDS.map((band) => {
    const matches = records.filter((record) => {
      const value = recordValue(record);
      return value >= band.min && value < band.max;
    });
    return {
      ...band,
      records: matches.length,
      obligations: matches.reduce((sum, record) => sum + recordObligations(record), 0),
    };
  });
  const width = 920;
  const height = 310;
  const inset = { top: 28, right: 26, bottom: 72, left: 54 };
  const x = scaleBand().domain(rows.map((row) => row.id)).range([inset.left, width - inset.right]).padding(0.18);
  const y = scaleLinear().domain([0, Math.max(...rows.map((row) => row.records), 1)]).range([height - inset.bottom, inset.top]);
  return (
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Reported value distribution by logarithmic dollar band">
      {rows.map((row) => {
        const selected = row.id === activeBand;
        const left = x(row.id) || 0;
        return (
          <g key={row.id} role="button" tabIndex="0" aria-pressed={selected} data-analytics-tooltip={`${row.label}\n${row.records.toLocaleString()} records\n${money(row.obligations)} observed obligations`} onClick={() => onBand(selected ? null : row.id)} onKeyDown={(event) => activateWithKeyboard(event, () => onBand(selected ? null : row.id))}>
            <rect x={left} y={y(row.records)} width={x.bandwidth()} height={height - inset.bottom - y(row.records)} rx="4" fill={selected ? "#f0b323" : "#1678a5"} />
            <text x={left + x.bandwidth() / 2} y={y(row.records) - 7} textAnchor="middle">{row.records}</text>
            <text x={left + x.bandwidth() / 2} y={height - 48} textAnchor="middle">{row.label.replace("–", "-")}</text>
          </g>
        );
      })}
    </svg>
  );
}

function EndpointSeasonality({ records, activeMonth, onMonth }) {
  const labels = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const rows = labels.map((label, month) => ({
    label,
    month,
    current: records.filter((record) => {
      const date = record.currentEnd || record.solicitationEnd;
      return date && new Date(`${date}T00:00:00Z`).getUTCMonth() === month;
    }).length,
    potential: records.filter((record) => record.potentialEnd && new Date(`${record.potentialEnd}T00:00:00Z`).getUTCMonth() === month).length,
  }));
  const width = 920;
  const height = 310;
  const inset = { top: 28, right: 24, bottom: 50, left: 45 };
  const x = scaleBand().domain(rows.map((row) => row.month)).range([inset.left, width - inset.right]).padding(0.17);
  const maximum = Math.max(...rows.map((row) => row.current + row.potential), 1);
  const plotHeight = height - inset.top - inset.bottom;
  return (
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Reported endpoint seasonality by calendar month">
      {rows.map((row) => {
        const currentHeight = (row.current / maximum) * plotHeight;
        const potentialHeight = (row.potential / maximum) * plotHeight;
        const left = x(row.month) || 0;
        const selected = activeMonth === row.month;
        return (
          <g key={row.label} role="button" tabIndex="0" aria-pressed={selected} data-analytics-tooltip={`${row.label}\n${row.current.toLocaleString()} current or solicitation endpoints\n${row.potential.toLocaleString()} conditional potential endpoints`} onClick={() => onMonth(selected ? null : row.month)} onKeyDown={(event) => activateWithKeyboard(event, () => onMonth(selected ? null : row.month))}>
            <rect x={left} y={height - inset.bottom - currentHeight} width={x.bandwidth() / 2} height={currentHeight} fill={selected ? "#f0b323" : "#1678a5"} />
            <rect x={left + x.bandwidth() / 2} y={height - inset.bottom - potentialHeight} width={x.bandwidth() / 2} height={potentialHeight} fill="#8b6aad" />
            <text x={left + x.bandwidth() / 2} y={height - 27} textAnchor="middle">{row.label}</text>
          </g>
        );
      })}
    </svg>
  );
}

function DurationDistribution({ records, activeBand, onBand }) {
  const rows = DURATION_BANDS.map((band) => ({
    ...band,
    records: records.filter((record) => {
      const duration = recordDurationDays(record);
      return duration !== null && duration >= band.min && duration < band.max;
    }).length,
  }));
  const width = 920;
  const height = 300;
  const inset = { top: 26, right: 28, bottom: 54, left: 220 };
  const y = scaleBand().domain(rows.map((row) => row.id)).range([inset.top, height - inset.bottom]).padding(0.22);
  const maximum = Math.max(...rows.map((row) => row.records), 1);
  return (
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Reported current term duration distribution">
      {rows.map((row) => {
        const barWidth = ((width - inset.left - inset.right) * row.records) / maximum;
        const selected = activeBand === row.id;
        return (
          <g key={row.id} role="button" tabIndex="0" aria-pressed={selected} data-analytics-tooltip={`${row.label}\n${row.records.toLocaleString()} records with published start and current end`} onClick={() => onBand(selected ? null : row.id)} onKeyDown={(event) => activateWithKeyboard(event, () => onBand(selected ? null : row.id))}>
            <text x={inset.left - 10} y={(y(row.id) || 0) + y.bandwidth() / 2 + 4} textAnchor="end">{row.label}</text>
            <rect x={inset.left} y={y(row.id)} width={barWidth} height={y.bandwidth()} rx="4" fill={selected ? "#f0b323" : "#1678a5"} />
            <text x={inset.left + barWidth + 8} y={(y(row.id) || 0) + y.bandwidth() / 2 + 4}>{row.records}</text>
          </g>
        );
      })}
    </svg>
  );
}

function FiscalObligationTrend({ records, dimensionId, facet, onFacet }) {
  const dimension = DIMENSIONS.find((item) => item.id === dimensionId) || DIMENSIONS[0];
  const totalsByLabel = new Map();
  for (const record of records) {
    const label = dimension.value(record);
    const value = (record.fiscalValues || []).reduce((sum, row) => sum + Number(row.amount || 0), 0);
    totalsByLabel.set(label, (totalsByLabel.get(label) || 0) + value);
  }
  const labels = [...totalsByLabel.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([label]) => label);
  const years = [...new Set(records.flatMap((record) => (record.fiscalValues || []).map((row) => row.fiscalYear)))].sort((a, b) => a - b);
  const rows = years.map((year) => ({
    year,
    values: labels.map((label) => records.filter((record) => dimension.value(record) === label).reduce((sum, record) => sum + (record.fiscalValues || []).filter((row) => row.fiscalYear === year).reduce((yearSum, row) => yearSum + Number(row.amount || 0), 0), 0)),
  }));
  const width = 1180;
  const height = 360;
  const inset = { top: 30, right: 26, bottom: 50, left: 72 };
  const x = scaleBand().domain(years).range([inset.left, width - inset.right]).padding(0.22);
  const maximum = Math.max(...rows.map((row) => row.values.reduce((sum, value) => sum + Math.max(value, 0), 0)), 1);
  const color = scaleOrdinal(schemeTableau10).domain(labels);
  return (
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Annual net obligations stacked by ${dimension.label}`}>
      {rows.map((row) => {
        let cumulative = 0;
        return (
          <g key={row.year}>
            {row.values.map((value, index) => {
              const positive = Math.max(value, 0);
              const segmentHeight = (positive / maximum) * (height - inset.top - inset.bottom);
              cumulative += segmentHeight;
              const label = labels[index];
              const selected = facet?.dimensionId === dimension.id && facet.value === label;
              return (
                <rect key={label} x={x(row.year)} y={height - inset.bottom - cumulative} width={x.bandwidth()} height={segmentHeight} fill={selected ? "#f0b323" : color(label)} opacity="0.86" role="button" tabIndex="0" aria-pressed={selected} data-analytics-tooltip={`FY${row.year} · ${label}\n${money(value)} net obligations\nTop five ${dimension.label.toLowerCase()} groups shown`} onClick={() => onFacet(selected ? null : { dimensionId: dimension.id, value: label })} onKeyDown={(event) => activateWithKeyboard(event, () => onFacet(selected ? null : { dimensionId: dimension.id, value: label }))} />
              );
            })}
            <text x={(x(row.year) || 0) + x.bandwidth() / 2} y={height - 28} textAnchor="middle">FY{row.year}</text>
          </g>
        );
      })}
    </svg>
  );
}

function VehiclePricingMix({ records, onVehicle }) {
  const groups = ["Firm fixed price", "Cost type", "Time & materials", "Other / not published"];
  const priceGroup = (record) => {
    const value = normalizeText(record.pricingType);
    if (/firm fixed|fixed price|ffp/.test(value)) return groups[0];
    if (/cost plus|cost no fee|cpff|cpaf|cpif/.test(value)) return groups[1];
    if (/time and material|labor hour|t&m/.test(value)) return groups[2];
    return groups[3];
  };
  const vehicles = [...new Set(records.map((record) => record.vehicle || "Not published"))]
    .map((vehicle) => ({ vehicle, records: records.filter((record) => (record.vehicle || "Not published") === vehicle) }))
    .sort((a, b) => b.records.length - a.records.length)
    .slice(0, 10);
  const width = 1040;
  const height = 390;
  const inset = { top: 28, right: 120, bottom: 30, left: 300 };
  const y = scaleBand().domain(vehicles.map((row) => row.vehicle)).range([inset.top, height - inset.bottom]).padding(0.2);
  const maximum = Math.max(...vehicles.map((row) => row.records.length), 1);
  const color = scaleOrdinal().domain(groups).range(["#1678a5", "#d2742d", "#7d4e9f", "#9aabb5"]);
  return (
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Top published contract vehicles by pricing mix">
      {vehicles.map((row) => {
        let offset = 0;
        return (
          <g key={row.vehicle}>
            <text x={inset.left - 10} y={(y(row.vehicle) || 0) + y.bandwidth() / 2 + 4} textAnchor="end">{row.vehicle.slice(0, 44)}</text>
            {groups.map((group) => {
              const count = row.records.filter((record) => priceGroup(record) === group).length;
              const width = ((1040 - inset.left - inset.right) * count) / maximum;
              const left = inset.left + offset;
              offset += width;
              return <rect key={group} x={left} y={y(row.vehicle)} width={width} height={y.bandwidth()} fill={color(group)} role="button" tabIndex="0" data-analytics-tooltip={`${row.vehicle}\n${group}: ${count.toLocaleString()} records\n${row.records.length.toLocaleString()} total vehicle records`} onClick={() => onVehicle(row.vehicle)} onKeyDown={(event) => activateWithKeyboard(event, () => onVehicle(row.vehicle))} />;
            })}
            <text x={inset.left + offset + 8} y={(y(row.vehicle) || 0) + y.bandwidth() / 2 + 4}>{row.records.length}</text>
          </g>
        );
      })}
    </svg>
  );
}

function SourceCoverageMatrix({ records, onSource }) {
  const fields = [
    ["Schedule", (record) => record.start || record.currentEnd || record.solicitationStart || record.solicitationEnd],
    ["Dollars", (record) => recordValue(record) > 0 || recordObligations(record) > 0],
    ["Work taxonomy", (record) => record.workCategory && record.workCategory !== "other-unclassified"],
    ["Acquisition structure", (record) => record.vehicle || record.pricingType || record.competitionType || record.setAside],
    ["FPDS activity", (record) => record.transactionSummary?.actions],
    ["Subawards", (record) => record.subawardSummary?.reportedCount],
  ];
  const sources = [...new Set(records.map((record) => record.sourceSystem || record.ingestionLabel || "Not published"))]
    .map((source) => ({ source, records: records.filter((record) => (record.sourceSystem || record.ingestionLabel || "Not published") === source) }))
    .sort((a, b) => b.records.length - a.records.length)
    .slice(0, 8);
  const cells = sources.flatMap((source) => fields.map(([field, predicate]) => ({ source: source.source, field, count: source.records.filter(predicate).length, total: source.records.length })));
  const width = 1040;
  const height = 390;
  const inset = { top: 78, right: 28, bottom: 30, left: 280 };
  const x = scaleBand().domain(fields.map(([field]) => field)).range([inset.left, width - inset.right]).padding(0.06);
  const y = scaleBand().domain(sources.map((row) => row.source)).range([inset.top, height - inset.bottom]).padding(0.06);
  const color = scaleSequential(interpolateBlues).domain([0, 1]);
  return (
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Source system field coverage matrix">
      {fields.map(([field]) => <text key={field} x={(x(field) || 0) + x.bandwidth() / 2} y="54" textAnchor="middle">{field}</text>)}
      {sources.map((row) => <text key={row.source} x={inset.left - 10} y={(y(row.source) || 0) + y.bandwidth() / 2 + 4} textAnchor="end">{row.source.slice(0, 38)}</text>)}
      {cells.map((cell) => {
        const ratio = cell.total ? cell.count / cell.total : 0;
        return (
          <rect key={`${cell.source}-${cell.field}`} x={x(cell.field)} y={y(cell.source)} width={x.bandwidth()} height={y.bandwidth()} rx="3" fill={ratio ? color(ratio) : "#eef2f5"} role="button" tabIndex="0" data-analytics-tooltip={`${cell.source} · ${cell.field}\n${cell.count.toLocaleString()} of ${cell.total.toLocaleString()} records\n${Math.round(ratio * 100)}% field coverage`} onClick={() => onSource(cell.source)} onKeyDown={(event) => activateWithKeyboard(event, () => onSource(cell.source))} />
        );
      })}
    </svg>
  );
}

function DimensionExplorer({ records, dimensionId, metricId, facet, onFacet }) {
  const dimension = DIMENSIONS.find((item) => item.id === dimensionId) || DIMENSIONS[0];
  const metric = METRICS.find((item) => item.id === metricId) || METRICS[0];
  const rows = useMemo(() => {
    const grouped = new Map();
    for (const record of records) {
      const label = dimension.value(record);
      const current = grouped.get(label) || { label, value: 0, records: 0 };
      current.value += metric.value(record);
      current.records += 1;
      grouped.set(label, current);
    }
    return [...grouped.values()]
      .sort((left, right) => right.value - left.value || right.records - left.records)
      .slice(0, 14);
  }, [dimension, metric, records]);
  const width = 1260;
  const height = 78 + rows.length * 34;
  const inset = { top: 26, right: 150, bottom: 26, left: 330 };
  const plotWidth = width - inset.left - inset.right;
  const maximum = Math.max(...rows.map((row) => row.value), 1);
  return (
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${dimension.label} ranked by ${metric.label}`}>
      {rows.map((row, index) => {
        const y = inset.top + index * 34;
        const barWidth = Math.max((row.value / maximum) * plotWidth, row.value ? 2 : 0);
        const active = facet?.dimensionId === dimension.id && facet.value === row.label;
        return (
          <g
            key={row.label}
            role="button"
            tabIndex="0"
            aria-pressed={active}
            aria-label={`${row.label}, ${metric.format(row.value)}, ${row.records} records`}
            className={active ? "is-selected" : ""}
            data-analytics-tooltip={`${row.label}\n${metric.format(row.value)}\n${row.records.toLocaleString()} records\nClick to filter every view`}
            onClick={() => onFacet(active ? null : { dimensionId: dimension.id, value: row.label })}
            onKeyDown={(event) => activateWithKeyboard(event, () => onFacet(active ? null : { dimensionId: dimension.id, value: row.label }))}
          >
            <text x={inset.left - 12} y={y + 20} textAnchor="end">{row.label.slice(0, 48)}</text>
            <rect x={inset.left} y={y} width={barWidth} height="25" rx="3" fill={active ? "#f0b323" : "#1678a5"} />
            <text x={inset.left + barWidth + 9} y={y + 19}>{metric.format(row.value)}</text>
          </g>
        );
      })}
    </svg>
  );
}

function ScheduleHorizon({ records, onYear }) {
  const rows = useMemo(() => {
    const years = new Map();
    for (let year = 2023; year <= 2034; year += 1) years.set(year, { year, contracts: 0, acquisitions: 0, potential: 0 });
    for (const record of records) {
      const current = dateYear(record.currentEnd || record.solicitationEnd);
      const potential = dateYear(record.potentialEnd);
      if (current && years.has(current)) {
        if (record.mode === "acquisition-window") years.get(current).acquisitions += 1;
        else years.get(current).contracts += 1;
      }
      if (potential && years.has(potential) && potential !== current) years.get(potential).potential += 1;
    }
    return [...years.values()];
  }, [records]);
  const width = 1100;
  const height = 330;
  const inset = { top: 28, right: 20, bottom: 52, left: 48 };
  const x = scaleBand().domain(rows.map((row) => row.year)).range([inset.left, width - inset.right]).padding(0.2);
  const maximum = Math.max(...rows.map((row) => row.contracts + row.acquisitions + row.potential), 1);
  const plotHeight = height - inset.top - inset.bottom;
  return (
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Reported contract, acquisition, and potential end years">
      {rows.map((row) => {
        const total = row.contracts + row.acquisitions + row.potential;
        const barHeight = (total / maximum) * plotHeight;
        const contractHeight = total ? (row.contracts / total) * barHeight : 0;
        const acquisitionHeight = total ? (row.acquisitions / total) * barHeight : 0;
        const potentialHeight = barHeight - contractHeight - acquisitionHeight;
        const left = x(row.year) || 0;
        const bottom = height - inset.bottom;
        return (
          <g key={row.year} role="button" tabIndex="0" aria-label={`Year ${row.year}, ${total} reported endpoints`} data-analytics-tooltip={`${row.year}\n${row.contracts} current contract ends\n${row.acquisitions} acquisition endpoints\n${row.potential} conditional potential ends\nClick to filter every view`} onClick={() => onYear(row.year)} onKeyDown={(event) => activateWithKeyboard(event, () => onYear(row.year))}>
            <rect x={left} y={bottom - contractHeight} width={x.bandwidth()} height={contractHeight} fill="#1678a5" />
            <rect x={left} y={bottom - contractHeight - acquisitionHeight} width={x.bandwidth()} height={acquisitionHeight} fill="#248642" />
            <rect x={left} y={bottom - barHeight} width={x.bandwidth()} height={potentialHeight} fill="#8b6aad" />
            <text x={left + x.bandwidth() / 2} y={height - 28} textAnchor="middle">{row.year}</text>
            {total ? <text x={left + x.bandwidth() / 2} y={bottom - barHeight - 7} textAnchor="middle">{total}</text> : null}
          </g>
        );
      })}
    </svg>
  );
}

function AcquisitionMatrix({ records }) {
  const pricingGroups = ["Firm fixed price", "Cost type", "Time & materials", "Other / not published"];
  const competitionGroups = ["Full and open", "Set-aside / restricted", "Other / not published"];
  function pricing(record) {
    const value = normalizeText(record.pricingType);
    if (/firm fixed|fixed price|ffp/.test(value)) return pricingGroups[0];
    if (/cost plus|cost no fee|cpff|cpaf|cpif/.test(value)) return pricingGroups[1];
    if (/time and material|labor hour|t&m/.test(value)) return pricingGroups[2];
    return pricingGroups[3];
  }
  function competition(record) {
    const value = normalizeText(`${record.setAside || ""} ${record.competitionType || ""} ${record.eligibility || ""}`);
    if (/full and open/.test(value)) return competitionGroups[0];
    if (/set.aside|small business|restricted|holders only|sole source/.test(value)) return competitionGroups[1];
    return competitionGroups[2];
  }
  const cells = pricingGroups.flatMap((price) => competitionGroups.map((compete) => ({
    price,
    compete,
    records: records.filter((record) => pricing(record) === price && competition(record) === compete),
  })));
  const width = 920;
  const height = 330;
  const inset = { top: 70, right: 24, bottom: 30, left: 210 };
  const x = scaleBand().domain(competitionGroups).range([inset.left, width - inset.right]).padding(0.06);
  const y = scaleBand().domain(pricingGroups).range([inset.top, height - inset.bottom]).padding(0.06);
  const color = scaleSequential(interpolateBlues).domain([0, max(cells, (cell) => cell.records.length) || 1]);
  return (
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Published pricing type by competition classification">
      {competitionGroups.map((label) => <text key={label} x={(x(label) || 0) + x.bandwidth() / 2} y="42" textAnchor="middle">{label}</text>)}
      {pricingGroups.map((label) => <text key={label} x={inset.left - 10} y={(y(label) || 0) + y.bandwidth() / 2 + 4} textAnchor="end">{label}</text>)}
      {cells.map((cell) => (
        <g key={`${cell.price}-${cell.compete}`}>
          <rect x={x(cell.compete)} y={y(cell.price)} width={x.bandwidth()} height={y.bandwidth()} rx="4" fill={cell.records.length ? color(cell.records.length) : "#eef2f5"} data-analytics-tooltip={`${cell.price}\n${cell.compete}\n${cell.records.length} records\n${money(cell.records.reduce((sum, record) => sum + recordObligations(record), 0))} observed obligations`} />
          <text x={(x(cell.compete) || 0) + x.bandwidth() / 2} y={(y(cell.price) || 0) + y.bandwidth() / 2 + 5} textAnchor="middle">{cell.records.length}</text>
        </g>
      ))}
    </svg>
  );
}

function RecordExplorer({ records, metricId, onSelect }) {
  const metric = METRICS.find((item) => item.id === metricId) || METRICS[0];
  const rows = [...records].sort((left, right) => metric.value(right) - metric.value(left)).slice(0, 20);
  return (
    <section className="analytics-records" data-analytics-records>
      <header>
        <div><TableProperties size={18} aria-hidden="true" /><span><strong>Record explorer</strong><small>Top 20 filtered records by {metric.label.toLowerCase()}</small></span></div>
        <span>{records.length.toLocaleString()} in scope</span>
      </header>
      <div className="analytics-records__table-wrap">
        <table>
          <thead><tr><th>Record</th><th>Recipient / sponsor</th><th>Type of work</th><th>Reported end</th><th>{metric.label}</th><th><span className="sr-only">Open</span></th></tr></thead>
          <tbody>{rows.map((record) => (
            <tr key={record.opportunityId}>
              <td><strong>{record.id}</strong><span>{record.title}</span></td>
              <td>{record.party || "Not published"}</td>
              <td>{WORK_CATEGORY_BY_ID.get(record.workCategory)?.label || "Other / unclassified"}</td>
              <td>{record.currentEnd || record.solicitationEnd || "Not published"}</td>
              <td>{metric.format(metric.value(record))}</td>
              <td><button type="button" onClick={() => onSelect(record)} aria-label={`Open analytical detail for ${record.id}`}><ChevronRight size={17} aria-hidden="true" /></button></td>
            </tr>
          ))}</tbody>
        </table>
      </div>
    </section>
  );
}

function AnalyticsRecordModal({ record, onClose }) {
  if (!record) return null;
  return (
    <div className="analytics-modal" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section role="dialog" aria-modal="true" aria-labelledby="analytics-record-title" className="analytics-modal__surface">
        <header><div><span>{record.id} · {record.mode === "acquisition-window" ? "Acquisition record" : "Contract record"}</span><h2 id="analytics-record-title">{record.title}</h2></div><button type="button" onClick={onClose} aria-label="Close analytical detail"><X size={19} aria-hidden="true" /></button></header>
        <div className="analytics-modal__facts">
          <article><span>Recipient / sponsor</span><strong>{record.party || "Not published"}</strong></article>
          <article><span>Type of work</span><strong>{WORK_CATEGORY_BY_ID.get(record.workCategory)?.label || "Other / unclassified"}</strong><small>{record.workCategoryBasis || "No classification basis published"}</small></article>
          <article><span>Observed obligations</span><strong>{money(recordObligations(record))}</strong></article>
          <article><span>Reported potential</span><strong>{money(recordValue(record))}</strong></article>
          <article><span>Reported schedule</span><strong>{record.start || record.solicitationStart || "Unknown"} → {record.currentEnd || record.solicitationEnd || "Unknown"}</strong></article>
          <article><span>Acquisition structure</span><strong>{[record.vehicle, record.pricingType, record.awardType].filter(Boolean).join(" · ") || "Not published"}</strong><small>{record.setAside || record.competitionType || "Competition not published"}</small></article>
          <article><span>FPDS actions</span><strong>{Number(record.transactionSummary?.actions || 0).toLocaleString()}</strong></article>
          <article><span>Reported subawards</span><strong>{Number(record.subawardSummary?.reportedCount || 0).toLocaleString()}</strong><small>{record.subawardSummary?.detailTruncated ? "Recent detail is sampled" : "Exact prime count where available"}</small></article>
          <article><span>Ingestion provenance</span><strong>{record.ingestionLabel || record.ingestionMethod || "Not published"}</strong><small>{record.sourceSystem || "Source system not published"}</small></article>
        </div>
        <footer><a href={`#/budget-spend/transactions?capRecord=${encodeURIComponent(record.opportunityId)}`}>Open in Transactions</a>{(record.sourceUrls || []).slice(0, 2).map((url, index) => <a key={url} href={url} target="_blank" rel="noreferrer">Source {index + 1}</a>)}</footer>
      </section>
    </div>
  );
}

export default function TransactionAnalytics({
  dataset,
  awards = [],
  samOpportunities = { records: [] },
  manualProcurement = { records: [] },
  procurementDelta = { records: [], summary: {} },
  subawardSnapshot = { metadata: {}, primes: [] },
  accountSpine = null,
  requestLineCount = 0,
}) {
  const records = useMemo(
    () =>
      applyProcurementChanges(
        assembleProcurementRecords(
          dataset.records || [],
          awards,
          dataset.metadata.asOf,
          samOpportunities.records || [],
          manualProcurement.records || [],
          subawardSnapshot,
        ),
        procurementDelta.records || [],
      ),
    [
      awards,
      dataset.metadata.asOf,
      dataset.records,
      manualProcurement.records,
      procurementDelta.records,
      samOpportunities.records,
      subawardSnapshot,
    ],
  );
  const [activeView, setActiveView] = useState("overview");
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState("all");
  const [dimensionId, setDimensionId] = useState("work");
  const [metricId, setMetricId] = useState("obligations");
  const [facet, setFacet] = useState(null);
  const [endYear, setEndYear] = useState(null);
  const [endMonth, setEndMonth] = useState(null);
  const [valueBand, setValueBand] = useState(null);
  const [durationBand, setDurationBand] = useState(null);
  const [selectedRecord, setSelectedRecord] = useState(null);
  const [treemapMetric, setTreemapMetric] = useState("obligations");
  const [filterValues, setFilterValues] = useState({
    work: "all",
    buyer: "all",
    recipient: "all",
    provenance: "all",
    pricing: "all",
    competition: "all",
    vehicle: "all",
    source: "all",
  });
  const [visibleCharts, setVisibleCharts] = useState(DEFAULT_VISIBLE_CHARTS);
  useEffect(() => {
    if (!selectedRecord) return undefined;
    const onKeyDown = (event) => {
      if (event.key === "Escape") setSelectedRecord(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selectedRecord]);
  const filterDefinitions = useMemo(() => [
    { id: "work", title: "Type of work", allLabel: "All work categories", value: (record) => record.workCategory || "other-unclassified", label: (value) => WORK_CATEGORY_BY_ID.get(value)?.label || "Other / unclassified" },
    { id: "buyer", title: "Funding office", allLabel: "All funding offices", value: (record) => record.fundingOffice || record.owner || "Not published" },
    { id: "recipient", title: "Recipient / sponsor", allLabel: "All recipients", value: (record) => record.party || "Not published" },
    { id: "provenance", title: "Ingestion provenance", allLabel: "All ingestion methods", value: (record) => record.ingestionMethod || "source-file", label: (value) => INGESTION_METHOD_BY_ID.get(value)?.label || value },
    { id: "pricing", title: "Pricing type", allLabel: "All pricing types", value: (record) => record.pricingType || "Not published" },
    { id: "competition", title: "Competition / set-aside", allLabel: "All competition classes", value: (record) => record.setAside || record.competitionType || "Not published" },
    { id: "vehicle", title: "Contract vehicle", allLabel: "All vehicles", value: (record) => record.vehicle || "Not published" },
    { id: "source", title: "Source system", allLabel: "All source systems", value: (record) => record.sourceSystem || record.ingestionLabel || "Not published" },
  ].map((definition) => {
    const counts = new Map();
    for (const record of records) {
      const value = definition.value(record);
      counts.set(value, (counts.get(value) || 0) + 1);
    }
    return {
      ...definition,
      options: [...counts.entries()]
        .map(([value, count]) => ({ value, label: definition.label?.(value) || value, count }))
        .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label)),
    };
  }), [records]);
  const scopedRecords = useMemo(() => records.filter((record) => {
    if (!recordMatchesQuery(record, query)) return false;
    if (mode !== "all" && record.mode !== mode) return false;
    if (endYear && dateYear(record.currentEnd || record.solicitationEnd) !== endYear && dateYear(record.potentialEnd) !== endYear) return false;
    if (endMonth !== null) {
      const dates = [record.currentEnd || record.solicitationEnd, record.potentialEnd].filter(Boolean);
      if (!dates.some((date) => new Date(`${date}T00:00:00Z`).getUTCMonth() === endMonth)) return false;
    }
    if (valueBand) {
      const band = VALUE_BANDS.find((item) => item.id === valueBand);
      const value = recordValue(record);
      if (band && !(value >= band.min && value < band.max)) return false;
    }
    if (durationBand) {
      const band = DURATION_BANDS.find((item) => item.id === durationBand);
      const duration = recordDurationDays(record);
      if (band && !(duration !== null && duration >= band.min && duration < band.max)) return false;
    }
    if (facet) {
      const dimension = DIMENSIONS.find((item) => item.id === facet.dimensionId);
      if (dimension && dimension.value(record) !== facet.value) return false;
    }
    for (const definition of filterDefinitions) {
      const selected = parseMultiValues(filterValues[definition.id]);
      if (selected.length && !selected.includes(definition.value(record))) return false;
    }
    return true;
  }), [durationBand, endMonth, endYear, facet, filterDefinitions, filterValues, mode, query, records, valueBand]);
  const metric = METRICS.find((item) => item.id === metricId) || METRICS[0];
  const totals = useMemo(
    () => ({
      obligations: scopedRecords.reduce(
        (sum, record) => sum + recordObligations(record),
        0,
      ),
      potential: scopedRecords.reduce((sum, record) => sum + recordValue(record), 0),
      actions: scopedRecords.reduce(
        (sum, record) => sum + Number(record.transactionSummary?.actions || 0),
        0,
      ),
      subawards: scopedRecords.reduce((sum, record) => sum + Number(record.subawardSummary?.reportedCount || 0), 0),
    }),
    [scopedRecords],
  );
  const contractRecords = records.filter(
    (record) => record.mode === "contract-performance",
  );
  const acquisitionRecords = records.filter(
    (record) => record.mode === "acquisition-window",
  );
  const contractRefs = new Set(
    contractRecords
      .map((record) => String(record.reference || "").toUpperCase())
      .filter(Boolean),
  );
  const exactFollowOns = acquisitionRecords.filter(
    (record) =>
      record.parentReference &&
      contractRefs.has(String(record.parentReference).toUpperCase()),
  ).length;
  const samRecords = acquisitionRecords.filter((record) =>
    record.sourceUrls.some((url) => /sam\.gov/i.test(url)),
  ).length;
  const activeFilters = Number(Boolean(query)) + Number(mode !== "all") + Number(Boolean(facet)) + Number(Boolean(endYear)) + Number(endMonth !== null) + Number(Boolean(valueBand)) + Number(Boolean(durationBand)) + filterDefinitions.filter((definition) => parseMultiValues(filterValues[definition.id]).length).length;
  const dimensionLabel = DIMENSIONS.find((item) => item.id === dimensionId)?.label || "Dimension";
  const clearFilters = () => {
    setQuery("");
    setMode("all");
    setFacet(null);
    setEndYear(null);
    setEndMonth(null);
    setValueBand(null);
    setDurationBand(null);
    setFilterValues({ work: "all", buyer: "all", recipient: "all", provenance: "all", pricing: "all", competition: "all", vehicle: "all", source: "all" });
  };
  const chartOptions = VIEW_CHARTS[activeView];
  const activeChartIds = visibleCharts[activeView] || DEFAULT_VISIBLE_CHARTS[activeView];
  const chartVisible = (id) => activeChartIds.includes(id);
  return (
    <div className="transaction-analytics-page" data-transaction-d3-page>
      <section className="transaction-analytics-hero">
        <div>
          <span>Factual analytical workbench</span>
          <h2>Contract & Transaction Analytics</h2>
          <p>
            Cross-filter schedules, reported values, recipients, offices,
            acquisition structure, provenance, FPDS actions, and exact
            prime-to-subaward counts. Every visual uses published or explicitly
            derived measures.
          </p>
        </div>
        <dl>
          <div>
            <dt>Records in scope</dt>
            <dd>{scopedRecords.length.toLocaleString()}</dd>
          </div>
          <div>
            <dt>Observed obligations</dt>
            <dd>{money(totals.obligations)}</dd>
          </div>
          <div>
            <dt>Reported potential</dt>
            <dd>{money(totals.potential)}</dd>
          </div>
          <div>
            <dt>FPDS actions</dt>
            <dd>{totals.actions.toLocaleString()}</dd>
          </div>
          <div>
            <dt>Reported subawards</dt>
            <dd>{totals.subawards.toLocaleString()}</dd>
          </div>
          <div>
            <dt>Active filters</dt>
            <dd>{activeFilters}</dd>
          </div>
        </dl>
      </section>
      <section className="analytics-commandbar" aria-label="Analytics controls">
        <nav aria-label="Analytics view">
          {ANALYTICS_VIEWS.map(({ id, label, icon: Icon }) => <button type="button" key={id} className={activeView === id ? "is-active" : ""} aria-pressed={activeView === id} onClick={() => setActiveView(id)}><Icon size={15} aria-hidden="true" />{label}</button>)}
        </nav>
        <div className="analytics-commandbar__controls">
          <label className="analytics-search"><Search size={15} aria-hidden="true" /><span className="sr-only">Search analytical records</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search title, award, office, recipient…" /></label>
          <div className="analytics-commandbar__secondary">
            <label><span>Record type</span><select value={mode} onChange={(event) => setMode(event.target.value)}><option value="all">All records</option><option value="contract-performance">Contracts</option><option value="acquisition-window">Acquisition activity</option></select></label>
            <label><span>Dimension</span><select value={dimensionId} onChange={(event) => { setDimensionId(event.target.value); setFacet(null); }}>{DIMENSIONS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
            <label><span>Measure</span><select value={metricId} onChange={(event) => setMetricId(event.target.value)}>{METRICS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
            <button type="button" className="analytics-export" onClick={() => exportAnalyticsSlice(scopedRecords, metric, { snapshot: dataset.metadata.asOf, view: activeView, dimension: dimensionLabel })}><Download size={14} aria-hidden="true" />Export {scopedRecords.length.toLocaleString()}</button>
            {activeFilters ? <button type="button" className="analytics-reset" onClick={clearFilters}><X size={14} aria-hidden="true" />Clear {activeFilters}</button> : null}
          </div>
        </div>
        <details className="analytics-manager" data-analytics-manager>
          <summary><Filter size={14} aria-hidden="true" /><strong>Filter data & manage charts</strong><span>{activeFilters ? `${activeFilters} active filters` : "All records"} · {activeChartIds.length} of {chartOptions.length} charts</span></summary>
          <div className="analytics-manager__grid">
            {filterDefinitions.map((definition) => (
              <SearchMultiSelect
                key={definition.id}
                className="analytics-multiselect"
                title={definition.title}
                allLabel={definition.allLabel}
                value={filterValues[definition.id]}
                options={definition.options}
                onChange={(values) => setFilterValues((current) => ({ ...current, [definition.id]: serializeMultiValues(values) }))}
              />
            ))}
            <SearchMultiSelect
              className="analytics-multiselect analytics-chart-manager"
              title="Visible charts"
              allLabel="All charts visible"
              value={serializeMultiValues(activeChartIds)}
              options={chartOptions}
              onChange={(values) => setVisibleCharts((current) => ({ ...current, [activeView]: values.length ? values : DEFAULT_VISIBLE_CHARTS[activeView] }))}
            />
          </div>
        </details>
        {activeFilters ? <div className="analytics-active-filters" aria-label="Active analytical filters">
          {facet ? <button type="button" onClick={() => setFacet(null)}><Filter size={13} aria-hidden="true" />{DIMENSIONS.find((item) => item.id === facet.dimensionId)?.label}: {facet.value}<X size={13} aria-hidden="true" /></button> : null}
          {endYear ? <button type="button" onClick={() => setEndYear(null)}><CalendarClock size={13} aria-hidden="true" />Reported endpoint: {endYear}<X size={13} aria-hidden="true" /></button> : null}
          {endMonth !== null ? <button type="button" onClick={() => setEndMonth(null)}><CalendarClock size={13} aria-hidden="true" />Endpoint month: {new Date(2026, endMonth, 1).toLocaleString(undefined, { month: "short" })}<X size={13} aria-hidden="true" /></button> : null}
          {valueBand ? <button type="button" onClick={() => setValueBand(null)}><CircleDollarSign size={13} aria-hidden="true" />{VALUE_BANDS.find((item) => item.id === valueBand)?.label}<X size={13} aria-hidden="true" /></button> : null}
          {durationBand ? <button type="button" onClick={() => setDurationBand(null)}><CalendarClock size={13} aria-hidden="true" />{DURATION_BANDS.find((item) => item.id === durationBand)?.label}<X size={13} aria-hidden="true" /></button> : null}
          {filterDefinitions.map((definition) => {
            const selected = parseMultiValues(filterValues[definition.id]);
            return selected.length ? <button key={definition.id} type="button" onClick={() => setFilterValues((current) => ({ ...current, [definition.id]: "all" }))}><Filter size={13} aria-hidden="true" />{definition.title}: {selected.length}<X size={13} aria-hidden="true" /></button> : null;
          })}
        </div> : null}
      </section>

      {activeView === "overview" ? <div className="transaction-viz-grid">
        {chartVisible("dimension-explorer") ? <div className="transaction-viz--wide"><ChartFrame icon={SlidersHorizontal} title={`${dimensionLabel} composition`} note={`Click or focus a bar to filter every view; ranked by ${metric.label.toLowerCase()}`} testId="dimension-explorer"><DimensionExplorer records={scopedRecords} dimensionId={dimensionId} metricId={metricId} facet={facet} onFacet={setFacet} /></ChartFrame></div> : null}
        {chartVisible("quarterly") ? <ChartFrame icon={CalendarClock} title="Quarterly schedule activity" note="Reported term ends and published acquisition events" testId="quarterly"><EventTimeline records={scopedRecords} /></ChartFrame> : null}
        {chartVisible("scatter") ? <ChartFrame icon={BarChart3} title="Obligation and value distribution" note="Square-root scales preserve lower-value visibility; select a bubble for factual detail" testId="scatter"><ValueScatter records={scopedRecords} onSelect={setSelectedRecord} /></ChartFrame> : null}
        {chartVisible("value-distribution") ? <ChartFrame icon={CircleDollarSign} title="Reported value distribution" note="Logarithmic bands preserve the small and large award populations; click to filter" testId="value-distribution"><ValueDistribution records={scopedRecords} activeBand={valueBand} onBand={setValueBand} /></ChartFrame> : null}
        {chartVisible("treemap") ? <ChartFrame icon={Network} title="Portfolio and recipient composition" note="Area encodes the selected factual measure; click a recipient to filter every view" testId="treemap"><div className="transaction-viz__segmented" aria-label="Treemap measure">{[["obligations", "Obligations"], ["potential", "Potential"], ["records", "Records"]].map(([id, text]) => <button type="button" className={treemapMetric === id ? "is-active" : ""} key={id} onClick={() => setTreemapMetric(id)}>{text}</button>)}</div><PortfolioTreemap records={scopedRecords} metric={treemapMetric} onRecipient={(value) => setFacet({ dimensionId: "recipient", value })} /></ChartFrame> : null}
        {chartVisible("work-categories") ? <ChartFrame icon={Network} title="Type of work composition" note="PSC/NAICS first, published descriptions second, unknowns explicit; click to filter" testId="work-categories"><WorkCategoryTreemap records={scopedRecords} onCategory={(value) => setFacet({ dimensionId: "work", value })} /></ChartFrame> : null}
      </div> : null}

      {activeView === "schedule" ? <div className="transaction-viz-grid">
        {chartVisible("schedule-horizon") ? <div className="transaction-viz--wide"><ChartFrame icon={CalendarClock} title="Reported schedule horizon" note="Click a year to filter records by current, solicitation, or conditional potential endpoint" testId="schedule-horizon"><ScheduleHorizon records={scopedRecords} onYear={(year) => setEndYear(endYear === year ? null : year)} /></ChartFrame></div> : null}
        {chartVisible("endpoint-seasonality") ? <ChartFrame icon={CalendarClock} title="Endpoint seasonality" note="Current, solicitation, and conditional endpoints by calendar month; click to filter" testId="endpoint-seasonality"><EndpointSeasonality records={scopedRecords} activeMonth={endMonth} onMonth={setEndMonth} /></ChartFrame> : null}
        {chartVisible("duration-distribution") ? <ChartFrame icon={BarChart3} title="Reported term duration" note="Published start-to-current-end duration; undated terms remain outside the distribution" testId="duration-distribution"><DurationDistribution records={scopedRecords} activeBand={durationBand} onBand={setDurationBand} /></ChartFrame> : null}
        {chartVisible("quarterly") ? <ChartFrame icon={CalendarClock} title="Quarterly schedule activity" note="Reported term ends and published acquisition events" testId="quarterly"><EventTimeline records={scopedRecords} /></ChartFrame> : null}
        {chartVisible("scatter") ? <ChartFrame icon={BarChart3} title="Obligation and value distribution" note="Position encodes published dollars; select a bubble for factual detail" testId="scatter"><ValueScatter records={scopedRecords} onSelect={setSelectedRecord} /></ChartFrame> : null}
      </div> : null}

      {activeView === "spend" ? <div className="transaction-viz-grid">
        {chartVisible("dimension-explorer") ? <div className="transaction-viz--wide"><ChartFrame icon={SlidersHorizontal} title={`${dimensionLabel} by ${metric.label.toLowerCase()}`} note="The shared dimension and measure controls drive this ranking and the record explorer" testId="dimension-explorer"><DimensionExplorer records={scopedRecords} dimensionId={dimensionId} metricId={metricId} facet={facet} onFacet={setFacet} /></ChartFrame></div> : null}
        {chartVisible("fiscal-trend") ? <div className="transaction-viz--wide"><ChartFrame icon={CircleDollarSign} title={`Fiscal obligation trend by ${dimensionLabel.toLowerCase()}`} note="Top five groups in the selected dimension; click a segment to filter every view" testId="fiscal-trend"><FiscalObligationTrend records={scopedRecords} dimensionId={dimensionId} facet={facet} onFacet={setFacet} /></ChartFrame></div> : null}
        {chartVisible("buyer-year") ? <ChartFrame icon={Grid3X3} title="Funding office by fiscal year" note="Color encodes annual net obligations; click a cell to filter by funding office" testId="buyer-year"><BuyerYearHeatmap records={scopedRecords} onBuyer={(value) => setFacet({ dimensionId: "buyer", value })} /></ChartFrame> : null}
        {chartVisible("acquisition-matrix") ? <ChartFrame icon={Layers3} title="Pricing by competition structure" note="Record counts cross published pricing and competition/set-aside classifications" testId="acquisition-matrix"><AcquisitionMatrix records={scopedRecords} /></ChartFrame> : null}
        {chartVisible("vehicle-pricing") ? <ChartFrame icon={Layers3} title="Vehicle and pricing mix" note="Top published contract vehicles split by fixed-price, cost-type, T&M, and unpublished pricing" testId="vehicle-pricing"><VehiclePricingMix records={scopedRecords} onVehicle={(vehicle) => setFacet({ dimensionId: "vehicle", value: vehicle })} /></ChartFrame> : null}
        {chartVisible("subawards") ? <ChartFrame icon={BarChart3} title="Prime-to-subaward concentration" note="Exact prime joins; retained-detail dollars remain a labeled recent sample" testId="subawards"><SubawardConcentration records={scopedRecords} onSelect={setSelectedRecord} /></ChartFrame> : null}
      </div> : null}

      {activeView === "coverage" ? <div className="transaction-viz-grid">
        {chartVisible("field-coverage") ? <ChartFrame icon={BarChart3} title="Field coverage" note="Coverage across the current filtered public record universe" testId="field-coverage"><FieldCoverageBars records={scopedRecords} /></ChartFrame> : null}
        {chartVisible("source-coverage") ? <ChartFrame icon={Grid3X3} title="Source-system coverage" note="Published field completeness by source system; click a cell to filter the active universe" testId="source-coverage"><SourceCoverageMatrix records={scopedRecords} onSource={(source) => setFacet({ dimensionId: "source", value: source })} /></ChartFrame> : null}
        {chartVisible("provenance") ? <ChartFrame icon={BarChart3} title="Ingestion provenance" note="Automatic public feeds, normalized source files, and curated imports remain distinct; click to filter" testId="provenance"><ProvenanceBars records={scopedRecords} onProvenance={(value) => setFacet({ dimensionId: "provenance", value })} /></ChartFrame> : null}
        {chartVisible("money-lineage") ? <ChartFrame icon={Network} title="Money lineage and public join gaps" note="Counts encode records and links, not additive dollars; relationship class is explicit" testId="money-lineage"><MoneyLineageMap accountSpine={accountSpine} requestLineCount={requestLineCount} captureCoverage={dataset.metadata.coverage} /></ChartFrame> : null}
        {chartVisible("changes") ? <ChartFrame icon={CalendarClock} title="Changed since prior snapshot" note="Stable identifiers distinguish added, updated, and no-longer-returned records" testId="changes"><ChangeBars summary={procurementDelta.summary} /></ChartFrame> : null}
      </div> : null}

      <RecordExplorer records={scopedRecords} metricId={metricId} onSelect={setSelectedRecord} />
      <section className="transaction-analytics-note">
        <strong>Coverage boundary</strong>
        <p>
          These views currently show {scopedRecords.length.toLocaleString()} of {records.length.toLocaleString()} public records:{" "}
          {dataset.metadata.coverage.publicRows} normalized capture rows plus{" "}
          {records
            .filter((record) => record.ingestionMethod === "automated")
            .length.toLocaleString()}{" "}
          non-duplicate awards from the automated USAspending feed. They are not
          the complete federal contract universe, do not establish recompete
          dates, and do not determine bidder eligibility. {samRecords}{" "}
          acquisition records cite SAM.gov; {exactFollowOns} records have an
          exact source-declared predecessor PIID matching a contract row.
          Subawards use exact USAspending generated prime-award IDs and remain
          separate from prime-award and FPDS totals. The
          PDB-to-account relationship remains derived; no universal public
          crosswalk connects every request line, award, and action.
        </p>
      </section>
      <AnalyticsRecordModal record={selectedRecord} onClose={() => setSelectedRecord(null)} />
    </div>
  );
}
