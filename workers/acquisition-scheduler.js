function endpoint(env, path) {
  return new URL(path, String(env.DBI_APP_ORIGIN || "https://defense-budget-intelligence.pages.dev")).toString();
}

async function run(env) {
  const token = String(env.DBI_SCHEDULER_TOKEN || "");
  if (token.length < 32) throw new Error("DBI_SCHEDULER_TOKEN is not configured");
  const request = (path) => fetch(endpoint(env, path), { method: "POST", headers: { authorization: `Bearer ${token}`, accept: "application/json" } });
  const [acquisitionResponse, eventResponse] = await Promise.all([
    request("/api/v1/system/acquisition-schedule"),
    request("/api/v1/system/event-discovery-schedule"),
  ]);
  const [result, eventDiscovery] = await Promise.all([
    acquisitionResponse.json().catch(() => ({})),
    eventResponse.json().catch(() => ({})),
  ]);
  if (!acquisitionResponse.ok) throw new Error(`Acquisition scheduler endpoint returned ${acquisitionResponse.status}`);
  if (!eventResponse.ok) throw new Error(`Event discovery scheduler endpoint returned ${eventResponse.status}`);
  console.log("Acquisition scheduler completed", {
    keyedWorkspaces: Number(result.keyedWorkspaces || 0),
    dueWorkspaces: Number(result.dueWorkspaces || 0),
    executed: Number(result.executed || 0),
    eventSourcesAttempted: Number(eventDiscovery.sourcesAttempted || 0),
    eventSourcesSucceeded: Number(eventDiscovery.succeeded || 0),
  });
  return { acquisition: result, eventDiscovery };
}

export default {
  async scheduled(_controller, env, context) {
    context.waitUntil(run(env));
  },
  async fetch() {
    return Response.json({ error: "Scheduled execution only" }, { status: 405 });
  },
};
