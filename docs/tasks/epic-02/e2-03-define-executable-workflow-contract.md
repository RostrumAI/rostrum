# E2-03: Define the executable workflow contract

| Tracking | Value |
| --- | --- |
| Status | Not started |
| Last updated | 2026-08-28 |
| Picked up | No |
| Owner | Unassigned |
| Blocked by | [E2-S1](e2-s1-define-local-execution-semantics.md), [E2-S2](e2-s2-select-local-daemon-transport.md), [E2-01](e2-01-clarify-workflow-interface-terminology.md), [E2-02](e2-02-establish-task-tracking.md) |

## Task

This task turns the E2-S1 execution decision and E2-S2 transport decision into one specification and fixture catalog for local workflow execution.

The specification defines:

- exact published-version invocation and rejection;
- public run states and internal step-instance states;
- workflow input, step output, and loop-variable binding;
- required and optional handler inputs;
- exact handler outputs and structured failures;
- sequential connections and conditional evaluation;
- parallel paths, matching joins, and nested parallel work;
- bounded loops and their fail-fast and error-tolerant policies;
- explicit `result` completion;
- `currentSteps` projection;
- active-handler drain and stable multi-failure ordering;
- expected execution traces and causal constraints.

Concurrent fixtures do not prescribe one completion order. They state relationships that must always hold, such as a join becoming eligible only after every path succeeds.

## End state

The shared workflow library, daemon, execution runtime, Control API, and tests can implement the same behavior from one reviewed specification and fixture catalog.

## Why

Complete local execution crosses several packages and processes. One normative contract prevents each layer from choosing different meanings for the same workflow.

## Blocks

- [E2-04: Make workflow interface v1 executable](e2-04-make-workflow-interface-v1-executable.md)
- [E2-06: Build the step interface and reference steps](e2-06-build-step-interface-and-reference-steps.md)
- [E2-11: Build the execution conformance suite](e2-11-build-execution-conformance-suite.md)

## Acceptance criteria

- One reviewed specification contains every approved E2-S1 and E2-S2 decision needed for implementation.
- The loop contract defines the policy field, allowed values, default, capturable failures, ordered result-entry schema, downstream binding behavior, and run-level failure behavior.
- A loop iteration whose parallel body observes multiple failures preserves their complete stable order in its error result.
- Conditional operators have explicit type rules and do not use JavaScript coercion.
- `currentSteps` contents, ordering, loop identity, and terminal behavior are defined.
- Rejected invocations are distinct from accepted failed runs and never receive a run ID.
- Sequential traces have exact expected order; concurrent traces use causal constraints and stable terminal values.
- Fixtures cover every v1 control-flow construct, valid and invalid joins, both loop policies, invocation rejection, binding failure, handler failure, output failure, routing failure, and concurrent failures.
- API and daemon messages in the fixtures match the E2-S2 transport contract.
