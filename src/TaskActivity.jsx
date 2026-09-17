import { ControlActivityInspector } from "control-surface-ui/react";

function dateTime(value) {
  const date = new Date(value || "");
  if (Number.isNaN(date.getTime())) return "Unavailable";
  return date.toLocaleString([], { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
}

function statusLabel(status) {
  return ({ researching: "Researching", verifying: "Verifying", needs_review: "Needs review", completed: "Completed", succeeded: "Completed", failed: "Failed", rejected: "Rejected", rate_limited: "Rate limited", running: "Running", pending: "Pending" })[status] || String(status || "Unknown").replaceAll("_", " ");
}

function TaskExchange({ request, response }) {
  return <div className="task-exchange" data-task-exchange aria-label="Redacted request and response">
    <section className="task-exchange__payload"><h4>Request</h4><pre className="if-code-block">{JSON.stringify(request, null, 2)}</pre></section>
    <section className="task-exchange__payload"><h4>Response</h4><pre className="if-code-block">{JSON.stringify(response, null, 2)}</pre></section>
  </div>;
}

function apiExchange(entry) {
  return {
    request: {
      operation: entry.operation || "request",
      interface: [entry.method, entry.route].filter(Boolean).join(" ") || entry.requestKind,
      stage: entry.stage || "Not recorded",
      model: entry.model || undefined,
      retry: entry.retryCount || 0,
      searchQueries: entry.metadata?.evidence?.searchQueries || undefined,
    },
    response: {
      status: entry.status,
      httpStatus: entry.httpStatus || undefined,
      latencyMs: entry.latencyMs || undefined,
      tokens: entry.inputTokens || entry.outputTokens ? { input: entry.inputTokens, output: entry.outputTokens } : undefined,
      providerRequestId: entry.providerRequestId || undefined,
      responseId: entry.responseId || undefined,
      error: entry.errorCode || entry.errorMessage ? { code: entry.errorCode || "request_failed", message: entry.errorMessage || "No safe diagnostic returned" } : undefined,
      evidence: entry.metadata?.evidence || undefined,
    },
  };
}

function providerStageTitle(entry) {
  const stage = String(entry.stage || "").toLowerCase();
  if (stage === "research") return "Research";
  if (stage === "verification" || stage === "verify") return "Independent verification";
  return String(entry.stage || entry.operation || "Provider request").replaceAll("_", " ").replaceAll(".", " · ");
}

function providerItems(entries) {
  return entries.slice().sort((left, right) => String(left.startedAt || left.at).localeCompare(String(right.startedAt || right.at))).map((entry) => {
    const exchange = apiExchange(entry);
    const danger = ["failed", "rejected", "rate_limited"].includes(entry.status);
    return {
      id: entry.id,
      title: providerStageTitle(entry),
      status: statusLabel(entry.status),
      tone: danger ? "danger" : entry.status === "succeeded" ? "success" : "info",
      meta: [dateTime(entry.startedAt || entry.at), entry.model, entry.latencyMs ? `${entry.latencyMs.toLocaleString()} ms` : ""].filter(Boolean).join(" · "),
      detail: entry.errorMessage || `${entry.method || "API"} ${entry.route || entry.requestKind || "request"}`,
      content: <TaskExchange request={exchange.request} response={exchange.response} />,
    };
  });
}

export function EventTaskActivity({ job, entries = [] }) {
  const items = [{
    id: "submitted",
    title: "Task submitted",
    status: "Accepted",
    tone: "info",
    meta: dateTime(job?.createdAt),
    detail: "The operator request and existing event snapshot were accepted. Sensitive identifiers are omitted here.",
    content: <TaskExchange request={{ task: "Research and augment event", target: job?.inputSnapshot?.title || "Event", direction: job?.direction || "Find cited public details and verify them independently.", researchModel: job?.producerModel || undefined, verificationModel: job?.verifierModel || undefined }} response={{ jobId: job?.id, traceId: job?.traceId, status: job?.status }} />,
  }, ...providerItems(entries), {
    id: "outcome",
    title: job?.status === "failed" ? "Workflow stopped" : ["completed", "needs_review"].includes(job?.status) ? "Draft prepared" : "Workflow in progress",
    status: statusLabel(job?.status),
    tone: job?.status === "failed" ? "danger" : ["completed", "needs_review"].includes(job?.status) ? "success" : "info",
    meta: dateTime(job?.completedAt || job?.updatedAt || job?.createdAt),
    detail: job?.error?.message || (job?.mergeResult ? `${job.mergeResult.changes?.length || 0} verified changes; the event remains unsaved.` : "The next provider stage has not completed."),
    content: <TaskExchange request={{ evidenceGate: "Provider citations must support every accepted source and claim." }} response={job?.status === "failed" ? { status: job.status, error: job.error, diagnostic: job.diagnostic } : { status: job?.status, decision: job?.verification?.decision, verifiedFields: job?.mergeResult?.changes?.map((change) => change.field), preservedConflicts: job?.mergeResult?.conflicts?.length || 0, rejectedClaims: job?.verification?.rejectedClaims?.length || 0, citedSources: job?.proposal?.sources?.map((source) => source.url).filter(Boolean) }} />,
  }];
  return <ControlActivityInspector label="Task activity chain" items={items} />;
}

export function ApiTaskActivity({ entries = [] }) {
  return <ControlActivityInspector label="API task activity chain" items={providerItems(entries)} />;
}
