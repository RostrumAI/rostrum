# apps

Runnable applications (Bun workspaces). Each app is independently runnable
and may share code from `packages/`.

- `control-api/` — the standalone Control API process: `/api`
  routes, one error shape, code-first OpenAPI 3.1 documentation, and
  structured logging. See the Control API section of the root README for run
  commands and conventions.
