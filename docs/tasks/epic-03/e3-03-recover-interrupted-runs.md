# E3-03: Recover interrupted runs

| Tracking | Value |
| --- | --- |
| Status | Not started |
| Last updated | 2026-08-05 |
| Picked up | No |
| Owner | Unassigned |
| Blocked by | [E3-02](e3-02-implement-durable-run-storage.md) |

## Task

This task adds daemon startup recovery. It performs these operations:

- find each nonterminal run owned by the local daemon;
- load its last committed graph and attempt state;
- classify any active attempt interrupted by daemon loss;
- read pending commands before scheduling recovered work;
- choose the specified continuation, wait, pause, cancellation, retry, or failure action;
- record recovery decisions and resulting events.

## End state

- Restarting the daemon deterministically restores every nonterminal local run from its committed records.

## Why

- Persisted state is useful only if the executor can turn it back into safe, explainable work.

## Blocks

- [E3-04: Implement retries and operator controls](e3-04-implement-retries-and-operator-controls.md)
- [E3-05: Implement human-decision waits](e3-05-implement-human-decision-waits.md)
- [E3-08: Build the durable execution conformance suite](e3-08-build-durable-execution-conformance-suite.md)

## Acceptance criteria

- Startup enumerates and recovers every supported nonterminal run exactly once for that daemon start.
- Committed step outcomes remain completed and are not invoked again.
- An attempt active at daemon loss is recorded as interrupted before another attempt can begin.
- Pending pause and cancellation commands are applied before recovered work is scheduled.
- Runs already waiting for a human decision remain waiting without creating another request.
- Recovery events explain the prior state, interruption when applicable, and selected action.
- Repeating startup after another interruption preserves the same invariants.
