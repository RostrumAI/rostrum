# E3-09: Document durable local runs

| Tracking | Value |
| --- | --- |
| Status | Not started |
| Last updated | 2026-08-05 |
| Picked up | No |
| Owner | Unassigned |
| Blocked by | [E3-07](e3-07-add-durable-run-control-api-operations.md), [E3-08](e3-08-build-durable-execution-conformance-suite.md) |

## Task

This task creates a tested durable-run guide. It explains how to:

- configure and migrate the local durable store;
- interrupt and restart the daemon without losing a run;
- inspect checkpoints, attempts, commands, decisions, and terminal results;
- page through the event timeline with a saved cursor;
- retrieve and verify an artifact;
- pause, resume, cancel, and answer a human-decision request;
- interpret interrupted attempts and at-least-once execution.

## End state

- A new contributor can recover, inspect, and control the Epic 3 examples using only the guide.

## Why

- Durable behavior must be operable and diagnosable outside the automated test harness.

## Blocks

- [E3-10: Prove durable runs and human control end to end](e3-10-add-end-to-end-epic-demonstration.md)

## Acceptance criteria

- A new contributor can interrupt an active example and complete it after daemon restart.
- The guide distinguishes a command request from its applied execution transition.
- The guide distinguishes operator pause from a human-decision wait.
- Examples cover retry success, pause and resume, cancellation, decision submission, event cursors, and artifact verification.
- The guide explains why an interrupted handler may receive another attempt.
- Automated documentation checks or the demonstration exercise every command where practical.
