import "./AccountabilityFindings.css";

const FINDING_TYPE_ORDER = ["cost-estimate", "program-risk", "schedule-event"];
const FINDING_TYPE_LABELS = {
  "cost-estimate": "Cost estimate",
  "program-risk": "Program risk",
  "schedule-event": "Schedule event",
};

function number(value) {
  return Number(value || 0).toLocaleString();
}

function money(value) {
  const amount = Number(value || 0);
  if (Math.abs(amount) >= 1e12) return `$${(amount / 1e12).toFixed(1)}T`;
  if (Math.abs(amount) >= 1e9) return `$${(amount / 1e9).toFixed(1)}B`;
  if (Math.abs(amount) >= 1e6) return `$${(amount / 1e6).toFixed(1)}M`;
  return `$${Math.round(amount).toLocaleString()}`;
}

function typeLabel(type) {
  return FINDING_TYPE_LABELS[type] || String(type || "Other finding").replaceAll("-", " ");
}

export default function AccountabilityFindings({ findings = [], programHealthProfiles = [], selectedId = "", onSelect }) {
  const profileLabels = new Map(programHealthProfiles.map((row) => [row.programId, row.label]));
  const retainedTypes = new Set(findings.map((row) => row.findingType).filter(Boolean));
  const types = [
    ...FINDING_TYPE_ORDER.filter((type) => retainedTypes.has(type)),
    ...[...retainedTypes].filter((type) => !FINDING_TYPE_ORDER.includes(type)).sort(),
  ];
  const programs = [...new Set(findings.map((row) => row.targetProgramId))].map((id) => ({ id, label: profileLabels.get(id) || id }));
  const sourceCount = new Set(findings.map((row) => row.sourceId).filter(Boolean)).size;
  const active = findings.find((row) => row.id === selectedId) || findings[0] || null;
  const activeProgram = active ? profileLabels.get(active.targetProgramId) || active.targetProgramId : "";

  return <article className="intelligence-products__panel" data-accountability-findings-visualization>
    <header><div><span>Official findings</span><h3>Accountability evidence map</h3><p>Compare exact retained findings by linked program and evidence type. Cell presence is evidence coverage, not a severity rating.</p></div><b>{number(findings.length)} findings</b></header>
    <div className="accountability-findings">
      <div className="intelligence-products__dossier-stats accountability-findings__summary" aria-label="Accountability finding coverage">
        <div data-accountability-finding-count={findings.length}><strong>{number(findings.length)}</strong><span>cited findings</span></div>
        <div data-accountability-program-count={programs.length}><strong>{number(programs.length)}</strong><span>linked programs</span></div>
        <div data-accountability-type-count={types.length}><strong>{number(types.length)}</strong><span>evidence types</span></div>
        <div data-accountability-source-count={sourceCount}><strong>{number(sourceCount)}</strong><span>official report</span></div>
      </div>

      <section className="accountability-findings__composition" aria-label={`Finding composition: ${types.map((type) => `${findings.filter((row) => row.findingType === type).length} ${typeLabel(type)}`).join(", ")}`}>
        {types.map((type) => {
          const count = findings.filter((row) => row.findingType === type).length;
          return <div key={type} data-accountability-finding-type={type} data-count={count} style={{ "--finding-count": count }}><span>{typeLabel(type)}</span><strong>{count}</strong></div>;
        })}
      </section>

      <div className="accountability-findings__matrix" role="region" aria-label="Retained finding matrix" tabIndex="0">
        <table>
          <caption className="sr-only">Retained accountability findings by linked program and evidence type</caption>
          <thead><tr><th scope="col">Linked program</th>{types.map((type) => <th key={type} scope="col">{typeLabel(type)}</th>)}</tr></thead>
          <tbody>{programs.map((program) => <tr key={program.id} data-accountability-finding-program={program.id}>
            <th scope="row">{program.label}</th>
            {types.map((type) => {
              const cellFindings = findings.filter((row) => row.targetProgramId === program.id && row.findingType === type);
              return <td key={type}>{cellFindings.length ? cellFindings.map((row) => <button key={row.id} type="button" className={active?.id === row.id ? "is-active" : ""} aria-pressed={active?.id === row.id} data-accountability-finding={row.id} onClick={() => onSelect?.(row.id)}><strong>{row.label}</strong><span>{Number(row.amountDollars || 0) > 0 ? money(row.amountDollars) : "Cited narrative"}</span></button>) : <span className="accountability-findings__empty" data-accountability-finding-empty>Not retained</span>}</td>;
            })}
          </tr>)}</tbody>
        </table>
      </div>

      {active ? <article className="intelligence-products__boundary accountability-findings__detail" data-active-accountability-finding={active.id} aria-live="polite"><div>
        <header><span>{typeLabel(active.findingType)} · {activeProgram}</span><b>{Number(active.amountDollars || 0) > 0 ? money(active.amountDollars) : "No retained dollar amount"}</b></header>
        <strong>{active.label}</strong><p>{active.finding}</p>
        <footer><span>Observed <time dateTime={active.observedAt}>{active.observedAt}</time> · {String(active.reviewState || "").replaceAll("_", " ")}</span><a href={active.sourceUrl} target="_blank" rel="noreferrer">Open official report</a></footer>
      </div>
      </article> : null}

      <p className="accountability-findings__boundary">Empty cells mean no finding of that type is retained for the linked program in this bounded corpus. They do not imply a clean record.</p>
    </div>
  </article>;
}
