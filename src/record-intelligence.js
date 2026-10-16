import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "./AuthContext.jsx";
import { automaticRecordRelationships } from "./record-linking.js";

function cleanRelationship(row) {
  if (!row?.sourceId || !row?.targetId) return null;
  return {
    id: String(row.id || ""), sourceId: String(row.sourceId), targetId: String(row.targetId),
    relationship: String(row.relationship || "related-workstream"), confidence: String(row.confidence || "low"),
    rationale: String(row.rationale || ""), evidence: Array.isArray(row.evidence) ? row.evidence : [],
    sourceUrls: Array.isArray(row.sourceUrls) ? row.sourceUrls : [], caveats: Array.isArray(row.caveats) ? row.caveats : [],
    provenance: row.provenance && typeof row.provenance === "object" ? row.provenance : {}, automatic: Boolean(row.automatic),
  };
}

async function request(path, options = {}) {
  const response = await fetch(`/api/v1/agent/record-intelligence${path}`, {
    credentials: "same-origin",
    headers: { ...(options.body ? { "content-type": "application/json" } : {}), ...(options.headers || {}) },
    ...options,
  });
  if (response.status === 204) return null;
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(payload.error?.message || payload.error || "Record intelligence request failed."), { code: payload.error?.code || payload.code || "record_intelligence_failed" });
  return payload?.data ?? payload;
}

export function useRecordIntelligence(records = [], opportunityId = "") {
  const auth = useAuth();
  const remote = Boolean(auth?.authVersion === "dbi-pages-auth-v1" && auth?.enabled && auth?.user && !auth?.staticHost);
  const automatic = useMemo(() => automaticRecordRelationships(records), [records]);
  const [reports, setReports] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [savedRelationships, setSavedRelationships] = useState([]);
  const [state, setState] = useState("idle");
  const [notice, setNotice] = useState("");
  const pollPromiseRef = useRef(null);

  const refresh = useCallback(async () => {
    if (!opportunityId || !remote) { setReports([]); setSavedRelationships([]); setJobs([]); return; }
    const payload = await request(`/${encodeURIComponent(opportunityId)}`);
    setReports(Array.isArray(payload?.reports) ? payload.reports : []);
    setSavedRelationships((Array.isArray(payload?.relationships) ? payload.relationships : []).map(cleanRelationship).filter(Boolean));
    const nextJobs = Array.isArray(payload?.jobs) ? payload.jobs : [];
    setJobs(nextJobs);
    const active = nextJobs.find((job) => ["queued", "in_progress"].includes(job.status));
    if (active) { setState(active.status); setNotice(active.attempt > 1 ? "Official-source research is running on its bounded recovery attempt. You can leave this page and return later." : "Official-source research is running in the background. You can leave this page and return later."); }
  }, [opportunityId, remote]);

  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(() => { void refresh().catch((error) => { if (active) setNotice(error.message); }); }, 0);
    return () => { active = false; window.clearTimeout(timer); };
  }, [refresh]);

  const pollResearchJob = useCallback((recordId, job) => {
    if (pollPromiseRef.current?.id === job.id) return pollPromiseRef.current.promise;
    const promise = (async () => {
      let result = { job };
      for (let poll = 0; poll < 180; poll += 1) {
        await new Promise((resolve) => window.setTimeout(resolve, poll < 3 ? 1_500 : 3_000));
        result = await request(`/${encodeURIComponent(recordId)}/jobs/${encodeURIComponent(job.id)}`);
        if (result?.job) {
          setJobs((current) => [result.job, ...current.filter((candidate) => candidate.id !== result.job.id)]);
          setState(result.job.status);
          setNotice(result.job.attempt > 1 ? "The first provider result did not pass the evidence contract. A smaller bounded retry is running automatically…" : "Research is running in the background. Official sources and structured evidence are being assembled…");
        }
        if (result?.job?.status === "failed") throw Object.assign(new Error(result.job.error?.message || "Official-source research stopped before producing a verified brief."), { code: result.job.error?.code || "research_failed" });
        if (result?.report || result?.job?.status === "completed") return result;
      }
      throw Object.assign(new Error("Research is still running. It will remain resumable from this record."), { code: "research_still_running" });
    })().finally(() => { if (pollPromiseRef.current?.id === job.id) pollPromiseRef.current = null; });
    pollPromiseRef.current = { id: job.id, promise };
    return promise;
  }, []);

  useEffect(() => {
    const active = jobs.find((job) => ["queued", "in_progress"].includes(job.status));
    if (!active || !opportunityId || !remote || pollPromiseRef.current?.id === active.id) return;
    void pollResearchJob(opportunityId, active).then((result) => {
      if (result?.report) setReports((current) => [result.report, ...current.filter((row) => row.id !== result.report.id)]);
      if (result?.relationships?.length) setSavedRelationships((current) => [...result.relationships.map(cleanRelationship).filter(Boolean), ...current]);
      setState("succeeded");
      setNotice("Research complete. Review the cited findings, linked lifecycle evidence, and timeline dates below.");
    }).catch((error) => { setState("failed"); setNotice(error.message); });
  }, [jobs, opportunityId, pollResearchJob, remote]);

  const research = useCallback(async (recordId = opportunityId) => {
    if (!recordId || !remote) throw new Error("AI research requires an authenticated workspace with an OpenAI credential.");
    setState("queued");
    setNotice("Starting resumable official-source research for decision posture, key dates, next actions, and lifecycle evidence…");
    try {
      const payload = await request(`/${encodeURIComponent(recordId)}/research`, { method: "POST", body: "{}" });
      let result = payload;
      if (payload?.job && !payload?.report) {
        setJobs((current) => [payload.job, ...current.filter((job) => job.id !== payload.job.id)]);
        result = await pollResearchJob(recordId, payload.job);
      }
      if (result?.report) setReports((current) => [result.report, ...current.filter((row) => row.id !== result.report.id)]);
      if (result?.relationships?.length) setSavedRelationships((current) => [...result.relationships.map(cleanRelationship).filter(Boolean), ...current]);
      setState("succeeded");
      setNotice("Research complete. Review the cited findings, linked lifecycle evidence, and timeline dates below.");
      return result;
    } catch (error) {
      if (error.code === "research_still_running") {
        setState("in_progress");
        setNotice("Research is still running in the background. You can leave this page and return without losing it.");
        return null;
      }
      setState("failed"); setNotice(error.message); throw error;
    }
  }, [opportunityId, pollResearchJob, remote]);

  const linkWithAi = useCallback(async (memberIds) => {
    const ids = [...new Set(memberIds)].slice(0, 2);
    if (ids.length !== 2 || !remote) throw new Error("Select exactly two records in an authenticated workspace.");
    setState("linking");
    setNotice("Checking exact lifecycle evidence first; AI reviews only ambiguous predecessor, follow-on, or same-requirement evidence…");
    try {
      const payload = await request("/relationships", { method: "POST", body: JSON.stringify({ memberIds: ids }) });
      const relationship = cleanRelationship(payload);
      if (relationship) setSavedRelationships((current) => [relationship, ...current.filter((row) => row.id !== relationship.id)]);
      setState("succeeded");
      setNotice(relationship ? "Relationship saved. Both source records remain separate and independently inspectable." : "OpenAI did not find enough evidence to link these records.");
      return relationship;
    } catch (error) { setState("failed"); setNotice(error.message); throw error; }
  }, [remote]);

  const removeRelationship = useCallback(async (relationshipId) => {
    if (!remote) return;
    await request(`/relationships/${encodeURIComponent(relationshipId)}`, { method: "DELETE" });
    setSavedRelationships((current) => current.filter((row) => row.id !== relationshipId));
  }, [remote]);

  const relationships = useMemo(() => {
    const merged = new Map();
    for (const row of [...automatic, ...savedRelationships]) {
      const normalized = cleanRelationship(row);
      if (!normalized) continue;
      merged.set(`${normalized.sourceId}|${normalized.targetId}|${normalized.relationship}`, normalized);
    }
    const rows = [...merged.values()];
    return opportunityId ? rows.filter((row) => row.sourceId === opportunityId || row.targetId === opportunityId) : rows;
  }, [automatic, opportunityId, savedRelationships]);

  const activeJob = jobs.find((job) => ["queued", "in_progress"].includes(job.status)) || null;
  return { reports, jobs, activeJob, relationships, automaticRelationships: automatic, state, notice, setNotice, canWrite: Boolean(remote && auth?.user?.canWriteWorkspace), research, linkWithAi, removeRelationship, refresh };
}
