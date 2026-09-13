# Cloudflare container deployment

The production target is `https://intel.adamboas.com`.

## Architecture

- Cloudflare Workers Assets serves the compiled application at the edge.
- `/api/*` is forwarded to one named Cloudflare Container running the Fastify image.
- PostgreSQL remains external and durable. Container-local disk is never treated as a database.
- Authentication is required in the container. The first successful account claim atomically becomes the singleton Super user.

## Protected prerequisites

The Worker requires one encrypted secret:

- `DATABASE_URL`: externally reachable PostgreSQL connection string with TLS enabled.

Cloudflare API credentials must be supplied through the host-managed secret store. Do not place either credential in shell arguments, `.env` files, Wrangler config, CI logs, or repository secrets committed to source.

## Deploy

1. Build and verify the root-path application: `npm run build:cloudflare`.
2. Add `DATABASE_URL` with Wrangler's masked secret input for `wrangler.container.toml`.
3. Run `npm run container:deploy:cloudflare`.
4. Open `https://intel.adamboas.com` and create the first account in the first-party form.
5. Verify that a second claim returns HTTP 409, then set `ALLOW_FIRST_CLAIM=false` in the container environment as defense in depth.

The existing GitHub Pages release remains the public read-only fallback and does not expose account controls because it has no authenticated API.
