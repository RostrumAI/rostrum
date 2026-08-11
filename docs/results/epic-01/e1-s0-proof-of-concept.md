# E1-S0 result: Proof-of-concept verification

| Tracking | Value |
| --- | --- |
| Status | Open — no rows verified |
| Source | [Decision e1-s0: Implementation stack, Control API contract, and workflow persistence](../../decisions/epic-01/e1-s0-implementation-stack.md), [E1-S0: Select the implementation stack and workflow database](../../tasks/epic-01/e1-s0-select-implementation-stack.md) |
| Last updated | 2026-08-10 |

## Proof of concept

The thin proof of concept proves the package, process, and persistence boundaries selected by [Decision e1-s0](../../decisions/epic-01/e1-s0-implementation-stack.md). Each row lists what it verifies, how, and the pass criterion; rows move from Open to Done with an outcome note as the POC runs. Driver transaction support is verified by row 5; revision-check race and publication atomicity *semantics* are not POC material — they are designed by E1-S3 and tested by E1-07.

| # | Verify | How | Pass criterion | Status |
| --- | --- | --- | --- | --- |
| 1 | TypeBox 1.x and TypeScript 6.x under Bun | Pin `typescript@6.x` and `typebox@^1.3`; run `bun run` and `bun test`; run `tsc --noEmit`; validate one TypeBox type and one native JSON Schema with `Schema.Compile` | Build, tests, and typecheck pass; both validations succeed without TypeScript 5.x fallbacks | Open |
| 2 | Stack toolchain under TypeScript 6 | Install `hono-openapi@1.3` with its Standard Schema peers, `openapi-typescript`, and Biome | No package in the stack requires TypeScript 5.x or 7.x | Open |
| 3 | OpenAPI generation from TypeBox schemas | Describe one route with `hono-openapi` and a TypeBox schema; fetch the generated document | Document is OpenAPI 3.1; `additionalProperties: false`, `format: date-time`, and unions survive; the schema round-trips unchanged | Open |
| 4 | Test harness patterns | Integration test via `app.fetch()` without a socket; second test boots the real process over HTTP | Both patterns run in CI and pass the same assertions | Open |
| 5 | Postgres driver on Bun | Connect, run prepared statements, and commit and roll back a transaction with `postgres` (postgres.js) | Connection and transaction control work cleanly under Bun | Open |
| 6 | Local development database | Start Postgres with Docker Compose using the documented command; connect with a custom `DATABASE_URL` override | Fresh `docker compose up` produces a reachable database; the environment override connects to a different target; a `pg_dump` backup and restore round-trips | Open |
| 7 | Migration tool | Apply a two-step migration (drafts, then revisions) and roll it back with Kysely `Migrator` using SQL-file migrations | Fresh database migrates to the correct schema; rerun is a no-op; down-migration works | Open |
| 8 | Package boundary | Create Bun workspaces with `packages/workflow-lib` imported by `apps/control-api` | Workspace dependency resolves; a shared type crosses the boundary; `bun.lock` contains one TypeBox version | Open |
| 9 | Process boundary | Start the Control API standalone; health and version routes; graceful shutdown on SIGTERM; configuration from environment; structured logs | Independent process starts and stops cleanly with documented responses | Open |
| 10 | Published-workflow retrieval | Publish a workflow and retrieve it by version | Retrieval returns the exact published JSON; the digest reproduces | Open |
| 11 | Response contract checking | Assert handler responses with `Schema.Compile`; run Schemathesis against the running service | Seeded schema violations fail; a clean service passes | Open |
| 12 | Typed client | Generate client types from the served OpenAPI document; call the API with a typed client | Wrong paths, parameters, or bodies fail typechecking | Open |
| 13 | SSE representation | Describe an event-stream route in `hono-openapi` | The route renders in the OpenAPI document and a stream endpoint works; if unrepresentable, the extension point is documented | Open |
| 14 | Findings seam | Map a validation error to the stable finding shape (code and path) | The mapping returns stable codes for the validator and E1-S2 | Open |
