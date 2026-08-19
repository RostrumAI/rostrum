# E1-01 implementation plan

Working plan for [E1-01: Create the repository and quality foundation](../../docs/tasks/epic-01/e1-01-create-project-foundation.md), constrained by [E1-S0 decision: Implementation stack, Control API contract, and workflow persistence](../../docs/decisions/epic-01/e1-s0-implementation-stack.md). The E1-S0 proof-of-concept runbook ([result record](../../docs/results/epic-01/e1-s0-proof-of-concept.md)) is the acceptance recipe for re-implementation.

## What E1-01 delivers

A new contributor can, with documented commands and no undocumented steps, set up, typecheck, format, lint, and test every initial package: `packages/workflow` and `apps/control-api`. Continuous integration runs the same checks. Product behavior stays out of scope: the workflow library content is E1-04's, the real Control API process is E1-02's, and persistence migrations are E1-07's. E1-01 creates the seams those tasks build on.

## Current repository state

Verified 2026-08-19 on `main`:

- Workspace root exists and is tracked: `package.json` (workspaces `apps/*`, `packages/*`), `bun.lock`, `tsconfig.json` (base, `files: []`), `biome.json`, `docker-compose.yml` (Postgres 17 service, healthcheck, named volume), `.gitignore`, `apps/README.md`, `packages/README.md`, `scripts/README.md`, `AGENTS.md`.
- Root scripts: `check` is a placeholder echo ("arrives with E1-01"); `test` (`bun test`), `lint`/`lint:fix` (`biome check`), `format` (`biome format --write`), `db:up`/`db:down` exist.
- Root deps: `typescript@^7.0.2`, `@biomejs/biome@^2.5.7`, `@types/bun@^1.3.14`, `typebox@^1.3.12`, `json-source-map@^0.6.1`.
- Directory skeletons `packages/workflow/`, `apps/control-api/`, `apps/executor-stub/` exist with empty `src/`/`test/` and untracked stale `dist/` compiled output. None of the `src/`, `test/`, or `dist/` content is git-tracked; only the README files are.
- No `.github/` exists; no root `README.md` exists.

## Decisions for this task

| Topic | Decision | Reason |
| --- | --- | --- |
| Package names | `@rostrum/workflow`, `@rostrum/control-api` | Match the existing skeleton directories; the POC's `@rostrum/workflow-lib` name was POC-only and the runbook commands in the result record are history, not product code. |
| Debris | Delete untracked `dist/` output in `packages/workflow/`, `apps/control-api/`, `apps/executor-stub/`; delete the `apps/executor-stub/` skeleton | POC-era leftovers, not part of any Epic 1 task; no build step exists (Bun runs TypeScript directly), so `dist/` has no source. Keep the empty `src/`/`test/` directories that E1-02/E1-04 own. |
| Build command | No build step. The documented "build" gate is `bun run check` (workspace-wide `tsc --noEmit`) | E1-S0: "one `bun.lock` and no build step". |
| Root `check` script | Replace the placeholder with `bun run --filter "*" typecheck`; each package defines a `typecheck` script (`tsc --noEmit`) extending the root tsconfig | Restores the POC's `bun run check` surface. |
| Test runner | `bun test`, root plus per-package `test` scripts | E1-S0 assumption verified by the POC. |
| Lint/format | Keep Biome as configured; CI runs `biome check .` (no `--write`), local `lint`/`format` unchanged | E1-S0. |
| Integration harness | Socket-free `app.fetch()` tests in `apps/control-api/test/`; one DB-backed smoke test proving the Postgres seam; Postgres service container in CI from day one | POC row 4 pattern; E1-S0 pins `postgres` (postgres.js). |
| `check:peers` | Do not re-create | One-off POC verification; reproducible deps come from the committed `bun.lock` and `bun install --frozen-lockfile` in CI. |
| CI runner | `.github/workflows/ci.yml`: install → `check` → `lint` → `test`, with a `postgres:17-alpine` service container | E1-S0; matches the POC workflow. |
| New-contributor docs | New root `README.md` with prerequisites and the exact command sequence; update `apps/README.md`/`packages/README.md` wording | Acceptance criterion 6; the current READMEs describe pre-E1-01 state ("E1-01 re-creates"). |

## Target structure

```
.
├── README.md                      # setup + command runbook (new)
├── package.json                   # root scripts updated (check, test, lint, format, db:*)
├── bun.lock                       # committed, updated by bun install
├── tsconfig.json                  # base, unchanged
├── biome.json                     # unchanged
├── docker-compose.yml             # unchanged
├── .github/workflows/ci.yml       # new
├── apps/
│   ├── README.md                  # updated
│   └── control-api/
│       ├── package.json           # @rostrum/control-api (new)
│       ├── tsconfig.json          # extends root (new)
│       ├── src/
│       │   └── app.ts             # minimal Hono app factory (new)
│       └── test/
│           └── app.test.ts        # socket-free harness + DB smoke (new)
└── packages/
    ├── README.md                  # updated
    └── workflow/
        ├── package.json           # @rostrum/workflow (new)
        ├── tsconfig.json          # extends root (new)
        ├── src/
        │   └── index.ts           # package entry (new)
        └── test/
            └── index.test.ts      # unit harness smoke (new)
```

## Steps

1. **Clean debris.** Delete untracked `dist/` in `packages/workflow/`, `apps/control-api/`, `apps/executor-stub/`; delete `apps/executor-stub/` (empty skeleton, no task owns it). Confirm with `git status` that only intended files are touched.

2. **Create `packages/workflow` package.** Add `package.json` (`@rostrum/workflow`, ESM, `exports: "./src/index.ts"`, scripts `typecheck`/`test`) and `tsconfig.json` extending the root base with an `include` for `src`/`test`. Add a minimal `src/index.ts` (package entry — a compile-verified surface for E1-04 to fill) and `test/index.test.ts` proving the unit harness (one `bun:test` case, no DB).

3. **Create `apps/control-api` package.** Add `package.json` (`@rostrum/control-api`, dependency `hono`, `postgres` pinned now as the persistence seam, scripts `typecheck`/`test`/`start` minimal) and `tsconfig.json`. Add `src/app.ts` exporting a `createApp()` Hono factory with a trivial route (the seam E1-02 replaces with real foundation routes). Add `test/app.test.ts` exercising the factory through `app.fetch()` (no socket), plus one DB-gated smoke test that connects with `postgres` to `DATABASE_URL` and runs a trivial query, skipped with a clear message when the database is not reachable.

4. **Wire root scripts.** Replace the `check` placeholder with `bun run --filter "*" typecheck`. Keep `test`, `lint`, `lint:fix`, `format`, `db:up`, `db:down`. Run `bun install` so `bun.lock` records the new workspace manifests and pinned deps.

5. **Add CI workflow.** `.github/workflows/ci.yml`, one job on `ubuntu-latest`: `oven-sh/setup-bun` + `bun install --frozen-lockfile`; then `bun run check`, `bun run lint`, `bun run test` with a `postgres:17-alpine` service container (healthcheck `pg_isready`), `DATABASE_URL` matching the compose defaults. Same commands as local; this is the "same required checks" criterion.

6. **Write contributor docs.** Root `README.md`: prerequisites (Bun, Docker), then the exact sequence `bun install`, `bun run db:up`, `bun run check`, `bun run lint`, `bun run format`, `bun run test`; what each command does; the no-build-step note; a layout map to the workspace decision. Update `apps/README.md` and `packages/README.md` from "E1-01 re-creates" to current state.

## Acceptance mapping

| Criterion | How met | Proof |
| --- | --- | --- |
| Selected repository structure present and documented | Workspace layout per E1-S0; root README + package READMEs | `git status` shows tracked structure; README renders |
| Dependency versions reproducible | Committed `bun.lock`; `bun install --frozen-lockfile` in CI and documented locally | CI install step passes; fresh `rm -rf node_modules && bun install --frozen-lockfile` succeeds |
| Documented commands build, format, lint, test every package | `check`/`lint`/`format`/`test` scripts cover both workspaces via `--filter` | Each command runs green locally and in CI |
| Unit and integration harnesses run locally | `bun test` runs `packages/workflow` unit tests and `apps/control-api` `app.fetch()` + DB smoke | Local `bun run test` with `bun run db:up` passes |
| CI runs the same required checks | Workflow runs install/check/lint/test with Postgres service | Push to origin triggers a green run |
| New contributor setup has no undocumented steps | README lists prerequisites and every command | Walk the README sequence on a clean checkout |

## Verification runbook

On the E1-01 branch, in order:

```bash
bun install                       # updates bun.lock; workspace manifests resolve
bun run check                     # tsc --noEmit across packages/workflow and apps/control-api; zero errors
bun run lint                      # biome check . ; no findings
bun run format                    # biome format --write . ; stable (re-run shows no diff)
bun run db:up                     # postgres:17-alpine healthy on localhost:5432
bun run test                      # unit tests, socket-free harness, DB smoke all pass
bun test                          # same suite via the raw runner
```

Then push and confirm the CI workflow (install → check → lint → test with the Postgres service container) passes on GitHub. Confirm `bun install --frozen-lockfile` succeeds on a clean checkout to prove lockfile reproducibility.

## Out of scope (owned by later tasks)

- Workflow library behavior (validation, findings, digest): E1-04, blocked by this task.
- Real Control API process (startup/shutdown, config, logging, health/version, versioned routing, error shape, generated docs): E1-02, blocked by this task.
- Draft/version/published storage and migrations (Kysely Migrator, SQL files): E1-07.
- Workflow interface v1 public JSON Schema: E1-03.
- Typed API client (`packages/api-client`) and `gen:client`: E1-06.
- Peer-range checks and Schemathesis conformance: POC-era verification; conformance returns in E2-07/E3-08.

## Risks and notes

- TypeScript 7's programmatic API is unstable, but this task only runs `tsc --noEmit` (E1-S0 caveat); no tooling here consumes the API.
- `openapi-typescript` declares a stale `typescript ^5.x` peer; irrelevant until E1-06 generates the client.
- DB smoke test skips (with a message) when Postgres is unreachable, so `bun test` alone does not fail for contributors who skipped `db:up`; CI always provides the service container, so CI still exercises it. Document `db:up` as a prerequisite in the README.
- `json-source-map` at root is unused by E1-01; keep the pin, remove when E1-04 decides its findings mapping (E1-S2) does not need it.
