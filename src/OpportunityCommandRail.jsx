import { useRef, useState } from "react";
import { CalendarClock, ExternalLink, ListChecks, Sparkles, Star } from "lucide-react";
import ControlSelect from "./ControlSelect.jsx";
import { PURSUIT_STAGES, normalizePursuit } from "./pursuit-metadata.js";

function recordId(record) {
  return record?.opportunityId || record?.sourceRecordId || record?.noticeId || record?.id || record?.reference || "";
}

function PursuitFields({ watch, canWrite, onCommit }) {
  const [draft, setDraft] = useState(() => normalizePursuit(watch?.pursuit));
  const [reviewAt, setReviewAt] = useState(watch?.reviewAt || "");

  function commit(patch) {
    const nextDraft = normalizePursuit({ ...draft, ...patch });
    const nextReviewAt = patch.reviewAt ?? reviewAt;
    setDraft(nextDraft);
    setReviewAt(nextReviewAt);
    void onCommit(nextDraft, nextReviewAt);
  }

  return <div className="if-panel__body if-form-grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 12rem), 1fr))", gap: "0.5rem" }}>
    <div className="if-field"><span className="if-field__label">Stage</span><ControlSelect label="Stage" value={draft.stage} options={PURSUIT_STAGES} disabled={!canWrite} triggerProps={{ style: { minHeight: "2.75rem" } }} onChange={(stage) => commit({ stage })} /></div>
    <label className="if-field"><span className="if-field__label">Owner</span><input className="if-input if-touch-target" value={draft.owner} disabled={!canWrite} maxLength="80" placeholder="Unassigned" onChange={(event) => setDraft((current) => ({ ...current, owner: event.target.value }))} onBlur={() => { if (draft.owner !== (watch?.pursuit?.owner || "")) commit({ owner: draft.owner }); }} onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} /></label>
    <label className="if-field"><span className="if-field__label">Next action</span><input className="if-input if-touch-target" value={draft.nextAction} disabled={!canWrite} maxLength="320" placeholder="Define the next decision or customer action" onChange={(event) => setDraft((current) => ({ ...current, nextAction: event.target.value }))} onBlur={() => { if (draft.nextAction !== (watch?.pursuit?.nextAction || "")) commit({ nextAction: draft.nextAction }); }} onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} /></label>
    <label className="if-field"><span className="if-field__label">Checkpoint</span><input className="if-input if-touch-target" type="date" value={reviewAt} disabled={!canWrite} onChange={(event) => commit({ reviewAt: event.target.value })} /></label>
  </div>;
}

export default function OpportunityCommandRail({ record, watch = null, canWrite = false, onSavePursuit, onToggleTrack, intelligence, showRecordLink = true }) {
  const id = recordId(record);
  const sourceUrl = record?.sourceUrl || record?.sourceUrls?.[0] || null;
  const [status, setStatus] = useState("");
  const saveQueue = useRef(Promise.resolve());
  const researchBusy = Boolean(intelligence?.activeJob || ["queued", "in_progress", "researching"].includes(intelligence?.state));

  async function commit(nextDraft, nextReviewAt) {
    if (!canWrite || !onSavePursuit) return;
    setStatus("Saving…");
    try {
      const task = saveQueue.current.catch(() => {}).then(() => onSavePursuit(id, { ...nextDraft, reviewAt: nextReviewAt }));
      saveQueue.current = task;
      await task;
      setStatus("Saved");
      window.setTimeout(() => setStatus((current) => current === "Saved" ? "" : current), 1_600);
    } catch (error) {
      setStatus(error.message || "Could not save pursuit state.");
    }
  }

  return <section className="if-panel" data-opportunity-command-rail data-tracked={watch ? "true" : "false"}>
    <header className="if-panel__header">
      <div><h3 className="if-panel__title">Pursuit controls</h3><p className="if-panel__subtitle">Assign ownership, stage the work, and keep the next decision visible.</p></div>
      <span className="if-status if-status--sm" role="status" aria-live="polite">{status || (watch ? "Workspace pursuit" : "Not tracked")}</span>
    </header>
    <PursuitFields key={`${id}:${watch?.updatedAt || "new"}`} watch={watch} canWrite={canWrite} onCommit={commit} />
    <nav className="if-panel__footer" style={{ justifyContent: "flex-start", flexWrap: "wrap" }} aria-label="Selected opportunity actions">
      <button type="button" className={watch ? "if-btn if-btn--secondary if-touch-target is-active" : "if-btn if-btn--secondary if-touch-target"} disabled={!canWrite} onClick={() => watch ? onToggleTrack?.(id) : void commit(normalizePursuit(), "")}><Star size={15} fill={watch ? "currentColor" : "none"} />{watch ? "Tracked" : "Track"}</button>
      <button type="button" className="if-btn if-btn--ai if-touch-target" disabled={!intelligence?.canWrite || researchBusy} aria-label="Build AI decision brief" aria-busy={researchBusy} onClick={() => { void intelligence?.research().catch(() => {}); }}><Sparkles size={15} />{researchBusy ? "Research running…" : "Research"}</button>
      {showRecordLink ? <a className="if-btn if-btn--primary if-touch-target" href={`#/budget-spend/explorer?spendView=record&capRecord=${encodeURIComponent(id)}`}><ListChecks size={15} />Open record</a> : null}
      <a className="if-btn if-btn--secondary if-touch-target" href={`#/budget-spend/explorer?spendView=timeline&capRecord=${encodeURIComponent(id)}`}><CalendarClock size={15} />Timeline</a>
      {sourceUrl ? <a className="if-btn if-btn--secondary if-touch-target" href={sourceUrl} target="_blank" rel="noreferrer"><ExternalLink size={15} />Source</a> : null}
    </nav>
    {intelligence?.notice ? <div className={`if-alert ${intelligence.state === "failed" ? "if-alert--warning" : "if-alert--info"}`} role="status"><span>{intelligence.notice}</span></div> : null}
  </section>;
}
