import { useCallback, useEffect, useMemo, useState } from "react";
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
  const [savedRelationships, setSavedRelationships] = useState([]);
  const [state, setState] = useState("idle");
  const [notice, setNotice] = useState("");

  const refresh = useCallback(async () => {
    if (!opportunityId || !remote) { setReports([]); setSavedRelationships([]); return; }
    const payload = await request(`/${encodeURIComponent(opportunityId)}`);
    setReports(Array.isArray(payload?.reports) ? payload.reports : []);
    setSavedRelationships((Array.isArray(payload?.relationships) ? payload.relationships : []).map(cleanRelationship).filter(Boolean));
  }, [opportunityId, remote]);

  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(() => { void refresh().catch((error) => { if (active) setNotice(error.message); }); }, 0);
    return () => { active = false; window.clearTimeout(timer); };
  }, [refresh]);

  const research = useCallback(async (recordId = opportunityId) => {
    if (!recordId || !remote) throw new Error("AI research requires an authenticated workspace with an OpenAI credential.");
    setState("researching");
    setNotice("Researching official sources, decision posture, key dates, next actions, and lifecycle evidence. Transient provider failures retry once automatically…");
    try {
      const payload = await request(`/${encodeURIComponent(recordId)}/research`, { method: "POST", body: "{}" });
      if (payload?.report) setReports((current) => [payload.report, ...current.filter((row) => row.id !== payload.report.id)]);
      if (payload?.relationships?.length) setSavedRelationships((current) => [...payload.relationships.map(cleanRelationship).filter(Boolean), ...current]);
      setState("succeeded");
      setNotice("Research complete. Review the cited findings and linked lifecycle evidence below.");
      return payload;
    } catch (error) { setState("failed"); setNotice(error.message); throw error; }
  }, [opportunityId, remote]);

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

  return { reports, relationships, automaticRelationships: automatic, state, notice, setNotice, canWrite: Boolean(remote && auth?.user?.canWriteWorkspace), research, linkWithAi, removeRelationship, refresh };
}
