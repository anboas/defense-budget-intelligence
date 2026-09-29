import { useCallback, useEffect, useState } from "react";

const requests = new Map();

function requestJson(filename) {
  if (!requests.has(filename)) {
    const url = `${import.meta.env.BASE_URL}data/${filename}`;
    requests.set(filename, fetch(url).then((response) => {
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
      return response.json();
    }).catch((error) => {
      requests.delete(filename);
      throw error;
    }));
  }
  return requests.get(filename);
}

export function useRuntimeJson(active, filename) {
  const [state, setState] = useState({ data: null, error: "", attempt: 0 });

  useEffect(() => {
    if (!active || state.data) return undefined;
    let cancelled = false;
    requestJson(filename)
      .then((data) => { if (!cancelled) setState((current) => ({ ...current, data, error: "" })); })
      .catch((error) => { if (!cancelled) setState((current) => ({ ...current, error: error.message })); });
    return () => { cancelled = true; };
  }, [active, filename, state.attempt, state.data]);

  const retry = useCallback(() => {
    requests.delete(filename);
    setState((current) => ({ data: null, error: "", attempt: current.attempt + 1 }));
  }, [filename]);

  return { data: state.data, error: state.error, retry };
}
