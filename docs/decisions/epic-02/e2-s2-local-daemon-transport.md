# E2-S2 decision: Local daemon transport

| Tracking | Value |
| --- | --- |
| Status | Approved |
| Source | [E2-S2: Select the local daemon transport](../../tasks/epic-02/e2-s2-select-local-daemon-transport.md) |
| Last updated | 2026-09-04 |

## Decision

The Control API and the daemon communicate over JSON over HTTP on loopback TCP. The daemon is a separate workspace app (`apps/daemon/`) that shares `packages/` with the Control API, and the Control API calls it as an ordinary HTTP client. The endpoint is configuration, not a second contract: a socket-based endpoint can replace loopback TCP later without a contract change.

The decision fixes these rules:

1. **Transport and endpoint:** JSON over HTTP on loopback TCP in Epic 02. The daemon binds `127.0.0.1` only and accepts submissions from local processes. The desktop client's local-daemon discovery arrives in a later epic without a wire-contract change.
2. **Message envelope:** bodies are JSON (`application/json`), and one request receives exactly one response; the HTTP status class carries the outcome. Request and response bodies belong to the executable-workflow contract that E2-03 defines; the envelope adds no fields to them.
3. **Submission payload:** the submission body carries the invocation address and inputs. The daemon loads the immutable published version through the shared database package, verifies `sha256(retrieved) == digest`, and then runs the E2-S1 acceptance checks. This resolves the published-version retrieval pattern that [E1-S0](../../decisions/epic-01/e1-s0-implementation-stack.md) deferred to Epic 2.
4. **Correlation:** the HTTP request and response pairing correlates every call; the submission response's `runId` is the business key for later lookups. No envelope ID exists because HTTP does not multiplex one byte stream.
5. **Health and deadlines:** `GET /api/v1/system/health` is a dependency-free liveness check, and `GET /api/v1/system/version` reports the workflow `interfaceVersion` the daemon can execute. The Control API's own health route does not probe the daemon. Every daemon call the Control API makes carries an explicit client deadline (`DAEMON_TIMEOUT_MS`), and the daemon's `idleTimeout` is configured above its slowest legitimate response path.
6. **Error mapping:** structured invocation rejections pass through verbatim; transport-level failures become Control API errors in the public error shape, in the reserved `run.daemon.*` family. Transport failures never create, mutate, or fail a run and never enter a run's `failures` array.
7. **Configuration:** both processes layer environment variables over an optional YAML file, validate against a TypeBox schema, and fail startup with the offending path before the socket opens. The approved names and defaults are in the configuration matrix below.
8. **Shared schemas and client wrapper:** the `packages/contracts` workspace package exports the TypeBox schemas for the invocation request, invocation rejection, run representation, and failure entry, plus the client wrapper. Both applications and the fixture catalog import the same objects, so no layer redefines `currentSteps`, `failures`, or a rejection body.
9. **Lost-acceptance ambiguity:** accepted for Epic 02. A submission whose deadline expires leaves the acceptance state unknown, and the run may exist under an ID the caller never received; the operator reads daemon logs. [E3-S1](../../tasks/epic-03/e3-s1-define-checkpoint-and-recovery-semantics.md) closes this with idempotency keys and durable acceptance.

## Context

The Control API and the daemon are independently running processes, and the build blueprint requires that a run continue if a client disconnects and that the daemon never require a client process to remain connected. The transport must answer five questions from [the E2-S2 task](../../tasks/epic-02/e2-s2-select-local-daemon-transport.md): submission, retrieval, correlation, health and unavailability reporting, and carrying the E2-03 representations without redefining them.

JSON over HTTP on loopback TCP is the option that keeps one schema language and one wire format while leaving the endpoint swappable. The rejected options, in one line each: HTTP over OS-local sockets waits on Bun runtime support (its HTTP server cannot listen on Windows named pipes ([oven-sh/bun#15350](https://github.com/oven-sh/bun/issues/15350)) and its `fetch` client has no documented Unix-domain-socket support), so it remains the hardening step behind the same envelope; gRPC would reintroduce a second schema language, which [E1-S0](../../decisions/epic-01/e1-s0-implementation-stack.md) rejected; stdio JSON-RPC couples the daemon's lifetime to a client process, which the build blueprint forbids because the daemon must outlive caller connections; a Postgres-backed mailbox adds polling latency and heartbeat machinery to carry two request types while Epic 02 keeps runs in memory.

## Daemon REST API layout

The daemon interface is internal: it appears in no public document, and the Control API's OpenAPI document remains the single public API contract. The daemon serves no OpenAPI route; the shared TypeBox schemas are the internal contract that tests check.

| Operation | Method and path | Request body | Success | Failure |
| --- | --- | --- | --- | --- |
| Submit a run | `POST /api/v1/runs` | Invocation (E2-03 schema) | `201` with the `queued` representation | `4xx` structured invocation rejection, no run ID |
| Retrieve a run | `GET /api/v1/runs/{runId}` | None | `200` with the current or terminal representation | `404` unknown run |
| Liveness | `GET /api/v1/system/health` | None | `200` with `{ "status": "ok" }` | Transport-level only |
| Version | `GET /api/v1/system/version` | None | `200` with `service`, `version`, and `interfaceVersion` | Transport-level only |

Routes mount under `/api/v1` composed with feature folders, mirroring the Control API's conventions: `src/features/runs/` holds the submit and retrieve slices, and `src/features/system/` holds health and version. A breaking daemon-interface change adds `/api/v2` rather than mutating `/api/v1`, consistent with E1-S1's exact-match versioning philosophy.

Epic 02 adds no list, cancel, retry, or pause operations; Epic 03 owns run control. There is no streaming: one request receives exactly one response.

## How the Control API calls the daemon

One client wrapper performs every daemon call. It is typed against a `fetch`-compatible function (`(request: Request) => Promise<Response>`), so the same call code runs in the in-process harness (against the daemon application's own `fetch`), the real-process harness (against loopback TCP), and later conformance fixtures. The wrapper applies the deadline with an abort signal, classifies outcomes as `accepted`, `rejected` (verbatim pass-through), `unavailable`, `timeout`, or `protocol`, and validates daemon responses against the run-representation schema so a malformed response becomes a `run.daemon.protocol` error instead of a crash. It never rewrites rejection bodies.

E2-03 creates `packages/contracts` and promotes the schemas and the wrapper into it; E2-05 and E2-10 consume them from there.

## Error mapping

| Transport observation | Control API response | Code | Notes |
| --- | --- | --- | --- |
| Connection refused or reset | `503` | `run.daemon.unavailable` | No run created or changed. |
| Client deadline expires | `504` | `run.daemon.timeout` | A timed-out submission may still have been accepted; see the lost-acceptance rule. |
| Daemon response missing or malformed | `500` | `run.daemon.protocol` | Internal invariant; not caller-fixable. |
| Daemon returns a `4xx` invocation rejection | Pass the status and body through verbatim | E2-03 owns the `run.*` codes | The API adds no fields and rewrites nothing. |
| Daemon returns `404` for an unknown run | Pass `404` through verbatim | E2-03 and E2-10 own the code | The run ID is well-formed but absent. |

Transport-failure responses use the public error shape `{ code, message, findings }` from `apps/control-api/src/schemas.ts`. Rejection bodies keep their E2-03 shape and are never reshaped. The `run.daemon.*` family is reserved for this mapping; E2-03 owns the final rejection-code names, including the public code for unknown runs.

**Lost acceptance.** A submission whose deadline expires leaves the acceptance state unknown: the run may exist under an ID the caller never received. The public error reports the timeout rather than a fabricated failure, and the operator reads daemon logs. [E3-S1](../../tasks/epic-03/e3-s1-define-checkpoint-and-recovery-semantics.md) closes this with invocation idempotency and durable acceptance.

## Examples

The transcripts below are illustrative; field names follow the E2-S1 decision, and E2-03 owns the exact schemas.

### Submission

```http
POST /api/v1/runs HTTP/1.1
Host: 127.0.0.1:3100
Content-Type: application/json

{
  "workflowId": "0198c7a1-7d2a-7cc2-9a31-3f9a2d7e8b10",
  "workflowVersion": 3,
  "inputs": { "name": "Ada" }
}
```

```http
HTTP/1.1 201 Created
Content-Type: application/json

{
  "runId": "0198c9e1-5a10-7c44-8b22-9d4e6f1a3c70",
  "workflowId": "0198c7a1-7d2a-7cc2-9a31-3f9a2d7e8b10",
  "workflowVersion": 3,
  "status": "queued",
  "currentSteps": [],
  "output": null,
  "failures": []
}
```

The invocation connection can close immediately after this response; the daemon owns the run from here.

### Retrieval

```http
HTTP/1.1 200 OK
Content-Type: application/json

{
  "runId": "0198c9e1-5a10-7c44-8b22-9d4e6f1a3c70",
  "workflowId": "0198c7a1-7d2a-7cc2-9a31-3f9a2d7e8b10",
  "workflowVersion": 3,
  "status": "running",
  "currentSteps": [
    { "stepId": "branch-a", "state": "running" },
    { "stepId": "branch-b", "state": "ready" }
  ],
  "output": null,
  "failures": []
}
```

One representation serves every state; `status` distinguishes them. A succeeded run returns its declared output; a failed run returns the complete ordered failure list and no output.

### Invocation rejection

```http
HTTP/1.1 400 Bad Request
Content-Type: application/json

{
  "code": "run.input.missing",
  "message": "The invocation is missing required workflow inputs.",
  "details": { "missing": ["name"] }
}
```

The daemon rejects the request before creating a run, so no run ID exists. The Control API passes the status and body through unchanged.

### Timeout

```http
HTTP/1.1 504 Gateway Timeout
Content-Type: application/json

{
  "code": "run.daemon.timeout",
  "message": "The daemon did not answer the submission before the configured deadline.",
  "findings": []
}
```

The daemon accepted the connection but did not answer before the deadline. The run may exist under an ID the caller never received; the public error reports the timeout rather than a fabricated failure.

### Daemon unavailability

```http
HTTP/1.1 503 Service Unavailable
Content-Type: application/json

{
  "code": "run.daemon.unavailable",
  "message": "The daemon is not accepting connections at http://127.0.0.1:3100.",
  "findings": []
}
```

The daemon process is not running, so the connection fails immediately and no run state was touched.

## Configuration matrix

Both processes layer environment variables over an optional YAML file keyed like the config interface; the environment wins per variable. `CONTROL_API_CONFIG` names the Control API's file and `DAEMON_CONFIG` names the daemon's file, each defaulting to a local `config.yaml`. Invalid values fail startup with the offending path before the socket opens.

### Control API (`apps/control-api`)

The existing variables keep their names and defaults; two are added.

| Variable | YAML key | Default | Validation |
| --- | --- | --- | --- |
| `HOST` | `host` | `127.0.0.1` | String. |
| `PORT` | `port` | `3000` | Integer 0 through 65535. |
| `DATABASE_URL` | `databaseUrl` | `postgres://rostrum:rostrum@localhost:5432/rostrum` | String. |
| `NODE_ENV` | `nodeEnv` | `development` | One of `development`, `test`, `production`. |
| `LOG_LEVEL` | `logLevel` | `debug` in development, `info` in production | LogTape level. |
| `DAEMON_URL` | `daemonUrl` | `http://127.0.0.1:3100` | URL of the daemon's loopback endpoint. |
| `DAEMON_TIMEOUT_MS` | `daemonTimeoutMs` | `10000` | Positive integer; the per-call client deadline. |

### Daemon (`apps/daemon`, built in E2-05)

| Variable | YAML key | Default | Validation |
| --- | --- | --- | --- |
| `HOST` | `host` | `127.0.0.1` | String. |
| `PORT` | `port` | `3100` | Integer 0 through 65535. |
| `DATABASE_URL` | `databaseUrl` | `postgres://rostrum:rostrum@localhost:5432/rostrum` | String. |
| `NODE_ENV` | `nodeEnv` | `development` | One of `development`, `test`, `production`. |
| `LOG_LEVEL` | `logLevel` | `debug` in development, `info` in production | LogTape level. |
| `IDLE_TIMEOUT` | `idleTimeout` | `60` | Integer 0 through 255 (Bun's cap), above the slowest legitimate response path. |

`Bun.serve` closes connections after 10 seconds of inactivity by default, and the timer runs while a request is in flight, so `IDLE_TIMEOUT` must sit above the slowest legitimate response path, such as an acceptance submission that compiles a plan.

## Test matrix

| Layer | Harness | What it proves |
| --- | --- | --- |
| In-process | Application `fetch` without sockets | Envelope, routing, and schema checks |
| Real process | Integration test starts both processes on loopback TCP | Correlation, health and version, deadlines, unavailability, graceful shutdown (E2-05) |
| Conformance | Shared fixture catalog (E2-11) | Same fixtures through the runtime, the daemon transport, and the Control API |
| End to end | One command (E2-12) | The complete epic through the real process boundary, including a run that continues after client disconnect |

## Handoffs

- **E2-03** owns the exact TypeBox schemas in `packages/contracts`, the final `run.*` rejection-code names (the examples' `run.input.missing` is provisional), and reconciling the `workflowVersion` representation to the per-workflow monotonic integer that E1-S3 decided (the E2-S1 projection example shows a `"1.0.0"` string and must be corrected).
- **E2-05** builds the daemon process against the endpoint table and configuration matrix, including the YAML file layer and the `idleTimeout` guard.
- **E2-10** exposes the two run operations through the Control API with this error mapping and owns the public unknown-run code.
- **E3-S1** closes the lost-acceptance ambiguity with invocation idempotency and durable acceptance.