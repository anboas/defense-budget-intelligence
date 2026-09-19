import { lazy } from "react";
import { reportClientError } from "./client-error-reporting.js";

const CHUNK_ERROR = /(dynamically imported module|failed to fetch|loading chunk|importing a module script)/i;

export function lazyWithRefresh(importer, id) {
  const retryKey = `dbi:lazy-reload:${id}`;
  return lazy(async () => {
    try {
      const module = await importer();
      window.sessionStorage.removeItem(retryKey);
      return module;
    } catch (error) {
      reportClientError(error, { kind: "chunk_error" });
      if (CHUNK_ERROR.test(String(error?.message || error)) && !window.sessionStorage.getItem(retryKey)) {
        window.sessionStorage.setItem(retryKey, new Date().toISOString());
        window.location.reload();
        return new Promise(() => {});
      }
      throw error;
    }
  });
}
