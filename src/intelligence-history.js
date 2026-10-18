const RECENT_KEY = "dbi:intelligence:recent:v1";
const PINNED_KEY = "dbi:intelligence:pinned:v1";

function read(key) {
  try {
    const value = JSON.parse(localStorage.getItem(key) || "[]");
    return Array.isArray(value) ? value.filter((item) => item?.id && item?.entityType).slice(0, 12) : [];
  } catch {
    return [];
  }
}

function write(key, items) {
  try { localStorage.setItem(key, JSON.stringify(items.slice(0, 12))); } catch { /* Browser storage is optional. */ }
}

export function readRecentIntelligence() { return read(RECENT_KEY); }
export function readPinnedIntelligence() { return read(PINNED_KEY); }

export function rememberIntelligence(item) {
  const next = [item, ...readRecentIntelligence().filter((candidate) => candidate.id !== item.id || candidate.entityType !== item.entityType)];
  write(RECENT_KEY, next);
  window.dispatchEvent(new Event("dbi:intelligence-history"));
}

export function togglePinnedIntelligence(item) {
  const current = readPinnedIntelligence();
  const exists = current.some((candidate) => candidate.id === item.id && candidate.entityType === item.entityType);
  write(PINNED_KEY, exists ? current.filter((candidate) => candidate.id !== item.id || candidate.entityType !== item.entityType) : [item, ...current]);
  window.dispatchEvent(new Event("dbi:intelligence-history"));
  return !exists;
}
