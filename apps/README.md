# apps

Runnable applications (Bun workspaces). Each app is independently runnable
and may share code from `packages/` — see the repository-layout decision in
[docs/decisions/epic-01/e1-s0-implementation-stack.md](../../docs/decisions/epic-01/e1-s0-implementation-stack.md).

- `control-api/` — the standalone Control API process: versioned `/api/v1`
  routes, one error shape, code-first OpenAPI 3.1 documentation, and
  structured logging. See the Control API section of the root README for run
  commands and conventions.
