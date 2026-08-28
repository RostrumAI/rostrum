# E2-S1: Decide how a local run advances

| Tracking | Value |
| --- | --- |
| Status | Proposed, awaiting approval |
| Last updated | 2026-08-28 |
| Picked up | Yes |
| Owner | Stephen |
| Blocked by | [Epic 01](../../epics/epic-01-shape-of-a-workflow.md) |

## Task

This task decides how a local run starts, advances, completes, and fails. It covers:

- invocation acceptance and rejection;
- public run states and internal step states;
- input binding, the assignment of input values, and exact output handling;
- conditionals evaluated by the engine;
- parallel paths and joins that reunite the corresponding parallel paths;
- sequential loops with explicit bounds;
- explicit workflow results;
- progress reporting through `currentSteps`;
- complete, ordered failure reporting.

Research and owner decisions are recorded in [E2-S1 local execution options](../../research/e2-s1-local-execution-semantics-options.md). The [E2-S1 proof of concept](../../results/epic-02/e2-s1-proof-of-concept.md) verifies the proposed scheduler (the component that selects work to run), join rules, dispatch limited by capacity, explicitly structured loop bodies, failure ordering, and large generated graphs. E2-03 owns the remaining details of loop failure policy and result entries.

## End state

One approved [local execution decision](../../decisions/epic-02/e2-s1-local-execution-semantics.md) and its example traces define the runtime behavior that Epic 02 implements.

## Why

The daemon, runtime, Control API, and tests need the same meaning for a workflow run before implementation begins.

## Blocks

- [E2-03: Define the executable workflow contract](e2-03-define-executable-workflow-contract.md)

## Acceptance criteria

- The decision defines invocation, run, step, binding, conditional, parallel, loop, result, progress, and failure behavior.
- Every state transition and final outcome is explicit.
- Sequential traces have an exact expected order, while concurrent examples state causal constraints (ordering dependencies that concurrent operations must satisfy).
- Unsupported handlers (step implementations), invalid outcomes, references that cannot be resolved, path-selection errors, loop errors, and scheduler errors have stable failure categories.
- The decision assigns the complete schema for loop failure policy to E2-03.
- The product owner and implementing engineer approve the decision before E2-03 begins.
