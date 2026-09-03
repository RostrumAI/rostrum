# E2-S2 result: Local daemon transport proof of concept

| Tracking | Value |
| --- | --- |
| Status | Verified expanded research result; the transport decision is approved |
| Source | [E2-S2: Select the local daemon transport](../../tasks/epic-02/e2-s2-select-local-daemon-transport.md) |
| Research | [E2-S2 local daemon transport options](../../research/e2-s2-local-daemon-transport-options.md) |
| Decision | [E2-S2 decision: Local daemon transport](../../decisions/epic-02/e2-s2-local-daemon-transport.md) |
| Last updated | 2026-09-03 |
| Proof location | `tmp/e2-s2-poc` |

## What the proof establishes

The proof starts the daemon and a Control API boundary stand-in as real, separate processes on loopback TCP and drives them through the client wrapper that the approved decision defines, then adds an in-process cell that drives the same daemon application without a socket. The proof establishes these properties:

- The daemon answers health and version checks independently of the Control API, reporting `service`, `version`, and `interfaceVersion: "v1"`.
- A submission through the Control API returns `HTTP 201` with the `queued` representation (`runId`, `status`, `currentSteps: []`, `output: null`, `failures: []`) and no other envelope fields.
- The daemon loads the exact published version by identity, verifies its SHA-256 digest against the stored canonical text, and only then runs acceptance checks.
- `currentSteps` matches the E2-S1 projection during execution and is empty for `queued` and terminal runs; a succeeded run returns its output with empty projections.
- Invocation rejections (`run.input.missing`, `run.invocation.workflow-not-found`) pass through the Control API byte-identical, with no run ID minted.
- The daemon's `404` for an unknown run passes through verbatim.
- An optional caller-supplied `x-request-id` header is logged and echoed, and the Control API sends its own UUID on every daemon call.
- Every daemon call is bounded by an explicit client deadline; a deadline expiry surfaces as `504 run.daemon.timeout`, unavailability as `503 run.daemon.unavailable`, and a malformed daemon response as `500 run.daemon.protocol` in the public error shape.
- A submission the deadline cut off was still accepted by the daemon; the accepted run ID existed only in the daemon log, which is the documented lost-acceptance limitation that E3-S1 closes.
- The daemon shuts down gracefully: it logs `listening`, `shutdown started`, and `shutdown complete` in order, exits with code 0, and closes its socket. Invalid configuration (a non-integer `PORT`) fails startup with the offending path before the socket opens.
- The identical client wrapper drives the daemon application in process, without a socket, and reaches the same terminal representations.

## Proof scenarios

The harness at `tmp/e2-s2-poc/run-proof.ts` runs one assertion per check below, starts and stops its child processes, and exits nonzero if any check fails.

| Scenario | Observed result |
| --- | --- |
| Daemon health check | `200` with `{ "status": "ok" }`, answered without the Control API |
| Daemon version check | `200` with `rostrum-daemon`, package version, and `interfaceVersion: "v1"` |
| Submission | `201` with the complete `queued` run representation through the Control API boundary |
| `x-request-id` echo | The daemon returned the caller-supplied header value unchanged and logged it |
| `x-request-id` from the Control API | The daemon logged UUID request IDs for proxied calls |
| Running projection | `currentSteps` contained exactly `{ "stepId": "greet", "state": "running" }` with `workflowVersion: 3` |
| Succeeded retrieval | `output` was `{ "message": "Hello, Ada" }` with empty `currentSteps` and `failures` |
| Missing-input rejection | `400` with `run.input.missing` and `details.missing: ["name"]`, byte-identical through the boundary, no run ID |
| Unknown-workflow rejection | `404` with `run.invocation.workflow-not-found`, byte-identical through the boundary |
| Unknown-run retrieval | `404` with `run.not-found` (provisional code), byte-identical through the boundary |
| In-process submission and retrieval | The daemon application served `201` and the terminal representation without a socket |
| Deadline expiry | `504` with `run.daemon.timeout` and `findings: []` |
| Timed-out submission | The daemon had accepted the run; the ID was recoverable only from the daemon log |
| Unavailable daemon | `503` with `run.daemon.unavailable` for both submission and retrieval |
| Malformed daemon response | `500` with `run.daemon.protocol` after the representation check rejected the body |
| Graceful shutdown | Exit code 0 with the `listening`, `shutdown started`, `shutdown complete` log sequence; the socket was closed afterward |
| Invalid port | Nonzero exit with `invalid configuration: /port must be an integer` and no listening log line |

The observed response bodies:

```json
{
  "runId": "beecfcea-2076-4641-b975-421808dbe2d9",
  "workflowId": "0198c7a1-7d2a-7cc2-9a31-3f9a2d7e8b10",
  "workflowVersion": 3,
  "status": "running",
  "currentSteps": [{ "stepId": "greet", "state": "running" }],
  "output": null,
  "failures": []
}
```

```json
{
  "code": "run.input.missing",
  "message": "The invocation is missing required workflow inputs.",
  "details": { "missing": ["name"] }
}
```

```json
{
  "code": "run.daemon.timeout",
  "message": "The daemon did not answer the submission before the configured deadline.",
  "findings": []
}
```

```json
{
  "code": "run.daemon.unavailable",
  "message": "The daemon is not accepting connections.",
  "findings": []
}
```

## Error behavior demonstrated

The proof keeps the two error families separate, as the decision requires. Daemon rejection bodies carry `code`, `message`, and `details` and reach callers unchanged. Transport failures never touch daemon state; the Control API mints them in the public error shape with `findings: []`. A malformed success response (a `201` whose body failed the run-representation check) became `500 run.daemon.protocol` rather than a propagated body or a crash.

## Limits

The proof is temporary research code that proves the transport boundary only:

- The executor is a stub: a seeded published version advances on a timer through `queued`, `running`, and `succeeded`. No graph, handler, loop, or persistence logic exists; E2-07 through E2-09 own execution and E2-04 owns the executable contract.
- The published-version store is in memory with one seeded workflow. The daemon does not open a database connection; the pass-by-identity flow is exercised at the digest-verification step, not against Postgres. RFC 8785 canonicalization is represented by the stored canonical text itself.
- The proof files are dependency-free (raw `Bun.serve` handlers and structural guards) because Bun's isolated workspace installs do not resolve `hono` or `typebox` from `tmp/`. They stand in for the Hono routing, TypeBox validation, and `packages/contracts` schemas that E2-03 and E2-05 create.
- Configuration is read from environment variables only; the YAML file layer of the approved loader is specified in the decision's configuration matrix and implemented in E2-05.
- The graceful-shutdown scenario drives the real shutdown routine through a test-only self-shutdown timer because Windows delivers SIGTERM as a hard termination; the SIGTERM and SIGINT handlers are registered and mirror `apps/control-api/src/index.ts`.
- The proof shows execution continuing after the submission connection closed; the mid-flight client-disconnect scenario (aborting an open invocation connection and still reaching terminal state) is E2-12's end-to-end proof.
- The rejection and failure codes `run.not-found`, `run.route-not-found`, and `run.invocation.malformed` are provisional; E2-03 and E2-10 own the final names.
- Loopback TCP has no transport-layer access control in Epic 02 by decision; any local process can reach the configured port, and the daemon binds `127.0.0.1` only.

## Verification

Run the proof from the repository root:

```bash
bun run tmp/e2-s2-poc/run-proof.ts
```

The command starts the daemon and Control API processes on loopback TCP, runs every scenario above, prints one JSON line per check, and finishes with a summary. The verified run completed with 24 checks passed and 0 failed:

```json
{"proof":"e2-s2","passed":24,"failed":0,"failures":[]}
```

The PoC also typechecks cleanly: `bunx tsc --noEmit -p tmp/e2-s2-poc`.
