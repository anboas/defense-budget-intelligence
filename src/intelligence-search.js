let cached = null;
let pending = null;

export async function loadIntelligenceSearchIndex() {
  if (cached) return cached;
  if (!pending) {
    pending = fetch(`${import.meta.env.BASE_URL}data/intelligence-search-index.json`)
      .then((response) => {
        if (!response.ok) throw new Error(`Universal intelligence search returned ${response.status}`);
        return response.json();
      })
      .then((payload) => {
        if (payload?.metadata?.schemaVersion !== "intelligence-search.v1") throw new Error("Universal intelligence search index is incompatible");
        cached = payload;
        return cached;
      })
      .finally(() => { pending = null; });
  }
  return pending;
}

export function intelligenceTypeLabel(type) {
  return ({
    activity: "Opportunity",
    award: "Award",
    organization: "Organization",
    "contract-vehicle": "Vehicle",
    "federal-account": "Federal account",
    classification: "Classification",
    location: "Location",
    person: "Person",
    "official-role": "Official role",
    "defense-program": "Program",
    "program-office": "Program office",
  })[type] || String(type || "Entity").replaceAll("-", " ");
}
