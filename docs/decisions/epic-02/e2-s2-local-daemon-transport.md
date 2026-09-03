# E2-S2 decision: Local daemon transport

| Tracking | Value |
| --- | --- |
| Status | Approved |
| Source | [E2-S2: Select the local daemon transport](../../tasks/epic-02/e2-s2-select-local-daemon-transport.md) |
| Research | [E2-S2 local daemon transport options](../../research/e2-s2-local-daemon-transport-options.md) |
| Proof | [E2-S2 transport proof of concept](../../results/epic-02/e2-s2-proof-of-concept.md) |
| Last updated | 2026-09-03 |

## Decision

The Control API and the daemon communicate over JSON over HTTP on loopback TCP. The daemon serves the same Hono-on-`Bun.serve` shape as the Control API, bound to `127.0.0.1` on its own configured port, and the Control API calls it as an ordinary HTTP client. The endpoint is configuration, not a second contract: a socket-based endpoint can replace loopback TCP later without a contract change, which is how Docker's per-OS endpoints behave.

The decision fixes these rules:

1. **Transport and endpoint:** JSON over HTTP on loopback TCP in Epic 02. The daemon binds `127.0.0.1` only and accepts submissions from local processes. The desktop client's local-daemon discovery arrives in a later epic without a wire-contract change.
2. **Message envelope:** HTTP itself, plus three rules:
   1. Bodies are JSON (`application/json`), and one request receives exactly one response; the HTTP status class carries the outcome.
   2. Request and response bodies belong to the executable-workflow contract that E2-03 defines; the envelope adds no fields to them.
   3. An optional caller-supplied `x-request-id` header is logged and echoed by the daemon. It serves diagnosis only and never affects routing or acceptance.
3. **Submission payload:** pass-by-identity. The submission body carries the invocation address and inputs; the daemon loads the immutable published version through the shared database package, verifies `sha256(retrieved) == digest`, and then runs the E2-S1 acceptance checks. This resolves the published-version retrieval pattern that [E1-S0](../../decisions/epic-01/e1-s0-implementation-stack.md) deferred to Epic 2.
4. **Correlation:** the HTTP request and response pairing correlates every call; the submission response's `runId` is the business key for later lookups. No envelope id exists because HTTP does not multiplex one byte stream.
5. **Health and deadlines:** `GET /api/v1/system/health` is a dependency-free liveness check, and `GET /api/v1/system/version` reports the workflow `interfaceVersion` the daemon can execute. The Control API's own health route does not probe the daemon. Every daemon call the Control API makes carries an explicit client deadline (`DAEMON_TIMEOUT_MS`), and the daemon's `idleTimeout` is configured above its slowest legitimate response path.
6. **Error mapping:** structured invocation rejections pass through verbatim; transport-level failures become Control API errors in the public error shape, in the reserved `run.daemon.*` family. Transport failures never create, mutate, or fail a run and never enter a run's `failures` array.
7. **Configuration:** both processes layer environment variables over an optional YAML file, validate against a TypeBox schema, and fail startup with the offending path before the socket opens. The approved names and defaults are in the configuration matrix below.
8. **Shared schemas and client wrapper:** the `packages/contracts` workspace package exports the TypeBox schemas for the invocation request, invocation rejection, run representation, and failure entry, plus the client wrapper. Both applications and the fixture catalog import the same objects, so no layer redefines `currentSteps`, `failures`, or a rejection body.
9. **Lost-acceptance ambiguity:** accepted and documented for Epic 02. A submission whose deadline expires leaves the acceptance state unknown, and the run may exist under an ID the caller never received; the operator reads daemon logs. [E3-S1](../../tasks/epic-03/e3-s1-define-checkpoint-and-recovery-semantics.md) closes this with idempotency keys and durable acceptance (E2-S1 decision Q14).

## Context

The Control API and the daemon are independently running processes, and the build blueprint requires that a run continue if a client disconnects and that the daemon never require a client process to remain connected. The transport must answer five questions from [the E2-S2 task](../../tasks/epic-02/e2-s2-select-local-daemon-transport.md): submission, retrieval, correlation, health and unavailability reporting, and carrying the E2-03 representations without redefining them.

The approved [E2-S2 research](../../research/e2-s2-local-daemon-transport-options.md) compared five architecture options. Option A (JSON over HTTP on loopback TCP) is selected. Option B (HTTP over OS-local sockets) is rejected for Epic 02 because Bun's HTTP server cannot listen on Windows named pipes and Bun's `fetch` client has no documented path-based Unix domain socket support; it remains the hardening step behind the same envelope once Bun's client-side socket support is verified. Option C (gRPC) reintroduces a second schema language that E1-S0 rejected. Option D (stdio JSON-RPC) couples the daemon's lifetime to a client process, which the blueprint forbids. Option E (a Postgres-backed mailbox) adds polling latency and heartbeat machinery to carry two request types while Epic 02 keeps runs in memory.

### Platform facts the transport relies on

- `Bun.serve` accepts a `unix` option for Unix domain sockets, but it cannot listen on Windows named pipes ([oven-sh/bun#15350](https://github.com/oven-sh/bun/issues/15350), [oven-sh/bun#24682](https://github.com/oven-sh/bun/issues/24682)).
- Bun's documented `fetch` client support for Unix domain sockets covers only Linux abstract-namespace sockets ([Bun v1.0.31 release notes](https://bun.com/blog/bun-v1.0.31)), so an HTTP-over-socket client would need a custom adapter.
- `Bun.serve` closes connections after 10 seconds of inactivity by default (`idleTimeout`, maximum 255 seconds), and the timer runs while a request is in flight, so acceptance paths that compile plans need a configured value.
- Docker, MCP, and the Debug Adapter Protocol all keep one protocol across differing per-OS endpoints and reserve child-process stdio for servers whose lifetime the client owns; Rostrum's daemon is a multi-session service ([Docker remote access](https://docs.docker.com/engine/daemon/remote-access/), [MCP transports](https://modelcontextprotocol.io/specification/2025-06-18/basic/transports), [DAP overview](https://microsoft.github.io/debug-adapter-protocol/overview)).

## Interface table

The daemon interface is internal: it appears in no public document, and the Control API's OpenAPI document remains the single public API contract. Code-first TypeBox generation can emit an internal contract document for automated checks, but it is a test artifact, not a public surface.

| Operation | Method and path | Request body | Success | Failure |
| --- | --- | --- | --- | --- |
| Submit a run | `POST /api/v1/runs` | Invocation (E2-03 schema) | `201` with the `queued` representation | `4xx` structured invocation rejection, no run ID |
| Retrieve a run | `GET /api/v1/runs/{runId}` | None | `200` with the current or terminal representation | `404` unknown run |
| Liveness | `GET /api/v1/system/health` | None | `200` with `{ "status": "ok" }` | Transport-level only |
| Version | `GET /api/v1/system/version` | None | `200` with `service`, `version`, and `interfaceVersion` | Transport-level only |

Routes mount under `/api/v1` composed with feature folders, mirroring the Control API's conventions. A breaking daemon-interface change adds `/api/v2` rather than mutating `/api/v1`, consistent with E1-S1's exact-match versioning philosophy.

## Error mapping

| Transport observation | Control API response | Code | Notes |
| --- | --- | --- | --- |
| Connection refused or reset | `503` | `run.daemon.unavailable` | No run created or changed. |
| Client deadline expires | `504` | `run.daemon.timeout` | A timed-out submission may still have been accepted; see the lost-acceptance rule. |
| Daemon response missing or malformed | `500` | `run.daemon.protocol` | Internal invariant; not caller-fixable. |
| Daemon returns a `4xx` invocation rejection | Pass the status and body through verbatim | E2-03 owns the `run.*` codes | The API adds no fields and rewrites nothing. |
| Daemon returns `404` for an unknown run | Pass `404` through verbatim | E2-03 and E2-10 own the code | The run ID is well-formed but absent. |

Transport-failure responses use the public error shape `{ code, message, findings }` from `apps/control-api/src/schemas.ts`. The `run.daemon.*` family is reserved for this mapping; E2-03 owns the final rejection-code names, including the public code for unknown runs.

## Transcripts

The transcripts below are illustrative; field names follow the E2-S1 decision, and E2-03 owns the exact schemas. The proof of concept observed bodies with this shape (see the [proof results](../../results/epic-02/e2-s2-proof-of-concept.md)).

### Submission

```http
POST /api/v1/runs HTTP/1.1
Host: 127.0.0.1:3100
Content-Type: application/json
x-request-id: 0198c9d2-7c62-7bb3-9f8f-2b6f1c9b0a41

{
  "workflowId": "0198c7a1-7d2a-7cc2-9a31-3f9a2d7e8b10",
  "workflowVersion": 3,
  "inputs": { "name": "Ada" }
}
```

```http
HTTP/1.1 201 Created
Content-Type: application/json
x-request-id: 0198c9d2-7c62-7bb3-9f8f-2b6f1c9b0a41

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

A succeeded run returns its declared output; a failed run returns the complete ordered failure list and no output.

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

## Executable reference model

One client wrapper performs every daemon call. It is typed against a `fetch`-compatible function (`(request: Request) => Promise<Response>`), so the same call code runs in the in-process harness (against the daemon application's own `fetch`), the real-process harness (against loopback TCP), and later conformance fixtures. The wrapper applies the deadline with an abort signal, generates and verifies the `x-request-id` echo, classifies outcomes as `accepted`, `rejected` (verbatim pass-through), `unavailable`, `timeout`, or `protocol`, and validates daemon responses against the run-representation schema so a malformed response becomes a `run.daemon.protocol` error instead of a crash. It never rewrites rejection bodies.

The reference implementation stands at `tmp/e2-s2-poc/daemon-client.ts` in the proof. E2-03 promotes the schemas and the wrapper into `packages/contracts`, and E2-05 and E2-10 consume them from there.

## Property checks

The implementation must satisfy these properties, each proven in the proof of concept:

1. Every daemon call is bounded by a deadline (proof: the `504` scenario).
2. Transport failures never create, mutate, or fail a run and never enter a run's `failures` array (proof: the `503`, `504`, and `500` scenarios; run state changes only through daemon acceptance).
3. Invocation rejections pass through verbatim, and the Control API never mints a run ID (proof: byte-identical rejection bodies through the Control API, with no run ID field).
4. No graph, handler, or run-state code exists in the Control API process (proof: the Control API boundary forwards outcome objects and holds no run state; E2-10 proves it for the real application).
5. The same client wrapper drives in-process tests, real-process tests, and conformance fixtures (proof: the in-process cell and the real-process scenarios call through the identical wrapper).
6. Configuration failures fail startup before the socket opens (proof: an invalid port exits nonzero with the offending path and no listening log line).

## Test matrix

| Layer | Harness | What it proves |
| --- | --- | --- |
| In-process | Application `fetch` without sockets | Envelope, routing, and schema checks |
| Real process | Integration test starts both processes on loopback TCP | Correlation, health and version, deadlines, unavailability, graceful shutdown (E2-05) |
| Conformance | Shared fixture catalog (E2-11) | Same fixtures through the runtime, the daemon transport, and the Control API |
| End to end | One command (E2-12) | The complete epic through the real process boundary, including a run that continues after client disconnect |

## Handoffs

- **E2-03** owns the exact TypeBox schemas in `packages/contracts`, the final `run.*` rejection-code names (the proof's `run.not-found` is provisional), and reconciling the `workflowVersion` representation to the per-workflow monotonic integer that E1-S3 decided (the E2-S1 projection example shows a `"1.0.0"` string and must be corrected).
- **E2-05** builds the daemon process against this interface table and configuration matrix, including the YAML file layer and the `idleTimeout` guard.
- **E2-10** exposes the two run operations through the Control API with this error mapping and owns the public unknown-run code.
- **E3-S1** closes the lost-acceptance ambiguity with invocation idempotency and durable acceptance.
