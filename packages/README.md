# packages

Shared libraries (Bun workspaces). Consumed by applications without a build
step — see the repository-layout decision in
[docs/decisions/epic-01/e1-s0-implementation-stack.md](../../docs/decisions/epic-01/e1-s0-implementation-stack.md).

- `workflow/` — the shared workflow library. E1-01 establishes the package
  boundary and toolchain; E1-03 and E1-04 add the workflow interface v1
  schema, the validator, stable findings, and the digest rules.

- `database/` — Postgres persistence owned end to end: the typed Kysely
  connection factory over postgres.js, the schema types that declare what
  can physically exist in Postgres, the TypeScript migration modules, and
  repositories that own transactions, row locks, optimistic checks, and
  row-to-application mapping. Applications depend on this package one-way;
  it depends on no application, and validation and publication preparation
  stay in `workflow/`.
