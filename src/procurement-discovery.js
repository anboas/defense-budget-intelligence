const EMPTY_DISCOVERY = Object.freeze({ metadata: {}, discovery: [], history: [] });
let cached = null;
let pending = null;

export function emptyProcurementDiscovery() {
  return EMPTY_DISCOVERY;
}

export async function loadProcurementDiscovery() {
  if (cached) return cached;
  if (!pending) {
    pending = fetch(`${import.meta.env.BASE_URL}data/procurement-discovery.json`)
      .then((response) => {
        if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
        return response.json();
      })
      .then((payload) => {
        cached = {
          metadata: payload?.metadata || {},
          discovery: Array.isArray(payload?.discovery) ? payload.discovery : [],
          history: Array.isArray(payload?.history) ? payload.history : [],
        };
        return cached;
      })
      .finally(() => { pending = null; });
  }
  return pending;
}
