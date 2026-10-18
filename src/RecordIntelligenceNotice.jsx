export default function RecordIntelligenceNotice({ intelligence }) {
  if (!intelligence?.notice) return null;
  const failed = intelligence.state === "failed";
  return <div className={`if-alert ${failed ? "if-alert--warning" : "if-alert--info"}`} role={failed ? "alert" : "status"} data-record-intelligence-notice>
    <span><strong>Research:</strong> {intelligence.notice}</span>
    <button type="button" className="if-btn if-btn--ghost if-btn--sm" onClick={() => intelligence.setNotice?.("")}>Dismiss</button>
  </div>;
}
