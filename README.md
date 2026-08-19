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
