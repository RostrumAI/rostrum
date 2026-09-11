# Rostrum

Rostrum is a platform for defining and executing workflows. This repository contains the implementation: shared workflow libraries in `packages/` and runnable applications in `apps/`. Product strategy, planning, human-readable specifications, decisions, and research live in [`RostrumAI/rostrum-dev-docs`](https://github.com/RostrumAI/rostrum-dev-docs).

## Prerequisites

- [Bun](https://bun.sh) 1.x — runtime, package manager, and test runner
- [Docker](https://www.docker.com) — local Postgres for development

## Setup

```bash
bun install
bun run docs:setup
bun run db:up
```

`bun install` creates `node_modules` from the committed `bun.lock`. Use
`bun install --frozen-lockfile` to fail instead of modifying the lockfile.

`bun run docs:setup` clones the independent development-documentation repository
into the ignored `dev-docs/` directory. Running it again leaves an existing
checkout and its local work untouched.

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
| `bun run docs:setup` | Clones the development-documentation repository into `dev-docs/` when absent |
| `bun run db:up` | Starts the local Postgres service |
| `bun run db:down` | Stops the local Postgres service |
| `bun run db:migrate` | Applies pending workflow-database migrations to the `DATABASE_URL` target |

The repository has no build step: Bun runs TypeScript directly. Integration
tests that use Postgres skip with a message when the database is unreachable;
start it with `bun run db:up` first. Continuous integration
(`.github/workflows/ci.yml`) runs the same commands with a Postgres service
container.

## Control API

The Control API is the standalone service process for workflow authoring
operations: draft saves, validation, rewind, and publish. It runs on Bun's
native HTTP server with Hono routing and TypeBox schemas.

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

Configuration is validated against a schema at startup; an invalid value
stops the process and names the offending key. Values come from two layers,
per variable: environment variables override the YAML config file, and keys
absent from both fall back to the documented defaults. Bun loads `.env`
files into the environment automatically.

The YAML file is optional. Set `CONTROL_API_CONFIG` to its path, or place
`apps/control-api/config.yaml` and leave the variable unset. The file is a
flat mapping keyed like the configuration:

```yaml
host: 0.0.0.0
port: 8080
```

| Variable or key | Default | Meaning |
| --- | --- | --- |
| `PORT` / `port` | `3000` | TCP port to bind; use `0` for an ephemeral port |
| `HOST` / `host` | `127.0.0.1` | Address to bind |
| `NODE_ENV` / `nodeEnv` | `development` | One of `development`, `test`, `production`; selects the default log level |
| `LOG_LEVEL` / `logLevel` | `debug` in development and test, `info` in production | One of `trace`, `debug`, `info`, `warning`, `error`, `fatal` |
| `DATABASE_URL` / `databaseUrl` | `postgres://rostrum:rostrum@localhost:5432/rostrum` | Postgres target; the database package's migrations and the Control API's workflow database in `apps/control-api/src/workflows` use it |

Logging uses [LogTape](https://logtape.org/). Records are one JSON object
per line on the console with `time`, `level`, `msg`, and any extra fields.

At the default development level, each request logs a
`request received` record and its response logs a `response sent` record
with `method`, `path`, `status`, and `durationMs`.

### Routes

| Route | Response |
| --- | --- |
| `GET /api/v1/system/health` | `{"status":"ok"}` |
| `GET /api/v1/system/version` | Service name, package version, and the served workflow interface version (`v1`) |
| `GET /openapi.json` | The generated OpenAPI 3.1 document |

Routes live under the `/api/v1` path prefix. A breaking change to the API or
the workflow interface creates a new prefix and leaves existing prefixes
served unchanged. The version route reports the workflow interface version
as the exact-match `v1` token of the workflow interface.

Each route is one feature slice under
`apps/control-api/src/features/`: a slice exports `route`, `schema`, and
`handler`, and the folder layout decides the bound path. For example,
`src/features/system/health.ts` serves `GET /api/v1/system/health`. The
server startup validates every slice against this contract; a slice that
misses it fails startup.

Every error response uses one shape: `{"code","message","findings"}`.

| `code` | Status | Meaning |
| --- | --- | --- |
| `not_found` | 404 | No route matches the request |
| `method_not_allowed` | 405 | The path exists but the method is not allowed; the `Allow` header lists the allowed methods |
| `internal_error` | 500 | The handler failed; the error is logged |

The `findings` array is empty until validation findings are reported with the
workflow operations; its element shape follows the validation findings
contract.

### OpenAPI document

The document at `/openapi.json` is generated code-first from TypeBox schemas
and is OpenAPI 3.1, the same dialect as the workflow interface JSON Schema.
The checked-in copy at `apps/control-api/openapi.json` is regenerated with:

```bash
bun run --filter @rostrum/control-api generate-openapi
```

A test asserts that the served document matches the checked-in copy.

## Layout

| Path | Contents |
| --- | --- |
| `apps/` | Runnable applications; `control-api/` is the Control API process |
| `packages/` | Shared libraries; `workflow/` is the shared workflow library and `database/` owns Postgres persistence |
| `dev-docs/` | Ignored checkout of the independent development-documentation repository |
| `scripts/` | Repository support scripts |
| `tmp/` | Scratch space for proof-of-concept work, excluded from lint and format |

## Documentation

Product strategy, roadmap milestones, technical Epics, implementation plans, human-readable specifications, decisions, and research live in [`RostrumAI/rostrum-dev-docs`](https://github.com/RostrumAI/rostrum-dev-docs). Run `bun run docs:setup` to create an independent, ignored checkout at `dev-docs/`. Commit and push documentation changes from inside that checkout; this repository does not track its commit. Runtime code, tests, migrations, fixtures, generated artifacts, and code-derived API documents remain in this repository.
