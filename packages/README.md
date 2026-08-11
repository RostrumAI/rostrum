# packages

Shared libraries (Bun workspaces). Consumed by applications without a build
step — see the repository-layout decision in
[docs/decisions/epic-01/e1-s0-implementation-stack.md](../../docs/decisions/epic-01/e1-s0-implementation-stack.md).

The E1-S0 proof-of-concept `workflow-lib` and `api-client` packages lived
here and were removed after verification (branch history retains them);
E1-03/E1-04 and E1-06 re-create the shared workflow code and typed client.
