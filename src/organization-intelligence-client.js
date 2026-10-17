let intelligencePromise;

export function loadOrganizationRelationships() {
  if (!intelligencePromise) {
    intelligencePromise = Promise.all([
      fetch(`${import.meta.env.BASE_URL}data/organization-intelligence.json`).then((response) => { if (!response.ok) throw new Error(`Organization intelligence returned ${response.status}`); return response.json(); }),
      fetch(`${import.meta.env.BASE_URL}data/roadmap-intelligence.json`).then((response) => { if (!response.ok) throw new Error(`Roadmap intelligence returned ${response.status}`); return response.json(); }),
      fetch(`${import.meta.env.BASE_URL}data/intelligence-graph-summary.json`).then((response) => { if (!response.ok) throw new Error(`Intelligence graph summary returned ${response.status}`); return response.json(); }),
    ]).then(([organizations, roadmap, graphSummary]) => ({ organizations, roadmap, graphSummary }));
  }
  return intelligencePromise;
}
