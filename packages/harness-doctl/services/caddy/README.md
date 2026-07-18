# Caddy

The per-project `Caddyfile` is **rendered** by `src/render/caddy.ts` from the spec's
service routes (auto-TLS, HSTS + security headers, reverse-proxy to `/auth/*`,
`/rest/*`, and each declared service). It is emitted to the deploy root and mounted
by the compose `caddy` service — Caddy is the only internet-facing process.

This directory holds optional reusable snippets you can `import` into the rendered
Caddyfile (e.g. a stricter CSP, a rate-limit block once the `caddy-ratelimit`
plugin image is built). Nothing here is required for a default deploy.
