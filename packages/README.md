# packages

Shared libraries (Bun workspaces). Consumed by applications without a build
step.

- `workflow/` — the shared workflow library: the workflow format v1
  document schema, the validator, stable findings, and the digest rules.

- `database/` — Postgres persistence owned end to end: the typed Kysely
  connection factory over postgres.js, the schema types that declare what
  can physically exist in Postgres, the TypeScript migration modules, and
  repositories that own transactions, row locks, optimistic checks, and
  row-to-application mapping. Applications depend on this package one-way;
  it depends on no application, and validation and publication preparation
  stay in `workflow/`.
