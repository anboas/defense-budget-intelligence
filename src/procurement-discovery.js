const EMPTY_DISCOVERY = Object.freeze({ metadata: {}, discovery: [], history: [] });
const EMPTY_FEED = Object.freeze({ metadata: {}, history: [], closingSoon: [] });
let cached = null;
let pending = null;
let feedCached = null;
let feedPending = null;

export function emptyProcurementDiscovery() {
  return EMPTY_DISCOVERY;
}

export function emptyProcurementFeed() {
  return EMPTY_FEED;
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

export async function loadProcurementFeed() {
  if (feedCached) return feedCached;
  if (!feedPending) {
    feedPending = fetch(`${import.meta.env.BASE_URL}data/procurement-feed.json`)
      .then((response) => {
        if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
        return response.json();
      })
      .then((payload) => {
        feedCached = {
          metadata: payload?.metadata || {},
          history: Array.isArray(payload?.history) ? payload.history : [],
          closingSoon: Array.isArray(payload?.closingSoon) ? payload.closingSoon : [],
        };
        return feedCached;
      })
      .finally(() => { feedPending = null; });
  }
  return feedPending;
}
