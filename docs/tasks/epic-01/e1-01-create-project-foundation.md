# E1-01: Create the repository and quality foundation

| Tracking | Value |
| --- | --- |
| Status | Done |
| Last updated | 2026-08-19 |
| Picked up | Yes |
| Owner | Thomas |
| Blocked by | [E1-S0](e1-s0-select-implementation-stack.md) |

## Task

This task creates the repository structure selected by [E1-S0](../../decisions/epic-01/e1-s0-implementation-stack.md). It adds:

- Reproducible dependency management with Bun and one `bun.lock`.
- Build, format, lint, and test commands: TypeScript 7 with `tsc --noEmit`, Biome for lint and format, and `bun test` as the test runner.
- Unit and integration test harnesses that can run locally with a Docker Compose Postgres service via `DATABASE_URL`.
- Continuous integration on GitHub Actions (install, typecheck, tests, lint) with a Postgres service container.
- Initial Bun workspaces `apps/` for runnable applications and `packages/` for shared libraries, including initial packages or modules for shared workflow code and the Control API — with no build step and the Control API and future daemon independently runnable while sharing workflow code.

## End state

- A new contributor can set up, build, check, and test every initial package with documented commands.

## Why

- Every Epic 1 implementation task needs the same repository and quality conventions.

## Blocks

- [E1-02: Create the standalone Control API process](e1-02-build-control-api-foundation.md)
- [E1-04: Implement the workflow library and validator](e1-04-implement-workflow-library-and-validator.md)

## Acceptance criteria

- The selected repository structure (`apps/` + `packages/` Bun workspaces) is present and documented.
- Dependency versions are reproducible via one lockfile.
- Documented commands build, format, lint, and test every initial application and package.
- Unit and integration test harnesses can run locally, including with the Docker Compose Postgres via environment overrides.
- Continuous integration runs the same required checks with a Postgres service.
- A new contributor can complete the documented setup without undocumented steps.
