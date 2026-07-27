# Epic-07: Workflow Simulation

Milestone: M7
Source PRDs: [PRD-15](../prds/prd-15-workflow-authoring-and-simulation.md), [PRD-01](../prds/prd-01-workflow-definition.md), [PRD-04](../prds/prd-04-deterministic-tools-and-policy.md)
Status: Draft

## Outcome

Authors can simulate a workflow through per-node contracts and rich mock data, inspect every traversed path and suppressed effect, and keep simulation state distinct from real execution.

## Tasks

### Per-node simulation contracts

- [ ] Define allowed mock outputs, states, artifacts, effects, timing, and cost metadata for every node type.
- [ ] Support fixture, generated, replayed, and explicitly real node modes.
- [ ] Reject a mock result that violates the node's declared output variants.

### Mock library

- [ ] Provide mocks for models, tools, container scripts, context views, integrations, human decisions, artifacts, delay, timeout, and partial failure.
- [ ] Version fixtures and support deterministic replay.
- [ ] Define safe redaction and approval for fixtures derived from historical results.

### Simulation engine and reports

- [ ] Execute graph control flow using each node's selected simulation mode.
- [ ] Evaluate policies while suppressing undeclared effects.
- [ ] Report traversed paths, uncovered branches, node modes, mocks, artifacts, failures, and suppressed effects.
- [ ] Expose simulation through the Control API and regression-test harness.

## SPIKEs

- [ ] Define mock-data API ergonomics and fixture generation.
- [ ] Define path-coverage semantics for loops and dynamic branches.
- [ ] Define when explicitly real simulation behavior may use providers, Docker, network, or credentials.

## Exit criteria

A representative workflow simulates success, failure, retry, and approval paths; every node result satisfies its simulation contract, and the report identifies all real behavior and suppressed effects.
