import { useEffect, useState } from "react";

function hashParams() {
  if (typeof window === "undefined") return new URLSearchParams();
  return new URLSearchParams(window.location.hash.split("?")[1] || "");
}

function normalizeState(candidate, defaults, validators = {}) {
  return Object.fromEntries(Object.entries(defaults).map(([key, fallback]) => {
    const value = candidate[key] ?? fallback;
    const validator = validators[key];
    if (!validator) return [key, value];
    const valid = typeof validator === "function" ? validator(value) : validator.includes(value);
    return [key, valid ? value : fallback];
  }));
}

function stateFromHash(defaults, validators = {}) {
  const params = hashParams();
  return normalizeState(
    Object.fromEntries(Object.entries(defaults).map(([key, fallback]) => [key, params.get(key) ?? fallback])),
    defaults,
    validators,
  );
}

function replaceHashState(nextState, defaults) {
  const route = (window.location.hash || "#/budget-spend/transactions").split("?")[0];
  const params = hashParams();
  for (const [key, value] of Object.entries(nextState)) {
    if (value === defaults[key] || value === "" || value == null) params.delete(key);
    else params.set(key, value);
  }
  const query = params.toString();
  window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}${route}${query ? `?${query}` : ""}`);
}

export default function useUrlState(defaults, validators = {}) {
  const [stableDefaults] = useState(defaults);
  const [stableValidators] = useState(validators);
  const [state, setState] = useState(() => stateFromHash(defaults, validators));

  useEffect(() => {
    const sync = () => {
      const raw = Object.fromEntries(Object.entries(stableDefaults).map(([key, fallback]) => [key, hashParams().get(key) ?? fallback]));
      const normalized = normalizeState(raw, stableDefaults, stableValidators);
      setState(normalized);
      if (Object.keys(stableDefaults).some((key) => raw[key] !== normalized[key])) {
        replaceHashState(normalized, stableDefaults);
      }
    };
    sync();
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, [stableDefaults, stableValidators]);

  function update(next) {
    setState((current) => {
      const resolved = normalizeState(typeof next === "function" ? next(current) : next, stableDefaults, stableValidators);
      replaceHashState(resolved, stableDefaults);
      return resolved;
    });
  }

  return [state, update];
}
