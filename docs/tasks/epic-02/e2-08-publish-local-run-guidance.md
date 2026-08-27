# E2-08: Document how to run workflows locally

| Tracking | Value |
| --- | --- |
| Status | Not started |
| Last updated | 2026-08-26 |
| Picked up | No |
| Owner | Unassigned |
| Blocked by | [E2-06](e2-06-add-control-api-run-operations.md), [E2-07](e2-07-build-local-execution-conformance-suite.md) |

## Task

This task creates a tested local-run guide. It explains how to:

- configure and start the Control API and daemon;
- publish and invoke an example workflow;
- retrieve and interpret run status, active step instances (`currentSteps`), results, and complete failure arrays;
- diagnose documented failures (binding, handler, output validation, loop bounds);
- understand the in-memory, structured fan-out/fan-in, sequential loop, and supported-step boundaries.
## End state

- A new contributor can execute and diagnose the Epic 2 examples using only the guide.

## Why

- Local execution needs tested operating instructions as well as working code.

## Blocks

- [E2-09: Prove local workflow execution end to end](e2-09-add-end-to-end-epic-demonstration.md)

## Acceptance criteria

- A new contributor can start both processes and execute a published example.
- The guide explains the supported run states, `currentSteps` projection, and failure array fields.
- Examples cover sequential success, both branch results, structured fan-out/fan-in, loops, and failures.
- The guide states the in-memory, SESE region, sequential loop, and supported-step boundaries.
- Automated documentation checks or the demonstration exercise every command where practical.
