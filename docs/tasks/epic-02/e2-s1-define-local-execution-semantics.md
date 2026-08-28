# E2-S1: Decide how a local run advances

| Tracking | Value |
| --- | --- |
| Status | Proposed, awaiting approval |
| Last updated | 2026-08-28 |
| Picked up | Yes |
| Owner | Stephen |
| Blocked by | [Epic 01](../../epics/epic-01-shape-of-a-workflow.md) |

## Task

This SPIKE decides how a local run starts, advances, completes, and fails. It covers:

- invocation acceptance and rejection;
- public run states and internal step states;
- input binding and exact output handling;
- engine-evaluated conditionals;
- parallel paths and matching joins;
- bounded sequential loops;
- explicit workflow results;
- progress reporting through `currentSteps`;
- complete ordered failure reporting.

Research and owner decisions are recorded in [E2-S1 local execution options](../../research/e2-s1-local-execution-semantics-options.md). The [E2-S1 proof of concept](../../results/epic-02/e2-s1-proof-of-concept.md) verifies the proposed scheduler, join rules, capacity-bound dispatch, structured loop bodies, failure ordering, and large synthetic graphs. E2-03 owns the remaining loop failure-policy and result-entry details.

## End state

One approved [local execution decision](../../decisions/epic-02/e2-s1-local-execution-semantics.md) and its example traces define the runtime behavior that Epic 02 implements.

## Why

The daemon, runtime, Control API, and tests need the same meaning for a workflow run before implementation begins.

## Blocks

- [E2-03: Define the executable workflow contract](e2-03-define-executable-workflow-contract.md)

## Acceptance criteria

- The decision defines invocation, run, step, binding, conditional, parallel, loop, result, progress, and failure behavior.
- Every state transition and terminal outcome is explicit.
- Sequential traces have exact expected order, while concurrent examples state causal constraints.
- Unsupported handlers, invalid outcomes, unresolved references, routing errors, loop errors, and scheduler errors have stable failure families.
- The decision assigns the complete loop failure-policy schema to E2-03.
- The product owner and implementing engineer approve the decision before E2-03 begins.
