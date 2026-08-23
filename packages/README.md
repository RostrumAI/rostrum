# packages

Shared libraries (Bun workspaces). Consumed by applications without a build
step — see the repository-layout decision in
[docs/decisions/epic-01/e1-s0-implementation-stack.md](../../docs/decisions/epic-01/e1-s0-implementation-stack.md).

- `workflow/` — the shared workflow library. E1-01 establishes the package
  boundary and toolchain; E1-03 and E1-04 add the workflow interface v1
  schema, the validator, stable findings, and the digest rules.

- `storage/` — persistence infrastructure: one typed Kysely connection
  factory over postgres.js and a migration runner for TypeScript migration
  modules. The package stores anything and names no tables; each
  application owns its schema types, migrations, and repositories next to
  the code that uses them (the workflow store lives in `apps/control-api`).
