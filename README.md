# Rostrum

Rostrum is a platform for defining and executing workflows. This repository contains the implementation: shared libraries in `packages/`, backend services in `apis/`, and user-facing applications in `apps/`. Product strategy, planning, human-readable specifications, decisions, and research live in [`RostrumAI/rostrum-dev-docs`](https://github.com/RostrumAI/rostrum-dev-docs).

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
`postgres://rostrum:rostrum@127.0.0.1:5432/rostrum`.

The development service serves plaintext on loopback, while the database layer
defaults to verified TLS. Local commands therefore declare the loopback
plaintext exception explicitly:

```bash
export DATABASE_URL=postgres://rostrum:rostrum@127.0.0.1:5432/rostrum
export DATABASE_TLS_MODE=disable
export ALLOW_INSECURE_LOCAL=true
export NODE_ENV=development
bun run db:migrate
```

Use the literal `127.0.0.1`: the exception accepts an IP literal and refuses a
DNS name such as `localhost`. A remote database keeps `DATABASE_TLS_MODE` at
its default of `verify-full`; `disable` and `ALLOW_INSECURE_LOCAL` are rejected
in production.

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

## Services

Rostrum runs two independently configured backend processes:

- the **Control API** is the caller-facing service for workflow authoring
  operations: draft saves, validation, rewind, and publish. It also aggregates
  readiness for its own database and the daemon.
- the **daemon** executes workflows. In M2 it is the private service the
  Control API calls; clients never address it directly.

Both run on Bun's native HTTP server with Hono routing and TypeBox schemas,
and both connect to the same Postgres database with their own credentials and
their own connection pool.

### Run

```bash
bun run --filter @rostrum/control-api start
bun run --filter @rostrum/daemon start
```

The `dev` script restarts a process when source files change:

```bash
bun run --filter @rostrum/control-api dev
bun run --filter @rostrum/daemon dev
```

Both processes stop on SIGINT or SIGTERM: they stop accepting connections,
finish outstanding requests within `SHUTDOWN_TIMEOUT_MS`, log
`shutdown started` and `shutdown complete`, then exit 0. If work outlives the
deadline the process force-closes connections, logs `forced shutdown`, and
exits nonzero. Send SIGHUP to reload configuration and tokens; SIGHUP is not
shutdown.

Daemon exit loses in-memory run state, and M2 makes no recovery promise: a
restart does not resume anything. Durable runs belong to M3.

### Configuration

Configuration is validated against a schema at startup; an invalid value
stops the process and names the offending key. Values come from two layers,
per variable: environment variables override the YAML config file, and keys
absent from both fall back to the documented defaults. Bun loads `.env`
files into the environment automatically.

The YAML file is optional. Set `CONTROL_API_CONFIG` or `DAEMON_CONFIG` to its
path, or place `apis/control-api/config.yaml` or `apis/daemon/config.yaml` and
leave the variable unset. An explicitly selected file that does not exist is
an error. The file is a flat mapping keyed like the configuration, and unknown
keys are rejected:

```yaml
host: 0.0.0.0
port: 8080
```

| Variable or key | Used by | Default | Meaning |
| --- | --- | --- | --- |
| `PORT` / `port` | Both | `3000` / `3001` | TCP port to bind; use `0` for an ephemeral port |
| `HOST` / `host` | Both | `127.0.0.1` | Address to bind. A plaintext daemon listener is loopback-only |
| `NODE_ENV` / `nodeEnv` | Both | `development` | One of `development`, `test`, `production`; selects the default log level and gates the local exception |
| `LOG_LEVEL` / `logLevel` | Both | `debug` in development and test, `info` in production | One of `trace`, `debug`, `info`, `warning`, `error`, `fatal` |
| `DATABASE_URL` / `databaseUrl` | Both | — (required) | Postgres target. Both services point at the same database, potentially with different credentials |
| `DATABASE_TLS_MODE` / `databaseTlsMode` | Both | `verify-full` | `verify-full` verifies the certificate chain and hostname. `disable` is allowed only with `ALLOW_INSECURE_LOCAL=true`, a development or test `NODE_ENV`, and a literal loopback target |
| `ALLOW_INSECURE_LOCAL` / `allowInsecureLocal` | Both | `false` | Development and test only. Permits a plaintext daemon listener and a loopback `DAEMON_URL`; it never disables token authentication |
| `DAEMON_URL` / `daemonUrl` | Control API | — (required) | The daemon origin. HTTPS unless the local exception applies. Credentials, query, fragment, and non-root paths are rejected |
| `DAEMON_TOKEN_FILE` / `daemonTokenFile` | Both | — | One token per line, oldest first, newest last. Reread on SIGHUP |
| `DAEMON_TOKEN` | Both | — | Comma-separated tokens, oldest first. An alternative to the file, not an additional source; configuring both is an error |
| `TLS_CERT_FILE` / `tlsCertFile` | Daemon | — | PEM server certificate chain for direct TLS |
| `TLS_KEY_FILE` / `tlsKeyFile` | Daemon | — | The matching private key. A partial or invalid pair is a startup error, never a fallback to HTTP |
| `BEHIND_REVERSE_PROXY` / `behindReverseProxy` | Daemon | `false` | Serve HTTP on literal loopback behind a same-host TLS-terminating proxy instead of hosting TLS |
| `DEPENDENCY_TIMEOUT_MS` / `dependencyTimeoutMs` | Both | `2000` | Bounds readiness, including queue, connect, query, and body consumption |
| `SHUTDOWN_TIMEOUT_MS` / `shutdownTimeoutMs` | Both | `30000` | One total drain-and-close deadline |

Additional trust roots come only from `NODE_EXTRA_CA_CERTS`, which must be set
before launching Bun; there is no `DAEMON_CA_FILE` or `DATABASE_CA_FILE`. Trust
is startup-scoped, so changing it requires a restart and SIGHUP does not
reload it.

Logging uses [LogTape](https://logtape.org/). Records are one JSON object
per line on the console with `time`, `level`, `msg`, and any extra fields.

At the default development level, each request logs a
`request received` record and its response logs a `response sent` record
with `method`, `path`, `status`, and `durationMs`.

### Routes

| Route | Authentication | Response |
| --- | --- | --- |
| Control API `GET /api/system/health` | Public | `200 {"status":"ok"}` — liveness only, no dependency queried |
| Control API `GET /api/system/readiness` | Public | `200` when its database and the daemon are both ready; otherwise `503` |
| Daemon `GET /api/system/health` | Bearer | `200 {"status":"ok"}`; `401` without a valid token |
| Daemon `GET /api/system/readiness` | Bearer | `200` when its database is ready; `503` otherwise; `401` without a valid token |
| Either `GET /openapi.json` | Daemon requires bearer | The generated OpenAPI 3.1 document |

Readiness is a distinct signal from liveness: a process whose database is
unavailable stays live and answers `health` with 200 while `readiness` reports
`503` and a stable failure code. Readiness recovers on its own once the
dependency returns; no restart is needed.

A readiness body names each check:

```json
{
  "status": "ready",
  "checks": {
    "database": { "status": "ok" },
    "daemon": { "status": "ok" }
  }
}
```

`status` is `not_ready` when any check fails, and a failed check carries a
stable `code`. Because a known failure returns immediately, a `not_ready` body
may omit a dependency that had not finished yet; an omitted check is unfinished
rather than healthy. Database codes are `database_unavailable`,
`database_timeout`, and `database_schema_unavailable`. Control API daemon codes
are `daemon_unavailable`, `daemon_timeout`, `daemon_unauthorized`,
`daemon_tls_error`, `daemon_invalid_response`, and `daemon_not_ready`.

Routes live under the `/api` path prefix. The prefix carries no
API version: a future deliberate stabilization may introduce a versioned
prefix, but until then routes stay unversioned.

Each route is one feature slice under
`apis/control-api/src/features/`: a slice exports `route`, `schema`, and
`handler`, and the folder layout decides the bound path. For example,
`src/features/system/health.ts` serves `GET /api/system/health`. The
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

### Daemon boundary

The Control API is the only client. Configure it with `DAEMON_URL` and one
token source; it sends `Authorization: Bearer <newest token>` and nothing else.
The daemon accepts every token in its configured set.

- **Direct TLS.** Give the daemon `TLS_CERT_FILE` and `TLS_KEY_FILE`. Add a
  private CA to the Control API with `NODE_EXTRA_CA_CERTS` before launch.
- **Reverse proxy.** Set `BEHIND_REVERSE_PROXY=true`, keep the daemon on
  literal loopback over plaintext, and terminate TLS at a same-host proxy that
  preserves the bearer header, enforces HTTPS, and blocks direct remote access.
  The Control API still uses an HTTPS `DAEMON_URL`.
- **Local development.** With `ALLOW_INSECURE_LOCAL=true` in development or
  test, the daemon may serve HTTP on a literal loopback address and the Control
  API may use a loopback `DAEMON_URL`. This never disables authentication.

Tokens are hexadecimal encodings of at least 32 random bytes, ordered oldest
first; the Control API always sends the last. Rotate without downtime:

1. append the new token to the daemon's file and send SIGHUP to the daemon;
2. append it to the Control API's file and send SIGHUP to the Control API;
3. confirm the new token works;
4. remove the retired token from the daemon's file and send SIGHUP again.

During the overlap the daemon accepts both. A SIGHUP that fails validation
changes nothing: the last valid configuration and token set stay active. Use
this order rather than restarting either process, and give token and key files
mode `0600` outside the checkout.

Each service owns one pool of at most ten connections plus one dedicated
readiness connection, so a deployment of both services uses at most 22
connections. Migrations are an explicit operator step and are never run at
startup:

```bash
DATABASE_URL=... DATABASE_TLS_MODE=verify-full bun run db:migrate
```

### OpenAPI document

The document at `/openapi.json` is generated code-first from TypeBox schemas
and is OpenAPI 3.1, the same dialect as the workflow format JSON Schema. Each
service checks in its own contract and regenerates it with:

```bash
bun run --filter @rostrum/control-api generate-openapi
bun run --filter @rostrum/daemon generate-openapi
```

The daemon's document declares bearer security and describes its private
routes; the Control API's document never exposes them. A test asserts that each
served document matches its checked-in copy.

## Layout

| Path | Contents |
| --- | --- |
| `apis/` | Backend services; `control-api/` is the caller-facing process and `daemon/` executes workflows |
| `apps/` | User-facing applications |
| `packages/server/` | Shared service mechanics: configuration, loopback and token validation, protocol schemas, logging, feature loading, readiness, and lifecycle |
| `packages/database/` | Postgres persistence: schema, migrations, repositories, and connection handles |
| `packages/workflow/` | The shared workflow library and validator |
| `dev-docs/` | Ignored checkout of the independent development-documentation repository |
| `scripts/` | Repository support scripts |
| `tmp/` | Scratch space for proof-of-concept work, excluded from lint and format |

## Documentation

Product strategy, roadmap milestones, technical Epics, implementation plans, human-readable specifications, decisions, and research live in [`RostrumAI/rostrum-dev-docs`](https://github.com/RostrumAI/rostrum-dev-docs). Run `bun run docs:setup` to create an independent, ignored checkout at `dev-docs/`. Commit and push documentation changes from inside that checkout; this repository does not track its commit. Runtime code, tests, migrations, fixtures, generated artifacts, and code-derived API documents remain in this repository.
