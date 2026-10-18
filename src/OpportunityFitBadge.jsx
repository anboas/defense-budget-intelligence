export default function OpportunityFitBadge({ assessment }) {
  const label = assessment.level === "strong" ? "Strong fit"
    : assessment.level === "potential" ? "Potential fit"
      : assessment.level === "adjacent" ? "Adjacent" : "Low signal";
  return <span className={`opportunity-fit-badge opportunity-fit-badge--${assessment.level}`}><b>{assessment.score}</b><span>{label}</span></span>;
}
