const NORMALIZE_SPACE = /\s+/g;

export const OPPORTUNITY_CLUSTERS = Object.freeze([
  Object.freeze({ id: "ai-autonomy", label: "AI & autonomy", description: "Artificial intelligence, machine learning, decision support, robotics, and autonomous systems.", keywords: ["ai", "artificial intelligence", "machine learning", "generative ai", "large language model", "llm", "autonomous", "autonomy", "computer vision", "decision support", "robotic"] }),
  Object.freeze({ id: "systems-engineering", label: "Systems engineering", description: "Architecture, requirements, integration, verification, digital engineering, and MBSE.", keywords: ["systems engineering", "system engineering", "systems integration", "system integration", "system architecture", "enterprise architecture", "requirements engineering", "digital engineering", "model based systems", "model-based systems", "mbse", "verification and validation", "test and evaluation", "technical baseline"] }),
  Object.freeze({ id: "software-development", label: "Software development", description: "Application engineering, modernization, DevSecOps, cloud platforms, and software sustainment.", keywords: ["software development", "software engineering", "application development", "application modernization", "devsecops", "devops", "agile software", "cloud migration", "cloud platform", "microservice", "software sustainment", "api development", "full stack", "full-stack"] }),
  Object.freeze({ id: "data-analytics", label: "Data & analytics", description: "Data platforms, analytics, visualization, knowledge management, and operational intelligence.", keywords: ["data engineering", "data analytics", "advanced analytics", "data platform", "data architecture", "data science", "business intelligence", "knowledge management", "data visualization", "predictive analytics", "operational intelligence"] }),
  Object.freeze({ id: "cyber-mission-systems", label: "Cyber & mission systems", description: "Cybersecurity, zero trust, C5ISR, mission applications, and resilient digital infrastructure.", keywords: ["cybersecurity", "cyber security", "zero trust", "information assurance", "c5isr", "c4isr", "command and control", "mission system", "mission application", "network operations", "security operations", "rmf"] }),
  Object.freeze({ id: "acquisition-program-support", label: "Acquisition & program support", description: "Program management, acquisition support, cost, schedule, logistics, and lifecycle support.", keywords: ["program management", "acquisition support", "acquisition management", "program office support", "cost analysis", "schedule analysis", "integrated master schedule", "lifecycle support", "life cycle support", "logistics support", "configuration management", "technical assistance"] }),
]);

export const SABRE_FIT_PROFILE = Object.freeze({
  id: "sabre-public-capability-profile",
  label: "Sabre-aligned",
  description: "Public capability profile for engineering, software, AI/data, cyber, and acquisition support. This is a discovery heuristic, not a bid/no-bid decision or eligibility determination.",
  priorityClusters: Object.freeze(["systems-engineering", "software-development", "ai-autonomy", "data-analytics", "cyber-mission-systems", "acquisition-program-support"]),
  naicsCodes: Object.freeze(["541330", "541511", "541512", "541513", "541519", "541611", "541618", "541690", "541715"]),
  pscPrefixes: Object.freeze(["D3", "DA", "DB", "DC", "DD", "R4", "R7"]),
});

const CLUSTER_BY_ID = new Map(OPPORTUNITY_CLUSTERS.map((cluster) => [cluster.id, cluster]));

function text(value) {
  return String(value || "").replace(/<[^>]*>/g, " ").replace(NORMALIZE_SPACE, " ").trim();
}

function evidenceText(record) {
  return [record.title, record.description, record.scope, record.context, record.naicsDescription, record.pscDescription, ...(record.technologyAreas || []), ...(record.workCategories || [])]
    .map(text).filter(Boolean).join(" ").toLowerCase();
}

function includesKeyword(searchable, keyword) {
  if (keyword.length > 3) return searchable.includes(keyword);
  return new RegExp(`(^|[^a-z0-9])${keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9]|$)`, "i").test(searchable);
}

export function classifyOpportunityFit(record = {}, profile = SABRE_FIT_PROFILE) {
  const searchable = evidenceText(record);
  const clusterMatches = OPPORTUNITY_CLUSTERS.map((cluster) => {
    const matches = cluster.keywords.filter((keyword) => includesKeyword(searchable, keyword));
    return matches.length ? { id: cluster.id, label: cluster.label, description: cluster.description, matches: matches.slice(0, 4), basis: "published title or scope" } : null;
  }).filter(Boolean);
  const naicsCode = text(record.naicsCode);
  const pscCode = text(record.pscCode).toUpperCase();
  const naicsMatch = profile.naicsCodes.includes(naicsCode);
  const pscMatch = profile.pscPrefixes.some((prefix) => pscCode.startsWith(prefix));
  const technologyMatch = (record.technologyAreas || []).length > 0;
  const active = record.active !== false && record.lifecycleStage !== "archived";
  let score = clusterMatches.reduce((total, cluster) => total + 14 + Math.min(8, (cluster.matches.length - 1) * 2), 0);
  if (naicsMatch) score += 24;
  if (pscMatch) score += 12;
  if (technologyMatch) score += 6;
  if (active) score += 4;
  score = Math.min(98, Math.max(0, score));
  const level = score >= 70 ? "strong" : score >= 45 ? "potential" : score >= 25 ? "adjacent" : "low";
  const reasons = [
    ...clusterMatches.slice(0, 3).map((cluster) => `${cluster.label}: ${cluster.matches.join(", ")}`),
    naicsMatch ? `NAICS ${naicsCode} is in the active profile` : "",
    pscMatch ? `PSC ${pscCode} aligns with the active profile` : "",
  ].filter(Boolean).slice(0, 5);
  return {
    profileId: profile.id,
    profileLabel: profile.label,
    score,
    level,
    clusters: clusterMatches,
    clusterIds: clusterMatches.map((cluster) => cluster.id),
    reasons,
    evidence: { naicsCode: naicsCode || null, naicsMatch, pscCode: pscCode || null, pscMatch, technologyMatch },
    methodology: "Explainable keyword and published-code heuristic. Validate scope, vehicle access, set-aside, customer fit, and teaming before pursuit.",
  };
}

export function opportunityClusterLabel(id) {
  return CLUSTER_BY_ID.get(id)?.label || id || "Unclassified";
}
