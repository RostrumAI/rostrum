# Epic-03: Durable Runs and Human Control

Milestone: M3
Source PRDs: [PRD-02](../prds/prd-02-durable-orchestration-runtime.md), [PRD-06](../prds/prd-06-state-events-artifacts-observability.md), [PRD-07](../prds/prd-07-control-plane-api-and-local-daemon.md)
Status: Draft

## Outcome

Runs survive interruption, expose complete state and evidence, and can wait safely for retries, timers, callbacks, or human decisions.

## Tasks

### Durable execution

- [ ] Persist run, graph, node-attempt, timer, retry, and decision state.
- [ ] Resume after daemon restart without repeating completed side effects.
- [ ] Implement bounded retries, parallel branches, durable joins, waits, and cancellation.

### Events and artifacts

- [ ] Define snapshots, event cursors, replay, and reconnect behavior.
- [ ] Store addressable artifacts, logs, policy decisions, costs, and failure evidence.
- [ ] Add retention, redaction, integrity, and run-to-workflow provenance.

### Human control

- [ ] Implement approval, rejection, question, expiry, escalation, and resume transitions.
- [ ] Record acceptable users/groups, identity, scope, evidence, and immutable decision history.
- [ ] Expose pause, resume, retry, cancel, and approval commands through the Control API.

## SPIKEs

- [ ] Select the initial state and event storage strategy.
- [ ] Define idempotency and delivery guarantees for external side effects.
- [ ] Define approval membership changes, quorum, and delegated authority.

## Exit criteria

A run pauses for approval, survives daemon restart and client disconnect, resumes exactly once after the decision, and exposes reconstructable events, artifacts, attempts, and policy evidence.
