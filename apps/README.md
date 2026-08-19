# apps

Runnable applications (Bun workspaces). Each app is independently runnable
and may share code from `packages/` — see the repository-layout decision in
[docs/decisions/epic-01/e1-s0-implementation-stack.md](../../docs/decisions/epic-01/e1-s0-implementation-stack.md).

- `control-api/` — the Control API process. E1-01 establishes the package
  and the socket-free test harness; E1-02 adds startup and shutdown,
  configuration, structured logging, health and version routes, versioned
  routing, and the error shape.
