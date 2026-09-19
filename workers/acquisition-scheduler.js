function endpoint(env) {
  return new URL("/api/v1/system/acquisition-schedule", String(env.DBI_APP_ORIGIN || "https://defense-budget-intelligence.pages.dev")).toString();
}

async function run(env) {
  const token = String(env.DBI_SCHEDULER_TOKEN || "");
  if (token.length < 32) throw new Error("DBI_SCHEDULER_TOKEN is not configured");
  const response = await fetch(endpoint(env), {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, accept: "application/json" },
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Acquisition scheduler endpoint returned ${response.status}`);
  console.log("Acquisition scheduler completed", {
    keyedWorkspaces: Number(result.keyedWorkspaces || 0),
    dueWorkspaces: Number(result.dueWorkspaces || 0),
    executed: Number(result.executed || 0),
  });
  return result;
}

export default {
  async scheduled(_controller, env, context) {
    context.waitUntil(run(env));
  },
  async fetch() {
    return Response.json({ error: "Scheduled execution only" }, { status: 405 });
  },
};
