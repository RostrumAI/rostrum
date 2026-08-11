# E3-S1: Decide checkpoint and recovery behavior

| Tracking | Value |
| --- | --- |
| Status | Not started |
| Last updated | 2026-08-05 |
| Picked up | No |
| Owner | Unassigned |
| Blocked by | [Epic 02](../../epics/epic-02-local-workflow-execution.md) |

## Task

This SPIKE decides which execution records commit together and how one local daemon recovers a nonterminal run. It answers:

- When is an invocation durably accepted?
- Which run, graph, step, attempt, outcome, and event records form a checkpoint?
- What happens when the daemon stops before, during, or after a handler invocation?
- How is an interrupted attempt distinguished from completed work?
- Which pending records must startup recovery process before scheduling work?
- Which records can the Control API read while the daemon is unavailable?
- How do both processes share one persistence contract without sharing execution ownership?

## End state

- One reviewed decision record and restart fixture matrix define checkpoint atomicity, recovery ordering, and execution-state ownership.

## Why

- Durable execution depends on knowing exactly which progress survived an interruption and which work may run again.

## Blocks

- [E3-01: Specify durable execution behavior and fixtures](e3-01-specify-durable-execution-behavior.md)

## Acceptance criteria

- The decision record defines durable acceptance and every checkpoint boundary.
- A restart matrix covers interruption before invocation commit, before handler start, during a handler, after handler return, and after outcome commit.
- Recovery never interprets an uncommitted outcome as completed work.
- The design permits at-least-once handler attempts and explains the Epic 04 side-effect boundary.
- The daemon owns execution-state transitions while the Control API remains read-only for those records.
- Pending commands are processed before recovered work can start.
