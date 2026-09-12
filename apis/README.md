# apis

Backend services (Bun workspaces). Each service is independently startable
and may share code from `packages/`. User-facing applications live in `apps/`.

- `control-api/` — the standalone Control API process: `/api` routes, one
  error shape, code-first OpenAPI 3.1 documentation, and structured logging.
  See the Control API section of the root README for run commands and
  conventions.
