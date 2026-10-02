import { useEffect, useMemo, useState } from "react";
import { BellPlus, BrainCircuit, CheckCircle2, ExternalLink, LocateFixed, Radar, Search, Sparkles } from "lucide-react";
import { ControlAsyncState } from "control-surface-ui/react";
import ControlSelect from "./ControlSelect.jsx";
import OperationalDataTable from "./OperationalDataTable.jsx";
import { useAuth } from "./AuthContext.jsx";
import { parseSamOpportunityReference } from "./acquisition-runtime-core.js";
import { OPPORTUNITY_CLUSTERS, SABRE_FIT_PROFILE, classifyOpportunityFit, opportunityClusterLabel } from "./opportunity-fit.js";
import { samNoticeTypeLabel } from "./sam-notice-types.js";
import "./OpportunityRadar.css";

function recordId(record) { return record.sourceRecordId || record.noticeId || record.opportunityId || record.id || record.reference || ""; }
function date(value) { if (!value) return "Not published"; const parsed = new Date(`${String(value).slice(0, 10)}T00:00:00Z`); return Number.isNaN(parsed.getTime()) ? "Not published" : parsed.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }); }

function FitBadge({ assessment }) {
  return <span className={`opportunity-fit-badge opportunity-fit-badge--${assessment.level}`}><b>{assessment.score}</b><span>{assessment.level === "strong" ? "Strong fit" : assessment.level === "potential" ? "Potential fit" : assessment.level === "adjacent" ? "Adjacent" : "Low signal"}</span></span>;
}

export default function OpportunityRadar({ rows, runtimeAvailable, onRuntimeRecordsChanged }) {
  const auth = useAuth();
  const [reference, setReference] = useState("");
  const [intakeState, setIntakeState] = useState({ status: "idle", message: "", recordId: "" });
  const [cluster, setCluster] = useState("all");
  const [minimumFit, setMinimumFit] = useState("45");
  const [noticeType, setNoticeType] = useState("all");
  const [query, setQuery] = useState("");
  const [trackedViews, setTrackedViews] = useState([]);
  const [trackingId, setTrackingId] = useState("");
  const canWrite = Boolean(auth?.user?.canWriteWorkspace);

  useEffect(() => {
    if (!runtimeAvailable) return undefined;
    let active = true;
    auth.listAcquisitionSavedViews().then((payload) => { if (active) setTrackedViews(payload.views || []); }).catch(() => {});
    return () => { active = false; };
  }, [auth, runtimeAvailable]);

  const assessedRows = useMemo(() => rows.map((record) => ({ ...record, fitAssessment: classifyOpportunityFit(record) })), [rows]);
  const clusterCounts = useMemo(() => Object.fromEntries(OPPORTUNITY_CLUSTERS.map((item) => [item.id, assessedRows.filter((record) => record.fitAssessment.score >= 25 && record.fitAssessment.clusterIds.includes(item.id)).length])), [assessedRows]);
  const radarRows = useMemo(() => assessedRows.filter((record) => record.fitAssessment.score >= Number(minimumFit)
    && (cluster === "all" || record.fitAssessment.clusterIds.includes(cluster))
    && (noticeType === "all" || String(record.noticeType || "").toLowerCase().includes(noticeType))), [assessedRows, cluster, minimumFit, noticeType]);
  const trackedIds = useMemo(() => new Set(trackedViews.map((view) => String(view.query || "").toLowerCase()).filter(Boolean)), [trackedViews]);

  async function importReference(event) {
    event.preventDefault();
    const noticeId = parseSamOpportunityReference(reference);
    if (!noticeId) { setIntakeState({ status: "error", message: "Paste a SAM.gov opportunity link or notice ID.", recordId: "" }); return; }
    const existing = assessedRows.find((record) => [record.sourceRecordId, record.noticeId].some((value) => String(value || "").toLowerCase() === noticeId.toLowerCase()));
    if (existing) {
      setQuery(noticeId); setCluster("all"); setMinimumFit("0");
      setIntakeState({ status: "found", message: "Already in the retained corpus. The matching record is pinned below.", recordId: recordId(existing) });
      return;
    }
    if (!runtimeAvailable || !canWrite) { setIntakeState({ status: "error", message: runtimeAvailable ? "Workspace write access is required to import this notice." : "Sign in to import and monitor a missing SAM.gov notice.", recordId: "" }); return; }
    setIntakeState({ status: "loading", message: "Checking the corpus, SAM.gov, and OpenAI’s cited web retrieval…", recordId: "" });
    try {
      const result = await auth.intakeAcquisitionOpportunity(reference);
      await onRuntimeRecordsChanged?.();
      setQuery(result.intake.noticeId); setCluster("all"); setMinimumFit("0");
      const usedOpenAiRetrieval = result.intake.source === "openai_web_search";
      setIntakeState({ status: "imported", message: usedOpenAiRetrieval
        ? result.intake.ai?.status === "completed" ? "Imported through OpenAI’s cited SAM.gov retrieval and analyzed. Review the pinned record below." : "Imported through OpenAI’s cited SAM.gov retrieval. The retrieved fields remain marked for review."
        : result.intake.ai?.status === "completed" ? "Imported from SAM.gov and analyzed. Review the pinned record below." : "Imported from SAM.gov. Explainable code and keyword classification is available; AI analysis was unavailable.", recordId: recordId(result.record) });
    } catch (error) {
      setIntakeState({ status: "error", message: error.message || "The notice could not be imported.", recordId: "" });
    }
  }

  async function track(record) {
    const id = recordId(record);
    if (!id || trackedIds.has(id.toLowerCase()) || !runtimeAvailable || !canWrite) return;
    setTrackingId(id);
    try {
      const result = await auth.createAcquisitionSavedView({ name: `Track: ${record.title || id}`.slice(0, 100), query: id, filters: {}, alertMode: "immediate" });
      setTrackedViews((current) => [result.view, ...current]);
    } catch (error) {
      setIntakeState({ status: "error", message: error.message || "This opportunity could not be added to tracking.", recordId: id });
    } finally { setTrackingId(""); }
  }

  const columns = [
    { key: "record", label: "Opportunity", required: true, sticky: true, minWidth: 330, searchValue: (record) => [recordId(record), record.solicitationNumber, record.title, record.description, record.office].filter(Boolean).join(" "), render: (record) => <><strong>{record.title || "Untitled opportunity"}</strong><small>{[record.solicitationNumber || record.noticeId || recordId(record), record.organization?.component || record.subTier, record.office].filter(Boolean).join(" · ")}</small></> },
    { key: "fit", label: "Sabre fit", required: true, minWidth: 145, sortValue: (record) => record.fitAssessment.score, value: (record) => `${record.fitAssessment.score} ${record.fitAssessment.level}`, render: (record) => <FitBadge assessment={record.fitAssessment} /> },
    { key: "clusters", label: "Work clusters", minWidth: 230, value: (record) => record.fitAssessment.clusterIds.map(opportunityClusterLabel).join(" · "), render: (record) => <div className="opportunity-cluster-chips">{record.fitAssessment.clusters.slice(0, 3).map((item) => <span key={item.id}>{item.label}</span>)}{!record.fitAssessment.clusters.length ? <small>Unclassified</small> : null}</div> },
    { key: "codes", label: "NAICS / PSC", minWidth: 130, searchValue: (record) => [record.naicsCode, record.naicsDescription, record.pscCode, record.pscDescription].filter(Boolean).join(" "), value: (record) => [record.naicsCode, record.pscCode].filter(Boolean).join(" · ") || "Not published", render: (record) => <><strong>{record.naicsCode || "No NAICS"}</strong><small>{record.pscCode ? `PSC ${record.pscCode}` : "PSC not published"}</small></> },
    { key: "type", label: "Notice type", minWidth: 165, value: (record) => samNoticeTypeLabel(record.noticeType) },
    { key: "deadline", label: "Response deadline", minWidth: 150, sortValue: (record) => record.solicitationEnd || record.responseDeadline || "9999-12-31", value: (record) => record.solicitationEnd || record.responseDeadline || "", render: (record) => date(record.solicitationEnd || record.responseDeadline) },
    { key: "actions", label: "Actions", role: "actions", required: true, sortable: false, render: (record) => { const id = recordId(record); const tracked = trackedIds.has(id.toLowerCase()); return <div className="dbi-table-actions"><a href={record.sourceUrl || `https://sam.gov/opp/${encodeURIComponent(record.noticeId || id)}/view`} target="_blank" rel="noreferrer" aria-label={`Open ${record.title || id} on SAM.gov`}><ExternalLink size={15} /></a><button type="button" disabled={tracked || trackingId === id || !runtimeAvailable || !canWrite} onClick={() => track(record)} title={tracked ? "Tracked with immediate alerts" : "Track this notice with immediate alerts"} aria-label={`${tracked ? "Tracked" : "Track"} ${record.title || id}`}>{tracked ? <CheckCircle2 size={15} /> : <BellPlus size={15} />}</button></div>; } },
  ];

  return <div className="opportunity-radar" data-opportunity-radar>
    <section className="opportunity-radar__intake" aria-labelledby="opportunity-intake-title">
      <div><span><LocateFixed size={18} /></span><div><h2 id="opportunity-intake-title">Add a SAM.gov opportunity</h2><p>Paste a notice link or ID. Radar checks the corpus and SAM API first, then uses OpenAI’s SAM.gov-only web retrieval when the exact API lookup cannot resolve the page.</p></div></div>
      <form onSubmit={importReference}><label><span className="sr-only">SAM.gov opportunity link or notice ID</span><Search size={16} /><input className="if-input" value={reference} onChange={(event) => setReference(event.target.value)} placeholder="https://sam.gov/opp/…/view or notice ID" /></label><button className="if-btn if-btn--primary" type="submit" disabled={intakeState.status === "loading"}>{intakeState.status === "loading" ? "Checking…" : "Check and add"}</button></form>
      {intakeState.status !== "idle" ? <p className={`if-alert ${intakeState.status === "error" ? "if-alert--warning" : "if-alert--info"}`} role="status">{intakeState.message}</p> : null}
    </section>

    <section className="opportunity-radar__profile" aria-label="Active opportunity fit profile"><div><BrainCircuit size={18} /><span><small>Active fit profile</small><strong>{SABRE_FIT_PROFILE.label}</strong></span></div><p>{SABRE_FIT_PROFILE.description}</p><span className="if-badge"><Sparkles size={13} /> Explainable</span></section>

    <section className="opportunity-radar__clusters" aria-labelledby="opportunity-clusters-title"><header><div><small>Browse related work</small><h2 id="opportunity-clusters-title">Capability clusters</h2></div><span>{assessedRows.length.toLocaleString()} assessed records</span></header><div><button type="button" className={cluster === "all" ? "is-active" : ""} onClick={() => setCluster("all")}><Radar size={18} /><strong>All aligned work</strong><span>{assessedRows.filter((record) => record.fitAssessment.score >= 25).length.toLocaleString()}</span><small>Every record with an explainable profile signal</small></button>{OPPORTUNITY_CLUSTERS.map((item) => <button type="button" key={item.id} className={cluster === item.id ? "is-active" : ""} onClick={() => setCluster(item.id)}><strong>{item.label}</strong><span>{Number(clusterCounts[item.id] || 0).toLocaleString()}</span><small>{item.description}</small></button>)}</div></section>

    <section className="opportunity-radar__controls" aria-label="Opportunity radar controls"><div><span>Showing</span><strong>{cluster === "all" ? "All capability clusters" : opportunityClusterLabel(cluster)}</strong></div><ControlSelect label="Minimum fit" value={minimumFit} options={[["70", "Strong fit (70+)"] , ["45", "Potential fit (45+)"] , ["25", "Adjacent signal (25+)"] , ["0", "All records"]]} onChange={setMinimumFit} /><ControlSelect label="Notice scope" value={noticeType} options={[["all", "All notice types"], ["source", "Sources sought / RFI"], ["solicitation", "Solicitations"], ["pre", "Pre-solicitations"]]} onChange={setNoticeType} /></section>
    {radarRows.length ? <OperationalDataTable id="opportunity-radar" label="Sabre-aligned opportunity radar" rows={radarRows} columns={columns} rowKey={recordId} defaultSort={{ key: "fit", direction: "desc" }} queryValue={query} onQueryChange={setQuery} searchPlaceholder="Search scope, office, NAICS, PSC, solicitation, or notice ID…" exportFilename="opportunity-radar.csv" highlightedRowId={intakeState.recordId} mobileColumns={["record", "fit", "clusters", "deadline", "actions"]} renderDetail={(record) => <div className="opportunity-radar__detail"><section><small>Why it matched</small><h3>{record.fitAssessment.profileLabel} evidence</h3><ul>{record.fitAssessment.reasons.length ? record.fitAssessment.reasons.map((reason) => <li key={reason}>{reason}</li>) : <li>No strong published capability or code signal was found.</li>}</ul><p>{record.fitAssessment.methodology}</p></section><section><small>Published scope</small><p>{record.description || record.context || "SAM.gov did not publish scope text in the retained API record."}</p></section>{record.retrievalProvenance ? <section><small>OpenAI web retrieval · needs review</small><h3>Exact SAM.gov notice evidence</h3><p>Model: {record.retrievalProvenance.model || "not recorded"}</p><ul>{(record.retrievalProvenance.sourceUrls || []).map((url, index) => <li key={url}><a href={url} target="_blank" rel="noreferrer">SAM.gov source {index + 1}</a></li>)}</ul>{record.retrievalProvenance.caveats?.length ? <p>{record.retrievalProvenance.caveats.join(" ")}</p> : null}</section> : null}{record.aiAssessment ? <section><small>AI assessment · needs review</small><h3>{record.aiAssessment.recommendedAction || "research"}</h3><p>{record.aiAssessment.summary}</p>{record.aiAssessment.risks?.length ? <ul>{record.aiAssessment.risks.map((risk) => <li key={risk}>{risk}</li>)}</ul> : null}<p>Model: {record.aiAssessment.provenance?.model || "not recorded"} · Source: <a href={record.aiAssessment.provenance?.sourceUrl || record.sourceUrl} target="_blank" rel="noreferrer">SAM.gov</a></p></section> : null}</div>} /> : <ControlAsyncState compact state="empty" title="No opportunities match this profile view" message="Lower the minimum fit, choose another cluster, or paste a specific SAM.gov notice above." />}
  </div>;
}
