# PRD-02: Durable Orchestration Runtime

Status: Draft  
Strategic context: [Platform Product Plan](../strategy/rostrum-end-to-end-product-plan.md#2-what-we-are-building-and-why)<br>
Primary epic: [Orchestration runtime epics](../epics/epic-02-orchestration-runtime.md)

## Purpose

Execute workflow graphs reliably across process restarts, client disconnections, waiting periods, retries, parallel branches, transfer nodes, typed node piping, and human decisions. The runtime is the authoritative owner of run state and transition semantics. It is implemented by the Rostrum daemon, while the Control API exposes the contracts and commands that govern the daemon. Generated code, model providers, scripts, and untrusted tools must execute in an isolated target rather than inside the daemon process.

## Users and use cases

- A user starts a workflow and expects it to continue after closing the TUI.
- An orchestrator resumes a run after a worker or host failure.
- A workflow fans out work to independent tasks and joins results.
- A verifier fails a change and the runtime creates a bounded repair loop.
- A user approves or rejects a gated action from a different device.
- An operator pauses or cancels an expensive or unsafe run.
- A scheduler runs many projects without losing isolation or fairness.

## Goals

- Durable state transitions with clear recovery semantics.
- Deterministic scheduling of graph control flow.
- Bounded retries, loops, time, concurrency, and cost.
- Human-in-the-loop pauses without losing the execution thread.
- Idempotent handling of retried commands and node completions.
- A stable event stream for all clients and integrations.

## Non-goals

- Implementing model reasoning or tool behavior.
- Making arbitrary side effects safe without policy declarations.
- Providing a specific database, queue, or workflow library as the product promise.

## Required features

### Must

- Run lifecycle: queued, running, waiting, paused, succeeded, failed, blocked, canceled, and expired.
- Checkpoint after each meaningful state transition and before/after side-effecting work.
- Recovery after orchestrator restart, worker loss, network timeout, and client disconnect.
- Sequential, parallel, conditional, loop, retry, join, and child-run scheduling.
- Attempt limits, timeouts, budgets, and explicit exit conditions.
- Human approval wait states with durable request identity and expiration.
- Pause, resume, cancel, retry, and abort controls with authorization checks.
- Idempotency keys for start, control, approval, and completion commands.
- Structured failure classification: transient, deterministic, policy, human, dependency, and unknown.
- Event emission for run, node, tool, artifact, approval, budget, and environment changes.
- Run-level and node-level concurrency controls.

### Should

- Event replay to reconstruct a client view.
- Parent/child run relationships and fan-out across projects.
- Dead-letter handling for unresolved events.
- Fair scheduling and priority classes.
- Backpressure when model, runtime, or integration capacity is exhausted.
- Operator controls for draining a runtime or taking a queue out of service.
- Deterministic simulation configuration for workflow tests.
- Simulation-run lifecycle and explicit separation between simulation state and production state.
- Durable transfer-node checkpoints containing retained/pruned trajectory references, completed/remaining task state, transfer condition, and receiving-runtime configuration.
- Explicit node output binding and bounded streaming/materialization semantics for downstream inputs.

### Could

- Temporal or distributed transaction-like compensation primitives.
- Adaptive scheduling based on historical success, cost, and latency.
- Formal replay comparison for deterministic nodes.

## Acceptance criteria

1. A run continues and remains inspectable after the client disconnects.
2. A process restart does not cause a completed side effect to execute again without an explicit policy decision.
3. A verify-fix loop cannot exceed its declared attempts or budget.
4. An approval can be submitted once, from any authorized client, and is reflected consistently everywhere.
5. A parallel branch failure produces enough evidence to retry, repair, escalate, or stop.
6. A client can reconstruct the current run view from events and a snapshot.

## Open questions and SPIKEs

- At-least-once versus stronger delivery guarantees for node execution.
- Durable state engine and event store choices.
- How to make non-idempotent external actions safe to retry.
- Whether workflow graphs are interpreted or compiled into executable plans.
- Queue partitioning and scheduling model for hosted fleet scale.

## Ownership boundary

The runtime contracts, local runtime, and reference persistence/event implementations should be open-source. Hosted scheduling, fleet management, and managed operational infrastructure may be closed-source services behind the same APIs.
