# E2-S2 research: Local daemon transport options

| Tracking | Value |
| --- | --- |
| Status | Research compiled; the transport, envelope, error mapping, and configuration decisions are approved and recorded in the [E2-S2 decision record](../decisions/epic-02/e2-s2-local-daemon-transport.md) |
| Source | [E2-S2: Select the local daemon transport](../tasks/epic-02/e2-s2-select-local-daemon-transport.md) |
| Last updated | 2026-09-03 |

## Purpose

This research identifies the decisions needed to connect the separately running Control API and the local daemon. It answers the task's five questions:

1. How the Control API submits a run request, including the published-version retrieval pattern that [E1-S0](../decisions/epic-01/e1-s0-implementation-stack.md) deferred to this task.
2. How the Control API retrieves a current run or a terminal run.
3. How requests and responses correlate.
4. How health checks, deadlines, and daemon unavailability are reported.
5. How the transport carries structured invocation rejection, `currentSteps`, output, and failures without redefining them.

The approved [E2-S2 decision record](../decisions/epic-02/e2-s2-local-daemon-transport.md) records the outcome; the [Approved decisions](#approved-decisions) section lists the recommendations the product owner and implementing engineer approved before [E2-03](../tasks/epic-02/e2-03-define-executable-workflow-contract.md) or [E2-05](../tasks/epic-02/e2-05-build-local-daemon.md) begins.

## Inputs from approved and planned work

The [E1-S0 stack decision](../decisions/epic-01/e1-s0-implementation-stack.md) fixes facts the transport must respect:

- Rostrum runs on Bun with TypeScript; the Control API serves Hono on Bun's native HTTP server (`Bun.serve`).
- TypeBox (JSON Schema 2020-12) is the single schema language for the workflow specification and the API contract; OpenAPI 3.1 documents are generated code-first.
- E1-S0 explicitly rejected gRPC and Protobuf: the domain is JSON, and the contract must stay consumable by non-TypeScript clients and the future Cloud control plane.
- Bun workspaces separate `apps/` for runnable processes from `packages/` for shared libraries, so the daemon and the Control API share workflow and persistence code.
- E1-S0 deferred one decision to this task: "The published-workflow retrieval pattern for future execution requests is deferred to Epic 2, where the daemon consumer and the API-to-daemon transport are defined (E2-S2 and E2-02)."

The [E1-S3 lifecycle decision](../decisions/epic-01/e1-s3-draft-publication-lifecycle.md) fixes the invocation address and the execution artifact:

- The workflow `id` is a server-minted UUID v7; a published version is a per-workflow monotonic integer (1, 2, 3, ...).
- The digest is SHA-256, lowercase hex, over the RFC 8785 canonical form of the document with metadata removed; verification is `sha256(retrieved) == digest`.
- "The daemon never reads draft bytes; it executes a published version's canonical text."

The [E2-S1 decision](../decisions/epic-02/e2-s1-local-execution-semantics.md) (proposed) fixes the run-facing facts the transport must carry without redefining:

- Public run states are `queued`, `running`, `succeeded`, and `failed`; `stopping` is internal, and a run stays publicly `running` while active handlers drain.
- Acceptance creates the run and returns a run ID plus the `queued` representation; a rejected invocation returns a stable invocation problem and no run ID.
- A failed run returns the complete ordered `failures` array; each entry carries `code`, `message`, `phase`, `stepId`, `iteration`, `path`, and `details`.
- `currentSteps` lists every ready and running step instance and is empty for `queued` and terminal runs.
- Invocation idempotency is assigned to E3-S1 (decision Q14), which shapes how a lost submission response behaves.

Task-level constraints complete the frame:

- [E2-05](../tasks/epic-02/e2-05-build-local-daemon.md): the daemon reports health and version independently, rejects invalid configuration before accepting requests, supports correlated requests between independently running processes, and has integration tests that exercise the real process over the selected transport.
- [E2-10](../tasks/epic-02/e2-10-expose-runs-through-control-api.md): a valid request returns `HTTP 201` with a run ID and the `queued` representation; unknown runs and an unavailable daemon match the public error contract; API integration tests prove that no graph or handler logic runs in the Control API process.
- [E2-03](../tasks/epic-02/e2-03-define-executable-workflow-contract.md): API and daemon messages in the fixture catalog match the E2-S2 transport contract.
- [E2-11](../tasks/epic-02/e2-11-build-execution-conformance-suite.md) and [E2-12](../tasks/epic-02/e2-12-prove-local-execution-end-to-end.md): the same fixture catalog passes against the runtime, the daemon transport, and the Control API, and one command proves the epic through the real process boundary.
- The [build blueprint](../strategy/rostrum-high-level-build-blueprint.md) requires that a run continue if a client disconnects and that the daemon never require a client process to remain connected. The desktop client adds local-daemon discovery in a later epic.

### Current Control API conventions the daemon mirrors

The implemented Control API (`apps/control-api`) already fixes conventions the daemon should reuse:

- Configuration layers environment variables over an optional YAML file (`CONTROL_API_CONFIG` names the file, defaulting to a local `config.yaml`), validates every value against a TypeBox schema, and fails startup with the offending path (`apps/control-api/src/env.ts`). Variables in use: `HOST`, `PORT`, `DATABASE_URL`, `NODE_ENV`, `LOG_LEVEL`.
- Every feature route mounts under `/api/v1`, composed with the feature folder: `features/system/health.ts` serves `GET /api/v1/system/health` and `features/workflows/create.ts` serves `POST /api/v1/workflows` (`apps/control-api/src/app.ts`, `apps/control-api/src/loader.ts`).
- One error shape covers every error response: `{ code, message, findings }`, with an optional `currentRevision` for revision conflicts (`apps/control-api/src/schemas.ts`).
- `GET /api/v1/system/version` returns `{ service, version, interfaceVersion }` so a client can confirm compatibility before sending workflow data (`apps/control-api/src/features/system/version.ts`).
- The Hono application exposes `routes.fetch()`, so integration tests drive the full routing stack without a socket; the real process serves the same application through `Bun.serve` with graceful shutdown on `SIGTERM` and `SIGINT` (`apps/control-api/src/index.ts`).

### Platform facts the transport decision must respect

These facts come from the Bun documentation, the Bun issue tracker, and platform documentation; each appears in [Primary sources](#primary-sources).

- `Bun.serve` accepts a `unix` option for Unix domain sockets, including Linux abstract namespace sockets. Server-side Unix domain socket support has existed since Bun v0.8.1.
- Bun HTTP servers cannot listen on Windows named pipes: [oven-sh/bun#15350](https://github.com/oven-sh/bun/issues/15350) reports that `Bun.serve` accepts `unix` but not named pipes, and [oven-sh/bun#24682](https://github.com/oven-sh/bun/issues/24682) reports that a `node:http` server cannot listen on a Windows named pipe under Bun. Related gaps in the Node compatibility layer include a `node:net` listen panic ([#30265](https://github.com/oven-sh/bun/issues/30265)) and an `fs.access` probe failure ([#23292](https://github.com/oven-sh/bun/issues/23292)).
- Windows has supported the `AF_UNIX` address family since Windows 10 build 17063, so the OS capability exists even though Bun's HTTP server does not use it.
- Docker defaults to a Unix domain socket on POSIX and to the named pipe `//./pipe/docker_engine` on Windows, where only members of the Administrators group can connect by default; Docker treats TCP as opt-in and warns that remote access without TLS is not recommended.
- Bun's `fetch` client documents Linux abstract-namespace-socket support (v1.0.31), and the Bun repository tracks `fetch` support for Unix domain sockets as an open issue. An HTTP-over-socket client inside the Control API would need a custom adapter today.
- `Bun.serve` closes connections after 10 seconds of inactivity by default (`idleTimeout`, maximum 255 seconds, 0 disables it). The timer runs while a request is in flight and the handler has written no bytes, so a slow response path can be cut off by the default.

## Comparative research

The systems below deliver a local control protocol between a client process and a long-lived service.

| System | Relevant behavior | Lesson for Rostrum |
| --- | --- | --- |
| [Docker Engine API](https://docs.docker.com/engine/daemon/remote-access/) | The daemon listens on a Unix domain socket by default; TCP is opt-in and carries an explicit warning that remote access without TLS is not recommended. On Windows the daemon listens on the named pipe `//./pipe/docker_engine`, where only Administrators connect by default. | One protocol can serve different per-OS endpoints. A loopback TCP endpoint needs an explicit access story, because any local process can reach it. |
| [MCP transports](https://modelcontextprotocol.io/specification/2025-06-18/basic/transports) | The stdio transport launches the server as a subprocess; closing stdin terminates it. The Streamable HTTP transport runs the server as an independent process that accepts multiple clients and requires binding to localhost (127.0.0.1) when local. | Transport lifetime must match process lifetime. A daemon that must outlive its clients needs an independent-process endpoint, not a child-process pipe. |
| [Debug Adapter Protocol](https://microsoft.github.io/debug-adapter-protocol/overview) (and the LSP pattern it cites) | Single-session mode starts the adapter as a subprocess over stdin and stdout and terminates it at session end. Multi-session mode assumes the adapter is already running and listens on a port; each session opens and closes a connection. | The two lifetime models are formalized in common use. Rostrum's daemon is a multi-session service: it runs before and after any client. |
| [gRPC health checking](https://grpc.io/docs/guides/health-checking/) and the [Temporal dev server](https://docs.temporal.io/cli/command-reference/server) | gRPC standardizes a health service (`Check` and `Watch`, reporting `SERVING` or `NOT_SERVING`). Temporal's local development server exposes its gRPC front end on localhost port 7233. | Health is a first-class, cheap operation with a standard shape. Typed RPC costs a second schema language, which E1-S0 already rejected for this codebase. |
| [JSON-RPC 2.0](https://www.jsonrpc.org/specification) | JSON messages defined independently of any transport; the `id` member correlates a response with its request when one connection multiplexes many calls. | Correlation belongs in the envelope only when the transport multiplexes. HTTP request and response pairing already correlates without an envelope id. |

### Repeated patterns

Across these systems, five patterns recur:

1. Correlation comes from the connection (one request, one response) unless the transport multiplexes one byte stream, in which case the envelope carries an id.
2. Health is a dedicated, dependency-free operation that answers even when the service's own dependencies are failing.
3. Local endpoints still need an access story: loopback TCP is reachable by any local process, while sockets and pipes can carry OS-level access control.
4. The endpoint differs per operating system while the protocol stays identical.
5. Child-process stdio ties the server's lifetime to the client's lifetime; services that outlive their clients use an independent-process endpoint.

## Architecture options

Each option names the message format, the endpoint, and the lifetime model. The property rows are identical across options so the tradeoffs compare directly.

### Option A: JSON over HTTP on loopback TCP

The daemon serves the same Hono-on-`Bun.serve` shape as the Control API, bound to `127.0.0.1` on its own configured port. The Control API calls it as an ordinary HTTP client.

| Property | Assessment |
| --- | --- |
| Submission and retrieval | Plain `POST` and `GET` with JSON bodies; works with curl, Bun `fetch`, debuggers, and every HTTP client. |
| Correlation | HTTP request and response pairing; the submission response's run ID addresses later lookups. |
| Health, deadline, and unavailability | A stopped daemon fails fast with a connection error; the client enforces per-operation deadlines; the server's `idleTimeout` is configurable. |
| Carrying the E2-03 representations | The same TypeBox schemas serve both apps; HTTP status classes map to rejection and lookup outcomes. |
| Independent processes and automated tests | Two processes on one machine; `routes.fetch()` in-process tests and real-process loopback tests run the same client wrapper. |
| Fit for Epic 03 and later | The envelope is endpoint-independent: a socket-based endpoint can replace loopback TCP later without a contract change; remote daemons need authentication and TLS, which belong to later epics. |

Costs: any local process can connect to a loopback port (no user identity at the transport layer), and two daemons cannot share one configured port, so a second start must fail with a clear error.

### Option B: JSON over HTTP on an OS-local socket

Same protocol as Option A, but the endpoint is a Unix domain socket on POSIX and a named pipe on Windows, following Docker's model.

| Property | Assessment |
| --- | --- |
| Submission and retrieval | Identical HTTP semantics, but the Windows half is blocked: Bun HTTP servers cannot listen on named pipes today, and Bun's documented `fetch` client does not cover path-based Unix domain sockets. |
| Correlation | Same as Option A. |
| Health, deadline, and unavailability | Connection errors surface as missing-file or permission errors instead of connection-refused errors, so the client must classify per platform. |
| Carrying the E2-03 representations | Identical bodies; no difference from Option A. |
| Independent processes and automated tests | Per-platform socket setup in every integration test; `curl --unix-socket` aids debugging; the Control API needs a custom HTTP-over-socket adapter. |
| Fit for Epic 03 and later | The strongest access-control story (filesystem permissions on POSIX, pipe ACLs on Windows, as Docker's Administrators-only pipe shows). Worth adding once Bun's client-side socket support is verified, as a hardening step behind the same envelope. |

This option splits Epic 02 into two platform implementations for a benefit (user-scoped access) that a local, single-user development daemon does not need yet.

### Option C: gRPC over a local socket

The daemon exposes a protobuf service, optionally over a Unix domain socket, with the standardized gRPC health service.

| Property | Assessment |
| --- | --- |
| Submission and retrieval | Typed RPC with generated stubs; deadlines and health checking are protocol features. |
| Correlation | Handled by the framework. |
| Health, deadline, and unavailability | Standardized (`Check`, `Watch`, deadline propagation). |
| Carrying the E2-03 representations | The workflow domain is JSON and E2-03's schemas are TypeBox; gRPC introduces protobuf as a second schema language, which E1-S0 explicitly rejected. |
| Independent processes and automated tests | A gRPC runtime must run on Bun; none is proven in this repository, and the Node compatibility layer adds risk. |
| Fit for Epic 03 and later | Streaming (`Watch`) is unnecessary for Epic 02's request and response operations. |

This option contradicts a decided constraint (single schema language, JSON domain) to solve problems Epic 02 does not have.

### Option D: stdio JSON-RPC

The daemon speaks JSON-RPC 2.0 over stdin and stdout, launched as a child of the Control API, following the LSP and MCP stdio pattern.

| Property | Assessment |
| --- | --- |
| Submission and retrieval | Simple framing with no endpoint configuration. |
| Correlation | The JSON-RPC `id` member correlates calls. |
| Health, deadline, and unavailability | No endpoint to probe: if the daemon process dies, the pipe closes; a "start the daemon" step must run before every API start. |
| Carrying the E2-03 representations | Bodies carry unchanged; framing adds a Content-Length layer. |
| Independent processes and automated tests | The daemon's lifetime is coupled to the parent: MCP's stdio transport terminates the server when stdin closes, and DAP's single-session mode terminates the adapter at session end. |
| Fit for Epic 03 and later | One client at a time; a second client (CLI, desktop) cannot attach. |

This option violates the blueprint's requirement that the daemon never require a client process to remain connected, and it breaks the disconnect-and-retrieve behavior the epic must prove. MCP and DAP both keep stdio for exactly the case Rostrum does not have: a server whose lifetime the client owns.

### Option E: Postgres-backed mailbox

The Control API writes commands and reads projections through Postgres rows; the daemon polls or receives notifications.

| Property | Assessment |
| --- | --- |
| Submission and retrieval | Durable by construction and decoupled in time. |
| Correlation | Row identity; the run ID is the key. |
| Health, deadline, and unavailability | "Daemon unavailable" becomes a stale-row problem; liveness needs a separate heartbeat. |
| Carrying the E2-03 representations | Bodies pass through as JSON columns. |
| Independent processes and automated tests | Both processes already have database access patterns, but every test needs a database. |
| Fit for Epic 03 and later | Epic 03's durability model is a durable run projection with transactional checkpoints (E2-S1), not a transport queue. |

Epic 02 keeps runs in memory, so a mailbox would carry only two request types and two reads while adding polling latency, heartbeat machinery, and a database dependency on every interaction. The E2-S1 scale analysis already covers cross-machine dispatch as a later concern.

## Working recommendation

Select **JSON over HTTP as the transport contract, served on loopback TCP in Epic 02** (Option A). The endpoint is configuration, not a second contract: the envelope, operations, error mapping, and schemas stay identical when a socket-based endpoint (Option B) becomes worthwhile, which is exactly how Docker's per-OS endpoints behave.

This recommendation follows from verified platform facts: Bun's HTTP server accepts Unix domain sockets on POSIX but cannot listen on Windows named pipes, and Bun's HTTP client has no documented path-based Unix domain socket support. Choosing loopback TCP gives one implementation, one test path, and a plain `http://` URL that curl and every HTTP client accept without an adapter.

### Message envelope and operations

The envelope is HTTP itself plus three rules:

1. Bodies are JSON (`Content-Type: application/json`), and one request receives exactly one response; the HTTP status class carries the outcome.
2. Request and response bodies belong to E2-03's schemas; the envelope adds no fields to them.
3. An optional caller-supplied `x-request-id` header is logged and echoed by the daemon, so daemon and Control API logs can be joined during diagnosis.

The daemon mounts its routes under `/api/v1` composed with feature folders, mirrors the Control API's `system` area for health and version, and pins the internal interface's major version in the path: a breaking daemon-interface change adds `/api/v2` rather than mutating `/api/v1`, consistent with E1-S1's exact-match versioning philosophy.

| Operation | Daemon route | Success | Failure |
| --- | --- | --- | --- |
| Submit a run | `POST /api/v1/runs` | `201` with the `queued` representation | `4xx` structured invocation rejection, no run ID |
| Retrieve a run | `GET /api/v1/runs/{runId}` | `200` with the current or terminal representation | `404` unknown run |
| Liveness | `GET /api/v1/system/health` | `200` `{ "status": "ok" }` | Transport-level only |
| Version | `GET /api/v1/system/version` | `200` with service, package version, and `interfaceVersion` | Transport-level only |

The daemon interface is internal: it appears in no public document, and the Control API's OpenAPI document remains the single public API contract. The same code-first TypeBox generation can emit an internal contract document for automated checks, but it is a test artifact, not a public surface.

### Submission payload and published-version retrieval

This subsection resolves the retrieval pattern E1-S0 deferred to E2-S2.

**Recommendation: pass-by-identity.** The submission body carries the invocation address and inputs; the daemon reads the workflow document itself:

```json
{
  "workflowId": "0198c7a1-7d2a-7cc2-9a31-3f9a2d7e8b10",
  "workflowVersion": 3,
  "inputs": { "name": "Ada" }
}
```

The daemon loads the immutable published version through the shared database package, verifies `sha256(retrieved) == digest`, and then runs the E2-S1 acceptance checks. This matches the E2-S1 acceptance list, which requires the daemon itself to establish that the published version exists and its digest verifies, and it matches E1-S3's rule that the daemon executes the stored canonical text. The store stays the single source of truth, and the payload size is constant regardless of workflow size.

**Alternative: pass-by-value.** The Control API includes the published canonical document and digest in the submission. The daemon then needs no database configuration, and conformance fixtures become self-contained. The costs outweigh this: the daemon's digest check would prove only that the document is internally consistent, not that it came from the immutable store, and every invocation duplicates a potentially large document that can drift from what later operations observe.

One inconsistency needs E2-03's attention: the E2-S1 projection example shows `"workflowVersion": "1.0.0"`, while the decided E1-S3 record defines per-workflow monotonic integers. E2-03 owns the exact representation and must reconcile the two.

### Correlation

One HTTP request receives exactly one HTTP response, so the connection correlates request and response without an envelope id. JSON-RPC's `id` member solves multiplexing over a shared byte stream, a problem HTTP request and response pairing does not create.

The submission response's `runId` is the business correlation key for every later operation. Epic 02 defines no run listing, so the run ID is the only address a caller holds. The optional `x-request-id` header serves diagnosis, not semantics: it never affects routing or acceptance.

### Health, deadlines, and unavailability

The daemon's `GET /api/v1/system/health` stays a dependency-free liveness check, matching the Control API route that "answers without touching any dependency that could fail independently". `GET /api/v1/system/version` reports the workflow `interfaceVersion` the daemon can execute, so the Control API can verify compatibility before submitting.

The Control API's own health route does not probe the daemon. Per-operation errors report daemon availability more precisely than a liveness aggregation, and the existing route deliberately avoids dependencies that can fail independently.

Every daemon call the Control API makes carries an explicit client deadline (`DAEMON_TIMEOUT_MS`), and the client cancels the request when the deadline passes. On the server side, the daemon must configure `idleTimeout` above its slowest legitimate response path, because acceptance includes plan compilation and Bun's default is 10 seconds. Transport failures never create, mutate, or fail a run, and they never enter a run's `failures` array; that array holds run execution failures per E2-S1.

The error mapping rule is: structured invocation rejections pass through verbatim; transport-level failures are Control API errors in the public error shape, in a reserved `run.daemon.*` family (final names are E2-03 and E2-10 decisions).

| Transport observation | Control API response | Proposed code | Notes |
| --- | --- | --- | --- |
| Connection refused or reset | `503` | `run.daemon.unavailable` | No run created or changed. |
| Client deadline expires | `504` | `run.daemon.timeout` | A timed-out submission may still have been accepted; see the limitation below. |
| Daemon response missing or malformed | `500` | `run.daemon.protocol` | Internal invariant; not caller-fixable. |
| Daemon returns a `4xx` invocation rejection | Pass the status and body through | E2-03 owns the `run.*` codes | The API adds no fields and rewrites nothing. |
| Daemon returns `404` for an unknown run | Pass `404` through | E2-03 and E2-10 own the code | The run ID is well-formed but absent. |

One limitation is accepted and documented in Epic 02: a submission whose deadline expires leaves the acceptance state unknown, and the run may exist under an ID the caller never received. No public listing exists to recover it, so the operator reads daemon logs. E3-S1's idempotency key plus durable acceptance closes this (E2-S1 decision Q14); the public error reports the timeout rather than a fabricated failure.

### Configuration approach

The daemon mirrors `apps/control-api/src/env.ts`: environment variables layered over an optional YAML file (`DAEMON_CONFIG` names the file), validated against a TypeBox schema, with invalid values failing startup and naming the offending path. This satisfies E2-05's requirement that the daemon reject invalid configuration before accepting requests.

```yaml
# apps/daemon/config.yaml (proposed)
host: 127.0.0.1
port: 3100
databaseUrl: postgres://rostrum:rostrum@localhost:5432/rostrum
logLevel: debug
idleTimeout: 60
```

The Control API gains two variables:

```yaml
# apps/control-api/config.yaml additions (proposed)
daemonUrl: http://127.0.0.1:3100
daemonTimeoutMs: 10000
```

A plain URL keeps the client portable: curl, Bun `fetch`, and test harnesses all accept it without an adapter, which is exactly the capability a Unix domain socket endpoint would give up on the client side. No discovery file is proposed for Epic 02; the desktop client's local-daemon discovery can adopt one later without changing the wire contract.

### Carrying the E2-03 representations without redefining them

A shared workspace package (for example `packages/contracts`) exports the TypeBox schemas for the invocation request, invocation rejection, run representation, and failure entry. Both applications and the fixture catalog import the same objects, so no layer can redefine `currentSteps`, `failures`, or a rejection body. The transport never rewrites codes, messages, or details.

The daemon interface exposes only public representations: `stopping` stays public `running`, internal step states never cross the boundary, and the envelope carries no fields of its own beyond the optional `x-request-id` header.

## Request and response examples

The transcripts below are illustrative. Field names follow the E2-S1 decision; E2-03 owns the exact schemas, and E2-10 owns the public error shape the last two examples use. They cover the task's required scenarios: submission, lookup, rejection, timeout, and daemon unavailability.

### Submission

The Control API submits the invocation after resolving that the requested published version exists.

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
  "status": "queued",
  "currentSteps": [],
  "failures": []
}
```

The invocation connection can close immediately after this response; the daemon owns the run from here.

### Retrieval

A current run lists its active step instances.

```http
GET /api/v1/runs/0198c9e1-5a10-7c44-8b22-9d4e6f1a3c70 HTTP/1.1
Host: 127.0.0.1:3100
```

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

```http
HTTP/1.1 200 OK
Content-Type: application/json

{
  "runId": "0198c9e1-5a10-7c44-8b22-9d4e6f1a3c70",
  "workflowId": "0198c7a1-7d2a-7cc2-9a31-3f9a2d7e8b10",
  "workflowVersion": 3,
  "status": "failed",
  "currentSteps": [],
  "output": null,
  "failures": [
    {
      "code": "run.step.failed",
      "message": "Step 'fetch' failed with HTTP 500.",
      "phase": "handler",
      "stepId": "fetch",
      "iteration": 0,
      "path": "/steps/fetch",
      "details": { "status": 500 }
    }
  ]
}
```

### Invocation rejection

The daemon rejects the request before creating a run, so no run ID exists. The Control API passes the status and body through unchanged.

```http
POST /api/v1/runs HTTP/1.1
Host: 127.0.0.1:3100
Content-Type: application/json

{
  "workflowId": "0198c7a1-7d2a-7cc2-9a31-3f9a2d7e8b10",
  "workflowVersion": 3,
  "inputs": {}
}
```

```http
HTTP/1.1 400 Bad Request
Content-Type: application/json

{
  "code": "run.input.missing",
  "message": "The invocation is missing required workflow inputs.",
  "details": { "missing": ["name"] }
}
```

### Timeout

The daemon accepts the connection but does not answer before the Control API's deadline. The caller receives the public error shape; the run may or may not have been accepted.

```http
HTTP/1.1 504 Gateway Timeout
Content-Type: application/json

{
  "code": "run.daemon.timeout",
  "message": "The daemon did not answer the submission before the configured deadline.",
  "findings": []
}
```

### Daemon unavailability

The daemon process is not running, so the connection fails immediately. The caller receives the public error shape, and no run state was touched.

```http
HTTP/1.1 503 Service Unavailable
Content-Type: application/json

{
  "code": "run.daemon.unavailable",
  "message": "The daemon is not accepting connections at http://127.0.0.1:3100.",
  "findings": []
}
```

## Decision methodology

The E2-S2 decision record must provide five complementary views.

1. **Interface table.** Every operation with method, path, request and response body owner, and status codes, including the internal-versioning rule for future changes.
2. **Error mapping.** The five-row mapping table expanded with the approved code names and the E2-03 and E2-10 ownership boundaries.
3. **Transcripts.** The five scenarios above, updated to the approved schemas and kept current as the contract evolves.
4. **Configuration matrix.** Every variable, YAML key, default, validation error, and startup behavior for both processes.
5. **Executable reference model.** One client wrapper typed against a `fetch`-compatible function, so the same call code runs in every harness cell below.

The implementation must satisfy these property checks:

- every daemon call is bounded by a deadline;
- transport failures never create, mutate, or fail a run and never enter a run's `failures` array;
- invocation rejections pass through verbatim, and the Control API never mints a run ID;
- no graph, handler, or run-state code exists in the Control API process (E2-10 proves this);
- the same client wrapper drives in-process tests, real-process tests, and conformance fixtures;
- configuration failures fail startup before the socket opens.

The test matrix places each harness at the boundary it can prove:

| Layer | Harness | What it proves |
| --- | --- | --- |
| In-process | Hono `routes.fetch()` without sockets | Envelope, routing, and schema checks |
| Real process | Integration test starts both processes on loopback TCP | Correlation, health and version, deadlines, unavailability, graceful shutdown (E2-05) |
| Conformance | Shared fixture catalog (E2-11) | Same fixtures through the runtime, the daemon transport, and the Control API |
| End to end | One command (E2-12) | The complete epic through the real process boundary, including a run that continues after client disconnect |

## Approved decisions

The spike's acceptance criteria required the product owner and implementing engineer to approve the decision before E2-03 or E2-05 begins. The table records this research's recommendations, which they approved; the [E2-S2 decision record](../decisions/epic-02/e2-s2-local-daemon-transport.md) carries the outcome.

| ID | Question | Recommendation | Alternative |
| --- | --- | --- | --- |
| Q1 | Transport and Epic 02 endpoint | JSON over HTTP on loopback TCP (Option A) | Option B as later hardening behind the same envelope; Options C, D, and E rejected above |
| Q2 | Submission payload | Pass-by-identity; the daemon loads the published version and verifies the digest | Pass-by-value with the document and digest in the request |
| Q3 | Configuration names and defaults | Layered YAML and env loader; `DAEMON_URL` and `DAEMON_TIMEOUT_MS` on the Control API; daemon defaults `host: 127.0.0.1`, `port: 3100` | Different names, defaults, or a config file location |
| Q4 | Transport-failure codes | `503 run.daemon.unavailable`, `504 run.daemon.timeout`, `500 run.daemon.protocol`; rejections pass through | Renamed codes or a different code family owner |
| Q5 | `x-request-id` header | Accept, log, and echo an optional caller-supplied `x-request-id` | No header; join logs by timestamp and route only |
| Q6 | Loopback access control | No token in Epic 02; the daemon binds `127.0.0.1` only and accepts submissions from local processes; revisit before any non-loopback binding | A shared-secret token the daemon generates at startup |
| Q7 | Lost-acceptance ambiguity | Accept and document for Epic 02; E3-S1's idempotency and durable acceptance close it | Add a run-listing operation to E2-10's Epic 02 scope |

## Documents needed to close the spike

With the decisions approved, E2-S2 delivers these artifacts:

1. The approved decision record at `docs/decisions/epic-02/e2-s2-local-daemon-transport.md`, defining the transport, envelope, operations, error mapping, configuration, and the platform facts it relied on.
2. A proof of concept at `tmp/e2-s2-poc`, verified in `docs/results/epic-02/e2-s2-proof-of-concept.md`, that starts the Control API and daemon as separate processes and demonstrates submission, retrieval, rejection, timeout, unavailability, health and version checks, and graceful shutdown.
3. The interface table and the shared schema package location as inputs to E2-03's specification and fixture catalog, so fixture messages match the transport contract.
4. Updated E2-05 and E2-10 task specifications reconciling their acceptance criteria with the approved mapping and configuration names.

## Primary sources

- [Bun HTTP server documentation](https://bun.sh/docs/runtime/http/server) (`unix` option, abstract namespace sockets, `idleTimeout`)
- [Bun v0.8.1 release notes](https://bun.com/blog/bun-v0.8.1) (`Bun.serve` Unix domain socket support)
- [Bun v1.0.31 release notes](https://bun.com/blog/bun-v1.0.31) (abstract namespace sockets in `fetch`)
- [oven-sh/bun#15350: Named pipes don't work for HTTP servers](https://github.com/oven-sh/bun/issues/15350)
- [oven-sh/bun#24682: node:http server cannot listen on Windows named pipes](https://github.com/oven-sh/bun/issues/24682)
- [oven-sh/bun#30265: Bun panics on `net.listen` to a named pipe](https://github.com/oven-sh/bun/issues/30265)
- [oven-sh/bun#23292: `fs.access` cannot probe a named pipe on Windows](https://github.com/oven-sh/bun/issues/23292)
- [MCP transports, specification 2025-06-18](https://modelcontextprotocol.io/specification/2025-06-18/basic/transports)
- [gRPC health checking protocol](https://grpc.io/docs/guides/health-checking/)
- [JSON-RPC 2.0 specification](https://www.jsonrpc.org/specification)
- [Debug Adapter Protocol overview](https://microsoft.github.io/debug-adapter-protocol/overview)
- [Configure remote access for Docker daemon](https://docs.docker.com/engine/daemon/remote-access/)
- [Configure Docker in Windows](https://learn.microsoft.com/en-us/virtualization/windowscontainers/manage-docker/configure-docker-daemon) (named pipe access control)
- [AF_UNIX comes to Windows](https://devblogs.microsoft.com/commandline/af_unix-comes-to-windows/)
- [Temporal CLI server command reference](https://docs.temporal.io/cli/command-reference/server)
