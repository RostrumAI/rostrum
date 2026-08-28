# E2-08: Execute parallel paths and joins

| Tracking | Value |
| --- | --- |
| Status | Not started |
| Last updated | 2026-08-28 |
| Picked up | No |
| Owner | Unassigned |
| Blocked by | [E2-07](e2-07-execute-sequential-and-conditional-workflows.md) |

## Task

This task extends the daemon execution engine to run bounded parallel paths and matching joins. A join is a step that synchronizes concurrent branches into a single downstream path.

This task adds:

- a configured daemon-wide limit on handlers (registered execution callbacks that run the logic for a step);
- scheduling eligibility for every root step (the first step in each concurrent branch) in a parallel split (a control-flow construct that divides execution into concurrent branches) during the same scheduling turn (a single scheduling cycle in which the engine evaluates eligible steps);
- a waiting state for eligible work that cannot start yet;
- sequential work inside each parallel path;
- properly nested parallel splits that rejoin before their containing path rejoins;
- dependency tracking that releases a join only after every path succeeds;
- a fair scheduling rule across active runs;
- failure handling that stops new work while allowing running handlers to finish;
- stable collection of every failure observed while running handlers drain.

Handler capacity can affect start and completion timing. It cannot affect data binding, conditional selection, joined output, or ordered failures.

## End state

The daemon executes every valid structured parallel fixture and produces the same terminal result under every tested worker limit and legal completion order.

## Why

Parallel paths are part of workflow interface v1. Serializing them or accepting ambiguous joins would prove only a subset of the workflow language.

## Blocks

- [E2-09: Execute bounded loops](e2-09-execute-bounded-loops.md)

## Acceptance criteria

- All roots of a parallel split become waiting together, subject to available handler capacity.
- A matching join starts only after one declared exit from every path commits success.
- Sequences and properly nested parallel work execute within each path.
- No implementation path permits crossing paths, early completion, or conditional routing inside an open parallel section.
- Capacity one and capacity greater than one produce the same joined output.
- Reversed branch completion orders produce the same joined output.
- After the first unhandled failure, no new handler starts and already-running handlers finish.
- Concurrent failures completed in opposite orders produce the same complete ordered failure list.
- Scheduling across multiple active runs obeys the documented non-starvation rule.
- Tests assert required causal relationships rather than one fabricated concurrent trace order.
