# Epic-02: Local Workflow Execution

Milestone: M2
Source PRDs: [PRD-01](../prds/prd-01-workflow-definition.md), [PRD-02](../prds/prd-02-durable-orchestration-runtime.md), [PRD-07](../prds/prd-07-control-plane-api-and-local-daemon.md)
Status: Draft

## Outcome

The local daemon can invoke a registered workflow with structured inputs and execute its basic graph control flow through the Control API.

## Tasks

### Daemon and invocation

- [ ] Implement daemon lifecycle, configuration, health, and local connection discovery.
- [ ] Bind an explicit workflow version and schema-validated inputs to a run.
- [ ] Expose start, status, cancel, and result commands through the Control API.

### Graph execution

- [ ] Implement node readiness and sequential execution.
- [ ] Implement conditions, branches, joins, and terminal states.
- [ ] Enforce node input/output bindings and run budgets.
- [ ] Emit a minimal ordered event stream.

### Local conformance

- [ ] Add deterministic control-node and fixture-node implementations.
- [ ] Test invalid invocation, failed node, cancellation, and terminal outcomes.
- [ ] Document the minimal local setup and invocation contract.

## SPIKEs

- [ ] Select the initial daemon and graph-runtime implementation strategy.
- [ ] Define local process supervision and data-directory boundaries.
- [ ] Define event ordering and run identity conventions required before persistence.

## Exit criteria

A caller registers and invokes a workflow containing sequential, conditional, join, and terminal nodes; the daemon executes it locally and returns a structured result through the Control API.
