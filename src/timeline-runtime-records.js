import { useEffect, useMemo, useState } from "react";
import { reportClientError } from "./client-error-reporting.js";

const STATIC_RUNTIME = Object.freeze({ status: "static", records: [], loadedAt: "", error: "" });

export function useTimelineRuntimeRecords({ auth, enabled, samOpportunities, manualProcurement }) {
  const [runtime, setRuntime] = useState({ status: enabled ? "loading" : "static", records: [], loadedAt: "", error: "" });

  useEffect(() => {
    if (!enabled) return undefined;
    let active = true;
    const controller = new AbortController();
    const load = async () => {
      const records = [];
      let offset = 0;
      let hasMore = true;
      while (hasMore) {
        const payload = await auth.listAcquisitionRecords({ limit: 1000, offset, signal: controller.signal });
        const page = payload.records || [];
        records.push(...page);
        hasMore = Boolean(payload.pagination?.hasMore) && page.length > 0;
        offset += page.length;
      }
      if (active) setRuntime({ status: "ready", records, loadedAt: new Date().toISOString(), error: "" });
    };
    void load().catch((error) => {
      if (!active || error?.name === "AbortError") return;
      setRuntime({ status: "error", records: [], loadedAt: "", error: error.message });
      reportClientError(error, { kind: "timeline_acquisition_runtime_records" });
    });
    return () => { active = false; controller.abort(); };
  }, [auth, enabled]);

  const visibleRuntime = enabled ? runtime : STATIC_RUNTIME;

  const effectiveSamOpportunities = useMemo(() => {
    const records = visibleRuntime.records.filter((record) => record.recordKind !== "acquisition-portfolio");
    if (!records.length) return samOpportunities;
    const merged = new Map((samOpportunities.records || []).map((record) => [record.sourceRecordId || record.noticeId, record]));
    for (const record of records) merged.set(record.sourceRecordId || record.noticeId, record);
    return { ...samOpportunities, metadata: { ...samOpportunities.metadata, status: "workspace-runtime", runtimeRecordCount: records.length }, records: [...merged.values()] };
  }, [samOpportunities, visibleRuntime.records]);

  const effectiveManualProcurement = useMemo(() => {
    const imported = visibleRuntime.records.filter((record) => record.recordKind === "acquisition-portfolio");
    return { ...manualProcurement, metadata: { ...manualProcurement.metadata, runtimePortfolioRecords: imported.length }, records: [...(manualProcurement.records || []), ...imported] };
  }, [manualProcurement, visibleRuntime.records]);

  const latestRecordAt = useMemo(() => visibleRuntime.records.map((record) => record.lastSeenAt || record.lastChangedAt || "").filter(Boolean).sort().at(-1) || visibleRuntime.loadedAt, [visibleRuntime.loadedAt, visibleRuntime.records]);
  return { runtime: visibleRuntime, effectiveSamOpportunities, effectiveManualProcurement, latestRecordAt };
}
