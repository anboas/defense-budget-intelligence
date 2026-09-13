import { Container } from "@cloudflare/containers";

export class AppContainer extends Container {
  defaultPort = 8080;
  sleepAfter = "30m";
  pingEndpoint = "/api/healthz";
  enableInternet = true;

  constructor(ctx, env) {
    super(ctx, env);
    this.envVars = {
      DATABASE_URL: env.DATABASE_URL,
      DATABASE_POOL_SIZE: "6",
      DATABASE_SSL: "require",
      DATABASE_SSL_REJECT_UNAUTHORIZED: "true",
      ENABLE_AUTH: "true",
      AUTH_REQUIRE_LOGIN: "true",
      ALLOW_FIRST_CLAIM: env.ALLOW_FIRST_CLAIM || "true",
      AUTH_SECURE_COOKIE: "true",
      ENABLE_WRITES: "false",
      NODE_ENV: "production",
      PORT: "8080",
    };
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) {
      const container = env.APP_CONTAINER.getByName("primary");
      return container.fetch(request);
    }
    return env.ASSETS.fetch(request);
  },
};
