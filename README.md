# Rostrum

Rostrum is a platform for defining and executing workflows. This repository
contains the codebase: shared workflow libraries in `packages/`, runnable
applications in `apps/`, and the research, strategy, decision, result, and
task records in `docs/`.

## Prerequisites

- [Bun](https://bun.sh) 1.x — runtime, package manager, and test runner
- [Docker](https://www.docker.com) — local Postgres for development

## Setup

```bash
bun install
bun run db:up
```

`bun install` creates `node_modules` from the committed `bun.lock`. Use
`bun install --frozen-lockfile` to fail instead of modifying the lockfile.

`bun run db:up` starts the Postgres service defined in `docker-compose.yml`
and waits until it is healthy. The service is reachable at
`postgres://rostrum:rostrum@localhost:5432/rostrum`; override the target with
the `DATABASE_URL` environment variable.

## Commands

| Command | What it does |
| --- | --- |
| `bun run check` | Typechecks every workspace package with `tsc --noEmit` |
| `bun run format` | Formats all files with Biome |
| `bun run lint` | Lints all files with Biome |
| `bun run test` | Runs unit and integration tests with `bun test` |
| `bun run db:up` | Starts the local Postgres service |
| `bun run db:down` | Stops the local Postgres service |

The repository has no build step: Bun runs TypeScript directly. Integration
tests that use Postgres skip with a message when the database is unreachable;
start it with `bun run db:up` first. Continuous integration
(`.github/workflows/ci.yml`) runs the same commands with a Postgres service
container.

## Control API

The Control API is the standalone service process for workflow authoring
operations, which arrive in [E1-06](docs/tasks/epic-01/e1-06-add-control-api-workflow-operations.md).
It runs on Bun's native HTTP server with Hono routing ([Decision E1-S0](docs/decisions/epic-01/e1-s0-implementation-stack.md)).

### Run

Start the Control API:

```bash
bun run --filter @rostrum/control-api start
```

The `dev` script restarts the process when source files change:

```bash
bun run --filter @rostrum/control-api dev
```

The process stops on SIGINT or SIGTERM: it stops accepting connections and
logs `shutdown started` and `shutdown complete` before exiting 0.

### Configuration

The process reads configuration from environment variables:

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | `3000` | TCP port to bind; use `0` for an ephemeral port |
| `HOST` | `127.0.0.1` | Address to bind |
| `LOG_LEVEL` | `info` | One of `debug`, `info`, `warn`, `error` |
| `DATABASE_URL` | `postgres://rostrum:rostrum@localhost:5432/rostrum` | Postgres target; the Control API does not open a connection until storage arrives in [E1-07](docs/tasks/epic-01/e1-07-add-workflow-draft-version-storage.md) |

Logs are one JSON object per line with `time`, `level`, `msg`, and any extra
fields.

### Routes

| Route | Response |
| --- | --- |
| `GET /api/v1/health` | `{"status":"ok"}` |
| `GET /api/v1/version` | Service name, package version, and the served workflow interface version (`v1`) |
| `GET /api/v1/events` | Server-Sent Events stream, the transport for future subscriptions |
| `GET /openapi.json` | The generated OpenAPI 3.1 document |

Routes live under the `/api/v1` path prefix. A breaking change to the API or
the workflow interface creates a new prefix and leaves existing prefixes
served unchanged. The version route reports the workflow interface version
as the exact-match token `v1` ([Decision E1-S1](docs/decisions/epic-01/e1-s1-workflow-interface-v1.md)).

Every error response uses one shape: `{"code","message","findings"}`.

| `code` | Status | Meaning |
| --- | --- | --- |
| `not_found` | 404 | No route matches the request |
| `method_not_allowed` | 405 | The path exists but the method is not allowed; the `Allow` header lists the allowed methods |
| `internal_error` | 500 | The handler failed; the error is logged |

The `findings` array is empty until validation findings are reported with the
workflow operations (E1-06); the finding element shape is finalized by
[E1-S2](docs/tasks/epic-01/e1-s2-define-validation-behavior.md).

### OpenAPI document

The document at `/openapi.json` is generated code-first from TypeBox schemas
and is OpenAPI 3.1, the same dialect as the workflow interface JSON Schema.
The checked-in copy at `apps/control-api/openapi.json` is regenerated with:

```bash
bun run --filter @rostrum/control-api dump-openapi
```

A test asserts that the served document matches the checked-in copy.

## Layout

| Path | Contents |
| --- | --- |
| `apps/` | Runnable applications; `control-api/` is the Control API process |
| `packages/` | Shared libraries; `workflow/` is the shared workflow library |
| `docs/` | Research, strategy, epics, decisions, results, and tasks |
| `scripts/` | One-off repository scripts |
| `tmp/` | Scratch space for proof-of-concept work, excluded from lint and format |

## Documentation

Start with `docs/README.md` for the document flow, and
`docs/decisions/epic-01/e1-s0-implementation-stack.md` for the implementation
stack decisions.
