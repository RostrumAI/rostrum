# Epic-02: Durable Orchestration Runtime

Source PRD: [PRD-02](../prds/prd-02-durable-orchestration-runtime.md)  
Status: Draft

## Outcome

Execute graphs durably with bounded control flow, restart recovery, parallelism, approvals, and operator controls.

## Epics and tasks

### E-ORCH-01: Run state machine

- [ ] Define run, node execution, branch, attempt, and child-run state models.
- [ ] Implement lifecycle transitions and transition validation.
- [ ] Persist state before and after side-effecting operations.
- [ ] Add run identity, correlation, and idempotency conventions.
- [ ] Implement snapshots and state migration strategy.

### E-ORCH-02: Scheduler and graph execution

- [ ] Implement ready-node evaluation for sequential and conditional paths.
- [ ] Implement parallel fan-out, joins, and branch failure behavior.
- [ ] Implement bounded loops and retry policies.
- [ ] Implement child workflows and parent result aggregation.
- [ ] Implement explicit node output bindings and bounded streaming/materialization for downstream inputs.
- [ ] Implement durable transfer-node checkpoints and receiving-runtime initialization.
- [ ] Add concurrency and resource admission controls.

### E-ORCH-03: Recovery and control

- [ ] Recover queued/running/waiting work after process restart.
- [ ] Handle worker timeout, lost heartbeat, and unknown completion.
- [ ] Implement pause, resume, cancel, retry, abort, and drain controls.
- [ ] Add approval wait states and expiry.
- [ ] Implement structured failure classification and escalation.

### E-ORCH-04: Scheduling operations

- [ ] Add queue priority and fairness primitives.
- [ ] Add backpressure and capacity-aware admission.
- [ ] Add runtime drain and maintenance behavior.
- [ ] Add run budgets and kill-switch enforcement.

## SPIKEs

- [ ] S-ORCH-01 Workflow library versus custom runtime prototype.
- [ ] S-ORCH-02 Exactly-once, at-least-once, and idempotent side-effect model.
- [ ] S-ORCH-03 Durable state/event store benchmark.
- [ ] S-ORCH-04 Parallel scheduling model for local and hosted execution.
- [ ] S-ORCH-05 Long-running approval and external callback behavior.
- [ ] S-ORCH-06 Transfer-packet persistence, pruning, and recovery semantics.

## Exit criteria

A workflow run survives daemon restart, waits for approval, executes bounded retry/transfer loops with typed node piping, and exposes a correct final state.
