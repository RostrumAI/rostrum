# apis

Backend services (Bun workspaces). Each service is independently startable
and may share code from `packages/`. User-facing applications live in `apps/`.

- `control-api/` — the caller-facing Control API process: `/api` routes, one
  error shape, code-first OpenAPI 3.1 documentation, and structured logging.
  It also aggregates readiness for its own database and the daemon.
- `daemon/` — the private workflow-execution process: authenticated `/api`
  routes, its own generated contract, and direct TLS or a same-host
  reverse proxy.

See the Services section of the root README for run commands, the shared
configuration contract, and the daemon boundary.
