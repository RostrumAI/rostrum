# E1-S0 result: Proof-of-concept verification

| Tracking | Value |
| --- | --- |
| Status | Verified — all 14 rows done |
| Source | [Decision e1-s0: Implementation stack, Control API contract, and workflow persistence](../../decisions/epic-01/e1-s0-implementation-stack.md), [E1-S0: Select the implementation stack and workflow database](../../tasks/epic-01/e1-s0-select-implementation-stack.md) |
| Last updated | 2026-08-11 |
| Branch | `epic-1/e1-s0-proof-of-concept` |

> Update 2026-08-11: the toolchain moved from TypeScript 6.0.3 to TypeScript 7.0.2 (native compiler) after this record was verified. The swap was one pin change with zero source or configuration edits; the full check surface (typecheck, tests, lint, peer check) was re-run green on 7.0.2, and the workspace typecheck is roughly 4.5× faster. The decision record now lists TypeScript 7 as the toolchain.

## Proof of concept

The thin proof of concept proves the package, process, and persistence boundaries selected by [Decision e1-s0](../../decisions/epic-01/e1-s0-implementation-stack.md). Each row lists what it verifies, how, and the pass criterion; rows move from Open to Done with an outcome note as the POC runs. Driver transaction support is verified by row 5; revision-check race and publication atomicity *semantics* are not POC material — they are designed by E1-S3 and tested by E1-07.

The POC code is deliberately thin and lives at:

- `packages/workflow-lib/` — workflow schema, `Schema.Compile` validation, findings seam, digest rule
- `apps/control-api/` — Hono app factory, routes, OpenAPI generation, SQL-file migrations, workflow repo (Postgres + in-memory)
- `packages/api-client/` — typed client generated from the served OpenAPI document
- `docker-compose.yml` — local Postgres
- `.github/workflows/ci.yml` — install, typecheck, peer check, lint, tests with a Postgres service container

## Verification runbook

Run the steps below in order on branch `epic-1/e1-s0-proof-of-concept`. Each step lists the command and the expected result; the `#` column maps to the checklist row being verified. Steps that need no database are marked `(no DB)`.

### 0. Setup

```bash
git checkout epic-1/e1-s0-proof-of-concept
bun install
```

### 1. Toolchain peers — row 2 `(no DB)`

```bash
bun run check:peers
```

Expected: `resolved typescript: typescript@7.0.2` and `OK: no installed package requires TypeScript 5.x or 7.x`. A warning about `openapi-typescript`'s declared `^5.x` peer range is the known finding below — it has no TypeScript runtime dependency, and its generated output typechecks under 7.0.2.

### 2. TypeScript 7 + TypeBox 1.x under Bun — rows 1 and 8 `(no DB)`

```bash
bun run check          # tsc --noEmit across all workspaces
bun test packages/workflow-lib
```

Expected: typecheck clean; workflow-lib tests pass (TypeBox type and native JSON Schema both validate through `Schema.Compile`, union/format/additionalProperties behavior, digest known vector). One resolved TypeBox version in the lockfile (the string also appears in peer-dependency declarations of `@standard-community/*`, which is expected):

```bash
bun pm ls --all | grep typebox   # exactly one line: typebox@1.3.12
```

### 3. Local database — rows 5–7

```bash
docker compose up -d --wait postgres   # or: bun run db:up
bun run migrate
```

Expected: container healthy on `localhost:5432`; migrations print `Success: 001_drafts` then `Success: 002_revisions`. Rerunning `bun run migrate` prints nothing (no-op).

### 4. Full test suite — rows 1, 3–14

```bash
bun test
```

Expected: all tests pass (currently 42 tests across 8 files). This covers the socket-free `app.fetch()` harness and the real-process-over-HTTP harness (row 4), driver transactions (row 5), migrations on a scratch database (row 7), publish/retrieve with digest (rows 10, 12), response contract checks (row 11), the served-document/dump parity and schema round-trip (row 3), and SSE streaming (row 13).

### 5. Backup and restore, environment override — row 6

```bash
docker compose exec -T postgres pg_dump -U rostrum -d rostrum > /tmp/rostrum.dump
docker compose exec postgres createdb -U rostrum rostrum_override
docker compose exec -T postgres psql -U rostrum -d rostrum_override < /tmp/rostrum.dump
docker compose exec -T postgres psql -U rostrum -d rostrum_override -c 'SELECT id, version, digest FROM published_versions;'
```

Expected: restore succeeds, tables (`drafts`, `revisions`, `published_versions`, `kysely_migration`) exist, and the rows from the test runs are present. A different target is selected purely by the environment override:

```bash
PORT=3001 DATABASE_URL=postgres://rostrum:rostrum@localhost:5432/rostrum_override \
  bun run --filter @rostrum/control-api start &
curl http://127.0.0.1:3001/api/v1/workflows/wf-dump/versions/1   # serves the restored row
kill %1
```

### 6. Standalone process — rows 9–10

```bash
bun run --filter @rostrum/control-api start &
curl http://127.0.0.1:3000/api/v1/health        # {"status":"ok"}
curl http://127.0.0.1:3000/api/v1/version       # {"service":"rostrum-control-api",...}
curl -X POST http://127.0.0.1:3000/api/v1/workflows -H 'content-type: application/json' -d '{
  "interfaceVersion": "v1", "id": "wf-manual", "name": "Manual",
  "createdAt": "2026-08-10T12:00:00.000Z", "start": "say",
  "steps": [{"id": "say", "type": "task", "next": "done"}, {"id": "done", "type": "result"}]}'
curl http://127.0.0.1:3000/api/v1/workflows/wf-manual/versions/1
```

Expected: the publish returns `201` with `digest`, and retrieval returns the exact JSON submitted. The digest reproduces independently:

```bash
bun -e 'import { workflowDigest } from "@rostrum/workflow-lib"; console.log(workflowDigest({interfaceVersion:"v1",id:"wf-manual",name:"Manual",createdAt:"2026-08-10T12:00:00.000Z",start:"say",steps:[{id:"say",type:"task",next:"done"},{id:"done",type:"result"}]}))'
```

Compare with the digest in the publish response. Graceful shutdown: `kill %1` and observe the JSON-line logs `shutdown started` and `shutdown complete` before exit 0.

### 7. Response contract checking — row 11

```bash
docker run --rm --network host schemathesis/schemathesis:stable run http://127.0.0.1:3000/openapi.json
```

Expected: all generated cases pass, zero failures. Then seed a violation and confirm the same run fails:

```bash
PORT=3002 POC_SEED_VIOLATION=1 bun run --filter @rostrum/control-api start &
docker run --rm --network host schemathesis/schemathesis:stable run http://127.0.0.1:3002/openapi.json
kill %1
```

Expected: failures reporting `Additional properties are not allowed ('seeded' was unexpected)` against `/api/v1/health`.

### 8. Typed client — row 12 `(no DB for the typecheck part)`

```bash
bun run gen:client    # regenerates packages/api-client/src/generated.ts from the doc
bun run check         # typechecks the client, including negative fixtures
```

Expected: typecheck clean. The negative fixtures in `packages/api-client/src/typecheck-fixtures.ts` assert that wrong paths, parameters, and bodies fail; removing any `@ts-expect-error` there makes `bun run check` fail. The live client call is covered by the test suite (row 4 step), which publishes and retrieves through `ControlApiClient`.

### 9. SSE representation — row 13

```bash
curl -N http://127.0.0.1:3000/api/v1/events
curl http://127.0.0.1:3000/openapi.json | python3 -m json.tool | grep -A2 text/event-stream
```

Expected: three events (`started`, `heartbeat`, `complete`) stream over HTTP with `content-type: text/event-stream`, and the OpenAPI document renders the media type under `/api/v1/events`. The SSE schema describes the wire shape (`event` name + raw `data` string) because conformance tooling validates each event against it.

### 10. OpenAPI document — row 3 `(no DB)`

```bash
curl http://127.0.0.1:3000/openapi.json | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d["openapi"]); print(d["components"]["schemas"]["Workflow"]["properties"]["createdAt"]); print(d["components"]["schemas"]["Workflow"]["additionalProperties"]); print(len(d["components"]["schemas"]["Workflow"]["properties"]["steps"]["items"]["anyOf"]))'
```

Expected: `3.1.0`, `{'format': 'date-time', 'type': 'string'}`, `False`, `2`. The parity test (served document equals `apps/control-api/openapi.json`) runs in the suite.

### 11. Continuous integration — row 4

```bash
git push -u origin epic-1/e1-s0-proof-of-concept
```

Expected: the CI workflow (`install` → `typecheck` → `check:peers` → `lint` → `test` with a Postgres service container) passes on GitHub. The same commands run locally in steps 1–4.

### Cleanup

```bash
kill %1 2>/dev/null; docker compose exec postgres dropdb -U rostrum rostrum_override
docker compose down     # keeps the named volume; add -v to remove data
```

## Checklist outcomes

| # | Verify | How | Pass criterion | Status |
| --- | --- | --- | --- | --- |
| 1 | TypeBox 1.x and TypeScript 6.x under Bun | Pin `typescript@6.x` and `typebox@^1.3`; run `bun run` and `bun test`; run `tsc --noEmit`; validate one TypeBox type and one native JSON Schema with `Schema.Compile` | Build, tests, and typecheck pass; both validations succeed without TypeScript 5.x fallbacks | Done — typescript@7.0.2 + typebox@1.3.12 (moved from 6.0.3 after verification; see update note); `bun run check` clean across all workspaces; `Schema.Compile` validates a `Type.Object` and a hand-written JSON Schema in workflow-lib tests; `typebox/schema` accepts both, `date-time` format enforced |
| 2 | Stack toolchain under TypeScript 6 | Install `hono-openapi@1.3` with its Standard Schema peers, `openapi-typescript`, and Biome | No package in the stack requires TypeScript 5.x or 7.x | Done — `bun run check:peers` reports no package requiring 5.x/7.x. Finding: `openapi-typescript@7.13.0` declares peer `typescript ^5.x` but has no TypeScript runtime dependency; its generated output typechecks under 7.0.2 (rows 8/12). Kysely 0.29 requires `kysely/migration` imports and the `kysely-postgres-js` bridge for postgres.js |
| 3 | OpenAPI generation from TypeBox schemas | Describe one route with `hono-openapi` and a TypeBox schema; fetch the generated document | Document is OpenAPI 3.1; `additionalProperties: false`, `format: date-time`, and unions survive; the schema round-trips unchanged | Done — document is 3.1.0; components carry the TypeBox schemas verbatim (round-trip test compares deep equality); unions render as `anyOf`; served document equals the checked-in dump (parity test) |
| 4 | Test harness patterns | Integration test via `app.fetch()` without a socket; second test boots the real process over HTTP | Both patterns run in CI and pass the same assertions | Done — `test/app.test.ts` (socket-free, in-memory repo) and `test/server.test.ts` (spawned process, Postgres repo) share the same assertions; both run in the CI workflow |
| 5 | Postgres driver on Bun | Connect, run prepared statements, and commit and roll back a transaction with `postgres` (postgres.js) | Connection and transaction control work cleanly under Bun | Done — driver tests connect, prepared-insert into a temp table, `sql.begin` commit and rollback |
| 6 | Local development database | Start Postgres with Docker Compose using the documented command; connect with a custom `DATABASE_URL` override | Fresh `docker compose up` produces a reachable database; the environment override connects to a different target; a `pg_dump` backup and restore round-trips | Done — `docker compose up -d --wait postgres` healthy; second instance on `rostrum_override` served the restored rows; `pg_dump`/restore round-tripped all tables and 5 published rows |
| 7 | Migration tool | Apply a two-step migration (drafts, then revisions) and roll it back with Kysely `Migrator` using SQL-file migrations | Fresh database migrates to the correct schema; rerun is a no-op; down-migration works | Done — `001_drafts` + `002_revisions` (revisions and `published_versions`) via `SqlFileMigrationProvider` on a scratch database; rerun no-op; down rolls back step 2; up restores |
| 8 | Package boundary | Create Bun workspaces with `packages/workflow-lib` imported by `apps/control-api` | Workspace dependency resolves; a shared type crosses the boundary; `bun.lock` contains one TypeBox version | Done — `@rostrum/workflow-lib` consumed by both apps and `packages/api-client`; the `Workflow` type is derived from the TypeBox schema and crosses into the repo and client; one `typebox` entry in the lockfile |
| 9 | Process boundary | Start the Control API standalone; health and version routes; graceful shutdown on SIGTERM; configuration from environment; structured logs | Independent process starts and stops cleanly with documented responses | Done — process logs `listening` with the bound port; health/version respond; SIGTERM → exit 0 after `shutdown started`/`shutdown complete` JSON-line logs; config (`PORT`, `HOST`, `DATABASE_URL`, `LOG_LEVEL`) from environment; unhandled errors logged via `app.onError` |
| 10 | Published-workflow retrieval | Publish a workflow and retrieve it by version | Retrieval returns the exact published JSON; the digest reproduces | Done — publish returns the stored digest and retrieval returns the exact JSON; the digest known vector `d66633da…` matches rows stored by the tests, and an independent recomputation matches the API-returned digest |
| 11 | Response contract checking | Assert handler responses with `Schema.Compile`; run Schemathesis against the running service | Seeded schema violations fail; a clean service passes | Done — contract tests pass clean responses and fail seeded ones (missing field, wrong type, undocumented field); Schemathesis: clean service 1012/1012 cases pass, seeded service reports the `seeded` additional-property violation. Schemathesis also caught three real defects, now fixed: non-numeric version params 500'd (now 404), unknown methods fell through to 404 instead of 405 with an `Allow` header, and `\u0000` in strings 500'd at the storage layer (now a schema `pattern` → 400) |
| 12 | Typed client | Generate client types from the served OpenAPI document; call the API with a typed client | Wrong paths, parameters, or bodies fail typechecking | Done — `openapi-typescript` generates `packages/api-client/src/generated.ts` from the document; negative fixtures with `@ts-expect-error` prove wrong paths/params/bodies fail (removing a directive breaks `bun run check`); live publish/retrieve through `ControlApiClient` round-trips |
| 13 | SSE representation | Describe an event-stream route in `hono-openapi` | The route renders in the OpenAPI document and a stream endpoint works; if unrepresentable, the extension point is documented | Done — `text/event-stream` renders under `/api/v1/events` and the endpoint streams three events; the schema describes the wire shape (`event` + raw `data` string) so Schemathesis can validate each event |
| 14 | Findings seam | Map a validation error to the stable finding shape (code and path) | The mapping returns stable codes for the validator and E1-S2 | Done — `typebox.<keyword>` codes from JSON Schema keywords (`required`, `additionalProperties`, `format`, `pattern`, `anyOf`); `additionalProperties` findings point at the offending key (`/steps/0/extra`); paths are instancePaths; all POC findings are `blocking: true` pending E1-S2 |

## Findings recorded

- **`openapi-typescript` peer range is stale** (`typescript ^5.x`): declared only; no TypeScript runtime dependency; generated output typechecks under 7.0.2. Revisit when the package updates its peer range.
- **PostgreSQL cannot store NUL bytes**: workflow strings with `\u0000` are valid JSON but not storable in `jsonb`. The workflow schema now carries `pattern: "^[^\\u0000]*$"`, so the constraint is part of the public contract and returns `typebox.pattern` findings.
- **Kysely 0.29 migration APIs moved** to `kysely/migration`; postgres.js integration requires the `kysely-postgres-js` dialect. Both are pinned in the workspace manifest; the POC provider wraps SQL files with `-- UP` / `-- DOWN` sections.
- **SSE schema shape**: conformance tooling validates each event's `event:` name and raw `data:` string against the documented schema, so the media-type schema describes the wire shape, not a parsed payload.
- **Digest rule is provisional**: SHA-256 over canonical (sorted-key, compact) JSON, until E1-S3 decides publication identity.
- **Finding shape is provisional**: `{ code, message, blocking, path }` with `blocking: true` for everything, until E1-S2 defines the full findings contract.
