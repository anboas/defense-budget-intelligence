export const RECENT_NAVIGATION_KEY = "dbi:navigation:recent";
export const FAVORITE_NAVIGATION_KEY = "dbi:navigation:favorites";

export function readNavigationList(key) {
  if (typeof window === "undefined") return [];
  try {
    const value = JSON.parse(window.localStorage.getItem(key) || "[]");
    return Array.isArray(value) ? value.map(String).filter(Boolean) : [];
  } catch {
    return [];
  }
}

export function writeNavigationList(key, values, limit = 8) {
  if (typeof window === "undefined") return [];
  const next = [...new Set((values || []).map(String).filter(Boolean))].slice(0, limit);
  window.localStorage.setItem(key, JSON.stringify(next));
  window.dispatchEvent(new CustomEvent("dbi:navigation-history-changed", { detail: { key, values: next } }));
  return next;
}

export function rememberNavigation(id) {
  return writeNavigationList(RECENT_NAVIGATION_KEY, [id, ...readNavigationList(RECENT_NAVIGATION_KEY)], 6);
}
